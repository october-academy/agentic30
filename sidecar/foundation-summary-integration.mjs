/**
 * foundation-summary sub-workflow integration glue (Sub-AC 5 of AC 13).
 *
 * Day 7 of Foundation Phase routes the unified Foundation chat surface
 * (foundation-chat.mjs / runUnifiedFoundationChat in index.mjs) into the
 * deterministic draft.v2 writer. Sub-AC 5 closes the Foundation loop:
 *
 *   • PARSE the assistant text emitted by the unified chat surface (or by
 *     a wrapped foundation-summary SDK call) into three labelled sections
 *     (SPEC v3 / go-no-go / foundation-summary).
 *   • COMPOSE pre-collected draft.v1 lineage (Sub-AC 2) and the rule-check
 *     verdict (Sub-AC 3) so the audit JSON can pin the v1 → v2 transition.
 *   • WRITE draft.v2 artifacts under workspace/.agentic30/foundation/.
 *   • EMIT structured evidence_refs entries pointing at each artifact so
 *     the per-message JSON sidecar (`persistEvidenceRefsSidecar`) carries
 *     the lineage for KR4.1 / KR4.2 measurement.
 *   • RETURN a `summary` payload the dispatcher uses to (a) attach to the
 *     assistant message, (b) broadcast a `foundation_summary_completed`
 *     event, and (c) capture telemetry.
 *
 * Single-channel guarantee: nothing in this module surfaces a routing flag
 * to the chat caller. The integration runs AFTER the provider stream has
 * finished — the user-facing surface stays a single chat thread.
 *
 * Mirrors `monetization-ask-integration.mjs` deliberately so future
 * sub-workflow integrations have a consistent contract:
 *   load*State → build*ContextBlock → shouldRun* → apply*Outcome →
 *   build*EvidenceRef.
 */

import path from "node:path";
import {
  collectFoundationEvidence,
  buildFoundationSummaryDraftV1,
} from "./foundation-summary/evidence-collector.mjs";
import {
  RULE_CHECK_THRESHOLDS,
  runFoundationSummaryRuleCheck,
} from "./foundation-summary/rule-check.mjs";
import {
  DRAFT_V2_SCHEMA_VERSION,
  FOUNDATION_DRAFT_V2_FILES,
  parseDraftV2Sections,
  writeFoundationSummaryDraftV2,
} from "./foundation-summary/draft-writer.mjs";

/** Canonical sub-workflow tag. Mirrors FOUNDATION_DAYS[7].sub_workflow. */
export const FOUNDATION_SUMMARY_SUB_WORKFLOW = "foundation-summary";

/** Day index this sub-workflow binds to. Mirrors FOUNDATION_DAYS[7].day. */
export const FOUNDATION_SUMMARY_DAY = 7;

/** session.runtime.foundation slot key the dispatcher uses to persist state. */
export const FOUNDATION_SUMMARY_RUNTIME_KEY = "foundationSummary";

/**
 * evidence_refs ref_type emitted when draft.v2 artifacts are written. Stays
 * in `ALLOWED_EVIDENCE_REF_TYPES` (rule-check.mjs) so the rule-check does
 * NOT silently fail the artifact lineage when KR4.2 cross-check runs.
 */
export const FOUNDATION_SUMMARY_EVIDENCE_REF_TYPE = "file";

/**
 * Gate: should the unified chat dispatcher run the foundation-summary
 * outcome path for this turn? Day 7 + sub_workflow tag is the gate — every
 * other Day/sub_workflow combination bypasses this module entirely so the
 * dispatcher's hot path stays the same shape for Day 0-6.
 */
export function shouldRunFoundationSummary({ day, subWorkflow } = {}) {
  if (subWorkflow !== FOUNDATION_SUMMARY_SUB_WORKFLOW) return false;
  const numericDay = Number(day);
  return Number.isFinite(numericDay) && numericDay === FOUNDATION_SUMMARY_DAY;
}

/**
 * Pull (or initialize) the foundation-summary state from a session's runtime.
 * Always returns a normalized object (never throws on corrupt input) — the
 * shape is small because the workflow itself is one-shot per Day 7 turn:
 *
 *   {
 *     schema_version: 2,
 *     last_run_at: string|null,
 *     last_artifacts: { spec_md?, go_no_go?, foundation_summary?, audit? },
 *     last_status: "draft_v2_written" | "draft_v2_partial" | "draft_v2_skipped"
 *                  | "draft_v2_error" | null,
 *   }
 */
export function loadFoundationSummaryState(sessionRuntime) {
  const slot = sessionRuntime?.foundation?.[FOUNDATION_SUMMARY_RUNTIME_KEY] ?? null;
  if (!slot || typeof slot !== "object" || Array.isArray(slot)) {
    return {
      schema_version: DRAFT_V2_SCHEMA_VERSION,
      last_run_at: null,
      last_artifacts: {},
      last_status: null,
    };
  }
  return {
    schema_version:
      typeof slot.schema_version === "number" ? slot.schema_version : DRAFT_V2_SCHEMA_VERSION,
    last_run_at: typeof slot.last_run_at === "string" ? slot.last_run_at : null,
    last_artifacts:
      slot.last_artifacts && typeof slot.last_artifacts === "object"
        ? { ...slot.last_artifacts }
        : {},
    last_status: typeof slot.last_status === "string" ? slot.last_status : null,
  };
}

/**
 * Return a NEW session runtime object with the foundation-summary state
 * slotted under `runtime.foundation.foundationSummary`. Pure — never mutates
 * input. Composes with `attachMonetizationAskState` because both helpers
 * write to disjoint keys under `runtime.foundation`.
 */
export function attachFoundationSummaryState(sessionRuntime, state) {
  const prevFoundation = sessionRuntime?.foundation ?? {};
  return {
    ...(sessionRuntime || {}),
    foundation: {
      ...prevFoundation,
      [FOUNDATION_SUMMARY_RUNTIME_KEY]: state,
    },
  };
}

/**
 * Sub-AC 5 outcome resolver.
 *
 * Pipeline:
 *   1. Pre-collect Day 0-7 evidence (Sub-AC 2) → derive draft.v1 for the
 *      audit lineage. Failure here is non-fatal: the writer still runs with
 *      `draftV1=null` so a creator with a partially-empty workspace can
 *      still capture the SPEC v3 they actually wrote in chat.
 *   2. Parse the assistant text into labelled sections (Sub-AC 5 parser).
 *   3. Run the deterministic rule-check (Sub-AC 3) to produce the verdict
 *      that gets stamped into the audit JSON.
 *   4. Write draft.v2 artifacts via `writeFoundationSummaryDraftV2`. The
 *      writer is partial-write tolerant — if SPEC v3 is missing, only
 *      go-no-go + foundation-summary persist.
 *   5. Build evidence_refs (one per written artifact) so the per-message
 *      sidecar JSON carries the lineage. Each ref uses ref_type="file"
 *      and field_used encodes which artifact it points at.
 *
 * @param {object} args
 * @param {string} args.assistantText  - The provider's final assistant text
 *                                       (already streamed to the user).
 * @param {string} [args.workspaceRoot]
 * @param {object} [args.precollectedEvidence] - Optional injected evidence
 *                                       (skip collectFoundationEvidence call).
 * @param {object|number|Array|null} [args.userFeedback] - Forwarded to
 *                                       the rule-check for KR4.1.
 * @param {object} [args.reviewLoop]   - Optional review-loop result (Sub-AC 4)
 *                                       for the audit sidecar.
 * @param {object} [args.fs]           - `node:fs/promises`-shaped override.
 * @param {() => Date} [args.now]      - Clock injection.
 * @returns {Promise<{
 *   stateAfter: object,
 *   isTerminal: boolean,
 *   reason: string|null,
 *   sectionsPresent: string[],
 *   sectionsSkipped: string[],
 *   verdict: object|null,
 *   draftV1: object|null,
 *   writeResult: object|null,
 *   summary: object,
 *   evidenceRefs: Array<object>,
 *   error: Error|null,
 * }>}
 */
export async function applyFoundationSummaryOutcome({
  assistantText = "",
  workspaceRoot = "",
  precollectedEvidence = null,
  userFeedback = null,
  reviewLoop = null,
  fs,
  now = () => new Date(),
} = {}) {
  const completedAt = (() => {
    try {
      const d = typeof now === "function" ? now() : now;
      return d instanceof Date ? d.toISOString() : new Date().toISOString();
    } catch {
      return new Date().toISOString();
    }
  })();

  // 1. Pre-collect evidence (Sub-AC 2) → draft.v1 lineage.
  let evidence = precollectedEvidence;
  if (!evidence && workspaceRoot) {
    try {
      evidence = await collectFoundationEvidence({ workspaceRoot, fs, now });
    } catch {
      evidence = null; // non-fatal — writer still runs
    }
  }
  const draftV1 = evidence ? buildFoundationSummaryDraftV1(evidence) : null;

  // 2. Parse assistant text → sections.
  const sections = parseDraftV2Sections(assistantText);
  const hasAnySection = Boolean(
    sections.spec_md_v3 || sections.go_no_go || sections.foundation_summary,
  );

  // 3. Deterministic rule-check (Sub-AC 3) — feeds the audit JSON.
  // We pass an empty evidenceRefs array because the rule-check measures the
  // *assistant text*, not the post-write evidence_refs we synthesize below.
  // Suppressing the evidence_refs axis here is intentional: the writer
  // produces the refs as side-effects, so failing the rule on "no refs in
  // the assistant text" would be a tautology. The KR4.1/4.2 axes still run.
  const verdict = (() => {
    try {
      return runFoundationSummaryRuleCheck({
        assistantText,
        evidenceRefs: [],
        userFeedback,
        draftV1Text: draftV1?.text || "",
        finalDraftText:
          sections.foundation_summary ||
          sections.spec_md_v3 ||
          sections.go_no_go ||
          assistantText,
        thresholds: RULE_CHECK_THRESHOLDS,
      });
    } catch {
      return null;
    }
  })();

  // 4. Write draft.v2 artifacts.
  let writeResult = null;
  let writeError = null;
  if (hasAnySection && workspaceRoot) {
    try {
      writeResult = await writeFoundationSummaryDraftV2({
        workspaceRoot,
        sections,
        draftV1,
        verdict,
        reviewLoop,
        assistantText,
        fs,
        now,
      });
    } catch (error) {
      writeError = error instanceof Error ? error : new Error(String(error));
      writeResult = null;
    }
  }

  // 5. Build evidence_refs entries pointing at written artifacts.
  const evidenceRefs = buildFoundationSummaryEvidenceRefs({
    writeResult,
    evidence,
    verdict,
  });

  // Status decision tree — mirrors the dispatcher's audit needs.
  let status;
  let reason;
  if (writeError) {
    status = "draft_v2_error";
    reason = `draft.v2 write failed: ${writeError.message}`;
  } else if (!hasAnySection) {
    status = "draft_v2_skipped";
    reason = "assistant text contained no SPEC v3 / go-no-go / foundation-summary heading";
  } else if (!writeResult) {
    // hasAnySection=true but writer skipped (e.g. workspaceRoot missing).
    status = "draft_v2_skipped";
    reason = workspaceRoot
      ? "writer returned no result"
      : "no workspaceRoot — draft.v2 not persisted";
  } else if (writeResult.sections_skipped.length === 0) {
    status = "draft_v2_written";
    reason = `draft.v2 fully written (${writeResult.sections_present.join(", ")})`;
  } else {
    status = "draft_v2_partial";
    reason = `draft.v2 partial — wrote ${writeResult.sections_present.join(", ") || "none"}; skipped ${writeResult.sections_skipped.join(", ")}`;
  }

  const summary = {
    schema_version: DRAFT_V2_SCHEMA_VERSION,
    completed_at: completedAt,
    status,
    reason,
    artifacts: writeResult?.paths ? { ...writeResult.paths } : {},
    sections_present: writeResult?.sections_present
      ? [...writeResult.sections_present]
      : [],
    sections_skipped: writeResult?.sections_skipped
      ? [...writeResult.sections_skipped]
      : [],
    verdict_pass: verdict ? Boolean(verdict.pass) : null,
    verdict_score: verdict && typeof verdict.score === "number" ? verdict.score : null,
    verdict_reasons: verdict && Array.isArray(verdict.reasons) ? [...verdict.reasons] : [],
    monetization_signal: evidence?.monetization_signal ?? null,
    monetization_yes_count: evidence?.monetization_ask?.response_yes_count ?? 0,
    go_no_go_recommendation: evidence?.go_no_go_recommendation ?? null,
    artifacts_completeness: evidence?.artifacts_completeness ?? null,
    review_loop_status: reviewLoop && typeof reviewLoop.status === "string" ? reviewLoop.status : null,
    review_loop_passed: reviewLoop ? Boolean(reviewLoop.passed) : null,
  };

  const stateAfter = {
    schema_version: DRAFT_V2_SCHEMA_VERSION,
    last_run_at: completedAt,
    last_artifacts: writeResult?.paths ? { ...writeResult.paths } : {},
    last_status: status,
  };

  return {
    stateAfter,
    isTerminal: status === "draft_v2_written" || status === "draft_v2_partial",
    reason,
    sectionsPresent: writeResult?.sections_present ?? [],
    sectionsSkipped: writeResult?.sections_skipped ?? [],
    verdict,
    draftV1,
    writeResult,
    summary,
    evidenceRefs,
    error: writeError,
  };
}

/**
 * Build the evidence_refs array pointing at the written draft.v2 artifacts.
 * Each ref's shape matches `sanitizeEvidenceRefs` in foundation-chat.mjs so
 * the value round-trips through `persistEvidenceRefsSidecar` without loss.
 *
 * Returns `[]` when nothing was written so the caller can use the ref count
 * directly in the foundation chat event payload (`evidenceRefCount`).
 */
export function buildFoundationSummaryEvidenceRefs({
  writeResult = null,
  evidence = null,
  verdict = null,
} = {}) {
  if (!writeResult || !writeResult.paths) return [];
  const refs = [];

  if (writeResult.paths.spec_md) {
    refs.push({
      file: writeResult.paths.spec_md,
      location: FOUNDATION_DRAFT_V2_FILES.spec_md,
      field_used: "spec_md_v3_draft_v2",
      extracted_value: {
        schema_version: DRAFT_V2_SCHEMA_VERSION,
        spec_versions_present: evidence?.spec_versions_present ?? [],
        verdict_pass: verdict ? Boolean(verdict.pass) : null,
      },
      ref_type: FOUNDATION_SUMMARY_EVIDENCE_REF_TYPE,
    });
  }

  if (writeResult.paths.go_no_go) {
    refs.push({
      file: writeResult.paths.go_no_go,
      location: FOUNDATION_DRAFT_V2_FILES.go_no_go,
      field_used: "go_no_go_draft_v2",
      extracted_value: {
        schema_version: DRAFT_V2_SCHEMA_VERSION,
        recommendation: evidence?.go_no_go_recommendation ?? null,
        monetization_signal: evidence?.monetization_signal ?? null,
        monetization_yes_count: evidence?.monetization_ask?.response_yes_count ?? 0,
      },
      ref_type: FOUNDATION_SUMMARY_EVIDENCE_REF_TYPE,
    });
  }

  if (writeResult.paths.foundation_summary) {
    refs.push({
      file: writeResult.paths.foundation_summary,
      location: FOUNDATION_DRAFT_V2_FILES.foundation_summary,
      field_used: "foundation_summary_draft_v2",
      extracted_value: {
        schema_version: DRAFT_V2_SCHEMA_VERSION,
        artifacts_completeness: evidence?.artifacts_completeness ?? null,
        evidence_sidecars_total: evidence?.evidence_sidecars?.total ?? 0,
      },
      ref_type: FOUNDATION_SUMMARY_EVIDENCE_REF_TYPE,
    });
  }

  if (writeResult.paths.audit) {
    refs.push({
      file: writeResult.paths.audit,
      location: FOUNDATION_DRAFT_V2_FILES.audit,
      field_used: "draft_v2_audit",
      extracted_value: {
        schema_version: DRAFT_V2_SCHEMA_VERSION,
        sections_present: writeResult.sections_present ?? [],
        sections_skipped: writeResult.sections_skipped ?? [],
      },
      ref_type: FOUNDATION_SUMMARY_EVIDENCE_REF_TYPE,
    });
  }

  return refs;
}

/**
 * Build the broadcast payload the dispatcher sends after the outcome path
 * runs successfully. Mirrors the `monetization_ask_completed` shape so
 * client UIs can render both Day 6 and Day 7 completion banners with the
 * same contract.
 */
export function buildFoundationSummaryCompletedEvent({
  sessionId,
  messageId,
  outcome,
}) {
  if (!outcome) return null;
  return {
    type: "foundation_summary_completed",
    sessionId,
    messageId,
    status: outcome.summary?.status ?? null,
    reason: outcome.summary?.reason ?? null,
    artifacts: outcome.summary?.artifacts ?? {},
    sections_present: outcome.summary?.sections_present ?? [],
    sections_skipped: outcome.summary?.sections_skipped ?? [],
    monetization_signal: outcome.summary?.monetization_signal ?? null,
    monetization_yes_count: outcome.summary?.monetization_yes_count ?? 0,
    go_no_go_recommendation: outcome.summary?.go_no_go_recommendation ?? null,
    verdict_pass: outcome.summary?.verdict_pass ?? null,
    verdict_score: outcome.summary?.verdict_score ?? null,
    completed_at: outcome.summary?.completed_at ?? null,
  };
}

/* ──────────────── re-exports for callers that only import this ──────────────── */

export {
  DRAFT_V2_SCHEMA_VERSION,
  FOUNDATION_DRAFT_V2_FILES,
  parseDraftV2Sections,
  writeFoundationSummaryDraftV2,
};

export const __test__ = Object.freeze({
  // Exposed only so tests can poke at internal path conventions without
  // re-deriving them from scratch.
  buildArtifactPath: (root, key) =>
    path.join(path.resolve(root), ".agentic30", "foundation", FOUNDATION_DRAFT_V2_FILES[key]),
});

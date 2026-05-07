/**
 * monetization-ask sub-workflow integration glue (Sub-AC 4 of AC 12).
 *
 * Day 6 of Foundation Phase routes the unified Foundation chat surface
 * (foundation-chat.mjs / runUnifiedFoundationChat in index.mjs) into the
 * 4-turn monetization-ask state machine. The dispatcher MUST stay
 * single-channel — there is no caller-visible "mode" flag — so this
 * integration module hides three responsibilities behind small entry points:
 *
 *   1. Load (or initialize) the monetization-ask state from
 *      `session.runtime.foundation.monetizationAsk` so the sub-workflow turn
 *      cursor survives across chat turns and reboots.
 *
 *   2. Render the turn-specific system block that the AI provider needs in
 *      order to emit the right opener / pushback. The block plugs straight
 *      into `composeUnifiedFoundationPrompt({ bipContextBlock })` — no extra
 *      provider-runner wiring required.
 *
 *   3. After the provider finishes streaming, evaluate the user's response
 *      against the current turn's transition rules. On the terminal turn we
 *      flush `monetization-ask-result.md` to the workspace and emit a
 *      structured evidence_ref so:
 *        - foundation-summary/evidence-collector.mjs picks it up on Day 7;
 *        - persistEvidenceRefsSidecar() embeds the artifact path inside the
 *          per-message JSON sidecar (KR4.1/4.2 traceability).
 *
 * Pure module — no fs / network / clock side effects beyond:
 *   • the injected `now` clock (the state machine's contract), and
 *   • a single `writeMonetizationAskResult()` call when the terminal turn
 *     advances. Tests inject `fs`/`now` to keep the run deterministic.
 *
 * Hidden contract with the dispatcher:
 *   • The sub-workflow systemBlock is appended to `bipContextBlock` so the
 *     provider sees it as system context, not a routing flag. This preserves
 *     the "single AI surface" guarantee from AC 3.
 *   • The dispatcher MUST persist `outcome.stateAfter` back onto the session
 *     runtime via `attachMonetizationAskState()` BEFORE calling
 *     `persistSessions()`, otherwise the next turn's cursor will regress.
 *   • `outcome.evidenceRef` is intentionally additive — the dispatcher
 *     should concat it to `foundationContext.evidence_refs` so the JSON
 *     sidecar written by `persistEvidenceRefsSidecar()` carries the
 *     artifact pointer (`ref_type: "monetization_ask"`).
 */

import path from "node:path";

import {
  MONETIZATION_ASK_META,
  buildMonetizationAskTurnSystemBlock,
} from "./monetization-ask-prompt.mjs";
import {
  MONETIZATION_ASK_RUNTIME_KEY,
  applyUserTurnResponse,
  ensureMonetizationAskState,
  isMonetizationAskComplete,
} from "./monetization-ask-state.mjs";
import { writeMonetizationAskResult } from "./monetization-ask-result.mjs";

/** Canonical sub-workflow tag. Mirrors FOUNDATION_DAYS[6].sub_workflow. */
export const MONETIZATION_ASK_SUB_WORKFLOW = MONETIZATION_ASK_META.name;

/** Day index this sub-workflow binds to. Mirrors FOUNDATION_DAYS[6].day. */
export const MONETIZATION_ASK_DAY = MONETIZATION_ASK_META.day;

/**
 * evidence_refs ref_type emitted when result.md is written. Foundation-summary
 * evidence-collector and persistEvidenceRefsSidecar both pass-through unknown
 * ref_types, so this value is informational only — but keeping it stable lets
 * KR4.2 cross-checks lock onto the artifact lineage without parsing paths.
 */
export const MONETIZATION_ASK_EVIDENCE_REF_TYPE = "monetization_ask";

/**
 * Pull (or initialize) the monetization-ask state from a session's runtime.
 * Always returns a usable state object — `ensureMonetizationAskState`
 * tolerates missing/corrupt input by returning a fresh initial state.
 *
 * @param {object|null|undefined} sessionRuntime - session.runtime as stored.
 * @param {object} [opts]
 * @param {() => Date} [opts.now] - clock injection.
 * @returns {object} normalized state.
 */
export function loadMonetizationAskState(sessionRuntime, opts = {}) {
  const slot = sessionRuntime?.foundation?.[MONETIZATION_ASK_RUNTIME_KEY] ?? null;
  return ensureMonetizationAskState(slot, opts);
}

/**
 * Return a NEW session runtime object with the monetization-ask state slotted
 * under `runtime.foundation.monetizationAsk`. Pure — never mutates input.
 *
 * Composition rule: the existing `foundation` runtime branch (day, sub_workflow,
 * spec_version, lastFoundationChatAt set by `runUnifiedFoundationChat`) is
 * preserved. Only the monetizationAsk slot is replaced.
 */
export function attachMonetizationAskState(sessionRuntime, state) {
  const prevFoundation = sessionRuntime?.foundation ?? {};
  return {
    ...(sessionRuntime || {}),
    foundation: {
      ...prevFoundation,
      [MONETIZATION_ASK_RUNTIME_KEY]: state,
    },
  };
}

/**
 * Build the turn-specific system block to feed into
 * `composeUnifiedFoundationPrompt({ bipContextBlock })`. Returns "" when the
 * state is missing or already terminal — at terminal the workflow has nothing
 * to push the AI toward, the result.md write happens in the outcome path.
 */
export function buildMonetizationAskContextBlock(state) {
  if (!state || typeof state !== "object") return "";
  if (isMonetizationAskComplete(state)) return "";
  if (typeof state.turn !== "string" || !state.turn) return "";
  return buildMonetizationAskTurnSystemBlock(state.turn);
}

/**
 * Decide whether the inbound foundation_chat call should drive the
 * monetization-ask state machine. Day 6 + sub_workflow tag is the gate —
 * all other Day/sub_workflow combinations bypass this module entirely so
 * the dispatcher's hot path stays the same shape.
 */
export function shouldRunMonetizationAsk({ day, subWorkflow } = {}) {
  if (subWorkflow !== MONETIZATION_ASK_SUB_WORKFLOW) return false;
  const numericDay = Number(day);
  return Number.isFinite(numericDay) && numericDay === MONETIZATION_ASK_DAY;
}

/**
 * Sub-AC 4 outcome resolver.
 *
 * Apply the user's response to the state machine and (when the terminal turn
 * advances) persist `monetization-ask-result.md` to the workspace. The caller
 * uses the returned `stateAfter` to update session runtime and the returned
 * `evidenceRef` to extend `foundationContext.evidence_refs` BEFORE the
 * sidecar JSON is written.
 *
 * On already-completed input (re-entry after terminal) we still re-emit the
 * evidence_ref pointing at the existing artifact path so the sidecar JSON
 * for the current message still carries the lineage — important for KR4.2
 * "user revisits Day 6" cross-checks.
 *
 * @param {object} args
 * @param {object} args.state         - state pulled by `loadMonetizationAskState`.
 * @param {string} args.userResponse  - the inbound chat prompt verbatim.
 * @param {object} [args.captures]    - optional structured captures from an
 *                                      upstream extractor; merged before
 *                                      heuristics. Falls back to {} so the
 *                                      heuristic path stays in charge.
 * @param {string} args.workspaceRoot - absolute project root for the artifact.
 * @param {object} [args.fs]          - `node:fs/promises`-shaped override
 *                                      for tests.
 * @param {() => Date} [args.now]     - clock injection.
 * @returns {Promise<{
 *   stateBefore: object,
 *   stateAfter: object,
 *   advanced: boolean,
 *   isTerminal: boolean,
 *   pushback: string|null,
 *   evaluation: object|null,
 *   reason: string|null,
 *   resultArtifact: { path: string|null, body: string|null, error?: Error }|null,
 *   evidenceRef: {
 *     file: string,
 *     location: string,
 *     field_used: string,
 *     extracted_value: any,
 *     ref_type: string,
 *   }|null,
 * }>}
 */
export async function applyMonetizationAskOutcome({
  state,
  userResponse = "",
  captures = {},
  workspaceRoot = "",
  fs,
  now = () => new Date(),
} = {}) {
  const stateBefore = state;
  const evaluation = applyUserTurnResponse(stateBefore, {
    userResponse,
    captures,
    now,
  });

  const stateAfter = evaluation.state;
  const advanced = Boolean(evaluation.advanced);
  const isTerminal = Boolean(evaluation.isTerminal);

  let resultArtifact = null;
  let evidenceRef = null;

  // Write the artifact and emit the evidence_ref when:
  //  (a) the response turn advances and finalizes the workflow this call, OR
  //  (b) the workflow was already complete on entry (re-emit lineage so the
  //      per-message sidecar still carries the artifact pointer).
  const justFinalized = advanced && isTerminal;
  const alreadyComplete = !advanced && evaluation.reason === "already_complete";

  if ((justFinalized || alreadyComplete) && workspaceRoot) {
    try {
      resultArtifact = await writeMonetizationAskResult({
        workspaceRoot,
        state: stateAfter,
        fs,
        now,
      });
      evidenceRef = buildMonetizationAskEvidenceRef({
        artifactPath: resultArtifact.path,
        state: stateAfter,
      });
    } catch (error) {
      // Never break the chat run on a disk failure — surface the error to the
      // caller so telemetry can capture it, but keep state advancement.
      resultArtifact = { path: null, body: null, error };
    }
  }

  return {
    stateBefore,
    stateAfter,
    advanced,
    isTerminal,
    pushback: evaluation.pushback ?? null,
    evaluation: evaluation.evaluation ?? null,
    reason: evaluation.reason ?? null,
    resultArtifact,
    evidenceRef,
  };
}

/**
 * Build the evidence_ref entry pointing at the rendered monetization-ask
 * artifact. The shape matches `sanitizeEvidenceRefs` in foundation-chat.mjs
 * so the value round-trips through `persistEvidenceRefsSidecar` without loss.
 */
export function buildMonetizationAskEvidenceRef({ artifactPath, state }) {
  if (!artifactPath || typeof artifactPath !== "string") return null;
  const aggregate = state?.capturesAggregate || {};
  const classification =
    typeof aggregate.response_classification === "string"
      ? aggregate.response_classification.trim().toLowerCase()
      : null;
  const paymentExecuted =
    typeof aggregate.payment_executed === "boolean"
      ? aggregate.payment_executed
      : null;

  return {
    file: artifactPath,
    location: path.basename(artifactPath),
    field_used: "monetization-ask-result",
    extracted_value: {
      classification,
      payment_executed: paymentExecuted,
      target_name: aggregate.target_name ?? null,
      completed_at: state?.completedAt ?? null,
    },
    ref_type: MONETIZATION_ASK_EVIDENCE_REF_TYPE,
  };
}

/* ──────────────────── re-exports for callers that only import this ──────────────────── */

export {
  MONETIZATION_ASK_META,
  MONETIZATION_ASK_RUNTIME_KEY,
};

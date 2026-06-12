/**
 * Proof-ledger write-through for action evidence verdicts (spec §15.1, §9.2).
 *
 * Terminal verification outcomes (auto-verification pass, LLM judge
 * accepted/insufficient) are persisted as proof-ledger `action_evidence`
 * events so gate evaluation survives app restarts. The in-memory
 * verification state machine (`action-day-verification-state.mjs`) is left
 * untouched — only the terminal result is written through (spec §14.2).
 *
 * Non-terminal outcomes are never written (fail-closed):
 * - judge `error` stays pending (spec §21: 보류, not a verdict)
 * - auto-verification failure only opens the evidence-submission fallback
 */

import {
  PROOF_EVENT_TYPES,
  appendProofLedgerEvent,
} from "./execution-os.mjs";

export const PROOF_WRITE_THROUGH_SCHEMA_VERSION = 1;

export const PROOF_VERIFIED_BY = Object.freeze({
  auto: "auto",
  judge: "judge",
});

const HIGH_TRUST_FILE_PATTERN = /transcript|recording|녹취|녹음/i;
const HIGH_TRUST_ACTION_TYPE_PATTERN = /interview_recording|transcript|recording/i;

/**
 * Trust tier for judge-accepted evidence (spec §9.2):
 * accepted + kind ∈ High list → strong; otherwise medium.
 * Only mechanically certain High kinds (interview recording/transcript
 * files, §9.1) are promoted — everything else stays medium (fail-closed).
 */
export function classifyJudgedEvidenceStrength({ evidence = {}, guideline = {} } = {}) {
  const evidenceType = normalizeEvidenceType(evidence?.type);
  const actionType = String(guideline?.actionType ?? guideline?.action_type ?? "");
  const content = String(evidence?.content ?? "");
  if (
    evidenceType === "file"
    && (HIGH_TRUST_ACTION_TYPE_PATTERN.test(actionType) || HIGH_TRUST_FILE_PATTERN.test(content))
  ) {
    return "strong";
  }
  return "medium";
}

/**
 * Builds the proof event for a terminal judge verdict, or null when the
 * verdict is non-terminal (judge error → hold, spec §21).
 */
export function buildJudgeWriteThroughEvent({
  day = null,
  actionId = "",
  judgment = {},
  evidence = {},
  guideline = {},
  now = new Date(),
} = {}) {
  const status = String(judgment?.status ?? "");
  if (status !== "accepted" && status !== "insufficient") return null;
  const strength = status === "accepted"
    ? classifyJudgedEvidenceStrength({ evidence, guideline })
    : "weak";
  return buildActionEvidenceEvent({
    day,
    actionId,
    evidence,
    status,
    strength,
    verifiedBy: PROOF_VERIFIED_BY.judge,
    judgeConfidence: clampRatio(judgment?.confidence),
    summary: judgment?.agentAssessment ?? judgment?.agent_assessment ?? "",
    missingElements: judgment?.missingElements ?? judgment?.missing_elements,
    now,
  });
}

/**
 * Builds the proof event for a passed auto-verification, or null when the
 * verification did not pass (failure is not a terminal verdict — the
 * evidence-submission fallback follows).
 */
export function buildAutoVerificationWriteThroughEvent({
  day = null,
  actionId = "",
  verificationState = {},
  evidence = {},
  now = new Date(),
} = {}) {
  if (verificationState?.status !== "passed") return null;
  const result = verificationState?.verificationResult ?? {};
  return buildActionEvidenceEvent({
    day: day ?? verificationState?.dayId ?? null,
    actionId: actionId || verificationState?.actionId || "",
    evidence: evidence && Object.keys(evidence).length
      ? evidence
      : verificationState?.evidenceSubmission ?? {},
    status: "verified",
    strength: "strong",
    verifiedBy: PROOF_VERIFIED_BY.auto,
    verificationMethod: result?.method ?? "",
    judgeConfidence: clampRatio(result?.confidence),
    summary: result?.agentAssessment ?? "",
    now,
  });
}

/**
 * Persists a terminal verification outcome to the proof ledger.
 * Returns { ledger, event } on write, or null when the outcome is
 * non-terminal (nothing is recorded).
 */
export async function recordActionEvidenceOutcome({
  workspaceRoot,
  day = null,
  actionId = "",
  judgment = null,
  verificationState = null,
  evidence = {},
  guideline = {},
  now = new Date(),
  append = appendProofLedgerEvent,
} = {}) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error("recordActionEvidenceOutcome requires workspaceRoot.");
  }
  const event = judgment
    ? buildJudgeWriteThroughEvent({ day, actionId, judgment, evidence, guideline, now })
    : buildAutoVerificationWriteThroughEvent({ day, actionId, verificationState, evidence, now });
  if (!event) return null;
  return append({ workspaceRoot, event, now });
}

function buildActionEvidenceEvent({
  day,
  actionId,
  evidence,
  status,
  strength,
  verifiedBy,
  verificationMethod = "",
  judgeConfidence = null,
  summary = "",
  missingElements = undefined,
  now,
}) {
  const evidenceType = normalizeEvidenceType(evidence?.type);
  const content = String(evidence?.content ?? "").trim();
  const metadata = {
    verifiedBy,
    verified_by: verifiedBy,
    writeThroughSchemaVersion: PROOF_WRITE_THROUGH_SCHEMA_VERSION,
  };
  if (verificationMethod) metadata.verificationMethod = verificationMethod;
  if (judgeConfidence !== null) metadata.judgeConfidence = judgeConfidence;
  if (Array.isArray(missingElements) && missingElements.length) {
    metadata.missingElements = missingElements.slice(0, 20);
  }
  return {
    type: PROOF_EVENT_TYPES.actionEvidence,
    day,
    actionId,
    status,
    strength,
    evidenceType,
    sourceUrl: evidenceType === "link" ? content : "",
    artifactPath: evidenceType === "file" ? content : "",
    summary,
    source: verifiedBy === PROOF_VERIFIED_BY.auto
      ? `auto:${verificationMethod || "unknown"}`
      : "judge",
    createdAt: toIso(now),
    metadata,
  };
}

function normalizeEvidenceType(value) {
  const token = String(value ?? "").trim().toLowerCase();
  if (token === "file" || token === "file_upload") return "file";
  if (token === "link" || token === "url") return "link";
  return "";
}

function clampRatio(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  return Math.min(1, Math.max(0, number));
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

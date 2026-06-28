export const RECORDER_NEXT_ACTION_SCHEMA_VERSION = 1;

const RECORDER_NEXT_ACTION_SCHEMA = "agentic30.recorder.next_action.v1";
const RAW_FIELD_NAMES = new Set([
  "accessibility_text",
  "accessibilityText",
  "ocr_text",
  "ocrText",
  "browser_url",
  "browserUrl",
  "document_path",
  "documentPath",
  "snapshot_path",
  "snapshotPath",
  "relative_path",
  "relativePath",
]);

export class RecorderNextActionError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "RecorderNextActionError";
    this.code = code;
    this.details = details;
  }
}

export function buildRecorderNextAction({
  review,
  evidenceBuildResult = null,
  now = new Date(),
} = {}) {
  if (!review || typeof review !== "object" || Array.isArray(review)) {
    fail("ERR_RECORDER_NEXT_ACTION_REVIEW_REQUIRED", "buildRecorderNextAction requires a Day Memory Review object");
  }
  assertNoUnsafeRawKeys(review);
  if (evidenceBuildResult) assertNoUnsafeRawKeys(evidenceBuildResult);

  const generatedAt = toIso(now);
  const action = chooseNextAction({
    review,
    evidenceBuildResult: evidenceBuildResult && typeof evidenceBuildResult === "object"
      ? evidenceBuildResult
      : {},
  });

  return {
    schema: RECORDER_NEXT_ACTION_SCHEMA,
    schemaVersion: RECORDER_NEXT_ACTION_SCHEMA_VERSION,
    schema_version: RECORDER_NEXT_ACTION_SCHEMA_VERSION,
    generatedAt,
    generated_at: generatedAt,
    sourceReview: {
      generatedAt: textOrNull(review.generatedAt ?? review.generated_at),
      generated_at: textOrNull(review.generatedAt ?? review.generated_at),
      timeRange: review.timeRange ?? null,
      time_range: review.time_range ?? null,
    },
    source_review: {
      generated_at: textOrNull(review.generatedAt ?? review.generated_at),
      time_range: review.time_range ?? null,
    },
    action,
    proofBoundary: {
      proofAcceptedByNextAction: false,
      proof_accepted_by_next_action: false,
      message: "Recorder next actions are planning decisions. They do not advance proof without verifier-gated proof-ledger writes.",
    },
    proof_boundary: {
      proof_accepted_by_next_action: false,
      message: "Recorder next actions are planning decisions. They do not advance proof without verifier-gated proof-ledger writes.",
    },
  };
}

function chooseNextAction({ review, evidenceBuildResult }) {
  const emptyStateIds = new Set(readArray(review.emptyStates ?? review.empty_states).map((state) => cleanToken(state.id)));
  const warnings = readArray(review.warnings);
  const evidenceInbox = objectOrEmpty(review.evidenceInbox ?? review.evidence_inbox);
  const counts = objectOrEmpty(evidenceInbox.countsByStatus ?? evidenceInbox.counts_by_status);
  const reviewCandidates = readArray(evidenceInbox.candidates);
  const builtCandidates = readArray(evidenceBuildResult.created);
  const candidates = [...builtCandidates, ...reviewCandidates];
  const firstDegraded = firstCandidate(candidates, "degraded");
  const firstVerifierRejected = firstCandidate(candidates, "verifier_rejected");
  const firstPending = firstCandidate(candidates, "pending_review") || firstCandidate(candidates, "approved_bundle");
  const productTotal = numberValue(review.productEvents?.total ?? review.product_events?.total);
  const frameCount = numberValue(review.capture?.frameCount ?? review.capture?.frame_count);
  const writtenToLedgerCount = numberValue(
    evidenceInbox.writtenToLedgerCount
      ?? evidenceInbox.written_to_ledger_count
      ?? counts.written_to_ledger,
  );

  if (emptyStateIds.has("no_capture") || review.status?.state === "empty") {
    return action({
      id: "fix_recorder_capture",
      actionType: "resolve_recorder_health",
      priority: "blocker",
      title: "Fix recorder capture root cause",
      instruction: `Open recorder health and resolve: ${cleanText(review.status?.reason || "no_capture_rows", 180)}.`,
      reason: "Day Memory Review has no capture rows, so Evidence Inbox cannot produce useful candidates.",
      preferredBy: "resolve a blocker with an explicit root cause",
      sourceIds: ["day_memory_review:no_capture"],
    });
  }

  if (firstDegraded) {
    return candidateAction({
      candidate: firstDegraded,
      id: "repair_degraded_evidence_candidate",
      actionType: "repair_evidence_source",
      priority: "high",
      title: "Repair degraded Evidence Inbox candidate",
      instruction: "Attach or restore source identity before review; do not approve this candidate until its external artifact is explicit.",
      reason: "A degraded candidate exists, which is stale proof debt and cannot be verifier-approved as-is.",
      preferredBy: "close stale proof debt",
    });
  }

  if (firstVerifierRejected) {
    return candidateAction({
      candidate: firstVerifierRejected,
      id: "resolve_verifier_rejected_candidate",
      actionType: "attach_external_evidence",
      priority: "high",
      title: "Resolve verifier-rejected evidence",
      instruction: "Attach accepted external evidence or reject the candidate with the recorded verifier root cause.",
      reason: "A verifier-rejected candidate is unresolved proof debt.",
      preferredBy: "close stale proof debt",
    });
  }

  if (firstPending) {
    return candidateAction({
      candidate: firstPending,
      id: "review_pending_evidence_candidate",
      actionType: "review_evidence_inbox",
      priority: "high",
      title: "Review one Evidence Inbox candidate",
      instruction: "Open the Evidence Inbox, inspect one candidate, and either attach external evidence or reject it with a root cause.",
      reason: "Unverified candidates exist; they must be reviewed before any proof-ledger progress is possible.",
      preferredBy: "attach accepted evidence",
    });
  }

  if (emptyStateIds.has("capture_but_no_product_signal") || (frameCount > 0 && productTotal === 0)) {
    return action({
      id: "ask_office_hours_narrowing_question",
      actionType: "ask_narrowing_question",
      priority: "medium",
      title: "Ask one Office Hours narrowing question",
      instruction: "Ask one short question that names the user, customer, or activation signal missing from today's captured work.",
      reason: "Capture exists, but no product signal was derived for Evidence Inbox.",
      preferredBy: "ask one named customer",
      sourceIds: ["day_memory_review:capture_but_no_product_signal"],
    });
  }

  if (!writtenToLedgerCount) {
    return action({
      id: "ask_one_named_customer",
      actionType: "external_customer_action",
      priority: "medium",
      title: "Ask one named customer for evidence",
      instruction: "Pick one named customer or candidate and ask for one concrete reply, activation attempt, or payment/contract artifact.",
      reason: "No recorder evidence has been accepted into the proof ledger.",
      preferredBy: "ask one named customer",
      sourceIds: ["day_memory_review:no_accepted_proof"],
    });
  }

  const warning = warnings[0];
  if (warning) {
    return action({
      id: `resolve_${cleanToken(warning.id) || "recorder_warning"}`,
      actionType: "resolve_recorder_warning",
      priority: cleanToken(warning.severity) === "warning" ? "medium" : "low",
      title: cleanText(warning.message || "Resolve recorder warning", 120),
      instruction: cleanText(warning.message || "Resolve the recorder warning and rerun Day Memory Review.", 300),
      reason: "Recorder warning remains after proof progress.",
      preferredBy: "resolve a blocker with an explicit root cause",
      sourceIds: [`day_memory_review:${cleanToken(warning.id) || "warning"}`],
    });
  }

  return action({
    id: "choose_next_external_action",
    actionType: "external_customer_action",
    priority: "low",
    title: "Choose one next external action",
    instruction: "Use Office Hours to choose one narrow customer-facing action for the next work session.",
    reason: "No urgent recorder evidence debt is unresolved.",
    preferredBy: "ask one named customer",
    sourceIds: ["day_memory_review:ready"],
  });
}

function candidateAction({
  candidate,
  id,
  actionType,
  priority,
  title,
  instruction,
  reason,
  preferredBy,
}) {
  const candidateId = cleanText(candidate.id, 240);
  const evidenceDebt = parseMaybeJson(candidate.evidence_debt_json ?? candidate.evidenceDebt ?? candidate.evidence_debt, []);
  const sourceIds = parseMaybeJson(candidate.source_ids_json ?? candidate.sourceIds ?? candidate.source_ids, []);
  const candidateSummary = {
    id: candidateId,
    candidateStatus: cleanText(candidate.candidate_status ?? candidate.candidateStatus, 120),
    candidate_status: cleanText(candidate.candidate_status ?? candidate.candidateStatus, 120),
    claim: cleanText(candidate.claim, 360),
    proofKind: cleanText(candidate.proof_kind ?? candidate.proofKind, 120),
    proof_kind: cleanText(candidate.proof_kind ?? candidate.proofKind, 120),
    evidenceDebt: readArray(evidenceDebt).map((item) => cleanText(item, 240)).filter(Boolean).slice(0, 6),
    evidence_debt: readArray(evidenceDebt).map((item) => cleanText(item, 240)).filter(Boolean).slice(0, 6),
  };
  return action({
    id,
    actionType,
    priority,
    title,
    instruction,
    reason,
    preferredBy,
    sourceIds: readArray(sourceIds).map((item) => sourceId(item)).filter(Boolean).slice(0, 12),
    targetCandidate: candidateSummary,
  });
}

function action({
  id,
  actionType,
  priority,
  title,
  instruction,
  reason,
  preferredBy,
  sourceIds,
  targetCandidate = null,
}) {
  const output = {
    id,
    actionType,
    action_type: actionType,
    priority,
    title,
    instruction,
    reason,
    preferredBy,
    preferred_by: preferredBy,
    sourceIds: readArray(sourceIds).map((item) => cleanText(item, 240)).filter(Boolean),
    source_ids: readArray(sourceIds).map((item) => cleanText(item, 240)).filter(Boolean),
    proofEffect: "none",
    proof_effect: "none",
  };
  if (targetCandidate) {
    output.targetCandidate = targetCandidate;
    output.target_candidate = targetCandidate;
  }
  return output;
}

function firstCandidate(candidates, status) {
  return candidates.find((candidate) =>
    cleanToken(candidate?.candidate_status ?? candidate?.candidateStatus) === status);
}

function assertNoUnsafeRawKeys(value, pathSegments = []) {
  if (!value || typeof value !== "object") return;
  if (Array.isArray(value)) {
    value.forEach((item, index) => assertNoUnsafeRawKeys(item, [...pathSegments, String(index)]));
    return;
  }
  for (const [key, nested] of Object.entries(value)) {
    if (RAW_FIELD_NAMES.has(key)) {
      fail("ERR_RECORDER_NEXT_ACTION_RAW_FIELD", "Recorder next action input includes an unsafe raw field", {
        fieldPath: [...pathSegments, key].join("."),
        field_path: [...pathSegments, key].join("."),
      });
    }
    assertNoUnsafeRawKeys(nested, [...pathSegments, key]);
  }
}

function sourceId(value) {
  if (typeof value === "string") return cleanText(value, 240);
  if (value && typeof value === "object" && !Array.isArray(value)) {
    return cleanText(value.id ?? value.sourceId ?? value.source_id, 240);
  }
  return "";
}

function parseMaybeJson(value, fallback) {
  if (Array.isArray(value)) return value;
  if (value && typeof value === "object") return value;
  try {
    return JSON.parse(String(value || ""));
  } catch {
    return fallback;
  }
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function readArray(value) {
  return Array.isArray(value) ? value : [];
}

function numberValue(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : 0;
}

function textOrNull(value) {
  const text = cleanText(value, 500);
  return text || null;
}

function cleanText(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanToken(value = "") {
  return cleanText(value, 120).toLowerCase().replace(/[^a-z0-9가-힣]+/g, "_").replace(/^_+|_+$/g, "");
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value ?? Date.now());
  if (Number.isNaN(date.getTime())) {
    fail("ERR_RECORDER_NEXT_ACTION_INVALID_TIMESTAMP", "Recorder next action timestamp must be valid ISO-compatible input", {
      value,
    });
  }
  return date.toISOString();
}

function fail(code, message, details = {}) {
  throw new RecorderNextActionError(code, message, details);
}

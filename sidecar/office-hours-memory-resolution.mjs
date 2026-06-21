import { createHash } from "node:crypto";
export const OFFICE_HOURS_RESOLUTION_REASONS = Object.freeze(["not_sent", "message_not_ready", "channel_blocked", "wrong_candidate", "candidate_exhausted", "replaced_by_next_candidate"]);

const RESOLUTION_REASONS = new Set(OFFICE_HOURS_RESOLUTION_REASONS);
const DEFAULT_EVIDENCE_KINDS = new Set(["url", "screenshot", "commit", "payment"]);
const UNRESOLVED_STATUSES = new Set(["open", "missed", "carried_forward"]);
export function normalizeResolutionReason(value) {
  const reason = cleanToken(value);
  return RESOLUTION_REASONS.has(reason) ? reason : "";
}
export function normalizeCommitmentResolution(value = {}, { now = new Date(), maxFieldChars = 500 } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const reason = normalizeResolutionReason(value.reason);
  if (!reason) return null;
  return {
    reason,
    source: cleanToken(value.source) || "self_report",
    note: cleanString(value.note, maxFieldChars),
    resolvedAt: normalizeIsoDate(value.resolvedAt ?? value.resolved_at, now),
    countsAsCustomerEvidence: value.countsAsCustomerEvidence === true || value.counts_as_customer_evidence === true,
  };
}

export function normalizeReplacementCommitmentDraft(nextCommitment = {}, options = {}) {
  const { cycle, day, now = new Date(), makeId, maxCycleLedger = 90, maxFieldChars = 500, evidenceKinds = DEFAULT_EVIDENCE_KINDS } = options;
  if (!nextCommitment || typeof nextCommitment !== "object" || Array.isArray(nextCommitment)) return null;
  if (typeof makeId !== "function") throw new Error("normalizeReplacementCommitmentDraft requires makeId.");
  const requiredCandidateName = cleanString(nextCommitment.candidateName ?? nextCommitment.candidate_name, maxFieldChars);
  const requiredActionKind = cleanToken(nextCommitment.actionKind ?? nextCommitment.action_kind);
  const requiredActionText = cleanString(nextCommitment.actionText ?? nextCommitment.action_text, maxFieldChars);
  if (!requiredCandidateName || !requiredActionKind || !requiredActionText) return null;
  const cycleNo = clampInt(cycle, 1, maxCycleLedger * 4, null)
    ?? clampInt(nextCommitment.cycle, 1, maxCycleLedger * 4, null)
    ?? 1;
  const createdDay = clampInt(day, 1, 400, null)
    ?? clampInt(nextCommitment.createdDay ?? nextCommitment.day, 1, 400, null)
    ?? cycleNo;
  const structured = normalizeCommitmentFields(nextCommitment, { fallbackDueDay: createdDay + 1, maxFieldChars, evidenceKinds });
  if (structured.hasExplicitStructuredDraft && structured.confirmedByUser !== true) {
    throw new Error("resolveCommitmentWithoutEvidence: replacement commitment must be confirmed by the user.");
  }
  const text = cleanString(nextCommitment.text ?? structured.actionText ?? structured.message, maxFieldChars);
  if (!text) return null;
  return {
    id: makeId("cm", cycleNo, text, now),
    cycle: cycleNo,
    createdDay,
    createdAt: now.toISOString(),
    text,
    status: "open",
    evidence: null,
    origin: "user",
    customer: structured.customer,
    channel: structured.channel,
    message: structured.message,
    expectedEvidenceKind: structured.expectedEvidenceKind,
    dueDay: structured.dueDay,
    confirmedByUser: structured.confirmedByUser,
    candidateName: structured.candidateName,
    actionKind: structured.actionKind,
    actionText: structured.actionText || text,
    repeatCountWithoutEvidence: 0,
    resolution: null,
  };
}

export function classifyStaleCommitments(
  memory,
  { currentDay, maxCommitments = 60, maxFieldChars = 500, activeDebtStatuses = new Set(["open", "missed"]) } = {},
) {
  const commitments = Array.isArray(memory?.commitments) ? memory.commitments : [];
  const activeIds = new Set(activeDebtCommitments(commitments, { activeDebtStatuses, maxFieldChars }).map((c) => c.id));
  const unresolved = commitments.filter((commitment) =>
    commitment
      && !commitment.evidence
      && UNRESOLVED_STATUSES.has(commitment.status || "open")
      && staleCommitmentIdentityKey(commitment, { maxFieldChars }),
  );
  const groups = new Map();
  for (const commitment of unresolved) {
    const key = staleCommitmentIdentityKey(commitment, { maxFieldChars });
    const group = groups.get(key) ?? [];
    group.push(commitment);
    groups.set(key, group);
  }
  const day = clampInt(currentDay, 1, 400, null);
  return [...groups.values()]
    .filter((group) => group.length >= 2)
    .map((group) => staleCandidateFromGroup(group, { activeIds, day, maxCommitments, maxFieldChars }))
    .filter((candidate) => candidate.activeDebt)
    .sort((a, b) => b.repeatCountWithoutEvidence - a.repeatCountWithoutEvidence
      || commitmentCreatedMs(b.commitment) - commitmentCreatedMs(a.commitment));
}

export function countRepeatCommitmentsWithoutEvidence(commitments = [], target = {}, { maxFieldChars = 500 } = {}) {
  const key = staleCommitmentIdentityKey(target, { maxFieldChars });
  if (!key) return target?.evidence ? 0 : 1;
  return toArray(commitments).filter((commitment) =>
    commitment
      && !commitment.evidence
      && UNRESOLVED_STATUSES.has(commitment.status || "open")
      && staleCommitmentIdentityKey(commitment, { maxFieldChars }) === key,
  ).length;
}

function staleCandidateFromGroup(group, { activeIds, day, maxCommitments, maxFieldChars }) {
  const sorted = [...group].sort((a, b) =>
    commitmentCreatedMs(b) - commitmentCreatedMs(a)
    || commitmentDay(b) - commitmentDay(a)
    || String(b.id || "").localeCompare(String(a.id || "")),
  );
  const active = sorted.find((commitment) => activeIds.has(commitment.id)) ?? sorted[0];
  const repeatCount = group.length;
  const candidateName = cleanString(active.candidateName, maxFieldChars);
  const actionKind = cleanToken(active.actionKind);
  const actionText = cleanString(active.actionText || active.message || active.text, maxFieldChars);
  const risks = [];
  if (!candidateName) risks.push("candidateNameMissing");
  if (!actionKind) risks.push("actionKindMissing");
  if (!actionText) risks.push("actionTextMissing");
  return {
    commitmentId: active.id,
    commitment: {
      ...active,
      repeatCountWithoutEvidence: Math.max(
        clampInt(active.repeatCountWithoutEvidence, 0, maxCommitments, 0),
        repeatCount,
      ),
    },
    candidateName,
    actionKind,
    actionText,
    actionTextHash: normalizedActionTextHash(active, { maxFieldChars }),
    expectedEvidenceKind: cleanToken(active.expectedEvidenceKind),
    repeatCountWithoutEvidence: repeatCount,
    activeDebt: activeIds.has(active.id),
    dueDay: clampInt(active.dueDay, 1, 400, null),
    currentDay: day,
    risks,
  };
}

function activeDebtCommitments(commitments = [], { activeDebtStatuses, maxFieldChars }) {
  const active = toArray(commitments).filter((commitment) => isUnprovenDebt(commitment, activeDebtStatuses));
  return active.filter((commitment) => {
    if (commitment.status !== "missed") return true;
    return !active.some((candidate) =>
      candidate.id !== commitment.id
        && candidate.status === "open"
        && isSameCommitmentAction(candidate, commitment, { maxFieldChars })
        && (
          candidate.sourceCommitmentId === commitment.id
          || candidate.id === commitment.carriedForwardTo
          || commitmentDay(candidate) >= commitmentDay(commitment)
        )
        && commitmentCreatedMs(candidate) >= commitmentCreatedMs(commitment)
    );
  });
}

function normalizeCommitmentFields(value = {}, { fallbackDueDay = null, maxFieldChars, evidenceKinds } = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const expected = cleanToken(input.expectedEvidenceKind ?? input.expected_evidence_kind);
  const customer = cleanString(input.customer, maxFieldChars);
  const message = cleanString(input.message, maxFieldChars);
  const rawActionText = input.actionText ?? input.action_text;
  const structuredKeys = ["customer", "channel", "message", "expectedEvidenceKind", "expected_evidence_kind", "dueDay", "due_day", "confirmedByUser", "confirmed_by_user", "candidateName", "candidate_name", "actionKind", "action_kind", "actionText", "action_text"];
  const rawConfirmed = input.confirmedByUser ?? input.confirmed_by_user;
  return {
    customer,
    channel: cleanString(input.channel, 80),
    message,
    expectedEvidenceKind: evidenceKinds.has(expected) ? expected : "",
    dueDay: clampInt(input.dueDay ?? input.due_day, 1, 400, fallbackDueDay),
    confirmedByUser: rawConfirmed === undefined ? true : rawConfirmed === true,
    candidateName: cleanString(input.candidateName ?? input.candidate_name ?? customer, maxFieldChars),
    actionKind: cleanToken(input.actionKind ?? input.action_kind),
    actionText: cleanString(rawActionText !== undefined ? rawActionText : (message || input.text), maxFieldChars),
    hasExplicitStructuredDraft: structuredKeys.some((key) => Object.prototype.hasOwnProperty.call(input, key)),
  };
}

function isUnprovenDebt(commitment = {}, activeDebtStatuses) {
  return commitment && typeof commitment === "object" && !Array.isArray(commitment)
    && !commitment.evidence
    && activeDebtStatuses.has(commitment.status || "open");
}

function isSameCommitmentAction(left = {}, right = {}, options = {}) {
  return commitmentIdentityKey(left, options) === commitmentIdentityKey(right, options);
}

function commitmentIdentityKey(commitment = {}, { maxFieldChars = 500 } = {}) {
  const customer = cleanString(commitment.customer, maxFieldChars).toLowerCase();
  const channel = cleanString(commitment.channel, 80).toLowerCase();
  const message = cleanString(commitment.message || commitment.text, maxFieldChars).toLowerCase();
  const text = cleanString(commitment.text, maxFieldChars).toLowerCase();
  const expected = cleanToken(commitment.expectedEvidenceKind);
  return customer || channel || message
    ? ["structured", customer, channel, message, expected].join("|")
    : ["text", text, expected].join("|");
}

function staleCommitmentIdentityKey(commitment = {}, { maxFieldChars = 500 } = {}) {
  const candidateName = cleanString(commitment.candidateName, maxFieldChars).toLowerCase();
  const actionKind = cleanToken(commitment.actionKind);
  const actionTextHash = normalizedActionTextHash(commitment, { maxFieldChars });
  const expected = cleanToken(commitment.expectedEvidenceKind);
  return actionTextHash || actionKind || expected ? ["stale", candidateName, actionKind, actionTextHash, expected].join("|") : "";
}

function normalizedActionTextHash(commitment = {}, { maxFieldChars = 500 } = {}) {
  const text = cleanString(commitment.actionText || commitment.message || commitment.text, maxFieldChars).toLowerCase();
  return text ? createHash("sha256").update(text).digest("hex").slice(0, 12) : "";
}

function commitmentDay(commitment = {}) {
  return clampInt(commitment.createdDay ?? commitment.day ?? commitment.cycle, 1, 400, null);
}

function commitmentCreatedMs(commitment = {}) {
  const timestamp = Date.parse(String(commitment.createdAt || ""));
  return Number.isFinite(timestamp) ? timestamp : 0;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanToken(value = "") {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
}

function clampInt(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function normalizeIsoDate(value, fallbackDate) {
  const timestamp = Date.parse(String(value || ""));
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : fallbackDate.toISOString();
}

// Declarative Office Hours lifecycle contract — the single source of truth for
// the get_users validation lifecycle that today is scattered across
// office-hours-chat-prompt.mjs (slot policy), office-hours-structured-input.mjs
// (order/alias/intent parsing), office-hours-evidence-state.mjs (hard evidence),
// daily-office-hours-digest.mjs (Day2 briefing) and index.mjs (orchestration).
//
// Per the GPT-5.5 Pro fundamental review: the recurring bugs (duplicate cards,
// stage drift, document-readiness infinite loop, ICP leak, out-of-order slots)
// are not prompt bugs — they are the failure mode of letting the LLM choose state
// while the host re-normalizes strings after the fact. The fix is to make the
// "plan → schedule → act → external reaction → evidence" lifecycle ONE typed
// domain object (ValidationAttempt) advanced by a pure reducer, with the LLM
// owning only the visible copy of each card.
//
// R0 hardening (this file): the reducer is upgraded from prototype to runtime
// authority. plan ≠ action, contract ≠ proof. The six interview slots map 1:1 to
// six cards. Transition-level `requires` + `allowedFields` are enforced so a card
// validator bypass cannot move state. event.eventId gives idempotency. There is no
// legacy turn-log migration path: every attempt starts fresh at needs_definition
// (owner directive — no legacy, no backward-compat, fail explicitly).
//
// This module is PURE: no I/O, standard library only, no feature flags, no
// fallbacks. Illegal input is an explicit throw. Callers (index.mjs) adopt it in
// R1; existing signalIds remain valid via LEGACY_SIGNAL_ALIASES.

export const OFFICE_HOURS_CONTRACT_SCHEMA_VERSION = 2;

// ── States ───────────────────────────────────────────────────────────────────
// ACTIVE (gather) = needs_definition .. needs_commitment — six interview slots.
// WAIT = execution_scheduled, awaiting_customer_outcome, outcome_observed.
//   execution_scheduled  → plan complete, action NOT yet performed (R2 fork point)
//   awaiting_customer_outcome → action proof recorded
//   outcome_observed     → customer outcome recorded
// TERMINAL = succeeded | failed.
// SUSPENDED = blocked | carried (NOT resolved; resumeState preserved).
export const VALIDATION_ATTEMPT_STATES = Object.freeze([
  "needs_definition",
  "needs_candidate",
  "needs_alternative",
  "needs_action_contract",
  "needs_evidence_contract",
  "needs_commitment",
  "execution_scheduled",
  "awaiting_customer_outcome",
  "outcome_observed",
  "succeeded",
  "failed",
  "blocked",
  "carried",
]);

// Six ACTIVE gather states (the interview), in ladder order.
export const VALIDATION_ATTEMPT_ACTIVE_STATES = Object.freeze([
  "needs_definition",
  "needs_candidate",
  "needs_alternative",
  "needs_action_contract",
  "needs_evidence_contract",
  "needs_commitment",
]);
const ACTIVE_STATES = Object.freeze(new Set(VALIDATION_ATTEMPT_ACTIVE_STATES));

// WAIT states: plan complete, evidence accumulating, not yet terminal.
export const VALIDATION_ATTEMPT_WAIT_STATES = Object.freeze(new Set([
  "execution_scheduled",
  "awaiting_customer_outcome",
  "outcome_observed",
]));

export const VALIDATION_ATTEMPT_TERMINAL_STATES = Object.freeze(new Set(["succeeded", "failed"]));
export const VALIDATION_ATTEMPT_SUSPENDED_STATES = Object.freeze(new Set(["blocked", "carried"]));

// GPT 6.8: RESOLVED = TERMINAL only. A suspended (blocked/carried) attempt is NOT
// resolved — it must be resumed or abandoned before a new attempt may start.
export const VALIDATION_ATTEMPT_RESOLVED_STATES = VALIDATION_ATTEMPT_TERMINAL_STATES;

// ── Evidence grades ──────────────────────────────────────────────────────────
// The review's core distinction: an outbound DM screenshot proves OUTREACH
// (action), not ACTIVATION (goal). Grading evidence by kind — instead of by
// interview length — is what fixes the evidence_use ceiling.
export const EVIDENCE_GRADES = Object.freeze(["action_proof", "customer_outcome", "goal_proof"]);

export const EVIDENCE_KIND_GRADE = Object.freeze({
  // action_proof: founder did the external action
  dm_sent_screenshot: "action_proof",
  email_sent: "action_proof",
  call_logged: "action_proof",
  shared_url: "action_proof",
  message_log: "action_proof",
  // customer_outcome: the candidate reacted
  customer_reply: "customer_outcome",
  refusal: "customer_outcome",
  no_response_deadline_passed: "customer_outcome",
  call_note: "customer_outcome",
  drop_off_step: "customer_outcome",
  // goal_proof: the goal behavior actually happened
  activation_event: "goal_proof",
  core_flow_completed: "goal_proof",
  payment: "goal_proof",
  contract: "goal_proof",
  repeat_use: "goal_proof",
});

// Never accepted as evidence of anything (review: self-report / AI output / draft).
export const REJECTED_EVIDENCE_KINDS = Object.freeze(new Set([
  "self_report", "ai_output", "draft", "demo", "plan", "intent_only",
]));

// Negative-outcome kinds that may legally drive record_negative_outcome → failed
// (GPT 6.7). A bare free-text reason can never fail an attempt.
export const NEGATIVE_OUTCOME_KINDS = Object.freeze(new Set(["refusal", "drop_off_step"]));

// ── Transitions ──────────────────────────────────────────────────────────────
// Each transition declares:
//   from / fromAny / fromActiveOrSuspended — legal source states
//   to              — destination (or "resumeState" sentinel for unblock/resume)
//   requires        — attempt fields that must be present AFTER applying the event
//   allowedFields   — the ONLY field keys the event may carry (allowlist; GPT 6.10)
//   evidenceGrade   — if set, the `evidence` field is graded and the grade is
//                     enforced; the graded record lands in `evidenceSlot`
//   evidenceKinds   — if set, the evidence.kind must be a member (GPT 6.7)
// `requires`/`allowedFields` are enforced HERE, at the transition, so a card
// validator bypass cannot move state (GPT 6.3).
const TRANSITIONS = Object.freeze({
  // ── Six gather transitions (one per interview slot / card) ──────────────────
  define_activation: {
    from: ["needs_definition"], to: "needs_candidate",
    requires: ["activationDefinition"], allowedFields: ["activationDefinition"],
  },
  select_candidate: {
    from: ["needs_candidate"], to: "needs_alternative",
    requires: ["candidate"], allowedFields: ["candidate", "candidateId"],
  },
  record_alternative: {
    from: ["needs_alternative"], to: "needs_action_contract",
    requires: ["currentAlternative"], allowedFields: ["currentAlternative"],
  },
  define_action_contract: {
    from: ["needs_action_contract"], to: "needs_evidence_contract",
    requires: ["externalAction", "attemptThreshold", "successCondition"],
    allowedFields: ["externalAction", "attemptThreshold", "successCondition"],
  },
  define_evidence_contract: {
    from: ["needs_evidence_contract"], to: "needs_commitment",
    requires: ["expectedProofKind", "evidenceLocation"],
    allowedFields: ["expectedProofKind", "evidenceLocation"],
  },
  schedule_execution: {
    from: ["needs_commitment"], to: "execution_scheduled",
    requires: ["dueAt"], allowedFields: ["dueAt", "commitmentNote"],
  },
  // ── Real action / outcome / goal (proof, not plan) ──────────────────────────
  record_action_proof: {
    from: ["execution_scheduled"], to: "awaiting_customer_outcome",
    requires: ["actionProof"], allowedFields: ["evidence"],
    evidenceGrade: "action_proof", evidenceSlot: "actionProof",
  },
  record_customer_outcome: {
    from: ["awaiting_customer_outcome"], to: "outcome_observed",
    requires: ["customerOutcome"], allowedFields: ["evidence"],
    evidenceGrade: "customer_outcome", evidenceSlot: "customerOutcome", // GPT 6.5
  },
  // GPT 6.6: direct goal proof — the candidate paid/activated right after outreach,
  // so the founder can jump straight to succeeded from any WAIT state.
  record_goal_proof: {
    from: ["execution_scheduled", "awaiting_customer_outcome", "outcome_observed"],
    to: "succeeded",
    requires: ["goalProof"], allowedFields: ["evidence"],
    evidenceGrade: "goal_proof", evidenceSlot: "goalProof",
  },
  // GPT 6.7: verified negative outcome — graded customer_outcome AND a refusal/drop_off kind.
  record_negative_outcome: {
    from: ["awaiting_customer_outcome", "outcome_observed"], to: "failed",
    requires: ["negativeOutcome"], allowedFields: ["evidence"],
    evidenceGrade: "customer_outcome", evidenceSlot: "negativeOutcome",
    evidenceKinds: NEGATIVE_OUTCOME_KINDS,
  },
  // Deadline-driven fail. The reducer verifies now >= responseDueAt or throws.
  expire_no_response: {
    from: ["awaiting_customer_outcome"], to: "failed",
    requires: ["responseDueAt"], allowedFields: ["responseDueAt", "now"],
  },
  // User-approved abandon — the only free-text fail path.
  abandon_attempt: {
    fromActiveOrSuspended: true, to: "failed",
    requires: ["abandonReason"], allowedFields: ["abandonReason"],
  },
  // ── Suspend / resume (GPT 6.8) ──────────────────────────────────────────────
  block: {
    fromAny: "active", to: "blocked",
    requires: ["blockerReason", "nextUnblockAction"],
    allowedFields: ["blockerReason", "nextUnblockAction"], savesResumeState: true,
  },
  unblock: {
    from: ["blocked"], to: "resumeState",
    requires: [], allowedFields: [],
  },
  carry: {
    fromAny: "active", to: "carried",
    requires: ["carryReason"], allowedFields: ["carryReason"], savesResumeState: true,
  },
  resume: {
    from: ["carried"], to: "resumeState",
    requires: [], allowedFields: [],
  },
});

export const VALIDATION_ATTEMPT_TRANSITIONS = Object.freeze(Object.keys(TRANSITIONS));

// ── Cards (presentation slots) — 6, 1:1 with the six interview slots (GPT 6.1) ─
// The host decides WHICH card to render from the attempt state; the LLM fills the
// visible question/labels/descriptions only. requiredFields lets a card validator
// reject a card that structurally omits what the slot must capture, but the
// reducer's transition `requires` is the real authority.
const CARDS = Object.freeze({
  activation_definition: {
    forState: "needs_definition",
    transition: "define_activation",
    legacySignalId: "get_users_active_user_definition",
    requiredFields: ["activationDefinition"],
  },
  candidate_selection: {
    forState: "needs_candidate",
    transition: "select_candidate",
    legacySignalId: "get_users_first_candidate",
    requiredFields: ["candidate"],
  },
  current_alternative: {
    forState: "needs_alternative",
    transition: "record_alternative",
    legacySignalId: "get_users_current_alternative",
    requiredFields: ["currentAlternative"],
  },
  action_request: {
    forState: "needs_action_contract",
    transition: "define_action_contract",
    legacySignalId: "get_users_today_request",
    requiredFields: ["externalAction", "attemptThreshold", "successCondition"],
  },
  evidence_contract: {
    forState: "needs_evidence_contract",
    transition: "define_evidence_contract",
    legacySignalId: "get_users_evidence_format",
    requiredFields: ["expectedProofKind", "evidenceLocation"],
  },
  commitment: {
    forState: "needs_commitment",
    transition: "schedule_execution",
    legacySignalId: "get_users_day1_commitment",
    requiredFields: ["dueAt"],
  },
});

export const VALIDATION_ATTEMPT_CARD_TYPES = Object.freeze(Object.keys(CARDS));

// Legacy signalId → canonical card, 1:1 (GPT 6.1). Existing telemetry / older UI
// keep working during the additive migration. The office_hours_ prefix the inline
// path adds is tolerated 1:1 as well.
export const LEGACY_SIGNAL_ALIASES = Object.freeze({
  get_users_active_user_definition: "activation_definition",
  get_users_first_candidate: "candidate_selection",
  get_users_current_alternative: "current_alternative",
  get_users_today_request: "action_request",
  get_users_evidence_format: "evidence_contract",
  get_users_day1_commitment: "commitment",
  // tolerate the office_hours_ prefix the inline path adds
  office_hours_get_users_active_user_definition: "activation_definition",
  office_hours_get_users_first_candidate: "candidate_selection",
  office_hours_get_users_current_alternative: "current_alternative",
  office_hours_get_users_today_request: "action_request",
  office_hours_get_users_evidence_format: "evidence_contract",
  office_hours_get_users_day1_commitment: "commitment",
});

export const OFFICE_HOURS_CONTRACTS = Object.freeze({
  locked_day1_get_users: Object.freeze({
    schemaVersion: OFFICE_HOURS_CONTRACT_SCHEMA_VERSION,
    states: VALIDATION_ATTEMPT_STATES,
    transitions: TRANSITIONS,
    cards: CARDS,
    evidenceKindGrade: EVIDENCE_KIND_GRADE,
    rejectedEvidenceKinds: REJECTED_EVIDENCE_KINDS,
    legacySignalAliases: LEGACY_SIGNAL_ALIASES,
  }),
});

// ── Domain object ────────────────────────────────────────────────────────────
/** Create a fresh ValidationAttempt (pure; caller stamps id/createdAt). */
export function createValidationAttempt({ id = "", goalLane = "get_users", createdAt = "" } = {}) {
  return {
    schemaVersion: OFFICE_HOURS_CONTRACT_SCHEMA_VERSION,
    id: String(id || ""),
    goalLane,
    status: "needs_definition",
    // gather slots
    activationDefinition: "",
    candidate: "",
    candidateId: "",
    currentAlternative: "",
    externalAction: "",
    attemptThreshold: "",
    successCondition: "",
    expectedProofKind: "",
    evidenceLocation: "",
    dueAt: "",
    commitmentNote: "",
    // proof slots
    actionProof: null,
    customerOutcome: null,
    goalProof: null,
    negativeOutcome: null,
    // fail / deadline
    responseDueAt: "",
    abandonReason: "",
    // suspend / resume
    blockerReason: "",
    nextUnblockAction: "",
    carryReason: "",
    resumeState: "",
    // bookkeeping — appliedEvents is authoritative (GPT 6.9); appliedTransitions
    // is a derived convenience kept for telemetry/back-compat.
    appliedTransitions: [],
    appliedEvents: [], // [{ eventId, type, payloadHash }]
    evidence: [],
    createdAt: String(createdAt || ""),
    updatedAt: String(createdAt || ""),
  };
}

// ── Pure reducer ─────────────────────────────────────────────────────────────
export class ValidationAttemptTransitionError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "ValidationAttemptTransitionError";
    this.code = code || "ERR_VALIDATION_ATTEMPT_TRANSITION";
  }
}

/** Stable JSON stringify: object keys sorted recursively so payloadHash is order-independent. Pure. */
export function stableStringify(value) {
  return JSON.stringify(sortValue(value === undefined ? null : value));
}

function sortValue(value) {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const out = {};
    for (const key of Object.keys(value).sort()) out[key] = sortValue(value[key]);
    return out;
  }
  return value;
}

/**
 * Small, pure, dependency-free 53-bit hash of a payload (cyrb53-style), returned
 * as a hex string. Standard library only — no crypto import (keeps the module's
 * import surface empty per the spec). Used for event idempotency, not security.
 */
export function payloadHashOf(payload) {
  const str = stableStringify(payload);
  let h1 = 0xdeadbeef ^ 0;
  let h2 = 0x41c6ce57 ^ 0;
  for (let i = 0; i < str.length; i += 1) {
    const ch = str.charCodeAt(i);
    h1 = Math.imul(h1 ^ ch, 2654435761);
    h2 = Math.imul(h2 ^ ch, 1597334677);
  }
  h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507);
  h1 ^= Math.imul(h2 ^ (h2 >>> 13), 3266489909);
  h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507);
  h2 ^= Math.imul(h1 ^ (h1 >>> 13), 3266489909);
  const n = 4294967296 * (2097151 & h2) + (h1 >>> 0);
  return n.toString(16).padStart(14, "0");
}

function legalFromFor(def, status) {
  if (def.fromAny === "active") return ACTIVE_STATES.has(status);
  if (def.fromActiveOrSuspended) {
    return ACTIVE_STATES.has(status)
      || VALIDATION_ATTEMPT_WAIT_STATES.has(status)
      || VALIDATION_ATTEMPT_SUSPENDED_STATES.has(status);
  }
  return Array.isArray(def.from) && def.from.includes(status);
}

/**
 * Apply an event to an attempt and return the NEXT attempt (immutable). Throws a
 * ValidationAttemptTransitionError for any illegal input. This is the single
 * authority for state — the LLM cannot move state by emitting a card; only a
 * validated event here can.
 *
 * event = { type: <transitionName>, eventId: <string>, fields?: {}, at?: ISOstring }
 *
 * Idempotency (GPT 6.9):
 *   - eventId is REQUIRED → else ERR_EVENT_ID_REQUIRED.
 *   - same eventId + same payloadHash → no-op, returns the unchanged attempt.
 *   - same eventId + different payloadHash → ERR_EVENT_ID_CONFLICT.
 */
export function reduceValidationAttempt(attempt, event = {}) {
  if (!attempt || typeof attempt !== "object") {
    throw new ValidationAttemptTransitionError("attempt is required", "ERR_NO_ATTEMPT");
  }
  const type = String(event?.type || "").trim();
  const def = TRANSITIONS[type];
  if (!def) {
    throw new ValidationAttemptTransitionError(`unknown transition: ${type}`, "ERR_UNKNOWN_TRANSITION");
  }

  // eventId idempotency gate (GPT 6.9) — checked before any state work.
  const eventId = typeof event?.eventId === "string" ? event.eventId.trim() : "";
  if (!eventId) {
    throw new ValidationAttemptTransitionError("event.eventId is required", "ERR_EVENT_ID_REQUIRED");
  }
  const rawFields = event.fields && typeof event.fields === "object" && !Array.isArray(event.fields)
    ? event.fields
    : {};
  const payloadHash = payloadHashOf({ type, fields: rawFields, at: event.at ?? null });
  const applied = Array.isArray(attempt.appliedEvents) ? attempt.appliedEvents : [];
  const prior = applied.find((e) => e && e.eventId === eventId);
  if (prior) {
    if (prior.payloadHash === payloadHash) return attempt; // idempotent replay
    throw new ValidationAttemptTransitionError(
      `event ${eventId} already applied with a different payload`,
      "ERR_EVENT_ID_CONFLICT",
    );
  }

  // Legal-from check.
  if (!legalFromFor(def, attempt.status)) {
    throw new ValidationAttemptTransitionError(
      `transition ${type} not allowed from ${attempt.status}`,
      "ERR_ILLEGAL_FROM",
    );
  }

  // allowedFields allowlist (GPT 6.10) — any unknown key throws.
  const allowed = new Set(def.allowedFields || []);
  for (const key of Object.keys(rawFields)) {
    if (!allowed.has(key)) {
      throw new ValidationAttemptTransitionError(
        `transition ${type} does not allow field: ${key}`,
        "ERR_UNKNOWN_FIELD",
      );
    }
  }

  // Compute the field patch (and classify evidence) for this transition.
  const patch = applyFields(attempt, type, def, rawFields, event);

  const next = { ...attempt, ...patch };

  // Required-field gate (host-enforced; invariants 3 & 4).
  for (const req of def.requires || []) {
    if (isEmptyField(next[req])) {
      throw new ValidationAttemptTransitionError(
        `transition ${type} requires field: ${req}`,
        "ERR_MISSING_REQUIRED_FIELD",
      );
    }
  }

  // Resolve destination, including the resumeState sentinel for unblock/resume.
  let destination = def.to;
  if (destination === "resumeState") {
    const target = String(attempt.resumeState || "").trim();
    if (!target || !VALIDATION_ATTEMPT_STATES.includes(target)) {
      throw new ValidationAttemptTransitionError(
        `cannot resume: no resumeState saved (transition ${type})`,
        "ERR_NO_RESUME_STATE",
      );
    }
    destination = target;
    next.resumeState = "";
  } else if (def.savesResumeState) {
    next.resumeState = attempt.status;
  }

  next.status = destination;
  next.appliedTransitions = [...(attempt.appliedTransitions || []), type];
  next.appliedEvents = [...applied, { eventId, type, payloadHash }];
  if (event.at) next.updatedAt = String(event.at);
  return next;
}

// Map a transition's incoming fields onto the attempt, classifying any evidence.
function applyFields(attempt, type, def, fields, event) {
  const patch = {};

  // Plain (non-evidence) fields: copy through the (already-validated) allowlist.
  for (const [key, value] of Object.entries(fields)) {
    if (key === "evidence") continue; // graded below
    if (key === "now") continue;      // deadline check input, not a stored field
    patch[key] = value;
  }

  // dueAt verification for schedule_execution (GPT R1.b H): the commitment lease
  // must be a parseable timestamp strictly in the FUTURE relative to the event's
  // own `at`. A blank, unparseable, or past dueAt is rejected — we never accept a
  // "due now / due yesterday" lease as a real commitment.
  if (type === "schedule_execution") {
    const dueRaw = String(fields.dueAt || "").trim();
    const dueMs = Date.parse(dueRaw);
    if (!Number.isFinite(dueMs)) {
      throw new ValidationAttemptTransitionError(
        `schedule_execution received an unparseable dueAt: ${dueRaw || "(empty)"}`,
        "ERR_INVALID_DUE_AT",
      );
    }
    const atRaw = event?.at != null ? String(event.at).trim() : "";
    const atMs = Date.parse(atRaw);
    if (!Number.isFinite(atMs)) {
      throw new ValidationAttemptTransitionError(
        "schedule_execution requires a parseable event.at to validate dueAt",
        "ERR_INVALID_DUE_AT",
      );
    }
    if (!(dueMs > atMs)) {
      throw new ValidationAttemptTransitionError(
        `schedule_execution dueAt (${dueRaw}) must be in the future relative to ${atRaw}`,
        "ERR_INVALID_DUE_AT",
      );
    }
  }

  // Deadline verification for expire_no_response (now >= responseDueAt or throw).
  if (type === "expire_no_response") {
    const responseDueAt = String(fields.responseDueAt || "").trim();
    if (!responseDueAt) {
      throw new ValidationAttemptTransitionError(
        "expire_no_response requires responseDueAt",
        "ERR_MISSING_REQUIRED_FIELD",
      );
    }
    const nowRaw = fields.now != null ? fields.now : event?.at;
    const now = nowRaw != null ? String(nowRaw).trim() : "";
    if (!now) {
      throw new ValidationAttemptTransitionError(
        "expire_no_response requires `now` (or event.at) to verify the deadline",
        "ERR_DEADLINE_NOT_REACHED",
      );
    }
    const nowMs = Date.parse(now);
    const dueMs = Date.parse(responseDueAt);
    if (Number.isNaN(nowMs) || Number.isNaN(dueMs)) {
      throw new ValidationAttemptTransitionError(
        "expire_no_response received an unparseable timestamp",
        "ERR_DEADLINE_NOT_REACHED",
      );
    }
    if (nowMs < dueMs) {
      throw new ValidationAttemptTransitionError(
        `deadline not reached: now (${now}) < responseDueAt (${responseDueAt})`,
        "ERR_DEADLINE_NOT_REACHED",
      );
    }
  }

  // Evidence-bearing transitions: grade the record and enforce grade + kind.
  if (def.evidenceGrade) {
    if (!fields.evidence) {
      throw new ValidationAttemptTransitionError(
        `transition ${type} requires an evidence record`,
        "ERR_MISSING_REQUIRED_FIELD",
      );
    }
    const graded = gradeEvidence(fields.evidence);
    if (graded.rejected || graded.grade !== def.evidenceGrade) {
      throw new ValidationAttemptTransitionError(
        `transition ${type} requires ${def.evidenceGrade}-grade evidence`,
        "ERR_WRONG_EVIDENCE_GRADE",
      );
    }
    if (def.evidenceKinds && !def.evidenceKinds.has(graded.kind)) {
      throw new ValidationAttemptTransitionError(
        `transition ${type} does not accept evidence kind: ${graded.kind || "(none)"}`,
        "ERR_WRONG_EVIDENCE_KIND",
      );
    }
    patch[def.evidenceSlot] = graded;
    patch.evidence = [...(attempt.evidence || []), graded];
  }

  return patch;
}

/** Classify an evidence record by kind; rejects self-report/ai/draft/unknown. Pure. */
export function gradeEvidence(record = {}) {
  const kind = String(record?.kind || "").trim();
  if (!kind || REJECTED_EVIDENCE_KINDS.has(kind)) {
    return { ...record, kind, grade: null, rejected: true };
  }
  const grade = EVIDENCE_KIND_GRADE[kind] || null;
  return { ...record, kind, grade, rejected: grade == null };
}

function isEmptyField(value) {
  if (value == null) return true;
  if (typeof value === "string") return value.trim() === "";
  if (typeof value === "object") return Object.keys(value).length === 0;
  return false;
}

// ── Host-owned derivations (the LLM never decides these) ──────────────────────
/** The next card to render, or "" when not in an ACTIVE gather state. */
export function nextCardType(attempt) {
  if (!attempt || !ACTIVE_STATES.has(attempt.status)) return "";
  for (const [cardType, card] of Object.entries(CARDS)) {
    if (card.forState === attempt.status) return cardType;
  }
  return "";
}

/**
 * Typed-union "what should happen next" for an attempt (GPT 6.11). Shapes:
 *   { kind: "card", cardType }
 *   { kind: "wait", reason: "action" | "customer_outcome" | "goal" }
 *   { kind: "blocked", blocker: { blockerReason, nextUnblockAction } }
 *   { kind: "carried", carry: { carryReason } }
 *   { kind: "terminal", outcome: "succeeded" | "failed" }
 * Throws ERR_UNMAPPED_STATE for a malformed/unknown status.
 */
export function nextAttemptAction(attempt) {
  if (!attempt || typeof attempt !== "object") {
    throw new ValidationAttemptTransitionError("attempt is required", "ERR_NO_ATTEMPT");
  }
  const status = attempt.status;
  if (VALIDATION_ATTEMPT_TERMINAL_STATES.has(status)) {
    return { kind: "terminal", outcome: status };
  }
  if (status === "blocked") {
    return {
      kind: "blocked",
      blocker: { blockerReason: attempt.blockerReason, nextUnblockAction: attempt.nextUnblockAction },
    };
  }
  if (status === "carried") {
    return { kind: "carried", carry: { carryReason: attempt.carryReason } };
  }
  if (status === "execution_scheduled") return { kind: "wait", reason: "action" };
  if (status === "awaiting_customer_outcome") return { kind: "wait", reason: "customer_outcome" };
  if (status === "outcome_observed") return { kind: "wait", reason: "goal" };
  if (ACTIVE_STATES.has(status)) {
    const cardType = nextCardType(attempt);
    if (cardType) return { kind: "card", cardType };
  }
  throw new ValidationAttemptTransitionError(
    `no next action mapped for status: ${String(status)}`,
    "ERR_UNMAPPED_STATE",
  );
}

/** Required fields still missing for the current card (computed ONCE, no LLM loop). */
export function missingFields(attempt) {
  const cardType = nextCardType(attempt);
  if (!cardType) return [];
  const card = CARDS[cardType];
  return (card.requiredFields || []).filter((f) => isEmptyField(attempt[f]));
}

/** Map a (possibly prefixed/legacy) signalId to its canonical card type. */
export function canonicalCardForSignal(signalId = "") {
  const id = String(signalId || "").trim();
  if (CARDS[id]) return id;
  return LEGACY_SIGNAL_ALIASES[id] || "";
}

// ── Canonical get_users ladder at the signalId layer ─────────────────────────
// SINGLE SOURCE OF TRUTH for the six-slot ladder order + signalId normalization.
// Previously duplicated in office-hours-structured-input.mjs (GET_USERS_LADDER_ORDER /
// canonicalGetUsersLadderSignal / nextGetUsersLadderSignal); consolidated here so
// the order/aliases live in one place. The structured-input + index callers import
// from this module.
export const GET_USERS_LADDER_SIGNAL_ORDER = Object.freeze([
  "get_users_active_user_definition",
  "get_users_first_candidate",
  "get_users_current_alternative",
  "get_users_today_request",
  "get_users_evidence_format",
  "get_users_day1_commitment",
]);

const GET_USERS_LADDER_SIGNAL_SET = new Set(GET_USERS_LADDER_SIGNAL_ORDER);

/**
 * Normalize a possibly-prefixed signalId to its canonical ladder signalId, or ""
 * if it is not a ladder slot. The inline path prefixes slots with `office_hours_`
 * while the tool path emits bare ids; both must resolve identically.
 */
export function canonicalLadderSignal(signalId = "") {
  const id = String(signalId || "").trim();
  if (GET_USERS_LADDER_SIGNAL_SET.has(id)) return id;
  const stripped = id.replace(/^office_hours_/, "");
  return GET_USERS_LADDER_SIGNAL_SET.has(stripped) ? stripped : "";
}

/** True iff the signalId (prefixed or bare) is a known get_users ladder slot. */
export function isGetUsersLadderSignal(signalId = "") {
  return canonicalLadderSignal(signalId) !== "";
}

/** Next unanswered ladder signalId given already-answered ones (prefixed or bare). */
export function nextLadderSignal(answeredSignalIds = []) {
  const source = answeredSignalIds instanceof Set ? [...answeredSignalIds] : (answeredSignalIds || []);
  const answered = new Set(source.map(canonicalLadderSignal).filter(Boolean));
  return GET_USERS_LADDER_SIGNAL_ORDER.find((id) => !answered.has(id)) || "";
}

/**
 * Day-1 close acceptability (GPT Q2 — R2 prep; UX wiring is post-R1).
 * Three dispositions close cleanly:
 *   - action proof attached (status ≥ awaiting_customer_outcome)
 *   - execution_scheduled WITH a real future dueAt (timeboxed lease; "can't do it
 *     now" escape) — validated the SAME way the reducer validates it (GPT R1.b H):
 *     parseable AND strictly after the attempt's last-update baseline.
 *   - blocked (blockerReason + nextUnblockAction) or carried (carryReason)
 * A plan-only (needs_* gather) attempt is NOT an acceptable close. A scheduled
 * attempt carrying an unparseable/past dueAt throws ERR_INVALID_DUE_AT — it is
 * never silently treated as either an acceptable or a defensively-rejected close.
 */
export function isAcceptableDay1Close(attempt) {
  if (!attempt) return false;
  if (attempt.status === "blocked") return Boolean(attempt.blockerReason && attempt.nextUnblockAction);
  if (attempt.status === "carried") return Boolean(attempt.carryReason);
  // Real external-action proof attached (any WAIT/terminal state carrying it).
  if (attempt.actionProof
    && (VALIDATION_ATTEMPT_WAIT_STATES.has(attempt.status) || VALIDATION_ATTEMPT_TERMINAL_STATES.has(attempt.status))) {
    return true;
  }
  // Plan complete with an exact deadline = timeboxed lease. An empty dueAt is a
  // defensive false (no lease at all); a present-but-invalid dueAt is a hard error.
  if (attempt.status === "execution_scheduled") {
    const dueRaw = String(attempt.dueAt || "").trim();
    if (!dueRaw) return false;
    const dueMs = Date.parse(dueRaw);
    // Baseline "now-at-schedule-time": updatedAt is stamped when the lease was set,
    // falling back to createdAt for an attempt that never moved.
    const baseRaw = String(attempt.updatedAt || attempt.createdAt || "").trim();
    const baseMs = Date.parse(baseRaw);
    if (!Number.isFinite(dueMs) || !Number.isFinite(baseMs) || !(dueMs > baseMs)) {
      throw new ValidationAttemptTransitionError(
        `isAcceptableDay1Close: invalid dueAt (${dueRaw || "(empty)"}) for scheduled attempt`,
        "ERR_INVALID_DUE_AT",
      );
    }
    return true;
  }
  return false;
}

/** Whether a NEW attempt may be created (invariant 2: no new discovery while one is open). */
export function canStartNewAttempt(attempts = []) {
  const list = Array.isArray(attempts) ? attempts : [];
  return list.every((a) => VALIDATION_ATTEMPT_RESOLVED_STATES.has(a?.status));
}

// ── Card definition accessor (consumed by office-hours-attempt-store.mjs) ──────
// No legacy turn-log migration: there is no backward-compat path. A fresh interview
// always begins clean at needs_definition via startAttempt; old turn logs are
// transcript-only and never seed an attempt.

/**
 * Look up the frozen card definition for a card type, or null. The CARDS map is
 * module-private; callers need the cardType → legacySignalId / transition /
 * requiredFields mapping (live wire identity) without re-deriving it.
 */
export function cardDefinition(cardType) {
  const key = String(cardType || "").trim();
  return CARDS[key] || null;
}

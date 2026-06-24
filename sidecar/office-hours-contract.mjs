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
// "plan → act → external reaction → evidence" lifecycle ONE typed domain object
// (ValidationAttempt) advanced by a pure reducer, with the LLM owning only the
// visible copy of each card.
//
// This module is PURE + ADDITIVE: it introduces the contract and reducer with no
// I/O and no wiring. Callers (index.mjs) adopt it behind a feature flag in a later
// step; existing signalIds remain valid via legacySignalAliases so nothing breaks.

export const OFFICE_HOURS_CONTRACT_SCHEMA_VERSION = 1;

// ── States ───────────────────────────────────────────────────────────────────
// Linear happy path, plus blocked/carried reachable from any active state, plus
// terminal succeeded/failed. A Day is a *view* over an attempt, not its own flow:
//   Day-1 creates the first attempt and ideally reaches action_performed.
//   Day-2 RESUMES the same attempt (does not start a new interview).
//   A new attempt is only created when the prior one is resolved.
export const VALIDATION_ATTEMPT_STATES = Object.freeze([
  "needs_definition",
  "needs_candidate",
  "ready_to_execute",
  "action_performed",
  "awaiting_customer_outcome",
  "evidence_received",
  "blocked",
  "carried",
  "succeeded",
  "failed",
]);

const ACTIVE_STATES = Object.freeze(new Set([
  "needs_definition",
  "needs_candidate",
  "ready_to_execute",
  "action_performed",
  "awaiting_customer_outcome",
  "evidence_received",
]));

export const VALIDATION_ATTEMPT_TERMINAL_STATES = Object.freeze(new Set(["succeeded", "failed"]));
export const VALIDATION_ATTEMPT_RESOLVED_STATES = Object.freeze(new Set(["succeeded", "failed", "carried"]));

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

// ── Transitions ──────────────────────────────────────────────────────────────
// Each transition declares the states it may fire from and the state it moves to.
// `requires` lists attempt fields that must be present for the transition to be
// legal (host-enforced; the LLM cannot bypass these by emitting a card).
const TRANSITIONS = Object.freeze({
  define_activation: { from: ["needs_definition"], to: "needs_candidate", requires: ["activationDefinition"] },
  select_candidate: { from: ["needs_candidate"], to: "ready_to_execute", requires: ["candidate"] },
  perform_action: { from: ["ready_to_execute"], to: "action_performed", requires: ["externalAction", "dueAt"] },
  attach_action_proof: { from: ["action_performed"], to: "awaiting_customer_outcome", requires: ["actionProof"] },
  attach_outcome: { from: ["awaiting_customer_outcome"], to: "evidence_received", requires: ["customerOutcome"] },
  succeed: { from: ["evidence_received"], to: "succeeded", requires: ["goalProof"] },
  fail: { from: ["evidence_received", "awaiting_customer_outcome"], to: "failed", requires: ["failureReason"] },
  // From any active state:
  block: { fromAny: true, to: "blocked", requires: ["blockerReason", "nextUnblockAction"] },
  carry: { fromAny: true, to: "carried", requires: ["carryReason"] },
});

// ── Cards (presentation slots) ───────────────────────────────────────────────
// The host decides WHICH card to render from the attempt state; the LLM fills the
// visible question/labels/descriptions only. requiredFields lets the validator
// reject a card that structurally omits what the slot must capture.
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
  action_contract: {
    forState: "ready_to_execute",
    transition: "perform_action",
    // Folds current_alternative + today_request + day1_commitment into ONE card
    // (review Q1: slots 4-6 are one execution contract, not three interviews).
    legacySignalId: "get_users_today_request",
    requiredFields: ["candidate", "externalAction", "dueAt", "attemptThreshold", "successCondition"],
    optionalFields: ["currentAlternative"],
  },
  evidence_capture: {
    forState: "action_performed",
    transition: "attach_action_proof",
    legacySignalId: "get_users_evidence_format",
    requiredFields: ["actionProof"],
  },
});

// Legacy signalId → canonical card, so existing telemetry / older UI keep working
// during the additive migration (review's non-breaking step 3).
export const LEGACY_SIGNAL_ALIASES = Object.freeze({
  get_users_active_user_definition: "activation_definition",
  get_users_first_candidate: "candidate_selection",
  get_users_current_alternative: "action_contract",
  get_users_today_request: "action_contract",
  get_users_evidence_format: "evidence_capture",
  get_users_day1_commitment: "action_contract",
  // tolerate the office_hours_ prefix the inline path adds
  office_hours_get_users_active_user_definition: "activation_definition",
  office_hours_get_users_first_candidate: "candidate_selection",
  office_hours_get_users_current_alternative: "action_contract",
  office_hours_get_users_today_request: "action_contract",
  office_hours_get_users_evidence_format: "evidence_capture",
  office_hours_get_users_day1_commitment: "action_contract",
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
    activationDefinition: "",
    candidate: "",
    currentAlternative: "",
    externalAction: "",
    dueAt: "",
    attemptThreshold: "",
    successCondition: "",
    actionProof: null,
    customerOutcome: null,
    goalProof: null,
    blockerReason: "",
    nextUnblockAction: "",
    carryReason: "",
    failureReason: "",
    appliedTransitions: [],
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

/**
 * Apply an event to an attempt and return the NEXT attempt (immutable). Throws a
 * ValidationAttemptTransitionError for an illegal transition. This is the single
 * authority for state — the LLM cannot move state by emitting a card; only a
 * validated event here can. (Review invariants 1, 3, 4, 5.)
 *
 * event = { type: <transitionName>, fields?: {}, at?: ISOstring }
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
  // Invariant 1: the same linear transition is never applied twice.
  if (!def.fromAny && attempt.appliedTransitions.includes(type)) {
    throw new ValidationAttemptTransitionError(`transition already applied: ${type}`, "ERR_DUPLICATE_TRANSITION");
  }
  // Legal-from check.
  const legalFrom = def.fromAny ? ACTIVE_STATES.has(attempt.status) : def.from.includes(attempt.status);
  if (!legalFrom) {
    throw new ValidationAttemptTransitionError(
      `transition ${type} not allowed from ${attempt.status}`,
      "ERR_ILLEGAL_FROM",
    );
  }
  const fields = event.fields && typeof event.fields === "object" ? event.fields : {};
  const next = { ...attempt, ...applyFields(attempt, type, fields) };

  // Required-field gate (host-enforced; invariants 3 & 4).
  for (const req of def.requires || []) {
    if (isEmptyField(next[req])) {
      throw new ValidationAttemptTransitionError(
        `transition ${type} requires field: ${req}`,
        "ERR_MISSING_REQUIRED_FIELD",
      );
    }
  }
  next.status = def.to;
  next.appliedTransitions = def.fromAny ? attempt.appliedTransitions.slice() : [...attempt.appliedTransitions, type];
  if (event.at) next.updatedAt = String(event.at);
  return next;
}

// Map a transition's incoming fields onto the attempt, classifying any evidence.
function applyFields(attempt, type, fields) {
  const patch = {};
  for (const [key, value] of Object.entries(fields)) {
    if (key === "evidence") continue; // handled below
    patch[key] = value;
  }
  // Evidence attachment transitions carry an evidence record we grade + store.
  if (type === "attach_action_proof" && fields.evidence) {
    const graded = gradeEvidence(fields.evidence);
    if (graded.grade !== "action_proof") {
      throw new ValidationAttemptTransitionError(
        "attach_action_proof requires action_proof-grade evidence",
        "ERR_WRONG_EVIDENCE_GRADE",
      );
    }
    patch.actionProof = graded;
    patch.evidence = [...attempt.evidence, graded];
  }
  if (type === "attach_outcome" && fields.evidence) {
    const graded = gradeEvidence(fields.evidence);
    patch.customerOutcome = graded;
    patch.evidence = [...attempt.evidence, graded];
  }
  if (type === "succeed" && fields.evidence) {
    const graded = gradeEvidence(fields.evidence);
    if (graded.grade !== "goal_proof") {
      throw new ValidationAttemptTransitionError(
        "succeed requires goal_proof-grade evidence",
        "ERR_WRONG_EVIDENCE_GRADE",
      );
    }
    patch.goalProof = graded;
    patch.evidence = [...attempt.evidence, graded];
  }
  return patch;
}

/** Classify an evidence record by kind; rejects self-report/ai/draft. Pure. */
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
/** The next card to render for an attempt, or "" when the attempt is resolved. */
export function nextCardType(attempt) {
  if (!attempt || VALIDATION_ATTEMPT_RESOLVED_STATES.has(attempt.status) || attempt.status === "blocked") return "";
  for (const [cardType, card] of Object.entries(CARDS)) {
    if (card.forState === attempt.status) return cardType;
  }
  return "";
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

/** Day-1 may end only with real external-action proof or an explicit blocker/carry. */
export function isAcceptableDay1Close(attempt) {
  if (!attempt) return false;
  if (attempt.status === "blocked") return Boolean(attempt.blockerReason && attempt.nextUnblockAction);
  if (attempt.status === "carried") return Boolean(attempt.carryReason);
  // Reaching action_performed WITH attached action proof, or further.
  const idx = VALIDATION_ATTEMPT_STATES.indexOf(attempt.status);
  const awaitingIdx = VALIDATION_ATTEMPT_STATES.indexOf("awaiting_customer_outcome");
  return Boolean(attempt.actionProof) && idx >= awaitingIdx;
}

/** Whether a NEW attempt may be created (invariant 2: no new discovery while one is open). */
export function canStartNewAttempt(attempts = []) {
  const list = Array.isArray(attempts) ? attempts : [];
  return list.every((a) => VALIDATION_ATTEMPT_RESOLVED_STATES.has(a?.status));
}

// ── Legacy adapter (review step 2: reduce existing signalId turns → attempt) ───
/**
 * Build a ValidationAttempt from existing office-hours turn-log entries (the six
 * legacy get_users signalIds). PURE — used for the additive shadow migration so
 * the new state machine can read existing sessions without changing how cards are
 * produced. Legacy turns capture PLANS only (no real action proof), so the result
 * advances at most to `action_performed`; it never fabricates evidence (this is
 * exactly the review's point that the old ladder produced definitions/plans, not
 * proof). Stops at the first illegal/duplicate transition (best-effort).
 */
export function buildValidationAttemptFromTurns(turns = [], { id = "", createdAt = "" } = {}) {
  let attempt = createValidationAttempt({ id, goalLane: "get_users", createdAt });
  const byCard = {};
  for (const turn of Array.isArray(turns) ? turns : []) {
    const card = canonicalCardForSignal(turn?.signalId || turn?.signal_id);
    const answer = String(turn?.responseText || turn?.response || "").trim();
    if (card && answer && !(card in byCard)) byCard[card] = answer;
  }
  const steps = [
    ["activation_definition", "define_activation", (v) => ({ activationDefinition: v })],
    ["candidate_selection", "select_candidate", (v) => ({ candidate: v })],
    // action_contract folds current_alternative/today_request/day1_commitment;
    // legacy answer becomes the externalAction with placeholder contract fields.
    ["action_contract", "perform_action", (v) => ({
      externalAction: v, dueAt: "legacy", attemptThreshold: "1", successCondition: v,
    })],
  ];
  for (const [card, type, toFields] of steps) {
    if (!(card in byCard)) break; // ladder is ordered; stop at first gap
    try {
      attempt = reduceValidationAttempt(attempt, { type, fields: toFields(byCard[card]) });
    } catch {
      break; // illegal/duplicate — keep the partial attempt
    }
  }
  return attempt;
}

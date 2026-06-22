import { PROOF_EVENT_TYPES } from "./execution-os.mjs";

const PROOF_TYPE_ALIASES = new Map([
  ["paymentintent", PROOF_EVENT_TYPES.paymentIntent],
  ["payment_intent", PROOF_EVENT_TYPES.paymentIntent],
  ["paymentrecord", PROOF_EVENT_TYPES.paymentRecord],
  ["payment_record", PROOF_EVENT_TYPES.paymentRecord],
  ["presaledeposit", PROOF_EVENT_TYPES.presaleDeposit],
  ["presale_deposit", PROOF_EVENT_TYPES.presaleDeposit],
  ["paymentfailure", PROOF_EVENT_TYPES.paymentFailure],
  ["payment_failure", PROOF_EVENT_TYPES.paymentFailure],
  ["refund", PROOF_EVENT_TYPES.refund],
  ["dmask", PROOF_EVENT_TYPES.dmAsk],
  ["dm_ask", PROOF_EVENT_TYPES.dmAsk],
  ["paidask", "paid_ask"],
  ["paid_ask", "paid_ask"],
  ["refusal", "refusal"],
  ["pricecuriosity", "price_curiosity"],
  ["price_curiosity", "price_curiosity"],
  ["selfreport", "self_report"],
  ["self_report", "self_report"],
  ["signup", "signup"],
  ["visitor", "visitor"],
  ["waitlist", "waitlist"],
  ["screenshot", "screenshot"],
  ["aidemo", "ai_demo"],
  ["ai_demo", "ai_demo"],
  ["gitactivity", "git_activity"],
  ["git_activity", "git_activity"],
  ["setup", PROOF_EVENT_TYPES.setup],
  ["mission", PROOF_EVENT_TYPES.mission],
  ["interview", PROOF_EVENT_TYPES.interview],
  ["bip", PROOF_EVENT_TYPES.bip],
  ["worklog", PROOF_EVENT_TYPES.workLog],
  ["work_log", PROOF_EVENT_TYPES.workLog],
  ["landingmetric", PROOF_EVENT_TYPES.landingMetric],
  ["landing_metric", PROOF_EVENT_TYPES.landingMetric],
  ["actionevidence", PROOF_EVENT_TYPES.actionEvidence],
  ["action_evidence", PROOF_EVENT_TYPES.actionEvidence],
  ["daydecision", PROOF_EVENT_TYPES.dayDecision],
  ["day_decision", PROOF_EVENT_TYPES.dayDecision],
  ["referral", PROOF_EVENT_TYPES.referral],
  ["trafficsnapshot", PROOF_EVENT_TYPES.trafficSnapshot],
  ["traffic_snapshot", PROOF_EVENT_TYPES.trafficSnapshot],
]);

const IGNORED_PROOF_TYPES = new Set([
  PROOF_EVENT_TYPES.setup,
  PROOF_EVENT_TYPES.mission,
  PROOF_EVENT_TYPES.interview,
  PROOF_EVENT_TYPES.bip,
  PROOF_EVENT_TYPES.workLog,
  PROOF_EVENT_TYPES.landingMetric,
  PROOF_EVENT_TYPES.actionEvidence,
  PROOF_EVENT_TYPES.dayDecision,
  PROOF_EVENT_TYPES.referral,
  PROOF_EVENT_TYPES.trafficSnapshot,
]);

export function normalizeProofEvents(events = [], field = "proofLedger.events") {
  return requireArray(events, field, "ERR_INVALID_PROOF_EVENTS")
    .map((event, index) => normalizeProofEventForScoreboard(event, `${field}[${index}]`));
}

export function firstRevenueProofKind(type) {
  if (type === PROOF_EVENT_TYPES.paymentRecord) return "paymentRecord";
  if (type === PROOF_EVENT_TYPES.presaleDeposit) return "presaleDeposit";
  return null;
}

export function activeExcludedCategory(type) {
  if (type === "signup") return "signup";
  if (type === "visitor") return "visitor";
  if (type === "waitlist") return "waitlist";
  if (type === "screenshot") return "screenshot";
  if (type === "ai_demo") return "aiDemo";
  if (type === "git_activity") return "gitActivity";
  if (type === "self_report") return "self-report";
  return null;
}

export function revenueLearningCategory(type) {
  if (type === PROOF_EVENT_TYPES.paymentIntent) return "paymentIntent";
  if (type === "paid_ask" || type === PROOF_EVENT_TYPES.dmAsk) return "paidAsk";
  if (type === "refusal") return "refusal";
  if (type === PROOF_EVENT_TYPES.paymentFailure) return "paymentFailure";
  if (type === PROOF_EVENT_TYPES.refund) return "refund";
  if (type === "price_curiosity") return "priceCuriosity";
  if (type === "waitlist") return "waitlist";
  if (type === "self_report") return "self-report";
  if (IGNORED_PROOF_TYPES.has(type)) return null;
  return null;
}

function requireArray(value, field, code) {
  if (!Array.isArray(value)) {
    throw codedError(code, `${field} must be an array.`);
  }
  return value;
}

function normalizeProofEventForScoreboard(value, field = "proof event") {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("ERR_INVALID_PROOF_EVENT", `${field} must be an object.`);
  }
  const type = normalizeProofType(value.type ?? value.eventType ?? value.event_type, field);
  return {
    type,
    status: normalizeProofStatus(value.status ?? value.validationStatus ?? value.validation_status),
  };
}

function normalizeProofType(value, field = "proof event") {
  const raw = cleanString(value);
  const aliasKey = raw.replace(/[-_\s]/g, "").toLowerCase();
  const snakeKey = raw.replace(/[-\s]/g, "_").toLowerCase();
  const type = PROOF_TYPE_ALIASES.get(raw)
    ?? PROOF_TYPE_ALIASES.get(aliasKey)
    ?? PROOF_TYPE_ALIASES.get(snakeKey);
  if (!type) {
    throw codedError("ERR_UNSUPPORTED_PROOF_TYPE", `Unsupported proof event type at ${field}: ${raw || "<empty>"}`);
  }
  return type;
}

function normalizeProofStatus(value) {
  return cleanString(value).replace(/[-\s]/g, "_").toLowerCase() || "submitted";
}

function cleanString(value = "") {
  return String(value ?? "").trim();
}

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

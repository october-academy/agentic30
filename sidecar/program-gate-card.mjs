import { GATE_IDS, GATE_STATES } from "./program-gate-engine.mjs";
import {
  REVENUE_OR_ACTIVATION_GATE_CARD_TYPE,
  REVENUE_OR_ACTIVATION_GATE_SCHEMA_VERSION,
  baseCard,
  codedError,
  conditionById,
  isPlainObject,
  mergeSourceStates,
  nonNegativeInteger,
  normalizeProgramDay,
  normalizeScoreboards,
  normalizeSourceState,
  pushUnique,
  requireScoreboard,
  sourceReason,
} from "./program-gate-card-support.mjs";

export {
  REVENUE_OR_ACTIVATION_GATE_CARD_TYPE,
  REVENUE_OR_ACTIVATION_GATE_SCHEMA_VERSION,
};

const GATES = new Set([GATE_IDS.G4, GATE_IDS.G5, GATE_IDS.G6, GATE_IDS.G7]);

export function buildRevenueOrActivationGateCard({
  gateId = "",
  gate = "",
  evaluation = null,
  scoreboardSnapshot = null,
  sourceStates = {},
} = {}) {
  const resolvedGateId = normalizeGateId(gateId || gate);
  const gateRecord = evaluation?.gates?.[resolvedGateId];
  if (!gateRecord) {
    throw codedError("ERR_MISSING_GATE_EVALUATION", `${resolvedGateId} gate evaluation is required`);
  }

  const scoreboards = normalizeScoreboards(scoreboardSnapshot);
  const programDay = normalizeProgramDay(evaluation?.currentDay ?? evaluation?.current_day);
  const sourceStateInput = isPlainObject(sourceStates) ? sourceStates : {};

  if (resolvedGateId === GATE_IDS.G4) {
    return buildG4Card({ gateRecord, scoreboards, programDay, sourceStates: sourceStateInput });
  }
  if (resolvedGateId === GATE_IDS.G5) {
    return buildG5Card({ gateRecord, scoreboards, programDay, sourceStates: sourceStateInput });
  }
  if (resolvedGateId === GATE_IDS.G6) {
    return buildG6Card({ scoreboards, programDay, sourceStates: sourceStateInput });
  }
  return buildG7Card({ gateRecord, programDay, sourceStates: sourceStateInput });
}

function buildG4Card({ gateRecord, scoreboards, programDay, sourceStates }) {
  const paidAsk = conditionById(gateRecord, "paid_ask_strong_evidence");
  const firstValue = conditionById(gateRecord, "first_value_observed");
  const activeUsers = requireScoreboard(scoreboards, "activeUsers100");
  const firstRevenue = requireScoreboard(scoreboards, "firstRevenue");
  const sourceState = normalizeSourceState(
    sourceStates.firstValue ?? sourceStates.first_value ?? activeUsers.sourceState ?? activeUsers.source_state,
    "G4 first_value sourceState",
  );
  const blockingReasons = [];
  if (paidAsk?.satisfied !== true) {
    blockingReasons.push("missing paymentIntent strong evidence");
  }
  if (firstValue?.satisfied !== true) {
    blockingReasons.push(firstValue?.sourceUnavailable ? sourceReason("first_value", sourceState) : "missing first_value");
  }
  if (sourceState !== "ready") {
    pushUnique(blockingReasons, sourceReason("first_value", sourceState));
  }
  const satisfied = paidAsk?.satisfied === true
    && firstValue?.satisfied === true
    && sourceState === "ready"
    && gateRecord.state === GATE_STATES.passed;

  return baseCard({
    gate: GATE_IDS.G4,
    programDay,
    sourceState,
    requires: ["first_value", "paymentIntent"],
    satisfied,
    blockingReasons,
    recoveryBranch: blockingReasons.includes("missing paymentIntent strong evidence")
      ? "g4-recovery-ask-resend"
      : "g4-recovery-instrumentation",
    proofLedgerMapping: {
      first_value: "activeUsers100.acceptedProof",
      paymentIntent: "firstRevenue.learningSignal",
    },
    scoreboard: { activeUsers100: activeUsers, firstRevenue },
  });
}

function buildG5Card({ gateRecord, scoreboards, programDay, sourceStates }) {
  const traffic = conditionById(gateRecord, "traffic_observed");
  const active = conditionById(gateRecord, "active_user_observed");
  const activeUsers = requireScoreboard(scoreboards, "activeUsers100");
  const trafficState = normalizeSourceState(
    sourceStates.traffic ?? sourceStates.trafficSource ?? sourceStates.traffic_source
      ?? (traffic?.sourceUnavailable === true ? "missing" : "ready"),
    "G5 traffic sourceState",
  );
  const activeState = normalizeSourceState(
    sourceStates.activeUsers100 ?? sourceStates.active_users_100
      ?? activeUsers.sourceState ?? activeUsers.source_state,
    "G5 activeUsers100 sourceState",
  );
  const activeCount = nonNegativeInteger(activeUsers.acceptedCount ?? activeUsers.accepted_count) ?? 0;
  const blockingReasons = [];
  if (trafficState !== "ready") {
    blockingReasons.push(sourceReason("traffic", trafficState));
  } else if (traffic?.satisfied !== true) {
    blockingReasons.push("missing traffic evidence");
  }
  if (activeState !== "ready") {
    blockingReasons.push(sourceReason("active user", activeState));
  } else if (active?.satisfied !== true || activeCount < 1) {
    blockingReasons.push("missing active user");
  }
  const sourceState = mergeSourceStates([trafficState, activeState]);
  const satisfied = traffic?.satisfied === true
    && active?.satisfied === true
    && trafficState === "ready"
    && activeState === "ready"
    && activeCount >= 1
    && gateRecord.state === GATE_STATES.passed;

  return baseCard({
    gate: GATE_IDS.G5,
    programDay,
    sourceState,
    requires: ["traffic", "active_user"],
    satisfied,
    blockingReasons,
    recoveryBranch: trafficState !== "ready" || traffic?.satisfied !== true
      ? "g5-recovery-channel-reselect"
      : "g5-recovery-outreach-rerun",
    proofLedgerMapping: {
      first_value: "activeUsers100.acceptedProof",
    },
    scoreboard: { activeUsers100: activeUsers },
  });
}

function buildG6Card({ scoreboards, programDay, sourceStates }) {
  const firstRevenue = requireScoreboard(scoreboards, "firstRevenue");
  const sourceState = normalizeSourceState(
    sourceStates.firstRevenue ?? sourceStates.first_revenue
      ?? firstRevenue.sourceState ?? firstRevenue.source_state,
    "G6 firstRevenue sourceState",
  );
  const acceptedCount = nonNegativeInteger(firstRevenue.acceptedCount ?? firstRevenue.accepted_count) ?? 0;
  const blockingReasons = [];
  if (sourceState !== "ready") {
    blockingReasons.push(sourceReason("firstRevenue", sourceState));
  }
  if (acceptedCount < 1) {
    blockingReasons.push("paymentRecord missing");
  }
  const satisfied = sourceState === "ready" && acceptedCount >= 1;

  return baseCard({
    gate: GATE_IDS.G6,
    programDay,
    sourceState,
    requires: ["paymentRecord"],
    satisfied,
    blockingReasons,
    recoveryBranch: "g6-recovery-ask-and-refusal",
    proofLedgerMapping: {
      paymentRecord: "firstRevenue.acceptedProof",
    },
    scoreboard: { firstRevenue },
  });
}

function buildG7Card({ gateRecord, programDay, sourceStates }) {
  const sourceState = normalizeSourceState(
    sourceStates.finalDecision ?? sourceStates.final_decision
      ?? (gateRecord.state === GATE_STATES.passed ? "ready" : "manual_proof_required"),
    "G7 finalDecision sourceState",
  );
  const blockingReasons = [];
  if (sourceState !== "ready") {
    blockingReasons.push(sourceReason("final decision", sourceState));
  }
  if (gateRecord.state !== GATE_STATES.passed) {
    blockingReasons.push("missing Day 30 decision evidence refs");
  }
  const satisfied = sourceState === "ready" && gateRecord.state === GATE_STATES.passed;

  return baseCard({
    gate: GATE_IDS.G7,
    programDay,
    sourceState,
    requires: ["dayDecision", "evidence_refs"],
    satisfied,
    blockingReasons,
    recoveryBranch: "g7-graduation-hold",
    proofLedgerMapping: {
      customer_screenshot: "customerEvidence.acceptedProof",
    },
    scoreboard: {},
  });
}

function normalizeGateId(gateId) {
  const value = String(gateId || "").trim().toUpperCase();
  if (!GATES.has(value)) {
    throw codedError("ERR_UNKNOWN_GATE", `unsupported revenue or activation gate: ${value || "<empty>"}`);
  }
  return value;
}

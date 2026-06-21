import {
  SCOREBOARD_SOURCE_STATES,
  PROGRAM_SCOREBOARD_EVENT_TYPE,
} from "./program-scoreboard.mjs";

export const REVENUE_OR_ACTIVATION_GATE_CARD_TYPE = "revenue_or_activation_gate";
export const REVENUE_OR_ACTIVATION_GATE_SCHEMA_VERSION = 1;

const SOURCE_STATES = new Set(SCOREBOARD_SOURCE_STATES);

export function baseCard({
  gate,
  programDay,
  sourceState,
  requires,
  satisfied,
  blockingReasons,
  recoveryBranch,
  proofLedgerMapping,
  scoreboard,
}) {
  const reasons = satisfied ? [] : [...new Set(blockingReasons.filter(Boolean))];
  if (!satisfied && reasons.length === 0) {
    throw codedError("ERR_MISSING_BLOCKING_REASON", `${gate} gate card requires at least one blocking reason`);
  }
  return {
    type: REVENUE_OR_ACTIVATION_GATE_CARD_TYPE,
    schemaVersion: REVENUE_OR_ACTIVATION_GATE_SCHEMA_VERSION,
    programDay,
    generation: {
      signalId: `program-gate:${gate}`,
      signalLabel: `${gate} revenue/activation gate`,
    },
    sourceState,
    requiresUserAction: !satisfied,
    proofLedgerMapping,
    gate,
    requires,
    satisfied,
    blockingReasons: reasons,
    recoveryBranch,
    nextCardType: "office_hours_agent_workpack",
    scoreboard,
  };
}

export function normalizeScoreboards(snapshot) {
  if (!snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
    throw codedError("ERR_MISSING_SCOREBOARD", "scoreboardSnapshot is required");
  }
  if (snapshot.type !== undefined && snapshot.type !== PROGRAM_SCOREBOARD_EVENT_TYPE) {
    throw codedError("ERR_MISSING_SCOREBOARD", "scoreboardSnapshot.type must be program_scoreboard_snapshot");
  }
  const scoreboards = snapshot.scoreboards;
  if (!scoreboards || typeof scoreboards !== "object" || Array.isArray(scoreboards)) {
    throw codedError("ERR_MISSING_SCOREBOARD", "scoreboardSnapshot.scoreboards is required");
  }
  return scoreboards;
}

export function requireScoreboard(scoreboards, key) {
  const value = scoreboards?.[key];
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw codedError("ERR_MISSING_SCOREBOARD", `scoreboards.${key} is required`);
  }
  return cloneJson(value);
}

export function conditionById(gateRecord, id) {
  return asArray(gateRecord.conditions ?? gateRecord.requiredEvidence ?? gateRecord.required_evidence)
    .find((condition) => condition?.id === id) ?? null;
}

export function normalizeSourceState(value, path) {
  const state = String(value ?? "").trim();
  if (!SOURCE_STATES.has(state)) {
    throw codedError("ERR_MISSING_SOURCE_STATE", `${path} must be one of: ${SCOREBOARD_SOURCE_STATES.join(", ")}`);
  }
  return state;
}

export function sourceReason(label, sourceState) {
  if (sourceState === "missing") return `missing ${label} source`;
  return `${sourceState} ${label} source`;
}

export function mergeSourceStates(states) {
  for (const state of ["rejected", "missing", "stale", "manual_proof_required"]) {
    if (states.includes(state)) return state;
  }
  return "ready";
}

export function normalizeProgramDay(value) {
  const number = nonNegativeInteger(value);
  return number === null || number < 1 ? 1 : number;
}

export function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.trunc(number);
}

export function pushUnique(list, value) {
  if (value && !list.includes(value)) list.push(value);
}

export function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

export function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

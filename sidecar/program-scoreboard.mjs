import {
  activeExcludedCategory,
  firstRevenueProofKind,
  normalizeProofEvents,
  revenueLearningCategory,
} from "./program-scoreboard-proof-events.mjs";
import {
  latestAcceptedActiveUserCount,
  normalizeActiveUserSnapshotList,
} from "./program-scoreboard-active-users.mjs";

export const PROGRAM_SCOREBOARD_SCHEMA_VERSION = 1;
export const PROGRAM_SCOREBOARD_EVENT_TYPE = "program_scoreboard_snapshot";

export const SCOREBOARD_SOURCE_STATES = Object.freeze([
  "ready",
  "missing",
  "stale",
  "manual_proof_required",
  "rejected",
]);

const SOURCE_STATE_SET = new Set(SCOREBOARD_SOURCE_STATES);
const ACCEPTED_PROOF_STATUSES = new Set(["accepted", "verified"]);
const ACTIVE_USER_TARGET = 100;
const FIRST_REVENUE_TARGET = 1;

const ACTIVE_EXCLUDED_KEYS = Object.freeze(["signup", "visitor", "waitlist", "screenshot", "aiDemo", "gitActivity", "self-report"]);

const REVENUE_LEARNING_KEYS = Object.freeze([
  "paymentIntent",
  "paidAsk",
  "refusal",
  "paymentFailure",
  "refund",
  "priceCuriosity",
  "waitlist",
  "self-report",
]);

const REVENUE_EXCLUDED_KEYS = Object.freeze(["rejectedPaymentRecord", "rejectedPresaleDeposit"]);

export function buildProgramScoreboardSnapshot({
  programDay = null,
  activeUsers = {},
  activeUsersStore = null,
  activeUserSnapshots = null,
  firstRevenue = {},
  proofLedger = {},
  proofEvents = null,
  sourceStates = {},
  nextUnblockActions = {},
} = {}) {
  const proofEventField = proofEvents != null ? "proofEvents" : "proofLedger.events";
  const events = normalizeProofEvents(proofEvents ?? proofLedger?.events ?? [], proofEventField);
  const snapshots = activeUserSnapshotList({ activeUsers, activeUsersStore, activeUserSnapshots });
  const activeSourceState = normalizeSourceState(
    activeUsers.sourceState
      ?? activeUsers.source_state
      ?? sourceStates.activeUsers100
      ?? sourceStates.active_users_100
      ?? (snapshots.length ? "ready" : "missing"),
    "activeUsers100",
  );
  const revenueSourceState = normalizeSourceState(
    firstRevenue.sourceState
      ?? firstRevenue.source_state
      ?? sourceStates.firstRevenue
      ?? sourceStates.first_revenue
      ?? (events.length ? "ready" : "missing"),
    "firstRevenue",
  );

  const active = buildActiveUsersScoreboard({
    sourceState: activeSourceState,
    snapshots,
    excludedCounts: activeUsers.excludedCounts ?? activeUsers.excluded_counts ?? {},
    proofEvents: events,
    nextUnblockAction: nextUnblockActions.activeUsers100 ?? activeUsers.nextUnblockAction,
  });
  const revenue = buildFirstRevenueScoreboard({
    sourceState: revenueSourceState,
    proofEvents: events,
    excludedCounts: firstRevenue.excludedCounts ?? firstRevenue.excluded_counts ?? {},
    learningCounts: firstRevenue.learningCounts ?? firstRevenue.learning_counts ?? {},
    nextUnblockAction: nextUnblockActions.firstRevenue ?? firstRevenue.nextUnblockAction,
  });

  return {
    type: PROGRAM_SCOREBOARD_EVENT_TYPE,
    schemaVersion: PROGRAM_SCOREBOARD_SCHEMA_VERSION,
    schema_version: PROGRAM_SCOREBOARD_SCHEMA_VERSION,
    programDay: normalizeProgramDay(programDay),
    program_day: normalizeProgramDay(programDay),
    scoreboards: {
      activeUsers100: active,
      firstRevenue: revenue,
    },
  };
}

export function buildActiveUsersScoreboard({
  sourceState = "missing",
  snapshots = [],
  excludedCounts = {},
  proofEvents = [],
  nextUnblockAction = "",
} = {}) {
  const state = normalizeSourceState(sourceState, "activeUsers100");
  const excluded = normalizeCounterMap(excludedCounts, ACTIVE_EXCLUDED_KEYS);
  for (const event of proofEvents) {
    const category = activeExcludedCategory(event.type);
    if (category) excluded[category] = (excluded[category] ?? 0) + 1;
  }
  const acceptedCount = state === "ready"
    ? latestAcceptedActiveUserCount(snapshots)
    : 0;
  return {
    target: ACTIVE_USER_TARGET,
    acceptedCount,
    accepted_count: acceptedCount,
    excludedCounts: excluded,
    excluded_counts: excluded,
    sourceState: state,
    source_state: state,
    passing: state === "ready" && acceptedCount >= ACTIVE_USER_TARGET,
    nextUnblockAction: cleanString(nextUnblockAction) || "activation friction fix workpack",
    next_unblock_action: cleanString(nextUnblockAction) || "activation friction fix workpack",
  };
}

export function buildFirstRevenueScoreboard({
  sourceState = "missing",
  proofEvents = [],
  excludedCounts = {},
  learningCounts = {},
  nextUnblockAction = "",
} = {}) {
  const state = normalizeSourceState(sourceState, "firstRevenue");
  const excluded = normalizeCounterMap(excludedCounts, REVENUE_EXCLUDED_KEYS);
  const learning = normalizeCounterMap(learningCounts, REVENUE_LEARNING_KEYS);
  let acceptedCount = 0;

  for (const event of proofEvents) {
    const proofKind = firstRevenueProofKind(event.type);
    if (proofKind) {
      if (ACCEPTED_PROOF_STATUSES.has(event.status)) {
        acceptedCount += 1;
      } else {
        const rejectedKey = proofKind === "presaleDeposit"
          ? "rejectedPresaleDeposit"
          : "rejectedPaymentRecord";
        excluded[rejectedKey] = (excluded[rejectedKey] ?? 0) + 1;
      }
      continue;
    }
    const category = revenueLearningCategory(event.type);
    if (category) learning[category] = (learning[category] ?? 0) + 1;
  }

  if (state !== "ready") acceptedCount = 0;

  return {
    target: FIRST_REVENUE_TARGET,
    acceptedCount,
    accepted_count: acceptedCount,
    excludedCounts: excluded,
    excluded_counts: excluded,
    learningCounts: learning,
    learning_counts: learning,
    sourceState: state,
    source_state: state,
    passing: state === "ready" && acceptedCount >= FIRST_REVENUE_TARGET,
    nextUnblockAction: cleanString(nextUnblockAction) || "offer/paid ask follow-up plan",
    next_unblock_action: cleanString(nextUnblockAction) || "offer/paid ask follow-up plan",
  };
}

export function normalizeSourceState(value, field = "sourceState") {
  const state = cleanString(value);
  if (!SOURCE_STATE_SET.has(state)) {
    throw codedError("ERR_INVALID_SOURCE_STATE", `${field} must be one of: ${SCOREBOARD_SOURCE_STATES.join(", ")}`);
  }
  return state;
}

function activeUserSnapshotList({ activeUsers = {}, activeUsersStore = null, activeUserSnapshots = null } = {}) {
  if (activeUserSnapshots != null) {
    return normalizeActiveUserSnapshotList(
      requireArray(activeUserSnapshots, "activeUserSnapshots", "ERR_INVALID_ACTIVE_USER_SNAPSHOTS"),
      "activeUserSnapshots",
    );
  }
  if (activeUsers.snapshots != null) {
    return normalizeActiveUserSnapshotList(
      requireArray(activeUsers.snapshots, "activeUsers.snapshots", "ERR_INVALID_ACTIVE_USER_SNAPSHOTS"),
      "activeUsers.snapshots",
    );
  }
  if (activeUsersStore?.snapshots != null) {
    return normalizeActiveUserSnapshotList(
      requireArray(activeUsersStore.snapshots, "activeUsersStore.snapshots", "ERR_INVALID_ACTIVE_USER_SNAPSHOTS"),
      "activeUsersStore.snapshots",
    );
  }
  return [];
}

function requireArray(value, field, code) {
  if (!Array.isArray(value)) {
    throw codedError(code, `${field} must be an array.`);
  }
  return value;
}

function normalizeCounterMap(value = {}, allowedKeys = []) {
  const source = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const result = {};
  for (const key of allowedKeys) {
    const count = nonNegativeInteger(source[key] ?? source[snakeKey(key)] ?? source[legacyCounterKey(key)]);
    if (count !== null && count > 0) result[key] = count;
  }
  return result;
}

function nonNegativeInteger(value) {
  const number = Number(value);
  if (!Number.isFinite(number) || number < 0) return null;
  return Math.trunc(number);
}

function normalizeProgramDay(value) {
  const day = nonNegativeInteger(value);
  return day === null ? null : day;
}

function snakeKey(key) {
  return String(key).replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`);
}

function legacyCounterKey(key) {
  return String(key).replace(/-/g, "_");
}

function cleanString(value = "") {
  return String(value ?? "").trim();
}

function codedError(code, message) {
  const error = new Error(`${code}: ${message}`);
  error.code = code;
  return error;
}

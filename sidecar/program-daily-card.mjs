/**
 * Pure v2 daily-card contract for program cards carried inside the existing
 * `mission_card` bridge envelope.
 */

export const PROGRAM_DAILY_CARD_TYPES = Object.freeze([
  "office_hours_state_transition",
  "office_hours_agent_workpack",
  "program_scoreboard_snapshot",
  "revenue_or_activation_gate",
]);

export const PROGRAM_DAILY_CARD_EVENT_TYPE = "mission_card";

export class ProgramDailyCardValidationError extends Error {
  constructor(code, message, details = {}) {
    super(`${code}: ${message}`);
    this.name = "ProgramDailyCardValidationError";
    this.code = code;
    this.details = details;
  }
}

const SOURCE_STATES = new Set(["ready", "missing", "stale", "manual_proof_required", "rejected"]);
const CARD_TYPES = new Set(PROGRAM_DAILY_CARD_TYPES);
const GATES = new Set(["G4", "G5", "G6", "G7"]);
const WORK_TYPES = new Set([
  "outreach/customer copy",
  "offer/paid ask",
  "ICP/source analysis",
  "channel experiment",
  "first_value instrumentation snippet",
  "activation friction fix",
  "evidence capture checklist",
  "follow-up plan",
]);
const ALLOWED_PROOF_MAPPINGS = new Map([
  ["self_report", new Set(["officeHoursResolution.negativeEvidenceOnly"])],
  ["self-report", new Set(["officeHoursResolution.negativeEvidenceOnly"])],
  ["customer_screenshot", new Set(["customerEvidence.acceptedProof"])],
  ["paymentIntent", new Set(["firstRevenue.learningSignal"])],
  ["paymentRecord", new Set(["firstRevenue.acceptedProof"])],
  ["first_value", new Set(["activeUsers100.acceptedProof"])],
  ["signup", new Set(["activeUsers100.excludedCount"])],
  ["visitor", new Set(["activeUsers100.excludedCount"])],
]);

export function buildProgramDailyCardEvent({ workspaceRoot = "", missionCard } = {}) {
  return {
    type: PROGRAM_DAILY_CARD_EVENT_TYPE,
    workspaceRoot,
    missionCard: validateProgramDailyCard(missionCard),
  };
}

export function buildOfficeHoursStateTransitionCard(card) {
  return validateTypedCard(card, "office_hours_state_transition");
}

export function buildOfficeHoursAgentWorkpackCard(card) {
  return validateTypedCard(card, "office_hours_agent_workpack");
}

export function buildProgramScoreboardSnapshotCard(card) {
  return validateTypedCard(card, "program_scoreboard_snapshot");
}

export function buildRevenueOrActivationGateCard(card) {
  return validateTypedCard(card, "revenue_or_activation_gate");
}

export function validateProgramDailyCard(card) {
  if (!card || typeof card !== "object" || Array.isArray(card)) {
    fail("ERR_UNKNOWN_CARD_TYPE", "daily card must be an object");
  }
  if (!CARD_TYPES.has(card.type)) {
    fail("ERR_UNKNOWN_CARD_TYPE", `unknown daily card type: ${String(card.type)}`);
  }

  validateCommonCardFields(card);

  switch (card.type) {
    case "office_hours_state_transition":
      validateOfficeHoursStateTransition(card);
      break;
    case "office_hours_agent_workpack":
      validateOfficeHoursAgentWorkpack(card);
      break;
    case "program_scoreboard_snapshot":
      validateProgramScoreboardSnapshot(card);
      break;
    case "revenue_or_activation_gate":
      validateRevenueOrActivationGate(card);
      break;
    default:
      fail("ERR_UNKNOWN_CARD_TYPE", `unknown daily card type: ${String(card.type)}`);
  }

  return cloneJson(card);
}

function validateTypedCard(card, type) {
  if (card?.type !== type) {
    fail("ERR_UNKNOWN_CARD_TYPE", `expected ${type}, received ${String(card?.type)}`);
  }
  return validateProgramDailyCard(card);
}

function validateCommonCardFields(card) {
  if (!isNonEmptyString(card.generation?.signalId) || !isNonEmptyString(card.generation?.signalLabel)) {
    fail("ERR_MISSING_SOURCE_STATE", "daily card generation signalId and signalLabel are required");
  }
  if (!Number.isInteger(card.schemaVersion) || card.schemaVersion < 1) {
    fail("ERR_MISSING_SOURCE_STATE", "daily card schemaVersion is required");
  }
  if (!Number.isInteger(card.programDay) || card.programDay < 1) {
    fail("ERR_MISSING_SOURCE_STATE", "daily card programDay is required");
  }
  validateSourceState(card.sourceState);
  if (typeof card.requiresUserAction !== "boolean") {
    fail("ERR_MISSING_SOURCE_STATE", "daily card requiresUserAction boolean is required");
  }
  validateProofLedgerMapping(card.proofLedgerMapping);
}

function validateOfficeHoursStateTransition(card) {
  requireString(card.commitmentId, "commitmentId", "ERR_MISSING_SOURCE_STATE");
  requireString(card.candidateName, "candidateName", "ERR_MISSING_SOURCE_STATE");
  requireString(card.actionText, "actionText", "ERR_MISSING_SOURCE_STATE");
  if (!Number.isInteger(card.repeatCountWithoutEvidence) || card.repeatCountWithoutEvidence < 0) {
    fail("ERR_MISSING_SOURCE_STATE", "repeatCountWithoutEvidence is required");
  }
  validateChoiceList(card.choices, "choices");
  validateStringArray(card.resolutionReasons, "resolutionReasons", "ERR_MISSING_SOURCE_STATE");
}

function validateOfficeHoursAgentWorkpack(card) {
  requireString(card.selectedLens, "selectedLens", "ERR_MALFORMED_AGENT_WORKPACK");
  if (card.requiresUserAction) {
    requireString(card.sourceCommitmentId, "sourceCommitmentId", "ERR_MALFORMED_AGENT_WORKPACK");
  }
  const workpack = card.workpack;
  if (!workpack || typeof workpack !== "object" || Array.isArray(workpack)) {
    fail("ERR_MALFORMED_AGENT_WORKPACK", "workpack object is required");
  }
  for (const field of ["id", "workType", "targetExternalAction", "expectedProof", "owner", "deadline"]) {
    requireString(workpack[field], `workpack.${field}`, "ERR_MALFORMED_AGENT_WORKPACK");
  }
  if (!WORK_TYPES.has(workpack.workType)) {
    fail("ERR_MALFORMED_AGENT_WORKPACK", `unknown workpack.workType: ${workpack.workType}`);
  }
  if (workpack.owner !== "founder") {
    fail("ERR_MALFORMED_AGENT_WORKPACK", "workpack.owner must be founder");
  }
  validateStringArray(workpack.notProof, "workpack.notProof", "ERR_MALFORMED_AGENT_WORKPACK");
}

function validateProgramScoreboardSnapshot(card) {
  const scoreboards = card.scoreboards;
  if (!scoreboards || typeof scoreboards !== "object" || Array.isArray(scoreboards)) {
    fail("ERR_MISSING_SOURCE_STATE", "scoreboards object is required");
  }
  validateScoreboard(scoreboards.activeUsers100, "scoreboards.activeUsers100");
  validateScoreboard(scoreboards.firstRevenue, "scoreboards.firstRevenue");
}

function validateRevenueOrActivationGate(card) {
  if (!GATES.has(card.gate)) {
    fail("ERR_UNKNOWN_CARD_TYPE", `unknown revenue or activation gate: ${String(card.gate)}`);
  }
  validateStringArray(card.requires, "requires", "ERR_MISSING_SOURCE_STATE");
  if (typeof card.satisfied !== "boolean") {
    fail("ERR_MISSING_SOURCE_STATE", "gate satisfied boolean is required");
  }
  if (!card.satisfied) validateStringArray(card.blockingReasons, "blockingReasons", "ERR_MISSING_SOURCE_STATE");
  requireString(card.recoveryBranch, "recoveryBranch", "ERR_MISSING_SOURCE_STATE");
  if (!CARD_TYPES.has(card.nextCardType)) {
    fail("ERR_UNKNOWN_CARD_TYPE", `unknown next card type: ${String(card.nextCardType)}`);
  }
}

function validateScoreboard(scoreboard, path) {
  if (!scoreboard || typeof scoreboard !== "object" || Array.isArray(scoreboard)) {
    fail("ERR_MISSING_SOURCE_STATE", `${path} object is required`);
  }
  if (!Number.isInteger(scoreboard.acceptedCount) || scoreboard.acceptedCount < 0) {
    fail("ERR_MISSING_SOURCE_STATE", `${path}.acceptedCount is required`);
  }
  validateSourceState(scoreboard.sourceState, `${path}.sourceState`);
  requireString(scoreboard.nextUnblockAction, `${path}.nextUnblockAction`, "ERR_MISSING_SOURCE_STATE");
  if (scoreboard.excludedCounts !== undefined && !isPlainObject(scoreboard.excludedCounts)) {
    fail("ERR_INVALID_PROOF_MAPPING", `${path}.excludedCounts must be an object when present`);
  }
}

function validateProofLedgerMapping(mapping) {
  if (!isPlainObject(mapping) || Object.keys(mapping).length === 0) {
    fail("ERR_INVALID_PROOF_MAPPING", "proofLedgerMapping must be a non-empty object");
  }
  for (const [source, destination] of Object.entries(mapping)) {
    if (!isNonEmptyString(destination)) {
      fail("ERR_INVALID_PROOF_MAPPING", `proofLedgerMapping.${source} must be a non-empty string`);
    }
    if (source === "self_report" || source === "self-report") {
      if (destination !== "officeHoursResolution.negativeEvidenceOnly") {
        fail("ERR_SELF_REPORT_COUNTED_AS_PROOF", "self-report cannot count as proof or program progress");
      }
    }
    if (!ALLOWED_PROOF_MAPPINGS.get(source)?.has(destination)) {
      fail("ERR_INVALID_PROOF_MAPPING", `invalid proof mapping ${source} -> ${destination}`);
    }
  }
}

function validateSourceState(sourceState, path = "sourceState") {
  if (!SOURCE_STATES.has(sourceState)) {
    fail("ERR_MISSING_SOURCE_STATE", `${path} is required`);
  }
}

function validateChoiceList(value, path) {
  if (!Array.isArray(value) || value.length === 0) {
    fail("ERR_MISSING_SOURCE_STATE", `${path} must be a non-empty array`);
  }
  for (const [index, choice] of value.entries()) {
    requireString(choice?.id, `${path}.${index}.id`, "ERR_MISSING_SOURCE_STATE");
    requireString(choice?.label, `${path}.${index}.label`, "ERR_MISSING_SOURCE_STATE");
  }
}

function validateStringArray(value, path, code) {
  if (!Array.isArray(value) || value.length === 0 || !value.every(isNonEmptyString)) {
    fail(code, `${path} must be a non-empty string array`);
  }
}

function requireString(value, path, code) {
  if (!isNonEmptyString(value)) fail(code, `${path} is required`);
}

function isPlainObject(value) {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isNonEmptyString(value) {
  return typeof value === "string" && value.trim().length > 0;
}

function cloneJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function fail(code, message, details = {}) {
  throw new ProgramDailyCardValidationError(code, message, details);
}

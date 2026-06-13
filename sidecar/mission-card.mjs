/**
 * IDD mission card for the execution step (spec §11.0, §17.2 — P0-5).
 *
 * When the Day 2+ macro loop reaches the execution step, the sidecar emits a
 * `mission_card` event loading that day's IDD curriculum mission
 * (`IDD_BASE_CURRICULUM`, adaptive-curriculum.mjs) plus its evidence spec and
 * the current milestone-gate context. Substitution records from the gate
 * ledger (§15.3, written by the Gate Engine from P1-4 on) override the base
 * mission for their target day — the most recent substitution wins.
 *
 * Pure module: no IO. Callers pass curriculum + gate snapshots in.
 */

import { IDD_BASE_CURRICULUM } from "./adaptive-curriculum.mjs";

export const MISSION_CARD_SCHEMA_VERSION = 1;
export const MISSION_CARD_EVENT_TYPE = "mission_card";

const EVIDENCE_FREE_DAY_TYPES = new Set(["education", "review"]);

/**
 * Builds the `mission_card` bridge event for a day, or null when the day has
 * no authored IDD mission (out of the 1–30 range). The §17.2 payload
 * `{ day, source: idd, mission, evidenceSpec, gateContext }` is wrapped under
 * a single `missionCard` key so the Swift decoder gains one collision-free
 * optional field (same convention as other structured envelopes).
 */
export function buildMissionCardEvent({
  workspaceRoot = "",
  day,
  curriculumDays = IDD_BASE_CURRICULUM,
  gateEvaluation = null,
  substitutions = [],
  now = new Date(),
} = {}) {
  const dayNumber = normalizeDay(day);
  if (dayNumber === null) return null;
  const base = (Array.isArray(curriculumDays) ? curriculumDays : [])
    .find((entry) => Number(entry?.day) === dayNumber);
  if (!base) return null;

  const substitution = latestSubstitutionForDay(substitutions, dayNumber);
  const mission = buildMissionPayload({ base, substitution, dayNumber });
  const evidenceSpec = buildEvidenceSpec(mission);
  const gateContext = buildGateContext(gateEvaluation, dayNumber);
  const generatedAt = toIso(now);

  return {
    type: MISSION_CARD_EVENT_TYPE,
    workspaceRoot,
    missionCard: {
      schemaVersion: MISSION_CARD_SCHEMA_VERSION,
      schema_version: MISSION_CARD_SCHEMA_VERSION,
      day: dayNumber,
      source: "idd",
      mission,
      evidenceSpec,
      evidence_spec: evidenceSpec,
      gateContext,
      gate_context: gateContext,
      generatedAt,
      generated_at: generatedAt,
    },
  };
}

function buildMissionPayload({ base, substitution, dayNumber }) {
  if (substitution) {
    const title = cleanString(substitution.replacedMission ?? substitution.replaced_mission, 300)
      || cleanString(base.title, 300);
    const exitCondition = cleanString(substitution.exitCondition ?? substitution.exit_condition, 300);
    const output = cleanString(substitution.output, 300)
      || (exitCondition ? `게이트 해제 증거: ${exitCondition}` : cleanString(base.output, 300));
    const tasks = cleanStringArray(substitution.tasks, 300);
    return {
      day: dayNumber,
      title,
      shortTitle: cleanString(substitution.shortTitle ?? substitution.short_title, 80)
        || cleanString(title, 80),
      summary: cleanString(substitution.summary, 600)
        || cleanString(`회복 미션: ${substitution.reason}. ${exitCondition ? `종료 조건은 ${exitCondition}.` : "차단된 게이트 증거를 보강합니다."}`, 600),
      tasks: tasks.length
        ? tasks
        : [
            "차단된 게이트의 미충족 증거를 확인한다.",
            title,
            exitCondition ? `종료 조건을 충족하는 증거를 제출한다: ${exitCondition}` : "게이트 해제 증거를 제출한다.",
          ],
      output,
      dayType: "action",
      phase: cleanString(base.phase, 40),
      curriculumWeek: Number(base.curriculumWeek ?? base.curriculum_week) || null,
      substituted: true,
      substitutionReason: cleanString(substitution.reason, 120),
      exitCondition,
    };
  }

  return {
    day: dayNumber,
    title: cleanString(base.title, 300),
    shortTitle: cleanString(base.shortTitle, 80),
    summary: cleanString(base.summary, 600),
    tasks: cleanStringArray(base.tasks, 300),
    output: cleanString(base.output, 300),
    dayType: cleanString(base.dayType ?? base.day_type, 40),
    phase: cleanString(base.phase, 40),
    curriculumWeek: Number(base.curriculumWeek ?? base.curriculum_week) || null,
    substituted: false,
    substitutionReason: "",
    exitCondition: "",
  };
}

/**
 * Evidence spec per the common Day contract (spec §11.0): interview/action
 * days require evidence judged at medium trust or above; education/review
 * days only require the worksheet/decision record (no evidence gate).
 */
function buildEvidenceSpec(mission) {
  const evidenceFree = EVIDENCE_FREE_DAY_TYPES.has(mission.dayType);
  return {
    evidenceRequired: !evidenceFree,
    evidence_required: !evidenceFree,
    artifact: mission.output,
    allowedEvidenceTypes: evidenceFree ? [] : ["link", "file"],
    allowed_evidence_types: evidenceFree ? [] : ["link", "file"],
    minimumStrength: evidenceFree ? "" : "medium",
    minimum_strength: evidenceFree ? "" : "medium",
    completionSignal: evidenceFree
      ? "워크시트/결정 기록 완료"
      : "증거 제출 후 판정이 accepted 또는 verified가 되어야 합니다.",
    completion_signal: evidenceFree
      ? "워크시트/결정 기록 완료"
      : "증거 제출 후 판정이 accepted 또는 verified가 되어야 합니다.",
  };
}

function buildGateContext(gateEvaluation, day) {
  const gates = gateEvaluation?.gates && typeof gateEvaluation.gates === "object"
    ? gateEvaluation.gates
    : {};
  const states = {};
  for (const [gateId, gate] of Object.entries(gates)) {
    if (gate?.state) states[gateId] = String(gate.state);
  }
  const blocking = gateEvaluation?.blockingGate ?? null;
  return {
    day,
    blockingGateId: blocking?.gateId ?? null,
    blocking_gate_id: blocking?.gateId ?? null,
    states,
  };
}

function latestSubstitutionForDay(substitutions, day) {
  const list = Array.isArray(substitutions) ? substitutions : [];
  let latest = null;
  let latestTime = Number.NEGATIVE_INFINITY;
  let latestIndex = -1;
  for (let index = 0; index < list.length; index += 1) {
    const entry = list[index];
    if (!entry || Number(entry.day) !== day) continue;
    const recordedAt = Date.parse(String(entry.recordedAt ?? entry.recorded_at ?? ""));
    const time = Number.isFinite(recordedAt) ? recordedAt : Number.NEGATIVE_INFINITY;
    if (time > latestTime || (time === latestTime && index > latestIndex)) {
      latest = entry;
      latestTime = time;
      latestIndex = index;
    }
  }
  return latest;
}

function normalizeDay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const day = Math.trunc(number);
  return day >= 1 && day <= 400 ? day : null;
}

function cleanString(value = "", maxLength = 300) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanStringArray(value = [], maxLength = 300) {
  return (Array.isArray(value) ? value : [])
    .map((entry) => cleanString(entry, maxLength))
    .filter(Boolean);
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString();
}

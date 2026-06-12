/**
 * Office Hours intervention wiring (spec §13 — P1-1).
 *
 * Builds the `office_hours_intervention_required` bridge event (§13.1) and
 * the §13.2/§13.3 context block injected into an intervention-framed Office
 * Hours session. Question sets live in oh-intervention-prompts.mjs — a
 * trigger without an authored entry never fires (fail-closed, §13.3).
 *
 * Token flow (§13.4): a confirmed structured commitment closing an
 * intervention session issues the gate's pass-through token via
 * `issueInterventionTokenForCommitment` — once per gate, max
 * MAX_INTERVENTION_TOKENS program-wide, dueDay from the commitment.
 */

import { resolveInterventionPrompt } from "./oh-intervention-prompts.mjs";
import {
  GATE_IDS,
  issueGateInterventionToken,
} from "./program-gate-engine.mjs";

export const OH_INTERVENTION_EVENT_TYPE = "office_hours_intervention_required";

/** Milestone gates whose hard block triggers an immediate intervention (§13.1). */
export const INTERVENTION_GATE_IDS = Object.freeze([
  GATE_IDS.G2,
  GATE_IDS.G4,
  GATE_IDS.G5,
  GATE_IDS.G7,
]);

/** gateId → registered triggerId, or null (G1 uses the confession path). */
export function interventionTriggerForGate(gateId) {
  return INTERVENTION_GATE_IDS.includes(gateId) ? `gate_blocked_${gateId}` : null;
}

/**
 * Builds the intervention-required bridge event, or null when the trigger is
 * not registered (fail-closed — caller must not surface an intervention).
 */
export function buildInterventionRequiredEvent({
  workspaceRoot = "",
  triggerId,
  abbreviated = false,
  day = null,
} = {}) {
  const pack = resolveInterventionPrompt(triggerId, { abbreviated });
  if (!pack) return null;
  return {
    type: OH_INTERVENTION_EVENT_TYPE,
    workspaceRoot,
    intervention: {
      triggerId: pack.triggerId,
      trigger_id: pack.triggerId,
      severity: pack.severity,
      source: pack.source,
      gateId: pack.gateId,
      gate_id: pack.gateId,
      ruleId: pack.ruleId,
      rule_id: pack.ruleId,
      abbreviated: pack.abbreviated,
      questions: pack.questions,
      exitCondition: pack.exitCondition,
      exit_condition: pack.exitCondition,
      postSessionEvidence: pack.postSessionEvidence,
      post_session_evidence: pack.postSessionEvidence,
      day: normalizeDay(day),
    },
  };
}

/**
 * §13.2/§13.3 context block for an intervention-framed Office Hours session.
 * The existing OH context assembly (compiledTruth, digest, commitments)
 * stays as-is — this block adds the trigger frame, the fixed question set,
 * and the exit contract on top.
 */
export function buildInterventionContextBlock(triggerId, { abbreviated = false } = {}) {
  const pack = resolveInterventionPrompt(triggerId, { abbreviated });
  if (!pack) return "";
  const header = pack.gateId
    ? `이 세션은 ${pack.gateId} milestone gate 차단을 교정하는 intervention이다.`
    : pack.ruleId
      ? `이 세션은 adaptive rule ${pack.ruleId} 발동을 교정하는 intervention이다.`
      : "이 세션은 시스템이 선제 트리거한 intervention이다.";
  return [
    "[OFFICE HOURS INTERVENTION]",
    header,
    "진행 계약(§13.3): ① 현재 상태를 1문단으로 요약해 사용자의 확인/반박을 받는다.",
    "② 아래 고정 질문을 순서대로 다룬다:",
    ...pack.questions.map((question, index) => `${index + 1}. ${question}`),
    `③ 종료 조건: ${pack.exitCondition}.`,
    `④ 세션 후 의무: ${pack.postSessionEvidence}.`,
    "커밋먼트 없이 위로/조언만으로 세션을 끝내지 마라.",
  ].join("\n");
}

/**
 * Issues the §13.4 pass-through token for a commitment that closed an
 * intervention session. dueDay comes from the commitment (default: next
 * day). Returns the engine result (`issued`, `reason`, `totalIssued`).
 */
export async function issueInterventionTokenForCommitment({
  workspaceRoot,
  gateId,
  commitment = null,
  day = null,
  now = new Date(),
} = {}) {
  const dayNumber = normalizeDay(day) ?? 1;
  const dueDay = normalizeDay(commitment?.dueDay ?? commitment?.due_day) ?? dayNumber + 1;
  return issueGateInterventionToken({
    workspaceRoot,
    gateId,
    dueDay,
    expectedEvidenceKind: String(commitment?.expectedEvidenceKind ?? commitment?.expected_evidence_kind ?? ""),
    now,
  });
}

function normalizeDay(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return null;
  const day = Math.trunc(number);
  return day >= 0 && day <= 400 ? day : null;
}

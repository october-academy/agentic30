/**
 * Office Hours intervention question sets (spec §13.1–§13.3 — P1-1).
 *
 * This module OWNS the per-trigger fixed question sets (§13.3-2). Every
 * trigger in the §13.1 registry must be authored here; a trigger without an
 * entry must never fire an intervention (fail-closed —
 * `resolveInterventionPrompt` returns null and the caller aborts).
 *
 * Session contract (§13.3, identical for the abbreviated §13.3a form):
 * 1. one-paragraph current-state summary the founder can dispute,
 * 2. the trigger's fixed questions (abbreviated form: first 1–2 only),
 * 3. exit = ONE structured commitment (user-origin, audience=customer),
 * 4. post-session strong evidence due by the commitment's dueDay (§13.4).
 */

export const OH_INTERVENTION_PROMPTS_SCHEMA_VERSION = 1;

export const OH_INTERVENTION_SEVERITIES = Object.freeze({
  immediate: "immediate",
  scheduled: "scheduled",
});

/**
 * §13.1 trigger registry. Keys are triggerIds used on the
 * `office_hours_intervention_required` bridge event.
 */
export const OH_INTERVENTION_TRIGGERS = Object.freeze({
  gate_blocked_G2: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "gate_engine",
    gateId: "G2",
    questions: [
      "7일 동안 모은 증거 중 실제 고객에게서 온 것은 몇 개인가? 자기보고를 빼고 세어보라.",
      "go/no-go를 미루게 만드는 가장 두려운 반증은 무엇인가?",
      "오늘 닫을 수 있는 가장 작은 고객 검증 행동 1개는 무엇인가?",
    ],
  },
  gate_blocked_G4: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "gate_engine",
    gateId: "G4",
    questions: [
      "가격·받을 약속·기한이 있는 유료 ask를 보내지 못한 진짜 이유는 무엇인가?",
      "first_value 계측이 빠졌다면, 사용자의 첫 가치 행동을 한 문장으로 정의할 수 있는가?",
      "오늘 ask를 보낼 1명의 이름과 채널은 무엇인가?",
    ],
  },
  gate_blocked_G5: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "gate_engine",
    gateId: "G5",
    questions: [
      "지금까지 외부 유입이 0인 채널에 왜 머물러 있는가?",
      "다음 7일 동안 단 하나의 채널만 고른다면 무엇이고, 첫 포스트는 언제 나가는가?",
    ],
  },
  gate_blocked_G7: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "gate_engine",
    gateId: "G7",
    questions: [
      "continue/pivot/stop 중 증거가 가리키는 것은 무엇인가? 희망 말고 증거로 답하라.",
      "그 결정을 뒷받침하는 증거 3개를 proof ledger에서 지목할 수 있는가?",
    ],
  },
  rule_AR01: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "adaptive_rule",
    ruleId: "AR-01",
    questions: [
      "오늘 커밋이 검증한 고객 가설은 무엇인가? 없다면 무엇이 두려운가?",
      "지금 코드를 멈추고 보낼 수 있는 고객 메시지 1개는 무엇인가?",
    ],
  },
  rule_AR02: {
    severity: OH_INTERVENTION_SEVERITIES.scheduled,
    source: "adaptive_rule",
    ruleId: "AR-02",
    questions: [
      "이번 주 인터뷰 쿼터가 미달이다. 막고 있는 것은 후보 부족인가, 발송 공포인가?",
      "BIP radar 후보 3명 중 오늘 DM을 보낼 1명은 누구인가?",
    ],
  },
  rule_AR05: {
    severity: OH_INTERVENTION_SEVERITIES.scheduled,
    source: "adaptive_rule",
    ruleId: "AR-05",
    questions: [
      "3일째 같은 행동이 막혀 있다. 이 행동을 30분 안에 끝나는 단위로 쪼개면 첫 조각은 무엇인가?",
      "이 행동이 정말 지금 필요한가, 아니면 더 무서운 행동을 피하는 중인가?",
    ],
  },
  rule_AR07: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "adaptive_rule",
    ruleId: "AR-07",
    questions: [
      "이틀째 검증 가능한 증거가 없다. '했다'는 말 대신 보여줄 수 있는 것은 무엇인가?",
      "다음 행동의 증거는 URL/캡처/결제 중 무엇으로 남길 것인가?",
    ],
  },
  rule_AR14: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "adaptive_rule",
    ruleId: "AR-14",
    questions: [
      "결제 직전 무엇이 끊겼는지 고객 원문으로 말하라.",
      "가격·패키지·결제 경로 중 오늘 바꿔서 다시 제안할 1개는 무엇인가?",
    ],
  },
  rule_AR17: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "adaptive_rule",
    ruleId: "AR-17",
    questions: [
      "증거 없는 약속 위에 새 약속을 쌓고 있다. 기존 약속 중 오늘 닫을 1개는 무엇인가?",
      "그 약속을 못 지킨 진짜 이유는 무엇인가? 시간 문제인가, 회피인가?",
    ],
  },
  rule_AR19: {
    severity: OH_INTERVENTION_SEVERITIES.scheduled,
    source: "adaptive_rule",
    ruleId: "AR-19",
    questions: [
      "3일째 진행이 멈췄다. 멈춘 동안 가장 자주 떠오른 걱정은 무엇인가?",
      "내일이 아니라 오늘 끝낼 수 있는 가장 작은 행동 1개는 무엇인가?",
    ],
  },
  interview_confession: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "interview_gate",
    abbreviated: true,
    questions: [
      "이 인터뷰를 닫지 못하게 막는 것을 한 문장으로 말하라.",
      "그래도 오늘 보낼 수 있는 가장 작은 고객 행동 1개는 무엇인가?",
    ],
  },
  day6_ask_fear: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "per_day",
    abbreviated: true,
    questions: [
      "ask 문장을 지금 같이 쓰자. 가격·받을 약속·기한 중 비어 있는 칸은 무엇인가?",
      "거절당하면 실제로 무엇을 잃는가?",
    ],
  },
  day13_interview_quota: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "per_day",
    questions: [
      "13일째 인터뷰가 3건 미만이다. 인터뷰 없이 내린 결정 중 가장 위험한 것은 무엇인가?",
      "오늘 연락할 후보 3명과 첫 문장은 무엇인가?",
    ],
  },
  day21_channel_reselect: {
    severity: OH_INTERVENTION_SEVERITIES.immediate,
    source: "per_day",
    questions: [
      "유입이 실측되지 않는다. 지금 채널을 고른 근거는 데이터인가 익숙함인가?",
      "다음 실험 채널 1개와 첫 포스트 일정은 무엇인가?",
    ],
  },
  recommendation_confidence_low: {
    severity: OH_INTERVENTION_SEVERITIES.scheduled,
    source: "gate_engine",
    questions: [
      "시스템이 다음 행동을 확신 있게 고르지 못했다. 지금 증거로 보면 가장 정보가 부족한 질문은 무엇인가?",
      "그 질문에 답을 줄 가장 싼 검증 행동 1개는 무엇인가?",
    ],
  },
  manual: {
    severity: OH_INTERVENTION_SEVERITIES.scheduled,
    source: "user",
    questions: [
      "오늘 가장 막혀 있는 것 1개는 무엇인가?",
    ],
  },
});

/**
 * Returns the prompt pack for a trigger, or null when the trigger is not in
 * the registry (fail-closed §13.3 — caller must NOT run the intervention).
 */
export function resolveInterventionPrompt(triggerId, { abbreviated = false } = {}) {
  const entry = OH_INTERVENTION_TRIGGERS[String(triggerId || "")];
  if (!entry) return null;
  const useAbbreviated = abbreviated || entry.abbreviated === true;
  const questions = useAbbreviated ? entry.questions.slice(0, 2) : [...entry.questions];
  return {
    schemaVersion: OH_INTERVENTION_PROMPTS_SCHEMA_VERSION,
    triggerId: String(triggerId),
    trigger_id: String(triggerId),
    severity: entry.severity,
    source: entry.source,
    gateId: entry.gateId ?? null,
    gate_id: entry.gateId ?? null,
    ruleId: entry.ruleId ?? null,
    rule_id: entry.ruleId ?? null,
    abbreviated: useAbbreviated,
    questions,
    exitCondition: "구조화 커밋먼트 1개(고객·채널·메시지·기대증거·기한, user-origin, audience=customer) 확정",
    exit_condition: "구조화 커밋먼트 1개(고객·채널·메시지·기대증거·기한, user-origin, audience=customer) 확정",
    postSessionEvidence: "커밋먼트의 expectedEvidenceKind에 따른 strong 증거를 dueDay 안에 제출",
    post_session_evidence: "커밋먼트의 expectedEvidenceKind에 따른 strong 증거를 dueDay 안에 제출",
  };
}

/** All registered trigger ids (for registry/fail-closed tests). */
export function listInterventionTriggerIds() {
  return Object.keys(OH_INTERVENTION_TRIGGERS);
}

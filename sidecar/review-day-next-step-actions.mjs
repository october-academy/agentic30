export const REVIEW_DAY_NEXT_STEP_ACTIONS_SCHEMA_VERSION = 1;
export const REVIEW_DAY_NEXT_STEP_FALLBACK_SCHEMA_VERSION = 1;

const DEFAULT_COMPLETION_SIGNAL = "실행 증거 링크나 파일 1개";
const DEFAULT_VERIFICATION_METHOD = "evidence_submission";
const DEFAULT_CTA_TEXT = "10분만 실행해보세요";
const DEFAULT_NEXT_STEP = "오늘 Review 질문 1개에 먼저 답하고 다음 Action을 작게 정해보세요.";
const DEFAULT_MIN_INSIGHT_CONFIDENCE = 0.55;

const FALLBACK_NEXT_STEPS = Object.freeze({
  empty_insights: "Review Day에서 가장 중요한 미완료 Action 1개를 고르고 10분 안에 증거를 남기기",
  low_confidence_insights: "확신이 낮은 insight 1개를 검증할 수 있는 작은 증거를 하나 추가하기",
  malformed_insights: "Review Day dashboard의 원자료를 열어 다음 Action 1개와 완료 신호를 다시 정리하기",
});

const SOURCE_PRIORITY = Object.freeze({
  carry_over: 100,
  incomplete_action: 90,
  verification: 80,
  curriculum: 70,
  workspace: 60,
  summary: 50,
  dashboard: 40,
  custom: 30,
  fallback: 10,
});

export function resolveReviewDayNextStepFallbackBehavior({
  reviewDay = null,
  dayRange = null,
  nextDay = null,
  insights = null,
  minInsightConfidence = DEFAULT_MIN_INSIGHT_CONFIDENCE,
  min_insight_confidence = null,
  now = new Date(),
} = {}) {
  const targetDay = normalizeDayNumber(reviewDay) ?? 7;
  const normalizedDayRange = normalizeDayRange(dayRange);
  const generatedAt = toIso(now);
  const threshold = normalizeConfidenceThreshold(min_insight_confidence ?? minInsightConfidence);
  const insightHealth = evaluateInsightInputHealth(insights, threshold);
  const fallbackReason = resolveInsightFallbackReason(insightHealth);
  const fallbackRequired = fallbackReason !== "usable_insights_available";
  const actionBundle = fallbackRequired
    ? formatReviewDayNextStepActions({
      reviewDay: targetDay,
      dayRange: normalizedDayRange,
      nextDay,
      actionItems: [{
        id: `review-day-${targetDay}-${fallbackReason}`,
        sourceType: "fallback",
        title: "Review Day 다음 행동 보정",
        actionText: FALLBACK_NEXT_STEPS[fallbackReason] ?? DEFAULT_NEXT_STEP,
        completionSignal: "보강한 증거 링크나 파일 1개",
        verificationMethod: "evidence_submission",
        coachingFeedback: "insight가 부족해도 오늘 진행은 막지 않습니다. 작게 실행하고 다음 Day로 넘어가도 됩니다.",
      }],
      maxActions: 1,
      now: generatedAt,
    })
    : null;

  return {
    schemaVersion: REVIEW_DAY_NEXT_STEP_FALLBACK_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_NEXT_STEP_FALLBACK_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_next_step_fallback.v1",
    generatedAt,
    generated_at: generatedAt,
    reviewDay: targetDay,
    review_day: targetDay,
    dayRange: normalizedDayRange,
    day_range: normalizedDayRange,
    nextDay: normalizeDayNumber(nextDay),
    next_day: normalizeDayNumber(nextDay),
    minInsightConfidence: threshold,
    min_insight_confidence: threshold,
    fallbackRequired,
    fallback_required: fallbackRequired,
    fallbackReason,
    fallback_reason: fallbackReason,
    insightHealth,
    insight_health: insightHealth,
    actionCount: actionBundle?.actionCount ?? 0,
    action_count: actionBundle?.action_count ?? 0,
    actions: actionBundle?.actions ?? [],
    userFacingActionTexts: actionBundle?.userFacingActionTexts ?? [],
    user_facing_action_texts: actionBundle?.user_facing_action_texts ?? [],
  };
}

export function formatReviewDayNextStepActions({
  reviewDay = null,
  dayRange = null,
  actionItems = null,
  action_items = null,
  unresolvedActions = null,
  unresolved_actions = null,
  carryOverQueue = null,
  carry_over_queue = null,
  nextDay = null,
  maxActions = 5,
  now = new Date(),
} = {}) {
  const targetDay = normalizeDayNumber(reviewDay) ?? 7;
  const normalizedDayRange = normalizeDayRange(dayRange);
  const generatedAt = toIso(now);
  const sources = [
    ...normalizeCarryOverActions(carryOverQueue ?? carry_over_queue),
    ...normalizeUnresolvedActions(unresolvedActions ?? unresolved_actions),
    ...normalizeActionItems(actionItems ?? action_items),
  ];
  const fallbackUsed = sources.length === 0;
  const normalizedActions = (fallbackUsed ? normalizeActionItems([DEFAULT_NEXT_STEP], "fallback") : sources)
    .map((action, index) => normalizeNextStepAction(action, {
      reviewDay: targetDay,
      dayRange: normalizedDayRange,
      nextDay,
      index,
    }))
    .filter(Boolean)
    .sort(compareNextStepActions)
    .slice(0, normalizeMaxActions(maxActions))
    .map((action, index) => ({
      ...action,
      rank: index + 1,
      displayOrder: index + 1,
      display_order: index + 1,
      ...buildUserFacingTextFields({ ...action, rank: index + 1 }),
    }));

  return {
    schemaVersion: REVIEW_DAY_NEXT_STEP_ACTIONS_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_NEXT_STEP_ACTIONS_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_next_step_actions.v1",
    generatedAt,
    generated_at: generatedAt,
    reviewDay: targetDay,
    review_day: targetDay,
    dayRange: normalizedDayRange,
    day_range: normalizedDayRange,
    nextDay: normalizeDayNumber(nextDay),
    next_day: normalizeDayNumber(nextDay),
    actionCount: normalizedActions.length,
    action_count: normalizedActions.length,
    fallbackUsed,
    fallback_used: fallbackUsed,
    actions: normalizedActions,
    userFacingActionTexts: normalizedActions.map((action) => action.userFacingText),
    user_facing_action_texts: normalizedActions.map((action) => action.userFacingText),
  };
}

function evaluateInsightInputHealth(value, threshold) {
  const entries = Array.isArray(value) ? value : [];
  const malformedInput = value != null && !Array.isArray(value) ? 1 : 0;
  let usableCount = 0;
  let lowConfidenceCount = 0;
  let malformedCount = malformedInput;
  const normalizedInsights = [];

  for (const [index, entry] of entries.entries()) {
    const normalized = normalizeFallbackInsight(entry, index);
    if (!normalized) {
      malformedCount += 1;
      continue;
    }
    normalizedInsights.push(normalized);
    if (normalized.confidence >= threshold) {
      usableCount += 1;
    } else {
      lowConfidenceCount += 1;
    }
  }

  return {
    insightCount: entries.length,
    insight_count: entries.length,
    usableInsightCount: usableCount,
    usable_insight_count: usableCount,
    lowConfidenceInsightCount: lowConfidenceCount,
    low_confidence_insight_count: lowConfidenceCount,
    malformedInsightCount: malformedCount,
    malformed_insight_count: malformedCount,
    validInsightCount: normalizedInsights.length,
    valid_insight_count: normalizedInsights.length,
    insights: normalizedInsights,
  };
}

function normalizeFallbackInsight(value, index) {
  if (typeof value === "string") {
    const text = stringOrDefault(value, "");
    if (!text) return null;
    return {
      id: `insight-${index + 1}`,
      text,
      confidence: 0,
    };
  }
  const raw = objectOrEmpty(value);
  const text = stringOrDefault(raw.text ?? raw.insight ?? raw.summary ?? raw.description, "");
  if (!text) return null;
  return {
    id: stringOrDefault(raw.id ?? raw.insight_id ?? raw.insightId, `insight-${index + 1}`),
    text,
    confidence: normalizeInsightConfidence(raw.confidence ?? raw.confidence_score ?? raw.score),
  };
}

function resolveInsightFallbackReason(health) {
  if (health.usableInsightCount > 0) return "usable_insights_available";
  if (health.insightCount === 0 && health.malformedInsightCount === 0) return "empty_insights";
  if (health.validInsightCount === 0 && health.malformedInsightCount > 0) return "malformed_insights";
  if (health.lowConfidenceInsightCount > 0) return "low_confidence_insights";
  return "malformed_insights";
}

export function formatReviewDayNextStepActionText(action = {}) {
  const rank = normalizeNumber(action.rank ?? action.displayOrder ?? action.display_order, 1);
  const normalized = normalizeNextStepAction(action, {
    reviewDay: normalizeDayNumber(action.reviewDay ?? action.review_day) ?? 7,
    dayRange: normalizeDayRange(action.dayRange ?? action.day_range),
    nextDay: action.nextDay ?? action.next_day,
    index: rank - 1,
  }) ?? normalizeNextStepAction({
    sourceType: "fallback",
    actionText: DEFAULT_NEXT_STEP,
  }, {
    reviewDay: normalizeDayNumber(action.reviewDay ?? action.review_day) ?? 7,
    dayRange: normalizeDayRange(action.dayRange ?? action.day_range),
    nextDay: action.nextDay ?? action.next_day,
    index: rank - 1,
  });
  return buildUserFacingText({
    ...normalized,
    rank,
  });
}

function normalizeCarryOverActions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    const raw = objectOrEmpty(entry);
    return {
      id: raw.id ?? raw.action_id ?? raw.actionId ?? `carry-over-${index + 1}`,
      sourceType: "carry_over",
      sourceDay: raw.source_day ?? raw.sourceDay,
      title: raw.title ?? `Day ${raw.source_day ?? raw.sourceDay ?? "?"} carry-over`,
      actionText: raw.action_description ?? raw.actionDescription ?? raw.description ?? raw.task,
      completionSignal: raw.completion_signal ?? raw.completionSignal,
      verificationMethod: raw.verification_method ?? raw.verificationMethod,
      coachingFeedback: raw.coaching_feedback ?? raw.coachingFeedback,
      originalIndex: index,
    };
  });
}

function normalizeUnresolvedActions(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (typeof entry === "string") {
      return {
        id: `unresolved-${index + 1}`,
        sourceType: "incomplete_action",
        actionText: entry,
        originalIndex: index,
      };
    }
    const raw = objectOrEmpty(entry);
    return {
      id: raw.id ?? raw.action_id ?? raw.actionId ?? `unresolved-${index + 1}`,
      sourceType: raw.source_type ?? raw.sourceType ?? "incomplete_action",
      sourceDay: raw.source_day ?? raw.sourceDay ?? raw.day ?? raw.day_id ?? raw.dayId,
      title: raw.title,
      actionText: raw.action_text ?? raw.actionText ?? raw.action_description ?? raw.actionDescription ?? raw.description ?? raw.task,
      completionSignal: raw.completion_signal ?? raw.completionSignal,
      verificationMethod: raw.verification_method ?? raw.verificationMethod,
      coachingFeedback: raw.coaching_feedback ?? raw.coachingFeedback,
      originalIndex: index,
    };
  });
}

function normalizeActionItems(value, fallbackSourceType = "dashboard") {
  if (!Array.isArray(value)) return [];
  return value.map((entry, index) => {
    if (typeof entry === "string") {
      return {
        id: `${fallbackSourceType}-${index + 1}`,
        sourceType: fallbackSourceType,
        actionText: entry,
        originalIndex: index,
      };
    }
    const raw = objectOrEmpty(entry);
    return {
      id: raw.id ?? raw.action_id ?? raw.actionId ?? `${fallbackSourceType}-${index + 1}`,
      sourceType: raw.source_type ?? raw.sourceType ?? fallbackSourceType,
      sourceDay: raw.source_day ?? raw.sourceDay ?? raw.day ?? raw.day_id ?? raw.dayId,
      title: raw.title ?? raw.label,
      actionText: raw.action_text ?? raw.actionText ?? raw.text ?? raw.description ?? raw.task,
      completionSignal: raw.completion_signal ?? raw.completionSignal,
      verificationMethod: raw.verification_method ?? raw.verificationMethod,
      coachingFeedback: raw.coaching_feedback ?? raw.coachingFeedback,
      priority: raw.priority,
      originalIndex: index,
    };
  });
}

function normalizeNextStepAction(value, context) {
  const raw = objectOrEmpty(value);
  const actionText = stringOrDefault(raw.actionText ?? raw.action_text ?? raw.text ?? raw.description, "");
  if (!actionText) return null;
  const sourceType = normalizeSourceType(raw.sourceType ?? raw.source_type);
  const sourceDay = normalizeDayNumber(raw.sourceDay ?? raw.source_day);
  const title = stringOrDefault(raw.title, buildTitle({ sourceType, sourceDay, nextDay: context.nextDay }));
  const completionSignal = stringOrDefault(raw.completionSignal ?? raw.completion_signal, DEFAULT_COMPLETION_SIGNAL);
  const verificationMethod = stringOrDefault(raw.verificationMethod ?? raw.verification_method, DEFAULT_VERIFICATION_METHOD);
  const coachingFeedback = stringOrDefault(raw.coachingFeedback ?? raw.coaching_feedback, "");
  const priority = normalizeNumber(raw.priority, SOURCE_PRIORITY[sourceType] ?? SOURCE_PRIORITY.custom);

  return {
    id: stringOrDefault(raw.id, `${sourceType}-${context.reviewDay}-${context.index + 1}`),
    rank: context.index + 1,
    displayOrder: context.index + 1,
    display_order: context.index + 1,
    sourceType,
    source_type: sourceType,
    sourceDay,
    source_day: sourceDay,
    reviewDay: context.reviewDay,
    review_day: context.reviewDay,
    dayRange: context.dayRange,
    day_range: context.dayRange,
    priority,
    title,
    actionText,
    action_text: actionText,
    instructionText: buildInstructionText(actionText),
    instruction_text: buildInstructionText(actionText),
    completionSignal,
    completion_signal: completionSignal,
    verificationMethod,
    verification_method: verificationMethod,
    nonBlocking: true,
    non_blocking: true,
    ctaText: DEFAULT_CTA_TEXT,
    cta_text: DEFAULT_CTA_TEXT,
    coachingFeedback,
    coaching_feedback: coachingFeedback,
    originalIndex: normalizeNumber(raw.originalIndex ?? raw.original_index, context.index),
    original_index: normalizeNumber(raw.originalIndex ?? raw.original_index, context.index),
  };
}

function buildInstructionText(actionText) {
  const text = String(actionText ?? "").trim().replace(/\s+/g, " ");
  if (!text) return DEFAULT_NEXT_STEP;
  return /해보세요[.!?。]*$/u.test(text) ? text : `${text.replace(/[.!?。]+$/u, "")} 해보세요.`;
}

function buildUserFacingText(action) {
  const parts = [
    `${action.rank}. ${action.title}`,
    action.instructionText,
    `완료 신호: ${action.completionSignal}`,
    `확인 방식: ${action.verificationMethod}`,
  ];
  if (action.coachingFeedback) parts.push(action.coachingFeedback);
  parts.push("미완료여도 다음 Day 진행은 막지 않습니다.");
  return parts.join(" | ");
}

function buildUserFacingTextFields(action) {
  const text = buildUserFacingText(action);
  return {
    userFacingText: text,
    user_facing_text: text,
  };
}

function buildTitle({ sourceType, sourceDay, nextDay }) {
  if (sourceType === "carry_over" && sourceDay) return `Day ${sourceDay} carry-over 닫기`;
  if (sourceType === "incomplete_action" && sourceDay) return `Day ${sourceDay} 미완료 Action 닫기`;
  if (sourceType === "verification") return "검증 증거 보강";
  if (sourceType === "curriculum") return "다음 커리큘럼 행동";
  if (sourceType === "workspace") return "워크스페이스 증거 정리";
  if (nextDay) return `Day ${normalizeDayNumber(nextDay)} 시작 행동`;
  return "다음 행동";
}

function compareNextStepActions(a, b) {
  if (b.priority !== a.priority) return b.priority - a.priority;
  const aDay = a.sourceDay ?? Number.MAX_SAFE_INTEGER;
  const bDay = b.sourceDay ?? Number.MAX_SAFE_INTEGER;
  if (aDay !== bDay) return aDay - bDay;
  return a.originalIndex - b.originalIndex;
}

function normalizeSourceType(value) {
  const sourceType = String(value ?? "").trim().toLowerCase().replace(/[\s-]+/g, "_");
  return SOURCE_PRIORITY[sourceType] ? sourceType : "custom";
}

function normalizeDayRange(value) {
  const raw = objectOrEmpty(value);
  const start = normalizeDayNumber(raw.start ?? raw.from);
  const end = normalizeDayNumber(raw.end ?? raw.to);
  if (!start || !end) return null;
  return { start: Math.min(start, end), end: Math.max(start, end) };
}

function normalizeDayNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function normalizeMaxActions(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 5;
  return Math.min(10, Math.max(1, Math.trunc(n)));
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.trunc(n);
}

function normalizeConfidenceThreshold(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return DEFAULT_MIN_INSIGHT_CONFIDENCE;
  return Math.min(1, Math.max(0, n));
}

function normalizeInsightConfidence(value) {
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "high") return 0.9;
    if (normalized === "medium") return 0.65;
    if (normalized === "low") return 0.35;
  }
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.min(1, Math.max(0, n));
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

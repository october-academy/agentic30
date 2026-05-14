export const REVIEW_DAY_CURATED_INSIGHT_RELEVANCE_SCHEMA_VERSION = 1;

const DEFAULT_MAX_INSIGHTS_PER_STEP = 1;
const DEFAULT_MIN_SCORE = 1;

const SOURCE_WEIGHTS = Object.freeze({
  verification: 18,
  curriculum: 14,
  coaching: 12,
  workspace: 10,
  summary: 8,
  dashboard: 6,
  custom: 4,
});

const DOMAIN_KEYWORDS = Object.freeze({
  evidence: ["evidence", "proof", "verify", "verification", "verified", "signal", "증거", "검증", "확인"],
  interview: ["interview", "customer", "quote", "candidate", "pain", "인터뷰", "고객", "후보", "인용"],
  bip: ["bip", "public", "post", "build", "sns", "공개", "게시", "글"],
  workspace: ["workspace", "doc", "sheet", "goal", "spec", "readme", "워크스페이스", "문서", "시트"],
  pricing: ["price", "pricing", "ask", "paid", "revenue", "가격", "유료", "매출"],
  carryOver: ["carry", "incomplete", "unresolved", "pending", "미완료", "이월", "보류"],
  pace: ["rush", "rushing", "pace", "prerequisite", "difficulty", "속도", "선행", "난이도"],
});

const STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "as",
  "at",
  "by",
  "day",
  "for",
  "from",
  "in",
  "is",
  "it",
  "of",
  "on",
  "or",
  "the",
  "to",
  "with",
  "개",
  "것",
  "다음",
  "오늘",
  "하기",
  "해보세요",
]);

export function selectCuratedInsightsForNextSteps({
  nextSteps = null,
  next_steps = null,
  actions = null,
  insights = [],
  maxInsightsPerStep = DEFAULT_MAX_INSIGHTS_PER_STEP,
  max_insights_per_step = null,
  minScore = DEFAULT_MIN_SCORE,
  min_score = null,
} = {}) {
  const normalizedSteps = normalizeNextSteps(nextSteps ?? next_steps ?? actions);
  const normalizedInsights = normalizeInsights(insights);
  const limit = normalizePositiveInteger(max_insights_per_step ?? maxInsightsPerStep, DEFAULT_MAX_INSIGHTS_PER_STEP);
  const threshold = normalizeNumber(min_score ?? minScore, DEFAULT_MIN_SCORE);
  const mappings = normalizedSteps.map((nextStep) => {
    const scoredInsights = normalizedInsights
      .map((insight) => {
        const scoring = scoreCuratedInsightForNextStep({ nextStep, insight });
        return {
          ...insight,
          relevanceScore: scoring.score,
          relevance_score: scoring.score,
          relevanceReasons: scoring.reasons,
          relevance_reasons: scoring.reasons,
        };
      })
      .filter((insight) => insight.relevanceScore >= threshold)
      .sort(compareScoredInsights)
      .slice(0, limit)
      .map((insight, index) => ({
        ...insight,
        rank: index + 1,
        relevanceRank: index + 1,
        relevance_rank: index + 1,
      }));
    const topInsight = scoredInsights[0] ?? null;
    return {
      nextStepId: nextStep.id,
      next_step_id: nextStep.id,
      nextStepText: nextStep.text,
      next_step_text: nextStep.text,
      nextStep,
      next_step: nextStep,
      selectedInsights: scoredInsights,
      selected_insights: scoredInsights,
      topInsight,
      top_insight: topInsight,
      topInsightId: topInsight?.id ?? null,
      top_insight_id: topInsight?.id ?? null,
      topInsightText: topInsight?.text ?? "",
      top_insight_text: topInsight?.text ?? "",
      relevanceScore: topInsight?.relevanceScore ?? 0,
      relevance_score: topInsight?.relevanceScore ?? 0,
    };
  });

  return {
    schemaVersion: REVIEW_DAY_CURATED_INSIGHT_RELEVANCE_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_CURATED_INSIGHT_RELEVANCE_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_curated_insight_relevance.v1",
    nextStepCount: normalizedSteps.length,
    next_step_count: normalizedSteps.length,
    insightCount: normalizedInsights.length,
    insight_count: normalizedInsights.length,
    maxInsightsPerStep: limit,
    max_insights_per_step: limit,
    minScore: threshold,
    min_score: threshold,
    mappings,
    selectedInsightIds: mappings.flatMap((mapping) => mapping.selectedInsights.map((insight) => insight.id)),
    selected_insight_ids: mappings.flatMap((mapping) => mapping.selectedInsights.map((insight) => insight.id)),
  };
}

export function scoreCuratedInsightForNextStep({ nextStep = {}, insight = {} } = {}) {
  const step = normalizeNextStep(nextStep, 0);
  const normalizedInsight = normalizeInsight(insight, 0);
  const reasons = [];
  let score = 0;

  const directLinkScore = scoreDirectLinks(step, normalizedInsight);
  if (directLinkScore > 0) {
    score += directLinkScore;
    reasons.push("direct_action_or_dependency_link");
  }

  if (step.sourceDay && normalizedInsight.sourceDay && step.sourceDay === normalizedInsight.sourceDay) {
    score += 24;
    reasons.push("same_source_day");
  }

  const dependencyOverlap = intersect(step.dependencyRefs, normalizedInsight.dependencyRefs);
  if (dependencyOverlap.length) {
    score += Math.min(36, dependencyOverlap.length * 18);
    reasons.push("dependency_overlap");
  }

  if (step.sourceType !== "custom" && step.sourceType === normalizedInsight.sourceType) {
    score += 10;
    reasons.push("same_source_type");
  }

  const sourceWeight = SOURCE_WEIGHTS[normalizedInsight.sourceType] ?? SOURCE_WEIGHTS.custom;
  score += sourceWeight;
  reasons.push(`insight_source_${normalizedInsight.sourceType}`);

  const tokenOverlap = intersect(step.tokens, normalizedInsight.tokens);
  if (tokenOverlap.length) {
    score += Math.min(42, tokenOverlap.length * 6);
    reasons.push("text_token_overlap");
  }

  const domainOverlap = intersect(step.domainTags, normalizedInsight.domainTags);
  if (domainOverlap.length) {
    score += Math.min(36, domainOverlap.length * 12);
    reasons.push("domain_keyword_overlap");
  }

  if (normalizedInsight.priority > 0) {
    score += Math.min(20, normalizedInsight.priority);
    reasons.push("explicit_insight_priority");
  }

  return {
    schemaVersion: REVIEW_DAY_CURATED_INSIGHT_RELEVANCE_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_CURATED_INSIGHT_RELEVANCE_SCHEMA_VERSION,
    score,
    reasons,
  };
}

function scoreDirectLinks(step, insight) {
  let score = 0;
  if (step.id && insight.relatedActionIds.includes(step.id)) score += 90;
  if (step.id && insight.relatedNextStepIds.includes(step.id)) score += 90;
  if (step.sourceDay && insight.relatedDays.includes(step.sourceDay)) score += 28;
  return score;
}

function normalizeNextSteps(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeNextStep)
    .filter((step) => step.text);
}

function normalizeNextStep(value, index = 0) {
  if (typeof value === "string") {
    return buildNormalizedNextStep({
      id: `next-step-${index + 1}`,
      text: value,
      index,
    });
  }
  const raw = objectOrEmpty(value);
  return buildNormalizedNextStep({
    id: raw.id ?? raw.action_id ?? raw.actionId ?? `next-step-${index + 1}`,
    text: raw.actionText
      ?? raw.action_text
      ?? raw.instructionText
      ?? raw.instruction_text
      ?? raw.text
      ?? raw.description
      ?? raw.task,
    title: raw.title ?? raw.label,
    sourceDay: raw.sourceDay ?? raw.source_day ?? raw.day ?? raw.day_id ?? raw.dayId,
    sourceType: raw.sourceType ?? raw.source_type,
    dependencyRefs: raw.dependencyRefs ?? raw.dependency_refs ?? raw.dependencies,
    tags: raw.tags ?? raw.domainTags ?? raw.domain_tags,
    index,
  });
}

function buildNormalizedNextStep({
  id,
  text,
  title = "",
  sourceDay = null,
  sourceType = "custom",
  dependencyRefs = [],
  tags = [],
  index = 0,
}) {
  const normalizedText = normalizeText(text);
  const fullText = [title, normalizedText].filter(Boolean).join(" ");
  const tokens = tokenize(fullText);
  return {
    id: normalizeText(id) || `next-step-${index + 1}`,
    text: normalizedText,
    title: normalizeText(title),
    sourceDay: normalizeDayNumber(sourceDay),
    source_day: normalizeDayNumber(sourceDay),
    sourceType: normalizeSourceType(sourceType),
    source_type: normalizeSourceType(sourceType),
    dependencyRefs: normalizeStringArray(dependencyRefs).map(normalizeKey).filter(Boolean),
    dependency_refs: normalizeStringArray(dependencyRefs).map(normalizeKey).filter(Boolean),
    tokens,
    domainTags: normalizeDomainTags(fullText, tags),
    domain_tags: normalizeDomainTags(fullText, tags),
    originalIndex: index,
    original_index: index,
  };
}

function normalizeInsights(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeInsight)
    .filter((insight) => insight.text);
}

function normalizeInsight(value, index = 0) {
  if (typeof value === "string") {
    return buildNormalizedInsight({
      id: `insight-${index + 1}`,
      text: value,
      index,
    });
  }
  const raw = objectOrEmpty(value);
  return buildNormalizedInsight({
    id: raw.id ?? raw.insight_id ?? raw.insightId ?? `insight-${index + 1}`,
    text: raw.text ?? raw.insight ?? raw.summary ?? raw.description,
    sourceDay: raw.sourceDay ?? raw.source_day ?? raw.day ?? raw.day_id ?? raw.dayId,
    sourceType: raw.sourceType ?? raw.source_type ?? raw.sourceCategory ?? raw.source_category,
    dependencyRefs: raw.dependencyRefs ?? raw.dependency_refs ?? raw.dependencies,
    tags: raw.tags ?? raw.domainTags ?? raw.domain_tags,
    relatedActionIds: raw.relatedActionIds ?? raw.related_action_ids ?? raw.actionIds ?? raw.action_ids,
    relatedNextStepIds: raw.relatedNextStepIds ?? raw.related_next_step_ids ?? raw.nextStepIds ?? raw.next_step_ids,
    relatedDays: raw.relatedDays ?? raw.related_days,
    priority: raw.priority ?? raw.priorityScore ?? raw.priority_score,
    index,
  });
}

function buildNormalizedInsight({
  id,
  text,
  sourceDay = null,
  sourceType = "custom",
  dependencyRefs = [],
  tags = [],
  relatedActionIds = [],
  relatedNextStepIds = [],
  relatedDays = [],
  priority = 0,
  index = 0,
}) {
  const normalizedText = normalizeText(text);
  const tokens = tokenize(normalizedText);
  return {
    id: normalizeText(id) || `insight-${index + 1}`,
    text: normalizedText,
    sourceDay: normalizeDayNumber(sourceDay),
    source_day: normalizeDayNumber(sourceDay),
    sourceType: normalizeSourceType(sourceType),
    source_type: normalizeSourceType(sourceType),
    dependencyRefs: normalizeStringArray(dependencyRefs).map(normalizeKey).filter(Boolean),
    dependency_refs: normalizeStringArray(dependencyRefs).map(normalizeKey).filter(Boolean),
    relatedActionIds: normalizeStringArray(relatedActionIds).map(normalizeText).filter(Boolean),
    related_action_ids: normalizeStringArray(relatedActionIds).map(normalizeText).filter(Boolean),
    relatedNextStepIds: normalizeStringArray(relatedNextStepIds).map(normalizeText).filter(Boolean),
    related_next_step_ids: normalizeStringArray(relatedNextStepIds).map(normalizeText).filter(Boolean),
    relatedDays: normalizeNumberArray(relatedDays),
    related_days: normalizeNumberArray(relatedDays),
    tokens,
    domainTags: normalizeDomainTags(normalizedText, tags),
    domain_tags: normalizeDomainTags(normalizedText, tags),
    priority: normalizeNumber(priority, 0),
    originalIndex: index,
    original_index: index,
  };
}

function compareScoredInsights(a, b) {
  if (b.relevanceScore !== a.relevanceScore) return b.relevanceScore - a.relevanceScore;
  const sourceDelta = sourceOrder(a.sourceType) - sourceOrder(b.sourceType);
  if (sourceDelta !== 0) return sourceDelta;
  if (a.sourceDay !== b.sourceDay) return (a.sourceDay ?? Number.MAX_SAFE_INTEGER) - (b.sourceDay ?? Number.MAX_SAFE_INTEGER);
  return a.originalIndex - b.originalIndex;
}

function sourceOrder(value) {
  const keys = Object.keys(SOURCE_WEIGHTS);
  const index = keys.indexOf(normalizeSourceType(value));
  return index === -1 ? keys.length : index;
}

function tokenize(value) {
  const rawTokens = String(value ?? "")
    .toLowerCase()
    .normalize("NFKC")
    .replace(/[^\p{L}\p{N}_/-]+/gu, " ")
    .split(/\s+/u)
    .map((token) => token.trim().replace(/^[-_/]+|[-_/]+$/g, ""))
    .filter((token) => token.length >= 2 && !STOP_WORDS.has(token));
  return [...new Set(rawTokens.map(normalizeToken).filter(Boolean))];
}

function normalizeToken(token) {
  return String(token ?? "")
    .toLowerCase()
    .replace(/[-_/]+/g, "")
    .replace(/s$/i, "");
}

function normalizeDomainTags(text, explicitTags = []) {
  const haystack = String(text ?? "").toLowerCase();
  const tags = new Set(normalizeStringArray(explicitTags).map(normalizeKey).filter(Boolean));
  for (const [domain, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
    if (keywords.some((keyword) => haystack.includes(keyword.toLowerCase()))) {
      tags.add(normalizeKey(domain));
    }
  }
  return [...tags].sort();
}

function intersect(a = [], b = []) {
  const bSet = new Set(b);
  return [...new Set(a)].filter((item) => bSet.has(item));
}

function normalizeSourceType(value) {
  const sourceType = normalizeKey(value);
  return SOURCE_WEIGHTS[sourceType] ? sourceType : "custom";
}

function normalizeDayNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function normalizePositiveInteger(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(1, Math.trunc(n));
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return n;
}

function normalizeNumberArray(value) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map(normalizeDayNumber).filter(Boolean))];
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map(normalizeText).filter(Boolean);
}

function normalizeKey(value) {
  return normalizeText(value).toLowerCase().replace(/[\s-]+/g, "_");
}

function normalizeText(value) {
  return String(value ?? "").trim().replace(/\s+/g, " ");
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

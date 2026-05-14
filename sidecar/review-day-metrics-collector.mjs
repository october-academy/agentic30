import { normalizeReviewDashboard } from "./review-dashboard-presentation.mjs";
import {
  collectReviewDayCurriculumSignals,
  normalizeReviewDayCurriculumSignals,
} from "./review-day-curriculum-signals.mjs";
import {
  collectReviewDayWorkspaceSignals,
  normalizeReviewDayWorkspaceSignals,
} from "./review-day-workspace-signals.mjs";

export const REVIEW_DAY_METRICS_COLLECTOR_SCHEMA_VERSION = 1;
export const REVIEW_DAY_PRIORITY_SCHEMA_VERSION = 1;
export const REVIEW_DAY_DISPLAY_LIMITS = Object.freeze({
  curatedMetrics: 6,
  curated_metrics: 6,
  agentInsights: 5,
  agent_insights: 5,
  actionItems: 5,
  action_items: 5,
});

const DEFAULT_REVIEW_DAY_IDS = Object.freeze([7, 14, 21, 28]);
const KNOWN_SOURCE_CATEGORIES = Object.freeze([
  "summary",
  "curriculum",
  "workspace",
  "coaching",
  "verification",
]);
const VALID_TONES = new Set(["achievement_summary", "deceleration_coaching"]);
const SOURCE_PRIORITY_WEIGHTS = Object.freeze({
  verification: 24,
  coaching: 20,
  curriculum: 16,
  workspace: 12,
  summary: 8,
  custom: 4,
});
const PRIORITY_KEYWORD_WEIGHTS = Object.freeze([
  { pattern: /\b(blocked|blocker|failed|failure|missing|needs|risk|stuck)\b|미완료|부족|누락|실패|위험/i, weight: 30, reason: "risk_or_gap" },
  { pattern: /\b(carry|carry-over|incomplete|unresolved|pending)\b|보류|이월/i, weight: 26, reason: "carry_over" },
  { pattern: /\b(verified|verification|evidence|proof|auto)\b|검증|증거|확인/i, weight: 22, reason: "evidence" },
  { pattern: /\b(rushing|rush|prerequisite|adaptive|difficulty)\b|속도|선행|난이도/i, weight: 18, reason: "adaptive_coaching" },
  { pattern: /\b(action|next|todo|follow[- ]?up)\b|실행|다음|해보세요/i, weight: 14, reason: "next_action" },
  { pattern: /\b(answered|completed|complete|progress|range)\b|완료|답변|진행|범위/i, weight: 8, reason: "progress" },
]);
const LABEL_STOP_WORDS = new Set([
  "a",
  "an",
  "and",
  "are",
  "count",
  "for",
  "is",
  "metric",
  "number",
  "of",
  "to",
  "the",
  "total",
]);
const VALUE_STOP_WORDS = new Set([
  ...LABEL_STOP_WORDS,
  "action",
  "day",
  "item",
  "source",
]);

export function composeReviewDayMetricsDashboard({
  reviewDay = null,
  dayRange = null,
  summaryDashboard = null,
  dashboard = null,
  curriculumSignals = null,
  workspaceSignals = null,
  coachingSignals = null,
  verificationSignals = null,
  sourceCategories = null,
  progress = {},
  tone = "",
  now = new Date(),
} = {}) {
  const targetDay = normalizeDayNumber(reviewDay) ?? inferReviewDay({
    summaryDashboard,
    dashboard,
    curriculumSignals,
    workspaceSignals,
    coachingSignals,
    verificationSignals,
  });
  const generatedAt = toIso(now);
  const normalizedSummaryDashboard = normalizeDashboardSource(summaryDashboard ?? dashboard);
  const normalizedCurriculumSignals = normalizeOptionalCurriculumSignals(curriculumSignals, {
    reviewDay: targetDay,
    now,
  });
  const normalizedWorkspaceSignals = normalizeOptionalWorkspaceSignals(workspaceSignals, {
    reviewDay: targetDay,
    eligibleDayRange: dayRange,
    now,
  });
  const normalizedCoachingSignals = normalizeGenericSignalSource(coachingSignals, {
    category: "coaching",
    label: "Adaptive coaching",
  });
  const normalizedVerificationSignals = normalizeGenericSignalSource(verificationSignals, {
    category: "verification",
    label: "Action verification",
  });
  const explicitCategories = normalizeExplicitSourceCategories(sourceCategories);
  const sources = [
    buildDashboardSourceCategory({
      category: "summary",
      label: "Agent summary",
      value: normalizedSummaryDashboard,
      metrics: normalizedSummaryDashboard.curatedMetrics,
      insights: normalizedSummaryDashboard.agentInsights,
      actionItems: normalizedSummaryDashboard.actionItems,
      available: hasDashboardContent(normalizedSummaryDashboard),
      reason: hasDashboardContent(normalizedSummaryDashboard) ? "dashboard_content" : "missing_dashboard",
    }),
    buildSignalSourceCategory({
      category: "curriculum",
      label: "Curriculum progress",
      value: normalizedCurriculumSignals,
    }),
    buildSignalSourceCategory({
      category: "workspace",
      label: "Workspace signals",
      value: normalizedWorkspaceSignals,
    }),
    normalizedCoachingSignals,
    normalizedVerificationSignals,
    ...explicitCategories,
  ];
  const sourceCategoriesMerged = mergeSourceCategories(sources);
  const sourceStatuses = sourceCategoriesMerged.map((source) => ({
    type: source.category,
    source_type: source.category,
    label: source.label,
    available: source.available,
    status: source.available ? "available" : "missing",
    detail: source.detail,
    metricCount: source.metricCount,
    metric_count: source.metricCount,
    insightCount: source.insightCount,
    insight_count: source.insightCount,
    actionItemCount: source.actionItemCount,
    action_item_count: source.actionItemCount,
  }));
  const metricPriority = prioritizeReviewDashboardMetrics(mergeMetrics(sourceCategoriesMerged));
  const insightPriority = prioritizeReviewDashboardInsights(
    sourceCategoriesMerged.flatMap((source) => (
      source.agentInsights.map((insight) => ({
        text: insight,
        sourceCategory: source.category,
      }))
    )),
  );
  const curatedMetrics = limitSelection(metricPriority.items, REVIEW_DAY_DISPLAY_LIMITS.curatedMetrics);
  const agentInsights = limitSelection(insightPriority.items, REVIEW_DAY_DISPLAY_LIMITS.agentInsights);
  const actionItems = limitSelection(
    mergeStrings(sourceCategoriesMerged.flatMap((source) => source.actionItems)),
    REVIEW_DAY_DISPLAY_LIMITS.actionItems,
  );
  const resolvedTone = normalizeTone(
    tone
      || normalizedSummaryDashboard.tone
      || normalizedCurriculumSignals?.tone
      || normalizedWorkspaceSignals?.tone,
  );
  const normalizedProgress = normalizeProgress(progress, {
    curriculumSignals: normalizedCurriculumSignals,
    summaryDashboard: normalizedSummaryDashboard,
  });
  const availableSourceCount = sourceStatuses.filter((source) => source.available).length;
  const missingSources = sourceStatuses.filter((source) => !source.available).map((source) => source.type);
  const reviewDayRange = normalizeDayRange(
    dayRange
      ?? normalizedCurriculumSignals?.dayRange
      ?? normalizedCurriculumSignals?.day_range
      ?? normalizedWorkspaceSignals?.eligibleDayRange
      ?? normalizedWorkspaceSignals?.eligible_day_range,
  );

  return {
    schemaVersion: REVIEW_DAY_METRICS_COLLECTOR_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_METRICS_COLLECTOR_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_metrics_dashboard.v1",
    generatedAt,
    generated_at: generatedAt,
    reviewDay: targetDay,
    review_day: targetDay,
    dayRange: reviewDayRange,
    day_range: reviewDayRange,
    tone: resolvedTone,
    curatedMetrics,
    curated_metrics: curatedMetrics,
    agentInsights,
    agent_insights: agentInsights,
    prioritySchemaVersion: REVIEW_DAY_PRIORITY_SCHEMA_VERSION,
    priority_schema_version: REVIEW_DAY_PRIORITY_SCHEMA_VERSION,
    displayLimits: REVIEW_DAY_DISPLAY_LIMITS,
    display_limits: REVIEW_DAY_DISPLAY_LIMITS,
    priorityTrace: {
      metrics: metricPriority.trace,
      insights: insightPriority.trace,
    },
    priority_trace: {
      metrics: metricPriority.trace,
      insights: insightPriority.trace,
    },
    actionItems,
    action_items: actionItems,
    progress: normalizedProgress,
    sourceCategories: sourceCategoriesMerged,
    source_categories: sourceCategoriesMerged,
    sourceStatuses,
    source_statuses: sourceStatuses,
    availableSourceCount,
    available_source_count: availableSourceCount,
    missingSourceCount: missingSources.length,
    missing_source_count: missingSources.length,
    missingSources,
    missing_sources: missingSources,
    hasDashboardData: curatedMetrics.length > 0 || agentInsights.length > 0 || actionItems.length > 0,
    has_dashboard_data: curatedMetrics.length > 0 || agentInsights.length > 0 || actionItems.length > 0,
    dashboard: {
      curated_metrics: curatedMetrics,
      agent_insights: agentInsights,
      action_items: actionItems,
      tone: resolvedTone,
    },
  };
}

export function prioritizeReviewDashboardMetrics(metrics = []) {
  const entries = dedupeReviewDashboardMetricEntries(
    normalizeMetrics(metrics).map((metric, index) => ({
      metric,
      index,
    })),
  ).map(({ metric, index }) => {
    const scoring = scoreReviewDashboardMetric(metric);
    return {
      item: {
        ...metric,
        priorityScore: scoring.score,
        priority_score: scoring.score,
        priorityReasons: scoring.reasons,
        priority_reasons: scoring.reasons,
      },
      trace: {
        type: "metric",
        index,
        label: metric.label,
        sourceCategory: metric.sourceCategory,
        source_category: metric.sourceCategory,
        score: scoring.score,
        reasons: scoring.reasons,
      },
      index,
      sourceOrder: sourceOrder(metric.sourceCategory),
      labelKey: normalizeKey(metric.label),
    };
  });
  const ordered = sortPriorityEntries(entries);
  return {
    schemaVersion: REVIEW_DAY_PRIORITY_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_PRIORITY_SCHEMA_VERSION,
    items: ordered.map((entry, index) => ({
      ...entry.item,
      priorityRank: index + 1,
      priority_rank: index + 1,
    })),
    trace: ordered.map((entry, index) => ({
      ...entry.trace,
      rank: index + 1,
      rank_reason: "score_desc_source_order_input_order_label",
    })),
  };
}

export function prioritizeReviewDashboardInsights(insights = []) {
  const entries = normalizeInsightEntries(insights).map((insight, index) => {
    const scoring = scoreReviewDashboardInsight(insight);
    return {
      item: insight.text,
      trace: {
        type: "insight",
        index,
        text: insight.text,
        sourceCategory: insight.sourceCategory,
        source_category: insight.sourceCategory,
        score: scoring.score,
        reasons: scoring.reasons,
      },
      score: scoring.score,
      index,
      sourceOrder: sourceOrder(insight.sourceCategory),
      labelKey: normalizeKey(insight.text),
    };
  });
  const deduped = dedupePriorityEntries(entries, insightDedupeKey);
  const ordered = sortPriorityEntries(deduped);
  return {
    schemaVersion: REVIEW_DAY_PRIORITY_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_PRIORITY_SCHEMA_VERSION,
    items: ordered.map((entry) => entry.item),
    trace: ordered.map((entry, index) => ({
      ...entry.trace,
      rank: index + 1,
      rank_reason: "score_desc_source_order_input_order_label",
    })),
  };
}

export function dedupeReviewDashboardMetrics(metrics = []) {
  return dedupeReviewDashboardMetricEntries(
    normalizeMetrics(metrics).map((metric, index) => ({
      metric,
      index,
    })),
  ).map(({ metric }) => metric);
}

export function dedupeReviewDashboardInsights(insights = []) {
  return dedupePriorityEntries(
    normalizeInsightEntries(insights).map((insight, index) => {
      const scoring = scoreReviewDashboardInsight(insight);
      return {
        item: insight.text,
        trace: {
          score: scoring.score,
        },
        index,
        sourceOrder: sourceOrder(insight.sourceCategory),
        labelKey: normalizeKey(insight.text),
      };
    }),
    insightDedupeKey,
  ).map((entry) => entry.item);
}

export function scoreReviewDashboardMetric(metric = {}) {
  const normalized = normalizeMetric(metric);
  const explicitPriority = normalizePriorityNumber(metric.priority ?? metric.priorityScore ?? metric.priority_score);
  const sourceWeight = SOURCE_PRIORITY_WEIGHTS[normalized.sourceCategory] ?? SOURCE_PRIORITY_WEIGHTS.custom;
  const text = [
    normalized.label,
    normalized.value,
    normalized.trend,
    normalized.intent,
    normalized.status,
  ].join(" ");
  return scorePriorityText({
    text,
    sourceCategory: normalized.sourceCategory,
    explicitPriority,
    base: sourceWeight,
  });
}

export function scoreReviewDashboardInsight(insight = {}) {
  const normalized = normalizeInsightEntry(insight);
  const explicitPriority = normalizePriorityNumber(insight.priority ?? insight.priorityScore ?? insight.priority_score);
  const sourceWeight = SOURCE_PRIORITY_WEIGHTS[normalized.sourceCategory] ?? SOURCE_PRIORITY_WEIGHTS.custom;
  return scorePriorityText({
    text: normalized.text,
    sourceCategory: normalized.sourceCategory,
    explicitPriority,
    base: sourceWeight,
  });
}

export async function collectReviewDayMetricsDashboard({
  reviewDay = null,
  daySpec = {},
  summaryDashboard = null,
  dashboard = null,
  curriculumSignals = null,
  workspaceSignals = null,
  coachingSignals = null,
  verificationSignals = null,
  progressState = null,
  dayRecords = null,
  reviewDayIds = DEFAULT_REVIEW_DAY_IDS,
  curriculumDays = null,
  workspaceRoot = "",
  docPaths = {},
  workspaceState = null,
  fsImpl = undefined,
  progress = {},
  tone = "",
  now = new Date(),
} = {}) {
  const rawDaySpec = objectOrEmpty(daySpec);
  const targetDay = normalizeDayNumber(
    reviewDay
      ?? rawDaySpec.dayId
      ?? rawDaySpec.day_id
      ?? rawDaySpec.day,
  ) ?? 7;
  const resolvedCurriculumSignals = curriculumSignals
    ? normalizeReviewDayCurriculumSignals(curriculumSignals, {
        reviewDay: targetDay,
        daySpec: rawDaySpec,
        curriculumDays,
        now,
      })
    : progressState || Array.isArray(dayRecords)
      ? collectReviewDayCurriculumSignals({
          reviewDay: targetDay,
          daySpec: rawDaySpec,
          progressState,
          dayRecords,
          reviewDayIds,
          curriculumDays,
          now,
        })
      : null;
  const resolvedWorkspaceSignals = workspaceSignals
    ? normalizeReviewDayWorkspaceSignals(workspaceSignals, {
        reviewDay: targetDay,
        eligibleDayRange: resolvedCurriculumSignals?.dayRange ?? resolvedCurriculumSignals?.day_range,
        now,
      })
    : workspaceRoot || workspaceState
      ? await collectReviewDayWorkspaceSignals({
          workspaceRoot,
          docPaths,
          workspaceState: workspaceState ?? {},
          fsImpl,
          now,
        })
      : null;

  return composeReviewDayMetricsDashboard({
    reviewDay: targetDay,
    dayRange: resolvedCurriculumSignals?.dayRange ?? resolvedCurriculumSignals?.day_range,
    summaryDashboard,
    dashboard,
    curriculumSignals: resolvedCurriculumSignals,
    workspaceSignals: resolvedWorkspaceSignals,
    coachingSignals,
    verificationSignals,
    progress,
    tone,
    now,
  });
}

function normalizeDashboardSource(value) {
  return normalizeReviewDashboard(value ?? {});
}

function normalizeOptionalCurriculumSignals(value, options) {
  if (!value || typeof value !== "object") return null;
  return normalizeReviewDayCurriculumSignals(value, options);
}

function normalizeOptionalWorkspaceSignals(value, options) {
  if (!value || typeof value !== "object") return null;
  return normalizeReviewDayWorkspaceSignals(value, options);
}

function buildDashboardSourceCategory({
  category,
  label,
  value,
  metrics,
  insights,
  actionItems,
  available,
  reason = "",
}) {
  const normalizedMetrics = normalizeMetrics(metrics, category);
  const normalizedInsights = normalizeStringArray(insights);
  const normalizedActionItems = normalizeStringArray(actionItems);
  return normalizeSourceCategory({
    category,
    label,
    available,
    detail: reason,
    metrics: normalizedMetrics,
    agentInsights: normalizedInsights,
    actionItems: normalizedActionItems,
    raw: value,
  });
}

function buildSignalSourceCategory({ category, label, value }) {
  if (!value || typeof value !== "object") {
    return normalizeSourceCategory({
      category,
      label,
      available: false,
      detail: "not_collected",
    });
  }
  const metrics = normalizeMetrics(value.dashboardMetrics ?? value.dashboard_metrics, category);
  const insights = normalizeStringArray(value.dashboardInsights ?? value.dashboard_insights);
  const actionItems = normalizeStringArray(value.dashboardActionItems ?? value.dashboard_action_items);
  const available = Boolean(
    value.hasSignals
      ?? value.has_signals
      ?? hasAny(metrics, insights, actionItems),
  );
  return normalizeSourceCategory({
    category,
    label,
    available,
    detail: available ? "signals_collected" : "no_signals",
    metrics,
    agentInsights: insights,
    actionItems,
    raw: value,
  });
}

function normalizeGenericSignalSource(value, { category, label }) {
  if (!value || typeof value !== "object") {
    return normalizeSourceCategory({
      category,
      label,
      available: false,
      detail: "not_collected",
    });
  }
  const raw = objectOrEmpty(value);
  const metrics = normalizeMetrics(
    raw.dashboardMetrics
      ?? raw.dashboard_metrics
      ?? raw.curatedMetrics
      ?? raw.curated_metrics
      ?? raw.metrics,
    category,
  );
  const insights = normalizeStringArray(
    raw.dashboardInsights
      ?? raw.dashboard_insights
      ?? raw.agentInsights
      ?? raw.agent_insights
      ?? raw.insights,
  );
  const actionItems = normalizeStringArray(
    raw.dashboardActionItems
      ?? raw.dashboard_action_items
      ?? raw.actionItems
      ?? raw.action_items,
  );
  return normalizeSourceCategory({
    category: raw.category ?? raw.sourceCategory ?? raw.source_category ?? category,
    label: raw.label ?? label,
    available: raw.available ?? raw.hasSignals ?? raw.has_signals ?? hasAny(metrics, insights, actionItems),
    detail: raw.detail ?? raw.reason ?? (hasAny(metrics, insights, actionItems) ? "signals_collected" : "no_signals"),
    metrics,
    agentInsights: insights,
    actionItems,
    raw,
  });
}

function normalizeExplicitSourceCategories(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => {
    const raw = objectOrEmpty(entry);
    const category = normalizeSourceCategoryName(raw.category ?? raw.type ?? raw.source_type);
    return normalizeGenericSignalSource(raw, {
      category,
      label: raw.label ?? sourceLabel(category),
    });
  });
}

function normalizeSourceCategory(value) {
  const raw = objectOrEmpty(value);
  const category = normalizeSourceCategoryName(raw.category ?? raw.type ?? raw.source_type);
  const metrics = normalizeMetrics(raw.metrics ?? raw.curatedMetrics ?? raw.curated_metrics, category);
  const agentInsights = normalizeStringArray(raw.agentInsights ?? raw.agent_insights ?? raw.insights);
  const actionItems = normalizeStringArray(raw.actionItems ?? raw.action_items);
  const available = Boolean(raw.available ?? raw.hasSignals ?? raw.has_signals ?? hasAny(metrics, agentInsights, actionItems));
  return {
    category,
    sourceCategory: category,
    source_category: category,
    label: stringOrDefault(raw.label, sourceLabel(category)),
    available,
    status: available ? "available" : "missing",
    detail: stringOrDefault(raw.detail ?? raw.reason, ""),
    metrics,
    curatedMetrics: metrics,
    curated_metrics: metrics,
    agentInsights,
    agent_insights: agentInsights,
    actionItems,
    action_items: actionItems,
    metricCount: metrics.length,
    metric_count: metrics.length,
    insightCount: agentInsights.length,
    insight_count: agentInsights.length,
    actionItemCount: actionItems.length,
    action_item_count: actionItems.length,
  };
}

function mergeSourceCategories(value) {
  const byCategory = new Map();
  for (const source of value.map(normalizeSourceCategory)) {
    const existing = byCategory.get(source.category);
    if (!existing) {
      byCategory.set(source.category, source);
      continue;
    }
    const metrics = mergeMetrics([existing, source]);
    const agentInsights = mergeStrings([...existing.agentInsights, ...source.agentInsights]);
    const actionItems = mergeStrings([...existing.actionItems, ...source.actionItems]);
    byCategory.set(source.category, normalizeSourceCategory({
      category: source.category,
      label: existing.label || source.label,
      available: existing.available || source.available,
      detail: mergeStrings([existing.detail, source.detail]).join(", "),
      metrics,
      agentInsights,
      actionItems,
    }));
  }
  return Array.from(byCategory.values()).sort((a, b) => sourceOrder(a.category) - sourceOrder(b.category));
}

function mergeMetrics(sources) {
  const entries = [];
  let index = 0;
  for (const source of sources) {
    const category = source.category ?? source.sourceCategory ?? source.source_category ?? "";
    for (const metric of normalizeMetrics(source.metrics ?? source.curatedMetrics ?? source.curated_metrics, category)) {
      entries.push({
        metric,
        index,
      });
      index += 1;
    }
  }
  return dedupeReviewDashboardMetricEntries(entries).map((entry) => entry.metric);
}

function normalizeMetrics(value, sourceCategory = "") {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => normalizeMetric(entry, sourceCategory))
    .filter((metric) => metric.label || metric.value);
}

function normalizeMetric(value, sourceCategory = "") {
  if (typeof value === "string") {
    const label = value.trim();
    return {
      label,
      value: "",
      trend: "",
      intent: "",
      status: "",
      sourceCategory,
      source_category: sourceCategory,
    };
  }
  const raw = objectOrEmpty(value);
  const category = normalizeSourceCategoryName(
    raw.sourceCategory
      ?? raw.source_category
      ?? raw.category
      ?? sourceCategory,
  );
  return {
    label: stringOrDefault(raw.label ?? raw.name, ""),
    value: stringOrDefault(raw.value ?? raw.count ?? raw.text, ""),
    trend: stringOrDefault(raw.trend ?? raw.delta, ""),
    intent: stringOrDefault(raw.intent ?? raw.description ?? raw.helperText, ""),
    status: stringOrDefault(raw.status ?? raw.state, ""),
    priority: normalizePriorityNumber(raw.priority ?? raw.priorityScore ?? raw.priority_score),
    sourceCategory: category,
    source_category: category,
  };
}

function mergeStrings(values) {
  const seen = new Set();
  const result = [];
  for (const value of normalizeStringArray(values)) {
    const key = normalizeKey(value);
    if (seen.has(key)) continue;
    seen.add(key);
    result.push(value);
  }
  return result;
}

function limitSelection(items, maxCount) {
  if (!Array.isArray(items)) return [];
  const count = Math.max(0, Math.trunc(Number(maxCount) || 0));
  return items.slice(0, count);
}

function scorePriorityText({ text, sourceCategory, explicitPriority = 0, base = 0 }) {
  const reasons = [
    {
      reason: `source:${sourceCategory || "custom"}`,
      weight: base,
    },
  ];
  let score = base;

  if (explicitPriority > 0) {
    const explicitWeight = explicitPriority * 10;
    score += explicitWeight;
    reasons.push({
      reason: "explicit_priority",
      weight: explicitWeight,
    });
  }

  for (const rule of PRIORITY_KEYWORD_WEIGHTS) {
    if (!rule.pattern.test(text)) continue;
    score += rule.weight;
    reasons.push({
      reason: rule.reason,
      weight: rule.weight,
    });
  }

  return {
    score,
    reasons,
  };
}

function sortPriorityEntries(entries) {
  return [...entries].sort((a, b) => {
    const scoreDelta = (b.trace?.score ?? b.score ?? 0) - (a.trace?.score ?? a.score ?? 0);
    if (scoreDelta !== 0) return scoreDelta;
    const sourceDelta = a.sourceOrder - b.sourceOrder;
    if (sourceDelta !== 0) return sourceDelta;
    const indexDelta = a.index - b.index;
    if (indexDelta !== 0) return indexDelta;
    return a.labelKey.localeCompare(b.labelKey);
  });
}

function dedupeReviewDashboardMetricEntries(entries) {
  const byKey = new Map();
  for (const entry of entries) {
    const metric = normalizeMetric(entry.metric);
    const key = metricDedupeKey(metric);
    if (!key) continue;
    const candidate = {
      metric,
      index: entry.index,
    };
    const existing = byKey.get(key);
    if (!existing || compareMetricDedupeCandidate(candidate, existing) < 0) {
      byKey.set(key, candidate);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.index - b.index);
}

function compareMetricDedupeCandidate(a, b) {
  const scoreDelta = scoreReviewDashboardMetric(b.metric).score - scoreReviewDashboardMetric(a.metric).score;
  if (scoreDelta !== 0) return scoreDelta;
  const sourceDelta = sourceOrder(a.metric.sourceCategory) - sourceOrder(b.metric.sourceCategory);
  if (sourceDelta !== 0) return sourceDelta;
  return a.index - b.index;
}

function dedupePriorityEntries(entries, keyForEntry = (entry) => normalizeKey(entry.item)) {
  const byKey = new Map();
  for (const entry of entries) {
    const key = keyForEntry(entry);
    if (!key) continue;
    const existing = byKey.get(key);
    if (!existing || comparePriorityDedupeEntry(entry, existing) < 0) {
      byKey.set(key, entry);
    }
  }
  return Array.from(byKey.values()).sort((a, b) => a.index - b.index);
}

function comparePriorityDedupeEntry(a, b) {
  const scoreDelta = (b.trace?.score ?? b.score ?? 0) - (a.trace?.score ?? a.score ?? 0);
  if (scoreDelta !== 0) return scoreDelta;
  const sourceDelta = a.sourceOrder - b.sourceOrder;
  if (sourceDelta !== 0) return sourceDelta;
  return a.index - b.index;
}

function metricDedupeKey(metric) {
  const labelKey = labelFingerprint(metric.label);
  const valueKey = valueFingerprint(metric.value);
  if (!labelKey && !valueKey) return "";
  return [labelKey, valueKey].join("|");
}

function insightDedupeKey(entry) {
  return labelFingerprint(entry.item);
}

function labelFingerprint(value) {
  return normalizeDedupeTokens(value)
    .filter((token) => !LABEL_STOP_WORDS.has(token))
    .sort()
    .join(" ");
}

function valueFingerprint(value) {
  const text = String(value ?? "").trim();
  const numeric = text.match(/\d+(?:\.\d+)?(?:\s*\/\s*\d+(?:\.\d+)?)?/g);
  if (numeric?.length) {
    return numeric.map((entry) => entry.replace(/\s+/g, "")).join(" ");
  }
  return normalizeDedupeTokens(text)
    .filter((token) => !VALUE_STOP_WORDS.has(token))
    .join(" ");
}

function normalizeDedupeTokens(value) {
  return String(value ?? "")
    .normalize("NFKD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/&/g, " and ")
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .toLowerCase()
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(singularizeDedupeToken);
}

function singularizeDedupeToken(token) {
  if (/^[a-z]{4,}ies$/.test(token)) return `${token.slice(0, -3)}y`;
  if (/^[a-z]{4,}s$/.test(token) && !/(ss)$/.test(token)) {
    return token.slice(0, -1);
  }
  return token;
}

function normalizeInsightEntries(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeInsightEntry)
    .filter((entry) => entry.text);
}

function normalizeInsightEntry(value) {
  if (typeof value === "string") {
    return {
      text: value.trim(),
      sourceCategory: "",
      source_category: "",
    };
  }
  const raw = objectOrEmpty(value);
  const sourceCategory = normalizeSourceCategoryName(
    raw.sourceCategory
      ?? raw.source_category
      ?? raw.category,
  );
  return {
    text: stringOrDefault(raw.text ?? raw.value ?? raw.insight ?? raw.message, ""),
    sourceCategory,
    source_category: sourceCategory,
  };
}

function normalizeProgress(value, { curriculumSignals, summaryDashboard }) {
  const raw = objectOrEmpty(value);
  return {
    completedDays: normalizeNumber(
      raw.completedDays
        ?? raw.completed_days
        ?? curriculumSignals?.completedDayCount
        ?? curriculumSignals?.completed_day_count,
      0,
    ),
    completed_days: normalizeNumber(
      raw.completedDays
        ?? raw.completed_days
        ?? curriculumSignals?.completedDayCount
        ?? curriculumSignals?.completed_day_count,
      0,
    ),
    incompleteActions: normalizeNumber(
      raw.incompleteActions
        ?? raw.incomplete_actions
        ?? inferIncompleteActions(summaryDashboard),
      0,
    ),
    incomplete_actions: normalizeNumber(
      raw.incompleteActions
        ?? raw.incomplete_actions
        ?? inferIncompleteActions(summaryDashboard),
      0,
    ),
    daysElapsed: normalizeNumber(raw.daysElapsed ?? raw.days_elapsed, 0),
    days_elapsed: normalizeNumber(raw.daysElapsed ?? raw.days_elapsed, 0),
  };
}

function inferIncompleteActions(summaryDashboard) {
  const metric = (summaryDashboard?.curatedMetrics ?? []).find((entry) => /미완료|incomplete|carry/i.test(entry.label));
  return metric ? Number.parseInt(metric.value, 10) : 0;
}

function inferReviewDay(sources) {
  for (const source of Object.values(sources)) {
    const raw = objectOrEmpty(source);
    const day = normalizeDayNumber(raw.reviewDay ?? raw.review_day ?? raw.dayId ?? raw.day_id);
    if (day) return day;
  }
  return 7;
}

function hasDashboardContent(value) {
  return Boolean(
    value
      && (
        value.curatedMetrics?.length
        || value.agentInsights?.length
        || value.actionItems?.length
        || value.coachingCopy?.body
        || value.coachingCopy?.headline
      ),
  );
}

function hasAny(...groups) {
  return groups.some((group) => Array.isArray(group) ? group.length > 0 : Boolean(group));
}

function normalizeSourceCategoryName(value) {
  const text = String(value ?? "").trim();
  if (!text) return "custom";
  return text
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function sourceLabel(category) {
  return {
    summary: "Agent summary",
    curriculum: "Curriculum progress",
    workspace: "Workspace signals",
    coaching: "Adaptive coaching",
    verification: "Action verification",
  }[category] ?? titleCase(category);
}

function sourceOrder(category) {
  const index = KNOWN_SOURCE_CATEGORIES.indexOf(category);
  return index === -1 ? KNOWN_SOURCE_CATEGORIES.length : index;
}

function normalizeTone(value) {
  const text = String(value ?? "").trim();
  return VALID_TONES.has(text) ? text : "";
}

function normalizeDayRange(value) {
  const raw = objectOrEmpty(value);
  const start = normalizeDayNumber(raw.start ?? raw.from);
  const end = normalizeDayNumber(raw.end ?? raw.to);
  return start && end ? { start, end } : null;
}

function normalizeDayNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const day = Math.trunc(n);
  return day >= 1 && day <= 30 ? day : null;
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function normalizePriorityNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return 0;
  return Math.max(0, Math.min(10, n));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback = "") {
  const text = String(value ?? "").trim();
  return text || fallback;
}

function normalizeKey(value) {
  return String(value ?? "").trim().toLowerCase();
}

function titleCase(value) {
  return String(value ?? "")
    .replace(/_/g, " ")
    .replace(/\b\w/g, (char) => char.toUpperCase());
}

function toIso(value) {
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : new Date().toISOString();
}

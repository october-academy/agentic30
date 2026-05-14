import { normalizeReviewDashboard } from "./review-dashboard-presentation.mjs";

export const REVIEW_DAY_VIEW_MODEL_SCHEMA_VERSION = 1;

export function buildReviewDayViewModel({
  collectedModel = null,
  dashboard = null,
  reviewDay = null,
  dayRange = null,
} = {}) {
  const source = objectOrEmpty(collectedModel ?? dashboard);
  const normalizedDashboard = normalizeReviewDashboard(
    source.dashboard ?? source.reviewDashboard ?? source.review_dashboard ?? source,
  );
  const curatedMetrics = normalizedDashboard.curatedMetrics.map(projectMetric);
  const insights = [...normalizedDashboard.agentInsights];
  const nextSteps = [...normalizedDashboard.actionItems];
  const resolvedReviewDay = normalizePositiveInteger(
    reviewDay
      ?? source.reviewDay
      ?? source.review_day
      ?? source.dayId
      ?? source.day_id,
  );
  const resolvedDayRange = normalizeDayRange(
    dayRange
      ?? source.dayRange
      ?? source.day_range,
  );

  return {
    schemaVersion: REVIEW_DAY_VIEW_MODEL_SCHEMA_VERSION,
    componentType: "curriculum_review_day_view_model",
    reviewDay: resolvedReviewDay,
    dayRange: resolvedDayRange,
    tone: normalizedDashboard.tone,
    curatedMetrics,
    insights,
    nextSteps,
    isEmpty: curatedMetrics.length === 0 && insights.length === 0 && nextSteps.length === 0,
  };
}

function projectMetric(metric = {}) {
  const raw = objectOrEmpty(metric);
  return {
    label: stringOrDefault(raw.label, ""),
    value: stringOrDefault(raw.value, ""),
    trend: stringOrDefault(raw.trend, ""),
    intent: stringOrDefault(raw.intent, ""),
    status: stringOrDefault(raw.status, ""),
  };
}

function normalizeDayRange(value) {
  const raw = objectOrEmpty(value);
  const start = normalizePositiveInteger(raw.start);
  const end = normalizePositiveInteger(raw.end);
  return start && end ? { start, end } : null;
}

function normalizePositiveInteger(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  const normalized = Math.trunc(n);
  return normalized > 0 ? normalized : null;
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function stringOrDefault(value, fallback) {
  const text = String(value ?? "").trim();
  return text || fallback;
}

export const REVIEW_DASHBOARD_PRESENTATION_SCHEMA_VERSION = 1;

const DEFAULT_TITLE = "Review dashboard";
const DEFAULT_EMPTY_LABEL = "아직 표시할 지표가 없습니다.";
const ALLOWED_TONES = new Set(["deceleration_coaching", "achievement_summary"]);

export function renderReviewDashboardPresentation({
  dashboard = {},
  progress = {},
  title = DEFAULT_TITLE,
  now = new Date(),
} = {}) {
  const normalizedDashboard = normalizeReviewDashboard(dashboard);
  const normalizedProgress = normalizeDashboardProgress(progress);
  const metricRows = normalizedDashboard.curatedMetrics.map(formatMetricRow);

  return {
    schemaVersion: REVIEW_DASHBOARD_PRESENTATION_SCHEMA_VERSION,
    componentType: "curriculum_review_dashboard",
    title: stringOrDefault(title, DEFAULT_TITLE),
    createdAt: toIso(now),
    tone: normalizedDashboard.tone,
    progress: normalizedProgress,
    metrics: normalizedDashboard.curatedMetrics,
    metricRows,
    labels: normalizedDashboard.curatedMetrics.map((metric) => metric.label),
    values: normalizedDashboard.curatedMetrics.map((metric) => metric.value),
    agentInsights: normalizedDashboard.agentInsights,
    actionItems: normalizedDashboard.actionItems,
    coachingCopy: normalizedDashboard.coachingCopy,
    isEmpty: normalizedDashboard.curatedMetrics.length === 0
      && normalizedDashboard.agentInsights.length === 0
      && normalizedDashboard.actionItems.length === 0
      && !hasCoachingCopy(normalizedDashboard.coachingCopy),
    cardBlock: {
      role: "assistant",
      kind: "dashboard",
      title: stringOrDefault(title, DEFAULT_TITLE),
      metrics: normalizedDashboard.curatedMetrics,
      metricRows,
      agentInsights: normalizedDashboard.agentInsights,
      actionItems: normalizedDashboard.actionItems,
      coachingCopy: normalizedDashboard.coachingCopy,
      tone: normalizedDashboard.tone,
      progress: normalizedProgress,
    },
  };
}

export function formatReviewDashboardMarkdown(dashboard = {}) {
  const normalizedDashboard = normalizeReviewDashboard(dashboard);
  const lines = metricLines(normalizedDashboard.curatedMetrics);
  if (normalizedDashboard.agentInsights.length) {
    lines.push("", "Agent insights", ...bulletLines(normalizedDashboard.agentInsights));
  }
  if (normalizedDashboard.actionItems.length) {
    lines.push("", "Action items", ...bulletLines(normalizedDashboard.actionItems));
  }
  if (hasCoachingCopy(normalizedDashboard.coachingCopy)) {
    lines.push("", "Coaching");
    if (normalizedDashboard.coachingCopy.headline) lines.push(`- ${normalizedDashboard.coachingCopy.headline}`);
    if (normalizedDashboard.coachingCopy.body) lines.push(`- ${normalizedDashboard.coachingCopy.body}`);
    if (normalizedDashboard.coachingCopy.reflectionPrompt) lines.push(`- ${normalizedDashboard.coachingCopy.reflectionPrompt}`);
  }
  if (normalizedDashboard.tone) {
    lines.push("", `Tone: ${normalizedDashboard.tone}`);
  }
  return compactMarkdown(lines);
}

export function normalizeReviewDashboard(value = {}) {
  const raw = objectOrEmpty(value);
  return {
    curatedMetrics: normalizeMetrics(raw.curatedMetrics ?? raw.curated_metrics ?? raw.metrics),
    agentInsights: normalizeStringArray(raw.agentInsights ?? raw.agent_insights ?? raw.insights),
    actionItems: normalizeStringArray(raw.actionItems ?? raw.action_items),
    coachingCopy: normalizeCoachingCopy(raw.coachingCopy ?? raw.coaching_copy ?? raw.coaching),
    tone: normalizeTone(raw.tone),
  };
}

export function normalizeDashboardProgress(value = {}) {
  const raw = objectOrEmpty(value);
  return {
    completedDays: normalizeNumber(raw.completedDays ?? raw.completed_days, 0),
    incompleteActions: normalizeNumber(raw.incompleteActions ?? raw.incomplete_actions, 0),
    daysElapsed: normalizeNumber(raw.daysElapsed ?? raw.days_elapsed, 0),
  };
}

export function metricLines(metrics = []) {
  const normalized = normalizeMetrics(metrics);
  if (!normalized.length) return [`- ${DEFAULT_EMPTY_LABEL}`];
  return normalized.map((metric) => `- ${formatMetricRow(metric)}`);
}

export function formatMetricRow(metric = {}) {
  const normalized = normalizeMetric(metric);
  const value = normalized.value ? `: ${normalized.value}` : "";
  const trend = normalized.trend ? ` (${normalized.trend})` : "";
  return `${normalized.label}${value}${trend}`;
}

function normalizeMetrics(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map(normalizeMetric)
    .filter((entry) => entry.label || entry.value);
}

function normalizeMetric(value) {
  if (typeof value === "string") {
    return {
      label: value.trim(),
      value: "",
      trend: "",
      intent: "",
      status: "",
    };
  }
  const raw = objectOrEmpty(value);
  return {
    label: stringOrDefault(raw.label ?? raw.name, ""),
    value: stringOrDefault(raw.value ?? raw.count ?? raw.text, ""),
    trend: stringOrDefault(raw.trend ?? raw.delta, ""),
    intent: stringOrDefault(raw.intent ?? raw.description ?? raw.helperText, ""),
    status: stringOrDefault(raw.status ?? raw.state, ""),
  };
}

function normalizeTone(value) {
  const tone = String(value || "").trim();
  return ALLOWED_TONES.has(tone) ? tone : "";
}

function normalizeCoachingCopy(value) {
  if (typeof value === "string") {
    return {
      headline: "",
      body: stringOrDefault(value, ""),
      reflectionPrompt: "",
    };
  }
  const raw = objectOrEmpty(value);
  return {
    headline: stringOrDefault(raw.headline ?? raw.title, ""),
    body: stringOrDefault(raw.body ?? raw.text ?? raw.message, ""),
    reflectionPrompt: stringOrDefault(
      raw.reflectionPrompt
        ?? raw.reflection_prompt
        ?? raw.prompt
        ?? raw.question,
      "",
    ),
  };
}

function hasCoachingCopy(value) {
  const copy = normalizeCoachingCopy(value);
  return Boolean(copy.headline || copy.body || copy.reflectionPrompt);
}

function bulletLines(items) {
  return normalizeStringArray(items).map((item) => `- ${item}`);
}

function compactMarkdown(lines) {
  const compacted = [];
  for (const line of lines.map((entry) => String(entry ?? "").trimEnd())) {
    const previous = compacted[compacted.length - 1];
    if (line === "" && previous === "") continue;
    compacted.push(line);
  }
  while (compacted[compacted.length - 1] === "") compacted.pop();
  return compacted.join("\n");
}

function normalizeNumber(value, fallback) {
  const n = Number(value);
  if (!Number.isFinite(n)) return fallback;
  return Math.max(0, Math.trunc(n));
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => String(entry ?? "").trim())
    .filter(Boolean);
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

import { renderReviewDashboardPresentation } from "./review-dashboard-presentation.mjs";
import { renderReviewDaySummaryCard } from "./review-day-summary.mjs";
import { buildReviewDayViewModel } from "./review-day-view-model.mjs";

export const REVIEW_DAY_UI_COMPOSITION_SCHEMA_VERSION = 1;

const DEFAULT_SUMMARY_SECTION_TITLE = "Agent Summary";
const DEFAULT_DASHBOARD_SECTION_TITLE = "Review Dashboard";

export function renderReviewDayUIComposition({
  daySpec = {},
  reviewSummary = null,
  dashboard = null,
  progress = {},
  isLoading = false,
  requestId = null,
  sessionId = null,
  now = new Date(),
} = {}) {
  const collectedModel = resolveCollectedModel({ reviewSummary, dashboard });
  const viewModel = buildReviewDayViewModel({
    collectedModel,
    reviewDay: normalizeReviewDayId(daySpec),
  });
  const dashboardProjection = buildDashboardProjection(viewModel);
  const summarySection = renderReviewDaySummaryCard({
    daySpec,
    reviewSummary,
    dashboard: dashboardProjection,
    progress,
    isLoading,
    requestId,
    sessionId,
    now,
  });
  const dashboardSection = renderReviewDashboardPresentation({
    dashboard: dashboardProjection,
    progress,
    title: `${summarySection.title} dashboard`,
    now,
  });
  const sections = [
    buildSummarySection(summarySection),
    buildDashboardSection(dashboardSection),
  ];

  return {
    schemaVersion: REVIEW_DAY_UI_COMPOSITION_SCHEMA_VERSION,
    componentType: "curriculum_review_day_ui",
    dayId: summarySection.dayId,
    dayType: "review",
    status: summarySection.status,
    title: summarySection.title,
    createdAt: summarySection.createdAt,
    viewModel,
    reviewDashboardState: {
      schemaVersion: 1,
      componentType: "curriculum_review_day_dashboard_state",
      displayMode: "curated_projection",
      fullCollectedModel: cloneForState(collectedModel),
      full_collected_model: cloneForState(collectedModel),
      curatedProjection: cloneForState(dashboardProjection),
      curated_projection: cloneForState(dashboardProjection),
    },
    sections,
    displayedSections: sections
      .filter((section) => section.displayed)
      .map((section) => section.kind),
    childComponentTypes: sections.map((section) => section.componentType),
    card: {
      layout: "review_day_summary_dashboard_composition",
      tone: "friendly_senior",
      state: summarySection.status,
      viewModel,
      sections: sections.map(({ id, kind, title, componentType, displayed }) => ({
        id,
        kind,
        title,
        componentType,
        displayed,
      })),
    },
  };
}

function buildSummarySection(summarySection) {
  return {
    id: "review-agent-summary",
    kind: "summary",
    title: DEFAULT_SUMMARY_SECTION_TITLE,
    componentType: summarySection.cardType,
    displayed: true,
    data: summarySection,
  };
}

function buildDashboardSection(dashboardSection) {
  return {
    id: "review-dashboard",
    kind: "dashboard",
    title: DEFAULT_DASHBOARD_SECTION_TITLE,
    componentType: dashboardSection.componentType,
    displayed: true,
    data: dashboardSection,
  };
}

function objectOrEmpty(value) {
  return value && typeof value === "object" && !Array.isArray(value) ? value : {};
}

function resolveCollectedModel({ reviewSummary, dashboard }) {
  if (dashboard && typeof dashboard === "object" && !Array.isArray(dashboard)) {
    return dashboard;
  }
  const summary = objectOrEmpty(reviewSummary);
  return objectOrEmpty(summary.dashboard ?? summary.reviewDashboard ?? summary.review_dashboard);
}

function buildDashboardProjection(viewModel) {
  return {
    curatedMetrics: viewModel.curatedMetrics,
    curated_metrics: viewModel.curatedMetrics,
    agentInsights: viewModel.insights,
    agent_insights: viewModel.insights,
    actionItems: viewModel.nextSteps,
    action_items: viewModel.nextSteps,
    tone: viewModel.tone,
  };
}

function normalizeReviewDayId(daySpec) {
  const raw = objectOrEmpty(daySpec);
  const day = Number(raw.dayId ?? raw.day_id ?? raw.day);
  if (!Number.isFinite(day)) return null;
  const normalized = Math.trunc(day);
  return normalized > 0 ? normalized : null;
}

function cloneForState(value) {
  if (!value || typeof value !== "object") return value ?? null;
  return JSON.parse(JSON.stringify(value));
}

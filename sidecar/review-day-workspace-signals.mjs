import fs from "node:fs/promises";
import path from "node:path";
import { projectDocCandidatePaths, projectDocPath } from "./project-doc-paths.mjs";

export const REVIEW_DAY_WORKSPACE_SIGNAL_SCHEMA_VERSION = 1;

const EXPECTED_DOC_TYPES = Object.freeze(["icp", "values", "goal", "spec"]);
const OPTIONAL_DOC_TYPES = Object.freeze(["docs", "sheet", "designSystem", "adr"]);
const EXTERNAL_SOURCE_TYPES = Object.freeze(["mcp", "cli", "browser", "googleDocs", "googleSheets"]);
const KNOWN_SOURCE_TYPES = Object.freeze(["localWorkspace", "localDocs", ...EXTERNAL_SOURCE_TYPES]);

export async function collectReviewDayWorkspaceSignals({
  workspaceRoot = "",
  docPaths = {},
  workspaceState = {},
  fsImpl = fs,
  now = new Date(),
} = {}) {
  const root = stringOrDefault(workspaceRoot, "");
  const resolvedRoot = root ? path.resolve(root) : "";
  const sourceState = objectOrEmpty(workspaceState);
  const errors = [];
  let workspaceReadable = false;

  if (resolvedRoot) {
    try {
      const stat = await fsImpl.stat(resolvedRoot);
      workspaceReadable = stat.isDirectory();
      if (!workspaceReadable) errors.push("workspace_root_not_directory");
    } catch {
      errors.push("workspace_root_unreadable");
    }
  } else {
    errors.push("workspace_root_missing");
  }

  const localDocs = workspaceReadable
    ? await collectLocalDocSignals({ workspaceRoot: resolvedRoot, docPaths, fsImpl })
    : buildMissingDocSignals(docPaths);

  return normalizeReviewDayWorkspaceSignals({
    workspaceRoot: resolvedRoot || root,
    generatedAt: now,
    sources: {
      localWorkspace: { available: workspaceReadable, reason: workspaceReadable ? "readable" : errors[0] },
      localDocs,
      ...sourceState,
    },
    errors,
  }, { now });
}

export function normalizeReviewDayWorkspaceSignals(value = {}, {
  reviewDay = null,
  eligibleDayRange = null,
  now = new Date(),
} = {}) {
  const raw = objectOrEmpty(value);
  const sources = objectOrEmpty(raw.sources ?? raw.workspaceSources ?? raw.workspace_sources ?? raw);
  const generatedAt = toIso(raw.generatedAt ?? raw.generated_at ?? now);
  const workspaceRoot = stringOrDefault(raw.workspaceRoot ?? raw.workspace_root, "");
  const localDocs = normalizeDocSignals(
    sources.localDocs
      ?? sources.local_docs
      ?? raw.localDocs
      ?? raw.local_docs
      ?? raw.docs
      ?? raw.workspaceScan
      ?? raw.workspace_scan,
  );
  const sourceStatuses = normalizeSourceStatuses({
    sources,
    localDocs,
    workspaceRoot,
    errors: normalizeStringArray(raw.errors),
  });
  const availableSourceCount = sourceStatuses.filter((source) => source.available).length;
  const missingSourceCount = sourceStatuses.filter((source) => !source.available).length;
  const expectedDocCount = localDocs.filter((doc) => doc.required).length;
  const foundExpectedDocCount = localDocs.filter((doc) => doc.required && doc.found).length;
  const optionalFoundDocCount = localDocs.filter((doc) => !doc.required && doc.found).length;
  const externalSources = sourceStatuses.filter((source) => EXTERNAL_SOURCE_TYPES.includes(source.type));
  const availableExternalCount = externalSources.filter((source) => source.available).length;
  const dashboardMetrics = buildDashboardMetrics({
    availableSourceCount,
    missingSourceCount,
    sourceStatuses,
    expectedDocCount,
    foundExpectedDocCount,
    optionalFoundDocCount,
    externalSources,
    availableExternalCount,
  });
  const missingRequiredDocs = localDocs
    .filter((doc) => doc.required && !doc.found)
    .map((doc) => doc.type);
  const missingSources = sourceStatuses
    .filter((source) => !source.available)
    .map((source) => source.type);
  const dashboardInsights = buildDashboardInsights({
    foundExpectedDocCount,
    expectedDocCount,
    missingRequiredDocs,
    availableExternalCount,
    externalSources,
  });
  const dashboardActionItems = buildDashboardActionItems({ missingRequiredDocs, missingSources });
  const hasSignals = Boolean(workspaceRoot)
    || localDocs.some((doc) => doc.found)
    || sourceStatuses.some((source) => source.available);

  return {
    schemaVersion: REVIEW_DAY_WORKSPACE_SIGNAL_SCHEMA_VERSION,
    schema_version: REVIEW_DAY_WORKSPACE_SIGNAL_SCHEMA_VERSION,
    schema: "agentic30.curriculum.review_day_workspace_signals.v1",
    generatedAt,
    generated_at: generatedAt,
    reviewDay: normalizeOptionalDayNumber(reviewDay),
    review_day: normalizeOptionalDayNumber(reviewDay),
    eligibleDayRange: normalizeDayRange(eligibleDayRange),
    eligible_day_range: normalizeDayRange(eligibleDayRange),
    workspaceRoot,
    workspace_root: workspaceRoot,
    hasSignals,
    has_signals: hasSignals,
    sourceStatuses,
    source_statuses: sourceStatuses,
    availableSourceCount,
    available_source_count: availableSourceCount,
    missingSourceCount,
    missing_source_count: missingSourceCount,
    localDocs,
    local_docs: localDocs,
    expectedDocCount,
    expected_doc_count: expectedDocCount,
    foundExpectedDocCount,
    found_expected_doc_count: foundExpectedDocCount,
    optionalFoundDocCount,
    optional_found_doc_count: optionalFoundDocCount,
    missingRequiredDocs,
    missing_required_docs: missingRequiredDocs,
    externalSourceCount: externalSources.length,
    external_source_count: externalSources.length,
    availableExternalSourceCount: availableExternalCount,
    available_external_source_count: availableExternalCount,
    missingSources,
    missing_sources: missingSources,
    dashboardMetrics,
    dashboard_metrics: dashboardMetrics,
    dashboardInsights,
    dashboard_insights: dashboardInsights,
    dashboardActionItems,
    dashboard_action_items: dashboardActionItems,
  };
}

async function collectLocalDocSignals({ workspaceRoot, docPaths = {}, fsImpl }) {
  const rawDocPaths = objectOrEmpty(docPaths);
  const roles = [...EXPECTED_DOC_TYPES, ...OPTIONAL_DOC_TYPES];
  const entries = [];
  for (const role of roles) {
    const candidates = candidateDocPaths(role);
    const foundPath = await firstExistingWorkspacePath({ workspaceRoot, candidates, fsImpl });
    entries.push({
      type: role,
      path: foundPath,
      found: Boolean(foundPath),
      required: EXPECTED_DOC_TYPES.includes(role),
      configuredPath: stringOrDefault(rawDocPaths[role], ""),
      source: "canonical_path",
    });
  }
  return entries;
}

function buildMissingDocSignals(docPaths = {}) {
  const rawDocPaths = objectOrEmpty(docPaths);
  return [...EXPECTED_DOC_TYPES, ...OPTIONAL_DOC_TYPES].map((role) => ({
    type: role,
    path: projectDocPath(role),
    found: false,
    required: EXPECTED_DOC_TYPES.includes(role),
    configuredPath: stringOrDefault(rawDocPaths[role], ""),
    source: "canonical_path",
  }));
}

async function firstExistingWorkspacePath({ workspaceRoot, candidates, fsImpl }) {
  for (const candidate of candidates) {
    const relativePath = normalizeRelativePath(candidate);
    if (!relativePath) continue;
    const absolutePath = path.resolve(workspaceRoot, relativePath);
    if (!isInsideWorkspace(workspaceRoot, absolutePath)) continue;
    try {
      const stat = await fsImpl.stat(absolutePath);
      if (stat.isFile()) return relativePath;
    } catch {
      // Keep scanning; missing configured docs should degrade into dashboard state.
    }
  }
  return "";
}

function candidateDocPaths(role) {
  return projectDocCandidatePaths(role);
}

function normalizeSourceStatuses({ sources, localDocs, workspaceRoot, errors }) {
  const statuses = [];
  const localWorkspace = objectOrEmpty(sources.localWorkspace ?? sources.local_workspace);
  const localWorkspaceAvailable = Boolean(
    localWorkspace.available
      ?? localWorkspace.connected
      ?? localWorkspace.present
      ?? (workspaceRoot && !errors.includes("workspace_root_unreadable") && !errors.includes("workspace_root_missing")),
  );
  statuses.push(normalizeSourceStatus({
    type: "localWorkspace",
    label: "Local workspace",
    available: localWorkspaceAvailable,
    detail: localWorkspace.reason ?? localWorkspace.detail ?? (localWorkspaceAvailable ? "readable" : errors[0] ?? "missing"),
  }));
  statuses.push(normalizeSourceStatus({
    type: "localDocs",
    label: "Local project docs",
    available: localDocs.some((doc) => doc.found),
    detail: `${localDocs.filter((doc) => doc.required && doc.found).length}/${localDocs.filter((doc) => doc.required).length} required docs`,
  }));

  for (const type of EXTERNAL_SOURCE_TYPES) {
    statuses.push(normalizeSourceStatus({
      type,
      label: sourceLabel(type),
      ...objectOrEmpty(sources[type] ?? sources[snakeCase(type)]),
    }));
  }

  return statuses
    .filter((status, index, all) => all.findIndex((item) => item.type === status.type) === index)
    .sort((a, b) => KNOWN_SOURCE_TYPES.indexOf(a.type) - KNOWN_SOURCE_TYPES.indexOf(b.type));
}

function normalizeSourceStatus(value = {}) {
  const raw = objectOrEmpty(value);
  const type = normalizeSourceType(raw.type);
  const available = Boolean(
    raw.available
      ?? raw.connected
      ?? raw.configured
      ?? raw.enabled
      ?? raw.found
      ?? raw.present
      ?? false,
  );
  return {
    type,
    source_type: type,
    label: stringOrDefault(raw.label ?? sourceLabel(type), sourceLabel(type)),
    available,
    status: available ? "available" : "missing",
    detail: stringOrDefault(raw.detail ?? raw.reason ?? raw.message ?? raw.path ?? raw.url, ""),
  };
}

function normalizeDocSignals(value) {
  if (Array.isArray(value)) {
    return value.map(normalizeDocSignal).filter(Boolean);
  }
  const raw = objectOrEmpty(value);
  const roles = [...EXPECTED_DOC_TYPES, ...OPTIONAL_DOC_TYPES];
  return roles.map((role) => normalizeDocSignal({
    type: role,
    path: raw[role] ?? raw[snakeCase(role)] ?? "",
    found: Boolean(raw[role] ?? raw[snakeCase(role)]),
    required: EXPECTED_DOC_TYPES.includes(role),
    source: "workspace_state",
  })).filter(Boolean);
}

function normalizeDocSignal(value) {
  const raw = objectOrEmpty(value);
  const type = normalizeDocType(raw.type ?? raw.role ?? raw.name);
  if (!type) return null;
  const found = Boolean(raw.found ?? raw.available ?? raw.path ?? raw.foundPath ?? raw.found_path);
  return {
    type,
    doc_type: type,
    label: docLabel(type),
    path: stringOrDefault(raw.path ?? raw.foundPath ?? raw.found_path, ""),
    found,
    required: raw.required === undefined ? EXPECTED_DOC_TYPES.includes(type) : raw.required === true,
    source: stringOrDefault(raw.source, ""),
  };
}

function buildDashboardMetrics({
  availableSourceCount,
  missingSourceCount,
  sourceStatuses,
  expectedDocCount,
  foundExpectedDocCount,
  optionalFoundDocCount,
  externalSources,
  availableExternalCount,
}) {
  return [
    {
      label: "Workspace sources",
      value: `${availableSourceCount}/${sourceStatuses.length}`,
      trend: missingSourceCount > 0 ? "missing-sources" : "ready",
      intent: "Review Day가 참조할 수 있는 로컬/MCP/CLI/Browser/Google 신호",
      status: missingSourceCount > 0 ? "watch" : "healthy",
    },
    {
      label: "Workspace docs",
      value: `${foundExpectedDocCount}/${expectedDocCount}`,
      trend: foundExpectedDocCount === expectedDocCount ? "context-ready" : "needs-docs",
      intent: "ICP/VALUES/GOAL/SPEC 필수 문서 준비도",
      status: foundExpectedDocCount === expectedDocCount ? "healthy" : "watch",
    },
    {
      label: "External verification sources",
      value: `${availableExternalCount}/${externalSources.length}`,
      trend: availableExternalCount > 0 ? "auto-verify-ready" : "fallback-evidence",
      intent: "Action 증거 자동 확인에 쓸 외부 도구 연결 상태",
      status: availableExternalCount > 0 ? "healthy" : "watch",
    },
    {
      label: "Optional workspace refs",
      value: String(optionalFoundDocCount),
      trend: optionalFoundDocCount > 0 ? "extra-context" : "minimal-context",
      intent: "README, Sheet, ADR, Design docs 같은 보조 맥락",
      status: optionalFoundDocCount > 0 ? "healthy" : "neutral",
    },
  ];
}

function buildDashboardInsights({
  foundExpectedDocCount,
  expectedDocCount,
  missingRequiredDocs,
  availableExternalCount,
  externalSources,
}) {
  const insights = [];
  if (foundExpectedDocCount === expectedDocCount) {
    insights.push("Workspace 필수 문서가 Review Day 대시보드 맥락으로 연결되어 있습니다.");
  } else {
    insights.push(`Workspace 필수 문서 ${missingRequiredDocs.join(", ")}가 비어 있어 Review 판단 근거가 얇습니다.`);
  }
  if (availableExternalCount > 0) {
    insights.push(`자동 검증 소스 ${availableExternalCount}개를 Action 증거 확인에 바로 쓸 수 있습니다.`);
  } else if (externalSources.length > 0) {
    insights.push("자동 검증 소스가 없어 이번 Review는 링크나 파일 증거 제출 fallback을 우선합니다.");
  }
  return insights;
}

function buildDashboardActionItems({ missingRequiredDocs, missingSources }) {
  const items = [];
  if (missingRequiredDocs.length) {
    items.push(`다음 Action 전에 ${missingRequiredDocs.map(docLabel).join(", ")} 문서 중 하나를 5줄로 채워보세요.`);
  }
  if (missingSources.includes("mcp") && missingSources.includes("cli") && missingSources.includes("browser")) {
    items.push("자동 검증이 막히면 진행을 멈추지 말고 링크나 파일 증거로 먼저 제출해보세요.");
  }
  return items;
}

function sourceLabel(type) {
  return {
    localWorkspace: "Local workspace",
    localDocs: "Local project docs",
    mcp: "MCP tools",
    cli: "CLI checks",
    browser: "Browser tool",
    googleDocs: "Google Docs",
    googleSheets: "Google Sheets",
  }[type] ?? type;
}

function docLabel(type) {
  return {
    icp: "ICP",
    values: "VALUES",
    goal: "GOAL",
    spec: "SPEC",
    docs: "Docs",
    sheet: "Sheet",
    designSystem: "Design System",
    adr: "ADR",
  }[type] ?? type;
}

function normalizeDocType(value) {
  const token = stringOrDefault(value, "");
  const map = {
    design_system: "designSystem",
    designsystem: "designSystem",
    google_sheet: "sheet",
    sheets: "sheet",
  };
  return [...EXPECTED_DOC_TYPES, ...OPTIONAL_DOC_TYPES].includes(token) ? token : map[snakeCase(token)] ?? "";
}

function normalizeSourceType(value) {
  const token = stringOrDefault(value, "");
  const map = {
    local_workspace: "localWorkspace",
    local_docs: "localDocs",
    google_docs: "googleDocs",
    google_sheets: "googleSheets",
  };
  return KNOWN_SOURCE_TYPES.includes(token) ? token : map[snakeCase(token)] ?? token;
}

function normalizeDayRange(value) {
  const raw = objectOrEmpty(value);
  const start = normalizeOptionalDayNumber(raw.start ?? raw.from);
  const end = normalizeOptionalDayNumber(raw.end ?? raw.to);
  return start && end ? { start, end } : null;
}

function normalizeOptionalDayNumber(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.min(30, Math.max(1, Math.trunc(n)));
}

function normalizeRelativePath(value) {
  const text = stringOrDefault(value, "");
  if (!text || path.isAbsolute(text)) return "";
  const normalized = path.normalize(text);
  if (normalized === "." || normalized.startsWith("..") || path.isAbsolute(normalized)) return "";
  return normalized;
}

function isInsideWorkspace(workspaceRoot, absolutePath) {
  const relative = path.relative(path.resolve(workspaceRoot), path.resolve(absolutePath));
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function snakeCase(value) {
  return String(value ?? "")
    .trim()
    .replace(/([a-z0-9])([A-Z])/g, "$1_$2")
    .replace(/[\s-]+/g, "_")
    .toLowerCase();
}

function normalizeStringArray(value) {
  if (!Array.isArray(value)) return [];
  return value.map((entry) => String(entry ?? "").trim()).filter(Boolean);
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

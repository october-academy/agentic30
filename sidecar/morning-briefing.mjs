import fs from "node:fs/promises";
import path from "node:path";

import { atomicWriteJson } from "./atomic-store.mjs";
import {
  ensureMorningBriefingDrilldowns,
  normalizeMorningBriefingDrilldowns,
} from "./morning-briefing-drilldown.mjs";

export const MORNING_BRIEFING_SCHEMA_VERSION = 2;
export const MORNING_BRIEFING_FILE = "morning-briefing.json";
export const MORNING_BRIEFING_RUNS_DIR = "morning-briefing-runs";
export const MORNING_BRIEFING_HISTORY_LIMIT = 14;
export const MORNING_BRIEFING_TOTAL_DAYS = 30;

const CARD_ORDER = Object.freeze(["cloudflare", "github", "posthog"]);
const RUN_LOG_FIELD_LIMIT = 80;
const RUN_LOG_ARRAY_LIMIT = 20;
const RUN_LOG_STRING_LIMIT = 260;
const RUN_LOG_SECRET_KEY_RE = /token|secret|password|authorization|api[_-]?key|email|ip|raw|row|rows|payload|body/i;
const RUN_LOG_SECRET_VALUE_PATTERNS = Object.freeze([
  /\bgh[pousr]_[A-Za-z0-9_]{20,}\b/g,
  /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g,
  /\bAIza[A-Za-z0-9_-]{20,}\b/g,
  /\bxox[baprs]-[A-Za-z0-9_-]{10,}\b/g,
  /\bph[xa]_[A-Za-z0-9_-]{20,}\b/g,
  /\b[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}\b/gi,
  /\b(?:\d{1,3}\.){3}\d{1,3}\b/g,
]);

export const MORNING_BRIEFING_ANOMALY_OPTION_SETS = Object.freeze({
  metric_drop: [
    {
      id: "real_churn",
      title: "실제 이탈이다",
      detail: "신호 하락이 실제 사용자 행동 변화로 보입니다. 오늘 바로 사용자에게 물어봅니다.",
      tail: "메시지 + 실험",
    },
    {
      id: "tracking_gap",
      title: "추적 누락이다",
      detail: "이벤트가 일부 안 잡혔을 수 있습니다. 계측부터 손봅니다.",
      tail: "계측 우선",
    },
    {
      id: "small_sample",
      title: "표본이 너무 작다",
      detail: "표본이 작아 한두 명 변화가 크게 보입니다. 며칠 더 모은 뒤 판단합니다.",
      tail: "판단 보류",
    },
    {
      id: "custom",
      title: "다르게 본다",
      detail: "위 셋이 아니면 직접 라벨을 남깁니다. 오늘 브리핑 근거에 기록됩니다.",
      tail: "직접 입력",
    },
  ],
  build_without_evidence: [
    {
      id: "ship_to_user",
      title: "사람에게 보여줄 차례다",
      detail: "코드 신호만 쌓였습니다. 오늘은 만든 것을 실제 사람 1명에게 보여줍니다.",
      tail: "메시지 우선",
    },
    {
      id: "instrument_first",
      title: "계측이 먼저다",
      detail: "고객 행동을 잡을 이벤트 자체가 없을 수 있습니다. 계측부터 깝니다.",
      tail: "계측 우선",
    },
    {
      id: "intentional_build",
      title: "의도된 빌드 구간이다",
      detail: "지금은 의도적으로 빌드에 집중하는 구간입니다. 내일 다시 확인합니다.",
      tail: "판단 보류",
    },
    {
      id: "custom",
      title: "다르게 본다",
      detail: "위 셋이 아니면 직접 라벨을 남깁니다. 오늘 브리핑 근거에 기록됩니다.",
      tail: "직접 입력",
    },
  ],
});

function cleanString(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value, max = 1200) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function toIso(value) {
  const ts = Date.parse(String(value ?? ""));
  return Number.isFinite(ts) ? new Date(ts).toISOString() : null;
}

function nowIso(now) {
  if (now instanceof Date) return now.toISOString();
  const ts = Number(now);
  return Number.isFinite(ts) ? new Date(ts).toISOString() : new Date().toISOString();
}

function localDateKey(iso) {
  const text = String(iso || "").trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  const ts = Date.parse(text);
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function historyEntryDateKey(entry = {}) {
  return localDateKey(entry?.generatedAt) || String(entry?.date || "");
}

function timeLabel(iso) {
  const ts = Date.parse(String(iso || ""));
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  const hh = String(date.getHours()).padStart(2, "0");
  const mm = String(date.getMinutes()).padStart(2, "0");
  return `${hh}:${mm}`;
}

function sourceById(sources = []) {
  return new Map((Array.isArray(sources) ? sources : []).map((source) => [source?.id, source]));
}

// ── Metric extraction ────────────────────────────────────────────────────────
// Each digest source exposes raw counts; the briefing cards need one headline
// metric per card plus the raw counts as detail rows. github merges git + gh_cli
// (commits as the headline, PRs/releases as rows) so the card grid matches the
// three-sources design while the sync pills keep the four real connections.

function pickCount(counts = {}, keys = []) {
  for (const key of keys) {
    const value = finiteNumber(counts?.[key]);
    if (value !== null) return value;
  }
  return null;
}

function hasOwn(value, key) {
  return Boolean(value && typeof value === "object" && Object.prototype.hasOwnProperty.call(value, key));
}

function assertCanonicalCloudflareCounts(counts = {}, context = "Cloudflare counts") {
  if (hasOwn(counts, "pageViews")) {
    throw new Error(`${context} contains legacy counts.pageViews; use counts.pageviews.`);
  }
}

export function extractMorningBriefingMetrics({ sources = [] } = {}) {
  const byId = sourceById(sources);
  const git = byId.get("git");
  const gh = byId.get("gh_cli");
  const posthog = byId.get("posthog");
  const cloudflare = byId.get("cloudflare");
  const metrics = {};
  if (cloudflare) {
    assertCanonicalCloudflareCounts(cloudflare.counts, "Cloudflare source counts");
  }
  if (cloudflare?.state === "ready") {
    metrics.cloudflare = pickCount(cloudflare.counts, ["visits", "uniqueVisitors", "visitors", "requests", "pageviews"]) ?? 0;
  }
  if (git?.state === "ready" || gh?.state === "ready") {
    metrics.github = pickCount(git?.counts, ["commits"]) ?? pickCount(gh?.counts, ["prs"]) ?? 0;
  }
  if (posthog?.state === "ready") {
    metrics.posthog = pickCount(posthog.counts, ["activeUsers", "events", "conversions"]) ?? 0;
  }
  return metrics;
}

function deltaFor(current, previous) {
  const cur = finiteNumber(current);
  const prev = finiteNumber(previous);
  if (cur === null || prev === null) return null;
  const diff = cur - prev;
  const direction = diff > 0 ? "up" : diff < 0 ? "down" : "flat";
  const pct = prev > 0 ? Math.round((diff / prev) * 100) : null;
  const label = direction === "flat"
    ? "변화 없음"
    : pct !== null && Math.abs(pct) <= 999
      ? `${direction === "up" ? "▲" : "▼"} ${Math.abs(pct)}%`
      : `${direction === "up" ? "▲" : "▼"} ${Math.abs(diff)}`;
  return { direction, diff, pct, label, previous: prev };
}

function countRows(counts = {}, defs = []) {
  return defs
    .map(([key, label, format]) => {
      const value = finiteNumber(counts?.[key]);
      if (value === null) return null;
      return { k: label, v: format ? format(value) : String(value) };
    })
    .filter(Boolean);
}

function sourceCounts(digest = {}, id = "") {
  const byId = sourceById(digest.sources || []);
  if (id === "github") {
    return {
      ...(byId.get("git")?.counts || {}),
      ...(byId.get("gh_cli")?.counts || {}),
    };
  }
  const counts = byId.get(id)?.counts || {};
  if (id === "cloudflare") assertCanonicalCloudflareCounts(counts, "Cloudflare source counts");
  return counts;
}

function sourceReady(digest = {}, id = "") {
  const byId = sourceById(digest.sources || []);
  if (id === "github") return byId.get("git")?.state === "ready" || byId.get("gh_cli")?.state === "ready";
  return byId.get(id)?.state === "ready";
}

function sparkFrom(history = [], cardId = "", current = null) {
  const values = history
    .map((entry) => finiteNumber(entry?.metrics?.[cardId]))
    .filter((value) => value !== null);
  if (finiteNumber(current) !== null) values.push(Number(current));
  return values.slice(-8);
}

function previousDateKey(dateKey = "") {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateKey)) return "";
  const ts = Date.parse(`${dateKey}T00:00:00.000Z`);
  if (!Number.isFinite(ts)) return "";
  return new Date(ts - 24 * 60 * 60 * 1000).toISOString().slice(0, 10);
}

function sparkPointTimeLabel({ date = "", at = null, currentDate = "", generatedAt = null, current = false } = {}) {
  const safeAt = toIso(at);
  const dateKey = localDateKey(safeAt) || date;
  const time = safeAt ? timeLabel(safeAt) : "";
  if (current) return time ? `오늘 ${time}` : "오늘";
  if (safeAt && dateKey === previousDateKey(currentDate)) return `어제 ${time}`;
  if (safeAt && dateKey === currentDate) return time ? `오늘 ${time}` : "오늘";
  if (safeAt) return `${dateKey.slice(5)} ${time}`.trim();
  if (dateKey === previousDateKey(localDateKey(generatedAt))) return "어제";
  return dateKey ? dateKey.slice(5) : "값";
}

function sparkPointsFrom(history = [], cardId = "", current = null, { generatedAt = null } = {}) {
  const currentAt = toIso(generatedAt);
  const currentDate = localDateKey(currentAt);
  const points = history
    .map((entry) => {
      const value = finiteNumber(entry?.metrics?.[cardId]);
      if (value === null) return null;
      const at = toIso(entry?.generatedAt);
      const date = String(entry?.date || localDateKey(at) || "");
      return {
        value,
        timeLabel: sparkPointTimeLabel({ date, at, currentDate, generatedAt: currentAt }),
        at,
      };
    })
    .filter(Boolean);
  const currentValue = finiteNumber(current);
  if (currentValue !== null) {
    points.push({
      value: Number(currentValue),
      timeLabel: sparkPointTimeLabel({ date: currentDate, at: currentAt, currentDate, current: true }),
      at: currentAt,
    });
  }
  return points.slice(-8);
}

function assertSparklineHistoryAvailable({ history = [], cardId = "", previousValue = null } = {}) {
  const previous = finiteNumber(previousValue);
  if (previous === null) return;
  const safeHistory = Array.isArray(history) ? history : [];
  if (safeHistory.some((entry) => finiteNumber(entry?.metrics?.[cardId]) !== null)) return;
  throw new Error(
    `Morning briefing sparkline history missing for ${cardId}: previous.metrics.${cardId} exists but history has no prior metric.`,
  );
}

function metricHistoryForRefresh({ history = [], previous = null, generatedAt = "" } = {}) {
  const currentDate = localDateKey(generatedAt);
  const priorHistory = (Array.isArray(history) ? history : [])
    .filter((entry) => historyEntryDateKey(entry) !== currentDate);
  const previousMetrics = previous?.metrics || {};
  const previousMetricIds = Object.keys(previousMetrics)
    .filter((id) => finiteNumber(previousMetrics[id]) !== null);
  const previousAt = toIso(previous?.generatedAt || "");
  if (!previousMetricIds.length || !previousAt) {
    return { priorHistory, metricHistory: priorHistory };
  }
  const historyHasEveryPreviousMetric = previousMetricIds.every((id) =>
    priorHistory.some((entry) => finiteNumber(entry?.metrics?.[id]) !== null),
  );
  if (historyHasEveryPreviousMetric) {
    return { priorHistory, metricHistory: priorHistory };
  }
  const previousDate = localDateKey(previousAt) || currentDate;
  const duplicatePrevious = priorHistory.some((entry) => {
    const entryAt = toIso(entry?.generatedAt || "");
    return entryAt && entryAt === previousAt;
  });
  const metricHistory = duplicatePrevious
    ? priorHistory
    : [
        ...priorHistory,
        {
          date: previousDate,
          generatedAt: previousAt,
          metrics: previousMetrics,
        },
      ];
  return {
    priorHistory,
    metricHistory: metricHistory
      .slice()
      .sort((a, b) => String(a?.generatedAt || a?.date || "").localeCompare(String(b?.generatedAt || b?.date || ""))),
  };
}

// ── Customer evidence verdict ────────────────────────────────────────────────
// The ICP value of the briefing is not "three dashboards in one place"; it is
// a narrow judgment about what to validate today. These optional fields keep
// raw identities out of the payload and summarize only aggregate evidence.

function funnelStep({ id, label, source, value = null, unit = "", status = "unknown", detail = "" }) {
  const number = finiteNumber(value);
  return {
    id,
    label,
    source,
    value: number,
    valueLabel: number === null ? "미계측" : `${number}${unit ? ` ${unit}` : ""}`,
    status,
    detail: cleanString(detail, 160),
  };
}

function stepStatus(value, { missingWhenZero = true } = {}) {
  const number = finiteNumber(value);
  if (number === null) return "unknown";
  if (number > 0) return "observed";
  return missingWhenZero ? "missing" : "observed";
}

export function buildMorningBriefingEvidenceFunnel({ digest = {} } = {}) {
  const cloudflareCounts = sourceCounts(digest, "cloudflare");
  const posthogCounts = sourceCounts(digest, "posthog");
  const traffic = pickCount(cloudflareCounts, ["visits", "uniqueVisitors", "visitors", "pageviews"]);
  const downloads = pickCount(cloudflareCounts, ["dmgRequests", "downloads", "downloadRequests", "installerDownloads"]);
  const installs = pickCount(posthogCounts, ["installUsers", "installs", "appInstalls", "appUsers"]);
  const downloadOrInstall = installs ?? downloads;
  const workspaceOrScan = pickCount(posthogCounts, [
    "scanCompletedUsers",
    "scanCompleted",
    "workspaceSetupCompleted",
    "workspace_setup_completed",
    "sessionCreatedUsers",
    "activeUsers",
  ]);
  const validation = pickCount(posthogCounts, [
    "officeHoursCompletedUsers",
    "officeHoursCompleted",
    "macActivationCompleted",
    "activationUsers",
    "conversions",
  ]);
  const revenue = pickCount(posthogCounts, ["payments", "payingUsers", "revenueEvents", "revenue"]);

  return {
    steps: [
      funnelStep({
        id: "traffic",
        label: "방문",
        source: "Cloudflare",
        value: traffic,
        unit: "명",
        status: stepStatus(traffic),
        detail: sourceReady(digest, "cloudflare") ? "기간 전체 고유 방문자 기준" : "Cloudflare 미연결",
      }),
      funnelStep({
        id: "download_install",
        label: "다운로드/설치",
        source: installs !== null ? "PostHog" : "Cloudflare",
        value: downloadOrInstall,
        unit: "명",
        status: stepStatus(downloadOrInstall),
        detail: installs !== null ? "설치/앱 실행 사용자" : downloads !== null ? "DMG/설치 파일 요청" : "다운로드 또는 설치 이벤트 미계측",
      }),
      funnelStep({
        id: "workspace_scan",
        label: "워크스페이스/스캔",
        source: "PostHog",
        value: workspaceOrScan,
        unit: "명",
        status: stepStatus(workspaceOrScan),
        detail: "workspace 선택 이후 첫 스캔 또는 세션 생성",
      }),
      funnelStep({
        id: "validation_action",
        label: "Office Hours/검증 행동",
        source: "PostHog",
        value: validation,
        unit: "명",
        status: stepStatus(validation),
        detail: "검증 action 적용, Office Hours 완료, 전환 이벤트",
      }),
      funnelStep({
        id: "payment",
        label: "결제",
        source: "PostHog",
        value: revenue,
        unit: revenue === null || revenue === 1 ? "건" : "건",
        status: stepStatus(revenue),
        detail: "결제 이벤트 또는 결제 사용자",
      }),
    ],
  };
}

export function buildCustomerEvidenceVerdict({ digest = {}, cards = [], evidenceFunnel = null } = {}) {
  const githubCounts = sourceCounts(digest, "github");
  const posthogCounts = sourceCounts(digest, "posthog");
  const cloudflareCounts = sourceCounts(digest, "cloudflare");
  const commits = pickCount(githubCounts, ["commits"]) ?? 0;
  const mergedPrs = pickCount(githubCounts, ["mergedPrs", "prs"]) ?? 0;
  const traffic = pickCount(cloudflareCounts, ["visits", "uniqueVisitors", "visitors"]) ?? 0;
  const activeUsers = pickCount(posthogCounts, ["activeUsers"]);
  const conversions = pickCount(posthogCounts, ["conversions"]);
  const signups = pickCount(posthogCounts, ["signups"]);
  const activation = evidenceFunnel?.steps?.find((step) => step.id === "validation_action")?.value;
  const hasBuild = commits > 0 || mergedPrs > 0 || digest.buildWithoutCustomerEvidence;
  const hasTraffic = traffic > 0;
  const posthogReady = sourceReady(digest, "posthog");
  const hasCustomerEvidence = (activeUsers ?? 0) > 1 || (conversions ?? 0) > 0 || (activation ?? 0) > 0;
  const instrumentationMissing = posthogReady && (conversions === 0 || signups === 0 || activeUsers === 0);
  const evidence = [
    hasTraffic ? `Cloudflare 순 방문 ${traffic}명` : null,
    hasBuild ? `GitHub 커밋 ${commits}건${mergedPrs ? ` · PR/릴리즈 ${mergedPrs}건` : ""}` : null,
    posthogReady
      ? `PostHog 활성 ${activeUsers ?? "미계측"}명 · 전환 ${conversions ?? "미계측"}건 · 가입 ${signups ?? "미계측"}건`
      : "PostHog 고객 행동 신호 미연결",
    ...(digest.briefing?.biggestEvidenceGap || []).slice(0, 1),
  ].filter(Boolean).map((line) => cleanString(line, 180));

  if (hasBuild && (!hasCustomerEvidence || instrumentationMissing)) {
    return {
      state: instrumentationMissing ? "instrumentation_gap" : "build_without_customer_evidence",
      title: "빌드는 충분함. 고객 증거/activation 계측이 부족함.",
      body: hasTraffic
        ? "오늘은 새 기능을 더 쌓기보다 방문 이후 다운로드·설치·activation이 끊기는 지점을 먼저 계측하고 확인해야 합니다."
        : "오늘은 코드 신호를 고객 행동 증거로 넘기는 것이 우선입니다. 다운로드/설치/activation 중 하나를 명시적으로 잡아야 합니다.",
      evidence,
      primaryActionId: "task",
    };
  }
  if (hasTraffic && posthogReady && !hasCustomerEvidence) {
    return {
      state: "traffic_without_activation",
      title: "방문은 있지만 activation 증거가 얇음.",
      body: "방문자를 더 모으기 전에 다운로드/설치 후 첫 검증 행동까지 이어졌는지 확인해야 합니다.",
      evidence,
      primaryActionId: "message",
    };
  }
  if (posthogReady && hasCustomerEvidence) {
    return {
      state: "healthy",
      title: "고객 행동 신호가 잡힘. 가장 큰 공백 하나를 좁힐 차례.",
      body: "오늘은 관측된 activation 또는 사용자 행동 신호를 근거로 질문 하나와 실험 하나를 좁히면 됩니다.",
      evidence,
      primaryActionId: cards.some((card) => card.metric?.direction === "down") ? "message" : "experiment",
    };
  }
  return {
    state: "instrumentation_gap",
    title: "고객 증거 판단에 필요한 계측이 부족함.",
    body: "PostHog/Cloudflare 연결 또는 목표 이벤트가 없어서 오늘의 검증 판단이 제한적입니다.",
    evidence,
    primaryActionId: "task",
  };
}

// ── Cards ────────────────────────────────────────────────────────────────────

export function buildMorningBriefingCards({ digest = {}, previousMetrics = {}, history = [], generatedAt = null } = {}) {
  const byId = sourceById(digest.sources || []);
  const metrics = extractMorningBriefingMetrics({ sources: digest.sources || [] });
  const cards = [];

  const cloudflare = byId.get("cloudflare");
  cards.push(buildCard({
    id: "cloudflare",
    label: "Cloudflare",
    subtitle: "트래픽 · 방문 추이",
    state: cloudflare?.state || "missing",
    metricValue: metrics.cloudflare ?? null,
    metricUnit: "순 방문",
    source: cloudflare,
    previousMetrics,
    history,
    generatedAt,
    rows: countRows(cloudflare?.counts, [
      ["pageviews", "페이지뷰"],
      ["requests", "요청"],
      ["conversions", "방문 → 가입"],
    ]).slice(0, 2),
  }));

  const git = byId.get("git");
  const gh = byId.get("gh_cli");
  const githubReady = git?.state === "ready" || gh?.state === "ready";
  cards.push(buildCard({
    id: "github",
    label: "GitHub",
    subtitle: "커밋 · PR · 배포",
    state: githubReady ? "ready" : (git?.state || gh?.state || "missing"),
    metricValue: metrics.github ?? null,
    metricUnit: "커밋",
    source: githubReady
      ? {
          ...((git?.state === "ready" ? git : gh) || {}),
          highlights: [...(git?.highlights || []), ...(gh?.highlights || [])],
          summary: [git?.summary, gh?.summary].filter(Boolean).join(" / "),
        }
      : git || gh,
    previousMetrics,
    history,
    generatedAt,
    rows: [
      ...countRows(gh?.counts, [
        ["prs", "PR 업데이트"],
        ["mergedPrs", "PR 머지"],
        ["releases", "릴리즈"],
      ]),
      ...countRows(git?.counts, [
        ["additions", "추가 라인", (value) => `+${value}`],
        ["uncommittedChanges", "미커밋 변경"],
      ]),
    ].slice(0, 3),
  }));

  const posthog = byId.get("posthog");
  cards.push(buildCard({
    id: "posthog",
    label: "PostHog",
    subtitle: "활성 사용자 · 이벤트",
    state: posthog?.state || "missing",
    metricValue: metrics.posthog ?? null,
    metricUnit: "활성 사용자",
    source: posthog,
    previousMetrics,
    history,
    generatedAt,
    rows: countRows(posthog?.counts, [
      ["events", "이벤트"],
      ["conversions", "전환"],
    ]).slice(0, 2),
  }));

  return cards.sort((a, b) => CARD_ORDER.indexOf(a.id) - CARD_ORDER.indexOf(b.id));
}

function buildCard({
  id,
  label,
  subtitle,
  state,
  metricValue,
  metricUnit,
  source,
  previousMetrics,
  history,
  generatedAt,
  rows = [],
}) {
  const ready = state === "ready";
  const failed = state === "failed";
  const delta = ready ? deltaFor(metricValue, previousMetrics?.[id]) : null;
  assertSparklineHistoryAvailable({
    history,
    cardId: id,
    previousValue: previousMetrics?.[id],
  });
  const note = cleanString(
    ready
      ? (source?.evidenceGaps?.[0] || source?.goalSignals?.[0] || source?.highlights?.[0] || "")
      : failed
        ? failedSourceDetail(id, source?.detail)
        : (source?.detail || "연결되지 않음"),
    120,
  );
  return {
    id,
    label,
    subtitle,
    state: ready ? "ready" : (state || "missing"),
    metric: {
      value: ready ? finiteNumber(metricValue) ?? 0 : null,
      unit: metricUnit,
      deltaLabel: delta?.label || null,
      direction: delta?.direction || null,
      versusLabel: delta ? `어제 ${delta.previous}` : null,
    },
    rows: rows.map((row) => ({ k: cleanString(row.k, 40), v: cleanString(row.v, 80) })),
    spark: ready ? sparkFrom(history, id, metricValue) : [],
    sparkPoints: ready ? sparkPointsFrom(history, id, metricValue, { generatedAt }) : [],
    note,
    noteTone: failed || (ready && (source?.evidenceGaps?.length || delta?.direction === "down")) ? "warn" : "info",
    highlights: (source?.highlights || []).slice(0, 4),
  };
}

function failedSourceDetail(id = "", detail = "") {
  const cleaned = cleanString(detail, 160);
  if (cleaned && !/^external MCP digest failed$/i.test(cleaned)) return cleaned;
  switch (id) {
  case "cloudflare":
    return "Cloudflare Analytics 집계를 완료하지 못했어요 — MCP 연결은 정상이에요.";
  case "posthog":
    return "PostHog 사용량 집계를 완료하지 못했어요 — MCP 연결은 정상이에요.";
  default:
    return "외부 소스 집계를 완료하지 못했어요 — 연결은 정상이에요.";
  }
}

// ── Summary ──────────────────────────────────────────────────────────────────

export function buildMorningBriefingSummary({ digest = {}, cards = [], window = {} } = {}) {
  const readyCards = cards.filter((card) => card.state === "ready");
  const downCard = readyCards.find((card) => card.metric?.direction === "down");
  const upCard = readyCards.find((card) => card.metric?.direction === "up");
  const parts = [];
  // Exact substrings of the final statement, so the screen can render the
  // briefing.html mark (rose) / em (accent) inline highlights.
  const marks = [];
  const emphases = [];
  if (downCard) {
    const phrase = `${downCard.label} ${downCard.metric.unit} ${downCard.metric.deltaLabel} 하락`;
    parts.push(`밤사이 가장 큰 변화는 ${phrase}이에요.`);
    marks.push(phrase);
    if (upCard) {
      const upPhrase = `${upCard.label} ${upCard.metric.unit}은 ${upCard.metric.deltaLabel}`;
      parts.push(`${upPhrase} 늘었어요.`);
      emphases.push(upPhrase);
    }
  } else if (upCard) {
    const phrase = `${upCard.label} ${upCard.metric.unit} ${upCard.metric.deltaLabel} 증가`;
    parts.push(`밤사이 가장 큰 변화는 ${phrase}예요.`);
    emphases.push(phrase);
  }
  const overnight = (digest.briefing?.overnightChanges || []).slice(0, 2);
  parts.push(...overnight);
  if (!parts.length) parts.push("밤사이 연결된 소스에서 큰 변화는 없었어요.");
  const statement = parts.join(" ").slice(0, 600);
  const crits = readyCards
    .filter((card) => card.metric?.deltaLabel)
    .map((card) => ({
      source: card.label,
      label: card.metric.unit,
      value: card.metric.deltaLabel,
      direction: card.metric.direction || "flat",
    }));
  return {
    title: "overnight digest",
    windowLabel: cleanString(window.label || "", 120),
    statement,
    statementMarks: marks.filter((phrase) => statement.includes(phrase)),
    statementEmphases: emphases.filter((phrase) => statement.includes(phrase)),
    crits,
  };
}

// ── Timeline ─────────────────────────────────────────────────────────────────

function timelineTagName(text = "") {
  const cleaned = cleanString(text, 200);
  const explicit = cleaned.match(/^(?:릴리즈|태그)\s+([^\s]+)/);
  if (explicit?.[1]) return explicit[1];
  const generic = cleaned.match(/\b(v\d{8}-\d{4}[^\s]*)\b/);
  return generic?.[1] || "";
}

function dedupeTimelineEvents(events = []) {
  const releaseTags = new Set(
    events
      .filter((event) => /^릴리즈\s+/.test(event.text))
      .map((event) => timelineTagName(event.text))
      .filter(Boolean),
  );
  return events.filter((event) => {
    const tag = timelineTagName(event.text);
    if (!tag || !releaseTags.has(tag)) return true;
    if (/^태그\s+/.test(event.text)) return false;
    if (/^배포\s+성공\s+/.test(event.text)) return false;
    return true;
  });
}

export function buildMorningBriefingTimeline({ digest = {} } = {}) {
  const events = [];
  for (const source of digest.sources || []) {
    const cardId = source.id === "git" || source.id === "gh_cli" ? "github" : source.id;
    for (const event of source.events || []) {
      const at = toIso(event?.at);
      const text = cleanString(event?.text, 200);
      if (!at || !text) continue;
      events.push({ at, timeLabel: timeLabel(at), source: cardId, text });
    }
  }
  const timelineEvents = dedupeTimelineEvents(events)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at));
  if (timelineEvents.length) return timelineEvents.slice(-10);
  // No timestamped events: fall back to highlight lines so the timeline section
  // still tells the overnight story instead of rendering empty.
  return (digest.briefing?.overnightChanges || []).slice(0, 4).map((text) => ({
    at: null,
    timeLabel: "밤사이",
    source: "digest",
    text: cleanString(text, 200),
  }));
}

// ── Anomaly ──────────────────────────────────────────────────────────────────

export function detectMorningBriefingAnomaly({ digest = {}, cards = [] } = {}) {
  const dropCard = cards.find(
    (card) =>
      card.state === "ready"
      && card.metric?.direction === "down"
      && cardDropIsSignificant(card),
  );
  if (dropCard) {
    return {
      id: `metric_drop_${dropCard.id}`,
      kind: "metric_drop",
      title: `${dropCard.label} 신호 하락`,
      question: `${dropCard.label} ${dropCard.metric.unit}이(가) ${dropCard.metric.versusLabel || "어제"} → ${dropCard.metric.value}로 떨어졌어요. 한 가지로 라벨링하면 오늘 액션이 달라져요.`,
      evidence: `근거: ${dropCard.label} ${dropCard.metric.unit} ${dropCard.metric.deltaLabel || ""}`.trim(),
      options: MORNING_BRIEFING_ANOMALY_OPTION_SETS.metric_drop,
      label: null,
      labeledAt: null,
    };
  }
  if (digest.buildWithoutCustomerEvidence) {
    return {
      id: "build_without_evidence",
      kind: "build_without_evidence",
      title: "코드 신호만 있고 고객 증거가 없어요",
      question: "밤사이 신호가 코드 변경 중심이에요. 고객 행동 증거가 없는 상태를 어떻게 볼까요?",
      evidence: cleanString(digest.briefing?.biggestEvidenceGap?.[0] || "근거: git 커밋은 있지만 PostHog 고객 행동 신호가 0입니다.", 200),
      options: MORNING_BRIEFING_ANOMALY_OPTION_SETS.build_without_evidence,
      label: null,
      labeledAt: null,
    };
  }
  return null;
}

function cardDropIsSignificant(card) {
  const label = String(card.metric?.deltaLabel || "");
  const match = label.match(/▼\s*(\d+)/);
  if (!match) return false;
  return Number(match[1]) >= 25;
}

// ── Action drafts ────────────────────────────────────────────────────────────

export function buildMorningBriefingActions({ digest = {}, anomaly = null, customerEvidenceVerdict = null } = {}) {
  const gap = cleanString(digest.briefing?.biggestEvidenceGap?.[0] || "", 200);
  const signal = cleanString(digest.briefing?.goalHelpfulSignals?.[0] || "", 200);
  const anomalyTitle = anomaly ? cleanString(anomaly.title, 80) : "";
  const verdictState = cleanString(customerEvidenceVerdict?.state, 80);
  const evidenceNeedsInstrumentation = ["instrumentation_gap", "build_without_customer_evidence"].includes(verdictState);
  const evidenceNeedsCustomerFollowup = ["traffic_without_activation", "build_without_customer_evidence"].includes(verdictState);

  const messageBody = [
    "안녕하세요 {이름}님, Agentic30 만들고 있는 zettalyst예요.",
    "",
    anomaly
      ? `어제 ${anomalyTitle} 신호가 보여서요. 실제로 쓰시면서 막히거나 그만두게 된 지점이 있었는지 궁금해요.`
      : evidenceNeedsCustomerFollowup
        ? "최근 다운로드/설치 또는 실제 사용 흐름에서 막히거나 그냥 안 쓰게 된 지점이 있었는지 궁금해요."
      : "어제 써 보신 흐름에서 막히거나 그냥 안 쓰게 된 지점이 있었는지 궁금해요.",
    "",
    "— 고치려는 게 아니라, 왜 그랬는지가 궁금해서요.",
  ].join("\n");

  const experimentBody = [
    "# 실험: evidence-gap-probe",
    `가설   ${evidenceNeedsInstrumentation ? "activation/signup 계측 공백을 메우면 고객 증거 판단이 가능해진다" : (gap || "가장 큰 증거 공백을 좁히면 다음 행동이 명확해진다")}`,
    "대상   최근 활성 사용자 · 신규 가입자",
    "측정   고객 행동 증거 1건 (주) · 응답률 (보조)",
    "기간   3일 또는 응답 n≥3 중 늦은 쪽",
  ].join("\n");

  const taskItems = [
    evidenceNeedsInstrumentation
      ? { title: "activation/signup canonical 이벤트 보강", tag: "계측" }
      : null,
    anomaly
      ? { title: `${anomalyTitle} 라벨 확정 후 첫 액션 실행`, tag: "신뢰도" }
      : { title: "가장 큰 증거 공백 1개 좁히기", tag: "검증" },
    { title: signal ? `신호 후속: ${signal}` : "연결된 소스 신호 후속 확인", tag: "관측" },
    { title: gap ? `증거 공백 메우기: ${gap}` : "고객 행동 증거 1건 확보", tag: "검증" },
  ].filter(Boolean).slice(0, 3);

  return [
    {
      id: "message",
      kind: "message",
      badge: "메시지",
      title: anomaly
        ? `${anomalyTitle} 관련 사용자에게 보낼 DM`
        : evidenceNeedsCustomerFollowup
          ? "다운로드/설치 사용자에게 보낼 확인 DM"
          : "어제 사용자에게 보낼 확인 DM",
      subtitle: "Mom Test 톤 · 답을 유도하지 않는 질문",
      body: cleanMultiline(messageBody),
      why: "이탈/정체 원인은 1:1로 물어보면 가장 빨리 잡혀요.",
      copyText: cleanMultiline(messageBody),
      applyLabel: "큐에 추가",
      tasks: [],
    },
    {
      id: "experiment",
      kind: "experiment",
      badge: "실험",
      title: "증거 공백을 좁히는 실험",
      subtitle: "가설 · 측정지표 초안",
      body: cleanMultiline(experimentBody),
      why: "공백이 한 곳에 몰려 있으면, 그 지점을 검증하는 게 가장 깨끗해요.",
      copyText: cleanMultiline(experimentBody),
      applyLabel: "실험 생성",
      tasks: [],
    },
    {
      id: "task",
      kind: "task",
      badge: "태스크",
      title: evidenceNeedsInstrumentation ? "오늘 먼저 메울 계측 공백" : "오늘 빌드에 추가할 태스크",
      subtitle: evidenceNeedsInstrumentation ? "activation/signup 신뢰도부터 확보" : "증거 신뢰도부터 확보",
      body: "",
      why: "추적이 못 믿을 상태면 실험 결과도 못 믿어요.",
      copyText: taskItems.map((item) => item.title).join(" / "),
      applyLabel: "오늘 태스크에 추가",
      tasks: taskItems.map((item) => ({ title: cleanString(item.title, 120), tag: cleanString(item.tag, 20) })),
    },
  ];
}

// ── Connect guide ────────────────────────────────────────────────────────────
// Day 1 ships with git/gh CLI signals only unless PostHog/Cloudflare are
// already connected. When either is missing, the briefing carries a guide
// pointing at Settings > Integrations so tomorrow's briefing gets traffic and
// retention signals too. Null when both are connected — nothing to upsell.

const CONNECT_GUIDE_SOURCES = Object.freeze({
  posthog: { label: "PostHog MCP", benefit: "리텐션 · 활성 사용자 신호" },
  cloudflare: { label: "Cloudflare MCP", benefit: "트래픽 · 방문 추이 신호" },
});

export function buildMorningBriefingConnectGuide({ digest = {}, day = null } = {}) {
  const byId = sourceById(digest.sources || []);
  const missing = Object.keys(CONNECT_GUIDE_SOURCES)
    .filter((id) => {
      const state = cleanString(byId.get(id)?.state, 30);
      return !state || state === "missing" || state === "oauth";
    });
  if (!missing.length) return null;
  const normalizedDay = finiteNumber(day);
  const nextDayLabel = normalizedDay !== null ? `Day ${normalizedDay + 1}` : "내일";
  const missingLabels = missing.map((id) => CONNECT_GUIDE_SOURCES[id].label).join(" · ");
  const detail = normalizedDay !== null && normalizedDay <= 1
    ? `오늘 브리핑은 git · GitHub 신호로 만들었어요. Settings > Integrations에서 ${missingLabels}를 연결하면 ${nextDayLabel} 브리핑부터 트래픽·리텐션 신호가 함께 도착해요.`
    : `Settings > Integrations에서 ${missingLabels}를 연결하면 ${nextDayLabel} 브리핑부터 트래픽·리텐션 신호가 함께 도착해요.`;
  return {
    title: `${nextDayLabel} 브리핑 업그레이드`,
    detail: cleanString(detail, 240),
    settingsSection: "integrations",
    sources: missing.map((id) => ({
      id,
      label: CONNECT_GUIDE_SOURCES[id].label,
      benefit: CONNECT_GUIDE_SOURCES[id].benefit,
    })),
  };
}

// ── Assembly ─────────────────────────────────────────────────────────────────

export function buildMorningBriefing({
  digest = {},
  day = null,
  previous = null,
  history = [],
  now = new Date(),
  phase = "",
  drilldowns = null,
} = {}) {
  const generatedAt = nowIso(now);
  const window = digest.window || {};
  const previousMetrics = previous?.metrics
    || history[history.length - 1]?.metrics
    || {};
  const { priorHistory, metricHistory } = metricHistoryForRefresh({ history, previous, generatedAt });
  const cards = buildMorningBriefingCards({ digest, previousMetrics, history: metricHistory, generatedAt });
  const anomaly = detectMorningBriefingAnomaly({ digest, cards });
  const evidenceFunnel = buildMorningBriefingEvidenceFunnel({ digest });
  const customerEvidenceVerdict = buildCustomerEvidenceVerdict({ digest, cards, evidenceFunnel });
  const normalizedDay = finiteNumber(day);
  const readyCount = cards.filter((card) => card.state === "ready").length;
  return {
    schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION,
    generatedAt,
    day: normalizedDay,
    totalDays: MORNING_BRIEFING_TOTAL_DAYS,
    phase: cleanString(phase, 30),
    window: {
      startIso: window.startIso || null,
      untilIso: window.untilIso || null,
      label: cleanString(window.label || "", 120),
    },
    summary: buildMorningBriefingSummary({ digest, cards, window }),
    customerEvidenceVerdict,
    evidenceFunnel,
    cards,
    timeline: buildMorningBriefingTimeline({ digest }),
    anomaly,
    actions: buildMorningBriefingActions({ digest, anomaly, customerEvidenceVerdict }),
    connectGuide: buildMorningBriefingConnectGuide({ digest, day: normalizedDay }),
    // Per-source drilldown payloads (briefing-cloudflare/github/posthog.html).
    // Every ready source is guaranteed a drilldown: richer provider/CLI payloads
    // win, and a counts-grade drilldown (built from already-collected aggregates)
    // fills any gap so the 드릴다운 link always lands on a real screen.
    drilldowns: ensureMorningBriefingDrilldowns({
      drilldowns: normalizeMorningBriefingDrilldowns(drilldowns || {}),
      sources: digest.sources || [],
    }),
    sync: {
      sources: (digest.sources || []).map((source) => ({
        id: source.id,
        label: source.label,
        state: source.state,
        selected: Boolean(source.selected),
        detail: source.state === "failed"
          ? failedSourceDetail(source.id, source.detail)
          : cleanString(source.detail, 120),
      })),
      readyCount,
      syncedAt: generatedAt,
      syncedAtLabel: timeLabel(generatedAt),
    },
    status: {
      state: readyCount > 0 ? "ready" : "empty",
      detail: readyCount > 0
        ? `소스 ${readyCount}개에서 밤사이 신호를 모았어요.`
        : "연결된 소스가 없어요. Settings > Integrations에서 소스를 연결해 주세요.",
    },
    metrics: extractMorningBriefingMetrics({ sources: digest.sources || [] }),
    // Most-recent-first list of previous briefing dates so the screen's
    // "지난 브리핑" group can render without shipping full historical payloads.
    historyDates: priorHistory
      .map((entry) => historyEntryDateKey(entry))
      .filter(Boolean)
      .sort()
      .slice(-7)
      .reverse(),
    // Same list with the persisted headline/day so the rows can show what each
    // morning actually said (briefing.html "지난 브리핑" rows carry titles).
    historyEntries: priorHistory
      .filter((entry) => historyEntryDateKey(entry))
      .sort((a, b) => historyEntryDateKey(a).localeCompare(historyEntryDateKey(b)))
      .slice(-7)
      .reverse()
      .map((entry) => ({
        date: historyEntryDateKey(entry),
        day: finiteNumber(entry.day),
        title: cleanString(entry.title, 80) || null,
      })),
  };
}

export function labelMorningBriefingAnomaly(briefing, label, { now = new Date() } = {}) {
  const cleaned = cleanString(label, 60);
  if (!briefing?.anomaly || !cleaned) return briefing;
  return {
    ...briefing,
    anomaly: {
      ...briefing.anomaly,
      label: cleaned,
      labeledAt: nowIso(now),
    },
  };
}

// ── Live sync overlay ────────────────────────────────────────────────────────
// sync.sources의 연결 상태는 브리핑 "생성 시점" 스냅샷으로 디스크에 박제된다.
// 사용자가 그 뒤 Settings에서 MCP OAuth를 연결(또는 프로바이더 전환으로 해제)
// 하면 Settings 배지와 브리핑 패널이 모순된다(설정 "MCP 연결됨" vs 패널 "미연결").
// 서빙 직전에 라이브 게이트 결과로 연결 행(state/detail)과 connectGuide만 덮어
// 쓴다 — cards·metrics·readyCount·syncedAt 같은 데이터 스냅샷은 "그때 모은
// 신호"이므로 그대로 둔다. 결과는 서빙 전용이며 절대 persist하지 않는다
// (스키마 버전·마이그레이션과 무관해야 한다).
export function applyMorningBriefingLiveSync(briefing, liveSources = [], { now = new Date() } = {}) {
  if (!briefing || typeof briefing !== "object") return { briefing: null, changed: false };
  const rows = Array.isArray(briefing.sync?.sources) ? briefing.sync.sources : [];
  const live = new Map(
    (Array.isArray(liveSources) ? liveSources : [])
      .filter((source) => source && typeof source.id === "string" && source.state)
      .map((source) => [source.id, source]),
  );
  if (!rows.length || !live.size) return { briefing, changed: false };
  const sources = rows.map((row) => {
    const update = live.get(row?.id);
    const currentState = cleanString(row?.state, 30);
    if (currentState === "failed") {
      return {
        ...row,
        detail: failedSourceDetail(row?.id, row?.detail),
      };
    }
    if (!update) return row;
    return {
      ...row,
      state: cleanString(update.state, 30),
      detail: cleanString(update.detail, 120),
    };
  });
  // connectGuide는 병합된 행 기준으로 재계산 — 패널 행과 업셀 배너가 서로
  // 모순될 수 없게 같은 데이터에서 파생시킨다(둘 다 연결되면 null로 사라진다).
  const connectGuide = buildMorningBriefingConnectGuide({
    digest: { sources },
    day: finiteNumber(briefing.day),
  });
  const cards = sanitizeFailedMorningBriefingCards(briefing.cards, sources);
  const changed = JSON.stringify(sources) !== JSON.stringify(rows)
    || JSON.stringify(connectGuide) !== JSON.stringify(briefing.connectGuide ?? null)
    || JSON.stringify(cards) !== JSON.stringify(briefing.cards ?? []);
  if (!changed) return { briefing, changed: false };
  return {
    briefing: {
      ...briefing,
      cards,
      connectGuide,
      sync: { ...briefing.sync, sources, liveCheckedAt: nowIso(now) },
    },
    changed: true,
  };
}

function sanitizeFailedMorningBriefingCards(cards = [], sources = []) {
  if (!Array.isArray(cards) || !cards.length) return Array.isArray(cards) ? cards : [];
  const byId = sourceById(sources);
  return cards.map((card) => {
    const source = byId.get(card?.id);
    if (source?.state !== "failed") return card;
    const note = failedSourceDetail(card.id, source.detail || card.note);
    if (card.state === "failed" && card.note === note && card.noteTone === "warn") return card;
    return {
      ...card,
      state: "failed",
      note,
      noteTone: "warn",
    };
  });
}

// ── Persistence ──────────────────────────────────────────────────────────────

export function resolveMorningBriefingPath(workspaceRoot) {
  return path.join(path.resolve(String(workspaceRoot || ".")), ".agentic30", MORNING_BRIEFING_FILE);
}

export function resolveMorningBriefingRunsDir(workspaceRoot) {
  return path.join(path.resolve(String(workspaceRoot || ".")), ".agentic30", MORNING_BRIEFING_RUNS_DIR);
}

function safeRunLogFilePart(value = "") {
  const cleaned = String(value || "").replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 96);
  return cleaned || "run";
}

export function resolveMorningBriefingRunLogPath(workspaceRoot, runId = "") {
  return path.join(resolveMorningBriefingRunsDir(workspaceRoot), `${safeRunLogFilePart(runId)}.jsonl`);
}

function redactMorningBriefingRunLogString(value = "") {
  let output = String(value || "").replace(/\s+/g, " ").trim();
  for (const pattern of RUN_LOG_SECRET_VALUE_PATTERNS) {
    output = output.replace(pattern, "[redacted]");
  }
  return output.slice(0, RUN_LOG_STRING_LIMIT);
}

export function sanitizeMorningBriefingRunLogRecord(value, key = "") {
  if (value === null || value === undefined) return null;
  if (RUN_LOG_SECRET_KEY_RE.test(String(key || ""))) return "[redacted]";
  if (typeof value === "string") return redactMorningBriefingRunLogString(value);
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "boolean") return value;
  if (Array.isArray(value)) {
    return value
      .slice(0, RUN_LOG_ARRAY_LIMIT)
      .map((entry) => sanitizeMorningBriefingRunLogRecord(entry, key));
  }
  if (typeof value === "object") {
    const output = {};
    for (const [entryKey, entryValue] of Object.entries(value).slice(0, RUN_LOG_FIELD_LIMIT)) {
      output[entryKey] = sanitizeMorningBriefingRunLogRecord(entryValue, entryKey);
    }
    return output;
  }
  return null;
}

export async function appendMorningBriefingRunLog({
  workspaceRoot,
  runId,
  record,
  fsImpl = fs,
} = {}) {
  const filePath = resolveMorningBriefingRunLogPath(workspaceRoot, runId);
  await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
  const safeRecord = sanitizeMorningBriefingRunLogRecord({
    ts: new Date().toISOString(),
    ...record,
    runId,
  });
  await fsImpl.appendFile(filePath, `${JSON.stringify(safeRecord)}\n`, "utf8");
  return filePath;
}

export async function loadMorningBriefingStore({ workspaceRoot, fsImpl = fs } = {}) {
  const filePath = resolveMorningBriefingPath(workspaceRoot);
  try {
    const raw = await fsImpl.readFile(filePath, "utf8");
    const parsed = JSON.parse(raw);
    if (parsed?.schemaVersion !== MORNING_BRIEFING_SCHEMA_VERSION) {
      return { schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION, current: null, previous: null, history: [] };
    }
    return {
      schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION,
      current: parsed.current ?? null,
      previous: parsed.previous ?? null,
      history: Array.isArray(parsed.history) ? parsed.history : [],
    };
  } catch {
    return { schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION, current: null, previous: null, history: [] };
  }
}

export async function persistMorningBriefing({ workspaceRoot, briefing, fsImpl = fs } = {}) {
  const store = await loadMorningBriefingStore({ workspaceRoot, fsImpl });
  const date = localDateKey(briefing?.generatedAt || "");
  const currentDate = localDateKey(store.current?.generatedAt || "");
  // "어제 브리핑": the last briefing from a *different* local date stays viewable.
  // A same-date re-collect replaces current without demoting it to previous.
  const previous = store.current && currentDate && currentDate !== date
    ? store.current
    : store.previous ?? null;
  const history = [
    ...store.history.filter((entry) => historyEntryDateKey(entry) && historyEntryDateKey(entry) !== date),
    ...(date
      ? [{
          date,
          metrics: briefing?.metrics || {},
          day: briefing?.day ?? null,
          generatedAt: briefing?.generatedAt ?? null,
          // First clause of the overnight statement = the morning's headline.
          title: cleanString(String(briefing?.summary?.statement || "").split(/(?<=[.!?요])\s/)[0] || "", 80),
        }]
      : []),
  ]
    .sort((a, b) => String(a.date).localeCompare(String(b.date)))
    .slice(-MORNING_BRIEFING_HISTORY_LIMIT);
  const next = {
    schemaVersion: MORNING_BRIEFING_SCHEMA_VERSION,
    current: briefing ?? null,
    previous,
    history,
  };
  const filePath = resolveMorningBriefingPath(workspaceRoot);
  if (fsImpl !== fs) {
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    await fsImpl.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
    return next;
  }
  await atomicWriteJson(filePath, next);
  return next;
}

export async function updatePersistedMorningBriefing({ workspaceRoot, update, fsImpl = fs } = {}) {
  const store = await loadMorningBriefingStore({ workspaceRoot, fsImpl });
  if (!store.current) return null;
  const updated = update(store.current);
  if (!updated) return null;
  const next = { ...store, current: updated };
  const filePath = resolveMorningBriefingPath(workspaceRoot);
  if (fsImpl !== fs) {
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    await fsImpl.writeFile(filePath, JSON.stringify(next, null, 2), "utf8");
    return updated;
  }
  await atomicWriteJson(filePath, next);
  return updated;
}

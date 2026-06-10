import path from "node:path";
import { execFile } from "node:child_process";

import {
  buildExternalOfficeHoursDigestPrompt,
  normalizeExternalOfficeHoursDigest,
} from "./daily-office-hours-digest.mjs";

// Morning-briefing drilldown payloads (OD reference: briefing-cloudflare.html,
// briefing-github.html, briefing-posthog.html). GitHub is built locally from
// git/gh CLI output so it is deterministic and works offline; Cloudflare and
// PostHog come from the same provider digest call the briefing already makes,
// extended with structured aggregates (never raw event rows). Every section is
// optional — a missing section means "no real data", and the Mac screen falls
// back to the inline card highlights instead of inventing numbers.

export const MORNING_BRIEFING_DRILLDOWN_IDS = Object.freeze(["cloudflare", "github", "posthog"]);

const KPI_LIMIT = 4;
const BAR_LIMIT = 12;
const TABLE_LIMIT = 6;
const LIST_LIMIT = 8;
const SCAN_LIMIT = 6;
const FUNNEL_LIMIT = 6;
const SIGNAL_LIMIT = 6;
const DRAFT_LIMIT = 4;
const POINT_LIMIT = 8;

function cleanString(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function cleanMultiline(value, max = 1600) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim().slice(0, max);
}

function finiteNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function clampRatio(value) {
  const number = finiteNumber(value);
  if (number === null) return 0;
  return Math.min(1, Math.max(0, number));
}

function direction(value) {
  const raw = cleanString(value, 10).toLowerCase();
  return ["up", "down", "flat"].includes(raw) ? raw : null;
}

// ── Shared section normalizers ───────────────────────────────────────────────

function normalizeKpis(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((kpi) => {
      const label = cleanString(kpi?.label, 40);
      const valueLabel = cleanString(kpi?.valueLabel ?? kpi?.value, 40);
      if (!label || !valueLabel) return null;
      return {
        label,
        valueLabel,
        deltaLabel: cleanString(kpi?.deltaLabel, 30) || null,
        direction: direction(kpi?.direction),
        vsLabel: cleanString(kpi?.vsLabel ?? kpi?.vs, 80) || null,
        flag: Boolean(kpi?.flag),
      };
    })
    .filter(Boolean)
    .slice(0, KPI_LIMIT);
}

function normalizeBars(values = []) {
  const bars = (Array.isArray(values) ? values : [])
    .map((bar) => {
      const value = finiteNumber(bar?.value);
      if (value === null) return null;
      return {
        label: cleanString(bar?.label, 12),
        value: Math.max(0, value),
        tone: ["accent", "amber", "violet", "rose", "muted"].includes(cleanString(bar?.tone, 12))
          ? cleanString(bar?.tone, 12)
          : null,
        tip: cleanString(bar?.tip, 80) || null,
      };
    })
    .filter(Boolean)
    .slice(0, BAR_LIMIT);
  const max = Math.max(1, ...bars.map((bar) => bar.value));
  return bars.map((bar) => ({ ...bar, ratio: Math.max(0.04, bar.value / max) }));
}

function normalizePoints(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((point) => {
      const pct = finiteNumber(point?.pct ?? point?.value);
      if (pct === null) return null;
      return {
        label: cleanString(point?.label, 30),
        pct: Math.min(100, Math.max(0, pct)),
      };
    })
    .filter(Boolean)
    .slice(0, POINT_LIMIT);
}

function normalizeChart(chart) {
  if (!chart || typeof chart !== "object") return null;
  const kind = cleanString(chart.kind, 12) === "curve" ? "curve" : "bars";
  const bars = kind === "bars" ? normalizeBars(chart.bars) : [];
  const points = kind === "curve" ? normalizePoints(chart.points) : [];
  if (kind === "bars" && !bars.length) return null;
  if (kind === "curve" && points.length < 2) return null;
  return {
    kind,
    title: cleanString(chart.title, 80),
    subtitle: cleanString(chart.subtitle, 160) || null,
    bars,
    points,
    baselinePct: kind === "curve" ? finiteNumber(chart.baselinePct) : null,
    legend: (Array.isArray(chart.legend) ? chart.legend : [])
      .map((item) => ({
        label: cleanString(item?.label, 40),
        tone: cleanString(item?.tone, 12) || "accent",
      }))
      .filter((item) => item.label)
      .slice(0, 3),
    footnote: cleanString(chart.footnote, 200) || null,
  };
}

function normalizeTable(values = []) {
  const rows = (Array.isArray(values) ? values : [])
    .map((row) => {
      const value = finiteNumber(row?.value ?? row?.pv);
      if (value === null) return null;
      return {
        code: cleanString(row?.code ?? row?.path, 60),
        label: cleanString(row?.label, 40),
        value: Math.max(0, value),
        share: finiteNumber(row?.share),
      };
    })
    .filter(Boolean)
    .slice(0, TABLE_LIMIT);
  const total = rows.reduce((sum, row) => sum + row.value, 0);
  const max = Math.max(1, ...rows.map((row) => row.value));
  return rows.map((row, index) => ({
    rank: index + 1,
    code: row.code,
    label: row.label,
    valueLabel: String(row.value),
    share: row.share ?? (total > 0 ? Math.round((row.value / total) * 100) : 0),
    ratio: Math.max(0.04, row.value / max),
  }));
}

function normalizeListRows(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((row) => {
      const title = cleanString(row?.title, 160);
      if (!title) return null;
      const kind = cleanString(row?.kind, 16);
      return {
        kind: ["merged", "open", "deploy"].includes(kind) ? kind : "open",
        title,
        metaItems: (Array.isArray(row?.metaItems) ? row.metaItems : [])
          .map((item) => cleanString(item, 60))
          .filter(Boolean)
          .slice(0, 4),
        tag: cleanString(row?.tag, 20) || null,
      };
    })
    .filter(Boolean)
    .slice(0, LIST_LIMIT);
}

function normalizeScanCells(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((cell) => {
      const title = cleanString(cell?.title, 40);
      const valueLabel = cleanString(cell?.valueLabel, 80);
      if (!title || !valueLabel) return null;
      return {
        title,
        cmd: cleanString(cell?.cmd, 60) || null,
        valueLabel,
        sub: cleanString(cell?.sub, 120) || null,
        tone: ["accent", "amber", "violet", "rose", "sky", "off"].includes(cleanString(cell?.tone, 12))
          ? cleanString(cell?.tone, 12)
          : "accent",
        quiet: Boolean(cell?.quiet),
      };
    })
    .filter(Boolean)
    .slice(0, SCAN_LIMIT);
}

function normalizeFunnel(funnel) {
  if (!funnel || typeof funnel !== "object") return null;
  const steps = (Array.isArray(funnel.steps) ? funnel.steps : [])
    .map((step) => {
      const value = finiteNumber(step?.value);
      const label = cleanString(step?.label, 60);
      if (!label || value === null) return null;
      return {
        label,
        value: Math.max(0, value),
        valueLabel: cleanString(step?.valueLabel, 40) || String(Math.max(0, value)),
        drop: Boolean(step?.drop),
      };
    })
    .filter(Boolean)
    .slice(0, FUNNEL_LIMIT);
  if (steps.length < 2) return null;
  const max = Math.max(1, ...steps.map((step) => step.value));
  const gapAfterIndex = finiteNumber(funnel.gapAfterIndex);
  return {
    steps: steps.map((step) => ({
      label: step.label,
      valueLabel: step.valueLabel,
      ratio: Math.max(0.04, step.value / max),
      drop: step.drop,
    })),
    gapAfterIndex: gapAfterIndex !== null && gapAfterIndex >= 0 && gapAfterIndex < steps.length - 1
      ? Math.round(gapAfterIndex)
      : null,
    gapLabel: cleanString(funnel.gapLabel, 160) || null,
  };
}

function normalizeSignals(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((signal) => {
      const text = cleanString(signal?.text, 280);
      if (!text) return null;
      return { time: cleanString(signal?.time, 20) || "—", text };
    })
    .filter(Boolean)
    .slice(0, SIGNAL_LIMIT);
}

function normalizeDrafts(values = [], idPrefix = "drill") {
  return (Array.isArray(values) ? values : [])
    .map((draft, index) => {
      const title = cleanString(draft?.title, 160);
      if (!title) return null;
      const kind = cleanString(draft?.kind, 16);
      return {
        id: cleanString(draft?.id, 60) || `${idPrefix}_${index + 1}`,
        kind: ["message", "experiment", "task"].includes(kind) ? kind : "task",
        badge: cleanString(draft?.badge, 16) || "태스크",
        title,
        subtitle: cleanString(draft?.subtitle, 120) || "",
        body: cleanMultiline(draft?.body),
        why: cleanString(draft?.why, 200) || "",
        copyText: cleanMultiline(draft?.copyText ?? draft?.body),
        applyLabel: cleanString(draft?.applyLabel, 40) || "적용",
        tasks: [],
      };
    })
    .filter(Boolean)
    .slice(0, DRAFT_LIMIT);
}

function normalizeMetaRows(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((row) => {
      const key = cleanString(row?.key, 40);
      const value = cleanString(row?.value, 80);
      if (!key || !value) return null;
      return {
        key,
        value,
        tone: ["accent", "amber", "rose", "violet", "muted"].includes(cleanString(row?.tone, 12))
          ? cleanString(row?.tone, 12)
          : "muted",
      };
    })
    .filter(Boolean)
    .slice(0, 8);
}

export function normalizeMorningBriefingDrilldown(id, raw) {
  if (!MORNING_BRIEFING_DRILLDOWN_IDS.includes(id)) return null;
  if (!raw || typeof raw !== "object") return null;
  const kpis = normalizeKpis(raw.kpis);
  const chart = normalizeChart(raw.chart);
  const table = normalizeTable(raw.table);
  const listRows = normalizeListRows(raw.listRows);
  const scan = normalizeScanCells(raw.scan);
  const funnel = normalizeFunnel(raw.funnel);
  const signals = normalizeSignals(raw.signals);
  const webSignals = normalizeSignals(raw.webSignals);
  const drafts = normalizeDrafts(raw.drafts, `${id}_draft`);
  const maintenance = normalizeDrafts(raw.maintenance, `${id}_keep`);
  const hasContent = kpis.length || chart || table.length || listRows.length
    || scan.length || funnel || signals.length || webSignals.length
    || drafts.length || maintenance.length;
  if (!hasContent) return null;
  const progress = raw.meta?.progress && typeof raw.meta.progress === "object"
    ? {
        label: cleanString(raw.meta.progress.label, 40),
        valueLabel: cleanString(raw.meta.progress.valueLabel, 60),
        sub: cleanString(raw.meta.progress.sub, 60) || null,
        ratio: clampRatio(raw.meta.progress.ratio),
      }
    : null;
  return {
    id,
    title: cleanString(raw.title, 80) || id,
    subtitle: cleanString(raw.subtitle, 160) || "",
    syncPills: (Array.isArray(raw.syncPills) ? raw.syncPills : [])
      .map((pill) => cleanString(pill, 80))
      .filter(Boolean)
      .slice(0, 4),
    kpis,
    kpisMeta: cleanString(raw.kpisMeta, 60) || null,
    chart,
    table,
    listRows,
    listMeta: cleanString(raw.listMeta, 60) || null,
    scan,
    funnel,
    signals,
    // briefing-posthog.html "웹 신호" — a second signal list with its own
    // section heading (경로 분해 etc.), separate from the cohort signals.
    webSignals,
    webMeta: cleanString(raw.webMeta, 80) || null,
    drafts,
    draftsEmpty: raw.draftsEmpty && typeof raw.draftsEmpty === "object"
      ? {
          title: cleanString(raw.draftsEmpty.title, 120),
          detail: cleanString(raw.draftsEmpty.detail, 400),
          evidence: cleanString(raw.draftsEmpty.evidence, 160) || null,
        }
      : null,
    maintenance,
    meta: {
      progress: progress?.label && progress?.valueLabel ? progress : null,
      rows: normalizeMetaRows(raw.meta?.rows),
    },
  };
}

export function normalizeMorningBriefingDrilldowns(raw = {}) {
  const output = {};
  for (const id of MORNING_BRIEFING_DRILLDOWN_IDS) {
    const normalized = normalizeMorningBriefingDrilldown(id, raw?.[id]);
    if (normalized) output[id] = normalized;
  }
  return Object.keys(output).length ? output : null;
}

// ── Counts-grade drilldown (always available for ready sources) ──────────────
// Built strictly from aggregates the digest already collected (counts,
// highlights, goalSignals, evidenceGaps) — never invented numbers. This is the
// guaranteed baseline so every ready source card always drills into a real
// screen; richer provider/CLI sections replace it whenever they exist.

const COUNT_KPI_LABELS = Object.freeze({
  cloudflare: [
    ["visits", "순 방문"],
    ["uniqueVisitors", "순 방문"],
    ["visitors", "방문"],
    ["pageviews", "페이지뷰"],
    ["pageViews", "페이지뷰"],
    ["requests", "요청"],
    ["conversions", "전환"],
  ],
  posthog: [
    ["activeUsers", "활성 사용자"],
    ["events", "이벤트"],
    ["signups", "신규 가입"],
    ["conversions", "전환"],
  ],
  github: [
    ["commits", "커밋"],
    ["mergedPrs", "PR 머지"],
    ["openPrs", "오픈 PR"],
    ["issues", "이슈 업데이트"],
    ["releases", "릴리즈"],
    ["additions", "추가 라인"],
    ["deletions", "삭제 라인"],
  ],
});

const COUNTS_TITLES = Object.freeze({
  cloudflare: { title: "Cloudflare · 트래픽 드릴다운", subtitle: "수집된 집계 기준" },
  posthog: { title: "PostHog · 프로덕트 드릴다운", subtitle: "수집된 집계 기준" },
  github: { title: "GitHub · 빌드·배포 · 레포 신호", subtitle: "git · gh CLI 집계 기준" },
});

export function buildCountsDrilldown(id, sources = []) {
  if (!MORNING_BRIEFING_DRILLDOWN_IDS.includes(id)) return null;
  const relevant = (Array.isArray(sources) ? sources : []).filter((source) => {
    if (!source || source.state !== "ready") return false;
    if (id === "github") return source.id === "git" || source.id === "gh_cli";
    return source.id === id;
  });
  if (!relevant.length) return null;

  const mergedCounts = {};
  for (const source of relevant) {
    for (const [key, value] of Object.entries(source.counts || {})) {
      const number = finiteNumber(value);
      if (number !== null && mergedCounts[key] === undefined) mergedCounts[key] = number;
    }
  }
  const seenLabels = new Set();
  const kpis = (COUNT_KPI_LABELS[id] || [])
    .filter(([key]) => mergedCounts[key] !== undefined)
    .filter(([, label]) => !seenLabels.has(label) && seenLabels.add(label))
    .map(([key, label]) => ({ label, valueLabel: String(mergedCounts[key]) }));

  const signals = [];
  for (const source of relevant) {
    for (const line of source.highlights || []) signals.push({ time: "신호", text: line });
    for (const line of source.goalSignals || []) signals.push({ time: "목표", text: line });
    for (const line of source.evidenceGaps || []) signals.push({ time: "공백", text: line });
  }

  const metaRows = relevant
    .map((source) => ({ key: source.label || source.id, value: "연결됨", tone: "accent" }))
    .slice(0, 4);

  return normalizeMorningBriefingDrilldown(id, {
    ...COUNTS_TITLES[id],
    kpis,
    kpisMeta: "지난 24시간 집계",
    signals,
    meta: { rows: metaRows },
  });
}

/// Guarantee: every ready source card carries a drilldown. Richer payloads
/// (provider digest / gh CLI) win; counts-grade fills whatever is missing.
export function ensureMorningBriefingDrilldowns({ drilldowns = null, sources = [] } = {}) {
  const output = { ...(drilldowns || {}) };
  const readyIds = new Set();
  for (const source of Array.isArray(sources) ? sources : []) {
    if (source?.state !== "ready") continue;
    readyIds.add(source.id === "git" || source.id === "gh_cli" ? "github" : source.id);
  }
  for (const id of MORNING_BRIEFING_DRILLDOWN_IDS) {
    if (output[id] || !readyIds.has(id)) continue;
    const counts = buildCountsDrilldown(id, sources);
    if (counts) output[id] = counts;
  }
  return Object.keys(output).length ? output : null;
}

// ── GitHub drilldown (local git/gh CLI, deterministic) ───────────────────────

const DRILLDOWN_EXEC_TIMEOUT_MS = 12_000;

function defaultExec(cmd, args, { cwd, timeoutMs = DRILLDOWN_EXEC_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 8 * 1024 * 1024, encoding: "utf8" },
      (error, stdout, stderr) => {
        resolve({
          ok: !error,
          stdout: String(stdout || ""),
          stderr: String(stderr || ""),
          code: error?.code ?? null,
        });
      },
    );
  });
}

function parseJsonValue(stdout) {
  try {
    return JSON.parse(String(stdout || ""));
  } catch {
    return null;
  }
}

function parseJsonArrayValue(stdout) {
  const parsed = parseJsonValue(stdout);
  return Array.isArray(parsed) ? parsed : [];
}

function hourLabel(ms) {
  return String(new Date(ms).getHours()).padStart(2, "0");
}

function shortTime(value) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return "";
  const date = new Date(ts);
  return `${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function relativeDays(value, nowMs) {
  const ts = Date.parse(String(value || ""));
  if (!Number.isFinite(ts)) return null;
  return Math.max(0, Math.floor((nowMs - ts) / 86_400_000));
}

function durationLabel(ms) {
  const value = finiteNumber(ms);
  if (value === null || value <= 0) return "";
  const totalSeconds = Math.round(value / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return minutes > 0 ? `${minutes}m${String(seconds).padStart(2, "0")}s` : `${seconds}s`;
}

function deployFootnote(deploy) {
  if (deploy.kind === "release") return `${shortTime(deploy.at)} 배포(Release)가 ${deploy.label}에서 나갔어요.`;
  if (deploy.kind === "package") return `${shortTime(deploy.at)} 배포(Package)가 ${deploy.label}로 나갔어요.`;
  return `${shortTime(deploy.at)} 배포(${deploy.workflowName || "workflow"})가 ${deploy.headBranch || "main"}에서 나갔어요.`;
}

function buildCommitBuckets({ commits = [], deploys = [], window }) {
  const startMs = finiteNumber(window?.startMs);
  const untilMs = finiteNumber(window?.untilMs);
  if (startMs === null || untilMs === null || untilMs <= startMs) return [];
  const bucketMs = Math.max(1, Math.ceil((untilMs - startMs) / 8));
  const buckets = Array.from({ length: 8 }, (_, index) => ({
    start: startMs + index * bucketMs,
    count: 0,
    deploy: null,
  }));
  for (const commit of commits) {
    const ts = finiteNumber(commit?.ts) ?? Date.parse(String(commit?.at || ""));
    if (!Number.isFinite(ts) || ts < startMs || ts >= untilMs) continue;
    const index = Math.min(7, Math.floor((ts - startMs) / bucketMs));
    buckets[index].count += 1;
  }
  for (const deploy of deploys) {
    const ts = Date.parse(String(deploy?.at || ""));
    if (!Number.isFinite(ts) || ts < startMs || ts >= untilMs) continue;
    const index = Math.min(7, Math.floor((ts - startMs) / bucketMs));
    if (!buckets[index].deploy) buckets[index].deploy = shortTime(deploy.at);
  }
  return buckets.map((bucket) => ({
    label: hourLabel(bucket.start),
    value: bucket.count,
    tone: bucket.deploy ? "violet" : null,
    tip: bucket.deploy
      ? `${hourLabel(bucket.start)}시 구간 · ${bucket.count} 커밋 · 배포 ${bucket.deploy}`
      : `${hourLabel(bucket.start)}시 구간 · ${bucket.count} 커밋`,
  }));
}

async function readGithubRepoFacts({ cwd, execImpl }) {
  const [repoView, branch] = await Promise.all([
    execImpl("gh", ["repo", "view", "--json", "nameWithOwner,stargazerCount,hasWikiEnabled"], { cwd }),
    execImpl("git", ["rev-parse", "--abbrev-ref", "HEAD"], { cwd }),
  ]);
  const view = repoView.ok ? parseJsonValue(repoView.stdout) : null;
  return {
    nameWithOwner: cleanString(view?.nameWithOwner, 80),
    stargazerCount: finiteNumber(view?.stargazerCount),
    hasWiki: Boolean(view?.hasWikiEnabled),
    branch: branch.ok ? cleanString(branch.stdout, 60) : "",
  };
}

// GitHub Packages live on the owner (user or org), not the repo, and the list
// endpoint requires an explicit package_type — so we probe both owner kinds ×
// the registries a solo project realistically publishes to. {owner} is a gh
// api placeholder resolved from the repo in cwd; failures stay silent.
const PACKAGE_ENDPOINTS = Object.freeze([
  "users/{owner}/packages?package_type=npm",
  "users/{owner}/packages?package_type=container",
  "orgs/{owner}/packages?package_type=npm",
  "orgs/{owner}/packages?package_type=container",
]);

async function readGithubScanFacts({ cwd, execImpl, nowMs }) {
  const [issueResult, releaseResult, runResult, ...packageResults] = await Promise.all([
    execImpl("gh", ["issue", "list", "--state", "open", "--limit", "30", "--json", "number,title,author,createdAt"], { cwd }),
    execImpl("gh", ["release", "list", "--limit", "20", "--json", "tagName,publishedAt,isDraft,isPrerelease"], { cwd }),
    execImpl("gh", ["run", "list", "--limit", "20", "--json", "conclusion,createdAt,updatedAt,workflowName,displayTitle,headBranch"], { cwd }),
    ...PACKAGE_ENDPOINTS.map((endpoint) => execImpl("gh", ["api", endpoint], { cwd })),
  ]);
  const issues = parseJsonArrayValue(issueResult.ok ? issueResult.stdout : "");
  const releases = parseJsonArrayValue(releaseResult.ok ? releaseResult.stdout : "")
    .filter((release) => !release?.isDraft);
  const runs = parseJsonArrayValue(runResult.ok ? runResult.stdout : "");

  const packagesAvailable = packageResults.some((result) => result?.ok);
  const packagesByKey = new Map();
  for (const result of packageResults) {
    for (const pkg of parseJsonArrayValue(result?.ok ? result.stdout : "")) {
      const name = cleanString(pkg?.name, 80);
      const key = `${cleanString(pkg?.package_type, 20)}/${name}`;
      if (!name || packagesByKey.has(key)) continue;
      packagesByKey.set(key, {
        name,
        packageType: cleanString(pkg?.package_type, 20),
        updatedAt: cleanString(pkg?.updated_at, 40),
        versionCount: finiteNumber(pkg?.version_count),
        repository: cleanString(pkg?.repository?.full_name, 80),
      });
    }
  }

  const lastRelease = releases[0] || null;
  let unreleasedCommits = null;
  if (lastRelease?.tagName) {
    const revList = await execImpl("git", ["rev-list", "--count", `${lastRelease.tagName}..HEAD`], { cwd });
    unreleasedCommits = revList.ok ? finiteNumber(revList.stdout.trim()) : null;
  }

  const completedRuns = runs.filter((run) => run?.conclusion);
  const successRuns = completedRuns.filter((run) => String(run.conclusion).toLowerCase() === "success");
  const failedRuns = completedRuns.filter((run) => String(run.conclusion).toLowerCase() === "failure");
  const durations = completedRuns
    .map((run) => Date.parse(run.updatedAt || "") - Date.parse(run.createdAt || ""))
    .filter((value) => Number.isFinite(value) && value > 0);
  const avgDurationMs = durations.length
    ? durations.reduce((sum, value) => sum + value, 0) / durations.length
    : null;

  return {
    issuesAvailable: issueResult.ok,
    openIssues: issues.length,
    newestIssue: issues
      .slice()
      .sort((a, b) => Date.parse(b?.createdAt || 0) - Date.parse(a?.createdAt || 0))[0] || null,
    releasesAvailable: releaseResult.ok,
    releases,
    lastRelease,
    packagesAvailable,
    packages: [...packagesByKey.values()],
    lastReleaseDays: lastRelease ? relativeDays(lastRelease.publishedAt, nowMs) : null,
    unreleasedCommits,
    runsAvailable: runResult.ok,
    completedRunCount: completedRuns.length,
    successRunCount: successRuns.length,
    failedRunCount: failedRuns.length,
    avgDurationMs,
    runs,
  };
}

async function readReadmeFreshness({ cwd, execImpl, nowMs }) {
  const lastTouch = await execImpl("git", ["log", "-1", "--format=%cI", "--", "README.md"], { cwd });
  const iso = lastTouch.ok ? lastTouch.stdout.trim() : "";
  const days = iso ? relativeDays(iso, nowMs) : null;
  if (days === null) return null;
  const sinceCount = await execImpl("git", ["rev-list", "--count", `--since=${iso}`, "HEAD"], { cwd });
  return {
    days,
    commitsSince: sinceCount.ok ? finiteNumber(sinceCount.stdout.trim()) : null,
  };
}

export async function collectGithubDrilldown({
  workspaceRoot,
  window = {},
  gitSource = null,
  ghSource = null,
  previousCommitCount = null,
  execImpl = defaultExec,
} = {}) {
  if (typeof execImpl !== "function") return null;
  const gitReady = gitSource?.state === "ready";
  const ghReady = ghSource?.state === "ready";
  if (!gitReady && !ghReady) return null;
  const cwd = path.resolve(String(workspaceRoot || "."));
  const nowMs = finiteNumber(window?.untilMs) ?? Date.now();

  const counts = gitSource?.counts || {};
  const commits = finiteNumber(counts.commits) ?? 0;
  const additions = finiteNumber(counts.additions);
  const deletions = finiteNumber(counts.deletions);
  const commitEvents = (gitSource?.events || []).map((event) => ({ at: event.at }));

  let prRows = [];
  let deploys = [];
  let scanFacts = null;
  let repoFacts = null;
  let readme = null;
  const ghCounts = ghSource?.counts || {};

  if (ghReady) {
    const inWindow = (iso) => {
      const ts = Date.parse(iso || "");
      return Number.isFinite(ts)
        && ts >= (finiteNumber(window?.startMs) ?? -Infinity)
        && ts < (finiteNumber(window?.untilMs) ?? Infinity);
    };
    const [prResult, facts, repo, freshness] = await Promise.all([
      execImpl(
        "gh",
        ["pr", "list", "--state", "all", "--limit", "30", "--json", "number,title,state,createdAt,updatedAt,mergedAt,additions,deletions"],
        { cwd },
      ),
      readGithubScanFacts({ cwd, execImpl, nowMs }),
      readGithubRepoFacts({ cwd, execImpl }),
      readReadmeFreshness({ cwd, execImpl, nowMs }),
    ]);
    scanFacts = facts;
    repoFacts = repo;
    readme = freshness;

    const prs = parseJsonArrayValue(prResult.ok ? prResult.stdout : "")
      .filter((pr) => inWindow(pr.updatedAt || pr.createdAt));
    prRows = prs
      .slice(0, LIST_LIMIT - 2)
      .map((pr) => {
        const state = String(pr.state || "").toUpperCase();
        const merged = state === "MERGED";
        const metaItems = [];
        if (merged && pr.mergedAt) metaItems.push(`머지 ${shortTime(pr.mergedAt)}`);
        if (!merged && pr.updatedAt) metaItems.push(`업데이트 ${shortTime(pr.updatedAt)}`);
        if (finiteNumber(pr.additions) !== null) metaItems.push(`+${pr.additions}`);
        if (finiteNumber(pr.deletions) !== null) metaItems.push(`−${pr.deletions}`);
        return {
          kind: merged ? "merged" : "open",
          title: `#${pr.number} ${cleanString(pr.title, 110)}`,
          metaItems,
          tag: merged ? "merged" : state === "OPEN" ? "open" : state.toLowerCase(),
        };
      });

    const runDeploys = (facts.runs || [])
      .filter((run) => String(run?.conclusion || "").toLowerCase() === "success" && inWindow(run.updatedAt || run.createdAt))
      .slice(0, 2)
      .map((run) => ({
        kind: "workflow",
        at: run.updatedAt || run.createdAt,
        workflowName: cleanString(run.workflowName, 60),
        durationMs: Date.parse(run.updatedAt || "") - Date.parse(run.createdAt || ""),
        headBranch: cleanString(run.headBranch, 60),
      }));
    const releaseDeploys = (facts.releases || [])
      .filter((release) => inWindow(release?.publishedAt))
      .slice(0, 2)
      .map((release) => ({
        kind: "release",
        at: release.publishedAt,
        label: cleanString(release.tagName, 40) || "release",
        prerelease: Boolean(release.isPrerelease),
      }));
    const packageDeploys = (facts.packages || [])
      .filter((pkg) => (!pkg.repository || pkg.repository === repo?.nameWithOwner) && inWindow(pkg.updatedAt))
      .slice(0, 2)
      .map((pkg) => ({
        kind: "package",
        at: pkg.updatedAt,
        label: pkg.name,
        packageType: pkg.packageType,
      }));
    deploys = [...runDeploys, ...releaseDeploys, ...packageDeploys]
      .sort((a, b) => (Date.parse(b.at || "") || 0) - (Date.parse(a.at || "") || 0))
      .slice(0, 4);
    for (const deploy of deploys) {
      if (deploy.kind === "release") {
        prRows.push({
          kind: "deploy",
          title: `릴리스 ${deploy.label}${deploy.prerelease ? " · pre" : ""}`,
          metaItems: [`${shortTime(deploy.at)} 발행`, "gh release"],
          tag: "released",
        });
      } else if (deploy.kind === "package") {
        prRows.push({
          kind: "deploy",
          title: `패키지 ${deploy.label}${deploy.packageType ? ` · ${deploy.packageType}` : ""}`,
          metaItems: [`${shortTime(deploy.at)} 갱신`, "gh api packages"],
          tag: "package",
        });
      } else {
        prRows.push({
          kind: "deploy",
          title: `워크플로 ${deploy.workflowName || "run"} · ${deploy.headBranch || "main"}`,
          metaItems: [
            `${shortTime(deploy.at)} 성공`,
            durationLabel(deploy.durationMs) ? `실행 ${durationLabel(deploy.durationMs)}` : "",
          ].filter(Boolean),
          tag: "deployed",
        });
      }
    }
  }

  const deployBreakdown = [
    ["workflow", "워크플로"],
    ["release", "릴리스"],
    ["package", "패키지"],
  ]
    .map(([kind, label]) => {
      const count = deploys.filter((deploy) => deploy.kind === kind).length;
      return count ? `${label} ${count}` : "";
    })
    .filter(Boolean);
  const mixedDeploys = deploys.some((deploy) => deploy.kind !== "workflow");

  const mergedPrs = finiteNumber(ghCounts.mergedPrs) ?? 0;
  const openPrs = finiteNumber(ghCounts.openPrs) ?? 0;
  const kpis = [];
  const previous = finiteNumber(previousCommitCount);
  const commitDelta = previous !== null ? commits - previous : null;
  kpis.push({
    label: "커밋",
    valueLabel: String(commits),
    deltaLabel: commitDelta === null ? null : commitDelta === 0 ? "=" : `${commitDelta > 0 ? "▲" : "▼"} ${Math.abs(commitDelta)}`,
    direction: commitDelta === null ? null : commitDelta > 0 ? "up" : commitDelta < 0 ? "down" : "flat",
    vsLabel: previous !== null ? `어제 ${previous}` : null,
  });
  if (ghReady) {
    kpis.push({
      label: "PR 머지",
      valueLabel: String(mergedPrs),
      vsLabel: openPrs ? `오픈 ${openPrs}` : null,
    });
    kpis.push({
      label: "배포",
      valueLabel: String(deploys.length),
      deltaLabel: deploys.length ? "성공" : null,
      direction: deploys.length ? "up" : null,
      vsLabel: deploys.length
        ? `${shortTime(deploys[0].at)}${durationLabel(deploys[0].durationMs) ? ` · ${durationLabel(deploys[0].durationMs)}` : ""}`
        : "이 기간 없음",
    });
  }
  if (additions !== null || deletions !== null) {
    kpis.push({
      label: "순 변경",
      valueLabel: `+${additions ?? 0} −${deletions ?? 0}`,
      vsLabel: `커밋 ${commits}건 기준`,
    });
  }

  const scan = [];
  if (scanFacts?.issuesAvailable) {
    scan.push({
      title: "이슈",
      cmd: "gh issue list",
      valueLabel: `열린 ${scanFacts.openIssues}`,
      sub: scanFacts.newestIssue
        ? `#${scanFacts.newestIssue.number} · ${cleanString(scanFacts.newestIssue.title, 60)}`
        : "열린 이슈 없음",
      tone: scanFacts.openIssues > 0 ? "sky" : "off",
      quiet: scanFacts.openIssues === 0,
    });
  }
  if (scanFacts?.releasesAvailable) {
    scan.push({
      title: "릴리스",
      cmd: "gh release list",
      valueLabel: scanFacts.lastRelease
        ? `마지막 ${cleanString(scanFacts.lastRelease.tagName, 30)} · ${scanFacts.lastReleaseDays}일 전`
        : "릴리스 없음",
      sub: scanFacts.unreleasedCommits !== null
        ? `미릴리스 커밋 ${scanFacts.unreleasedCommits}`
        : null,
      tone: "violet",
      quiet: !scanFacts.lastRelease,
    });
  }
  if (scanFacts?.packagesAvailable) {
    const repoPackages = (scanFacts.packages || [])
      .filter((pkg) => !pkg.repository || pkg.repository === repoFacts?.nameWithOwner);
    scan.push({
      title: "패키지",
      cmd: "gh api packages",
      valueLabel: repoPackages.length ? `패키지 ${repoPackages.length}` : "패키지 없음",
      sub: repoPackages[0]
        ? `${repoPackages[0].name}${repoPackages[0].versionCount !== null ? ` · 버전 ${repoPackages[0].versionCount}` : ""}`
        : null,
      tone: "violet",
      quiet: !repoPackages.length,
    });
  }
  if (scanFacts?.runsAvailable) {
    scan.push({
      title: "Actions",
      cmd: "gh run list",
      valueLabel: scanFacts.completedRunCount
        ? `성공 ${scanFacts.successRunCount}/${scanFacts.completedRunCount}${scanFacts.failedRunCount ? ` · 실패 ${scanFacts.failedRunCount}` : ""}`
        : "완료된 실행 없음",
      sub: scanFacts.avgDurationMs ? `평균 ${durationLabel(scanFacts.avgDurationMs)}` : null,
      tone: scanFacts.failedRunCount ? "amber" : "accent",
      quiet: !scanFacts.completedRunCount,
    });
  }
  if (repoFacts && repoFacts.stargazerCount !== null) {
    scan.push({
      title: "인사이트",
      cmd: "gh repo view",
      valueLabel: `Stars ${repoFacts.stargazerCount}`,
      sub: repoFacts.nameWithOwner || null,
      tone: "amber",
    });
  }
  if (repoFacts) {
    scan.push({
      title: "위키",
      cmd: "gh repo view",
      valueLabel: repoFacts.hasWiki ? "위키 활성" : "위키 비활성",
      sub: repoFacts.hasWiki ? null : "지금은 README 하나로 충분해요",
      tone: "off",
      quiet: !repoFacts.hasWiki,
    });
  }

  const maintenance = [];
  if (readme && readme.days >= 7 && (readme.commitsSince ?? 0) >= 10) {
    const body = [
      "# README가 제품을 따라오지 못한 거리",
      `$ git log -1 --format='%cr' -- README.md`,
      `${readme.days} days ago`,
      `$ git rev-list --count --since='${readme.days} days ago' HEAD`,
      `${readme.commitsSince}  # 그 사이 커밋`,
    ].join("\n");
    maintenance.push({
      id: "github_keep_readme",
      kind: "message",
      badge: "문서",
      title: `README 최신화 — 문서가 ${readme.days}일 전 제품을 설명하고 있어요`,
      subtitle: `git log -1 -- README.md · ${readme.days}일 전 이후 커밋 ${readme.commitsSince}건`,
      body,
      why: "새 방문자가 처음 읽는 화면이 옛 제품이면 첫인상에서 어긋나요.",
      copyText: body,
      applyLabel: "초안 PR 맡기기",
    });
  }
  if (scanFacts?.lastRelease && (scanFacts.lastReleaseDays ?? 0) >= 7 && (scanFacts.unreleasedCommits ?? 0) >= 10) {
    const body = [
      `$ gh release list --limit 1`,
      `${scanFacts.lastRelease.tagName}  Latest  ${scanFacts.lastReleaseDays} days ago`,
      `$ git log ${scanFacts.lastRelease.tagName}..HEAD --oneline | wc -l`,
      `${scanFacts.unreleasedCommits}`,
    ].join("\n");
    maintenance.push({
      id: "github_keep_release",
      kind: "experiment",
      badge: "릴리스",
      title: `${scanFacts.lastRelease.tagName}에서 멈춘 릴리스 — 변경이 노트 없이 ${scanFacts.lastReleaseDays}일째 나가고 있어요`,
      subtitle: `gh release list · 미릴리스 커밋 ${scanFacts.unreleasedCommits}건`,
      body,
      why: "릴리스 노트는 공짜 마케팅이에요 — 방문자가 '뭐가 새로워졌나'를 찾고 있어요.",
      copyText: body,
      applyLabel: "릴리스 노트 초안 맡기기",
    });
  }
  if (scanFacts && scanFacts.failedRunCount >= 2) {
    const body = [
      `$ gh run list --limit 20 --json conclusion`,
      `success ${scanFacts.successRunCount} · failure ${scanFacts.failedRunCount}`,
      scanFacts.avgDurationMs ? `평균 실행 ${durationLabel(scanFacts.avgDurationMs)}` : "",
    ].filter(Boolean).join("\n");
    maintenance.push({
      id: "github_keep_ci",
      kind: "task",
      badge: "CI",
      title: `Actions 최근 ${scanFacts.completedRunCount}회 — 실패 ${scanFacts.failedRunCount}건이 쌓이고 있어요`,
      subtitle: "gh run list --limit 20",
      body,
      why: "\"빨간불이면 일단 재실행\" 습관이 굳기 전에 잡아야 진짜 실패를 안 놓쳐요.",
      copyText: body,
      applyLabel: "실패 원인 조사 맡기기",
    });
  }

  const metaRows = [];
  if (repoFacts?.nameWithOwner) metaRows.push({ key: "리포", value: repoFacts.nameWithOwner });
  if (repoFacts?.branch) metaRows.push({ key: "브랜치", value: repoFacts.branch, tone: "accent" });
  if (ghReady) metaRows.push({ key: "오픈 PR", value: String(openPrs), tone: openPrs ? "amber" : "muted" });
  if (scanFacts?.issuesAvailable) metaRows.push({ key: "열린 이슈", value: String(scanFacts.openIssues), tone: "sky" });
  if (scanFacts?.lastRelease) {
    metaRows.push({
      key: "릴리스",
      value: `${cleanString(scanFacts.lastRelease.tagName, 30)} · ${scanFacts.lastReleaseDays}일 전`,
    });
  }
  if (repoFacts && repoFacts.stargazerCount !== null) {
    metaRows.push({ key: "Stars", value: String(repoFacts.stargazerCount), tone: "amber" });
  }

  return normalizeMorningBriefingDrilldown("github", {
    title: "GitHub · 빌드·배포 · 레포 신호",
    subtitle: [repoFacts?.nameWithOwner, repoFacts?.branch].filter(Boolean).join(" · "),
    syncPills: [
      `지난 24시간 커밋 ${commits} · PR 머지 ${mergedPrs}`,
      deploys.length
        ? mixedDeploys
          ? `배포 ${deploys.length}건 · ${deployBreakdown.join(" · ")}`
          : `배포 ${deploys.length}건 성공`
        : "이 기간 배포 없음",
      scan.length ? `레포 스캔 ${scan.length}개 영역` : "",
    ].filter(Boolean),
    kpis,
    kpisMeta: repoFacts?.branch ? `${repoFacts.branch} 브랜치 기준` : null,
    chart: {
      kind: "bars",
      title: "커밋, 지난 24시간",
      subtitle: deploys.length
        ? `배포 ${shortTime(deploys[0].at)} 포함 · 3시간 버킷`
        : "3시간 버킷",
      bars: buildCommitBuckets({ commits: commitEvents.map((event) => ({ ts: Date.parse(event.at) })), deploys, window }),
      legend: [
        { label: "커밋", tone: "accent" },
        ...(deploys.length ? [{ label: "배포 시점", tone: "violet" }] : []),
      ],
      footnote: deploys.length ? deployFootnote(deploys[0]) : null,
    },
    listRows: prRows,
    listMeta: ghReady ? `머지 ${mergedPrs} · 오픈 ${openPrs} · 배포 ${deploys.length}` : null,
    scan,
    drafts: [],
    draftsEmpty: {
      title: "코드에서 꺼낼 다음 일이 없어요",
      detail: "gh CLI와 git 로그 기준, 액션으로 만들 변화가 확인되지 않았어요. 머지 정체나 배포 실패 같은 신호가 잡히면 초안이 여기 먼저 떠요. 대신 커밋·PR 밖 영역을 훑어서 위임할 수 있는 신호와 미뤄둔 정리를 아래에 모아뒀어요.",
      evidence: "근거: gh CLI · git log",
    },
    maintenance,
    meta: {
      progress: {
        label: "main 배포",
        valueLabel: deploys.length ? `${deploys.length} · 성공` : "이 기간 없음",
        sub: deploys.length ? "롤백 0" : null,
        ratio: deploys.length ? 1 : 0,
      },
      rows: metaRows,
    },
  });
}

// ── External (Cloudflare/PostHog) drilldown via provider digest ──────────────

const EXTERNAL_DRILLDOWN_SHAPE = {
  cloudflare: {
    kpis: [
      { label: "순 방문", value: 0, deltaLabel: "▲ 0%", direction: "up", vs: "어제 0", flag: false },
    ],
    chart: {
      kind: "bars",
      title: "사람 방문, 지난 24시간",
      subtitle: "short subtitle",
      bars: [{ label: "00", value: 0, tone: "amber", tip: "00–02 · 0" }],
      legend: [{ label: "사람 방문", tone: "amber" }],
      footnote: "bot exclusion note",
    },
    table: [{ path: "/landing", label: "랜딩", value: 0, share: 0 }],
    signals: [{ time: "02:10", text: "aggregate bot/referrer note" }],
    actions: [
      {
        kind: "task",
        badge: "태스크",
        title: "short action title",
        body: "multi-line action body",
        why: "why today",
        applyLabel: "태스크 추가",
      },
    ],
  },
  posthog: {
    kpis: [
      { label: "Day-2 리텐션", valueLabel: "0%", deltaLabel: "▼ 0p", direction: "down", vs: "어제 0%", flag: true },
    ],
    chart: {
      kind: "curve",
      title: "Day-2 리텐션",
      subtitle: "short subtitle",
      points: [{ label: "06-05 · 39%", pct: 39 }],
      baselinePct: 40,
      legend: [{ label: "Day-2 리텐션", tone: "rose" }],
      footnote: "sample-size caveat",
    },
    funnel: {
      steps: [{ label: "랜딩 방문", value: 0, valueLabel: "0", drop: false }],
      gapAfterIndex: 1,
      gapLabel: "biggest leak description",
    },
    signals: [{ time: "이탈 지점", text: "aggregate funnel note" }],
    webSignals: [{ time: "유입 엔진", text: "aggregate web/pageview note (path-level)" }],
    webMeta: "최근 2주 · 경로 분해",
    actions: [
      {
        kind: "message",
        badge: "메시지",
        title: "short action title",
        body: "multi-line draft",
        why: "why today",
        applyLabel: "큐에 추가",
      },
    ],
  },
};

export function buildMorningBriefingExternalDigestPrompt({ sources = [], window, context = "" } = {}) {
  const base = buildExternalOfficeHoursDigestPrompt({ sources, window, context });
  const wanted = sources.filter((source) => ["posthog", "cloudflare"].includes(source));
  const shape = {};
  for (const id of wanted) shape[id] = EXTERNAL_DRILLDOWN_SHAPE[id];
  if (!Object.keys(shape).length) return base;
  return [
    base,
    "",
    "Additionally include a top-level \"drilldowns\" object with per-source structured aggregates for the morning-briefing drilldown screens.",
    "Same privacy rules apply: aggregates and short Korean summaries only — never raw event rows, IDs, IPs, emails, tokens.",
    "Only include numbers you actually computed from the source. Omit any field (or the whole source) you cannot back with data.",
    "All visible labels/titles/notes must be Korean, concise, and factual.",
    "",
    "\"drilldowns\" shape (values are placeholders):",
    JSON.stringify({ drilldowns: shape }, null, 2),
  ].join("\n");
}

function extractJsonObjectLoose(text = "") {
  const trimmed = String(text || "").trim();
  if (!trimmed) return null;
  try {
    return JSON.parse(trimmed);
  } catch {
    const match = trimmed.match(/\{[\s\S]*\}/);
    if (!match) return null;
    try {
      return JSON.parse(match[0]);
    } catch {
      return null;
    }
  }
}

const EXTERNAL_TITLES = {
  cloudflare: { title: "Cloudflare · 트래픽 드릴다운", subtitle: "사람 방문 기준 · 봇 제외" },
  posthog: { title: "PostHog · 리텐션·이탈 드릴다운", subtitle: "표본 작음 · 단정보다 방향" },
};

export function normalizeMorningBriefingExternalDigest(textOrObject = "", expectedSources = []) {
  const payload = typeof textOrObject === "object" && textOrObject !== null
    ? textOrObject
    : extractJsonObjectLoose(textOrObject);
  const sources = normalizeExternalOfficeHoursDigest(payload ?? "", expectedSources);
  const drilldowns = {};
  const readyIds = new Set(sources.filter((source) => source.state === "ready").map((source) => source.id));
  for (const id of ["cloudflare", "posthog"]) {
    if (!readyIds.has(id)) continue;
    const raw = payload?.drilldowns?.[id];
    if (!raw || typeof raw !== "object") continue;
    const normalized = normalizeMorningBriefingDrilldown(id, {
      ...raw,
      title: cleanString(raw.title, 80) || EXTERNAL_TITLES[id].title,
      subtitle: cleanString(raw.subtitle, 160) || EXTERNAL_TITLES[id].subtitle,
      drafts: raw.actions ?? raw.drafts,
    });
    if (normalized) drilldowns[id] = normalized;
  }
  return { sources, drilldowns };
}

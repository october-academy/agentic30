import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";

import { atomicWriteJson } from "./atomic-store.mjs";
import { resolveCloudflareMcpSettings } from "./cloudflare-mcp-config.mjs";
import { isMcpOauthServerReady, readMcpOauthState } from "./mcp-oauth-state.mjs";
import { resolvePostHogMcpSettings } from "./posthog-mcp-config.mjs";

export const OFFICE_HOURS_DAILY_DIGEST_SCHEMA_VERSION = 1;
export const OFFICE_HOURS_SOURCE_GATE_SCHEMA_VERSION = 1;
export const OFFICE_HOURS_DAILY_DIGEST_FILE = "office-hours-daily-digest.json";
export const OFFICE_HOURS_DIGEST_EXEC_TIMEOUT_MS = 12_000;

const DAY_MS = 86_400_000;
const SOURCE_DEFS = Object.freeze({
  git: { id: "git", label: "git" },
  gh_cli: { id: "gh_cli", label: "gh CLI" },
  posthog: { id: "posthog", label: "PostHog" },
  cloudflare: { id: "cloudflare", label: "Cloudflare" },
});
const OFFICE_HOURS_SOURCE_ORDER = Object.freeze(["git", "gh_cli", "posthog", "cloudflare"]);
const EXTERNAL_SOURCE_IDS = new Set(["posthog", "cloudflare"]);
const EXTERNAL_FAILURE_DETAILS = Object.freeze({
  posthog: "PostHog 사용량 집계를 완료하지 못했어요 — MCP 연결은 정상이에요.",
  cloudflare: "Cloudflare Analytics 집계를 완료하지 못했어요 — MCP 연결은 정상이에요.",
});
const EXTERNAL_SOURCE_DIGEST_SHAPES = Object.freeze({
  posthog: {
    id: "posthog",
    state: "ready",
    summary: "aggregate product usage summary only",
    counts: { events: 0, activeUsers: 0, conversions: 0, signups: 0 },
    highlights: ["short PostHog aggregate highlight"],
    goalSignals: ["product usage signal useful for the 30-day goal"],
    evidenceGaps: ["missing product evidence gap"],
  },
  cloudflare: {
    id: "cloudflare",
    state: "ready",
    summary: "aggregate traffic summary only",
    counts: { visits: 0, uniqueVisitors: 0, pageviews: 0, requests: 0, threats: 0 },
    highlights: ["short Cloudflare aggregate highlight"],
    goalSignals: ["traffic signal useful for the 30-day goal"],
    evidenceGaps: ["missing traffic evidence gap"],
  },
});

export class OfficeHoursSourceGateError extends Error {
  constructor(gate) {
    super(gate?.message || "Office Hours source gate blocked.");
    this.name = "OfficeHoursSourceGateError";
    this.gate = gate;
  }
}

function cleanString(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function localDevFastDaysEnabled(env = process.env) {
  return String(env?.AGENTIC30_LOCAL_DEV_FAST_DAYS || "").trim() === "1";
}

function unique(values = []) {
  return [...new Set(values.filter(Boolean))];
}

function defaultExec(cmd, args, { cwd, timeoutMs = OFFICE_HOURS_DIGEST_EXEC_TIMEOUT_MS } = {}) {
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

function sourceValue(value = "") {
  if (typeof value === "string") return value;
  if (value && typeof value === "object") return value.id ?? value.source ?? value.name ?? "";
  return "";
}

export function normalizeOfficeHoursSourceId(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  if (["github", "gh", "github_cli", "gh-cli", "github-cli"].includes(raw)) return "gh_cli";
  if (["git", "local_git", "local-git"].includes(raw)) return "git";
  if (["posthog", "post_hog"].includes(raw)) return "posthog";
  if (["cloudflare", "cloudflare-api", "cloudflare_api"].includes(raw)) return "cloudflare";
  return "";
}

export function normalizeOfficeHoursSelectedSources(input = []) {
  const values = Array.isArray(input) ? input : [input];
  return unique(values.map((item) => normalizeOfficeHoursSourceId(sourceValue(item))))
    .filter((source) => OFFICE_HOURS_SOURCE_ORDER.includes(source))
    .sort((a, b) => OFFICE_HOURS_SOURCE_ORDER.indexOf(a) - OFFICE_HOURS_SOURCE_ORDER.indexOf(b));
}

function toLocalMs(utcMs, tzOffsetMinutes) {
  return utcMs - tzOffsetMinutes * 60_000;
}

function localDayKey(utcMs, tzOffsetMinutes) {
  if (!Number.isFinite(utcMs)) return "";
  return new Date(toLocalMs(utcMs, tzOffsetMinutes)).toISOString().slice(0, 10);
}

export function officeHoursDigestWindow(now = new Date(), { tzOffsetMinutes = now.getTimezoneOffset?.() ?? 0 } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || Date.now();
  const local = new Date(toLocalMs(nowMs, tzOffsetMinutes));
  const localTodayMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const startLocal = localTodayMidnight - DAY_MS;
  const startMs = startLocal + tzOffsetMinutes * 60_000;
  return {
    startMs,
    untilMs: nowMs,
    startIso: new Date(startMs).toISOString(),
    untilIso: new Date(nowMs).toISOString(),
    localStartDate: new Date(startLocal).toISOString().slice(0, 10),
    localUntilDate: localDayKey(nowMs, tzOffsetMinutes),
    label: `${new Date(startLocal).toISOString().slice(0, 10)} 00:00 -> ${localDayKey(nowMs, tzOffsetMinutes)} now`,
  };
}

function sourceStatus({
  id,
  state = "missing",
  detail = "",
  selected = false,
  required = false,
  checkedAt = new Date().toISOString(),
  counts = {},
  highlights = [],
  summary = "",
  goalSignals = [],
  evidenceGaps = [],
  events = [],
} = {}) {
  const def = SOURCE_DEFS[id] || { id, label: id };
  return {
    id: def.id,
    label: def.label,
    state,
    available: state === "ready",
    selected: Boolean(selected),
    required: Boolean(required),
    detail: cleanString(detail, 300),
    checkedAt,
    counts,
    highlights: normalizeStringList(highlights, 6, 180),
    summary: cleanString(summary, 320),
    // Evidence-derived diagnosis from external MCP sources (PostHog/Cloudflare):
    // goalSignals = what moves the 30-day goal, evidenceGaps = what proof is still
    // missing. Local sources leave these empty. Carried all the way into the
    // interview briefing so the questions act on evidence, not just commit counts.
    goalSignals: normalizeStringList(goalSignals, 6, 200),
    evidenceGaps: normalizeStringList(evidenceGaps, 6, 200),
    // Timestamped overnight events (git commits, PR/release updates) so downstream
    // consumers (morning briefing timeline) can render when things happened, not
    // just that they happened. Empty for sources without per-event timestamps.
    events: normalizeEventList(events),
  };
}

function normalizeEventList(values = [], limit = 8) {
  return (Array.isArray(values) ? values : [])
    .map((event) => {
      const at = cleanString(event?.at, 40);
      const text = cleanString(event?.text, 200);
      if (!text || !Number.isFinite(Date.parse(at))) return null;
      return { at, text };
    })
    .filter(Boolean)
    .sort((a, b) => Date.parse(a.at) - Date.parse(b.at))
    .slice(0, limit);
}

function normalizeStringList(values = [], limit = 6, max = 200) {
  return (Array.isArray(values) ? values : [])
    .map((value) => cleanString(value, max))
    .filter(Boolean)
    .slice(0, limit);
}

export async function probeGitSource({ workspaceRoot, execImpl = defaultExec } = {}) {
  const cwd = path.resolve(String(workspaceRoot || "."));
  const result = await execImpl("git", ["rev-parse", "--is-inside-work-tree"], { cwd });
  return {
    available: result.ok && result.stdout.trim() === "true",
    detail: result.ok ? "workspace is a git repository" : "workspace is not a readable git repository",
  };
}

export async function probeGhCliSource({ workspaceRoot, execImpl = defaultExec } = {}) {
  const cwd = path.resolve(String(workspaceRoot || "."));
  const result = await execImpl("gh", ["auth", "status"], { cwd });
  return {
    available: Boolean(result.ok),
    detail: result.ok ? "gh CLI is authenticated" : "gh CLI is missing or not authenticated for this repo",
  };
}

function externalSourceStatus(id, { selected = false, required = false, appSupportPath = "", env = process.env, provider = "" } = {}) {
  const unsupportedProvider = provider && !["claude", "codex"].includes(String(provider || "").toLowerCase());
  // OAuth-first MCP: 토큰은 프로바이더 캐시에 있어 사이드카가 볼 수 없다.
  // "MCP 연결" 버튼이 실증·영속한 OAuth ready 상태가 저장된 API 키와 동급의
  // 연결 증거다 — 둘 중 하나면 ready. 단 토큰 캐시는 프로바이더별이므로 OAuth
  // ready는 이 digest를 실행할 프로바이더 기준으로만 인정한다(provider 전달).
  const oauthState = readMcpOauthState(appSupportPath);
  if (id === "posthog") {
    const settings = resolvePostHogMcpSettings({ appSupportPath, env });
    const oauthReady = isMcpOauthServerReady(oauthState, "posthog", provider);
    const oauthReadyElsewhere = !oauthReady && isMcpOauthServerReady(oauthState, "posthog");
    const ready = (settings.tokenValid || oauthReady) && !unsupportedProvider;
    return sourceStatus({
      id,
      state: ready ? "ready" : "missing",
      selected,
      required,
      detail: unsupportedProvider
        ? "PostHog digest requires Claude or Codex provider MCP support"
        : settings.tokenValid
          ? "PostHog MCP key is configured"
          : oauthReady
            ? "PostHog MCP OAuth connection verified"
            : oauthReadyElsewhere
              ? `PostHog MCP OAuth is verified for another provider — reconnect via Settings for ${provider}`
              : "PostHog MCP is not connected — connect via OAuth in Settings or store an API key",
    });
  }
  if (id === "cloudflare") {
    const settings = resolveCloudflareMcpSettings({ appSupportPath, env });
    const oauthReady = isMcpOauthServerReady(oauthState, "cloudflare", provider);
    const oauthReadyElsewhere = !oauthReady && isMcpOauthServerReady(oauthState, "cloudflare");
    const ready = (settings.tokenValid || oauthReady) && !unsupportedProvider;
    return sourceStatus({
      id,
      state: ready ? "ready" : "missing",
      selected,
      required,
      detail: unsupportedProvider
        ? "Cloudflare digest requires Claude or Codex provider MCP support"
        : settings.tokenValid
          ? "Cloudflare MCP token is configured"
          : oauthReady
            ? "Cloudflare MCP OAuth connection verified"
            : oauthReadyElsewhere
              ? `Cloudflare MCP OAuth is verified for another provider — reconnect via Settings for ${provider}`
              : "Cloudflare MCP is not connected — connect via OAuth in Settings or store an API token",
    });
  }
  return sourceStatus({ id, selected, required, detail: "unknown external source" });
}

function connectActionsFor({ missingRequiredSources = [], noLiveSources = false } = {}) {
  const targets = noLiveSources
    ? OFFICE_HOURS_SOURCE_ORDER
    : missingRequiredSources;
  return unique(targets).map((source) => {
    switch (source) {
    case "git":
      return {
        id: "connect_git",
        source,
        label: "git repo 열기",
        detail: "workspace를 git repository로 열거나 git init 후 다시 확인합니다.",
        settingsSection: "workspace",
      };
    case "gh_cli":
      return {
        id: "connect_gh_cli",
        source,
        label: "GitHub CLI 연결",
        detail: "Settings > Integrations에서 gh CLI 인증 상태를 확인합니다.",
        settingsSection: "integrations",
      };
    case "posthog":
      return {
        id: "connect_posthog",
        source,
        label: "PostHog MCP 연결",
        detail: "Settings > Integrations에 phx_/pha_ PostHog MCP API key를 저장합니다.",
        settingsSection: "integrations",
      };
    case "cloudflare":
      return {
        id: "connect_cloudflare",
        source,
        label: "Cloudflare 연결",
        detail: "Settings > Integrations에 Cloudflare API token을 저장합니다.",
        settingsSection: "integrations",
      };
    default:
      return null;
    }
  }).filter(Boolean);
}

export async function evaluateOfficeHoursSourceGate({
  workspaceRoot,
  day = null,
  selectedSources = [],
  provider = "",
  now = new Date(),
  tzOffsetMinutes = now.getTimezoneOffset?.() ?? 0,
  execImpl = defaultExec,
  appSupportPath = "",
  env = process.env,
  allowLocalDevFastDays = true,
} = {}) {
  const normalizedDay = Number.parseInt(String(day ?? ""), 10);
  const selected = normalizeOfficeHoursSelectedSources(selectedSources);
  const checkedAt = new Date(now instanceof Date ? now.getTime() : now).toISOString();
  const window = officeHoursDigestWindow(now, { tzOffsetMinutes });

  if (Number.isFinite(normalizedDay) && normalizedDay <= 1) {
    return {
      schemaVersion: OFFICE_HOURS_SOURCE_GATE_SCHEMA_VERSION,
      day: normalizedDay,
      ok: true,
      blocking: false,
      skipped: true,
      reason: "day1_fixed_interview",
      message: "Day 1 Office Hours uses the fixed interview and does not require external sources.",
      checkedAt,
      window,
      selectedSources: selected,
      sources: [],
      missingRequiredSources: [],
      connectActions: [],
    };
  }

  if (
    allowLocalDevFastDays
    && Number.isFinite(normalizedDay)
    && normalizedDay >= 2
    && localDevFastDaysEnabled(env)
  ) {
    return {
      schemaVersion: OFFICE_HOURS_SOURCE_GATE_SCHEMA_VERSION,
      day: normalizedDay,
      ok: true,
      blocking: false,
      skipped: true,
      reason: "local_dev_fast_days",
      message: "Local development fast-days mode skips Day 2+ Office Hours source requirements.",
      checkedAt,
      window,
      selectedSources: [],
      sources: [],
      missingRequiredSources: [],
      connectActions: [],
    };
  }

  const [gitProbe, ghProbe] = await Promise.all([
    probeGitSource({ workspaceRoot, execImpl }),
    probeGhCliSource({ workspaceRoot, execImpl }),
  ]);
  const statuses = [
    sourceStatus({
      id: "git",
      state: gitProbe.available ? "ready" : "missing",
      selected: selected.includes("git"),
      required: selected.includes("git"),
      checkedAt,
      detail: gitProbe.detail,
    }),
    sourceStatus({
      id: "gh_cli",
      state: ghProbe.available ? "ready" : "missing",
      selected: selected.includes("gh_cli"),
      required: selected.includes("gh_cli"),
      checkedAt,
      detail: ghProbe.detail,
    }),
    selected.includes("posthog")
      ? externalSourceStatus("posthog", {
          selected: true,
          required: true,
          appSupportPath,
          env,
          provider,
        })
      : sourceStatus({
          id: "posthog",
          state: "ignored",
          selected: false,
          required: false,
          checkedAt,
          detail: "PostHog was not selected for this Office Hours run",
        }),
    selected.includes("cloudflare")
      ? externalSourceStatus("cloudflare", {
          selected: true,
          required: true,
          appSupportPath,
          env,
          provider,
        })
      : sourceStatus({
          id: "cloudflare",
          state: "ignored",
          selected: false,
          required: false,
          checkedAt,
          detail: "Cloudflare was not selected for this Office Hours run",
        }),
  ];

  const missingRequiredSources = statuses
    .filter((status) => status.required && status.state !== "ready")
    .map((status) => status.id);
  const readyCount = statuses.filter((status) => status.state === "ready").length;
  const noLiveSources = readyCount === 0;
  const blocking = noLiveSources || missingRequiredSources.length > 0;
  const reason = noLiveSources
    ? "no_live_sources"
    : missingRequiredSources.length
      ? "selected_sources_failed"
      : "ready";
  const message = noLiveSources
    ? "Day 2+ Office Hours를 시작하려면 git, gh CLI, PostHog, Cloudflare 중 하나 이상을 연결해야 합니다."
    : missingRequiredSources.length
      ? `선택된 source가 아직 준비되지 않았습니다: ${missingRequiredSources.join(", ")}.`
      : "Day 2+ Office Hours source gate is ready.";

  return {
    schemaVersion: OFFICE_HOURS_SOURCE_GATE_SCHEMA_VERSION,
    day: Number.isFinite(normalizedDay) ? normalizedDay : null,
    ok: !blocking,
    blocking,
    skipped: false,
    reason,
    message,
    checkedAt,
    window,
    selectedSources: selected,
    sources: statuses,
    missingRequiredSources,
    connectActions: connectActionsFor({ missingRequiredSources, noLiveSources }),
  };
}

const GIT_RECORD_SEP = "\u001e";
const GIT_FIELD_SEP = "\u001f";

function parseGitDigestLog(raw = "") {
  const commits = [];
  for (const record of String(raw || "").split(GIT_RECORD_SEP)) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const head = lines[0].split(GIT_FIELD_SEP);
    if (head.length < 3) continue;
    const [authorIso, authorEmail, subject] = head;
    const ts = Date.parse(authorIso);
    const files = [];
    let additions = 0;
    let deletions = 0;
    for (const line of lines.slice(1)) {
      const cells = line.trim().split(/\t/);
      if (cells.length < 3) continue;
      const added = Number.parseInt(cells[0], 10);
      const deleted = Number.parseInt(cells[1], 10);
      if (Number.isFinite(added)) additions += added;
      if (Number.isFinite(deleted)) deletions += deleted;
      const filePath = cells.slice(2).join("\t").trim();
      if (filePath) files.push(filePath);
    }
    commits.push({
      ts: Number.isFinite(ts) ? ts : null,
      authorEmail: String(authorEmail || "").trim().toLowerCase(),
      subject: cleanString(subject, 120),
      files,
      additions,
      deletions,
    });
  }
  return commits.filter((commit) => Number.isFinite(commit.ts));
}

function topPathBuckets(commits = []) {
  const counts = new Map();
  for (const commit of commits) {
    for (const file of commit.files || []) {
      const key = String(file || "").replace(/^\.\//, "").split("/").filter(Boolean)[0] || "workspace";
      counts.set(key, (counts.get(key) || 0) + 1);
    }
  }
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, 5)
    .map(([key, count]) => ({ path: key, count }));
}

export async function collectGitDailySignals({
  workspaceRoot,
  window,
  execImpl = defaultExec,
} = {}) {
  const cwd = path.resolve(String(workspaceRoot || "."));
  const probe = await probeGitSource({ workspaceRoot: cwd, execImpl });
  if (!probe.available) {
    return sourceStatus({ id: "git", state: "missing", detail: probe.detail });
  }
  const [log, email, status] = await Promise.all([
    execImpl(
      "git",
      [
        "log",
        "--all",
        "--no-merges",
        `--since=${window.startIso}`,
        `--until=${window.untilIso}`,
        "--date=iso-strict",
        "--pretty=format:%x1e%aI%x1f%ae%x1f%s",
        "--numstat",
      ],
      { cwd },
    ),
    execImpl("git", ["config", "user.email"], { cwd }),
    execImpl("git", ["status", "--short"], { cwd }),
  ]);
  const commits = log.ok ? parseGitDigestLog(log.stdout) : [];
  const userEmail = email.ok ? email.stdout.trim().toLowerCase() : "";
  const mine = userEmail ? commits.filter((commit) => commit.authorEmail === userEmail).length : 0;
  const fileSet = new Set(commits.flatMap((commit) => commit.files || []));
  const topPaths = topPathBuckets(commits);
  const uncommittedChanges = status.ok
    ? status.stdout.split(/\r?\n/).filter((line) => line.trim()).length
    : 0;
  const additions = commits.reduce((sum, commit) => sum + Number(commit.additions || 0), 0);
  const deletions = commits.reduce((sum, commit) => sum + Number(commit.deletions || 0), 0);
  const highlights = [];
  if (commits.length) highlights.push(`git 커밋 ${commits.length}건${mine ? ` · 내 커밋 ${mine}건` : ""}`);
  if (topPaths.length) highlights.push(`주요 변경 영역: ${topPaths.map((item) => item.path).join(", ")}`);
  if (uncommittedChanges) highlights.push(`미커밋 변경 ${uncommittedChanges}개`);
  if (!highlights.length) highlights.push("git repository는 연결됐지만 해당 기간 커밋은 없습니다.");
  return sourceStatus({
    id: "git",
    state: "ready",
    detail: "git log/status live query succeeded",
    counts: {
      commits: commits.length,
      myCommits: mine,
      filesChanged: fileSet.size,
      additions,
      deletions,
      uncommittedChanges,
    },
    highlights,
    summary: highlights.join(" / "),
    events: commits
      .slice()
      .sort((a, b) => b.ts - a.ts)
      .slice(0, 8)
      .map((commit) => ({
        at: new Date(commit.ts).toISOString(),
        text: `커밋 · ${commit.subject}`,
      })),
  });
}

function parseJsonArray(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

export async function collectGhDailySignals({
  workspaceRoot,
  window,
  execImpl = defaultExec,
} = {}) {
  const cwd = path.resolve(String(workspaceRoot || "."));
  const auth = await execImpl("gh", ["auth", "status"], { cwd });
  if (!auth.ok) {
    return sourceStatus({ id: "gh_cli", state: "missing", detail: "gh CLI auth status failed" });
  }
  const inWindow = (iso) => {
    const ts = Date.parse(iso || "");
    return Number.isFinite(ts) && ts >= window.startMs && ts < window.untilMs;
  };
  const [prResult, issueResult, releaseResult] = await Promise.all([
    execImpl(
      "gh",
      ["pr", "list", "--state", "all", "--limit", "50", "--json", "number,title,state,createdAt,updatedAt,author,isDraft"],
      { cwd },
    ),
    execImpl(
      "gh",
      ["issue", "list", "--state", "all", "--limit", "50", "--json", "number,title,state,createdAt,updatedAt,author"],
      { cwd },
    ),
    execImpl(
      "gh",
      ["release", "list", "--limit", "20", "--json", "tagName,name,publishedAt"],
      { cwd },
    ),
  ]);
  const prs = parseJsonArray(prResult.ok ? prResult.stdout : "")
    .filter((pr) => inWindow(pr.updatedAt || pr.createdAt));
  const issues = parseJsonArray(issueResult.ok ? issueResult.stdout : "")
    .filter((issue) => inWindow(issue.updatedAt || issue.createdAt));
  const releases = parseJsonArray(releaseResult.ok ? releaseResult.stdout : "")
    .filter((release) => inWindow(release.publishedAt));
  const openPrs = prs.filter((pr) => String(pr.state || "").toUpperCase() === "OPEN").length;
  const mergedPrs = prs.filter((pr) => String(pr.state || "").toUpperCase() === "MERGED").length;
  const highlights = [];
  if (prs.length) highlights.push(`PR 업데이트 ${prs.length}건${openPrs ? ` · open ${openPrs}건` : ""}${mergedPrs ? ` · merged ${mergedPrs}건` : ""}`);
  if (issues.length) highlights.push(`이슈 업데이트 ${issues.length}건`);
  if (releases.length) highlights.push(`릴리즈 ${releases.length}건`);
  if (!highlights.length) highlights.push("gh CLI는 연결됐지만 해당 기간 PR/이슈/릴리즈 변화는 없습니다.");
  const events = [
    ...prs.map((pr) => ({
      at: pr.updatedAt || pr.createdAt,
      text: `PR #${pr.number} ${String(pr.state || "").toLowerCase()} · ${cleanString(pr.title, 80)}`,
    })),
    ...releases.map((release) => ({
      at: release.publishedAt,
      text: `릴리즈 ${cleanString(release.tagName || release.name, 60)} 배포`,
    })),
  ];
  return sourceStatus({
    id: "gh_cli",
    state: "ready",
    detail: "gh CLI live query succeeded",
    counts: {
      prs: prs.length,
      openPrs,
      mergedPrs,
      issues: issues.length,
      releases: releases.length,
    },
    highlights,
    summary: highlights.join(" / "),
    events,
  });
}

function sourceById(sources = []) {
  return new Map((Array.isArray(sources) ? sources : []).map((source) => [source.id, source]));
}

export async function collectLocalDailyOfficeHoursSignals({
  workspaceRoot,
  gate,
  execImpl = defaultExec,
} = {}) {
  const window = gate?.window || officeHoursDigestWindow();
  const selected = new Set(gate?.selectedSources || []);
  const statusMap = sourceById(gate?.sources || []);
  const [git, gh] = await Promise.all([
    statusMap.get("git")?.state === "ready"
      ? collectGitDailySignals({ workspaceRoot, window, execImpl })
      : Promise.resolve(statusMap.get("git") || sourceStatus({ id: "git" })),
    statusMap.get("gh_cli")?.state === "ready"
      ? collectGhDailySignals({ workspaceRoot, window, execImpl })
      : Promise.resolve(statusMap.get("gh_cli") || sourceStatus({ id: "gh_cli" })),
  ]);
  return [git, gh].map((source) => ({
    ...source,
    selected: selected.has(source.id),
    required: selected.has(source.id),
  }));
}

export function selectedExternalOfficeHoursSources(gate = {}) {
  const selected = new Set(gate.selectedSources || []);
  return (gate.sources || [])
    .filter((source) => EXTERNAL_SOURCE_IDS.has(source.id) && selected.has(source.id) && source.state === "ready")
    .map((source) => source.id);
}

export function buildExternalOfficeHoursDigestPrompt({
  sources = [],
  window,
  context = "",
} = {}) {
  const wanted = normalizeOfficeHoursSelectedSources(sources).filter((source) => EXTERNAL_SOURCE_IDS.has(source));
  const sourceShapes = wanted.map((source) => EXTERNAL_SOURCE_DIGEST_SHAPES[source]).filter(Boolean);
  return [
    "You are generating an Agentic30 Day 2+ Office Hours source digest.",
    "Use only the connected external MCP sources named below. Do not mutate anything.",
    // 실측 가이드: MCP 도구는 deferred로 도착할 수 있고, 각 서버의 읽기 경로가
    // 정해져 있다(PostHog=execute-sql SELECT HogQL, Cloudflare=execute GET/GraphQL).
    // 명시하지 않으면 모델이 차단되는 호출을 반복하다 시간을 소진한다.
    "Tool access: MCP tools may be deferred — load them with ToolSearch first, then call them.",
    "PostHog: read with execute-sql using SELECT/WITH HogQL only, or insight/web-analytics getter tools. Mutating calls are denied.",
    "PostHog strict product filter: every counts object must restrict app/product aggregates to telemetry_source IN ('mac_app','mac_sidecar'), telemetry_environment = 'production', build_configuration = 'release', is_internal_traffic != true, and person.properties.is_internal_tester != true.",
    "PostHog activeUsers definition: count distinct people only when the filtered event is one of workspace_setup_completed, mac_session_created, mac_sidecar_session_created, or mac_sidecar_office_hours_completed.",
    "PostHog events definition: count filtered production app/sidecar events, not all PostHog events. conversions and signups may be reported only when matching filtered production/non-internal events exist.",
    "PostHog web rule: $pageview, blog, link, and marketing-site events may appear only in drilldown webSignals/path summaries; they must never contribute to card activeUsers.",
    "Cloudflare: read with cloudflare-api execute/search only. Mutating calls are denied.",
    "Cloudflare collection plan: first execute code that calls cloudflare.request({ method: \"GET\", path: \"/zones?status=active&per_page=5\" }) and choose the first active zone. Then execute one POST /graphql query for that zone with both no-dimension totals and hourly httpRequests1hGroups over the requested window. Optional third call: httpRequestsAdaptiveGroups for top paths on the same zone. Do not query all zones in one GraphQL call.",
    "Cloudflare GraphQL request shape: cloudflare.request({ method: \"POST\", path: \"/graphql\", body: { query, variables } }).",
    "Cloudflare GraphQL query shape: query($zone: String!, $start: Time!, $end: Time!) { viewer { zones(filter: { zoneTag: $zone }) { totals: httpRequests1hGroups(limit: 1, filter: { datetime_geq: $start, datetime_lt: $end }) { sum { requests pageViews threats } uniq { uniques } } hourly: httpRequests1hGroups(limit: 96, filter: { datetime_geq: $start, datetime_lt: $end }, orderBy: [datetime_ASC]) { dimensions { datetime } sum { requests pageViews threats } uniq { uniques } } } } }.",
    "Cloudflare unique visitors: use totals[0].uniq.uniques for visits and uniqueVisitors. Never sum hourly uniq.uniques and never use the max hourly uniq as the period total.",
    "Cloudflare hourly groups: do not request sum.visits or any requestSource filter on httpRequests1hGroups. If you need a path table, use requestSource: \"eyeball\" only inside httpRequestsAdaptiveGroups.",
    "Use source-specific count keys. PostHog counts must use events/activeUsers/conversions/signups. Cloudflare counts must use visits/uniqueVisitors/pageviews/requests/threats. Do not put PostHog count keys on Cloudflare or Cloudflare count keys on PostHog.",
    // 실측(2026-06-11): 호출 상한이 없으면 모델이 존×일자 분할 쿼리로 14회까지
    // 왕복하며 타임아웃 직전(175초)까지 간다. 상한 4회로 묶으면 50~90초.
    "Budget: hard limit — at most 4 MCP tool calls per source (ToolSearch excluded). Plan queries to fit that, then emit the JSON immediately. If a source keeps failing, mark it failed and move on.",
    "Return JSON only. Do not wrap it in markdown.",
    "Never include raw event rows, request logs, query result arrays, IDs, tokens, emails, IP addresses, or secret values. Aggregates and short summaries only.",
    `Window: ${window?.startIso || ""} to ${window?.untilIso || ""}`,
    `Sources: ${wanted.join(", ") || "none"}`,
    "",
    "Required JSON shape:",
    JSON.stringify({
      sources: sourceShapes,
    }, null, 2),
    "",
    "Goal context:",
    cleanString(context, 4000),
  ].join("\n");
}

function extractJsonObject(text = "") {
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

function normalizeCounts(value = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};
  const output = {};
  for (const [key, raw] of Object.entries(value)) {
    const number = Number(raw);
    if (Number.isFinite(number)) output[cleanString(key, 40)] = Math.max(0, Math.round(number));
  }
  return output;
}

function externalDigestFailureDetail(source = "", { summary = "", failureDetail = "" } = {}) {
  return cleanString(summary, 300)
    || cleanString(failureDetail, 300)
    || EXTERNAL_FAILURE_DETAILS[source]
    || "외부 MCP 집계를 완료하지 못했어요 — 연결은 정상이에요.";
}

export function normalizeExternalOfficeHoursDigest(textOrObject = "", expectedSources = [], { failureDetail = "" } = {}) {
  // failureDetail: 호출자가 아는 구체적 실패 사유(프로바이더 한도/시간 초과 등).
  // 없으면 소스별 사용자용 기본 문구를 쓴다. 내부 디버그 문구는 앱 payload에
  // 노출하지 않는다.
  const fallbackDetail = cleanString(failureDetail, 300);
  const payload = typeof textOrObject === "object" && textOrObject !== null
    ? textOrObject
    : extractJsonObject(textOrObject);
  const parsedSources = Array.isArray(payload?.sources) ? payload.sources : [];
  const byId = sourceById(
    parsedSources
      .map((item) => {
        const id = normalizeOfficeHoursSourceId(item?.id);
        if (!EXTERNAL_SOURCE_IDS.has(id)) return null;
        const state = cleanString(item?.state, 20).toLowerCase() === "ready" ? "ready" : "failed";
        const summary = cleanString(item?.summary, 320);
        return sourceStatus({
          id,
          state,
          detail: state === "ready"
            ? "external MCP digest succeeded"
            : externalDigestFailureDetail(id, { summary, failureDetail: fallbackDetail }),
          counts: normalizeCounts(item?.counts),
          highlights: normalizeStringList(item?.highlights, 6, 180),
          summary,
          goalSignals: normalizeStringList(item?.goalSignals, 6, 200),
          evidenceGaps: normalizeStringList(item?.evidenceGaps, 6, 200),
        });
      })
      .filter(Boolean),
  );

  return normalizeOfficeHoursSelectedSources(expectedSources)
    .filter((source) => EXTERNAL_SOURCE_IDS.has(source))
    .map((source) => byId.get(source) || sourceStatus({
      id: source,
      state: "failed",
      detail: externalDigestFailureDetail(source, { failureDetail: fallbackDetail }),
    }));
}

function inferGoalLane(context = "") {
  const text = String(context || "");
  const match = text.match(/Goal lane:\s*([a-z_]+)/i);
  return match ? match[1].toLowerCase() : "";
}

function inferActiveUserDefinition(context = "") {
  const text = String(context || "");
  const match = text.match(/^Active user definition:\s*(.+)$/im);
  return cleanString(match?.[1] || "", 260);
}

function hasMissingActiveUserDefinition(context = "") {
  return /GET_USERS_ACTIVE_USER_DEFINITION_MISSING:\s*true/i.test(String(context || ""));
}

function goalHelpfulFallback(goalLane = "") {
  switch (goalLane) {
  case "make_money":
    return "오늘 질문은 결제, 유료 파일럿, 계약, 인보이스, 명시적 유료 제안 반응 중 하나로 좁혀야 합니다.";
  case "get_users":
    return "오늘 질문은 유입 숫자가 아니라 핵심 활성 행동을 끝낸 고유 사용자 증가로 좁혀야 합니다.";
  case "build_product":
    return "오늘 질문은 배포나 커밋 자체가 아니라 고객이 핵심 흐름을 끝까지 수행했는지로 좁혀야 합니다.";
  default:
    return "오늘 질문은 Day 1에서 고른 30일 목표를 진전시키는 가장 작은 외부 행동으로 좁혀야 합니다.";
  }
}

export function finalizeDailyOfficeHoursDigest({
  gate,
  localSignals = [],
  externalSignals = [],
  context = "",
  now = new Date(),
} = {}) {
  const signalMap = sourceById([...localSignals, ...externalSignals]);
  const gateStatusMap = sourceById(gate?.sources || []);
  const sources = OFFICE_HOURS_SOURCE_ORDER.map((id) => {
    const merged = signalMap.get(id) || gateStatusMap.get(id) || sourceStatus({ id });
    return {
      id: merged.id,
      label: merged.label,
      state: merged.state,
      available: merged.available,
      // The gate is the authority on selection: signal statuses (especially
      // normalized external digests) default selected/required to a concrete
      // false, which would un-require a selected source whose digest failed and
      // silently skip the failedRequired block below.
      selected: Boolean(gateStatusMap.get(id)?.selected ?? merged.selected),
      required: Boolean(gateStatusMap.get(id)?.required ?? merged.required),
      detail: merged.detail,
      checkedAt: merged.checkedAt,
      counts: merged.counts || {},
      highlights: normalizeStringList(merged.highlights, 6, 180),
      summary: cleanString(merged.summary, 320),
      goalSignals: normalizeStringList(merged.goalSignals, 6, 200),
      evidenceGaps: normalizeStringList(merged.evidenceGaps, 6, 200),
      events: normalizeEventList(merged.events),
    };
  });
  const failedRequired = sources.filter((source) => source.required && source.state !== "ready");
  if (failedRequired.length) {
    const updatedGate = {
      ...gate,
      ok: false,
      blocking: true,
      reason: "selected_sources_failed",
      message: `선택된 source digest가 실패했습니다: ${failedRequired.map((source) => source.id).join(", ")}.`,
      sources,
      missingRequiredSources: failedRequired.map((source) => source.id),
      connectActions: connectActionsFor({ missingRequiredSources: failedRequired.map((source) => source.id) }),
    };
    throw new OfficeHoursSourceGateError(updatedGate);
  }

  const readySources = sources.filter((source) => source.state === "ready");
  // Skip the label prefix when the highlight already starts with it — "git: git
  // 커밋 27건" stuttered in the briefing card.
  const allHighlights = readySources.flatMap((source) =>
    source.highlights.map((line) =>
      line.toLowerCase().startsWith(source.label.toLowerCase()) ? line : `${source.label}: ${line}`,
    ),
  );
  const goalLane = inferGoalLane(context);
  const activeUserDefinition = goalLane === "get_users" ? inferActiveUserDefinition(context) : "";
  const activeUserDefinitionMissing = goalLane === "get_users" && !activeUserDefinition && hasMissingActiveUserDefinition(context);
  const git = sources.find((source) => source.id === "git");
  // Customer evidence = real product-usage signals, which only PostHog supplies
  // (events / active users / conversions). gh CLI activity — PRs, issues, even a
  // shipped release — is builder output, not proof a customer did anything, so it
  // must never satisfy the "did anyone actually use it?" check.
  const customerEvidenceSources = sources.filter((source) =>
    source.id === "posthog"
      && source.state === "ready"
      && Object.values(source.counts || {}).some((count) => Number(count) > 0),
  );
  const buildWithoutCustomerEvidence = Number(git?.counts?.commits || 0) > 0 && customerEvidenceSources.length === 0;
  const biggestGap = buildWithoutCustomerEvidence
    ? "어제/간밤 신호가 코드 변경 중심입니다. 첫 질문은 만든 양이 아니라 고객 행동 증거 공백을 찔러야 합니다."
    : "오늘 질문은 아직 관찰되지 않은 결제, activation, 또는 end-to-end 사용 증거 하나를 요구해야 합니다.";
  const activeUserDefinitionGap = "활성 사용자 1명으로 세는 핵심 행동 기준이 아직 없습니다. acquisition 실행 전에 이 기준을 먼저 잠가야 합니다.";
  // Evidence-derived diagnosis (PostHog/Cloudflare) carried into the interview
  // briefing. Without this, the LLM-generated goalSignals/evidenceGaps were parsed
  // and then dropped, so the interview never acted on the live external evidence.
  const evidenceGoalSignals = readySources.flatMap((source) =>
    (source.goalSignals || []).map((line) => `${source.label}: ${line}`),
  );
  const evidenceGaps = readySources.flatMap((source) =>
    (source.evidenceGaps || []).map((line) => `${source.label}: ${line}`),
  );
  // Builder-output summaries (git commits, PRs, releases) restated the
  // overnightChanges lines nearly verbatim and doubled the briefing card. This
  // section carries customer-behavior signals only — the same standard
  // buildWithoutCustomerEvidence applies to the sources above.
  const customerSignalSummaries = readySources
    .filter((source) => EXTERNAL_SOURCE_IDS.has(source.id) && source.summary)
    .map((source) => `${source.label}: ${source.summary}`);
  return {
    schemaVersion: OFFICE_HOURS_DAILY_DIGEST_SCHEMA_VERSION,
    generatedAt: new Date(now instanceof Date ? now.getTime() : now).toISOString(),
    day: gate?.day ?? null,
    window: gate?.window || officeHoursDigestWindow(now),
    sourceGate: {
      ok: gate?.ok !== false,
      reason: gate?.reason || "ready",
      selectedSources: gate?.selectedSources || [],
    },
    sources,
    buildWithoutCustomerEvidence,
    briefing: {
      goalStatus: [
        "30일 목표는 Day 1에서 고른 goalType을 기준으로 유지합니다.",
        goalHelpfulFallback(goalLane),
        activeUserDefinition ? `활성 사용자 기준: ${activeUserDefinition}` : "",
        activeUserDefinitionMissing ? "활성 사용자 기준이 아직 잠기지 않았습니다." : "",
      ],
      overnightChanges: allHighlights.length ? allHighlights.slice(0, 8) : ["연결된 source에서 해당 기간 변화가 거의 없습니다."],
      goalHelpfulSignals: unique([
        ...evidenceGoalSignals,
        ...customerSignalSummaries,
      ]).slice(0, 6),
      biggestEvidenceGap: unique([
        activeUserDefinitionMissing ? activeUserDefinitionGap : "",
        biggestGap,
        ...evidenceGaps,
      ]).slice(0, 4),
    },
  };
}

export function formatDailyOfficeHoursDigestForPrompt(digest = {}) {
  const sourceLines = (digest.sources || []).map((source) =>
    `- ${source.label}: ${source.state}${source.summary ? ` · ${source.summary}` : ""}`,
  );
  const section = (title, lines = []) => [
    title,
    ...normalizeStringList(lines, 8, 260).map((line) => `- ${line}`),
  ].join("\n");
  return [
    "DAY2_PLUS_LIVE_DIGEST",
    `Digest window: ${digest.window?.startIso || ""} -> ${digest.window?.untilIso || ""}`,
    `Digest sources:\n${sourceLines.join("\n") || "- none"}`,
    section("30일 목표 상태", digest.briefing?.goalStatus),
    section("어제/간밤에 바뀐 것", digest.briefing?.overnightChanges),
    section("목표 달성에 도움 되는 신호", digest.briefing?.goalHelpfulSignals),
    section("오늘 막고 있는 가장 큰 증거 공백", digest.briefing?.biggestEvidenceGap),
    digest.buildWithoutCustomerEvidence
      ? "BUILD_WITHOUT_CUSTOMER_EVIDENCE: true"
      : "BUILD_WITHOUT_CUSTOMER_EVIDENCE: false",
  ].join("\n\n");
}

export function resolveDailyOfficeHoursDigestPath(workspaceRoot) {
  return path.join(path.resolve(String(workspaceRoot || ".")), ".agentic30", OFFICE_HOURS_DAILY_DIGEST_FILE);
}

export async function persistDailyOfficeHoursDigest({ workspaceRoot, digest, fsImpl = fs } = {}) {
  const filePath = resolveDailyOfficeHoursDigestPath(workspaceRoot);
  if (fsImpl !== fs) {
    await fsImpl.mkdir(path.dirname(filePath), { recursive: true });
    await fsImpl.writeFile(filePath, JSON.stringify(digest, null, 2), "utf8");
    return filePath;
  }
  await atomicWriteJson(filePath, digest);
  return filePath;
}

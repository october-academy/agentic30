// Weekly work-history retrospective indexer for the History tab.
//
// Interview-pinned product contract (interview_20260604_052353):
//   - Unit: current workspace/repo, this week (Mac local timezone, Mon–Sun).
//   - Top question: "어디에 시간을 썼나" — grouped by feature area.
//   - Time = AI session wall-clock only (Claude/Codex/Gemini local logs).
//     Commits are activity/evidence, never time.
//   - Sessions link to commits via file/diff overlap (+ prompt↔message token
//     overlap as confidence boost). Unlinked sessions surface as
//     "미분류/진행 중 작업" — never silently dropped, never force-attached.
//   - On-screen references: changed files/dirs + AI session time ranges +
//     confidence. Commit SHAs/messages are linking evidence only (hidden).
//   - Feature areas auto-inferred from logs+diff (heuristic baseline; agent
//     refinement optional via queryImpl, mirroring composeDay1SituationSummary).
//   - Daily item: per-feature-area day summary, coach tone, 성과/다음 액션 중심,
//     미완료·리스크는 명확한 근거가 있을 때만. Next actions need evidence.
//   - git scope: --all (local + remote-tracking, i.e. GitHub branches).
//     All repo activity is collected; only my commits aggregate into areas,
//     others'/bots' activity renders as reference events (decided in lieu of
//     interview round 30 which delegated the call).
//   - AI session boundary (round 19, delegated): tool-recorded session id,
//     first→last event timestamp; sessions crossing midnight split per day.
//   - Storage (round 34, delegated): derived data only — summaries, areas,
//     paths, time ranges, retrospective projection. Raw prompts/outputs and
//     raw commit SHAs stay in-memory and are discarded. Snapshot lives in
//     <workspace>/.agentic30/.
//   - GitHub: gh CLI is the source for remote data; when gh is missing or
//     unauthenticated the snapshot reports status.state = "github_required"
//     (round 39: GitHub 연결을 요구).
//   - Refresh: hourly background + on-tab-entry when stale/changed + manual.
//
// Module contract (mirrors news-market-radar/bip-research conventions):
//   - Pure helpers exported for deterministic tests; I/O wrappers accept
//     injectable execImpl/now/homeDir.
//   - READ-ONLY toward git/gh/agent logs; the only write is the snapshot via
//     atomicWriteJson.
//   - Every path leaving this module is workspace-relative; secrets pass
//     through redaction upstream (agent-work-history events arrive redacted).

import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { execFile } from "node:child_process";

import { atomicWriteJson } from "./atomic-store.mjs";
import { collectAgentWorkEvents } from "./agent-work-history.mjs";

export const WORK_HISTORY_SCHEMA_VERSION = 2;
export const WORK_HISTORY_REFRESH_INTERVAL_MS = 60 * 60 * 1000; // hourly background reindex
export const WORK_HISTORY_EXEC_TIMEOUT_MS = 20_000;
export const WORK_HISTORY_MAX_COMMITS = 400;
export const WORK_HISTORY_MAX_REFERENCE_EVENTS_PER_DAY = 12;
export const WORK_HISTORY_MAX_PATHS_PER_AREA = 8;
export const WORK_HISTORY_MAX_NEXT_ACTIONS = 3;
export const WORK_HISTORY_MAX_RETROSPECTIVE_INSIGHTS = 3;
export const WORK_HISTORY_MAX_RISK_FLAGS = 4;

const WEEKDAY_LABELS_KO = ["월", "화", "수", "목", "금", "토", "일"];
const DAY_MS = 86_400_000;
const RETROSPECTIVE_VERDICTS = new Set(["continue", "rebalance", "close_loop", "pivot", "stop"]);
const RETROSPECTIVE_CONFIDENCE = new Set(["high", "medium", "low"]);
const RETROSPECTIVE_RISK_SEVERITY = new Set(["info", "watch", "blocker"]);
const EVIDENCE_SOURCE_DEFS = Object.freeze([
  { source: "ai_session", label: "AI 세션" },
  { source: "git_github", label: "git/GitHub" },
  { source: "workspace_docs", label: "워크스페이스 문서" },
  { source: "interview", label: "인터뷰" },
  { source: "bip", label: "BIP" },
  { source: "mission", label: "미션" },
  { source: "curriculum", label: "커리큘럼" },
]);

// ---------------------------------------------------------------------------
// Local-week time helpers (pure; tzOffsetMinutes is Date#getTimezoneOffset())
// ---------------------------------------------------------------------------

function toLocalMs(utcMs, tzOffsetMinutes) {
  return utcMs - tzOffsetMinutes * 60_000;
}

export function toLocalDayKey(utcMs, tzOffsetMinutes) {
  if (!Number.isFinite(utcMs)) return "";
  return new Date(toLocalMs(utcMs, tzOffsetMinutes)).toISOString().slice(0, 10);
}

/// Monday–Sunday week containing `now`, in the Mac's local timezone.
/// Returns UTC ms bounds plus the seven local day keys.
export function localWeekRange(now = new Date(), { tzOffsetMinutes = 0 } = {}) {
  const nowMs = now instanceof Date ? now.getTime() : Number(now) || 0;
  const local = new Date(toLocalMs(nowMs, tzOffsetMinutes));
  const localMidnight = Date.UTC(
    local.getUTCFullYear(),
    local.getUTCMonth(),
    local.getUTCDate(),
  );
  const daysFromMonday = (local.getUTCDay() + 6) % 7;
  const weekStartLocal = localMidnight - daysFromMonday * DAY_MS;
  const weekStartMs = weekStartLocal + tzOffsetMinutes * 60_000;
  const weekEndMs = weekStartMs + 7 * DAY_MS;
  const dayKeys = [];
  for (let i = 0; i < 7; i += 1) {
    dayKeys.push(new Date(weekStartLocal + i * DAY_MS).toISOString().slice(0, 10));
  }
  return {
    weekStartMs,
    weekEndMs,
    weekStart: dayKeys[0],
    weekEnd: dayKeys[6],
    dayKeys,
  };
}

/// Overlap (minutes, rounded) between [startMs, endMs) and the local day at
/// index dayIndex of the week. Used to split midnight-crossing sessions.
export function sessionMinutesOnDay(startMs, endMs, week, dayIndex) {
  const dayStart = week.weekStartMs + dayIndex * DAY_MS;
  const dayEnd = dayStart + DAY_MS;
  const overlap = Math.min(endMs, dayEnd) - Math.max(startMs, dayStart);
  if (!Number.isFinite(overlap) || overlap <= 0) return 0;
  return Math.max(1, Math.round(overlap / 60_000));
}

// ---------------------------------------------------------------------------
// AI sessions from normalized agent events (pure)
// ---------------------------------------------------------------------------

/// Group normalized agent events (provider/sessionId/ts/kind) into sessions.
/// Wall-clock = first event ts → last event ts (round 18 + delegated round 19).
/// `prompts` stays in-memory for linking; snapshot assembly must not persist it.
export function sessionsFromAgentEvents(events = []) {
  const byKey = new Map();
  for (const event of events) {
    if (!event || !Number.isFinite(event.ts)) continue;
    const key = `${event.provider || "agent"}:${event.sessionId || "unknown"}`;
    if (!byKey.has(key)) {
      byKey.set(key, {
        key,
        provider: event.provider || "agent",
        sessionId: event.sessionId || null,
        startTs: event.ts,
        endTs: event.ts,
        files: new Set(),
        prompts: [],
        eventCount: 0,
      });
    }
    const session = byKey.get(key);
    session.eventCount += 1;
    if (event.ts < session.startTs) session.startTs = event.ts;
    if (event.ts > session.endTs) session.endTs = event.ts;
    if (event.kind === "file_edit" && event.path) session.files.add(String(event.path));
    if (event.kind === "prompt" && event.text) session.prompts.push(String(event.text));
  }
  return [...byKey.values()]
    .map((session) => ({ ...session, files: [...session.files].sort() }))
    .sort((a, b) => a.startTs - b.startTs);
}

// ---------------------------------------------------------------------------
// git log parsing (pure)
// ---------------------------------------------------------------------------

const GIT_RECORD_SEP = "\u001e";
const GIT_FIELD_SEP = "\u001f";

export function gitLogFormatArgs({ sinceIso, untilIso }) {
  return [
    "log",
    "--all",
    "--no-merges",
    `--since=${sinceIso}`,
    `--until=${untilIso}`,
    "--date=iso-strict",
    "--pretty=format:%x1e%H%x1f%an%x1f%ae%x1f%aI%x1f%s",
    "--numstat",
  ];
}

/// Parse `git log --pretty=<record/field separated> --numstat` output into
/// commits with files. Pure; tolerant of binary numstat ("-") lines.
export function parseGitLog(raw = "") {
  const commits = [];
  const records = String(raw).split(GIT_RECORD_SEP);
  for (const record of records) {
    const trimmed = record.trim();
    if (!trimmed) continue;
    const lines = trimmed.split("\n");
    const head = lines[0].split(GIT_FIELD_SEP);
    if (head.length < 5) continue;
    const [sha, authorName, authorEmail, authorIso, subject] = head;
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
      sha: String(sha || "").trim(),
      authorName: String(authorName || "").trim(),
      authorEmail: String(authorEmail || "").trim().toLowerCase(),
      ts: Number.isFinite(ts) ? ts : null,
      subject: String(subject || "").trim(),
      files,
      additions,
      deletions,
    });
  }
  return commits.filter((c) => c.sha && Number.isFinite(c.ts)).slice(0, WORK_HISTORY_MAX_COMMITS);
}

export function isBotAuthor(commit) {
  const name = `${commit.authorName || ""} ${commit.authorEmail || ""}`.toLowerCase();
  return /\[bot\]|dependabot|renovate|github-actions/.test(name);
}

// ---------------------------------------------------------------------------
// Session ↔ commit linking (pure)
// ---------------------------------------------------------------------------

function tokenize(text) {
  return new Set(
    String(text || "")
      .toLowerCase()
      .split(/[^a-z0-9가-힣_./-]+/)
      .filter((token) => token.length >= 3),
  );
}

/// Link sessions to my commits. Commit-centric (round 8): file overlap between
/// session edits and commit files is the primary evidence; prompt↔subject
/// token overlap upgrades confidence. No overlap → unlinked (round 9).
export function linkSessionsToCommits(sessions = [], commits = []) {
  const linkable = commits.filter((c) => c.isMine && !isBotAuthor(c));
  return sessions.map((session) => {
    const sessionFiles = new Set(session.files);
    const promptTokens = tokenize(session.prompts.join(" "));
    let linkedShas = [];
    let overlapPaths = new Set();
    let tokenMatched = false;
    for (const commit of linkable) {
      const overlap = commit.files.filter((file) => sessionFiles.has(file));
      if (!overlap.length) continue;
      linkedShas.push(commit.sha);
      for (const file of overlap) overlapPaths.add(file);
      if (!tokenMatched && promptTokens.size) {
        const subjectTokens = tokenize(commit.subject);
        for (const token of subjectTokens) {
          if (promptTokens.has(token)) {
            tokenMatched = true;
            break;
          }
        }
      }
    }
    let confidence = "none";
    if (linkedShas.length) {
      confidence =
        overlapPaths.size >= 2 || tokenMatched ? "high" : "medium";
    }
    return {
      ...session,
      linkedShas,
      linkConfidence: confidence,
      linked: linkedShas.length > 0,
    };
  });
}

// ---------------------------------------------------------------------------
// Feature-area inference (pure heuristic baseline; agent refinement optional)
// ---------------------------------------------------------------------------

export function areaKeyForPath(filePath) {
  const clean = String(filePath || "").replace(/^\.\//, "");
  if (!clean) return "workspace";
  const segments = clean.split("/").filter(Boolean);
  if (segments.length <= 1) return "workspace";
  return segments[0];
}

export function areaNameForKey(key) {
  if (key === "workspace") return "프로젝트 루트";
  return key;
}

function topPaths(pathCounts, limit = WORK_HISTORY_MAX_PATHS_PER_AREA) {
  return [...pathCounts.entries()]
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .slice(0, limit)
    .map(([p]) => p);
}

/// Cluster my commits + linked sessions into feature areas by dominant
/// top-level path segment. Deterministic; the agent refinement pass may
/// rename areas and rewrite summaries but never invents areas.
export function inferFeatureAreas({ sessions = [], commits = [] } = {}) {
  const areas = new Map();
  const ensureArea = (key) => {
    if (!areas.has(key)) {
      areas.set(key, {
        id: key,
        name: areaNameForKey(key),
        pathCounts: new Map(),
        commitShas: new Set(),
        sessionKeys: new Set(),
        confidence: "low",
        inference: "heuristic",
      });
    }
    return areas.get(key);
  };

  const commitArea = new Map();
  for (const commit of commits) {
    if (!commit.isMine || isBotAuthor(commit)) continue;
    const counts = new Map();
    for (const file of commit.files) {
      const key = areaKeyForPath(file);
      counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bestKey = "workspace";
    let bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount || (count === bestCount && key < bestKey)) {
        bestKey = key;
        bestCount = count;
      }
    }
    commitArea.set(commit.sha, bestKey);
    const area = ensureArea(bestKey);
    area.commitShas.add(commit.sha);
    for (const file of commit.files) {
      area.pathCounts.set(file, (area.pathCounts.get(file) || 0) + 1);
    }
  }

  const rankConfidence = (a, b) => {
    const rank = { high: 3, medium: 2, low: 1, none: 0 };
    return (rank[a] || 0) >= (rank[b] || 0) ? a : b;
  };

  for (const session of sessions) {
    if (!session.linked) continue;
    const counts = new Map();
    for (const sha of session.linkedShas) {
      const key = commitArea.get(sha);
      if (key) counts.set(key, (counts.get(key) || 0) + 1);
    }
    let bestKey = null;
    let bestCount = -1;
    for (const [key, count] of counts) {
      if (count > bestCount || (count === bestCount && key < bestKey)) {
        bestKey = key;
        bestCount = count;
      }
    }
    if (!bestKey) continue;
    const area = ensureArea(bestKey);
    area.sessionKeys.add(session.key);
    area.confidence = rankConfidence(
      session.linkConfidence === "high" ? "high" : "medium",
      area.confidence,
    );
    for (const file of session.files) {
      area.pathCounts.set(file, (area.pathCounts.get(file) || 0) + 1);
    }
  }

  return [...areas.values()].map((area) => ({
    id: area.id,
    name: area.name,
    paths: topPaths(area.pathCounts),
    commitShas: [...area.commitShas],
    sessionKeys: [...area.sessionKeys],
    confidence: area.confidence,
    inference: area.inference,
  }));
}

// ---------------------------------------------------------------------------
// Deterministic coach summaries + next actions (pure)
// ---------------------------------------------------------------------------

function formatMinutes(minutes) {
  const m = Math.max(0, Math.round(minutes || 0));
  if (m < 60) return `${m}분`;
  const h = Math.floor(m / 60);
  const rest = m % 60;
  return rest ? `${h}시간 ${rest}분` : `${h}시간`;
}

function shortPathList(paths, limit = 3) {
  const shown = paths.slice(0, limit).join(", ");
  return paths.length > limit ? `${shown} 외 ${paths.length - limit}개` : shown;
}

/// Coach-tone day summary for one area (성과 중심 + 명확한 근거가 있는 미완료만).
export function buildAreaDaySummary({ areaName, aiMinutes, commitCount, paths }) {
  const parts = [];
  if (aiMinutes > 0 && commitCount > 0) {
    parts.push(
      `${areaName}에 AI 세션 ${formatMinutes(aiMinutes)}을 투입해 커밋 ${commitCount}건으로 마무리했어요.`,
    );
  } else if (aiMinutes > 0) {
    parts.push(`${areaName}에서 AI 세션 ${formatMinutes(aiMinutes)} 작업이 있었어요.`);
  } else if (commitCount > 0) {
    parts.push(`${areaName}에서 커밋 ${commitCount}건을 남겼어요.`);
  }
  if (paths.length) parts.push(`주요 변경: ${shortPathList(paths)}.`);
  return parts.join(" ");
}

/// Evidence-gated next actions (round 25: 명확한 근거가 있는 작업만).
export function buildNextActions({ unclassifiedSessions = [], openPrs = [] } = {}) {
  const actions = [];
  for (const session of unclassifiedSessions) {
    if (!session.paths?.length) continue;
    actions.push({
      text: `커밋으로 이어지지 않은 ${session.provider} 세션 작업(${shortPathList(session.paths)})을 마무리하거나 정리하세요.`,
      evidence: `세션 ${session.start}–${session.end} · 수정 파일 ${session.paths.length}개`,
      areaName: null,
    });
    if (actions.length >= WORK_HISTORY_MAX_NEXT_ACTIONS) return actions;
  }
  for (const pr of openPrs) {
    actions.push({
      text: `열려 있는 PR "${pr.title}"를 리뷰/머지 단계까지 진행하세요.`,
      evidence: `PR #${pr.number} · ${pr.state}`,
      areaName: null,
    });
    if (actions.length >= WORK_HISTORY_MAX_NEXT_ACTIONS) break;
  }
  return actions;
}

// ---------------------------------------------------------------------------
// Retrospective projection (pure)
// ---------------------------------------------------------------------------

function cleanString(value, max = 240) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, max);
}

function normalizeConfidence(value, fallback = "medium") {
  const normalized = cleanString(value, 20).toLowerCase();
  return RETROSPECTIVE_CONFIDENCE.has(normalized) ? normalized : fallback;
}

function normalizeVerdict(value, fallback = "continue") {
  const normalized = cleanString(value, 40).toLowerCase();
  return RETROSPECTIVE_VERDICTS.has(normalized) ? normalized : fallback;
}

function normalizeRiskSeverity(value, fallback = "watch") {
  const normalized = cleanString(value, 20).toLowerCase();
  return RETROSPECTIVE_RISK_SEVERITY.has(normalized) ? normalized : fallback;
}

function normalizeEvidenceRefs(value, fallback = []) {
  const refs = Array.isArray(value) ? value : fallback;
  return refs
    .map((ref) => cleanString(ref, 180))
    .filter(Boolean)
    .slice(0, 6);
}

function sha256Short(value) {
  const text = String(value || "");
  if (!text) return null;
  return crypto.createHash("sha256").update(text).digest("hex").slice(0, 16);
}

function pathEvidence(paths = [], fallback = "") {
  const shown = shortPathList((paths || []).filter(Boolean), 3);
  return shown || fallback;
}

export function buildWorkHistoryEvidenceMix({
  snapshot = {},
  github = {},
  workspaceEvidence = {},
} = {}) {
  const counts = {
    ai_session: Number(snapshot.totals?.sessionCount || 0),
    git_github:
      Number(snapshot.totals?.myCommitCount || 0)
      + Number(snapshot.totals?.otherCommitCount || 0)
      + Number(github.prs?.length || snapshot.github?.prCount || 0)
      + Number(github.issues?.length || snapshot.github?.issueCount || 0)
      + Number(github.releases?.length || snapshot.github?.releaseCount || 0),
    workspace_docs: Number(workspaceEvidence.workspaceDocsCount ?? workspaceEvidence.docsCount ?? 0),
    interview: Number(workspaceEvidence.interviewCount ?? 0),
    bip: Number(workspaceEvidence.bipCount ?? 0),
    mission: Number(workspaceEvidence.missionCount ?? 0),
    curriculum: Number(workspaceEvidence.curriculumCount ?? 0),
  };
  return EVIDENCE_SOURCE_DEFS.map((def) => {
    const count = Math.max(0, Math.trunc(counts[def.source] || 0));
    let status = count > 0 ? "connected" : "missing";
    if (def.source === "git_github" && snapshot.github?.connected === false) status = "github_required";
    return {
      source: def.source,
      label: def.label,
      count,
      status,
    };
  });
}

export function emptyWorkHistoryRetrospective() {
  return {
    headline: "",
    verdict: "continue",
    insights: [],
    riskFlags: [],
    nextActions: [],
    evidenceMix: EVIDENCE_SOURCE_DEFS.map((def) => ({
      source: def.source,
      label: def.label,
      count: 0,
      status: "missing",
    })),
  };
}

function topAreaFocusInsight(snapshot, topArea) {
  if (!topArea || !(topArea.aiMinutes > 0 || topArea.commitCount > 0)) return null;
  return {
    id: `focus-${topArea.id}`,
    claim: `${topArea.name}에 이번 주 작업 에너지가 가장 많이 모였습니다.`,
    whyItMatters: "이 집중이 고객 증거나 다음 실험으로 이어지는지 확인해야 다음 주 우선순위를 방어할 수 있습니다.",
    confidence: topArea.confidence === "high" ? "high" : "medium",
    evidenceRefs: [
      `${topArea.name} · AI ${formatMinutes(topArea.aiMinutes)} · 커밋 ${topArea.commitCount}건`,
      pathEvidence(topArea.paths, "변경 경로 없음"),
    ].filter(Boolean),
  };
}

function unclassifiedInsight(snapshot) {
  if (!snapshot.unclassified?.length) return null;
  return {
    id: "unclassified-loop",
    claim: `커밋으로 닫히지 않은 AI 세션이 ${snapshot.unclassified.length}개 남아 있습니다.`,
    whyItMatters: "진행 중 실험인지 버릴 스파이크인지 정하지 않으면 다음 주 회고가 같은 불확실성을 반복합니다.",
    confidence: "high",
    evidenceRefs: [
      `미분류 ${formatMinutes(snapshot.totals?.unclassifiedMinutes || 0)}`,
      ...snapshot.unclassified.slice(0, 3).map((session) => (
        `${session.provider} ${session.date} · ${formatMinutes(session.minutes)} · ${pathEvidence(session.paths, "수정 파일 없음")}`
      )),
    ],
  };
}

function customerEvidenceGapInsight(snapshot, evidenceMix) {
  if (!snapshot.hasData && !(snapshot.generatedAt || snapshot.totals?.aiMinutes || snapshot.totals?.myCommitCount)) return null;
  const customerCount = evidenceMix
    .filter((item) => ["interview", "bip", "mission"].includes(item.source))
    .reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (customerCount > 0) return null;
  return {
    id: "customer-evidence-gap",
    claim: "이번 주 근거가 코드와 세션 기록에 치우쳐 있습니다.",
    whyItMatters: "Agentic30의 판단 기준은 만든 양이 아니라 고객 행동 증거입니다. 다음 행동은 외부 반응을 남기는 쪽으로 좁혀야 합니다.",
    confidence: "medium",
    evidenceRefs: [
      `AI 세션 ${formatMinutes(snapshot.totals?.aiMinutes || 0)}`,
      `내 커밋 ${snapshot.totals?.myCommitCount || 0}건`,
      "인터뷰/BIP/미션 근거 0건",
    ],
  };
}

function buildRetrospectiveRisks({ snapshot, topArea, openPrs = [], evidenceMix = [] } = {}) {
  const risks = [];
  if (snapshot.unclassified?.length) {
    risks.push({
      id: "unclassified",
      label: "미분류 세션",
      severity: "watch",
      reason: `커밋으로 이어지지 않은 AI 세션 ${snapshot.unclassified.length}개가 남아 있습니다.`,
      evidenceRefs: [`미분류 ${formatMinutes(snapshot.totals?.unclassifiedMinutes || 0)}`],
    });
  }
  if (topArea && snapshot.totals?.aiMinutes > 0) {
    const ratio = topArea.aiMinutes / snapshot.totals.aiMinutes;
    if (ratio >= 0.7 && snapshot.areas.length > 1) {
      risks.push({
        id: "focus-imbalance",
        label: "작업 편중",
        severity: "info",
        reason: `${topArea.name}이 전체 AI 세션의 ${Math.round(ratio * 100)}%를 차지합니다.`,
        evidenceRefs: [`${topArea.name} ${formatMinutes(topArea.aiMinutes)}`],
      });
    }
  }
  if (openPrs.length) {
    risks.push({
      id: "open-pr",
      label: "열린 PR",
      severity: "watch",
      reason: `열려 있는 PR ${openPrs.length}건이 다음 판단 전에 닫혀야 합니다.`,
      evidenceRefs: openPrs.slice(0, 3).map((pr) => `PR #${pr.number} ${pr.title || ""}`.trim()),
    });
  }
  const customerCount = evidenceMix
    .filter((item) => ["interview", "bip", "mission"].includes(item.source))
    .reduce((sum, item) => sum + Number(item.count || 0), 0);
  if (snapshot.totals?.aiMinutes > 0 && customerCount === 0) {
    risks.push({
      id: "customer-evidence-gap",
      label: "고객 증거 부족",
      severity: "watch",
      reason: "이번 주 표시 가능한 인터뷰/BIP/미션 근거가 없습니다.",
      evidenceRefs: ["인터뷰/BIP/미션 근거 0건"],
    });
  }
  return risks.slice(0, WORK_HISTORY_MAX_RISK_FLAGS);
}

function retrospectiveActionFromRisk(risk) {
  if (!risk) return null;
  switch (risk.id) {
  case "unclassified":
    return {
      text: "미분류 세션을 커밋으로 닫거나 버린 작업으로 표시하세요.",
      evidence: risk.evidenceRefs[0] || risk.reason,
      insightId: "unclassified-loop",
    };
  case "open-pr":
    return {
      text: "열린 PR을 리뷰/머지/보류 중 하나로 정리하세요.",
      evidence: risk.evidenceRefs[0] || risk.reason,
      insightId: "open-pr",
    };
  case "customer-evidence-gap":
    return {
      text: "이번 주 작업이 고객 반응으로 이어졌는지 인터뷰, BIP, 미션 증거 중 하나를 남기세요.",
      evidence: risk.evidenceRefs[0] || risk.reason,
      insightId: "customer-evidence-gap",
    };
  default:
    return null;
  }
}

export function buildWorkHistoryRetrospective({
  snapshot = {},
  github = {},
  workspaceEvidence = {},
} = {}) {
  const empty = emptyWorkHistoryRetrospective();
  const hasActivity = Boolean(
    snapshot.generatedAt
      || snapshot.totals?.aiMinutes
      || snapshot.totals?.myCommitCount
      || snapshot.totals?.sessionCount,
  );
  const evidenceMix = buildWorkHistoryEvidenceMix({ snapshot, github, workspaceEvidence });
  if (!hasActivity) {
    return {
      ...empty,
      headline: "이번 주 회고를 만들 근거가 아직 부족해요.",
      evidenceMix,
    };
  }

  const topArea = (snapshot.areas || [])[0] || null;
  const openPrs = (github.prs || []).filter((pr) => String(pr.state || "").toUpperCase() === "OPEN");
  const risks = buildRetrospectiveRisks({ snapshot, topArea, openPrs, evidenceMix });
  const insights = [
    topAreaFocusInsight(snapshot, topArea),
    unclassifiedInsight(snapshot),
    customerEvidenceGapInsight(snapshot, evidenceMix),
  ]
    .filter(Boolean)
    .filter((insight) => insight.evidenceRefs?.length)
    .slice(0, WORK_HISTORY_MAX_RETROSPECTIVE_INSIGHTS);

  let verdict = "continue";
  if (risks.some((risk) => risk.id === "unclassified" || risk.id === "open-pr")) {
    verdict = "close_loop";
  } else if (risks.some((risk) => risk.id === "customer-evidence-gap" || risk.id === "focus-imbalance")) {
    verdict = "rebalance";
  }

  const defaultAction = topArea ? {
    text: `${topArea.name}의 이번 주 진척을 고객 증거 또는 다음 실험과 연결하세요.`,
    evidence: `${topArea.name} · AI ${formatMinutes(topArea.aiMinutes)} · 커밋 ${topArea.commitCount}건`,
    insightId: `focus-${topArea.id}`,
  } : null;
  const nextActions = [
    ...risks.map(retrospectiveActionFromRisk).filter(Boolean),
    defaultAction,
  ]
    .filter(Boolean)
    .slice(0, WORK_HISTORY_MAX_NEXT_ACTIONS);

  const headline = verdict === "close_loop"
    ? "이번 주 작업은 진척보다 먼저 닫아야 할 루프가 보입니다."
    : verdict === "rebalance"
      ? "이번 주 작업은 만들기 쪽으로 충분히 움직였고, 다음 판단은 근거 균형입니다."
      : "이번 주 작업은 이어갈 수 있지만, 다음 행동은 증거로 좁혀야 합니다.";

  return normalizeWorkHistoryRetrospective({
    headline,
    verdict,
    insights,
    riskFlags: risks,
    nextActions,
    evidenceMix,
  }, empty);
}

export function normalizeWorkHistoryRetrospective(value = {}, fallback = emptyWorkHistoryRetrospective()) {
  const raw = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const fallbackMix = Array.isArray(fallback.evidenceMix) && fallback.evidenceMix.length
    ? fallback.evidenceMix
    : emptyWorkHistoryRetrospective().evidenceMix;
  const normalizedInsightItems = Array.isArray(raw.insights)
    ? raw.insights
      .map((item, index) => {
        const evidenceRefs = normalizeEvidenceRefs(item?.evidenceRefs ?? item?.evidence_refs);
        if (!evidenceRefs.length) return null;
        return {
          id: cleanString(item?.id, 80) || `insight-${index + 1}`,
          claim: cleanString(item?.claim ?? item?.text, 220),
          whyItMatters: cleanString(item?.whyItMatters ?? item?.why_it_matters ?? item?.reason, 300),
          confidence: normalizeConfidence(item?.confidence, "medium"),
          evidenceRefs,
        };
      })
      .filter((item) => item && item.claim)
      .slice(0, WORK_HISTORY_MAX_RETROSPECTIVE_INSIGHTS)
    : null;
  const insights = normalizedInsightItems && normalizedInsightItems.length
    ? normalizedInsightItems
    : fallback.insights || [];
  const riskFlags = Array.isArray(raw.riskFlags ?? raw.risk_flags)
    ? (raw.riskFlags ?? raw.risk_flags)
      .map((item, index) => {
        const evidenceRefs = normalizeEvidenceRefs(item?.evidenceRefs ?? item?.evidence_refs);
        return {
          id: cleanString(item?.id, 80) || `risk-${index + 1}`,
          label: cleanString(item?.label ?? item?.title, 80),
          severity: normalizeRiskSeverity(item?.severity, "watch"),
          reason: cleanString(item?.reason ?? item?.body, 260),
          evidenceRefs,
        };
      })
      .filter((item) => item.label && item.reason)
      .slice(0, WORK_HISTORY_MAX_RISK_FLAGS)
    : fallback.riskFlags || [];
  const nextActions = Array.isArray(raw.nextActions ?? raw.next_actions)
    ? (raw.nextActions ?? raw.next_actions)
      .map((item) => ({
        text: cleanString(item?.text ?? item?.action, 240),
        evidence: cleanString(item?.evidence, 220),
        insightId: cleanString(item?.insightId ?? item?.insight_id, 80) || null,
      }))
      .filter((item) => item.text && item.evidence)
      .slice(0, WORK_HISTORY_MAX_NEXT_ACTIONS)
    : fallback.nextActions || [];
  const evidenceMix = Array.isArray(raw.evidenceMix ?? raw.evidence_mix)
    ? EVIDENCE_SOURCE_DEFS.map((def) => {
      const match = (raw.evidenceMix ?? raw.evidence_mix).find((item) => item?.source === def.source) || {};
      const count = Math.max(0, Math.trunc(Number(match.count || 0)));
      return {
        source: def.source,
        label: cleanString(match.label, 80) || def.label,
        count,
        status: cleanString(match.status, 40) || (count > 0 ? "connected" : "missing"),
      };
    })
    : fallbackMix;
  return {
    headline: cleanString(raw.headline, 220) || fallback.headline || "",
    verdict: normalizeVerdict(raw.verdict, fallback.verdict || "continue"),
    insights,
    riskFlags,
    nextActions,
    evidenceMix,
  };
}

// ---------------------------------------------------------------------------
// Snapshot assembly (pure)
// ---------------------------------------------------------------------------

function isoOrNull(ms) {
  return Number.isFinite(ms) ? new Date(ms).toISOString() : null;
}

export function emptyWorkHistorySnapshot({ now = new Date(), tzOffsetMinutes = 0 } = {}) {
  const week = localWeekRange(now, { tzOffsetMinutes });
  return {
    schemaVersion: WORK_HISTORY_SCHEMA_VERSION,
    generatedAt: null,
    weekStart: week.weekStart,
    weekEnd: week.weekEnd,
    status: {
      state: "empty",
      lastSuccessAt: null,
      stale: true,
      error: null,
      reason: null,
    },
    github: { connected: false, prCount: 0, issueCount: 0, releaseCount: 0 },
    totals: {
      aiMinutes: 0,
      unclassifiedMinutes: 0,
      myCommitCount: 0,
      otherCommitCount: 0,
      sessionCount: 0,
      activeDays: 0,
    },
    areas: [],
    days: week.dayKeys.map((date, index) => ({
      date,
      weekday: WEEKDAY_LABELS_KO[index],
      aiMinutes: 0,
      areas: [],
      referenceEvents: [],
    })),
    unclassified: [],
    weekly: { headline: "", coachNotes: [], nextActions: [] },
    retrospective: emptyWorkHistoryRetrospective(),
    fingerprint: { headHash: null },
  };
}

/// Assemble the full weekly snapshot from collected inputs. Pure and
/// deterministic; never copies prompt text into the result (round 34).
export function buildWeeklyWorkHistorySnapshot({
  now = new Date(),
  tzOffsetMinutes = 0,
  sessions = [],
  commits = [],
  github = { connected: false, prs: [], issues: [], releases: [] },
  headSha = null,
  workspaceEvidence = {},
  reason = "manual",
} = {}) {
  const week = localWeekRange(now, { tzOffsetMinutes });
  const snapshot = emptyWorkHistorySnapshot({ now, tzOffsetMinutes });
  snapshot.generatedAt = new Date(now instanceof Date ? now.getTime() : now).toISOString();
  snapshot.fingerprint = { headHash: sha256Short(headSha) };

  const inWeek = (ts) => Number.isFinite(ts) && ts >= week.weekStartMs && ts < week.weekEndMs;
  const weekSessions = sessions.filter(
    (s) => Number.isFinite(s.startTs) && s.endTs >= week.weekStartMs && s.startTs < week.weekEndMs,
  );
  const weekCommits = commits.filter((c) => inWeek(c.ts));

  const linked = linkSessionsToCommits(weekSessions, weekCommits);
  const areas = inferFeatureAreas({ sessions: linked, commits: weekCommits });
  const areaBySession = new Map();
  const areaByCommit = new Map();
  for (const area of areas) {
    for (const key of area.sessionKeys) areaBySession.set(key, area);
    for (const sha of area.commitShas) areaByCommit.set(sha, area);
  }

  const myCommits = weekCommits.filter((c) => c.isMine && !isBotAuthor(c));
  const otherCommits = weekCommits.filter((c) => !c.isMine || isBotAuthor(c));

  // Per-day, per-area aggregation. Sessions split across local days.
  const dayBuckets = week.dayKeys.map(() => new Map());
  const dayMinutes = week.dayKeys.map(() => 0);
  const areaTotals = new Map();
  const ensureDayArea = (dayIndex, area) => {
    const bucket = dayBuckets[dayIndex];
    if (!bucket.has(area.id)) {
      bucket.set(area.id, {
        areaId: area.id,
        name: area.name,
        aiMinutes: 0,
        commitCount: 0,
        sessionRanges: [],
        pathCounts: new Map(),
        confidence: area.confidence,
      });
    }
    return bucket.get(area.id);
  };
  const ensureAreaTotal = (area) => {
    if (!areaTotals.has(area.id)) {
      areaTotals.set(area.id, {
        id: area.id,
        name: area.name,
        aiMinutes: 0,
        commitCount: 0,
        sessionCount: 0,
        paths: area.paths,
        confidence: area.confidence,
        inference: area.inference,
      });
    }
    return areaTotals.get(area.id);
  };

  let totalAiMinutes = 0;
  let unclassifiedMinutes = 0;
  const unclassified = [];

  for (const session of linked) {
    const area = session.linked ? areaBySession.get(session.key) : null;
    let sessionMinutes = 0;
    for (let dayIndex = 0; dayIndex < 7; dayIndex += 1) {
      const minutes = sessionMinutesOnDay(session.startTs, session.endTs, week, dayIndex);
      if (!minutes) continue;
      sessionMinutes += minutes;
      dayMinutes[dayIndex] += minutes;
      if (area) {
        const dayArea = ensureDayArea(dayIndex, area);
        dayArea.aiMinutes += minutes;
        dayArea.sessionRanges.push({
          start: isoOrNull(Math.max(session.startTs, week.weekStartMs + dayIndex * DAY_MS)),
          end: isoOrNull(Math.min(session.endTs, week.weekStartMs + (dayIndex + 1) * DAY_MS)),
          provider: session.provider,
        });
        for (const file of session.files) {
          dayArea.pathCounts.set(file, (dayArea.pathCounts.get(file) || 0) + 1);
        }
      }
    }
    totalAiMinutes += sessionMinutes;
    if (area) {
      const totals = ensureAreaTotal(area);
      totals.aiMinutes += sessionMinutes;
      totals.sessionCount += 1;
    } else {
      unclassifiedMinutes += sessionMinutes;
      unclassified.push({
        provider: session.provider,
        date: toLocalDayKey(session.startTs, tzOffsetMinutes),
        start: isoOrNull(session.startTs),
        end: isoOrNull(session.endTs),
        minutes: sessionMinutes,
        paths: session.files.slice(0, WORK_HISTORY_MAX_PATHS_PER_AREA),
      });
    }
  }

  for (const commit of myCommits) {
    const area = areaByCommit.get(commit.sha);
    if (!area) continue;
    const dayKey = toLocalDayKey(commit.ts, tzOffsetMinutes);
    const dayIndex = week.dayKeys.indexOf(dayKey);
    ensureAreaTotal(area).commitCount += 1;
    if (dayIndex >= 0) {
      const dayArea = ensureDayArea(dayIndex, area);
      dayArea.commitCount += 1;
      for (const file of commit.files) {
        dayArea.pathCounts.set(file, (dayArea.pathCounts.get(file) || 0) + 1);
      }
    }
  }

  // Reference events: others' commits + gh activity (round 30 decision).
  const referenceByDay = week.dayKeys.map(() => []);
  const pushReference = (ts, event) => {
    const dayIndex = week.dayKeys.indexOf(toLocalDayKey(ts, tzOffsetMinutes));
    if (dayIndex < 0) return;
    if (referenceByDay[dayIndex].length >= WORK_HISTORY_MAX_REFERENCE_EVENTS_PER_DAY) return;
    referenceByDay[dayIndex].push(event);
  };
  for (const commit of otherCommits) {
    pushReference(commit.ts, {
      kind: "other_commit",
      title: `다른 작성자 커밋 · ${shortPathList(commit.files, 2) || "변경"}`,
      actor: commit.authorName || "unknown",
      at: isoOrNull(commit.ts),
    });
  }
  for (const pr of github.prs || []) {
    const ts = Date.parse(pr.updatedAt || pr.createdAt || "");
    pushReference(ts, {
      kind: "pr",
      title: `PR #${pr.number} ${pr.title || ""}`.trim(),
      actor: pr.author || "",
      at: isoOrNull(ts),
    });
  }
  for (const issue of github.issues || []) {
    const ts = Date.parse(issue.updatedAt || issue.createdAt || "");
    pushReference(ts, {
      kind: "issue",
      title: `이슈 #${issue.number} ${issue.title || ""}`.trim(),
      actor: issue.author || "",
      at: isoOrNull(ts),
    });
  }
  for (const release of github.releases || []) {
    const ts = Date.parse(release.publishedAt || "");
    pushReference(ts, {
      kind: "release",
      title: `릴리즈 ${release.tagName || release.name || ""}`.trim(),
      actor: "",
      at: isoOrNull(ts),
    });
  }

  snapshot.days = week.dayKeys.map((date, index) => ({
    date,
    weekday: WEEKDAY_LABELS_KO[index],
    aiMinutes: dayMinutes[index],
    areas: [...dayBuckets[index].values()]
      .sort((a, b) => b.aiMinutes - a.aiMinutes || a.name.localeCompare(b.name))
      .map((dayArea) => ({
        areaId: dayArea.areaId,
        name: dayArea.name,
        summary: buildAreaDaySummary({
          areaName: dayArea.name,
          aiMinutes: dayArea.aiMinutes,
          commitCount: dayArea.commitCount,
          paths: topPaths(dayArea.pathCounts),
        }),
        nextActions: [],
        aiMinutes: dayArea.aiMinutes,
        sessionRanges: dayArea.sessionRanges,
        paths: topPaths(dayArea.pathCounts),
        commitCount: dayArea.commitCount,
        confidence: dayArea.confidence,
      })),
    referenceEvents: referenceByDay[index],
  }));

  snapshot.areas = [...areaTotals.values()].sort(
    (a, b) => b.aiMinutes - a.aiMinutes || b.commitCount - a.commitCount || a.name.localeCompare(b.name),
  );
  snapshot.unclassified = unclassified.sort((a, b) => (a.start || "").localeCompare(b.start || ""));
  snapshot.totals = {
    aiMinutes: totalAiMinutes,
    unclassifiedMinutes,
    myCommitCount: myCommits.length,
    otherCommitCount: otherCommits.length,
    sessionCount: weekSessions.length,
    activeDays: snapshot.days.filter((d) => d.aiMinutes > 0 || d.areas.some((a) => a.commitCount > 0)).length,
  };
  snapshot.github = {
    connected: Boolean(github.connected),
    prCount: (github.prs || []).length,
    issueCount: (github.issues || []).length,
    releaseCount: (github.releases || []).length,
  };

  const openPrs = (github.prs || []).filter((pr) => String(pr.state || "").toUpperCase() === "OPEN");
  const topArea = snapshot.areas[0] || null;
  const headlineParts = [
    `이번 주 AI 세션 ${formatMinutes(totalAiMinutes)} · 커밋 ${myCommits.length}건`,
  ];
  if (topArea && topArea.aiMinutes > 0) {
    headlineParts.push(`가장 많은 시간: ${topArea.name} (${formatMinutes(topArea.aiMinutes)})`);
  }
  const coachNotes = [];
  if (topArea && (topArea.aiMinutes > 0 || topArea.commitCount > 0)) {
    coachNotes.push(
      `${topArea.name}에 집중해 ${formatMinutes(topArea.aiMinutes)} · 커밋 ${topArea.commitCount}건의 진척을 만들었어요.`,
    );
  }
  if (unclassified.length) {
    coachNotes.push(
      `커밋으로 이어지지 않은 세션이 ${unclassified.length}개(${formatMinutes(unclassifiedMinutes)}) 있어요 — 진행 중이라면 마무리 지점을 정해두세요.`,
    );
  }
  if (openPrs.length) {
    coachNotes.push(`열려 있는 PR ${openPrs.length}건이 머지를 기다리고 있어요.`);
  }
  snapshot.weekly = {
    headline: headlineParts.join(" · "),
    coachNotes,
    nextActions: buildNextActions({ unclassifiedSessions: unclassified, openPrs }),
  };
  snapshot.retrospective = buildWorkHistoryRetrospective({
    snapshot,
    github,
    workspaceEvidence,
  });

  snapshot.status = {
    state: github.connected ? "ready" : "github_required",
    lastSuccessAt: snapshot.generatedAt,
    stale: false,
    error: null,
    reason,
  };
  return snapshot;
}

// ---------------------------------------------------------------------------
// Optional agent refinement (mirrors composeDay1SituationSummary contract)
// ---------------------------------------------------------------------------

/// Apply agent-refined area names / summaries / next actions on top of the
/// deterministic snapshot. The refinement may only rewrite text fields of
/// existing areas/days — structure, numbers, and references stay deterministic.
export function applyWorkHistoryRefinement(snapshot, refinement) {
  if (!snapshot || !refinement || typeof refinement !== "object") return snapshot;
  const areaNames = refinement.areaNames && typeof refinement.areaNames === "object"
    ? refinement.areaNames
    : {};
  const renamed = { ...snapshot };
  const renameArea = (area) => {
    const name = areaNames[area.areaId ?? area.id];
    if (typeof name === "string" && name.trim()) {
      return { ...area, name: name.trim().slice(0, 60), inference: "agent" };
    }
    return area;
  };
  renamed.areas = snapshot.areas.map((area) => renameArea(area));
  renamed.days = snapshot.days.map((day, dayIndex) => {
    const refinedDay = Array.isArray(refinement.days) ? refinement.days[dayIndex] : null;
    return {
      ...day,
      areas: day.areas.map((area) => {
        let next = renameArea(area);
        const refinedArea = refinedDay && Array.isArray(refinedDay.areas)
          ? refinedDay.areas.find((a) => a && a.areaId === area.areaId)
          : null;
        if (refinedArea) {
          if (typeof refinedArea.summary === "string" && refinedArea.summary.trim()) {
            next = { ...next, summary: refinedArea.summary.trim().slice(0, 400) };
          }
          if (Array.isArray(refinedArea.nextActions)) {
            const actions = refinedArea.nextActions
              .filter((a) => a && typeof a.text === "string" && a.text.trim()
                && typeof a.evidence === "string" && a.evidence.trim())
              .slice(0, WORK_HISTORY_MAX_NEXT_ACTIONS)
              .map((a) => ({
                text: a.text.trim().slice(0, 240),
                evidence: a.evidence.trim().slice(0, 240),
                areaName: next.name,
              }));
            if (actions.length) next = { ...next, nextActions: actions };
          }
        }
        return next;
      }),
    };
  });
  if (refinement.weekly && typeof refinement.weekly === "object") {
    const weekly = { ...snapshot.weekly };
    if (typeof refinement.weekly.headline === "string" && refinement.weekly.headline.trim()) {
      weekly.headline = refinement.weekly.headline.trim().slice(0, 200);
    }
    if (Array.isArray(refinement.weekly.coachNotes)) {
      const notes = refinement.weekly.coachNotes
        .filter((n) => typeof n === "string" && n.trim())
        .slice(0, 5)
        .map((n) => n.trim().slice(0, 240));
      if (notes.length) weekly.coachNotes = notes;
    }
    if (Array.isArray(refinement.weekly.nextActions)) {
      const actions = refinement.weekly.nextActions
        .filter((a) => a && typeof a.text === "string" && a.text.trim()
          && typeof a.evidence === "string" && a.evidence.trim())
        .slice(0, WORK_HISTORY_MAX_NEXT_ACTIONS)
        .map((a) => ({
          text: a.text.trim().slice(0, 240),
          evidence: a.evidence.trim().slice(0, 240),
          areaName: typeof a.areaName === "string" ? a.areaName.slice(0, 60) : null,
        }));
      if (actions.length) weekly.nextActions = actions;
    }
    renamed.weekly = weekly;
  }
  if (refinement.retrospective && typeof refinement.retrospective === "object") {
    renamed.retrospective = normalizeWorkHistoryRetrospective(
      {
        ...refinement.retrospective,
        // Evidence coverage is deterministic collector output. Provider text
        // may not rewrite counts or source status.
        evidenceMix: renamed.retrospective?.evidenceMix || snapshot.retrospective?.evidenceMix,
      },
      renamed.retrospective || snapshot.retrospective || emptyWorkHistoryRetrospective(),
    );
  } else {
    renamed.retrospective = normalizeWorkHistoryRetrospective(
      renamed.retrospective || snapshot.retrospective,
      emptyWorkHistoryRetrospective(),
    );
  }
  return renamed;
}

export function buildWorkHistoryRefinementPrompt(snapshot) {
  const compact = {
    weekStart: snapshot.weekStart,
    weekEnd: snapshot.weekEnd,
    areas: snapshot.areas.map((a) => ({
      areaId: a.id,
      name: a.name,
      aiMinutes: a.aiMinutes,
      commitCount: a.commitCount,
      paths: a.paths,
    })),
    days: snapshot.days.map((d) => ({
      date: d.date,
      weekday: d.weekday,
      areas: d.areas.map((a) => ({
        areaId: a.areaId,
        name: a.name,
        aiMinutes: a.aiMinutes,
        commitCount: a.commitCount,
        paths: a.paths,
      })),
    })),
    unclassified: snapshot.unclassified,
    totals: snapshot.totals,
    retrospective: {
      headline: snapshot.retrospective?.headline || "",
      verdict: snapshot.retrospective?.verdict || "continue",
      insights: (snapshot.retrospective?.insights || []).map((insight) => ({
        id: insight.id,
        claim: insight.claim,
        whyItMatters: insight.whyItMatters,
        confidence: insight.confidence,
        evidenceRefs: insight.evidenceRefs,
      })),
      riskFlags: (snapshot.retrospective?.riskFlags || []).map((risk) => ({
        id: risk.id,
        label: risk.label,
        severity: risk.severity,
        reason: risk.reason,
        evidenceRefs: risk.evidenceRefs,
      })),
      nextActions: snapshot.retrospective?.nextActions || [],
      evidenceMix: snapshot.retrospective?.evidenceMix || [],
    },
  };
  return [
    "당신은 1인 개발자의 주간 회고 코치입니다. 아래 결정적(deterministic) 주간 작업 데이터로",
    "기능 영역 이름, 일별 요약, retrospective 텍스트를 다듬어 strict JSON으로만 답하세요.",
    "규칙:",
    "- 영역 이름은 데이터에 보이는 파일/디렉토리에서 추론한 기능 이름(한국어)으로. 새 영역 생성 금지.",
    "- 요약은 코치 문체: 성과 중심, 미완료/리스크는 데이터에 근거가 있을 때만 지적.",
    "- nextActions는 명확한 근거(evidence 필드에 데이터 출처 명시)가 있을 때만. 추측 금지.",
    "- retrospective.insights는 evidenceRefs가 비어 있으면 무효입니다.",
    "- retrospective.evidenceMix의 count/status/source는 절대 바꾸지 마세요.",
    "- 숫자(시간/커밋 수)는 절대 바꾸지 마세요.",
    "출력 스키마:",
    '{"areaNames":{"<areaId>":"이름"},"days":[{"date":"YYYY-MM-DD","areas":[{"areaId":"...","summary":"...","nextActions":[{"text":"...","evidence":"..."}]}]}],"weekly":{"headline":"...","coachNotes":["..."],"nextActions":[{"text":"...","evidence":"...","areaName":"..."}]},"retrospective":{"headline":"...","verdict":"continue|rebalance|close_loop|pivot|stop","insights":[{"id":"existing-or-new-id","claim":"...","whyItMatters":"...","confidence":"high|medium|low","evidenceRefs":["..."]}],"riskFlags":[{"id":"...","label":"...","severity":"info|watch|blocker","reason":"...","evidenceRefs":["..."]}],"nextActions":[{"text":"...","evidence":"...","insightId":"..."}]}}',
    "데이터:",
    JSON.stringify(compact),
  ].join("\n");
}

export function parseWorkHistoryRefinement(text) {
  const raw = String(text || "");
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) return null;
  try {
    return JSON.parse(raw.slice(start, end + 1));
  } catch {
    return null;
  }
}

/// Deterministic snapshot + optional agent refinement, never failing the
/// refresh when the agent pass breaks (same posture as composeDay1SituationSummary).
export async function composeWorkHistorySnapshot({ deterministic, queryImpl = null } = {}) {
  if (typeof queryImpl !== "function") return deterministic;
  try {
    const text = await queryImpl(buildWorkHistoryRefinementPrompt(deterministic));
    const refinement = parseWorkHistoryRefinement(text);
    if (refinement) return applyWorkHistoryRefinement(deterministic, refinement);
  } catch {
    /* deterministic fallback */
  }
  return deterministic;
}

// ---------------------------------------------------------------------------
// Persistence
// ---------------------------------------------------------------------------

export function resolveWorkHistoryCachePath(workspaceRoot) {
  return path.join(path.resolve(String(workspaceRoot || ".")), ".agentic30", "work-history.json");
}

export async function persistWorkHistorySnapshot({ workspaceRoot, snapshot, fsImpl = fs }) {
  const cachePath = resolveWorkHistoryCachePath(workspaceRoot);
  await fsImpl.mkdir(path.dirname(cachePath), { recursive: true });
  await atomicWriteJson(cachePath, snapshot);
  return cachePath;
}

export async function loadWorkHistorySnapshot({
  workspaceRoot,
  now = new Date(),
  tzOffsetMinutes = now.getTimezoneOffset?.() ?? 0,
  fsImpl = fs,
} = {}) {
  const empty = emptyWorkHistorySnapshot({ now, tzOffsetMinutes });
  if (!workspaceRoot) return empty;
  let parsed;
  try {
    parsed = JSON.parse(await fsImpl.readFile(resolveWorkHistoryCachePath(workspaceRoot), "utf8"));
  } catch {
    return empty;
  }
  if (!parsed || typeof parsed !== "object") return empty;
  if (![1, WORK_HISTORY_SCHEMA_VERSION].includes(parsed.schemaVersion)) return empty;
  parsed = migrateWorkHistorySnapshot(parsed, { now, tzOffsetMinutes });
  const week = localWeekRange(now, { tzOffsetMinutes });
  const sameWeek = parsed.weekStart === week.weekStart;
  const generatedAtMs = Date.parse(parsed.generatedAt || "");
  const fresh = Number.isFinite(generatedAtMs)
    && (now.getTime?.() ?? Number(now)) - generatedAtMs < WORK_HISTORY_REFRESH_INTERVAL_MS;
  return {
    ...parsed,
    status: {
      ...parsed.status,
      stale: !sameWeek || !fresh,
    },
  };
}

export function migrateWorkHistorySnapshot(snapshot, { now = new Date(), tzOffsetMinutes = 0 } = {}) {
  if (!snapshot || typeof snapshot !== "object") {
    return emptyWorkHistorySnapshot({ now, tzOffsetMinutes });
  }
  const migrated = {
    ...emptyWorkHistorySnapshot({ now, tzOffsetMinutes }),
    ...snapshot,
    schemaVersion: WORK_HISTORY_SCHEMA_VERSION,
  };
  const headHash = snapshot.fingerprint?.headHash
    || sha256Short(snapshot.fingerprint?.headSha);
  migrated.fingerprint = { headHash };
  migrated.retrospective = normalizeWorkHistoryRetrospective(
    snapshot.retrospective,
    buildWorkHistoryRetrospective({ snapshot: migrated, github: migrated.github }),
  );
  return migrated;
}

// ---------------------------------------------------------------------------
// I/O collectors (git / gh / gemini)
// ---------------------------------------------------------------------------

function defaultExec(cmd, args, { cwd, timeoutMs = WORK_HISTORY_EXEC_TIMEOUT_MS } = {}) {
  return new Promise((resolve) => {
    execFile(
      cmd,
      args,
      { cwd, timeout: timeoutMs, maxBuffer: 32 * 1024 * 1024, encoding: "utf8" },
      (error, stdout) => {
        resolve({ ok: !error, stdout: String(stdout || "") });
      },
    );
  });
}

export async function collectGitCommitsForWeek({
  workspaceRoot,
  sinceMs,
  untilMs,
  execImpl = defaultExec,
} = {}) {
  const cwd = path.resolve(String(workspaceRoot || "."));
  const log = await execImpl(
    "git",
    gitLogFormatArgs({
      sinceIso: new Date(sinceMs).toISOString(),
      untilIso: new Date(untilMs).toISOString(),
    }),
    { cwd },
  );
  if (!log.ok) return { commits: [], headSha: null, userEmail: "" };
  const emailResult = await execImpl("git", ["config", "user.email"], { cwd });
  const headResult = await execImpl("git", ["log", "--all", "-1", "--format=%H"], { cwd });
  const userEmail = emailResult.ok ? emailResult.stdout.trim().toLowerCase() : "";
  const commits = parseGitLog(log.stdout).map((commit) => ({
    ...commit,
    isMine: Boolean(userEmail) && commit.authorEmail === userEmail,
  }));
  return {
    commits,
    headSha: headResult.ok ? headResult.stdout.trim() || null : null,
    userEmail,
  };
}

function parseJsonArray(stdout) {
  try {
    const parsed = JSON.parse(stdout);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

/// gh CLI activity for the week. `connected: false` when gh is missing or
/// unauthenticated → snapshot reports github_required (round 39).
export async function collectGhWeekActivity({
  workspaceRoot,
  sinceMs,
  untilMs,
  execImpl = defaultExec,
} = {}) {
  const cwd = path.resolve(String(workspaceRoot || "."));
  const auth = await execImpl("gh", ["auth", "status"], { cwd });
  if (!auth.ok) {
    return { connected: false, prs: [], issues: [], releases: [] };
  }
  const inWindow = (iso) => {
    const ts = Date.parse(iso || "");
    return Number.isFinite(ts) && ts >= sinceMs && ts < untilMs;
  };
  const [prResult, issueResult, releaseResult] = await Promise.all([
    execImpl(
      "gh",
      ["pr", "list", "--state", "all", "--limit", "100", "--json", "number,title,state,createdAt,updatedAt,author,headRefName"],
      { cwd },
    ),
    execImpl(
      "gh",
      ["issue", "list", "--state", "all", "--limit", "100", "--json", "number,title,state,createdAt,updatedAt,author"],
      { cwd },
    ),
    execImpl(
      "gh",
      ["release", "list", "--limit", "40", "--json", "tagName,name,publishedAt"],
      { cwd },
    ),
  ]);
  const prs = parseJsonArray(prResult.ok ? prResult.stdout : "")
    .filter((pr) => inWindow(pr.updatedAt || pr.createdAt))
    .map((pr) => ({
      number: pr.number,
      title: String(pr.title || ""),
      state: String(pr.state || ""),
      createdAt: pr.createdAt || null,
      updatedAt: pr.updatedAt || null,
      author: pr.author?.login || "",
      headRefName: pr.headRefName || "",
    }));
  const issues = parseJsonArray(issueResult.ok ? issueResult.stdout : "")
    .filter((issue) => inWindow(issue.updatedAt || issue.createdAt))
    .map((issue) => ({
      number: issue.number,
      title: String(issue.title || ""),
      state: String(issue.state || ""),
      createdAt: issue.createdAt || null,
      updatedAt: issue.updatedAt || null,
      author: issue.author?.login || "",
    }));
  const releases = parseJsonArray(releaseResult.ok ? releaseResult.stdout : "")
    .filter((release) => inWindow(release.publishedAt))
    .map((release) => ({
      tagName: release.tagName || "",
      name: release.name || "",
      publishedAt: release.publishedAt || null,
    }));
  return { connected: true, prs, issues, releases };
}

/// Best-effort Gemini CLI session events. Gemini stores per-project logs under
/// ~/.gemini/tmp/<sha256(projectRoot)>/logs.json with user prompts only, so
/// these sessions carry time ranges but no file edits (they usually land in
/// 미분류 unless prompt tokens match commit subjects).
export function geminiProjectHash(absWorkspace) {
  return crypto.createHash("sha256").update(String(absWorkspace || "")).digest("hex");
}

export async function collectGeminiAgentEvents({
  homeDir = os.homedir(),
  workspaceRoot,
  sinceMs = 0,
  fsImpl = fs,
} = {}) {
  const absWorkspace = path.resolve(String(workspaceRoot || "."));
  const logPath = path.join(homeDir, ".gemini", "tmp", geminiProjectHash(absWorkspace), "logs.json");
  let entries;
  try {
    entries = JSON.parse(await fsImpl.readFile(logPath, "utf8"));
  } catch {
    return [];
  }
  if (!Array.isArray(entries)) return [];
  const events = [];
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") continue;
    const ts = Date.parse(entry.timestamp || "");
    if (!Number.isFinite(ts) || ts < sinceMs) continue;
    if (String(entry.type || "").toLowerCase() !== "user") continue;
    events.push({
      provider: "gemini",
      ts,
      sessionId: entry.sessionId || null,
      kind: "prompt",
      text: String(entry.message || "").slice(0, 280),
    });
  }
  return events;
}

async function countFilesInDir({ root, dir, exts = null, fsImpl = fs } = {}) {
  const target = path.join(root, dir);
  let entries = [];
  try {
    entries = await fsImpl.readdir(target, { withFileTypes: true });
  } catch {
    return 0;
  }
  let count = 0;
  for (const entry of entries) {
    if (entry.name.startsWith(".")) continue;
    const fullRel = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      count += await countFilesInDir({ root, dir: fullRel, exts, fsImpl });
    } else if (!exts || exts.has(path.extname(entry.name).toLowerCase())) {
      count += 1;
    }
  }
  return count;
}

export async function collectWorkspaceEvidenceSignals({
  workspaceRoot,
  fsImpl = fs,
} = {}) {
  const root = path.resolve(String(workspaceRoot || "."));
  const textExts = new Set([".md", ".mdx", ".txt", ".json", ".jsonl", ".csv"]);
  const [agenticDocsCount, interviewCount, bipCount] = await Promise.all([
    countFilesInDir({ root, dir: ".agentic30/docs", exts: textExts, fsImpl }),
    countFilesInDir({ root, dir: "interviews", exts: textExts, fsImpl }),
    countFilesInDir({ root, dir: "bip", exts: textExts, fsImpl }),
  ]);
  const workspaceDocsCount = agenticDocsCount;
  let agenticStateCount = 0;
  try {
    const names = await fsImpl.readdir(path.join(root, ".agentic30"));
    agenticStateCount = names.filter((name) => /\.(json|jsonl)$/i.test(name)).length;
  } catch {
    agenticStateCount = 0;
  }
  return {
    workspaceDocsCount,
    interviewCount,
    bipCount,
    missionCount: agenticStateCount,
    curriculumCount: workspaceDocsCount > 0 ? 1 : 0,
  };
}

// ---------------------------------------------------------------------------
// Fingerprint (cheap change detection for tab-entry reindex)
// ---------------------------------------------------------------------------

export async function computeWorkHistoryFingerprint({ workspaceRoot, execImpl = defaultExec } = {}) {
  const cwd = path.resolve(String(workspaceRoot || "."));
  const head = await execImpl("git", ["log", "--all", "-1", "--format=%H"], { cwd });
  const headSha = head.ok ? head.stdout.trim() || null : null;
  return { headHash: sha256Short(headSha) };
}

// ---------------------------------------------------------------------------
// Public entry point
// ---------------------------------------------------------------------------

export async function refreshWorkHistory({
  workspaceRoot,
  homeDir = os.homedir(),
  now = new Date(),
  tzOffsetMinutes = now.getTimezoneOffset?.() ?? 0,
  reason = "manual",
  queryImpl = null,
  execImpl = defaultExec,
  fsImpl = fs,
  agentEventsImpl = collectAgentWorkEvents,
  geminiEventsImpl = collectGeminiAgentEvents,
  workspaceEvidenceImpl = collectWorkspaceEvidenceSignals,
  onProgress = () => {},
} = {}) {
  if (!workspaceRoot) {
    return emptyWorkHistorySnapshot({ now, tzOffsetMinutes });
  }
  const week = localWeekRange(now, { tzOffsetMinutes });

  onProgress({ stage: "collect_git", progressText: "git 커밋 활동을 읽는 중" });
  const gitPromise = collectGitCommitsForWeek({
    workspaceRoot,
    sinceMs: week.weekStartMs,
    untilMs: week.weekEndMs,
    execImpl,
  });
  onProgress({ stage: "collect_github", progressText: "GitHub(gh) 활동을 읽는 중" });
  const ghPromise = collectGhWeekActivity({
    workspaceRoot,
    sinceMs: week.weekStartMs,
    untilMs: week.weekEndMs,
    execImpl,
  });
  onProgress({ stage: "collect_sessions", progressText: "AI 세션 로그를 읽는 중" });
  const agentEventsPromise = Promise.resolve(
    agentEventsImpl({ workspaceRoot, homeDir, sinceMs: week.weekStartMs, now }),
  ).catch(() => []);
  const geminiEventsPromise = Promise.resolve(
    geminiEventsImpl({ homeDir, workspaceRoot, sinceMs: week.weekStartMs, fsImpl }),
  ).catch(() => []);
  const workspaceEvidencePromise = Promise.resolve(
    workspaceEvidenceImpl({ workspaceRoot, fsImpl }),
  ).catch(() => ({}));

  const [git, github, agentEvents, geminiEvents, workspaceEvidence] = await Promise.all([
    gitPromise,
    ghPromise,
    agentEventsPromise,
    geminiEventsPromise,
    workspaceEvidencePromise,
  ]);

  onProgress({ stage: "assemble", progressText: "기능 영역과 요일별 타임라인을 구성 중" });
  const sessions = sessionsFromAgentEvents([...agentEvents, ...geminiEvents]);
  const deterministic = buildWeeklyWorkHistorySnapshot({
    now,
    tzOffsetMinutes,
    sessions,
    commits: git.commits,
    github,
    headSha: git.headSha,
    workspaceEvidence,
    reason,
  });

  // Skip the agent refinement pass while GitHub is required — the tab gates
  // on connection anyway, so spending provider tokens would be wasted.
  const refineQueryImpl = github.connected ? queryImpl : null;
  if (refineQueryImpl) {
    onProgress({ stage: "refine", progressText: "코치 요약을 다듬는 중" });
  }
  const snapshot = await composeWorkHistorySnapshot({ deterministic, queryImpl: refineQueryImpl });
  await persistWorkHistorySnapshot({ workspaceRoot, snapshot, fsImpl });
  return snapshot;
}

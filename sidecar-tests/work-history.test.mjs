import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  WORK_HISTORY_SCHEMA_VERSION,
  localWeekRange,
  toLocalDayKey,
  sessionMinutesOnDay,
  sessionsFromAgentEvents,
  gitLogFormatArgs,
  parseGitLog,
  isBotAuthor,
  linkSessionsToCommits,
  areaKeyForPath,
  inferFeatureAreas,
  buildAreaDaySummary,
  buildNextActions,
  buildWorkHistoryRetrospective,
  normalizeWorkHistoryRetrospective,
  collectWorkspaceEvidenceSignals,
  buildWeeklyWorkHistorySnapshot,
  emptyWorkHistorySnapshot,
  applyWorkHistoryRefinement,
  buildWorkHistoryRefinementPrompt,
  parseWorkHistoryRefinement,
  composeWorkHistorySnapshot,
  resolveWorkHistoryCachePath,
  persistWorkHistorySnapshot,
  loadWorkHistorySnapshot,
  collectGitCommitsForWeek,
  collectGhWeekActivity,
  collectGeminiAgentEvents,
  geminiProjectHash,
  refreshWorkHistory,
} from "../sidecar/work-history.mjs";

// KST is UTC+9 → Date#getTimezoneOffset() === -540.
const KST = -540;

// ---------------------------------------------------------------------------
// Week range (Mac local timezone, Monday–Sunday)
// ---------------------------------------------------------------------------

test("localWeekRange pins Monday–Sunday in the local timezone", () => {
  // 2026-06-05 is a Friday (KST). Week must be Mon 06-01 → Sun 06-07.
  const now = new Date("2026-06-05T03:00:00+09:00");
  const week = localWeekRange(now, { tzOffsetMinutes: KST });
  assert.equal(week.weekStart, "2026-06-01");
  assert.equal(week.weekEnd, "2026-06-07");
  assert.equal(week.dayKeys.length, 7);
  assert.equal(week.dayKeys[0], "2026-06-01");
  assert.equal(week.dayKeys[6], "2026-06-07");
  // Week start = local Monday midnight = 2026-05-31T15:00:00Z.
  assert.equal(new Date(week.weekStartMs).toISOString(), "2026-05-31T15:00:00.000Z");
  assert.equal(week.weekEndMs - week.weekStartMs, 7 * 86_400_000);
});

test("localWeekRange handles Sunday as the last day of the week", () => {
  // Sunday local — still belongs to the week starting the previous Monday.
  const sunday = new Date("2026-06-07T23:30:00+09:00");
  const week = localWeekRange(sunday, { tzOffsetMinutes: KST });
  assert.equal(week.weekStart, "2026-06-01");
  // Monday boundary: Monday 00:00 local belongs to the new week.
  const mondayMidnight = new Date("2026-06-08T00:00:00+09:00");
  const next = localWeekRange(mondayMidnight, { tzOffsetMinutes: KST });
  assert.equal(next.weekStart, "2026-06-08");
});

test("toLocalDayKey converts UTC instants into local day keys", () => {
  // 2026-06-01T23:30Z = 2026-06-02 08:30 KST.
  assert.equal(toLocalDayKey(Date.parse("2026-06-01T23:30:00Z"), KST), "2026-06-02");
  assert.equal(toLocalDayKey(Number.NaN, KST), "");
});

// ---------------------------------------------------------------------------
// Sessions: tool-recorded id, first→last event wall-clock, midnight split
// ---------------------------------------------------------------------------

test("sessionsFromAgentEvents groups by provider:sessionId with wall-clock bounds", () => {
  const t0 = Date.parse("2026-06-02T10:00:00+09:00");
  const sessions = sessionsFromAgentEvents([
    { provider: "claude", sessionId: "s1", ts: t0 + 5 * 60_000, kind: "command", cmd: "npm test" },
    { provider: "claude", sessionId: "s1", ts: t0, kind: "prompt", text: "fix sidecar route" },
    { provider: "claude", sessionId: "s1", ts: t0 + 30 * 60_000, kind: "file_edit", path: "sidecar/index.mjs" },
    { provider: "codex", sessionId: "s2", ts: t0 + 60_000, kind: "prompt", text: "hello" },
  ]);
  assert.equal(sessions.length, 2);
  const claude = sessions.find((s) => s.provider === "claude");
  assert.equal(claude.startTs, t0);
  assert.equal(claude.endTs, t0 + 30 * 60_000);
  assert.deepEqual(claude.files, ["sidecar/index.mjs"]);
  assert.deepEqual(claude.prompts, ["fix sidecar route"]);
});

test("sessionMinutesOnDay splits a midnight-crossing session across days", () => {
  const now = new Date("2026-06-05T12:00:00+09:00");
  const week = localWeekRange(now, { tzOffsetMinutes: KST });
  // Tue 23:00 → Wed 01:00 KST.
  const start = Date.parse("2026-06-02T23:00:00+09:00");
  const end = Date.parse("2026-06-03T01:00:00+09:00");
  assert.equal(sessionMinutesOnDay(start, end, week, 1), 60); // Tuesday slice
  assert.equal(sessionMinutesOnDay(start, end, week, 2), 60); // Wednesday slice
  assert.equal(sessionMinutesOnDay(start, end, week, 3), 0);
});

// ---------------------------------------------------------------------------
// git log parsing
// ---------------------------------------------------------------------------

const RS = "\u001e";
const US = "\u001f";

function gitLogFixture() {
  return [
    `${RS}aaa111${US}October${US}me@example.com${US}2026-06-02T14:00:00+09:00${US}feat(sidecar): add route`,
    "10\t2\tsidecar/index.mjs",
    "3\t0\tsidecar/work-history.mjs",
    "",
    `${RS}bbb222${US}Other Dev${US}other@example.com${US}2026-06-03T09:00:00+09:00${US}docs update`,
    "1\t1\tdocs/SPEC.md",
    "",
    `${RS}ccc333${US}dependabot[bot]${US}bot@github.com${US}2026-06-04T01:00:00+09:00${US}chore(deps): bump`,
    "-\t-\tpackage-lock.json",
  ].join("\n");
}

test("parseGitLog parses record/field separated --numstat output", () => {
  const commits = parseGitLog(gitLogFixture());
  assert.equal(commits.length, 3);
  assert.equal(commits[0].sha, "aaa111");
  assert.equal(commits[0].authorEmail, "me@example.com");
  assert.equal(commits[0].subject, "feat(sidecar): add route");
  assert.deepEqual(commits[0].files, ["sidecar/index.mjs", "sidecar/work-history.mjs"]);
  assert.equal(commits[0].additions, 13);
  assert.equal(commits[0].deletions, 2);
  // Binary numstat lines keep the file but contribute no counts.
  assert.deepEqual(commits[2].files, ["package-lock.json"]);
  assert.equal(commits[2].additions, 0);
});

test("gitLogFormatArgs scopes to --all branches inside the window", () => {
  const args = gitLogFormatArgs({ sinceIso: "2026-06-01T00:00:00Z", untilIso: "2026-06-08T00:00:00Z" });
  assert.ok(args.includes("--all"));
  assert.ok(args.includes("--numstat"));
  assert.ok(args.some((a) => a.startsWith("--since=2026-06-01")));
});

test("isBotAuthor flags bot-style authors", () => {
  assert.equal(isBotAuthor({ authorName: "dependabot[bot]", authorEmail: "x@y" }), true);
  assert.equal(isBotAuthor({ authorName: "October", authorEmail: "me@example.com" }), false);
});

// ---------------------------------------------------------------------------
// Linking (commit-centric) + unclassified fallback
// ---------------------------------------------------------------------------

function fixtureCommits() {
  return parseGitLog(gitLogFixture()).map((c) => ({
    ...c,
    isMine: c.authorEmail === "me@example.com",
  }));
}

test("linkSessionsToCommits links via file overlap and upgrades with token match", () => {
  const t = Date.parse("2026-06-02T13:00:00+09:00");
  const sessions = sessionsFromAgentEvents([
    { provider: "claude", sessionId: "linked", ts: t, kind: "prompt", text: "sidecar add route 작업" },
    { provider: "claude", sessionId: "linked", ts: t + 60_000, kind: "file_edit", path: "sidecar/index.mjs" },
    { provider: "claude", sessionId: "linked", ts: t + 120_000, kind: "file_edit", path: "sidecar/work-history.mjs" },
    { provider: "codex", sessionId: "loose", ts: t, kind: "prompt", text: "다른 작업" },
    { provider: "codex", sessionId: "loose", ts: t + 60_000, kind: "file_edit", path: "scripts/unrelated.mjs" },
  ]);
  const linked = linkSessionsToCommits(sessions, fixtureCommits());
  const strong = linked.find((s) => s.sessionId === "linked");
  assert.equal(strong.linked, true);
  assert.deepEqual(strong.linkedShas, ["aaa111"]);
  assert.equal(strong.linkConfidence, "high");
  const loose = linked.find((s) => s.sessionId === "loose");
  assert.equal(loose.linked, false);
  assert.equal(loose.linkConfidence, "none");
});

test("linkSessionsToCommits never links to other authors' or bot commits", () => {
  const t = Date.parse("2026-06-03T09:30:00+09:00");
  const sessions = sessionsFromAgentEvents([
    { provider: "claude", sessionId: "docs", ts: t, kind: "file_edit", path: "docs/SPEC.md" },
  ]);
  const linked = linkSessionsToCommits(sessions, fixtureCommits());
  assert.equal(linked[0].linked, false);
});

// ---------------------------------------------------------------------------
// Feature areas (heuristic)
// ---------------------------------------------------------------------------

test("areaKeyForPath clusters by top-level segment", () => {
  assert.equal(areaKeyForPath("sidecar/index.mjs"), "sidecar");
  assert.equal(areaKeyForPath("agentic30/ContentView.swift"), "agentic30");
  assert.equal(areaKeyForPath("README.md"), "workspace");
});

test("inferFeatureAreas builds areas from my commits and linked sessions", () => {
  const t = Date.parse("2026-06-02T13:00:00+09:00");
  const sessions = linkSessionsToCommits(
    sessionsFromAgentEvents([
      { provider: "claude", sessionId: "linked", ts: t, kind: "file_edit", path: "sidecar/index.mjs" },
    ]),
    fixtureCommits(),
  );
  const areas = inferFeatureAreas({ sessions, commits: fixtureCommits() });
  assert.equal(areas.length, 1); // others'/bot commits never create areas
  assert.equal(areas[0].id, "sidecar");
  assert.deepEqual(areas[0].commitShas, ["aaa111"]);
  assert.deepEqual(areas[0].sessionKeys, ["claude:linked"]);
  assert.equal(areas[0].inference, "heuristic");
});

// ---------------------------------------------------------------------------
// Coach copy + evidence-gated next actions
// ---------------------------------------------------------------------------

test("buildAreaDaySummary writes coach-tone copy from data only", () => {
  const text = buildAreaDaySummary({
    areaName: "sidecar",
    aiMinutes: 95,
    commitCount: 2,
    paths: ["sidecar/index.mjs"],
  });
  assert.ok(text.includes("sidecar"));
  assert.ok(text.includes("1시간 35분"));
  assert.ok(text.includes("커밋 2건"));
});

test("buildNextActions only emits evidence-backed actions", () => {
  const actions = buildNextActions({
    unclassifiedSessions: [
      { provider: "codex", start: "2026-06-02T13:00:00.000Z", end: "2026-06-02T14:00:00.000Z", paths: ["scripts/unrelated.mjs"] },
      { provider: "gemini", start: "x", end: "y", paths: [] }, // no file evidence → dropped
    ],
    openPrs: [{ number: 7, title: "History tab", state: "OPEN" }],
  });
  assert.equal(actions.length, 2);
  assert.ok(actions[0].evidence.includes("수정 파일 1개"));
  assert.ok(actions[1].evidence.includes("PR #7"));
});

// ---------------------------------------------------------------------------
// Weekly snapshot assembly
// ---------------------------------------------------------------------------

function fixtureSnapshot({ connected = true } = {}) {
  const now = new Date("2026-06-05T12:00:00+09:00");
  const t = Date.parse("2026-06-02T13:00:00+09:00");
  const sessions = sessionsFromAgentEvents([
    { provider: "claude", sessionId: "linked", ts: t, kind: "prompt", text: "sidecar add route" },
    { provider: "claude", sessionId: "linked", ts: t + 90 * 60_000, kind: "file_edit", path: "sidecar/index.mjs" },
    { provider: "codex", sessionId: "loose", ts: t, kind: "prompt", text: "다른 실험" },
    { provider: "codex", sessionId: "loose", ts: t + 30 * 60_000, kind: "file_edit", path: "scripts/unrelated.mjs" },
  ]);
  return buildWeeklyWorkHistorySnapshot({
    now,
    tzOffsetMinutes: KST,
    sessions,
    commits: fixtureCommits(),
    github: {
      connected,
      prs: [{ number: 7, title: "History tab", state: "OPEN", updatedAt: "2026-06-03T10:00:00+09:00", author: "zettalyst" }],
      issues: [],
      releases: [{ tagName: "v0.2.0", publishedAt: "2026-06-04T10:00:00+09:00" }],
    },
    headSha: "aaa111",
    reason: "manual",
  });
}

test("buildWeeklyWorkHistorySnapshot aggregates AI time into areas, commits as activity", () => {
  const snapshot = fixtureSnapshot();
  assert.equal(snapshot.schemaVersion, WORK_HISTORY_SCHEMA_VERSION);
  assert.equal(snapshot.schemaVersion, 2);
  assert.equal(snapshot.weekStart, "2026-06-01");
  assert.equal(snapshot.status.state, "ready");

  // AI session wall-clock only: 90m linked + 30m unclassified.
  assert.equal(snapshot.totals.aiMinutes, 120);
  assert.equal(snapshot.totals.unclassifiedMinutes, 30);
  assert.equal(snapshot.totals.myCommitCount, 1);
  assert.equal(snapshot.totals.otherCommitCount, 2);

  const sidecarArea = snapshot.areas.find((a) => a.id === "sidecar");
  assert.equal(sidecarArea.aiMinutes, 90);
  assert.equal(sidecarArea.commitCount, 1);

  // Tuesday holds the area day summary with references (paths + time ranges).
  const tuesday = snapshot.days.find((d) => d.date === "2026-06-02");
  assert.equal(tuesday.weekday, "화");
  assert.equal(tuesday.areas.length, 1);
  const dayArea = tuesday.areas[0];
  assert.equal(dayArea.aiMinutes, 90);
  assert.equal(dayArea.commitCount, 1);
  assert.ok(dayArea.summary.includes("1시간 30분"));
  assert.ok(dayArea.paths.includes("sidecar/index.mjs"));
  assert.equal(dayArea.sessionRanges.length, 1);
  assert.equal(dayArea.sessionRanges[0].provider, "claude");

  // Unclassified session is shown separately, not merged into an area.
  assert.equal(snapshot.unclassified.length, 1);
  assert.equal(snapshot.unclassified[0].provider, "codex");
  assert.equal(snapshot.unclassified[0].minutes, 30);

  // Others'/bots' commits + gh activity render as reference events.
  const wednesday = snapshot.days.find((d) => d.date === "2026-06-03");
  assert.ok(wednesday.referenceEvents.some((e) => e.kind === "other_commit"));
  assert.ok(wednesday.referenceEvents.some((e) => e.kind === "pr"));
  const thursday = snapshot.days.find((d) => d.date === "2026-06-04");
  assert.ok(thursday.referenceEvents.some((e) => e.kind === "release"));

  // Weekly coach summary: headline + evidence-gated next actions.
  assert.ok(snapshot.weekly.headline.includes("이번 주 AI 세션 2시간"));
  assert.ok(snapshot.weekly.nextActions.length >= 1);
  for (const action of snapshot.weekly.nextActions) {
    assert.ok(action.evidence);
  }
  assert.ok(snapshot.retrospective.headline);
  assert.equal(snapshot.retrospective.verdict, "close_loop");
  assert.ok(snapshot.retrospective.insights.length >= 1);
  assert.ok(snapshot.retrospective.insights.every((insight) => insight.evidenceRefs.length > 0));
  assert.ok(snapshot.retrospective.riskFlags.some((risk) => risk.id === "unclassified"));
  assert.ok(snapshot.retrospective.nextActions.some((action) => action.insightId === "unclassified-loop"));
  assert.ok(snapshot.retrospective.evidenceMix.some((source) => source.source === "ai_session" && source.count === 2));

  // Round 34: no raw prompt/output text is persisted anywhere.
  const serialized = JSON.stringify(snapshot);
  assert.ok(!serialized.includes("sidecar add route"));
  assert.ok(!serialized.includes("다른 실험"));
  assert.ok(!serialized.includes("npm test"));
  // Round 13 + v2: raw commit SHAs stay out of persisted/displayed snapshot.
  assert.ok(!serialized.includes("aaa111"));
  assert.ok(snapshot.fingerprint.headHash);
  assert.equal(snapshot.fingerprint.headSha, undefined);
});

test("buildWeeklyWorkHistorySnapshot reports github_required when gh is unavailable", () => {
  const snapshot = fixtureSnapshot({ connected: false });
  assert.equal(snapshot.status.state, "github_required");
  assert.equal(snapshot.github.connected, false);
});

test("emptyWorkHistorySnapshot carries seven weekday rows", () => {
  const empty = emptyWorkHistorySnapshot({ now: new Date("2026-06-05T12:00:00+09:00"), tzOffsetMinutes: KST });
  assert.equal(empty.days.length, 7);
  assert.deepEqual(empty.days.map((d) => d.weekday), ["월", "화", "수", "목", "금", "토", "일"]);
  assert.equal(empty.status.state, "empty");
  assert.equal(empty.retrospective.verdict, "continue");
  assert.equal(empty.retrospective.evidenceMix.length, 7);
});

// ---------------------------------------------------------------------------
// Agent refinement (optional, deterministic fallback)
// ---------------------------------------------------------------------------

test("applyWorkHistoryRefinement renames areas and rewrites text fields only", () => {
  const snapshot = fixtureSnapshot();
  const refined = applyWorkHistoryRefinement(snapshot, {
    areaNames: { sidecar: "사이드카 라우팅" },
    days: snapshot.days.map((d) => ({
      date: d.date,
      areas: d.areas.map((a) => ({
        areaId: a.areaId,
        summary: "라우팅 추가를 커밋까지 끝냈어요.",
        nextActions: [{ text: "라우트 테스트 보강", evidence: "sidecar/index.mjs 변경" }],
      })),
    })),
    weekly: { headline: "사이드카 주간", coachNotes: ["좋은 진척"], nextActions: [] },
  });
  const tuesday = refined.days.find((d) => d.date === "2026-06-02");
  assert.equal(tuesday.areas[0].name, "사이드카 라우팅");
  assert.equal(tuesday.areas[0].summary, "라우팅 추가를 커밋까지 끝냈어요.");
  assert.equal(tuesday.areas[0].nextActions[0].text, "라우트 테스트 보강");
  assert.equal(refined.weekly.headline, "사이드카 주간");
  // Numbers stay deterministic.
  assert.equal(tuesday.areas[0].aiMinutes, 90);
  assert.equal(refined.totals.aiMinutes, snapshot.totals.aiMinutes);
});

test("applyWorkHistoryRefinement discards retrospective insights without evidence refs", () => {
  const snapshot = fixtureSnapshot();
  const refined = applyWorkHistoryRefinement(snapshot, {
    retrospective: {
      headline: "회고 인사이트",
      verdict: "rebalance",
      insights: [
        { id: "no-evidence", claim: "근거 없는 주장", whyItMatters: "표시되면 안 됨", evidenceRefs: [] },
        { id: "with-evidence", claim: "근거 있는 주장", whyItMatters: "다음 행동을 바꿉니다.", confidence: "high", evidenceRefs: ["sidecar/index.mjs"] },
      ],
      riskFlags: [],
      nextActions: [{ text: "근거 있는 행동", evidence: "sidecar/index.mjs", insightId: "with-evidence" }],
      evidenceMix: [{ source: "ai_session", count: 999, status: "connected" }],
    },
  });

  assert.equal(refined.retrospective.headline, "회고 인사이트");
  assert.equal(refined.retrospective.verdict, "rebalance");
  assert.deepEqual(refined.retrospective.insights.map((insight) => insight.id), ["with-evidence"]);
  assert.equal(refined.retrospective.insights[0].confidence, "high");
  // Evidence mix is deterministic and cannot be rewritten by the provider pass.
  assert.equal(
    refined.retrospective.evidenceMix.find((item) => item.source === "ai_session").count,
    snapshot.retrospective.evidenceMix.find((item) => item.source === "ai_session").count,
  );
});

test("buildWorkHistoryRetrospective surfaces evidence mix and customer-evidence gap", () => {
  const snapshot = fixtureSnapshot();
  const retrospective = buildWorkHistoryRetrospective({
    snapshot,
    github: { connected: true, prs: [], issues: [], releases: [] },
    workspaceEvidence: { workspaceDocsCount: 2, interviewCount: 0, bipCount: 0, missionCount: 0, curriculumCount: 1 },
  });

  assert.ok(retrospective.insights.some((insight) => insight.id === "customer-evidence-gap"));
  assert.ok(retrospective.riskFlags.some((risk) => risk.id === "customer-evidence-gap"));
  assert.equal(retrospective.evidenceMix.find((item) => item.source === "workspace_docs").count, 2);
  assert.equal(retrospective.evidenceMix.find((item) => item.source === "interview").status, "missing");
});

test("normalizeWorkHistoryRetrospective falls back when all refined insights lack evidence", () => {
  const fallback = fixtureSnapshot().retrospective;
  const normalized = normalizeWorkHistoryRetrospective({
    headline: "bad refinement",
    insights: [{ id: "bad", claim: "bad", evidenceRefs: [] }],
  }, fallback);

  assert.equal(normalized.headline, "bad refinement");
  assert.deepEqual(normalized.insights.map((insight) => insight.id), fallback.insights.map((insight) => insight.id));
});

test("composeWorkHistorySnapshot falls back to deterministic on bad agent output", async () => {
  const snapshot = fixtureSnapshot();
  const broken = await composeWorkHistorySnapshot({
    deterministic: snapshot,
    queryImpl: async () => "not json at all",
  });
  assert.deepEqual(broken, snapshot);
  const throwing = await composeWorkHistorySnapshot({
    deterministic: snapshot,
    queryImpl: async () => {
      throw new Error("provider down");
    },
  });
  assert.deepEqual(throwing, snapshot);
});

test("parseWorkHistoryRefinement extracts JSON from fenced/verbose output", () => {
  const parsed = parseWorkHistoryRefinement('json\n{"areaNames":{"sidecar":"이름"}}\n');
  assert.deepEqual(parsed, { areaNames: { sidecar: "이름" } });
  assert.equal(parseWorkHistoryRefinement("no json"), null);
});

test("buildWorkHistoryRefinementPrompt embeds data without raw prompts", () => {
  const prompt = buildWorkHistoryRefinementPrompt(fixtureSnapshot());
  assert.ok(prompt.includes("strict JSON"));
  assert.ok(!prompt.includes("sidecar add route"));
});

// ---------------------------------------------------------------------------
// Persistence + staleness
// ---------------------------------------------------------------------------

test("persist/load round-trips and flags staleness by week and age", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-history-"));
  try {
    const snapshot = fixtureSnapshot();
    const cachePath = await persistWorkHistorySnapshot({ workspaceRoot: dir, snapshot });
    assert.equal(cachePath, resolveWorkHistoryCachePath(dir));

    // Fresh load within the hour and same week → not stale.
    const fresh = await loadWorkHistorySnapshot({
      workspaceRoot: dir,
      now: new Date(Date.parse(snapshot.generatedAt) + 10 * 60_000),
      tzOffsetMinutes: KST,
    });
    assert.equal(fresh.status.stale, false);
    assert.equal(fresh.totals.aiMinutes, 120);

    // Older than the hourly interval → stale.
    const aged = await loadWorkHistorySnapshot({
      workspaceRoot: dir,
      now: new Date(Date.parse(snapshot.generatedAt) + 2 * 60 * 60_000),
      tzOffsetMinutes: KST,
    });
    assert.equal(aged.status.stale, true);

    // Next week → stale regardless of age.
    const nextWeek = await loadWorkHistorySnapshot({
      workspaceRoot: dir,
      now: new Date("2026-06-09T12:00:00+09:00"),
      tzOffsetMinutes: KST,
    });
    assert.equal(nextWeek.status.stale, true);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadWorkHistorySnapshot migrates v1 cache to v2 with retrospective and hashed fingerprint", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-history-v1-"));
  try {
    const v1 = { ...fixtureSnapshot(), schemaVersion: 1, retrospective: undefined, fingerprint: { headSha: "aaa111" } };
    const cachePath = resolveWorkHistoryCachePath(dir);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify(v1));

    const loaded = await loadWorkHistorySnapshot({
      workspaceRoot: dir,
      now: new Date("2026-06-05T12:10:00+09:00"),
      tzOffsetMinutes: KST,
    });

    assert.equal(loaded.schemaVersion, 2);
    assert.ok(loaded.retrospective.headline);
    assert.ok(loaded.retrospective.evidenceMix.length >= 7);
    assert.ok(loaded.fingerprint.headHash);
    assert.equal(loaded.fingerprint.headSha, undefined);
    assert.equal(JSON.stringify(loaded).includes("aaa111"), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadWorkHistorySnapshot discards unknown schema versions", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-history-schema-"));
  try {
    const cachePath = resolveWorkHistoryCachePath(dir);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(cachePath, JSON.stringify({ schemaVersion: 999, totals: { aiMinutes: 777 } }));
    const loaded = await loadWorkHistorySnapshot({ workspaceRoot: dir, now: new Date(), tzOffsetMinutes: KST });
    assert.equal(loaded.status.state, "empty");
    assert.equal(loaded.totals.aiMinutes, 0);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// I/O collectors with injected exec
// ---------------------------------------------------------------------------

function fakeExec(responses) {
  const calls = [];
  const impl = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args.join(" ")}`;
    for (const [pattern, result] of responses) {
      if (key.includes(pattern)) return result;
    }
    return { ok: false, stdout: "" };
  };
  impl.calls = calls;
  return impl;
}

test("collectGitCommitsForWeek marks my commits by git config user.email", async () => {
  const execImpl = fakeExec([
    ["git log --all --no-merges", { ok: true, stdout: gitLogFixture() }],
    ["git config user.email", { ok: true, stdout: "me@example.com\n" }],
    ["git log --all -1", { ok: true, stdout: "aaa111\n" }],
  ]);
  const result = await collectGitCommitsForWeek({
    workspaceRoot: "/tmp/ws",
    sinceMs: Date.parse("2026-06-01T00:00:00+09:00"),
    untilMs: Date.parse("2026-06-08T00:00:00+09:00"),
    execImpl,
  });
  assert.equal(result.headSha, "aaa111");
  assert.equal(result.commits.filter((c) => c.isMine).length, 1);
  assert.equal(result.commits.find((c) => c.sha === "bbb222").isMine, false);
});

test("collectGhWeekActivity reports disconnected when gh auth fails", async () => {
  const execImpl = fakeExec([["gh auth status", { ok: false, stdout: "" }]]);
  const result = await collectGhWeekActivity({
    workspaceRoot: "/tmp/ws",
    sinceMs: 0,
    untilMs: Date.now() + 1,
    execImpl,
  });
  assert.equal(result.connected, false);
  // Never calls pr/issue/release listing without auth — only the auth probe.
  assert.equal(execImpl.calls.length, 1);
  assert.deepEqual(execImpl.calls[0].slice(0, 2), ["gh", "auth"]);
});

test("collectGhWeekActivity filters gh data to the week window", async () => {
  const execImpl = fakeExec([
    ["gh auth status", { ok: true, stdout: "ok" }],
    ["gh pr list", {
      ok: true,
      stdout: JSON.stringify([
        { number: 7, title: "in window", state: "OPEN", updatedAt: "2026-06-03T10:00:00+09:00", author: { login: "z" } },
        { number: 8, title: "out of window", state: "MERGED", updatedAt: "2026-05-01T10:00:00+09:00", author: { login: "z" } },
      ]),
    }],
    ["gh issue list", { ok: true, stdout: "[]" }],
    ["gh release list", { ok: true, stdout: "[]" }],
  ]);
  const week = localWeekRange(new Date("2026-06-05T12:00:00+09:00"), { tzOffsetMinutes: KST });
  const result = await collectGhWeekActivity({
    workspaceRoot: "/tmp/ws",
    sinceMs: week.weekStartMs,
    untilMs: week.weekEndMs,
    execImpl,
  });
  assert.equal(result.connected, true);
  assert.equal(result.prs.length, 1);
  assert.equal(result.prs[0].number, 7);
});

test("collectGeminiAgentEvents reads per-project logs.json best-effort", async () => {
  const home = await fs.mkdtemp(path.join(os.tmpdir(), "gemini-home-"));
  try {
    const workspace = "/tmp/gemini-ws";
    const dir = path.join(home, ".gemini", "tmp", geminiProjectHash(path.resolve(workspace)));
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(
      path.join(dir, "logs.json"),
      JSON.stringify([
        { sessionId: "g1", type: "user", message: "검색 붙여줘", timestamp: "2026-06-02T10:00:00+09:00" },
        { sessionId: "g1", type: "user", message: "old", timestamp: "2020-01-01T00:00:00Z" },
      ]),
    );
    const events = await collectGeminiAgentEvents({
      homeDir: home,
      workspaceRoot: workspace,
      sinceMs: Date.parse("2026-06-01T00:00:00Z"),
    });
    assert.equal(events.length, 1);
    assert.equal(events[0].provider, "gemini");
    assert.equal(events[0].sessionId, "g1");
  } finally {
    await fs.rm(home, { recursive: true, force: true });
  }
});

test("collectGeminiAgentEvents returns [] when logs are missing", async () => {
  const events = await collectGeminiAgentEvents({
    homeDir: "/nonexistent-home",
    workspaceRoot: "/tmp/nope",
    sinceMs: 0,
  });
  assert.deepEqual(events, []);
});

test("collectWorkspaceEvidenceSignals counts local evidence source files best-effort", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-history-evidence-"));
  try {
    await fs.mkdir(path.join(dir, "docs"), { recursive: true });
    await fs.mkdir(path.join(dir, "interviews"), { recursive: true });
    await fs.mkdir(path.join(dir, "bip"), { recursive: true });
    await fs.writeFile(path.join(dir, "docs", "SPEC.md"), "# spec");
    await fs.writeFile(path.join(dir, "interviews", "call.md"), "transcript");
    await fs.writeFile(path.join(dir, "bip", "post.json"), "{}");

    const signals = await collectWorkspaceEvidenceSignals({ workspaceRoot: dir });

    assert.equal(signals.workspaceDocsCount, 1);
    assert.equal(signals.interviewCount, 1);
    assert.equal(signals.bipCount, 1);
    assert.equal(signals.curriculumCount, 1);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ---------------------------------------------------------------------------
// refreshWorkHistory end-to-end with injected collaborators
// ---------------------------------------------------------------------------

test("refreshWorkHistory assembles and persists a snapshot from injected sources", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-history-refresh-"));
  try {
    const now = new Date("2026-06-05T12:00:00+09:00");
    const t = Date.parse("2026-06-02T13:00:00+09:00");
    const execImpl = fakeExec([
      ["git log --all --no-merges", { ok: true, stdout: gitLogFixture() }],
      ["git config user.email", { ok: true, stdout: "me@example.com\n" }],
      ["git log --all -1", { ok: true, stdout: "aaa111\n" }],
      ["gh auth status", { ok: true, stdout: "ok" }],
      ["gh pr list", { ok: true, stdout: "[]" }],
      ["gh issue list", { ok: true, stdout: "[]" }],
      ["gh release list", { ok: true, stdout: "[]" }],
    ]);
    const stages = [];
    const snapshot = await refreshWorkHistory({
      workspaceRoot: dir,
      now,
      tzOffsetMinutes: KST,
      reason: "manual",
      execImpl,
      agentEventsImpl: async () => [
        { provider: "claude", sessionId: "s", ts: t, kind: "file_edit", path: "sidecar/index.mjs" },
        { provider: "claude", sessionId: "s", ts: t + 45 * 60_000, kind: "command", cmd: "npm test" },
      ],
      geminiEventsImpl: async () => [],
      workspaceEvidenceImpl: async () => ({ workspaceDocsCount: 1, interviewCount: 1, bipCount: 0, missionCount: 0, curriculumCount: 1 }),
      onProgress: (p) => stages.push(p.stage),
    });
    assert.equal(snapshot.status.state, "ready");
    assert.equal(snapshot.totals.aiMinutes, 45);
    assert.ok(stages.includes("collect_git"));
    assert.ok(stages.includes("assemble"));

    const persisted = JSON.parse(await fs.readFile(resolveWorkHistoryCachePath(dir), "utf8"));
    assert.equal(persisted.schemaVersion, WORK_HISTORY_SCHEMA_VERSION);
    assert.equal(persisted.totals.aiMinutes, 45);
    assert.equal(persisted.retrospective.evidenceMix.find((item) => item.source === "interview").count, 1);
    assert.equal(JSON.stringify(persisted).includes("aaa111"), false);
    assert.equal(JSON.stringify(persisted).includes("npm test"), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("refreshWorkHistory survives failing collectors with an empty-but-valid snapshot", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "work-history-fail-"));
  try {
    const snapshot = await refreshWorkHistory({
      workspaceRoot: dir,
      now: new Date("2026-06-05T12:00:00+09:00"),
      tzOffsetMinutes: KST,
      execImpl: async () => ({ ok: false, stdout: "" }),
      agentEventsImpl: async () => {
        throw new Error("agent log unreadable");
      },
      geminiEventsImpl: async () => {
        throw new Error("gemini log unreadable");
      },
    });
    assert.equal(snapshot.status.state, "github_required");
    assert.equal(snapshot.totals.aiMinutes, 0);
    assert.equal(snapshot.days.length, 7);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

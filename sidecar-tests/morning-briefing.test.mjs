import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  MORNING_BRIEFING_SCHEMA_VERSION,
  buildMorningBriefing,
  buildMorningBriefingActions,
  buildMorningBriefingCards,
  buildMorningBriefingConnectGuide,
  buildMorningBriefingEvidenceFunnel,
  buildMorningBriefingSummary,
  buildCustomerEvidenceVerdict,
  buildMorningBriefingTimeline,
  detectMorningBriefingAnomaly,
  extractMorningBriefingMetrics,
  labelMorningBriefingAnomaly,
  loadMorningBriefingStore,
  appendMorningBriefingRunLog,
  persistMorningBriefing,
  resolveMorningBriefingRunLogPath,
  resolveMorningBriefingPath,
  sanitizeMorningBriefingRunLogRecord,
  updatePersistedMorningBriefing,
} from "../sidecar/morning-briefing.mjs";

const NOW = new Date("2026-06-10T09:00:00+09:00");
const PREVIOUS_METRICS = Object.freeze({ cloudflare: 41, github: 6, posthog: 25 });

function previousHistory(metrics = PREVIOUS_METRICS) {
  return [{ date: "2026-06-09", generatedAt: "2026-06-09T09:00:00", metrics }];
}

function digestFixture({
  posthogActive = 11,
  cloudflareVisits = 64,
  gitCommits = 9,
  buildWithoutCustomerEvidence = false,
  posthogState = "ready",
  cloudflareState = "ready",
} = {}) {
  return {
    schemaVersion: 1,
    day: 12,
    window: {
      startIso: "2026-06-09T00:00:00.000Z",
      untilIso: "2026-06-10T00:00:00.000Z",
      label: "2026-06-09 00:00 -> 2026-06-10 now",
    },
    buildWithoutCustomerEvidence,
    sources: [
      {
        id: "git",
        label: "git",
        state: "ready",
        selected: true,
        detail: "git log/status live query succeeded",
        counts: { commits: gitCommits, additions: 412, deletions: 138, uncommittedChanges: 3 },
        highlights: [`git 커밋 ${gitCommits}건`],
        summary: `git 커밋 ${gitCommits}건`,
        goalSignals: [],
        evidenceGaps: [],
        events: [
          { at: "2026-06-09T18:12:00.000Z", text: "커밋 · feat: onboarding step trim" },
          { at: "2026-06-09T22:40:00.000Z", text: "커밋 · fix: retention event" },
        ],
      },
      {
        id: "gh_cli",
        label: "gh CLI",
        state: "ready",
        selected: true,
        detail: "gh CLI live query succeeded",
        counts: { prs: 2, openPrs: 1, mergedPrs: 1, issues: 0, releases: 1 },
        highlights: ["PR 업데이트 2건 · open 1건 · merged 1건"],
        summary: "PR 업데이트 2건",
        goalSignals: [],
        evidenceGaps: [],
        events: [{ at: "2026-06-09T18:30:00.000Z", text: "PR #43 open · 리텐션 이벤트 보강" }],
      },
      {
        id: "posthog",
        label: "PostHog",
        state: posthogState,
        selected: posthogState === "ready",
        detail: posthogState === "ready" ? "external MCP digest succeeded" : "PostHog MCP key is missing or invalid",
        counts: posthogState === "ready" ? { events: 188, activeUsers: posthogActive, conversions: 2 } : {},
        highlights: posthogState === "ready" ? ["활성 사용자 추이 하락"] : [],
        summary: posthogState === "ready" ? "활성 사용자 추이 하락" : "",
        goalSignals: posthogState === "ready" ? ["activation 완료 사용자 2명"] : [],
        evidenceGaps: posthogState === "ready" ? ["온보딩 2단계 이탈 원인 미확인"] : [],
        events: [],
      },
      {
        id: "cloudflare",
        label: "Cloudflare",
        state: cloudflareState,
        selected: cloudflareState === "ready",
        detail: cloudflareState === "ready" ? "external MCP digest succeeded" : "Cloudflare MCP token is missing",
        counts: cloudflareState === "ready" ? { visits: cloudflareVisits, pageviews: 188 } : {},
        highlights: cloudflareState === "ready" ? ["방문 증가"] : [],
        summary: cloudflareState === "ready" ? "방문 증가" : "",
        goalSignals: [],
        evidenceGaps: [],
        events: [],
      },
    ],
    briefing: {
      goalStatus: ["30일 목표는 Day 1에서 고른 goalType을 기준으로 유지합니다."],
      overnightChanges: ["git: git 커밋 9건", "Cloudflare: 방문 증가"],
      goalHelpfulSignals: ["PostHog: activation 완료 사용자 2명"],
      biggestEvidenceGap: ["PostHog: 온보딩 2단계 이탈 원인 미확인"],
    },
  };
}

test("extractMorningBriefingMetrics maps digest counts to card metrics", () => {
  const metrics = extractMorningBriefingMetrics({ sources: digestFixture().sources });
  assert.deepEqual(metrics, { cloudflare: 64, github: 9, posthog: 11 });
});

test("buildMorningBriefingCards computes deltas against previous metrics", () => {
  const cards = buildMorningBriefingCards({
    digest: digestFixture(),
    previousMetrics: PREVIOUS_METRICS,
    history: [
      { date: "2026-06-08", generatedAt: "2026-06-08T09:30:00", metrics: { cloudflare: 38 } },
      { date: "2026-06-09", metrics: PREVIOUS_METRICS },
    ],
    generatedAt: "2026-06-10T09:00:00",
  });
  assert.deepEqual(cards.map((card) => card.id), ["cloudflare", "github", "posthog"]);

  const cloudflare = cards[0];
  assert.equal(cloudflare.state, "ready");
  assert.equal(cloudflare.metric.value, 64);
  assert.equal(cloudflare.metric.direction, "up");
  assert.equal(cloudflare.metric.deltaLabel, "▲ 56%");
  assert.equal(cloudflare.metric.versusLabel, "어제 41");
  assert.deepEqual(cloudflare.spark, [38, 41, 64]);
  assert.deepEqual(
    cloudflare.sparkPoints.map((point) => point.value),
    cloudflare.spark,
  );
  assert.equal(cloudflare.sparkPoints[0].timeLabel, "06-08 09:30");
  assert.equal(cloudflare.sparkPoints[1].timeLabel, "어제");
  assert.equal(cloudflare.sparkPoints[2].timeLabel, "오늘 09:00");
  assert.ok(cloudflare.sparkPoints[0].at);
  assert.equal(cloudflare.sparkPoints[1].at, null);
  assert.ok(cloudflare.sparkPoints[2].at);

  const github = cards[1];
  assert.equal(github.metric.value, 9);
  assert.equal(github.metric.direction, "up");
  assert.deepEqual(
    github.rows.map((row) => row.k),
    ["PR 업데이트", "PR 머지", "릴리즈"],
  );

  const posthog = cards[2];
  assert.equal(posthog.metric.direction, "down");
  assert.equal(posthog.metric.deltaLabel, "▼ 56%");
  assert.equal(posthog.noteTone, "warn");
});

test("buildMorningBriefingCards fails when previous metrics lack sparkline history", () => {
  assert.throws(
    () => buildMorningBriefingCards({
      digest: digestFixture({ cloudflareVisits: 289, gitCommits: 78, posthogActive: 1 }),
      previousMetrics: { cloudflare: 289, github: 78, posthog: 1 },
      history: [],
      generatedAt: "2026-06-10T09:00:00",
    }),
    /Morning briefing sparkline history missing for cloudflare/,
  );
});

test("buildMorningBriefingCards uses explicit history without duplicate previous metric", () => {
  const cards = buildMorningBriefingCards({
    digest: digestFixture(),
    previousMetrics: { cloudflare: 41 },
    history: [{ date: "2026-06-09", generatedAt: "2026-06-09T09:00:00", metrics: { cloudflare: 41 } }],
    generatedAt: "2026-06-10T09:00:00",
  });
  const cloudflare = cards.find((card) => card.id === "cloudflare");

  assert.deepEqual(cloudflare.spark, [41, 64]);
  assert.deepEqual(
    cloudflare.sparkPoints.map((point) => point.value),
    [41, 64],
  );
});

test("buildMorningBriefingCards labels spark points by local date across the UTC boundary", () => {
  const originalTZ = process.env.TZ;
  process.env.TZ = "Asia/Seoul";
  try {
    const cards = buildMorningBriefingCards({
      digest: digestFixture({ cloudflareVisits: 288, gitCommits: 30, posthogActive: 0 }),
      previousMetrics: { cloudflare: 303, github: 78, posthog: 1 },
      history: [
        {
          date: "2026-06-14",
          generatedAt: "2026-06-14T12:42:00.000Z",
          metrics: { cloudflare: 303, github: 78, posthog: 1 },
        },
      ],
      generatedAt: "2026-06-14T18:38:00.000Z",
    });

    const cloudflare = cards.find((card) => card.id === "cloudflare");
    assert.equal(cloudflare.sparkPoints[0].timeLabel, "어제 21:42");
    assert.equal(cloudflare.sparkPoints[1].timeLabel, "오늘 03:38");
  } finally {
    if (originalTZ === undefined) {
      delete process.env.TZ;
    } else {
      process.env.TZ = originalTZ;
    }
  }
});

test("buildMorningBriefingCards rejects legacy Cloudflare pageViews counts", () => {
  const digest = digestFixture();
  const cloudflareSource = digest.sources.find((source) => source.id === "cloudflare");
  cloudflareSource.counts = { visits: 259, pageviews: 191, pageViews: 999, requests: 500 };

  assert.throws(
    () => buildMorningBriefingCards({ digest }),
    /counts\.pageViews.*counts\.pageviews/,
  );

  delete cloudflareSource.counts.pageViews;
  const cloudflare = buildMorningBriefingCards({ digest }).find((card) => card.id === "cloudflare");
  assert.deepEqual(cloudflare.rows, [
    { k: "페이지뷰", v: "191" },
    { k: "요청", v: "500" },
  ]);

  cloudflareSource.counts = { visits: 259, pageviews: 191 };
  const canonicalOnly = buildMorningBriefingCards({ digest }).find((card) => card.id === "cloudflare");
  assert.deepEqual(canonicalOnly.rows, [{ k: "페이지뷰", v: "191" }]);
});

test("buildMorningBriefingCards marks unconnected sources without metrics", () => {
  const cards = buildMorningBriefingCards({
    digest: digestFixture({ posthogState: "missing", cloudflareState: "missing" }),
    previousMetrics: {},
    history: [],
  });
  const posthog = cards.find((card) => card.id === "posthog");
  assert.equal(posthog.state, "missing");
  assert.equal(posthog.metric.value, null);
  assert.deepEqual(posthog.spark, []);
});

test("buildMorningBriefingCards renders failed Cloudflare collection separately from connection state", () => {
  const digest = digestFixture({ cloudflareState: "failed" });
  const cloudflareSource = digest.sources.find((source) => source.id === "cloudflare");
  cloudflareSource.selected = true;
  cloudflareSource.detail = "external MCP digest failed";

  const cards = buildMorningBriefingCards({ digest });
  const cloudflare = cards.find((card) => card.id === "cloudflare");

  assert.equal(cloudflare.state, "failed");
  assert.equal(cloudflare.metric.value, null);
  assert.equal(cloudflare.noteTone, "warn");
  assert.equal(cloudflare.note, "Cloudflare Analytics 집계를 완료하지 못했어요 — MCP 연결은 정상이에요.");
});

test("buildMorningBriefingSummary leads with the biggest drop", () => {
  const digest = digestFixture();
  const cards = buildMorningBriefingCards({
    digest,
    previousMetrics: PREVIOUS_METRICS,
    history: previousHistory(),
  });
  const summary = buildMorningBriefingSummary({ digest, cards, window: digest.window });
  assert.ok(summary.statement.startsWith("밤사이 가장 큰 변화는 PostHog"));
  assert.ok(summary.crits.length >= 2);
  assert.equal(summary.windowLabel, "2026-06-09 00:00 -> 2026-06-10 now");
});

test("buildMorningBriefingTimeline merges timestamped source events in order", () => {
  const timeline = buildMorningBriefingTimeline({ digest: digestFixture() });
  assert.equal(timeline.length, 3);
  assert.deepEqual(
    timeline.map((event) => event.source),
    ["github", "github", "github"],
  );
  assert.ok(Date.parse(timeline[0].at) < Date.parse(timeline[2].at));
  assert.ok(timeline.every((event) => event.timeLabel.match(/^\d{2}:\d{2}$/)));
});

test("buildMorningBriefingTimeline keeps standalone tags and failed workflows while deduping release tags", () => {
  const digest = digestFixture();
  digest.sources = [
    {
      id: "git",
      state: "ready",
      events: [
        { at: "2026-06-14T13:10:55.000Z", text: "태그 v20260614-2210 생성" },
        { at: "2026-06-14T13:57:03.000Z", text: "태그 v20260614-2257 생성" },
      ],
    },
    {
      id: "gh_cli",
      state: "ready",
      events: [
        { at: "2026-06-14T13:39:14.000Z", text: "배포 실패 · Release · v20260614-2210" },
        { at: "2026-06-14T13:56:46.000Z", text: "체크 실패 · Secret Scanning · main" },
        { at: "2026-06-14T14:11:36.000Z", text: "배포 성공 · Release · v20260614-2257" },
        { at: "2026-06-14T14:11:36.000Z", text: "릴리즈 v20260614-2257 배포" },
      ],
    },
  ];

  const texts = buildMorningBriefingTimeline({ digest }).map((event) => event.text);

  assert.ok(texts.includes("태그 v20260614-2210 생성"));
  assert.ok(texts.includes("배포 실패 · Release · v20260614-2210"));
  assert.ok(texts.includes("체크 실패 · Secret Scanning · main"));
  assert.ok(texts.includes("릴리즈 v20260614-2257 배포"));
  assert.ok(!texts.includes("태그 v20260614-2257 생성"));
  assert.ok(!texts.includes("배포 성공 · Release · v20260614-2257"));
});

test("buildMorningBriefingTimeline falls back to overnight highlights without events", () => {
  const digest = digestFixture();
  digest.sources = digest.sources.map((source) => ({ ...source, events: [] }));
  const timeline = buildMorningBriefingTimeline({ digest });
  assert.equal(timeline.length, 2);
  assert.equal(timeline[0].timeLabel, "밤사이");
});

test("detectMorningBriefingAnomaly flags a >=25% metric drop with labeling options", () => {
  const digest = digestFixture();
  const cards = buildMorningBriefingCards({
    digest,
    previousMetrics: PREVIOUS_METRICS,
    history: previousHistory(),
  });
  const anomaly = detectMorningBriefingAnomaly({ digest, cards });
  assert.equal(anomaly.kind, "metric_drop");
  assert.equal(anomaly.id, "metric_drop_posthog");
  assert.equal(anomaly.options.length, 4);
  assert.equal(anomaly.label, null);
});

test("detectMorningBriefingAnomaly flags build-without-evidence when no metric drop", () => {
  const digest = digestFixture({ buildWithoutCustomerEvidence: true });
  const cards = buildMorningBriefingCards({
    digest,
    previousMetrics: { cloudflare: 41, github: 6, posthog: 10 },
    history: previousHistory({ cloudflare: 41, github: 6, posthog: 10 }),
  });
  const anomaly = detectMorningBriefingAnomaly({ digest, cards });
  assert.equal(anomaly.kind, "build_without_evidence");
  assert.equal(anomaly.options.length, 4);
});

test("detectMorningBriefingAnomaly returns null on calm mornings", () => {
  const digest = digestFixture();
  const cards = buildMorningBriefingCards({
    digest,
    previousMetrics: { cloudflare: 41, github: 6, posthog: 11 },
    history: previousHistory({ cloudflare: 41, github: 6, posthog: 11 }),
  });
  assert.equal(detectMorningBriefingAnomaly({ digest, cards }), null);
});

test("buildMorningBriefingActions always returns message, experiment, and task drafts", () => {
  const digest = digestFixture();
  const actions = buildMorningBriefingActions({ digest, anomaly: null });
  assert.deepEqual(actions.map((action) => action.kind), ["message", "experiment", "task"]);
  assert.ok(actions[0].copyText.includes("zettalyst"));
  assert.ok(actions[1].copyText.includes("가설"));
  assert.equal(actions[2].tasks.length, 3);
  assert.ok(actions.every((action) => action.why && action.applyLabel));
});

test("buildMorningBriefingEvidenceFunnel and verdict prioritize customer evidence gaps", () => {
  const digest = digestFixture({ posthogActive: 1, gitCommits: 55, cloudflareVisits: 261 });
  const posthog = digest.sources.find((source) => source.id === "posthog");
  posthog.counts = { events: 26, activeUsers: 1, conversions: 0, signups: 0, installs: 9, scanCompleted: 2, officeHoursCompleted: 2, payments: 0 };
  const funnel = buildMorningBriefingEvidenceFunnel({ digest });
  assert.deepEqual(
    funnel.steps.map((step) => step.id),
    ["traffic", "download_install", "workspace_scan", "validation_action", "payment"],
  );
  assert.equal(funnel.steps[0].value, 261);
  assert.equal(funnel.steps[1].value, 9);
  assert.equal(funnel.steps[4].status, "missing");

  const verdict = buildCustomerEvidenceVerdict({ digest, cards: [], evidenceFunnel: funnel });
  assert.equal(verdict.state, "instrumentation_gap");
  assert.match(verdict.title, /고객 증거\/activation 계측/);
  assert.equal(verdict.primaryActionId, "task");
  assert.ok(verdict.evidence.some((line) => line.includes("전환 0건")));

  const actions = buildMorningBriefingActions({ digest, customerEvidenceVerdict: verdict });
  assert.equal(actions[2].id, "task");
  assert.match(actions[2].tasks[0].title, /activation\/signup/);
});

test("buildMorningBriefing assembles the full payload", () => {
  const digest = digestFixture();
  const briefing = buildMorningBriefing({
    digest,
    day: 12,
    previous: { metrics: PREVIOUS_METRICS },
    history: previousHistory(),
    now: NOW,
  });
  assert.equal(briefing.schemaVersion, MORNING_BRIEFING_SCHEMA_VERSION);
  assert.equal(briefing.day, 12);
  assert.equal(briefing.totalDays, 30);
  assert.equal(briefing.cards.length, 3);
  assert.equal(briefing.sync.sources.length, 4);
  assert.equal(briefing.sync.readyCount, 3);
  assert.equal(briefing.status.state, "ready");
  assert.equal(briefing.anomaly.kind, "metric_drop");
  assert.equal(briefing.actions.length, 3);
  assert.equal(briefing.customerEvidenceVerdict.state, "healthy");
  assert.equal(briefing.evidenceFunnel.steps.length, 5);
  assert.deepEqual(briefing.metrics, { cloudflare: 64, github: 9, posthog: 11 });
  assert.deepEqual(briefing.cards[0].sparkPoints.map((point) => point.value), [41, 64]);
  assert.equal(briefing.cards[0].sparkPoints[1].at, briefing.generatedAt);
  assert.deepEqual(briefing.historyDates, ["2026-06-09"]);
});

test("buildMorningBriefing reports empty status when nothing is connected", () => {
  const briefing = buildMorningBriefing({
    digest: { sources: [], briefing: {} },
    day: 5,
    now: NOW,
  });
  assert.equal(briefing.status.state, "empty");
  assert.equal(briefing.cards.every((card) => card.state === "missing"), true);
});

test("labelMorningBriefingAnomaly stamps the label and time", () => {
  const digest = digestFixture();
  const briefing = buildMorningBriefing({
    digest,
    day: 12,
    previous: { metrics: { posthog: 25 } },
    history: previousHistory({ posthog: 25 }),
    now: NOW,
  });
  const labeled = labelMorningBriefingAnomaly(briefing, "실제 이탈이다", { now: NOW });
  assert.equal(labeled.anomaly.label, "실제 이탈이다");
  assert.equal(labeled.anomaly.labeledAt, NOW.toISOString());
  assert.equal(labelMorningBriefingAnomaly(briefing, "").anomaly.label, null);
});

test("persistMorningBriefing keeps one history entry per local date and round-trips", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mb-test-"));
  try {
    const digest = digestFixture();
    const first = buildMorningBriefing({ digest, day: 11, now: new Date("2026-06-09T09:00:00+09:00") });
    await persistMorningBriefing({ workspaceRoot: dir, briefing: first });
    const second = buildMorningBriefing({
      digest,
      day: 12,
      // posthog 25 → 11 drop keeps an anomaly present for the labeling round-trip below.
      previous: { metrics: { ...first.metrics, posthog: 25 } },
      history: previousHistory({ ...first.metrics, posthog: 25 }),
      now: NOW,
    });
    await persistMorningBriefing({ workspaceRoot: dir, briefing: second });
    // Re-persisting the same date replaces, never duplicates.
    await persistMorningBriefing({ workspaceRoot: dir, briefing: second });

    const store = await loadMorningBriefingStore({ workspaceRoot: dir });
    assert.equal(store.current.day, 12);
    // The last different-date briefing is kept as "어제 브리핑"; a same-date
    // re-persist replaces current without demoting it to previous.
    assert.equal(store.previous.day, 11);
    assert.deepEqual(store.history.map((entry) => entry.date), ["2026-06-09", "2026-06-10"]);
    assert.deepEqual(store.history.map((entry) => entry.generatedAt), [first.generatedAt, second.generatedAt]);
    assert.equal(resolveMorningBriefingPath(dir).endsWith(".agentic30/morning-briefing.json"), true);

    const updated = await updatePersistedMorningBriefing({
      workspaceRoot: dir,
      update: (current) => labelMorningBriefingAnomaly(current, "추적 누락이다", { now: NOW }),
    });
    assert.equal(updated.anomaly.label, "추적 누락이다");
    const reloaded = await loadMorningBriefingStore({ workspaceRoot: dir });
    assert.equal(reloaded.current.anomaly.label, "추적 누락이다");
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("same-day refresh can persist a newer snapshot from fresh git data when external sources fail", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mb-refresh-"));
  try {
    const oldBriefing = buildMorningBriefing({
      digest: digestFixture({ gitCommits: 4, posthogActive: 2, cloudflareVisits: 10 }),
      day: 1,
      now: new Date("2026-06-14T10:21:41.000Z"),
    });
    await persistMorningBriefing({ workspaceRoot: dir, briefing: oldBriefing });
    const store = await loadMorningBriefingStore({ workspaceRoot: dir });
    const nextBriefing = buildMorningBriefing({
      digest: digestFixture({
        gitCommits: 12,
        posthogState: "failed",
        cloudflareState: "failed",
      }),
      day: 1,
      now: new Date("2026-06-14T12:30:00.000Z"),
      previous: {
        metrics: store.current.metrics,
        generatedAt: store.current.generatedAt,
      },
      history: store.history,
    });
    await persistMorningBriefing({ workspaceRoot: dir, briefing: nextBriefing });
    const reloaded = await loadMorningBriefingStore({ workspaceRoot: dir });

    assert.equal(reloaded.current.generatedAt, "2026-06-14T12:30:00.000Z");
    assert.equal(reloaded.current.sync.syncedAt, reloaded.current.generatedAt);
    assert.notEqual(reloaded.current.sync.syncedAtLabel, oldBriefing.sync.syncedAtLabel);
    assert.equal(reloaded.current.metrics.github, nextBriefing.metrics.github);
    assert.equal(reloaded.current.status.state, "ready");
    assert.equal(reloaded.current.sync.readyCount, 1);
    assert.equal(reloaded.current.historyDates.includes("2026-06-14"), false);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("morning briefing run logs are JSONL and redact sensitive fields", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mb-runs-"));
  try {
    const runId = "refresh/test";
    const githubToken = ["ghp", "123456789012345678901234567890123456"].join("_");
    const openAiToken = ["sk", "proj", "12345678901234567890"].join("-");
    await appendMorningBriefingRunLog({
      workspaceRoot: dir,
      runId,
      record: {
        stage: "external_digest",
        outcome: "failed",
        selectedSources: ["posthog"],
        token: githubToken,
        error: `failed for user@example.com from 127.0.0.1 with ${openAiToken}`,
        rawRows: [{ email: "person@example.com", value: 1 }],
      },
    });
    const logPath = resolveMorningBriefingRunLogPath(dir, runId);
    const raw = await fs.readFile(logPath, "utf8");
    const lines = raw.trim().split(/\n/);
    assert.equal(lines.length, 1);
    const record = JSON.parse(lines[0]);
    assert.equal(record.stage, "external_digest");
    assert.equal(record.outcome, "failed");
    assert.equal(record.token, "[redacted]");
    assert.equal(record.rawRows, "[redacted]");
    assert.match(record.error, /\[redacted\]/);
    assert.doesNotMatch(raw, /user@example\.com|127\.0\.0\.1|sk-proj-|ghp_/);

    const sanitized = sanitizeMorningBriefingRunLogRecord({ authorization: "Bearer secret", count: 3 });
    assert.deepEqual(sanitized, { authorization: "[redacted]", count: 3 });
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("loadMorningBriefingStore resets on schema mismatch", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "mb-schema-"));
  try {
    const filePath = resolveMorningBriefingPath(dir);
    await fs.mkdir(path.dirname(filePath), { recursive: true });
    await fs.writeFile(filePath, JSON.stringify({ schemaVersion: 999, current: { day: 1 } }), "utf8");
    const store = await loadMorningBriefingStore({ workspaceRoot: dir });
    assert.equal(store.current, null);
    assert.deepEqual(store.history, []);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

// ── Connect guide (Day-1 git/gh-only briefing upgrade path) ──────────────────

test("connectGuide is null when PostHog and Cloudflare are both connected", () => {
  assert.equal(buildMorningBriefingConnectGuide({ digest: digestFixture(), day: 12 }), null);
  const briefing = buildMorningBriefing({ digest: digestFixture(), day: 12, now: NOW });
  assert.equal(briefing.connectGuide, null);
});

test("connectGuide ignores failed external sources because they are connected but failed collection", () => {
  const digest = digestFixture({ cloudflareState: "failed" });
  const cloudflareSource = digest.sources.find((source) => source.id === "cloudflare");
  cloudflareSource.selected = true;
  cloudflareSource.detail = "Cloudflare Analytics 조회가 실패했어요 — MCP 연결은 정상이에요.";

  const briefing = buildMorningBriefing({ digest, day: 12, now: NOW });
  const cloudflare = briefing.cards.find((card) => card.id === "cloudflare");

  assert.equal(briefing.connectGuide, null);
  assert.equal(cloudflare.state, "failed");
  assert.equal(cloudflare.noteTone, "warn");
  assert.equal(cloudflare.note, "Cloudflare Analytics 조회가 실패했어요 — MCP 연결은 정상이에요.");
  assert.equal(
    briefing.sync.sources.find((source) => source.id === "cloudflare").detail,
    "Cloudflare Analytics 조회가 실패했어요 — MCP 연결은 정상이에요.",
  );
});

test("Day-1 briefing with git/gh only carries a Settings integrations guide", () => {
  const digest = digestFixture({ posthogState: "missing", cloudflareState: "missing" });
  const briefing = buildMorningBriefing({ digest, day: 1, now: NOW });
  const guide = briefing.connectGuide;
  assert.ok(guide, "connectGuide must exist when posthog/cloudflare are missing");
  assert.equal(guide.settingsSection, "integrations");
  assert.equal(guide.title, "Day 2 브리핑 업그레이드");
  assert.match(guide.detail, /git · GitHub 신호로 만들었어요/);
  assert.match(guide.detail, /Settings > Integrations/);
  assert.match(guide.detail, /Day 2 브리핑부터/);
  assert.deepEqual(guide.sources.map((source) => source.id), ["posthog", "cloudflare"]);
  // Day-1 briefing itself still renders from the connected git/gh sources.
  const github = briefing.cards.find((card) => card.id === "github");
  assert.equal(github.state, "ready");
  assert.equal(briefing.status.state, "ready");
});

test("connectGuide lists only the missing source and keeps later-day phrasing", () => {
  const digest = digestFixture({ cloudflareState: "missing" });
  const guide = buildMorningBriefingConnectGuide({ digest, day: 12 });
  assert.deepEqual(guide.sources.map((source) => source.id), ["cloudflare"]);
  assert.equal(guide.title, "Day 13 브리핑 업그레이드");
  assert.ok(!guide.detail.includes("git · GitHub 신호로 만들었어요"));
});

import test from "node:test";
import assert from "node:assert/strict";

import {
  MORNING_BRIEFING_DRILLDOWN_IDS,
  buildMorningBriefingExternalDigestPrompt,
  collectGithubDrilldown,
  normalizeMorningBriefingDrilldown,
  normalizeMorningBriefingDrilldowns,
  normalizeMorningBriefingExternalDigest,
} from "../sidecar/morning-briefing-drilldown.mjs";
import { buildMorningBriefing } from "../sidecar/morning-briefing.mjs";

const WINDOW = {
  startMs: Date.parse("2026-06-09T00:00:00.000Z"),
  untilMs: Date.parse("2026-06-10T00:00:00.000Z"),
  startIso: "2026-06-09T00:00:00.000Z",
  untilIso: "2026-06-10T00:00:00.000Z",
  label: "2026-06-09 00:00 -> 2026-06-10 now",
};

function gitSourceFixture() {
  return {
    id: "git",
    state: "ready",
    counts: { commits: 9, additions: 412, deletions: 138 },
    events: [
      { at: "2026-06-09T01:10:00.000Z", text: "커밋 · a" },
      { at: "2026-06-09T03:30:00.000Z", text: "커밋 · b" },
      { at: "2026-06-09T18:12:00.000Z", text: "커밋 · c" },
      { at: "2026-06-09T22:40:00.000Z", text: "커밋 · d" },
    ],
  };
}

function ghSourceFixture() {
  return {
    id: "gh_cli",
    state: "ready",
    counts: { prs: 3, openPrs: 1, mergedPrs: 2, issues: 2, releases: 0 },
  };
}

function stubGithubExec({
  prList = [
    { number: 41, title: "온보딩 단계 축소", state: "MERGED", mergedAt: "2026-06-09T02:58:00.000Z", updatedAt: "2026-06-09T02:58:00.000Z", additions: 120, deletions: 64 },
    { number: 43, title: "리텐션 이벤트 보강", state: "OPEN", updatedAt: "2026-06-09T22:40:00.000Z", additions: 254, deletions: 62 },
  ],
  issueList = [
    { number: 44, title: "Setup guide says 5 steps, app only shows 2?", author: { login: "daniel-oss" }, createdAt: "2026-06-09T23:30:00.000Z" },
  ],
  releaseList = [{ tagName: "v0.6.0", publishedAt: "2026-06-02T03:00:00.000Z" }],
  runList = [
    { conclusion: "success", createdAt: "2026-06-09T03:10:00.000Z", updatedAt: "2026-06-09T03:12:00.000Z", workflowName: "deploy", displayTitle: "deploy main", headBranch: "main" },
    { conclusion: "failure", createdAt: "2026-06-08T10:00:00.000Z", updatedAt: "2026-06-08T10:06:00.000Z", workflowName: "ci", displayTitle: "ci", headBranch: "main" },
    { conclusion: "failure", createdAt: "2026-06-07T10:00:00.000Z", updatedAt: "2026-06-07T10:07:00.000Z", workflowName: "ci", displayTitle: "ci", headBranch: "main" },
  ],
  repoView = { nameWithOwner: "zettalyst/agentic30-public", stargazerCount: 21, hasWikiEnabled: false },
  readmeIso = "2026-05-31T00:00:00.000Z",
  readmeCommitsSince = "41",
  unreleasedCount = "33",
} = {}) {
  const calls = [];
  return {
    calls,
    exec: async (cmd, args) => {
      calls.push([cmd, ...args]);
      const joined = `${cmd} ${args.join(" ")}`;
      if (cmd === "gh" && args[0] === "pr") return { ok: true, stdout: JSON.stringify(prList), stderr: "" };
      if (cmd === "gh" && args[0] === "issue") return { ok: true, stdout: JSON.stringify(issueList), stderr: "" };
      if (cmd === "gh" && args[0] === "release") return { ok: true, stdout: JSON.stringify(releaseList), stderr: "" };
      if (cmd === "gh" && args[0] === "run") return { ok: true, stdout: JSON.stringify(runList), stderr: "" };
      if (cmd === "gh" && args[0] === "repo") return { ok: true, stdout: JSON.stringify(repoView), stderr: "" };
      if (cmd === "git" && args[0] === "rev-parse") return { ok: true, stdout: "main\n", stderr: "" };
      if (cmd === "git" && args[0] === "log" && joined.includes("README.md")) return { ok: true, stdout: `${readmeIso}\n`, stderr: "" };
      if (cmd === "git" && args[0] === "rev-list" && joined.includes("--since")) return { ok: true, stdout: `${readmeCommitsSince}\n`, stderr: "" };
      if (cmd === "git" && args[0] === "rev-list") return { ok: true, stdout: `${unreleasedCount}\n`, stderr: "" };
      return { ok: false, stdout: "", stderr: "unknown command" };
    },
  };
}

test("collectGithubDrilldown builds kpis, buckets, lists, scan, and maintenance from CLI output", async () => {
  const { exec } = stubGithubExec();
  const drilldown = await collectGithubDrilldown({
    workspaceRoot: "/tmp/ws",
    window: WINDOW,
    gitSource: gitSourceFixture(),
    ghSource: ghSourceFixture(),
    previousCommitCount: 6,
    execImpl: exec,
  });

  assert.equal(drilldown.id, "github");
  assert.equal(drilldown.title, "GitHub · 빌드·배포 · 레포 신호");
  assert.match(drilldown.subtitle, /agentic30-public/);

  const commitKpi = drilldown.kpis.find((kpi) => kpi.label === "커밋");
  assert.equal(commitKpi.valueLabel, "9");
  assert.equal(commitKpi.deltaLabel, "▲ 3");
  assert.equal(commitKpi.vsLabel, "어제 6");
  const deployKpi = drilldown.kpis.find((kpi) => kpi.label === "배포");
  assert.equal(deployKpi.valueLabel, "1");
  assert.equal(deployKpi.deltaLabel, "성공");
  const netKpi = drilldown.kpis.find((kpi) => kpi.label === "순 변경");
  assert.equal(netKpi.valueLabel, "+412 −138");

  assert.equal(drilldown.chart.kind, "bars");
  assert.equal(drilldown.chart.bars.length, 8);
  const total = drilldown.chart.bars.reduce((sum, bar) => sum + bar.value, 0);
  assert.equal(total, 4);
  assert.ok(drilldown.chart.bars.some((bar) => bar.tone === "violet"));

  const mergedRow = drilldown.listRows.find((row) => row.kind === "merged");
  assert.match(mergedRow.title, /#41/);
  assert.ok(mergedRow.metaItems.includes("+120"));
  const deployRow = drilldown.listRows.find((row) => row.kind === "deploy");
  assert.match(deployRow.title, /deploy/);

  const scanTitles = drilldown.scan.map((cell) => cell.title);
  assert.deepEqual(scanTitles, ["이슈", "릴리스", "Actions", "인사이트", "위키"]);
  const releaseCell = drilldown.scan.find((cell) => cell.title === "릴리스");
  assert.match(releaseCell.valueLabel, /v0\.6\.0/);
  assert.match(releaseCell.sub, /33/);

  // README stale (10 days, 41 commits) + release gap (8 days, 33 commits) + flaky CI (2 failures)
  const maintenanceIds = drilldown.maintenance.map((draft) => draft.id);
  assert.ok(maintenanceIds.includes("github_keep_readme"));
  assert.ok(maintenanceIds.includes("github_keep_release"));
  assert.ok(maintenanceIds.includes("github_keep_ci"));
  assert.ok(drilldown.draftsEmpty.title.length > 0);

  assert.equal(drilldown.meta.progress.label, "main 배포");
  assert.ok(drilldown.meta.rows.some((row) => row.key === "리포" && row.value === "zettalyst/agentic30-public"));
});

test("collectGithubDrilldown returns null when no github source is ready", async () => {
  const drilldown = await collectGithubDrilldown({
    workspaceRoot: "/tmp/ws",
    window: WINDOW,
    gitSource: { id: "git", state: "missing" },
    ghSource: { id: "gh_cli", state: "missing" },
    execImpl: async () => ({ ok: false, stdout: "", stderr: "" }),
  });
  assert.equal(drilldown, null);
});

test("collectGithubDrilldown fails soft when gh is unavailable but git is ready", async () => {
  const drilldown = await collectGithubDrilldown({
    workspaceRoot: "/tmp/ws",
    window: WINDOW,
    gitSource: gitSourceFixture(),
    ghSource: { id: "gh_cli", state: "missing" },
    previousCommitCount: null,
    execImpl: async () => ({ ok: false, stdout: "", stderr: "no gh" }),
  });
  assert.equal(drilldown.id, "github");
  assert.ok(drilldown.kpis.some((kpi) => kpi.label === "커밋" && kpi.valueLabel === "9"));
  assert.equal(drilldown.kpis.find((kpi) => kpi.label === "배포"), undefined);
  assert.deepEqual(drilldown.scan, []);
  assert.deepEqual(drilldown.listRows, []);
  assert.equal(drilldown.chart.bars.length, 8);
});

function externalPayloadFixture() {
  return {
    sources: [
      {
        id: "cloudflare",
        state: "ready",
        summary: "방문 증가",
        counts: { visits: 64, pageviews: 188 },
        highlights: ["방문 ▲56%"],
      },
      {
        id: "posthog",
        state: "ready",
        summary: "리텐션 하락",
        counts: { activeUsers: 11 },
        highlights: ["Day-2 리텐션 27%"],
      },
    ],
    drilldowns: {
      cloudflare: {
        kpis: [
          { label: "순 방문", value: 64, deltaLabel: "▲ 56%", direction: "up", vs: "어제 41" },
          { label: "방문 → 가입", valueLabel: "9%", deltaLabel: "▼ 4p", direction: "down", vs: "어제 13%", flag: true },
        ],
        kpisMeta: "사람 방문 기준 · 봇 제외",
        chart: {
          kind: "bars",
          title: "사람 방문, 지난 24시간",
          bars: [
            { label: "00", value: 2, tone: "amber" },
            { label: "02", value: 3, tone: "amber", tip: "02–04 · 사람 3 · 봇 9 제외" },
            { label: "16", value: 8, tone: "amber" },
          ],
          legend: [{ label: "사람 방문", tone: "amber" }],
          footnote: "02–04시 단일 IP 9요청은 봇으로 분류해 제외했어요.",
        },
        table: [
          { path: "/landing", label: "랜딩", value: 132 },
          { path: "/pricing", label: "가격", value: 34 },
        ],
        signals: [{ time: "02:10", text: "단일 IP 9요청 — 봇으로 분류" }],
        actions: [
          { kind: "task", badge: "태스크", title: "봇 스파이크 자동 차단", body: "WAF rate-limit", why: "봇이 분모를 부풀려요", applyLabel: "태스크 추가" },
        ],
      },
      posthog: {
        kpis: [{ label: "Day-2 리텐션", valueLabel: "27%", deltaLabel: "▼ 14p", direction: "down", vs: "어제 41%", flag: true }],
        chart: {
          kind: "curve",
          title: "Day-2 리텐션",
          points: [
            { label: "06-05 · 39%", pct: 39 },
            { label: "06-06 · 44%", pct: 44 },
            { label: "오늘 · 27%", pct: 27 },
          ],
          baselinePct: 40,
          footnote: "표본 n=11이라 한두 명 이탈도 크게 보여요.",
        },
        funnel: {
          steps: [
            { label: "랜딩 방문", value: 64 },
            { label: "가입", value: 6, valueLabel: "6 · 9%" },
            { label: "워크스페이스 연결", value: 2, drop: true },
          ],
          gapAfterIndex: 1,
          gapLabel: "가입 → 연결에서 67% 이탈 — 가장 큰 누수",
        },
        signals: [{ time: "이탈 지점", text: "온보딩 2단계에서 4명 멈춤" }],
        actions: [
          { kind: "message", badge: "메시지", title: "멈춘 3명에게 보낼 DM", body: "안녕하세요...", why: "이탈이 한 화면에 몰려 있어요", applyLabel: "큐에 추가" },
        ],
      },
    },
  };
}

test("normalizeMorningBriefingExternalDigest returns sources plus normalized drilldowns", () => {
  const { sources, drilldowns } = normalizeMorningBriefingExternalDigest(
    JSON.stringify(externalPayloadFixture()),
    ["posthog", "cloudflare"],
  );
  assert.equal(sources.length, 2);
  assert.ok(sources.every((source) => source.state === "ready"));

  const cf = drilldowns.cloudflare;
  assert.equal(cf.title, "Cloudflare · 트래픽 드릴다운");
  assert.equal(cf.kpis.length, 2);
  assert.equal(cf.kpis[1].flag, true);
  assert.equal(cf.chart.kind, "bars");
  // ratio normalized to the max bucket (value 8)
  assert.equal(cf.chart.bars[2].ratio, 1);
  assert.equal(cf.table.length, 2);
  assert.equal(cf.table[0].rank, 1);
  assert.equal(cf.table[0].share, Math.round((132 / 166) * 100));
  assert.equal(cf.drafts.length, 1);
  assert.equal(cf.drafts[0].kind, "task");

  const ph = drilldowns.posthog;
  assert.equal(ph.chart.kind, "curve");
  assert.equal(ph.chart.points.length, 3);
  assert.equal(ph.chart.baselinePct, 40);
  assert.equal(ph.funnel.steps.length, 3);
  assert.equal(ph.funnel.steps[2].drop, true);
  assert.equal(ph.funnel.gapAfterIndex, 1);
  assert.match(ph.funnel.gapLabel, /67%/);
  assert.equal(ph.drafts[0].kind, "message");
});

test("normalizeMorningBriefingExternalDigest drops drilldowns for non-ready sources and bad payloads", () => {
  const payload = externalPayloadFixture();
  payload.sources = payload.sources.filter((source) => source.id === "cloudflare");
  const { drilldowns } = normalizeMorningBriefingExternalDigest(JSON.stringify(payload), ["posthog", "cloudflare"]);
  assert.equal(drilldowns.posthog, undefined);
  assert.ok(drilldowns.cloudflare);

  const empty = normalizeMorningBriefingExternalDigest("not json at all", ["posthog"]);
  assert.deepEqual(empty.drilldowns, {});
  assert.equal(empty.sources.length, 1);
  assert.equal(empty.sources[0].state, "failed");
});

test("normalizeMorningBriefingDrilldown rejects empty payloads and clamps strings", () => {
  assert.equal(normalizeMorningBriefingDrilldown("cloudflare", {}), null);
  assert.equal(normalizeMorningBriefingDrilldown("unknown", { kpis: [{ label: "a", value: 1 }] }), null);
  const normalized = normalizeMorningBriefingDrilldown("cloudflare", {
    title: "x".repeat(500),
    kpis: [{ label: "순 방문", value: 64 }],
  });
  assert.equal(normalized.title.length, 80);
  assert.equal(normalized.kpis[0].valueLabel, "64");
});

test("normalizeMorningBriefingDrilldowns keeps only known source ids", () => {
  const normalized = normalizeMorningBriefingDrilldowns({
    cloudflare: { kpis: [{ label: "순 방문", value: 64 }] },
    bogus: { kpis: [{ label: "x", value: 1 }] },
  });
  assert.deepEqual(Object.keys(normalized), ["cloudflare"]);
  assert.equal(normalizeMorningBriefingDrilldowns({}), null);
});

test("buildMorningBriefingExternalDigestPrompt appends drilldown shape for selected sources only", () => {
  const prompt = buildMorningBriefingExternalDigestPrompt({
    sources: ["posthog"],
    window: WINDOW,
    context: "ctx",
  });
  assert.match(prompt, /"drilldowns"/);
  assert.match(prompt, /Day-2 리텐션/);
  assert.doesNotMatch(prompt, /사람 방문, 지난 24시간/);
  assert.match(prompt, /never raw event rows/);

  const none = buildMorningBriefingExternalDigestPrompt({ sources: [], window: WINDOW });
  assert.doesNotMatch(none, /"drilldowns"/);
});

test("buildMorningBriefing attaches normalized drilldowns and history entries", () => {
  const digest = {
    window: { startIso: WINDOW.startIso, untilIso: WINDOW.untilIso, label: WINDOW.label },
    sources: [
      { id: "git", label: "git", state: "ready", counts: { commits: 9 }, highlights: [], events: [] },
    ],
  };
  const briefing = buildMorningBriefing({
    digest,
    day: 12,
    history: [
      { date: "2026-06-08", metrics: { github: 4 }, day: 10, title: "가격 카피 A/B 시작." },
      { date: "2026-06-09", metrics: { github: 6 }, day: 11, title: "배포 후 첫 유입." },
    ],
    now: new Date("2026-06-10T09:00:00+09:00"),
    drilldowns: {
      github: { kpis: [{ label: "커밋", value: 9 }] },
      bogus: { kpis: [{ label: "x", value: 1 }] },
    },
  });
  assert.ok(briefing.drilldowns.github);
  assert.equal(briefing.drilldowns.bogus, undefined);
  assert.equal(briefing.historyEntries.length, 2);
  assert.equal(briefing.historyEntries[0].date, "2026-06-09");
  assert.equal(briefing.historyEntries[0].day, 11);
  assert.equal(briefing.historyEntries[0].title, "배포 후 첫 유입.");
});

test("drilldown id list stays pinned to the three briefing sources", () => {
  assert.deepEqual([...MORNING_BRIEFING_DRILLDOWN_IDS], ["cloudflare", "github", "posthog"]);
});

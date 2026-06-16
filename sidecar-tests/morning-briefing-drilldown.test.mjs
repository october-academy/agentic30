import test from "node:test";
import assert from "node:assert/strict";

import {
  MORNING_BRIEFING_DRILLDOWN_IDS,
  buildCountsDrilldown,
  buildMorningBriefingExternalDigestPrompt,
  cloudflareSourceSignalFromMeasurements,
  collectGithubDrilldown,
  ensureMorningBriefingDrilldowns,
  normalizeCardSparkline,
  normalizeCloudflareDrilldownMeasurements,
  normalizeMorningBriefingDrilldown,
  normalizeMorningBriefingDrilldowns,
  normalizeMorningBriefingExternalDigest,
  normalizePosthogDrilldownMeasurements,
} from "../sidecar/morning-briefing-drilldown.mjs";
import { buildMorningBriefing } from "../sidecar/morning-briefing.mjs";

const WINDOW = {
  startMs: Date.parse("2026-06-09T00:00:00.000Z"),
  untilMs: Date.parse("2026-06-10T00:00:00.000Z"),
  startIso: "2026-06-09T00:00:00.000Z",
  untilIso: "2026-06-10T00:00:00.000Z",
  label: "2026-06-09 00:00 -> 2026-06-10 now",
};

test("normalizeCardSparkline defaults missing values to zero and drops invalid numbers", () => {
  const points = normalizeCardSparkline([
    { label: "00", value: 2, at: WINDOW.startIso },
    { label: "03" },
    { label: "06", value: null },
    { label: "09", value: -1 },
    { label: "12", value: Number.POSITIVE_INFINITY },
    { label: "15", value: Number.NaN },
    { label: "18", value: 4 },
  ]);

  assert.deepEqual(
    points.map((point) => ({ label: point.label, value: point.value, at: point.at ?? null })),
    [
      { label: "00", value: 2, at: WINDOW.startIso },
      { label: "03", value: 0, at: null },
      { label: "06", value: 0, at: null },
      { label: "18", value: 4, at: null },
    ],
  );
  assert.equal(
    normalizeCardSparkline(Array.from({ length: 10 }, (_, index) => ({ label: String(index), value: index }))).length,
    8,
  );
});

function gitSourceFixture() {
  const commitTimestamps = [
    "2026-06-09T00:10:00.000Z",
    "2026-06-09T01:10:00.000Z",
    "2026-06-09T03:30:00.000Z",
    "2026-06-09T05:00:00.000Z",
    "2026-06-09T09:30:00.000Z",
    "2026-06-09T12:15:00.000Z",
    "2026-06-09T18:12:00.000Z",
    "2026-06-09T21:05:00.000Z",
    "2026-06-09T22:40:00.000Z",
  ];
  return {
    id: "git",
    state: "ready",
    counts: { commits: 9, additions: 412, deletions: 138 },
    series: { commitTimestamps },
    events: [
      { at: "2026-06-09T01:10:00.000Z", text: "커밋 · a" },
      { at: "2026-06-09T03:30:00.000Z", text: "커밋 · b" },
      { at: "2026-06-09T18:12:00.000Z", text: "커밋 · c" },
      { at: "2026-06-09T22:40:00.000Z", text: "커밋 · d" },
    ],
  };
}

function sumValues(points = []) {
  return points.reduce((sum, point) => sum + Number(point?.value || 0), 0);
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
  packagesList = null,
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
      if (cmd === "gh" && args[0] === "api" && String(args[1]).includes("packages")) {
        if (!packagesList) return { ok: false, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
        // user 엔드포인트만 성공하는 실제 솔로 계정 모양을 재현
        if (String(args[1]).startsWith("users/")) return { ok: true, stdout: JSON.stringify(packagesList), stderr: "" };
        return { ok: false, stdout: "", stderr: "gh: Not Found (HTTP 404)" };
      }
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
  assert.equal(commitKpi.vsLabel, "직전 6");
  const deployKpi = drilldown.kpis.find((kpi) => kpi.label === "배포");
  assert.equal(deployKpi.valueLabel, "1");
  assert.equal(deployKpi.deltaLabel, "성공");
  const netKpi = drilldown.kpis.find((kpi) => kpi.label === "순 변경");
  assert.equal(netKpi.valueLabel, "+412 −138");

  assert.equal(drilldown.chart.kind, "bars");
  assert.equal(drilldown.chart.bars.length, 8);
  const total = sumValues(drilldown.chart.bars);
  assert.equal(total, Number(commitKpi.valueLabel));
  assert.ok(drilldown.chart.bars.some((bar) => bar.tone === "violet"));
  assert.equal(drilldown.cardSparkline.length, 8);
  assert.deepEqual(
    drilldown.cardSparkline.map((point) => point.label),
    drilldown.chart.bars.map((bar) => bar.label),
  );
  assert.deepEqual(
    drilldown.cardSparkline.map((point) => point.value),
    drilldown.chart.bars.map((bar) => bar.value),
  );
  assert.equal(drilldown.cardSparkline[0].at, WINDOW.startIso);

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

test("collectGithubDrilldown charts full commit series even when timeline events are capped", async () => {
  const commitTimestamps = [
    "2026-06-09T00:10:00.000Z",
    "2026-06-09T00:30:00.000Z",
    "2026-06-09T01:00:00.000Z",
    "2026-06-09T02:45:00.000Z",
    "2026-06-09T04:00:00.000Z",
    "2026-06-09T06:30:00.000Z",
    "2026-06-09T08:15:00.000Z",
    "2026-06-09T10:00:00.000Z",
    "2026-06-09T12:20:00.000Z",
    "2026-06-09T14:40:00.000Z",
    "2026-06-09T16:05:00.000Z",
    "2026-06-09T18:10:00.000Z",
    "2026-06-09T21:05:00.000Z",
    "2026-06-09T22:40:00.000Z",
  ];
  const gitSource = {
    id: "git",
    state: "ready",
    counts: { commits: 14, additions: 100, deletions: 20 },
    series: { commitTimestamps },
    events: commitTimestamps.slice(-8).map((at, index) => ({ at, text: `커밋 · capped ${index}` })),
  };
  assert.equal(gitSource.events.length, 8);

  const { exec } = stubGithubExec();
  const drilldown = await collectGithubDrilldown({
    workspaceRoot: "/tmp/ws",
    window: WINDOW,
    gitSource,
    ghSource: ghSourceFixture(),
    previousCommitCount: 12,
    execImpl: exec,
  });

  const commitKpi = drilldown.kpis.find((kpi) => kpi.label === "커밋");
  assert.equal(commitKpi.valueLabel, "14");
  assert.equal(sumValues(drilldown.chart.bars), 14);
  assert.equal(sumValues(drilldown.cardSparkline), 14);
});

test("collectGithubDrilldown fails explicitly when commit series is missing", async () => {
  const { exec } = stubGithubExec();
  await assert.rejects(
    () => collectGithubDrilldown({
      workspaceRoot: "/tmp/ws",
      window: WINDOW,
      gitSource: {
        id: "git",
        state: "ready",
        counts: { commits: 1, additions: 1, deletions: 0 },
        events: [{ at: "2026-06-09T01:10:00.000Z", text: "커밋 · only event" }],
      },
      ghSource: null,
      execImpl: exec,
    }),
    /GitHub drilldown commit series missing: counts\.commits=1/,
  );
});

test("collectGithubDrilldown counts in-window releases and packages as deploys", async () => {
  const { exec } = stubGithubExec({
    releaseList: [
      { tagName: "v20260609-2330", publishedAt: "2026-06-09T23:30:00.000Z", isDraft: false, isPrerelease: false },
      { tagName: "v-draft", publishedAt: "2026-06-09T22:00:00.000Z", isDraft: true, isPrerelease: false },
      { tagName: "v0.6.0", publishedAt: "2026-06-02T03:00:00.000Z", isDraft: false, isPrerelease: false },
    ],
    packagesList: [
      { name: "agentic30-sidecar", package_type: "npm", updated_at: "2026-06-09T21:00:00.000Z", version_count: 4, repository: { full_name: "zettalyst/agentic30-public" } },
      { name: "other-repo-pkg", package_type: "npm", updated_at: "2026-06-09T20:00:00.000Z", version_count: 2, repository: { full_name: "zettalyst/other" } },
      { name: "stale-pkg", package_type: "container", updated_at: "2026-05-01T00:00:00.000Z", version_count: 9 },
    ],
  });
  const drilldown = await collectGithubDrilldown({
    workspaceRoot: "/tmp/ws",
    window: WINDOW,
    gitSource: gitSourceFixture(),
    ghSource: ghSourceFixture(),
    previousCommitCount: 6,
    execImpl: exec,
  });

  // 1 workflow run + 1 published release (draft·윈도 밖 제외) + 1 repo-linked package
  const deployKpi = drilldown.kpis.find((kpi) => kpi.label === "배포");
  assert.equal(deployKpi.valueLabel, "3");
  assert.ok(drilldown.syncPills.includes("배포 3건 · 워크플로 1 · 릴리스 1 · 패키지 1"));

  const deployRows = drilldown.listRows.filter((row) => row.kind === "deploy");
  assert.ok(deployRows.some((row) => row.tag === "released" && /v20260609-2330/.test(row.title)));
  assert.ok(deployRows.some((row) => row.tag === "package" && /agentic30-sidecar/.test(row.title)));
  assert.ok(deployRows.some((row) => row.tag === "deployed"));
  assert.ok(!deployRows.some((row) => /other-repo-pkg|v-draft|stale-pkg/.test(row.title)));

  // 가장 최근 배포(릴리스 23:30)가 차트 footnote를 차지
  assert.match(drilldown.chart.footnote, /배포\(Release\).*v20260609-2330/);

  const scanTitles = drilldown.scan.map((cell) => cell.title);
  assert.deepEqual(scanTitles, ["이슈", "릴리스", "패키지", "Actions", "인사이트", "위키"]);
  const packageCell = drilldown.scan.find((cell) => cell.title === "패키지");
  assert.equal(packageCell.valueLabel, "패키지 2");
  assert.match(packageCell.sub, /agentic30-sidecar · 버전 4/);

  assert.equal(drilldown.meta.progress.valueLabel, "3 · 성공");
});

test("collectGithubDrilldown counts deploy workflows but surfaces pure-CI runs as checks", async () => {
  const { exec } = stubGithubExec({
    runList: [
      { conclusion: "success", createdAt: "2026-06-09T04:00:00.000Z", updatedAt: "2026-06-09T04:00:17.000Z", workflowName: "Secret Scanning", displayTitle: "Secret Scanning", headBranch: "main" },
      { conclusion: "success", createdAt: "2026-06-09T03:10:00.000Z", updatedAt: "2026-06-09T03:12:00.000Z", workflowName: "deploy", displayTitle: "deploy main", headBranch: "main" },
    ],
  });
  const drilldown = await collectGithubDrilldown({
    workspaceRoot: "/tmp/ws",
    window: WINDOW,
    gitSource: gitSourceFixture(),
    ghSource: ghSourceFixture(),
    previousCommitCount: 6,
    execImpl: exec,
  });

  // The deploy workflow counts as a deploy; Secret Scanning (pure CI) does not.
  const deployKpi = drilldown.kpis.find((kpi) => kpi.label === "배포");
  assert.equal(deployKpi.valueLabel, "1");
  const deployRows = drilldown.listRows.filter((row) => row.kind === "deploy");
  assert.ok(deployRows.some((row) => row.tag === "deployed" && /deploy/.test(row.title)));
  assert.ok(!deployRows.some((row) => /Secret Scanning/.test(row.title)));

  // Secret Scanning is surfaced as a passed check, not a deployment.
  const checkRows = drilldown.listRows.filter((row) => row.kind === "check");
  assert.ok(checkRows.some((row) => row.tag === "passed" && /Secret Scanning/.test(row.title)));
  assert.match(drilldown.listMeta, /· 체크 1/);
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

  assert.equal(
    drilldowns.cloudflare,
    undefined,
    "legacy Cloudflare UI payloads without structured measurements are ignored",
  );

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

test("normalizeMorningBriefingExternalDigest derives Cloudflare source counts from measurements", () => {
  const payload = {
    sources: [
      {
        id: "cloudflare",
        state: "ready",
        summary: "legacy hourly sum",
        counts: { visits: 328, pageviews: 999, requests: 999 },
      },
    ],
    drilldowns: {
      cloudflare: {
        measurements: {
          totals: {
            startIso: "2026-06-12T00:00:00.000Z",
            untilIso: "2026-06-13T00:00:00.000Z",
            uniqueVisitors: 285,
            pageviews: 174,
            requests: 3375,
            threats: 0,
          },
          previousTotals: {
            startIso: "2026-06-11T00:00:00.000Z",
            untilIso: "2026-06-12T00:00:00.000Z",
            uniqueVisitors: 335,
            pageviews: 145,
            requests: 3229,
            threats: 0,
          },
          hourly: [
            { datetimeIso: "2026-06-12T12:00:00.000Z", uniqueVisitors: 37, pageviews: 46, requests: 300 },
          ],
        },
      },
    },
  };
  const { sources, drilldowns } = normalizeMorningBriefingExternalDigest(payload, ["cloudflare"]);
  assert.equal(sources[0].state, "ready");
  assert.equal(sources[0].counts.visits, 285);
  assert.equal(sources[0].counts.uniqueVisitors, 285);
  assert.equal(sources[0].counts.pageviews, 174);
  assert.equal(Object.hasOwn(sources[0].counts, "pageViews"), false);
  assert.equal(drilldowns.cloudflare.kpis[0].valueLabel, "285");
  assert.doesNotMatch(drilldowns.cloudflare.chart.subtitle, /합계/);
});

test("normalizeMorningBriefingExternalDigest fails legacy Cloudflare pageViews counts explicitly", () => {
  const payload = {
    sources: [
      {
        id: "cloudflare",
        state: "ready",
        summary: "legacy alias payload",
        counts: { visits: 10, pageViews: 20, requests: 30 },
      },
    ],
    drilldowns: {
      cloudflare: {
        measurements: {
          totals: {
            startIso: "2026-06-12T00:00:00.000Z",
            untilIso: "2026-06-13T00:00:00.000Z",
            uniqueVisitors: 10,
            pageviews: 20,
            requests: 30,
            threats: 0,
          },
          previousTotals: {
            startIso: "2026-06-11T00:00:00.000Z",
            untilIso: "2026-06-12T00:00:00.000Z",
            uniqueVisitors: 9,
            pageviews: 18,
            requests: 27,
            threats: 0,
          },
          hourly: [],
        },
      },
    },
  };

  const { sources, drilldowns } = normalizeMorningBriefingExternalDigest(payload, ["cloudflare"]);
  assert.equal(sources[0].state, "failed");
  assert.match(sources[0].detail, /counts\.pageViews.*counts\.pageviews/);
  assert.deepEqual(sources[0].counts, {});
  assert.equal(drilldowns.cloudflare, undefined);
});

test("normalizeMorningBriefingExternalDigest drops drilldowns for non-ready sources and bad payloads", () => {
  const payload = externalPayloadFixture();
  payload.sources = payload.sources.filter((source) => source.id === "cloudflare");
  const { drilldowns } = normalizeMorningBriefingExternalDigest(JSON.stringify(payload), ["posthog", "cloudflare"]);
  assert.equal(drilldowns.posthog, undefined);
  assert.equal(drilldowns.cloudflare, undefined);

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

test("normalizeMorningBriefingDrilldown keeps latest curve points", () => {
  const points = Array.from({ length: 14 }, (_, index) => {
    const day = String(index + 27).padStart(2, "0");
    return { label: `05-${day} · ${index}%`, pct: index };
  });
  points.splice(6, 8, ...Array.from({ length: 8 }, (_, index) => ({
    label: `06-0${index + 2} · ${index}%`,
    pct: index,
    date: `2026-06-0${index + 2}`,
    cohortSize: index + 2,
    returned: index,
    tip: `2026-06-0${index + 2} 코호트`,
  })));
  const normalized = normalizeMorningBriefingDrilldown("posthog", {
    kpis: [{ label: "Day-1", valueLabel: "11.1%" }],
    chart: { kind: "curve", points },
  });
  assert.equal(normalized.chart.points.length, 8);
  assert.equal(normalized.chart.points[0].label, "06-02 · 0%");
  assert.equal(normalized.chart.points.at(-1).label, "06-09 · 7%");
  assert.equal(normalized.chart.points.at(-1).cohortSize, 9);
});

test("normalizePosthogDrilldownMeasurements renders small-sample aggregate deterministically", () => {
  const drilldown = normalizePosthogDrilldownMeasurements({
    measurements: {
      totals: {
        startIso: "2026-06-10T15:00:00.000Z",
        untilIso: "2026-06-12T04:09:22.581Z",
        events: 831,
        activeUsers: 51,
        conversions: 0,
        signups: 0,
        signupInstrumentation: "missing",
        conversionInstrumentation: "missing",
        topEvents: [
          { event: "$pageview", count: 51, users: 20 },
          { event: "Application Opened", count: 46, users: 5 },
        ],
      },
      cohorts: [
        { day: "2026-05-27", cohortSize: 6, returnedDay1: 1, retentionPct: 16.7 },
        { day: "2026-05-28", cohortSize: 25, returnedDay1: 0, retentionPct: 0 },
        { day: "2026-05-29", cohortSize: 27, returnedDay1: 1, retentionPct: 3.7 },
        { day: "2026-05-30", cohortSize: 22, returnedDay1: 3, retentionPct: 13.6 },
        { day: "2026-05-31", cohortSize: 11, returnedDay1: 1, retentionPct: 9.1 },
        { day: "2026-06-01", cohortSize: 106, returnedDay1: 1, retentionPct: 0.9 },
        { day: "2026-06-02", cohortSize: 11, returnedDay1: 1, retentionPct: 9.1 },
        { day: "2026-06-03", cohortSize: 10, returnedDay1: 3, retentionPct: 30 },
        { day: "2026-06-04", cohortSize: 3, returnedDay1: 0, retentionPct: 0 },
        { day: "2026-06-05", cohortSize: 5, returnedDay1: 0, retentionPct: 0 },
        { day: "2026-06-06", cohortSize: 6, returnedDay1: 0, retentionPct: 0 },
        { day: "2026-06-07", cohortSize: 6, returnedDay1: 0, retentionPct: 0 },
        { day: "2026-06-08", cohortSize: 14, returnedDay1: 3, retentionPct: 21.4 },
        { day: "2026-06-09", cohortSize: 9, returnedDay1: 1, retentionPct: 11.1 },
      ],
      funnel: {
        pageviewUsers: 20,
        appOpenUsers: 5,
        sessionRequestUsers: 5,
        sessionCreatedUsers: 5,
        namedActivationUsers: 0,
        activationInstrumentation: "missing",
      },
      paths: [
        { path: "/blog/paddle-guide", pageviews: 79, activeUsers: 59 },
        { path: "/", pageviews: 26, activeUsers: 17 },
      ],
      instrumentationGaps: ["가입·검증 행동 이벤트가 없어 목표 전환 판단은 제한적입니다."],
    },
  });

  assert.ok(drilldown);
  assert.equal(drilldown.title, "PostHog · 계측·활성 공백");
  assert.equal(drilldown.subtitle, "표본 작음 · 리텐션 단정 보류");
  assert.equal(drilldown.kpis[2].valueLabel, "미계측");
  assert.equal(drilldown.kpis[2].deltaLabel, "검증 행동 없음");
  assert.equal(drilldown.kpis[2].direction, "flat");
  assert.equal(drilldown.kpis[2].flag, false);
  assert.equal(drilldown.kpis[2].vsLabel, "코호트 n=9 · 검증 행동 계측 없음");
  assert.equal(drilldown.kpis[3].valueLabel, "미계측");
  assert.equal(drilldown.kpis[3].deltaLabel, "이벤트 없음");
  assert.equal(drilldown.chart, null);
  assert.equal(drilldown.signals[0].time, "계측 공백");
  assert.equal(drilldown.funnel.gapAfterIndex, 0);
  assert.equal(drilldown.webSignals[0].time, "유입 1위");
});

test("normalizePosthogDrilldownMeasurements defaults missing successful totals to zero", () => {
  const drilldown = normalizePosthogDrilldownMeasurements({
    measurements: {
      totals: {
        startIso: "2026-06-10T00:00:00.000Z",
        untilIso: "2026-06-11T00:00:00.000Z",
      },
      cohorts: [],
      paths: [],
      instrumentationGaps: [],
    },
  });

  assert.ok(drilldown);
  assert.equal(drilldown.collectionFailed, undefined);
  assert.equal(drilldown.kpis.find((kpi) => kpi.label === "활성 사용자").valueLabel, "0명");
  assert.equal(drilldown.kpis.find((kpi) => kpi.label === "이벤트").valueLabel, "0");
});

test("normalizePosthogDrilldownMeasurements rejects contract violations", () => {
  const valid = {
    totals: { events: 1, activeUsers: 1, topEvents: [] },
    cohorts: [{ day: "2026-06-09", cohortSize: 9, returnedDay1: 1 }],
    paths: [],
    instrumentationGaps: [],
  };
  assert.equal(normalizePosthogDrilldownMeasurements({ ...valid, rawRows: [] }), null);
  assert.equal(normalizePosthogDrilldownMeasurements({ measurements: valid, rawRows: [] }), null);
  assert.equal(normalizePosthogDrilldownMeasurements({
    ...valid,
    cohorts: Array.from({ length: 32 }, (_, index) => ({
      day: `2026-06-${String((index % 28) + 1).padStart(2, "0")}`,
      cohortSize: 1,
      returnedDay1: 0,
    })),
  }), null);
  assert.equal(normalizePosthogDrilldownMeasurements({
    ...valid,
    totals: { ...valid.totals, events: "1" },
  }), null);
});

test("normalizeCloudflareDrilldownMeasurements uses period totals, not summed hourly uniques", () => {
  const hourlyValues = [15, 6, 16, 12, 17, 15, 8, 15, 12, 7, 27, 20, 37, 14, 18, 12, 16, 13, 11, 10, 9, 8, 7, 3];
  assert.equal(hourlyValues.reduce((sum, value) => sum + value, 0), 328);
  const measurements = {
    measurements: {
      totals: {
        startIso: "2026-06-12T00:00:00.000Z",
        untilIso: "2026-06-13T00:00:00.000Z",
        uniqueVisitors: 285,
        pageviews: 174,
        requests: 3375,
        threats: 0,
      },
      previousTotals: {
        startIso: "2026-06-11T00:00:00.000Z",
        untilIso: "2026-06-12T00:00:00.000Z",
        uniqueVisitors: 335,
        pageviews: 145,
        requests: 3229,
        threats: 0,
      },
      hourly: hourlyValues.map((value, index) => ({
        datetimeIso: new Date(Date.parse("2026-06-12T00:00:00.000Z") + index * 3_600_000).toISOString(),
        uniqueVisitors: value,
        pageviews: value + 1,
        requests: value * 10,
      })),
      cardHourly: hourlyValues.map((value, index) => ({
        datetimeIso: new Date(Date.parse("2026-06-12T00:00:00.000Z") + index * 3_600_000).toISOString(),
        uniqueVisitors: value,
        pageviews: value + 1,
        requests: value * 10,
      })),
      cardWindow: {
        startIso: "2026-06-12T00:00:00.000Z",
        untilIso: "2026-06-13T00:00:00.000Z",
      },
      zoneName: "agentic30.dev",
      pathTable: [{ path: "/static/app.js", value: 93 }],
      pathTableUsesEyeballFilter: false,
    },
  };

  const drilldown = normalizeCloudflareDrilldownMeasurements(measurements, { timeZone: "Asia/Seoul" });
  assert.ok(drilldown);
  assert.equal(drilldown.subtitle, "agentic30.dev · Cloudflare GraphQL Analytics");
  assert.equal(drilldown.kpis.find((kpi) => kpi.label === "순 방문").valueLabel, "285");
  assert.equal(drilldown.kpis.find((kpi) => kpi.label === "순 방문").vsLabel, "직전 335");
  assert.equal(drilldown.chart.bars.length, 12, "24 hourly buckets are compressed for the 12-bar UI");
  assert.equal(drilldown.cardSparkline.length, 8, "card sparkline uses the shared compact card bucket count");
  assert.deepEqual(drilldown.cardSparkline.slice(0, 2).map((point) => point.value), [16, 17]);
  assert.equal(drilldown.cardSparkline[0].label, "00");
  assert.equal(drilldown.cardSparkline[0].at, "2026-06-12T00:00:00.000Z");
  assert.ok(drilldown.chart.bars.some((bar) => bar.label === "21" && bar.value === 37));
  assert.match(drilldown.chart.subtitle, /피크 21-23시 구간 · 37명/, "peak subtitle brackets the true 2h peak range, not just the start hour");
  assert.equal(Object.hasOwn(drilldown.chart.bars[0], "endLabel"), false, "endLabel stays server-side and never reaches the emitted bar");
  assert.doesNotMatch(drilldown.chart.subtitle, /합계/);
  assert.match(drilldown.chart.footnote, /서로 더하지 않습니다/);
  assert.deepEqual(drilldown.table, [], "path table is hidden unless requestSource=eyeball was actually used");

  const source = cloudflareSourceSignalFromMeasurements(measurements, { selected: true });
  assert.equal(source.counts.visits, 285);
  assert.equal(source.counts.uniqueVisitors, 285);
  assert.equal(source.counts.pageviews, 174);
  assert.equal(Object.hasOwn(source.counts, "pageViews"), false);
  assert.equal(source.selected, true);
});

test("normalizeCloudflareDrilldownMeasurements zero-fills card buckets before the first observed hour", () => {
  const drilldown = normalizeCloudflareDrilldownMeasurements({
    measurements: {
      totals: {
        startIso: "2026-06-12T00:00:00.000Z",
        untilIso: "2026-06-13T00:00:00.000Z",
        uniqueVisitors: 10,
        pageviews: 10,
        requests: 30,
        threats: 0,
      },
      previousTotals: {
        startIso: "2026-06-11T00:00:00.000Z",
        untilIso: "2026-06-12T00:00:00.000Z",
        uniqueVisitors: 0,
        pageviews: 0,
        requests: 0,
        threats: 0,
      },
      hourly: [],
      cardHourly: [
        {
          datetimeIso: "2026-06-12T06:00:00.000Z",
          uniqueVisitors: 10,
          pageviews: 10,
          requests: 30,
        },
      ],
      cardWindow: {
        startIso: "2026-06-12T00:00:00.000Z",
        untilIso: "2026-06-13T00:00:00.000Z",
      },
    },
  });

  assert.equal(drilldown.cardSparkline.length, 8);
  assert.deepEqual(
    drilldown.cardSparkline.slice(0, 3).map((point) => [point.label, point.value, point.at]),
    [
      ["00", 0, "2026-06-12T00:00:00.000Z"],
      ["03", 0, "2026-06-12T03:00:00.000Z"],
      ["06", 10, "2026-06-12T06:00:00.000Z"],
    ],
  );
});

test("normalizeCloudflareDrilldownMeasurements keeps path table only with eyeball filter evidence", () => {
  const base = {
    totals: {
      startIso: "2026-06-12T00:00:00.000Z",
      untilIso: "2026-06-13T00:00:00.000Z",
      uniqueVisitors: 10,
      pageviews: 20,
      requests: 30,
      threats: 0,
    },
    previousTotals: {
      startIso: "2026-06-11T00:00:00.000Z",
      untilIso: "2026-06-12T00:00:00.000Z",
      uniqueVisitors: 9,
      pageviews: 18,
      requests: 29,
      threats: 0,
    },
    hourly: [{ datetimeIso: "2026-06-12T12:00:00.000Z", uniqueVisitors: 10, pageviews: 20, requests: 30 }],
    pathTable: [
      { path: "/", value: 20 },
      { path: "/_next/static/app.js", value: 18 },
      { path: "/agentic30-25-arm64.dmg", value: 2 },
    ],
  };
  assert.equal(normalizeCloudflareDrilldownMeasurements({ measurements: base }).table.length, 0);
  const drilldown = normalizeCloudflareDrilldownMeasurements({
    measurements: { ...base, pathTableUsesEyeballFilter: true },
  });
  assert.deepEqual(drilldown.table.map((row) => row.code), ["/"]);
  assert.ok(drilldown.signals.some((signal) => signal.time === "다운로드 신호" && signal.text.includes(".dmg")));
  assert.ok(drilldown.signals.some((signal) => signal.time === "경로 필터" && signal.text.includes("정적 asset")));
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
  assert.match(prompt, /"measurements"/);
  assert.match(prompt, /totals_top_events/);
  assert.match(prompt, /day1_cohorts/);
  assert.match(prompt, /web_app_session_funnel/);
  assert.match(prompt, /web_paths/);
  assert.match(prompt, /return only drilldowns\.posthog\.measurements/);
  assert.match(prompt, /PostHog active user rule/);
  assert.match(prompt, /telemetry_source\) IN \('mac_app', 'mac_sidecar'\)/);
  assert.match(prompt, /telemetry_environment\) = 'production'/);
  assert.match(prompt, /build_configuration\) = 'release'/);
  assert.match(prompt, /app\/sidecar telemetry can be external customer evidence/);
  assert.match(prompt, /workspace_basename, Korean geo\/IP, or app install\/update activity/);
  assert.match(prompt, /properties\.capture_internal/);
  assert.match(prompt, /properties\.is_internal_traffic/);
  assert.match(prompt, /person\.properties\.is_internal_tester/);
  assert.match(prompt, /properties\.auth_email_domain/);
  assert.match(prompt, /person\.properties\.email_domain/);
  assert.match(prompt, /person\.properties\.email/);
  assert.match(prompt, /october-academy\.com/);
  assert.match(prompt, /uniqIf\(person_id, event IN \('workspace_setup_completed', 'mac_session_created', 'mac_sidecar_session_created', 'mac_sidecar_office_hours_completed'\)\)/);
  assert.match(prompt, /\$pageview\/web\/blog\/link events never count as active users/);
  assert.match(prompt, /Do not include raw rows/);
  assert.doesNotMatch(prompt, /사람 방문, 지난 24시간/);
  assert.match(prompt, /never raw event rows/);

  const cloudflare = buildMorningBriefingExternalDigestPrompt({
    sources: ["cloudflare"],
    window: WINDOW,
    context: "ctx",
  });
  assert.match(cloudflare, /"measurements"/);
  assert.match(cloudflare, /"uniqueVisitors": 0/);
  assert.match(cloudflare, /"previousTotals"/);
  assert.match(cloudflare, /"hourly"/);
  assert.match(cloudflare, /httpRequestsAdaptiveGroups/);
  assert.match(cloudflare, /cloudflare-api cloudflare_api mcp__cloudflare_api execute/);
  assert.match(cloudflare, /mcp__cloudflare_api\.execute/);
  assert.match(cloudflare, /mcp__cloudflare-api__execute/);
  assert.match(cloudflare, /mcp__cloudflare_api__execute/);
  assert.match(cloudflare, /path: "\/graphql"/);
  assert.match(cloudflare, /query\(\$zone: String!, \$start: Time!, \$end: Time!\)/);
  assert.match(cloudflare, /sum \{ requests pageViews threats \}/);
  assert.match(cloudflare, /Never sum hourly uniq\.uniques/);
  assert.match(cloudflare, /Remove dimensions entirely/);
  assert.doesNotMatch(cloudflare, /execute\/search/);
  assert.doesNotMatch(cloudflare, /search\/graphql_query/);
  assert.doesNotMatch(cloudflare, /\/client\/v4\/graphql/);
  assert.doesNotMatch(cloudflare, /sum \{[^}]*visits/);
  assert.doesNotMatch(cloudflare, /사람 방문, 지난 24시간/);
  assert.match(cloudflare, /trailing 24 hours/);
  assert.match(cloudflare, /count_DESC/);
  assert.match(cloudflare, /clientRequestPath/);
  assert.match(cloudflare, /requestSource: "eyeball"/);
  assert.doesNotMatch(cloudflare, /day1_cohorts/);

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

test("buildCountsDrilldown builds KPIs and signals from collected aggregates only", () => {
  const drilldown = buildCountsDrilldown("posthog", [
    {
      id: "posthog",
      label: "PostHog",
      state: "ready",
      counts: { activeUsers: 11, events: 188, conversions: 2 },
      highlights: ["활성 사용자 추이 하락"],
      goalSignals: ["가입의 절반이 BIP 포스트 경유"],
      evidenceGaps: ["온보딩 2단계 이탈 원인 미확인"],
    },
  ]);
  assert.equal(drilldown.id, "posthog");
  assert.equal(drilldown.title, "PostHog · 프로덕트 드릴다운");
  assert.deepEqual(
    drilldown.kpis.map((kpi) => `${kpi.label}=${kpi.valueLabel}`),
    ["활성 사용자=11", "이벤트=188", "전환=2"],
  );
  assert.equal(drilldown.signals.length, 3);
  assert.equal(drilldown.signals[0].time, "신호");
  assert.equal(drilldown.signals[2].time, "공백");
  assert.equal(buildCountsDrilldown("posthog", [{ id: "posthog", state: "missing" }]), null);
});

test("buildCountsDrilldown rejects legacy Cloudflare pageViews counts", () => {
  assert.throws(
    () => buildCountsDrilldown("cloudflare", [
      {
        id: "cloudflare",
        label: "Cloudflare",
        state: "ready",
        counts: { visits: 10, pageViews: 20 },
      },
    ]),
    /counts\.pageViews.*counts\.pageviews/,
  );
});

test("ensureMorningBriefingDrilldowns guarantees a drilldown per ready source, richer payloads win", () => {
  const sources = [
    { id: "cloudflare", label: "Cloudflare", state: "ready", counts: { visits: 64 }, highlights: ["방문 ▲56%"] },
    { id: "posthog", label: "PostHog", state: "ready", counts: { activeUsers: 11 }, highlights: [] },
    { id: "git", label: "git", state: "ready", counts: { commits: 9 }, highlights: ["git 커밋 9건"] },
    { id: "gh_cli", label: "gh CLI", state: "missing" },
  ];
  const rich = normalizeMorningBriefingDrilldowns({
    cloudflare: { title: "Cloudflare · 사람 유입 품질", kpis: [{ label: "순 방문", value: 64, deltaLabel: "▲ 56%", direction: "up" }] },
  });
  const ensured = ensureMorningBriefingDrilldowns({ drilldowns: rich, sources });
  // Rich provider payload kept as-is.
  assert.equal(ensured.cloudflare.kpis[0].deltaLabel, "▲ 56%");
  // Missing sources are filled from counts.
  assert.equal(ensured.posthog.kpis[0].label, "활성 사용자");
  assert.equal(ensured.github.kpis[0].label, "커밋");
  assert.equal(ensured.github.kpis[0].valueLabel, "9");
  // Not-ready sources never get a drilldown.
  assert.equal(
    ensureMorningBriefingDrilldowns({ drilldowns: null, sources: [{ id: "posthog", state: "missing" }] }),
    null,
  );
});

test("buildMorningBriefing guarantees drilldowns for every ready source", () => {
  const digest = {
    window: { startIso: WINDOW.startIso, untilIso: WINDOW.untilIso, label: WINDOW.label },
    sources: [
      { id: "git", label: "git", state: "ready", counts: { commits: 9, additions: 412 }, highlights: ["git 커밋 9건"], events: [] },
      { id: "posthog", label: "PostHog", state: "ready", counts: { activeUsers: 11 }, highlights: ["리텐션 하락"], events: [] },
      { id: "cloudflare", label: "Cloudflare", state: "missing" },
    ],
  };
  const briefing = buildMorningBriefing({ digest, day: 12, now: new Date("2026-06-10T09:00:00+09:00") });
  assert.ok(briefing.drilldowns.github, "ready git source must yield a github drilldown");
  assert.ok(briefing.drilldowns.posthog, "ready posthog source must yield a posthog drilldown");
  assert.equal(briefing.drilldowns.cloudflare, undefined, "missing source must not fabricate a drilldown");
});

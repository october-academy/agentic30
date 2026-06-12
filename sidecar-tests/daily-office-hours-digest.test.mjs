import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildExternalOfficeHoursDigestPrompt,
  collectGitDailySignals,
  evaluateOfficeHoursSourceGate,
  finalizeDailyOfficeHoursDigest,
  formatDailyOfficeHoursDigestForPrompt,
  normalizeExternalOfficeHoursDigest,
  normalizeOfficeHoursSelectedSources,
  officeHoursDigestWindow,
  persistDailyOfficeHoursDigest,
} from "../sidecar/daily-office-hours-digest.mjs";

const KST = -540;

function fakeExec(responses = []) {
  const calls = [];
  const impl = async (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args.join(" ")}`;
    for (const [pattern, result] of responses) {
      if (key.includes(pattern)) return result;
    }
    return { ok: false, stdout: "", stderr: "" };
  };
  impl.calls = calls;
  return impl;
}

function gitDigestLogFixture() {
  return [
    "\u001e2026-06-08T09:15:00+09:00\u001fme@example.com\u001fbuild office hours digest",
    "12\t2\tsidecar/daily-office-hours-digest.mjs",
    "4\t1\tagentic30/ContentView.swift",
    "\u001e2026-06-08T20:30:00+09:00\u001fother@example.com\u001ffix settings",
    "2\t0\tagentic30/SettingsView.swift",
  ].join("\n");
}

test("officeHoursDigestWindow starts at local previous-day midnight", () => {
  const window = officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), {
    tzOffsetMinutes: KST,
  });

  assert.equal(window.localStartDate, "2026-06-08");
  assert.equal(window.localUntilDate, "2026-06-09");
  assert.equal(window.startIso, "2026-06-07T15:00:00.000Z");
  assert.equal(window.untilIso, "2026-06-09T01:30:00.000Z");
});

test("normalizeOfficeHoursSelectedSources maps GitHub to gh CLI and ignores unrelated intake sources", () => {
  assert.deepEqual(
    normalizeOfficeHoursSelectedSources(["github", "posthog", "local_folder", { id: "cloudflare" }]),
    ["gh_cli", "posthog", "cloudflare"],
  );
});

test("Day 1 source gate is skipped", async () => {
  const gate = await evaluateOfficeHoursSourceGate({
    workspaceRoot: "/tmp/ws",
    day: 1,
    selectedSources: ["posthog"],
    execImpl: fakeExec(),
    env: {},
  });

  assert.equal(gate.ok, true);
  assert.equal(gate.skipped, true);
  assert.equal(gate.reason, "day1_fixed_interview");
});

test("Day 2+ source gate blocks when no live source exists", async () => {
  const gate = await evaluateOfficeHoursSourceGate({
    workspaceRoot: "/tmp/ws",
    day: 2,
    execImpl: fakeExec([
      ["git rev-parse", { ok: false, stdout: "" }],
      ["gh auth status", { ok: false, stdout: "" }],
    ]),
    env: {},
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "no_live_sources");
  assert.ok(gate.connectActions.some((action) => action.source === "git"));
  assert.ok(gate.connectActions.some((action) => action.source === "posthog"));
});

test("Day 2+ source gate blocks when a selected source fails even if git is live", async () => {
  const gate = await evaluateOfficeHoursSourceGate({
    workspaceRoot: "/tmp/ws",
    day: 2,
    selectedSources: ["github"],
    execImpl: fakeExec([
      ["git rev-parse", { ok: true, stdout: "true\n" }],
      ["gh auth status", { ok: false, stdout: "" }],
    ]),
    env: {},
  });

  assert.equal(gate.ok, false);
  assert.equal(gate.reason, "selected_sources_failed");
  assert.deepEqual(gate.missingRequiredSources, ["gh_cli"]);
});

test("Day 2+ source gate accepts persisted MCP OAuth state in place of stored API keys", async () => {
  // OAuth-first MCP는 토큰이 프로바이더 캐시에 있어 사이드카에 키가 없다 —
  // "MCP 연결"이 영속한 ready 상태가 키와 동급의 연결 증거여야 한다.
  // (회귀: 키만 검사하면 OAuth 연결 후에도 브리핑이 영원히 missing으로 표시)
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "oh-gate-oauth-"));
  try {
    await fs.writeFile(
      path.join(appSupportPath, "mcp-oauth-state.json"),
      JSON.stringify({
        schemaVersion: 1,
        servers: {
          posthog: { state: "ready", provider: "claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
          cloudflare: { state: "login_pending", provider: "claude", detail: "pending", checkedAt: "2026-06-10T11:00:00.000Z" },
        },
      }),
    );
    const gate = await evaluateOfficeHoursSourceGate({
      workspaceRoot: "/tmp/ws",
      day: 2,
      selectedSources: ["posthog", "cloudflare"],
      appSupportPath,
      execImpl: fakeExec([
        ["git rev-parse", { ok: true, stdout: "true\n" }],
        ["gh auth status", { ok: false, stdout: "" }],
      ]),
      env: {},
    });

    const posthog = gate.sources.find((source) => source.id === "posthog");
    assert.equal(posthog.state, "ready");
    assert.match(posthog.detail, /OAuth connection verified/);
    // login_pending은 ready가 아니다 — 로그인 미완료 상태로 게이트를 통과시키면 안 된다.
    const cloudflare = gate.sources.find((source) => source.id === "cloudflare");
    assert.equal(cloudflare.state, "missing");
    assert.deepEqual(gate.missingRequiredSources, ["cloudflare"]);
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("Day 2+ source gate scopes MCP OAuth readiness to the digest provider", async () => {
  // OAuth 토큰 캐시는 프로바이더별 — claude로 검증된 상태에서 codex 세션이
  // digest를 돌리면 codex 캐시에는 토큰이 없으므로 게이트가 missing으로
  // 막고 재연결을 안내해야 한다(조용한 도구 미인증 실패 방지).
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "oh-gate-oauth-provider-"));
  try {
    await fs.writeFile(
      path.join(appSupportPath, "mcp-oauth-state.json"),
      JSON.stringify({
        schemaVersion: 1,
        servers: {
          posthog: { state: "ready", provider: "claude", detail: "ok", checkedAt: "2026-06-10T11:00:00.000Z" },
        },
      }),
    );
    const execImpl = fakeExec([
      ["git rev-parse", { ok: true, stdout: "true\n" }],
      ["gh auth status", { ok: false, stdout: "" }],
    ]);

    const claudeGate = await evaluateOfficeHoursSourceGate({
      workspaceRoot: "/tmp/ws",
      day: 2,
      selectedSources: ["posthog"],
      provider: "claude",
      appSupportPath,
      execImpl,
      env: {},
    });
    assert.equal(claudeGate.sources.find((source) => source.id === "posthog").state, "ready");

    const codexGate = await evaluateOfficeHoursSourceGate({
      workspaceRoot: "/tmp/ws",
      day: 2,
      selectedSources: ["posthog"],
      provider: "codex",
      appSupportPath,
      execImpl,
      env: {},
    });
    const codexPosthog = codexGate.sources.find((source) => source.id === "posthog");
    assert.equal(codexPosthog.state, "missing");
    assert.match(codexPosthog.detail, /verified for another provider/);
    assert.deepEqual(codexGate.missingRequiredSources, ["posthog"]);
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("collectGitDailySignals stores aggregate summaries without commit SHAs", async () => {
  const window = officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), {
    tzOffsetMinutes: KST,
  });
  const execImpl = fakeExec([
    ["git rev-parse", { ok: true, stdout: "true\n" }],
    ["git log --all --no-merges", { ok: true, stdout: gitDigestLogFixture() }],
    ["git config user.email", { ok: true, stdout: "me@example.com\n" }],
    ["git status --short", { ok: true, stdout: " M sidecar/index.mjs\n?? sidecar/new.mjs\n" }],
  ]);

  const source = await collectGitDailySignals({ workspaceRoot: "/tmp/ws", window, execImpl });

  assert.equal(source.state, "ready");
  assert.equal(source.counts.commits, 2);
  assert.equal(source.counts.myCommits, 1);
  assert.equal(source.counts.uncommittedChanges, 2);
  assert.match(source.summary, /git 커밋 2건/);
  assert.doesNotMatch(JSON.stringify(source), /aaa111|bbb222|[a-f0-9]{40}/i);
});

test("persisted daily digest contains summaries only, not raw external payloads", async () => {
  const workspaceRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-daily-digest-"));
  const gate = {
    day: 2,
    ok: true,
    reason: "ready",
    selectedSources: ["posthog"],
    window: officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), {
      tzOffsetMinutes: KST,
    }),
    sources: [
      { id: "git", label: "git", state: "missing", selected: false, required: false },
      { id: "gh_cli", label: "gh CLI", state: "missing", selected: false, required: false },
      { id: "posthog", label: "PostHog", state: "ready", selected: true, required: true },
      { id: "cloudflare", label: "Cloudflare", state: "missing", selected: false, required: false },
    ],
  };
  const externalSignals = normalizeExternalOfficeHoursDigest({
    sources: [
      {
        id: "posthog",
        state: "ready",
        summary: "activation event 3건",
        counts: { rawRows: 99, activeUsers: 3 },
        highlights: ["활성 사용자 3명"],
        rawEvents: [{ distinct_id: "secret-user", event: "$pageview" }],
      },
    ],
  }, ["posthog"]);
  const digest = finalizeDailyOfficeHoursDigest({
    gate,
    localSignals: [],
    externalSignals,
    context: "Goal lane: get_users / 활성 사용자 100명 모으기",
    now: new Date("2026-06-09T10:30:00+09:00"),
  });

  const filePath = await persistDailyOfficeHoursDigest({ workspaceRoot, digest });
  const persisted = await fs.readFile(filePath, "utf8");

  assert.match(persisted, /activation event 3건/);
  assert.doesNotMatch(persisted, /rawEvents|distinct_id|secret-user|\$pageview/);
});

test("get_users digest reuses active-user definition from Office Hours memory context", () => {
  const gate = {
    day: 2,
    ok: true,
    reason: "ready",
    selectedSources: ["posthog"],
    window: officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), { tzOffsetMinutes: KST }),
    sources: [
      { id: "posthog", label: "PostHog", state: "ready", selected: true, required: true },
    ],
  };
  const digest = finalizeDailyOfficeHoursDigest({
    gate,
    localSignals: [],
    externalSignals: [
      { id: "posthog", label: "PostHog", state: "ready", counts: { activeUsers: 3 }, summary: "활성 사용자 3명" },
    ],
    context: [
      "Goal lane: get_users / 활성 사용자 100명 모으기",
      "GET_USERS_ACTIVE_USER_DEFINITION",
      "signalId: get_users_active_user_definition",
      "Active user definition: 온보딩을 끝내고 첫 검증 행동을 기록한다.",
    ].join("\n"),
    now: new Date("2026-06-09T10:30:00+09:00"),
  });

  assert.ok(digest.briefing.goalStatus.includes("활성 사용자 기준: 온보딩을 끝내고 첫 검증 행동을 기록한다."));
  assert.doesNotMatch(formatDailyOfficeHoursDigestForPrompt(digest), /활성 사용자 기준이 아직 잠기지 않았습니다/);
});

test("get_users digest blocks acquisition briefing when active-user definition is missing", () => {
  const gate = {
    day: 2,
    ok: true,
    reason: "ready",
    selectedSources: ["git"],
    window: officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), { tzOffsetMinutes: KST }),
    sources: [
      { id: "git", label: "git", state: "ready", selected: true, required: true },
    ],
  };
  const digest = finalizeDailyOfficeHoursDigest({
    gate,
    localSignals: [{ id: "git", label: "git", state: "ready", counts: { commits: 3 }, summary: "git 커밋 3건" }],
    externalSignals: [],
    context: [
      "Goal lane: get_users / 활성 사용자 100명 모으기",
      "GET_USERS_ACTIVE_USER_DEFINITION_MISSING: true",
    ].join("\n"),
    now: new Date("2026-06-09T10:30:00+09:00"),
  });

  assert.ok(digest.briefing.goalStatus.includes("활성 사용자 기준이 아직 잠기지 않았습니다."));
  assert.match(digest.briefing.biggestEvidenceGap[0], /활성 사용자 1명으로 세는 핵심 행동 기준/);
});

test("a shipped release is not customer evidence — only PostHog usage counts", () => {
  const gate = {
    day: 2,
    ok: true,
    reason: "ready",
    selectedSources: ["git", "gh_cli"],
    window: officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), { tzOffsetMinutes: KST }),
    sources: [
      { id: "git", label: "git", state: "ready", selected: true, required: true },
      { id: "gh_cli", label: "gh CLI", state: "ready", selected: true, required: true },
    ],
  };
  // git commits + a published release, but zero PostHog usage signals.
  const localSignals = [
    { id: "git", label: "git", state: "ready", counts: { commits: 30 }, highlights: ["git 커밋 30건"], summary: "git 커밋 30건" },
    { id: "gh_cli", label: "gh CLI", state: "ready", counts: { prs: 0, issues: 0, releases: 4 }, highlights: ["릴리즈 4건"], summary: "릴리즈 4건" },
  ];
  const digest = finalizeDailyOfficeHoursDigest({
    gate,
    localSignals,
    externalSignals: [],
    context: "Goal lane: get_users",
    now: new Date("2026-06-09T10:30:00+09:00"),
  });

  // Releases must NOT count as proof a customer did anything.
  assert.equal(digest.buildWithoutCustomerEvidence, true);
  assert.match(digest.briefing.biggestEvidenceGap[0], /고객 행동 증거/);

  // Builder-output summaries must not be restated as "goal-helpful signals" —
  // the duplication doubled the briefing card without adding information.
  assert.deepEqual(digest.briefing.goalHelpfulSignals, []);
  // Highlights that already start with the source label keep a single label
  // ("git 커밋 30건", not "git: git 커밋 30건"); others still get the prefix.
  assert.ok(digest.briefing.overnightChanges.includes("git 커밋 30건"));
  assert.ok(digest.briefing.overnightChanges.includes("gh CLI: 릴리즈 4건"));

  // With real PostHog usage, the flag flips off.
  const withUsage = finalizeDailyOfficeHoursDigest({
    gate: { ...gate, selectedSources: ["git", "posthog"] },
    localSignals,
    externalSignals: [
      { id: "posthog", label: "PostHog", state: "ready", counts: { activeUsers: 3 }, highlights: ["활성 사용자 3명"], summary: "활성 사용자 3명" },
    ],
    context: "Goal lane: get_users",
    now: new Date("2026-06-09T10:30:00+09:00"),
  });
  assert.equal(withUsage.buildWithoutCustomerEvidence, false);
  // Customer-evidence source summaries DO surface, source-labeled.
  assert.ok(withUsage.briefing.goalHelpfulSignals.includes("PostHog: 활성 사용자 3명"));
});

test("evidence-derived goalSignals/evidenceGaps reach the interview briefing", () => {
  const externalSignals = normalizeExternalOfficeHoursDigest({
    sources: [
      {
        id: "posthog",
        state: "ready",
        summary: "activation 3건",
        counts: { activeUsers: 3 },
        highlights: ["활성 사용자 3명"],
        goalSignals: ["가입은 늘지만 결제 0 — 오늘은 결제 전환을 물어야 함"],
        evidenceGaps: ["pricing 페이지 방문 후 이탈 원인이 관측되지 않음"],
      },
    ],
  }, ["posthog"]);

  // normalize must preserve the diagnosis, not drop it.
  assert.deepEqual(externalSignals[0].goalSignals, ["가입은 늘지만 결제 0 — 오늘은 결제 전환을 물어야 함"]);
  assert.deepEqual(externalSignals[0].evidenceGaps, ["pricing 페이지 방문 후 이탈 원인이 관측되지 않음"]);

  const digest = finalizeDailyOfficeHoursDigest({
    gate: {
      day: 2,
      ok: true,
      reason: "ready",
      selectedSources: ["posthog"],
      window: officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), { tzOffsetMinutes: KST }),
      sources: [{ id: "posthog", label: "PostHog", state: "ready", selected: true, required: true }],
    },
    localSignals: [],
    externalSignals,
    context: "Goal lane: make_money",
    now: new Date("2026-06-09T10:30:00+09:00"),
  });

  // The diagnosis reaches the briefing the interview reads, source-labeled.
  assert.ok(digest.briefing.goalHelpfulSignals.some((line) => /^PostHog: 가입은 늘지만 결제 0/.test(line)));
  assert.ok(digest.briefing.biggestEvidenceGap.some((line) => /^PostHog: pricing 페이지 방문 후 이탈/.test(line)));

  // And it survives into the prompt text fed to the office-hours specialist.
  const prompt = formatDailyOfficeHoursDigestForPrompt(digest);
  assert.match(prompt, /결제 전환을 물어야 함/);
  assert.match(prompt, /pricing 페이지 방문 후 이탈/);
});

test("normalizeExternalOfficeHoursDigest fails closed when the model returns no usable JSON", () => {
  // Empty text is exactly what the index.mjs provider-outage catch feeds in.
  for (const broken of ["", "provider crashed before emitting JSON", '{"sources": [']) {
    const sources = normalizeExternalOfficeHoursDigest(broken, ["posthog", "cloudflare"]);
    assert.deepEqual(
      sources.map((source) => [source.id, source.state]),
      [["posthog", "failed"], ["cloudflare", "failed"]],
    );
  }
});

test("normalizeExternalOfficeHoursDigest carries the caller's failureDetail into failed sources", () => {
  const failureDetail = "AI 프로바이더 사용량 한도로 수집하지 못했어요 — 한도 리셋 후 '다시 동기화'를 눌러 주세요.";
  const sources = normalizeExternalOfficeHoursDigest("", ["posthog", "cloudflare"], { failureDetail });
  for (const source of sources) {
    assert.equal(source.state, "failed");
    assert.equal(source.detail, failureDetail);
  }
  // failureDetail이 없으면 내부 디버그 문구가 아니라 소스별 사용자용 문구를 쓴다.
  const fallback = normalizeExternalOfficeHoursDigest("", ["cloudflare"]);
  assert.equal(fallback[0].detail, "Cloudflare Analytics 집계를 완료하지 못했어요 — MCP 연결은 정상이에요.");
});

test("normalizeExternalOfficeHoursDigest prefers failed source summaries over internal failure labels", () => {
  const sources = normalizeExternalOfficeHoursDigest({
    sources: [{
      id: "cloudflare",
      state: "failed",
      summary: "활성 존은 확인했지만 GraphQL Analytics 조회가 실패했습니다.",
      counts: {},
    }],
  }, ["cloudflare"], { failureDetail: "external MCP digest failed" });
  assert.equal(sources[0].state, "failed");
  assert.equal(sources[0].detail, "활성 존은 확인했지만 GraphQL Analytics 조회가 실패했습니다.");
  assert.notEqual(sources[0].detail, "external MCP digest failed");
});

test("normalizeExternalOfficeHoursDigest extracts embedded JSON and fails the missing expected source", () => {
  const text = [
    "Here is the digest you asked for:",
    JSON.stringify({
      sources: [{
        id: "posthog",
        state: "ready",
        summary: "이벤트 12건",
        counts: { events: "12", conversions: -3, bogus: "not-a-number" },
        highlights: ["signup 1건"],
      }],
    }),
  ].join("\n");

  const sources = normalizeExternalOfficeHoursDigest(text, ["posthog", "cloudflare"]);
  const posthog = sources.find((source) => source.id === "posthog");
  const cloudflare = sources.find((source) => source.id === "cloudflare");

  assert.equal(posthog.state, "ready");
  assert.equal(posthog.counts.events, 12);
  assert.equal(posthog.counts.conversions, 0);
  assert.ok(!("bogus" in posthog.counts));
  assert.equal(cloudflare.state, "failed");
});

test("buildExternalOfficeHoursDigestPrompt uses source-specific count keys", () => {
  const window = officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), { tzOffsetMinutes: KST });

  const cloudflareOnly = buildExternalOfficeHoursDigestPrompt({
    sources: ["cloudflare"],
    window,
    context: "ctx",
  });
  assert.match(cloudflareOnly, /"id": "cloudflare"/);
  assert.match(cloudflareOnly, /"visits": 0/);
  assert.match(cloudflareOnly, /"pageviews": 0/);
  assert.match(cloudflareOnly, /"requests": 0/);
  assert.match(cloudflareOnly, /\/zones\?status=active&per_page=5/);
  assert.match(cloudflareOnly, /path: "\/graphql"/);
  assert.match(cloudflareOnly, /query\(\$zone: String!, \$start: Time!, \$end: Time!\)/);
  assert.match(cloudflareOnly, /httpRequests1hGroups/);
  assert.match(cloudflareOnly, /sum \{ requests pageViews \}/);
  assert.match(cloudflareOnly, /uniq \{ uniques \}/);
  assert.match(cloudflareOnly, /Do not query all zones in one GraphQL call/);
  assert.doesNotMatch(cloudflareOnly, /\/client\/v4\/graphql/);
  assert.doesNotMatch(cloudflareOnly, /sum \{[^}]*visits/);
  assert.doesNotMatch(cloudflareOnly, /"id": "posthog"/);
  assert.doesNotMatch(cloudflareOnly, /"activeUsers": 0/);
  assert.doesNotMatch(cloudflareOnly, /"events": 0/);

  const both = buildExternalOfficeHoursDigestPrompt({
    sources: ["posthog", "cloudflare"],
    window,
    context: "ctx",
  });
  assert.match(both, /PostHog counts must use events\/activeUsers\/conversions\/signups/);
  assert.match(both, /telemetry_source IN \('mac_app','mac_sidecar'\)/);
  assert.match(both, /telemetry_environment = 'production'/);
  assert.match(both, /build_configuration = 'release'/);
  assert.match(both, /is_internal_traffic != true/);
  assert.match(both, /person\.properties\.is_internal_tester != true/);
  assert.match(both, /workspace_setup_completed, mac_session_created, mac_sidecar_session_created, or mac_sidecar_office_hours_completed/);
  assert.match(both, /\$pageview, blog, link, and marketing-site events may appear only in drilldown webSignals/);
  assert.match(both, /Cloudflare counts must use visits\/uniqueVisitors\/pageviews\/requests\/threats/);
  assert.match(both, /"id": "posthog"/);
  assert.match(both, /"id": "cloudflare"/);
});

test("a failed external digest blocks via the structured gate error, not a raw crash", () => {
  const gate = {
    day: 3,
    ok: true,
    reason: "ready",
    selectedSources: ["git", "posthog"],
    window: officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), { tzOffsetMinutes: KST }),
    sources: [
      { id: "git", label: "git", state: "ready", selected: true, required: true },
      { id: "posthog", label: "PostHog", state: "ready", selected: true, required: true },
    ],
  };
  const localSignals = [
    { id: "git", label: "git", state: "ready", counts: { commits: 2 }, highlights: ["git 커밋 2건"], summary: "git 커밋 2건" },
  ];
  const externalSignals = normalizeExternalOfficeHoursDigest("", ["posthog"]);

  assert.throws(
    () => finalizeDailyOfficeHoursDigest({
      gate,
      localSignals,
      externalSignals,
      context: "Goal lane: make_money",
      now: new Date("2026-06-09T10:30:00+09:00"),
    }),
    (error) => {
      assert.equal(error.name, "OfficeHoursSourceGateError");
      assert.equal(error.gate.reason, "selected_sources_failed");
      assert.deepEqual(error.gate.missingRequiredSources, ["posthog"]);
      assert.ok(error.gate.connectActions.some((action) => action.id === "connect_posthog"));
      return true;
    },
  );
});

test("a gate-deselected source stays non-required even when its signal claims otherwise", () => {
  const digest = finalizeDailyOfficeHoursDigest({
    gate: {
      day: 2,
      ok: true,
      reason: "ready",
      selectedSources: ["git"],
      window: officeHoursDigestWindow(new Date("2026-06-09T10:30:00+09:00"), { tzOffsetMinutes: KST }),
      sources: [
        { id: "git", label: "git", state: "ready", selected: true, required: true },
        { id: "posthog", label: "PostHog", state: "ready", selected: false, required: false },
      ],
    },
    localSignals: [
      { id: "git", label: "git", state: "ready", counts: { commits: 1 }, highlights: ["git 커밋 1건"], summary: "git 커밋 1건" },
    ],
    externalSignals: [
      // Signal statuses are not the selection authority — even when one claims it.
      { id: "posthog", label: "PostHog", state: "ready", selected: true, required: true, counts: { activeUsers: 1 }, summary: "활성 사용자 1명" },
    ],
    context: "Goal lane: get_users",
    now: new Date("2026-06-09T10:30:00+09:00"),
  });

  const posthog = digest.sources.find((source) => source.id === "posthog");
  assert.equal(posthog.selected, false);
  assert.equal(posthog.required, false);
});

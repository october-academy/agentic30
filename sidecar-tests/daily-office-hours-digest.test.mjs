import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
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
    context: "Goal lane: get_users / 첫 100명 사용자 모으기",
    now: new Date("2026-06-09T10:30:00+09:00"),
  });

  const filePath = await persistDailyOfficeHoursDigest({ workspaceRoot, digest });
  const persisted = await fs.readFile(filePath, "utf8");

  assert.match(persisted, /activation event 3건/);
  assert.doesNotMatch(persisted, /rawEvents|distinct_id|secret-user|\$pageview/);
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

import test from "node:test";
import assert from "node:assert/strict";

import { applyMorningBriefingLiveSync } from "../sidecar/morning-briefing.mjs";

// 실측 재현 픽스처: 07:39에 생성된 브리핑은 PostHog/Cloudflare를 미연결로 박제
// 했고, 08:29에 Settings에서 MCP OAuth가 검증됐다 — 서빙 시점 오버레이가 이
// 모순(설정 "MCP 연결됨" vs 패널 "미연결")을 해소해야 한다.
function briefingFixture({ posthogState = "missing", cloudflareState = "missing", connectGuide } = {}) {
  return {
    day: 2,
    connectGuide: connectGuide !== undefined ? connectGuide : {
      title: "Day 3 브리핑 업그레이드",
      detail: "Settings > Integrations에서 PostHog MCP · Cloudflare MCP를 연결하면 Day 3 브리핑부터 트래픽·리텐션 신호가 함께 도착해요.",
      settingsSection: "integrations",
      sources: [
        { id: "posthog", label: "PostHog MCP", benefit: "리텐션 · 활성 사용자 신호" },
        { id: "cloudflare", label: "Cloudflare MCP", benefit: "트래픽 · 방문 추이 신호" },
      ],
    },
    sync: {
      sources: [
        { id: "git", label: "git", state: "ready", selected: true, detail: "workspace is a git repository" },
        { id: "gh_cli", label: "gh CLI", state: "ready", selected: true, detail: "gh CLI is authenticated" },
        { id: "posthog", label: "PostHog", state: posthogState, selected: false, detail: "PostHog MCP is not connected — connect via OAuth in Settings or store an API key" },
        { id: "cloudflare", label: "Cloudflare", state: cloudflareState, selected: false, detail: "Cloudflare MCP is not connected — connect via OAuth in Settings or store an API token" },
      ],
      readyCount: 1,
      syncedAt: "2026-06-10T22:39:00.000Z",
      syncedAtLabel: "07:39",
    },
    cards: [{ id: "github", state: "ready" }],
  };
}

const LIVE_ALL_READY = [
  { id: "git", state: "ready", detail: "workspace is a git repository" },
  { id: "gh_cli", state: "ready", detail: "gh CLI is authenticated" },
  { id: "posthog", state: "ready", detail: "PostHog MCP OAuth connection verified" },
  { id: "cloudflare", state: "ready", detail: "Cloudflare MCP OAuth connection verified" },
];

test("applyMorningBriefingLiveSync flips stale missing rows to live ready and drops the connect guide", () => {
  const briefing = briefingFixture();
  const { briefing: live, changed } = applyMorningBriefingLiveSync(briefing, LIVE_ALL_READY, {
    now: new Date("2026-06-10T23:30:00.000Z"),
  });
  assert.equal(changed, true);
  const byId = new Map(live.sync.sources.map((source) => [source.id, source]));
  assert.equal(byId.get("posthog").state, "ready");
  assert.equal(byId.get("posthog").detail, "PostHog MCP OAuth connection verified");
  assert.equal(byId.get("cloudflare").state, "ready");
  assert.equal(live.connectGuide, null);
  assert.equal(live.sync.liveCheckedAt, "2026-06-10T23:30:00.000Z");
  // 데이터 스냅샷은 그대로 — 그때 모은 신호의 기록이다.
  assert.equal(live.sync.readyCount, 1);
  assert.equal(live.sync.syncedAt, "2026-06-10T22:39:00.000Z");
  assert.equal(live.sync.syncedAtLabel, "07:39");
  assert.deepEqual(live.cards, briefing.cards);
  // 순수 함수 — 원본(디스크에 persist되는 형상)은 비변형.
  assert.equal(briefing.sync.sources[2].state, "missing");
  assert.equal(briefing.sync.liveCheckedAt, undefined);
  assert.ok(briefing.connectGuide);
});

test("provider switch flips a persisted ready row back to missing and resurrects the connect guide", () => {
  const briefing = briefingFixture({ posthogState: "ready", cloudflareState: "ready", connectGuide: null });
  const live = [
    ...LIVE_ALL_READY.slice(0, 2),
    { id: "posthog", state: "missing", detail: "PostHog MCP OAuth is verified for another provider — reconnect via Settings for codex" },
    { id: "cloudflare", state: "missing", detail: "Cloudflare MCP OAuth is verified for another provider — reconnect via Settings for codex" },
  ];
  const { briefing: out, changed } = applyMorningBriefingLiveSync(briefing, live);
  assert.equal(changed, true);
  assert.equal(out.sync.sources.find((source) => source.id === "posthog").state, "missing");
  assert.ok(out.connectGuide);
  assert.equal(out.connectGuide.title, "Day 3 브리핑 업그레이드");
  assert.deepEqual(
    out.connectGuide.sources.map((source) => source.id).sort(),
    ["cloudflare", "posthog"],
  );
});

test("partial live list only touches matching rows and derives the guide from the merged view", () => {
  const briefing = briefingFixture();
  const { briefing: out, changed } = applyMorningBriefingLiveSync(briefing, [
    { id: "posthog", state: "ready", detail: "PostHog MCP OAuth connection verified" },
  ]);
  assert.equal(changed, true);
  assert.equal(out.sync.sources.find((source) => source.id === "posthog").state, "ready");
  assert.equal(out.sync.sources.find((source) => source.id === "cloudflare").state, "missing");
  assert.equal(out.sync.sources.find((source) => source.id === "git").detail, "workspace is a git repository");
  // 병합 뷰 기준 가이드: cloudflare만 미연결로 남는다.
  assert.deepEqual(out.connectGuide.sources.map((source) => source.id), ["cloudflare"]);
});

test("failed source stays failed under live sync and is not treated as a reconnect prompt", () => {
  const briefing = briefingFixture({ posthogState: "ready", cloudflareState: "failed" });
  briefing.cards.push({
    id: "cloudflare",
    state: "failed",
    note: "external MCP digest failed",
    noteTone: "info",
  });
  briefing.sync.sources = briefing.sync.sources.map((source) =>
    source.id === "cloudflare"
      ? { ...source, detail: "external MCP digest failed", selected: true }
      : source);

  const { briefing: out, changed } = applyMorningBriefingLiveSync(briefing, LIVE_ALL_READY);
  const cloudflareSource = out.sync.sources.find((source) => source.id === "cloudflare");
  const cloudflareCard = out.cards.find((card) => card.id === "cloudflare");

  assert.equal(changed, true);
  assert.equal(cloudflareSource.state, "failed");
  assert.equal(cloudflareSource.detail, "Cloudflare Analytics 집계를 완료하지 못했어요 — MCP 연결은 정상이에요.");
  assert.equal(cloudflareCard.state, "failed");
  assert.equal(cloudflareCard.noteTone, "warn");
  assert.equal(cloudflareCard.note, "Cloudflare Analytics 집계를 완료하지 못했어요 — MCP 연결은 정상이에요.");
  assert.equal(out.connectGuide, null);
});

test("no-op when live states already match the snapshot — same reference, no resend", () => {
  const briefing = briefingFixture({ posthogState: "ready", cloudflareState: "ready", connectGuide: null });
  briefing.sync.sources = briefing.sync.sources.map((row) => {
    const live = LIVE_ALL_READY.find((source) => source.id === row.id);
    return { ...row, state: live.state, detail: live.detail };
  });
  const { briefing: out, changed } = applyMorningBriefingLiveSync(briefing, LIVE_ALL_READY);
  assert.equal(changed, false);
  assert.equal(out, briefing);
  assert.equal(out.sync.liveCheckedAt, undefined);
});

test("fail-open guards: empty live list and null briefing change nothing", () => {
  const briefing = briefingFixture();
  const untouched = applyMorningBriefingLiveSync(briefing, []);
  assert.equal(untouched.changed, false);
  assert.equal(untouched.briefing, briefing);

  const nullCase = applyMorningBriefingLiveSync(null, LIVE_ALL_READY);
  assert.equal(nullCase.changed, false);
  assert.equal(nullCase.briefing, null);

  const unknownOnly = applyMorningBriefingLiveSync(briefing, [{ id: "notion", state: "ready", detail: "x" }]);
  assert.equal(unknownOnly.briefing.sync.sources, briefing.sync.sources);
});

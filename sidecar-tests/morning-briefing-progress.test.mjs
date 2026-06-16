import test from "node:test";
import assert from "node:assert/strict";

import {
  createMorningBriefingProgressTracker,
  describeMorningBriefingToolEvent,
} from "../sidecar/morning-briefing-progress.mjs";
import { salvageMorningBriefingExternalDigest } from "../sidecar/morning-briefing-drilldown.mjs";

function makeTracker() {
  const emitted = [];
  let tick = 0;
  const tracker = createMorningBriefingProgressTracker({
    emit: (snapshot) => emitted.push(snapshot),
    // 결정적 타임스탬프: 호출마다 1초씩 전진.
    now: () => new Date(Date.UTC(2026, 5, 11, 0, 0, tick++)),
  });
  return { tracker, emitted };
}

test("tracker begin/log/finish streams full snapshots with stamped log lines", () => {
  const { tracker, emitted } = makeTracker();
  tracker.begin("cloudflare", "Cloudflare MCP digest 수집 중");
  tracker.tool("cloudflare", { phase: "use", toolName: "ToolSearch" });
  tracker.tool("cloudflare", { phase: "use", toolName: "mcp__cloudflare__execute" });
  tracker.finish("cloudflare", { detail: "수집 완료" });

  assert.equal(emitted.length, 4);
  const last = emitted[emitted.length - 1].cards.find((card) => card.id === "cloudflare");
  assert.equal(last.state, "done");
  assert.equal(last.detail, "수집 완료");
  assert.equal(last.logLines.length, 2);
  // "HH:MM:SS 라벨" 형식 — 스피너 아래 모노스페이스 로그로 그대로 렌더된다.
  assert.match(last.logLines[0], /^\d{2}:\d{2}:\d{2} MCP 도구 검색$/);
  assert.match(last.logLines[1], /Cloudflare Analytics 조회$/);
});

test("tracker ignores cards that never began — no ghost spinner for disconnected sources", () => {
  const { tracker, emitted } = makeTracker();
  tracker.log("posthog", "이 로그는 무시돼야 한다");
  tracker.finish("posthog", { state: "failed" });
  assert.equal(emitted.length, 0);
  assert.deepEqual(tracker.snapshot().cards, []);
});

test("tracker caps log lines at 8 and keeps the newest", () => {
  const { tracker } = makeTracker();
  tracker.begin("posthog", "PostHog MCP digest 수집 중");
  for (let i = 1; i <= 12; i += 1) tracker.log("posthog", `line ${i}`);
  const card = tracker.snapshot().cards[0];
  assert.equal(card.logLines.length, 8);
  assert.match(card.logLines[0], /line 5$/);
  assert.match(card.logLines[7], /line 12$/);
});

test("failAll marks only still-collecting cards as failed", () => {
  const { tracker } = makeTracker();
  tracker.begin("github", "git · gh CLI 신호 수집 중");
  tracker.begin("cloudflare", "Cloudflare MCP digest 수집 중");
  tracker.finish("github", { detail: "수집 완료" });
  tracker.failAll("브리핑 수집이 실패했어요");
  const byId = new Map(tracker.snapshot().cards.map((card) => [card.id, card]));
  assert.equal(byId.get("github").state, "done");
  assert.equal(byId.get("cloudflare").state, "failed");
  assert.equal(byId.get("cloudflare").detail, "브리핑 수집이 실패했어요");
});

test("snapshots are deep copies — later mutation does not rewrite emitted history", () => {
  const { tracker, emitted } = makeTracker();
  tracker.begin("cloudflare", "수집 중");
  tracker.log("cloudflare", "first");
  const frozen = emitted[1].cards[0].logLines.length;
  tracker.log("cloudflare", "second");
  assert.equal(emitted[1].cards[0].logLines.length, frozen);
});

test("describeMorningBriefingToolEvent maps MCP tools to Korean labels and drops noise", () => {
  assert.equal(describeMorningBriefingToolEvent({ phase: "use", toolName: "ToolSearch" }), "MCP 도구 검색");
  assert.equal(describeMorningBriefingToolEvent({ phase: "use", toolName: "tool_search" }), "MCP 도구 검색");
  assert.equal(
    describeMorningBriefingToolEvent({ phase: "use", toolName: "mcp__posthog__execute-sql" }),
    "PostHog 집계 쿼리 실행",
  );
  assert.equal(
    describeMorningBriefingToolEvent({ phase: "use", toolName: "mcp__cloudflare__graphql_query" }),
    "Cloudflare GraphQL Analytics 조회",
  );
  assert.equal(
    describeMorningBriefingToolEvent({ phase: "use", toolName: "mcp__cloudflare_api__execute" }),
    "Cloudflare Analytics 조회",
  );
  assert.equal(
    describeMorningBriefingToolEvent({ phase: "use", toolName: "mcp__cloudflare-api__execute" }),
    "Cloudflare Analytics 조회",
  );
  assert.equal(
    describeMorningBriefingToolEvent({
      phase: "use",
      toolName: "execute",
      payload: { namespace: "mcp__cloudflare_api", server: "cloudflare-api", tool: "execute" },
    }),
    "Cloudflare Analytics 조회",
  );
  assert.equal(
    describeMorningBriefingToolEvent({ phase: "use", toolName: "mcp__notion__search" }),
    "MCP 도구 호출 · search",
  );
  // digest read-only 정책이 거부하는 비-MCP 도구·생각/결과 이벤트는 로그 제외.
  assert.equal(describeMorningBriefingToolEvent({ phase: "use", toolName: "Read" }), null);
  assert.equal(describeMorningBriefingToolEvent({ phase: "result", toolName: "mcp__posthog__execute-sql" }), null);
  assert.equal(describeMorningBriefingToolEvent({ phase: "thinking", toolName: "reasoning" }), null);
});

// ── 타임아웃 부분 출력 구제 ──────────────────────────────────────────────────

const COMPLETE_CLOUDFLARE_JSON = JSON.stringify({
  sources: [
    {
      id: "cloudflare",
      state: "ready",
      summary: "사람 방문 64건, 어제와 비슷한 추이",
      counts: { visits: 64, pageviews: 120 },
      highlights: ["방문 64건"],
      goalSignals: [],
      evidenceGaps: [],
    },
  ],
});

test("salvage adopts a complete ready JSON streamed before the soft timeout", () => {
  const salvaged = salvageMorningBriefingExternalDigest(COMPLETE_CLOUDFLARE_JSON, ["cloudflare"], {
    failureDetail: "외부 MCP digest가 시간 초과됐어요",
  });
  assert.ok(salvaged);
  assert.equal(salvaged.sources.length, 1);
  assert.equal(salvaged.sources[0].state, "ready");
  assert.equal(salvaged.sources[0].counts.visits, 64);
});

test("salvage refuses truncated JSON, self-reported failures, and empty text", () => {
  const truncated = COMPLETE_CLOUDFLARE_JSON.slice(0, COMPLETE_CLOUDFLARE_JSON.length - 20);
  assert.equal(salvageMorningBriefingExternalDigest(truncated, ["cloudflare"], {}), null);

  const failed = JSON.stringify({ sources: [{ id: "cloudflare", state: "failed", summary: "" }] });
  assert.equal(salvageMorningBriefingExternalDigest(failed, ["cloudflare"], {}), null);

  assert.equal(salvageMorningBriefingExternalDigest("", ["cloudflare"], {}), null);
  assert.equal(salvageMorningBriefingExternalDigest("digest 진행 중입니다…", ["cloudflare"], {}), null);
});

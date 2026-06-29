import test from "node:test";
import assert from "node:assert/strict";
import {
  resolveBuilderJourneyTier,
  buildOfficeHoursBuilderJourneyContext,
  buildBuilderJourneyDoc,
  deriveBuilderJourneyInputs,
  BUILDER_JOURNEY_TIERS,
  AGENTIC_GARAGE_URL,
  AGENTIC30_BLOG_URL,
} from "../sidecar/office-hours-builder-journey.mjs";

test("resolveBuilderJourneyTier maps session count to the gstack 4-tier ladder", () => {
  assert.equal(resolveBuilderJourneyTier(0), "introduction");
  assert.equal(resolveBuilderJourneyTier(1), "introduction");
  assert.equal(resolveBuilderJourneyTier(2), "welcome_back");
  assert.equal(resolveBuilderJourneyTier(3), "welcome_back");
  assert.equal(resolveBuilderJourneyTier(4), "regular");
  assert.equal(resolveBuilderJourneyTier(7), "regular");
  assert.equal(resolveBuilderJourneyTier(8), "inner_circle");
  assert.equal(resolveBuilderJourneyTier(20), "inner_circle");
  assert.deepEqual(BUILDER_JOURNEY_TIERS, ["introduction", "welcome_back", "regular", "inner_circle"]);
});

test("every tier closes in OA Partner voice — Agentic Garage + blog, never YC, never a card", () => {
  for (const sessionCount of [1, 2, 5, 9]) {
    const ctx = buildOfficeHoursBuilderJourneyContext({ sessionCount });
    assert.match(ctx, /Phase 6 builder-journey/);
    assert.ok(ctx.includes(AGENTIC_GARAGE_URL), `tier@${sessionCount} invites Agentic Garage`);
    assert.ok(ctx.includes(AGENTIC30_BLOG_URL), `tier@${sessionCount} shares the builder blog`);
    assert.match(ctx, /YC, Y Combinator, Garry Tan, ycombinator\.com은 절대 언급하지 않는다/);
    assert.match(ctx, /새 structured input 카드는 만들지 않는다/);
    assert.match(ctx, /em dash 없이/);
  }
});

test("introduction tier runs the full intro; welcome_back leads with last assignment", () => {
  const intro = buildOfficeHoursBuilderJourneyContext({ sessionCount: 1 });
  assert.match(intro, /tier: introduction/);
  assert.match(intro, /황금기/);
  assert.match(intro, /하나만 더/);

  const back = buildOfficeHoursBuilderJourneyContext({ sessionCount: 2, lastAssignment: "조은성에게 결제 요청 보내기" });
  assert.match(back, /tier: welcome_back/);
  assert.match(back, /조은성에게 결제 요청 보내기/);
});

test("regular tier shows the design trajectory across sessions", () => {
  const reg = buildOfficeHoursBuilderJourneyContext({
    sessionCount: 5,
    designTitles: ["대시보드 도구", "support lead용 Slack 누락 알림"],
    accumulatedSignals: "구체 사용자 3회 명명, 전제 반박 2회",
  });
  assert.match(reg, /tier: regular/);
  assert.match(reg, /대시보드 도구/);
  assert.match(reg, /support lead용 Slack 누락 알림/);
  assert.match(reg, /구체 사용자 3회 명명/);
});

test("buildBuilderJourneyDoc writes a second-person narrative arc, not a data table", () => {
  const doc = buildBuilderJourneyDoc({
    sessionCount: 6,
    designTitles: ["A안", "B안", "C안"],
    accumulatedSignals: "구체 사용자 명명 4회",
    lastAssignment: "내일 결제 요청 발송",
    now: "2026-06-29",
  });
  assert.match(doc, /# Builder Journey/);
  assert.match(doc, /tier: regular/);
  assert.match(doc, /처음 너는 "A안"에서 시작했고, 지금은 "C안"까지 왔다/);
  assert.match(doc, /구체 사용자 명명 4회/);
  assert.match(doc, /내일 결제 요청 발송/);
  // narrative arc, not a markdown table.
  assert.doesNotMatch(doc, /\|---/);
});

test("deriveBuilderJourneyInputs sources designTitles from success commitments, never cycle.note confessions", () => {
  const memory = {
    cycles: [
      { outcome: "success", lastAssignment: "조은성에게 결제 요청 보내기", note: "" },
      { outcome: "blocked", lastAssignment: "", note: "청구가 무서워 미뤘다" },
      { outcome: "success", lastAssignment: "support lead Slack 알림 만들기", note: "" },
    ],
    compiledTruth: { text: "구체 사용자 2회 명명" },
  };
  const inputs = deriveBuilderJourneyInputs(memory, { sessionInProgress: false });
  assert.deepEqual(inputs.designTitles, ["조은성에게 결제 요청 보내기", "support lead Slack 알림 만들기"]);
  assert.ok(!inputs.designTitles.some((title) => title.includes("청구가 무서워")), "a confession (cycle.note) is never a design title");
  assert.equal(inputs.accumulatedSignals, "구체 사용자 2회 명명");
});

test("deriveBuilderJourneyInputs sessionCount: +1 while in progress, raw count after a close", () => {
  const memory = { cycles: [{ outcome: "success", lastAssignment: "A" }, { outcome: "success", lastAssignment: "B" }] };
  assert.equal(deriveBuilderJourneyInputs(memory, { sessionInProgress: true }).sessionCount, 3);
  assert.equal(deriveBuilderJourneyInputs(memory, { sessionInProgress: false }).sessionCount, 2);
  assert.equal(deriveBuilderJourneyInputs({ cycles: [] }).sessionCount, 1); // default in-progress, first session
});

test("deriveBuilderJourneyInputs lastAssignment is the most recent cycle only (empty on a trailing confession)", () => {
  const memory = {
    cycles: [
      { outcome: "success", lastAssignment: "오래된 약속" },
      { outcome: "blocked", lastAssignment: "", note: "고백" },
    ],
  };
  const inputs = deriveBuilderJourneyInputs(memory, { sessionInProgress: false });
  assert.equal(inputs.lastAssignment, "", "a trailing confession leaves lastAssignment empty, not resurfacing the older commitment");
});

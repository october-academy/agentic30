import { test } from "node:test";
import assert from "node:assert/strict";

import {
  officeHoursMemoryHasClosedEvidence,
  formatOfficeHoursStageSignal,
  buildPriorCycle,
  formatPriorCycleOpening,
} from "../sidecar/office-hours-memory.mjs";
import { buildOfficeHoursChatSystemPrompt } from "../sidecar/office-hours-chat-prompt.mjs";
import { buildPrompt as buildOfficeHoursSpecialistPrompt } from "../sidecar/specialists/office-hours.mjs";

// gstack-level diagnostic strengthening (구체성 압박 · 회피 차단 · stage 정합성).
// DETERMINISTIC code (stage proxy, deferral naming) is pinned hard below.
// PROMPT rules are regression guards — they prove the rule TEXT is present, NOT that the
// LLM follows it. Behavioral effect is measured separately by the 4-persona A/B simulation.

// ---- P0: stage proxy (deterministic) -------------------------------------------------

test("officeHoursMemoryHasClosedEvidence is true only when a commitment carries evidence", () => {
  assert.equal(officeHoursMemoryHasClosedEvidence(null), false);
  assert.equal(officeHoursMemoryHasClosedEvidence({ commitments: [] }), false);
  assert.equal(officeHoursMemoryHasClosedEvidence({ commitments: [{ text: "DM 보내기", evidence: null }] }), false);
  assert.equal(
    officeHoursMemoryHasClosedEvidence({ commitments: [{ text: "결제 요청", evidence: { note: "민수 결제 캡처" } }] }),
    true,
  );
});

test("formatOfficeHoursStageSignal emits the [고객 단계] routing line only past demand-proof", () => {
  assert.equal(formatOfficeHoursStageSignal({ commitments: [] }), "");
  const sig = formatOfficeHoursStageSignal({
    commitments: [{ text: "김민수 월 3만원 결제", evidence: { url: "https://example.com/receipt" } }],
  });
  assert.match(sig, /\[고객 단계\]/);
  assert.match(sig, /Q1 수요 증거를 0부터 다시 묻지/);
  assert.match(sig, /작은 유료 진입점 확장/);
  assert.match(sig, /첫 고객도 없는 사람처럼 다루지 마/);
});

// ---- P1: avoidance — deterministic deferral-streak naming ----------------------------

test("buildPriorCycle exposes consecutiveDeferrals from the cycle ledger", () => {
  const memory = {
    cycles: [
      { cycle: 1, outcome: "blocked" },
      { cycle: 2, outcome: "blocked" },
    ],
    commitments: [{ text: "조은성 결제 요청", cycle: 2, status: "open" }],
  };
  const pc = buildPriorCycle(memory, { currentCycle: 3 });
  assert.equal(pc.consecutiveDeferrals, 2);
});

test("formatPriorCycleOpening names the deferral streak as a repeated-wall costume (streak >= 2)", () => {
  const line = formatPriorCycleOpening({
    cycle: 5,
    priorCycle: 4,
    lastAssignment: "조은성에게 결제 요청 보내기",
    abandonedThreads: [],
    consecutiveDeferrals: 3,
  });
  assert.match(line, /3 사이클을 연속으로 미뤘/);
  assert.match(line, /같은 벽 앞에서 3번째/);
});

test("formatPriorCycleOpening stays silent on the deferral line when streak < 2", () => {
  const line = formatPriorCycleOpening({
    cycle: 5,
    priorCycle: 4,
    lastAssignment: "조은성에게 결제 요청 보내기",
    abandonedThreads: [],
    consecutiveDeferrals: 1,
  });
  assert.doesNotMatch(line, /연속으로 미뤘/);
});

// ---- P0 prompt regression guard: stage routing guard text is present -----------------

test("chat system prompt carries the [고객 단계] product-stage routing guard", () => {
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", {
    provider: "codex",
    context: "target solo founder",
  });
  assert.match(prompt, /Product-stage guard/);
  assert.match(prompt, /\[고객 단계\]/);
  assert.match(prompt, /do not re-open Q1 Demand Reality from zero/);
});

// ---- P1 prompt regression guard: specificity ladder + avoidance naming present -------

test("specialist prompt carries the turn-by-turn specificity ladder with an honest exit", () => {
  const prompt = buildOfficeHoursSpecialistPrompt({
    doc: { title: "ICP" },
    observations: "Mac 메뉴바 어시스턴트",
    lastAnswer: "개발자요",
  });
  assert.match(prompt, /사다리를 한 칸 더 내려 좁힌다/);
  assert.match(prompt, /실명·핸들/);
  assert.match(prompt, /최근 2주 현재 대안에 쓴 돈·시간/);
  // honest exit — confession is data, not a zero score
  assert.match(prompt, /모르면 없다·0이라고 그대로 답해도 된다/);
  assert.match(prompt, /취조하듯 몰아붙이지 않는다/);
});

test("specialist prompt carries the topic-shift avoidance naming rule", () => {
  const prompt = buildOfficeHoursSpecialistPrompt({
    doc: { title: "ICP" },
    observations: "Mac 메뉴바 어시스턴트",
    lastAnswer: "사이드바 코드를 좀 더 다듬으려고요",
  });
  assert.match(prompt, /화제 전환 → 회피 명명/);
  assert.match(prompt, /코스튬/);
  assert.match(prompt, /같은 회피가 두 번 이상 반복되면 패턴으로 묶어 부른다/);
});

// ---- Incomplete-interview hardening: the stage reroute must still open a card --------
// The [고객 단계] guard (d6b3530) routes a paying-customer founder away from Q1; combined
// with smart-skip it could end a turn with zero structured cards, tripping the
// answered=0 incomplete-interview gate. Both prompts must carry the at-least-one-card floor.

test("chat system prompt carries the at-least-one-card floor for the stage reroute", () => {
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", {
    provider: "codex",
    context: "target solo founder",
  });
  assert.match(prompt, /At-least-one-card floor/);
  assert.match(prompt, /MUST open at least one structured input card before it can end/);
  assert.match(prompt, /never finish a routed turn in prose with no card/);
});

test("specialist prompt carries the at-least-one-card floor for the stage reroute", () => {
  const prompt = buildOfficeHoursSpecialistPrompt({
    doc: { title: "ICP" },
    observations: "Mac 메뉴바 어시스턴트",
    lastAnswer: "이미 결제하는 고객이 있어요",
  });
  assert.match(prompt, /질문 0개로 만들면 안 된다/);
  assert.match(prompt, /최소 한 개의 structured input 카드를 반드시 연다/);
});

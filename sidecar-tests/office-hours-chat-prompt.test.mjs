import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeHoursChatPrompt,
  buildOfficeHoursChatSystemPrompt,
  isOfficeHoursDay2GoalDrivenContext,
  isOfficeHoursLockedDay1GoalContext,
} from "../sidecar/office-hours-chat-prompt.mjs";

test("office-hours chat prompt is scoped to the Day 1 STEP flow", () => {
  const prompt = buildOfficeHoursChatPrompt({ context: "Day 1 answers" });

  assert.match(prompt, /Office Hours를 시작한다/);
  assert.match(prompt, /Day 1 STEP/);
  assert.match(prompt, /Day 1 answers/);
  assert.doesNotMatch(prompt, /Day999/);
});

test("office-hours chat system prompt routes Codex forcing questions through structured choices", () => {
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", {
    provider: "codex",
    context: "target solo founder",
  });

  assert.match(prompt, /Agentic30 Day 1 STEP Office Hours/);
  assert.match(prompt, /agentic30_request_user_input/);
  assert.match(prompt, /first forcing question/);
  assert.match(prompt, /MUST be asked/);
  assert.match(prompt, /Q1 Demand Reality/);
  assert.match(prompt, /exactly one question/);
  assert.match(prompt, /exactly four demand evidence choices/);
  assert.match(prompt, /requiresFreeText: false/);
  assert.match(prompt, /allowFreeText: false/);
  assert.match(prompt, /현재 대안에 돈\/시간을 쓰고 있다/);
  assert.match(prompt, /관심만 있거나 아직 증거가 없다/);
  assert.match(prompt, /separate evidence sentence or separate weakness selection/);
  assert.match(prompt, /가격 질문|Price questions/);
  assert.match(prompt, /After Q1/);
  assert.match(prompt, /2-4 options/);
  assert.match(prompt, /allowFreeText: true/);
  assert.match(prompt, /startup, intrapreneurship, or builder/);
  assert.match(prompt, /pre_product/);
  assert.match(prompt, /has_users -> Q2 현재 대안, Q4 가장 좁은 첫 진입점, Q5 직접 관찰/);
  assert.match(prompt, /Smart-skip/);
  assert.match(prompt, /Agentic30 Memory source of truth is `\.agentic30\/memory\/` only/);
  assert.match(prompt, /Efficient Memory lookup order/);
  assert.match(prompt, /\.agentic30\/memory\/day-rollup\.json/);
  assert.match(prompt, /\.agentic30\/memory\/days\/day-N\.json/);
  assert.match(prompt, /Day interview questions and user answers/);
  assert.match(prompt, /Office Hours structured input questions and user answers/);
  assert.match(prompt, /For Day 30, reason from the Day 1\.\.29 roll-up/);
  assert.match(prompt, /open or missed commitment/);
  assert.match(prompt, /recommended/);
  assert.match(prompt, /risk/);
  assert.match(prompt, /evidenceTarget/);
  assert.match(prompt, /failureMode/);
  assert.match(prompt, /전제 확인/);
  assert.match(prompt, /office_hours_alternatives/);
  assert.match(prompt, /pendingUserInput card/);
  assert.match(prompt, /Never present numbered prose choices/);
  assert.match(prompt, /target solo founder/);
  // Free-text chat replies may emphasize spans via the ===EMPHASIS=== sentinel,
  // never inline markup.
  assert.match(prompt, /===EMPHASIS===/);
  assert.match(prompt, /Do NOT use inline markup like \*\* or ==/);
  assert.match(prompt, /exact substring of the reply/);
});

test("office-hours chat prompt skips repeated mode gate and routes has-users sessions", () => {
  const prompt = buildOfficeHoursChatPrompt({
    context: [
      "Office Hours mode: Startup",
      "Product stage: has_users",
      "Customer: 전업 1인 개발자",
    ].join("\n"),
  });

  assert.match(prompt, /Startup mode가 이미 선택/);
  assert.match(prompt, /mode gate를 반복하지 않는다/);
  assert.match(prompt, /stage card/);
  assert.match(prompt, /Product stage: has_users/);
});

test("office-hours write-design-doc flow fixes startup questions and terminal doc handoff", () => {
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", {
    provider: "codex",
    context: [
      "Command: start startup --write-design-doc",
      "Office Hours mode: Startup",
      "Flow contract: fixed Startup design-doc flow.",
    ].join("\n"),
  });

  assert.match(prompt, /fixed Startup design-doc flow/);
  assert.match(prompt, /Do not ask mode, product-stage, privacy, or smart-skip gates/);
  assert.match(prompt, /real demand evidence, current alternative, reachable person, smallest paid entry point, observed behavior, future importance/);
  assert.match(prompt, /수요 증거, 현재 대안, 연락 가능한 사람, 작은 유료 진입점, 관찰한 행동, 앞으로 더 중요해질 이유/);
  assert.match(prompt, /one-question Q1 demand evidence card/);
  assert.match(prompt, /After the sixth answer/);
  assert.match(prompt, /generated_by: office-hours/);
  assert.match(prompt, /handoff_for: plan-ceo-review/);
  assert.match(prompt, /문제 정의, 대상 사용자, 선택한 첫 진입점, 전제 확인, 검토한 대안, 이번에는 제외, 다음 행동, CEO 리뷰 인계/);
});

test("office-hours locked Day 1 goal prompt skips gates and requires a structured card", () => {
  const context = [
    "DAY1_LOCKED_GOAL",
    "Flow contract: locked Day 1 goal interview.",
    "Goal lane: make_money / 첫 매출 달성",
    "Goal text: support lead가 Slack 누락에 돈을 낼지 확인한다.",
    "Customer: B2B support lead",
    "Problem: Slack escalation을 놓친다",
    "Validation action: 유료 파일럿 ask",
  ].join("\n");
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", {
    provider: "codex",
    context,
  });

  assert.equal(isOfficeHoursLockedDay1GoalContext(context), true);
  assert.match(prompt, /locked Day 1 goal interview/);
  assert.match(prompt, /do not ask a mode gate, product-stage gate, or goal-selection question/);
  assert.match(prompt, /first response MUST call agentic30_request_user_input/i);
  assert.match(prompt, /weakest missing evidence/);
  assert.match(prompt, /money signal for make_money/);
  assert.match(prompt, /Do not write files, write docs, publish posts/);
  assert.match(prompt, /public evidence logging is available/);
});

test("office-hours Day 2+ goal-driven prompt requires live briefing and goal-specific routing", () => {
  const context = [
    "DAY1_FOUNDATION_GOAL",
    "DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS",
    "Flow contract: Day 2 goal-driven Office Hours scoped to the locked Day 1 30-day goal.",
    "30-day goal source of truth: Day1GoalSelection.goalType",
    "Goal lane: get_users / 첫 100명 사용자 모으기",
    "Goal text: activation action을 끝낸 100명을 모은다.",
    "Day 1 customer: B2B founder",
    "Day 1 problem: onboarding에서 이탈한다",
    "Validation action: 랜딩에서 invite 요청",
    "DAY2_PLUS_LIVE_DIGEST",
    "BUILD_WITHOUT_CUSTOMER_EVIDENCE: true",
  ].join("\n");
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", {
    provider: "codex",
    context,
  });
  const userPrompt = buildOfficeHoursChatPrompt({ context });

  assert.equal(isOfficeHoursDay2GoalDrivenContext(context), true);
  assert.match(userPrompt, /Day 2\+ Office Hours/);
  assert.match(userPrompt, /mode gate, product-stage gate, goal-selection question을 반복하지 않는다/);
  assert.match(prompt, /Day1GoalSelection\.goalType is the source of truth/);
  assert.match(prompt, /Do not switch, reinterpret, dilute/);
  assert.match(prompt, /30일 목표 상태, 어제\/간밤에 바뀐 것, 목표 달성에 도움 되는 신호, 오늘 막고 있는 가장 큰 증거 공백/);
  assert.match(prompt, /first forcing question MUST call agentic30_request_user_input/i);
  assert.match(prompt, /progress toward the 30-day goal/);
  assert.match(prompt, /missing hard evidence/);
  assert.match(prompt, /today's smallest action/);
  assert.match(prompt, /For make_money/);
  assert.match(prompt, /For get_users/);
  assert.match(prompt, /100 unique people\/accounts completing the chosen activation action/);
  assert.match(prompt, /For build_product/);
  assert.match(prompt, /BUILD_WITHOUT_CUSTOMER_EVIDENCE: true/);
  assert.match(prompt, /challenge the customer\/user evidence gap/);
});

test("office-hours chat system prompt routes Claude forcing questions through AskUserQuestion", () => {
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", {
    provider: "claude",
  });

  assert.match(prompt, /AskUserQuestion/);
  assert.doesNotMatch(prompt, /agentic30_request_user_input/);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeHoursChatPrompt,
  buildOfficeHoursChatSystemPrompt,
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
  assert.match(prompt, /exactly one question/);
  assert.match(prompt, /2-4 options/);
  assert.match(prompt, /allowFreeText: true/);
  assert.match(prompt, /requiresFreeText: false/);
  assert.match(prompt, /startup, intrapreneurship, or builder/);
  assert.match(prompt, /pre_product/);
  assert.match(prompt, /has_users -> Q2 Status Quo, Q4 Narrowest Wedge, Q5 Observation/);
  assert.match(prompt, /Smart-skip/);
  assert.match(prompt, /recommended/);
  assert.match(prompt, /risk/);
  assert.match(prompt, /evidenceTarget/);
  assert.match(prompt, /failureMode/);
  assert.match(prompt, /Premise Challenge/);
  assert.match(prompt, /office_hours_alternatives/);
  assert.match(prompt, /pendingUserInput card/);
  assert.match(prompt, /Never present numbered prose choices/);
  assert.match(prompt, /target solo founder/);
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
  assert.match(prompt, /demand, status_quo, human, wedge, observation, future_fit/);
  assert.match(prompt, /After the sixth answer/);
  assert.match(prompt, /generated_by: office-hours/);
  assert.match(prompt, /handoff_for: plan-ceo-review/);
});

test("office-hours chat system prompt routes Claude forcing questions through AskUserQuestion", () => {
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", {
    provider: "claude",
  });

  assert.match(prompt, /AskUserQuestion/);
  assert.doesNotMatch(prompt, /agentic30_request_user_input/);
});

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
  assert.match(prompt, /exactly one question/);
  assert.match(prompt, /2-4 options/);
  assert.match(prompt, /allowFreeText: true/);
  assert.match(prompt, /requiresFreeText: false/);
  assert.match(prompt, /target solo founder/);
});

test("office-hours chat system prompt routes Claude forcing questions through AskUserQuestion", () => {
  const prompt = buildOfficeHoursChatSystemPrompt("/workspace", {
    provider: "claude",
  });

  assert.match(prompt, /AskUserQuestion/);
  assert.doesNotMatch(prompt, /agentic30_request_user_input/);
});

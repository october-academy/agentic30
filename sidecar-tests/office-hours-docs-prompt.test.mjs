import test from "node:test";
import assert from "node:assert/strict";
import {
  buildOfficeHoursDocsPrompt,
  buildOfficeHoursDocsSystemPrompt,
} from "../sidecar/office-hours-docs-prompt.mjs";

test("office-hours docs system prompt targets strategy docs and structured intake", () => {
  const prompt = buildOfficeHoursDocsSystemPrompt("/workspace");

  assert.match(prompt, /docs\/ICP\.md/);
  assert.match(prompt, /docs\/GOAL\.md/);
  assert.match(prompt, /docs\/VALUES\.md/);
  assert.match(prompt, /docs\/SPEC\.md/);
  assert.match(prompt, /agentic30_request_user_input/);
  assert.match(prompt, /request_user_input/);
  assert.match(prompt, /2-4 candidate options/);
  assert.match(prompt, /product name, target user, problem, and purpose/);
  assert.match(prompt, /Demand reality/);
  assert.match(prompt, /Status quo/);
  assert.match(prompt, /Narrowest wedge/);
  assert.doesNotMatch(prompt, /\bdeep interview\b/i);
});

test("office-hours docs system prompt embeds gstack forcing devices", () => {
  const prompt = buildOfficeHoursDocsSystemPrompt("/workspace");

  assert.match(prompt, /Operating Principles/);
  assert.match(prompt, /구체성이 유일한 통화/);
  assert.match(prompt, /관심은 수요가 아닙니다/);

  assert.match(prompt, /Anti-Sycophancy/);
  assert.match(prompt, /흥미로운 접근이에요/);

  assert.match(prompt, /Pushback Patterns/);
  assert.match(prompt, /모호한 시장/);
  assert.match(prompt, /사회적 증거/);
  assert.match(prompt, /플랫폼 비전/);

  assert.match(prompt, /Smart Routing by Stage/);
  assert.match(prompt, /프리 프로덕트/);
  assert.match(prompt, /유료 고객 있음/);

  assert.match(prompt, /Reframe-First Protocol/);
  assert.match(prompt, /언어 정밀도/);

  assert.match(prompt, /Closing Assignment/);
  assert.match(prompt, /이번 주에 한 사용자 옆에 앉아서/);
});

test("office-hours docs prompt treats canonical docs as the Foundation evidence spine", () => {
  const prompt = buildOfficeHoursDocsSystemPrompt("/workspace");

  assert.match(prompt, /Foundation Evidence Spine/);
  assert.match(prompt, /progressive rewrite of the four canonical product docs/);
  assert.match(prompt, /Day 1 evidence updates `docs\/ICP\.md` and `docs\/SPEC\.md`/);
  assert.match(prompt, /Day 7 evidence updates `docs\/ICP\.md`, `docs\/VALUES\.md`, `docs\/GOAL\.md`, and `docs\/SPEC\.md`/);
  assert.match(prompt, /Supporting `day-N-\*\.md` files are allowed, but they are scratch evidence/);
});

test("office-hours docs user prompt includes optional starting context without deep-interview trigger words", () => {
  const prompt = buildOfficeHoursDocsPrompt("AI assistant for solo founders");

  assert.match(prompt, /AI assistant for solo founders/);
  assert.match(prompt, /create or update docs\/ICP\.md/);
  assert.doesNotMatch(prompt, /\binterview\b/i);
});

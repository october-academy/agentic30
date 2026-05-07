import test from "node:test";
import assert from "node:assert/strict";
import {
  classifyChatExecutionRoute,
  requiresStructuredUserInputTool,
} from "../sidecar/chat-route.mjs";

test("IDD continuation with request_user_input routes to agentic without QMD", () => {
  const prompt = [
    "IDD 문서 인터뷰를 시작합니다: ICP",
    "사용자가 host UI의 request_user_input 카드에서 첫 ICP 신호 질문에 답했습니다.",
    "추가 결정이나 누락 정보가 필요하면 반드시 request_user_input 도구로 한 질문씩 이어가세요.",
  ].join("\n");

  const route = classifyChatExecutionRoute(prompt, { qmdAvailable: false });

  assert.equal(route.executionMode, "agentic");
  assert.equal(route.reason, "structured_input_tool_required");
  assert.equal(route.contextSummary, "context=agentic_mcp");
});

test("plan-style structured interview prompt routes to agentic", () => {
  const prompt = [
    "이 IDD 세션은 `/plan` 모드처럼 진행합니다.",
    "인터뷰 질문은 사용자가 UI에서 클릭/입력할 수 있는 구조화 입력으로 받아야 합니다.",
    "반드시 request_user_input 도구를 사용하세요.",
  ].join("\n");

  const route = classifyChatExecutionRoute(prompt, { qmdAvailable: false });

  assert.equal(route.executionMode, "agentic");
  assert.equal(route.reason, "structured_input_tool_required");
});

test("Claude structured input aliases are detected only with interview hints", () => {
  assert.equal(
    requiresStructuredUserInputTool("Use AskUserQuestionTool(AskUserQuestion) for this guided intake."),
    true,
  );
  assert.equal(
    requiresStructuredUserInputTool("Mention request_user_input in a generic troubleshooting note."),
    false,
  );
});

test("short Day 1 ICP coaching keeps instant_chat behavior", () => {
  const route = classifyChatExecutionRoute(
    "Day 1 뭐부터 시작해야 해? ICP 기준으로 짧게 진단해줘.",
    { qmdAvailable: false },
  );

  assert.equal(route.executionMode, "instant_chat");
  assert.equal(route.reason, "instant_short_coaching");
});

test("memory intent keeps QMD and fallback routing behavior", () => {
  assert.equal(
    classifyChatExecutionRoute("ICP.md 문서 어디에 있어?", { qmdAvailable: true }).executionMode,
    "memory_chat",
  );
  const fallback = classifyChatExecutionRoute("ICP.md 문서 어디에 있어?", { qmdAvailable: false });
  assert.equal(fallback.executionMode, "fast_chat");
  assert.equal(fallback.reason, "memory_intent_inline_bip");
  assert.equal(fallback.inlineBipContext, true);
});

import test from "node:test";
import assert from "node:assert/strict";
import {
  MINI_ACTION_EXECUTION_ONLY_INTENT,
  classifyChatExecutionRoute,
  requiresStructuredUserInputTool,
} from "../sidecar/chat-route.mjs";

test("IDD continuation with agentic30_request_user_input routes to agentic without QMD", () => {
  const prompt = [
    "IDD 문서 인터뷰를 시작합니다: ICP",
    "사용자가 host UI의 구조화 입력 카드에서 첫 ICP 신호 질문에 답했습니다.",
    "추가 결정이나 누락 정보가 필요하면 반드시 agentic30_request_user_input MCP 도구로 한 질문씩 이어가세요.",
  ].join("\n");

  const route = classifyChatExecutionRoute(prompt, { qmdAvailable: false });

  assert.equal(route.executionMode, "agentic");
  assert.equal(route.reason, "structured_input_tool_required");
  assert.equal(route.contextSummary, "context=agentic_mcp_read_only");
  assert.equal(route.approvedToolExecution, false);
});

test("plan-style structured interview prompt routes to agentic", () => {
  const prompt = [
    "이 IDD 세션은 `/plan` 모드처럼 진행합니다.",
    "인터뷰 질문은 사용자가 UI에서 클릭/입력할 수 있는 구조화 입력으로 받아야 합니다.",
    "반드시 agentic30_request_user_input MCP 도구를 사용하세요.",
  ].join("\n");

  const route = classifyChatExecutionRoute(prompt, { qmdAvailable: false });

  assert.equal(route.executionMode, "agentic");
  assert.equal(route.reason, "structured_input_tool_required");
  assert.equal(route.approvedToolExecution, false);
});

test("request_user_input guided intake routes to agentic", () => {
  const route = classifyChatExecutionRoute(
    "IDD guided intake: 반드시 request_user_input 도구를 사용하세요.",
    { qmdAvailable: false },
  );

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

test("configured doc path questions use instant manifest lookup", () => {
  const route = classifyChatExecutionRoute("ICP.md 문서 어디에 있어?", { qmdAvailable: true });
  assert.equal(route.executionMode, "instant_chat");
  assert.equal(route.reason, "configured_doc_path_lookup");
  assert.equal(route.inlineBipContext, true);

  const fallback = classifyChatExecutionRoute("VALUES.md path?", { qmdAvailable: false });
  assert.equal(fallback.executionMode, "instant_chat");
  assert.equal(fallback.reason, "configured_doc_path_lookup");
  assert.equal(fallback.inlineBipContext, true);
});

test("task intent defaults to read-only workspace analysis", () => {
  const route = classifyChatExecutionRoute("코드 수정하고 파일 찾아줘", { qmdAvailable: true });

  assert.equal(route.executionMode, "memory_chat");
  assert.equal(route.reason, "task_intent_read_only");
  assert.equal(route.contextSummary, "context=read_only_workspace");
  assert.equal(route.approvedToolExecution, false);
});

test("approved workspace action can use full agentic lane", () => {
  const route = classifyChatExecutionRoute("코드 수정하고 테스트 실행해", {
    qmdAvailable: true,
    executionIntent: "approved_workspace_action",
  });

  assert.equal(route.executionMode, "agentic");
  assert.equal(route.reason, "approved_workspace_action");
  assert.equal(route.contextSummary, "context=agentic_mcp_approved");
  assert.equal(route.approvedToolExecution, true);
});

test("mini-action execution-only intent bypasses user-response prompt routing", () => {
  const route = classifyChatExecutionRoute(
    [
      "Mini-action session start.",
      "Do not ask yet; execute the current action.",
      "Ignore any stale request_user_input wording from older prompt templates.",
    ].join("\n"),
    {
      qmdAvailable: true,
      executionIntent: MINI_ACTION_EXECUTION_ONLY_INTENT,
    },
  );

  assert.equal(route.executionMode, "mini_action_execution_only");
  assert.equal(route.reason, "curriculum_mini_action_execution_only");
  assert.equal(route.contextSummary, "context=mini_action_execute_and_verify");
  assert.equal(route.approvedToolExecution, true);
  assert.equal(route.suppressUserResponsePrompt, true);
  assert.equal(route.requiresUserInput, false);
  assert.equal(route.requiresUserInputCheckpoint, false);
});

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  buildPendingUserInputToolOutput,
  clearUserInputArtifacts,
  createUserInputRequest,
  deleteUserInputArtifacts,
  ensureUserInputDirs,
  extractCodexStructuredInputToolOutputFromPayload,
  isAnsweredCodexStructuredInputToolOutput,
  isPendingCodexStructuredInputToolOutput,
  listUserInputRequests,
  waitForUserInputResponse,
  writeUserInputResponse,
} from "../sidecar/user-input.mjs";

test("user input request lifecycle round-trips through request and response files", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-user-input-"));
  await ensureUserInputDirs(appSupportPath);

  const request = await createUserInputRequest(appSupportPath, {
    sessionId: "session-1",
    toolName: "agentic30_request_user_input",
    title: "assistant needs a choice",
    generation: {
      mode: "provider_adaptive",
      docType: "icp",
    },
    questions: [
      {
        header: "Scope",
        question: "Which scope should we use?",
        options: [
          { label: "Hero", description: "Work on hero only" },
          { label: "App", description: "Work on the full app" },
        ],
        multiSelect: false,
        allowFreeText: true,
        textMode: "short",
      },
    ],
  });

  const requests = await listUserInputRequests(appSupportPath);
  assert.equal(requests.length, 1);
  assert.equal(requests[0].requestId, request.requestId);
  assert.equal(requests[0].toolName, "agentic30_request_user_input");
  assert.deepEqual(requests[0].generation, {
    mode: "provider_adaptive",
    docType: "icp",
  });

  const waitPromise = waitForUserInputResponse(appSupportPath, {
    sessionId: "session-1",
    requestId: request.requestId,
    signal: AbortSignal.timeout(2_000),
    pollMs: 10,
  });

  await writeUserInputResponse(appSupportPath, {
    sessionId: "session-1",
    requestId: request.requestId,
    response: {
      answers: {
        "Which scope should we use?": "App",
      },
      responses: [
        {
          question: "Which scope should we use?",
          selectedOptions: ["App"],
          freeText: "",
        },
      ],
    },
  });

  const response = await waitPromise;
  assert.equal(response.answers["Which scope should we use?"], "App");

  await deleteUserInputArtifacts(appSupportPath, "session-1", request.requestId);
  assert.deepEqual(await listUserInputRequests(appSupportPath), []);
});

test("buildPendingUserInputToolOutput returns non-blocking Codex Office Hours shape", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-user-input-pending-"));
  await ensureUserInputDirs(appSupportPath);

  const request = await createUserInputRequest(appSupportPath, {
    sessionId: "session-office-hours",
    toolName: "agentic30_request_user_input",
    title: "Office Hours",
    questions: [
      {
        header: "수요 증거",
        question: "Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?",
        options: [
          { label: "실제 결제/계약이 있었다", description: "돈이 이미 움직였습니다." },
          { label: "관심만 있거나 아직 증거가 없다", description: "첫 행동 증거가 필요합니다." },
        ],
        allowFreeText: true,
      },
    ],
  });

  const output = buildPendingUserInputToolOutput(request);
  assert.equal(output.status, "pending_user_input");
  assert.equal(output.requestId, request.requestId);
  assert.equal(output.title, "Office Hours");
  assert.equal(output.questions[0].question, request.questions[0].question);
  assert.deepEqual(output.answers, {});
  assert.deepEqual(output.annotations, {});
  assert.deepEqual(output.responses, []);
});

test("extractCodexStructuredInputToolOutputFromPayload parses nested Codex result text", () => {
  const output = {
    status: "pending_user_input",
    requestId: "request-from-log",
    title: "Office Hours",
    questions: [
      {
        header: "오늘 외부 행동",
        question: "박조은님께 아직 보내지 못한 프로젝트 기록 요청을 오늘 어떤 확인 가능한 행동으로 닫을까요?",
        options: [
          {
            label: "지금 바로 요청 보내기",
            description: "보낸 캡처나 링크가 남아 오늘 고객 접점 공백을 줄입니다.",
          },
          {
            label: "먼저 15분 통화 잡기",
            description: "요청 없이 콜만 잡으면 행동 증거는 약합니다.",
          },
        ],
        allowFreeText: true,
      },
    ],
    answers: {},
    annotations: {},
    responses: [],
  };

  const parsed = extractCodexStructuredInputToolOutputFromPayload({
    result: {
      type: "text",
      text: JSON.stringify(output, null, 2),
    },
  });

  assert.equal(parsed.requestId, "request-from-log");
  assert.equal(parsed.questions[0].header, "오늘 외부 행동");
  assert.equal(isPendingCodexStructuredInputToolOutput(parsed), true);
  assert.equal(isAnsweredCodexStructuredInputToolOutput(parsed), false);
});

test("extractCodexStructuredInputToolOutputFromPayload parses content arrays and detects blocking answers", () => {
  const output = {
    requestId: "answered-request",
    title: "Office Hours",
    questions: [
      {
        header: "오늘 외부 행동",
        question: "오늘 어떤 행동을 했나요?",
        options: [
          { label: "아직 보내지 못했다", description: "증거가 없습니다." },
          { label: "바로 보냈다", description: "외부 고객 행동 증거가 남았습니다." },
        ],
      },
    ],
    answers: { "오늘 어떤 행동을 했나요?": "아직 보내지 못했다" },
    annotations: {},
    responses: [
      {
        question: "오늘 어떤 행동을 했나요?",
        selectedOptions: ["아직 보내지 못했다"],
        freeText: "",
      },
    ],
  };

  const parsed = extractCodexStructuredInputToolOutputFromPayload({
    result: {
      content: [
        { type: "text", text: JSON.stringify(output) },
      ],
    },
  });

  assert.equal(parsed.requestId, "answered-request");
  assert.equal(isPendingCodexStructuredInputToolOutput(parsed), false);
  assert.equal(isAnsweredCodexStructuredInputToolOutput(parsed), true);
});

test("clearUserInputArtifacts removes stale request and response files", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-user-input-clear-"));
  await ensureUserInputDirs(appSupportPath);

  const request = await createUserInputRequest(appSupportPath, {
    sessionId: "session-2",
    toolName: "AskUserQuestion",
    title: null,
    questions: [
      {
        header: "Tone",
        question: "What tone should we use?",
        options: [
          { label: "Bold", description: "High-energy" },
          { label: "Quiet", description: "Minimal motion" },
        ],
        multiSelect: false,
      },
    ],
  });

  await writeUserInputResponse(appSupportPath, {
    sessionId: "session-2",
    requestId: request.requestId,
    response: {
      answers: { "What tone should we use?": "Bold" },
      responses: [],
    },
  });

  await clearUserInputArtifacts(appSupportPath);
  assert.deepEqual(await listUserInputRequests(appSupportPath), []);
});

test("createUserInputRequest rejects malformed structured prompt output", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-user-input-invalid-"));
  await ensureUserInputDirs(appSupportPath);

  await assert.rejects(
    () => createUserInputRequest(appSupportPath, {
      sessionId: "session-invalid",
      toolName: "AskUserQuestion",
      title: "Invalid",
      questions: [
        {
          question: "This request is missing the app-facing header field.",
          allowFreeText: true,
        },
      ],
    }),
    /structured input request output contract violation/,
  );

  assert.deepEqual(await listUserInputRequests(appSupportPath), []);
});

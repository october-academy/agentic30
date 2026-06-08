import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const iddAutostartFixturePath = path.join(
  packageRoot,
  "sidecar-tests/fixtures/sidecar-events/idd-setup-autostart.json",
);

test("bootstrap free-text submission starts a provider stream", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-bootstrap-chat-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-bootstrap-chat-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");
    assert.equal(created.session.messages.length, 0);
    assert.equal(created.session.pendingUserInput?.title, "시작하기");
    const startupTiming = created.session.runtime?.startupTiming;
    assert.equal(startupTiming?.clientCountAtCreate, 1);
    assert.ok(
      Number.isFinite(startupTiming?.processToSessionCreatedMs) && startupTiming.processToSessionCreatedMs >= 0,
      `Expected non-negative process-to-session timing, got ${JSON.stringify(startupTiming)}`,
    );
    assert.ok(
      Number.isFinite(startupTiming?.processToSidecarReadyMs) && startupTiming.processToSidecarReadyMs >= 0,
      `Expected non-negative process-to-ready timing, got ${JSON.stringify(startupTiming)}`,
    );
    assert.ok(
      Number.isFinite(startupTiming?.sidecarReadyToCreateSessionReceivedMs)
        && startupTiming.sidecarReadyToCreateSessionReceivedMs >= 0,
      `Expected non-negative ready-to-create timing, got ${JSON.stringify(startupTiming)}`,
    );
    const sessionId = created.session.id;
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId,
      requestId: created.session.pendingUserInput.requestId,
      responses: [{
        question: "무엇부터 시작할까요?",
        selectedOptions: [],
        freeText: "하이",
      }],
    }));

    const running = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === sessionId
      && event.session.status === "running"
      && event.session.messages?.some((message) => message.role === "assistant" && message.state === "streaming")
    );
    assert.ok(running.session.messages.some((message) => message.role === "user" && message.content === "하이"));

    const completed = await waitForEvent(events, (event) => {
      if (event.type !== "session_updated" || event.session?.id !== sessionId || event.session.status !== "idle") {
        return false;
      }
      const answer = latestAssistantMessage(event.session);
      return typeof answer.content === "string" && answer.content.includes("하이");
    });
    assert.match(latestAssistantMessage(completed.session).content, /하이|Day 1/);
    assert.equal(completed.session.pendingUserInput, null);
    assert.ok(events.some((event) =>
      event.type === "tool_event"
      && event.phase === "performance"
      && event.payload?.phase === "provider.stub_response"
    ));
    assert.ok(events.some((event) =>
      event.type === "agent_event"
      && event.event?.eventType === "run.completed"
    ));
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("Foundation-gated create_session suppresses generic initial intake", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-suppress-bootstrap-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-suppress-bootstrap-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.4-mini",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");

    assert.equal(created.session.pendingUserInput, null);
    assert.notEqual(created.session.status, "awaiting_input");
    assert.equal(
      events.some((event) =>
        event.type === "session_created"
        && event.session?.pendingUserInput?.toolName === "initial_intake"
      ),
      false,
    );
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("Day 1 cached ICP coaching uses instant_chat and completes under 1s without provider startup", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-instant-day1-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-instant-day1-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.4-mini",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");
    const sessionId = created.session.id;
    assert.equal(created.session.pendingUserInput, null);
    ws.send(JSON.stringify({
      type: "send_prompt",
      sessionId,
      prompt: "Day 1 뭐부터 시작해야 해? ICP 기준으로 짧게 진단해줘.",
    }));

    const completed = await waitForEvent(events, (event) => {
      if (event.type !== "session_updated" || event.session?.id !== sessionId || event.session.status !== "idle") return false;
      const answer = latestAssistantMessage(event.session);
      return /Day 1|ICP|fast path|SPEC/.test(answer.content || "");
    });
    const answer = latestAssistantMessage(completed.session);
    const instantMark = answer.performance?.marks?.find((mark) => mark.phase === "instant.response_ready");
    assert.ok(instantMark, `Expected instant.response_ready mark, got ${JSON.stringify(answer.performance)}`);
    assert.ok(answer.performance.totalMs < 1_000, `Expected instant_chat under 1s, got ${answer.performance.totalMs}ms`);
    assert.equal(
      answer.performance?.marks?.some((mark) => String(mark.phase).startsWith("provider.")),
      false,
      "instant_chat must not start the SDK provider path",
    );
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("free chat trivial greeting runs through provider", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-free-greeting-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-free-greeting-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");
    const sessionId = created.session.id;
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId,
      requestId: created.session.pendingUserInput.requestId,
      responses: [{
        question: "무엇부터 시작할까요?",
        selectedOptions: [],
        freeText: "일반 채팅 준비",
      }],
    }));
    await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === sessionId
      && event.session.status === "idle"
      && event.session.pendingUserInput == null
    );
    events.length = 0;

    ws.send(JSON.stringify({
      type: "send_prompt",
      sessionId,
      prompt: "하이",
      mode: "free_chat",
    }));

    const completed = await waitForEvent(events, (event) => {
      if (event.type !== "session_updated" || event.session?.id !== sessionId || event.session.status !== "idle") return false;
      const answer = latestAssistantMessage(event.session);
      return answer.state === "final" && typeof answer.content === "string" && answer.content.length > 0;
    });
    const answer = latestAssistantMessage(completed.session);
    assert.ok(
      answer.performance?.marks?.some((mark) => mark.phase === "provider.call_start"),
      `Expected provider.call_start mark, got ${JSON.stringify(answer.performance)}`,
    );
    assert.equal(
      answer.performance?.marks?.some((mark) => mark.phase === "chat.instant_greeting_response_ready"),
      false,
      "free chat greetings must not use the local instant greeting path",
    );
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("configured doc path questions answer immediately from BIP manifest", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-memory-icp-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-memory-icp-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");
    const sessionId = created.session.id;
    if (created.session.pendingUserInput) {
      ws.send(JSON.stringify({
        type: "submit_user_input",
        sessionId,
        requestId: created.session.pendingUserInput.requestId,
        responses: [{
          question: "무엇부터 시작할까요?",
          selectedOptions: ["프로젝트 전략 문서 만들기"],
          freeText: "",
        }],
      }));
      await waitForEvent(events, (event) =>
        event.type === "session_updated"
        && event.session?.id === sessionId
        && !event.session.pendingUserInput
        && event.session.status === "idle"
        && Boolean(latestAssistantMessage(event.session).content)
      );
    }

    const prompt = "ICP.md 문서 어디에 있어?";
    ws.send(JSON.stringify({ type: "send_prompt", sessionId, prompt }));

    const completed = await waitForEvent(events, (event) => {
      if (event.type !== "session_updated" || event.session?.id !== sessionId || event.session.status !== "idle") return false;
      const answer = latestAssistantMessage(event.session);
      return /docs\/ICP\.md/.test(answer.content || "");
    });
    const answer = latestAssistantMessage(completed.session);
    assert.match(answer.content, /docs\/ICP\.md/);
    assert.ok(answer.performance?.marks?.some((mark) =>
      mark.phase === "route.classified"
      && mark.details?.executionMode === "instant_chat"
      && mark.details?.reason === "configured_doc_path_lookup"
    ));
    assert.ok(answer.performance?.marks?.some((mark) =>
      mark.phase === "instant.response_ready"
    ));
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("structured IDD continuation prompt uses agentic route for Codex MCP tools", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-structured-route-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-structured-route-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");
    const sessionId = created.session.id;
    const structuredPrompt = [
      "IDD 문서 인터뷰를 시작합니다: ICP",
      "사용자가 host UI의 구조화 입력 카드에서 첫 ICP 신호 질문에 답했습니다.",
      "추가 결정이나 누락 정보가 필요하면 반드시 agentic30_request_user_input 도구 연결로 한 질문씩 이어가세요.",
    ].join("\n");

    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId,
      requestId: created.session.pendingUserInput.requestId,
      responses: [{
        question: "무엇부터 시작할까요?",
        selectedOptions: [],
        freeText: structuredPrompt,
      }],
    }));

    const completed = await waitForEvent(events, (event) => {
      if (event.type !== "session_updated" || event.session?.id !== sessionId || event.session.status !== "idle") {
        return false;
      }
      const answer = latestAssistantMessage(event.session);
      return answer.performance?.marks?.some((mark) =>
        mark.phase === "route.classified"
        && mark.details?.executionMode === "agentic"
      );
    });
    const answer = latestAssistantMessage(completed.session);
    assert.ok(answer.performance?.marks?.some((mark) =>
      mark.phase === "route.classified"
      && mark.details?.reason === "structured_input_tool_required"
    ));
    assert.ok(answer.performance?.marks?.some((mark) =>
      mark.phase === "provider.entry"
      && mark.details?.executionMode === "agentic"
    ));
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("Codex IDD queue generates GOAL questions through host-owned structured input", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-sheet-idd-host-input-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-sheet-idd-host-input-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");

    ws.send(JSON.stringify({
      type: "bip_idd_start_queue",
      sessionId: created.session.id,
      provider: "codex",
      docType: "goal",
    }));

    const iddCreated = await waitForEvent(events, (event) =>
      event.type === "session_created"
      && event.session?.title === "초기 설정: GOAL"
    );
    assert.equal(iddCreated.session.status, "awaiting_input");
    assert.equal(iddCreated.session.pendingUserInput?.toolName, "agentic30_request_user_input");
    const iddReady = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === iddCreated.session.id
      && event.session?.status === "awaiting_input"
      && event.session?.pendingUserInput?.toolName === "agentic30_request_user_input"
    );

    assert.equal(iddReady.session.status, "awaiting_input");
    assert.equal(iddReady.session.pendingUserInput?.toolName, "agentic30_request_user_input");
    assert.equal(iddReady.session.pendingUserInput?.title, "목표 정하기");
    assert.equal(iddReady.session.pendingUserInput?.generation?.mode, "host_structured");
    assert.equal(iddReady.session.pendingUserInput?.generation?.docType, "goal");
    assert.equal(iddReady.session.runtime?.iddDocumentType, "goal");
    assert.equal(iddReady.session.messages.length, 0);
    assert.ok(iddReady.session.runtime?.pendingIddContinuation?.prompt);
    assert.match(iddReady.session.pendingUserInput.questions[0].question, /가장 먼저 검증하거나 달성하려는 목표/);
    assert.equal(iddReady.session.pendingUserInput.questions[0].requiresFreeText, false);
    assert.doesNotMatch(
      JSON.stringify(iddReady.session),
      /structured input unavailable/,
    );
    assert.equal(
      events.some((event) =>
        event.type === "tool_event"
        && event.payload?.phase === "provider.stub_response"
      ),
      false,
    );

    const requestId = iddReady.session.pendingUserInput.requestId;
    const submitEventStart = events.length;
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId: iddReady.session.id,
      requestId,
      responses: [{
        question: iddReady.session.pendingUserInput.questions[0].question,
        selectedOptions: ["첫 고객 반응 확인"],
        freeText: "이번 주 5명에게 인터뷰 요청하고 3명 이상 답변하면 GOAL 기준을 통과로 본다",
      }],
    }));

    await waitForEvent(events, (event) =>
      event.type === "idd_setup_progress"
      && event.sessionId === iddReady.session.id
      && event.requestId === requestId
      && event.stage === "preparing_question"
    );
    const nextQuestion = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === iddReady.session.id
      && event.session?.pendingUserInput?.requestId
      && event.session.pendingUserInput.requestId !== requestId
    );

    const submitEvents = events.slice(submitEventStart);
    const progressEvents = submitEvents.filter((event) =>
      event.type === "idd_setup_progress"
      && event.sessionId === iddReady.session.id
      && event.requestId === requestId
    );
    assert.deepEqual(
      progressEvents.map((event) => event.stage),
      ["accepted", "recording_response", "routing_followup", "preparing_question"],
    );
    assert.deepEqual(
      progressEvents.map((event) => event.progressText),
      ["답변 저장됨", "GOAL 문서에 반영 중", "다음 질문 카드를 준비 중", "다음 질문 카드 준비 완료"],
    );
    assert.equal(progressEvents.every((event) => event.docType && typeof event.elapsedMs === "number"), true);

    assert.equal(nextQuestion.session.status, "awaiting_input");
    assert.notEqual(nextQuestion.session.pendingUserInput.requestId, requestId);

    assert.equal(nextQuestion.session.pendingUserInput.questions[0].requiresFreeText, false);
    const followupRequestId = nextQuestion.session.pendingUserInput.requestId;
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId: iddReady.session.id,
      requestId: followupRequestId,
      responses: [{
        question: nextQuestion.session.pendingUserInput.questions[0].question,
        selectedOptions: [nextQuestion.session.pendingUserInput.questions[0].options[0].label],
        freeText: "",
      }],
    }));

    await waitForEvent(events, (event) =>
      event.type === "idd_setup_progress"
      && event.sessionId === iddReady.session.id
      && event.requestId === followupRequestId
      && event.stage === "preparing_question"
    );
    await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === iddReady.session.id
      && event.session?.pendingUserInput?.requestId
      && event.session.pendingUserInput.requestId !== followupRequestId
    );
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("BIP setup auto-start starts IDD before mission choices unlock", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-basic-mission-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-basic-mission-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");

    ws.send(JSON.stringify({
      type: "bip_setup_gate_check",
      sessionId: created.session.id,
      provider: "codex",
      autoStart: true,
      curriculumDay: {
        day: 1,
        title: "팔릴 문제부터 찾는다",
        tasks: ["Revenue Readiness Audit로 현재 프로젝트 진단"],
        output: "Track 판정, ICP v0, 첫 CTA, journey brief",
      },
    }));

    const iddReady = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.status === "awaiting_input"
      && event.session?.runtime?.iddDocumentType === "icp"
      && event.session?.pendingUserInput?.toolName === "agentic30_request_user_input"
    );

    assert.equal(iddReady.session.pendingUserInput.title, "고객 후보 1/4");
    assert.equal(iddReady.session.pendingUserInput.generation?.mode, "host_structured");
    assert.equal(iddReady.session.pendingUserInput.generation?.docType, "icp");
    assert.match(iddReady.session.pendingUserInput.questions[0].question, /가장 먼저 인터뷰할 .*유형/);
    const iddCreated = events.find((event) =>
      event.type === "session_created"
      && event.session?.title === "초기 설정: 고객 후보"
    );
    assert.equal(iddCreated?.session.status, "awaiting_input");
    assert.equal(iddCreated?.session.pendingUserInput?.toolName, "agentic30_request_user_input");
    assert.equal(events.some((event) => event.type === "bip_coach_generation_completed"), false);
    assert.equal(events.some((event) =>
      event.type === "session_created"
      && event.session?.title === "초기 설정: 고객 후보"
    ), true);
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("IDD start uses sidecar agent synthesized structured question when available", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-agent-synth-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-agent-synth-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_TEST_IDD_AGENT_SYNTHESIS_JSON: JSON.stringify({
        question: "이번 주 가장 먼저 인터뷰할 1인 개발자 유형은 누구인가요?",
        target_customer: "반복 실패 후 방향 전환이 필요한 개발자",
        learning_goal: "Agentic30의 첫 ICP를 실패 직후 행동 증거가 있는 사람으로 좁힌다",
        why_it_matters: "문제 절박도와 인터뷰 실행 가능성이 가장 높습니다.",
      }),
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");

    ws.send(JSON.stringify({
      type: "bip_idd_start_queue",
      sessionId: created.session.id,
      provider: "codex",
      docType: "icp",
    }));

    const iddReady = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.title === "초기 설정: 고객 후보"
      && event.session?.status === "awaiting_input"
      && event.session?.pendingUserInput?.generation?.mode === "sidecar_agent_synthesized"
    );
    assert.equal(iddReady.session.pendingUserInput.generation?.docType, "icp");
    assert.match(iddReady.session.pendingUserInput.questions[0].question, /가장 먼저 인터뷰할 1인 개발자 유형/);
    assert.equal(iddReady.session.pendingUserInput.questions[0].options[0].label, "반복 실패 후 방향 전환이 필요한 개발자");
    assert.equal(
      events.some((event) =>
        event.type === "idd_setup_progress"
        && event.stage === "agent_question_synthesis"
      ),
      true,
    );
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("Day 1 document handoff writes one canonical doc immediately without auto-starting the next doc", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-doc-handoff-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-doc-handoff-app-"));
  await writeDay1Fixture(root, appSupportPath);
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "docs", "GOAL.md"), "# GOAL\n\n기존 목표는 보존한다.\n");

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");

    ws.send(JSON.stringify({
      type: "day1_doc_handoff_start",
      sessionId: created.session.id,
      provider: "codex",
      docType: "goal",
      day1Handoff: {
        goal: "첫 고객 반응 검증",
        icp: "전업 1인 개발자",
        pain: "무엇을 팔아야 할지 모름",
        outcome: "이번 주 3명 인터뷰 완료",
        qualityScore: "9.0/10",
        markdown: "# Day 1 핵심 가설",
      },
    }));

    const handoffReady = await waitForEvent(events, (event) =>
      (event.type === "session_created" || event.type === "session_updated")
      && event.session?.title === "Day 1 Handoff: GOAL"
      && event.session?.status === "awaiting_input"
      && event.session?.pendingUserInput?.generation?.mode === "day1_handoff"
    );
    const request = handoffReady.session.pendingUserInput;
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId: handoffReady.session.id,
      requestId: request.requestId,
      responses: [{
        question: request.questions[0].question,
        selectedOptions: [request.questions[0].options[0].label],
        freeText: "이번 주 proof target은 인터뷰 카드 완료 3명. 지표는 완료 전환율과 응답 수. 금요일까지 3명 완료가 목표값이고, 5명에게 연락해 0명이 과거 행동을 말하면 실패로 보고 피벗한다.",
      }],
    }));

    await waitForEvent(events, (event) =>
      event.type === "idd_setup_progress"
      && event.docType === "goal"
      && event.stage === "file_written"
    );
    const setupState = await waitForEvent(events, (event) =>
      event.type === "idd_setup_state"
      && event.iddDocPreviews?.some((preview) => preview.type === "goal" && /^written/.test(preview.status))
    );
    assert.equal(setupState.iddSetupComplete, false);
    assert.equal(
      events.some((event) => event.type === "session_created" && event.session?.title === "Day 1 Handoff: ICP"),
      false,
    );
    const written = await fs.readFile(path.join(root, "docs", "GOAL.md"), "utf8");
    assert.match(written, /기존 목표는 보존한다/);
    assert.match(written, /Day 1 Handoff — GOAL/);

    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("Day 1 bulk document handoff writes all canonical docs without structured prompts", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-doc-bulk-handoff-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-doc-bulk-handoff-app-"));
  await writeDay1Fixture(root, appSupportPath);
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(path.join(root, "docs", "GOAL.md"), "# GOAL\n\n기존 목표는 보존한다.\n");

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");

    ws.send(JSON.stringify({
      type: "day1_doc_handoff_write_all",
      sessionId: created.session.id,
      provider: "codex",
      day1Handoff: {
        goal: "첫 고객 반응 검증",
        icp: "macOS에서 AI 코딩 도구를 쓰는 전업 1인 개발자",
        pain: "무엇을 팔아야 할지 몰라 노션과 스프레드시트로 인터뷰 메모를 복사함",
        outcome: "이번 주 3명 인터뷰 완료",
        qualityScore: "9.0/10",
        markdown: "# Day 1 핵심 가설",
      },
    }));

    const setupState = await waitForEvent(events, (event) =>
      event.type === "idd_setup_state"
      && event.iddSetupComplete === true
      && event.iddDocPreviews?.every((preview) => /^(written|approved)/.test(preview.status))
    );
    assert.equal(setupState.iddDocPreviews.length, 4);
    assert.equal(
      events.some((event) =>
        (event.type === "session_created" || event.type === "session_updated")
        && event.session?.pendingUserInput?.generation?.mode === "day1_handoff"
      ),
      false,
    );
    for (const rel of ["docs/GOAL.md", "docs/ICP.md", "docs/VALUES.md", "docs/SPEC.md"]) {
      const content = await fs.readFile(path.join(root, rel), "utf8");
      assert.match(content, /Day 1 Handoff/);
    }
    const goal = await fs.readFile(path.join(root, "docs", "GOAL.md"), "utf8");
    assert.match(goal, /기존 목표는 보존한다/);

    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("IDD follow-up uses sidecar agent synthesis instead of host template when available", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-followup-synth-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-followup-synth-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_TEST_IDD_AGENT_SYNTHESIS_JSON: JSON.stringify({
        title: "VALUES 결정",
        header: "결정 원칙",
        helperText: "직전 답변의 속도보다 증거 원칙을 Agentic30 질문 카드 흐름에 연결합니다.",
        question: "증거 우선 원칙을 지키려고 이번 주 어떤 Agentic30 결정을 미루나요?",
        options: [
          { label: "Day 확장 미루기", description: "첫 질문 품질 증거가 생길 때까지 다음 Day를 열지 않습니다.", nextIntent: "values_delay_days" },
          { label: "직접입력", description: "이번 주 미룰 결정을 직접 적습니다.", nextIntent: "values_custom_compact" },
          { label: "기타 - 설명", description: "이번 주 미룰 결정을 직접 적습니다.", nextIntent: "values_custom_dash" },
          { label: "자동 문서 승인 미루기", description: "근거 없는 통과보다 사용자의 한 줄 결정을 요구합니다.", nextIntent: "values_delay_auto_approval" },
          { label: "기타 입력", description: "이번 주 미룰 결정을 직접 적습니다.", nextIntent: "values_custom_korean" },
          { label: "UI polish 미루기", description: "보기 좋은 카드보다 답변이 실제 결정으로 이어지는지 봅니다.", nextIntent: "values_delay_polish" },
          { label: "기타(직접 입력)", description: "이번 주 미룰 결정을 직접 적습니다.", nextIntent: "values_custom_parentheses" },
          { label: "Other: describe", description: "Describe another tradeoff.", nextIntent: "values_custom_other" },
          { label: "Other - describe", description: "Describe another tradeoff.", nextIntent: "values_custom_other_dash" },
        ],
        freeTextPlaceholder: "예: 첫 질문이 프로젝트 맥락을 반영할 때까지 Day 2 오픈은 미룬다",
      }),
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");

    ws.send(JSON.stringify({
      type: "bip_idd_start_queue",
      sessionId: created.session.id,
      provider: "codex",
      docType: "values",
    }));

    const iddReady = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.title === "초기 설정: VALUES"
      && event.session?.status === "awaiting_input"
      && event.session?.pendingUserInput?.generation?.mode === "sidecar_agent_synthesized"
    );
    const request = iddReady.session.pendingUserInput;

    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId: iddReady.session.id,
      requestId: request.requestId,
      responses: [{
        question: request.questions[0].question,
        selectedOptions: [request.questions[0].options[0].label],
        freeText: "속도보다 증거를 우선하고 Day 확장은 하지 않는다",
      }],
    }));

    const followup = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === iddReady.session.id
      && event.session?.status === "awaiting_input"
      && event.session?.pendingUserInput?.requestId
      && event.session.pendingUserInput.requestId !== request.requestId
    );
    assert.equal(followup.session.pendingUserInput.generation?.mode, "sidecar_agent_synthesized");
    assert.equal(followup.session.pendingUserInput.generation?.docType, "values");
    assert.match(followup.session.pendingUserInput.questions[0].question, /Agentic30 결정을 미루/);
    const labels = followup.session.pendingUserInput.questions[0].options.map((option) => option.label);
    assert.deepEqual(labels.slice(0, 3), ["Day 확장 미루기", "자동 문서 승인 미루기", "UI polish 미루기"]);
    assert.doesNotMatch(labels.join("\n"), /직접\s*입력|직접입력|기타(?:\s*[-:]?\s*\S*)?|Other\s*[:：-]\s*describe/i);
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("recoverable IDD setup error retry creates host question without provider run", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-error-retry-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-error-retry-app-"));
  await writeDay1Fixture(root, appSupportPath);
  await fs.mkdir(path.join(root, ".agentic30", "idd"), { recursive: true });
  await fs.writeFile(
    path.join(root, ".agentic30", "idd", "setup-state.json"),
    JSON.stringify({
      schemaVersion: 1,
      status: "error",
      currentDocType: "icp",
      docOrder: ["icp", "goal", "values", "spec"],
      transcript: [],
      drafts: {},
      lastProvider: "codex",
      setupError: {
        provider: "codex",
        docType: "icp",
        message: "sidecar MCP의 `list_workspace_files` 호출이 `user cancelled MCP tool call`로 취소되었습니다.",
        recoverable: true,
      },
    }, null, 2),
    "utf8",
  );

  const env = {
    ...process.env,
    AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
    AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
    AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS: "1",
    CODEX_API_KEY: "",
    OPENAI_API_KEY: "",
  };
  delete env.AGENTIC30_TEST_STUB_PROVIDER;
  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");

    ws.send(JSON.stringify({
      type: "bip_idd_start_queue",
      sessionId: created.session.id,
      provider: "codex",
      docType: "icp",
    }));

    const iddReady = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.title === "초기 설정: 고객 후보"
      && event.session?.status === "awaiting_input"
      && event.session?.pendingUserInput?.toolName === "agentic30_request_user_input"
    );
    assert.equal(iddReady.session.pendingUserInput.generation?.mode, "host_structured");
    assert.equal(iddReady.session.pendingUserInput.generation?.docType, "icp");
    assert.match(iddReady.session.pendingUserInput.questions[0].question, /가장 먼저 인터뷰할 .*유형/);
    assert.equal(events.some((event) => event.type === "tool_event"), false);
    assert.equal(
      events.some((event) =>
        event.type === "session_updated"
        && event.session?.messages?.some((message) =>
          message.performance?.marks?.some((mark) => /provider\./.test(mark.phase))
        )
      ),
      false,
    );
    // idd_setup_state may land after the awaiting_input update under load; wait
    // for the interviewing state rather than reading the latest event eagerly.
    const setupState = await waitForEvent(events, (event) =>
      event.type === "idd_setup_state"
      && event.iddSetupStatus === "interviewing"
    );
    assert.equal(setupState.iddSetupStatus, "interviewing");
    assert.equal(setupState.iddSetupError, null);
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("IDD auto-start resumes persisted interviewing state without showing setup error", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-interviewing-resume-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-interviewing-resume-app-"));
  await writeDay1Fixture(root, appSupportPath);
  await writeIddSetupState(root, {
    schemaVersion: 1,
    status: "interviewing",
    currentDocType: "icp",
    docOrder: ["icp", "goal", "values", "spec"],
    transcript: [],
    drafts: {},
    lastProvider: "codex",
    providerRecovery: null,
    setupError: null,
  });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS: "1",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);
    const fixture = await loadIddAutostartFixture();

    ws.send(JSON.stringify(fixture.request));

    const gate = await waitForEvent(events, (event) =>
      event.type === "bip_setup_gate_state"
      && event.iddSetupStatus === "interviewing"
    );
    assertContainsShape(gate, fixture.events.find((event) => event.type === "bip_setup_gate_state"), "autostart gate event");

    const created = await waitForEvent(events, (event) =>
      event.type === "session_created"
      && event.session?.title === "초기 설정: 고객 후보"
      && event.session?.pendingUserInput?.toolName === "agentic30_request_user_input"
    );
    assertContainsShape(created, fixture.events.find((event) => event.type === "session_created"), "autostart session event");

    // The idd_setup_state event can trail session_created under load; wait for the
    // interviewing state instead of reading the latest event immediately.
    const setupState = await waitForEvent(events, (event) =>
      event.type === "idd_setup_state"
      && event.iddSetupStatus === "interviewing"
    );
    assertContainsShape(setupState, fixture.events.find((event) => event.type === "idd_setup_state"), "autostart setup event");
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("IDD auto-start resumes the persisted current document instead of the first missing doc", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-interviewing-current-doc-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-interviewing-current-doc-app-"));
  await writeDay1Fixture(root, appSupportPath);
  await writeIddSetupState(root, {
    schemaVersion: 1,
    status: "interviewing",
    currentDocType: "values",
    docOrder: ["icp", "goal", "values", "spec"],
    transcript: [],
    drafts: {},
    lastProvider: "codex",
    providerRecovery: null,
    setupError: null,
  });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS: "1",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({
      type: "bip_setup_gate_check",
      provider: "codex",
      autoStart: true,
    }));

    const created = await waitForEvent(events, (event) =>
      event.type === "session_created"
      && event.session?.title === "초기 설정: VALUES"
      && event.session?.pendingUserInput?.toolName === "agentic30_request_user_input"
    );
    assert.equal(created.session.pendingUserInput.generation?.docType, "values");

    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("IDD auto-start recovers legacy stale setup error caused by interrupted interviewing state", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-stale-error-autostart-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-stale-error-autostart-app-"));
  await writeDay1Fixture(root, appSupportPath);
  await writeIddSetupState(root, {
    schemaVersion: 1,
    status: "error",
    currentDocType: "icp",
    docOrder: ["icp", "goal", "values", "spec"],
    transcript: [],
    drafts: {},
    lastProvider: "codex",
    providerRecovery: null,
    setupError: {
      provider: "codex",
      docType: "icp",
      message: "이전 초기 설정 인터뷰가 완료 이벤트 없이 중단됐습니다. 다시 시도해 주세요.",
      recoverable: true,
    },
  });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS: "1",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({
      type: "bip_setup_gate_check",
      provider: "codex",
      autoStart: true,
    }));

    await waitForEvent(events, (event) =>
      event.type === "bip_setup_gate_state"
      && event.iddSetupStatus === "error"
      && /완료 이벤트 없이 중단/.test(event.iddSetupError?.message ?? "")
    );

    const created = await waitForEvent(events, (event) =>
      event.type === "session_created"
      && event.session?.title === "초기 설정: 고객 후보"
      && event.session?.pendingUserInput?.toolName === "agentic30_request_user_input"
    );
    assert.equal(created.session.pendingUserInput.generation?.docType, "icp");

    // The recovered idd_setup_state event can arrive after session_created under
    // load, so wait for the terminal interviewing state instead of reading the
    // latest event immediately (order-independent — avoids a flaky undefined read).
    const setupState = await waitForEvent(events, (event) =>
      event.type === "idd_setup_state"
      && event.iddSetupStatus === "interviewing"
    );
    assert.equal(setupState.iddSetupStatus, "interviewing");
    assert.equal(setupState.iddSetupError, null);
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("IDD auto-start preserves persisted setup error until explicit retry", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-error-autostart-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-error-autostart-app-"));
  await writeDay1Fixture(root, appSupportPath);
  await writeIddSetupState(root, {
    schemaVersion: 1,
    status: "error",
    currentDocType: "icp",
    docOrder: ["icp", "goal", "values", "spec"],
    transcript: [],
    drafts: {},
    lastProvider: "codex",
    providerRecovery: null,
    setupError: {
      provider: "codex",
      docType: "icp",
      message: "질문 카드 준비가 중단됐습니다.",
      recoverable: true,
    },
  });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS: "1",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({
      type: "bip_setup_gate_check",
      provider: "codex",
      autoStart: true,
    }));

    const gate = await waitForEvent(events, (event) =>
      event.type === "bip_setup_gate_state"
      && event.iddSetupStatus === "error"
    );
    assert.equal(gate.iddSetupError?.docType, "icp");
    assert.match(gate.iddSetupError?.message ?? "", /질문 카드 준비/);

    await assertNoEventUntil(
      events,
      (event) => event.type === "session_created" || event.type === "bip_idd_session_ready",
      400,
      "unexpected IDD session start",
    );
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("concurrent IDD start requests create only one initial setup session", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-concurrent-start-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-concurrent-start-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_DISABLE_IDD_AGENT_SYNTHESIS: "1",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: "",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    const payload = {
      type: "bip_idd_start_queue",
      provider: "codex",
      docType: "icp",
    };
    ws.send(JSON.stringify(payload));
    ws.send(JSON.stringify(payload));

    const created = await waitForEvent(events, (event) =>
      event.type === "session_created"
      && event.session?.title === "초기 설정: 고객 후보"
      && event.session?.pendingUserInput?.toolName === "agentic30_request_user_input"
    );
    await assertNoEventUntil(
      events,
      (event) =>
        event.type === "session_created"
        && event.session?.title === "초기 설정: 고객 후보"
        && event.session?.id !== created.session.id,
      400,
      "duplicate initial setup session",
    );

    const createdIds = new Set(events
      .filter((event) => event.type === "session_created" && event.session?.title === "초기 설정: 고객 후보")
      .map((event) => event.session.id));
    assert.equal(createdIds.size, 1);
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("Post-Foundation Day 1 ICP coaching records a five-turn local conversation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-post-foundation-day1-icp-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-post-foundation-day1-icp-app-"));
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(root, "docs", "ICP.md"),
    [
      "# Ideal Customer Profile (ICP)",
      "전업 1인 개발자, 수익 0원, macOS 사용자, 고객 인터뷰 의향 보유.",
    ].join("\n\n"),
  );
  await fs.writeFile(
    path.join(root, "docs", "SPEC.md"),
    [
      "# SPEC",
      "Day 1은 builder-state 진단 후 SPEC.md v0 proof baseline과 다음 proof target을 정한다.",
    ].join("\n\n"),
  );
  await fs.writeFile(
    path.join(appSupportPath, "bip-config.json"),
    JSON.stringify({
      workspace: {
        root,
        icp: "docs/ICP.md",
        spec: "docs/SPEC.md",
        designSystem: "",
        adr: "",
        goal: "",
      },
      externalDocs: { googleDocs: [], googleSheets: [], notion: [] },
      social: { threads: "", x: "" },
    }, null, 2),
  );

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      AGENTIC30_CODEX_MODEL: "gpt-5.4-mini",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.4-mini",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");
    const sessionId = created.session.id;
    assert.equal(created.session.pendingUserInput, null);
    assert.notEqual(created.session.status, "awaiting_input");

    const turns = [
      "DAY1_ICP_TURN_1: Day 1 시작. docs/ICP.md 기준으로 내가 맞는 유저인지 먼저 진단해줘.",
      "DAY1_ICP_TURN_2: 나는 퇴사한 전업 1인 개발자이고 수익은 0원, macOS에서 Codex를 쓴다. Day 1 builder-state를 판정해줘.",
      "DAY1_ICP_TURN_3: 이미 랜딩 페이지와 작은 프로토타입은 있다. Day 1 blank-slate discovery가 아니라 fast path로 가야 하는지 확인해줘.",
      "DAY1_ICP_TURN_4: SPEC.md v0 proof baseline에는 어떤 현재 상태와 다음 proof target을 남겨야 해?",
      "DAY1_ICP_TURN_5: 5턴 대화의 결론으로 오늘 바로 실행할 우선순위 1개와 확인할 응답을 정리해줘.",
    ];

    const timings = [];
    for (const [index, prompt] of turns.entries()) {
      const startedAt = performance.now();
      ws.send(JSON.stringify({ type: "send_prompt", sessionId, prompt }));
      const updated = await waitForEvent(events, (event) => {
        if (event.type !== "session_updated" || event.session?.id !== sessionId) return false;
        const messages = event.session.messages ?? [];
        return messages.some((message) => message.role === "user" && message.content.includes(`DAY1_ICP_TURN_${index + 1}`))
          && messages.some((message) => message.role === "assistant" && message.state === "final" && message.content.includes("ICP.md 확인"));
      });
      timings.push(performance.now() - startedAt);
      const answer = [...updated.session.messages]
        .reverse()
        .find((message) => message.role === "assistant" && message.state === "final" && message.content.includes("ICP.md 확인"))
        ?? {};
      assert.match(answer.content ?? "", /Day 1 응답/);
      assert.match(answer.content ?? "", /SPEC\.md v0 proof baseline/);
      assert.ok(
        answer.performance?.marks?.some((mark) => mark.phase === "provider.stub_response"),
        `Expected timing marks on stubbed answer, got ${JSON.stringify(answer.performance)}`,
      );
    }

    assert.equal(timings.length, 5);
    assert.ok(timings.every((elapsed) => elapsed < 10_000), `Expected all stub turns under 10s, got ${timings.join(", ")}`);
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.equal(stderr.trim(), "");
});

test("Day 1 ICP user completes a five-turn live Codex SDK conversation", {
  skip: process.env.AGENTIC30_RUN_LIVE_PROVIDER_E2E === "1"
    ? false
    : "Set AGENTIC30_RUN_LIVE_PROVIDER_E2E=1 to run the live Codex SDK Day 1 E2E.",
  timeout: 300_000,
}, async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-live-day1-icp-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-live-day1-icp-app-"));
  await writeDay1Fixture(root, appSupportPath);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", root], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_CODEX_MODEL: process.env.AGENTIC30_CODEX_MODEL || "gpt-5.4-mini",
      AGENTIC30_CODEX_REASONING_EFFORT: process.env.AGENTIC30_CODEX_REASONING_EFFORT || "low",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });
  let ws;

  try {
    const ready = await readSidecarReady(child);
    const events = [];
    ws = await connectAuthenticated(ready, events);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: process.env.AGENTIC30_CODEX_MODEL || "gpt-5.4-mini",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(events, (event) => event.type === "session_created", 30_000);
    const sessionId = created.session.id;
    assert.equal(created.session.pendingUserInput, null);

    const turns = liveDay1Turns();
    const timings = [];
    for (const [index, prompt] of turns.entries()) {
      const marker = `LIVE_DAY1_ICP_STEP_${index + 1}_OK`;
      const startedAt = performance.now();
      ws.send(JSON.stringify({ type: "send_prompt", sessionId, prompt }));
      const updated = await waitForEvent(events, (event) => {
        if (event.type !== "session_updated" || event.session?.id !== sessionId) return false;
        const messages = event.session.messages ?? [];
        return messages.some((message) => message.role === "user" && message.content.includes(`LIVE_DAY1_ICP_STEP_${index + 1}`))
          && messages.some((message) => message.role === "assistant" && message.state === "final" && message.content.includes(marker));
      }, 240_000);
      const elapsedMs = Math.round(performance.now() - startedAt);
      const answer = latestAssistantMessage(updated.session);
      assert.match(answer.content, /Day 1|ICP|1일차|builder/i);
      assert.ok(
        answer.performance?.marks?.some((mark) => mark.phase === "provider.codex.stream_opened"),
        `Expected live Codex timing marks, got ${JSON.stringify(answer.performance)}`,
      );
      timings.push({
        turn: index + 1,
        elapsedMs,
        performance: answer.performance,
      });
    }

    console.log(JSON.stringify({ type: "live_day1_icp_timings", timings }, null, 2));
    assert.equal(timings.length, 5);
    await closeWebSocket(ws);
    ws = null;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }

  assert.doesNotMatch(stderr, /AGENTIC30_TEST_STUB_PROVIDER/);
});

async function writeDay1Fixture(root, appSupportPath) {
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  await fs.writeFile(
    path.join(root, "docs", "ICP.md"),
    [
      "# Ideal Customer Profile (ICP)",
      "전업 1인 개발자, 수익 0원, macOS 사용자, 고객 인터뷰 의향 보유.",
    ].join("\n\n"),
  );
  await fs.writeFile(
    path.join(root, "docs", "SPEC.md"),
    [
      "# SPEC",
      "Day 1은 builder-state 진단 후 SPEC.md v0 proof baseline과 다음 proof target을 정한다.",
    ].join("\n\n"),
  );
  await fs.writeFile(
    path.join(appSupportPath, "bip-config.json"),
    JSON.stringify({
      workspace: {
        root,
        icp: "docs/ICP.md",
        spec: "docs/SPEC.md",
        designSystem: "",
        adr: "",
        goal: "",
      },
      externalDocs: { googleDocs: [], googleSheets: [], notion: [] },
      social: { threads: "", x: "" },
    }, null, 2),
  );
}

async function writeIddSetupState(root, state) {
  const iddDir = path.join(root, ".agentic30", "idd");
  await fs.mkdir(iddDir, { recursive: true });
  await fs.writeFile(
    path.join(iddDir, "setup-state.json"),
    `${JSON.stringify(state, null, 2)}\n`,
    "utf8",
  );
}

function liveDay1Turns() {
  return [
    "LIVE_DAY1_ICP_STEP_1: Day 1 시작. docs/ICP.md 기준으로 내가 맞는 유저인지 진단해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_1_OK 를 포함해.",
    "LIVE_DAY1_ICP_STEP_2: 나는 퇴사한 전업 1인 개발자이고 수익은 0원, macOS에서 Codex를 쓴다. Day 1 builder-state를 판정해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_2_OK 를 포함해.",
    "LIVE_DAY1_ICP_STEP_3: 이미 랜딩 페이지와 작은 프로토타입은 있다. blank-slate discovery 대신 fast path로 가야 하는지 확인해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_3_OK 를 포함해.",
    "LIVE_DAY1_ICP_STEP_4: SPEC.md v0 proof baseline에는 어떤 현재 상태와 다음 proof target을 남겨야 해? 응답에는 반드시 LIVE_DAY1_ICP_STEP_4_OK 를 포함해.",
    "LIVE_DAY1_ICP_STEP_5: 5턴 대화의 결론으로 오늘 바로 실행할 우선순위 1개와 확인할 응답을 정리해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_5_OK 를 포함해.",
  ];
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function loadIddAutostartFixture() {
  return JSON.parse(await fs.readFile(iddAutostartFixturePath, "utf8"));
}

async function assertNoEventUntil(events, predicate, timeoutMs, label) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = events.find(predicate);
    assert.equal(match, undefined, `Unexpected ${label}: ${JSON.stringify(match)}`);
    await sleep(25);
  }
}

function assertContainsShape(actual, expected, label = "value") {
  assert.notEqual(expected, undefined, `Missing expected ${label} fixture`);
  if (Array.isArray(expected)) {
    assert.ok(Array.isArray(actual), `Expected ${label} to be an array`);
    assert.ok(actual.length >= expected.length, `Expected ${label} to contain at least ${expected.length} items`);
    expected.forEach((item, index) => {
      assertContainsShape(actual[index], item, `${label}[${index}]`);
    });
    return;
  }
  if (expected && typeof expected === "object") {
    assert.ok(actual && typeof actual === "object", `Expected ${label} to be an object`);
    for (const [key, value] of Object.entries(expected)) {
      assertContainsShape(actual[key], value, `${label}.${key}`);
    }
    return;
  }
  assert.deepEqual(actual, expected, label);
}

function latestAssistantMessage(session) {
  return [...(session.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant" && message.state === "final") ?? {};
}

function readSidecarReady(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for sidecar ready")), 10_000);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      for (const line of buffer.split("\n")) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (
          parsed.type === "sidecar-ready"
          && Number.isFinite(parsed.port)
          && typeof parsed.authToken === "string"
          && parsed.authToken.length > 0
        ) {
          clearTimeout(timer);
          resolve(parsed);
        }
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Sidecar exited before ready: ${code}`));
    });
  });
}

function onceOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

async function connectAuthenticated(ready, events) {
  const ws = new WebSocket(`ws://127.0.0.1:${ready.port}`);
  ws.on("message", (raw) => events.push(JSON.parse(String(raw))));
  await onceOpen(ws);
  ws.send(JSON.stringify({ type: "authenticate", authToken: ready.authToken }));
  await waitForEvent(events, (event) => event.type === "ready");
  return ws;
}

async function closeWebSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    return;
  }
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.terminate();
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    ws.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.close();
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function waitForEvent(events, predicate, timeoutMs = 30_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = events.find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for matching sidecar event");
}

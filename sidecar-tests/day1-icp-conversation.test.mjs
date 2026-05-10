import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

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
    assert.equal(created.session.runtime?.startupTiming?.clientCountAtCreate, 1);
    assert.ok(
      Number.isFinite(created.session.runtime?.startupTiming?.processToSessionCreatedMs),
      `Expected process-to-session timing, got ${JSON.stringify(created.session.runtime?.startupTiming)}`,
    );
    assert.ok(
      Number.isFinite(created.session.runtime?.startupTiming?.processToSidecarReadyMs),
      `Expected process-to-ready timing, got ${JSON.stringify(created.session.runtime?.startupTiming)}`,
    );
    assert.ok(
      Number.isFinite(created.session.runtime?.startupTiming?.sidecarReadyToCreateSessionReceivedMs),
      `Expected ready-to-create timing, got ${JSON.stringify(created.session.runtime?.startupTiming)}`,
    );
    assert.ok(
      created.session.runtime.startupTiming.processToSessionCreatedMs < 5_000,
      `Expected local session to appear quickly, got ${JSON.stringify(created.session.runtime.startupTiming)}`,
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
          selectedOptions: [],
          freeText: "Day 1 뭐부터 시작해야 해? ICP 기준으로 짧게 진단해줘.",
        }],
      }));
    } else {
      ws.send(JSON.stringify({
        type: "send_prompt",
        sessionId,
        prompt: "Day 1 뭐부터 시작해야 해? ICP 기준으로 짧게 진단해줘.",
      }));
    }

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
        freeText: "Day 1 뭐부터 시작해야 해? ICP 기준으로 짧게 진단해줘.",
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
      "추가 결정이나 누락 정보가 필요하면 반드시 agentic30_request_user_input MCP 도구로 한 질문씩 이어가세요.",
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

test("Codex IDD queue starts non-ICP docs with host-side structured input and no provider fallback", async () => {
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
      docType: "sheet",
    }));

    const iddCreated = await waitForEvent(events, (event) =>
      event.type === "session_created"
      && event.session?.title === "기준 정리: 공개 기록 기준"
    );
    const iddReady = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === iddCreated.session.id
      && event.session?.status === "awaiting_input"
      && event.session?.pendingUserInput?.toolName === "agentic30_request_user_input"
    );

    assert.equal(iddReady.session.status, "awaiting_input");
    assert.equal(iddReady.session.pendingUserInput?.toolName, "agentic30_request_user_input");
    assert.equal(iddReady.session.pendingUserInput?.title, "공개 기록 기준 정하기");
    assert.equal(iddReady.session.runtime?.iddDocumentType, "sheet");
    assert.equal(iddReady.session.messages.length, 0);
    assert.ok(iddReady.session.runtime?.pendingIddContinuation?.prompt);
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

test("BIP setup auto-start returns local mission choices before docs are fully ready", async () => {
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

    const completed = await waitForEvent(events, (event) =>
      event.type === "bip_coach_generation_completed"
      && event.bipCoach?.missionChoices?.length === 3
      && event.bipCoach?.evidence?.source === "partial_workspace"
    );

    assert.equal(completed.bipCoach.missionChoices.length, 3);
    assert.equal(completed.bipCoach.evidence.source, "partial_workspace");
    assert.match(completed.bipCoach.evidence.summary, /오늘 실행 후보/);
    assert.equal(events.some((event) => event.type === "bip_idd_session_ready"), false);
    assert.equal(events.some((event) =>
      event.type === "session_created"
      && event.session?.title?.startsWith("기준 정리:")
    ), false);

    const updated = await waitForEvent(events, (event) =>
      event.type === "session_updated"
      && event.session?.id === created.session.id
      && event.session?.messages?.some((message) => message.bipMissionChoices?.length === 3)
    );
    assert.match(latestAssistantMessage(updated.session).content, /문서 준비가 아직 끝나지 않아도 오늘 실행/);
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

test("Day 1 ICP sidecar timing instrumentation records a five-turn local conversation", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-icp-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-icp-app-"));
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

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created");
    const sessionId = created.session.id;
    const requestId = created.session.pendingUserInput.requestId;
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId,
      requestId,
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
    }));
    const created = await waitForEvent(events, (event) => event.type === "session_created", 30_000);
    const sessionId = created.session.id;
    if (created.session.pendingUserInput) {
      ws.send(JSON.stringify({
        type: "submit_user_input",
        sessionId,
        requestId: created.session.pendingUserInput.requestId,
        responses: [{
          question: "무엇부터 시작할까요?",
          selectedOptions: ["프로젝트 전략 문서 만들기"],
          freeText: "Use docs/ICP.md as my user profile for Day 1.",
        }],
      }));
      await waitForEvent(events, (event) => event.type === "session_updated" && event.session?.id === sessionId && !event.session.pendingUserInput, 30_000);
    }

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

function liveDay1Turns() {
  return [
    "LIVE_DAY1_ICP_STEP_1: Day 1 시작. docs/ICP.md 기준으로 내가 맞는 유저인지 진단해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_1_OK 를 포함해.",
    "LIVE_DAY1_ICP_STEP_2: 나는 퇴사한 전업 1인 개발자이고 수익은 0원, macOS에서 Codex를 쓴다. Day 1 builder-state를 판정해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_2_OK 를 포함해.",
    "LIVE_DAY1_ICP_STEP_3: 이미 랜딩 페이지와 작은 프로토타입은 있다. blank-slate discovery 대신 fast path로 가야 하는지 확인해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_3_OK 를 포함해.",
    "LIVE_DAY1_ICP_STEP_4: SPEC.md v0 proof baseline에는 어떤 현재 상태와 다음 proof target을 남겨야 해? 응답에는 반드시 LIVE_DAY1_ICP_STEP_4_OK 를 포함해.",
    "LIVE_DAY1_ICP_STEP_5: 5턴 대화의 결론으로 오늘 바로 실행할 우선순위 1개와 확인할 응답을 정리해줘. 응답에는 반드시 LIVE_DAY1_ICP_STEP_5_OK 를 포함해.",
  ];
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

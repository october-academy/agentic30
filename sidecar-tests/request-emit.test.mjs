import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workspace setup request_emit envelopes are host-routed and completion waits for first input", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await fs.mkdir(path.join(harness.workspacePath, "docs"), { recursive: true });
    await fs.writeFile(path.join(harness.workspacePath, "docs", "ICP.md"), "# ICP\n");
    await fs.writeFile(path.join(harness.workspacePath, "docs", "SPEC.md"), "# SPEC\n");

    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "where are the docs paths?",
    }));

    const started = await waitForEvent(ws.events, (event) =>
      event.type === "request_emit" && event.event === "workspace_setup_started",
    );
    assertRequestEmitEnvelope(started, "workspace_setup_started");

    const scanResult = await waitForEvent(ws.events, (event) => event.type === "workspace_scan_result");
    const scanStarted = ws.events.find((event) => event.type === "workspace_scan_started");
    assert.equal(scanStarted?.stage, "local");
    assert.equal(scanStarted?.stepIndex, 1);
    assert.equal(scanStarted?.totalSteps, 3);
    const scanStartedIndex = ws.events.findIndex((event) => event === scanStarted);
    const verifyingIndex = ws.events.findIndex((event) =>
      event.type === "workspace_scan_progress"
        && event.stage === "verifying"
        && event.stepIndex === 2
        && event.totalSteps === 3
        && event.foundCount >= 2
    );
    const composingIndex = ws.events.findIndex((event) =>
      event.type === "workspace_scan_progress"
        && event.stage === "composing"
        && event.stepIndex === 3
        && event.totalSteps === 3
    );
    assert.notEqual(verifyingIndex, -1, "local-only scan should emit structured verifying progress");
    assert.notEqual(composingIndex, -1, "scan_workspace should emit structured composing progress");
    assert.ok(
      scanStartedIndex < verifyingIndex && verifyingIndex < composingIndex,
      "local-only scan progress should move from 1/3 to 2/3 to 3/3",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_progress"
          && event.stage === "composing"
          && event.stepIndex === 3
          && event.totalSteps === 3
      ),
      true,
      "scan_workspace should emit structured composing progress",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_progress"
          && event.stage === "merged"
          && event.stepIndex === 3
          && event.totalSteps === 3
          && event.foundCount >= 2
      ),
      true,
      "scan_workspace should emit structured merged progress with foundCount",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_progress"
          && event.progressText === "frontier 선택지 생성 중"
      ),
      false,
      "background frontier enrichment must not reuse foreground workspace_scan_progress",
    );
    assert.equal(scanResult.day1Context, undefined);
    assert.equal(scanResult.composedOpening, undefined);
    assert.equal(scanResult.day1AlignmentPlan?.schemaVersion, 1);
    assert.equal(scanResult.day1AlignmentPlan?.components?.icp?.title, "고객");
    assert.equal(scanResult.day1AlignmentPlan?.components?.painPoint?.title, "문제");
    assert.equal(scanResult.day1AlignmentPlan?.components?.outcome?.title, "확인할 행동");
    assert.equal(typeof scanResult.day1AlignmentPlan?.qualityGate?.score, "number");
    assert.equal(scanResult.day1IcpPlan?.schemaVersion, 1);
    assert.ok(Array.isArray(scanResult.day1IcpPlan?.questions));
    assert.equal(
      ws.events.some((event) => event.type === "workspace_day1_compose_result"),
      false,
      "scan_workspace must not emit the legacy Day 1 compose event",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "request_emit" && event.event === "workspace_setup_completed",
      ),
      false,
      "scan success alone must not complete workspace setup",
    );

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.pendingUserInput?.requestId,
    );

    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId: created.session.id,
      requestId: created.session.pendingUserInput.requestId,
      responses: [
        {
          question: "무엇부터 시작할까요?",
          selectedOptions: ["워크스페이스 살펴보기"],
          freeText: "",
        },
      ],
    }));

    const completed = await waitForEvent(ws.events, (event) =>
      event.type === "request_emit" && event.event === "workspace_setup_completed",
    );
    assertRequestEmitEnvelope(completed, "workspace_setup_completed");
    assert.equal(completed.properties.workspace_basename, path.basename(harness.workspacePath));
    assert.equal(completed.properties.input_source, "structured_input");
    assert.equal(typeof completed.properties.elapsed_ms, "number");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start preserves custom source and ignores duplicate concurrent starts", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.4-mini",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    const officeHoursStartPayload = {
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "Workspace: Revenue analytics dashboard. ICP: B2B founders. Problem: activation drop-off.",
      visiblePrompt: "Test Office Hours on current project",
      source: "day1_real_project_test",
    };
    ws.send(JSON.stringify(officeHoursStartPayload));
    ws.send(JSON.stringify(officeHoursStartPayload));

    const started = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.runtime?.officeHours?.source === "day1_real_project_test",
    );
    const duplicateError = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && event.sessionId === created.session.id
        && /waiting for the current run/i.test(event.message || ""),
    );
    const questionReadyStatus = await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "question_ready",
    );
    const questionReadyStatusIndex = ws.events.indexOf(questionReadyStatus);
    const pendingInputUpdate = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.pendingUserInput?.questions?.[0]?.questionId === "office_hours_demand_evidence",
    );
    assert.deepEqual(
      pendingInputUpdate.session.pendingUserInput.questions[0].options.map((option) => option.label),
      [
        "실제 결제/계약이 있었다",
        "구매 조건이 구체적으로 확인됐다",
        "현재 대안에 돈/시간을 쓰고 있다",
        "관심만 있거나 아직 증거가 없다",
      ],
    );
    const statusStages = ws.events
      .filter((event) => event.type === "office_hours_status" && event.sessionId === created.session.id)
      .map((event) => event.stage);
    assertStatusOrder(statusStages, [
      "context_loaded",
      "specialist_routed",
      "provider_starting",
      "structured_input_requested",
      "question_ready",
    ]);
    assert.equal(statusStages.some((stage) => String(stage || "").includes("fallback")), false);
    const providerStatus = ws.events.find((event) =>
      event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "provider_starting"
    );
    assert.equal(providerStatus.title, "첫 질문 준비 중");
    assert.equal(providerStatus.detail, "프로젝트 맥락에 맞는 첫 질문을 준비하고 있습니다.");
    assert.equal(providerStatus.progressText, "프로젝트 맥락에 맞는 첫 질문 준비 중");
    assert.equal(questionReadyStatus.title, "첫 질문 준비 완료");
    assert.equal(questionReadyStatus.progressText, "첫 질문 준비 완료");
    assert.equal(typeof providerStatus.elapsedMs, "number");
    assert.equal(started.session.runtime.officeHours.active, true);
    assert.equal(started.session.runtime.officeHours.source, "day1_real_project_test");
    assert.match(started.session.runtime.officeHours.context, /Revenue analytics dashboard/);
    assert.equal(duplicateError.sessionId, created.session.id);
    assert.equal(
      started.session.messages.filter((message) =>
        message.role === "user" && message.content === "Test Office Hours on current project",
      ).length,
      1,
    );

    const firstQuestion = pendingInputUpdate.session.pendingUserInput.questions[0];
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId: created.session.id,
      requestId: pendingInputUpdate.session.pendingUserInput.requestId,
      responses: [
        {
          question: firstQuestion.question,
          selectedOptions: [firstQuestion.options[0].label],
          freeText: "",
        },
      ],
    }));
    const followupProviderStatus = await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "provider_starting"
        && ws.events.indexOf(event) > questionReadyStatusIndex,
    );
    assert.equal(followupProviderStatus.title, "다음 질문 준비 중");
    assert.equal(
      followupProviderStatus.detail,
      "답변과 프로젝트 맥락에 맞는 다음 질문을 준비하고 있습니다.",
    );
    assert.equal(followupProviderStatus.progressText, "프로젝트 맥락에 맞는 다음 질문 준비 중");

    ws.send(JSON.stringify({ type: "stop_session", sessionId: created.session.id }));
    await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "idle",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("day1_goal_save/get persists goal state and hydrates scan/project context", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "day1_goal_get",
      workspaceRoot: harness.workspacePath,
    }));
    const initial = await waitForEvent(ws.events, (event) =>
      event.type === "day1_goal_state"
        && event.workspaceRoot === harness.workspacePath
        && event.day1GoalSelection == null,
    );
    assert.equal(initial.day1GoalSelection, null);
    ws.events.length = 0;

    const selection = {
      goalType: "make_money",
      goalText: "Support leads will pay to avoid missed Slack escalations.",
      customer: "B2B support leads",
      problem: "Slack escalations are missed during handoff.",
      validationAction: "Ask three support leads for a paid pilot.",
      evidenceRefs: ["README.md", "docs/ICP.md"],
      proofSink: "bip_optional",
      sourcePlanFingerprint: "scan-fingerprint-1",
      selectedAt: "2026-06-06T00:00:00.000Z",
      schemaVersion: 1,
    };
    ws.send(JSON.stringify({
      type: "day1_goal_save",
      workspaceRoot: harness.workspacePath,
      selection,
    }));
    const saved = await waitForEvent(ws.events, (event) =>
      event.type === "day1_goal_state"
        && event.workspaceRoot === harness.workspacePath
        && event.day1GoalSelection?.goalType === "make_money",
    );
    assert.equal(saved.day1GoalSelection.proofSink, "bip_optional");
    assert.equal(saved.projectContext.targetUser, "B2B support leads");
    assert.equal(saved.projectContext.problem, "Slack escalations are missed during handoff.");
    assert.equal(saved.projectContext.goal, "Support leads will pay to avoid missed Slack escalations.");

    const goalPath = path.join(harness.workspacePath, ".agentic30", "day1-goal.json");
    const persistedGoal = JSON.parse(await fs.readFile(goalPath, "utf8"));
    assert.equal(persistedGoal.goalType, "make_money");
    assert.equal(persistedGoal.proofSink, "bip_optional");

    const contextPath = path.join(harness.workspacePath, ".agentic30", "project-context.json");
    const persistedContext = JSON.parse(await fs.readFile(contextPath, "utf8"));
    assert.equal(persistedContext.targetUser, "B2B support leads");
    assert.equal(persistedContext.goal, "Support leads will pay to avoid missed Slack escalations.");

    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "day1_goal_get",
      workspaceRoot: harness.workspacePath,
    }));
    await waitForEvent(ws.events, (event) =>
      event.type === "day1_goal_state"
        && event.workspaceRoot === harness.workspacePath
        && event.day1GoalSelection?.sourcePlanFingerprint === "scan-fingerprint-1",
    );

    ws.events.length = 0;
    await fs.writeFile(path.join(harness.workspacePath, "README.md"), "# SupportLens\n");
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "scan after goal save",
    }));
    const scanResult = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_result"
        && event.scanRoot === harness.workspacePath
        && event.day1GoalSelection?.goalType === "make_money",
    );
    assert.equal(scanResult.day1GoalSelection.customer, "B2B support leads");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("workspace setup failures use the same request_emit envelope shape", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    const missingRoot = path.join(harness.workspacePath, "missing");

    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: missingRoot,
      prompt: "where are the docs paths?",
    }));

    const scanResult = await waitForEvent(ws.events, (event) => event.type === "workspace_scan_result");
    assert.equal(scanResult.stage, "failed");
    assert.equal(scanResult.stepIndex, 1);
    assert.equal(scanResult.totalSteps, 3);
    assert.equal(scanResult.foundCount, 0);

    const failed = await waitForEvent(ws.events, (event) =>
      event.type === "request_emit" && event.event === "workspace_setup_failed",
    );
    assertRequestEmitEnvelope(failed, "workspace_setup_failed");
    assert.equal(failed.properties.workspace_basename, "missing");
    assert.ok(failed.properties.error_name);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("sidecar rejects unauthenticated websocket clients before ready payload", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(String(raw))));
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: "list_sessions" }));
    const close = await onceClose(ws);
    assert.equal(close.code, 1008);
    assert.equal(events.some((event) => event.type === "ready"), false);
  } finally {
    ws?.terminate();
    await harness.close();
  }
});

test("sidecar rejects websocket clients with an invalid auth token", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
    const events = [];
    ws.on("message", (raw) => events.push(JSON.parse(String(raw))));
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: "authenticate", authToken: "wrong-token" }));
    const close = await onceClose(ws);
    assert.equal(close.code, 1008);
    assert.equal(events.some((event) => event.type === "ready"), false);
  } finally {
    ws?.terminate();
    await harness.close();
  }
});

function assertRequestEmitEnvelope(event, expectedEvent) {
  assert.equal(event.type, "request_emit");
  assert.equal(event.event, expectedEvent);
  assert.equal(event.event_schema_version, 1);
  assert.equal(typeof event.properties, "object");
  assert.equal(Array.isArray(event.properties), false);
}

function assertStatusOrder(actualStages, expectedStages) {
  let cursor = -1;
  for (const stage of expectedStages) {
    const next = actualStages.findIndex((candidate, index) =>
      index > cursor && candidate === stage
    );
    assert.notEqual(next, -1, `Expected office_hours_status stage ${stage}; saw ${actualStages.join(", ")}`);
    cursor = next;
  }
}

async function spawnSidecar() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-request-emit-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(appSupportPath, { recursive: true });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspacePath], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
    },
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stdout = "";
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const ready = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      reject(new Error(`Timed out waiting for sidecar-ready. stderr:\n${stderr}`));
    }, 10_000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.stdout.on("data", (chunk) => {
      stdout += String(chunk);
      const lines = stdout.split("\n");
      stdout = lines.pop() ?? "";
      for (const line of lines) {
        try {
          const parsed = JSON.parse(line);
          if (parsed.type === "sidecar-ready" && parsed.port && parsed.authToken) {
            clearTimeout(timer);
            resolve(parsed);
          }
        } catch {
          // Ignore non-ready stdout.
        }
      }
    });
  });

  return {
    port: ready.port,
    authToken: ready.authToken,
    workspacePath,
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 2_000);
      });
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function connectAndCollect(harness) {
  const ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
  ws.events = [];
  ws.on("message", (raw) => {
    ws.events.push(JSON.parse(String(raw)));
  });
  await onceOpen(ws);
  ws.send(JSON.stringify({ type: "authenticate", authToken: harness.authToken }));
  await waitForEvent(ws.events, (event) => event.type === "ready");
  return ws;
}

function onceOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

function onceClose(ws) {
  return new Promise((resolve) => {
    ws.once("close", (code, reason) => resolve({ code, reason: String(reason || "") }));
  });
}

async function waitForEvent(events, predicate, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for event. Saw: ${events.map((event) => event.type).join(", ")}`);
}

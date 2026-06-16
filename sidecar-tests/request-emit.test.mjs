import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  createUserInputRequest,
  listUserInputRequests,
} from "../sidecar/user-input.mjs";
import { saveDay1GoalSelection } from "../sidecar/day1-goal-state.mjs";
import {
  appendOfficeHoursTurn,
  loadDayMemory,
  loadOfficeHoursPendingQuestion,
  loadOfficeHoursTurnLog,
  saveOfficeHoursPendingQuestion,
  saveOnboardingMemory,
} from "../sidecar/workspace-memory.mjs";
import {
  persistNewsMarketRadarSnapshot,
} from "../sidecar/news-market-radar.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("workspace setup request_emit envelopes are host-routed and completion waits for first input", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await fs.mkdir(path.join(harness.workspacePath, "docs"), { recursive: true });
    await fs.mkdir(path.join(harness.workspacePath, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(harness.workspacePath, ".agentic30", "docs", "ICP.md"), "# ICP\n");
    await fs.writeFile(path.join(harness.workspacePath, ".agentic30", "docs", "SPEC.md"), "# SPEC\n");

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

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.1-codex-mini" }));
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

test("workspace gitignore consent gates .agentic30 ignore writes", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    await fs.mkdir(path.join(harness.workspacePath, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(harness.workspacePath, ".agentic30", "docs", "ICP.md"), "# ICP\n");
    await fs.writeFile(path.join(harness.workspacePath, ".agentic30", "docs", "SPEC.md"), "# SPEC\n");

    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "where are the docs paths?",
    }));

    const scanResult = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_result"
        && event.scanRoot === harness.workspacePath
    );
    assert.equal(scanResult.agentic30Gitignore?.status, "needs-consent");
    await assert.rejects(fs.stat(path.join(harness.workspacePath, ".gitignore")), /ENOENT/);

    ws.send(JSON.stringify({
      type: "workspace_gitignore_consent",
      root: harness.workspacePath,
      consented: false,
    }));
    const declined = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_gitignore_result"
        && event.scanRoot === harness.workspacePath
        && event.status === "declined"
    );
    assert.equal(declined.agentic30Gitignore?.status, "declined");
    await assert.rejects(fs.stat(path.join(harness.workspacePath, ".gitignore")), /ENOENT/);

    ws.send(JSON.stringify({
      type: "workspace_gitignore_consent",
      root: harness.workspacePath,
      consented: true,
    }));
    const added = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_gitignore_result"
        && event.scanRoot === harness.workspacePath
        && event.status === "added"
    );
    assert.equal(added.agentic30Gitignore?.entry, ".agentic30/");
    const content = await fs.readFile(path.join(harness.workspacePath, ".gitignore"), "utf8");
    assert.match(content, /\.agentic30\//);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start preserves custom source and ignores duplicate concurrent starts", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_PROVIDER_DELAY_MS: "500",
    },
  });
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 2,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );
    assert.equal(created.session.title, "Office Hours · Day 2");
    assert.equal(created.session.runtime.officeHours.active, false);
    assert.equal(created.session.runtime.officeHours.day, 2);

    const officeHoursStartPayload = {
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "Workspace: Revenue analytics dashboard. ICP: B2B founders. Problem: activation drop-off.",
      visiblePrompt: "Test Office Hours on current project",
      source: "office_hours_day_2",
      day: 2,
    };
    ws.send(JSON.stringify(officeHoursStartPayload));

    const started = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.runtime?.officeHours?.source === "office_hours_day_2",
    );
    await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "provider_starting",
    );
    ws.send(JSON.stringify(officeHoursStartPayload));
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
    assert.equal(
      ws.events.some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && /waiting for the current run/i.test(event.message || "")
      ),
      false,
      "duplicate Office Hours starts while a run is active must be idempotent",
    );
    const providerStartingEventsBeforeSubmit = ws.events.filter((event) =>
      event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "provider_starting"
    );
    assert.equal(
      providerStartingEventsBeforeSubmit.length,
      1,
      `duplicate Office Hours starts must not spawn a second provider run; saw ${JSON.stringify(providerStartingEventsBeforeSubmit.map((event) => ({
        title: event.title,
        detail: event.detail,
        progressText: event.progressText,
      })))}`,
    );
    assert.equal(started.session.runtime.officeHours.active, true);
    assert.equal(started.session.runtime.officeHours.source, "office_hours_day_2");
    assert.equal(started.session.runtime.officeHours.day, 2);
    assert.match(started.session.runtime.officeHours.context, /Revenue analytics dashboard/);
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
          freeText: firstQuestion.requiresFreeText === true
            ? "6/13 실명 후보 A가 결제 조건을 물었고 현재 대안 비용을 확인 중"
            : "",
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

    const stopStartIndex = ws.events.length;
    ws.send(JSON.stringify({ type: "stop_session", sessionId: created.session.id }));
    const idleSession = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "idle",
    );
    assert.equal(idleSession.session.error, null);
    await new Promise((resolve) => setTimeout(resolve, 250));
    assert.equal(
      ws.events.slice(stopStartIndex).some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && event.errorKind === "provider_aborted",
      ),
      false,
      "local stop_session cancellation must not be surfaced as provider_aborted",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start reports provider usage limits as recoverable error envelopes", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_FORCE_PROVIDER_USAGE_LIMIT: "claude",
    },
  });
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "claude",
      model: "claude-sonnet-4-6",
      suppressBootstrapIntake: true,
      officeHoursDay: 1,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: [
        "DAY1_LOCKED_GOAL",
        "Office Hours mode: Startup",
        "Expected question count: 6",
        "Goal lane: make_money / 첫 매출 달성",
        "Goal text: provider quota envelope regression",
        "Customer: B2B founder",
        "Problem: provider errors are double-captured",
        "Validation action: retry with another provider",
      ].join("\n"),
      visiblePrompt: "Test Office Hours provider quota",
      source: "day1_interview_goal_locked",
      day: 1,
    }));

    const failedStatus = await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "failed",
    );
    assert.match(failedStatus.detail, /weekly limit/);

    const recoverableError = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "provider_usage_limit",
    );
    assert.equal(recoverableError.provider, "claude");
    assert.equal(recoverableError.recoverable, true);
    assert.match(recoverableError.message, /weekly limit/);

    const erroredSession = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error",
    );
    assert.match(erroredSession.session.error, /weekly limit/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start reports provider aborts as recoverable error envelopes", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_FORCE_PROVIDER_ABORT: "claude",
    },
  });
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "claude",
      model: "claude-sonnet-4-6",
      suppressBootstrapIntake: true,
      officeHoursDay: 1,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: [
        "DAY1_LOCKED_GOAL",
        "Office Hours mode: Startup",
        "Expected question count: 6",
        "Goal lane: make_money / 첫 매출 달성",
        "Goal text: provider abort envelope regression",
        "Customer: B2B founder",
        "Problem: provider aborts are double-captured",
        "Validation action: retry with another provider",
      ].join("\n"),
      visiblePrompt: "Test Office Hours provider abort",
      source: "day1_interview_goal_locked",
      day: 1,
    }));

    const failedStatus = await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "failed",
    );
    assert.match(failedStatus.detail, /aborted by user/);

    const recoverableError = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "provider_aborted",
    );
    assert.equal(recoverableError.provider, "claude");
    assert.equal(recoverableError.recoverable, true);
    assert.match(recoverableError.message, /aborted by user/);

    const erroredSession = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error",
    );
    assert.match(erroredSession.session.error, /aborted by user/);
    assert.equal(
      ws.events.some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "aborted",
      ),
      false,
      "provider aborts must not be surfaced as local Office Hours cancellations",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("send_prompt reports provider aborts as recoverable error envelopes", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_FORCE_PROVIDER_ABORT: "claude",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "claude",
      model: "claude-sonnet-4-6",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    ws.send(JSON.stringify({
      type: "send_prompt",
      sessionId: created.session.id,
      prompt: "Test general prompt provider abort",
    }));

    const recoverableError = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "provider_aborted",
    );
    assert.equal(recoverableError.provider, "claude");
    assert.equal(recoverableError.recoverable, true);
    assert.match(recoverableError.message, /aborted by user/);

    const erroredSession = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error",
    );
    assert.match(erroredSession.session.error, /aborted by user/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_docs reports provider aborts as recoverable error envelopes", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_FORCE_PROVIDER_ABORT: "claude",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "claude",
      model: "claude-sonnet-4-6",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    ws.send(JSON.stringify({
      type: "send_prompt",
      sessionId: created.session.id,
      prompt: "/office-hours-docs provider abort contract",
    }));

    const recoverableError = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "provider_aborted",
    );
    assert.equal(recoverableError.provider, "claude");
    assert.equal(recoverableError.recoverable, true);
    assert.match(recoverableError.message, /aborted by user/);

    const failedStatus = await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "failed",
    );
    assert.match(failedStatus.detail, /aborted by user/);

    const erroredSession = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error",
    );
    assert.match(erroredSession.session.error, /aborted by user/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("foundation_chat reports provider aborts as recoverable error envelopes", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_FORCE_PROVIDER_ABORT: "claude",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "claude",
      model: "claude-sonnet-4-6",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    ws.send(JSON.stringify({
      type: "foundation_chat",
      sessionId: created.session.id,
      day: 0,
      prompt: "Test Foundation provider abort",
    }));

    const recoverableError = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "provider_aborted",
    );
    assert.equal(recoverableError.provider, "claude");
    assert.equal(recoverableError.recoverable, true);
    assert.match(recoverableError.message, /aborted by user/);

    const erroredSession = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error",
    );
    assert.match(erroredSession.session.error, /aborted by user/);
    assert.equal(
      ws.events.some((event) =>
        event.type === "foundation_chat_event"
          && event.sessionId === created.session.id
          && event.phase === "aborted",
      ),
      false,
      "provider aborts must not be surfaced as local Foundation cancellations",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start reports provider auth preflight failures as recoverable error envelopes", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_PROVIDER: "",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: "",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 1,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "Office Hours mode: Startup",
      visiblePrompt: "Test Office Hours auth preflight",
      source: "day1_interview_goal_locked",
      day: 1,
    }));

    const recoverableError = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "provider_auth_required",
    );
    assert.equal(recoverableError.provider, "codex");
    assert.equal(recoverableError.recoverable, true);
    assert.match(recoverableError.message, /CODEX_API_KEY|OPENAI_API_KEY|Codex/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours Codex-style MCP request waits for submit before continuation", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST: "1",
      AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST_DELAY_MS: "150",
    },
  });
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 1,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );

    const officeHoursStartPayload = {
      type: "office_hours_start",
      sessionId: created.session.id,
      context: [
        "DAY1_LOCKED_GOAL",
        "Flow contract: locked Day 1 goal interview.",
        "Office Hours mode: Startup",
        "Expected question count: 6",
        "Goal lane: make_money / 첫 매출 달성",
        "Goal text: Support leads will pay to avoid missed Slack escalations.",
        "Customer: B2B support lead",
        "Problem: Slack escalation을 놓친다",
        "Validation action: 유료 파일럿 ask",
      ].join("\n"),
      visiblePrompt: "Test non-blocking Codex Office Hours",
      source: "day1_interview_goal_locked",
      day: 1,
    };
    ws.send(JSON.stringify(officeHoursStartPayload));

    const pending = await waitForPendingOfficeHoursPrompt(ws, created.session.id);
    const pendingIndex = ws.events.findIndex((event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.pendingUserInput?.requestId === pending.requestId
    );
    assert.equal(pending.toolName, "agentic30_request_user_input");
    assert.equal(pending.generation?.mode?.startsWith("office_hours"), true);
    assert.equal(
      ws.events.some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && /질문 6개 중 1개만/.test(event.message || "")
      ),
      false,
      "non-blocking card creation must not be treated as a 1/6 incomplete interview",
    );
    assert.equal(
      ws.events.slice(pendingIndex + 1).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "the next provider run must wait for submit_user_input",
    );

    const marker = ws.events.length;
    submitStructuredAnswer(ws, created.session.id, pending);

    await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "provider_starting"
    );
    ws.send(JSON.stringify(officeHoursStartPayload));
    const followup = await waitForPendingOfficeHoursPrompt(ws, created.session.id, pending.requestId);
    assert.notEqual(followup.requestId, pending.requestId);
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && /waiting for the current run/i.test(event.message || "")
      ),
      false,
      "duplicate start during the continuation run must not surface an active-run error",
    );
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && /질문 6개 중 1개만/.test(event.message || "")
      ),
      false,
      "answered Q1 should schedule the next card instead of failing incomplete",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours Day 3 answer persists to memory before the next Codex card", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST: "1",
    },
  });
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 3,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: [
        "Office Hours mode: Startup",
        "Office Hours day: 3",
        "Expected question count: 6",
        "Yesterday briefing: 고객 행동 증거 공백",
        "Goal text: Support leads will pay to avoid missed Slack escalations.",
      ].join("\n"),
      visiblePrompt: "Test Day 3 Office Hours",
      source: "office_hours_day_3",
      day: 3,
      selectedSources: ["git"],
    }));

    const pending = await waitForPendingOfficeHoursPrompt(ws, created.session.id);
    submitStructuredAnswer(ws, created.session.id, pending, {
      selectedOptions: [],
      freeText: "아직 보내지 못했다",
    });
    const followup = await waitForPendingOfficeHoursPrompt(ws, created.session.id, pending.requestId);

    assert.notEqual(followup.requestId, pending.requestId);
    const turnLog = await loadOfficeHoursTurnLog({ workspaceRoot: harness.workspacePath });
    assert.equal(
      turnLog.turns.some((turn) =>
        turn.day === 3
          && turn.sessionId === created.session.id
          && turn.requestId === pending.requestId
          && turn.responseText === "아직 보내지 못했다"
      ),
      true,
    );
    const dayMemory = await loadDayMemory({ workspaceRoot: harness.workspacePath, day: 3 });
    assert.equal(
      dayMemory?.details?.officeHoursTurns?.some((turn) =>
        turn.requestId === pending.requestId && turn.responseText === "아직 보내지 못했다"
      ),
      true,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start restores a pending Day 3 card from workspace memory after restart", async () => {
  const firstHarness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST: "1",
    },
  });
  let firstWs;
  let secondHarness;
  let secondWs;
  let keepWorkspace = false;
  let firstHarnessClosed = false;
  const context = [
    "Office Hours mode: Startup",
    "Office Hours day: 3",
    "Expected question count: 2",
    "Yesterday briefing: 고객 행동 증거 공백",
    "Goal text: Support leads will pay to avoid missed Slack escalations.",
  ].join("\n");

  try {
    await initGitRepo(firstHarness.workspacePath);
    firstWs = await connectAndCollect(firstHarness);

    firstWs.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 3,
    }));
    const firstCreated = await waitForEvent(firstWs.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );

    firstWs.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: firstCreated.session.id,
      context,
      visiblePrompt: "Test Day 3 pending restore",
      source: "office_hours_day_3",
      day: 3,
      selectedSources: ["git"],
    }));

    const firstPending = await waitForPendingOfficeHoursPrompt(firstWs, firstCreated.session.id);
    submitStructuredAnswer(firstWs, firstCreated.session.id, firstPending, {
      selectedOptions: [],
      freeText: "아직 보내지 못했다",
    });
    const pendingBeforeRestart = await waitForPendingOfficeHoursPrompt(
      firstWs,
      firstCreated.session.id,
      firstPending.requestId,
    );
    assert.notEqual(pendingBeforeRestart.requestId, firstPending.requestId);
    const distinctPendingBeforeRestart = {
      ...pendingBeforeRestart,
      questions: [
        {
          ...pendingBeforeRestart.questions[0],
          questionId: "office_hours_day3_customer_evidence_next_action",
          question: "박조은님에게 보낼 프로젝트 기록 요청은 지금 어떤 확인 가능한 증거로 남아 있나요?",
        },
      ],
      generation: {
        ...(pendingBeforeRestart.generation || {}),
        signalId: "office_hours_day3_customer_evidence_next_action",
        signalLabel: "Office Hours Day 3 고객 증거 다음 행동",
      },
    };
    await saveOfficeHoursPendingQuestion({
      workspaceRoot: firstHarness.workspacePath,
      day: 3,
      source: "office_hours_day_3",
      request: distinctPendingBeforeRestart,
      turnLog: await loadOfficeHoursTurnLog({ workspaceRoot: firstHarness.workspacePath }),
    });
    const savedPending = await loadOfficeHoursPendingQuestion({
      workspaceRoot: firstHarness.workspacePath,
      day: 3,
    });
    assert.equal(savedPending?.request?.requestId, distinctPendingBeforeRestart.requestId);
    assert.equal(
      savedPending?.request?.questions?.[0]?.question,
      distinctPendingBeforeRestart.questions[0].question,
    );
    assert.equal(savedPending?.answeredTurnCount, 1);
    await seedStandardInterviewActiveProgress(firstHarness.workspacePath, 3);

    firstWs.close();
    firstWs = null;
    keepWorkspace = true;
    await firstHarness.close({ cleanup: false });
    firstHarnessClosed = true;

    secondHarness = await spawnSidecar({
      workspacePath: firstHarness.workspacePath,
      appSupportPath: firstHarness.appSupportPath,
      tempRoot: firstHarness.tempRoot,
      extraEnv: {
        AGENTIC30_TEST_STUB_PROVIDER: "",
        CODEX_API_KEY: "",
        OPENAI_API_KEY: "",
      },
    });
    secondWs = await connectAndCollect(secondHarness);

    secondWs.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 3,
    }));
    const secondCreated = await waitForEvent(secondWs.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );

    const restoreMarker = secondWs.events.length;
    secondWs.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: secondCreated.session.id,
      context,
      visiblePrompt: "Test Day 3 pending restore",
      source: "office_hours_day_3",
      day: 3,
      selectedSources: ["git"],
    }));

    const restoredUpdate = await waitForEvent(secondWs.events, (event) =>
      secondWs.events.indexOf(event) >= restoreMarker
        && event.type === "session_updated"
        && event.session?.id === secondCreated.session.id
        && event.session?.status === "awaiting_input"
        && event.session?.pendingUserInput?.requestId === distinctPendingBeforeRestart.requestId
    );
    const restoredStatus = await waitForEvent(secondWs.events, (event) =>
      secondWs.events.indexOf(event) >= restoreMarker
        && event.type === "office_hours_status"
        && event.sessionId === secondCreated.session.id
        && event.stage === "question_ready"
        && event.requestId === distinctPendingBeforeRestart.requestId
    );
    assert.equal(restoredStatus.stage, "question_ready");
    assert.equal(restoredUpdate.session.pendingUserInput.sessionId, secondCreated.session.id);
    assert.equal(
      restoredUpdate.session.pendingUserInput.questions[0].question,
      distinctPendingBeforeRestart.questions[0].question,
    );
    assert.equal(
      restoredUpdate.session.messages.filter((message) => message.officeHoursSeededTurn === true).length,
      2,
    );
    assert.equal(
      secondWs.events.slice(restoreMarker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === secondCreated.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "pending card restore must not start a provider run",
    );

    submitStructuredAnswer(secondWs, secondCreated.session.id, restoredUpdate.session.pendingUserInput, {
      selectedOptions: [],
      freeText: "오늘 박조은님에게 프로젝트 기록 요청을 보내겠다",
    });
    await waitForEvent(secondWs.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === secondCreated.session.id
        && event.session?.pendingUserInput == null
        && event.session?.runtime?.officeHours?.completedByExpectedCount === true
    );
    assert.equal(
      await loadOfficeHoursPendingQuestion({ workspaceRoot: secondHarness.workspacePath, day: 3 }),
      null,
    );
    const turnLog = await loadOfficeHoursTurnLog({ workspaceRoot: secondHarness.workspacePath });
    assert.equal(
      turnLog.turns.some((turn) =>
        turn.day === 3
          && turn.sessionId === secondCreated.session.id
          && turn.requestId === distinctPendingBeforeRestart.requestId
          && /프로젝트 기록 요청/.test(turn.responseText)
      ),
      true,
    );
    keepWorkspace = false;
  } finally {
    firstWs?.close();
    secondWs?.close();
    if (secondHarness) {
      await secondHarness.close();
    } else if (firstHarnessClosed) {
      await fs.rm(firstHarness.tempRoot, { recursive: true, force: true });
    } else {
      await firstHarness.close({ cleanup: !keepWorkspace });
    }
  }
});

test("office_hours_start fails explicitly when a pending Day 3 snapshot is stale after restart", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_PROVIDER: "",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: "",
    },
  });
  let ws;
  const context = [
    "Office Hours mode: Startup",
    "Office Hours day: 3",
    "Expected question count: 3",
    "Goal text: Support leads will pay to avoid missed Slack escalations.",
  ].join("\n");

  try {
    await initGitRepo(harness.workspacePath);
    await seedStandardInterviewActiveProgress(harness.workspacePath, 3);
    await appendOfficeHoursTurn({
      workspaceRoot: harness.workspacePath,
      turn: makeOfficeHoursTurn({
        day: 3,
        index: 1,
        requestId: "day3-q1",
        question: "Q1: 어떤 고객에게 요청했나요?",
        answer: "박조은님에게 요청하려고 한다",
      }),
    });
    const pendingRequest = makeOfficeHoursPromptSnapshot({
      sessionId: "prior-session",
      requestId: "day3-q2-pending",
      questionId: "day3_q2",
      question: "Q2: 그 요청은 어떤 확인 가능한 증거로 남나요?",
    });
    await saveOfficeHoursPendingQuestion({
      workspaceRoot: harness.workspacePath,
      day: 3,
      source: "office_hours_day_3",
      request: pendingRequest,
      turnLog: await loadOfficeHoursTurnLog({ workspaceRoot: harness.workspacePath }),
    });
    await appendOfficeHoursTurn({
      workspaceRoot: harness.workspacePath,
      turn: makeOfficeHoursTurn({
        day: 3,
        index: 99,
        requestId: "day3-extra-turn",
        question: "Q-extra: stale marker",
        answer: "pending 생성 후 추가된 답변",
      }),
    });

    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 3,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );

    const marker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context,
      visiblePrompt: "Test stale pending failure",
      source: "office_hours_day_3",
      day: 3,
      selectedSources: ["git"],
    }));

    const failedUpdate = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error"
        && /답변 기록/.test(event.session?.error || "")
    );
    assert.equal(failedUpdate.session.pendingUserInput, null);
    await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "failed"
        && /다시 생성하지 않았습니다/.test(event.detail || "")
    );
    const errorEvent = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "office_hours_pending_state_unrecoverable"
    );
    assert.equal(errorEvent.recoverable, false);
    await waitForEventSettle();
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "stale pending state must not fall through to a provider restart",
    );
    assert.equal(
      (await loadOfficeHoursPendingQuestion({ workspaceRoot: harness.workspacePath, day: 3 }))?.request?.requestId,
      "day3-q2-pending",
      "stale pending snapshot is left in memory for inspection instead of being cleared",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start fails explicitly when pending Day 3 snapshot points at a done interview", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_PROVIDER: "",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: "",
    },
  });
  let ws;
  const context = [
    "Office Hours mode: Startup",
    "Office Hours day: 3",
    "Expected question count: 3",
    "Goal text: Support leads will pay to avoid missed Slack escalations.",
  ].join("\n");

  try {
    await initGitRepo(harness.workspacePath);
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    const pendingRequest = makeOfficeHoursPromptSnapshot({
      sessionId: "prior-session",
      requestId: "day3-done-pending",
      questionId: "day3_done_pending",
      question: "이미 끝난 인터뷰에 남아 있던 pending 질문",
    });
    await saveOfficeHoursPendingQuestion({
      workspaceRoot: harness.workspacePath,
      day: 3,
      source: "office_hours_day_3",
      request: pendingRequest,
      turnLog: await loadOfficeHoursTurnLog({ workspaceRoot: harness.workspacePath }),
    });

    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 3,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );

    const marker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context,
      visiblePrompt: "Test done pending failure",
      source: "office_hours_day_3",
      day: 3,
      selectedSources: ["git"],
    }));

    await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error"
        && /day-progress 상태/.test(event.session?.error || "")
    );
    await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "office_hours_pending_state_unrecoverable"
        && event.recoverable === false
    );
    await waitForEventSettle();
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "done stale pending state must not fall through to provider restart",
    );
    assert.equal(
      (await loadOfficeHoursPendingQuestion({ workspaceRoot: harness.workspacePath, day: 3 }))?.request?.requestId,
      "day3-done-pending",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start fails explicitly when answered Day 3 turns exist but pending snapshot is missing", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_PROVIDER: "",
      CODEX_API_KEY: "",
      OPENAI_API_KEY: "",
    },
  });
  let ws;
  const context = [
    "Office Hours mode: Startup",
    "Office Hours day: 3",
    "Expected question count: 3",
    "Goal text: Support leads will pay to avoid missed Slack escalations.",
  ].join("\n");

  try {
    await initGitRepo(harness.workspacePath);
    await seedStandardInterviewActiveProgress(harness.workspacePath, 3);
    await appendOfficeHoursTurn({
      workspaceRoot: harness.workspacePath,
      turn: makeOfficeHoursTurn({
        day: 3,
        index: 1,
        requestId: "missing-pending-q1",
        question: "Q1: 어떤 고객에게 요청했나요?",
        answer: "박조은님에게 요청하려고 한다",
      }),
    });

    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 3,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );

    const marker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context,
      visiblePrompt: "Test missing pending failure",
      source: "office_hours_day_3",
      day: 3,
      selectedSources: ["git"],
    }));

    await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error"
        && /pending 질문 스냅샷/.test(event.session?.error || "")
    );
    const errorEvent = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "office_hours_pending_state_unrecoverable"
    );
    assert.equal(errorEvent.recoverable, false);
    await waitForEventSettle();
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "missing pending snapshot must not use answered turns as a provider restart fallback",
    );
    assert.equal(
      await loadOfficeHoursPendingQuestion({ workspaceRoot: harness.workspacePath, day: 3 }),
      null,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours pending Codex tool result without request transport fails explicitly", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST: "1",
      AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_RESULT_ONLY: "1",
    },
  });
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 3,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "Office Hours mode: Startup\nOffice Hours day: 3\nExpected question count: 6",
      visiblePrompt: "Test result-only Codex Office Hours",
      source: "office_hours_day_3",
      day: 3,
      selectedSources: ["git"],
    }));

    const failed = await waitForEvent(ws.events, (event) =>
      event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error"
        && /pending_user_input but no pending request was attachable/.test(event.session?.error || "")
    );
    assert.equal(failed.session.pendingUserInput, null);
    assert.equal(
      ws.events.some((event) =>
        event.type === "session_updated"
          && event.session?.id === created.session.id
          && event.session?.status === "awaiting_input"
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours Day 1 stops at expected six questions and suppresses stray seventh request", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 1,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );
    await seedDay1ActiveProgress(harness.workspacePath);

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: [
        "DAY1_LOCKED_GOAL",
        "Flow contract: locked Day 1 goal interview.",
        "Office Hours mode: Startup",
        "Expected question count: 6",
        "Goal lane: make_money / 첫 매출 달성",
        "Goal text: Slack escalation 누락 문제로 paid pilot을 검증한다.",
        "Customer: B2B support lead",
        "Problem: Slack escalation을 놓친다",
        "Validation action: 유료 파일럿 ask",
      ].join("\n"),
      visiblePrompt: "Test Day 1 locked Office Hours",
      source: "day1_interview_goal_locked",
      day: 1,
    }));

    const pending = await waitForPendingOfficeHoursPrompt(ws, created.session.id);
    for (let index = 1; index <= 5; index += 1) {
      await appendOfficeHoursTurn({
        workspaceRoot: harness.workspacePath,
        turn: {
          day: 1,
          sessionId: created.session.id,
          requestId: `seed-office-hours-${index}`,
          mode: "office_hours",
          questionText: `Seeded question ${index}`,
          responseText: `Seeded answer ${index}`,
        },
      });
    }
    const marker = ws.events.length;
    submitStructuredAnswer(ws, created.session.id, pending);

    const completed = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.pendingUserInput == null
        && event.session?.status === "idle"
        && event.session?.runtime?.officeHours?.completedByExpectedCount === true
    );
    assert.equal(completed.session.runtime.officeHours.expectedQuestionCount, 6);
    assert.equal(completed.session.runtime.officeHours.completedQuestionCount, 6);
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "sixth answer must not schedule another provider continuation",
    );

    assert.deepEqual(await listUserInputRequests(harness.appSupportPath), []);

    const strayRequest = await createUserInputRequest(harness.appSupportPath, {
      sessionId: created.session.id,
      toolName: "agentic30_request_user_input",
      title: "Office Hours",
      generation: {
        mode: "office_hours",
        signalId: "office_hours_alternatives",
        signalLabel: "Office Hours 대안 비교",
      },
      questions: [
        {
          questionId: "office_hours_alternatives",
          header: "대안 비교",
          question: "이 질문은 7번째 카드로 승격되면 안 됩니다.",
          options: [
            { label: "최소안", description: "최소 범위" },
            { label: "이상안", description: "넓은 범위" },
          ],
          multiSelect: false,
          allowFreeText: true,
          requiresFreeText: false,
          textMode: "short",
        },
      ],
    });
    const syncMarker = ws.events.length;
    await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= syncMarker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.pendingUserInput == null
        && event.session?.status === "idle"
    );
    assert.equal(
      ws.events.slice(syncMarker).some((event) =>
        event.type === "session_updated"
          && event.session?.id === created.session.id
          && event.session?.pendingUserInput?.requestId === strayRequest.requestId
      ),
      false,
      "sync must not expose a seventh Office Hours card after the cap",
    );
    assert.equal(
      (await listUserInputRequests(harness.appSupportPath))
        .some((request) => request.requestId === strayRequest.requestId),
      false,
      "sync must remove the stray seventh request artifact",
    );

    const revisedLabel = pending.questions[0].options[1].label;
    const revisionMarker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_revise_answer",
      sessionId: created.session.id,
      requestId: pending.requestId,
      prompt: pending,
      responses: [
        {
          question: pending.questions[0].question,
          selectedOptions: [revisedLabel],
          freeText: "",
        },
      ],
    }));
    const revised = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= revisionMarker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.pendingUserInput == null
        && event.session?.status === "idle"
        && event.session?.runtime?.officeHours?.completedByExpectedCount === true
    );
    const revisedSnapshot = revised.session.runtime.officeHours.promptSnapshots
      ?.find((snapshot) => snapshot.requestId === pending.requestId);
    assert.equal(revisedSnapshot?.submissions?.[0]?.selectedOptions?.[0], revisedLabel);
    assert.equal(
      ws.events.slice(revisionMarker).some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && /cannot be revised/i.test(event.message || "")
      ),
      false,
      "completed Office Hours interviews must remain editable",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start hydrates completed Day 1 interview without provider run", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 1,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle"
    );
    await seedDay1DoneProgress(harness.workspacePath);
    for (let index = 1; index <= 6; index += 1) {
      await appendOfficeHoursTurn({
        workspaceRoot: harness.workspacePath,
        turn: makeCompletedOfficeHoursTurn(index),
      });
    }

    const marker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: [
        "DAY1_LOCKED_GOAL",
        "Flow contract: locked Day 1 goal interview.",
        "Office Hours mode: Startup",
        "Expected question count: 6",
        "Goal lane: make_money / 첫 매출 달성",
        "Goal text: 완료된 인터뷰를 다시 보여준다.",
        "Customer: 전업 1인 개발자",
        "Problem: 이미 답한 Day 1 인터뷰가 새로 시작된다",
        "Validation action: 기존 Q/A 복원",
      ].join("\n"),
      visiblePrompt: "Test completed Day 1 hydration",
      source: "day1_interview_goal_locked",
      day: 1,
    }));

    const hydrated = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "idle"
        && event.session?.runtime?.officeHours?.source === "day1_interview_goal_locked"
        && event.session?.messages?.filter((message) => message.officeHoursSeededTurn === true).length === 12
    );
    const completedStatus = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "completed"
    );
    assert.equal(completedStatus.title, "응답 정리 중");
    assert.equal(hydrated.session.pendingUserInput, null);
    assert.equal(hydrated.session.runtime.officeHours.completedByExpectedCount, true);
    assert.equal(hydrated.session.runtime.officeHours.completedQuestionCount, 6);
    assert.equal(hydrated.session.runtime.officeHours.expectedQuestionCount, 6);
    assert.equal(hydrated.session.runtime.officeHours.resumedTurns, 6);
    assert.equal(hydrated.session.runtime.officeHours.promptSnapshots.length, 6);
    assert.equal(hydrated.session.runtime.officeHours.promptSnapshots[0].requestId, "completed-day1-1");
    assert.equal(hydrated.session.runtime.officeHours.promptSnapshots[0].submissions[0].selectedOptions[0], "완료 답변 1");
    assert.equal(hydrated.session.runtime.officeHours.promptSnapshots[0].turnSessionId, "prior-completed-session");
    assert.equal(
      hydrated.session.messages.some((message) =>
        message.role === "user" && message.content === "Test completed Day 1 hydration"
      ),
      false,
      "completed hydration must not append a synthetic start prompt",
    );
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "completed Day 1 hydration must not start a provider run",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start blocks Day 2+ when no live source exists", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 2,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS\nGoal lane: build_product / 작동하는 첫 버전 출시",
      visiblePrompt: "Test blocked Office Hours",
      source: "office_hours_day_2",
      day: 2,
    }));

    const gate = await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_source_gate"
        && event.sessionId === created.session.id
        && event.status === "blocked",
    );
    assert.equal(gate.officeHoursSourceGate.reason, "no_live_sources");
    assert.ok(gate.officeHoursSourceGate.connectActions.length >= 1);
    const blockedError = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && event.sessionId === created.session.id
        && /source|연결/i.test(event.message || ""),
    );
    assert.equal(blockedError.sessionId, created.session.id);
    assert.equal(
      ws.events.some((event) =>
        event.type === "session_updated"
          && event.session?.id === created.session.id
          && event.session?.messages?.some((message) => message.content === "Test blocked Office Hours"),
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("morning_briefing_get marks selected failed sources on final result metadata", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await seedMorningBriefingStore(harness.workspacePath, {
      generatedAt: new Date().toISOString(),
      cloudflareState: "failed",
      cloudflareSelected: true,
      cloudflareDetail: "Cloudflare MCP 도구를 사용할 수 없어 집계 트래픽을 계산하지 못했습니다.",
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "morning_briefing_get",
      preferredProvider: "codex",
    }));

    const result = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_result"
        && event.status?.snapshot === false
        && event.status?.failedSources?.some((source) => source.id === "cloudflare"),
    );
    assert.equal(result.status.state, "ready");
    assert.equal(result.status.failedSources[0].label, "Cloudflare");
    assert.match(result.status.failedSources[0].detail, /Cloudflare MCP/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("morning_briefing_get marks cached snapshot while refresh is in flight", async () => {
  const harness = await spawnSidecar({
    extraEnv: { AGENTIC30_TEST_MORNING_BRIEFING_REFRESH_DELAY_MS: "750" },
  });
  let ws;
  try {
    await seedMorningBriefingStore(harness.workspacePath, {
      generatedAt: new Date().toISOString(),
      cloudflareState: "ready",
      cloudflareSelected: true,
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "morning_briefing_refresh",
      reason: "manual",
      force: true,
      preferredProvider: "codex",
    }));
    const collecting = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_status"
        && event.status?.state === "collecting"
        && event.status?.runId,
    );

    ws.send(JSON.stringify({
      type: "morning_briefing_get",
      preferredProvider: "codex",
    }));

    const cached = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_result"
        && event.status?.state === "collecting"
        && event.status?.snapshot === true,
    );
    assert.equal(cached.status.reason, "refresh_in_flight");
    assert.equal(cached.status.runId, collecting.status.runId);
    assert.equal(cached.morningBriefing.summary.title, "밤사이 신호 요약");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("morning_briefing_get with autoRefreshIfStale false restores stale cache without refresh", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await seedMorningBriefingStore(harness.workspacePath, {
      generatedAt: "2026-01-01T00:00:00.000Z",
      cloudflareState: "ready",
      cloudflareSelected: true,
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "morning_briefing_get",
      preferredProvider: "codex",
      autoRefreshIfStale: false,
    }));

    const cached = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_result"
        && event.status?.snapshot === true
        && event.status?.reason === "startup_restore",
    );
    assert.equal(cached.status.state, "ready");
    assert.equal(cached.morningBriefing.summary.title, "밤사이 신호 요약");

    const statusCount = ws.events.filter((event) => event.type === "morning_briefing_status").length;
    await waitForEventSettle();
    assert.equal(
      ws.events.filter((event) => event.type === "morning_briefing_status").length,
      statusCount,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("morning_briefing_get with autoRefreshIfStale false restores current cache as snapshot", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await seedMorningBriefingStore(harness.workspacePath, {
      generatedAt: new Date().toISOString(),
      cloudflareState: "ready",
      cloudflareSelected: true,
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "morning_briefing_get",
      preferredProvider: "codex",
      autoRefreshIfStale: false,
    }));

    const cached = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_result"
        && event.status?.snapshot === true
        && event.status?.reason === "startup_restore",
    );
    assert.equal(cached.status.state, "ready");
    assert.equal(cached.morningBriefing.summary.title, "밤사이 신호 요약");

    const statusCount = ws.events.filter((event) => event.type === "morning_briefing_status").length;
    await waitForEventSettle();
    assert.equal(
      ws.events.filter((event) => event.type === "morning_briefing_status").length,
      statusCount,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("morning_briefing_get with autoRefreshIfStale false fails cache without verdict metadata", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await seedMorningBriefingStore(harness.workspacePath, {
      generatedAt: new Date().toISOString(),
      cloudflareState: "ready",
      cloudflareSelected: true,
      includeVerdict: false,
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "morning_briefing_get",
      preferredProvider: "codex",
      autoRefreshIfStale: false,
    }));

    const failed = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_status"
        && event.status?.state === "failed"
        && event.status?.reason === "startup_restore",
    );
    assert.match(failed.status.detail, /판정 근거/);
    await waitForEventSettle();
    assert.equal(
      ws.events.some((event) => event.type === "morning_briefing_result"),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("news_market_radar_get with autoRefreshIfDue false restores due cache without refresh", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const generatedAt = "2026-01-01T00:00:00.000Z";
    await persistNewsMarketRadarSnapshot({
      workspaceRoot: harness.workspacePath,
      now: new Date(generatedAt),
      snapshot: {
        schemaVersion: 1,
        generatedAt,
        nextRefreshAfter: "2026-01-01T01:00:00.000Z",
        status: {
          state: "ready",
          lastSuccessAt: generatedAt,
          stale: false,
          researchSource: "test cache",
        },
        workspaceEvidenceRefs: [],
        lanes: [{
          id: "icp",
          cards: [{
            id: "icp-cache-card",
            title: "Cached ICP signal",
            summary: "Persisted market radar cache should render after restart.",
            impact: "strengthens",
            sourceRefs: [{ url: "https://example.com/icp", title: "ICP source" }],
          }],
        }],
      },
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "news_market_radar_get",
      preferredProvider: "codex",
      autoRefreshIfDue: false,
    }));

    const cached = await waitForEvent(ws.events, (event) =>
      event.type === "news_market_radar_result"
        && event.newsMarketRadar?.lanes?.some((lane) =>
          lane.id === "icp" && lane.cards?.some((card) => card.id === "icp-cache-card"),
        ),
    );
    assert.equal(cached.newsMarketRadar.status.state, "ready");

    const statusCount = ws.events.filter((event) => event.type === "news_market_radar_status").length;
    await waitForEventSettle();
    assert.equal(
      ws.events.filter((event) => event.type === "news_market_radar_status").length,
      statusCount,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("news_market_radar_get marks cached failed snapshot refreshing while refresh is in flight", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      EXA_API_KEY: "exa_test_key",
      AGENTIC30_TEST_STUB_PROVIDER_DELAY_MS: "750",
    },
  });
  let ws;
  try {
    await fs.mkdir(path.join(harness.workspacePath, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(harness.workspacePath, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const generatedAt = "2026-01-01T00:00:00.000Z";
    await persistNewsMarketRadarSnapshot({
      workspaceRoot: harness.workspacePath,
      now: new Date(generatedAt),
      snapshot: {
        schemaVersion: 1,
        generatedAt,
        nextRefreshAfter: "2026-01-01T01:00:00.000Z",
        status: {
          state: "failed",
          lastSuccessAt: null,
          stale: false,
          error: "cached search failed",
          reason: "search_failed",
          researchSource: "test cache",
        },
        workspaceEvidenceRefs: [],
        lanes: [{ id: "icp", cards: [] }],
      },
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "news_market_radar_refresh",
      reason: "manual",
      force: true,
      preferredProvider: "codex",
    }));
    await waitForEvent(ws.events, (event) =>
      event.type === "news_market_radar_status"
        && event.status?.state === "refreshing"
    );

    ws.send(JSON.stringify({
      type: "news_market_radar_get",
      preferredProvider: "codex",
      autoRefreshIfDue: true,
    }));

    const cached = await waitForEvent(ws.events, (event) =>
      event.type === "news_market_radar_result"
        && event.newsMarketRadar?.status?.reason === "refresh_in_flight"
    );
    assert.equal(cached.newsMarketRadar.status.state, "refreshing");
    assert.equal(cached.newsMarketRadar.status.error, null);
    assert.notEqual(cached.newsMarketRadar.status.state, "failed");
    assert.equal(typeof cached.newsMarketRadar.status.stage, "string");

    const status = await waitForEvent(ws.events, (event) =>
      event.type === "news_market_radar_status"
        && event.status?.reason === "refresh_in_flight"
    );
    assert.equal(status.status.state, "refreshing");
    assert.equal(status.status.error, null);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("morning_briefing_refresh does not run Cloudflare direct fallback after failed MCP digest", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await seedMcpOauthState(harness.appSupportPath, {
      cloudflare: {
        codex: {
          state: "ready",
          detail: "Cloudflare MCP OAuth connection verified",
          checkedAt: new Date().toISOString(),
        },
      },
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "morning_briefing_refresh",
      reason: "manual",
      force: true,
      preferredProvider: "codex",
    }));
    const collecting = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_status"
        && event.status?.state === "collecting"
        && event.status?.runId,
    );
    await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_status"
        && event.status?.runId === collecting.status.runId
        && ["ready", "failed"].includes(event.status?.state),
      45_000,
    );

    const runEvents = await readMorningBriefingRunLog(harness.workspacePath, collecting.status.runId);
    const summary = runEvents.find((event) =>
      event.stage === "external_digest_summary"
        && event.source === "cloudflare"
    );
    assert.equal(summary?.state, "failed");
    assert.equal(summary?.collectionState, "failed");

    const direct = runEvents.find((event) =>
      event.stage === "cloudflare_direct"
        && event.outcome === "skipped"
    );
    assert.equal(direct?.reason, "mcp_digest_not_ready");
    assert.equal(direct?.detail, summary.detail);
    assert.equal(
      runEvents.some((event) =>
        event.stage === "cloudflare_direct"
          && event.outcome === "started"
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("morning_briefing_refresh completes verdict through judge_read_only with local stub auth", async () => {
  const harness = await spawnSidecar({
    extraEnv: { AGENTIC30_TEST_STUB_MORNING_BRIEFING_EXTERNAL_DIGEST: "ready" },
  });
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    await seedMorningBriefingVerdictContext(harness.workspacePath);
    await seedMcpOauthState(harness.appSupportPath, {
      posthog: {
        codex: {
          state: "ready",
          detail: "PostHog MCP OAuth connection verified",
          checkedAt: new Date().toISOString(),
        },
      },
      cloudflare: {
        codex: {
          state: "ready",
          detail: "Cloudflare MCP OAuth connection verified",
          checkedAt: new Date().toISOString(),
        },
      },
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "morning_briefing_refresh",
      reason: "manual",
      force: true,
      preferredProvider: "codex",
    }));
    const collecting = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_status"
        && event.status?.state === "collecting"
        && event.status?.runId,
    );
    const result = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_result"
        && event.status?.runId === collecting.status.runId
        && event.status?.state === "ready",
      45_000,
    );

    assert.equal(result.morningBriefing.customerEvidenceVerdict.verdictProvider, "codex");
    assert.equal(
      ws.events.some((event) =>
        event.type === "morning_briefing_status"
          && event.status?.runId === collecting.status.runId
          && event.status?.state === "failed"
      ),
      false,
    );

    const runEvents = await readMorningBriefingRunLog(harness.workspacePath, collecting.status.runId);
    const started = runEvents.find((event) =>
      event.stage === "verdict_provider"
        && event.outcome === "started"
    );
    assert.equal(started?.provider, "codex");
    assert.equal(started?.executionMode, "judge_read_only");

    const validated = runEvents.find((event) =>
      event.stage === "verdict_provider"
        && event.outcome === "validated"
    );
    assert.equal(validated?.provider, "codex");
    assert.equal(validated?.executionMode, "judge_read_only");
    assert.equal(
      runEvents.some((event) =>
        event.stage === "verdict_provider"
          && event.outcome === "failed"
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("morning_briefing_refresh fails explicitly when verdict provider fails", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_MORNING_BRIEFING_EXTERNAL_DIGEST: "ready",
      AGENTIC30_TEST_MORNING_BRIEFING_VERDICT_FAILURE: "1",
    },
  });
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    await seedMorningBriefingVerdictContext(harness.workspacePath);
    await seedMcpOauthState(harness.appSupportPath, {
      posthog: {
        codex: {
          state: "ready",
          detail: "PostHog MCP OAuth connection verified",
          checkedAt: new Date().toISOString(),
        },
      },
      cloudflare: {
        codex: {
          state: "ready",
          detail: "Cloudflare MCP OAuth connection verified",
          checkedAt: new Date().toISOString(),
        },
      },
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "morning_briefing_refresh",
      reason: "manual",
      force: true,
      preferredProvider: "codex",
    }));
    const collecting = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_status"
        && event.status?.state === "collecting"
        && event.status?.runId,
    );
    const failed = await waitForEvent(ws.events, (event) =>
      event.type === "morning_briefing_status"
        && event.status?.runId === collecting.status.runId
        && event.status?.state === "failed",
      45_000,
    );

    assert.match(failed.status.detail, /판정 생성 실패/);
    assert.match(failed.status.detail, /Forced morning briefing verdict provider failure/);
    await waitForEventSettle();
    assert.equal(
      ws.events.some((event) =>
        event.type === "morning_briefing_result"
          && event.status?.runId === collecting.status.runId
      ),
      false,
    );

    const runEvents = await readMorningBriefingRunLog(harness.workspacePath, collecting.status.runId);
    assert.equal(
      runEvents.some((event) =>
        event.stage === "verdict_provider"
          && event.outcome === "failed"
      ),
      true,
    );
    assert.equal(
      runEvents.filter((event) =>
        event.stage === "verdict_provider"
          && event.outcome === "started"
      ).length,
      1,
    );
    assert.equal(
      runEvents.some((event) =>
        event.stage === "verdict_provider"
          && event.outcome === "fallback"
      ),
      false,
    );
    assert.equal(
      runEvents.some((event) => event.stage === "persist"),
      false,
    );
    assert.equal(
      runEvents.some((event) =>
        event.stage === "refresh"
          && event.outcome === "completed"
      ),
      false,
    );
    assert.equal(
      runEvents.some((event) =>
        event.stage === "refresh"
          && event.outcome === "failed"
      ),
      true,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_start skips Day 2+ source gate in local dev fast-days mode", async () => {
  const harness = await spawnSidecar({
    extraEnv: { AGENTIC30_LOCAL_DEV_FAST_DAYS: "1" },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
      officeHoursDay: 2,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS\nDay 2 goal: 작동하는 첫 버전 출시\nGoal lane: build_product / 작동하는 첫 버전 출시",
      visiblePrompt: "Test local dev fast-days Office Hours",
      source: "office_hours_day_2",
      day: 2,
      selectedSources: ["github", "posthog"],
    }));

    const gate = await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_source_gate"
        && event.sessionId === created.session.id
        && event.status === "ready"
        && event.officeHoursSourceGate?.reason === "local_dev_fast_days",
    );
    assert.equal(gate.officeHoursSourceGate.skipped, true);
    assert.deepEqual(gate.officeHoursSourceGate.selectedSources, ["posthog"]);
    assert.equal(
      gate.officeHoursSourceGate.sources.find((source) => source.id === "posthog")?.required,
      false,
    );

    const progress = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state"
        && event.workspaceRoot === harness.workspacePath
        && event.dayProgress?.days?.["2"]?.steps?.interview === "active",
    );
    const day2 = progress.dayProgress.days["2"];
    assert.equal(day2.kind, "standard");
    assert.equal(day2.steps.scan, "done");
    assert.equal(day2.steps.retro, "done");
    assert.equal(day2.steps.goal, "done");
    assert.equal(day2.steps.execution, "pending");
    assert.equal(day2.goalText, "작동하는 첫 버전 출시");

    await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_daily_digest_result"
        && event.sessionId === created.session.id
        && event.status === "ready",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && /source|연결/i.test(event.message || ""),
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("day_progress_patch skips milestone gates in local dev fast-days mode", async () => {
  const harness = await spawnSidecar({
    extraEnv: { AGENTIC30_LOCAL_DEV_FAST_DAYS: "1" },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "day_progress_patch",
      workspaceRoot: harness.workspacePath,
      day: 4,
      stepId: "goal",
      status: "done",
      goalText: "Day 4 local dev goal",
    }));
    await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state"
        && event.workspaceRoot === harness.workspacePath
        && event.dayProgress?.days?.["4"]?.steps?.goal === "done",
    );

    ws.send(JSON.stringify({
      type: "day_progress_patch",
      workspaceRoot: harness.workspacePath,
      day: 4,
      stepId: "interview",
      status: "active",
    }));
    const progress = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state"
        && event.workspaceRoot === harness.workspacePath
        && event.dayProgress?.days?.["4"]?.steps?.interview === "active",
    );

    const day4 = progress.dayProgress.days["4"];
    assert.equal(day4.kind, "standard");
    assert.equal(day4.steps.goal, "done");
    assert.equal(day4.steps.interview, "active");
    assert.equal(day4.goalText, "Day 4 local dev goal");
    assert.equal(
      ws.events.some((event) =>
        event.type === "day_progress_state"
          && event.workspaceRoot === harness.workspacePath
          && event.gateBlocked?.gateId === "G1",
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("day_progress_get returns an empty default state when no file exists", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "day_progress_get",
      workspaceRoot: harness.workspacePath,
    }));

    const progress = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state"
        && event.workspaceRoot === harness.workspacePath
        && event.dayProgress,
    );

    assert.equal(progress.dayProgress.schemaVersion, 1);
    assert.equal(progress.dayProgress.schema, "agentic30.day_progress.v1");
    assert.equal(progress.dayProgress.challengeStartedAt, null);
    assert.deepEqual(progress.dayProgress.days, {});
    assert.equal(progress.currentDay, null);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("day_progress_get emits persisted Day state and Office Hours day close policy", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await seedDay1ActiveProgress(harness.workspacePath);
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "day_progress_get",
      workspaceRoot: harness.workspacePath,
    }));

    const progress = await waitForEvent(ws.events, (event) =>
      event.type === "day_progress_state"
        && event.workspaceRoot === harness.workspacePath
        && event.dayClosePolicy,
    );

    assert.equal(progress.dayClosePolicy.role, "evidence_closing_operator");
    assert.equal(progress.dayProgress.challengeStartedAt, localDateString(new Date()));
    assert.equal(progress.dayProgress.days["1"].steps.first_interview, "active");
    assert.deepEqual(progress.dayClosePolicy.closeTypes, ["customer_evidence", "posted_url_target", "blocked", "carry"]);
    assert.equal(progress.dayClosePolicy.mandatoryBip.state, "target_behavior");
    assert.equal(progress.dayClosePolicy.mandatoryBip.currentProofSink, "local");
    assert.deepEqual(progress.dayClosePolicy.mandatoryBip.allowedProofSinks, ["local", "bip_optional"]);
    assert.equal(progress.dayClosePolicy.mandatoryBip.autoPosting, false);
    assert.equal(progress.dayClosePolicy.bipResearchCandidatePolicy.state, "manual_fallback");
    assert.equal(progress.dayClosePolicy.bipResearchCandidatePolicy.cachePath, ".agentic30/bip/research/day-1-cache.json");
    assert.equal(progress.dayClosePolicy.bipResearchCandidatePolicy.fallbackAction, "manually_named_reachable_customer");
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
      evidenceRefs: ["README.md", ".agentic30/docs/ICP.md"],
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

    const contextPath = path.join(harness.workspacePath, ".agentic30", "memory", "project-context.json");
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

async function spawnSidecar({
  extraEnv = {},
  tempRoot = null,
  workspacePath = null,
  appSupportPath = null,
  cleanupOnClose = true,
} = {}) {
  const root = tempRoot || await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-request-emit-"));
  const workspace = workspacePath || path.join(root, "workspace");
  const appSupport = appSupportPath || path.join(root, "app-support");
  const ghConfigPath = path.join(root, "gh-config");
  const homePath = path.join(root, "home");
  await fs.mkdir(workspace, { recursive: true });
  await fs.mkdir(appSupport, { recursive: true });
  await fs.mkdir(ghConfigPath, { recursive: true });
  await fs.mkdir(homePath, { recursive: true });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspace], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupport,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      HOME: homePath,
      GH_CONFIG_DIR: ghConfigPath,
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
      ...extraEnv,
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
    tempRoot: root,
    workspacePath: workspace,
    appSupportPath: appSupport,
    async close({ cleanup = cleanupOnClose } = {}) {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 2_000);
      });
      if (cleanup) {
        await fs.rm(root, { recursive: true, force: true });
      }
    },
  };
}

async function seedMcpOauthState(appSupportPath, serversById = {}) {
  const servers = {};
  for (const [server, providers] of Object.entries(serversById)) {
    servers[server] = { providers };
  }
  await fs.writeFile(
    path.join(appSupportPath, "mcp-oauth-state.json"),
    JSON.stringify({ schemaVersion: 2, servers }, null, 2),
    "utf8",
  );
}

async function readMorningBriefingRunLog(workspacePath, runId) {
  const filePath = path.join(workspacePath, ".agentic30", "morning-briefing-runs", `${runId}.jsonl`);
  const raw = await fs.readFile(filePath, "utf8");
  return raw
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => JSON.parse(line));
}

async function seedMorningBriefingStore(workspacePath, {
  generatedAt = new Date().toISOString(),
  cloudflareState = "ready",
  cloudflareSelected = cloudflareState === "ready",
  cloudflareDetail = cloudflareState === "ready"
    ? "external MCP digest succeeded"
    : "Cloudflare MCP 도구를 사용할 수 없어 집계 트래픽을 계산하지 못했습니다.",
  includeVerdict = true,
} = {}) {
  const agenticRoot = path.join(workspacePath, ".agentic30");
  await fs.mkdir(agenticRoot, { recursive: true });
  const current = {
    schemaVersion: 3,
    generatedAt,
    day: 3,
    totalDays: 30,
    summary: { title: "밤사이 신호 요약", statement: "git 커밋 7건" },
    ...(includeVerdict ? {
      customerEvidenceVerdict: {
        state: "traffic_without_activation",
        title: "유입은 있지만 첫 핵심 행동 근거가 아직 얇아요.",
        body: "Day 1 목표와 Office Hours 약속 기준으로 다운로드 이후 검증 행동을 먼저 확인합니다.",
        evidence: [
          "Cloudflare visits 64 집계가 있습니다.",
          "GitHub commits 7 집계가 있습니다.",
          "PostHog conversions 0 집계가 있습니다.",
        ],
        primaryActionId: "task",
        verdictProvider: "codex",
        verdictGeneratedAt: generatedAt,
        contextRefs: ["onboarding", "day1_goal", "office_hours", "cloudflare", "github", "posthog"],
      },
    } : {}),
    sync: {
      sources: [
        { id: "git", label: "git", state: "ready", selected: true, detail: "git log/status live query succeeded" },
        { id: "posthog", label: "PostHog", state: "ready", selected: true, detail: "external MCP digest succeeded" },
        {
          id: "cloudflare",
          label: "Cloudflare",
          state: cloudflareState,
          selected: cloudflareSelected,
          detail: cloudflareDetail,
        },
      ],
      readyCount: cloudflareState === "ready" ? 3 : 2,
      syncedAt: generatedAt,
      syncedAtLabel: "16:31",
    },
    status: {
      state: "ready",
      detail: cloudflareState === "ready"
        ? "소스 3개에서 밤사이 신호를 모았어요."
        : "소스 2개에서 밤사이 신호를 모았어요.",
    },
  };
  await fs.writeFile(
    path.join(agenticRoot, "morning-briefing.json"),
    JSON.stringify({ schemaVersion: 3, current, previous: null, history: [] }, null, 2),
    "utf8",
  );
  return current;
}

async function seedMorningBriefingVerdictContext(workspacePath) {
  await saveOnboardingMemory({
    workspaceRoot: workspacePath,
    memory: {
      onboardingContext: {
        business_description: "1인 개발자를 위한 macOS 검증 코치",
        current_stage: "첫 고객 행동 증거 검증",
        goal: "30일 안에 실제 사용 증거 확보",
        focus_area: "development",
        product_bottleneck: "first_active_users",
        isolation_levels: ["project_folder"],
      },
      answers: {
        timeBudget: {
          question: "하루에 얼마나 시간을 쓸 수 있나요?",
          answer: "퇴근 후 2시간",
        },
        primaryFocus: {
          question: "요즘 어디에 시간을 쓰나요?",
          answer: "Agentic30 첫 고객 검증",
        },
        primaryBottleneck: {
          question: "가장 큰 병목은?",
          answer: "실제 사용 증거가 부족함",
        },
      },
    },
    now: new Date("2026-06-16T00:00:00.000Z"),
  });
  await saveDay1GoalSelection({
    workspaceRoot: workspacePath,
    selection: {
      goalType: "get_users",
      goalText: "1인 개발자 3명이 실제 프로젝트에서 Agentic30을 써 보게 한다",
      customer: "퇴근 후 제품을 만드는 1인 개발자",
      problem: "고객 검증보다 기능 빌드로 도망간다",
      validationAction: "Office Hours 질문에 답하고 workspace scan을 완료한다",
      evidenceRefs: ["Cloudflare visits", "PostHog activeUsers"],
      proofSink: "local",
    },
    now: new Date("2026-06-16T00:00:00.000Z"),
  });
  await appendOfficeHoursTurn({
    workspaceRoot: workspacePath,
    turn: {
      day: 2,
      questionText: "오늘 확인할 고객 행동은 무엇인가요?",
      responseText: "설치 후 workspace scan 완료와 Office Hours 답변을 확인한다.",
      signalId: "validation_action",
      signalLabel: "검증 행동",
      occurredAt: "2026-06-16T00:00:00.000Z",
    },
    now: new Date("2026-06-16T00:00:00.000Z"),
  });
}

async function waitForPendingOfficeHoursPrompt(ws, sessionId, previousRequestId = "") {
  const prior = String(previousRequestId || "");
  const event = await waitForEvent(ws.events, (candidate) =>
    candidate.type === "session_updated"
      && candidate.session?.id === sessionId
      && candidate.session?.status === "awaiting_input"
      && candidate.session?.pendingUserInput?.requestId
      && candidate.session.pendingUserInput.requestId !== prior
      && candidate.session.pendingUserInput.generation?.mode?.startsWith("office_hours")
  );
  return event.session.pendingUserInput;
}

function submitStructuredAnswer(ws, sessionId, prompt, {
  selectedOptions = null,
  freeText = null,
} = {}) {
  const question = prompt.questions[0];
  const selectedLabel = question.options?.[0]?.label || "직접 입력";
  const resolvedSelectedOptions = Array.isArray(selectedOptions)
    ? selectedOptions
    : question.options?.length
      ? [selectedLabel]
      : [];
  const evidenceText = typeof freeText === "string"
    ? freeText
    : question.requiresFreeText === true
    ? "6/13 실명 후보 A가 현재 대안 비용과 유료 진행 조건을 답했다"
    : "";
  ws.send(JSON.stringify({
    type: "submit_user_input",
    sessionId,
    requestId: prompt.requestId,
    responses: [
      {
        question: question.question,
        selectedOptions: resolvedSelectedOptions,
        freeText: question.options?.length ? evidenceText : (freeText ?? selectedLabel),
      },
    ],
  }));
}

async function seedDay1ActiveProgress(workspacePath) {
  const agentic30Dir = path.join(workspacePath, ".agentic30");
  await fs.mkdir(agentic30Dir, { recursive: true });
  await fs.writeFile(
    path.join(agentic30Dir, "day-progress.json"),
    JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.day_progress.v1",
      challengeStartedAt: localDateString(new Date()),
      days: {
        1: {
          day: 1,
          kind: "day1",
          steps: {
            onboarding: "done",
            scan: "done",
            goal: "done",
            first_interview: "active",
          },
        },
      },
    }, null, 2),
    "utf8",
  );
}

async function seedDay1DoneProgress(workspacePath) {
  const agentic30Dir = path.join(workspacePath, ".agentic30");
  await fs.mkdir(agentic30Dir, { recursive: true });
  await fs.writeFile(
    path.join(agentic30Dir, "day-progress.json"),
    JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.day_progress.v1",
      challengeStartedAt: localDateString(new Date()),
      days: {
        1: {
          day: 1,
          kind: "day1",
          steps: {
            onboarding: "done",
            scan: "done",
            goal: "done",
            first_interview: "done",
          },
        },
      },
    }, null, 2),
    "utf8",
  );
}

async function seedStandardInterviewActiveProgress(workspacePath, day = 3) {
  const dayNumber = Number.parseInt(String(day || ""), 10);
  const agentic30Dir = path.join(workspacePath, ".agentic30");
  await fs.mkdir(agentic30Dir, { recursive: true });
  await fs.writeFile(
    path.join(agentic30Dir, "day-progress.json"),
    JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.day_progress.v1",
      challengeStartedAt: localDateString(new Date()),
      days: {
        [String(dayNumber)]: {
          day: dayNumber,
          kind: "standard",
          steps: {
            scan: "done",
            retro: "done",
            goal: "done",
            interview: "active",
            execution: "pending",
          },
        },
      },
    }, null, 2),
    "utf8",
  );
}

async function seedStandardInterviewDoneProgress(workspacePath, day = 3) {
  const dayNumber = Number.parseInt(String(day || ""), 10);
  const agentic30Dir = path.join(workspacePath, ".agentic30");
  await fs.mkdir(agentic30Dir, { recursive: true });
  await fs.writeFile(
    path.join(agentic30Dir, "day-progress.json"),
    JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.day_progress.v1",
      challengeStartedAt: localDateString(new Date()),
      days: {
        [String(dayNumber)]: {
          day: dayNumber,
          kind: "standard",
          steps: {
            scan: "done",
            retro: "done",
            goal: "done",
            interview: "done",
            execution: "pending",
          },
        },
      },
    }, null, 2),
    "utf8",
  );
}

function makeCompletedOfficeHoursTurn(index) {
  const requestId = `completed-day1-${index}`;
  const question = `완료 질문 ${index}`;
  const answer = `완료 답변 ${index}`;
  return {
    day: 1,
    sessionId: "prior-completed-session",
    requestId,
    mode: "office_hours_tool",
    questionText: question,
    responseText: answer,
    promptSnapshot: {
      requestId,
      sessionId: "prior-completed-session",
      toolName: "agentic30_request_user_input",
      title: "Office Hours",
      createdAt: `2026-06-13T03:0${Math.min(index, 9)}:00.000Z`,
      questions: [
        {
          questionId: `completed_q_${index}`,
          header: "완료 질문",
          question,
          options: [
            {
              label: answer,
              description: "이미 제출한 답변",
            },
          ],
          multiSelect: false,
          allowFreeText: true,
          requiresFreeText: false,
          textMode: "short",
        },
      ],
      generation: {
        mode: "office_hours_tool",
        signalId: `completed_q_${index}`,
        signalLabel: "완료 질문",
      },
    },
    submissions: [
      {
        question,
        selectedOptions: [answer],
        freeText: "",
      },
    ],
    occurredAt: `2026-06-13T03:1${Math.min(index, 9)}:00.000Z`,
  };
}

function makeOfficeHoursPromptSnapshot({
  sessionId = "prior-office-hours-session",
  requestId = "office-hours-request",
  questionId = "office_hours_question",
  question = "어떤 확인 가능한 고객 행동 증거가 있나요?",
  createdAt = "2026-06-15T03:00:00.000Z",
} = {}) {
  return {
    requestId,
    sessionId,
    toolName: "agentic30_request_user_input",
    title: "Office Hours",
    createdAt,
    questions: [
      {
        questionId,
        header: "Office Hours",
        question,
        options: [
          {
            label: "확인 가능한 증거가 있다",
            description: "실명 고객의 행동으로 확인된 증거",
          },
          {
            label: "아직 없다",
            description: "아직 확인 가능한 고객 행동이 없다",
          },
        ],
        multiSelect: false,
        allowFreeText: true,
        requiresFreeText: false,
        textMode: "short",
      },
    ],
    generation: {
      mode: "office_hours_tool",
      signalId: questionId,
      signalLabel: "Office Hours 질문",
    },
  };
}

function makeOfficeHoursTurn({
  day = 3,
  index = 1,
  sessionId = "prior-office-hours-session",
  requestId = `day${day}-q${index}`,
  question = `Day ${day} 질문 ${index}`,
  answer = `Day ${day} 답변 ${index}`,
} = {}) {
  const minute = String(Math.min(Math.max(index, 0), 58)).padStart(2, "0");
  const promptSnapshot = makeOfficeHoursPromptSnapshot({
    sessionId,
    requestId,
    questionId: `day${day}_q${index}`,
    question,
    createdAt: `2026-06-15T03:${minute}:00.000Z`,
  });
  return {
    day,
    sessionId,
    requestId,
    mode: "office_hours_tool",
    questionText: question,
    responseText: answer,
    promptSnapshot,
    submissions: [
      {
        question,
        selectedOptions: [],
        freeText: answer,
      },
    ],
    occurredAt: `2026-06-15T03:${String(Number(minute) + 1).padStart(2, "0")}:00.000Z`,
  };
}

function localDateString(date) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function execFileOk(cmd, args, cwd) {
  return new Promise((resolve, reject) => {
    execFile(cmd, args, { cwd, encoding: "utf8" }, (error, stdout, stderr) => {
      if (error) {
        reject(new Error(`${cmd} ${args.join(" ")} failed: ${stderr || error.message}`));
      } else {
        resolve(stdout);
      }
    });
  });
}

async function initGitRepo(workspacePath) {
  await execFileOk("git", ["init"], workspacePath);
  await execFileOk("git", ["config", "user.email", "agentic30@example.com"], workspacePath);
  await execFileOk("git", ["config", "user.name", "Agentic30 Test"], workspacePath);
  await fs.writeFile(path.join(workspacePath, "README.md"), "# test workspace\n");
  await execFileOk("git", ["add", "README.md"], workspacePath);
  await execFileOk("git", ["commit", "-m", "seed workspace"], workspacePath);
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
  const summary = events.map((event) => {
    if (event.type === "error") return `error:${event.message || ""}`;
    if (event.type === "office_hours_status") return `office_hours_status:${event.stage || ""}`;
    if (event.type === "session_updated") return `session_updated:${event.session?.status || ""}`;
    return event.type;
  });
  throw new Error(`Timed out waiting for event. Saw: ${summary.join(", ")}`);
}

async function waitForEventSettle(ms = 250) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

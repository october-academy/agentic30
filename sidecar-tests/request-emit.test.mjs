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
import { appendOfficeHoursTurn } from "../sidecar/workspace-memory.mjs";

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

async function spawnSidecar({ extraEnv = {} } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-request-emit-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  const ghConfigPath = path.join(tempRoot, "gh-config");
  const homePath = path.join(tempRoot, "home");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(appSupportPath, { recursive: true });
  await fs.mkdir(ghConfigPath, { recursive: true });
  await fs.mkdir(homePath, { recursive: true });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspacePath], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
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
    workspacePath,
    appSupportPath,
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

function submitStructuredAnswer(ws, sessionId, prompt) {
  const question = prompt.questions[0];
  const selectedLabel = question.options?.[0]?.label || "직접 입력";
  ws.send(JSON.stringify({
    type: "submit_user_input",
    sessionId,
    requestId: prompt.requestId,
    responses: [
      {
        question: question.question,
        selectedOptions: question.options?.length ? [selectedLabel] : [],
        freeText: question.options?.length ? "" : selectedLabel,
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

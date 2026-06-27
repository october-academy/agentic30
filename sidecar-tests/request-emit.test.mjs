import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile, spawn } from "node:child_process";
import { fileURLToPath, pathToFileURL } from "node:url";
import { WebSocket } from "ws";
import {
  listUserInputRequests,
} from "../sidecar/user-input.mjs";
import { saveDay1GoalSelection } from "../sidecar/day1-goal-state.mjs";
import {
  appendOfficeHoursTurn,
  loadDayMemory,
  loadOfficeHoursPendingQuestion,
  loadOfficeHoursTurnLog,
  loadOnboardingMemory,
  saveOfficeHoursPendingQuestion,
  saveOnboardingMemory,
} from "../sidecar/workspace-memory.mjs";
import {
  loadCurriculumAnswerLog,
  persistNewsMarketRadarSnapshot,
} from "../sidecar/news-market-radar.mjs";
import {
  appendCommitment,
  loadOfficeHoursMemory,
} from "../sidecar/office-hours-memory.mjs";
import { loadProofLedger } from "../sidecar/execution-os.mjs";
import {
  evaluateAdaptiveRules,
  recordFiredAdaptiveRules,
} from "../sidecar/adaptive-rules.mjs";
import {
  loadBipCoachState,
  persistBipCoachState,
} from "../sidecar/bip-coach-state.mjs";
import {
  IDD_FOUNDATION_DOCS,
  persistIddSetupState,
} from "../sidecar/idd-doc-gate.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function writeStrictDay1EvidenceDocs(workspacePath) {
  const docsDir = path.join(workspacePath, ".agentic30", "docs");
  await fs.mkdir(docsDir, { recursive: true });
  await fs.writeFile(
    path.join(docsDir, "ICP.md"),
    [
      "# ICP",
      "",
      "target user: Slack 장애 대응을 책임지는 B2B SaaS 고객지원 리드",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(docsDir, "SPEC.md"),
    [
      "# SPEC",
      "",
      "problem: 인수인계 중 Slack escalation이 누락되어 고객지원 리드가 책임 소재와 해결 시간을 증명하지 못한다",
    ].join("\n"),
  );
  await fs.writeFile(
    path.join(docsDir, "GOAL.md"),
    [
      "# GOAL",
      "",
      "활성 행동: 고객지원 리드 3명에게 유료 파일럿을 요청하고 실제 escalation 워크플로를 기록한다.",
      "목표: 누락된 Slack escalation을 줄이기 위해 고객지원 리드 1명이 유료 파일럿을 수락하는지 검증한다.",
    ].join("\n"),
  );
}

test("workspace setup request_emit envelopes are host-routed and completion waits for first input", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    await fs.mkdir(path.join(harness.workspacePath, "docs"), { recursive: true });
    await writeStrictDay1EvidenceDocs(harness.workspacePath);

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
    await writeStrictDay1EvidenceDocs(harness.workspacePath);

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

test("worked Office Hours routing uses worked day while preserving calendar metadata", async () => {
  const harness = await spawnSidecar({
    extraEnv: { AGENTIC30_LOCAL_DEV_FAST_DAYS: "1" },
  });
  let ws;
  try {
    const calendarDay10Start = new Date();
    calendarDay10Start.setDate(calendarDay10Start.getDate() - 9);
    await seedDay1DoneProgress(harness.workspacePath, {
      challengeStartedAt: localDateString(calendarDay10Start),
    });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    const marker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "Workspace: worked-day routing test. ICP: returning founder. Problem: calendar gaps skip Office Hours.",
      visiblePrompt: "Test worked Office Hours routing",
      source: "office_hours_screen",
    }));

    const started = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.runtime?.officeHours?.active === true
        && event.session?.runtime?.officeHours?.day === 2,
    );

    assert.equal(started.session.runtime.officeHours.day, 2);
    assert.equal(started.session.runtime.officeHours.calendarDay, 10);
    assert.equal(started.session.runtime.officeHours.workedDayReason, "recorded_done");
    const rawProgress = JSON.parse(
      await fs.readFile(path.join(harness.workspacePath, ".agentic30", "day-progress.json"), "utf8"),
    );
    assert.equal(Object.prototype.hasOwnProperty.call(rawProgress.days, "10"), false);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("worked Office Hours resolution failure fails explicitly without calendar fallback", async () => {
  const harness = await spawnSidecar({
    extraEnv: { AGENTIC30_LOCAL_DEV_FAST_DAYS: "1" },
  });
  let ws;
  try {
    const agentic30Dir = path.join(harness.workspacePath, ".agentic30");
    await fs.mkdir(agentic30Dir, { recursive: true });
    await fs.writeFile(path.join(agentic30Dir, "day-progress.json"), "{ invalid day progress", "utf8");
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_session",
      provider: "codex",
      model: "gpt-5.1-codex-mini",
      suppressBootstrapIntake: true,
    }));
    const created = await waitForEvent(ws.events, (event) =>
      event.type === "session_created" && event.session?.status === "idle",
    );

    const marker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: "Workspace: worked-day failure test. ICP: returning founder. Problem: hidden calendar fallback.",
      visiblePrompt: "Test worked Office Hours resolution failure",
      source: "office_hours_screen",
    }));

    const failedUpdate = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "error",
    );
    assert.match(failedUpdate.session.error, /Office Hours worked-day resolution failed/);
    assert.match(failedUpdate.session.error, /Unable to parse day-progress/);
    assert.match(failedUpdate.session.error, /Unexpected|JSON|Expected/);
    assert.notEqual(failedUpdate.session.runtime?.officeHours?.active, true);
    assert.equal(failedUpdate.session.runtime?.officeHours?.calendarDay, undefined);
    assert.equal(failedUpdate.session.runtime?.officeHours?.workedDayReason, undefined);

    const failedStatus = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "office_hours_status"
        && event.sessionId === created.session.id
        && event.stage === "failed",
    );
    assert.match(failedStatus.detail, /Office Hours worked-day resolution failed/);
    assert.match(failedStatus.detail, /Unable to parse day-progress/);

    const errorEvent = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "error"
        && event.sessionId === created.session.id
        && event.errorKind === "office_hours_day_resolution_failed",
    );
    assert.equal(errorEvent.provider, "codex");
    assert.equal(errorEvent.recoverable, true);
    assert.match(errorEvent.message, /Office Hours worked-day resolution failed/);
    assert.match(errorEvent.message, /Unable to parse day-progress/);

    await waitForEventSettle();
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "session_updated"
          && event.session?.id === created.session.id
          && event.session?.runtime?.officeHours?.active === true
      ),
      false,
      "failed worked-day resolution must not fall through into active Office Hours runtime",
    );
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "office_hours_status" && event.stage === "provider_starting"
      ),
      false,
      "failed worked-day resolution must not fall through into provider routing",
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
    await waitForEventSettle();
    assertNoGenericErrorEnvelope(ws.events, created.session.id);
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
    await waitForEventSettle();
    assertNoGenericErrorEnvelope(ws.events, created.session.id);
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

test("create_doc reports provider aborts as recoverable doc creation results", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_FORCE_PROVIDER_ABORT: "claude",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "create_doc",
      docType: "icp",
      root: harness.workspacePath,
      preferredProvider: "claude",
    }));

    const result = await waitForEvent(ws.events, (event) =>
      event.type === "doc_creation_result"
        && event.docType === "icp"
        && event.errorKind === "provider_aborted",
    );
    assert.equal(result.recoverable, true);
    assert.equal(result.provider, "claude");
    assert.match(result.error, /aborted by user/);

    await waitForEventSettle();
    assert.deepEqual(
      ws.events.filter((event) => event.type === "error"),
      [],
      "create_doc provider aborts must stay on the doc_creation_result surface",
    );
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
    await waitForEventSettle();
    assertNoGenericErrorEnvelope(ws.events, created.session.id);
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

test("Office Hours Day 1 get_users no-candidate answer asks unblock instead of completing", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST: "1",
    },
  });
  let ws;
  try {
    await initGitRepo(harness.workspacePath);
    await seedDay1ActiveProgress(harness.workspacePath);
    await saveDay1GoalSelection({
      workspaceRoot: harness.workspacePath,
      selection: {
        goalType: "get_users",
        goalText: "1인 개발자 100명이 Agentic30에서 핵심 행동을 완료하게 한다",
        customer: "퇴근 후 제품을 만드는 전업 1인 개발자",
        problem: "고객 검증보다 기능 빌드로 도망간다",
        validationAction: "오늘 연락 가능한 후보 1명에게 실제 프로젝트 연결을 요청한다",
        proofSink: "local",
      },
      now: new Date("2026-06-16T00:00:00.000Z"),
    });
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

    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId: created.session.id,
      context: [
        "DAY1_LOCKED_GOAL",
        "Flow contract: locked Day 1 goal interview.",
        "Office Hours mode: Startup",
        "Expected question count: 6",
        "Goal lane: get_users / 활성 사용자 100명 모으기",
        "Goal text: 30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.",
        "Customer: 전업 1인 개발자(macOS 사용)",
        "Problem: 문제 quote 근거 부족",
        "Validation action: 오늘 연락 가능한 후보 1명에게 실제 프로젝트 연결을 요청한다",
      ].join("\n"),
      visiblePrompt: "Test Day 1 get_users no candidate",
      source: "day1_interview_goal_locked",
      day: 1,
    }));

    const activationPrompt = await waitForPendingOfficeHoursPrompt(ws, created.session.id);
    assert.equal(activationPrompt.generation?.signalId, "get_users_active_user_definition");
    assert.ok(activationPrompt.generation?.attemptId, "locked get_users prompt must carry an attempt token");
    submitStructuredAnswer(ws, created.session.id, activationPrompt, {
      selectedOptions: [],
      freeText: "프로젝트를 연결하고 오늘의 고객 검증 행동을 정리한 1명",
    });

    const candidatePrompt = await waitForPendingOfficeHoursPrompt(
      ws,
      created.session.id,
      activationPrompt.requestId,
    );
    assert.equal(candidatePrompt.generation?.signalId, "get_users_first_candidate");
    assert.ok(candidatePrompt.generation?.attemptId, "candidate prompt must remain bound to the attempt");
    const noCandidateOption = candidatePrompt.questions[0].options.find((option) =>
      /아직 후보 없음/.test(option.label || "")
    );
    assert.ok(noCandidateOption, "candidate card must expose the explicit no-candidate blocker");

    const marker = ws.events.length;
    submitStructuredAnswer(ws, created.session.id, candidatePrompt, {
      selectedOptions: [noCandidateOption.label],
      freeText: "",
    });

    const unblock = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "awaiting_input"
        && event.session?.pendingUserInput?.generation?.docType === "day1_candidate_unblock"
    );
    const prompt = unblock.session.pendingUserInput;
    assert.equal(prompt.generation.signalId, "get_users_first_candidate_unblock");
    assert.equal(prompt.generation.attemptId, undefined);
    assert.equal(unblock.session.runtime.officeHours.nextAction.kind, "card");
    assert.equal(unblock.session.runtime.officeHours.nextAction.cardType, "candidate_selection");
    assert.equal(unblock.session.runtime.officeHours.gatherProgress.answered, 1);
    assert.equal(unblock.session.runtime.officeHours.candidateBlocker.blockerReason, "아직 후보 없음");
    assert.equal(prompt.questions[0].requiresFreeText, false);
    assert.equal(prompt.questions[0].primaryTextInput.required, true);
    const savedUnblock = await loadOfficeHoursPendingQuestion({
      workspaceRoot: harness.workspacePath,
      day: 1,
    });
    assert.equal(
      savedUnblock?.request?.questions?.[0]?.primaryTextInput?.required,
      true,
      "persisted unblock snapshot must preserve the primary text requirement",
    );

    const unblockOption = prompt.questions[0].options.find((option) =>
      option.label === "스레드/커뮤니티에서 찾기"
    );
    assert.ok(unblockOption, "unblock card must expose the community search route");

    const validationMarker = ws.events.length;
    submitStructuredAnswer(ws, created.session.id, prompt, {
      selectedOptions: [unblockOption.label],
      freeText: "",
    });

    const validation = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= validationMarker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "awaiting_input"
        && event.session?.pendingUserInput?.requestId
        && event.session.pendingUserInput.requestId !== prompt.requestId
        && event.session.pendingUserInput.generation?.signalId === "get_users_first_candidate_unblock"
    );
    const retryPrompt = validation.session.pendingUserInput;
    assert.equal(retryPrompt.generation.signalId, "get_users_first_candidate_unblock");
    assert.equal(retryPrompt.questions[0].primaryTextInput.required, true);
    assert.equal(
      ws.events.slice(validationMarker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "validation_error"
          && event.requestId === retryPrompt.requestId
      ),
      true,
      "selection-only unblock answer must reissue a fresh editable request with validation status",
    );
    const retryRequests = await listUserInputRequests(harness.appSupportPath);
    assert.equal(
      retryRequests.some((request) => request.requestId === prompt.requestId),
      false,
      "stale submitted request must be removed so the Mac cannot keep showing it as submitted",
    );
    assert.equal(
      retryRequests.some((request) => request.requestId === retryPrompt.requestId),
      true,
      "retry prompt must exist as a fresh user-input request",
    );
    await waitForEventSettle();
    assert.equal(
      ws.events.slice(validationMarker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "selection-only unblock answer must not run Codex continuation",
    );
    assert.equal(
      ws.events.slice(validationMarker).some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && /pending_user_input but no pending request was attachable/.test(event.message || "")
      ),
      false,
      "selection-only unblock answer must stay attached instead of tripping the pending request assertion",
    );

    const concreteMarker = ws.events.length;
    submitStructuredAnswer(ws, created.session.id, retryPrompt, {
      selectedOptions: [unblockOption.label],
      freeText: "오늘 18:00까지 Threads에서 \"solo founder mac app\"으로 검색해 @handle 1명을 찾고 실제 프로젝트 연결을 봐달라고 DM 보낸다",
    });

    const recorded = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= concreteMarker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "idle"
        && !event.session?.pendingUserInput
        && /오늘 18:00까지 Threads/.test(event.session?.runtime?.officeHours?.candidateBlocker?.unblockAnswer || "")
    );
    assert.equal(recorded.session.runtime.officeHours.nextAction.kind, "card");
    assert.equal(recorded.session.runtime.officeHours.nextAction.cardType, "candidate_selection");
    await waitForEventSettle();
    assert.equal(
      ws.events.slice(concreteMarker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "concrete unblock answer is host-owned and must not ask Codex for a follow-up card",
    );
    assert.equal(
      ws.events.slice(concreteMarker).some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && /pending_user_input but no pending request was attachable/.test(event.message || "")
      ),
      false,
      "concrete unblock answer must not trip the pending request assertion",
    );

    await waitForEventSettle();
    const after = ws.events.slice(marker);
    assert.equal(
      after.some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "completed"
      ),
      false,
      "no-candidate answer must not complete the Day 1 interview",
    );
    assert.equal(
      after.some((event) =>
        event.type === "session_updated"
          && event.session?.id === created.session.id
          && event.session?.pendingUserInput?.generation?.docType === "day1_document_readiness"
      ),
      false,
      "no-candidate answer must not expose document readiness",
    );
    assert.equal(
      after.some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
          && /cannot start a new attempt while another is open/.test(event.message || "")
      ),
      false,
      "no-candidate unblock must not start another attempt while the current one remains open",
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
  const pastDayStart = new Date();
  pastDayStart.setDate(pastDayStart.getDate() - 4);

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
    await seedStandardInterviewActiveProgress(firstHarness.workspacePath, 3, {
      challengeStartedAt: localDateString(pastDayStart),
    });

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
    assert.equal(restoredUpdate.session.runtime.officeHours.day, 3);
    assert.ok(
      restoredUpdate.session.runtime.officeHours.calendarDay > 3,
      "pending restore should run before past-day snapshot handling",
    );
    assert.equal(
      restoredUpdate.session.pendingUserInput.questions[0].question,
      distinctPendingBeforeRestart.questions[0].question,
    );
    assert.equal(
      restoredUpdate.session.messages.filter((message) => message.officeHoursSeededTurn === true).length,
      2,
    );
    const providerWorkStages = new Set(["provider_starting", "context_loaded", "specialist_routed"]);
    assert.deepEqual(
      secondWs.events.slice(restoreMarker)
        .filter((event) =>
          event.type === "office_hours_status"
            && event.sessionId === secondCreated.session.id
            && providerWorkStages.has(event.stage)
        )
        .map((event) => event.stage),
      [],
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

test("office_hours boot fails explicitly for detached pending card without recovering it", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-detached-oh-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  const sessionId = "detached-office-hours-session";
  const requestId = "detached-office-hours-request";
  let harness;
  let ws;
  try {
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(appSupportPath, { recursive: true });
    await seedStandardInterviewActiveProgress(workspacePath, 3);
    await appendOfficeHoursTurn({
      workspaceRoot: workspacePath,
      turn: {
        day: 3,
        sessionId,
        requestId: "answered-before-detach",
        mode: "office_hours_tool",
        questionText: "박조은님께 보낸 요청 증거가 있나요?",
        responseText: "아직 보내지 못했다",
      },
    });
    const pendingRequest = makeOfficeHoursPromptSnapshot({
      sessionId,
      requestId,
      questionId: "office_hours_day3_detached_next_action",
      question: "박조은님께 오늘 보낼 요청은 어떤 확인 가능한 행동으로 정리할까요?",
      createdAt: "2026-06-16T15:24:57.057Z",
    });
    await saveOfficeHoursPendingQuestion({
      workspaceRoot: workspacePath,
      day: 3,
      source: "office_hours_day_3",
      request: pendingRequest,
      turnLog: await loadOfficeHoursTurnLog({ workspaceRoot: workspacePath }),
    });
    await fs.writeFile(
      path.join(appSupportPath, "sessions.json"),
      JSON.stringify({
        sessions: [
          {
            id: sessionId,
            title: "Office Hours · Day 3",
            provider: "codex",
            model: "gpt-5.1-codex-mini",
            status: "idle",
            error: null,
            createdAt: "2026-06-16T15:20:00.000Z",
            updatedAt: "2026-06-16T15:25:00.000Z",
            messages: [
              {
                id: "empty-final-after-tool-card",
                role: "assistant",
                provider: "codex",
                content: "",
                state: "final",
                createdAt: "2026-06-16T15:25:00.000Z",
              },
            ],
            pendingUserInput: null,
            runtime: {
              officeHours: {
                active: true,
                source: "office_hours_day_3",
                day: 3,
                startedAt: "2026-06-16T15:20:00.000Z",
                context: "Office Hours mode: Startup\nOffice Hours day: 3\nExpected question count: 6",
              },
            },
          },
        ],
      }, null, 2),
      "utf8",
    );

    harness = await spawnSidecar({
      tempRoot,
      workspacePath,
      appSupportPath,
      cleanupOnClose: false,
      extraEnv: {
        AGENTIC30_RESTORE_SESSIONS_ON_BOOT: "1",
      },
    });
    ws = await connectAndCollect(harness);
    const ready = ws.events.find((event) => event.type === "ready");
    const restored = ready?.sessions?.find((session) => session.id === sessionId);
    assert.equal(restored?.status, "error");
    assert.equal(restored?.pendingUserInput, null);
    assert.match(restored?.error || "", /pending 질문이 저장되어 있지만 현재 세션에 연결되어 있지 않습니다/);
    assert.match(restored?.error || "", new RegExp(requestId));
    assert.match(restored?.error || "", /자동 복구나 질문 재생성 없이 중단/);
    assert.equal(
      ws.events.some((event) =>
        event.type === "office_hours_status"
          && ["provider_starting", "context_loaded", "specialist_routed"].includes(event.stage)
      ),
      false,
      "detached pending failure must not start a provider run",
    );
    assert.deepEqual(await listUserInputRequests(appSupportPath), []);
  } finally {
    ws?.close();
    await harness?.close({ cleanup: false });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

test("office_hours_start resumes a stranded active Day 3 session from answered turns", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-oh-stranded-active-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  const sessionId = "stranded-active-office-hours-session";
  let harness;
  let ws;

  try {
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(appSupportPath, { recursive: true });
    await initGitRepo(workspacePath);
    const pastDayStart = new Date();
    pastDayStart.setDate(pastDayStart.getDate() - 4);
    await seedStandardInterviewActiveProgress(workspacePath, 3, {
      challengeStartedAt: localDateString(pastDayStart),
    });
    await appendOfficeHoursTurn({
      workspaceRoot: workspacePath,
      turn: makeOfficeHoursTurn({
        day: 3,
        sessionId: "prior-day-3-session",
        requestId: "answered-before-stranding",
        question: "박조은님께 보낸 요청 증거가 있나요?",
        answer: "아직 보내지 못했다",
      }),
    });
    await fs.writeFile(
      path.join(appSupportPath, "sessions.json"),
      JSON.stringify({
        sessions: [
          {
            id: sessionId,
            title: "Office Hours · Day 3",
            provider: "codex",
            model: "gpt-5.1-codex-mini",
            status: "idle",
            error: null,
            createdAt: "2026-06-16T15:20:00.000Z",
            updatedAt: "2026-06-16T15:25:00.000Z",
            messages: [],
            pendingUserInput: null,
            runtime: {
              officeHours: {
                active: true,
                source: "office_hours_day_3",
                day: 3,
                startedAt: "2026-06-16T15:20:00.000Z",
                context: "Office Hours mode: Startup\nOffice Hours day: 3\nExpected question count: 3",
              },
            },
          },
        ],
      }, null, 2),
      "utf8",
    );

    harness = await spawnSidecar({
      tempRoot,
      workspacePath,
      appSupportPath,
      cleanupOnClose: false,
      extraEnv: {
        AGENTIC30_RESTORE_SESSIONS_ON_BOOT: "1",
        AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST: "1",
      },
    });
    ws = await connectAndCollect(harness);
    const ready = ws.events.find((event) => event.type === "ready");
    const restored = ready?.sessions?.find((session) => session.id === sessionId);
    assert.equal(restored?.status, "idle");
    assert.equal(restored?.error, null);

    const marker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId,
      context: "Office Hours mode: Startup\nOffice Hours day: 3\nExpected question count: 3",
      visiblePrompt: "Retry stranded Day 3",
      source: "office_hours_day_3_retry",
      day: 3,
      selectedSources: ["git"],
    }));

    const pendingUpdate = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === sessionId
        && event.session?.status === "awaiting_input"
        && event.session?.pendingUserInput?.requestId
    );
    assert.equal(pendingUpdate.session.runtime.officeHours.resumedTurns, 1);
    assert.equal(
      pendingUpdate.session.messages.some((message) =>
        message.officeHoursSeededTurn === true
          && message.role === "user"
          && /아직 보내지 못했다/.test(message.content || "")
      ),
      true,
    );
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "error"
          && event.sessionId === sessionId
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness?.close({ cleanup: false });
    await fs.rm(tempRoot, { recursive: true, force: true });
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

test("office_hours_start continues from answered Day 3 turns when pending snapshot is missing", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_OFFICE_HOURS_MCP_REQUEST: "1",
    },
  });
  let ws;
  const context = [
    "Office Hours mode: Startup",
    "Office Hours day: 3",
    "Expected question count: 3",
    "Goal text: Support leads will pay to avoid missed Slack escalations.",
  ].join("\n");
  const pastDayStart = new Date();
  pastDayStart.setDate(pastDayStart.getDate() - 4);

  try {
    await initGitRepo(harness.workspacePath);
    await seedStandardInterviewActiveProgress(harness.workspacePath, 3, {
      challengeStartedAt: localDateString(pastDayStart),
    });
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

    const pendingUpdate = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.status === "awaiting_input"
        && event.session?.pendingUserInput?.requestId
    );
    const restored = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.runtime?.officeHours?.resumedTurns === 1
        && event.session?.messages?.some((message) =>
          message.officeHoursSeededTurn === true
            && message.role === "user"
            && /박조은님에게 요청/.test(message.content || "")
        )
    );
    assert.equal(restored.session.runtime.officeHours.calendarDay > 3, true);
    await waitForEventSettle();
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      true,
      "answered-turn continuation should start the provider for the next question",
    );
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "error"
          && event.sessionId === created.session.id
      ),
      false,
    );
    const savedPending = await loadOfficeHoursPendingQuestion({ workspaceRoot: harness.workspacePath, day: 3 });
    assert.equal(savedPending?.request?.requestId, pendingUpdate.session.pendingUserInput.requestId);
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

test("Office Hours Day 1 asks handoff clarity instead of document readiness for weak completion", async () => {
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

    const clarity = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === created.session.id
        && event.session?.pendingUserInput?.generation?.docType === "day1_handoff_clarity"
        && event.session?.status === "awaiting_input"
    );
    const prompt = clarity.session.pendingUserInput;
    assert.notEqual(prompt.requestId, pending.requestId);
    assert.equal(prompt.title, "Office Hours 구체화");
    assert.equal(prompt.generation.signalId, "day1_clarity_candidate_or_channel");
    assert.equal(prompt.questions[0].questionId, "day1_clarity_candidate_or_channel");
    assert.equal(prompt.questions[0].requiresFreeText, false);
    assert.deepEqual(prompt.questions[0].options.map((option) => option.label), [
      "지금 답하기",
      "아직 없음 - 오늘 찾을 행동 정하기",
    ]);
    assert.equal(clarity.session.runtime.officeHours.completedByExpectedCount, undefined);
    assert.equal(clarity.session.runtime.officeHours.documentReadiness.status, "needs_followup");
    assert.equal(clarity.session.runtime.day1HandoffClarity.lastSignalId, "day1_clarity_candidate_or_channel");
    assert.equal(clarity.session.runtime.day1HandoffClarity.lastAnswerState, "asked");
    assert.doesNotMatch(prompt.intro?.title || "", /문서 저장|근거 보완/);
    assert.doesNotMatch(prompt.title || "", /문서 저장|근거 보완/);
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "provider_starting"
      ),
      false,
      "sixth weak answer must not schedule another provider continuation",
    );
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === created.session.id
          && event.stage === "completed"
      ),
      false,
      "weak Day 1 completion must stay in clarity instead of completing",
    );
    assert.equal(
      ws.events.slice(marker).some((event) =>
        event.type === "session_updated"
          && event.session?.id === created.session.id
          && event.session?.pendingUserInput?.generation?.docType === "day1_document_readiness"
      ),
      false,
      "weak Day 1 completion must not expose document readiness",
    );

    const requests = await listUserInputRequests(harness.appSupportPath);
    assert.equal(requests.some((request) => request.requestId === prompt.requestId), true);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours revision with no next question fails visibly", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-oh-revision-no-next-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  const sessionId = "revision-no-next-question-session";
  const requestId = "revision-no-next-question-q1";
  let harness;
  let ws;
  try {
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(appSupportPath, { recursive: true });
    await initGitRepo(workspacePath);
    await seedStandardInterviewActiveProgress(workspacePath, 3);
    const loaderPath = path.join(tempRoot, "office-hours-no-next-question-loader.mjs");
    const registerPath = path.join(tempRoot, "register-office-hours-loader.mjs");
    await fs.writeFile(
      loaderPath,
      `
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (
    process.env.AGENTIC30_TEST_STUB_OFFICE_HOURS_NO_NEXT_QUESTION === "1"
    && url.endsWith("/sidecar/provider-runner.mjs")
  ) {
    const source = typeof result.source === "string"
      ? result.source
      : new TextDecoder().decode(result.source);
    return {
      ...result,
      source: source.replace(
        "if (/Agentic30 Day 1 STEP Office Hours|Office Hours를 시작한다/i.test(value)) {",
        "if (false && /Agentic30 Day 1 STEP Office Hours|Office Hours를 시작한다/i.test(value)) {",
      ),
    };
  }
  return result;
}
`,
      "utf8",
    );
    await fs.writeFile(
      registerPath,
      `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(loaderPath).href)}, import.meta.url);\n`,
      "utf8",
    );
    const prompt = makeOfficeHoursPromptSnapshot({
      sessionId,
      requestId,
      questionId: "revision_no_next_question",
      question: "Q1: 어떤 고객에게 오늘 요청할 건가요?",
    });
    await appendOfficeHoursTurn({
      workspaceRoot: workspacePath,
      turn: makeOfficeHoursTurn({
        day: 3,
        index: 1,
        sessionId,
        requestId,
        question: prompt.questions[0].question,
        answer: "박조은님에게 paid pilot 조건을 확인한다",
      }),
    });
    await fs.writeFile(
      path.join(appSupportPath, "sessions.json"),
      JSON.stringify({
        sessions: [
          {
            id: sessionId,
            title: "Office Hours · Day 3",
            provider: "codex",
            model: "gpt-5.1-codex-mini",
            status: "idle",
            error: null,
            createdAt: "2026-06-16T15:20:00.000Z",
            updatedAt: "2026-06-16T15:25:00.000Z",
            messages: [],
            pendingUserInput: null,
            runtime: {
              officeHours: {
                active: true,
                source: "office_hours_day_3",
                day: 3,
                startedAt: "2026-06-16T15:20:00.000Z",
                context: "Office Hours mode: Startup\nOffice Hours day: 3\nExpected question count: 6",
                expectedQuestionCount: 6,
                promptSnapshots: [prompt],
              },
            },
          },
        ],
      }, null, 2),
      "utf8",
    );

    harness = await spawnSidecar({
      tempRoot,
      workspacePath,
      appSupportPath,
      cleanupOnClose: false,
      extraEnv: {
        AGENTIC30_RESTORE_SESSIONS_ON_BOOT: "1",
        AGENTIC30_TEST_STUB_OFFICE_HOURS_NO_NEXT_QUESTION: "1",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--import=${pathToFileURL(registerPath).href}`,
      },
    });
    ws = await connectAndCollect(harness);

    const marker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_revise_answer",
      sessionId,
      requestId,
      prompt,
      responses: [
        {
          question: prompt.questions[0].question,
          selectedOptions: [prompt.questions[0].options[1].label],
          freeText: "오늘 18시까지 DM으로 유료 파일럿 조건을 묻는다",
        },
      ],
    }));

    const failedUpdate = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "session_updated"
        && event.session?.id === sessionId
        && event.session?.status === "error"
    );
    assert.equal(failedUpdate.session.pendingUserInput, null);

    const failedStatus = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "office_hours_status"
        && event.sessionId === sessionId
        && event.stage === "failed"
    );
    const errorEvent = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "error"
        && event.sessionId === sessionId
    );
    const visibleFailureText = [
      failedUpdate.session.error,
      failedStatus.detail,
      failedStatus.progressText,
      errorEvent.message,
    ].filter(Boolean).join("\n");
    assert.match(visibleFailureText, /질문을 만들지 못했습니다/);
    assert.equal(errorEvent.errorKind, "office_hours_no_next_question");
    assert.equal(errorEvent.recoverable, true);
    await waitForEventSettle();
    assertNoGenericErrorEnvelope(ws.events.slice(marker), sessionId);
  } finally {
    ws?.close();
    await harness?.close({ cleanup: false });
    await fs.rm(tempRoot, { recursive: true, force: true });
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
    assert.equal(hydrated.session.runtime.officeHours.documentReadiness.status, "ready");
    assert.equal(hydrated.session.runtime.officeHours.promptSnapshots[0].submissions[0].selectedOptions[0], "첫 가치 완료");
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
    assert.equal(Number.isFinite(collecting.status.elapsedMs), true);

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
    assert.equal(Number.isFinite(cached.status.elapsedMs), true);
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

    assert.equal(Number.isFinite(collecting.status.elapsedMs), true);
    assert.equal(Number.isFinite(result.status.durationMs), true);
    assert.equal(result.status.durationMs >= result.status.elapsedMs, true);
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

test("v2 daily card order", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_ENABLE_PROGRAM_V2: "1",
      AGENTIC30_LOCAL_DEV_FAST_DAYS: "1",
    },
  });
  let ws;
  try {
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    await seedRepeatedOpenCommitments(harness.workspacePath, { day: 3 });
    ws = await connectAndCollect(harness);

    ws.send(JSON.stringify({
      type: "day_progress_patch",
      workspaceRoot: harness.workspacePath,
      day: 3,
      stepId: "execution",
      status: "active",
    }));

    await waitForV2DailyCardTypes(ws, [
      "office_hours_state_transition",
      "office_hours_agent_workpack",
      "program_scoreboard_snapshot",
      "revenue_or_activation_gate",
    ]);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("v2 disabled preserves mission card", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_ENABLE_PROGRAM_V2: "",
      AGENTIC30_LOCAL_DEV_FAST_DAYS: "1",
    },
  });
  let ws;
  try {
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    await seedRepeatedOpenCommitments(harness.workspacePath, { day: 3 });
    ws = await connectAndCollect(harness);
    await waitForEventSettle();
    assert.equal(
      ws.events.some((event) => event.type === "program_notification_schedule"),
      false,
      "feature flag off must not emit v2 program_notification_schedule events",
    );

    ws.send(JSON.stringify({
      type: "day_progress_patch",
      workspaceRoot: harness.workspacePath,
      day: 3,
      stepId: "execution",
      status: "active",
    }));

    const legacy = await waitForEvent(ws.events, (event) =>
      event.type === "mission_card"
        && event.workspaceRoot === harness.workspacePath
        && event.missionCard?.source === "idd",
    );
    assert.equal(legacy.missionCard.day, 3);
    await waitForEventSettle();
    assert.equal(
      ws.events.some((event) => event.type === "mission_card" && event.missionCard?.type),
      false,
      "feature flag off must not emit v2 daily-card union payloads",
    );
    assert.equal(
      ws.events.some((event) => event.type === "program_notification_schedule"),
      false,
      "feature flag off must not emit v2 program_notification_schedule events after progress changes",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_daily_card_submit duplicate no-op", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_ENABLE_PROGRAM_V2: "1",
      AGENTIC30_LOCAL_DEV_FAST_DAYS: "1",
    },
  });
  let ws;
  try {
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    const seeded = await seedRepeatedOpenCommitments(harness.workspacePath, { day: 3 });
    ws = await connectAndCollect(harness);
    const stateCard = await emitAndFindV2Card(ws, harness.workspacePath, "office_hours_state_transition");

    const body = {
      type: "office_hours_daily_card_submit",
      workspaceRoot: harness.workspacePath,
      cardId: stateCard.id,
      cardGenerationId: stateCard.generation?.generationId,
      sourceStateVersion: stateCard.sourceStateVersion,
      cardType: stateCard.type,
      sourceCommitmentId: seeded.activeCommitmentId,
      action: "attach_evidence",
      choiceId: "attach_evidence",
      evidenceRefs: [
        {
          kind: "url",
          url: "https://example.com/customer-proof",
          note: "Customer accepted the paid ask.",
        },
      ],
    };

    ws.send(JSON.stringify(body));
    const first = await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_daily_card_submit_result"
        && event.workspaceRoot === harness.workspacePath
        && event.cardId === stateCard.id,
    );
    assert.equal(first.success, true);
    assert.equal(first.deduped, false);

    ws.send(JSON.stringify(body));
    const duplicate = await waitForEvent(ws.events, (event) =>
      event.type === "office_hours_daily_card_submit_result"
        && event.workspaceRoot === harness.workspacePath
        && event.cardId === stateCard.id
        && event.deduped === true,
    );
    assert.equal(duplicate.success, true);

    const memory = await loadOfficeHoursMemory({ workspaceRoot: harness.workspacePath });
    const resolved = memory.commitments.filter((commitment) =>
      commitment.id === seeded.activeCommitmentId && commitment.status === "met"
    );
    assert.equal(resolved.length, 1);
    const ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.filter((event) => event.sourceUrl === "https://example.com/customer-proof").length, 1);

    ws.send(JSON.stringify({
      ...body,
      evidenceRefs: [
        {
          kind: "url",
          url: "https://example.com/different-proof",
          note: "Different body for the same card.",
        },
      ],
    }));
    const duplicateDifferent = await waitForEvent(ws.events, (event) =>
      event.type === "error" && /ERR_DUPLICATE_DAILY_CARD_SUBMISSION/.test(event.message || ""),
    );
    assert.match(duplicateDifferent.message, /ERR_DUPLICATE_DAILY_CARD_SUBMISSION/);

    ws.send(JSON.stringify({
      ...body,
      action: "keep_open_today",
      choiceId: "keep_open_today",
      evidenceRefs: [],
    }));
    const alreadyResolved = await waitForEvent(ws.events, (event) =>
      event.type === "error" && /ERR_COMMITMENT_ALREADY_RESOLVED/.test(event.message || ""),
    );
    assert.match(alreadyResolved.message, /ERR_COMMITMENT_ALREADY_RESOLVED/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_daily_card_submit concurrent different body rejects one mutation", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_ENABLE_PROGRAM_V2: "1",
      AGENTIC30_LOCAL_DEV_FAST_DAYS: "1",
    },
  });
  let ws;
  try {
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    const seeded = await seedRepeatedOpenCommitments(harness.workspacePath, { day: 3 });
    ws = await connectAndCollect(harness);
    const stateCard = await emitAndFindV2Card(ws, harness.workspacePath, "office_hours_state_transition");

    const body = {
      type: "office_hours_daily_card_submit",
      workspaceRoot: harness.workspacePath,
      cardId: stateCard.id,
      cardGenerationId: stateCard.generation?.generationId,
      sourceStateVersion: stateCard.sourceStateVersion,
      cardType: stateCard.type,
      sourceCommitmentId: seeded.activeCommitmentId,
      action: "attach_evidence",
      choiceId: "attach_evidence",
      evidenceRefs: [
        {
          kind: "url",
          url: "https://example.com/proof-a",
          note: "First overlapping proof.",
        },
      ],
    };

    ws.events.length = 0;
    ws.send(JSON.stringify(body));
    ws.send(JSON.stringify({
      ...body,
      evidenceRefs: [
        {
          kind: "url",
          url: "https://example.com/proof-b",
          note: "Second overlapping proof with a different body.",
        },
      ],
    }));

    await waitForEvents(ws.events, (event) =>
      (event.type === "office_hours_daily_card_submit_result" && event.cardId === stateCard.id)
        || (event.type === "error" && /ERR_DUPLICATE_DAILY_CARD_SUBMISSION/.test(event.message || "")),
    2);

    const results = ws.events.filter((event) =>
      event.type === "office_hours_daily_card_submit_result" && event.cardId === stateCard.id
    );
    const duplicateErrors = ws.events.filter((event) =>
      event.type === "error" && /ERR_DUPLICATE_DAILY_CARD_SUBMISSION/.test(event.message || "")
    );
    assert.equal(results.length, 1);
    assert.equal(results[0].success, true);
    assert.equal(results[0].deduped, false);
    assert.equal(duplicateErrors.length, 1);

    const ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    const ledgerUrls = ledger.events
      .filter((event) => event.actionId === seeded.activeCommitmentId)
      .map((event) => event.sourceUrl)
      .sort();
    assert.equal(ledgerUrls.length, 1);
    assert.equal(["https://example.com/proof-a", "https://example.com/proof-b"].includes(ledgerUrls[0]), true);

    const memory = await loadOfficeHoursMemory({ workspaceRoot: harness.workspacePath });
    const resolved = memory.commitments.filter((commitment) =>
      commitment.id === seeded.activeCommitmentId && commitment.status === "met"
    );
    assert.equal(resolved.length, 1);

    const receipts = JSON.parse(await fs.readFile(
      path.join(harness.workspacePath, ".agentic30", "program-v2-daily-card-submissions.json"),
      "utf8",
    ));
    const matchingReceipts = receipts.submissions.filter((entry) => entry.key === `${stateCard.id}:${seeded.activeCommitmentId}`);
    assert.equal(matchingReceipts.length, 1);
    const receiptBody = JSON.parse(matchingReceipts[0].canonicalBody);
    assert.equal(receiptBody.action, "attach_evidence");
    assert.equal(receiptBody.sourceCommitmentId, seeded.activeCommitmentId);
    assert.equal(receiptBody.evidenceRefs.length, 1);
    assert.equal(
      ["https://example.com/proof-a", "https://example.com/proof-b"].includes(receiptBody.evidenceRefs[0].url),
      true,
    );
    assert.equal(receiptBody.evidenceRefs[0].url, ledgerUrls[0]);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_daily_card_submit corrupt receipt fails explicitly", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_ENABLE_PROGRAM_V2: "1",
      AGENTIC30_LOCAL_DEV_FAST_DAYS: "1",
    },
  });
  let ws;
  try {
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    const seeded = await seedRepeatedOpenCommitments(harness.workspacePath, { day: 3 });
    ws = await connectAndCollect(harness);
    const stateCard = await emitAndFindV2Card(ws, harness.workspacePath, "office_hours_state_transition");
    const receiptPath = path.join(harness.workspacePath, ".agentic30", "program-v2-daily-card-submissions.json");
    await fs.writeFile(receiptPath, "{not-json", "utf8");

    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "office_hours_daily_card_submit",
      workspaceRoot: harness.workspacePath,
      cardId: stateCard.id,
      cardGenerationId: stateCard.generation?.generationId,
      sourceStateVersion: stateCard.sourceStateVersion,
      cardType: stateCard.type,
      sourceCommitmentId: seeded.activeCommitmentId,
      action: "attach_evidence",
      choiceId: "attach_evidence",
      evidenceRefs: [
        {
          kind: "url",
          url: "https://example.com/corrupt-receipt-proof",
          note: "This proof must not be written when the receipt store is corrupt.",
        },
      ],
    }));

    const error = await waitForEvent(ws.events, (event) =>
      event.type === "error" && /ERR_DAILY_CARD_SUBMISSION_RECEIPT_CORRUPT/.test(event.message || ""),
    );
    assert.match(error.message, /ERR_DAILY_CARD_SUBMISSION_RECEIPT_CORRUPT/);

    const ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.filter((event) => event.sourceUrl === "https://example.com/corrupt-receipt-proof").length, 0);
    const memory = await loadOfficeHoursMemory({ workspaceRoot: harness.workspacePath });
    const commitment = memory.commitments.find((entry) => entry.id === seeded.activeCommitmentId);
    assert.notEqual(commitment?.status, "met");
    assert.equal(await fs.readFile(receiptPath, "utf8"), "{not-json");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_daily_card_submit malformed receipt store fails explicitly", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_ENABLE_PROGRAM_V2: "1",
      AGENTIC30_LOCAL_DEV_FAST_DAYS: "1",
    },
  });
  let ws;
  try {
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    const seeded = await seedRepeatedOpenCommitments(harness.workspacePath, { day: 3 });
    ws = await connectAndCollect(harness);
    const stateCard = await emitAndFindV2Card(ws, harness.workspacePath, "office_hours_state_transition");
    const receiptPath = path.join(harness.workspacePath, ".agentic30", "program-v2-daily-card-submissions.json");
    const malformedStore = JSON.stringify({ schemaVersion: 1, submissions: "not-an-array" });
    await fs.writeFile(receiptPath, malformedStore, "utf8");

    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "office_hours_daily_card_submit",
      workspaceRoot: harness.workspacePath,
      cardId: stateCard.id,
      cardGenerationId: stateCard.generation?.generationId,
      sourceStateVersion: stateCard.sourceStateVersion,
      cardType: stateCard.type,
      sourceCommitmentId: seeded.activeCommitmentId,
      action: "attach_evidence",
      choiceId: "attach_evidence",
      evidenceRefs: [
        {
          kind: "url",
          url: "https://example.com/malformed-receipt-proof",
          note: "This proof must not be written when the receipt store schema is malformed.",
        },
      ],
    }));

    const observed = await waitForEvent(ws.events, (event) =>
      (event.type === "error" && /ERR_DAILY_CARD_SUBMISSION_RECEIPT_CORRUPT/.test(event.message || ""))
        || (event.type === "office_hours_daily_card_submit_result" && event.cardId === stateCard.id),
    );
    if (observed.type !== "error") {
      const ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
      const memory = await loadOfficeHoursMemory({ workspaceRoot: harness.workspacePath });
      const commitment = memory.commitments.find((entry) => entry.id === seeded.activeCommitmentId);
      assert.fail(
        `malformed receipt store was accepted; proofCount=${ledger.events.filter((event) => event.sourceUrl === "https://example.com/malformed-receipt-proof").length}; commitmentStatus=${commitment?.status}; receiptBytes=${await fs.readFile(receiptPath, "utf8")}`,
      );
    }
    assert.match(observed.message, /ERR_DAILY_CARD_SUBMISSION_RECEIPT_CORRUPT/);

    const ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.filter((event) => event.sourceUrl === "https://example.com/malformed-receipt-proof").length, 0);
    const memory = await loadOfficeHoursMemory({ workspaceRoot: harness.workspacePath });
    const commitment = memory.commitments.find((entry) => entry.id === seeded.activeCommitmentId);
    assert.notEqual(commitment?.status, "met");
    assert.equal(await fs.readFile(receiptPath, "utf8"), malformedStore);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_daily_card_submit concurrent identical body dedupes one mutation", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_ENABLE_PROGRAM_V2: "1",
      AGENTIC30_LOCAL_DEV_FAST_DAYS: "1",
    },
  });
  let ws;
  try {
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    const seeded = await seedRepeatedOpenCommitments(harness.workspacePath, { day: 3 });
    ws = await connectAndCollect(harness);
    const stateCard = await emitAndFindV2Card(ws, harness.workspacePath, "office_hours_state_transition");

    const body = {
      type: "office_hours_daily_card_submit",
      workspaceRoot: harness.workspacePath,
      cardId: stateCard.id,
      cardGenerationId: stateCard.generation?.generationId,
      sourceStateVersion: stateCard.sourceStateVersion,
      cardType: stateCard.type,
      sourceCommitmentId: seeded.activeCommitmentId,
      action: "attach_evidence",
      choiceId: "attach_evidence",
      evidenceRefs: [
        {
          kind: "url",
          url: "https://example.com/same-proof",
          note: "Same overlapping proof.",
        },
      ],
    };

    ws.events.length = 0;
    ws.send(JSON.stringify(body));
    ws.send(JSON.stringify(body));

    await waitForEvents(ws.events, (event) =>
      event.type === "office_hours_daily_card_submit_result" && event.cardId === stateCard.id,
    2);

    const results = ws.events.filter((event) =>
      event.type === "office_hours_daily_card_submit_result" && event.cardId === stateCard.id
    );
    assert.equal(results.length, 2);
    assert.equal(results.filter((event) => event.success === true && event.deduped === false).length, 1);
    assert.equal(results.filter((event) => event.success === true && event.deduped === true).length, 1);
    assert.equal(
      new Set(results.map((event) => event.proofEventId).filter(Boolean)).size,
      1,
    );

    const ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.filter((event) => event.sourceUrl === "https://example.com/same-proof").length, 1);

    const receipts = JSON.parse(await fs.readFile(
      path.join(harness.workspacePath, ".agentic30", "program-v2-daily-card-submissions.json"),
      "utf8",
    ));
    assert.equal(receipts.submissions.filter((entry) => entry.key === `${stateCard.id}:${seeded.activeCommitmentId}`).length, 1);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_daily_card_submit stale card id", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_ENABLE_PROGRAM_V2: "1",
      AGENTIC30_LOCAL_DEV_FAST_DAYS: "1",
    },
  });
  let ws;
  try {
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    const seeded = await seedRepeatedOpenCommitments(harness.workspacePath, { day: 3 });
    ws = await connectAndCollect(harness);
    const stateCard = await emitAndFindV2Card(ws, harness.workspacePath, "office_hours_state_transition");

    ws.send(JSON.stringify({
      type: "office_hours_daily_card_submit",
      workspaceRoot: harness.workspacePath,
      cardId: "daily-card-stale",
      cardGenerationId: stateCard.generation?.generationId,
      sourceStateVersion: stateCard.sourceStateVersion,
      cardType: stateCard.type,
      sourceCommitmentId: seeded.activeCommitmentId,
      action: "keep_open_today",
      choiceId: "keep_open_today",
    }));

    const error = await waitForEvent(ws.events, (event) =>
      event.type === "error" && /ERR_STALE_DAILY_CARD_SUBMISSION/.test(event.message || ""),
    );
    assert.match(error.message, /ERR_STALE_DAILY_CARD_SUBMISSION/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("office_hours_daily_card_submit out-of-order", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_ENABLE_PROGRAM_V2: "1",
      AGENTIC30_LOCAL_DEV_FAST_DAYS: "1",
    },
  });
  let ws;
  try {
    await seedStandardInterviewDoneProgress(harness.workspacePath, 3);
    const seeded = await seedRepeatedOpenCommitments(harness.workspacePath, { day: 3 });
    ws = await connectAndCollect(harness);
    const workpackCard = await emitAndFindV2Card(ws, harness.workspacePath, "office_hours_agent_workpack");

    ws.send(JSON.stringify({
      type: "office_hours_daily_card_submit",
      workspaceRoot: harness.workspacePath,
      cardId: workpackCard.id,
      cardGenerationId: workpackCard.generation?.generationId,
      sourceStateVersion: workpackCard.sourceStateVersion,
      cardType: workpackCard.type,
      sourceCommitmentId: seeded.activeCommitmentId,
      action: "attach_evidence",
      choiceId: "attach_evidence",
    }));

    const error = await waitForEvent(ws.events, (event) =>
      event.type === "error" && /ERR_OUT_OF_ORDER_DAILY_CARD_SUBMISSION/.test(event.message || ""),
    );
    assert.match(error.message, /ERR_OUT_OF_ORDER_DAILY_CARD_SUBMISSION/);
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
    await writeStrictDay1EvidenceDocs(harness.workspacePath);
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

test("curriculum_answer_saved persists OpenDesign Day answers through the websocket route", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "curriculum_answer_saved",
      workspaceRoot: harness.workspacePath,
      day: 2,
      dayType: "standard",
      questionId: "q-market-risk",
      question: {
        id: "q-market-risk",
        dimension: "market",
        title: "Market risk",
        prompt: "Which risk should you test first?",
      },
      answerId: "a-paid-pilot",
      answer: {
        id: "a-paid-pilot",
        title: "Paid pilot",
        detail: "Ask one customer for a paid pilot.",
        freeform: "Support lead pilot",
        isAntiSignal: false,
      },
      occurredAt: "2026-06-22T00:00:00.000Z",
    }));

    const saved = await waitForEvent(ws.events, (event) =>
      event.type === "curriculum_answer_saved_result"
        && event.success === true,
    );
    assert.equal(saved.success, true);
    assert.equal(saved.answerCount, 1);

    const log = await loadCurriculumAnswerLog({ workspaceRoot: harness.workspacePath });
    assert.equal(log.records.length, 1);
    assert.equal(log.records[0].day, 2);
    assert.equal(log.records[0].questionId, "q-market-risk");
    assert.equal(log.records[0].answerId, "a-paid-pilot");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("execution_os_get and proof_ledger_append return updated execution state", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "execution_os_get",
      workspaceRoot: harness.workspacePath,
      day: 14,
    }));
    const initial = await waitForEvent(ws.events, (event) =>
      event.type === "execution_os_state"
        && event.workspaceRoot === harness.workspacePath
        && event.success === true,
    );
    assert.equal(initial.executionOs.currentDay, 14);
    assert.equal(initial.proofLedger.schema, "agentic30.proof_ledger.v2");

    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "proof_ledger_append",
      workspaceRoot: harness.workspacePath,
      day: 14,
      event: {
        id: "proof-route-1",
        type: "payment_record",
        day: 14,
        status: "accepted",
        strength: "strong",
        sourceUrl: "https://example.com/payment-route-proof",
      },
    }));
    const updated = await waitForEvent(ws.events, (event) =>
      event.type === "execution_os_state"
        && event.workspaceRoot === harness.workspacePath
        && event.appendedProofEvent?.id === "proof-route-1",
    );
    assert.equal(updated.success, true);
    assert.equal(updated.proofLedger.events.length, 1);
    assert.equal(updated.proofLedger.events[0].type, "payment_record");

    const ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].sourceUrl, "https://example.com/payment-route-proof");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("onboarding_memory_save and onboarding_memory_request sync workspace memory explicitly", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "onboarding_memory_save",
      workspaceRoot: harness.workspacePath,
      memory: {
        projectPath: harness.workspacePath,
        onboardingContext: {
          businessDescription: "SupportLens for B2B support leads",
          goal: "Reduce missed escalations",
          focusArea: "B2B support leads",
          productBottleneck: "Missed escalations",
        },
        answers: {
          primaryFocus: { answer: "B2B support leads" },
          primaryBottleneck: { answer: "Missed escalations" },
        },
      },
    }));

    const saved = await waitForEvent(ws.events, (event) =>
      event.type === "onboarding_memory_state"
        && event.workspaceRoot === harness.workspacePath
        && event.success === true,
    );
    assert.equal(saved.onboardingMemory.projectPath, harness.workspacePath);
    assert.equal(saved.onboardingMemory.onboardingContext.goal, "Reduce missed escalations");

    const persisted = await loadOnboardingMemory({ workspaceRoot: harness.workspacePath });
    assert.equal(persisted.onboardingContext.product_bottleneck, "Missed escalations");

    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "onboarding_memory_request",
      workspaceRoot: harness.workspacePath,
    }));
    const loaded = await waitForEvent(ws.events, (event) =>
      event.type === "onboarding_memory_state"
        && event.workspaceRoot === harness.workspacePath
        && event.success === true,
    );
    assert.equal(loaded.onboardingMemory.answers.primaryFocus.answer, "B2B support leads");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("provider_settings_update returns a diagnostics snapshot after syncing settings", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "provider_settings_update",
      providers: {
        codex: {
          authMode: "api_key",
          model: "gpt-5.4-mini",
          reasoningEffort: "medium",
        },
      },
      integrations: {
        exa: {
          apiKey: "test-exa-key",
        },
      },
    }));

    const diagnostics = await waitForEvent(ws.events, (event) =>
      event.type === "diagnostics_snapshot"
        && event.diagnostics?.environment,
    );
    assert.equal(Boolean(diagnostics.diagnostics.preflight), true);
    assert.equal(Boolean(diagnostics.diagnostics.runtime.node), true);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("bip_coach_configure persists user source settings through the websocket route", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "bip_coach_configure",
      provider: "codex",
      threadsHandle: "@october",
      sheetUrl: "https://docs.google.com/spreadsheets/d/1SheetRouteConfigId1234567890/edit#gid=0",
      docUrl: "https://docs.google.com/document/d/1DocRouteConfigId1234567890/edit",
      morningHour: 9,
      eveningHour: 22,
    }));

    const state = await waitForEvent(ws.events, (event) =>
      event.type === "bip_coach_state"
        && event.bipCoach?.config?.sheetId === "1SheetRouteConfigId1234567890",
    );
    assert.equal(state.bipCoach.config.docId, "1DocRouteConfigId1234567890");
    assert.equal(state.bipCoach.config.threadsHandle, "october");
    assert.equal(state.bipCoach.config.morningHour, 9);

    const persisted = await loadBipCoachState(path.join(harness.appSupportPath, "bip-coach-state.json"));
    assert.equal(persisted.config.sheetId, "1SheetRouteConfigId1234567890");
    assert.equal(persisted.config.docId, "1DocRouteConfigId1234567890");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("bip_coach_refresh_evidence fails explicitly when coach sources are not configured", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({ type: "bip_coach_refresh_evidence" }));

    const error = await waitForEvent(ws.events, (event) =>
      event.type === "bip_coach_error"
        && /Google Docs/.test(event.message || "")
        && /Google Sheets/.test(event.message || ""),
    );
    assert.equal(error.bipCoach.lastError, error.message);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("bip_readiness gwsAuth recheck probes gws CLI and emits row result", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-gws-recheck-route-"));
  const gwsPath = path.join(tempRoot, "gws");
  await fs.writeFile(gwsPath, `#!/bin/sh
if [ "$1" = "auth" ] && [ "$2" = "status" ]; then
  echo '{"has_refresh_token":true,"encrypted_credentials_exists":true,"token_valid":true}'
  exit 0
fi
if [ "$1" = "drive" ] && [ "$2" = "about" ] && [ "$3" = "get" ]; then
  echo '{"user":{"emailAddress":"qa@example.invalid"}}'
  exit 0
fi
echo "unexpected gws args: $*" >&2
exit 2
`);
  await fs.chmod(gwsPath, 0o755);
  const harness = await spawnSidecar({
    tempRoot,
    extraEnv: {
      AGENTIC30_GWS_BIN: gwsPath,
      PATH: "",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "bip_readiness_action",
      rowId: "gwsAuth",
      action: "recheck",
    }));

    const done = await waitForEvent(ws.events, (event) =>
      event.type === "bip_readiness_event"
        && event.rowId === "gwsAuth"
        && event.status === "done",
    );
    assert.equal(done.error, undefined);
    assert.equal(done.id, undefined);
    await waitForEvent(ws.events, (event) =>
      event.type === "bip_readiness_event"
        && event.rowId === "docUrl"
        && event.status === "pending",
    );
    await waitForEvent(ws.events, (event) =>
      event.type === "bip_readiness_event"
        && event.rowId === "sheetUrl"
        && event.status === "pending",
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("bip_coach_select_mission promotes a generated mission choice", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-bip-select-route-"));
  const appSupportPath = path.join(tempRoot, "app-support");
  await fs.mkdir(appSupportPath, { recursive: true });
  await persistBipCoachState(path.join(appSupportPath, "bip-coach-state.json"), {
    config: { provider: "codex", sheetId: "1SheetRouteSelectId1234567890", docId: "1DocRouteSelectId1234567890" },
    evidence: {
      fullRead: true,
      allRows: [{ rowNumber: 2, date: "2026-06-22", posts: ["route proof"] }],
      recentRows: [{ rowNumber: 2, date: "2026-06-22", posts: ["route proof"] }],
      docText: "route doc",
      sheetRowsRead: 1,
      docCharsRead: 9,
    },
    missionChoices: [
      {
        id: "mission-route-1",
        title: "Route mission",
        mission: "Publish one proof note.",
        provider: "codex",
      },
    ],
  });

  const harness = await spawnSidecar({ tempRoot, appSupportPath });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "bip_coach_select_mission",
      missionId: "mission-route-1",
    }));

    const selected = await waitForEvent(ws.events, (event) =>
      event.type === "bip_coach_state"
        && event.bipCoach?.currentMission?.id === "mission-route-1",
    );
    assert.equal(selected.bipCoach.currentMission.status, "drafted");

    const persisted = await loadBipCoachState(path.join(appSupportPath, "bip-coach-state.json"));
    assert.equal(persisted.currentMission.id, "mission-route-1");
    assert.equal(persisted.currentMission.status, "drafted");
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("exa_codex_mcp_config_assure writes Codex MCP config and redacts status output", async () => {
  const harness = await spawnSidecar({
    extraEnv: { EXA_API_KEY: "exa_route_secret" },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "exa_codex_mcp_config_assure",
      preferredProvider: "codex",
    }));

    const result = await waitForEvent(ws.events, (event) =>
      event.type === "integration_status_result"
        && ["ready", "failed", "missing"].includes(String(event.integrationStatus?.exa?.state || "")),
    );
    assert.equal(result.integrationStatus.exa.state, "ready");
    assert.equal(JSON.stringify(result).includes("exa_route_secret"), false);

    const configPath = path.join(harness.tempRoot, "home", ".codex", "config.toml");
    const config = await fs.readFile(configPath, "utf8");
    assert.match(config, /\[mcp_servers\.exa\]/);
    assert.match(config, /web_search_exa/);
    assert.match(config, /exa_route_secret/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("idd_setup_approve writes approved foundation documents through the websocket route", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-idd-approve-route-"));
  const workspacePath = path.join(tempRoot, "workspace");
  await fs.mkdir(workspacePath, { recursive: true });
  const drafts = {
    goal: [
      "# GOAL",
      "이번 주 검증 목표는 B2B support leads 3명에게 paid pilot reply를 받는 것이다.",
      "지표 metric은 응답 count와 결제 의향 전환이며 기준값 threshold는 3명 중 1명 이상이다.",
      "금요일 deadline까지 no reply면 실패 조건으로 보고 pivot한다.",
    ].join("\n\n"),
    icp: [
      "# ICP",
      "좁은 세그먼트는 Slack handoff가 많은 B2B SaaS support lead다.",
      "reachable person은 @supportlead 계정과 김지원님에게 DM 인터뷰로 연락한다.",
      "현재 대안은 Notion과 스프레드시트에 수작업으로 복사하는 workflow다.",
      "pressure cost는 주당 3시간 지연과 월 매출 손실이다.",
    ].join("\n\n"),
    values: [
      "# VALUES",
      "고객 대화 증거를 자동화보다 우선 선택하는 tradeoff를 감수한다.",
      "이번 주에는 dashboard 확장을 하지 않을 것이며 nice-to-have는 포기한다.",
      "고객 응답이 없을 때 trigger로 범위를 줄인다.",
      "위반 예시는 새 기능을 더 만들고 고객 ask를 skip하는 것이다.",
    ].join("\n\n"),
    spec: [
      "# SPEC",
      "사용자 workflow는 Slack thread를 열고 먼저 누락 escalation을 입력한 다음 다음 행동을 저장한다.",
      "MVP wedge는 이번 주 작은 첫 버전으로 한 고객의 handoff note만 처리한다.",
      "Non-goal은 analytics dashboard와 team billing을 만들지 않을 것이다.",
      "observable success는 1명이 실제 handoff를 완료했다고 측정되는 signal이다.",
      "core risk는 support lead가 이 문제가 틀리거나 중요하지 않다고 보는 가정이다.",
    ].join("\n\n"),
  };
  await persistIddSetupState(workspacePath, {
    status: "preview_ready",
    drafts,
    ambiguityScore: 0,
    ambiguityRubric: { docs: [] },
    unresolvedAssumptions: [],
  });

  const harness = await spawnSidecar({ tempRoot, workspacePath });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({ type: "idd_setup_approve" }));

    const approved = await waitForEvent(ws.events, (event) =>
      event.type === "idd_setup_approved"
        && event.iddSetupStatus === "approved",
    );
    assert.equal(approved.iddSetupComplete, true);

    for (const doc of IDD_FOUNDATION_DOCS) {
      const written = await fs.readFile(path.join(workspacePath, doc.canonicalPath), "utf8");
      assert.equal(written, drafts[doc.type]);
    }
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("adaptive_rule_label labels the latest matching adaptive rule event", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    const evaluation = evaluateAdaptiveRules({
      signals: { buildWithoutCustomerEvidenceDays: 2 },
      now: new Date("2026-06-22T00:00:00.000Z"),
    });
    await recordFiredAdaptiveRules({
      workspaceRoot: harness.workspacePath,
      fired: evaluation.fired,
      now: new Date("2026-06-22T00:00:00.000Z"),
    });

    ws = await connectAndCollect(harness);
    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "adaptive_rule_label",
      workspaceRoot: harness.workspacePath,
      ruleId: "AR-01",
      label: "false_positive",
    }));

    const labeled = await waitForEvent(ws.events, (event) =>
      event.type === "adaptive_rule_label_result"
        && event.workspaceRoot === harness.workspacePath,
    );
    assert.equal(labeled.success, true);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("submit_revenue_evidence validates required kind and content explicitly", async () => {
  const harness = await spawnSidecar();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "submit_revenue_evidence",
      workspaceRoot: harness.workspacePath,
      kind: "payment_record",
      content: "",
    }));

    const missingContent = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && /submit_revenue_evidence requires content/.test(event.message || ""),
    );
    assert.match(missingContent.message, /requires content/);

    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "submit_revenue_evidence",
      workspaceRoot: harness.workspacePath,
      kind: "unknown",
      content: "https://example.com/payment",
    }));

    const badKind = await waitForEvent(ws.events, (event) =>
      event.type === "error"
        && /submit_revenue_evidence requires kind/.test(event.message || ""),
    );
    assert.match(badKind.message, /payment_record/);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("submit_revenue_evidence records accepted revenue evidence and dedupes repeated locator", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_ACTION_EVIDENCE_JUDGE_STATUS: "accepted",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "submit_revenue_evidence",
      workspaceRoot: harness.workspacePath,
      day: 12,
      kind: "payment_record",
      content: "https://example.com/payments/receipt-123",
      amount: 120,
      note: "Stripe receipt from ACME",
    }));

    const accepted = await waitForEvent(ws.events, (event) =>
      event.type === "submit_revenue_evidence_result"
        && event.workspaceRoot === harness.workspacePath,
    );
    assert.equal(accepted.success, true);
    assert.equal(accepted.status, "accepted");
    assert.match(accepted.message, /수익 증거/);

    let ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].type, "payment_record");
    assert.equal(ledger.events[0].status, "accepted");
    assert.equal(ledger.events[0].strength, "strong");
    assert.equal(ledger.events[0].sourceUrl, "https://example.com/payments/receipt-123");
    assert.equal(ledger.events[0].metadata.kind, "payment_record");

    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "submit_revenue_evidence",
      workspaceRoot: harness.workspacePath,
      day: 12,
      kind: "payment_record",
      content: "https://example.com/payments/receipt-123",
      amount: 120,
    }));

    const duplicate = await waitForEvent(ws.events, (event) =>
      event.type === "submit_revenue_evidence_result"
        && event.workspaceRoot === harness.workspacePath,
    );
    assert.equal(duplicate.success, true);
    assert.equal(duplicate.status, "already_recorded");
    assert.match(duplicate.message, /중복 저장은 건너뛰었어/);

    ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.length, 1);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("submit_revenue_evidence records insufficient revenue evidence and dedupes weak proof", async () => {
  const harness = await spawnSidecar({
    extraEnv: {
      AGENTIC30_TEST_STUB_ACTION_EVIDENCE_JUDGE_STATUS: "insufficient",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.events.length = 0;

    ws.send(JSON.stringify({
      type: "submit_revenue_evidence",
      workspaceRoot: harness.workspacePath,
      day: 14,
      kind: "refusal",
      content: "/tmp/refusal-note.txt",
      note: "Customer declined without timestamp",
    }));

    const insufficient = await waitForEvent(ws.events, (event) =>
      event.type === "submit_revenue_evidence_result"
        && event.workspaceRoot === harness.workspacePath,
    );
    assert.equal(insufficient.success, false);
    assert.equal(insufficient.status, "insufficient");
    assert.match(insufficient.message, /다시 제출/);

    let ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.length, 1);
    assert.equal(ledger.events[0].type, "payment_failure");
    assert.equal(ledger.events[0].status, "insufficient");
    assert.equal(ledger.events[0].strength, "weak");
    assert.equal(ledger.events[0].artifactPath, "/tmp/refusal-note.txt");
    assert.equal(ledger.events[0].metadata.kind, "refusal");

    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "submit_revenue_evidence",
      workspaceRoot: harness.workspacePath,
      day: 14,
      kind: "refusal",
      content: "/tmp/refusal-note.txt",
    }));

    const duplicate = await waitForEvent(ws.events, (event) =>
      event.type === "submit_revenue_evidence_result"
        && event.workspaceRoot === harness.workspacePath,
    );
    assert.equal(duplicate.success, false);
    assert.equal(duplicate.status, "already_recorded");

    ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.length, 1);
  } finally {
    ws?.close();
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

async function emitAndFindV2Card(ws, workspacePath, cardType) {
  ws.events.length = 0;
  ws.send(JSON.stringify({
    type: "day_progress_patch",
    workspaceRoot: workspacePath,
    day: 3,
    stepId: "execution",
    status: "active",
  }));
  const event = await waitForEvent(ws.events, (candidate) =>
    candidate.type === "mission_card"
      && candidate.workspaceRoot === workspacePath
      && candidate.missionCard?.type === cardType,
  );
  return event.missionCard;
}

async function waitForV2DailyCardTypes(ws, expectedTypes) {
  await waitForEvent(ws.events, (event) =>
    event.type === "mission_card"
      && event.missionCard?.type === expectedTypes.at(-1),
  );
  const actualTypes = ws.events
    .filter((event) => event.type === "mission_card" && event.missionCard?.type)
    .map((event) => event.missionCard.type);
  assert.deepEqual(actualTypes.slice(0, expectedTypes.length), expectedTypes);
}

async function seedRepeatedOpenCommitments(workspacePath, { day = 3 } = {}) {
  const baseCommitment = {
    customer: "Candidate A",
    channel: "email",
    message: "Ask for a paid pilot by Friday",
    expectedEvidenceKind: "url",
    dueDay: day + 1,
    confirmedByUser: true,
    candidateName: "Candidate A",
    actionKind: "paid_ask",
    actionText: "Ask for a paid pilot by Friday",
  };
  await appendCommitment({
    workspaceRoot: workspacePath,
    text: "Candidate A에게 paid pilot 요청",
    cycle: day - 1,
    day: day - 1,
    originText: "Candidate A에게 paid pilot 요청",
    commitment: baseCommitment,
    now: new Date("2026-06-15T00:00:00.000Z"),
  });
  await appendCommitment({
    workspaceRoot: workspacePath,
    text: "Candidate A에게 paid pilot 요청",
    cycle: day,
    day,
    originText: "Candidate A에게 paid pilot 요청",
    commitment: baseCommitment,
    now: new Date("2026-06-16T00:00:00.000Z"),
  });
  const memory = await loadOfficeHoursMemory({ workspaceRoot: workspacePath });
  return {
    activeCommitmentId: memory.commitments.at(-1)?.id ?? "",
  };
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

async function seedDay1DoneProgress(workspacePath, { challengeStartedAt = localDateString(new Date()) } = {}) {
  const agentic30Dir = path.join(workspacePath, ".agentic30");
  await fs.mkdir(agentic30Dir, { recursive: true });
  await fs.writeFile(
    path.join(agentic30Dir, "day-progress.json"),
    JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.day_progress.v1",
      challengeStartedAt,
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

async function seedStandardInterviewActiveProgress(
  workspacePath,
  day = 3,
  { challengeStartedAt = localDateString(new Date()) } = {},
) {
  const dayNumber = Number.parseInt(String(day || ""), 10);
  const agentic30Dir = path.join(workspacePath, ".agentic30");
  await fs.mkdir(agentic30Dir, { recursive: true });
  await fs.writeFile(
    path.join(agentic30Dir, "day-progress.json"),
    JSON.stringify({
      schemaVersion: 1,
      schema: "agentic30.day_progress.v1",
      challengeStartedAt,
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
  const items = [
    {
      questionId: "get_users_active_user_definition",
      header: "활성 사용자 기준",
      question: "이 목표에서 활성 사용자 1명으로 세려면 고객 후보가 어떤 핵심 행동을 끝내야 하나요?",
      answer: "첫 가치 완료",
      option: {
        mapsTo: "GOAL.activation_action",
        evidenceTarget: "첫 가치 완료 이벤트, 실행 기록, 검증 행동, 다음 과제",
        failureMode: "가입이나 관심 표현만 있으면 활성 사용자로 세지 않는다.",
        nextIntent: "first_value_completed",
      },
    },
    {
      questionId: "known_dev_first_segment",
      header: "고객 후보",
      question: "첫 10명 중 가장 절실한 고객 후보는 누구인가요?",
      answer: "Threads @solo_maker 박지원, AI로 많이 만들었지만 팔지 못한 1인 개발자",
      option: {
        mapsTo: "ICP.desperate_segment",
        evidenceTarget: "최근 30일 안에 만든 제품과 판매 실패 기록",
      },
    },
    {
      questionId: "first_channel",
      header: "첫 접점",
      question: "이번 주 직접 만날 수 있는 첫 고객 접점은 어디인가요?",
      answer: "이미 아는 1인 개발자",
      option: {
        mapsTo: "ICP.first_reach_channel",
        evidenceTarget: "실명 후보 3명과 DM 발송 기록",
      },
    },
    {
      questionId: "current_alternative",
      header: "현재 대안",
      question: "지금 이 문제를 어떤 현재 대안으로 버티고 있나요?",
      answer: "혼자 더 만들기",
      freeText: "최근 2주 동안 기능 개발은 12시간, 고객 대화는 0명이다.",
      option: {
        mapsTo: "PROBLEM.status_quo",
        evidenceTarget: "최근 2주 기능 개발 12시간, 고객 대화 0명",
        failureMode: "고객 접촉 없이 기능만 늘리면 수요 공백이 남는다.",
      },
    },
    {
      questionId: "activation_action",
      header: "검증 행동",
      question: "이번 주 반드시 끝내야 하는 검증 행동은 무엇인가요?",
      answer: "오늘 18시까지 실명 고객 3명에게 결제 요청 DM 발송",
      option: {
        mapsTo: "GOAL.activation_action",
        evidenceTarget: "실명 고객 3명 연락 완료와 답변 기록",
        failureMode: "오늘 3명에게 보내지 못하면 이번 cycle은 실패다.",
      },
    },
    {
      questionId: "smallest_paid_entry",
      header: "작은 유료 진입점",
      question: "가장 작은 유료 진입점은 무엇인가요?",
      answer: "3만원 1회 검증 세션 결제 제안, .agentic30/evidence/day1-dm.png에 오늘 20시까지 캡처 저장",
      freeText: "박지원 리드가 2026-06-14에 3만원 1회 검증 세션 결제를 진행하기로 했다.",
      option: {
        mapsTo: "SPEC.smallest_paid_entry",
        evidenceTarget: "3만원 유료 세션 제안, 일정 확정 또는 결제 의향",
        failureMode: "가격이나 일정이 없으면 관심 신호로 낮춘다.",
        nextIntent: "actual_payment_or_contract",
      },
    },
  ];
  const item = items[Math.max(0, Math.min(index - 1, items.length - 1))];
  const question = item.question;
  const answer = item.answer;
  return {
    day: 1,
    sessionId: "prior-completed-session",
    requestId,
    mode: "office_hours_tool",
    signalId: item.questionId,
    signalLabel: item.header,
    questionText: question,
    responseText: answer,
    responseDescription: `${answer} 선택`,
    promptSnapshot: {
      requestId,
      sessionId: "prior-completed-session",
      toolName: "agentic30_request_user_input",
      title: "Office Hours",
      createdAt: `2026-06-13T03:0${Math.min(index, 9)}:00.000Z`,
      questions: [
        {
          questionId: item.questionId,
          header: item.header,
          question,
          options: [
            {
              label: answer,
              description: `${answer} 선택`,
              ...item.option,
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
        signalId: item.questionId,
        signalLabel: item.header,
      },
    },
    submissions: [
      {
        question,
        selectedOptions: [answer],
        freeText: item.freeText || "",
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

async function waitForEvents(events, predicate, expectedCount, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = events.filter(predicate);
    if (found.length >= expectedCount) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  const summary = events.map((event) => {
    if (event.type === "error") return `error:${event.message || ""}`;
    if (event.type === "office_hours_daily_card_submit_result") return `office_hours_daily_card_submit_result:${event.deduped ? "deduped" : "new"}`;
    return event.type || JSON.stringify(event);
  });
  throw new Error(`Timed out waiting for ${expectedCount} events. Saw: ${summary.join(", ")}`);
}

async function waitForEventSettle(ms = 250) {
  await new Promise((resolve) => setTimeout(resolve, ms));
}

function assertNoGenericErrorEnvelope(events, sessionId) {
  const genericErrors = events.filter((event) =>
    event.type === "error"
      && event.sessionId === sessionId
      && (event.recoverable !== true || !event.errorKind)
  );

  assert.deepEqual(
    genericErrors.map((event) => ({
      message: event.message,
      errorKind: event.errorKind,
      recoverable: event.recoverable,
    })),
    [],
    "recoverable sidecar failures must not also emit generic error envelopes",
  );
}

// Regression (dongdong Day-1): a locked-Day1 retry whose REGENERATED context
// dropped the "Expected question count" line must still wrap up a complete
// interview from the durable runtime stamp instead of re-running the provider
// on an exhausted interview and hard-failing with "Day 1 인터뷰 질문을 만들지
// 못했습니다". Before the fix the resume block parsed the count from the context
// alone (-> 0), officeHoursResumeWrapUp went FALSE, and the no-next-question
// provider tripped the locked-Day1 hard-fail. The stamp set on the prior run is
// the durable authority and survives the regeneration.
test("office_hours_start retry wraps up a complete locked Day 1 interview when the regenerated context dropped the question count", async () => {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-oh-retry-count-drop-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  const sessionId = "locked-day1-retry-count-drop-session";
  let harness;
  let ws;
  try {
    await fs.mkdir(workspacePath, { recursive: true });
    await fs.mkdir(appSupportPath, { recursive: true });
    await initGitRepo(workspacePath);
    await seedDay1ActiveProgress(workspacePath);
    for (let index = 1; index <= 6; index += 1) {
      await appendOfficeHoursTurn({
        workspaceRoot: workspacePath,
        turn: makeCompletedOfficeHoursTurn(index),
      });
    }

    // Force the provider to yield no question card so a wrap-up MISS reaches the
    // locked-Day1 hard-fail instead of silently producing a stub card.
    const loaderPath = path.join(tempRoot, "office-hours-no-next-question-loader.mjs");
    const registerPath = path.join(tempRoot, "register-office-hours-loader.mjs");
    await fs.writeFile(
      loaderPath,
      `
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (
    process.env.AGENTIC30_TEST_STUB_OFFICE_HOURS_NO_NEXT_QUESTION === "1"
    && url.endsWith("/sidecar/provider-runner.mjs")
  ) {
    const source = typeof result.source === "string"
      ? result.source
      : new TextDecoder().decode(result.source);
    return {
      ...result,
      source: source.replace(
        "if (/Agentic30 Day 1 STEP Office Hours|Office Hours를 시작한다/i.test(value)) {",
        "if (false && /Agentic30 Day 1 STEP Office Hours|Office Hours를 시작한다/i.test(value)) {",
      ),
    };
  }
  return result;
}
`,
      "utf8",
    );
    await fs.writeFile(
      registerPath,
      `import { register } from "node:module";\nregister(${JSON.stringify(pathToFileURL(loaderPath).href)}, import.meta.url);\n`,
      "utf8",
    );

    // Restore a session whose runtime still carries the durable expectedQuestionCount
    // stamp from the prior run — the value that survives a same-daemon retry.
    await fs.writeFile(
      path.join(appSupportPath, "sessions.json"),
      JSON.stringify({
        sessions: [
          {
            id: sessionId,
            title: "Office Hours · Day 1",
            provider: "codex",
            model: "gpt-5.1-codex-mini",
            status: "idle",
            error: null,
            createdAt: "2026-06-25T00:41:50.000Z",
            updatedAt: "2026-06-25T00:49:31.000Z",
            messages: [],
            pendingUserInput: null,
            runtime: {
              officeHours: {
                active: true,
                source: "day1_interview_goal_locked",
                day: 1,
                startedAt: "2026-06-25T00:41:50.000Z",
                expectedQuestionCount: 6,
                context: [
                  "DAY1_LOCKED_GOAL",
                  "Goal lane: get_users / 활성 사용자 100명 모으기",
                  "Expected question count: 6",
                ].join("\n"),
              },
            },
          },
        ],
      }, null, 2),
      "utf8",
    );

    harness = await spawnSidecar({
      tempRoot,
      workspacePath,
      appSupportPath,
      cleanupOnClose: false,
      extraEnv: {
        AGENTIC30_RESTORE_SESSIONS_ON_BOOT: "1",
        AGENTIC30_TEST_STUB_OFFICE_HOURS_NO_NEXT_QUESTION: "1",
        NODE_OPTIONS: `${process.env.NODE_OPTIONS ? `${process.env.NODE_OPTIONS} ` : ""}--import=${pathToFileURL(registerPath).href}`,
      },
    });
    ws = await connectAndCollect(harness);

    const marker = ws.events.length;
    ws.send(JSON.stringify({
      type: "office_hours_start",
      sessionId,
      // The dongdong failure trigger: the retry context was regenerated WITHOUT
      // the "Expected question count" line that the first run carried.
      context: [
        "DAY1_LOCKED_GOAL",
        "Flow contract: locked Day 1 goal interview.",
        "Goal lane: get_users / 활성 사용자 100명 모으기",
        "Goal text: 30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다.",
        "Customer: 고객 지원/CS 담당자",
      ].join("\n"),
      visiblePrompt: "Retry locked Day 1 interview",
      source: "day1_interview_goal_locked_retry",
      day: 1,
    }));

    const completedStatus = await waitForEvent(ws.events, (event) =>
      ws.events.indexOf(event) >= marker
        && event.type === "office_hours_status"
        && event.sessionId === sessionId
        && event.stage === "completed"
    );
    assert.equal(completedStatus.stage, "completed");

    await waitForEventSettle();
    const after = ws.events.slice(marker);
    assert.equal(
      after.some((event) =>
        event.type === "office_hours_status"
          && event.sessionId === sessionId
          && event.stage === "failed"
      ),
      false,
      "wrap-up must not also emit a failed office-hours status",
    );
    assert.equal(
      after.some((event) => event.type === "error" && event.sessionId === sessionId),
      false,
      "a complete locked Day 1 retry must not hard-fail with a no-next-question error",
    );
    const settled = [...after].reverse().find((event) =>
      event.type === "session_updated" && event.session?.id === sessionId
    );
    assert.equal(settled.session.status, "idle");
    assert.equal(settled.session.error, null);
    assert.equal(settled.session.pendingUserInput, null);
  } finally {
    ws?.close();
    await harness?.close({ cleanup: false });
    await fs.rm(tempRoot, { recursive: true, force: true });
  }
});

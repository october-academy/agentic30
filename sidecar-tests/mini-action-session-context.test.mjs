import test from "node:test";
import assert from "node:assert/strict";

import {
  MINI_ACTION_TEMPLATE_IDS,
  MINI_ACTION_COMPLETION_SIGNAL_SCHEMA_VERSION,
  MINI_ACTION_ORIGINAL_QUESTION_RESOLUTION_SCHEMA_VERSION,
  MINI_ACTION_REALTIME_REFRAME_SCHEMA_VERSION,
  MINI_ACTION_REALTIME_REFRAME_TYPE,
  MINI_ACTION_RESPONSE_REFERENCE_SCHEMA_VERSION,
  MINI_ACTION_ANSWERABILITY_VALIDATION_SCHEMA_VERSION,
  MINI_ACTION_COMPLETION_SIGNAL_TYPE,
  MINI_ACTION_COMPLETION_DRIVER,
  MINI_ACTION_EXECUTION_ONLY_MODE,
  MINI_ACTION_NON_INTERACTIVE_MODE,
  MINI_ACTION_SESSION_COMPLETION_STATUS,
  MINI_ACTION_SESSION_PAYLOAD_SCHEMA_VERSION,
  MINI_ACTION_SESSION_CONTEXT_SCHEMA_VERSION,
  applyExecutionOnlyModeToMiniActionSessionPayload,
  buildMiniActionCompletionSignal,
  buildMiniActionNonInteractiveClassification,
  buildRealTimeReframeFromMiniActionCompletionSignal,
  composeFinalMiniActionSessionPayload,
  deriveMiniActionSessionDayContextPayload,
  detectMiniActionCompletionEvent,
  extractMiniActionResponseDataReferences,
  resolveActiveOriginalQuestionAfterMiniAction,
  resolveMiniActionSessionCompletionState,
  rewriteMiniActionResponseDataReferences,
  selectMiniActionTemplate,
  validateMiniActionReframedQuestionAnswerability,
  validateMiniActionReframedQuestionIntent,
} from "../sidecar/mini-action-session-context.mjs";

test("extractMiniActionResponseDataReferences identifies original-question terms that need response data", () => {
  const references = extractMiniActionResponseDataReferences({
    originalQuestion: "누구에게 지금 보내면 실제 반응을 배울 수 있나요? Which replies or no-reply outcomes matter?",
    intent: "Use outreach response data to pick the smallest reachable prospect set.",
  });

  assert.ok(references.length >= 3);
  assert.equal(references[0].schemaVersion, MINI_ACTION_RESPONSE_REFERENCE_SCHEMA_VERSION);
  assert.equal(references[0].schema, "agentic30.curriculum.mini_action_response_reference.v1");
  assert.equal(references.every((reference) => reference.requires_response_data), true);
  assert.equal(references.every((reference) => reference.response_data_required), true);
  assert.equal(references.every((reference) => reference.fallback_data_source === "mini_action_execution_evidence"), true);
  assert.ok(references.some((reference) => reference.text === "반응"));
  assert.ok(references.some((reference) => reference.text.toLowerCase() === "replies"));
  assert.ok(references.some((reference) => reference.text.toLowerCase() === "no-reply"));
});

test("rewriteMiniActionResponseDataReferences resolves response terms with known mini-action metadata", () => {
  const references = extractMiniActionResponseDataReferences({
    originalQuestion: "Which replies or no-reply outcomes matter?",
    intent: "Pick the smallest reachable prospect set.",
  });
  const rewritten = rewriteMiniActionResponseDataReferences({
    references,
    actionSpec: {
      id: "day-20-outreach",
      action_type: "outreach_tracker",
      description: "Send 10 personalized DMs and log each sent row.",
      completion_signal: "Google Sheet contains at least 10 rows with sent status.",
      verification_methods: ["google_sheets"],
    },
    verificationResult: {
      method: "google_sheets",
      passed: true,
      outcome: "verified",
    },
  });

  assert.equal(rewritten.length, references.length);
  assert.equal(rewritten.every((reference) => reference.original_requires_response_data), true);
  assert.equal(rewritten.every((reference) => reference.requires_response_data === false), true);
  assert.equal(rewritten.every((reference) => reference.response_data_required === false), true);
  assert.equal(rewritten.every((reference) => reference.resolved_by === "known_mini_action_context"), true);
  assert.equal(rewritten.every((reference) => reference.known_context_source === "mini_action_metadata"), true);
  assert.ok(rewritten.every((reference) => /Google Sheet contains at least 10 rows/.test(reference.rewritten_text)));
});

test("deriveMiniActionSessionDayContextPayload builds auto-first Google Sheets context for outreach Day", () => {
  const payload = deriveMiniActionSessionDayContextPayload({
    curriculumDay: {
      day: 20,
      dayType: "action",
      curriculumWeek: 3,
      goal: "warm outreach를 보낸다",
      key_questions_with_intent: [
        {
          question: "누구에게 지금 보내면 실제 반응을 배울 수 있나요?",
          intent: "Pick the smallest reachable prospect set.",
        },
      ],
      action_spec: {
        id: "day-20-outreach",
        action_type: "outreach_tracker",
        description: "Send 10 personalized DMs and log each response.",
        template: "target | message | sent_at | status | reply",
        completion_signal: "Google Sheet contains at least 10 rows with sent status.",
        verification_method: "google_sheets",
        dependency_refs: ["day_18_launch_story"],
      },
    },
    progressState: {
      weeklySummaryStack: [
        { weekNumber: 1, status: "finalized", summaryText: "Week 1 foundation" },
        { weekNumber: 2, status: "finalized", summaryText: "Week 2 build" },
      ],
      currentWeekRawAnswers: [
        { day: 20, questionId: "prospects", answer: "Ten warm users from the beta list." },
      ],
    },
    configuredMcpServers: {
      agentic30_sidecar: { enabled: true },
    },
    generatedAt: new Date("2026-05-20T12:00:00.000Z"),
  });

  assert.equal(payload.schemaVersion, MINI_ACTION_SESSION_CONTEXT_SCHEMA_VERSION);
  assert.equal(payload.schema, "agentic30.curriculum.mini_action_session_context.v1");
  assert.equal(payload.day_id, 20);
  assert.equal(payload.day_type, "action");
  assert.equal(payload.curriculum_week, 3);
  assert.equal(payload.progression_blocked, false);
  assert.equal(payload.coaching_mode, "non_blocking_mini_action");
  assert.equal(payload.execution_mode, MINI_ACTION_EXECUTION_ONLY_MODE);
  assert.equal(payload.execution_only, true);
  assert.equal(payload.interactive, false);
  assert.equal(payload.non_interactive, true);
  assert.equal(payload.interaction_mode, MINI_ACTION_NON_INTERACTIVE_MODE);
  assert.equal(payload.requires_user_input_checkpoint, false);
  assert.equal(payload.required_user_input_checkpoint, false);
  assert.equal(payload.user_input_checkpoint_required, false);
  assert.equal(payload.checkpoint_policy.required_user_input_checkpoint, false);
  assert.equal(payload.capabilities.planning, false);
  assert.equal(payload.capabilities.interview, false);
  assert.equal(payload.capabilities.review, false);
  assert.equal(payload.action_spec.action_type, "outreach_tracker");
  assert.equal(payload.action_spec.completion_signal, "Google Sheet contains at least 10 rows with sent status.");
  assert.equal(payload.action_spec.action_template.template_id, MINI_ACTION_TEMPLATE_IDS.customAuthored);
  assert.equal(payload.action_spec.action_template.source, "action_metadata.template");
  assert.deepEqual(payload.dependency_refs, ["day_18_launch_story"]);
  assert.deepEqual(payload.verification.preferred_methods, ["google_sheets"]);
  assert.equal(payload.verification.resolved[0].tool, "gws_sheets_read");
  assert.equal(payload.verification.fallback_evidence_input.evidenceType, "link");
  assert.deepEqual(
    payload.provider_context_payload.selected_weekly_summaries.map((summary) => summary.week_number),
    [1, 2],
  );
  assert.deepEqual(
    payload.provider_context_payload.current_week_raw_answers.map((answer) => answer.question_id),
    ["prospects"],
  );
  assert.match(payload.user_facing_nudge, /해보세요/);
});

test("selectMiniActionTemplate chooses metadata-specific template for auto-verifiable action", () => {
  const selected = selectMiniActionTemplate({
    dayType: "action",
    actionMetadata: {
      action_type: "outreach_tracker",
      description: "Send 10 warm DMs and track replies.",
      verification_method: "google_sheets",
      completion_signal: "Google Sheet has 10 sent rows.",
    },
    learnerState: {
      adaptiveDifficultyState: {
        direction: "steady",
      },
    },
  });

  assert.equal(selected.template_id, MINI_ACTION_TEMPLATE_IDS.googleSheet);
  assert.equal(selected.source, "action_metadata.google_sheets");
  assert.equal(selected.learner_adjustment, "none");
  assert.match(selected.template, /dated rows/);
  assert.deepEqual(selected.verification_methods, ["google_sheets"]);
  assert.equal(selected.completion_signal, "Google Sheet has 10 sent rows.");
});

test("selectMiniActionTemplate lowers difficulty for accumulated incomplete actions", () => {
  const selected = selectMiniActionTemplate({
    dayType: "education",
    actionMetadata: {
      action_type: "checklist",
      verification_method: "cli",
      expected_evidence_types: ["file"],
    },
    learnerState: {
      carry_over_queue: [
        { source_day: 12, action_description: "dogfood log" },
        { source_day: 15, action_description: "revenue dry run" },
      ],
    },
  });

  assert.equal(selected.template_id, MINI_ACTION_TEMPLATE_IDS.guidedRecovery);
  assert.equal(selected.source, "learner_state.incomplete_accumulation");
  assert.equal(selected.difficulty_direction, "down");
  assert.equal(selected.learner_adjustment, "decrease_to_guided_recovery");
  assert.match(selected.template, /^Recover the smallest incomplete action in 10 minutes:/);
});

test("deriveMiniActionSessionDayContextPayload raises template requirements when learner is rushing", () => {
  const payload = deriveMiniActionSessionDayContextPayload({
    curriculumDay: {
      day: 23,
      dayType: "action",
      goal: "paid learning 실험을 설계한다",
      action_spec: {
        action_type: "paid_learning_plan",
        description: "Create a small paid learning plan.",
        completion_signal: "Plan includes budget, stop rule, hooks, and target.",
        verification_method: "google_docs",
      },
    },
    learnerState: {
      adaptive_difficulty_state: {
        direction: "up",
        trigger: "rushing",
      },
      pace_metrics: {
        days_elapsed: 1,
      },
      completed_day_count: 4,
    },
    generatedAt: new Date("2026-05-23T12:00:00.000Z"),
  });

  assert.equal(payload.action_spec.action_template.template_id, MINI_ACTION_TEMPLATE_IDS.prerequisiteEvidence);
  assert.equal(payload.action_spec.action_template.source, "learner_state.rushing");
  assert.equal(payload.action_spec.action_template.difficulty_direction, "up");
  assert.equal(payload.action_spec.action_template.learner_adjustment, "increase_prerequisite_evidence_required");
  assert.match(payload.action_spec.template, /^Before moving ahead, verify one prerequisite action first:/);
  assert.deepEqual(payload.action_spec.verification_methods, ["google_docs"]);
});

test("deriveMiniActionSessionDayContextPayload infers Browser verification and link fallback for public proof Day", () => {
  const payload = deriveMiniActionSessionDayContextPayload({
    curriculumDay: {
      day: 19,
      day_type: "action",
      title: "첫 공개 proof를 만든다",
      tasks: [
        "핵심 결과 스크린샷/요약 선택",
        "실행 결과 1개 쓰기",
        "Threads/BIP 게시",
      ],
      output: "public proof post URL",
      dependency_refs: ["day_18_launch_story"],
    },
    trigger: {
      reason: "user_reports_action_not_done",
      confidence: 0.93,
      normalizedText: "i have not posted it yet",
    },
    generatedAt: new Date("2026-05-19T09:00:00.000Z"),
  });

  assert.equal(payload.day_id, 19);
  assert.equal(payload.day_goal, "첫 공개 proof를 만든다");
  assert.equal(payload.trigger.reason, "user_reports_action_not_done");
  assert.equal(payload.trigger.actionSufficiency, "insufficient");
  assert.equal(payload.action_spec.action_type, "public_post");
  assert.deepEqual(payload.action_spec.verification_methods, ["browser"]);
  assert.deepEqual(payload.verification.preferred_methods, ["browser"]);
  assert.equal(payload.verification.fallback_evidence_input.evidenceType, "link");
  assert.equal(payload.key_questions_with_intent[0].question, "핵심 결과 스크린샷/요약 선택");
  assert.deepEqual(payload.dependency_refs, ["day_18_launch_story"]);
});

test("deriveMiniActionSessionDayContextPayload handles Education Day mini-action fallback without blocking progression", () => {
  const payload = deriveMiniActionSessionDayContextPayload({
    daySpec: {
      day_id: 16,
      day_type: "education",
      day_goal: "출시 체크리스트를 닫는다",
      keyQuestionsWithIntent: [
        {
          id: "release-risk",
          question: "어떤 출시 리스크가 오늘 가장 비싸게 막고 있나요?",
          intent: "Focus the worksheet on the highest-risk release dependency.",
        },
      ],
      actionWithSignal: {
        action_type: "checklist",
        action: "Write the release readiness checklist and mark one owner.",
        completion_signal: "A local checklist file exists with account, tax, and first tester install notes.",
        verification_method: "cli",
      },
    },
    configuredCliCommands: {
      cli: {
        command: "test",
        args: ["-f", "release-readiness-checklist.md"],
      },
    },
    generatedAt: new Date("2026-05-16T21:00:00.000Z"),
  });

  assert.equal(payload.day_id, 16);
  assert.equal(payload.day_type, "education");
  assert.equal(payload.progression_blocked, false);
  assert.equal(payload.action_spec.action_type, "checklist");
  assert.deepEqual(payload.action_spec.verification_methods, ["cli"]);
  assert.equal(payload.verification.preferred_methods[0], "cli");
  assert.equal(payload.verification.resolved[0].command, "test");
  assert.equal(payload.verification.fallback_evidence_input.evidenceType, "file");
  assert.equal(payload.key_questions_with_intent[0].id, "release-risk");
  assert.equal(payload.provider_context_payload.day_id, 16);
});

test("applyExecutionOnlyModeToMiniActionSessionPayload disables planning, interview, and review capabilities", () => {
  const payload = applyExecutionOnlyModeToMiniActionSessionPayload({
    schema: "agentic30.curriculum.mini_action_session_context.v1",
    day_id: 20,
    capabilities: {
      planning: true,
      interview: true,
      review: true,
      customReadContext: true,
    },
    provider_context_payload: {
      day_id: 20,
      execution_mode: "agentic",
      capabilities: {
        planning: true,
        interview: true,
        review: true,
        customReadContext: true,
      },
    },
  });

  assert.equal(payload.execution_mode, MINI_ACTION_EXECUTION_ONLY_MODE);
  assert.equal(payload.executionOnly, true);
  assert.equal(payload.interactive, false);
  assert.equal(payload.nonInteractive, true);
  assert.equal(payload.requiresUserInput, false);
  assert.equal(payload.requiredUserInputCheckpoint, false);
  assert.equal(payload.userInputCheckpointRequired, false);
  assert.equal(payload.capability_policy.planning_enabled, false);
  assert.equal(payload.capability_policy.interview_enabled, false);
  assert.equal(payload.capability_policy.review_enabled, false);
  assert.deepEqual(payload.disabled_capabilities, ["planning", "interview", "review"]);
  assert.equal(payload.capabilities.executeAction, true);
  assert.equal(payload.capabilities.autoVerifyAction, true);
  assert.equal(payload.capabilities.requestEvidenceFallback, true);
  assert.equal(payload.capabilities.carryOverCoaching, true);
  assert.equal(payload.capabilities.customReadContext, true);
  assert.equal(payload.capabilities.planning, false);
  assert.equal(payload.capabilities.interview, false);
  assert.equal(payload.capabilities.review, false);
  assert.equal(payload.provider_context_payload.execution_mode, MINI_ACTION_EXECUTION_ONLY_MODE);
  assert.equal(payload.provider_context_payload.interactive, false);
  assert.equal(payload.provider_context_payload.non_interactive, true);
  assert.equal(payload.provider_context_payload.required_user_input_checkpoint, false);
  assert.equal(payload.provider_context_payload.capabilities.planning, false);
  assert.equal(payload.provider_context_payload.capabilities.interview, false);
  assert.equal(payload.provider_context_payload.capabilities.review, false);
  assert.deepEqual(payload.provider_context_payload.disabled_capabilities, [
    "planning",
    "interview",
    "review",
  ]);
});

test("buildMiniActionNonInteractiveClassification marks execution-only sessions as not requiring input checkpoints", () => {
  const classification = buildMiniActionNonInteractiveClassification();

  assert.equal(classification.interactive, false);
  assert.equal(classification.nonInteractive, true);
  assert.equal(classification.non_interactive, true);
  assert.equal(classification.interactionMode, MINI_ACTION_NON_INTERACTIVE_MODE);
  assert.equal(classification.currentStep, "execution");
  assert.equal(classification.startStep, "execution");
  assert.equal(classification.autoProceedToExecution, true);
  assert.equal(classification.emitUserResponsePrompt, false);
  assert.equal(classification.awaitUserResponsePrompt, false);
  assert.equal(classification.requiresUserInput, false);
  assert.equal(classification.requires_user_input, false);
  assert.equal(classification.requiresUserInputCheckpoint, false);
  assert.equal(classification.requires_user_input_checkpoint, false);
  assert.equal(classification.requiredUserInputCheckpoint, false);
  assert.equal(classification.required_user_input_checkpoint, false);
  assert.equal(classification.userInputCheckpointRequired, false);
  assert.equal(classification.user_input_checkpoint_required, false);
  assert.equal(classification.checkpoint_policy.required_user_input_checkpoint, false);
});

test("composeFinalMiniActionSessionPayload combines Day context with execution-only settings", () => {
  const payload = composeFinalMiniActionSessionPayload({
    sessionId: "mini-action-session-day-22",
    curriculumDay: {
      day: 22,
      dayType: "action",
      curriculumWeek: 4,
      goal: "60초 demo를 만든다",
      keyQuestionsWithIntent: [
        {
          id: "demo-scope",
          question: "어떤 한 입력에서 결과까지 보여줄까요?",
          intent: "Force the demo into one visible happy path.",
        },
      ],
      actionSpec: {
        id: "day-22-demo",
        actionType: "demo_asset",
        description: "Record one 60-second demo from input to result.",
        template: "input -> result -> caption -> CTA",
        completionSignal: "A local .mp4 or .mov demo file exists with a caption.",
        verificationMethod: "cli",
        expectedEvidenceTypes: ["file"],
        dependencyRefs: ["day_18_launch_story", "day_19_public_proof"],
      },
    },
    progressState: {
      weeklySummaryStack: [
        { weekNumber: 1, status: "finalized", summaryText: "Foundation summary" },
        { weekNumber: 2, status: "finalized", summaryText: "Build summary" },
        { weekNumber: 3, status: "finalized", summaryText: "Launch summary" },
      ],
      currentWeekRawAnswers: [
        { day: 22, questionId: "demo-scope", answer: "Show import, summary, and public proof copy." },
      ],
    },
    configuredCliCommands: {
      cli: {
        command: "test",
        args: ["-f", "demo.mp4"],
      },
    },
    executionSettings: {
      maxSessionMinutes: 12,
      capabilities: {
        inspectWorkspace: true,
        planning: true,
      },
    },
    generatedAt: new Date("2026-05-22T10:00:00.000Z"),
  });

  assert.equal(payload.schemaVersion, MINI_ACTION_SESSION_PAYLOAD_SCHEMA_VERSION);
  assert.equal(payload.schema, "agentic30.curriculum.mini_action_session_payload.v1");
  assert.equal(payload.generatedAt, "2026-05-22T10:00:00.000Z");
  assert.equal(payload.session_id, "mini-action-session-day-22");
  assert.equal(payload.component_type, "curriculum_mini_action_session");
  assert.equal(payload.day_id, 22);
  assert.equal(payload.day_type, "action");
  assert.equal(payload.curriculum_week, 4);
  assert.equal(payload.execution_mode, MINI_ACTION_EXECUTION_ONLY_MODE);
  assert.equal(payload.interactive, false);
  assert.equal(payload.non_interactive, true);
  assert.equal(payload.interaction_mode, MINI_ACTION_NON_INTERACTIVE_MODE);
  assert.equal(payload.current_step, "execution");
  assert.equal(payload.start_step, "execution");
  assert.equal(payload.auto_proceed_to_execution, true);
  assert.equal(payload.emit_user_response_prompt, false);
  assert.equal(payload.await_user_response_prompt, false);
  assert.equal(payload.required_user_input_checkpoint, false);
  assert.equal(payload.user_input_checkpoint_required, false);
  assert.equal(payload.progression_blocked, false);
  assert.equal(payload.coaching_mode, "non_blocking_mini_action");

  assert.equal(payload.execution_settings.mode, MINI_ACTION_EXECUTION_ONLY_MODE);
  assert.equal(payload.execution_settings.interactive, false);
  assert.equal(payload.execution_settings.non_interactive, true);
  assert.equal(payload.execution_settings.required_user_input_checkpoint, false);
  assert.equal(payload.execution_settings.auto_verify_first, true);
  assert.equal(payload.execution_settings.max_session_minutes, 12);
  assert.equal(payload.execution_settings.allow_manual_evidence_fallback, true);
  assert.equal(payload.execution_settings.capabilities.inspectWorkspace, true);
  assert.equal(payload.execution_settings.capabilities.executeAction, true);
  assert.equal(payload.execution_settings.capabilities.autoVerifyAction, true);
  assert.equal(payload.execution_settings.capabilities.planning, false);
  assert.deepEqual(payload.execution_settings.disabled_capabilities, ["planning", "interview", "review"]);

  assert.equal(payload.day_context.schema, "agentic30.curriculum.mini_action_session_context.v1");
  assert.equal(payload.day_context.action_spec.id, "day-22-demo");
  assert.equal(payload.day_context.action_spec.action_type, "demo_asset");
  assert.equal(payload.selected_action_template.template_id, MINI_ACTION_TEMPLATE_IDS.customAuthored);
  assert.equal(payload.selected_action_template.source, "action_metadata.template");
  assert.equal(payload.selected_action_template.template, "input -> result -> caption -> CTA");
  assert.equal(payload.action_template.template_id, MINI_ACTION_TEMPLATE_IDS.customAuthored);
  assert.deepEqual(payload.day_context.dependency_refs, ["day_18_launch_story", "day_19_public_proof"]);
  assert.deepEqual(
    payload.day_context.provider_context_payload.selected_weekly_summaries.map((summary) => summary.week_number),
    [1, 2, 3],
  );
  assert.deepEqual(
    payload.day_context.provider_context_payload.current_week_raw_answers.map((answer) => answer.question_id),
    ["demo-scope"],
  );

  assert.equal(payload.verification_request.auto_first, true);
  assert.deepEqual(payload.verification_request.preferred_methods, ["cli"]);
  assert.equal(payload.verification_request.resolved[0].command, "test");
  assert.deepEqual(payload.verification_request.resolved[0].args, ["-f", "demo.mp4"]);
  assert.equal(payload.evidence_fallback.enabled, true);
  assert.equal(payload.evidence_fallback.evidence_type, "file");
  assert.equal(payload.evidence_fallback.input_mode, "file_upload");
  assert.deepEqual(payload.evidence_fallback.allowed_types, ["file"]);
  assert.equal(payload.completion_policy.completion_driver, MINI_ACTION_COMPLETION_DRIVER.actionExecutionResult);
  assert.equal(payload.completion_policy.required_signal, "passed_action_execution_result");
  assert.equal(payload.completion_policy.ignore_user_message_receipt, true);
  assert.equal(payload.completion_policy.ignore_provider_run_completion, true);
  assert.equal(payload.provider_payload.completion_policy.required_signal, "passed_action_execution_result");

  assert.equal(payload.provider_payload.schema, "agentic30.curriculum.mini_action_session_provider_payload.v1");
  assert.equal(payload.provider_payload.execution_mode, MINI_ACTION_EXECUTION_ONLY_MODE);
  assert.equal(payload.provider_payload.interactive, false);
  assert.equal(payload.provider_payload.non_interactive, true);
  assert.equal(payload.provider_payload.current_step, "execution");
  assert.equal(payload.provider_payload.auto_proceed_to_execution, true);
  assert.equal(payload.provider_payload.emit_user_response_prompt, false);
  assert.equal(payload.provider_payload.await_user_response_prompt, false);
  assert.equal(payload.provider_payload.required_user_input_checkpoint, false);
  assert.equal(payload.provider_payload.selected_action_template.template_id, MINI_ACTION_TEMPLATE_IDS.customAuthored);
  assert.equal(payload.provider_payload.selected_action_template.template, "input -> result -> caption -> CTA");
  assert.equal(payload.provider_payload.action_template.source, "action_metadata.template");
  assert.equal(payload.provider_payload.context.execution_mode, MINI_ACTION_EXECUTION_ONLY_MODE);
  assert.equal(payload.provider_payload.context.capabilities.planning, false);
  assert.equal(payload.provider_payload.context.capabilities.inspectWorkspace, true);
  assert.equal(payload.provider_payload.capability_policy.planning_enabled, false);
  assert.match(payload.provider_payload.instructions.join("\n"), /auto-verification/);
  assert.match(payload.provider_payload.instructions.join("\n"), /Start immediately at the execution step/);
  assert.match(payload.provider_payload.instructions.join("\n"), /never block Day progression/);
});

test("resolveMiniActionSessionCompletionState ignores user message receipts until execution result passes", () => {
  const receiptOnly = resolveMiniActionSessionCompletionState({
    userMessageReceipt: {
      role: "user",
      content: "완료했어요",
      receivedAt: "2026-05-22T10:02:00.000Z",
    },
    providerRunEvent: {
      eventType: "run.completed",
      executionMode: MINI_ACTION_EXECUTION_ONLY_MODE,
    },
    now: new Date("2026-05-22T10:03:00.000Z"),
  });

  assert.equal(receiptOnly.status, MINI_ACTION_SESSION_COMPLETION_STATUS.pending);
  assert.equal(receiptOnly.completed, false);
  assert.equal(receiptOnly.completion_confirmed, false);
  assert.equal(receiptOnly.completion_driver, MINI_ACTION_COMPLETION_DRIVER.none);
  assert.equal(receiptOnly.ignored_user_message_receipt, true);
  assert.equal(receiptOnly.ignored_provider_run_completion, true);
  assert.equal(receiptOnly.reason, "awaiting_action_execution_result");

  const passed = resolveMiniActionSessionCompletionState({
    actionExecutionResult: {
      method: "cli",
      passed: true,
      outcome: "verified",
      confidence: 0.92,
      completedAt: "2026-05-22T10:04:00.000Z",
    },
    userMessageReceipt: {
      role: "user",
      content: "done",
    },
    providerRunEvent: {
      eventType: "run.completed",
      executionMode: MINI_ACTION_EXECUTION_ONLY_MODE,
    },
  });

  assert.equal(passed.status, MINI_ACTION_SESSION_COMPLETION_STATUS.completed);
  assert.equal(passed.completed, true);
  assert.equal(passed.completion_confirmed, true);
  assert.equal(passed.completed_at, "2026-05-22T10:04:00.000Z");
  assert.equal(passed.completion_driver, MINI_ACTION_COMPLETION_DRIVER.actionExecutionResult);
  assert.equal(passed.action_execution_result.method, "cli");
  assert.equal(passed.action_execution_result.passed, true);
  assert.equal(passed.ignored_user_message_receipt, true);
  assert.equal(passed.ignored_provider_run_completion, true);
  assert.equal(passed.reason, "action_execution_result_passed");
});

test("resolveMiniActionSessionCompletionState keeps insufficient execution results non-blocking and incomplete", () => {
  const state = resolveMiniActionSessionCompletionState({
    verificationState: {
      status: "failed",
      verificationResult: {
        method: "browser",
        passed: false,
        outcome: "failed",
        reason: "Public proof URL did not contain the launch CTA.",
      },
    },
    userMessageReceipt: {
      role: "user",
      content: "I sent it",
    },
    now: new Date("2026-05-22T10:05:00.000Z"),
  });

  assert.equal(state.status, MINI_ACTION_SESSION_COMPLETION_STATUS.insufficient);
  assert.equal(state.completed, false);
  assert.equal(state.completion_driver, MINI_ACTION_COMPLETION_DRIVER.none);
  assert.equal(state.progression_blocked, false);
  assert.equal(state.carry_over_queued, true);
  assert.equal(state.action_execution_result.passed, false);
  assert.equal(state.action_execution_result.reason, "Public proof URL did not contain the launch CTA.");
  assert.equal(state.ignored_user_message_receipt, true);
  assert.equal(state.reason, "action_execution_result_insufficient");
});

test("detectMiniActionCompletionEvent emits normalized completion signal for passed verifier event", () => {
  const signal = detectMiniActionCompletionEvent({
    sessionId: "mini-action-session-day-22",
    dayContext: {
      day_id: 22,
      active_question_id: "demo-scope",
      key_questions_with_intent: [
        {
          id: "demo-scope",
          question: "어떤 한 입력에서 결과까지 보여줄까요?",
          intent: "Force the demo into one visible happy path.",
        },
      ],
      action_spec: {
        id: "day-22-demo",
      },
    },
    event: {
      type: "action_verification_completed",
      verificationResult: {
        method: "browser",
        passed: true,
        outcome: "verified",
        confidence: 0.91,
        agentAssessment: "Browser verification found the demo page and CTA.",
        completedAt: "2026-05-22T10:08:00.000Z",
        raw: {
          url: "https://example.com/demo",
        },
      },
    },
    now: new Date("2026-05-22T10:09:00.000Z"),
  });

  assert.equal(signal.type, MINI_ACTION_COMPLETION_SIGNAL_TYPE);
  assert.equal(signal.schemaVersion, MINI_ACTION_COMPLETION_SIGNAL_SCHEMA_VERSION);
  assert.equal(signal.schema, "agentic30.curriculum.mini_action_completion_signal.v1");
  assert.equal(signal.signal, "mini_action_completed");
  assert.equal(signal.session_id, "mini-action-session-day-22");
  assert.equal(signal.day_id, 22);
  assert.equal(signal.action_id, "day-22-demo");
  assert.equal(signal.completed, true);
  assert.equal(signal.completion_confirmed, true);
  assert.equal(signal.completed_at, "2026-05-22T10:08:00.000Z");
  assert.equal(signal.completion_driver, MINI_ACTION_COMPLETION_DRIVER.actionExecutionResult);
  assert.equal(signal.method, "browser");
  assert.equal(signal.passed, true);
  assert.equal(signal.outcome, "verified");
  assert.equal(signal.confidence, 0.91);
  assert.equal(signal.agent_assessment, "Browser verification found the demo page and CTA.");
  assert.equal(signal.verification_result.raw.url, "https://example.com/demo");
  assert.equal(signal.active_original_question_resolved, true);
  assert.equal(signal.original_question_resolution.schemaVersion, MINI_ACTION_ORIGINAL_QUESTION_RESOLUTION_SCHEMA_VERSION);
  assert.equal(signal.original_question_resolution.schema, "agentic30.curriculum.mini_action_original_question_resolution.v1");
  assert.equal(signal.original_question_resolution.resolved, true);
  assert.equal(signal.original_question_resolution.resolved_by, "completed_mini_action");
  assert.equal(signal.original_question_resolution.question_id, "demo-scope");
  assert.equal(signal.original_question_resolution.original_question, "어떤 한 입력에서 결과까지 보여줄까요?");
  assert.equal(signal.original_question_resolution.intent, "Force the demo into one visible happy path.");
  assert.equal(signal.original_question_resolution.answer_source, "action_execution_result");
  assert.equal(signal.original_question_resolution.answer_data.method, "browser");
  assert.equal(signal.original_question_resolution.answer_data.verification_result.raw.url, "https://example.com/demo");
  assert.equal(signal.original_question_resolution.response_data_references.length, 0);
  assert.equal(signal.original_question_resolution.response_data_required, false);
  assert.equal(signal.original_question_resolution.requires_user_response, false);
  assert.equal(signal.original_question_resolution.progression_blocked, false);
  assert.equal(signal.original_question_resolution.preserve_intent, true);
  assert.match(signal.original_question_resolution.reframing_context.reframed_variant, /방금 실행한 증거/);
  assert.equal(signal.source_event_type, "action_verification_completed");
  assert.equal(signal.progression_blocked, false);
});

test("buildRealTimeReframeFromMiniActionCompletionSignal triggers from completion signal without response data", () => {
  const reframe = buildRealTimeReframeFromMiniActionCompletionSignal({
    completionSignal: {
      type: MINI_ACTION_COMPLETION_SIGNAL_TYPE,
      signal: "mini_action_completed",
      session_id: "mini-action-session-day-20",
      day_id: 20,
      action_id: "day-20-outreach",
      completed: true,
      passed: true,
      original_question_resolution: {
        schemaVersion: MINI_ACTION_ORIGINAL_QUESTION_RESOLUTION_SCHEMA_VERSION,
        schema: "agentic30.curriculum.mini_action_original_question_resolution.v1",
        status: "resolved",
        resolved: true,
        question_id: "prospects",
        original_question: "누구에게 지금 보내면 실제 반응을 배울 수 있나요?",
        intent: "Pick the smallest reachable prospect set.",
        answer_source: "action_execution_result",
        reframing_context: {
          original_question: "누구에게 지금 보내면 실제 반응을 배울 수 있나요?",
          intent: "Pick the smallest reachable prospect set.",
          available_data: {
            method: "google_sheets",
            outcome: "verified",
          },
          reframed_variant: "누구에게 지금 보내면 실제 반응을 배울 수 있나요? 방금 실행한 증거를 기준으로 Pick the smallest reachable prospect set.에 답해보세요.",
        },
        response_data_required: false,
        requires_user_response: false,
      },
    },
    now: new Date("2026-05-20T12:11:00.000Z"),
  });

  assert.equal(reframe.type, MINI_ACTION_REALTIME_REFRAME_TYPE);
  assert.equal(reframe.schemaVersion, MINI_ACTION_REALTIME_REFRAME_SCHEMA_VERSION);
  assert.equal(reframe.schema, "agentic30.curriculum.realtime_question_reframe.v1");
  assert.equal(reframe.trigger_event_type, MINI_ACTION_COMPLETION_SIGNAL_TYPE);
  assert.equal(reframe.real_time, true);
  assert.equal(reframe.session_id, "mini-action-session-day-20");
  assert.equal(reframe.day_id, 20);
  assert.equal(reframe.action_id, "day-20-outreach");
  assert.equal(reframe.question_id, "prospects");
  assert.equal(reframe.original_question, "누구에게 지금 보내면 실제 반응을 배울 수 있나요?");
  assert.equal(reframe.intent, "Pick the smallest reachable prospect set.");
  assert.equal(reframe.reframing_context.available_data.method, "google_sheets");
  assert.equal(reframe.response_data_references.length, 1);
  assert.equal(reframe.response_data_references[0].text, "반응");
  assert.equal(reframe.response_data_references[0].original_requires_response_data, true);
  assert.equal(reframe.response_data_references[0].requires_response_data, false);
  assert.equal(reframe.response_data_references[0].resolved_by, "known_mini_action_context");
  assert.equal(reframe.response_data_dependency_count, 1);
  assert.equal(reframe.response_data_dependencies_resolved_by, "known_mini_action_context");
  assert.match(reframe.reframed_variant, /verified mini-action via google_sheets|방금 완료한 mini-action 증거|알려진 실행 증거/);
  assert.doesNotMatch(reframe.reframed_variant, /반응/);
  assert.equal(reframe.response_data_required, false);
  assert.equal(reframe.requires_response_data, false);
  assert.equal(reframe.requires_user_response, false);
  assert.equal(reframe.progression_blocked, false);
  assert.equal(reframe.preserve_intent, true);
  assert.equal(reframe.transformed_question_answerability.intent_preserved, true);
  assert.equal(reframe.transformed_question_answerability.user_goal_or_decision_aligned, true);
  assert.equal(reframe.answerable_without_mini_action_response_data, true);
  assert.equal(
    reframe.transformed_question_answerability.schemaVersion,
    MINI_ACTION_ANSWERABILITY_VALIDATION_SCHEMA_VERSION,
  );
  assert.equal(reframe.transformed_question_answerability.answerable, true);
  assert.equal(reframe.transformed_question_answerability.unresolved_response_data_reference_count, 0);
  assert.deepEqual(reframe.transformed_question_answerability.leaked_response_data_terms, []);
  assert.equal(reframe.emitted_at, "2026-05-20T12:11:00.000Z");
});

test("validateMiniActionReframedQuestionAnswerability rejects transforms that still require mini-action response data", () => {
  const references = extractMiniActionResponseDataReferences({
    originalQuestion: "Which replies or no-reply outcomes matter?",
    intent: "Pick the smallest reachable prospect set.",
  });
  const rewritten = rewriteMiniActionResponseDataReferences({
    references,
    actionSpec: {
      completion_signal: "Google Sheet contains at least 10 sent rows.",
    },
    verificationResult: {
      method: "google_sheets",
      passed: true,
      outcome: "verified",
    },
  });

  const answerable = validateMiniActionReframedQuestionAnswerability({
    reframedQuestion: "completion signal: Google Sheet contains at least 10 sent rows. 기준으로 Pick the smallest reachable prospect set.에 답해보세요.",
    originalQuestion: "Which replies or no-reply outcomes matter?",
    intent: "Pick the smallest reachable prospect set.",
    responseDataReferences: rewritten,
    reframingContext: {
      available_data: {
        method: "google_sheets",
        outcome: "verified",
      },
      response_data_dependencies_resolved_by: "known_mini_action_context",
    },
  });

  assert.equal(answerable.schemaVersion, MINI_ACTION_ANSWERABILITY_VALIDATION_SCHEMA_VERSION);
  assert.equal(answerable.answerable, true);
  assert.equal(answerable.answerable_without_mini_action_response_data, true);
  assert.equal(answerable.response_data_reference_count, references.length);
  assert.equal(answerable.unresolved_response_data_reference_count, 0);
  assert.deepEqual(answerable.leaked_response_data_terms, []);
  assert.equal(answerable.known_execution_evidence_available, true);

  const stillDependsOnResponses = validateMiniActionReframedQuestionAnswerability({
    reframedQuestion: "Which replies or no-reply outcomes matter?",
    originalQuestion: "Which replies or no-reply outcomes matter?",
    intent: "Pick the smallest reachable prospect set.",
    responseDataReferences: references,
    reframingContext: {
      available_data: {
        method: "google_sheets",
      },
    },
  });

  assert.equal(stillDependsOnResponses.answerable, false);
  assert.equal(stillDependsOnResponses.answerable_without_mini_action_response_data, false);
  assert.equal(stillDependsOnResponses.unresolved_response_data_reference_count, references.length);
  assert.ok(stillDependsOnResponses.leaked_response_data_terms.includes("replies"));
  assert.ok(stillDependsOnResponses.leaked_response_data_terms.includes("no-reply"));
  assert.ok(stillDependsOnResponses.reasons.includes("unresolved_response_data_references"));
  assert.ok(stillDependsOnResponses.reasons.includes("transformed_question_still_names_response_data"));
});

test("validateMiniActionReframedQuestionAnswerability rejects reframes that drift from the original intent", () => {
  const aligned = validateMiniActionReframedQuestionIntent({
    originalQuestion: "누구에게 지금 보내면 실제 반응을 배울 수 있나요?",
    intent: "Pick the smallest reachable prospect set.",
    reframedQuestion: "방금 완료한 mini-action 증거를 기준으로 Pick the smallest reachable prospect set.에 답해보세요.",
  });

  assert.equal(aligned.intent_preserved, true);
  assert.equal(aligned.user_goal_or_decision_aligned, true);
  assert.ok(aligned.matched_intent_tokens.includes("pick"));
  assert.ok(aligned.matched_intent_tokens.includes("smallest"));

  const drifted = validateMiniActionReframedQuestionAnswerability({
    reframedQuestion: "방금 확인된 URL의 색상과 시각 스타일은 무엇인가요?",
    originalQuestion: "누구에게 지금 보내면 실제 반응을 배울 수 있나요?",
    intent: "Pick the smallest reachable prospect set.",
    responseDataReferences: [
      {
        text: "반응",
        original_requires_response_data: true,
        requires_response_data: false,
        response_data_required: false,
        resolved_by: "known_mini_action_context",
        known_context_source: "completion_signal",
      },
    ],
    reframingContext: {
      available_data: {
        method: "google_sheets",
        outcome: "verified",
      },
      response_data_dependencies_resolved_by: "known_mini_action_context",
    },
  });

  assert.equal(drifted.known_execution_evidence_available, true);
  assert.equal(drifted.unresolved_response_data_reference_count, 0);
  assert.equal(drifted.intent_preserved, false);
  assert.equal(drifted.user_goal_or_decision_aligned, false);
  assert.equal(drifted.answerable, false);
  assert.ok(drifted.reasons.includes("intent_not_preserved"));
});

test("resolveActiveOriginalQuestionAfterMiniAction resolves only completed mini-actions", () => {
  const pending = resolveActiveOriginalQuestionAfterMiniAction({
    completionSignal: {
      completed: false,
      verification_result: {
        passed: false,
      },
    },
    dayContext: {
      active_question_id: "prospects",
      key_questions_with_intent: [
        {
          id: "prospects",
          question: "누구에게 지금 보내면 실제 반응을 배울 수 있나요?",
          intent: "Pick the smallest reachable prospect set.",
        },
      ],
    },
  });

  assert.equal(pending, null);

  const resolved = resolveActiveOriginalQuestionAfterMiniAction({
    completionSignal: {
      completed: true,
      completed_at: "2026-05-20T12:10:00.000Z",
      active_question_id: "prospects",
      verification_result: {
        method: "google_sheets",
        passed: true,
        outcome: "verified",
        confidence: 0.89,
        agent_assessment: "Sheet contains 10 sent rows.",
      },
    },
    dayContext: {
      key_questions_with_intent: [
        {
          id: "prospects",
          question: "누구에게 지금 보내면 실제 반응을 배울 수 있나요?",
          intent: "Pick the smallest reachable prospect set.",
        },
      ],
    },
  });

  assert.equal(resolved.schemaVersion, MINI_ACTION_ORIGINAL_QUESTION_RESOLUTION_SCHEMA_VERSION);
  assert.equal(resolved.status, "resolved");
  assert.equal(resolved.question_id, "prospects");
  assert.equal(resolved.original_question, "누구에게 지금 보내면 실제 반응을 배울 수 있나요?");
  assert.equal(resolved.answer_data.method, "google_sheets");
  assert.equal(resolved.answer_data.confidence, 0.89);
  assert.equal(resolved.completed_at, "2026-05-20T12:10:00.000Z");
  assert.equal(resolved.response_data_references.length, 1);
  assert.equal(resolved.response_data_references[0].text, "반응");
  assert.equal(resolved.response_data_references[0].requires_response_data, false);
  assert.equal(resolved.response_data_references[0].known_context_source, "mini_action_metadata");
  assert.equal(resolved.response_data_dependency_count, 1);
  assert.equal(resolved.response_data_required, false);
  assert.equal(resolved.requires_user_response, false);

  const stringQuestion = resolveActiveOriginalQuestionAfterMiniAction({
    completionSignal: {
      completed: true,
      original_question: "지금 가장 작은 공개 증거는 무엇인가요?",
      verification_result: {
        method: "browser",
        passed: true,
      },
    },
  });

  assert.equal(stringQuestion.question_id, "question-1");
  assert.equal(stringQuestion.original_question, "지금 가장 작은 공개 증거는 무엇인가요?");
});

test("detectMiniActionCompletionEvent ignores provider lifecycle and insufficient verifier events", () => {
  assert.equal(
    detectMiniActionCompletionEvent({
      event: {
        type: "run.completed",
        executionMode: MINI_ACTION_EXECUTION_ONLY_MODE,
      },
      now: new Date("2026-05-22T10:09:00.000Z"),
    }),
    null,
  );

  assert.equal(
    detectMiniActionCompletionEvent({
      event: {
        type: "action_verification_completed",
        payload: {
          verification_result: {
            method: "google_sheets",
            passed: false,
            outcome: "failed",
            reason: "Sheet had only 4 sent rows.",
          },
        },
      },
      now: new Date("2026-05-22T10:09:00.000Z"),
    }),
    null,
  );
});

test("buildMiniActionCompletionSignal normalizes completion state without source event", () => {
  const signal = buildMiniActionCompletionSignal({
    dayId: 19,
    actionId: "day-19-public-proof",
    state: resolveMiniActionSessionCompletionState({
      actionExecutionResult: {
        method: "mcp",
        passed: true,
        status: "success",
        confidence: 0.84,
      },
      now: new Date("2026-05-19T12:00:00.000Z"),
    }),
  });

  assert.equal(signal.day_id, 19);
  assert.equal(signal.action_id, "day-19-public-proof");
  assert.equal(signal.completed_at, "2026-05-19T12:00:00.000Z");
  assert.equal(signal.method, "mcp");
  assert.equal(signal.outcome, "success");
  assert.equal(signal.confidence, 0.84);
  assert.equal(signal.source_event_type, "");
});

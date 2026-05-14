import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_VERIFICATION_METHOD,
  ACTION_VERIFICATION_STATUS,
  createActionDayVerificationState,
  failActionVerification,
  retryActionVerification,
  startActionVerification,
} from "../sidecar/action-day-verification-state.mjs";
import {
  ACTION_EVIDENCE_SUBMISSION_COMPONENT_SCHEMA_VERSION,
  ACTION_EVIDENCE_SUBMISSION_EVENT_TYPE,
  ACTION_EVIDENCE_INPUT_MODE,
  ACTION_EVIDENCE_SUBMISSION_STATUS,
  ACTION_EVIDENCE_TYPE,
  acceptActionEvidence,
  getActionEvidenceSubmissionView,
  normalizeActionEvidenceComponentPayload,
  rejectActionEvidence,
  renderActionEvidenceSubmissionComponent,
  resolveActionEvidenceInputMode,
  submitActionEvidence,
  submitActionEvidenceComponentPayload,
  validateActionEvidenceSubmission,
} from "../sidecar/action-day-evidence-submission.mjs";

function makeClock(start = "2026-05-14T12:00:00.000Z") {
  let next = new Date(start).getTime();
  return () => {
    const value = new Date(next);
    next += 1_000;
    return value;
  };
}

test("action evidence validation rejects invalid evidence input", () => {
  const invalidLandingPage = validateActionEvidenceSubmission({
    type: ACTION_EVIDENCE_TYPE.file,
    content: "/tmp/proof.png",
  }, {
    actionType: "landing_page",
  });

  assert.equal(invalidLandingPage.valid, false);
  assert.deepEqual(invalidLandingPage.allowedTypes, [ACTION_EVIDENCE_TYPE.link]);
  assert.match(invalidLandingPage.errors.join("\n"), /Evidence type must be link/);
  assert.equal(invalidLandingPage.evidence.validationStatus, "invalid");

  const invalidUrl = validateActionEvidenceSubmission({
    type: ACTION_EVIDENCE_TYPE.link,
    content: "not a url",
  });

  assert.equal(invalidUrl.valid, false);
  assert.match(invalidUrl.errors.join("\n"), /http\(s\) URL/);
});

test("action evidence input resolver honors explicit action spec evidence modes", () => {
  const linkSpec = resolveActionEvidenceInputMode({
    action_type: "recording",
    evidence_input_mode: "link",
  });

  assert.equal(linkSpec.mode, ACTION_EVIDENCE_INPUT_MODE.link);
  assert.equal(linkSpec.evidenceType, ACTION_EVIDENCE_TYPE.link);
  assert.deepEqual(linkSpec.allowedTypes, [ACTION_EVIDENCE_TYPE.link]);
  assert.equal(linkSpec.source, "explicit");

  const fileSpec = resolveActionEvidenceInputMode({
    actionType: "landing_page",
    evidenceType: "file_upload",
  });

  assert.equal(fileSpec.mode, ACTION_EVIDENCE_INPUT_MODE.fileUpload);
  assert.equal(fileSpec.evidenceType, ACTION_EVIDENCE_TYPE.file);
  assert.deepEqual(fileSpec.allowedTypes, [ACTION_EVIDENCE_TYPE.file]);
  assert.equal(fileSpec.source, "explicit");

  const multipleAllowed = resolveActionEvidenceInputMode({
    expectedEvidenceTypes: ["file", "link", "file"],
  });

  assert.equal(multipleAllowed.mode, ACTION_EVIDENCE_INPUT_MODE.fileUpload);
  assert.deepEqual(multipleAllowed.allowedTypes, [
    ACTION_EVIDENCE_TYPE.file,
    ACTION_EVIDENCE_TYPE.link,
  ]);
});

test("action evidence input resolver maps known action types to link or file upload", () => {
  assert.deepEqual(resolveActionEvidenceInputMode({ action_type: "post" }), {
    mode: ACTION_EVIDENCE_INPUT_MODE.link,
    evidenceType: ACTION_EVIDENCE_TYPE.link,
    allowedTypes: [ACTION_EVIDENCE_TYPE.link],
    actionType: "post",
    source: "action_type",
    acceptsLink: true,
    acceptsFileUpload: false,
  });

  assert.deepEqual(resolveActionEvidenceInputMode({ action_type: "landing-page" }), {
    mode: ACTION_EVIDENCE_INPUT_MODE.link,
    evidenceType: ACTION_EVIDENCE_TYPE.link,
    allowedTypes: [ACTION_EVIDENCE_TYPE.link],
    actionType: "landing_page",
    source: "action_type",
    acceptsLink: true,
    acceptsFileUpload: false,
  });

  assert.deepEqual(resolveActionEvidenceInputMode({ action_type: "transcript" }), {
    mode: ACTION_EVIDENCE_INPUT_MODE.fileUpload,
    evidenceType: ACTION_EVIDENCE_TYPE.file,
    allowedTypes: [ACTION_EVIDENCE_TYPE.file],
    actionType: "transcript",
    source: "action_type",
    acceptsLink: false,
    acceptsFileUpload: true,
  });

  assert.deepEqual(resolveActionEvidenceInputMode({ action_type: "screenshot" }), {
    mode: ACTION_EVIDENCE_INPUT_MODE.fileUpload,
    evidenceType: ACTION_EVIDENCE_TYPE.file,
    allowedTypes: [ACTION_EVIDENCE_TYPE.file],
    actionType: "screenshot",
    source: "action_type",
    acceptsLink: false,
    acceptsFileUpload: true,
  });
});

test("action evidence input resolver covers curriculum action type specifications", () => {
  const cases = [
    ["community_post", ACTION_EVIDENCE_INPUT_MODE.link],
    ["bip_post", ACTION_EVIDENCE_INPUT_MODE.link],
    ["sns_post", ACTION_EVIDENCE_INPUT_MODE.link],
    ["dm_log", ACTION_EVIDENCE_INPUT_MODE.link],
    ["outreach-tracker", ACTION_EVIDENCE_INPUT_MODE.link],
    ["google_doc", ACTION_EVIDENCE_INPUT_MODE.link],
    ["google_sheets", ACTION_EVIDENCE_INPUT_MODE.link],
    ["interview_recording", ACTION_EVIDENCE_INPUT_MODE.fileUpload],
    ["interview_transcript", ACTION_EVIDENCE_INPUT_MODE.fileUpload],
    ["meeting_recording", ACTION_EVIDENCE_INPUT_MODE.fileUpload],
    ["voice_transcription", ACTION_EVIDENCE_INPUT_MODE.fileUpload],
    ["screen_recording", ACTION_EVIDENCE_INPUT_MODE.fileUpload],
    ["demo_asset", ACTION_EVIDENCE_INPUT_MODE.fileUpload],
    ["observation_note", ACTION_EVIDENCE_INPUT_MODE.fileUpload],
    ["worksheet", ACTION_EVIDENCE_INPUT_MODE.fileUpload],
  ];

  for (const [actionType, expectedMode] of cases) {
    const resolution = resolveActionEvidenceInputMode({
      action_spec: {
        action_type: actionType,
        completion_signal: `${actionType} evidence exists.`,
      },
    });

    assert.equal(resolution.mode, expectedMode, actionType);
    assert.equal(resolution.source, "action_type", actionType);
    assert.equal(
      resolution.evidenceType,
      expectedMode === ACTION_EVIDENCE_INPUT_MODE.fileUpload
        ? ACTION_EVIDENCE_TYPE.file
        : ACTION_EVIDENCE_TYPE.link,
      actionType,
    );
  }
});

test("action evidence submission component renders link input for link evidence mode", () => {
  const pending = createActionDayVerificationState({
    dayId: 12,
    actionId: "day-12-community-post",
    actionDescription: "Publish a community post.",
    completionSignal: "A public post URL exists.",
    now: makeClock(),
  });

  const component = renderActionEvidenceSubmissionComponent({
    state: pending,
    actionSpec: {
      action_type: "community_post",
      completion_signal: "A public post URL exists.",
    },
    requestId: "req-evidence-link",
    sessionId: "session-evidence-link",
    now: new Date("2026-05-14T03:00:00.000Z"),
  });
  const linkField = component.fields.find((field) => field.id === "evidence-link");

  assert.equal(component.schemaVersion, ACTION_EVIDENCE_SUBMISSION_COMPONENT_SCHEMA_VERSION);
  assert.equal(component.componentType, "curriculum_action_evidence_submission");
  assert.equal(component.requestId, "req-evidence-link");
  assert.equal(component.sessionId, "session-evidence-link");
  assert.equal(component.createdAt, "2026-05-14T03:00:00.000Z");
  assert.equal(component.mode, ACTION_EVIDENCE_INPUT_MODE.link);
  assert.equal(component.evidenceType, ACTION_EVIDENCE_TYPE.link);
  assert.equal(component.acceptsLink, true);
  assert.equal(component.acceptsFileUpload, false);
  assert.equal(component.view.canSubmitEvidence, true);
  assert.equal(component.card.layout, "action_evidence_submission");
  assert.equal(component.card.state, "ready");
  assert.equal(component.card.ctaText, "링크 증거 제출");
  assert.deepEqual(component.submitAction, {
    type: ACTION_EVIDENCE_SUBMISSION_EVENT_TYPE,
    componentType: "curriculum_action_evidence_submission",
    schemaVersion: ACTION_EVIDENCE_SUBMISSION_COMPONENT_SCHEMA_VERSION,
    requestId: "req-evidence-link",
    sessionId: "session-evidence-link",
    enabled: true,
    evidenceType: ACTION_EVIDENCE_TYPE.link,
    allowedTypes: [ACTION_EVIDENCE_TYPE.link],
    fieldNames: {
      link: "evidenceUrl",
      file: null,
      note: "evidenceNote",
    },
    requiredPayloadKeys: ["evidenceUrl"],
  });

  assert.ok(linkField);
  assert.equal(linkField.kind, "input");
  assert.equal(linkField.type, "url");
  assert.equal(linkField.inputMode, ACTION_EVIDENCE_INPUT_MODE.link);
  assert.equal(linkField.evidenceType, ACTION_EVIDENCE_TYPE.link);
  assert.equal(linkField.name, "evidenceUrl");
  assert.equal(linkField.label, "증거 링크");
  assert.equal(linkField.placeholder, "https://example.com/proof");
  assert.equal(linkField.required, true);
  assert.equal(linkField.disabled, false);
  assert.equal(linkField.validation.pattern, "^https?://");
  assert.equal(component.primaryField, linkField);
  assert.equal(component.fields.some((field) => field.id === "evidence-file"), false);
  assert.deepEqual(
    component.card.fields.map((field) => [field.id, field.type, field.evidenceType, field.disabled]),
    [
      ["evidence-link", "url", ACTION_EVIDENCE_TYPE.link, false],
      ["evidence-note", "textarea", null, false],
    ],
  );
});

test("action evidence submission component renders file upload control for file upload mode", () => {
  const pending = createActionDayVerificationState({
    dayId: 15,
    actionId: "day-15-interview-transcript",
    actionDescription: "Attach the transcript from a customer interview.",
    completionSignal: "A local transcript or recording file is attached.",
    now: makeClock(),
  });

  const component = renderActionEvidenceSubmissionComponent({
    state: pending,
    actionSpec: {
      action_type: "interview_transcript",
      completion_signal: "A local transcript or recording file is attached.",
    },
    requestId: "req-evidence-file",
    sessionId: "session-evidence-file",
    now: new Date("2026-05-14T03:10:00.000Z"),
  });
  const fileField = component.fields.find((field) => field.id === "evidence-file");

  assert.equal(component.mode, ACTION_EVIDENCE_INPUT_MODE.fileUpload);
  assert.equal(component.evidenceType, ACTION_EVIDENCE_TYPE.file);
  assert.equal(component.acceptsLink, false);
  assert.equal(component.acceptsFileUpload, true);
  assert.equal(component.card.ctaText, "파일 증거 제출");
  assert.deepEqual(component.submitAction, {
    type: ACTION_EVIDENCE_SUBMISSION_EVENT_TYPE,
    componentType: "curriculum_action_evidence_submission",
    schemaVersion: ACTION_EVIDENCE_SUBMISSION_COMPONENT_SCHEMA_VERSION,
    requestId: "req-evidence-file",
    sessionId: "session-evidence-file",
    enabled: true,
    evidenceType: ACTION_EVIDENCE_TYPE.file,
    allowedTypes: [ACTION_EVIDENCE_TYPE.file],
    fieldNames: {
      link: null,
      file: "evidenceFile",
      note: "evidenceNote",
    },
    requiredPayloadKeys: ["evidenceFile"],
  });

  assert.ok(fileField);
  assert.equal(fileField.kind, "input");
  assert.equal(fileField.control, "file_upload");
  assert.equal(fileField.type, "file");
  assert.equal(fileField.inputMode, ACTION_EVIDENCE_INPUT_MODE.fileUpload);
  assert.equal(fileField.evidenceType, ACTION_EVIDENCE_TYPE.file);
  assert.equal(fileField.name, "evidenceFile");
  assert.equal(fileField.label, "증거 파일");
  assert.equal(fileField.required, true);
  assert.equal(fileField.disabled, false);
  assert.equal(fileField.multiple, false);
  assert.deepEqual(fileField.accept, ["audio/*", "image/*", "video/*", ".md", ".pdf", ".txt"]);
  assert.equal(fileField.validation.message, "로컬 파일을 첨부해주세요.");
  assert.equal(component.primaryField, fileField);
  assert.equal(component.fields.some((field) => field.id === "evidence-link"), false);
  assert.deepEqual(
    component.card.fields.map((field) => [field.id, field.type, field.evidenceType, field.disabled]),
    [
      ["evidence-file", "file", ACTION_EVIDENCE_TYPE.file, false],
      ["evidence-note", "textarea", null, false],
    ],
  );
});

test("action evidence submission component validates entered link payload before submit", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 12,
    actionId: "day-12-community-post",
    actionDescription: "Publish a community post.",
    completionSignal: "A public post URL exists.",
    now,
  });
  const component = renderActionEvidenceSubmissionComponent({
    state: pending,
    actionSpec: { action_type: "community_post" },
    requestId: "req-evidence-link",
    sessionId: "session-evidence-link",
    now: new Date("2026-05-14T03:00:00.000Z"),
  });

  const invalid = submitActionEvidenceComponentPayload(pending, {
    requestId: "req-evidence-link",
    sessionId: "session-evidence-link",
    evidenceUrl: "example dot com",
    evidenceNote: "Public proof post",
  }, {
    component,
    actionSpec: { action_type: "community_post" },
    verifier: "browser-harness",
    now,
  });

  assert.equal(invalid.status, ACTION_EVIDENCE_SUBMISSION_STATUS.invalid);
  assert.equal(invalid.state, pending);
  assert.equal(invalid.validation.valid, false);
  assert.match(invalid.validation.errors.join("\n"), /http\(s\) URL/);
});

test("action evidence submission component submits entered link evidence payload", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 12,
    actionId: "day-12-community-post",
    actionDescription: "Publish a community post.",
    completionSignal: "A public post URL exists.",
    now,
  });
  const component = renderActionEvidenceSubmissionComponent({
    state: pending,
    actionSpec: { action_type: "community_post" },
    requestId: "req-evidence-link",
    sessionId: "session-evidence-link",
    now: new Date("2026-05-14T03:00:00.000Z"),
  });
  const normalized = normalizeActionEvidenceComponentPayload({
    requestId: "req-evidence-link",
    sessionId: "session-evidence-link",
    evidenceUrl: "https://example.com/community-proof",
    evidenceNote: "Posted in the founder community.",
    submittedAt: "2026-05-14T03:01:00.000Z",
  }, {
    component,
    actionSpec: { action_type: "community_post" },
  });

  assert.equal(normalized.valid, true);
  assert.equal(normalized.evidence.type, ACTION_EVIDENCE_TYPE.link);
  assert.equal(normalized.evidence.content, "https://example.com/community-proof");
  assert.equal(normalized.evidence.note, "Posted in the founder community.");
  assert.equal(normalized.evidence.submittedAt, "2026-05-14T03:01:00.000Z");
  assert.equal(normalized.validation.evidence.validationStatus, "valid");

  const submitted = submitActionEvidenceComponentPayload(pending, {
    requestId: "req-evidence-link",
    sessionId: "session-evidence-link",
    evidenceUrl: "https://example.com/community-proof",
    evidenceNote: "Posted in the founder community.",
    submittedAt: "2026-05-14T03:01:00.000Z",
  }, {
    component,
    actionSpec: { action_type: "community_post" },
    verifier: "browser-harness",
    now,
  });

  assert.equal(submitted.status, ACTION_EVIDENCE_SUBMISSION_STATUS.submitted);
  assert.equal(submitted.validation.valid, true);
  assert.equal(submitted.state.status, ACTION_VERIFICATION_STATUS.running);
  assert.equal(submitted.state.currentAttempt.method, ACTION_VERIFICATION_METHOD.evidenceLink);
  assert.equal(submitted.state.currentAttempt.verifier, "browser-harness");
  assert.equal(submitted.state.currentAttempt.metadata.requestId, "req-evidence-link");
  assert.equal(submitted.state.currentAttempt.metadata.sessionId, "session-evidence-link");
  assert.equal(submitted.state.currentAttempt.metadata.componentType, "curriculum_action_evidence_submission");
  assert.equal(submitted.state.currentAttempt.metadata.evidenceNote, "Posted in the founder community.");
  assert.equal(submitted.state.evidenceSubmission.content, "https://example.com/community-proof");
});

test("action evidence submission component submits selected file evidence payload in file upload mode", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 15,
    actionId: "day-15-interview-transcript",
    actionDescription: "Attach the transcript from a customer interview.",
    completionSignal: "A local transcript or recording file is attached.",
    now,
  });
  const component = renderActionEvidenceSubmissionComponent({
    state: pending,
    actionSpec: {
      action_type: "interview_transcript",
      completion_signal: "A local transcript or recording file is attached.",
    },
    requestId: "req-evidence-file",
    sessionId: "session-evidence-file",
    now: new Date("2026-05-14T03:10:00.000Z"),
  });

  assert.equal(component.mode, ACTION_EVIDENCE_INPUT_MODE.fileUpload);
  assert.equal(component.submitAction.fieldNames.file, "evidenceFile");
  assert.deepEqual(component.submitAction.requiredPayloadKeys, ["evidenceFile"]);

  const normalized = normalizeActionEvidenceComponentPayload({
    requestId: "req-evidence-file",
    sessionId: "session-evidence-file",
    evidenceFile: {
      path: "/Users/founder/Agentic30/evidence/day-15-customer-transcript.md",
      name: "day-15-customer-transcript.md",
    },
    evidenceNote: "CARET transcript from the first customer call.",
    submittedAt: "2026-05-14T03:11:00.000Z",
  }, {
    component,
    actionSpec: { action_type: "interview_transcript" },
  });

  assert.equal(normalized.valid, true);
  assert.equal(normalized.evidence.type, ACTION_EVIDENCE_TYPE.file);
  assert.equal(
    normalized.evidence.content,
    "/Users/founder/Agentic30/evidence/day-15-customer-transcript.md",
  );
  assert.equal(normalized.evidence.note, "CARET transcript from the first customer call.");
  assert.equal(normalized.evidence.submittedAt, "2026-05-14T03:11:00.000Z");
  assert.equal(normalized.validation.evidence.validationStatus, "valid");

  const submitted = submitActionEvidenceComponentPayload(pending, {
    requestId: "req-evidence-file",
    sessionId: "session-evidence-file",
    evidenceFile: {
      path: "/Users/founder/Agentic30/evidence/day-15-customer-transcript.md",
      name: "day-15-customer-transcript.md",
    },
    evidenceNote: "CARET transcript from the first customer call.",
    submittedAt: "2026-05-14T03:11:00.000Z",
  }, {
    component,
    actionSpec: { action_type: "interview_transcript" },
    verifier: "file-evidence-review",
    now,
  });

  assert.equal(submitted.status, ACTION_EVIDENCE_SUBMISSION_STATUS.submitted);
  assert.equal(submitted.validation.valid, true);
  assert.equal(submitted.state.status, ACTION_VERIFICATION_STATUS.running);
  assert.equal(submitted.state.currentAttempt.method, ACTION_VERIFICATION_METHOD.evidenceFile);
  assert.equal(submitted.state.currentAttempt.verifier, "file-evidence-review");
  assert.equal(submitted.state.currentAttempt.metadata.requestId, "req-evidence-file");
  assert.equal(submitted.state.currentAttempt.metadata.sessionId, "session-evidence-file");
  assert.equal(submitted.state.currentAttempt.metadata.evidenceNote, "CARET transcript from the first customer call.");
  assert.equal(submitted.state.evidenceSubmission.type, ACTION_EVIDENCE_TYPE.file);
  assert.equal(
    submitted.state.evidenceSubmission.content,
    "/Users/founder/Agentic30/evidence/day-15-customer-transcript.md",
  );
});

test("action evidence submission component disables link field while auto-verification is gated", () => {
  const pending = createActionDayVerificationState({
    dayId: 13,
    actionId: "day-13-landing-page",
    actionDescription: "Publish a landing page.",
    completionSignal: "A public landing page URL resolves.",
    preferredMethods: [
      ACTION_VERIFICATION_METHOD.browser,
      ACTION_VERIFICATION_METHOD.evidenceLink,
    ],
    now: makeClock(),
  });

  const component = renderActionEvidenceSubmissionComponent({
    state: pending,
    actionSpec: { action_type: "landing_page" },
    now: new Date("2026-05-14T03:05:00.000Z"),
  });
  const linkField = component.fields.find((field) => field.id === "evidence-link");

  assert.equal(component.mode, ACTION_EVIDENCE_INPUT_MODE.link);
  assert.equal(component.view.canSubmitEvidence, false);
  assert.match(component.view.gateReason, /Browser Tool auto-verification/);
  assert.equal(component.card.state, "gated");
  assert.equal(component.card.helperText, component.view.gateReason);
  assert.ok(linkField);
  assert.equal(linkField.type, "url");
  assert.equal(linkField.disabled, true);
});

test("action evidence input resolver infers mode from structured action spec text and verification", () => {
  const browserVerified = resolveActionEvidenceInputMode({
    action_spec: {
      verification_method: "browser",
      completion_signal: "A public URL resolves and contains the launch hook.",
    },
  });
  assert.equal(browserVerified.mode, ACTION_EVIDENCE_INPUT_MODE.link);
  assert.equal(browserVerified.source, "verification_method");

  const recordingArtifact = resolveActionEvidenceInputMode({
    goal: "Capture a customer observation.",
    action_with_signal: "Attach the PLAUD or CARET transcript file from the call.",
    completion_signal: "A transcript file exists with one user quote.",
  });
  assert.equal(recordingArtifact.mode, ACTION_EVIDENCE_INPUT_MODE.fileUpload);
  assert.equal(recordingArtifact.source, "spec_text");

  const unknownAction = resolveActionEvidenceInputMode({ action_type: "custom_action" });
  assert.equal(unknownAction.mode, ACTION_EVIDENCE_INPUT_MODE.link);
  assert.deepEqual(unknownAction.allowedTypes, [
    ACTION_EVIDENCE_TYPE.link,
    ACTION_EVIDENCE_TYPE.file,
  ]);
  assert.equal(unknownAction.source, "default");
});

test("action evidence validation uses action specs to require file uploads", () => {
  const invalidLink = validateActionEvidenceSubmission({
    type: ACTION_EVIDENCE_TYPE.link,
    content: "https://example.com/private-recording",
  }, {
    actionSpec: {
      action_type: "recording",
      completion_signal: "Upload a local recording or transcript file.",
    },
  });

  assert.equal(invalidLink.valid, false);
  assert.deepEqual(invalidLink.allowedTypes, [ACTION_EVIDENCE_TYPE.file]);
  assert.equal(invalidLink.evidenceMode.mode, ACTION_EVIDENCE_INPUT_MODE.fileUpload);
  assert.match(invalidLink.errors.join("\n"), /Evidence type must be file/);

  const validFile = validateActionEvidenceSubmission({
    type: ACTION_EVIDENCE_TYPE.file,
    content: "./evidence/customer-call-transcript.md",
  }, {
    actionSpec: {
      action_type: "recording",
      completion_signal: "Upload a local recording or transcript file.",
    },
  });

  assert.equal(validFile.valid, true);
  assert.equal(validFile.evidenceMode.source, "action_type");
});

test("action evidence submission records a valid link as a running verification attempt", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 19,
    actionId: "day-19-public-proof",
    actionDescription: "Publish a public proof post.",
    completionSignal: "A public URL contains the proof post.",
    now,
  });

  const result = submitActionEvidence(pending, {
    type: ACTION_EVIDENCE_TYPE.link,
    content: "https://example.com/proof-post",
    note: "BIP proof post",
    submittedAt: "2026-05-14T11:59:00.000Z",
  }, {
    actionType: "post",
    verifier: "browser-harness",
    metadata: { source: "manual-fallback" },
    now,
  });

  assert.equal(result.status, ACTION_EVIDENCE_SUBMISSION_STATUS.submitted);
  assert.equal(result.validation.valid, true);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.running);
  assert.equal(result.state.currentAttempt.method, ACTION_VERIFICATION_METHOD.evidenceLink);
  assert.equal(result.state.currentAttempt.verifier, "browser-harness");
  assert.equal(result.state.evidenceSubmission.type, ACTION_EVIDENCE_TYPE.link);
  assert.equal(result.state.evidenceSubmission.content, "https://example.com/proof-post");
  assert.equal(result.state.evidenceSubmission.validationStatus, "valid");
  assert.deepEqual(getActionEvidenceSubmissionView(result.state), {
    status: ACTION_VERIFICATION_STATUS.running,
    evidenceSubmission: result.state.evidenceSubmission,
    canSubmitEvidence: false,
    autoVerificationRequired: false,
    autoVerificationCompleted: false,
    cliAutoVerificationRequired: false,
    cliAutoVerificationCompleted: false,
    cliAutoVerificationNonVerifiedOutcomeReturned: false,
    browserAutoVerificationRequired: false,
    browserAutoVerificationCompleted: false,
    browserAutoVerificationNonVerifiedOutcomeReturned: false,
    configuredMcpVerificationRequired: false,
    configuredMcpVerificationCompleted: false,
    configuredMcpInsufficientEvidenceReturned: false,
    gateReason: "Auto-verification is still running. Evidence fallback unlocks after it completes.",
    isSubmitted: true,
    isAccepted: false,
    isRejected: false,
    latestAssessment: "",
    latestReason: "",
  });
});

test("action day UI flow unlocks evidence only after Browser Tool auto-verification fails", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 10,
    actionId: "day-10-landing-page",
    actionDescription: "Publish a landing page draft.",
    completionSignal: "A public URL resolves and contains the offer text.",
    preferredMethods: [
      ACTION_VERIFICATION_METHOD.browser,
      ACTION_VERIFICATION_METHOD.evidenceLink,
    ],
    now,
  });

  const initialView = getActionEvidenceSubmissionView(pending);
  assert.equal(initialView.autoVerificationRequired, true);
  assert.equal(initialView.autoVerificationCompleted, false);
  assert.equal(initialView.canSubmitEvidence, false);
  assert.equal(initialView.browserAutoVerificationRequired, true);
  assert.equal(initialView.browserAutoVerificationCompleted, false);
  assert.match(initialView.gateReason, /Browser Tool auto-verification/);

  const blocked = submitActionEvidence(pending, {
    type: ACTION_EVIDENCE_TYPE.link,
    content: "https://example.com/day-10-proof",
  }, {
    actionType: "landing_page",
    now,
  });
  assert.equal(blocked.status, ACTION_EVIDENCE_SUBMISSION_STATUS.blocked);
  assert.equal(blocked.state, pending);
  assert.match(blocked.reason, /Browser Tool auto-verification/);

  const running = startActionVerification(pending, {
    method: ACTION_VERIFICATION_METHOD.browser,
    verifier: "browser-harness",
    metadata: { url: "https://example.com/day-10-proof" },
    now,
  });

  const runningView = getActionEvidenceSubmissionView(running);
  assert.equal(runningView.canSubmitEvidence, false);
  assert.match(runningView.gateReason, /still running/);

  const failed = failActionVerification(running, {
    reason: "Browser could not reach the submitted URL.",
    agentAssessment: "Fallback link evidence is allowed now because the auto check completed.",
    raw: { statusCode: 404 },
    now,
  });

  const fallbackView = getActionEvidenceSubmissionView(failed);
  assert.equal(fallbackView.autoVerificationRequired, true);
  assert.equal(fallbackView.autoVerificationCompleted, true);
  assert.equal(fallbackView.cliAutoVerificationRequired, false);
  assert.equal(fallbackView.cliAutoVerificationNonVerifiedOutcomeReturned, false);
  assert.equal(fallbackView.browserAutoVerificationRequired, true);
  assert.equal(fallbackView.browserAutoVerificationCompleted, true);
  assert.equal(fallbackView.browserAutoVerificationNonVerifiedOutcomeReturned, true);
  assert.equal(fallbackView.canSubmitEvidence, true);
  assert.equal(fallbackView.gateReason, "");

  const fallbackSubmission = submitActionEvidence(failed, {
    type: ACTION_EVIDENCE_TYPE.link,
    content: "https://example.com/day-10-proof",
  }, {
    actionType: "landing_page",
    verifier: "evidence-fallback",
    now,
  });

  assert.equal(fallbackSubmission.status, ACTION_EVIDENCE_SUBMISSION_STATUS.submitted);
  assert.equal(fallbackSubmission.state.currentAttempt.method, ACTION_VERIFICATION_METHOD.evidenceLink);
  assert.equal(fallbackSubmission.state.currentAttempt.verifier, "evidence-fallback");
});

test("action day UI keeps evidence gated after CLI failure until Browser Tool fails or is unsupported", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 20,
    actionId: "day-20-outreach-tracker",
    actionDescription: "Record 10 warm outreach DMs.",
    completionSignal: "Google Sheet contains at least 10 rows with sent status.",
    preferredMethods: [
      ACTION_VERIFICATION_METHOD.cli,
      ACTION_VERIFICATION_METHOD.evidenceLink,
    ],
    now,
  });

  const initialView = getActionEvidenceSubmissionView(pending);
  assert.equal(initialView.canSubmitEvidence, false);
  assert.equal(initialView.cliAutoVerificationRequired, true);
  assert.equal(initialView.cliAutoVerificationCompleted, false);
  assert.equal(initialView.cliAutoVerificationNonVerifiedOutcomeReturned, false);
  assert.match(initialView.gateReason, /Browser Tool auto-verification/i);

  const cliRunning = startActionVerification(pending, {
    method: ACTION_VERIFICATION_METHOD.cli,
    verifier: "local-sheet-check",
    now,
  });
  const cliFailed = failActionVerification(cliRunning, {
    reason: "Local sheet export missing.",
    agentAssessment: "This was not the configured MCP verification path.",
    raw: { rows: 0 },
    now,
  });
  const cliFailedView = getActionEvidenceSubmissionView(cliFailed);
  assert.equal(cliFailedView.canSubmitEvidence, false);
  assert.equal(cliFailedView.cliAutoVerificationRequired, true);
  assert.equal(cliFailedView.cliAutoVerificationCompleted, true);
  assert.equal(cliFailedView.cliAutoVerificationNonVerifiedOutcomeReturned, true);
  assert.equal(cliFailedView.browserAutoVerificationRequired, false);
  assert.equal(cliFailedView.browserAutoVerificationCompleted, false);
  assert.equal(cliFailedView.browserAutoVerificationNonVerifiedOutcomeReturned, false);
  assert.match(cliFailedView.gateReason, /Browser Tool auto-verification/i);

  const blockedAfterCli = submitActionEvidence(cliFailed, {
    type: ACTION_EVIDENCE_TYPE.link,
    content: "https://example.com/outreach-tracker",
  }, {
    actionType: "outreach_tracker",
    now,
  });
  assert.equal(blockedAfterCli.status, ACTION_EVIDENCE_SUBMISSION_STATUS.blocked);
  assert.equal(blockedAfterCli.state, cliFailed);

  const browserPending = retryActionVerification(cliFailed, {
    reason: "Trying Browser Tool before requesting evidence.",
    nextMethod: ACTION_VERIFICATION_METHOD.browser,
    now,
  });
  const browserRunning = startActionVerification(browserPending, {
    method: ACTION_VERIFICATION_METHOD.browser,
    verifier: "browser-harness",
    now,
  });
  const browserUnsupported = failActionVerification(browserRunning, {
    reason: "Browser Tool verification is unsupported for this private tracker.",
    agentAssessment: "Fallback evidence can be requested now because Browser Tool cannot verify this action.",
    raw: { outcome: "unsupported", runnableCommand: "browser-harness -c '...'" },
    now,
  });

  const component = renderActionEvidenceSubmissionComponent({
    state: browserUnsupported,
    actionSpec: { action_type: "outreach_tracker" },
    now: new Date("2026-05-14T03:20:00.000Z"),
  });
  assert.equal(component.view.browserAutoVerificationRequired, true);
  assert.equal(component.view.browserAutoVerificationCompleted, true);
  assert.equal(component.view.browserAutoVerificationNonVerifiedOutcomeReturned, true);
  assert.equal(component.view.canSubmitEvidence, true);
  assert.equal(component.card.state, "ready");
  assert.equal(component.submitAction.enabled, true);

  const submitted = submitActionEvidence(browserUnsupported, {
    type: ACTION_EVIDENCE_TYPE.link,
    content: "https://example.com/outreach-tracker",
  }, {
    actionType: "outreach_tracker",
    verifier: "evidence-fallback",
    now,
  });
  assert.equal(submitted.status, ACTION_EVIDENCE_SUBMISSION_STATUS.submitted);
  assert.equal(submitted.state.currentAttempt.method, ACTION_VERIFICATION_METHOD.evidenceLink);
  assert.equal(submitted.state.currentAttempt.verifier, "evidence-fallback");
});

test("action evidence success marks submission accepted and preserves assessment", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({ dayId: 20, now });
  const submitted = submitActionEvidence(pending, {
    type: ACTION_EVIDENCE_TYPE.link,
    content: "https://example.com/outreach-tracker",
  }, {
    actionType: "url",
    now,
  });

  const accepted = acceptActionEvidence(submitted.state, {
    confidence: 0.91,
    agentAssessment: "The submitted tracker shows 10 personalized DMs and response columns.",
    raw: { matchedRows: 10 },
    now,
  });

  assert.equal(accepted.status, ACTION_EVIDENCE_SUBMISSION_STATUS.accepted);
  assert.equal(accepted.state.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(accepted.state.evidenceSubmission.validationStatus, "accepted");
  assert.equal(accepted.state.verificationResult.passed, true);
  assert.equal(accepted.state.verificationResult.confidence, 0.91);
  assert.match(getActionEvidenceSubmissionView(accepted.state).latestAssessment, /10 personalized DMs/);
});

test("action evidence failure marks submission rejected and can be retried with file evidence", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({ dayId: 21, now });
  const submitted = submitActionEvidence(pending, {
    type: ACTION_EVIDENCE_TYPE.link,
    content: "https://example.com/private-observation-note",
  }, {
    expectedEvidenceTypes: [ACTION_EVIDENCE_TYPE.link, ACTION_EVIDENCE_TYPE.file],
    now,
  });

  const rejected = rejectActionEvidence(submitted.state, {
    reason: "The URL requires authentication and cannot prove the observation.",
    agentAssessment: "Submit a transcript, note, or shareable recording excerpt instead.",
    raw: { authWall: true },
    now,
  });

  assert.equal(rejected.status, ACTION_EVIDENCE_SUBMISSION_STATUS.rejected);
  assert.equal(rejected.state.status, ACTION_VERIFICATION_STATUS.failed);
  assert.equal(rejected.state.evidenceSubmission.validationStatus, "rejected");
  assert.equal(rejected.state.verificationResult.passed, false);
  assert.match(getActionEvidenceSubmissionView(rejected.state).latestReason, /requires authentication/);

  const retryPending = retryActionVerification(rejected.state, {
    reason: "User attached local transcript evidence.",
    nextMethod: ACTION_VERIFICATION_METHOD.evidenceFile,
    now,
  });
  const fileSubmission = submitActionEvidence(retryPending, {
    type: ACTION_EVIDENCE_TYPE.file,
    content: "./evidence/day-21-observation.md",
  }, {
    actionType: "transcript",
    now,
  });

  assert.equal(fileSubmission.status, ACTION_EVIDENCE_SUBMISSION_STATUS.submitted);
  assert.equal(fileSubmission.state.status, ACTION_VERIFICATION_STATUS.running);
  assert.equal(fileSubmission.state.currentAttempt.method, ACTION_VERIFICATION_METHOD.evidenceFile);
  assert.equal(fileSubmission.state.evidenceSubmission.type, ACTION_EVIDENCE_TYPE.file);
});

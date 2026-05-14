import test from "node:test";
import assert from "node:assert/strict";

import {
  ACTION_DAY_VERIFICATION_STATE_SCHEMA_VERSION,
  ACTION_VERIFICATION_METHOD,
  ACTION_VERIFICATION_STATUS,
  createActionDayVerificationState,
  ensureActionDayVerificationState,
  failActionVerification,
  isActionVerificationFailed,
  isActionVerificationPassed,
  isActionVerificationPending,
  isActionVerificationRunning,
  passActionVerification,
  retryActionVerification,
  startActionVerification,
} from "../sidecar/action-day-verification-state.mjs";

function makeClock(start = "2026-05-14T12:00:00.000Z") {
  let next = new Date(start).getTime();
  return () => {
    const value = new Date(next);
    next += 1_000;
    return value;
  };
}

test("action verification covers pending, running, passed, failed, and retry transitions", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 9,
    actionId: "day-9-url-check",
    actionDescription: "Publish the first test landing page.",
    completionSignal: "A reachable public URL with the offer visible.",
    preferredMethods: [
      ACTION_VERIFICATION_METHOD.browser,
      ACTION_VERIFICATION_METHOD.evidenceLink,
    ],
    now,
  });

  assert.equal(pending.schemaVersion, ACTION_DAY_VERIFICATION_STATE_SCHEMA_VERSION);
  assert.equal(pending.status, ACTION_VERIFICATION_STATUS.pending);
  assert.equal(pending.createdAt, "2026-05-14T12:00:00.000Z");
  assert.equal(pending.dayId, 9);
  assert.equal(pending.attemptCount, 0);
  assert.equal(isActionVerificationPending(pending), true);

  const running = startActionVerification(pending, {
    method: ACTION_VERIFICATION_METHOD.browser,
    verifier: "browser-harness",
    evidenceSubmission: {
      type: "link",
      content: "https://example.com/agentic30-test",
      submittedAt: "2026-05-14T11:59:00.000Z",
    },
    metadata: { url: "https://example.com/agentic30-test" },
    now,
  });

  assert.equal(running.status, ACTION_VERIFICATION_STATUS.running);
  assert.equal(running.startedAt, "2026-05-14T12:00:01.000Z");
  assert.equal(running.attemptCount, 1);
  assert.equal(running.currentAttempt.method, ACTION_VERIFICATION_METHOD.browser);
  assert.equal(running.history.length, 1);
  assert.equal(running.evidenceSubmission.type, "link");
  assert.equal(isActionVerificationRunning(running), true);

  const passed = passActionVerification(running, {
    confidence: 0.92,
    agentAssessment: "Browser verification found the offer and CTA on the submitted URL.",
    raw: { statusCode: 200, matchedText: "Start" },
    now,
  });

  assert.equal(passed.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(passed.completedAt, "2026-05-14T12:00:02.000Z");
  assert.equal(passed.verificationResult.passed, true);
  assert.equal(passed.verificationResult.method, ACTION_VERIFICATION_METHOD.browser);
  assert.equal(passed.verificationResult.confidence, 0.92);
  assert.equal(passed.history[0].status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(isActionVerificationPassed(passed), true);

  const retryPending = retryActionVerification(passed, {
    reason: "User changed the URL and asked to verify the current version.",
    nextMethod: ACTION_VERIFICATION_METHOD.cli,
    now,
  });

  assert.equal(retryPending.status, ACTION_VERIFICATION_STATUS.pending);
  assert.equal(retryPending.retryCount, 1);
  assert.equal(retryPending.completedAt, null);
  assert.equal(retryPending.verificationResult, null);
  assert.equal(retryPending.preferredMethods[0], ACTION_VERIFICATION_METHOD.cli);
  assert.equal(retryPending.history.at(-1).status, "retry");

  const secondRunning = startActionVerification(retryPending, {
    method: ACTION_VERIFICATION_METHOD.cli,
    verifier: "curl",
    now,
  });
  const failed = failActionVerification(secondRunning, {
    reason: "HTTP 404",
    agentAssessment: "The URL no longer resolves, so the action needs new evidence.",
    raw: { statusCode: 404 },
    now,
  });

  assert.equal(failed.status, ACTION_VERIFICATION_STATUS.failed);
  assert.equal(failed.attemptCount, 2);
  assert.equal(failed.retryCount, 1);
  assert.equal(failed.verificationResult.passed, false);
  assert.equal(failed.verificationResult.reason, "HTTP 404");
  assert.equal(failed.history.at(-1).status, ACTION_VERIFICATION_STATUS.failed);
  assert.equal(isActionVerificationFailed(failed), true);

  assert.throws(
    () => startActionVerification(failed, {
      method: ACTION_VERIFICATION_METHOD.browser,
      now,
    }),
    /retry first/,
  );

  const retryAfterFailure = retryActionVerification(failed, {
    reason: "Submitted replacement evidence after the 404.",
    nextMethod: ACTION_VERIFICATION_METHOD.evidenceLink,
    evidenceSubmission: {
      type: "link",
      content: "https://example.com/agentic30-fixed",
      submittedAt: "2026-05-14T12:00:10.000Z",
    },
    now,
  });

  assert.equal(retryAfterFailure.status, ACTION_VERIFICATION_STATUS.pending);
  assert.equal(retryAfterFailure.retryCount, 2);
  assert.equal(retryAfterFailure.verificationResult, null);
  assert.equal(retryAfterFailure.evidenceSubmission.content, "https://example.com/agentic30-fixed");
  assert.equal(retryAfterFailure.preferredMethods[0], ACTION_VERIFICATION_METHOD.evidenceLink);
});

test("action verification rejects invalid transition order", () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({ dayId: 12, now });

  assert.throws(
    () => passActionVerification(pending, { now }),
    /Cannot complete action verification from pending/,
  );

  const running = startActionVerification(pending, {
    method: ACTION_VERIFICATION_METHOD.mcp,
    now,
  });

  assert.throws(
    () => startActionVerification(running, { method: ACTION_VERIFICATION_METHOD.cli, now }),
    /another attempt is running/,
  );
});

test("ensureActionDayVerificationState normalizes persisted state", () => {
  const restored = ensureActionDayVerificationState({
    schemaVersion: 999,
    dayId: 31,
    status: "unknown",
    preferredMethods: ["browser", "not-real"],
    attemptCount: -4,
    history: [{ attemptNumber: 1, method: "browser", status: "passed" }],
  }, { now: makeClock() });

  assert.equal(restored.schemaVersion, ACTION_DAY_VERIFICATION_STATE_SCHEMA_VERSION);
  assert.equal(restored.dayId, null);
  assert.equal(restored.status, ACTION_VERIFICATION_STATUS.pending);
  assert.deepEqual(restored.preferredMethods, [
    ACTION_VERIFICATION_METHOD.browser,
    ACTION_VERIFICATION_METHOD.manual,
  ]);
  assert.equal(restored.attemptCount, 0);
  assert.equal(restored.history[0].method, ACTION_VERIFICATION_METHOD.browser);
});

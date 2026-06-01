import assert from "node:assert/strict";
import test from "node:test";

import { runWithSoftTimeout } from "../sidecar/frontier-soft-timeout.mjs";

test("runWithSoftTimeout resolves null and aborts when the operation hangs", async () => {
  const abortController = new AbortController();
  let didTimeout = false;
  const startedAt = Date.now();

  const result = await runWithSoftTimeout({
    timeoutMs: 15,
    abortController,
    onTimeout: () => {
      didTimeout = true;
    },
    operation: () => new Promise(() => {}),
  });

  assert.equal(result, null);
  assert.equal(didTimeout, true);
  assert.equal(abortController.signal.aborted, true);
  assert.ok(Date.now() - startedAt < 500);
});

test("runWithSoftTimeout keeps late provider rejection handled after timeout", async () => {
  const abortController = new AbortController();
  let rejectLate;
  let lateError = null;

  const result = await runWithSoftTimeout({
    timeoutMs: 15,
    abortController,
    onLateError: (error) => {
      lateError = error;
    },
    operation: () =>
      new Promise((_, reject) => {
        rejectLate = reject;
      }),
  });

  assert.equal(result, null);
  rejectLate(new Error("late provider failure"));
  await new Promise((resolve) => setImmediate(resolve));

  assert.equal(lateError?.message, "late provider failure");
});

test("runWithSoftTimeout returns successful operation results before timeout", async () => {
  const abortController = new AbortController();
  let didTimeout = false;

  const result = await runWithSoftTimeout({
    timeoutMs: 100,
    abortController,
    onTimeout: () => {
      didTimeout = true;
    },
    operation: async () => "frontier-result",
  });

  assert.equal(result, "frontier-result");
  assert.equal(didTimeout, false);
  assert.equal(abortController.signal.aborted, false);
});

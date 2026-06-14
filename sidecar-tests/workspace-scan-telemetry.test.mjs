import { test } from "node:test";
import assert from "node:assert/strict";

import {
  deriveScanAbortCause,
  workspaceScanBlockedLogLevel,
} from "../sidecar/workspace-scan-telemetry.mjs";

test("workspaceScanBlockedLogLevel downgrades recoverable scan blocks to warnings", () => {
  assert.equal(workspaceScanBlockedLogLevel("unavailable"), "warn");
  assert.equal(workspaceScanBlockedLogLevel("usage_limit"), "warn");
  assert.equal(workspaceScanBlockedLogLevel(" Usage_Limit "), "warn");
});

test("workspaceScanBlockedLogLevel keeps real scan faults at error severity", () => {
  assert.equal(workspaceScanBlockedLogLevel("error"), "error");
  assert.equal(workspaceScanBlockedLogLevel(""), "error");
  assert.equal(workspaceScanBlockedLogLevel(null), "error");
});

test("deriveScanAbortCause distinguishes soft timeout, hard deadline, and external aborts", () => {
  assert.equal(deriveScanAbortCause({ softTimeoutFired: true }), "soft_timeout");
  assert.equal(deriveScanAbortCause({ hardDeadlineFired: true }), "hard_deadline");
  // Hard deadline wins when both fired: the run ignored the soft abort.
  assert.equal(
    deriveScanAbortCause({ softTimeoutFired: true, hardDeadlineFired: true }),
    "hard_deadline",
  );
  // SDK/network-level abort that fired with neither scan timer.
  assert.equal(deriveScanAbortCause({ isAbortLike: true }), "external");
});

test("deriveScanAbortCause returns null when the failure was not an abort", () => {
  assert.equal(deriveScanAbortCause(), null);
  assert.equal(deriveScanAbortCause({}), null);
  assert.equal(deriveScanAbortCause({ isAbortLike: false }), null);
});

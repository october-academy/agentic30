import test from "node:test";
import assert from "node:assert/strict";

import { workspaceScanBlockedLogLevel } from "../sidecar/workspace-scan-telemetry.mjs";

test("workspaceScanBlockedLogLevel downgrades recoverable scan blocks to warnings", () => {
  assert.equal(workspaceScanBlockedLogLevel("unavailable"), "warn");
  assert.equal(workspaceScanBlockedLogLevel("usage_limit"), "warn");
});

test("workspaceScanBlockedLogLevel keeps real scan faults at error severity", () => {
  assert.equal(workspaceScanBlockedLogLevel("error"), "error");
  assert.equal(workspaceScanBlockedLogLevel(""), "error");
  assert.equal(workspaceScanBlockedLogLevel(null), "error");
});

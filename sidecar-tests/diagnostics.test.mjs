import test from "node:test";
import assert from "node:assert/strict";
import { buildDiagnosticsSnapshot } from "../sidecar/diagnostics.mjs";

test("buildDiagnosticsSnapshot redacts credential-shaped fields", () => {
  const snapshot = buildDiagnosticsSnapshot({
    appSupportPath: "/Users/tester/Library/Application Support/agentic30",
    workspaceRoot: "/tmp/workspace",
    environment: {
      claude: {
        available: true,
        source: "api-key",
        apiKey: "secret",
      },
    },
    preflight: {
      status: "ok",
      checks: [
        {
          id: "token-check",
          title: "Token check",
          status: "ok",
          message: "contains token",
          token: "secret",
        },
      ],
    },
    sessions: [
      { id: "session-1", status: "idle" },
      { id: "session-2", status: "error" },
    ],
    activeRuns: new Map([["session-3", {}]]),
    sessionStoreSchemaVersion: 1,
    sessionStoreWarnings: [
      {
        type: "session_store_corrupt",
        message: "Unexpected token",
        quarantinePath: "/tmp/sessions.json.corrupt",
      },
    ],
    now: () => new Date("2026-04-15T01:02:03.000Z"),
    processInfo: {
      pid: 123,
      platform: "darwin",
      arch: "arm64",
      version: "v22.0.0",
    },
  });

  assert.equal(snapshot.generatedAt, "2026-04-15T01:02:03.000Z");
  assert.equal(snapshot.sessions.total, 2);
  assert.equal(snapshot.sessions.activeRuns, 1);
  assert.equal(snapshot.sessions.statuses.idle, 1);
  assert.equal(snapshot.sessions.statuses.error, 1);
  assert.equal(snapshot.environment.claude.apiKey, "[redacted]");
  assert.equal(snapshot.preflight.checks[0].token, "[redacted]");
  assert.equal(snapshot.storage.sessionStoreWarnings[0].type, "session_store_corrupt");
});

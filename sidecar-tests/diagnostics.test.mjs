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
        sdk: {
          available: true,
          packageName: "@anthropic-ai/claude-agent-sdk",
          version: "0.2.87",
          entrypointPath: "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
        },
      },
      codex: {
        available: true,
        source: "local-session",
        sdk: {
          available: true,
          packageName: "@openai/codex-sdk",
          version: "0.125.0",
          entrypointPath: "/repo/node_modules/@openai/codex/vendor/codex",
        },
      },
      gemini: {
        available: true,
        source: "api-key",
        geminiApiKey: "gemini-secret",
        vertexToken: "vertex-secret",
        sdk: {
          available: true,
          packageName: "@google/gemini-cli",
          version: "0.42.0",
          entrypointPath: "/repo/node_modules/@google/gemini-cli/bundle/gemini.js",
        },
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
    executionOs: {
      pilotReadiness: { status: "blocked" },
      proofLedger: {
        events: [
          {
            type: "dm_ask",
            metadata: {
              authorization: "Bearer secret",
            },
          },
        ],
      },
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
  assert.equal(snapshot.environment.claude.sdk.available, true);
  assert.equal(snapshot.environment.claude.sdk.packageName, "@anthropic-ai/claude-agent-sdk");
  assert.equal(snapshot.environment.codex.sdk.packageName, "@openai/codex-sdk");
  assert.equal(snapshot.environment.gemini.geminiApiKey, "[redacted]");
  assert.equal(snapshot.environment.gemini.vertexToken, "[redacted]");
  assert.equal(snapshot.environment.gemini.sdk.packageName, "@google/gemini-cli");
  assert.equal(snapshot.preflight.checks[0].token, "[redacted]");
  assert.equal(snapshot.redactionSafe, true);
  assert.equal(snapshot.executionOs.pilotReadiness.status, "blocked");
  assert.equal(snapshot.executionOs.proofLedger.events[0].metadata.authorization, "[redacted]");
  assert.equal(snapshot.storage.sessionStoreWarnings[0].type, "session_store_corrupt");
});

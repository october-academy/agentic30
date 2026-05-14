import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

import {
  ACTION_VERIFICATION_METHOD,
  ACTION_VERIFICATION_STATUS,
  createActionDayVerificationState,
} from "../sidecar/action-day-verification-state.mjs";
import {
  ACTION_AUTO_VERIFICATION_SOURCE_STATUS,
  ACTION_CLI_VERIFICATION_OUTCOME,
  buildActionSufficiencyCriteriaDecision,
  loadConfiguredCliVerificationCommands,
  executeConfiguredCliVerificationCommand,
  interpretCliVerificationOutcome,
  normalizeCliVerificationResult,
  normalizeActionVerificationEvidenceResult,
  normalizeVerificationRequests,
  shouldRequestEvidenceAfterAutoVerification,
  ensureGoogleWorkspaceVerificationBeforeEvidenceFallback,
  resolveActionAutoVerificationPlan,
  runActionAutoVerification,
  verifyGoogleDocsEvidenceSource,
  verifyGoogleSheetsEvidenceSource,
} from "../sidecar/action-day-auto-verification.mjs";
import {
  parseActionSufficiencyGuideline,
} from "../sidecar/action-sufficiency-guidelines.mjs";

function readFixture(relativePath) {
  return readFileSync(new URL(relativePath, import.meta.url), "utf8");
}

function makeClock(start = "2026-05-14T12:00:00.000Z") {
  let next = new Date(start).getTime();
  return () => {
    const value = new Date(next);
    next += 1_000;
    return value;
  };
}

test("action auto-verification resolves configured MCP tools and skips unconfigured tools", () => {
  const plan = resolveActionAutoVerificationPlan({
    actionSpec: {
      verification_method: {
        type: "mcp",
        tools: ["google_docs", "google_sheets", "unknown_crm"],
      },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node", args: ["sidecar/mcp-server.mjs"] },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_docs_read"],
    },
  });

  assert.deepEqual(plan.preferredMethods, [
    ACTION_VERIFICATION_METHOD.googleDocs,
  ]);
  assert.deepEqual(plan.resolved.map((item) => item.verifier), [
    "agentic30_sidecar.gws_docs_read",
  ]);
  assert.equal(plan.resolved[0].server, "agentic30_sidecar");
  assert.equal(plan.resolved[0].tool, "gws_docs_read");
  assert.deepEqual(
    plan.skipped.map((item) => [item.id, item.reason]),
    [
      ["google_sheets", "mcp_tool_not_configured"],
      ["unknown_crm", "unknown_mcp_verification_tool"],
    ],
  );
});

test("action auto-verification skips MCP tools when their server is not configured", () => {
  const plan = resolveActionAutoVerificationPlan({
    actionSpec: {
      verification_method: ["google_docs", "browser"],
    },
    configuredMcpServers: {},
  });

  assert.deepEqual(plan.preferredMethods, [
    ACTION_VERIFICATION_METHOD.browser,
  ]);
  assert.deepEqual(plan.resolved.map((item) => item.method), [
    ACTION_VERIFICATION_METHOD.browser,
  ]);
  assert.deepEqual(plan.skipped.map((item) => item.reason), [
    "mcp_server_not_configured",
  ]);
});

test("action auto-verification accepts server-level MCP configuration when tool list is absent", () => {
  const plan = resolveActionAutoVerificationPlan({
    actionSpec: {
      verificationMethod: [
        "gws_docs_read",
        "gws_sheets_read",
        { type: "cli", id: "local-check", verifier: "npm test" },
      ],
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node" },
    },
  });

  assert.deepEqual(plan.preferredMethods, [
    ACTION_VERIFICATION_METHOD.googleDocs,
    ACTION_VERIFICATION_METHOD.googleSheets,
    ACTION_VERIFICATION_METHOD.cli,
  ]);
  assert.deepEqual(plan.resolved.map((item) => item.verifier), [
    "agentic30_sidecar.gws_docs_read",
    "agentic30_sidecar.gws_sheets_read",
    "npm test",
  ]);
  assert.deepEqual(plan.skipped, []);
});

test("action auto-verification excludes disabled automated sources from evidence gating", () => {
  const plan = resolveActionAutoVerificationPlan({
    actionSpec: {
      verification_method: [
        { type: "browser", id: "public-proof", enabled: false },
        { type: "cli", target: "local-proof" },
        "google_docs",
        "google_sheets",
      ],
    },
    configuredCliCommands: {
      "local-proof": {
        enabled: false,
        command: "test",
        args: ["-f", "proof.md"],
      },
    },
    configuredMcpServers: {
      agentic30_sidecar: { enabled: true, command: "node" },
    },
    configuredMcpTools: {
      agentic30_sidecar: {
        gws_docs_read: { enabled: false },
        gws_sheets_read: { enabled: true },
      },
    },
  });

  assert.deepEqual(plan.preferredMethods, [
    ACTION_VERIFICATION_METHOD.googleSheets,
  ]);
  assert.deepEqual(plan.resolved.map((item) => [item.type, item.tool || item.id]), [
    ["mcp", "gws_sheets_read"],
  ]);
  assert.deepEqual(
    plan.skipped.map((item) => [item.id, item.reason, item.excludedFromEvidenceGatingDecision]),
    [
      ["public-proof", "verification_source_disabled", true],
      ["local-proof", "cli_command_disabled", true],
      ["google_docs", "mcp_tool_disabled", true],
    ],
  );
  assert.equal(plan.skipped[0].excluded_from_evidence_gating_decision, true);
  assert.equal(plan.skipped[0].evidenceGatingDecision, "excluded");
  assert.equal(plan.skipped[0].evidence_gating_decision, "excluded");
});

test("action auto-verification marks disabled MCP servers as evidence-gating exclusions", () => {
  const plan = resolveActionAutoVerificationPlan({
    actionSpec: {
      verification_method: ["google_docs", "browser"],
    },
    configuredMcpServers: {
      agentic30_sidecar: { enabled: false, command: "node" },
    },
  });

  assert.deepEqual(plan.preferredMethods, [
    ACTION_VERIFICATION_METHOD.browser,
  ]);
  assert.deepEqual(plan.resolved.map((item) => item.type), ["browser"]);
  assert.deepEqual(
    plan.skipped.map((item) => [item.id, item.reason, item.excludedFromEvidenceGatingDecision]),
    [["google_docs", "mcp_server_disabled", true]],
  );
});

test("loads and validates configured CLI verification commands for a target", () => {
  const loaded = loadConfiguredCliVerificationCommands({
    "landing-page-live": {
      command: "curl",
      args: ["--fail", "--silent", "{{url}}"],
      cwd: "/tmp",
      timeoutMs: 5000,
      env: { AGENTIC30_CHECK: "1", IGNORED_NUMBER: 1 },
      metadata: { completionSignal: "URL returns 200" },
    },
    malformed: {
      command: "curl --fail",
      args: ["{{url}}"],
    },
  }, {
    target: "landing-page-live",
  });

  assert.equal(loaded.commands.length, 1);
  assert.equal(loaded.commands[0].id, "landing-page-live");
  assert.equal(loaded.commands[0].command, "curl");
  assert.deepEqual(loaded.commands[0].args, ["--fail", "--silent", "{{url}}"]);
  assert.equal(loaded.commands[0].cwd, "/tmp");
  assert.equal(loaded.commands[0].timeoutMs, 5000);
  assert.deepEqual(loaded.commands[0].env, { AGENTIC30_CHECK: "1" });
  assert.deepEqual(loaded.skipped, []);
});

test("disabled CLI verification commands load as evidence-gating exclusions", () => {
  const loaded = loadConfiguredCliVerificationCommands({
    "local-proof": {
      enabled: false,
      command: "test",
      args: ["-f", "proof.md"],
    },
  }, {
    target: "local-proof",
  });

  assert.deepEqual(loaded.commands, []);
  assert.equal(loaded.skipped[0].id, "local-proof");
  assert.equal(loaded.skipped[0].reason, "cli_command_disabled");
  assert.equal(loaded.skipped[0].excludedFromEvidenceGatingDecision, true);
});

test("configured CLI verification rejects malformed command definitions", () => {
  const loaded = loadConfiguredCliVerificationCommands([
    { id: "shell-string", command: "npm test", args: [] },
    { id: "bad-args", command: "npm", args: "test" },
    { id: "bad-timeout", command: "node", args: ["--version"], timeoutMs: 0 },
  ]);

  assert.deepEqual(
    loaded.skipped.map((item) => [item.id, item.reason]),
    [
      ["shell-string", "cli_command_must_be_executable_only"],
      ["bad-args", "cli_args_must_be_string_array"],
      ["bad-timeout", "cli_timeout_must_be_positive"],
    ],
  );
  assert.deepEqual(loaded.commands, []);
});

test("action auto-verification resolves configured CLI commands and skips missing targets", () => {
  const plan = resolveActionAutoVerificationPlan({
    actionSpec: {
      verification_method: [
        { type: "cli", target: "landing-page-live" },
        { type: "cli", target: "missing-command" },
      ],
    },
    configuredCliCommands: {
      "landing-page-live": {
        command: "curl",
        args: ["--fail", "{{url}}"],
        timeoutMs: 8000,
      },
    },
  });

  assert.deepEqual(plan.preferredMethods, [
    ACTION_VERIFICATION_METHOD.cli,
  ]);
  assert.equal(plan.resolved.length, 1);
  assert.equal(plan.resolved[0].id, "landing-page-live");
  assert.equal(plan.resolved[0].verifier, "curl --fail {{url}}");
  assert.equal(plan.resolved[0].command, "curl");
  assert.deepEqual(plan.resolved[0].args, ["--fail", "{{url}}"]);
  assert.equal(plan.resolved[0].timeoutMs, 8000);
  assert.deepEqual(
    plan.skipped.map((item) => [item.id, item.reason]),
    [["missing-command", "cli_command_not_configured"]],
  );
});

test("disabled automated sources are not executed and do not unlock evidence fallback", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 14,
    actionId: "day-14-disabled-auto",
    actionDescription: "Publish an action proof.",
    completionSignal: "Configured source confirms the proof.",
    preferredMethods: [
      ACTION_VERIFICATION_METHOD.cli,
      ACTION_VERIFICATION_METHOD.browser,
    ],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Configured source confirms the proof.",
      verification_method: [
        { type: "cli", target: "local-proof", enabled: false },
        { type: "browser", id: "public-proof", enabled: false },
      ],
    },
    configuredCliCommands: {
      "local-proof": {
        command: process.execPath,
        args: ["-e", "throw new Error('disabled CLI should not execute');"],
      },
    },
    runCliCommand: async () => {
      throw new Error("disabled CLI should not execute");
    },
    fetchBrowserPageState: async () => {
      throw new Error("disabled Browser Tool should not execute");
    },
    now,
  });

  assert.equal(result.passed, false);
  assert.equal(result.shouldRequestUserEvidence, false);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.pending);
  assert.deepEqual(result.attempts, []);
  assert.deepEqual(
    result.plan.skipped.map((item) => [item.id, item.reason, item.excludedFromEvidenceGatingDecision]),
    [
      ["local-proof", "verification_source_disabled", true],
      ["public-proof", "verification_source_disabled", true],
    ],
  );
  assert.equal(result.aggregate.enabledSourceCount, 0);
  assert.equal(result.aggregate.anyEnabledSourceSucceeded, false);
});

test("verification result aggregation classifies enabled sources and exposes any-source success", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 15,
    actionId: "day-15-aggregate",
    actionDescription: "Publish a proof URL and record it.",
    completionSignal: "At least one enabled verifier confirms the proof.",
    preferredMethods: [
      ACTION_VERIFICATION_METHOD.googleDocs,
      ACTION_VERIFICATION_METHOD.googleSheets,
    ],
    now,
  });
  const calls = [];

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "At least one enabled verifier confirms the proof.",
      verification_method: {
        type: "mcp",
        tools: ["unknown_crm", "google_docs", "google_sheets"],
      },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node" },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_docs_read", "gws_sheets_read"],
    },
    callMcpTool: async (call) => {
      calls.push(call.tool);
      if (call.tool === "gws_docs_read") {
        return {
          structuredContent: {
            passed: false,
            reason: "Doc did not include the proof yet.",
          },
        };
      }
      return {
        structuredContent: {
          passed: true,
          confidence: 0.9,
          agentAssessment: "Sheet includes the proof row.",
        },
      };
    },
    now,
  });

  assert.deepEqual(calls, ["gws_docs_read", "gws_sheets_read"]);
  assert.equal(result.passed, true);
  assert.equal(result.anyEnabledSourceSucceeded, true);
  assert.equal(result.aggregate.anyEnabledSourceSucceeded, true);
  assert.equal(result.aggregate.enabledSourceCount, 3);
  assert.deepEqual(result.aggregate.counts, {
    successful: 1,
    failed: 1,
    unavailable: 1,
  });
  assert.deepEqual(
    result.aggregate.sources.map((source) => [source.id, source.status, source.reason]),
    [
      ["google_docs", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.failed, "Doc did not include the proof yet."],
      ["google_sheets", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.successful, ""],
      ["unknown_crm", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable, "unknown_mcp_verification_tool"],
    ],
  );
});

test("verification result aggregation treats unattempted enabled sources as unavailable after success", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 16,
    actionId: "day-16-short-circuit",
    actionDescription: "Confirm a local artifact.",
    completionSignal: "CLI confirms the artifact exists.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.cli, ACTION_VERIFICATION_METHOD.browser],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "CLI confirms the artifact exists.",
      verification_method: [
        { type: "cli", target: "local-proof" },
        { type: "browser", id: "public-proof" },
      ],
      verification_arguments: {
        url: "https://example.test/proof",
        expectedText: "Proof is live",
      },
    },
    configuredCliCommands: {
      "local-proof": {
        command: process.execPath,
        args: ["-e", "console.log(JSON.stringify({ outcome: 'verified' }));"],
      },
    },
    fetchBrowserPageState: async () => {
      throw new Error("browser source should not run after CLI success");
    },
    now,
  });

  assert.equal(result.passed, true);
  assert.deepEqual(
    result.aggregate.sources.map((source) => [source.id, source.status, source.reason]),
    [
      ["local-proof", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.successful, ""],
      ["public-proof", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable, "not_attempted"],
      ["google_docs", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable, "mcp_server_not_configured"],
      ["google_sheets", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable, "mcp_server_not_configured"],
    ],
  );
  assert.equal(result.aggregate.anyEnabledSourceSucceeded, true);
});

test("executes configured CLI verification commands and records stdout, stderr, and exit code", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 9,
    actionId: "day-9-url-live",
    actionDescription: "Publish the landing page URL.",
    completionSignal: "CLI confirms the URL is reachable.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.cli],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "CLI confirms the URL is reachable.",
      verification_method: { type: "cli", target: "url-live" },
      verification_arguments: {
        url: "https://example.test/launch",
      },
    },
    configuredCliCommands: {
      "url-live": {
        command: process.execPath,
        args: [
          "-e",
          "console.log(process.argv[1]); console.error('checked stderr');",
          "{{url}}",
        ],
      },
    },
    now,
  });

  assert.equal(result.passed, true);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.cli);
  assert.equal(result.state.verificationResult.outcome, ACTION_CLI_VERIFICATION_OUTCOME.verified);
  assert.equal(result.state.verificationResult.raw.exitCode, 0);
  assert.equal(result.state.verificationResult.raw.stdout, "https://example.test/launch");
  assert.equal(result.state.verificationResult.raw.stderr, "checked stderr");
  assert.equal(result.state.verificationResult.raw.timedOut, false);
  assert.equal(result.state.verificationResult.raw.error, "");
});

test("configured CLI verification failure captures non-zero exit code and output", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 10,
    actionId: "day-10-local-check",
    actionDescription: "Run the local proof command.",
    completionSignal: "Command exits cleanly.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.cli],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Command exits cleanly.",
      verification_method: { type: "cli", target: "local-proof" },
    },
    configuredCliCommands: {
      "local-proof": {
        command: process.execPath,
        args: ["-e", "console.log('partial proof'); console.error('missing artifact'); process.exit(7);"],
      },
    },
    now,
  });

  assert.equal(result.passed, false);
  assert.equal(result.shouldRequestUserEvidence, true);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.failed);
  assert.equal(result.state.verificationResult.outcome, ACTION_CLI_VERIFICATION_OUTCOME.failed);
  assert.equal(result.state.verificationResult.raw.exitCode, 7);
  assert.equal(result.state.verificationResult.raw.stdout, "partial proof");
  assert.equal(result.state.verificationResult.raw.stderr, "missing artifact");
  assert.equal(result.state.verificationResult.raw.timedOut, false);
  assert.equal(result.state.verificationResult.raw.error, "");
  assert.match(result.state.verificationResult.reason, /missing artifact/);
});

test("configured CLI verification asks for user evidence only when CLI does not verify", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 11,
    actionId: "day-11-cli-fallback",
    actionDescription: "Publish a local proof artifact.",
    completionSignal: "CLI confirms the artifact exists.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.cli],
    now,
  });

  const inconclusive = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "CLI confirms the artifact exists.",
      verification_method: { type: "cli", target: "local-proof" },
    },
    configuredCliCommands: {
      "local-proof": {
        command: process.execPath,
        args: ["-e", "console.log(JSON.stringify({ outcome: 'inconclusive', reason: 'workspace auth required' }));"],
      },
    },
    now,
  });

  assert.equal(inconclusive.passed, false);
  assert.equal(inconclusive.shouldRequestUserEvidence, true);
  assert.equal(inconclusive.state.verificationResult.outcome, ACTION_CLI_VERIFICATION_OUTCOME.inconclusive);
  assert.match(inconclusive.state.verificationResult.reason, /workspace auth/);

  const verified = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "CLI confirms the artifact exists.",
      verification_method: { type: "cli", target: "local-proof" },
    },
    configuredCliCommands: {
      "local-proof": {
        command: process.execPath,
        args: ["-e", "console.log(JSON.stringify({ outcome: 'verified' }));"],
      },
    },
    now,
  });

  assert.equal(verified.passed, true);
  assert.equal(verified.shouldRequestUserEvidence, false);
  assert.equal(verified.state.verificationResult.outcome, ACTION_CLI_VERIFICATION_OUTCOME.verified);
});

test("action auto-verification invokes Browser Tool after failed CLI before requesting user evidence", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 12,
    actionId: "day-12-public-proof",
    actionDescription: "Publish a public proof page.",
    completionSignal: "Public page contains the launch CTA.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.cli],
    now,
  });
  const calls = [];

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Public page contains the launch CTA.",
      verification_method: { type: "cli", target: "url-live" },
      verification_arguments: {
        url: "https://example.test/day-12-proof",
        expectedText: "Join the launch",
      },
    },
    configuredCliCommands: {
      "url-live": {
        command: process.execPath,
        args: ["-e", "process.exit(7);"],
      },
    },
    runCliCommand: async () => {
      calls.push("cli");
      return {
        exitCode: 7,
        stdout: "",
        stderr: "local verifier could not confirm the page",
      };
    },
    fetchBrowserPageState: async ({ command }) => {
      calls.push("browser");
      assert.match(command, /browser-harness -c/);
      assert.match(command, /new_tab/);
      return {
        url: "https://example.test/day-12-proof",
        title: "Proof",
        text: "Draft page without final CTA.",
      };
    },
    now,
  });

  assert.deepEqual(calls, ["cli", "browser"]);
  assert.deepEqual(result.plan.resolved.map((item) => [item.type, item.id]), [
    ["cli", "url-live"],
    ["browser", "browser-before-evidence"],
  ]);
  assert.equal(result.passed, false);
  assert.equal(result.shouldRequestUserEvidence, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[0].verifier.type, "cli");
  assert.equal(result.attempts[1].verifier.type, "browser");
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.browser);
  assert.match(result.state.verificationResult.raw.runnableCommand, /browser-harness -c/);
});

test("action auto-verification checks Google Docs and Sheets before fallback evidence", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 13,
    actionId: "day-13-proof",
    actionDescription: "Publish proof and record it in the workspace log.",
    completionSignal: "A workspace Doc or Sheet contains the published proof URL.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.cli],
    now,
  });
  const calls = [];

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "A workspace Doc or Sheet contains the published proof URL.",
      verification_method: { type: "cli", target: "url-live" },
      verification_arguments: {
        url: "https://example.test/day-13-proof",
        expectedText: "published proof URL",
      },
    },
    configuredCliCommands: {
      "url-live": {
        command: process.execPath,
        args: ["-e", "process.exit(7);"],
      },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node", args: ["sidecar/mcp-server.mjs"] },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_docs_read", "gws_sheets_read"],
    },
    runCliCommand: async () => {
      calls.push("cli");
      return {
        exitCode: 7,
        stderr: "local URL check could not confirm the proof",
      };
    },
    callMcpTool: async (call) => {
      calls.push(call.tool);
      assert.equal(call.server, "agentic30_sidecar");
      assert.equal(call.arguments.url, "https://example.test/day-13-proof");
      assert.equal(call.arguments.actionSpec.completionSignal, "A workspace Doc or Sheet contains the published proof URL.");
      return {
        structuredContent: {
          passed: false,
          reason: `${call.tool} did not find the proof URL yet.`,
          agentAssessment: "Google Workspace auto-verification ran before manual evidence fallback.",
        },
      };
    },
    fetchBrowserPageState: async ({ command }) => {
      calls.push("browser");
      assert.match(command, /browser-harness -c/);
      return {
        url: "https://example.test/day-13-proof",
        title: "Proof",
        text: "Draft page without the expected proof text.",
      };
    },
    now,
  });

  assert.deepEqual(calls, ["cli", "gws_docs_read", "gws_sheets_read", "browser"]);
  assert.deepEqual(result.plan.resolved.map((item) => [item.type, item.tool || item.id]), [
    ["cli", "url-live"],
    ["mcp", "gws_docs_read"],
    ["mcp", "gws_sheets_read"],
    ["browser", "browser-before-evidence"],
  ]);
  assert.equal(result.passed, false);
  assert.equal(result.shouldRequestUserEvidence, true);
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.browser);
});

test("action auto-verification suppresses evidence request when an enabled automated source succeeds", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 13,
    actionId: "day-13-proof",
    actionDescription: "Publish proof and record it in the workspace log.",
    completionSignal: "A workspace Doc or Sheet contains the published proof URL.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.cli],
    now,
  });
  const calls = [];

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "A workspace Doc or Sheet contains the published proof URL.",
      verification_method: { type: "cli", target: "url-live" },
      verification_arguments: {
        url: "https://example.test/day-13-proof",
        expectedText: "published proof URL",
      },
    },
    configuredCliCommands: {
      "url-live": {
        command: process.execPath,
        args: ["-e", "process.exit(7);"],
      },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node", args: ["sidecar/mcp-server.mjs"] },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_docs_read", "gws_sheets_read"],
    },
    runCliCommand: async () => {
      calls.push("cli");
      return {
        exitCode: 7,
        stderr: "local URL check could not confirm the proof",
      };
    },
    callMcpTool: async (call) => {
      calls.push(call.tool);
      if (call.tool === "gws_docs_read") {
        return {
          structuredContent: {
            passed: false,
            reason: "Doc did not find the proof URL yet.",
          },
        };
      }
      return {
        structuredContent: {
          passed: true,
          confidence: 0.92,
          agentAssessment: "Sheet contains the proof URL and published status.",
        },
      };
    },
    fetchBrowserPageState: async () => {
      throw new Error("browser fallback should not run after an enabled source succeeds");
    },
    now,
  });

  assert.deepEqual(calls, ["cli", "gws_docs_read", "gws_sheets_read"]);
  assert.equal(result.passed, true);
  assert.equal(result.anyEnabledSourceSucceeded, true);
  assert.equal(result.aggregate.anyEnabledSourceSucceeded, true);
  assert.equal(result.shouldRequestUserEvidence, false);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.googleSheets);
  assert.deepEqual(
    result.aggregate.sources.map((source) => [source.id, source.status]),
    [
      ["url-live", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.failed],
      ["google_docs", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.failed],
      ["google_sheets", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.successful],
      ["browser-before-evidence", ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable],
    ],
  );
});

test("Google Workspace fallback orchestration inserts Docs and Sheets before Browser Tool", () => {
  const basePlan = {
    preferredMethods: [ACTION_VERIFICATION_METHOD.cli, ACTION_VERIFICATION_METHOD.browser],
    resolved: [
      {
        id: "url-live",
        type: "cli",
        method: ACTION_VERIFICATION_METHOD.cli,
        verifier: "curl",
      },
      {
        id: "public-proof",
        type: "browser",
        method: ACTION_VERIFICATION_METHOD.browser,
        verifier: "browser-harness",
      },
    ],
    skipped: [],
  };

  const plan = ensureGoogleWorkspaceVerificationBeforeEvidenceFallback(basePlan, {
    configuredMcpServers: {
      agentic30_sidecar: { command: "node" },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_docs_read", "gws_sheets_read"],
    },
  });

  assert.deepEqual(plan.resolved.map((item) => [item.type, item.tool || item.id]), [
    ["cli", "url-live"],
    ["mcp", "gws_docs_read"],
    ["mcp", "gws_sheets_read"],
    ["browser", "public-proof"],
  ]);
  assert.deepEqual(plan.preferredMethods, [
    ACTION_VERIFICATION_METHOD.cli,
    ACTION_VERIFICATION_METHOD.browser,
    ACTION_VERIFICATION_METHOD.googleDocs,
    ACTION_VERIFICATION_METHOD.googleSheets,
  ]);
});

test("action auto-verification requests user evidence on unsupported Browser Tool with runnable fallback command", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 12,
    actionId: "day-12-public-proof",
    actionDescription: "Publish a public proof page.",
    completionSignal: "Public page contains the launch CTA.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.cli],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Public page contains the launch CTA.",
      verification_method: { type: "cli", target: "url-live" },
      verification_arguments: {
        url: "https://example.test/day-12-proof",
        expectedText: "Join the launch",
      },
    },
    configuredCliCommands: {
      "url-live": {
        command: process.execPath,
        args: ["-e", "process.exit(7);"],
      },
    },
    runCliCommand: async () => ({
      exitCode: 7,
      stdout: "",
      stderr: "local verifier could not confirm the page",
    }),
    now,
  });

  assert.equal(result.passed, false);
  assert.equal(result.shouldRequestUserEvidence, true);
  assert.equal(result.attempts.length, 2);
  assert.equal(result.attempts[1].verifier.type, "browser");
  assert.equal(result.attempts[1].status, "unsupported");
  assert.equal(result.attempts[1].reason, "browser_tool_not_configured");
  assert.match(result.attempts[1].result.raw.runnableCommand, /browser-harness -c/);
  assert.match(result.attempts[1].result.raw.runnableCommand, /new_tab/);
});

test("configured CLI verification captures timeout and spawn error states", async () => {
  const timedOut = await executeConfiguredCliVerificationCommand({
    verifier: {
      command: process.execPath,
      args: ["-e", "console.log('started'); setTimeout(() => {}, 1000);"],
      timeoutMs: 25,
      env: {},
    },
    actionSpec: {},
  });
  const timeoutResult = normalizeCliVerificationResult(timedOut);

  assert.equal(timedOut.timedOut, true);
  assert.equal(timeoutResult.passed, false);
  assert.equal(timeoutResult.outcome, ACTION_CLI_VERIFICATION_OUTCOME.inconclusive);
  assert.equal(timeoutResult.raw.timedOut, true);
  assert.match(timeoutResult.reason, /timed out/);

  const spawnError = await executeConfiguredCliVerificationCommand({
    verifier: {
      command: "agentic30-missing-verifier-binary",
      args: [],
      timeoutMs: 100,
      env: {},
    },
    actionSpec: {},
  });
  const errorResult = normalizeCliVerificationResult(spawnError);

  assert.equal(spawnError.exitCode, null);
  assert.equal(spawnError.timedOut, false);
  assert.match(spawnError.error, /agentic30-missing-verifier-binary|ENOENT/);
  assert.equal(errorResult.passed, false);
  assert.equal(errorResult.outcome, ACTION_CLI_VERIFICATION_OUTCOME.inconclusive);
  assert.match(errorResult.raw.error, /agentic30-missing-verifier-binary|ENOENT/);
});

test("normalizes CLI execution results into verified, failed, and inconclusive outcomes", () => {
  const verified = normalizeCliVerificationResult({
    exitCode: 0,
    stdout: JSON.stringify({
      outcome: "verified",
      confidence: 0.94,
      evidence: ["HTTP 200 and expected launch copy present"],
    }),
  });

  assert.equal(verified.outcome, ACTION_CLI_VERIFICATION_OUTCOME.verified);
  assert.equal(verified.passed, true);
  assert.equal(verified.confidence, 0.94);
  assert.equal(verified.raw.outcome, ACTION_CLI_VERIFICATION_OUTCOME.verified);

  const failed = normalizeCliVerificationResult({
    exitCode: 0,
    stdout: JSON.stringify({
      outcome: "failed",
      reason: "The page is live but the required signup CTA is missing.",
    }),
  });

  assert.equal(failed.outcome, ACTION_CLI_VERIFICATION_OUTCOME.failed);
  assert.equal(failed.passed, false);
  assert.match(failed.reason, /signup CTA/);

  const inconclusive = normalizeCliVerificationResult({
    exitCode: 0,
    stdout: JSON.stringify({
      outcome: "inconclusive",
      reason: "The verifier could not access the authenticated workspace.",
    }),
  });

  assert.equal(inconclusive.outcome, ACTION_CLI_VERIFICATION_OUTCOME.inconclusive);
  assert.equal(inconclusive.passed, false);
  assert.match(inconclusive.agentAssessment, /did not produce a conclusive/);

  assert.equal(
    interpretCliVerificationOutcome({ exitCode: null, signal: "SIGTERM" }),
    ACTION_CLI_VERIFICATION_OUTCOME.inconclusive,
  );
});

test("normalizeVerificationRequests preserves hybrid action verification specs", () => {
  const requests = normalizeVerificationRequests({
    verification_method: [
      { type: "mcp", tools: ["google_docs", "google_sheets"], metadata: { range: "A:I" } },
      "browser-harness",
      { method: "cli", id: "curl-url", verifier: "curl" },
    ],
  });

  assert.deepEqual(requests.map((item) => [item.type, item.id, item.tool || ""]), [
    ["mcp", "google_docs", "google_docs"],
    ["mcp", "google_sheets", "google_sheets"],
    ["browser", "browser-harness", ""],
    ["cli", "curl-url", ""],
  ]);
  assert.deepEqual(requests[0].metadata, { range: "A:I" });
});

test("action auto-verification queries configured MCP tools and records normalized passing evidence", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 20,
    actionId: "day-20-outreach-tracker",
    actionDescription: "Record 10 warm outreach DMs.",
    completionSignal: "Google Sheet contains at least 10 rows with sent status.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.googleSheets],
    now,
  });
  const calls = [];

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      day_id: 20,
      action_id: "day-20-outreach-tracker",
      action_type: "outreach_tracker",
      completion_signal: "Google Sheet contains at least 10 rows with sent status.",
      verification_method: "google_sheets",
      verification_arguments: {
        spreadsheetId: "sheet-123",
        range: "A:D",
      },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node", args: ["sidecar/mcp-server.mjs"] },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_sheets_read"],
    },
    callMcpTool: async (call) => {
      calls.push(call);
      return {
        content: [{
          type: "text",
          text: JSON.stringify({
            passed: true,
            confidence: 0.91,
            agentAssessment: "Sheet has 12 outreach rows with sent timestamps.",
            evidenceItems: [
              { type: "sheet_range", content: "12 sent rows", source: "A:D" },
            ],
          }),
        }],
      };
    },
    now,
  });

  assert.equal(calls.length, 1);
  assert.equal(calls[0].server, "agentic30_sidecar");
  assert.equal(calls[0].tool, "gws_sheets_read");
  assert.equal(calls[0].arguments.spreadsheetId, "sheet-123");
  assert.equal(calls[0].arguments.actionSpec.completionSignal, "Google Sheet contains at least 10 rows with sent status.");
  assert.equal(result.passed, true);
  assert.equal(result.shouldRequestUserEvidence, false);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.googleSheets);
  assert.equal(result.state.verificationResult.confidence, 0.91);
  assert.equal(result.state.verificationResult.raw.evidenceItems[0].content, "12 sent rows");
  assert.equal(result.state.history[0].verifier, "agentic30_sidecar.gws_sheets_read");
});

test("action auto-verification calls per-server MCP clients with SDK-style arguments", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 12,
    actionId: "day-12-interview-log",
    actionDescription: "Record interview notes in a Google Doc.",
    completionSignal: "Google Doc contains at least one customer interview note.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.googleDocs],
    now,
  });
  const calls = [];
  const agentic30Client = {
    callTool: async (call) => {
      calls.push(call);
      return {
        structuredContent: {
          ok: true,
          confidence: 0.88,
          assessment: "Doc includes one dated interview note with customer quotes.",
          matches: [{ type: "doc_section", text: "2026-05-14 interview notes" }],
        },
      };
    },
  };

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Google Doc contains at least one customer interview note.",
      verification_method: "google_docs",
      verification_arguments: {
        documentId: "doc-123",
      },
    },
    configuredMcpServers: new Map([["agentic30_sidecar", { command: "node" }]]),
    configuredMcpTools: new Map([["agentic30_sidecar", new Set(["gws_docs_read"])]]),
    mcpClient: {
      clients: new Map([["agentic30_sidecar", agentic30Client]]),
    },
    now,
  });

  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0]).sort(), ["args", "arguments", "metadata", "name"]);
  assert.equal(calls[0].name, "gws_docs_read");
  assert.equal(calls[0].arguments.documentId, "doc-123");
  assert.equal(calls[0].arguments.actionSpec.completionSignal, "Google Doc contains at least one customer interview note.");
  assert.equal(result.passed, true);
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.googleDocs);
  assert.equal(result.state.verificationResult.confidence, 0.88);
  assert.equal(result.state.verificationResult.raw.evidenceItems[0].content, "2026-05-14 interview notes");
});

test("Google Docs evidence source verification reads raw document payloads against expected text", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 12,
    actionId: "day-12-interview-log",
    actionDescription: "Record interview notes in a Google Doc.",
    completionSignal: "Google Doc contains at least one customer interview note.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.googleDocs],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Google Doc contains at least one customer interview note.",
      verification_method: "google_docs",
      verification_arguments: {
        documentId: "doc-raw-123",
        expectedText: "customer interview note",
      },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node" },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_docs_read"],
    },
    callMcpTool: async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          documentId: "doc-raw-123",
          title: "Day 12 interview log",
          body: {
            content: [{
              paragraph: {
                elements: [
                  { textRun: { content: "2026-05-14\n" } },
                  { textRun: { content: "Customer interview note: buyer asked for async transcript review." } },
                ],
              },
            }],
          },
        }),
      }],
    }),
    now,
  });

  assert.equal(result.passed, true);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.googleDocs);
  assert.equal(result.state.verificationResult.raw.documentId, "doc-raw-123");
  assert.deepEqual(result.state.verificationResult.raw.matchedPhrases, ["customer interview note"]);
  assert.match(result.state.verificationResult.raw.textExcerpt, /async transcript review/);
  assert.equal(result.state.verificationResult.raw.evidenceItems[0].type, "google_doc_text");
});

test("Google Docs evidence source verification rejects insufficient raw document content", () => {
  const result = verifyGoogleDocsEvidenceSource({
    documentId: "doc-raw-456",
    title: "Short daily log",
    body: {
      content: [{
        paragraph: {
          elements: [
            { textRun: { content: "Today I cleaned up the roadmap." } },
          ],
        },
      }],
    },
  }, {
    actionSpec: {
      completion_signal: "Google Doc contains at least one customer interview note.",
      verification_arguments: {
        documentId: "doc-raw-456",
      },
    },
    verifier: "agentic30_sidecar.gws_docs_read",
  });

  assert.equal(result.passed, false);
  assert.equal(result.outcome, "insufficient");
  assert.match(result.reason, /customer/);
  assert.deepEqual(result.raw.missingPhrases, ["customer", "interview", "note"]);
  assert.deepEqual(result.evidenceItems, []);
});

test("Google Sheets evidence source verification counts raw values rows against completion signal", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 20,
    actionId: "day-20-outreach-tracker",
    actionDescription: "Record 10 warm outreach DMs.",
    completionSignal: "Google Sheet contains at least 10 rows with sent status.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.googleSheets],
    now,
  });

  const rows = [
    ["date", "person", "status", "note"],
    ...Array.from({ length: 10 }, (_item, index) => [
      `2026-05-${String(index + 1).padStart(2, "0")}`,
      `lead-${index + 1}`,
      "sent",
      "warm outreach DM sent",
    ]),
  ];

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Google Sheet contains at least 10 rows with sent status.",
      verification_method: "google_sheets",
      verification_arguments: {
        spreadsheetId: "sheet-raw-123",
        range: "'Outreach'!A:D",
        statusColumn: "status",
        requiredStatus: "sent",
      },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node" },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_sheets_read"],
    },
    callMcpTool: async () => ({
      content: [{
        type: "text",
        text: JSON.stringify({
          spreadsheetId: "sheet-raw-123",
          range: "'Outreach'!A1:D11",
          majorDimension: "ROWS",
          values: rows,
        }),
      }],
    }),
    now,
  });

  assert.equal(result.passed, true);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.googleSheets);
  assert.equal(result.state.verificationResult.raw.spreadsheetId, "sheet-raw-123");
  assert.equal(result.state.verificationResult.raw.rowCount, 10);
  assert.equal(result.state.verificationResult.raw.requiredRows, 10);
  assert.deepEqual(result.state.verificationResult.raw.matchedPhrases, ["sent"]);
  assert.equal(result.state.verificationResult.raw.evidenceItems[0].type, "google_sheet_rows");
});

test("Google Sheets sufficiency decisions use parsed curriculum criteria instead of completion-signal row defaults", () => {
  const guideline = parseActionSufficiencyGuideline(`
## Day 18 - Action - Outreach tracker
- Goal: 작은 아웃리치 배치를 실행한다.
- Action: 리드별 발송 상태를 Google Sheet에 기록한다.
- Completion signal: Google Sheet contains at least 10 rows with sent status.
- Sufficiency criteria: Quantity: at least 3 sent outreach rows are recorded.
- Verification method: google_sheets
`, { day: 18 });

  const result = verifyGoogleSheetsEvidenceSource({
    spreadsheetId: "sheet-criteria-123",
    range: "'Outreach'!A1:C4",
    values: [
      ["date", "lead", "status"],
      ["2026-05-01", "lead-1", "sent"],
      ["2026-05-02", "lead-2", "sent"],
      ["2026-05-03", "lead-3", "sent"],
    ],
  }, {
    actionSpec: {
      ...guideline,
      verification_arguments: {
        spreadsheetId: "sheet-criteria-123",
        statusColumn: "status",
        requiredStatus: "sent",
      },
    },
    verifier: "agentic30_sidecar.gws_sheets_read",
  });

  assert.equal(result.passed, true);
  assert.equal(result.raw.requiredRows, 3);
  assert.equal(result.raw.criteriaDecision.source, "sufficiency_criteria");
  assert.equal(result.raw.criteriaDecision.quantityRule.minCount, 3);
});

test("Google Sheets sufficiency decisions fail when supplied criteria require more rows than the completion signal", () => {
  const guideline = parseActionSufficiencyGuideline(`
## Day 19 - Action - Outreach tracker
- Goal: 더 큰 아웃리치 배치를 실행한다.
- Action: 리드별 발송 상태를 Google Sheet에 기록한다.
- Completion signal: Google Sheet contains at least 3 rows with sent status.
- Sufficiency criteria: Quantity: at least 5 sent outreach rows are recorded.
- Verification method: google_sheets
`, { day: 19 });

  const decision = buildActionSufficiencyCriteriaDecision(guideline);
  assert.equal(decision.quantityRule.minCount, 5);

  const result = verifyGoogleSheetsEvidenceSource({
    spreadsheetId: "sheet-criteria-456",
    range: "'Outreach'!A1:C5",
    values: [
      ["date", "lead", "status"],
      ["2026-05-01", "lead-1", "sent"],
      ["2026-05-02", "lead-2", "sent"],
      ["2026-05-03", "lead-3", "sent"],
      ["2026-05-04", "lead-4", "sent"],
    ],
  }, {
    actionSpec: {
      ...guideline,
      verification_arguments: {
        spreadsheetId: "sheet-criteria-456",
        statusColumn: "status",
        requiredStatus: "sent",
      },
    },
    verifier: "agentic30_sidecar.gws_sheets_read",
  });

  assert.equal(result.passed, false);
  assert.match(result.reason, /4 matching data rows; 5 required/);
  assert.equal(result.raw.requiredRows, 5);
  assert.equal(result.raw.criteriaDecision.quantityRule.minCount, 5);
});

test("Google Sheets sufficiency outcome changes when markdown guideline criteria fixture changes", () => {
  const relaxedGuideline = parseActionSufficiencyGuideline(
    readFixture("./fixtures/curriculum-guidelines/day-18-outreach-relaxed.md"),
    { day: 18, source: "fixture/day-18-outreach-relaxed.md" },
  );
  const strictGuideline = parseActionSufficiencyGuideline(
    readFixture("./fixtures/curriculum-guidelines/day-18-outreach-strict.md"),
    { day: 18, source: "fixture/day-18-outreach-strict.md" },
  );
  const sheetEvidence = {
    spreadsheetId: "sheet-guideline-regression",
    range: "'Outreach'!A1:C5",
    values: [
      ["date", "lead", "status"],
      ["2026-05-01", "outreach-lead-1", "sent"],
      ["2026-05-02", "outreach-lead-2", "sent"],
      ["2026-05-03", "outreach-lead-3", "sent"],
      ["2026-05-04", "outreach-lead-4", "sent"],
    ],
  };
  const verificationArguments = {
    spreadsheetId: "sheet-guideline-regression",
    statusColumn: "status",
    requiredStatus: "sent",
  };

  const relaxedResult = verifyGoogleSheetsEvidenceSource(sheetEvidence, {
    actionSpec: {
      ...relaxedGuideline,
      verification_arguments: verificationArguments,
    },
    verifier: "agentic30_sidecar.gws_sheets_read",
  });
  const strictResult = verifyGoogleSheetsEvidenceSource(sheetEvidence, {
    actionSpec: {
      ...strictGuideline,
      verification_arguments: verificationArguments,
    },
    verifier: "agentic30_sidecar.gws_sheets_read",
  });

  assert.equal(relaxedGuideline.actionId, strictGuideline.actionId);
  assert.equal(relaxedGuideline.completionSignal, strictGuideline.completionSignal);
  assert.equal(relaxedResult.passed, true);
  assert.equal(strictResult.passed, false);
  assert.equal(relaxedResult.raw.criteriaDecision.source, "sufficiency_criteria");
  assert.equal(strictResult.raw.criteriaDecision.source, "sufficiency_criteria");
  assert.equal(relaxedResult.raw.requiredRows, 3);
  assert.equal(strictResult.raw.requiredRows, 5);
  assert.match(strictResult.reason, /4 matching data rows; 5 required/);
});

test("Google Sheets evidence source verification rejects insufficient raw values rows", () => {
  const result = verifyGoogleSheetsEvidenceSource({
    spreadsheetId: "sheet-raw-456",
    range: "'Outreach'!A1:D4",
    values: [
      ["date", "person", "status", "note"],
      ["2026-05-01", "lead-1", "sent", "warm outreach DM sent"],
      ["2026-05-02", "lead-2", "draft", "not sent yet"],
      ["2026-05-03", "lead-3", "sent", "warm outreach DM sent"],
    ],
  }, {
    actionSpec: {
      completion_signal: "Google Sheet contains at least 10 rows with sent status.",
      verification_arguments: {
        spreadsheetId: "sheet-raw-456",
      },
    },
    verifier: "agentic30_sidecar.gws_sheets_read",
  });

  assert.equal(result.passed, false);
  assert.equal(result.outcome, "insufficient");
  assert.match(result.reason, /3 matching data rows; 10 required/);
  assert.equal(result.raw.rowCount, 3);
  assert.equal(result.raw.requiredRows, 10);
  assert.deepEqual(result.raw.matchedPhrases, ["sent"]);
  assert.deepEqual(result.evidenceItems, []);
});

test("action auto-verification retries the next configured MCP tool after insufficient evidence", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 6,
    actionId: "day-6-ask",
    actionDescription: "Send a money or time ask and record the outcome.",
    completionSignal: "A Google Doc or Sheet contains the ask text and response status.",
    preferredMethods: [
      ACTION_VERIFICATION_METHOD.googleDocs,
      ACTION_VERIFICATION_METHOD.googleSheets,
    ],
    now,
  });
  const calls = [];

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "A Google Doc or Sheet contains the ask text and response status.",
      verification_method: {
        type: "mcp",
        tools: ["google_docs", "google_sheets"],
      },
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node" },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_docs_read", "gws_sheets_read"],
    },
    callMcpTool: async (call) => {
      calls.push(call.tool);
      if (call.tool === "gws_docs_read") {
        return {
          structuredContent: {
            passed: false,
            reason: "Doc found, but no response status is recorded.",
            agentAssessment: "The doc is not enough yet.",
          },
        };
      }
      return {
        structuredContent: {
          verified: true,
          score: 0.84,
          summary: "Sheet row contains ask date, channel, and no-reply status.",
          evidence: ["row 8: no-reply by deadline"],
        },
      };
    },
    now,
  });

  assert.deepEqual(calls, ["gws_docs_read", "gws_sheets_read"]);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(result.shouldRequestUserEvidence, false);
  assert.equal(result.state.attemptCount, 2);
  assert.equal(result.state.retryCount, 1);
  assert.equal(result.state.history[0].status, ACTION_VERIFICATION_STATUS.failed);
  assert.equal(result.state.history[1].status, "retry");
  assert.equal(result.state.history[2].status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.googleSheets);
  assert.equal(result.state.verificationResult.raw.evidenceItems[0].content, "row 8: no-reply by deadline");
});

test("action auto-verification requests fallback evidence after MCP-only insufficient evidence", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 20,
    actionId: "day-20-outreach-tracker",
    actionDescription: "Record 10 warm outreach DMs.",
    completionSignal: "Google Sheet contains at least 10 rows with sent status.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.googleSheets],
    now,
  });

  const insufficient = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Google Sheet contains at least 10 rows with sent status.",
      verification_method: "google_sheets",
    },
    configuredMcpServers: {
      agentic30_sidecar: { command: "node" },
    },
    configuredMcpTools: {
      agentic30_sidecar: ["gws_sheets_read"],
    },
    callMcpTool: async () => ({
      structuredContent: {
        passed: false,
        reason: "Only 3 sent rows found.",
        agentAssessment: "The configured MCP check ran but did not find enough outreach evidence.",
      },
    }),
    now,
  });

  assert.equal(insufficient.passed, false);
  assert.equal(insufficient.shouldRequestUserEvidence, true);
  assert.equal(insufficient.state.status, ACTION_VERIFICATION_STATUS.failed);
  assert.equal(insufficient.attempts.length, 1);
  assert.equal(insufficient.attempts[0].verifier.type, "mcp");
  assert.equal(insufficient.state.verificationResult.reason, "Only 3 sent rows found.");
  assert.equal(insufficient.aggregate.allEnabledSourcesExhausted, true);

  const skipped = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Google Sheet contains at least 10 rows with sent status.",
      verification_method: "google_sheets",
    },
    configuredMcpServers: {},
    now,
  });

  assert.equal(skipped.passed, false);
  assert.equal(skipped.shouldRequestUserEvidence, false);
  assert.equal(skipped.attempts.length, 0);
  assert.equal(skipped.state.status, ACTION_VERIFICATION_STATUS.pending);
  assert.deepEqual(skipped.plan.skipped.map((item) => item.reason), ["mcp_server_not_configured"]);
});

test("action auto-verification withholds evidence request until every enabled source is failed or unavailable", () => {
  const failedState = {
    status: ACTION_VERIFICATION_STATUS.failed,
  };
  const attempts = [{
    verifier: {
      id: "public-proof",
      type: "browser",
      method: ACTION_VERIFICATION_METHOD.browser,
    },
    status: ACTION_VERIFICATION_STATUS.failed,
    result: { passed: false },
  }];

  assert.equal(shouldRequestEvidenceAfterAutoVerification({
    attempts,
    state: failedState,
    aggregate: {
      enabledSourceCount: 2,
      anyEnabledSourceSucceeded: false,
      allEnabledSourcesExhausted: false,
      sources: [
        { id: "public-proof", status: ACTION_AUTO_VERIFICATION_SOURCE_STATUS.failed },
        { id: "google_sheets", status: "not_attempted" },
      ],
    },
  }), false);

  assert.equal(shouldRequestEvidenceAfterAutoVerification({
    attempts,
    state: failedState,
    aggregate: {
      enabledSourceCount: 2,
      anyEnabledSourceSucceeded: false,
      allEnabledSourcesExhausted: true,
      sources: [
        { id: "public-proof", status: ACTION_AUTO_VERIFICATION_SOURCE_STATUS.failed },
        { id: "google_sheets", status: ACTION_AUTO_VERIFICATION_SOURCE_STATUS.unavailable },
      ],
    },
  }), true);
});

test("normalizeActionVerificationEvidenceResult handles MCP errors and plain text evidence", () => {
  const failed = normalizeActionVerificationEvidenceResult({
    isError: true,
    content: [{ type: "text", text: "Google auth is not connected." }],
  }, {
    method: ACTION_VERIFICATION_METHOD.googleDocs,
    verifier: "agentic30_sidecar.gws_docs_read",
  });

  assert.equal(failed.passed, false);
  assert.equal(failed.reason, "Google auth is not connected.");
  assert.equal(failed.confidence, 0);
  assert.match(failed.agentAssessment, /could not confirm/);

  const textOnly = normalizeActionVerificationEvidenceResult({
    content: [{ type: "text", text: "Found 3 public proof links in the sheet." }],
  }, {
    method: ACTION_VERIFICATION_METHOD.googleSheets,
    verifier: "agentic30_sidecar.gws_sheets_read",
  });

  assert.equal(textOnly.passed, true);
  assert.equal(textOnly.confidence, 0.8);
  assert.equal(textOnly.evidenceItems[0].content, "Found 3 public proof links in the sheet.");
});

test("action auto-verification runs Browser Tool checks and passes observable public state", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 8,
    actionId: "day-8-public-proof",
    actionDescription: "Publish a public proof URL.",
    completionSignal: "Published page shows the launch CTA.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.browser],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "Published page shows the launch CTA.",
      verification_method: "browser",
      verification_arguments: {
        url: "https://example.test/launch",
        expectedText: "Book a call",
        expectedSelector: "#primary-cta",
      },
    },
    fetchBrowserPageState: async () => ({
      url: "https://example.test/launch",
      title: "Launch",
      text: "Book a call with us.",
      selectors: {
        "#primary-cta": { exists: true, text: "Book a call" },
      },
    }),
    now,
  });

  assert.equal(result.passed, true);
  assert.equal(result.shouldRequestUserEvidence, false);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.passed);
  assert.equal(result.state.verificationResult.method, ACTION_VERIFICATION_METHOD.browser);
  assert.equal(result.state.verificationResult.outcome, "pass");
  assert.equal(result.state.verificationResult.raw.evidenceItems[0].type, "browser_text");
});

test("action auto-verification leaves Browser Tool unsupported attempts for evidence fallback", async () => {
  const now = makeClock();
  const pending = createActionDayVerificationState({
    dayId: 9,
    actionId: "day-9-community-post",
    actionDescription: "Publish a community post.",
    completionSignal: "The community post is visible.",
    preferredMethods: [ACTION_VERIFICATION_METHOD.browser],
    now,
  });

  const result = await runActionAutoVerification(pending, {
    actionSpec: {
      completion_signal: "The community post is visible.",
      verification_method: "browser",
      verification_arguments: {
        url: "https://community.example.test/posts/123",
      },
    },
    fetchBrowserPageState: async () => {
      throw new Error("should not run without observable expected state");
    },
    now,
  });

  assert.equal(result.passed, false);
  assert.equal(result.shouldRequestUserEvidence, true);
  assert.equal(result.state.status, ACTION_VERIFICATION_STATUS.pending);
  assert.equal(result.attempts.length, 1);
  assert.equal(result.attempts[0].status, "unsupported");
  assert.equal(result.attempts[0].reason, "browser_expected_state_missing");
});

// Pins the workspace-scan gate. The founder explicitly approved flipping the
// prior strict fail-closed rule to FAIL-OPEN *when local signals exist*:
//
//   - No usable provider AND no local canonical doc  → still BLOCKED
//     (Agentic30 genuinely cannot proceed). These tests seed only README.md
//     (not a canonical project doc) so localFoundCount is 0 and the scan must
//     broadcast workspace_scan_blocked, recommending the next provider in the
//     codex → claude → gemini → cursor consent chain.
//   - No usable provider BUT a local canonical doc exists → DEGRADED
//     workspace_scan_result (additive degraded/degradedReason/degradedProvider
//     fields) so onboarding advances to Day 1 on local signals instead of
//     stalling. The degraded test at the bottom pins this intentional
//     inversion: the result is non-error and carries an advisory notice.
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

const PROVIDER_KEY_ENV_VARS = [
  "ANTHROPIC_API_KEY",
  "CODEX_API_KEY",
  "OPENAI_API_KEY",
  "GEMINI_API_KEY",
  "GOOGLE_API_KEY",
  "GOOGLE_APPLICATION_CREDENTIALS",
  "CURSOR_API_KEY",
];

async function spawnSidecarWithoutStub({
  seedClaudeLogin = false,
  seedGeminiLogin = false,
  // When true, seeds a canonical .agentic30/docs/ICP.md so the local scan finds
  // a real project doc (localFoundCount > 0). This flips the gate from
  // fail-closed (blocked) to fail-open (degraded workspace_scan_result) when no
  // provider can verify — see the degraded test below.
  seedCanonicalDoc = false,
  extraEnv = {},
  processCwd = packageRoot,
} = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-scan-blocked-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  const homePath = path.join(tempRoot, "home");
  const ghConfigPath = path.join(tempRoot, "gh-config");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(appSupportPath, { recursive: true });
  await fs.mkdir(homePath, { recursive: true });
  await fs.mkdir(ghConfigPath, { recursive: true });
  await fs.writeFile(path.join(workspacePath, "README.md"), "# scan blocked test\n");
  if (seedCanonicalDoc) {
    const docsDir = path.join(workspacePath, ".agentic30", "docs");
    await fs.mkdir(docsDir, { recursive: true });
    await fs.writeFile(
      path.join(docsDir, "ICP.md"),
      "# Ideal Customer Profile\n\nSolo founder shipping a Mac assistant; current alternative is manual notes.\n",
    );
  }
  if (seedClaudeLogin) {
    await fs.writeFile(
      path.join(homePath, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "blocked-test@example.com" } }),
    );
  }
  if (seedGeminiLogin) {
    const gcloudPath = path.join(homePath, ".config", "gcloud");
    await fs.mkdir(gcloudPath, { recursive: true });
    await fs.writeFile(
      path.join(gcloudPath, "application_default_credentials.json"),
      JSON.stringify({ client_id: "test-client", refresh_token: "test-refresh" }),
    );
  }

  const env = {
    ...process.env,
    ...extraEnv,
    AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
    AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
    AGENTIC30_DISABLE_AGENT_HISTORY: "1",
    // No stub: provider availability must come from real auth state, which the
    // isolated HOME below guarantees is empty.
    HOME: homePath,
    GH_CONFIG_DIR: ghConfigPath,
    GH_TOKEN: "",
    GITHUB_TOKEN: "",
  };
  delete env.AGENTIC30_TEST_STUB_PROVIDER;
  for (const key of PROVIDER_KEY_ENV_VARS) {
    delete env[key];
  }

  const child = spawn(process.execPath, [path.join(packageRoot, "sidecar", "index.mjs"), "--workspace", workspacePath], {
    cwd: processCwd,
    env,
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
    workspacePath,
    async close() {
      child.kill("SIGTERM");
      await new Promise((resolve) => {
        child.once("exit", resolve);
        setTimeout(resolve, 2_000);
      });
      await fs.rm(tempRoot, { recursive: true, force: true });
    },
  };
}

async function connectAndCollect(harness) {
  const ws = new WebSocket(`ws://127.0.0.1:${harness.port}`);
  ws.events = [];
  ws.on("message", (raw) => {
    ws.events.push(JSON.parse(String(raw)));
  });
  await new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
  ws.send(JSON.stringify({ type: "authenticate", authToken: harness.authToken }));
  await waitForEvent(ws.events, (event) => event.type === "ready");
  return ws;
}

async function waitForEvent(events, predicate, timeoutMs = 20_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for event. Saw: ${events.map((event) => event.type).join(", ")}`);
}

test("scan with no available provider broadcasts blocked and never passes on local signals", async () => {
  const harness = await spawnSidecarWithoutStub();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "scan blocked contract",
    }));

    const blocked = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(blocked.provider, "codex");
    assert.equal(blocked.reason, "unavailable");
    assert.equal(blocked.stage, "blocked");
    assert.equal(blocked.stepIndex, 2);
    assert.equal(blocked.totalSteps, 3);
    assert.equal(blocked.nextProvider, null);
    assert.deepEqual(blocked.availableProviders, []);
    assert.equal(blocked.localFoundCount, 0);
    assert.equal(blocked.localFindings.localFoundCount, 0);
    assert.equal(blocked.localFindings.canonicalDocs.icp.found, false);
    assert.ok(blocked.localFindings.evidencePaths.includes("README.md"));
    assert.equal(blocked.providerReadiness.length, 4);
    for (const provider of ["codex", "claude", "gemini", "cursor"]) {
      const readiness = blocked.providerReadiness.find((item) => item.provider === provider);
      assert.ok(readiness, `missing readiness for ${provider}`);
      assert.equal(readiness.sdkInstalled, true, `${provider} SDK should be installed`);
      assert.equal(readiness.authenticated, false, `${provider} should not be authenticated`);
      assert.equal(readiness.scanReady, false, `${provider} should not be scan-ready`);
    }
    assert.equal(
      blocked.providerReadiness.find((item) => item.provider === "codex").authAction,
      "codex_login",
    );
    assert.equal(
      blocked.providerReadiness.find((item) => item.provider === "cursor").authAction,
      "cursor_api_key",
    );
    const failed = await waitForEvent(ws.events, (event) =>
      event.type === "request_emit"
        && event.event === "workspace_setup_failed"
        && event.properties?.workspace_basename === path.basename(harness.workspacePath),
    );
    assert.equal(failed.properties.error_name, "workspace_scan_blocked");
    assert.equal(failed.properties.scan_block_reason, "unavailable");
    assert.equal(failed.properties.provider, "codex");
    assert.equal(failed.properties.failed_provider, "codex");
    assert.equal(failed.properties.next_provider, "none");
    assert.equal(failed.properties.available_provider_count, 0);
    assert.equal(failed.properties.error_kind, "provider_auth_required");
    assert.equal(failed.properties.model, blocked.model);

    // Fail closed: no successful workspace_scan_result may follow the block.
    await new Promise((resolve) => setTimeout(resolve, 500));
    const passed = ws.events.some((event) =>
      event.type === "workspace_scan_result"
        && event.scanRoot === harness.workspacePath
        && !event.error,
    );
    assert.equal(passed, false);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("scan workspace normalizes current-directory path aliases before scanning", async () => {
  const harness = await spawnSidecarWithoutStub();
  let ws;
  try {
    ws = await connectAndCollect(harness);

    for (const rootAlias of [".", "@."]) {
      ws.events.length = 0;
      ws.send(JSON.stringify({
        type: "scan_workspace",
        root: rootAlias,
        prompt: "scan current directory alias contract",
      }));

      const blocked = await waitForEvent(ws.events, (event) =>
        event.type === "workspace_scan_blocked"
          && event.scanRoot === packageRoot,
      );
      assert.equal(blocked.provider, "codex");
      assert.equal(blocked.reason, "unavailable");
      assert.equal(blocked.scanRoot, packageRoot);
      assert.ok(
        ws.events.some((event) =>
          event.type === "workspace_scan_started"
            && event.scanRoot === packageRoot,
        ),
      );
    }
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("scan blocked on codex recommends claude when a claude login session exists", async () => {
  const harness = await spawnSidecarWithoutStub({ seedClaudeLogin: true });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "scan blocked chain recommendation",
    }));

    const blocked = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(blocked.provider, "codex");
    assert.equal(blocked.reason, "unavailable");
    assert.equal(blocked.stage, "blocked");
    assert.equal(blocked.stepIndex, 2);
    assert.equal(blocked.totalSteps, 3);
    assert.equal(blocked.nextProvider, "claude");
    assert.deepEqual(blocked.availableProviders, ["claude"]);
    const claudeReadiness = blocked.providerReadiness.find((item) => item.provider === "claude");
    assert.equal(claudeReadiness.authenticated, true);
    assert.equal(claudeReadiness.scanReady, true);
    assert.equal(claudeReadiness.authAction, null);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("scan blocked on selected claude usage limit recommends the next scan-ready provider", async () => {
  const harness = await spawnSidecarWithoutStub({
    seedClaudeLogin: true,
    seedGeminiLogin: true,
    extraEnv: {
      AGENTIC30_TEST_FORCE_PROVIDER_USAGE_LIMIT: "claude",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "deep scan with selected claude quota contract",
      preferredProvider: "claude",
    }));

    const blocked = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(blocked.provider, "claude");
    assert.equal(blocked.model, "claude-sonnet-4-6");
    assert.equal(blocked.reason, "usage_limit");
    assert.equal(blocked.errorKind, "provider_usage_limit");
    assert.equal(blocked.stage, "blocked");
    assert.equal(blocked.stepIndex, 2);
    assert.equal(blocked.totalSteps, 3);
    assert.equal(blocked.nextProvider, "gemini");
    assert.deepEqual(blocked.availableProviders, ["gemini"]);
    assert.match(blocked.message, /weekly limit/);
    const claudeReadiness = blocked.providerReadiness.find((item) => item.provider === "claude");
    const geminiReadiness = blocked.providerReadiness.find((item) => item.provider === "gemini");
    assert.equal(claudeReadiness.authenticated, true);
    assert.equal(claudeReadiness.scanReady, true);
    assert.equal(geminiReadiness.authenticated, true);
    assert.equal(geminiReadiness.scanReady, true);
    const cursorReadiness = blocked.providerReadiness.find((item) => item.provider === "cursor");
    assert.equal(cursorReadiness.scanSupported, false);
    assert.equal(cursorReadiness.scanReady, false);
    const failed = await waitForEvent(ws.events, (event) =>
      event.type === "request_emit"
        && event.event === "workspace_setup_failed"
        && event.properties?.workspace_basename === path.basename(harness.workspacePath),
    );
    assert.equal(failed.properties.error_name, "workspace_scan_blocked");
    assert.equal(failed.properties.scan_block_reason, "usage_limit");
    assert.equal(failed.properties.provider, "claude");
    assert.equal(failed.properties.failed_provider, "claude");
    assert.equal(failed.properties.next_provider, "gemini");
    assert.equal(failed.properties.available_provider_count, 1);
    assert.equal(failed.properties.error_kind, "provider_usage_limit");
    assert.equal(failed.properties.model, "claude-sonnet-4-6");

    await new Promise((resolve) => setTimeout(resolve, 500));
    const passed = ws.events.some((event) =>
      event.type === "workspace_scan_result"
        && event.scanRoot === harness.workspacePath
        && !event.error,
    );
    assert.equal(passed, false);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("scan blocked on selected claude abort recommends the next scan-ready provider", async () => {
  const harness = await spawnSidecarWithoutStub({
    seedClaudeLogin: true,
    seedGeminiLogin: true,
    extraEnv: {
      AGENTIC30_TEST_FORCE_PROVIDER_ABORT: "claude",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "deep scan with selected claude abort contract",
      preferredProvider: "claude",
    }));

    const blocked = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(blocked.provider, "claude");
    assert.equal(blocked.model, "claude-sonnet-4-6");
    assert.equal(blocked.reason, "aborted");
    assert.equal(blocked.errorKind, "provider_aborted");
    assert.equal(blocked.stage, "blocked");
    assert.equal(blocked.stepIndex, 2);
    assert.equal(blocked.totalSteps, 3);
    assert.equal(blocked.nextProvider, "gemini");
    assert.deepEqual(blocked.availableProviders, ["gemini"]);
    assert.match(blocked.message, /aborted by user/);

    await new Promise((resolve) => setTimeout(resolve, 500));
    const passed = ws.events.some((event) =>
      event.type === "workspace_scan_result"
        && event.scanRoot === harness.workspacePath
        && !event.error,
    );
    assert.equal(passed, false);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("scan with no provider but a local canonical doc fails OPEN with a degraded result", async () => {
  // Intentional design inversion (founder-approved): a workspace that has a
  // canonical .agentic30/docs/ICP.md but no usable provider must NOT block. The
  // scan completes on local signals and emits a degraded workspace_scan_result
  // so onboarding advances to Day 1, with an advisory (non-blocking) notice the
  // host renders as "local-only scan — reconnect for a precise scan".
  const harness = await spawnSidecarWithoutStub({ seedCanonicalDoc: true });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "deep scan with local doc but no provider",
    }));

    const result = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_result"
        && event.scanRoot === harness.workspacePath,
    );
    // Fail-open, not failed: no error, real local ICP path, and the additive
    // degraded markers naming why precise verification was skipped.
    assert.equal(result.error, undefined);
    assert.equal(result.icp, ".agentic30/docs/ICP.md");
    assert.equal(result.degraded, true);
    // No provider was authenticated, so the failure reason is "unavailable"
    // (no_auth) and the failed provider is the first in the consent chain.
    assert.equal(result.degradedReason, "unavailable");
    assert.equal(result.degradedProvider, "codex");
    // Advisory recovery payload mirrors the blocked notice shape but is carried
    // inside the (successful) result so the host can reuse its recovery UI.
    assert.ok(result.scanBlockedNotice, "degraded result must carry an advisory notice");
    assert.equal(result.scanBlockedNotice.reason, "unavailable");
    assert.equal(result.scanBlockedNotice.provider, "codex");
    assert.equal(result.scanBlockedNotice.localFoundCount, 1);
    assert.equal(result.scanBlockedNotice.providerReadiness.length, 4);
    assert.ok(
      result.scanBlockedNotice.localFindings.evidencePaths.includes(".agentic30/docs/ICP.md")
        || result.scanBlockedNotice.localFindings.canonicalDocs.icp?.found === true,
      "notice findings should reflect the local canonical doc",
    );

    // The scan must NOT broadcast a blocked event when it fails open.
    await new Promise((resolve) => setTimeout(resolve, 300));
    const blocked = ws.events.some((event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(blocked, false);
  } finally {
    ws?.close();
    await harness.close();
  }
});

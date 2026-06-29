// Pins the workspace-scan gate. Provider execution failures and weak evidence
// expose readiness diagnostics as explicit blocked events instead of falling
// back to local-only onboarding:
//
//   - No usable provider -> blocked event with provider readiness diagnostics.
//   - Canonical docs that lack customer/problem/action quotes -> blocked event
//     with explicit missing-field diagnostics.
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
  // When true, seeds a partial canonical .agentic30/docs/ICP.md. This is still
  // insufficient for Day 1 because problem and activation-action quotes are
  // missing, so a successful provider scan must still block explicitly.
  seedCanonicalDoc = false,
  extraEnv = {},
  processCwd = packageRoot,
  useWorkspaceCwd = false,
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
    cwd: useWorkspaceCwd ? workspacePath : processCwd,
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

test("scan with no available provider fails explicitly with a blocked event", async () => {
  const harness = await spawnSidecarWithoutStub();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "scan blocked contract",
    }));

    const notice = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(notice.reason, "unavailable");
    assert.equal(notice.errorKind, "provider_auth_required");
    assert.equal(notice.nextProvider, null);
    assert.deepEqual(notice.availableProviders, []);
    assert.ok(notice.localFoundCount >= 1);
    assert.ok(notice.localFindings.localFoundCount >= 1);
    assert.equal(notice.localFindings.canonicalFoundCount, 0);
    assert.equal(notice.localFindings.canonicalDocs.icp.found, false);
    assert.ok(notice.localFindings.evidencePaths.includes("README.md"));
    assert.equal(notice.providerReadiness.length, 4);
    for (const provider of ["codex", "claude", "gemini", "cursor"]) {
      const readiness = notice.providerReadiness.find((item) => item.provider === provider);
      assert.ok(readiness, `missing readiness for ${provider}`);
      assert.equal(readiness.sdkInstalled, true, `${provider} SDK should be installed`);
      assert.equal(readiness.authenticated, false, `${provider} should not be authenticated`);
      assert.equal(readiness.scanReady, false, `${provider} should not be scan-ready`);
    }
    assert.equal(
      notice.providerReadiness.find((item) => item.provider === "codex").authAction,
      "codex_login",
    );
    assert.equal(
      notice.providerReadiness.find((item) => item.provider === "cursor").authAction,
      "cursor_api_key",
    );
    assert.equal(typeof notice.elapsedMs, "number");
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_result"
          && event.scanRoot === harness.workspacePath,
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("scan workspace normalizes current-directory path aliases before scanning", async () => {
  const harness = await spawnSidecarWithoutStub({ useWorkspaceCwd: true });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    const expectedWorkspaceRoot = await fs.realpath(harness.workspacePath);

    for (const rootAlias of [".", "@."]) {
      ws.events.length = 0;
      ws.send(JSON.stringify({
        type: "scan_workspace",
        root: rootAlias,
        prompt: "scan current directory alias contract",
      }));

      const blocked = await waitForEvent(ws.events, (event) =>
        event.type === "workspace_scan_blocked",
      );
      assert.equal(await fs.realpath(blocked.scanRoot), expectedWorkspaceRoot);
      assert.equal(blocked.reason, "unavailable");
      assert.ok(
        ws.events.some((event) =>
          event.type === "workspace_scan_started"
            && event.scanRoot === blocked.scanRoot,
        ),
      );
    }
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("blocked scan recommends claude when a claude login session exists", async () => {
  const harness = await spawnSidecarWithoutStub({ seedClaudeLogin: true });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "scan blocked chain recommendation",
    }));

    const notice = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(notice.provider, "codex");
    assert.equal(notice.reason, "unavailable");
    assert.equal(notice.nextProvider, "claude");
    assert.deepEqual(notice.availableProviders, ["claude"]);
    const claudeReadiness = notice.providerReadiness.find((item) => item.provider === "claude");
    assert.equal(claudeReadiness.authenticated, true);
    assert.equal(claudeReadiness.scanReady, true);
    assert.equal(claudeReadiness.authAction, null);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("blocked scan on selected claude usage limit recommends the next scan-ready provider", async () => {
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

    const notice = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(notice.provider, "claude");
    assert.equal(notice.model, "claude-sonnet-4-6");
    assert.equal(notice.reason, "usage_limit");
    assert.equal(notice.errorKind, "provider_usage_limit");
    assert.equal(notice.nextProvider, "gemini");
    assert.deepEqual(notice.availableProviders, ["gemini"]);
    const claudeReadiness = notice.providerReadiness.find((item) => item.provider === "claude");
    const geminiReadiness = notice.providerReadiness.find((item) => item.provider === "gemini");
    assert.equal(claudeReadiness.authenticated, true);
    assert.equal(claudeReadiness.scanReady, true);
    assert.equal(geminiReadiness.authenticated, true);
    assert.equal(geminiReadiness.scanReady, true);
    const cursorReadiness = notice.providerReadiness.find((item) => item.provider === "cursor");
    assert.equal(cursorReadiness.scanSupported, false);
    assert.equal(cursorReadiness.scanReady, false);
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_result"
          && event.scanRoot === harness.workspacePath,
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("blocked scan on selected claude abort recommends the next scan-ready provider", async () => {
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

    const notice = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(notice.provider, "claude");
    assert.equal(notice.model, "claude-sonnet-4-6");
    assert.equal(notice.reason, "aborted");
    assert.equal(notice.errorKind, "provider_aborted");
    // Forced abort fires neither the soft nor the hard timer, so deriveScanAbortCause
    // classifies it as "external" — NOT a timeout. The Mac side must not show a
    // "시간 초과" banner or offer same-provider retry for an external abort.
    assert.equal(notice.abortCause, "external");
    assert.equal(notice.nextProvider, "gemini");
    assert.deepEqual(notice.availableProviders, ["gemini"]);
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_result"
          && event.scanRoot === harness.workspacePath,
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("blocked scan echoes retryAttempt so the UI can escalate past an extended retry", async () => {
  const harness = await spawnSidecarWithoutStub();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    // First attempt (retryAttempt omitted) must NOT echo a retry marker.
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "first attempt has no retry marker",
    }));
    const firstNotice = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(firstNotice.reason, "unavailable");
    assert.equal(firstNotice.retryAttempt, undefined);

    // An explicit retry (retryAttempt: 1) echoes back so the Mac side can stop
    // offering same-provider retry and escalate to switch-provider.
    ws.events.length = 0;
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "explicit retry echoes attempt number",
      retryAttempt: 1,
    }));
    const retryNotice = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(retryNotice.reason, "unavailable");
    assert.equal(retryNotice.retryAttempt, 1);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("scan with no provider and partial local canonical docs fails blocked with diagnostics", async () => {
  const harness = await spawnSidecarWithoutStub({ seedCanonicalDoc: true });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "deep scan with local doc but no provider",
    }));

    const notice = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    assert.equal(notice.reason, "unavailable");
    assert.equal(notice.errorKind, "provider_auth_required");
    assert.ok(notice.localFindings.localFoundCount >= 1);
    assert.ok(
      notice.localFindings.evidencePaths.includes(".agentic30/docs/ICP.md")
        || notice.localFindings.canonicalDocs.icp?.found === true,
      "blocked findings should reflect the local canonical doc",
    );
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_result"
          && event.scanRoot === harness.workspacePath,
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

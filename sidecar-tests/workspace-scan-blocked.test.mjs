// Pins the fail-closed workspace-scan gate: when the scan's agent
// verification cannot run (usage limit / no provider auth / run error), the
// sidecar must broadcast workspace_scan_blocked instead of completing the
// scan on local-only signals. With no available provider at all the scan
// stays blocked (Agentic30 cannot proceed); with another provider available
// the event recommends the next one in the codex → claude → gemini → cursor
// consent chain.
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

async function spawnSidecarWithoutStub({ seedClaudeLogin = false } = {}) {
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
  if (seedClaudeLogin) {
    await fs.writeFile(
      path.join(homePath, ".claude.json"),
      JSON.stringify({ oauthAccount: { emailAddress: "blocked-test@example.com" } }),
    );
  }

  const env = {
    ...process.env,
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

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspacePath], {
    cwd: packageRoot,
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
  } finally {
    ws?.close();
    await harness.close();
  }
});

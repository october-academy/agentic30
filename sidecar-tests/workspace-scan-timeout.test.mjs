// Exercises the workspace-scan agent's *real* two-stage wall-clock bound end to
// end, which the rest of the suite never drives:
//
//   runWorkspaceScanAgent (sidecar/index.mjs) races runProviderStream against a
//   soft timeout (AGENTIC30_WORKSPACE_SCAN_ABORT_MS -> abortController.abort())
//   and a hard deadline (AGENTIC30_WORKSPACE_SCAN_HARD_DEADLINE_MS -> force a
//   rejection even if the SDK ignores the abort). deriveScanAbortCause tags the
//   failure soft_timeout vs hard_deadline, and the fail-closed scan emits a
//   workspace_scan_blocked event carrying reason/errorKind/abortCause.
//
// The existing workspace-scan-blocked tests only simulate aborts via
// AGENTIC30_TEST_FORCE_PROVIDER_ABORT, which throws *instantly* at
// runProviderStream entry — the abort/hard-deadline timers never arm. So a too
// tight real timeout budget for a slow Claude/Codex scan would pass the green
// suite. These tests close that gap by setting the env timeouts to small values
// and driving a deliberately slow stub provider into the real timers:
//   - soft timeout: an abort-honoring stub (AGENTIC30_TEST_STUB_PROVIDER_ABORTABLE)
//     is cancelled by abortController.abort() at the soft budget -> abortCause
//     "soft_timeout".
//   - hard deadline: a hung stub that ignores the abort signal is force-returned
//     by the hard-deadline timer -> abortCause "hard_deadline".
import test from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import WebSocket from "ws";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

async function spawnStubScanSidecar({ extraEnv = {} } = {}) {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-scan-timeout-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  const homePath = path.join(tempRoot, "home");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(appSupportPath, { recursive: true });
  await fs.mkdir(homePath, { recursive: true });
  // A single weak local doc: enough for localFoundCount >= 1 (so the scan runs
  // the agent rather than the path-lookup fast path), but short of the Day 1
  // gate, so the run reaches the agent and then blocks once the agent times out.
  await fs.writeFile(path.join(workspacePath, "README.md"), "# scan timeout test\n");

  const env = {
    ...process.env,
    // Stub provider: getProviderAuthState() reports available, so the agent run
    // gets past the auth check and actually arms the abort/hard-deadline timers.
    AGENTIC30_TEST_STUB_PROVIDER: "1",
    AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
    AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
    AGENTIC30_DISABLE_AGENT_HISTORY: "1",
    HOME: homePath,
    ...extraEnv,
  };

  const child = spawn(
    process.execPath,
    [path.join(packageRoot, "sidecar", "index.mjs"), "--workspace", workspacePath],
    { cwd: packageRoot, env, stdio: ["ignore", "pipe", "pipe"] },
  );

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

test("scan agent soft timeout aborts a slow provider run and blocks with abortCause soft_timeout", async () => {
  const harness = await spawnStubScanSidecar({
    extraEnv: {
      // Soft timeout well before the hard deadline; the stub would otherwise run
      // for 2s, so the abort at ~150ms is the real soft-timeout firing.
      AGENTIC30_WORKSPACE_SCAN_ABORT_MS: "150",
      AGENTIC30_WORKSPACE_SCAN_HARD_DEADLINE_MS: "5000",
      AGENTIC30_TEST_STUB_PROVIDER_DELAY_MS: "2000",
      // Honor abortController.abort(): the soft timeout's abort throws AbortError
      // out of the stub run, exercising the soft-timeout -> provider_aborted path.
      AGENTIC30_TEST_STUB_PROVIDER_ABORTABLE: "1",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "workspace scan soft timeout contract",
    }));

    const blocked = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    // The real soft-timeout abort, classified as a timeout abort and tagged.
    assert.equal(blocked.reason, "aborted");
    assert.equal(blocked.errorKind, "provider_aborted");
    assert.equal(blocked.abortCause, "soft_timeout");
    // No successful scan result is emitted in the fail-closed path.
    assert.equal(
      ws.events.some((event) =>
        event.type === "workspace_scan_result"
          && event.scanRoot === harness.workspacePath
          && !event.error,
      ),
      false,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("scan agent hard deadline force-returns a hung provider and blocks with abortCause hard_deadline", async () => {
  const harness = await spawnStubScanSidecar({
    extraEnv: {
      AGENTIC30_WORKSPACE_SCAN_ABORT_MS: "120",
      AGENTIC30_WORKSPACE_SCAN_HARD_DEADLINE_MS: "300",
      // Clamped to 5s by the stub. ABORTABLE is intentionally unset, so the stub
      // ignores abortController.abort() — modeling a provider SDK hung on tool
      // I/O. Without the hard deadline the scan would block for the full 5s.
      AGENTIC30_TEST_STUB_PROVIDER_DELAY_MS: "5000",
    },
  });
  let ws;
  try {
    ws = await connectAndCollect(harness);
    const startedAt = Date.now();
    ws.send(JSON.stringify({
      type: "scan_workspace",
      root: harness.workspacePath,
      prompt: "workspace scan hard deadline contract",
    }));

    const blocked = await waitForEvent(ws.events, (event) =>
      event.type === "workspace_scan_blocked"
        && event.scanRoot === harness.workspacePath,
    );
    const elapsedMs = Date.now() - startedAt;
    // The hung stub ignored the abort; the hard-deadline timer force-returned the
    // run and still classified it as a timeout abort, tagged hard_deadline.
    assert.equal(blocked.reason, "aborted");
    assert.equal(blocked.errorKind, "provider_aborted");
    assert.equal(blocked.abortCause, "hard_deadline");
    // Force-returned well before the hung 5s stub run would have resolved.
    // Generous bound vs. the 300ms deadline: this asserts the timeout budget,
    // not wall-clock precision.
    assert.ok(
      elapsedMs < 4_000,
      `scan should force-return via the hard deadline, took ${elapsedMs}ms`,
    );
  } finally {
    ws?.close();
    await harness.close();
  }
});

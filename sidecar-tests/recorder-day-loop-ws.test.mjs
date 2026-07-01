import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";

import { loadProofLedger } from "../sidecar/execution-os.mjs";
import { recordFrameCaptureEnvelope } from "../sidecar/recorder-ingest.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

test("authenticated sidecar command runs recorder Day Memory Review to Evidence Inbox to next action without proof writes", async () => {
  const harness = await spawnSidecarWithSeededRecorder();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "recorder_day_memory_loop_run",
      ...harness.loopRequest,
      persistReviewSnapshot: true,
    }));

    const event = await waitForEvent(ws.events, (candidate) =>
      candidate.type === "recorder_day_memory_loop_result"
        && candidate.dayLoop?.schema === "agentic30.recorder.day_loop.v1"
    );

    assert.equal(event.proofAcceptedByDayLoop, false);
    assert.equal(event.proofLedgerWriteAllowed, false);
    assert.equal(event.dayLoop.proofBoundary.proofAcceptedByDayLoop, false);
    assert.equal(event.dayLoop.evidenceBuildResult.createdCount, 1);
    assert.equal(event.dayLoop.review.evidenceInbox.unresolvedCount, 1);
    assert.equal(event.dayLoop.nextAction.action.actionType, "review_evidence_inbox");
    assert.equal(event.nextAction.action.actionType, "review_evidence_inbox");
    assert.equal(event.snapshot.persisted, true);
    assert.equal(
      event.snapshot.relativePath,
      harness.snapshotRelativePath,
    );

    const responseJson = JSON.stringify(event);
    assert.match(responseJson, /redacted founder activation friction/);
    assert.doesNotMatch(responseJson, /customer@example\.com|raw private|media\/frames|a30_recorder_/);

    const persisted = JSON.parse(await fs.readFile(
      path.join(harness.workspacePath, event.snapshot.relativePath),
      "utf8",
    ));
    assert.match(JSON.stringify(persisted), /redacted founder activation friction/);

    const ledger = await loadProofLedger({ workspaceRoot: harness.workspacePath });
    assert.equal(ledger.events.length, 0);
  } finally {
    ws?.close();
    await harness.close();
  }
});

test("authenticated sidecar command reports invalid Day Memory range without crashing the connection", async () => {
  const harness = await spawnSidecarWithSeededRecorder();
  let ws;
  try {
    ws = await connectAndCollect(harness);
    ws.send(JSON.stringify({
      type: "recorder_day_memory_loop_run",
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: harness.loopRequest.endedAt,
      endedAt: harness.loopRequest.startedAt,
      now: harness.loopRequest.now,
      persistReviewSnapshot: true,
    }));

    const errorEvent = await waitForEvent(ws.events, (candidate) =>
      candidate.type === "error"
        && /ERR_RECORDER_DAY_LOOP_INVALID_RANGE/.test(candidate.message || "")
    );
    assert.match(errorEvent.message, /endedAt must be after startedAt/);
    assert.equal(ws.readyState, WebSocket.OPEN);

    ws.send(JSON.stringify({
      type: "recorder_day_memory_loop_run",
      ...harness.loopRequest,
      persistReviewSnapshot: false,
    }));

    const resultEvent = await waitForEvent(ws.events, (candidate) =>
      candidate.type === "recorder_day_memory_loop_result"
        && candidate.dayLoop?.schema === "agentic30.recorder.day_loop.v1"
    );
    assert.equal(resultEvent.dayLoop.nextAction.action.actionType, "review_evidence_inbox");
    assert.equal(resultEvent.snapshot.persisted, false);
    assert.equal(resultEvent.proofAcceptedByDayLoop, false);
  } finally {
    ws?.close();
    await harness.close();
  }
});

async function spawnSidecarWithSeededRecorder() {
  const tempRoot = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-day-loop-ws-"));
  const workspacePath = path.join(tempRoot, "workspace");
  const appSupportPath = path.join(tempRoot, "app-support");
  const homePath = path.join(tempRoot, "home");
  await fs.mkdir(workspacePath, { recursive: true });
  await fs.mkdir(appSupportPath, { recursive: true });
  await fs.mkdir(homePath, { recursive: true });
  const clock = freshRecorderLoopClock();
  await seedRecorder(appSupportPath, clock);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspacePath], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
      AGENTIC30_TEST_STUB_PROVIDER: "1",
      HOME: homePath,
      GH_TOKEN: "",
      GITHUB_TOKEN: "",
    },
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
          // Ignore non-JSON stdout.
        }
      }
    });
  });

  return {
    port: ready.port,
    authToken: ready.authToken,
    workspacePath,
    loopRequest: {
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: clock.startedAt,
      endedAt: clock.endedAt,
      now: clock.now,
    },
    snapshotRelativePath: path.join(
      ".agentic30",
      "recorder",
      "memory-summaries",
      `day-memory-review-${clock.startedAt.slice(0, 10)}.json`,
    ),
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

async function seedRecorder(appSupportPath, clock) {
  const store = new RecorderStore({ appSupportRoot: appSupportPath }).open();
  try {
    recordFrameCaptureEnvelope(store, frameEnvelope(clock));
    store.insertRecord("product_events", {
      id: "event-1",
      workspace_id: "workspace-1",
      project_id: "project-1",
      event_type: "customer_interview",
      occurred_at: clock.productOccurredAt,
      title: "Customer reply candidate",
      summary: "Named founder described activation friction",
      source_ids_json: JSON.stringify([
        { id: "frame-1", source_type: "frame" },
      ]),
      safe_for_search: 1,
      safe_for_memory: 1,
      safe_for_export: 0,
      verification_status: "unverified",
      proof_ledger_event_id: null,
      confidence: "medium",
      created_by: "test",
      created_at: clock.productCreatedAt,
      deleted_at: null,
    });
  } finally {
    store.close();
  }
}

function freshRecorderLoopClock(now = new Date()) {
  const commandNow = new Date(now.getTime() - 5 * 60 * 1000);
  return {
    now: commandNow.toISOString(),
    startedAt: new Date(commandNow.getTime() - 3 * 60 * 60 * 1000).toISOString(),
    endedAt: new Date(commandNow.getTime() + 1000).toISOString(),
    frameCapturedAt: new Date(commandNow.getTime() - 2 * 60 * 60 * 1000).toISOString(),
    productOccurredAt: new Date(commandNow.getTime() - 60 * 60 * 1000).toISOString(),
    productCreatedAt: new Date(commandNow.getTime() - 50 * 60 * 1000).toISOString(),
  };
}

function frameEnvelope(clock) {
  const snapshotSha256 = "f".repeat(64);
  return {
    id: "frame-1",
    workspaceId: "workspace-1",
    projectId: "project-1",
    capturedAt: clock.frameCapturedAt,
    monitorId: "main",
    captureTrigger: "typing_pause",
    appName: "Codex",
    windowTitle: "Founder Memory OS",
    browserDomain: "example.com",
    contentHash: "content-hash-1",
    text: {
      textSource: "accessibility_only",
      accessibilityText: "raw private customer@example.com",
      redactedText: "redacted founder activation friction",
      redactionStatus: "redacted",
      safeForSearch: true,
    },
    privacyState: "searchable_local",
    safeForMemory: true,
    safeForExport: false,
    snapshot: {
      id: "asset-frame-1",
      relativePath: "media/frames/frame-1.jpg",
      sha256: snapshotSha256,
      byteSize: 128,
      encrypted: true,
      encryption: {
        algorithm: "aes-256-gcm",
        keyId: "test-media-key",
        nonce: Buffer.alloc(12, 5).toString("base64"),
        tag: Buffer.alloc(16, 6).toString("base64"),
        ciphertextSha256: `sha256:${snapshotSha256}`,
      },
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

async function waitForEvent(events, predicate, timeoutMs = 10_000) {
  const startedAt = Date.now();
  while (Date.now() - startedAt < timeoutMs) {
    const found = events.find(predicate);
    if (found) return found;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error(`Timed out waiting for event. Saw: ${events.map((event) => event.type).join(", ")}`);
}

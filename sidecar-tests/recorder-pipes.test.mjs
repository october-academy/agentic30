import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderPipeError,
  assertRecorderPipeEndpointAllowed,
  cancelRecorderPipeRun,
  enqueueDueRecorderPipeRuns,
  listBuiltInRecorderPipes,
  persistBuiltInRecorderPipes,
  runQueuedRecorderPipeRuns,
  runBuiltInRecorderPipe,
  validateRecorderPipeDefinition,
} from "../sidecar/recorder-pipes.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

test("recorder pipes define the required built-ins with non-raw permission manifests", () => {
  const pipes = listBuiltInRecorderPipes();
  assert.deepEqual(pipes.map((pipe) => pipe.id), [
    "daily-founder-memory",
    "evidence-inbox-builder",
    "stale-debt-resurfacer",
  ]);
  for (const pipe of pipes) {
    assert.equal(pipe.kind, "built_in");
    assert.equal(pipe.permissions.read.rawAccess, false);
    assert.equal(pipe.path.startsWith(`.agentic30/pipes/${pipe.id}/`), true);
    assert.equal(pipe.proofAcceptedByPipeDefinition, false);
    assert.equal(pipe.actions.every((action) => !["shell", "network", "deploy", "payment_mutation"].includes(action)), true);
    assert.equal(JSON.stringify(pipe).includes("a30_recorder_"), false);
    assert.equal(JSON.stringify(pipe).includes("media/frames"), false);
  }
});

test("recorder pipes persist built-in definitions idempotently without raw tokens or media paths", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-pipes-"));
  const store = new RecorderStore({ appSupportRoot: root }).open();
  try {
    const first = persistBuiltInRecorderPipes({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });
    assert.equal(first.persistedCount, 3);
    assert.equal(first.proofAcceptedByPipes, false);

    const second = persistBuiltInRecorderPipes({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:05:00.000Z"),
    });
    assert.equal(second.persistedCount, 3);

    const rows = store.listRecords("pipe_definitions", { limit: 20 })
      .sort((lhs, rhs) => lhs.id.localeCompare(rhs.id));
    assert.equal(rows.length, 3);
    assert.deepEqual(rows.map((row) => row.id), [
      "daily-founder-memory",
      "evidence-inbox-builder",
      "stale-debt-resurfacer",
    ]);
    assert.equal(rows[0].workspace_id, "workspace-1");
    assert.equal(rows[0].project_id, "project-1");
    assert.equal(rows[0].pipe_kind, "built_in");
    assert.equal(rows[0].updated_at, "2026-06-28T12:05:00.000Z");

    const json = JSON.stringify(rows);
    assert.doesNotMatch(json, /a30_recorder_/);
    assert.doesNotMatch(json, /token_hash/);
    assert.doesNotMatch(json, /media\/frames/);
    assert.doesNotMatch(json, /media\/audio/);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recorder built-in pipe runner records lifecycle rows and redacted output manifests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-pipe-run-"));
  const appSupportRoot = path.join(root, "app-support");
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const store = new RecorderStore({ appSupportRoot }).open();
  try {
    insertRunFixtures(store);
    persistBuiltInRecorderPipes({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    const daily = await runBuiltInRecorderPipe({
      store,
      pipeId: "daily-founder-memory",
      workspaceRoot,
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-28T10:00:00.000Z",
      endedAt: "2026-06-28T12:00:00.000Z",
      now: new Date("2026-06-28T12:01:00.000Z"),
      runId: "run-daily",
    });
    assert.equal(daily.run.status, "succeeded");
    assert.equal(daily.outputManifest.outputKind, "day_memory_review");
    assert.equal(daily.outputManifest.proofAcceptedByPipeRun, false);
    assert.equal(daily.outputManifest.proofBoundary.proofLedgerWriteAllowed, false);
    assert.equal(daily.outputManifest.artifacts[0].persisted, true);
    const summariesDir = path.join(workspaceRoot, ".agentic30", "recorder", "memory-summaries");
    assert.equal((await fs.readdir(summariesDir)).length, 1);

    const evidence = await runBuiltInRecorderPipe({
      store,
      pipeId: "evidence-inbox-builder",
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-28T10:00:00.000Z",
      endedAt: "2026-06-28T12:00:00.000Z",
      now: new Date("2026-06-28T12:02:00.000Z"),
      runId: "run-evidence",
    });
    assert.equal(evidence.run.status, "succeeded");
    assert.equal(evidence.outputManifest.outputKind, "evidence_inbox_candidates");
    assert.equal(evidence.outputManifest.items.createdCount, 1);
    assert.equal(store.listRecords("evidence_candidates", { limit: 10 }).length, 1);

    const stale = await runBuiltInRecorderPipe({
      store,
      pipeId: "stale-debt-resurfacer",
      workspaceId: "workspace-1",
      projectId: "project-1",
      startedAt: "2026-06-28T10:00:00.000Z",
      endedAt: "2026-06-28T12:00:00.000Z",
      now: new Date("2026-06-28T12:03:00.000Z"),
      runId: "run-stale",
    });
    assert.equal(stale.run.status, "succeeded");
    assert.equal(stale.outputManifest.outputKind, "office_hours_next_action_input");
    assert.equal(stale.outputManifest.items.actionId.length > 0, true);

    const runs = store.listRecords("pipe_runs", { limit: 10 }).sort((lhs, rhs) => lhs.id.localeCompare(rhs.id));
    assert.deepEqual(runs.map((run) => [run.id, run.status]), [
      ["run-daily", "succeeded"],
      ["run-evidence", "succeeded"],
      ["run-stale", "succeeded"],
    ]);
    for (const run of runs) {
      const output = JSON.parse(run.output_manifest_json);
      assert.equal(output.proofAcceptedByPipeRun, false);
      assert.equal(output.proofBoundary.proofLedgerWriteAllowed, false);
    }
    const json = JSON.stringify({ daily, evidence, stale, runs });
    assert.doesNotMatch(json, /customer@example\.com/);
    assert.doesNotMatch(json, /secret token/);
    assert.doesNotMatch(json, /accessibility_text/);
    assert.doesNotMatch(json, /ocr_text/);
    assert.doesNotMatch(json, /browser_url/);
    assert.doesNotMatch(json, /document_path/);
    assert.doesNotMatch(json, /relative_path/);
    assert.doesNotMatch(json, /media\/frames/);
    assert.doesNotMatch(json, /a30_recorder_/);
    assert.doesNotMatch(json, /token_hash/);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recorder pipe runner records timed out and cancelled runs as incomplete non-proof manifests", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-pipe-incomplete-"));
  const store = new RecorderStore({ appSupportRoot: root }).open();
  try {
    insertRunFixtures(store);
    persistBuiltInRecorderPipes({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    await assert.rejects(
      () => runBuiltInRecorderPipe({
        store,
        pipeId: "daily-founder-memory",
        workspaceId: "workspace-1",
        projectId: "project-1",
        startedAt: "2026-06-28T10:00:00.000Z",
        endedAt: "2026-06-28T12:00:00.000Z",
        now: new Date("2026-06-28T12:04:00.000Z"),
        runId: "run-timeout",
        timeoutMs: 0,
      }),
      (error) => error instanceof RecorderPipeError
        && error.code === "ERR_RECORDER_PIPE_TIMEOUT",
    );
    const timedOut = store.getRecord("pipe_runs", "run-timeout");
    assert.equal(timedOut.status, "timed_out");
    assert.match(timedOut.error_message, /ERR_RECORDER_PIPE_TIMEOUT/);
    const timedOutManifest = JSON.parse(timedOut.output_manifest_json);
    assert.equal(timedOutManifest.outputKind, "pipe_timed_out");
    assert.equal(timedOutManifest.items.complete, false);
    assert.equal(timedOutManifest.proofBoundary.proofLedgerWriteAllowed, false);

    store.insertRecord("pipe_runs", {
      id: "run-queued-cancel",
      pipe_id: "daily-founder-memory",
      workspace_id: "workspace-1",
      project_id: "project-1",
      trigger_reason: "scheduler",
      status: "queued",
      started_at: "2026-06-28T12:05:00.000Z",
      ended_at: null,
      input_manifest_json: JSON.stringify({ pipe_id: "daily-founder-memory", run_id: "run-queued-cancel" }),
      output_manifest_json: null,
      audit_log_json: JSON.stringify([]),
      error_message: "",
    });
    const cancelled = cancelRecorderPipeRun({
      store,
      runId: "run-queued-cancel",
      reason: "manual test cancel",
      now: new Date("2026-06-28T12:06:00.000Z"),
    });
    assert.equal(cancelled.pipeRun.status, "cancelled");
    assert.equal(cancelled.outputManifest.outputKind, "pipe_cancelled");
    assert.equal(cancelled.outputManifest.items.complete, false);
    assert.equal(cancelled.outputManifest.proofAcceptedByPipeRun, false);

    const json = JSON.stringify([timedOutManifest, cancelled.outputManifest]);
    assert.doesNotMatch(json, /customer@example\.com/);
    assert.doesNotMatch(json, /secret token/);
    assert.doesNotMatch(json, /accessibility_text/);
    assert.doesNotMatch(json, /ocr_text/);
    assert.doesNotMatch(json, /browser_url/);
    assert.doesNotMatch(json, /document_path/);
    assert.doesNotMatch(json, /relative_path/);
    assert.doesNotMatch(json, /token_hash/);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recorder pipe scheduler enqueues due built-ins idempotently and drains queued runs", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-pipe-scheduler-"));
  const appSupportRoot = path.join(root, "app-support");
  const workspaceRoot = path.join(root, "workspace");
  await fs.mkdir(workspaceRoot, { recursive: true });
  const store = new RecorderStore({ appSupportRoot }).open();
  try {
    insertRunFixtures(store);
    persistBuiltInRecorderPipes({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date(2026, 5, 28, 12, 0, 0),
    });

    const beforeDue = enqueueDueRecorderPipeRuns({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date(2026, 5, 28, 17, 59, 0),
    });
    assert.equal(beforeDue.queuedCount, 0);
    assert.equal(beforeDue.skipped.every((item) => item.reason === "not_due"), true);

    const queued = enqueueDueRecorderPipeRuns({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date(2026, 5, 28, 18, 12, 0),
    });
    assert.equal(queued.queuedCount, 3);
    assert.equal(queued.proofAcceptedByScheduler, false);
    assert.equal(queued.proofBoundary.proofLedgerWriteAllowed, false);
    assert.deepEqual(queued.queued.map((run) => run.status), ["queued", "queued", "queued"]);
    assert.equal(queued.queued[0].inputManifest.schedulerState.scheduleTimeZone, "local");

    const duplicate = enqueueDueRecorderPipeRuns({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date(2026, 5, 28, 18, 13, 0),
    });
    assert.equal(duplicate.queuedCount, 0);
    assert.equal(duplicate.skipped.every((item) => item.reason === "already_scheduled"), true);

    const drained = await runQueuedRecorderPipeRuns({
      store,
      workspaceRoot,
      now: new Date(2026, 5, 28, 18, 14, 0),
    });
    assert.equal(drained.executedCount, 3);
    assert.equal(drained.failedCount, 0);
    assert.equal(drained.executed.every((run) => run.status === "succeeded"), true);

    const runs = store.listRecords("pipe_runs", { limit: 10 });
    assert.equal(runs.filter((run) => run.status === "succeeded").length, 3);
    const json = JSON.stringify({ queued, duplicate, drained, runs });
    assert.doesNotMatch(json, /customer@example\.com/);
    assert.doesNotMatch(json, /secret token/);
    assert.doesNotMatch(json, /accessibility_text/);
    assert.doesNotMatch(json, /ocr_text/);
    assert.doesNotMatch(json, /browser_url/);
    assert.doesNotMatch(json, /document_path/);
    assert.doesNotMatch(json, /relative_path/);
    assert.doesNotMatch(json, /token_hash/);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recorder pipe validation rejects blocked actions, raw access, raw endpoints, and unsafe write scopes", () => {
  const [pipe] = listBuiltInRecorderPipes();

  for (const action of [
    "shell",
    "shell.exec",
    "network.fetch",
    "browser_automation.click",
    "customer_outreach.dm",
    "public_post.threads",
    "deploy.production",
    "payment_mutation.refund",
    "raw_file_read.workspace",
    "raw_media_read.frame",
  ]) {
    assert.throws(
      () => validateRecorderPipeDefinition({
        ...pipe,
        actions: ["recorder.search", action],
      }),
      (error) => error instanceof RecorderPipeError
        && error.code === "ERR_RECORDER_PIPE_ACTION_BLOCKED",
      action,
    );
  }

  assert.throws(
    () => validateRecorderPipeDefinition({
      ...pipe,
      permissions: {
        ...pipe.permissions,
        read: {
          ...pipe.permissions.read,
          raw_access: true,
        },
      },
    }),
    (error) => error instanceof RecorderPipeError
      && error.code === "ERR_RECORDER_PIPE_RAW_ACCESS_DENIED",
  );

  assert.throws(
    () => validateRecorderPipeDefinition({
      ...pipe,
      permissions: {
        ...pipe.permissions,
        endpoints: ["GET /recorder/audio/audio-1/media"],
      },
    }),
    (error) => error instanceof RecorderPipeError
      && error.code === "ERR_RECORDER_PIPE_RAW_ENDPOINT_DENIED",
  );

  assert.throws(
    () => validateRecorderPipeDefinition({
      ...pipe,
      permissions: {
        ...pipe.permissions,
        write: {
          ...pipe.permissions.write,
          files_under: ".agentic30/pipes/other-pipe/",
        },
      },
    }),
    (error) => error instanceof RecorderPipeError
      && error.code === "ERR_RECORDER_PIPE_WRITE_SCOPE_DENIED",
  );
});

test("recorder pipe runner records failed lifecycle rows with named root causes", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-pipe-fail-"));
  const store = new RecorderStore({ appSupportRoot: root }).open();
  try {
    await assert.rejects(
      () => runBuiltInRecorderPipe({
        store,
        pipeId: "daily-founder-memory",
        workspaceId: "workspace-1",
        projectId: "project-1",
        startedAt: "2026-06-28T10:00:00.000Z",
        endedAt: "2026-06-28T12:00:00.000Z",
        runId: "run-missing-definition",
      }),
      (error) => error instanceof RecorderPipeError
        && error.code === "ERR_RECORDER_PIPE_DEFINITION_NOT_PERSISTED",
    );

    persistBuiltInRecorderPipes({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });
    insertUnsafeBuilderEvent(store);
    await assert.rejects(
      () => runBuiltInRecorderPipe({
        store,
        pipeId: "evidence-inbox-builder",
        workspaceId: "workspace-1",
        projectId: "project-1",
        startedAt: "2026-06-28T10:00:00.000Z",
        endedAt: "2026-06-28T12:00:00.000Z",
        now: new Date("2026-06-28T12:04:00.000Z"),
        runId: "run-failed",
      }),
      (error) => error.code === "ERR_RECORDER_EVIDENCE_BUILDER_UNSAFE_PRODUCT_EVENT_TEXT",
    );
    const failed = store.getRecord("pipe_runs", "run-failed");
    assert.equal(failed.status, "failed");
    assert.match(failed.error_message, /ERR_RECORDER_EVIDENCE_BUILDER_UNSAFE_PRODUCT_EVENT_TEXT/);
    assert.equal(failed.output_manifest_json, null);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recorder pipe runner rejects raw-looking output manifest values", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-pipe-output-safe-"));
  const store = new RecorderStore({ appSupportRoot: root }).open();
  try {
    insertRunFixtures(store);
    insertUnsafeOutputCandidate(store);
    persistBuiltInRecorderPipes({
      store,
      workspaceId: "workspace-1",
      projectId: "project-1",
      now: new Date("2026-06-28T12:00:00.000Z"),
    });

    await assert.rejects(
      () => runBuiltInRecorderPipe({
        store,
        pipeId: "stale-debt-resurfacer",
        workspaceId: "workspace-1",
        projectId: "project-1",
        startedAt: "2026-06-28T10:00:00.000Z",
        endedAt: "2026-06-28T12:00:00.000Z",
        now: new Date("2026-06-28T12:05:00.000Z"),
        runId: "run-unsafe-output",
      }),
      (error) => error instanceof RecorderPipeError
        && error.code === "ERR_RECORDER_PIPE_OUTPUT_RAW_VALUE"
        && error.details.fieldPath === "sourceIds.0"
        && error.details.rule === "filesystem_or_media_path",
    );
    const failed = store.getRecord("pipe_runs", "run-unsafe-output");
    assert.equal(failed.status, "failed");
    assert.match(failed.error_message, /ERR_RECORDER_PIPE_OUTPUT_RAW_VALUE/);
    assert.equal(failed.output_manifest_json, null);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

function insertRunFixtures(store) {
  store.insertRecord("media_assets", {
    id: "asset-frame-1",
    asset_type: "frame_jpeg",
    relative_path: "media/frames/frame-1.jpg",
    sha256: "sha256-frame-1",
    byte_size: 128,
    encrypted: 1,
    workspace_id: "workspace-1",
    project_id: "project-1",
    created_at: "2026-06-28T10:00:00.000Z",
  });
  store.insertRecord("frames", {
    id: "frame-1",
    schema_version: 1,
    workspace_id: "workspace-1",
    project_id: "project-1",
    captured_at: "2026-06-28T10:01:00.000Z",
    monitor_id: "main",
    capture_trigger: "app_switch",
    app_name: "Agentic30",
    window_title: "Day Memory Review",
    browser_url: "https://example.com/customer?token=secret",
    browser_domain: "example.com",
    browser_url_normalized: "https://example.com/customer",
    document_path: "/Users/october/private/customer.md",
    snapshot_asset_id: "asset-frame-1",
    snapshot_sha256: "sha256-frame-1",
    content_hash: "content-hash-1",
    simhash: "",
    text_source: "accessibility",
    accessibility_text: "raw customer@example.com secret token",
    ocr_text: "raw OCR secret token",
    redacted_text: "customer asked for activation evidence",
    redaction_status: "redacted",
    privacy_state: "searchable_local",
    data_class: "frame",
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    created_at: "2026-06-28T10:02:00.000Z",
    deleted_at: null,
  });
  store.insertRecord("product_events", {
    id: "event-ask-sent",
    workspace_id: "workspace-1",
    project_id: "project-1",
    event_type: "customer_ask_sent",
    occurred_at: "2026-06-28T10:20:00.000Z",
    title: "Asked a customer to try the flow",
    summary: "Sent a redacted customer ask for activation evidence",
    source_ids_json: JSON.stringify([{ id: "frame-1", source_type: "frame" }]),
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    verification_status: "unverified",
    proof_ledger_event_id: null,
    confidence: "medium",
    created_by: "test",
    created_at: "2026-06-28T10:21:00.000Z",
  });
}

function insertUnsafeOutputCandidate(store) {
  store.insertRecord("evidence_candidates", {
    id: "candidate-unsafe-output",
    workspace_id: "workspace-1",
    project_id: "project-1",
    candidate_status: "pending_review",
    source_state: "memory_safe",
    claim: "Pending evidence candidate with unsafe source identity.",
    proof_kind: "customer_reply",
    source_ids_json: JSON.stringify([{ id: "media/frames/leaked-frame.jpg", source_kind: "raw_frame" }]),
    proof_ledger_mapping_json: JSON.stringify({
      targetGate: "customer_evidence",
      event: {
        type: "interview",
        status: "submitted",
        strength: "medium",
      },
    }),
    evidence_debt_json: JSON.stringify([
      "Attach external customer evidence before approving this candidate.",
    ]),
    immutable_fingerprint: "sha256:candidate-unsafe-output",
    idempotency_key: "candidate-unsafe-output",
    verifier_result_json: null,
    proof_ledger_event_id: null,
    created_by: "test",
    created_at: "2026-06-28T10:25:00.000Z",
    reviewed_at: null,
    deleted_at: null,
  });
}

function insertUnsafeBuilderEvent(store) {
  store.insertRecord("product_events", {
    id: "event-unsafe",
    workspace_id: "workspace-1",
    project_id: "project-1",
    event_type: "customer_ask_sent",
    occurred_at: "2026-06-28T10:20:00.000Z",
    title: "Unsafe customer ask",
    summary: "customer@example.com secret token",
    source_ids_json: JSON.stringify([{ id: "frame-1", source_type: "frame" }]),
    safe_for_search: 1,
    safe_for_memory: 1,
    safe_for_export: 0,
    verification_status: "unverified",
    proof_ledger_event_id: null,
    confidence: "medium",
    created_by: "test",
    created_at: "2026-06-28T10:21:00.000Z",
  });
}

test("recorder pipe endpoint checks deny undeclared endpoint access", () => {
  const [pipe] = listBuiltInRecorderPipes();
  const allowed = assertRecorderPipeEndpointAllowed(pipe, "GET /recorder/search");
  assert.equal(allowed.allowed, true);
  assert.equal(allowed.rawAccessApproved, false);

  assert.throws(
    () => assertRecorderPipeEndpointAllowed(pipe, "GET /recorder/transcripts"),
    (error) => error instanceof RecorderPipeError
      && error.code === "ERR_RECORDER_PIPE_ENDPOINT_DENIED",
  );
});

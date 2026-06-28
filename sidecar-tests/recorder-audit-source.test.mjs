import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { recordRecorderAudit } from "../sidecar/recorder-raw-api-auth.mjs";
import {
  RecorderAuditSourceError,
  buildRecorderAuditSource,
} from "../sidecar/recorder-audit-source.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

test("recorder audit source lists sanitized non-proof audit rows", async () => {
  const { root, store } = await makeContext();
  try {
    recordRecorderAudit({
      store,
      requestId: "request-health",
      actorType: "local_user",
      actorId: "runtime-test-client",
      workspaceId: "workspace-1",
      projectId: "project-1",
      endpoint: "/recorder/health",
      accessLevel: "summary",
      sourceIds: [{ id: "frame-1", source_type: "frame" }],
      decision: "accepted",
      reason: "authorized_raw_read",
      now: new Date("2026-06-28T10:00:00.000Z"),
    });
    recordRecorderAudit({
      store,
      requestId: "request-denied",
      actorType: "anonymous",
      actorId: "unknown",
      workspaceId: "workspace-1",
      projectId: "project-1",
      endpoint: "/recorder/frames/frame-1/text",
      accessLevel: "raw_frame",
      sourceIds: [{ id: "frame-1", source_type: "frame" }],
      decision: "denied",
      reason: "ERR_RECORDER_RAW_API_PERMISSION_DENIED",
      now: new Date("2026-06-28T10:01:00.000Z"),
    });
    store.insertRecord("api_tokens", {
      id: "token-1",
      token_hash: "sha256:should-not-leak",
      client_id: "runtime-test-client",
      client_name: "Runtime test",
      actor_type: "local_user",
      scopes_json: JSON.stringify(["summary"]),
      issued_by: "test",
      issued_at: "2026-06-28T09:59:00.000Z",
      expires_at: "2026-06-28T10:59:00.000Z",
      revoked_at: null,
      last_used_at: null,
    });

    const source = buildRecorderAuditSource({
      store,
      workspaceId: "workspace-1",
      decision: "accepted",
      now: new Date("2026-06-28T10:02:00.000Z"),
    });

    assert.equal(source.schema, "agentic30.recorder.audit_source.v1");
    assert.equal(source.schemaVersion, 1);
    assert.equal(source.generatedAt, "2026-06-28T10:02:00.000Z");
    assert.equal(source.proofAcceptedByAuditSource, false);
    assert.equal(source.proofBoundary.proofLedgerWriteAllowed, false);
    assert.equal(source.resultCount, 1);
    assert.equal(source.audit[0].requestId, "request-health");
    assert.equal(source.audit[0].endpoint, "/recorder/health");
    assert.equal(source.audit[0].accessLevel, "summary");
    assert.equal(source.audit[0].decision, "accepted");
    assert.deepEqual(source.audit[0].sourceIds, [{ id: "frame-1", sourceType: "frame", source_type: "frame" }]);

    const json = JSON.stringify(source);
    assert.doesNotMatch(json, /token_hash/);
    assert.doesNotMatch(json, /sha256:should-not-leak/);
    assert.doesNotMatch(json, /a30_recorder_/);
    assert.doesNotMatch(json, /\/Users\//);
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("recorder audit source filters and fails closed for invalid inputs or unsafe source ids", async () => {
  const { root, store } = await makeContext();
  try {
    recordRecorderAudit({
      store,
      requestId: "request-raw-frame",
      actorType: "local_user",
      actorId: "runtime-test-client",
      workspaceId: "workspace-1",
      projectId: "project-1",
      endpoint: "/recorder/frames/frame-1/image",
      accessLevel: "raw_frame",
      sourceIds: [{ id: "frame-1", source_type: "frame" }],
      decision: "accepted",
      reason: "authorized_raw_read",
      now: new Date("2026-06-28T10:00:00.000Z"),
    });
    recordRecorderAudit({
      store,
      requestId: "request-other",
      actorType: "local_user",
      actorId: "runtime-test-client",
      workspaceId: "workspace-2",
      projectId: "project-2",
      endpoint: "/recorder/search",
      accessLevel: "search",
      sourceIds: [],
      decision: "accepted",
      reason: "authorized_raw_read",
      now: new Date("2026-06-28T10:01:00.000Z"),
    });

    const filtered = buildRecorderAuditSource({
      store,
      workspaceId: "workspace-1",
      accessLevel: "raw_frame",
      limit: 1,
    });
    assert.equal(filtered.resultCount, 1);
    assert.equal(filtered.audit[0].requestId, "request-raw-frame");
    assert.equal(filtered.filters.limit, 1);

    assert.throws(
      () => buildRecorderAuditSource({ store, accessLevel: "filesystem" }),
      (error) => error instanceof RecorderAuditSourceError
        && error.code === "ERR_RECORDER_AUDIT_SOURCE_ACCESS_LEVEL_UNKNOWN",
    );
    assert.throws(
      () => buildRecorderAuditSource({ store, decision: "allowed" }),
      (error) => error instanceof RecorderAuditSourceError
        && error.code === "ERR_RECORDER_AUDIT_SOURCE_DECISION_UNKNOWN",
    );
    assert.throws(
      () => buildRecorderAuditSource({ store, limit: 0 }),
      (error) => error instanceof RecorderAuditSourceError
        && error.code === "ERR_RECORDER_AUDIT_SOURCE_INVALID_LIMIT",
    );

    store.insertRecord("recorder_audit", {
      id: "audit-unsafe-source",
      request_id: "request-unsafe",
      actor_type: "local_user",
      actor_id: "runtime-test-client",
      workspace_id: "workspace-1",
      project_id: "project-1",
      endpoint: "/recorder/frames/frame-1/image",
      access_level: "raw_frame",
      source_ids_json: JSON.stringify([{ id: "/Users/october/private/frame.jpg", source_type: "frame" }]),
      decision: "accepted",
      reason: "authorized_raw_read",
      created_at: "2026-06-28T10:02:00.000Z",
    });
    assert.throws(
      () => buildRecorderAuditSource({ store, workspaceId: "workspace-1" }),
      (error) => error instanceof RecorderAuditSourceError
        && error.code === "ERR_RECORDER_AUDIT_SOURCE_ID_UNSAFE",
    );
  } finally {
    store.close();
    await fs.rm(root, { recursive: true, force: true });
  }
});

async function makeContext() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-audit-source-"));
  const store = new RecorderStore({ appSupportRoot: root }).open();
  return { root, store };
}

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { RecorderRawApiAuthError } from "../sidecar/recorder-raw-api-auth.mjs";
import {
  RecorderMcpGrantError,
  assertPersistedRecorderMcpAccess,
  findActiveRecorderMcpGrant,
  grantRecorderMcpAccess,
  listRecorderMcpGrants,
  revokeRecorderMcpGrant,
  resolveRecorderMcpGrantsPath,
} from "../sidecar/recorder-mcp-grants.mjs";

test("recorder MCP grants persist raw scoped tool grants without raw tokens", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-mcp-grants-"));
  try {
    await assert.rejects(
      () => assertPersistedRecorderMcpAccess({
        appSupportPath,
        toolName: "recorder.rawFrame",
        accessLevel: "raw_frame",
        now: new Date("2026-06-28T10:00:00.000Z"),
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_MCP_RAW_ACCESS_DENIED",
    );

    const grant = await grantRecorderMcpAccess({
      appSupportPath,
      toolName: "recorder.rawFrame",
      accessLevels: ["raw_frame"],
      ttlMs: 60_000,
      grantedBy: "test-user",
      reason: "inspect one frame",
      now: new Date("2026-06-28T10:00:00.000Z"),
      idFactory: () => "grant-raw-frame-1",
    });
    assert.equal(grant.id, "grant-raw-frame-1");
    assert.equal(grant.toolName, "recorder.rawFrame");
    assert.deepEqual(grant.accessLevels, ["raw_frame"]);
    assert.equal(grant.expiresAt, "2026-06-28T10:01:00.000Z");

    const allowed = await assertPersistedRecorderMcpAccess({
      appSupportPath,
      toolName: "recorder.rawFrame",
      accessLevel: "raw_frame",
      now: new Date("2026-06-28T10:00:30.000Z"),
    });
    assert.equal(allowed.decision, "scoped_grant");

    const active = await findActiveRecorderMcpGrant({
      appSupportPath,
      toolName: "recorder.rawFrame",
      accessLevel: "raw_frame",
      now: new Date("2026-06-28T10:00:30.000Z"),
    });
    assert.equal(active.id, "grant-raw-frame-1");

    const grants = await listRecorderMcpGrants({
      appSupportPath,
      now: new Date("2026-06-28T10:00:30.000Z"),
    });
    assert.equal(grants.length, 1);
    assert.equal(grants[0].state, "active");
    assert.equal(grants[0].active, true);

    await assert.rejects(
      () => assertPersistedRecorderMcpAccess({
        appSupportPath,
        toolName: "recorder.otherTool",
        accessLevel: "raw_frame",
        now: new Date("2026-06-28T10:00:30.000Z"),
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_MCP_RAW_ACCESS_DENIED",
    );

    await assert.rejects(
      () => assertPersistedRecorderMcpAccess({
        appSupportPath,
        toolName: "recorder.rawFrame",
        accessLevel: "raw_frame",
        now: new Date("2026-06-28T10:01:00.001Z"),
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_MCP_RAW_ACCESS_DENIED",
    );

    const json = await fs.readFile(resolveRecorderMcpGrantsPath(appSupportPath), "utf8");
    assert.doesNotMatch(json, /a30_recorder_/);
    assert.doesNotMatch(json, /token_hash/);
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("recorder MCP grants fail closed for invalid scopes, overlong TTL, raw_admin without confirmation, and revoked grants", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-mcp-grants-"));
  try {
    await assert.rejects(
      () => grantRecorderMcpAccess({
        appSupportPath,
        toolName: "recorder.search",
        accessLevels: ["search"],
        ttlMs: 60_000,
      }),
      (error) => error instanceof RecorderMcpGrantError
        && error.code === "ERR_RECORDER_MCP_GRANT_RAW_ACCESS_REQUIRED",
    );
    await assert.rejects(
      () => grantRecorderMcpAccess({
        appSupportPath,
        toolName: "recorder.rawFrame",
        accessLevels: ["raw_frame"],
        ttlMs: 16 * 60 * 1000,
      }),
      (error) => error instanceof RecorderMcpGrantError
        && error.code === "ERR_RECORDER_MCP_GRANT_TTL_TOO_LONG",
    );
    await assert.rejects(
      () => grantRecorderMcpAccess({
        appSupportPath,
        toolName: "recorder.admin",
        accessLevels: ["raw_admin"],
        ttlMs: 60_000,
      }),
      (error) => error instanceof RecorderMcpGrantError
        && error.code === "ERR_RECORDER_MCP_RAW_ADMIN_CONFIRMATION_REQUIRED",
    );

    const grant = await grantRecorderMcpAccess({
      appSupportPath,
      toolName: "recorder.rawAudio",
      accessLevels: ["raw_audio"],
      ttlMs: 60_000,
      now: new Date("2026-06-28T10:00:00.000Z"),
      idFactory: () => "grant-raw-audio-1",
    });
    const revoked = await revokeRecorderMcpGrant({
      appSupportPath,
      grantId: grant.id,
      revokedBy: "test-user",
      now: new Date("2026-06-28T10:00:10.000Z"),
    });
    assert.equal(revoked.state, "revoked");
    assert.equal(revoked.active, false);

    await assert.rejects(
      () => assertPersistedRecorderMcpAccess({
        appSupportPath,
        toolName: "recorder.rawAudio",
        accessLevel: "raw_audio",
        now: new Date("2026-06-28T10:00:20.000Z"),
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_MCP_RAW_ACCESS_DENIED",
    );
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

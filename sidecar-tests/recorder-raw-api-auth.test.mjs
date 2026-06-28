import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  RecorderRawApiAuthError,
  assertRecorderMcpAccess,
  authorizeRecorderRawRead,
  issueRecorderApiToken,
  isRecorderMcpAccessAllowedByDefault,
  revokeRecorderApiToken,
  validateRecorderApiToken,
} from "../sidecar/recorder-raw-api-auth.mjs";
import { RecorderStore } from "../sidecar/recorder-store.mjs";

async function makeStore() {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-recorder-raw-api-auth-"));
  const store = new RecorderStore({ appSupportRoot: root }).open();
  return { root, store };
}

function issueSearchToken(store, overrides = {}) {
  return issueRecorderApiToken({
    store,
    clientId: "app-ui",
    clientName: "Agentic30 App UI",
    scopes: ["search"],
    issuedBy: "launch-auth-bridge",
    ttlMs: 60_000,
    now: new Date("2026-06-28T10:00:00.000Z"),
    tokenFactory: () => "a30_recorder_test_search_token",
    ...overrides,
  });
}

test("issueRecorderApiToken stores only token hash and validateRecorderApiToken updates last_used_at", async () => {
  const { store } = await makeStore();
  try {
    const issued = issueSearchToken(store);

    assert.equal(issued.token, "a30_recorder_test_search_token");
    assert.equal(issued.scopes.join(","), "search");
    const rows = store.listRecords("api_tokens");
    assert.equal(rows.length, 1);
    assert.equal(rows[0].token, undefined);
    assert.match(rows[0].token_hash, /^sha256:[a-f0-9]{64}$/);
    assert.doesNotMatch(rows[0].token_hash, /test_search_token/);

    const context = validateRecorderApiToken({
      store,
      token: issued.token,
      requiredAccessLevel: "summary",
      now: new Date("2026-06-28T10:00:30.000Z"),
    });
    assert.equal(context.clientId, "app-ui");
    assert.equal(context.accessLevel, "summary");
    assert.equal(context.canExposeFilesystemPaths, false);
    assert.equal(store.getRecord("api_tokens", issued.tokenId).last_used_at, "2026-06-28T10:00:30.000Z");
  } finally {
    store.close();
  }
});

test("issueRecorderApiToken fails closed for overlong raw TTL and missing raw_admin confirmation", async () => {
  const { store } = await makeStore();
  try {
    assert.throws(
      () => issueRecorderApiToken({
        store,
        clientId: "debugger",
        clientName: "Debug Tool",
        scopes: ["raw_frame"],
        issuedBy: "test",
        ttlMs: 60 * 60 * 1000,
        tokenFactory: () => "a30_recorder_raw_frame_token",
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_RAW_API_TOKEN_TTL_TOO_LONG",
    );
    assert.throws(
      () => issueRecorderApiToken({
        store,
        clientId: "admin",
        clientName: "Raw Admin",
        scopes: ["raw_admin"],
        issuedBy: "test",
        ttlMs: 60_000,
        tokenFactory: () => "a30_recorder_raw_admin_token",
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_RAW_API_RAW_ADMIN_CONFIRMATION_REQUIRED",
    );
  } finally {
    store.close();
  }
});

test("authorizeRecorderRawRead accepts trusted origins and writes accepted audit rows", async () => {
  const { store } = await makeStore();
  try {
    const issued = issueRecorderApiToken({
      store,
      clientId: "timeline-ui",
      clientName: "Timeline UI",
      scopes: ["raw_frame"],
      issuedBy: "launch-auth-bridge",
      ttlMs: 60_000,
      now: new Date("2026-06-28T10:00:00.000Z"),
      tokenFactory: () => "a30_recorder_raw_frame_ok",
    });

    const result = authorizeRecorderRawRead({
      store,
      token: issued.token,
      requiredAccessLevel: "raw_frame",
      endpoint: "/recorder/frames/frame-1/image",
      origin: "http://127.0.0.1:5138",
      requestId: "request-1",
      workspaceId: "workspace-1",
      projectId: "project-1",
      sourceIds: [{ id: "frame-1", source_type: "frame" }],
      now: new Date("2026-06-28T10:00:30.000Z"),
    });

    assert.equal(result.authorized, true);
    assert.equal(result.canExposeFilesystemPaths, false);
    assert.equal(result.audit.decision, "accepted");
    const audits = store.listRecords("recorder_audit");
    assert.equal(audits.length, 1);
    assert.equal(audits[0].request_id, "request-1");
    assert.equal(audits[0].actor_id, "timeline-ui");
    assert.equal(audits[0].endpoint, "/recorder/frames/frame-1/image");
    assert.equal(audits[0].access_level, "raw_frame");
    assert.equal(audits[0].decision, "accepted");
    assert.deepEqual(JSON.parse(audits[0].source_ids_json), [{ id: "frame-1", source_type: "frame" }]);
  } finally {
    store.close();
  }
});

test("authorizeRecorderRawRead writes denied audit rows for permission and origin failures", async () => {
  const { store } = await makeStore();
  try {
    const issued = issueSearchToken(store);

    assert.throws(
      () => authorizeRecorderRawRead({
        store,
        token: issued.token,
        requiredAccessLevel: "raw_frame",
        endpoint: "/recorder/frames/frame-1/image",
        origin: "http://127.0.0.1:5138",
        requestId: "request-denied-scope",
        sourceIds: ["frame-1"],
        now: new Date("2026-06-28T10:00:30.000Z"),
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_RAW_API_PERMISSION_DENIED",
    );
    assert.throws(
      () => authorizeRecorderRawRead({
        store,
        token: issued.token,
        requiredAccessLevel: "search",
        endpoint: "/recorder/search",
        origin: "https://evil.example",
        requestId: "request-denied-origin",
        sourceIds: [],
        now: new Date("2026-06-28T10:00:40.000Z"),
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_RAW_API_ORIGIN_DENIED",
    );

    const audits = store.listRecords("recorder_audit");
    assert.equal(audits.length, 2);
    assert.equal(audits[0].decision, "denied");
    assert.equal(audits[0].reason, "ERR_RECORDER_RAW_API_PERMISSION_DENIED");
    assert.equal(audits[1].actor_id, "unknown");
    assert.equal(audits[1].reason, "ERR_RECORDER_RAW_API_ORIGIN_DENIED");
  } finally {
    store.close();
  }
});

test("validateRecorderApiToken fails closed after revocation and expiry", async () => {
  const { store } = await makeStore();
  try {
    const revoked = issueSearchToken(store);
    revokeRecorderApiToken({
      store,
      tokenId: revoked.tokenId,
      revokedAt: new Date("2026-06-28T10:00:10.000Z"),
    });
    assert.throws(
      () => validateRecorderApiToken({
        store,
        token: revoked.token,
        requiredAccessLevel: "search",
        now: new Date("2026-06-28T10:00:20.000Z"),
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_RAW_API_TOKEN_REVOKED",
    );

    const expired = issueRecorderApiToken({
      store,
      clientId: "short-lived",
      clientName: "Short Lived",
      scopes: ["search"],
      issuedBy: "test",
      ttlMs: 1_000,
      now: new Date("2026-06-28T10:00:00.000Z"),
      tokenFactory: () => "a30_recorder_expired_token",
    });
    assert.throws(
      () => validateRecorderApiToken({
        store,
        token: expired.token,
        requiredAccessLevel: "search",
        now: new Date("2026-06-28T10:00:01.001Z"),
      }),
      (error) => error instanceof RecorderRawApiAuthError
        && error.code === "ERR_RECORDER_RAW_API_TOKEN_EXPIRED",
    );
  } finally {
    store.close();
  }
});

test("MCP recorder policy allows redacted defaults and denies raw access without scoped grant", () => {
  assert.equal(isRecorderMcpAccessAllowedByDefault("summary"), true);
  assert.equal(isRecorderMcpAccessAllowedByDefault("search"), true);
  assert.equal(isRecorderMcpAccessAllowedByDefault("raw_frame"), false);
  assert.throws(
    () => assertRecorderMcpAccess({ accessLevel: "raw_frame", toolName: "recorder.rawFrame" }),
    (error) => error instanceof RecorderRawApiAuthError
      && error.code === "ERR_RECORDER_MCP_RAW_ACCESS_DENIED",
  );
  const allowed = assertRecorderMcpAccess({
    accessLevel: "raw_frame",
    toolName: "recorder.rawFrame",
    grant: {
      granted: true,
      toolName: "recorder.rawFrame",
      accessLevels: ["raw_frame"],
      expiresAt: "2026-06-28T10:05:00.000Z",
    },
    now: new Date("2026-06-28T10:00:00.000Z"),
  });
  assert.equal(allowed.decision, "scoped_grant");
  assert.throws(
    () => assertRecorderMcpAccess({
      accessLevel: "raw_frame",
      toolName: "recorder.rawFrame",
      grant: {
        granted: true,
        toolName: "recorder.rawFrame",
        accessLevels: ["raw_frame"],
        expiresAt: "2026-06-28T09:59:59.000Z",
      },
      now: new Date("2026-06-28T10:00:00.000Z"),
    }),
    (error) => error instanceof RecorderRawApiAuthError
      && error.code === "ERR_RECORDER_MCP_GRANT_EXPIRED",
  );
});

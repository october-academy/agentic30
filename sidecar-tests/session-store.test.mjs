import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  CURRENT_DEFAULT_CODEX_MODEL,
  LEGACY_DEFAULT_CODEX_MODEL,
  SESSION_STORE_SCHEMA_VERSION,
  loadSessionsFromFile,
  normalizePersistedSessionsPayload,
  persistSessionsToFile,
} from "../sidecar/session-store.mjs";

test("normalizes legacy session payloads on startup", () => {
  const sessions = normalizePersistedSessionsPayload({
    sessions: [
      {
        id: "session-1",
        status: "running",
        pendingUserInput: { requestId: "request-1" },
      },
      {
        id: "session-2",
        status: "awaiting_input",
        pendingUserInput: { requestId: "request-2" },
      },
      {
        id: "session-3",
        status: "error",
        error: "stale failure",
        messages: [
          {
            id: "message-1",
            state: "error",
            error: "stale message failure",
          },
        ],
      },
      {
        id: "session-4",
        status: "idle",
        messages: [
          {
            id: "message-2",
            role: "assistant",
            state: "final",
            content: "spawn /tmp/@openai/codex-sdk/vendor/aarch64-apple-darwin/codex/codex ENOENT",
          },
          {
            id: "message-3",
            role: "assistant",
            state: "streaming",
            content: "",
          },
          {
            id: "message-4",
            role: "assistant",
            state: "final",
            content: "real answer",
          },
          {
            id: "message-5",
            role: "assistant",
            state: "error",
            error: "replaceAssistantText is not defined",
            content: "Starting Office Hours doc interview...\n\n",
          },
        ],
      },
    ],
  });

  assert.equal(sessions.length, 4);
  assert.equal(sessions[0].status, "idle");
  assert.equal(sessions[0].pendingUserInput, null);
  assert.equal(sessions[1].status, "idle");
  assert.equal(sessions[1].pendingUserInput, null);
  assert.equal(sessions[2].status, "idle");
  assert.equal(sessions[2].error, null);
  assert.equal(sessions[2].messages[0].state, "final");
  assert.equal(sessions[2].messages[0].error, null);
  assert.equal(sessions[3].messages.length, 1);
  assert.equal(sessions[3].messages[0].content, "real answer");
});

test("drops stale Codex context-overflow responses on startup", () => {
  const [session] = normalizePersistedSessionsPayload({
    sessions: [
      {
        id: "session-overflow",
        status: "idle",
        messages: [
          {
            id: "msg-overflow",
            role: "assistant",
            state: "final",
            content:
              "Codex ran out of room in the model's context window. Start a new thread or clear earlier history before retrying.",
          },
          {
            id: "msg-recovered",
            role: "assistant",
            state: "final",
            content: "new fresh answer",
          },
        ],
      },
    ],
  });

  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].content, "new fresh answer");
});

test("normalization preserves unknown session fields for forward compatibility", () => {
  const [session] = normalizePersistedSessionsPayload({
    schemaVersion: 999,
    sessions: [
      {
        id: "session-1",
        status: "idle",
        futureProviderState: { token: "opaque" },
      },
    ],
  });

  assert.deepEqual(session.futureProviderState, { token: "opaque" });
});

test("normalization migrates legacy Codex default model to GPT 5.5", () => {
  const sessions = normalizePersistedSessionsPayload({
    sessions: [
      {
        id: "codex-session",
        provider: "codex",
        model: LEGACY_DEFAULT_CODEX_MODEL,
      },
      {
        id: "codex-mini-session",
        provider: "codex",
        model: "gpt-5.4-mini",
      },
      {
        id: "claude-session",
        provider: "claude",
        model: LEGACY_DEFAULT_CODEX_MODEL,
      },
    ],
  });

  assert.equal(sessions[0].model, CURRENT_DEFAULT_CODEX_MODEL);
  assert.equal(sessions[1].model, "gpt-5.4-mini");
  assert.equal(sessions[2].model, LEGACY_DEFAULT_CODEX_MODEL);
});

test("normalization clears stale Codex runtime thread ids on startup", () => {
  const [session] = normalizePersistedSessionsPayload({
    sessions: [
      {
        id: "codex-session",
        provider: "codex",
        model: "gpt-5.4-mini",
        runtime: {
          codexThreadId: "019dc32f-4182-7993-a7d7-58012553279d",
          codexThreadMeta: { workspaceRoot: "/tmp/old", codexHome: "/tmp/codex-home" },
          otherState: "preserved",
        },
        messages: [
          {
            id: "message-1",
            role: "assistant",
            state: "final",
            content:
              "Codex Exec exited with code 1: Reading prompt from stdin...\nError: thread/resume: thread/resume failed: no rollout found for thread id 019dc32f-4182-7993-a7d7-58012553279d",
          },
          {
            id: "message-2",
            role: "assistant",
            state: "final",
            content: "still useful answer",
          },
        ],
      },
    ],
  });

  assert.equal(session.runtime.codexThreadId, null);
  assert.equal(session.runtime.codexThreadMeta, null);
  assert.equal(session.runtime.otherState, "preserved");
  assert.equal(session.messages.length, 1);
  assert.equal(session.messages[0].content, "still useful answer");
});

test("persists sessions with a schema version and timestamp", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-sessions-"));
  const filePath = path.join(dir, "sessions.json");

  await persistSessionsToFile(
    filePath,
    [{ id: "session-1", status: "idle", updatedAt: "2026-04-15T00:00:00.000Z" }],
    { now: () => new Date("2026-04-15T01:02:03.000Z") },
  );

  const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(raw.schemaVersion, SESSION_STORE_SCHEMA_VERSION);
  assert.equal(raw.savedAt, "2026-04-15T01:02:03.000Z");
  assert.equal(raw.sessions.length, 1);

  const loaded = await loadSessionsFromFile(filePath);
  assert.equal(loaded[0].id, "session-1");
});

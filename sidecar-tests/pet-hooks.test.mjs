import test from "node:test";
import assert from "node:assert/strict";
import { createPetHooks } from "../sidecar/pet-hooks.mjs";

test("createPetHooks broadcasts lifecycle events with session override", async () => {
  const payloads = [];
  const hooks = createPetHooks((payload) => payloads.push(payload), { sessionId: "session-1" });

  const result = await hooks.Stop[0].hooks[0]({ session_id: "claude-session" });

  assert.deepEqual(result, { continue: true });
  assert.deepEqual(payloads, [
    {
      type: "pet_hook",
      message: "Stop",
      sessionId: "session-1",
    },
  ]);
});

test("createPetHooks falls back to Claude session_id when no override is provided", async () => {
  const payloads = [];
  const hooks = createPetHooks((payload) => payloads.push(payload));

  await hooks.Notification[0].hooks[0]({ session_id: "claude-session" });

  assert.equal(payloads[0].sessionId, "claude-session");
});

test("createPetHooks hook callbacks swallow broadcast failures", async () => {
  const hooks = createPetHooks(() => {
    throw new Error("broadcast unavailable");
  }, { sessionId: "session-1" });

  await assert.doesNotReject(async () => {
    const result = await hooks.PermissionRequest[0].hooks[0]({});
    assert.deepEqual(result, { continue: true });
  });
});

test("createPetHooks intentionally excludes tool and subagent hooks", () => {
  const hooks = createPetHooks(() => {});

  assert.equal(Object.hasOwn(hooks, "PreToolUse"), false);
  assert.equal(Object.hasOwn(hooks, "PostToolUse"), false);
  assert.equal(Object.hasOwn(hooks, "SubagentStart"), false);
  assert.equal(Object.hasOwn(hooks, "SubagentStop"), false);
});

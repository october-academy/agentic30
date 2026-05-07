// Hooks installed on every Claude Agent SDK `query()` call so the desktop
// pet sees lifecycle signals the sidecar's existing broadcasts don't surface
// (compaction, worktree create, stop/turn-complete, notification, etc.).
//
// We deliberately skip PreToolUse / PostToolUse / SubagentStart / SubagentStop
// here because the sidecar already broadcasts equivalent `tool_event` shapes
// for them. Re-emitting those would double-count the typing/working/juggling
// state machine.
//
// Each callback returns `{ continue: true }` so we observe but never block.

/**
 * @param {(payload: Record<string, unknown>) => void} broadcast
 *   The same broadcast() used by `index.mjs` to push events to the Swift app.
 * @param {{ sessionId?: string | null }} [options]
 * @returns {Record<string, Array<{ matcher?: string; hooks: Array<Function> }>>}
 */
export function createPetHooks(broadcast, options = {}) {
  const passthrough = (eventName) => async (input) => {
    try {
      broadcast({
        type: "pet_hook",
        message: eventName,
        sessionId: options.sessionId ?? input?.session_id ?? null,
      });
    } catch {
      // Telemetry must never break the agent loop.
    }
    return { continue: true };
  };

  const make = (eventName) => [{ hooks: [passthrough(eventName)] }];

  return {
    PreCompact: make("PreCompact"),
    PostCompact: make("PostCompact"),
    Stop: make("Stop"),
    StopFailure: make("StopFailure"),
    PostToolUseFailure: make("PostToolUseFailure"),
    Notification: make("Notification"),
    PermissionRequest: make("PermissionRequest"),
    WorktreeCreate: make("WorktreeCreate"),
    UserPromptSubmit: make("UserPromptSubmit"),
  };
}

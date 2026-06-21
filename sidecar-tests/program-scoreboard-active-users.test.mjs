import test from "node:test";
import assert from "node:assert/strict";

async function buildProgramScoreboardSnapshot(input) {
  const mod = await import("../sidecar/program-scoreboard.mjs");
  return mod.buildProgramScoreboardSnapshot(input);
}

test("malformed activeUsers snapshots fail explicitly", async () => {
  await assert.rejects(
    buildProgramScoreboardSnapshot({
      activeUsers: {
        sourceState: "ready",
        snapshots: [
          null,
          {
            at: "2026-06-15T09:00:00.000Z",
            activeUserCount: 100,
            firstValueEventName: "first_value",
            source: "posthog_hogql",
          },
        ],
      },
    }),
    /ERR_INVALID_ACTIVE_USER_SNAPSHOT: activeUsers\.snapshots\[0\] must be an object\./,
  );
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appendMcpOauthTrace,
  readRecentMcpOauthTraces,
  resolveMcpOauthTracePath,
} from "../sidecar/mcp-oauth-trace.mjs";

test("MCP OAuth traces persist redacted bounded summaries only", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-mcp-trace-"));
  try {
    for (let index = 0; index < 12; index += 1) {
      await appendMcpOauthTrace({
        appSupportPath,
        entry: {
          traceId: `trace-${index}`,
          at: `2026-06-10T09:00:${String(index).padStart(2, "0")}.000Z`,
          server: "posthog",
          provider: "codex",
          phase: "verifying",
          durationMs: index * 10,
          state: index === 11 ? "ready" : "progress",
          hasLoginUrl: index === 3,
          commandCount: index,
          providerRunCount: 2,
          loginUrl: "https://oauth.example/secret",
          authorization: "Bearer secret",
        },
      });
    }

    const traces = readRecentMcpOauthTraces({ appSupportPath, limit: 10 });
    assert.equal(traces.length, 10);
    assert.equal(traces[0].traceId, "trace-2");
    assert.equal(traces.at(-1).state, "ready");
    assert.equal(Object.hasOwn(traces.at(-1), "loginUrl"), false);
    assert.equal(Object.hasOwn(traces.at(-1), "authorization"), false);

    const raw = await fs.readFile(resolveMcpOauthTracePath(appSupportPath), "utf8");
    assert.equal(raw.includes("oauth.example"), false);
    assert.equal(raw.includes("Bearer secret"), false);
  } finally {
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

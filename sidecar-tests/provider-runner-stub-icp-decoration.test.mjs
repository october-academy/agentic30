import test from "node:test";
import assert from "node:assert/strict";
import fsSync from "node:fs";
import os from "node:os";
import path from "node:path";

// provider-runner resolves appSupportPath from the environment at module load,
// so both env vars must be set before the dynamic import below. node --test
// runs each file in its own process, so this does not leak into other tests.
const appSupportPath = fsSync.mkdtempSync(
  path.join(os.tmpdir(), "agentic30-stub-icp-"),
);
process.env.AGENTIC30_APP_SUPPORT_PATH = appSupportPath;
process.env.AGENTIC30_TEST_STUB_PROVIDER = "1";

const { runProviderStream } = await import("../sidecar/provider-runner.mjs");
const { listUserInputRequests } = await import("../sidecar/user-input.mjs");
const { isMissingIcpContextIntro } = await import("../sidecar/idd-doc-gate.mjs");

async function runStubAdaptiveContinuation({ docType, sessionIdForMcp }) {
  await runProviderStream({
    provider: "codex",
    sessionRuntime: {
      iddPendingAdaptiveContinuation: {
        docType,
        prompt: "adaptive follow-up prompt",
      },
    },
    prompt: "continue foundation setup",
    sessionIdForMcp,
  });
  const requests = await listUserInputRequests(appSupportPath);
  return requests.find((request) => request.sessionId === sessionIdForMcp) || null;
}

test("stub provider_adaptive ICP card is decorated so the restart detector cannot loop", async () => {
  const request = await runStubAdaptiveContinuation({
    docType: "icp",
    sessionIdForMcp: "stub-icp-session",
  });

  assert.ok(request, "stub run should persist a user-input request");
  assert.equal(request.generation?.mode, "provider_adaptive");
  assert.equal(request.generation?.docType, "icp");
  assert.ok(
    String(request.intro?.title || "").includes("Ideal Customer Profile"),
    "ICP card must carry the canonical context intro",
  );
  assert.ok(
    Array.isArray(request.resources) && request.resources.length > 0,
    "ICP card must carry recommended resources",
  );
  // The actual loop guard: the on-disk request must not be flagged for restart.
  assert.equal(isMissingIcpContextIntro(request), false);
});

test("stub provider_adaptive non-ICP card stays undecorated", async () => {
  const request = await runStubAdaptiveContinuation({
    docType: "goal",
    sessionIdForMcp: "stub-goal-session",
  });

  assert.ok(request, "stub run should persist a user-input request");
  assert.equal(request.generation?.docType, "goal");
  assert.equal(request.intro, undefined);
  assert.equal(request.resources, undefined);
  assert.equal(isMissingIcpContextIntro(request), false);
});

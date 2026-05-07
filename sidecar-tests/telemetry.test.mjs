import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelemetryClient } from "../sidecar/telemetry.mjs";
import { clearAuthContext, setAuthContext } from "../sidecar/auth-context.mjs";

test("telemetry sanitizes auth email, raw keys, and absolute paths", async () => {
  const appSupportPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentic30-telemetry-"));
  const originalFetch = globalThis.fetch;
  let captured = null;

  try {
    fs.writeFileSync(
      path.join(appSupportPath, "ad-config.json"),
      JSON.stringify({
        posthog: {
          projectApiKey: "phc_test_123",
          host: "https://us.posthog.com",
        },
      }),
    );

    setAuthContext({
      accessToken: "access-secret",
      refreshToken: "refresh-secret",
      userId: "user-1",
      email: "founder@example.com",
      webBaseUrl: "https://agentic30.app",
    });

    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    };

    const telemetry = createTelemetryClient({
      appSupportPath,
      workspaceRoot: "/Users/october/prj/agentic30",
    });

    telemetry.captureEvent("test_event", {
      payment_key: "payment-fixture-1234567890",
      scan_root: "/Users/october/prj/secret-repo",
      doc_path: "docs/ICP.md",
    });

    assert.equal(captured.event, "test_event");
    assert.equal(captured.properties.auth_user_id, "user-1");
    assert.equal(captured.properties.auth_email_domain, "example.com");
    assert.equal(captured.properties.workspace_basename, "agentic30");
    assert.equal(captured.properties.scan_basename, "secret-repo");
    assert.equal(captured.properties.payment_key_suffix, "567890");
    assert.equal(captured.properties.doc_path, "docs/ICP.md");
    assert.equal("auth_email" in captured.properties, false);
    assert.equal("payment_key" in captured.properties, false);
    assert.equal("scan_root" in captured.properties, false);
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthContext();
    fs.rmSync(appSupportPath, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { createTelemetryClient, resolveTelemetryRuntimePolicy } from "../sidecar/telemetry.mjs";
import { clearAuthContext, setAuthContext } from "../sidecar/auth-context.mjs";

const productionTelemetryEnvironment = {
  AGENTIC30_TELEMETRY_ENVIRONMENT: "production",
  AGENTIC30_BUILD_CONFIGURATION: "release",
  AGENTIC30_INTERNAL_TRAFFIC: "0",
};

test("telemetry adopts a Mac-supplied anonymous distinct id and persists it", async () => {
  const appSupportPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentic30-telemetry-distinct-"));
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

    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    };

    const telemetry = createTelemetryClient({
      appSupportPath,
      workspaceRoot: "/Users/october/prj/agentic30",
      environment: productionTelemetryEnvironment,
    });

    const sidecarGenerated = telemetry.getAnonymousDistinctId();
    const macDistinctId = "12345678-AAAA-BBBB-CCCC-1234567890AB";

    assert.notEqual(sidecarGenerated, macDistinctId);
    assert.equal(telemetry.setAnonymousDistinctId(macDistinctId), true);
    assert.equal(telemetry.getAnonymousDistinctId(), macDistinctId);

    telemetry.captureEvent("anonymous_event");
    assert.equal(captured.distinct_id, macDistinctId);

    const persisted = JSON.parse(
      fs.readFileSync(path.join(appSupportPath, "posthog-telemetry.json"), "utf8"),
    );
    assert.equal(persisted.distinctId, macDistinctId);

    // Empty / no-op writes leave the value alone.
    assert.equal(telemetry.setAnonymousDistinctId(""), false);
    assert.equal(telemetry.setAnonymousDistinctId(macDistinctId), false);
    assert.equal(telemetry.getAnonymousDistinctId(), macDistinctId);

    // Once auth is set, distinct_id flips to the user id even after we recorded
    // the shared anonymous id.
    setAuthContext({
      accessToken: "access",
      userId: "user-42",
      email: "founder@example.com",
      webBaseUrl: "https://agentic30.app",
    });
    telemetry.captureEvent("authenticated_event");
    assert.equal(captured.distinct_id, "user-42");
  } finally {
    globalThis.fetch = originalFetch;
    clearAuthContext();
    fs.rmSync(appSupportPath, { recursive: true, force: true });
  }
});

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
      environment: productionTelemetryEnvironment,
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
    assert.equal(captured.properties.telemetry_source, "mac_sidecar");
    assert.equal(captured.properties.telemetry_environment, "production");
    assert.equal(captured.properties.build_configuration, "release");
    assert.equal(captured.properties.is_internal_traffic, false);
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

test("development sidecar telemetry is suppressed unless explicitly enabled", async () => {
  const appSupportPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentic30-telemetry-dev-"));
  const originalFetch = globalThis.fetch;
  let fetchCount = 0;

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

    globalThis.fetch = async () => {
      fetchCount += 1;
      return new Response("{}", { status: 200 });
    };

    const telemetry = createTelemetryClient({
      appSupportPath,
      workspaceRoot: "/Users/october/prj/agentic30",
      environment: {
        AGENTIC30_TELEMETRY_ENVIRONMENT: "development",
        AGENTIC30_BUILD_CONFIGURATION: "debug",
        AGENTIC30_INTERNAL_TRAFFIC: "1",
      },
    });

    telemetry.captureEvent("dev_event");
    telemetry.captureException(new Error("dev boom"));
    assert.equal(fetchCount, 0);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(appSupportPath, { recursive: true, force: true });
  }
});

test("development sidecar opt-in keeps internal traffic tags", async () => {
  const appSupportPath = fs.mkdtempSync(path.join(os.tmpdir(), "agentic30-telemetry-dev-opt-in-"));
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

    globalThis.fetch = async (_url, init) => {
      captured = JSON.parse(String(init?.body));
      return new Response("{}", { status: 200 });
    };

    const telemetry = createTelemetryClient({
      appSupportPath,
      workspaceRoot: "/Users/october/prj/agentic30",
      environment: {
        AGENTIC30_ENABLE_DEV_TELEMETRY: "1",
        AGENTIC30_TELEMETRY_ENVIRONMENT: "development",
        AGENTIC30_BUILD_CONFIGURATION: "debug",
        AGENTIC30_INTERNAL_TRAFFIC: "1",
      },
    });

    telemetry.captureEvent("dev_event");
    assert.equal(captured.event, "dev_event");
    assert.equal(captured.properties.telemetry_source, "mac_sidecar");
    assert.equal(captured.properties.telemetry_environment, "development");
    assert.equal(captured.properties.build_configuration, "debug");
    assert.equal(captured.properties.is_internal_traffic, true);
  } finally {
    globalThis.fetch = originalFetch;
    fs.rmSync(appSupportPath, { recursive: true, force: true });
  }
});

test("telemetry runtime policy classifies production and development contexts", () => {
  assert.deepEqual(
    resolveTelemetryRuntimePolicy({
      environment: productionTelemetryEnvironment,
      sidecarRoot: "/Applications/agentic30.app/Contents/Resources/sidecar",
    }),
    {
      telemetryEnvironment: "production",
      buildConfiguration: "release",
      isInternalTraffic: false,
      isDevelopmentTelemetryEnabled: false,
      isSuppressed: false,
    },
  );

  assert.deepEqual(
    resolveTelemetryRuntimePolicy({
      environment: {
        AGENTIC30_ENABLE_DEV_TELEMETRY: "1",
        AGENTIC30_TELEMETRY_ENVIRONMENT: "development",
        AGENTIC30_BUILD_CONFIGURATION: "debug",
      },
      sidecarRoot: "/Users/october/prj/agentic30-public/sidecar",
    }),
    {
      telemetryEnvironment: "development",
      buildConfiguration: "debug",
      isInternalTraffic: true,
      isDevelopmentTelemetryEnabled: true,
      isSuppressed: false,
    },
  );
});

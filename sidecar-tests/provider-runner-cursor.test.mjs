import test from "node:test";
import assert from "node:assert/strict";
import {
  buildCursorEnv,
  getProviderAuthState,
  getProviderConnectionState,
  getProviderScanReadiness,
  isProviderUsageLimitError,
  resetProviderSettingsForTest,
  resolveCursorModel,
  supportsCursorExecutionMode,
  updateProviderSettings,
} from "../sidecar/provider-runner.mjs";

function withoutCursorEnv(run) {
  const previousApiKey = process.env.CURSOR_API_KEY;
  const previousModel = process.env.CURSOR_MODEL;
  const previousAgenticModel = process.env.AGENTIC30_CURSOR_MODEL;
  delete process.env.CURSOR_API_KEY;
  delete process.env.CURSOR_MODEL;
  delete process.env.AGENTIC30_CURSOR_MODEL;
  try {
    return run();
  } finally {
    if (previousApiKey === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previousApiKey;
    if (previousModel === undefined) delete process.env.CURSOR_MODEL;
    else process.env.CURSOR_MODEL = previousModel;
    if (previousAgenticModel === undefined) delete process.env.AGENTIC30_CURSOR_MODEL;
    else process.env.AGENTIC30_CURSOR_MODEL = previousAgenticModel;
  }
}

test("Cursor auth state detects API key settings", () => {
  resetProviderSettingsForTest();
  try {
    withoutCursorEnv(() => {
      updateProviderSettings({
        cursor: {
          authMode: "api_key",
          apiKey: "cursor-secret",
        },
      });

      const state = getProviderAuthState("cursor");
      const env = buildCursorEnv({ PATH: "/usr/bin", HOME: "/tmp/home" });

      assert.equal(state.available, true);
      assert.equal(state.source, "api-key");
      assert.equal(env.CURSOR_API_KEY, "cursor-secret");
    });
  } finally {
    resetProviderSettingsForTest();
  }
});

test("Cursor auth state detects CURSOR_API_KEY from the environment", () => {
  resetProviderSettingsForTest();
  const previous = process.env.CURSOR_API_KEY;
  try {
    process.env.CURSOR_API_KEY = "cursor-env-key";
    const state = getProviderAuthState("cursor");
    assert.equal(state.available, true);
    assert.equal(state.source, "api-key");
  } finally {
    if (previous === undefined) delete process.env.CURSOR_API_KEY;
    else process.env.CURSOR_API_KEY = previous;
    resetProviderSettingsForTest();
  }
});

test("Cursor auth state fails closed without any API key", () => {
  resetProviderSettingsForTest();
  try {
    withoutCursorEnv(() => {
      const state = getProviderAuthState("cursor");
      assert.equal(state.available, false);
      assert.equal(state.source, "missing");
      assert.match(state.message, /CURSOR_API_KEY/);
    });
  } finally {
    resetProviderSettingsForTest();
  }
});

test("Cursor connection state reports the @cursor/sdk package", () => {
  resetProviderSettingsForTest();
  try {
    withoutCursorEnv(() => {
      const state = getProviderConnectionState("cursor");
      assert.equal(state.sdk.packageName, "@cursor/sdk");
      assert.equal(state.sdk.available, true);
      assert.ok(state.sdk.version);
    });
  } finally {
    resetProviderSettingsForTest();
  }
});

test("Cursor scan readiness requires an API key even when SDK is installed", () => {
  resetProviderSettingsForTest();
  try {
    withoutCursorEnv(() => {
      const readiness = getProviderScanReadiness("cursor");
      assert.equal(readiness.sdkInstalled, true);
      assert.equal(readiness.authenticated, false);
      assert.equal(readiness.scanReady, false);
      assert.equal(readiness.authAction, "cursor_api_key");
    });
  } finally {
    resetProviderSettingsForTest();
  }
});

test("Cursor model resolution prefers explicit model, then settings, then default", () => {
  resetProviderSettingsForTest();
  try {
    withoutCursorEnv(() => {
      assert.equal(resolveCursorModel("composer-9"), "composer-9");
      updateProviderSettings({ cursor: { model: "composer-custom" } });
      assert.equal(resolveCursorModel(""), "composer-custom");
      resetProviderSettingsForTest();
      assert.equal(resolveCursorModel(""), "composer-2.5");
    });
  } finally {
    resetProviderSettingsForTest();
  }
});

test("Cursor execution-mode gate allows agentic and rejects read-only judge modes", () => {
  assert.equal(supportsCursorExecutionMode("agentic"), true);
  assert.equal(supportsCursorExecutionMode("idd_question_synthesis"), true);
  assert.equal(supportsCursorExecutionMode("memory_chat"), true);
  assert.equal(supportsCursorExecutionMode("office_hours_question"), false);
  assert.equal(supportsCursorExecutionMode("isolated_read_only"), false);
  assert.equal(supportsCursorExecutionMode("judge_read_only"), false);
});

test("provider usage-limit detection covers Codex wording and Cursor RateLimitError shapes", () => {
  assert.equal(isProviderUsageLimitError(new Error("You've hit your usage limit.")), true);
  assert.equal(isProviderUsageLimitError(new Error("monthly quota exceeded")), true);

  const rateLimitByName = new Error("Too many requests");
  rateLimitByName.name = "RateLimitError";
  assert.equal(isProviderUsageLimitError(rateLimitByName), true);

  const rateLimitByStatus = new Error("upstream rejected");
  rateLimitByStatus.status = 429;
  assert.equal(isProviderUsageLimitError(rateLimitByStatus), true);

  const rateLimitByMessage = new Error("Rate limit exceeded, retry later");
  assert.equal(isProviderUsageLimitError(rateLimitByMessage), true);

  assert.equal(isProviderUsageLimitError(new Error("connection reset")), false);
  assert.equal(isProviderUsageLimitError(null), false);
});

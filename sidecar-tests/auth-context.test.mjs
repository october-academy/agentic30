import test from "node:test";
import assert from "node:assert/strict";
import {
  buildAuthEnv,
  clearAuthContext,
  fetchAuthenticatedAppContext,
  getAuthContextSummary,
  redactSensitiveValues,
  setAuthContext,
} from "../sidecar/auth-context.mjs";

test("auth context exposes tokens only through child process env", () => {
  clearAuthContext();
  assert.deepEqual(buildAuthEnv(), {});

  const summary = setAuthContext({
    accessToken: "access-secret",
    refreshToken: "refresh-secret",
    userId: "user-1",
    email: "founder@example.com",
    webBaseUrl: "https://agentic30.app/",
  });

  assert.equal(summary.authenticated, true);
  assert.equal(summary.email, "founder@example.com");
  assert.deepEqual(buildAuthEnv(), {
    AGENTIC30_WEB_BASE_URL: "https://agentic30.app",
    AGENTIC30_SUPABASE_ACCESS_TOKEN: "access-secret",
    AGENTIC30_AUTH_USER_ID: "user-1",
    AGENTIC30_AUTH_EMAIL: "founder@example.com",
  });
});

test("auth context normalizes onboarding context from snake_case payload", () => {
  clearAuthContext();
  setAuthContext({
    accessToken: "access-secret",
    onboardingContext: {
      work_mode: "side_project",
      custom_work_mode: "주말마다 고객 인터뷰를 돌리는 중",
      role: "designer",
      project_stage: "pre_revenue",
      isolation_level: "weekly_loop",
      completed_at: "2026-05-08T00:00:00Z",
    },
  });

  assert.deepEqual(getAuthContextSummary().onboardingContext, {
    workMode: "side_project",
    customWorkMode: "주말마다 고객 인터뷰를 돌리는 중",
    role: "designer",
    projectStage: "pre_revenue",
    isolationLevel: "weekly_loop",
    completedAt: "2026-05-08T00:00:00Z",
  });
});

test("redactSensitiveValues removes credential-shaped fields recursively", () => {
  assert.deepEqual(
    redactSensitiveValues({
      accessToken: "secret",
      nested: {
        authorization: "Bearer secret",
        safe: "value",
      },
      events: [{ api_key: "secret" }],
    }),
    {
      accessToken: "[redacted]",
      nested: {
        authorization: "[redacted]",
        safe: "value",
      },
      events: [{ api_key: "[redacted]" }],
    },
  );
});

test("fetchAuthenticatedAppContext uses bearer auth and redacts response", async () => {
  const originalFetch = globalThis.fetch;
  try {
    globalThis.fetch = async (url, init) => {
      assert.equal(url, "https://example.test/api/mac/context");
      assert.equal(init.headers.Authorization, "Bearer access-secret");
      return new Response(
        JSON.stringify({
          profile: { name: "October" },
          token: "must-not-leak",
        }),
        { status: 200 },
      );
    };

    const result = await fetchAuthenticatedAppContext({
      AGENTIC30_WEB_BASE_URL: "https://example.test",
      AGENTIC30_SUPABASE_ACCESS_TOKEN: "access-secret",
    });

    assert.deepEqual(result, {
      profile: { name: "October" },
      token: "[redacted]",
    });
  } finally {
    globalThis.fetch = originalFetch;
  }
});

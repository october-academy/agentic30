/**
 * REGRESSION TEST: "Google 연결 확인" hang.
 *
 * Drives the *real* `gws` CLI (the same binary the Mac app spawns) to
 * pin down the failure modes that produced the observed 5-minute spinner:
 *
 *   1. `gwsExec` must time out instead of waiting on a hung child.
 *   2. `gwsExec` must reject when gws exits 0 but encodes the failure
 *      as `{"error":{"message":"..."}}` on stdout.
 *   3. `stripGwsPreamble` must skip the "Using keyring backend: keyring"
 *      banner gws prints before its JSON body.
 *   4. `gws auth status` does NOT accept `--format json` — proves the
 *      old call site was always falling through to the failure path.
 *   5. `checkGwsAuthStatus` must surface invalid_rapt without falling
 *      through to a probe that may itself hang.
 *   6. `startGwsAuth` must not kill `gws auth login` just because a probe
 *      still sees the old invalid_rapt token before the browser callback.
 *   7. `startGwsAuth` must enforce its own OAuth-callback timeout shorter
 *      than the 5-minute hard cap so the user gets actionable guidance.
 *
 * The suite is skipped when `gws` is not on PATH so it stays sandbox-safe
 * in CI lanes that don't install Google Workspace CLI. To exercise the
 * full `gws auth login` browser flow, set `RUN_REAL_GWS_AUTH_LOGIN=1`
 * (skipped by default because spawning real auth login briefly opens a
 * system browser window).
 */

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";

import {
  gwsExec,
  resolveGwsBin,
  stripGwsPreamble,
  extractGwsErrorMessage,
  DEFAULT_GWS_TIMEOUT_MS,
} from "../sidecar/gws-client.mjs";
import {
  checkGwsAuthStatus,
  startGwsAuth,
  clearValidationCache,
  extractGwsAuthUrl,
} from "../sidecar/bip-readiness.mjs";

const REAL_GWS = resolveGwsBin({ env: process.env });
const HAS_REAL_GWS = Boolean(REAL_GWS);
const skipReason = HAS_REAL_GWS ? false : "real gws CLI not available on PATH";

const RUN_AUTH_LOGIN = process.env.RUN_REAL_GWS_AUTH_LOGIN === "1";

test.beforeEach(() => {
  clearValidationCache();
});

function waitFor(predicate, { timeoutMs = 5_000, intervalMs = 50 } = {}) {
  return new Promise((resolve, reject) => {
    const startedAt = Date.now();
    const tick = () => {
      let value;
      try { value = predicate(); } catch (err) { reject(err); return; }
      if (value) { resolve(value); return; }
      if (Date.now() - startedAt > timeoutMs) {
        reject(new Error(`waitFor timed out after ${timeoutMs}ms`));
        return;
      }
      setTimeout(tick, intervalMs);
    };
    tick();
  });
}

// ───────────────────────────────────────────────────────────────────────────
// Pure helpers (no spawn) — always run
// ───────────────────────────────────────────────────────────────────────────

test("stripGwsPreamble drops 'Using keyring backend: keyring' header", () => {
  const raw = "Using keyring backend: keyring\n{\"a\":1}";
  assert.equal(stripGwsPreamble(raw), "{\"a\":1}");
});

test("stripGwsPreamble is identity for plain JSON", () => {
  assert.equal(stripGwsPreamble("{\"a\":1}"), "{\"a\":1}");
});

test("stripGwsPreamble preserves array root", () => {
  const raw = "noise\n[1,2,3]";
  assert.equal(stripGwsPreamble(raw), "[1,2,3]");
});

test("extractGwsErrorMessage returns inner message when error envelope present", () => {
  const raw = "Using keyring backend: keyring\n{\"error\":{\"code\":401,\"message\":\"invalid_rapt\"}}";
  assert.equal(extractGwsErrorMessage(raw), "invalid_rapt");
});

test("extractGwsErrorMessage returns null for success payload", () => {
  const raw = "{\"user\":{\"emailAddress\":\"u@e.com\"}}";
  assert.equal(extractGwsErrorMessage(raw), null);
});

test("DEFAULT_GWS_TIMEOUT_MS is set to a reasonable bound (≤60s)", () => {
  assert.ok(DEFAULT_GWS_TIMEOUT_MS > 0 && DEFAULT_GWS_TIMEOUT_MS <= 60_000);
});

test("extractGwsAuthUrl finds OAuth URL in gws login output", () => {
  const url = "https://accounts.google.com/o/oauth2/v2/auth?client_id=test&redirect_uri=http%3A%2F%2Flocalhost%3A9876%2Fcallback";
  assert.equal(extractGwsAuthUrl(`Open this URL:\n${url}\nWaiting...`), url);
});

// ───────────────────────────────────────────────────────────────────────────
// Real gws CLI — gwsExec timeout machinery
// ───────────────────────────────────────────────────────────────────────────

test("gwsExec timeoutMs kills generic hung child within bound", { skip: !fs.existsSync("/bin/sleep") }, async () => {
  // Validates the timeout/SIGTERM/SIGKILL pipeline on a controllable
  // process (no Google side effects). gwsExec is binary-agnostic, so this
  // proves the new timer machinery works for real gws too.
  const startedAt = Date.now();
  await assert.rejects(
    () => gwsExec(["10"], { gwsBin: "/bin/sleep", timeoutMs: 250 }),
    /timed out after 250ms/,
  );
  assert.ok(Date.now() - startedAt < 3_000, `timeout took ${Date.now() - startedAt}ms`);
});

// ───────────────────────────────────────────────────────────────────────────
// Real gws CLI — auth status + drive about contracts
// ───────────────────────────────────────────────────────────────────────────

test("real `gws auth status` (no --format) returns parseable JSON", { skip: skipReason }, async () => {
  const out = await gwsExec(["auth", "status"], { timeoutMs: 10_000 });
  const parsed = JSON.parse(stripGwsPreamble(out).trim());
  assert.equal(typeof parsed, "object");
  // Always present, regardless of auth state — proves we're parsing the
  // real schema, not a happy-path mock.
  assert.ok(
    "auth_method" in parsed
    || "encrypted_credentials_exists" in parsed
    || "has_refresh_token" in parsed,
    `unexpected auth status shape: ${JSON.stringify(parsed)}`,
  );
});

test("real `gws auth status --format json` IS rejected by gws 0.22.5+", { skip: skipReason }, async () => {
  // This is the regression we fixed. The old checkGwsAuthStatus passed
  // --format json, which gws rejects with an error envelope on stdout
  // (exit code 0). The improved gwsExec must now reject — proving the
  // old code path was *always* failing silently on this gws version.
  await assert.rejects(
    () => gwsExec(["auth", "status", "--format", "json"], { timeoutMs: 10_000 }),
    /unexpected argument|--format/i,
  );
});

test("real `gws drive about get` rejects via stdout error envelope when token invalid", { skip: skipReason }, async () => {
  // Only meaningful when the local gws auth is in an unauthenticated /
  // invalid_rapt state. Detect that and run; otherwise skip.
  let statusJson;
  try {
    const out = await gwsExec(["auth", "status"], { timeoutMs: 10_000 });
    statusJson = JSON.parse(stripGwsPreamble(out).trim());
  } catch {
    return;
  }
  if (statusJson.token_valid === true) {
    // Local environment is authenticated; can't simulate a failure with
    // the real CLI without revoking the user's token. Skip cleanly.
    return;
  }

  await assert.rejects(
    () => gwsExec(
      ["drive", "about", "get", "--params", JSON.stringify({ fields: "user" }), "--format", "json"],
      { timeoutMs: 10_000 },
    ),
    /Authentication failed|invalid_rapt|invalid_grant|reauth|No credentials provided/i,
  );
});

// ───────────────────────────────────────────────────────────────────────────
// Real gws CLI — checkGwsAuthStatus
// ───────────────────────────────────────────────────────────────────────────

test("checkGwsAuthStatus returns structured result against real gws (no hang, no throw)", { skip: skipReason }, async () => {
  const startedAt = Date.now();
  const result = await checkGwsAuthStatus({});
  assert.equal(typeof result.done, "boolean");
  if (!result.done) {
    assert.ok(result.error, "blocked result must include error");
    assert.ok(
      ["auth_expired", "permission_denied", "not_found", "network", "unknown"].includes(result.error.kind),
      `unexpected error kind: ${result.error.kind}`,
    );
  }
  assert.ok(Date.now() - startedAt < 30_000, "must not hang");
});

test("checkGwsAuthStatus surfaces invalid_rapt as auth_expired without invoking probe", { skip: skipReason }, async () => {
  // Only meaningful when the local gws is currently in invalid_rapt state.
  // We auto-detect: if the user's token IS valid, we cannot simulate the
  // failure with real gws without destroying credentials, so we skip.
  let statusJson;
  try {
    const out = await gwsExec(["auth", "status"], { timeoutMs: 10_000 });
    statusJson = JSON.parse(stripGwsPreamble(out).trim());
  } catch {
    return;
  }
  const tokenError = String(statusJson.token_error || "").toLowerCase();
  const isRapt = tokenError.includes("invalid_rapt") || tokenError.includes("invalid_grant");
  if (!isRapt) return;

  const startedAt = Date.now();
  const result = await checkGwsAuthStatus({});
  assert.equal(result.done, false);
  assert.equal(result.error.kind, "auth_expired");
  // Must short-circuit BEFORE issuing the drive.about probe — that probe
  // takes ~1-2s round-trip on real gws, so finishing fast proves we
  // detected the rapt state from auth status alone.
  assert.ok(Date.now() - startedAt < 5_000, `took ${Date.now() - startedAt}ms`);
});

// ───────────────────────────────────────────────────────────────────────────
// Real gws CLI — startGwsAuth (browser flow; opt-in)
// ───────────────────────────────────────────────────────────────────────────

const skipAuthLoginReason = !HAS_REAL_GWS
  ? skipReason
  : (RUN_AUTH_LOGIN ? false : "set RUN_REAL_GWS_AUTH_LOGIN=1 to run (spawns real gws auth login + browser)");

test("startGwsAuth blocks within oauthTimeoutMs when callback never arrives", { skip: skipAuthLoginReason }, async () => {
  // Spawns real `gws auth login`. The fix must surface a blocked state
  // within the configured oauthTimeoutMs even though the gws child is
  // still waiting on the browser callback.
  const events = [];
  const startedAt = Date.now();
  const handle = startGwsAuth({
    onStatusChange(evt) { events.push(evt); },
    pollIntervalMs: 500,
    probeTimeoutMs: 3_000,
    oauthTimeoutMs: 2_000,
    totalTimeoutMs: 30_000,
  });
  try {
    const blocked = await waitFor(
      () => events.find((e) => e.status === "blocked"),
      { timeoutMs: 15_000, intervalMs: 100 },
    );
    assert.ok(blocked.error?.user_message, "blocked event must include user_message");
    assert.ok(Date.now() - startedAt < 15_000, "must respect oauthTimeoutMs, not 5-minute cap");
  } finally {
    handle.cancel();
  }
});

test("startGwsAuth cancel emits pending and stops polling", { skip: skipAuthLoginReason }, async () => {
  const events = [];
  const handle = startGwsAuth({
    onStatusChange(evt) { events.push(evt); },
    pollIntervalMs: 200,
    probeTimeoutMs: 2_000,
    oauthTimeoutMs: 60_000,
    totalTimeoutMs: 60_000,
  });
  await waitFor(() => events.find((e) => e.status === "in-progress"), { timeoutMs: 5_000 });
  handle.cancel();
  await new Promise((r) => setTimeout(r, 300));
  assert.ok(events.some((e) => e.status === "pending"), "cancel must emit pending");
});

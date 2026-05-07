import test from "node:test";
import assert from "node:assert/strict";
import {
  clearValidationCache,
  deriveReadinessState,
  formatReadinessError,
} from "../sidecar/bip-readiness.mjs";

// --- Helpers ---

function makeCache(entries = []) {
  const m = new Map();
  for (const [key, value] of entries) {
    m.set(key, value);
  }
  return m;
}

const FAR_FUTURE = Date.now() + 120_000;
const EXPIRED = Date.now() - 1;

// --- Row 1: googleSignIn ---

test("googleSignIn done when macAuth token present and not expired", () => {
  const result = deriveReadinessState({
    keychainSettings: { macAuth: { accessToken: "tok", expiresAt: FAR_FUTURE } },
  });
  const row = result.rows.find((r) => r.id === "googleSignIn");
  assert.equal(row.status, "done");
});

test("googleSignIn blocked when accessToken missing", () => {
  const result = deriveReadinessState({
    keychainSettings: { macAuth: {} },
  });
  const row = result.rows.find((r) => r.id === "googleSignIn");
  assert.equal(row.status, "blocked");
  assert.equal(row.error.kind, "auth_expired");
});

test("googleSignIn blocked when token expired", () => {
  const result = deriveReadinessState({
    keychainSettings: { macAuth: { accessToken: "tok", expiresAt: EXPIRED } },
  });
  const row = result.rows.find((r) => r.id === "googleSignIn");
  assert.equal(row.status, "blocked");
});

test("googleSignIn done when expiresAt is null (no expiry set)", () => {
  const result = deriveReadinessState({
    keychainSettings: { macAuth: { accessToken: "tok", expiresAt: null } },
  });
  const row = result.rows.find((r) => r.id === "googleSignIn");
  assert.equal(row.status, "done");
});

// --- Row 2: workspace ---

test("workspace done when hasExplicitWorkspace true", () => {
  const result = deriveReadinessState({
    workspaceSettings: { hasExplicitWorkspace: true },
  });
  const row = result.rows.find((r) => r.id === "workspace");
  assert.equal(row.status, "done");
});

test("workspace pending when hasExplicitWorkspace false", () => {
  const result = deriveReadinessState({
    workspaceSettings: { hasExplicitWorkspace: false },
  });
  const row = result.rows.find((r) => r.id === "workspace");
  assert.equal(row.status, "pending");
});

// --- Row 3: gwsInstall ---

test("gwsInstall done when AGENTIC30_GWS_BIN points to executable", (t) => {
  // Use the node binary itself as a stand-in for an executable
  const nodeBin = process.execPath;
  const result = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: nodeBin, PATH: "" },
  });
  const row = result.rows.find((r) => r.id === "gwsInstall");
  assert.equal(row.status, "done");
});

test("gwsInstall pending when gws not found", () => {
  const result = deriveReadinessState({
    env: { PATH: "/nonexistent/path" },
  });
  const row = result.rows.find((r) => r.id === "gwsInstall");
  // pending or blocked — not done
  assert.notEqual(row.status, "done");
});

// --- Row 4: gwsAuth ---

test("gwsAuth blocked when gwsInstall not done", () => {
  const result = deriveReadinessState({
    env: { PATH: "/nonexistent/path" },
  });
  const row = result.rows.find((r) => r.id === "gwsAuth");
  assert.equal(row.status, "blocked");
});

test("gwsAuth done when positive probe cached", () => {
  const cache = makeCache([
    ["gwsAuth:probe", { ok: true, expiresAt: FAR_FUTURE }],
  ]);
  const result = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
    validationCacheOverride: cache,
  });
  const row = result.rows.find((r) => r.id === "gwsAuth");
  assert.equal(row.status, "done");
});

test("gwsAuth blocked when negative probe cached", () => {
  const err = { user_message: "만료됐어요", kind: "auth_expired" };
  const cache = makeCache([
    ["gwsAuth:probe", { ok: false, error: err, expiresAt: FAR_FUTURE }],
  ]);
  const result = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
    validationCacheOverride: cache,
  });
  const row = result.rows.find((r) => r.id === "gwsAuth");
  assert.equal(row.status, "blocked");
  assert.equal(row.error.kind, "auth_expired");
});

test("gwsAuth pending when cache expired", () => {
  const cache = makeCache([
    ["gwsAuth:probe", { ok: true, expiresAt: EXPIRED }],
  ]);
  const result = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
    validationCacheOverride: cache,
  });
  const row = result.rows.find((r) => r.id === "gwsAuth");
  assert.equal(row.status, "pending");
});

// --- Row 5: docUrl ---

test("docUrl blocked when gwsAuth not done", () => {
  const result = deriveReadinessState({
    env: { PATH: "/nonexistent/path" },
    bipCoachConfig: { docId: "doc123" },
  });
  const row = result.rows.find((r) => r.id === "docUrl");
  assert.equal(row.status, "blocked");
});

test("docUrl done when gwsAuth done and doc validate cached ok", () => {
  const cache = makeCache([
    ["gwsAuth:probe", { ok: true, expiresAt: FAR_FUTURE }],
    ["doc:doc123", { ok: true, expiresAt: FAR_FUTURE }],
  ]);
  const result = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
    bipCoachConfig: { docId: "doc123" },
    validationCacheOverride: cache,
  });
  const row = result.rows.find((r) => r.id === "docUrl");
  assert.equal(row.status, "done");
});

test("docUrl pending when gwsAuth done but no docId set", () => {
  const cache = makeCache([
    ["gwsAuth:probe", { ok: true, expiresAt: FAR_FUTURE }],
  ]);
  const result = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
    bipCoachConfig: {},
    validationCacheOverride: cache,
  });
  const row = result.rows.find((r) => r.id === "docUrl");
  assert.equal(row.status, "pending");
});

test("docUrl pending, not blocked, when persisted config exists but auth is not yet probed", () => {
  const result = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
    bipCoachConfig: { docId: "doc123" },
    validationCacheOverride: makeCache(),
  });
  const row = result.rows.find((r) => r.id === "docUrl");
  assert.equal(row.status, "pending");
});

// --- Row 6: sheetUrl ---

test("sheetUrl done when gwsAuth done and sheet validate cached ok", () => {
  const cache = makeCache([
    ["gwsAuth:probe", { ok: true, expiresAt: FAR_FUTURE }],
    ["sheet:sheet456", { ok: true, expiresAt: FAR_FUTURE }],
  ]);
  const result = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
    bipCoachConfig: { sheetId: "sheet456" },
    validationCacheOverride: cache,
  });
  const row = result.rows.find((r) => r.id === "sheetUrl");
  assert.equal(row.status, "done");
});

test("sheetUrl pending, not blocked, when persisted config exists but auth is not yet probed", () => {
  const result = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
    bipCoachConfig: { sheetId: "sheet456" },
    validationCacheOverride: makeCache(),
  });
  const row = result.rows.find((r) => r.id === "sheetUrl");
  assert.equal(row.status, "pending");
});

// --- Blocked cascade ---

test("gwsAuth blocked cascades to docUrl and sheetUrl blocked", () => {
  const result = deriveReadinessState({
    env: { PATH: "/nonexistent/path" },
    bipCoachConfig: { docId: "doc1", sheetId: "sh1" },
  });
  const gwsAuth = result.rows.find((r) => r.id === "gwsAuth");
  const docUrl = result.rows.find((r) => r.id === "docUrl");
  const sheetUrl = result.rows.find((r) => r.id === "sheetUrl");
  assert.equal(gwsAuth.status, "blocked");
  assert.equal(docUrl.status, "blocked");
  assert.equal(sheetUrl.status, "blocked");
});

// --- All 6 rows always returned ---

test("deriveReadinessState always returns exactly 6 rows", () => {
  const result = deriveReadinessState({});
  assert.equal(result.rows.length, 6);
  const ids = result.rows.map((r) => r.id);
  for (const id of ["googleSignIn", "workspace", "gwsInstall", "gwsAuth", "docUrl", "sheetUrl"]) {
    assert.ok(ids.includes(id), `missing row: ${id}`);
  }
});

// --- Validation cache TTL ---

test("clearValidationCache causes gwsAuth to revert to pending", () => {
  // First derive with cached done state
  const cache = makeCache([
    ["gwsAuth:probe", { ok: true, expiresAt: FAR_FUTURE }],
  ]);
  const before = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
    validationCacheOverride: cache,
  });
  assert.equal(before.rows.find((r) => r.id === "gwsAuth").status, "done");

  // Clear cache then re-derive without override (uses real module cache — already clear)
  clearValidationCache();
  const after = deriveReadinessState({
    env: { ...process.env, AGENTIC30_GWS_BIN: process.execPath, PATH: "" },
  });
  // Without cache entry, gwsAuth is pending (not done)
  assert.notEqual(after.rows.find((r) => r.id === "gwsAuth").status, "done");
});

// --- formatReadinessError ---

test("formatReadinessError classifies invalid_rapt as auth_expired", () => {
  const err = formatReadinessError(new Error("invalid_rapt error from gws"));
  assert.equal(err.kind, "auth_expired");
  assert.ok(err.user_message.length > 0);
});

test("formatReadinessError classifies permission denied", () => {
  const err = formatReadinessError(new Error("permission denied"));
  assert.equal(err.kind, "permission_denied");
});

test("formatReadinessError classifies OAuth test-user denial as permission_denied", () => {
  const err = formatReadinessError(
    new Error("Error 403: access_denied. The developer hasn't given you access to this app."),
  );
  assert.equal(err.kind, "permission_denied");
  assert.match(err.user_message, /Test users/);
});

test("formatReadinessError classifies not found", () => {
  const err = formatReadinessError(new Error("not found: document"));
  assert.equal(err.kind, "not_found");
});

test("formatReadinessError classifies network errors", () => {
  const err = formatReadinessError(new Error("ECONNREFUSED"));
  assert.equal(err.kind, "network");
});

test("formatReadinessError falls back to unknown", () => {
  const err = formatReadinessError(new Error("something completely different"));
  assert.equal(err.kind, "unknown");
});

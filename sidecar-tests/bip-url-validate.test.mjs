/**
 * Tests for bip-readiness.mjs validateUrl():
 * URL parsing, error kind classification, auth_expired cascade signal.
 *
 * All gws CLI calls are mocked via the gwsExec override — never invoke real CLIs.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  clearValidationCache,
  copyTemplateToDrive,
  formatReadinessError,
  validateUrl,
} from "../sidecar/bip-readiness.mjs";
import {
  parseGoogleDocUrl,
  parseGoogleSheetUrl,
} from "../sidecar/bip-coach-state.mjs";

// --- URL parsing (pure, no spawn) ---

test("parses valid Google Doc URL and extracts documentId", () => {
  const { documentId } = parseGoogleDocUrl(
    "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz1234567/edit",
  );
  assert.equal(documentId, "1AbCdEfGhIjKlMnOpQrStUvWxYz1234567");
});

test("parses valid Google Sheet URL and extracts spreadsheetId", () => {
  const { spreadsheetId } = parseGoogleSheetUrl(
    "https://docs.google.com/spreadsheets/d/16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA/edit",
  );
  assert.equal(spreadsheetId, "16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA");
});

test("returns empty documentId for non-google doc URL", () => {
  const { documentId } = parseGoogleDocUrl("https://notion.so/some-page");
  assert.equal(documentId, "");
});

test("returns empty spreadsheetId for malformed URL", () => {
  const { spreadsheetId } = parseGoogleSheetUrl("not-a-url-at-all");
  assert.equal(spreadsheetId, "");
});

test("returns empty documentId for empty string", () => {
  const { documentId } = parseGoogleDocUrl("");
  assert.equal(documentId, "");
});

// --- validateUrl: invalid format (no spawn needed) ---

test("validateUrl returns error for malformed doc URL (no gws call)", async () => {
  clearValidationCache();
  const result = await validateUrl({
    env: { PATH: "/nonexistent" },
    url: "https://notion.so/some-page",
    kind: "doc",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, "not_found");
  assert.match(result.error.user_message, /Google Docs URL/);
});

test("validateUrl returns error for malformed sheet URL (no gws call)", async () => {
  clearValidationCache();
  const result = await validateUrl({
    env: { PATH: "/nonexistent" },
    url: "https://notion.so/some-page",
    kind: "sheet",
  });
  assert.equal(result.ok, false);
  assert.equal(result.error.kind, "not_found");
  assert.match(result.error.user_message, /Google Sheets URL/);
});

test("validateUrl returns error for unknown kind", async () => {
  clearValidationCache();
  const result = await validateUrl({
    env: { PATH: "/nonexistent" },
    url: "https://docs.google.com/document/d/abc123/edit",
    kind: "unknown-kind",
  });
  assert.equal(result.ok, false);
});

// --- validateUrl: gws CLI errors classified correctly ---
// We mock the gws spawn by pointing AGENTIC30_GWS_BIN to a fake script.

import { writeFile, chmod, mkdtemp, rm } from "node:fs/promises";
import { join } from "node:path";
import os from "node:os";

// gwsExec resolves on exit code 0 or 1, rejects on code >= 2.
// Use exit code 2 to simulate gws errors in tests.
async function withFakeGws(exitCode, stderr, callback) {
  const dir = await mkdtemp(join(os.tmpdir(), "bip-url-test-"));
  const gwsPath = join(dir, "gws");
  const script = `#!/bin/sh\necho '${stderr}' >&2\nexit ${exitCode}\n`;
  await writeFile(gwsPath, script);
  await chmod(gwsPath, 0o755);
  try {
    await callback({ AGENTIC30_GWS_BIN: gwsPath, PATH: "" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function withFakeGwsScript(script, callback) {
  const dir = await mkdtemp(join(os.tmpdir(), "bip-url-test-"));
  const gwsPath = join(dir, "gws");
  await writeFile(gwsPath, script);
  await chmod(gwsPath, 0o755);
  try {
    await callback({ AGENTIC30_GWS_BIN: gwsPath, PATH: "" });
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

test("validateUrl classifies permission denied as permission_denied", async () => {
  clearValidationCache();
  await withFakeGws(2, "permission denied", async (env) => {
    const result = await validateUrl({
      env,
      url: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/edit",
      kind: "doc",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, "permission_denied");
  });
});

test("validateUrl classifies not found (404) as not_found", async () => {
  clearValidationCache();
  await withFakeGws(2, "not found", async (env) => {
    const result = await validateUrl({
      env,
      url: "https://docs.google.com/spreadsheets/d/16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA/edit",
      kind: "sheet",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, "not_found");
  });
});

test("validateUrl classifies invalid_rapt as auth_expired", async () => {
  clearValidationCache();
  await withFakeGws(2, "invalid_rapt: token expired", async (env) => {
    const result = await validateUrl({
      env,
      url: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/edit",
      kind: "doc",
    });
    assert.equal(result.ok, false);
    assert.equal(result.error.kind, "auth_expired");
  });
});

test("validateUrl succeeds when gws exits 0", async () => {
  clearValidationCache();
  await withFakeGws(0, "", async (env) => {
    const result = await validateUrl({
      env,
      url: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/edit",
      kind: "doc",
    });
    assert.equal(result.ok, true);
    assert.equal(result.docId, "1AbCdEfGhIjKlMnOpQrStUvWxYz12345");
  });
});

test("validateUrl returns sheetId on success for sheet kind", async () => {
  clearValidationCache();
  await withFakeGws(0, "", async (env) => {
    const result = await validateUrl({
      env,
      url: "https://docs.google.com/spreadsheets/d/16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA/edit",
      kind: "sheet",
    });
    assert.equal(result.ok, true);
    assert.equal(result.sheetId, "16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA");
  });
});

test("copyTemplateToDrive copies doc template and validates copied document", async () => {
  clearValidationCache();
  const script = `#!/bin/sh
case "$*" in
  *"files copy"*)
    echo '{"id":"copiedDoc123","name":"Agentic30 업무일지","webViewLink":"https://docs.google.com/document/d/copiedDoc123/edit"}'
    ;;
  *"docs documents get"*)
    echo '{"documentId":"copiedDoc123"}'
    ;;
  *)
    echo "unexpected args: $*" >&2
    exit 2
    ;;
esac
`;
  const logs = [];
  await withFakeGwsScript(script, async (env) => {
    const result = await copyTemplateToDrive({
      env,
      kind: "doc",
      sourceId: "templateDoc",
      title: "Agentic30 업무일지",
      onLog: (line) => logs.push(line),
    });
    assert.equal(result.ok, true);
    assert.equal(result.docId, "copiedDoc123");
    assert.equal(result.url, "https://docs.google.com/document/d/copiedDoc123/edit");
    assert.ok(logs.some((line) => line.includes("복사")));

    const cached = await validateUrl({
      env: { ...env, AGENTIC30_GWS_BIN: "/definitely/missing" },
      url: "https://docs.google.com/document/d/copiedDoc123/edit",
      kind: "doc",
    });
    assert.equal(cached.ok, true, "copied doc should be cached as validated");
  });
});

test("copyTemplateToDrive copies sheet template and validates copied spreadsheet", async () => {
  clearValidationCache();
  const script = `#!/bin/sh
case "$*" in
  *"files copy"*)
    echo '{"id":"copiedSheet456","name":"Agentic30 게시글 일지","webViewLink":"https://docs.google.com/spreadsheets/d/copiedSheet456/edit"}'
    ;;
  *"sheets spreadsheets get"*)
    echo '{"spreadsheetId":"copiedSheet456"}'
    ;;
  *)
    echo "unexpected args: $*" >&2
    exit 2
    ;;
esac
`;
  await withFakeGwsScript(script, async (env) => {
    const result = await copyTemplateToDrive({
      env,
      kind: "sheet",
      sourceId: "templateSheet",
      title: "Agentic30 게시글 일지",
    });
    assert.equal(result.ok, true);
    assert.equal(result.sheetId, "copiedSheet456");
    assert.equal(result.url, "https://docs.google.com/spreadsheets/d/copiedSheet456/edit");
  });
});

// --- auth_expired should signal gwsAuth recheck (cascade) ---
// The cascade happens in the IPC handler (index.mjs), but we verify the
// error.kind is correctly "auth_expired" so the handler can act on it.

test("auth_expired error.kind is the signal for gwsAuth recheck cascade", async () => {
  clearValidationCache();
  await withFakeGws(2, "invalid_grant: token expired", async (env) => {
    const result = await validateUrl({
      env,
      url: "https://docs.google.com/document/d/1AbCdEfGhIjKlMnOpQrStUvWxYz12345/edit",
      kind: "doc",
    });
    assert.equal(result.ok, false);
    // The IPC handler checks result.error?.kind === "auth_expired" to cascade
    assert.equal(result.error.kind, "auth_expired");
  });
});

// --- validation cache behavior ---

test("successful validation result is cached for 60s", async () => {
  clearValidationCache();
  let callCount = 0;
  await withFakeGws(0, "", async (env) => {
    // First call hits gws
    const r1 = await validateUrl({
      env,
      url: "https://docs.google.com/document/d/1CacheTestDocId1234567890abc/edit",
      kind: "doc",
    });
    assert.equal(r1.ok, true);

    // Second call with same URL — gws binary no longer matters, cache should hit
    // (we break the binary to confirm cache is used)
    const brokenEnv = { ...env, AGENTIC30_GWS_BIN: "/nonexistent/gws" };
    const r2 = await validateUrl({
      env: brokenEnv,
      url: "https://docs.google.com/document/d/1CacheTestDocId1234567890abc/edit",
      kind: "doc",
    });
    assert.equal(r2.ok, true, "second call should use cache, not gws");
  });
});

test("clearValidationCache forces re-validation on next call", async () => {
  // Prime the cache with a success
  await withFakeGws(0, "", async (env) => {
    await validateUrl({
      env,
      url: "https://docs.google.com/document/d/1ClearCacheDocId1234567890ab/edit",
      kind: "doc",
    });
  });

  // Clear cache then re-validate — now gws fails, so result should be failure
  clearValidationCache();
  await withFakeGws(2, "not found", async (env) => {
    const result = await validateUrl({
      env,
      url: "https://docs.google.com/document/d/1ClearCacheDocId1234567890ab/edit",
      kind: "doc",
    });
    assert.equal(result.ok, false, "after cache clear, gws is called again");
  });
});

// --- formatReadinessError ---

test("formatReadinessError includes raw message", () => {
  const err = formatReadinessError(new Error("some raw error text"));
  assert.ok(err.raw.includes("some raw error text"));
});

test("formatReadinessError works with string input", () => {
  const err = formatReadinessError("plain string error");
  assert.ok(typeof err.user_message === "string");
  assert.ok(typeof err.kind === "string");
});

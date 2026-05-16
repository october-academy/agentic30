import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  buildCacheKey,
  cacheFilePath,
  cacheDirectory,
  composeDay1Opening,
  readComposedFromCache,
  writeComposedToCache,
  COMPOSE_DAY1_SCHEMA_VERSION,
  COMPOSE_DAY1_CACHE_TTL_FRESH_MS,
  COMPOSE_DAY1_CACHE_TTL_DIRTY_MS,
} from "../sidecar/compose-day1-opening.mjs";

async function tempHome() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-compose-cache-"));
}

const SAMPLE_VALUE = Object.freeze({
  yesterday: "y", today: "t", question: "q",
  evidenceRefs: [], confidence: 0.7, source: "llm",
});

test("buildCacheKey is stable for identical inputs", () => {
  const a = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", dirty: false, onboarding: { role: "developer" } });
  const b = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", dirty: false, onboarding: { role: "developer" } });
  assert.equal(a, b);
});

test("buildCacheKey changes when git head changes", () => {
  const a = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", dirty: false });
  const b = buildCacheKey({ workspaceRoot: "/x", gitHead: "def", dirty: false });
  assert.notEqual(a, b);
});

test("buildCacheKey changes when dirty flips", () => {
  const a = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", dirty: false });
  const b = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", dirty: true });
  assert.notEqual(a, b);
});

test("buildCacheKey changes when onboarding answers change", () => {
  const a = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", onboarding: { role: "developer" } });
  const b = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", onboarding: { role: "designer" } });
  assert.notEqual(a, b);
});

test("buildCacheKey changes when schema version changes", () => {
  const a = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", schemaVersion: 1 });
  const b = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", schemaVersion: 2 });
  assert.notEqual(a, b);
});

test("buildCacheKey changes when tool policy version changes", () => {
  const a = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", toolPolicyVersion: 1 });
  const b = buildCacheKey({ workspaceRoot: "/x", gitHead: "abc", toolPolicyVersion: 2 });
  assert.notEqual(a, b);
});

test("cacheDirectory roots under ~/Library/Application Support/Agentic30", () => {
  const dir = cacheDirectory({ homeDir: "/Users/test" });
  assert.equal(dir, "/Users/test/Library/Application Support/Agentic30/discovery");
});

test("readComposedFromCache returns null when file missing", async () => {
  const homeDir = await tempHome();
  try {
    const result = await readComposedFromCache("nonexistent", { homeDir });
    assert.equal(result, null);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("write→read round trips inside fresh TTL", async () => {
  const homeDir = await tempHome();
  try {
    const key = "abc";
    const now = new Date("2026-05-15T12:00:00Z");
    await writeComposedToCache(key, SAMPLE_VALUE, { homeDir, now });
    const result = await readComposedFromCache(key, { homeDir, now });
    assert.equal(result.yesterday, "y");
    assert.equal(result.schemaVersion, COMPOSE_DAY1_SCHEMA_VERSION);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("read returns null past the fresh TTL", async () => {
  const homeDir = await tempHome();
  try {
    const key = "abc";
    const writeNow = new Date("2026-05-10T00:00:00Z");
    await writeComposedToCache(key, SAMPLE_VALUE, { homeDir, now: writeNow });
    const readNow = new Date(writeNow.getTime() + COMPOSE_DAY1_CACHE_TTL_FRESH_MS + 1);
    const result = await readComposedFromCache(key, { homeDir, now: readNow });
    assert.equal(result, null);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("dirty work tree uses the shorter TTL", async () => {
  const homeDir = await tempHome();
  try {
    const key = "abc";
    const writeNow = new Date("2026-05-10T00:00:00Z");
    await writeComposedToCache(key, SAMPLE_VALUE, { homeDir, now: writeNow });
    // Just past dirty TTL but well within fresh TTL.
    const readNow = new Date(writeNow.getTime() + COMPOSE_DAY1_CACHE_TTL_DIRTY_MS + 1);
    const fresh = await readComposedFromCache(key, { homeDir, now: readNow, dirty: false });
    assert.notEqual(fresh, null);
    const expired = await readComposedFromCache(key, { homeDir, now: readNow, dirty: true });
    assert.equal(expired, null);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("read returns null on schema mismatch", async () => {
  const homeDir = await tempHome();
  try {
    const key = "abc";
    const file = cacheFilePath(key, { homeDir });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, JSON.stringify({
      schemaVersion: COMPOSE_DAY1_SCHEMA_VERSION + 99,
      writtenAt: new Date().toISOString(),
      yesterday: "x",
    }));
    const result = await readComposedFromCache(key, { homeDir });
    assert.equal(result, null);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("read returns null when cache file is corrupt JSON", async () => {
  const homeDir = await tempHome();
  try {
    const key = "abc";
    const file = cacheFilePath(key, { homeDir });
    await fs.mkdir(path.dirname(file), { recursive: true });
    await fs.writeFile(file, "{not json");
    const result = await readComposedFromCache(key, { homeDir });
    assert.equal(result, null);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("write creates the cache directory if missing", async () => {
  const homeDir = await tempHome();
  try {
    const key = "abc";
    await writeComposedToCache(key, SAMPLE_VALUE, { homeDir });
    const file = cacheFilePath(key, { homeDir });
    const stat = await fs.stat(file);
    assert.ok(stat.isFile());
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

// PR3 (P1b): cacheKey derived inside composeDay1Opening must mix in the
// actual git HEAD sha so a clean repo advancing HEAD invalidates the cache,
// not just changes to firstCommitAt (project birth date).
test("composeDay1Opening cacheKey changes when git HEAD advances", async () => {
  const homeDir = await tempHome();
  try {
    const baseContext = (head) => ({
      schemaVersion: 1,
      sourceScanRoot: "/tmp/x",
      foundDocCount: 0,
      missingExpectedDocs: ["icp", "spec"],
      localDiscovery: {
        schemaVersion: 1,
        git: { isGitRepo: true, head, firstCommitAt: "2026-04-01T00:00:00Z", last7DaysCommitCount: 5, dirty: false, branch: "main" },
        project: { stacks: [], hasReadme: false, manifestPaths: [] },
        runway: { projectAgeDays: 30, recentlyActive: true },
      },
    });
    const a = await composeDay1Opening({
      workspaceRoot: "/tmp/x",
      context: baseContext("aaaa1111aaaa1111aaaa1111aaaa1111aaaa1111"),
      deterministicVariables: { day1_yesterday: "y", day1_today: "t", day1_question: "q" },
      homeDir,
    });
    const b = await composeDay1Opening({
      workspaceRoot: "/tmp/x",
      context: baseContext("bbbb2222bbbb2222bbbb2222bbbb2222bbbb2222"),
      deterministicVariables: { day1_yesterday: "y", day1_today: "t", day1_question: "q" },
      homeDir,
    });
    assert.notEqual(a.cacheKey, b.cacheKey,
      "cacheKey must change when git HEAD advances even if firstCommitAt stays");
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

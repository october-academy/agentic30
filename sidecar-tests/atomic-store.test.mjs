import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import os from "node:os";

import { withFileLock, atomicWriteJson } from "../sidecar/atomic-store.mjs";

async function tempFile() {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-atomic-"));
  return path.join(dir, "store.json");
}

test("atomicWriteJson writes payload and sets 0o600 mode", async () => {
  const filePath = await tempFile();
  await atomicWriteJson(filePath, { hello: "world" });
  const content = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.deepEqual(content, { hello: "world" });
  const stat = await fs.stat(filePath);
  assert.equal(stat.mode & 0o777, 0o600);
});

test("withFileLock serializes 20 concurrent read-modify-write operations", async () => {
  const filePath = await tempFile();
  await atomicWriteJson(filePath, { count: 0 });
  const ops = Array.from({ length: 20 }, () =>
    withFileLock(filePath, async () => {
      const raw = JSON.parse(await fs.readFile(filePath, "utf8"));
      const next = { count: raw.count + 1 };
      await atomicWriteJson(filePath, next);
      return next.count;
    }),
  );
  await Promise.all(ops);
  const final = JSON.parse(await fs.readFile(filePath, "utf8"));
  assert.equal(final.count, 20, "expected 20 increments without lost updates");
});

test("withFileLock removes lock file after successful operation", async () => {
  const filePath = await tempFile();
  await withFileLock(filePath, async () => {});
  await assert.rejects(fs.stat(`${filePath}.lock`), /ENOENT/);
});

test("withFileLock removes lock file after operation throws", async () => {
  const filePath = await tempFile();
  await assert.rejects(
    withFileLock(filePath, async () => {
      throw new Error("boom");
    }),
    /boom/,
  );
  await assert.rejects(fs.stat(`${filePath}.lock`), /ENOENT/);
});

test("withFileLock recovers from a stale lock", async () => {
  const filePath = await tempFile();
  const lockPath = `${filePath}.lock`;
  await fs.writeFile(lockPath, "");
  // Backdate mtime past timeout
  const past = (Date.now() - 60_000) / 1000;
  await fs.utimes(lockPath, past, past);
  let entered = false;
  await withFileLock(
    filePath,
    async () => {
      entered = true;
    },
    { timeoutMs: 1000 },
  );
  assert.equal(entered, true);
});

test("withFileLock returns the function's value", async () => {
  const filePath = await tempFile();
  const value = await withFileLock(filePath, async () => 42);
  assert.equal(value, 42);
});

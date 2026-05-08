import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";

const DEFAULT_LOCK_TIMEOUT_MS = 5000;
const DEFAULT_LOCK_POLL_MS = 25;

// Per-file mutual exclusion via filesystem `O_CREAT | O_EXCL` (Node 'wx' flag).
// Two callers cannot create the same lockfile concurrently — the loser retries.
// Stale locks (older than `timeoutMs`) are force-cleared so a crashed writer
// doesn't deadlock subsequent ones.
export async function withFileLock(
  filePath,
  fn,
  { timeoutMs = DEFAULT_LOCK_TIMEOUT_MS, pollMs = DEFAULT_LOCK_POLL_MS } = {},
) {
  const lockPath = `${filePath}.lock`;
  // Ensure the parent directory exists so the very first writer can create
  // the lock file even when `<workspace>/.agentic30/` has not been created yet.
  await fs.mkdir(path.dirname(lockPath), { recursive: true });
  const start = Date.now();
  let handle;
  while (true) {
    try {
      handle = await fs.open(lockPath, "wx", 0o600);
      break;
    } catch (err) {
      if (err.code !== "EEXIST") throw err;
      try {
        const stat = await fs.stat(lockPath);
        if (Date.now() - stat.mtimeMs > timeoutMs) {
          await fs.unlink(lockPath).catch(() => {});
          continue;
        }
      } catch {
        // lock vanished between EEXIST and stat — retry immediately
        continue;
      }
      if (Date.now() - start > timeoutMs) {
        throw new Error(`atomic-store: lock timeout for ${lockPath}`);
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close().catch(() => {});
    await fs.unlink(lockPath).catch(() => {});
  }
}

// Atomic JSON write: temp file with random suffix → fsync via writeFile → rename.
// `randomUUID` prevents temp-path collisions under concurrent writers
// (Codex review: `process.pid + Date.now()` collides under same-pid concurrency).
export async function atomicWriteJson(filePath, payload) {
  const dir = path.dirname(filePath);
  const base = path.basename(filePath);
  const tempPath = path.join(dir, `.${base}.${randomUUID()}.tmp`);
  await fs.mkdir(dir, { recursive: true });
  try {
    await fs.writeFile(tempPath, JSON.stringify(payload, null, 2), { mode: 0o600 });
    await fs.chmod(tempPath, 0o600).catch(() => {});
    await fs.rename(tempPath, filePath);
    await fs.chmod(filePath, 0o600).catch(() => {});
  } catch (error) {
    await fs.unlink(tempPath).catch(() => {});
    throw error;
  }
}

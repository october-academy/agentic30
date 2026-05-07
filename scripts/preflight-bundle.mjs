#!/usr/bin/env node
// Smoke test: spawn the bundled sidecar from sidecar-build/sidecar/ and wait
// for the sidecar-ready handshake. Exits non-zero on timeout, crash, or if
// the bundle is missing. Used by the release checklist to guard against
// regressions like unbundled node_modules or unsigned native binaries.

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const BUNDLE_ENTRY = path.resolve(__dirname, "..", "sidecar-build", "sidecar", "index.mjs");
const READY_TIMEOUT_MS = 8000;

if (!existsSync(BUNDLE_ENTRY)) {
  console.error(
    `[preflight-bundle] bundle missing at ${BUNDLE_ENTRY}. ` +
      `Run 'node scripts/build-sidecar.mjs' or build the Xcode target first.`
  );
  process.exit(2);
}

const workspaceRoot = process.argv.includes("--workspace")
  ? process.argv[process.argv.indexOf("--workspace") + 1]
  : os.homedir();

const child = spawn(process.execPath, [BUNDLE_ENTRY, "--workspace", workspaceRoot], {
  cwd: workspaceRoot,
  stdio: ["ignore", "pipe", "pipe"],
});

let stdoutBuffer = "";
let resolved = false;

const timeout = setTimeout(() => {
  if (resolved) return;
  resolved = true;
  console.error(
    `[preflight-bundle] sidecar did not emit sidecar-ready within ${READY_TIMEOUT_MS}ms`
  );
  child.kill("SIGTERM");
  process.exit(1);
}, READY_TIMEOUT_MS);

child.stdout.on("data", (chunk) => {
  stdoutBuffer += chunk.toString();
  for (const line of stdoutBuffer.split("\n")) {
    if (!line.trim()) continue;
    try {
      const event = JSON.parse(line);
      if (event.type === "sidecar-ready") {
        resolved = true;
        clearTimeout(timeout);
        console.log(
          `[preflight-bundle] sidecar-ready on port ${event.port} (pid ${event.pid})`
        );
        child.kill("SIGTERM");
        process.exit(0);
      }
    } catch {
      // non-JSON log line; ignore
    }
  }
  // Keep only the trailing partial line in the buffer.
  const idx = stdoutBuffer.lastIndexOf("\n");
  if (idx >= 0) stdoutBuffer = stdoutBuffer.slice(idx + 1);
});

child.stderr.on("data", (chunk) => {
  process.stderr.write(chunk);
});

child.on("exit", (code, signal) => {
  if (resolved) return;
  clearTimeout(timeout);
  console.error(
    `[preflight-bundle] sidecar exited before ready (code=${code}, signal=${signal})`
  );
  process.exit(1);
});

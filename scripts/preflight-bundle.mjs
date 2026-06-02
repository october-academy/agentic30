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
const BUNDLE_ROOT = path.resolve(__dirname, "..", "sidecar-build", "sidecar");
const BUNDLE_ENTRY = path.join(BUNDLE_ROOT, "index.mjs");
const BUNDLE_ARCH = normalizeBundleArch(process.env.AGENTIC30_BUNDLE_ARCH || process.arch);
const BUNDLED_NODE = path.join(
  BUNDLE_ROOT,
  "runtime",
  `node-darwin-${BUNDLE_ARCH}`,
  "bin",
  "node"
);
const BUNDLED_CODEX = path.join(
  BUNDLE_ROOT,
  "node_modules",
  "@openai",
  `codex-darwin-${BUNDLE_ARCH}`,
  "vendor",
  BUNDLE_ARCH === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin",
  "codex",
  "codex"
);
const BUNDLED_CODEX_PENCIL_STYLE = path.join(
  BUNDLE_ROOT,
  "node_modules",
  "@openai",
  `codex-darwin-${BUNDLE_ARCH}`,
  "vendor",
  BUNDLE_ARCH === "arm64" ? "aarch64-apple-darwin" : "x86_64-apple-darwin",
  "bin",
  "codex"
);
const READY_TIMEOUT_MS = 8000;

if (!existsSync(BUNDLE_ENTRY)) {
  console.error(
    `[preflight-bundle] bundle missing at ${BUNDLE_ENTRY}. ` +
      `Run 'node scripts/build-sidecar.mjs' or build the Xcode target first.`
  );
  process.exit(2);
}

if (!existsSync(BUNDLED_NODE)) {
  console.error(
    `[preflight-bundle] bundled Node runtime missing at ${BUNDLED_NODE}. ` +
      `Run 'node scripts/build-sidecar.mjs' or build the Xcode target first.`
  );
  process.exit(2);
}

if (!existsSync(BUNDLED_CODEX) && !existsSync(BUNDLED_CODEX_PENCIL_STYLE)) {
  console.error(
    `[preflight-bundle] bundled Codex CLI missing at ${BUNDLED_CODEX} or ${BUNDLED_CODEX_PENCIL_STYLE}. ` +
      `Run 'AGENTIC30_BUNDLE_ARCH=${BUNDLE_ARCH} node scripts/build-sidecar.mjs' or build the Xcode target first.`
  );
  process.exit(2);
}

if (BUNDLE_ARCH !== process.arch) {
  console.log(
    `[preflight-bundle] bundle files present for ${BUNDLE_ARCH}; skipping launch on ${process.arch}.`
  );
  process.exit(0);
}

const workspaceRoot = process.argv.includes("--workspace")
  ? process.argv[process.argv.indexOf("--workspace") + 1]
  : os.homedir();

const child = spawn(BUNDLED_NODE, [BUNDLE_ENTRY, "--workspace", workspaceRoot], {
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

function normalizeBundleArch(value) {
  const normalized = String(value || "").trim().toLowerCase();
  if (normalized === "arm64" || normalized === "x64") return normalized;
  if (normalized === "universal") return process.arch;
  throw new Error(`AGENTIC30_BUNDLE_ARCH must be arm64, x64, or universal; received ${value}`);
}

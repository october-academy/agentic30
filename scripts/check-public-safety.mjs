#!/usr/bin/env node
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

const execFileAsync = promisify(execFile);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = path.resolve(__dirname, "..");

const BLOCKED_PATH_PATTERNS = [
  /(^|\/)\.env(?:$|[.\-/])/,
  /(^|\/)secrets\//,
  /\.(?:p12|p8|pem|key|mobileprovision|provisionprofile)$/i,
];

const SECRET_PATTERNS = [
  { id: "test-sentinel", pattern: new RegExp("unit-test" + "-public-safety-token") },
  {
    id: "private-key",
    pattern: new RegExp("-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE " + "KEY-----"),
  },
  { id: "aws-access-key", pattern: /\bAKIA[0-9A-Z]{16}\b/ },
  { id: "github-token", pattern: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/ },
  { id: "slack-token", pattern: /\bxox[baprs]-[A-Za-z0-9-]{20,}\b/ },
  { id: "openai-token", pattern: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/ },
  { id: "anthropic-key", pattern: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/ },
  { id: "azure-secret", pattern: /\bAZURE_[A-Z0-9_]*(?:KEY|SECRET|TOKEN)\b\s*[:=]\s*["']?[^"'\s]{16,}/i },
  {
    id: "gcp-service-account",
    pattern: new RegExp('"private_key"\\s*:\\s*"-----BEGIN PRIVATE ' + 'KEY-----', "i"),
  },
  {
    id: "api-key",
    pattern: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token)\b\s*[:=]\s*["']?[A-Za-z0-9][A-Za-z0-9_-]{31,}/i,
  },
  {
    id: "client-secret",
    pattern: /\bclient_secret\b\s*[:=]\s*["'][^"']{12,}["']/i,
  },
];

const CONTENT_ALLOWLIST = new Set([
  "sidecar-tests/fixtures/public-safety/allowed-secret-fixture.txt",
]);

export async function runCheckPublicSafety({
  repoRoot = REPO_ROOT,
  files = null,
  log = (message) => console.log(message),
} = {}) {
  const trackedFiles = files ?? await listTrackedFiles(repoRoot);
  const findings = [];

  for (const rel of trackedFiles) {
    const normalized = rel.split(path.sep).join("/");
    for (const pattern of BLOCKED_PATH_PATTERNS) {
      if (pattern.test(normalized)) {
        findings.push({ path: normalized, reason: "blocked-path" });
        break;
      }
    }
    if (CONTENT_ALLOWLIST.has(normalized)) continue;

    let content;
    try {
      content = await fs.readFile(path.join(repoRoot, rel), "utf8");
    } catch {
      continue;
    }
    for (const { id, pattern } of SECRET_PATTERNS) {
      if (pattern.test(content)) {
        findings.push({ path: normalized, reason: id });
      }
    }
  }

  if (findings.length > 0) {
    log("public-safety: blocked public repository risk");
    for (const finding of findings) {
      log(`${finding.path}: ${finding.reason}`);
    }
    return { exitCode: 1, findings };
  }

  log("public-safety: clean");
  return { exitCode: 0, findings: [] };
}

async function listTrackedFiles(repoRoot) {
  const { stdout } = await execFileAsync("git", ["ls-files", "-z"], {
    cwd: repoRoot,
    encoding: "buffer",
    maxBuffer: 20 * 1024 * 1024,
  });
  return stdout.toString("utf8").split("\0").filter(Boolean);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  runCheckPublicSafety()
    .then(({ exitCode }) => {
      process.exitCode = exitCode;
    })
    .catch((err) => {
      console.error(`public-safety: ${err?.message || err}`);
      process.exitCode = 2;
    });
}

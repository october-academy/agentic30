import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { fileURLToPath } from "node:url";

import { runCheckPublicSafety } from "../scripts/check-public-safety.mjs";

const execFileAsync = promisify(execFile);

test("public safety check rejects tracked secret paths and token-shaped content", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-public-safety-"));
  try {
    await fs.mkdir(path.join(root, "secrets"), { recursive: true });
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    const openAiToken = `sk-proj_${"abcdefghijklmnopqrstuvwxyz"}`;
    const githubToken = `ghp_${"abcdefghijklmnopqrstuvwxyzABCDEFGHIJKL"}`;
    const credentialValue = "abcdefghijklmnopqrstuvwxyz1234567890";
    const apiKeyLabel = ["API", "KEY"].join("_");
    const clientSecretLabel = ["client", "secret"].join("_");
    await fs.writeFile(path.join(root, ".env.local"), `OPENAI_API_KEY='${openAiToken}'\n`);
    await fs.writeFile(path.join(root, ".envrc"), "export PRIVATE_ENV=1\n");
    await fs.writeFile(path.join(root, ".npmrc"), "//registry.npmjs.org/:_authToken=fake\n");
    await fs.writeFile(path.join(root, "secrets", "developer-id.key"), "not even scanned by content\n");
    await fs.writeFile(
      path.join(root, "src", "leak.js"),
      [
        `const token = '${githubToken}';`,
        `const anthropic = '${"sk-ant-"}${"abcdefghijklmnopqrstuvwxyz"}';`,
        `const azure = 'AZURE_CLIENT_SECRET=${"abcdefghijklmnopqrstuvwxyz123456"}';`,
        `const generic = '${apiKeyLabel}=${"abcdefghijklmnopqrstuvwxyz123456"}';`,
        `const credentialValue = '${credentialValue}';`,
        `const legacyClientSecret = '${clientSecretLabel}=${credentialValue}';`,
        `const gcp = '{"private_key":"-----BEGIN PRIVATE ${"KEY"}-----"}';`,
        "",
      ].join("\n"),
    );

    const messages = [];
    const result = await runCheckPublicSafety({
      repoRoot: root,
      files: [".env.local", ".envrc", ".npmrc", "secrets/developer-id.key", "src/leak.js"],
      log: (message) => messages.push(message),
    });

    assert.equal(result.exitCode, 1);
    assert.ok(result.findings.some((finding) => finding.path === ".env.local"));
    assert.ok(result.findings.some((finding) => finding.path === ".envrc"));
    assert.ok(result.findings.some((finding) => finding.path === ".npmrc"));
    assert.ok(result.findings.some((finding) => finding.path === "secrets/developer-id.key"));
    assert.ok(result.findings.some((finding) => finding.reason === "github-token"));
    assert.ok(result.findings.some((finding) => finding.reason === "anthropic-key"));
    assert.ok(result.findings.some((finding) => finding.reason === "azure-secret"));
    assert.ok(result.findings.some((finding) => finding.reason === "api-key"));
    assert.ok(result.findings.some((finding) => finding.reason === "client-secret"));
    assert.ok(result.findings.some((finding) => finding.reason === "gcp-service-account"));
    assert.match(messages.join("\n"), /public repository risk/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("public safety check allows intentional fixture path", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-public-safety-"));
  try {
    const rel = "sidecar-tests/fixtures/public-safety/allowed-secret-fixture.txt";
    await fs.mkdir(path.dirname(path.join(root, rel)), { recursive: true });
    await fs.writeFile(path.join(root, rel), `${"unit-test"}-public-safety-token\n`);

    const result = await runCheckPublicSafety({
      repoRoot: root,
      files: [rel],
      log: () => {},
    });

    assert.equal(result.exitCode, 0);
    assert.deepEqual(result.findings, []);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("public safety check passes for the current tracked repository", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const result = await runCheckPublicSafety({
    repoRoot,
    log: () => {},
  });

  assert.equal(result.exitCode, 0, JSON.stringify(result.findings, null, 2));
});

test("local secret and agent cache paths are ignored by git", async () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
  const { stdout } = await execFileAsync("git", [
    "check-ignore",
    "-v",
    ".agents/",
    ".env.local",
    "secrets/developer-id.key",
  ], { cwd: repoRoot });

  assert.match(stdout, /\.gitignore:\d+:\.agents\//);
  assert.match(stdout, /\.gitignore:\d+:\.env\.local/);
  assert.match(stdout, /\.gitignore:\d+:secrets\//);
});

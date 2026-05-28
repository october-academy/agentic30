import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { spawn } from "node:child_process";
import {
  ONBOARDING_WORKSPACE_REQUESTS_DIRNAME,
  ONBOARDING_WORKSPACE_REQUEST_TTL_MS,
  registerOnboardingWorkspaceRequest,
} from "../sidecar/onboarding-workspace-request.mjs";

const ENTRYPOINT_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
  "sidecar",
  "onboarding-helper.mjs",
);

async function writeNonce(nonceStorePath, { token, expiresAt }) {
  await fs.mkdir(path.dirname(nonceStorePath), { recursive: true });
  await fs.writeFile(
    nonceStorePath,
    JSON.stringify({ token, expiresAt }),
    { mode: 0o600 },
  );
}

function runHelperCli(argv, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [ENTRYPOINT_PATH, ...argv], {
      env: { ...process.env, ...env },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => { stdout += chunk.toString(); });
    child.stderr.on("data", (chunk) => { stderr += chunk.toString(); });
    child.on("error", reject);
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

test("registerOnboardingWorkspaceRequest writes a pending request for a valid directory", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-support-"));
  try {
    const result = await registerOnboardingWorkspaceRequest({
      appSupportPath,
      workspacePath: root,
      source: "codex",
      usedCwd: true,
      now: new Date("2026-05-28T00:00:00.000Z"),
    });

    assert.equal(result.ok, true);
    assert.equal(result.path, root);
    assert.equal(result.source, "codex");
    assert.equal(result.usedCwd, true);

    const requestDir = path.join(appSupportPath, ONBOARDING_WORKSPACE_REQUESTS_DIRNAME);
    const files = await fs.readdir(requestDir);
    assert.equal(files.length, 1);
    const payload = JSON.parse(await fs.readFile(path.join(requestDir, files[0]), "utf8"));
    assert.equal(payload.status, "pending");
    assert.equal(payload.path, root);
    assert.equal(payload.basename, path.basename(root));
    assert.equal(payload.expiresAt, "2026-05-28T00:30:00.000Z");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("registerOnboardingWorkspaceRequest rejects missing and non-directory paths", async () => {
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-support-"));
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-workspace-"));
  const filePath = path.join(root, "README.md");
  try {
    await fs.writeFile(filePath, "# test\n");

    const missing = await registerOnboardingWorkspaceRequest({ appSupportPath, workspacePath: "" });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /required/);

    const relative = await registerOnboardingWorkspaceRequest({ appSupportPath, workspacePath: "relative/path" });
    assert.equal(relative.ok, false);
    assert.match(relative.error, /absolute/);

    const file = await registerOnboardingWorkspaceRequest({ appSupportPath, workspacePath: filePath });
    assert.equal(file.ok, false);
    assert.match(file.error, /not a directory/);

    await assert.rejects(fs.readdir(path.join(appSupportPath, ONBOARDING_WORKSPACE_REQUESTS_DIRNAME)));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("registerOnboardingWorkspaceRequest preserves claimedSource and normalizes unknown sources", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-support-"));
  try {
    const result = await registerOnboardingWorkspaceRequest({
      appSupportPath,
      workspacePath: root,
      source: "vscode",
    });

    assert.equal(result.ok, true);
    assert.equal(result.source, "unknown");
    assert.equal(result.claimedSource, "vscode");

    const files = await fs.readdir(path.join(appSupportPath, ONBOARDING_WORKSPACE_REQUESTS_DIRNAME));
    const payload = JSON.parse(
      await fs.readFile(path.join(appSupportPath, ONBOARDING_WORKSPACE_REQUESTS_DIRNAME, files[0]), "utf8"),
    );
    assert.equal(payload.source, "unknown");
    assert.equal(payload.claimedSource, "vscode");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("registerOnboardingWorkspaceRequest enforces onboarding nonce when nonceStorePath is provided", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-support-"));
  const nonceStorePath = path.join(appSupportPath, "onboarding-nonce.json");
  try {
    const now = new Date("2026-05-28T00:00:00.000Z");
    const future = new Date(now.getTime() + ONBOARDING_WORKSPACE_REQUEST_TTL_MS).toISOString();
    const past = new Date(now.getTime() - 60_000).toISOString();

    const missing = await registerOnboardingWorkspaceRequest({
      appSupportPath, workspacePath: root, source: "codex",
      nonceStorePath, token: "t-abc", now,
    });
    assert.equal(missing.ok, false);
    assert.match(missing.error, /mismatch/);

    await writeNonce(nonceStorePath, { token: "t-good", expiresAt: future });

    const wrong = await registerOnboardingWorkspaceRequest({
      appSupportPath, workspacePath: root, source: "codex",
      nonceStorePath, token: "t-bad", now,
    });
    assert.equal(wrong.ok, false);
    assert.match(wrong.error, /mismatch/);

    const noToken = await registerOnboardingWorkspaceRequest({
      appSupportPath, workspacePath: root, source: "codex",
      nonceStorePath, now,
    });
    assert.equal(noToken.ok, false);
    assert.match(noToken.error, /required/);

    await writeNonce(nonceStorePath, { token: "t-stale", expiresAt: past });
    const expired = await registerOnboardingWorkspaceRequest({
      appSupportPath, workspacePath: root, source: "codex",
      nonceStorePath, token: "t-stale", now,
    });
    assert.equal(expired.ok, false);
    assert.match(expired.error, /expired/);

    await writeNonce(nonceStorePath, { token: "t-good", expiresAt: future });
    const happy = await registerOnboardingWorkspaceRequest({
      appSupportPath, workspacePath: root, source: "codex",
      nonceStorePath, token: "t-good", now,
    });
    assert.equal(happy.ok, true);
    assert.equal(happy.claimedSource, "codex");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("--register CLI registers a workspace via argv and exits 0", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-support-"));
  const nonceStorePath = path.join(appSupportPath, "onboarding-nonce.json");
  try {
    const future = new Date(Date.now() + ONBOARDING_WORKSPACE_REQUEST_TTL_MS).toISOString();
    await writeNonce(nonceStorePath, { token: "cli-token", expiresAt: future });

    const { code, stdout } = await runHelperCli(
      ["--register", "--path", root, "--source", "claude_code", "--token", "cli-token"],
      {
        AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
        AGENTIC30_ONBOARDING_NONCE_PATH: nonceStorePath,
      },
    );
    assert.equal(code, 0);
    const parsed = JSON.parse(stdout.trim().split("\n").pop());
    assert.equal(parsed.ok, true);
    assert.equal(parsed.path, root);
    assert.equal(parsed.claimedSource, "claude_code");

    const requests = await fs.readdir(path.join(appSupportPath, ONBOARDING_WORKSPACE_REQUESTS_DIRNAME));
    assert.equal(requests.length, 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("--register CLI rejects mismatched token with non-zero exit", async () => {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-workspace-"));
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-support-"));
  const nonceStorePath = path.join(appSupportPath, "onboarding-nonce.json");
  try {
    const future = new Date(Date.now() + ONBOARDING_WORKSPACE_REQUEST_TTL_MS).toISOString();
    await writeNonce(nonceStorePath, { token: "expected", expiresAt: future });

    const { code, stdout, stderr } = await runHelperCli(
      ["--register", "--path", root, "--source", "codex", "--token", "wrong"],
      {
        AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
        AGENTIC30_ONBOARDING_NONCE_PATH: nonceStorePath,
      },
    );
    assert.equal(code, 1);
    const parsed = JSON.parse(stdout.trim().split("\n").pop());
    assert.equal(parsed.ok, false);
    assert.match(parsed.error, /mismatch/);
    assert.match(stderr, /mismatch/);

    await assert.rejects(
      fs.readdir(path.join(appSupportPath, ONBOARDING_WORKSPACE_REQUESTS_DIRNAME)),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
});

test("onboarding helper without args prints usage and exits 64", async () => {
  const { code, stdout, stderr } = await runHelperCli([], {});
  assert.equal(code, 64);
  assert.equal(stdout, "");
  assert.match(stderr, /usage: agentic30-onboarding/);
});

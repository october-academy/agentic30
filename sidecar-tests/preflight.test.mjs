import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs";
import fsp from "node:fs/promises";
import { buildPreflightReport } from "../sidecar/preflight.mjs";

test("buildPreflightReport passes required local checks and warns for missing providers", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic30-preflight-"));
  const sidecarRoot = path.join(root, "sidecar");
  await fsp.mkdir(sidecarRoot);
  await fsp.writeFile(path.join(sidecarRoot, "index.mjs"), "");
  await fsp.writeFile(path.join(sidecarRoot, "mcp-server.mjs"), "");

  const report = buildPreflightReport({
    appSupportPath: path.join(root, "support"),
    workspaceRoot: root,
    sidecarRoot,
    environment: {
      claude: { available: false },
      codex: { available: false },
      acp: { available: false, message: "missing API key" },
      qmd: { available: true, message: "Bundled QMD MCP is available" },
    },
    processInfo: {
      version: "v22.0.0",
    },
  });

  assert.equal(report.status, "warning");
  assert.equal(report.checks.find((check) => check.id === "node-version").status, "ok");
  assert.equal(report.checks.find((check) => check.id === "provider-auth").status, "warning");
  assert.equal(report.checks.find((check) => check.id === "qmd-mcp").status, "ok");
});

test("buildPreflightReport warns when QMD MCP is unavailable", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic30-preflight-qmd-"));
  const sidecarRoot = path.join(root, "sidecar");
  await fsp.mkdir(sidecarRoot);
  await fsp.writeFile(path.join(sidecarRoot, "index.mjs"), "");
  await fsp.writeFile(path.join(sidecarRoot, "mcp-server.mjs"), "");

  const report = buildPreflightReport({
    appSupportPath: path.join(root, "support"),
    workspaceRoot: root,
    sidecarRoot,
    environment: {
      claude: { available: true },
      codex: { available: false },
      acp: { available: true, message: "ready" },
      qmd: { available: false, message: "QMD CLI not found" },
    },
    processInfo: {
      version: "v22.0.0",
    },
  });

  assert.equal(report.status, "warning");
  assert.equal(report.checks.find((check) => check.id === "qmd-mcp").status, "warning");
});

test("buildPreflightReport fails when sidecar files are missing", async () => {
  const root = await fsp.mkdtemp(path.join(os.tmpdir(), "agentic30-preflight-missing-"));
  const report = buildPreflightReport({
    appSupportPath: path.join(root, "support"),
    workspaceRoot: root,
    sidecarRoot: path.join(root, "sidecar"),
    environment: {
      claude: { available: true },
      codex: { available: false },
    },
    processInfo: {
      version: "v22.0.0",
    },
    fsImpl: fs,
  });

  assert.equal(report.status, "failed");
  assert.equal(report.checks.find((check) => check.id === "sidecar-entrypoint").status, "failed");
});

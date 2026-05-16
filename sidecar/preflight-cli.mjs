#!/usr/bin/env node
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildPreflightReport } from "./preflight.mjs";
import { getProviderAuthState } from "./provider-runner.mjs";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const workspaceRoot = path.resolve(readArg("--workspace") ?? path.join(__dirname, ".."));
const appSupportPath = path.join(
  os.homedir(),
  "Library",
  "Application Support",
  "agentic30",
);

const environment = {
  claude: getProviderAuthState("claude"),
  codex: getProviderAuthState("codex"),
  gemini: getProviderAuthState("gemini"),
  acp: getAcpAdapterState(),
};

const report = buildPreflightReport({
  appSupportPath,
  workspaceRoot,
  sidecarRoot: __dirname,
  environment,
});

if (process.argv.includes("--json")) {
  process.stdout.write(`${JSON.stringify(report, null, 2)}\n`);
} else {
  printTextReport(report);
}

process.exitCode = report.status === "failed" ? 1 : 0;

function getAcpAdapterState() {
  const adapterPath = path.join(__dirname, "acp-adapter.mjs");
  const available = Boolean(process.env.ANTHROPIC_API_KEY || process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY);
  return {
    available,
    message: available
      ? "ACP adapter ready for isolated editor integrations"
      : "ACP adapter requires ANTHROPIC_API_KEY or CODEX_API_KEY / OPENAI_API_KEY",
    adapterPath,
    command: `${process.execPath} ${adapterPath} --workspace ${workspaceRoot}`,
  };
}

function printTextReport(report) {
  process.stdout.write(`agentic30 preflight: ${report.status}\n`);
  for (const check of report.checks) {
    process.stdout.write(`- [${check.status}] ${check.title}: ${check.message || ""}\n`);
    if (check.recovery) {
      process.stdout.write(`  recovery: ${check.recovery}\n`);
    }
  }
}

function readArg(name) {
  const index = process.argv.indexOf(name);
  return index >= 0 ? process.argv[index + 1] : undefined;
}

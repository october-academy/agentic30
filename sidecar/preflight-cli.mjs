#!/usr/bin/env node
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { buildPreflightReport } from "./preflight.mjs";
import { getProviderAuthState } from "./provider-runner.mjs";
import { getQmdState } from "./qmd-support.mjs";

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
  cursor: getProviderAuthState("cursor"),
  acp: getAcpAdapterState(),
  qmd: getQmdState({ sidecarRoot: __dirname }),
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
  const claudeApiReady = Boolean(process.env.ANTHROPIC_API_KEY);
  const codexApiReady = Boolean(process.env.CODEX_API_KEY || process.env.OPENAI_API_KEY);
  const apiKeyConfigured = claudeApiReady || codexApiReady;
  return {
    available: true,
    apiKeyConfigured,
    isolatedModeReady: apiKeyConfigured,
    message: apiKeyConfigured
      ? `ACP adapter가 격리된 에디터 연동에 사용할 준비가 되었습니다 (${[
          claudeApiReady ? "Claude API" : null,
          codexApiReady ? "OpenAI API" : null,
        ].filter(Boolean).join(", ")}).`
      : "ACP adapter가 설치되어 있습니다. 격리 provider API-key 모드는 선택 기능이며, 필요할 때만 ANTHROPIC_API_KEY 또는 CODEX_API_KEY / OPENAI_API_KEY를 설정하세요.",
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

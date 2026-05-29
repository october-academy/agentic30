#!/usr/bin/env node
import os from "node:os";
import path from "node:path";
import {
  POSTHOG_EXTERNAL_CLIENT_TARGETS,
  syncExternalPostHogMcpClients,
} from "./posthog-mcp-config.mjs";

const command = process.argv[2] || "dry-run";

if (["-h", "--help", "help"].includes(command)) {
  printHelp();
  process.exit(0);
}

if (!["dry-run", "sync"].includes(command)) {
  console.error(`Unknown command: ${command}`);
  printHelp();
  process.exit(1);
}

try {
  const options = parseArgs(process.argv.slice(3));
  const appSupportPath = options.appSupportPath || process.env.AGENTIC30_APP_SUPPORT_PATH || path.join(
    os.homedir(),
    "Library",
    "Application Support",
    "agentic30",
  );
  const results = await syncExternalPostHogMcpClients({
    targets: options.targets || POSTHOG_EXTERNAL_CLIENT_TARGETS,
    homeDir: options.homeDir || os.homedir(),
    appSupportPath,
    dryRun: command === "dry-run",
  });
  console.log(JSON.stringify({
    ok: true,
    command,
    dryRun: command === "dry-run",
    results: results.map(redactResult),
  }, null, 2));
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

function parseArgs(args) {
  const options = {};
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg === "--targets") {
      options.targets = String(args[index + 1] || "").split(",").map((target) => target.trim()).filter(Boolean);
      index += 1;
    } else if (arg.startsWith("--targets=")) {
      options.targets = arg.slice("--targets=".length).split(",").map((target) => target.trim()).filter(Boolean);
    } else if (arg === "--home") {
      options.homeDir = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--home=")) {
      options.homeDir = arg.slice("--home=".length);
    } else if (arg === "--app-support") {
      options.appSupportPath = args[index + 1];
      index += 1;
    } else if (arg.startsWith("--app-support=")) {
      options.appSupportPath = arg.slice("--app-support=".length);
    } else {
      throw new Error(`Unknown option: ${arg}`);
    }
  }
  return options;
}

function redactResult(result) {
  return {
    target: result.target,
    filePath: result.filePath,
    changed: result.changed,
    dryRun: result.dryRun,
    serverName: result.serverName,
    backupPath: result.backupPath || null,
  };
}

function printHelp() {
  console.log([
    "Usage:",
    "  node sidecar/posthog-mcp-config-cli.mjs dry-run [--targets codex-cli,claude-code,claude-app]",
    "  node sidecar/posthog-mcp-config-cli.mjs sync [--targets codex-cli,claude-code,claude-app]",
    "",
    "Reads POSTHOG_MCP_API_KEY / POSTHOG_API_KEY first, then Agentic30 ad-config.json.",
    "Codex CLI receives bearer_token_env_var=POSTHOG_MCP_API_KEY; Claude clients receive the upstream mcp-remote wrapper config.",
  ].join("\n"));
}

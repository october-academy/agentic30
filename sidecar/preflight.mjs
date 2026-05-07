import fs from "node:fs";
import path from "node:path";

export function buildPreflightReport({
  appSupportPath,
  workspaceRoot,
  sidecarRoot,
  environment = {},
  processInfo = process,
  fsImpl = fs,
} = {}) {
  const checks = [
    checkNodeVersion(processInfo.version),
    checkWritableDirectory(fsImpl, appSupportPath, {
      id: "app-support-writable",
      title: "Application Support is writable",
      recovery: "Grant file-system access or choose a user account that can write Application Support.",
    }),
    checkReadableDirectory(fsImpl, workspaceRoot, {
      id: "workspace-readable",
      title: "Workspace root is readable",
      recovery: "Open Settings and choose a readable workspace root.",
    }),
    checkRequiredFile(fsImpl, path.join(sidecarRoot, "index.mjs"), {
      id: "sidecar-entrypoint",
      title: "Sidecar entrypoint is present",
      recovery: "Reinstall or rebuild the Mac package so sidecar/index.mjs is bundled.",
    }),
    checkRequiredFile(fsImpl, path.join(sidecarRoot, "mcp-server.mjs"), {
      id: "mcp-server",
      title: "Internal MCP server is present",
      recovery: "Reinstall or rebuild the Mac package so sidecar/mcp-server.mjs is bundled.",
    }),
    checkProviderAvailability(environment),
    checkAcpAvailability(environment),
    checkQmdAvailability(environment),
  ];

  const status = checks.some((check) => check.status === "failed")
    ? "failed"
    : checks.some((check) => check.status === "warning")
      ? "warning"
      : "ok";

  return { status, checks };
}

function checkNodeVersion(version) {
  const match = String(version || "").match(/^v?(\d+)\./);
  const major = match ? Number(match[1]) : 0;
  if (major >= 20) {
    return {
      id: "node-version",
      title: "Node.js runtime is supported",
      status: "ok",
      message: `Using ${version}`,
    };
  }

  return {
    id: "node-version",
    title: "Node.js runtime is supported",
    status: "failed",
    message: version ? `Unsupported Node.js ${version}` : "Node.js version is unknown",
    recovery: "Install Node.js 20 or newer and restart agentic30.",
  };
}

function checkWritableDirectory(fsImpl, dir, { id, title, recovery }) {
  try {
    fsImpl.mkdirSync(dir, { recursive: true });
    fsImpl.accessSync(dir, fs.constants.W_OK);
    return { id, title, status: "ok", message: dir };
  } catch (error) {
    return {
      id,
      title,
      status: "failed",
      message: error.message,
      recovery,
    };
  }
}

function checkReadableDirectory(fsImpl, dir, { id, title, recovery }) {
  try {
    const stat = fsImpl.statSync(dir);
    if (!stat.isDirectory()) {
      throw new Error(`${dir} is not a directory`);
    }
    fsImpl.accessSync(dir, fs.constants.R_OK);
    return { id, title, status: "ok", message: dir };
  } catch (error) {
    return {
      id,
      title,
      status: "failed",
      message: error.message,
      recovery,
    };
  }
}

function checkRequiredFile(fsImpl, filePath, { id, title, recovery }) {
  try {
    const stat = fsImpl.statSync(filePath);
    if (!stat.isFile()) {
      throw new Error(`${filePath} is not a file`);
    }
    return { id, title, status: "ok", message: filePath };
  } catch (error) {
    return {
      id,
      title,
      status: "failed",
      message: error.message,
      recovery,
    };
  }
}

function checkProviderAvailability(environment) {
  const available = Boolean(environment?.claude?.available || environment?.codex?.available);
  if (available) {
    return {
      id: "provider-auth",
      title: "At least one provider is authenticated",
      status: "ok",
      message: [
        environment?.claude?.available ? "Claude" : null,
        environment?.codex?.available ? "Codex" : null,
      ].filter(Boolean).join(", "),
    };
  }

  return {
    id: "provider-auth",
    title: "At least one provider is authenticated",
    status: "warning",
    message: "Claude and Codex are both unavailable.",
    recovery: "Sign in with Claude Code/Codex or set ANTHROPIC_API_KEY / CODEX_API_KEY.",
  };
}

function checkAcpAvailability(environment) {
  if (environment?.acp?.available) {
    return {
      id: "acp-adapter",
      title: "ACP adapter is available",
      status: "ok",
      message: environment.acp.message,
    };
  }

  return {
    id: "acp-adapter",
    title: "ACP adapter is available",
    status: "warning",
    message: environment?.acp?.message || "ACP adapter status is unknown.",
    recovery: "Set ANTHROPIC_API_KEY or CODEX_API_KEY when using isolated ACP editor integrations.",
  };
}

function checkQmdAvailability(environment) {
  if (environment?.qmd?.available) {
    return {
      id: "qmd-mcp",
      title: "QMD MEMORY MCP is available",
      status: "ok",
      message: environment.qmd.message,
    };
  }

  return {
    id: "qmd-mcp",
    title: "QMD MEMORY MCP is available",
    status: "warning",
    message: environment?.qmd?.message || "QMD status is unknown.",
    recovery: "Rebuild the Mac sidecar bundle so @tobilu/qmd is included, or set AGENTIC30_QMD_BIN to a QMD binary that supports `qmd mcp`.",
  };
}

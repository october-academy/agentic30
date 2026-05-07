import fsSync from "node:fs";
import path from "node:path";
import { spawn } from "node:child_process";

export function resolveGwsBin({
  env = process.env,
  fsImpl = fsSync,
} = {}) {
  const override = env.AGENTIC30_GWS_BIN;
  if (override && isExecutable(override, fsImpl)) {
    return override;
  }

  const pathEntries = (env.PATH || "/usr/bin:/bin").split(path.delimiter);
  for (const dir of pathEntries) {
    if (!dir) continue;
    const candidate = path.join(dir, "gws");
    if (isExecutable(candidate, fsImpl)) {
      return candidate;
    }
  }

  return null;
}

export const DEFAULT_GWS_TIMEOUT_MS = 30_000;

/**
 * Strip non-JSON preamble (e.g. "Using keyring backend: keyring") gws emits
 * on stdout before the actual JSON body.
 */
export function stripGwsPreamble(text) {
  const str = String(text || "");
  const match = str.match(/[\{\[]/);
  if (!match) return str;
  return str.slice(match.index);
}

/**
 * gws returns exit code 0 even when authentication or validation fails —
 * the failure is encoded as `{ "error": { "code": ..., "message": ... } }`
 * on stdout. Detect that envelope so callers can reject instead of treating
 * an auth failure as a successful response.
 */
export function extractGwsErrorMessage(stdout) {
  const text = stripGwsPreamble(stdout).trim();
  if (!text) return null;
  try {
    const parsed = JSON.parse(text);
    if (parsed && typeof parsed === "object" && parsed.error && parsed.error.message) {
      return String(parsed.error.message);
    }
  } catch {
    return null;
  }
  return null;
}

export function gwsExec(args, {
  env = process.env,
  cwd = process.cwd(),
  gwsBin = resolveGwsBin({ env }),
  timeoutMs = DEFAULT_GWS_TIMEOUT_MS,
} = {}) {
  if (!gwsBin) {
    return Promise.reject(
      new Error("`gws` CLI not found on PATH. Install it, run `gws auth login`, or set AGENTIC30_GWS_BIN."),
    );
  }

  return new Promise((resolve, reject) => {
    const child = spawn(gwsBin, args, {
      cwd,
      env,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    let timedOut = false;
    let killTimer = null;

    const timer = timeoutMs > 0
      ? setTimeout(() => {
          timedOut = true;
          try { child.kill("SIGTERM"); } catch {}
          killTimer = setTimeout(() => {
            try { child.kill("SIGKILL"); } catch {}
          }, 2_000);
          killTimer.unref?.();
        }, timeoutMs)
      : null;
    timer?.unref?.();

    child.stdout.on("data", (chunk) => { stdout += String(chunk); });
    child.stderr.on("data", (chunk) => { stderr += String(chunk); });
    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      reject(err);
    });
    child.on("close", (code) => {
      if (timer) clearTimeout(timer);
      if (killTimer) clearTimeout(killTimer);
      if (timedOut) {
        reject(new Error(`gws timed out after ${timeoutMs}ms: ${args.join(" ")}`));
        return;
      }
      const errorMessage = extractGwsErrorMessage(stdout);
      if (errorMessage) {
        reject(new Error(errorMessage));
        return;
      }
      if (code === 0 || code === 1) {
        resolve(stdout);
        return;
      }
      reject(new Error(stderr || `gws exited with code ${code}`));
    });
  });
}

export async function readSheetMetadata(spreadsheetId, options = {}) {
  const output = await gwsExec([
    "sheets",
    "spreadsheets",
    "get",
    "--params",
    JSON.stringify({ spreadsheetId }),
    "--format",
    "json",
  ], options);
  return parseJsonOutput(output, "Spreadsheet not found.");
}

export async function readSheetValues(spreadsheetId, range, options = {}) {
  const output = await gwsExec([
    "sheets",
    "spreadsheets",
    "values",
    "get",
    "--params",
    JSON.stringify({ spreadsheetId, range }),
    "--format",
    "json",
  ], options);
  return parseJsonOutput(output, "No Sheet values found.");
}

export async function readGoogleDoc(documentId, options = {}) {
  const output = await gwsExec([
    "docs",
    "documents",
    "get",
    "--params",
    JSON.stringify({ documentId, includeTabsContent: true }),
    "--format",
    "json",
  ], options);
  return parseJsonOutput(output, "Document not found.");
}

function parseJsonOutput(output, emptyMessage) {
  const text = stripGwsPreamble(output).trim();
  if (!text) {
    throw new Error(emptyMessage);
  }
  return JSON.parse(text);
}

function isExecutable(filePath, fsImpl) {
  try {
    fsImpl.accessSync(filePath, fsSync.constants.X_OK);
    return true;
  } catch {
    return false;
  }
}

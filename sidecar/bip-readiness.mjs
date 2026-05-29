import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import {
  formatBipCoachGwsError,
  parseGoogleDocUrl,
  parseGoogleSheetUrl,
} from "./bip-coach-state.mjs";
import { gwsExec, resolveGwsBin, stripGwsPreamble } from "./gws-client.mjs";
import { swallow } from "./error-telemetry.mjs";

// Validation cache: keyed by `${kind}:${id}`, value: { ok, error?, expiresAt }
const validationCache = new Map();
const CACHE_TTL_MS = 60_000;

export function clearValidationCache() {
  validationCache.clear();
}

/** Strip ANSI escape codes from a string. */
function stripAnsi(text) {
  return String(text || "").replace(/\x1b\[[0-9;]*m/g, "");
}

export function extractGwsAuthUrl(text) {
  const urls = String(text || "").match(/https:\/\/[^\s"'<>]+/g) || [];
  return urls
    .map((url) => url.replace(/[),.;]+$/, ""))
    .find((url) => {
      const lower = url.toLowerCase();
      return lower.includes("accounts.google.com")
        || lower.includes("oauth2")
        || lower.includes("oauth");
    }) || null;
}

function openAuthUrlWithSystemBrowser(url, { env = process.env } = {}) {
  if (process.platform !== "darwin" || !url) return false;
  try {
    const opener = spawn("/usr/bin/open", [url], {
      env,
      stdio: "ignore",
      detached: true,
    });
    opener.unref?.();
    return true;
  } catch {
    return false;
  }
}

/**
 * Classify a gws/network error into a canonical error kind.
 * @param {unknown} error
 * @returns {{ user_message: string, raw?: string, kind: "auth_expired"|"permission_denied"|"not_found"|"network"|"unknown" }}
 */
export function formatReadinessError(error) {
  const message = error instanceof Error ? error.message : String(error || "");
  const lower = message.toLowerCase();

  /** @type {"auth_expired"|"permission_denied"|"not_found"|"network"|"unknown"} */
  let kind = "unknown";

  if (
    lower.includes("invalid_grant")
    || lower.includes("invalid_rapt")
    || lower.includes("failed to get token")
    || lower.includes("authentication failed")
    || lower.includes("unauthenticated")
  ) {
    kind = "auth_expired";
  } else if (
    lower.includes("permission")
    || lower.includes("forbidden")
    || lower.includes("insufficient")
    || lower.includes("access denied")
    || lower.includes("access_denied")
    || lower.includes("developer hasn't given you access")
    || lower.includes("developer hasn’t given you access")
    || lower.includes("app is currently being tested")
  ) {
    kind = "permission_denied";
  } else if (
    lower.includes("not found")
    || lower.includes("404")
    || lower.includes("no such")
  ) {
    kind = "not_found";
  } else if (
    lower.includes("econnrefused")
    || lower.includes("enotfound")
    || lower.includes("network")
    || lower.includes("timeout")
    || lower.includes("etimedout")
  ) {
    kind = "network";
  }

  return {
    user_message: formatBipCoachGwsError(error),
    raw: message,
    kind,
  };
}

/**
 * Derive readiness state for all 6 rows. Pure function — no spawn.
 *
 * @param {{
 *   keychainSettings?: { macAuth?: { accessToken?: string, expiresAt?: number } },
 *   workspaceSettings?: { hasExplicitWorkspace?: boolean },
 *   bipCoachConfig?: { docId?: string, sheetId?: string },
 *   env?: NodeJS.ProcessEnv,
 *   validationCacheOverride?: Map<string, { ok: boolean, error?: object, expiresAt: number }>
 * }} opts
 * @returns {{ rows: Array<{ id: string, status: "pending"|"in-progress"|"done"|"blocked", detail?: string, error?: object }> }}
 */
export function deriveReadinessState({
  keychainSettings = {},
  workspaceSettings = {},
  bipCoachConfig = {},
  env = process.env,
  validationCacheOverride = null,
} = {}) {
  const cache = validationCacheOverride ?? validationCache;
  const now = Date.now();

  // Row 1: googleSignIn — macAuth token present and not expired
  const macAuth = keychainSettings?.macAuth ?? {};
  const googleSignInDone = Boolean(
    macAuth.accessToken
    && (macAuth.expiresAt == null || macAuth.expiresAt > now),
  );

  // Row 2: workspace — hasExplicitWorkspace flag
  const workspaceDone = Boolean(workspaceSettings?.hasExplicitWorkspace);

  // Row 3: gwsInstall — resolveGwsBin returns non-null
  const gwsBin = resolveGwsBin({ env });
  const gwsInstallDone = gwsBin !== null;

  // Row 4: gwsAuth — depends on gwsInstall
  // Status is either "done" (cached positive probe), "blocked" (gwsInstall not done),
  // or "pending" (unknown/needs action). Actual auth check happens on `start` action only.
  let gwsAuthStatus = "pending";
  if (!gwsInstallDone) {
    gwsAuthStatus = "blocked";
  } else {
    const cached = cache.get("gwsAuth:probe");
    if (cached && cached.expiresAt > now) {
      gwsAuthStatus = cached.ok ? "done" : "blocked";
    }
  }

  // Row 5: docUrl — docId configured + last validate succeeded
  let docUrlStatus = "pending";
  if (!gwsInstallDone || gwsAuthStatus === "blocked") {
    docUrlStatus = bipCoachConfig?.docId ? "blocked" : "pending";
  } else if (bipCoachConfig?.docId) {
    const cached = cache.get(`doc:${bipCoachConfig.docId}`);
    if (cached && cached.expiresAt > now) {
      docUrlStatus = cached.ok ? "done" : "blocked";
    }
  }

  // Row 6: sheetUrl — sheetId configured + last validate succeeded
  let sheetUrlStatus = "pending";
  if (!gwsInstallDone || gwsAuthStatus === "blocked") {
    sheetUrlStatus = bipCoachConfig?.sheetId ? "blocked" : "pending";
  } else if (bipCoachConfig?.sheetId) {
    const cached = cache.get(`sheet:${bipCoachConfig.sheetId}`);
    if (cached && cached.expiresAt > now) {
      sheetUrlStatus = cached.ok ? "done" : "blocked";
    }
  }

  function cachedError(cacheKey) {
    const cached = cache.get(cacheKey);
    if (cached && !cached.ok && cached.error) return cached.error;
    return undefined;
  }

  const rows = [
    {
      id: "googleSignIn",
      status: googleSignInDone ? "done" : "blocked",
      ...(googleSignInDone ? {} : { error: { user_message: "Google 로그인이 필요해요.", kind: "auth_expired" } }),
    },
    {
      id: "workspace",
      status: workspaceDone ? "done" : "pending",
    },
    {
      id: "gwsInstall",
      status: gwsInstallDone ? "done" : (env.npm || resolveNpmBin(env) ? "pending" : "blocked"),
      detail: gwsInstallDone
        ? `gws CLI 확인됨: ${gwsBin}`
        : "버튼을 누르면 gws CLI를 먼저 확인해요. 이미 있으면 바로 넘어가고, 없을 때만 npm으로 설치해요.",
    },
    {
      id: "gwsAuth",
      status: gwsAuthStatus,
      ...(gwsAuthStatus === "blocked" && !gwsInstallDone
        ? { error: { user_message: "먼저 gws CLI를 확인해야 해요.", kind: "unknown" } }
        : gwsAuthStatus === "blocked"
        ? { error: cachedError("gwsAuth:probe") }
        : {}),
    },
    {
      id: "docUrl",
      status: docUrlStatus,
      ...(docUrlStatus === "blocked" ? { error: cachedError(`doc:${bipCoachConfig?.docId}`) } : {}),
    },
    {
      id: "sheetUrl",
      status: sheetUrlStatus,
      ...(sheetUrlStatus === "blocked" ? { error: cachedError(`sheet:${bipCoachConfig?.sheetId}`) } : {}),
    },
  ];

  // Strip undefined keys from each row
  return { rows: rows.map((row) => Object.fromEntries(Object.entries(row).filter(([, v]) => v !== undefined))) };
}

function resolveNpmBin(env = process.env) {
  const pathEntries = (env.PATH || "/usr/bin:/bin").split(path.delimiter);
  for (const dir of pathEntries) {
    if (!dir) continue;
    try {
      const candidate = path.join(dir, "npm");
      // We just check existence in PATH — actual check happens in gwsExec
      if (candidate) return candidate;
    } catch {}
  }
  return null;
}

/**
 * Install gws CLI via npm.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   onLog?: (line: string) => void,
 *   onComplete?: (result: { success: boolean, binPath?: string, error?: string }) => void
 * }} opts
 * @returns {{ cancel: () => void }}
 */
export function installGws({ env = process.env, onLog, onComplete } = {}) {
  const pathEntries = (env.PATH || "/usr/bin:/bin").split(path.delimiter);
  let npmBin = null;
  for (const dir of pathEntries) {
    const candidate = path.join(dir, "npm");
    try {
      // eslint-disable-next-line no-sync
      fs.accessSync(candidate, fs.constants.X_OK);
      npmBin = candidate;
      break;
    } catch {}
  }
  // Fall back to plain "npm" and let the OS resolve it
  npmBin = npmBin || "npm";

  let cancelled = false;
  const child = spawn(npmBin, ["install", "-g", "@googleworkspace/cli"], {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  let stderrBuf = "";
  function emitInstallLog(chunk) {
    if (cancelled || !onLog) return;
    const lines = stripAnsi(String(chunk)).split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (trimmed) onLog(trimmed);
    }
  }

  child.stdout.on("data", (chunk) => {
    emitInstallLog(chunk);
  });

  child.stderr.on("data", (chunk) => {
    stderrBuf += String(chunk);
    emitInstallLog(chunk);
  });

  child.on("error", (err) => {
    if (cancelled) return;
    if (onComplete) onComplete({ success: false, error: err.message });
  });

  child.on("close", async (code) => {
    if (cancelled) return;
    if (code !== 0) {
      const tail = stripAnsi(stderrBuf).trim().slice(-500);
      if (onComplete) onComplete({ success: false, error: tail || `npm exited with code ${code}` });
      return;
    }

    // Resolve the installed gws bin path via `npm bin -g`
    try {
      if (onLog) onLog("설치 완료. gws 실행 파일 위치 확인 중...");
      const binDirChild = spawn(npmBin, ["bin", "-g"], {
        env,
        stdio: ["ignore", "pipe", "pipe"],
      });
      let binDirOut = "";
      binDirChild.stdout.on("data", (chunk) => { binDirOut += String(chunk); });
      binDirChild.on("close", (binCode) => {
        if (binCode === 0) {
          const binDir = binDirOut.trim();
          const gwsPath = path.join(binDir, "gws");
          // Write to env so resolveGwsBin picks it up immediately
          env.AGENTIC30_GWS_BIN = gwsPath;
          if (onLog) onLog(`gws 경로: ${gwsPath}`);
          if (onComplete) onComplete({ success: true, binPath: gwsPath });
        } else {
          // npm bin -g failed, still report success (gws may be on PATH already)
          if (onComplete) onComplete({ success: true });
        }
      });
      binDirChild.on("error", () => {
        if (onComplete) onComplete({ success: true });
      });
    } catch {
      if (onComplete) onComplete({ success: true });
    }
  });

  return {
    cancel() {
      cancelled = true;
      try { child.kill("SIGTERM"); } catch {}
    },
  };
}

/**
 * Start gws auth login flow.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   onLog?: (line: string) => void,
 *   onStatusChange?: (update: { status: string, detail?: string, error?: object }) => void,
 * }} opts
 * @returns {{ cancel: () => void }}
 */
export function startGwsAuth({
  env = process.env,
  onLog,
  onStatusChange,
  openAuthUrl = openAuthUrlWithSystemBrowser,
  totalTimeoutMs = 5 * 60 * 1000,
  oauthTimeoutMs = 90 * 1000,
  pollIntervalMs = 3_000,
  probeTimeoutMs = 15_000,
} = {}) {
  const gwsBin = resolveGwsBin({ env });
  if (!gwsBin) {
    if (onStatusChange) {
      onStatusChange({
        status: "blocked",
        error: { user_message: "gws CLI를 먼저 설치해야 해요.", kind: "unknown" },
      });
    }
    return { cancel() {} };
  }

  let cancelled = false;
  let pollTimer = null;
  let oauthTimer = null;
  let childExited = false;
  let childExitCode = null;
  let stderrBuf = "";
  let lastProbeError = null;
  let lastWaitLogAt = 0;
  let probeInFlight = false;
  let authUrlOpened = false;

  function emitAuthLog(chunk) {
    if (cancelled) return;
    const lines = stripAnsi(String(chunk)).split(/\r?\n/);
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed) continue;
      const authUrl = !authUrlOpened ? extractGwsAuthUrl(trimmed) : null;
      if (authUrl) {
        authUrlOpened = true;
        const opened = openAuthUrl(authUrl, { env });
        if (onLog) onLog(opened ? "Google 로그인 브라우저를 열었어요." : `Google 로그인 URL: ${authUrl}`);
      }
      if (onLog) onLog(trimmed);
    }
  }

  const authArgs = ["auth", "login", "--services", "drive,sheets,docs"];
  const child = spawn(gwsBin, authArgs, {
    env,
    stdio: ["ignore", "pipe", "pipe"],
  });

  if (onLog) onLog(`${gwsBin} ${authArgs.join(" ")}`);

  child.stdout.on("data", (chunk) => {
    emitAuthLog(chunk);
  });

  child.stderr.on("data", (chunk) => {
    stderrBuf += String(chunk);
    emitAuthLog(chunk);
  });
  child.on("error", (err) => {
    if (cancelled) return;
    clearInterval(pollTimer);
    if (onStatusChange) {
      onStatusChange({
        status: "blocked",
        error: formatReadinessError(err),
      });
    }
  });

  child.on("close", (code) => {
    childExited = true;
    childExitCode = code;
  });

  if (onStatusChange) {
    onStatusChange({ status: "in-progress", detail: "브라우저 창에서 Google 로그인을 완료해주세요. 완료되면 앱이 자동으로 확인합니다." });
  }

  const startedAt = Date.now();

  function cleanup() {
    if (pollTimer) { clearInterval(pollTimer); pollTimer = null; }
    if (oauthTimer) { clearTimeout(oauthTimer); oauthTimer = null; }
    try { if (!childExited) child.kill("SIGTERM"); } catch {}
  }

  function blockWith({ user_message, kind = "unknown", raw } = {}) {
    cleanup();
    if (onStatusChange) {
      onStatusChange({
        status: "blocked",
        error: { user_message, kind, ...(raw ? { raw } : {}) },
      });
    }
  }

  async function probe() {
    if (cancelled || probeInFlight) return;
    probeInFlight = true;
    try {
      if (Date.now() - startedAt > totalTimeoutMs) {
        const lastErrorMessage = lastProbeError instanceof Error
          ? lastProbeError.message
          : String(lastProbeError || "");
        blockWith({
          user_message: "5분 동안 로그인 완료를 확인하지 못했어요. 브라우저 로그인을 마쳤다면 다시 시도해주세요.",
          kind: "unknown",
          raw: lastErrorMessage || undefined,
        });
        return;
      }

      if (childExited && childExitCode !== 0) {
        const tail = stripAnsi(stderrBuf).trim().slice(-500);
        cleanup();
        if (onStatusChange) {
          onStatusChange({
            status: "blocked",
            error: formatReadinessError(
              new Error(tail || `gws auth login exited with code ${childExitCode}`),
            ),
          });
        }
        return;
      }

      // Verify auth independently of the `gws auth login` process lifecycle.
      // Some versions keep the login process alive while the browser flow runs,
      // so waiting for child exit creates an apparent infinite spinner.
      try {
        if (onLog && Date.now() - lastWaitLogAt > 10_000) {
          onLog("Google 로그인 완료 여부 확인 중...");
          lastWaitLogAt = Date.now();
        }
        await gwsExec(
          ["drive", "about", "get", "--params", JSON.stringify({ fields: "user" }), "--format", "json"],
          { env, timeoutMs: probeTimeoutMs },
        );
        cleanup();
        if (onLog) onLog("Google 로그인 확인 완료");
        validationCache.set("gwsAuth:probe", { ok: true, expiresAt: Date.now() + CACHE_TTL_MS });
        if (onStatusChange) onStatusChange({ status: "done" });
      } catch (probeError) {
        lastProbeError = probeError;
        // During an active login flow, a probe can still observe the old
        // expired token before the browser callback replaces it. Do not treat
        // invalid_rapt/invalid_grant as fatal until the login child exits;
        // otherwise we can kill `gws auth login` before it opens the browser.
        const message = probeError instanceof Error
          ? probeError.message.toLowerCase()
          : String(probeError || "").toLowerCase();
        const fatalAuth = message.includes("invalid_rapt")
          || message.includes("invalid_grant");
        if (fatalAuth && childExited) {
          const err = formatReadinessError(probeError);
          validationCache.set("gwsAuth:probe", { ok: false, error: err, expiresAt: Date.now() + CACHE_TTL_MS });
          cleanup();
          if (onStatusChange) onStatusChange({ status: "blocked", error: err });
          return;
        }
        if (!childExited) return;
        const err = formatReadinessError(probeError);
        validationCache.set("gwsAuth:probe", { ok: false, error: err, expiresAt: Date.now() + CACHE_TTL_MS });
        cleanup();
        if (onStatusChange) onStatusChange({ status: "blocked", error: err });
      }
    } finally {
      probeInFlight = false;
    }
  }

  pollTimer = setInterval(() => { swallow("bip_readiness_probe_poll", probe()); }, pollIntervalMs);
  setTimeout(() => { swallow("bip_readiness_probe_initial", probe()); }, 500);

  // OAuth callback timeout: if the browser flow doesn't complete within
  // `oauthTimeoutMs`, surface an actionable message instead of leaving the
  // spinner up for the full 5-minute hard timeout.
  if (oauthTimeoutMs > 0 && oauthTimeoutMs < totalTimeoutMs) {
    oauthTimer = setTimeout(() => {
      if (cancelled) return;
      if (validationCache.get("gwsAuth:probe")?.ok) return;
      blockWith({
        user_message: "브라우저에서 Google 로그인이 완료되지 않았어요. 브라우저 창을 확인하거나 'Google 연결 다시 확인'을 눌러주세요.",
        kind: "unknown",
      });
    }, oauthTimeoutMs);
    oauthTimer.unref?.();
  }

  return {
    cancel() {
      cancelled = true;
      cleanup();
      if (onStatusChange) onStatusChange({ status: "pending" });
    },
  };
}

/**
 * Validate a Google Doc or Sheet URL by parsing it and running a gws API probe.
 *
 * @param {{ env?: NodeJS.ProcessEnv, url: string, kind: "doc"|"sheet" }} opts
 * @returns {Promise<{ ok: boolean, docId?: string, sheetId?: string, error?: object }>}
 */
export async function validateUrl({ env = process.env, url, kind } = {}) {
  const urlStr = String(url || "").trim();

  let resourceId = "";
  if (kind === "doc") {
    resourceId = parseGoogleDocUrl(urlStr).documentId;
    if (!resourceId) {
      return {
        ok: false,
        error: {
          user_message: "Google Docs URL이 아니에요. https://docs.google.com/document/... 형식이어야 해요.",
          kind: "not_found",
        },
      };
    }
  } else if (kind === "sheet") {
    resourceId = parseGoogleSheetUrl(urlStr).spreadsheetId;
    if (!resourceId) {
      return {
        ok: false,
        error: {
          user_message: "Google Sheets URL이 아니에요. https://docs.google.com/spreadsheets/... 형식이어야 해요.",
          kind: "not_found",
        },
      };
    }
  } else {
    return { ok: false, error: { user_message: "알 수 없는 URL 종류입니다.", kind: "unknown" } };
  }

  const cacheKey = `${kind}:${resourceId}`;
  const cached = validationCache.get(cacheKey);
  if (cached && cached.expiresAt > Date.now()) {
    return cached.ok
      ? { ok: true, ...(kind === "doc" ? { docId: resourceId } : { sheetId: resourceId }) }
      : { ok: false, error: cached.error };
  }

  try {
    if (kind === "doc") {
      await gwsExec(
        ["docs", "documents", "get", "--params", JSON.stringify({ documentId: resourceId }), "--format", "json"],
        { env },
      );
    } else {
      await gwsExec(
        ["sheets", "spreadsheets", "get", "--params", JSON.stringify({ spreadsheetId: resourceId }), "--format", "json"],
        { env },
      );
    }

    validationCache.set(cacheKey, { ok: true, expiresAt: Date.now() + CACHE_TTL_MS });
    return { ok: true, ...(kind === "doc" ? { docId: resourceId } : { sheetId: resourceId }) };
  } catch (err) {
    const formatted = formatReadinessError(err);
    validationCache.set(cacheKey, { ok: false, error: formatted, expiresAt: Date.now() + CACHE_TTL_MS });
    return { ok: false, error: formatted };
  }
}

/**
 * Copy a BIP template into the signed-in user's Drive and validate the copy.
 *
 * @param {{
 *   env?: NodeJS.ProcessEnv,
 *   kind: "doc"|"sheet",
 *   sourceId: string,
 *   title: string,
 *   onLog?: (line: string) => void,
 * }} opts
 * @returns {Promise<{ ok: boolean, docId?: string, sheetId?: string, url?: string, name?: string, error?: object }>}
 */
export async function copyTemplateToDrive({
  env = process.env,
  kind,
  sourceId,
  title,
  onLog,
} = {}) {
  const cleanSourceId = String(sourceId || "").trim();
  const cleanTitle = String(title || "").trim();
  if (!cleanSourceId || !cleanTitle || (kind !== "doc" && kind !== "sheet")) {
    return {
      ok: false,
      error: {
        user_message: "복사할 템플릿 정보가 비어 있어요.",
        kind: "unknown",
      },
    };
  }

  try {
    if (onLog) onLog("템플릿을 내 Drive에 복사하는 중...");
    const output = await gwsExec([
      "drive",
      "files",
      "copy",
      "--params",
      JSON.stringify({ fileId: cleanSourceId, fields: "id,name,webViewLink" }),
      "--json",
      JSON.stringify({ name: cleanTitle }),
      "--format",
      "json",
    ], { env });

    const copied = parseGwsJson(output);
    const copiedId = String(copied.id || "").trim();
    if (!copiedId) {
      throw new Error("Template copy succeeded but response did not include a file id.");
    }

    if (onLog) onLog("복사본 권한을 확인하는 중...");
    if (kind === "doc") {
      await gwsExec(
        ["docs", "documents", "get", "--params", JSON.stringify({ documentId: copiedId }), "--format", "json"],
        { env },
      );
      validationCache.set(`doc:${copiedId}`, { ok: true, expiresAt: Date.now() + CACHE_TTL_MS });
      return {
        ok: true,
        docId: copiedId,
        name: copied.name,
        url: copied.webViewLink || `https://docs.google.com/document/d/${copiedId}/edit`,
      };
    }

    await gwsExec(
      ["sheets", "spreadsheets", "get", "--params", JSON.stringify({ spreadsheetId: copiedId }), "--format", "json"],
      { env },
    );
    validationCache.set(`sheet:${copiedId}`, { ok: true, expiresAt: Date.now() + CACHE_TTL_MS });
    return {
      ok: true,
      sheetId: copiedId,
      name: copied.name,
      url: copied.webViewLink || `https://docs.google.com/spreadsheets/d/${copiedId}/edit`,
    };
  } catch (err) {
    return { ok: false, error: formatReadinessError(err) };
  }
}

function parseGwsJson(output) {
  const text = String(output || "").trim();
  const start = text.indexOf("{");
  if (start < 0) {
    throw new Error("gws returned an empty copy response.");
  }
  return JSON.parse(text.slice(start));
}

/**
 * Run gws auth status check and cache the result.
 * Used for recheck action on gwsAuth row without spawning a full login flow.
 *
 * @param {{ env?: NodeJS.ProcessEnv }} opts
 * @returns {Promise<{ done: boolean, error?: object }>}
 */
export async function checkGwsAuthStatus({ env = process.env } = {}) {
  const gwsBin = resolveGwsBin({ env });
  if (!gwsBin) {
    return { done: false, error: { user_message: "gws CLI를 찾을 수 없어요.", kind: "unknown" } };
  }

  try {
    // gws 0.22.5+ does NOT accept `--format json` on `auth status`.
    // The plain command emits a single JSON object on stdout (sometimes
    // preceded by a "Using keyring backend: keyring" preamble line).
    const rawOutput = await gwsExec(["auth", "status"], { env });
    let parsed = {};
    try { parsed = JSON.parse(stripGwsPreamble(rawOutput).trim()); } catch {}

    // Detect known reauth-required state up front so we don't wait on the
    // probe to surface it.
    const tokenError = String(parsed.token_error || "").toLowerCase();
    const reauthRequired = tokenError.includes("invalid_rapt")
      || tokenError.includes("invalid_grant")
      || (parsed.token_valid === false && parsed.has_refresh_token === true);

    if (parsed.has_refresh_token && parsed.encrypted_credentials_exists && !reauthRequired) {
      // Do a cheap drive probe to confirm token is actually valid
      try {
        await gwsExec(
          ["drive", "about", "get", "--params", JSON.stringify({ fields: "user" }), "--format", "json"],
          { env },
        );
        validationCache.set("gwsAuth:probe", { ok: true, expiresAt: Date.now() + CACHE_TTL_MS });
        return { done: true };
      } catch (probeErr) {
        const err = formatReadinessError(probeErr);
        validationCache.set("gwsAuth:probe", { ok: false, error: err, expiresAt: Date.now() + CACHE_TTL_MS });
        return { done: false, error: err };
      }
    }

    if (reauthRequired) {
      const err = formatReadinessError(
        new Error(parsed.token_error || "invalid_rapt: reauth required"),
      );
      validationCache.set("gwsAuth:probe", { ok: false, error: err, expiresAt: Date.now() + CACHE_TTL_MS });
      return { done: false, error: err };
    }

    const err = { user_message: "Google Workspace 인증이 필요해요. 'Google 연결 확인'을 눌러주세요.", kind: "auth_expired" };
    validationCache.set("gwsAuth:probe", { ok: false, error: err, expiresAt: Date.now() + CACHE_TTL_MS });
    return { done: false, error: err };
  } catch (statusErr) {
    const err = formatReadinessError(statusErr);
    validationCache.set("gwsAuth:probe", { ok: false, error: err, expiresAt: Date.now() + CACHE_TTL_MS });
    return { done: false, error: err };
  }
}

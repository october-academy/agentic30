import crypto from "node:crypto";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

/**
 * Stage 4 of the day1-discovery plan: an LLM composer that turns the
 * deterministic Day 1 context (stage 2/3) into a coach-tone {yesterday/today/
 * question} triplet. Mirrors the foundation-summary fail-closed pattern:
 *   - Read / Glob / Grep only; everything else (Edit/Write/Bash/Task/Web*)
 *     denied at the canUseTool layer
 *   - Per-tool call caps + 30s timeout
 *   - All paths must resolve under the realpath'd workspace root; .env / .git
 *     / node_modules / .ssh and dotfiles outside the root are denied
 *   - Output JSON-parsed with strict schema; any failure → fall through to
 *     the deterministic mapper output the caller already has
 *   - Result cached under ~/Library/Application Support/Agentic30/discovery/
 *     so a clean re-run inside the TTL skips the LLM entirely
 *
 * Real Claude calls are injected via `queryImpl` so unit tests can stub them.
 * Web tools stay opt-in via stage 5 — this module never enables them.
 */

export const COMPOSE_DAY1_SCHEMA_VERSION = 1;
export const COMPOSE_DAY1_TOOL_POLICY_VERSION = 1;

export const COMPOSE_DAY1_ALLOWED_TOOLS = Object.freeze(["Read", "Glob", "Grep"]);
export const COMPOSE_DAY1_DEFAULT_TOOL_CAPS = Object.freeze({ Read: 30, Glob: 10, Grep: 20 });
export const COMPOSE_DAY1_DEFAULT_TIMEOUT_MS = 30_000;
export const COMPOSE_DAY1_CACHE_TTL_FRESH_MS = 24 * 60 * 60 * 1000;
export const COMPOSE_DAY1_CACHE_TTL_DIRTY_MS = 30 * 60 * 1000;
export const COMPOSE_DAY1_MIN_CONFIDENCE = 0.3;

const DENIED_PATH_SEGMENTS = Object.freeze([
  ".git",
  ".env",
  ".ssh",
  "node_modules",
  ".keychain",
  ".aws",
  ".gnupg",
]);

// Stage-5 opt-in web tools — only enabled when the caller passes
// `enableWeb: true` (driven by the AGENTIC30_DISCOVERY_WEB env on the sidecar
// boundary). Even when enabled, URLs must pass the SSRF guard below.
const WEB_OPT_IN_TOOLS = Object.freeze(["WebFetch", "WebSearch"]);
const PRIVATE_HOST_PATTERNS = Object.freeze([
  /^localhost$/i,
  /^127\./, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./, // link-local
  /^::1$/, /^fc00:/i, /^fd00:/i, /^fe80:/i,
  /\.internal$/i, /\.local$/i,
]);
// AWS / GCP / Azure metadata endpoints. Always denied even with opt-in web.
const METADATA_HOST_PATTERNS = Object.freeze([
  /^169\.254\.169\.254$/,
  /^metadata\.google\.internal$/i,
]);
// Strip secret-shaped tokens out of WebSearch queries before they leave
// the host. Conservative — false positives are fine; false negatives leak.
const SECRET_TOKEN_PATTERNS = Object.freeze([
  /sk-[A-Za-z0-9_\-]{20,}/g,
  /AKIA[A-Z0-9]{16}/g,
  /xox[baprs]-[A-Za-z0-9_-]{10,}/g,
  /AIza[A-Za-z0-9_\-]{35,}/g,
  /ghp_[A-Za-z0-9]{36,}/g,
]);

export function isPrivateOrMetadataUrl(rawUrl) {
  if (typeof rawUrl !== "string" || rawUrl.length === 0) return true;
  let url;
  try { url = new URL(rawUrl); }
  catch { return true; }
  if (!["http:", "https:"].includes(url.protocol)) return true;
  // PR3 (P1b): normalise host before matching:
  //  - strip surrounding brackets WHATWG keeps on IPv6 literals
  //  - drop trailing dot (DNS root marker — `localhost.` resolves the same)
  //  - lowercase so suffix patterns hit
  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);
  // IPv4-mapped IPv6 like ::ffff:127.0.0.1 → treat as the embedded IPv4.
  // WHATWG URL normalises the dotted-quad form to two 16-bit hex pairs
  // (`::ffff:7f00:1`), so we handle both shapes.
  const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) {
    host = mappedDotted[1];
  } else {
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const a = parseInt(mappedHex[1], 16);
      const b = parseInt(mappedHex[2], 16);
      host = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}.${b & 0xff}`;
    }
  }
  for (const pattern of METADATA_HOST_PATTERNS) {
    if (pattern.test(host)) return true;
  }
  for (const pattern of PRIVATE_HOST_PATTERNS) {
    if (pattern.test(host)) return true;
  }
  return false;
}

export function sanitizeWebSearchQuery(query) {
  if (typeof query !== "string") return "";
  let cleaned = query;
  for (const pattern of SECRET_TOKEN_PATTERNS) {
    cleaned = cleaned.replace(pattern, "[REDACTED_TOKEN]");
  }
  // Collapse repeated whitespace and cap length so logs/telemetry stay sane.
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length > 256) cleaned = cleaned.slice(0, 256);
  return cleaned;
}

/**
 * Build the canUseTool callback enforcing the fail-closed contract. The hook
 * is reused by both the real query loop and tests that want to assert which
 * tool calls would have been allowed/denied.
 */
export function buildComposeDay1CanUseTool({
  workspaceRoot,
  toolCaps = COMPOSE_DAY1_DEFAULT_TOOL_CAPS,
  onDecision = () => {},
  enableWeb = false,
  fsImpl = fs,
} = {}) {
  const allowed = enableWeb
    ? [...COMPOSE_DAY1_ALLOWED_TOOLS, ...WEB_OPT_IN_TOOLS]
    : [...COMPOSE_DAY1_ALLOWED_TOOLS];
  const counts = Object.fromEntries(allowed.map((t) => [t, 0]));
  // Resolve the workspace root lazily on first path check so the synchronous
  // path.resolve fallback is exercised only when realpath fails (missing
  // directory). All path verdicts use the canonical form, so symlinks like
  // <root>/secrets -> /etc cannot smuggle external paths past the policy.
  let resolvedRootPromise = null;
  function getResolvedRoot() {
    if (!workspaceRoot) return Promise.resolve("");
    if (resolvedRootPromise) return resolvedRootPromise;
    resolvedRootPromise = (async () => {
      try { return await fsImpl.realpath(workspaceRoot); }
      catch { return path.resolve(workspaceRoot); }
    })();
    return resolvedRootPromise;
  }

  async function decide(toolName, input) {
    if (!allowed.includes(toolName)) {
      return { allowed: false, reason: `tool_not_allowed:${toolName}` };
    }
    const cap = toolCaps[toolName];
    if (typeof cap === "number" && counts[toolName] >= cap) {
      return { allowed: false, reason: `cap_reached:${toolName}` };
    }
    if (toolName === "Read" || toolName === "Glob" || toolName === "Grep") {
      const candidate = pickPathFromToolInput(input);
      if (candidate !== null) {
        const root = await getResolvedRoot();
        const verdict = await pathPolicyVerdict(candidate, root, { fsImpl, toolName });
        if (!verdict.allowed) return verdict;
      }
    }
    if (toolName === "WebFetch") {
      const url = typeof input?.url === "string" ? input.url : "";
      if (isPrivateOrMetadataUrl(url)) {
        return { allowed: false, reason: "url_private_or_metadata" };
      }
    }
    counts[toolName] = (counts[toolName] || 0) + 1;
    return { allowed: true, reason: "ok" };
  }

  const callback = async (toolName, input /* , context */) => {
    let effectiveInput = input;
    if (enableWeb && toolName === "WebSearch" && input && typeof input === "object") {
      const sanitized = sanitizeWebSearchQuery(input.query);
      effectiveInput = { ...input, query: sanitized };
    }
    const decision = await decide(toolName, effectiveInput);
    onDecision({ toolName, input: effectiveInput, decision });
    if (decision.allowed) return { behavior: "allow", updatedInput: effectiveInput };
    return { behavior: "deny", message: decision.reason };
  };
  callback.__counts = counts;
  callback.__decide = decide;
  callback.__enableWeb = enableWeb;
  return callback;
}

function pickPathFromToolInput(input) {
  if (!input || typeof input !== "object") return null;
  return input.file_path ?? input.path ?? input.pattern ?? null;
}

/**
 * Resolve a path to its canonical form, walking up to the first parent that
 * exists so non-existent files still get a fully realpath'd ancestor before
 * the basename is reattached. This lets us check symlinks the user might be
 * about to read into without requiring the file to already exist.
 */
async function realpathOrResolve(candidate, fsImpl) {
  try { return await fsImpl.realpath(candidate); }
  catch { /* fall through to walking parents */ }
  let dir = path.dirname(candidate);
  let tail = path.basename(candidate);
  while (dir && dir !== path.dirname(dir)) {
    try {
      const real = await fsImpl.realpath(dir);
      return path.join(real, tail);
    } catch {
      tail = path.join(path.basename(dir), tail);
      dir = path.dirname(dir);
    }
  }
  return path.resolve(candidate);
}

function containsTraversal(p) {
  // Check the raw pattern, NOT path.normalize — normalize collapses `a/**/..`
  // away because it doesn't know `**` is a glob (it's a literal segment to
  // path.normalize). We want to reject ANY literal `..` segment in glob
  // patterns regardless of how they'd resolve after normalisation.
  return p.split(/[\\/]/).some((seg) => seg === "..");
}

async function pathPolicyVerdict(candidate, resolvedRoot, { fsImpl, toolName } = {}) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return { allowed: true, reason: "no_path" };
  }
  // Glob/Grep patterns: reject ANY .. segment in the full pattern before we
  // even try to resolve. Otherwise `src/**/../../etc/passwd` would slip past
  // the literal-prefix check (which only looks at chars up to the first *).
  if (toolName === "Glob" || toolName === "Grep") {
    if (containsTraversal(candidate)) {
      return { allowed: false, reason: "glob_traversal_segment" };
    }
  }
  // Strip the glob portion before resolution.
  const literal = candidate.split(/[*?[]/)[0];
  let resolved;
  try {
    if (path.isAbsolute(literal)) {
      resolved = await realpathOrResolve(literal, fsImpl);
    } else {
      const joined = path.resolve(resolvedRoot || ".", literal);
      resolved = await realpathOrResolve(joined, fsImpl);
    }
  } catch {
    return { allowed: false, reason: "path_resolution_failed" };
  }
  if (resolvedRoot && !resolved.startsWith(resolvedRoot + path.sep) && resolved !== resolvedRoot) {
    return { allowed: false, reason: "path_outside_workspace" };
  }
  for (const seg of DENIED_PATH_SEGMENTS) {
    if (resolved.split(path.sep).includes(seg)) {
      return { allowed: false, reason: `path_in_denied_segment:${seg}` };
    }
  }
  return { allowed: true, reason: "ok" };
}

/**
 * Stable cache key. Mixes workspace path, git head/dirty, onboarding answers,
 * schema, and tool-policy version so any of those changing invalidates the
 * cache. The cache file itself is excluded from the fingerprint inputs.
 */
export function buildCacheKey({
  workspaceRoot,
  gitHead = null,
  dirty = false,
  onboarding = null,
  schemaVersion = COMPOSE_DAY1_SCHEMA_VERSION,
  toolPolicyVersion = COMPOSE_DAY1_TOOL_POLICY_VERSION,
} = {}) {
  const h = crypto.createHash("sha256");
  h.update(workspaceRoot || "");
  h.update("|gitHead=" + (gitHead || ""));
  h.update("|dirty=" + (dirty ? "1" : "0"));
  h.update("|onboarding=" + stableJson(onboarding));
  h.update("|schema=" + schemaVersion);
  h.update("|toolPolicy=" + toolPolicyVersion);
  return h.digest("hex").slice(0, 40);
}

function stableJson(value) {
  if (value === null || value === undefined) return "";
  if (typeof value !== "object") return String(value);
  const keys = Object.keys(value).sort();
  const sorted = {};
  for (const k of keys) sorted[k] = value[k];
  try { return JSON.stringify(sorted); } catch { return ""; }
}

export function cacheDirectory({ homeDir = os.homedir() } = {}) {
  return path.join(homeDir, "Library", "Application Support", "Agentic30", "discovery");
}

export function cacheFilePath(cacheKey, options) {
  return path.join(cacheDirectory(options), `${cacheKey}.json`);
}

export async function readComposedFromCache(cacheKey, {
  now = new Date(),
  dirty = false,
  fsImpl = fs,
  homeDir,
} = {}) {
  const file = cacheFilePath(cacheKey, { homeDir });
  let raw;
  try { raw = await fsImpl.readFile(file, "utf8"); }
  catch { return null; }
  let parsed;
  try { parsed = JSON.parse(raw); }
  catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  if (parsed.schemaVersion !== COMPOSE_DAY1_SCHEMA_VERSION) return null;
  const ttl = dirty ? COMPOSE_DAY1_CACHE_TTL_DIRTY_MS : COMPOSE_DAY1_CACHE_TTL_FRESH_MS;
  const writtenAt = Date.parse(parsed.writtenAt);
  if (!Number.isFinite(writtenAt)) return null;
  if (now.getTime() - writtenAt > ttl) return null;
  return parsed;
}

export async function writeComposedToCache(cacheKey, value, {
  fsImpl = fs,
  homeDir,
  now = new Date(),
} = {}) {
  const dir = cacheDirectory({ homeDir });
  await fsImpl.mkdir(dir, { recursive: true });
  const file = cacheFilePath(cacheKey, { homeDir });
  const payload = {
    schemaVersion: COMPOSE_DAY1_SCHEMA_VERSION,
    writtenAt: now.toISOString(),
    ...value,
  };
  await fsImpl.writeFile(file, JSON.stringify(payload, null, 2), { mode: 0o600 });
  return file;
}

/**
 * Validate the JSON the LLM returned. Returns the normalized object or null
 * when the schema doesn't match (caller falls back to deterministic).
 */
export function parseComposedDay1Response(text) {
  if (typeof text !== "string") return null;
  let parsed;
  try { parsed = JSON.parse(text); }
  catch { return null; }
  if (!parsed || typeof parsed !== "object") return null;
  const yesterday = trimmedNonEmpty(parsed.yesterday);
  const today = trimmedNonEmpty(parsed.today);
  const question = trimmedNonEmpty(parsed.question);
  if (!yesterday || !today || !question) return null;
  const confidence = typeof parsed.confidence === "number" ? parsed.confidence : 0;
  const evidenceRefs = Array.isArray(parsed.evidenceRefs)
    ? parsed.evidenceRefs
        .filter((entry) => entry && typeof entry === "object")
        .slice(0, 8)
        .map((entry) => ({
          path: typeof entry.path === "string" ? entry.path : "",
          reason: typeof entry.reason === "string" ? entry.reason : "",
        }))
    : [];
  return {
    yesterday,
    today,
    question,
    confidence,
    evidenceRefs,
  };
}

function trimmedNonEmpty(value) {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Build the user prompt sent to Claude. Sticks the deterministic ground truth
 * up front so the model treats it as facts to riff on, not signals to invent.
 */
export function buildComposeDay1Prompt({ context, onboarding, deterministic } = {}) {
  return [
    "Compose Day 1 first_prompt for the Agentic30 30-day challenge.",
    "Persona: YC partner / senior maker. Reply in Korean (반말 ~어/야), no emoji.",
    "",
    "GROUND TRUTH (do not invent values; if absent, say so):",
    `workspace_root: ${context?.sourceScanRoot || "(unknown)"}`,
    `found_doc_count: ${context?.foundDocCount ?? 0}`,
    `missing_expected_docs: ${(context?.missingExpectedDocs || []).join(", ") || "(none)"}`,
    `onboarding_role: ${onboarding?.role || "(none)"}`,
    `onboarding_project_stage: ${onboarding?.projectStage || "(none)"}`,
    `git_first_commit_at: ${context?.localDiscovery?.git?.firstCommitAt || "(none)"}`,
    `git_last_7_days_commit_count: ${context?.localDiscovery?.git?.last7DaysCommitCount ?? 0}`,
    `git_dirty: ${String(context?.localDiscovery?.git?.dirty ?? false)}`,
    `project_stacks: ${(context?.localDiscovery?.project?.stacks || []).join(", ") || "(none)"}`,
    `project_runway_days: ${context?.localDiscovery?.runway?.projectAgeDays ?? "(unknown)"}`,
    `recently_active: ${String(context?.localDiscovery?.runway?.recentlyActive ?? false)}`,
    "",
    "DETERMINISTIC FALLBACK (use as the floor — your output must be at least as honest):",
    `yesterday: ${deterministic?.day1_yesterday || ""}`,
    `today: ${deterministic?.day1_today || ""}`,
    `question: ${deterministic?.day1_question || ""}`,
    "",
    "TASK: emit a single JSON object with keys yesterday/today/question/evidenceRefs/confidence.",
    "- Content only. NEVER include prefixes like '어제:', '오늘:', or 'Q:'. Each field is ONE Korean line.",
    "- yesterday <= 240 chars, today <= 240 chars, question <= 200 chars.",
    "- evidenceRefs: array of {path, reason} for files you actually read (max 8). Empty if none.",
    "- confidence: number in [0,1] — your honest read.",
    "- Output the JSON object directly, with no surrounding prose and no code fences.",
  ].join("\n");
}

/**
 * Main entry point. Tries cache → LLM → deterministic fallback in order.
 * Returns an object the sidecar broadcasts as workspace_day1_compose_result:
 *   { yesterday, today, question, evidenceRefs, confidence, source,
 *     fellBackToDeterministic, webUsed, cacheKey, toolCounts, durationMs }
 */
export async function composeDay1Opening({
  workspaceRoot,
  context,
  onboarding = null,
  deterministicVariables = {},
  queryImpl,
  now = new Date(),
  homeDir,
  fsImpl = fs,
  cacheKeyOverride = null,
  timeoutMs = COMPOSE_DAY1_DEFAULT_TIMEOUT_MS,
  enableWeb = false,
} = {}) {
  const startedAt = Date.now();
  // PR3 (P1b): cacheKey now mixes the actual git HEAD sha (when available) so
  // a clean repo with a new commit invalidates the 24h cache. We still fall
  // back to firstCommitAt as a stable-enough fingerprint for pre-HEAD
  // sidecars and for non-git folders where neither value moves.
  const gitHead = context?.localDiscovery?.git?.head
    || context?.localDiscovery?.git?.firstCommitAt
    || null;
  const dirty = context?.localDiscovery?.git?.dirty === true;
  const cacheKey = cacheKeyOverride || buildCacheKey({
    workspaceRoot,
    gitHead,
    dirty,
    onboarding,
  });

  const cached = await readComposedFromCache(cacheKey, { now, dirty, fsImpl, homeDir });
  if (cached) {
    return finalizeResult({
      ...cached,
      source: "cache",
      cacheKey,
      durationMs: Date.now() - startedAt,
    });
  }

  // Deterministic fallback shape — used when the LLM fails or is missing.
  const fallback = {
    yesterday: deterministicVariables.day1_yesterday || "",
    today: deterministicVariables.day1_today || "",
    question: deterministicVariables.day1_question || "",
    evidenceRefs: [],
    confidence: 0,
    source: "deterministic",
    fellBackToDeterministic: true,
    webUsed: false,
    cacheKey,
    toolCounts: {},
    durationMs: Date.now() - startedAt,
  };

  if (typeof queryImpl !== "function") {
    return finalizeResult(fallback);
  }

  const canUseTool = buildComposeDay1CanUseTool({ workspaceRoot, enableWeb });
  const prompt = buildComposeDay1Prompt({ context, onboarding, deterministic: deterministicVariables });
  // PR3 (P1b): enabled tool list for the SDK `tools:` option. `allowedTools`
  // on the SDK only auto-allows; restricting `tools` is what keeps Bash/Edit
  // /Write out of the model's available surface in the first place. The
  // canUseTool callback remains as the second line of defence.
  const enabledTools = enableWeb
    ? [...COMPOSE_DAY1_ALLOWED_TOOLS, ...WEB_OPT_IN_TOOLS]
    : [...COMPOSE_DAY1_ALLOWED_TOOLS];

  let composed = null;
  try {
    composed = await runComposerWithTimeout({
      queryImpl,
      prompt,
      workspaceRoot,
      canUseTool,
      enabledTools,
      timeoutMs,
    });
  } catch {
    composed = null;
  }

  if (!composed || composed.confidence < COMPOSE_DAY1_MIN_CONFIDENCE) {
    return finalizeResult({
      ...fallback,
      toolCounts: { ...canUseTool.__counts },
    });
  }

  const counts = { ...canUseTool.__counts };
  const webUsed = enableWeb && ((counts.WebFetch || 0) + (counts.WebSearch || 0) > 0);
  const result = {
    yesterday: composed.yesterday,
    today: composed.today,
    question: composed.question,
    evidenceRefs: composed.evidenceRefs,
    confidence: composed.confidence,
    source: "llm",
    fellBackToDeterministic: false,
    webUsed,
    cacheKey,
    toolCounts: counts,
    durationMs: Date.now() - startedAt,
  };

  try {
    await writeComposedToCache(cacheKey, result, { fsImpl, homeDir, now });
  } catch { /* cache failures must not block the live path */ }

  return finalizeResult(result);
}

function finalizeResult(result) {
  return {
    schemaVersion: COMPOSE_DAY1_SCHEMA_VERSION,
    ...result,
  };
}

async function runComposerWithTimeout({
  queryImpl,
  prompt,
  workspaceRoot,
  canUseTool,
  enabledTools,
  timeoutMs,
}) {
  // PR3 (P1b): pass an AbortController to the SDK so a timeout actually
  // cancels the in-flight query instead of letting it continue in the
  // background. Test stubs that ignore the option are unaffected.
  const abortController = new AbortController();
  const llmCall = (async () => {
    const response = await queryImpl({
      prompt,
      options: {
        cwd: workspaceRoot,
        // `tools` restricts the model's available surface; `allowedTools` then
        // auto-allows those same names without prompting. canUseTool stays as
        // the second line of defence for path / cap / SSRF checks.
        tools: [...(enabledTools || COMPOSE_DAY1_ALLOWED_TOOLS)],
        allowedTools: [...(enabledTools || COMPOSE_DAY1_ALLOWED_TOOLS)],
        canUseTool,
        abortController,
      },
    });
    if (typeof response === "string") return parseComposedDay1Response(response);
    if (response && typeof response[Symbol.asyncIterator] === "function") {
      let text = "";
      for await (const message of response) {
        if (message?.type === "result" && typeof message?.result === "string") {
          text += message.result;
        }
      }
      return parseComposedDay1Response(text);
    }
    if (response && typeof response.text === "string") {
      return parseComposedDay1Response(response.text);
    }
    return null;
  })();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => {
      try { abortController.abort("compose_day1_timeout"); } catch { /* noop */ }
      reject(new Error("compose_day1_timeout"));
    }, timeoutMs);
  });
  try {
    return await Promise.race([llmCall, timeout]);
  } finally {
    clearTimeout(timer);
  }
}

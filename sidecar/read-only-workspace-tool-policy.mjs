import fs from "node:fs/promises";
import path from "node:path";

export const READ_ONLY_WORKSPACE_ALLOWED_TOOLS = Object.freeze(["Read", "Glob", "Grep"]);
export const READ_ONLY_WORKSPACE_DEFAULT_TOOL_CAPS = Object.freeze({ Read: 30, Glob: 10, Grep: 20 });

const DENIED_PATH_SEGMENTS = Object.freeze([
  ".git",
  ".env",
  ".ssh",
  "node_modules",
  ".keychain",
  ".aws",
  ".gnupg",
]);

const WEB_OPT_IN_TOOLS = Object.freeze(["WebFetch", "WebSearch"]);
const PRIVATE_HOST_PATTERNS = Object.freeze([
  /^localhost$/i,
  /^127\./, /^10\./, /^192\.168\./,
  /^172\.(1[6-9]|2\d|3[01])\./,
  /^169\.254\./,
  /^::1$/, /^fc00:/i, /^fd00:/i, /^fe80:/i,
  /\.internal$/i, /\.local$/i,
]);
const METADATA_HOST_PATTERNS = Object.freeze([
  /^169\.254\.169\.254$/,
  /^metadata\.google\.internal$/i,
]);
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

  let host = url.hostname.toLowerCase();
  if (host.startsWith("[") && host.endsWith("]")) host = host.slice(1, -1);
  if (host.endsWith(".")) host = host.slice(0, -1);

  const mappedDotted = host.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/);
  if (mappedDotted) {
    host = mappedDotted[1];
  } else {
    const mappedHex = host.match(/^::ffff:([0-9a-f]{1,4}):([0-9a-f]{1,4})$/);
    if (mappedHex) {
      const a = parseInt(mappedHex[1], 16);
      const b = parseInt(mappedHex[2], 16);
      host = `${(a >> 8) & 0xff}.${a & 0xff}.${(b >> 8) & 0xff}`;
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
  cleaned = cleaned.replace(/\s+/g, " ").trim();
  if (cleaned.length > 256) cleaned = cleaned.slice(0, 256);
  return cleaned;
}

export function buildReadOnlyWorkspaceCanUseTool({
  workspaceRoot,
  toolCaps = READ_ONLY_WORKSPACE_DEFAULT_TOOL_CAPS,
  onDecision = () => {},
  enableWeb = false,
  fsImpl = fs,
} = {}) {
  const allowed = enableWeb
    ? [...READ_ONLY_WORKSPACE_ALLOWED_TOOLS, ...WEB_OPT_IN_TOOLS]
    : [...READ_ONLY_WORKSPACE_ALLOWED_TOOLS];
  const counts = Object.fromEntries(allowed.map((toolName) => [toolName, 0]));
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

  const callback = async (toolName, input) => {
    let effectiveInput = input;
    if (enableWeb && toolName === "WebSearch" && input && typeof input === "object") {
      effectiveInput = { ...input, query: sanitizeWebSearchQuery(input.query) };
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
  return p.split(/[\\/]/).some((seg) => seg === "..");
}

async function pathPolicyVerdict(candidate, resolvedRoot, { fsImpl, toolName } = {}) {
  if (typeof candidate !== "string" || candidate.length === 0) {
    return { allowed: true, reason: "no_path" };
  }
  if ((toolName === "Glob" || toolName === "Grep") && containsTraversal(candidate)) {
    return { allowed: false, reason: "glob_traversal_segment" };
  }

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

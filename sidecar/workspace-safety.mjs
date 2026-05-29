// Single runtime source for workspace path-safety + secret redaction.
//
// Used by the MCP workspace tools (read/list/search) and by the agent
// work-history extractor so nothing secret-shaped ever reaches an LLM context,
// a chat surface, or a persisted `.agentic30/` artifact. The onboarding user
// concern is explicit: selecting a project path must not leak `.env` and friends.
//
// NOTE: scripts/check-public-safety.mjs intentionally keeps its OWN pattern set.
// That is a CI gate tuned to avoid false-positives on *tracked* files (a false
// positive blocks a commit). This module is the RUNTIME redactor: it may be
// broader / more aggressive because over-redaction only masks output, it never
// blocks anything. The two are deliberately separate; keep them in loose sync.

// Directory segments whose contents must never be read or searched.
export const SECRET_DIR_SEGMENTS = Object.freeze([
  ".git",
  ".ssh",
  ".aws",
  ".keychain",
  ".gnupg",
]);

// Build / dependency dirs — not secret, but heavy + noisy. Excluded from the
// agent-facing *listing* helpers; reads are still permitted (size-capped).
export const NOISE_DIR_SEGMENTS = Object.freeze([
  "node_modules",
  ".build",
  ".next",
  ".turbo",
  "build",
  "dist",
  "DerivedData",
  "sidecar-build",
  "vendor",
  "coverage",
]);

// Filename shapes that indicate secrets / credentials.
const SECRET_FILE_PATTERNS = Object.freeze([
  /^\.env(\.|$)/i, // .env, .env.local, .env.production
  /^\.envrc$/i,
  /^\.npmrc$/i,
  /^\.netrc$/i,
  /^\.?credentials?(\.|$)/i, // credentials, .credentials.json
  /\.(pem|key|p12|p8|pfx|cer|crt|der|keystore|jks|mobileprovision|provisionprofile)$/i,
  /(^|[._-])(secret|secrets|token|tokens|credential|credentials|password|passwd|apikey|api[_-]?key)([._-]|$)/i,
  /^auth\.json$/i, // codex ~/.codex/auth.json
  /^id_(rsa|ed25519|ecdsa|dsa)$/i,
]);

// Content-level secret patterns for redaction. Global flag so String.replace
// scrubs every occurrence. Mirrors scripts/check-public-safety.mjs ids where
// they overlap (deliberately duplicated — see module header).
export const SECRET_CONTENT_PATTERNS = Object.freeze([
  {
    id: "private-key",
    re: new RegExp("-----BEGIN (?:RSA |OPENSSH |EC |DSA )?PRIVATE " + "KEY-----", "g"),
  },
  {
    id: "gcp-service-account",
    re: new RegExp('"private_key"\\s*:\\s*"-----BEGIN PRIVATE ' + "KEY-----", "gi"),
  },
  { id: "aws-access-key", re: /\bAKIA[0-9A-Z]{16}\b/g },
  { id: "github-token", re: /\bgh[pousr]_[A-Za-z0-9_]{36,}\b/g },
  { id: "slack-token", re: /\bxox[baprs]-[A-Za-z0-9-]{10,}\b/g },
  { id: "google-api-key", re: /\bAIza[A-Za-z0-9_-]{35}\b/g },
  { id: "anthropic-key", re: /\bsk-ant-[A-Za-z0-9_-]{16,}\b/g },
  { id: "openai-token", re: /\bsk-(?:proj-)?[A-Za-z0-9_-]{20,}\b/g },
  { id: "bearer", re: /\bBearer\s+[A-Za-z0-9._-]{20,}/g },
  { id: "azure-secret", re: /\bAZURE_[A-Z0-9_]*(?:KEY|SECRET|TOKEN)\b\s*[:=]\s*["']?[^"'\s]{16,}/gi },
  { id: "client-secret", re: /\bclient_secret\b\s*[:=]\s*["']?[^"'\s]{12,}/gi },
  {
    id: "api-key-assignment",
    re: /\b(?:api[_-]?key|secret[_-]?key|access[_-]?token|auth[_-]?token|client[_-]?secret)\b\s*[:=]\s*["']?[A-Za-z0-9][A-Za-z0-9_-]{31,}/gi,
  },
  {
    id: "env-secret-assignment",
    re: /\b[A-Z][A-Z0-9_]*(?:KEY|SECRET|TOKEN|PASSWORD|PASSWD|CREDENTIAL)\b\s*=\s*["']?[^"'\s]{8,}/g,
  },
]);

// ripgrep `-g` exclude globs so search never traverses secret files/dirs even
// if .gitignore does not cover them.
export const SEARCH_EXCLUDE_GLOBS = Object.freeze([
  "!.git",
  "!.env",
  "!.env.*",
  "!.envrc",
  "!.npmrc",
  "!.netrc",
  "!*.pem",
  "!*.key",
  "!*.p12",
  "!*.p8",
  "!.ssh/**",
  "!.aws/**",
  "!.gnupg/**",
  "!.keychain/**",
  "!secrets/**",
  "!**/*secret*",
  "!**/*credential*",
]);

function segmentsOf(relativePath) {
  return String(relativePath || "")
    .split(/[\\/]+/)
    .filter(Boolean);
}

/// True when `name`'s basename looks like a secret file (or is a secret dir).
export function isSecretFilename(name) {
  const base = segmentsOf(name).pop() || "";
  if (!base) return false;
  if (SECRET_DIR_SEGMENTS.includes(base)) return true;
  return SECRET_FILE_PATTERNS.some((re) => re.test(base));
}

/// True when a relative path touches a secret dir or a secret-shaped filename
/// at any depth. This is the read/search denial predicate for workspace tools.
export function isSecretPath(relativePath) {
  const segs = segmentsOf(relativePath);
  if (!segs.length) return false;
  return segs.some(
    (seg) => SECRET_DIR_SEGMENTS.includes(seg) || SECRET_FILE_PATTERNS.some((re) => re.test(seg)),
  );
}

/// True for build/dependency noise dirs (used by listing helpers, not reads).
export function isNoisePath(relativePath) {
  return segmentsOf(relativePath).some((seg) => NOISE_DIR_SEGMENTS.includes(seg));
}

/// Replace every secret-shaped span in `text` with `‹redacted:<id>›`. Safe on
/// non-strings (returns "" / passthrough). Idempotent enough for repeated calls.
export function redactSecrets(text) {
  if (typeof text !== "string" || text.length === 0) {
    return typeof text === "string" ? text : "";
  }
  let out = text;
  for (const { id, re } of SECRET_CONTENT_PATTERNS) {
    re.lastIndex = 0;
    out = out.replace(re, `‹redacted:${id}›`);
  }
  return out;
}

/// True if redactSecrets would change `text` (i.e. a secret was detected).
export function containsSecret(text) {
  if (typeof text !== "string" || text.length === 0) return false;
  return SECRET_CONTENT_PATTERNS.some(({ re }) => {
    re.lastIndex = 0;
    return re.test(text);
  });
}

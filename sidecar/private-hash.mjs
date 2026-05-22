import crypto from "node:crypto";

// Centralized helper for hashing private excerpts (founder notes, mandalart
// strings, internal wiki keywords) before they enter the public-facing
// sanitization ledger or anywhere else. Plain SHA-256 leaves a small but
// non-zero rainbow-table / class-collision attack surface; HMAC with an
// ENV-bound pepper closes that. The ledger does not store raw excerpts at
// all (see `sanitization-ledger.mjs`), so the pepper guards only the
// "hash → original keyword" reverse path.
//
// Operational rules + rotation policy live in
// `docs/private/alignment/HMAC-PEPPER-ADR.md` (gitignored).

const ENV_KEY = "AGENTIC30_LEDGER_PEPPER";

let warnedOnce = false;

export const PRIVATE_HASH_VERSION = 1;

// Test-only knob to reset the once-flag between cases. Not exported as part
// of the production surface — callers that need it import it explicitly.
export function __resetWarnOnceForTests() {
  warnedOnce = false;
}

export function hashPrivateExcerpt(input) {
  if (typeof input !== "string" || input.length === 0) {
    throw new TypeError("hashPrivateExcerpt requires a non-empty string");
  }
  const pepper = process.env[ENV_KEY];
  if (!pepper) {
    // Fail-closed: prod with a hard-coded default pepper is a security
    // illusion (CCG/Codex HIGH). Forcing the operator to set the env var
    // makes the assumption visible.
    throw new Error(
      `${ENV_KEY} is not set; refusing to hash private excerpt without a pepper.`,
    );
  }
  if (pepper.startsWith("dev-only-") && !warnedOnce) {
    process.emitWarning(
      `${ENV_KEY} starts with "dev-only-" — this is for local development only. Production must use a strong rotated pepper.`,
    );
    warnedOnce = true;
  }
  const hmac = crypto.createHmac("sha256", pepper);
  hmac.update(input);
  return {
    pepperVersion: PRIVATE_HASH_VERSION,
    hash: hmac.digest("hex"),
  };
}

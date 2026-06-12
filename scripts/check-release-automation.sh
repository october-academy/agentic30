#!/usr/bin/env bash
set -euo pipefail

# Preflight release automation without building or publishing.
#
# Checks the local/CI environment needed by the release pipeline:
# - GitHub CLI and workflow lint (actionlint, when installed)
# - R2 upload credentials, with optional Wrangler bucket/domain validation
# - Signing, App Store Connect, and Sparkle inputs

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${BUILD_ENV_FILE:-$ROOT/secrets/build.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

SPARKLE_R2_BUCKET="${SPARKLE_R2_BUCKET:-agentic30-sparkle}"
SPARKLE_UPDATE_DOMAIN="${SPARKLE_UPDATE_DOMAIN:-updates.agentic30.app}"
SPARKLE_WRANGLER_BIN="${SPARKLE_WRANGLER_BIN:-wrangler}"

failed=0

pass() { echo "PASS: $*"; }
fail() { echo "FAIL: $*" >&2; failed=1; }
warn() { echo "WARN: $*" >&2; }

require_env() {
  local name="$1"
  if [ -z "${!name:-}" ]; then
    fail "\$$name is not set"
  else
    pass "\$$name is set"
  fi
}

require_cmd() {
  local name="$1"
  if command -v "$name" >/dev/null 2>&1; then
    pass "command found: $name"
  else
    fail "command missing: $name"
  fi
}

echo "Release automation preflight"
echo "  bucket: $SPARKLE_R2_BUCKET"
echo "  domain: $SPARKLE_UPDATE_DOMAIN"

require_cmd node
require_cmd gh
if command -v actionlint >/dev/null 2>&1; then
  actionlint .github/workflows/release.yml .github/workflows/secret-scanning.yml
  pass "GitHub workflow lint"
else
  warn "actionlint not installed; skipping GitHub workflow lint"
fi

if [ -n "${R2_S3_ENDPOINT:-}" ] || [ -n "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  pass "R2 S3 endpoint input is available"
else
  fail "CLOUDFLARE_ACCOUNT_ID or R2_S3_ENDPOINT is required for multipart R2 uploads"
fi
r2_access_key="${R2_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
r2_secret_key="${R2_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
if [ -n "$r2_access_key" ] && [ -n "$r2_secret_key" ]; then
  pass "Explicit R2 S3 credentials are available"
elif [ -n "$r2_access_key" ] || [ -n "$r2_secret_key" ]; then
  fail "both R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required when explicit R2 S3 credentials are provided"
elif [ -n "${CLOUDFLARE_API_TOKEN:-}" ]; then
  pass "R2 S3 credentials can be derived from CLOUDFLARE_API_TOKEN"
else
  fail "R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY or CLOUDFLARE_API_TOKEN is required for multipart R2 uploads"
fi
if command -v "$SPARKLE_WRANGLER_BIN" >/dev/null 2>&1; then
  pass "command found: $SPARKLE_WRANGLER_BIN"
  if "$SPARKLE_WRANGLER_BIN" whoami >/dev/null 2>&1; then
    pass "Wrangler authenticated"
    if "$SPARKLE_WRANGLER_BIN" r2 bucket info "$SPARKLE_R2_BUCKET" >/dev/null 2>&1; then
      pass "R2 bucket accessible: $SPARKLE_R2_BUCKET"
    else
      fail "R2 bucket not accessible: $SPARKLE_R2_BUCKET"
    fi

    if "$SPARKLE_WRANGLER_BIN" r2 bucket domain get "$SPARKLE_R2_BUCKET" --domain "$SPARKLE_UPDATE_DOMAIN" >/dev/null 2>&1; then
      pass "R2 custom domain connected: $SPARKLE_UPDATE_DOMAIN"
    else
      fail "R2 custom domain missing: $SPARKLE_UPDATE_DOMAIN"
    fi
  else
    warn "Wrangler is not authenticated; release upload will rely on R2 S3 credentials and public URL verification"
  fi
else
  warn "command missing: $SPARKLE_WRANGLER_BIN; release upload will rely on R2 S3 credentials and public URL verification"
fi

require_env DEVELOPMENT_TEAM
require_env SPARKLE_PUBLIC_ED_KEY
require_env ASC_KEY_ID
require_env ASC_ISSUER_ID
if [ -n "${ASC_API_KEY_P8:-}" ] || [ -n "${ASC_API_KEY_BASE64:-}" ] || { [ -n "${ASC_API_KEY_PATH:-}" ] && [ -f "$ASC_API_KEY_PATH" ]; }; then
  pass "App Store Connect API key material is available"
else
  fail "ASC_API_KEY_P8, ASC_API_KEY_BASE64, or ASC_API_KEY_PATH is required"
fi
if [ -n "${SPARKLE_GENERATE_APPCAST_BIN:-}" ] && [ -x "$SPARKLE_GENERATE_APPCAST_BIN" ]; then
  pass "Sparkle generate_appcast executable: $SPARKLE_GENERATE_APPCAST_BIN"
elif find "$HOME/Library/Developer/Xcode/DerivedData" -path '*/Sparkle/bin/generate_appcast' -type f -perm -111 2>/dev/null | head -n 1 | grep -q .; then
  pass "Sparkle generate_appcast can be auto-discovered from Xcode DerivedData"
else
  warn "SPARKLE_GENERATE_APPCAST_BIN is not set; build-and-notarize.sh will auto-discover it after Xcode resolves Sparkle"
fi
if [ -n "${CODE_SIGN_IDENTITY:-}" ] || [ -n "${DEVELOPER_ID_APPLICATION_P12_BASE64:-}" ]; then
  pass "Developer ID Application signing input is available"
else
  fail "CODE_SIGN_IDENTITY or DEVELOPER_ID_APPLICATION_P12_BASE64 is required"
fi
if [ -n "${SPARKLE_PRIVATE_ED_KEY:-}" ] || [ -n "${SPARKLE_PRIVATE_ED_KEY_BASE64:-}" ]; then
  pass "Sparkle private EdDSA signing key is available from environment"
else
  warn "SPARKLE_PRIVATE_ED_KEY is not set; local release will use Sparkle keychain account ${SPARKLE_KEY_ACCOUNT:-agentic30}"
fi

if [ "$failed" = "1" ]; then
  echo "Release automation preflight failed." >&2
  exit 1
fi

echo "Release automation preflight passed."

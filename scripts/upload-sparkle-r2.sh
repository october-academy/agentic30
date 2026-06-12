#!/usr/bin/env bash
set -euo pipefail

# Upload Sparkle appcast artifacts to the Cloudflare R2 bucket that serves
# https://updates.agentic30.app/.
#
# Optional environment:
#   BUILD_ENV_FILE              — env file to source (defaults to secrets/build.env)
#   SPARKLE_APPCAST_DIR         — appcast staging folder (defaults to build/appcast)
#   SPARKLE_APPCAST_FILENAME    — appcast object key (defaults to appcast.xml; x64 builds use appcast-x64.xml)
#   SPARKLE_R2_BUCKET           — R2 bucket name (defaults to agentic30-sparkle)
#   SPARKLE_PUBLIC_BASE_URL     — public base URL (defaults to https://updates.agentic30.app/)
#   SPARKLE_WRANGLER_BIN        — wrangler executable (defaults to wrangler)
#   SPARKLE_WRANGLER_REMOTE     — 1 to force remote R2 writes (defaults to 1)
#   CLOUDFLARE_ACCOUNT_ID       — Cloudflare account id for the R2 S3 endpoint
#   R2_ACCESS_KEY_ID            — R2 S3 access key id
#   R2_SECRET_ACCESS_KEY        — R2 S3 secret access key
#   CLOUDFLARE_API_TOKEN        — optional R2 API token fallback for S3 credentials
#   R2_S3_ENDPOINT              — optional R2 S3 endpoint override

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${BUILD_ENV_FILE:-$ROOT/secrets/build.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "WARN: $ENV_FILE not found; expecting env vars to be exported inline." >&2
fi

SPARKLE_APPCAST_DIR="${SPARKLE_APPCAST_DIR:-build/appcast}"
SPARKLE_APPCAST_FILENAME="${SPARKLE_APPCAST_FILENAME:-appcast.xml}"
SPARKLE_R2_BUCKET="${SPARKLE_R2_BUCKET:-agentic30-sparkle}"
SPARKLE_PUBLIC_BASE_URL="${SPARKLE_PUBLIC_BASE_URL:-https://updates.agentic30.app/}"
SPARKLE_WRANGLER_BIN="${SPARKLE_WRANGLER_BIN:-wrangler}"
SPARKLE_WRANGLER_REMOTE="${SPARKLE_WRANGLER_REMOTE:-1}"

case "$SPARKLE_PUBLIC_BASE_URL" in
  */) ;;
  *) SPARKLE_PUBLIC_BASE_URL="${SPARKLE_PUBLIC_BASE_URL}/" ;;
esac

if [ -z "${R2_S3_ENDPOINT:-}" ] && [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
  echo "ERROR: CLOUDFLARE_ACCOUNT_ID or R2_S3_ENDPOINT is required for R2 S3 uploads" >&2
  exit 2
fi
r2_access_key="${R2_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
r2_secret_key="${R2_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
if { [ -n "$r2_access_key" ] || [ -n "$r2_secret_key" ]; } && { [ -z "$r2_access_key" ] || [ -z "$r2_secret_key" ]; }; then
  echo "ERROR: both R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required when explicit R2 S3 credentials are provided" >&2
  exit 2
fi
if [ -z "$r2_access_key" ] && [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
  echo "ERROR: R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY or CLOUDFLARE_API_TOKEN is required for R2 S3 uploads" >&2
  exit 2
fi
if command -v "$SPARKLE_WRANGLER_BIN" >/dev/null 2>&1; then
  if "$SPARKLE_WRANGLER_BIN" whoami >/dev/null 2>&1; then
    if ! "$SPARKLE_WRANGLER_BIN" r2 bucket info "$SPARKLE_R2_BUCKET" >/dev/null 2>&1; then
      echo "ERROR: R2 bucket '$SPARKLE_R2_BUCKET' does not exist or is not accessible; run scripts/setup-sparkle-r2.sh first" >&2
      exit 2
    fi
  else
    echo "WARN: wrangler auth unavailable; relying on R2 S3 upload credentials and public URL verification." >&2
  fi
else
  echo "WARN: wrangler executable not found; relying on R2 S3 upload credentials and public URL verification." >&2
fi

appcast_xml="$SPARKLE_APPCAST_DIR/$SPARKLE_APPCAST_FILENAME"
[ -f "$appcast_xml" ] || { echo "ERROR: missing $appcast_xml" >&2; exit 1; }

dmg_count="$(find "$SPARKLE_APPCAST_DIR" -maxdepth 1 -type f -name 'agentic30-*.dmg' | wc -l | tr -d '[:space:]')"
if [ "$dmg_count" != "1" ]; then
  echo "ERROR: expected exactly one agentic30-*.dmg in $SPARKLE_APPCAST_DIR, found $dmg_count" >&2
  exit 1
fi
appcast_dmg="$(find "$SPARKLE_APPCAST_DIR" -maxdepth 1 -type f -name 'agentic30-*.dmg' | sort | head -n 1)"

if ! grep -Fq "$SPARKLE_PUBLIC_BASE_URL" "$appcast_xml"; then
  echo "ERROR: $SPARKLE_APPCAST_FILENAME does not reference $SPARKLE_PUBLIC_BASE_URL" >&2
  exit 1
fi

SPARKLE_UPLOAD_RETRIES="${SPARKLE_UPLOAD_RETRIES:-4}"

upload_object() {
  local file_path="$1"
  local object_key="$2"
  local content_type="$3"
  local cache_control="$4"
  # Use R2's S3-compatible multipart path for payload uploads. Wrangler's
  # object PUT path currently rejects files over 300 MiB, which is below the
  # arm64 DMG size once provider-native binaries are bundled.
  local attempt=1 delay=10
  while :; do
    if node scripts/r2-upload-object.mjs \
      --file "$file_path" \
      --bucket "$SPARKLE_R2_BUCKET" \
      --key "$object_key" \
      --content-type "$content_type" \
      --cache-control "$cache_control"; then
      return 0
    fi
    if [ "$attempt" -ge "$SPARKLE_UPLOAD_RETRIES" ]; then
      echo "ERROR: failed to upload $object_key after $attempt attempts" >&2
      return 1
    fi
    echo "WARN: upload of $object_key failed (attempt $attempt/$SPARKLE_UPLOAD_RETRIES); retrying in ${delay}s..." >&2
    sleep "$delay"
    attempt=$((attempt + 1))
    delay=$((delay * 2))
  done
}

verify_url() {
  local url="$1"
  curl -fsSI "$url" >/dev/null
}

echo "Uploading Sparkle artifacts to R2 bucket: $SPARKLE_R2_BUCKET"

# Upload the DMG (and release notes) BEFORE the appcast. The appcast is the
# feed pointer; publishing it before its target exists would point existing
# installs at a missing DMG. Verify each payload is publicly fetchable before
# the appcast goes live so a failed DMG upload leaves the old feed intact.
dmg_name="$(basename "$appcast_dmg")"
upload_object "$appcast_dmg" "$dmg_name" "application/x-apple-diskimage" "public, max-age=31536000, immutable"
verify_url "${SPARKLE_PUBLIC_BASE_URL}${dmg_name}"

# Notes are embedded in the appcast (--embed-release-notes), so this hosted
# copy is belt-and-braces; the name must match generate_appcast's convention
# (archive basename with the extension replaced).
notes_path="${appcast_dmg%.dmg}.md"
if [ -f "$notes_path" ]; then
  upload_object "$notes_path" "$(basename "$notes_path")" "text/markdown; charset=utf-8" "public, max-age=31536000, immutable"
  verify_url "${SPARKLE_PUBLIC_BASE_URL}$(basename "$notes_path")"
fi

# Pointer last: only flip the feed once the DMG it references is confirmed live.
upload_object "$appcast_xml" "$SPARKLE_APPCAST_FILENAME" "application/xml" "public, max-age=0, must-revalidate"

echo "Verifying public Sparkle URLs..."
verify_url "${SPARKLE_PUBLIC_BASE_URL}${SPARKLE_APPCAST_FILENAME}"
verify_url "${SPARKLE_PUBLIC_BASE_URL}${dmg_name}"
if [ -f "$notes_path" ]; then
  verify_url "${SPARKLE_PUBLIC_BASE_URL}$(basename "$notes_path")"
fi

echo "Sparkle R2 upload complete:"
echo "  ${SPARKLE_PUBLIC_BASE_URL}${SPARKLE_APPCAST_FILENAME}"
echo "  ${SPARKLE_PUBLIC_BASE_URL}${dmg_name}"
if [ -f "$notes_path" ]; then
  echo "  ${SPARKLE_PUBLIC_BASE_URL}$(basename "$notes_path")"
fi

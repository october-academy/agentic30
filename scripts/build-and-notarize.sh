#!/usr/bin/env bash
set -euo pipefail

# Build, sign, notarize, staple, and DMG-pack agentic30.app for Developer ID
# distribution. One invocation produces exactly one per-arch DMG plus its
# Sparkle appcast; the GitHub Actions release workflow runs this once per arch.
#
# Required environment (via secrets/build.env locally, or CI secrets):
#   DEVELOPMENT_TEAM      — Apple Developer Team ID (e.g. ABC123XYZ)
#   CODE_SIGN_IDENTITY    — SHA1 hash from `security find-identity -v -p codesigning`
#   ASC_API_KEY_PATH      — App Store Connect API .p8 path (notarytool auth)
#   ASC_KEY_ID            — App Store Connect API Key ID (10 chars)
#   ASC_ISSUER_ID         — App Store Connect API Issuer ID (UUID)
#   SPARKLE_PUBLIC_ED_KEY — public EdDSA key embedded in Info.plist
#   SPARKLE_DOWNLOAD_URL_PREFIX — public URL prefix where appcast DMGs are hosted
#                                (https://updates.agentic30.app/ for release)
# Optional:
#   AGENTIC30_BUNDLE_ARCH     — arm64 or x64 (defaults to current machine arch)
#   AGENTIC30_BUILD_APPCAST   — 0 to skip Sparkle appcast generation (defaults to 1)
#   AGENTIC30_UPLOAD_APPCAST_R2 — 1 to upload appcast artifacts to Cloudflare R2
#   SPARKLE_APPCAST_FILENAME — appcast object key (defaults per arch:
#                              arm64 → appcast.xml, x64 → appcast-x64.xml)
#   SPARKLE_FEED_URL         — SUFeedURL to embed (defaults to base URL + filename)
#   SPARKLE_R2_BUCKET        — Cloudflare R2 bucket (defaults to agentic30-sparkle)
#   SPARKLE_PUBLIC_BASE_URL  — public update URL (defaults to https://updates.agentic30.app/)
#   SPARKLE_UPDATE_DOMAIN    — R2 custom domain (defaults to updates.agentic30.app)
#   SPARKLE_GENERATE_APPCAST_BIN — path to Sparkle's generate_appcast tool
#                                (auto-discovered from Xcode DerivedData if omitted)
#   SPARKLE_KEY_ACCOUNT      — Sparkle keychain account (defaults to agentic30)
#   SPARKLE_RELEASE_NOTES_PATH — markdown what's-new embedded into the appcast
#                                (defaults to the newest released CHANGELOG.md
#                                section via scripts/changelog-latest-notes.sh)
#   SPARKLE_PRIVATE_ED_KEY   — private EdDSA key for CI appcast signing
#   SPARKLE_PRIVATE_ED_KEY_BASE64 — base64 private EdDSA key for CI appcast signing
#   SPARKLE_WRANGLER_BIN     — wrangler executable (defaults to wrangler)
#   CLOUDFLARE_ACCOUNT_ID    — Cloudflare account id for the R2 S3 endpoint
#   R2_ACCESS_KEY_ID         — R2 S3 access key id for multipart DMG upload
#   R2_SECRET_ACCESS_KEY     — R2 S3 secret access key for multipart DMG upload
#   CLOUDFLARE_API_TOKEN     — optional R2 API token fallback for S3 credentials
#   R2_S3_ENDPOINT           — optional R2 S3 endpoint override
#   AGENTIC30_DMG_WARN_MIB   — warn above this DMG size (defaults to 280)
#   AGENTIC30_DMG_MAX_MIB    — fail above this DMG size (defaults to 500)
#   POSTHOG_PROJECT_API_KEY — PostHog project token embedded for launch telemetry
#   POSTHOG_HOST           — PostHog app/ingest host (defaults to https://us.posthog.com)
#
# Output:
#   build/export/agentic30.app                  — signed + notarized + stapled
#   build/agentic30-$AGENTIC30_BUNDLE_ARCH.dmg  — signed + notarized + stapled
#   build/appcast/                              — Sparkle appcast staging folder

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

required_vars=(
  DEVELOPMENT_TEAM
  CODE_SIGN_IDENTITY
  ASC_API_KEY_PATH
  ASC_KEY_ID
  ASC_ISSUER_ID
  SPARKLE_PUBLIC_ED_KEY
)
AGENTIC30_BUILD_APPCAST="${AGENTIC30_BUILD_APPCAST:-1}"
AGENTIC30_UPLOAD_APPCAST_R2="${AGENTIC30_UPLOAD_APPCAST_R2:-0}"
SPARKLE_PUBLIC_BASE_URL="${SPARKLE_PUBLIC_BASE_URL:-https://updates.agentic30.app/}"
SPARKLE_UPDATE_DOMAIN="${SPARKLE_UPDATE_DOMAIN:-updates.agentic30.app}"
SPARKLE_R2_BUCKET="${SPARKLE_R2_BUCKET:-agentic30-sparkle}"
SPARKLE_KEY_ACCOUNT="${SPARKLE_KEY_ACCOUNT:-agentic30}"
SPARKLE_WRANGLER_BIN="${SPARKLE_WRANGLER_BIN:-wrangler}"
AGENTIC30_DMG_WARN_MIB="${AGENTIC30_DMG_WARN_MIB:-280}"
AGENTIC30_DMG_MAX_MIB="${AGENTIC30_DMG_MAX_MIB:-500}"
case "$SPARKLE_PUBLIC_BASE_URL" in
  */) ;;
  *) SPARKLE_PUBLIC_BASE_URL="${SPARKLE_PUBLIC_BASE_URL}/" ;;
esac
if [ "$AGENTIC30_BUILD_APPCAST" = "1" ]; then
  required_vars+=(SPARKLE_DOWNLOAD_URL_PREFIX)
fi
missing=0
for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: \$$var not set" >&2
    missing=1
  fi
done
[ "$missing" = "1" ] && exit 2

# shellcheck disable=SC2016
if [[ "${SPARKLE_PUBLIC_ED_KEY:-}" =~ ^[[:space:]]*$ ]] || [[ "${SPARKLE_PUBLIC_ED_KEY:-}" == *'$('* ]]; then
  echo "ERROR: \$SPARKLE_PUBLIC_ED_KEY must be a concrete Sparkle EdDSA public key, not empty or a build setting placeholder" >&2
  exit 2
fi

if [ "$AGENTIC30_UPLOAD_APPCAST_R2" = "1" ]; then
  if [ "$AGENTIC30_BUILD_APPCAST" != "1" ]; then
    echo "ERROR: AGENTIC30_UPLOAD_APPCAST_R2=1 requires AGENTIC30_BUILD_APPCAST=1" >&2
    exit 2
  fi
  case "$SPARKLE_DOWNLOAD_URL_PREFIX" in
    */) ;;
    *) SPARKLE_DOWNLOAD_URL_PREFIX="${SPARKLE_DOWNLOAD_URL_PREFIX}/" ;;
  esac
  if [ "$SPARKLE_DOWNLOAD_URL_PREFIX" != "$SPARKLE_PUBLIC_BASE_URL" ]; then
    echo "ERROR: SPARKLE_DOWNLOAD_URL_PREFIX ($SPARKLE_DOWNLOAD_URL_PREFIX) must match SPARKLE_PUBLIC_BASE_URL ($SPARKLE_PUBLIC_BASE_URL) when R2 upload is enabled" >&2
    exit 2
  fi
  if [ -z "${R2_S3_ENDPOINT:-}" ] && [ -z "${CLOUDFLARE_ACCOUNT_ID:-}" ]; then
    echo "ERROR: CLOUDFLARE_ACCOUNT_ID or R2_S3_ENDPOINT is required for R2 S3 multipart uploads" >&2
    exit 2
  fi
  r2_access_key="${R2_ACCESS_KEY_ID:-${AWS_ACCESS_KEY_ID:-}}"
  r2_secret_key="${R2_SECRET_ACCESS_KEY:-${AWS_SECRET_ACCESS_KEY:-}}"
  if { [ -n "$r2_access_key" ] || [ -n "$r2_secret_key" ]; } && { [ -z "$r2_access_key" ] || [ -z "$r2_secret_key" ]; }; then
    echo "ERROR: both R2_ACCESS_KEY_ID and R2_SECRET_ACCESS_KEY are required when explicit R2 S3 credentials are provided" >&2
    exit 2
  fi
  if [ -z "$r2_access_key" ] && [ -z "${CLOUDFLARE_API_TOKEN:-}" ]; then
    echo "ERROR: R2_ACCESS_KEY_ID/R2_SECRET_ACCESS_KEY or CLOUDFLARE_API_TOKEN is required for R2 S3 multipart uploads" >&2
    exit 2
  fi
  if command -v "$SPARKLE_WRANGLER_BIN" >/dev/null 2>&1; then
    if "$SPARKLE_WRANGLER_BIN" whoami >/dev/null 2>&1; then
      if ! "$SPARKLE_WRANGLER_BIN" r2 bucket info "$SPARKLE_R2_BUCKET" >/dev/null 2>&1; then
        echo "ERROR: R2 bucket '$SPARKLE_R2_BUCKET' does not exist or is not accessible; run scripts/setup-sparkle-r2.sh first" >&2
        exit 2
      fi
      if ! "$SPARKLE_WRANGLER_BIN" r2 bucket domain get "$SPARKLE_R2_BUCKET" --domain "$SPARKLE_UPDATE_DOMAIN" >/dev/null 2>&1; then
        echo "ERROR: R2 bucket '$SPARKLE_R2_BUCKET' is not connected to custom domain '$SPARKLE_UPDATE_DOMAIN'; run scripts/setup-sparkle-r2.sh first" >&2
        exit 2
      fi
    else
      echo "WARN: wrangler auth unavailable; relying on R2 S3 upload credentials and public URL verification." >&2
    fi
  else
    echo "WARN: wrangler executable not found; relying on R2 S3 upload credentials and public URL verification." >&2
  fi
fi

POSTHOG_PROJECT_API_KEY="${POSTHOG_PROJECT_API_KEY:-phc_IXc1t2XtX4u1lOK8XHuiuE7Z0IwjiQSMxmG1rDWgMgA}"
if [[ "$POSTHOG_PROJECT_API_KEY" != phc_* ]]; then
  echo "ERROR: \$POSTHOG_PROJECT_API_KEY must be a PostHog project token starting with phc_" >&2
  exit 2
fi

POSTHOG_HOST="${POSTHOG_HOST:-https://us.posthog.com}"
host_arch="$(uname -m)"
case "${AGENTIC30_BUNDLE_ARCH:-$host_arch}" in
  arm64|aarch64)
    AGENTIC30_BUNDLE_ARCH="arm64"
    XCODE_ARCH="arm64"
    NODE_RUNTIME_ARCH="arm64"
    ;;
  x64|x86_64)
    AGENTIC30_BUNDLE_ARCH="x64"
    XCODE_ARCH="x86_64"
    NODE_RUNTIME_ARCH="x64"
    ;;
  *)
    echo "ERROR: AGENTIC30_BUNDLE_ARCH must be arm64 or x64" >&2
    exit 2
    ;;
esac
export AGENTIC30_BUNDLE_ARCH

# Per-arch Sparkle feed: Intel builds must never read the arm64 appcast or
# Sparkle would hand Intel users an arm64 DMG on update. arm64 keeps the
# historical appcast.xml so existing installs continue updating.
case "$AGENTIC30_BUNDLE_ARCH" in
  x64) default_appcast_filename="appcast-x64.xml" ;;
  *) default_appcast_filename="appcast.xml" ;;
esac
SPARKLE_APPCAST_FILENAME="${SPARKLE_APPCAST_FILENAME:-$default_appcast_filename}"
SPARKLE_FEED_URL="${SPARKLE_FEED_URL:-${SPARKLE_PUBLIC_BASE_URL}${SPARKLE_APPCAST_FILENAME}}"
export SPARKLE_APPCAST_FILENAME SPARKLE_FEED_URL

ARCHIVE_PATH="build/agentic30.xcarchive"
EXPORT_PATH="build/export"
APP_PATH="$EXPORT_PATH/agentic30.app"
DMG_PATH="build/agentic30-${AGENTIC30_BUNDLE_ARCH}.dmg"
DMG_STAGING="build/dmg-staging"
APPCAST_DIR="${SPARKLE_APPCAST_DIR:-build/appcast}"
EXPORT_OPTIONS="build/ExportOptions.plist"
ENTITLEMENTS_PATH="$ROOT/agentic30/agentic30.entitlements"

resolve_generate_appcast_bin() {
  if [ -n "${SPARKLE_GENERATE_APPCAST_BIN:-}" ]; then
    if [ -x "$SPARKLE_GENERATE_APPCAST_BIN" ]; then
      return 0
    fi
    echo "ERROR: SPARKLE_GENERATE_APPCAST_BIN is not executable: $SPARKLE_GENERATE_APPCAST_BIN" >&2
    exit 2
  fi

  local candidate
  candidate="$(find "$HOME/Library/Developer/Xcode/DerivedData" \
    "$ROOT/.build" \
    "$ROOT/build" \
    -path '*/Sparkle/bin/generate_appcast' \
    -type f \
    -perm -111 \
    2>/dev/null | sort -r | head -n 1 || true)"
  if [ -n "$candidate" ]; then
    SPARKLE_GENERATE_APPCAST_BIN="$candidate"
    export SPARKLE_GENERATE_APPCAST_BIN
    echo "Using Sparkle generate_appcast: $SPARKLE_GENERATE_APPCAST_BIN"
    return 0
  fi

  echo "ERROR: Sparkle generate_appcast not found; set SPARKLE_GENERATE_APPCAST_BIN" >&2
  exit 2
}

notarize() {
  xcrun notarytool submit "$1" \
    --key "$ASC_API_KEY_PATH" \
    --key-id "$ASC_KEY_ID" \
    --issuer "$ASC_ISSUER_ID" \
    --wait \
    --timeout 2h
}

path_size_bytes() {
  if [ -d "$1" ]; then
    du -sk "$1" | awk '{ print $1 * 1024 }'
  else
    wc -c < "$1" | tr -d '[:space:]'
  fi
}

bytes_to_mib() {
  awk -v bytes="$1" 'BEGIN { printf "%.1f", bytes / 1024 / 1024 }'
}

log_artifact_size() {
  local label="$1"
  local target="$2"
  local bytes
  bytes="$(path_size_bytes "$target")"
  echo "Artifact size: $label = $(bytes_to_mib "$bytes") MiB ($target)"
}

check_dmg_size_budget() {
  local target="$1"
  local bytes
  local mib
  bytes="$(path_size_bytes "$target")"
  mib="$(bytes_to_mib "$bytes")"
  if awk -v size="$mib" -v max="$AGENTIC30_DMG_MAX_MIB" 'BEGIN { exit(size > max ? 0 : 1) }'; then
    echo "ERROR: DMG size ${mib} MiB exceeds AGENTIC30_DMG_MAX_MIB=${AGENTIC30_DMG_MAX_MIB}" >&2
    exit 1
  fi
  if awk -v size="$mib" -v warn="$AGENTIC30_DMG_WARN_MIB" 'BEGIN { exit(size > warn ? 0 : 1) }'; then
    echo "WARN: DMG size ${mib} MiB exceeds AGENTIC30_DMG_WARN_MIB=${AGENTIC30_DMG_WARN_MIB}; upload will use R2 S3 multipart." >&2
  fi
}

mkdir -p build

echo "[1/10] Cleaning previous build artifacts..."
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH" "$DMG_PATH" "$DMG_STAGING" "$EXPORT_OPTIONS"
if [ "$AGENTIC30_BUILD_APPCAST" = "1" ]; then
  rm -rf "$APPCAST_DIR"
fi
mkdir -p "$APPCAST_DIR"

echo "[2/10] Generating ExportOptions.plist..."
cat > "$EXPORT_OPTIONS" <<EOF
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>method</key>
  <string>developer-id</string>
  <key>teamID</key>
  <string>$DEVELOPMENT_TEAM</string>
  <key>signingStyle</key>
  <string>manual</string>
  <key>signingCertificate</key>
  <string>Developer ID Application</string>
</dict>
</plist>
EOF

echo "[3/10] xcodebuild archive (arch=${AGENTIC30_BUNDLE_ARCH}, Hardened Runtime + entitlements)..."
xcodebuild archive \
  -project agentic30.xcodeproj \
  -scheme agentic30 \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination 'generic/platform=macOS' \
  ARCHS="$XCODE_ARCH" \
  ENABLE_HARDENED_RUNTIME=YES \
  CODE_SIGN_ENTITLEMENTS="$ENTITLEMENTS_PATH" \
  CODE_SIGN_IDENTITY="$CODE_SIGN_IDENTITY" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  SPARKLE_PUBLIC_ED_KEY="$SPARKLE_PUBLIC_ED_KEY" \
  SPARKLE_FEED_URL="$SPARKLE_FEED_URL" \
  POSTHOG_PROJECT_API_KEY="$POSTHOG_PROJECT_API_KEY" \
  POSTHOG_HOST="$POSTHOG_HOST"

[ -d "$ARCHIVE_PATH" ] || { echo "ERROR: archive build failed" >&2; exit 1; }

echo "[4/10] Exporting signed .app and verifying embedded Info.plist..."
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

[ -d "$APP_PATH" ] || { echo "ERROR: export failed; .app not at $APP_PATH" >&2; exit 1; }

embedded_posthog_key="$(/usr/libexec/PlistBuddy -c 'Print :Agentic30PostHogProjectAPIKey' "$APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
if [[ "$embedded_posthog_key" != phc_* ]]; then
  echo "ERROR: exported app is missing embedded PostHog project token" >&2
  exit 1
fi
embedded_sparkle_key="$(/usr/libexec/PlistBuddy -c 'Print :SUPublicEDKey' "$APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
# shellcheck disable=SC2016
if [[ "$embedded_sparkle_key" =~ ^[[:space:]]*$ ]] || [[ "$embedded_sparkle_key" == *'$('* ]]; then
  echo "ERROR: exported app is missing embedded Sparkle public EdDSA key" >&2
  exit 1
fi
embedded_feed_url="$(/usr/libexec/PlistBuddy -c 'Print :SUFeedURL' "$APP_PATH/Contents/Info.plist" 2>/dev/null || true)"
if [ "$embedded_feed_url" != "$SPARKLE_FEED_URL" ]; then
  echo "ERROR: exported app SUFeedURL ($embedded_feed_url) does not match expected feed ($SPARKLE_FEED_URL)" >&2
  exit 1
fi

# Bundled sidecar npm packages ship .bin/ symlinks (cmake-js, node-llama-cpp,
# etc.) that point outside the bundle on the build machine. macOS codesign
# --strict rejects bundles containing broken or out-of-bundle symlinks
# ("invalid destination for symbolic link"). Strip them before verification.
echo "[5/10] Stripping bundled sidecar .bin/ symlinks..."
SIDECAR_BUNDLE="$APP_PATH/Contents/Resources/sidecar"
if [ -d "$SIDECAR_BUNDLE" ]; then
  find "$SIDECAR_BUNDLE" -type d -name '.bin' -prune -exec rm -rf {} + 2>/dev/null || true
  # Re-sign the .app after the bundle mutation so the seal stays consistent.
  codesign --force --sign "$CODE_SIGN_IDENTITY" \
    --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS_PATH" \
    "$APP_PATH"
fi

echo "[6/10] Verifying architecture, bundled Node runtime, codesign, and version..."
app_archs="$(lipo -archs "$APP_PATH/Contents/MacOS/agentic30")"
if ! grep -qw "$XCODE_ARCH" <<<"$app_archs"; then
  echo "ERROR: app binary is missing $XCODE_ARCH slice (got: $app_archs)" >&2
  exit 1
fi
runtime_node="$APP_PATH/Contents/Resources/sidecar/runtime/node-darwin-$NODE_RUNTIME_ARCH/bin/node"
if [ ! -x "$runtime_node" ]; then
  echo "ERROR: bundled Node runtime missing for $NODE_RUNTIME_ARCH at $runtime_node" >&2
  exit 1
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"

bundle_version=$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$APP_PATH/Contents/Info.plist")
if ! [[ "$bundle_version" =~ ^[0-9]+$ ]]; then
  echo "ERROR: CFBundleVersion must be an incrementing integer for Sparkle (got '$bundle_version')" >&2
  exit 1
fi
if [ -n "${PREVIOUS_BUNDLE_VERSION:-}" ] && [ "$bundle_version" -le "$PREVIOUS_BUNDLE_VERSION" ]; then
  echo "ERROR: CFBundleVersion ($bundle_version) must be greater than PREVIOUS_BUNDLE_VERSION ($PREVIOUS_BUNDLE_VERSION)" >&2
  exit 1
fi

echo "[7/10] Notarizing + stapling .app (may take 5-30 min)..."
ZIP_PATH="build/agentic30-app.zip"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"
notarize "$ZIP_PATH"
rm -f "$ZIP_PATH"
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

echo "[8/10] Creating + signing + notarizing DMG..."
mkdir -p "$DMG_STAGING"
ditto "$APP_PATH" "$DMG_STAGING/agentic30.app"
ln -s /Applications "$DMG_STAGING/Applications"
hdiutil create -volname agentic30 -srcfolder "$DMG_STAGING" -ov -format UDZO "$DMG_PATH"
codesign --sign "$CODE_SIGN_IDENTITY" --timestamp "$DMG_PATH"
notarize "$DMG_PATH"
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"
log_artifact_size "exported app" "$APP_PATH"
log_artifact_size "signed DMG" "$DMG_PATH"
check_dmg_size_budget "$DMG_PATH"

echo "[9/10] Running Gatekeeper distribution checks..."
spctl -a -vv -t exec "$APP_PATH"
spctl -a -vv -t open --context context:primary-signature "$DMG_PATH"
if command -v syspolicy_check >/dev/null 2>&1; then
  run_syspolicy_distribution_check() {
    local target="$1"
    local output
    local status

    set +e
    output="$(syspolicy_check distribution "$target" 2>&1)"
    status=$?
    set -e

    printf '%s\n' "$output"
    if [ "$status" -eq 0 ]; then
      return 0
    fi
    if printf '%s\n' "$output" | grep -q "Internal Xprotect Error"; then
      echo "WARN: syspolicy_check reported an internal XProtect error for $target; continuing because stapler and spctl checks already accepted this artifact." >&2
      return 0
    fi
    return "$status"
  }

  run_syspolicy_distribution_check "$APP_PATH"
  run_syspolicy_distribution_check "$DMG_PATH"
fi

echo "[10/10] Generating Sparkle appcast staging folder..."
if [ "$AGENTIC30_BUILD_APPCAST" = "1" ]; then
  resolve_generate_appcast_bin
  appcast_dmg="$APPCAST_DIR/agentic30-$bundle_version-${AGENTIC30_BUNDLE_ARCH}.dmg"
  ditto "$DMG_PATH" "$appcast_dmg"
  # Sparkle release notes (what's-new in the update dialog). Default to the
  # newest released CHANGELOG section; fail-soft — a missing/empty notes file
  # just ships a notes-less appcast, never fails the release.
  if [ -z "${SPARKLE_RELEASE_NOTES_PATH:-}" ]; then
    if scripts/changelog-latest-notes.sh CHANGELOG.md > build/sparkle-release-notes.md 2>/dev/null \
      && [ -s build/sparkle-release-notes.md ]; then
      SPARKLE_RELEASE_NOTES_PATH="build/sparkle-release-notes.md"
    fi
  fi
  if [ -n "${SPARKLE_RELEASE_NOTES_PATH:-}" ] && [ -s "$SPARKLE_RELEASE_NOTES_PATH" ]; then
    # generate_appcast matches notes by archive basename with the extension
    # replaced (agentic30-18-arm64.md), NOT appended (….dmg.md).
    cp "$SPARKLE_RELEASE_NOTES_PATH" "${appcast_dmg%.dmg}.md"
  fi
  # --embed-release-notes inlines the .md as <description sparkle:format="markdown">
  # in the signed appcast, so no separate hosted notes file is required.
  generate_appcast_args=(--download-url-prefix "$SPARKLE_DOWNLOAD_URL_PREFIX" --embed-release-notes)
  if [ -n "${SPARKLE_PRIVATE_ED_KEY_BASE64:-}" ]; then
    printf '%s' "$SPARKLE_PRIVATE_ED_KEY_BASE64" | base64 --decode | "$SPARKLE_GENERATE_APPCAST_BIN" --ed-key-file - "${generate_appcast_args[@]}" "$APPCAST_DIR"
  elif [ -n "${SPARKLE_PRIVATE_ED_KEY:-}" ]; then
    printf '%s' "$SPARKLE_PRIVATE_ED_KEY" | "$SPARKLE_GENERATE_APPCAST_BIN" --ed-key-file - "${generate_appcast_args[@]}" "$APPCAST_DIR"
  else
    "$SPARKLE_GENERATE_APPCAST_BIN" --account "$SPARKLE_KEY_ACCOUNT" "${generate_appcast_args[@]}" "$APPCAST_DIR"
  fi
  # generate_appcast names its output after the SUFeedURL filename embedded in
  # the app (appcast.xml for arm64, appcast-x64.xml for x64).
  [ -f "$APPCAST_DIR/$SPARKLE_APPCAST_FILENAME" ] || { echo "ERROR: $SPARKLE_APPCAST_FILENAME was not generated in $APPCAST_DIR" >&2; exit 1; }
  [ -f "$appcast_dmg" ] || { echo "ERROR: appcast DMG missing at $appcast_dmg" >&2; exit 1; }
  if ! grep -Eq "sparkle:version(=|>)[\"']?$bundle_version([\"']|<)" "$APPCAST_DIR/$SPARKLE_APPCAST_FILENAME"; then
    echo "ERROR: $SPARKLE_APPCAST_FILENAME does not reference CFBundleVersion $bundle_version" >&2
    exit 1
  fi
  if [ "$AGENTIC30_UPLOAD_APPCAST_R2" = "1" ]; then
    echo "[10/10] Uploading Sparkle appcast artifacts to Cloudflare R2..."
    SPARKLE_APPCAST_DIR="$APPCAST_DIR" \
      SPARKLE_APPCAST_FILENAME="$SPARKLE_APPCAST_FILENAME" \
      SPARKLE_PUBLIC_BASE_URL="$SPARKLE_PUBLIC_BASE_URL" \
      scripts/upload-sparkle-r2.sh
  fi
else
  echo "[10/10] Skipping appcast (set AGENTIC30_BUILD_APPCAST=1 to enable)."
fi

echo ""
echo "✅ DONE (${AGENTIC30_BUNDLE_ARCH})"
echo "  app: $APP_PATH"
echo "  dmg: $DMG_PATH"
if [ "$AGENTIC30_BUILD_APPCAST" = "1" ]; then
  echo "  appcast: $APPCAST_DIR/$SPARKLE_APPCAST_FILENAME -> $SPARKLE_FEED_URL"
fi

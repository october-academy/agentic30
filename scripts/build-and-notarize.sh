#!/usr/bin/env bash
set -euo pipefail

# Build, sign, notarize, staple, and DMG-pack agentic30.app for Developer ID
# distribution. Manual CI per /plan-eng-review D5 (GHA + fastlane match in W2+).
#
# Required environment (via secrets/build.env, chmod 600):
#   DEVELOPMENT_TEAM      — Apple Developer Team ID (e.g. ABC123XYZ)
#   CODE_SIGN_IDENTITY    — SHA1 hash from `security find-identity -v -p codesigning`
#   INSTALLER_SIGN_IDENTITY — Developer ID Installer identity for productbuild
#   ASC_API_KEY_PATH      — App Store Connect API .p8 path (used for notarytool auth)
#   ASC_KEY_ID            — App Store Connect API Key ID (10 chars)
#   ASC_ISSUER_ID         — App Store Connect API Issuer ID (UUID)
#   SPARKLE_PUBLIC_ED_KEY — public EdDSA key embedded in Info.plist
#   SPARKLE_DOWNLOAD_URL_PREFIX — public URL prefix where appcast DMGs are hosted
#                                (https://updates.agentic30.app/ for release)
# Optional:
#   AGENTIC30_BUNDLE_ARCH     — arm64 or x64 (defaults to current machine arch)
#   AGENTIC30_BUILD_PKG       — 1 to also build/sign/notarize PKG (requires INSTALLER_SIGN_IDENTITY)
#   AGENTIC30_BUILD_APPCAST   — 0 to skip Sparkle appcast generation (defaults to 1)
#   AGENTIC30_UPLOAD_APPCAST_R2 — 1 to upload appcast artifacts to Cloudflare R2 via Wrangler
#   SPARKLE_R2_BUCKET        — Cloudflare R2 bucket (defaults to agentic30-sparkle)
#   SPARKLE_PUBLIC_BASE_URL  — public update URL (defaults to https://updates.agentic30.app/)
#   SPARKLE_UPDATE_DOMAIN    — R2 custom domain (defaults to updates.agentic30.app)
#   SPARKLE_GENERATE_APPCAST_BIN — path to Sparkle's generate_appcast tool
#                                (auto-discovered from Xcode DerivedData if omitted)
#   SPARKLE_KEY_ACCOUNT      — Sparkle keychain account (defaults to agentic30)
#   SPARKLE_PRIVATE_ED_KEY   — private EdDSA key for CI appcast signing
#   SPARKLE_PRIVATE_ED_KEY_BASE64 — base64 private EdDSA key for CI appcast signing
#   SPARKLE_WRANGLER_BIN     — wrangler executable (defaults to wrangler)
#   POSTHOG_PROJECT_API_KEY — PostHog project token embedded for launch telemetry
#   POSTHOG_HOST           — PostHog app/ingest host (defaults to https://us.posthog.com)
# Apple-ID + app-specific password path is unused (notarytool now authenticates
# via ASC API key — same key reused by future fastlane match in W2+).
#
# Output:
#   build/export/agentic30.app — signed + notarized + stapled
#   build/agentic30-$AGENTIC30_BUNDLE_ARCH.dmg — signed + notarized + stapled fallback archive
#   build/agentic30-$AGENTIC30_BUNDLE_ARCH.pkg — optional signed + notarized + stapled installer
#   build/appcast/             — Sparkle appcast staging folder
#
# Manual smoke test (5/11 EOD checkpoint per /plan-eng-review D2):
#   open build/export/agentic30.app
#   spctl --assess --verbose=2 --type execute build/export/agentic30.app
#
# Usage:
#   scripts/build-and-notarize.sh

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
AGENTIC30_BUILD_PKG="${AGENTIC30_BUILD_PKG:-0}"
AGENTIC30_BUILD_APPCAST="${AGENTIC30_BUILD_APPCAST:-1}"
AGENTIC30_UPLOAD_APPCAST_R2="${AGENTIC30_UPLOAD_APPCAST_R2:-0}"
SPARKLE_PUBLIC_BASE_URL="${SPARKLE_PUBLIC_BASE_URL:-https://updates.agentic30.app/}"
SPARKLE_UPDATE_DOMAIN="${SPARKLE_UPDATE_DOMAIN:-updates.agentic30.app}"
SPARKLE_R2_BUCKET="${SPARKLE_R2_BUCKET:-agentic30-sparkle}"
SPARKLE_KEY_ACCOUNT="${SPARKLE_KEY_ACCOUNT:-agentic30}"
SPARKLE_WRANGLER_BIN="${SPARKLE_WRANGLER_BIN:-wrangler}"
case "$SPARKLE_PUBLIC_BASE_URL" in
  */) ;;
  *) SPARKLE_PUBLIC_BASE_URL="${SPARKLE_PUBLIC_BASE_URL}/" ;;
esac
if [ "$AGENTIC30_BUILD_PKG" = "1" ]; then
  required_vars+=(INSTALLER_SIGN_IDENTITY)
fi
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
  if ! command -v "$SPARKLE_WRANGLER_BIN" >/dev/null 2>&1; then
    echo "ERROR: wrangler executable not found: $SPARKLE_WRANGLER_BIN" >&2
    exit 2
  fi
  if ! "$SPARKLE_WRANGLER_BIN" whoami >/dev/null 2>&1; then
    echo "ERROR: wrangler is not authenticated; run 'wrangler login' before enabling R2 upload" >&2
    exit 2
  fi
  if ! "$SPARKLE_WRANGLER_BIN" r2 bucket info "$SPARKLE_R2_BUCKET" >/dev/null 2>&1; then
    echo "ERROR: R2 bucket '$SPARKLE_R2_BUCKET' does not exist or is not accessible; run scripts/setup-sparkle-r2.sh first" >&2
    exit 2
  fi
  if ! "$SPARKLE_WRANGLER_BIN" r2 bucket domain get "$SPARKLE_R2_BUCKET" --domain "$SPARKLE_UPDATE_DOMAIN" >/dev/null 2>&1; then
    echo "ERROR: R2 bucket '$SPARKLE_R2_BUCKET' is not connected to custom domain '$SPARKLE_UPDATE_DOMAIN'; run scripts/setup-sparkle-r2.sh first" >&2
    exit 2
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
    ;;
  x64|x86_64)
    AGENTIC30_BUNDLE_ARCH="x64"
    XCODE_ARCH="x86_64"
    ;;
  *)
    echo "ERROR: AGENTIC30_BUNDLE_ARCH must be arm64 or x64" >&2
    exit 2
    ;;
esac
export AGENTIC30_BUNDLE_ARCH

ARCHIVE_PATH="build/agentic30.xcarchive"
EXPORT_PATH="build/export"
APP_PATH="$EXPORT_PATH/agentic30.app"
DMG_PATH="build/agentic30-${AGENTIC30_BUNDLE_ARCH}.dmg"
DMG_STAGING="build/dmg-staging"
COMPONENT_PKG_PATH="build/agentic30-component.pkg"
PKG_PATH="build/agentic30-${AGENTIC30_BUNDLE_ARCH}.pkg"
APPCAST_DIR="${SPARKLE_APPCAST_DIR:-build/appcast}"
EXPORT_OPTIONS="build/ExportOptions.plist"
ENTITLEMENTS="agentic30/agentic30.entitlements"
ENTITLEMENTS_PATH="$ROOT/$ENTITLEMENTS"

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

mkdir -p build

echo "[1/10] Cleaning previous build artifacts..."
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH" "$DMG_PATH" "$DMG_STAGING" "$COMPONENT_PKG_PATH" "$PKG_PATH" "$EXPORT_OPTIONS"
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
  POSTHOG_PROJECT_API_KEY="$POSTHOG_PROJECT_API_KEY" \
  POSTHOG_HOST="$POSTHOG_HOST"

[ -d "$ARCHIVE_PATH" ] || { echo "ERROR: archive build failed" >&2; exit 1; }

echo "[4/10] Exporting signed .app..."
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

# Bundled sidecar npm packages ship .bin/ symlinks (cmake-js, node-llama-cpp,
# etc.) that point outside the bundle on the build machine. macOS codesign
# --strict rejects bundles containing broken or out-of-bundle symlinks
# ("invalid destination for symbolic link"). Strip them before verification.
# Side effect: tools like node-which become unavailable, but they are dev-time
# helpers that the sidecar runtime does not call.
echo "[4.5/10] Stripping bundled sidecar .bin/ symlinks..."
SIDECAR_BUNDLE="$APP_PATH/Contents/Resources/sidecar"
if [ -d "$SIDECAR_BUNDLE" ]; then
  find "$SIDECAR_BUNDLE" -type d -name '.bin' -prune -exec rm -rf {} + 2>/dev/null || true
  # Re-sign the .app after the bundle mutation so the seal stays consistent.
  codesign --force --sign "$CODE_SIGN_IDENTITY" \
    --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS_PATH" \
    "$APP_PATH"
fi

echo "[5/10] Verifying codesign..."
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

echo "[6/10] Submitting .app to notarytool (this may take 5-30 min)..."
ZIP_PATH="build/agentic30-app.zip"
ditto -c -k --keepParent "$APP_PATH" "$ZIP_PATH"
xcrun notarytool submit "$ZIP_PATH" \
  --key "$ASC_API_KEY_PATH" \
  --key-id "$ASC_KEY_ID" \
  --issuer "$ASC_ISSUER_ID" \
  --wait
rm -f "$ZIP_PATH"

echo "[7/10] Stapling notarization to .app..."
xcrun stapler staple "$APP_PATH"
xcrun stapler validate "$APP_PATH"

echo "[8/10] Creating + signing + notarizing DMG..."
mkdir -p "$DMG_STAGING"
ditto "$APP_PATH" "$DMG_STAGING/agentic30.app"
ln -s /Applications "$DMG_STAGING/Applications"
hdiutil create -volname agentic30 -srcfolder "$DMG_STAGING" -ov -format UDZO "$DMG_PATH"
codesign --sign "$CODE_SIGN_IDENTITY" --timestamp "$DMG_PATH"
xcrun notarytool submit "$DMG_PATH" \
  --key "$ASC_API_KEY_PATH" \
  --key-id "$ASC_KEY_ID" \
  --issuer "$ASC_ISSUER_ID" \
  --wait
xcrun stapler staple "$DMG_PATH"
xcrun stapler validate "$DMG_PATH"

echo "[9/10] Creating + signing + notarizing PKG..."
if [ "$AGENTIC30_BUILD_PKG" = "1" ]; then
  pkgbuild \
    --component "$APP_PATH" \
    --install-location /Applications \
    --identifier october-academy.agentic30 \
    --version "$bundle_version" \
    "$COMPONENT_PKG_PATH"
  productbuild \
    --package "$COMPONENT_PKG_PATH" \
    --sign "$INSTALLER_SIGN_IDENTITY" \
    "$PKG_PATH"
  xcrun notarytool submit "$PKG_PATH" \
    --key "$ASC_API_KEY_PATH" \
    --key-id "$ASC_KEY_ID" \
    --issuer "$ASC_ISSUER_ID" \
    --wait
  xcrun stapler staple "$PKG_PATH"
  xcrun stapler validate "$PKG_PATH"
else
  echo "[9/10] Skipping PKG (set AGENTIC30_BUILD_PKG=1 to enable)."
fi

echo "[9.5/10] Running Gatekeeper distribution checks..."
spctl -a -vv -t exec "$APP_PATH"
spctl -a -vv -t open --context context:primary-signature "$DMG_PATH"
if [ "$AGENTIC30_BUILD_PKG" = "1" ]; then
  spctl -a -vv -t install "$PKG_PATH"
fi
if command -v syspolicy_check >/dev/null 2>&1; then
  syspolicy_check distribution "$APP_PATH"
  syspolicy_check distribution "$DMG_PATH"
  if [ "$AGENTIC30_BUILD_PKG" = "1" ]; then
    syspolicy_check distribution "$PKG_PATH"
  fi
fi

echo "[10/10] Generating Sparkle appcast staging folder..."
if [ "$AGENTIC30_BUILD_APPCAST" = "1" ]; then
  resolve_generate_appcast_bin
  appcast_dmg="$APPCAST_DIR/agentic30-$bundle_version-${AGENTIC30_BUNDLE_ARCH}.dmg"
  ditto "$DMG_PATH" "$appcast_dmg"
  if [ -n "${SPARKLE_RELEASE_NOTES_PATH:-}" ]; then
    cp "$SPARKLE_RELEASE_NOTES_PATH" "${appcast_dmg}.md"
  fi
  generate_appcast_args=()
  if [ -n "${SPARKLE_DOWNLOAD_URL_PREFIX:-}" ]; then
    generate_appcast_args+=(--download-url-prefix "$SPARKLE_DOWNLOAD_URL_PREFIX")
  fi
  if [ -n "${SPARKLE_PRIVATE_ED_KEY_BASE64:-}" ]; then
    printf '%s' "$SPARKLE_PRIVATE_ED_KEY_BASE64" | base64 --decode | "$SPARKLE_GENERATE_APPCAST_BIN" --ed-key-file - "${generate_appcast_args[@]}" "$APPCAST_DIR"
  elif [ -n "${SPARKLE_PRIVATE_ED_KEY:-}" ]; then
    printf '%s' "$SPARKLE_PRIVATE_ED_KEY" | "$SPARKLE_GENERATE_APPCAST_BIN" --ed-key-file - "${generate_appcast_args[@]}" "$APPCAST_DIR"
  else
    "$SPARKLE_GENERATE_APPCAST_BIN" --account "$SPARKLE_KEY_ACCOUNT" "${generate_appcast_args[@]}" "$APPCAST_DIR"
  fi
  [ -f "$APPCAST_DIR/appcast.xml" ] || { echo "ERROR: appcast.xml was not generated in $APPCAST_DIR" >&2; exit 1; }
  [ -f "$appcast_dmg" ] || { echo "ERROR: appcast DMG missing at $appcast_dmg" >&2; exit 1; }
  if ! grep -Eq "sparkle:version(=|>)[\"']?$bundle_version([\"']|<)" "$APPCAST_DIR/appcast.xml"; then
    echo "ERROR: appcast.xml does not reference CFBundleVersion $bundle_version" >&2
    exit 1
  fi
  if [ "$AGENTIC30_UPLOAD_APPCAST_R2" = "1" ]; then
    echo "[10.5/10] Uploading Sparkle appcast artifacts to Cloudflare R2..."
    SPARKLE_APPCAST_DIR="$APPCAST_DIR" \
      SPARKLE_PUBLIC_BASE_URL="$SPARKLE_PUBLIC_BASE_URL" \
      scripts/upload-sparkle-r2.sh
  fi
else
  echo "[10/10] Skipping appcast (set AGENTIC30_BUILD_APPCAST=1 to enable)."
fi

echo ""
echo "✅ DONE"
echo "  app:  $APP_PATH"
echo "  dmg:  $DMG_PATH"
if [ "$AGENTIC30_BUILD_PKG" = "1" ]; then
  echo "  pkg:  $PKG_PATH"
fi
if [ "$AGENTIC30_BUILD_APPCAST" = "1" ]; then
  echo "  appcast: $APPCAST_DIR"
  echo "  upload: $APPCAST_DIR/appcast.xml -> ${SPARKLE_PUBLIC_BASE_URL}appcast.xml"
  echo "  upload: $APPCAST_DIR/agentic30-$bundle_version-${AGENTIC30_BUNDLE_ARCH}.dmg -> ${SPARKLE_PUBLIC_BASE_URL}agentic30-$bundle_version-${AGENTIC30_BUNDLE_ARCH}.dmg"
  if [ -n "${SPARKLE_RELEASE_NOTES_PATH:-}" ]; then
    echo "  upload: $APPCAST_DIR/agentic30-$bundle_version-${AGENTIC30_BUNDLE_ARCH}.dmg.md -> ${SPARKLE_PUBLIC_BASE_URL}agentic30-$bundle_version-${AGENTIC30_BUNDLE_ARCH}.dmg.md"
  fi
  if [ "$AGENTIC30_UPLOAD_APPCAST_R2" = "1" ]; then
    echo "  r2: uploaded to ${SPARKLE_R2_BUCKET:-agentic30-sparkle}"
  fi
fi
echo ""
echo "Smoke tests:"
echo "  open $APP_PATH"
echo "  spctl --assess --verbose=2 --type execute $APP_PATH"
echo "  spctl --assess --verbose=2 --type open --context context:primary-signature $DMG_PATH"
if [ "$AGENTIC30_BUILD_PKG" = "1" ]; then
  echo "  spctl --assess --verbose=2 --type install $PKG_PATH"
fi
echo ""
echo "Upload to GitHub Releases (5/12 launch):"
if [ "$AGENTIC30_BUILD_PKG" = "1" ]; then
  echo "  gh release create v\$(date +%Y%m%d-%H%M) $PKG_PATH $DMG_PATH \\"
else
  echo "  gh release create v\$(date +%Y%m%d-%H%M) $DMG_PATH \\"
fi
echo "    --title \"agentic30 preview\" --notes-file CHANGELOG.md"

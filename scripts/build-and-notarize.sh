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
#   SPARKLE_GENERATE_APPCAST_BIN — path to Sparkle's generate_appcast tool
# Apple-ID + app-specific password path is unused (notarytool now authenticates
# via ASC API key — same key reused by future fastlane match in W2+).
#
# Output:
#   build/export/agentic30.app — signed + notarized + stapled
#   build/agentic30.dmg        — signed + notarized + stapled fallback archive
#   build/agentic30.pkg        — signed + notarized + stapled primary installer
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
  INSTALLER_SIGN_IDENTITY
  ASC_API_KEY_PATH
  ASC_KEY_ID
  ASC_ISSUER_ID
  SPARKLE_PUBLIC_ED_KEY
  SPARKLE_GENERATE_APPCAST_BIN
)
missing=0
for var in "${required_vars[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: \$$var not set" >&2
    missing=1
  fi
done
[ "$missing" = "1" ] && exit 2

ARCHIVE_PATH="build/agentic30.xcarchive"
EXPORT_PATH="build/export"
APP_PATH="$EXPORT_PATH/agentic30.app"
DMG_PATH="build/agentic30.dmg"
DMG_STAGING="build/dmg-staging"
COMPONENT_PKG_PATH="build/agentic30-component.pkg"
PKG_PATH="build/agentic30.pkg"
APPCAST_DIR="${SPARKLE_APPCAST_DIR:-build/appcast}"
EXPORT_OPTIONS="build/ExportOptions.plist"
ENTITLEMENTS="agentic30/agentic30.entitlements"

mkdir -p build

echo "[1/10] Cleaning previous build artifacts..."
rm -rf "$ARCHIVE_PATH" "$EXPORT_PATH" "$DMG_PATH" "$DMG_STAGING" "$COMPONENT_PKG_PATH" "$PKG_PATH" "$EXPORT_OPTIONS"
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

echo "[3/10] xcodebuild archive (Hardened Runtime + entitlements)..."
xcodebuild archive \
  -project agentic30.xcodeproj \
  -scheme agentic30 \
  -configuration Release \
  -archivePath "$ARCHIVE_PATH" \
  -destination 'generic/platform=macOS' \
  ENABLE_HARDENED_RUNTIME=YES \
  CODE_SIGN_ENTITLEMENTS="$ENTITLEMENTS" \
  CODE_SIGN_IDENTITY="$CODE_SIGN_IDENTITY" \
  CODE_SIGN_STYLE=Manual \
  DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
  SPARKLE_PUBLIC_ED_KEY="$SPARKLE_PUBLIC_ED_KEY"

[ -d "$ARCHIVE_PATH" ] || { echo "ERROR: archive build failed" >&2; exit 1; }

echo "[4/10] Exporting signed .app..."
xcodebuild -exportArchive \
  -archivePath "$ARCHIVE_PATH" \
  -exportPath "$EXPORT_PATH" \
  -exportOptionsPlist "$EXPORT_OPTIONS"

[ -d "$APP_PATH" ] || { echo "ERROR: export failed; .app not at $APP_PATH" >&2; exit 1; }

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
    --entitlements "$ENTITLEMENTS" \
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

echo "[9.5/10] Running Gatekeeper distribution checks..."
spctl -a -vv -t exec "$APP_PATH"
spctl -a -vv -t open --context context:primary-signature "$DMG_PATH"
spctl -a -vv -t install "$PKG_PATH"
if command -v syspolicy_check >/dev/null 2>&1; then
  syspolicy_check distribution "$APP_PATH"
  syspolicy_check distribution "$DMG_PATH"
  syspolicy_check distribution "$PKG_PATH"
fi

echo "[10/10] Generating Sparkle appcast staging folder..."
appcast_dmg="$APPCAST_DIR/agentic30-$bundle_version.dmg"
ditto "$DMG_PATH" "$appcast_dmg"
if [ -n "${SPARKLE_RELEASE_NOTES_PATH:-}" ]; then
  cp "$SPARKLE_RELEASE_NOTES_PATH" "${appcast_dmg}.md"
fi
generate_appcast_args=()
if [ -n "${SPARKLE_DOWNLOAD_URL_PREFIX:-}" ]; then
  generate_appcast_args+=(--download-url-prefix "$SPARKLE_DOWNLOAD_URL_PREFIX")
fi
"$SPARKLE_GENERATE_APPCAST_BIN" "${generate_appcast_args[@]}" "$APPCAST_DIR"

echo ""
echo "✅ DONE"
echo "  app:  $APP_PATH"
echo "  dmg:  $DMG_PATH"
echo "  pkg:  $PKG_PATH"
echo "  appcast: $APPCAST_DIR"
echo ""
echo "Smoke tests:"
echo "  open $APP_PATH"
echo "  spctl --assess --verbose=2 --type execute $APP_PATH"
echo "  spctl --assess --verbose=2 --type open --context context:primary-signature $DMG_PATH"
echo "  spctl --assess --verbose=2 --type install $PKG_PATH"
echo ""
echo "Upload to GitHub Releases (5/12 launch):"
echo "  gh release create v\$(date +%Y%m%d-%H%M) $PKG_PATH $DMG_PATH \\"
echo "    --title \"agentic30 preview\" --notes-file CHANGELOG.md"

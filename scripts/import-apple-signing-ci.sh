#!/usr/bin/env bash
set -euo pipefail

# Import Developer ID signing identities into a temporary CI keychain.
#
# Required environment:
#   MACOS_KEYCHAIN_PASSWORD
#   DEVELOPER_ID_APPLICATION_P12_BASE64
#   DEVELOPER_ID_APPLICATION_P12_PASSWORD
#
# Optional environment:
#   DEVELOPER_ID_INSTALLER_P12_BASE64
#   DEVELOPER_ID_INSTALLER_P12_PASSWORD
#   MACOS_KEYCHAIN_NAME          — defaults to agentic30-ci.keychain-db

KEYCHAIN_NAME="${MACOS_KEYCHAIN_NAME:-agentic30-ci.keychain-db}"
KEYCHAIN_PATH="$RUNNER_TEMP/$KEYCHAIN_NAME"

required=(
  MACOS_KEYCHAIN_PASSWORD
  DEVELOPER_ID_APPLICATION_P12_BASE64
  DEVELOPER_ID_APPLICATION_P12_PASSWORD
)
missing=0
for var in "${required[@]}"; do
  if [ -z "${!var:-}" ]; then
    echo "ERROR: $var is required" >&2
    missing=1
  fi
done
[ "$missing" = "1" ] && exit 2

mkdir -p "$RUNNER_TEMP"
app_p12="$RUNNER_TEMP/developer-id-application.p12"
printf '%s' "$DEVELOPER_ID_APPLICATION_P12_BASE64" | base64 --decode > "$app_p12"

security create-keychain -p "$MACOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security set-keychain-settings -lut 21600 "$KEYCHAIN_PATH"
security unlock-keychain -p "$MACOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"
security import "$app_p12" -P "$DEVELOPER_ID_APPLICATION_P12_PASSWORD" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"

if [ -n "${DEVELOPER_ID_INSTALLER_P12_BASE64:-}" ]; then
  installer_p12="$RUNNER_TEMP/developer-id-installer.p12"
  printf '%s' "$DEVELOPER_ID_INSTALLER_P12_BASE64" | base64 --decode > "$installer_p12"
  security import "$installer_p12" -P "${DEVELOPER_ID_INSTALLER_P12_PASSWORD:-}" -A -t cert -f pkcs12 -k "$KEYCHAIN_PATH"
fi

security list-keychains -d user -s "$KEYCHAIN_PATH"
security default-keychain -s "$KEYCHAIN_PATH"
security set-key-partition-list -S apple-tool:,apple:,codesign: -s -k "$MACOS_KEYCHAIN_PASSWORD" "$KEYCHAIN_PATH"

app_identity="$(security find-identity -v -p codesigning "$KEYCHAIN_PATH" | awk -F'[ \"]+' '/Developer ID Application/ {print $3; exit}')"
installer_identity="$(security find-identity -v -p basic "$KEYCHAIN_PATH" | awk -F'\"' '/Developer ID Installer/ {print $2; exit}')"

if [ -z "$app_identity" ]; then
  echo "ERROR: Developer ID Application identity was not imported" >&2
  exit 1
fi

echo "CODE_SIGN_IDENTITY=$app_identity" >> "$GITHUB_ENV"
if [ -n "$installer_identity" ]; then
  echo "INSTALLER_SIGN_IDENTITY=$installer_identity" >> "$GITHUB_ENV"
fi

echo "Imported Developer ID Application identity: $app_identity"
if [ -n "$installer_identity" ]; then
  echo "Imported Developer ID Installer identity: $installer_identity"
fi

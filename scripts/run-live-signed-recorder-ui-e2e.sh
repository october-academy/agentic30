#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

default_app_path="$ROOT/build/live-signed-e2e/DerivedData/Build/Products/Release/agentic30.app"
APP_PATH="${AGENTIC30_LIVE_SIGNED_APP_PATH:-$default_app_path}"
INSTALLED_APP="/Applications/agentic30.app"
ENTITLEMENTS_PATH="$ROOT/agentic30/agentic30.entitlements"
LIVE_SIGNED_PRESERVE_ARTIFACTS="${AGENTIC30_LIVE_SIGNED_PRESERVE_ARTIFACTS:-1}"
LIVE_SIGNED_PREPARE_RUNNER_ONLY="${AGENTIC30_LIVE_SIGNED_PREPARE_RUNNER_ONLY:-0}"
LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH="${AGENTIC30_LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH:-$ROOT/build/ui-e2e/live-signed-runner-derived-data}"

plist_value() {
  local plist="$1"
  local key="$2"
  /usr/libexec/PlistBuddy -c "Print :$key" "$plist" 2>/dev/null || true
}

require_equal() {
  local label="$1"
  local actual="$2"
  local expected="$3"
  if [ "$actual" != "$expected" ]; then
    echo "ERROR: $label must be $expected (got $actual)" >&2
    exit 2
  fi
}

require_concrete_value() {
  local label="$1"
  local actual="$2"
  local placeholder="\$("
  if [ -z "$actual" ] || [[ "$actual" == *"$placeholder"* ]]; then
    echo "ERROR: $label must be a concrete value (got $actual)" >&2
    exit 2
  fi
}

developer_id_identity_line() {
  security find-identity -v -p codesigning 2>/dev/null | grep 'Developer ID Application' | head -1 || true
}

expected_team_identifier() {
  if [ -n "${DEVELOPMENT_TEAM:-}" ]; then
    printf '%s\n' "$DEVELOPMENT_TEAM"
    return 0
  fi
  local identity_line
  identity_line="$(developer_id_identity_line)"
  printf '%s\n' "$identity_line" | sed -nE 's/.*\(([A-Z0-9]+)\).*/\1/p'
}

require_unlocked_display_for_live_ui() {
  if [ "${AGENTIC30_LIVE_SIGNED_BUILD_ONLY:-0}" = "1" ] \
    || [ "$LIVE_SIGNED_PREPARE_RUNNER_ONLY" = "1" ] \
    || [ "${AGENTIC30_LIVE_SIGNED_SKIP_SCREEN_LOCK_CHECK:-0}" = "1" ]; then
    return 0
  fi

  local console_state
  console_state="$(/usr/sbin/ioreg -n Root -d1 2>/dev/null || true)"
  if /usr/bin/grep -q 'CGSSessionScreenIsLocked.*Yes' <<<"$console_state"; then
    cat >&2 <<'EOF'
ERROR: live signed recorder UI E2E requires an unlocked macOS GUI session.

The macOS session is locked/loginwindow-shielded. Unlock the Mac and rerun the
workflow so ScreenCaptureKit and XCUITest can exercise the signed app surface.
EOF
    exit 3
  fi
}

live_signed_app_path_marker() {
  local uid
  uid="$(/usr/bin/id -u)"
  printf '/tmp/agentic30-live-signed-recorder-ui-e2e-app-path-%s.txt\n' "$uid"
}

require_unlocked_display_for_live_ui

if [ "${AGENTIC30_LIVE_SIGNED_SKIP_BUILD:-0}" != "1" ]; then
  identity_line="$(developer_id_identity_line)"
  if [ -z "${CODE_SIGN_IDENTITY:-}" ]; then
    CODE_SIGN_IDENTITY="$(printf '%s\n' "$identity_line" | awk '{print $2}')"
  fi
  if [ -z "${DEVELOPMENT_TEAM:-}" ]; then
    DEVELOPMENT_TEAM="$(printf '%s\n' "$identity_line" | sed -nE 's/.*\(([A-Z0-9]+)\).*/\1/p')"
  fi
  if [ -z "${CODE_SIGN_IDENTITY:-}" ] || [ -z "${DEVELOPMENT_TEAM:-}" ]; then
    echo "ERROR: Developer ID Application signing identity not found. Set CODE_SIGN_IDENTITY and DEVELOPMENT_TEAM." >&2
    exit 2
  fi

  if [ -z "${SPARKLE_PUBLIC_ED_KEY:-}" ] && [ -d "$INSTALLED_APP" ]; then
    SPARKLE_PUBLIC_ED_KEY="$(plist_value "$INSTALLED_APP/Contents/Info.plist" "SUPublicEDKey")"
  fi
  if [ -z "${SPARKLE_FEED_URL:-}" ] && [ -d "$INSTALLED_APP" ]; then
    SPARKLE_FEED_URL="$(plist_value "$INSTALLED_APP/Contents/Info.plist" "SUFeedURL")"
  fi
  if [ -z "${POSTHOG_PROJECT_API_KEY:-}" ] && [ -d "$INSTALLED_APP" ]; then
    POSTHOG_PROJECT_API_KEY="$(plist_value "$INSTALLED_APP/Contents/Info.plist" "Agentic30PostHogProjectAPIKey")"
  fi

  SPARKLE_FEED_URL="${SPARKLE_FEED_URL:-https://updates.agentic30.app/appcast.xml}"
  POSTHOG_HOST="${POSTHOG_HOST:-https://us.posthog.com}"
  if [ -z "${SPARKLE_PUBLIC_ED_KEY:-}" ]; then
    echo "ERROR: SPARKLE_PUBLIC_ED_KEY is required. Install a prior release or export the public key." >&2
    exit 2
  fi
  if [ -z "${POSTHOG_PROJECT_API_KEY:-}" ] || [[ "$POSTHOG_PROJECT_API_KEY" != phc_* ]]; then
    echo "ERROR: POSTHOG_PROJECT_API_KEY must be set to a PostHog project token starting with phc_." >&2
    exit 2
  fi

  rm -rf "$ROOT/build/live-signed-e2e"
  xcodebuild build \
    -project agentic30.xcodeproj \
    -scheme agentic30 \
    -configuration Release \
    -destination 'generic/platform=macOS' \
    -derivedDataPath "$ROOT/build/live-signed-e2e/DerivedData" \
    -quiet \
    ARCHS=arm64 \
    ONLY_ACTIVE_ARCH=NO \
    ENABLE_HARDENED_RUNTIME=YES \
    CODE_SIGN_ENTITLEMENTS="$ENTITLEMENTS_PATH" \
    CODE_SIGN_IDENTITY="$CODE_SIGN_IDENTITY" \
    CODE_SIGN_STYLE=Manual \
    DEVELOPMENT_TEAM="$DEVELOPMENT_TEAM" \
    SWIFT_ACTIVE_COMPILATION_CONDITIONS=AGENTIC30_LIVE_SIGNED_UI_E2E \
    SPARKLE_PUBLIC_ED_KEY="$SPARKLE_PUBLIC_ED_KEY" \
    SPARKLE_FEED_URL="$SPARKLE_FEED_URL" \
    AGENTIC30_EXTERNAL_PERMISSION_ONBOARDING_ALLOWED=1 \
    AGENTIC30_LIVE_SIGNED_UI_E2E_ALLOWED=1 \
    POSTHOG_PROJECT_API_KEY="$POSTHOG_PROJECT_API_KEY" \
    POSTHOG_HOST="$POSTHOG_HOST"

  APP_PATH="$default_app_path"
  sidecar_bundle="$APP_PATH/Contents/Resources/sidecar"
  if [ -d "$sidecar_bundle" ]; then
    find "$sidecar_bundle" -type d -name '.bin' -prune -exec rm -rf {} + 2>/dev/null || true
  fi
  codesign --force --sign "$CODE_SIGN_IDENTITY" \
    --options runtime --timestamp \
    --entitlements "$ENTITLEMENTS_PATH" \
    "$APP_PATH"
fi

if [ ! -d "$APP_PATH" ]; then
  echo "ERROR: signed app not found at $APP_PATH" >&2
  exit 2
fi

codesign --verify --deep --strict --verbose=2 "$APP_PATH"
codesign_details="$(codesign --display --verbose=4 "$APP_PATH" 2>&1)"
actual_team="$(printf '%s\n' "$codesign_details" | sed -nE 's/^TeamIdentifier=(.*)$/\1/p' | head -1)"
expected_team="$(expected_team_identifier)"
authority="$(printf '%s\n' "$codesign_details" | sed -nE 's/^Authority=(.*)$/\1/p' | head -1)"
runtime_version="$(printf '%s\n' "$codesign_details" | sed -nE 's/^Runtime Version=(.*)$/\1/p' | head -1)"
permission_flag="$(plist_value "$APP_PATH/Contents/Info.plist" "Agentic30ExternalPermissionOnboardingAllowed")"
live_e2e_flag="$(plist_value "$APP_PATH/Contents/Info.plist" "Agentic30LiveSignedUIE2EAllowed")"
sparkle_key="$(plist_value "$APP_PATH/Contents/Info.plist" "SUPublicEDKey")"
sparkle_feed="$(plist_value "$APP_PATH/Contents/Info.plist" "SUFeedURL")"
bundle_id="$(plist_value "$APP_PATH/Contents/Info.plist" "CFBundleIdentifier")"
permission_actor_bundle_id="$(plist_value "$APP_PATH/Contents/Info.plist" "Agentic30ExpectedPermissionActorBundleIdentifier")"

require_equal "CFBundleIdentifier" "$bundle_id" "october-academy.agentic30"
require_equal "permission actor bundle id" "$permission_actor_bundle_id" "$bundle_id"
require_equal "Developer ID authority" "$authority" "Developer ID Application: 호균 유 (77S8MPV96M)"
require_concrete_value "expected Team ID" "$expected_team"
require_equal "TeamIdentifier" "$actual_team" "$expected_team"
require_concrete_value "Hardened Runtime" "$runtime_version"
require_equal "Agentic30ExternalPermissionOnboardingAllowed" "$permission_flag" "1"
require_equal "Agentic30LiveSignedUIE2EAllowed" "$live_e2e_flag" "1"
require_concrete_value "SUPublicEDKey" "$sparkle_key"
require_concrete_value "SUFeedURL" "$sparkle_feed"

echo "Live signed app: $APP_PATH"
echo "Version: $(plist_value "$APP_PATH/Contents/Info.plist" "CFBundleShortVersionString") ($(plist_value "$APP_PATH/Contents/Info.plist" "CFBundleVersion"))"
echo "Team ID: $actual_team"
echo "Hardened Runtime: $runtime_version"
echo "Permission onboarding flag: $permission_flag"
echo "Live signed UI E2E flag: $live_e2e_flag"
echo "Preserve live signed UI E2E artifacts: $LIVE_SIGNED_PRESERVE_ARTIFACTS"
echo "Prepare runner only: $LIVE_SIGNED_PREPARE_RUNNER_ONLY"
echo "UI runner DerivedData path: $LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH"
echo "Live signed UI E2E evidence roots: $HOME/Library/Containers/october-academy.agentic30UITests.xctrunner/Data/Library/Caches/agentic30-ui-test-live-signed-{preflight,capture,audio}/<run-id>"
echo "Core verifier JSON: live-recorder-frame-search-verifier.json"

if [ "${AGENTIC30_LIVE_SIGNED_BUILD_ONLY:-0}" = "1" ]; then
  exit 0
fi

echo "Preparing stable XCUITest runner identity for Accessibility grant..."
AGENTIC30_DERIVED_DATA_PATH="$LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH" \
AGENTIC30_UI_E2E_REUSE_RUNNER=1 \
  bash scripts/xcode-test.sh ui-prepare-runner
cat <<'EOF'
If the next preflight reports runner_accessibility_blocked, grant Accessibility
to the "UI test runner Accessibility target" path printed above, then rerun this
workflow without rebuilding the runner.
EOF

if [ "$LIVE_SIGNED_PREPARE_RUNNER_ONLY" = "1" ]; then
  exit 0
fi

path_marker="$(live_signed_app_path_marker)"
printf '%s\n' "$APP_PATH" >"$path_marker"
cleanup_live_signed_app_path_marker() {
  rm -f "$path_marker"
}
trap cleanup_live_signed_app_path_marker EXIT

AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 \
AGENTIC30_DERIVED_DATA_PATH="$LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH" \
AGENTIC30_LIVE_SIGNED_APP_PATH="$APP_PATH" \
AGENTIC30_LIVE_SIGNED_PRESERVE_ARTIFACTS="$LIVE_SIGNED_PRESERVE_ARTIFACTS" \
AGENTIC30_UI_E2E_REUSE_RUNNER=1 \
  bash scripts/xcode-test.sh ui-full \
    '-only-testing:agentic30UITests/agentic30UITests/testFounderReplayLiveSignedAppRunnerAccessibilityPreflight'

AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 \
AGENTIC30_DERIVED_DATA_PATH="$LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH" \
AGENTIC30_LIVE_SIGNED_APP_PATH="$APP_PATH" \
AGENTIC30_LIVE_SIGNED_PRESERVE_ARTIFACTS="$LIVE_SIGNED_PRESERVE_ARTIFACTS" \
AGENTIC30_UI_E2E_REUSE_RUNNER=1 \
  bash scripts/xcode-test.sh ui-full \
    '-only-testing:agentic30UITests/agentic30UITests/testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted'

AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 \
AGENTIC30_DERIVED_DATA_PATH="$LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH" \
AGENTIC30_LIVE_SIGNED_APP_PATH="$APP_PATH" \
AGENTIC30_LIVE_SIGNED_PRESERVE_ARTIFACTS="$LIVE_SIGNED_PRESERVE_ARTIFACTS" \
AGENTIC30_UI_E2E_REUSE_RUNNER=1 \
  bash scripts/xcode-test.sh ui-full \
    '-only-testing:agentic30UITests/agentic30UITests/testFounderReplayLiveSignedAppSensitiveAudioRunsWhenTccGranted'

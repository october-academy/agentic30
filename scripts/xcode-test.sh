#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/xcode-test.sh <unit|ui-smoke|ui-full|ui-prepare-runner> [xcodebuild args...]

Modes:
  unit              Run Swift unit tests only. Does not run the XCUITest target.
  ui-smoke          Run the approved hermetic UI smoke subset.
  ui-full           Run the full agentic30UITests scheme.
  ui-prepare-runner Build and re-sign the XCUITest runner without launching UI.

Local UI modes launch Agentic30 in the foreground and can take keyboard,
mouse, and focus. They require AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 unless
running in CI/GitHub Actions.

Local UI modes default to re-signing the built XCUITest runner with
com.apple.security.network.server before test-without-building. The runner
launches Agentic30 directly, and the child sidecar needs loopback listen rights.
Set AGENTIC30_UI_E2E_RESIGN_NETWORK_SERVER=0 to disable this local adjustment.
EOF
}

mode="${1:-}"
if [[ -z "$mode" ]]; then
  usage
  exit 64
fi
shift

repo_root="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$repo_root"

xcodebuild_bin="${XCODEBUILD:-xcodebuild}"
project="${AGENTIC30_XCODE_PROJECT:-agentic30.xcodeproj}"
destination="${AGENTIC30_XCODE_DESTINATION:-platform=macOS}"

base_xcode_args=(
  -project "$project"
  -destination "$destination"
)
if [[ -n "${AGENTIC30_DERIVED_DATA_PATH:-}" ]]; then
  base_xcode_args+=(-derivedDataPath "$AGENTIC30_DERIVED_DATA_PATH")
fi

is_ci() {
  [[ "${CI:-}" == "true" || "${GITHUB_ACTIONS:-}" == "true" ]]
}

require_blocking_ui_approval() {
  local npm_script="$1"

  if [[ "${AGENTIC30_ALLOW_BLOCKING_UI_E2E:-}" == "1" ]] || is_ci; then
    return 0
  fi

  cat >&2 <<EOF
Refusing to run local blocking UI E2E without explicit approval.

This command launches the Agentic30 app in the foreground and may take
keyboard, mouse, and focus. Agents must ask the user before running it:

  "이 명령은 Agentic30 앱을 전면으로 띄우고 키보드/마우스/포커스를 점유할 수 있습니다. 지금 실행할까요?"

After approval, rerun with:

  AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 npm run ${npm_script}

Use test:swift:unit for non-blocking local Swift coverage.
EOF
  exit 2
}

require_unlocked_display_for_ui() {
  if is_ci; then
    return 0
  fi

  local console_state
  console_state="$(/usr/sbin/ioreg -n Root -d1 2>/dev/null || true)"
  if /usr/bin/grep -q 'CGSSessionScreenIsLocked.*Yes' <<<"$console_state"; then
    cat >&2 <<'EOF'
Refusing to run local blocking UI E2E while the macOS screen is locked.

XCUITest can still read parts of the accessibility tree behind the loginwindow
shield, but the Agentic30 window is disabled and controls are not reliably
hittable. Unlock the Mac and rerun the UI E2E command.
EOF
    exit 3
  fi
}

run_ui_xcodebuild() {
  if is_ci || [[ "${AGENTIC30_DISABLE_UI_E2E_CAFFEINATE:-}" == "1" ]]; then
    "$xcodebuild_bin" "$@"
    return
  fi

  /usr/bin/caffeinate -dimsu "$xcodebuild_bin" "$@"
}

should_resign_ui_runner_for_network_server() {
  case "${AGENTIC30_UI_E2E_RESIGN_NETWORK_SERVER:-auto}" in
    0|false|FALSE|no|NO)
      return 1
      ;;
    1|true|TRUE|yes|YES)
      return 0
      ;;
    auto|"")
      ! is_ci
      ;;
    *)
      echo "Unknown AGENTIC30_UI_E2E_RESIGN_NETWORK_SERVER value: ${AGENTIC30_UI_E2E_RESIGN_NETWORK_SERVER}" >&2
      exit 64
      ;;
  esac
}

# Reuse an already-built XCUITest runner instead of rebuilding it before each
# run. The ad-hoc network.server re-sign is deterministic, so reusing the same
# runner binary keeps the runner cdhash stable across runs — which lets a
# one-time Accessibility grant (System Settings) survive. Rebuilding churns the
# cdhash and invalidates the grant, so the live-signed capture E2E (which
# observes a Developer-ID + hardened-runtime app) opts into reuse.
should_reuse_existing_ui_runner() {
  case "${AGENTIC30_UI_E2E_REUSE_RUNNER:-0}" in
    1|true|TRUE|yes|YES)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

ui_test_runner_app_marker() {
  printf '%s\n' "$repo_root/build/ui-e2e/agentic30-ui-test-runner-app.txt"
}

read_marked_ui_test_runner_app() {
  local marker
  local runner_app
  marker="$(ui_test_runner_app_marker)"
  [[ -f "$marker" ]] || return 1
  runner_app="$(/bin/cat "$marker" 2>/dev/null || true)"
  runner_app="${runner_app//$'\n'/}"
  [[ -n "$runner_app" ]] || return 1
  printf '%s\n' "$runner_app"
}

runner_app_is_valid() {
  local runner_app="$1"
  local runner_bundle_id
  local built_app
  local built_app_bundle_id
  [[ -d "$runner_app" ]] || return 1
  runner_bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$runner_app/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$runner_bundle_id" == "october-academy.agentic30UITests.xctrunner" ]] || return 1
  built_app="$(dirname "$runner_app")/agentic30.app"
  [[ -d "$built_app" ]] || return 1
  built_app_bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$built_app/Contents/Info.plist" 2>/dev/null || true)"
  [[ "$built_app_bundle_id" == "october-academy.agentic30" ]] || return 1
}

derived_data_search_root() {
  local search_root="${AGENTIC30_DERIVED_DATA_PATH:-$HOME/Library/Developer/Xcode/DerivedData}"
  search_root="${search_root%/}"
  printf '%s\n' "$search_root"
}

runner_app_is_under_search_root() {
  local runner_app="$1"
  local search_root
  search_root="$(derived_data_search_root)"
  [[ -n "$search_root" ]] || return 1
  case "$runner_app" in
    "$search_root"/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

marked_ui_test_runner_app() {
  local runner_app
  runner_app="$(read_marked_ui_test_runner_app)" || return 1
  runner_app_is_valid "$runner_app" || return 1
  runner_app_is_under_search_root "$runner_app" || return 1
  printf '%s\n' "$runner_app"
}

print_marked_ui_test_runner_rejection() {
  local marker
  local runner_app
  local search_root
  marker="$(ui_test_runner_app_marker)"
  search_root="$(derived_data_search_root)"

  if [[ ! -f "$marker" ]]; then
    echo "No marked UI test runner exists yet at $marker" >&2
    return 0
  fi

  runner_app="$(read_marked_ui_test_runner_app || true)"
  if [[ -z "$runner_app" ]]; then
    echo "Marked UI test runner marker is empty: $marker" >&2
    return 0
  fi

  if [[ ! -d "$runner_app" ]]; then
    echo "Marked UI test runner no longer exists: $runner_app (marker: $marker)" >&2
    return 0
  fi

  if ! runner_app_is_valid "$runner_app"; then
    echo "Marked UI test runner is not a valid Agentic30 runner: $runner_app (marker: $marker)" >&2
    return 0
  fi

  if ! runner_app_is_under_search_root "$runner_app"; then
    echo "Marked UI test runner is outside the selected DerivedData search root and will not be reused." >&2
    echo "Marked UI test runner: $runner_app" >&2
    echo "Selected DerivedData search root: $search_root" >&2
    echo "Marker: $marker" >&2
    return 0
  fi

  echo "Marked UI test runner was rejected for an unknown reason: $runner_app (marker: $marker)" >&2
}

remember_ui_test_runner_app() {
  local runner_app="$1"
  local marker
  runner_app_is_valid "$runner_app" || return 1
  marker="$(ui_test_runner_app_marker)"
  /bin/mkdir -p "$(dirname "$marker")"
  printf '%s\n' "$runner_app" >"$marker"
}

latest_ui_test_runner_app() {
  if [[ -n "${AGENTIC30_UI_TEST_RUNNER_APP:-}" ]]; then
    if runner_app_is_valid "${AGENTIC30_UI_TEST_RUNNER_APP}"; then
      if [[ -n "${AGENTIC30_DERIVED_DATA_PATH:-}" ]] \
        && ! runner_app_is_under_search_root "${AGENTIC30_UI_TEST_RUNNER_APP}"; then
        echo "AGENTIC30_UI_TEST_RUNNER_APP is outside AGENTIC30_DERIVED_DATA_PATH, so xcodebuild test-without-building may use a different runner: ${AGENTIC30_UI_TEST_RUNNER_APP}" >&2
        return 1
      fi
      printf '%s\n' "${AGENTIC30_UI_TEST_RUNNER_APP}"
      return 0
    fi
    echo "AGENTIC30_UI_TEST_RUNNER_APP is not a valid Agentic30 UI test runner: ${AGENTIC30_UI_TEST_RUNNER_APP}" >&2
    return 1
  fi

  if should_reuse_existing_ui_runner; then
    local marked_runner_app
    if marked_runner_app="$(marked_ui_test_runner_app)"; then
      printf '%s\n' "$marked_runner_app"
      return 0
    fi
    print_marked_ui_test_runner_rejection
  fi

  local search_root
  search_root="$(derived_data_search_root)"
  if [[ ! -d "$search_root" ]]; then
    echo "DerivedData search root does not exist: $search_root" >&2
    return 1
  fi

  local newest_path=""
  local newest_mtime=0
  local path
  local mtime
  while IFS= read -r -d '' path; do
    if ! runner_app_is_valid "$path"; then
      continue
    fi
    mtime="$(/usr/bin/stat -f '%m' "$path" 2>/dev/null || printf '0')"
    if (( mtime > newest_mtime )); then
      newest_mtime="$mtime"
      newest_path="$path"
    fi
  done < <(/usr/bin/find "$search_root" \
    -path '*/Build/Products/*/agentic30UITests-Runner.app' \
    ! -path '*/Index.noindex/*' \
    -type d \
    -print0 2>/dev/null)

  if [[ -z "$newest_path" ]]; then
    echo "Could not locate agentic30UITests-Runner.app under $search_root" >&2
    return 1
  fi
  remember_ui_test_runner_app "$newest_path"
  printf '%s\n' "$newest_path"
}

resign_ui_test_runner_for_network_server() {
  local runner_app
  runner_app="$(latest_ui_test_runner_app)"
  if [[ -z "$runner_app" ]]; then
    return 1
  fi

  local entitlements_plist
  entitlements_plist="$(/usr/bin/mktemp "${TMPDIR:-/tmp}/agentic30-ui-runner-entitlements.XXXXXX")"

  if ! /usr/bin/codesign -d --entitlements :- "$runner_app" >"$entitlements_plist" 2>/dev/null \
    || ! /usr/bin/plutil -lint "$entitlements_plist" >/dev/null 2>&1; then
    cat >"$entitlements_plist" <<'PLIST'
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "https://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict/>
</plist>
PLIST
  fi

  /usr/libexec/PlistBuddy -c "Set :com.apple.security.network.server true" "$entitlements_plist" >/dev/null 2>&1 \
    || /usr/libexec/PlistBuddy -c "Add :com.apple.security.network.server bool true" "$entitlements_plist" >/dev/null

  local test_bundle="$runner_app/Contents/PlugIns/agentic30UITests.xctest"
  if [[ -d "$test_bundle" ]]; then
    /usr/bin/codesign --force --sign - "$test_bundle" >/dev/null
  fi
  /usr/bin/codesign --force --sign - --entitlements "$entitlements_plist" "$runner_app" >/dev/null

  if ! /usr/bin/codesign -d --entitlements :- "$runner_app" 2>/dev/null \
    | /usr/bin/grep -q 'com.apple.security.network.server'; then
    rm -f "$entitlements_plist"
    echo "Failed to verify com.apple.security.network.server on $runner_app" >&2
    return 1
  fi
  rm -f "$entitlements_plist"
  remember_ui_test_runner_app "$runner_app"
  echo "Re-signed UI test runner with network.server: $runner_app" >&2
}

print_ui_test_runner_identity() {
  local runner_app="$1"
  local info_plist="$runner_app/Contents/Info.plist"
  local bundle_id
  local cdhash
  local signature
  local network_server_entitlement="false"
  bundle_id="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$info_plist" 2>/dev/null || true)"
  cdhash="$(/usr/bin/codesign -dvvv "$runner_app" 2>&1 | /usr/bin/sed -nE 's/^CDHash=(.*)$/\1/p' | /usr/bin/head -1)"
  signature="$(/usr/bin/codesign -dvvv "$runner_app" 2>&1 | /usr/bin/sed -nE 's/^Signature=(.*)$/\1/p' | /usr/bin/head -1)"
  if /usr/bin/codesign -d --entitlements :- "$runner_app" 2>/dev/null \
    | /usr/bin/grep -q 'com.apple.security.network.server'; then
    network_server_entitlement="true"
  fi

  echo "UI test runner app: $runner_app"
  echo "UI test runner bundle id: ${bundle_id:-<unknown>}"
  echo "UI test runner cdhash: ${cdhash:-<unknown>}"
  echo "UI test runner signature: ${signature:-<unknown>}"
  echo "UI test runner network.server entitlement: $network_server_entitlement"
  echo "UI test runner DerivedData search root: $(derived_data_search_root)"
  echo "UI test runner marker: $(ui_test_runner_app_marker)"
  echo "UI test runner Accessibility target: $runner_app"
}

prepare_ui_test_runner() {
  if should_reuse_existing_ui_runner && latest_ui_test_runner_app >/dev/null; then
    echo "Reusing existing UI test runner (AGENTIC30_UI_E2E_REUSE_RUNNER) to preserve the Accessibility-granted cdhash" >&2
  else
    run_ui_xcodebuild build-for-testing "${base_xcode_args[@]}" -scheme agentic30UITests "$@"
  fi
  if should_resign_ui_runner_for_network_server; then
    resign_ui_test_runner_for_network_server
  fi

  local runner_app
  runner_app="$(latest_ui_test_runner_app)"
  print_ui_test_runner_identity "$runner_app"
}

run_ui_test_action() {
  local scheme="$1"
  shift

  if should_resign_ui_runner_for_network_server; then
    if should_reuse_existing_ui_runner && latest_ui_test_runner_app >/dev/null; then
      echo "Reusing existing UI test runner (AGENTIC30_UI_E2E_REUSE_RUNNER) to keep the network.server cdhash stable" >&2
    else
      run_ui_xcodebuild build-for-testing "${base_xcode_args[@]}" -scheme "$scheme"
    fi
    resign_ui_test_runner_for_network_server
    run_ui_xcodebuild test-without-building "${base_xcode_args[@]}" -scheme "$scheme" "$@"
    return
  fi

  run_ui_xcodebuild test "${base_xcode_args[@]}" -scheme "$scheme" "$@"
}

case "$mode" in
  unit)
    exec "$xcodebuild_bin" test "${base_xcode_args[@]}" \
      -scheme agentic30 \
      -only-testing:agentic30Tests \
      "$@"
    ;;
  ui-prepare-runner)
    prepare_ui_test_runner "$@"
    ;;
  ui-smoke)
    require_blocking_ui_approval "test:swift:ui:smoke"
    require_unlocked_display_for_ui
    run_ui_test_action agentic30UITests \
      -only-testing:agentic30UITests/agentic30UITests/testAppMenuCommandsExposeSettingsUpdatesAndSearch \
      -only-testing:agentic30UITests/agentic30UITests/testMenuBarExtraShowsWorkspaceChatSettingsAndQuitActions \
      -only-testing:agentic30UITests/agentic30UITests/testSettingsWorkspaceMainProjectMatchesOpenDesignPathRow \
      -only-testing:agentic30UITests/agentic30UITests/testAgentSettingsModelPickersSaveClaudeCodexAndGeminiModels \
      -only-testing:agentic30UITests/agentic30UITests/testSettingsPrivacyDiagnosticsAndUpdatesControlsAreReachable \
      -only-testing:agentic30UITests/agentic30UITests/testSettingsMenuBarAndNotificationTogglesAreReachable \
      -only-testing:agentic30UITests/agentic30UITests/testBipCompletedMissionShowsCompletionCard \
      -only-testing:agentic30UITests/agentic30UITests/testAssistantFailedTurnCanBeRetriedWithInlineStub \
      -only-testing:agentic30UITests/agentic30UITests/testBipCoachErrorBannerRendersWithSeededFailure \
      -only-testing:agentic30UITests/agentic30UITests/testBipCoachSidecarFailureShowsRetryAction \
      -only-testing:agentic30UITests/agentic30UITests/testFoundationIddStructuredPromptRendersFromQueueSeed \
      -only-testing:agentic30UITests/agentic30UITests/testWorkspaceStartupDay1RoutesToOfficeHours \
      -only-testing:agentic30UITests/agentic30UITests/testOfficeHoursV2DailyCardStackOrdersCardsAndOpensStaleReplacementAction \
      -only-testing:agentic30UITests/agentic30UITests/testStrategyRailOpensStrategyBusinessCanvasScreenWithMatrixAndSections \
      -only-testing:agentic30UITests/agentic30UITests/testStrategyResearchRunsThroughSidecarAndPersistsCanonicalRunDiagnostics \
      -only-testing:agentic30UITests/agentic30UITests/testMorningBriefingRailOpensBriefingScreenWithAllSections \
      "$@"
    ;;
  ui-full)
    require_blocking_ui_approval "test:swift:ui:full"
    require_unlocked_display_for_ui
    run_ui_test_action agentic30UITests "$@"
    ;;
  -h|--help|help)
    usage
    ;;
  *)
    echo "Unknown xcode-test mode: $mode" >&2
    usage
    exit 64
    ;;
esac

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
LIVE_SIGNED_PREPARE_AUTOMATION_ONLY="${AGENTIC30_LIVE_SIGNED_PREPARE_AUTOMATION_ONLY:-0}"
LIVE_SIGNED_PREFLIGHT_ONLY="${AGENTIC30_LIVE_SIGNED_PREFLIGHT_ONLY:-0}"
LIVE_SIGNED_LAUNCHSERVICES_PREPARE_ONLY="${AGENTIC30_LIVE_SIGNED_LAUNCHSERVICES_PREPARE_ONLY:-0}"
LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH="${AGENTIC30_LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH:-$ROOT/build/ui-e2e/live-signed-runner-derived-data}"
LIVE_SIGNED_ENABLE_AUTOMATION_MODE="${AGENTIC30_LIVE_SIGNED_ENABLE_AUTOMATION_MODE:-0}"
AUTOMATION_MODE_TOOL="${AGENTIC30_AUTOMATION_MODE_TOOL:-/usr/bin/automationmodetool}"
LIVE_SIGNED_LAUNCHSERVICES_ROOT="${AGENTIC30_LIVE_SIGNED_LAUNCHSERVICES_ROOT:-$ROOT/build/live-signed-e2e/launchservices-manual}"
LIVE_SIGNED_LAUNCHSERVICES_ENV_HOLD_SECONDS="${AGENTIC30_LIVE_SIGNED_LAUNCHSERVICES_ENV_HOLD_SECONDS:-3}"
LIVE_SIGNED_PREFLIGHT_STATUS_PATH="${AGENTIC30_LIVE_SIGNED_PREFLIGHT_STATUS_PATH:-$ROOT/build/live-signed-e2e/live-signed-preflight-status.txt}"
LIVE_SIGNED_CONSOLE_STATE_PATH="${AGENTIC30_LIVE_SIGNED_CONSOLE_STATE_PATH:-}"
LIVE_SIGNED_UI_E2E_LOG_PATH="${AGENTIC30_LIVE_SIGNED_UI_E2E_LOG_PATH:-$ROOT/build/live-signed-e2e/live-signed-ui-e2e.log}"
LIVE_SIGNED_XCODE_TEST_SCRIPT="${AGENTIC30_LIVE_SIGNED_XCODE_TEST_SCRIPT:-scripts/xcode-test.sh}"

validate_live_signed_mode_flags() {
  local enabled=()
  if [ "${AGENTIC30_LIVE_SIGNED_BUILD_ONLY:-0}" = "1" ]; then
    enabled+=("AGENTIC30_LIVE_SIGNED_BUILD_ONLY")
  fi
  if [ "$LIVE_SIGNED_PREPARE_RUNNER_ONLY" = "1" ]; then
    enabled+=("AGENTIC30_LIVE_SIGNED_PREPARE_RUNNER_ONLY")
  fi
  if [ "$LIVE_SIGNED_PREPARE_AUTOMATION_ONLY" = "1" ]; then
    enabled+=("AGENTIC30_LIVE_SIGNED_PREPARE_AUTOMATION_ONLY")
  fi
  if [ "$LIVE_SIGNED_PREFLIGHT_ONLY" = "1" ]; then
    enabled+=("AGENTIC30_LIVE_SIGNED_PREFLIGHT_ONLY")
  fi
  if [ "$LIVE_SIGNED_LAUNCHSERVICES_PREPARE_ONLY" = "1" ]; then
    enabled+=("AGENTIC30_LIVE_SIGNED_LAUNCHSERVICES_PREPARE_ONLY")
  fi
  if [ "${#enabled[@]}" -gt 1 ]; then
    write_live_signed_mode_conflict_status "${enabled[*]}"
    printf 'ERROR: live_signed_mode_conflict\n\n' >&2
    printf 'The live signed recorder UI E2E wrapper accepts only one non-foreground mode at a time: %s.\n' "${enabled[*]}" >&2
    exit 2
  fi
}

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

write_live_signed_preflight_status_header() {
  local state="$1"
  local reason="$2"
  {
    printf 'Agentic30 live signed preflight status\n\n'
    printf 'generated_at: %s\n' "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
    printf 'state: %s\n' "$state"
    printf 'reason: %s\n' "$reason"
    printf 'live_signed_app: %s\n' "$APP_PATH"
    printf 'ui_runner_derived_data: %s\n' "$LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH"
    printf 'ui_e2e_log: %s\n' "$LIVE_SIGNED_UI_E2E_LOG_PATH"
    printf 'proof_boundary: diagnostic artifact only; live recorder/UI acceptance requires matching UI and verifier artifacts; no proof-ledger acceptance\n'
  } >"$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
}

write_live_signed_mode_conflict_status() {
  local enabled_modes="$1"
  /bin/mkdir -p "$(/usr/bin/dirname "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH")"
  write_live_signed_preflight_status_header "blocked" "live_signed_mode_conflict"
  {
    printf 'enabled_modes: %s\n' "$enabled_modes"
  } >>"$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
  printf 'Live signed preflight status: %s\n' "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
}

infer_live_signed_ui_failure_reason() {
  local leg="$1"
  local log_path="$2"
  if /usr/bin/grep -q 'runner_accessibility_blocked' "$log_path" 2>/dev/null; then
    printf 'runner_accessibility_blocked\n'
    return 0
  fi
  if /usr/bin/grep -q 'listen EPERM: operation not permitted 127\.0\.0\.1' "$log_path" 2>/dev/null; then
    printf 'ui_runner_loopback_listen_eperm\n'
    return 0
  fi
  if /usr/bin/grep -q 'screen_recording_missing' "$log_path" 2>/dev/null; then
    printf 'screen_recording_missing\n'
    return 0
  fi
  if /usr/bin/grep -q 'accessibility_missing' "$log_path" 2>/dev/null; then
    printf 'accessibility_missing\n'
    return 0
  fi
  if /usr/bin/grep -q 'input_monitoring_missing' "$log_path" 2>/dev/null; then
    printf 'input_monitoring_missing\n'
    return 0
  fi
  if /usr/bin/grep -q 'ERR_RECORDER_SYSTEM_AUDIO_PERMISSION_MISSING' "$log_path" 2>/dev/null; then
    printf 'system_audio_permission_missing\n'
    return 0
  fi
  if /usr/bin/grep -q 'ERR_RECORDER_MICROPHONE_PERMISSION_MISSING' "$log_path" 2>/dev/null; then
    printf 'microphone_permission_missing\n'
    return 0
  fi
  printf 'live_signed_%s_failed\n' "$leg"
}

write_live_signed_ui_leg_status() {
  local state="$1"
  local reason="$2"
  local leg="$3"
  local exit_status="$4"
  local log_path="$5"
  /bin/mkdir -p "$(/usr/bin/dirname "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH")"
  write_live_signed_preflight_status_header "$state" "$reason"
  {
    printf 'ui_leg: %s\n' "$leg"
    printf 'ui_leg_exit_status: %s\n' "$exit_status"
    printf 'xcode_test_script: %s\n' "$LIVE_SIGNED_XCODE_TEST_SCRIPT"
    append_live_signed_runner_accessibility_status
    printf '\nui_e2e_log_tail:\n'
    if [ -f "$log_path" ]; then
      /usr/bin/tail -n 80 "$log_path" | /usr/bin/sed 's/^/  /'
    else
      printf '  missing log: %s\n' "$log_path"
    fi
  } >>"$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
  printf 'Live signed preflight status: %s\n' "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
}

live_signed_ui_runner_marker() {
  printf '%s\n' "$ROOT/build/ui-e2e/agentic30-ui-test-runner-app.txt"
}

read_live_signed_ui_runner_app() {
  local marker
  local runner_app
  marker="$(live_signed_ui_runner_marker)"
  [ -f "$marker" ] || return 1
  runner_app="$(/bin/cat "$marker" 2>/dev/null || true)"
  runner_app="${runner_app//$'\n'/}"
  [ -n "$runner_app" ] || return 1
  printf '%s\n' "$runner_app"
}

live_signed_runner_under_search_root() {
  local runner_app="$1"
  local search_root="${LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH%/}"
  [ -n "$search_root" ] || return 1
  case "$runner_app" in
    "$search_root"/*)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

live_signed_runner_bundle_id() {
  local runner_app="$1"
  /usr/libexec/PlistBuddy -c 'Print :CFBundleIdentifier' "$runner_app/Contents/Info.plist" 2>/dev/null || true
}

live_signed_runner_cdhash() {
  local runner_app="$1"
  /usr/bin/codesign -dvvv "$runner_app" 2>&1 | /usr/bin/sed -nE 's/^CDHash=(.*)$/\1/p' | /usr/bin/head -1 || true
}

live_signed_runner_network_server_entitlement() {
  local runner_app="$1"
  if /usr/bin/codesign -d --entitlements :- "$runner_app" 2>/dev/null \
    | /usr/bin/grep -q 'com.apple.security.network.server'; then
    printf 'true\n'
    return 0
  fi
  printf 'false\n'
  return 1
}

append_live_signed_runner_accessibility_status() {
  local runner_app=""
  local bundle_id=""
  local cdhash=""
  local network_server_entitlement="false"
  local quoted_app_path
  local accessibility_settings_url="x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility"

  if runner_app="$(read_live_signed_ui_runner_app 2>/dev/null)"; then
    if [ -d "$runner_app" ]; then
      bundle_id="$(live_signed_runner_bundle_id "$runner_app")"
      cdhash="$(live_signed_runner_cdhash "$runner_app")"
      network_server_entitlement="$(live_signed_runner_network_server_entitlement "$runner_app" || true)"
    fi
  else
    runner_app=""
  fi

  quoted_app_path="$(shell_quote "$APP_PATH")"
  printf '\nui_runner_accessibility_target:\n'
  printf '  marker: %s\n' "$(live_signed_ui_runner_marker)"
  printf '  app: %s\n' "${runner_app:-<missing>}"
  printf '  bundle_id: %s\n' "${bundle_id:-october-academy.agentic30UITests.xctrunner}"
  printf '  cdhash: %s\n' "${cdhash:-<unknown>}"
  printf '  network_server_entitlement: %s\n' "$network_server_entitlement"
  printf '  expected_derived_data: %s\n' "$LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH"
  printf '  tcc_service: kTCCServiceAccessibility\n'
  printf '  settings_url: %s\n' "$accessibility_settings_url"
  printf '  open_settings_command: open %s\n' "$(shell_quote "$accessibility_settings_url")"
  printf '  next_user_step: Grant Accessibility to the app path above if present; otherwise grant Accessibility to october-academy.agentic30UITests.xctrunner after preparing the runner.\n'
  printf '  next_live_signed_run_command: AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1 AGENTIC30_LIVE_SIGNED_APP_PATH=%s scripts/run-live-signed-recorder-ui-e2e.sh\n' "$quoted_app_path"
}

write_live_signed_runner_identity_status() {
  local state="$1"
  local reason="$2"
  local exit_status="$3"
  local runner_app="${4:-}"
  local bundle_id=""
  local cdhash=""
  local network_server_entitlement="false"

  if [ -n "$runner_app" ] && [ -d "$runner_app" ]; then
    bundle_id="$(live_signed_runner_bundle_id "$runner_app")"
    cdhash="$(live_signed_runner_cdhash "$runner_app")"
    network_server_entitlement="$(live_signed_runner_network_server_entitlement "$runner_app" || true)"
  fi

  /bin/mkdir -p "$(/usr/bin/dirname "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH")"
  write_live_signed_preflight_status_header "$state" "$reason"
  {
    printf 'ui_leg: ui_runner_identity\n'
    printf 'ui_leg_exit_status: %s\n' "$exit_status"
    printf 'ui_runner_marker: %s\n' "$(live_signed_ui_runner_marker)"
    printf 'ui_runner_app: %s\n' "${runner_app:-<missing>}"
    printf 'ui_runner_bundle_id: %s\n' "${bundle_id:-<unknown>}"
    printf 'ui_runner_cdhash: %s\n' "${cdhash:-<unknown>}"
    printf 'ui_runner_network_server_entitlement: %s\n' "$network_server_entitlement"
    printf 'ui_runner_expected_derived_data: %s\n' "$LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH"
    printf 'xcode_test_script: %s\n' "$LIVE_SIGNED_XCODE_TEST_SCRIPT"
    append_live_signed_runner_accessibility_status
    printf '\nui_e2e_log_tail:\n'
    if [ -f "$LIVE_SIGNED_UI_E2E_LOG_PATH" ]; then
      /usr/bin/tail -n 80 "$LIVE_SIGNED_UI_E2E_LOG_PATH" | /usr/bin/sed 's/^/  /'
    else
      printf '  missing log: %s\n' "$LIVE_SIGNED_UI_E2E_LOG_PATH"
    fi
  } >>"$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
  printf 'Live signed preflight status: %s\n' "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
}

require_live_signed_runner_network_server_entitlement() {
  local runner_app
  if ! runner_app="$(read_live_signed_ui_runner_app)"; then
    write_live_signed_runner_identity_status "blocked" "ui_runner_marker_missing" "3" ""
    cat >&2 <<EOF
ERROR: ui_runner_marker_missing

The live signed recorder UI E2E could not find the prepared XCUITest runner
marker after ui-prepare-runner completed.
EOF
    exit 3
  fi

  if [ ! -d "$runner_app" ]; then
    write_live_signed_runner_identity_status "blocked" "ui_runner_app_missing" "3" "$runner_app"
    echo "ERROR: ui_runner_app_missing: $runner_app" >&2
    exit 3
  fi

  if ! live_signed_runner_under_search_root "$runner_app"; then
    write_live_signed_runner_identity_status "blocked" "ui_runner_outside_selected_derived_data" "3" "$runner_app"
    echo "ERROR: ui_runner_outside_selected_derived_data: $runner_app" >&2
    exit 3
  fi

  local bundle_id
  bundle_id="$(live_signed_runner_bundle_id "$runner_app")"
  if [ "$bundle_id" != "october-academy.agentic30UITests.xctrunner" ]; then
    write_live_signed_runner_identity_status "blocked" "ui_runner_bundle_id_mismatch" "3" "$runner_app"
    echo "ERROR: ui_runner_bundle_id_mismatch: ${bundle_id:-<unknown>}" >&2
    exit 3
  fi

  if ! live_signed_runner_network_server_entitlement "$runner_app" >/dev/null; then
    write_live_signed_runner_identity_status "blocked" "ui_runner_network_server_missing" "3" "$runner_app"
    cat >&2 <<EOF
ERROR: ui_runner_network_server_missing

The prepared XCUITest runner does not carry com.apple.security.network.server.
Without that entitlement, the child sidecar can fail loopback listen with
listen EPERM before live recorder acceptance can run.
EOF
    exit 3
  fi

  write_live_signed_runner_identity_status "ready" "ui_runner_network_server_verified" "0" "$runner_app"
}

run_live_signed_ui_leg() {
  local leg="$1"
  local test_identifier="$2"
  /bin/mkdir -p "$(/usr/bin/dirname "$LIVE_SIGNED_UI_E2E_LOG_PATH")"
  {
    printf '\n[%s] live signed UI E2E leg: %s\n' "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)" "$leg"
    printf 'test_identifier: %s\n' "$test_identifier"
  } >>"$LIVE_SIGNED_UI_E2E_LOG_PATH"

  set +e
  AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 \
  AGENTIC30_DERIVED_DATA_PATH="$LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH" \
  AGENTIC30_LIVE_SIGNED_APP_PATH="$APP_PATH" \
  AGENTIC30_LIVE_SIGNED_PRESERVE_ARTIFACTS="$LIVE_SIGNED_PRESERVE_ARTIFACTS" \
  AGENTIC30_UI_E2E_REUSE_RUNNER=1 \
    bash "$LIVE_SIGNED_XCODE_TEST_SCRIPT" ui-full "$test_identifier" 2>&1 \
      | /usr/bin/tee -a "$LIVE_SIGNED_UI_E2E_LOG_PATH"
  local status="${PIPESTATUS[0]}"
  set -e

  if [ "$status" -ne 0 ]; then
    local reason
    reason="$(infer_live_signed_ui_failure_reason "$leg" "$LIVE_SIGNED_UI_E2E_LOG_PATH")"
    write_live_signed_ui_leg_status "blocked" "$reason" "$leg" "$status" "$LIVE_SIGNED_UI_E2E_LOG_PATH"
    cat >&2 <<EOF
ERROR: $reason

The live signed recorder UI E2E stopped during the "$leg" leg. See:
$LIVE_SIGNED_PREFLIGHT_STATUS_PATH
$LIVE_SIGNED_UI_E2E_LOG_PATH
EOF
    exit "$status"
  fi

  write_live_signed_ui_leg_status "ready" "${leg}_passed" "$leg" "$status" "$LIVE_SIGNED_UI_E2E_LOG_PATH"
}

run_live_signed_runner_prepare() {
  /bin/mkdir -p "$(/usr/bin/dirname "$LIVE_SIGNED_UI_E2E_LOG_PATH")"
  {
    printf '\n[%s] live signed UI runner prepare\n' "$(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)"
  } >>"$LIVE_SIGNED_UI_E2E_LOG_PATH"

  set +e
  AGENTIC30_DERIVED_DATA_PATH="$LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH" \
  AGENTIC30_UI_E2E_REUSE_RUNNER=1 \
    bash "$LIVE_SIGNED_XCODE_TEST_SCRIPT" ui-prepare-runner 2>&1 \
      | /usr/bin/tee -a "$LIVE_SIGNED_UI_E2E_LOG_PATH"
  local status="${PIPESTATUS[0]}"
  set -e

  if [ "$status" -ne 0 ]; then
    write_live_signed_ui_leg_status "blocked" "ui_runner_prepare_failed" "ui_runner_prepare" "$status" "$LIVE_SIGNED_UI_E2E_LOG_PATH"
    cat >&2 <<EOF
ERROR: ui_runner_prepare_failed

The live signed recorder UI E2E could not prepare the stable XCUITest runner.
See:
$LIVE_SIGNED_PREFLIGHT_STATUS_PATH
$LIVE_SIGNED_UI_E2E_LOG_PATH
EOF
    exit "$status"
  fi

  write_live_signed_ui_leg_status "ready" "ui_runner_prepare_passed" "ui_runner_prepare" "$status" "$LIVE_SIGNED_UI_E2E_LOG_PATH"
  require_live_signed_runner_network_server_entitlement
}

live_signed_console_state() {
  if [ -n "$LIVE_SIGNED_CONSOLE_STATE_PATH" ]; then
    /bin/cat "$LIVE_SIGNED_CONSOLE_STATE_PATH" 2>/dev/null || true
    return 0
  fi
  /usr/sbin/ioreg -n Root -d1 2>/dev/null || true
}

write_live_signed_screen_lock_status() {
  local console_state="$1"
  /bin/mkdir -p "$(/usr/bin/dirname "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH")"
  write_live_signed_preflight_status_header "blocked" "screen_locked"
  {
    printf 'console_state_source: %s\n' "${LIVE_SIGNED_CONSOLE_STATE_PATH:-/usr/sbin/ioreg -n Root -d1}"
    printf '\nconsole_state_output:\n'
    printf '%s\n' "$console_state" | /usr/bin/sed 's/^/  /'
  } >>"$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
  printf 'Live signed preflight status: %s\n' "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
}

validate_live_signed_mode_flags

require_unlocked_display_for_live_ui() {
  if [ "${AGENTIC30_LIVE_SIGNED_BUILD_ONLY:-0}" = "1" ] \
    || [ "$LIVE_SIGNED_PREPARE_RUNNER_ONLY" = "1" ] \
    || [ "${AGENTIC30_LIVE_SIGNED_SKIP_SCREEN_LOCK_CHECK:-0}" = "1" ]; then
    return 0
  fi

  local console_state
  console_state="$(live_signed_console_state)"
  if /usr/bin/grep -q 'CGSSessionScreenIsLocked.*Yes' <<<"$console_state"; then
    write_live_signed_screen_lock_status "$console_state"
    cat >&2 <<'EOF'
ERROR: live signed recorder UI E2E requires an unlocked macOS GUI session.

The macOS session is locked/loginwindow-shielded. Unlock the Mac and rerun the
workflow so ScreenCaptureKit and XCUITest can exercise the signed app surface.
EOF
    exit 3
  fi
}

automation_mode_status() {
  local tool_path="$AUTOMATION_MODE_TOOL"
  if [ ! -x "$tool_path" ]; then
    printf 'automationmodetool unavailable at %s\n' "$tool_path"
    return 127
  fi
  "$tool_path" status 2>&1
}

should_enable_automation_mode() {
  case "$LIVE_SIGNED_ENABLE_AUTOMATION_MODE" in
    1|true|TRUE|yes|YES|on|ON)
      return 0
      ;;
    *)
      return 1
      ;;
  esac
}

enable_automation_mode() {
  local tool_path="$AUTOMATION_MODE_TOOL"
  if [ ! -x "$tool_path" ]; then
    printf 'automationmodetool unavailable at %s\n' "$tool_path"
    return 127
  fi
  "$tool_path" enable-automationmode-without-authentication 2>&1
}

write_live_signed_preflight_status() {
  local state="$1"
  local reason="$2"
  local status_code="$3"
  local status_output="$4"
  local enable_status="${5:-}"
  local enable_output="${6:-}"
  /bin/mkdir -p "$(/usr/bin/dirname "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH")"
  write_live_signed_preflight_status_header "$state" "$reason"
  {
    printf 'automation_mode_tool: %s\n' "$AUTOMATION_MODE_TOOL"
    printf 'automation_mode_status_code: %s\n' "$status_code"
    if [ -n "$enable_status" ]; then
      printf 'automation_mode_enable_status_code: %s\n' "$enable_status"
    fi
    printf '\nautomation_mode_status_output:\n'
    printf '%s\n' "$status_output" | /usr/bin/sed 's/^/  /'
    if [ -n "$enable_output" ]; then
      printf '\nautomation_mode_enable_output:\n'
      printf '%s\n' "$enable_output" | /usr/bin/sed 's/^/  /'
    fi
  } >>"$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
  printf 'Live signed preflight status: %s\n' "$LIVE_SIGNED_PREFLIGHT_STATUS_PATH"
}

require_automation_mode_for_live_ui() {
  if [ "${AGENTIC30_LIVE_SIGNED_BUILD_ONLY:-0}" = "1" ] \
    || [ "$LIVE_SIGNED_PREPARE_RUNNER_ONLY" = "1" ]; then
    return 0
  fi

  local status_output
  local status_code=0
  status_output="$(automation_mode_status)" || status_code=$?
  printf 'Automation Mode status:\n%s\n' "$status_output"
  if [ "$status_code" -ne 0 ]; then
    write_live_signed_preflight_status "blocked" "automation_mode_status_unavailable" "$status_code" "$status_output"
    cat >&2 <<EOF
ERROR: automation_mode_status_unavailable

The live signed recorder UI E2E could not inspect macOS Automation Mode
before launching foreground XCUITest. status=$status_code
EOF
    exit 3
  fi
  if /usr/bin/grep -q 'Automation Mode is disabled' <<<"$status_output"; then
    if should_enable_automation_mode; then
      echo "Automation Mode is disabled; AGENTIC30_LIVE_SIGNED_ENABLE_AUTOMATION_MODE is enabled, attempting to enable it before foreground XCUITest."
      local enable_output
      local enable_status=0
      enable_output="$(enable_automation_mode)" || enable_status=$?
      printf 'Automation Mode enable output:\n%s\n' "$enable_output"
      if [ "$enable_status" -ne 0 ]; then
        write_live_signed_preflight_status "blocked" "automation_mode_enable_failed" "$status_code" "$status_output" "$enable_status" "$enable_output"
        cat >&2 <<EOF
ERROR: automation_mode_enable_failed

The live signed recorder UI E2E attempted to enable macOS Automation Mode before
launching foreground XCUITest, but automationmodetool exited with
status=$enable_status.
EOF
        exit 3
      fi
      status_output="$(automation_mode_status)" || status_code=$?
      printf 'Automation Mode status after enable:\n%s\n' "$status_output"
      if [ "$status_code" -ne 0 ] || /usr/bin/grep -q 'Automation Mode is disabled' <<<"$status_output"; then
        write_live_signed_preflight_status "blocked" "automation_mode_enable_unverified" "$status_code" "$status_output" "$enable_status" "$enable_output"
        cat >&2 <<EOF
ERROR: automation_mode_enable_unverified

The live signed recorder UI E2E attempted to enable macOS Automation Mode, but
the follow-up status check did not prove it is enabled. status=$status_code
EOF
        exit 3
      fi
      if ! /usr/bin/grep -q 'Automation Mode is enabled' <<<"$status_output"; then
        write_live_signed_preflight_status "blocked" "automation_mode_enable_unverified" "$status_code" "$status_output" "$enable_status" "$enable_output"
        cat >&2 <<EOF
ERROR: automation_mode_enable_unverified

The live signed recorder UI E2E attempted to enable macOS Automation Mode, but
the follow-up status check did not prove it is enabled. status=$status_code
EOF
        exit 3
      fi
      write_live_signed_preflight_status "ready" "automation_mode_enabled" "$status_code" "$status_output" "$enable_status" "$enable_output"
      return 0
    fi
    write_live_signed_preflight_status "blocked" "automation_mode_disabled" "$status_code" "$status_output"
    cat >&2 <<'EOF'
ERROR: automation_mode_disabled

The live signed recorder UI E2E requires macOS Automation Mode before launching
the foreground XCUITest legs. Enable Automation Mode, or rerun with
AGENTIC30_LIVE_SIGNED_ENABLE_AUTOMATION_MODE=1 to let this wrapper attempt the
machine-local Automation Mode enable step before launching foreground UI.
EOF
    exit 3
  fi
  if /usr/bin/grep -q 'Automation Mode is enabled' <<<"$status_output"; then
    write_live_signed_preflight_status "ready" "automation_mode_enabled" "$status_code" "$status_output"
    return 0
  fi
  write_live_signed_preflight_status "blocked" "automation_mode_status_unknown" "$status_code" "$status_output"
  cat >&2 <<EOF
ERROR: automation_mode_status_unknown

The live signed recorder UI E2E could not prove macOS Automation Mode is enabled
or disabled before launching foreground XCUITest. status=$status_code
EOF
  exit 3
}

live_signed_app_path_marker() {
  local uid
  uid="$(/usr/bin/id -u)"
  printf '/tmp/agentic30-live-signed-recorder-ui-e2e-app-path-%s.txt\n' "$uid"
}

remove_live_signed_app_path_marker() {
  local marker
  marker="$(live_signed_app_path_marker)"
  if [ -e "$marker" ]; then
    rm -f "$marker"
    echo "Removed stale live signed app-path marker: $marker"
  fi
}

shell_quote() {
  printf "'%s'" "$(printf '%s' "$1" | sed "s/'/'\\\\''/g")"
}

unset_live_signed_launchservices_env() {
  /bin/launchctl unsetenv AGENTIC30_APP_SUPPORT_PATH 2>/dev/null || true
  /bin/launchctl unsetenv AGENTIC30_TEST_STUB_PROVIDER 2>/dev/null || true
  /bin/launchctl unsetenv AGENTIC30_DISABLE_CODEX_WARMUP 2>/dev/null || true
  /bin/launchctl unsetenv AGENTIC30_UI_TESTING_DIAGNOSTICS_PATH 2>/dev/null || true
}

write_live_signed_launchservices_handoff() {
  local handoff_path="$1"
  local launch_status="$2"
  local run_root="$3"
  local workspace_path="$4"
  local app_support_path="$5"
  local diagnostics_path="$6"
  local quoted_app_path
  local quoted_handoff_path
  local quoted_json_output_path
  quoted_app_path="$(shell_quote "$APP_PATH")"
  quoted_handoff_path="$(shell_quote "$handoff_path")"
  quoted_json_output_path="$(shell_quote "$run_root/live-recorder-acceptance-evidence.json")"
  /bin/cat >"$handoff_path" <<EOF
Agentic30 live signed LaunchServices handoff

status: $launch_status
generated_at: $(/bin/date -u +%Y-%m-%dT%H:%M:%SZ)
app: $APP_PATH
bundle_id: $bundle_id
run_root: $run_root
workspace: $workspace_path
app_support: $app_support_path
diagnostics: $diagnostics_path

acceptance_state: launch_prepared_only
proof_boundary: no live recorder capture acceptance, no UI E2E acceptance, no proof-ledger acceptance

purpose:
  Launch the Developer ID signed app through LaunchServices so macOS TCC prompts
  are attributed to $bundle_id instead of the calling shell.

next_user_step:
  Grant the signed app Screen Recording, Accessibility, Input Monitoring, and
  Microphone when macOS prompts or in System Settings if the app is listed there.

next_live_signed_run_command: AGENTIC30_LIVE_SIGNED_SKIP_BUILD=1 AGENTIC30_LIVE_SIGNED_APP_PATH=$quoted_app_path scripts/run-live-signed-recorder-ui-e2e.sh

next_acceptance_verifier_command: bash scripts/verify-live-recorder-acceptance.sh --launchservices-handoff $quoted_handoff_path --allow-missing-audio --apply-retention --json-output $quoted_json_output_path

launchd_environment:
  AGENTIC30_APP_SUPPORT_PATH=$app_support_path
  AGENTIC30_TEST_STUB_PROVIDER=1
  AGENTIC30_DISABLE_CODEX_WARMUP=1
  AGENTIC30_UI_TESTING_DIAGNOSTICS_PATH=$diagnostics_path
  cleared_after_hold_seconds=$LIVE_SIGNED_LAUNCHSERVICES_ENV_HOLD_SECONDS
EOF
}

prepare_live_signed_launchservices_app() {
  local run_id
  run_id="$(/bin/date +%Y%m%d-%H%M%S)"
  local run_root="${AGENTIC30_LIVE_SIGNED_LAUNCHSERVICES_RUN_ROOT:-$LIVE_SIGNED_LAUNCHSERVICES_ROOT/$run_id}"
  local workspace_path="$run_root/workspace"
  local app_support_path="$run_root/app-support"
  local diagnostics_path="$run_root/launch-diagnostics.json"
  local handoff_path="$run_root/launchservices-handoff.txt"

  /bin/mkdir -p "$workspace_path" "$app_support_path"
  /usr/bin/defaults write "$bundle_id" agentic30.macOnboardingIntakeOnlyCompleted -bool true
  write_live_signed_launchservices_handoff \
    "$handoff_path" \
    "prepared_before_open" \
    "$run_root" \
    "$workspace_path" \
    "$app_support_path" \
    "$diagnostics_path"

  /bin/launchctl setenv AGENTIC30_APP_SUPPORT_PATH "$app_support_path"
  /bin/launchctl setenv AGENTIC30_TEST_STUB_PROVIDER "1"
  /bin/launchctl setenv AGENTIC30_DISABLE_CODEX_WARMUP "1"
  /bin/launchctl setenv AGENTIC30_UI_TESTING_DIAGNOSTICS_PATH "$diagnostics_path"

  local open_status=0
  /usr/bin/open -n "$APP_PATH" --args \
    "--ui-testing-reset-onboarding" \
    "--ui-testing-seed-auth" \
    "--ui-testing-seed-onboarding-context" \
    "--ui-testing-seed-workspace=$workspace_path" \
    "--ui-testing-seed-workspace-scan-cache" \
    "--ui-testing-seed-idd-complete" \
    "--ui-testing-seed-rail-unlocked-through-day1" \
    "--ui-testing-open-workspace" \
    "--ui-testing-direct-workspace-window" \
    "--ui-testing-opaque-window" \
    "--ui-testing-workspace-window-size=1360x960" \
    "--ui-testing-diagnostics-path=$diagnostics_path" || open_status=$?

  /bin/sleep "$LIVE_SIGNED_LAUNCHSERVICES_ENV_HOLD_SECONDS"
  unset_live_signed_launchservices_env
  if [ "$open_status" -ne 0 ]; then
    write_live_signed_launchservices_handoff \
      "$handoff_path" \
      "open_failed status=$open_status" \
      "$run_root" \
      "$workspace_path" \
      "$app_support_path" \
      "$diagnostics_path"
    echo "LaunchServices handoff: $handoff_path" >&2
    echo "ERROR: live_signed_launchservices_open_failed status=$open_status" >&2
    exit "$open_status"
  fi
  write_live_signed_launchservices_handoff \
    "$handoff_path" \
    "open_succeeded" \
    "$run_root" \
    "$workspace_path" \
    "$app_support_path" \
    "$diagnostics_path"

  cat <<EOF
LaunchServices live signed app preparation completed.

App: $APP_PATH
Run root: $run_root
Workspace: $workspace_path
App support: $app_support_path
Diagnostics: $diagnostics_path
Handoff: $handoff_path

This mode launches the signed app through LaunchServices so macOS TCC attributes
permission prompts to $bundle_id rather than to the calling shell. It does not
drive foreground XCUITest and does not bypass user approval for Screen Recording
or Accessibility.
EOF
}

if [ "$LIVE_SIGNED_PREPARE_AUTOMATION_ONLY" = "1" ]; then
  remove_live_signed_app_path_marker
  require_automation_mode_for_live_ui
  echo "Automation Mode preflight completed without launching foreground UI E2E."
  exit 0
fi

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
echo "Prepare Automation Mode only: $LIVE_SIGNED_PREPARE_AUTOMATION_ONLY"
echo "Preflight only: $LIVE_SIGNED_PREFLIGHT_ONLY"
echo "LaunchServices prepare only: $LIVE_SIGNED_LAUNCHSERVICES_PREPARE_ONLY"
echo "UI runner DerivedData path: $LIVE_SIGNED_UI_RUNNER_DERIVED_DATA_PATH"
echo "LaunchServices evidence root: $LIVE_SIGNED_LAUNCHSERVICES_ROOT"
echo "Live signed UI E2E evidence roots: $HOME/Library/Containers/october-academy.agentic30UITests.xctrunner/Data/Library/Caches/agentic30-ui-test-live-signed-{preflight,capture,audio}/<run-id>"
echo "Core verifier JSON: live-recorder-frame-search-verifier.json"
echo "Delete verifier JSON: live-recorder-frame-delete-verifier.json"
echo "Retention verifier JSON: live-recorder-retention-verifier.json"
echo "Audio verifier JSON: live-recorder-audio-verifier.json"

if [ "${AGENTIC30_LIVE_SIGNED_BUILD_ONLY:-0}" = "1" ]; then
  remove_live_signed_app_path_marker
  exit 0
fi

if [ "$LIVE_SIGNED_LAUNCHSERVICES_PREPARE_ONLY" = "1" ]; then
  remove_live_signed_app_path_marker
  prepare_live_signed_launchservices_app
  exit 0
fi

echo "Preparing stable XCUITest runner identity for Accessibility grant..."
run_live_signed_runner_prepare
cat <<'EOF'
If the next preflight reports runner_accessibility_blocked, grant Accessibility
to the "UI test runner Accessibility target" path printed above, then rerun this
workflow without rebuilding the runner.
EOF

if [ "$LIVE_SIGNED_PREPARE_RUNNER_ONLY" = "1" ]; then
  remove_live_signed_app_path_marker
  exit 0
fi

remove_live_signed_app_path_marker
require_automation_mode_for_live_ui

if [ "$LIVE_SIGNED_PREFLIGHT_ONLY" = "1" ]; then
  echo "Live signed preflight completed without writing the app-path marker or launching foreground UI E2E."
  exit 0
fi

path_marker="$(live_signed_app_path_marker)"
printf '%s\n' "$APP_PATH" >"$path_marker"
cleanup_live_signed_app_path_marker() {
  rm -f "$path_marker"
}
trap cleanup_live_signed_app_path_marker EXIT

run_live_signed_ui_leg \
  "runner_accessibility_preflight" \
  "-only-testing:agentic30UITests/agentic30UITests/testFounderReplayLiveSignedAppRunnerAccessibilityPreflight"

run_live_signed_ui_leg \
  "core_frame_capture_delete" \
  "-only-testing:agentic30UITests/agentic30UITests/testFounderReplayLiveSignedAppCoreFrameCaptureAndDeleteWhenTccGranted"

run_live_signed_ui_leg \
  "sensitive_audio" \
  "-only-testing:agentic30UITests/agentic30UITests/testFounderReplayLiveSignedAppSensitiveAudioRunsWhenTccGranted"

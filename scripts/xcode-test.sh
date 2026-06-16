#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat >&2 <<'EOF'
Usage: scripts/xcode-test.sh <unit|ui-smoke|ui-full> [xcodebuild args...]

Modes:
  unit      Run Swift unit tests only. Does not run the XCUITest target.
  ui-smoke Run the approved hermetic UI smoke subset.
  ui-full  Run the full agentic30UITests scheme.

Local UI modes launch Agentic30 in the foreground and can take keyboard,
mouse, and focus. They require AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 unless
running in CI/GitHub Actions.
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

base_args=(
  test
  -project "$project"
  -destination "$destination"
)

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

case "$mode" in
  unit)
    exec "$xcodebuild_bin" "${base_args[@]}" \
      -scheme agentic30 \
      -only-testing:agentic30Tests \
      "$@"
    ;;
  ui-smoke)
    require_blocking_ui_approval "test:swift:ui:smoke"
    exec "$xcodebuild_bin" "${base_args[@]}" \
      -scheme agentic30UITests \
      -only-testing:agentic30UITests/agentic30UITests/testSettingsWorkspaceMainProjectMatchesOpenDesignPathRow \
      -only-testing:agentic30UITests/agentic30UITests/testAgentSettingsModelPickersSaveClaudeCodexAndGeminiModels \
      -only-testing:agentic30UITests/agentic30UITests/testWorkspaceStartupDay1RoutesToOfficeHours \
      -only-testing:agentic30UITests/agentic30UITests/testStrategyRailOpensStrategyBusinessCanvasScreenWithMatrixAndSections \
      -only-testing:agentic30UITests/agentic30UITests/testStrategyResearchRunsThroughSidecarAndPersistsCanonicalRunDiagnostics \
      -only-testing:agentic30UITests/agentic30UITests/testMorningBriefingRailOpensBriefingScreenWithAllSections \
      "$@"
    ;;
  ui-full)
    require_blocking_ui_approval "test:swift:ui:full"
    exec "$xcodebuild_bin" "${base_args[@]}" \
      -scheme agentic30UITests \
      "$@"
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

#!/bin/sh
# Xcode Cloud pre-xcodebuild hook.
#
# Apple already injects `DEVELOPMENT_TEAM` as an `xcodebuild` flag based on
# the workflow's selected team, so committed pbxproj does not need to carry
# the team id. This script is a no-op in the Apple-managed flow and only
# does anything when an operator has set `DEVELOPMENT_TEAM` as an env var
# AND the project still lacks the setting (defense-in-depth, e.g. a forked
# workflow that bypasses Apple's auto-flag).
set -euo pipefail

if [ -z "${CI_WORKSPACE:-}" ]; then
  echo "ci_pre_xcodebuild: CI_WORKSPACE not set; not running under Xcode Cloud." >&2
  exit 0
fi

if [ -z "${DEVELOPMENT_TEAM:-}" ]; then
  echo "ci_pre_xcodebuild: DEVELOPMENT_TEAM env var not set — relying on xcodebuild flag from Apple's workflow."
  exit 0
fi

PROJECT_PATH="$CI_WORKSPACE/agentic30.xcodeproj/project.pbxproj"
if [ ! -f "$PROJECT_PATH" ]; then
  echo "ci_pre_xcodebuild: project.pbxproj not found at $PROJECT_PATH" >&2
  exit 0
fi

if grep -q "DEVELOPMENT_TEAM = " "$PROJECT_PATH"; then
  echo "ci_pre_xcodebuild: DEVELOPMENT_TEAM already present in pbxproj, skipping injection"
  exit 0
fi

# Insert `DEVELOPMENT_TEAM = <id>;` right after each `CODE_SIGN_STYLE = Automatic;`
# line. Tab indentation matches the project's existing convention.
perl -i -pe 's|(CODE_SIGN_STYLE = Automatic;)|\1\n\t\t\t\tDEVELOPMENT_TEAM = '"$DEVELOPMENT_TEAM"';|g' "$PROJECT_PATH"
INSERTED=$(grep -c "DEVELOPMENT_TEAM = " "$PROJECT_PATH")
echo "ci_pre_xcodebuild: injected DEVELOPMENT_TEAM into $INSERTED build configuration(s)"

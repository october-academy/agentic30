#!/bin/sh
# Xcode Cloud pre-xcodebuild hook.
#
# pbxproj uses `CODE_SIGN_STYLE = Automatic` but does not commit a
# `DEVELOPMENT_TEAM` (kept out of the public repo). Xcode Cloud cannot
# choose a signing identity without it and surfaces the result as a GitHub
# `action_required` check. Patch the team id into the project file at build
# time — the committed pbxproj remains team-id-free, and the value comes
# from the workflow's confidential environment variable.
#
# Setup (one-time, in App Store Connect → Xcode Cloud → Workflow):
#   - Add environment variable `DEVELOPMENT_TEAM` (Value type: Confidential),
#     value = your 10-char Apple Developer Team ID.
set -euo pipefail

if [ -z "${CI_WORKSPACE:-}" ]; then
  echo "ci_pre_xcodebuild: CI_WORKSPACE not set; not running under Xcode Cloud." >&2
  exit 0
fi

if [ -z "${DEVELOPMENT_TEAM:-}" ]; then
  echo "ci_pre_xcodebuild: DEVELOPMENT_TEAM env var not set." >&2
  echo "  Set it in App Store Connect → Xcode Cloud → Workflow → Environment" >&2
  echo "  as Confidential. Without it Automatic signing has no team to use" >&2
  echo "  and Xcode Cloud reports the build as action_required." >&2
  exit 1
fi

PROJECT_PATH="$CI_WORKSPACE/agentic30.xcodeproj/project.pbxproj"
if [ ! -f "$PROJECT_PATH" ]; then
  echo "ci_pre_xcodebuild: project.pbxproj not found at $PROJECT_PATH" >&2
  exit 1
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

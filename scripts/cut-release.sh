#!/usr/bin/env bash
set -euo pipefail

# One-command release cut for the agentic30 macOS app.
#
# Bumps the version in BOTH authoritative sources (agentic30/Info.plist AND
# project.pbxproj), runs scripts/preflight-release.sh, commits the bump, then
# creates and pushes a vYYYYMMDD-HHMM tag — which triggers the GitHub Actions
# release workflow (parallel arm64 + Intel x64 builds).
#
# Usage:
#   scripts/cut-release.sh --bump build       # CFBundleVersion +1, keep marketing version
#   scripts/cut-release.sh --bump patch       # CFBundleVersion +1 and marketing x.y.(z+1)
#   scripts/cut-release.sh --set 1.0.8/9      # explicit MARKETING/BUILD
#   scripts/cut-release.sh                     # no bump; preflight + tag current version
#   scripts/cut-release.sh --bump build --dry-run   # bump + preflight only, no commit/tag/push
#
# Pass-through to preflight: --skip-build / --skip-tests.

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

INFO_PLIST="agentic30/Info.plist"
PBXPROJ="agentic30.xcodeproj/project.pbxproj"

dry=0
bump=""
setver=""
preflight_args=()
while [ $# -gt 0 ]; do
  case "$1" in
    --dry-run) dry=1 ;;
    --bump) bump="${2:-}"; shift ;;
    --set) setver="${2:-}"; shift ;;
    --skip-build|--skip-tests) preflight_args+=("$1") ;;
    -h|--help) sed -n '3,20p' "$0"; exit 0 ;;
    *) echo "unknown arg: $1" >&2; exit 2 ;;
  esac
  shift
done

cur_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO_PLIST")"
cur_short="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST")"
new_build="$cur_build"
new_short="$cur_short"

if [ -n "$setver" ]; then
  new_short="${setver%/*}"
  new_build="${setver#*/}"
elif [ "$bump" = "build" ]; then
  new_build=$((cur_build + 1))
elif [ "$bump" = "patch" ]; then
  new_build=$((cur_build + 1))
  new_short="$(printf '%s' "$cur_short" | awk -F. '{ $3 += 1; print $1"."$2"."$3 }')"
elif [ -n "$bump" ]; then
  echo "unknown --bump value '$bump' (use: build | patch)" >&2; exit 2
fi

if [ "$new_build" != "$cur_build" ] || [ "$new_short" != "$cur_short" ]; then
  echo "Bumping version: $cur_short (build $cur_build) -> $new_short (build $new_build)"
  /usr/libexec/PlistBuddy -c "Set :CFBundleVersion $new_build" "$INFO_PLIST"
  /usr/libexec/PlistBuddy -c "Set :CFBundleShortVersionString $new_short" "$INFO_PLIST"
  sed -i '' -E "s/CURRENT_PROJECT_VERSION = [0-9]+;/CURRENT_PROJECT_VERSION = $new_build;/g" "$PBXPROJ"
  sed -i '' -E "s/MARKETING_VERSION = [0-9.]+;/MARKETING_VERSION = $new_short;/g" "$PBXPROJ"
else
  echo "No version change requested; preflighting current version $cur_short (build $cur_build)."
fi

scripts/preflight-release.sh "${preflight_args[@]+"${preflight_args[@]}"}"

if [ "$dry" = "1" ]; then
  echo "DRY RUN — version set + preflight passed. Not committing/tagging/pushing."
  exit 0
fi

if ! git diff --quiet -- "$INFO_PLIST" "$PBXPROJ"; then
  git add "$INFO_PLIST" "$PBXPROJ"
  git commit -m "chore(release): bump version to $new_short (build $new_build)"
fi

TAG="v$(date +%Y%m%d-%H%M)"
if git rev-parse "$TAG" >/dev/null 2>&1; then
  echo "ERROR: tag $TAG already exists; wait a minute and retry" >&2
  exit 1
fi
git tag -a "$TAG" -m "Agentic30 $new_short (build $new_build)"
git push origin HEAD
git push origin "$TAG"

echo ""
echo "✅ Pushed $TAG (version $new_short, build $new_build)."
echo "   Release workflow: https://github.com/october-academy/agentic30/actions/workflows/release.yml"
echo "   After it completes, verify: curl -s https://updates.agentic30.app/appcast.xml | grep sparkle:version"

#!/usr/bin/env bash
set -euo pipefail

# Pre-tag release preflight — catch the failures that otherwise waste a full
# ~20-minute CI release cycle, BEFORE pushing a tag. Run on the dev's Mac.
#
# Checks, in order:
#   1. Version source consistency: agentic30/Info.plist (the authoritative
#      source — GENERATE_INFOPLIST_FILE=NO) must match project.pbxproj
#      (CURRENT_PROJECT_VERSION / MARKETING_VERSION). This catches the classic
#      "bumped pbxproj but not Info.plist" drift that ships a stale build number.
#   2. Sparkle monotonicity: CFBundleVersion must be strictly greater than the
#      live appcast's sparkle:version, or Sparkle won't offer the update.
#   3. Release compile dry-run: a real `xcodebuild build` (no signing) so
#      compile / actor-isolation errors surface in ~minutes locally instead of
#      ~20 min into CI.
#   4. Sidecar test suite (npm run test:sidecar).
#
# Usage:
#   scripts/preflight-release.sh                 # all checks
#   scripts/preflight-release.sh --skip-build    # version + tests only (fast)
#   scripts/preflight-release.sh --skip-tests    # skip the sidecar suite
#   SPARKLE_APPCAST_URL=... scripts/preflight-release.sh

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

APPCAST_URL="${SPARKLE_APPCAST_URL:-https://updates.agentic30.app/appcast.xml}"
INFO_PLIST="agentic30/Info.plist"
PBXPROJ="agentic30.xcodeproj/project.pbxproj"

skip_build=0
skip_tests=0
for a in "$@"; do
  case "$a" in
    --skip-build) skip_build=1 ;;
    --skip-tests) skip_tests=1 ;;
    -h|--help) sed -n '3,28p' "$0"; exit 0 ;;
    *) echo "unknown arg: $a" >&2; exit 2 ;;
  esac
done

fail() { echo "❌ PREFLIGHT FAIL: $*" >&2; exit 1; }
ok()   { echo "  ✓ $*"; }

echo "[1/4] Version source consistency (Info.plist <-> project.pbxproj)"
command -v /usr/libexec/PlistBuddy >/dev/null 2>&1 || fail "PlistBuddy not found (run on macOS)"
info_build="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleVersion' "$INFO_PLIST")"
info_short="$(/usr/libexec/PlistBuddy -c 'Print :CFBundleShortVersionString' "$INFO_PLIST")"
pbx_build="$(grep -oE 'CURRENT_PROJECT_VERSION = [0-9]+;' "$PBXPROJ" | grep -oE '[0-9]+' | sort -u)"
pbx_short="$(grep -oE 'MARKETING_VERSION = [0-9.]+;' "$PBXPROJ" | grep -oE '[0-9.]+' | sort -u)"
[ "$(printf '%s' "$pbx_build" | grep -c .)" = "1" ] || fail "project.pbxproj has non-uniform CURRENT_PROJECT_VERSION: $(echo $pbx_build)"
[ "$(printf '%s' "$pbx_short" | grep -c .)" = "1" ] || fail "project.pbxproj has non-uniform MARKETING_VERSION: $(echo $pbx_short)"
[[ "$info_build" =~ ^[0-9]+$ ]] || fail "CFBundleVersion must be an integer for Sparkle (got '$info_build')"
[ "$info_build" = "$pbx_build" ] || fail "CFBundleVersion ($info_build) != CURRENT_PROJECT_VERSION ($pbx_build) — bump BOTH files"
[ "$info_short" = "$pbx_short" ] || fail "CFBundleShortVersionString ($info_short) != MARKETING_VERSION ($pbx_short) — bump BOTH files"
ok "version $info_short (build $info_build) consistent across Info.plist + pbxproj"

echo "[2/4] Sparkle monotonicity vs live feed ($APPCAST_URL)"
live_build="$(curl -fsSL "$APPCAST_URL" 2>/dev/null | grep -oE '<sparkle:version>[0-9]+' | grep -oE '[0-9]+' | sort -n | tail -1 || true)"
if [ -z "$live_build" ]; then
  echo "  ! could not read live appcast; skipping monotonicity check (network?)"
else
  [ "$info_build" -gt "$live_build" ] || fail "CFBundleVersion ($info_build) must be > live Sparkle build ($live_build); existing users would not be offered this update"
  ok "build $info_build > live $live_build"
fi

echo "[3/4] Release compile dry-run"
if [ "$skip_build" = "1" ]; then
  echo "  - skipped (--skip-build)"
else
  command -v xcodebuild >/dev/null 2>&1 || fail "xcodebuild not found; run on a Mac or pass --skip-build"
  if ! xcodebuild build \
      -project agentic30.xcodeproj \
      -scheme agentic30 \
      -configuration Release \
      -destination 'generic/platform=macOS' \
      CODE_SIGNING_ALLOWED=NO \
      -quiet; then
    fail "Release build failed — fix compile/actor-isolation errors before tagging"
  fi
  ok "Release configuration compiles"
fi

echo "[4/4] Sidecar test suite"
if [ "$skip_tests" = "1" ]; then
  echo "  - skipped (--skip-tests)"
else
  npm run test:sidecar || fail "npm run test:sidecar failed"
  ok "sidecar tests pass"
fi

echo ""
echo "✅ preflight passed — safe to tag (version $info_short, build $info_build)"

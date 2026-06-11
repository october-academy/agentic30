#!/usr/bin/env bash
set -euo pipefail

# Print the newest released section of a Keep-a-Changelog file to stdout —
# the first "## [x.y.z] - date" heading (skipping "## [Unreleased]") through
# the line before the next "## [" heading. Prints nothing when no released
# section exists; callers treat empty output as "fall back to the full file".
#
# Usage: scripts/changelog-latest-notes.sh [CHANGELOG.md]

CHANGELOG="${1:-CHANGELOG.md}"

if [ ! -f "$CHANGELOG" ]; then
  echo "ERROR: changelog not found: $CHANGELOG" >&2
  exit 1
fi

awk '
  /^## \[/ {
    if (in_section) exit
    if ($0 !~ /^## \[Unreleased\]/) in_section = 1
  }
  in_section { print }
' "$CHANGELOG"

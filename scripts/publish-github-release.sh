#!/usr/bin/env bash
set -euo pipefail

# Publish built release artifacts to GitHub Releases.
#
# Required environment:
#   RELEASE_TAG                 — release tag to create/update (for example v20260602-1)
#
# Optional environment:
#   BUILD_ENV_FILE              — env file to source (defaults to secrets/build.env)
#   SPARKLE_APPCAST_DIR         — appcast staging folder (defaults to build/appcast)
#   GITHUB_RELEASE_REPO         — owner/repo (defaults to current gh repo)
#   GITHUB_RELEASE_TITLE        — release title (defaults to RELEASE_TAG)
#   GITHUB_RELEASE_NOTES_FILE   — notes file (defaults to CHANGELOG.md)
#   GITHUB_RELEASE_DRAFT        — 1 to create a draft release
#   GITHUB_RELEASE_PRERELEASE   — 1 to mark release as prerelease
#   GITHUB_RELEASE_DRY_RUN      — 1 to print actions without publishing
#   GITHUB_RELEASE_CLOBBER      — 1 to overwrite existing assets (defaults to 1)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${BUILD_ENV_FILE:-$ROOT/secrets/build.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
fi

RELEASE_TAG="${RELEASE_TAG:-}"
SPARKLE_APPCAST_DIR="${SPARKLE_APPCAST_DIR:-build/appcast}"
GITHUB_RELEASE_TITLE="${GITHUB_RELEASE_TITLE:-$RELEASE_TAG}"
GITHUB_RELEASE_DRAFT="${GITHUB_RELEASE_DRAFT:-0}"
GITHUB_RELEASE_PRERELEASE="${GITHUB_RELEASE_PRERELEASE:-0}"
GITHUB_RELEASE_DRY_RUN="${GITHUB_RELEASE_DRY_RUN:-0}"
GITHUB_RELEASE_CLOBBER="${GITHUB_RELEASE_CLOBBER:-1}"

if [ -z "$RELEASE_TAG" ]; then
  echo "ERROR: RELEASE_TAG is required" >&2
  exit 2
fi
if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: gh CLI is required" >&2
  exit 2
fi

if [ -z "${GITHUB_RELEASE_REPO:-}" ]; then
  GITHUB_RELEASE_REPO="$(gh repo view --json nameWithOwner --jq .nameWithOwner)"
fi

assets=()
if [ -d "$SPARKLE_APPCAST_DIR" ]; then
  while IFS= read -r file; do
    assets+=("$file")
  done < <(find "$SPARKLE_APPCAST_DIR" -maxdepth 1 -type f \( -name 'agentic30-*.dmg' -o -name 'agentic30-*.dmg.md' -o -name 'appcast*.xml' \) | sort)
fi

if [ "${#assets[@]}" -eq 0 ]; then
  echo "ERROR: no release assets found in $SPARKLE_APPCAST_DIR" >&2
  exit 1
fi

GITHUB_RELEASE_NOTES_FILE="${GITHUB_RELEASE_NOTES_FILE:-CHANGELOG.md}"
if [ ! -f "$GITHUB_RELEASE_NOTES_FILE" ]; then
  echo "ERROR: release notes file not found: $GITHUB_RELEASE_NOTES_FILE" >&2
  exit 1
fi

create_args=(release create "$RELEASE_TAG" --repo "$GITHUB_RELEASE_REPO" --title "$GITHUB_RELEASE_TITLE" --notes-file "$GITHUB_RELEASE_NOTES_FILE")
if [ "$GITHUB_RELEASE_DRAFT" = "1" ]; then
  create_args+=(--draft)
fi
if [ "$GITHUB_RELEASE_PRERELEASE" = "1" ]; then
  create_args+=(--prerelease)
fi
upload_args=(release upload "$RELEASE_TAG" --repo "$GITHUB_RELEASE_REPO")
if [ "$GITHUB_RELEASE_CLOBBER" = "1" ]; then
  upload_args+=(--clobber)
fi
upload_args+=("${assets[@]}")

echo "GitHub release target:"
echo "  repo: $GITHUB_RELEASE_REPO"
echo "  tag:  $RELEASE_TAG"
printf '  assets:\n'
printf '    %s\n' "${assets[@]}"

if [ "$GITHUB_RELEASE_DRY_RUN" = "1" ]; then
  echo "DRY RUN: gh ${create_args[*]}"
  echo "DRY RUN: gh ${upload_args[*]}"
  exit 0
fi

if gh release view "$RELEASE_TAG" --repo "$GITHUB_RELEASE_REPO" >/dev/null 2>&1; then
  echo "GitHub release already exists: $RELEASE_TAG"
else
  # Parallel per-arch release jobs can race on creation; tolerate "already
  # exists" as long as the release is visible afterwards.
  if ! gh "${create_args[@]}"; then
    echo "WARN: gh release create failed; checking whether a concurrent job created $RELEASE_TAG..." >&2
    gh release view "$RELEASE_TAG" --repo "$GITHUB_RELEASE_REPO" >/dev/null
  fi
fi
gh "${upload_args[@]}"

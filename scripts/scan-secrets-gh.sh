#!/usr/bin/env bash
set -euo pipefail

if ! command -v gh >/dev/null 2>&1; then
  echo "ERROR: GitHub CLI (gh) is required for scan:secrets:gh." >&2
  echo "Install it from https://cli.github.com/ and run 'gh auth login'." >&2
  exit 2
fi

if ! gh auth status >/dev/null 2>&1; then
  echo "ERROR: gh is not authenticated. Run 'gh auth login' first." >&2
  exit 2
fi

if ! command -v trufflehog >/dev/null 2>&1; then
  echo "ERROR: trufflehog is required for scan:secrets:gh." >&2
  echo "Install it with 'brew install trufflehog'." >&2
  exit 2
fi

default_branch="$(gh repo view --json defaultBranchRef --jq '.defaultBranchRef.name')"
base_ref="origin/${default_branch}"

if ! git rev-parse --verify --quiet "${base_ref}" >/dev/null; then
  git fetch origin "${default_branch}"
fi
base_sha="$(git merge-base "${base_ref}" HEAD)"

npm run check:public-safety

trufflehog git file://. \
  --since-commit "${base_sha}" \
  --branch HEAD \
  --results=verified,unknown \
  --fail \
  --fail-on-scan-errors \
  --no-update

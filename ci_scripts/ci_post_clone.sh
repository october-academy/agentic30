#!/bin/sh
# Xcode Cloud post-clone hook.
#
# Xcode Cloud does not run `npm install` automatically. The agentic30 build
# phase from commit 9bb26b3 handles bootstrapping sidecar deps for local
# Xcode runs, but doing it here too ensures the bundle is ready before
# xcodebuild even starts (avoids the bootstrap script racing with Xcode's
# resource copy).
set -euo pipefail

if [ -z "${CI_WORKSPACE:-}" ]; then
  echo "ci_post_clone: CI_WORKSPACE not set; not running under Xcode Cloud." >&2
  exit 0
fi

cd "$CI_WORKSPACE"

if [ ! -f package.json ]; then
  echo "ci_post_clone: no package.json at $CI_WORKSPACE, skipping npm install"
  exit 0
fi

echo "ci_post_clone: node version $(node --version 2>/dev/null || echo none)"
echo "ci_post_clone: npm version $(npm --version 2>/dev/null || echo none)"

# Use `npm ci` so the lockfile is the source of truth — Xcode Cloud
# environments are ephemeral, no need to mutate the lockfile.
npm ci --no-audit --no-fund
echo "ci_post_clone: sidecar dependencies installed"

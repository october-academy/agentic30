#!/bin/sh
# Xcode Cloud post-clone hook.
#
# Two responsibilities:
#   1. Make `node` available on PATH. Xcode Cloud's macOS image does NOT
#      ship Node.js, and the agentic30 build phase from commit 9bb26b3
#      bails with `node not found in PATH; install Node.js 20+ or set
#      NODE_BINARY to build the sidecar bundle` without it. The bootstrap
#      script searches `/opt/homebrew/bin/node` as a fallback, so installing
#      via brew is the simplest fix that needs no further wiring.
#   2. Pre-warm sidecar dependencies via `npm ci`. The build phase from
#      9bb26b3 also installs deps when missing, but doing it here lets the
#      Xcode resource-copy phase see a complete bundle from the start.
set -euo pipefail

if [ -z "${CI_WORKSPACE:-}" ]; then
  echo "ci_post_clone: CI_WORKSPACE not set; not running under Xcode Cloud." >&2
  exit 0
fi

cd "$CI_WORKSPACE"

if ! command -v node >/dev/null 2>&1; then
  echo "ci_post_clone: node not found, installing via brew (this takes ~30s)"
  # `brew install node` lands at /opt/homebrew/bin/node on Apple Silicon
  # runners — exactly where the build phase fallback expects it.
  brew install node
fi

echo "ci_post_clone: node $(node --version)"
echo "ci_post_clone: npm $(npm --version)"

if [ ! -f package.json ]; then
  echo "ci_post_clone: no package.json at $CI_WORKSPACE, skipping npm install"
  exit 0
fi

# `npm ci` honors the lockfile and is non-mutating — Xcode Cloud workspaces
# are ephemeral so there's no value to npm install.
npm ci --no-audit --no-fund
echo "ci_post_clone: sidecar dependencies installed"

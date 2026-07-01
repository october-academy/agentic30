#!/bin/sh
# Xcode Cloud post-clone hook.
#
# Make `node` available so the agentic30 build phase from commit 9bb26b3
# can find it. The build phase script searches PATH plus hard-coded
# fallbacks (`/opt/homebrew/bin/node`, `/usr/local/bin/node`, mise/asdf/
# volta shims). Installing via brew lands node at /opt/homebrew/bin/node
# on Apple Silicon runners — exactly where the fallback expects it.
#
# Two earlier attempts (b2452b2, 06c99a5) left the build phase with the
# same `node not found in PATH` error, so this version is verbose by
# design: every step prints a diagnostic line to the Xcode Cloud build
# log so we can see which step is silently no-op'ing.
set -eu
# `set -x` so every command shows up in the build log.
set -x

echo "ci_post_clone: shell=$0"
echo "ci_post_clone: pwd=$(pwd)"
echo "ci_post_clone: HOME=${HOME:-unset}"
echo "ci_post_clone: CI_WORKSPACE=${CI_WORKSPACE:-unset}"
echo "ci_post_clone: PATH=$PATH"
echo "ci_post_clone: arch=$(uname -m)"

SCRIPT_DIR=$(unset CDPATH; cd -- "$(dirname -- "$0")" && pwd)
REPO_ROOT="${CI_WORKSPACE:-$(unset CDPATH; cd -- "$SCRIPT_DIR/.." && pwd)}"
if [ -z "${CI_WORKSPACE:-}" ]; then
  echo "ci_post_clone: CI_WORKSPACE not set; using repository root $REPO_ROOT"
fi

cd "$REPO_ROOT"

NODE_BIN=$(SRCROOT="$REPO_ROOT" "$REPO_ROOT/scripts/xcode-build-sidecar.sh" --print-node)
NPM_BIN=$(dirname "$NODE_BIN")/npm
if [ ! -x "$NPM_BIN" ]; then
  echo "ci_post_clone: ERROR npm missing next to node at $NPM_BIN"
  exit 1
fi

echo "ci_post_clone: node at $NODE_BIN ($("$NODE_BIN" --version))"
echo "ci_post_clone: npm at $NPM_BIN ($("$NPM_BIN" --version))"

if [ ! -f package.json ]; then
  echo "ci_post_clone: no package.json; skipping npm ci"
  exit 0
fi

"$NPM_BIN" ci --no-audit --no-fund
echo "ci_post_clone: sidecar dependencies installed"

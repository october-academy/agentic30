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

if [ -z "${CI_WORKSPACE:-}" ]; then
  echo "ci_post_clone: CI_WORKSPACE not set; not running under Xcode Cloud."
  exit 0
fi

cd "$CI_WORKSPACE"

# Pick a brew binary explicitly — Xcode Cloud may not have it on PATH.
BREW=""
if command -v brew >/dev/null 2>&1; then
  BREW=$(command -v brew)
elif [ -x /opt/homebrew/bin/brew ]; then
  BREW=/opt/homebrew/bin/brew
elif [ -x /usr/local/bin/brew ]; then
  BREW=/usr/local/bin/brew
fi

if [ -n "$BREW" ]; then
  echo "ci_post_clone: brew at $BREW"
  "$BREW" --version || true
else
  echo "ci_post_clone: no brew found in any expected location"
fi

# If node already present, skip install.
if command -v node >/dev/null 2>&1; then
  echo "ci_post_clone: node already at $(command -v node)"
else
  if [ -z "$BREW" ]; then
    echo "ci_post_clone: cannot install node — brew is missing"
    exit 1
  fi
  echo "ci_post_clone: installing node via $BREW"
  "$BREW" install node
fi

# Verify the build phase will be able to find node.
NODE_BIN=$(command -v node || true)
if [ -z "$NODE_BIN" ]; then
  echo "ci_post_clone: ERROR node still missing after install"
  ls -la /opt/homebrew/bin/ 2>/dev/null || true
  ls -la /usr/local/bin/ 2>/dev/null || true
  exit 1
fi

echo "ci_post_clone: node at $NODE_BIN ($(node --version))"
echo "ci_post_clone: npm at $(command -v npm) ($(npm --version))"

# Confirm the build phase's preferred path actually has node.
for c in /opt/homebrew/bin/node /usr/local/bin/node; do
  if [ -x "$c" ]; then
    echo "ci_post_clone: build-phase fallback path OK: $c"
  fi
done

if [ ! -f package.json ]; then
  echo "ci_post_clone: no package.json; skipping npm ci"
  exit 0
fi

npm ci --no-audit --no-fund
echo "ci_post_clone: sidecar dependencies installed"

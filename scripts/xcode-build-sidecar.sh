#!/usr/bin/env bash
set -euo pipefail

cd "${SRCROOT:?}"

export HOMEBREW_NO_AUTO_UPDATE="${HOMEBREW_NO_AUTO_UPDATE:-1}"
export HOMEBREW_NO_INSTALL_CLEANUP="${HOMEBREW_NO_INSTALL_CLEANUP:-1}"
export HOMEBREW_NO_ENV_HINTS="${HOMEBREW_NO_ENV_HINTS:-1}"
export PATH="$SRCROOT/node_modules/.bin:$HOME/.local/share/mise/shims:$HOME/.asdf/shims:$HOME/.volta/bin:/opt/homebrew/bin:/Users/local/Homebrew/bin:/usr/local/bin:$PATH"

host_arch="$(uname -m)"

node_process_arch() {
  "$1" -p 'process.arch' 2>/dev/null || true
}

node_is_usable() {
  local candidate="$1"
  local arch

  if [ ! -x "$candidate" ]; then
    return 1
  fi

  arch="$(node_process_arch "$candidate")"
  if [ "$host_arch" = "arm64" ] && [ "$arch" != "arm64" ]; then
    echo "[build-sidecar] skipping non-native node on arm64 host: $candidate (process.arch=${arch:-unknown})" >&2
    return 1
  fi

  return 0
}

find_node_bin() {
  local candidate

  if [ -n "${NODE_BINARY:-}" ]; then
    node_is_usable "$NODE_BINARY" && printf '%s\n' "$NODE_BINARY"
    return
  fi

  for candidate in \
    "$HOME/.local/share/mise/shims/node" \
    "$HOME/.asdf/shims/node" \
    "$HOME/.volta/bin/node" \
    "/opt/homebrew/bin/node" \
    "/Users/local/Homebrew/bin/node" \
    "/usr/local/bin/node" \
    "$(command -v node 2>/dev/null || true)"; do
    if [ -n "$candidate" ] && node_is_usable "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

find_brew_bin() {
  local candidate

  for candidate in \
    "/opt/homebrew/bin/brew" \
    "/Users/local/Homebrew/bin/brew" \
    "$(command -v brew 2>/dev/null || true)" \
    "/usr/local/bin/brew"; do
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done

  return 1
}

NODE_BIN="$(find_node_bin || true)"
if [ -z "$NODE_BIN" ] && { [ -n "${CI_WORKSPACE:-}" ] || [ -n "${CI:-}" ] || [ -n "${XCODE_CLOUD:-}" ] || [ -d /Volumes/workspace/repository ]; }; then
  BREW="$(find_brew_bin || true)"
  if [ -n "$BREW" ]; then
    echo "[build-sidecar] installing node via $BREW (CI fallback)" >&2
    "$BREW" install node || true
    hash -r 2>/dev/null || true
    NODE_BIN="$(find_node_bin || true)"
  fi
fi

if [ -z "$NODE_BIN" ]; then
  if [ "$host_arch" = "arm64" ]; then
    echo "error: native arm64 node not found; install arm64 Node.js 20+ or set NODE_BINARY to an arm64 node binary" >&2
  else
    echo "error: node not found in PATH; install Node.js 20+ or set NODE_BINARY to build the sidecar bundle" >&2
  fi
  exit 1
fi

BUN_BIN="${BUN_BINARY:-$(command -v bun || true)}"
if [ -z "$BUN_BIN" ]; then
  for candidate in "$SRCROOT/node_modules/.bin/bun" "$HOME/.bun/bin/bun"; do
    if [ -x "$candidate" ]; then
      BUN_BIN="$candidate"
      break
    fi
  done
fi
if [ -n "$BUN_BIN" ]; then
  export BUN_BINARY="$BUN_BIN"
fi

echo "[build-sidecar] node=$NODE_BIN arch=$("$NODE_BIN" -p 'process.arch') bun=${BUN_BIN:-missing}" >&2
"$NODE_BIN" scripts/build-sidecar.mjs

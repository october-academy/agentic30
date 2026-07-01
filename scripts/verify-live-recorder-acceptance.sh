#!/usr/bin/env bash
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"

add_candidate() {
  local candidate="$1"
  if [ -n "$candidate" ]; then
    printf '%s\n' "$candidate"
  fi
}

node_can_run_verifier() {
  local candidate="$1"
  [ -x "$candidate" ] || return 1
  (
    cd "$ROOT"
    "$candidate" -e 'require("better-sqlite3")' >/dev/null 2>&1
  )
}

find_verifier_node() {
  local arch
  case "$(/usr/bin/uname -m)" in
    arm64) arch="arm64" ;;
    x86_64) arch="x64" ;;
    *) arch="" ;;
  esac

  local candidates=()
  candidates+=("${AGENTIC30_VERIFY_LIVE_RECORDER_NODE:-}")
  candidates+=("${NODE_BINARY:-}")
  if [ -n "${AGENTIC30_LIVE_SIGNED_APP_PATH:-}" ] && [ -n "$arch" ]; then
    candidates+=("${AGENTIC30_LIVE_SIGNED_APP_PATH}/Contents/Resources/sidecar/runtime/node-darwin-${arch}/bin/node")
  fi
  if [ -n "$arch" ]; then
    candidates+=("$ROOT/build/live-signed-e2e/DerivedData/Build/Products/Release/agentic30.app/Contents/Resources/sidecar/runtime/node-darwin-${arch}/bin/node")
  fi
  candidates+=("$HOME/.cache/codex-runtimes/codex-primary-runtime/dependencies/node/bin/node")
  candidates+=("$HOME/.local/share/mise/installs/node/latest/bin/node")
  candidates+=("$HOME/.local/share/mise/installs/node/lts/bin/node")
  candidates+=("$HOME/.asdf/installs/nodejs/latest/bin/node")

  local install_dir
  for install_dir in "$HOME"/.local/share/mise/installs/node/* "$HOME"/.asdf/installs/nodejs/*; do
    [ -d "$install_dir" ] || continue
    candidates+=("$install_dir/bin/node")
  done

  local path_node
  path_node="$(command -v node 2>/dev/null || true)"
  candidates+=("$path_node" "/opt/homebrew/bin/node" "/usr/local/bin/node" "/usr/bin/node")

  local seen="|"
  local candidate
  for candidate in "${candidates[@]}"; do
    [ -n "$candidate" ] || continue
    case "$seen" in
      *"|$candidate|"*) continue ;;
    esac
    seen="${seen}${candidate}|"
    if node_can_run_verifier "$candidate"; then
      printf '%s\n' "$candidate"
      return 0
    fi
  done
  return 1
}

NODE_BIN="$(find_verifier_node || true)"
if [ -z "$NODE_BIN" ]; then
  cat >&2 <<'EOF'
ERROR: compatible_node_not_found

The live recorder verifier needs a Node.js runtime that can load the repo's
better-sqlite3 native module. Set AGENTIC30_VERIFY_LIVE_RECORDER_NODE to a
compatible node binary, or rebuild node_modules for the Node on PATH.
EOF
  exit 127
fi

cd "$ROOT"
exec "$NODE_BIN" scripts/verify-live-recorder-acceptance.mjs "$@"

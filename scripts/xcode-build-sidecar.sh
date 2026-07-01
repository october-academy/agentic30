#!/usr/bin/env bash
set -euo pipefail

cd "${SRCROOT:?}"

export PATH="$SRCROOT/node_modules/.bin:$HOME/.local/share/mise/shims:$HOME/.asdf/shims:$HOME/.volta/bin:/opt/homebrew/bin:/Users/local/Homebrew/bin:/usr/local/bin:$PATH"

NODE_RUNTIME_VERSION="24.15.0"
NODE_RUNTIME_CACHE_DIR="${AGENTIC30_NODE_RUNTIME_CACHE_DIR:-$SRCROOT/.omx/node-runtime}"

host_arch="$(uname -m)"

runtime_arch() {
  case "$host_arch" in
    arm64) printf '%s\n' arm64 ;;
    x86_64) printf '%s\n' x64 ;;
    *) printf '%s\n' "$host_arch" ;;
  esac
}

runtime_sha256() {
  case "$1" in
    arm64) printf '%s\n' "372331b969779ab5d15b949884fc6eaf88d5afe87bde8ba881d6400b9100ffc4" ;;
    x64) printf '%s\n' "ffd5ee293467927f3ee731a553eb88fd1f48cf74eebc2d74a6babe4af228673b" ;;
    *) return 1 ;;
  esac
}

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

verify_sha256() {
  local file="$1"
  local expected="$2"
  local actual

  actual="$(shasum -a 256 "$file" | awk '{print $1}')"
  [ "$actual" = "$expected" ]
}

ensure_node_runtime() {
  local arch
  local archive
  local expected_sha
  local archive_path
  local extract_dir
  local node_path

  arch="$(runtime_arch)"
  expected_sha="$(runtime_sha256 "$arch")" || {
    echo "error: unsupported Node runtime architecture for host $(uname -m)" >&2
    return 1
  }
  archive="node-v${NODE_RUNTIME_VERSION}-darwin-${arch}.tar.gz"
  archive_path="$NODE_RUNTIME_CACHE_DIR/$archive"
  extract_dir="$NODE_RUNTIME_CACHE_DIR/node-v${NODE_RUNTIME_VERSION}-darwin-${arch}"
  node_path="$extract_dir/bin/node"

  if node_is_usable "$node_path"; then
    printf '%s\n' "$node_path"
    return 0
  fi

  mkdir -p "$NODE_RUNTIME_CACHE_DIR"
  if [ ! -f "$archive_path" ] || ! verify_sha256 "$archive_path" "$expected_sha"; then
    echo "[build-sidecar] downloading Node runtime $archive" >&2
    curl -fsSL "https://nodejs.org/dist/v${NODE_RUNTIME_VERSION}/${archive}" -o "$archive_path.tmp"
    mv "$archive_path.tmp" "$archive_path"
  fi
  verify_sha256 "$archive_path" "$expected_sha" || {
    echo "error: Node runtime checksum mismatch for $archive_path" >&2
    return 1
  }

  rm -rf "$extract_dir"
  tar -xzf "$archive_path" -C "$NODE_RUNTIME_CACHE_DIR"
  node_is_usable "$node_path" || {
    echo "error: downloaded Node runtime is not usable at $node_path" >&2
    return 1
  }
  printf '%s\n' "$node_path"
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

  ensure_node_runtime
}

NODE_BIN="$(find_node_bin || true)"
if [ -z "$NODE_BIN" ]; then
  if [ "$host_arch" = "arm64" ]; then
    echo "error: native arm64 node not found; install arm64 Node.js 20+ or set NODE_BINARY to an arm64 node binary" >&2
  else
    echo "error: node not found in PATH; install Node.js 20+ or set NODE_BINARY to build the sidecar bundle" >&2
  fi
  exit 1
fi

if [ "${1:-}" = "--print-node" ]; then
  printf '%s\n' "$NODE_BIN"
  exit 0
fi

NODE_DIR="$(dirname "$NODE_BIN")"
export PATH="$NODE_DIR:$PATH"

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

#!/usr/bin/env bash
set -euo pipefail

sidecar_root="${CODESIGNING_FOLDER_PATH:?}/Contents/Resources/sidecar"
entitlements="${SRCROOT:?}/agentic30/agentic30.entitlements"

if [ ! -d "$sidecar_root" ]; then
  echo "warning: sidecar resources not found at $sidecar_root" >&2
  exit 0
fi

if [ ! -f "$entitlements" ]; then
  echo "error: sidecar signing entitlements missing at $entitlements" >&2
  exit 1
fi

identity="${EXPANDED_CODE_SIGN_IDENTITY:--}"
if [ -z "$identity" ] || [ "$identity" = "Sign to Run Locally" ]; then
  identity="-"
fi

codesign_bin="${CODESIGN_BINARY:-/usr/bin/codesign}"
if [ ! -x "$codesign_bin" ]; then
  echo "error: codesign executable not found at $codesign_bin" >&2
  exit 1
fi

timestamp_mode=timestamp
if [ "$identity" = "-" ]; then
  timestamp_mode=none
fi

display_path() {
  case "$1" in
    "$sidecar_root"/*) printf '%s\n' "${1#"$sidecar_root"/}" ;;
    *) printf '%s\n' "$1" ;;
  esac
}

sign_binary() {
  local binary="$1"
  local include_entitlements="$2"
  local mode="$3"

  local args=(--force --sign "$identity")
  if [ "$mode" = "timestamp" ]; then
    args+=(--timestamp)
  else
    args+=(--timestamp=none)
  fi
  args+=(--options runtime)
  if [ "$include_entitlements" = "1" ]; then
    args+=(--entitlements "$entitlements")
  fi
  args+=("$binary")

  local output
  local status
  set +e
  output="$("$codesign_bin" "${args[@]}" 2>&1)"
  status=$?
  set -e
  codesign_output="$output"

  if [ "$status" -eq 0 ]; then
    if [ -n "$output" ]; then
      printf '%s\n' "$output"
    fi
    return 0
  fi

  return "$status"
}

report_codesign_failure() {
  local binary="$1"
  local include_entitlements="$2"
  local mode="$3"
  local display
  display="$(display_path "$binary")"

  echo "error: codesign failed for sidecar binary: $display" >&2
  echo "error: identity=$identity timestamp=$mode entitlements=$include_entitlements" >&2
  if [ -n "$codesign_output" ]; then
    printf '%s\n' "$codesign_output" >&2
  fi
}

signed=0
jit_signed=0
timestamp_fallbacks=0
codesign_output=""
while IFS= read -r -d '' binary; do
  if ! file -b "$binary" | grep -q 'Mach-O'; then
    continue
  fi

  include_entitlements=0
  if [ "$(basename "$binary")" = "node" ]; then
    include_entitlements=1
    jit_signed=$((jit_signed + 1))
  fi

  sign_status=0
  sign_binary "$binary" "$include_entitlements" "$timestamp_mode" || sign_status=$?
  if [ "$sign_status" -ne 0 ]; then
    if [ "$identity" != "-" ] && [ "$timestamp_mode" = "timestamp" ]; then
      echo "warning: timestamp codesign failed for sidecar binary: $(display_path "$binary")" >&2
      if [ -n "$codesign_output" ]; then
        printf '%s\n' "$codesign_output" >&2
      fi
      echo "warning: retrying sidecar binary without timestamp: $(display_path "$binary")" >&2
      retry_status=0
      sign_binary "$binary" "$include_entitlements" none || retry_status=$?
      if [ "$retry_status" -ne 0 ]; then
        report_codesign_failure "$binary" "$include_entitlements" none
        exit "$retry_status"
      fi
      timestamp_fallbacks=$((timestamp_fallbacks + 1))
    else
      report_codesign_failure "$binary" "$include_entitlements" "$timestamp_mode"
      exit "$sign_status"
    fi
  fi
  signed=$((signed + 1))
done < <(find "$sidecar_root" -type f \( -perm -111 -o -name '*.node' -o -name '*.dylib' -o -name '*.so' \) -print0)

if [ "$jit_signed" -eq 0 ]; then
  echo "error: bundled Node runtime was not found under $sidecar_root" >&2
  exit 1
fi

if [ "${SCRIPT_OUTPUT_FILE_COUNT:-0}" -gt 0 ]; then
  mkdir -p "$(dirname "$SCRIPT_OUTPUT_FILE_0")"
  printf 'signed=%s\njit_signed=%s\ntimestamp_fallbacks=%s\n' "$signed" "$jit_signed" "$timestamp_fallbacks" > "$SCRIPT_OUTPUT_FILE_0"
fi

echo "[sign-sidecar] signed $signed native binaries ($jit_signed with JIT entitlements, $timestamp_fallbacks timestamp fallbacks)"

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

if [ "$identity" = "-" ]; then
  ts_arg=(--timestamp=none)
else
  ts_arg=(--timestamp)
fi

signed=0
jit_signed=0
while IFS= read -r -d '' binary; do
  if ! file -b "$binary" | grep -q 'Mach-O'; then
    continue
  fi

  if [ "$(basename "$binary")" = "node" ]; then
    codesign --force --sign "$identity" "${ts_arg[@]}" --options runtime \
      --entitlements "$entitlements" \
      "$binary"
    jit_signed=$((jit_signed + 1))
  else
    codesign --force --sign "$identity" "${ts_arg[@]}" --options runtime "$binary"
  fi
  signed=$((signed + 1))
done < <(find "$sidecar_root" -type f \( -perm -111 -o -name '*.node' -o -name '*.dylib' -o -name '*.so' \) -print0)

if [ "$jit_signed" -eq 0 ]; then
  echo "error: bundled Node runtime was not found under $sidecar_root" >&2
  exit 1
fi

if [ "${SCRIPT_OUTPUT_FILE_COUNT:-0}" -gt 0 ]; then
  mkdir -p "$(dirname "$SCRIPT_OUTPUT_FILE_0")"
  printf 'signed=%s\njit_signed=%s\n' "$signed" "$jit_signed" > "$SCRIPT_OUTPUT_FILE_0"
fi

echo "[sign-sidecar] signed $signed native binaries ($jit_signed with JIT entitlements)"

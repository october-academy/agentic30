#!/usr/bin/env bash
set -euo pipefail

TRUFFLEHOG_VERSION="3.95.2"
TRUFFLEHOG_BASE_URL="https://github.com/trufflesecurity/trufflehog/releases/download/v${TRUFFLEHOG_VERSION}"

case "$(uname -s):$(uname -m)" in
  Linux:x86_64)
    archive_os="linux"
    archive_arch="amd64"
    expected_sha="fded1c139fe4d3872d9fde65e1428d82d5556d655439e82f492d87ae8d846779"
    ;;
  Linux:aarch64 | Linux:arm64)
    archive_os="linux"
    archive_arch="arm64"
    expected_sha="5588f09da2d52e840273b6a8c57751021709182dff42574f09dbaf81ebdf8366"
    ;;
  Darwin:x86_64)
    archive_os="darwin"
    archive_arch="amd64"
    expected_sha="e414f488fcf0c39f2b2ce283eaa15ab37cab4569e03a5763d19dc592ca4b0cdd"
    ;;
  Darwin:arm64)
    archive_os="darwin"
    archive_arch="arm64"
    expected_sha="382c719794eda239e6d4944ea40efbdce65e8b6a36cd030948254068e666185c"
    ;;
  *)
    echo "ERROR: unsupported TruffleHog platform: $(uname -s) $(uname -m)" >&2
    exit 2
    ;;
esac

tmpdir="$(mktemp -d)"
trap 'rm -rf "$tmpdir"' EXIT

archive_name="trufflehog_${TRUFFLEHOG_VERSION}_${archive_os}_${archive_arch}.tar.gz"
archive_path="$tmpdir/$archive_name"
install_dir="$tmpdir/trufflehog"
mkdir -p "$install_dir"

curl --fail --location --silent --show-error \
  "$TRUFFLEHOG_BASE_URL/$archive_name" \
  --output "$archive_path"

if command -v sha256sum >/dev/null 2>&1; then
  actual_sha="$(sha256sum "$archive_path" | awk '{print $1}')"
else
  actual_sha="$(shasum -a 256 "$archive_path" | awk '{print $1}')"
fi
if [ "$actual_sha" != "$expected_sha" ]; then
  echo "ERROR: $archive_name checksum mismatch" >&2
  echo "expected: $expected_sha" >&2
  echo "actual:   $actual_sha" >&2
  exit 1
fi

tar -xzf "$archive_path" -C "$install_dir"
trufflehog_bin="$install_dir/trufflehog"
if [ ! -x "$trufflehog_bin" ]; then
  echo "ERROR: expected TruffleHog binary not found in $archive_name" >&2
  exit 1
fi

"$trufflehog_bin" --version
"$trufflehog_bin" git file://. \
  --results=verified,unknown \
  --fail \
  --fail-on-scan-errors \
  --no-update

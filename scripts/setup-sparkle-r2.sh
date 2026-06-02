#!/usr/bin/env bash
set -euo pipefail

# One-time Cloudflare R2 setup for Sparkle updates served from
# https://updates.agentic30.app/.
#
# This script intentionally uses Wrangler auth instead of raw Cloudflare API
# tokens. Run `wrangler login` first if `wrangler whoami` fails.
#
# Optional environment:
#   BUILD_ENV_FILE              — env file to source (defaults to secrets/build.env)
#   CLOUDFLARE_ZONE_ID          — zone id for agentic30.app
#                                (defaults to verified agentic30.app zone id)
#   SPARKLE_R2_BUCKET           — R2 bucket name (defaults to agentic30-sparkle)
#   SPARKLE_UPDATE_DOMAIN       — custom domain (defaults to updates.agentic30.app)
#   SPARKLE_WRANGLER_BIN        — wrangler executable (defaults to wrangler)
#   SPARKLE_R2_LOCATION         — R2 location hint (defaults to apac)

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
cd "$ROOT"

ENV_FILE="${BUILD_ENV_FILE:-$ROOT/secrets/build.env}"
if [ -f "$ENV_FILE" ]; then
  set -a
  # shellcheck disable=SC1090
  source "$ENV_FILE"
  set +a
else
  echo "WARN: $ENV_FILE not found; expecting env vars to be exported inline." >&2
fi

SPARKLE_R2_BUCKET="${SPARKLE_R2_BUCKET:-agentic30-sparkle}"
SPARKLE_UPDATE_DOMAIN="${SPARKLE_UPDATE_DOMAIN:-updates.agentic30.app}"
SPARKLE_WRANGLER_BIN="${SPARKLE_WRANGLER_BIN:-wrangler}"
SPARKLE_R2_LOCATION="${SPARKLE_R2_LOCATION:-apac}"
CLOUDFLARE_ZONE_ID="${CLOUDFLARE_ZONE_ID:-b770693582734b1854ac556acd00823f}"

if ! command -v "$SPARKLE_WRANGLER_BIN" >/dev/null 2>&1; then
  echo "ERROR: wrangler executable not found: $SPARKLE_WRANGLER_BIN" >&2
  exit 2
fi
if ! "$SPARKLE_WRANGLER_BIN" whoami >/dev/null 2>&1; then
  echo "ERROR: wrangler is not authenticated; run 'wrangler login' first" >&2
  exit 2
fi

if "$SPARKLE_WRANGLER_BIN" r2 bucket info "$SPARKLE_R2_BUCKET" >/dev/null 2>&1; then
  echo "R2 bucket already exists: $SPARKLE_R2_BUCKET"
else
  echo "Creating R2 bucket: $SPARKLE_R2_BUCKET"
  "$SPARKLE_WRANGLER_BIN" r2 bucket create "$SPARKLE_R2_BUCKET" --location "$SPARKLE_R2_LOCATION"
fi

if "$SPARKLE_WRANGLER_BIN" r2 bucket domain get "$SPARKLE_R2_BUCKET" --domain "$SPARKLE_UPDATE_DOMAIN" >/dev/null 2>&1; then
  echo "R2 custom domain already connected: $SPARKLE_UPDATE_DOMAIN"
else
  echo "Connecting R2 custom domain: $SPARKLE_UPDATE_DOMAIN"
  "$SPARKLE_WRANGLER_BIN" r2 bucket domain add "$SPARKLE_R2_BUCKET" \
    --domain "$SPARKLE_UPDATE_DOMAIN" \
    --zone-id "$CLOUDFLARE_ZONE_ID" \
    --min-tls 1.2 \
    --force
fi

echo "Sparkle R2 setup complete:"
echo "  bucket: $SPARKLE_R2_BUCKET"
echo "  domain: https://$SPARKLE_UPDATE_DOMAIN/"
echo "  zone id: $CLOUDFLARE_ZONE_ID"

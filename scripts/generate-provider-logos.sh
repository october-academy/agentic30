#!/usr/bin/env bash
#
# generate-provider-logos.sh
# Regenerates the AI-provider brand-logo imagesets used by the Settings UI
# (odProviderLogo, odNodeRuntimeCard, OpenDesignReferencePages provider rows).
#
# Sources (verified current 2026-06-07):
#   Codex   — LobeHub static icons (MIT-licensed SVG file) — distinct Codex product mark
#             https://lobehub.com/icons/codex
#   Gemini  — LobeHub static icons (MIT-licensed SVG file) — current 4-color "spark"
#             (NOT the legacy blue->purple gradient) https://lobehub.com/icons/gemini
#   Node.js — official OpenJS asset, used unmodified
#             https://nodejs.org/static/logos/nodejsHex.svg
#   Exa     — official Exa Brand Assets zip, Logomark Blue SVG
#             https://exa.ai/brand
#
# Claude is intentionally NOT regenerated here: BrandClaude.imageset already ships
# the official-color (#d97757 / #faf9f5) starburst and is reused by other surfaces.
#
# Trademark note: these marks are trademarks of their respective owners. Codex
# and Gemini currently come from LobeHub icon files rather than official vendor
# brand kits; the MIT license on those SVG files does not grant trademark rights.
# They are bundled solely as neutral provider-attribution icons (no implied
# endorsement).
#
# Requirements: curl, npx (for sharp-cli / resvg SVG rendering), ImageMagick (magick).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/agentic30/Assets.xcassets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

# name|source-url
ENTRIES=(
  "BrandCodex|https://unpkg.com/@lobehub/icons-static-svg@latest/icons/codex-color.svg"
  "BrandGemini|https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini-color.svg"
  "BrandNodejs|https://nodejs.org/static/logos/nodejsHex.svg"
)

EXA_BRAND_ASSETS_URL="https://exa.ai/assets/Exa%20Brand%20Assets.zip"

write_contents_json() {
  cat > "$1/Contents.json" <<'JSON'
{
  "images": [
    {
      "filename": "icon.png",
      "idiom": "universal",
      "scale": "1x"
    },
    {
      "filename": "icon@2x.png",
      "idiom": "universal",
      "scale": "2x"
    },
    {
      "filename": "icon@3x.png",
      "idiom": "universal",
      "scale": "3x"
    }
  ],
  "info": {
    "author": "xcode",
    "version": 1
  }
}
JSON
}

for entry in "${ENTRIES[@]}"; do
  name="${entry%%|*}"
  url="${entry#*|}"
  svg="$TMP/$name.svg"
  dir="$ASSETS/$name.imageset"

  echo "==> $name  <-  $url"
  curl -fsSL "$url" -o "$svg"
  mkdir -p "$dir"

  # Render @3x crisply from vector (resvg via sharp), square canvas, transparent pad.
  npx -y sharp-cli -i "$svg" -o "$dir/icon@3x.png" \
    resize 384 384 --fit contain --background '#00000000' >/dev/null
  # Downscale the raster for @2x / @1x (high-quality Lanczos).
  magick "$dir/icon@3x.png" -resize 256x256 "$dir/icon@2x.png"
  magick "$dir/icon@3x.png" -resize 128x128 "$dir/icon.png"

  write_contents_json "$dir"
  echo "    wrote $dir (128/256/384)"
done

echo "==> BrandExa  <-  $EXA_BRAND_ASSETS_URL"
exa_zip="$TMP/exa-brand-assets.zip"
exa_dir="$TMP/exa-brand-assets"
curl -fsSL "$EXA_BRAND_ASSETS_URL" -o "$exa_zip"
unzip -q "$exa_zip" -d "$exa_dir"
exa_svg="$exa_dir/Exa Brand Assets/Logo/SVGs/Logomark/Exa Logomark Blue.svg"
dir="$ASSETS/BrandExa.imageset"
mkdir -p "$dir"
npx -y sharp-cli -i "$exa_svg" -o "$dir/icon@3x.png" \
  resize 384 384 --fit contain --background '#00000000' >/dev/null
magick "$dir/icon@3x.png" -resize 256x256 "$dir/icon@2x.png"
magick "$dir/icon@3x.png" -resize 128x128 "$dir/icon.png"
write_contents_json "$dir"
echo "    wrote $dir (128/256/384)"

echo "done — regenerated provider brand logos"

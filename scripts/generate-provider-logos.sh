#!/usr/bin/env bash
#
# generate-provider-logos.sh
# Regenerates the brand-logo imagesets used by the app:
#   - Provider auth cards   (odProviderLogo, odNodeRuntimeCard, OpenDesignReferencePages)
#   - Settings integration rows (odSettingsBrandIcon: GitHub/Notion/Cloudflare/Exa/PostHog)
#   - Intake source-catalog tiles (IntakeV2ShowcaseViews assetBackground/assetScale)
#
# Two visual families are produced:
#
#   A. Provider app-icons (Codex/Gemini/Node) — full-canvas marks, rendered as-is.
#        Codex   — LobeHub static icons (MIT-licensed SVG) — distinct Codex product mark
#                  https://lobehub.com/icons/codex
#        Gemini  — LobeHub static icons (MIT-licensed SVG) — current 4-color "spark"
#                  (NOT the legacy blue->purple gradient) https://lobehub.com/icons/gemini
#        Node.js — official OpenJS asset, used unmodified
#                  https://nodejs.org/static/logos/nodejsHex.svg
#
#   B. Integration logomarks (GitHub/Notion/Cloudflare/Exa/PostHog) — transparent marks
#      sized to a UNIFORM fill (trim -> re-pad to 95% of a square canvas) so every chip
#      sits identically in its 36pt surface2 tile in Settings and in the Intake tiles.
#      Marks that are monochrome (GitHub, Notion) and PostHog's dark head are recolored
#      near-white (#ECEEF0) so they read on the app's dark surfaces; intake gives Notion
#      and PostHog a dark plate (see IntakeV2ShowcaseViews.assetBackground).
#        GitHub     — LobeHub mono octocat, recolored near-white
#                     https://lobehub.com/icons/github
#        Notion     — LobeHub mono mark, recolored near-white
#                     https://lobehub.com/icons/notion
#        Cloudflare — LobeHub color mark (orange cloud), used as-is
#                     https://lobehub.com/icons/cloudflare
#        Exa        — official Exa Brand Assets zip, Logomark Blue SVG
#                     https://exa.ai/brand
#        PostHog    — svgl colorful hedgehog, dark head recolored near-white
#                     https://svgl.app/library/posthog.svg
#
# Claude is intentionally NOT regenerated here: BrandClaude.imageset already ships
# the official-color (#d97757 / #faf9f5) starburst and is reused by other surfaces.
#
# Trademark note: these marks are trademarks of their respective owners. They come from
# community icon files (LobeHub MIT, svgl) or vendor brand kits; the file licenses do
# not grant trademark rights. They are bundled solely as neutral provider/integration
# attribution icons (no implied endorsement).
#
# Requirements: curl, npx (for sharp-cli / resvg SVG rendering), ImageMagick (magick).
set -euo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
ASSETS="$ROOT/agentic30/Assets.xcassets"
TMP="$(mktemp -d)"
trap 'rm -rf "$TMP"' EXIT

WHITE_MARK="#ECEEF0"   # near-white recolor for mono marks on dark surfaces
NORMALIZE_FILL=973     # 95% of the 1024 master canvas (uniform integration-mark fill)

# Provider app-icons (family A): name|source-url — rendered full-canvas, no normalize.
ENTRIES=(
  "BrandCodex|https://unpkg.com/@lobehub/icons-static-svg@latest/icons/codex-color.svg"
  "BrandGemini|https://unpkg.com/@lobehub/icons-static-svg@latest/icons/gemini-color.svg"
  "BrandNodejs|https://nodejs.org/static/logos/nodejsHex.svg"
)

# Integration logomarks (family B): name|source-url|sed-recolor (recolor may be empty).
INTEGRATIONS=(
  "BrandGitHub|https://unpkg.com/@lobehub/icons-static-svg@latest/icons/github.svg|s/currentColor/$WHITE_MARK/g"
  "BrandNotion|https://unpkg.com/@lobehub/icons-static-svg@latest/icons/notion.svg|s/currentColor/$WHITE_MARK/g"
  "BrandCloudflare|https://unpkg.com/@lobehub/icons-static-svg@latest/icons/cloudflare-color.svg|"
  "BrandPostHog|https://svgl.app/library/posthog.svg|s/#000/$WHITE_MARK/g"
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

# Render an SVG to a transparent 1024 square master (resvg via sharp).
render_master() { # $1=svg  $2=out-png
  npx -y sharp-cli -i "$1" -o "$2" \
    resize 1024 1024 --fit contain --background '#00000000' >/dev/null
}

# Trim a master, re-pad it to a uniform 95% fill on a square canvas, then emit
# the @1x/@2x/@3x rasters + Contents.json. Normalizes optical size across marks
# regardless of each source SVG's own internal padding.
normalize_to_imageset() { # $1=master-png  $2=imageset-dir
  local master="$1" dir="$2"
  mkdir -p "$dir"
  magick "$master" -trim +repage \
    -resize ${NORMALIZE_FILL}x${NORMALIZE_FILL} \
    -background none -gravity center -extent 1024x1024 "$TMP/_norm.png"
  magick "$TMP/_norm.png" -resize 384x384 "$dir/icon@3x.png"
  magick "$TMP/_norm.png" -resize 256x256 "$dir/icon@2x.png"
  magick "$TMP/_norm.png" -resize 128x128 "$dir/icon.png"
  write_contents_json "$dir"
}

# Family A — provider app-icons (full-canvas, no normalize).
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

# Family B — integration logomarks (recolor for dark surfaces + uniform 95% fill).
for entry in "${INTEGRATIONS[@]}"; do
  IFS='|' read -r name url recolor <<< "$entry"
  raw="$TMP/$name.raw.svg"
  svg="$TMP/$name.svg"

  echo "==> $name  <-  $url"
  curl -fsSL "$url" -o "$raw"
  if [ -n "$recolor" ]; then
    sed "$recolor" "$raw" > "$svg"
  else
    cp "$raw" "$svg"
  fi
  render_master "$svg" "$TMP/$name.master.png"
  normalize_to_imageset "$TMP/$name.master.png" "$ASSETS/$name.imageset"
  echo "    wrote $ASSETS/$name.imageset (128/256/384, normalized ${NORMALIZE_FILL}/1024)"
done

# Exa — official brand zip (family B; normalized like the other integration marks).
echo "==> BrandExa  <-  $EXA_BRAND_ASSETS_URL"
exa_zip="$TMP/exa-brand-assets.zip"
exa_dir="$TMP/exa-brand-assets"
curl -fsSL "$EXA_BRAND_ASSETS_URL" -o "$exa_zip"
unzip -q "$exa_zip" -d "$exa_dir"
exa_svg="$exa_dir/Exa Brand Assets/Logo/SVGs/Logomark/Exa Logomark Blue.svg"
render_master "$exa_svg" "$TMP/BrandExa.master.png"
normalize_to_imageset "$TMP/BrandExa.master.png" "$ASSETS/BrandExa.imageset"
echo "    wrote $ASSETS/BrandExa.imageset (128/256/384, normalized ${NORMALIZE_FILL}/1024)"

echo "done — regenerated provider + integration brand logos"

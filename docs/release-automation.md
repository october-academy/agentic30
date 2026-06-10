# Release Automation

One release path: push a `v*` tag and GitHub Actions builds, signs, notarizes, and publishes two per-arch DMGs in parallel on `macos-15` runners — `arm64` (Apple Silicon) and `x64` (Intel).

The public update feeds are served from the `agentic30-sparkle` Cloudflare R2 bucket:

- Apple Silicon: `https://updates.agentic30.app/appcast.xml`
- Intel: `https://updates.agentic30.app/appcast-x64.xml`

Each build embeds its own `SUFeedURL`, so Sparkle never offers an Intel Mac an arm64 DMG (or vice versa).

## Release Contract

Each per-arch job produces:

- `build/appcast/appcast.xml` (arm64) or `build/appcast/appcast-x64.xml` (x64)
- exactly one `build/appcast/agentic30-<build>-<arch>.dmg`
- optional `build/appcast/agentic30-<build>-<arch>.dmg.md` release notes

Publishing then performs two actions, in a safe order:

- upload the DMG to R2 and verify it is publicly fetchable, **then** flip the appcast pointer (a failed DMG upload leaves the old feed intact); transient R2 errors are retried with backoff
- create or update the matching GitHub Release assets (parallel jobs tolerate the create race)

## GitHub Actions

Workflow: `.github/workflows/release.yml`

Triggers:

- pushing a `v*` tag — the normal path
- manual `workflow_dispatch` with optional `release_tag` (must be `v*`) and `dry_run` (build + notarize, skip R2/GitHub publishing)

Each job is capped at `timeout-minutes: 180` and every `notarytool submit` uses `--timeout 2h`, so a hung Apple notary connection fails fast instead of burning the 6h runner default.

Required repository secrets:

| Secret | Description |
|---|---|
| `ASC_KEY_ID` | App Store Connect API key id |
| `ASC_ISSUER_ID` | App Store Connect issuer id |
| `ASC_API_KEY_P8` | Raw `.p8` private key content |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token with R2 read/write access to `agentic30-sparkle` |
| `DEVELOPMENT_TEAM` | Apple Developer Team ID |
| `SPARKLE_PUBLIC_ED_KEY` | Sparkle public EdDSA key embedded in the app |
| `SPARKLE_PRIVATE_ED_KEY` | Sparkle private EdDSA key used by `generate_appcast` in CI |
| `MACOS_KEYCHAIN_PASSWORD` | Temporary CI keychain password |
| `DEVELOPER_ID_APPLICATION_P12_BASE64` | Base64 Developer ID Application `.p12` |
| `DEVELOPER_ID_APPLICATION_P12_PASSWORD` | Password for the app signing `.p12` |

## Cloudflare R2 Setup

One-time setup:

```bash
wrangler login
scripts/setup-sparkle-r2.sh
```

The CI Cloudflare token is stored as the `CLOUDFLARE_API_TOKEN` GitHub secret. If it is rotated, scope the replacement token to account `3c03f4b8151b812cd2662d4fb9d30b1f` and grant these account permissions:

- `Workers R2 Storage Read`
- `Workers R2 Storage Write`
- `Workers R2 Storage Bucket Item Read`
- `Workers R2 Storage Bucket Item Write`
- `Workers R2 Storage Metadata Read`

The custom domain is already connected to bucket `agentic30-sparkle` in the verified `agentic30.app` zone `b770693582734b1854ac556acd00823f` with minimum TLS `1.2`.

## Tag Release

Recommended path — one command that bumps the version in BOTH sources, runs the local preflight gate, commits, tags, and pushes:

```bash
npm run release:cut -- --bump build      # CFBundleVersion +1, keep marketing version
npm run release:cut -- --bump patch      # CFBundleVersion +1 and marketing x.y.(z+1)
npm run release:cut -- --set 1.0.8/9     # explicit MARKETING/BUILD
```

`release:cut` runs `scripts/preflight-release.sh` first, which catches the failures that otherwise waste a full ~20-minute CI cycle BEFORE a tag is pushed:

1. **Version source consistency** — `agentic30/Info.plist` (the authoritative source; `GENERATE_INFOPLIST_FILE=NO`) must match `project.pbxproj`. Catches the "bumped pbxproj but not Info.plist" drift that ships a stale build number.
2. **Sparkle monotonicity** — `CFBundleVersion` must be strictly greater than the live appcast's `sparkle:version`, or existing users are never offered the update.
3. **Release compile dry-run** — a real `xcodebuild build` (no signing) so compile / actor-isolation errors surface locally in minutes.
4. **Sidecar test suite**.

Run the gate by itself anytime with `npm run release:verify` (add `--skip-build` for a fast version-only check).

Manual equivalent (no preflight):

```bash
git tag vYYYYMMDD-HHMM
git push origin vYYYYMMDD-HHMM
```

A CI step fetches each live appcast's `sparkle:version` into `PREVIOUS_BUNDLE_VERSION`, arming the guard in `build-and-notarize.sh` so a duplicate build number fails fast. The release script auto-discovers Sparkle's `generate_appcast` from Xcode DerivedData after SwiftPM resolves Sparkle; set `SPARKLE_GENERATE_APPCAST_BIN` only if the tool lives somewhere custom.

## Manual Release From a Trusted Mac

```bash
export RELEASE_TAG=vYYYYMMDD-HHMM
export SPARKLE_DOWNLOAD_URL_PREFIX=https://updates.agentic30.app/
export AGENTIC30_UPLOAD_APPCAST_R2=1
# build-and-notarize.sh resets build/appcast per run, so publish each arch
# before building the next one.
for arch in arm64 x64; do
  AGENTIC30_BUNDLE_ARCH=$arch bash scripts/build-and-notarize.sh
  bash scripts/publish-github-release.sh
done
```

## Verification

Before publishing:

```bash
npm run release:preflight
```

After publishing:

```bash
curl -I https://updates.agentic30.app/appcast.xml
curl -I https://updates.agentic30.app/appcast-x64.xml
```

Both feeds must return `200`, and the `url=` each references must also return `200`.

## Troubleshooting

Field-tested failure modes from the 2026-06-10/11 release cycles and the guards now in place:

1. **`ERROR: appcast-*.xml was not generated`** — Sparkle's `generate_appcast` names its output after the `SUFeedURL` filename embedded in the app inside the DMG, not always `appcast.xml`. The x64 build therefore produces `appcast-x64.xml` directly. The pipeline asserts the per-arch filename; if this fires, the embedded `SUFeedURL` and `SPARKLE_APPCAST_FILENAME` have drifted apart — fix the feed wiring, don't rename files.
2. **Job stuck on "initiating connection to the Apple notary service"** — Apple's notary service intermittently hangs mid-upload (observed: 5h46m on a DMG submission, killed only by the 6h runner default). Guards: every `notarytool submit` passes `--timeout 2h` and the job is capped at `timeout-minutes: 180`. The `--timeout` flag only bounds the polling phase, so the job cap is the real backstop. On timeout, just re-run the failed job — the hang is transient.
3. **Live feed pointing at a 404 DMG** — large DMG PUTs (280MB+) intermittently get `502 Bad Gateway` from Cloudflare's edge. Guards in `upload-sparkle-r2.sh`: the DMG is uploaded and verified publicly fetchable **before** the appcast pointer flips (a failed DMG upload leaves the previous feed intact), and every PUT retries up to 4 times with exponential backoff. If a feed is ever broken anyway, re-cutting a release with a bumped build number fully heals it — Sparkle clients just see the next valid feed state.

A release is only done when both appcasts return `200` **and** the DMG URL inside each also returns `200`.

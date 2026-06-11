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
- `build/appcast/agentic30-<build>-<arch>.md` release notes (generate_appcast's
  sibling-notes convention: archive basename with the extension **replaced**, not
  appended). Defaults to the newest released `CHANGELOG.md` section via
  `scripts/changelog-latest-notes.sh`; override with `SPARKLE_RELEASE_NOTES_PATH`.
  `generate_appcast --embed-release-notes` inlines them into the signed appcast
  as `<description sparkle:format="markdown">`, so the Sparkle update dialog
  shows a what's-new without any extra hosted file.

Publishing then performs these actions, in a safe order:

- upload the DMG to R2 through the S3-compatible multipart API and verify it is publicly fetchable, **then** flip the appcast pointer (a failed DMG upload leaves the old feed intact); transient R2 errors are retried with backoff
- GitHub release, draft-gated: a `draft-release` job creates the release ONCE as a draft (title `Agentic30 <version> (build <n>)` from `Info.plist`, body = newest CHANGELOG section); each arch job only uploads its assets; a final `publish-release` job flips draft → published **only when both arch DMGs are attached**. A failed arch build leaves a non-public draft instead of a half-published release.

## GitHub Actions

Workflow: `.github/workflows/release.yml`

Triggers:

- pushing a `v*` tag — the normal path
- manual `workflow_dispatch` with optional `release_tag` (must be `v*`), `dry_run` (build + notarize, skip R2/GitHub publishing), and `allow_unguarded` (proceed when the live appcast cannot be fetched — only for bootstrapping a brand-new feed)

Release runs are serialized via a static concurrency group (`group: release`): two different tags never run concurrently, so a slow older run can no longer finish after a newer one and flip the live appcast back to an older build — a queued superseded run re-arms its version guard against the fresh feed and fails closed.

Each job is capped at `timeout-minutes: 180` and every `notarytool submit` uses `--timeout 2h`, so a hung Apple notary connection fails fast instead of burning the 6h runner default.

Required repository secrets:

| Secret | Description |
|---|---|
| `ASC_KEY_ID` | App Store Connect API key id |
| `ASC_ISSUER_ID` | App Store Connect issuer id |
| `ASC_API_KEY_P8` | Raw `.p8` private key content |
| `CLOUDFLARE_API_TOKEN` | Cloudflare token for Wrangler bucket/domain validation |
| `R2_ACCESS_KEY_ID` | R2 S3 access key id with Object Read & Write access to `agentic30-sparkle` |
| `R2_SECRET_ACCESS_KEY` | R2 S3 secret access key paired with `R2_ACCESS_KEY_ID` |
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

The CI Cloudflare token is stored as the `CLOUDFLARE_API_TOKEN` GitHub secret and is used for Wrangler bucket/domain validation. If it is rotated, scope the replacement token to account `3c03f4b8151b812cd2662d4fb9d30b1f` and grant these account permissions:

- `Workers R2 Storage Read`
- `Workers R2 Storage Write`
- `Workers R2 Storage Bucket Item Read`
- `Workers R2 Storage Bucket Item Write`
- `Workers R2 Storage Metadata Read`

Large DMGs are uploaded through R2's S3-compatible multipart API, not `wrangler r2 object put` (Wrangler rejects objects over 300 MiB). Create a bucket-scoped R2 API token with Object Read & Write permission and store its generated S3 credentials as `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY`.

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

`release:cut` also promotes the CHANGELOG `[Unreleased]` section to `[<version>] - <date>` in the bump commit, so the appcast what's-new and the GitHub release body pick up the right section (skipped when that version heading already exists).

A CI step fetches each live appcast's `sparkle:version` into `PREVIOUS_BUNDLE_VERSION`, arming the guard in `build-and-notarize.sh` so a duplicate build number fails fast. The fetch itself fails closed: if the live feed cannot be read (outage, DNS), the release stops instead of silently proceeding unguarded — dispatch with `allow_unguarded: true` only to bootstrap a brand-new feed. The release script auto-discovers Sparkle's `generate_appcast` from Xcode DerivedData after SwiftPM resolves Sparkle; set `SPARKLE_GENERATE_APPCAST_BIN` only if the tool lives somewhere custom.

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
3. **Live feed pointing at a 404 DMG** — the appcast pointer must never flip before its DMG is publicly fetchable. Guards in `upload-sparkle-r2.sh`: the DMG is uploaded through R2 S3 multipart and verified publicly fetchable **before** the appcast pointer flips (a failed DMG upload leaves the previous feed intact), and uploads retry up to 4 times with exponential backoff. If a feed is ever broken anyway, re-cutting a release with a bumped build number fully heals it — Sparkle clients just see the next valid feed state.
4. **`Wrangler only supports uploading files up to 300 MiB`** — do not retry the same release run; the size is deterministic. Ensure `R2_ACCESS_KEY_ID` and `R2_SECRET_ACCESS_KEY` are present so `scripts/r2-upload-object.mjs` uses R2 S3 multipart for the DMG.
5. **GitHub release shows only one DMG** — one arch matrix job failed. With the draft gate the release stays a non-public draft; re-run the failed job and `publish-release` flips it to published once both DMGs are attached. (Incident that motivated this: `v20260611-0738` published an Intel-only build 16 release from a half-failed run.)
6. **404s on `updates.agentic30.app` are browser-cacheable for 4h** — Cloudflare's default browser TTL applies `cache-control: max-age=14400` to 404 responses, which can prolong recovery if a client fetched a DMG URL during an upload gap. Recommended (dashboard-only, not yet applied): one Cache Rule on the `agentic30.app` zone — hostname `updates.agentic30.app` AND response status >= 400 -> Browser TTL: bypass, Edge TTL: 0. Largely belt-and-braces since the upload order fix; record it here if applied so dashboard config doesn't become invisible drift.

A release is only done when both appcasts return `200`, the DMG URL inside each also returns `200`, **and** the GitHub release for the tag is published (not draft) with both `agentic30-<build>-arm64.dmg` and `agentic30-<build>-x64.dmg` attached (`gh release view <tag> --json assets`).

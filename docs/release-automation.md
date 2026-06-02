# Release Automation

This repository supports three release paths that share the same Sparkle/R2 and GitHub Release contract:

- Local release: run the notarization script on a trusted Mac.
- Xcode Cloud gated release: let Xcode Cloud verify the tag build, then let GitHub Actions run the notarized local-builder release on a macOS runner.
- Xcode Cloud artifact release: download and publish Xcode Cloud artifacts directly when that workflow already emits the release contract.
- GitHub Actions local-builder release: run the local release script on a GitHub-hosted macOS runner without waiting for Xcode Cloud.

The public update feed is `https://updates.agentic30.app/appcast.xml`, backed by the `agentic30-sparkle` Cloudflare R2 bucket.

## Release Contract

Every release path must produce:

- `build/appcast/appcast.xml`
- exactly one `build/appcast/agentic30-*.dmg`
- optional `build/appcast/agentic30-*.dmg.md`
- optional `build/agentic30-*.pkg` when a Developer ID Installer certificate is configured

Publishing then performs two actions:

- upload `appcast.xml`, DMG, and optional release notes to R2
- create or update the matching GitHub Release assets

## GitHub Actions

Workflow: `.github/workflows/release.yml`

Triggers:

- pushing a `v*` tag uses the `xcode-cloud-gated-local` builder by default
- manual `workflow_dispatch` can choose `xcode-cloud-gated-local`, `xcode-cloud`, or `local`

Required repository variables:

| Variable | Used by | Description |
|---|---|---|
| `XCODE_CLOUD_RELEASE_WORKFLOW_ID` | xcode-cloud builder | Xcode Cloud workflow id for the release archive workflow |
| `XCODE_CLOUD_TIMEOUT_SECONDS` | xcode-cloud builder | Optional wait timeout, defaults to `7200` |
| `XCODE_CLOUD_POLL_SECONDS` | xcode-cloud builder | Optional polling interval, defaults to `30` |

Required repository secrets:

| Secret | Used by | Description |
|---|---|---|
| `ASC_KEY_ID` | both builders | App Store Connect API key id |
| `ASC_ISSUER_ID` | both builders | App Store Connect issuer id |
| `ASC_API_KEY_P8` | both builders | Raw `.p8` private key content |
| `CLOUDFLARE_API_TOKEN` | both builders | Cloudflare token with R2 read/write access to `agentic30-sparkle` |
| `DEVELOPMENT_TEAM` | local builder | Apple Developer Team ID |
| `SPARKLE_PUBLIC_ED_KEY` | local builder | Sparkle public EdDSA key embedded in the app |
| `SPARKLE_PRIVATE_ED_KEY` | local builder | Sparkle private EdDSA key used by `generate_appcast` in CI |
| `MACOS_KEYCHAIN_PASSWORD` | local builder | Temporary CI keychain password |
| `DEVELOPER_ID_APPLICATION_P12_BASE64` | local builder | Base64 Developer ID Application `.p12` |
| `DEVELOPER_ID_APPLICATION_P12_PASSWORD` | local builder | Password for the app signing `.p12` |
| `DEVELOPER_ID_INSTALLER_P12_BASE64` | local builder | Optional base64 Developer ID Installer `.p12` |
| `DEVELOPER_ID_INSTALLER_P12_PASSWORD` | local builder | Optional installer `.p12` password |

## Xcode Cloud Setup

Create a release workflow in Xcode Cloud/App Store Connect:

- Start condition: tag changes matching the same `v*` tags GitHub Actions receives.
- Action: Archive the macOS app using Developer ID distribution.
- Signing: Developer ID with notarization enabled for direct distribution.

The default GitHub workflow waits for the matching Xcode Cloud build by tag/ref and commit. If that build succeeds, GitHub Actions runs the local-builder release on a macOS runner and publishes the resulting appcast/DMG/PKG. This keeps Xcode Cloud as the Apple-native validation gate without depending on custom-script artifacts.

The manual `xcode-cloud` builder downloads Xcode Cloud artifacts through the App Store Connect API and publishes them directly. Use it only when the Xcode Cloud workflow already emits a downloadable artifact containing the release contract files. If Xcode Cloud produces a different artifact shape, keep the release contract stable by adjusting the Xcode Cloud packaging, not the public R2/GitHub publishing contract.

## Local Release

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

Release:

```bash
export RELEASE_TAG=vYYYYMMDD-N
export SPARKLE_DOWNLOAD_URL_PREFIX=https://updates.agentic30.app/
export AGENTIC30_UPLOAD_APPCAST_R2=1
bash scripts/build-and-notarize.sh
bash scripts/publish-github-release.sh
```

## Tag Release

Default automated path:

```bash
git tag vYYYYMMDD-N
git push origin vYYYYMMDD-N
```

The tag starts both Xcode Cloud and GitHub Actions. GitHub Actions waits for the matching Xcode Cloud build to pass, then builds/notarizes/uploads the release on its macOS runner. The release script auto-discovers Sparkle's `generate_appcast` from Xcode DerivedData after SwiftPM resolves Sparkle; set `SPARKLE_GENERATE_APPCAST_BIN` only if the tool lives somewhere custom. PKG output is enabled automatically only when the optional Developer ID Installer `.p12` secret exists.

## Verification

Before publishing:

```bash
npm run release:preflight
```

After publishing:

```bash
wrangler r2 bucket domain get agentic30-sparkle --domain updates.agentic30.app
curl -I https://updates.agentic30.app/appcast.xml
```

Before the first real appcast upload, `appcast.xml` may return `404`; after a release publish, it must return `200`.

# Agentic30 Mac Release Checklist

This checklist is for local dogfood releases of the macOS menu bar app. Public Developer ID distribution needs signing, notarization, updater, and support checks for the PKG primary installer plus the DMG fallback/update archive.

## Dogfood Gate

- `npm install` succeeds from the repo root.
- `npm run doctor` reports no `failed` checks.
- `npm run test:sidecar` passes.
- Focused UI tests pass for hermetic chat, structured prompt choices, settings model pickers, and BIP sidecar failure handling.
- `xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS'` is green or any failure is documented as unrelated to the release.
- Fresh app support data can create a session, select a project folder, answer onboarding, and show Day 1 Mission without Google setup.
- Corrupt `sessions.json` is quarantined as `sessions.json.corrupt-<timestamp>` and visible in diagnostics.
- Normal chat and coaching run read-only by default. Full workspace access only happens from an approved command/action.

## Manual Smoke

1. Launch from Xcode.
2. Confirm provider auth state in Settings.
3. Pick a project folder with a README or docs.
4. Complete the onboarding questions.
5. Confirm a local Day 1 Mission card appears within 2-5 minutes.
6. Configure Google Docs/Sheets and verify proof capture setup separately.

## Sparkle Update Smoke

1. Install the previous signed and notarized build into `/Applications`.
2. Run `wrangler login`, then run `scripts/setup-sparkle-r2.sh` once to create/connect the `agentic30-sparkle` R2 bucket to `updates.agentic30.app` in the verified `agentic30.app` zone (`b770693582734b1854ac556acd00823f`).
3. Build a newer release with a greater `CFBundleVersion` using `scripts/build-and-notarize.sh`; the script must embed `SPARKLE_PUBLIC_ED_KEY`, generate `build/appcast/appcast.xml`, and stage `build/appcast/agentic30-<build>-<arch>.dmg`.
4. Set `SPARKLE_DOWNLOAD_URL_PREFIX=https://updates.agentic30.app/` and `AGENTIC30_UPLOAD_APPCAST_R2=1` so the release script uploads `appcast.xml`, the staged DMG, and any generated release-notes `.md` to the `agentic30-sparkle` R2 bucket through Wrangler.
5. Before a real appcast is uploaded, confirm routing with a temporary R2 object; `https://updates.agentic30.app/appcast.xml` may correctly return `404` while the file is absent. After upload, confirm `appcast.xml` and the referenced DMG URL return `200`.
6. Launch the older `/Applications` build and use Settings or the app menu `Check for Updates...`.
7. Confirm Sparkle finds the newer build, validates the signed feed/archive, downloads the update, and completes the standard install/relaunch flow after user approval.

## Automated Release

- See `docs/release-automation.md` for the tag-triggered GitHub Actions workflow, Xcode Cloud builder integration, required secrets/variables, and local fallback path.
- Pushing a `v*` tag starts the GitHub release workflow; the default builder waits for the matching Xcode Cloud archive to pass, then runs the local notarized release script on a GitHub-hosted macOS runner, uploads Sparkle files to R2, and publishes GitHub Release assets.
- Manual `workflow_dispatch` can choose the `local` builder to run `scripts/build-and-notarize.sh` on a GitHub-hosted macOS runner when signing secrets and Sparkle tooling are configured.
- Confirm the GitHub secret `CLOUDFLARE_API_TOKEN` is present before tag release; it must allow R2 object reads/writes for the `agentic30-sparkle` bucket.

## Launch Funnel Telemetry

- The Mac app ships with the Agentic30 PostHog project token embedded so launch telemetry works from Xcode and signed builds without local secrets. This is a public capture token, not a personal API key: it can write events to PostHog ingest but cannot read analytics data or modify project settings. Never embed a personal API key in the app. `POSTHOG_PROJECT_API_KEY` / `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` can still override the defaults for a custom build, and `scripts/build-and-notarize.sh` verifies the exported app contains a `phc_…` token. The Settings opt-out toggle (`agentic30.posthog.telemetryDisabled` UserDefault) lets end users disable per-device.
- Use a `go.agentic30.app` short URL for the Threads launch link so PostHog receives `short_link_click` from the URL shortener.
- After uploading the PKG and DMG to GitHub Releases, run `npm run track:release-funnel -- --repo october-academy/agentic30-private --tag <release-tag>` on a short interval during launch day. The script polls `gh api` release asset `download_count` and emits one `installer_downloaded` event per new PKG/DMG download.
- Confirm the signed app emits `mac_install_completed` once on first launch, gated on a fresh `agentic30.posthog.distinctId` so existing users who upgrade to this build do not fire the install event. The legacy `dmg_install_completed` event is still emitted for old dashboards.
- The A4 funnel landed in this slice: `short_link_click` → `installer_downloaded` → `mac_install_completed`.
- Host-routed sidecar telemetry for `workspace_setup_started`, `workspace_setup_failed`, and `workspace_setup_completed` is wired. `workspace_setup_completed` is gated on workspace scan success plus first real input, so use it as the workspace-setup funnel terminator only after confirming the events in local telemetry capture or PostHog for the signed artifact.

## Public Distribution Blockers

- Developer ID signing and Hardened Runtime.
- Notarized PKG and DMG.
- Update channel and rollback path.
- Supportable diagnostics export.
- Clear privacy copy for local project access, provider calls, and Google proof reads.
- Fresh macOS user smoke with no local Node.js installed: install PKG, launch, confirm sidecar starts from the bundled runtime and no Gatekeeper “Open Anyway” path is required.
- Sparkle smoke from an older notarized build installed in `/Applications` to a newer notarized DMG referenced by `https://updates.agentic30.app/appcast.xml`, including background download and user-approved install/relaunch.
- Keep `https://agentic30.app/appcast.xml` available or redirected during the transition so previously shipped builds that still point at the apex feed are not stranded.

# Agentic30 Mac Release Checklist

This checklist is for local dogfood releases of the macOS menu bar app. Public Developer ID distribution ships two notarized DMGs per release — `agentic30-<build>-arm64.dmg` (Apple Silicon) and `agentic30-<build>-x64.dmg` (Intel) — each with its own Sparkle feed (`appcast.xml` / `appcast-x64.xml`).

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
3. Build a newer release with a greater `CFBundleVersion` using `scripts/build-and-notarize.sh` (per arch via `AGENTIC30_BUNDLE_ARCH`); the script must embed `SPARKLE_PUBLIC_ED_KEY` and the per-arch `SUFeedURL`, generate `build/appcast/appcast.xml` (arm64) or `appcast-x64.xml` (x64), and stage `build/appcast/agentic30-<build>-<arch>.dmg`.
4. Set `SPARKLE_DOWNLOAD_URL_PREFIX=https://updates.agentic30.app/`, `AGENTIC30_UPLOAD_APPCAST_R2=1`, and R2 S3 credentials (`R2_ACCESS_KEY_ID` / `R2_SECRET_ACCESS_KEY`) so the release script uploads the staged DMG first via multipart S3 (verified publicly fetchable), then flips the appcast pointer.
5. After upload, confirm both feeds and the DMG URLs they reference return `200`:
   `curl -I https://updates.agentic30.app/appcast.xml` and `curl -I https://updates.agentic30.app/appcast-x64.xml`.
6. Launch the older `/Applications` build and use Settings or the app menu `Check for Updates...`.
7. Confirm Sparkle finds the newer build, validates the signed feed/archive, downloads the update, and completes the standard install/relaunch flow after user approval.

## Automated Release

- See `docs/release-automation.md` for the tag-triggered GitHub Actions workflow, required secrets, and the `npm run release:cut` flow.
- Prefer `npm run release:cut -- --bump build` (or `--bump patch` / `--set X.Y.Z/N`): it bumps the version in both `agentic30/Info.plist` and `project.pbxproj`, runs the local preflight gate (`scripts/preflight-release.sh`), commits, tags, and pushes — catching version/compile/test failures before they waste a ~20-minute CI cycle.
- Pushing a `v*` tag starts the GitHub release workflow: two parallel build/notarize/upload jobs on GitHub-hosted macOS runners (arm64 + Intel x64), each uploading its Sparkle feed to R2 and attaching GitHub Release assets. The release stays draft until both arch DMGs are attached; if the run fails before publish, the cleanup job deletes the draft release object and leaves the tag intact for auditability. `workflow_dispatch` supports `dry_run`.
- Confirm the GitHub secrets `CLOUDFLARE_API_TOKEN`, `R2_ACCESS_KEY_ID`, and `R2_SECRET_ACCESS_KEY` are present before tag release. `CLOUDFLARE_API_TOKEN` is used for Wrangler bucket/domain validation; the R2 S3 credentials must allow Object Read & Write for `agentic30-sparkle`.

## Launch Funnel Telemetry

- The Mac app ships with the Agentic30 PostHog project token embedded so launch telemetry works from Xcode and signed builds without local secrets. This is a public capture token, not a personal API key: it can write events to PostHog ingest but cannot read analytics data or modify project settings. Never embed a personal API key in the app. `POSTHOG_PROJECT_API_KEY` / `POSTHOG_PROJECT_TOKEN` and `POSTHOG_HOST` can still override the defaults for a custom build, and `scripts/build-and-notarize.sh` verifies the exported app contains a `phc_…` token. The Settings opt-out toggle (`agentic30.posthog.telemetryDisabled` UserDefault) lets end users disable per-device.
- Use a `go.agentic30.app` short URL for the Threads launch link so PostHog receives `short_link_click` from the URL shortener.
- After the DMGs land on GitHub Releases, run `npm run track:release-funnel -- --repo october-academy/agentic30-private --tag <release-tag>` on a short interval during launch day. The script polls `gh api` release asset `download_count` and emits one `installer_downloaded` event per new DMG download.
- Confirm the signed app emits `mac_install_completed` once on first launch, gated on a fresh `agentic30.posthog.distinctId` so existing users who upgrade to this build do not fire the install event. The legacy `dmg_install_completed` event is still emitted for old dashboards.
- The A4 funnel landed in this slice: `short_link_click` → `installer_downloaded` → `mac_install_completed`.
- Host-routed sidecar telemetry for `workspace_setup_started`, `workspace_setup_failed`, and `workspace_setup_completed` is wired. `workspace_setup_completed` is gated on workspace scan success plus first real input, so use it as the workspace-setup funnel terminator only after confirming the events in local telemetry capture or PostHog for the signed artifact.

## Public Distribution Blockers

- Developer ID signing and Hardened Runtime.
- Notarized DMGs for both architectures (arm64 + Intel x64).
- Update channel and rollback path.
- Supportable diagnostics export.
- Clear privacy copy for local project access, provider calls, and Google proof reads.
- Fresh macOS user smoke with no local Node.js installed: install from the DMG, launch, confirm sidecar starts from the bundled runtime and no Gatekeeper “Open Anyway” path is required. Repeat on an Intel Mac (or Rosetta-free x64 VM) with the x64 DMG.
- Sparkle smoke from an older notarized build installed in `/Applications` to a newer notarized DMG referenced by its arch feed (`appcast.xml` for arm64, `appcast-x64.xml` for Intel), including background download and user-approved install/relaunch.
- Keep `https://agentic30.app/appcast.xml` available or redirected during the transition so previously shipped builds that still point at the apex feed are not stranded.

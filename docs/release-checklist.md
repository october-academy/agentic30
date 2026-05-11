# Agentic30 Mac Release Checklist

This checklist is for local dogfood releases of the macOS menu bar app. Public Developer ID distribution needs signing, notarization, updater, and support checks for the PKG primary installer plus the DMG fallback/update archive.

## Dogfood Gate

- `npm install` succeeds from `packages/mac/agentic30`.
- `npm run test:sidecar` passes.
- Focused UI tests pass for hermetic chat, structured prompt choices, settings model pickers, and BIP sidecar failure handling.
- `xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS'` is green or any failure is documented as unrelated to the release.
- Fresh app support data can create a session, select a project folder, answer onboarding, and show Today Mission without Google setup.
- Corrupt `sessions.json` is quarantined as `sessions.json.corrupt-<timestamp>` and visible in diagnostics.
- Normal chat and coaching run read-only by default. Full workspace access only happens from an approved command/action.

## Manual Smoke

1. Launch from Xcode.
2. Confirm provider auth state in Settings.
3. Pick a project folder with a README or docs.
4. Complete the onboarding questions.
5. Confirm a local Today Mission card appears within 2-5 minutes.
6. Configure Google Docs/Sheets and verify proof capture setup separately.

## Launch Funnel Telemetry

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
- Sparkle smoke from an older notarized build installed in `/Applications` to a newer notarized DMG referenced by `https://agentic30.app/appcast.xml`.

# agentic30 Mac

Native macOS menu bar assistant shell for agentic30. The app owns the macOS surface area (floating panel, settings, Keychain, OAuth presentation) and launches a local Node sidecar for provider execution, MCP/ACP adapters, workspace access, and session persistence.

Product context: agentic30 helps solo developers reach 100 users and first revenue in 30 days by turning a selected project path, work logs, customer interviews, and Build in Public records into a personalized adaptive curriculum.

## Run from source

```bash
npm install
npm run doctor
```

1. Install dependencies, then run `npm run doctor` from the repo root.
2. Open `agentic30.xcodeproj` in Xcode and run the `agentic30` scheme.
3. Complete first-run setup in the app: confirm at least one provider is available in Settings, answer onboarding, select the project folder you want Agentic30 to coach, then complete Foundation Setup.

First success means:

- `npm run doctor` reports no `failed` checks.
- At least one provider is authenticated: Claude Code login / `ANTHROPIC_API_KEY`, or Codex login / `CODEX_API_KEY` / `OPENAI_API_KEY`.
- A project folder is selected and onboarding is complete.
- Foundation Setup asks for ICP, GOAL, VALUES, and SPEC, then a Day 1 Mission card appears within 2-5 minutes after the four documents are approved.

Preflight interpretation:

- `failed` means fix the reported recovery step before trying to run the app.
- `warning` can be okay for optional surfaces such as ACP isolated editor integrations or QMD memory. Provider warnings must be fixed before real chat or coaching will work.
- Use Settings -> Diagnostics -> Copy Diagnostics when the app launches but the sidecar, provider auth, or workspace setup looks wrong.

See [docs/first-run-walkthrough.md](docs/first-run-walkthrough.md) for the full first-run path and expected diagnostic output shape.

## Runtime Requirements

- macOS 26.4 SDK target in the current Xcode project.
- Release builds bundle Node.js for the local sidecar. Local development builds still need Node.js 20 or newer to build the sidecar bundle.
- At least one authenticated provider:
  - Claude: local Claude Code login or `ANTHROPIC_API_KEY`
  - Codex: local Codex login or `CODEX_API_KEY` / `OPENAI_API_KEY`

## Telemetry configuration

The PostHog SDK is initialized by the macOS app at launch and the resolved capture config is passed to the Node sidecar. For local telemetry runs, set `POSTHOG_PROJECT_TOKEN` or `POSTHOG_PROJECT_API_KEY` to a PostHog project token (`phc_...`) and optionally set `POSTHOG_HOST` (defaults to US ingest). Placeholder Xcode values and personal API keys are ignored. Debug builds still require `AGENTIC30_ENABLE_DEV_TELEMETRY=1`; `AGENTIC30_DISABLE_TELEMETRY=1` disables both app and sidecar capture.

## UI E2E Modes

Hermetic UI tests use `--ui-testing-opaque-window` and `AGENTIC30_TEST_STUB_PROVIDER=1` so screenshots are stable and provider auth is not required:

```bash
xcodebuild test -project agentic30.xcodeproj -scheme agentic30UITests -destination 'platform=macOS' \
  -only-testing:agentic30UITests/agentic30UITests/testNativeProjectPickerSelectsDirectory \
  -only-testing:agentic30UITests/agentic30UITests/testSettingsModelPickersSelectClaudeAndCodexModels \
  -only-testing:agentic30UITests/agentic30UITests/testSidecarChatFlowHermetic
```

Live canaries are opt-in:

- `AGENTIC30_RUN_LIVE_PROVIDER_E2E=1` enables the real provider chat canary.
- `AGENTIC30_GOOGLE_E2E_EMAIL`, `AGENTIC30_GOOGLE_E2E_PASSWORD`, and `AGENTIC30_GOOGLE_E2E_TOTP_SECRET` enable credentialed Google login E2E.
- `AGENTIC30_MAC_AUTH_BASE_URL` can point Mac auth tests at staging; otherwise `https://agentic30.app` is used.

## Contributor Checks

```bash
npm run doctor
npm run check:public-safety
npm run test:sidecar
xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS'
```

Optional local secret scanning:

```bash
brew install trufflehog gh
gh auth login
npm run scan:secrets:gh
npm run hooks:install
```

`scan:secrets:gh` uses GitHub CLI to resolve the repository default branch and runs TruffleHog against the local git diff from that branch. `hooks:install` opts this checkout into the versioned pre-commit hook under `scripts/git-hooks/`; it is not enabled automatically because git hooks are local developer environment state.

## Assistant Commands

- `/office-hours-docs [context]` - run an Office Hours-style interview, then create or update `docs/ICP.md`, `docs/GOAL.md`, `docs/VALUES.md`, and `docs/SPEC.md`.
- `/bip-draft [topic]` - draft Build In Public content from configured project docs.
- `/analyze-ads <url>` - analyze Meta Ads and PostHog data for a landing page.

## Distribution Posture

The v1 distribution target is direct Developer ID distribution, not Mac App Store. The primary public installer is a signed and notarized PKG, with a signed and notarized DMG as the manual-install fallback and Sparkle update archive. App Sandbox remains disabled for this track because the app launches a bundled Node child process and needs user-selected workspace access. Hardened Runtime, Developer ID signing, notarization, and Sparkle updater validation are release blockers before public distribution.

See:

- [docs/release-checklist.md](docs/release-checklist.md)
- [docs/release-automation.md](docs/release-automation.md)
- [docs/known-limitations.md](docs/known-limitations.md)
- [docs/diagnostics-guide.md](docs/diagnostics-guide.md)
- [docs/first-run-walkthrough.md](docs/first-run-walkthrough.md)
- [docs/qmd-advice-setup.md](docs/qmd-advice-setup.md)

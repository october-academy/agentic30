# agentic30 Mac

Native macOS menu bar assistant shell for agentic30, the October Academy learning platform. The app owns the macOS surface area (floating panel, settings, Keychain, OAuth presentation) and launches a local Node sidecar for provider execution, MCP/ACP adapters, workspace access, and session persistence.

## Prerequisites

- macOS with a current Xcode installation that can build the project's macOS target.
- Node.js 20 or newer.
- npm, using the committed `package-lock.json`.
- At least one local provider login or API key for real provider runs:
  - Claude: local Claude Code login or `ANTHROPIC_API_KEY`
  - Codex: local Codex login or `CODEX_API_KEY` / `OPENAI_API_KEY`

## Development

```bash
npm install
npm run test:sidecar
xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS'
```

## Building

Install dependencies before opening or building the Xcode project:

```bash
npm install
npm run build:sidecar
xcodebuild build -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS'
```

For release-oriented checks, run:

```bash
npm run preflight:release
npm run preflight:bundle
```

## Bundle ID and Signing

The official Bundle ID is `october-academy.agentic30`. Forks and local redistributions should use their own Bundle ID, such as `your.team.agentic30`, to avoid Keychain and Launch Services collisions with the official app. In Xcode, change this under **Targets -> agentic30 -> General -> Bundle Identifier**.

The project is configured for local development signing. Set **Signing & Capabilities -> Team** to your Apple developer team or personal Apple ID before running from Xcode.

## Runtime Requirements

- macOS 26.4 SDK target in the current Xcode project.
- Node.js 20 or newer discoverable through `NODE_BINARY`, common install locations, mise/asdf/Volta shims, or login shell `PATH`.
- At least one authenticated provider:
  - Claude: local Claude Code login or `ANTHROPIC_API_KEY`
  - Codex: local Codex login or `CODEX_API_KEY` / `OPENAI_API_KEY`

## UI E2E Modes

Hermetic UI tests use `--ui-testing-opaque-window` and `AGENTIC30_TEST_STUB_PROVIDER=1` so screenshots are stable and provider auth is not required:

```bash
xcodebuild test -project agentic30.xcodeproj -scheme agentic30 -destination 'platform=macOS' \
  -only-testing:agentic30UITests/agentic30UITests/testNativeProjectPickerSelectsDirectory \
  -only-testing:agentic30UITests/agentic30UITests/testSettingsModelPickersSelectClaudeAndCodexModels \
  -only-testing:agentic30UITests/agentic30UITests/testSidecarChatFlowHermetic
```

Live canaries are opt-in:

- `AGENTIC30_RUN_LIVE_PROVIDER_E2E=1` enables the real provider chat canary.
- `AGENTIC30_GOOGLE_E2E_EMAIL`, `AGENTIC30_GOOGLE_E2E_PASSWORD`, and `AGENTIC30_GOOGLE_E2E_TOTP_SECRET` enable credentialed Google login E2E.
- `AGENTIC30_MAC_AUTH_BASE_URL` can point Mac auth tests at staging; otherwise `https://agentic30.app` is used.

## Assistant Commands

- `/office-hours-docs [context]` - run an Office Hours-style interview, then create or update `docs/ICP.md`, `docs/GOAL.md`, `docs/VALUES.md`, and `docs/SPEC.md`.
- `/bip-draft [topic]` - draft Build In Public content from configured project docs.
- `/analyze-ads <url>` - analyze Meta Ads and PostHog data for a landing page.

## Distribution Posture

The v1 distribution target is direct DMG, not Mac App Store. App Sandbox remains disabled for this track because the app launches a Node child process and needs user-selected workspace access. Hardened Runtime, Developer ID signing, notarization, and updater validation are release blockers before public distribution.

See:

- [docs/release-checklist.md](docs/release-checklist.md)
- [docs/known-limitations.md](docs/known-limitations.md)
- [docs/diagnostics-guide.md](docs/diagnostics-guide.md)
- [docs/qmd-advice-setup.md](docs/qmd-advice-setup.md)

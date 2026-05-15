# First Run Walkthrough

This guide is for a developer cloning the repo and running the macOS app from source.

## 1. Install and Check the Environment

Run these commands from the repo root:

```bash
npm install
npm run doctor
```

Expected output shape:

```text
agentic30 preflight: ok|warning|failed
- [ok] Node.js runtime is supported: ...
- [ok] Application Support is writable: ...
- [ok] Workspace root is readable: ...
- [ok] Sidecar entrypoint is present: ...
- [ok] Internal MCP server is present: ...
- [ok|warning] At least one provider is authenticated: ...
```

Treat `failed` as blocking. Follow the recovery line before launching the app.

Treat `warning` as conditional:

- ACP warnings only matter if you are using isolated ACP editor integrations.
- QMD memory warnings do not block first-run onboarding or Day 1 Mission.
- Provider auth warnings must be resolved before real chat or coaching will work.

## 2. Launch from Xcode

Open `agentic30.xcodeproj` in Xcode and run the `agentic30` scheme.

In Settings, confirm at least one provider is available:

- Claude: local Claude Code login or `ANTHROPIC_API_KEY`
- Codex: local Codex login or `CODEX_API_KEY` / `OPENAI_API_KEY`

## 3. Complete First-Run Setup

1. Answer the onboarding questions so the app can infer your work context, role, stage, and available records.
2. Select the project folder you want Agentic30 to coach.
3. Open the assistant panel and complete Foundation Setup.
4. Approve the ICP, GOAL, VALUES, and SPEC documents.

First success is a Day 1 Mission card appearing within 2-5 minutes after the four Foundation Setup documents are approved.

Google Docs/Sheets and QMD memory are not prerequisites for Day 1 Mission. Google setup belongs to proof capture. QMD improves memory-style coaching when available, but the app should still answer from cached BIP/workspace context or the local fallback mission path.

## Diagnostics

If the app launches but the sidecar, provider auth, workspace scan, ACP, or QMD status looks wrong:

1. Open Settings.
2. Select Diagnostics.
3. Click Refresh.
4. Click Copy Diagnostics.

The diagnostics snapshot is redacted before it reaches Swift. It excludes provider API keys, OAuth tokens, authorization headers, full prompt/message contents, and raw workspace file contents. See [diagnostics-guide.md](diagnostics-guide.md) for details.

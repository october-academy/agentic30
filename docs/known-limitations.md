# Known Limitations

## Distribution

| Limitation | Details |
|---|---|
| Direct DMG only | The current release plan targets Developer ID signed and notarized DMG distribution. Mac App Store distribution is not supported yet. |
| App Sandbox disabled | The app launches a Node child process and accesses user-selected workspaces. Full App Sandbox support requires a sidecar architecture redesign. |
| No automatic updater yet | Sparkle is the selected direct-DMG updater strategy, but it is not wired into the app yet. |
| Notarization not automated | The release checklist defines the required gates, but there is not yet a scripted archive/notarize/staple pipeline. |

## Runtime

| Limitation | Details |
|---|---|
| Node.js required | The app depends on a local Node.js runtime for the sidecar. Preflight fails when Node.js is older than 20 or missing. |
| Child process sidecar | The Swift app directly launches `sidecar/index.mjs`. XPC isolation is a future hardening path, not current behavior. |
| Provider auth is external | Claude and Codex availability depends on local CLI login state or environment API keys. |
| Diagnostics are manual | Users must copy diagnostics from Settings. Native crash reporting is not implemented yet. |

## Compatibility

| Limitation | Details |
|---|---|
| ACP isolated mode needs API keys | The ACP adapter can be installed while unavailable if neither `ANTHROPIC_API_KEY` nor `CODEX_API_KEY` / `OPENAI_API_KEY` is set. |
| Workspace access depends on user selection | Preflight only verifies the current workspace root is readable. Broader sandbox-scoped bookmarks are not implemented. |
| Settings migrations are forward-planned | Current settings have schema versioning and a migration hook, but there is no multi-version migration history yet. |

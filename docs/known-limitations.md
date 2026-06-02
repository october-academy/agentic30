# Known Limitations

## Distribution

| Limitation | Details |
|---|---|
| Direct Developer ID only | The current release plan targets Developer ID signed and notarized PKG distribution with a DMG fallback. Mac App Store distribution is not supported yet. |
| App Sandbox disabled | The app launches a Node child process and accesses user-selected workspaces. Full App Sandbox support requires a sidecar architecture redesign. |
| Sparkle feed is self-hosted | Sparkle is wired to `https://updates.agentic30.app/appcast.xml`; the `agentic30-sparkle` Cloudflare R2 bucket is connected to that custom domain in the `agentic30.app` zone, and the release script stages, verifies, and can upload `appcast.xml` plus the update DMG through Wrangler. Keep the old apex feed available during migration for already shipped builds. |
| Notarization requires Apple credentials | The release script automates archive/notarize/staple checks, but it still requires local Developer ID and App Store Connect credentials. |

## Runtime

| Limitation | Details |
|---|---|
| Bundled Node.js runtime | Release builds carry Node.js for the sidecar. Development builds still require local Node.js 20+ to build and run from source. |
| Child process sidecar | The Swift app directly launches `sidecar/index.mjs`. XPC isolation is a future hardening path, not current behavior. |
| Provider auth is external | Claude and Codex availability depends on local CLI login state or environment API keys. |
| Diagnostics are manual | Users must copy diagnostics from Settings. Native crash reporting is not implemented yet. |

## Compatibility

| Limitation | Details |
|---|---|
| ACP isolated mode needs API keys | The ACP adapter can be installed while unavailable if neither `ANTHROPIC_API_KEY` nor `CODEX_API_KEY` / `OPENAI_API_KEY` is set. |
| Workspace access depends on user selection | Preflight only verifies the current workspace root is readable. Broader sandbox-scoped bookmarks are not implemented. |
| Settings migrations are forward-planned | Current settings have schema versioning and a migration hook, but there is no multi-version migration history yet. |

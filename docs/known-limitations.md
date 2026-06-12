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

## 30-Day Program

| Limitation | Details |
|---|---|
| Active-user count requires PostHog | The 100-active-users count is only fed by the `first_value` HogQL snapshot (`sidecar/active-users-snapshot.mjs`). Without a valid PostHog key, G4②/G5 fall to the §21 provisional overlay (3-day grace) and then hard-block. |
| No traffic collector yet | G5's traffic condition reads `trafficSnapshot` proof events or a live input; neither is auto-collected yet, so a connected Cloudflare still routes through the provisional path until a collector lands. |
| AR-05 / AR-08 signals unwired | The carry-over and Cloudflare-visits inputs of the adaptive rules stay `null` (rules silent, fail-closed) until the curriculum-loop and traffic collectors are wired. |
| Intervention arming is in-memory | The pending gate armed by an intervention-framed Office Hours session does not survive a sidecar restart — re-trigger the intervention; the durable artifact is the gate-ledger token. |
| Review-day cadence is fixed | Gate review days stay 7/14/21/28 (spec A3); pause/reschedule is a later expansion. |

## Compatibility

| Limitation | Details |
|---|---|
| ACP isolated mode needs API keys | The ACP adapter can be installed while unavailable if neither `ANTHROPIC_API_KEY` nor `CODEX_API_KEY` / `OPENAI_API_KEY` is set. |
| Workspace access depends on user selection | Preflight only verifies the current workspace root is readable. Broader sandbox-scoped bookmarks are not implemented. |
| Settings migrations are forward-planned | Current settings have schema versioning and a migration hook, but there is no multi-version migration history yet. |

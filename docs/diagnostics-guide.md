# Diagnostics Guide

agentic30 exposes a redacted diagnostics snapshot from the Node sidecar. Use it when debugging launch failures, provider auth issues, session-store migration problems, and ACP/MCP adapter availability.

## How To Collect

1. Open `Settings`.
2. Select `Diagnostics`.
3. Click `Refresh`.
4. Click `Copy Diagnostics`.

The copied report includes runtime, storage, session, provider, and preflight status. It is safe to share in bug reports because token/key/header-shaped fields are redacted before the snapshot reaches Swift.

## Included Data

- Generated timestamp.
- Workspace root and Application Support path.
- Sidecar PID, platform, architecture, and Node version.
- `sessions.json` schema version and session status counts.
- Claude, Codex, and ACP availability summaries.
- Preflight checks for Node, Application Support, workspace readability, bundled sidecar files, provider auth, and ACP readiness.

## Not Included

- Provider API keys.
- OAuth access or refresh tokens.
- Authorization headers.
- Full prompt/message contents.
- Raw workspace file contents.

## Failure Interpretation

- `failed` preflight checks block reliable sidecar startup or packaging.
- `warning` preflight checks indicate degraded functionality, usually missing provider auth or isolated ACP credentials.
- `ok` preflight checks mean the current direct-DMG child-process runtime is viable, not that Mac App Store sandboxing is supported.

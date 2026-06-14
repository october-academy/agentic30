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

## SourceKit And Xcode Build Server

Local Swift diagnostics use SourceKit-LSP through `xcode-build-server`, not SwiftPM. Keep one SourceKit consumer attached to this checkout at a time. The normal local setup is Zed's `sourcekit-lsp` reading the repo-level `buildServer.json`, which points at `agentic30.xcodeproj`, the `agentic30` scheme, and Xcode's current DerivedData build root.

If Swift diagnostics stall, SourceKitService crashes, or `xcodebuild` reports `XCBuildData/build.db` is locked, first check for duplicate consumers:

```bash
ps -axo pid,ppid,stat,etime,command | rg -i '(sourcekit-lsp|xcode-build-server|lsp-daemon|xcodebuild|SWBBuildService)'
lsof ~/Library/Developer/Xcode/DerivedData/agentic30-*/Build/Intermediates.noindex/XCBuildData/build.db 2>/dev/null
```

Only one editor or LSP daemon should own SourceKit for this checkout. This repo disables `sourcekit-lsp` for the lazycodex LSP daemon through `.codex/lsp-client.json`, leaving Zed as the default SourceKit consumer. If a second Swift LSP is required, give it a separate checkout or separate DerivedData/build-server config; do not share the same `buildServer.json` and DerivedData path.

To reset the local SourceKit build-server state:

```bash
pkill -f 'lazycodex-ai/packages/lsp-daemon/dist/cli.js daemon' || true
pkill -f '/usr/bin/sourcekit-lsp' || true
rm -rf ~/Library/Caches/xcode-build-server/-Users-october-prj-agentic30-public
xcode-build-server config -project agentic30.xcodeproj -scheme agentic30
xcodebuild -list -project agentic30.xcodeproj
```

Then restart the editor that should own SourceKit and run:

```bash
npm run test:swift:unit
xcodebuild build -project agentic30.xcodeproj -scheme agentic30 -configuration Debug -destination 'platform=macOS,arch=arm64'
```

If a new `SourceKitService*.ips` appears under `~/Library/Logs/DiagnosticReports`, inspect the crashing frames. Crashes in `ActorIsolationChecker` or `CallerSideDefaultArgExprRequest` usually point to Swift actor-isolation analysis rather than the Node sidecar.

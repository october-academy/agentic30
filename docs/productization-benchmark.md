# agentic30 Mac Productization Benchmark

This package should benchmark `packages/clawd-on-desk` for productization discipline, not for its Electron process shape.

`clawd-on-desk` is useful as proof that a local desktop AI companion needs install automation, compatibility fallbacks, settings discipline, release operations, diagnostics, tests, and clear limitations. The Mac app should keep its native SwiftUI/AppKit shell plus Node sidecar boundary instead of inheriting an Electron-style main-process monolith.

## Corrected Priority

1. **Process architecture and sandbox posture**
   - Keep the Swift app responsible for windows, menus, Keychain, OAuth presentation, and user-facing state.
   - Keep provider execution, MCP/ACP adapters, and workspace file access inside the Node sidecar.
   - Before distribution, decide whether the sidecar remains a child process, moves to an XPC service, or stays unsandboxed for developer builds only.
   - Track App Sandbox, Hardened Runtime, notarization, and child-process entitlements as release blockers, not polish tasks.

2. **Settings single-write path and schema versioning**
   - Keychain-backed settings are a single blob with `schemaVersion`.
   - New settings fields must decode from older blobs with safe defaults.
   - Config files in Application Support are derived artifacts, not independent sources of truth.

3. **Release, signing, notarization, and updater discipline**
   - A distributable build needs an explicit signing/notarization path before public usage.
   - Updater strategy should be chosen before users depend on local state migrations.
   - Release notes should name compatibility and migration behavior.

4. **Install and compatibility automation**
   - Follow `clawd-on-desk`'s habit of detecting installed tools, versions, and stale integration state.
   - Prefer actionable runtime diagnostics over silent failure.
   - Treat Node, Claude, Codex, ACP, and MCP availability as separately diagnosable capabilities.

5. **Crash reporting and diagnostics**
   - The sidecar exposes a sanitized diagnostics snapshot via `get_diagnostics`.
   - Diagnostics must never include provider keys, OAuth tokens, or authorization headers.
   - Add native crash reporting before distributing beyond local development.

6. **Provider/agent registry**
   - Learn the registry pattern from `clawd-on-desk`, but do not port its CommonJS/Electron implementation.
   - Model providers as capability descriptors once the two-process boundary is stable.

7. **Tests, performance, and user-facing docs**
   - Tests should protect migrations, process boundaries, provider fallback behavior, and ACP/MCP contracts.
   - Performance checks should focus on launch, sidecar startup, streaming latency, and long-running session stability.
   - Capability matrices and limitations docs are important user-facing artifacts, but they should reflect runtime checks rather than substitute for them.

## What Not To Copy

- Do not copy the Electron main-process aggregation pattern.
- Do not copy the full theme/skin subsystem unless the product direction becomes a desktop companion character app.
- Do not treat Clawd's agent hook strategy as directly portable to native macOS. Use it as evidence for compatibility automation, not as implementation guidance.

## Native Appearance Requirement

Avoid copying Clawd's custom theme system by default, but still treat native macOS appearance support as required. Light/Dark mode, menu bar template rendering, accessibility contrast, and system material behavior are baseline platform compliance, not optional theming.

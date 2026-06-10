# Changelog

## [1.0.16] - 2026-06-11

### Fixed
- **Release Upload Reliability**: Sparkle R2 uploads now publish the DMG (and verify it is publicly fetchable) before flipping the `appcast.xml` pointer, and retry transient Cloudflare edge errors (502) with backoff. Previously a 502 on a large arm64 DMG upload left the live feed pointing at a missing file. Re-cuts the Intel/Apple Silicon split release so both `appcast.xml` (Apple Silicon) and `appcast-x64.xml` (Intel) ship working DMGs.

## [1.0.15] - 2026-06-10

### Added
- **Intel Mac Support**: Releases now ship two separate DMGs built in parallel — `agentic30-<build>-arm64.dmg` for Apple Silicon and `agentic30-<build>-x64.dmg` for Intel Macs. Each bundle carries its matching `node-darwin-*` sidecar runtime.
- **Per-Architecture Sparkle Feeds**: Intel builds read `appcast-x64.xml` while Apple Silicon builds keep the historical `appcast.xml`, so auto-updates always deliver the correct architecture.

### Changed
- **Release Pipeline**: `build-and-notarize.sh` accepts `AGENTIC30_BUNDLE_ARCH` (`arm64`/`x64`/`universal`), embeds a per-arch `SUFeedURL`, and verifies architecture slices and bundled Node runtimes before notarization. The GitHub Actions release workflow builds both architectures as parallel matrix jobs.

## [1.0.14] - 2026-06-10

### Added
- **MCP OAuth Connections**: Added an explicit "MCP Connect" button in Settings to trigger browser OAuth login and verify read-only tool connections for PostHog and Cloudflare.
- **Deploy & Package Telemetry**: Enhanced morning briefing telemetry to count GitHub package updates (`gh api packages`) and published releases (`gh release list`) alongside workflow runs in the deploy KPI count.
- **Onboarding Usage Limit UI**: Surfaces an explicit warning banner and manual provider-switch rescan button if the scan provider hits quota limits during workspace analysis.

### Changed
- **Codex Scan Model**: Swapped the retired `gpt-5.1-codex-mini` workspace scan model for the active, low-cost `gpt-5.4-mini` model to prevent 400 API rejection errors.

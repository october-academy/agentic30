# Changelog

## [1.0.14] - 2026-06-10

### Added
- **MCP OAuth Connections**: Added an explicit "MCP Connect" button in Settings to trigger browser OAuth login and verify read-only tool connections for PostHog and Cloudflare.
- **Deploy & Package Telemetry**: Enhanced morning briefing telemetry to count GitHub package updates (`gh api packages`) and published releases (`gh release list`) alongside workflow runs in the deploy KPI count.
- **Onboarding Usage Limit UI**: Surfaces an explicit warning banner and manual provider-switch rescan button if the scan provider hits quota limits during workspace analysis.

### Changed
- **Codex Scan Model**: Swapped the retired `gpt-5.1-codex-mini` workspace scan model for the active, low-cost `gpt-5.4-mini` model to prevent 400 API rejection errors.

# Changelog

## [Unreleased]

### Added
- **In-App Update Visibility**: The menu bar now shows an "업데이트 X.Y.Z 설치…" row whenever a new build is pending, so menu-bar-resident users see updates without the workspace window open. Sparkle's update dialog now shows a what's-new section — release notes are extracted from the newest released CHANGELOG section and embedded into the signed appcast (`generate_appcast --embed-release-notes`).

### Fixed
- **Update Pill Dead-Ends**: Clicking the update pill while a background download is in flight now always surfaces the transient update-status panel instead of routing to a Settings row with a disabled button. A transient failed check (e.g. offline at the next 6-hour check) no longer hides an update that is already downloaded and staged. "Skip This Version" in Sparkle's dialog now also hides the gentle reminder pill instead of nagging about the skipped build.

### Changed
- **Release Pipeline Safety**: GitHub releases are now draft-gated — a single draft is created up front, per-arch jobs only upload assets, and the release is published only when both arch DMGs are attached (prevents public half-releases like v20260611-0738). The Sparkle version guard fails closed when the live feed is unreachable (`allow_unguarded` dispatch input bootstraps a new feed), release runs are serialized so an older slow run can't regress the live appcast, and release titles/bodies are derived from `Info.plist` + the newest CHANGELOG section instead of raw tag names and full-history dumps.

## [1.0.17] - 2026-06-11

### Added
- **Morning Briefing Live Collection Progress**: While the briefing collects, each source card (Cloudflare/GitHub/PostHog) now shows a spinner plus a live agent log streamed from the sidecar (`morning_briefing_progress` events: MCP tool calls, aggregation steps, timestamps). Re-entering the briefing tab mid-collection restores the per-card progress instantly, so a minutes-long external MCP digest no longer looks frozen.

### Fixed
- **Morning Briefing Live Connection Status**: The briefing's sync-source panel ("동기화 소스") and connect-guide banner now re-check git/gh CLI/PostHog/Cloudflare connection state (provider-scoped MCP OAuth included) every time the briefing is served, instead of replaying the connection snapshot baked in at generation time. Connecting MCP in Settings after the morning collection no longer leaves the briefing claiming "미연결" while Settings shows "MCP 연결됨". Metric cards and sync timestamps stay snapshot-true; only connection rows go live, and the overlay is never persisted.
- **Cloudflare Digest Timeout Salvage**: When the external MCP digest hits the 240s soft timeout right before finishing (a recurring pattern: aggregation done, final JSON cut mid-stream), the sidecar now salvages the streamed partial output — if the JSON parses complete and self-reports ready, the card gets its numbers instead of a blanket timeout error. The timeout message also states the MCP connection itself is healthy, and non-ready cards distinguish "수집 실패 · 연결은 정상" (collection failed) from "연결 필요" (truly disconnected), so a connected-but-slow Cloudflare is no longer misdiagnosed as a connection problem.

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

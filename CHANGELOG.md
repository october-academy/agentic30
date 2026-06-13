# Changelog

## [Unreleased]

### 추가
- **Codex Office Hours 카드 입력**: Codex MCP 구조화 입력 카드가 제출 전에는 pending 상태로 머물고, 사용자가 답을 제출한 뒤에만 다음 질문을 이어가도록 했습니다.
- **인터뷰 카드 Q01 시각 스펙**: Day 1 인터뷰 첫 질문 카드의 HTML/PNG 레퍼런스를 `docs/specs/`에 추가했습니다.

### 변경
- **Office Hours Day 1 handoff**: GOAL/ICP/VALUES/SPEC 저장과 Day 1 완료를 분리하고, 문서 저장 뒤 `$plan-ceo-review` handoff를 거쳐 Day 2로 넘어가도록 정리했습니다.
- **Settings 연동 화면**: Vercel, Cloudflare, PostHog을 compact MCP OAuth row로 정리하고 수동 토큰/URL 필드와 Exa 예비 키를 숨겼습니다.
- **Office Hours 증거/개입 배너**: 예약 intervention은 열린 증거 부채 배너 안에 접고, 즉시 intervention은 full-width 배너로 유지하도록 했습니다.
- **Morning Briefing drilldown**: per-source drilldown header에서 다음 소스 pill을 제거했습니다.

### 수정
- **Office Hours 재개/수정 안정성**: resume preamble 중복을 제거하고 stable question identity로 keep-last dedupe하며, 완료된 인터뷰도 이전 답변 수정이 가능하게 했습니다.
- **Office Hours 중복 시작 방지**: 이미 실행 중이거나 구조화 입력 대기 중인 Office Hours start 요청은 오류 대신 현재 세션 상태를 재방송하도록 했습니다.
- **개입 시작 상태 정리**: intervention trigger로 Office Hours를 시작하면 Mac 상태의 pending intervention을 즉시 지웁니다.
- **UI 테스트 안정성**: Office Hours 제출 카드의 revision confirm 버튼을 native accessibility button으로 노출하고, 시스템 알림 dialog가 스크롤 제스처를 막을 때 닫도록 했습니다.
- **Swift actor-isolation 경고 정리**: 강조 span 모델을 `nonisolated`로 선언해 Swift 6 actor-isolation 진단이 릴리스 빌드에 남지 않도록 했습니다.

## [1.0.19] - 2026-06-11

### 추가
- **Office Hours 답변 수정**: 제출한 Office Hours 카드가 세션 런타임에 스냅샷으로 복원되고, 사용자는 이전 선택지나 자유 입력을 눌러 해당 카드부터 다시 시작할 수 있습니다. 수정 시 이후 답변과 추천 후보가 정리되어 변경된 답변 기준으로 인터뷰가 다시 이어집니다.
- **BIP 알림 진입 경로**: 오전 알림은 오늘 Office Hours 인터뷰로, 저녁 알림은 실행 완료 확인 화면으로 바로 이동합니다. 알림 문구도 실제 인터뷰/실행 체크 흐름에 맞게 정리했습니다.
- **Office Hours 화면 공유**: Office Hours 화면을 이미지로 캡처해 공유할 수 있는 경로를 추가했습니다.

### 변경
- **활성 사용자 목표 기준 강화**: “첫 100명 사용자” 목표를 가입 수가 아니라 “핵심 활성 행동을 끝낸 사용자 100명”으로 재정의하고, Office Hours 질문과 브리핑 요약에서도 활성 사용자 기준이 비어 있으면 먼저 잠그도록 안내합니다.
- **Day 1 handoff 문서 품질 개선**: GOAL/ICP/VALUES/SPEC handoff 문서를 사용자가 바로 읽을 수 있는 한국어 문서 형태로 작성하고, 내부 운영 문구·placeholder·중복 제목이 노출되지 않도록 정리했습니다.
- **Office Hours 한국어 UI 문구 계약**: 구조화 질문 카드에 내부 용어(ICP, activation action, proof target 등)나 가입자 목표 회귀가 노출되지 않도록 한국어 UI-copy 검사를 추가했습니다.

### 수정
- **워크스페이스 스캔 복구 안내**: 스캔이 막혔을 때 provider별 SDK 설치, 인증, 스캔 가능 여부를 함께 내려 Mac 앱에서 다음 선택지를 더 정확히 보여줍니다. 새 스캔 시작 시 오래된 캐시도 먼저 지워 stale 결과가 재사용되지 않게 했습니다.
- **Sidecar 장애 관측성**: sidecar 부팅 실패, 연결 후 예기치 않은 종료, 삼킨 오류를 PostHog 로그/예외로 함께 기록해 릴리즈 후 장애 원인을 더 빨리 좁힐 수 있게 했습니다.
- **메모리 채팅 라우팅**: qmd가 없거나 일반 짧은 질문인 경우에도 `memory_chat` 실행 모드로 유지해 메모리 의도와 일반 대화 경로가 일관되게 처리됩니다.

## [1.0.18] - 2026-06-11

### Added
- **In-App Update Visibility**: The menu bar now shows an "업데이트 X.Y.Z 설치…" row whenever a new build is pending, so menu-bar-resident users see updates without the workspace window open. Sparkle's update dialog now shows a what's-new section — release notes are extracted from the newest released CHANGELOG section and embedded into the signed appcast (`generate_appcast --embed-release-notes`).

### Fixed
- **Update Pill Dead-Ends**: Clicking the update pill while a background download is in flight now always surfaces the transient update-status panel instead of routing to a Settings row with a disabled button. A transient failed check (e.g. offline at the next 6-hour check) no longer hides an update that is already downloaded and staged. "Skip This Version" in Sparkle's dialog now also hides the gentle reminder pill instead of nagging about the skipped build.
- **Morning Briefing Drilldowns**: Cloudflare drilldowns now clamp wide briefing windows to the trailing 24 hours and use eyeball path analytics ordered by response bytes, while the external digest prompt gives source-specific drilldown collection plans for Cloudflare and PostHog.

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

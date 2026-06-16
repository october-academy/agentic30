# Changelog

## [Unreleased]

## [1.0.24] - 2026-06-16

### 추가
- **전략 리포트 재리서치**: Strategy 화면에 정적 레퍼런스를 유지하면서도 수동 재리서치 버튼으로 Exa 기반 공개 근거, 경쟁 구도, SWOT, 캔버스 리포트를 다시 생성하는 sidecar/Swift 경로를 추가했습니다.
- **`.agentic30/` gitignore 동의 게이트**: 워크스페이스 스캔이 `.agentic30/` ignore 항목을 자동으로 쓰기 전에 사용자 동의를 받도록 하고, 승인/거절 결과를 sidecar와 앱 상태에 반영합니다.

### 변경
- **뉴스·브리핑 근거 품질**: 시장 레이더 카드가 가격·리뷰·런칭·anti-signal 근거를 더 다양하게 보존하고, Morning Briefing/Office Hours 소스 상태가 연결 상태와 수집 상태를 분리해 보여줍니다.
- **전략/뉴스 레퍼런스 UI**: Strategy와 News 화면에서 근거 링크, 발행 정보, 출처 설명을 더 길게 확인할 수 있도록 세부 카드와 rail 라우팅을 정리했습니다.

### 수정
- **macOS 폴더 선택 안정성**: Settings/온보딩의 workspace picker를 전용 presenter로 감싸 open panel XPC 중단과 중복 표시를 줄였습니다.
- **전략 리서치 timeout**: 실제 sidecar run 로그에서 4분 hard timeout을 확인하고 provider 공개 검색 기본 예산을 8분으로 늘렸습니다.

## [1.0.23] - 2026-06-14

### 추가
- **Office Hours 증거 마감 정책**: Day를 advice·계획·자기보고가 아니라 하드 고객 증거, posted URL, blocked, carry 중 하나로만 닫도록 day-close 정책 게이트를 추가했습니다. mandatory BIP는 target behavior로 표시하고, BIP Research Radar 후보는 ready 캐시가 있을 때만 사용합니다.
- **Morning Briefing 증거 퍼널·스파크라인**: 방문→설치→워크스페이스→검증 행동 evidence funnel, 고객 증거 verdict, 카드별 추세 스파크라인을 추가했습니다.

### 변경
- **Office Hours specialist 재정의**: Garry Tan식 강제질문에서 "증거 마감 운영자"로 재구성해 오늘의 가장 좁은 외부 검증 행동과 Day close 조건(고객 증거/posted URL/blocked/carry)으로 좁힙니다.
- **PostHog 내부 트래픽 필터**: october-academy.com 계정을 내부 테스터로 태깅하고, daily office-hours digest의 product-signal 필터가 내부 트래픽을 제외하도록 강화했습니다.
- **크래시 심볼리케이션**: 릴리즈 빌드가 dSYM을 PostHog에 업로드하도록 했습니다(opt-in).

### 수정
- **Provider 중단 처리**: provider abort를 로컬 stop_session 취소와 구분되는 복구 가능한 provider_aborted 엔벨로프로 전달합니다.

## [1.0.22] - 2026-06-13

### 수정
- **Office Hours UI 테스트 안정성**: 이전 답변 수정 흐름을 DEBUG UI 테스트 자동 제출 경로로 검증해 macOS ScrollView 위치 의존성을 줄였습니다.

## [1.0.21] - 2026-06-13

### 변경
- **프로젝트 문서 탐색 엄격화**: IDD 기본 입력과 workspace signal docs 역할이 루트 `README.md` 대신 `.agentic30/docs/DOCS.md` canonical 문서를 기준으로 삼도록 정리했습니다.
- **Workspace scan evidence bundle**: 로컬 canonical 문서 탐색 결과와 provider 의미 검증을 분리해, provider가 문서 경로를 재정의하지 못하고 bundle 근거 안에서만 onboarding/situation 신호를 판단하도록 했습니다.
- **Workspace scan provider fallback**: read-only tool gating이 없는 Cursor는 workspace scan 추천 후보에서 제외하고, Codex/Claude/Gemini scan-ready provider만 fallback으로 노출합니다.

## [1.0.20] - 2026-06-13

### 추가
- **프로젝트 문서 경로 공통화**: sidecar 전반에서 GOAL/ICP/VALUES/SPEC/DESIGN_SYSTEM/ADR/DOCS/SHEET 경로를 한 곳에서 관리하도록 `project-doc-paths` 모듈을 추가했습니다.
- **Codex Office Hours 카드 입력**: Codex MCP 구조화 입력 카드가 제출 전에는 pending 상태로 머물고, 사용자가 답을 제출한 뒤에만 다음 질문을 이어가도록 했습니다.
- **완료된 Office Hours 인터뷰 복원**: 완료된 Day-scoped 인터뷰를 다시 열면 provider를 새로 시작하지 않고 저장된 Q/A 스냅샷과 제출 상태를 즉시 복원합니다.
- **인터뷰 카드 Q01 시각 스펙**: Day 1 인터뷰 첫 질문 카드의 HTML/PNG 레퍼런스를 `docs/specs/`에 추가했습니다.

### 변경
- **Agentic30 프로젝트 문서 위치**: Office Hours/IDD/BIP 문서의 canonical 저장 위치를 `docs/*.md`에서 `.agentic30/docs/*.md`로 옮기고, legacy `docs/*.md`는 product-shape 문서 seed로 읽거나 덮어쓰지 않도록 정리했습니다.
- **ICP 라벨**: 문서 preview와 structured input에서 `고객 후보` 제목을 `Ideal Customer Profile`로 표기해 ICP 문서 의미를 명확히 했습니다.
- **Office Hours Day 1 handoff**: GOAL/ICP/VALUES/SPEC 저장과 Day 1 완료를 분리하고, 문서 저장 뒤 다음 약속 카드가 이어지며 약속을 닫은 뒤에만 Day 2로 넘어가도록 정리했습니다.
- **Settings 연동 화면**: Vercel, Cloudflare, PostHog을 compact MCP OAuth row로 정리하고 수동 토큰/URL 필드와 Exa 예비 키를 숨겼습니다.
- **Office Hours 증거/개입 배너**: 예약 intervention은 열린 증거 부채 배너 안에 접고, 즉시 intervention은 full-width 배너로 유지하도록 했습니다.
- **Morning Briefing drilldown**: per-source drilldown header에서 다음 소스 pill을 제거했습니다.
- **Sidecar 테스트 스위트 정리**: 실제 `gws` CLI 상태에 의존하던 Google auth hang 회귀 테스트를 기본 sidecar suite에서 제거해 릴리스 검증을 hermetic하게 유지했습니다.

### 수정
- **Office Hours 자유 입력 제출**: structured free-text 필드가 macOS에서 안정적으로 포커스를 받고 Return 키로 현재 질문을 제출하도록 고쳤습니다.
- **Office Hours 질문 스크롤 여백**: Day 1 활성 질문 카드 아래에 큰 빈 공간이 남지 않도록 pending prompt tail 높이를 viewport와 상태에 맞춰 조정했습니다.
- **Office Hours 재개/수정 안정성**: resume preamble 중복을 제거하고 stable question identity로 keep-last dedupe하며, 완료된 인터뷰도 이전 답변 수정이 가능하게 했습니다.
- **Office Hours 중복 시작 방지**: 이미 실행 중이거나 구조화 입력 대기 중인 Office Hours start 요청은 오류 대신 현재 세션 상태를 재방송하도록 했습니다.
- **개입 시작 상태 정리**: intervention trigger로 Office Hours를 시작하면 Mac 상태의 pending intervention을 즉시 지웁니다.
- **UI 테스트 안정성**: Office Hours 제출 카드의 revision confirm 버튼을 native accessibility button으로 노출하고, 시스템 알림 dialog가 스크롤 제스처를 막을 때 닫도록 했습니다.
- **Swift actor-isolation 경고 정리**: 강조 span 모델을 `nonisolated`로 선언해 Swift 6 actor-isolation 진단이 릴리스 빌드에 남지 않도록 했습니다.
- **Swift Text 조립 경고 정리**: transcript segment 렌더링에서 deprecated `Text + Text` 조합을 제거했습니다.
- **Day 1 문서 handoff 순서**: GOAL/ICP/VALUES/SPEC 저장 전에는 commitment bar를 숨기고, 문서 저장 완료 뒤에만 다음 약속 입력이 보이도록 정리했습니다.
- **Office Hours 완료 스크롤 안정성**: 인터뷰 완료와 해당 Day interview step 활성 상태를 함께 확인한 뒤 commitment bar를 렌더링하고, 문서 저장 완료 후 자동 스크롤이 다음 약속 입력 또는 최종 Day 2 버튼으로 안정적으로 향하도록 했습니다.

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

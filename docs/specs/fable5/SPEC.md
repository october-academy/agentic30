# Agentic30 Fable 5 MVP 명세

이 문서는 Fable 5 MVP migration의 구현 contract다. 현재 shipped app contract가 아니다.

## 1. 제품 프레임

Agentic30은 전업 1인 개발자가 project context와 local work memory를 사용해 customer validation을 좁히도록 돕는다.

MVP loop:

```text
Onboarding -> Project Scan -> Day 1-3 Interview -> Founder Replay
```

## 2. 범위

범위 안:

- macOS onboarding과 workspace selection
- provider/auth/model readiness
- quote-backed project scan
- Day 1-3 one-question-at-a-time interview
- Founder Replay consent, permission probe, capture, search, delete
- diagnostics와 named root-cause failures

MVP 이후:

- Day 4+
- revenue/payment/active-user scoreboard
- broad Evidence Inbox 또는 proof ledger
- Morning Briefing, Strategy, Reference
- automatic outreach/posting/deploy/payment mutation
- multi-workspace와 non-macOS support

## 3. Greenfield 경계

새 target에 구현한다. 기본 target은 `fable5-mvp/`다. `agentic30/`, `sidecar/`, `agentic30Tests/`, `sidecar-tests/`를 in-place refactor하지 않는다.

현재 코드는 in-scope UX reference일 뿐이다. Product feel은 보존한다. State ownership과 file structure는 교체한다.

## 4. Agent 역할 분리

Fable 5는 더 높은 product/architecture context를 가진다. Concrete migration plan, workflow design, subagent orchestration, gate order, scope control, acceptance criteria, final review를 소유한다.

`opus 4.8 xhigh`는 할당된 packet의 implementation work, focused verification, handoff report만 소유한다.

모든 Opus task packet은 objective, in/out scope, target files/symbols, ordered steps, state owner, contracts/events/failure names, forbidden shortcuts, verification commands, acceptance, handoff format을 포함해야 한다.

Opus에게 product, architecture, workflow, subagent strategy를 추론시키지 않는다. Fable이 위임 전에 결정한다.

## 5. Handoff와 agent memory

각 Opus handoff report는 packet id, objective, 변경 파일, contract/event/schema 변경, 실행한 command, manual QA 결과, blocker/root cause, 다음 packet 제안을 포함한다.

`TODO.md`는 현재 결정과 남은 일만 담는다. 완료된 역사 기록을 누적하지 않는다.

검증된 구현 교훈은 `fable5-mvp/docs/agent-memory/<slug>.md`에 저장한다. 파일 하나는 교훈 하나만 담고, 첫 줄에 요약을 둔다. 이미 `SPEC.md`, `USER_STORIES.md`, `TODO.md`에 있는 내용은 중복하지 않는다. 틀린 memory는 수정하거나 삭제한다.

## 6. Runtime 소유권

| Runtime | 소유 | 소유하면 안 되는 것 |
|---|---|---|
| SwiftUI/AppKit | native UI, menu/window/navigation, TCC UX, capture/AX/Vision actors, Keychain, process supervision | durable interview, scan, recorder, provider truth |
| Rust | events, reducers, SQLite/WAL/FTS/migrations, scan result, Day 1-3 state, recorder ingest/search/delete/retention, diagnostics, typed local API | provider SDKs, macOS permission prompts |
| Node | provider adapters, auth/model checks, prompt assembly, streaming/error/result normalization | durable state, recorder DB mutation |

Node output은 proposal이다. Rust reducer가 결정한다. Swift는 rendering과 native effect를 수행한다.

## 7. Process 계약

- Swift가 Rust를 먼저 시작한다.
- Rust가 unavailable이면 diagnostics만 보여준다.
- Swift는 Rust readiness 이후 Node를 시작한다.
- Node는 scan, interview, recorder state를 직접 쓰지 않는다.
- Heartbeat는 runtime, version, schema version, build id, readiness, timestamp를 포함한다.
- Shutdown 순서: Node stream cancel, Rust storage checkpoint, Swift exit.

## 8. Target 구조

```text
fable5-mvp/
├── apps/macos/Agentic30/
│   ├── App/
│   ├── Navigation/
│   ├── Features/{Onboarding,Scan,DayInterview,FounderReplay,Diagnostics,Settings}/
│   ├── SharedUI/
│   ├── MacPermissions/
│   ├── Capture/
│   └── GeneratedContracts/
├── crates/{agentic30-core,agentic30-store,agentic30-recorder,agentic30-contracts,agentic30-cli}/
├── sidecar/agent/{providers,prompts,contracts}/
└── contracts/{events,schemas,fixtures}
```

Entry point는 dependency wiring만 한다. Feature file은 하나의 feature만 소유한다.

## 9. Anti-pattern

만들지 않는다:

- 새 `AgenticViewModel`
- mega `ContentView`
- mega `sidecar/index.mjs`
- 모든 feature state를 소유하는 global object
- stringly typed runtime messages
- silent provider/model fallback
- placeholder readiness 또는 fake completion
- live capture처럼 보이는 seeded replay

## 10. Core ID

Rust가 durable ID를 발급한다.

- `WorkspaceId`
- `ProjectId`
- `ScanRunId`
- `DayId`
- `InterviewSessionId`
- `QuestionId`
- `RecorderSourceId`
- `ProviderRunId`

모든 event는 schema version, timestamp, actor, runtime, 적용 가능한 workspace/project, correlation id, redaction level을 포함한다.

## 11. 최소 이벤트

- `workspace_selection_started`
- `workspace_selected`
- `workspace_selection_failed`
- `provider_auth_checked`
- `provider_model_supported`
- `provider_model_rejected`
- `project_context_scan_started`
- `project_context_scanned`
- `project_context_scan_blocked`
- `day_interview_started`
- `day_interview_question_created`
- `day_interview_question_answered`
- `day_interview_state_advanced`
- `day_interview_blocked`
- `recorder_consent_requested`
- `recorder_consent_changed`
- `mac_permission_health_checked`
- `recorder_capture_ingested`
- `recorder_search_performed`
- `recorder_range_deleted`
- `diagnostic_bundle_created`

## 12. Scan 계약

Scan은 read-only다.

필수 출력:

- workspace display label
- detected project type
- source candidates와 unavailable sources
- source quote list
- customer/problem/current surface hints
- confidence
- 부족할 때 blocked reason

Success는 quote-backed claim을 요구한다. Generic markdown은 quote가 field를 뒷받침할 때만 count한다.

실패: `WORKSPACE_NOT_SELECTED`, `WORKSPACE_UNREADABLE`, `WORKSPACE_PERMISSION_DENIED`, `PROJECT_CONTEXT_INSUFFICIENT`, `PROJECT_CONTEXT_QUOTES_MISSING`, `WORKSPACE_SCAN_TIMEOUT`, `SCAN_REDACTION_FAILED`.

## 13. Day 1-3 Interview 계약

Interview는 state machine이며 open chat이 아니다.

규칙:

- active question은 한 번에 하나
- question type은 Rust allowlist에서 나온다
- Node는 wording만 제안할 수 있다
- answer는 typed durable event다
- repeat loop는 state로 block한다
- Day 4+는 MVP completion path가 아니다

Day 목표:

| Day | 목표 |
|---|---|
| Day 1 | project와 customer hypothesis를 좁힌다 |
| Day 2 | customer problem을 current surface와 연결한다 |
| Day 3 | next validation action과 expected trace를 고른다 |

실패: `DAY_INTERVIEW_CONTEXT_MISSING`, `QUESTION_TYPE_NOT_ALLOWED`, `QUESTION_ALREADY_ACTIVE`, `QUESTION_ANSWER_INVALID`, `QUESTION_REPEAT_GUARD_TRIGGERED`, `DAY_TRANSITION_BLOCKED`, `PROVIDER_WORDING_UNAVAILABLE`.

## 14. Founder Replay 계약

Founder Replay는 local work memory이며 market proof가 아니다.

MVP surface:

- Control: permission, consent, pause, stop, delete
- Replay: visual timeline shell
- Table/Search: redacted local memory
- Pipes: local rule preview, external mutation 없음

Capture는 explicit consent, visible indicator acknowledgement, Screen Recording probe, Accessibility probe, actor validation을 요구한다.

실패: `RECORDER_CONSENT_MISSING`, `SCREEN_RECORDING_MISSING`, `ACCESSIBILITY_MISSING`, `PERMISSION_ACTOR_MISMATCH`, `APP_TRANSLOCATED`, `VISIBLE_INDICATOR_NOT_ACKED`, `RECORDER_INGEST_FAILED`, `RECORDER_REDACTION_FAILED`, `RECORDER_SEARCH_UNAVAILABLE`, `RECORDER_DELETE_CONFIRMATION_REQUIRED`, `RECORDER_DELETE_FAILED`.

## 15. Storage

Rust가 SQLite를 소유한다.

필수 테이블:

- `domain_events`
- `workspaces`
- `projects`
- `scan_runs`
- `scan_claims`
- `day_interview_sessions`
- `day_interview_answers`
- `recorder_frames`
- `recorder_media_assets`
- `recorder_text_index`
- `recorder_audit`
- `provider_runs`
- `diagnostics`

요구사항: WAL, forward-only migrations, migration fixture test, diagnostics의 schema version, encrypted raw media, redacted FTS only, delete receipt.

## 16. Provider 계약

Provider 입력:

- typed redacted context
- task contract
- output schema

Provider 출력:

- proposal stream
- final structured proposal
- diagnostics

실패: `PROVIDER_AUTH_MISSING`, `PROVIDER_MODEL_UNSUPPORTED`, `PROVIDER_SDK_MISSING`, `PROVIDER_TIMEOUT`, `PROVIDER_REFUSAL`, `PROVIDER_RATE_LIMITED`, `PROVIDER_OUTPUT_SCHEMA_INVALID`.

Fallback은 UI가 provider/model change를 기록할 때만 허용한다. Weaker-model fallback은 user approval을 요구한다.

## 17. Privacy와 telemetry

Local log는 필요하다. Remote telemetry는 optional이며 redacted여야 한다.

Remote telemetry에 local file path, raw customer text, screenshot, transcript, provider prompt, token, secret, raw recorder data를 보내지 않는다.

금지: TCC DB write, System Settings click automation, silent raw clipboard capture, cloud OCR fallback, provider-readable raw media.

## 18. 검증

MVP completion 주장 전:

- focused Swift/Rust/Node test 통과
- cross-runtime contract fixture 통과
- god-object drift check 통과
- diagnostics가 첫 root cause를 보여줌
- manual QA가 matching app surface를 구동함

Manual QA path:

1. app launch
2. real project path 선택
3. provider readiness 하나 확인
4. scan 실행 후 result 또는 named blocker 관찰
5. Day 1, Day 2, Day 3 답변
6. Founder Replay에서 capture/search/delete 또는 정확한 TCC blocker 관찰
7. redacted diagnostics copy

## 19. 현재 앱 UX anchor

아래는 behavior/design reference이며 복사할 code가 아니다.

| 영역 | 기준 | 보존할 것 |
|---|---|---|
| Design tokens | `agentic30/OpenDesignTokens.swift:3` | radius, type scale, snap motion, shadow/ink language |
| Theme/brand | `agentic30/Agentic30BrandColor.swift:4` | dark/default theme, white theme, brand accent |
| Interview palette | `agentic30/ContentView.swift:172` | dark workspace palette와 semantic accent colors |
| Rail model | `agentic30/OpenDesignDayPageView.swift:2151` | MVP route로 제한된 rail mental model |
| Rail layout | `agentic30/OpenDesignDayPageView.swift:14908` | left rail, active item, status, bottom mark |
| Locked preview | `agentic30/OpenDesignDayPageView.swift:7280` | MVP 이후 surface용 feature-specific static preview |
| Interview tooling | `agentic30/OpenDesignDayPageView.swift:6957` | compact titlebar와 toolbar 느낌 |
| Founder Replay titlebar | `agentic30/OpenDesignDayPageView.swift:7022` | replay rail surface와 search affordance |
| Founder Replay modes | `agentic30/OpenDesignDayPageView.swift:8889` | `Replay`, `Table`, `Control`, `Pipes` |
| Settings | `agentic30/SettingsView.swift:123` | independent native settings surface |
| Onboarding | `agentic30/MacOnboardingView.swift:24` | native macOS onboarding feel |

Anti-anchor: `agentic30/ContentView.swift:2332`의 cross-feature `@State` ownership은 보존할 구조가 아니라 제거할 구조다.

## 20. 완료의 의미

- MVP loop가 작동하거나 named blocker에서 멈춘다.
- Runtime ownership이 이 spec과 일치한다.
- In-scope UI/UX가 Agentic30처럼 느껴진다.
- `TODO.md`에는 현재 남은 일만 있다.

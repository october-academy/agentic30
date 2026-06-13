# Agentic30 30-Day Adaptive Program Spec

> **작성일:** 2026-06-12 · **기준 코드:** `main` @ c80e257 (v1.0.19 build 24)
> **상태:** 구현 대기 명세 (implementation-ready)
> **근거 표기 원칙:** 모든 current-state 주장에는 근거 파일(필요 시 라인)을 병기한다. 라인 번호는 2026-06-12 HEAD 기준 관찰값이다. 코드로 확인 못 한 항목은 `Assumption`으로 분리했다(§28).

---

## 1. Executive Summary

Agentic30은 전업 1인 개발자가 30일 안에 **활성 사용자 100명과 첫 매출**을 검증하도록 압박·보정하는 실행 OS다. 이 스펙은 현재 Day-1 중심으로 구현된 제품을 Day 1–30 누적형 adaptive program으로 확장하는 제품/기술 명세다.

핵심 발견 (현재 상태):

1. **30일 커리큘럼 콘텐츠는 이미 코드에 저작되어 있다.** `IDD_BASE_CURRICULUM`(코드 내 30일 기본 커리큘럼 상수 — 이하 "IDD 커리큘럼")이 Day 1–30 전체(foundation 1–7 / build 8–17 / launch 18–24 / grow 25–30)를 정의한다 (`sidecar/adaptive-curriculum.mjs:182-213`). 빠진 것은 콘텐츠가 아니라 **배선**이다: Day 2+ 미션이 day-progress 매크로 루프·증거 시스템·Office Hours와 연결되지 않았다.
2. **Day 축이 3개 공존하며 봉합되지 않았다.** ① day-progress 매크로 루프(`sidecar/day-progress-state.mjs`) ② IDD 커리큘럼(`sidecar/adaptive-curriculum.mjs`) ③ Foundation Day 0–7(`sidecar/foundation-chat.mjs`, `FOUNDATION_MAX_DAY_INDEX=7`). index.mjs에서 foundation_chat 경로는 day-progress/office-hours-memory를 읽거나 쓰지 않는다 (관찰: `sidecar/index.mjs` foundation_chat 핸들러 군).
3. **signal은 이미 풍부하게 수집되지만 커리큘럼을 바꾸지 못한다.** rushing 감지(`prior-day-execution-signals.mjs:60-67`), build-without-customer-evidence(`daily-office-hours-digest.mjs:913`), abandoned-thread 탐지(`office-hours-memory.mjs:477-489`), pace 분류(`review-day-summary.mjs:323-387`)가 모두 계산되지만 표시용이다. `personalizeDay()`는 BIP(Build in Public — 공개 빌드 기록) 행·문서 텍스트에서 파생한 자체 신호(interviewCount·hasRevenueSignal 등, `deriveCurriculumSignals` `adaptive-curriculum.mjs:2773`)로 태스크 일부를 치환하지만(`:2924-2990`), 위 4종 실행 신호(rushing·buildWithoutCustomerEvidence·abandoned-thread·pace)는 deriveCurriculumSignals의 입력에 포함되지 않아 커리큘럼 콘텐츠를 바꾸지 못한다.
4. **증거 시스템에 trust 계층이 없고 검증 상태가 영속되지 않는다.** action 증거 판정(LLM judge)·자동검증(MCP/CLI/browser/GDocs/GSheets)은 있으나 결과가 in-memory다 (`action-day-verification-state.mjs:1-7`).

이 스펙의 설계 골자: **(a)** proof-ledger를 단일 증거 원장으로 승격하고 trust-tier를 도입, **(b)** 7개 milestone gate(하드블록)를 가진 Evidence Gate Engine 신설, **(c)** 기존 signal을 20개 adaptive rule로 배선, **(d)** Office Hours를 시스템 선제 트리거 intervention으로 전환, **(e)** 사용자 제품의 PostHog 계측을 Day 14 의무 gate로 강제하여 활성 사용자 100명을 자동 집계, **(f)** Day 14까지 유료 ask 1회 발송을 하드 gate로 설정. MVP는 §24, 구현 순서는 §26.

---

## 2. Product Frame

| 항목 | 내용 | 근거 |
|---|---|---|
| 목적 | 전업 1인 개발자가 30일 안에 활성 사용자 100명·첫 매출 가능성을 **외부 증거로** 검증 | `docs/SPEC.md`(North Star), `docs/GOAL.md` |
| 핵심 사용자 | 첫 매출 전, macOS, 에이전트 코딩 도구 사용, 프로젝트 path·기록 제공 의향 | `docs/ICP.md` |
| 30일 program의 목표 | "공부 완료"가 아니라 Day 30에 **continue/pivot/stop을 증거로 결정** | `adaptive-curriculum.mjs:212` (Day 30 Final Decision), `:251` (antiValidation: "Day 30 decision has no real-user evidence or explicit ask outcome") |
| 제품 원칙 | 교육 콘텐츠가 아니라 **시장 증거 기반 실행 압박 시스템**. 자기보고보다 외부 증거. Git activity ≠ market validation. 고객 접촉 회피·허위 진행·제품 개발 도피는 risk로 감지·교정 | `docs/SOUL.md`, `docs/VALUES.md` §2·§3, `daily-office-hours-digest.mjs:913` (buildWithoutCustomerEvidence가 이미 이 원칙을 코드화) |
| 운영 모델 | October Academy Q2: 유료 코호트(월 19.9만), founder touch ≤ 주 1.5h/고객, mentor = October 1인 | `docs/october-academy/wiki/2026-Q2.md` |
| 설계 tie-breaker | simple > smart, 작은 usability 개선 > 큰 신기능, additive·non-breaking·로컬 기본값 | `docs/PHILOSOPHY.md` |

Adaptive rule은 처벌 장치가 아니다. 목적은 **다음 행동 추천의 정확도**다. 단, 고객 접촉 회피·허위 진행·제품 개발 도피 3종은 명시적으로 교정한다 (§12).

---

## 3. Definitions: Active User 100 and First Revenue

### 3.1 활성 사용자 100명 (Decision D1, §29)

- **정의:** 사용자의 제품에서 **핵심 활성 행동(core activation action)을 1회 이상 완료한 고유 사용자 100명.** 정의 문장은 이미 코드에 고정되어 있다: "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다" (`sidecar/day-progress-state.mjs:312`, `day1-goal-state.mjs`의 `get_users` goal text).
- **핵심 활성 행동의 지정:** Day 14(Measurement day)에 사용자가 `first_value` 이벤트로 직접 정의한다 (`adaptive-curriculum.mjs:196`, Day 14 "first_value 이벤트 정의" — 이미 저작됨).
- **측정 기준 (high-trust 유일 경로):** 사용자 제품에 연동된 **PostHog HogQL 자동 집계**만 활성 사용자 수로 인정한다. 집계 인프라는 이미 존재한다: `morning-briefing-direct-sources.mjs:119-177`이 HogQL로 active user·Day-1 retention cohort를 수집한다. 신규 작업은 "first_value 이벤트 기준 고유 사용자 누적 카운트" 쿼리 1종과 스냅샷 영속(§15.4)뿐이다.
- **명시적 비인정:** 방문자 수, 가입자 수, 스크린샷 제출 수치, self-report 수치. (각각 acquisition signal로는 기록하되 100명 카운트에 불산입.)

### 3.2 첫 매출 (Decision D2, §29)

- **인정:** ① 결제 provider 기록 또는 입금 내역 캡처가 있는 **결제 완료** ② **예약판매(pre-sale) 선입금**. 금액 하한 없음.
- **불인정 (revenue signal로만 분류):** 가격이 합의된 구두/DM 약속, 유료 의향 표명, waitlist 등록, 무료 가입.
- **proof-ledger 매핑:** 신규 이벤트 타입 `paymentRecord`(§15.2)로 기록. 기존 `paymentIntent` 타입(`execution-os.mjs:17-29`)은 의향/시도 단계에 사용.
- **증거 형식:** 입금/결제 화면 캡처 또는 provider 대시보드 URL + 발송·수신 시각. LLM judge(`action-evidence-judge.mjs`)가 sufficiency 판정(§9).

---

## 4. Current-State Analysis

> 이 절의 모든 주장은 2026-06-12 코드 관찰에 근거한다. 미구현·미배선은 명시적으로 구분한다.

### 4.1 Day 축 3개의 현황

| 축 | 모듈 | 내용 | 상태 |
|---|---|---|---|
| 매크로 루프 | `sidecar/day-progress-state.mjs` | Day1=4스텝(onboarding/scan/goal/first_interview), Day2+=5스텝(scan/retro/goal/interview/execution). Day 번호 = `challengeStartedAt`(로컬 YYYY-MM-DD) 경과일+1 (`:193-200`). 단조 전진(`:127-166`), MAX_DAY=400(`:20`). 저장: `<workspace>/.agentic30/day-progress.json` | **배선됨** — 사이드바·메인 스테퍼가 이 모듈만 읽음 (`day-progress-state.mjs:7-9` 주석) |
| IDD 커리큘럼 | `sidecar/adaptive-curriculum.mjs` | DAY_COUNT=30(`:8`), 4 day-type(interview/action/review/education, `:30-35`), review day 7/14/21/28(`:36`), 주차별 day-type 분포(`:50-159`), 30일 미션 전문 저작(`:182-213`), 진행 게이트·졸업 상태·carry-over·weekly summary stack | **모듈 완성, Day 2+ 미션이 매크로 루프와 미연결** |
| Foundation | `sidecar/foundation-chat.mjs` | Day 0–7 value contract(`foundation-contracts.mjs:22-101`), Day 6 monetization-ask, Day 7 foundation-summary(read-only 도구 allowlist) | **배선됨, 단 day-progress/office-hours-memory와 상호 미참조** (관찰: index.mjs foundation_chat 핸들러는 두 store를 읽지 않음) |

### 4.2 진행 게이트의 현황

- `execution-os.mjs:569-617`(buildProofPrerequisiteRequirements): Day 2–7 진입은 Day 1부터 직전 Day까지 **각 Day의** proof-ledger 증거 이벤트(setup/mission 제외 전 타입, `:848-850`)가 `accepted|verified`여야 통과. Day 8+은 추가로 Day 7의 `dayDecision`(continue/pivot/stop/restart, `:819-825`) 필요. 평가·차단 판정 자체는 generic requirement evaluator인 `curriculum-progression-gate.mjs:41-114`가 수행.
- Day 1 `first_interview`는 **커밋먼트 텍스트 gate**: `classifyInterviewGate`가 structuredCommitment 또는 confession 없으면 `mode='block'` (`sidecar/index.mjs:3240-3266`, 텔레메트리 `mac_sidecar_interview_gate_blocked` `:3262`).
- Action day는 **비차단**: coach mark가 "미완료여도 다음 Day 진행은 막지 않습니다"라고 명시 (`adaptive-curriculum.mjs:1072-1087`), 미완료는 carry-over→mini-action 세션 (`mini-action-session-context.mjs:97-276`).
- **gate 결과·검증 결과는 영속되지 않는다**: `action-day-verification-state.mjs:1-7`은 "Pure state module: no filesystem IO" — 앱 재시작 시 judge 판정·자동검증 이력 소실.

### 4.3 증거 시스템의 현황

- 제출 타입: link(URL)·file 2종뿐 (`action-day-evidence-submission.mjs:21-24`). 스크린샷 업로드 UI는 Swift에 없음 (관찰: IntakeV2·Office Hours 모두 선택지+freeText만, `agentic30/IntakeV2Store.swift:399-407`).
- 자동검증 6종: mcp/cli/browser/googleDocs/googleSheets + evidence fallback (`action-day-auto-verification.mjs:17-23`). 증거 제출은 자동검증 소진 후에만 열림 (`action-day-evidence-submission.mjs:442-482`).
- LLM judge: 판정 accepted/insufficient/error, confidence 0–1 단일 점수, **trust-tier 구분 없음** (`action-evidence-judge.mjs:10-14`, `:234`).
- proof-ledger: 11개 이벤트 타입(setup/mission/interview/bip/workLog/dmAsk/landingMetric/paymentIntent/actionEvidence/dayDecision/referral), status 9종(draft·submitted·accepted·verified·rejected·insufficient·blocked·complete·completed, `execution-os.mjs:31-42`), **strength weak/medium/strong 필드가 이미 존재** (`execution-os.mjs:17-29`, `:138-184`). 저장: `.agentic30/proof-ledger.json`.
- 커밋먼트 hard-evidence 등급: url/screenshot/commit/payment 4종만 인정, met 판정 후 다운그레이드 불가 (`office-hours-memory.mjs:35-44`, `:135-162`).

### 4.4 Office Hours의 현황

- 시작: 사용자 수동 또는 Mac 앱의 자동 시작 경로(mac_auto_start) (`sidecar/index.mjs:1292-1310`, `/office-hours` slash `:3396-3399`). **시스템 선제 트리거 없음.**
- Day 2+는 source gate(git/gh/PostHog/Cloudflare 가용성) 통과 필요 (`daily-office-hours-digest.mjs:310-431`).
- 메모리 schema v3: compiledTruth(≤2000자)+timeline(≤200)+cycles(≤90)+commitments(≤60)+predictions(≤60) (`office-hours-memory.mjs:19-27`). 저장: `.agentic30/memory/office-hours-ledger.json`.
- 커밋먼트는 **user-origin만** 허용(`assertUserOrigin`, `:72-124`), carry-forward·dedup(`:167-251`), abandoned-thread 탐지(2사이클 무증거, `:31-33`, `:477-489`), calibration-lite 예측(`:339-434`).
- 일일 digest: git/gh/PostHog/Cloudflare 4소스, `buildWithoutCustomerEvidence` 플래그(커밋은 있는데 PostHog 신호 0) (`daily-office-hours-digest.mjs:813-933`).
- resume: day-scoped turn log에서 Q/A 복원, terminal turn, 과거 Day read-only 스냅샷 (`office-hours-resume.mjs:55-89`).

### 4.5 Adaptive signal의 현황 (계산됨, 미배선)

| Signal | 계산 위치 | 현재 소비처 |
|---|---|---|
| rushing(completedDaysPerElapsedDay>elapsed+1 등) | `prior-day-execution-signals.mjs:60-67` | risk_factors 표시만 |
| pace 분류(rusher/steady, 실경과≤75% 기준) | `review-day-summary.mjs:323-387` | review day 코칭 톤만 |
| buildWithoutCustomerEvidence | `daily-office-hours-digest.mjs:913` | 인터뷰 첫 질문 챌린지만 |
| abandoned threads | `office-hours-memory.mjs:477-489` | 인터뷰 preamble 경고만 |
| consecutive deferrals | `office-hours-memory.mjs:543-551` | 표시만 |
| adaptiveDifficultyState | rushing/low-quality 감지 시 adaptive-curriculum이 생성(`adaptive-curriculum.mjs:1768-1780`, `:1845-1862`)·컨텍스트 포함(`:1471`) | mini-action learner-state가 소비(`mini-action-session-context.mjs:2245-2300`)하나 **영속 기록 없음**(review-day는 normalize만, `review-day-curriculum-signals.mjs:827-851`) |
| morning briefing anomaly(>25% drop 등) | `morning-briefing.mjs:388-427` | 사용자 라벨링만 |
| evidence OS day states(evidence_confirmed/build_escape/closed_unproven 등) | `office-hours-memory.mjs:839-876` | UI 파생 표시만, 미영속 |

### 4.6 구현상 제약 요약

1. review day가 7/14/21/28 하드코딩 (`review-day-summary.mjs:20-21`) — 일시정지/지연 로직 없음.
2. morning briefing과 review day는 독립 시스템 — 신호 병합 전략 부재 (관찰: 두 모듈 간 상호 import 없음).
3. telemetry 이벤트 대부분에 day 컨텍스트 없음 (`execution-os` 계열만 current_day 포함) — `telemetry.mjs:374-395` baseProperties가 단일 주입점.
4. workspace-memory·bip-coach-state 일부는 non-atomic `fs.writeFile` (`atomic-store.mjs` 미사용 경로 존재, `bip-coach-state.mjs:45-57`).
5. Exa MCP 부재 시 market radar 전면 실패(state='failed', `news-market-radar.mjs`) — 폴백 없음.
6. 활성유저·매출 추적 부재는 `docs/known-limitations.md`에도 명시됨.

---

## 5. Current User Flows

1. **First-run:** IntakeV2 8단계(bootIntro→role→stuck→commitment→evidence→folderPick→connectShowcase→readyAnalyze, `agentic30/IntakeV2FlowView.swift:483-498`) → workspace scan → Foundation Setup(ICP/GOAL/VALUES/SPEC 4문서) → Day 1 Mission 카드 (README.md "First success").
2. **Day 1:** onboarding→scan→goal(Day1 goal 선택: make_money/get_users/build_product, `day1-goal-state.mjs`)→first_interview(커밋먼트 gate). 상황 요약 카드(schema v3, `generate-day1-situation-summary.mjs`)와 ICP plan(`generate-day1-icp-plan.mjs`)이 scan 산출.
3. **Day 2+ (부분 구현):** morning briefing(탭 진입 시 날짜 stale이면 재수집 — 정책은 `sidecar/index.mjs:2126-2176`의 morning_briefing_get 핸들러) → office hours(수동 시작, source gate, 일일 digest 주입) → 커밋먼트 제안/확정 → 증거 제출(office_hours_commitment_evidence). execution 스텝의 미션 콘텐츠는 IDD 커리큘럼과 미연결.
4. **Foundation Day 0–7:** value contract 채팅 → Day 6 monetization-ask(이름+가격+받을 약속+기한, yes/no/no-reply) → Day 7 foundation-summary(go-no-go.md).
5. **Review day(7/14/21/28):** 지난 구간 신호 수집→대시보드+next-step actions (`review-day-*.mjs`). 다음 주 커리큘럼에 피드백 없음.

---

## 6. Current Data and Event Model

### 6.1 영속 스토어 (관찰된 전체 목록)

| 스토어 | 경로 | 스키마 | 비고 |
|---|---|---|---|
| day-progress | `<ws>/.agentic30/day-progress.json` | v1 `agentic30.day_progress.v1` | challengeStartedAt + days{} |
| proof-ledger | `<ws>/.agentic30/proof-ledger.json` | v1 | 11 타입·status·strength |
| curriculum progress | adaptive-curriculum이 로드/영속 (atomic) | v1 | dayRecords·carryOverQueue·weeklySummaryStack·graduationState·coachMarkRegistry·notificationConfig |
| office-hours ledger | `<ws>/.agentic30/memory/office-hours-ledger.json` | v3 | compiledTruth/timeline/cycles/commitments/predictions |
| office-hours turns | `<ws>/.agentic30/memory/office-hours-turns.json` | v2 | 턴 로그, 같은 날 revision 시 후행 턴 삭제 (`workspace-memory.mjs:590-620`) |
| day memory / rollup | `<ws>/.agentic30/memory/days/day-N.json`, `day-rollup.json` | v1 | 일별 스냅샷·누적 카운트 |
| curriculum answers | `<ws>/.agentic30/curriculum-answers.json` | v1 | 30일 보존·일일 prune (`news-market-radar.mjs`) |
| day1 goal | `<ws>/.agentic30/day1-goal.json` | v1 | goalType/goalText/customer/problem/validationAction/evidenceRefs |
| work history | `<ws>/.agentic30/work-history.json` | v2 | AI 세션 wall-clock·커밋·영역 분류 (~/.claude·~/.codex read-only 소스) |
| morning briefing | `<ws>/.agentic30/morning-briefing.json` | v2 | current/previous/history |
| onboarding memory | `<ws>/.agentic30/memory/onboarding.json` | v1 | 4문항 답변 |
| source read log | `<ws>/.agentic30/memory/source-read-log.json` | v1 | ≤200 append-only |
| market/bip radar | `<ws>/.agentic30/news/`, `<ws>/.agentic30/bip/research/day-N-cache.json` | v1 | Exa 기반 |
| foundation evidence | `<ws>/.agentic30/foundation/evidence/<session>/<msg>.json` | v1 | per-message 증거 sidecar |
| bip-coach state | `<appSupport>/bip-coach-state.json` | v1 | streak·mission·ritual |
| MCP OAuth state | `<appSupport>/mcp-oauth-state.json` | v2 | server×provider 검증 레코드 |
| session store | `~/.claude/projects/...` / `~/.codex/sessions/...` | v1 | 부팅 시 running→idle 정규화 (`session-store.mjs:26-56`) |

### 6.2 핵심 이벤트 (PostHog, 발췌)

전체 120+ 중 본 스펙과 직결되는 것: `mac_sidecar_day_progress_updated`(day/step_id/status/gate_mode, `index.mjs:3313`), `mac_sidecar_interview_gate_blocked`(`:3262`), `mac_sidecar_office_hours_started/completed/commitment_*`, `mac_sidecar_execution_os_first_evidence_submitted / day7_decision_completed / money_time_ask_sent / referral_signal / readiness_checked`(`execution-os.mjs:542-567`), `mac_sidecar_monetization_ask_evaluated`, `mac_sidecar_foundation_summary_evaluated`, `installer_downloaded`(`scripts/posthog-release-funnel.mjs:20`). 속성은 전부 sanitize(이메일→도메인, 경로→basename, 시크릿→[redacted], `telemetry.mjs:118-209`).

---

## 7. Current External Integrations

> 용어: BIP = Build in Public(공개 빌드 기록, `sidecar/bip-coach-state.mjs` 계열).

| 연동 | 방식 | 현재 용도 | 코칭 배선 |
|---|---|---|---|
| PostHog (사용자 제품) | MCP OAuth(provider-scoped) + 선택적 phx_ 키 → HogQL 직접 쿼리 | morning briefing drilldown: active users, Day-1 retention cohort, top events (`morning-briefing-direct-sources.mjs:119-177`) | digest 텍스트 주입만 |
| Cloudflare | MCP OAuth + 선택적 API token → GraphQL Analytics | visits/pageviews/requests by hour, top paths (`:333-486`) | digest 주입만 |
| GitHub | gh CLI 토큰 캐시 (`github-mcp-config.mjs:3-59`) | 커밋/PR/이슈/릴리즈 digest, work-history 커밋 연결 | digest 주입만 |
| Google Workspace | `gws` CLI read-only (`gws-client.mjs`) | Docs/Sheets 읽기·자동검증 소스·BIP 기록 | action 자동검증에 배선됨 |
| Notion | OAuth (`notion-oauth.mjs`) | 문서 접근 | 표면만, 코칭 미배선 |
| Exa | MCP 디스커버리 (`exa-mcp-discovery.mjs`) | market radar 5-lane, BIP research radar(일별 고객 후보) | 캐시 생성만, 코칭 미배선 |
| Meta Ads | `meta-ads.mjs`, `/analyze-ads`(Claude 전용, `index.mjs:3411`) | 광고 분석 명령 | 온디맨드 명령만 |
| Vercel | MCP OAuth (URL-only) | 배포 상태 | 미배선 |
| qmd | `@tobilu/qmd` 메모리 (gws-memory 컬렉션) | GWS 문서 인덱싱 | 보조 |

---

## 8. Signal Inventory

분류 축: **수집 상태**(C=현재 수집 / L=저비용 추가 / H=고비용 추가), **trust**(H/M/L), **역할**(P=progress, R=risk, A=acquisition, V=revenue).

### 8.1 현재 수집 중 (C)

| Signal | 출처(근거) | Trust | 역할 |
|---|---|---|---|
| proof-ledger 이벤트 스트림(인터뷰·dmAsk·paymentIntent·landingMetric·dayDecision 등) | `execution-os.mjs:17-29` | 타입별 상이 | P/V |
| day-progress 스텝 완료·goalText | `day-progress-state.mjs` | H(시스템 기록) | P |
| 커밋먼트(고객·채널·메시지·기대증거·기한) + hard-evidence 등급 | `office-hours-memory.mjs:1021-1046` | H | P/R |
| 커밋먼트 abandoned threads (2사이클 무증거) | `:477-489` | H | **R** |
| consecutive deferrals (blocked/abort 연속) | `:543-551` | H | **R** |
| calibration-lite 예측 적중(N/M) | `:422-434` | M | P |
| buildWithoutCustomerEvidence (커밋O·PostHog 신호0) | `daily-office-hours-digest.mjs:913` | H | **R** |
| rushing 후보(완료속도>경과+1, 미완료 누적≥2) | `prior-day-execution-signals.mjs:60-67` | H | **R** |
| pace 분류(rusher/steady) | `review-day-summary.mjs:323-387` | H | R/P |
| carry-over 큐 부담 | `adaptive-curriculum.mjs` carryOverQueue | H | R |
| 사용자 제품 PostHog: active users·Day-1 retention·top events | `morning-briefing-direct-sources.mjs:119-177` | **H** | **A** |
| Cloudflare traffic(visits/pageviews/paths) | `:333-486` | **H** | **A** |
| Git/gh 활동(커밋·PR·릴리즈) | digest + `work-history.mjs` | M(activity, **not validation**) | P |
| AI 세션 wall-clock·작업영역 분류 | `work-history.mjs`(schema v2) | H | R(개발 도피 비율 분모) |
| 인터뷰 답변 턴 로그·구조화 제출 | `workspace-memory.mjs:104-130` | M | P |
| Day 6 monetization-ask 결과(yes/no/no-reply) | `monetization-ask-integration.mjs` | H | **V** |
| 워크스페이스 문서 증거(ICP/GOAL/SPEC/VALUES 존재·내용) | `review-day-workspace-signals.mjs:6-9` | M | P |
| morning briefing anomaly(>25% drop) + 사용자 라벨 | `morning-briefing.mjs:388-427` | H | R/A |
| BIP research radar 고객 후보 카드 | `bip-research-radar.mjs` | M | A |
| agentic30 자체 telemetry 120+ 이벤트 | §6.2 | H | P(운영) |

### 8.2 저비용 추가 (L) — 기존 인프라 재사용

| Signal | 구현 경로 | Trust | 역할 |
|---|---|---|---|
| **활성 사용자 누적 카운트(first_value 기준)** | HogQL 쿼리 1종 추가 + 스냅샷 영속 (§15.4) | H | **A** |
| **paymentRecord(결제 완료/예약판매 입금)** | proof-ledger 타입 추가 + 증거 judge 재사용 (§15.2) | H | **V** |
| paymentFailure/refund 기록 | 동일 | H | V/R |
| CTA 클릭·waitlist 등록 수 | 사용자 PostHog 이벤트 HogQL (계측 gate 이후) | H | A |
| deploy 상태(URL 응답·browser 자동검증) | `browser-tool-verification.mjs` 재사용 | H | A |
| 인터뷰 녹취/노트 파일 증거 | 기존 file 증거 + judge | M | P |
| 스크린샷 제출 | Swift 파일 picker 추가(§18), sidecar file 타입 기존 지원 | M | P/V |
| Day별 진행속도·중단·재시도·건너뛰기 패턴 | day-progress+curriculum 이벤트 파생 집계 (§15.3) | H | R |
| 개발활동 대비 고객접촉 비율 | work-history 분모 + proof-ledger 고객접촉 분자 | H | **R** |
| 예측 자동 채점(증거 도착 시) | proof-ledger→prediction 매칭 | M | P |
| telemetry day/gate 컨텍스트 | `telemetry.mjs` baseProperties 1개소 수정 | H | 운영 |

### 8.3 고비용 추가 (H) — MVP 제외 후보

| Signal | 비용 요인 | 역할 | 판정 |
|---|---|---|---|
| email 발송/open/click/bounce | ESP 연동 신규 | A | Later (§25) |
| calendar 예약 자동 수집 | 캘린더 API+동의 | P | Later — MVP에서는 예약 캡처를 link/file 증거로 제출 |
| Discord/Slack 커뮤니티 활동 | API+OAuth 신규 | A | Later |
| 결제 provider(Stripe 등) webhook 자동 수집 | 서버 인프라 필요(local-first 위배) | V | Later — MVP는 캡처 증거로 충분 |
| AI 대화 기록 의미 분석(회피 주제 추출) | LLM 비용·privacy | R | Later |

### 8.4 깔때기 단절 상태 signal (조합 파생 — Gate Engine이 계산, §10)

deploy↑·traffic=0 / traffic↑·CTA=0 / CTA↑·signup=0 / signup↑·active=0 / active↑·재방문=0 / 재방문↑·payment intent=0 / intent↑·결제=0 / 인터뷰 반응↑·usage=0. 각각 adaptive rule AR-08~AR-15와 1:1 매핑 (§12).

---

## 9. Evidence Trust Model

proof-ledger의 기존 `strength`(weak/medium/strong) 필드를 trust-tier의 영속 표현으로 재사용한다(스키마 무변경). 분류는 **증거 종류로 1차 결정, LLM judge로 2차 확정**한다.

### 9.1 계층

**High Trust (strength=strong):**
- 사용자 제품 PostHog HogQL 자동 집계 (active users, first_value, CTA, signup)
- Cloudflare traffic 자동 수집
- 결제 완료/예약판매 입금 기록 (paymentRecord 캡처/URL + judge 통과)
- 실제 고객 message 원문 (URL/캡처 + 발신자·시각 식별 가능)
- 배포 URL의 browser 자동검증 통과 (`browser-tool-verification.mjs`)
- 인터뷰 녹취/transcript 파일
- waitlist 등록 기록(서비스 대시보드 캡처/URL), email reply 원문
- calendar 예약 캡처

**Medium Trust (strength=medium):**
- 스크린샷(자동검증 불가 항목), 사용자가 작성한 인터뷰 노트
- Git commit (activity signal — **market validation으로 절대 불산입**, `docs/SOUL.md` 원칙)
- landing page draft, demo video, community post

**Low Trust (strength=weak):**
- self-report 텍스트("했습니다"), 검증 불가 계획, 고객 없는 아이디어 설명, AI 생성 문서만 있는 상태

### 9.2 판정 파이프라인

```
증거 제출(link|file|screenshot)
  → 자동검증 우선 (기존 순서: mcp→cli→browser→google_docs→google_sheets,
     adaptive-curriculum.mjs:1079 preferredVerificationOrder)
  → 통과: strength=strong, status=verified
  → 자동검증 불가/실패: LLM judge (action-evidence-judge.mjs)
       judge accepted + 증거종류∈High 목록 → strong/accepted
       judge accepted + 증거종류∈Medium    → medium/accepted
       judge insufficient                  → weak/insufficient (재제출 유도)
  → 결과를 proof-ledger actionEvidence 이벤트로 영속 (§15.1) ← 신규(현재 in-memory)
```

### 9.3 원칙 (Gate 연동)

1. milestone gate(§10)는 strong 증거 없이는 통과 불가 (Decision D3).
2. weak-only 진행이 2 Day 연속이면 risk signal로 Office Hours(이하 OH) intervention 후보 (§12 AR-17).
3. 커밋먼트 hard-evidence 4종(url/screenshot/commit/payment, `office-hours-memory.mjs:44`)은 유지하되, 커밋먼트에 `audience: customer|internal` 분류를 도입해 **audience=customer면 commit kind를 불인정**(url/screenshot/payment만)한다. 분류기는 commitment-suggest의 기존 비고객 행동 거부 규칙(`office-hours-commitment-suggest.mjs:66-108`)을 재사용하고, 미분류는 customer로 기본 처리한다(fail-closed). milestone gate 해제·OH post-session 증거는 audience=customer 커밋먼트만 인정한다 (§15.5).
4. 증거 시각·발신 식별이 없는 캡처는 judge가 insufficient 처리하도록 sufficiency criteria에 명시 (October 본인 운영 원칙과 동일: 캡처+발송 시각).

**주 (provenance vs trust):** 시스템 기록(day1-goal 저장, dayDecision 등 사용자가 직접 입력해 시스템이 영속한 결정)은 `provenance=system`으로 표기하되 **시장 증거 trust-tier에는 불산입**한다. gate 조건에서 이들은 "결정/입력의 존재" 요건이며, strong 시장 증거 요건과 별개 항목으로 명시한다.

---

## 10. Progress Gates

### 10.1 Gate Engine (신규 모듈 `sidecar/program-gate-engine.mjs` 제안)

- 입력: proof-ledger, office-hours-ledger(커밋먼트), curriculum progress(dayRecords), day-progress, active-user 스냅샷(§15.4).
- 출력: `gateStatus = { gateId, state: locked|open|passed|waived, blockedReason, requiredEvidence[], evaluatedAt }` — `.agentic30/gate-ledger.json`(schema v1, §15.3)에 영속.
- 평가 시점: day_progress_patch 처리 직전(권위 게이트 위치는 현행 `index.mjs` day_progress_patch 핸들러 유지), office hours 시작 시, review day 진입 시.
- 기존 proof 전제조건 체계(`execution-os.mjs:569-617`의 요구사항 생성 + `curriculum-progression-gate.mjs:41-114`의 평가)는 Day 2–7 proof gate로 그대로 사용하고, Gate Engine이 이를 포함(위임)한다 — 비파괴 확장.

### 10.2 Milestone gates (하드블록 + OH 회부, Decision D3·D5)

| Gate | 시점 | 통과 조건 (모두 strong 증거) | 실패 시 |
|---|---|---|---|
| G1 첫 고객 접촉 | Day 1 | 기존 first_interview gate 유지: 커밋먼트 or confession (`index.mjs:3240-3266`) — **추가:** Day 4 진입 시점(day_progress_patch 처리 직전)에 G1을 재평가하여 인터뷰 strong 증거 부재 시 state=blocked로 전환, Day 4 goal 스텝 진입을 차단. 해제: 인터뷰 strong 증거 제출 또는 confession→축약형 intervention(§13.3a) | confession 경로 + AR-02 |
| G2 Foundation Go/No-Go | Day 7 review | foundation_closure=closed (`execution-os.mjs:621-670`) + 인터뷰 증거 ≥1(strong) + dayDecision 기록 | Day 8 잠금, OH 자동 회부 |
| G3 첫 ask | Day 7 | Day 6 monetization-ask 발송 증거(캡처+시각) — 기존 moneyOrTimeAskSent 지표를 strong 요건으로 승격 | 경고 후 G4에 합산 |
| **G4 유료 ask + 계측** | **Day 14 review** | ① 가격·받을 약속·기한 포함 유료 ask 발송 증거 ≥1 (paymentIntent, strong) ② 사용자 제품에 PostHog `first_value` 이벤트 수신 확인(HogQL 1행 이상) | **Day 15+ 잠금**, OH 자동 회부 (Decision D1·D5) |
| G5 첫 외부 유입 | Day 21 review | traffic 증거(Cloudflare/PostHog 자동) ≥1 + active user ≥1 (자동 집계) | Day 22+ 잠금, OH 회부 + pivot 후보 플래그 |
| G6 revenue 검증 상태 | Day 28 review | paymentRecord ≥1 **또는** (paymentIntent ≥3 + 명시적 거절 기록) — "지불 행동 또는 명시적 가격 거절의 증명" (`adaptive-curriculum.mjs:209` Day 27 원문) | Day 29 진입 허용. Day 30에서 continue 선택은 가능하되 rubric `no_evidence_reason` 입력 필수 + dayDecision에 `unvalidated_continue=true` 기록(숨김·비활성 금지 — 근거 요구 방식, §12 AR-15). 이 플래그는 G7 평가와 graduationState에 표기 |
| G7 Final Decision | Day 30 | continue/pivot/stop + 근거 증거 참조 ≥3 (anti-validation: 실사용자 증거·ask 결과 없이는 결정 불인정, `:251`) | graduation 보류, OH 회부 |

### 10.3 일반 Day gate (비차단 유지)

- action day: 현행 carry-over 비차단 유지 (`adaptive-curriculum.mjs:1085-1087`). 단 carry-over ≥3이면 AR-18 발동(감속).
- interview day: 현행 block-once-then-confession을 Day 2+ interview 스텝에도 동일 적용 (현재 GATED_INTERVIEW_STEPS=['interview','first_interview'], `office-hours-memory.mjs:594` — 이미 양쪽 지원).
- education/review day: 증거 요구 없음(워크시트 완료·결정 기록만).

---

## 11. Day 1-30 Adaptive Program

### 11.0 공통 Day 계약 (모든 Day에 적용되는 기본값)

- **콘텐츠 소스:** `IDD_BASE_CURRICULUM`의 해당 day 항목(제목·요약·tasks·output, `adaptive-curriculum.mjs:183-212`). day-type과 주차 분포는 `:50-159`.
- **매크로 루프:** Day1=onboarding/scan/goal/first_interview, Day2+=scan/retro/goal/interview/execution (`day-progress-state.mjs:15-16`). **신규 배선:** execution 스텝 진입 시 IDD 해당 day의 mission이 미션 카드로 로드된다(§17.2).
- **UI state:** day-type별 컴포넌트 — interview_card_conversation / action_auto_verify_evidence / review_agent_summary_dashboard / education_interactive_worksheet (coach mark layout과 동일, `adaptive-curriculum.mjs:1064-1156`).
- **data model:** curriculum dayRecords[day] + day-progress days[day] + proof-ledger 이벤트 + gate-ledger(신규) + day memory.
- **events:** `mac_sidecar_day_progress_updated`, `mac_sidecar_curriculum_answer_saved`, `submit_action_evidence`, (신규) `mac_sidecar_gate_evaluated`, (신규) `mac_sidecar_adaptive_rule_fired` — 모든 이벤트에 day/day_type/gate 컨텍스트 자동 부착(§16.1).
- **coaching 톤:** YC 파트너/시니어 메이커, 근거·반증·다음 검증 행동 (`docs/SOUL.md`).
- **핵심 질문 기본:** IDD 해당 day의 mission을 의문문으로 변환한 1문장. per-day에 명시된 경우 그것이 우선한다.
- **success/failure 기본:** success = 해당 Day의 evidence 항목이 명시된 trust tier 이상으로 `accepted|verified` 기록됨. failure = Day 종료 시 증거 미제출 또는 judge insufficient — action day는 carry-over(§10.3), interview day는 block-once-then-confession, 해당 조건 충족 시 §12 AR 동시 발동.
- **OH trigger 기본:** §13.1 trigger registry가 모든 Day에 적용된다(milestone gate 실패=즉시, 발동된 AR의 OH 열 조건=해당 등급, 수동 `/office-hours`=항시). per-day 항목은 day-고유 추가 트리거만 기술한다.
- **adaptive 기본:** 각 Day 종료 시 Gate Engine 평가→다음 Day 추천(§12 라우팅). 아래 per-day 항목은 **이 기본값과의 차이**와 day-고유 필드만 기술한다.

### Week 1 — Foundation (고객·문제·수요 증거)

**Day 1 · interview · Alignment** — 목표와 고객 핵심 가설
- 핵심 질문: "누구의 어떤 통증을, 어떤 결과로 바꾸려 하는가?"
- mission: 목표 한 문장 + ICP/Pain/Outcome 3문장 (`adaptive-curriculum.mjs:183`). Day1 goal 선택(make_money/get_users/build_product, `day1-goal-state.mjs`).
- evidence: day1-goal.json 저장(provenance=system, trust-tier 불산입 — §9 주) + first_interview 커밋먼트(고객·채널·메시지·기대증거·기한).
- success: 커밋먼트 confirmedByUser=true. failure: confession 2회 연속.
- gate: **G1**. adaptive: 커밋먼트가 비고객 행동(인프라/리서치)이면 commitment-suggest가 거부 (`office-hours-commitment-suggest.mjs:66-108` 기존 규칙).
- OH trigger: confession 시 즉시 mini-intervention — §13 계약의 축약형(§13.3a)으로 실행: ① context package 주입 ② 종료 조건 동일(구조화 커밋먼트 1개, user-origin) ③ cycles outcome + gate-ledger.adaptiveEvents 기록 ④ post-session evidence는 커밋먼트 dueDay 규칙 적용.
- coaching: "오늘 카드가 네 실제 행동을 바꿨나? 커밋한 1명에게 오늘 보내라."

**Day 2 · action · Market** — 돈이 흐르는 기준 시장
- 핵심 질문: "이 통증에 이미 돈을 내는 시장이 있는가?"
- mission: 유료 앱·광고 앱 5개의 가격·리뷰·광고 흔적 기록 (`:184`).
- evidence: day-2-evidence-log.md(file, medium) + 출처 URL ≥3(link). market radar 카드 활용 가능 (`news-market-radar.mjs`).
- success: 지불 행동 근거 5건. failure: 카테고리만 나열·가격 정보 0.
- gate: Day 2–7 proof gate(Day별 누적 증거 accepted/verified 필요, `execution-os.mjs:569-617`). adaptive: 증거 0이면 mini-action으로 시장 1개 좁히기 재시도.

**Day 3 · interview · Mom Test** — 인터뷰 질문 설계
- 핵심 질문: "미래 의향이 아니라 과거 행동을 묻고 있는가?"
- mission: 과거 행동 질문 3+, 미래 의향 제거, 대상 1명 확정 (`:185`).
- evidence: day-3-interview-script.md(file, medium) + **G1 retro-check:** Day 1 커밋먼트의 인터뷰 증거(strong) 도착 여부.
- success: script + 인터뷰 1건 증거. failure: script만 있고 접촉 0 → AR-02.
- OH trigger: 인터뷰 증거 0 + 커밋먼트 1사이클 무증거 → 선제 OH(AR-02).

**Day 4 · education · 10x Wedge**
- mission: 경쟁 흐름 1개 대비 10배 wedge 선택, SPEC 약한 섹션 재작성 (`:186`).
- evidence: 워크시트 필수 칸 완료(시스템 기록) + SPEC diff(file, medium). 비차단.
- adaptive: 워크시트 결과가 다음 action day의 실행 기준으로 주입 (`:1124` 기존 설계).

**Day 5 · interview · Demand Signal**
- 핵심 질문: "허수와 진짜 수요를 숫자로 분리했는가?"
- mission: impressions/clicks/signups/replies 중 보유 숫자 정리, 돈 낼 후보 1명 선택 (`:187`).
- evidence: day-5-demand-signal.md + 숫자 출처 URL/캡처(medium 이상 1건).
- failure: "흥미롭다" 반응만 수집(ICP.md Warning 패턴) → AR-03.

**Day 6 · interview · Ask** — 돈/시간 ask 실행
- 핵심 질문: "가격·받을 약속·기한이 있는 ask를 특정 1명에게 보냈는가?"
- mission: monetization-ask 4턴 플로우(target→draft→sent→response — 턴 정의는 `monetization-ask-prompt.mjs:41-170` MONETIZATION_ASK_TURNS, 상태 초기화는 `monetization-ask-state.mjs:55-69`).
- evidence: **발송 캡처+발송 시각(strong)** + yes/no/no-reply 원문. paymentIntent 이벤트 기록.
- success: 발송 증거 + 응답 분류. failure: draft까지만 → G3 경고.
- gate: **G3**(경고형). OH trigger: 발송 공포 confession 시 ask 문장 공동 작성 intervention.
- coaching: "칭찬은 증거가 아니다. yes/no/no-reply만이 데이터다."

**Day 7 · review · Go/No-Go** — **G2 milestone**
- 핵심 질문: "7일 증거로 계속/재시작/피벗 중 무엇을 고르는가?"
- mission: 인터뷰/일지/BIP 수량 집계, 최강 증거·반증 작성, dayDecision 기록 (`:189`).
- evidence: foundation-summary 산출(go-no-go.md) + dayDecision(continue/pivot/stop/restart, provenance=system — §9 주).
- gate: **G2 하드블록** — foundation_closure=closed + 인터뷰 strong ≥1 + dayDecision. 실패 시 Day 8 잠금+OH 회부.
- adaptive: pivot 선택 시 Week 2를 build가 아니라 Day 1–3 재실행 변형으로 재구성(§12 AR-20).
- data: weeklySummaryStack finalize (`adaptive-curriculum.mjs:646-696`).

### Week 2 — Build (최소 표면 + 계측 + 유료 ask)

**Day 8 · interview · Core Action** — MVP를 핵심 행동 1개로
- 핵심 질문: "사용자가 30초 안에 보는 첫 가치는 무엇인가?"
- mission: 핵심 행동 1개+성공 화면 정의, 확장 deferred 표시 (`:190`).
- evidence: core action spec(file, medium) + 인터뷰 1건(이번 주 인터뷰 쿼터 시작 — W2 분포 interview 40%, `:83-94`).
- gate: Day 8 진입 자체가 G2 통과를 전제 (`execution-os.mjs:819-825`의 Day 8+ dayDecision 규칙).

**Day 9 · action · Input Flow**
- mission: 입력→처리→출력 30초 흐름 (`:191`). evidence: 데모 영상 or 흐름 캡처(medium), browser 자동검증 가능 시 strong.
- adaptive: 실패/빈 입력 폴백 미작성이면 carry-over로 표시하되 비차단.

**Day 10 · education · 10x Result**
- mission: 10배 기준 1개 선택, 핵심 결과 화면에만 품질 투자 (`:192`). 워크시트 완료(비차단).
- adaptive: AR-01(고객 접촉 0 감지)이 이 시점에 자주 발동 — 교육일이어도 인터뷰 커밋먼트 유지 요구.

**Day 11 · interview · No Login**
- 핵심 질문: "검증 전 로그인이 이탈을 만들고 있지 않은가?"
- mission: 첫 가치까지 클릭 수 측정, 로그인 없는 경로 확인 (`:193`).
- evidence: 클릭 수 기록 + 인터뷰/관찰 1건(고객에게 직접 보여준 증거 우선).

**Day 12 · action · E2E Dogfood**
- mission: 실제 입력으로 핵심 기능 1개 end-to-end (`:194`).
- evidence: dogfood E2E log(file) + 실행 결과 캡처. 자동검증: cli/browser.

**Day 13 · interview · Promise**
- mission: 스토어/랜딩 약속 한 문장 (`:195`). evidence: promise draft + 고객 1명에게 보여준 반응 원문(strong이면 가산).
- OH trigger: 13일째 인터뷰 누적 < 3건이면 AR-02 강제 발동.

**Day 14 · review · Measurement — G4 milestone (이 스펙의 중심 gate)**
- 핵심 질문: "① 가격 있는 유료 ask를 보냈는가? ② first_value가 측정되고 있는가?"
- mission: first_value 이벤트 정의·계측 삽입·activation baseline 기록 (`:196`) + 유료 ask 1회 발송(미완 시).
- evidence: ① paymentIntent strong(발송 캡처+시각) ② HogQL로 first_value ≥1행 수신 확인(자동, strong).
- gate: **G4 하드블록** — 둘 다 충족해야 Day 15+ 해제. 실패 시 OH 자동 회부(Decision D5).
- UI state: review 대시보드 + 계측 체크리스트 + "ask 보내기" 직행 버튼.
- events: (신규) `mac_sidecar_active_user_snapshot`(첫 기록), `mac_sidecar_gate_evaluated{gate:G4}`.
- coaching: "결제를 나중 문제로 미루는 것이 가장 비싼 미룸이다. 오늘 보낸 ask 1통이 Week 3의 방향을 정한다."

### Week 3 — Launch (공개·유입·관찰)

**Day 15 · interview · Revenue Dry Run**
- mission: 광고/구독/일회성 중 실험 모델 1개, 페이월 mock 경로 확인 (`:197`).
- evidence: dry-run note + 결제 경로 캡처. "waitlist·무료 가입은 proof 아님" 명시(원문 그대로).

**Day 16 · education · Release Gate**
- mission: 출시 체크리스트(계정·정산·세금) (`:198`). 워크시트 완료, 비차단.

**Day 17 · interview · Build Retro**
- 핵심 질문: "첫 가치 경험과 유료 ask 가능 여부 기준으로 무엇을 남기는가?"
- mission: 7일 사용 로그 확인, 삭제/유지 결정 (`:199`). evidence: build decision memo + active user 스냅샷 자동 첨부.

**Day 18 · interview · Story**
- mission: 반복 인용 3개로 launch hook 3개 (`:200`). evidence: hook 초안 + 인용 출처(인터뷰 턴 로그 참조).

**Day 19 · action · Public Proof**
- mission: 핵심 결과 장면 공개(Threads/BIP) (`:201`).
- evidence: 게시 URL(link, browser 자동검증 → strong). proof-ledger bip 이벤트.

**Day 20 · action · Outreach**
- mission: 후보 20명, 개인화 DM 10개, 응답 기록 (`:202`).
- evidence: DM 발송 캡처(strong) + 응답/무응답 Sheet(GSheets 자동검증, `action-day-auto-verification.mjs:826-915`).
- adaptive: 발송 < 5이면 다음날 mini-action으로 잔여 발송 carry.

**Day 21 · review · Observe — G5 milestone**
- 핵심 질문: "외부 유입과 첫 활성 사용자가 실측되는가?"
- mission: 테스터 관찰 + 막힌 단계 기록 (`:203`) + 유입/활성 실측 확인.
- evidence: ① traffic 자동 증거(Cloudflare/PostHog) ② active user ≥1(HogQL) ③ 관찰 노트.
- gate: **G5 하드블록**. 실패 시 OH 회부 + 채널 재선정 intervention.
- adaptive: traffic>0·signup=0이면 Week 4 진입 전에 landing/CTA 수정 mini-action 삽입(AR-10).

### Week 4 — Grow/Revenue (활성 사용자 루프 + 결제 반복)

**Day 22 · action · Demo**
- mission: 60초 demo (`:204`). evidence: demo 영상 URL(strong if public).

**Day 23 · education · Paid Learning**
- mission: 광고 예산·중단 기준·소재 3개 설계 (`:205`). 워크시트. `/analyze-ads`(Claude 전용, `index.mjs:3411`) 연계 안내.

**Day 24 · interview · Launch Decision**
- 핵심 질문: "조회수가 아니라 DM/설치/first_value/ask 숫자로 다음 7일을 정했는가?"
- mission: 채널별 숫자 정리, 최강 채널 선택 (`:206`). evidence: launch decision + 자동 지표 스냅샷.

**Day 25 · action · Activation**
- mission: 활성화 정의 재확인, 최대 이탈 지점 1개 선택 (`:207`).
- evidence: activation baseline(HogQL 자동, strong). adaptive: 직전 7일 active user(§15.4 스냅샷) 증가 >0 이고 paymentIntent=0이면 Day 27(Pricing)을 Day 26으로 전진 배치(AR-13 nextAction과 동일 경로, 임계값은 gate-ledger 설정값).

**Day 26 · interview · Retention**
- mission: 재방문 기준·반복 사용 발화 확인 (`:208`). evidence: Day-1 retention cohort(자동) + 사용자 인용 1개.

**Day 27 · action · Pricing — revenue 반복**
- 핵심 질문: "지불 행동 또는 명시적 가격 거절을 만들었는가?" (`:209` 원문)
- mission: 유료 제안 1개 → 관심 사용자에게 가격·약속·기한 제안 → 결제/거절 원문 기록.
- evidence: paymentRecord(strong) 또는 명시적 거절 원문(strong). 실패 반복 시 AR-14.

**Day 28 · review · Acquisition Loop — G6 milestone**
- mission: ASO/소재/랜딩을 전환 데이터로 수정 (`:210`) + revenue 검증 상태 판정.
- gate: **G6** — paymentRecord ≥1 또는 (paymentIntent ≥3 + 명시 거절). 미달 시 Day 30 옵션 제한.
- evidence: 수정 전후 지표 비교(자동).

**Day 29 · interview · PMF Memo**
- mission: 사용자 증거·ask 결과·반증을 한 문서에 (`:211`).
- evidence: PMF evidence memo + proof-ledger 참조 ≥5. rubric Day 30 사전 준비 (`rubric-assessment.mjs:41-68` — day 0|30 전용, score≥3엔 evidence_refs 필수).

**Day 30 · review · Final Decision — G7 milestone**
- 핵심 질문: "완주가 아니라 첫 가치·유입·지불 행동 근거로 무엇을 선택하는가?"
- mission: 30일 숫자 요약, 배움 3개, continue/pivot/stop 공개 (`:212`).
- evidence: dayDecision + 근거 증거 참조 ≥3 + rubric Day 30 평가(no_evidence_reason 없이 score≥3 불가).
- gate: **G7**. 통과 시 graduationState 기록 (`adaptive-curriculum.mjs:337-380` 기존 terminal 경로).
- coaching: weekly-ritual이 Day 30 ritual을 의도적으로 두지 않은 설계("결판 tension 보존", `weekly-ritual.mjs:12-24`)와 일관되게, 시스템은 축하가 아니라 결정을 요구한다.

### 11.1 Adaptive 경로 변형 (checklist가 아닌 이유)

- **느린 트랙:** milestone gate 실패 시 해당 주차가 늘어나는 것이 아니라 **다음 review day까지 회복 미션으로 대체**된다(예: G4 실패 → Day 15–16이 "ask 재작성+발송", "계측 삽입"으로 치환). 치환 테이블은 Gate Engine이 소유(§15.3).
- **빠른 트랙:** rushing 감지(`prior-day-execution-signals.mjs:60-67`) + 모든 gate 선통과 시, education day를 skip 가능으로 표시하되 interview 쿼터는 유지(감속이 아니라 증거 밀도 유지).
- **pivot 트랙:** Day 7/14/21 dayDecision=pivot 시 Day 1–3 변형(새 ICP로 Alignment/Market/Mom Test 압축 2일)을 삽입하고 잔여 일정 재산정. challengeStartedAt은 불변(30일 시계는 멈추지 않음 — Assumption A5).

---

## 12. Adaptive Rules

공통 스키마(모든 rule): `{ ruleId, 감지조건, 필요signal, confidence, userMessage, nextAction, 진행허용, OH개입, 저장: gate-ledger.adaptiveEvents[] + mac_sidecar_adaptive_rule_fired, 오탐대응 }`. confidence는 high(자동 집계 기반)/medium(파생 지표)/low(휴리스틱).

| ID | 상황(요구 목록 매핑) | 감지 조건 / signal | conf | 사용자 메시지(요지) | 다음 action | 진행 | OH |
|---|---|---|---|---|---|---|---|
| AR-01 | 제품 개발 도피 | buildWithoutCustomerEvidence=true 2일 연속 (`daily-office-hours-digest.mjs:913`) + work-history AI시간↑ | high | "이틀째 커밋만 있고 고객 신호가 0이다" | 오늘 미션을 고객 접촉으로 강제 치환 | 허용(경고) | 3일째 자동 회부 |
| AR-02 | 고객 접촉 부족 | 주간 인터뷰 strong < 주차 쿼터(W1:3, W2:3, W3:3, W4:2 — 주 분포 `:50-159`에서 유도) | high | "이번 주 인터뷰 쿼터 미달" | BIP radar 후보 3명 제시+DM 초안 | 허용 | 쿼터 50%미만 시 회부 |
| AR-03 | 인터뷰 했지만 learning 약함 | 인터뷰 N≥3인데 과거행동 인용·대안 언급·지불 신호 3항목 모두 0 — 신규 `interview-learning-judge`(인터뷰 턴 로그 입력, 3항목 boolean rubric; **구현은 later §25**) | medium | "칭찬만 모았다. Mom Test 위반" | 질문 스크립트 재작성 mini-action | 허용 | 2회 반복 시 회부 |
| AR-04 | 너무 쉬운 mission 반복 | 커리큘럼이 action/interview를 배정한 Day의 record가 3일 연속 미완료·carry-over로 이월되는 동안 education 워크시트만 완료(배정 스케줄 대비 판정 — 스케줄 기인 오탐 차단) | medium | "안전한 일만 골랐다" | 다음 Day를 interview로 강제 | 허용 | 회피 5일 시 |
| AR-05 | 너무 어려운 mission 정체 | 같은 action carry-over ≥3 (`carryOverQueue`) | high | "이 행동이 3일째 막혀 있다" | mission을 더 작은 단위로 분해 제안 | 허용 | 분해 후에도 2일 정체 시 |
| AR-06 | mission 건너뛰기 | day record 미생성 + 다음 day 진입 시도 | high | "어제 기록이 비어 있다" | retro 스텝에서 사유 1문항 | 허용 | 3회 누적 시 |
| AR-07 | self-report만 제출 | weak-only 증거 2 Day 연속 (§9.3) | high | "검증 가능한 증거가 없다" | 증거 종류 가이드 + 재제출 | milestone이면 차단 | 즉시 후보 |
| AR-08 | deploy 했지만 traffic 0 | browser 검증 통과 URL 존재 + Cloudflare visits=0 3일 | high | "배포는 끝났고 유입이 0이다" | 채널 1개 선택+첫 포스트 mission | 허용 | Day 21 G5와 합류 |
| AR-09 | traffic 있지만 CTA 0 | visits>0 + CTA 이벤트 0 (HogQL) | high | "오는데 누르지 않는다" | CTA 문구/위치 수정 mini-action | 허용 | — |
| AR-10 | CTA 있지만 signup 0 | CTA>0 + signup 0 | high | "약속이 약하거나 폼이 무겁다" | 폼 축소·약속 재작성 | 허용 | — |
| AR-11 | signup 있지만 active 0 | signup>0 + first_value 0 | high | "가입 후 첫 가치 전에 죽는다" | activation 통로 관찰 mission(Day 21형) | 허용 | 2주기 반복 시 |
| AR-12 | active 있지만 재방문 0 | first_value>0 + Day-1 retention 0% (기존 cohort 쿼리) | high | "한 번 쓰고 돌아오지 않는다" | 돌아올 이유 인터뷰 mission | 허용 | — |
| AR-13 | 재방문 있지만 payment intent 0 | retention>0 + paymentIntent 0 (Day 22+) | high | "좋아하는데 지갑 신호가 없다" | 가격 제안 mission 전진 배치 | 허용 | Day 27 전 회부 |
| AR-14 | payment intent 있지만 결제 0 / 실패 반복 | paymentIntent ≥2 + paymentRecord=0, 또는 paymentFailure ≥2 | high | "의향과 결제 사이가 끊겼다" | 결제 경로 점검+가격/패키지 변형 1개 | 허용 | 즉시 회부(고레버리지) |
| AR-15 | 인터뷰 반응 좋지만 usage 0 | 인터뷰 긍정 + first_value=0 (G5 이후) | medium | "말과 행동이 다르다 — 행동을 믿어라" | 관찰 세션 예약 mission | 허용 | continue 옵션 제한 근거(G6) |
| AR-16 | 증거 판정불가 반복 | judge insufficient 반복 ≥3 + 동일 증거 재제출, 시각/발신자 식별 불가 | medium | "이 증거로는 판정 불가" | 원본 증거 요구(원문·시각 포함) | milestone 차단 | 2회 시 회부 |
| AR-17 | 허위 진행(증거 없는 약속의 반복 적립) | abandoned threads ≥1 (`office-hours-memory.mjs:477-489`) + 신규 커밋먼트 계속 생성 | high | "N사이클째 증거 0인 약속 위에 새 약속을 쌓고 있다" | 기존 커밋먼트 1개 닫기 전 신규 금지 | 신규 커밋먼트 차단 | 즉시 회부 |
| AR-18 | rushing | rushingCandidate=true (`prior-day-execution-signals.mjs:60-67`) 또는 pace=rusher, **그리고 미통과 milestone gate ≥1**(전부 통과면 발동하지 않고 §11.1 빠른 트랙 적용) | high | "속도가 아니라 증거 밀도가 목표다" | 다음 day tasks에서 optional 항목 제거(core task 1개만 유지) + 해당 day 증거 요구를 자동검증(§9.2 파이프라인) 필수로 상향 | 허용 | — |
| AR-19 | 반복 정지(이탈 전조) | day-progress 3일 무갱신 + 앱 실행 있음 | medium | "3일째 멈췄다. 가장 작은 다음 행동 1개" | 1-step mission 제안 | 허용 | 5일 시 회부 |
| AR-20 | pivot 필요 신호 | dayDecision=pivot 또는 (G5 실패 + 인터뷰 반증 우세) | high | "증거가 방향 전환을 가리킨다" | pivot 트랙 삽입(§11.1) | 경로 재구성 | 필수 회부(human escalation 후보) |

**오탐 대응(공통):** ① 모든 rule은 발동 전 근거 signal의 원천 데이터를 메시지에 첨부(사용자가 반박 가능) ② 사용자가 "오탐" 라벨 시 해당 rule의 쿨다운 48h + 라벨을 gate-ledger에 기록(morning briefing anomaly 라벨 패턴 재사용, `morning-briefing.mjs:17-70`) ③ 데이터 소스 미연동 상태에서는 자동집계 기반 rule(AR-08~15) 발동 금지(소스 가용성은 source gate 상태로 판정, `daily-office-hours-digest.mjs:310-431`).

---

## 13. Office Hours Intervention System

상담이 아니라 **막힘·회피·허위 진행·방향 착오·시장 검증 실패·기술 도피를 교정하는 고레버리지 intervention**이다 (Decision D4: 시스템 선제 트리거 + AI 진행).

### 13.1 Trigger registry

| Trigger | 소스 rule/gate | 등급 |
|---|---|---|
| milestone gate 실패(G2/G4/G5/G7) | Gate Engine | 즉시·강제 표면화 |
| AR-01(3일), AR-07, AR-14, AR-17, AR-20 | adaptive rules | 즉시 |
| AR-02(쿼터 50%↓), AR-03(반복), AR-05(분해 후 정체), AR-19(5일) | adaptive rules | 다음 아침 브리핑에 예약 |
| 시스템 추천 confidence 부족(다음 action을 high로 못 정함) | Gate Engine 평가 잔차 | 예약 |
| interview gate confession (G1 포함, Day 2+ interview 스텝 동일) | `classifyInterviewGate` confess 경로 | 즉시 (축약형 §13.3a) |
| per-day 트리거: Day 6 ask 발송 공포 confession / Day 13 인터뷰 쿼터 미달 / Day 21 채널 재선정 | §11 per-day 항목 | 즉시 또는 예약 |
| 사용자 수동 요청(`/office-hours`) | 기존 경로 유지 (`index.mjs:3396-3399`) | 항시 |

구현: 신규 브리지 이벤트 `office_hours_intervention_required{triggerId, ruleId, severity}` → Swift가 차단형(즉시) 또는 배너형(예약) 카드 표시. 기존 `office_hours_start`에 `payload.trigger` 필드 추가(additive).

### 13.2 Context package (세션 시작 시 AI에 주입)

기존 자산 재사용: compiledTruth+openThreads(`office-hours-memory.mjs:458-474`) / 최근 cycles / 미결 커밋먼트+abandoned threads / 일일 digest 4소스 / proof-ledger day 윈도우 요약 / 발동 rule의 원천 signal / gate 상태. **신규 조립 코드만 필요, 데이터는 전부 존재.**

### 13.3 진행 구조 (AI)

1. 현재 상태 1문단 요약 제시(사용자 확인/반박).
2. trigger별 고정 질문 세트 — 신규 모듈 `sidecar/oh-intervention-prompts.mjs`가 소유한다. §13.1 registry의 **모든** 트리거에 대해 질문 세트를 저작하며, 등재되지 않은 트리거는 발동 금지(fail-closed). 예: AR-01 → "오늘 커밋이 검증한 고객 가설은 무엇인가? 없다면 무엇이 두려운가"; AR-14 → "결제 직전 무엇이 끊겼는지 고객 원문으로 말하라".
3. 종료 조건: **구조화 커밋먼트 1개(고객·채널·메시지·기대증거·기한, user-origin, audience=customer) 확정** — 기존 commitment-suggest→confirm 플로우 그대로 (`office-hours-commitment-suggest.mjs`).
4. 필수 post-session evidence: 커밋먼트의 expectedEvidenceKind에 따른 strong 증거, dueDay 내.

**축약형(§13.3a):** per-day confession/mini-intervention도 동일 계약을 따른다 — 질문 수만 1–2문항으로 축소하며, context package 주입·커밋먼트 종료 조건·cycles/gate-ledger 기록·post-session evidence 의무는 동일하게 적용한다.

### 13.4 효과와 불참 처리

- 참여+커밋먼트 확정: 차단형이었으면 통과 토큰을 발급하되 **gate당 1회만**(동일 gate 재차단 시 재발급 불가), `{ gateId, issuedAt, dueDay, expectedEvidenceKind }`로 gate-ledger에 기록.
- **토큰 만료(enforcement):** dueDay까지 post-session strong 증거가 proof-ledger에 도착하지 않으면 토큰은 자동 만료되고 해당 gate는 blocked로 복귀(이후 Day 진입 재잠금)하며 `mac_sidecar_oh_intervention_evidence_missed{gate_id, trigger_id, consecutive_count}`를 발행한다(§16.2). 프로그램 전체 토큰 발급 누적 3회 초과 시 human escalation 경로만 남는다(§13.5). 즉, **말(커밋먼트)만으로 gate를 반복 통과하는 체인은 구조적으로 불가능하다.**
- 불참/이탈: 차단형은 차단 유지. 예약형 2회 연속 무시 → 차단형으로 승급. 모든 참여/불참은 cycles outcome으로 기록(기존 blocked/abort 패턴, `office-hours-memory.mjs:543-551`).
- intervention 후 Day 추천 변경: Gate Engine이 치환 테이블(§11.1) 적용.

### 13.5 자동화 / human mentor 경계 (Decision D4·D6)

- **AI 자동:** trigger 감지, context package, 세션 진행, 커밋먼트 확정, 추천 변경.
- **Human(October) escalation 조건:** ① 동일 사용자 intervention 3회 연속 무증거 ② pivot/stop 결정 직전(AR-20) ③ gate 판정 이의 제기. escalation은 PostHog 코호트 대시보드(§20)의 risk 보드에 표면화 — 별도 서버 없음.

---

## 14. State Machine

### 14.1 Program 수준

```
states: onboarding → foundation(D1–7) → build(D8–14) → launch(D15–21) → grow(D22–30) → graduated
                                  └→ pivot_loop(압축 D1–3 변형) → 복귀
gate-blocked: 모든 phase에서 진입 가능한 오버레이 상태
  { blockedGate, since, resolutionPath: evidence|confession+OH|waive(불가-milestone) }
```

- phase 전이는 review day(7/14/21/28)의 gate 평가로만 발생. day 번호 자체는 경과일로 계속 흐른다(`computeDayNumber`, `day-progress-state.mjs:193-200`) — **시계와 phase를 분리**하는 것이 이 설계의 핵심(지연 사용자는 day>phase 예정일 상태가 되고, 그 갭 자체가 AR-19 입력).

### 14.2 Day 수준 (기존 유지 + 추가)

- 스텝 머신: 기존 day-progress 단조 전진 유지 (`:127-166`).
- execution 스텝에 서브상태 추가: `mission_loaded → auto_verifying → evidence_pending → judged(accepted|insufficient) → recorded`. 전이 결과는 proof-ledger에 영속(§15.1) — 기존 in-memory 머신(`action-day-verification-state.mjs`)의 상태는 유지하고 종단 결과만 write-through.

### 14.3 Gate 수준

`locked → open(조건 충족 가능) → passed | blocked(→ OH intervention → passed-via-confession | 유지)` + blocked의 오버레이 변형 `provisional`(외부 소스 장애 시 최대 3일, §21 — Day 진행만 임시 허용, gate 통과 아님). milestone gate에 waive 없음(Decision D3). 평가는 멱등·재실행 가능(증거 도착 시 재평가). OH 통과 토큰의 발급·만료·회수 규칙은 §13.4.

---

## 15. Data Model Changes

> 원칙: additive·non-breaking (`docs/PHILOSOPHY.md`). 기존 스키마 버전 bump 시 마이그레이션 테스트 필수(CLAUDE.md 규칙).

### 15.1 proof-ledger write-through (변경)

- action 증거 판정 종단 결과를 proof-ledger `actionEvidence` 이벤트로 기록: `{ day, actionId, evidenceType, strength(=trust tier), status, judgeConfidence, sourceUrl|artifactPath, verifiedBy(auto-method|judge), occurredAt }`. 스키마 필드는 기존 정의(`execution-os.mjs:138-184`)로 전부 수용 가능 — **신규 필드 없음**, 배선만 추가.

### 15.2 proof-ledger 이벤트 타입 추가 (스키마 v1→v2, 마이그레이션 테스트 동반)

- `paymentRecord`(결제 완료/예약판매 입금), `paymentFailure`, `refund`, `trafficSnapshot`(선택). 기존 v1 이벤트는 무변환 통과(타입 enum 확장만).

### 15.3 신규 `gate-ledger.json` (schema v1, `<ws>/.agentic30/gate-ledger.json`)

```json
{ "schemaVersion": 1, "schema": "agentic30.gate_ledger.v1",
  "gates": { "G4": { "state": "blocked", "since": "...", "evaluations": [...] } },
  "adaptiveEvents": [ { "ruleId": "AR-01", "firedAt": "...", "signals": {...}, "userLabel": null } ],
  "substitutions": [ { "day": 15, "replacedMission": "...", "reason": "G4_failed" } ] }
```

atomic-store(`atomic-store.mjs`) 사용. day-progress와 분리하는 이유: gate 이력은 append 성격이고 day-progress는 UI 핫패스라 락 경합 회피.

**치환 테이블 (Gate Engine 소유, MVP 범위 — §11.1의 회복 미션 전체 정의):**

| failedGate | targetDays | replacementMission | exitCondition |
|---|---|---|---|
| G2 | Day 8–9 | 인터뷰 재실행 + foundation 마감(go-no-go 재작성) | 인터뷰 strong ≥1 + dayDecision 기록 |
| G4 | Day 15–16 | ① 유료 ask 재작성+발송 ② first_value 계측 삽입 | paymentIntent strong ≥1 + HogQL first_value ≥1행 |
| G5 | Day 22–23 | 채널 재선정 + 첫 포스트/outreach 재실행 | traffic 자동 증거 + active user ≥1 |
| G6 | Day 29 | ask 재발송 + 결제/거절 원문 수집 삽입 | paymentRecord 또는 명시적 거절 원문 |
| G7 | Day 30+ | graduation 보류 미션(근거 증거 참조 보강) | 근거 증거 참조 ≥3 |

각 행은 `{failedGate, targetDays, replacementMissionId, exitCondition}`로 gate-ledger `substitutions[]`에 기록된다.

### 15.4 신규 `metrics/active-users.json` (schema v1)

`{ snapshots: [{ at, day, activeUserCount, firstValueEventName, source: "posthog_hogql", queryFingerprint }] }` — morning briefing 수집 사이클에 편승(`morning-briefing-direct-sources.mjs` 확장), 일 1회.

### 15.5 커밋먼트 검증 강화 (office-hours-ledger v3→v4)

- 커밋먼트에 `audience: customer|internal` 필수 필드 추가(v4 스키마 필드). 분류기는 commitment-suggest의 기존 비고객 행동 거부 규칙(`office-hours-commitment-suggest.mjs:66-108`)을 재사용하고, 미분류는 customer로 기본 처리(fail-closed). audience=customer 커밋먼트의 expectedEvidenceKind에서 `commit`을 제외(url/screenshot/payment만 허용)하고, `evidence.kind == expectedEvidenceKind` 검증을 추가한다. carried_forward 체인에 `satisfiedByLaterVersion` 링크(텍스트 드리프트 중복 해소, 현재 dedup 한계 — `office-hours-memory.mjs:818-832`).

### 15.6 adaptiveDifficultyState 기록 시작 (curriculum progress 내, 스키마 무변경)

review day 종료 시 `{ direction: lighter|hold|heavier, trigger, appliedWeek }` 기록 — 파생 생성·소비 경로는 기존(`adaptive-curriculum.mjs:1768-1862`의 rushing/low-quality 생성, `mini-action-session-context.mjs:2245-2300`의 learner-state 소비), **영속 writer만 신설**(review-day normalize: `review-day-curriculum-signals.mjs:827-851`).

---

## 16. Event Tracking Plan

### 16.1 컨텍스트 보강 (1개소 수정)

`telemetry.mjs` baseProperties(`:374-395`)에 `program_day`, `program_phase`, `active_gate`, `gate_state`를 자동 부착 — day-progress·gate-ledger 캐시에서 읽음. 120+ 호출부 무수정 (§4.6 제약 3의 해법 b).

### 16.2 신규 이벤트

| 이벤트 | 속성 | 시점 |
|---|---|---|
| `mac_sidecar_gate_evaluated` | gate_id, state, blocked_reason, evidence_count | Gate Engine 평가 |
| `mac_sidecar_gate_blocked` / `_unblocked` | gate_id, resolution_path | 상태 전이 |
| `mac_sidecar_adaptive_rule_fired` | rule_id, confidence, user_label | rule 발동/라벨 |
| `mac_sidecar_oh_intervention_triggered` / `_completed` | trigger_id, severity, commitment_confirmed | intervention |
| `mac_sidecar_oh_intervention_evidence_missed` | gate_id, trigger_id, consecutive_count | 통과 토큰 만료(§13.4) — escalation 큐(§20-④) 데이터 소스 |
| `mac_sidecar_active_user_snapshot` | active_user_count(수치만), day | 일 1회 |
| `mac_sidecar_revenue_evidence_recorded` | kind(payment_record|intent|failure|refusal), amount_band(구간화) | 기록 시 |
| `mac_sidecar_mission_substituted` | day, reason | 치환 |

**프라이버시:** 고객명·메시지 원문·금액 원값·URL 원문은 전송 금지(금액은 구간화, URL은 도메인). 기존 sanitizer(`telemetry.mjs:118-209`) 통과 필수.

### 16.3 대시보드용 최소 funnel

설치(`installer_downloaded`)→온보딩 완료→Day1 G1→G2→G4→G5→G6→G7. 모두 위 이벤트로 구성 가능.

---

## 17. API, WebSocket, and MCP Changes

> 본 작업의 산출물은 변경**안**이며 구현하지 않는다. Swift/sidecar 양측 동시 반영 원칙(CLAUDE.md) 적용 대상.

### 17.1 신규 클라이언트→사이드카 메시지

- `gate_status_get {day?}` → `gate_status_result`
- `submit_revenue_evidence {kind, content, note}` — submit_action_evidence(`action-day-evidence-submission.mjs:19`)와 동형, paymentRecord 경로
- `adaptive_rule_label {ruleId, label}` — 오탐 라벨
- `office_hours_start` payload에 `trigger` 필드 추가(additive)

### 17.2 신규 사이드카→클라이언트 이벤트

- `gate_status_result`, `office_hours_intervention_required`, `mission_card {day, source: idd, mission, evidenceSpec, gateContext}` (execution 스텝 진입 시 IDD 미션 로드 — §11.0 배선), `active_user_metric {count, day}`
- 디코더 추가 위치: `agentic30Tests/SidecarEventDecodingTests.swift`에 픽스처 동반(기존 관례).

### 17.3 MCP

- `mcp-server.mjs`에 read-only 도구 1종 추가 검토: `get_program_status`(day/gate/risk 요약) — 외부 클라이언트(예: 사용자의 Claude Code)에서 상태 조회용. 쓰기 도구는 추가하지 않음(foundation read-only 계약과 동일 철학).

---

## 18. UI/UX Changes

| 변경 | 내용 | 기반 |
|---|---|---|
| Day 타임라인 Day 2+ 활성화 | 사이드바 누적 Day + gate 상태 칩(잠김/통과/차단). 데이터는 이미 디코딩됨(DayProgress days dict) | `AgenticViewModel.swift:1899-1950`, 사이드바 IA 결정(미래 숨김·경과일=Day번호) |
| 미션 카드(execution 스텝) | IDD 미션+evidence spec+자동검증 시작 버튼. action coach mark layout 재사용 | `adaptive-curriculum.mjs:1064-1087` |
| 증거 제출 표면 확장 | URL 붙여넣기 + 파일/스크린샷 picker(sidecar는 link/file 기존 지원 — Swift 표면만 부재) | §4.3 관찰 |
| Gate 차단 화면 | blockedReason + 필요한 증거 목록 + "증거 제출"/"confession+OH" 두 경로 | G-gate 계약 |
| OH intervention 카드 | 차단형(모달)·예약형(브리핑 배너) 2형 | §13.1 |
| review 대시보드에 G-gate 패널 | 기존 review-day-ui-composition에 gate 판정 섹션 추가 | `review-day-ui-composition.mjs` |
| 활성 사용자 카운터 | 메뉴바/워크스페이스 상단 "active N/100" (HogQL 스냅샷) | §15.4 |
| commitmentGate UI 완성 | commitmentGateMessage/Step published 상태(현재 미표면)를 인터뷰 스텝 카드에 표면화. 수용 기준: block 모드에서 재제출 CTA, confession 모드에서 OH 회부 CTA 표시 | `AgenticViewModel.swift` (§4.2 관찰) |

stub provider(`AGENTIC30_TEST_STUB_PROVIDER=1`) 하에서 픽셀 안정 — 신규 뷰 모두 스텁 경로 필수(CLAUDE.md UI 테스트 규약).

---

## 19. Notifications and Reminders

MVP 알림 범위는 프로그램 스케줄러의 두 가지 09:00 로컬 알림이다(`curriculum-notification-scheduler.mjs:82-197`). Swift의 기존 로컬 notification 경로는 완료·연동·질문 준비 이벤트를 즉시 표시하는 용도이며, AR-19 전용 21:00 예약 알림은 현재 배선하지 않는다.

1. **gate-blocked 아침 알림** (브리핑 시각): "G4가 잠겨 있다 — 필요한 증거 1개".
2. **커밋먼트 dueDay 알림**: 기한 당일 09:00.

---

## 20. Admin/Mentor Dashboard

> 근거: Decision D6 (§29).

- **구현체: PostHog 코호트 대시보드** — 신규 서버 0. October의 PostHog 프로젝트(이미 모든 telemetry 수신)에 대시보드 구성.
- 보드: ① 코호트 progress (G1–G7 funnel, §16.3) ② risk 보드(adaptive_rule_fired by rule_id/user) ③ intervention 보드(triggered vs completed vs commitment_confirmed) ④ escalation 큐(§13.5 조건 충족 사용자) ⑤ activation/revenue (active_user_snapshot, revenue_evidence_recorded).
- **경계:** 사용자 콘텐츠(답변·증거 원문·고객명·금액 원값)는 절대 미전송(§16.2). 대시보드는 메타데이터만.
- 동의: 온보딩 telemetry 고지에 "코칭 운영 목적의 진행 메타데이터" 명시 문구 추가(§22).

---

## 21. Failure Modes and Recovery

| Failure | 영향 | 대응 |
|---|---|---|
| PostHog/Cloudflare 소스 다운·미연동 | AR-08~15·G4②·G5 판정 불가 | 자동집계 rule 발동 금지(§12 오탐 대응 ③). G4②·G5는 blocked(reason=source_unavailable)를 유지하되 gate-ledger에 **provisional 오버레이(최대 3일, §14.3)** 부여 — provisional 동안 Day 진행만 임시 허용하고, 캡처 증거(medium)는 기록만 하며 **gate 통과에는 절대 불산입**(D1·D3 유지). 3일 내 소스 복구+재평가 통과 없으면 하드블록 복귀. 부분 digest 허용(현재 전면 차단인 source gate를 partial로 완화 — `daily-office-hours-digest.mjs:310-431` 변경안) |
| LLM judge 타임아웃/오판 | 증거 판정 지연·오차단 | 기존 120s 타임아웃(`action-evidence-judge.mjs:183-214`) 유지 + error 시 보류 상태(차단 아님) + 사용자 이의 제기 → escalation 큐 |
| 앱 재시작 중 검증 상태 소실 | 재검증 강요 | §15.1 write-through로 종단 결과 영속 — 진행 중 attempt만 소실(수용) |
| gate-ledger 손상 | gate 오판 | atomic write + 손상 시 proof-ledger에서 전체 재계산(평가 멱등 §14.3) |
| 사용자 시계 변경/시간대 이동 | day 번호 점프 | challengeStartedAt 로컬 날짜 비교(기존, `day-progress-state.mjs:193-200`) 유지, day 역행은 무시(단조), 점프 ≥3일 시 확인 카드 |
| 사이드카 비정상 종료 | 세션 유실 | 기존 boot 정규화(running→idle, `session-store.mjs:26-56`) + OH resume(`office-hours-resume.mjs`) 경로로 복원 |
| 사용자가 차단 우회 시도(파일 직접 수정) | gate 무력화 | 위협 모델상 self-coaching 도구이므로 변조 방지는 비목표. 단 gate-ledger 평가는 원천(proof-ledger)에서 재계산되므로 ledger 단독 수정은 무효 |
| Exa 부재 | radar 실패 | 코칭 비차단(radar는 보조) — 현행 graceful 실패 유지 |

---

## 22. Security and Privacy

- **로컬 우선:** 모든 증거 원문·고객 데이터는 `<ws>/.agentic30/`에만 저장(파일 모드 0600 기존 관례, `adaptive-curriculum.mjs:635-638`). 외부 전송은 sanitized telemetry 메타데이터만.
- **PostHog(사용자 제품) 접근:** read-only HogQL, provider-scoped OAuth(스키마 v2, 폴백 금지 — `mcp-oauth-state.mjs`, 기존 결정 유지).
- **judge 입력 redaction:** 증거 원문을 LLM judge에 보낼 때 기존 rubric-redact/sanitization-ledger 경로 적용 검토(`rubric-redact.mjs`, `sanitization-ledger.mjs`).
- **동의:** 온보딩에 ① agentic30 telemetry(메타데이터) ② mentor 대시보드 운영 목적 ③ 사용자 제품 PostHog read-only 접근 3건을 분리 고지. `AGENTIC30_DISABLE_TELEMETRY=1` 전면 비활성(기존).
- **비밀:** auth-context의 키 스크럽 유지(`auth-context.mjs`), 커밋먼트의 고객 식별 정보는 telemetry 불포함.
- gh CLI 토큰·gws keyring 위임(디스크 미저장) 현행 유지.

---

## 23. Technical Tradeoffs

1. **proof-ledger 재사용 vs 신규 evidence store:** 재사용 선택 — strength 필드가 trust-tier와 동형, 기존 gate가 이미 이 원장 기준(`curriculum-progression-gate.mjs`). 비용: 이벤트 수 증가 시 O(n) 재계산 — 30일×수십 건 규모라 수용.
2. **Gate Engine 신설 vs 기존 gate 확장:** 신설(위임 포함) — progression-gate는 proof 매칭 전용으로 좁게 유지, milestone 의미론은 별도. 비용: 모듈 1개 증가. PHILOSOPHY의 "index.mjs는 sibling으로 추출" 관례와 일치.
3. **하드블록 vs 전면 비차단:** 하이브리드(D3) — milestone만 차단. completion rate 일부 희생, 허위 진행 차단 이득. confession 경로가 안전밸브.
4. **PostHog 계측 의무화(D1):** 연동 마찰로 Week 2 이탈 위험 ↔ 활성 사용자 검증의 신뢰성. 완화: G4 시점까지 유예 + 계측 삽입을 미션으로 코칭(Day 14가 원래 Measurement day).
5. **day 시계 불정지(A5):** 일시정지 기능 없음 — 단순성과 압박 유지 vs 휴가/질병 케이스. AR-19+phase/시계 분리(§14.1)로 흡수.
6. **mentor 대시보드 = PostHog(D6):** 인프라 0 ↔ 실시간성·커스텀 한계. 코호트 5–10명 규모에서 충분.
7. **치환 테이블 방식 adaptive vs 자유 생성:** 결정적 치환 우선 — 테스트 가능·회귀 안정(dogfood eval에 신규 시나리오 추가 가능, `sidecar-evals/`). LLM 자유 생성 미션은 later.

---

## 24. MVP Scope

100명 활성·첫 매출 검증에 직접 기여하는 최소 시스템만:

1. **Gate Engine + gate-ledger** (G1–G7, 차단/confession/OH 회부) — §10·§15.3
2. **증거 write-through + trust-tier** (proof-ledger 배선 + 타입 추가 v2) — §15.1·15.2·§9
3. **Day 2–30 미션 배선** (execution 스텝 ← IDD 미션 카드 + 치환 테이블) — §11.0·§17.2
4. **Adaptive rules 1차 8종:** AR-01, 02, 05, 07, 08, 14, 17, 19 (risk·revenue 직결만)
5. **OH 선제 트리거** (intervention_required 이벤트 + context package + post-evidence 의무) — §13
6. **활성 사용자 스냅샷 + first_value gate(G4)** — §15.4
7. **revenue evidence 경로** (submit_revenue_evidence + paymentRecord) — §17.1
8. **telemetry 컨텍스트 보강 + 신규 이벤트 + escalation 큐 보드(§20-④)** — 코호트 funnel·risk·intervention·activation 보드(①②③⑤)는 later(§25) — §16·§20
9. **UI 4종:** Day 2+ 타임라인 gate 칩, 미션 카드, gate 차단 화면, 증거 picker — §18
10. **알림 2종:** gate-blocked 아침 알림, dueDay 알림 — §19

## 25. Later Expansion Scope

- AR 잔여 12종(깔때기 세분 AR-09~13·15, learning 품질 AR-03·04·06·16·18·20의 자동화 고도화)
- 예측 자동 채점·calibration 피드백 루프, 커밋먼트 semantic dedup
- email/calendar/community(Discord·Slack) 연동, 결제 provider webhook, Meta Ads deep integration
- mini-action 템플릿의 learner-state 적응(`mini-action-session-context.mjs:1352-1414` 시드 존재)
- review cadence 가변화(일시정지·지연 재배치), 빠른 트랙 skip
- PostHog 코호트 대시보드 보드 ①②③⑤(funnel·risk·intervention·activation) 구성 — MVP는 escalation 큐 보드 ④만(§24-8)
- 전용 클라우드 mentor 대시보드, 고가 멘토링 티어(prestige tier — Q2 위키의 100–300만원 사관학교 트랙, `docs/october-academy/wiki/2026-Q2.md`) 운영 도구
- AI 대화 기록 의미 분석(회피 주제), 사용자 제품 외 분석도구(GA 등) 어댑터

## 26. Implementation Priority

| 순서 | 작업(이슈 단위) | 의존 | 검증 |
|---|---|---|---|
| P0-1 | proof-ledger v2(타입 추가)+마이그레이션 테스트 | — | `node --test sidecar-tests/execution-os.test.mjs` 확장 |
| P0-2 | 증거 write-through(judge/auto 결과→ledger) | P0-1 | 신규 테스트 |
| P0-3 | gate-ledger + Gate Engine(G1·G2·G4만 우선) | P0-2 | 신규 테스트 + dogfood 시나리오 |
| P0-4 | day_progress_patch에 Gate Engine 배선(권위 게이트 위치 유지) | P0-3 | `day-progress-state.test.mjs` 확장 |
| P0-5 | 미션 카드 배선(execution←IDD)+Swift 디코더+픽스처 | P0-3 | Swift 테스트 |
| P0-6 | active-users 스냅샷+G4② | P0-3 | HogQL 모킹 테스트 |
| P1-1 | OH 선제 트리거+intervention 카드 | P0-3 | 양측 테스트 |
| P1-2 | AR 8종+오탐 라벨 | P0-3 | 룰 단위 테스트 |
| P1-3 | telemetry 컨텍스트+신규 이벤트+대시보드 구성 | P0-* | 이벤트 스냅샷 |
| P1-4 | G5·G6·G7+치환 테이블 | P0-3 | dogfood gate 시나리오 |
| P2 | UI 마감(타임라인 칩·증거 picker)·알림 2종·문서 갱신(AGENTS.md/known-limitations) | P1 | hermetic UI subset |

각 단계 완료 기준: `npm run test:sidecar` green + (Swift 변경 시) `xcodebuild test` + bridge 변경 시 양측 동시 반영(CLAUDE.md).

---

## 27. Open Questions

1. **pivot 시 30일 시계:** pivot 트랙 진입 시에도 challengeStartedAt을 유지하는 게 기본값(A5)인데, Day 20 이후의 늦은 pivot은 사실상 "다음 30일"이다. 늦은 pivot(Day 18+)에서 챌린지 재시작(새 challengeStartedAt)을 허용할지는 운영자 결정이 필요하다.
2. **유료 코호트 가격·환불 정책의 제품 내 노출:** Q2 위키의 "지혜는 환불 없음" 정책을 앱 온보딩/G7 화면에 명시할지 — 영업 정보는 사용자별 리서치 기록에서만 다룬다는 ICP.md 방침과 충돌 여지.
3. **사용자 제품이 웹이 아닐 때의 G5:** Cloudflare/PostHog 웹 traffic이 없는 네이티브 앱 프로젝트의 "첫 외부 유입" 증거 표준(스토어 임프레션 캡처를 strong으로 승급할지).

## 28. Assumptions

- **A1.** Foundation Day 0–7과 program Day 1–7은 1:1 매핑(Day 0 온보딩=Day 1 onboarding 스텝)으로 통합한다. FOUNDATION_MAX_DAY_INDEX=7 변경 불필요.
- **A2.** 사용자 콘텐츠는 어떤 경우에도 agentic30 telemetry로 전송하지 않는다(기존 sanitizer 정책의 연장).
- **A3.** review cadence는 7/14/21/28 고정 유지(가변화는 later).
- **A4.** 단일 워크스페이스·단일 사용자 전제(멀티 프로젝트는 비범위).
- **A5.** 30일 시계는 멈추지 않는다 — 일시정지 기능 없음(§27-1의 늦은 pivot 제외).
- **A6.** canonical docs(ICP/GOAL/VALUES/SPEC)는 본 스펙으로 변경하지 않는다. 변경 필요 시 별도 사용자 결정.
- **A7.** 증거 보존 기한은 챌린지 종료 후에도 로컬 무기한(사용자 소유 파일).
- **A8.** Day 2+ interview 스텝의 커밋먼트 gate는 기존 GATED_INTERVIEW_STEPS 구현이 그대로 동작한다고 가정(코드상 양 스텝 지원 확인, 단 E2E 미검증).

## 29. Decision Log

| # | 일자 | 질문 | 결정 | 스펙 반영 |
|---|---|---|---|---|
| D1 | 2026-06-12 | 활성 사용자 100명 측정 기준 | **PostHog 연동 필수** — HogQL 자동 집계만 high-trust 인정 | §3.1, G4②, §15.4, AR-08~15 발동 조건 |
| D2 | 2026-06-12 | 첫 매출 인정 범위 | **결제완료+예약판매 입금** — 유료 의향은 signal로만 | §3.2, paymentRecord, G6 |
| D3 | 2026-06-12 | low-trust-only 시 gate 동작 | **핵심 gate만 하드블록+OH 회부**, 일반 Day는 경고+carry-over | §10.2/10.3, §14.3(waive 없음) |
| D4 | 2026-06-12 | OH 트리거 방식 | **시스템 선제 트리거+AI 진행**, human은 escalation만 | §13 전체 |
| D5 | 2026-06-12 | 유료 ask 의무 gate 시점 | **Day 14 review까지 1회 필수** (하드블록) | G4①, Day 14 설계, AR-13 전진 배치 |
| D6 | 2026-06-12 | mentor dashboard MVP | **PostHog 코호트 대시보드** (신규 인프라 0, 메타데이터만) | §20, §16, §13.5 escalation 큐 |

---

*이 문서는 `docs/fable5-30day-adaptive-program-prompt.md`의 Final Deliverable Contract에 따라 작성되었다. 구현 시 bridge envelope·persisted schema 변경은 Swift/sidecar 양측 동시 반영과 마이그레이션 테스트를 동반해야 한다.*

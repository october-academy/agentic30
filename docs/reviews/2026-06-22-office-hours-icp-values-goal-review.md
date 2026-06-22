# Office Hours × ICP/VALUES/GOAL — 시뮬레이션 기반 다차원 리뷰 + 개선

> **작성:** 2026-06-22 · **브랜치:** `improve/office-hours-icp-values` · **상태:** 개선 구현 + 실측 검증 완료, 일부 항목 의도적 보류

이 문서는 office-hours를 실제 sidecar로 온보딩→Day1~Day30 시뮬레이션해 제품 자체 rubric으로 채점하고, 이 프로젝트가 [ICP.md](../ICP.md)를 위한 [VALUES.md](../VALUES.md)를 제공하며 [GOAL.md](../GOAL.md)를 달성할 수 있는지 검토한 결과와 그에 따른 개선을 기록한다.

## 1. 방법 (증거 기반)

- **dogfood live eval** — `eval:dogfood:live`로 18개 시나리오를 **실제 codex provider**로 실행하고 제품 자체 6차원 judge(`sidecar-evals/dogfood-judge.mjs`: icp_fit / values_delivery / goal_alignment / actionability / evidence_use / ux_friction)로 채점. 아티팩트는 `sidecar-evals/.artifacts/`(gitignore).
- **office-hours Day-arc 라이브 하니스** — `sidecar-evals/office-hours-arc-simulation.mjs`. 온보딩 핸드셰이크 → `office_hours_start` forcing-question 루프 → `day_progress_patch` 진행 → G2/G4 게이트(block→evidence→pass). ICP 페르소나가 직접 응답. Day 1-7 연속 + Day 8 G2 + Day 15 G4 커버(`daysCovered: [1..8,15]`).
- **다차원 워크플로우** — 8개 차원 독립 리뷰 + 7개 적대적 검증(refute) 서브에이전트.
- **독립 검증** — 별도 verifier 워크플로우가 테스트를 직접 재실행하고 eval 아티팩트를 raw로 대조해 자기보고를 검증.

> **메타 발견(트랩):** 기본 `eval:dogfood`(offline stub)는 SMOKE_PASS여도 **product-value judge를 skip**한다. ICP/VALUES/GOAL 전달은 **live 모드(실 provider)에서만** 평가된다. stub green ≠ 검증됨.

## 2. 베이스라인 판정 — 세 질문

| 질문 | 판정 | 근거(baseline live) |
|---|---|---|
| ICP에 fit? | **미달** | icp_fit **4.7/10** 만성실패 |
| ICP를 위한 VALUES 제공? | 부분 | values 7.6, evidence_use 6.4. ④쉽게(ux 9.2)가 ③투명성을 희생 |
| GOAL 달성 가능? | **구조적 차단** | North Star(활성 100)가 PostHog 단일의존 fail-closed, 외부 N=0 |

**베이스라인: Run verdict JUDGE_FAIL, 평균 7.2, 13/18 PASS.**

## 3. 근본원인 (file-grounded, 적대적 검증 CONFIRMED 0.88~0.93)

- **ICP fit 4.7**: Day1 코칭이 `buildStageAwareActionPlan`(`sidecar/index.mjs`)의 **하드코딩 결정론 템플릿**이라, `context-cache.mjs`가 로드한 ICP.md 본문을 무시하고 `customerLabel = targetUser || "아직 좁히는 중인 고객 후보"` generic 폴백을 출력. office-hours specialist 프롬프트에도 ICP 5조건 항목대조 지시 없음.
- **투명성 희생**: 최고빈도 Day1 프롬프트가 `chat-route.mjs`에서 `instant_chat` fast-path로 선점돼, office-hours의 회피명명·반증 pushback이 발화되지 않음.
- **GOAL 차단**: `active-users-snapshot.mjs`가 PostHog 없으면 `source_unavailable`/`query_failed`. G5 traffic 신호는 게이트에 미배선(collector 부재). 의도적 fail-closed 설계(spec §21).

## 4. 개선 (구현 — 전부 additive)

| # | 개선 | 파일 |
|---|---|---|
| P0-1 | Day1 코칭이 **ICP.md 5조건 항목별 대조 체크리스트** 출력 + generic 대신 실명 고객 강제 + 회피 코스튬 명명. startup·builder 양쪽 | 신규 `sidecar/icp-fit-assessment.mjs` + `index.mjs` |
| P0-2 | v2 데일리 카드 **risk-based lens 선택**(spec §5.5, 단일 'offer/paid ask' 붕괴 해소). v2 eval은 Swift가 실제 렌더하는 `workpack.targetExternalAction/expectedProof`를 측정 | `program-v2-cards.mjs`, `dogfood-simulation.mjs` |
| P1 | note-only 하드증거 차단(`normalizeEvidence`가 locator 요구) + fast-path 회피 코스튬 명명 | `office-hours-memory.mjs`, `icp-fit-assessment.mjs` |
| P2 | `onboarding-hypothesis.founderIcpSignals` 필드 + 마이그레이션 | `onboarding-hypothesis.mjs` |
| 인프라 | office-hours Day-arc 시뮬레이션 정식 모듈(Day1~15 + G2/G4 게이트) | `sidecar-evals/office-hours-arc-simulation.mjs` |

## 5. 실측 (live, 제품 rubric, before → after)

| 차원 | before | after |
|---|---|---|
| **icp_fit** | 4.7 | **7.2** |
| values_delivery | 7.6 | 8.2 |
| evidence_use | 6.4 | 7.7 |
| actionability | 7.8 | 8.6 |
| **OVERALL** | 7.2 | **8.11** |

**Run verdict JUDGE_FAIL → JUDGE_PASS, 18/18 PASS.** 전체 sidecar 스위트 2043+ pass · 0 fail(회귀 0).

## 6. 의도적 보류 (제품 가치/안정성 위반 거부)

- **P0-3 (활성유저 카운트 우회)**: 가짜 카운트는 VALUES #2(증거 규율) 위반. 현 fail-closed는 멀티모델 검증된 설계(spec §21). traffic은 collector(별도 기능) 부재 → **제품 결정 사안**. 올바른 방향 = 차단을 투명화하고 수동 검증증거 경로 제공.
- **P0-4 (온보딩 scan fail-open)**: Swift(`markWorkspaceSetupScanSucceeded`) 결합 + 이전 활성퍼널 수정이 닿은 영역 → 회귀 위험. Swift+scan 공동 설계 필요.

## 7. 정직한 한계

- **외부 사용자 N=0**은 코드 개선으로 바뀌지 않는다. GOAL 달성의 진짜 게이트는 실제 고객 행동이다.
- `decision-readiness`는 여전히 FAIL — JUDGE 게이트보다 엄격한 바(시나리오별 8.0 summary target + evidence-presence 계약).
- v2 카드 측정 초기 구현은 **Swift가 렌더하지 않는 파생 필드(`userVisibleSummary`)를 judge에 먹이는 측정 게이밍**이었고, 독립 검증이 이를 잡아 **실제 렌더 필드 측정으로 교정**했다(이 문서의 P0-2는 교정본 기준).
- Day1~Day30 커버리지: arc 하니스는 Day 1-8 연속 + G2/G4(Day 15)까지 실제 게이트 전이를 구동한다. G5/G7은 stub에서 미가용한 auto-collected 소스(traffic/HogQL) 뒤에 있어 hard-block을 깨끗이 재현할 수 없다(§21 provisional). dogfood 18 시나리오는 stage 진행(empty→seeded→partial→running→complete)으로 Day0~Day30 여정을 대표한다.

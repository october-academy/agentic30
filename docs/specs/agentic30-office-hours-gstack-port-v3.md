# Agentic30 Office Hours — gstack 품질 port-on-top 개편 (SPEC v3)

> 상태: DRAFT (3중 리뷰 통과 후 구현 대기)
> 작성: 2026-06-28 · 리뷰: critic(REJECT 원안) + architect(반대 원안) + GPT-5.5 Pro(조건부 재설계)
> GOAL 프롬프트: `agentic30-office-hours-gstack-port-GOAL_PROMPT.md`

## 1. 요약

Agentic30의 office-hours를 원본 gstack의 인터뷰 품질(landscape·cross-model second-opinion·alternatives·Voice·decision-brief)로 끌어올린다. ICP는 전업 1인 개발자이고, 30일 동안 만드는 제품의 **활성 사용자 100명 + 첫 매출 달성**을 돕는다. 핵심 원칙은 **port-on-top** — 검증된 ValidationAttempt 6-state reducer를 state 단일권위로 유지하고, gstack의 부족 phase는 **상태를 소유하지 않는 pure context builder**로만 얹는다. "원본 gstack 프롬프트 교체 + state-machine 격하"는 3중 리뷰에서 기각됐다.

## 2. 확정 결정

| 축 | 결정 |
|---|---|
| 아키텍처 | **port-on-top** — ValidationAttempt(`office-hours-contract.mjs`)가 state 단일권위. gstack phase는 context builder(state owner 아님) |
| 증거 | 인터뷰 톤만 부드럽게(self-report는 memory 기록). 진행/달성은 **통일된 hard-evidence semantics**(§8)로만. self-report 0점 차별화는 전 gate 일관 |
| 회차 | 매일 — 단 **state phase는 Day1 잠금 / effector phase(context만)는 매일** |
| 모드 | 단일 OA Partner (Startup/Builder 게이트 제거, 비즈니스 검증 + 빌더 톤) |
| 목표 | 기존 3종 단일 잠긴 정량 목표 유지(`day1-goal-state.mjs`) |
| 산출물 | 매 회차 실행 워크팩 + 30일 누적 builder-journey |
| 종료 | OA Partner plea + Agentic Garage(`luma.com/agentic_garage?period=past`) + blog(`agentic30.app/blog`) + builder-journey |
| 메모리 | office-hours-memory(compiledTruth+timeline), calibration-lite, Day 누적 |
| 페르소나 | 한국어, OA Partner, Voice 룰(em dash·AI어휘 금지), Claude=decision-brief / Codex=agentic30_request_user_input |
| 외부맥락 | Founder Replay(recorder)·morning-briefing·news-market-radar·exa·deepwiki·WebSearch — 전부 **host precomputed context로 주입** |
| 프로바이더 | Claude+Codex+Gemini+Cursor(+Antigravity P2) + cross-model second-opinion |

## 3. 3중 리뷰가 기각/교정한 것 (코드 입증)

### 원안 기각 (critic + architect)
- **P0-1**: office_hours_question 모드는 AskUserQuestion 외 모든 툴 차단(`provider-runner.mjs:932`). gstack landscape/second-opinion/doc-write 재현 불가.
- **P0-2**: ValidationAttempt가 현 runtime authority(`index.mjs:491/5839/13069`, `contract.mjs:7-13`). 격하 시 6카드 사망 + evidence 흔적기관화 + 과거 8 cycle 버그 재발.
- **P0-3**: 증거 완화 시 Day1~20 하드게이트 0개 → 본인 active commitment(self-report 0) 위배.

### synthesis 교정 (GPT-5.5 Pro — 이번 SPEC에 반영)
- **C-1 (주입 위치)**: `specialist-router.mjs:146-157` — vendorReady면 `selection.promptText`를 **버림**. 따라서 gstack 품질을 `specialists/office-hours.mjs`에 주입하면 vendor provider에서 **no-op**. → `buildOfficeHoursChatSystemPrompt` 공통 context 경로에 주입(`office-hours-memory.mjs:690-693`가 이미 같은 이유로 채택한 패턴).
- **C-2 (관찰 환각)**: `specialists:65-67`의 "워크스페이스 훑어라"는 툴 차단 모드에서 환각 유도. → "주입된 관찰만 사용".
- **C-3 (Day2+ 역류)**: "재질문 금지"는 goal reselect 금지일 뿐, active-user-def 없으면 재질문 허용(`chat-prompt.mjs:236-249`). effector가 질문을 만들면 Day1 슬롯 복구로 역류. → **effector는 질문 생성 금지**.
- **C-4 (두 hard)**: "action_proof 유지 = applyHardEvidenceGate 유지"는 거짓. ValidationAttempt refs는 `office_hours_attempt`로만 투영돼 strong gate 불만족(`evidence-state.mjs:505-516`). → §8 통일표.
- **C-5 (second-opinion 운영)**: `isolated_read_only`는 API-key-only(`provider-runner.mjs:2948-3003`)라 로컬 로그인 사용자에게 조용히 꺼짐. → `judge_read_only` + strict JSON + fail-open.

## 4. 현 자산 맵 (재사용)

| 자산 | file:line | 역할 |
|---|---|---|
| ValidationAttempt reducer | `office-hours-contract.mjs:36-60,403-463,677-710` | 6-state 단일 state writer, `nextLadderSignal` |
| 시스템 프롬프트 합성 | `office-hours-chat-prompt.mjs:79-86,236-265` | **gstack 주입 지점(C-1)**, Day2+ rules |
| memory context 주입 | `office-hours-memory.mjs:690-693` | C-1 선례(promptText 대신 context) |
| evidence judge | `office-hours-evidence-judge.mjs:21-95,210-224` | docs canonical gate(C-4 분리 대상) |
| evidence state | `office-hours-evidence-state.mjs:439-516` | hard evidence 판정(C-4/C-5 통일 대상) |
| program gate | `program-gate-engine.mjs:78-138` | G1/G2/G4/G5/G6/G7 milestone |
| second-opinion 선례 | `office-hours-evidence-judge.mjs:110-140` + `provider-runner.mjs:3478-3484` | judge_read_only 동기 서브콜 패턴(C-5) |
| landscape | `news-market-radar.mjs:290,361` + `exa-mcp-discovery.mjs` | 캐시 재사용 |
| 외부맥락 | `auth-context.mjs:53`(recorder), `morning-briefing.mjs` | Phase1 context |

## 5. 아키텍처 원칙 — port-on-top + effector-as-context-builder

```
reducer owns STATE   — office-hours-contract.mjs (단일 state writer)
prompt  owns COPY    — gstack 질문/Voice/decision-brief (visible card text)
host    owns EFFECTS — buildOfficeHoursEffectorContext() pure function
```

- **신규 `office-hours-effector-context.mjs`** (orchestrator 아님): `buildOfficeHoursEffectorContext({ day, attempt, memory, digest, docsFingerprint })` → landscape/second-opinion/alternatives 결과를 **read-only context로만** 반환. **질문도 상태도 만들지 않는다.**
- 질문 순서·진행·완료는 **오직** `nextLadderSignal`/`cardDefinition`/`reduceValidationAttempt`(`contract.mjs`)만.
- `specialist-router.mjs`(순수 string composer)·`buildPrompt`(순수)는 그대로. gstack 품질은 `buildOfficeHoursChatSystemPrompt`의 공통 rules/context에 주입(C-1).

## 6. 단일 OA Partner 모드
gstack Startup/Builder 모드 선택 게이트 제거. 내용은 Startup식 6 forcing questions(이미 `specialists:24-30`), 톤은 빌더 친화. 캐논 질문 세트 1개로 고정.

## 7. Phase 1~6 (state/effector 분리)

| gstack Phase | 분류 | 배선 |
|---|---|---|
| 1 Context (goal/mode/stage) | **state** | Day1 잠금. Day2+ `buildDay1GoalProjectContext` 재주입. 외부맥락은 host precomputed context |
| 2 6 forcing questions | **interview** | 매일, ValidationAttempt 슬롯 진행에 종속. 질문 텍스트만 gstack 주입 |
| 2.75 Landscape | **effector(context)** | 매일, 하루1회 캐시. context만, 질문 금지 |
| 3.5 Second-opinion | **effector(context)** | judge_read_only, contested premise시만, fail-open(§10) |
| 4 Alternatives | **effector(context)** | context로 제시, 카드 선택은 reducer |
| 5 워크팩 | **output** | 매일 실행 워크팩 |
| 6 Handoff | **output** | OA Partner plea + Agentic Garage + blog + builder-journey |

★ C-3 불변식: **effector phase는 structured-input 질문을 생성할 수 없다.** Day2+ 질문은 `nextLadderSignal` + card allowlist에서만 나온다. low-confidence Day1 context 보완조차 effector가 질문화하지 않는다.

## 8. 증거 모델 — hard-evidence semantics 통일표 (C-4/C-5)

기존 코드의 **서로 다른 두 "hard"를 단일 표로 고정**한다. 어떤 증거가 어떤 gate를 만족하는지:

| 증거 종류 | sourceType | memory commitment(`met`) | docs canonical(`applyHardEvidenceGate`) | program gate(G*) |
|---|---|---|---|---|
| memory locator(url/screenshot/commit/payment) | — | ✅(`memory.mjs:52-54`) | locator 결합 시 ✅ | — |
| office_hours_turn nextIntent=payment/purchase | office_hours_turn | ✗(locator 없음) | early-cycle ✅ → **locator 결합 필수(C-5)** | — |
| ValidationAttempt action_proof(캡처) | office_hours_attempt | ✗ | **현재 ✗** → Day1 close 전용으로 명시 분리(C-4) | — |
| proof_ledger strong payment | proof_ledger | ✅ | past-early-cycle 필수 | G6 |
| active_user snapshot | — | — | — | G5 |

규칙: **self-report(locator 없는 note)는 어느 gate에서도 0점**(전 gate 일관, C-5/P1-2). early-cycle docs gate도 nextIntent만으로 통과 금지 — freeText locator 또는 proof-ledger/commitment locator 결합 필수. judge 결과는 `docQualityPassed`/`canonicalizationAllowed`/`hardEvidenceSatisfied` 3필드로 분리(P1-1)하여 "문서는 좋은데 증거 없음"과 "문서 자체 미달"을 구분.

## 9. gstack 품질 주입 위치 (C-1)
- Voice 룰(em dash·AI어휘 금지) + AskUserQuestion decision-brief 포맷(D/ELI10/Completeness/✅❌/Net) + 6 forcing questions 텍스트 → **`buildOfficeHoursChatSystemPrompt` 공통 rules/context**에 주입. (vendor SKILL이 있으면 `specialists` promptText가 버려지므로 그 경로엔 의존하지 않음.)
- Codex는 `agentic30_request_user_input` 채널.

## 10. Second-opinion (C-5 + P1-5)
- `judge_read_only` 실행모드(`provider-runner.mjs:3478`) + strict JSON schema(steelman/strongest-signal/wrong-premise/48h-prototype) 동기 서브콜. 패턴은 `office-hours-evidence-judge.mjs:110-140`.
- **절대** `session.pendingUserInput`/`runtime` 미변경(two-writer 방지).
- 반대 provider 선택(Claude↔Codex), 사용자 동의 게이트("이 세션 기억" 옵션).
- **fail-open**: 실패/quota/auth(`isProviderUsageLimitError`/`isProviderAuthRequiredError`) 시 Office Hours 진행을 막지 않고 context에 `secondOpinion:{status:"unavailable"}` + debt에 `second_opinion_unavailable` 기록.

## 11. 멀티호스트
Claude/Codex/Gemini/Cursor는 기존 배선 확장. **Antigravity는 P2 후반** — SDK 미지수라 second-opinion 보조 호스트로 격리, structured-output 검증 후에만 질문 생성 자격 부여. critic 권고로 분리 가능성 열어둠.

## 12. 메모리 / builder-journey
office-hours-memory(compiledTruth+timeline)·calibration-lite·Day 누적 유지. builder-journey는 `daily-office-hours-digest.mjs` + gstack 4-tier(introduction/welcome_back/regular/inner_circle)·Phase4.5 signal synthesis·resource dedup 차용. YC plea→OA Partner plea + Agentic Garage 교체.

## 13. Voice / decision-brief
§9 참조. gstack Voice 섹션 + decision-brief 포맷을 공통 경로에 주입.

## 14. 비용 관리
landscape 하루1회 캐시(`news-market-radar.mjs:290,361`) · second-opinion contested premise시만+동의게이트+fail-open · spec-review 문서 fingerprint 변경시만(max 3 iter+convergence guard) · Day당 provider 호출 상한, 예산 초과시 second-opinion부터 강등.

## 15. 구현 단계
- **P0** — gstack 품질을 **공통 context 경로**에 주입(C-1) + "주입 관찰만 사용"으로 프롬프트 교정(C-2) + 단일 OA Partner + Phase6 handoff 교체. 검증: `npm run test:sidecar`, `npm run sim:office-hours`.
- **P1** — `office-hours-effector-context.mjs`(state owner 아님) + landscape/second-opinion(judge_read_only/fail-open)/외부맥락(deepwiki) + hard-evidence 통일표(C-4/C-5) 구현 + judge 3필드 분리(P1-1). 검증: test:sidecar + second-opinion/two-writer 회귀 + arc-simulation.
- **P2** — 멀티호스트 5종 + Antigravity(격리) + 비용 가드레일. 검증: test:sidecar 전량 + eval:dogfood:gate.

## 16. Risks
- effector가 질문을 만드는 경로가 하나라도 남으면 Day2+ 역류(C-3). 핀 테스트: Day2+ effector 실행이 새 structured-input 카드를 만들지 않는지.
- hard-evidence 통일표가 기존 테스트(evidence-judge/state/memory/contract)와 충돌 가능 — 회귀 전수.
- daily card(office_hours_state_transition/agent_workpack)가 reducer/memory event로 귀결되지 않으면 병렬 권위(P1-3). 핀 테스트.
- Antigravity SDK 미지수 — P2 격리, 실패 시 분리.

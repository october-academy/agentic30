# Agentic30 Office Hours — Day-1 get_users: host-card 제거 + LLM 카드 전환 (SPEC v1)

> 상태: DRAFT (founder 결정 승인 완료, 구현 대기)
> 결정 근거/승인: `agentic30-office-hours-day1-llm-cards-DECISION.md`
> GOAL 프롬프트: `agentic30-office-hours-day1-llm-cards-GOAL_PROMPT.md`
> 이 SPEC은 `agentic30-office-hours-gstack-port-v3.md`의 port-on-top·state-machine 보존 원칙을 **폐기**한다.

## 1. 요약

목표는 **build_product / get_users / make_money 셋 다 동일하게 host 하드코딩 카드 없는 LLM 생성 office-hours 카드 흐름**을 타게 하는 것이다.

실제 작업은 **get_users 전용**이다 — 세 목표 중 **get_users만** host-card 시스템 + R1.b ValidationAttempt/A′ 하드증거 엔진으로 특수화돼 있고, **make_money / build_product는 이미 LLM locked-goal 경로**를 쓴다(host/value-wedge 카드·attempt 레인 없음, 검증: index.mjs grep 0; chat-prompt.mjs의 목표별 프롬프트 룰 232/249/255만 사용). 따라서 get_users의 host-card/R1.b 특수 레인을 제거하면 세 목표가 동일 경로로 통일된다. 카드 COPY/순서는 `buildOfficeHoursChatSystemPrompt`의 ladder 룰(get_users는 208-227, 이미 존재)로 LLM이 생성한다. value-wedge default-submit 첫 카드("추천안으로 진행")는 제거되고 LLM 인터뷰로 대체된다. **make_money/build_product는 변경하지 않는다(통일의 목적지).**

## 2. 핵심 통찰 (linchpin)

`prepareOfficeHoursStructuredInputRequestForSession`(index.mjs ~12212)의 게이트:
```js
if (!isLockedDay1GetUsersContext(context)) {
  return prepareOfficeHoursStructuredInputRequest(request);   // ← 비-get_users가 쓰는 LLM 생성 카드 처리 경로
}
// else: host-card / attempt 엔진 (제거 대상)
```
`prepareOfficeHoursStructuredInputRequest`(generic, "ForSession" 없는 것)가 LLM 생성 카드를 처리하는 경로다. get_users를 이 generic 경로로 보내면 host 엔진이 우회된다. make_money/build_product가 이미 이 경로를 쓴다.

## 3. 자산 맵 — 삭제 대상 (get_users/R1.b 전용)

| 자산 | file:line | 비고 |
|---|---|---|
| host 카드 emission | index.mjs `attachLockedGetUsersNextAttemptCard`(def 12167, 호출 2523/11382/13030) | 3 방출 사이트 |
| host 카드 spec/빌더 | index.mjs `buildLockedGetUsersHostCard`(12106), `lockedGetUsersHostCardSpec`(11836), `officeHoursLockedGetUsersSignalLabel`(11800), `lockedGetUsersVisibleDimension`(11819) | 하드코딩 카드 COPY |
| attempt 레인 진입 | index.mjs `ensureOfficeHoursAttemptForSession`(def 9926, 호출 8), `prepareOfficeHoursStructuredInputRequestForSession`(12212 게이트 12220), `stampLockedGetUsersAttemptProjection`, `isDurableLockedGetUsersLane`(11791), `workspaceHasOpenGetUsersAttempt`(10020) | |
| get_users 분기 | index.mjs `isLockedDay1GetUsersContext`(def 11777, 분기 17곳) | 분기별로 generic 경로로 흡수 |
| ValidationAttempt store | `office-hours-attempt-store.mjs` (startAttempt/commitAttemptEvent/supersedeAnswer/projectAttempt/markPosted/pendingDeliveries) | R1.b 권위 |
| ValidationAttempt reducer | `office-hours-contract.mjs` (reduceValidationAttempt/nextAttemptAction/cardDefinition/canonicalCardForSignal/isAcceptableDay1Close/VALIDATION_ATTEMPT_ACTIVE_STATES) | ★cross-goal 소비 grep 후 삭제 |
| A′ 증거 영수증 | `office-hours-evidence-coordinator.mjs`/`-ingress.mjs`/`-binding.mjs`/`-policy.mjs`, `office-hours-artifact-registry.mjs` | attempt 증거 receipt |
| first-candidate | `office-hours-first-candidate-host.mjs`, `office-hours-first-candidate-grounding.mjs` | get_users 전용 |
| outcome-capture 펀널 | `office-hours-funnel.mjs` (emitOfficeHoursFunnelEvent/TRANSITION_TO_FUNNEL_STAGE, index.mjs:516 import) | ★cross-goal 여부 grep 후 결정 |
| import 블록 | index.mjs:492-536 | 위 모듈 import 정리 |

## 4. 자산 맵 — 보존 (전 목표 공유, 삭제 금지)

| 자산 | 이유 |
|---|---|
| `buildOfficeHoursChatSystemPrompt` + get_users ladder 룰 (chat-prompt.mjs:208-227) | LLM이 get_users 카드를 생성하는 근거 — 핵심 보존 |
| gstack-port P0/P1 작업 (Voice/decision-brief/effector-context/-host/builder-journey) | LLM 카드 품질을 구동. 이번 변경과 보완 관계 |
| `office-hours-evidence-state.mjs` `officeHoursEvidenceHasHardEvidence` + `office-hours-evidence-judge.mjs` | **docs canonical 게이트는 전 목표 공유** — 삭제 금지. 단 `normalizeAttemptEvidenceRefs`(attempt 투영)는 get_users 전용이라 제거 |
| `day1-goal-state.mjs`, `program-gate-engine.mjs` | reuse-only |
| make_money / build_product locked-goal LLM 경로 | 이미 동작 — get_users가 합류할 목적지 |

## 5. 구현 단계 (한 번에 제거 후 일괄 수정)

- **P0 진입점 reroute**: `prepareOfficeHoursStructuredInputRequestForSession`를 generic으로 축약(이미 1회 검증됨, 이번 세션 원복). 3 방출 사이트(2523/11382/13030)와 initiate(runOfficeHours)에서 host-attach 제거 → LLM provider run으로 흐르게.
- **P1 attempt 연동 제거**: 8개 `ensureOfficeHoursAttemptForSession` 호출 + answer-commit(answeredGenerationAttemptId/commitAttemptEvent) + resume 복원 + 17개 `isLockedDay1GetUsersContext` 분기 정리. get_users 답변을 일반 office-hours turn(office-hours-turns)으로 기록.
- **P2 모듈 삭제**: §3 모듈 삭제(각 모듈 cross-goal 소비 `grep -rn` 후). import 블록 정리. evidence-state의 attempt 투영만 제거.
- **P3 테스트/Swift**: 의존 테스트 제거·갱신(office-hours-attempt-evidence / office-hours-contract / evidence-state get_users 부분 / specialist-router / structured-input / day1-icp-conversation / request-emit), Swift stub(AgenticViewModel.swift:12352-12598 host 카드, ContentView.swift:9239 "추천 실행안") 정리.

## 6. 검증 (단계별 + 최종)

- 각 단계 후 `node --check sidecar/index.mjs`, 단계 묶음 후 `npm run test:sidecar`로 깨짐 일괄 수정.
- 최종: `npm run test:sidecar` 그린, `npm run sim:office-hours` 완주(get_users가 host 카드 0으로 LLM ladder 진행), Swift unit 그린.
- 핀: 모든 office-hours 카드 생성이 `buildOfficeHoursChatSystemPrompt` 경로 경유(get_users host 카드 grep 0). make_money/build_product 회귀 없음.
- 핀(goal-agnostic): **build_product / get_users / make_money 세 목표 각각** sim에서 locked Day-1 첫 카드가 host 카드 0으로 LLM ladder 진행, 셋 다 동일 generic 경로(`prepareOfficeHoursStructuredInputRequest`)로 합류. 목표별 chat-prompt 룰(232 weakest-evidence / 249 make_money / 255 build_product / 208-227 get_users)이 적용됨.

## 7. Risks

- **★증거 무결성 소멸**: 하드증거 게이트(receipt/ValidationAttempt) 제거로 self-report가 통과 가능(DECISION §3-1, 승인됨). docs canonical 게이트(evidence-judge)는 보존되나 attempt 기반 강제는 사라짐.
- **cross-goal 오삭제**: contract/funnel/evidence-state가 make_money/build_product에도 쓰이면 삭제 시 회귀. **삭제 전 각 심볼 consumer grep 필수.**
- **LLM 카드 신뢰성 회귀**: prompt-driven 카드 생성의 8-cycle 불안정성 재도입 가능(redesign 회귀). sim/실사용으로 ladder 6슬롯 진행 확인.
- **Swift 디코더**: host 카드 envelope 제거가 Swift 디코더(SidecarEventDecoding/ChatMessageDecoding)와 어긋나지 않는지 — generation.mode office_hours_inline 제거 영향 확인.
- 거대 blast radius(index.mjs 17+ 분기) — 함수 단위로 순차 제거, 단계마다 test:sidecar.

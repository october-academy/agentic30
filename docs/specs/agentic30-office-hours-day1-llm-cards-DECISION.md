# DECISION — Day-1 get_users: A′ 증거 엔진 폐기 + LLM 생성 카드 전환

> 상태: 결정됨 (founder 명시 승인, 2026-06-29)
> 이 문서는 `agentic30-office-hours-gstack-port-v3.md`의 port-on-top·state-machine 보존 원칙을 **폐기(supersede)**한다.
> 4차 확인 후 founder가 "A′ 증거 엔진 자체 폐기"를 선택했고, 그 결과(아래 §3)를 인지·승인함.

## 1. 결정

Day-1 get_users 흐름의 **host-card 시스템 + A′ ValidationAttempt 하드증거 outcome-capture 엔진을 전부 제거**하고, get_users를 make_money / build_product와 동일하게 **LLM 생성 office-hours 카드 경로**(`buildOfficeHoursChatSystemPrompt`의 get_users ladder 룰)로 전환한다.

실행 방식: **한 번에 전부 제거 후 일괄 수정** (founder 선택). 작업 브랜치 `office-hours-remove-host-cards`.

## 2. 제거 대상 (R1.b 엔진 전체)

- `sidecar/office-hours-attempt-store.mjs` — startAttempt / commitAttemptEvent / supersedeAnswer / projectAttempt / markPosted / pendingDeliveries
- `sidecar/office-hours-contract.mjs` — ValidationAttempt reducer, nextAttemptAction, cardDefinition, canonicalCardForSignal, isAcceptableDay1Close, VALIDATION_ATTEMPT_ACTIVE_STATES (※ 이 reducer 소비가 사라지므로 모듈 폐기 또는 비배선)
- A′ 증거 영수증 시스템 — `office-hours-evidence-coordinator` / `-ingress` / `-binding` / `-policy`, `office-hours-artifact-registry`
- `sidecar/office-hours-funnel.mjs` — outcome-capture 펀널 (emitOfficeHoursFunnelEvent / TRANSITION_TO_FUNNEL_STAGE) ※ get_users 경로 한정 호출 제거
- `sidecar/office-hours-first-candidate-host.mjs`, `sidecar/office-hours-first-candidate-grounding.mjs`
- `sidecar/index.mjs` — `isLockedDay1GetUsersContext` 특수 레인 ~30곳, `buildLockedGetUsersHostCard`, `lockedGetUsersHostCardSpec`, `attachLockedGetUsersNextAttemptCard`, `ensureOfficeHoursAttemptForSession`, `stampLockedGetUsersAttemptProjection`, `officeHoursLockedGetUsersSignalLabel`, `lockedGetUsersVisibleDimension` 및 attempt/receipt/funnel 연동
- 의존 테스트 (attempt-evidence / contract / first-candidate / structured-input 일부) + Swift stub (`AgenticViewModel.swift`의 get_users host 카드 미러)

## 3. 인지·승인된 결과 (founder 명시)

1. **하드증거 게이트 제거**: get_users 달성/진행이 더 이상 receipt·ValidationAttempt로 강제되지 않는다. self-report(locator 없는 note)가 카드 흐름을 통과할 수 있게 된다. 메모리의 active commitment(self-report 0점·캡처/입금만)·`project_office_hours_outcome_capture_strategy`(instrumented execution system)와 **정면 충돌하는 의도된 방향 전환**.
2. **gstack-port-v3 SPEC 무효화**: port-on-top / "ValidationAttempt state-machine 격하·삭제 금지" NON-GOAL, P0-2(state 단일권위)·P0-3(하드게이트) 폐기.
3. **redesign 회귀**: `project_office_hours_fundamental_redesign`(프롬프트-driven 불안정→state-machine 전환)을 되돌리므로, 과거 8-cycle 카드생성 불안정성이 재도입될 수 있다.
4. **메모리 갱신 필요**: `project_gstack_port_v3_impl`, `project_first_interview_evidence_gate`, `project_evidence_redesign_review`, `project_office_hours_fundamental_redesign`, `project_office_hours_outcome_capture_strategy`, `project_woz_aipush_test`(active commitment)의 evidence-gate 전제가 이 결정으로 바뀜.

## 4. 새 방향

- get_users도 locked Day-1 goal LLM 경로(`runOfficeHours` → `runProviderStream` → `buildOfficeHoursChatSystemPrompt`)를 탄다. 카드는 프롬프트의 get_users ladder 룰(active-user-definition → first_candidate → current_alternative → today_request → evidence_format → day1_commitment)로 **LLM이 생성**한다.
- **보존**: gstack-port P0/P1 프롬프트 품질(Voice/decision-brief/effector context/ladder 룰) — 이제 LLM 카드 생성을 구동하는 보완재로 유지.
- 답변은 일반 office-hours turn 기록(office-hours-turns / evidence-state)으로. (단 §3-1대로 하드증거 강제는 사라짐.)
- value-wedge default-submit 첫 카드(`추천안으로 진행`)는 제거되고, LLM 인터뷰 깊이로 대체.

## 5. 새 성공판정

- `npm run test:sidecar` 그린 (R1.b/A′ 증거 엔진 테스트 제거·갱신 후).
- `npm run sim:office-hours` 완주: get_users가 host 카드 없이 LLM ladder로 Day-1 6슬롯 진행.
- Day-1 get_users 카드가 `buildOfficeHoursChatSystemPrompt` 경로에서 생성됨(host 카드 0).
- Swift unit 그린.

## 6. 후속 미결

- 증거 무결성을 이후 어떻게(혹은 여부) 다시 보장할지는 별도 결정. 본 결정은 "하드증거 강제 제거"까지만 포함.

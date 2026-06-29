# GOAL — Day-1 get_users: host-card 제거 + LLM office-hours 카드 전환

> SPEC: `agentic30-office-hours-day1-llm-cards-v1.md`
> 결정 근거: `agentic30-office-hours-day1-llm-cards-DECISION.md`
> 새 세션에서 이 문서를 `/goal`로 설정해 실행한다. 작업 브랜치: `office-hours-remove-host-cards`.

## 무엇을 만드나

**build_product / get_users / make_money 어떤 목표를 선택하든**, Day-1 office-hours가 동일하게 **host 하드코딩 카드 없이 LLM이 `buildOfficeHoursChatSystemPrompt`로 생성하는 office-hours 카드 흐름**을 타게 한다.

현재 상태: **get_users만** host가 결정적으로 찍어내는 하드코딩 카드(value-wedge default-submit "추천안으로 진행" 첫 카드 포함) + R1.b ValidationAttempt/A′ 하드증거 엔진으로 특수화돼 있다. **make_money / build_product는 이미 LLM 경로**(host/value-wedge 카드·attempt 레인 없음, grep 0; chat-prompt.mjs:232/249/255의 목표별 프롬프트 룰만 사용). 따라서 **get_users의 host-card/R1.b 특수 레인만 제거**하면 세 목표가 동일한 LLM office-hours 경로로 통일되고, 셋 다 gstack 인터뷰 품질(Voice/decision-brief)을 갖는다. make_money/build_product는 변경하지 않는다(통일의 목적지).

## 측정 가능한 목표 (정량)

- Day-1 get_users 카드가 전부 `buildOfficeHoursChatSystemPrompt` 경로(LLM 생성)에서 나온다. `sidecar/`에서 host get_users 카드 빌더(`lockedGetUsersHostCardSpec`/`buildLockedGetUsersHostCard`/`buildCanonicalFirstCandidateCard`) 참조 = 0.
- get_users가 make_money/build_product와 동일한 generic 경로(`prepareOfficeHoursStructuredInputRequest`)로 합류한다. `isLockedDay1GetUsersContext` 특수 분기 = 0(또는 LLM 경로 흡수).
- R1.b/A′ get_users 전용 모듈 삭제: `office-hours-attempt-store` / `office-hours-contract`(reduceValidationAttempt) / `office-hours-evidence-coordinator·-ingress·-binding·-policy` / `office-hours-artifact-registry` / `office-hours-first-candidate-host·-grounding`. (cross-goal 소비 grep 후 삭제.)
- value-wedge default-submit 첫 카드 제거 — get_users 첫 카드가 LLM 인터뷰 카드로 대체된다.

## 하지 않는 것 (Non-goals)

- make_money / build_product locked-goal 경로를 바꾸지 않는다 — get_users가 그 경로에 합류할 뿐이다.
- 전 목표 공유 자산을 삭제하지 않는다: `buildOfficeHoursChatSystemPrompt`+get_users ladder 룰, `office-hours-evidence-state`의 `officeHoursEvidenceHasHardEvidence` + `office-hours-evidence-judge`(docs canonical 게이트), `day1-goal-state`, `program-gate-engine`. (단 evidence-state의 attempt 투영 `normalizeAttemptEvidenceRefs`는 get_users 전용이라 제거.)
- gstack-port P0/P1 프롬프트 작업(Voice/decision-brief/effector-context/-host/builder-journey)을 되돌리지 않는다 — LLM 카드 생성을 구동하는 보완재로 유지한다.
- 증거 무결성을 새로 설계하지 않는다 — 본 GOAL은 "하드증거 강제(receipt/ValidationAttempt) 제거"까지만. 이후 보장 방식은 별도 결정. (★self-report가 통과 가능해짐을 인지·승인함.)

## 페르소나 / 언어

한국어. October Academy(OA) Partner. Voice 룰: em dash 금지, AI 어휘 금지. Claude=AskUserQuestion, Codex=agentic30_request_user_input. (gstack-port에서 주입된 Voice/decision-brief가 LLM 카드에 적용된다.)

## 성공 판정 (Success Criteria)

- `npm run test:sidecar` 전량 통과 (삭제된 R1.b/A′ get_users 테스트 제거·갱신 후).
- `npm run sim:office-hours` arc 완주: get_users가 host 카드 0으로 LLM ladder(active-user-definition → first_candidate → current_alternative → today_request → evidence_format → day1_commitment) Day-1 6슬롯을 진행.
- **핀 테스트**: (a) `sidecar/`에 get_users host 카드 빌더 참조 0, (b) get_users 카드가 `prepareOfficeHoursStructuredInputRequest`(generic) 경로 경유, (c) make_money/build_product 흐름 회귀 없음(기존 테스트 그린), (d) Swift unit 그린(host 카드 stub 제거 반영), (e) **build_product/get_users/make_money 세 목표 각각** locked Day-1 첫 카드가 host 카드 0으로 LLM 경로에서 생성되고(목표별 chat-prompt 룰 적용), 세 목표가 동일한 generic 경로로 합류한다.
- `node --check sidecar/index.mjs` 통과, import 잔여 dead 심볼 0.

## 종료

작업 브랜치 그린(test:sidecar + sim:office-hours + Swift unit) + 변경 요약. 커밋/PR은 요청 시. main 릴리즈는 worktree 격리 권장. 메모리 갱신: `project_gstack_port_v3_impl`·`project_first_interview_evidence_gate`·`project_office_hours_outcome_capture_strategy`·`project_office_hours_fundamental_redesign`·`project_woz_aipush_test`의 evidence-gate 전제를 본 결정으로 갱신.
```text
이 명령은 founder 핵심 Day-1 엔진(R1.b ValidationAttempt/A′ 하드증거)을 제거합니다. 진행 전 DECISION 문서의 §3 인지·승인된 결과를 재확인하세요.
```

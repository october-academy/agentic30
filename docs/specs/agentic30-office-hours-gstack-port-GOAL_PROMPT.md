# GOAL — Agentic30 Office Hours gstack 품질 port-on-top 개편

> SPEC: `agentic30-office-hours-gstack-port-v3.md`
> office-hours-docs 스타일(측정 가능 목표·non-goals·성공 판정)

## 무엇을 만드나

전업 1인 개발자(ICP)가 30일 동안 만드는 제품으로 **활성 사용자 100명과 첫 매출**을 달성하도록 돕는 매일형 OA Partner office-hours를, 원본 gstack의 인터뷰 품질(landscape·cross-model second-opinion·alternatives·Voice·decision-brief)로 끌어올린다. 검증된 ValidationAttempt state-machine을 권위로 유지한 채(**port-on-top**) gstack 품질을 얹는다. 매 회차 실행 워크팩과 30일 누적 builder-journey를 산출한다.

## 측정 가능한 목표 (정량)

- 단일 잠긴 정량 목표 1개 유지 (make_money | get_users | build_product). Day1에 잠그고 Day2+ 재선택 금지.
- gstack의 부족 phase(landscape·second-opinion·alternatives)를 **매일** 사용자에게 제공하되, **질문 생성·상태 전이는 ValidationAttempt reducer/card contract로만** 통과한다(effector는 context만 생성).
- "활성 100명/첫매출 달성" 선언은 **통일된 hard-evidence semantics**(SPEC §8)로만 판정한다. self-report(locator 없는 note)는 **어느 gate에서도 0점**으로 일관한다.
- 매 회차 실행 워크팩(외부행동 계약 + 기대증거 슬롯) 1개를 닫는다.
- second-opinion은 `judge_read_only` 동기 서브콜로 부르고, 실패 시 **fail-open**(Office Hours 진행을 막지 않고 debt에 `second_opinion_unavailable` 기록)한다.

## 하지 않는 것 (Non-goals)

- 원본 gstack 프롬프트로 `specialists/office-hours.mjs`를 **교체하지 않는다** (3중 리뷰 기각).
- ValidationAttempt state-machine을 **격하/삭제하지 않는다** — state 단일권위로 유지한다.
- 신규 모듈을 **state owner로 만들지 않는다** — `office-hours-effector-context.mjs`는 pure context builder다.
- gstack 품질을 `specialists/office-hours.mjs`에 주입하지 않는다 — vendor provider에서 버려지므로(`specialist-router.mjs:146-157`) `buildOfficeHoursChatSystemPrompt` 공통 경로에 주입한다.
- office_hours_question 모드 프롬프트에 "워크스페이스를 훑어라"를 남기지 않는다 — 모든 관찰은 host precomputed context로만 주입한다.
- gstack의 Startup/Builder 모드 선택 게이트를 두지 않는다 (단일 OA Partner).
- YC / Garry Tan plea를 쓰지 않는다 (OA Partner plea + Agentic Garage 권유).

## 페르소나 / 언어

한국어. October Academy(OA) Partner. Voice 룰: em dash 금지, AI 어휘(delve/robust/comprehensive 등) 금지. Claude=AskUserQuestion decision-brief(D/ELI10/Completeness/✅❌/Net), Codex=agentic30_request_user_input.

## 성공 판정 (Success Criteria)

- `npm run test:sidecar` 전량 통과 (office-hours-* · contract · evidence-judge · evidence-state · memory · program-gate · day1-goal · specialist-router).
- `npm run sim:office-hours` arc가 Day1 풀 state 잠금 + Day2+ 경량 state + 매일 effector(context)를 완주.
- **회귀 핀 테스트**: (a) self-report만으로는 어느 gate도 달성을 통과시키지 않는다, (b) Day2+ effector 실행이 새 structured-input 카드를 만들지 않는다(C-3 역류 방지), (c) second-opinion 서브콜이 `session.pendingUserInput`을 건드리지 않는다(two-writer), (d) daily card(state_transition/agent_workpack)가 reducer/memory event로 귀결된다.
- 매일 effector Day당 provider 호출이 비용 가드레일 이내.

## 종료 (Phase 6)

OA Partner plea + Agentic Garage 참여 권유(`luma.com/agentic_garage?period=past`) + builder 리소스(`agentic30.app/blog`) + builder-journey 누적 문서(gstack 4-tier 차용).

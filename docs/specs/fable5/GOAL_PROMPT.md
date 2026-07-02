# GOAL PROMPT - Agentic30 Fable5 MVP

`/Users/october/prj/agentic30-public`에서 Claude Fable 5 계획 run을 소유한다.

Agentic30 MVP를 greenfield로 만든다. 현재 앱을 refactor하지 않는다. target이 없으면 `fable5-mvp/`를 만든다. 무관한 변경은 덮어쓰지 않는다. 현재 코드는 UX benchmark다.

먼저 읽는다: `docs/specs/fable5/{README,VALUES,GOAL,ICP,USER_STORIES,SPEC,TODO}.md`, 이후 root/nested `AGENTS.md`. 현재 코드를 볼 때는 CodeGraph를 먼저 쓴다. source는 `SPEC.md`의 UX anchor 확인에만 읽는다.

## 범위

아래만 납품한다.

```text
Onboarding -> Project Scan -> Day 1-3 Interview -> Founder Replay
```

범위 밖: Day 4+, revenue/payment/proof/Evidence Inbox, Morning Briefing/Strategy/Reference, outreach/deploy/payment mutation, multi-workspace, non-macOS.

현재 native 느낌은 보존한다: token, brand, rail, compact interview tooling, Founder Replay `Replay/Table/Control/Pipes`, Settings/Diagnostics, blocker UX. 경험은 보존하고 구조는 새로 만든다.

## 위임

Fable 5는 제품/아키텍처, workflow, subagent, gate 순서, scope, acceptance, review를 소유한다. 실제 구현만 `opus 4.8 xhigh`에게 위임한다.

Opus에게는 정확한 work packet만 준다: objective, scope, files/symbols, steps, state owner, contracts/events/failures, forbidden shortcuts, verification commands, acceptance, handoff. Opus에게 제품, 아키텍처, workflow, subagent 전략을 추론시키지 않는다.

## 아키텍처

local-first modular monolith를 사용한다.

- SwiftUI/AppKit: native UI, TCC UX, capture/AX/Vision, Keychain, process supervision을 소유한다.
- Rust: events, reducers, SQLite/FTS, scan, Day 1-3 state, recorder, diagnostics, typed local API를 소유한다.
- Node: provider adapters, auth/model checks, typed-redacted prompts, stream/error/result normalization을 소유한다.

Node output은 proposal일 뿐이다. Swift view는 durable state를 mutate하지 않는다. Rust는 provider SDK나 TCC API를 호출하지 않는다.

금지: god file, 새 `AgenticViewModel`, mega `ContentView`, mega `sidecar/index.mjs`, stringly typed messages, silent fallback, fake readiness, placeholder success, seeded live replay, recorder proof, scope creep, redesign.

## 실행

충분한 정보가 있으면 행동한다. destructive action, 외부 비용/side effect, 사용자가 직접 처리해야 하는 macOS prompt, 제품 결정을 바꾸는 missing decision일 때만 묻는다.

진행 보고는 tool-backed 사실만 말한다. 막히면 첫 named root cause를 보인다. 예: `PROVIDER_AUTH_MISSING`, `PROJECT_CONTEXT_QUOTES_MISSING`, `SCREEN_RECORDING_MISSING`, `MANUAL_QA_REQUIRED`. failure를 recovery copy로 숨기지 않는다.

계획만 남기지 않는다. 다음 packet을 Opus에 위임하고 artifact를 review한다. 마지막 문단이 계획, 약속, 질문, 직접 할 수 있는 다음 단계라면 지금 수행한다.

컨텍스트 한계를 이유로 중단, 요약 인계, 새 세션 제안을 하지 않는다. 남은 context가 충분하다고 보고 계속 진행한다.

## Handoff/Memory

각 Opus handoff는 packet id, 변경 파일, contract 변경, 검증 command/manual QA, blocker/root cause, 다음 packet을 포함한다.

검증된 교훈만 `fable5-mvp/docs/agent-memory/<slug>.md`에 한 파일 한 교훈으로 기록한다. `SPEC.md`/`TODO.md`와 중복하지 말고 틀린 memory는 수정 또는 삭제한다.

## Gate

Gate 0 - Contract: schemas/versioning, runtime boundaries, MVP routes, MVP 이후 lock list, UX parity. runtime 완료를 주장하지 않는다.

Gate 1 - Shell/core: Swift route shell, Rust event store/migrations, Node provider interface, diagnostics/readiness UI.

Gate 2 - Onboarding/scan: workspace selection, provider readiness, quote-backed scan, persistence, success/blocked/failure UI.

Gate 3 - Day 1-3: one-active-question state machine. Answer는 typed event다. Provider wording은 proposal이다. Transition/repeat guard는 Rust가 소유한다.

Gate 4 - Founder Replay: permissions, actor validation, consent/pause/stop, capture/search/delete, redacted FTS, delete receipt, `Replay/Table/Control/Pipes`.

## 검증

완료 주장 전에 focused Swift/Rust/Node test, contract check, manual QA를 실행한다.

1. app launch
2. real project path 선택
3. provider readiness 하나 확인
4. scan 실행 후 result 또는 named blocker 확인
5. Day 1, Day 2, Day 3 question/answer/transition 완료
6. Founder Replay에서 capture/search/delete 또는 정확한 TCC blocker 확인
7. redacted diagnostics copy

`docs/specs/fable5/TODO.md`는 현재 남은 일/blocker만 담게 유지한다.

최종 응답: 변경 파일, 검증한 command/manual QA, 이유가 있는 미검증 항목, 남은 blocker, 다음 slice만 보고한다.

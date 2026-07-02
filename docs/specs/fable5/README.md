# Agentic30 Fable 5 MVP Migration

이 폴더는 Fable 5 one-shot 구현 run에 넘길 기준 문서다. 목적은 기존 앱을 in-place refactor하는 것이 아니라, 현재 Agentic30의 in-scope 사용감을 유지하면서 유지보수 가능한 greenfield MVP를 만드는 것이다.

## 문서 역할

1. `GOAL_PROMPT.md` - 실행 하네스에 그대로 넣는 4,000자 미만 프롬프트.
2. `GOAL.md` - 이번 migration의 성공 정의.
3. `VALUES.md` - 제품/엔지니어링 판단 기준.
4. `ICP.md` - 누구를 위한 MVP인지.
5. `USER_STORIES.md` - 화면별 관찰 가능한 acceptance.
6. `SPEC.md` - runtime, contract, storage, verification 기준.
7. `TODO.md` - 현재 결정과 남은 일만 담는 handoff 메모.

## Fable 5 가이드 적용

- 충분한 정보가 있으면 바로 구현한다.
- Fable 5는 더 높은 제품/아키텍처 판단을 가진 planning owner다.
- Fable 5가 구체 계획, workflow, subagent 운용, gate 순서, scope, acceptance, review 기준을 먼저 결정한다.
- 실제 구현 업무만 `opus 4.8 xhigh`에게 초구체 work packet으로 위임한다.
- Opus에게 제품/아키텍처/workflow/subagent 전략을 추론하게 두지 않는다.
- 계획만 남기지 말고 다음 work packet을 발행하고 산출물을 검토한다.
- 범위를 넘는 기능, 추상화, fallback을 추가하지 않는다.
- 진행 보고는 도구 결과로 확인된 사실만 말한다.
- 실패는 named root cause로 노출한다.
- 사용자가 필요한 경우에만 멈춘다.
- Opus handoff는 변경 파일, contract 변경, 검증, blocker, 다음 packet을 반드시 남긴다.
- 검증된 교훈만 `fable5-mvp/docs/agent-memory/`에 한 파일 한 교훈으로 남긴다.
- 최종 응답은 결과, 검증, 미검증 항목, 남은 blocker만 말한다.

## MVP 범위

```text
Onboarding -> Project Scan -> Day 1-3 Interview -> Founder Replay
```

MVP 이후: Day 4+, revenue/payment/proof ledger, broad Evidence Inbox, Morning Briefing, Strategy, Reference, automatic outreach/posting/deploy/payment mutation, multi-workspace, non-macOS.

## 핵심 구조

Agentic30 MVP는 local-first modular monolith다.

| Runtime | 소유 | 소유하면 안 되는 것 |
|---|---|---|
| SwiftUI/AppKit | native UI, navigation, TCC UX, capture/AX/Vision actors, Keychain, process supervision | durable truth, provider orchestration |
| Rust | events, reducers, SQLite/FTS, scan, Day 1-3 state, recorder, diagnostics | provider SDK, macOS TCC prompt |
| Node | provider adapters, auth/model checks, prompt/result normalization | durable state, recorder DB |

사용자에게 보이는 경험은 보존한다. 낡은 구조는 교체한다.

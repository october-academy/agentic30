# Agentic30 Fable 5 MVP TODO

이 파일은 handoff memory다. 현재 결정, blocker, 다음 작업만 유지한다.

## 현재 결정

- 별도 target이 없으면 기본 target은 `fable5-mvp/`다.
- `GOAL_PROMPT.md`는 4,000자 미만을 유지한다.
- 세부 내용은 `SPEC.md`와 `USER_STORIES.md`가 소유한다.
- Fable 5는 더 높은 product/architecture context를 가지며 concrete plan, workflow design, subagent orchestration, gate order, scope control, acceptance, final review를 소유한다.
- `opus 4.8 xhigh`는 implementation work, packet-level verification, handoff만 소유한다.
- Opus work는 files/symbols, contracts/events/failure names, verification commands, acceptance가 포함된 정확한 task packet으로 할당한다.
- Opus에게 product, architecture, workflow, subagent strategy를 추론시키지 않는다.
- Opus handoff는 packet id, 변경 파일, contract/schema 변경, 검증 결과, blocker/root cause, 다음 packet을 포함한다.
- 검증된 구현 교훈은 `fable5-mvp/docs/agent-memory/<slug>.md`에 한 파일 한 교훈으로만 저장한다.
- MVP surface는 onboarding, scan, Day 1-3 interview, Founder Replay, supporting diagnostics/settings다.
- Swift는 native UI와 OS effect를 소유한다.
- Rust는 durable truth를 소유한다.
- Node는 provider effect를 소유한다.
- Explicit named failure가 fallback보다 낫다.
- Recorder data는 local work memory이며 market proof가 아니다.

## 다음 Gate

### Gate 0 - 계약

- [ ] contracts/schema/versioning skeleton 생성.
- [ ] runtime boundary와 message direction 문서화.
- [ ] Opus handoff report format 문서화.
- [ ] `fable5-mvp/docs/agent-memory/` 규칙 문서화.
- [ ] MVP route와 MVP 이후 route 고정.
- [ ] `SPEC.md` 기준 current-UX parity checklist 생성.
- [ ] Rust shape 결정: helper process, static library, hybrid.
- [ ] provider SDK/package 확인. 모르면 `PROVIDER_SDK_MISSING` 사용.

### Gate 1 - Shell/Core

- [ ] Swift route shell.
- [ ] Rust event store와 migration harness.
- [ ] Node provider adapter interface.
- [ ] Diagnostics/readiness surface.
- [ ] Named unsupported state 표시.

### Gate 2 - Onboarding/Scan

- [ ] Workspace selection과 persistence.
- [ ] Provider readiness check.
- [ ] Quote-backed scan.
- [ ] Scan source quote schema.
- [ ] Scan blocked/failure UI.

### Gate 3 - Day 1-3 interview

- [ ] Day 1-3 question allowlists.
- [ ] One-active-question invariant.
- [ ] Typed answer events.
- [ ] Provider wording proposal schema.
- [ ] Repeat guard와 transition blockers.

### Gate 4 - Founder Replay

- [ ] Permission ladder와 actor validation.
- [ ] Consent/pause/stop.
- [ ] Capture ingest.
- [ ] Redacted FTS search.
- [ ] Delete receipt.
- [ ] `Replay/Table/Control/Pipes` shell.

### Gate 5 - 검증

- [ ] Focused Swift/Rust/Node tests.
- [ ] Contract fixture checks.
- [ ] Manual QA: onboarding -> scan -> Day 1 -> Day 2 -> Day 3.
- [ ] Manual QA: Founder Replay capture/search/delete 또는 정확한 TCC blocker.
- [ ] Redacted diagnostics copy.

## 하지 말 것

- 새 god object를 만들지 않는다.
- Node가 durable state를 mutate하게 하지 않는다.
- Swift view가 durable truth를 소유하게 하지 않는다.
- Recorder frame을 proof로 표시하지 않는다.
- Provider/model을 silent fallback하지 않는다.
- Day 4+ 또는 revenue/payment flow를 port하지 않는다.

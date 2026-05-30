# Agentic30 Product Spec

> **최종 업데이트:** 2026-05-22
> **상태:** 외부 ICP evidence 기반 private pilot loop 검증 중

Agentic30은 전업 1인 개발자가 30일 안에 사용자 100명과 첫 매출 가능성을 검증하도록 돕는 local-first macOS assistant다. 고정 강의가 아니라 사용자의 프로젝트와 실행 기록을 읽고 다음 행동을 바꾼다.

---

## 제품 한 문장

**프로젝트와 기록을 연결하면, 오늘 검증해야 할 다음 행동이 나온다.**

Agentic30은 사용자의 프로젝트 path, 업무 일지, 고객 인터뷰, BIP 기록을 읽고 30일 커리큘럼을 개인화한다. 목표는 더 많이 만드는 것이 아니라, 고객 증거에 맞게 계속할지, 바꿀지, 멈출지 판단하게 만드는 것이다.

---

## 타겟 사용자

상세는 [ICP.md](./ICP.md)를 따른다.

- 전업 1인 개발자
- 첫 매출 전
- macOS 사용자
- Claude Code, Codex, Cursor 같은 에이전트 코딩 도구 사용자
- 프로젝트 path와 인터뷰/BIP/업무 기록을 제공할 의향이 있는 사람

핵심 문제는 “만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다”는 것이다.

---

## 제품 원칙

[VALUES.md](./VALUES.md)를 제품 판단 기준으로 삼는다.

- 사용자가 드라이브한다: 사용자 기록이 커리큘럼을 바꾼다.
- 증거는 끌어온다: 관심이나 칭찬보다 행동, 반복 사용, 결제 의사를 본다.
- 투명하게 말한다: 모호한 응원보다 근거와 반증을 제시한다.
- 쉽게 만든다: 오늘 바로 실행할 좁은 행동을 준다.
- 명료함이 에고보다 중요하다: 만든 것이 아까워도 증거가 약하면 바꾼다.
- 혼자 만들지만 고립되지 않는다: 인터뷰, BIP, 사용자 피드백을 판단에 끌어들인다.

---

## Core Loop

```text
1. 사용자가 프로젝트 path를 지정한다.
2. 업무 일지, 고객 인터뷰, BIP 기록을 연결한다.
3. Mac 앱이 로컬 workspace와 기록을 읽는다.
4. Node sidecar가 Claude/Codex provider로 현재 맥락을 분석한다.
5. Agentic30이 오늘의 검증 행동을 생성한다.
6. 사용자가 실행 결과를 기록한다.
7. 다음 과제가 새 증거에 맞게 바뀐다.
```

좋은 출력은 긴 조언이 아니라 “오늘 누구에게 무엇을 보여주고 어떤 반응을 확인할지”까지 좁힌 행동이다.

---

## MVP Scope

Q2의 제품 wedge는 **Day 0-3 private pilot loop**다.

### In Scope

- SwiftUI macOS 메뉴바 앱
- 로컬 Node.js sidecar
- Claude/Codex provider routing
- 프로젝트 path 선택
- problem memo 또는 인터뷰 transcript 입력
- Day 0-3 맞춤 과제 생성
- `/office-hours-docs` 기반 ICP/GOAL/VALUES/SPEC 정리
- private pilot evidence를 맞춤 작업으로 바꾸고 feedback을 다시 반영하는 loop

### Out of Scope

- 대규모 외부 사용자 모집
- 결제/가격 책정
- 커뮤니티/멘토 시스템
- Day 8-30 전체 자동화
- `/bip-draft`, `/analyze-ads` deep integration
- Windows/Linux/iOS 네이티브 앱
- 사용자를 대신해 인터뷰, 빌드, 마케팅을 실행하는 agency 기능

---

## 성공 기준

### North Star

30일 안에 사용자 100명과 첫 매출 가능성을 검증한다.

### MVP Success

- 외부 ICP 인터뷰나 problem evidence가 Mac 앱/sidecar 입력으로 들어온다.
- 입력된 evidence가 generic 조언이 아니라 customer-specific 다음 행동으로 바뀐다.
- 사용자가 맞춤 작업을 실행하고 feedback을 남긴다.
- 같은 ICP 조건에서 pain point와 행동 신호가 반복된다.
- 관심/칭찬이 아니라 인터뷰 응답, 반복 사용, 결제 의사, 첫 매출 같은 행동 증거를 남긴다.

### Warning

- 기록 없이 자동화를 기대한다.
- “흥미롭다” 수준의 반응만 모인다.
- 기능은 늘지만 유저 획득 행동이 없다.
- 코칭이 사용자의 프로젝트 맥락과 무관한 일반론으로 돌아간다.

---

## Architecture

Agentic30은 macOS shell과 Node sidecar를 분리한다.

- **SwiftUI app:** 메뉴바 UI, floating panel, settings, Keychain, OAuth presentation, workspace 선택, `SidecarBridge`.
- **Node sidecar:** provider execution, MCP/ACP adapters, session persistence, workspace scan, prompt/sub-workflow orchestration.
- **Providers:** Claude와 Codex auth path를 모두 지원한다.
- **Storage:** local-first. 프로젝트, transcript, 업무 일지, BIP 기록은 사용자가 선택한 workspace와 로컬 앱 데이터에 둔다.
- **Distribution:** Developer ID 직접 배포. Mac App Store는 sandbox 제약 때문에 MVP 범위가 아니다.

Bridge envelope, event type, session schema를 바꾸면 Swift와 sidecar를 함께 갱신한다.

---

## 참고 문서

- [ICP.md](./ICP.md)
- [GOAL.md](./GOAL.md)
- [VALUES.md](./VALUES.md)

<!-- agentic30:day1-handoff:start -->
## Day 1 Handoff — SPEC

> Target: docs/SPEC.md
> Written: 2026-05-30T12:46:17.894Z
> Status: written_with_assumptions

### Confirmed Hypothesis
- 목표: Agentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.
- 고객: 전업 1인 개발자 (수익 0원, macOS)
- 문제: 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다
- 확인할 행동: 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다
- 품질 점수: 10.0/10

### Document Decision
# SPEC

> Generated through Agentic30 IDD setup. Provider path: codex.

## Core Decision
한 사용자의 실제 workflow는 가설 확인, 전업 1인 개발자 (수익 0원, macOS) 선택, 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다 저장까지 이어지는 단계입니다. / 이번 주 MVP wedge는 Day 1 확정에서 네 개 foundation 문서를 저장하고 Day 2 검증으로 넘기는 가장 작은 v0입니다. / non-goal은 완전 자동 문서 편집기, 새 provider 실행, 모든 문서 세부 인터뷰를 첫 경로에 넣는 것입니다. / 관찰 가능한 성공 기준은 사용자가 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다을 끝내고 GOAL/ICP/VALUES/SPEC가 저장된 상태를 보는 것입니다.

## Evidence From Interview
한 사용자의 실제 workflow는 가설 확인, 전업 1인 개발자 (수익 0원, macOS) 선택, 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다 저장까지 이어지는 단계입니다.
이번 주 MVP wedge는 Day 1 확정에서 네 개 foundation 문서를 저장하고 Day 2 검증으로 넘기는 가장 작은 v0입니다.
non-goal은 완전 자동 문서 편집기, 새 provider 실행, 모든 문서 세부 인터뷰를 첫 경로에 넣는 것입니다.
관찰 가능한 성공 기준은 사용자가 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다을 끝내고 GOAL/ICP/VALUES/SPEC가 저장된 상태를 보는 것입니다.
핵심 리스크는 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다이 실제 구매/사용 압박이 아니라면 이 가설이 틀리는 것입니다.

## Rubric Signals
- Confirmed: 한 사용자의 실제 workflow가 필요합니다.
- Confirmed: 이번 주 만들 가장 작은 MVP wedge가 필요합니다.
- Confirmed: 관찰 가능한 성공 기준이 필요합니다.
- Confirmed: 틀리면 무너지는 핵심 리스크가 필요합니다.
- Missing: 첫 버전에서 하지 않을 일이 필요합니다.

## Non-Goals
- Do not expand scope before the first narrow validation signal is observed.
- Do not treat generic interest as demand.
- Do not add platform features that do not support this week's decision.

## Decision Boundaries
- If the next action does not create user evidence this week, defer it.
- If the scope cannot be explained in one sentence, narrow it before building.
- If the tradeoff is unclear, record the rejected option and the evidence needed to revisit it.

## Pressure-Pass Follow-Up
Remove one feature from the first version. If nothing can be removed, the spec is still a wishlist.

## Open Assumptions
- 첫 버전에서 하지 않을 일이 필요합니다.

### Open Assumptions
- 첫 버전에서 하지 않을 일이 필요합니다.

### Day 1 Evidence Snapshot
# Day 1 핵심 가설

> Source: Day 1 alignment flow
> Based on: workspace scan + user selections
> Write target: docs/GOAL.md, docs/ICP.md, docs/SPEC.md

## 확정
- 목표: Agentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.
- 고객: 전업 1인 개발자 (수익 0원, macOS)
- 문제: 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다
- 확인할 행동: 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다

## 핵심 가설 문장
목표: Agentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다. / 고객: 전업 1인 개발자 (수익 0원, macOS) / 문제: 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다 / 확인할 행동: 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다

## 선택 기록
- 고객: 전업 1인 개발자 (수익 0원, macOS) · 근거: docs/ICP.md · scan 후보: 전업 1인 개발자 (수익 0원, macOS) 중 "만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다"…
- 문제: 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다 · 근거: docs/SPEC.md
- 확인할 행동: 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다 · 근거: docs/GOAL.md · scan 후보: 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.

## 남은 가정
- 현재 남은 가정 없음

## Quality Gate
Score: 10.0/10 · PASS
- 목표: 2.0/2.0 — Agentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.
- 고객: 2.5/2.5 — 전업 1인 개발자 (수익 0원, macOS) 중 "만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다" 상황을 지금 해결하려는 고객.
- 문제: 2.0/2.0 — 만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다
- 확인할 행동: 2.0/2.0 — 지불 의향과 현재 대안을 첫 고객 대화에서 묻는다.
- 근거: 1.5/1.5 — 사용자-facing 근거: docs/GOAL.md, docs/ICP.md, docs/SPEC.md

## Day 2 검증 기준
Age
...
<!-- agentic30:day1-handoff:end -->

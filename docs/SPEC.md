# Agentic30 Product Spec

> **최종 업데이트:** 2026-06-22
> **상태:** 30일 엔진 구현 완료 · 외부 활성 사용자/매출 증거 0건 — 검증 wedge는 여전히 Day 0-3 (→ [known-limitations.md](./known-limitations.md))

Agentic30은 전업 1인 개발자가 30일 안에 활성 사용자 100명과 첫 매출 가능성을 검증하도록 돕는 local-first macOS assistant다. 고정 강의가 아니라 사용자의 프로젝트와 실행 기록을 읽고 다음 행동을 바꾼다.

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
- Claude Code, Codex, Gemini, Cursor 같은 에이전트 코딩 도구 사용자
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
- 결제 처리·가격 책정 UI (증거 *수집*은 구현됨 → 아래 "구현 상태 vs 의도된 wedge" 참조)
- 커뮤니티/멘토 시스템
- Windows/Linux/iOS 네이티브 앱
- 사용자를 대신해 인터뷰, 빌드, 마케팅을 실행하는 agency 기능

---

## 구현 상태 vs 의도된 wedge

이 문서는 의도된 제품 형태를 기술하며, **현재 shipped 상태를 주장하지 않는다.** 빌드는 검증 wedge를 한참 넘어섰다.

- **검증 wedge:** 여전히 Day 0-3 private pilot loop (위 In Scope).
- **구현은 됐으나 wedge 밖** (gated/실험적, 테스트 green이지만 외부 검증 0): Day 8-30 적응형 프로그램 엔진(일차 게이트·adaptive rules·Execution OS 증명 원장), BIP 코치+리서치(`/bip-draft` 계열, Google Docs/Sheets 연동), 수익/액션 증거 판정기, 모닝 브리핑·시장 레이더·전략 리포트.
- **미배선/게이트 상세:** [known-limitations.md](./known-limitations.md) — traffic collector 없음, AR-05/AR-08 신호 unwired(rules silent), 100-user count는 PostHog 의존 후 hard-block.
- **상세 30일 설계:** [specs/agentic30-30day-adaptive-program-v2.md](./specs/agentic30-30day-adaptive-program-v2.md).
- **외부 사용자 증거: N=0.** "구현됨·테스트 green"은 "검증됨"이 아니다.

---

## 성공 기준

### North Star

30일 안에 사용자 활성 100명과 첫 매출 가능성을 검증한다.

### MVP Success

**N = 비창업자 외부 사용자의 기록된 행동 수. 오늘 N=0.** 아래는 달성된 능력이 아니라 미충족 통과 기준이다.

- [ ] 외부 ICP 인터뷰나 problem evidence가 Mac 앱/sidecar 입력으로 들어온다.
- [ ] 입력된 evidence가 generic 조언이 아니라 customer-specific 다음 행동으로 바뀐다.
- [ ] 사용자가 맞춤 작업을 실행하고 feedback을 남긴다.
- [ ] 같은 ICP 조건에서 pain point와 행동 신호가 반복된다.
- [ ] 관심/칭찬이 아니라 인터뷰 응답, 반복 사용, 결제 의사, 첫 매출 같은 행동 증거를 남긴다.

**현재 충족: 0/5** — 테스트 통과·수동 QA는 이 기준을 충족하지 못한다(본인 기계 검증일 뿐).

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

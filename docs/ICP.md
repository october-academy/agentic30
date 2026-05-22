# Ideal Customer Profile (ICP)

> **최종 업데이트:** 2026-05-22

---

## Current Stage

Agentic30은 creator 내부 검증을 1차 기준으로 보던 단계를 지나, 실제 외부 ICP evidence를 제품 판단의 최우선 기준으로 두는 단계다. Creator dogfood는 여전히 중요하지만, 고객 문제와 private pilot 반응을 검증하는 보조 기준이다.

Q2 2026 판단 순서:

1. 익명화된 외부 ICP 인터뷰 + private pilot feedback: 실제 pain point, 현재 대안, 맞춤 작업 이후의 다음 행동 확인
2. Creator 본인: daily dogfood로 제품 사용성, 실행 가능성, workflow friction 확인
3. 반복 evidence: 같은 ICP 조건에서 pain point와 행동 신호가 재현되는지 확인
4. Broader ICP: 확장 모집 전 검증할 대상

고객명, 구체 pain point, 인터뷰 원문은 운영 리서치 기록에만 보관한다. 이 문서에는 제품 판단에 필요한 익명화된 implication만 남긴다.

---

## Our ICP: 전업 1인 개발자 (수익 0원, macOS)

에이전트 코딩 도구로 제품을 만들 수 있지만, 아직 첫 매출을 만들지 못한 전업 1인 개발자. macOS를 쓰고, 30일 동안 프로젝트/업무 일지/고객 인터뷰/BIP 기록을 남기며 실행할 의향이 있어야 한다.

### 설명

퇴사 후 전업했지만 수익은 0원이다. 제품은 만들 수 있으나 무엇을 팔아야 할지, 누구에게 팔아야 할지, 어떻게 첫 사용자를 데려올지 막혀 있다.

### 필수 조건

- 전업 1인 개발자 상태
- 첫 매출 전
- macOS 사용자
- Claude Code/Codex/Cursor 등 에이전트 코딩 도구 사용
- 프로젝트 path 지정 가능
- 업무 일지/인터뷰/BIP 기록 의향 있음

### 핵심 Trigger

N번째 제품 실패 후 “코딩 문제가 아니라 고객 검증 방식이 문제”라고 자각한 시점.

### 현재 대안

- YouTube, 블로그, 인디해커 콘텐츠
- 혼자 세운 TODO
- 범용 AI 코파운더 도구

### Agentic30을 선택할 이유

일반 조언이 아니라 사용자의 프로젝트와 실행 기록에서 오늘 해야 할 검증 과제를 뽑아준다.

---

## Needs / Haves / Don't Needs

고객이 **필요한 것 / 이미 가진 것 / 필요하지 않은 것**으로 좁힌다.

| 구분 | 내용 |
|---|---|
| **Needs** | 마케팅/유저 획득 능력, 개인화된 실행 가이드, 혼자의 고립감 해소 |
| **Haves** | Claude Code, Codex, Cursor Pro Plan |
| **Don't Needs** | 코딩 기초 교육, 공동창업자 매칭, 투자 연결, 긴 강의형 커리큘럼, Windows/Linux 네이티브 지원, 대신 실행해주는 agency |

---

## Anti-ICP (비타겟)

| 비타겟 | 이유 |
|---|---|
| 퇴사 전 사이드프로젝트 직장인 | 시간과 긴급성이 부족해 30일 스프린트 강도를 소화하기 어렵다. |
| 이미 의미 있는 매출이 있는 1인 개발자 | Foundation 문제가 아니라 성장/스케일 문제가 더 크다. |
| 팀 기반 스타트업 희망자 | Agentic30은 1인 개발자 실행 시스템이다. |
| Windows/Linux 전용 사용자 | MVP는 macOS 메뉴바 앱이다. |
| 기록을 남기지 않는 사용자 | Adaptive 엔진의 입력이 없으면 정적 커리큘럼과 차별이 사라진다. |
| “대신 해줘” 수요자 | 제품은 실행을 대체하지 않고, 실행 판단과 다음 과제를 좁힌다. |
| “흥미롭네요” 수준의 관망자 | PostHog 기준으로 polite interest는 ICP/PMF 신호가 아니다. |

---

## Persona

Primary persona는 “퇴사 후 전업한 macOS 1인 개발자”다.

- **Job summary:** AI 코딩 도구로 빠르게 만들 수 있지만, 고객 검증과 배포/획득 루프는 약하다.
- **Motivation:** 30일 안에 실제 사용자 증거와 첫 유료 신호를 만들고 싶다.
- **Frustration:** 또 만들기만 하다가 0매출로 끝날까 봐 두렵다. 고객 인터뷰와 BIP 기록을 해도 다음 행동으로 연결하지 못한다.

---

## Validation Signals

PostHog 기준으로 ICP는 말보다 행동으로 검증한다. Agentic30의 좋은 ICP 신호는 다음과 같다.

### Positive

- 첫 외부 ICP 인터뷰에서 반복 가능한 pain point와 현재 대안이 확인됨
- Private pilot에서 맞춤 작업 결과물을 받고 구체 피드백을 준다
- 프로젝트 path를 지정하고 업무 일지/인터뷰/BIP 기록을 누적
- 인터뷰 transcript를 업로드하고 분석 결과에 질문/수정 요청
- Adaptive 과제를 실제 수행하고 결과를 다시 앱에 제출
- 불편해도 계속 쓰고, 개선점을 강하게 요구한다
- 비슷한 문제를 가진 다른 1인 개발자를 소개한다
- 결제 의사 또는 첫 매출/유료 ask 같은 money signal을 만든다

### Warning

- “흥미롭다”, “나중에 써보겠다” 수준에서 멈춘다
- 제품은 쓰지만 돈을 내고 싶지는 않다고 말한다
- 기록 없이 자동으로 해달라고 요구한다
- Windows/Linux 지원이 첫 질문이다
- 강의나 정적 커리큘럼을 기대한다
- 이미 성장 단계 문제를 겪고 있다

---

## Downstream Decisions

ICP가 바뀌면 제품 전략도 바뀐다. 현재 ICP 기준 결정은 다음과 같다.

| 영역 | 결정 |
|---|---|
| **배포** | macOS DMG 직접 배포. App Store는 workspace 접근 제약 때문에 MVP에서 제외한다. |
| **온보딩** | Node/provider 셋업 → 프로젝트 path 선택 → 업무 일지/인터뷰/BIP 기록 연결을 먼저 완료한다. |
| **기능 우선순위** | Adaptive 엔진, 인터뷰/BIP 분석, 다음 과제 생성이 UI polish보다 우선한다. |
| **포지셔닝** | “내 프로젝트와 실행 기록으로 30일 검증 과제를 만드는 macOS 어시스턴트.” 온라인 강의나 정보 플랫폼이 아니다. |
| **마케팅 채널** | 초기에는 외부 ICP 인터뷰와 private pilot evidence를 우선 축적한다. Creator dogfood는 메시지와 workflow를 다듬는 보조 입력이다. 확장 시 개발자 커뮤니티, Threads, Discord, Claude Code/Codex 생태계로 넓힌다. |
| **가격** | 아직 확정하지 않는다. Pilot-specific offer와 영업 정보는 사용자별 리서치 기록에서만 다룬다. |

---

## 참고 자료

- [PostHog: How to create a great user persona](https://posthog.com/product-engineers/how-to-create-user-personas)
- [PostHog: Ideal customer profile framework](https://posthog.com/newsletter/ideal-customer-profile-framework)
- [SPEC.md](./SPEC.md) — 제품 명세와 타겟 사용자

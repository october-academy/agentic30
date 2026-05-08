# Agentic30 Goal / OKR

> **최종 업데이트:** 2026-05-07
> **현재 상태:** Pre-dogfood. Public-safe product goal document.

이 문서는 Agentic30 제품 목표만 다룬다. Founder private planning source, October Academy 회사 가설/미션 원문, 연간/분기 회사 목표, 매출 목표, private sales plan은 이 repo에 복제하지 않는다. private alignment source와 동기화 절차는 [AGENTIC30-DIRECTION.md](./AGENTIC30-DIRECTION.md)를 따른다.

---

## 프로젝트 미션

Agentic30는 전업 1인 개발자가 자기 프로젝트와 실행 기록을 근거로 30일 안에 PMF 검증 방향을 좁히도록 돕는 macOS 메뉴바 AI assistant다.

- **타깃 유저:** 전업 1인 개발자, macOS 사용자, 프로젝트/인터뷰/업무/BIP 기록을 남길 의향이 있는 사람.
- **핵심 가치:** 정적 강의가 아니라 사용자 evidence를 읽고 다음 행동을 조정하는 adaptive curriculum.
- **Form factor:** SwiftUI macOS app + local Node sidecar.
- **운영 원칙:** private 회사 전략은 product rule로만 번역하고, 원문/수치/민감 계획은 source에 넣지 않는다.

---

## 2026 Q2 Product Focus

Q2의 public product focus는 Foundation phase를 작게 완성하는 것이다.

### Objective 1: Foundation Loop 동작

사용자가 프로젝트와 문제 메모 또는 인터뷰 transcript를 넣으면 Day 0-3의 다음 행동이 생성된다.

| # | Key Result | 측정 |
|---|---|---|
| KR1.1 | 프로젝트 path와 session state가 안정적으로 저장된다 | 앱 재시작 후 상태 유지 |
| KR1.2 | transcript 또는 problem memo 입력을 sidecar가 분석한다 | txt/md 입력 fixture 통과 |
| KR1.3 | Day 0-3 adaptive task가 생성된다 | 동일 입력 재실행 시 일관된 구조 |
| KR1.4 | Day 2 고객 대화 질문이 사용자의 context를 반영한다 | generic 질문 대비 project-specific detail 포함 |

### Objective 2: Local Assistant Reliability

Swift app과 Node sidecar의 bridge contract를 안정화한다.

| # | Key Result | 측정 |
|---|---|---|
| KR2.1 | Sidecar startup/preflight가 진단 가능하다 | 실패 원인이 사용자에게 설명됨 |
| KR2.2 | Claude와 Codex auth path가 모두 유지된다 | live provider gated test 또는 manual canary |
| KR2.3 | bridge message envelope 변경이 Swift/sidecar 양쪽에 반영된다 | sidecar test + Swift build |
| KR2.4 | diagnostics snapshot이 token/path 민감정보를 노출하지 않는다 | sanitized output review |

### Objective 3: Public-Safe Product Docs

제품 문서는 실행에 필요한 방향성을 제공하되 private 회사 전략을 복제하지 않는다.

| # | Key Result | 측정 |
|---|---|---|
| KR3.1 | `docs/AGENTIC30-DIRECTION.md`가 source-of-truth 링크와 privacy boundary를 설명한다 | 링크와 sync workflow 존재 |
| KR3.2 | `docs/ICP.md`, `docs/SPEC.md`, `docs/VALUES.md`가 product-level language를 유지한다 | private leak scan 통과 |
| KR3.3 | private source snapshot은 `docs/private/alignment/`로만 동기화된다 | `npm run sync:alignment` 출력이 gitignored |

### Objective 4: Dogfood Evidence

Creator dogfood와 pilot feedback은 제품 개선을 위한 evidence로 기록하되, 개인 계획이나 회사 수치는 repo에 남기지 않는다.

| # | Key Result | 측정 |
|---|---|---|
| KR4.1 | dogfood session에서 Day task 생성 결과를 남긴다 | sanitized artifact 또는 issue link |
| KR4.2 | task completion friction을 분류한다 | setup, input quality, provider, UX, output quality |
| KR4.3 | Day 0/Day N self-assessment 구조를 정의한다 | public-safe rubric schema |

---

## Non-Goals

- Founder private planning 원문을 제품 repo에 저장하지 않는다.
- October Academy wiki 원문을 docs에 mirror하지 않는다.
- 회사 annual/quarterly goals, revenue goals, pricing/private sales plan을 source, prompt, test fixture에 넣지 않는다.
- Day 8-30 전체 자동화, full community/mentor system, public distribution polish는 Foundation loop가 검증된 뒤 확장한다.

---

## Weekly Check-In Template

```markdown
## Weekly Check-In - W{week} ({date range})

### Completed
- [ ] {item}

### Product Signals
| Signal | This week | Change | Note |
|---|---:|---:|---|
| Day 0-3 task generation runs |  |  |  |
| Transcript/problem memo inputs analyzed |  |  |  |
| Task completion evidence captured |  |  |  |
| Sidecar/provider failures |  |  |  |
| Private leak scan findings |  |  |  |

### Decisions
-

### Next Week
1.
2.
3.
```

---

## 참고 문서

- [AGENTIC30-DIRECTION.md](./AGENTIC30-DIRECTION.md) - alignment boundary, source links, sync workflow.
- [ALIGNMENT.md](./ALIGNMENT.md) - mission ↔ product ↔ measurement mapping; 5-axis rubric.
- [SPEC.md](./SPEC.md) - product spec.
- [ICP.md](./ICP.md) - target customer profile.
- [VALUES.md](./VALUES.md) - product values.

# Agentic30 Direction Setting

> **최종 업데이트:** 2026-05-07
> **문서 성격:** 공개 repo에 남겨도 되는 sanitized alignment 문서.

이 문서는 Founder private planning source, October Academy 위키/이슈, Agentic30 제품 문서를 연결하되, private 전략 원문을 Agentic30 repo에 복제하지 않기 위한 경계 문서다.

---

## 방향성 한 문장

Agentic30는 전업 1인 개발자가 자기 프로젝트와 실행 기록을 근거로 30일 안에 PMF 검증 방향을 좁히도록 돕는 local-first macOS 메뉴바 assistant다.

제품은 October Academy의 private 전략을 "그대로 담는 저장소"가 아니라, 전략에서 도출된 공개 가능한 제품 원칙과 실행 루프만 담는다.

---

## 공개/비공개 경계

Agentic30 repo에 남길 수 있는 것:

- 공개 가능한 제품 포지셔닝, ICP, 스펙, 아키텍처, 운영 원칙.
- private 원문으로 가는 링크와 동기화 절차.
- 제품 수준의 generic 성공 신호. 예: activation, completion, evidence quality, retention intent.
- 공개 이슈에 이미 남아 있는 rubric/benchmark/failure-condition 링크.

Agentic30 repo에 남기면 안 되는 것:

- Founder private planning 원문, 개인 목표, 개인 시간 예산.
- October Academy 회사 가설/미션 원문 복제본.
- 회사 연간 목표, 분기 목표, 매출 목표, 가격/영업 파이프라인, 고객명, 세부 운영 수치.
- GitHub wiki clone, core issue body export, private planning transcript.

이런 원문은 `docs/private/`, `docs/_private/`, `docs/october-academy/`, `docs/mandalart*.md`, `docs/mandal-art*.md` 아래에만 둔다. 해당 경로는 `.gitignore`에 포함되어 있다.

---

## Source Of Truth

| Source | 최신 확인 | Agentic30에서 쓰는 방식 |
|---|---:|---|
| Founder private planning source | private local input | 원문 저장 금지. 제품 원칙/우선순위로만 수동 번역 |
| October Academy wiki: [Mission and Hypothesis](https://github.com/october-academy/october-academy.com/wiki/Mission-and-Hypothesis) | 2026-05-07 wiki clone 확인 | 회사 가설/미션은 링크만 유지. 원문 복제 금지 |
| October Academy wiki: [2026 Goal](https://github.com/october-academy/october-academy.com/wiki/2026-Goal) | 2026-05-07 wiki clone 확인 | 연간 목표는 private source로 취급. 제품 방향의 제약으로만 반영 |
| October Academy wiki: [2026 Q2](https://github.com/october-academy/october-academy.com/wiki/2026-Q2) | 2026-05-07 추가 확인 | 분기 목표/수치는 원문 복제 금지. Q2 제품 focus만 sanitized |
| October Academy core [issue #1](https://github.com/october-academy/core/issues/1) | 2026-04-14 updated | "왜 October Academy인가" narrative source |
| October Academy core [issue #2](https://github.com/october-academy/core/issues/2) | 2026-04-14 updated | 학교/사관학교 벤치마크 source |
| October Academy core [issue #3](https://github.com/october-academy/core/issues/3) | 2026-04-14 updated | 실패 조건과 kill criteria source |
| October Academy core [issue #4](https://github.com/october-academy/core/issues/4) | 2026-04-28 updated | Agentic Engineer 평가 rubric source |
| [october-academy/agentic30](https://github.com/october-academy/agentic30) | 2026-05-07 pushed | 공개 제품 repo source of truth |

Private source snapshot은 `npm run sync:alignment`로 갱신한다. 출력 위치는 `docs/private/alignment/`이며 gitignored다.

---

## 제품 원칙

### 1. 제품은 "강의"가 아니라 evidence loop다

정적 커리큘럼을 보여주는 것이 아니라, 사용자의 프로젝트 path, 인터뷰 transcript, 업무 기록, Build in Public 기록을 읽고 다음 행동을 제안한다. UI보다 중요한 것은 evidence를 다시 제품에 넣는 반복 루프다.

### 2. Q2 wedge는 Foundation phase에 집중한다

가장 작은 공개 가능한 제품 단위는 "interview transcript 또는 problem memo를 넣으면 다음 고객 대화 질문과 Day 0-3 실행 과제가 나온다"이다. Mac 메뉴바 UI 전체, Day 8-30 전체 자동화, 여러 sub-workflow 통합은 이 loop가 동작한 뒤 확장한다.

### 3. macOS shell과 Node sidecar 경계는 유지한다

SwiftUI app은 macOS surface area를 맡고, Node sidecar는 provider execution, MCP/ACP adapters, workspace introspection, session persistence를 맡는다. bridge contract를 바꾸면 Swift와 sidecar를 함께 갱신한다.

### 4. private 전략은 prompt/runtime input이 아니다

Agentic30 source, prompt, fixture, test에는 회사 목표 원문을 넣지 않는다. 제품 판단이 private 전략에서 나왔더라도 code에는 sanitized product rule만 남긴다.

### 5. 성공 신호는 사용자 행동으로 본다

공개 제품 문서에서는 회사 매출/분기 목표가 아니라 사용자 activation, Day completion, evidence quality, self-assessment delta, retention intent 같은 제품 신호를 추적한다.

### 6. 모든 코칭 출력은 5축 루브릭에 매핑되어야 한다

회사 평가 루브릭인 Definition·Command·Clout·Responsibility·Adaptability는 제품의 메타-루브릭이다. 모든 specialist prompt와 sidecar 응답은 강화 축 1-2개를 표시해야 하며, Day 0/30 self-assessment의 측정 인프라가 된다. 본 문서는 정책을 명시하고, 미션-제품-측정 매핑은 [`ALIGNMENT.md`](./ALIGNMENT.md)에 둔다. Runtime enforcement(specialists 모듈의 `RUBRIC` 필드, `rubric-assessment.mjs` schema, `check-alignment` lint)는 별도 작업으로 구현한다.

---

## 현재 제품 Focus

1. `docs/ICP.md`, `docs/SPEC.md`, `docs/GOAL.md`, `docs/VALUES.md`를 public-safe product docs로 유지한다.
2. Foundation first: Day 0-3 task generation, interview question generation, session persistence를 우선한다.
3. `/office-hours-docs`는 first-class workflow로 유지하고, `/bip-draft`, `/analyze-ads`는 Foundation loop가 안정된 뒤 다시 통합한다.
4. Provider execution은 Claude와 Codex 양쪽 auth path를 계속 지원한다.
5. Public repo에는 product direction만 남기고 private alignment material은 ignored cache로만 관리한다.

---

## Sync Workflow

1. 최신 private/source context를 가져온다.

   ```bash
   npm run sync:alignment
   ```

2. `docs/private/alignment/`에서 wiki, core issues, agentic30 repo metadata를 검토한다.
3. 공개 문서에 반영할 때는 원문을 복사하지 말고 제품 implication만 적는다.
4. 변경 후 누출 검사를 한다. 검사 키워드 자체가 leak 표적이라서 public doc에는 literal로 두지 않고, ignored config(`docs/private/alignment/leak-config.json`)에서 로드한다.

   ```bash
   git status --short
   git diff -- docs package.json scripts/sync-alignment-sources.mjs .gitignore
   npm run check:alignment-leak
   ```

   keyword schema와 redaction class 정의는 `docs/private/alignment/LEAK-CONFIG.md`(gitignored)를 참조한다.

5. private 수치나 원문이 발견되면 public doc에서는 링크와 sanitized rule로 되돌린다.

---

## Open Decisions

- core issue #4의 평가 rubric을 제품 UI에 노출할 때 어떤 항목명까지 public copy로 허용할지 정해야 한다.
- Q2 private plan에서 도출된 product focus 중 public roadmap에 올릴 수 있는 날짜/범위를 정해야 한다.
- `npm run sync:alignment` 결과를 사람이 검토하는 절차를 PR checklist에 추가할지 결정해야 한다.

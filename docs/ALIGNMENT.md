# Agentic30 Alignment

> **문서 성격:** 회사(October Academy) 미션과 제품(Agentic30) 동작 사이의 매핑. DIRECTION.md가 *어떻게 만드는가*를 정의한다면, 이 문서는 *왜 만드는가*와 *무엇을 측정하는가*를 정의한다.
> **최종 업데이트:** 2026-05-07

---

## 매니페스토

> 우리는 기능을 코칭하지 않는다.
> 30일 PMF 실전 고립 훈련에서 5축 사령관을 육성한다.
> 시장을 얻거나, 포기할 지혜를 얻거나.

---

## 5축 루브릭

회사 평가 루브릭 (October Academy core issue #4):

| 축 | 한국어 | 의미 |
|---|---|---|
| Definition | 문제 정의력 | 무엇을 풀지 정확히 정한다 |
| Command | 주도력 | 본인이 결정하고 실행한다 |
| Clout | 영향력 | 시장과 사용자에게 도달한다 |
| Responsibility | 책임감 | 결과에 대해 끝까지 책임진다 |
| Adaptability | 적응력 | 데이터로 방향을 수정한다 |

이 5축은 모든 코칭 prompt와 sidecar 응답의 메타-루브릭이며, Day 0/Day 30 self-assessment의 측정 축이다.

---

## 미션-제품-측정 매핑

| 회사 개념 | 제품 원칙 | Runtime surface | 측정 |
|---|---|---|---|
| 지혜는 훈련 가능 (가설) | adaptive coaching mapped to 5 axes | specialists `RUBRIC` 필드, 응답 metadata `rubric_focus` | Day 0/30 self-assessment delta (within-person baseline) |
| 사관학교 = 제한된 기간·반복훈련·판정 | 30일 evidence loop, daily task, Day 7 Go/No-Go | `sidecar/foundation-summary/`, `sidecar/adaptive-curriculum.mjs` | 환불 0건, 루브릭 평균 변화 |
| 정답 안 주기 | 코치는 가설의 허점을 찾고 사용자가 결정한다 | foundation-summary READ-ONLY tool 화이트리스트 + `canUseTool` fail-closed | 도구 allowlist 테스트 pin |
| Make something people want | 추측 금지, 시장 목소리(Clout)를 데이터로 증명할 때만 전진 | Mom Test 프롬프트, 정량 지표 요구 | activation, retention intent |
| 인재마인드 | 사용자를 사관생도로 대우. 친절보다 명확한 피드백(Command) | `SOUL.md` Style/Avoid (단정·둘러대지 않음·빈 칭찬 금지) | 사용자가 단호한 의견을 받았다고 보고하는 빈도 |
| private 원문 비복제 | sanitization ledger를 거쳐 public principle만 진입 | `scripts/sync-alignment-sources.mjs`, ignored cache | leak grep 0건 |

---

## No-Go 가이드라인 (환불 0 정책의 근거)

> 잘못된 가설을 죽이는 것이 가장 비싼 지혜다.
> 우리는 성공을 팔지 않는다. 진실에 도달하는 속도를 판다.
> 지혜는 환불하지 않는다.

- Day 30에 PMF가 No-Go로 판정돼도 환불하지 않는다. 사용자가 산 것은 *결과*가 아니라 *진실에 도달하는 30일*이다.
- 이 frame은 Day 0 합의서에 명시한다. 사후 분쟁 방어가 아니라 사전 alignment의 도구다.
- BIP 게시·refund copy·SOUL.md voice 모두 같은 frame을 공유한다.

---

## Runtime enforcement 로드맵

| 단계 | 산출물 | 강제 지점 |
|---|---|---|
| P0 (현재 PR) | DIRECTION.md 6번 원칙 + ALIGNMENT.md + SOUL.md 결속 한 줄 | 정책 문서화 |
| P1 | sanitization ledger schema (private location) | 만다라트·회사 원문 → public principle 변환 추적 |
| P2 | `sidecar/specialists/schema.mjs`: `RUBRIC_AXES`, `assertValidSpecialistModule`, `formatRubricInstruction` | import-time validation, 중앙 inject |
| P2 | `sidecar/rubric-assessment.mjs`: 5축 × 5점 schema with 행동 anchor (1/3/5점), evidence_refs, within-person baseline | Day 0/30 측정 인프라 |
| P3 | 모든 specialist 모듈에 `RUBRIC` 필드 추가 + 테스트 lock-in | 신규 specialist에서 RUBRIC 누락 시 import 실패 |
| P4 | `scripts/check-alignment.mjs`: ignored config 기반 leak detector + redacted output | leak·RUBRIC schema·bridge keyword 자동 검사 |
| P4 | Weekly Alignment Review prompt | 주간 코칭 로그 요약 + 5축 이동 점검 |

---

## 참고 문서

- [`AGENTIC30-DIRECTION.md`](./AGENTIC30-DIRECTION.md) — alignment 경계, source links, sync workflow.
- [`SOUL.md`](./SOUL.md) — Hermes/agent identity. ALIGNMENT의 voice 구현.
- [`GOAL.md`](./GOAL.md) — Q2 OKR. KR4 시리즈가 ALIGNMENT 측정 인프라.
- [`SPEC.md`](./SPEC.md) — 제품 스펙.
- [`VALUES.md`](./VALUES.md) — 행동 원칙.

---

## 운영 참고

Alignment 운영 결정/private config은 `docs/private/alignment/`에 보관 (gitignored, PR diff에 안 남음). 외부 contributor가 본인 환경에서 준비할 항목:

- `docs/private/alignment/leak-config.json` — *선택*. `npm run check:alignment-leak`이 사용. 부재 시 silent skip(CI 통과).
- `AGENTIC30_LEDGER_PEPPER` 환경변수 — sanitization-ledger의 private hash helper(`sidecar/private-hash.mjs`)가 사용. **미설정 시 hash 생성 throw** (보안 착시 차단).

자세한 schema와 운영 절차:
- `docs/private/alignment/LEAK-CONFIG.md` — leak detector setup + 동작 명세.
- `docs/private/alignment/HMAC-PEPPER-ADR.md` — pepper 도입 결정, 한계, 유실 시 복구/폐기 절차.

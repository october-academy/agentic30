# 5축 루브릭 — Anchor Reference

> **문서 성격:** Agentic Engineer 평가 5축의 1점/3점/5점 anchor 정의. Day 0/30 self-assessment의 측정 기준이며, sidecar의 specialist scoring·`rubric_focus`·assessment hydration의 source of truth.
> **최종 업데이트:** 2026-05-07

---

## 5축 × 3 단계 anchor 표

| 축 | 1점 (baseline) | 3점 (mid) | 5점 (mature) |
|---|---|---|---|
| **Definition** (문제 정의력) | 문제를 한 줄로 적지 못한다. 만들고 싶은 것이 곧 시장 문제라고 가정한다. | 잠재 고객 1-2명에게서 들은 한 가지 고통 표현을 가지고 있다. 그들이 이미 시도한 우회책은 아직 모른다. | 5명 이상 인터뷰에서 반복되는 고통을 한 문장으로 정의했다. 우회책과 그것이 부족한 이유까지 알고 있다. |
| **Command** (주도력) | 다음 행동을 누가 결정해야 할지 모른다. 외부 의견 없이는 결정하지 못한다. | 매일 다음 행동 1-2개를 스스로 정한다. 기록은 비정기적이다. | 매주 단호한 Go/Kill/Pivot 결정을 글로 남긴다. 외부 의견은 참고지 결정권자가 아니다. |
| **Clout** (영향력) | 도달한 사람 0명. 공개 게시물도 없다. | BIP 게시 10편 이상 + 누적 reach 측정 가능 + 첫 자발적 응답이 있다. | 결제 활성 1명 이상 또는 검증 가능한 시장 신호(가입 100+, 자발 인용, 업계 채널 언급) 보유. |
| **Responsibility** (책임감) | 약속 이행 기록 없음. "다음 주에 할게요"가 누적되어 있다. | 주간 약속 1-2개를 기록하고 평가한다. 미이행도 솔직히 적는다. | 약속 ↔ 실행 ↔ 결과 cycle을 BIP에 공개한다. 환불·고객 응대를 본인이 직접 한다. |
| **Adaptability** (적응력) | 처음 가설을 30일째까지 그대로 유지한다. 데이터를 봐도 "더 노력하자"라고 결론짓는다. | 데이터에 따라 한 번 이상 가설/타겟/wedge를 수정했다. | 정량 신호 기반으로 7일마다 가설을 점검하고 약하면 신속하게 변형/Kill로 이동한다. |

---

## Scoring rule

- 자기 보고 점수 N → `nearestAnchorLevel(N)`로 1/3/5 anchor에 매핑 (1-2 → 1, 3-4 → 3, 5 → 5).
- **점수 ≥ 3은 `evidence_refs` 최소 1개 필수** — self-bias 보정. 보강 작업(P1): score ≤ 2일 때도 `no_evidence_reason`을 요구해 낮게 보고하는 회피 모드를 닫는다.
- 측정은 **within-person baseline** (절대점수 X). Day 0 ↔ Day 30 같은 사용자의 delta만 의미가 있다.

---

## 정직 모드 (`no_evidence_reason`)

근거를 찾지 못했다는 것은 실패가 아니라 **솔직한 상태의 기록**이다. Day 30 회고에서 어떤 축에 대해 `evidence_refs`를 댈 수 없을 때 `no_evidence_reason`에 그 이유를 한 줄로 적는다(예: "이번 주 수요 검증 안 한 상태"). 정직한 데이터가 더 정교한 가이드를 만든다.

자기 점수 ≤ 2일 때도 같은 원칙: 점수가 낮은 게 부끄러운 게 아니라, 왜 낮은지를 모르는 게 위험하다.

---

## Source of truth

- 코드: [`sidecar/rubric-anchors.mjs`](../sidecar/rubric-anchors.mjs) — JS 객체. Import 시점에서 5축 × 3단계 완전성 검증.
- 본 문서는 사람용 미러. 두 곳이 어긋나면 **JS 객체가 source of truth**, 본 문서를 갱신.

---

## 사용처

| 위치 | 어떻게 |
|---|---|
| `sidecar/rubric-anchors.mjs` `getAnchorText(axis, level)` | flat 입력(`{ axis: score }`)에서 anchor_text/level 자동 hydrate |
| `sidecar/rubric-assessment-host.mjs` `recordFlatRubricAssessment` | MCP/CLI에서 호출. score → anchor 매핑 + persist |
| `sidecar/specialists/schema.mjs` `formatRubricInstruction` | system prompt 후미에 5축 강화 지시 + `rubric_focus` metadata 요청 |
| `sidecar/mcp-server.mjs` `record_rubric_assessment` 도구 | Claude Code/Codex CLI에서 직접 invoke (interactive flow) |

---

## Privacy

**한눈에**: 외부로 나가는 건 day(0/30)와 axis 개수(5)뿐. 점수, anchor 텍스트, 근거(`evidence_refs`), 정직 모드 메모(`no_evidence_reason`), session ID, notes는 전부 내 컴퓨터(`<workspace>/.agentic30/`)에만 저장.

Rubric records persist locally to `<workspace>/.agentic30/rubric-assessments.json`.

When a record is saved, the sidecar emits a `mac_sidecar_rubric_assessment_recorded` telemetry event with:

- **Explicit payload** (sent via `recordRubricAssessment`): `day` (0 or 30), `axisCount` (5).
- **Auto-injected by the telemetry client** (`sidecar/telemetry.mjs`): `distinct_id`, `workspace_basename`, and the authenticated user's email domain.

Raw scores, `anchor_text`, `evidence_refs`, `no_evidence_reason`, `sessionId`, and `notes` are **local-only** and never transmitted.

MCP tools (`get_rubric_status`, `list_quarantined_records`) also return **redacted** form — only `sessionId`, `day`, `recordedAt`, axis scores, and within-person delta. Raw `evidence_refs`/`anchor_text`/`no_evidence_reason`/`notes`/`original` payloads stay local; read them directly from `<workspace>/.agentic30/` if needed (sidecar/mcp-server.mjs `redactRubricStatus`).

---

## 참고

- [`AGENTIC30-DIRECTION.md`](./AGENTIC30-DIRECTION.md) — alignment 경계.
- [`ALIGNMENT.md`](./ALIGNMENT.md) — 미션-제품-측정 매핑.
- [`SOUL.md`](./SOUL.md) — 코치 identity.

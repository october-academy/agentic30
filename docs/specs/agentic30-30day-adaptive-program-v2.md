# Agentic30 30-Day Adaptive Program v2 Spec

> **작성일:** 2026-06-20 KST
> **상태:** v2 구현 목표 명세
> **대체 대상:** `docs/specs/agentic30-30day-adaptive-program.md`
> **관련 문서:** `docs/specs/agentic30-office-hours-redesign-v1.md`

---

## 1. 요약

Agentic30은 전업 1인 개발자가 AI Agent를 사용해 30일 안에 활성 사용자 100명과 첫 매출 증거를 만드는 local-first 실행 OS다.

v1 설계는 이 방향을 맞게 잡았다. 특히 Office Hours가 "빌드만 하고 고객 증거가 없는 상태"를 그냥 통과시키지 않는 것은 제품의 핵심이다. 다만 v2는 단순한 stale commitment 해소 장치가 아니라, AI Agent가 매일 acquisition, activation, instrumentation, revenue proof를 위한 `agent workpack`을 만들고 사용자가 founder-owned external action으로 외부 증거를 닫는 30일 실행 프로그램이어야 한다.

Dogfood에서 관찰된 익명화 패턴은 증거 규율이 특정 연락처 집착으로 변질될 수 있다는 점이다. 예를 들어 `후보 A`에게 검증 자료를 요청한다는 하나의 미해결 약속이 며칠 동안 반복되고, 매일 Office Hours가 거의 같은 질문을 다시 꺼내는 상태다. 이건 사용자의 회피를 놓치지 않는다는 장점이 있지만, 동시에 제품이 학습하지 못하고 사용자를 피로하게 만든다. 이 문서는 private workspace의 현재 기록을 복사하지 않고, stale commitment failure mode만 익명화된 dogfood pattern으로 보존한다.

v2의 결론은 단순하다. AI Agent는 founder의 고객 접촉, 유료 ask, 채널 실행, 결제 증거 수집을 대체하지 않는다. Agentic30은 사용자가 오늘 외부에서 실행할 일을 좁히고, 필요한 문장/분석/계측/체크리스트를 준비하며, 실행 후 제출된 accepted evidence만 시장 증거로 계산한다.

1. 고객 증거 없는 빌드 진행은 계속 막는다.
2. AI Agent workpack은 실행 준비물이지 proof가 아니다.
3. 같은 후보와 같은 행동이 2회 반복되면 더 이상 같은 질문을 반복하지 않는다.
4. 반복 약속은 명시적 상태 전이 카드로 해소한다.
5. 자기보고는 반복 부채를 닫을 수 있지만 고객 증거, 활성 사용자, 매출 증거로 계산하지 않는다.
6. 매일 Office Hours는 Evidence Read -> AI Agent Workpack -> Founder External Action -> Proof Close -> Next-Day Adaptation 순서로 돌아간다.

이 명세는 v1의 30일 adaptive program을 대체하는 방향의 제품/기술 명세다. 기존 v1 문서는 역사 기록과 배경 분석으로 보존한다.

### 1.1 Current MVP Alignment

`docs/SPEC.md`가 현재 제품 source of truth다. 현재 MVP는 **Day 0-3 private pilot** wedge이며, payment/pricing과 Day 8-30 전체 자동화는 out of scope다.

이 v2 문서는 post-MVP target spec이자 구현 목표 명세다. `docs/SPEC.md`와 roadmap이 이 범위로 업데이트되거나 rollout phase가 해당 단계에 도달하기 전까지, 이 문서는 현재 shipped behavior를 주장하지 않는다. 구현 source of truth로 승격되는 시점은 명시적 roadmap 업데이트 또는 단계별 rollout gate 통과 이후다.

## 2. 헤겔 프레임

### 2.1 정: 증거 규율

Agentic30은 공부 앱이나 체크리스트 앱이 아니다. 사용자가 코드를 쓰고, 문서를 고치고, 내부적으로 바쁘게 움직였더라도 시장 접촉 증거가 없으면 프로그램은 진행을 의심해야 한다.

이 thesis가 지키는 것:

- Git activity와 market validation을 분리한다.
- "인터뷰할 예정"과 "인터뷰했다"를 분리한다.
- "관심 있어 보임"과 "시간/돈/워크플로우를 걸었다"를 분리한다.
- Day 30 continue/pivot/stop 판단을 자기 위안이 아니라 외부 증거에 묶는다.

### 2.2 반: Contact Fixation

증거 규율이 너무 좁게 구현되면 하나의 후보, 하나의 메시지, 하나의 미발송 약속에 제품이 갇힌다. 이때 Office Hours는 시장 검증 시스템이 아니라 죄책감 reminder가 된다.

현재 failure mode:

- 미해결 약속을 찾는 로직은 있다.
- 반복 약속이 stale인지 판정하는 신호도 있다.
- 그러나 stale 상태가 "해소 카드"로 바뀌지 않고 같은 질문으로 재출력된다.
- 구조화된 ledger 필드보다 약속 문장 자체가 sticky key처럼 동작한다.
- 부정 증거, 후보 부적합, 채널 차단, 미발송 이유가 학습 데이터로 분리되지 않는다.

### 2.3 합: Agent Workpack Before Founder-Owned Proof Close

v2는 증거 규율을 약하게 만들지 않는다. 대신 매일 AI Agent workpack을 먼저 만들고, 그 workpack이 founder-owned external action과 accepted 외부 증거로 닫히기 전까지는 진행으로 계산하지 않는다. 반복 약속은 이 큰 루프 안의 Card 1 sub-loop로 남긴다.

Synthesis 원칙:

- AI Agent는 outreach/customer copy, ICP/source analysis, paid ask, first_value instrumentation, activation friction fix를 준비한다.
- 사용자는 실제 고객 접촉, 유료 ask, 채널 게시, 계측 반영, 증거 제출을 실행한다.
- workpack, 초안, 분석, 코드 snippet, AI demo는 시장 증거가 아니다.
- "오늘도 후보 A에게 보낼 건가요?"가 아니라 "이 반복 약속의 상태를 지금 바꿔라"를 묻는다.
- hard evidence가 있으면 customer evidence로 닫는다.
- hard evidence가 없더라도 자기보고로 반복 부채는 닫을 수 있다.
- 자기보고 해소는 progress score에 들어가지 않는다.
- 닫힌 부채는 다음 날 같은 질문으로 되살아나지 않는다.
- 닫힌 이유는 memory와 report에 남아 다음 risk lens와 다음 날 `agentWorkpack`을 고르는 데 쓰인다.

## 3. 범위

### 3.1 포함 범위

- 30일 프로그램 v2 루프 정의
- AI-agent-assisted daily workpack contract
- `activeUsers100`와 `firstRevenue` scoreboard proof semantics
- Week 1-4 / Day 1-30 roadmap과 G4-G7 recovery branch
- Office Hours stale commitment resolution
- Office Hours memory schema v4 제안
- Daily card lineage와 structured input contract
- Daily report 확장
- Swift UI surface 요구사항
- Sidecar prompt와 memory behavior 요구사항
- 구현 테스트 요구사항

### 3.2 제외 범위

- 기존 `.agentic30` workspace state의 자동 rewrite
- `docs/ICP.md`, `docs/GOAL.md`, `docs/VALUES.md`, `docs/SPEC.md` 자동 수정
- PostHog active user 집계 정의 변경
- Foundation summary flow 재설계
- 후보 pipeline CRM 기능
- 다중 후보 pool 강제
- Agentic30이 사용자를 대신해 고객에게 연락하거나, 대신 인터뷰하거나, 대신 판매하는 agency 기능

## 4. 현재 Failure Mode

### 4.1 관찰된 상태

Dogfood에서 익명화해 보존할 패턴은 다음과 같다.

- Daily digest는 `buildWithoutCustomerEvidence: true`를 감지한다.
- Office Hours memory는 `후보 A` 관련 약속을 open/carry 상태로 유지한다.
- 최근 turn들은 "검증 자료 요청", "아직 보내지 못했다", "증거가 없다", "오늘은 보류"를 반복한다.
- Evidence debt는 hard customer evidence가 없다고 판단한다.
- Pending card도 다시 같은 후보와 같은 action을 묻는다.

이 상태에서 Office Hours가 강하게 압박하는 것은 맞다. 하지만 같은 질문을 3일, 4일 반복하면 사용자는 실제 다음 행동을 얻지 못한다.

### 4.2 Root Cause

기술적 root cause는 "open debt"를 "same contact forever"로 해석하는 데 있다.

구조적으로는 두 축이 섞였다.

- Commitment evidence axis: 약속이 실행됐는가, hard evidence가 있는가, 자기보고로라도 해소됐는가
- Candidate lifecycle axis: 이 후보가 계속 유효한가, 부적합한가, 채널이 막혔는가, 다음 후보로 넘어갔는가

v2의 첫 구현 slice는 commitment evidence axis를 먼저 고친다. 이것은 제품 MVP를 commitment 기능으로 축소한다는 뜻이 아니다. 제품 v2는 여전히 daily AI-agent/revenue loop 전체를 목표로 하며, Candidate lifecycle은 이 slice에서 최소한의 resolution reason만 기록하고 별도 CRM이나 후보 pool 기능으로 키우지 않는다.

## 5. v2 프로그램 루프

### 5.1 Daily AI-Agent Loop

매일 프로그램은 다음 순서로만 전진한다.

```text
Evidence Read -> AI Agent Workpack -> Founder External Action -> Proof Close -> Next-Day Adaptation
```

1. **Evidence Read:** local-first workspace, proof ledger, Office Hours memory, mission-card 상태, source state를 읽는다. `docs/SPEC.md`의 core loop처럼 프로젝트 path, 업무 기록, 인터뷰, BIP 기록이 입력이다.
2. **AI Agent Workpack:** AI Agent가 오늘의 `agentWorkpack`을 만든다. workpack은 action을 준비하지만 proof가 아니다.
3. **Founder External Action:** 사용자가 고객, 채널, 제품 계측, 결제 흐름에서 직접 외부 행동을 실행한다.
4. **Proof Close:** 사용자가 accepted evidence를 제출하거나, 증거가 없으면 missing/stale/manual_proof_required/rejected 상태를 명시한다.
5. **Next-Day Adaptation:** 다음 날 mission-card와 Office Hours lens는 닫힌 증거, negative evidence, source state, gate 상태에 맞게 바뀐다.

AI outputs are not proof. AI 산출물, workpack, 초안, 분석, 코드 snippet, AI demo는 사용자가 외부 행동을 실행하고 accepted evidence를 제출하기 전까지 증거가 아니다.

### 5.2 `agentWorkpack` Contract

`agentWorkpack`은 매일 AI Agent가 제공하는 실행 준비물이다. 구현은 기존 provider/sidecar/mission/Office Hours 표면을 재사용하며, 새 AI provider나 새 agent runtime을 요구하지 않는다.

허용 work type:

- outreach/customer copy
- offer/paid ask
- ICP/source analysis
- channel experiment
- first_value instrumentation snippet
- activation friction fix
- evidence capture checklist
- follow-up plan

모든 `agentWorkpack`은 최소 다음 필드를 가진다.

```json
{
  "id": "workpack_day_14_g4",
  "workType": "offer/paid ask",
  "targetExternalAction": "오늘 18:00까지 ICP 후보 1명에게 가격, 받을 결과, 기한이 포함된 유료 ask DM을 발송한다.",
  "expectedProof": "발송 캡처, 발송 시각, 수신자 식별자, yes/no/no-reply 원문",
  "notProof": [
    "AI가 쓴 DM 초안",
    "보낼 예정이라는 자기보고",
    "paymentIntent가 없는 가격 아이디어"
  ],
  "owner": "founder",
  "deadline": "2026-06-20T18:00:00+09:00"
}
```

필드 의미:

| Field | Meaning | Rule |
|---|---|---|
| `targetExternalAction` | 오늘 사용자가 외부에서 실행할 단일 행동 | 고객/채널/계측/결제/증거 제출 중 하나로 좁힌다 |
| `expectedProof` | Proof Close에서 accepted가 될 수 있는 증거 | 캡처, URL, provider 기록, PostHog/Cloudflare source, 원문 응답 등 |
| `notProof` | 성공으로 계산하면 안 되는 산출물 | AI output, 자기보고, 내부 Git activity, vanity metric을 명시한다 |
| `owner` | 실행 책임자 | 기본값은 `founder`; AI Agent는 준비만 담당한다 |
| `deadline` | 오늘 닫을 시간 | stale 판정과 Next-Day Adaptation 입력이 된다 |

### 5.3 Daily Cards

매일 프로그램은 기본적으로 두 장의 Office Hours 카드를 만든다.

1. Card 1: Evidence State Transition
2. Card 2: AI Agent Workpack / Risk-Based Lens

Card 1은 stale debt나 `buildWithoutCustomerEvidence=true`가 있을 때 항상 먼저 나온다. Card 2는 Card 1이 닫히거나 명시적으로 오늘 상태가 정리된 뒤에 나온다.

### 5.4 Card 1: Evidence State Transition

Card 1의 목적은 조언이 아니라 상태 전이다.

카드가 묻는 것:

- hard evidence를 붙일 수 있는가
- 미실행이면 왜 미실행인가
- 후보나 채널 문제인가
- 오늘 반복 부채를 닫고 다음 단일 후보/action으로 넘어갈 것인가

Card 1은 사용자가 다음 중 하나를 고르게 해야 한다.

- Evidence attached: hard evidence 제출
- Resolve without evidence: 자기보고로 반복 부채 해소
- Replace candidate/action: 다음 단일 후보와 action 입력
- Keep open for today: 오늘 다시 실행하되 stale count를 유지

`keep open for today`는 기본값이 아니다. 2회 반복 이후에는 제품이 강하게 압박해야 한다.

### 5.5 Card 2: AI Agent Workpack / Risk-Based Lens

Card 2는 현재 프로그램 risk에 따라 오늘의 `agentWorkpack`과 lens를 동적으로 선택한다.

Lens 후보:

- Service planning: 누구에게 어떤 유료/시간 요구를 할지, offer와 wedge가 맞는지
- Technical implementation: 지금 코드가 검증 action을 막고 있는지, 계측/배포/증거 capture가 되는지
- UI/UX: 사용자가 첫 가치를 보거나 증거를 남기는 과정이 막히는지
- Risk/tradeoff: 빌드 도피, 허위 진행, 후보 과적합, scope creep, founder time allocation
- Acquisition/channel: 어떤 source와 channel experiment로 named contact 또는 active user를 만들지

선택 규칙:

- 고객 증거 부채가 active면 Service planning 또는 Risk/tradeoff를 우선한다.
- 증거를 받을 대상은 있는데 제품 사용 자체가 막히면 Technical implementation을 고른다.
- 사용자가 제품을 보거나 activation을 완료했지만 friction이 높으면 UI/UX를 고른다.
- 반복 자기보고가 많으면 Risk/tradeoff를 고른다.
- activeUsers100 scoreboard가 정체되면 Acquisition/channel 또는 activation friction fix workpack을 만든다.
- firstRevenue scoreboard가 정체되면 offer/paid ask 또는 follow-up plan workpack을 만든다.

Card 2는 Card 1의 부채를 덮어쓰지 않는다. Card 1이 끝나지 않았으면 Card 2는 "부채 이후 질문"으로만 보인다.

## 6. Program Scoreboards

### 6.1 `activeUsers100`

`activeUsers100`는 사용자의 제품에서 `first_value` 또는 core activation action을 완료한 고유 사용자/계정만 센다. 목표는 "활성 사용자 100명"이며, 100 leads, 100 visitors, 100 signups, waitlist 100명, AI demo 100개로 약화하지 않는다.

Accepted:

- PostHog HogQL에서 확인된 unique identity + `first_value`/core activation completion
- explicitly implemented equivalent source adapter에서 확인된 unique identity + `first_value`/core activation completion

`manual_proof_required`는 provisional/manual evidence와 next unblock action을 기록할 수 있는 source-unavailable 상태다. 그러나 `manual_proof_required` 자체는 gate pass가 아니며, `activeUsers100`, G5, G7을 통과시키지 않는다. provisional evidence가 나중에 PostHog HogQL 또는 approved equivalent source adapter로 verified되기 전까지 active user accepted count는 증가하지 않는다.

Excluded:

- signup, 가입자 수
- visitor, 방문자 수
- waitlist 등록
- screenshots 제출 수치
- AI-generated demos
- self-report, 자기보고
- Git activity, 내부 task 완료

self-report는 activation learning signal로 남길 수 있지만 활성 사용자로 계산하지 않는다. 자기보고는 활성 사용자로 계산하지 않는다.

### 6.2 `firstRevenue`

`firstRevenue`는 `paymentRecord` 기반 결제 완료 또는 presale deposit만 성공으로 센다. 금액 하한은 없다.

Accepted:

- 결제 provider의 payment completion record
- 계좌 입금/예약판매 선입금 캡처와 거래 시각
- `paymentRecord` proof-ledger event가 accepted/verified 상태인 경우

Learning signals, not success:

- `paymentIntent`
- paid ask 발송
- 명시적 refusal
- payment failure
- refund
- 가격 문의, 구두 관심, waitlist

`paymentIntent`, 유료 ask, 거절, 실패, 환불은 revenue learning signal이다. `paymentRecord`가 없으면 `firstRevenue.acceptedCount`는 0으로 남는다.
`paymentIntent`는 첫 매출이 아니다.

### 6.3 Source States

Scoreboard source state는 다음 값만 허용한다.

| State | Meaning | Next unblock action |
|---|---|---|
| `ready` | source가 연결되어 최신 증거를 읽을 수 있음 | scoreboard에 반영 |
| `missing` | source 자체가 없음 | `agentWorkpack`에 evidence capture checklist 또는 instrumentation snippet 생성 |
| `stale` | source가 오래되어 오늘 판단에 부적합 | 재수집 또는 manual proof 요구 |
| `manual_proof_required` | 자동 source가 없어 사용자 증거가 필요 | 사용자가 캡처/URL/provider record 제출 |
| `rejected` | 제출 증거가 vanity/self-report/불충분 | Proof Close에서 rejection reason 기록 후 다음 action 생성 |

### 6.4 Daily Report / Proof Ledger Example

```json
{
  "programScoreboards": {
    "activeUsers100": {
      "target": 100,
      "acceptedCount": 7,
      "excludedCounts": {
        "signup": 42,
        "visitor": 1380,
        "waitlist": 12,
        "self-report": 3,
        "aiDemo": 4
      },
      "sourceState": "ready",
      "source": {
        "kind": "posthog_hogql",
        "event": "first_value",
        "checkedAt": "2026-06-20T09:00:00+09:00"
      },
      "nextUnblockAction": "activation friction fix workpack: Day 21 관찰에서 막힌 첫 가치 단계를 수정한다."
    },
    "firstRevenue": {
      "target": 1,
      "acceptedCount": 0,
      "sourceState": "manual_proof_required",
      "sources": [
        {
          "type": "paymentIntent",
          "status": "accepted",
          "countsAsRevenue": false
        },
        {
          "type": "paymentRecord",
          "status": "missing",
          "countsAsRevenue": true
        }
      ],
      "nextUnblockAction": "offer/paid ask follow-up plan: 결제 링크 또는 선입금 계좌를 포함해 2명에게 재요청한다."
    }
  },
  "proofLedgerMapping": {
    "payment_intent": "firstRevenue.learningSignal",
    "payment_record": "firstRevenue.acceptedProof",
    "traffic_snapshot": "activeUsers100.contextOnly",
    "first_value": "activeUsers100.acceptedProof"
  }
}
```

## 7. 30일 Roadmap and Adaptive Gates

### 7.1 Week-Level Roadmap

| Week | Outcome | Scoreboard movement | AI-agent workpack type | Founder-owned external action | Expected Proof | Adaptive failure branch |
|---|---|---|---|---|---|---|
| Week 1 | demand/contact proof | named contact evidence, first paid ask 준비 | outreach/customer copy, ICP/source analysis, offer draft | ICP 후보에게 과거 행동 질문, 문제 증거 요청, 첫 유료 ask 발송 | 인터뷰 원문, DM 발송 캡처, source URL, yes/no/no-reply | named contact 0이면 Card 1 stale 해소 후 source analysis workpack; G2 실패 시 foundation 재실행 |
| Week 2 | first_value instrumentation and paid ask | `activeUsers100` sourceState를 `ready`로 만들고 `paymentIntent` strong ≥1 | first_value instrumentation snippet, offer/paid ask, evidence capture checklist | 제품에 first_value를 심고 가격/받을 결과/기한이 있는 ask 발송 | HogQL first_value ≥1행, 발송 캡처+시각 | **G4** 실패 시 `g4-recovery-ask-resend` 또는 `g4-recovery-instrumentation` |
| Week 3 | acquisition/channel experiments and active users | active user ≥1, traffic source 확인 | channel experiment, activation friction fix, follow-up plan | 공개 포스트/outreach/관찰을 실행하고 첫 가치 완료까지 밀어넣음 | 게시 URL, DM 캡처, traffic snapshot, first_value 고유 사용자 | **G5** 실패 시 `g5-recovery-channel-reselect` 또는 `g5-recovery-outreach-rerun` |
| Week 4 | revenue loop/referrals/Day 30 continue-pivot-stop | `firstRevenue` paymentRecord 또는 반복 paid ask/refusal 학습 | offer/paid ask follow-up, referral ask, revenue proof checklist | 결제 링크/선입금 요청, referral 요청, Day 30 근거 결정 | paymentRecord, presale deposit, refusal 원문, referral 원문, 근거 증거 ≥3 | **G6** 실패 시 `g6-recovery-ask-and-refusal`; **G7** 실패 시 graduation hold |

각 week는 proof-led execution이다. 일반론형 커리큘럼 문구나 내부 학습 완료를 Day success로 쓰지 않는다.

### 7.2 Day-Level Roadmap

| Day | Focus | agentWorkpack | Founder External Action | Expected Proof | Gate / recovery |
|---:|---|---|---|---|---|
| Day 1 | ICP/문제/결과 정렬 | ICP/source analysis + outreach copy | named contact 1명에게 첫 인터뷰/증거 요청 커밋 | commitment + 후보/채널/기대증거 | G1 준비 |
| Day 2 | demand source 확인 | ICP/source analysis | 유료 대안/광고/리뷰 source 5개 수집 | source URL ≥3, 가격/리뷰 기록 | 증거 0이면 source 축소 |
| Day 3 | Mom Test 접촉 | outreach/customer copy | 과거 행동 질문으로 고객 1명 접촉 | script + 접촉/응답 캡처 | G1 retro-check |
| Day 4 | wedge 정리 | evidence capture checklist | SPEC 약한 섹션과 고객 증거 연결 | worksheet + diff | 실패 시 미션 축소 |
| Day 5 | demand signal | ICP/source analysis | 돈 낼 후보 1명과 숫자 출처 확정 | demand signal note + 캡처 | 관심만 있으면 AR-03 |
| Day 6 | paid ask 초안/발송 | offer/paid ask | 가격, 받을 결과, 기한이 있는 ask 발송 | paymentIntent strong | G3 warning |
| Day 7 | foundation decision | follow-up plan | continue/pivot/stop/restart 결정 | foundation summary + dayDecision | G2 |
| Day 8 | core action | activation friction fix | 첫 가치 행동 1개와 성공 화면 정의 | core action spec + 관찰 | G2 통과 필요 |
| Day 9 | input/output flow | activation friction fix | 30초 흐름을 고객 입력으로 시연 | demo/flow 캡처 | failure면 carry |
| Day 10 | 10x result | follow-up plan | 핵심 결과 화면만 품질 투자 | worksheet | 비차단 |
| Day 11 | no-login path | activation friction fix | 첫 가치까지 클릭 수 측정/관찰 | 클릭 수 + 관찰 원문 | friction이면 수정 |
| Day 12 | E2E dogfood | evidence capture checklist | 실제 입력으로 end-to-end 실행 | dogfood log + 캡처 | failure면 carry |
| Day 13 | promise | outreach/customer copy | 약속 문장을 고객 1명에게 보여줌 | 반응 원문 | 인터뷰 누적 부족이면 OH |
| Day 14 | measurement | first_value instrumentation snippet + paid ask | first_value 계측 삽입, 유료 ask 미완 시 발송 | HogQL first_value ≥1행 + paymentIntent | **G4** |
| Day 15 | revenue dry run | offer/paid ask | 결제/예약판매 경로 dry run | 결제 경로 캡처 | G4 recovery 가능 |
| Day 16 | release readiness | evidence capture checklist | 출시 계정/정산/세금 체크 | worksheet | G4 recovery 가능 |
| Day 17 | build retro | activation friction fix | 7일 사용 로그로 유지/삭제 결정 | decision memo + active user snapshot | active user 정체면 fix |
| Day 18 | launch story | outreach/customer copy | 반복 인용으로 hook 3개 작성 | hook + 인용 출처 | copy 약하면 재작성 |
| Day 19 | public proof | channel experiment | Threads/BIP 등 공개 채널 1회 게시 | public URL | traffic source 시작 |
| Day 20 | outreach batch | channel experiment | 후보 20명 정리, 개인화 DM 10개 발송 | DM 캡처 + 응답 sheet | 발송 <5면 mini-action |
| Day 21 | observe | activation friction fix | 테스터 관찰과 first_value 실측 확인 | traffic snapshot + active user ≥1 | **G5** |
| Day 22 | demo | channel experiment | 60초 demo 공개/전송 | demo URL | G5 recovery 가능 |
| Day 23 | paid learning | offer/paid ask | 유료 소재/중단 기준 설계 | worksheet + paid ask 후보 | G5 recovery 가능 |
| Day 24 | launch decision | follow-up plan | 채널별 숫자로 다음 7일 결정 | channel decision + source snapshot | vanity metric이면 rejected |
| Day 25 | activation | activation friction fix | first_value 이탈 1곳 수정 | before/after + first_value snapshot | activeUsers100 이동 |
| Day 26 | referral | outreach/customer copy | 만족/반응 사용자에게 소개 요청 | referral ask 원문 | referral 없으면 source 재선택 |
| Day 27 | revenue ask | offer/paid ask | 결제 링크/선입금 조건으로 재요청 | paymentIntent 또는 paymentRecord | G6 준비 |
| Day 28 | revenue review | revenue proof checklist | paymentRecord/presale/refusal 원문 정리 | paymentRecord 또는 refusal 원문 | **G6** |
| Day 29 | recovery / final proof | follow-up plan | 부족한 결제/활성/근거 증거 1개 보강 | accepted proof ≥1 | G6 recovery |
| Day 30 | continue/pivot/stop | evidence capture checklist | 근거 증거 ≥3으로 continue/pivot/stop 결정 | dayDecision + 증거 참조 ≥3 | **G7** |

### 7.3 Gate Recovery Names

- **G4 paid ask + first_value:** `g4-recovery-ask-resend`, `g4-recovery-instrumentation`
- **G5 traffic + active user:** `g5-recovery-channel-reselect`, `g5-recovery-outreach-rerun`
- **G6 revenue validation:** `g6-recovery-ask-and-refusal`
- **G7 final decision:** `g7-graduation-hold`

Recovery branch도 workpack만으로 완료되지 않는다. 사용자가 외부 행동을 실행하고 accepted proof를 제출해야 해제된다.

## 8. Stale Commitment Policy

### 8.1 Trigger

같은 candidate와 같은 action이 2회 반복되고 hard evidence가 없으면 stale commitment로 판정한다.

반복 판단 key:

- `candidateName`
- `actionKind`
- `actionText` normalized hash
- `expectedEvidenceKind`

candidateName이 비어 있으면 actionText에서 이름을 heuristic으로 뽑지 않는다. 대신 `candidateNameMissing` risk를 기록하고, 다음 카드에서 이름 입력을 요구한다. 이름 추출 실패를 숨기지 않는다.

### 8.2 Same Candidate, One-at-a-Time

v2는 후보 pool을 강제하지 않는다. 초기 사용자는 CRM을 관리하는 게 아니라 한 명에게 진짜 요구를 보내야 한다.

정책:

- 한 번에 한 후보만 active candidate로 둔다.
- stale 해소 후 다음 후보를 입력할 수 있다.
- "다음 후보 없음"도 유효한 부정 증거다.
- 후보 없음은 ICP/source problem으로 report에 남긴다.

### 8.3 Self-Report Semantics

자기보고는 반복 부채를 닫을 수 있다.

하지만 자기보고는 다음으로 계산하지 않는다.

- customer evidence
- active user progress
- revenue proof
- accepted proof-ledger event
- Day 30 success evidence

자기보고가 할 수 있는 일:

- 같은 질문 반복 중지
- negative evidence 기록
- 다음 risk lens 선택에 반영
- report에 "해소됐지만 증거 아님"으로 표시

### 8.4 Strong Pressure Copy

문구는 약하게 만들지 않는다. 다만 모든 hard callout은 상태 전이 선택지로 끝나야 한다.

Bad:

> 아직 후보 A에게 요청하지 않았습니다. 오늘 어떻게 실행할까요?

Good:

> 2일째 같은 약속이 증거 없이 반복되고 있습니다. 이건 진행이 아니라 정지입니다. 지금 상태를 하나로 정리하세요: 보냈다는 증거를 붙이거나, 못 보낸 이유를 기록하고 이 반복 부채를 닫거나, 다음 한 명에게 보낼 action으로 교체하세요.

압박의 목적은 shame이 아니라 state transition이다.

## 9. Resolution Reasons

`resolution.reason`은 다음 6개 값만 허용한다.

| Reason | Meaning | Counts as customer evidence | Typical next step |
|---|---|---:|---|
| `not_sent` | 사용자가 보내지 않았다고 인정 | false | 오늘 보낼 문장 확정 또는 다른 action으로 축소 |
| `message_not_ready` | 보낼 문장/offer가 막힘 | false | Card 2를 Service planning으로 선택 |
| `channel_blocked` | 연락 채널이 없거나 접근 불가 | false | 다음 단일 후보 또는 다른 채널 지정 |
| `wrong_candidate` | 이 후보가 ICP/상황상 부적합 | false | ICP/source risk 기록, 다음 후보 지정 |
| `candidate_exhausted` | 현재 후보군이 비었음 | false | acquisition/source action으로 전환 |
| `replaced_by_next_candidate` | 다음 한 명과 action으로 교체 | false unless hard evidence attached | 새 commitment 생성 |

`replaced_by_next_candidate`는 교체 자체만으로 evidence가 아니다. 교체와 동시에 새 메시지를 실제 발송한 hard evidence가 붙으면 별도 evidence event로 기록한다.

## 10. Memory Schema v4

### 10.1 Version

`office-hours-memory`는 schema v4를 제안한다.

Migrations:

- v3 이하 commitment는 `resolution: null`로 읽는다.
- 기존 `open`, `missed`, `carried_forward`는 그대로 유지한다.
- stale detection은 migration에서 state를 바꾸지 않는다.
- 다음 Office Hours run에서 resolution card를 생성한다.

### 10.2 Commitment Fields

`commitments[]`에 다음 필드를 추가한다.

```json
{
  "id": "commitment_...",
  "status": "resolved_without_evidence",
  "candidateName": "후보 A",
  "actionKind": "request_validation_material",
  "actionText": "검증 자료를 요청한다",
  "expectedEvidenceKind": "screenshot",
  "repeatCountWithoutEvidence": 2,
  "resolution": {
    "reason": "not_sent",
    "source": "self_report",
    "note": "오늘은 보내지 못했고 반복 부채를 닫음",
    "resolvedAt": "2026-06-20T00:00:00.000Z",
    "countsAsCustomerEvidence": false
  }
}
```

### 10.3 Status Values

Supported status values:

- `open`
- `met`
- `missed`
- `abandoned`
- `carried_forward`
- `resolved_without_evidence`

`resolved_without_evidence`는 active debt에서 제외한다. 단, report와 negative evidence summary에는 남긴다.

### 10.4 Active Debt Exclusion

`activeDebtCommitments()` 또는 동등 함수는 다음을 active debt에서 제외한다.

- `met`
- `abandoned`
- `status === "resolved_without_evidence"`이고 `resolution.countsAsCustomerEvidence === false`인 commitment

단, `resolved_without_evidence`는 "성공"이 아니다. program score와 evidence count는 증가하지 않는다.

## 11. Daily Card and Bridge Contract

### 11.1 Card Lineage

Stale commitment resolution은 더 이상 독립 기능이 아니다. `office_hours_stale_commitment_resolution`은 broader daily card contract 안의 Card 1 lineage이며, 매일 프로그램은 같은 envelope 안에서 workpack, scoreboard, gate를 전달한다.

허용되는 daily card event type은 다음 네 가지뿐이다.

| Type | Role | Required when |
|---|---|---|
| `office_hours_state_transition` | Card 1: stale debt, missing proof, invalid source state를 명시적으로 상태 전이 | stale debt 또는 missing/rejected proof가 있으면 첫 카드 |
| `office_hours_agent_workpack` | Card 2: AI Agent가 오늘 founder-owned external action을 준비 | Card 1이 닫혔거나 오늘 상태가 정리된 뒤 |
| `program_scoreboard_snapshot` | Daily report/side panel: `activeUsers100`와 `firstRevenue`의 accepted/excluded/source 상태 | 매일 report 생성 시 |
| `revenue_or_activation_gate` | Gate card: G4-G7에서 activation/revenue 조건과 recovery branch를 표시 | milestone gate 또는 recovery가 필요할 때 |

모든 card는 `generation.signalId`, `generation.signalLabel`, `programDay`, `schemaVersion`, `sourceState`, `requiresUserAction`, `proofLedgerMapping`을 가져야 한다. source가 없거나 오래됐으면 hidden fallback을 쓰지 않고 `sourceState: "missing" | "stale" | "manual_proof_required" | "rejected"`를 그대로 보낸다.

### 11.2 Card 1 Payload: `office_hours_state_transition`

Stale commitment resolution card는 다음 generation metadata를 가진다.

```json
{
  "type": "office_hours_state_transition",
  "generation": {
    "signalId": "office_hours_stale_commitment_resolution",
    "signalLabel": "Office Hours 반복 약속 해소"
  },
  "schemaVersion": 2,
  "programDay": 14,
  "sourceState": "manual_proof_required",
  "commitmentId": "commitment_...",
  "candidateName": "후보 A",
  "actionText": "검증 자료 요청",
  "repeatCountWithoutEvidence": 2,
  "requiresUserAction": true,
  "choices": [
    {
      "id": "attach_evidence",
      "label": "증거 붙이기",
      "requiresEvidence": true
    },
    {
      "id": "resolve_without_evidence",
      "label": "증거 없이 반복 부채 닫기",
      "requiresResolutionReason": true
    },
    {
      "id": "replace_candidate",
      "label": "다음 한 명으로 교체",
      "requiresNextCandidate": true
    },
    {
      "id": "keep_open_today",
      "label": "오늘 다시 실행",
      "discouraged": true
    }
  ],
  "resolutionReasons": [
    "not_sent",
    "message_not_ready",
    "channel_blocked",
    "wrong_candidate",
    "candidate_exhausted",
    "replaced_by_next_candidate"
  ],
  "proofLedgerMapping": {
    "self_report": "officeHoursResolution.negativeEvidenceOnly",
    "customer_screenshot": "customerEvidence.acceptedProof"
  }
}
```

### 11.3 Card 2 Payload: `office_hours_agent_workpack`

`office_hours_agent_workpack`는 section 5.2의 `agentWorkpack`을 Office Hours card로 노출한다. Sidecar는 다음 필드를 bridge event payload에 포함해야 한다.

```json
{
  "type": "office_hours_agent_workpack",
  "schemaVersion": 1,
  "programDay": 14,
  "selectedLens": "service_planning",
  "workpack": {
    "id": "workpack_day_14_g4",
    "workType": "offer/paid ask",
    "targetExternalAction": "오늘 18:00까지 ICP 후보 1명에게 가격, 받을 결과, 기한이 포함된 유료 ask DM을 발송한다.",
    "expectedProof": "발송 캡처, 발송 시각, 수신자 식별자, yes/no/no-reply 원문",
    "notProof": ["AI가 쓴 DM 초안", "보낼 예정이라는 자기보고"],
    "owner": "founder",
    "deadline": "2026-06-20T18:00:00+09:00"
  },
  "sourceState": "ready",
  "requiresUserAction": true,
  "proofLedgerMapping": {
    "paymentIntent": "firstRevenue.learningSignal",
    "paymentRecord": "firstRevenue.acceptedProof"
  }
}
```

Bridge decoder expectation(브리지 디코더 기대사항): Swift `SidecarEvent` must decode `mission_card` payloads whose inner `type` is `office_hours_agent_workpack` without losing nested `workpack`, `sourceState`, or `proofLedgerMapping`. Unknown `workType`, missing `targetExternalAction`, missing `expectedProof`, missing `owner`, or empty `notProof` must fail explicitly with an error such as `ERR_MALFORMED_AGENT_WORKPACK`; do not synthesize defaults.

UI behavior(UI 동작): Swift UI shows this as the second daily card, after any unresolved Card 1. It must label the AI output as preparation, not proof, and keep the primary action on the founder-owned external action plus proof submission.

### 11.4 Scoreboard Payload: `program_scoreboard_snapshot`

`program_scoreboard_snapshot` is a contract-level bridge payload for the two program scoreboards.

```json
{
  "type": "program_scoreboard_snapshot",
  "schemaVersion": 1,
  "programDay": 21,
  "scoreboards": {
    "activeUsers100": {
      "acceptedCount": 7,
      "excludedCounts": {
        "signup": 42,
        "visitor": 1380,
        "self-report": 3
      },
      "sourceState": "ready",
      "nextUnblockAction": "activation friction fix workpack"
    },
    "firstRevenue": {
      "acceptedCount": 0,
      "sourceState": "manual_proof_required",
      "nextUnblockAction": "offer/paid ask follow-up plan"
    }
  }
}
```

Bridge decoder expectation(브리지 디코더 기대사항): Swift `SidecarEvent` must preserve accepted counts, excluded counts, source state, and next unblock action. Missing source state, invalid proof mapping, or self-report counted as accepted proof must reject/fail explicitly with `ERR_MISSING_SOURCE_STATE`, `ERR_INVALID_PROOF_MAPPING`, or `ERR_SELF_REPORT_COUNTED_AS_PROOF`.

UI behavior(UI 동작): The UI must visually separate accepted counts from excluded counts. Self-report can appear as negative evidence or learning, but never as active user or revenue progress.

### 11.5 Gate Payload: `revenue_or_activation_gate`

`revenue_or_activation_gate` describes the current G4-G7 gate without running code inside Swift.

```json
{
  "type": "revenue_or_activation_gate",
  "schemaVersion": 1,
  "gate": "G4",
  "requires": ["first_value", "paymentIntent"],
  "satisfied": false,
  "blockingReasons": ["missing first_value source", "paymentRecord missing"],
  "recoveryBranch": "g4-recovery-instrumentation",
  "sourceState": "missing",
  "nextCardType": "office_hours_agent_workpack"
}
```

Bridge decoder expectation(브리지 디코더 기대사항): unknown card type, unknown gate, missing blocking reason, or missing source state must fail explicitly. The bridge should surface the root cause rather than downgrade to a generic mission card.

UI behavior(UI 동작): The UI presents the gate as a blocking program state with the recovery branch and next external action. It must not mark the day complete until accepted proof satisfies the gate.

### 11.6 Submission Contract

Resolution submission은 다음 중 하나여야 한다.

```json
{
  "commitmentId": "commitment_...",
  "choice": "resolve_without_evidence",
  "resolution": {
    "reason": "not_sent",
    "source": "self_report",
    "note": "못 보냈다. 오늘은 반복 부채를 닫고 다음 후보를 찾는다.",
    "countsAsCustomerEvidence": false
  }
}
```

또는:

```json
{
  "commitmentId": "commitment_...",
  "choice": "replace_candidate",
  "resolution": {
    "reason": "replaced_by_next_candidate",
    "source": "self_report",
    "note": "후보 A 대신 김OO에게 같은 요청을 보낸다.",
    "countsAsCustomerEvidence": false
  },
  "nextCommitment": {
    "candidateName": "김OO",
    "actionKind": "request_validation_material",
    "actionText": "오늘 21:00까지 검증 자료 요청 DM 발송",
    "expectedEvidenceKind": "screenshot"
  }
}
```

Invalid submissions:

- `countsAsCustomerEvidence: true` with `source: self_report`
- resolution reason outside the six allowed values
- `replace_candidate` without `nextCommitment.candidateName`
- `attach_evidence` without evidence reference
- empty note for non-evidence resolution
- malformed `office_hours_agent_workpack` missing required fields
- invalid `proofLedgerMapping` where a source maps to the wrong scoreboard
- missing `sourceState` on any daily card payload
- unknown card type or gate type
- any self-report counted as proof, active user progress, or revenue proof

Invalid submissions fail explicitly. Implementations should reject with typed errors such as `ERR_MALFORMED_AGENT_WORKPACK`, `ERR_INVALID_PROOF_MAPPING`, `ERR_MISSING_SOURCE_STATE`, `ERR_UNKNOWN_CARD_TYPE`, and `ERR_SELF_REPORT_COUNTED_AS_PROOF`. The product preference is root-cause exposure over meaningless fallback or recovery logic.

## 12. Prompt Rules

### 12.1 Evidence-First Rule

Day 2+에서 `buildWithoutCustomerEvidence=true`이고 stale debt가 있으면 prompt는 Card 1을 먼저 생성해야 한다.

Prompt invariant:

> The first card must resolve the stale customer-evidence commitment. Do not ask broad discovery, strategy, implementation, or UI questions until this commitment has a state transition.

### 12.2 No Infinite Contact Rule

같은 candidate/action이 threshold를 넘으면 prompt는 더 이상 "오늘 어떻게 보낼까요?"를 첫 질문으로 쓰지 않는다.

대신:

- hard evidence attach
- self-report resolution
- next candidate/action replacement
- keep open with explicit risk

중 하나를 요구한다.

### 12.3 Risk Lens Rule

Card 2는 risk signal에 따라 하나만 고른다.

Prompt에는 다음을 포함한다.

- selected lens
- why this lens was selected
- which signal triggered it
- what answer would change tomorrow's program

## 13. Swift UI Requirements

### 13.1 Daily Card Stack

Swift UI는 daily card stack을 다음 순서로 보여준다.

1. `office_hours_state_transition`
2. `office_hours_agent_workpack`
3. `program_scoreboard_snapshot`
4. `revenue_or_activation_gate`

`office_hours_state_transition`은 passive banner가 아니다. 사용자가 명시적 선택을 해야 한다.

UI requirements:

- 카드 제목은 반복 부채와 후보명을 보여준다.
- 반복 횟수를 숨기지 않는다.
- "증거 붙이기"는 primary action이다.
- "증거 없이 닫기"는 resolution reason picker를 연다.
- "다음 한 명으로 교체"는 candidate/action 입력을 요구한다.
- "오늘 다시 실행"은 가능하지만 discouraged state로 표시한다.
- `office_hours_agent_workpack`은 AI 준비물과 founder-owned external action을 분리해 표시한다.
- `program_scoreboard_snapshot`은 accepted count와 excluded count를 같은 숫자로 합치지 않는다.
- `revenue_or_activation_gate`은 G4-G7 blocking reason과 recovery branch를 숨기지 않는다.
- unknown card type, missing source state, invalid proof mapping은 fallback UI가 아니라 decoder/bridge failure로 보여준다.

### 13.2 Copy

YC pressure tone을 유지한다.

예시:

> 2회째 같은 약속이 증거 없이 반복됐습니다. 이건 아직 고객 검증이 아닙니다. 지금 증거를 붙이거나, 실패 이유를 기록하고 닫거나, 다음 한 명으로 교체하세요.

### 13.3 Report Surface

Daily report는 다음을 표시한다.

- stale commitments resolved
- negative evidence reasons
- next single candidate/action
- selected risk lens for Card 2
- self-report resolution count
- customer evidence count, self-report와 분리
- `activeUsers100.acceptedCount`와 excluded vanity counts
- `firstRevenue.acceptedCount`와 payment learning signals
- source unavailable behavior: `missing`, `stale`, `manual_proof_required`, `rejected`
- AI workpack completion state, founder action state, proof close state를 분리

## 14. Daily Report Additions

Report schema에 다음 section을 추가한다.

```json
{
  "officeHoursResolution": {
    "staleCommitmentsResolved": 1,
    "negativeEvidenceReasons": ["not_sent"],
    "nextSingleCandidateAction": {
      "candidateName": "김OO",
      "actionText": "검증 자료 요청 DM 발송"
    },
    "riskLensSelected": {
      "lens": "service_planning",
      "reason": "message_not_ready resolution indicates offer clarity risk"
    },
    "selfReportResolutionCount": 1,
    "customerEvidenceCount": 0
  }
}
```

Report copy must separate "debt resolved" from "evidence earned".

Example:

> 반복 부채 1건은 닫혔지만 고객 증거는 0건입니다. 다음 한 명에게 보낼 action을 오늘 끝내야 합니다.

## 15. Negative Evidence Policy

Negative evidence는 product source docs를 자동 수정하지 않는다.

Allowed sinks:

- Office Hours memory
- Daily digest
- Weekly report
- Program review summary
- Risk lens selection

Disallowed automatic sinks:

- `docs/ICP.md`
- `docs/GOAL.md`
- `docs/VALUES.md`
- `docs/SPEC.md`
- foundation-summary source docs

이 제한은 중요하다. "후보 A에게 못 보냈다"는 실행 데이터이지 ICP를 바꾸는 충분조건이 아니다. 반복적으로 같은 negative evidence가 쌓이면 Office Hours가 source/ICP 질문을 해야 하지만, 문서를 몰래 고치면 안 된다.

## 16. Technical Implementation Notes

### 16.1 Sidecar Modules

Likely sidecar touch points:

- `sidecar/mission-card.mjs`
- `sidecar/office-hours-memory.mjs`
- `sidecar/office-hours-structured-input.mjs`
- `sidecar/office-hours-chat-prompt.mjs`
- `sidecar/daily-office-hours-digest.mjs`
- `sidecar/adaptive-rule-signals.mjs`
- `sidecar/program-gate-engine.mjs`
- `sidecar/execution-os.mjs`
- structured Office Hours input/output handlers in `sidecar/index.mjs`
- mission-card contract tests under `sidecar-tests/...mission-card`
- Office Hours contract tests under `sidecar-tests/...office-hours`

Do not edit `sidecar/vendor/`.

Sidecar responsibilities:

- Build `mission_card` bridge events with inner card types `office_hours_state_transition`, `office_hours_agent_workpack`, `program_scoreboard_snapshot`, and `revenue_or_activation_gate`.
- Preserve `agentWorkpack`, scoreboards, proof mapping, source state, and gate blocking reasons in the payload.
- Reject malformed workpack, invalid proof mapping, missing source state, unknown card type, and self-report counted as proof.
- Keep source-unavailable behavior fail-closed: source unavailable means `missing`, `stale`, or `manual_proof_required`, not fabricated progress.
- Keep dogfood state read-only unless an implementation migration is explicitly written and tested. Public docs must use anonymized fixtures or placeholders, not private workspace records.

### 16.2 Bridge and Swift Decoder Expectations

`AgenticViewModel` can continue to receive `mission_card` and `office_hours_intervention_required`, but the Swift `SidecarEvent` decoder must understand the new inner contracts before any bridge/schema implementation ships.

Required future Swift coverage:

- `agentic30Tests/SidecarEventDecodingTests.swift` decodes `office_hours_agent_workpack`.
- `agentic30Tests/SidecarEventDecodingTests.swift` decodes `program_scoreboard_snapshot`.
- `agentic30Tests/SidecarEventDecodingTests.swift` decodes `revenue_or_activation_gate`.
- `agentic30Tests/SidecarEventDecodingTests.swift` rejects unknown card type, missing source state, and self-report counted as proof.

Bridge-contract edits are not optional-test changes. If sidecar schema or Swift decoder behavior changes, run both `npm run test:sidecar` and `npm run test:swift:unit`.

### 16.3 Detection Algorithm

Pseudo-code:

```js
function classifyCommitmentForOpening(commitment) {
  if (commitment.status === "resolved_without_evidence") {
    return { activeDebt: false, card: null };
  }

  if (commitment.status === "met" || commitment.status === "abandoned") {
    return { activeDebt: false, card: null };
  }

  if (commitment.repeatCountWithoutEvidence >= 2 && !commitment.hasHardEvidence) {
    return {
      activeDebt: true,
      card: "office_hours_stale_commitment_resolution"
    };
  }

  return {
    activeDebt: true,
    card: "office_hours_commitment_followup"
  };
}
```

### 16.4 Migration

Migration must be non-destructive.

- Existing commitments keep current status.
- Add `resolution: null` when missing.
- Add derived `repeatCountWithoutEvidence` lazily if missing.
- Do not mark an anonymized repeated-candidate debt resolved during migration.
- Next Office Hours run should surface resolution card.

### 16.5 Explicit Failure

If daily card submission is malformed, fail explicitly.

Examples:

- unknown reason: reject and log schema error
- self-report with `countsAsCustomerEvidence=true`: reject
- replace without next candidate: reject
- attach evidence without evidence ref: reject
- malformed workpack: reject with `ERR_MALFORMED_AGENT_WORKPACK`
- invalid proof mapping: reject with `ERR_INVALID_PROOF_MAPPING`
- missing source state: reject with `ERR_MISSING_SOURCE_STATE`
- unknown card type: reject with `ERR_UNKNOWN_CARD_TYPE`
- self-report counted as proof: reject with `ERR_SELF_REPORT_COUNTED_AS_PROOF`

Do not silently convert malformed input to a generic note.

## 17. Tradeoffs

### 17.1 Strict Evidence vs Momentum

Strict evidence protects the program from fake progress. But without stale resolution it can reduce velocity to zero.

v2 tradeoff:

- Keep strict evidence for success metrics.
- Allow self-report to close stale loops.
- Make the cost visible in reports.

### 17.2 One Candidate vs Candidate Pool

Candidate pools improve throughput but create CRM overhead. For early solo builders, that overhead can become another avoidance mechanism.

v2 tradeoff:

- Keep one active candidate/action.
- Allow replacement when stale.
- Record candidate exhaustion as negative evidence.

### 17.3 Strong Pressure vs User Fatigue

Soft copy would reduce discomfort but weaken the product's point. Strong copy without state transition creates fatigue.

v2 tradeoff:

- Keep strong YC pressure.
- End every hard callout with explicit choices.
- Stop repeating the same guilt prompt after threshold.

### 17.4 Negative Evidence vs Source Doc Drift

Negative evidence is useful. Auto-editing product docs from one failed contact is dangerous.

v2 tradeoff:

- Store negative evidence in memory and reports.
- Use it to choose the next lens.
- Require human review before source docs change.

## 18. Acceptance Criteria

v2 is implemented when the following are true.

1. The AI-agent loop runs in order: Evidence Read -> AI Agent Workpack -> Founder External Action -> Proof Close -> Next-Day Adaptation.
2. `agentWorkpack` contains `targetExternalAction`, `expectedProof`, `notProof`, `owner`, and `deadline`, and AI output alone is never accepted proof.
3. Same candidate/action repeated twice with no hard evidence generates Card 1 `office_hours_state_transition` with `office_hours_stale_commitment_resolution` lineage.
4. The stale card appears before broad Office Hours prompts when `buildWithoutCustomerEvidence=true`.
5. User can resolve repeated debt via one of six resolution reasons, and `resolved_without_evidence` commitments do not reappear as active debt.
6. Card 2 `office_hours_agent_workpack` selects acquisition, activation, instrumentation, revenue, or risk work based on current signals.
7. `program_scoreboard_snapshot` reports `activeUsers100` and `firstRevenue` with accepted counts, excluded counts, source state, and next unblock action.
8. `activeUsers100` counts only unique `first_value`/core activation users, not signup, visitor, waitlist, screenshot totals, AI demos, or self-report.
9. `firstRevenue` counts only `paymentRecord` or presale deposit; `paymentIntent`, paid ask, refusal, failure, and refund remain learning signals.
10. `revenue_or_activation_gate` blocks G4-G7 progress when first_value, paid ask, active user, paymentRecord, or Day 30 evidence is missing.
11. Source unavailable behavior is explicit: missing integration or stale source becomes `missing`, `stale`, or `manual_proof_required`, never inferred success.
12. Daily report separates debt resolved, evidence earned, active user progress, revenue progress, AI workpack completion, and founder proof close.
13. Existing `.agentic30` state is not rewritten during migration or dogfood unless a tested implementation migration explicitly does so.
14. Malformed workpack, invalid proof mapping, missing source state, unknown card type, and self-report counted as proof fail explicitly.
15. Swift UI forces a state transition choice for stale cards and shows scoreboard/gate cards without combining accepted and excluded counts.

## 19. Test Plan

### 19.1 Spec Verification

- Manually check Markdown headings and relative links.
- Run `git diff --check -- docs/specs/agentic30-30day-adaptive-program-v2.md`.
- Because the v2 target can be untracked, also run `git diff --check --no-index -- /dev/null docs/specs/agentic30-30day-adaptive-program-v2.md` or an equivalent direct whitespace/conflict-marker scan.
- Run `npm run check:public-safety`.

### 19.2 Sidecar Tests

Add or update:

- `sidecar-tests/...mission-card`
  - `mission_card` payload wraps `office_hours_agent_workpack`
  - `mission_card` payload wraps `program_scoreboard_snapshot`
  - `mission_card` payload wraps `revenue_or_activation_gate`
  - unknown card type fails explicitly

- `sidecar-tests/office-hours-memory.test.mjs`
  - stale detection after 2 repeats
  - `resolved_without_evidence` status creation
  - active debt exclusion
  - migration from older memory shape
  - rejection of invalid resolution reasons

- `sidecar-tests/...office-hours`
  - Evidence Read -> AI Agent Workpack -> Founder External Action -> Proof Close -> Next-Day Adaptation ordering
  - malformed workpack rejects with root cause
  - invalid proof mapping rejects with root cause
  - missing source state rejects with root cause
  - self-report counted as proof rejects with root cause

- `sidecar-tests/office-hours-chat-prompt.test.mjs`
  - Day 2+ evidence-first rule
  - stale resolution prompt before broad discovery
  - risk lens prompt generation for Card 2 workpacks
  - strong callout ending in explicit state transition choices

- `sidecar-tests/office-hours-structured-input.test.mjs`
  - daily card payload contract
  - valid self-report resolution
  - valid replace-candidate resolution
  - invalid self-report counted as customer evidence
  - invalid replace without next candidate
  - source unavailable/manual proof required path

- Scoreboard/gate sidecar tests
  - `activeUsers100` accepts only first_value/core activation
  - `firstRevenue` accepts only `paymentRecord`/presale deposit
  - G4-G7 recovery branches produce the right `revenue_or_activation_gate`

Run `npm run test:sidecar` whenever these sidecar contracts change.

### 19.3 Swift Tests

Add or update Swift decoder/UI tests for:

- `agentic30Tests/SidecarEventDecodingTests.swift`
- `office_hours_agent_workpack` decoding
- `program_scoreboard_snapshot` decoding
- `revenue_or_activation_gate` decoding
- `generation.signalId` decoding
- resolution reason picker state
- discouraged `keep_open_today` action
- daily report fields and source unavailable states
- self-report count displayed separately from customer evidence count
- malformed payload rejection for unknown card type, missing source state, invalid proof mapping, and self-report counted as proof

Run `npm run test:swift:unit` whenever bridge/schema contracts change. Bridge-contract edits require both `npm run test:sidecar` and `npm run test:swift:unit`; these tests are not optional when decoder or schema behavior changes.

Do not run blocking UI E2E for docs-only work. Blocking UI E2E stays behind explicit Korean approval: "이 명령은 Agentic30 앱을 전면으로 띄우고 키보드/마우스/포커스를 점유할 수 있습니다. 지금 실행할까요?" Only after approval should the command use `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`.

### 19.4 Dogfood and Public Safety

- Dogfood against an anonymized local state fixture to confirm stale_state behavior uses the latest confirmed spec and plan refs.
- Confirm dogfood verification does not rewrite source state during docs-only verification.
- Run `npm run check:public-safety` before shipping docs.
- If live providers or external integrations are unavailable, tests must exercise manual proof/source-unavailable behavior rather than faking success.

## 20. Rollout Plan

1. Spec rewrite: land the v2 doc with AI-agent loop, scoreboards, roadmap, daily card contracts, failure modes, and product position.
2. Sidecar schema/contracts: add `mission_card` payload support for `office_hours_state_transition`, `office_hours_agent_workpack`, `program_scoreboard_snapshot`, and `revenue_or_activation_gate`.
3. Sidecar validation: add explicit rejection for malformed workpack, invalid proof mapping, missing source state, unknown card type, and self-report counted as proof.
4. Memory and prompt behavior: add schema v4 reader, stale classification, active debt exclusion, evidence-first prompt, and risk lens/workpack prompt.
5. Scoreboards and gates: wire `activeUsers100`, `firstRevenue`, source-unavailable states, and G4-G7 recovery branches.
6. Swift decoder/UI: add `SidecarEvent` decoding, AgenticViewModel handling, card stack UI, scoreboards, and gate presentation.
7. Tests: run `npm run test:sidecar` and `npm run test:swift:unit` for bridge/schema changes; keep UI E2E separate behind explicit Korean approval and `AGENTIC30_ALLOW_BLOCKING_UI_E2E=1`.
8. Dogfood: run against anonymized repeated-candidate state without rewriting it; confirm stale debt becomes Card 1 while Card 2 can still generate acquisition/activation/revenue workpack after state transition.
9. Public-safety: run `npm run check:public-safety` and fix any doc safety issue before release.
10. Gradual rollout: enable internal dogfood first, then beta workspaces, then public release after source-unavailable and malformed-input paths are observed.

## 21. Failure Modes

| Failure mode | Required behavior |
|---|---|
| stale_state | Use latest confirmed spec and plan refs; do not revive stale-only v2 behavior as the whole product |
| dirty_worktree | Preserve unrelated dirty files; implementation scope stays on the v2 spec and evidence artifacts |
| misleading_success_output | Evidence must be non-empty and negative scans must show absence of forbidden success definitions |
| malformed_input | Malformed workpack, invalid proof mapping, missing source state, unknown card type, and self-report-as-proof reject/fail explicitly |
| prompt_injection | Untrusted external text cannot change proof semantics, source docs, or card validation rules |
| source unavailable | Use `missing`, `stale`, or `manual_proof_required`; do not infer active users or revenue |
| cancel_resume | Resume from persisted contract/source state; do not mark proof closed unless accepted evidence exists |
| hung_long_commands | Prefer deterministic static checks and bounded sidecar/Swift unit commands; surface command root cause on failure |
| flaky_tests | Contract tests should be deterministic, local-first, and free of live-provider/time-of-day assumptions |

## 22. Open Questions

These are implementation details, not product blockers.

1. Should `repeatCountWithoutEvidence` be stored or derived from turns every time?
2. Should `keep_open_today` increase the stale count immediately or only after the day closes?
3. Should `resolved_without_evidence` be terminal, or can a later hard evidence event upgrade the same commitment to `met`?
4. Should `replaced_by_next_candidate` create a new commitment synchronously or schedule it for the next Office Hours turn?
5. Should report copy show the person's name when the resolution reason is sensitive?

Default answers:

1. Derive first, store cached count only if performance requires it.
2. Increase after day close.
3. Allow later upgrade only if the evidence directly matches the original action.
4. Create synchronously when next candidate/action is supplied.
5. Show the name locally; redact only in exported/shared reports.

## 23. Product Position

Agentic30은 AI cofounder fantasy가 아니다. 제품 포지션은 "AI Agent가 대신 팔아주는 서비스"가 아니라 "전업 1인 개발자가 AI Agent를 사용해 30일 안에 활성 사용자 100명과 첫 매출 증거를 만드는 local-first execution OS"다.

The product should not become kinder by becoming vague. It should become sharper by distinguishing failure types and by turning AI output into founder-owned market action.

The current loop says:

> You still have not produced evidence. Talk about the same person again.

v2 should say:

> You still have not produced evidence. Use the agent workpack to prepare the next external action, execute it yourself, attach accepted proof, or record why the proof path is blocked.

That is the synthesis: AI-agent leverage without agency overclaim, evidence discipline without contact fixation, and scoreboards that make 100 active users and first revenue visible without counting vanity metrics.

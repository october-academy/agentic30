# Office Hours 성능 최적화

목표: **office-hours 품질(진단력·증거 게이트·카피 계약)은 그대로 유지**하면서, 턴당
불필요한 중복/순차/과한 모델 사용을 줄여 체감 지연과 비용을 낮춘다.

원칙(PHILOSOPHY.md): additive · non-breaking · 로컬 · 간결 기본값. 메인 인터뷰 응답의
모델/effort/프롬프트는 품질 직결이므로 **건드리지 않는다**.

## 검증한 호출 구조 (multi-agent 적대 검증 + 직접 코드 추적으로 확정)

핵심 사실 — **daily digest는 office-hours 세션당 정확히 1회만 수집된다** (Claude·Codex 공통).

- 시작: `runOfficeHours()`(sidecar/index.mjs:8363)는 `office_hours_start`(1501),
  `office_hours_revise_answer`(1617, 수동 재시도), `/office-hours` 슬래시(4638)에서만 진입.
- `prepareDailyOfficeHoursDigest`(index.mjs:6178)의 **유일 호출부는 index.mjs:8837**
  (runOfficeHours 내부, Day 2+ 한정).
- Claude: blocking-continue 모델이라 인터뷰 전체가 단일 `runOfficeHours` 호출 안에서 끝남
  → digest 1회.
- Codex: 카드 답변 후 다음 질문은 `runProviderStream(office_hours_question_continuation)`로
  생성되는데, 이는 `runPrompt`(index.mjs:2216 → 4586) 경로다. 이 경로는
  `activeOfficeHoursContext(session)`(index.mjs:4716)로 **시작 때 만든 in-memory context
  (digest 임베드 포함)를 재사용**하고 `runOfficeHours`로 재진입하지 않는다 → digest 재수집 없음.
- 따라서 per-question continuation hot path는 이미 lean하다: 질문마다 하는 일은 대부분 순수
  CPU(시스템 프롬프트·specialist injection 문자열 빌드)이고 digest/gate/turn-log 디스크
  재로드가 없다.

### Day 2+ 세션 시작 1회에 몰린 비용 (메인 응답 직전, blocking)
1. source gate 평가(index.mjs:8594) — git/gh CLI 서브프로세스 + 외부 MCP readiness
2. preamble 조립(cycle/resume/get_users/dayClosePolicy) — 작은 JSON 디스크 read
3. `prepareDailyOfficeHoursDigest`(8837): 로컬 수집(git/gh) + 외부 수집(MCP digest provider
   호출, long pole) — 단, **외부 호출은 선택된 외부 소스가 있을 때만**
   (`buildExternalOfficeHoursDigestSignals` index.mjs:6131 `if (!externalSources.length)
   return []`). PostHog/Cloudflare 미연결이면 외부 provider 호출은 발생하지 않는다.
4. 메인 인터뷰 LLM 호출 1회(index.mjs:8953) — 사용자 모델/effort. ← 품질 핵심, 불변

**effort는 provider별로 다르다 (정정).** Codex만 executionMode별 effort를 둔다
(`resolveCodexReasoningEffort({executionMode})`): 메인 인터뷰·digest 모두 `low`
(provider-runner.mjs:2158/2161), judge는 deepWork 신호 감지로 `high`(2167). **Claude는
executionMode 인자가 없다**(`resolveClaudeReasoningEffort()`, 2191) — 핀
(`AGENTIC30_CLAUDE_REASONING_EFFORT`)이 없으면 모든 office-hours 호출이 SDK 기본(high)으로
돌고, 메인 인터뷰와 digest가 effort로 구분되지 않는다. 즉 **Claude 기본 사용자는 digest·
commitment 같은 바운드된 헬퍼까지 전부 high**로 실행 중이다(의도된 low는 Codex만 받음). env로는
per-task Claude effort가 불가능(전역 1값)하나, `resolveClaudeReasoningEffort`를 executionMode-
aware로 바꾸면 가능하다 → 아래 [effort 설정 제안]. (앞서 "메인/digest 모두 low"라 적었던 것은
Codex만 맞다.)

## 현재 설정 상태 (모델 · effort) — 재검토 확정

**모델** — `session.model`이 빈 값이면 provider 기본으로 resolve(opus-4-8 / gpt-5.5 / 3.5-flash).

| 태스크 | executionMode | provider 출처 | model 출처 | 결과(기본) |
|---|---|---|---|---|
| 메인 인터뷰 / continuation | `office_hours_question` | session.provider | session.model | opus-4-8 / gpt-5.5 / 3.5-flash |
| Day2+ 외부 digest | `office_hours_digest_read_only` | session.provider | session.model | 〃 |
| commitment 후보 | `office_hours_digest_read_only` | pickMorningBriefing(claude/codex) | 없음→기본 | opus-4-8 / gpt-5.5 |
| 아침 digest / verdict | digest / `judge_read_only` | pickMorningBriefing | 없음→기본 | opus-4-8 / gpt-5.5 |
| **evidence judge** | `judge_read_only` | **session.provider**(seed.provider) | 없음→provider 기본 | claude→opus-4-8 / codex→gpt-5.5 / gemini→3.5-flash |
| (참고) workspace scan | `workspace_scan_read_only` | per-task const | per-task const | sonnet-4-6 / gpt-5.4-mini / 3.5-flash |

judge 정정: `"codex"`는 leaf 기본값(provider 비었을 때 fallback)일 뿐, 정상 경로는
`index.mjs:1989 → writeAllDay1DocHandoff(provider: session.provider) → resolveIddSessionSeed`로
**session.provider를 따른다**(`normalizeSessionProvider`가 claude/codex/gemini 통과). 단 model은
session.model이 아니라 provider 기본(idd-doc-gate가 seed.model 미전달), env
`AGENTIC30_OFFICE_HOURS_DOC_JUDGE_MODEL`로만 고정 가능(cross-provider 단일값 주의).

**effort** — Codex만 executionMode별, Claude/Gemini는 task 무관.

| 태스크 | Codex | Claude | Gemini |
|---|---|---|---|
| 인터뷰 / continuation / digest / commitment | **low** | **high**(SDK 기본) | 모델 기본 |
| 아침 verdict / evidence judge | **high**¹ | **high**(SDK 기본) | 모델 기본 |

¹ `judge_read_only`는 deepWork면 high; office-hours judge 프롬프트가 "failure condition" 하드코딩
→ 정규식 매치 → high. (judge가 Claude면 SDK 기본 high — 어느 provider든 결과는 high.)

**핵심 비대칭:** Codex만 task별 effort(헬퍼=low). **Claude/Gemini는 task 무관 → 바운드된 digest
헬퍼까지 SDK 기본 high.** 이게 Claude 헬퍼의 숨은 비용. env로는 per-task Claude effort 불가(전역
1값) → 아래 [effort 설정 제안].

## 구현 완료 (기본 적용, 동작 불변)

전체 sidecar 스위트 2033 pass / 0 fail / 1 skip로 검증. 둘 다 "세션 시작 1회" 비용을 줄인다.

### OPT-1 — source gate 중복 평가 제거
Day 2+ 시작 시 `evaluateOfficeHoursSourceGate`(git/gh 서브프로세스 + MCP readiness)가
사전 게이트(index.mjs:8594)와 digest 내부(6184)에서 **2회** 실행됐다. 사전에 검증된 게이트를
`runOfficeHours`에서 hoist(`preflightSourceGate`)해 `prepareDailyOfficeHoursDigest`에 주입,
내부 재평가를 생략한다. 같은 workspace/day/sources라 결과 동일, 턴이 단일 window 스냅샷을
공유. 게이트 브로드캐스트(`sendOfficeHoursSourceGate`)는 그대로 유지 → UI 동작 불변.

### OPT-2 — digest 로컬/외부 수집 병렬화
로컬(git/gh)과 외부(MCP) 수집은 공유 `gate`만 읽는 독립 작업인데 순차 `await`였다.
`Promise.all`로 동시 실행 → 벽시계 시간이 `local+external`에서 `max(local, external)`로.
외부 호출이 long pole이라 git/gh probe가 그 뒤에 쌓이지 않고 겹친다.

### OPT-3 — Claude digest effort high→low (executionMode-aware) ✅
`resolveClaudeReasoningEffort()`가 executionMode를 안 받아 Claude는 바운드된 digest 헬퍼까지 SDK
기본(high)로 돌았다(아래 [effort 설정] 참고). `(executionMode, model)` 인자를 받게 바꿔
`office_hours_digest_read_only` → `"low"`(Codex와 동형, provider-runner.mjs:2191). 메인
인터뷰(`office_hours_question`)·judge(`judge_read_only`)는 `""`(SDK 기본 high) 유지. effort
미지원 모델(haiku-4-5/sonnet-4-5/미인식)엔 low를 안 붙이는 가드(`claudeModelSupportsEffort`)로
회귀 차단 — haiku에 effort 주면 에러. env 핀(`AGENTIC30_CLAUDE_REASONING_EFFORT`) 최우선은 유지.
블로킹 digest를 가볍게 해 Day2+ 시작 지연을 줄인다(외부소스 연결 시 user-felt). 회귀테스트 추가,
전체 스위트 2035 pass / 0 fail / 1 skip.

## 폐기 — 구현하지 않기로 검증된 안 (재시도 방지용 기록)

### ✗ digest 세션/TTL 재사용 캐시
당초 "Codex는 continuation마다 digest를 재수집하므로 캐시로 외부 호출을 건너뛰자"를
검토했으나, **그 전제가 틀렸다**. 위 호출 구조대로 digest는 세션당 1회만 수집된다(continuation은
`runPrompt`로 in-memory context 재사용). 건너뛸 두 번째 수집이 없어 **성능 이득 0**이고,
대신 schema 버저닝·window staleness(`untilMs`)·`selectedSources` 핑거프린트·abort/동시성·
broadcast 프로토콜 위험만 추가된다. 5개 적대 검증 렌즈 만장일치 `unsafe`, 합성 판정
`do_not_implement`. → 구현하지 않음.

## 모델 티어링 레버 (cost 중심 · CCG 교차검증 · opt-in env로만, 기본값 불변)

성능(체감 지연)은 위에서 사실상 한계까지 왔다. 남은 건 토큰 비용 레버다. 호출별 권고(검증
모델, 2026-06): 메인 인터뷰·judge는 강티어 유지, digest는 중간, 백그라운드 commitment만 경량.

| 호출 | Claude | GPT(Codex) | 비고 |
|---|---|---|---|
| 메인 인터뷰 | Opus 4.8 유지 | gpt-5.5 유지 | 품질핵심, 불변 |
| evidence judge | opus-4-8(provider 기본) | gpt-5.5(provider 기본) | **session.provider 따라감**(codex 고정 아님). 게이트 → 하향 금지 |
| 외부 digest / 아침 verdict | Sonnet 4.6 | gpt-5.5 유지 | MCP 오케스트레이션 → mini 비권고 |
| commitment 후보 | Haiku 4.5 | gpt-5.4-mini | 운영상 안전(비차단+폴백). 단 후보 품질은 코칭에 닿음(우선순위 참고) |

Gemini는 보조 요약 칸에서만 `gemini-3.5-flash`(repo 유일 wired ID). Pro는 3.1 Pro(preview)뿐이고
메인 인터뷰는 inline-sentinel 채널이라 취약 → #1/#4 비권고. (이 환경에선 Gemini CLI 인증도 끊겨
Antigravity `agy`로만 접근됨.)

**CCG(Codex) 교차검증이 바꾼 구현 설계 — 단일 env var는 위험:**
1. **provider-specific env가 필수.** 단일 `AGENTIC30_OFFICE_HOURS_COMMITMENT_MODEL`은 provider
   불일치 위험(Codex 세션에 `claude-haiku-4-5`가 들어가면 잘못된 ID를 Codex로 전송).
   `..._COMMITMENT_CLAUDE_MODEL` / `..._COMMITMENT_CODEX_MODEL`로 분리하고, resolver가
   provider/model 불일치를 **명시적으로 실패**시켜야 한다. digest/verdict도 동일. 기존
   `AGENTIC30_OFFICE_HOURS_DOC_JUDGE_MODEL`은 **단일 cross-provider 값이라 불일치 위험**(judge는
   session.provider를 따라가는데 이 env는 provider 무관 모델 1개를 강제 → 위 가드로 보호).
2. **Codex effort 가드.** Codex는 항상 `reasoning.effort`를 보낸다(provider-runner.mjs:1484).
   effort는 model-dependent라 `gpt-5.4-mini`가 거부하면 런타임 실패. resolver가 resolved 모델을
   받아 미지원 모델엔 effort를 **생략하거나 사전 실패**시켜야 한다(provider API 실패에 의존 금지).
3. **commitment 모드 정리.** commitment는 순수 로컬 요약인데 `office_hours_digest_read_only`
   모드로 호출된다(index.mjs:4060; `sessionIdForMcp: null`이라 실제 MCP 부착은 아니나 digest용
   모드를 빌려 씀). 다운티어 전에 no-MCP 전용 모드로 분리하는 게 깔끔하다.
4. **judge effort는 우연한 high다.** `judge_read_only`는 deepWork 정규식이 잡힐 때만 high
   (provider-runner.mjs:2167). office-hours judge 프롬프트가 "failure condition"을 하드코딩해
   현재는 high지만, 문구를 바꾸면 조용히 medium으로 떨어진다(비-deepWork는 medium 고정,
   provider-runner.test.mjs). 게이트 품질을 effort에 의존한다면 명시 핀이 안전.

**우선순위 (Antigravity 제품관점이 강하게 반대).** 솔로·pre-revenue(사실상 1 user)에선 절감
절대액이 월 <$10 수준 — **지금 라우팅 로직을 짜는 것 자체가 조기 최적화**다. 게다가 commitment
후보는 founder가 고를 카드라 경량화하면 "안 죽지만 더 밋밋한 후보"가 되어 accountability를
약화시킬 수 있다(품질 민감; 단 founder 검토 + 로컬폴백이 1차 방어). **결론: 지금은 기본값 유지
(do nothing)가 옳고**, env 레버는 볼륨이 붙은 뒤 commitment(#3)부터. (Antigravity는 "전부
Sonnet 4.6 단일"을 제안했으나, 이는 메인 인터뷰·judge까지 Opus→Sonnet 하향이라 "품질 유지"
제약과 충돌 → 채택 안 함.)

## 최종 결론 (Opus 4.8 ultracode 적대 재검토, wf_489a11c9)

3개 충돌을 코드 사실로 판가름:

- **C1 (commitment 다운이 안전한가) → 합성.** 출력은 **자동 영속되지 않는다**
  (`assertUserOrigin`, office-hours-memory.mjs:101 — founder 본인 문장만 기록; 전 실패경로가
  로컬 폴백). 즉 "메모리 오염"은 literal로 거짓. **그러나** commitment은 흐름에서 **가장 변별력
  높은 코칭 과제**(infra/research/doc 코스튬 거부 + 실명·가격·마감 강제 = October #1 회피패턴
  직격)라 품질 민감하다. → **코스튬 거부·구체성 parity 벤치마크 전엔 다운 금지.** 진짜 저자극
  요약은 아침브리핑 외부 digest가 먼저.
- **C2 (단일 vs provider별 env) → 합성(高확신).** commitment 단일 오버라이드는 이 콜에선 안전
  (fail-soft). **단 별개 결함:** Codex는 `reasoning.effort`를 무조건 전송(provider-runner.mjs:1484)
  하고 model ID가 무검증 통과(2078/2112)라, **provider/family 불일치 가드 + mini effort skip**
  2개를 provider-레벨로 추가해야 한다 — 이건 fail-soft 안 되는 메인 질문·judge까지 모든 Codex
  콜을 보호한다.
- **C3 (Sonnet 단일 vs 강티어 유지) → B 승(高확신).** 헬퍼는 model 인자 없이 호출돼 **코드
  기본값으로 resolve**(Claude면 opus-4-8). 다운 여지는 있으나 ~1 user 절감은 미미. 메인 질문
  Opus 유지, judge는 **session.provider를 따라가므로(codex 고정 아님 — wf가 leaf 기본값만 보고
  오판)** 현 티어 이하 하향 금지. per-task 라우팅은 이미 존재(index.mjs:533/538). **지금은
  아무것도 바꾸지 않는다.**

**총평:** 모델 티어링은 현 규모에서 반올림 절감 vs "품질 유지" 하드 제약 → **조기 최적화**. 이
논쟁이 낳은 **유일한 실작업은 비용과 무관한 정합성 가드 2개**(C2). 기본값은 전부 유지.

- **DO NOW (선택·정합성 하드닝):** ① resolveCodexModel/resolveClaudeModel에 provider/family
  prefix 불일치 시 **로컬 에러**(exhaustive allowlist 아님; claude-* vs gpt-*/o* 휴리스틱) ②
  resolveCodexReasoningEffort에 mini/non-reasoning family면 effort **생략**(workspace_scan
  선례 :2133 미러) ③ 회귀테스트. 현 기본값(gpt-5.5)에선 dormant — 미래/오설정 대비.
- **DEFER (볼륨 이후):** 모든 모델 티어링·env 오버라이드. 메인 질문·judge 하향은 parity
  벤치마크 전까지 금지.

## effort 설정 (✅ 구현됨 = OPT-3) — Claude executionMode-aware

문제(해결됨): Claude는 executionMode 무관이라 바운드된 digest 헬퍼까지 high였다. env로는 per-task
불가(전역 1값)라 코드 변경으로 처리. 호출부(provider-runner.mjs:730)가 이미 `executionMode`를
스코프에 가짐.

적용: `resolveClaudeReasoningEffort()` → `(executionMode, model)` 인자 받아 Codex와 동형 맵:
- `office_hours_digest_read_only` → `"low"`  (Codex가 이미 출시 = 검증; 블로킹 digest 가볍게)
- `office_hours_question`(인터뷰) → 유지(`""`→SDK 기본 high; Opus 4.8 low는 검증 전 금지)
- `judge_read_only` → 유지(high)
- 핀(`AGENTIC30_CLAUDE_REASONING_EFFORT`) 있으면 최우선(현행)

| Claude 태스크 | 현재 | 제안 | 효과 / 리스크 |
|---|---|---|---|
| Day2+ digest(블로킹) | high | **low** | ★ user-felt startup 지연↓(외부소스 연결+Day2+ 시). Codex 검증. 저위험 |
| commitment·아침 digest(배경) | high | **low** | 시간·비용↓. Codex도 이미 low(신규 리스크 아님; C1은 모델 얘기) |
| 인터뷰 | high | 유지 | 품질 불변 |
| evidence judge | high | 유지 | 게이트 불변 |

모델 티어링(DEFER)과 달리 이건 **user-felt 블로킹 지연을 줄이는 안전한 개선**이라 우선순위가
높다(효과는 외부소스 연결 + Day2+ 조건). commitment이 digest와 mode 공유 → 같이 low로 떨어짐;
깔끔히 하려면 commitment을 별도 no-MCP mode로 분리(C2 항목과 연결).

- **preamble 디스크 read 병렬화**: 작은 JSON read라 외부 provider 호출 대비 이득이 수십 ms로
  작고, context 조립 순서 의존이 있어 우선순위 낮음.

## 부수 관찰 (성능 아님, 후속 검토용)
`office_hours_revise_answer`(index.mjs:1617)는 `runOfficeHours` 재진입 시 selectedSources를
넘기지 않아 빈 배열로 떨어질 수 있다(적대 검증 staleness 렌즈 지적). 수동 재시도 경로의 소스
상태 정확성 이슈로, 성능과 무관하지만 별도 확인 가치 있음.

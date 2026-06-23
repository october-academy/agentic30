# Agentic30 Day 1 WOW: 처음 보여줄 문장

> 작성일: 2026-06-23  
> 문서 성격: PRD + 기술 계약  
> 대상 독자: 구현 에이전트  
> 상태: 기획 확정, 구현 전

## 1. 기능 요약

**처음 보여줄 문장**은 Agentic30의 Day 1 완료 행동이다. 사용자가 "랜딩이나 README를 고치세요"라는 조언을 받는 대신, Agentic30이 프로젝트 기록을 읽고 첫 고객이 보게 될 표면을 직접 만든다.

Day 1의 기존 완료 기준은 고객, 문제, 검증 행동을 정하는 데 가까웠다. 이 기능의 완료 기준은 더 강하다.

- 랜딩이 없으면 첫 고객에게 보여줄 `landing.html` 초안과 README.md 전체 재작성 proposal이 만들어진다.
- 랜딩이 있으면 Agentic30이 공개 URL 또는 localhost URL을 읽고 첫 화면 문제를 진단한 뒤 개선 문구를 만든다.
- README.md가 있으면 기술/설치 사실은 보존하면서 고객 언어 중심의 전체 재작성 proposal을 만든다.
- 사용자는 bundle review에서 approve 또는 reject를 고른다. 둘 중 하나의 결정이 저장되면 Day 1 완료로 인정한다.

이 기능은 조언 카드가 아니다. Day 1에서 사용자에게 남는 산출물은 "오늘 고객에게 보여줄 수 있는 문장"이어야 한다.

## 2. 유저가 느끼는 WOW 순간

WOW는 진단 문장이 아니라 결과 미리보기에서 온다.

첫 화면은 점수표나 긴 분석이 아니라, Agentic30이 만든 고객-facing 표면을 먼저 보여준다.

- "내 제품을 설명하는 문장이 생겼다."
- "지금 고객에게 보낼 수 있는 파일럿 신청 CTA가 생겼다."
- "README가 기술 설명에서 고객 문제 설명으로 바뀌었다."

좋은 경험은 사용자가 해야 할 일을 줄인다. 사용자가 "랜딩을 고쳐야겠다"고 생각하는 것이 아니라, "이걸 보여주고 반응을 볼 수 있겠다"고 느껴야 한다.

## 3. 핵심 사용자 흐름

첫 질문:

> 고객이 볼 페이지가 있나요?

선택지:

1\. 아직 없어요. 초안부터 만들어주세요
2\. 있어요. 주소를 넣을게요

공통 흐름:

1\. 사용자가 랜딩 유무를 선택한다.
2\. Agentic30이 프로젝트 문서, Day 1 goal, onboarding memory, 작업 기록, 외부 검색 결과를 수집한다.
3\. 고객과 문제가 충분히 확인되면 surface review를 생성한다.
4\. 앱은 결과 미리보기를 먼저 보여준다.
5\. 사용자는 한 번의 bundle review에서 전체 반영 또는 거절을 고른다.
6\. 결정 상태가 `.agentic30/memory/surface-review.json`에 저장된다.
7\. Day 1 memory에는 CTA, 결정 상태, 반영 파일만 요약된다.
8\. Day 2는 이 상태를 읽고 다음 고객 접촉 행동으로 이어간다.

Day 1 완료는 approve 또는 reject 중 하나가 저장될 때 발생한다. reject 이유는 묻지 않는다.

## 4. 랜딩 없음 플로우

랜딩이 없을 때 Agentic30은 루트 `landing.html` 신규 proposal과 README.md 전체 재작성 proposal을 만든다.

읽는 입력:

- `README.md`
- `.agentic30/docs/ICP.md`
- `.agentic30/docs/GOAL.md`
- `.agentic30/docs/SPEC.md`
- onboarding memory
- `.agentic30/day1-goal.json`
- `.agentic30/memory/day-rollup.json`
- `.agentic30/memory/days/day-1.json`
- 작업 기록과 최근 agent memory
- 외부 검색 결과

생성 산출물:

- landing hero headline
- subheadline
- 누구를 위한 제품인지
- 고객의 현재 문제
- 현재 대안
- Agentic30이 줄 첫 가치
- 파일럿 신청 CTA
- `landing.html` 단일 페이지 초안
- README.md 전체 재작성 proposal
- 문장별 짧은 근거

`landing.html`은 루트에 바로 둘 수 있는 단일 파일 proposal이다. 실제 파일은 승인 전까지 쓰지 않는다. proposal preview에는 최종 HTML 결과와 적용될 파일 경로가 보인다.

## 5. 랜딩 있음 플로우

랜딩이 있을 때 사용자는 URL을 입력한다.

허용 URL:

- 공개 `http` 또는 `https` URL
- `localhost`, `127.0.0.1`, 로컬 개발 서버 URL

비허용 URL:

- 로그인이 필요한 페이지

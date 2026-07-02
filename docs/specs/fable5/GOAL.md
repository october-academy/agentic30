# Agentic30 Fable 5 MVP 목표

## 미션

현재 native macOS 제품 느낌은 유지하면서 god-file state architecture를 교체하는 greenfield Agentic30 MVP를 만든다.

별도 target이 명시되지 않으면 기본 target은 `fable5-mvp/`다.

## MVP 루프

```text
Onboarding -> Project Scan -> Day 1 Interview -> Day 2 Interview -> Day 3 Interview -> Founder Replay
```

## 사용자 결과

첫 setup 이후 사용자는 다음을 볼 수 있어야 한다.

- Agentic30이 어떤 project를 읽고 있는지
- scan을 뒷받침하는 source quote가 무엇인지
- Day 1-3에서 customer, problem, current surface, next action이 어떻게 좁혀졌는지
- Founder Replay가 명시적 local consent 안에서 무엇을 capture, search, pause, delete할 수 있는지

## 성공 기준

- Workspace, provider, scan, interview, recorder, diagnostics 상태가 명시적이다.
- Scan success는 source quote를 요구한다.
- Day 1-3은 한 번에 하나의 active question만 가진다.
- Interview answer는 typed durable event다.
- Node provider output은 proposal이며 state authority가 아니다.
- Founder Replay는 local work memory이며 market proof가 아니다.
- `SPEC.md`의 현재 in-scope UI/UX anchor를 보존한다.
- `AgenticViewModel.swift`, `ContentView.swift`, `sidecar/index.mjs`를 대체하는 새 god file이 없다.

## 목표가 아닌 것

- Day 4+ curriculum
- revenue/payment/active-user scoreboard
- broad Evidence Inbox 또는 proof ledger
- automatic outreach/posting/deploy/payment mutation
- non-macOS platforms

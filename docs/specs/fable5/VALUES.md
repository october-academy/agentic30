# Agentic30 Fable 5 MVP 가치

## 1. 좁은 MVP

지금 중요한 surface는 onboarding, project scan, Day 1-3 interview, Founder Replay 네 가지뿐이다.

## 2. 명시적 실패

첫 root cause를 보여준다. auth, model, permission, scan, recorder 실패를 fallback copy 뒤에 숨기지 않는다.

## 3. local truth

Rust가 durable state를 소유한다. Swift는 native OS effect와 rendering을 수행한다. Node는 provider output을 제안한다.

## 4. 느낌은 보존하고 구조는 교체한다

범위 안 surface의 현재 native visual/UX anchor는 유지한다. god-file architecture는 복사하지 않는다.

## 5. 1인 유지보수성

Solo maintainer가 path와 contract만 보고 각 state transition의 owner를 찾을 수 있어야 한다. 넓은 framework보다 feature slice를 선호한다.

## 6. proof 경계

Scan quote, interview answer, recorder data는 입력이다. market proof, revenue proof, progress proof가 아니다.

## 7. consent 우선

Founder Replay는 명시적 consent와 성공한 permission probe 이후에만 capture한다. Search는 redacted local text만 사용한다. Delete는 receipt를 남긴다.

## 8. 검증된 진행

완료에는 test와 해당 app surface의 manual 또는 승인된 UI automation 구동이 필요하다.

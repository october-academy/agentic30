# Agentic30 Goal / OKR

> **최종 업데이트:** 2026-04-30
> **현재 분기:** Q2 2026 (4월–6월)
> **프로젝트 상태:** MVP 빌드 중 (Mac 앱 pre-dogfood)

---

## 프로젝트 미션

**"1인 개발자가 30일 안에 유저 100명 + 첫 매출을 달성하도록, 프로젝트와 실행 기록을 기반으로 개인화된 커리큘럼을 제공하는 macOS 메뉴바 AI 어시스턴트 기반 교육 프로그램을 만든다."**

- **타깃 유저:** 풀타임 솔로 인디 개발자 (매출 0원, macOS 사용, 인터뷰 실행 의향)
- **핵심 가치:** Adaptive 커리큘럼 (프로젝트 path + 업무 일지 + 고객 인터뷰 + BIP 기록 기반 개인화) + 메뉴바 상시 접근성
- **Form factor:** macOS 메뉴바 앱 (Swift) + Node sidecar
- **가격:** 미정 (creator dogfood 검증 후 결정)

Q2 2026은 Mac 앱 MVP + creator dogfood에 집중한다. 외부 유저 모집, 결제 플로우, 커뮤니티 운영은 **Q3+ 재검토**.

---

## Q2 2026 (4월–6월) — 분기 OKR

### Objective 1: Mac 앱 MVP 완성 (Foundation phase adaptive)

Mac 앱이 Day 0-7 Foundation phase를 adaptive하게 작동하는 상태까지 도달.

| # | Key Result | 측정 기준 | 목표 | 현재 |
|---|-----------|----------|------|------|
| KR1.1 | Swift 앱 골격 안정 | Xcode build + Keychain + sidecar bridge + onboarding 플로우 동작 | 크래시 0, onboarding 완주 | 🔄 진행중 |
| KR1.2 | 기록 ingest 파이프라인 | 프로젝트 path 지정 + 업무 일지/인터뷰/BIP 기록 드래그 앤 드롭 + 폴더 watch 동작 | 핵심 기록 3종 지원 | ☐ |
| KR1.3 | Day 0-7 adaptive 과제 생성 | 프로젝트/기록 입력 → 다음 Day 맞춤 과제 출력 | 7개 Day 동작 | ☐ |
| KR1.4 | 3개 sub-workflow 통합 | `/office-hours-docs`, `/bip-draft`, `/analyze-ads` 메뉴바에서 호출 | 3개 동작 | 🔄 (sidecar 존재) |
| KR1.5 | 로컬 세션 영속화 | 앱 재시작 후 Day 상태/프로젝트/기록 유지 | ✅/✗ | ☐ |

### Objective 2: Creator Dogfood 검증

Creator 본인이 Mac 앱으로 30일 챌린지를 돌려 미션 달성.

| # | Key Result | 측정 기준 | 목표 | 현재 |
|---|-----------|----------|------|------|
| KR2.1 | Creator Day 1 시작 | 본인이 Mac 앱으로 Day 1 진행 | 2026-05-01 이전 | ☐ |
| KR2.2 | Day 7 Foundation 완주 | Go/No-Go 데이터 기반 결정 | 2026-05-08 이전 | ☐ |
| KR2.3 | Day 30 완주 | 30일 챌린지 종료 + 회고 작성 | 2026-06-01 이전 | ☐ |
| KR2.4 | 본인 프로덕트 유저 100명 | 본인 프로젝트 가입/활성 유저 | 100명 | ☐ |
| KR2.5 | 본인 프로덕트 첫 매출 | 본인 프로젝트 첫 결제 | 최소 1건 | ☐ |

**주의:** KR2.4, KR2.5는 Agentic30 사용자 수가 아니라 creator가 Agentic30으로 빌드한 **별도 프로덕트의 유저/매출**. 즉, Agentic30의 효과를 creator 본인이 0→1로 증명하는 지표.

### Objective 3: 기존 웹 인프라 정리 + BIP 공개

기존 웹 인프라의 출구 계획 수립 + Mac 앱 개발 과정 공개.

| # | Key Result | 측정 기준 | 목표 | 현재 |
|---|-----------|----------|------|------|
| KR3.1 | 웹 플랫폼 freeze 공지 | 공식 안내문 + 기존 유저 처리 계획 문서화 | 완료 | ☐ |
| KR3.2 | 불필요 인프라 종료 계획 | Cloudflare Workers / Railway agent / Supabase 크론 / Discord 봇 종료 일정 확정 | 계획 수립 | ☐ |
| KR3.3 | 기존 유료 유저 처리 | 환불/이관/완주 지원 정책 결정 및 실행 | 이슈 0건 | ☐ |
| KR3.4 | BIP 포스트 공개 | Mac 앱 빌드 로그 (Threads/블로그) | 주 2회+ | ☐ |

### Objective 4: Adaptive 엔진 품질

프로젝트와 실행 기록 → 맞춤 과제 생성의 정확도/일관성 확보.

| # | Key Result | 측정 기준 | 목표 | 현재 |
|---|-----------|----------|------|------|
| KR4.1 | 기록 분석 정확도 | 프로젝트/인터뷰/BIP 기록에서 가설/문제/타겟/유입 신호 추출 정확도 (creator 주관 평가) | 4/5 이상 | ☐ |
| KR4.2 | Day-to-Day context 유지 | Day N 결과 → Day N+1 prompt에 반영되는 정합성 테스트 | 통과 | ☐ |
| KR4.3 | 프롬프트 버전 관리 | sidecar `*-prompt.mjs` 프롬프트 버전/변경 이력 추적 시스템 | 도입 | ☐ |
| KR4.4 | Provider 라우팅 안정성 | Claude/Codex 둘 다 ok, fallback 동작 | 크래시 0 | ☐ |

---

## 주간 마일스톤 (Q2 2026)

### 4월: Mac 앱 Foundation + BIP 공개 시작

| 주차 | 기간 | 마일스톤 | 핵심 산출물 | 상태 |
|------|------|---------|-----------|------|
| W1 | 4/7-4/13 | Mac 앱 골격 정리 + sidecar 안정화 | 빌드 가능, preflight 통과 | ✅ 완료 |
| W2 | 4/14-4/20 | 기록 ingest + Session store | 프로젝트 path, 드래그 앤 드롭, 영속화 | 🔄 진행중 |
| W3 | 4/21-4/27 | 문서 정비 + Day 1 adaptive 과제 프로토타입 | SPEC/ICP/GOAL/VALUES 최신화 + Day 1 prompt 동작 | 🔄 진행중 |
| W4 | 4/28-5/4 | Day 2-4 adaptive 과제 + BIP 포스트 #1 | Day 2-4 prompt 동작, BIP 공개 | ☐ |

### 5월: Creator Day 1 시작 + 웹 정리

| 주차 | 기간 | 마일스톤 | 핵심 산출물 | 상태 |
|------|------|---------|-----------|------|
| W5 | 5/5-5/11 | Creator Day 1 공식 시작 + Day 5-7 완성 | 본인 챌린지 시작, Foundation 전체 동작 | ☐ |
| W6 | 5/12-5/18 | 웹 플랫폼 freeze 공지 + 유료 유저 처리 | freeze 공고, 환불/이관 정책 | ☐ |
| W7 | 5/19-5/25 | Day 7 Go/No-Go 결정 + Day 8-17 Build 과제 설계 | 본인 Go/No-Go 결론, Build phase 로드맵 | ☐ |
| W8 | 5/26-6/1 | Build phase 시작 + 불필요 인프라 종료 | 본인 Day 8-10 진행, Railway/Workers 종료 | ☐ |

### 6월: 30일 완주 + Q3 준비

| 주차 | 기간 | 마일스톤 | 핵심 산출물 | 상태 |
|------|------|---------|-----------|------|
| W9 | 6/2-6/8 | Day 18-24 Launch phase (BIP 통합) | Launch 과제 동작, 본인 프로덕트 런칭 | ☐ |
| W10 | 6/9-6/15 | Day 25-30 Grow phase (ads 통합) | Grow 과제 동작, Meta Ads 세팅 | ☐ |
| W11 | 6/16-6/22 | **Day 30 완주 + 유저 100명 + 첫 매출 여부** | 본인 챌린지 결과, 데이터 기반 판단 | ☐ |
| W12 | 6/23-6/29 | Q2 회고 + Q3 OKR (외부 유저 모집 여부 결정) | 회고 문서, Q3 플랜 | ☐ |

---

## 개인 성장 목표 (Q2 2026)

### 1. macOS 네이티브 앱 개발 역량

| 목표 | 측정 가능한 결과 | 기한 |
|------|----------------|------|
| SwiftUI + MenuBarExtra 숙련 | 메뉴바 패널 UX 2회 이상 반복 설계 | 5월 말 |
| Node sidecar 프로세스 관리 | Provider fallback + 크래시 복구 동작 | 5월 중순 |
| Developer ID 서명 + notarization | 외부 DMG 배포 가능한 빌드 | 6월 말 (릴리즈 시) |

### 2. Adaptive AI 워크플로우 설계

| 목표 | 측정 가능한 결과 | 기한 |
|------|----------------|------|
| 프롬프트 엔지니어링 (context 유지) | Day N 결과가 Day N+1 prompt에 자연스럽게 반영 | 5월 말 |
| Claude/Codex 라우팅 전략 | 작업 유형별 모델 선택 룰 문서화 + 구현 | 5월 중순 |
| 기록 분석 일반화 | caret.so/Zoom/Granola/Threads/블로그/Git 로그 등 다른 포맷도 핸들링 | 6월 중순 |

### 3. Build in Public 운영

| 목표 | 측정 가능한 결과 | 기한 |
|------|----------------|------|
| 주 2회 BIP 포스트 | Threads + 블로그 주 2회 발행 | 지속 |
| 30일 챌린지 공개 일지 | Day 1-30 매일 포스트 | 6월 말 |

---

## 진행 추적 포맷

### 주간 체크인 템플릿

```markdown
## 주간 체크인 — W{주차} ({날짜 범위})

### 이번 주 완료
- [ ] {완료 항목}

### 핵심 지표
| 지표 | 목표 | 이번 주 | 변화 |
|------|------|--------|------|
| Mac 앱 Day 동작 수 | 30/30 | —/30 | — |
| Creator 본인 Day 진행 | 30/30 | —/30 | — |
| 본인 프로덕트 유저 | 100명 | — | — |
| 본인 프로덕트 매출 | 1건+ | — | — |
| BIP 포스트 | 주 2회 | — | — |

### 배운 것 / 인사이트
-

### 다음 주 우선순위 (Top 3)
1.
2.
3.

### 블로커
-
```

### 진행률 대시보드 (분기 누적, 2026-04-22 기준)

```
Q2 2026 진행률

[Obj 1] Mac 앱 MVP           ████░░░░░░░░░░░░░░░░ 20%  (Swift 골격 + sidecar 있음, adaptive 아직)
[Obj 2] Creator Dogfood      ░░░░░░░░░░░░░░░░░░░░ 0%   (Day 1 미시작)
[Obj 3] 웹 인프라 정리       █░░░░░░░░░░░░░░░░░░░ 5%   (방향 결정 완료)
[Obj 4] Adaptive 엔진 품질   ██░░░░░░░░░░░░░░░░░░ 10%  (기존 3개 프롬프트 존재)
```

---

## 분기별 로드맵

| 분기 | 테마 | 핵심 목표 |
|------|------|----------|
| **Q2 2026** (현재) | Mac 앱 MVP + Creator dogfood | Foundation phase 동작 + 본인 30일 완주 + 100명/첫 매출 |
| **Q3 2026** | 외부 유저 모집 (검증 성공 시) | Closed beta 10명, 가격 모델 확정, DMG 공식 배포 |
| **Q4 2026** | 확장 | Beta 50명, 피드백 반영 2차 대규모 개선, BIP 기반 유입 |
| **Q1 2027** | 지속 가능한 운영 | MRR 실험, 멘토/커뮤니티 도입 검토 |

**주의:** Q3+ 숫자는 모두 **Q2 dogfood 성공 가정**. 실패 시 모든 계획 재설정.

---

## 참고 문서

- [SPEC.md](./SPEC.md) — 제품 스펙 (Mac 앱 + Adaptive 커리큘럼)
- [ICP.md](./ICP.md) — 타겟 고객 프로필
- [VALUES.md](./VALUES.md) — 행동 원칙
- [packages/mac/agentic30/README.md](../packages/mac/agentic30/README.md) — Mac 앱 개발 가이드

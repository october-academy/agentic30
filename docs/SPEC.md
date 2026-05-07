# Agentic30 — Product Spec

> 1인 개발자가 30일 안에 유저 100명, 첫 매출을 달성하도록 돕는 **macOS 메뉴바 AI 어시스턴트 기반 교육 프로그램**. 사용자가 프로젝트 path를 지정하고 업무 일지, 고객 인터뷰, Build in Public 기록을 누적하면, AI가 각자의 상황에 맞춘 Day별 과제를 생성한다.

**최종 업데이트:** 2026-04-30
**상태:** MVP 빌드 중. Creator 본인도 아직 daily use 하지 못하는 pre-dogfood 단계.

---

## 1. 제품 한 문장

**"프로젝트와 실행 기록을 연결하면, 당신을 위한 30일 커리큘럼이 나온다."**

기존 온라인 강의/챌린지 프로그램은 모든 참가자에게 같은 커리큘럼을 준다. Agentic30는 사용자의 프로젝트 path, 업무 일지, 고객 인터뷰 transcript, BIP 일지(Threads 게시글, 팔로워 수, 반응, 배움)를 읽고, 실제 상황에 맞춘 내일의 과제를 만든다.

---

## 2. 타겟 사용자

상세는 `docs/ICP.md`. 요약하면 전업 1인 개발자, 수익 0원, macOS 사용, 프로젝트/업무/인터뷰/BIP 기록을 남기며 30일 스프린트를 실행할 의향 있음.

핵심 가설: 이 유저는 "만들 줄은 알지만 무엇을 만들어야 팔리는지, 오늘 무엇을 검증해야 하는지, 어떻게 사람을 데려와야 하는지 모른다"는 고통을 겪고 있다. 해결책은 실제 프로젝트와 실행 기록을 분석해서 다음 행동을 맞춤 제시하는 것.

---

## 3. 미션 & 성공 기준

**미션:** 1인 개발자가 30일 안에 유저 100명 + 첫 매출 달성.

**MVP 성공 기준 (creator dogfood):**
- Agentic30 creator 본인이 Mac 앱으로 30일 챌린지 완주
- 본인 프로덕트로 유저 100명 + 첫 매출 달성
- 이 과정을 BIP로 공개

외부 유저 모집, 가격 책정, 커뮤니티 운영은 creator dogfood 검증 이후 결정. 현 시점에서 외부 유저 확보는 non-goal.

---

## 4. Core Loop

```
[1] 유저가 프로젝트 path를 지정
    ↓
[2] 업무 일지, 고객 인터뷰, BIP 일지 기록
    - 업무: 오늘 만든 것, 막힌 것, 배운 것
    - 인터뷰: transcript 파일 (.txt, .md, .vtt, .srt)
    - BIP: Threads/블로그 게시글, 팔로워 수, 반응, 배움
    ↓
[3] Agentic30 Mac 앱이 프로젝트와 기록 폴더를 watch
    ↓
[4] Node sidecar가 provider(Claude/Codex) 호출
    ↓  → 프로젝트/기록 분석 (문제 정의, 타겟, 가설, 진행 상황, 유입 신호 추출)
    ↓  → 현재 Day context와 합쳐 다음 과제 생성
    ↓
[5] 메뉴바 클릭 시 "오늘의 적응형 과제" 패널 표시
    ↓
[6] 유저가 과제 수행 → 새 기록 제출 → 다음 Day 적응
```

---

## 5. Adaptive 30일 커리큘럼 구조

Phase 구조는 유지하되, 각 Day의 실제 과제는 유저 context에 따라 동적 생성.

| Phase | Day | 핵심 질문 | Adaptive 출력 예시 |
|---|---|---|---|
| Foundation | 0-7 | 무엇을 왜 만들 것인가? | 인터뷰와 프로젝트 메모에서 추출한 가설 3종을 Day 2 Mom Test 스크립트로 변환 |
| Build | 8-17 | 어떻게 빠르게 만들 것인가? | 프로젝트 코드/업무 일지 기반 MVP 기능 우선순위 3개 추천, 빌드 로그 리뷰 |
| Launch | 18-24 | 어떻게 유저를 만들 것인가? | 타겟 고객 페르소나와 BIP 반응 기반 게시글/DM/런칭 액션 생성 |
| Grow | 25-30 | 어떻게 돈과 품질을 붙일 것인가? | BIP 반응, 유입 지표, Meta Ads 세팅 분석 (기존 `/analyze-ads` 통합), 가격 실험 설계 |

**기존 sidecar 3개 커맨드의 위치:**
- `/office-hours-docs` → Day 1/3 (문제 정의, 스펙 작성) sub-workflow
- `/bip-draft` → Day 18-24 (Launch) sub-workflow
- `/analyze-ads` → Day 5 (수요 검증) + Day 25+ (Grow) sub-workflow

Adaptive 원칙: Phase와 Day별 핵심 질문은 고정, 구체 과제/질문지/스크립트는 유저의 프로젝트와 누적 실행 기록에 따라 생성.

---

## 6. 메뉴바 UI (MVP 스케치)

```
[메뉴바 아이콘]
  ├─ Day 4 / 30  (Foundation, Mom Test 실행 중)
  ├─ 오늘의 과제
  │   └─ "지난 인터뷰 3건에서 공통 언급된 '시간 부족' 테마를
  │      심층 검증하는 질문 5개를 다음 인터뷰에 추가하세요"
  ├─ 최근 기록
  │   ├─ 2026-04-22 장지창 인터뷰 (분석 완료)
  │   ├─ 2026-04-21 Threads BIP #4 (반응 수집 완료)
  │   └─ 2026-04-20 업무 일지 (분석 완료)
  ├─ 과제 실행 (sub-workflows)
  │   ├─ /office-hours-docs
  │   ├─ /bip-draft
  │   └─ /analyze-ads
  ├─ 진행 로그 (Day별 수행/결과)
  └─ 설정
```

MVP는 메뉴바 드롭다운 + 과제 실행 시 floating panel 수준. 복잡한 워크스페이스 UI는 이후 검토.

---

## 7. 아키텍처

**Swift 앱 (`packages/mac/agentic30/agentic30/`):**
- 메뉴바 `NSStatusItem` 또는 SwiftUI `MenuBarExtra`
- Keychain (프로바이더 토큰), OAuth 프레젠테이션
- Workspace 파일 선택 (프로젝트 path, 기록 폴더 watch)
- `SidecarBridge`로 Node 프로세스 관리
- PostHog 텔레메트리 (opt-in)

**Node sidecar (`packages/mac/agentic30/sidecar/`):**
- `index.mjs` — 엔트리, stdio 또는 local HTTP 인터페이스
- `provider-runner.mjs` — Claude Agent SDK / Codex CLI 라우팅
- `mcp-server.mjs` — 내부 도구 서버
- `acp-adapter.mjs` — Agent Client Protocol 어댑터
- `session-store.mjs` — 세션/기록/transcript 영속화
- `*-prompt.mjs` — Day별 프롬프트 (`office-hours-docs-prompt`, `bip-prompt`, `ad-strategy-prompt`, `qmd-support`)
- `meta-ads.mjs`, `notion-oauth.mjs` — 외부 시스템 연동
- `preflight.mjs`, `diagnostics.mjs` — 환경 점검

**Provider 요구사항:**
- Node.js 20+ (`NODE_BINARY`, 일반 설치 경로, mise/asdf/Volta, 로그인 셸 PATH 순 탐색)
- Claude: 로컬 Claude Code 로그인 또는 `ANTHROPIC_API_KEY`
- Codex: 로컬 Codex 로그인 또는 `OPENAI_API_KEY` / `CODEX_API_KEY`

**저장소:** 로컬 우선 (프로젝트 path, transcripts, 업무 일지, BIP 일지, sessions, logs는 유저 워크스페이스 또는 앱 샌드박스 외 디렉토리). 클라우드 동기화는 이후 검토.

**배포:** DMG 직접 배포. 현 시점 Mac App Store 아님 (App Sandbox 비활성, Node 자식 프로세스 + 사용자 지정 워크스페이스 접근 필요). Hardened Runtime, Developer ID 서명, notarization, 업데이터(Sparkle 등)는 public distribution 전 release blocker.

상세: `packages/mac/agentic30/docs/release-checklist.md`, `known-limitations.md`.

---

## 8. MVP 스코프

**In scope:**
- Swift 메뉴바 앱 골격 (이미 있음)
- Node sidecar + provider routing (이미 있음)
- Project path 지정 + 기록 ingest (업무 일지, 고객 인터뷰 txt/md/vtt/srt, BIP 일지 드래그 앤 드롭/폴더 watch)
- Day별 adaptive 과제 생성 — Foundation Phase 먼저 (Day 0-7)
- `/office-hours-docs`, `/bip-draft`, `/analyze-ads` 3개 sub-workflow
- 로컬 session 영속화, 진행 로그
- Creator dogfood (30일 챌린지 실행 + BIP 공개)

**Out of scope:**
- Day 8-30 adaptive 과제 (creator가 Day 8 도달 시 빌드)
- 외부 사용자 온보딩, 결제, 가격 책정
- 커뮤니티/멘토 시스템 UI
- 웹 인프라 신규 기능
- 다중 기기 동기화
- 비 macOS 플랫폼 (Windows/Linux/iOS)

---

## 9. 열린 질문

1. **Adaptive 엔진 기준 데이터:** 기존 MDX 31개 Day 콘텐츠를 reference로 쓸 때, Phase/Day 핵심 질문은 고정하고 구체 과제만 유저별로 생성하는가? 아니면 Day 구성 자체를 재배치할 수 있는가?
2. **웹 인프라 정리 일정:** Cloudflare Workers, Railway cofounder-agent, Supabase 크론, Discord 봇 등은 언제까지 운영 중단할 것인가? 기존 유료 유저가 존재할 경우 처리 방침?
3. **기록 자동 수집 depth:** caret.so, Zoom, Granola, Threads, 블로그, Git 로그 등과의 연동은 폴더 watch 수준에서 멈출지, API 연동까지 확장할지?
4. **가격 & 배포 타임라인:** DMG 직접 배포 + 가격 미정. Creator dogfood 검증 후 결정이지만, 예상 시점은?
5. **멘토 시스템:** 기존 멘토 대시보드/자동 배정 기능은 Mac 앱에서 어떻게 대응하는가? 제거, 웹 유지, 메뉴바 통합 중 어느 방향?
6. **기존 자산 활용:** MDX 31개 커리큘럼, mem0 장기 기억, MCP 28개 도구 중 어떤 것이 adaptive 엔진의 seed로 재활용되는가?

---

## 10. 참고 문서

- `docs/ICP.md` — 타겟 고객 정의
- `docs/GOAL.md` — Q2 2026 OKR
- `docs/VALUES.md` — 행동 원칙
- `packages/mac/agentic30/README.md` — Mac 앱 개발 가이드
- `packages/mac/agentic30/docs/release-checklist.md` — 배포 체크리스트
- `packages/mac/agentic30/docs/known-limitations.md` — 알려진 제한사항
- `packages/mac/agentic30/docs/diagnostics-guide.md` — 진단 가이드

---

_최종 수정: 2026-04-22_

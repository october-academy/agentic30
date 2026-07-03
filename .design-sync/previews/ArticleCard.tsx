import { ArticleCard, IconButton } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const col = { ...canvas, display: "flex", flexDirection: "column" as const, gap: 12, maxWidth: 560 };

export const Highlighted = () => (
  <div style={col}>
    <ArticleCard
      eyebrow="안 읽음 · 하이라이트"
      highlight
      title="UI 테스트 리서치 결과"
      body="뉴스 레퍼런스 화면이 열린 상태에서도 리서치 결과가 유지됩니다. 리서치 갱신 후에도 선택한 뉴스 라우트가 유지되는지 확인합니다."
      source={{ name: "Codex 웹 검색 도구", url: "https://example.com/radar", detail: "web · UI 테스트 출처" }}
      meta="대안/가격 · 5/20 10:00 · 0초 걸림"
      actions={
        <>
          <IconButton icon="✉" aria-label="메일로 검토" size={26} />
          <IconButton icon="🔖" aria-label="저장" size={26} />
        </>
      }
    />
  </div>
);

export const Standard = () => (
  <div style={col}>
    <ArticleCard
      eyebrow="Medium"
      title="한국 AC는 1인 개발자를 배제한다"
      body="SparkLabs가 1인 AC(Spark Claw)를 출범하며 '1인 배제' gap을 정면으로 반박. 무게이트 로컬 소프트웨어 wedge에 직접 영향."
      source={{ name: "Threads", detail: "competitive-radar" }}
      meta="경쟁 · 어제"
    />
  </div>
);

export const NoHighlight = () => (
  <div style={col}>
    <ArticleCard
      eyebrow="Low"
      title="Zep · Graphiti 시간 지식그래프 비교"
      body="6가지 Agent Memory 접근법 비교 — Founder Replay 설계에 참고할 temporal knowledge graph 패턴."
      source={{ name: "Web", detail: "출처 그룹 · 1건" }}
      meta="문제 · 2일 전"
    />
  </div>
);

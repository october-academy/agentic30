import { RefSection, StatCard, Badge } from "founder-os-kit";

const canvas = {
  background: "var(--ds-page)",
  padding: 24,
  width: 840,
  fontFamily: "var(--ds-sans)",
};

// Projects screen "개요" section — accent marker + subtitle + stat-card children.
export const Overview = () => (
  <div style={canvas}>
    <RefSection title="개요" subtitle="Day 1 of 30 · 초기 검증 진행 중" markerTone="accent">
      <div style={{ display: "flex", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StatCard label="완료한 DAY" value="0" unit="/ 30" sub="→ Day 1 진행 중" tone="muted" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StatCard label="인터뷰 원문" value="1" unit="/ 5 기준" sub="+ 1 어제" tone="accent" />
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <StatCard label="소스 코드 루트" value="3" unit="/ watch 활성" sub="+ 2 보조 레포" tone="accent" />
        </div>
      </div>
    </RefSection>
  </div>
);

// News screen "대안/가격" lane section — with a count badge next to the title.
export const NewsLane = () => (
  <div style={canvas}>
    <RefSection
      title="대안/가격"
      count={<Badge tone="accent">1</Badge>}
      subtitle="이미 돈을 쓰는 대안과 가격 기준은 무엇인가"
      markerTone="accent"
    >
      <div style={{ fontSize: 13, color: "var(--ds-muted)" }}>
        레이더 카드가 이 아래에 렌더링됩니다.
      </div>
    </RefSection>
  </div>
);

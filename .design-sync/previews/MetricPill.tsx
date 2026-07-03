import { MetricPill, Badge } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const grid = { ...canvas, display: "grid", gridTemplateColumns: "repeat(2, 1fr)", gap: 10, maxWidth: 420 };

export const Metrics = () => (
  <div style={grid}>
    <MetricPill value="3 · $0.04" subtitle="오늘 호출" />
    <MetricPill value="62%" subtitle="평균 완주율" />
    <MetricPill value="D1 / 30" subtitle="진행 phase" />
    <MetricPill value="9개 watch" subtitle="소스 루트" />
  </div>
);

export const WithTrailing = () => (
  <div style={{ ...canvas, display: "flex", flexDirection: "column", gap: 10, maxWidth: 300 }}>
    <MetricPill value="5 / 15" subtitle="인터뷰 게이트" trailing={<Badge tone="accent" mono>진행</Badge>} />
    <MetricPill value="0 / 14" subtitle="공개 기록 글" trailing={<Badge neutral>미시작</Badge>} />
  </div>
);

export const Tones = () => (
  <div style={{ ...canvas, display: "flex", gap: 10 }}>
    <MetricPill value="+2건" subtitle="증거 부채" tone="amber" />
    <MetricPill value="1건" subtitle="스캔 실패" tone="rose" />
    <MetricPill value="14 day" subtitle="진행 일수" tone="accent" />
  </div>
);

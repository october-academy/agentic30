import { SectionHeader } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 520, display: "flex", flexDirection: "column" as const, gap: 14 };

export const Accent = () => (
  <div style={canvas}>
    <SectionHeader label="질문 1 — 수요 증거" meta="1 / 6" accent />
  </div>
);

export const Neutral = () => (
  <div style={canvas}>
    <SectionHeader label="세션 컨텍스트" meta="Office Hours · 질문 대화 2/3" />
  </div>
);

export const NoMeta = () => (
  <div style={canvas}>
    <SectionHeader label="하나 선택" accent />
  </div>
);

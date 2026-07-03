import { Sparkline } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" as const };

const label = { fontSize: 11, color: "var(--ds-muted)", fontFamily: "var(--ds-mono)", display: "block", marginBottom: 6 };

export const Trends = () => (
  <div style={row}>
    <div>
      <span style={label}>CPU</span>
      <Sparkline points={[12, 18, 9, 22, 15, 31, 24, 40, 28]} />
    </div>
    <div>
      <span style={label}>오늘 호출</span>
      <Sparkline points={[0, 1, 1, 2, 1, 3, 2, 3]} tone="sky" />
    </div>
  </div>
);

export const NoFill = () => (
  <div style={row}>
    <div>
      <span style={label}>소스 활동</span>
      <Sparkline points={[4, 6, 5, 8, 7, 9, 6, 3, 5]} tone="violet" fill={false} />
    </div>
  </div>
);

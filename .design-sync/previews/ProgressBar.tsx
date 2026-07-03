import { ProgressBar } from "founder-os-kit";

const canvas = {
  background: "var(--ds-page)",
  padding: 24,
  fontFamily: "var(--ds-sans)",
  width: 360,
  display: "flex",
  flexDirection: "column" as const,
  gap: 18,
};

const label = { fontSize: 11, color: "var(--ds-muted)", fontFamily: "var(--ds-mono)" };

export const PhaseProgress = () => (
  <div style={canvas}>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={label}>초기 검증 기준 · D7</span>
      <ProgressBar value={0.35} />
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={label}>만들기 기준 · D17</span>
      <ProgressBar value={0.7} tone="violet" />
    </div>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={label}>공개 기준 · D24</span>
      <ProgressBar value={0.9} tone="sky" />
    </div>
  </div>
);

export const Severity = () => (
  <div style={canvas}>
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <span style={label}>남은 일수 29 · 미룸 2일</span>
      <ProgressBar value={0.5} tone="amber" height={6} />
    </div>
  </div>
);

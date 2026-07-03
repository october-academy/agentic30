import { ProgressRing } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" as const };

export const DayProgress = () => (
  <div style={row}>
    <ProgressRing value={0.03} label="3%" />
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <ProgressRing value={0.03} size={36} label="3%" />
    <ProgressRing value={0.47} size={48} label="47%" tone="violet" />
    <ProgressRing value={0.8} size={64} label="80%" tone="sky" />
  </div>
);

import { Badge } from "agentic30-ds";

const row = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const };

const Check = () => (
  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} strokeLinecap="round" strokeLinejoin="round"><path d="M5 13l4 4L19 7" /></svg>
);

export const Tones = () => (
  <div style={row}>
    <Badge tone="accent">Day 7</Badge>
    <Badge tone="neutral" icon={<Check />}>약속</Badge>
    <Badge tone="danger">증거 0</Badge>
    <Badge tone="warning">2일째 미룸</Badge>
  </div>
);

export const Recommended = () => (
  <div style={row}>
    <Badge tone="accent">1 / 6</Badge>
  </div>
);

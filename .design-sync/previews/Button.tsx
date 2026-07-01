import { Button } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 12, alignItems: "center" };

export const Variants = () => (
  <div style={row}>
    <Button variant="primary">약속하고 닫기</Button>
    <Button variant="ghost">지난 회고 보기</Button>
    <Button variant="amber">미룸으로 닫기</Button>
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <Button variant="primary" disabled>약속하고 닫기</Button>
  </div>
);

export const FullWidth = () => (
  <div style={{ ...canvas, width: 300 }}>
    <Button variant="primary" fullWidth>오피스아워 시작</Button>
  </div>
);

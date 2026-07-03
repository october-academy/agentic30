import { Confetti } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", color: "var(--ds-fg)" };

export const Burst = () => (
  <div style={{ ...canvas, width: 520 }}>
    <div style={{ fontSize: "var(--ds-fs-section)", fontWeight: 600, marginBottom: 8 }}>Day 1 완료 🎉</div>
    <Confetti count={90} animate={false} height={240} />
  </div>
);

export const Dense = () => (
  <div style={{ ...canvas, width: 520 }}>
    <Confetti count={140} animate={false} height={200} />
  </div>
);

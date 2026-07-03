import React from "react";

export interface ConfettiProps {
  /** Number of confetti pieces. */
  count?: number;
  /** Play the fall+spin animation (respect reduced-motion in real use). */
  animate?: boolean;
  /** Container height. */
  height?: number;
}

// The 8 fixed confetti hues (RealisticConfettiPaletteColor), as CSS tokens.
const HUES = [
  "var(--ds-confetti-cyan)",
  "var(--ds-confetti-purple)",
  "var(--ds-confetti-pink)",
  "var(--ds-confetti-lime)",
  "var(--ds-confetti-yellow)",
  "var(--ds-confetti-orange)",
  "var(--ds-confetti-magenta)",
  "var(--ds-confetti-green)",
];

// Deterministic pseudo-random from an index (stable previews — no Math.random).
function rnd(seed: number, salt: number): number {
  const x = Math.sin(seed * 12.9898 + salt * 78.233) * 43758.5453;
  return x - Math.floor(x);
}

/** Completion-celebration confetti burst (mirrors the app's RealisticConfettiBurst). */
export function Confetti({ count = 80, animate = true, height = 260 }: ConfettiProps) {
  const pieces = Array.from({ length: count }, (_, i) => {
    const hue = HUES[i % HUES.length];
    const left = rnd(i, 1) * 100;
    const delay = rnd(i, 2) * 0.6;
    const dur = 1.4 + rnd(i, 3) * 1.2;
    const rot = Math.floor(rnd(i, 4) * 360);
    const w = 5 + Math.floor(rnd(i, 5) * 5);
    const h = 8 + Math.floor(rnd(i, 6) * 8);
    const round = rnd(i, 7) > 0.7;
    const topStart = animate ? -12 : rnd(i, 8) * height;
    return (
      <span
        key={i}
        style={{
          position: "absolute",
          top: topStart,
          left: `${left}%`,
          width: w,
          height: round ? w : h,
          background: hue,
          borderRadius: round ? "50%" : 1.5,
          transform: `rotate(${rot}deg)`,
          animation: animate ? `fokConfettiFall ${dur.toFixed(2)}s ${delay.toFixed(2)}s cubic-bezier(0.2,0,0,1) infinite` : undefined,
        }}
      />
    );
  });
  return (
    <div style={{ position: "relative", width: "100%", height, overflow: "hidden" }} aria-hidden>
      <style>{`@keyframes fokConfettiFall{0%{transform:translateY(0) rotate(0);opacity:1}100%{transform:translateY(${height + 24}px) rotate(360deg);opacity:.85}}`}</style>
      {pieces}
    </div>
  );
}

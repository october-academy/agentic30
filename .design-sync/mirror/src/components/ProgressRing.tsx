import React from "react";
import { Tone, toneVars } from "../tokens";

export interface ProgressRingProps {
  /** 0..1 */
  value: number;
  size?: number;
  tone?: Tone;
  /** Center label (e.g. "3%"). */
  label?: React.ReactNode;
}

/** Circular progress ring with a center label (project day progress). */
export function ProgressRing({ value, size = 48, tone = "accent", label }: ProgressRingProps) {
  const t = toneVars(tone);
  const sw = Math.max(3, size / 12);
  const r = (size - sw) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(1, value));
  return (
    <div style={{ position: "relative", width: size, height: size, flex: "0 0 auto" }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`}>
        <circle cx={c} cy={c} r={r} fill="none" stroke="var(--ds-selected)" strokeWidth={sw} />
        <circle
          cx={c}
          cy={c}
          r={r}
          fill="none"
          stroke={t.color}
          strokeWidth={sw}
          strokeLinecap="round"
          strokeDasharray={`${circ * pct} ${circ}`}
          transform={`rotate(-90 ${c} ${c})`}
        />
      </svg>
      {label != null && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--ds-mono)",
            fontSize: Math.max(9, size * 0.22),
            fontWeight: 600,
            color: "var(--ds-fg)",
          }}
        >
          {label}
        </div>
      )}
    </div>
  );
}

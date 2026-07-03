import React from "react";
import { Tone, toneVars } from "../tokens";

export interface ProgressBarProps {
  /** 0..1 */
  value: number;
  tone?: Tone;
  height?: number;
}

/** Slim progress track with a tone fill (phase gates, day progress). */
export function ProgressBar({ value, tone = "accent", height = 4 }: ProgressBarProps) {
  const t = toneVars(tone);
  const pct = Math.max(0, Math.min(1, value)) * 100;
  return (
    <div style={{ width: "100%", height, borderRadius: "var(--ds-r-pill)", background: "var(--ds-selected)", overflow: "hidden" }}>
      <div
        style={{
          width: `${pct}%`,
          height: "100%",
          borderRadius: "var(--ds-r-pill)",
          background: t.color,
          transition: "width var(--ds-dur-slow) var(--ds-ease-snap)",
        }}
      />
    </div>
  );
}

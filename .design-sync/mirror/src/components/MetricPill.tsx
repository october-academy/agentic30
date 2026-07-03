import React from "react";
import { Tone, toneVars } from "../tokens";

export interface MetricPillProps {
  /** Prominent value (mono numerals — e.g. "3 · $0.04", "62%"). */
  value: React.ReactNode;
  /** Muted subtitle under the value. */
  subtitle?: React.ReactNode;
  /** Trailing node, right-aligned (badge, glyph). */
  trailing?: React.ReactNode;
  /** Colors the value. Default fg (neutral). */
  tone?: Tone;
}

/** Compact value + subtitle tile — the portfolio meta pills. */
export function MetricPill({ value, subtitle, trailing, tone }: MetricPillProps) {
  const valueColor = tone ? toneVars(tone).color : "var(--ds-fg)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 10,
        padding: "8px 10px",
        background: "var(--ds-surface-2)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-r-control)",
      }}
    >
      <div style={{ minWidth: 0 }}>
        <div style={{ fontFamily: "var(--ds-mono)", fontSize: "var(--ds-fs-amount)", fontWeight: 600, color: valueColor }}>
          {value}
        </div>
        {subtitle != null && (
          <div style={{ fontSize: "var(--ds-fs-caption)", color: "var(--ds-muted)", marginTop: 2 }}>{subtitle}</div>
        )}
      </div>
      {trailing != null && <div style={{ flex: "0 0 auto" }}>{trailing}</div>}
    </div>
  );
}

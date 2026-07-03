import React from "react";
import { Tone, toneVars } from "../tokens";

export interface BadgeProps {
  children: React.ReactNode;
  /** Semantic hue. Default accent (green). Use amber/rose only for severity. */
  tone?: Tone;
  /** Greyscale chip instead of a tinted one (neutral metadata). */
  neutral?: boolean;
  /** Leading status dot. */
  dot?: boolean;
  /** Monospace numerals/labels (default true — StyleSeed labels are mono + tracked). */
  mono?: boolean;
}

/** Small pill badge — status labels, day counters (D1/30), source tags. */
export function Badge({ children, tone = "accent", neutral, dot, mono = true }: BadgeProps) {
  const t = toneVars(tone);
  const style: React.CSSProperties = neutral
    ? { color: "var(--ds-fg-secondary)", background: "var(--ds-surface-2)", border: "1px solid var(--ds-border-strong)" }
    : { color: t.color, background: t.dim, border: `1px solid ${t.line}` };
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 20,
        padding: "0 8px",
        borderRadius: "var(--ds-r-pill)",
        fontFamily: mono ? "var(--ds-mono)" : "var(--ds-sans)",
        fontSize: 10.5,
        fontWeight: 600,
        letterSpacing: mono ? "0.02em" : undefined,
        whiteSpace: "nowrap",
        ...style,
      }}
    >
      {dot && (
        <span style={{ width: 5, height: 5, borderRadius: 999, background: neutral ? "var(--ds-muted)" : t.color }} />
      )}
      {children}
    </span>
  );
}

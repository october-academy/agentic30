import React from "react";
import { Tone, toneVars } from "../tokens";

export interface ChipProps {
  label: React.ReactNode;
  tone?: Tone;
  /** Selected/active filter state — solid tint + full-strength border. */
  active?: boolean;
  /** Optional trailing count pill (news/market filter chips). */
  count?: number | string;
  onClick?: () => void;
}

/** Filter / tag chip — the reference-page filter bars and news lane filters. */
export function Chip({ label, tone = "accent", active, count, onClick }: ChipProps) {
  const t = toneVars(tone);
  const style: React.CSSProperties = active
    ? { color: t.color, background: t.dim, border: `1px solid ${t.line}` }
    : { color: "var(--ds-fg-secondary)", background: "var(--ds-surface-2)", border: "1px solid var(--ds-border)" };
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 26,
        padding: "0 10px",
        borderRadius: "var(--ds-r-chip)",
        fontFamily: "var(--ds-sans)",
        fontSize: 12,
        fontWeight: 500,
        cursor: onClick ? "pointer" : "default",
        whiteSpace: "nowrap",
        transition: "background var(--ds-dur-fast) var(--ds-ease-snap), border-color var(--ds-dur-fast) var(--ds-ease-snap)",
        ...style,
      }}
    >
      {label}
      {count != null && (
        <span
          style={{
            fontFamily: "var(--ds-mono)",
            fontSize: 10,
            fontWeight: 600,
            padding: "1px 5px",
            borderRadius: "var(--ds-r-pill)",
            background: active ? t.line : "var(--ds-hover)",
            color: active ? t.color : "var(--ds-muted)",
          }}
        >
          {count}
        </span>
      )}
    </button>
  );
}

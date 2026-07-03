import React from "react";
import { Tone, toneVars } from "../tokens";

export interface KVRowProps {
  /** Left label — muted, describes the field ("진행 phase", "D-30 목표일"). */
  label: React.ReactNode;
  /** Right value — fg by default, or a Badge/node. May be colored by `tone`. */
  value: React.ReactNode;
  /** When set, colors the value with this hue (otherwise plain fg). */
  tone?: Tone;
}

/** Meta-panel key/value row — the portfolio "활성 프로젝트 · 3개" rows. */
export function KVRow({ label, value, tone }: KVRowProps) {
  const valueColor = tone ? toneVars(tone).color : "var(--ds-fg)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        padding: "7px 0",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8, fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)", minWidth: 0 }}>
        {label}
      </div>
      <div
        style={{
          fontFamily: "var(--ds-mono)",
          fontSize: "var(--ds-fs-body)",
          fontWeight: 500,
          color: valueColor,
          flex: "0 0 auto",
          textAlign: "right",
        }}
      >
        {value}
      </div>
    </div>
  );
}

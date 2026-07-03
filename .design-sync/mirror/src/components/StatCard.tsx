import React from "react";
import { Tone, toneVars } from "../tokens";

export interface StatCardProps {
  /** Muted metric label (e.g. "완료한 DAY"). */
  label: React.ReactNode;
  /** The big metric value (e.g. 0 or "14"). */
  value: React.ReactNode;
  /** Trailing unit shown next to the value ("/ 30", "day"). */
  unit?: React.ReactNode;
  /** Sub / trend line under the value (e.g. "→ Day 1 진행 중"). */
  sub?: React.ReactNode;
  /** Hue used for the sub line + optional left marker. Default accent. */
  tone?: Tone;
}

/** Metric tile — the Projects "완료한 DAY 0/30" cards. */
export function StatCard({ label, value, unit, sub, tone = "accent" }: StatCardProps) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-r-card)",
        boxShadow: "var(--ds-shadow-card)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div className="ds-eyebrow">{label}</div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
        <span
          style={{
            fontSize: "var(--ds-fs-kpi)",
            fontWeight: 700,
            lineHeight: 1,
            color: "var(--ds-fg)",
            letterSpacing: "-0.01em",
          }}
        >
          {value}
        </span>
        {unit != null && (
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)" }}>
            {unit}
          </span>
        )}
      </div>
      {sub != null && (
        <div style={{ fontSize: "var(--ds-fs-trend)", color: t.color, fontWeight: 500 }}>{sub}</div>
      )}
    </div>
  );
}

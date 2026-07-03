import React from "react";
import { Tone, toneVars } from "../../tokens";

export interface CalendarPhase {
  /** Inclusive 1-based day range this phase covers. */
  from: number;
  to: number;
  tone: Tone;
  /** Legend label (e.g. "초기 검증"). */
  label: string;
  /** Gate day within/at the end of this phase (amber-outlined cell). */
  gate?: number;
}

export interface DayCalendarProps {
  total?: number;
  /** Current day (filled accent cell). */
  current: number;
  phases: CalendarPhase[];
}

function phaseOf(day: number, phases: CalendarPhase[]): CalendarPhase | undefined {
  return phases.find((p) => day >= p.from && day <= p.to);
}

/** "30일 캘린더" strip — numbered day cells + per-phase underline bars + legend. */
export function DayCalendar({ total = 30, current, phases }: DayCalendarProps) {
  const days = Array.from({ length: total }, (_, i) => i + 1);
  const gateDays = new Set(phases.flatMap((p) => (p.gate != null ? [p.gate] : [])));
  // Reveal numbers up to the current phase's end; beyond that show "…".
  const currentPhase = phaseOf(current, phases);
  const revealThrough = currentPhase != null ? currentPhase.to + 2 : current + 2;

  return (
    <div style={{ padding: "18px 0 4px" }}>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", marginBottom: 12 }}>
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>30일 캘린더</span>
        <div style={{ display: "flex", alignItems: "center", gap: 14 }}>
          <LegendDot tone="accent" label="완료" />
          <LegendDot tone="accent" label="오늘" filled />
          <LegendDot tone="amber" label="게이트" />
        </div>
      </div>

      {/* day cells */}
      <div style={{ display: "flex", gap: 4, marginBottom: 8 }}>
        {days.map((d) => {
          const p = phaseOf(d, phases);
          const isGate = gateDays.has(d);
          const isCurrent = d === current;
          const cellTone = isGate ? "amber" : (p?.tone ?? "muted");
          const t = toneVars(cellTone);
          const revealed = d <= revealThrough;
          return (
            <div
              key={d}
              style={{
                flex: 1,
                minWidth: 0,
                aspectRatio: "1 / 1",
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                borderRadius: "var(--ds-r-chip)",
                fontFamily: "var(--ds-mono)",
                fontSize: 11,
                fontWeight: 600,
                color: isCurrent ? "var(--ds-accent-ink)" : revealed ? t.color : "var(--ds-muted-deep)",
                background: isCurrent ? t.color : revealed ? t.dim : "var(--ds-surface-2)",
                border: `1px solid ${isCurrent ? "transparent" : revealed ? t.line : "var(--ds-border-soft)"}`,
              }}
            >
              {revealed ? d : "…"}
            </div>
          );
        })}
      </div>

      {/* per-phase underline bars */}
      <div style={{ display: "flex", gap: 4, marginBottom: 12 }}>
        {phases.map((p, i) => {
          const span = p.to - p.from + 1;
          const t = toneVars(p.tone);
          return <div key={i} style={{ flex: span, height: 4, borderRadius: "var(--ds-r-pill)", background: t.color }} />;
        })}
      </div>

      {/* legend */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: "6px 18px" }}>
        {phases.map((p, i) => (
          <span key={i} style={{ display: "inline-flex", alignItems: "center", gap: 7, fontSize: 12 }}>
            <span
              style={{ width: 9, height: 9, borderRadius: 3, background: toneVars(p.tone).color, flex: "0 0 auto" }}
            />
            <span style={{ color: "var(--ds-fg-secondary)" }}>{p.label}</span>
            <span style={{ margin: "0 2px", color: "var(--ds-muted-deep)" }}>·</span>
            <span style={{ fontFamily: "var(--ds-mono)", fontWeight: 600, color: "var(--ds-fg)" }}>
              D{p.from - 1}–{p.to}
            </span>
          </span>
        ))}
      </div>
    </div>
  );
}

function LegendDot({ tone, label, filled }: { tone: Tone; label: string; filled?: boolean }) {
  const t = toneVars(tone);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, fontSize: 11, color: "var(--ds-muted)" }}>
      <span
        style={{
          width: 8,
          height: 8,
          borderRadius: 3,
          background: filled ? t.color : t.dim,
          border: `1px solid ${t.line}`,
        }}
      />
      {label}
    </span>
  );
}

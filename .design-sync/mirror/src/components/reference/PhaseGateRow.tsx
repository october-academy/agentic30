import React from "react";
import { Tone, toneVars } from "../../tokens";
import { ProgressBar } from "../ProgressBar";

export interface PhaseGateRowProps {
  /** Phase letter shown in the leading square badge (F / B / L / G). */
  letter: string;
  title: React.ReactNode;
  /** Day badge label (e.g. "D7"). */
  day?: string;
  /** Criteria / description line under the title. */
  subtitle?: React.ReactNode;
  /** Completion ratio 0..1 for the inline progress bar. */
  progress: number;
  /** Status pill copy ("진행 중" / "대기"). */
  status: React.ReactNode;
  /** Hue of the letter badge + progress fill + active pill. Default accent. */
  tone?: Tone;
}

/** Projects "PHASE 게이트" row — letter badge · title+day · progress bar · status pill. */
export function PhaseGateRow({ letter, title, day, subtitle, progress, status, tone = "accent" }: PhaseGateRowProps) {
  const t = toneVars(tone);
  const active = progress > 0;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 14,
        padding: "14px 4px",
        borderTop: "1px solid var(--ds-border-soft)",
      }}
    >
      {/* letter badge */}
      <div
        style={{
          flex: "0 0 auto",
          width: 40,
          height: 40,
          borderRadius: "var(--ds-r-control)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--ds-mono)",
          fontSize: 15,
          fontWeight: 700,
          color: t.color,
          background: t.dim,
          border: `1px solid ${t.line}`,
        }}
      >
        {letter}
      </div>

      {/* title + day + subtitle */}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
          <span style={{ fontSize: "var(--ds-fs-listname)", fontWeight: 600, color: "var(--ds-fg)" }}>{title}</span>
          {day != null && (
            <span
              style={{
                fontFamily: "var(--ds-mono)",
                fontSize: 10.5,
                fontWeight: 600,
                color: "var(--ds-muted)",
                background: "var(--ds-surface-2)",
                border: "1px solid var(--ds-border)",
                borderRadius: "var(--ds-r-pill)",
                padding: "1px 7px",
              }}
            >
              {day}
            </span>
          )}
        </div>
        {subtitle != null && (
          <div style={{ marginTop: 4, fontSize: 12, color: "var(--ds-muted)" }}>{subtitle}</div>
        )}
      </div>

      {/* progress bar */}
      <div style={{ flex: "0 0 130px" }}>
        <ProgressBar value={progress} tone={tone} height={5} />
      </div>

      {/* status pill */}
      <div
        style={{
          flex: "0 0 130px",
          height: 34,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          borderRadius: "var(--ds-r-pill)",
          fontSize: 12.5,
          fontWeight: 600,
          color: active ? t.color : "var(--ds-muted)",
          background: active ? t.dim : "var(--ds-surface-2)",
          border: active ? `1px solid ${t.line}` : "1px solid var(--ds-border)",
        }}
      >
        {status}
      </div>
    </div>
  );
}

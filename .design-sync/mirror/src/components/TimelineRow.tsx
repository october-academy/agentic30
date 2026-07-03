import React from "react";
import { Tone, toneVars } from "../tokens";

export interface TimelineRowProps {
  /** Timestamp / day marker (mono, muted — "09:29", "Day 1"). */
  time?: React.ReactNode;
  /** Row title (fg, bold). */
  title: React.ReactNode;
  /** Muted supporting body. */
  body?: React.ReactNode;
  /** Node dot + connector hue. Default accent. */
  tone?: Tone;
  /** Draw the vertical connector line below the dot (chain rows together). */
  connector?: boolean;
}

/** Evidence / day timeline row — a dot + connector rail with title/body. */
export function TimelineRow({ time, title, body, tone = "accent", connector }: TimelineRowProps) {
  const t = toneVars(tone);
  return (
    <div style={{ display: "flex", gap: 12 }}>
      <div style={{ display: "flex", flexDirection: "column", alignItems: "center", flex: "0 0 auto", paddingTop: 3 }}>
        <span
          style={{
            width: 10,
            height: 10,
            borderRadius: "var(--ds-r-pill)",
            background: t.dim,
            border: `1.5px solid ${t.color}`,
          }}
        />
        {connector && <span style={{ flex: "1 1 auto", width: 1.5, minHeight: 20, marginTop: 4, background: "var(--ds-border)" }} />}
      </div>
      <div style={{ minWidth: 0, paddingBottom: connector ? 16 : 0 }}>
        {time != null && (
          <div style={{ fontFamily: "var(--ds-mono)", fontSize: "var(--ds-fs-caption)", color: "var(--ds-muted)", marginBottom: 2 }}>
            {time}
          </div>
        )}
        <div style={{ fontSize: "var(--ds-fs-listname)", fontWeight: 600, color: "var(--ds-fg)" }}>{title}</div>
        {body != null && (
          <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", marginTop: 3, lineHeight: 1.5 }}>
            {body}
          </div>
        )}
      </div>
    </div>
  );
}

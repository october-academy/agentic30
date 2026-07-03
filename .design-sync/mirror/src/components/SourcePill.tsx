import React from "react";
import { Tone, toneVars } from "../tokens";

export interface SourcePillProps {
  /** Pill text — a path, source name, or tag (mono). */
  label: React.ReactNode;
  /** Leading glyph (SF-symbol-like char/node — folder, link, doc). */
  icon?: React.ReactNode;
  /** "muted" (greyscale, default) or a Tone that tints text + border. */
  tone?: "muted" | Tone;
}

/** Small source / path pill with a leading glyph — settings path pill, source tag. */
export function SourcePill({ label, icon, tone = "muted" }: SourcePillProps) {
  const isMuted = tone === "muted";
  const t = toneVars(isMuted ? "muted" : (tone as Tone));
  const color = isMuted ? "var(--ds-fg-secondary)" : t.color;
  const border = isMuted ? "var(--ds-border)" : t.line;
  const bg = isMuted ? "var(--ds-surface-2)" : t.dim;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        maxWidth: "100%",
        padding: "3px 9px",
        borderRadius: "var(--ds-r-pill)",
        background: bg,
        border: `1px solid ${border}`,
        fontFamily: "var(--ds-mono)",
        fontSize: 11,
        color,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
      }}
    >
      {icon != null && <span style={{ flex: "0 0 auto", fontSize: 11, display: "inline-flex", opacity: 0.85 }}>{icon}</span>}
      <span style={{ overflow: "hidden", textOverflow: "ellipsis" }}>{label}</span>
    </span>
  );
}

import React from "react";
import { Tone, toneVars } from "../tokens";

export interface AvatarProps {
  /** 1–3 char initials (A3, LJ, QMD). */
  initials: string;
  tone?: Tone;
  size?: number;
  /** Muted greyscale tile instead of a tinted one. */
  muted?: boolean;
}

/** Rounded-square initials tile — project / source identity. */
export function Avatar({ initials, tone = "accent", size = 40, muted }: AvatarProps) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        width: size,
        height: size,
        flex: "0 0 auto",
        borderRadius: "var(--ds-r-control)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--ds-mono)",
        fontSize: size * 0.36,
        fontWeight: 600,
        letterSpacing: "0.01em",
        color: muted ? "var(--ds-fg-secondary)" : t.color,
        background: muted ? "var(--ds-surface-2)" : t.dim,
        border: `1px solid ${muted ? "var(--ds-border-strong)" : t.line}`,
      }}
    >
      {initials}
    </div>
  );
}

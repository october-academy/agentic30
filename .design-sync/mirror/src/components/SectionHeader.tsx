import React from "react";
import { Tone, toneVars } from "../tokens";

export interface SectionHeaderProps {
  title: React.ReactNode;
  /** Right-aligned meta text (mono, muted) — counts, timestamps. */
  meta?: React.ReactNode;
  /** Left marker-bar hue. */
  tone?: Tone;
  /** Small uppercase eyebrow above the title. */
  eyebrow?: React.ReactNode;
  /** Hairline divider under the header. */
  divider?: boolean;
}

/** Section header with a tone marker bar + optional meta and divider. */
export function SectionHeader({ title, meta, tone = "accent", eyebrow, divider }: SectionHeaderProps) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "flex-end",
        justifyContent: "space-between",
        gap: 12,
        padding: "0 0 8px",
        borderBottom: divider ? "1px solid var(--ds-border-soft)" : undefined,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <span style={{ width: 3, height: 15, borderRadius: 2, background: t.color, flex: "0 0 auto" }} />
        <div style={{ minWidth: 0 }}>
          {eyebrow != null && (
            <div className="ds-eyebrow" style={{ marginBottom: 2 }}>
              {eyebrow}
            </div>
          )}
          <div
            style={{
              fontSize: "var(--ds-fs-section)",
              fontWeight: 600,
              color: "var(--ds-fg)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {title}
          </div>
        </div>
      </div>
      {meta != null && (
        <div style={{ fontFamily: "var(--ds-mono)", fontSize: 11, color: "var(--ds-muted)", flex: "0 0 auto" }}>{meta}</div>
      )}
    </div>
  );
}

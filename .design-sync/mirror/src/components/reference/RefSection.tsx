import React from "react";
import { Tone, toneVars } from "../../tokens";

export interface RefSectionProps {
  title: React.ReactNode;
  /** Trailing count node next to the title (e.g. a Badge). */
  count?: React.ReactNode;
  /** Muted supporting line under / beside the title. */
  subtitle?: React.ReactNode;
  /** Left marker-bar hue. */
  markerTone?: Tone;
  children?: React.ReactNode;
}

/** Main-column section block — tone marker + title + count + subtitle, then content. */
export function RefSection({ title, count, subtitle, markerTone = "accent", children }: RefSectionProps) {
  const t = toneVars(markerTone);
  return (
    <section style={{ padding: "22px 0" }}>
      <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: subtitle != null ? 8 : 14 }}>
        <span style={{ width: 3, height: 15, borderRadius: 2, background: t.color, flex: "0 0 auto" }} />
        <span style={{ fontSize: "var(--ds-fs-section)", fontWeight: 600, color: "var(--ds-fg)" }}>{title}</span>
        {count != null && <span style={{ flex: "0 0 auto" }}>{count}</span>}
      </div>
      {subtitle != null && (
        <div style={{ marginBottom: 14, fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)" }}>
          {subtitle}
        </div>
      )}
      {children}
    </section>
  );
}

import React from "react";
import { Tone, toneVars } from "../tokens";

export interface DebtBannerProps {
  /** Severity hue — tints the banner + left rail. Default amber (evidence debt / defer). */
  tone?: Tone;
  /** Banner title (fg, bold). */
  title: React.ReactNode;
  /** Muted supporting copy under the title. */
  body?: React.ReactNode;
  /** Leading glyph (SF-symbol-like char/node); defaults to a tone-colored dot. */
  icon?: React.ReactNode;
  /** Trailing action node, right-aligned. */
  action?: React.ReactNode;
}

/** Severity / notice banner — evidence-debt, defer, blocked notices. */
export function DebtBanner({ tone = "amber", title, body, icon, action }: DebtBannerProps) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        position: "relative",
        display: "flex",
        alignItems: "flex-start",
        gap: 11,
        padding: "12px 14px",
        paddingLeft: 16,
        background: t.dim,
        border: `1px solid ${t.line}`,
        borderRadius: "var(--ds-r-control)",
        overflow: "hidden",
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: t.color }} />
      <div style={{ flex: "0 0 auto", marginTop: 1, color: t.color, fontSize: 14, lineHeight: 1, display: "flex" }}>
        {icon ?? <span style={{ width: 7, height: 7, borderRadius: 999, background: t.color, marginTop: 4 }} />}
      </div>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ fontSize: "var(--ds-fs-body)", fontWeight: 600, color: "var(--ds-fg)" }}>{title}</div>
        {body != null && (
          <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", marginTop: 3, lineHeight: 1.5 }}>
            {body}
          </div>
        )}
      </div>
      {action != null && <div style={{ flex: "0 0 auto" }}>{action}</div>}
    </div>
  );
}

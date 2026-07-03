import React from "react";
import { Tone, toneVars } from "../tokens";

export interface CardProps {
  /** Small uppercase mono eyebrow above the title. */
  eyebrow?: React.ReactNode;
  /** Card title (section-size, fg). */
  title?: React.ReactNode;
  /** Muted one-line subtitle under the title. */
  subtitle?: React.ReactNode;
  /** Primary body text (fg-secondary). Ignored when children are supplied. */
  body?: React.ReactNode;
  /** Arbitrary content in the card body — takes precedence over `body`. */
  children?: React.ReactNode;
  /** Trailing action node, right-aligned in the header row. */
  actions?: React.ReactNode;
  /** Hue of the optional left marker bar. Default accent. */
  tone?: Tone;
  /** Draw the left tone marker bar (off by default — a plain surface card). */
  marker?: boolean;
  /** Inner padding. Default true; set false for edge-to-edge content (lists). */
  padded?: boolean;
}

/** Generic surface card — the base panel for the reference layout. */
export function Card({
  eyebrow,
  title,
  subtitle,
  body,
  children,
  actions,
  tone = "accent",
  marker,
  padded = true,
}: CardProps) {
  const t = toneVars(tone);
  const hasHeader = eyebrow != null || title != null || subtitle != null || actions != null;
  return (
    <div
      style={{
        position: "relative",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-r-card)",
        boxShadow: "var(--ds-shadow-card)",
        overflow: "hidden",
      }}
    >
      {marker && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 0,
            bottom: 0,
            width: 3,
            background: t.color,
          }}
        />
      )}
      <div style={{ padding: padded ? 16 : 0, paddingLeft: padded && marker ? 18 : padded ? 16 : 0 }}>
        {hasHeader && (
          <div
            style={{
              display: "flex",
              alignItems: "flex-start",
              justifyContent: "space-between",
              gap: 12,
              marginBottom: children != null || body != null ? 12 : 0,
            }}
          >
            <div style={{ minWidth: 0 }}>
              {eyebrow != null && (
                <div className="ds-eyebrow" style={{ marginBottom: 4 }}>
                  {eyebrow}
                </div>
              )}
              {title != null && (
                <div style={{ fontSize: "var(--ds-fs-section)", fontWeight: 600, color: "var(--ds-fg)" }}>{title}</div>
              )}
              {subtitle != null && (
                <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)", marginTop: 3 }}>{subtitle}</div>
              )}
            </div>
            {actions != null && <div style={{ flex: "0 0 auto" }}>{actions}</div>}
          </div>
        )}
        {children != null
          ? children
          : body != null && (
              <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", lineHeight: 1.5 }}>{body}</div>
            )}
      </div>
    </div>
  );
}

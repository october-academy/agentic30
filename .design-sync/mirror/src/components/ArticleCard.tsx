import React from "react";

export interface ArticleCardProps {
  /** Small mono eyebrow (e.g. "안 읽음", source lane). */
  eyebrow?: React.ReactNode;
  /** Highlighted / featured state → accent-dim bg + accent-line border. */
  highlight?: boolean;
  /** Article title (fg, bold). */
  title: React.ReactNode;
  /** Muted summary / snippet body. */
  body?: React.ReactNode;
  /** Footer meta node (mono, muted — time, read-count). */
  meta?: React.ReactNode;
  /** Top-right actions (icon buttons — bookmark, open). */
  actions?: React.ReactNode;
  /** Source attribution — name + optional url/detail, shown as a small source pill row. */
  source?: { name: string; url?: string; detail?: string };
}

/** News / market-radar card. */
export function ArticleCard({ eyebrow, highlight, title, body, meta, actions, source }: ArticleCardProps) {
  return (
    <div
      style={{
        position: "relative",
        background: highlight ? "var(--ds-accent-dim)" : "var(--ds-surface)",
        border: `1px solid ${highlight ? "var(--ds-accent-line)" : "var(--ds-border)"}`,
        borderRadius: "var(--ds-r-card)",
        boxShadow: "var(--ds-shadow-card)",
        padding: 15,
        display: "flex",
        flexDirection: "column",
        gap: 8,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          {eyebrow != null && <div className="ds-eyebrow" style={{ marginBottom: 6, color: highlight ? "var(--ds-accent)" : undefined }}>{eyebrow}</div>}
          <div style={{ fontSize: "var(--ds-fs-section)", fontWeight: 600, color: "var(--ds-fg)", lineHeight: 1.4 }}>
            {title}
          </div>
        </div>
        {actions != null && <div style={{ flex: "0 0 auto", display: "flex", gap: 4, color: "var(--ds-muted)" }}>{actions}</div>}
      </div>

      {body != null && (
        <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", lineHeight: 1.55 }}>{body}</div>
      )}

      {source != null && (
        <div style={{ display: "flex", alignItems: "center", gap: 6, marginTop: 2 }}>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              padding: "2px 8px",
              borderRadius: "var(--ds-r-pill)",
              background: "var(--ds-surface-2)",
              border: "1px solid var(--ds-border)",
              fontFamily: "var(--ds-mono)",
              fontSize: 10.5,
              color: "var(--ds-sky)",
            }}
          >
            {source.name}
          </span>
          {source.detail != null && (
            <span style={{ fontSize: "var(--ds-fs-caption)", color: "var(--ds-muted)" }}>{source.detail}</span>
          )}
        </div>
      )}

      {meta != null && (
        <div style={{ fontFamily: "var(--ds-mono)", fontSize: "var(--ds-fs-caption)", color: "var(--ds-muted)", marginTop: 2 }}>
          {meta}
        </div>
      )}
    </div>
  );
}

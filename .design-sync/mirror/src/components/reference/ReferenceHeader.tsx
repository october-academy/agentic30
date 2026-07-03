import React from "react";

export interface ReferenceHeaderProps {
  /** Leading identity tile (an <Avatar /> or Avatar-like node). */
  icon?: React.ReactNode;
  title: React.ReactNode;
  /** Trailing badge next to the title (status). */
  badge?: React.ReactNode;
  /** Muted subtitle fragments rendered dot-separated. */
  subtitleParts?: React.ReactNode[];
  /** Right-aligned action buttons. */
  actions?: React.ReactNode;
}

/** Main-column page header — icon tile, title + badge, dotted subtitle, actions. */
export function ReferenceHeader({ icon, title, badge, subtitleParts, actions }: ReferenceHeaderProps) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 16, paddingBottom: 20 }}>
      {icon != null && <span style={{ flex: "0 0 auto", display: "inline-flex", paddingTop: 2 }}>{icon}</span>}
      <div style={{ flex: 1, minWidth: 0 }}>
        <div style={{ display: "flex", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
          <span style={{ fontSize: 22, fontWeight: 700, color: "var(--ds-fg)", lineHeight: 1.15 }}>{title}</span>
          {badge != null && badge}
        </div>
        {subtitleParts != null && subtitleParts.length > 0 && (
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              marginTop: 7,
              fontSize: "var(--ds-fs-body)",
              color: "var(--ds-muted)",
            }}
          >
            {subtitleParts.map((p, i) => (
              <React.Fragment key={i}>
                {i > 0 && <span style={{ margin: "0 8px", color: "var(--ds-muted-deep)" }}>·</span>}
                <span>{p}</span>
              </React.Fragment>
            ))}
          </div>
        )}
      </div>
      {actions != null && (
        <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8 }}>{actions}</div>
      )}
    </div>
  );
}

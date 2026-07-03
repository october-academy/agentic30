import React from "react";
import { Input } from "../Input";

export interface SidebarGroup {
  /** Small uppercase group label. */
  label?: string;
  /** Right-aligned count (mono, muted). */
  count?: string;
  /** Rows — typically <SideRow /> nodes. */
  rows: React.ReactNode[];
}

export interface ReferenceSidebarProps {
  /** Sidebar title — plain string or a node (glyph + text). */
  title: React.ReactNode;
  /** Trailing badge next to the title (e.g. "활성 3"). */
  badge?: React.ReactNode;
  /** Search input placeholder; omit to hide the search box. */
  search?: string;
  groups: SidebarGroup[];
  /** Bottom-pinned node — footer note and/or accent CTA. */
  footer?: React.ReactNode;
}

/** 240px task/nav sidebar — title + search + grouped SideRows + footer. */
export function ReferenceSidebar({ title, badge, search, groups, footer }: ReferenceSidebarProps) {
  return (
    <div
      style={{
        width: 240,
        flex: "0 0 240px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--ds-surface-2)",
        borderRight: "1px solid var(--ds-border-soft)",
      }}
    >
      <div style={{ padding: "16px 14px 10px" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 8, marginBottom: 12 }}>
          <div
            style={{
              flex: 1,
              minWidth: 0,
              display: "flex",
              alignItems: "center",
              gap: 8,
              fontSize: 15,
              fontWeight: 700,
              color: "var(--ds-fg)",
            }}
          >
            {title}
          </div>
          {badge != null && <span style={{ flex: "0 0 auto" }}>{badge}</span>}
        </div>
        {search != null && <Input placeholder={search} icon={<span>⌕</span>} kbd="⌘P" />}
      </div>

      <div className="ds-scroll" style={{ flex: 1, overflowY: "auto", padding: "0 8px 12px" }}>
        {groups.map((g, gi) => (
          <div key={gi} style={{ marginTop: gi === 0 ? 4 : 16 }}>
            {(g.label != null || g.count != null) && (
              <div
                style={{
                  display: "flex",
                  alignItems: "baseline",
                  justifyContent: "space-between",
                  padding: "0 8px 6px",
                }}
              >
                {g.label != null && <span className="ds-eyebrow">{g.label}</span>}
                {g.count != null && (
                  <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11, color: "var(--ds-muted)" }}>{g.count}</span>
                )}
              </div>
            )}
            <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
              {g.rows.map((r, ri) => (
                <React.Fragment key={ri}>{r}</React.Fragment>
              ))}
            </div>
          </div>
        ))}
      </div>

      {footer != null && (
        <div style={{ flex: "0 0 auto", padding: "10px 12px 14px", borderTop: "1px solid var(--ds-border-soft)" }}>
          {footer}
        </div>
      )}
    </div>
  );
}

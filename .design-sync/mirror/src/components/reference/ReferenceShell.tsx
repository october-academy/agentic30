import React from "react";

export interface ReferenceShellProps {
  /** The 52px <Rail />. */
  rail: React.ReactNode;
  /** The 240px <ReferenceSidebar />. */
  sidebar: React.ReactNode;
  /** The <Titlebar /> pinned above the main column. */
  titlebar: React.ReactNode;
  /** Main scrolling content (the page body). */
  children: React.ReactNode;
  /** The 280px <MetaPanel />. */
  meta?: React.ReactNode;
}

/** The one dark window shell shared by all 6 reference pages. */
export function ReferenceShell({ rail, sidebar, titlebar, children, meta }: ReferenceShellProps) {
  return (
    <div
      className="ds-root"
      style={{
        display: "flex",
        height: "100%",
        minHeight: 0,
        background: "var(--ds-page)",
        borderRadius: "var(--ds-r-card)",
        border: "1px solid var(--ds-border)",
        boxShadow: "var(--ds-shadow-elevated)",
        overflow: "hidden",
      }}
    >
      {rail}
      {sidebar}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--ds-page)" }}>
        {titlebar}
        <div className="ds-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
          <div style={{ maxWidth: 880, margin: "0 auto", padding: "24px" }}>{children}</div>
        </div>
      </div>
      {meta}
    </div>
  );
}

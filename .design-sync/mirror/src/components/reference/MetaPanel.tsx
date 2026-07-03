import React from "react";

export interface MetaPanelProps {
  title: React.ReactNode;
  /** Composed content — KV rows, tinted banners, action buttons. */
  children?: React.ReactNode;
}

/** 280px right meta panel — scroll container + title; caller composes the body. */
export function MetaPanel({ title, children }: MetaPanelProps) {
  return (
    <aside
      style={{
        width: 280,
        flex: "0 0 280px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--ds-surface)",
        borderLeft: "1px solid var(--ds-border-soft)",
      }}
    >
      <div className="ds-scroll" style={{ flex: 1, overflowY: "auto", padding: "18px 16px 22px" }}>
        <div style={{ fontSize: 15, fontWeight: 700, color: "var(--ds-fg)", marginBottom: 14 }}>{title}</div>
        {children}
      </div>
    </aside>
  );
}

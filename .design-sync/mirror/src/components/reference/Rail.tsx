import React from "react";

export interface RailItem {
  /** SF-symbol-like glyph or small node. */
  icon: React.ReactNode;
  active?: boolean;
  /** Small "new" dot on the top-right of the slot. */
  dot?: boolean;
  onClick?: () => void;
}

export interface RailProps {
  items: RailItem[];
  /** Bottom-pinned node (e.g. an Avatar). */
  footer?: React.ReactNode;
}

/** 52px vertical icon nav — the leftmost app rail. */
export function Rail({ items, footer }: RailProps) {
  return (
    <div
      style={{
        width: 52,
        flex: "0 0 52px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "12px 0",
        gap: 6,
        background: "var(--ds-bg-deep)",
        borderRight: "1px solid var(--ds-border-soft)",
      }}
    >
      {items.map((it, i) => (
        <button
          key={i}
          type="button"
          onClick={it.onClick}
          style={{
            position: "relative",
            width: 34,
            height: 34,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            borderRadius: "var(--ds-r-control)",
            fontSize: 17,
            cursor: "pointer",
            color: it.active ? "var(--ds-accent)" : "var(--ds-muted)",
            background: it.active ? "var(--ds-accent-dim)" : "transparent",
            border: it.active ? "1px solid var(--ds-accent-line)" : "1px solid transparent",
            transition:
              "background var(--ds-dur-fast) var(--ds-ease-snap), color var(--ds-dur-fast) var(--ds-ease-snap)",
          }}
        >
          {it.icon}
          {it.dot && (
            <span
              style={{
                position: "absolute",
                top: 5,
                right: 5,
                width: 6,
                height: 6,
                borderRadius: 999,
                background: "var(--ds-accent)",
                border: "1px solid var(--ds-bg-deep)",
              }}
            />
          )}
        </button>
      ))}
      {footer != null && <div style={{ marginTop: "auto" }}>{footer}</div>}
    </div>
  );
}

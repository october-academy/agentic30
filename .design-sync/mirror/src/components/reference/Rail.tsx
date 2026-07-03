import React from "react";
import { Icon } from "../Icon";

export interface RailItem {
  /** SF-symbol-like glyph or small node. */
  icon: React.ReactNode;
  active?: boolean;
  /** Small "new" dot on the top-right of the slot. */
  dot?: boolean;
  /** Gated feature — dims the slot and overlays a small lock badge. */
  lock?: boolean;
  /** Small count badge (top-right). Takes precedence over `dot`. */
  badge?: React.ReactNode;
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
            color: it.active ? "var(--ds-accent)" : it.lock ? "var(--ds-muted-deep)" : "var(--ds-muted)",
            background: it.active ? "var(--ds-accent-dim)" : "transparent",
            border: it.active ? "1px solid var(--ds-accent-line)" : "1px solid transparent",
            opacity: it.lock ? 0.7 : 1,
            transition:
              "background var(--ds-dur-fast) var(--ds-ease-snap), color var(--ds-dur-fast) var(--ds-ease-snap)",
          }}
        >
          {it.icon}
          {it.badge != null ? (
            <span
              style={{
                position: "absolute",
                top: 2,
                right: 1,
                minWidth: 13,
                height: 13,
                padding: "0 3px",
                borderRadius: 999,
                background: "var(--ds-accent)",
                color: "var(--ds-accent-ink)",
                fontFamily: "var(--ds-mono)",
                fontSize: 8.5,
                fontWeight: 700,
                display: "flex",
                alignItems: "center",
                justifyContent: "center",
                border: "1.5px solid var(--ds-bg-deep)",
              }}
            >
              {it.badge}
            </span>
          ) : it.lock ? (
            <span
              style={{
                position: "absolute",
                bottom: 3,
                right: 3,
                display: "inline-flex",
                color: "var(--ds-muted-deep)",
                background: "var(--ds-bg-deep)",
                borderRadius: 4,
              }}
            >
              <Icon name="lock.fill" size={9} />
            </span>
          ) : it.dot ? (
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
          ) : null}
        </button>
      ))}
      {footer != null && <div style={{ marginTop: "auto" }}>{footer}</div>}
    </div>
  );
}

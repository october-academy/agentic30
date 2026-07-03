import React from "react";
import { Icon } from "./Icon";

export interface WorkspaceRailItem {
  /**
   * The slot glyph. A **string** is treated as an SF Symbol name and rendered
   * via the built `Icon` (`"folder.fill"` → `<Icon name="folder.fill" />`); any
   * other node is rendered as-is.
   */
  icon: React.ReactNode | string;
  /** Selected lane — accent-tinted rounded square + accent glyph. */
  active?: boolean;
  /** Gated lane — dimmed slot with a small lock overlay; not selectable. */
  locked?: boolean;
  /** Unread/new-activity marker — small accent dot on the top-right. */
  newDot?: boolean;
  /** Short count string (e.g. "3", "9+") shown as a mono pill on the top-right. */
  badge?: string;
  /** Accessible label for the slot button (SF-symbol strings alone read poorly). */
  title?: string;
  onClick?: () => void;
}

export interface WorkspaceRailProps {
  items: WorkspaceRailItem[];
  /** Bottom-pinned node (e.g. an `<Avatar />`), pushed to the base of the rail. */
  footer?: React.ReactNode;
}

/** Render a rail item's glyph: string → Icon, otherwise the node verbatim. */
function renderGlyph(icon: React.ReactNode | string): React.ReactNode {
  if (typeof icon === "string") {
    return <Icon name={icon} size={18} title="" />;
  }
  return icon;
}

/**
 * The workspace left rail — a 52px vertical icon nav (`--ds-pane-rail`) on the
 * deepest window layer. Richer than the reference `Rail`: slots can be `active`
 * (accent-tinted square), `locked` (dimmed + lock overlay), carry a `newDot`, or
 * a small `badge` count. String icons resolve through the built `Icon`.
 */
export function WorkspaceRail({ items, footer }: WorkspaceRailProps) {
  return (
    <div
      style={{
        width: "var(--ds-pane-rail)",
        flex: "0 0 var(--ds-pane-rail)",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        padding: "var(--ds-space-6) 0",
        gap: "var(--ds-space-3)",
        background: "var(--ds-bg-deep)",
        borderRight: "1px solid var(--ds-border-soft)",
      }}
    >
      {items.map((it, i) => {
        const interactive = !it.locked;
        const tint = it.active
          ? "var(--ds-accent)"
          : it.locked
            ? "var(--ds-muted-deep)"
            : "var(--ds-muted)";
        return (
          <button
            key={i}
            type="button"
            onClick={interactive ? it.onClick : undefined}
            disabled={it.locked}
            aria-pressed={it.active ? true : undefined}
            aria-label={it.title}
            title={it.title}
            style={{
              position: "relative",
              width: "var(--ds-h-rail-item)",
              height: "var(--ds-h-rail-item)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              padding: 0,
              borderRadius: "var(--ds-r-control)",
              color: tint,
              background: it.active ? "var(--ds-accent-dim)" : "transparent",
              border: it.active
                ? "1px solid var(--ds-accent-line)"
                : "1px solid transparent",
              opacity: it.locked ? 0.55 : 1,
              cursor: it.locked ? "default" : "pointer",
              transition:
                "background var(--ds-dur-fast) var(--ds-ease-snap), color var(--ds-dur-fast) var(--ds-ease-snap), border-color var(--ds-dur-fast) var(--ds-ease-snap)",
            }}
          >
            {renderGlyph(it.icon)}

            {/* locked → small lock glyph pinned to the bottom-right corner */}
            {it.locked && (
              <span
                style={{
                  position: "absolute",
                  right: -2,
                  bottom: -2,
                  width: 14,
                  height: 14,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--ds-r-pill)",
                  background: "var(--ds-bg-deep)",
                  color: "var(--ds-muted)",
                }}
              >
                <Icon name="lock.fill" size={9} title="잠김" />
              </span>
            )}

            {/* badge count → mono pill, top-right (takes precedence over newDot) */}
            {it.badge != null && it.badge !== "" ? (
              <span
                style={{
                  position: "absolute",
                  top: -4,
                  right: -4,
                  minWidth: 15,
                  height: 15,
                  padding: "0 4px",
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  borderRadius: "var(--ds-r-pill)",
                  fontFamily: "var(--ds-mono)",
                  fontSize: 9,
                  fontWeight: 600,
                  lineHeight: 1,
                  color: "var(--ds-accent-ink)",
                  background: "var(--ds-accent)",
                  border: "1.5px solid var(--ds-bg-deep)",
                }}
              >
                {it.badge}
              </span>
            ) : (
              it.newDot && (
                <span
                  aria-hidden
                  style={{
                    position: "absolute",
                    top: 4,
                    right: 4,
                    width: 6,
                    height: 6,
                    borderRadius: "var(--ds-r-pill)",
                    background: "var(--ds-accent)",
                    border: "1px solid var(--ds-bg-deep)",
                  }}
                />
              )
            )}
          </button>
        );
      })}

      {footer != null && (
        <div
          style={{
            marginTop: "auto",
            paddingTop: "var(--ds-space-3)",
            display: "flex",
            justifyContent: "center",
          }}
        >
          {footer}
        </div>
      )}
    </div>
  );
}

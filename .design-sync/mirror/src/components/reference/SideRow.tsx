import React from "react";
import { Tone, toneVars } from "../../tokens";

export interface SideRowProps {
  /** Leading node — an Avatar tile, glyph, or bookmark icon. */
  leading?: React.ReactNode;
  title: React.ReactNode;
  /** Bulleted / dot-separated metadata line under the title. */
  subtitle?: React.ReactNode;
  /** Trailing node — usually a Badge (D1/30, 완주, 템플릿). */
  badge?: React.ReactNode;
  /** Active-state accent tint. */
  tone?: Tone;
  active?: boolean;
  onClick?: () => void;
}

/** Sidebar list row — project/stream/lane entries. */
export function SideRow({ leading, title, subtitle, badge, tone = "accent", active, onClick }: SideRowProps) {
  const t = toneVars(tone);
  return (
    <button
      type="button"
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: "var(--ds-r-control)",
        cursor: onClick ? "pointer" : "default",
        background: active ? t.dim : "transparent",
        border: active ? `1px solid ${t.line}` : "1px solid transparent",
        transition: "background var(--ds-dur-fast) var(--ds-ease-snap)",
      }}
    >
      {active && (
        <span
          style={{
            position: "absolute",
            left: 0,
            top: 8,
            bottom: 8,
            width: 2,
            borderRadius: 2,
            background: t.color,
          }}
        />
      )}
      {leading != null && <span style={{ flex: "0 0 auto", display: "inline-flex" }}>{leading}</span>}
      <span style={{ flex: 1, minWidth: 0 }}>
        <span
          style={{
            display: "block",
            fontFamily: "var(--ds-sans)",
            fontSize: "var(--ds-fs-listname)",
            fontWeight: 600,
            color: "var(--ds-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        {subtitle != null && (
          <span
            style={{
              display: "block",
              marginTop: 2,
              fontSize: 11.5,
              color: "var(--ds-muted)",
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {subtitle}
          </span>
        )}
      </span>
      {badge != null && <span style={{ flex: "0 0 auto" }}>{badge}</span>}
    </button>
  );
}

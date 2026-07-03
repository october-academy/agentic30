import React from "react";
import { Tone, toneVars } from "../tokens";

export interface ListRowProps {
  /** Leading slot — an Avatar, icon glyph, or status dot. */
  leading?: React.ReactNode;
  /** Row title (fg, listname size). */
  title: React.ReactNode;
  /** Muted one-line subtitle under the title. */
  subtitle?: React.ReactNode;
  /** Optional secondary body line (fg-secondary). */
  body?: React.ReactNode;
  /** Trailing slot, right-aligned (Badge, count, chevron). */
  trailing?: React.ReactNode;
  /** Small chips row under the subtitle — strings or arbitrary nodes. */
  chips?: React.ReactNode[] | React.ReactNode;
  /** Hue of the active marker + selected tint. Default accent. */
  tone?: Tone;
  /** Selected/active state — left tone marker + subtle fill. */
  active?: boolean;
  onClick?: () => void;
}

/** The reference list row — project rows, source rows, evidence rows. */
export function ListRow({ leading, title, subtitle, body, trailing, chips, tone = "accent", active, onClick }: ListRowProps) {
  const t = toneVars(tone);
  const chipList = Array.isArray(chips) ? chips : chips != null ? [chips] : [];
  return (
    <div
      onClick={onClick}
      style={{
        position: "relative",
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "10px 12px",
        paddingLeft: active ? 14 : 12,
        borderRadius: "var(--ds-r-control)",
        background: active ? t.dim : "transparent",
        border: `1px solid ${active ? t.line : "transparent"}`,
        cursor: onClick ? "pointer" : "default",
        transition: "background var(--ds-dur-fast) var(--ds-ease-snap)",
      }}
    >
      {active && (
        <span
          style={{ position: "absolute", left: 0, top: 8, bottom: 8, width: 3, borderRadius: 2, background: t.color }}
        />
      )}
      {leading != null && <div style={{ flex: "0 0 auto" }}>{leading}</div>}
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div
          style={{
            fontSize: "var(--ds-fs-listname)",
            fontWeight: 600,
            color: "var(--ds-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </div>
        {subtitle != null && (
          <div style={{ fontSize: "var(--ds-fs-caption)", color: "var(--ds-muted)", marginTop: 2 }}>{subtitle}</div>
        )}
        {body != null && (
          <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", marginTop: 4, lineHeight: 1.5 }}>
            {body}
          </div>
        )}
        {chipList.length > 0 && (
          <div style={{ display: "flex", flexWrap: "wrap", gap: 5, marginTop: 6 }}>
            {chipList.map((c, i) =>
              typeof c === "string" ? (
                <span
                  key={i}
                  style={{
                    fontFamily: "var(--ds-mono)",
                    fontSize: 10,
                    color: "var(--ds-muted)",
                    background: "var(--ds-surface-2)",
                    border: "1px solid var(--ds-border)",
                    borderRadius: "var(--ds-r-chip)",
                    padding: "1px 6px",
                  }}
                >
                  {c}
                </span>
              ) : (
                <React.Fragment key={i}>{c}</React.Fragment>
              )
            )}
          </div>
        )}
      </div>
      {trailing != null && <div style={{ flex: "0 0 auto", color: "var(--ds-muted)" }}>{trailing}</div>}
    </div>
  );
}

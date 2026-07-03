import React from "react";
import { Spinner } from "./Spinner";

export interface StateCardProps {
  /** State variant — drives tint + default glyph. Default "empty". */
  kind?: "empty" | "error" | "loading";
  /** Leading glyph (SF-symbol-like char/node). Overridden by Spinner when loading. */
  icon?: React.ReactNode;
  /** Headline (fg). */
  title: React.ReactNode;
  /** Muted supporting copy. */
  body?: React.ReactNode;
  /** Trailing action node (usually a Button). */
  action?: React.ReactNode;
}

/** Empty / error / loading placeholder card, centered. */
export function StateCard({ kind = "empty", icon, title, body, action }: StateCardProps) {
  const isError = kind === "error";
  const glyphColor = isError ? "var(--ds-danger)" : "var(--ds-muted)";
  const glyphBg = isError ? "var(--ds-danger-dim)" : "var(--ds-surface-2)";
  const glyphBorder = isError ? "var(--ds-danger-line)" : "var(--ds-border)";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        textAlign: "center",
        gap: 12,
        padding: "32px 24px",
        background: "var(--ds-surface)",
        border: `1px solid ${isError ? "var(--ds-danger-line)" : "var(--ds-border)"}`,
        borderRadius: "var(--ds-r-card)",
        boxShadow: "var(--ds-shadow-card)",
      }}
    >
      <div
        style={{
          width: 44,
          height: 44,
          borderRadius: "var(--ds-r-control)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 20,
          color: glyphColor,
          background: glyphBg,
          border: `1px solid ${glyphBorder}`,
        }}
      >
        {kind === "loading" ? <Spinner size={22} /> : icon ?? (isError ? "!" : "○")}
      </div>
      <div style={{ fontSize: "var(--ds-fs-section)", fontWeight: 600, color: "var(--ds-fg)" }}>{title}</div>
      {body != null && (
        <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)", maxWidth: 320, lineHeight: 1.55 }}>
          {body}
        </div>
      )}
      {action != null && <div style={{ marginTop: 4 }}>{action}</div>}
    </div>
  );
}

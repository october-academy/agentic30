import React from "react";

export interface OptionCardProps {
  /** Choice title (fg, bold). */
  title: React.ReactNode;
  /** Muted description under the title. */
  description?: React.ReactNode;
  /** Selected state → accent border + accent-dim fill + filled dot. */
  selected?: boolean;
  /** Selection glyph shape: radio dot (single) or check (multiple). Default single. */
  selectionStyle?: "single" | "multiple";
  onClick?: () => void;
}

/** Selectable choice card — IntakeV2OptionCard / office-hours option row. */
export function OptionCard({ title, description, selected, selectionStyle = "single", onClick }: OptionCardProps) {
  return (
    <div
      onClick={onClick}
      role="button"
      aria-pressed={selected}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "13px 14px",
        borderRadius: "var(--ds-r-control)",
        background: selected ? "var(--ds-accent-dim)" : "var(--ds-card-fill)",
        border: `1px solid ${selected ? "var(--ds-accent-line)" : "var(--ds-card-stroke)"}`,
        cursor: onClick ? "pointer" : "default",
        transition:
          "background var(--ds-dur-fast) var(--ds-ease-snap), border-color var(--ds-dur-fast) var(--ds-ease-snap)",
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          width: 18,
          height: 18,
          marginTop: 1,
          borderRadius: selectionStyle === "single" ? "var(--ds-r-pill)" : 6,
          border: `1.5px solid ${selected ? "var(--ds-accent)" : "var(--ds-selection-dot-empty)"}`,
          background: selected ? "var(--ds-accent)" : "transparent",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          color: "var(--ds-accent-ink)",
          fontSize: 11,
          fontWeight: 700,
        }}
      >
        {selected && (selectionStyle === "multiple" ? "✓" : <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent-ink)" }} />)}
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: "var(--ds-fs-listname)", fontWeight: 600, color: "var(--ds-fg)" }}>{title}</div>
        {description != null && (
          <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)", marginTop: 4, lineHeight: 1.5 }}>
            {description}
          </div>
        )}
      </div>
    </div>
  );
}

import React from "react";

export interface InputProps {
  value?: string;
  placeholder?: string;
  /** Border emphasis. accent = focused/active, warning = needs attention. */
  tone?: "default" | "accent" | "warning";
  /** Leading glyph (search icon, etc.). */
  icon?: React.ReactNode;
  /** Trailing keyboard hint (e.g. ⌘P) rendered as a mono kbd chip. */
  kbd?: string;
  onChange?: (v: string) => void;
}

const BORDER: Record<NonNullable<InputProps["tone"]>, string> = {
  default: "var(--ds-border)",
  accent: "var(--ds-accent-line)",
  warning: "var(--ds-warning-line)",
};

/** Text field / search box — dark inset, Soft radius. */
export function Input({ value = "", placeholder, tone = "default", icon, kbd, onChange }: InputProps) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 34,
        padding: "0 10px",
        borderRadius: "var(--ds-r-control)",
        background: "var(--ds-surface-2)",
        border: `1px solid ${BORDER[tone]}`,
      }}
    >
      {icon != null && <span style={{ color: "var(--ds-muted)", display: "inline-flex", fontSize: 13 }}>{icon}</span>}
      <input
        value={value}
        placeholder={placeholder}
        onChange={(e) => onChange?.(e.target.value)}
        style={{
          flex: 1,
          minWidth: 0,
          border: "none",
          outline: "none",
          background: "transparent",
          color: "var(--ds-fg)",
          fontFamily: "var(--ds-sans)",
          fontSize: 13,
        }}
      />
      {kbd && (
        <span
          style={{
            fontFamily: "var(--ds-mono)",
            fontSize: 10.5,
            color: "var(--ds-muted)",
            background: "var(--ds-hover)",
            border: "1px solid var(--ds-border)",
            borderRadius: 6,
            padding: "1px 5px",
          }}
        >
          {kbd}
        </span>
      )}
    </div>
  );
}

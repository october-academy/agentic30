import React from "react";

export interface SegmentedProps {
  options: string[];
  value?: string;
  onChange?: (v: string) => void;
}

/** Segmented control — pill container, one active segment (OpenDesignSettingsSegmented). */
export function Segmented({ options, value, onChange }: SegmentedProps) {
  const active = value ?? options[0];
  return (
    <div
      style={{
        display: "inline-flex",
        padding: 3,
        gap: 2,
        borderRadius: "var(--ds-r-pill)",
        background: "var(--ds-surface-2)",
        border: "1px solid var(--ds-border)",
      }}
    >
      {options.map((opt) => {
        const on = opt === active;
        return (
          <button
            key={opt}
            type="button"
            onClick={() => onChange?.(opt)}
            style={{
              border: "none",
              cursor: "pointer",
              padding: "5px 12px",
              borderRadius: "var(--ds-r-pill)",
              fontFamily: "var(--ds-sans)",
              fontSize: 12,
              fontWeight: on ? 600 : 500,
              color: on ? "var(--ds-fg)" : "var(--ds-muted)",
              background: on ? "var(--ds-elevated)" : "transparent",
              transition: "all var(--ds-dur-fast) var(--ds-ease-snap)",
            }}
          >
            {opt}
          </button>
        );
      })}
    </div>
  );
}

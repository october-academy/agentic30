import React from "react";

export interface ToggleProps {
  checked?: boolean;
  disabled?: boolean;
  onChange?: (v: boolean) => void;
}

/** Switch toggle — pill track + knob (OpenDesignSettingsToggle). On = green. */
export function Toggle({ checked = false, disabled, onChange }: ToggleProps) {
  return (
    <button
      type="button"
      role="switch"
      aria-checked={checked}
      disabled={disabled}
      onClick={() => onChange?.(!checked)}
      style={{
        width: 38,
        height: 22,
        flex: "0 0 auto",
        borderRadius: "var(--ds-r-pill)",
        border: "none",
        padding: 2,
        cursor: disabled ? "not-allowed" : "pointer",
        background: checked ? "var(--ds-accent)" : "var(--ds-selected)",
        opacity: disabled ? 0.5 : 1,
        transition: "background var(--ds-dur-normal) var(--ds-ease-snap)",
        display: "flex",
        justifyContent: checked ? "flex-end" : "flex-start",
        alignItems: "center",
      }}
    >
      <span
        style={{
          width: 18,
          height: 18,
          borderRadius: "var(--ds-r-pill)",
          background: checked ? "var(--ds-accent-ink)" : "#fff",
          boxShadow: "0 1px 2px rgba(0,0,0,0.4)",
          transition: "all var(--ds-dur-normal) var(--ds-ease-snap)",
        }}
      />
    </button>
  );
}

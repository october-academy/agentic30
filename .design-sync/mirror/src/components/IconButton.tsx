import React from "react";

export interface IconButtonProps {
  icon: React.ReactNode;
  "aria-label"?: string;
  active?: boolean;
  size?: number;
  onClick?: () => void;
}

/** Square icon button — titlebar/toolbar actions (search, refresh, sidebar toggle). */
export function IconButton({ icon, active, size = 28, onClick, ...rest }: IconButtonProps) {
  return (
    <button
      type="button"
      aria-label={rest["aria-label"]}
      onClick={onClick}
      style={{
        width: size,
        height: size,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--ds-r-control)",
        cursor: "pointer",
        fontSize: Math.round(size * 0.5),
        color: active ? "var(--ds-accent)" : "var(--ds-fg-secondary)",
        background: active ? "var(--ds-accent-dim)" : "transparent",
        border: active ? "1px solid var(--ds-accent-line)" : "1px solid transparent",
        transition: "background var(--ds-dur-fast) var(--ds-ease-snap), color var(--ds-dur-fast) var(--ds-ease-snap)",
      }}
    >
      {icon}
    </button>
  );
}

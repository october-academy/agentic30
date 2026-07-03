import React from "react";

export type ButtonVariant = "primary" | "white" | "ghost" | "secondary" | "amber";
export type ButtonSize = "sm" | "md";

export interface ButtonProps {
  /** Button label. Name the action ("결제 요청 보내기") — never "확인". */
  children: React.ReactNode;
  /** primary = the single green CTA · white = Intake/onboarding solid CTA · ghost = bordered · secondary = subtle fill · amber = severity/defer. */
  variant?: ButtonVariant;
  size?: ButtonSize;
  /** Leading glyph/icon slot (an SF-symbol-like character or small node). */
  icon?: React.ReactNode;
  fullWidth?: boolean;
  disabled?: boolean;
  onClick?: () => void;
}

const PAD: Record<ButtonSize, string> = { sm: "7px 12px", md: "11px 16px" };
const FONT: Record<ButtonSize, number> = { sm: 12, md: 13 };

function fill(variant: ButtonVariant): React.CSSProperties {
  switch (variant) {
    case "primary":
      return { background: "var(--ds-accent)", color: "var(--ds-accent-ink)", border: "1px solid transparent" };
    case "white":
      return { background: "var(--ds-btn-primary-fill)", color: "var(--ds-btn-primary-text)", border: "1px solid transparent" };
    case "secondary":
      return { background: "var(--ds-btn-secondary-fill)", color: "var(--ds-btn-secondary-text)", border: "1px solid var(--ds-border)" };
    case "amber":
      return { background: "transparent", color: "var(--ds-warning)", border: "1px solid var(--ds-warning-line)" };
    case "ghost":
    default:
      return { background: "transparent", color: "var(--ds-fg-secondary)", border: "1px solid var(--ds-border)" };
  }
}

export function Button({
  children,
  variant = "primary",
  size = "md",
  icon,
  fullWidth,
  disabled,
  onClick,
}: ButtonProps) {
  const style: React.CSSProperties = {
    display: "inline-flex",
    alignItems: "center",
    justifyContent: "center",
    gap: 6,
    borderRadius: "var(--ds-r-control)",
    fontFamily: "var(--ds-sans)",
    fontSize: FONT[size],
    fontWeight: 600,
    padding: PAD[size],
    width: fullWidth ? "100%" : undefined,
    cursor: disabled ? "not-allowed" : "pointer",
    whiteSpace: "nowrap",
    transition: "background var(--ds-dur-fast) var(--ds-ease-snap), border-color var(--ds-dur-fast) var(--ds-ease-snap), filter var(--ds-dur-fast) var(--ds-ease-snap)",
    ...fill(variant),
    ...(disabled
      ? { background: "var(--ds-btn-disabled-fill)", color: "var(--ds-btn-disabled-text)", border: "1px solid transparent" }
      : null),
  };
  return (
    <button type="button" className="fok-btn" style={style} disabled={disabled} onClick={onClick}>
      {icon != null && <span style={{ display: "inline-flex", fontSize: FONT[size] + 1 }}>{icon}</span>}
      {children}
    </button>
  );
}

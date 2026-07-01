import type { ButtonHTMLAttributes, ReactNode } from "react";

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  /** Visual role. `primary` is the single green CTA — one primary per screen. */
  variant?: "primary" | "ghost" | "amber";
  /** Stretch to the container width (used for card-bottom CTAs). */
  fullWidth?: boolean;
  children?: ReactNode;
}

/**
 * The action button. `primary` is the one green call-to-action; `ghost` is the
 * neutral secondary; `amber` is the severity-tinted "defer / softer" action.
 * Button copy should name the action ("약속하고 닫기"), never "확인".
 */
export function Button({ variant = "primary", fullWidth, className, children, ...rest }: ButtonProps) {
  const cls = [
    "ds-btn",
    `ds-btn--${variant}`,
    fullWidth ? "ds-btn--full" : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  return (
    <button className={cls} {...rest}>{children}</button>
  );
}

import type { InputHTMLAttributes } from "react";

export interface InputProps extends InputHTMLAttributes<HTMLInputElement> {
  /**
   * Border emphasis. `default` is greyscale; `accent` (green line) marks an
   * optional/forward field; `warning` (amber line) marks a defer-reason field.
   */
  tone?: "default" | "accent" | "warning";
}

/**
 * The text input. Dark page fill, soft border, one of three tones. Pair with a
 * `SectionHeader` or inline label — the input itself carries no visible label.
 */
export function Input({ tone = "default", className, ...rest }: InputProps) {
  const cls = [
    "ds-input",
    tone !== "default" ? `ds-input--${tone}` : "",
    className ?? "",
  ].filter(Boolean).join(" ");
  return <input className={cls} {...rest} />;
}

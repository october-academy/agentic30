import type { ReactNode } from "react";

export interface BadgeProps {
  /**
   * Tone. `accent` (green) marks the live/current thing; `neutral` is greyscale;
   * `danger`/`warning` are severity only — never decoration.
   */
  tone?: "accent" | "neutral" | "danger" | "warning";
  /** Optional leading icon (e.g. a clock for a deferral counter). */
  icon?: ReactNode;
  children?: ReactNode;
}

/**
 * A small pill label — Day numbers, evidence counters, "추천" tags, status chips.
 * Mono type, pill radius. Color carries meaning, so reach for `neutral` by default.
 */
export function Badge({ tone = "neutral", icon, children }: BadgeProps) {
  return (
    <span className={`ds-badge ds-badge--${tone}`}>
      {icon}
      {children}
    </span>
  );
}

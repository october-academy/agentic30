import type { ReactNode } from "react";

export interface CardProps {
  /** Small uppercase mono kicker above the title, e.g. "목표 · 오피스아워". */
  eyebrow?: string;
  /** The card headline (one primary message per card). */
  title: string;
  /** Body copy / supporting paragraph. */
  children?: ReactNode;
  /** Action row, typically one primary `Button` plus a ghost one. */
  actions?: ReactNode;
}

/**
 * The canvas content card — an eyebrow, a headline, a paragraph, and an action
 * row. The main column's primary surface; everything lives in a card.
 */
export function Card({ eyebrow, title, children, actions }: CardProps) {
  return (
    <div className="ds-card">
      {eyebrow ? <div className="ds-card__eyebrow">{eyebrow}</div> : null}
      <div className="ds-card__title">{title}</div>
      {children ? <div className="ds-card__body">{children}</div> : null}
      {actions ? <div className="ds-card__actions">{actions}</div> : null}
    </div>
  );
}

import { ClipboardCheckIcon, CircleAlertIcon, RefreshIcon, PlusIcon } from "../icons";

export interface StateCardProps {
  /** `empty` (neutral) or `error` (danger-tinted icon). */
  variant?: "empty" | "error";
  /** The human explanation of the state. */
  title: string;
  /** Mono technical detail, e.g. "suggestedActions: []" or "timeout". */
  meta?: string;
  /** CTA label; renders a green text action with a sensible icon. */
  ctaLabel?: string;
  onCta?: () => void;
}

/**
 * The empty / error state for a data surface. Every data surface ships a real
 * empty and error state, not just the full one. `empty` offers a forward action
 * ("직접 행동 적기"); `error` offers a retry.
 */
export function StateCard({ variant = "empty", title, meta, ctaLabel, onCta }: StateCardProps) {
  const isError = variant === "error";
  return (
    <div className={`ds-statecard${isError ? " ds-statecard--error" : ""}`}>
      <div className="ds-statecard__icon">
        {isError ? <CircleAlertIcon /> : <ClipboardCheckIcon />}
      </div>
      <div className="ds-statecard__title">{title}</div>
      {meta ? <div className="ds-statecard__meta">{meta}</div> : null}
      {ctaLabel ? (
        <button className="ds-statecard__cta" onClick={onCta}>
          {isError ? <RefreshIcon /> : <PlusIcon />}
          {ctaLabel}
        </button>
      ) : null}
    </div>
  );
}

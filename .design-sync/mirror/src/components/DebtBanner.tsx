import type { ReactNode } from "react";
import { AlertIcon } from "../icons";

export interface DebtBannerProps {
  /** The unmet prior promise. Bold the quoted promise with `<b>`, e.g.
   *  `<>어제 약속: <b>"조은성에게 DM으로 가격 물어보기"</b></>`. */
  title: ReactNode;
  /** Mono severity meta, e.g. "증거 0 · 2일째 미룸". */
  meta: string;
  /** "포기로 기록" affordance. */
  onAbandon?: () => void;
}

/**
 * The evidence-debt banner — a danger-severity strip surfaced when a prior
 * promise was never proven. It rides above the commit zone and persists even in
 * defer mode. The only severity-colored element in an otherwise greyscale card.
 */
export function DebtBanner({ title, meta, onAbandon }: DebtBannerProps) {
  return (
    <div className="ds-debt">
      <span className="ds-debt__icon"><AlertIcon /></span>
      <div className="ds-debt__body">
        <div className="ds-debt__title">{title}</div>
        <div className="ds-debt__meta">{meta}</div>
      </div>
      {onAbandon ? <button className="ds-debt__abandon" onClick={onAbandon}>포기로 기록</button> : null}
    </div>
  );
}

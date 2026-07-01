import type { ReactNode } from "react";
import { CheckIcon } from "../icons";

export interface DayRowProps {
  /** Day number shown in the mark, e.g. 7. */
  day: number;
  /** The day's one-line goal, e.g. "Go/No-Go 결정하기". */
  goal: string;
  /** Sub line, e.g. "오늘 · 진행 중" or "미완". */
  sub?: string;
  /**
   * State. `today` is accent-highlighted and pinned to the top; `done` shows a
   * check; `incomplete` is neutral grey (an OK-but-unfinished day, not an alert).
   */
  state?: "today" | "done" | "incomplete";
  /** Right badge — a progress count like "2/5", or omit to show a check on `done`. */
  badge?: ReactNode;
}

/**
 * One row in the Day timeline. Past done days collapse to a check; the current
 * day is the single accent row; incomplete days stay greyscale. Compose several
 * inside `DayTimelineSidebar`.
 */
export function DayRow({ day, goal, sub, state, badge }: DayRowProps) {
  const cls = ["ds-dayrow", state ? `ds-dayrow--${state}` : ""].filter(Boolean).join(" ");
  const badgeContent = badge ?? (state === "done" ? <CheckIcon /> : null);
  return (
    <div className={cls}>
      <div className="ds-dayrow__mark">{day}</div>
      <div className="ds-dayrow__body">
        <div className="ds-dayrow__goal">{goal}</div>
        {sub ? <div className="ds-dayrow__sub">{sub}</div> : null}
      </div>
      {badgeContent ? <div className="ds-dayrow__badge">{badgeContent}</div> : null}
    </div>
  );
}

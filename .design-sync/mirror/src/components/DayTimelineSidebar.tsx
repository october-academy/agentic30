import { Fragment } from "react";
import { Badge } from "./Badge";
import { DayRow, type DayRowProps } from "./DayRow";
import { StateCard } from "./StateCard";
import { DotsIcon } from "../icons";

export interface DayTimelineSidebarProps {
  /** Project name shown in the header, e.g. "agentic30". */
  project: string;
  /** Current day label, e.g. "Day 7". */
  day: string;
  /** Progress text, e.g. "2/5". */
  progress?: string;
  /** Phase group title, defaults to "Foundation". */
  group?: string;
  /** Ordered day rows — today first, then past (done/incomplete). Future is hidden. */
  days?: DayRowProps[];
  /** Optional collapsed "Day 3–5 · 건너뜀" chip inserted between rows. */
  skipLabel?: string;
  /** Render an empty or error state instead of rows. */
  state?: "empty" | "error";
}

/**
 * The Day-timeline sidebar — a header (project · Day pill · progress), a phase
 * group, and the day rows (today accent-pinned on top, past days read-only,
 * future hidden). Falls back to an empty/error `StateCard`. Composes Badge,
 * DayRow, and StateCard.
 */
export function DayTimelineSidebar({
  project,
  day,
  progress,
  group = "Foundation",
  days = [],
  skipLabel,
  state,
}: DayTimelineSidebarProps) {
  return (
    <div className="ds-sidebar">
      <div className="ds-sidebar__header">
        <span className="ds-sidebar__proj">{project}</span>
        <Badge tone="accent">{day}</Badge>
        {progress ? <span className="ds-sidebar__prog">{progress}</span> : null}
      </div>
      <div className="ds-sidebar__scroll">
        <div className="ds-sidebar__group">{group}</div>
        {state === "empty" ? (
          <StateCard variant="empty" title="아직 Day가 없습니다. 첫 목표를 정하면 타임라인이 시작됩니다." ctaLabel="Day 1 시작하기" />
        ) : state === "error" ? (
          <StateCard variant="error" title="Day 타임라인을 불러오지 못했습니다." meta="로컬 세션 저장소 연결 끊김" ctaLabel="다시 시도" />
        ) : (
          days.map((d, i) => (
            <Fragment key={i}>
              <DayRow {...d} />
              {skipLabel && i === 0 ? (
                <div className="ds-sidebar__skip">
                  <div className="ds-sidebar__skip-dots"><DotsIcon /></div>
                  <div className="ds-sidebar__skip-label">{skipLabel}</div>
                </div>
              ) : null}
            </Fragment>
          ))
        )}
      </div>
    </div>
  );
}

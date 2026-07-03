import React from "react";

export interface DashPaginationProps {
  /** Current step, 1-based. */
  current: number;
  /** Total number of steps. */
  total: number;
}

/** Step-indicator dashes — IntakeV2DashPagination. Active dash accent, rest muted. */
export function DashPagination({ current, total }: DashPaginationProps) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 6 }} role="progressbar" aria-valuenow={current} aria-valuemax={total}>
      {Array.from({ length: Math.max(0, total) }, (_, i) => {
        const isActive = i === current - 1;
        const isPast = i < current - 1;
        return (
          <span
            key={i}
            style={{
              height: 3,
              width: isActive ? 20 : 8,
              borderRadius: "var(--ds-r-pill)",
              background: isActive ? "var(--ds-accent)" : isPast ? "var(--ds-accent-line)" : "var(--ds-border-strong)",
              transition: "width var(--ds-dur-normal) var(--ds-ease-snap), background var(--ds-dur-normal) var(--ds-ease-snap)",
            }}
          />
        );
      })}
    </div>
  );
}

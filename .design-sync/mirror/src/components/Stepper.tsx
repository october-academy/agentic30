import React from "react";

export type StepState = "done" | "active" | "pending" | "locked";

export interface StepperStep {
  /** Step label. */
  label: string;
  /** Progress state — done→accent fill, active→accent ring, pending→muted, locked→faint. */
  state: StepState;
}

export interface StepperProps {
  /** Ordered steps. */
  steps: StepperStep[];
  /** Layout axis. Default horizontal. */
  orientation?: "horizontal" | "vertical";
}

interface NodeStyle {
  bg: string;
  border: string;
  color: string;
  label: string;
  connector: string;
}

function nodeStyle(state: StepState): NodeStyle {
  switch (state) {
    case "done":
      return { bg: "var(--ds-accent)", border: "var(--ds-accent)", color: "var(--ds-accent-ink)", label: "var(--ds-fg)", connector: "var(--ds-accent-line)" };
    case "active":
      return { bg: "var(--ds-accent-dim)", border: "var(--ds-accent)", color: "var(--ds-accent)", label: "var(--ds-fg)", connector: "var(--ds-border)" };
    case "pending":
      return { bg: "var(--ds-surface-2)", border: "var(--ds-border-strong)", color: "var(--ds-muted)", label: "var(--ds-muted)", connector: "var(--ds-border)" };
    case "locked":
    default:
      return { bg: "var(--ds-surface-2)", border: "var(--ds-border)", color: "var(--ds-muted-deep)", label: "var(--ds-muted-deep)", connector: "var(--ds-border-soft)" };
  }
}

/** Numbered vertical or horizontal step tracker. */
export function Stepper({ steps, orientation = "horizontal" }: StepperProps) {
  const horizontal = orientation === "horizontal";
  return (
    <div
      style={{
        display: "flex",
        flexDirection: horizontal ? "row" : "column",
        alignItems: horizontal ? "center" : "stretch",
      }}
    >
      {steps.map((step, i) => {
        const s = nodeStyle(step.state);
        const last = i === steps.length - 1;
        const node = (
          <div
            style={{
              width: 22,
              height: 22,
              flex: "0 0 auto",
              borderRadius: "var(--ds-r-pill)",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              fontFamily: "var(--ds-mono)",
              fontSize: 11,
              fontWeight: 600,
              background: s.bg,
              border: `1.5px solid ${s.border}`,
              color: s.color,
            }}
          >
            {step.state === "done" ? "✓" : step.state === "locked" ? "🔒" : i + 1}
          </div>
        );
        if (horizontal) {
          return (
            <React.Fragment key={i}>
              <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
                {node}
                <span style={{ fontSize: "var(--ds-fs-body)", fontWeight: 500, color: s.label, whiteSpace: "nowrap" }}>
                  {step.label}
                </span>
              </div>
              {!last && <span style={{ flex: "1 1 20px", height: 1.5, minWidth: 18, margin: "0 10px", background: s.connector }} />}
            </React.Fragment>
          );
        }
        return (
          <div key={i} style={{ display: "flex", gap: 11 }}>
            <div style={{ display: "flex", flexDirection: "column", alignItems: "center" }}>
              {node}
              {!last && <span style={{ flex: "1 1 auto", width: 1.5, minHeight: 18, marginTop: 4, background: s.connector }} />}
            </div>
            <span style={{ fontSize: "var(--ds-fs-body)", fontWeight: 500, color: s.label, paddingTop: 3, paddingBottom: 14 }}>
              {step.label}
            </span>
          </div>
        );
      })}
    </div>
  );
}

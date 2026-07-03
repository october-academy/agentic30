import React from "react";

export interface SpinnerProps {
  size?: number;
  /** Arc color. Defaults to the bright accent (IntakeV2 spinner). */
  color?: string;
  trackColor?: string;
}

/** Circular arc spinner — mirrors IntakeV2ActivitySpinner (Snap, no bounce). */
export function Spinner({ size = 16, color = "var(--ds-accent-bright)", trackColor = "var(--ds-spinner-track)" }: SpinnerProps) {
  const sw = Math.max(2, size / 8);
  const r = (size - sw) / 2;
  const c = size / 2;
  const circ = 2 * Math.PI * r;
  return (
    <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} role="img" aria-label="Loading">
      <circle cx={c} cy={c} r={r} fill="none" stroke={trackColor} strokeWidth={sw} />
      <circle
        cx={c}
        cy={c}
        r={r}
        fill="none"
        stroke={color}
        strokeWidth={sw}
        strokeLinecap="round"
        strokeDasharray={`${circ * 0.62} ${circ}`}
        transform={`rotate(-90 ${c} ${c})`}
      >
        <animateTransform attributeName="transform" type="rotate" from={`0 ${c} ${c}`} to={`360 ${c} ${c}`} dur="0.82s" repeatCount="indefinite" />
      </circle>
    </svg>
  );
}

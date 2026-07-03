import React from "react";
import { Tone, toneVars } from "../tokens";

export interface SparklineProps {
  points: number[];
  tone?: Tone;
  width?: number;
  height?: number;
  /** Fill the area under the line with a faint tint. */
  fill?: boolean;
}

/** Mini trend sparkline (settings CPU, source metrics). */
export function Sparkline({ points, tone = "accent", width = 96, height = 28, fill = true }: SparklineProps) {
  const t = toneVars(tone);
  if (points.length < 2) return <svg width={width} height={height} />;
  const min = Math.min(...points);
  const max = Math.max(...points);
  const span = max - min || 1;
  const step = width / (points.length - 1);
  const coords = points.map((p, i) => [i * step, height - ((p - min) / span) * (height - 4) - 2] as const);
  const line = coords.map(([x, y], i) => `${i === 0 ? "M" : "L"}${x.toFixed(1)},${y.toFixed(1)}`).join(" ");
  const area = `${line} L${width},${height} L0,${height} Z`;
  return (
    <svg width={width} height={height} viewBox={`0 0 ${width} ${height}`}>
      {fill && <path d={area} fill={t.dim} />}
      <path d={line} fill="none" stroke={t.color} strokeWidth={1.5} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

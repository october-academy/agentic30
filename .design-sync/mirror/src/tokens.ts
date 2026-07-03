// Founder OS Kit — shared token helpers.
// Colors resolve to the CSS custom properties defined in ds.css (:root), which
// are the exact Agentic30 dark palette. Tone mirrors OpenDesignReferenceTone.

export type Tone =
  | "accent"
  | "amber"
  | "rose"
  | "sky"
  | "violet"
  | "teal"
  | "pink"
  | "muted";

interface ToneVars {
  color: string;
  dim: string;
  line: string;
}

const TONE_MAP: Record<Tone, ToneVars> = {
  accent: { color: "var(--ds-accent)", dim: "var(--ds-accent-dim)", line: "var(--ds-accent-line)" },
  amber: { color: "var(--ds-warning)", dim: "var(--ds-warning-dim)", line: "var(--ds-warning-line)" },
  rose: { color: "var(--ds-danger)", dim: "var(--ds-danger-dim)", line: "var(--ds-danger-line)" },
  sky: { color: "var(--ds-sky)", dim: "var(--ds-sky-dim)", line: "var(--ds-sky-line)" },
  violet: { color: "var(--ds-tone-violet)", dim: "var(--ds-tone-violet-dim)", line: "var(--ds-tone-violet-line)" },
  teal: { color: "var(--ds-teal)", dim: "var(--ds-teal-dim)", line: "var(--ds-teal-line)" },
  pink: { color: "var(--ds-pink)", dim: "var(--ds-pink-dim)", line: "var(--ds-pink-line)" },
  muted: { color: "var(--ds-muted)", dim: "rgba(124,129,133,0.14)", line: "rgba(124,129,133,0.38)" },
};

/** Resolve a tone to its {color, dim, line} CSS-variable expressions. */
export function toneVars(tone: Tone = "accent"): ToneVars {
  return TONE_MAP[tone] ?? TONE_MAP.accent;
}

export interface SectionHeaderProps {
  /** Uppercase mono label, e.g. "질문 1 — 수요 증거". */
  label: string;
  /** Right-aligned mono meta, e.g. a "1 / 6" counter. */
  meta?: string;
  /** Accent (green) bar + label when this section is the live one. */
  accent?: boolean;
}

/**
 * The thin section divider used across Office Hours and the promise card: a small
 * bar, an uppercase mono label, an optional counter, and a hairline rule that
 * fills the row. Use `accent` for the section the user is currently acting in.
 */
export function SectionHeader({ label, meta, accent }: SectionHeaderProps) {
  return (
    <div className={`ds-sectionhead${accent ? " ds-sectionhead--accent" : ""}`}>
      <span className="ds-sectionhead__bar" />
      <span className="ds-sectionhead__label">{label}</span>
      {meta ? <span className="ds-sectionhead__meta">{meta}</span> : null}
      <span className="ds-sectionhead__line" />
    </div>
  );
}

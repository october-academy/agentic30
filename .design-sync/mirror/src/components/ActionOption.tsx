export interface ActionOptionProps {
  /** The action text, e.g. "조은성에게 DM으로 가격 물어보기". */
  label: string;
  /** Selected (green ring + fill) state. One option selected at a time. */
  selected?: boolean;
  /** Show the "추천" tag — the system's suggested choice. */
  recommended?: boolean;
  onClick?: () => void;
}

/**
 * A single selectable action row — the shared Office Hours / promise-card option
 * idiom: a radio dot, the action text, and an optional "추천" tag. Stack several
 * inside an `.ds-promise__acts` column.
 */
export function ActionOption({ label, selected, recommended, onClick }: ActionOptionProps) {
  return (
    <div className={`ds-actopt${selected ? " ds-actopt--sel" : ""}`} onClick={onClick}>
      <span className="ds-actopt__radio" />
      <span className="ds-actopt__label">{label}</span>
      {recommended ? <span className="ds-actopt__rec">추천</span> : null}
    </div>
  );
}

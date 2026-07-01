export interface SignalRow {
  /** Uppercase mono key, e.g. "목적", "진행", "출력". */
  key: string;
  /** The value text. */
  value: string;
}

export interface SignalTableProps {
  /** Key/value rows of session context or scanned signals. */
  rows: SignalRow[];
}

/**
 * The session-context / signals table — hairline-separated key/value rows on the
 * surface fill. Keys are fixed-width uppercase mono; values are sans. Used to show
 * the read signals an Office Hours session is reasoning from.
 */
export function SignalTable({ rows }: SignalTableProps) {
  return (
    <div className="ds-signals">
      {rows.map((row, i) => (
        <div key={i} className="ds-signals__row">
          <div className="ds-signals__key">{row.key}</div>
          <div className="ds-signals__value">{row.value}</div>
        </div>
      ))}
    </div>
  );
}

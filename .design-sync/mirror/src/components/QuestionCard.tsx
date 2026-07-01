export interface QuestionCardProps {
  /** The question text — one structured-input question at a time. */
  question: string;
  /** Small uppercase mono eyebrow, defaults to "질문". */
  eyebrow?: string;
  /** 1-based position of this question. */
  index?: number;
  /** Total questions, renders the "i / total" count pill. */
  total?: number;
}

/**
 * The Office Hours question card — a gradient surface with an accent left rail,
 * an eyebrow, an "i / total" count pill, and the question. One open question at a
 * time; pair with stacked `ActionOption`s for the answer.
 */
export function QuestionCard({ question, eyebrow = "질문", index, total }: QuestionCardProps) {
  const count = index && total ? `${index} / ${total}` : undefined;
  return (
    <div className="ds-qcard">
      <div className="ds-qcard__head">
        <span className="ds-qcard__eyebrow">{eyebrow}</span>
        {count ? <span className="ds-qcard__count">{count}</span> : null}
      </div>
      <div className="ds-qcard__text">{question}</div>
    </div>
  );
}

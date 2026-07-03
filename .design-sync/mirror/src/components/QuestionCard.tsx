import React from "react";
import { OptionCard } from "./OptionCard";

export interface QuestionCardProps {
  /** Dimension eyebrow (e.g. "질문 1 · DEMAND · 1 / 6"). Mono, muted. */
  eyebrow?: React.ReactNode;
  /** The question statement (may include an inline highlighted span). */
  question: React.ReactNode;
  /** Option labels rendered as selectable OptionCard rows. */
  options?: string[];
  /** Index of the currently selected option (single-select). */
  selectedIndex?: number;
  /** Fired with the option index when a row is clicked. */
  onSelect?: (index: number) => void;
  /** Muted hint shown under the options (e.g. an example answer). */
  hint?: React.ReactNode;
  /** Show a free-form text area under the options. */
  freeform?: boolean;
  /** Placeholder for the free-form area. */
  freeformPlaceholder?: string;
  /** Submitted state — accent left marker persists, dims interactivity. */
  submitted?: boolean;
}

/** Office-hours interview step — the question card + option cards. */
export function QuestionCard({
  eyebrow,
  question,
  options,
  selectedIndex,
  onSelect,
  hint,
  freeform,
  freeformPlaceholder = "예: 3명이 매주 같은 수작업을 하고 있어요.",
  submitted,
}: QuestionCardProps) {
  return (
    <div
      style={{
        position: "relative",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-r-card)",
        boxShadow: "var(--ds-shadow-card)",
        overflow: "hidden",
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--ds-accent)" }} />
      <div style={{ padding: 18, paddingLeft: 20 }}>
        {eyebrow != null && (
          <div className="ds-eyebrow" style={{ marginBottom: 10 }}>
            {eyebrow}
          </div>
        )}
        <div
          style={{
            fontSize: "var(--ds-fs-section)",
            fontWeight: 600,
            color: "var(--ds-fg)",
            lineHeight: 1.55,
            opacity: submitted ? 0.7 : 1,
          }}
        >
          {question}
        </div>

        {options != null && options.length > 0 && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 14 }}>
            {options.map((opt, i) => (
              <OptionCard
                key={i}
                title={opt}
                selected={selectedIndex === i}
                selectionStyle="single"
                onClick={submitted ? undefined : () => onSelect?.(i)}
              />
            ))}
          </div>
        )}

        {hint != null && (
          <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)", marginTop: 12, lineHeight: 1.5 }}>
            {hint}
          </div>
        )}

        {freeform && (
          <div
            style={{
              marginTop: 12,
              background: "var(--ds-surface-2)",
              border: "1px solid var(--ds-border)",
              borderRadius: "var(--ds-r-control)",
              padding: "11px 12px",
              fontSize: "var(--ds-fs-body)",
              color: "var(--ds-muted)",
              minHeight: 44,
            }}
          >
            {freeformPlaceholder}
          </div>
        )}
      </div>
    </div>
  );
}

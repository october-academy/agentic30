import { CheckIcon } from "../icons";

export interface StepperStep {
  /** Step name shown under the node, e.g. "목표". */
  name: string;
  /** `done` shows a check; `active` is the filled green node; `locked` is greyed. */
  status?: "done" | "active" | "locked";
}

export interface StepperProps {
  /** Ordered macro stages, e.g. scan · 회고 · 목표 · 인터뷰 · 실행. */
  steps: StepperStep[];
}

/**
 * The horizontal stage stepper for the Day loop. Done steps connect with an
 * accent line and show a check; the active step is the single filled node;
 * locked steps stay neutral. One active step at a time.
 */
export function Stepper({ steps }: StepperProps) {
  return (
    <div className="ds-stepper">
      {steps.map((step, i) => {
        const status = step.status ?? "locked";
        return (
          <div key={i} className={`ds-step ds-step--${status}`}>
            <div className="ds-step__line" />
            <div className="ds-step__node">
              {status === "done" ? <CheckIcon /> : i + 1}
            </div>
            <div className="ds-step__name">{step.name}</div>
          </div>
        );
      })}
    </div>
  );
}

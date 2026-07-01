import type { ReactNode } from "react";
import { CheckIcon } from "../icons";
import { Badge } from "./Badge";
import { ActionOption } from "./ActionOption";
import { DebtBanner } from "./DebtBanner";
import { Button } from "./Button";

export interface PromiseOption {
  /** Action text. */
  label: string;
  /** Pre-selected (one at a time). */
  selected?: boolean;
  /** "추천" tag. */
  recommended?: boolean;
}

export interface PromiseCardProps {
  /** Card prompt, e.g. "다음 한 가지 고객 행동을 약속해줘." */
  title: string;
  /** 3 suggested actions (+ the user can type their own). */
  options: PromiseOption[];
  /** Optional evidence-debt banner for a prior unproven promise. */
  debt?: { title: ReactNode; meta: string };
  /** Disable the commit CTA (e.g. while a debt is open and nothing is chosen). */
  commitDisabled?: boolean;
  /** Footnote under the actions. */
  note?: ReactNode;
}

/**
 * The interview's final-step commitment card — an eyebrow + "약속" badge, an
 * optional debt banner, a column of `ActionOption`s, and the green commit CTA.
 * The card composes Badge, DebtBanner, ActionOption, and Button.
 */
export function PromiseCard({ title, options, debt, commitDisabled, note }: PromiseCardProps) {
  return (
    <div className="ds-promise">
      <div className="ds-promise__head">
        <span className="ds-promise__eyebrow">마지막 단계</span>
        <span style={{ marginLeft: "auto" }}>
          <Badge tone="neutral" icon={<CheckIcon />}>약속</Badge>
        </span>
      </div>
      {debt ? (
        <div className="ds-promise__debt-wrap">
          <DebtBanner title={debt.title} meta={debt.meta} onAbandon={() => {}} />
        </div>
      ) : null}
      <div className="ds-promise__title">{title}</div>
      <div className="ds-promise__acts">
        {options.map((opt, i) => (
          <ActionOption key={i} label={opt.label} selected={opt.selected} recommended={opt.recommended} />
        ))}
      </div>
      <Button variant="primary" fullWidth disabled={commitDisabled} style={{ marginTop: 13 }}>
        약속하고 닫기
      </Button>
      {note ? <div className="ds-promise__note">{note}</div> : null}
    </div>
  );
}

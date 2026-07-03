import { HistoryReferencePage } from "founder-os-kit";

// FULL-SCREEN preview — this component composes the entire History / Retrospective
// (히스토리) window: rail + 주간 합계 sidebar + titlebar + 회고 판단 카드 / 접힌 Evidence
// 타임라인 / 주간 배너 main + 근거 커버리지 meta. Faithful mirror of the OpenDesignHistory*
// view hierarchy in OpenDesignReferencePages.swift. Takes only an optional `height`.
// Frame it at a realistic window size so the shell reads at full fidelity.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  width: 1360,
  fontFamily: "var(--ds-sans)",
};

// The History reference page at its default framed height.
export const FullPage = () => (
  <div style={canvas}>
    <HistoryReferencePage height={900} />
  </div>
);

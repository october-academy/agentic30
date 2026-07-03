// FULL-SCREEN preview — StrategyScreen composes the entire Strategy (Business
// Canvas) window (rail + titlebar + main). It is a faithful mirror of
// Strategy_Screen.png + Strategy_Matrix_Initial_Visual_QA.png: a WHY HERE
// positioning banner, a 2×2 SWOT grid, a 전략 판단 verdict, a business-model
// canvas strip, and a 2×2 competitive positioning matrix with a SELECTED
// POSITION side panel. It takes only an optional `height`.
//
// StrategyScreen is not exported from the founder-os-kit package barrel (the
// index.ts is out of scope for this task), so it is imported from source.
import { StrategyScreen } from "../mirror/src/components/screens/StrategyScreen";

// Frame it at a realistic window size so the shell reads at full fidelity.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  width: 1360,
  fontFamily: "var(--ds-sans)",
};

// The full Strategy window at its default framed height.
export const FullPage = () => (
  <div style={canvas}>
    <StrategyScreen height={900} />
  </div>
);

import { DayWorkspaceScreen } from "founder-os-kit";

// FULL-SCREEN preview — this component composes the entire Day workspace window
// (rail + task sidebar + titlebar + today main + meta) and is a faithful mirror
// of OpenDesign_Day_Initial_Wide.png: an Office Hours · Day 1 turn open on the
// "목표 확립" stage with the goal-selection card. It takes only an optional
// `height`. Frame it at a realistic window size so the shell reads full-fidelity.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  width: 1360,
  fontFamily: "var(--ds-sans)",
};

// The Day workspace at its default framed height.
export const FullPage = () => (
  <div style={canvas}>
    <DayWorkspaceScreen height={900} />
  </div>
);

// FULL-SCREEN preview — composes the entire Office Hours interview window
// (rail + narrow Day-1 session sidebar + titlebar + main turn, no meta) and is
// a faithful mirror of Office_Hours_SwiftUI_Q1_Active.png. It takes only an
// optional `height`. Framed at a realistic window size so the shell reads at
// full fidelity.
//
// This screen is a new composition not yet exported from the founder-os-kit
// barrel, so it is imported directly from source.
import { OfficeHoursScreen } from "../mirror/src/components/screens/OfficeHoursScreen";

const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  width: 1360,
  fontFamily: "var(--ds-sans)",
};

export const FullPage = () => (
  <div style={canvas}>
    <OfficeHoursScreen height={900} />
  </div>
);

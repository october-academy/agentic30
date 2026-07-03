import { ProjectsReferencePage } from "founder-os-kit";

// FULL-SCREEN preview — this component composes the entire Projects window
// (rail + sidebar + titlebar + main + meta) and is a faithful mirror of
// OpenDesign_Projects_Wide.png. It takes only an optional `height`.
// Frame it at a realistic window size so the shell reads at full fidelity.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  width: 1360,
  fontFamily: "var(--ds-sans)",
};

// The canonical reference page at its default framed height.
export const FullPage = () => (
  <div style={canvas}>
    <ProjectsReferencePage height={900} />
  </div>
);

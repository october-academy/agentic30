import { FilterTabs } from "founder-os-kit";

const canvas = {
  background: "var(--ds-page)",
  padding: 24,
  width: 640,
  fontFamily: "var(--ds-sans)",
};

// News screen severity lanes — 전체 active (the default landing tab).
export const SeverityLanes = () => (
  <div style={canvas}>
    <FilterTabs tabs={["전체", "High", "Medium", "Low", "Unknown"]} value="전체" />
  </div>
);

// Same tabs with "High" selected — shows the underline moving to a severity lane.
export const HighSelected = () => (
  <div style={canvas}>
    <FilterTabs tabs={["전체", "High", "Medium", "Low", "Unknown"]} value="High" />
  </div>
);

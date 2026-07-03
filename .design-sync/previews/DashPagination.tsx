import { DashPagination } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 24, alignItems: "center", flexWrap: "wrap" as const };

export const Step2of5 = () => (
  <div style={row}>
    <DashPagination current={2} total={5} />
  </div>
);

export const Steps = () => (
  <div style={{ ...canvas, display: "flex", flexDirection: "column", gap: 16, alignItems: "flex-start" }}>
    <DashPagination current={1} total={5} />
    <DashPagination current={3} total={5} />
    <DashPagination current={5} total={5} />
  </div>
);

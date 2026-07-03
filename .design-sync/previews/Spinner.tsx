import { Spinner } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = {
  ...canvas,
  display: "flex",
  gap: 20,
  alignItems: "center",
  color: "var(--ds-fg-secondary)",
  fontSize: 13,
};

export const Sizes = () => (
  <div style={row}>
    <Spinner size={14} />
    <Spinner size={20} />
    <Spinner size={28} />
  </div>
);

export const Inline = () => (
  <div style={row}>
    <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
      <Spinner size={16} />
      워크스페이스 스캔 중…
    </span>
  </div>
);

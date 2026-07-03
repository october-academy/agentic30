import { Segmented } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 16, alignItems: "center", flexWrap: "wrap" as const };

export const Theme = () => (
  <div style={row}>
    <Segmented options={["다크", "라이트", "시스템"]} value="다크" />
  </div>
);

export const CadencePicker = () => (
  <div style={row}>
    <Segmented options={["1x", "2x", "4x"]} value="4x" />
    <Segmented options={["전체", "코드", "문서"]} value="코드" />
  </div>
);

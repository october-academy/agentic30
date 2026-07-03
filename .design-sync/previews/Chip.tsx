import { Chip } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" as const };

export const FilterBar = () => (
  <div style={row}>
    <Chip label="활성" count={3} active />
    <Chip label="보관함" count={2} />
    <Chip label="후보" count={2} />
    <Chip label="템플릿" count={3} />
  </div>
);

export const NewsLanes = () => (
  <div style={row}>
    <Chip label="전체" active />
    <Chip label="경쟁" count={5} tone="sky" />
    <Chip label="수요 신호" count={2} tone="accent" />
    <Chip label="리스크" count={1} tone="rose" />
  </div>
);

export const InactiveVsActive = () => (
  <div style={row}>
    <Chip label="초기 검증" active />
    <Chip label="만들기" />
    <Chip label="공개" />
    <Chip label="성장" />
  </div>
);

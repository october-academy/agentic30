import { Input } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 360, display: "flex", flexDirection: "column" as const, gap: 8 };

export const Tones = () => (
  <div style={canvas}>
    <Input placeholder="고객명 또는 회사" />
    <Input tone="accent" placeholder="이번 약속, 어떻게 될 것 같아? (선택)" />
    <Input tone="warning" placeholder="못 한 이유를 한 줄로 (정직하게)" />
  </div>
);

export const Filled = () => (
  <div style={canvas}>
    <Input defaultValue="조은성에게 DM으로 가격 물어보기" />
  </div>
);

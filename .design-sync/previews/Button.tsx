import { Button } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" as const };

export const Variants = () => (
  <div style={row}>
    <Button variant="primary">오피스아워 시작</Button>
    <Button variant="white">다음</Button>
    <Button variant="ghost">지난 회고 보기</Button>
    <Button variant="secondary">건너뛰기</Button>
    <Button variant="amber">미룸으로 닫기</Button>
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Button variant="primary" size="sm">저장</Button>
    <Button variant="primary" size="md">결제 요청 보내기</Button>
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <Button variant="primary" disabled>제출</Button>
    <Button variant="white" disabled>다음</Button>
  </div>
);

export const FullWidth = () => (
  <div style={{ ...canvas, width: 320 }}>
    <Button variant="primary" fullWidth>오늘 화면 열기</Button>
  </div>
);

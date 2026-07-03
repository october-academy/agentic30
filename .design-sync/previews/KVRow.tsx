import { KVRow, Badge } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const panel = {
  ...canvas,
  maxWidth: 340,
  background: "var(--ds-surface)",
  border: "1px solid var(--ds-border)",
  borderRadius: "var(--ds-r-card)",
  padding: "6px 16px 10px",
};

export const MetaPanel = () => (
  <div style={canvas}>
    <div style={{ ...panel, padding: "6px 16px 10px" }}>
      <KVRow label="활성 프로젝트" value="3개" tone="accent" />
      <KVRow label="진행 phase" value="F2 · B1" />
      <KVRow label="인터뷰" value="5 / 15 게이트" />
      <KVRow label="소스 루트" value="9개 watch" />
      <KVRow label="오늘 호출" value="3 · $0.04" />
      <KVRow label="D-30 목표일" value="2026-06-15" />
    </div>
  </div>
);

export const WithBadgeValues = () => (
  <div style={canvas}>
    <div style={{ ...panel, padding: "6px 16px 10px" }}>
      <KVRow label="상태" value={<Badge tone="accent" mono>최신</Badge>} />
      <KVRow label="안 읽음" value="17" tone="accent" />
      <KVRow label="저장" value="0" tone="muted" />
      <KVRow label="마지막 업데이트" value="5/20 10:00" />
      <KVRow label="일부 가정 실패" value={<Badge tone="amber" mono>문제</Badge>} />
    </div>
  </div>
);

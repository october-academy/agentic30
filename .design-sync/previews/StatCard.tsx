import { StatCard } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const grid = { ...canvas, display: "grid", gridTemplateColumns: "repeat(4, 1fr)", gap: 12, maxWidth: 720 };

export const ProjectTiles = () => (
  <div style={grid}>
    <StatCard label="완료한 DAY" value="0" unit="/ 30" sub="→ Day 1 진행 중" />
    <StatCard label="인터뷰 원문" value="1" unit="/ 5 기준" sub="+ 1 어제" />
    <StatCard label="공개 기록 글" value="0" unit="/ 14 권장" sub="— 미시작" tone="muted" />
    <StatCard label="소스 코드 루트" value="3" unit="watch 활성" sub="+ 2 보조 레포" />
  </div>
);

export const Portfolio = () => (
  <div style={{ ...canvas, display: "flex", gap: 12 }}>
    <StatCard label="30일 진행률" value="14" unit="/ 90 day" sub="3 projects" />
    <StatCard label="평균 완주율" value="62%" sub="2건 기준" tone="sky" />
    <StatCard label="오늘 호출" value="3" unit="· $0.04" sub="정상 · 예산 내" />
  </div>
);

export const Severity = () => (
  <div style={{ ...canvas, display: "flex", gap: 12 }}>
    <StatCard label="증거 부채" value="2" unit="건" sub="→ 결제 캡처 대기" tone="amber" />
    <StatCard label="실패한 스캔" value="1" unit="/ 5" sub="프로바이더 인증 실패" tone="rose" />
  </div>
);

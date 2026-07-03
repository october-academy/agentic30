import { MetaPanel, KVRow, Button, Badge } from "founder-os-kit";

// The meta panel is a full-height 280px column; give it height + page background.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  height: 780,
  fontFamily: "var(--ds-sans)",
  display: "flex",
};

// Small uppercase group label (mirrors the panel's own group headers).
const Group = ({ children }: { children: React.ReactNode }) => (
  <div className="ds-eyebrow" style={{ margin: "18px 0 6px" }}>
    {children}
  </div>
);

// Projects screen "프로젝트 포트폴리오" panel — progress banner, KV rows, quick actions.
export const ProjectPortfolio = () => (
  <div style={canvas}>
    <MetaPanel title="프로젝트 포트폴리오">
      <div
        style={{
          padding: "12px 14px",
          borderRadius: "var(--ds-r-card)",
          background: "var(--ds-surface-2)",
          border: "1px solid var(--ds-border-soft)",
          marginBottom: 4,
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ds-muted)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
          30일 진행률 · 모든 활성
        </div>
        <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 6 }}>
          <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
            <span style={{ fontFamily: "var(--ds-mono)", fontSize: 24, fontWeight: 700, color: "var(--ds-fg)" }}>14</span>
            <span style={{ fontFamily: "var(--ds-mono)", fontSize: 13, color: "var(--ds-muted)" }}>/ 90 day</span>
          </span>
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 13, fontWeight: 700, color: "var(--ds-accent)" }}>
            3 projects
          </span>
        </div>
      </div>

      <Group>활성 프로젝트</Group>
      <KVRow label="활성 프로젝트" value="3개" tone="accent" />
      <KVRow label="진행 phase" value="F2 · B1" />
      <KVRow label="인터뷰" value="5 / 15 게이트" />
      <KVRow label="소스 루트" value="9개 watch" />
      <KVRow label="오늘 호출" value="3 · $0.04" />
      <KVRow label="D-30 목표일" value="2026-06-15" />

      <Group>보관함 요약</Group>
      <KVRow label="qmd-support" value="완주 28/30" />
      <KVRow label="MealMate" value="중단 D9" />
      <KVRow label="평균 완주율" value="62% (2건)" tone="accent" />

      <Group>빠른 액션</Group>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        <Button variant="secondary" fullWidth icon={<span>›</span>}>
          오늘 화면으로
        </Button>
        <Button variant="ghost" fullWidth icon={<span>＋</span>}>
          새 30일 프로젝트
        </Button>
        <Button variant="ghost" fullWidth icon={<span>◨</span>}>
          프로젝트 전환
        </Button>
      </div>
    </MetaPanel>
  </div>
);

// News screen "왜 이 리서치 / RADAR 상태" panel — status KV rows + a warning badge.
export const RadarStatus = () => (
  <div style={canvas}>
    <MetaPanel title="왜 이 리서치">
      <div style={{ fontSize: 13, color: "var(--ds-fg-secondary)", lineHeight: 1.5, marginBottom: 4 }}>
        현재 workspace의 ICP, 문제, 대안/가격, 채널, 플랫폼 가정을 공개 근거와 나란히 읽기 위한 레이더입니다.
      </div>

      <Group>RADAR 상태</Group>
      <KVRow label="상태" value="최신" tone="accent" />
      <KVRow label="카드" value="1" />
      <KVRow label="안 읽음" value="1" tone="amber" />
      <KVRow label="저장" value="0" />
      <KVRow label="마지막 업데이트" value="5/20 10:00" />

      <Group>가정 커버리지</Group>
      <div style={{ marginBottom: 8 }}>
        <Badge tone="amber">일부 가정 리서치 실패: 문제</Badge>
      </div>
      <KVRow label="대안/가격" value="1" tone="accent" />
    </MetaPanel>
  </div>
);

import { PhaseGateRow } from "founder-os-kit";

const canvas = {
  background: "var(--ds-page)",
  padding: 24,
  width: 840,
  fontFamily: "var(--ds-sans)",
};

// Projects screen "PHASE 게이트" — F/B/L/G rows: F in progress (accent), rest waiting.
export const PhaseGates = () => (
  <div style={canvas}>
    <PhaseGateRow
      letter="F"
      tone="accent"
      title="초기 검증 기준"
      day="D7"
      subtitle="인터뷰 5건 · 통증 가설 1 · 고객 후보 1줄 정의"
      progress={0.1}
      status="진행 중"
    />
    <PhaseGateRow
      letter="B"
      tone="violet"
      title="만들기 기준"
      day="D17"
      subtitle="핵심 기능 1개 · 30초 첫 가치 경험 · 결제/스토어 사전 점검"
      progress={0}
      status="대기"
    />
    <PhaseGateRow
      letter="L"
      tone="sky"
      title="공개 기준"
      day="D24"
      subtitle="60초 시연 · 첫 유료 또는 강한 의도 신호 1 · 공개 기록 14편"
      progress={0}
      status="대기"
    />
    <PhaseGateRow
      letter="G"
      tone="amber"
      title="성장 기준"
      day="D30"
      subtitle="유입/스토어 지표 · ASO/소재 1회 반복 · 계속/전환/중단 판정"
      progress={0}
      status="대기"
    />
  </div>
);

// A single row mid-progress — the F gate further along the 초기 검증 phase.
export const SingleInProgress = () => (
  <div style={canvas}>
    <PhaseGateRow
      letter="F"
      tone="accent"
      title="초기 검증 기준"
      day="D7"
      subtitle="인터뷰 5건 · 통증 가설 1 · 고객 후보 1줄 정의"
      progress={0.6}
      status="진행 중"
    />
  </div>
);

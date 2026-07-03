import { Stepper } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };

export const OfficeHoursDay1 = () => (
  <div style={{ ...canvas, maxWidth: 520 }}>
    <Stepper
      steps={[
        { label: "목표", state: "done" },
        { label: "첫 인터뷰", state: "active" },
        { label: "증거 제출", state: "pending" },
      ]}
    />
  </div>
);

export const PhaseTrack = () => (
  <div style={{ ...canvas, maxWidth: 620 }}>
    <Stepper
      steps={[
        { label: "초기 검증", state: "done" },
        { label: "만들기", state: "active" },
        { label: "공개", state: "pending" },
        { label: "성장", state: "locked" },
      ]}
    />
  </div>
);

export const Vertical = () => (
  <div style={{ ...canvas, maxWidth: 320 }}>
    <Stepper
      orientation="vertical"
      steps={[
        { label: "고객 후보 1줄 정의", state: "done" },
        { label: "첫 인터뷰 5건", state: "active" },
        { label: "통증 가설 1건 확정", state: "pending" },
        { label: "결제 요청 발송", state: "locked" },
      ]}
    />
  </div>
);

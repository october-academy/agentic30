import { Stepper } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: "32px 24px", fontFamily: "var(--ds-sans)", width: 520 };

export const DayLoop = () => (
  <div style={canvas}>
    <Stepper
      steps={[
        { name: "scan", status: "done" },
        { name: "회고", status: "done" },
        { name: "목표", status: "active" },
        { name: "인터뷰", status: "locked" },
        { name: "실행", status: "locked" },
      ]}
    />
  </div>
);

export const Day1 = () => (
  <div style={canvas}>
    <Stepper
      steps={[
        { name: "온보딩", status: "done" },
        { name: "scan", status: "done" },
        { name: "목표", status: "active" },
        { name: "첫 인터뷰", status: "locked" },
      ]}
    />
  </div>
);

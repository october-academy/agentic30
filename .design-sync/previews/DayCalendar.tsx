import { DayCalendar } from "founder-os-kit";

const canvas = {
  background: "var(--ds-page)",
  padding: 24,
  width: 840,
  fontFamily: "var(--ds-sans)",
};

// Projects screen "30일 캘린더" — four phase bands, current = Day 1, gate at D7.
export const ThirtyDayPlan = () => (
  <div style={canvas}>
    <DayCalendar
      current={1}
      phases={[
        { from: 1, to: 7, tone: "accent", label: "초기 검증", gate: 7 },
        { from: 8, to: 17, tone: "violet", label: "만들기" },
        { from: 18, to: 24, tone: "sky", label: "공개" },
        { from: 25, to: 30, tone: "amber", label: "성장" },
      ]}
    />
  </div>
);

// Later in the run: a "만들기" phase project (DevTrace, Day 9) — more cells revealed.
export const BuildPhase = () => (
  <div style={canvas}>
    <DayCalendar
      current={9}
      phases={[
        { from: 1, to: 7, tone: "accent", label: "초기 검증", gate: 7 },
        { from: 8, to: 17, tone: "violet", label: "만들기", gate: 17 },
        { from: 18, to: 24, tone: "sky", label: "공개" },
        { from: 25, to: 30, tone: "amber", label: "성장" },
      ]}
    />
  </div>
);

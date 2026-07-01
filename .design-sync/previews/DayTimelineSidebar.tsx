import { DayTimelineSidebar } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", display: "inline-block" };

export const Day7 = () => (
  <div style={canvas}>
    <DayTimelineSidebar
      project="agentic30"
      day="Day 7"
      progress="2/5"
      skipLabel="Day 3–5 · 건너뜀"
      days={[
        { day: 7, goal: "Go/No-Go 결정하기", sub: "오늘 · 진행 중", state: "today", badge: "2/5" },
        { day: 6, goal: "첫 유료 ask 보내기", sub: "미완", state: "incomplete", badge: "3/5" },
        { day: 2, goal: "기준 시장 고르기", state: "done" },
        { day: 1, goal: "먼저 도울 사람 정하기", state: "done" },
      ]}
    />
  </div>
);

export const EmptyState = () => (
  <div style={canvas}>
    <DayTimelineSidebar project="agentic30" day="Day 0" progress="0/0" state="empty" />
  </div>
);

export const ErrorState = () => (
  <div style={canvas}>
    <DayTimelineSidebar project="agentic30" day="Day —" state="error" />
  </div>
);

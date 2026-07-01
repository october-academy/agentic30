import { DayRow } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 240 };

export const States = () => (
  <div style={canvas}>
    <DayRow day={7} goal="Go/No-Go 결정하기" sub="오늘 · 진행 중" state="today" badge="2/5" />
    <DayRow day={6} goal="첫 유료 ask 보내기" sub="미완" state="incomplete" badge="3/5" />
    <DayRow day={2} goal="기준 시장 고르기" state="done" />
    <DayRow day={1} goal="먼저 도울 사람 정하기" state="done" />
  </div>
);

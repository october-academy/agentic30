import { Badge } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const };

export const Tones = () => (
  <div style={row}>
    <Badge tone="accent">활성</Badge>
    <Badge tone="amber">2일째 미룸</Badge>
    <Badge tone="rose">증거 0</Badge>
    <Badge tone="sky">공개</Badge>
    <Badge neutral>보관함</Badge>
  </div>
);

export const WithDot = () => (
  <div style={row}>
    <Badge tone="accent" dot>
      running
    </Badge>
    <Badge tone="amber" dot>
      진행 중 1
    </Badge>
    <Badge neutral dot>
      중단 D9
    </Badge>
  </div>
);

export const DayCounters = () => (
  <div style={row}>
    <Badge tone="accent">D1/30</Badge>
    <Badge tone="accent">D4/30</Badge>
    <Badge tone="amber">D9/30</Badge>
    <Badge neutral>완료</Badge>
  </div>
);

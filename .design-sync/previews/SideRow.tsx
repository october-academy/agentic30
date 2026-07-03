import { SideRow, Avatar, Badge } from "founder-os-kit";

// Rows sit inside the 240px sidebar; mirror that width + surface-2 background.
const canvas = {
  background: "var(--ds-surface-2)",
  padding: 8,
  width: 240,
  fontFamily: "var(--ds-sans)",
  display: "flex",
  flexDirection: "column" as const,
  gap: 2,
};

// The "활성" group: Agentic30 is the selected project (accent tint + left bar).
export const ActiveProjects = () => (
  <div style={canvas}>
    <SideRow
      active
      leading={<Avatar initials="A3" size={36} tone="accent" />}
      title="Agentic30 (직접…"
      subtitle="● 초기 검증 · macO…"
      badge={<Badge tone="accent">D1/30</Badge>}
    />
    <SideRow
      leading={<Avatar initials="LJ" size={36} tone="amber" muted />}
      title="LoopJournal"
      subtitle="● 초기 검증 · Web…"
      badge={<Badge neutral>D4/30</Badge>}
    />
    <SideRow
      leading={<Avatar initials="DT" size={36} tone="sky" muted />}
      title="DevTrace"
      subtitle="● 만들기 · Desktop…"
      badge={<Badge neutral>D9/30</Badge>}
    />
  </div>
);

// The "보관함" group: completed / stopped projects (neutral badges, all inactive).
export const Archived = () => (
  <div style={canvas}>
    <SideRow
      leading={<Avatar initials="QMD" size={36} tone="violet" muted />}
      title="qmd-support · iO…"
      subtitle="● 완주 · 2026-03 · …"
      badge={<Badge neutral>완주</Badge>}
    />
    <SideRow
      leading={<Avatar initials="MM" size={36} tone="sky" muted />}
      title="MealMate · 식단 코치"
      subtitle="● 중단 · 2026-01 · …"
      badge={<Badge neutral>중단</Badge>}
    />
  </div>
);

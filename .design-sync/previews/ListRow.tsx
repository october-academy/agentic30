import { ListRow, Avatar, Badge } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const panel = {
  ...canvas,
  maxWidth: 420,
  display: "flex",
  flexDirection: "column" as const,
  gap: 2,
};

export const ProjectList = () => (
  <div style={panel}>
    <ListRow
      leading={<Avatar initials="A3" tone="accent" size={36} />}
      title="Agentic30 (직접 사용 중)"
      subtitle="초기 검증 · macOS 메뉴바"
      trailing={<Badge tone="accent" mono>D1/30</Badge>}
      active
    />
    <ListRow
      leading={<Avatar initials="LJ" tone="violet" size={36} />}
      title="LoopJournal"
      subtitle="초기 검증 · Web"
      trailing={<Badge neutral>D4/30</Badge>}
    />
    <ListRow
      leading={<Avatar initials="DT" tone="sky" size={36} />}
      title="DevTrace"
      subtitle="만들기 · Desktop"
      trailing={<Badge neutral>D9/30</Badge>}
    />
    <ListRow
      leading={<Avatar initials="MM" tone="muted" size={36} muted />}
      title="MealMate · 식단 코치"
      subtitle="중단 · 2026-01"
      trailing={<Badge tone="amber" mono>중단</Badge>}
    />
  </div>
);

export const PhaseGates = () => (
  <div style={panel}>
    <ListRow
      leading={<Avatar initials="F" tone="accent" size={30} />}
      title="초기 검증 기준"
      body="인터뷰 5건 · 통증 가설 1 · 고객 후보 1줄 정의"
      chips={["D7", "게이트 1/4"]}
      trailing={<Badge tone="accent" dot>진행 중</Badge>}
      tone="accent"
      active
    />
    <ListRow
      leading={<Avatar initials="B" tone="violet" size={30} />}
      title="만들기 기준"
      body="핵심 기능 1개 · 30초 첫 가치 경험 · 결제/스토어 사전 점검"
      chips={["D17"]}
      trailing={<Badge neutral>대기</Badge>}
    />
    <ListRow
      leading={<Avatar initials="L" tone="sky" size={30} />}
      title="공개 기준"
      body="60초 시연 · 첫 유료 또는 강한 의도 신호 1 · 공개 기록 14편"
      chips={["D24"]}
      trailing={<Badge neutral>대기</Badge>}
    />
  </div>
);

export const SourceRoots = () => (
  <div style={panel}>
    <ListRow
      leading={<Avatar initials="qm" tone="teal" size={36} muted />}
      title="qmd-support · iOS"
      subtitle="완주 28/30"
      chips={["watch", "2026-03"]}
      trailing={<Badge tone="accent" mono>완주</Badge>}
    />
    <ListRow
      leading={<Avatar initials="c2" tone="pink" size={36} muted />}
      title="ClipperOps (가제)"
      subtitle="Problem memo · 인터뷰 0"
      trailing={<Badge neutral>D0</Badge>}
    />
  </div>
);

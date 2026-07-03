import { WorkspaceRail, Avatar } from "founder-os-kit";

// The workspace rail is a full-height 52px column; give the canvas an explicit
// height and the deepest window bg so the rail's own bg + active tint read true.
const canvas = {
  background: "var(--ds-bg-deep)",
  padding: 0,
  height: 520,
  fontFamily: "var(--ds-sans)",
  display: "flex",
};

// The default workspace lanes: Projects (active), Interviews (badge), News
// (new dot), History, plus a locked Settings gate. Footer = the workspace tile.
export const Default = () => (
  <div style={canvas}>
    <WorkspaceRail
      items={[
        { icon: "folder.fill", active: true, title: "프로젝트" },
        { icon: "bubble.left", badge: "3", title: "인터뷰" },
        { icon: "newspaper", newDot: true, title: "뉴스" },
        { icon: "clock", title: "히스토리" },
        { icon: "gearshape", locked: true, title: "설정 · 잠김" },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" />}
    />
  </div>
);

// News lane active, a busy interview count, and the Settings gate still locked.
export const NewsActive = () => (
  <div style={canvas}>
    <WorkspaceRail
      items={[
        { icon: "folder.fill", title: "프로젝트" },
        { icon: "bubble.left", badge: "9+", title: "인터뷰" },
        { icon: "newspaper", active: true, title: "뉴스" },
        { icon: "clock", newDot: true, title: "히스토리" },
        { icon: "gearshape", locked: true, title: "설정 · 잠김" },
      ]}
      footer={<Avatar initials="A3" size={34} tone="teal" />}
    />
  </div>
);

// State matrix — one slot per feature so each rail affordance is legible on its own.
export const States = () => (
  <div style={canvas}>
    <WorkspaceRail
      items={[
        { icon: "folder.fill", active: true, title: "활성" },
        { icon: "bubble.left", badge: "3", title: "배지" },
        { icon: "newspaper", newDot: true, title: "새 활동 점" },
        { icon: "chart.bar.fill", title: "기본" },
        { icon: "person.fill", locked: true, title: "잠김" },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" muted />}
    />
  </div>
);

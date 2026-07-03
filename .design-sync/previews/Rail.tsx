import { Rail, Avatar } from "founder-os-kit";

// The rail is a full-height 52px column; give the canvas an explicit height and
// a dark deep background so the rail's own bg + active tint read correctly.
const canvas = {
  background: "var(--ds-bg-deep)",
  padding: 0,
  height: 460,
  fontFamily: "var(--ds-sans)",
  display: "flex",
};

// Projects screen: the "Projects" (▤) slot is active with a new-activity dot.
export const ProjectsActive = () => (
  <div style={canvas}>
    <Rail
      items={[
        { icon: "▦" },
        { icon: "▷" },
        { icon: "◫" },
        { icon: "▤", active: true, dot: true },
        { icon: "◵" },
        { icon: "⚙" },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" />}
    />
  </div>
);

// News screen: the "News" (◫) slot is active — the radar lane the News page lives on.
export const NewsActive = () => (
  <div style={canvas}>
    <Rail
      items={[
        { icon: "▦" },
        { icon: "▷" },
        { icon: "◫", active: true },
        { icon: "▤", dot: true },
        { icon: "◵" },
        { icon: "⚙" },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" />}
    />
  </div>
);

import { Avatar } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 12, alignItems: "center", flexWrap: "wrap" as const };

export const ProjectTiles = () => (
  <div style={row}>
    <Avatar initials="A3" tone="accent" />
    <Avatar initials="LJ" tone="sky" />
    <Avatar initials="DT" tone="violet" />
    <Avatar initials="QMD" tone="teal" />
    <Avatar initials="MM" tone="amber" />
  </div>
);

export const Muted = () => (
  <div style={row}>
    <Avatar initials="C?" muted />
    <Avatar initials="D?" muted />
  </div>
);

export const Sizes = () => (
  <div style={row}>
    <Avatar initials="A3" tone="accent" size={28} />
    <Avatar initials="A3" tone="accent" size={40} />
    <Avatar initials="A3" tone="accent" size={56} />
  </div>
);

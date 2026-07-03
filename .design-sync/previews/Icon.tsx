import { Icon } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", color: "var(--ds-fg)" };
const grid = { ...canvas, display: "grid", gridTemplateColumns: "repeat(8, 1fr)", gap: 18, alignItems: "center" };

const names = [
  "chevron.right", "checkmark.circle.fill", "xmark", "magnifyingglass", "plus.circle.fill",
  "arrow.up.right", "arrow.clockwise", "gearshape.fill", "sidebar.left", "doc.text.fill",
  "folder.fill", "trash", "bell.fill", "person.2.fill", "calendar", "chart.line.uptrend.xyaxis",
  "bookmark.fill", "envelope.fill", "bolt.fill", "lock.fill", "star.fill", "exclamationmark.triangle.fill",
  "eye.fill", "sparkles",
];

export const Grid = () => (
  <div style={grid}>
    {names.map((n) => (
      <div key={n} style={{ display: "flex", flexDirection: "column", alignItems: "center", gap: 6 }}>
        <span style={{ color: "var(--ds-fg-secondary)" }}><Icon name={n} size={22} /></span>
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 8.5, color: "var(--ds-muted)", textAlign: "center" }}>{n}</span>
      </div>
    ))}
  </div>
);

export const Tinted = () => (
  <div style={{ ...canvas, display: "flex", gap: 20, alignItems: "center" }}>
    <span style={{ color: "var(--ds-accent)" }}><Icon name="checkmark.circle.fill" size={24} /></span>
    <span style={{ color: "var(--ds-warning)" }}><Icon name="exclamationmark.triangle.fill" size={24} /></span>
    <span style={{ color: "var(--ds-danger)" }}><Icon name="xmark.octagon.fill" size={24} /></span>
    <span style={{ color: "var(--ds-sky)" }}><Icon name="bolt.fill" size={24} /></span>
    <span style={{ color: "var(--ds-muted)" }}><Icon name="circle.dashed" size={24} /></span>
  </div>
);

export const Sizes = () => (
  <div style={{ ...canvas, display: "flex", gap: 16, alignItems: "center", color: "var(--ds-fg)" }}>
    {[12, 16, 20, 28, 40].map((s) => <Icon key={s} name="sparkles" size={s} />)}
  </div>
);

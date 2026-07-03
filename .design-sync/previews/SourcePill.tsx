import { SourcePill } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" as const };

const Folder = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z" />
  </svg>
);

const Watch = () => (
  <svg width="11" height="11" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <circle cx="12" cy="12" r="9" />
    <path d="M12 7v5l3 2" />
  </svg>
);

export const Paths = () => (
  <div style={row}>
    <SourcePill label="~/code/agentic30-public" icon={<Folder />} />
    <SourcePill label="~/.claude" icon={<Folder />} />
  </div>
);

export const SourceTags = () => (
  <div style={row}>
    <SourcePill label="9개 watch" icon={<Watch />} tone="accent" />
    <SourcePill label="3 · $0.04" tone="sky" />
    <SourcePill label="중단 D9" />
  </div>
);

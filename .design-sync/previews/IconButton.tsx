import { IconButton } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = { ...canvas, display: "flex", gap: 8, alignItems: "center" };

const Search = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

const Refresh = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <path d="M21 12a9 9 0 1 1-2.6-6.4" />
    <path d="M21 3v5h-5" />
  </svg>
);

const Sidebar = () => (
  <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round">
    <rect x="3" y="4" width="18" height="16" rx="2" />
    <path d="M9 4v16" />
  </svg>
);

export const Toolbar = () => (
  <div style={row}>
    <IconButton aria-label="검색" icon={<Search />} />
    <IconButton aria-label="새로고침" icon={<Refresh />} />
    <IconButton aria-label="사이드바 토글" icon={<Sidebar />} />
  </div>
);

export const Active = () => (
  <div style={row}>
    <IconButton aria-label="사이드바 토글" icon={<Sidebar />} active />
  </div>
);

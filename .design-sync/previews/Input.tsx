import { Input } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 320 };
const stack = { ...canvas, display: "flex", flexDirection: "column" as const, gap: 12 };

const SearchIcon = () => (
  <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round">
    <circle cx="11" cy="11" r="7" />
    <path d="M21 21l-4.3-4.3" />
  </svg>
);

export const Search = () => (
  <div style={stack}>
    <Input placeholder="프로젝트 검색" icon={<SearchIcon />} kbd="⌘P" />
  </div>
);

export const Focused = () => (
  <div style={stack}>
    <Input value="Agentic30" tone="accent" icon={<SearchIcon />} kbd="⌘P" />
  </div>
);

export const Warning = () => (
  <div style={stack}>
    <Input value="결제 요청 보낸 시각" tone="warning" placeholder="증거 링크를 입력하세요" />
  </div>
);

import { SectionHeader } from "founder-os-kit";

const canvas = {
  background: "var(--ds-page)",
  padding: 24,
  fontFamily: "var(--ds-sans)",
  width: 520,
  display: "flex",
  flexDirection: "column" as const,
  gap: 18,
};

export const Overview = () => (
  <div style={canvas}>
    <SectionHeader title="개요" meta="Day 1 of 30 · 초기 검증 진행 중" />
  </div>
);

export const WithEyebrow = () => (
  <div style={canvas}>
    <SectionHeader eyebrow="PHASE 게이트" title="진행 통과 조건" meta="Q2 진입점은 초기 검증" tone="violet" divider />
  </div>
);

export const Divider = () => (
  <div style={canvas}>
    <SectionHeader title="질문 1 — DEMAND" meta="1 / 6" divider />
  </div>
);

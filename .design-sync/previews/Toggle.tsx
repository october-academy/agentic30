import { Toggle } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const row = {
  ...canvas,
  display: "flex",
  gap: 20,
  alignItems: "center",
  flexWrap: "wrap" as const,
  color: "var(--ds-fg-secondary)",
  fontSize: 13,
};

const Field = ({ label, children }: { label: string; children: any }) => (
  <span style={{ display: "inline-flex", alignItems: "center", gap: 10 }}>
    {children}
    <span>{label}</span>
  </span>
);

export const States = () => (
  <div style={row}>
    <Field label="백그라운드 기록 켜짐">
      <Toggle checked />
    </Field>
    <Field label="자동 시작 꺼짐">
      <Toggle checked={false} />
    </Field>
  </div>
);

export const Disabled = () => (
  <div style={row}>
    <Field label="텔레메트리 전송 (릴리즈 전용)">
      <Toggle checked disabled />
    </Field>
  </div>
);

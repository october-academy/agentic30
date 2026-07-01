import { SignalTable } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 600 };

export const SessionContext = () => (
  <div style={canvas}>
    <SignalTable
      rows={[
        { key: "목적", value: "돈 벌기 · 지불 의향 검증" },
        { key: "진행", value: "전업 1인 개발자 (수익 0원, macOS) · 팔 대상·유입·검증 기준 불명확" },
        { key: "출력", value: "로컬 증거만 유지 · 승인 전 게시/문서 없음" },
      ]}
    />
  </div>
);

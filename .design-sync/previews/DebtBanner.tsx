import { DebtBanner } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 400 };

export const OpenDebt = () => (
  <div style={canvas}>
    <DebtBanner
      title={<>어제 약속: <b>"조은성에게 DM으로 가격 물어보기"</b></>}
      meta="증거 0 · 2일째 미룸"
      onAbandon={() => {}}
    />
  </div>
);

export const WithoutAbandon = () => (
  <div style={canvas}>
    <DebtBanner
      title={<>지난 약속: <b>"베타 링크 2명에게 보내기"</b></>}
      meta="증거 0 · 1일째 미룸"
    />
  </div>
);

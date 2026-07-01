import { ActionOption } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 400, display: "flex", flexDirection: "column" as const, gap: 7 };

export const List = () => (
  <div style={canvas}>
    <ActionOption label="조은성에게 DM으로 가격 물어보기" selected recommended />
    <ActionOption label="어제 인터뷰한 3명에게 결제 의향 재확인" />
    <ActionOption label="@breachers_joe 답장에 짧은 데모 영상 보내기" />
  </div>
);

export const Single = () => (
  <div style={canvas}>
    <ActionOption label="관심 보인 2명에게 베타 링크 보내기" />
  </div>
);

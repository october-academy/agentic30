import { StateCard } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 400 };

export const Empty = () => (
  <div style={canvas}>
    <StateCard
      variant="empty"
      title="직전 인터뷰가 없어 제안할 행동 후보가 아직 없어요."
      meta="suggestedActions: []"
      ctaLabel="직접 행동 적기"
    />
  </div>
);

export const ErrorState = () => (
  <div style={canvas}>
    <StateCard
      variant="error"
      title="행동 후보를 불러오지 못했어요. 직전 인터뷰 메모리를 읽는 중 연결이 끊겼습니다."
      meta="suggestedActions: timeout"
      ctaLabel="다시 불러오기"
    />
  </div>
);

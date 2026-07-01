import { QuestionCard, ActionOption } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 560, display: "flex", flexDirection: "column" as const, gap: 12 };

export const Question = () => (
  <div style={canvas}>
    <QuestionCard
      eyebrow="질문"
      index={1}
      total={6}
      question="Agentic30 수요를 실제 행동으로 확인한 가장 강한 증거는 무엇인가요?"
    />
  </div>
);

export const WithOptions = () => (
  <div style={canvas}>
    <QuestionCard
      index={2}
      total={6}
      question="오늘 검증할 단 하나의 고객 행동은 무엇인가요?"
    />
    <ActionOption label="실제 결제/계약이 있었다" selected recommended />
    <ActionOption label="구매 조건이 구체적으로 확인됐다" />
  </div>
);

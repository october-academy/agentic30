import { PromiseCard } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 430 };

export const Basic = () => (
  <div style={canvas}>
    <PromiseCard
      title="다음 한 가지 고객 행동을 약속해줘."
      options={[
        { label: "조은성에게 DM으로 가격 물어보기", selected: true, recommended: true },
        { label: "어제 인터뷰한 3명에게 결제 의향 재확인" },
        { label: "@breachers_joe 답장에 짧은 데모 영상 보내기" },
      ]}
      note={<>미룸을 누르면 선택지·약속 버튼이 <b>접히고</b> 사유 입력만 남음.</>}
    />
  </div>
);

export const WithDebt = () => (
  <div style={canvas}>
    <PromiseCard
      title="다음 한 가지 고객 행동을 약속해줘."
      debt={{ title: <>어제 약속: <b>"조은성에게 DM으로 가격 물어보기"</b></>, meta: "증거 0 · 2일째 미룸" }}
      commitDisabled
      options={[
        { label: "@breachers_joe 답장에 데모 영상 보내기", recommended: true },
        { label: "조은성에게 다시 DM — 가격 반응 확인" },
        { label: "관심 보인 2명에게 베타 링크 보내기" },
      ]}
      note={<>증거 닫기는 <b>다음 인터뷰 대화</b>에서 추궁. 부채 배너는 미룸 모드에서도 유지.</>}
    />
  </div>
);

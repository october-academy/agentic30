import { Card, Button } from "agentic30-ds";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)", width: 600 };

export const GoalCard = () => (
  <div style={canvas}>
    <Card
      eyebrow="목표 · 오피스아워"
      title="오늘의 방향을 한 문장으로 좁힙니다"
      actions={<><Button variant="primary">오피스아워 시작</Button><Button variant="ghost">지난 회고 보기</Button></>}
    >
      scan과 회고에서 모인 신호를 바탕으로, 7일간의 증거로 계속·재시작·피벗 중 하나를 고를 수 있게 오피스아워가 질문을 던집니다. 모드(startup/builder/intra)는 scan이 자동 선택합니다.
    </Card>
  </div>
);

export const ErrorCard = () => (
  <div style={canvas}>
    <Card
      eyebrow="오류 · 세션 저장소"
      title="타임라인을 불러오지 못했습니다"
      actions={<><Button variant="primary">다시 시도</Button><Button variant="ghost">사이드카 상태 보기</Button></>}
    >
      로컬 세션 저장소에 연결할 수 없어 오늘과 지난 Day를 표시할 수 없습니다. 사이드카가 실행 중인지 확인한 뒤 다시 시도하세요. 기록은 로컬에 안전하게 남아 있습니다.
    </Card>
  </div>
);

import { StateCard, Button } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const wrap = { ...canvas, maxWidth: 460 };

export const Empty = () => (
  <div style={wrap}>
    <StateCard
      kind="empty"
      title="아직 후보 없음"
      body="이번 주 유료 진입점을 보여줄 실명 고객 1명을 아직 고정하지 못했어요. 첫 인터뷰부터 시작해 볼까요?"
      action={<Button variant="primary" size="sm">첫 인터뷰 잡기</Button>}
    />
  </div>
);

export const Error = () => (
  <div style={wrap}>
    <StateCard
      kind="error"
      title="워크스페이스 스캔이 중단됐어요"
      body="프로바이더 인증이 실패해 실행이 중단됐습니다. Claude 또는 Codex 로그인을 확인한 뒤 다시 시도해 주세요."
      action={<Button variant="white" size="sm">다시 시도</Button>}
    />
  </div>
);

export const Loading = () => (
  <div style={wrap}>
    <StateCard
      kind="loading"
      title="소스 코드 루트를 스캔 중"
      body="9개 watch 대상에서 오늘의 실행 흔적을 읽고 있어요."
    />
  </div>
);

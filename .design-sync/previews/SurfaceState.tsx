import { SurfaceState, Button } from "founder-os-kit";

const surface = {
  background: "var(--ds-page)",
  fontFamily: "var(--ds-sans)",
  height: 460,
  borderRadius: "var(--ds-r-card)",
  border: "1px solid var(--ds-border)",
  overflow: "hidden",
};

export const ColdLoad = () => (
  <div style={surface}>
    <SurfaceState
      kind="cold"
      title="오늘의 실행 흔적을 모으는 중"
      detail="9개 watch 대상에서 어제 이후 변경과 병합을 읽고 있어요."
      rows={[
        {
          title: "소스 코드",
          state: "done",
          detail: "3개 저장소 · 변경 12건",
          logLines: ["git log --since yesterday", "gh pr list --state merged"],
        },
        {
          title: "GitHub 병합 PR",
          state: "active",
          detail: "events grouped by workspace",
          logLines: ["#25 URL shortener UTM", "#26 Almanac docs review"],
        },
        {
          title: "Cloudflare 배포",
          state: "pending",
          detail: "배포 라우트 대기",
          logLines: ["Cloudflare route queued"],
        },
        {
          title: "결제 이벤트",
          state: "error",
          detail: "Paddle 웹훅 인증 실패 · fail-closed",
        },
      ]}
    />
  </div>
);

export const Loading = () => (
  <div style={surface}>
    <SurfaceState
      kind="loading"
      title="워크스페이스를 스캔하는 중"
      detail="소스 코드 루트에서 오늘의 실행 흔적을 읽고 있어요. 잠시만요."
    />
  </div>
);

export const Empty = () => (
  <div style={surface}>
    <SurfaceState
      kind="empty"
      title="아직 고정된 고객이 없어요"
      detail="이번 주 유료 진입점을 보여줄 실명 고객 1명을 아직 고정하지 못했어요. 첫 인터뷰부터 시작해 볼까요?"
      action={<Button variant="primary" size="sm" icon="+">첫 인터뷰 잡기</Button>}
    />
  </div>
);

export const Error = () => (
  <div style={surface}>
    <SurfaceState
      kind="error"
      title="워크스페이스 스캔이 중단됐어요"
      detail="프로바이더 인증이 실패해 실행이 fail-closed로 멈췄습니다. Claude 또는 Codex 로그인을 확인한 뒤 다시 시도해 주세요."
      action={<Button variant="white" size="sm">다시 시도</Button>}
    />
  </div>
);

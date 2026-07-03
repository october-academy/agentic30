import { TimelineRow } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const rail = { ...canvas, maxWidth: 460 };

export const EvidenceTimeline = () => (
  <div style={rail}>
    <TimelineRow
      time="4분 전 · Day 1"
      title="Day 1 과제 생성"
      body="고객 후보 좁히기 · 다음 기준은 Day 3 인터뷰 5건"
      connector
    />
    <TimelineRow
      time="09:29 · Day 1"
      title="첫 인터뷰 기록 제출"
      body="장지창 (전 직장 동료) · 45분 · 신호 강 8/10"
      tone="accent"
      connector
    />
    <TimelineRow
      time="어제 · Day 0"
      title="워크스페이스 스캔 완료"
      body="소스 코드 3개 watch 등록"
      tone="muted"
    />
  </div>
);

export const Severity = () => (
  <div style={rail}>
    <TimelineRow
      time="방금 · Day 1"
      title="증거 부족으로 저장됨"
      body="결제 요청 캡처가 없어 부채 1건으로 기록"
      tone="amber"
      connector
    />
    <TimelineRow
      time="11:02 · Day 1"
      title="워크스페이스 스캔 중단됨"
      body="프로바이더 인증 실패 · fail-closed"
      tone="rose"
    />
  </div>
);

export const DayMarkers = () => (
  <div style={rail}>
    <TimelineRow time="Day 3" title="인터뷰 게이트 도달" body="5건 중 1건 완료" tone="accent" connector />
    <TimelineRow time="Day 17" title="만들기 기준 시작" body="핵심 기능 1개 · 30초 첫 가치 경험" tone="violet" connector />
    <TimelineRow time="Day 30" title="성장 기준" body="유입/스토어 지표 · 계속/전환/중단 판정" tone="muted" />
  </div>
);

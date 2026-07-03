import { DebtBanner, Button } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const col = { ...canvas, display: "flex", flexDirection: "column" as const, gap: 12, maxWidth: 560 };

export const EvidenceDebt = () => (
  <div style={col}>
    <DebtBanner
      tone="amber"
      title="증거 부족 · 부채 1건으로 저장됨"
      body="문서는 저장했지만 하드 증거가 없어요. 결제 요청 발송 캡처를 첨부하면 Day 1이 완료됩니다."
      action={<Button variant="amber" size="sm">캡처 첨부</Button>}
    />
  </div>
);

export const Deferred = () => (
  <div style={col}>
    <DebtBanner
      tone="amber"
      title="미룸으로 닫힘"
      body="오늘 결제 요청을 보내지 못했어요. 내일 첫 행동으로 다시 올라옵니다."
    />
  </div>
);

export const Blocked = () => (
  <div style={col}>
    <DebtBanner
      tone="rose"
      title="실행 중단됨"
      body="프로바이더 인증 실패로 워크스페이스 스캔이 fail-closed 됐습니다. 로그인을 확인해 주세요."
      action={<Button variant="white" size="sm">확인</Button>}
    />
  </div>
);

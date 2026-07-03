import { OptionCard } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const col = { ...canvas, display: "flex", flexDirection: "column" as const, gap: 8, maxWidth: 560 };

export const SingleSelect = () => (
  <div style={col}>
    <OptionCard
      title="돈을 냈거나 제안함"
      description="유료 파일럿, 선결제, 예산 배정처럼 비용이 걸린 신호."
      selected
      selectionStyle="single"
    />
    <OptionCard
      title="업무에 이미 의존함"
      description="프로토타입, 수작업 결과물, 리포트를 반복해서 쓰는 상태."
      selectionStyle="single"
    />
    <OptionCard
      title="강한 workaround 있음"
      description="Excel, Slack, 사람, 외주로 억지로 해결하는 현재 대안."
      selectionStyle="single"
    />
    <OptionCard
      title="아직 실제 증거 없음"
      description="아이디어나 대기 신청자 수준이라 첫 검증 과제가 필요한 상태."
      selectionStyle="single"
    />
  </div>
);

export const MultiSelect = () => (
  <div style={col}>
    <OptionCard
      title="결과 화면 캡처"
      description="실행 결과가 담긴 스크린샷을 흔적으로 제출."
      selected
      selectionStyle="multiple"
    />
    <OptionCard
      title="로컬 메모 제출됨"
      description="오늘 무엇을 왜 했는지 한 줄 메모."
      selected
      selectionStyle="multiple"
    />
    <OptionCard
      title="결제 요청 발송 캡처"
      description="보낸 시각이 보이는 청구 메시지 캡처."
      selectionStyle="multiple"
    />
  </div>
);

export const Unselected = () => (
  <div style={col}>
    <OptionCard title="아직 후보 없음" description="이번 주 실명 고객 1명을 아직 고정하지 못했어요." selectionStyle="single" />
    <OptionCard title="구두 약속만 있음" description="합의된 가격은 있지만 청구는 아직 보내지 않았어요." selectionStyle="single" />
  </div>
);

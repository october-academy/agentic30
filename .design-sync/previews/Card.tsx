import { Card, Chip, Button, Badge } from "founder-os-kit";

const canvas = { background: "var(--ds-page)", padding: 24, fontFamily: "var(--ds-sans)" };
const col = { ...canvas, display: "flex", flexDirection: "column" as const, gap: 16, maxWidth: 560 };

export const Overview = () => (
  <div style={col}>
    <Card
      eyebrow="초기 검증 · DAY 0–7"
      title="오늘은 Day 1 · 고객 후보 좁히기예요."
      subtitle="다음 기준은 Day 3 · 인터뷰 5건까지 6일"
      marker
      actions={<Badge tone="accent" dot>진행 중</Badge>}
    >
      <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", lineHeight: 1.55 }}>
        없어지면 실제로 곤란해지는 행동이나 돈의 증거를 이번 주 안에 1건 확보하세요.
      </div>
      <div style={{ display: "flex", gap: 6, marginTop: 12, flexWrap: "wrap" }}>
        <Chip label="완료 0" tone="muted" />
        <Chip label="진행 중 1" tone="accent" active />
        <Chip label="인터뷰 0 / 5" tone="muted" />
      </div>
      <div style={{ display: "flex", gap: 8, marginTop: 14 }}>
        <Button variant="primary" size="sm">오늘 화면 열기</Button>
        <Button variant="ghost" size="sm">플랜 편집</Button>
      </div>
    </Card>
  </div>
);

export const Plain = () => (
  <div style={col}>
    <Card
      title="개요"
      subtitle="Day 1 of 30 · 초기 검증 진행 중"
      body="시작 2026-05-16 · D-30 2026-06-15. 소스 코드 3개를 관찰하고 있어요."
    />
  </div>
);

export const Tones = () => (
  <div style={col}>
    <Card marker tone="amber" eyebrow="증거 부족" title="문서를 저장했지만 하드 증거가 없어요" body="self-report만으로는 done 처리되지 않습니다. 결제 요청 캡처를 첨부하세요." />
    <Card marker tone="rose" eyebrow="차단됨" title="워크스페이스 스캔이 중단됐어요" body="프로바이더 인증이 실패해 실행이 중단됐습니다. 다시 시도해 주세요." />
  </div>
);

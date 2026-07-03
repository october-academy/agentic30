import { ReferenceHeader, Avatar, Badge, Button } from "founder-os-kit";

// Main-column header sits inside the 880px content well; set a width to match.
const canvas = {
  background: "var(--ds-page)",
  padding: 24,
  width: 840,
  fontFamily: "var(--ds-sans)",
};

// Projects screen: Agentic30 identity + 활성 badge + dotted subtitle + 전환/오늘 화면 열기.
export const ProjectsHeader = () => (
  <div style={canvas}>
    <ReferenceHeader
      icon={<Avatar initials="A3" size={56} tone="accent" />}
      title="Agentic30 (직접 사용 중)"
      badge={<Badge tone="accent">활성</Badge>}
      subtitleParts={["초기 검증", "Day 1 / 30", "macOS 메뉴바 앱", "소스 코드 3 개", "마지막 활동 4분 전"]}
      actions={
        <>
          <Button variant="secondary" size="sm" icon={<span>◨</span>}>
            프로젝트 전환
          </Button>
          <Button variant="primary" size="sm" icon={<span>›</span>}>
            오늘 화면 열기
          </Button>
        </>
      }
    />
  </div>
);

// News screen variant: the Market Radar header — same molecule, different content.
export const NewsHeader = () => (
  <div style={canvas}>
    <ReferenceHeader
      icon={<Avatar initials="◫" size={56} tone="accent" />}
      title="시장 리서치 레이더"
      subtitleParts={["1 카드", "1 안 읽음", "0 저장", "1 표시", "마지막 업데이트 5/20 10:00", "0초 걸림"]}
      actions={
        <Button variant="secondary" size="sm" icon={<span>⟳</span>}>
          새로고침
        </Button>
      }
    />
  </div>
);

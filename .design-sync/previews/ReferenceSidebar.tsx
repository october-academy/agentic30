import { ReferenceSidebar, SideRow, Avatar, Badge, Button } from "founder-os-kit";

// The sidebar is a full-height 240px column; give it height + page background.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  height: 820,
  fontFamily: "var(--ds-sans)",
  display: "flex",
};

// Projects screen sidebar: 활성 / 보관함 / 후보 / 템플릿 groups + activity footer.
export const ProjectsSidebar = () => (
  <div style={canvas}>
    <ReferenceSidebar
      title="프로젝트"
      badge={<Badge tone="accent">활성 3</Badge>}
      search="프로젝트 검색"
      groups={[
        {
          label: "활성",
          count: "3",
          rows: [
            <SideRow
              active
              leading={<Avatar initials="A3" size={36} tone="accent" />}
              title="Agentic30 (직접…"
              subtitle="● 초기 검증 · macO…"
              badge={<Badge tone="accent">D1/30</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="LJ" size={36} tone="amber" muted />}
              title="LoopJournal"
              subtitle="● 초기 검증 · Web…"
              badge={<Badge neutral>D4/30</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="DT" size={36} tone="sky" muted />}
              title="DevTrace"
              subtitle="● 만들기 · Desktop…"
              badge={<Badge neutral>D9/30</Badge>}
            />,
          ],
        },
        {
          label: "보관함",
          count: "2",
          rows: [
            <SideRow
              leading={<Avatar initials="QMD" size={36} tone="violet" muted />}
              title="qmd-support · iO…"
              subtitle="● 완주 · 2026-03 · …"
              badge={<Badge neutral>완주</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="MM" size={36} tone="sky" muted />}
              title="MealMate · 식단 코치"
              subtitle="● 중단 · 2026-01 · …"
              badge={<Badge neutral>중단</Badge>}
            />,
          ],
        },
        {
          label: "후보 · 아직 시작 안 함",
          count: "2",
          rows: [
            <SideRow
              leading={<Avatar initials="C?" size={36} tone="amber" muted />}
              title="ClipperOps (가제)"
              subtitle="● Problem memo · 인…"
              badge={<Badge neutral>D0</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="D?" size={36} tone="amber" muted />}
              title="DeckTrace (가제)"
              subtitle="● 아이디어만 있음"
              badge={<Badge neutral>D0</Badge>}
            />,
          ],
        },
        {
          label: "템플릿",
          count: "3",
          rows: [
            <SideRow
              leading={<Avatar initials="iOS" size={36} tone="sky" muted />}
              title="iOS 구독앱 30일"
              subtitle="● ASO · 페이월 · p…"
              badge={<Badge neutral>템플릿</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="AD" size={36} tone="violet" muted />}
              title="Android 광고앱 3…"
              subtitle="● CPI · AdMob · P…"
              badge={<Badge neutral>템플릿</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="Web" size={36} tone="muted" muted />}
              title="구독형 웹 도구 30일"
              subtitle="● 소개 페이지 · 대기…"
              badge={<Badge neutral>템플릿</Badge>}
            />,
          ],
        },
      ]}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ds-muted)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
            마지막 활동 <span style={{ color: "var(--ds-fg-secondary)" }}>4분 전</span> · Day 1
          </div>
          <Button variant="primary" fullWidth icon={<span>＋</span>}>
            새 30일 프로젝트
          </Button>
        </div>
      }
    />
  </div>
);

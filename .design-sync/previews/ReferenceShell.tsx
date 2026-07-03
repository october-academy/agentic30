import {
  ReferenceShell,
  Rail,
  ReferenceSidebar,
  SideRow,
  Titlebar,
  ReferenceHeader,
  RefSection,
  MetaPanel,
  DayCalendar,
  PhaseGateRow,
  StatCard,
  Avatar,
  Badge,
  Button,
  KVRow,
} from "founder-os-kit";

// FULL-SCREEN preview — the shell fills its container, so give the canvas a
// realistic window size (~1360x860) and page background.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  width: 1360,
  height: 860,
  fontFamily: "var(--ds-sans)",
};

const Group = ({ children }: { children: React.ReactNode }) => (
  <div className="ds-eyebrow" style={{ margin: "18px 0 6px" }}>
    {children}
  </div>
);

// Projects screen — the full window: rail + sidebar + titlebar + main + meta.
export const ProjectsWindow = () => (
  <div style={canvas}>
    <ReferenceShell
      rail={
        <Rail
          items={[
            { icon: "▦" },
            { icon: "▷" },
            { icon: "◫" },
            { icon: "▤", active: true, dot: true },
            { icon: "◵" },
            { icon: "⚙" },
          ]}
          footer={<Avatar initials="Z" size={34} tone="accent" />}
        />
      }
      sidebar={
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
      }
      titlebar={<Titlebar breadcrumb={{ page: "프로젝트", detail: "포트폴리오 + 소스 루트" }} />}
      meta={
        <MetaPanel title="프로젝트 포트폴리오">
          <Group>활성 프로젝트</Group>
          <KVRow label="활성 프로젝트" value="3개" tone="accent" />
          <KVRow label="진행 phase" value="F2 · B1" />
          <KVRow label="인터뷰" value="5 / 15 게이트" />
          <KVRow label="소스 루트" value="9개 watch" />
          <KVRow label="오늘 호출" value="3 · $0.04" />
          <Group>보관함 요약</Group>
          <KVRow label="qmd-support" value="완주 28/30" />
          <KVRow label="평균 완주율" value="62% (2건)" tone="accent" />
        </MetaPanel>
      }
    >
      <ReferenceHeader
        icon={<Avatar initials="A3" size={56} tone="accent" />}
        title="Agentic30 (직접 사용 중)"
        badge={<Badge tone="accent">활성</Badge>}
        subtitleParts={["초기 검증", "Day 1 / 30", "macOS 메뉴바 앱", "소스 코드 3 개"]}
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
      <RefSection title="개요" subtitle="Day 1 of 30 · 초기 검증 진행 중" markerTone="accent">
        <DayCalendar
          current={1}
          phases={[
            { from: 1, to: 7, tone: "accent", label: "초기 검증", gate: 7 },
            { from: 8, to: 17, tone: "violet", label: "만들기" },
            { from: 18, to: 24, tone: "sky", label: "공개" },
            { from: 25, to: 30, tone: "amber", label: "성장" },
          ]}
        />
        <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
          <div style={{ flex: 1, minWidth: 0 }}>
            <StatCard label="완료한 DAY" value="0" unit="/ 30" sub="→ Day 1 진행 중" tone="muted" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <StatCard label="인터뷰 원문" value="1" unit="/ 5 기준" sub="+ 1 어제" tone="accent" />
          </div>
          <div style={{ flex: 1, minWidth: 0 }}>
            <StatCard label="소스 코드 루트" value="3" unit="/ watch 활성" sub="+ 2 보조 레포" tone="accent" />
          </div>
        </div>
      </RefSection>
      <RefSection title="PHASE 게이트" subtitle="진행 통과 조건 · Q2 진입점은 초기 검증" markerTone="accent">
        <PhaseGateRow
          letter="F"
          tone="accent"
          title="초기 검증 기준"
          day="D7"
          subtitle="인터뷰 5건 · 통증 가설 1 · 고객 후보 1줄 정의"
          progress={0.1}
          status="진행 중"
        />
        <PhaseGateRow
          letter="B"
          tone="violet"
          title="만들기 기준"
          day="D17"
          subtitle="핵심 기능 1개 · 30초 첫 가치 경험 · 결제/스토어 사전 점검"
          progress={0}
          status="대기"
        />
        <PhaseGateRow
          letter="L"
          tone="sky"
          title="공개 기준"
          day="D24"
          subtitle="60초 시연 · 첫 유료 또는 강한 의도 신호 1 · 공개 기록 14편"
          progress={0}
          status="대기"
        />
      </RefSection>
    </ReferenceShell>
  </div>
);

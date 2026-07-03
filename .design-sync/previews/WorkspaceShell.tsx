import {
  WorkspaceShell,
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

// FULL-SCREEN preview — the shell fills its container, so frame a realistic
// window (~1360x860) on the page background.
const canvas = {
  background: "var(--ds-page)",
  padding: 0,
  width: 1360,
  height: 860,
  fontFamily: "var(--ds-sans)",
};

// Day screen — the uniform four-pane workspace: rail + titlebar + sidebar + main + meta.
export const DayWorkspace = () => (
  <div style={canvas}>
    <WorkspaceShell
      rail={
        <Rail
          items={[
            { icon: "▦", active: true },
            { icon: "▷" },
            { icon: "◫" },
            { icon: "▤", dot: true },
            { icon: "◵" },
            { icon: "⚙" },
          ]}
          footer={<Avatar initials="Z" size={34} tone="accent" />}
        />
      }
      titlebar={<Titlebar breadcrumb={{ page: "오늘", detail: "Day 1 · 초기 검증" }} />}
      sidebar={
        <ReferenceSidebar
          title="오늘의 흐름"
          badge={<Badge tone="accent">Day 1</Badge>}
          search="흐름 검색"
          groups={[
            {
              label: "진행",
              count: "3",
              rows: [
                <SideRow
                  active
                  leading={<Avatar initials="Q1" size={36} tone="accent" />}
                  title="활성 사용자 기준"
                  subtitle="● 오피스아워 · 질문 1"
                  badge={<Badge tone="accent">지금</Badge>}
                />,
                <SideRow
                  leading={<Avatar initials="Q2" size={36} tone="sky" muted />}
                  title="오늘 실행"
                  subtitle="● 다음 · 좁은 한 행동"
                  badge={<Badge neutral>대기</Badge>}
                />,
                <SideRow
                  leading={<Avatar initials="Q3" size={36} tone="violet" muted />}
                  title="확인할 흔적"
                  subtitle="● 다음 · 증거 정의"
                  badge={<Badge neutral>대기</Badge>}
                />,
              ],
            },
            {
              label: "완료",
              count: "1",
              rows: [
                <SideRow
                  leading={<Avatar initials="F" size={36} tone="accent" muted />}
                  title="파운데이션 요약"
                  subtitle="● 완료 · 방금"
                  badge={<Badge neutral>완료</Badge>}
                />,
              ],
            },
          ]}
          footer={
            <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
              <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ds-muted)" }}>
                <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
                마지막 활동 <span style={{ color: "var(--ds-fg-secondary)" }}>2분 전</span> · Day 1
              </div>
              <Button variant="primary" fullWidth icon={<span>›</span>}>
                오피스아워 계속
              </Button>
            </div>
          }
        />
      }
      meta={
        <MetaPanel title="오늘 요약">
          <KVRow label="Day" value="1 / 30" tone="accent" />
          <KVRow label="현재 phase" value="초기 검증" />
          <KVRow label="게이트까지" value="D7" />
          <KVRow label="인터뷰 원문" value="1 / 5" />
          <KVRow label="오늘 호출" value="2 · $0.03" />
          <div style={{ height: 14 }} />
          <div className="ds-eyebrow" style={{ margin: "4px 0 8px" }}>
            오늘의 한 행동
          </div>
          <KVRow label="상태" value="정의 중" tone="amber" />
          <KVRow label="증거" value="미제출" />
        </MetaPanel>
      }
      main={
        <>
          <ReferenceHeader
            icon={<Avatar initials="A3" size={56} tone="accent" />}
            title="오늘 실행할 좁은 한 행동을 고정합니다"
            badge={<Badge tone="accent">진행 중</Badge>}
            subtitleParts={["Day 1 / 30", "초기 검증", "오피스아워 · 질문 1"]}
            actions={
              <Button variant="primary" size="sm" icon={<span>›</span>}>
                다음 질문
              </Button>
            }
          />
          <RefSection title="30일 개요" subtitle="Day 1 of 30 · 초기 검증 진행 중" markerTone="accent">
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
                <StatCard label="확인된 흔적" value="0" unit="/ 오늘" sub="증거 대기" tone="amber" />
              </div>
            </div>
          </RefSection>
          <RefSection title="PHASE 게이트" subtitle="진행 통과 조건 · 지금은 초기 검증" markerTone="accent">
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
          </RefSection>
        </>
      }
    />
  </div>
);

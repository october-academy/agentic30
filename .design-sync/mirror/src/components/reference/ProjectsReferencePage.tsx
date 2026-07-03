import React from "react";
import { Tone, toneVars } from "../../tokens";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { ProgressRing } from "../ProgressRing";
import { StatCard } from "../StatCard";
import { Rail } from "./Rail";
import { SideRow } from "./SideRow";
import { ReferenceSidebar } from "./ReferenceSidebar";
import { Titlebar } from "./Titlebar";
import { ReferenceHeader } from "./ReferenceHeader";
import { RefSection } from "./RefSection";
import { MetaPanel } from "./MetaPanel";
import { ReferenceShell } from "./ReferenceShell";
import { PhaseGateRow } from "./PhaseGateRow";
import { DayCalendar } from "./DayCalendar";

/* ────────────────────────── small local building blocks ────────────────────────── */

/** Inline colored stat token in the overview banner ("완료 0", "진행 중 1"). */
function InlineStat({ label, value, tone }: { label: string; value: string; tone?: Tone }) {
  const color = tone != null ? toneVars(tone).color : "var(--ds-muted)";
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6, fontSize: 12.5 }}>
      {tone != null && <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />}
      <span style={{ color: tone != null ? "var(--ds-fg-secondary)" : "var(--ds-muted)" }}>{label}</span>
      <span style={{ fontFamily: "var(--ds-mono)", fontWeight: 700, color }}>{value}</span>
    </span>
  );
}

/** Labelled KV row in the meta panel (glyph · label · value). */
function MetaRow({
  glyph,
  label,
  value,
  valueTone,
  dot,
}: {
  glyph: React.ReactNode;
  label: React.ReactNode;
  value: React.ReactNode;
  valueTone?: Tone;
  dot?: boolean;
}) {
  const vColor = valueTone != null ? toneVars(valueTone).color : "var(--ds-fg-secondary)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
      <span style={{ flex: "0 0 auto", width: 16, textAlign: "center", color: "var(--ds-muted)", fontSize: 13 }}>
        {glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, color: "var(--ds-fg)" }}>{label}</span>
      <span style={{ flex: "0 0 auto", display: "inline-flex", alignItems: "center", gap: 6 }}>
        {dot && <span style={{ width: 6, height: 6, borderRadius: 999, background: vColor }} />}
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 12, color: vColor }}>{value}</span>
      </span>
    </div>
  );
}

/** Small uppercase group header inside the meta panel. */
function MetaGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-eyebrow" style={{ margin: "18px 0 6px" }}>
      {children}
    </div>
  );
}

/** Action row in the meta "빠른 액션" group (glyph · title/subtitle · kbd chip). */
function MetaActionRow({
  glyph,
  glyphTone = "accent",
  title,
  subtitle,
  kbd,
}: {
  glyph: React.ReactNode;
  glyphTone?: Tone;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  kbd: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "9px 0" }}>
      <span style={{ flex: "0 0 auto", width: 16, textAlign: "center", color: toneVars(glyphTone).color, fontSize: 15 }}>
        {glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>{title}</span>
        <span style={{ display: "block", marginTop: 2, fontSize: 11.5, color: "var(--ds-muted)" }}>{subtitle}</span>
      </span>
      <span
        style={{
          flex: "0 0 auto",
          fontFamily: "var(--ds-mono)",
          fontSize: 10.5,
          color: "var(--ds-muted)",
          background: "var(--ds-surface-2)",
          border: "1px solid var(--ds-border)",
          borderRadius: 6,
          padding: "2px 6px",
        }}
      >
        {kbd}
      </span>
    </div>
  );
}

/* ─────────────────────────────── page ─────────────────────────────── */

export interface ProjectsReferencePageProps {
  /** Fixed pixel height for the framed window (the shell fills its container otherwise). */
  height?: number;
}

/** Faithful mirror of OpenDesign_Projects_Wide.png — the canonical reference page. */
export function ProjectsReferencePage({ height = 900 }: ProjectsReferencePageProps) {
  const rail = (
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
  );

  const sidebar = (
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
  );

  const titlebar = <Titlebar breadcrumb={{ page: "프로젝트", detail: "포트폴리오 + 소스 루트" }} />;

  const header = (
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
  );

  const overviewBanner = (
    <div
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 20,
        padding: "18px 20px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <ProgressRing value={0.03} size={72} label="3%" />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div className="ds-eyebrow" style={{ marginBottom: 8, color: "var(--ds-accent)" }}>
          초기 검증 · DAY 0–7
        </div>
        <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ds-fg)", lineHeight: 1.4 }}>
          오늘은 Day 1 · 고객 후보 좁히기예요. 다음 기준은 Day 3 인터뷰 5건까지 6일.
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: "8px 18px", marginTop: 12 }}>
          <InlineStat label="완료" value="0" tone="accent" />
          <InlineStat label="진행 중" value="1" tone="amber" />
          <InlineStat label="남은 일수" value="29" />
          <InlineStat label="인터뷰" value="0 / 5" />
          <InlineStat label="공개 기록" value="0 / 14" />
        </div>
      </div>
      <div style={{ flex: "0 0 auto", display: "flex", flexDirection: "column", alignItems: "flex-end", gap: 10 }}>
        <div style={{ fontFamily: "var(--ds-mono)", fontSize: 11, color: "var(--ds-muted)", textAlign: "right" }}>
          시작 2026-05-16 · D-30: 2026-06-15
        </div>
        <Button variant="ghost" size="sm" icon={<span>🗑</span>}>
          플랜 편집
        </Button>
      </div>
    </div>
  );

  const statCards = (
    <div style={{ display: "flex", gap: 12, marginTop: 14 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <StatCard label="완료한 DAY" value="0" unit="/ 30" sub="→ Day 1 진행 중" tone="muted" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <StatCard label="인터뷰 원문" value="1" unit="/ 5 기준" sub="+ 1 어제" tone="accent" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <StatCard label="공개 기록 글" value="0" unit="/ 14 권장" sub="− 미시작" tone="muted" />
      </div>
      <div style={{ flex: 1, minWidth: 0 }}>
        <StatCard label="소스 코드 루트" value="3" unit="/ watch 활성" sub="+ 2 보조 레포" tone="accent" />
      </div>
    </div>
  );

  const main = (
    <>
      {header}
      <RefSection title="개요" subtitle="Day 1 of 30 · 초기 검증 진행 중" markerTone="accent">
        {overviewBanner}
        <DayCalendar
          current={1}
          phases={[
            { from: 1, to: 7, tone: "accent", label: "초기 검증", gate: 7 },
            { from: 8, to: 17, tone: "violet", label: "만들기" },
            { from: 18, to: 24, tone: "sky", label: "공개" },
            { from: 25, to: 30, tone: "amber", label: "성장" },
          ]}
        />
        {statCards}
      </RefSection>

      <RefSection
        title="PHASE 게이트"
        subtitle="진행 통과 조건 · Q2 진입점은 초기 검증"
        markerTone="accent"
      >
        <div>
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
          <PhaseGateRow
            letter="G"
            tone="amber"
            title="성장 기준"
            day="D30"
            subtitle="유입/스토어 지표 · ASO/소재 1회 반복 · 계속/전환/중단 판정"
            progress={0}
            status="대기"
          />
        </div>
      </RefSection>
    </>
  );

  const portfolioBanner = (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface-2)",
        border: "1px solid var(--ds-border-soft)",
        marginBottom: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ds-muted)" }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
        30일 진행률 · 모든 활성
      </div>
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", marginTop: 6 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 24, fontWeight: 700, color: "var(--ds-fg)" }}>14</span>
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 13, color: "var(--ds-muted)" }}>/ 90 day</span>
        </span>
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 13, fontWeight: 700, color: "var(--ds-accent)" }}>
          3 projects
        </span>
      </div>
      <div style={{ display: "flex", height: 4, borderRadius: "var(--ds-r-pill)", overflow: "hidden", margin: "10px 0" }}>
        <div style={{ flex: 2, background: "var(--ds-accent)" }} />
        <div style={{ flex: 1, background: "var(--ds-violet)" }} />
        <div style={{ flex: 3, background: "var(--ds-surface-2)" }} />
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 16, fontSize: 12 }}>
        <LegendKV tone="accent" label="F" value="2" />
        <LegendKV tone="violet" label="B" value="1" />
        <LegendKV tone="muted" label="L+G" value="0" />
      </div>
    </div>
  );

  const meta = (
    <MetaPanel title="프로젝트 포트폴리오">
      {portfolioBanner}

      <MetaGroupLabel>활성 프로젝트</MetaGroupLabel>
      <MetaRow glyph="◷" label="활성 프로젝트" value="3개" valueTone="accent" dot />
      <MetaRow glyph="∿" label="진행 phase" value="F2 · B1" />
      <MetaRow glyph="◌" label="인터뷰" value="5 / 15 게이트" />
      <MetaRow glyph="▢" label="소스 루트" value="9개 watch" />
      <MetaRow glyph="↗" label="오늘 호출" value="3 · $0.04" />
      <MetaRow glyph="🗑" label="D-30 목표일" value="2026-06-15" />

      <MetaGroupLabel>보관함 요약</MetaGroupLabel>
      <MetaRow glyph="✓" label="qmd-support" value="완주 28/30" />
      <MetaRow glyph="⊖" label="MealMate" value="중단 D9" />
      <MetaRow glyph="↗" label="평균 완주율" value="62% (2건)" />

      <MetaGroupLabel>빠른 액션</MetaGroupLabel>
      <MetaActionRow glyph="›" title="오늘 화면으로" subtitle="Day 1 · 고객 후보 좁히기" kbd="↵" />
      <MetaActionRow glyph="＋" glyphTone="sky" title="새 30일 프로젝트" subtitle="템플릿 또는 백지에서 시작" kbd="⌘N" />
      <MetaActionRow glyph="◨" glyphTone="muted" title="프로젝트 전환" subtitle="활성/보관함 가로질러 검색" kbd="⌘P" />
      <MetaActionRow glyph="◌" glyphTone="amber" title="인터뷰 추가" subtitle=".vtt / .txt drop ·…" kbd="⌘I" />
    </MetaPanel>
  );

  return (
    <div style={{ height, minHeight: 0 }}>
      <ReferenceShell rail={rail} sidebar={sidebar} titlebar={titlebar} meta={meta}>
        {main}
      </ReferenceShell>
    </div>
  );
}

function LegendKV({ tone, label, value }: { tone: Tone; label: string; value: string }) {
  const color = tone === "muted" ? "var(--ds-muted)" : toneVars(tone).color;
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
      <span style={{ color: "var(--ds-fg-secondary)" }}>{label}</span>
      <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
      <span style={{ fontFamily: "var(--ds-mono)", fontWeight: 700, color }}>{value}</span>
    </span>
  );
}

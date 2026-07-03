import React from "react";
import { Tone, toneVars } from "../../tokens";
import { WorkspaceShell } from "../WorkspaceShell";
import { WorkspaceRail } from "../WorkspaceRail";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Stepper } from "../Stepper";
import { ProgressRing } from "../ProgressRing";
import { Titlebar } from "../reference/Titlebar";
import { ReferenceSidebar } from "../reference/ReferenceSidebar";
import { SideRow } from "../reference/SideRow";
import { MetaPanel } from "../reference/MetaPanel";

/* ────────────────────────── small local building blocks ────────────────────────── */

/**
 * The "OH" identity tile above the Office-Hours header — an accent rounded
 * square with the mono session initials (mirrors the app's session glyph).
 */
function SessionGlyph() {
  return (
    <div
      style={{
        width: 44,
        height: 44,
        flex: "0 0 auto",
        borderRadius: "var(--ds-r-control)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--ds-mono)",
        fontSize: 15,
        fontWeight: 700,
        letterSpacing: "0.02em",
        color: "var(--ds-accent)",
        background: "var(--ds-accent-dim)",
        border: "1px solid var(--ds-accent-line)",
      }}
    >
      OH
    </div>
  );
}

/** The terminal command echo above the goal card — mono, tinted segments. */
function TerminalLine() {
  return (
    <div
      style={{
        fontFamily: "var(--ds-mono)",
        fontSize: 13,
        lineHeight: 1.5,
        whiteSpace: "nowrap",
        overflow: "hidden",
        textOverflow: "ellipsis",
        marginBottom: 16,
      }}
    >
      <span style={{ color: "var(--ds-accent)" }}>office-hours@agentic30</span>{" "}
      <span style={{ color: "var(--ds-sky)" }}>~/strategy/session</span>{" "}
      <span style={{ color: "var(--ds-muted)" }}>$</span>{" "}
      <span style={{ color: "var(--ds-fg-secondary)" }}>start startup --write-design-doc</span>
    </div>
  );
}

/**
 * The accent-marked "목표 확립" phase heading above the goal card.
 * A small accent tick bar + a muted-tracked stage label.
 */
function StageMarker({ label }: { label: string }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ width: 3, height: 15, borderRadius: 2, background: "var(--ds-accent)" }} />
      <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ds-fg-secondary)" }}>{label}</span>
    </div>
  );
}

/** One numbered goal option — the three cards inside the goal panel. */
function GoalOption({
  index,
  title,
  recommended,
  children,
}: {
  index: number;
  title: React.ReactNode;
  recommended?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 12,
        padding: 16,
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <span
          style={{
            width: 26,
            height: 26,
            flex: "0 0 auto",
            borderRadius: "var(--ds-r-pill)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            fontFamily: "var(--ds-mono)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ds-muted)",
            background: "var(--ds-surface-2)",
            border: "1px solid var(--ds-border-strong)",
          }}
        >
          {index}
        </span>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            display: "flex",
            alignItems: "center",
            gap: 8,
            flexWrap: "wrap",
          }}
        >
          <span style={{ fontSize: 15, fontWeight: 700, color: "var(--ds-fg)", lineHeight: 1.35 }}>{title}</span>
          {recommended && <Badge tone="accent">추천</Badge>}
        </span>
      </div>
      <div style={{ fontSize: 13, color: "var(--ds-muted)", lineHeight: 1.55 }}>{children}</div>
    </div>
  );
}

/** Bold-emphasized fragment inside an option's supporting copy. */
function Em({ children }: { children: React.ReactNode }) {
  return <span style={{ color: "var(--ds-fg-secondary)", fontWeight: 700 }}>{children}</span>;
}

/** Labelled KV row in the meta panel (glyph · label · value). */
function MetaRow({
  glyph,
  label,
  value,
  valueTone,
  dot,
}: {
  glyph: string;
  label: React.ReactNode;
  value: React.ReactNode;
  valueTone?: Tone;
  dot?: boolean;
}) {
  const vColor = valueTone != null ? toneVars(valueTone).color : "var(--ds-fg-secondary)";
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "7px 0" }}>
      <span style={{ flex: "0 0 auto", width: 16, display: "inline-flex", justifyContent: "center", color: "var(--ds-muted)" }}>
        <Icon name={glyph} size={13} title="" />
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

/* ─────────────────────────────── screen ─────────────────────────────── */

export interface DayWorkspaceScreenProps {
  /** Fixed pixel height for the framed window (the shell fills its container otherwise). */
  height?: number;
}

/**
 * Faithful mirror of OpenDesign_Day_Initial_Wide.png — the Day workspace with
 * an Office-Hours · Day 1 turn open on the "목표 확립" stage: the goal-selection
 * card with three goal options and a "목표 선택 후 시작" composer.
 *
 * Composes the uniform WorkspaceShell: the day rail (grid lane active, later
 * lanes locked), a DEFAULT task-thread sidebar, the today main (session header
 * + stepper + terminal echo + goal card), and an "오늘 요약" meta panel.
 */
export function DayWorkspaceScreen({ height = 900 }: DayWorkspaceScreenProps) {
  /* ---- rail: day lane active; later lanes gated behind the current phase ---- */
  const rail = (
    <WorkspaceRail
      items={[
        { icon: "calendar", active: true, title: "오늘" },
        { icon: "play.fill", locked: true, title: "실행 리플레이" },
        { icon: "chart.line.uptrend.xyaxis", locked: true, title: "지표" },
        { icon: "newspaper", locked: true, title: "공개 기록" },
        { icon: "person.2.fill", locked: true, title: "인터뷰" },
        { icon: "gearshape", title: "설정" },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" />}
    />
  );

  /* ---- task-thread sidebar: the DEFAULT workspace thread ---- */
  const sidebar = (
    <ReferenceSidebar
      title={
        <span style={{ overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>
          agentic30-ui-opendesign-day-wo…
        </span>
      }
      groups={[
        {
          label: "DEFAULT",
          rows: [
            <SideRow
              active
              leading={<Avatar initials="YC" size={36} tone="accent" />}
              title="Startup diagnostic"
              subtitle="수요, 현재 대안, 유료 진…"
              badge={
                <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11, color: "var(--ds-muted)" }}>default</span>
              }
            />,
          ],
        },
      ]}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
          <Avatar initials="Z" size={28} tone="accent" />
          <Button variant="ghost" size="sm" icon={<Icon name="plus" size={13} title="" />}>
            새 대화 시작하기
          </Button>
        </div>
      }
    />
  );

  /* ---- titlebar: centered breadcrumb + default tool actions ---- */
  const titlebar = <Titlebar breadcrumb={{ page: "Agentic30", detail: "Office Hours" }} />;

  /* ---- session header: OH glyph + title + status + connecting badge ---- */
  const header = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 22 }}>
      <SessionGlyph />
      <div style={{ flex: 1, minWidth: 0 }}>
        <div
          style={{
            fontFamily: "var(--ds-rounded)",
            fontSize: 24,
            fontWeight: 700,
            letterSpacing: "var(--ds-track-tight)",
            color: "var(--ds-fg)",
          }}
        >
          Office Hours · Day 1
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: 7, marginTop: 6 }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
          <span style={{ fontSize: 13, color: "var(--ds-muted)" }}>목표 확정 대기</span>
        </div>
      </div>
      <span
        style={{
          flex: "0 0 auto",
          display: "inline-flex",
          alignItems: "center",
          height: 24,
          padding: "0 12px",
          borderRadius: "var(--ds-r-pill)",
          fontFamily: "var(--ds-mono)",
          fontSize: 11.5,
          fontWeight: 600,
          color: "var(--ds-muted)",
          background: "var(--ds-surface-2)",
          border: "1px solid var(--ds-border-strong)",
        }}
      >
        connecting
      </span>
    </div>
  );

  /* ---- stepper: 3 stages, "목표 준비" active ---- */
  const stepper = (
    <div style={{ marginBottom: 26 }}>
      <Stepper
        steps={[
          { label: "목표 준비", state: "active" },
          { label: "질문 대화", state: "pending" },
          { label: "증거 정리", state: "pending" },
        ]}
      />
    </div>
  );

  /* ---- goal card: heading + subtitle + 3 goal options + composer ---- */
  const goalCard = (
    <>
      <TerminalLine />
      <StageMarker label="목표 확립" />
      <div
        style={{
          padding: 22,
          borderRadius: "var(--ds-r-card)",
          background: "var(--ds-bg-deep)",
          border: "1px solid var(--ds-border-soft)",
          borderLeft: "3px solid var(--ds-accent)",
        }}
      >
        <div
          style={{
            fontFamily: "var(--ds-rounded)",
            fontSize: 22,
            fontWeight: 700,
            letterSpacing: "var(--ds-track-tight)",
            color: "var(--ds-fg)",
            lineHeight: 1.35,
          }}
        >
          <span
            style={{
              color: "var(--ds-warning)",
              background: "var(--ds-warning-dim)",
              borderRadius: 6,
              padding: "0 6px",
            }}
          >
            30일
          </span>{" "}
          동안 증명할 목표를 먼저 선택하세요
        </div>
        <div style={{ fontSize: 13.5, color: "var(--ds-muted)", marginTop: 10, lineHeight: 1.6 }}>
          선택한 목표를 기준으로 Day 1 질문을 만들고 확정하면{" "}
          <span
            style={{
              fontFamily: "var(--ds-mono)",
              fontSize: 12.5,
              color: "var(--ds-accent)",
            }}
          >
            .agentic30/docs/GOAL.md
          </span>
          에 기록합니다.
        </div>

        <div style={{ display: "flex", gap: 12, marginTop: 20 }}>
          <GoalOption index={1} title="작동하는 첫 버전 출시">
            사용자가 <Em>핵심 흐름을 끝까지 완료하는지</Em> 확인합니다.
          </GoalOption>
          <GoalOption index={2} title="활성 사용자 100명 모으기" recommended>
            ICP가 <Em>핵심 활성 행동을 끝냈는지</Em> 확인합니다.
          </GoalOption>
          <GoalOption index={3} title="첫 매출 달성">
            <Em>돈이 실제로 움직일 조건</Em>을 확인합니다.
          </GoalOption>
        </div>

        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 12,
            marginTop: 20,
            padding: "13px 16px",
            borderRadius: "var(--ds-r-control)",
            background: "var(--ds-surface)",
            border: "1px solid var(--ds-border)",
          }}
        >
          <span style={{ flex: 1, minWidth: 0, fontSize: 14, color: "var(--ds-muted)" }}>목표 선택 후 시작</span>
          <span
            style={{
              flex: "0 0 auto",
              width: 30,
              height: 30,
              borderRadius: "var(--ds-r-control)",
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              color: "var(--ds-muted)",
              background: "var(--ds-surface-2)",
              border: "1px solid var(--ds-border)",
            }}
          >
            <Icon name="arrow.right" size={15} title="시작" />
          </span>
        </div>
      </div>
    </>
  );

  const main = (
    <>
      {header}
      {stepper}
      {goalCard}
    </>
  );

  /* ---- meta panel: today summary + this-turn state ---- */
  const meta = (
    <MetaPanel title="오늘 요약">
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 14,
          padding: "14px 16px",
          borderRadius: "var(--ds-r-card)",
          background: "var(--ds-surface-2)",
          border: "1px solid var(--ds-border-soft)",
          marginBottom: 4,
        }}
      >
        <ProgressRing value={0.03} size={56} label="3%" />
        <div style={{ minWidth: 0 }}>
          <div className="ds-eyebrow" style={{ color: "var(--ds-accent)", marginBottom: 4 }}>
            초기 검증
          </div>
          <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>Day 1 / 30</div>
          <div style={{ fontSize: 11.5, color: "var(--ds-muted)", marginTop: 2 }}>게이트까지 D7</div>
        </div>
      </div>

      <MetaGroupLabel>오피스아워 · Day 1</MetaGroupLabel>
      <MetaRow glyph="scope" label="현재 단계" value="목표 확립" valueTone="accent" dot />
      <MetaRow glyph="checkmark.circle" label="스텝" value="1 / 3" />
      <MetaRow glyph="doc.text" label="기록 대상" value="GOAL.md" />
      <MetaRow glyph="clock" label="상태" value="확정 대기" valueTone="amber" dot />

      <MetaGroupLabel>30일 신호</MetaGroupLabel>
      <MetaRow glyph="bubble.left" label="인터뷰 원문" value="1 / 5" />
      <MetaRow glyph="megaphone.fill" label="공개 기록" value="0 / 14" />
      <MetaRow glyph="bolt.fill" label="오늘 호출" value="2 · $0.03" />
      <MetaRow glyph="calendar" label="D-30 목표일" value="2026-06-15" />
    </MetaPanel>
  );

  return (
    <div style={{ height, minHeight: 0 }}>
      <WorkspaceShell rail={rail} titlebar={titlebar} sidebar={sidebar} main={main} meta={meta} height={height} />
    </div>
  );
}

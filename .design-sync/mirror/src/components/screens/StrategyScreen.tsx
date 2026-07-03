import React from "react";
import { Tone, toneVars } from "../../tokens";
import { Badge } from "../Badge";
import { Card } from "../Card";
import { Icon } from "../Icon";
import { IconButton } from "../IconButton";
import { Avatar } from "../Avatar";
import { WorkspaceShell } from "../WorkspaceShell";
import { WorkspaceRail } from "../WorkspaceRail";
import { Titlebar } from "../reference/Titlebar";

/* ══════════════════════════════════════════════════════════════════════════
 * StrategyScreen — the Business Canvas / positioning surface.
 *
 * Faithful mirror of Strategy_Screen.png + Strategy_Matrix_Initial_Visual_QA.png:
 *   · a "WHY HERE" positioning banner (competitor context)
 *   · a 2×2 SWOT grid (Strengths / Weaknesses / Opportunities / Threats)
 *   · a strategy verdict block (전략 판단)
 *   · a business-model canvas strip (numbered blocks: RESOURCES / CHANNELS /
 *     COST STRUCTURE / REVENUE STREAMS)
 *   · a 2×2 competitive positioning matrix (competitor nodes on two axes) with
 *     a "SELECTED POSITION" side panel.
 *
 * Everything sits in the uniform WorkspaceShell (rail · titlebar · main).
 * ══════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────── small local building blocks ─────────────────────────── */

/** Main-column section header — tone marker bar + title + mono qualifier. */
function SectionMarker({
  title,
  qualifier,
  tone = "accent",
}: {
  title: React.ReactNode;
  qualifier?: React.ReactNode;
  tone?: Tone;
}) {
  const t = toneVars(tone);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 14 }}>
      <span style={{ width: 3, height: 15, borderRadius: "var(--ds-r-bar)", background: t.color, flex: "0 0 auto" }} />
      <span style={{ fontSize: "var(--ds-fs-section)", fontWeight: 600, color: "var(--ds-fg)" }}>{title}</span>
      {qualifier != null && (
        <span
          style={{
            fontFamily: "var(--ds-mono)",
            fontSize: "var(--ds-fs-caption)",
            letterSpacing: "0.04em",
            color: "var(--ds-muted)",
          }}
        >
          {qualifier}
        </span>
      )}
    </div>
  );
}

/** A single SWOT quadrant — tone-marked card, dotted bullet list, corner badge. */
interface SwotItem {
  /** Body text; bold segments come through as React nodes. */
  text: React.ReactNode;
}
function SwotCard({
  title,
  badge,
  tone,
  items,
}: {
  title: string;
  badge: string;
  tone: Tone;
  items: SwotItem[];
}) {
  const t = toneVars(tone);
  return (
    <Card marker tone={tone} padded>
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 14 }}>
        <span style={{ fontSize: "var(--ds-fs-section)", fontWeight: 700, color: "var(--ds-fg)" }}>{title}</span>
        <Badge tone={tone}>{badge}</Badge>
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 12 }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: "flex", gap: 10, alignItems: "flex-start" }}>
            <span
              style={{
                flex: "0 0 auto",
                width: 7,
                height: 7,
                marginTop: 6,
                borderRadius: "var(--ds-r-pill)",
                background: t.color,
              }}
            />
            <span style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", lineHeight: 1.55 }}>
              {it.text}
            </span>
          </li>
        ))}
      </ul>
    </Card>
  );
}

/** A numbered business-model canvas block — index + uppercase label, title, dashed list. */
function CanvasBlock({
  index,
  label,
  title,
  tone,
  items,
}: {
  index: string;
  label: string;
  title: string;
  tone: Tone;
  items: React.ReactNode[];
}) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-r-card)",
        boxShadow: "var(--ds-shadow-card)",
        overflow: "hidden",
        padding: "16px 16px 16px 18px",
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: t.color }} />
      <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 12, marginBottom: 10 }}>
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: "var(--ds-fs-label)", fontWeight: 700, color: "var(--ds-muted-deep)" }}>
          {index}
        </span>
        <span className="ds-eyebrow" style={{ letterSpacing: "var(--ds-track-label)" }}>
          {label}
        </span>
      </div>
      <div style={{ fontSize: "var(--ds-fs-section)", fontWeight: 700, color: "var(--ds-fg)", marginBottom: 12 }}>
        {title}
      </div>
      <ul style={{ listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 10 }}>
        {items.map((it, i) => (
          <li key={i} style={{ display: "flex", gap: 9, alignItems: "flex-start" }}>
            <span style={{ flex: "0 0 auto", color: t.color, fontWeight: 700, lineHeight: 1.4, marginTop: -1 }}>–</span>
            <span style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", lineHeight: 1.5 }}>{it}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ─────────────────────────── positioning matrix ─────────────────────────── */

interface MatrixNodeSpec {
  id: string;
  label: string;
  /** 0–1 horizontal position (0 = static/left, 1 = adaptive/right). */
  x: number;
  /** 0–1 vertical position (0 = build/bottom, 1 = evidence/top). */
  y: number;
  tone: Tone;
  /** Bigger accent pill node for the self / selected wedge. */
  selected?: boolean;
  /** Muted grey sublabel under the node. */
  sub?: string;
  /** Pink wedge annotation to the right (self only). */
  wedge?: { title: string; note: string };
}

/** One plotted competitor node — a dot (or accent pill) with a label. */
function MatrixNode({ node }: { node: MatrixNodeSpec }) {
  const t = toneVars(node.tone);
  const left = `${node.x * 100}%`;
  const top = `${(1 - node.y) * 100}%`;

  if (node.selected) {
    return (
      <div style={{ position: "absolute", left, top, transform: "translate(-50%, -50%)", display: "flex", alignItems: "center", gap: 8, whiteSpace: "nowrap" }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 26,
            padding: "0 12px",
            borderRadius: "var(--ds-r-pill)",
            background: t.dim,
            border: `1px solid ${t.color}`,
            color: t.color,
            fontSize: "var(--ds-fs-listname)",
            fontWeight: 700,
          }}
        >
          {node.label}
        </span>
        <span style={{ width: 12, height: 12, borderRadius: "var(--ds-r-pill)", background: t.color, boxShadow: `0 0 0 5px ${t.dim}` }} />
        {node.wedge != null && (
          <span style={{ display: "inline-flex", flexDirection: "column", gap: 3, marginLeft: 4 }}>
            <span
              style={{
                fontFamily: "var(--ds-mono)",
                fontSize: "var(--ds-fs-caption)",
                fontWeight: 700,
                letterSpacing: "0.06em",
                color: "var(--ds-magenta)",
              }}
            >
              {node.wedge.title}
            </span>
            <span style={{ fontFamily: "var(--ds-mono)", fontSize: "var(--ds-fs-caption)", color: "var(--ds-fg-secondary)" }}>
              {node.wedge.note}
            </span>
          </span>
        )}
        {node.sub != null && (
          <span
            style={{
              position: "absolute",
              left: 0,
              top: "calc(100% + 4px)",
              fontSize: "var(--ds-fs-caption)",
              fontWeight: 600,
              color: "var(--ds-fg-secondary)",
              whiteSpace: "nowrap",
            }}
          >
            {node.sub}
          </span>
        )}
      </div>
    );
  }

  return (
    <div style={{ position: "absolute", left, top, transform: "translate(-50%, -50%)", display: "flex", alignItems: "center", gap: 7, whiteSpace: "nowrap" }}>
      <span style={{ flex: "0 0 auto", width: 9, height: 9, borderRadius: "var(--ds-r-pill)", background: t.color }} />
      <span style={{ fontSize: "var(--ds-fs-trend)", color: "var(--ds-fg-secondary)" }}>{node.label}</span>
    </div>
  );
}

/** Muted mono quadrant caption, absolutely placed inside the plot. */
function QuadrantLabel({
  x,
  y,
  align = "left",
  title,
  note,
}: {
  x: string;
  y: string;
  align?: "left" | "center" | "right";
  title: string;
  note?: string;
}) {
  const transform =
    align === "center" ? "translateX(-50%)" : align === "right" ? "translateX(-100%)" : "none";
  return (
    <div style={{ position: "absolute", left: x, top: y, transform, textAlign: align, whiteSpace: "nowrap" }}>
      <div style={{ fontSize: "var(--ds-fs-trend)", color: "var(--ds-muted)" }}>{title}</div>
      {note != null && <div style={{ fontSize: "var(--ds-fs-trend)", color: "var(--ds-muted-deep)", marginTop: 2 }}>{note}</div>}
    </div>
  );
}

/** The plotted 2×2 positioning field — axes, quadrant captions, competitor nodes. */
function MatrixPlot({ nodes }: { nodes: MatrixNodeSpec[] }) {
  return (
    <div
      style={{
        position: "relative",
        flex: 1,
        minWidth: 0,
        height: 300,
        borderRadius: "var(--ds-r-card)",
        border: "1px solid var(--ds-border)",
        background: "radial-gradient(120% 120% at 62% 42%, var(--ds-accent-wash) 0%, transparent 60%), var(--ds-surface)",
        overflow: "hidden",
      }}
    >
      {/* center gridlines */}
      <span style={{ position: "absolute", left: "50%", top: 0, bottom: 0, width: 1, background: "var(--ds-border-soft)" }} />
      <span style={{ position: "absolute", top: "50%", left: 0, right: 0, height: 1, background: "var(--ds-border-soft)" }} />

      {/* top axis — the winning direction, accent */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          top: 14,
          transform: "translateX(-50%)",
          padding: "3px 10px",
          borderRadius: "var(--ds-r-chip)",
          background: "var(--ds-accent-dim)",
          fontFamily: "var(--ds-mono)",
          fontSize: "var(--ds-fs-trend)",
          fontWeight: 600,
          color: "var(--ds-accent)",
          whiteSpace: "nowrap",
        }}
      >
        ↑ PMF Evidence · 고객 행동 · 첫 매출
      </div>

      {/* bottom axis — the losing direction, muted */}
      <div
        style={{
          position: "absolute",
          left: "50%",
          bottom: 14,
          transform: "translateX(-50%)",
          fontFamily: "var(--ds-mono)",
          fontSize: "var(--ds-fs-trend)",
          color: "var(--ds-muted)",
          whiteSpace: "nowrap",
        }}
      >
        Build Speed · 코드 생산 ↓
      </div>

      {/* quadrant captions */}
      <QuadrantLabel x="8%" y="30%" title="검증/교육" note="증거는 있으나 정적" />
      <QuadrantLabel x="92%" y="30%" align="right" title="AI 빌드 도구" note="적용은 하나 PMF 밖" />
      <QuadrantLabel x="8%" y="64%" title="콘텐츠/학습" note="빌드·소비 중심" />

      {/* plotted nodes */}
      {nodes.map((n) => (
        <MatrixNode key={n.id} node={n} />
      ))}
    </div>
  );
}

/** Right "SELECTED POSITION" detail rail beside the plot. */
function SelectedPositionPanel({
  name,
  title,
  summary,
  tone = "accent",
}: {
  name: string;
  title: string;
  summary: string;
  tone?: Tone;
}) {
  const t = toneVars(tone);
  return (
    <div style={{ flex: "0 0 232px", width: 232, display: "flex", flexDirection: "column", gap: 14, paddingTop: 4 }}>
      <div className="ds-eyebrow" style={{ letterSpacing: "var(--ds-track-label)" }}>
        Selected position
      </div>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          height: 34,
          padding: "0 14px",
          borderRadius: "var(--ds-r-pill)",
          background: t.dim,
          border: `1px solid ${t.color}`,
          fontFamily: "var(--ds-mono)",
          fontSize: "var(--ds-fs-body)",
          fontWeight: 600,
          color: t.color,
        }}
      >
        {name}
      </div>
      <div>
        <div style={{ fontSize: "var(--ds-fs-kpi)", fontWeight: 700, color: t.color, lineHeight: 1.1, letterSpacing: "var(--ds-track-tight)" }}>
          {title}
        </div>
        <div style={{ fontFamily: "var(--ds-mono)", fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", marginTop: 10 }}>
          {summary}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── content data ─────────────────────────── */

const STRENGTHS: SwotItem[] = [
  { text: <>차별 축이 명확합니다. AI 코딩 속도가 아니라 <b style={{ color: "var(--ds-fg)" }}>paid ask, first_value, activation evidence</b>를 다룹니다.</> },
  { text: <>local-first 맥락으로 프로젝트 path, transcript, BIP, 업무 일지, 선택적 PostHog 지표를 직접 연결할 수 있습니다.</> },
  { text: <>ICP가 좁습니다. 전업 1인 개발자, 첫 매출 전, macOS, AI 코딩 도구 사용, 기록 제출 의향.</> },
  { text: <>30일 program spec에 proof-ledger, gate engine, Day 14 measurement가 명시되어 있어 제품 행동과 전략 문장이 맞닿아 있습니다.</> },
];

const WEAKNESSES: SwotItem[] = [
  { text: <><b style={{ color: "var(--ds-fg)" }}>private pilot</b> 단계라 반복 사용 데이터, paid ask 응답률, activation 이벤트 수신 데이터가 아직 부족합니다.</> },
  { text: <>macOS + Node/provider 셋업은 강한 차별이지만 온보딩 마찰입니다.</> },
  { text: <>기록 의존 제품입니다. 사용자가 transcript와 업무 일지를 남기지 않으면 가치가 약해집니다.</> },
  { text: <>수익 모델이 미확정입니다. cohort, 구독, pilot-specific offer 중 돈이 되는 축을 paid ask로 좁혀야 합니다.</> },
];

const OPPORTUNITIES: SwotItem[] = [
  { text: <>Stack Overflow와 GitHub 데이터는 AI coding이 이미 개발자 기본 도구가 되었음을 보여줍니다.</> },
  { text: <>한국어 시장 빈자리가 있습니다. 영어권 startup school과 범용 콘텐츠는 로컬 실행 맥락이 약합니다.</> },
  { text: <>private pilot evidence를 축적하면 강의가 아닌 제품으로 포지셔닝할 수 있습니다.</> },
  { text: <>Cursor/Replit/Lovable가 빌드 속도를 올릴수록 고객 증거와 수익 판단 OS의 필요가 더 선명해집니다.</> },
];

const THREATS: SwotItem[] = [
  { text: <>코딩 도구가 planning/PMF 기능을 흡수하면 차별 서사가 약해질 수 있습니다.</> },
  { text: <>커뮤니티와 강의 프로그램은 신뢰, 네트워크, accountability를 이미 갖고 있습니다.</> },
  { text: <>개인 기록/프로젝트 접근은 privacy 우려와 배포 제한을 동반합니다.</> },
  { text: <>paid ask, PostHog first_value, 결제 기록이 쌓이지 않으면 전략 화면은 여전히 가설 문서에 머뭅니다.</> },
];

const MATRIX_NODES: MatrixNodeSpec[] = [
  { id: "markettest", label: "마켓테스트", x: 0.33, y: 0.56, tone: "rose" },
  { id: "startupschool", label: "startup school", x: 0.44, y: 0.28, tone: "amber" },
  {
    id: "agentic30",
    label: "Agentic30",
    x: 0.62,
    y: 0.5,
    tone: "accent",
    selected: true,
    sub: "1canpreneur",
    wedge: { title: "AGENTIC30 WEDGE", note: "기록 기반 PMF 루프" },
  },
];

/* ─────────────────────────── screen ─────────────────────────── */

export interface StrategyScreenProps {
  /** Fixed pixel height for the framed window (fills its container otherwise). */
  height?: number;
}

/** Faithful mirror of the Strategy (Business Canvas) window. */
export function StrategyScreen({ height = 900 }: StrategyScreenProps) {
  const rail = (
    <WorkspaceRail
      items={[
        { icon: "calendar", title: "오늘" },
        { icon: "play.rectangle.on.rectangle", title: "Founder Replay" },
        { icon: "chart.line.uptrend.xyaxis", title: "전략", active: true },
        { icon: "newspaper", title: "뉴스", locked: true },
        { icon: "sunrise", title: "아침 브리핑", locked: true },
        { icon: "gearshape", title: "설정" },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" />}
    />
  );

  const titlebar = (
    <Titlebar
      breadcrumb={{ page: "전략", detail: "Business Canvas · 경쟁 구도" }}
      actions={<IconButton aria-label="검색" icon={<Icon name="magnifyingglass" size={15} title="" />} />}
    />
  );

  const whyHere = (
    <Card>
      <div style={{ display: "flex", gap: 20, flexWrap: "wrap" }}>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "baseline", gap: 12, flexWrap: "wrap" }}>
            <span style={{ fontSize: "var(--ds-fs-section)", fontWeight: 700, color: "var(--ds-fg)" }}>startup school</span>
            <span style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)" }}>콘텐츠/학습 · 빌드·소비 중심</span>
          </div>
          <div style={{ marginTop: 12, height: 1, background: "var(--ds-border-soft)" }} />
          <div style={{ display: "flex", gap: 24, marginTop: 12, fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)" }}>
            <span>AI 빌드 도구 · 적용은 하나 PMF 밖</span>
          </div>
        </div>
        <div style={{ flex: "1 1 300px", minWidth: 0 }}>
          <div className="ds-eyebrow" style={{ letterSpacing: "var(--ds-track-label)", marginBottom: 8 }}>
            Why here
          </div>
          <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", lineHeight: 1.6 }}>
            YC의 무료 온라인 창업 과정입니다. YC 지식, weekly progress accountability, co-founder matching을 제공합니다. PMF 개념과 실행 압박은 있지만 한국어 1인 개발자의 로컬 기록 기반 loop는 아닙니다.
          </div>
          <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12, fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)" }}>
            <Icon name="arrow.up.right" size={13} title="" />
            <span>근거 링크 열기</span>
            <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
            <span style={{ fontFamily: "var(--ds-mono)", color: "var(--ds-fg-secondary)" }}>startupschool.org</span>
          </div>
        </div>
      </div>
    </Card>
  );

  const swot = (
    <section style={{ marginTop: 28 }}>
      <SectionMarker title="SWOT 분석" qualifier="internal / external" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <SwotCard title="Strengths" badge="내부 강점" tone="accent" items={STRENGTHS} />
        <SwotCard title="Weaknesses" badge="내부 약점" tone="amber" items={WEAKNESSES} />
        <SwotCard title="Opportunities" badge="외부 기회" tone="sky" items={OPPORTUNITIES} />
        <SwotCard title="Threats" badge="외부 위협" tone="rose" items={THREATS} />
      </div>
    </section>
  );

  const verdict = (
    <section style={{ marginTop: 28 }}>
      <Card marker tone="accent">
        <div style={{ fontSize: "var(--ds-fs-section)", fontWeight: 700, color: "var(--ds-fg)", marginBottom: 10 }}>
          전략 판단
        </div>
        <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", lineHeight: 1.65 }}>
          Agentic30은 AI 코파운더나 코딩 assistant로 넓히면 Cursor, Replit, Lovable 같은 빌드 도구와 정면 충돌합니다. 더 강한 포지션은 전업 1인 개발자가 이미 가진 AI 코딩 레버리지를 전제로, local-first macOS assistant가 로컬 실행 기록에서{" "}
          <b style={{ color: "var(--ds-fg)" }}>paid ask, first_value, PostHog activation, continue/pivot/stop 판단 증거</b>를 만드는 것입니다. public launch는 확정 사업 모델이 아니라 private pilot 증거로 좁혀야 합니다.
        </div>
      </Card>
    </section>
  );

  const canvas = (
    <section style={{ marginTop: 28 }}>
      <SectionMarker title="비즈니스 모델 캔버스" qualifier="business model canvas" tone="violet" />
      <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 16 }}>
        <CanvasBlock
          index="06"
          label="Resources"
          title="핵심 자원"
          tone="sky"
          items={[
            "SwiftUI 앱, Node sidecar, session store",
            "30일 adaptive program, proof-ledger, gate engine 명세",
            "익명화된 외부 ICP 인터뷰와 private pilot feedback 요약",
            "창업자 dogfood 기록, BIP proof, public-safe strategy source sheet",
          ]}
        />
        <CanvasBlock
          index="03"
          label="Channels"
          title="채널"
          tone="accent"
          items={[
            "초기: 외부 ICP 인터뷰와 private pilot 직접 모집",
            "확장: 개발자 커뮤니티, Threads, IndieFounders, Claude/Codex 생태계",
            "제품 배포: Developer ID PKG / DMG 직접 배포",
            "증거 채널: BIP, landing, DM, 인터뷰 transcript, PostHog",
          ]}
        />
        <CanvasBlock
          index="09"
          label="Cost structure"
          title="비용 구조"
          tone="rose"
          items={[
            "AI provider 호출 비용과 긴 분석 context 관리",
            "macOS 배포, 서명, 진단, setup support",
            "초기 pilot의 founder-led evidence review 시간",
            "공개 경쟁 데이터와 source sheet를 최신으로 유지하는 비용",
          ]}
        />
        <CanvasBlock
          index="05"
          label="Revenue streams"
          title="수익원 가설"
          tone="amber"
          items={[
            "현재: pilot-specific offer와 paid ask 반응 확인 전 단계",
            "가설 A: 30일 검증 스프린트 유료 cohort",
            "가설 B: macOS assistant 월 구독 + provider BYOK",
            "검증 기준: 관심이 아니라 결제완료, 예약판매, 명시적 가격 거절",
          ]}
        />
      </div>
    </section>
  );

  const matrix = (
    <section style={{ marginTop: 28 }}>
      <SectionMarker title="2x2 경쟁 구도 Matrix" qualifier="positioning · click points" />
      <Card>
        <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 16, marginBottom: 14 }}>
          <div style={{ fontSize: "var(--ds-fs-amount)", fontWeight: 700, color: "var(--ds-fg)" }}>
            경쟁은 코딩 생산성 축이 아니라 <span style={{ color: "var(--ds-accent)" }}>PMF 증거</span> 축에서 갈립니다.
          </div>
          <div
            style={{
              flex: "0 0 auto",
              fontFamily: "var(--ds-mono)",
              fontSize: "var(--ds-fs-caption)",
              color: "var(--ds-muted)",
              textAlign: "right",
              lineHeight: 1.5,
            }}
          >
            가로: 정적 -&gt; Adaptive · 세로: Build -&gt; Evidence
          </div>
        </div>
        <div style={{ display: "flex", gap: 24, alignItems: "stretch" }}>
          <MatrixPlot nodes={MATRIX_NODES} />
          <SelectedPositionPanel
            name="Agentic30"
            title="Agentic30"
            summary="local-first 30일 PMF·첫 매출 시스템"
          />
        </div>
      </Card>
    </section>
  );

  const main = (
    <>
      {whyHere}
      {swot}
      {verdict}
      {canvas}
      {matrix}
    </>
  );

  return (
    <div style={{ height, minHeight: 0 }}>
      <WorkspaceShell rail={rail} titlebar={titlebar} main={main} mainMaxWidth={980} />
    </div>
  );
}

import React from "react";
import { Tone, toneVars } from "../../tokens";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Chip } from "../Chip";
import { Input } from "../Input";
import { ProgressBar } from "../ProgressBar";
import { Rail } from "./Rail";
import { SideRow } from "./SideRow";
import { ReferenceSidebar } from "./ReferenceSidebar";
import { Titlebar } from "./Titlebar";
import { ReferenceHeader } from "./ReferenceHeader";
import { RefSection } from "./RefSection";
import { FilterTabs } from "./FilterTabs";
import { MetaPanel } from "./MetaPanel";
import { ReferenceShell } from "./ReferenceShell";

/* ────────────────────────── small local building blocks ────────────────────────── */

/** Mono metric pill in the brief banner ("X 원문 1", "강한 적합 1", "Day 1"). */
function BipMetricPill({ title, count, tone }: { title: string; count: string; tone: Tone }) {
  const isMuted = tone === "muted";
  const t = toneVars(tone);
  const color = isMuted ? "var(--ds-fg-secondary)" : t.color;
  const valueColor = isMuted ? "var(--ds-fg)" : t.color;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 25,
        padding: "0 10px",
        borderRadius: "var(--ds-r-pill)",
        fontFamily: "var(--ds-mono)",
        fontSize: 10.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        color,
        background: isMuted ? "var(--ds-bg-deep)" : t.dim,
        border: `1px solid ${isMuted ? "var(--ds-border-soft)" : t.line}`,
      }}
    >
      {title}
      <span style={{ fontWeight: 600, color: valueColor }}>{count}</span>
    </span>
  );
}

/** Numbered signal row in the "고객 후보 신호" sidebar group. */
function SignalLeading({ label, tone }: { label: string; tone: Tone }) {
  const t = toneVars(tone);
  return (
    <span
      style={{
        width: 30,
        height: 30,
        flex: "0 0 auto",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--ds-r-control)",
        fontFamily: "var(--ds-mono)",
        fontSize: 11,
        fontWeight: 600,
        color: t.color,
        background: t.dim,
        border: `1px solid ${t.line}`,
      }}
    >
      {label}
    </span>
  );
}

/** "왜 후보인가" / "오늘의 사용처" evidence sub-column inside the candidate card. */
function Evidence({ title, body }: { title: string; body: React.ReactNode }) {
  return (
    <div
      style={{
        flex: 1,
        minWidth: 0,
        paddingTop: 10,
        borderTop: "1px solid var(--ds-border-soft)",
      }}
    >
      <div className="ds-eyebrow" style={{ marginBottom: 5 }}>
        {title}
      </div>
      <div style={{ fontSize: 12.5, color: "var(--ds-fg-secondary)", lineHeight: 1.5 }}>{body}</div>
    </div>
  );
}

/** Uppercase group label inside the meta panel. */
function MetaGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-eyebrow" style={{ margin: "18px 0 8px" }}>
      {children}
    </div>
  );
}

/** Glyph · label · value KV row in the meta panel. */
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

/* ─────────────────────────────── page ─────────────────────────────── */

export interface BipLogReferencePageProps {
  /** Fixed pixel height for the framed window (the shell fills its container otherwise). */
  height?: number;
}

/** Faithful mirror of OpenDesign_BIP_Wide.png — 공개 기록 · 고객 후보 리서치. */
export function BipLogReferencePage({ height = 900 }: BipLogReferencePageProps) {
  const rail = (
    <Rail
      items={[
        { icon: "▦" },
        { icon: "▷" },
        { icon: "◫" },
        { icon: "▤" },
        { icon: "◈", active: true, dot: true },
        { icon: "◵" },
        { icon: "⚙" },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" />}
    />
  );

  const sidebar = (
    <ReferenceSidebar
      title="리서치 필터"
      groups={[
        {
          label: "소스",
          count: "5",
          rows: [
            <SideRow
              active
              leading={<SignalLeading label="▣" tone="accent" />}
              title="전체"
              badge={<Badge neutral>1</Badge>}
            />,
            <SideRow
              leading={<SignalLeading label="✓" tone="accent" />}
              title="강한 적합"
              badge={<Badge neutral>1</Badge>}
            />,
            <SideRow
              leading={<SignalLeading label="X" tone="sky" />}
              title="X / Twitter"
              badge={<Badge neutral>1</Badge>}
            />,
            <SideRow
              leading={<SignalLeading label="@" tone="violet" />}
              title="Threads (Meta)"
              badge={<Badge neutral>0</Badge>}
            />,
            <SideRow
              leading={<SignalLeading label="◎" tone="pink" />}
              title="Instagram"
              badge={<Badge neutral>0</Badge>}
            />,
            <SideRow
              leading={<SignalLeading label="!" tone="amber" />}
              title="워치리스트"
              badge={<Badge neutral>0</Badge>}
            />,
          ],
        },
        {
          label: "고객 후보 신호",
          count: "2",
          rows: [
            <SideRow
              leading={<SignalLeading label="01" tone="accent" />}
              title="공개 소셜 기록"
              subtitle="X/Twitter · Threads…"
              badge={<Badge tone="accent">READY</Badge>}
            />,
            <SideRow
              leading={<SignalLeading label="03" tone="amber" />}
              title="확인할 공백"
              subtitle="결제 의향과 현재 대안"
              badge={<Badge tone="amber">ASK</Badge>}
            />,
          ],
        },
      ]}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
          <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between" }}>
            <span style={{ fontSize: 12, color: "var(--ds-muted)" }}>고객 후보</span>
            <span style={{ display: "flex", alignItems: "baseline", gap: 4 }}>
              <span style={{ fontFamily: "var(--ds-mono)", fontSize: 14, fontWeight: 700, color: "var(--ds-accent)" }}>
                1
              </span>
              <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11, color: "var(--ds-muted)" }}>/ 14</span>
            </span>
          </div>
          <ProgressBar value={1 / 14} tone="accent" />
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 11.5, color: "var(--ds-muted)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
            다음 액션 <span style={{ color: "var(--ds-fg-secondary)" }}>상위 후보</span> · DM 후보화
          </div>
        </div>
      }
    />
  );

  const titlebar = <Titlebar breadcrumb={{ page: "공개 기록", detail: "웹 자료 검색 · X/Twitter · Threads(Meta)" }} />;

  const header = (
    <ReferenceHeader
      icon={<Avatar initials="◫" size={56} tone="accent" />}
      title="공개 기록 · 고객 후보 리서치"
      badge={<Badge tone="accent">공개 기록</Badge>}
      subtitleParts={["웹 자료 검색 + 원문 확인", "후보 1명", "Day 1", "UI 테스트 fixture"]}
      actions={
        <>
          <Button variant="ghost" size="sm" icon={<span>▤</span>}>
            초안
          </Button>
          <Button variant="primary" size="sm" icon={<span>⟳</span>}>
            다시 리서치
          </Button>
        </>
      }
    />
  );

  const filterRow = (
    <div style={{ display: "flex", alignItems: "flex-end", gap: 16 }}>
      <div style={{ flex: 1, minWidth: 0 }}>
        <FilterTabs
          tabs={["전체 1", "강한 적합 1", "X 1", "Threads(Meta) 0", "Instagram 0", "워치리스트 0"]}
          value="전체 1"
        />
      </div>
      <div style={{ flex: "0 0 240px", paddingBottom: 6 }}>
        <Input placeholder="고객 후보 증거 검색" icon={<span>⌕</span>} />
      </div>
    </div>
  );

  /* Brief banner — 자동 리서치 → 후보 1 → exa> query line → metric pills. */
  const briefBanner = (
    <div
      style={{
        position: "relative",
        padding: "18px 20px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        overflow: "hidden",
      }}
    >
      <span
        style={{
          position: "absolute",
          top: 0,
          left: "20%",
          right: "20%",
          height: 1,
          background: "var(--ds-accent-line)",
        }}
      />
      <div style={{ display: "flex", alignItems: "flex-start", gap: 18 }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div className="ds-eyebrow" style={{ marginBottom: 7, color: "var(--ds-accent)" }}>
            자동 리서치
          </div>
          <div style={{ fontSize: 20, fontWeight: 400, color: "var(--ds-fg)", lineHeight: 1.35 }}>
            공개 기록으로 고객 후보를 좁힙니다
          </div>
          <div style={{ marginTop: 8, fontSize: 13, color: "var(--ds-fg-secondary)", lineHeight: 1.5 }}>
            UI 테스트 fixture는 공개 실행 기록, 고객 후보 근거, DM 초안 패널이 동시에 렌더되는지 검증합니다.
          </div>
        </div>
        <div
          style={{
            flex: "0 0 auto",
            minWidth: 170,
            display: "flex",
            flexDirection: "column",
            alignItems: "flex-end",
            gap: 4,
            fontFamily: "var(--ds-mono)",
            fontSize: 10.5,
            color: "var(--ds-muted)",
          }}
        >
          <span>후보</span>
          <span style={{ fontSize: 18, fontWeight: 700, color: "var(--ds-fg)" }}>1</span>
          <span>강한 적합 1 · 관심 후보 0</span>
        </div>
      </div>

      <div
        style={{
          display: "flex",
          alignItems: "baseline",
          gap: 9,
          marginTop: 13,
          padding: "10px 12px",
          borderRadius: "var(--ds-r-control)",
          background: "var(--ds-bg-deep)",
          border: "1px solid var(--ds-border-soft)",
          fontFamily: "var(--ds-mono)",
          fontSize: 11,
        }}
      >
        <span style={{ color: "var(--ds-accent)" }}>exa&gt;</span>
        <span style={{ color: "var(--ds-fg-secondary)" }}>SpeakMac 공개 기록 · 1인 빌더 · macOS AI 도구</span>
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 7, marginTop: 13 }}>
        <BipMetricPill title="X 원문" count="1" tone="sky" />
        <BipMetricPill title="Threads(Meta) 원문" count="0" tone="violet" />
        <BipMetricPill title="Instagram 원문" count="0" tone="pink" />
        <BipMetricPill title="강한 적합" count="1" tone="accent" />
        <BipMetricPill title="확인 필요" count="0" tone="amber" />
        <BipMetricPill title="Day" count="1" tone="muted" />
      </div>
    </div>
  );

  /* Candidate card — SpeakMac fixture. */
  const candidateCard = (
    <div
      style={{
        padding: 16,
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        boxShadow: "var(--ds-shadow-card)",
        display: "flex",
        flexDirection: "column",
        gap: 12,
      }}
    >
      {/* head: score tile · title/meta · source badge */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
        <div
          style={{
            flex: "0 0 auto",
            width: 54,
            height: 54,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: 2,
            borderRadius: "var(--ds-r-card)",
            background: "var(--ds-accent-dim)",
            border: "1px solid var(--ds-accent-line)",
            color: "var(--ds-accent)",
            textAlign: "center",
          }}
        >
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 14, fontWeight: 700 }}>강한 적합</span>
          <span
            style={{
              fontFamily: "var(--ds-mono)",
              fontSize: 8,
              letterSpacing: "0.04em",
              textTransform: "uppercase",
              color: "var(--ds-muted)",
              lineHeight: 1.1,
              padding: "0 4px",
            }}
          >
            macOS AI workflow와 공개 실행…
          </span>
        </div>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 15, fontWeight: 500, color: "var(--ds-fg)", lineHeight: 1.3 }}>
            SpeakMac을 쓰는 1인 macOS 빌더
          </div>
          <div
            style={{
              display: "flex",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 7,
              marginTop: 4,
              fontFamily: "var(--ds-mono)",
              fontSize: 10.5,
              color: "var(--ds-muted)",
            }}
          >
            <span style={{ fontWeight: 600, color: "var(--ds-fg-secondary)" }}>@speakmac</span>
            <span>·</span>
            <span>2026-06-10</span>
            <span>·</span>
            <span>public_post</span>
          </div>
        </div>
        <span
          style={{
            flex: "0 0 auto",
            display: "inline-flex",
            alignItems: "center",
            height: 24,
            padding: "0 9px",
            borderRadius: "var(--ds-r-pill)",
            border: "1px solid var(--ds-border-soft)",
            fontFamily: "var(--ds-mono)",
            fontSize: 10,
            letterSpacing: "0.04em",
            textTransform: "uppercase",
            color: "var(--ds-muted)",
          }}
        >
          X / Twitter
        </span>
      </div>

      {/* tags */}
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
        <Chip label="macOS" tone="sky" />
        <Chip label="1인 빌더" tone="accent" active />
        <Chip label="결제 질문 필요" tone="amber" />
      </div>

      {/* quote */}
      <div
        style={{
          position: "relative",
          padding: "13px 14px",
          borderRadius: "var(--ds-r-control)",
          background: "var(--ds-bg-deep)",
          border: "1px solid var(--ds-border-soft)",
          borderLeft: "2px solid var(--ds-accent-line)",
          fontSize: 13,
          color: "var(--ds-fg)",
          lineHeight: 1.5,
        }}
      >
        메뉴바에서 바로 음성 입력과 AI 작업을 이어가는 흐름을 만들고 있다.
      </div>

      {/* evidence pair */}
      <div style={{ display: "flex", gap: 10 }}>
        <Evidence
          title="왜 후보인가"
          body="혼자 제품을 만들고 있으며 macOS 자동화와 AI 도구 사용 맥락이 Agentic30의 Day 1 검증 질문과 맞습니다."
        />
        <Evidence title="오늘의 사용처" body="DM으로 현재 고객 검증 루틴과 지불 의향을 확인합니다." />
      </div>

      {/* gap warning */}
      <div
        style={{
          padding: "9px 11px",
          borderRadius: "var(--ds-r-control)",
          background: "var(--ds-warning-dim)",
          border: "1px solid var(--ds-warning-line)",
          fontSize: 12,
          color: "var(--ds-fg-secondary)",
          lineHeight: 1.45,
        }}
      >
        실제 결제 의향과 반복 사용 빈도는 아직 확인되지 않았습니다.
      </div>

      {/* actions */}
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 28,
            padding: "0 11px",
            borderRadius: "var(--ds-r-control)",
            background: "var(--ds-accent)",
            border: "1px solid var(--ds-accent-line)",
            color: "var(--ds-accent-ink)",
            fontSize: 11.5,
            fontWeight: 500,
          }}
        >
          초안 반영됨
        </span>
        <span
          style={{
            display: "inline-flex",
            alignItems: "center",
            height: 28,
            padding: "0 11px",
            borderRadius: "var(--ds-r-control)",
            background: "transparent",
            border: "1px solid var(--ds-border-soft)",
            color: "var(--ds-fg-secondary)",
            fontSize: 11.5,
            fontWeight: 500,
          }}
        >
          원문 열기
        </span>
      </div>
    </div>
  );

  /* Draft panel — selected candidate draft. */
  const draftPanel = (
    <div
      style={{
        padding: 16,
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        boxShadow: "var(--ds-shadow-card)",
      }}
    >
      <div style={{ fontSize: 15, fontWeight: 500, color: "var(--ds-fg)", marginBottom: 10 }}>
        @speakmac · 공개 기록 초안
      </div>
      <div
        style={{
          padding: "13px 14px",
          borderRadius: "var(--ds-r-control)",
          background: "var(--ds-bg-deep)",
          border: "1px solid var(--ds-border-soft)",
          fontFamily: "var(--ds-mono)",
          fontSize: 12,
          color: "var(--ds-fg-secondary)",
          lineHeight: 1.6,
          whiteSpace: "pre-wrap",
        }}
      >
        안녕하세요. macOS에서 AI 작업을 반복하는 흐름을 만들고 계신 걸 봤습니다. 지금 고객 검증이나 결제 의향 확인을 어떤
        방식으로 관리하는지 10분만 여쭤봐도 될까요?
      </div>
      <div style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 12 }}>
        <Button variant="primary" size="sm" icon={<span>⧉</span>}>
          초안 복사
        </Button>
        <Button variant="ghost" size="sm">
          선택 해제
        </Button>
      </div>
    </div>
  );

  const main = (
    <>
      {header}
      <div style={{ paddingBottom: 4 }}>{filterRow}</div>

      <RefSection title="고객 후보 리서치 큐" subtitle="웹 자료 검색 + 원문 확인 · X/Threads" markerTone="accent">
        {briefBanner}
      </RefSection>

      <RefSection
        title="리서치된 게시글"
        subtitle="원문 하이라이트 + 고객 후보 근거"
        markerTone="sky"
        count={
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11, color: "var(--ds-muted)" }}>
            정렬 · 고객 후보 적합도순
          </span>
        }
      >
        {candidateCard}
      </RefSection>

      <RefSection title="공개 기록 초안" subtitle="선택 후보를 기반으로 자동 생성" markerTone="amber">
        {draftPanel}
      </RefSection>
    </>
  );

  /* Meta panel — 고객 후보. */
  const candidateBanner = (
    <div
      style={{
        padding: "14px 15px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface-2)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
        <span style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 22, fontWeight: 700, color: "var(--ds-fg)" }}>0</span>
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 12, color: "var(--ds-muted)" }}>/ 18 후보</span>
        </span>
        <Badge tone="accent" dot>
          LIVE
        </Badge>
      </div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--ds-fg-secondary)" }}>다음 액션 · Exa 리서치 실행</div>
      <div style={{ marginTop: 8, fontSize: 12, color: "var(--ds-muted)", lineHeight: 1.5 }}>
        수익 상태, 전업 여부, 인터뷰 의향 공백을 확인하면 인터뷰 큐로 승격합니다.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, marginTop: 12 }}>
        <Chip label="live" tone="accent" active />
        <Chip label="gap" tone="amber" />
        <Chip label="ask" tone="sky" />
      </div>
    </div>
  );

  const meta = (
    <MetaPanel title="고객 후보">
      {candidateBanner}

      <MetaGroupLabel>리서치 상태</MetaGroupLabel>
      <MetaRow glyph="◉" label="리서치 소스" value="live" valueTone="accent" dot />
      <MetaRow glyph="◫" label="X 원문" value="1" valueTone="sky" />
      <MetaRow glyph="@" label="Threads(Meta)" value="0" />
      <MetaRow glyph="✓" label="강한 적합" value="1 / 1" valueTone="accent" />
      <MetaRow glyph="!" label="확인 필요" value="0" />
      <MetaRow glyph="◵" label="마지막 리서치" value="방금" />

      <MetaGroupLabel>확인할 공백</MetaGroupLabel>
      <MetaRow glyph="₩" label="결제 의향" value="미확인" valueTone="amber" dot />
      <MetaRow glyph="◔" label="반복 사용 빈도" value="미확인" valueTone="amber" dot />
      <MetaRow glyph="◐" label="현재 대안" value="DM 예정" valueTone="sky" />

      <MetaGroupLabel>빠른 액션</MetaGroupLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8, marginTop: 4 }}>
        <Button variant="primary" fullWidth size="sm" icon={<span>›</span>}>
          DM 후보로 보내기
        </Button>
        <Button variant="ghost" fullWidth size="sm" icon={<span>⟳</span>}>
          다시 리서치 실행
        </Button>
      </div>
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

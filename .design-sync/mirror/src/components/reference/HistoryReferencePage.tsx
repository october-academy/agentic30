import React from "react";
import { Tone, toneVars } from "../../tokens";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { ProgressBar } from "../ProgressBar";
import { Rail } from "./Rail";
import { Titlebar } from "./Titlebar";
import { ReferenceShell } from "./ReferenceShell";

/* ────────────────────────── shared token expressions ────────────────────────── */

const VERDICT = { label: "루프 닫기", tone: "amber" as Tone }; // close_loop
const CONFIDENCE_HIGH = { label: "신뢰도 높음", color: "var(--ds-accent)" };
const CONFIDENCE_MED = { label: "신뢰도 중간", color: "var(--ds-warning)" };

/* ────────────────────────── sidebar building blocks (좌측) ────────────────────────── */

/** "이번 주" 주간 합계 stat row — label · mono value. */
function StatRow({ label, value, accent }: { label: string; value: string; accent?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ds-muted)" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--ds-mono)",
          fontSize: 12.5,
          fontWeight: 600,
          color: accent ? "var(--ds-accent)" : "var(--ds-fg)",
        }}
      >
        {value}
      </span>
    </div>
  );
}

/** 집중 / 판단 / 미분류 focus row — tone-outlined tile. */
function FocusRow({
  label,
  value,
  detail,
  tone,
}: {
  label: string;
  value: string;
  detail: string;
  tone: Tone;
}) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 5,
        padding: 12,
        borderRadius: "var(--ds-r-control)",
        background: "var(--ds-surface)",
        border: `1px solid ${t.line}`,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            fontFamily: "var(--ds-mono)",
            fontSize: 10,
            fontWeight: 500,
            letterSpacing: "var(--ds-track-eyebrow)",
            textTransform: "uppercase",
            color: t.color,
          }}
        >
          {label}
        </span>
        <span style={{ flex: 1 }} />
        <span style={{ width: 5, height: 5, borderRadius: 999, background: t.color }} />
      </div>
      <span
        style={{
          fontSize: 12,
          fontWeight: 600,
          color: "var(--ds-fg)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {value}
      </span>
      <span
        style={{
          fontFamily: "var(--ds-mono)",
          fontSize: 10.5,
          fontWeight: 500,
          color: "var(--ds-muted)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {detail}
      </span>
    </div>
  );
}

/** 집중 영역 rank row — name · minutes · bar · commit/confidence. */
function AreaRankRow({
  name,
  minutes,
  ratio,
  commits,
  confidence,
}: {
  name: string;
  minutes: string;
  ratio: number;
  commits: number;
  confidence: { label: string; color: string };
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 12,
        borderRadius: "var(--ds-r-control)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
        <span
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ds-fg)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {name}
        </span>
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11, fontWeight: 600, color: "var(--ds-fg-secondary)" }}>
          {minutes}
        </span>
      </div>
      <ProgressBar value={ratio} tone="accent" height={4} />
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 6,
          fontFamily: "var(--ds-mono)",
          fontSize: 10,
          fontWeight: 500,
          color: "var(--ds-muted)",
        }}
      >
        <span>커밋 {commits}건</span>
        <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
        <span style={{ color: confidence.color }}>{confidence.label}</span>
      </div>
    </div>
  );
}

/** Small uppercase mono section label used in sidebar + meta groups. */
function GroupLabel({ children, style }: { children: React.ReactNode; style?: React.CSSProperties }) {
  return (
    <div
      style={{
        fontFamily: "var(--ds-mono)",
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: "var(--ds-track-eyebrow)",
        textTransform: "uppercase",
        color: "var(--ds-muted-deep)",
        padding: "0 4px",
        ...style,
      }}
    >
      {children}
    </div>
  );
}

/* ────────────────────────── main building blocks (중앙) ────────────────────────── */

/** 핵심 인사이트 card — claim · confidence · why · evidence refs. */
function InsightCard({
  claim,
  confidence,
  why,
  evidence,
}: {
  claim: string;
  confidence: { label: string; color: string };
  why: string;
  evidence: string[];
}) {
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 6,
        padding: 12,
        borderRadius: "var(--ds-r-control)",
        background: "var(--ds-page)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
        <span style={{ flex: 1, minWidth: 0, fontSize: 12.5, fontWeight: 600, color: "var(--ds-fg)", lineHeight: 1.4 }}>
          {claim}
        </span>
        <span
          style={{
            flex: "0 0 auto",
            fontFamily: "var(--ds-mono)",
            fontSize: 9.5,
            fontWeight: 600,
            color: confidence.color,
            whiteSpace: "nowrap",
          }}
        >
          {confidence.label}
        </span>
      </div>
      <span style={{ fontSize: 11.5, color: "var(--ds-fg-secondary)", lineHeight: 1.45 }}>{why}</span>
      <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)" }}>
        근거 · {evidence.join(" · ")}
      </span>
    </div>
  );
}

/** 리스크 row — severity capsule · reason · evidence refs. */
function RiskRow({
  label,
  tone,
  reason,
  evidence,
}: {
  label: string;
  tone: Tone;
  reason: string;
  evidence: string[];
}) {
  const t = toneVars(tone);
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span
        style={{
          flex: "0 0 auto",
          fontFamily: "var(--ds-mono)",
          fontSize: 9.5,
          fontWeight: 600,
          color: t.color,
          background: t.dim,
          borderRadius: "var(--ds-r-pill)",
          padding: "2px 7px",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ds-fg-secondary)", lineHeight: 1.4 }}>{reason}</span>
        {evidence.length > 0 && (
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10, fontWeight: 500, color: "var(--ds-muted)" }}>
            {evidence.join(" · ")}
          </span>
        )}
      </div>
    </div>
  );
}

/** 다음 행동 row — turn-down arrow · text · required evidence. */
function ActionRow({ text, evidence }: { text: string; evidence: string }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 8 }}>
      <span style={{ flex: "0 0 auto", display: "inline-flex", paddingTop: 2, color: "var(--ds-warning)" }}>
        <Icon name="arrow.right" size={12} title="다음 행동" />
      </span>
      <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ds-fg)", lineHeight: 1.4 }}>{text}</span>
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)" }}>
          필요한 근거 · {evidence}
        </span>
      </div>
    </div>
  );
}

/** Small uppercase mono label used inside the retrospective card. */
function CardLabel({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        fontFamily: "var(--ds-mono)",
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: "var(--ds-track-eyebrow)",
        textTransform: "uppercase",
        color: "var(--ds-muted-deep)",
      }}
    >
      {children}
    </div>
  );
}

/** 근거 커버리지 row in the meta panel — dot · label · count · status. */
function EvidenceMixRow({
  label,
  count,
  status,
  statusLabel,
  tone,
}: {
  label: string;
  count: number;
  status: string;
  statusLabel: string;
  tone: Tone | "muted";
}) {
  const color = tone === "muted" ? "var(--ds-muted-deep)" : toneVars(tone).color;
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        height: 30,
        padding: "0 10px",
        borderRadius: "var(--ds-r-chip)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <span style={{ flex: "0 0 auto", width: 6, height: 6, borderRadius: 999, background: color }} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 11.5,
          fontWeight: 500,
          color: "var(--ds-fg-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span
        style={{
          flex: "0 0 auto",
          fontFamily: "var(--ds-mono)",
          fontSize: 10.5,
          fontWeight: 600,
          color: count > 0 ? "var(--ds-fg)" : "var(--ds-muted-deep)",
        }}
      >
        {count}
      </span>
      <span
        style={{
          flex: "0 0 auto",
          fontFamily: "var(--ds-mono)",
          fontSize: 9.5,
          fontWeight: 500,
          color,
          whiteSpace: "nowrap",
        }}
      >
        {statusLabel}
      </span>
    </div>
  );
}

/* ─────────────────────────────── page ─────────────────────────────── */

export interface HistoryReferencePageProps {
  /** Fixed pixel height for the framed window (the shell fills its container otherwise). */
  height?: number;
}

/**
 * Faithful mirror of the History / Retrospective (히스토리) reference surface —
 * the OpenDesignHistory* view hierarchy in OpenDesignReferencePages.swift.
 * Left: 이번 주 주간 합계 + 집중/판단 + 집중 영역 순위. Center: 회고 판단 카드
 * (인사이트 · 리스크 · 다음 행동) + 접힌 Evidence 타임라인 + 주간 배너. Right: 근거 커버리지 믹스.
 */
export function HistoryReferencePage({ height = 900 }: HistoryReferencePageProps) {
  const rail = (
    <Rail
      items={[
        { icon: <Icon name="folder" size={19} title="프로젝트" /> },
        { icon: <Icon name="gearshape" size={19} title="설정" /> },
        { icon: <Icon name="bubble.left.and.bubble.right" size={19} title="인터뷰" /> },
        { icon: <Icon name="doc.text" size={19} title="공개기록" /> },
        { icon: <Icon name="newspaper" size={19} title="뉴스" /> },
        { icon: <Icon name="clock.arrow.circlepath" size={19} title="히스토리" />, active: true },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" />}
    />
  );

  /* ── left sidebar: 이번 주 주간 합계 + 집중/판단 + 집중 영역 순위 ── */
  const sidebar = (
    <div
      style={{
        width: 240,
        flex: "0 0 240px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--ds-surface-2)",
        borderRight: "1px solid var(--ds-border-soft)",
      }}
    >
      <div
        style={{
          height: 64,
          flex: "0 0 64px",
          display: "flex",
          flexDirection: "column",
          justifyContent: "center",
          gap: 4,
          padding: "0 18px",
          borderBottom: "1px solid var(--ds-border-soft)",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>이번 주</span>
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)" }}>
          2026-05-12 → 2026-05-18
        </span>
      </div>

      <div className="ds-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "16px 14px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          {/* 주간 합계 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 14,
              borderRadius: "var(--ds-r-card)",
              background: "var(--ds-surface)",
              border: "1px solid var(--ds-border-soft)",
            }}
          >
            <StatRow label="AI 세션" value="6시간 12분" accent />
            <StatRow label="내 커밋" value="12건" />
            <StatRow label="활동일" value="5 / 7일" />
            <StatRow label="미분류" value="48분" />
          </div>

          {/* 집중 / 불균형 / 미분류 */}
          <GroupLabel>집중 / 불균형 / 미분류</GroupLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <FocusRow
              label="집중"
              value="온보딩 · Office Hours"
              detail="3시간 20분 · 커밋 7건"
              tone="accent"
            />
            <FocusRow
              label="판단"
              value={VERDICT.label}
              detail="리스크 2건"
              tone={VERDICT.tone}
            />
            <FocusRow label="미분류" value="48분" detail="2개 세션" tone="amber" />
          </div>

          {/* 집중 영역 순위 */}
          <GroupLabel>집중 영역</GroupLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <AreaRankRow
              name="온보딩 · Office Hours"
              minutes="3시간 20분"
              ratio={1}
              commits={7}
              confidence={CONFIDENCE_HIGH}
            />
            <AreaRankRow
              name="Founder Replay"
              minutes="1시간 46분"
              ratio={0.53}
              commits={3}
              confidence={CONFIDENCE_MED}
            />
            <AreaRankRow
              name="Sidecar · work-history"
              minutes="1시간 6분"
              ratio={0.33}
              commits={2}
              confidence={CONFIDENCE_MED}
            />
          </div>
        </div>
      </div>
    </div>
  );

  const titlebar = <Titlebar breadcrumb={{ page: "히스토리", detail: "이번 주 회고" }} />;

  /* ── main header (custom — status pulse + 다시 인덱싱 CTA) ── */
  const header = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "0 0 20px",
      }}
    >
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 3 }}>
        <span style={{ fontSize: 17, fontWeight: 600, color: "var(--ds-fg)" }}>이번 주 회고</span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            fontFamily: "var(--ds-mono)",
            fontSize: 11,
            fontWeight: 500,
            color: "var(--ds-muted)",
          }}
        >
          <span
            style={{
              width: 5,
              height: 5,
              borderRadius: 999,
              background: "var(--ds-accent)",
              boxShadow: "0 0 6px var(--ds-accent-dim)",
            }}
          />
          <span style={{ color: "var(--ds-fg-secondary)" }}>최신</span>
          <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
          <span>2026-05-12 → 2026-05-18</span>
        </div>
      </div>
      <Button variant="primary" size="sm" icon={<Icon name="arrow.clockwise" size={14} title="" />}>
        다시 인덱싱
      </Button>
    </div>
  );

  /* ── 회고 판단 카드 ── */
  const retrospectiveCard = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 14,
        padding: 16,
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      {/* headline + verdict pill */}
      <div style={{ display: "flex", alignItems: "flex-start", gap: 12 }}>
        <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
          <CardLabel>이번 주 판단</CardLabel>
          <span style={{ fontSize: 15, fontWeight: 600, color: "var(--ds-fg)", lineHeight: 1.4 }}>
            초기 검증 흐름이 처음으로 닫혔어요 · Day 1 완료
          </span>
        </div>
        <span
          style={{
            flex: "0 0 auto",
            fontFamily: "var(--ds-mono)",
            fontSize: 10.5,
            fontWeight: 600,
            color: toneVars(VERDICT.tone).color,
            background: toneVars(VERDICT.tone).dim,
            borderRadius: "var(--ds-r-pill)",
            padding: "4px 9px",
            whiteSpace: "nowrap",
          }}
        >
          {VERDICT.label}
        </span>
      </div>

      {/* 핵심 인사이트 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <CardLabel>핵심 인사이트</CardLabel>
        <InsightCard
          claim="빌드 루프 통증이 실제 행동으로 확정됐어요."
          confidence={CONFIDENCE_HIGH}
          why="인터뷰 4/4가 '검증 없이 5번 빌드'를 지목했고, 고객 후보 1명이 SPEC.md에 자동 저장됐습니다."
          evidence={["INTERVIEW 3/4", "INTERVIEW 4/4", "SPEC.md candidate.icp"]}
        />
        <InsightCard
          claim="시간이 온보딩·Office Hours에 몰려 있어요."
          confidence={CONFIDENCE_MED}
          why="이번 주 AI 세션의 절반이 한 영역에 쏠렸습니다. Founder Replay 배선은 다음 주로 밀렸어요."
          evidence={["AI 세션 3시간 20분", "커밋 7건"]}
        />
      </div>

      {/* 리스크 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <CardLabel>리스크</CardLabel>
        <RiskRow
          label="블로커"
          tone="rose"
          reason="공개 기록이 0편이라 Day 24 공개 게이트 근거가 비어 있어요."
          evidence={["BIP 0 / 14", "공개 기록 · 게시 0"]}
        />
        <RiskRow
          label="주의"
          tone="amber"
          reason="미분류 세션 48분이 어느 기능 영역에도 붙지 않았습니다."
          evidence={["미분류 2개 세션"]}
        />
      </div>

      {/* 다음 행동 */}
      <div style={{ display: "flex", flexDirection: "column", gap: 7 }}>
        <CardLabel>다음 행동</CardLabel>
        <ActionRow
          text="Day 2 시장 신호 읽기 — Threads/IH 키워드 3개 추출"
          evidence="고객 후보 1명 · 인터뷰 원문 6건"
        />
        <ActionRow
          text="이번 주 첫 공개 기록 1편 게시"
          evidence="게시 캡처 + 게시 시각"
        />
      </div>
    </div>
  );

  /* ── Evidence 타임라인 (접힘 상태) ── */
  const evidenceTimeline = (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 8,
        padding: 12,
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <span style={{ flex: "0 0 auto", display: "inline-flex", width: 12, justifyContent: "center", color: "var(--ds-muted)" }}>
        <Icon name="chevron.right" size={12} title="펼치기" />
      </span>
      <span style={{ flex: "0 0 auto", display: "inline-flex", color: "var(--ds-muted)" }}>
        <Icon name="clock" size={13} title="" />
      </span>
      <span style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ds-fg)" }}>Evidence 타임라인</span>
      <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)" }}>
        세션 · 파일 · PR 근거
      </span>
      <span style={{ flex: 1 }} />
      <Badge neutral>펼치기</Badge>
    </div>
  );

  /* ── 주간 배너 (다음 액션) ── */
  const weeklyBanner = (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 16,
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <span style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ds-fg)", lineHeight: 1.4 }}>
        이번 주는 '먼저 도울 사람 1명'을 고정하는 데 성공했어요.
      </span>
      {[
        "인터뷰 원문 6건이 빌드 루프 가설을 실제 행동으로 확정했습니다.",
        "코드는 온보딩·Office Hours에 몰렸고 Founder Replay 배선은 다음 주로 이월됐어요.",
      ].map((note) => (
        <div key={note} style={{ display: "flex", alignItems: "flex-start", gap: 7 }}>
          <span
            style={{
              flex: "0 0 auto",
              width: 4,
              height: 4,
              borderRadius: 999,
              background: "var(--ds-accent)",
              marginTop: 6,
            }}
          />
          <span style={{ fontSize: 12, color: "var(--ds-fg-secondary)", lineHeight: 1.5 }}>{note}</span>
        </div>
      ))}
      <div style={{ display: "flex", flexDirection: "column", gap: 6, marginTop: 2 }}>
        <CardLabel>다음 액션</CardLabel>
        <ActionRow
          text="Day 2 시장 신호 읽기로 이동"
          evidence="Day 1 고객 후보 1명"
        />
      </div>
    </div>
  );

  const main = (
    <>
      {header}
      <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
        {retrospectiveCard}
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {evidenceTimeline}
          {weeklyBanner}
        </div>
      </div>
    </>
  );

  /* ── right meta panel: 요약 + 근거 커버리지 ── */
  const meta = (
    <aside
      style={{
        width: 280,
        flex: "0 0 280px",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--ds-surface)",
        borderLeft: "1px solid var(--ds-border-soft)",
      }}
    >
      <div className="ds-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 14px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ds-fg)" }}>요약</div>

          {/* 판단 / 인사이트 / 리스크 / GitHub / 커밋 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: 13,
              borderRadius: "var(--ds-r-card)",
              background: "var(--ds-surface)",
              border: "1px solid var(--ds-border-soft)",
            }}
          >
            <StatRow label="판단" value={VERDICT.label} accent />
            <StatRow label="인사이트" value="2건" />
            <StatRow label="리스크" value="2건" />
            <StatRow label="GitHub" value="연결됨" accent />
            <StatRow label="PR" value="3건" />
            <StatRow label="이슈" value="1건" />
            <StatRow label="릴리즈" value="0건" />
            <StatRow label="타인/봇 커밋" value="4건" />
          </div>

          {/* 근거 커버리지 */}
          <GroupLabel style={{ paddingTop: 2 }}>근거 커버리지</GroupLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <EvidenceMixRow label="AI 세션" count={18} status="connected" statusLabel="연결" tone="accent" />
            <EvidenceMixRow label="git/GitHub" count={12} status="connected" statusLabel="연결" tone="accent" />
            <EvidenceMixRow label="워크스페이스 문서" count={4} status="connected" statusLabel="연결" tone="accent" />
            <EvidenceMixRow label="인터뷰" count={6} status="connected" statusLabel="연결" tone="sky" />
            <EvidenceMixRow label="BIP" count={0} status="missing" statusLabel="없음" tone="muted" />
            <EvidenceMixRow label="미션" count={1} status="connected" statusLabel="연결" tone="violet" />
            <EvidenceMixRow label="커리큘럼" count={3} status="connected" statusLabel="연결" tone="teal" />
          </div>

          {/* 미분류 · 진행 중 */}
          <GroupLabel style={{ paddingTop: 2 }}>미분류 · 진행 중 2건</GroupLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            {[
              { provider: "Claude", range: "22:05–22:41", minutes: "36분", path: "sidecar/work-history.mjs" },
              { provider: "Codex", range: "14:12–14:24", minutes: "12분", path: "agentic30/OpenDesignReferencePages.swift" },
            ].map((s) => (
              <div
                key={s.range}
                style={{
                  display: "flex",
                  alignItems: "flex-start",
                  gap: 8,
                  padding: 12,
                  borderRadius: "var(--ds-r-card)",
                  background: "var(--ds-surface)",
                  border: `1px solid ${toneVars("amber").line}`,
                }}
              >
                <span
                  style={{
                    flex: "0 0 auto",
                    fontFamily: "var(--ds-mono)",
                    fontSize: 9.5,
                    fontWeight: 600,
                    color: "var(--ds-warning)",
                    background: "var(--ds-warning-dim)",
                    borderRadius: "var(--ds-r-pill)",
                    padding: "2px 7px",
                    whiteSpace: "nowrap",
                  }}
                >
                  미분류 · 진행 중
                </span>
                <div style={{ display: "flex", flexDirection: "column", gap: 2, minWidth: 0 }}>
                  <div style={{ display: "flex", alignItems: "baseline", gap: 6 }}>
                    <span style={{ fontSize: 11, fontWeight: 600, color: "var(--ds-fg-secondary)" }}>{s.provider}</span>
                    <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)" }}>
                      {s.range}
                    </span>
                    <span
                      style={{
                        fontFamily: "var(--ds-mono)",
                        fontSize: 10.5,
                        fontWeight: 600,
                        color: "var(--ds-fg-secondary)",
                      }}
                    >
                      {s.minutes}
                    </span>
                  </div>
                  <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10, fontWeight: 500, color: "var(--ds-muted)" }}>
                    {s.path}
                  </span>
                </div>
              </div>
            ))}
          </div>

          <span style={{ fontSize: 10, fontWeight: 500, color: "var(--ds-muted-deep)", lineHeight: 1.5, padding: "0 4px" }}>
            프롬프트 원문은 연결 근거로만 사용하고 화면·저장본에는 남기지 않아요.
          </span>
        </div>
      </div>
    </aside>
  );

  return (
    <div style={{ height, minHeight: 0 }}>
      <ReferenceShell rail={rail} sidebar={sidebar} titlebar={titlebar} meta={meta}>
        {main}
      </ReferenceShell>
    </div>
  );
}

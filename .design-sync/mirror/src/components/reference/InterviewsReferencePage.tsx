import React from "react";
import { Tone, toneVars } from "../../tokens";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Icon } from "../Icon";
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

/** Tinted mono chip used in the summary banner ("신호 8/10", "주의 1"). */
function BannerChip({ label, tone }: { label: React.ReactNode; tone?: Tone }) {
  const neutral = tone == null;
  const t = toneVars(tone ?? "accent");
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 22,
        padding: "0 9px",
        borderRadius: "var(--ds-r-pill)",
        fontFamily: "var(--ds-mono)",
        fontSize: 11,
        fontWeight: 600,
        letterSpacing: "0.02em",
        whiteSpace: "nowrap",
        color: neutral ? "var(--ds-fg-secondary)" : t.color,
        background: neutral ? "var(--ds-surface-2)" : t.dim,
        border: `1px solid ${neutral ? "var(--ds-border-strong)" : t.line}`,
      }}
    >
      {label}
    </span>
  );
}

/** A quote-highlight styled sentence inside the summary banner (accent + amber spans). */
function HighlightSpan({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  const t = toneVars(tone);
  return (
    <span
      style={{
        color: t.color,
        background: t.dim,
        borderRadius: 4,
        padding: "1px 4px",
        boxDecorationBreak: "clone",
        WebkitBoxDecorationBreak: "clone",
      }}
    >
      {children}
    </span>
  );
}

/** One tinted-label signal card in the "추출 신호" 2×2 grid. */
function SignalCard({
  label,
  tone,
  headline,
  meta,
}: {
  label: string;
  tone: Tone;
  headline: React.ReactNode;
  meta: React.ReactNode;
}) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        borderRadius: "var(--ds-r-card)",
        boxShadow: "var(--ds-shadow-card)",
        padding: 14,
        display: "flex",
        flexDirection: "column",
        gap: 8,
        minWidth: 0,
      }}
    >
      <span
        className="ds-eyebrow"
        style={{ color: t.color, letterSpacing: "0.06em" }}
      >
        {label}
      </span>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ds-fg)", lineHeight: 1.4 }}>{headline}</div>
      <div style={{ fontSize: 11.5, color: "var(--ds-muted)" }}>{meta}</div>
    </div>
  );
}

/** Row inside the "실제 행동 질문 점검" checklist (check / warn glyph + label + trailing). */
function CheckRow({
  glyph,
  tone,
  title,
  subtitle,
  trailing,
}: {
  glyph: React.ReactNode;
  tone: Tone;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  trailing: React.ReactNode;
}) {
  const t = toneVars(tone);
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "11px 0" }}>
      <span
        style={{
          flex: "0 0 auto",
          width: 22,
          height: 22,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 12,
          fontWeight: 700,
          color: t.color,
          background: t.dim,
          border: `1px solid ${t.line}`,
        }}
      >
        {glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, color: "var(--ds-fg)" }}>{title}</span>
        {subtitle != null && (
          <span style={{ display: "block", marginTop: 2, fontSize: 11, fontFamily: "var(--ds-mono)", color: "var(--ds-muted)" }}>
            {subtitle}
          </span>
        )}
      </span>
      <span style={{ flex: "0 0 auto", fontFamily: "var(--ds-mono)", fontSize: 12, color: "var(--ds-muted)" }}>
        {trailing}
      </span>
    </div>
  );
}

/** A single quote row — timestamp tile · quote · label + trailing tone tag. */
function QuoteRow({
  time,
  quote,
  label,
  tag,
  tone,
}: {
  time: string;
  quote: React.ReactNode;
  label: string;
  tag: string;
  tone: Tone;
}) {
  const t = toneVars(tone);
  return (
    <div style={{ display: "flex", gap: 12, padding: "12px 0" }}>
      <span
        style={{
          flex: "0 0 auto",
          fontFamily: "var(--ds-mono)",
          fontSize: 11,
          color: "var(--ds-muted)",
          background: "var(--ds-surface-2)",
          border: "1px solid var(--ds-border)",
          borderRadius: 6,
          padding: "3px 7px",
          height: "fit-content",
        }}
      >
        {time}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13.5, color: "var(--ds-fg)", lineHeight: 1.45 }}>{quote}</span>
        <span style={{ display: "flex", alignItems: "center", gap: 8, marginTop: 6 }}>
          <span style={{ fontSize: 11, color: "var(--ds-muted)" }}>{label}</span>
          <span style={{ color: "var(--ds-muted-deep)", fontSize: 11 }}>·</span>
          <span
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 5,
              fontSize: 11,
              fontWeight: 600,
              color: t.color,
            }}
          >
            <span style={{ width: 5, height: 5, borderRadius: 999, background: t.color }} />
            {tag}
          </span>
        </span>
      </span>
    </div>
  );
}

/** A single numbered follow-up question row. */
function FollowupRow({ n, title, subtitle }: { n: number; title: React.ReactNode; subtitle: React.ReactNode }) {
  const t = toneVars("accent");
  return (
    <div style={{ display: "flex", gap: 12, padding: "11px 0" }}>
      <span
        style={{
          flex: "0 0 auto",
          width: 22,
          height: 22,
          borderRadius: 999,
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--ds-mono)",
          fontSize: 11,
          fontWeight: 700,
          color: t.color,
          background: t.dim,
          border: `1px solid ${t.line}`,
        }}
      >
        {n}
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, color: "var(--ds-fg)", lineHeight: 1.45 }}>{title}</span>
        <span style={{ display: "block", marginTop: 3, fontSize: 11.5, color: "var(--ds-muted)" }}>{subtitle}</span>
      </span>
    </div>
  );
}

/** A code-diff line — line-number gutter + monospace text tinted by tone. */
function DiffLine({ line, text, tone }: { line: string; text: React.ReactNode; tone: Tone }) {
  const isAdd = tone === "accent";
  const isDel = tone === "rose";
  const t = toneVars(tone);
  const textColor = tone === "muted" ? "var(--ds-fg-secondary)" : t.color;
  const bg = isAdd ? t.dim : isDel ? t.dim : "transparent";
  return (
    <div style={{ display: "flex", alignItems: "flex-start", background: bg }}>
      <span
        style={{
          flex: "0 0 auto",
          width: 30,
          textAlign: "right",
          padding: "3px 8px 3px 0",
          fontFamily: "var(--ds-mono)",
          fontSize: 11,
          color: "var(--ds-muted-deep)",
          userSelect: "none",
        }}
      >
        {line}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          padding: "3px 10px 3px 6px",
          fontFamily: "var(--ds-mono)",
          fontSize: 12,
          lineHeight: 1.55,
          color: textColor,
          whiteSpace: "pre-wrap",
          wordBreak: "break-word",
        }}
      >
        {isAdd ? "+ " : isDel ? "- " : "  "}
        {text}
      </span>
    </div>
  );
}

/* ─────────────────────── meta-panel building blocks ─────────────────────── */

/** Big stacked metric in the meta "진행 상황" banner (value + label). */
function MetaMetric({ value, label, tone }: { value: string; label: string; tone: Tone }) {
  const color = tone === "muted" ? "var(--ds-fg)" : toneVars(tone).color;
  return (
    <div style={{ flex: 1, textAlign: "center" }}>
      <div style={{ fontFamily: "var(--ds-mono)", fontSize: 24, fontWeight: 700, color, lineHeight: 1 }}>{value}</div>
      <div style={{ marginTop: 6, fontSize: 11.5, color: "var(--ds-muted)" }}>{label}</div>
    </div>
  );
}

/** Small uppercase group header inside the meta panel. */
function MetaGroupLabel({ children }: { children: React.ReactNode }) {
  return (
    <div className="ds-eyebrow" style={{ margin: "18px 0 8px" }}>
      {children}
    </div>
  );
}

/** Recurring-theme row — title + progress bar + fraction. */
function ThemeRow({ title, filled, total, tone }: { title: React.ReactNode; filled: number; total: number; tone: Tone }) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        borderRadius: "var(--ds-r-control)",
        border: "1px solid var(--ds-border-soft)",
        background: "var(--ds-surface)",
        marginBottom: 8,
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          maxWidth: "48%",
          fontSize: 12.5,
          color: "var(--ds-fg)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          height: 4,
          borderRadius: 999,
          background: "var(--ds-surface-2)",
          overflow: "hidden",
        }}
      >
        <span
          style={{
            display: "block",
            width: `${(filled / total) * 100}%`,
            height: "100%",
            borderRadius: 999,
            background: t.color,
          }}
        />
      </span>
      <span
        style={{
          flex: "0 0 auto",
          fontFamily: "var(--ds-mono)",
          fontSize: 11,
          color: "var(--ds-muted)",
          textAlign: "right",
          whiteSpace: "nowrap",
        }}
      >
        {filled}/{total}
      </span>
    </div>
  );
}

/** Upcoming-interview row — date tile (day + month) · name · time · chevron. */
function UpcomingRow({
  day,
  month,
  name,
  time,
  timeTone,
}: {
  day: string;
  month: string;
  name: React.ReactNode;
  time: React.ReactNode;
  timeTone?: Tone;
}) {
  const timeColor = timeTone != null ? toneVars(timeTone).color : "var(--ds-muted)";
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "9px 10px",
        borderRadius: "var(--ds-r-control)",
        border: "1px solid var(--ds-border-soft)",
        background: "var(--ds-surface-2)",
        marginBottom: 8,
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          width: 38,
          height: 38,
          borderRadius: "var(--ds-r-control)",
          border: "1px solid var(--ds-border)",
          background: "var(--ds-surface)",
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 14, fontWeight: 700, color: "var(--ds-fg)", lineHeight: 1 }}>{day}</span>
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 9.5, color: "var(--ds-muted)", marginTop: 2 }}>{month}</span>
      </span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <span style={{ display: "block", fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>{name}</span>
        <span style={{ display: "block", marginTop: 2, fontFamily: "var(--ds-mono)", fontSize: 11, color: timeColor }}>{time}</span>
      </span>
      <span style={{ flex: "0 0 auto", color: "var(--ds-muted-deep)", display: "inline-flex" }}>
        <Icon name="chevron.right" size={13} title="" />
      </span>
    </div>
  );
}

/* ─────────────────────────────── page ─────────────────────────────── */

export interface InterviewsReferencePageProps {
  /** Fixed pixel height for the framed window (the shell fills its container otherwise). */
  height?: number;
}

/** Faithful mirror of OpenDesign_Interviews_Wide.png — the interview analysis screen. */
export function InterviewsReferencePage({ height = 900 }: InterviewsReferencePageProps) {
  const rail = (
    <Rail
      items={[
        { icon: <Icon name="folder" size={19} title="프로젝트" /> },
        { icon: <Icon name="gearshape" size={19} title="설정" /> },
        { icon: <Icon name="bubble.left.and.bubble.right" size={19} title="인터뷰" />, active: true },
        { icon: <Icon name="doc.text" size={19} title="공개기록" /> },
        { icon: <Icon name="newspaper" size={19} title="뉴스" /> },
        { icon: <Icon name="clock.arrow.circlepath" size={19} title="히스토리" /> },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" />}
    />
  );

  const sidebar = (
    <ReferenceSidebar
      title="인터뷰"
      badge={<Badge neutral>8</Badge>}
      groups={[
        {
          label: "분석 완료",
          rows: [
            <SideRow
              active
              tone="accent"
              leading={<Avatar initials="JC" size={36} tone="accent" />}
              title="장지창"
              subtitle="● 분석 · 45m"
              badge={<Badge tone="accent">8 / 10</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="PK" size={36} tone="accent" muted />}
              title="박노훈"
              subtitle="● 분석 · 38m"
              badge={<Badge neutral>7 / 10</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="SH" size={36} tone="sky" muted />}
              title="정세훈"
              subtitle="● 분석 · 32m"
              badge={<Badge neutral>5 / 10</Badge>}
            />,
          ],
        },
        {
          label: "대기 중",
          rows: [
            <SideRow
              leading={<Avatar initials="KP" size={36} tone="amber" muted />}
              title="K. Park"
              subtitle="● transcribe 중"
              badge={<Badge tone="amber">대기</Badge>}
            />,
          ],
        },
        {
          label: "예정",
          rows: [
            <SideRow
              leading={<Avatar initials="CY" size={36} tone="muted" muted />}
              title="최예린"
              subtitle="● 슬롯 확정 · 45m"
              badge={<Badge neutral>D-3</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="SJ" size={36} tone="muted" muted />}
              title="신지호"
              subtitle="● DM 발송"
              badge={<Badge neutral>D-5</Badge>}
            />,
            <SideRow
              leading={<Avatar initials="YJ" size={36} tone="muted" muted />}
              title="윤재희"
              subtitle="● 슬롯 후보 · 30m"
              badge={<Badge neutral>D-7</Badge>}
            />,
          ],
        },
      ]}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ds-muted)" }}>
            <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
            분석 완료 <span style={{ color: "var(--ds-fg-secondary)" }}>04-22 21:14</span>
          </div>
          <Button variant="primary" fullWidth icon={<Icon name="plus" size={14} title="" />}>
            인터뷰 추가
          </Button>
        </div>
      }
    />
  );

  const titlebar = <Titlebar breadcrumb={{ page: "인터뷰", detail: "장지창 · 실제 행동 인터뷰 1" }} />;

  const header = (
    <ReferenceHeader
      icon={<Avatar initials="JC" size={56} tone="accent" />}
      title="장지창"
      badge={<Badge neutral>전 직장 동료</Badge>}
      subtitleParts={["2026-04-22 19:30", "Zoom · 45분", "Day 1 · 1 / 4"]}
      actions={
        <>
          <Button variant="ghost" size="sm" icon={<Icon name="pencil" size={14} title="" />}>
            후속 질문 생성
          </Button>
          <Button variant="primary" size="sm" icon={<Icon name="chevron.right" size={14} title="" />}>
            SPEC.md에 반영
          </Button>
        </>
      }
    />
  );

  const analysisStamp = (
    <div style={{ display: "flex", alignItems: "center", justifyContent: "flex-end", gap: 7, fontSize: 12, marginBottom: 4 }}>
      <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
      <span style={{ color: "var(--ds-accent)", fontWeight: 600 }}>분석 완료</span>
      <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
      <span style={{ fontFamily: "var(--ds-mono)", color: "var(--ds-muted)" }}>04-22 21:14</span>
    </div>
  );

  const filterTabs = (
    <div style={{ position: "relative", borderBottom: "1px solid var(--ds-border-soft)" }}>
      <div style={{ display: "inline-flex", verticalAlign: "bottom", marginBottom: -1 }}>
        <FilterTabs tabs={["요약", "인용 12", "후속 7", "Transcript"]} value="요약" />
      </div>
      <div style={{ position: "absolute", right: 0, bottom: 0, height: "100%", display: "flex", alignItems: "center" }}>
        {analysisStamp}
      </div>
    </div>
  );

  /* ── summary banner ── */
  const summaryBanner = (
    <div
      style={{
        padding: "18px 20px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <div style={{ fontSize: 16.5, fontWeight: 600, color: "var(--ds-fg)", lineHeight: 1.55 }}>
        <HighlightSpan tone="accent">5번 빌드 → 0매출</HighlightSpan> 패턴을 본인이 자각했지만{" "}
        <HighlightSpan tone="amber">"검증 없이 또 만들 것 같다"</HighlightSpan>는 회피 신호가 강합니다. 핵심 통증은{" "}
        <HighlightSpan tone="accent">"누가 쓸지를 모른다"</HighlightSpan>로 압축됩니다.
      </div>
      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, marginTop: 14 }}>
        <BannerChip label="신호 8/10" />
        <BannerChip label="고객 후보 적합 매우 높음" />
        <BannerChip label="주의 1" tone="amber" />
      </div>
    </div>
  );

  /* ── signal 2×2 grid ── */
  const signalGrid = (
    <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr 1fr", gap: 12 }}>
      <SignalCard
        label="통증"
        tone="rose"
        headline={<span>"뭘 만들지 보다 누가 쓸지를 모른다."</span>}
        meta="5건 인용 · 하루 3시간 검증 회피"
      />
      <SignalCard
        label="현재 대안"
        tone="sky"
        headline="YouTube 인디해커 · Threads · ChatGPT"
        meta="3건 언급 · 구조 없음"
      />
      <SignalCard
        label="과거 행동"
        tone="accent"
        headline="6개월 · 5개 출시 · 가입 11명 · 매출 0원"
        meta="2건 인용 · 강력한 신호"
      />
      <SignalCard
        label="지불 의사"
        tone="amber"
        headline="Cursor $20/mo · Claude Code $200/mo"
        meta="툴은 결제 · 결과는 0원"
      />
    </div>
  );

  /* ── mom-test check block ── */
  const momBlock = (
    <div
      style={{
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
        overflow: "hidden",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 14, padding: "16px 18px" }}>
        <span
          style={{
            flex: "0 0 auto",
            width: 52,
            height: 52,
            borderRadius: 999,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ds-accent)",
            background: "var(--ds-accent-dim)",
            border: "1px solid var(--ds-accent-line)",
          }}
        >
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 15, fontWeight: 700, lineHeight: 1 }}>4/5</span>
          <span style={{ fontSize: 9.5, color: "var(--ds-muted)", marginTop: 2 }}>통과</span>
        </span>
        <span style={{ flex: 1, minWidth: 0 }}>
          <span style={{ display: "block", fontSize: 15, fontWeight: 700, color: "var(--ds-fg)" }}>
            품질 양호 — 한 가지 주의 항목
          </span>
          <span style={{ display: "block", marginTop: 3, fontSize: 12.5, color: "var(--ds-muted)" }}>
            본인 솔루션을 미리 설명하는 실수 1건. 다음 인터뷰엔 가설 설명을 빼세요.
          </span>
        </span>
        <span style={{ flex: "0 0 auto" }}>
          <Badge tone="amber">1 주의</Badge>
        </span>
      </div>
      <div style={{ borderTop: "1px solid var(--ds-border-soft)", padding: "4px 18px 8px" }}>
        <CheckRow glyph={<Icon name="checkmark" size={12} title="" />} tone="accent" title="의견이 아니라 행동을 물었다" trailing="7회" />
        <CheckRow glyph={<Icon name="checkmark" size={12} title="" />} tone="accent" title="미래 약속이 아니라 과거 사실을 받았다" trailing="4회" />
        <CheckRow glyph={<Icon name="checkmark" size={12} title="" />} tone="accent" title="구체 수치·날짜·금액으로 답을 받아냈다" trailing="12회" />
        <CheckRow glyph={<Icon name="exclamationmark.triangle" size={12} title="" />} tone="amber" title="솔루션을 미리 설명하지 않았다" subtitle="06:14 · 1회" trailing="주의" />
      </div>
    </div>
  );

  /* ── quotes block ── */
  const quotesBlock = (
    <div
      style={{
        padding: "4px 18px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <QuoteRow
        time="02:18"
        quote="AI로 다섯 번 만들었어요. 한 번도 안 팔렸어요."
        label="Pain"
        tag="강한 통증"
        tone="rose"
      />
      <div style={{ borderTop: "1px solid var(--ds-border-soft)" }} />
      <QuoteRow
        time="07:42"
        quote="지난 6개월에 다섯 개 출시. 가입 누계 11명, 매출은 0원."
        label="Past"
        tag="과거 행동"
        tone="accent"
      />
      <div style={{ borderTop: "1px solid var(--ds-border-soft)" }} />
      <QuoteRow
        time="12:55"
        quote={<span>"만들기 전에, 누가 쓸 사람인지를 모르겠다"는 거예요.</span>}
        label="첫 진입점"
        tag="핵심 통증"
        tone="rose"
      />
      <div style={{ borderTop: "1px solid var(--ds-border-soft)" }} />
      <QuoteRow
        time="28:34"
        quote="오 그거 좋은데요? 저 해볼래요."
        label="피해야 할 답변"
        tag="실제 행동 질문 위반"
        tone="amber"
      />
    </div>
  );

  /* ── follow-ups block ── */
  const followupsBlock = (
    <div
      style={{
        padding: "4px 18px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <FollowupRow
        n={1}
        title="지난 6개월에 마지막으로 출시한 프로덕트는 언제, 어떤 거였어요?"
        subtitle="5번 빌드 → 0매출 패턴 확인"
      />
      <div style={{ borderTop: "1px solid var(--ds-border-soft)" }} />
      <FollowupRow
        n={2}
        title="가입자 0명일 때 본인은 그 다음 주에 뭘 했어요?"
        subtitle="실패 후 실제 행동 데이터"
      />
      <div style={{ borderTop: "1px solid var(--ds-border-soft)" }} />
      <FollowupRow
        n={3}
        title={<span>"오늘 뭘 해야 다음 주가 좋아질지" 막힐 때 마지막으로 어디서 답을 찾았어요?</span>}
        subtitle="현재 대안의 구체적 행동"
      />
    </div>
  );

  /* ── diff block ── */
  const diffBlock = (
    <div
      style={{
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-bg-deep)",
        border: "1px solid var(--ds-border-soft)",
        overflow: "hidden",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          padding: "9px 14px",
          borderBottom: "1px solid var(--ds-border-soft)",
          fontFamily: "var(--ds-mono)",
          fontSize: 11.5,
          color: "var(--ds-muted)",
        }}
      >
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-teal)" }} />
        ICP.md · SPEC.md §2
      </div>
      <div style={{ padding: "8px 0" }}>
        <DiffLine line="5" tone="muted" text="## Our ICP: 전업 1인 개발자 (수익 0원)" />
        <DiffLine line="7" tone="rose" text="에이전트 코딩 도구로 만들 수 있는, 이미 전업한 1인 개발자." />
        <DiffLine line="7" tone="accent" text={'특히 "AI로 계속 새로 만드는데 한 번도 안 팔린" 좁은 고객군.'} />
        <DiffLine line="10" tone="accent" text="6개월에 3개+ 출시, 가입 20명 미만, 매출 0원" />
      </div>
    </div>
  );

  const main = (
    <>
      {header}
      {filterTabs}

      <RefSection title="요약" markerTone="accent">
        {summaryBanner}
      </RefSection>

      <RefSection title="추출 신호" subtitle="실제 행동 질문 · 4 카테고리" markerTone="accent">
        {signalGrid}
      </RefSection>

      <RefSection title="실제 행동 질문 점검" markerTone="amber">
        {momBlock}
      </RefSection>

      <RefSection title="핵심 인용" count={<Badge neutral>4 / 12</Badge>} markerTone="accent">
        {quotesBlock}
      </RefSection>

      <RefSection title="Day 3 후속 질문" count={<Badge neutral>3 필수</Badge>} markerTone="accent">
        {followupsBlock}
      </RefSection>

      <RefSection title="SPEC · 고객 후보 문서 갱신 제안" markerTone="teal">
        {diffBlock}
      </RefSection>
    </>
  );

  /* ── meta panel ── */
  const statusBanner = (
    <div
      style={{
        padding: "16px 14px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface-2)",
        border: "1px solid var(--ds-border-soft)",
        marginBottom: 4,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ds-muted)", marginBottom: 14 }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
        진행 상황
      </div>
      <div style={{ display: "flex", alignItems: "flex-start" }}>
        <MetaMetric value="3" label="분석" tone="accent" />
        <MetaMetric value="2" label="대기" tone="amber" />
        <MetaMetric value="3" label="예정" tone="muted" />
      </div>
    </div>
  );

  const meta = (
    <MetaPanel title="요약">
      {statusBanner}

      <MetaGroupLabel>반복 테마</MetaGroupLabel>
      <ThemeRow title={<span>"누가 쓸지를 모른다"</span>} filled={3} total={3} tone="accent" />
      <ThemeRow title="N번 빌드 → 0매출" filled={3} total={3} tone="accent" />
      <ThemeRow title="Adaptive 핏" filled={2} total={3} tone="amber" />
      <ThemeRow title="툴 자비 결제" filled={2} total={3} tone="amber" />

      <MetaGroupLabel>예정 인터뷰</MetaGroupLabel>
      <UpcomingRow day="02" month="5월" name="최예린" time="14:00 · 45m" />
      <UpcomingRow day="04" month="5월" name="신지호" time="10:00 · DM 대기" timeTone="amber" />
      <UpcomingRow day="06" month="5월" name="윤재희" time="16:00 · 커피챗" />
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

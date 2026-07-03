import React from "react";
import { Tone, toneVars } from "../../tokens";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Icon } from "../Icon";
import { Sparkline } from "../Sparkline";
import { SurfaceState } from "../SurfaceState";
import { WorkspaceShell } from "../WorkspaceShell";
import { WorkspaceRail } from "../WorkspaceRail";
import { Titlebar } from "../reference/Titlebar";

/* ══════════════════════════════════════════════════════════════════════════
 * Morning Briefing (오늘 아침 브리핑) — the 09:00 overnight-digest surface.
 *
 * Faithful mirror of the app's briefing view: a 3-pane workspace whose main
 * column reads top-to-bottom as 판정 → 소스 근거 → 증거 퍼널, with a scroll-spy
 * briefing outline on the left and a 동기화 소스 / 이상 신호 meta panel on the
 * right. Two states ship from one screen via `failed`:
 *   - connected (default): the digest reads normally, all 4 sources green.
 *   - failed: Cloudflare collection fails → an error banner replaces the digest,
 *     the Cloudflare source card falls to a SurfaceState error, and the meta
 *     panel marks Cloudflare 미연결.
 * ════════════════════════════════════════════════════════════════════════ */

/* ─────────────────────────── delta helpers ─────────────────────────── */

type Dir = "up" | "down";

/** Up = accent (growth is good), down = danger — but a fallen active-user count
 *  is the anomaly the briefing is built around, so it always reads danger. */
function deltaTone(dir: Dir): Tone {
  return dir === "up" ? "accent" : "rose";
}

/** ▲ 56% / ▼ 56% delta chip — mono, tinted by direction. */
function Delta({ dir, pct, size = 11 }: { dir: Dir; pct: number; size?: number }) {
  const t = toneVars(deltaTone(dir));
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 3,
        height: size + 9,
        padding: "0 7px",
        borderRadius: "var(--ds-r-pill)",
        background: t.dim,
        border: `1px solid ${t.line}`,
        fontFamily: "var(--ds-mono)",
        fontSize: size,
        fontWeight: 700,
        color: t.color,
        whiteSpace: "nowrap",
      }}
    >
      <span aria-hidden style={{ fontSize: size - 1 }}>{dir === "up" ? "▲" : "▼"}</span>
      {pct}%
    </span>
  );
}

/** Small uppercase mono group label used across the panels. */
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

/** Section header with a tone marker bar + right-aligned mono caption. */
function BriefingSectionHeader({
  title,
  caption,
  tone = "accent",
}: {
  title: string;
  caption?: string;
  tone?: Tone;
}) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        justifyContent: "space-between",
        gap: 12,
        marginBottom: 12,
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 9, minWidth: 0 }}>
        <span style={{ width: 3, height: 14, borderRadius: 2, background: t.color, flex: "0 0 auto" }} />
        <span style={{ fontSize: 14, fontWeight: 600, color: "var(--ds-fg)" }}>{title}</span>
      </div>
      {caption != null && (
        <span
          style={{
            fontFamily: "var(--ds-mono)",
            fontSize: 10.5,
            fontWeight: 500,
            color: "var(--ds-muted)",
            flex: "0 0 auto",
          }}
        >
          {caption}
        </span>
      )}
    </div>
  );
}

/* ─────────────────────────── source model ─────────────────────────── */

type SourceKey = "cloudflare" | "github" | "posthog";

interface BreakdownRow {
  label: string;
  value: string;
}

interface SourceCardModel {
  key: SourceKey;
  name: string;
  tags: string;
  tone: Tone;
  initials: string;
  metric: string;
  metricLabel: string;
  compare: string;
  delta: { dir: Dir; pct: number };
  spark: number[];
  breakdown: BreakdownRow[];
  /** Footer note: a small dot + text, tinted by tone. */
  footNote?: { text: string; tone: Tone };
  /** When set, this source failed collection — the card renders a SurfaceState error. */
  failure?: { title: string; detail: string };
}

const SOURCES: SourceCardModel[] = [
  {
    key: "cloudflare",
    name: "Cloudflare",
    tags: "트래픽 · 방문 추이",
    tone: "amber",
    initials: "CF",
    metric: "64",
    metricLabel: "순 방문",
    compare: "어제 41",
    delta: { dir: "up", pct: 56 },
    spark: [30, 33, 31, 36, 41, 40, 52, 64],
    breakdown: [{ label: "페이지뷰", value: "188" }],
    footNote: { text: "방문 증가", tone: "accent" },
  },
  {
    key: "github",
    name: "GitHub",
    tags: "커밋 · PR · 배포",
    tone: "muted",
    initials: "GH",
    metric: "9",
    metricLabel: "커밋",
    compare: "어제 6",
    delta: { dir: "up", pct: 50 },
    spark: [4, 5, 4, 6, 6, 7, 8, 9],
    breakdown: [
      { label: "PR 업데이트", value: "2" },
      { label: "PR 머지", value: "1" },
      { label: "릴리즈", value: "1" },
    ],
    footNote: { text: "PR #43 리뷰 대기", tone: "muted" },
  },
  {
    key: "posthog",
    name: "PostHog",
    tags: "활성 사용자 · 이벤트",
    tone: "rose",
    initials: "PH",
    metric: "11",
    metricLabel: "활성 사용자",
    compare: "어제 25",
    delta: { dir: "down", pct: 56 },
    spark: [24, 26, 25, 27, 26, 24, 18, 11],
    breakdown: [
      { label: "이벤트", value: "188" },
      { label: "전환", value: "2" },
    ],
    footNote: { text: "온보딩 2단계 이탈 원인 미확인", tone: "amber" },
  },
];

/** Apply the "failed" variant to the Cloudflare source: it stops collecting. */
function withFailure(sources: SourceCardModel[], failed: boolean): SourceCardModel[] {
  if (!failed) return sources;
  return sources.map((s) =>
    s.key === "cloudflare"
      ? {
          ...s,
          failure: {
            title: "Cloudflare MCP digest 수집 실패:",
            detail: "인증 토큰을 찾지 못했습니다.",
          },
          footNote: { text: "수집 실패 · 연결은 정상", tone: "rose" },
        }
      : s,
  );
}

/* ─────────────────────────── source card ─────────────────────────── */

function BreakdownRowView({ label, value }: BreakdownRow) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 8 }}>
      <span style={{ fontSize: 12, fontWeight: 500, color: "var(--ds-muted)" }}>{label}</span>
      <span
        style={{
          fontFamily: "var(--ds-mono)",
          fontSize: 12.5,
          fontWeight: 600,
          color: "var(--ds-fg-secondary)",
          fontVariantNumeric: "tabular-nums",
        }}
      >
        {value}
      </span>
    </div>
  );
}

function SourceCard({ model }: { model: SourceCardModel }) {
  const failed = model.failure != null;
  const t = toneVars(model.tone === "muted" ? "accent" : model.tone);
  const foot = model.footNote;

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        background: "var(--ds-surface)",
        border: `1px solid ${failed ? "var(--ds-danger-line)" : "var(--ds-border)"}`,
        borderRadius: "var(--ds-r-card)",
        boxShadow: "var(--ds-shadow-card)",
        overflow: "hidden",
        minHeight: 300,
      }}
    >
      {/* header: source identity + status pill */}
      <div style={{ display: "flex", alignItems: "center", gap: 10, padding: "14px 14px 12px" }}>
        <Avatar initials={model.initials} size={28} tone={model.tone} muted={model.tone === "muted"} />
        <div style={{ minWidth: 0, flex: 1 }}>
          <div style={{ fontSize: 13.5, fontWeight: 600, color: "var(--ds-fg)" }}>{model.name}</div>
          <div style={{ fontSize: 11, fontWeight: 500, color: "var(--ds-muted)", marginTop: 1 }}>{model.tags}</div>
        </div>
        {failed && <Badge tone="rose" dot>수집 실패</Badge>}
      </div>

      {failed ? (
        <div style={{ flex: 1, display: "flex", flexDirection: "column" }}>
          <SurfaceState
            kind="error"
            title={model.failure!.title}
            detail={model.failure!.detail}
          />
        </div>
      ) : (
        <>
          {/* KPI + delta + sparkline */}
          <div style={{ padding: "0 14px 12px" }}>
            <div style={{ display: "flex", alignItems: "baseline", gap: 8 }}>
              <span
                style={{
                  fontFamily: "var(--ds-rounded)",
                  fontSize: 32,
                  fontWeight: 700,
                  lineHeight: 1,
                  letterSpacing: "var(--ds-track-tight)",
                  color: "var(--ds-fg)",
                  fontVariantNumeric: "tabular-nums",
                }}
              >
                {model.metric}
              </span>
              <span style={{ fontSize: 12, fontWeight: 500, color: "var(--ds-muted)" }}>{model.metricLabel}</span>
              <span style={{ flex: 1 }} />
              <Delta dir={model.delta.dir} pct={model.delta.pct} />
            </div>
            <div style={{ fontSize: 11.5, fontWeight: 500, color: "var(--ds-muted)", marginTop: 6 }}>{model.compare}</div>
            <div style={{ marginTop: 10 }}>
              <Sparkline
                points={model.spark}
                tone={model.delta.dir === "up" ? (model.tone === "muted" ? "accent" : model.tone) : "rose"}
                width={252}
                height={40}
                fill
              />
            </div>
          </div>

          {/* breakdown rows */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 8,
              padding: "12px 14px",
              borderTop: "1px solid var(--ds-border-soft)",
            }}
          >
            {model.breakdown.map((b) => (
              <BreakdownRowView key={b.label} {...b} />
            ))}
          </div>
        </>
      )}

      {/* footer: note + drilldown */}
      <div
        style={{
          marginTop: "auto",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "10px 14px",
          borderTop: "1px solid var(--ds-border-soft)",
        }}
      >
        {foot != null ? (
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6, minWidth: 0 }}>
            <span
              style={{
                flex: "0 0 auto",
                width: 5,
                height: 5,
                borderRadius: 999,
                background: toneVars(foot.tone).color,
              }}
            />
            <span
              style={{
                fontSize: 11,
                fontWeight: 500,
                color: "var(--ds-muted)",
                overflow: "hidden",
                textOverflow: "ellipsis",
                whiteSpace: "nowrap",
              }}
            >
              {foot.text}
            </span>
          </span>
        ) : (
          <span />
        )}
        {!failed && (
          <button
            type="button"
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: 4,
              background: "transparent",
              border: "none",
              padding: 0,
              cursor: "pointer",
              fontFamily: "var(--ds-sans)",
              fontSize: 11.5,
              fontWeight: 600,
              color: "var(--ds-accent)",
              whiteSpace: "nowrap",
            }}
          >
            드릴다운
            <Icon name="arrow.right" size={12} title="" />
          </button>
        )}
      </div>
    </div>
  );
}

/* ─────────────────────────── funnel tile ─────────────────────────── */

interface FunnelStep {
  source: string;
  sourceTone: Tone;
  title: string;
  value: string;
  unit?: string;
  /** rose when the number is a gap the founder must close (미계측 / 0). */
  valueTone: Tone;
  detail: string;
}

const FUNNEL: FunnelStep[] = [
  {
    source: "Cloudflare",
    sourceTone: "accent",
    title: "방문",
    value: "64",
    unit: "명",
    valueTone: "muted",
    detail: "사람 방문 기준",
  },
  {
    source: "PostHog",
    sourceTone: "rose",
    title: "다운로드/설치",
    value: "미계측",
    valueTone: "rose",
    detail: "다운로드 또는 설치\n이벤트 미계측",
  },
  {
    source: "PostHog",
    sourceTone: "accent",
    title: "워크스페이스/스캔",
    value: "2",
    unit: "명",
    valueTone: "muted",
    detail: "workspace 선택 이후\n첫 스캔",
  },
  {
    source: "PostHog",
    sourceTone: "rose",
    title: "Office Hours/\n검증 행동",
    value: "0",
    unit: "명",
    valueTone: "rose",
    detail: "검증 action 적용",
  },
];

function FunnelTile({ step }: { step: FunnelStep }) {
  const valueColor =
    step.valueTone === "rose" ? "var(--ds-danger)" : step.valueTone === "muted" ? "var(--ds-fg)" : toneVars(step.valueTone).color;
  return (
    <div
      style={{
        flex: "1 1 0",
        minWidth: 0,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        padding: 14,
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
        <span
          style={{
            width: 5,
            height: 5,
            borderRadius: 999,
            background: toneVars(step.sourceTone).color,
            flex: "0 0 auto",
          }}
        />
        <span style={{ fontSize: 10.5, fontWeight: 600, color: "var(--ds-muted)" }}>{step.source}</span>
      </div>
      <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ds-fg-secondary)", lineHeight: 1.3, whiteSpace: "pre-line" }}>
        {step.title}
      </div>
      <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
        <span
          style={{
            fontFamily: "var(--ds-rounded)",
            fontSize: step.value.length > 3 ? 22 : 28,
            fontWeight: 700,
            lineHeight: 1,
            letterSpacing: "var(--ds-track-tight)",
            color: valueColor,
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {step.value}
        </span>
        {step.unit != null && <span style={{ fontSize: 12, fontWeight: 500, color: "var(--ds-muted)" }}>{step.unit}</span>}
      </div>
      <div
        style={{
          fontSize: 10.5,
          fontWeight: 500,
          color: "var(--ds-muted-deep)",
          lineHeight: 1.4,
          whiteSpace: "pre-line",
          marginTop: "auto",
        }}
      >
        {step.detail}
      </div>
    </div>
  );
}

/* ─────────────────────────── overnight digest ─────────────────────────── */

/** Inline colored delta phrase inside the digest prose. */
function InlineDelta({ children, tone }: { children: React.ReactNode; tone: Tone }) {
  return <span style={{ color: toneVars(tone).color, fontWeight: 600 }}>{children}</span>;
}

function DigestBlock() {
  return (
    <div
      style={{
        position: "relative",
        padding: "16px 18px 16px 20px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border)",
        boxShadow: "var(--ds-shadow-card)",
        overflow: "hidden",
      }}
    >
      <span style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--ds-accent)" }} />
      <div className="ds-eyebrow" style={{ marginBottom: 10 }}>Overnight Digest</div>
      <p style={{ margin: 0, fontSize: 14.5, fontWeight: 500, color: "var(--ds-fg)", lineHeight: 1.65 }}>
        밤사이 가장 큰 변화는 <InlineDelta tone="rose">PostHog 활성 사용자 ▼ 56% 하락</InlineDelta>이에요.{" "}
        <InlineDelta tone="accent">Cloudflare 방문은 어제보다 늘었지만</InlineDelta>, 늘어난 유입이 온보딩에서 빠지고 있어요.
      </p>
      <div
        style={{
          display: "flex",
          flexWrap: "wrap",
          gap: "6px 18px",
          marginTop: 14,
          fontFamily: "var(--ds-mono)",
          fontSize: 11.5,
          fontWeight: 500,
          color: "var(--ds-muted)",
        }}
      >
        <span>Cloudflare 순 방문 <InlineDelta tone="accent">▲ 56%</InlineDelta></span>
        <span>GitHub 커밋 <InlineDelta tone="accent">▲ 50%</InlineDelta></span>
        <span>PostHog 활성 사용자 <InlineDelta tone="rose">▼ 56%</InlineDelta></span>
      </div>
    </div>
  );
}

/** The failed-sync banner that replaces the digest when a source can't be collected. */
function SyncFailedBanner() {
  return (
    <div
      style={{
        display: "flex",
        gap: 12,
        padding: "14px 16px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-danger-dim)",
        border: "1px solid var(--ds-danger-line)",
      }}
    >
      <span style={{ flex: "0 0 auto", color: "var(--ds-danger)", paddingTop: 1 }}>
        <Icon name="exclamationmark.triangle.fill" size={16} title="" />
      </span>
      <div style={{ minWidth: 0 }}>
        <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>이번 동기화는 완료하지 못했습니다</div>
        <div style={{ fontSize: 12, fontWeight: 500, color: "var(--ds-fg-secondary)", marginTop: 4, lineHeight: 1.5 }}>
          판정 생성 실패: ACP Codex mode requires CODEX_API_KEY or OPENAI_API_KEY. 이전 브리핑을 stale 상태로 유지합니다.
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────── scroll-spy sidebar ─────────────────────────── */

interface SpyItem {
  id: string;
  title: string;
  subtitle: string;
  /** dot color state: active(accent ring) / done(accent) / warn(amber) / alert(rose) / idle(muted) */
  state: "active" | "done" | "warn" | "alert" | "idle";
}

const SPY_ITEMS: SpyItem[] = [
  { id: "verdict", title: "오늘의 판정", subtitle: "검증 판단", state: "active" },
  { id: "sources", title: "소스 근거", subtitle: "Cloudflare · GitHub · Post…", state: "done" },
  { id: "funnel", title: "증거 퍼널", subtitle: "방문 → 검증 행동 → 결제", state: "done" },
  { id: "timeline", title: "밤사이 타임라인", subtitle: "17:50 → 03:30 · 3건", state: "idle" },
  { id: "actions", title: "오늘 검증 액션", subtitle: "메시지 · 실험 · 태스크", state: "warn" },
  { id: "anomaly", title: "이상 신호 확인", subtitle: "1건", state: "alert" },
];

const PAST_BRIEFINGS: { title: string; day: string; date: string }[] = [
  { title: "어제 — 배포 후 첫 유입", day: "Day 11", date: "2026-06-09" },
  { title: "가격 카피 A/B 시작", day: "Day 10", date: "2026-06-08" },
  { title: "랜딩 첫 봇 트래픽", day: "Day 9", date: "2026-06-07" },
];

function SpyDot({ state }: { state: SpyItem["state"] }) {
  const color =
    state === "warn"
      ? "var(--ds-warning)"
      : state === "alert"
        ? "var(--ds-danger)"
        : state === "idle"
          ? "var(--ds-muted-deep)"
          : "var(--ds-accent)";
  const ring = state === "active";
  return (
    <span
      style={{
        flex: "0 0 auto",
        width: 14,
        height: 14,
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        border: ring ? "1px solid var(--ds-accent-line)" : "1px solid transparent",
        background: ring ? "var(--ds-accent-dim)" : "transparent",
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: color }} />
    </span>
  );
}

function SpyRow({ item, activeId }: { item: SpyItem; activeId: string }) {
  const active = item.id === activeId;
  return (
    <button
      type="button"
      aria-current={active ? "true" : undefined}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "9px 10px",
        borderRadius: "var(--ds-r-control)",
        background: active ? "var(--ds-accent-dim)" : "transparent",
        border: active ? "1px solid var(--ds-accent-line)" : "1px solid transparent",
        cursor: "pointer",
        transition: "background var(--ds-dur-fast) var(--ds-ease-snap)",
      }}
    >
      <SpyDot state={item.state} />
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 600,
            color: active ? "var(--ds-fg)" : "var(--ds-fg-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.title}
        </span>
        <span
          style={{
            display: "block",
            fontSize: 11,
            fontWeight: 500,
            color: "var(--ds-muted)",
            marginTop: 1,
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {item.subtitle}
        </span>
      </span>
    </button>
  );
}

function PastRow({ title, day, date }: { title: string; day: string; date: string }) {
  return (
    <button
      type="button"
      style={{
        display: "flex",
        alignItems: "center",
        gap: 10,
        width: "100%",
        textAlign: "left",
        padding: "8px 10px",
        borderRadius: "var(--ds-r-control)",
        background: "transparent",
        border: "1px solid transparent",
        cursor: "pointer",
      }}
    >
      <span style={{ flex: "0 0 auto", width: 14, display: "inline-flex", justifyContent: "center" }}>
        <span style={{ width: 6, height: 6, borderRadius: 999, border: "1.5px solid var(--ds-muted-deep)" }} />
      </span>
      <span style={{ minWidth: 0, flex: 1 }}>
        <span
          style={{
            display: "block",
            fontSize: 12.5,
            fontWeight: 500,
            color: "var(--ds-fg-secondary)",
            overflow: "hidden",
            textOverflow: "ellipsis",
            whiteSpace: "nowrap",
          }}
        >
          {title}
        </span>
        <span style={{ display: "block", fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)", marginTop: 1 }}>
          {day} · {date}
        </span>
      </span>
    </button>
  );
}

/* ─────────────────────────── meta panel rows ─────────────────────────── */

interface SyncSource {
  name: string;
  initials: string;
  tone: Tone;
  status: string;
  statusTone: Tone | "muted";
}

function syncSources(failed: boolean): SyncSource[] {
  return [
    { name: "git", initials: "GT", tone: "muted", status: "연결됨", statusTone: "accent" },
    { name: "gh CLI", initials: "GH", tone: "muted", status: "연결됨", statusTone: "accent" },
    { name: "PostHog", initials: "PH", tone: "rose", status: "연결됨", statusTone: "accent" },
    {
      name: "Cloudflare",
      initials: "CF",
      tone: "amber",
      status: failed ? "미연결" : "연결됨",
      statusTone: failed ? "amber" : "accent",
    },
    { name: "마지막 동기화", initials: "", tone: "muted", status: "09:00", statusTone: "muted" },
  ];
}

function SyncSourceRow({ s }: { s: SyncSource }) {
  const isClock = s.name === "마지막 동기화";
  const statusColor =
    s.statusTone === "muted" ? "var(--ds-muted)" : toneVars(s.statusTone).color;
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      {isClock ? (
        <span
          style={{
            flex: "0 0 auto",
            width: 20,
            height: 20,
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ds-muted)",
          }}
        >
          <Icon name="clock" size={14} title="" />
        </span>
      ) : (
        <Avatar initials={s.initials} size={20} tone={s.tone} muted={s.tone === "muted"} />
      )}
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          fontWeight: 500,
          color: "var(--ds-fg-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {s.name}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flex: "0 0 auto" }}>
        {!isClock && <span style={{ width: 5, height: 5, borderRadius: 999, background: statusColor }} />}
        <span
          style={{
            fontFamily: isClock ? "var(--ds-mono)" : "var(--ds-sans)",
            fontSize: isClock ? 11.5 : 11.5,
            fontWeight: 600,
            color: statusColor,
          }}
        >
          {s.status}
        </span>
      </span>
    </div>
  );
}

/** 어제 대비 delta row in the meta panel. */
function MetaDeltaRow({
  initials,
  tone,
  label,
  dir,
  pct,
  value,
}: {
  initials: string;
  tone: Tone;
  label: string;
  dir: Dir;
  pct: number;
  value: string;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <Avatar initials={initials} size={20} tone={tone} muted={tone === "muted"} />
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontSize: 12.5,
          fontWeight: 500,
          color: "var(--ds-fg-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {label}
      </span>
      <span style={{ display: "inline-flex", alignItems: "center", gap: 6, flex: "0 0 auto" }}>
        <Delta dir={dir} pct={pct} size={10} />
        <span
          style={{
            fontFamily: "var(--ds-mono)",
            fontSize: 12,
            fontWeight: 600,
            color: "var(--ds-fg)",
            fontVariantNumeric: "tabular-nums",
          }}
        >
          {value}
        </span>
      </span>
    </div>
  );
}

/* ═══════════════════════════════ screen ═══════════════════════════════ */

export interface MorningBriefingScreenProps {
  /** Fixed pixel height for the framed window (the shell fills its container otherwise). */
  height?: number;
  /**
   * Render the failed-source variant: Cloudflare collection fails, the digest is
   * replaced by a sync-failed banner, the Cloudflare source card falls to a
   * SurfaceState error, and the meta panel marks Cloudflare 미연결.
   */
  failed?: boolean;
}

/**
 * The Morning Briefing (오늘 아침 브리핑) surface — a 3-pane workspace: a scroll-spy
 * briefing outline on the left, the digest → 소스 근거 → 증거 퍼널 stack in the
 * middle, and a 동기화 소스 / 이상 신호 / 어제 대비 meta panel on the right.
 */
export function MorningBriefingScreen({ height = 900, failed = false }: MorningBriefingScreenProps) {
  const sources = withFailure(SOURCES, failed);
  const activeSpy = "verdict";

  /* ── left rail ── */
  const rail = (
    <WorkspaceRail
      items={[
        { icon: "calendar", title: "오늘" },
        { icon: "play.rectangle.on.rectangle", title: "Founder Replay" },
        { icon: "chart.line.uptrend.xyaxis", title: "전략" },
        { icon: "newspaper", title: "뉴스" },
        { icon: "sunrise", active: true, title: "아침 브리핑" },
        { icon: "gearshape", title: "설정" },
      ]}
      footer={<Avatar initials="Z" size={34} tone="accent" />}
    />
  );

  const titlebar = (
    <Titlebar
      breadcrumb={{ page: "Day 1 · 초기 검증", detail: "고객 후보 좁히기" }}
      actions={
        <>
          <span style={{ display: "inline-flex", alignItems: "center", padding: 6, color: "var(--ds-muted)" }}>
            <Icon name="magnifyingglass" size={15} title="검색" />
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", padding: 6, color: "var(--ds-muted)" }}>
            <Icon name="square.and.arrow.up" size={15} title="공유" />
          </span>
          <span style={{ display: "inline-flex", alignItems: "center", padding: 6, color: "var(--ds-muted)" }}>
            <Icon name="sidebar.right" size={15} title="사이드바 토글" />
          </span>
        </>
      }
    />
  );

  /* ── left scroll-spy sidebar ── */
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
          alignItems: "center",
          justifyContent: "space-between",
          gap: 8,
          padding: "0 18px",
          borderBottom: "1px solid var(--ds-border-soft)",
        }}
      >
        <span style={{ fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>오늘 아침</span>
        <Badge tone="accent">Day 12</Badge>
      </div>

      <div className="ds-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "14px 12px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", padding: "0 6px" }}>
            <GroupLabel style={{ padding: 0 }}>이 브리핑</GroupLabel>
            <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)" }}>
              오늘 09:00
            </span>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {SPY_ITEMS.map((it) => (
              <SpyRow key={it.id} item={it} activeId={activeSpy} />
            ))}
          </div>

          <GroupLabel style={{ paddingTop: 4 }}>지난 브리핑</GroupLabel>
          <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>
            {PAST_BRIEFINGS.map((p) => (
              <PastRow key={p.date} {...p} />
            ))}
          </div>
        </div>
      </div>
    </div>
  );

  /* ── main header ── */
  const header = (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 14, marginBottom: 18 }}>
      <div
        style={{
          flex: "0 0 auto",
          width: 44,
          height: 44,
          borderRadius: "var(--ds-r-control)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          background: "var(--ds-accent-dim)",
          border: "1px solid var(--ds-accent-line)",
          fontFamily: "var(--ds-rounded)",
          fontSize: 19,
          fontWeight: 700,
          color: "var(--ds-accent)",
        }}
      >
        12
      </div>
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
        <span style={{ fontSize: 19, fontWeight: 700, color: "var(--ds-fg)", letterSpacing: "var(--ds-track-tight)" }}>
          오늘 아침 브리핑
        </span>
        <div
          style={{
            display: "flex",
            alignItems: "center",
            flexWrap: "wrap",
            gap: "4px 8px",
            fontSize: 12,
            fontWeight: 500,
            color: "var(--ds-muted)",
          }}
        >
          <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
            <span style={{ width: 5, height: 5, borderRadius: 999, background: "var(--ds-accent)" }} />
            Day 12 / 30
          </span>
          <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
          <span style={{ color: "var(--ds-fg-secondary)" }}>Build</span>
          <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
          <span>소스 {failed ? "3" : "4"} 연결됨</span>
          <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
          <span>09:00 동기화</span>
          <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
          <span style={{ color: "var(--ds-danger)", fontWeight: 600 }}>이상 신호 1</span>
        </div>
      </div>
      <Button variant="ghost" size="sm" icon={<Icon name="arrow.clockwise" size={13} title="" />}>
        다시 동기화
      </Button>
    </div>
  );

  /* ── source-connection chip row ── */
  const chipRow = (
    <div style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap", marginBottom: 22 }}>
      <Badge tone="accent" dot>git 연결됨</Badge>
      <Badge tone="accent" dot>gh CLI 연결됨</Badge>
      <Badge tone="accent" dot>PostHog 연결됨</Badge>
      {failed ? <Badge tone="rose" dot>Cloudflare 수집 실패</Badge> : <Badge tone="accent" dot>Cloudflare 연결됨</Badge>}
      <span style={{ flex: 1 }} />
      <span
        style={{
          display: "inline-flex",
          alignItems: "center",
          gap: 5,
          fontFamily: "var(--ds-mono)",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--ds-muted)",
        }}
      >
        <Icon name="clock" size={12} title="" />
        지난 24시간
      </span>
    </div>
  );

  const main = (
    <>
      {header}
      {chipRow}

      {/* 오늘의 판정 */}
      <section style={{ marginBottom: 26 }}>
        <BriefingSectionHeader
          title="오늘의 판정"
          caption={failed ? undefined : "2026-06-09 00:00 → 2026-06-10 now"}
          tone={failed ? "rose" : "accent"}
        />
        {failed ? (
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <SyncFailedBanner />
            <DigestBlock />
          </div>
        ) : (
          <DigestBlock />
        )}
      </section>

      {/* 소스 근거 */}
      <section style={{ marginBottom: 26 }}>
        <BriefingSectionHeader title="소스 근거 · 어제 대비" caption="판정 아래 원자료" tone="accent" />
        <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 12 }}>
          {sources.map((s) => (
            <SourceCard key={s.key} model={s} />
          ))}
        </div>
      </section>

      {/* 증거 퍼널 */}
      <section>
        <BriefingSectionHeader title="증거 퍼널" caption="방문 → 다운로드/설치 → 검증 행동" tone="accent" />
        <div style={{ display: "flex", gap: 10 }}>
          {FUNNEL.map((step, i) => (
            <FunnelTile key={i} step={step} />
          ))}
        </div>
      </section>
    </>
  );

  /* ── right meta panel ── */
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
      <div className="ds-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "18px 16px 22px" }}>
        <div style={{ display: "flex", flexDirection: "column", gap: 18 }}>
          {/* 30일 진행 */}
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              gap: 10,
              padding: 14,
              borderRadius: "var(--ds-r-card)",
              background: "var(--ds-surface-2)",
              border: "1px solid var(--ds-border-soft)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 7 }}>
              <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
              <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, letterSpacing: "var(--ds-track-eyebrow)", textTransform: "uppercase", color: "var(--ds-muted)" }}>
                30일 진행
              </span>
            </div>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: 8 }}>
              <div style={{ display: "flex", alignItems: "baseline", gap: 5 }}>
                <span style={{ fontFamily: "var(--ds-rounded)", fontSize: 30, fontWeight: 700, lineHeight: 1, color: "var(--ds-fg)", fontVariantNumeric: "tabular-nums" }}>
                  12
                </span>
                <span style={{ fontFamily: "var(--ds-mono)", fontSize: 13, color: "var(--ds-muted)" }}>/ 30</span>
              </div>
              <Badge tone="accent">Build</Badge>
            </div>
            <div style={{ height: 4, borderRadius: 999, background: "var(--ds-border)", overflow: "hidden" }}>
              <div style={{ width: "40%", height: "100%", borderRadius: 999, background: "var(--ds-accent)" }} />
            </div>
          </div>

          {/* 동기화 소스 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <GroupLabel>동기화 소스</GroupLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {syncSources(failed).map((s) => (
                <SyncSourceRow key={s.name} s={s} />
              ))}
            </div>
          </div>

          {/* 이상 신호 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between" }}>
              <GroupLabel style={{ padding: 0 }}>이상 신호</GroupLabel>
              <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11, fontWeight: 700, color: "var(--ds-danger)" }}>1</span>
            </div>
            <div style={{ display: "flex", alignItems: "flex-start", gap: 9 }}>
              <span style={{ flex: "0 0 auto", color: "var(--ds-danger)", paddingTop: 1 }}>
                <Icon name="exclamationmark.triangle" size={14} title="" />
              </span>
              <div style={{ minWidth: 0 }}>
                <div style={{ fontSize: 12.5, fontWeight: 600, color: "var(--ds-fg)" }}>PostHog 신호 하락</div>
                <div style={{ fontSize: 11, fontWeight: 500, color: "var(--ds-muted)", marginTop: 2 }}>확인 대기</div>
              </div>
            </div>
          </div>

          {/* 어제 대비 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
            <GroupLabel>어제 대비</GroupLabel>
            <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
              {!failed && (
                <MetaDeltaRow initials="CF" tone="amber" label="순 방문" dir="up" pct={56} value="64" />
              )}
              <MetaDeltaRow initials="GH" tone="muted" label="커밋" dir="up" pct={50} value="9" />
              <MetaDeltaRow initials="PH" tone="rose" label="활성 사용자" dir="down" pct={56} value="11" />
            </div>
          </div>

          {/* 다음 */}
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <GroupLabel>다음</GroupLabel>
            <button
              type="button"
              style={{
                display: "flex",
                alignItems: "center",
                gap: 12,
                width: "100%",
                textAlign: "left",
                padding: 14,
                borderRadius: "var(--ds-r-card)",
                background: "var(--ds-surface-2)",
                border: "1px solid var(--ds-border-soft)",
                cursor: "pointer",
              }}
            >
              <span
                style={{
                  flex: "0 0 auto",
                  width: 34,
                  height: 34,
                  borderRadius: "var(--ds-r-control)",
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "center",
                  background: "var(--ds-accent-dim)",
                  border: "1px solid var(--ds-accent-line)",
                  fontFamily: "var(--ds-rounded)",
                  fontSize: 15,
                  fontWeight: 700,
                  color: "var(--ds-accent)",
                }}
              >
                12
              </span>
              <span style={{ minWidth: 0, flex: 1 }}>
                <span style={{ display: "block", fontSize: 12.5, fontWeight: 600, color: "var(--ds-fg)", lineHeight: 1.3 }}>
                  브리핑 닫고 Day 12 시작
                </span>
                <span style={{ display: "block", fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)", marginTop: 3 }}>
                  Build · 오늘 · 빌드로 이동
                </span>
              </span>
              <span style={{ flex: "0 0 auto", color: "var(--ds-muted)" }}>
                <Icon name="arrow.right" size={15} title="" />
              </span>
            </button>
          </div>
        </div>
      </div>
    </aside>
  );

  return (
    <div style={{ height, minHeight: 0 }}>
      <WorkspaceShell rail={rail} titlebar={titlebar} sidebar={sidebar} meta={meta} main={main} />
    </div>
  );
}

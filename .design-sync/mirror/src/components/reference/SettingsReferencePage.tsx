import React from "react";
import { Tone, toneVars } from "../../tokens";
import { Toggle } from "../Toggle";
import { Sparkline } from "../Sparkline";
import { Rail } from "./Rail";
import { SideRow } from "./SideRow";
import { ReferenceSidebar } from "./ReferenceSidebar";
import { Titlebar } from "./Titlebar";
import { ReferenceHeader } from "./ReferenceHeader";
import { MetaPanel } from "./MetaPanel";
import { ReferenceShell } from "./ReferenceShell";

/* ────────────────────────── small local building blocks ────────────────────────── */

/** A left rounded-square glyph tile used by the sidebar rows (⌂ / ◐ / </>). */
function GlyphTile({ glyph, tone = "accent", muted }: { glyph: React.ReactNode; tone?: Tone; muted?: boolean }) {
  const t = toneVars(tone);
  return (
    <span
      style={{
        width: 28,
        height: 28,
        flex: "0 0 auto",
        borderRadius: "var(--ds-r-control)",
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontFamily: "var(--ds-mono)",
        fontSize: 12,
        fontWeight: 700,
        color: muted ? "var(--ds-fg-secondary)" : t.color,
        background: muted ? "var(--ds-surface-2)" : t.dim,
        border: `1px solid ${muted ? "var(--ds-border-strong)" : t.line}`,
      }}
    >
      {glyph}
    </span>
  );
}

/** Mono status pill — dot + label, tinted by tone (mirrors settingsStatusPill). */
function StatusPill({ text, tone = "accent" }: { text: React.ReactNode; tone?: Tone }) {
  const isMuted = tone === "muted";
  const color = isMuted ? "var(--ds-muted)" : toneVars(tone).color;
  const dot = isMuted ? "var(--ds-muted-deep)" : toneVars(tone).color;
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 5,
        height: 22,
        padding: "0 8px",
        borderRadius: "var(--ds-r-pill)",
        fontFamily: "var(--ds-mono)",
        fontSize: 10,
        fontWeight: 500,
        whiteSpace: "nowrap",
        color,
        background: isMuted ? "var(--ds-bg-darker)" : toneVars(tone).dim,
        border: `1px solid ${isMuted ? "var(--ds-border-soft)" : toneVars(tone).line}`,
      }}
    >
      <span style={{ width: 6, height: 6, borderRadius: 999, background: dot }} />
      {text}
    </span>
  );
}

/** Bordered ghost button (mirrors settingsGhostButton). */
function GhostButton({
  label,
  glyph,
  tone = "muted",
  width,
}: {
  label: React.ReactNode;
  glyph?: React.ReactNode;
  tone?: "muted" | "rose";
  width?: number;
}) {
  const isRose = tone === "rose";
  return (
    <button
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        gap: 6,
        height: 28,
        width,
        padding: "0 12px",
        borderRadius: "var(--ds-r-chip)",
        fontFamily: "var(--ds-sans)",
        fontSize: 11.5,
        fontWeight: 500,
        whiteSpace: "nowrap",
        cursor: "pointer",
        color: isRose ? "var(--ds-danger)" : "var(--ds-fg-secondary)",
        background: isRose ? "var(--ds-danger-dim)" : "transparent",
        border: `1px solid ${isRose ? "var(--ds-danger-line)" : "var(--ds-border-soft)"}`,
      }}
    >
      {glyph != null && <span style={{ display: "inline-flex", fontSize: 11 }}>{glyph}</span>}
      {label}
    </button>
  );
}

/** Read-only workspace path pill (folder glyph + mono path). */
function PathPill({ text }: { text: React.ReactNode }) {
  return (
    <span
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 7,
        width: 280,
        height: 30,
        padding: "0 9px",
        borderRadius: "var(--ds-r-chip)",
        background: "var(--ds-bg-darker)",
        border: "1px solid var(--ds-border-soft)",
        overflow: "hidden",
      }}
    >
      <span style={{ flex: "0 0 auto", color: "var(--ds-muted)", fontSize: 12 }}>🗀</span>
      <span
        style={{
          flex: 1,
          minWidth: 0,
          fontFamily: "var(--ds-mono)",
          fontSize: 11.5,
          fontWeight: 500,
          color: "var(--ds-fg-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {text}
      </span>
    </span>
  );
}

/** Mono segmented control (Dark / Light). Active = tinted (mirrors OpenDesignSettingsSegmented). */
function SettingsSegmented({ values, active, tone = "sky" }: { values: string[]; active: string; tone?: Tone }) {
  const t = toneVars(tone);
  return (
    <div
      style={{
        display: "inline-flex",
        gap: 2,
        padding: 2,
        borderRadius: "var(--ds-r-control)",
        background: "var(--ds-bg-darker)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      {values.map((v) => {
        const isActive = v === active;
        return (
          <span
            key={v}
            style={{
              display: "inline-flex",
              alignItems: "center",
              justifyContent: "center",
              height: 24,
              padding: "0 11px",
              borderRadius: 6,
              fontFamily: "var(--ds-mono)",
              fontSize: 11.5,
              fontWeight: 500,
              color: isActive ? t.color : "var(--ds-muted)",
              background: isActive ? t.dim : "transparent",
            }}
          >
            {v}
          </span>
        );
      })}
    </div>
  );
}

/* ── section-title bar (mirrors OpenDesignSettingsSectionView header) ── */
function SettingsSectionTitle({
  title,
  meta,
  markerTone = "accent",
  first,
}: {
  title: React.ReactNode;
  meta?: React.ReactNode;
  markerTone?: Tone;
  first?: boolean;
}) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 10, marginTop: first ? 4 : 26, marginBottom: 12 }}>
      <span style={{ width: 4, height: 12, borderRadius: 2, background: toneVars(markerTone).color, flex: "0 0 auto" }} />
      <span
        style={{
          fontFamily: "var(--ds-mono)",
          fontSize: 11,
          fontWeight: 500,
          textTransform: "uppercase",
          color: "var(--ds-muted)",
          whiteSpace: "nowrap",
        }}
      >
        {title}
      </span>
      {meta != null && (
        <span
          style={{
            fontFamily: "var(--ds-mono)",
            fontSize: 10.5,
            fontWeight: 500,
            color: "var(--ds-muted-deep)",
            whiteSpace: "nowrap",
          }}
        >
          {meta}
        </span>
      )}
      <span style={{ flex: 1, height: 1, background: "var(--ds-border-soft)" }} />
    </div>
  );
}

/* ── settings-style card: stacked rows with a title/subtitle + trailing control ── */
interface SettingsRow {
  id: string;
  title: React.ReactNode;
  subtitle?: React.ReactNode;
  control: React.ReactNode;
}

function SettingsRowsCard({ rows }: { rows: SettingsRow[] }) {
  return (
    <div
      style={{
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
        borderRadius: "var(--ds-r-card)",
        overflow: "hidden",
      }}
    >
      {rows.map((row, i) => (
        <React.Fragment key={row.id}>
          <div style={{ display: "flex", alignItems: "center", gap: 16, padding: "12px 16px" }}>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>{row.title}</div>
              {row.subtitle != null && (
                <div style={{ marginTop: 3, fontSize: 12, color: "var(--ds-muted)", lineHeight: 1.55 }}>
                  {row.subtitle}
                </div>
              )}
            </div>
            <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8 }}>{row.control}</div>
          </div>
          {i < rows.length - 1 && <div style={{ height: 1, background: "var(--ds-border-soft)" }} />}
        </React.Fragment>
      ))}
    </div>
  );
}

/* ── provider card (Claude/Codex/Gemini/Node) — header row + detail key/values ── */
interface ProviderModel {
  id: string;
  logo: React.ReactNode;
  logoBg: string;
  logoFg: string;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  status: { text: React.ReactNode; tone: Tone };
  loginButton?: boolean;
  detail: { status: React.ReactNode; policy: React.ReactNode };
}

function ProviderDetailRow({ label, value }: { label: React.ReactNode; value: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 14, padding: "7px 10px" }}>
      <span
        style={{
          flex: "0 0 58px",
          fontFamily: "var(--ds-mono)",
          fontSize: 10.5,
          fontWeight: 500,
          letterSpacing: "0.06em",
          textTransform: "uppercase",
          color: "var(--ds-muted)",
        }}
      >
        {label}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 12, color: "var(--ds-fg-secondary)", lineHeight: 1.45 }}>
        {value}
      </span>
    </div>
  );
}

function ProviderList({ providers }: { providers: ProviderModel[] }) {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {providers.map((p) => (
        <div
          key={p.id}
          style={{
            background: "var(--ds-bg-darker)",
            border: "1px solid var(--ds-border-soft)",
            borderRadius: 10,
            overflow: "hidden",
          }}
        >
          <div
            style={{
              display: "flex",
              alignItems: "center",
              gap: 10,
              padding: "10px 14px",
              background: "var(--ds-surface)",
              borderBottom: "1px solid var(--ds-border-soft)",
            }}
          >
            <span
              style={{
                width: 26,
                height: 26,
                flex: "0 0 auto",
                borderRadius: 6,
                display: "inline-flex",
                alignItems: "center",
                justifyContent: "center",
                fontFamily: "var(--ds-mono)",
                fontSize: 12,
                fontWeight: 700,
                color: p.logoFg,
                background: p.logoBg,
              }}
            >
              {p.logo}
            </span>
            <div style={{ minWidth: 0, flex: 1 }}>
              <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>{p.title}</div>
              <div
                style={{
                  marginTop: 2,
                  fontFamily: "var(--ds-mono)",
                  fontSize: 10.5,
                  fontWeight: 500,
                  color: "var(--ds-muted)",
                  overflow: "hidden",
                  textOverflow: "ellipsis",
                  whiteSpace: "nowrap",
                }}
              >
                {p.subtitle}
              </div>
            </div>
            <StatusPill text={p.status.text} tone={p.status.tone} />
            {p.loginButton && <GhostButton label="로그인" width={62} />}
          </div>
          <div style={{ padding: "4px 6px" }}>
            <ProviderDetailRow label="상태" value={p.detail.status} />
            <ProviderDetailRow label="정책" value={p.detail.policy} />
          </div>
        </div>
      ))}
    </div>
  );
}

/* ── integration card (Exa / GitHub / Cloudflare / PostHog / Notion) ── */
interface IntegrationModel {
  id: string;
  logo: React.ReactNode;
  title: React.ReactNode;
  subtitle: React.ReactNode;
  status: React.ReactNode;
  tone: Tone;
}

function IntegrationCard({ rows }: { rows: IntegrationModel[] }) {
  return (
    <div
      style={{
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
        borderRadius: "var(--ds-r-card)",
        overflow: "hidden",
      }}
    >
      {rows.map((row, i) => {
        const isMuted = row.tone === "muted";
        const t = toneVars(row.tone);
        const logoLen = typeof row.logo === "string" ? row.logo.length : 1;
        return (
          <React.Fragment key={row.id}>
            <div style={{ display: "flex", alignItems: "center", gap: 12, padding: "12px 16px" }}>
              <span
                style={{
                  width: 28,
                  height: 28,
                  flex: "0 0 auto",
                  borderRadius: 7,
                  display: "inline-flex",
                  alignItems: "center",
                  justifyContent: "center",
                  fontFamily: "var(--ds-mono)",
                  fontSize: logoLen > 2 ? 9.5 : 11,
                  fontWeight: 700,
                  color: isMuted ? "var(--ds-fg-secondary)" : t.color,
                  background: isMuted ? "var(--ds-bg-darker)" : t.dim,
                  border: `1px solid ${isMuted ? "var(--ds-border)" : t.line}`,
                }}
              >
                {row.logo}
              </span>
              <div style={{ minWidth: 0, flex: 1 }}>
                <div style={{ fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>{row.title}</div>
                <div
                  style={{
                    marginTop: 3,
                    fontFamily: "var(--ds-mono)",
                    fontSize: 10.5,
                    fontWeight: 500,
                    color: "var(--ds-muted)",
                    lineHeight: 1.5,
                  }}
                >
                  {row.subtitle}
                </div>
              </div>
              <div style={{ flex: "0 0 auto", display: "flex", alignItems: "center", gap: 8 }}>
                <StatusPill text={row.status} tone="muted" />
                <GhostButton label="연결" width={54} />
              </div>
            </div>
            {i < rows.length - 1 && <div style={{ height: 1, background: "var(--ds-border-soft)" }} />}
          </React.Fragment>
        );
      })}
    </div>
  );
}

/* ── header action buttons (기본값으로 · 모두 저장됨) ── */
function HeaderActionButton({ glyph, label, tone }: { glyph: React.ReactNode; label: React.ReactNode; tone: "ghost" | "accent" }) {
  const isAccent = tone === "accent";
  return (
    <button
      type="button"
      style={{
        display: "inline-flex",
        alignItems: "center",
        gap: 6,
        height: 30,
        padding: "0 12px",
        borderRadius: "var(--ds-r-control)",
        fontFamily: "var(--ds-sans)",
        fontSize: 12,
        fontWeight: 600,
        whiteSpace: "nowrap",
        cursor: "pointer",
        color: isAccent ? "var(--ds-accent)" : "var(--ds-fg-secondary)",
        background: isAccent ? "var(--ds-accent-dim)" : "transparent",
        border: `1px solid ${isAccent ? "var(--ds-accent-line)" : "var(--ds-border)"}`,
      }}
    >
      <span style={{ display: "inline-flex", fontSize: 12 }}>{glyph}</span>
      {label}
    </button>
  );
}

/* ─────────────────────── meta-panel building blocks ─────────────────────── */

function MetaLiveCard({ label, live, children }: { label: React.ReactNode; live?: boolean; children: React.ReactNode }) {
  return (
    <div
      style={{
        padding: "12px 14px",
        borderRadius: 10,
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 6, marginBottom: 8 }}>
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: 999,
            background: live ? "var(--ds-accent)" : "var(--ds-muted-deep)",
          }}
        />
        <span
          style={{
            fontFamily: "var(--ds-mono)",
            fontSize: 10.5,
            fontWeight: 500,
            textTransform: "uppercase",
            color: "var(--ds-muted)",
          }}
        >
          {label}
        </span>
      </div>
      <div style={{ display: "flex", flexDirection: "column", gap: 2 }}>{children}</div>
    </div>
  );
}

function MetaKV({ k, v, strong }: { k: React.ReactNode; v: React.ReactNode; strong?: boolean }) {
  return (
    <div style={{ display: "flex", alignItems: "baseline", gap: 8, padding: "1px 0" }}>
      <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11, fontWeight: 500, color: "var(--ds-muted)" }}>{k}</span>
      <span style={{ flex: 1 }} />
      <span
        style={{
          fontFamily: "var(--ds-mono)",
          fontSize: 11,
          fontWeight: strong ? 600 : 500,
          color: strong ? "var(--ds-fg)" : "var(--ds-fg-secondary)",
          overflow: "hidden",
          textOverflow: "ellipsis",
          whiteSpace: "nowrap",
        }}
      >
        {v}
      </span>
    </div>
  );
}

function MetaHeading({ children }: { children: React.ReactNode }) {
  return (
    <div
      style={{
        margin: "0 0 8px",
        padding: "0 4px",
        fontFamily: "var(--ds-mono)",
        fontSize: 10.5,
        fontWeight: 500,
        letterSpacing: "0.1em",
        textTransform: "uppercase",
        color: "var(--ds-muted-deep)",
      }}
    >
      {children}
    </div>
  );
}

function MetaAction({ glyph, title, subtitle }: { glyph: React.ReactNode; title: React.ReactNode; subtitle: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "flex-start", gap: 12, padding: "9px 6px" }}>
      <span style={{ flex: "0 0 22px", height: 22, display: "inline-flex", alignItems: "center", justifyContent: "center", color: "var(--ds-muted)", fontSize: 13 }}>
        {glyph}
      </span>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ds-fg-secondary)", textDecoration: "underline" }}>
          {title}
        </div>
        <div style={{ marginTop: 3, fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)" }}>
          {subtitle}
        </div>
      </div>
    </div>
  );
}

/* ─────────────────────────────── page ─────────────────────────────── */

export interface SettingsReferencePageProps {
  /** Fixed pixel height for the framed window (the shell fills its container otherwise). */
  height?: number;
}

/** Faithful mirror of the Agentic30 Settings (설정) reference screen. */
export function SettingsReferencePage({ height = 900 }: SettingsReferencePageProps) {
  const rail = (
    <Rail
      items={[
        { icon: "▦" },
        { icon: "▷" },
        { icon: "◫" },
        { icon: "▤" },
        { icon: "◵" },
        { icon: "⚙", active: true },
      ]}
      footer={<GlyphTile glyph="⚙" tone="accent" />}
    />
  );

  const sidebar = (
    <ReferenceSidebar
      title="설정"
      search="설정 검색"
      groups={[
        {
          label: "General",
          rows: [
            <SideRow active leading={<GlyphTile glyph="⌂" tone="accent" />} title="워크스페이스" />,
            <SideRow leading={<GlyphTile glyph="◐" tone="sky" muted />} title="외관" />,
            <SideRow leading={<GlyphTile glyph="!" tone="amber" muted />} title="메뉴바 & 알림" />,
          ],
        },
        {
          label: "Agent",
          rows: [
            <SideRow leading={<GlyphTile glyph="</>" tone="accent" muted />} title="AI 연결" />,
            <SideRow leading={<GlyphTile glyph="∞" tone="amber" muted />} title="연동" />,
          ],
        },
        {
          label: "Trust",
          rows: [
            <SideRow leading={<GlyphTile glyph="◇" tone="rose" muted />} title="개인정보 & 진단" />,
            <SideRow leading={<GlyphTile glyph="↻" tone="sky" muted />} title="업데이트" />,
            <SideRow leading={<GlyphTile glyph="$" tone="muted" muted />} title="고급 & 실행 보조 앱" />,
          ],
        },
      ]}
      footer={
        <div style={{ display: "flex", alignItems: "center", gap: 7, fontSize: 12, color: "var(--ds-muted)" }}>
          <span style={{ width: 6, height: 6, borderRadius: 999, background: "var(--ds-accent)" }} />
          실행 보조 앱 <span style={{ color: "var(--ds-fg-secondary)" }}>실행 중</span> · PID 47281
        </div>
      }
    />
  );

  const titlebar = <Titlebar breadcrumb={{ page: "설정", detail: "워크스페이스" }} />;

  const header = (
    <ReferenceHeader
      icon={<GlyphTile glyph="⚙" tone="accent" />}
      title="설정"
      subtitleParts={["Agentic30 · 로컬 우선", "zettalyst@gmail.com", "변경 사항 자동 저장"]}
      actions={
        <>
          <HeaderActionButton glyph="🗑" label="기본값으로" tone="ghost" />
          <HeaderActionButton glyph="✓" label="모두 저장됨" tone="accent" />
        </>
      }
    />
  );

  const providers: ProviderModel[] = [
    {
      id: "claude",
      logo: "A",
      logoBg: "var(--ds-warning)",
      logoFg: "var(--ds-bg-deep)",
      title: "Claude",
      subtitle: "로컬 인증 또는 API 키 · 모델 선택",
      status: { text: "설정됨", tone: "accent" },
      detail: {
        status: "에이전트 설정은 Keychain 저장값과 실행 보조 앱의 AI 연결 설정에 동기화됩니다.",
        policy: "로컬 인증 또는 API 키",
      },
    },
    {
      id: "codex",
      logo: "C",
      logoBg: "var(--ds-fg-secondary)",
      logoFg: "var(--ds-bg-deep)",
      title: "Codex",
      subtitle: "로컬 인증 또는 API 키 · 모델 선택",
      status: { text: "설정됨", tone: "accent" },
      loginButton: true,
      detail: {
        status: "OpenAI/Codex 인증 방식과 모델 ID를 저장합니다.",
        policy: "로컬 인증 또는 API 키",
      },
    },
    {
      id: "gemini",
      logo: "G",
      logoBg: "var(--ds-sky-dim)",
      logoFg: "var(--ds-sky)",
      title: "Gemini",
      subtitle: "API 키 · 모델 선택",
      status: { text: "선택", tone: "sky" },
      detail: {
        status: "Gemini API 키와 모델 ID를 Keychain에 저장합니다.",
        policy: "API 키",
      },
    },
    {
      id: "node",
      logo: "20",
      logoBg: "var(--ds-sky)",
      logoFg: "var(--ds-bg-deep)",
      title: "Node 런타임",
      subtitle: "/usr/local/bin/node — v20.11.1",
      status: { text: "20+", tone: "sky" },
      detail: {
        status:
          "실행 보조 앱이 사용하는 Node 바이너리. 20+ 필요. NODE_BINARY → 일반 설치 → mise/asdf/Volta → 로그인 셸 PATH 순으로 탐색합니다.",
        policy: "로컬 런타임",
      },
    },
  ];

  const integrations: IntegrationModel[] = [
    {
      id: "exa",
      logo: "E",
      title: "Exa Search",
      subtitle: "뉴스/마켓 레이더가 공개 근거를 검색할 때 사용하는 Exa MCP 키입니다.",
      status: "Keychain",
      tone: "amber",
    },
    {
      id: "github",
      logo: "GH",
      title: "GitHub",
      subtitle: "gh CLI 인증으로 PR / 이슈 / 릴리즈 활동을 읽어 History에 반영합니다.",
      status: "gh 로그인",
      tone: "amber",
    },
    {
      id: "cloudflare",
      logo: "CF",
      title: "Cloudflare",
      subtitle: "Cloudflare MCP 토큰과 endpoint를 저장해 Workers, R2, DNS 도구를 AI 실행에 연결합니다.",
      status: "MCP",
      tone: "amber",
    },
    {
      id: "posthog-mcp",
      logo: "PH",
      title: "PostHog",
      subtitle: "phx_ / pha_ personal API key로 HogQL, insights, web analytics MCP 도구를 연결합니다.",
      status: "MCP",
      tone: "amber",
    },
    {
      id: "notion",
      logo: "N",
      title: "Notion",
      subtitle: "SPEC.md / ICP.md / VALUES.md 변경분을 지정한 페이지로 양방향 동기화.",
      status: "연결 안 됨",
      tone: "muted",
    },
  ];

  const main = (
    <>
      {header}

      <SettingsSectionTitle title="워크스페이스" meta="메인 프로젝트" markerTone="accent" first />
      <SettingsRowsCard
        rows={[
          {
            id: "main",
            title: "메인 프로젝트",
            subtitle: "맞춤형 엔진이 가장 먼저 읽는 폴더. SPEC.md / ICP.md / VALUES.md와 업무 일지가 여기에 누적됩니다.",
            control: (
              <>
                <PathPill text="~/code/agentic30-public" />
                <GhostButton label="변경..." width={70} />
              </>
            ),
          },
        ]}
      />

      <SettingsSectionTitle title="외관" meta="Dark · Light" markerTone="sky" />
      <SettingsRowsCard
        rows={[
          {
            id: "theme",
            title: "테마",
            subtitle: "Dark 또는 Light 테마를 즉시 적용합니다.",
            control: <SettingsSegmented values={["Dark", "Light"]} active="Dark" tone="sky" />,
          },
        ]}
      />

      <SettingsSectionTitle title="메뉴바 & 알림" meta="로그인 항목" markerTone="amber" />
      <SettingsRowsCard
        rows={[
          {
            id: "login",
            title: "로그인 시 자동 실행",
            subtitle: "macOS 로그인 항목에 추가합니다. Launch Agent — com.octobacademy.agentic30.plist.",
            control: <Toggle checked />,
          },
        ]}
      />

      <SettingsSectionTitle title="AI 연결" meta="Claude 1순위 · Codex 예비 연결" markerTone="accent" />
      <ProviderList providers={providers} />

      <SettingsSectionTitle title="연동" meta="OAuth · API 키 — Keychain 보관" markerTone="amber" />
      <IntegrationCard rows={integrations} />

      <SettingsSectionTitle title="개인정보 & 진단" meta="로컬 우선 · sanitized snapshot only" markerTone="rose" />
      <SettingsRowsCard
        rows={[
          {
            id: "posthog",
            title: "사용량 텔레메트리 (PostHog)",
            subtitle:
              "앱 열기 횟수, Day 도달 일자, 작업 완료/포기 같은 익명 이벤트. opt-in이며 KR1.1 ~ KR4.3 측정에만 쓰입니다.",
            control: <Toggle />,
          },
          {
            id: "snapshot",
            title: "진단 스냅샷 내보내기",
            subtitle: "제출 전 미리보기 — 민감 정보가 제거된 실행 상태를 클립보드로 복사합니다.",
            control: <GhostButton label="내보내기..." width={104} />,
          },
          {
            id: "reset",
            title: "모든 로컬 데이터 삭제",
            subtitle: "sessions, day-task 히스토리, 캐시. 기록 폴더 자체는 건드리지 않습니다.",
            control: <GhostButton label="데이터 초기화…" width={118} tone="rose" />,
          },
        ]}
      />

      <SettingsSectionTitle title="업데이트" meta="Sparkle appcast · Developer ID 서명" markerTone="sky" />
      <SettingsRowsCard
        rows={[
          {
            id: "version",
            title: "현재 버전",
            subtitle: "초기 검증 미리보기 — Day 0-3 흐름 한정. Day 4-7은 다음 점 릴리즈 예정.",
            control: (
              <>
                <StatusPill text="0.4.2" tone="accent" />
                <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10.5, fontWeight: 500, color: "var(--ds-muted)" }}>
                  build 1042 · arm64
                </span>
              </>
            ),
          },
          {
            id: "auto",
            title: "자동 업데이트",
            subtitle: "Sparkle이 백그라운드에서 appcast를 확인하고 새 버전을 받아옵니다. 설치는 다음 실행 때.",
            control: <Toggle checked />,
          },
          {
            id: "checked",
            title: "마지막 확인",
            subtitle: "appcast.xml을 마지막으로 조회한 시각. 최신 — 0.4.2.",
            control: (
              <>
                <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11.5, fontWeight: 500, color: "var(--ds-muted)" }}>
                  5분 전
                </span>
                <GhostButton label="지금 확인" glyph="⟳" width={88} />
              </>
            ),
          },
          {
            id: "signing",
            title: "서명 확인",
            subtitle: "notarization · Hardened Runtime · Developer ID · 모두 통과.",
            control: <StatusPill text="검증됨" tone="accent" />,
          },
        ]}
      />

      <SettingsSectionTitle title="고급 & 실행 보조 앱" meta="실행 보조 앱 · 진단 · 로그" markerTone="muted" />
      <SettingsRowsCard
        rows={[
          {
            id: "state",
            title: "실행 보조 앱 상태",
            subtitle: "Node 실행 보조 앱이 살아 있고 stdio + 로컬 HTTP 둘 다 응답 중입니다.",
            control: (
              <>
                <StatusPill text="실행 중" tone="accent" />
                <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11, fontWeight: 500, color: "var(--ds-muted)" }}>
                  PID 47281 · 86 MB · v0.4.2
                </span>
                <GhostButton label="재시작" width={64} />
              </>
            ),
          },
          {
            id: "log-folder",
            title: "로그 폴더",
            subtitle: "~/Library/Logs/Agentic30 — 회전 7개 보관.",
            control: <GhostButton label="Finder에서 열기" glyph="⬈" width={124} />,
          },
          {
            id: "confetti",
            title: "Confetti 테스트",
            subtitle: "완료 축하 confetti 렌더링 경로를 즉시 재생합니다.",
            control: <GhostButton label="재생" glyph="✦" width={72} />,
          },
        ]}
      />
    </>
  );

  const meta = (
    <MetaPanel title="시스템 상태">
      <MetaLiveCard label="실행 보조 앱" live>
        <MetaKV k="상태" v="실행 중" strong />
        <MetaKV k="PID" v="47281" />
        <MetaKV k="업타임" v="2d 14h" />
        <MetaKV k="메모리" v="86 MB" />
        <MetaKV k="CPU (5m avg)" v="0.4%" />
        <div style={{ display: "flex", alignItems: "center", gap: 8, paddingTop: 4 }}>
          <span style={{ fontFamily: "var(--ds-mono)", fontSize: 10, fontWeight: 500, color: "var(--ds-muted)" }}>
            최근 5분 CPU
          </span>
          <span style={{ flex: 1 }} />
          <span style={{ width: 64, height: 16 }}>
            <Sparkline
              points={[12, 11, 12, 10, 11, 8, 9, 6, 7, 4, 5, 3]}
              width={64}
              height={16}
              tone="accent"
              fill={false}
            />
          </span>
        </div>
      </MetaLiveCard>

      <div style={{ height: 12 }} />

      <MetaLiveCard label="워크스페이스">
        <MetaKV k="경로" v="~/code/agentic30-public" strong />
        <MetaKV k="상태" v="명시됨" />
      </MetaLiveCard>

      <div style={{ height: 26 }} />

      <MetaHeading>빠른 작업</MetaHeading>
      <MetaAction glyph="⬇" title="진단 스냅샷 내보내기" subtitle="sanitize · ZIP" />
      <MetaAction glyph="⟳" title="실행 보조 앱 재시작" subtitle="다운타임 ~ 1초" />

      <div style={{ height: 18 }} />

      <MetaHeading>참고 문서</MetaHeading>
      <MetaAction glyph="▢" title="release-checklist.md" subtitle="배포 전 점검 항목" />
      <MetaAction glyph="▢" title="known-limitations.md" subtitle="알려진 제한사항" />
      <MetaAction glyph="▢" title="diagnostics-guide.md" subtitle="진단 가이드" />

      <div style={{ height: 18 }} />

      <MetaHeading>버전</MetaHeading>
      <div
        style={{
          padding: "0 6px",
          fontFamily: "var(--ds-mono)",
          fontSize: 11,
          fontWeight: 500,
          color: "var(--ds-muted)",
          lineHeight: 1.7,
          whiteSpace: "pre-line",
        }}
      >
        {"app · 0.4.2 (1042) · arm64\n실행 보조 앱 · 0.4.2\nnode · v20.11.1\nswift · 5.10\nmacOS · 14.5"}
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

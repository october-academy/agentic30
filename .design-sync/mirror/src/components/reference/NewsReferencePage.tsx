import React from "react";
import { Tone, toneVars } from "../../tokens";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { KVRow } from "../KVRow";
import { DebtBanner } from "../DebtBanner";
import { Rail } from "./Rail";
import { SideRow } from "./SideRow";
import { ReferenceSidebar } from "./ReferenceSidebar";
import { Titlebar } from "./Titlebar";
import { ReferenceHeader } from "./ReferenceHeader";
import { FilterTabs } from "./FilterTabs";
import { RefSection } from "./RefSection";
import { MetaPanel } from "./MetaPanel";
import { ReferenceShell } from "./ReferenceShell";

/* ────────────────────────── small local building blocks ────────────────────────── */

/** Round glyph tile used as a SideRow leading mark (accent inbox, sky bookmark, …). */
function GlyphTile({ glyph, tone = "accent", muted }: { glyph: React.ReactNode; tone?: Tone; muted?: boolean }) {
  const t = toneVars(tone);
  return (
    <span
      style={{
        width: 26,
        height: 26,
        flex: "0 0 auto",
        borderRadius: 999,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        fontSize: 13,
        color: muted ? "var(--ds-muted)" : t.color,
      }}
    >
      {glyph}
    </span>
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

/** Rounded action button row in the meta "다음 액션" group (glyph · label). */
function MetaActionButton({
  glyph,
  label,
  highlight,
}: {
  glyph: React.ReactNode;
  label: React.ReactNode;
  highlight?: boolean;
}) {
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 11,
        padding: "11px 13px",
        borderRadius: "var(--ds-r-control)",
        background: highlight ? "var(--ds-accent-dim)" : "var(--ds-surface-2)",
        border: `1px solid ${highlight ? "var(--ds-accent-line)" : "var(--ds-border)"}`,
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          width: 18,
          textAlign: "center",
          fontSize: 14,
          color: highlight ? "var(--ds-accent)" : "var(--ds-muted)",
        }}
      >
        {glyph}
      </span>
      <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>{label}</span>
    </div>
  );
}

/* ─────────────────────── the accent-highlighted radar article card ─────────────────────── */

/** The featured, accent-tinted radar card — eyebrow + title + body, an answer pill, and a
 *  nested reference block. Built inline because it carries richer structure than <ArticleCard />. */
function RadarCard() {
  return (
    <div
      style={{
        position: "relative",
        background: "var(--ds-accent-dim)",
        border: "1px solid var(--ds-accent-line)",
        borderRadius: "var(--ds-r-card)",
        boxShadow: "var(--ds-shadow-card)",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 10,
      }}
    >
      <div style={{ display: "flex", alignItems: "flex-start", justifyContent: "space-between", gap: 12 }}>
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8 }}>
            <span style={{ display: "inline-flex", alignItems: "center", gap: 6 }}>
              <span style={{ width: 7, height: 7, borderRadius: 999, background: "var(--ds-accent)" }} />
              <span style={{ fontSize: 12, fontWeight: 600, color: "var(--ds-accent)" }}>안 읽음</span>
            </span>
            <Badge tone="accent" mono={false}>
              하이라이트
            </Badge>
          </div>
          <div style={{ fontSize: 18, fontWeight: 700, color: "var(--ds-fg)", lineHeight: 1.35 }}>
            UI 테스트 리서치 결과
          </div>
        </div>
        <div style={{ flex: "0 0 auto", display: "flex", gap: 6 }}>
          <ActionGlyph glyph="✉" />
          <ActionGlyph glyph="🔖" />
        </div>
      </div>

      <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg)", lineHeight: 1.55 }}>
        뉴스 레퍼런스 화면이 열린 상태에서도 리서치 결과가 유지됩니다.
      </div>
      <div style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)", lineHeight: 1.55 }}>
        리서치 갱신 후에도 선택한 뉴스 라우트가 유지되는지 확인합니다.
      </div>

      {/* 관련 답변 pill row */}
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 12,
          padding: "10px 13px",
          borderRadius: "var(--ds-r-control)",
          background: "var(--ds-bg-deep)",
          border: "1px solid var(--ds-border-soft)",
        }}
      >
        <span style={{ display: "inline-flex", alignItems: "center", gap: 7, color: "var(--ds-muted)", fontSize: 12.5 }}>
          <span style={{ fontSize: 13 }}>💬</span>
          관련 답변
        </span>
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 12.5, fontWeight: 600, color: "var(--ds-fg)" }}>
          ui-test-answer
        </span>
      </div>

      {/* 레퍼런스 */}
      <div>
        <div className="ds-eyebrow" style={{ margin: "4px 0 8px" }}>
          레퍼런스
        </div>
        <div
          style={{
            display: "flex",
            gap: 11,
            padding: "12px 13px",
            borderRadius: "var(--ds-r-control)",
            background: "var(--ds-bg-deep)",
            border: "1px solid var(--ds-border-soft)",
          }}
        >
          <span style={{ flex: "0 0 auto", marginTop: 1, color: "var(--ds-muted)", fontSize: 14 }}>🔗</span>
          <div style={{ minWidth: 0, display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 13.5, fontWeight: 700, color: "var(--ds-fg)" }}>Codex 웹 검색 도구</span>
            <span style={{ fontFamily: "var(--ds-mono)", fontSize: 11.5, color: "var(--ds-muted)" }}>
              example.com · web
            </span>
            <span style={{ fontFamily: "var(--ds-mono)", fontSize: 12, color: "var(--ds-sky)" }}>
              https://example.com/radar ↗
            </span>
            <span style={{ fontSize: 12, color: "var(--ds-fg-secondary)" }}>UI 테스트 출처</span>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Small square icon action button in the radar card header. */
function ActionGlyph({ glyph }: { glyph: React.ReactNode }) {
  return (
    <span
      style={{
        width: 28,
        height: 28,
        display: "inline-flex",
        alignItems: "center",
        justifyContent: "center",
        borderRadius: "var(--ds-r-control)",
        background: "var(--ds-surface-2)",
        border: "1px solid var(--ds-border)",
        color: "var(--ds-muted)",
        fontSize: 13,
      }}
    >
      {glyph}
    </span>
  );
}

/* ─────────────────────────────── page ─────────────────────────────── */

export interface NewsReferencePageProps {
  /** Fixed pixel height for the framed window (the shell fills its container otherwise). */
  height?: number;
}

/** Faithful mirror of OpenDesign_News_Wide.png — the News / Market Radar reference page. */
export function NewsReferencePage({ height = 900 }: NewsReferencePageProps) {
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
      title={
        <span style={{ display: "inline-flex", alignItems: "center", gap: 8 }}>
          <span style={{ color: "var(--ds-accent)", fontSize: 15 }}>▤</span>
          <span style={{ fontFamily: "var(--ds-mono)", letterSpacing: "0.01em" }}>Market Radar</span>
        </span>
      }
      search="뉴스·가정 검색"
      groups={[
        {
          label: "스트림",
          rows: [
            <SideRow
              active
              leading={<GlyphTile glyph="⌸" tone="accent" />}
              title="전체"
              subtitle="모든 레이더 카드"
              badge={<Badge tone="accent">1</Badge>}
            />,
            <SideRow
              leading={<GlyphTile glyph="🔖" tone="sky" />}
              title="Saved"
              subtitle="이 workspace에서 저장"
              badge={<Badge neutral>0</Badge>}
            />,
          ],
        },
        {
          label: "레이더 레인",
          rows: [
            <SideRow
              leading={<GlyphTile glyph="◉" tone="accent" />}
              title="대안/가격"
              subtitle="이미 돈을 쓰는 대안과 가격 기준은 무엇인가"
              badge={<Badge neutral>1</Badge>}
            />,
          ],
        },
        {
          label: "소스",
          rows: [
            <SideRow
              leading={<GlyphTile glyph="🌐" tone="muted" muted />}
              title="Web"
              subtitle="출처 그룹"
              badge={<Badge neutral>1</Badge>}
            />,
          ],
        },
      ]}
      footer={
        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <div style={{ fontSize: 12, fontWeight: 600, color: "var(--ds-fg-secondary)" }}>로컬 보관</div>
          <div style={{ fontSize: 11.5, color: "var(--ds-muted)", lineHeight: 1.5 }}>
            읽음/저장은 이 Mac의 현재 workspace UserDefaults에만 남습니다.
          </div>
        </div>
      }
    />
  );

  const titlebar = <Titlebar breadcrumb={{ page: "뉴스", detail: "안 읽음 17건" }} />;

  const header = (
    <ReferenceHeader
      icon={<Avatar initials="📰" size={52} tone="accent" />}
      title="시장 리서치 레이더"
      subtitleParts={[
        "1 카드",
        "1 안 읽음",
        "0 저장",
        "1 표시",
        "마지막 업데이트 5/20 10:00",
        "0초 걸림",
      ]}
      actions={
        <Button variant="ghost" size="sm" icon={<span>⟳</span>}>
          새로고침
        </Button>
      }
    />
  );

  const main = (
    <>
      {header}
      <div style={{ marginBottom: 22 }}>
        <FilterTabs tabs={["전체", "High", "Medium", "Low", "Unknown"]} />
      </div>

      <RefSection
        title="대안/가격"
        count={<Badge tone="accent">1</Badge>}
        subtitle="이미 돈을 쓰는 대안과 가격 기준은 무엇인가"
        markerTone="accent"
      >
        <RadarCard />
      </RefSection>
    </>
  );

  const meta = (
    <MetaPanel title="왜 이 리서치">
      <div
        style={{
          padding: "13px 14px",
          borderRadius: "var(--ds-r-card)",
          background: "var(--ds-surface-2)",
          border: "1px solid var(--ds-border-soft)",
          fontSize: "var(--ds-fs-body)",
          color: "var(--ds-fg-secondary)",
          lineHeight: 1.6,
        }}
      >
        현재 workspace의 ICP, 문제, 대안/가격, 채널, 플랫폼 가정을 공개 근거와 나란히 읽기 위한 레이더입니다.
      </div>

      <MetaGroupLabel>RADAR 상태</MetaGroupLabel>
      <MetaKV label="상태" value="최신" tone="accent" />
      <MetaKV label="카드" value="1" tone="accent" />
      <MetaKV label="안 읽음" value="1" tone="amber" />
      <MetaKV label="저장" value="0" tone="sky" />
      <MetaKV label="마지막 업데이트" value="5/20 10:00" />
      <MetaKV label="소스" value="Codex 웹 검색 도구" tone="sky" />

      <div style={{ marginTop: 12 }}>
        <DebtBanner tone="amber" title="일부 가정 리서치 실패: 문제" />
      </div>

      <MetaGroupLabel>가정 커버리지</MetaGroupLabel>
      <MetaKV label="대안/가격" value="1" tone="accent" boxed />

      <MetaGroupLabel>소스 요약</MetaGroupLabel>
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 11,
          padding: "11px 13px",
          borderRadius: "var(--ds-r-control)",
          background: "var(--ds-surface-2)",
          border: "1px solid var(--ds-border)",
        }}
      >
        <span style={{ flex: "0 0 auto", fontSize: 14, color: "var(--ds-muted)" }}>🌐</span>
        <span style={{ flex: 1, minWidth: 0, fontSize: 13, fontWeight: 600, color: "var(--ds-fg)" }}>Web</span>
        <span style={{ fontFamily: "var(--ds-mono)", fontSize: 12.5, color: "var(--ds-fg-secondary)" }}>1</span>
      </div>

      <MetaGroupLabel>다음 액션</MetaGroupLabel>
      <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
        <MetaActionButton glyph="⟳" label="오래된 레이더 새로고침" />
        <MetaActionButton glyph="✉" label="1개 안 읽은 카드 검토" highlight />
        <MetaActionButton glyph="🔖" label="0개 저장 카드로 문서 갱신" />
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

/** Meta-panel status row — a KVRow inside a soft-bordered box (matches the reference chrome). */
function MetaKV({
  label,
  value,
  tone,
  boxed,
}: {
  label: React.ReactNode;
  value: React.ReactNode;
  tone?: Tone;
  boxed?: boolean;
}) {
  const inner = <KVRow label={label} value={value} tone={tone} />;
  return (
    <div
      style={{
        padding: boxed ? "3px 13px" : "3px 13px",
        borderRadius: "var(--ds-r-control)",
        background: "var(--ds-surface-2)",
        border: "1px solid var(--ds-border)",
        marginBottom: 8,
      }}
    >
      {inner}
    </div>
  );
}

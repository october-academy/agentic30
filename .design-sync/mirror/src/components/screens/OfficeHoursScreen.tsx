import React from "react";
import { WorkspaceShell } from "../WorkspaceShell";
import { WorkspaceRail } from "../WorkspaceRail";
import { Titlebar } from "../reference/Titlebar";
import { IconButton } from "../IconButton";
import { QuestionCard } from "../QuestionCard";
import { Stepper } from "../Stepper";
import { Avatar } from "../Avatar";
import { Badge } from "../Badge";
import { Button } from "../Button";
import { Icon } from "../Icon";

export interface OfficeHoursScreenProps {
  /** Fixed window height in px for framing inside a preview canvas. */
  height?: number;
}

/* ── The single active session card in the narrow sidebar ───────────────── */
function SessionCard() {
  return (
    <div
      role="button"
      aria-pressed
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 12,
        padding: "12px 12px",
        borderRadius: "var(--ds-r-card)",
        background: "var(--ds-accent-dim)",
        border: "1px solid var(--ds-accent-line)",
        cursor: "pointer",
      }}
    >
      {/* numbered session tile — this is session 1 in the Day-1 timeline */}
      <div
        style={{
          flex: "0 0 auto",
          width: 30,
          height: 30,
          borderRadius: "var(--ds-r-control)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--ds-mono)",
          fontSize: 13,
          fontWeight: 600,
          color: "var(--ds-accent)",
          background: "var(--ds-surface)",
          border: "1px solid var(--ds-accent-line)",
        }}
      >
        1
      </div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div
          style={{
            fontSize: "var(--ds-fs-listname)",
            fontWeight: 600,
            color: "var(--ds-fg)",
            lineHeight: 1.4,
            display: "-webkit-box",
            WebkitLineClamp: 2,
            WebkitBoxOrient: "vertical",
            overflow: "hidden",
          }}
        >
          이번 주 유료 진입점을 보여줄 실명…
        </div>
        <div
          style={{
            marginTop: 5,
            display: "flex",
            alignItems: "center",
            gap: 6,
            fontSize: "var(--ds-fs-trend)",
            color: "var(--ds-muted)",
          }}
        >
          <span style={{ color: "var(--ds-accent)" }}>오늘</span>
          <span style={{ color: "var(--ds-muted-deep)" }}>·</span>
          <span>첫 인터뷰</span>
        </div>
      </div>
    </div>
  );
}

/* ── Narrow session sidebar (bespoke — a session timeline, not the nav one) ─ */
function SessionSidebar() {
  return (
    <div
      style={{
        width: "100%",
        height: "100%",
        display: "flex",
        flexDirection: "column",
        background: "var(--ds-surface-2)",
        borderRight: "1px solid var(--ds-border-soft)",
      }}
    >
      {/* project header */}
      <div
        style={{
          flex: "0 0 auto",
          padding: "16px 14px 12px",
          display: "flex",
          alignItems: "center",
          gap: 8,
        }}
      >
        <div
          style={{
            flex: 1,
            minWidth: 0,
            fontSize: "var(--ds-fs-listname)",
            fontWeight: 700,
            color: "var(--ds-fg)",
            whiteSpace: "nowrap",
            overflow: "hidden",
            textOverflow: "ellipsis",
          }}
        >
          agentic30-ui-opendesig…
        </div>
        <Badge tone="accent">Day 1</Badge>
      </div>

      {/* session group */}
      <div className="ds-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto", padding: "0 10px 12px" }}>
        <div className="ds-eyebrow" style={{ padding: "2px 4px 8px" }}>
          초기 검증
        </div>
        <SessionCard />
      </div>

      {/* footer — start a new conversation */}
      <div
        style={{
          flex: "0 0 auto",
          padding: "10px 12px 14px",
          borderTop: "1px solid var(--ds-border-soft)",
          display: "flex",
          alignItems: "center",
          gap: 10,
        }}
      >
        <span
          style={{
            flex: "0 0 auto",
            width: 30,
            height: 30,
            borderRadius: "var(--ds-r-control)",
            display: "inline-flex",
            alignItems: "center",
            justifyContent: "center",
            color: "var(--ds-accent)",
            background: "var(--ds-accent-dim)",
            border: "1px solid var(--ds-accent-line)",
          }}
        >
          <Icon name="plus" size={15} title="" />
        </span>
        <span style={{ fontSize: "var(--ds-fs-body)", fontWeight: 500, color: "var(--ds-fg-secondary)" }}>
          새 대화 시작하기
        </span>
      </div>
    </div>
  );
}

/* ── Section marker eyebrow (accent bar + tracked label) ────────────────── */
function MarkerLabel({ children, trailing }: { children: React.ReactNode; trailing?: React.ReactNode }) {
  return (
    <div style={{ display: "flex", alignItems: "center", gap: 9 }}>
      <span style={{ width: 3, height: 14, borderRadius: "var(--ds-r-bar)", background: "var(--ds-accent)" }} />
      <span className="ds-eyebrow" style={{ color: "var(--ds-fg-secondary)" }}>
        {children}
      </span>
      {trailing != null && <span style={{ marginLeft: "auto" }}>{trailing}</span>}
    </div>
  );
}

const OPTIONS: { title: string; description: string }[] = [
  { title: "돈을 냈거나 제안함", description: "유료 파일럿, 선결제, 예산 배정처럼 비용이 걸린 신호." },
  { title: "업무에 이미 의존함", description: "프로토타입, 수작업 결과물, 리포트를 반복해서 쓰는 상태." },
  { title: "강한 workaround 있음", description: "Excel, Slack, 사람, 외주로 억지로 해결하는 현재 대안." },
  { title: "아직 실제 증거 없음", description: "아이디어나 대기 신청자 수준이라 첫 검증 과제가 필요한 상태." },
];

/**
 * Office Hours interview turn — the faithful React mirror of
 * Office_Hours_SwiftUI_Q1_Active.png.
 *
 * Rail + a narrow Day-1 session sidebar + a full-bleed main turn (no meta):
 * OH header with a "running" badge, a 목표 → 첫 인터뷰 stepper, the DEMAND
 * question card with a highlighted 「행동이나 돈의 증거」 span, a numbered
 * option panel, an optional free-form supplement, and the submit bar.
 */
export function OfficeHoursScreen({ height }: OfficeHoursScreenProps) {
  // Nothing selected yet — the interview is live and awaiting the first answer.
  const selectedIndex: number | undefined = undefined;
  const submitReady = selectedIndex != null;

  return (
    <WorkspaceShell
      height={height}
      sidebarWidth="var(--ds-pane-sidebar)"
      mainMaxWidth={1000}
      rail={
        <WorkspaceRail
          items={[
            { icon: "calendar", active: true, title: "오늘" },
            { icon: "play.fill", locked: true, title: "리플레이 (잠김)" },
            { icon: "chart.line.uptrend.xyaxis", locked: true, title: "성장 (잠김)" },
            { icon: "newspaper", locked: true, title: "뉴스 (잠김)" },
            { icon: "person.2.fill", locked: true, title: "인터뷰 (잠김)" },
            { icon: "gearshape", title: "설정" },
          ]}
          footer={<Avatar initials="Z" size={34} tone="accent" />}
        />
      }
      titlebar={
        <Titlebar
          breadcrumb={{ page: "Agentic30", detail: "Office Hours" }}
          actions={
            <>
              <IconButton aria-label="검색" icon={<Icon name="magnifyingglass" size={15} title="" />} />
              <IconButton aria-label="공유" icon={<Icon name="square.and.arrow.up" size={15} title="" />} />
              <IconButton aria-label="사이드바 토글" icon={<Icon name="sidebar.right" size={15} title="" />} active />
            </>
          }
        />
      }
      sidebar={<SessionSidebar />}
      main={
        <div style={{ display: "flex", flexDirection: "column", gap: 20 }}>
          {/* ── OH header ─────────────────────────────────────────────── */}
          <div style={{ display: "flex", alignItems: "flex-start", gap: 16 }}>
            <Avatar initials="OH" size={52} tone="accent" />
            <div style={{ flex: 1, minWidth: 0 }}>
              <div
                style={{
                  fontSize: 26,
                  fontWeight: 700,
                  color: "var(--ds-fg)",
                  letterSpacing: "var(--ds-track-tight)",
                  lineHeight: 1.15,
                }}
              >
                Office Hours · Day 1
              </div>
              <div
                style={{
                  marginTop: 6,
                  display: "flex",
                  alignItems: "center",
                  gap: 8,
                  fontSize: "var(--ds-fs-body)",
                  color: "var(--ds-muted)",
                }}
              >
                <span
                  aria-hidden
                  style={{ width: 6, height: 6, borderRadius: "var(--ds-r-pill)", background: "var(--ds-accent)" }}
                />
                <span style={{ fontFamily: "var(--ds-mono)", color: "var(--ds-fg-secondary)" }}>/office-hours</span>
                <span>실행 중</span>
              </div>
            </div>
            {/* running status — a live, greyscale mono chip (not the accent) */}
            <span
              style={{
                flex: "0 0 auto",
                display: "inline-flex",
                alignItems: "center",
                gap: 7,
                height: 26,
                padding: "0 12px",
                borderRadius: "var(--ds-r-pill)",
                fontFamily: "var(--ds-mono)",
                fontSize: 12,
                fontWeight: 600,
                letterSpacing: "0.02em",
                color: "var(--ds-fg-secondary)",
                background: "var(--ds-surface-2)",
                border: "1px solid var(--ds-border-strong)",
              }}
            >
              <span
                aria-hidden
                style={{ width: 6, height: 6, borderRadius: "var(--ds-r-pill)", background: "var(--ds-accent-bright)" }}
              />
              running
            </span>
          </div>

          {/* ── 목표 → 첫 인터뷰 progress ───────────────────────────────
           * Clamped so the connector groups the two steps at the left
           * rather than spanning the full main column. */}
          <div style={{ maxWidth: 320 }}>
            <Stepper
              steps={[
                { label: "목표", state: "done" },
                { label: "첫 인터뷰", state: "active" },
              ]}
            />
          </div>

          {/* ── The DEMAND question ───────────────────────────────────── */}
          <div style={{ display: "flex", flexDirection: "column", gap: 14 }}>
            <QuestionCard
              eyebrow={
                <span style={{ display: "inline-flex", alignItems: "center", gap: 9 }}>
                  <span
                    style={{ width: 3, height: 12, borderRadius: "var(--ds-r-bar)", background: "var(--ds-accent)" }}
                  />
                  질문 1 — DEMAND
                  <span style={{ color: "var(--ds-muted-deep)" }}>1 / 6</span>
                </span>
              }
              question={
                <span style={{ display: "flex", alignItems: "flex-start", gap: 14 }}>
                  <span style={{ flex: 1 }}>
                    가장 강한 수요 증거가 뭐야? 관심 말고, 없어지면 실제로 곤란해지는{" "}
                    <mark
                      style={{
                        background: "var(--ds-accent-dim)",
                        color: "var(--ds-accent)",
                        borderRadius: "var(--ds-r-chip)",
                        border: "1px solid var(--ds-accent-line)",
                        padding: "1px 8px",
                        fontWeight: 700,
                        whiteSpace: "nowrap",
                      }}
                    >
                      행동이나 돈의 증거
                    </mark>
                    .
                  </span>
                  <span style={{ flex: "0 0 auto", marginTop: 2 }}>
                    <Badge tone="accent">1 / 6</Badge>
                  </span>
                </span>
              }
            />

            {/* ── 도움안 선택 (numbered option panel) ─────────────────── */}
            <div
              style={{
                position: "relative",
                background: "var(--ds-surface)",
                border: "1px solid var(--ds-border)",
                borderRadius: "var(--ds-r-card)",
                boxShadow: "var(--ds-shadow-card)",
                overflow: "hidden",
              }}
            >
              <span
                style={{ position: "absolute", left: 0, top: 0, bottom: 0, width: 3, background: "var(--ds-accent)" }}
              />
              <div style={{ padding: 18, paddingLeft: 20, display: "flex", flexDirection: "column", gap: 14 }}>
                <MarkerLabel
                  trailing={
                    <span style={{ fontFamily: "var(--ds-mono)", fontSize: 12, color: "var(--ds-muted)" }}>
                      {submitReady ? "1 / 1" : "0 / 1"}
                    </span>
                  }
                >
                  도움안 선택
                </MarkerLabel>

                {/* sub-header: label + affordance hint */}
                <div
                  style={{
                    display: "flex",
                    alignItems: "baseline",
                    justifyContent: "space-between",
                    gap: 12,
                    marginTop: -4,
                  }}
                >
                  <span style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)" }}>도움안 선택</span>
                  <span style={{ fontSize: "var(--ds-fs-trend)", color: "var(--ds-accent)" }}>
                    선택하면 제출 가능
                  </span>
                </div>

                {/* numbered options — the four DEMAND-evidence tiers */}
                <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                  {OPTIONS.map((opt, i) => (
                    <NumberedOption
                      key={i}
                      index={i + 1}
                      title={opt.title}
                      description={opt.description}
                      selected={selectedIndex === i}
                    />
                  ))}
                </div>

                {/* ── 필요하면 보강 (free-form supplement) ─────────────── */}
                <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
                  <div style={{ display: "flex", alignItems: "baseline", justifyContent: "space-between", gap: 12 }}>
                    <span style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-fg-secondary)", fontWeight: 500 }}>
                      필요하면 보강
                    </span>
                    <span style={{ fontSize: "var(--ds-fs-trend)", color: "var(--ds-muted)" }}>선택사항</span>
                  </div>
                  <div
                    style={{
                      display: "flex",
                      alignItems: "center",
                      gap: 10,
                      background: "var(--ds-surface-2)",
                      border: "1px solid var(--ds-border)",
                      borderRadius: "var(--ds-r-control)",
                      padding: "12px 14px",
                    }}
                  >
                    <Icon name="chevron.right" size={13} title="" style={{ color: "var(--ds-muted-deep)" }} />
                    <span style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)" }}>
                      예: 3명이 매주 같은 수작업을 하고 있고 1명은 유료 파일럿을 물어봤어요.
                    </span>
                  </div>
                </div>
              </div>

              {/* ── submit bar ───────────────────────────────────────── */}
              <div
                style={{
                  display: "flex",
                  alignItems: "center",
                  justifyContent: "space-between",
                  gap: 12,
                  padding: "12px 18px 12px 20px",
                  borderTop: "1px solid var(--ds-border)",
                  background: "var(--ds-surface-2)",
                }}
              >
                <span style={{ fontSize: "var(--ds-fs-body)", color: "var(--ds-muted)" }}>
                  {submitReady ? "선택 완료" : "미선택"}
                </span>
                <Button
                  variant="primary"
                  size="sm"
                  disabled={!submitReady}
                  icon={<span style={{ fontFamily: "var(--ds-mono)", fontSize: 12 }}>↵</span>}
                >
                  제출
                </Button>
              </div>
            </div>
          </div>
        </div>
      }
    />
  );
}

/* ── A single numbered DEMAND-evidence option row ──────────────────────────
 * Mirrors OptionCard's selection language (accent-dim fill + accent-line
 * border on select) but leads with a plain numbered circle rather than a
 * radio dot — matching Office_Hours_SwiftUI_Q1_Active.png, where the four
 * 도움안 read as an ordered ladder, not a single-select radio group. */
function NumberedOption({
  index,
  title,
  description,
  selected,
}: {
  index: number;
  title: string;
  description: string;
  selected?: boolean;
}) {
  return (
    <div
      role="button"
      aria-pressed={selected}
      style={{
        display: "flex",
        alignItems: "flex-start",
        gap: 14,
        padding: "13px 14px",
        borderRadius: "var(--ds-r-control)",
        background: selected ? "var(--ds-accent-dim)" : "transparent",
        border: `1px solid ${selected ? "var(--ds-accent-line)" : "transparent"}`,
        cursor: "pointer",
        transition:
          "background var(--ds-dur-fast) var(--ds-ease-snap), border-color var(--ds-dur-fast) var(--ds-ease-snap)",
      }}
    >
      <span
        style={{
          flex: "0 0 auto",
          width: 24,
          height: 24,
          marginTop: 1,
          borderRadius: "var(--ds-r-pill)",
          display: "inline-flex",
          alignItems: "center",
          justifyContent: "center",
          fontFamily: "var(--ds-mono)",
          fontSize: 12,
          fontWeight: 600,
          color: selected ? "var(--ds-accent)" : "var(--ds-muted)",
          background: selected ? "var(--ds-accent-dim)" : "var(--ds-surface-2)",
          border: `1px solid ${selected ? "var(--ds-accent-line)" : "var(--ds-border-strong)"}`,
        }}
      >
        {index}
      </span>
      <span style={{ minWidth: 0 }}>
        <span style={{ display: "block", fontSize: "var(--ds-fs-listname)", fontWeight: 600, color: "var(--ds-fg)" }}>
          {title}
        </span>
        <span
          style={{
            display: "block",
            fontSize: "var(--ds-fs-body)",
            color: "var(--ds-muted)",
            marginTop: 4,
            lineHeight: 1.5,
          }}
        >
          {description}
        </span>
      </span>
    </div>
  );
}

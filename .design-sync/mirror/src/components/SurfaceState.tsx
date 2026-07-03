import React from "react";
import { Spinner } from "./Spinner";
import { Icon } from "./Icon";

export type SurfaceStateKind = "cold" | "loading" | "empty" | "error" | "unavailable";

export type SurfaceStateRowState = "done" | "active" | "pending" | "error";

export interface SurfaceStateRow {
  /** Source / step name (bold, fg) — e.g. "소스 코드", "GitHub 병합 PR". */
  title: string;
  /** Progress state — drives the leading status dot + trailing label. */
  state: SurfaceStateRowState;
  /** Muted supporting line under the title. Falls back to the state label. */
  detail?: string;
  /** Optional monospaced log lines shown indented under the row (last 3). */
  logLines?: string[];
}

export interface SurfaceStateProps {
  /** Which surface-wide state this view represents. */
  kind: SurfaceStateKind;
  /** Headline (rounded, bold). */
  title: string;
  /** Muted supporting copy under the title. */
  detail?: string;
  /**
   * Leading glyph. Accepts an SF-symbol name (rendered via <Icon>) or a node.
   * Defaults by kind. `loading` always renders a <Spinner> regardless.
   */
  icon?: string | React.ReactNode;
  /** Cold-load source rows — a status checklist with optional mono log lines. */
  rows?: SurfaceStateRow[];
  /** Trailing action node (usually a <Button>). Centered under the copy. */
  action?: React.ReactNode;
}

/** Default SF-symbol per kind (mirrors the app's state-view glyphs). */
const KIND_ICON: Record<SurfaceStateKind, string> = {
  cold: "arrow.triangle.2.circlepath",
  loading: "arrow.triangle.2.circlepath",
  empty: "circle.dashed",
  error: "exclamationmark.triangle.fill",
  unavailable: "lock.fill",
};

/** Korean state label for a source row (openDesignLoadingStateLabel parity). */
const ROW_STATE_LABEL: Record<SurfaceStateRowState, string> = {
  done: "완료",
  active: "수집 중",
  pending: "대기 중",
  error: "실패",
};

interface RowStateVisual {
  /** Dot / accent color. */
  color: string;
  /** Dot fill wash. */
  dim: string;
  /** Whether the trailing marker is a spinner rather than a dot. */
  spinner: boolean;
}

function rowStateVisual(state: SurfaceStateRowState): RowStateVisual {
  switch (state) {
    case "done":
      return { color: "var(--ds-accent)", dim: "var(--ds-accent-dim)", spinner: false };
    case "active":
      return { color: "var(--ds-accent)", dim: "var(--ds-accent-dim)", spinner: true };
    case "error":
      return { color: "var(--ds-danger)", dim: "var(--ds-danger-dim)", spinner: false };
    case "pending":
    default:
      return { color: "var(--ds-muted)", dim: "var(--ds-surface-2)", spinner: false };
  }
}

/** The leading glyph badge for a source row. */
function SurfaceStateRowBadge() {
  return (
    <span
      style={{
        width: 24,
        height: 24,
        flex: "0 0 auto",
        borderRadius: 7,
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        color: "var(--ds-fg-secondary)",
        background: "var(--ds-surface-2)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <Icon name="terminal" size={13} title="" />
    </span>
  );
}

/** Trailing state marker (dot or spinner) + label — OpenDesignLoadingStateBadge parity. */
function SurfaceStateRowMarker({ state }: { state: SurfaceStateRowState }) {
  const v = rowStateVisual(state);
  return (
    <span style={{ display: "inline-flex", alignItems: "center", gap: 5, flex: "0 0 auto" }}>
      {v.spinner ? (
        <Spinner size={10} color={v.color} />
      ) : (
        <span
          style={{
            width: 6,
            height: 6,
            borderRadius: "var(--ds-r-pill)",
            background: v.color,
          }}
        />
      )}
      <span style={{ fontSize: 10.5, fontWeight: 700, color: v.color }}>{ROW_STATE_LABEL[state]}</span>
    </span>
  );
}

/** One cold-load source row: icon badge + title/detail + trailing marker + mono logs. */
function SurfaceStateRowView({ row }: { row: SurfaceStateRow }) {
  const logs = (row.logLines ?? []).slice(-3);
  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        gap: 8,
        padding: 12,
        borderRadius: "var(--ds-r-chip)",
        background: "var(--ds-surface)",
        border: "1px solid var(--ds-border-soft)",
      }}
    >
      <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
        <SurfaceStateRowBadge />
        <div style={{ minWidth: 0, flex: "1 1 auto" }}>
          <div style={{ fontSize: 12.5, fontWeight: 700, color: "var(--ds-fg)" }}>{row.title}</div>
          <div
            style={{
              fontSize: 11.5,
              fontWeight: 500,
              color: "var(--ds-muted)",
              marginTop: 2,
              overflow: "hidden",
              textOverflow: "ellipsis",
              whiteSpace: "nowrap",
            }}
          >
            {row.detail && row.detail.length > 0 ? row.detail : ROW_STATE_LABEL[row.state]}
          </div>
        </div>
        <SurfaceStateRowMarker state={row.state} />
      </div>
      {logs.length > 0 && (
        <div style={{ display: "flex", flexDirection: "column", gap: 3, paddingLeft: 34 }}>
          {logs.map((line, i) => (
            <div
              key={i}
              style={{
                fontFamily: "var(--ds-mono)",
                fontSize: 10,
                color: "var(--ds-muted-deep)",
                whiteSpace: "nowrap",
                overflow: "hidden",
                textOverflow: "ellipsis",
              }}
            >
              {line}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Surface-sized state view — collapses the app's cold / loading / empty / error /
 * unavailable states (OpenDesignColdLoadingStateView + the *EmptyState / *ErrorState
 * views) into one component. Fills and centers within its surface.
 *
 *  - `loading` → a Spinner glyph.
 *  - `cold`    → the Spinner glyph + a `rows` source checklist (status dot + mono logs).
 *  - `error`   → danger-tinted glyph + border.
 *  - `empty` / `unavailable` → muted glyph.
 */
export function SurfaceState({ kind, title, detail, icon, rows, action }: SurfaceStateProps) {
  const isError = kind === "error";
  const isBusy = kind === "loading" || kind === "cold";

  const glyphColor = isError ? "var(--ds-danger)" : isBusy ? "var(--ds-accent)" : "var(--ds-muted)";
  const glyphBg = isError ? "var(--ds-danger-dim)" : isBusy ? "var(--ds-accent-dim)" : "var(--ds-surface-2)";
  const glyphBorder = isError ? "var(--ds-danger-line)" : isBusy ? "var(--ds-accent-line)" : "var(--ds-border)";

  const resolvedIcon = icon ?? KIND_ICON[kind];
  const hasRows = rows != null && rows.length > 0;

  const glyph: React.ReactNode =
    kind === "loading" ? (
      <Spinner size={22} />
    ) : typeof resolvedIcon === "string" ? (
      <Icon name={resolvedIcon} size={20} title="" />
    ) : (
      resolvedIcon
    );

  return (
    <div
      style={{
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        width: "100%",
        height: "100%",
        minHeight: 0,
        padding: "40px 24px",
        boxSizing: "border-box",
        background: "var(--ds-page)",
      }}
    >
      <div
        style={{
          display: "flex",
          flexDirection: "column",
          alignItems: "center",
          textAlign: "center",
          gap: 14,
          width: "100%",
          maxWidth: 440,
        }}
      >
        <div
          style={{
            width: 48,
            height: 48,
            flex: "0 0 auto",
            borderRadius: "var(--ds-r-control)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            color: glyphColor,
            background: glyphBg,
            border: `1px solid ${glyphBorder}`,
          }}
        >
          {glyph}
        </div>

        <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
          <div
            style={{
              fontFamily: "var(--ds-rounded)",
              fontSize: 20,
              fontWeight: 700,
              letterSpacing: "var(--ds-track-tight)",
              color: "var(--ds-fg)",
            }}
          >
            {title}
          </div>
          {detail != null && detail.length > 0 && (
            <div style={{ fontSize: 12.5, fontWeight: 500, color: "var(--ds-muted)", lineHeight: 1.55 }}>
              {detail}
            </div>
          )}
        </div>

        {hasRows && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%", textAlign: "left", marginTop: 2 }}>
            {rows!.map((row, i) => (
              <SurfaceStateRowView key={i} row={row} />
            ))}
          </div>
        )}

        {action != null && <div style={{ marginTop: 4 }}>{action}</div>}
      </div>
    </div>
  );
}

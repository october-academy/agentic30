import React from "react";

export interface WorkspaceShellProps {
  /**
   * The leftmost vertical icon nav (a <Rail />). Rendered pass-through at its
   * own width (var(--ds-pane-rail) = 52px) and spans the full window height —
   * the titlebar does NOT cover it.
   */
  rail: React.ReactNode;
  /**
   * The 36px window titlebar (a <Titlebar />). Pinned across the top of the
   * sidebar + main + meta columns (everything to the right of the rail).
   * Optional — Day/Briefing screens that hide chrome can omit it.
   */
  titlebar?: React.ReactNode;
  /**
   * Optional task/nav column (a <ReferenceSidebar /> or bespoke node). Omit on
   * screens that run full-bleed main content (e.g. a focused Office-Hours turn).
   */
  sidebar?: React.ReactNode;
  /** Main scrolling content — fills remaining width, centered + clamped. */
  main: React.ReactNode;
  /** Optional right meta column (a <MetaPanel />). */
  meta?: React.ReactNode;

  /** Sidebar column width. Default var(--ds-pane-sidebar) (240). Number → px. */
  sidebarWidth?: number | string;
  /** Meta column width. Default var(--ds-pane-meta) (280). Number → px. */
  metaWidth?: number | string;
  /** Main content max-width. Default var(--ds-pane-main-max) (880). Number → px. */
  mainMaxWidth?: number | string;

  /**
   * Fixed window width in px for framing inside a preview canvas. When omitted
   * the shell fills its container (width 100%).
   */
  width?: number;
  /** Fixed window height in px. When omitted the shell fills its container. */
  height?: number;
}

/** Coerce a number → "Npx"; pass strings (CSS vars) through untouched. */
function len(v: number | string): string {
  return typeof v === "number" ? `${v}px` : v;
}

/**
 * The uniform workspace window every Day / Market / Strategy / Briefing /
 * Office-Hours screen sits inside.
 *
 * A dark rounded window on var(--ds-page) laid out as a flex row:
 *   RAIL (full height) │ [ titlebar over → sidebar? · main · meta? ]
 *
 * The rail spans the whole height; the titlebar caps the remaining columns.
 * Every non-rail pane is configurable and the sidebar / meta are optional, so
 * this one shell renders both the four-pane dashboard and a bare rail+main turn.
 */
export function WorkspaceShell({
  rail,
  titlebar,
  sidebar,
  main,
  meta,
  sidebarWidth = "var(--ds-pane-sidebar)",
  metaWidth = "var(--ds-pane-meta)",
  mainMaxWidth = "var(--ds-pane-main-max)",
  width,
  height,
}: WorkspaceShellProps) {
  const sidebarW = len(sidebarWidth);
  const metaW = len(metaWidth);

  return (
    <div
      className="ds-root"
      style={{
        display: "flex",
        width: width != null ? width : "100%",
        height: height != null ? height : "100%",
        minHeight: 0,
        background: "var(--ds-page)",
        borderRadius: "var(--ds-r-card)",
        border: "1px solid var(--ds-border)",
        boxShadow: "var(--ds-shadow-elevated)",
        overflow: "hidden",
      }}
    >
      {/* Rail — full height, to the left of the titlebar. */}
      {rail}

      {/* Everything right of the rail: titlebar across the top, panes below. */}
      <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", minHeight: 0 }}>
        {titlebar}

        <div style={{ flex: 1, minHeight: 0, display: "flex" }}>
          {/* Optional task/nav sidebar. */}
          {sidebar != null && (
            <div style={{ width: sidebarW, flex: `0 0 ${sidebarW}`, minWidth: 0, display: "flex", minHeight: 0 }}>
              {sidebar}
            </div>
          )}

          {/* Main — fills, scrolls, centered + clamped, 24px pad. */}
          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", background: "var(--ds-page)" }}>
            <div className="ds-scroll" style={{ flex: 1, minHeight: 0, overflowY: "auto" }}>
              <div style={{ maxWidth: len(mainMaxWidth), margin: "0 auto", padding: 24 }}>{main}</div>
            </div>
          </div>

          {/* Optional right meta column. */}
          {meta != null && (
            <div style={{ width: metaW, flex: `0 0 ${metaW}`, minWidth: 0, display: "flex", minHeight: 0 }}>
              {meta}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

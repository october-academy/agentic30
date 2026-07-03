import React from "react";
import { IconButton } from "../IconButton";
import { Icon } from "../Icon";

export interface TitlebarProps {
  /** Centered breadcrumb — a plain string, or {page, detail} rendered "page / detail". */
  breadcrumb: string | { page: string; detail?: string };
  /** Right-side actions. Defaults to search + refresh + sidebar-toggle IconButtons. */
  actions?: React.ReactNode;
}

const DEFAULT_ACTIONS = (
  <>
    <IconButton aria-label="검색" icon={<Icon name="magnifyingglass" size={15} />} />
    <IconButton aria-label="공유" icon={<Icon name="square.and.arrow.up" size={15} />} />
    <IconButton aria-label="패널 토글" icon={<Icon name="sidebar.right" size={15} />} active />
  </>
);

/** 36px window titlebar — centered breadcrumb with right-aligned tool actions. */
export function Titlebar({ breadcrumb, actions }: TitlebarProps) {
  const crumb =
    typeof breadcrumb === "string" ? (
      <span style={{ fontWeight: 600, color: "var(--ds-fg)" }}>{breadcrumb}</span>
    ) : (
      <>
        <span style={{ fontWeight: 600, color: "var(--ds-fg)" }}>{breadcrumb.page}</span>
        {breadcrumb.detail != null && (
          <>
            <span style={{ color: "var(--ds-muted-deep)" }}>/</span>
            <span style={{ color: "var(--ds-fg-secondary)" }}>{breadcrumb.detail}</span>
          </>
        )}
      </>
    );

  return (
    <div
      style={{
        position: "relative",
        height: 36,
        flex: "0 0 36px",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: "0 10px",
        background: "var(--ds-page)",
        borderBottom: "1px solid var(--ds-border)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          gap: 8,
          fontSize: "var(--ds-fs-body)",
        }}
      >
        {crumb}
      </div>
      <div
        style={{
          position: "absolute",
          right: 10,
          top: 0,
          bottom: 0,
          display: "flex",
          alignItems: "center",
          gap: 2,
        }}
      >
        {actions ?? DEFAULT_ACTIONS}
      </div>
    </div>
  );
}

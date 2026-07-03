import React from "react";

export interface ProviderCardProps {
  /** Provider / integration name (Cloudflare, GitHub, PostHog). */
  name: React.ReactNode;
  /** Muted detail line — account, scope, or path. */
  detail?: React.ReactNode;
  /** Trailing status node (usually a Badge — "연결됨" / "대기"). */
  status?: React.ReactNode;
  /** Leading icon slot (a logo glyph or small node). */
  icon?: React.ReactNode;
  /** Connected state → accent-tinted icon tile + hairline emphasis. */
  connected?: boolean;
  onClick?: () => void;
}

/** Integration / provider row card — settings providers, intake sources. */
export function ProviderCard({ name, detail, status, icon, connected, onClick }: ProviderCardProps) {
  return (
    <div
      onClick={onClick}
      style={{
        display: "flex",
        alignItems: "center",
        gap: 12,
        padding: "12px 14px",
        background: "var(--ds-surface)",
        border: `1px solid ${connected ? "var(--ds-accent-line)" : "var(--ds-border)"}`,
        borderRadius: "var(--ds-r-control)",
        boxShadow: "var(--ds-shadow-card)",
        cursor: onClick ? "pointer" : "default",
        transition: "border-color var(--ds-dur-fast) var(--ds-ease-snap)",
      }}
    >
      <div
        style={{
          width: 34,
          height: 34,
          flex: "0 0 auto",
          borderRadius: "var(--ds-r-control)",
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
          fontSize: 16,
          color: connected ? "var(--ds-accent)" : "var(--ds-fg-secondary)",
          background: connected ? "var(--ds-accent-dim)" : "var(--ds-surface-2)",
          border: `1px solid ${connected ? "var(--ds-accent-line)" : "var(--ds-border)"}`,
        }}
      >
        {icon ?? name?.toString().charAt(0)}
      </div>
      <div style={{ minWidth: 0, flex: "1 1 auto" }}>
        <div style={{ fontSize: "var(--ds-fs-listname)", fontWeight: 600, color: "var(--ds-fg)" }}>{name}</div>
        {detail != null && (
          <div style={{ fontSize: "var(--ds-fs-caption)", color: "var(--ds-muted)", marginTop: 2 }}>{detail}</div>
        )}
      </div>
      {status != null && <div style={{ flex: "0 0 auto" }}>{status}</div>}
    </div>
  );
}

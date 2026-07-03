import React from "react";

export interface FilterTabsProps {
  tabs: string[];
  /** Active tab label. Defaults to the first tab. */
  value?: string;
  onChange?: (tab: string) => void;
}

/** Underline filter tabs — active tab = fg + accent underline (news lanes / severity). */
export function FilterTabs({ tabs, value, onChange }: FilterTabsProps) {
  const active = value ?? tabs[0];
  return (
    <div
      style={{
        display: "flex",
        alignItems: "center",
        gap: 22,
        borderBottom: "1px solid var(--ds-border-soft)",
      }}
    >
      {tabs.map((tab) => {
        const isActive = tab === active;
        return (
          <button
            key={tab}
            type="button"
            onClick={() => onChange?.(tab)}
            style={{
              position: "relative",
              padding: "0 0 10px",
              background: "transparent",
              border: "none",
              cursor: onChange ? "pointer" : "default",
              fontFamily: "var(--ds-sans)",
              fontSize: "var(--ds-fs-listname)",
              fontWeight: isActive ? 600 : 500,
              color: isActive ? "var(--ds-fg)" : "var(--ds-muted)",
              transition: "color var(--ds-dur-fast) var(--ds-ease-snap)",
            }}
          >
            {tab}
            {isActive && (
              <span
                style={{
                  position: "absolute",
                  left: 0,
                  right: 0,
                  bottom: -1,
                  height: 2,
                  borderRadius: 2,
                  background: "var(--ds-accent)",
                }}
              />
            )}
          </button>
        );
      })}
    </div>
  );
}

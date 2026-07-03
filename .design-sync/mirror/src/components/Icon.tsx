import React from "react";
import { ICONS } from "../icons";

export interface IconProps {
  /** Exact SF Symbol name, e.g. "chevron.right", "checkmark.circle.fill". */
  name: string;
  /** Rendered width & height in px. SwiftUI renders these at ~12–20pt. */
  size?: number;
  /** Stroke weight for outline glyphs. `.fill` variants ignore it. */
  strokeWidth?: number;
  /**
   * Force fill vs stroke rendering. When omitted it's inferred from the
   * SF Symbol name (`.fill` suffix → filled). Matches the app's outline/solid
   * toggling (bookmark ↔ bookmark.fill, lock ↔ lock.fill).
   */
  filled?: boolean;
  /**
   * Accessible label. Defaults to the symbol name. Pass an empty string for
   * decorative icons sitting next to a text label (renders aria-hidden).
   */
  title?: string;
  className?: string;
  style?: React.CSSProperties;
}

/** True when the icon's authored markup relies on stroke rather than fill. */
function isFilledName(name: string): boolean {
  return /\.fill$/.test(name) || name === "sparkles";
}

/**
 * SF Symbol → inline SVG, keyed by the exact SwiftUI `systemName` string.
 *
 * Looks up `ICONS[name]`, renders a 24×24-viewBox `<svg>` scaled to `size`,
 * and inherits `currentColor` so callers tint via CSS (`.foregroundStyle`
 * parity). Unknown names degrade to a visible dev fallback — never a crash.
 */
export function Icon({
  name,
  size = 16,
  strokeWidth = 1.8,
  filled,
  title,
  className,
  style,
}: IconProps) {
  const markup = ICONS[name];
  const label = title ?? name;
  const decorative = title === "";

  const a11y = decorative
    ? ({ "aria-hidden": true } as const)
    : ({ role: "img", "aria-label": label } as const);

  const baseStyle: React.CSSProperties = {
    color: "currentColor",
    display: "inline-block",
    flexShrink: 0,
    verticalAlign: "text-bottom",
    ...style,
  };

  // Missing glyph: fail loud in dev (console warn) + render a neutral rounded
  // square outline placeholder so layout survives and the gap is obvious.
  if (!markup) {
    const env = (globalThis as { process?: { env?: Record<string, string | undefined> } }).process?.env;
    if (!env || env.NODE_ENV !== "production") {
      // eslint-disable-next-line no-console
      console.warn(`[Icon] No SVG registered for SF Symbol "${name}"`);
    }
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 24 24"
        className={className}
        style={baseStyle}
        {...a11y}
      >
        {!decorative && <title>{`missing icon: ${name}`}</title>}
        <rect
          x="3.5"
          y="3.5"
          width="17"
          height="17"
          rx="4"
          fill="none"
          stroke="currentColor"
          strokeWidth={strokeWidth}
          strokeDasharray="2.6 2.6"
          opacity="0.7"
        />
        <line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" strokeWidth={strokeWidth} strokeLinecap="round" opacity="0.55" />
      </svg>
    );
  }

  const isFilled = filled ?? isFilledName(name);

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      className={className}
      style={baseStyle}
      // Fill icons already declare fill="currentColor" inline; for stroke icons
      // the container supplies the stroke width so glyphs omit it themselves.
      strokeWidth={isFilled ? undefined : strokeWidth}
      strokeLinecap="round"
      strokeLinejoin="round"
      {...a11y}
      dangerouslySetInnerHTML={{
        __html: (decorative ? "" : `<title>${label}</title>`) + markup,
      }}
    />
  );
}

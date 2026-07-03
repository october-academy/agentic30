// Founder OS Kit — SF Symbol → inline-SVG registry.
//
// The Agentic30 SwiftUI app renders icons via `Image(systemName:)` /
// `Label(..., systemImage:)`, keyed by the exact SF Symbol string. SF Symbols
// do not exist on the web, so this map mirrors them with accurate,
// Lucide/Tabler/Feather/Phosphor-equivalent 24×24 inner markup.
//
// Conventions (see .design-sync/audit/icons.md §4/§6):
//   • Keys are the EXACT SF Symbol names so every Swift call site — literal and
//     dynamic (`item.systemImage`, ternaries, helper lookups) — resolves 1:1.
//   • Values are the INNER markup of a `<svg viewBox="0 0 24 24">` only (no
//     wrapping <svg>). `<Icon>` wraps it and sets width/height/color; it also
//     supplies stroke-width, stroke-linecap="round", stroke-linejoin="round" on
//     the container, so stroke glyphs inherit them and MUST NOT hardcode them.
//   • Stroke icons use `stroke="currentColor" fill="none"`.
//   • `.fill` variants use `fill="currentColor"` so semantic tint is external.
//     Knockout details punched INTO a filled body use the surface color
//     `var(--ds-surface, #0e1011)` (the panel behind the glyph) with an
//     explicit stroke-width, since they cannot inherit the container weight.
//   • Never bake a foreground color: tint comes from the parent (`currentColor`).
//
// Coverage: the STRUCTURAL symbols from the audit (rail, header, row, state,
// action, verdict). Unmapped names degrade to a visible dev fallback in
// <Icon>; they never crash.

/** Surface color used to knock detail out of a solid `.fill` body. */
const KO = "var(--ds-surface, #0e1011)";

export const ICONS: Record<string, string> = {
  /* ── Navigation & disclosure ───────────────────────────── */
  "chevron.left": `<polyline points="15 18 9 12 15 6" stroke="currentColor" fill="none"/>`,
  "chevron.right": `<polyline points="9 18 15 12 9 6" stroke="currentColor" fill="none"/>`,
  "chevron.up": `<polyline points="6 15 12 9 18 15" stroke="currentColor" fill="none"/>`,
  "chevron.down": `<polyline points="6 9 12 15 18 9" stroke="currentColor" fill="none"/>`,
  "chevron.right.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><polyline points="10.5 8.5 14 12 10.5 15.5" stroke="currentColor" fill="none"/>`,
  "chevron.right.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><polyline points="10.5 8.5 14 12 10.5 15.5" fill="none" stroke="${KO}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
  "chevron.down.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><polyline points="8.5 10.5 12 14 15.5 10.5" fill="none" stroke="${KO}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
  "arrow.right": `<line x1="4" y1="12" x2="18" y2="12" stroke="currentColor"/><polyline points="12 6 18 12 12 18" stroke="currentColor" fill="none"/>`,
  "arrow.left": `<line x1="20" y1="12" x2="6" y2="12" stroke="currentColor"/><polyline points="12 6 6 12 12 18" stroke="currentColor" fill="none"/>`,
  "arrow.up.right": `<line x1="6" y1="18" x2="17" y2="7" stroke="currentColor"/><polyline points="8 7 17 7 17 16" stroke="currentColor" fill="none"/>`,
  "arrow.right.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><line x1="7.5" y1="12" x2="15" y2="12" stroke="${KO}" stroke-width="1.9" stroke-linecap="round"/><polyline points="12 9 15 12 12 15" fill="none" stroke="${KO}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
  "sidebar.left": `<rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" fill="none"/><line x1="9" y1="4" x2="9" y2="20" stroke="currentColor"/>`,
  "sidebar.right": `<rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" fill="none"/><line x1="15" y1="4" x2="15" y2="20" stroke="currentColor"/>`,
  "line.3.horizontal": `<line x1="4" y1="7" x2="20" y2="7" stroke="currentColor"/><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor"/><line x1="4" y1="17" x2="20" y2="17" stroke="currentColor"/>`,
  "line.3.horizontal.decrease.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="7.5" y1="9.5" x2="16.5" y2="9.5" stroke="currentColor"/><line x1="9" y1="12" x2="15" y2="12" stroke="currentColor"/><line x1="10.5" y1="14.5" x2="13.5" y2="14.5" stroke="currentColor"/>`,
  "ellipsis": `<circle cx="5" cy="12" r="1.5" fill="currentColor"/><circle cx="12" cy="12" r="1.5" fill="currentColor"/><circle cx="19" cy="12" r="1.5" fill="currentColor"/>`,

  /* ── Status, verdict & state ───────────────────────────── */
  "checkmark": `<polyline points="4 12.5 9.5 18 20 6.5" stroke="currentColor" fill="none"/>`,
  "checkmark.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><polyline points="8 12.2 11 15.2 16 8.8" stroke="currentColor" fill="none"/>`,
  "checkmark.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><polyline points="8 12.2 11 15.2 16 8.8" fill="none" stroke="${KO}" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round"/>`,
  "xmark": `<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor"/>`,
  "xmark.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="9" y1="9" x2="15" y2="15" stroke="currentColor"/><line x1="15" y1="9" x2="9" y2="15" stroke="currentColor"/>`,
  "xmark.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><line x1="9" y1="9" x2="15" y2="15" stroke="${KO}" stroke-width="1.9" stroke-linecap="round"/><line x1="15" y1="9" x2="9" y2="15" stroke="${KO}" stroke-width="1.9" stroke-linecap="round"/>`,
  "xmark.octagon.fill": `<path d="M8.35 2.5h7.3L21.5 8.35v7.3L15.65 21.5h-7.3L2.5 15.65v-7.3L8.35 2.5Z" fill="currentColor"/><line x1="9" y1="9" x2="15" y2="15" stroke="${KO}" stroke-width="1.9" stroke-linecap="round"/><line x1="15" y1="9" x2="9" y2="15" stroke="${KO}" stroke-width="1.9" stroke-linecap="round"/>`,
  "exclamationmark.triangle": `<path d="M10.3 3.9 2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="12" y1="9.5" x2="12" y2="13.5" stroke="currentColor"/><circle cx="12" cy="16.7" r="1.05" fill="currentColor"/>`,
  "exclamationmark.triangle.fill": `<path d="M10.3 3.9 2.4 18a1.9 1.9 0 0 0 1.7 2.9h15.8a1.9 1.9 0 0 0 1.7-2.9L13.7 3.9a1.9 1.9 0 0 0-3.4 0Z" fill="currentColor"/><line x1="12" y1="9.5" x2="12" y2="13.5" stroke="${KO}" stroke-width="1.9" stroke-linecap="round"/><circle cx="12" cy="16.7" r="1.05" fill="${KO}"/>`,
  "exclamationmark.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="12" y1="7.5" x2="12" y2="13" stroke="currentColor"/><circle cx="12" cy="16.2" r="1.05" fill="currentColor"/>`,
  "info.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="12" y1="11" x2="12" y2="16.5" stroke="currentColor"/><circle cx="12" cy="7.9" r="1.05" fill="currentColor"/>`,
  "questionmark.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><path d="M9.6 9.2a2.5 2.5 0 1 1 3.4 2.7c-.7.4-1 1-1 1.7v.3" stroke="currentColor" fill="none"/><circle cx="12" cy="16.4" r="1.05" fill="currentColor"/>`,
  "circle": `<circle cx="12" cy="12" r="8.5" stroke="currentColor" fill="none"/>`,
  "circle.fill": `<circle cx="12" cy="12" r="8.5" fill="currentColor"/>`,
  "circle.dashed": `<circle cx="12" cy="12" r="8.5" stroke="currentColor" fill="none" stroke-dasharray="3 2.6"/>`,
  "circle.dotted": `<circle cx="12" cy="12" r="8.5" stroke="currentColor" fill="none" stroke-linecap="round" stroke-dasharray="0.1 3.5"/>`,
  "record.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><circle cx="12" cy="12" r="4" fill="currentColor"/>`,
  "dot.radiowaves.left.and.right": `<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M7.8 8.2a6 6 0 0 0 0 7.6" stroke="currentColor" fill="none"/><path d="M16.2 8.2a6 6 0 0 1 0 7.6" stroke="currentColor" fill="none"/><path d="M5.2 5.5a9.5 9.5 0 0 0 0 13" stroke="currentColor" fill="none"/><path d="M18.8 5.5a9.5 9.5 0 0 1 0 13" stroke="currentColor" fill="none"/>`,
  "clock": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><polyline points="12 7 12 12 15.5 14" stroke="currentColor" fill="none"/>`,
  "clock.arrow.circlepath": `<path d="M20.5 12a8.5 8.5 0 1 1-2.6-6.1" stroke="currentColor" fill="none"/><polyline points="20.5 3.5 20.5 8 16 8" stroke="currentColor" fill="none"/><polyline points="12 8 12 12 15 14" stroke="currentColor" fill="none"/>`,
  "hourglass": `<path d="M6 3h12" stroke="currentColor"/><path d="M6 21h12" stroke="currentColor"/><path d="M7 3c0 4.5 4 5.5 5 9m0 0c1-3.5 5-4.5 5-9" stroke="currentColor" fill="none"/><path d="M7 21c0-4.5 4-5.5 5-9m0 0c1 3.5 5 4.5 5 9" stroke="currentColor" fill="none"/>`,
  "timer": `<line x1="9" y1="3" x2="15" y2="3" stroke="currentColor"/><line x1="18.4" y1="7" x2="20" y2="5.4" stroke="currentColor"/><circle cx="12" cy="13.5" r="7.5" stroke="currentColor" fill="none"/><line x1="12" y1="13.5" x2="15" y2="10.5" stroke="currentColor"/>`,

  /* ── Locks / security / auth ───────────────────────────── */
  "lock": `<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" stroke="currentColor" fill="none"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" fill="none"/>`,
  "lock.fill": `<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="currentColor"/><path d="M8 10.5V7.5a4 4 0 0 1 8 0v3" stroke="currentColor" fill="none"/><circle cx="12" cy="15.5" r="1.4" fill="${KO}"/>`,
  "lock.open.fill": `<rect x="4.5" y="10.5" width="15" height="10.5" rx="2.5" fill="currentColor"/><path d="M8 10.5V7.5a4 4 0 0 1 7.6-1.7" stroke="currentColor" fill="none"/><circle cx="12" cy="15.5" r="1.4" fill="${KO}"/>`,
  "key.fill": `<circle cx="8" cy="8" r="4.5" fill="currentColor"/><circle cx="8" cy="8" r="1.5" fill="${KO}"/><path d="M11.2 11.2 19 19M16.5 16.5l2-2M14.2 14.2l2-2" stroke="currentColor" fill="none"/>`,
  "hand.raised.fill": `<path d="M8 13V6.4a1.3 1.3 0 0 1 2.6 0V11m0-1V4.6a1.3 1.3 0 0 1 2.6 0V11m0-1V5.6a1.3 1.3 0 0 1 2.6 0V12m0-1.4a1.3 1.3 0 0 1 2.6 0v3.6a6 6 0 0 1-6 6h-.4a5 5 0 0 1-4-2l-2.6-3.4a1.4 1.4 0 0 1 2.3-1.7L8 14.5Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,

  /* ── Actions & tools ───────────────────────────────────── */
  "arrow.clockwise": `<path d="M20 8.5A8.5 8.5 0 1 0 21 12" stroke="currentColor" fill="none"/><polyline points="20 3.5 20 8.5 15 8.5" stroke="currentColor" fill="none"/>`,
  "arrow.triangle.2.circlepath": `<path d="M3.5 9.5A8.5 8.5 0 0 1 18 6.3l2 2" stroke="currentColor" fill="none"/><polyline points="20 3.5 20 8.5 15 8.5" stroke="currentColor" fill="none"/><path d="M20.5 14.5A8.5 8.5 0 0 1 6 17.7l-2-2" stroke="currentColor" fill="none"/><polyline points="4 20.5 4 15.5 9 15.5" stroke="currentColor" fill="none"/>`,
  "magnifyingglass": `<circle cx="10.5" cy="10.5" r="6.5" stroke="currentColor" fill="none"/><line x1="15.5" y1="15.5" x2="20.5" y2="20.5" stroke="currentColor"/>`,
  "trash": `<line x1="4" y1="7" x2="20" y2="7" stroke="currentColor"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" stroke="currentColor" fill="none"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" fill="none"/><line x1="10" y1="11" x2="10.4" y2="17" stroke="currentColor"/><line x1="14" y1="11" x2="13.6" y2="17" stroke="currentColor"/>`,
  "plus": `<line x1="12" y1="5" x2="12" y2="19" stroke="currentColor"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor"/>`,
  "plus.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="12" y1="8" x2="12" y2="16" stroke="currentColor"/><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor"/>`,
  "plus.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><line x1="12" y1="8" x2="12" y2="16" stroke="${KO}" stroke-width="1.9" stroke-linecap="round"/><line x1="8" y1="12" x2="16" y2="12" stroke="${KO}" stroke-width="1.9" stroke-linecap="round"/>`,
  "minus.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor"/>`,
  "pencil": `<path d="M13.5 6.5 4 16v4h4l9.5-9.5-4-4Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M13.5 6.5 16 4a2 2 0 0 1 2.8 0l1.2 1.2a2 2 0 0 1 0 2.8l-2.5 2.5-4-4Z" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "paperclip": `<path d="M18.5 9 10 17.5a3.4 3.4 0 0 1-4.8-4.8l8.4-8.4a2.2 2.2 0 0 1 3.1 3.1l-8.4 8.4a1 1 0 0 1-1.4-1.4l7.6-7.6" stroke="currentColor" fill="none"/>`,
  "paperplane.fill": `<path d="M21 3 2.5 10.3a.6.6 0 0 0 0 1.1l6.9 2.4 2.4 6.9a.6.6 0 0 0 1.1 0L21 3Z" fill="currentColor"/><path d="M21 3 9.4 13.8" stroke="${KO}" stroke-width="1.4"/>`,
  "square.and.arrow.up": `<path d="M12 15V4" stroke="currentColor"/><polyline points="8 7.5 12 3.5 16 7.5" stroke="currentColor" fill="none"/><path d="M8 10H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" stroke="currentColor" fill="none"/>`,
  "square.and.arrow.down": `<path d="M12 4v11" stroke="currentColor"/><polyline points="8 11 12 15 16 11" stroke="currentColor" fill="none"/><path d="M8 10H6a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-2" stroke="currentColor" fill="none"/>`,
  "doc.on.doc": `<rect x="8" y="8" width="12" height="13" rx="2" stroke="currentColor" fill="none"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" stroke="currentColor" fill="none"/>`,
  "play.fill": `<path d="M7 4.8 19.5 12 7 19.2V4.8Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "pause.fill": `<rect x="6.5" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/><rect x="13.5" y="4.5" width="4" height="15" rx="1.2" fill="currentColor"/>`,
  "stop.fill": `<rect x="5.5" y="5.5" width="13" height="13" rx="2.5" fill="currentColor"/>`,
  "play.rectangle.on.rectangle": `<rect x="6.5" y="8" width="15" height="12" rx="2" stroke="currentColor" fill="none"/><path d="M17.5 4.5H4.5a2 2 0 0 0-2 2v9" stroke="currentColor" fill="none"/><path d="M11.5 11.5 16 14l-4.5 2.5v-5Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "link": `<path d="M9 15 15 9" stroke="currentColor"/><path d="M11 6.5 12.8 4.7a4 4 0 0 1 5.6 5.6l-2.4 2.4" stroke="currentColor" fill="none"/><path d="M13 17.5l-1.8 1.8a4 4 0 0 1-5.6-5.6l2.4-2.4" stroke="currentColor" fill="none"/>`,
  "eye": `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" fill="none"/><circle cx="12" cy="12" r="3" stroke="currentColor" fill="none"/>`,
  "eye.fill": `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="currentColor"/><circle cx="12" cy="12" r="3.2" fill="${KO}"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/>`,
  "eye.slash": `<path d="M3.5 3.5 20.5 20.5" stroke="currentColor"/><path d="M9.4 5.9C10.2 5.6 11.1 5.5 12 5.5c6 0 9.5 6.5 9.5 6.5a17.5 17.5 0 0 1-3.2 3.9" stroke="currentColor" fill="none"/><path d="M6.2 8.1A17.5 17.5 0 0 0 2.5 12S6 18.5 12 18.5c1.4 0 2.6-.3 3.7-.9" stroke="currentColor" fill="none"/><path d="M9.9 9.9a3 3 0 0 0 4.2 4.2" stroke="currentColor" fill="none"/>`,
  "waveform": `<line x1="4" y1="9.5" x2="4" y2="14.5" stroke="currentColor"/><line x1="8" y1="5.5" x2="8" y2="18.5" stroke="currentColor"/><line x1="12" y1="3" x2="12" y2="21" stroke="currentColor"/><line x1="16" y1="7" x2="16" y2="17" stroke="currentColor"/><line x1="20" y1="9.5" x2="20" y2="14.5" stroke="currentColor"/>`,
  "mic": `<rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" fill="none"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0" stroke="currentColor" fill="none"/><line x1="12" y1="17.5" x2="12" y2="21" stroke="currentColor"/><line x1="8.5" y1="21" x2="15.5" y2="21" stroke="currentColor"/>`,
  "mic.fill": `<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M5.5 11a6.5 6.5 0 0 0 13 0" stroke="currentColor" fill="none"/><line x1="12" y1="17.5" x2="12" y2="21" stroke="currentColor"/><line x1="8.5" y1="21" x2="15.5" y2="21" stroke="currentColor"/>`,
  "bolt.fill": `<path d="M13.5 2 4 13.5h5.5L10 22l10-11.5h-5.5L13.5 2Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "sparkles": `<path d="M12 3l1.5 4.3a3 3 0 0 0 1.9 1.9L20 10.7l-4.6 1.5a3 3 0 0 0-1.9 1.9L12 18.4l-1.5-4.3a3 3 0 0 0-1.9-1.9L4 10.7l4.6-1.5a3 3 0 0 0 1.9-1.9L12 3Z" fill="currentColor"/><path d="M18.5 3.5l.6 1.7 1.7.6-1.7.6-.6 1.7-.6-1.7-1.7-.6 1.7-.6.6-1.7Z" fill="currentColor"/><path d="M5 15.5l.5 1.4 1.4.5-1.4.5L5 19.3l-.5-1.4L3.1 17.4l1.4-.5L5 15.5Z" fill="currentColor"/>`,

  /* ── Objects, content-types & rail categories ──────────── */
  "gearshape": `<path d="M9.7 3.4h4.6l.5 2.3 1.7 1 2.2-.8 2.3 4-1.8 1.5.1 2-.1 0 1.8 1.5-2.3 4-2.2-.8-1.7 1-.5 2.3H9.7l-.5-2.3-1.7-1-2.2.8-2.3-4L4.8 13l-.1-2 .1 0L2.9 9.4l2.3-4 2.2.8 1.7-1 .6-1.8Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" stroke="currentColor" fill="none"/>`,
  "gearshape.fill": `<path d="M9.7 3.4h4.6l.5 2.3 1.7 1 2.2-.8 2.3 4-1.8 1.5.1 2-.1 0 1.8 1.5-2.3 4-2.2-.8-1.7 1-.5 2.3H9.7l-.5-2.3-1.7-1-2.2.8-2.3-4L4.8 13l-.1-2 .1 0L2.9 9.4l2.3-4 2.2.8 1.7-1 .6-1.8Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><circle cx="12" cy="12" r="3.2" fill="${KO}"/>`,
  "doc.text": `<path d="M6 3h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><polyline points="13 3 13 8 18 8" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="8" y1="12" x2="15" y2="12" stroke="currentColor"/><line x1="8" y1="15.5" x2="15" y2="15.5" stroke="currentColor"/><line x1="8" y1="19" x2="12" y2="19" stroke="currentColor"/>`,
  "doc.text.fill": `<path d="M6 3h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="currentColor"/><polyline points="13 3.5 13 8 17.5 8" fill="none" stroke="${KO}" stroke-width="1.5" stroke-linejoin="round"/><line x1="8" y1="12.5" x2="15" y2="12.5" stroke="${KO}" stroke-width="1.6" stroke-linecap="round"/><line x1="8" y1="16" x2="13" y2="16" stroke="${KO}" stroke-width="1.6" stroke-linecap="round"/>`,
  "folder": `<path d="M3 7.5a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6l1.4 1.4H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "folder.fill": `<path d="M3 7.5a2 2 0 0 1 2-2h3.6a2 2 0 0 1 1.4.6l1.4 1.4H19a2 2 0 0 1 2 2V18a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7.5Z" fill="currentColor"/>`,
  "bell": `<path d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" fill="none"/>`,
  "bell.fill": `<path d="M6 9.5a6 6 0 0 1 12 0c0 5 2 6 2 6H4s2-1 2-6Z" fill="currentColor"/><path d="M10 19a2 2 0 0 0 4 0" stroke="currentColor" fill="none"/>`,
  "person": `<circle cx="12" cy="8" r="4" stroke="currentColor" fill="none"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0" stroke="currentColor" fill="none"/>`,
  "person.fill": `<circle cx="12" cy="7.5" r="4" fill="currentColor"/><path d="M4 20.5a8 8 0 0 1 16 0Z" fill="currentColor"/>`,
  "person.2.fill": `<circle cx="8.5" cy="8" r="3.4" fill="currentColor"/><path d="M2.5 19.5a6 6 0 0 1 12 0Z" fill="currentColor"/><circle cx="16.5" cy="8.5" r="3" fill="currentColor" opacity="0.85"/><path d="M14 19.5a5.5 5.5 0 0 1 .8-2.9A6 6 0 0 1 21.5 19.5Z" fill="currentColor" opacity="0.85"/>`,
  "calendar": `<rect x="3.5" y="5" width="17" height="16" rx="2.5" stroke="currentColor" fill="none"/><line x1="3.5" y1="9.5" x2="20.5" y2="9.5" stroke="currentColor"/><line x1="8" y1="3" x2="8" y2="6.5" stroke="currentColor"/><line x1="16" y1="3" x2="16" y2="6.5" stroke="currentColor"/>`,
  "chart.line.uptrend.xyaxis": `<polyline points="4 4 4 20 20 20" stroke="currentColor" fill="none"/><polyline points="6.5 15.5 10.5 11.5 13.5 14 19 7.5" stroke="currentColor" fill="none"/><polyline points="15 7.5 19 7.5 19 11.5" stroke="currentColor" fill="none"/>`,
  "chart.bar.fill": `<rect x="4" y="12" width="4" height="8" rx="1" fill="currentColor"/><rect x="10" y="7" width="4" height="13" rx="1" fill="currentColor"/><rect x="16" y="4" width="4" height="16" rx="1" fill="currentColor"/>`,
  "bookmark": `<path d="M6 4.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 4.5V21l-6-4.2L6 21V4.5Z" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "bookmark.fill": `<path d="M6 4.5a1.5 1.5 0 0 1 1.5-1.5h9A1.5 1.5 0 0 1 18 4.5V21l-6-4.2L6 21V4.5Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "envelope": `<rect x="3" y="5.5" width="18" height="13" rx="2.5" stroke="currentColor" fill="none"/><polyline points="4 8 12 13 20 8" stroke="currentColor" fill="none"/>`,
  "envelope.fill": `<rect x="3" y="5.5" width="18" height="13" rx="2.5" fill="currentColor"/><polyline points="4.5 8.5 12 13.2 19.5 8.5" fill="none" stroke="${KO}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  "envelope.open": `<path d="M3 10.5 12 4l9 6.5V18a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 18v-7.5Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><polyline points="3 10.5 12 16.5 21 10.5" stroke="currentColor" fill="none"/>`,
  "star.fill": `<path d="M12 3 14.7 8.6l6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9L12 3Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "newspaper": `<path d="M4.5 5.5a1.5 1.5 0 0 1 1.5-1.5h11.5A1.5 1.5 0 0 1 19 5.5V18a2 2 0 0 1-2 2H6a1.5 1.5 0 0 1-1.5-1.5V5.5Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M19 8.5h1.5a1 1 0 0 1 1 1V18a2 2 0 0 1-2 2" stroke="currentColor" fill="none"/><line x1="7.5" y1="8.5" x2="15.5" y2="8.5" stroke="currentColor"/><line x1="7.5" y1="12" x2="15.5" y2="12" stroke="currentColor"/><line x1="7.5" y1="15.5" x2="12" y2="15.5" stroke="currentColor"/>`,
  "sunrise": `<line x1="12" y1="2.5" x2="12" y2="6" stroke="currentColor"/><line x1="5" y1="9" x2="6.5" y2="10.5" stroke="currentColor"/><line x1="19" y1="9" x2="17.5" y2="10.5" stroke="currentColor"/><path d="M8 15a4 4 0 0 1 8 0" stroke="currentColor" fill="none"/><line x1="2.5" y1="18.5" x2="21.5" y2="18.5" stroke="currentColor"/><polyline points="9 8 12 5 15 8" stroke="currentColor" fill="none"/>`,
  "scope": `<circle cx="12" cy="12" r="8" stroke="currentColor" fill="none"/><line x1="12" y1="2.5" x2="12" y2="6" stroke="currentColor"/><line x1="12" y1="18" x2="12" y2="21.5" stroke="currentColor"/><line x1="2.5" y1="12" x2="6" y2="12" stroke="currentColor"/><line x1="18" y1="12" x2="21.5" y2="12" stroke="currentColor"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`,
  "terminal": `<rect x="3" y="4.5" width="18" height="15" rx="2.5" stroke="currentColor" fill="none"/><polyline points="7 9.5 10 12 7 14.5" stroke="currentColor" fill="none"/><line x1="12.5" y1="14.5" x2="16.5" y2="14.5" stroke="currentColor"/>`,
  "globe": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="3" y1="12" x2="21" y2="12" stroke="currentColor"/><path d="M12 3c2.7 2.4 4.2 5.6 4.2 9s-1.5 6.6-4.2 9c-2.7-2.4-4.2-5.6-4.2-9s1.5-6.6 4.2-9Z" stroke="currentColor" fill="none"/>`,
  "photo": `<rect x="3" y="5" width="18" height="14" rx="2.5" stroke="currentColor" fill="none"/><circle cx="8.5" cy="9.5" r="1.6" stroke="currentColor" fill="none"/><polyline points="4 17.5 9.5 12 13 15 16 12 20 16" stroke="currentColor" fill="none"/>`,
  "cart.fill": `<circle cx="9.5" cy="20" r="1.6" fill="currentColor"/><circle cx="17" cy="20" r="1.6" fill="currentColor"/><path d="M2.5 3.5H5l2.3 11.1a1.6 1.6 0 0 0 1.6 1.3h8a1.6 1.6 0 0 0 1.6-1.2L21.5 7.5H6" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "creditcard.fill": `<rect x="2.5" y="5" width="19" height="14" rx="2.5" fill="currentColor"/><rect x="2.5" y="8.5" width="19" height="2.4" fill="${KO}"/><line x1="6" y1="15" x2="10.5" y2="15" stroke="${KO}" stroke-width="1.6" stroke-linecap="round"/>`,
  "megaphone.fill": `<path d="M3.5 10.5v3l3 .4 1.4 4.3a1 1 0 0 0 2-.3l-.2-2.9L18 17.5V6.5L9.9 9.9 3.5 10.5Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><path d="M18 8.5a3 3 0 0 1 0 7" stroke="currentColor" fill="none"/>`,
  "bubble.left.and.bubble.right": `<path d="M2.5 6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H6.5L3 15V6Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M10 12.5v.5a2 2 0 0 0 2 2h5.5L21 18V11a2 2 0 0 0-2-2h-2.5" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "bubble.left": `<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v7A2.5 2.5 0 0 1 18.5 16H9l-6 4.5V6.5Z" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "text.bubble": `<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v7A2.5 2.5 0 0 1 18.5 16H9l-6 4.5V6.5Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="7.5" y1="8.5" x2="16.5" y2="8.5" stroke="currentColor"/><line x1="7.5" y1="11.5" x2="13" y2="11.5" stroke="currentColor"/>`,
  "quote.bubble.fill": `<path d="M3 6.5A2.5 2.5 0 0 1 5.5 4h13A2.5 2.5 0 0 1 21 6.5v7A2.5 2.5 0 0 1 18.5 16H9l-6 4.5V6.5Z" fill="currentColor"/><path d="M8.4 8.5c-1.5.4-2.4 1.6-2.4 3.2 0 .6.4 1.1 1.1 1.1s1.1-.5 1.1-1.1c0-.5-.3-.8-.6-.9.1-.6.5-1 1.1-1.2l-.3-1.1Zm5 0c-1.5.4-2.4 1.6-2.4 3.2 0 .6.4 1.1 1.1 1.1s1.1-.5 1.1-1.1c0-.5-.3-.8-.6-.9.1-.6.5-1 1.1-1.2l-.3-1.1Z" fill="${KO}"/>`,
  "crown.fill": `<path d="M2.5 7.5 6.5 11 12 4.5 17.5 11l4-3.5-1.4 11.5a1 1 0 0 1-1 .9H4.9a1 1 0 0 1-1-.9L2.5 7.5Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><circle cx="2.5" cy="7.5" r="1.3" fill="currentColor"/><circle cx="21.5" cy="7.5" r="1.3" fill="currentColor"/><circle cx="12" cy="4.5" r="1.3" fill="currentColor"/>`,
  "at": `<circle cx="12" cy="12" r="4" stroke="currentColor" fill="none"/><path d="M16 8v5a2.5 2.5 0 0 0 5 0v-1a9 9 0 1 0-3.4 7.1" stroke="currentColor" fill="none"/>`,
  "tray.full": `<path d="M3 14 5.5 5.5A2 2 0 0 1 7.4 4h9.2a2 2 0 0 1 1.9 1.5L21 14" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M3 14h5a2 2 0 0 0 4 0h0a2 2 0 0 0 4 0h5v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="7" y1="7.5" x2="17" y2="7.5" stroke="currentColor"/><line x1="6" y1="10.5" x2="18" y2="10.5" stroke="currentColor"/>`,
};

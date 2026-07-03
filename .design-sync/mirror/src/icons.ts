// Founder OS Kit — SF Symbol → inline-SVG registry.
//
// The Agentic30 SwiftUI app renders icons via `Image(systemName:)` /
// `Label(..., systemImage:)`, keyed by the exact SF Symbol string. SF Symbols
// do not exist on the web, so this map mirrors them with hand-authored,
// Lucide-style 24×24 inner markup.
//
// Conventions (see .design-sync/audit/icons.md §4/§6):
//   • Keys are the EXACT SF Symbol names so every Swift call site — literal and
//     dynamic (`item.systemImage`, ternaries, helper lookups) — resolves 1:1.
//   • Values are the INNER markup of a `<svg viewBox="0 0 24 24">` only (no
//     wrapping <svg>). `<Icon>` wraps it and sets width/height/color.
//   • Stroke icons use `stroke="currentColor" fill="none"`; they inherit the
//     caller's `strokeWidth` because they omit `stroke-width` here.
//   • `.fill` variants use `fill="currentColor"` so semantic tint is external.
//   • Never bake a color: tint comes from the parent (`currentColor`).
//
// Coverage: the ~50+ most-used STRUCTURAL symbols from the audit. Unmapped
// names degrade to a visible dev fallback in <Icon>, they never crash.

export const ICONS: Record<string, string> = {
  /* ── Navigation & disclosure ───────────────────────────── */
  "chevron.left": `<polyline points="15 6 9 12 15 18" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "chevron.right": `<polyline points="9 6 15 12 9 18" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "chevron.up": `<polyline points="6 15 12 9 18 15" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "chevron.down": `<polyline points="6 9 12 15 18 9" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "chevron.right.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><polyline points="11 8.5 14.5 12 11 15.5" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "chevron.right.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><polyline points="11 8.5 14.5 12 11 15.5" fill="none" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  "chevron.down.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><polyline points="8.5 11 12 14.5 15.5 11" fill="none" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  "arrow.right": `<line x1="4" y1="12" x2="19" y2="12" stroke="currentColor" stroke-linecap="round"/><polyline points="13 6 19 12 13 18" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "arrow.left": `<line x1="20" y1="12" x2="5" y2="12" stroke="currentColor" stroke-linecap="round"/><polyline points="11 6 5 12 11 18" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "arrow.up.right": `<line x1="6" y1="18" x2="18" y2="6" stroke="currentColor" stroke-linecap="round"/><polyline points="9 6 18 6 18 15" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "arrow.right.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><line x1="8" y1="12" x2="15" y2="12" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round"/><polyline points="12.5 9 15.5 12 12.5 15" fill="none" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  "sidebar.left": `<rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" fill="none"/><line x1="9" y1="4" x2="9" y2="20" stroke="currentColor"/>`,
  "sidebar.right": `<rect x="3" y="4" width="18" height="16" rx="2.5" stroke="currentColor" fill="none"/><line x1="15" y1="4" x2="15" y2="20" stroke="currentColor"/>`,
  "line.3.horizontal": `<line x1="4" y1="7" x2="20" y2="7" stroke="currentColor" stroke-linecap="round"/><line x1="4" y1="12" x2="20" y2="12" stroke="currentColor" stroke-linecap="round"/><line x1="4" y1="17" x2="20" y2="17" stroke="currentColor" stroke-linecap="round"/>`,
  "line.3.horizontal.decrease.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="7.5" y1="9" x2="16.5" y2="9" stroke="currentColor" stroke-linecap="round"/><line x1="9" y1="12" x2="15" y2="12" stroke="currentColor" stroke-linecap="round"/><line x1="10.5" y1="15" x2="13.5" y2="15" stroke="currentColor" stroke-linecap="round"/>`,
  "ellipsis": `<circle cx="5" cy="12" r="1.4" fill="currentColor"/><circle cx="12" cy="12" r="1.4" fill="currentColor"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>`,

  /* ── Status, verdict & state ───────────────────────────── */
  "checkmark": `<polyline points="5 12.5 10 17.5 19 6.5" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "checkmark.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><polyline points="8 12.5 11 15.5 16 9" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "checkmark.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><polyline points="8 12.5 11 15.5 16 9" fill="none" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"/>`,
  "xmark": `<line x1="6" y1="6" x2="18" y2="18" stroke="currentColor" stroke-linecap="round"/><line x1="18" y1="6" x2="6" y2="18" stroke="currentColor" stroke-linecap="round"/>`,
  "xmark.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="9" y1="9" x2="15" y2="15" stroke="currentColor" stroke-linecap="round"/><line x1="15" y1="9" x2="9" y2="15" stroke="currentColor" stroke-linecap="round"/>`,
  "xmark.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><line x1="9" y1="9" x2="15" y2="15" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round"/><line x1="15" y1="9" x2="9" y2="15" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round"/>`,
  "xmark.octagon.fill": `<path d="M8.2 3h7.6L21 8.2v7.6L15.8 21H8.2L3 15.8V8.2L8.2 3Z" fill="currentColor"/><line x1="9" y1="9" x2="15" y2="15" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round"/><line x1="15" y1="9" x2="9" y2="15" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round"/>`,
  "exclamationmark.triangle": `<path d="M12 4 21 19H3L12 4Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="12" y1="10" x2="12" y2="14" stroke="currentColor" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1" fill="currentColor"/>`,
  "exclamationmark.triangle.fill": `<path d="M12 4 21 19H3L12 4Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><line x1="12" y1="10" x2="12" y2="14" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round"/><circle cx="12" cy="16.6" r="1" fill="var(--ds-bg-0, #101214)"/>`,
  "exclamationmark.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="12" y1="7.5" x2="12" y2="13" stroke="currentColor" stroke-linecap="round"/><circle cx="12" cy="16" r="1" fill="currentColor"/>`,
  "info.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="12" y1="11" x2="12" y2="16.5" stroke="currentColor" stroke-linecap="round"/><circle cx="12" cy="8" r="1" fill="currentColor"/>`,
  "questionmark.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><path d="M9.5 9.2a2.5 2.5 0 1 1 3.4 2.7c-.7.4-.9 1-.9 1.6" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="12" cy="16.3" r="1" fill="currentColor"/>`,
  "circle": `<circle cx="12" cy="12" r="8" stroke="currentColor" fill="none"/>`,
  "circle.fill": `<circle cx="12" cy="12" r="8" fill="currentColor"/>`,
  "circle.dashed": `<circle cx="12" cy="12" r="8" stroke="currentColor" fill="none" stroke-dasharray="2.4 2.4"/>`,
  "circle.dotted": `<circle cx="12" cy="12" r="8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-dasharray="0.1 3.3"/>`,
  "record.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><circle cx="12" cy="12" r="4" fill="currentColor"/>`,
  "dot.radiowaves.left.and.right": `<circle cx="12" cy="12" r="2" fill="currentColor"/><path d="M7 8a6 6 0 0 0 0 8" stroke="currentColor" fill="none" stroke-linecap="round"/><path d="M17 8a6 6 0 0 1 0 8" stroke="currentColor" fill="none" stroke-linecap="round"/><path d="M4.5 6a9 9 0 0 0 0 12" stroke="currentColor" fill="none" stroke-linecap="round"/><path d="M19.5 6a9 9 0 0 1 0 12" stroke="currentColor" fill="none" stroke-linecap="round"/>`,
  "clock": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><polyline points="12 7 12 12 15.5 14" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "clock.arrow.circlepath": `<path d="M20 12a8 8 0 1 1-2.5-5.8" stroke="currentColor" fill="none" stroke-linecap="round"/><polyline points="20 4 20 8 16 8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><polyline points="12 8 12 12 15 14" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "hourglass": `<path d="M7 4h10M7 20h10" stroke="currentColor" stroke-linecap="round"/><path d="M7 4c0 4 5 5 5 8s-5 4-5 8" stroke="currentColor" fill="none"/><path d="M17 4c0 4-5 5-5 8s5 4 5 8" stroke="currentColor" fill="none"/>`,

  /* ── Locks / security / auth ───────────────────────────── */
  "lock": `<rect x="5" y="11" width="14" height="9" rx="2" stroke="currentColor" fill="none"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" fill="none"/>`,
  "lock.fill": `<rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 8 0v3" stroke="currentColor" fill="none"/>`,
  "lock.open.fill": `<rect x="5" y="11" width="14" height="9" rx="2" fill="currentColor"/><path d="M8 11V8a4 4 0 0 1 7.7-2" stroke="currentColor" fill="none" stroke-linecap="round"/>`,
  "key.fill": `<circle cx="8" cy="8" r="4.2" fill="currentColor"/><path d="M11 11l7 7M16 16l2-2M14.5 14.5l2.2-2.2" stroke="currentColor" fill="none" stroke-linecap="round"/>`,
  "hand.raised.fill": `<path d="M7 12V6.2a1.3 1.3 0 0 1 2.6 0V11m0-1V4.6a1.3 1.3 0 0 1 2.6 0V11m0-1V5.3a1.3 1.3 0 0 1 2.6 0V12m0-1.5a1.3 1.3 0 0 1 2.6 0v3.2a6 6 0 0 1-6 6h-.6a5 5 0 0 1-4-2l-2.4-3.2a1.4 1.4 0 0 1 2.2-1.7L7 14" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,

  /* ── Actions & tools ───────────────────────────────────── */
  "arrow.clockwise": `<path d="M20 12a8 8 0 1 1-2.3-5.6" stroke="currentColor" fill="none" stroke-linecap="round"/><polyline points="20 3.5 20 7.5 16 7.5" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "arrow.triangle.2.circlepath": `<path d="M4.5 11a7.5 7.5 0 0 1 12.8-4.2L20 9" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><polyline points="20 4 20 9 15 9" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M19.5 13a7.5 7.5 0 0 1-12.8 4.2L4 15" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><polyline points="4 20 4 15 9 15" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "magnifyingglass": `<circle cx="11" cy="11" r="6.5" stroke="currentColor" fill="none"/><line x1="16" y1="16" x2="20" y2="20" stroke="currentColor" stroke-linecap="round"/>`,
  "trash": `<polyline points="4 7 20 7" stroke="currentColor" fill="none" stroke-linecap="round"/><path d="M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="10" y1="11" x2="10" y2="17" stroke="currentColor" stroke-linecap="round"/><line x1="14" y1="11" x2="14" y2="17" stroke="currentColor" stroke-linecap="round"/>`,
  "plus": `<line x1="12" y1="5" x2="12" y2="19" stroke="currentColor" stroke-linecap="round"/><line x1="5" y1="12" x2="19" y2="12" stroke="currentColor" stroke-linecap="round"/>`,
  "plus.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="12" y1="8" x2="12" y2="16" stroke="currentColor" stroke-linecap="round"/><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-linecap="round"/>`,
  "plus.circle.fill": `<circle cx="12" cy="12" r="9" fill="currentColor"/><line x1="12" y1="8" x2="12" y2="16" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round"/><line x1="8" y1="12" x2="16" y2="12" stroke="var(--ds-bg-0, #101214)" stroke-width="1.8" stroke-linecap="round"/>`,
  "minus.circle": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><line x1="8" y1="12" x2="16" y2="12" stroke="currentColor" stroke-linecap="round"/>`,
  "pencil": `<path d="M4 20l1-4L16 5a2 2 0 0 1 2.8 0l.2.2a2 2 0 0 1 0 2.8L8 19l-4 1Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="14" y1="7" x2="17" y2="10" stroke="currentColor"/>`,
  "paperclip": `<path d="M18 9.5 10 17.5a3 3 0 0 1-4.2-4.2l8-8a2 2 0 0 1 2.9 2.9l-8 8a1 1 0 0 1-1.4-1.4l7-7" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "paperplane.fill": `<path d="M20.5 3.5 3 10.5l6.5 2.5L12 20l3-6.5 5.5-10Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "square.and.arrow.up": `<path d="M12 3v11" stroke="currentColor" stroke-linecap="round"/><polyline points="8 7 12 3 16 7" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "square.and.arrow.down": `<path d="M12 14V3" stroke="currentColor" stroke-linecap="round"/><polyline points="8 10 12 14 16 10" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M6 11H5a2 2 0 0 0-2 2v6a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-6a2 2 0 0 0-2-2h-1" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "doc.on.doc": `<rect x="8" y="8" width="12" height="13" rx="2" stroke="currentColor" fill="none"/><path d="M16 8V5a2 2 0 0 0-2-2H6a2 2 0 0 0-2 2v10a2 2 0 0 0 2 2h2" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "play.fill": `<path d="M7 4.5 19 12 7 19.5V4.5Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "pause.fill": `<rect x="6.5" y="4.5" width="4" height="15" rx="1" fill="currentColor"/><rect x="13.5" y="4.5" width="4" height="15" rx="1" fill="currentColor"/>`,
  "stop.fill": `<rect x="5.5" y="5.5" width="13" height="13" rx="2" fill="currentColor"/>`,
  "link": `<path d="M9.5 14.5 14.5 9.5" stroke="currentColor" stroke-linecap="round"/><path d="M11 7l1.6-1.6a4 4 0 0 1 5.7 5.7L16.7 12.7" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><path d="M13 17l-1.6 1.6a4 4 0 0 1-5.7-5.7L7.3 11.3" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "eye": `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" fill="none"/>`,
  "eye.fill": `<path d="M2.5 12S6 5.5 12 5.5 21.5 12 21.5 12 18 18.5 12 18.5 2.5 12 2.5 12Z" fill="currentColor"/><circle cx="12" cy="12" r="3" fill="var(--ds-bg-0, #101214)"/>`,
  "eye.slash": `<path d="M4 4 20 20" stroke="currentColor" stroke-linecap="round"/><path d="M9.5 6C10.3 5.7 11.1 5.5 12 5.5c6 0 9.5 6.5 9.5 6.5a17 17 0 0 1-3 3.6" stroke="currentColor" fill="none" stroke-linecap="round"/><path d="M6.3 8.2A17 17 0 0 0 2.5 12S6 18.5 12 18.5c1.3 0 2.5-.3 3.6-.8" stroke="currentColor" fill="none" stroke-linecap="round"/><path d="M9.9 10a3 3 0 0 0 4.2 4.2" stroke="currentColor" fill="none" stroke-linecap="round"/>`,
  "waveform": `<line x1="4" y1="10" x2="4" y2="14" stroke="currentColor" stroke-linecap="round"/><line x1="8" y1="6" x2="8" y2="18" stroke="currentColor" stroke-linecap="round"/><line x1="12" y1="3" x2="12" y2="21" stroke="currentColor" stroke-linecap="round"/><line x1="16" y1="7" x2="16" y2="17" stroke="currentColor" stroke-linecap="round"/><line x1="20" y1="10" x2="20" y2="14" stroke="currentColor" stroke-linecap="round"/>`,
  "mic": `<rect x="9" y="3" width="6" height="11" rx="3" stroke="currentColor" fill="none"/><path d="M6 11a6 6 0 0 0 12 0" stroke="currentColor" fill="none" stroke-linecap="round"/><line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" stroke-linecap="round"/><line x1="9" y1="21" x2="15" y2="21" stroke="currentColor" stroke-linecap="round"/>`,
  "mic.fill": `<rect x="9" y="3" width="6" height="11" rx="3" fill="currentColor"/><path d="M6 11a6 6 0 0 0 12 0" stroke="currentColor" fill="none" stroke-linecap="round"/><line x1="12" y1="17" x2="12" y2="21" stroke="currentColor" stroke-linecap="round"/><line x1="9" y1="21" x2="15" y2="21" stroke="currentColor" stroke-linecap="round"/>`,
  "bolt.fill": `<path d="M13 2 4 13.5h6L11 22l9-11.5h-6L13 2Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "sparkles": `<path d="M12 3l1.6 4.4L18 9l-4.4 1.6L12 15l-1.6-4.4L6 9l4.4-1.6L12 3Z" fill="currentColor"/><path d="M18.5 14l.8 2 2 .8-2 .8-.8 2-.8-2-2-.8 2-.8.8-2Z" fill="currentColor"/><path d="M5.5 14.5l.6 1.5 1.5.6-1.5.6-.6 1.5-.6-1.5L2.9 17l1.5-.6.6-1.5Z" fill="currentColor"/>`,

  /* ── Objects, content-types & rail categories ──────────── */
  "gearshape": `<path d="M10.3 3.5h3.4l.5 2.2 1.6.9 2.1-.8 1.7 3-1.6 1.5v1.4l1.6 1.5-1.7 3-2.1-.8-1.6.9-.5 2.2h-3.4l-.5-2.2-1.6-.9-2.1.8-1.7-3 1.6-1.5v-1.4L4.4 8.8l1.7-3 2.1.8 1.6-.9.5-2.2Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" stroke="currentColor" fill="none"/>`,
  "gearshape.fill": `<path d="M10.3 3.5h3.4l.5 2.2 1.6.9 2.1-.8 1.7 3-1.6 1.5v1.4l1.6 1.5-1.7 3-2.1-.8-1.6.9-.5 2.2h-3.4l-.5-2.2-1.6-.9-2.1.8-1.7-3 1.6-1.5v-1.4L4.4 8.8l1.7-3 2.1.8 1.6-.9.5-2.2Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><circle cx="12" cy="12" r="3" fill="var(--ds-bg-0, #101214)"/>`,
  "doc.text": `<path d="M6 3h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><polyline points="13 3 13 8 18 8" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="8" y1="12" x2="15" y2="12" stroke="currentColor" stroke-linecap="round"/><line x1="8" y1="15.5" x2="15" y2="15.5" stroke="currentColor" stroke-linecap="round"/>`,
  "doc.text.fill": `<path d="M6 3h7l5 5v11a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2Z" fill="currentColor"/><polyline points="13 3 13 8 18 8" fill="none" stroke="var(--ds-bg-0, #101214)" stroke-width="1.6" stroke-linejoin="round"/><line x1="8" y1="12.5" x2="15" y2="12.5" stroke="var(--ds-bg-0, #101214)" stroke-width="1.6" stroke-linecap="round"/><line x1="8" y1="15.5" x2="13" y2="15.5" stroke="var(--ds-bg-0, #101214)" stroke-width="1.6" stroke-linecap="round"/>`,
  "folder": `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "folder.fill": `<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V7Z" fill="currentColor"/>`,
  "bell": `<path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5 1.5 5H4.5S6 14 6 10Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" fill="none" stroke-linecap="round"/>`,
  "bell.fill": `<path d="M6 10a6 6 0 0 1 12 0c0 4 1.5 5 1.5 5H4.5S6 14 6 10Z" fill="currentColor"/><path d="M10 18a2 2 0 0 0 4 0" stroke="currentColor" fill="none" stroke-linecap="round"/>`,
  "person": `<circle cx="12" cy="8" r="4" stroke="currentColor" fill="none"/><path d="M5 20a7 7 0 0 1 14 0" stroke="currentColor" fill="none" stroke-linecap="round"/>`,
  "person.fill": `<circle cx="12" cy="8" r="4" fill="currentColor"/><path d="M4.5 20a7.5 7.5 0 0 1 15 0Z" fill="currentColor"/>`,
  "person.2.fill": `<circle cx="9" cy="8" r="3.4" fill="currentColor"/><path d="M3 19a6 6 0 0 1 12 0Z" fill="currentColor"/><circle cx="17" cy="8.5" r="3" fill="currentColor" opacity="0.85"/><path d="M15 19a5.5 5.5 0 0 1 6.5-5.4A6 6 0 0 1 22 19Z" fill="currentColor" opacity="0.85"/>`,
  "calendar": `<rect x="4" y="5" width="16" height="16" rx="2" stroke="currentColor" fill="none"/><line x1="4" y1="9" x2="20" y2="9" stroke="currentColor"/><line x1="8" y1="3" x2="8" y2="6" stroke="currentColor" stroke-linecap="round"/><line x1="16" y1="3" x2="16" y2="6" stroke="currentColor" stroke-linecap="round"/>`,
  "chart.line.uptrend.xyaxis": `<polyline points="4 4 4 20 20 20" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><polyline points="7 15 11 11 14 13.5 19 7.5" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><polyline points="15 7.5 19 7.5 19 11" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "chart.bar.fill": `<rect x="4" y="12" width="4" height="8" rx="1" fill="currentColor"/><rect x="10" y="7" width="4" height="13" rx="1" fill="currentColor"/><rect x="16" y="4" width="4" height="16" rx="1" fill="currentColor"/>`,
  "bookmark": `<path d="M6 4h12v16l-6-4-6 4V4Z" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "bookmark.fill": `<path d="M6 4h12v16l-6-4-6 4V4Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "envelope": `<rect x="3" y="6" width="18" height="12" rx="2" stroke="currentColor" fill="none"/><polyline points="4 8 12 13 20 8" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "envelope.fill": `<rect x="3" y="6" width="18" height="12" rx="2" fill="currentColor"/><polyline points="4 8 12 13 20 8" fill="none" stroke="var(--ds-bg-0, #101214)" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/>`,
  "envelope.open": `<path d="M3 10l9-6 9 6v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-8Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><polyline points="3 10 12 16 21 10" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "star.fill": `<path d="M12 3.5 14.6 9l6 .6-4.5 4 1.3 5.9L12 16.6 6.6 19.5 7.9 13.6 3.4 9.6l6-.6L12 3.5Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "newspaper": `<rect x="4" y="5" width="14" height="15" rx="1.5" stroke="currentColor" fill="none"/><path d="M18 8h2v10a2 2 0 0 1-2 2" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="7" y1="9" x2="15" y2="9" stroke="currentColor" stroke-linecap="round"/><line x1="7" y1="12.5" x2="15" y2="12.5" stroke="currentColor" stroke-linecap="round"/><line x1="7" y1="16" x2="11" y2="16" stroke="currentColor" stroke-linecap="round"/>`,
  "scope": `<circle cx="12" cy="12" r="8" stroke="currentColor" fill="none"/><line x1="12" y1="2.5" x2="12" y2="6" stroke="currentColor" stroke-linecap="round"/><line x1="12" y1="18" x2="12" y2="21.5" stroke="currentColor" stroke-linecap="round"/><line x1="2.5" y1="12" x2="6" y2="12" stroke="currentColor" stroke-linecap="round"/><line x1="18" y1="12" x2="21.5" y2="12" stroke="currentColor" stroke-linecap="round"/><circle cx="12" cy="12" r="1.6" fill="currentColor"/>`,
  "terminal": `<rect x="3" y="4" width="18" height="16" rx="2" stroke="currentColor" fill="none"/><polyline points="7 9 10 12 7 15" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><line x1="12.5" y1="15" x2="16" y2="15" stroke="currentColor" stroke-linecap="round"/>`,
  "globe": `<circle cx="12" cy="12" r="9" stroke="currentColor" fill="none"/><path d="M3 12h18" stroke="currentColor"/><path d="M12 3c2.6 2.4 4 5.6 4 9s-1.4 6.6-4 9c-2.6-2.4-4-5.6-4-9s1.4-6.6 4-9Z" stroke="currentColor" fill="none"/>`,
  "photo": `<rect x="3" y="5" width="18" height="14" rx="2" stroke="currentColor" fill="none"/><circle cx="8.5" cy="9.5" r="1.6" stroke="currentColor" fill="none"/><polyline points="5 17 10 12 14 15.5 17 13 21 17" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/>`,
  "cart.fill": `<path d="M3 4h2l2.4 11a1.5 1.5 0 0 0 1.5 1.2h7.5a1.5 1.5 0 0 0 1.5-1.1L20 8H6" stroke="currentColor" fill="none" stroke-linecap="round" stroke-linejoin="round"/><circle cx="9.5" cy="20" r="1.4" fill="currentColor"/><circle cx="17" cy="20" r="1.4" fill="currentColor"/>`,
  "creditcard.fill": `<rect x="3" y="5" width="18" height="14" rx="2.5" fill="currentColor"/><line x1="3" y1="9.5" x2="21" y2="9.5" stroke="var(--ds-bg-0, #101214)" stroke-width="1.6"/><line x1="6.5" y1="14.5" x2="11" y2="14.5" stroke="var(--ds-bg-0, #101214)" stroke-width="1.6" stroke-linecap="round"/>`,
  "megaphone.fill": `<path d="M4 10v4l3 .5 1.5 4a1 1 0 0 0 2-.4l-.3-3L18 17V7L10.5 9.5 4 10Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/><path d="M18 8a3 3 0 0 1 0 8" stroke="currentColor" fill="none" stroke-linecap="round"/>`,
  "bubble.left.and.bubble.right": `<path d="M3 6a2 2 0 0 1 2-2h7a2 2 0 0 1 2 2v4a2 2 0 0 1-2 2H7l-3 2.5V6Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><path d="M10 12.5V13a2 2 0 0 0 2 2h5l3 2.5V11a2 2 0 0 0-2-2h-2" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "bubble.left": `<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4V6Z" stroke="currentColor" fill="none" stroke-linejoin="round"/>`,
  "text.bubble": `<path d="M4 6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H9l-5 4V6Z" stroke="currentColor" fill="none" stroke-linejoin="round"/><line x1="8" y1="8.5" x2="16" y2="8.5" stroke="currentColor" stroke-linecap="round"/><line x1="8" y1="11.5" x2="13" y2="11.5" stroke="currentColor" stroke-linecap="round"/>`,
  "crown.fill": `<path d="M3 8l3.5 3L12 5l5.5 6L21 8l-1.5 10H4.5L3 8Z" fill="currentColor" stroke="currentColor" stroke-linejoin="round"/>`,
  "at": `<circle cx="12" cy="12" r="4" stroke="currentColor" fill="none"/><path d="M16 8v5a2.5 2.5 0 0 0 5 0v-1a9 9 0 1 0-3.5 7.2" stroke="currentColor" fill="none" stroke-linecap="round"/>`,
};

# design-sync NOTES — agentic30

## ⚠️ This is a FORCE-FIT sync (read first)

`agentic30-public` is a **SwiftUI Mac app + Node sidecar**, not a JS/React design
system. There is no shipped component library to sync. At the user's explicit
direction ("강행"), the synced library is a **hand-built React mirror** under
`.design-sync/mirror/`, derived from the design authority:

- `STYLESEED.md` (design lock) + `agentic30/OpenDesignTokens.swift` (tokens)
- `mockups/promise-card.html`, `mockups/sidebar-ia.html`, `mockups/office-hours-ia.html`

The mirror is **NOT the repo's shipped code** — it is a reimplementation that
encodes the same tokens and surfaces as React components. 14 components:
Button, Badge, Input, SectionHeader, Card, ActionOption, StateCard, DebtBanner,
DayRow, Stepper, QuestionCard, SignalTable, PromiseCard, DayTimelineSidebar.

## Build / re-sync mechanics

- `cfg.buildCmd` = `node .design-sync/mirror/build.mjs` → emits `dist/index.js`
  (esbuild ESM, react external), `dist/index.d.ts` (tsc), `dist/ds.css`.
- Converter invocation:
  `--node-modules .design-sync/mirror/node_modules --entry .design-sync/mirror/dist/index.js`.
- `cfg.cssEntry` = `dist/ds.css` (resolved relative to the mirror = pkgRoot). It holds
  BOTH the `:root` `--ds-*` tokens and all component classes (one file).
- **Fresh clone setup** (mirror + converter node_modules are gitignored):
  1. `cd .design-sync/mirror && npm i` then `node build.mjs`
  2. re-stage `.ds-sync` (base SKILL §7 `cp -r`) + `cd .ds-sync && npm i esbuild ts-morph @types/react playwright && npx playwright install chromium`

## Fonts
- `[FONT_MISSING]` for "SF Pro Text" / "Pretendard" is **intentionally suppressed** via
  `cfg.runtimeFontPrefixes: ["SF Pro", "Pretendard"]`. The design uses a system stack
  (`-apple-system, system-ui`); SF Pro is OS-served, Pretendard is a host-installed KR
  fallback. On claude.ai/design it renders via `system-ui` — the intended macOS-native
  look. No brand webfont exists to ship. Do not "resolve" this with a substitute woff2.

## Known render warns
- `[GRID_OVERFLOW]` on 10 components (ActionOption, Button, Card, DebtBanner, Input,
  PromiseCard, QuestionCard, SectionHeader, StateCard, Stepper) was resolved with
  `cfg.overrides.<Name>.cardMode = "column"` (their previews are intentionally wide /
  use fixed-width dark canvases). Column cards can't re-flag `wide`, so a clean re-validate
  is expected — not a new warn.

## Previews
- All 14 previews are authored (`.design-sync/previews/*.tsx`), each graded `good`.
- Previews wrap each cell in a `background: var(--ds-page)` canvas because the DS is
  **dark-first**; without it, components render on the wrong (light) background. This is
  composition-only, not a component requirement (the conventions header tells the design
  agent to do the same wrap in real screens).

## Re-sync risks (watch-list)
- **Drift Swift → mirror is manual.** When `STYLESEED.md` or `OpenDesignTokens.swift` or
  the mockups change, the React mirror does NOT update automatically — hand-port the change
  into `.design-sync/mirror/src/` and rebuild. The mirror can silently fall behind the app.
- The mirror pins react@19 / typescript@6 / esbuild@0.28 (installed fresh, not lockfile-pinned).
  A future `npm i` may pull newer majors; output is deterministic but verify the build still
  emits all 14 `dist/components/*.d.ts`.
- `dangerouslySetInnerHTML` is intentionally NOT used; `DebtBanner.title` / `PromiseCard`
  notes take `ReactNode` so callers compose `<b>` safely.
- Grades live in gitignored `.cache/`; durable verified-state is the uploaded `_ds_sync.json`.

## Project
- claude.ai/design project: **Agentic30 UI Kit** — `adbfbb45-72b7-4f16-82b1-dba7073f71b1`
  (pinned in `config.json`). First sync: 2026-06-30.

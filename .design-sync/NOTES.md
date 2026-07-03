# design-sync NOTES — Founder OS Kit

## ⚠️ This is a FORCE-FIT sync (read first)

`agentic30-public` is a **SwiftUI Mac app + Node sidecar**, NOT a JS/React design system.
There is no shipped component library. At the user's explicit direction the synced library is a
**hand-built React mirror** under `.design-sync/mirror/`, derived from the app's own design
authority and **verified against real e2e app screenshots**:

- App design authority: `agentic30/OpenDesignReferencePages.swift` (the 6 reference pages),
  `OpenDesignDayPageView.swift`, `ContentView.swift`, `IntakeV2*.swift`, `MacOnboarding*.swift`,
  `MorningBriefing*.swift`, `SettingsView.swift`, `OpenDesignTokens.swift` (StyleSeed) + `STYLESEED.md`.
- The mirror is **NOT the repo's shipped code** — it re-encodes the same tokens/screens as React.

The prior "Agentic30 UI Kit" sync (14-component mirror, project `adbfbb45-…`) was **retired** at
the user's request ("완전히 처음부터, 다른 이름"). Its artifacts are archived under
`.design-sync/_archive-agentic30-ui-kit/`. The old project is left intact on claude.ai/design
(this tool cannot delete a project; remove it in the UI if desired).

## Identity / project
- claude.ai/design project: **Founder OS Kit** — `25ac21cf-3c06-4194-b8ba-a13600119bfb` (pinned in `config.json`). First sync: 2026-07-03.
- pkg `founder-os-kit`, globalName `FounderOSKit` (→ `window.FounderOSKit.*`), shape `package`.

## Build / re-sync mechanics
1. **Mirror build** (esbuild ESM react-external + tsc .d.ts + copy ds.css):
   `node .design-sync/mirror/build.mjs` → emits `dist/index.js`, `dist/index.d.ts`, `dist/ds.css`.
2. **Converter / driver**: `node .ds-sync/resync.mjs --config .design-sync/config.json
   --node-modules .design-sync/mirror/node_modules --out ./ds-bundle
   --entry .design-sync/mirror/dist/index.js` (first sync omits `--remote`; capture is slow).
   For a bare bundle regen (applies overrides + stitches readmeHeader, no capture), run
   `node .ds-sync/package-build.mjs` with the same `--config/--node-modules/--entry/--out`.
- `cfg.cssEntry = dist/ds.css` holds BOTH `:root --ds-*` tokens AND (future) component classes.
- **Fresh clone setup** (mirror + `.ds-sync` node_modules gitignored):
  1. `cd .design-sync/mirror && npm i` then `node build.mjs`
  2. re-stage `.ds-sync` (base SKILL `cp -r`) + `cd .ds-sync && npm i esbuild ts-morph @types/react playwright && npx playwright install chromium`

## Source audit (durable — the "what exists" map)
`.design-sync/audit/` holds an EXHAUSTIVE audit (6 domains + MANIFEST) run 2026-07-03:
- `views.md` — **46 screens, 283 components, 4 subviews** (333 total view structs).
- `colors.md` — **24 color namespaces, 165 tokens** (all HEX, dark+white). Core = `OpenDesignDayColor`.
- `typography.md` — 100% system fonts (SF Pro / **SF Pro Rounded** / SF Mono); 197 distinct combos; 825 mono / 241 rounded / 972 sans.
- `layout.md` — pane widths (rail 48/52, sidebar 200/220/240, meta 252/280), breakpoints (860/1100/1280), heights, radii.
- `icons.md` — **176 distinct SF Symbols, ~590 sites** → needs an `<Icon>` registry (P0 gap).
- `surfaces.md` — non-Swift surfaces (mockups/*.html, competitive-matrix.html, day1-first-surface.md).
- `MANIFEST.md` — the master build plan + gap analysis (P0/P1/P2/P3).

## e2e ground-truth
- `.design-sync/capture-e2e.sh` runs a hermetic UI-test subset; screenshots exported to
  `.design-sync/reference-shots/*.png` (27 PNGs, ~24 screens). **Local-only, never uploaded.**
- Blocking UI E2E is user-approved (standing). Reference pages capture via
  `--ui-testing-open-design-reference-page=<kind>`; other screens via their seeded tests.
- **History reference shot missing** (its test's attachment was deleteOnSuccess) — reproduce from
  source + sibling shots, or re-run its test with a keepAlways attachment.
- **~39 screens have NO shot yet** (Intake V2, Market, Founder Replay, remaining Settings, locked
  mocks, menubar, search palette) → extended e2e capture pass needed for Wave 3.

## Wave status
- **Wave 1 — SHIPPED (2026-07-03):** 40 components (28 general + 12 reference) + `ProjectsReferencePage`
  screen, uploaded to Founder OS Kit. All 40 visually verified (clean render, on-brand). ds.css is
  audit-complete: dark palette + StyleSeed + **full light theme (`[data-theme="white"]`)** +
  rounded font + spacing/pane/height/radius tokens + confetti/brand/chat/scene accents +
  reference-tone violet `#B085FA`.
- **Wave 2 — TODO (P0 infra + shot-backed screens):** `<Icon>` registry (176 SF Symbols),
  `WorkspaceShell` (responsive 3-col), `SurfaceState` (cold/loading/empty/error/unavailable),
  workspace Titlebar/Rail variants; then Settings/Interviews/BIP/News/History reference pages
  (data → ReferenceShell), Day/Today, Office Hours states, Strategy, Morning Briefing, real Settings.
- **Wave 3 — TODO (non-shot):** Intake V2 8 steps, Market, Founder Replay (~4000 lines), History,
  locked mocks, menubar, search palette — after extended e2e capture.

## Known render warns
- `[GRID_OVERFLOW]` on 14 wide/full-width components (Button, Input, ProgressBar, SectionHeader,
  StatCard, Stepper, DayCalendar, FilterTabs, PhaseGateRow, RefSection, ReferenceHeader,
  ReferenceShell, Titlebar, ProjectsReferencePage) resolved via `cfg.overrides.<Name>.cardMode="column"`.
  Column cards can't re-flag wide; a clean re-validate is expected, not a new warn.

## Fonts
- `[FONT_MISSING]` for "SF Pro" / "Pretendard" is intentionally suppressed via
  `cfg.runtimeFontPrefixes`. The design uses a system stack (`-apple-system, system-ui`,
  `ui-rounded`); SF Pro/Rounded are OS-served, Pretendard is a host-installed KR fallback. No brand
  webfont exists to ship. Do not "resolve" this with a substitute woff2.

## Re-sync risks (watch-list)
- **Drift Swift → mirror is manual.** When the app's OpenDesign* sources or STYLESEED change, the
  React mirror does NOT auto-update — hand-port + rebuild. Re-run the audit to refresh the manifest.
- The mirror pins react@19 / typescript@6 / esbuild@0.28 (installed fresh, not lockfile-pinned).
- Grades live in gitignored `.cache/`; durable verified-state is the uploaded `_ds_sync.json`.
- Screen datasets (reference pages) are ported from `OpenDesignReferenceCatalog`
  (OpenDesignReferencePages.swift:245+) — representative, not every row verbatim.

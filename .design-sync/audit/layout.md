# Layout Audit — Agentic30 macOS → "Founder OS Kit" (React)

Exhaustive audit of layout metrics in `agentic30/*.swift`. Source-of-truth token file for radius/motion/shadow/ink is `agentic30/OpenDesignTokens.swift` (the StyleSeed lock). Spacing/padding/pane-width scales are NOT centralized in one enum — they live inline plus a handful of per-screen `*Layout*` / `*Metrics*` structs. This document consolidates all of it.

Unit convention: all values are SwiftUI points (pt) ≈ CSS px at 1x. Percentages of AppKit unified titlebar are noted where relevant.

---

## 0. Where the metrics live (per-screen layout structs)

| Struct / enum | File:line | Role |
|---|---|---|
| `OpenDesignRadius`, `OpenDesignType`, `OpenDesignMotion`, `OpenDesignShadow`, `OpenDesignInk` | OpenDesignTokens.swift:9–98 | StyleSeed token layer (radius scale, type scale, motion, shadow, ink) |
| `OpenDesignDayLayoutMetrics` | OpenDesignDayPageView.swift:4421 | **Main 3-pane shell** (rail + task sidebar + main + meta) — responsive |
| `OpenDesignAccessibilityMetrics` | OpenDesignDayPageView.swift:4415 | Border line width by contrast (1 / 1.5) |
| `OfficeHoursScreenLayout` | ContentView.swift:2154 | Office-hours 3-pane shell — responsive |
| `IntakeV2Layout` | IntakeV2FlowView.swift:118 | Onboarding intake flow (centered single column) |
| `OpenDesignStrategyMatrixChromeLayoutPolicy` | OpenDesignDayPageView.swift:2620 | 2×2 competitive matrix board geometry (proportional/clamped) |
| `OpenDesignStrategyMatrixLayoutPolicy` | OpenDesignDayPageView.swift:2721 | Competitor node frame (230×82) + edge placement |
| `StrategyCanvasBlockLayout` | OpenDesignDayPageView.swift:14255 | Business-model canvas block min-heights (300/610/230) |
| `BootIntroCardMetrics` | IntakeV2ShowcaseViews.swift:378 | Intake boot-intro card row heights |
| `TerminalMetrics` | IntakeV2ShowcaseViews.swift:2499 | Fake terminal window box geometry |
| `ReadyTodoMetrics` | IntakeV2ShowcaseViews.swift:2723 | Generated-todo list window geometry |
| `OpenDesignQuestionOptionGridLayout` (+ `…GridMetrics`) | OpenDesignDayPageView.swift:18535 | Interview option grid (1↔2 col at 620) |
| `OpenDesignFlowLayout` | OpenDesignDayPageView.swift:16869 | Wrapping tag/chip flow layout |
| `FlowLayout` | OpenDesignReferencePages.swift:11207 | Wrapping flow (reference pages) |
| `OfficeHoursInlineFlowLayout` (+ `…AfterSpacingKey`) | ContentView.swift:1322 | Inline wrapping flow for transcript token rows |

---

## 1. Window sizes & window chrome

### Main workspace window (`Window("Agentic30", id:"workspace")`, agentic30App.swift:39–59)
- `defaultSize`: **1360 × 820**
- `frame(minWidth: 900, minHeight: 720)` — hard minimum content size
- `windowResizability(.contentMinSize)`
- First-install launch **maximizes to `screen.visibleFrame`** (`WorkspaceWindowChrome.maximizeToVisibleFrame`, ContentView.swift:15566)
- UI-testing window size override accepts `WxH` only if `w ≥ 900 && h ≥ 720` (ContentView.swift:15584)
- UI-testing fixture NSWindow: **1360 × 820** at origin (120,120) (agentic30App.swift:804)

### Window chrome (custom titlebar — critical for React rebuild)
`WorkspaceWindowChrome.configureWindow` (ContentView.swift:15515–15548):
- `titleVisibility = .hidden`
- `titlebarAppearsTransparent = true`
- `toolbarStyle = .unifiedCompact`
- styleMask += `.titled, .fullSizeContentView, .closable, .miniaturizable, .resizable`
- `isMovableByWindowBackground = true`
- **No native titlebar height reserved** — content draws under the titlebar (`.fullSizeContentView`). The app renders its **own 36pt top bar** (see §5). React equivalent: a full-bleed app frame with a custom 36px header; only the traffic-light macOS buttons (~52px left inset) overlap.

### Settings window (SettingsView.swift:343)
- Fixed **1080 × 720** when opened as a standalone window (`settingsWindowContent`)
- Also embeddable full-bleed inside the workspace (`workspaceSettingsPage`)

### Onboarding modal cards (MacOnboardingView / MacOnboardingContextView)
- Fixed card **716 × 676**, corner radius **34** (MacOnboardingView.swift:79–82, MacOnboardingContextView.swift:57–60)

### Menu-bar status menu content
- Update-status panel / status popover content width **340** (ContentView.swift:2652), radius 8
- Menu-bar fixture NSWindow: **260 × (200 | 330)** (agentic30App.swift:293)

### Misc floating panels
- Rail locked-feature tooltip / hover tooltip: height **24**, radius 6 (OpenDesignDayPageView.swift:15113)
- Day-page floating card `frame(width: 336)` (OpenDesignDayPageView.swift:14619)
- Settings detail field `minWidth 260 / idealWidth 360 / maxWidth 420` (SettingsView.swift:2288)

---

## 2. Per-screen pane widths + responsive breakpoints

### 2A. Main Day / Workspace shell — `OpenDesignDayLayoutMetrics(width:isMetaPanelExpanded:)`
OpenDesignDayPageView.swift:4421–4466. Four breakpoint tiers keyed on total window width:

| Window width | rail | task sidebar | meta panel | main H-padding | sidebar? | meta supported? | grid cols |
|---|---|---|---|---|---|---|---|
| `≤ 860` | **48** | 0 | 0 | **24** | no | no | 2 |
| `861–1100` | **48** | **200** | 0 | 24 | yes | no | 2 |
| `1101–1280` | **48** | **220** | **252** | 24 | yes | yes | 4 |
| `> 1280` | **52** | **240** | **280** | **28** | yes | yes | 4 |

- `showsMetaPanel = supportsMetaPanel && isMetaPanelExpanded` (user can collapse the right panel).
- `openDesignGridColumnCount` = 4 when meta shown, else 2 (OpenDesignDayPageView.swift:4463).
- Rail rendered at `frame(width: layout.railWidth)`; task sidebar `frame(width: taskSidebarWidth)`; meta `frame(width: metaPanelWidth)`; main content = flexible remainder (`frame(maxWidth: .infinity)`). See OpenDesignDayPageView.swift:6500–6778.
- Panes separated by **1pt** trailing/leading `Rectangle` borders (`borderSoft`).
- Main content column caps at **maxWidth: 1180** (list/dashboard) or **820** (prose) with `mainHorizontalPadding` applied (OpenDesignDayPageView.swift:8222, 16162, 17260).

### 2B. Office Hours shell — `OfficeHoursScreenLayout(width:isMetaPanelExpanded:)`
ContentView.swift:2154–2168. Simpler two-breakpoint model (fixed pane widths, gated by visibility):

| Property | Value / rule |
|---|---|
| `showsSessions` | `width > 900` |
| `showsMeta` | `width > 1180 && isMetaPanelExpanded` |
| `sessionsWidth` (left) | **240** (fixed) |
| `metaWidth` (right) | **280** (fixed) |
| `mainPadding` | `width > 640 ? 28 : 16` |
| transcript content column | `maxWidth: 820` (list) / `668` intermediate blocks |

### 2C. Settings shell — `settingsDesignShell` (SettingsView.swift:352–382)
Inline breakpoints (not a struct):

| Property | Value / rule |
|---|---|
| `showsNavigation` (left sidebar) | `width ≥ 740` |
| `showsMeta` (right panel) | `width ≥ 1040` |
| sidebar width | **240** |
| meta panel width | **280** |
| sidebar section header | height **42** |
| sidebar row | height **34** |

### 2D. Morning Briefing (page + drilldown) — MorningBriefingPageView.swift:316, MorningBriefingDrilldownView.swift:28
Identical breakpoints in both:

| Property | Value / rule |
|---|---|
| `showsNav` (left) | `width ≥ 900` |
| `showsMeta` (right) | `width ≥ 1120` |
| left nav width | **240** |
| right meta width | **280** |
| header bar | height **40** |

### 2E. Intake V2 onboarding flow — `IntakeV2Layout` (IntakeV2FlowView.swift:118–125)
Single centered column (no persistent side rails). Constants:

| Token | Value |
|---|---|
| `contentMaxWidth` | **1080** |
| `horizontalPadding` (wide) | **56** |
| `narrowHorizontalPadding` | **28** |
| `stepTopPadding` | **56** |
| `progressReservedHeight` | **14** |
| `footerBottomPadding` | **36** |
| narrow breakpoint | `width < 900` → uses `narrowHorizontalPadding` (IntakeV2FlowView.swift:445, 551) |
| footer top padding | 12, footer/content bottom padding 18 |

### Consolidated pane-width map (for the React design tokens)

| Semantic pane | Widths seen (px) | Notes |
|---|---|---|
| **Nav rail** (icon rail) | 48 (compact) / 52 (wide) | Day shell only; other shells have no icon rail |
| **Left sidebar** (task / sessions / nav) | 200 → 220 → 240 | Day shell ramps 200/220/240; Office Hours, Settings, Briefing all fixed **240** |
| **Right meta panel** | 252 → 280 | Day shell 252→280; everyone else fixed **280** |
| **Main content max** | 1180 (dense) / 1080 (intake) / 820 / 668 (prose) | flexible remainder, capped |

### Responsive breakpoint set (all screens, deduped)
`620` (option grid 1→2 col), `640` (OH main padding), `740` (settings nav), `860` (day rail-only), `900` (OH sessions / intake narrow / briefing nav), `1040` (settings meta), `1100` (day meta unsupported ceiling), `1120` (briefing meta), `1180` (OH meta), `1280` (day wide tier). Design as CSS breakpoints; the two "systems" are Day-shell (860/1100/1280) vs the rest (740–1180 range).

---

## 3. Radius scale

**Canonical token layer** — `OpenDesignRadius` (OpenDesignTokens.swift:9–14):

| Token | Value | Use |
|---|---|---|
| `chip` | **8** | badges, tags, small pills, status containers |
| `control` | **10** | buttons, list rows, inputs |
| `card` | **14** | cards, panels, sheets |
| `pill` | **999** | fully-round toggles / segmented controls |

Comment in source: "One radius personality. Stray values (2,3,4,5,6,7,9,11,12,13,16,…) snap to the nearest step." — i.e. StyleSeed intends **8 / 10 / 14 / 999** as the enforced scale; everything else is legacy drift to be normalized in the React kit.

**Observed corner-radius frequency (all `.cornerRadius:` + `RoundedRectangle(cornerRadius:)`, both grep passes agree):**

| Radius | count (approx, cornerRadius:) | verdict |
|---|---|---|
| 8 | 168 | ✅ chip token |
| 12 | 97 | ↦ snap to 14 (card) — heavy legacy |
| 10 | 93 | ✅ control token |
| 14 | 71 | ✅ card token |
| 6 | 52 | legacy (small chip/tooltip) |
| 2 | 37 | legacy (active-indicator bars, hairline) |
| 7 | 36 | legacy → snap to 8 |
| 9 | 27 | legacy → snap to 8/10 |
| 4 | 22 | legacy |
| 16 | 22 | legacy → snap to 14 |
| 3 | 15; 11 | 14; 13 | 13; 18 | 8; 5 | 4; 34 | 6; 30 | 5; 99 | 4; 28 | 3; 26 | 2; 22 | 2; 15 | 1; 1 | 1 | legacy / special |

Special radii to reproduce faithfully (intentional, not drift):
- **34** — onboarding modal cards (716×676) and their inner cutouts (MacOnboardingView, MacOnboardingContextView)
- **30 / 28 / 26** — onboarding inner illustration frames
- **18** — Day1 situation summary card + onboarding inner tiles
- **99 / 999** — full pills / capsules (`Capsule()` is used directly in many places too: pagination current-marker 24×6, dots 6×6)
- **2** — active-tab / active-rail indicator bars (`RoundedRectangle(cornerRadius: 2)` 2×20, height-2 underlines)

React token recommendation: `--r-chip:8; --r-control:10; --r-card:14; --r-pill:9999; --r-modal:34; --r-bar:2`. Map the legacy 6/7/9/11/12/13/16 onto the nearest of these when rebuilding.

---

## 4. Spacing & padding scales

### Stack `spacing:` frequency (VStack/HStack/LazyV…)
`8` (346), `10` (215), `6` (199), `12` (163), `0` (158), `14` (89), `2` (84), `4` (81), `5` (75), `3` (54), `7` (49), `9` (43), `16` (21), `18` (19), `1` (17), `11` (14), `24` (5), `22` (5), `13` (2), `54` (1).

Dominant spacing rhythm: **8, 10, 6, 12, 14** (plus 0 for flush). Fine spacers **2 / 4 / 5**. Section gaps **16 / 18 / 22 / 24**.

### Uniform `.padding(N)` frequency
`16` (50), `12` (34), `10` (30), `14` (29), `18` (13), `28` (7), `24` (7), `13` (7), `8` (6), `20` (5), `3` (5), `6` (4), `7` (2), `22` (1), `5` (1), `2` (1), `1` (1).

### Directional padding (top hits)
- `.padding(.horizontal, …)`: **12** (89), **10** (79), **14** (68), **8** (60), 6 (36), 7 (30), 16 (30), 28 (26), 4 (23), 20 (19), 18 (19), 11 (16), 9 (15), 5 (15), 13 (9)
- `.padding(.vertical, …)`: **12** (38), **8** (34), 9 (25), 1 (24), 10 (23), 4 (17), 14 (17), 2 (14), 11 (14), 18 (13), 7 (11), 13 (11), 16 (9), 6 (8)
- `.padding(.top/.bottom, …)`: top 2 (33), top 1 (25), bottom 8 (23), bottom 14 (21), top 12 (18), bottom 6 (18)

### Consolidated spacing scale (recommended React tokens)
| Token | px | primary use |
|---|---|---|
| `space-0` | 0 | flush stacks |
| `space-1` | 2 | hairline gaps, active-bar height |
| `space-2` | 4 | tight inline |
| `space-3` | 6 | badge/tag internal, dot gaps |
| `space-4` | 8 | **default row/stack spacing**, chip padding |
| `space-5` | 10 | control internal padding |
| `space-6` | 12 | **default card/section spacing + H-padding** |
| `space-7` | 14 | card internal padding, section spacing |
| `space-8` | 16 | card padding, block gaps |
| `space-9` | 18 | large card padding |
| `space-10` | 20 | wide gutters |
| `space-11` | 24 | main content H-padding (compact shell) |
| `space-12` | 28 | main content H-padding (wide shell), section splits |
| `space-14` | 36 | intake footer bottom |
| `space-16` | 56 | intake wide H-padding + step top |

Rail internal: `.padding(.vertical, 10)` around the icon column (OpenDesignDayPageView.swift:14950), inter-item spacing 2 (14925).

---

## 5. Bars, headers, dividers, heights

### Custom top bar (the app's own titlebar, drawn under transparent AppKit titlebar)
- **Height 36** across all Day/Market/OfficeHours variants (OpenDesignDayPageView.swift:6857, 6934, 7015, 7054, 7092, 7132), with a **1pt bottom border** (`borderSoft`) and `.padding(.trailing, 12)` on toolbar buttons. Tagged `.openDesignWindowTitlebarAccessibility()`.
- Toolbar buttons cluster spacing 4 (OpenDesignDayPageView.swift:6830).
- Other header bars: Settings/Briefing header **40**; sub-headers **50 / 70 / 76 / 82 / 32 / 28 / 22** for various section/row bands.

### Divider / border widths
- `lineWidth: 1` (383 occurrences) — default border everywhere
- `lineWidth: 1.5` (16) — increased-contrast borders (`OpenDesignAccessibilityMetrics.borderLineWidth`), lock-badge stroke
- `lineWidth: 2` (12) — emphasis / active
- Other: 1.2, 1.4 (3), 1.7, 1.8, 2.4, 3 (2), 6 (2), 0.5
- Pane dividers are **1pt `Rectangle` overlays** at `.trailing` / `.leading` / `.bottom` (not `Divider()`), colored `borderSoft`.
- Contrast rule: `OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast:) → 1.5 : 1` (OpenDesignDayPageView.swift:4416).

### Rail internals (OpenDesignRailView / OpenDesignRailButton, OpenDesignDayPageView.swift:14908–15087)
- Rail icon button hit-box **36 × 36**, icon glyph `system(size: 15, weight:.medium)`, radius 8 hover fill.
- Rail gutter (indent) = `max(0, (railWidth − 36) / 2)` → 6 at rail 48, 8 at rail 52.
- Active indicator bar: **2 × 20**, radius 2, offset by `−railGutter`.
- Badge dot **6 × 6** with 2pt bg stroke; lock badge **13 × 13**.
- "Z" identity avatar bottom: **30 × 30** circle, monospaced 11.
- Rail item vertical spacing 2; column vertical padding 10.

### Progress / pagination (IntakeV2DashPagination, IntakeV2FlowView.swift:129–197)
- Completed dot **6 × 6**; current marker capsule **24 × 6**; markers spacing 6, group spacing 10.
- Progress reserved height 14.

---

## 6. Type scale (paired with layout; from `OpenDesignType`, OpenDesignTokens.swift:18–49)

| Role | size (pt) | weight |
|---|---|---|
| hero | 46 | semibold |
| kpi | 34 | semibold |
| sectionTitle | 17 | semibold |
| listName | 14 | semibold |
| listAmount | 16 | bold |
| body | 13 | regular |
| label | 11 | medium |
| caption | 11 | regular |
| trend | 12 | medium |

`OpenDesignType.font(role, rounded:)` → `.system(size:weight:design: rounded ? .rounded : .default)`. Intake headers override: title `34 bold rounded`, subtitle `18 medium rounded` (IntakeV2FlowView.swift:217–222). Numbers pair with unit labels at ~2:1; labels uppercase + tracked at call site. Common inline sizes observed: 10.5, 11, 12, 13, 14, 15, 16, 17, 18, 34, 46.

---

## 7. Motion & shadow (layout-adjacent, from tokens)

### `OpenDesignMotion` (OpenDesignTokens.swift:53–65)
- durations: fast **0.12**, normal **0.18**, slow **0.30**
- easing curve: `timingCurve(0.2, 0, 0, 1)` ("Snap" — crisp, no bounce)
- honors `reduceMotion` (duration → 0)
- Other observed: rail hover ease-out 0.08; staged reveal ease-out 0.18; intake column crossfade 0.72 / icon 0.46 / execute pulse 0.92.

### `OpenDesignShadow` (OpenDesignTokens.swift:69–81) — light-theme only; dark theme → hairline border, no glow
- card: color `black 0.05` (white theme) / clear (dark), radius **3**, y **1**
- elevated: color `black 0.08` / clear, radius **12**, y **4**
- Rule enforced: never a foreground/accent-tinted shadow (renders as white glow on dark).
- Ad-hoc heavier shadow on floating panels: `black 0.18, radius 18, y 8` (status panel, ContentView.swift:2656).

### `OpenDesignInk` (OpenDesignTokens.swift:85–88)
- `onLightStrong` = #2A2A2A (0.165,0.165,0.165) — darkest text, never pure #000
- `onLightMuted` = #2A2A2A @ 42% opacity

---

## 8. Embedded "device"/window mock geometries (showcase fakes — reproduce as-is if porting intake showcase)

- **BootIntroCardMetrics** (IntakeV2ShowcaseViews.swift:378): titleRowHeight 40, descriptionHeight 34, visualTopGap 12.
- **TerminalMetrics** (IntakeV2ShowcaseViews.swift:2499): H-pad 22, V-pad 18, headerHeight 22, headerBottomSpacing 14, lineStackSpacing 6, rowHeight 22, promptWidth 16, statusMinWidth 280, statusMaxWidth 420, columnSpacing 8, radius 8, maxVisibleLines 6 → `boxHeight = 18*2 + 22 + 14 + 22*6 + 6*5 = 234`.
- **ReadyTodoMetrics** (IntakeV2ShowcaseViews.swift:2723): slotCount 3, rowHeight 68, rowSpacing 8 → `bodyHeight = 14 + 2 + 68*3 + 8*3 = 244`. Window traffic-light dots 9×9.
- **StrategyCanvasBlockLayout** (OpenDesignDayPageView.swift:14255): minHeight stacked 300 / tall·hero 610 / wide 230.

## 9. Strategy matrix (2×2 competitive board) — proportional geometry

`OpenDesignStrategyMatrixChromeLayoutPolicy.layout(boardSize:)` (OpenDesignDayPageView.swift:2620–2718) — all clamped-to-proportional:
- axisLabelHeight 18, quadrantLabelHeight 42
- sidePadding `clamp(w*0.012, 12, 20)`; topBand `clamp(h*0.12, 44, 58)`; bottomBand `clamp(h*0.11, 42, 54)`
- horizontal axis label width `clamp(w*0.24, 206, 290)`; top axis `clamp(w*0.32, 250, 320)`; bottom axis `clamp(w*0.24, 200, 240)`
- plot horizontal inset `min(max(candidate,112), max(112, w*0.30))`
- quadrant label width `max(96, min(210, (plotW − insets − 18)/2))`
- competitor node frame **230 × 82**, edgeThreshold 0.12 (`OpenDesignStrategyMatrixLayoutPolicy`, :2721).

---

## 10. Key call-site anchors (for the React rebuild)

- 3-pane day shell assembly: OpenDesignDayPageView.swift:6500–6782 (rail → sidebar → main → meta HStack spacing 0).
- Office-hours shell assembly: ContentView.swift:3289–3340.
- Settings shell: SettingsView.swift:352–382.
- Custom 36pt top bar: OpenDesignDayPageView.swift:6810–6861.
- Window chrome (transparent titlebar): ContentView.swift:15465–15606.
- Intake flow shell: IntakeV2FlowView.swift:443–471.

**Rebuild guidance:** two shell archetypes → (A) **Day shell** = icon-rail(48/52) + ramping sidebar(200/220/240) + flexible main(max 1180) + meta(252/280), breakpoints 860/1100/1280; (B) **Standard shell** (Office Hours / Settings / Briefing) = no icon rail, fixed sidebar 240 + flexible main(max 820) + fixed meta 280, breakpoints in 740–1180 band. Intake = centered single column max 1080, no rails. All chrome custom (36px app header, 1px `borderSoft` dividers, radius 8/10/14 tokens, spacing 8/12 rhythm).

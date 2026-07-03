# Icon / Glyph Audit — Agentic30 macOS → "Founder OS Kit" (React)

**Scope:** All `agentic30/*.swift` sources (34 files). Audited for SF Symbol usage via `Image(systemName:)`, `Label(..., systemImage:)`, and `.init(..., systemImage:)` struct-literal fields.

**Bottom line:** The app leans **heavily** on SF Symbols — **176 distinct symbol names** across **~590 raw `systemName`/`systemImage` occurrences** (288 `systemName:`, 323 `systemImage:` — of which ~42 are `var systemImage: String` type declarations, not renders). SF Symbols are **not available on the web**, so the mirror needs a full inline-SVG icon set. This is the single largest visual dependency in the codebase; getting it right is load-bearing for a faithful rebuild.

---

## 1. Raw counts

| Metric | Count |
|---|---|
| Distinct SF Symbol names | **176** |
| `systemName:` occurrences | 288 |
| `systemImage:` occurrences | 323 (incl. ~42 `var systemImage: String` type decls) |
| `Image(systemName: "literal")` render sites | 171 |
| `Image(systemName: <dynamic>)` render sites (var / ternary / helper call) | 265 |
| `Label(..., systemImage: "literal")` sites | 246 |

### Per-file icon density (files with the most literal icon sites)

| File | Literal icon sites |
|---|---|
| `OpenDesignDayPageView.swift` | 151 |
| `OpenDesignReferencePages.swift` | 83 |
| `ContentView.swift` | 76 |
| `IntakeV2Store.swift` | 47 |
| `SettingsView.swift` | 26 |
| `MorningBriefingPageView.swift` | 17 |
| `IntakeV2ShowcaseViews.swift` | 13 |
| `MorningBriefingDrilldownView.swift` | 7 |
| `MacOnboardingContextView.swift` | 6 |
| `IntakeV2StepViews.swift` | 3 |

`OpenDesignDayPageView.swift` (the main workspace/day surface) alone owns ~40% of all icon sites.

---

## 2. Dynamic / computed symbols (the mirror must handle these, not just literals)

A large fraction of icons are **not literal strings** — they come from ternaries, struct fields (`row.systemImage`, `item.systemImage`, `feature.systemImage`, `source.systemImage`, `section.systemImage`, `group.systemImage`, `path.systemImage`), or helper functions. The web icon API must therefore be a **name→component registry** keyed by string, not hardcoded JSX, so these same string values resolve at runtime. Key dynamic patterns:

- **Toggle/expander state:** `isExpanded ? "chevron.down" : "chevron.right"`, `isCollapsed ? "chevron.down" : "chevron.up"`, `showBootLogDetails ? "chevron.down.circle.fill" : "chevron.right.circle.fill"`
- **Status/verdict:** `mode.ready ? "checkmark.circle" : "xmark.circle"`, `isDone ? "checkmark.circle.fill" : isActive ? "record.circle" : "circle"`, `isComplete ? "checkmark.circle.fill" : (isActive ? "circle.dotted" : "circle")`, `tone == .amber ? "exclamationmark.triangle" : "checkmark.circle"`
- **Lock gate:** `gate.satisfied ? "lock.open.fill" : "lock.fill"`, `item.isLocked ? "lock" : item.systemImage`
- **Refresh/loading:** `isRefreshing ? "arrow.clockwise" : "exclamationmark.triangle"`, `snapshot.isRefreshing ? "arrow.triangle.2.circlepath" : "arrow.clockwise"`, `frameImageLoadingID == frame.id ? "arrow.clockwise" : "photo"`
- **Saved/read:** `isSaved ? "bookmark.fill" : "bookmark"`, `isRead ? "envelope.open" : "envelope.badge"`
- **Live/active:** `isActive ? "dot.radiowaves.left.and.right" : "terminal"`
- **Helper functions returning symbols:** `sourceLogoSymbol(id)` (MorningBriefingPageView.swift:1340), `openDesignLoadingIconSymbol(id)` (OpenDesignDayPageView.swift:13774), `listRowIcon(kind)` (MorningBriefingDrilldownView.swift:952), `icon(for: step)` (OpenDesignReferencePages.swift:3919), `icon(kind)` (OpenDesignReferencePages.swift:8443), `officeHoursPastDayVerdictGlyph(status)` (ContentView.swift:5311), plus `var systemImage`/`var glyph` computed props on enums/structs (SettingsView.swift:46, ContentView.swift:220, IntakeV2ShowcaseViews.swift:83, OpenDesignDayPageView.swift:2365 & 8906, OpenDesignReferencePages.swift:5726).

**Implication:** Build `<Icon name="chevron.right" />` where `name` accepts the exact SF Symbol string. Keep the SF Symbol names as the canonical keys so the port stays a 1:1 mechanical mapping and dynamic call sites need no rewriting.

---

## 3. STRUCTURAL vs DECORATIVE classification

**STRUCTURAL** = conveys meaning the user must decode (navigation, state, status, affordance, action). Needs a real web equivalent (SVG) with a stable, recognizable shape and, where it carries meaning alone, an `aria-label`.
**DECORATIVE** = ornamental / reinforces adjacent text label; can degrade to a generic glyph or be dropped without loss of meaning (`aria-hidden`). Note: in this app almost everything is at least semi-structural because icons frequently appear **without** a text label (rail items, status dots, toggle chevrons). Very few are purely decorative.

### 3a. STRUCTURAL — navigation & disclosure (must be pixel-faithful)
| Symbol | Meaning | Representative site |
|---|---|---|
| `chevron.right` | disclosure / drill-in / "next" | Day1SituationSummaryCard.swift:273 |
| `chevron.down` | expanded disclosure | SettingsView.swift:2351 |
| `chevron.left` | back / previous | OpenDesignDayPageView.swift:17947 |
| `chevron.up` | collapse | (ternary, OpenDesignReferencePages) |
| `chevron.down.circle.fill` / `chevron.right.circle.fill` | boot-log expander state | ternary in OpenDesignDayPageView |
| `sidebar.left` | show/hide left sidebar | SettingsView.swift:575 |
| `sidebar.right` | show/hide right sidebar | OpenDesignDayPageView.swift:6848 |
| `line.3.horizontal` | menu / hamburger | ContentView.swift |
| `arrow.right` / `arrow.left` | forward/back navigation | ContentView.swift:4314 |
| `arrow.up.right` / `arrow.up.right.square` / `arrow.up.right.circle.fill` | open external / new window | (various) |
| `arrow.forward.circle` / `arrow.right.circle` / `arrow.right.circle.fill` | proceed / submit CTA | (various) |
| `arrow.uturn.left` / `arrow.uturn.forward` / `arrow.uturn.forward.circle` | undo / redo / go back to live | (ternary) |
| `arrow.turn.down.left` / `arrow.turn.down.right` | reply / branch continuation | (various) |
| `ellipsis` | more / overflow menu | (various) |

### 3b. STRUCTURAL — status, verdict & state (semantic color usually attached)
| Symbol | Meaning | Representative site |
|---|---|---|
| `checkmark` | done / confirm | MorningBriefingDrilldownView.swift:1298 |
| `checkmark.circle` / `checkmark.circle.fill` | success / completed step | ContentView.swift:6072 |
| `checkmark.rectangle` | frame captured OK | (ternary) |
| `checkmark.seal` / `checkmark.seal.fill` | verified / notarized OK | (ternary, permission actor) |
| `xmark` | close / dismiss | ContentView.swift:2643 |
| `xmark.circle` | reject / abandon ("포기") | ContentView.swift:4210 |
| `xmark.seal` | verification failed | (various) |
| `xmark.octagon.fill` | error/blocked | ContentView.swift:220 (helper) |
| `exclamationmark.triangle` / `.fill` | warning | IntakeV2Store.swift:221 |
| `exclamationmark.circle` | caution / stale | OpenDesignReferencePages.swift:8443 |
| `exclamationmark.octagon.fill` | hard error / immediate | (ternary) |
| `info.circle` | info / neutral note | (ternary, tone) |
| `questionmark.circle.fill` / `questionmark.bubble` | help / unknown | (various) |
| `circle` | empty / not-started step | (ternary) |
| `circle.fill` | filled dot / selected | (various) |
| `circle.dotted` / `circle.dashed` | in-progress / pending | (ternary) |
| `circle.lefthalf.filled` | partial state | OpenDesignReferencePages.swift:5726 |
| `largecircle.fill.circle` | radio selected | (ternary, isSel) |
| `record.circle` / `record.circle.fill` | recording / active capture | OpenDesignDayPageView.swift:8906 |
| `dot.radiowaves.left.and.right` | live / broadcasting | (ternary, isActive) |
| `antenna.radiowaves.left.and.right` | connection / signal | (various) |
| `hourglass` / `timer` / `clock` / `clock.arrow.circlepath` | waiting / time / history / replay | ContentView.swift:15840 |
| `bell.badge` | notification pending | (ternary) |

### 3c. STRUCTURAL — locks / security / auth
| Symbol | Meaning | Representative site |
|---|---|---|
| `lock` / `lock.fill` | locked | ContentView.swift:4226 |
| `lock.open.fill` | unlocked / gate satisfied | (ternary, gate) |
| `key.fill` / `key.slash` | credential present / missing | (various) |
| `hand.raised` / `hand.raised.fill` | stop / permission required | (various) |

### 3d. STRUCTURAL — actions & tools (toolbar / buttons)
| Symbol | Meaning | Representative site |
|---|---|---|
| `arrow.clockwise` | refresh (23× — top symbol) | ContentView.swift:3585 |
| `arrow.triangle.2.circlepath` | sync / refreshing spinner | (ternary) |
| `magnifyingglass` | search (21× — 2nd) | IntakeV2ShowcaseViews.swift:1241 |
| `magnifyingglass.circle.fill` / `text.magnifyingglass` / `doc.text.magnifyingglass` | scoped search variants | (various) |
| `trash` | delete | OpenDesignDayPageView.swift:9461 |
| `plus` / `minus.circle` | add / remove | IntakeV2ShowcaseViews.swift:998 |
| `pencil` | edit | (ternary, showsEditField) |
| `paperclip` | attach evidence | ContentView.swift:4204 |
| `paperplane` / `paperplane.fill` | send / submit | (various) |
| `square.and.arrow.up` | share / export | OpenDesignDayPageView.swift:6840 |
| `square.and.arrow.down` | import / download | (various) |
| `doc.on.doc` | copy | (various) |
| `tray.and.arrow.up` / `tray.and.arrow.down` | export to / import from tray | OpenDesignDayPageView.swift:13774 (helper) |
| `play.fill` / `play.circle` / `play.rectangle.fill` / `play.rectangle.on.rectangle` | run / play / replay | OpenDesignDayPageView.swift (ternary + helper) |
| `pause.fill` / `pause.circle.fill` / `stop.fill` | pause / stop | (various) |
| `forward` | skip / advance | (various) |
| `gearshape` / `folder.badge.gearshape` | settings | OpenDesignDayPageView.swift:424 |
| `slider.horizontal.3` | filters / tuning | (ternary, isEvidenceSetup) |
| `line.3.horizontal.decrease.circle` | filter (7×) | OpenDesignDayPageView.swift:7658 |
| `link` / `link.badge.plus` | link / add link | IntakeV2Store.swift:235 |
| `pin` | pin | (various) |
| `flag` | flag / mark | (various) |
| `bookmark` / `bookmark.fill` | save (toggle) | (ternary, isSaved) |
| `hammer.fill` / `wand.and.sparkles` | build / generate | (various) |
| `camera.fill` / `camera.viewfinder` | capture / screenshot | (various) |
| `folder.badge.plus` | new folder / add workspace | (various) |

### 3e. STRUCTURAL — object/content-type & rail/nav category icons (rail items, source badges, catalog entries)
These are shown **without text in compact contexts** → must be recognizable.
| Symbol | Meaning | Representative site |
|---|---|---|
| `newspaper` | News rail | OpenDesignDayPageView.swift:422 |
| `scope` / `target` | focus / ICP / aim | ContentView.swift:3482 |
| `folder` / `folder.fill` | workspace / folder | IntakeV2StepViews.swift:221 |
| `doc` / `doc.text` / `doc.text.fill` / `doc.plaintext.fill` / `doc.richtext.fill` | document types | OpenDesignDayPageView.swift:1571 |
| `doc.badge.checkmark` | approved doc | (various) |
| `note.text` / `text.quote` / `list.bullet.rectangle` | notes / quote / list | (various) |
| `checklist` / `checklist.checked` | task list | (various) |
| `chart.line.uptrend.xyaxis` / `chart.xyaxis.line` / `chart.bar.xaxis` / `chart.bar.fill` | analytics / metrics | MorningBriefingPageView.swift:1340 (helper) |
| `cart.fill` | payment / revenue (Lemon Squeezy) | IntakeV2Store.swift:232 |
| `wonsign.circle.fill` | KRW payment (Toss) | IntakeV2Store.swift:230 |
| `creditcard.fill` | payment method | (various) |
| `megaphone.fill` | marketing / ads | (various) |
| `bubble.left` / `bubble.left.and.bubble.right` / `.fill` / `text.bubble` / `.fill` / `quote.bubble` / `.fill` | chat / interview / comments | (various) |
| `envelope.fill` / `envelope.open` / `envelope.badge` | mail / read state | (ternary) |
| `crown.fill` | founder / premium | (various) |
| `sunrise` | morning briefing | (various) |
| `calendar` / `calendar.badge.clock` | schedule / day | (various) |
| `globe` | web / public | (various) |
| `terminal` / `terminal.fill` | CLI / logs | (ternary) |
| `curlybraces.square.fill` / `chevron.left.forwardslash.chevron.right` | code / dev | SettingsView.swift:46 (helper) |
| `tablecells` / `tablecells.fill` / `tablecells.badge.ellipsis` | table / sheet | (various) |
| `cylinder.fill` | database | (various) |
| `cloud.fill` | cloud / sync | (various) |
| `archivebox` / `tray` / `tray.full` | archive / inbox | (various) |
| `photo` | image / frame | (ternary) |
| `apple.logo` | Apple sign-in / platform | (various) |
| `person.2` | people / audience | OpenDesignReferencePages.swift:8443 (helper) |
| `waveform` / `waveform.path.ecg` | audio / activity | (various) |
| `at` | mention / handle | (various) |
| `timeline.selection` | timeline | (various) |
| `arrow.triangle.branch` / `arrow.triangle.merge` / `arrow.triangle.pull` | git branch / merge / PR | MorningBriefingDrilldownView.swift:952 (helper) |
| `cursorarrow.click.2` | interaction / click | (various) |
| `arrow.left.arrow.right` | swap / compare | (various) |

### 3f. DECORATIVE (ornamental — safe to simplify or `aria-hidden`)
| Symbol | Note |
|---|---|
| `sparkles` / `sparkle` | AI / magic flourish next to labels (ContentView.swift:13678) — decorative accent |
| `triangle.fill` | small ornamental caret/marker |
| `rectangle.dashed` / `rectangle.on.rectangle` / `rectangle.split.2x1` | layout ornament (some are structural in split-view toggles — treat contextually) |
| `square.grid.2x2.fill` | grid ornament |
| `paintpalette.fill` | design/theme flourish |

> Caveat: `sparkles`/`sparkle` appear on a few **buttons without text** (e.g. `row.kind == .system ? "gearshape" : "sparkles"`), where they're doing structural duty. Keep a real glyph; don't drop.

---

## 4. Recommended web-icon strategy

**Chosen approach: an inline-SVG icon set exposed through a single `<Icon name="…" />` component whose `name` prop is the exact SF Symbol string.**

Rationale:
1. **1:1 mechanical port.** Every Swift site — literal *and* dynamic (`item.systemImage`, ternaries, helper functions) — maps unchanged because the string keys are identical. No call-site rewrites.
2. **Inline SVG (not emoji/unicode).** SF Symbols are line/fill glyphs on a consistent grid; emoji render with OS-specific color and metrics and cannot inherit `currentColor` for the app's semantic tinting (amber warnings, green success, locked/gray). Structural status icons in this app are **always tinted** — emoji would break that. Unicode arrows (→ ✓ ✕) are viable only for the most generic 5–6 shapes and would still be visually inconsistent next to the SVG set. So: **inline SVG for everything structural; no emoji.**
3. **Source the SVGs from an SF-Symbols-alike open set** to preserve the look. Recommended base: **Lucide** (MIT, 1.5px stroke, close visual language to SF Symbols) as the default, with a small hand-authored set for the ~15 SF-specific shapes Lucide lacks (`wonsign.circle.fill`, `checkmark.seal`, `record.circle`, `sidebar.left/right`, `line.3.horizontal.decrease.circle`, `arrow.uturn.forward.circle`, `chevron.left.forwardslash.chevron.right`, `dot.radiowaves.left.and.right`, `apple.logo`, `crown.fill`, `curlybraces.square.fill`, `circle.lefthalf.filled`, `largecircle.fill.circle`, `tablecells.badge.ellipsis`, `folder.badge.gearshape`).
4. **API shape:** `<Icon name="chevron.right" size={16} className="…" aria-label?={…} />`. Default `aria-hidden` when a sibling text label exists; require `aria-label` when the icon stands alone (rail items, status dots, icon-only buttons). Icons inherit `currentColor` so semantic tinting is set by the parent (matches SwiftUI `.foregroundStyle` on the `Image`).
5. **Registry file:** a single `icons.ts` map `{ "chevron.right": ChevronRightGlyph, … }` with a dev-mode fallback (render a visible "▢?" placeholder + console warn) for any unmapped SF Symbol string, so missing glyphs surface loudly instead of silently blanking.
6. **`.fill` vs outline convention:** SF Symbols encode weight in the name suffix (`checkmark.circle` vs `checkmark.circle.fill`). Keep both as distinct registry entries (outline vs solid variant) — the app deliberately switches between them for state (e.g. `bookmark` ↔ `bookmark.fill`, `lock` ↔ `lock.fill`).

---

## 5. Top ~30 symbols the mirror needs FIRST (by frequency + centrality)

Ordered by literal-occurrence frequency; all are STRUCTURAL. Building these 30 covers the overwhelming majority of render sites.

| # | Symbol | Uses | Role |
|---|---|---|---|
| 1 | `arrow.clockwise` | 23 | refresh |
| 2 | `magnifyingglass` | 21 | search |
| 3 | `exclamationmark.triangle.fill` | 19 | warning |
| 4 | `checkmark` | 16 | done/confirm |
| 5 | `clock` | 13 | time/history |
| 6 | `link` | 11 | link |
| 7 | `trash` | 9 | delete |
| 8 | `circle` | 9 | empty step |
| 9 | `checkmark.circle.fill` | 9 | success |
| 10 | `arrow.right` | 9 | next/nav |
| 11 | `newspaper` | 8 | news rail |
| 12 | `xmark.circle` | 7 | reject/close |
| 13 | `lock.fill` | 7 | locked |
| 14 | `lock` | 7 | locked (outline) |
| 15 | `line.3.horizontal.decrease.circle` | 7 | filter |
| 16 | `gearshape` | 7 | settings |
| 17 | `doc.text` | 7 | document |
| 18 | `chevron.right` | 7 | disclosure/next |
| 19 | `scope` | 6 | focus/ICP |
| 20 | `folder` | 6 | workspace |
| 21 | `clock.arrow.circlepath` | 6 | replay/history |
| 22 | `xmark` | 5 | close |
| 23 | `sparkles` | 5 | AI accent (semi-structural) |
| 24 | `plus` | 5 | add |
| 25 | `chevron.down` | 4 | expander |
| 26 | `arrow.triangle.2.circlepath` | 4 | sync/refreshing |
| 27 | `sidebar.left` / `sidebar.right` | 4+4 | panel toggles |
| 28 | `paperclip` | 4 | attach evidence |
| 29 | `chart.line.uptrend.xyaxis` | 4 | analytics |
| 30 | `bubble.left.and.bubble.right` | 4 | chat/interview |

Runner-ups worth batching into the first pass (high semantic load even if lower count): `checkmark.circle`, `circle.fill`, `circle.dotted`, `record.circle`, `arrow.up.right`, `square.and.arrow.up`, `cart.fill`, `wonsign.circle.fill`, `terminal`, `calendar`.

---

## 6. Faithful-rebuild notes / traps

- **Do not collapse `.fill`/outline pairs.** The app toggles between them to signal state; a single glyph loses information (bookmark saved/unsaved, lock/unlock, circle empty/filled/dotted step progression).
- **Semantic tint is external.** Icons never carry their own color in the source — tint comes from `.foregroundStyle(...)` on the parent, keyed to design tokens (amber/warn, green/success, gray/locked). The web `<Icon>` must use `currentColor`; do not bake fill colors into the SVGs.
- **Icon-only affordances need a11y.** Rail items, status dots, toggle chevrons, and icon-only buttons render with no adjacent text — each needs an `aria-label` (or `title`) in the port. In SwiftUI these get accessibility from the enclosing control; on the web it's manual.
- **The registry must accept unknown strings gracefully.** Many symbols arrive via data (`source.systemImage`, catalog `systemImage` fields in `IntakeV2Store.swift`) — a future data change could reference a symbol not yet in the SVG set. Fail loud in dev, degrade to a neutral placeholder in prod.
- **`sourceLogoSymbol` / `openDesignLoadingIconSymbol` / `listRowIcon` are string maps** — port them as plain lookup tables that return registry keys; keep the SF Symbol strings as the return values so no translation layer is needed.

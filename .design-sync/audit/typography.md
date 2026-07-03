# Typography Audit — Agentic30 macOS App → "Founder OS Kit" (React)

Scope: exhaustive audit of all font/type usage in `agentic30/*.swift` (34 Swift files).
Goal: faithful React rebuild. Nothing is assumed — every distinct `(size, weight, design)`
combination below was extracted directly from source via grep.

---

## 0. Headline findings (read first)

1. **No custom font families.** There is **zero** use of `.custom(...)`, `Font(name:)`,
   `NSFont(name:)`, `UIFont(name:)`, or any string family literal (no Pretendard, no
   "SF Pro", no Menlo/Monaco/Inter). The app is **100% SwiftUI system fonts**, selected
   only by the `design:` axis:
   - `design: .default`  → **SF Pro (Text/Display)** — the OS system sans. React equivalent: `-apple-system, "SF Pro Text", system-ui, sans-serif`.
   - `design: .rounded`  → **SF Pro Rounded**. React equivalent: `"SF Pro Rounded", ui-rounded, system-ui, sans-serif`.
   - `design: .monospaced` → **SF Mono**. React equivalent: `"SF Mono", ui-monospace, "SFMono-Regular", Menlo, monospace`.
   > For the React kit, ship SF Pro Rounded and SF Mono webfonts (or `ui-rounded`/`ui-monospace` CSS generics on Apple platforms). SF Pro Text falls back cleanly to `-apple-system`/`system-ui`.

2. **The canonical scale (`OpenDesignType`) exists but is NOT wired.** It is defined in
   `OpenDesignTokens.swift` (StyleSeed lock) yet has **0 call sites** anywhere else in the
   app. All ~2000 type calls are **inline `.system(size:)` literals**. So the "canonical"
   scale is aspirational; the *de facto* scale is the frequency table in §3. The React kit
   should adopt the `OpenDesignType` roles as the named scale AND provide the full inline
   table so existing surfaces map faithfully.

3. **Named SwiftUI text styles are effectively unused** — only 7 total across the whole app
   (`.font(.caption)` ×4, `.font(.subheadline)` ×2, `.font(.headline)` ×1). Everything else is
   an explicit point size. This means type is **fixed-pt, not Dynamic-Type-scaled** — a React
   rebuild can use fixed `px`/`rem` without honoring OS text-size settings (matches the app).

4. **Half-point sizes are load-bearing.** The app deliberately uses `10.5`, `11.5`, `12.5`,
   `13.5`, `9.5`, `12.2`, `13.2`, `10.8`, `11.25`, `10.3`, `9.75`, `11.6`, `11.75`, `11.8`,
   `12.4`, `14.5`, `9.8`, `9.4`, `12.8`, `13.2`. Do **not** round these in React — they encode
   intentional optical tuning (esp. mono at 10.5 vs sans at 11).

---

## 1. Canonical type scale — `OpenDesignType` (StyleSeed lock)

Source: `agentic30/OpenDesignTokens.swift` lines 18–49. This is the *intended* scale.
Every role resolves to `.system(size: role.size, weight: role.weight, design: rounded ? .rounded : .default)`.
Note the API only toggles `.default`↔`.rounded` — **mono is never produced by the token helper**;
all monospace usage is inline (see §4).

| Role          | size (pt) | weight     | notes |
|---------------|-----------|------------|-------|
| `hero`        | 46        | `.semibold`| big display numbers / hero figure |
| `kpi`         | 34        | `.semibold`| KPI metric value |
| `sectionTitle`| 17        | `.semibold`| section headers |
| `listName`    | 14        | `.semibold`| list row primary name |
| `listAmount`  | 16        | `.bold`    | list row amount (heaviest weight) |
| `body`        | 13        | `.regular` | body copy |
| `label`       | 11        | `.medium`  | labels (paired with uppercase + tracking at call site) |
| `caption`     | 11        | `.regular` | captions |
| `trend`       | 12        | `.medium`  | trend indicators |

Companion locks in the same file (for context, not type):
- `OpenDesignRadius`: chip 8 / control 10 / card 14 / pill 999.
- `OpenDesignMotion`: fast 0.12 / normal 0.18 / slow 0.30; snap curve `cubic-bezier(0.2, 0, 0, 1)`.
- `OpenDesignInk`: darkest text is `#2A2A2A` (`rgb 0.165` ×3), never pure black; muted = same @ 0.42 opacity.

StyleSeed intent comments (verbatim from the token file):
- L16–17: "Type scale (StyleSeed table → SwiftUI pt) — **Numbers pair with units at ~2:1; labels are uppercase + tracked at the call site.**"

---

## 2. Design-axis distribution (whole app)

Total `.system(size:)` occurrences: **~2038**. `.font(...)` occurrences: ~2005 (nearly all are `.font(.system(...))`).

| design axis        | occurrences | maps to |
|--------------------|-------------|---------|
| `.default` (sans)  | ~972 (remainder) | SF Pro Text |
| `.monospaced`      | **825**     | SF Mono |
| `.rounded`         | **241**     | SF Pro Rounded |

Weight distribution (across all calls):

| weight      | count |
|-------------|-------|
| `.medium`   | 795   |
| `.semibold` | 618   |
| `.bold`     | 288   |
| `.regular`  | 96    |
| `.heavy`    | 13    |
| `.light`    | 2     |

Takeaway: the app leans **medium/semibold**; regular is rare (body/captions only); heavy/light are edge accents.
CSS weight mapping: regular=400, medium=500, semibold=600, bold=700, heavy=800/900, light=300.

Modifier usage: `.monospacedDigit()` ×6 (tabular figures on counters/numbers). `.textCase(.uppercase)` ×99. `.tracking(...)` ×58 (letter-spacing). `.kerning(...)` ×15.

---

## 3. FULL distinct-font table (every (size, weight, design) combo)

Extracted verbatim; **count** = literal occurrences in source. Sorted by frequency.
`design` blank = `.default` (SF Pro sans). Combos with an expression weight (e.g.
`weight: isToday ? .bold : .medium`) are listed at the bottom as **conditional**.

### 3a. Monospaced (SF Mono) — 825 total; the dominant label/metadata/counter face

| size | weight | count | role (inferred) |
|------|--------|-------|-----------------|
| 10.5 | medium | 155 | **most common font in the app** — mono metadata/label |
| 11 | medium | 132 | mono label |
| 10 | medium | 75 | mono small label |
| 10.5 | semibold | 51 | mono emphasized label |
| 10 | semibold | 49 | mono emphasized small label |
| 10.5 | (regular) | 44 | mono value |
| 10 | (regular) | 31 | mono value |
| 11 | semibold | 22 | mono emphasized label |
| 11 | (regular) | 21 | mono value |
| 11.5 | medium | 20 | mono label |
| 12 | medium | 18 | mono label |
| 12 | semibold | 16 | mono label |
| 11 | bold | 13 | mono strong label |
| 10 | bold | 13 | mono strong small label |
| 9.5 | semibold | 10 | mono micro label |
| 9.5 | medium | 10 | mono micro label |
| 9.5 | bold | 8 | mono micro strong |
| 10.5 | bold | 7 | mono strong label |
| 13 | regular | 6 | mono code/body |
| 13 | medium | 6 | mono label |
| 12.5 | medium | 6 | mono label |
| 18 | semibold | 5 | mono value (larger) |
| 17 | bold | 5 | mono value |
| 14 | medium | 5 | mono label |
| 12 | bold | 5 | mono strong label |
| 10 | regular | 5 | mono value |
| 9.5 | regular | 4 | mono micro value |
| 9.5 | (regular) | 4 | mono micro value |
| 13 | (regular) | 4 | mono value |
| 11.5 | semibold | 4 | mono label |
| 11.5 | bold | 4 | mono strong label |
| 9 | medium | 3 | mono micro |
| 16 | bold | 3 | mono value |
| 15 | semibold | 3 | mono value |
| 14 | bold | 3 | mono strong |
| 13 | bold | 3 | mono strong |
| 12.5 | semibold | 3 | mono label |
| 11 | regular | 3 | mono value |
| 9 | semibold | 2 | mono micro |
| 18 | bold | 2 | mono value |
| 17 | medium | 2 | mono value |
| 13.5 | medium | 2 | mono label |
| 10.8 | regular | 2 | mono value |
| 11.5 | (regular) | 2 | mono value |
| 12 | (regular) | 2 | mono value |
| 9.8 | medium | 1 | mono micro |
| 9.8 | bold | 1 | mono micro strong |
| 9.75 | regular | 1 | mono micro value |
| 9 | bold | 1 | mono micro strong |
| 9 | (regular) | 1 | mono micro value |
| 8 | medium | 1 | mono tiny label |
| 24 | semibold | 1 | mono large value |
| 18 | bold | 1 | (dup family) mono value |
| 17 | semibold | 1 | mono value |
| 16 | (in 3d) | — | see rounded/sans |
| 14 | semibold | 1 | mono label |
| 14 | heavy | 1 | mono heavy value |
| 13 | regular | 1 | mono body |
| 12 | regular | 1 | mono value |
| 11 | heavy | 1 | mono heavy label |
| 10.3 | medium | 1 | mono micro label |

### 3b. Rounded (SF Pro Rounded) — 241 total; the numeric/friendly-accent face

| size | weight | count | role (inferred) |
|------|--------|-------|-----------------|
| 11 | medium | 21 | rounded label/pill |
| 12 | medium | 20 | rounded label |
| 11 | bold | 18 | rounded strong pill / small number |
| 16 | bold | 14 | rounded number |
| 12 | bold | 15 | rounded strong number |
| 13 | bold | 13 | rounded number |
| 10 | medium | 13 | rounded small label |
| 14 | bold | 11 | rounded number |
| 13 | medium | 9 | rounded label |
| 13 | semibold | 8 | rounded number |
| 18 | bold | 6 | rounded large number |
| 15 | bold | 7 | rounded number |
| 10 | bold | 6 | rounded small number |
| 14 | semibold | 5 | rounded number |
| 11 | semibold | 5 | rounded label |
| 10 | semibold | 5 | rounded small label |
| 12 | semibold | 4 | rounded number |
| 11.5 | medium | 4 | rounded label |
| 34 | bold | 3 | **rounded KPI/hero number** |
| 24 | heavy | 3 | **rounded hero number** (heaviest display) |
| 20 | bold | 3 | rounded large number |
| 16 | semibold | 2 | rounded number |
| 18 | semibold | 2 | rounded number |
| 18 | medium | 2 | rounded label |
| 12.5 | medium | 2 | rounded label |
| 12.5 | bold | 2 | rounded number |
| 10.5 | semibold | 2 | rounded small label |
| 28 | bold | 1 | rounded hero number |
| 24 | bold | 1 | rounded large number |
| 23 | bold | 1 | rounded large number |
| 20 | bold | 1 | (dup) |
| 18 | heavy | 1 | rounded hero number |
| 17 | bold | 1 | rounded number |
| 17 | medium | 1 | rounded label |
| 15 | medium | 1 | rounded label |
| 14 | medium | 1 | rounded label |
| 13.5 | medium | 1 | rounded label |
| 13 | heavy | 1 | rounded strong number |
| 12.8 | bold | 1 | rounded number |
| 11.5 | semibold | 1 | rounded label |
| 11.5 | bold | 1 | rounded number |
| 10.5 | medium | 1 | rounded small label |
| 10 | heavy | 1 | rounded strong small number |

### 3c. Default / SF Pro sans — remainder (~972); body, titles, nav, most UI text

| size | weight | count | role (inferred) |
|------|--------|-------|-----------------|
| 12 | medium | 91 | primary UI text |
| 12 | semibold | 90 | primary emphasized UI text / nav |
| 11 | semibold | 45 | small emphasized label |
| 13 | semibold | 44 | body-emphasized / row title |
| 11.5 | medium | 42 | small UI text |
| 12.5 | medium | 36 | UI text |
| 12.5 | semibold | 32 | UI text emphasized |
| 12 | regular | 29 | body |
| 12 | (regular) | 29 | body |
| 14 | semibold | 28 | row/list name (matches `listName` role but semibold@14) |
| 13 | medium | 26 | body-medium |
| 11.5 | semibold | 25 | small emphasized |
| 11 | bold | 21 | small strong label |
| 17 | semibold | 18 | **section title (matches `sectionTitle` role)** |
| 11 | medium | 18 | small label |
| 16 | semibold | 17 | subtitle / large row |
| 15 | semibold | 16 | subtitle |
| 11 | (regular) | 16 | small body |
| 18 | semibold | 15 | title |
| 10 | semibold | 14 | micro label |
| 12.5 | regular | 12 | body |
| 11.5 | (regular) | 11 | small body |
| 10.5 | semibold | 11 | micro label |
| 10.5 | medium | 11 | micro label |
| 12 | bold | 10 | strong label |
| 15 | bold | 9 | title strong |
| 14 | medium | 9 | row name medium |
| 22 | semibold | 8 | large title |
| 11.5 | regular | 8 | small body |
| 11 | regular | 8 | small body |
| 9 | bold | 7 | micro strong |
| 14 | bold | 7 | strong title |
| 13 | regular | 7 | body |
| 13 | bold | 7 | strong body |
| 20 | bold | 6 | large title |
| 13.5 | semibold | 6 | body-emphasized |
| 12.5 | (regular) | 6 | body |
| 10.5 | bold | 6 | micro strong |
| 9.5 | bold | 5 | micro strong |
| 20 | semibold | 5 | large title |
| 17 | medium | 5 | section title medium |
| 15 | medium | 5 | subtitle medium |
| 10 | medium | 5 | micro label |
| 9 | (regular) | 4 | micro body |
| 8 | bold | 4 | tiny strong badge |
| 13 | (regular) | 4 | body |
| 21 | semibold | 3 | large title |
| 14.5 | semibold | 3 | row title |
| 14 | (regular) | 3 | body |
| 13.5 | medium | 3 | body medium |
| 12.2 | medium | 3 | UI text (optically tuned) |
| 10 | (regular) | 3 | micro body |
| 9.8 | semibold | 2 | micro label |
| 30 | medium | 2 | display |
| 28 | semibold | 2 | display |
| 23 | semibold | 2 | large title |
| 16 | medium | 2 | subtitle medium |
| 13.2 | semibold | 2 | body-emphasized (tuned) |
| 12.5 | bold | 2 | strong UI |
| 11.25 | regular | 2 | small body (tuned) |
| 9.5 | semibold | 1 | micro label |
| 9.5 | medium | 1 | micro label |
| 9.4 | semibold | 1 | micro label (tuned) |
| 9 | semibold | 1 | micro label |
| 78 | bold | 1 | **largest — big emoji/figure in onboarding** |
| 46 | bold | 1 | **hero figure (matches `hero` role, bold vs semibold)** |
| 30 | semibold | 1 | display |
| 28 | medium | 1 | display |
| 28 | bold | 1 | display strong |
| 28 | (regular) | 1 | display |
| 26 | medium | 1 | display |
| 24 | semibold | 1 | large title |
| 24 | bold | 1 | large title |
| 23 | heavy | 1 | large title heavy |
| 20 | regular | 1 | large title regular |
| 20 | medium | 1 | large title medium |
| 19 | semibold | 1 | title |
| 18 | medium | 1 | title medium |
| 16 | bold | 1 | subtitle strong |
| 14.5 | bold | 1 | row title strong |
| 13.2 | regular | 1 | body (tuned) |
| 12.5 | light | 1 | body light (rare) |
| 12.4 | regular | 1 | body (tuned) |
| 12.2 | regular | 1 | body (tuned) |
| 11.8 | regular | 1 | small body (tuned) |
| 11.75 | regular | 1 | small body (tuned) |
| 11.6 | regular | 1 | small body (tuned) |
| 11.5 | light | 1 | small body light |
| 10.8 | semibold | 1 | micro label (tuned) |
| 10.5 | (regular) | 1 | micro body |
| 11 | heavy | 1 | small heavy label |
| 10 | heavy | 1 | micro heavy label |
| 12 | heavy → n/a | — | (heavy appears mostly rounded) |
| 7 | bold | 1 | tiny badge |
| 1 | (regular) | 1 | 1pt spacer/hairline text (non-visible) |

### 3d. Conditional / expression weights (dynamic — resolve to two of the above)

These use a ternary for weight (state-driven emphasis). React: swap `font-weight` on state.

- `11.5, weight: tone == .accent ? .semibold : .medium` ×3 — accent vs default emphasis.
- `12.5, weight: baseWeight` ×2 — parameterized.
- `9, weight: isToday ? .bold : .medium, mono` ×1 — today highlight.
- `17, weight: segment.renderStyle == .strong ? .semibold : .medium` ×1.
- `15, weight: isRead ? .regular : .medium` ×1 — unread emphasis.
- `13, weight: step.status == .active ? .medium : .regular` ×1.
- `13, weight: isSel ? .medium : .regular` ×1 — selected emphasis.
- `12.5, weight: event.emphasis == nil ? .regular : .medium` ×1.
- `12, weight: tone == .accent ? .semibold : .medium` ×1.
- `12, weight: title == "전체" ? .semibold : .medium` ×1 — active filter tab.
- `12, weight: style == .today ? .semibold : .regular` ×1.
- `12, weight: row.status == .done ? .medium : .semibold, rounded` ×1 — done vs pending.
- `11.5, weight: isPrimary ? .semibold : .medium` ×1.
- `11.5, weight: action.tone == .accent ? .semibold : .medium` ×1.
- `11.5, weight: step.isCurrent(status) ? ... ` ×1.
- `11, weight: strong ? .semibold : .medium, mono` ×1.

Pattern: **default = medium, emphasized state = semibold** (or regular→medium for
read/active toggles). This is the app's whole "emphasis" grammar — a 1-step weight bump.

---

## 4. Mono / Sans / Rounded usage rules (StyleSeed)

The three faces are used semantically, not decoratively:

### Monospaced (SF Mono) — 825 uses — the app's signature face
Used for **labels, counters, metadata, timestamps, codes, IDs, status tags, section
eyebrows**. Per the memory note and StyleSeed: *"labels/counters/metadata = mono."*
- The single most common font in the entire app is `10.5 medium mono` (155×) — the default metadata/label size.
- `11 medium mono` (132×) and `10 medium mono` (75×) are the next tier.
- **The label recipe** (confirmed at multiple sites) is:
  `.font(.system(size: 10–10.5, weight: .medium/.semibold, design: .monospaced))`
  `+ .textCase(.uppercase) + .tracking(1.0–1.2)`.
  Representative sites:
  - `ContentView.swift:4037` — `10 semibold mono` + `.tracking(1.2)` + `.textCase(.uppercase)`, amber.
  - `ContentView.swift:4849` — `10 semibold mono` + `.tracking(1.1)` + `.textCase(.uppercase)`, mutedDeep.
  - `OpenDesignDayPageView.swift:16397` — `10.5 medium mono` + `.textCase(.uppercase)`, muted.
  - `OpenDesignReferencePages.swift:4889` — `10 semibold mono` + `.tracking(1.2)`, amber.
- Mono also carries **tabular numbers** via `.monospacedDigit()` (×6) so counters don't jitter.
- React: eyebrow/label component = SF Mono, 10–10.5px, weight 500–600, `text-transform: uppercase`, `letter-spacing: ~0.1em` (see §5).

### Rounded (SF Pro Rounded) — 241 uses — the numeric/friendly face
Used for **numbers that pair with units** and friendly pills/counters. Per StyleSeed:
*"numbers pair with units at ~2:1"* — the big number is rounded, the unit sits ~half its size.
- Big display/KPI numbers: `34 bold rounded`, `24 heavy rounded`, `28/23/20/18 bold rounded`.
- Inline number pills: `16/14/13/12/11 bold rounded`, `11/12 medium rounded` for the paired unit.
- The `2:1` pairing: e.g. a `34`-ish value with an `~16` unit, or `24` value with `12` unit.
- React: numeric/metric component = SF Pro Rounded; value uses the larger step, unit uses
  a step ~half the size at a lighter weight (medium vs bold).

### Default (SF Pro sans) — ~972 uses — everything else
Body copy, section titles, row names, nav, buttons, dialog text, most UI chrome.
- Section title: `17 semibold` (matches `sectionTitle` role).
- Body: `12–13 regular/medium`.
- Row/list name: `14 semibold`.
- Titles/headers: `15–22 semibold`, up to `46/78 bold` for onboarding hero figures.
- React: default sans is the fallback for anything not label(mono) or number(rounded).

---

## 5. Tracking / kerning (letter-spacing) rules

`.tracking(...)` = SwiftUI point-based letter-spacing (58 uses). `.kerning(...)` = per-pair
kerning (15 uses; behaves like tracking here). To convert pt→CSS `em`: `em ≈ pt / fontSize`.

### Positive tracking — ALWAYS on uppercase mono labels (the eyebrow recipe)
| tracking (pt) | count | typical size | CSS em (@10–10.5px) |
|---------------|-------|--------------|---------------------|
| 1.2 | 11 | 10–10.5 | ~0.11–0.12em |
| 1.1 | 4 | 10 | ~0.11em |
| 1.0 / 1 | 7+3 | 10–11 | ~0.10em |
| 1.5 | 2 | 10 | ~0.15em (widest) |
| 0.9 | 1 | ~11 | ~0.08em |
| 0.8 | 4 | 11 | ~0.07em |
| 0.6 | 9 | 11–12 | ~0.05em |
| 0.4 | 10 | 12–13 | ~0.03em |

Kerning (same intent, uppercase labels): `1.0` ×7, `1.2` ×2, `1.1` ×2, `0.8` ×2, `0.5` ×2.

**Rule:** the larger the tracking, the smaller/more-uppercase the label. Eyebrows/section
labels (10–10.5px mono uppercase) get **1.0–1.2pt (~0.10–0.12em)**. Larger UI labels get
progressively less (0.4–0.8pt). React: `letter-spacing: 0.1em` for mono uppercase eyebrows;
scale down toward `0.03em` as size grows past 12px.

### Negative tracking — tightening large/body sans (rare, deliberate)
| tracking (pt) | count | context |
|---------------|-------|---------|
| -0.17 | 2 | tightening (e.g. typewriter body / large text) — `ContentView.swift:8172` passes `tracking: -0.17` to `OfficeHoursTypewriterText` |
| -0.14 | 1 | tightening |
| -0.065 | 2 | subtle tightening |

**Rule:** negative tracking (~ -0.14 to -0.17pt ≈ -0.01em) is applied to larger sans body/title
runs to tighten them optically. React: `letter-spacing: -0.01em` on large sans headings/body.

### Tracking is parameterizable
`OfficeHoursTypewriterText` (`ContentView.swift:616–648`) takes a `tracking: CGFloat = 0`
prop and applies it to both the visible and measurement text layers — so tracking is a
first-class, animation-safe parameter on that component, not a static modifier.

---

## 6. Named text styles & `Font.` statics (for completeness)

- Named SwiftUI styles: `.font(.caption)` ×4, `.font(.subheadline)` ×2, `.font(.headline)` ×1. **7 total** — negligible; ignore for the scale, but map: caption→11 regular, subheadline→~13, headline→~15 semibold if faithfulness demands.
- `Font.` static references: 25, but these are `Font.Weight` type annotations (as in the token file's `var weight: Font.Weight`) and `Font.system(...)` — not new families.
- `fontWeight(...)` modifier: 5 uses (applies weight to an already-sized `Text`); folds into the weight column.

---

## 7. React "Founder OS Kit" recommendations

1. **Three font stacks** (no webfont licensing needed on Apple; ship fallbacks elsewhere):
   ```css
   --font-sans:    -apple-system, "SF Pro Text", system-ui, sans-serif;
   --font-rounded: "SF Pro Rounded", ui-rounded, system-ui, sans-serif;
   --font-mono:    "SF Mono", ui-monospace, "SFMono-Regular", Menlo, monospace;
   ```
2. **Named scale = `OpenDesignType` roles** (hero 46/kpi 34/sectionTitle 17/listName 14/
   listAmount 16/body 13/label 11/caption 11/trend 12) as the *primary* tokens, but also
   expose the full inline `px` ladder (7,8,9,9.4,9.5,9.75,9.8,10,10.3,10.5,10.8,11,11.25,
   11.5,11.6,11.75,11.8,12,12.2,12.4,12.5,12.8,13,13.2,13.5,14,14.5,15,16,17,18,19,20,21,
   22,23,24,26,28,30,34,46,78) so migrated surfaces stay pixel-faithful. Keep half-points.
3. **Weight map:** regular 400 / medium 500 / semibold 600 / bold 700 / heavy 800 / light 300.
   Default emphasis grammar = medium→semibold on active/selected/accent state.
4. **Label component (`<Eyebrow>`):** mono, 10–10.5px, weight 500–600, `text-transform:uppercase`,
   `letter-spacing: 0.1em` (1.0–1.2pt). Optionally `font-variant-numeric: tabular-nums`.
5. **Metric component (`<Metric value unit>`):** rounded; value at the big step (weight 700),
   unit at ~half size (weight 500) — the ~2:1 pairing.
6. **Large sans headings:** `letter-spacing: -0.01em` (mirrors the -0.14/-0.17pt tightening).
7. **Fixed sizing, not fluid/Dynamic-Type** — the app pins pt sizes; use fixed `px`/`rem`.

---

## 8. File hot-spots (where type lives)

| file | `.system(size` count |
|------|----------------------|
| OpenDesignDayPageView.swift | 560 |
| OpenDesignReferencePages.swift | 516 |
| ContentView.swift | 483 |
| MorningBriefingPageView.swift | 130 |
| SettingsView.swift | 90 |
| IntakeV2ShowcaseViews.swift | 85 |
| MorningBriefingDrilldownView.swift | 76 |
| IntakeV2DecideNotificationViews.swift | 19 |
| MacOnboardingView.swift | 18 (holds the 78/46/34 hero figures) |
| Day1SituationSummaryCard.swift | 18 |
| MacOnboardingContextView.swift | 17 |
| IntakeV2StepViews.swift | 15 |
| IntakeV2FlowView.swift | 10 |
| OpenDesignTokens.swift | (defs only — the unused canonical scale) |

Canonical scale source: `agentic30/OpenDesignTokens.swift` (`OpenDesignType`, L18–49).

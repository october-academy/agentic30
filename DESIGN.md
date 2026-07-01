# Agentic30 Design System

How Agentic30's UI is designed. This is the handbook; [STYLESEED.md](STYLESEED.md) is the
terse lock (the binding values + the quality-gate checklist). It adapts the **StyleSeed**
rules (`styleseed-demo.vercel.app/llms-full.txt`) to this project, which has two UI
surfaces: the **SwiftUI macOS app** (`agentic30/`) and a few hand-authored **HTML mockups**
(`mockups/`, `competitive-matrix.html`, `docs/specs/*.html`). StyleSeed is written in
Tailwind vocabulary; the *principles* port directly and the mockups take the rules nearly
literally.

Guiding ethos (consistent with [PHILOSOPHY](.agentic30/docs/VALUES.md) — "쉽게 만든다"):
additive and non-breaking, dark-first, calm, macOS-native. Coherence comes from **removing
knobs**, not policing them.

---

## 1. Principles (non-negotiable)

1. **Content lives in cards** — never bare on the page background.
2. **One accent (green); everything else greyscale.** Status hues are semantic, not decoration.
3. **Normal/OK states are grey.** Color marks only the minority that needs attention. Same value → same color. No rainbow lists.
4. **Real empty + loading + error states** on every data surface — not just the happy state.
5. **No pure black** (`#000`). Darkest text ≈ `#2A2A2A` / `OpenDesignInk.onLightStrong`.
6. **No emoji as UI icons.** SF Symbols (app) or inline SVG line icons (mockups), monochrome via `currentColor`.
7. **Semantic tokens only** in consumers — never hardcode hex. Hex lives in the token layer.
8. **Type from the scale**, numbers paired 2:1 with their unit and never wrapped.
9. **Layered, low-opacity, black-based shadows** — never accent/fg-tinted (those glow white on dark).
10. **Snap motion** — crisp, no bounce; honor `prefers-reduced-motion` / `reduceMotion`.
11. **Run the quality gate before showing any UI** (§9).

---

## 2. The lock

| Dimension | Value |
|---|---|
| Key color (accent) | **Green** — `#37D59F` dark / `#008447` light (`OpenDesignDayColor.accent`). Single accent. |
| Radius personality | **Soft** — `8 / 10 / 14 / 999` (chip / control / card / pill). |
| Shadow language | layered, low-opacity, **black-based**; light ≤8%, dark → hairline border. No colored/glow shadows. |
| Motion seed | **Snap** — `timingCurve(0.2, 0, 0, 1)`; fast 0.12 / normal 0.18 / slow 0.30; no bounce. |
| Type | SF Pro / `.rounded` where already used; role scale in §5. |
| Density | comfortable (desktop-adapted from StyleSeed's 430px mobile spacing). |

---

## 3. Color

Never hardcode hex in a view/mockup. Use tokens. Accent is green **only**; `rose / amber /
sky / violet` are **semantic status colors** (severity, or per-source tone) — never a second
decorative accent.

### SwiftUI — `OpenDesignDayColor` (single source of truth)
Theme-aware (white/dark) palette defined in `agentic30/OpenDesignDayPageView.swift` (the
`OpenDesignDayPalette` struct, ~line 4278). Re-exported by `IntakeV2Color`,
`MacOnboardingTheme`, and `Agentic30BrandColor`. Five-level grey hierarchy:

```
fg          strongest text          surface / surface2 / elevated   card backgrounds
fgSecondary labels                  bg / bgDeep / bgDarker          page backgrounds
muted       captions, subtitles     border / borderSoft / borderStrong  hairlines
mutedDeep   faint/disabled
accent / accentStrong   the green   accentDim (≈14% fill) / accentLine (≈40% stroke)
rose / amber / sky / violet / orange   semantic status (+ Dim/Line tints)
```

### HTML mockups — shared `:root` tokens
Every mockup defines the same block:

```css
--page:#15171A; --surface:#1E2228; --surface2:#252A31; --hover:#2B3138;
--border:rgba(255,255,255,.07); --borderSoft:rgba(255,255,255,.05); --borderStrong:rgba(255,255,255,.12);
--fg:#E7E9EC; --fgSecondary:#B9BEC4; --muted:#8B9199; --mutedDeep:#6B7178; --faint:#4F555C;
--accent:#37D59F; --accentDim:rgba(55,213,159,.14); --accentLine:rgba(55,213,159,.40);
--danger:#E2897E; --warning:#E0B564;            /* severity only — never on a normal state */
```

**Status pairing:** done/success → accent (or grey); in-progress/active → accent; needs-attention
→ `danger`/`warning`; **everything normal → grey**. A dot and its label are always the same color.

---

## 4. Radius — `OpenDesignRadius`

One soft personality. Snap any stray value to the nearest step.

```swift
OpenDesignRadius.chip    // 8   badges, tags, small pills, status containers
OpenDesignRadius.control // 10  buttons, list rows, inputs
OpenDesignRadius.card    // 14  cards, panels, sheets
OpenDesignRadius.pill    // 999 fully-round toggles / segmented controls
```

HTML: `--r-chip / --r-control / --r-card / --r-pill`.

---

## 5. Typography — `OpenDesignType`

```swift
OpenDesignType.font(.hero)          // 46 / semibold   display number
OpenDesignType.font(.kpi)           // 34 / semibold
OpenDesignType.font(.sectionTitle)  // 17 / semibold
OpenDesignType.font(.listName)      // 14 / semibold
OpenDesignType.font(.listAmount)    // 16 / bold
OpenDesignType.font(.body)          // 13 / regular
OpenDesignType.font(.label)         // 11 / medium   (uppercase + tracking at the call site)
OpenDesignType.font(.caption)       // 11 / regular
OpenDesignType.font(.trend)         // 12 / medium
// pass rounded: true where a surface already uses .rounded (onboarding, briefing)
```

Rules: numbers pair with their unit ~2:1 and **never wrap** (`whitespace-nowrap` / `.fixedSize`);
labels are uppercase + tracked; weights stay in 400/500/600/700.

---

## 6. Shadows — `OpenDesignShadow`

Layered, low-opacity, **black-based**. A foreground/accent-tinted shadow renders as a
white/colored glow on dark — never do it. Light mode uses a subtle shadow; dark mode leans
on a hairline `borderSoft` instead.

```swift
.openDesignCardShadow()       // subtle card depth (light); ~clear on dark
.openDesignElevatedShadow()   // floating / modal depth
```

Forbidden: colored/glow shadows, heavy blurs (`0 0 22px`, `0 30px 80px`), `#000` text-shadows,
per-card shadow variation. In the mockups, prefer a 1px hairline border over a shadow.

---

## 7. Motion — `OpenDesignMotion` (Snap)

```swift
OpenDesignMotion.snap()                              // timingCurve(0.2,0,0,1), 0.18s
OpenDesignMotion.snap(reduceMotion: rm, OpenDesignMotion.durationFast)  // honors reduceMotion
```

Wired app-wide through the button-press and row-hover modifiers in `OpenDesignDayPageView.swift`.
Forbidden: spring/bounce, scroll-linked (parallax), card zoom, infinite loops (except skeleton
pulse), anything > 300ms for a micro-interaction. `@media (prefers-reduced-motion)` /
`@Environment(\.accessibilityReduceMotion)` jump to the final state.

---

## 8. Icons & states

- **Icons:** SwiftUI → `Image(systemName:)`; HTML → inline `<svg viewBox="0 0 24 24" fill="none"
  stroke="currentColor" stroke-width="1.8" ...>`. Monochrome; inherit color from text. **No emoji.**
- **Empty state:** greyscale icon in a muted circle + a one-line invite + an accent-text CTA
  ("후보 추가"). Blame the system, not the user.
- **Error state:** muted-`danger` icon + what happened + a Retry affordance ("다시 시도").
- **Loading:** skeleton matching the final shape; 300ms delay + 300ms min; only the skeleton may pulse.
- **Copy:** buttons name the action ("결제 요청 보내기", "닫기" — not "확인"/"Submit"). Errors say what
  happened + what to do, no blame, no first person.

---

## 9. Quality gate (run before showing ANY UI)

Score each changed surface; target **≥80/100**; fix and re-check up to 3×.

- **Coherence** — one accent, one radius personality, one shadow language, one icon set.
- **Color = meaning** — normal = grey; color marks the minority; no rainbow; same value = same color.
- **Hierarchy** — one primary per screen; numbers 2:1 with unit; sizes from the scale.
- **Layout** — content in cards; consistent rhythm.
- **States** — real empty + loading + error everywhere.
- **Copy** — buttons name the action; errors help, not blame.
- **Polish** — focus rings; ≥44px targets; reduced-motion; layered (not hard/colored) shadow; no `#000`; no emoji.

**Verify independently — do not trust a self-reported score or a hex grep.** Two real
violations once slipped past both and were caught only by rendering + screenshotting: a
gold+blue **PNG hero asset** (invisible to CSS audit) and a normal state colored amber and
rationalized as "warning." For any visual gate: (a) use a *separate* skeptical auditor, not
the agent that did the work; (b) render headless (chrome-devtools) and eyeball every surface;
(c) hunt for raster/`<img>` assets and decorative non-accent hues a grep can't see.

---

## 10. File map

| Concern | Lives in |
|---|---|
| The lock + gate checklist | [STYLESEED.md](STYLESEED.md) |
| Token APIs (radius/type/motion/shadow/ink) | [agentic30/OpenDesignTokens.swift](agentic30/OpenDesignTokens.swift) |
| Color palette (source of truth, theme-aware) | `OpenDesignDayColor` in [agentic30/OpenDesignDayPageView.swift](agentic30/OpenDesignDayPageView.swift) |
| Theme switch (white/dark) | [agentic30/Agentic30BrandColor.swift](agentic30/Agentic30BrandColor.swift) |
| HTML mockups | `mockups/*.html`, `competitive-matrix.html`, `docs/specs/agentic30-interview-card-q01.html` |
| Product-shape docs | `.agentic30/docs/{ICP,GOAL,VALUES,SPEC}.md` |

When you make a structural design change, update STYLESEED.md and this file so the lock can't drift.

---

## 11. Decision log

- **Kept green, not a rebrand** — preserves brand identity; non-breaking; StyleSeed's "one accent" works with any single hue. Chosen by the user from a live visual 시안.
- **Snap motion** — fits an "execution OS" that values fast, narrow action and gets out of the way.
- **Radius/shadow/density/type self-adopted** — soft scale matches macOS + StyleSeed; collapses 20+ ad-hoc radii into one personality with minimal visual change.
- **`rose/amber/sky/violet` kept as semantic status** (StyleSeed-legal), not treated as second accents.
- **No 70k-line SwiftUI sweep** — the app was already ~85% gate-compliant; tokens enforce coherence going forward rather than risking regressions.
- **`OpenDesignOfficeHoursColor` de-dup deferred** — re-pointing it at `OpenDesignDayColor` would make the intentionally dark-only Office Hours panel theme-aware (untested light rendering); not a visual-gate item.

# Non-Swift Design Surfaces Audit — for the "Founder OS Kit" React rebuild

Scope: every design surface OUTSIDE the SwiftUI app (`agentic30/*.swift`). This is the
companion to the Swift-app audit. It covers the design docs, the hand-authored HTML
mockups, the competitive-matrix visualization, the PRD surface spec, and a prior React
design-system extraction found in the archive.

**Ground truth for the palette/type/radius/motion is the SwiftUI token layer**
(`agentic30/OpenDesignTokens.swift` + `OpenDesignDayColor` in `OpenDesignDayPageView.swift`).
The non-Swift surfaces below **mirror** those tokens in CSS. Where a non-Swift surface
ADDS or DIFFERS from the Swift palette, it is called out explicitly under "Deltas" per file
and consolidated in the "Token deltas vs. Swift app" section at the end.

`.design-sync/mirror/` was deliberately NOT read (another process is building it).

---

## Inventory (files examined)

| File | Kind | What it is |
|---|---|---|
| `STYLESEED.md` | doc (lock) | The terse binding design lock + quality-gate checklist |
| `DESIGN.md` | doc (handbook) | The full design handbook; explains + expands the lock |
| `day1-first-surface.md` | doc (PRD) | Product/tech contract for the "first sentence" Day-1 surface (no tokens) |
| `mockups/sidebar-ia.html` | mockup | Day-timeline sidebar IA — 4 states (Day 7 / Day 1 / empty / error) |
| `mockups/office-hours-ia.html` | mockup | Office Hours screen with Day-timeline sidebar + repurposed macro stepper |
| `mockups/promise-card.html` | mockup | Interview "promise/commitment" card v2 — before/after + empty/error |
| `competitive-matrix.html` | interactive viz | 2×2 competitive positioning scatter plot (18 nodes) |
| `.design-sync/_archive-agentic30-ui-kit/**` | prior React DS | Archived React mirror: `ds.css` (`--ds-*` tokens) + 14 components + prop contracts |
| `agentic30/OpenDesignTokens.swift` | token source | Swift token layer (referenced as ground truth; audited fully by the Swift pass) |

Design specs scanned and found to contain NO new design tokens/surfaces (pointers only):
`docs/specs/fable5/SPEC.md`, `docs/specs/fable5/USER_STORIES.md`,
`docs/specs/agentic30_screenpipe_benchmarking_SPEC.md`, `docs/reviews/*`, `docs/strategy/*`,
`docs/october-academy/**`, `docs/private/alignment/**`, `docs/mandal-art.md`.

---

## 1. The shared token vocabulary (defined identically across all 4 HTML surfaces)

Every mockup + the competitive matrix declare the SAME `:root` block (naming varies
slightly: dashed `--muted-deep` vs camel `--mutedDeep`; `--r-chip` vs `--rChip` vs `--rCtl`).
Canonical values:

**Surfaces (greyscale dark, never #000)**
- `--page: #15171A`  (page background)
- `--surface: #1E2228`  (card background)
- `--surface2: #252A31`  (nested / elevated fill)
- `--hover: #2B3138`

**Borders (white alpha hairlines)**
- `--border: rgba(255,255,255,0.07)`
- `--borderSoft: rgba(255,255,255,0.05)`
- `--borderStrong: rgba(255,255,255,0.12)`

**Ink hierarchy (5 levels, descending emphasis)**
- `--fg: #E7E9EC`  (strongest text)
- `--fgSecondary: #B9BEC4`  (labels)
- `--muted: #8B9199`  (captions/subtitles)
- `--mutedDeep: #6B7178`  (faint/disabled)
- `--faint: #4F555C`  (locked node numerals)

**Single accent (green) + alpha tints**
- `--accent: #37D59F`
- `--accentDim: rgba(55,213,159,0.14)`  (fill wash)
- `--accentLine: rgba(55,213,159,0.40)`  (stroke)
- competitive-matrix ALSO defines two accent washes at lower alpha:
  `--accent-wash: rgba(55,213,159,0.08)` and `--accent-wash-strong: rgba(55,213,159,0.10)`

**Semantic status (severity/source ONLY — never decoration, never a 2nd accent)**
- `--danger: #E2897E`  (rose)  + `--dangerDim: rgba(226,137,126,0.13–0.14)` + `--dangerLine: rgba(226,137,126,0.40)`
- `--warning: #E0B564`  (amber) + `--warningDim: rgba(224,181,100,0.13–0.14)` + `--warningLine: rgba(224,181,100,0.40)`
- NOTE: `dangerDim`/`warningDim` alpha is `.13` in promise-card, `.14` in office-hours-ia — treat as ~0.13–0.14, standardize to one in React.
- STYLESEED/DESIGN docs also name `sky · violet · orange` as further semantic-status hues that live in the Swift palette (`OpenDesignDayColor`) but are NOT present in any HTML mockup — they exist only Swift-side.

**Radius (Soft scale) — matches `OpenDesignRadius`**
- `--r-chip / --rChip: 8px`  (badges, tags, status containers)
- `--r-control / --rControl / --rCtl: 10px`  (buttons, rows, inputs)
- `--r-card / --rCard: 14px`  (cards, panels, sheets)
- `--r-pill / --rPill: 999px`  (toggles, dots, round nodes)

**Type stacks**
- `--sans: -apple-system, "SF Pro Text", system-ui, "Pretendard", sans-serif`
- `--mono: ui-monospace, "SF Mono", Menlo, monospace`  (competitive-matrix mono adds `SFMono-Regular, Monaco, "Cascadia Code", Consolas`)
- Pretendard is a host-installed Korean fallback (NOT a shipped webfont — do not substitute a woff2). The whole design is a system-font stack; there is no brand webfont.

**Motion (Snap) — only defined as tokens in the archive `ds.css`, inline elsewhere**
- `--ds-dur-fast: 0.12s · --ds-dur-normal: 0.18s · --ds-dur-slow: 0.30s`
- `--ds-ease-snap: cubic-bezier(0.2, 0, 0, 1)`  (equals the Swift `timingCurve(0.2,0,0,1)`)
- HTML mockups hardcode motion inline (e.g. promise-card collapse `.34s cubic-bezier(.4,0,.2,1)`, `.12s` hovers) rather than referencing tokens.

**Focus ring (accessibility, present in every HTML surface)**
- `outline: 2px solid var(--accent)` (mockups) or `var(--accentLine)` (promise-card), `outline-offset: 2px`.

---

## 2. `STYLESEED.md` — the design lock

Terse binding contract for every UI surface (SwiftUI + HTML mockups). Not a screen; it's
the rulebook. Key extracted values (all consistent with the token table above):

- Accent green `#37D59F` dark / **`#008447` light** (the ONLY place the LIGHT-theme accent hex appears in the non-Swift docs).
- Radius `chip 8 · control 10 · card 14 · pill 999`.
- Shadow: layered, low-opacity, **black-based**; light ≤ 8% opacity; dark → hairline `borderSoft` instead of a shadow. **No colored/glow/hued shadows** (fg-based shadows glow white on dark).
- Motion Snap: `fast 0.12 · normal 0.18 · slow 0.30`, ease `timingCurve(0.2,0,0,1)`, no spring/bounce, honor reduceMotion.
- **Type role scale (pt):** `hero 46/600 · kpi 34/600 · sectionTitle 17/600 · listName 14/600 · listAmount 16/700 · body 13 · label 11 medium uppercase · caption 11 · trend 12`. (Maps 1:1 to Swift `OpenDesignType`.)
- Density: comfortable (desktop-adapted; StyleSeed's 430px mobile spacing relaxed).
- Locked 2026-06-30. Source rules: `styleseed-demo.vercel.app/llms-full.txt`.
- Quality gate ≥ 80/100 across: Coherence · Color=meaning · Hierarchy · Layout · States · Copy · Polish. Verify by RENDER + screenshot, not self-score or hex grep.

**Delta:** none — this is the source of the mockup tokens. Only doc to state the **light-theme accent `#008447`** and the full **pt type role scale** (mockups use raw px on components instead of the role scale).

---

## 3. `DESIGN.md` — the handbook

Expanded prose form of the lock. Confirms two UI surfaces exist: the SwiftUI app and the
HTML mockups (`mockups/*.html`, `competitive-matrix.html`, `docs/specs/*.html`).
Notable content for the React rebuild:

- Restates the HTML `:root` token block verbatim (the canonical source for §1 above).
- **Type role → pt scale** with weights (hero 46/semibold … trend 12/medium) — pass `rounded: true` on surfaces that already use SF Rounded (onboarding, briefing).
- 5-level grey hierarchy mapping (fg/fgSecondary/muted/mutedDeep + surface/bg families).
- **Status pairing rule:** done/success → accent or grey; in-progress/active → accent; needs-attention → danger/warning; everything normal → grey. A dot and its label are ALWAYS the same color.
- Empty/loading/error state recipes (skeleton = 300ms delay + 300ms min; only skeleton may pulse).
- Icons: SF Symbols (app) or inline `<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8">` (mockups). Monochrome via currentColor. **No emoji as UI icons.**
- **Darkest text ≈ `#2A2A2A` / `OpenDesignInk.onLightStrong`** — never pure `#000`.

**Delta / discrepancy:** §10 file map references `docs/specs/agentic30-interview-card-q01.html`
as an existing mockup — **that file does NOT exist in the repo** (confirmed absent;
`docs/specs/` contains only `.md` + the `fable5/` dir). A 5th interview-card mockup was
planned/referenced but is missing. Its content is effectively recovered by the QuestionCard
component in the archive DS + the office-hours-ia question card.

---

## 4. `mockups/sidebar-ia.html` — Day-timeline sidebar IA

**Depicts:** the redesigned left navigation reconceived as a cumulative **Day timeline**
(future days hidden). Renders a full 1080×712 macOS app frame: 56px icon rail →
240px Day-timeline sidebar → main column (titlebar + horizontal stepper + content card).
Toggles between **4 states**: Day 7 (mature), Day 1 (start), empty, error.

**Components / patterns present:**
- **Icon rail** (56px): active item uses `accentDim` bg + `accent` fg; bottom "Z" chip (wolf/pet placeholder) in a `surface2` square.
- **Sidebar header**: project name + `daypill` (mono, pill, accent, `accentDim` bg + `accentLine` border) + right-aligned `prog` "2/5".
- **Day row** (`.day`): 26px square `mark` numeral + goal (ellipsized) + optional `sub` + mono `badge`. States: `.today` (accentDim bg, accentLine border, accent sub/badge, fg-weighted goal), `.done` (muted mark, accent check badge), `.incomplete` (**neutral grey**, surface2 mark — explicitly NOT a colored alert).
- **Skip chip** (`.skip`): dashed-border dotted mark + "Day 3–5 · 건너뜀" label — compresses skipped days.
- **Empty state** (`.sb-state.empty`): 40px pill orb (calendar icon) + invite line + accent-text CTA "Day 1 시작하기" (plus icon).
- **Error state** (`.sb-state.error`): danger-colored orb (alert-triangle) + what-happened line + "다시 시도" retry CTA (refresh icon).
- **Horizontal stepper** (main): `.step` nodes 28px pill; `.done` = accentDim/accent check, `.active` = solid accent fill with page-color numeral, `.locked` = faint. Connecting `.line` turns accentLine when done/active. Day 7 macro steps: scan · 회고 · 목표 · 인터뷰 · 실행; Day 1: 온보딩 · scan · 목표 · 첫 인터뷰 (4 steps, no 회고).
- **Content card** (`.card`): mono accent eyebrow + 19px/700 h2 + body + actions (primary accent btn "오피스아워 시작" + ghost btn).

**IA decisions encoded (legend):** 오늘 = accent-emphasized, pinned top · 미완 = neutral grey · 건너뜀 = compressed chip · 과거 = read-only done · 미래 = hidden · bottom button = removed.

**Delta:** no new tokens; uses the shared palette. This is the canonical source for the
`DayRow` / `DayTimelineSidebar` / `Stepper` component states.

---

## 5. `mockups/office-hours-ia.html` — Office Hours screen (IA applied, design preserved)

**Depicts:** the Office Hours interview screen at 1180×860, with the Day-timeline sidebar
(from §4) on the left and the preserved Office-Hours main column on the right. Below the
frame, a state-demo strip shows the Day-timeline empty/error panels.

**Components / patterns present (many UNIQUE to this surface):**
- **OH header** (70px): 44px rounded-square `oh-icon` "OH" (mono, accentDim bg, accentLine border) + 17px title "Office Hours" + **NEW Day breadcrumb chip** `.oh-bc` ("Day 7 · 인터뷰", pill, accent) + sub-row with pulsing `oh-dot` + "/office-hours 실행 중".
- **Macro stepper** (`.stepper`, 56px): REPURPOSED to the 5 Day-loop macro stages (scan·회고·목표·인터뷰·실행) using pill `.step` chips (distinct from sidebar-ia's vertical-node stepper). `.done` = solid accent num + page-color check; `.on` = accentDim bg + accentLine border + accent num/label. `.sep` hairline between steps.
- **Terminal prompt line** (`.tutor`): mono `office-hours@agentic30 ~/strategy/session $ start startup --write-design-doc` — accent user, fgSecondary path, mutedDeep `$`.
- **Lead** (`.lead-h` 22px/700 + `.lead-p` 13px muted).
- **SectionHeader** (`.sh`): 4px accent `bar` + mono uppercase tracked title + mono `.m` meta ("질문 대화 2/3") + flex hairline `.line`.
- **SignalTable** (`.signals`): rows separated by borderSoft gaps; `.k` 132px mono uppercase key + `.v` value. Rows: 목적 / 진행 / 출력.
- **QuestionCard** (`.qcard`): **linear-gradient(surface→surface2)** background + **3px left accent bar** (`::before`) + eyebrow "질문" + pill count "1 / 6" + 17px/700 question text.
- **Option row** (`.opt`): 26px pill num + title + optional "추천" (rec) chip + mono `oid` id + description `.od` + `.meta` risk/근거 lines. `.opt.sel` = accentLine border + accentDim bg + accent num.

**Legend (preserve vs IA):** PRESERVED = OH header, terminal prompt, step pill, signal table, question card, option rows (color/box/layout unchanged). IA-CHANGED = sidebar → Day timeline; top stepper → Day-loop macro 5 stages; header Day breadcrumb; the old micro 3-step (목표준비·질문대화·증거정리) demoted to section-header meta.

**Delta:** adds `--dangerDim/--dangerLine/--warningDim/--warningLine` alpha tints
(alpha `.14`) to the shared block. QuestionCard's **gradient fill** and **3px left accent
bar** are unique idioms not in the Swift token API.

---

## 6. `mockups/promise-card.html` — interview "promise/commitment" card v2

**Depicts:** the last step of an interview — the "약속" (commitment) card. A before/after
comparison plus dedicated empty + error states for the suggested-action data surface.
This is the most interaction-rich mockup (has working JS for pick/type/defer/abandon).

**Screens / variants:**
- **BEFORE** (720px): the over-dense current card (6 inputs + picker + 2 buttons + 3 conditional scoring buttons) — annotated with red `.pin` tags marking what to remove.
- **AFTER · A** (430px): base "promise mode" — `PromiseCard` with 3 suggested `.actopt` radio options + "추천" chip on the first + a custom `.actcustom` "직접 적기…" text row + `draftnote` (star icon) + full-width primary "약속하고 닫기" + a `.deferlink` ("오늘은 약속 못 해 — 미룸으로 닫기").
- **AFTER · B** (430px): same, but with a **DebtBanner** (`.debt`, danger severity: alert-triangle + prior-promise title + "증거 0 · 2일째 미룸" meta + "포기로 기록" abandon btn) and the commit CTA disabled until an action is chosen.
- **AFTER · C** (430px): **defer mode** — commit zone COLLAPSED (animated `max-height` transition), only the `.deferbox` reason input + amber "미룸으로 닫기" button + "다시 약속하기" back-link remain; a "2일째 미룸" warning pill in the defer header.
- **STATES · empty** (430px): `.statecard` — 38px pill icon (check-clipboard) + "제안할 행동 후보가 아직 없어요" + mono `suggestedActions: []` meta + accent "직접 행동 적기" CTA that focuses a custom input (commit still possible via typing).
- **STATES · error** (430px): `.statecard.err` — danger icon + "행동 후보를 불러오지 못했어요" + mono `suggestedActions: timeout` + "다시 불러오기" retry.

**Unique component idioms:**
- **PromiseCard shell** (`.pcard`): surface bg + **3px left bar** that is `--muted` (grey) by default (NOT accent — this card is not the primary action surface).
- **ActionOption** (`.actopt`): custom radio `.rdo` (16px pill, fills accent when selected) + label + rec chip; `.sel` = accentLine border + accentDim bg. This is the same "office-hours option idiom" reused.
- **Custom input row** (`.actcustom`): pencil icon + borderless text input inside a control-radius box.
- **Button variants**: `.btn.primary` (accent fill, page-color text, disabled = accentDim bg + mutedDeep text), `.btn.ghost` (transparent + border), **`.btn.amber`** (transparent + warningLine border + warning text — the defer/miss action).
- **Collapse/reveal animation**: `.commitzone` (`max-height .34s cubic-bezier(.4,0,.2,1)`, opacity) and `.deferbox` (reveal with `.06s`/`.1s` stagger).

**Data contract (from legend):** event → `{suggestedActions:[3], openDebt}` · commit → ledger
`{text, origin:"user", evidence:null, draftOrigin:"selected"|"typed"}` · defer → cycle
`outcome="deferred"` + `consecutiveDeferrals++`.

**Delta:** `dangerDim/warningDim` alpha here is **`.13`** (vs `.14` in office-hours-ia) —
minor inconsistency to normalize. Introduces the **grey (muted) left-bar** card variant and
the **amber button variant**, neither of which is a distinct token in the Swift layer.

---

## 7. `competitive-matrix.html` — competitive positioning 2×2 (interactive viz)

**Depicts:** NOT a product app screen — a standalone strategy artifact. A responsive 2×2
scatter plot (X = 정적→Adaptive, Y = Build→PMF Evidence) with 18 competitor nodes, a
selectable detail panel, a filterable legend, and its own empty/error demo states. Uses the
SAME dark palette and radius/accent tokens, but is **mono-first** (`font-family: var(--mono)`
on body) — the only surface that is monospace-body by default.

**Components / patterns present:**
- **Plot box** (`.plotbox`, aspect-ratio 1.18): dashed mid-axis lines, 4 quadrant labels, edge axis labels, a top-right **wedge** radial-gradient highlight (`--accent-wash`, no glow).
- **Nodes** (`.node/.dot`): 11px greyscale dots; only the anchor (Agentic30) is accent. `.star` anchor = 17px accent dot + **pulsing ring** keyframe (`@keyframes pulse` 2.4s). `.historical` = dashed hollow dot (e.g. "Buildspace (종료)"). `.sel` scales + turns accent; `.dim` = 0.32 opacity when its category is filtered off.
- **Detail panel** (`.panel`, 350px): kicker + category `.chip` (accent when anchor) + 25px name + tag + **two metric bars** (`.track`/`.fill`: `.fill.adapt` = accent, `.fill.evid` = muted) + "WHY HERE" body + URL link + a conditional **wedge card** (`.gap`, accent-bordered, shown only for the anchor) + **DATA STATES** demos (empty + error, same `.state` visual language).
- **Legend** (`.legend`): clickable category swatches, toggle to dim nodes.

**Content (18 positions, X/Y are 0–100 adaptivity/evidence scores):** Agentic30 (anchor,
82/80) · Spark Claw · IndieFounders · 마켓테스트 · Icanpreneur · SparkLaunch · Preuve AI ·
Ship 30 for 30 · Buildspace(종료, historical) · AI 솔로프리너 클럽 · CoFounder.im · FounderPal ·
Cursor · Replit · Lovable · YC Startup School · 오즈 1인 창업가 캠프 · 코배투 런칭챌린지.

**Delta:** adds `--accent-wash: rgba(55,213,159,0.08)` and `--accent-wash-strong:
rgba(55,213,159,0.10)` (lower-alpha accent tints for the wedge gradient/historical fill).
Extends `--mono` stack with `SFMono-Regular, Monaco, "Cascadia Code", Consolas`. The
**pulsing anchor ring** is the only always-on animation in the whole design and is an
intentional exception to the "no infinite loops except skeleton pulse" rule. This surface is
a rebuild candidate only if the OS Kit wants a "positioning/strategy" viz — otherwise it's a
one-off marketing/strategy asset.

---

## 8. `day1-first-surface.md` — "First sentence" Day-1 surface (PRD, no tokens)

**Depicts (conceptually, no visual mockup):** the Day-1 completion surface where Agentic30
generates a customer-facing surface rather than giving advice. Flow: ask "고객이 볼 페이지가
있나요?" → 2 choices (없음 → draft `landing.html` + README rewrite proposal; 있음 → read
URL + diagnose first screen) → **result preview first**, then a single **bundle review**
(approve/reject) → decision saved to `.agentic30/memory/surface-review.json`.

Screens implied but NOT yet designed in HTML/Swift: the "landing/README proposal preview +
bundle review approve/reject" surface. No `landing.html` template exists in the repo yet
(the generated artifact is a runtime output, not a checked-in mockup).

**Delta:** no design tokens. Relevant to the OS Kit only as a **future screen to design**
(a proposal-preview + approve/reject review surface) — currently unbuilt on every surface.

---

## 9. Prior React design system in the archive — `.design-sync/_archive-agentic30-ui-kit/`

**This is the single most useful artifact for the React rebuild.** It is a previously-built
React mirror of the entire design (the predecessor of whatever `.design-sync/mirror/` is
now building). Not the repo's shipped code — a hand-authored reimplementation encoding the
same tokens + surfaces as React components. First synced 2026-06-30 to the claude.ai/design
project "Agentic30 UI Kit" (`adbfbb45-72b7-4f16-82b1-dba7073f71b1`).

**Structure:**
- `mirror-src/ds.css` — the full CSS: `:root` `--ds-*` tokens (below) + every component class in ONE file.
- `mirror-src/components/*.tsx` + `mirror-src/icons.tsx` + `index.ts` — 14 React components.
- `ds-bundle-old/components/general/<Name>/` — each component's `.jsx`, `.d.ts` (prop contract), `.html` (static render), `.prompt.md` (usage).
- `previews/*.tsx` — 14 authored previews (each wraps the cell in a `var(--ds-page)` dark canvas because the DS is dark-first).
- `conventions.md` / `README.md` — the "how to build with it" guide + non-negotiables.
- `config.json` — pkg `agentic30-ds`, global `Agentic30DS`.

**`--ds-*` token layer (from `ds.css`)** — the same values as §1 but with a DASHED,
`--ds-`-prefixed naming convention (this is the naming the React kit shipped):
```
--ds-page #15171A · --ds-surface #1E2228 · --ds-surface-2 #252A31 · --ds-hover #2B3138
--ds-border rgba(255,255,255,.07) · --ds-border-soft .05 · --ds-border-strong .12
--ds-fg #E7E9EC · --ds-fg-secondary #B9BEC4 · --ds-muted #8B9199 · --ds-muted-deep #6B7178 · --ds-faint #4F555C
--ds-accent #37D59F · --ds-accent-ink #15171A · --ds-accent-dim rgba(55,213,159,.14) · --ds-accent-line .40
--ds-danger #E2897E (-dim .13 / -line .40) · --ds-warning #E0B564 (-dim .13 / -line .40)
--ds-r-chip 8 · --ds-r-control 10 · --ds-r-card 14 · --ds-r-pill 999
--ds-dur-fast .12s · --ds-dur-normal .18s · --ds-dur-slow .30s · --ds-ease-snap cubic-bezier(0.2,0,0,1)
--ds-sans (SF Pro Text stack) · --ds-mono (SF Mono stack)
```

**14 components (prop contracts recovered from `.d.ts`):**

| Tier | Component | Key props / variants |
|---|---|---|
| Primitive | `Button` | `variant: primary\|ghost\|amber`, `fullWidth` |
| Primitive | `Badge` | `variant: accent\|neutral\|danger\|warning` |
| Primitive | `Input` | variant default/accent/warning (`.ds-input--accent/--warning`) |
| Primitive | `SectionHeader` | 4px bar (`--accent` variant) + mono uppercase label + meta + hairline |
| Primitive | `Card` | eyebrow + title + body + actions |
| Molecule | `ActionOption` | radio option idiom; `sel`, optional `rec` ("추천") chip |
| Molecule | `StateCard` | `empty`/`error` (icon + title + meta + CTA) |
| Molecule | `DebtBanner` | danger severity; `title: ReactNode`, `meta`, abandon action |
| Molecule | `DayRow` | states today/done/incomplete; mark + goal + sub + badge |
| Molecule | `Stepper` | nodes done/active/locked + connecting line |
| Molecule | `QuestionCard` | gradient bg + 3px accent bar + eyebrow + count + text |
| Molecule | `SignalTable` | key(132px mono)/value rows |
| Organism | `PromiseCard` | `title`, `options: PromiseOption[]`, optional `debt`, `commitDisabled`, `note` |
| Organism | `DayTimelineSidebar` | `project`, `day`, `progress`, `group`, `days: DayRow[]`, `skipLabel`, `state: empty\|error` |

**Non-negotiables restated by the kit's conventions.md:** dark-first (WRAP every screen in
`var(--ds-page)`; there is NO React provider — tokens are plain `:root` CSS vars); one primary
green action per screen; normal = grey; every data surface ships real empty + error; buttons
name the action; soft radius + layered black-based shadow only; honor reduced motion.
`dangerouslySetInnerHTML` deliberately avoided — `DebtBanner.title` / PromiseCard notes take
`ReactNode` so callers compose `<b>` safely.

**Deltas vs Swift + vs mockups:**
- **`--ds-accent-ink: #15171A`** = near-page dark ink used as the text color on green
  (accent) fills. This DIFFERS from the Swift `OpenDesignInk.onLightStrong` = `#2A2A2A`
  (`rgb(0.165,0.165,0.165)`). The React kit chose "text on a green button = page color
  `#15171A`", the mockups also use `color: var(--page)` on accent buttons, but STYLESEED/
  DESIGN say the darkest text is `#2A2A2A`. **For the OS Kit, decide one:** page-color ink on
  accent fills (what the kit + mockups actually render) vs `#2A2A2A` (what the doc says). The
  mockups + kit win in practice.
- Naming: this kit uses `--ds-`-prefixed DASHED tokens; the live mockups use un-prefixed
  (camel + dashed mixed) tokens. The React rebuild must pick ONE naming convention.
- `dangerDim/warningDim` alpha here is `.13` (matches promise-card, not office-hours-ia's `.14`).

---

## Token deltas vs. the Swift app palette (consolidated) — what the non-Swift surfaces ADD/DIFFER

1. **Light-theme accent `#008447`** — appears only in `STYLESEED.md`/`DESIGN.md`; NO HTML
   mockup renders light mode (all mockups are dark-only). Swift `OpenDesignDayColor.accent`
   is the theme-aware source.
2. **Accent-on-fill ink conflict**: mockups + archive kit use `--page`/`--ds-accent-ink`
   (`#15171A`) as text on green fills; the docs + Swift `OpenDesignInk.onLightStrong` say
   `#2A2A2A`. Resolve in the OS Kit (recommend page-color ink to match rendered surfaces).
3. **Low-alpha accent washes** (competitive-matrix only): `--accent-wash 0.08`,
   `--accent-wash-strong 0.10` — extra tints below the standard `accentDim 0.14`.
4. **Severity Dim alpha inconsistency**: `.13` (promise-card, archive kit) vs `.14`
   (office-hours-ia). Standardize.
5. **Semantic hues present only Swift-side**: `sky · violet · orange` are named in
   STYLESEED/DESIGN + the Swift `OpenDesignDayColor` but appear in NO HTML surface —
   the mockups only ever use `danger` (rose) + `warning` (amber).
6. **Motion tokens** are only formalized as CSS vars in the archive `ds.css`
   (`--ds-dur-*`, `--ds-ease-snap`); the mockups hardcode durations inline (and promise-card
   uses a DIFFERENT ease `cubic-bezier(.4,0,.2,1)` for its collapse, not the Snap curve).
7. **Extended mono stack** in competitive-matrix (`SFMono-Regular, Monaco, Cascadia Code, Consolas`).
8. **Type**: the pt **role scale** (hero 46 … trend 12) lives in the docs + Swift
   `OpenDesignType`; the HTML mockups use raw px per element and do NOT reference a role scale.

---

## Screens/mockups depicted in HTML that are NOT in the Swift app

- **Competitive positioning 2×2 matrix** (`competitive-matrix.html`) — a strategy/marketing
  viz with no SwiftUI counterpart. Standalone; only a rebuild candidate if the Kit wants a
  positioning-chart component (nodes + detail panel + metric bars + pulsing anchor + legend).
- **Promise-card "BEFORE" state** (`promise-card.html`) — the deliberately over-dense
  legacy commitment form, kept only as an annotated before/after reference; not a target UI.
- **Day-timeline "empty" and "error" states** as standalone demo panels (sidebar-ia +
  office-hours-ia + promise-card all ship dedicated empty/error demos) — these state screens
  are fully specified in HTML and should be first-class in the Kit even though the Swift app's
  coverage of them is what the Swift pass must confirm.
- **Referenced-but-missing** `docs/specs/agentic30-interview-card-q01.html` — a planned 5th
  interview-card mockup that does not exist; recover its intent from QuestionCard + office-hours-ia.
- **Day-1 "first sentence" surface** (`day1-first-surface.md`) — a proposal-preview +
  bundle-review (approve/reject) screen that is specified only as a PRD and is unbuilt on
  every surface (no HTML, no Swift mockup).

---

## Recommendations for the "Founder OS Kit" React rebuild

1. **Start from the archived React kit** (`.design-sync/_archive-agentic30-ui-kit/`): it
   already gives you the 14-component API + `--ds-*` token CSS. It's the closest existing
   React encoding. Verify each component against the current mockups before trusting it (the
   archive can lag the mockups — drift is manual per NOTES.md).
2. **Adopt ONE token naming** (recommend the `--ds-*` dashed set from the kit) and resolve the
   4 deltas above (accent-on-fill ink, severity Dim alpha, low-alpha washes, motion ease).
3. **Ship the state screens as first-class**: every data surface needs empty + error variants
   (`StateCard`, `DayTimelineSidebar state`), fully specified across the mockups.
4. **Carry the light theme forward** via the `#008447` light accent from STYLESEED even though
   no HTML renders it — the Swift app is theme-aware and the Kit should be too.
5. Treat the **competitive matrix** and **Day-1 first-surface** as separate/optional scope —
   the former is a one-off viz, the latter is an unbuilt PRD screen.

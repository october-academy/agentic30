# Founder OS Kit — how to build with it

Founder OS Kit is a faithful React mirror of **Agentic30**, a calm, **dark-first, macOS-native**
execution OS for solo founders. Authority for the look: the app's `OpenDesign*` sources +
`STYLESEED.md`. Build every screen out of the components below; style your own layout glue with
the `--ds-*` CSS variables — never invent ad-hoc colors, radii, or fonts.

## Setup — dark canvas + the single accent

There is **no React provider**. All tokens live as CSS custom properties on `:root` in
`styles.css` (loaded for you). The one thing you MUST do: components are dark-first and assume a
dark page behind them, so **wrap every screen in the page background** or surfaces sit on the
wrong color:

```jsx
import { Card, Button } from "<this design system>";

<div style={{ background: "var(--ds-page)", minHeight: "100vh", fontFamily: "var(--ds-sans)", padding: 24 }}>
  <Card eyebrow="개요 · Day 1 / 30" title="오늘은 Day 1 · 고객 후보를 좁히는 날이에요."
        actions={<><Button variant="primary">오늘 화면 열기</Button><Button variant="ghost">지난 회고 보기</Button></>}>
    scan과 회고에서 모인 신호를 바탕으로 오피스아워가 질문을 던집니다.
  </Card>
</div>
```

**Light theme** is opt-in: wrap a subtree in `<div data-theme="white">`. Components read the
`--ds-*` vars, so they flip automatically — you don't pass a theme prop.

**Color = meaning.** Green (`--ds-accent`, `#37D59F`) is the *single* accent — one primary action
per screen, the live/current item, the selected option. Everything else is greyscale.
`--ds-danger` (rose) and `--ds-warning` (amber) are **severity only** (evidence debt, defer,
errors) — never decoration, never a second accent. `--ds-sky`/`--ds-violet`/`--ds-teal` are
source/category hues (used via the `tone` prop).

## The styling idiom — CSS variables, not utility classes

Components are self-styling; you never pass them class names. Most take a `tone` prop
(`accent | amber | rose | sky | violet | teal | pink | muted`) that maps to the right hue. For
your **own** layout (spacing, backgrounds, custom rows) reference these token families from
`styles.css`:

| Family | Real tokens | Use |
|---|---|---|
| Surface | `--ds-page` `--ds-surface` `--ds-surface-2` `--ds-elevated` `--ds-hover` `--ds-selected` | backgrounds, dark→light layers |
| Ink | `--ds-fg` `--ds-fg-secondary` `--ds-muted` `--ds-muted-deep` `--ds-faint` | text, by descending emphasis |
| Border | `--ds-border` `--ds-border-soft` `--ds-border-strong` | hairlines |
| Accent | `--ds-accent` `--ds-accent-dim` `--ds-accent-line` `--ds-accent-ink` `--ds-accent-bright` | the green; `-ink` = dark text on a green fill |
| Severity/hue | `--ds-danger(-dim/-line)` `--ds-warning(-dim/-line)` `--ds-sky` `--ds-violet` `--ds-teal` `--ds-pink` | rose/amber = severity; others = source |
| Radius | `--ds-r-chip`(8) `--ds-r-control`(10) `--ds-r-card`(14) `--ds-r-pill`(999) `--ds-r-modal`(34) | Soft scale — snap to these |
| Spacing | `--ds-space-1..28` (2→56px, 2px grid) | gaps, padding |
| Panes | `--ds-pane-rail`(52) `--ds-pane-sidebar`(240) `--ds-pane-meta`(280) `--ds-h-titlebar`(36) | shell layout widths |
| Motion | `--ds-dur-fast/normal/slow` `--ds-ease-snap` | Snap timing, no spring/bounce |
| Type | `--ds-sans` `--ds-mono` `--ds-rounded` | SF Pro / SF Mono / SF Pro Rounded (system-served) |

Numbers pair with units ~2:1; **mono** is for labels/counters/metadata (often uppercase +
tracked via `--ds-track-eyebrow`), **rounded** for KPI/hero numbers, **sans** for prose.

## Where the truth lives

Read `styles.css` (the `:root` token block) before styling anything yourself. Read each
component's `.d.ts` (prop contract) and `.prompt.md` (usage + examples) before composing it.
Full **screens** are their own cards — `ProjectsReferencePage` is a complete dashboard; the
`reference/` group (`ReferenceShell`, `Rail`, `ReferenceSidebar`, `Titlebar`, `ReferenceHeader`,
`MetaPanel`, `RefSection`, `PhaseGateRow`, `DayCalendar`, `SideRow`, `FilterTabs`) composes the
uniform `rail | sidebar | main | meta` layout every dashboard screen uses.

## Components (`window`-global library)

Primitives — `Button` (primary/white/ghost/secondary/amber), `Badge`, `Chip`, `Input`, `Toggle`,
`Segmented`, `IconButton`, `Avatar`, `SectionHeader`, `Spinner`, `ProgressBar`, `ProgressRing`,
`Sparkline`, `SourcePill`, `DashPagination`.
Molecules — `Card`, `StatCard`, `MetricPill`, `ListRow`, `KVRow`, `OptionCard`, `QuestionCard`,
`StateCard` (empty/error/loading), `DebtBanner`, `Stepper`, `ProviderCard`, `ArticleCard`,
`TimelineRow`.
Reference/screen — the `reference/` group above + `ProjectsReferencePage`.

## Non-negotiables

- One primary (green) action per screen; normal/OK states are grey.
- Every data surface ships a real **empty + error** state (`StateCard kind="empty|error"`), not
  just the full one.
- Buttons name the action ("결제 요청 보내기"), never "확인". Errors help, not blame.
- Soft radius only; layered black-based shadow (never a colored/glow shadow); Snap motion.

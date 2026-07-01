# Agentic30 Design System — how to build with it

Agentic30 is a calm, **dark-first, macOS-native** execution OS for solo developers.
Authority for this look: `STYLESEED.md` + `OpenDesignTokens.swift` in the app repo.
Build every screen out of the components below; style your own layout glue with the
`--ds-*` CSS variables — never invent ad-hoc colors, radii, or fonts.

## Setup — dark canvas + the single accent

There is **no React provider**: all tokens live as CSS custom properties on `:root`
in `styles.css` (loaded for you). The one thing you MUST do: the components are
dark-first and assume a dark page behind them, so **wrap every screen in the page
background** or text/surfaces will sit on the wrong color:

```jsx
import { Card, Button } from "<this design system>";

<div style={{ background: "var(--ds-page)", minHeight: "100vh", fontFamily: "var(--ds-sans)", padding: 24 }}>
  <Card eyebrow="목표 · 오피스아워" title="오늘의 방향을 한 문장으로 좁힙니다"
        actions={<><Button variant="primary">오피스아워 시작</Button><Button variant="ghost">지난 회고 보기</Button></>}>
    scan과 회고에서 모인 신호를 바탕으로 오피스아워가 질문을 던집니다.
  </Card>
</div>
```

**Color = meaning.** Green (`--ds-accent`, `#37D59F`) is the *single* accent — one
primary action per screen, the live/current item, the selected option. Everything
else is greyscale. `--ds-danger` (rose) and `--ds-warning` (amber) are **severity
only** (evidence debt, defer, errors) — never decoration, never a second accent.

## The styling idiom — CSS variables, not utility classes

Components are self-styling; you don't pass them class names. For your **own** layout
(spacing, backgrounds, custom rows) reference these token families from `styles.css`:

| Family | Real tokens | Use |
|---|---|---|
| Surface | `--ds-page` `--ds-surface` `--ds-surface-2` `--ds-hover` | backgrounds, dark→light layers |
| Ink | `--ds-fg` `--ds-fg-secondary` `--ds-muted` `--ds-muted-deep` `--ds-faint` | text, by descending emphasis |
| Border | `--ds-border` `--ds-border-soft` `--ds-border-strong` | hairlines |
| Accent | `--ds-accent` `--ds-accent-dim` `--ds-accent-line` `--ds-accent-ink` | the green; `-ink` is dark text on a green fill |
| Severity | `--ds-danger(-dim/-line)` `--ds-warning(-dim/-line)` | rose / amber, severity only |
| Radius | `--ds-r-chip` (8) `--ds-r-control` (10) `--ds-r-card` (14) `--ds-r-pill` (999) | Soft scale — snap to these, no stray values |
| Motion | `--ds-dur-fast/normal/slow` `--ds-ease-snap` | Snap timing, no spring/bounce |
| Type | `--ds-sans` `--ds-mono` | SF Pro / SF Mono stacks (system-served) |

Numbers pair with units ~2:1; mono is for labels/counters/metadata, sans for prose.

## Components (`window`-global library)

Primitives — `Button` (primary/ghost/amber), `Badge` (accent/neutral/danger/warning),
`Input` (default/accent/warning), `SectionHeader`, `Card`.
Molecules — `ActionOption` (the selectable radio-option idiom), `StateCard`
(empty/error), `DebtBanner`, `DayRow`, `Stepper`, `QuestionCard`, `SignalTable`.
Organisms — `PromiseCard` (the interview's commitment card) and `DayTimelineSidebar`
(the day timeline). Read each component's `.d.ts` (the prop contract) and `.prompt.md`
(usage) before composing it; read `styles.css` before styling anything yourself.

## Non-negotiables

- One primary (green) action per screen; normal/OK states are grey.
- Every data surface ships a real **empty + error** state (`StateCard`,
  `DayTimelineSidebar state="empty|error"`), not just the full one.
- Buttons name the action ("결제 요청 보내기"), never "확인". Errors help, not blame.
- Soft radius only; layered black-based shadow (no colored/glow shadow); honor reduced motion.

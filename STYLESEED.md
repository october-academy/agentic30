# StyleSeed — Design Lock

Source rules: `styleseed-demo.vercel.app/llms-full.txt`. This lock is the durable
contract for every UI surface in Agentic30 (SwiftUI app + HTML mockups). Obey it on
every change; update it here when the design genuinely changes so drift can't creep in.

- **App domain:**        dev-tools / SaaS (solo-developer execution OS)
- **Skin:**              custom — "Agentic30" (calm dark-first, macOS-native)
- **Key color (accent):** **Green** — `#37D59F` dark · `#008447` light
  (`OpenDesignDayColor.accent`). The single accent. Everything else is greyscale.
  `rose · amber · violet · sky` are **semantic status colors** (severity/source), not
  second accents — never use them as decoration.
- **Radius personality:** **Soft** — scale only: `chip 8 · control 10 · card 14 · pill 999`
  (`OpenDesignRadius`). No sharp 0–4px corners; no ad-hoc values.
- **Shadow language:**   layered, low-opacity, **black-based** (fg-based shadows glow
  white on dark). Light ≤ 8% opacity; dark → hairline border (`borderSoft`) over shadow.
  **No colored / glow / hued shadows.** (`OpenDesignShadow`)
- **Motion seed:**       **Snap** (Linear/Raycast) — `fast 0.12 · normal 0.18 · slow 0.30`,
  ease `timingCurve(0.2, 0, 0, 1)`, no spring/bounce. Honor `reduceMotion`. (`OpenDesignMotion`)
- **Type:**              SF Pro / `.rounded` where already used. Role scale (pt):
  `hero 46/600 · kpi 34/600 · sectionTitle 17/600 · listName 14/600 · listAmount 16/700 ·
  body 13 · label 11 medium uppercase · caption 11 · trend 12`. (`OpenDesignType`)
- **Density:**           comfortable (desktop-adapted; StyleSeed's 430px mobile spacing relaxed)
- **Locked:**            2026-06-30

## Quality gate (run before showing any UI; target ≥ 80, fix + re-check up to 3×)
- **Coherence** — one accent, one radius personality, one shadow language, one icon set.
- **Color = meaning** — normal/OK states GREY; color marks only the minority needing
  attention; no rainbow; same value = same color.
- **Hierarchy** — one primary per screen; numbers 2:1 with unit; sizes from the scale.
- **Layout** — content lives in cards; consistent rhythm; gap-around-group > gap-inside.
- **States** — every data surface has real empty + loading + error, not just the full state.
- **Copy** — buttons name the action ("결제 요청 보내기", not "확인"); errors help, not blame.
- **Polish** — visible focus rings; ≥44px targets; `prefers-reduced-motion`; layered (not
  hard/colored) shadow; no pure `#000`; no emoji as UI icons.

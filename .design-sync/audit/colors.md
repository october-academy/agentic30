# Agentic30 → Founder OS Kit — COLOR AUDIT

Exhaustive extraction of every color definition in `agentic30/*.swift`, for a faithful
React ("Founder OS Kit") rebuild. HEX values are computed from fractional sRGB as
`round(channel * 255)` per channel. **Dark theme is the product default**
(`Agentic30Theme.defaultTheme = .dark`); the White theme values are included where the
namespace is theme-aware, because a faithful kit must ship both.

Grep terms swept: `enum *Color`, `enum *Theme`, `*Palette`, `*Tone`, `Color(red:`,
`Color(.sRGB`, `NSColor(red:`, `LinearGradient`, `RadialGradient`, `AngularGradient`,
`Gradient(`, `.opacity(`. No `Color(.sRGB...)` / `.displayP3` usages exist — every
literal is `Color(red:green:blue:)` (extended sRGB) or `NSColor(red:...)`.

---

## 0. Theme model (the switch every namespace keys off)

`Agentic30Theme` (`Agentic30BrandColor.swift`) — enum `.white` / `.dark`, default `.dark`,
persisted at `UserDefaults` key `agentic30.appearance.theme.v1`. `Agentic30Theme.current`
is read synchronously inside almost every computed color, so tokens are **runtime
theme-switched**, not compile-time. For React: model as a `data-theme="dark|white"`
attribute + CSS custom properties, dark as the default `:root`.

Window background (`windowBackgroundColor`, NSColor):
| Theme | sRGB | HEX |
|---|---|---|
| dark | 0.0801, 0.0874, 0.0928 | `#141618` |
| white | 0.9698, 0.9778, 0.9838 | `#F7F9FB` |

---

## 1. `OpenDesignDayColor` — THE CORE PALETTE (canonical design system)
File: `agentic30/OpenDesignDayPageView.swift:4278-4413` (struct `OpenDesignDayPalette` +
enum `OpenDesignDayColor`). This is the master token set; nearly every other namespace
re-exports from it. Dark values converted from `day-white.html` OKLCH → sRGB per source note.

### Base tokens — DARK theme (default)
| Token | sRGB (r,g,b) | HEX (dark) | HEX (white) | Role |
|---|---|---|---|---|
| bg | 0.0801, 0.0874, 0.0928 | `#141618` | `#F7F9FB` | app background |
| bgDeep | 0.0379, 0.0446, 0.0497 | `#0A0B0D` | `#EFF3F6` | deep recessed bg |
| bgDarker | 0.0252, 0.0291, 0.0322 | `#060708` | `#E6EBF0` | darkest recess |
| surface | 0.0544, 0.0614, 0.0666 | `#0E1011` | `#FFFFFF` | card/panel fill |
| surface2 | 0.0714, 0.0786, 0.0839 | `#121415` | `#F4F6F9` | subtle panel fill |
| elevated | 0.1053, 0.1147, 0.1217 | `#1B1D1F` | `#FFFFFF` | elevated surface |
| hover | 0.1407, 0.1524, 0.1611 | `#242729` | `#E8ECEF` | hover fill |
| selected | 0.1756, 0.1918, 0.2039 | `#2D3134` | `#DEE5EB` | selected/active fill |
| border | 0.1501, 0.1619, 0.1708 | `#26292B` | `#C7CDD2` | default border |
| borderSoft | 0.1128, 0.1242, 0.1327 | `#1D1F22` | `#DCE1E4` | soft border |
| borderStrong | 0.2421, 0.2634, 0.2793 | `#3E4347` | `#A0A9B0` | strong/contrast border |
| fg | 0.9410, 0.9490, 0.9550 | `#F0F2F4` | `#141C22` | primary text |
| fgSecondary | 0.7328, 0.7455, 0.7551 | `#BBBEC1` | `#3A4147` | secondary text |
| muted | 0.4865, 0.5055, 0.5198 | `#7C8185` | `#666D72` | muted text |
| mutedDeep | 0.3263, 0.3486, 0.3652 | `#53595D` | `#93999E` | deepest muted |
| accent | 0.2165, 0.8352, 0.6244 | `#37D59F` | `#00834B` | **brand accent (green/mint)** |
| accentStrong | 0.0000, 0.7754, 0.5051 | `#00C681` | `#007238` | strong accent |
| amber | 0.9364, 0.6955, 0.2742 | `#EFB146` | `#EFB146` | warning/amber (same both themes) |
| rose | 0.9751, 0.4673, 0.4400 | `#F97770` | `#C13C3B` | error/rose |
| sky | 0.3475, 0.7738, 0.9615 | `#59C5F5` | `#0081B2` | info/sky |
| magenta | 0.9582, 0.4475, 0.7148 | `#F472B6` | `#C23078` | magenta accent |
| orange | 0.9843, 0.5725, 0.2353 | `#FB923C` | `#D65711` | orange accent |
| diffAdd | 0.2284, 0.7286, 0.4173 | `#3ABA6A` | `#007A34` | diff added (green) |
| diffDel | 0.9473, 0.4424, 0.4166 | `#F17169` | `#BD3838` | diff deleted (red) |

### Derived: `violet` (added after struct; per-theme) — `OpenDesignDayPageView.swift:4393`
| Theme | sRGB | HEX |
|---|---|---|
| dark | 0.7798, 0.5391, 0.9596 | `#C789F5` |
| white | 0.4509, 0.2696, 0.7177 | `#7345B7` |
Used for briefing drilldown deploy markers, 실험 badge, PostHog logo.

### Opacity variants (dim = fill wash, line = border) — `OpenDesignDayPageView.swift:4399-4412`
All are `baseToken.opacity(a)`. In React, express as `color-mix` / rgba on the base hex.
| Token | Base | Opacity (dark) | Opacity (white) |
|---|---|---|---|
| accentDim | accent | 0.14 | 0.12 |
| accentLine | accent | 0.40 | 0.34 |
| amberDim | amber | 0.14 | 0.14 |
| amberLine | amber | 0.36 | 0.36 |
| roseDim | rose | 0.14 | 0.14 |
| roseLine | rose | 0.36 | 0.36 |
| skyDim | sky | 0.14 | 0.14 |
| skyLine | sky | 0.36 | 0.36 |
| violetDim | violet | 0.14 | 0.14 |
| violetLine | violet | 0.36 | 0.36 |
| magentaDim | magenta | 0.14 | 0.14 |
| magentaLine | magenta | 0.36 | 0.36 |
| orangeDim | orange | 0.14 | 0.14 |
| orangeLine | orange | 0.36 | 0.36 |

**Dark rgba examples** (accent `#37D59F`): accentDim = `rgba(55,213,159,0.14)`,
accentLine = `rgba(55,213,159,0.40)`.

---

## 2. `OpenDesignOfficeHoursColor` — Office Hours screen (DARK-ONLY, hardcoded)
File: `agentic30/ContentView.swift:172-195`. **Not theme-aware** — these are `static let`
literals equal to the DARK OpenDesignDayColor values (Office Hours only renders dark).
| Token | sRGB | HEX | = OpenDesignDayColor.* (dark) |
|---|---|---|---|
| bg | 0.0801, 0.0874, 0.0928 | `#141618` | bg |
| bgDeep | 0.0379, 0.0446, 0.0497 | `#0A0B0D` | bgDeep |
| bgDarker | 0.0252, 0.0291, 0.0322 | `#060708` | bgDarker |
| surface | 0.0544, 0.0614, 0.0666 | `#0E1011` | surface |
| surface2 | 0.0714, 0.0786, 0.0839 | `#121415` | surface2 |
| hover | 0.1407, 0.1524, 0.1611 | `#242729` | hover |
| selected | 0.1756, 0.1918, 0.2039 | `#2D3134` | selected |
| border | 0.1501, 0.1619, 0.1708 | `#26292B` | border |
| borderSoft | 0.1128, 0.1242, 0.1327 | `#1D1F22` | borderSoft |
| fg | 0.9410, 0.9490, 0.9550 | `#F0F2F4` | fg |
| fgSecondary | 0.7328, 0.7455, 0.7551 | `#BBBEC1` | fgSecondary |
| muted | 0.4865, 0.5055, 0.5198 | `#7C8185` | muted |
| mutedDeep | 0.3263, 0.3486, 0.3652 | `#53595D` | mutedDeep |
| accent | 0.2165, 0.8352, 0.6244 | `#37D59F` | accent |
| amber | 0.9364, 0.6955, 0.2742 | `#EFB146` | amber |
| rose | 0.9751, 0.4673, 0.4400 | `#F97770` | rose |

(Office Hours has no `sky` token; its palette stops at `rose`.)
Opacity variants: accentDim = accent·0.14, accentLine = accent·0.40, amberDim = amber·0.14.
`nsWindowBackground` = NSColor(0.0801,0.0874,0.0928) = `#141618`.

---

## 3. `IntakeV2Color` — Intake/onboarding V2 flow (theme-aware, re-exports Day palette)
File: `agentic30/IntakeV2FlowView.swift:15-58`. Mostly aliases to OpenDesignDayColor, but
adds several dark-theme `Color.white.opacity(...)` / `Color.black.opacity(...)` fills and
two distinct literal `terminalBg` values.
| Token | Dark value | White value |
|---|---|---|
| bg / bgDeep / panel / panelElevated / panelSubtle | = Day bg / bgDeep / surface / elevated / surface2 | same aliases |
| accent | = Day accent `#37D59F` | `#00834B` |
| accentBright | = Agentic30BrandColor.greenBright `#4BDE80` | `#00834B` |
| accentDim / accentLine | = Day accentDim / accentLine | same |
| warning | = Day amber `#EFB146` | `#EFB146` |
| textPrimary / textSecondary / textTertiary | = Day fg / fgSecondary / muted | same |
| textCardSecondary | fgSecondary·0.86 | fgSecondary·0.82 |
| monospaceMuted | = Day mutedDeep | same |
| border / borderSoft | = Day border / borderSoft | same |
| primaryButtonFill | `Color.white` (`#FFFFFF`) | = Day fg |
| primaryButtonText | `Color.black.opacity(0.86)` | = Day surface |
| disabledButtonFill | `white·0.10` | Day selected·0.74 |
| disabledButtonText | `white·0.34` | = Day muted |
| secondaryButtonFill | `white·0.06` | = Day surface2 |
| secondaryButtonText | `white·0.70` | = Day fgSecondary |
| cardFill | `white·0.03` | = Day surface |
| cardMutedFill | `white·0.02` | = Day surface2 |
| cardStroke | `white·0.08` | = Day borderSoft |
| cardShadow | `black·0.55` | `black·0.12` |
| cardShadowSoft | `black·0.35` | `black·0.08` |
| selectionDotEmpty | `white·0.22` | = Day borderStrong |
| invisibleHitArea | Day fg·0.001 | same |
| **terminalBg** | 0.039,0.039,0.047 → `#0A0A0C` | 0.985,0.989,0.992 → `#FBFCFD` |
| terminalStroke | `white·0.06` | = Day borderSoft |
| terminalCommand | `white·0.85` | = Day fg |
| terminalMuted | `white·0.40` | = Day muted |
| terminalPrompt | = Day accent | = Day accent |
| spinnerTrack | `white·0.16` | Day borderSoft·0.82 |

---

## 4. `Agentic30BrandColor` — brand green (theme-aware)
File: `agentic30/Agentic30BrandColor.swift:91-102`
| Token | Dark | White |
|---|---|---|
| green | = OpenDesignDayColor.accent `#37D59F` | `#00834B` |
| greenBright | 0.294, 0.871, 0.502 → `#4BDE80` | 0.0000, 0.5144, 0.2936 → `#00834B` |

---

## 5. `MacOnboardingTheme` — first-run onboarding (theme-aware, re-exports Day palette)
File: `agentic30/MacOnboardingView.swift:4-22`. Aliases Day palette + white/black opacity
fills + `OpenDesignInk` for primary text.
| Token | Dark | White |
|---|---|---|
| bg / surface / surfaceSubtle | = Day bg / surface / surface2 | same |
| text / secondaryText / tertiaryText | = Day fg / fgSecondary / muted | same |
| border | = Day borderSoft | same |
| accent | = Day accent `#37D59F` | `#00834B` |
| primaryFill | `Color.white` | = Day fg |
| primaryText | = OpenDesignInk.onLightStrong `#2A2A2A` | = Day surface |
| disabledFill | `white·0.34` | Day selected·0.74 |
| disabledText | = OpenDesignInk.onLightMuted (`#2A2A2A`·0.42) | = Day muted |
| secondaryFill | `white·0.08` | = Day surface2 |
| secondaryButtonText | `white·0.78` | = Day fgSecondary |
| badgeFill | `black·0.32` | `white·0.78` |
| visualText | `white·0.92` | = Day fg |
| visualSecondaryText | `white·0.72` | = Day fgSecondary |

---

## 6. `OpenDesignInk` — near-black ink for text on light CTA fills
File: `agentic30/OpenDesignTokens.swift:85-88`. **Never pure #000** (StyleSeed rule).
| Token | sRGB | HEX / rgba |
|---|---|---|
| onLightStrong | 0.165, 0.165, 0.165 | `#2A2A2A` |
| onLightMuted | 0.165, 0.165, 0.165 · opacity 0.42 | `rgba(42,42,42,0.42)` |

---

## 7. `OpenDesignShadow` — shadow language (theme-aware; dark → transparent)
File: `agentic30/OpenDesignTokens.swift:69-81`. Shadows are black-based; on DARK they go
`.clear` (dark uses hairline borders, not glows).
| Token | Dark | White |
|---|---|---|
| cardColor | `Color.clear` | `black·0.05` |
| elevatedColor | `Color.clear` | `black·0.08` |
(cardRadius 3 / cardY 1; elevatedRadius 12 / elevatedY 4.)

---

## 8. `OpenDesignReferenceTone` — reference-page tone enum (adds 3 unique hexes)
File: `agentic30/OpenDesignReferencePages.swift:218-243`. String-keyed tone → color;
accent/amber/rose/sky/muted alias the Day palette, but violet/teal/pink are **distinct
literals unique to this enum** (different from Day palette violet/etc.).
| Tone | sRGB | HEX | Notes |
|---|---|---|---|
| accent | = Day accent | `#37D59F` | alias |
| amber | = Day amber | `#EFB146` | alias |
| rose | = Day rose | `#F97770` | alias |
| sky | = Day sky | `#58C5F5` | alias |
| **violet** | 0.690, 0.520, 0.980 | `#B085FA` | distinct (≠ Day violet `#C789F5`) |
| **teal** | 0.230, 0.780, 0.760 | `#3BC7C2` | distinct |
| **pink** | 0.960, 0.500, 0.760 | `#F580C2` | distinct |
| muted | = Day muted | `#7C8185` | alias |
Variants: `dim` = color·0.14, `line` = color·0.38.

---

## 9. `RealisticConfettiPaletteColor` — completion confetti (8 fixed brand-independent hexes)
File: `agentic30/ContentView.swift:15371-15437`. Ships an explicit `hex` string AND a
`Color(red:...)` — both listed; they match.
| Case | Declared hex | sRGB → computed HEX |
|---|---|---|
| cyan | `#26CCFF` | 0.149,0.800,1.000 → `#26CCFF` |
| purple | `#A25AFD` | 0.635,0.353,0.992 → `#A25AFD` |
| pink | `#FF5E7E` | 1.000,0.369,0.494 → `#FF5E7E` |
| lime | `#88FF5A` | 0.533,1.000,0.353 → `#88FF5A` |
| yellow | `#FCFF42` | 0.988,1.000,0.259 → `#FCFF42` |
| orange | `#FFA62D` | 1.000,0.651,0.176 → `#FFA62D` |
| magenta | `#FF36FF` | 1.000,0.212,1.000 → `#FF36FF` |
| brandGreen | `#4BDE80` | 0.294,0.871,0.502 → `#4BDE80` |

---

## 10. `MacOnboardingContextView` — context-capture screen accents (distinct literals)
File: `agentic30/MacOnboardingContextView.swift`. Local accent constants + hero gradients.
| Token (line) | sRGB | HEX |
|---|---|---|
| workModeAccent (312) | 0.82, 0.99, 0.69 | `#D1FCB0` |
| focusAreaAccent (313) | 0.82, 0.99, 0.69 | `#D1FCB0` |
| bottleneckAccent (314) | 0.82, 0.99, 0.69 | `#D1FCB0` |
| isolationAccent (315) | 0.66, 0.78, 0.91 | `#A8C7E8` |
| (label accent 92,127) | 0.96, 0.90, 0.66 | `#F5E6A8` |
Hero gradient stops (per-scene, lines 189-203) — see Gradients §.

---

## 11. `SceneColor` + onboarding scene gradients + intent-icon colors
File: `agentic30/MacOnboardingView.swift`. `SceneColor` (line 399) is a plain rgba struct
converted to `Color` at line 237. Distinct literals:
| Where (line) | sRGB | HEX |
|---|---|---|
| AssistantMark gradient top (450) | 0.92, 1.0, 0.90 | `#EBFFE6` |
| AssistantMark gradient bottom (451) | 0.28, 0.92, 0.32 | `#47EB52` |
| toggle capsule fill (493) | 0.26, 0.85, 0.54 | `#42D98A` |
| intent icon: chart (529) | 0.26, 0.62, 0.98 | `#429EFA` |
| intent icon: megaphone (530) | 0.95, 0.40, 0.32 | `#F26652` |
| intent icon: person.2 (531) | 0.55, 0.86, 0.42 | `#8CDB6B` |
| intent icon: envelope (532) | 0.92, 0.64, 0.20 | `#EBA333` |
Workspace-picker hero gradient (93-95) + scene gradients (370-393) — see Gradients §.

---

## 12. `BrandIcon` / asset-tile backgrounds (IntakeV2ShowcaseViews) — third-party brand plates
File: `agentic30/IntakeV2ShowcaseViews.swift` (enum `BrandIcon` :31-104 and
`assetBackground(for:)` :1564-1595). Fixed brand-plate fills (theme-independent):
| Brand | sRGB | HEX |
|---|---|---|
| GitHub | 0.051, 0.067, 0.090 | `#0D1117` |
| Discord | 0.345, 0.396, 0.949 | `#5865F2` |
| txt / folder / composite / symbol / AppleNotes | 0.322, 0.322, 0.357 | `#52525B` |
| Toss | 0.000, 0.392, 1.000 | `#0064FF` |
| Stripe | 0.388, 0.357, 1.000 | `#635BFF` |
| folder fg (icon) | 0.984, 0.749, 0.137 | `#FBBF23` |
| Notion tile | 0.098, 0.098, 0.098 | `#191919` |
| PostHog tile | 0.102, 0.102, 0.122 | `#1A1A1F` |
| Cursor / Instagram tile | 0.051, 0.051, 0.055 | `#0D0D0E` |
| Claude tile | 0.871, 0.792, 0.671 | `#DECAAB` |
| AWS tile | 0.091, 0.137, 0.190 | `#172330` |
| gdocs/gsheets/notion/posthog bg | `.white` | `#FFFFFF` |
| threads/paddle bg | `.black` | `#000000` |
Traffic-light dots (macOS window chrome, lines 2542-2544 / 2733-2735):
| Dot | sRGB | HEX |
|---|---|---|
| close (red) | 1.00, 0.373, 0.341 | `#FF5F57` |
| minimize (yellow) | 0.996, 0.737, 0.180 | `#FEBC2E` |
| zoom (green) | 0.157, 0.784, 0.251 | `#28C840` |
Terminal accent (2618/2686): 1.0,0.51,0.45 → `#FF827333`... actually `#FF8273`; and
1.0,0.29,0.24 → `#FF4A3D` (used at 0.10 / 0.25 opacity).

---

## 13. ContentView chat/live-status inline accents (distinct literals)
File: `agentic30/ContentView.swift`.
| Token (line) | sRGB | HEX | Notes |
|---|---|---|---|
| structuredChoiceAccent (14322) | 0.82, 0.89, 1.0 | `#D1E3FF` | office-hours structured prompt accent |
| inlineDecisionAccent (14327) | 0.482, 0.659, 0.565 | `#7BA890` | sage-cyan decision card (design-shotgun #7BA890) |
| blocked/warn orange (12796…13877, many) | 1.0, 0.67, 0.42 | `#FFAB6B` | "blocked" state warm accent, used ~18× at various opacities |
| chat accent variant (12671) | 0.54, 0.70, 1.0 | `#8AB3FF` | |
| chat accent variant (12673) | 0.92, 0.76, 0.44 | `#EBC270` | |
| structured text (14116,14254) | 0.82, 0.89, 1.0 | `#D1E3FF` | (matches structuredChoiceAccent) |
| pet pill gradient (14456-14457) | 0.64,0.58,0.42 / 0.53,0.48,0.35 | `#A3946B` / `#877A59` | wolf pet bubble, at ~0.96–0.98 opacity |
| pet bubble gradient (14474-14475) | 0.63,0.57,0.42 / 0.50,0.46,0.34 | `#A1916B` / `#807557` | |
`AssistantLiveStatusPanelTone` (12) is a two-case enum (`.floating` uses `white.opacity`
scale 0.48–0.92; `.surface` aliases Day fg/fgSecondary/muted/accent) — no new hexes.
NSColor mirrors of Day palette at lines 995-1014 (fg/accent/amber/bgDarker) — same hexes.

---

## 14. SettingsView inline accents (distinct literals)
File: `agentic30/SettingsView.swift`.
| Token (line) | sRGB | HEX | Notes |
|---|---|---|---|
| save-button text on accent (600) | 0.08, 0.12, 0.11 | `#14201C` | near-black on green CTA |
| white-theme amber text (2779) | 0.66, 0.46, 0.09 | `#A87517` | deepened amber for legibility on light |

---

## 15. Pure semantic tone enums (NO new hex — map to Day palette)
These enums exist for typing/logic and resolve to §1 tokens. Listed for completeness so the
React kit knows the semantic groupings that need variant props:
- `OpenDesignStrategyTone` (OpenDesignDayPageView:2964) — accent/sky/amber/rose
- `OpenDesignRailBadgeTone` (:3388) — accent/amber/sky
- `OpenDesignLockedMockTone` (:7306) — accent/amber/rose/sky/muted (+ dim = ·0.14, muted ·0.08)
- `BadgeTone` (:17080) — accent/amber/muted → foreground/background(dim)/border(line)
- `SurfaceDecisionTone` (:19419) — approve(accent)/reject(surface)
- `AssistantLiveStatusPanelTone` (ContentView:12) — floating(white·α)/surface(Day tokens)
- `OfficeHoursDigestSourceDotTone` (ContentView:154) — ready/warning/unavailable
- `MorningBriefingPageView.SectionEntry.Tone` (:227) — accent/amber/rose/ring(mutedDeep stroke)
- `MorningBriefingDrilldownView` string resolvers (:64 toneColor, :143 deltaColor,
  :75 sourceTone, :1162 draftBadgeColor) — map "amber/rose/violet/sky/muted/off" and
  up/down directions to Day palette; source badges: cloudflare→amber, posthog→violet, github→fg/accent.
- `MacOnboardingScene` intent map (MacOnboardingView:529-532) — the 4 icon hexes in §11.

---

## 16. Gradients (all stops enumerated)
Nearly every gradient is built from Day-palette tokens + opacity; only onboarding hero
gradients carry raw literals. Stops listed top→bottom / start→end.

### Raw-literal gradients
| Location | Type | Stops (sRGB → HEX, opacity) |
|---|---|---|
| MacOnboardingView:91-99 (workspace picker hero) | Linear TL→BR | `#0F1212` (0.06,0.07,0.07) · `#1F2924` (0.12,0.16,0.14) · `#7A704D` (0.48,0.44,0.30) |
| MacOnboardingView:369-373 (scene 1) | SceneColor | `#0F1212` · `#1C3829` (0.11,0.22,0.16) · `#66BD54`@0.75 (0.40,0.74,0.33) |
| MacOnboardingView:376-380 (scene 2) | SceneColor | `#141A17` (0.08,0.10,0.09) · `#59692F` (0.35,0.41,0.28) · `#CCBD85` (0.80,0.74,0.52) |
| MacOnboardingView:383-387 (scene 3) | SceneColor | `#141A17` · `#3D543D` (0.24,0.33,0.24) · `#B3A370` (0.70,0.64,0.44) |
| MacOnboardingView:390-394 (scene 4) | SceneColor | `#12131421`... `#121314` (0.07,0.075,0.08) · `#141417` (0.08,0.08,0.09) · `#212124` (0.13,0.13,0.14) |
| MacOnboardingView:449-453 (AssistantMark) | Linear TL→BR | `#EBFFE6` (0.92,1.0,0.90) · `#47EB52` (0.28,0.92,0.32) |
| MacOnboardingContextView:108-111 (mark) | Linear | `#EBFFE6` · `#47EB52` |
| MacOnboardingContextView:188-192 (scene A) | Linear | `#0F1212` · `#1C3829` · `#66BD54`@0.75 |
| MacOnboardingContextView:194-198 (scene B) | Linear | `#0F120D` (0.06,0.07,0.05) · `#3D4229` (0.24,0.26,0.16) · `#B3A370` (0.70,0.64,0.44) |
| MacOnboardingContextView:200-203 (scene C) | Linear | `#0D0F12` (0.05,0.06,0.07) · `#293340` (0.16,0.20,0.24) · `#7894B3` (0.47,0.58,0.70) |
| ContentView:14454-14462 (pet pill) | Linear TL→BR | `#A3946B`@0.96 · `#877A59`@0.98 |
| ContentView:14472-14479 (pet bubble) | Linear TL→BR | `#A1916B`@0.97 · `#807557`@0.98 |

### Token-derived gradients (no new hex; stops are Day tokens + α)
- OpenDesignDayPageView hero (13918): Linear bg·0.96 → bgDeep·0.94 → bgDarker.
- OpenDesignDayPageView radial glows (13927,13937,14101): accentDim·0.64→0.14→clear;
  sky·0.08/0.10→clear; accentDim·0.76→0.20→clear.
- OpenDesignDayPageView rail/card washes (13957,14031,14041,14080,14111,18337): railColor·α,
  surface2·α, accentDim·0.74 → surface·0.98 → bgDeep·0.92, etc.
- Day1SituationSummaryCard:148 & MorningBriefingPageView:1087 & OpenDesignReferencePages
  (11152,11171) & OpenDesignDayPageView:20954: Linear `surface → surface2` (top→bottom) — the
  standard card fill gradient.
- OpenDesignReferencePages:2212,5486 and IntakeV2ShowcaseViews:354: token-derived washes.

---

## 17. Rebuild notes for the React kit
1. **Two themes, dark default.** Emit `:root` (dark) + `[data-theme="white"]` overrides.
   Every §1 token has a white counterpart; §2 (Office Hours) is dark-locked by design.
2. **`accent` is the whole brand.** Dark `#37D59F` mint / white `#00834B` deep green. The
   `greenBright` (`#4BDE80`) is only for spinners/confetti, not the primary accent.
3. **dim = base·0.14, line = base·0.36–0.40.** Standardize as `--{tone}-dim` / `--{tone}-line`
   custom props via `color-mix(in srgb, var(--tone) 14%, transparent)`.
4. **Shadows: none on dark.** On dark, cards use `borderSoft` hairline; only white theme
   emits `box-shadow` (black·0.05 / 0.08). Do not port the SwiftUI glow.
5. **Text-on-light is `#2A2A2A`, never `#000`** (OpenDesignInk) — except two deliberate
   near-blacks: settings CTA `#14201C`, chip `black·0.86`.
6. **Distinct-hex sources to hardcode in the kit** (not derivable from Day palette): confetti
   8-color set (§9), reference violet/teal/pink (§8), onboarding scene/intent hexes (§10-11),
   third-party brand plates (§12), chat accents `#FFAB6B`/`#7BA890`/`#D1E3FF`/`#8AB3FF`/`#EBC270`
   (§13), settings `#A87517`/`#14201C` (§14).

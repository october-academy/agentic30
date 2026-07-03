# Founder OS Kit — BUILD MANIFEST

Master build plan consolidating the six-file source audit (`views.md`, `colors.md`,
`typography.md`, `layout.md`, `surfaces.md`, `icons.md`) against the current mirror build
state (`.design-sync/mirror/`) and the 27 captured e2e reference shots
(`.design-sync/reference-shots/`).

Goal: **every screen / component / color / font, exhaustively** reproduced in the React
mirror, verified 1:1 against the SwiftUI app.

Current build state (facts):
- **ds.css**: token layer built (dark palette only; no light theme, no spacing/breakpoint tokens).
- **tokens.ts**: `Tone` helper (`toneVars`) built.
- **28** primitive/molecule `.tsx` in `mirror/src/components/`.
- **12** reference-page `.tsx` in `mirror/src/components/reference/` (only `ProjectsReferencePage` is a full screen composition).
- **`index.ts`** exports 40 of the 40 built components; **no icon registry**, **no shell/screen host beyond ProjectsReferencePage**.
- **27** e2e PNG shots captured (see manifest.json for the source XCUITest per shot).

---

## 1. SCREEN BUILD LIST

Every user-reachable full surface from `views.md` (46 screens) + the non-Swift-only surfaces
from `surfaces.md`. Each tagged `[e2e-shot: yes/no]` by matching a PNG in `reference-shots/`.
**Screens with NO shot need an extended e2e capture run OR source-only reproduction** (flagged ⚠).

### A. Onboarding / Intake V2 (8-step wizard + legacy) — the live onboarding flow
| # | Screen | Swift source | e2e-shot | Note |
|---|---|---|---|---|
| 1 | Intake Step 1 — BOOT intro | `IntakeV2BootIntroView` | no ⚠ | source-only; animated boot terminal |
| 2 | Intake Step 2 — FOCUS AREA | `IntakeV2FocusAreaView` | no ⚠ | option-card question |
| 3 | Intake Step 3 — BOTTLENECK | `IntakeV2BottleneckView` | no ⚠ | option-card question |
| 4 | Intake Step 4 — COMMITMENT | `IntakeV2CommitmentView` | no ⚠ | |
| 5 | Intake Step 5 — EVIDENCE | `IntakeV2EvidenceView` | no ⚠ | |
| 6 | Intake Step 6 — FOLDER PICK | `IntakeV2FolderPickView` | no ⚠ | folder picker |
| 7 | Intake Step 7 — CONNECT showcase | `IntakeV2ConnectShowcaseView` | no ⚠ | add-source + RSS/OPML + brand plates |
| 8 | Intake Step 8 — READY / ANALYZE (scan) | `IntakeV2ReadyAnalyzeView` | no ⚠ | boot-log + scan preview + provider-limit notice |
| 9 | Intake flow container (progress bar) | `IntakeV2FlowView` | no ⚠ | shell wrapping steps 1–8 |
| 10 | Decide notification showcase | `DecideNotificationGroupView` | no ⚠ | swipe/execute mini-notif stack |
| 11 | Legacy onboarding hero | `MacOnboardingView` | no ⚠ | halftone hero + floating cards (legacy gen) |
| 12 | Legacy onboarding context capture | `MacOnboardingContextView` | no ⚠ | product/founder intake (legacy gen) |

### B. Main workspace — Day / Market / Today
| # | Screen | Swift source | e2e-shot | Matching PNG |
|---|---|---|---|---|
| 13 | Day workspace host (rail router) | `OpenDesignDayPageView` / `OpenDesignDayShell` | yes | `OpenDesign_Day_Initial_Wide.png` |
| 14 | Today / Day-1 main (interview/goal) | `OpenDesignDayMainView` | yes | `OpenDesign_Day_Initial_Wide.png` |
| 15 | Day alignment → office-hours route | (Day surface state) | yes | `OpenDesign_Day_Alignment_Routes_To_Office_Hours.png` |
| 16 | Day-2 Market main | `OpenDesignMarketMainView` | no ⚠ | keyword cloud / signal grid / alt matrix / post feed |
| 17 | Day-1 goal-selection stage | `OpenDesignDayGoalSelectionCard` | no ⚠ | full interactive stage |
| 18 | Day-1 hypothesis confirmation stage | `OpenDesignHypothesisConfirmationCard` | no ⚠ | |
| 19 | Interview step surface (in Day) | `OpenDesignInterviewStepView` | no ⚠ | question + option grid |
| 20 | Day step-workspace container | `OpenDesignDayStepWorkspaceView` | no ⚠ | header + stepper + body + footer |
| 21 | Day-1 situation-summary surface | `Day1SituationSummaryCard` | yes | `Day1_Situation_Seed_Routes_To_Office_Hours.png` |
| 22 | Cold-loading state surface | `OpenDesignColdLoadingStateView` | no ⚠ | skeleton rows |

### C. Office Hours (interview chat surface + daily cards)
| # | Screen | Swift source | e2e-shot | Matching PNG |
|---|---|---|---|---|
| 23 | Office Hours screen (composed) | `openDesignOfficeHoursScreenView` (ContentView func) | yes | `Office_Hours_SwiftUI_Q1_Active.png` |
| 24 | OH Q1 locked / awaiting Q2 | (OH state) | yes | `Office_Hours_SwiftUI_Q1_Locked_Awaiting_Q2.png` |
| 25 | OH Q1 locked / loader | (OH state) | yes | `Office_Hours_SwiftUI_Q1_Locked_Loader.png` |
| 26 | OH Q1 submitted / Q2 active | (OH state) | yes | `Office_Hours_SwiftUI_Q1_Submitted_Q2_Active.png` |
| 27 | OH running status | (OH state) | yes | `Office_Hours_SwiftUI_Running_Status.png` |
| 28 | OH document-review card (before commitments) | `OfficeHoursDaily*` | yes | `Office_Hours_Document_Review_Card_Before_Commitments.png` |
| 29 | OH commitment card (after docs) | `OfficeHoursCommitmentBarView` | yes | `Office_Hours_Commitment_Card_After_Docs.png` |
| 30 | OH commitment gate (requires confirmation) | `OfficeHoursDailyGateCardView` | yes | `Office_Hours_Commitment_Gate_Requires_Confirmation.png` |
| 31 | OH past-day customer-evidence review | (OH past-day) | yes | `Office_Hours_Past_Day_Customer_Evidence_Review.png` |
| 32 | OH unavailable / empty state | `OpenDesignOfficeHoursUnavailableView` | no ⚠ | |

### D. Founder Replay (densest screen — ~4000 lines, decompose heavily)
| # | Screen | Swift source | e2e-shot | Note |
|---|---|---|---|---|
| 33 | Founder Replay page | `OpenDesignFounderReplayPageView` | no ⚠ | recorder control + frame timeline + audit + FTS search + SQL console + MCP grants + export + retention + pipes |
| 34 | Locked Founder Replay mock | `OpenDesignLockedFounderReplayMockSurface` | no ⚠ | blurred lock preview |

### E. Strategy
| # | Screen | Swift source | e2e-shot | Matching PNG |
|---|---|---|---|---|
| 35 | Strategy page | `OpenDesignStrategyPageView` | yes | `Strategy_Screen.png` |
| 36 | Strategy positioning matrix (initial) | `StrategyPositioningMatrixView` | yes | `Strategy_Matrix_Initial_Visual_QA.png` |
| 37 | Strategy matrix (competitor selected — Cursor) | `StrategyMatrixDetailPanel` | yes | `Strategy_Matrix_Cursor_Visual_QA.png` |
| 38 | Locked Strategy mock | `OpenDesignLockedStrategyMockSurface` | no ⚠ | |

### F. Morning Briefing
| # | Screen | Swift source | e2e-shot | Matching PNG |
|---|---|---|---|---|
| 39 | Morning Briefing page | `MorningBriefingPageView` | yes | `Morning_Briefing_Screen.png` |
| 40 | Briefing drilldown — GitHub | `MorningBriefingDrilldownView` | yes | `Morning_Briefing_Drilldown_GitHub.png` |
| 41 | Briefing drilldown — PostHog | `MorningBriefingDrilldownView` | yes | `Morning_Briefing_Drilldown_PostHog.png` |
| 42 | Briefing failed-source states | (briefing states) | yes | `Morning_Briefing_Failed_Source_States.png` |
| 43 | Locked Morning Briefing mock | `OpenDesignLockedMorningBriefingMockSurface` | no ⚠ | |

### G. Reference pages (via `OpenDesignReferenceShell`)
| # | Screen | Swift source | e2e-shot | Matching PNG |
|---|---|---|---|---|
| 44 | Projects reference page | `OpenDesignProjectsShell` | yes | `OpenDesign_Projects_Wide.png` |
| 45 | Interviews reference page | `OpenDesignInterviewsShell` | yes | `OpenDesign_Interviews_Wide.png` |
| 46 | Public-record / BIP Log page | `OpenDesignBipLogShell` | yes | `OpenDesign_BIP_Wide.png` |
| 47 | News / Market-Radar page | `OpenDesignNewsShell` / `NewsMarketRadarMainView` | yes | `OpenDesign_News_Wide.png` |
| 48 | News preparing / progress state | `NewsMarketRadarProgressState` | yes | `OpenDesign_News_Preparing_Progress.png` |
| 49 | History / Retrospective page | `OpenDesignHistoryShell` | no ⚠ | stats sidebar + retrospective cards + evidence timeline |
| 50 | Generic reference page (fallback) | `OpenDesignReferenceMainView` | no ⚠ | banner/calendar/metrics/rows/cards/timeline block styles |
| 51 | Locked News mock | `OpenDesignLockedNewsMockSurface` | no ⚠ | |
| 52 | Generic locked-rail mock | `OpenDesignLockedRailMockPreview` / `OpenDesignLockedRailFeaturePreview` | no ⚠ | |

### H. Settings (real + reference mock)
| # | Screen | Swift source | e2e-shot | Matching PNG |
|---|---|---|---|---|
| 53 | Settings — model pickers | `SettingsView` (providers section) | yes | `01_Settings_Model_Pickers.png` |
| 54 | Settings — models saved | `SettingsView` (providers section) | yes | `02_Settings_Models_Saved.png` |
| 55 | Settings — MCP integrations (compact) | `SettingsView` (integrations section) | yes | `Settings_MCP_Integrations_Compact.png` |
| 56 | Settings — appearance/workspace/menubar/privacy/updates/advanced | `SettingsView` (6 other `SettingsSection` cases) | no ⚠ | 6 of 8 sections uncaptured |
| 57 | Settings reference mock | `OpenDesignSettingsReferenceShell` | no ⚠ | design-reference variant |

### I. Chrome / overlays / menubar (app-frame surfaces)
| # | Screen | Swift source | e2e-shot | Note |
|---|---|---|---|---|
| 58 | Root routing view (app frame) | `ContentView` | partial | window chrome present in every wide shot |
| 59 | Menu-bar dropdown | `StatusMenuContent` | no ⚠ | always-present menubar surface |
| 60 | Search command palette (⌘) | `OpenDesignSearchPaletteView` | no ⚠ | modal overlay over any surface |
| 61 | BIP mission workspace route | `bipMissionWorkspaceSurface()` (ContentView func) | no ⚠ | BIP coach mission surface |

### J. Non-Swift-only surfaces (from `surfaces.md`) — separate/optional scope
| # | Screen | Source | e2e-shot | Note |
|---|---|---|---|---|
| 62 | Competitive positioning 2×2 matrix | `competitive-matrix.html` | no ⚠ | standalone strategy viz, no SwiftUI counterpart; optional scope |
| 63 | Day-1 "first sentence" surface | `day1-first-surface.md` (PRD) | no ⚠ | **unbuilt on every surface** — proposal-preview + bundle-review approve/reject; future design |

**Shot coverage summary:** 27 PNGs cover **~24 distinct screens** (13/14/21, 23–31, 35–37, 39–42, 44–48, 53–55 — several PNGs share a screen). **~39 of 63 screens have NO e2e shot** (all ⚠). The biggest uncaptured surfaces: entire **Intake V2 flow (12)**, **Founder Replay (33)**, **Market (16)**, all **locked mocks (34/38/43/51/52)**, **History (49)**, **6/8 Settings sections (56)**, and all **chrome/overlay/menubar (58–61)**. These require an **extended e2e capture pass** (they are reachable in-app) or careful **source-only reproduction** from the Swift structs.

---

## 2. COMPONENT VOCABULARY

`views.md` classifies **283 reusable components** (275 view + 8 ViewModifier). Below is the
consolidated component vocabulary the kit must cover, grouped by family, with `[built]`/`[todo]`
by matching an existing `.tsx` in the mirror. The mirror currently ships **40** components
(28 primitive/molecule + 12 reference), most of which are consolidations of many Swift structs
(e.g. one `<MetaPanel>` covers 8 Swift `*MetaPanelView`s per the "collapse into shared" strategy).

### Built primitives & molecules (28) — all `[built]`
`Button` [built] · `Badge` [built] · `Chip` [built] · `Input` [built] · `Toggle` [built] ·
`Segmented` [built] · `IconButton` [built] · `Avatar` [built] · `SectionHeader` [built] ·
`Spinner` [built] · `ProgressBar` [built] · `ProgressRing` [built] · `Sparkline` [built] ·
`SourcePill` [built] · `DashPagination` [built] · `Card` [built] · `StatCard` [built] ·
`MetricPill` [built] · `ListRow` [built] · `KVRow` [built] · `OptionCard` [built] ·
`QuestionCard` [built] · `StateCard` [built] · `DebtBanner` [built] · `Stepper` [built] ·
`ProviderCard` [built] · `ArticleCard` [built] · `TimelineRow` [built]

### Built reference-page renderer (12) — all `[built]`
`Rail` [built] · `SideRow` [built] · `ReferenceSidebar` [built] · `Titlebar` [built] ·
`ReferenceHeader` [built] · `FilterTabs` [built] · `RefSection` [built] · `MetaPanel` [built] ·
`ReferenceShell` [built] · `PhaseGateRow` [built] · `DayCalendar` [built] ·
`ProjectsReferencePage` [built, screen composition]

### Missing shared primitives / infra — `[todo]`
- **`Icon` registry** `[todo]` — **the single largest gap.** `icons.md`: 176 distinct SF Symbols, ~590 sites, many dynamic (`item.systemImage`, ternaries, helper maps). Needs `<Icon name="chevron.right"/>` keyed by exact SF Symbol string + `icons.ts` registry (Lucide base + ~15 hand-authored SF-specific glyphs). No icon component exists (IconButton takes a `ReactNode`).
- **`WorkspaceShell`** `[todo]` — the uniform 3-column shell (`rail | sidebar | main | meta`) driving every Day/Market/Strategy/Briefing/Reference screen (`OpenDesignDayLayoutMetrics`). ReferenceShell exists but only for reference pages; the responsive Day-shell (48/52 rail, 200/220/240 sidebar, 252/280 meta, breakpoints 860/1100/1280) is not built.
- **`SurfaceState`** `[todo]` — shared `kind="cold|loading|empty|error|unavailable"` collapsing the per-surface state views (News/BIP/History/OH/generic). `StateCard` covers empty/error but not cold/loading/unavailable variants or the surface-sized layouts.
- **`Eyebrow`** `[todo]` — mono uppercase tracked label (recipe in `typography.md` §5). A `.ds-eyebrow` CSS helper exists in ds.css but no component.
- **`Metric` (value+unit ~2:1)** `[todo]` — rounded value + half-size unit pairing (`typography.md` §4). `MetricPill`/`StatCard` partially cover.

### Missing component families — `[todo]` (by screen family; each is a cluster of Swift structs)
- **Intake V2 chrome** `[todo]` — `IntakeV2Header`, `IntakeV2Footer`, `IntakeV2OptionCard`, `IntakeV2PinnedStepScaffold`, `IntakeV2DashPagination`(≈ built DashPagination), `IntakeV2ActivitySpinner`, `BrandIconTile`, `ReadIconGrid`, `DecideMiniNotif`, `ExecuteTaskList`, `IntakeV2AddSourceModal`, `IntakeSourceIconTile`, `IntakeV2BootLogElapsedChip`, `ScanPreviewSlotBackground`, `ScanPreviewGlowingBorderTrace`, `DotPulse`, `Agentic30AppIcon`.
- **Legacy onboarding** `[todo]` — `AssistantMark`, `FloatingBriefingBubble`, `FloatingMilestoneCard`, `IntegrationIconRow`, `HalftoneField`, `HalftoneFieldDots`.
- **Titlebars (7 variants)** `[todo]` — Market/Day/OfficeHours/FounderReplay/Strategy/LockedRail/Reference → one `<Titlebar surface=…>` (reference `Titlebar` built; the 6 workspace variants not).
- **Rail (workspace)** `[todo]` — `OpenDesignRailView`, `OpenDesignRailButton`, `OpenDesignRailTooltip` (reference `Rail` built; the workspace rail with lock/new-dot/status badges not).
- **Day/Today surface** `[todo]` — `OpenDesignTaskSidebarView`, `OpenDesignTaskGroupHeader`, `OpenDesignTaskRow`, `OpenDesignDayHeader`, `OpenDesignStepper`(≈Stepper), `OpenDesignStepFooter`, `OpenDesignQuestionOptionGrid`, `OpenDesignQuestionOptionTile`, `OpenDesignMetaPanelView`, `OpenDesignChoiceSummaryPanel`, `OpenDesignCompletionChecklist`, `OpenDesignHandoffActionButton`, `OpenDesignGhostActionButton`, + card/button backgrounds.
- **Market (Day-2)** `[todo]` — `OpenDesignMarketHeader/SourceTabs/KeywordCloud/SignalGrid/SignalCardView/Sparkline/AlternativeMatrix/AlternativeRow/FitBar/TagGroup/GapCard/PostFeed/PostRow/MetaPanelView` (16).
- **Strategy** `[todo]` — `StrategyBusinessCanvasMatrixView/CanvasBlockView/SWOTCardView/PositioningMatrixView/MatrixDetailPanel/MatrixScoreBar/MatrixCompetitorButton/CriterionRowView/SummaryTileView/ResearchStatusBanner` + backgrounds (18).
- **News / Market Radar** `[todo]` — `NewsMarketRadar*` (22): sidebar/header/filter/lane-group/card/detail-row/source-row/meta-panel/recommendation + cold/progress/empty/error/failure states.
- **BIP Log** `[todo]` — `OpenDesignBip*` (18): sidebar/source-row/signal-row/main/header/filter/brief-card/metric-pill/candidate-card/draft-panel + empty/progress states.
- **News reference page** `[todo]` — `OpenDesignNews*` (17): sidebar/main/header/filter/takeaway-hero/article-card/footer/value-tag/meta-panel/coverage-row/source-pill.
- **Settings** `[todo]` — `OpenDesignSettings*` (16) + real `SettingsView` sections; `ProviderCard` built covers provider list partially.
- **Interviews reference** `[todo]` — `OpenDesignInterview*` (12): sidebar/row/main/meta-panel/signal-card/quote-row/theme-row/upcoming-row.
- **History reference** `[todo]` — `OpenDesignHistory*` (23): sidebar/stat-row/focus-row/retrospective-card/insight-card/risk-row/evidence-timeline/day-group/area-card + GitHub-required/empty states.
- **Projects reference** `[todo — partial]` — `ProjectsReferencePage` built; the ~33 `OpenDesignProject*` sub-pieces (overview-card/progress-ring/day-strip/day-cell/phase-bar/gate-list/basics-card/kv-list/path-card/doc-list/timeline/workflow-card/danger-zone/health-card/meta-panel) may be inlined — verify decomposition.
- **Morning Briefing** `[todo]` — `MorningBriefingSourceSparkline` + the 3-column page + `MorningBriefingDrilldownView` data-driven blocks.
- **Office Hours** `[todo]` — `OfficeHours*` (many): 9 typewriter/reveal text components, `CommitmentBarView`, `DailyStateTransitionCardView`, `DailyWorkpackCardView`, `DailyScoreboardCardView`, `DailyGateCardView`, `PreviousCommitmentResolutionCard`, `RealisticConfettiBurst/Host`, loader orb/line + 3 evidence/replacement sheets (subviews).
- **Founder Replay** `[todo]` — no components extracted yet; whole ~4000-line surface (recorder/timeline/audit/SQL/MCP/export/retention/pipes) to decompose.
- **Generic reference block styles** `[todo]` — `OpenDesignReferenceBlockView` variants (banner/calendar/metrics/rows/cards/timeline/articles/quotes/diff/settings/draft/heatmap) → covered partly by `RefSection`/`DayCalendar`; verify all block kinds.
- **8 ViewModifier behavior primitives** `[todo]` — hover-row, staged-reveal, return-shortcut, search-pulse, offset-opacity, option-row-surface, goal-option-surface → React hooks/wrappers.
- **Theme applicator** `[todo]` — `Agentic30ThemeApplicator` → `data-theme` switch (blocked on light-theme tokens, see §3).

---

## 3. TOKEN / COLOR / FONT COVERAGE

Cross-check of every color namespace + distinct font + layout metric from the audit against
`ds.css`. `missingFromDsCss` = present in the audit but absent from `ds.css`.

### 3.1 Color namespaces (from `colors.md`, 16 sections)
| # | Namespace | In ds.css? | Note |
|---|---|---|---|
| 0 | `Agentic30Theme` window bg (dark/white) | dark only | white `#F7F9FB` missing |
| 1 | `OpenDesignDayColor` (dark base) | ✅ yes | all dark base tokens present |
| 1 | `OpenDesignDayColor` white counterparts | ❌ **missing** | **entire light theme absent** |
| 1 | `violet` derived (dark) | ✅ `--ds-violet` | white missing |
| 1 | opacity variants dim/line | ✅ mostly | `magenta-line`, `orange-line` missing (only -dim shipped) |
| 2 | `OpenDesignOfficeHoursColor` (dark-only) | ✅ (= day dark) | covered by day tokens |
| 3 | `IntakeV2Color` | ✅ partial | dark intake tokens present; `accentBright`/white-theme intake missing |
| 4 | `Agentic30BrandColor` (green/greenBright) | ✅ `--ds-accent-bright` | white `#00834B` missing |
| 5 | `MacOnboardingTheme` | ❌ **missing** | badgeFill/visualText/visual-secondary + white counterparts |
| 6 | `OpenDesignInk` | ✅ `--ds-ink-strong/-muted` | present |
| 7 | `OpenDesignShadow` | ✅ (as box-shadow) | white-theme shadow variants not conditionalized |
| 8 | `OpenDesignReferenceTone` violet/teal/pink | ✅ teal/pink | ref-`violet` `#B085FA` (≠ day violet) **missing** — ds.css only has day violet `#C789F5` |
| 9 | `RealisticConfettiPaletteColor` (8 hexes) | ❌ **missing** | cyan/purple/pink/lime/yellow/orange/magenta/brandGreen confetti set |
| 10 | `MacOnboardingContextView` accents | ❌ **missing** | `#D1FCB0`/`#A8C7E8`/`#F5E6A8` + hero gradients |
| 11 | `SceneColor` + onboarding scene/intent hexes | ❌ **missing** | `#EBFFE6`/`#47EB52`/`#42D98A` + 4 intent-icon hexes |
| 12 | `BrandIcon` third-party brand plates | ❌ **missing** | GitHub/Discord/Toss/Stripe/Notion/PostHog/Claude/AWS/Cursor tiles + traffic-light dots |
| 13 | ContentView chat/live-status inline accents | ❌ **missing** | `#FFAB6B`/`#7BA890`/`#D1E3FF`/`#8AB3FF`/`#EBC270` + pet-pill gradients |
| 14 | SettingsView inline accents | ❌ **missing** | `#14201C` (CTA text), `#A87517` (white-theme amber) |
| 15 | Pure semantic tone enums | ✅ (map to day) | no new hex |
| 16 | Gradients (raw-literal onboarding) | ❌ **missing** | all onboarding hero/scene gradient stops |
| — | `--ds-faint` 5th ink level (`#4F555C`, mockups/surfaces.md §1) | ❌ **missing** | mockups define a 5th grey below mutedDeep |
| — | low-alpha accent washes `0.08`/`0.10` (competitive-matrix) | ❌ **missing** | `--accent-wash` / `--accent-wash-strong` |

### 3.2 Fonts (from `typography.md`)
| Font stack | In ds.css? | Note |
|---|---|---|
| `--font-sans` (SF Pro Text) | ✅ `--ds-sans` | present |
| `--font-mono` (SF Mono) | ✅ `--ds-mono` | present |
| **`--font-rounded` (SF Pro Rounded)** | ❌ **missing** | **241 rounded uses** (KPI/hero numbers, pills) — `typography.md` §3b/§7 requires it; NOT in ds.css |
| Full inline px ladder (7…78, half-points) | ❌ **missing** | ds.css ships only the 9 named role sizes; the 43-step inline ladder (10.5/11.5/12.5 etc.) absent — needed for pixel-faithful migrated surfaces |
| Weight tokens (300–800) | ❌ (implicit) | no weight custom-props; map regular400/medium500/semibold600/bold700/heavy800/light300 |
| Tracking/kerning scale (§5) | ❌ **missing** | eyebrow 0.08–0.12em + negative −0.01em for large sans not tokenized (`.ds-eyebrow` hardcodes 0.08em) |

### 3.3 Layout metrics (from `layout.md`)
| Metric group | In ds.css? | Note |
|---|---|---|
| Radius scale (chip/control/card/pill) | ✅ | present |
| **Special radii `--r-modal:34` / `--r-bar:2`** | ❌ **missing** | onboarding modal (34), active-indicator bars (2) — `layout.md` §3 flags as intentional, not drift |
| **Spacing scale (space-0…space-16)** | ❌ **missing** | no spacing custom-props at all; `layout.md` §4 defines 16-step scale (0/2/4/6/8/10/12/14/16/18/20/24/28/36/56) |
| **Pane-width tokens** (rail 48/52, sidebar 200/220/240, meta 252/280, main-max 1180/1080/820/668) | ❌ **missing** | `layout.md` §2; needed for shells |
| **Breakpoints** (620/640/740/860/900/1040/1100/1120/1180/1280) | ❌ **missing** | `layout.md` §2E; no CSS breakpoint tokens |
| **Bar/header heights** (titlebar 36, header 40/42, rail hit-box 36, etc.) | ❌ **missing** | `layout.md` §5 |
| Motion (dur fast/normal/slow + snap ease) | ✅ | present |
| Shadow (card/elevated) | ✅ | present (dark→hairline rule not conditionalized) |
| Border widths (1 / 1.5 contrast) | ❌ **missing** | `--border-w` / contrast 1.5 not tokenized |
| Window/modal sizes (1360×820, 1080×720, 716×676) | ❌ (app-level) | not needed as CSS tokens; reference in shell components |

---

## 4. GAP ANALYSIS (prioritized to reach "every screen/component/color/font, exhaustively")

**P0 — foundation blockers (nothing faithful ships without these):**
1. **Build the `Icon` registry** (`icons.md`): `<Icon name>` keyed by exact SF Symbol string + `icons.ts` map (Lucide base + ~15 hand-authored SF glyphs) + dev-mode loud fallback. 176 symbols, ~590 sites, many dynamic — every screen depends on it. **Largest single gap.**
2. **Add the missing font stack `--font-rounded`** + the full inline px ladder (half-points) + weight/tracking tokens to ds.css. 241 rounded uses (all KPI/hero numbers) currently have no stack.
3. **Add layout tokens to ds.css**: spacing scale (16 steps), pane-widths, breakpoints, bar heights, special radii (34/2), border-width/contrast. Shells cannot be built faithfully without them.
4. **Build `WorkspaceShell`** (responsive 3-column Day-shell: rail 48/52 + sidebar 200/220/240 + main-max 1180 + meta 252/280, breakpoints 860/1100/1280) — every Day/Market/Strategy/Briefing/Reference screen re-uses it.
5. **Build `SurfaceState`** (cold/loading/empty/error/unavailable) — every data surface ships all five; only empty/error partially exist via StateCard.

**P1 — theme + palette completeness (`colors.md` deltas):**
6. **Ship the entire light theme** (`[data-theme="white"]` block): `OpenDesignDayColor` white counterparts, accent `#00834B` (STYLESEED light `#008447` — reconcile), IntakeV2/BrandColor/MacOnboardingTheme white values, white-theme window bg `#F7F9FB`, white shadow variants. Blocks `Agentic30ThemeApplicator`.
7. **Add the missing dark hexes** to ds.css: `--ds-faint` (#4F555C), `magenta-line`/`orange-line`, reference-tone `violet` (#B085FA, distinct from day violet), low-alpha accent washes (0.08/0.10), confetti 8-color set, third-party brand plates + traffic-light dots, chat accents (#FFAB6B/#7BA890/#D1E3FF/#8AB3FF/#EBC270), settings inline (#14201C/#A87517), MacOnboardingContext accents, onboarding scene/intent hexes + raw-literal gradients.
8. **Resolve the 4 audit deltas** (`surfaces.md`): accent-on-fill ink (`#141618` page-color vs `#2A2A2A` — kit currently uses `#141618`, matches rendered; keep + document), severity-Dim alpha (0.13 vs 0.14 — standardize; ds.css uses 0.14), token naming (kit `--ds-*` chosen — good), motion ease (promise-card's `.4,0,.2,1` collapse vs Snap).

**P2 — screen/component build-out (largest volume; sequence by shot availability):**
9. **Shot-backed screens first** (verify 1:1 against PNGs): Day/Today (13–15), Office Hours all states (23–31), Strategy (35–37), Morning Briefing (39–42), Projects/Interviews/BIP/News reference (44–48), Settings model/MCP (53–55). Build their component families (Day, OH, Strategy, Briefing, News/BIP/Interviews/Projects reference clusters — ~150 Swift structs).
10. **Non-shot reachable screens** (need extended e2e capture OR source-only): **Intake V2 12 screens**, **Market (16)**, **Founder Replay (33, ~4000 lines — decompose)**, **History (49)**, **6/8 Settings sections (56)**, all **locked mocks (34/38/43/51/52)**, **generic reference (50)**.
11. **Chrome/overlays**: Titlebar 6 workspace variants, workspace Rail (lock/new-dot/badges), `StatusMenuContent` menubar, `OpenDesignSearchPaletteView`, BIP mission route, root `ContentView` app frame.
12. **8 ViewModifier behaviors** → React hooks/wrappers (hover-row, staged-reveal, return-shortcut, search-pulse, offset-opacity, option/goal surfaces).

**P3 — optional / future scope (`surfaces.md`):**
13. **Competitive positioning 2×2 matrix** (`competitive-matrix.html`) — standalone viz, only if the kit wants a positioning-chart component (nodes + detail panel + metric bars + pulsing anchor + legend).
14. **Day-1 "first sentence" surface** (`day1-first-surface.md`) — unbuilt PRD screen (proposal-preview + bundle-review approve/reject); design from scratch.
15. **Recover the missing `agentic30-interview-card-q01.html`** intent via QuestionCard + office-hours-ia (referenced in DESIGN.md but absent from repo).

**Extended e2e capture recommendation:** run an extended XCUITest capture pass to shoot the **~39 uncaptured reachable screens** (Intake V2, Market, Founder Replay, History, remaining Settings sections, locked mocks, menubar, search palette) so every built screen has a pixel reference — matching how the existing 27 shots back the shot-backed screens.

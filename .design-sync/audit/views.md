# Agentic30 — SwiftUI View Audit (for "Founder OS Kit" React rebuild)

Source of truth: `agentic30/*.swift`. Total `struct X: (View|ViewModifier)` declarations grepped: **333** (exhaustive — every one is classified in the tables below).

Breakdown of the 333 hits:
- **325** are true `struct X: View` structs.
- **8** are `struct X: ViewModifier` behavior primitives (listed under Components at the end, tagged as ViewModifiers).

Classification totals (every one of the 333 appears in exactly one table below):
- **SCREENS: 46**
- **COMPONENTS: 283** (= 275 view components + 8 ViewModifier behavior primitives)
- **SUBVIEWS: 4**
- **TOTAL: 333**

The Screens/Components/Subviews split is by design-system *role*, not by Swift access level — most components are `private struct`s but are reused throughout their screen family (every `*Card`, `*Row`, `*Header`, `*MetaPanel`, `*Button`, `*Pill`, `*State` piece), so they are components for a React rebuild. Only the handful of one-off modal/preparing helpers bound to a single screen instance are Subviews.

---

## SCREEN INVENTORY (every full surface a user can reach)

The app is a menu-bar Mac app. The top-level scene is a single `Window("Agentic30", id:"workspace")` plus a `MenuBarExtra`. `ContentView.rootContent` picks the outermost surface:

1. **Menu bar dropdown** — `StatusMenuContent` (agentic30App.swift). The always-present menubar surface.
2. **Onboarding / Intake flow** (`viewModel.requiresMacOnboarding == true`) → `IntakeV2FlowView`, an 8-step wizard. Each step is its own full screen:
   - **Step 1 BOOT** — `IntakeV2BootIntroView`
   - **Step 2 FOCUS AREA** — `IntakeV2FocusAreaView`
   - **Step 3 BOTTLENECK** — `IntakeV2BottleneckView`
   - **Step 4 COMMITMENT** — `IntakeV2CommitmentView`
   - **Step 5 EVIDENCE** — `IntakeV2EvidenceView`
   - **Step 6 FOLDER PICK** — `IntakeV2FolderPickView`
   - **Step 7 CONNECT (sources showcase)** — `IntakeV2ConnectShowcaseView`
   - **Step 8 READY / ANALYZE (workspace scan)** — `IntakeV2ReadyAnalyzeView`
3. **Legacy onboarding surfaces** (still present, drive the "story" onboarding): `MacOnboardingView`, `MacOnboardingContextView`.
4. **Main workspace** (`selectedSession` present, `.workspace` surface) → `OpenDesignDayPageView` wrapping `OpenDesignDayShell`. `OpenDesignDayShell` is the rail-based router; it switches its right-hand surface between these reachable screens (rail = `OpenDesignRailView`):
   - **Today / Day page** (default) — `OpenDesignDayMainView` (Day-1 interview/goal workspace) or `OpenDesignMarketMainView` (Day-2 market surface)
   - **Office Hours** — `openDesignOfficeHoursScreenView` (ContentView-composed; the interview chat surface)
   - **Founder Replay** — `OpenDesignFounderReplayPageView`
   - **Strategy** — `OpenDesignStrategyPageView`
   - **Morning Briefing** — `MorningBriefingPageView` (+ drilldown `MorningBriefingDrilldownView`)
   - **Reference pages** (via `OpenDesignReferenceShell` → per-page shell):
     - **Projects** — `OpenDesignProjectsShell`
     - **Settings** — `SettingsView` (embedded) / `OpenDesignSettingsReferenceShell` (reference mock)
     - **Interviews** — `OpenDesignInterviewsShell`
     - **Public record / BIP Log** — `OpenDesignBipLogShell`
     - **News (Market Radar)** — `OpenDesignNewsShell`
     - **History / Retrospective** — `OpenDesignHistoryShell`
     - **Generic reference page** — `OpenDesignReferenceShell` fallback (`OpenDesignReferenceMainView`)
   - **Locked-rail preview** (feature not yet unlocked) — `OpenDesignLockedRailFeaturePreview` hosting one of: `OpenDesignLockedFounderReplayMockSurface`, `OpenDesignLockedNewsMockSurface`, `OpenDesignLockedMorningBriefingMockSurface`, `OpenDesignLockedStrategyMockSurface`, `OpenDesignLockedRailMockPreview`.
5. **Standalone Settings window content** — `SettingsView` (also reachable embedded in the workspace, see above).
6. **BIP mission completion route** — `bipMissionWorkspaceSurface()` (ContentView; hosts the BIP coach mission surface inside the workspace).
7. **Search palette overlay** — `OpenDesignSearchPaletteView` (⌘-search modal over any workspace surface).
8. **Reference "showroom" shells** (design reference / catalog surfaces reachable via rail during dogfooding): `OpenDesignReferenceShell`, `OpenDesignNewsShell`, `NewsMarketRadarMainView` (the live News/Market-Radar surface).

Route/rail enums that drive the above:
- `OpenDesignRailSurfaceKind` (OpenDesignDayPageView.swift:2151): `today | officeHours | founderReplay | morningBriefing | strategy | reference(OpenDesignReferencePageKind)`.
- `OpenDesignRailDestination` (:2204): same shape, resolves `activeRailItemID`.
- `OpenDesignRailFeature` (:2344): `founderReplay | strategy | news | morningBriefing` (rail items with unlock gates: requiredCompletedDay + requiredStep).
- `OpenDesignReferencePageKind` (OpenDesignReferencePages.swift:3): `projects | settings | interviews | bipLog | news | history`.
- `OpenDesignDayContent.RailItem.Route` (:31): `today | search | officeHours | founderReplay | morningBriefing | strategy | settings | inert`.
- `OpenDesignLockedRailMockSurfaceKind` (:7258): mock surface kinds for locked previews.
- `SettingsSection` (SettingsView.swift:4): `appearance | workspace | menubar | providers | integrations | privacy | updates | advanced`.
- `AgenticSurface` (AgenticModels.swift:2946): `assistantBubble | workspace` — outermost presentation split in ContentView.
- `MorningBriefingColdLoadKind` (MorningBriefingPageView.swift:4), `NewsMarketRadarStreamKind` (OpenDesignReferencePages.swift:3104) — sub-surface routing.

---

## SCREENS

Full-surface / top-level route / shell views. name | file:line | role

| Name | file:line | Role |
|---|---|---|
| ContentView | agentic30/ContentView.swift:2332 | Root routing view — owns `rootContent`, picks Onboarding vs Workspace vs Assistant-bubble surface, hosts window chrome, notifications, and all workspace data bindings. The app's true top-level view. |
| StatusMenuContent | agentic30/agentic30App.swift:1076 | Menu-bar dropdown content — the always-present menubar surface (status, quick actions, open workspace). |
| IntakeV2FlowView | agentic30/IntakeV2FlowView.swift:509 | Onboarding wizard container; routes the 8 intake steps + fixed progress bar. |
| IntakeV2BootIntroView | agentic30/IntakeV2ShowcaseViews.swift:151 | Intake Step 1 (BOOT) — animated boot/intro terminal-style screen introducing Read/Decide/Execute. |
| IntakeV2FocusAreaView | agentic30/IntakeV2StepViews.swift:52 | Intake Step 2 — pick the founder's focus area (option-card question). |
| IntakeV2BottleneckView | agentic30/IntakeV2StepViews.swift:94 | Intake Step 3 — pick the current bottleneck (option-card question). |
| IntakeV2CommitmentView | agentic30/IntakeV2StepViews.swift:10 | Intake Step 4 — commitment/intent selection screen. |
| IntakeV2EvidenceView | agentic30/IntakeV2StepViews.swift:136 | Intake Step 5 — evidence-type selection screen. |
| IntakeV2FolderPickView | agentic30/IntakeV2StepViews.swift:178 | Intake Step 6 — workspace folder picker screen. |
| IntakeV2ConnectShowcaseView | agentic30/IntakeV2ShowcaseViews.swift:829 | Intake Step 7 — CONNECT: source-connection showcase (add sources, RSS/OPML, integrations). |
| IntakeV2ReadyAnalyzeView | agentic30/IntakeV2ShowcaseViews.swift:1636 | Intake Step 8 — READY: runs/streams the workspace scan, shows boot log + scan preview, handles provider-limit/blocked notices. |
| MacOnboardingView | agentic30/MacOnboardingView.swift:24 | Legacy story-style onboarding screen (halftone hero + floating briefing/milestone cards). |
| MacOnboardingContextView | agentic30/MacOnboardingContextView.swift:3 | Legacy onboarding context-capture screen (product/founder context intake). |
| OpenDesignDayPageView | agentic30/OpenDesignDayPageView.swift:4571 | Primary workspace host — owns layout metrics, search palette, rail state; wraps OpenDesignDayShell with all data bindings. |
| OpenDesignDayShell | agentic30/OpenDesignDayPageView.swift:5862 | The rail-based master router; switches right-hand surface between Today/OfficeHours/FounderReplay/Strategy/Briefing/Reference/Locked/Market. |
| OpenDesignDayMainView | agentic30/OpenDesignDayPageView.swift:17150 | "Today" main surface — Day-1 interview/goal workspace (steps, header, meta panel). |
| OpenDesignMarketMainView | agentic30/OpenDesignDayPageView.swift:16099 | Day-2 "Market" main surface — keyword cloud, signal grid, alternatives matrix, post feed. |
| OpenDesignFounderReplayPageView | agentic30/OpenDesignDayPageView.swift:8966 | Founder Replay screen — recorder control, frame timeline/capture, audit, search, SQL, MCP grants, export, retention, pipes. |
| OpenDesignStrategyPageView | agentic30/OpenDesignDayPageView.swift:12921 | Strategy screen — business canvas, SWOT, positioning matrix, criteria; hosts strategy report. |
| MorningBriefingPageView | agentic30/MorningBriefingPageView.swift:110 | Morning Briefing screen — three-column (section nav / main scroll / meta panel) daily briefing. |
| MorningBriefingDrilldownView | agentic30/MorningBriefingDrilldownView.swift:8 | Per-source briefing drilldown screen (Cloudflare/GitHub/PostHog etc.), data-driven. |
| OpenDesignReferenceShell | agentic30/OpenDesignReferencePages.swift:5547 | Reference-page router; dispatches to per-page shells or the generic reference layout. |
| OpenDesignReferenceMainView | agentic30/OpenDesignReferencePages.swift:10284 | Generic reference-page main surface (used for pages without a bespoke shell). |
| OpenDesignProjectsShell | agentic30/OpenDesignReferencePages.swift:8811 | Projects reference screen — portfolio overview, day strip, gates, project detail. |
| OpenDesignSettingsReferenceShell | agentic30/OpenDesignReferencePages.swift:5628 | Settings reference/mock screen (design reference variant of settings). |
| OpenDesignInterviewsShell | agentic30/OpenDesignReferencePages.swift:6376 | Interviews reference screen — interview list sidebar + transcript/signals main + meta panel. |
| OpenDesignBipLogShell | agentic30/OpenDesignReferencePages.swift:1422 | Public-record / Build-in-Public log screen — source sidebar, brief cards, candidate cards, draft panel. |
| OpenDesignNewsShell | agentic30/OpenDesignReferencePages.swift:2594 | News / Market-Radar reference screen host. |
| NewsMarketRadarMainView | agentic30/OpenDesignReferencePages.swift:2829 | Live News/Market-Radar main surface — filter bar, lane groups, cards, progress/empty/error states. |
| OpenDesignHistoryShell | agentic30/OpenDesignReferencePages.swift:7612 | History/Retrospective reference screen — stats sidebar, retrospective cards, evidence timeline, meta panel. |
| SettingsView | agentic30/SettingsView.swift:123 | Real Settings screen (8 sections); shown standalone and embedded in the workspace. |
| OpenDesignLockedRailFeaturePreview | agentic30/OpenDesignDayPageView.swift:7139 | Locked-feature preview shell — blurred mock surface + unlock requirement + "go to today" CTA. |
| OpenDesignLockedRailMockSurface | agentic30/OpenDesignDayPageView.swift:7280 | Router picking which locked mock surface to render behind the lock. |
| OpenDesignLockedFounderReplayMockSurface | agentic30/OpenDesignDayPageView.swift:7300 | Locked-state mock of the Founder Replay surface. |
| OpenDesignLockedNewsMockSurface | agentic30/OpenDesignDayPageView.swift:7649 | Locked-state mock of the News surface. |
| OpenDesignLockedMorningBriefingMockSurface | agentic30/OpenDesignDayPageView.swift:7968 | Locked-state mock of the Morning Briefing surface. |
| OpenDesignLockedStrategyMockSurface | agentic30/OpenDesignDayPageView.swift:8196 | Locked-state mock of the Strategy surface. |
| OpenDesignLockedRailMockPreview | agentic30/OpenDesignDayPageView.swift:8712 | Generic locked-rail mock preview surface. |
| OpenDesignSearchPaletteView | agentic30/OpenDesignDayPageView.swift:20404 | ⌘-search command palette overlay over any workspace surface. |
| DecideNotificationGroupView | agentic30/IntakeV2DecideNotificationViews.swift:46 | "Decide" notification-stack showcase surface (swipe/execute mini-notifications) used in intake/onboarding demos. |
| OpenDesignColdLoadingStateView | agentic30/OpenDesignDayPageView.swift:13541 | Full-surface cold-loading state screen (skeleton card rows while a surface warms up). |
| OpenDesignDayGoalSelectionCard | agentic30/OpenDesignDayPageView.swift:16934 | Day-1 goal-selection surface — drafts, selection, error, proof-sink gating (a full interactive stage, not a small card). |
| OpenDesignHypothesisConfirmationCard | agentic30/OpenDesignDayPageView.swift:18903 | Day-1 hypothesis confirmation stage — large multi-section confirmation surface. |
| OpenDesignInterviewStepView | agentic30/OpenDesignDayPageView.swift:18276 | Interview step surface within the Day workspace (question + option grid + context rows). |
| OpenDesignDayStepWorkspaceView | agentic30/OpenDesignDayPageView.swift:17753 | Day workspace step container (header + stepper + step body + footer). |
| Day1SituationSummaryCard | agentic30/Day1SituationSummaryCard.swift:12 | Day-1 situation-summary surface card (scan-derived situation overview); only shown when data present. |

Notes on inclusion: The `openDesignOfficeHoursScreenView` (a `ContentView` @ViewBuilder func, not a `struct View`) is the Office Hours screen; it is assembled inline in ContentView from OfficeHours* subviews (see Components/Subviews). The `bipMissionWorkspaceSurface()` (ContentView func) is the BIP-mission route surface. Both are reachable screens but are functions, not structs, so they are not in the struct count.

---

## COMPONENTS

Reusable UI pieces used across ≥1 screen (buttons, rows, cards, pills, toggles, sparklines, headers, sidebars, meta panels, state/progress/empty/error views, steppers, option/question cards, titlebars, backgrounds, etc.). Includes the 8 `ViewModifier` behavior primitives at the end.

### Intake V2 flow chrome & shared pieces
| Name | file:line | Role |
|---|---|---|
| IntakeV2Header | agentic30/IntakeV2FlowView.swift:209 | Shared intake step header (eyebrow + title + subtitle). |
| IntakeV2Footer | agentic30/IntakeV2FlowView.swift:329 | Shared intake step footer (back/next + primary CTA). |
| IntakeV2OptionCard | agentic30/IntakeV2FlowView.swift:248 | Selectable option card used by intake question steps. |
| IntakeV2PinnedStepScaffold | agentic30/IntakeV2FlowView.swift:439 | Generic step scaffold (pinned header/footer + scrolling content). Generic over Content/Footer. |
| IntakeV2DashPagination | agentic30/IntakeV2FlowView.swift:129 | Dash/segment progress indicator across intake steps. |
| IntakeV2ProgressReservedSpace | agentic30/IntakeV2FlowView.swift:199 | Layout spacer reserving room for the fixed progress bar. |
| IntakeV2ActivitySpinner | agentic30/IntakeV2FlowView.swift:60 | Activity spinner used in intake footers/scan. |
| IntakeV2FooterSpinnerAccessibilityMarker | agentic30/IntakeV2FlowView.swift:105 | Invisible a11y marker exposing footer spinner state to UI tests. |
| BrandIconTile | agentic30/IntakeV2ShowcaseViews.swift:124 | Brand/app icon tile used in showcase headers. |
| ReadIconGrid | agentic30/IntakeV2ShowcaseViews.swift:630 | "Read" phase icon grid (source-type icons) in boot intro. |
| DecideMiniNotif | agentic30/IntakeV2ShowcaseViews.swift:680 | Single mini-notification card in the Decide showcase. |
| ExecuteTaskList | agentic30/IntakeV2ShowcaseViews.swift:712 | "Execute" phase task list in boot intro. |
| IntakeV2AddSourceModal | agentic30/IntakeV2ShowcaseViews.swift:1163 | Modal for adding a data source (RSS/OPML/integration) in Connect step. |
| IntakeSourceIconTile | agentic30/IntakeV2ShowcaseViews.swift:1495 | Source-type icon tile in the Connect showcase. |
| IntakeV2BootLogElapsedChip | agentic30/IntakeV2ShowcaseViews.swift:2578 | Elapsed-time chip on boot-log rows during scan. |
| ScanPreviewSlotBackground | agentic30/IntakeV2ShowcaseViews.swift:2999 | Background for a scan-preview slot tile. |
| ScanPreviewGlowingBorderTrace | agentic30/IntakeV2ShowcaseViews.swift:3044 | Animated glowing border trace around scan-preview slots. |
| DotPulse | agentic30/IntakeV2ShowcaseViews.swift:3093 | Pulsing dot loading indicator. |
| Agentic30AppIcon | agentic30/IntakeV2DecideNotificationViews.swift:656 | Vector app-icon component (used in notifications/showcases). |

### Legacy onboarding pieces
| Name | file:line | Role |
|---|---|---|
| AssistantMark | agentic30/MacOnboardingView.swift:436 | Assistant/wolf avatar mark used in onboarding hero. |
| FloatingBriefingBubble | agentic30/MacOnboardingView.swift:473 | Floating briefing-preview bubble in onboarding hero. |
| FloatingMilestoneCard | agentic30/MacOnboardingView.swift:506 | Floating milestone card in onboarding hero. |
| IntegrationIconRow | agentic30/MacOnboardingView.swift:527 | Row of integration/source icons in onboarding. |
| HalftoneField | agentic30/MacOnboardingView.swift:413 | Halftone dot-field decorative background (onboarding). |
| HalftoneFieldDots | agentic30/MacOnboardingContextView.swift:555 | Halftone dot-field variant for the context view. |

### Menu bar
| Name | file:line | Role |
|---|---|---|
| StatusMenuLabel | agentic30/agentic30App.swift:1266 | Menu-bar extra label (icon + status) shown in the macOS status bar. |

### OpenDesign titlebars (per-surface window titlebars)
| Name | file:line | Role |
|---|---|---|
| OpenDesignMarketTitlebar | agentic30/OpenDesignDayPageView.swift:6802 | Titlebar for the Market (Day-2) surface. |
| OpenDesignDayTitlebar | agentic30/OpenDesignDayPageView.swift:6880 | Titlebar for the Today/Day surface. |
| OpenDesignOfficeHoursTitlebar | agentic30/OpenDesignDayPageView.swift:6957 | Titlebar for the Office Hours surface. |
| OpenDesignFounderReplayTitlebar | agentic30/OpenDesignDayPageView.swift:7022 | Titlebar for the Founder Replay surface. |
| OpenDesignStrategyTitlebar | agentic30/OpenDesignDayPageView.swift:7061 | Titlebar for the Strategy surface. |
| OpenDesignLockedRailTitlebar | agentic30/OpenDesignDayPageView.swift:7099 | Titlebar for locked-rail preview surfaces. |
| OpenDesignReferenceTitlebar | agentic30/OpenDesignReferencePages.swift:5495 | Titlebar for reference-page surfaces. |

### OpenDesign rail (left nav)
| Name | file:line | Role |
|---|---|---|
| OpenDesignRailView | agentic30/OpenDesignDayPageView.swift:14908 | Left rail nav column listing surface items with status/lock badges. |
| OpenDesignRailButton | agentic30/OpenDesignDayPageView.swift:14958 | Single rail nav button (icon + active/locked state + new-dot). |
| OpenDesignRailTooltip | agentic30/OpenDesignDayPageView.swift:15089 | Hover tooltip for a rail button. |

### OpenDesign Day/Today surface components
| Name | file:line | Role |
|---|---|---|
| OpenDesignTaskSidebarView | agentic30/OpenDesignDayPageView.swift:15129 | Task/day sidebar (grouped task list) for the Day surface. |
| OpenDesignTaskGroupHeader | agentic30/OpenDesignDayPageView.swift:15214 | Collapsible task-group header. |
| OpenDesignTaskSearchButton | agentic30/OpenDesignDayPageView.swift:15273 | Search button in the task sidebar. |
| OpenDesignTaskRow | agentic30/OpenDesignDayPageView.swift:15308 | Single task row (state: done/active/pending/locked). |
| OpenDesignTaskProgressSpinner | agentic30/OpenDesignDayPageView.swift:15401 | Inline progress spinner on active task rows. |
| OpenDesignDayHeader | agentic30/OpenDesignDayPageView.swift:17967 | Day surface header (title + actions). |
| OpenDesignHeaderActionButton | agentic30/OpenDesignDayPageView.swift:18028 | Header action button used across day/surface headers. |
| OpenDesignStepper | agentic30/OpenDesignDayPageView.swift:18089 | Step progress stepper (chips) for the day workspace. |
| OpenDesignStepperChip | agentic30/OpenDesignDayPageView.swift:18159 | Single stepper chip. |
| OpenDesignStepFooter | agentic30/OpenDesignDayPageView.swift:17885 | Footer nav for the day step workspace. |
| OpenDesignSectionHeader | agentic30/OpenDesignDayPageView.swift:18202 | Generic section header inside day/surface content. |
| OpenDesignQuestionContextRows | agentic30/OpenDesignDayPageView.swift:18229 | Context rows shown above an interview question. |
| OpenDesignQuestionOptionGrid | agentic30/OpenDesignDayPageView.swift:18595 | Grid of question option tiles. |
| OpenDesignQuestionOptionTile | agentic30/OpenDesignDayPageView.swift:18702 | Single selectable question option tile. |
| OpenDesignScanWarningCard | agentic30/OpenDesignDayPageView.swift:18645 | Warning card shown when a scan is incomplete/blocked. |
| OpenDesignMetaPanelView | agentic30/OpenDesignDayPageView.swift:19910 | Right meta panel for the day/interview surface. |
| OpenDesignChoiceSummaryPanel | agentic30/OpenDesignDayPageView.swift:20070 | Panel summarizing user's choices so far. |
| OpenDesignCompletionChecklist | agentic30/OpenDesignDayPageView.swift:20117 | Completion checklist (gate items) for a day. |
| OpenDesignMetaInfoRow | agentic30/OpenDesignDayPageView.swift:20181 | Info row in the meta panel. |
| OpenDesignMetaFollowupRow | agentic30/OpenDesignDayPageView.swift:20225 | Follow-up row in the meta panel. |
| OpenDesignHandoffActionButton | agentic30/OpenDesignDayPageView.swift:20782 | Handoff/primary action button (day handoff). |
| OpenDesignGhostActionButton | agentic30/OpenDesignDayPageView.swift:20838 | Ghost/secondary action button. |
| OpenDesignToolbarButton | agentic30/OpenDesignDayPageView.swift:14827 | Generic toolbar icon button. |
| OpenDesignSearchRow | agentic30/OpenDesignDayPageView.swift:20569 | Result row inside the search palette. |
| OpenDesignCardBackground | agentic30/OpenDesignDayPageView.swift:20917 | Reusable card background surface. |
| OpenDesignGradientCardBackground | agentic30/OpenDesignDayPageView.swift:20937 | Reusable gradient card background. |
| OpenDesignButtonBackground | agentic30/OpenDesignDayPageView.swift:20968 | Reusable button background surface. |
| OpenDesignInlineSpinner | agentic30/OpenDesignDayPageView.swift:13797 | Inline spinner used across surfaces. |
| OpenDesignRotatingStatusIcon | agentic30/OpenDesignDayPageView.swift:13845 | Rotating status/refresh icon. |
| OpenDesignRefreshTimingPill | agentic30/OpenDesignDayPageView.swift:13615 | Pill showing last-refresh timing. |
| OpenDesignLoadingCardRowView | agentic30/OpenDesignDayPageView.swift:13634 | Skeleton loading card row. |
| OpenDesignLoadingStateBadge | agentic30/OpenDesignDayPageView.swift:13681 | Loading-state badge. |
| OpenDesignOfficeHoursUnavailableView | agentic30/OpenDesignDayPageView.swift:14810 | Empty/unavailable state shown when Office Hours can't load. |

### OpenDesign Market (Day-2) components
| Name | file:line | Role |
|---|---|---|
| OpenDesignMarketHeader | agentic30/OpenDesignDayPageView.swift:16204 | Market surface header. |
| OpenDesignMarketSourceTabs | agentic30/OpenDesignDayPageView.swift:16279 | Source tab bar for market signals. |
| OpenDesignMarketSourceTab | agentic30/OpenDesignDayPageView.swift:16311 | Single market source tab. |
| OpenDesignMarketKeywordCloud | agentic30/OpenDesignDayPageView.swift:16349 | Keyword cloud visualization. |
| OpenDesignMarketSignalGrid | agentic30/OpenDesignDayPageView.swift:16376 | Grid of market signal cards. |
| OpenDesignMarketSignalCardView | agentic30/OpenDesignDayPageView.swift:16389 | Single market signal card. |
| OpenDesignMarketSparkline | agentic30/OpenDesignDayPageView.swift:16445 | Sparkline chart for a signal trend. |
| OpenDesignMarketAlternativeMatrix | agentic30/OpenDesignDayPageView.swift:16469 | Competitor/alternatives comparison matrix. |
| OpenDesignMarketAlternativeHeader | agentic30/OpenDesignDayPageView.swift:16487 | Header row of the alternatives matrix. |
| OpenDesignMarketAlternativeRow | agentic30/OpenDesignDayPageView.swift:16506 | Single alternative/competitor row. |
| OpenDesignMarketFitBar | agentic30/OpenDesignDayPageView.swift:16554 | Fit/score bar in the alternatives matrix. |
| OpenDesignMarketTagGroup | agentic30/OpenDesignDayPageView.swift:16583 | Tag group chips for market entries. |
| OpenDesignMarketGapCard | agentic30/OpenDesignDayPageView.swift:16602 | "Gap"/opportunity card. |
| OpenDesignMarketPostFeed | agentic30/OpenDesignDayPageView.swift:16635 | Social post feed list. |
| OpenDesignMarketPostRow | agentic30/OpenDesignDayPageView.swift:16647 | Single social post row. |
| OpenDesignMarketMetaPanelView | agentic30/OpenDesignDayPageView.swift:16702 | Market surface right meta panel. |
| OpenDesignMarketMiniMetricRow | agentic30/OpenDesignDayPageView.swift:16830 | Mini metric row in the market meta panel. |

### OpenDesign Strategy components
| Name | file:line | Role |
|---|---|---|
| StrategyResearchStatusBanner | agentic30/OpenDesignDayPageView.swift:13323 | Banner showing strategy-research status/progress. |
| StrategyBackdropView | agentic30/OpenDesignDayPageView.swift:13914 | Strategy surface backdrop. |
| StrategyPanelBackground | agentic30/OpenDesignDayPageView.swift:13950 | Strategy panel background. |
| StrategyCanvasCardBackground | agentic30/OpenDesignDayPageView.swift:14011 | Business-canvas card background. |
| StrategyAccentCalloutBackground | agentic30/OpenDesignDayPageView.swift:14074 | Accent callout background. |
| StrategyMatrixBoardBackground | agentic30/OpenDesignDayPageView.swift:14097 | Positioning-matrix board background. |
| StrategySectionHeader | agentic30/OpenDesignDayPageView.swift:14124 | Strategy section header. |
| StrategySummaryTileView | agentic30/OpenDesignDayPageView.swift:14146 | Strategy summary tile. |
| StrategyCriterionRowView | agentic30/OpenDesignDayPageView.swift:14170 | Criterion row (scored). |
| StrategyBusinessCanvasMatrixView | agentic30/OpenDesignDayPageView.swift:14193 | Business Model Canvas matrix. |
| StrategyCanvasBlockView | agentic30/OpenDesignDayPageView.swift:14273 | Single canvas block. |
| StrategyBulletRow | agentic30/OpenDesignDayPageView.swift:14328 | Bullet row inside a canvas block. |
| StrategySWOTCardView | agentic30/OpenDesignDayPageView.swift:14345 | SWOT quadrant card. |
| StrategyPositioningMatrixView | agentic30/OpenDesignDayPageView.swift:14392 | 2×2 positioning matrix. |
| StrategyMatrixDetailPanel | agentic30/OpenDesignDayPageView.swift:14513 | Detail panel for a selected matrix competitor. |
| StrategyMatrixCategoryChip | agentic30/OpenDesignDayPageView.swift:14625 | Category chip in the matrix detail. |
| StrategyMatrixScoreBar | agentic30/OpenDesignDayPageView.swift:14646 | Score bar in the matrix detail. |
| StrategyMatrixCompetitorButton | agentic30/OpenDesignDayPageView.swift:14682 | Selectable competitor plotted on the matrix. |

### Morning Briefing component
| Name | file:line | Role |
|---|---|---|
| MorningBriefingSourceSparkline | agentic30/MorningBriefingPageView.swift:2638 | Per-source sparkline in the morning briefing. |

### News / Market Radar components (OpenDesignReferencePages)
| Name | file:line | Role |
|---|---|---|
| NewsMarketRadarSidebarView | agentic30/OpenDesignReferencePages.swift:2686 | Market-radar stream sidebar. |
| NewsMarketRadarSidebarSection | agentic30/OpenDesignReferencePages.swift:2775 | Sidebar section wrapper (generic over Content). |
| NewsMarketRadarStreamButton | agentic30/OpenDesignReferencePages.swift:2790 | Stream selector button in the sidebar. |
| NewsMarketRadarHeader | agentic30/OpenDesignReferencePages.swift:2950 | Market-radar main header. |
| NewsMarketRadarFilterBar | agentic30/OpenDesignReferencePages.swift:3073 | Filter/chip bar for the radar. |
| NewsMarketRadarEmptyStream | agentic30/OpenDesignReferencePages.swift:3520 | Empty-stream state. |
| NewsMarketRadarLaneGroupView | agentic30/OpenDesignReferencePages.swift:3542 | Lane group (grouped cards) view. |
| NewsMarketRadarCardActions | agentic30/OpenDesignReferencePages.swift:3583 | Per-card action buttons. |
| NewsMarketRadarExaConfigurationState | agentic30/OpenDesignReferencePages.swift:3614 | State shown when Exa search isn't configured. |
| NewsMarketRadarErrorState | agentic30/OpenDesignReferencePages.swift:3636 | Error state. |
| NewsMarketRadarEmptyLane | agentic30/OpenDesignReferencePages.swift:3660 | Empty-lane state. |
| NewsMarketRadarProgressState | agentic30/OpenDesignReferencePages.swift:3680 | In-progress state. |
| NewsMarketRadarColdStartState | agentic30/OpenDesignReferencePages.swift:3765 | Cold-start (first run) state. |
| NewsMarketRadarInlineFailureState | agentic30/OpenDesignReferencePages.swift:3833 | Inline failure notice. |
| NewsMarketRadarProgressChecklist | agentic30/OpenDesignReferencePages.swift:3881 | Progress checklist during radar fetch. |
| NewsMarketRadarCardView | agentic30/OpenDesignReferencePages.swift:3931 | Single market-radar card. |
| NewsMarketRadarDetailRow | agentic30/OpenDesignReferencePages.swift:4024 | Detail row inside a card. |
| NewsMarketRadarSourceRow | agentic30/OpenDesignReferencePages.swift:4066 | Source row inside a card. |
| NewsMarketRadarMetaPanelView | agentic30/OpenDesignReferencePages.swift:4129 | Radar right meta panel. |
| NewsMarketRadarRecommendationRow | agentic30/OpenDesignReferencePages.swift:4244 | Recommendation row in the meta panel. |
| NewsMarketRadarMetaProgress | agentic30/OpenDesignReferencePages.swift:4266 | Meta-panel progress indicator. |

### BIP Log (Public record) components
| Name | file:line | Role |
|---|---|---|
| OpenDesignBipSidebarView | agentic30/OpenDesignReferencePages.swift:1553 | BIP log source sidebar. |
| OpenDesignBipSidebarSection | agentic30/OpenDesignReferencePages.swift:1627 | Sidebar section (generic over Content). |
| OpenDesignBipSourceRow | agentic30/OpenDesignReferencePages.swift:1652 | Source row in BIP sidebar. |
| OpenDesignBipSignalRow | agentic30/OpenDesignReferencePages.swift:1690 | Signal row in BIP sidebar. |
| OpenDesignBipSidebarProgress | agentic30/OpenDesignReferencePages.swift:1723 | Sidebar progress indicator. |
| OpenDesignBipMainView | agentic30/OpenDesignReferencePages.swift:1783 | BIP log main content. |
| OpenDesignBipHeaderView | agentic30/OpenDesignReferencePages.swift:1921 | BIP main header. |
| OpenDesignBipHeaderButton | agentic30/OpenDesignReferencePages.swift:1993 | BIP header button. |
| OpenDesignBipFilterBar | agentic30/OpenDesignReferencePages.swift:2028 | BIP filter bar. |
| OpenDesignBipFilterButton | agentic30/OpenDesignReferencePages.swift:2072 | BIP filter button. |
| OpenDesignBipSectionHeader | agentic30/OpenDesignReferencePages.swift:2101 | BIP section header. |
| OpenDesignBipBriefCard | agentic30/OpenDesignReferencePages.swift:2126 | BIP brief card. |
| OpenDesignBipMetricPill | agentic30/OpenDesignReferencePages.swift:2223 | Metric pill on BIP cards. |
| OpenDesignBipProgressState | agentic30/OpenDesignReferencePages.swift:2244 | BIP in-progress state. |
| OpenDesignBipNoExaRouteState | agentic30/OpenDesignReferencePages.swift:2274 | State when no Exa route configured. |
| OpenDesignBipEmptyState | agentic30/OpenDesignReferencePages.swift:2302 | BIP empty state. |
| OpenDesignBipCandidateCard | agentic30/OpenDesignReferencePages.swift:2329 | Candidate (research target) card. |
| OpenDesignBipDraftPanel | agentic30/OpenDesignReferencePages.swift:2497 | Post-draft panel. |

### News reference-page components
| Name | file:line | Role |
|---|---|---|
| OpenDesignNewsSidebarView | agentic30/OpenDesignReferencePages.swift:4529 | News page sidebar. |
| OpenDesignNewsStreamRowView | agentic30/OpenDesignReferencePages.swift:4611 | Stream row in news sidebar. |
| OpenDesignNewsMainView | agentic30/OpenDesignReferencePages.swift:4649 | News page main content. |
| OpenDesignNewsHeaderView | agentic30/OpenDesignReferencePages.swift:4727 | News header. |
| OpenDesignNewsFilterBar | agentic30/OpenDesignReferencePages.swift:4811 | News filter bar. |
| OpenDesignNewsFilterChip | agentic30/OpenDesignReferencePages.swift:4837 | News filter chip. |
| OpenDesignNewsTakeawayHero | agentic30/OpenDesignReferencePages.swift:4884 | Hero takeaway block. |
| OpenDesignNewsSectionHeader | agentic30/OpenDesignReferencePages.swift:4978 | News section header. |
| OpenDesignNewsArticleCard | agentic30/OpenDesignReferencePages.swift:5001 | Article card. |
| OpenDesignNewsArticleFooter | agentic30/OpenDesignReferencePages.swift:5129 | Article card footer. |
| OpenDesignNewsValueTag | agentic30/OpenDesignReferencePages.swift:5185 | Value tag on articles. |
| OpenDesignNewsMetaPanelView | agentic30/OpenDesignReferencePages.swift:5203 | News right meta panel. |
| OpenDesignNewsCoverageRow | agentic30/OpenDesignReferencePages.swift:5292 | Coverage row in meta panel. |
| OpenDesignNewsRecommendationRow | agentic30/OpenDesignReferencePages.swift:5328 | Recommendation row. |
| OpenDesignNewsSourcePill | agentic30/OpenDesignReferencePages.swift:5362 | Source pill. |
| OpenDesignNewsActionButton | agentic30/OpenDesignReferencePages.swift:5400 | News action button. |
| OpenDesignNewsIconButton | agentic30/OpenDesignReferencePages.swift:5461 | News icon button. |

### Settings reference-page components
| Name | file:line | Role |
|---|---|---|
| OpenDesignSettingsSidebarView | agentic30/OpenDesignReferencePages.swift:5659 | Settings sidebar. |
| OpenDesignSettingsSideRowView | agentic30/OpenDesignReferencePages.swift:5722 | Settings sidebar row. |
| OpenDesignSettingsMainView | agentic30/OpenDesignReferencePages.swift:5766 | Settings main content. |
| OpenDesignSettingsHeaderView | agentic30/OpenDesignReferencePages.swift:5792 | Settings header. |
| OpenDesignSettingsSectionView | agentic30/OpenDesignReferencePages.swift:5844 | Settings section wrapper. |
| OpenDesignSettingsBlockView | agentic30/OpenDesignReferencePages.swift:5877 | Settings block. |
| OpenDesignSettingsRowsCard | agentic30/OpenDesignReferencePages.swift:5895 | Card wrapping settings rows. |
| OpenDesignSettingsRowView | agentic30/OpenDesignReferencePages.swift:5913 | Settings row. |
| OpenDesignSettingsProviderList | agentic30/OpenDesignReferencePages.swift:6058 | AI-provider list. |
| OpenDesignSettingsIntegrationCard | agentic30/OpenDesignReferencePages.swift:6162 | Integration card. |
| OpenDesignSettingsPathPill | agentic30/OpenDesignReferencePages.swift:6204 | Workspace-path pill. |
| OpenDesignSettingsToggle | agentic30/OpenDesignReferencePages.swift:6226 | Settings toggle. |
| OpenDesignSettingsSegmented | agentic30/OpenDesignReferencePages.swift:6247 | Segmented control. |
| OpenDesignSettingsMetaPanelView | agentic30/OpenDesignReferencePages.swift:6268 | Settings meta panel. |
| OpenDesignSettingsMetaCard | agentic30/OpenDesignReferencePages.swift:6332 | Meta card (generic over Content). |
| OpenDesignSettingsSparkline | agentic30/OpenDesignReferencePages.swift:6358 | Sparkline in settings meta. |

### Interviews reference-page components
| Name | file:line | Role |
|---|---|---|
| OpenDesignInterviewsSidebar | agentic30/OpenDesignReferencePages.swift:6432 | Interviews list sidebar. |
| OpenDesignInterviewSidebarRowView | agentic30/OpenDesignReferencePages.swift:6543 | Interview list row. |
| OpenDesignInterviewsMain | agentic30/OpenDesignReferencePages.swift:6623 | Interviews main content. |
| OpenDesignInterviewsMetaPanel | agentic30/OpenDesignReferencePages.swift:7056 | Interviews meta panel. |
| OpenDesignInterviewSectionHeader | agentic30/OpenDesignReferencePages.swift:7151 | Interview section header. |
| OpenDesignInterviewSignalCard | agentic30/OpenDesignReferencePages.swift:7180 | Interview signal card. |
| OpenDesignInterviewQuoteRow | agentic30/OpenDesignReferencePages.swift:7210 | Interview quote row. |
| OpenDesignInterviewThemeRow | agentic30/OpenDesignReferencePages.swift:7261 | Interview theme row. |
| OpenDesignInterviewUpcomingRow | agentic30/OpenDesignReferencePages.swift:7299 | Upcoming interview row. |
| OpenDesignInterviewActionButton | agentic30/OpenDesignReferencePages.swift:7342 | Interview action button. |
| OpenDesignInterviewMiniButton | agentic30/OpenDesignReferencePages.swift:7370 | Interview mini button. |
| OpenDesignInterviewIconButton | agentic30/OpenDesignReferencePages.swift:7397 | Interview icon button. |

### History reference-page components
| Name | file:line | Role |
|---|---|---|
| OpenDesignHistorySidebarView | agentic30/OpenDesignReferencePages.swift:7652 | History sidebar (stats/focus/rank). |
| OpenDesignHistoryStatRow | agentic30/OpenDesignReferencePages.swift:7757 | History stat row. |
| OpenDesignHistoryFocusRow | agentic30/OpenDesignReferencePages.swift:7775 | History focus row. |
| OpenDesignHistoryAreaRankRow | agentic30/OpenDesignReferencePages.swift:7808 | Area rank row. |
| OpenDesignHistoryMainView | agentic30/OpenDesignReferencePages.swift:7857 | History main content. |
| OpenDesignHistoryHeaderView | agentic30/OpenDesignReferencePages.swift:7901 | History header. |
| OpenDesignHistoryRetrospectiveCard | agentic30/OpenDesignReferencePages.swift:7963 | Weekly retrospective card. |
| OpenDesignHistoryBullet | agentic30/OpenDesignReferencePages.swift:8045 | Bullet item in retrospective. |
| OpenDesignHistoryInsightCard | agentic30/OpenDesignReferencePages.swift:8063 | Insight card. |
| OpenDesignHistoryRiskRow | agentic30/OpenDesignReferencePages.swift:8097 | Risk row. |
| OpenDesignHistoryRetrospectiveActionRow | agentic30/OpenDesignReferencePages.swift:8127 | Retrospective action row. |
| OpenDesignHistoryEvidenceTimelineSection | agentic30/OpenDesignReferencePages.swift:8150 | Evidence timeline section. |
| OpenDesignHistoryWeeklyBanner | agentic30/OpenDesignReferencePages.swift:8206 | Weekly summary banner. |
| OpenDesignHistoryNextActionRow | agentic30/OpenDesignReferencePages.swift:8250 | Next-action row. |
| OpenDesignHistoryDayGroupView | agentic30/OpenDesignReferencePages.swift:8273 | Day-grouped activity view. |
| OpenDesignHistoryAreaCardView | agentic30/OpenDesignReferencePages.swift:8322 | Focus-area card. |
| OpenDesignHistoryUnclassifiedRow | agentic30/OpenDesignReferencePages.swift:8402 | Unclassified activity row. |
| OpenDesignHistoryReferenceEventsView | agentic30/OpenDesignReferencePages.swift:8440 | Reference (others' activity) events view. |
| OpenDesignHistoryGitHubRequiredView | agentic30/OpenDesignReferencePages.swift:8483 | State requiring GitHub connection. |
| OpenDesignHistoryEmptyStateView | agentic30/OpenDesignReferencePages.swift:8518 | History empty state. |
| OpenDesignHistoryMetaPanelView | agentic30/OpenDesignReferencePages.swift:8570 | History meta panel. |
| OpenDesignHistoryEvidenceMixRow | agentic30/OpenDesignReferencePages.swift:8659 | Evidence-mix (hard/soft) row. |

### Projects reference-page components
| Name | file:line | Role |
|---|---|---|
| OpenDesignProjectsSidebarView | agentic30/OpenDesignReferencePages.swift:8856 | Projects sidebar. |
| OpenDesignProjectsSideRowView | agentic30/OpenDesignReferencePages.swift:8971 | Project sidebar row. |
| OpenDesignProjectsMainView | agentic30/OpenDesignReferencePages.swift:9023 | Projects main content. |
| OpenDesignProjectsHeaderView | agentic30/OpenDesignReferencePages.swift:9104 | Projects header. |
| OpenDesignProjectHeaderButton | agentic30/OpenDesignReferencePages.swift:9169 | Projects header button. |
| OpenDesignProjectsSectionHeader | agentic30/OpenDesignReferencePages.swift:9201 | Projects section header. |
| OpenDesignProjectsOverviewCard | agentic30/OpenDesignReferencePages.swift:9230 | Project overview card. |
| OpenDesignProjectsProgressRing | agentic30/OpenDesignReferencePages.swift:9278 | Progress ring. |
| OpenDesignProjectsMetaToken | agentic30/OpenDesignReferencePages.swift:9302 | Meta token chip. |
| OpenDesignProjectsDayStrip | agentic30/OpenDesignReferencePages.swift:9318 | 30-day strip. |
| OpenDesignProjectsLegendSwatch | agentic30/OpenDesignReferencePages.swift:9369 | Legend color swatch. |
| OpenDesignProjectsDayCell | agentic30/OpenDesignReferencePages.swift:9385 | Single day cell in strip. |
| OpenDesignProjectsPhaseBar | agentic30/OpenDesignReferencePages.swift:9413 | Phase progress bar. |
| OpenDesignProjectsPhaseLegend | agentic30/OpenDesignReferencePages.swift:9435 | Phase legend. |
| OpenDesignProjectsStatsView | agentic30/OpenDesignReferencePages.swift:9454 | Stats row group. |
| OpenDesignProjectStatCard | agentic30/OpenDesignReferencePages.swift:9466 | Single stat card. |
| OpenDesignProjectsGateList | agentic30/OpenDesignReferencePages.swift:9494 | Gate checklist. |
| OpenDesignProjectsProgressBar | agentic30/OpenDesignReferencePages.swift:9552 | Progress bar. |
| OpenDesignProjectsBasicsCard | agentic30/OpenDesignReferencePages.swift:9570 | Project basics card. |
| OpenDesignProjectKVList | agentic30/OpenDesignReferencePages.swift:9620 | Key/value list. |
| OpenDesignProjectPathCard | agentic30/OpenDesignReferencePages.swift:9651 | Source-path card. |
| OpenDesignProjectMiniButton | agentic30/OpenDesignReferencePages.swift:9710 | Mini button. |
| OpenDesignProjectPathFooter | agentic30/OpenDesignReferencePages.swift:9737 | Path card footer. |
| OpenDesignProjectDocList | agentic30/OpenDesignReferencePages.swift:9754 | Doc list. |
| OpenDesignProjectDocRow | agentic30/OpenDesignReferencePages.swift:9765 | Doc row. |
| OpenDesignProjectTimeline | agentic30/OpenDesignReferencePages.swift:9809 | Project timeline. |
| OpenDesignProjectWorkflowCard | agentic30/OpenDesignReferencePages.swift:9867 | Workflow card. |
| OpenDesignProjectDangerZone | agentic30/OpenDesignReferencePages.swift:9892 | Danger-zone (delete) card. |
| OpenDesignProjectsMetaPanelView | agentic30/OpenDesignReferencePages.swift:9941 | Projects meta panel. |
| OpenDesignProjectsHealthCard | agentic30/OpenDesignReferencePages.swift:9977 | Project health card. |
| OpenDesignProjectsMetaSection | agentic30/OpenDesignReferencePages.swift:10032 | Meta section wrapper. |
| OpenDesignProjectsMetaRowView | agentic30/OpenDesignReferencePages.swift:10054 | Meta row. |
| OpenDesignProjectsQuickAction | agentic30/OpenDesignReferencePages.swift:10089 | Quick action button. |

### Generic reference-page components
| Name | file:line | Role |
|---|---|---|
| OpenDesignReferenceToolbarButton | agentic30/OpenDesignReferencePages.swift:10128 | Reference toolbar button. |
| OpenDesignReferenceSidebarView | agentic30/OpenDesignReferencePages.swift:10160 | Generic reference sidebar. |
| OpenDesignReferenceSideRowView | agentic30/OpenDesignReferencePages.swift:10238 | Generic sidebar row. |
| OpenDesignReferenceHeaderView | agentic30/OpenDesignReferencePages.swift:10314 | Generic reference header. |
| OpenDesignReferenceActionButton | agentic30/OpenDesignReferencePages.swift:10371 | Generic reference action button. |
| OpenDesignReferenceFilterBar | agentic30/OpenDesignReferencePages.swift:10402 | Generic reference filter bar. |
| OpenDesignReferenceSectionView | agentic30/OpenDesignReferencePages.swift:10421 | Generic reference section. |
| OpenDesignReferenceBlockView | agentic30/OpenDesignReferencePages.swift:10454 | Generic reference block (banner/calendar/metrics/rows/cards/timeline/articles/quotes/diff/settings/draft/heatmap styles). |
| OpenDesignReferenceGenericRow | agentic30/OpenDesignReferencePages.swift:10904 | Generic reference row. |
| OpenDesignReferenceMetaPanelView | agentic30/OpenDesignReferencePages.swift:10940 | Generic reference meta panel. |
| OpenDesignReferenceChipView | agentic30/OpenDesignReferencePages.swift:10961 | Generic reference chip. |
| OpenDesignReferenceAccentEdgeCard | agentic30/OpenDesignReferencePages.swift:11156 | Accent-edge card variant. |

### Office Hours components (ContentView)
| Name | file:line | Role |
|---|---|---|
| OfficeHoursMinimumLoading | agentic30/ContentView.swift:288 | Enforces a minimum loading duration before revealing content (generic over Loader/Content). |
| OfficeHoursDelayedReveal | agentic30/ContentView.swift:325 | Delays reveal of wrapped content (generic over Content). |
| OfficeHoursIntroStageReveal | agentic30/ContentView.swift:485 | Staged reveal of the intro sequence (generic over Content). |
| OfficeHoursCommandTypewriterText | agentic30/ContentView.swift:520 | Typewriter text for command-style lines. |
| OfficeHoursTypewriterText | agentic30/ContentView.swift:616 | Base typewriter text component. |
| OfficeHoursHighlightedTypewriterText | agentic30/ContentView.swift:695 | Typewriter text with highlighted spans. |
| OfficeHoursMissionTitleTypewriterText | agentic30/ContentView.swift:763 | Typewriter for mission titles. |
| OfficeHoursInlinePromptText | agentic30/ContentView.swift:865 | Inline prompt text rendering. |
| OfficeHoursAttributedInlineTypewriterText | agentic30/ContentView.swift:1091 | Attributed inline typewriter text. |
| OfficeHoursLoaderLine | agentic30/ContentView.swift:1407 | Single loader line. |
| OfficeHoursLoaderOrb | agentic30/ContentView.swift:1439 | Loader orb animation. |
| OfficeHoursCommitmentBarView | agentic30/ContentView.swift:16284 | Bottom commitment bar (today's committed action). |
| OfficeHoursDailyStateTransitionCardView | agentic30/ContentView.swift:15757 | Daily state-transition card. |
| OfficeHoursDailyWorkpackCardView | agentic30/ContentView.swift:15848 | Daily workpack card. |
| OfficeHoursDailyScoreboardCardView | agentic30/ContentView.swift:15900 | Daily scoreboard card. |
| OfficeHoursDailyGateCardView | agentic30/ContentView.swift:15950 | Daily gate card (evidence gate). |
| OfficeHoursPreviousCommitmentResolutionCard | agentic30/ContentView.swift:16152 | Card resolving the previous day's commitment. |
| RealisticConfettiBurst | agentic30/ContentView.swift:15079 | Confetti burst celebration overlay. |
| RealisticConfettiHost | agentic30/ContentView.swift:15147 | Host coordinating confetti bursts. |

### Theme / brand
| Name | file:line | Role |
|---|---|---|
| Agentic30ThemeApplicator (ViewModifier) | agentic30/Agentic30BrandColor.swift:66 | Applies the Agentic30 theme (light/dark tokens, tint) to a subtree via `.agentic30Themed()`. |

### ViewModifier behavior primitives
| Name | file:line | Role |
|---|---|---|
| OpenDesignHoverRowModifier | agentic30/OpenDesignDayPageView.swift:4483 | Hover highlight behavior for rows. |
| OpenDesignStagedRevealModifier | agentic30/OpenDesignDayPageView.swift:4521 | Staged reveal/animation-in behavior. |
| OpenDesignReturnShortcutModifier | agentic30/OpenDesignDayPageView.swift:20825 | Adds ⏎ return keyboard shortcut behavior. |
| OpenDesignSearchPulseModifier | agentic30/OpenDesignDayPageView.swift:20882 | Pulse-highlight a search-targeted element. |
| OfficeHoursOffsetOpacityModifier | agentic30/ContentView.swift:355 | Offset + opacity reveal transition. |
| OfficeHoursOptionRowSurface | agentic30/ContentView.swift:375 | Surface styling for option rows. |
| OfficeHoursGoalOptionSurface | agentic30/ContentView.swift:438 | Surface styling for goal option rows. |

---

## SUBVIEWS

Private one-off helpers local to a single screen (or private support views with no cross-screen reuse). name | file:line | role

| Name | file:line | Role |
|---|---|---|
| OpenDesignDayPlanPreparingView | agentic30/ContentView.swift:11923 | Nested placeholder shown while the Day plan is preparing (local to ContentView's day surface). |
| OfficeHoursDailyCardEvidenceSheet | agentic30/ContentView.swift:15654 | Sheet for submitting evidence from a daily card (Office Hours only). |
| OfficeHoursDailyCardReplacementSheet | agentic30/ContentView.swift:15706 | Sheet for replacing a daily card (Office Hours only). |
| OfficeHoursEvidenceResolutionSheet | agentic30/ContentView.swift:16065 | Sheet resolving an evidence request (Office Hours only). |

> Note on classification: The remaining large view populations live in `OpenDesignReferencePages.swift`, `OpenDesignDayPageView.swift`, and `ContentView.swift`. Almost all of them are `private struct`s, but they are genuinely **reusable within their screen family** (e.g. every `OpenDesignSettings*`, `OpenDesignHistory*`, `OpenDesignMarket*`, `Strategy*`, `NewsMarketRadar*`, `OpenDesignBip*`, `OfficeHours*` piece is a card/row/header/panel used repeatedly by its screen). For a design-system rebuild these are the reusable primitives, so they are classified as COMPONENTS above. The few true one-off, non-reusable helpers — the modal/preparing sheets bound to a single screen instance and the single nested preparing placeholder — are the SUBVIEWS listed here. The 8 `ViewModifier` structs are listed under Components as behavior primitives and are excluded from the "views" count.

---

## Cross-cutting notes for the React rebuild

- **Layout skeleton is uniform across screens**: `rail (OpenDesignRailView) | optional left sidebar | main scroll | optional right meta panel`, driven by `OpenDesignDayLayoutMetrics` (rail/sidebar/meta widths, `showsTaskSidebar`, `showsMetaPanel`). Every reference/day/market/strategy/briefing screen re-implements this same 3-column shell — a single `<WorkspaceShell rail sidebar main meta>` React primitive covers all of them.
- **Titlebars are per-surface** (7 variants) but structurally identical (title + detail + toolbar buttons) → one `<Titlebar>` with a `surface` prop.
- **State views repeat per surface**: each data surface ships its own cold-start / progress / empty / error / unavailable state (News, BIP, History, Office Hours, generic loading). These should collapse into a shared `<SurfaceState kind="cold|loading|empty|error|unavailable">`.
- **Two color palettes**: `OpenDesignDayColor` (Today/Market/Reference/Briefing/Strategy) and `OpenDesignOfficeHoursColor` (Office Hours + Founder Replay), selected by `OpenDesignRailSurfaceKind.usesDay1WorkspacePalette`. Both are theme-aware (`Agentic30Theme.current == .white`). Tokens live in `OpenDesignTokens.swift` / `Agentic30BrandColor.swift`.
- **Meta panels** (right column) are a recurring component family: `*MetaPanelView` exists for Market, Day, News (radar + news page), Settings, Interviews, History, Projects, generic reference → one `<MetaPanel>` with slotted rows.
- **Onboarding has two generations**: legacy `MacOnboardingView`/`MacOnboardingContextView` and the current 8-step `IntakeV2FlowView`. The React build should target IntakeV2 as the live flow.
- **Founder Replay** (`OpenDesignFounderReplayPageView`, ~4000 lines) is by far the densest screen — recorder control, frame timeline, capture/delete, audit, FTS search, SQL console, MCP grants, export, retention, and pipes are all inline. Expect to decompose it heavily on the React side.

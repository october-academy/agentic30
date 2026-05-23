import CoreFoundation
import Foundation
import Testing
@testable import agentic30

struct OpenDesignDayContentTests {
    @Test func inlineMarkdownEmphasisParserSplitsSingleRun() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "a **b** c") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "a ", isEmphasized: false),
            OpenDesignInlineMarkdownEmphasisRun(text: "b", isEmphasized: true),
            OpenDesignInlineMarkdownEmphasisRun(text: " c", isEmphasized: false),
        ])
    }

    @Test func inlineMarkdownEmphasisParserSupportsMultipleRuns() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "**first** and **second**") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "first", isEmphasized: true),
            OpenDesignInlineMarkdownEmphasisRun(text: " and ", isEmphasized: false),
            OpenDesignInlineMarkdownEmphasisRun(text: "second", isEmphasized: true),
        ])
    }

    @Test func inlineMarkdownEmphasisParserSupportsKoreanAndEnglishText() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "돕는 **local-first macOS 메뉴바 AI assistant** 입니다") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "돕는 ", isEmphasized: false),
            OpenDesignInlineMarkdownEmphasisRun(text: "local-first macOS 메뉴바 AI assistant", isEmphasized: true),
            OpenDesignInlineMarkdownEmphasisRun(text: " 입니다", isEmphasized: false),
        ])
    }

    @Test func inlineMarkdownEmphasisParserKeepsUnmatchedDelimiterLiteral() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "a **b c") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "a **b c", isEmphasized: false),
        ])
    }

    @Test func inlineMarkdownEmphasisParserKeepsEmptyDelimiterPairLiteral() {
        #expect(openDesignInlineMarkdownEmphasisRuns(in: "a **** c") == [
            OpenDesignInlineMarkdownEmphasisRun(text: "a ****", isEmphasized: false),
            OpenDesignInlineMarkdownEmphasisRun(text: " c", isEmphasized: false),
        ])
    }

    @Test func displayProjectDigestHidesEphemeralWorkspaceSlugs() {
        let slug = "agentic30-ui-opendesign-day-handoff-7BC22624-F1F9-4569-B4EB-884798290B65"

        #expect(openDesignDisplayProjectDigestValue(slug) == "이 프로젝트")
        #expect(openDesignDisplayProductName(slug) == nil)
        #expect(openDesignDisplayProductName("agentic30-public") == "Agentic30")
    }

    @Test func layoutMetricsFollowOpenDesignBreakpointsAndNativeCompactCollapse() {
        let wide = OpenDesignDayLayoutMetrics(width: 1360)
        #expect(wide.railWidth == 52)
        #expect(wide.taskSidebarWidth == 240)
        #expect(wide.metaPanelWidth == 280)
        #expect(wide.mainHorizontalPadding == 28)
        #expect(wide.showsTaskSidebar)
        #expect(wide.showsMetaPanel)
        #expect(wide.openDesignGridColumnCount == 4)

        let primary = OpenDesignDayLayoutMetrics(width: 1136)
        #expect(primary.railWidth == 48)
        #expect(primary.taskSidebarWidth == 220)
        #expect(primary.metaPanelWidth == 252)
        #expect(primary.mainHorizontalPadding == 24)
        #expect(primary.showsTaskSidebar)
        #expect(primary.showsMetaPanel)
        #expect(primary.openDesignGridColumnCount == 4)

        let medium = OpenDesignDayLayoutMetrics(width: 900)
        #expect(medium.railWidth == 48)
        #expect(medium.taskSidebarWidth == 200)
        #expect(medium.mainHorizontalPadding == 24)
        #expect(medium.showsTaskSidebar)
        #expect(!medium.showsMetaPanel)
        #expect(medium.openDesignGridColumnCount == 2)

        let narrow = OpenDesignDayLayoutMetrics(width: 820)
        #expect(narrow.railWidth == 48)
        #expect(!narrow.showsTaskSidebar)
        #expect(!narrow.showsMetaPanel)
        #expect(narrow.openDesignGridColumnCount == 2)
    }

    @Test func increasedContrastStrengthensOpenDesignChrome() {
        #expect(OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: false) == 1)
        #expect(OpenDesignAccessibilityMetrics.borderLineWidth(isIncreasedContrast: true) == 1.5)
    }

    @Test func dayFixtureContainsOpenDesignNavigationAndTasks() {
        let content = OpenDesignDayContent.day1
        let firstTask: OpenDesignTaskItem? = content.taskGroups.first?.tasks.first

        #expect(content.railItems.map(\.title) == [
            "오늘 · Day 1",
            "검색",
            "프로젝트",
            "설정",
            "인터뷰",
            "BIP 로그",
            "뉴스",
            "히스토리",
        ])
        #expect(content.taskGroups.count == 4)
        #expect(content.taskGroups.first?.tasks.count == 7)
        #expect(firstTask?.title == "먼저 도울 사람을 정해요")
        #expect(content.interviewSteps.count == 4)
        #expect(content.interviewSteps.first?.options.count == 4)
    }

    @Test func day2MarketFixtureMatchesOpenDesignDashboard() {
        let content = OpenDesignDayContent.day2
        let market = content.market
        let week1Tasks = content.taskGroups.first?.tasks ?? []

        let day1IsDone: Bool
        if case .done? = week1Tasks.first(where: { $0.id == "day1" })?.state {
            day1IsDone = true
        } else {
            day1IsDone = false
        }

        let day2IsActive: Bool
        if case .active? = week1Tasks.first(where: { $0.id == "day2" })?.state {
            day2IsActive = true
        } else {
            day2IsActive = false
        }

        #expect(day1IsDone)
        #expect(day2IsActive)
        #expect(market?.dayNumber == 2)
        #expect(market?.title == "시장 신호 읽기")
        #expect(market?.sourceTabs.map(\.title) == ["Threads", "Indie Hackers", "X / Twitter", "Reddit", "블로그·RSS"])
        #expect(market?.keywords.first?.title == "팔릴까")
        #expect(market?.signalCards.count == 3)
        #expect(market?.alternatives.count == 7)
        #expect(market?.posts.count == 5)
        #expect(content.rankedSearchItems(query: "시장 빈 자리").first?.targetSectionID == "market-gap")
    }

    @Test func dayInteractionStartsWithContextOnlyBeforeProgressiveReveal() {
        let state = OpenDesignDayInteractionState()

        #expect(state.introStage == .context)
        #expect(!state.introStage.revealsSignals)
        #expect(!state.introStage.revealsMission)
        #expect(state.currentProgressScrollTarget == .top)
        #expect(state.stepperScrollTarget(for: 1) == .mission)
    }

    @Test func dayInteractionProgressTargetFollowsIntroRevealStage() {
        var state = OpenDesignDayInteractionState()

        state.introStage = .signals
        #expect(state.currentProgressScrollTarget == .mission)

        state.introStage = .mission
        #expect(state.currentProgressScrollTarget == .mission)

        state.missionAccepted = true
        #expect(state.currentProgressScrollTarget == .interview1)
    }

    @Test func personalizedDay1RendersAdaptiveQuestionCounts() {
        for count in [3, 4, 5] {
            let content = OpenDesignDayContent.personalized(from: makePlan(questionCount: count))

            #expect(content.interviewSteps.count == count)
            #expect(content.interviewSteps.first?.title.contains("Must-have") == true)
            #expect(content.taskGroups.first?.tasks.first?.meta == "ICP · adaptive \(count)Q")
            #expect(content.plan?.signals.productName == "SupportLens")
            #expect(!content.searchItems.contains { $0.title.contains("거리") || $0.subtitle.contains("1/3") })
        }
    }

    @Test func personalizedDay1PrefersAlignmentPlanAndBuildsGoalComponents() {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )

        #expect(content.alignmentPlan?.projectGoal.contains("SupportLens") == true)
        #expect(content.interviewSteps.map(\.dimension) == ["icp", "pain_point", "outcome"])
        #expect(content.interviewSteps.map(\.title).contains { $0.contains("Pain Point") })
        #expect(content.interviewSteps.allSatisfy { $0.criteria.isEmpty })
        #expect(content.taskGroups.first?.tasks.first?.title == "30일 목표와 방향을 정해요")
        #expect(content.taskGroups.first?.tasks.first?.meta == "Alignment · goal + 3 parts")
        #expect(content.contextTitle.contains("핵심 가설"))
    }

    @Test func alignmentDraftCarriesQualityGateAndDay2Handoff() {
        let content = OpenDesignDayContent.personalized(from: makeAlignmentPlan(), fallback: nil)
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        state.selectedChoices = [1: 1, 2: 1, 3: 1]
        for step in content.interviewSteps {
            state.recordSubmittedChoice(stepID: step.id, choiceID: 1)
        }

        let draft = content.draft(for: state)

        #expect(draft.markdown.contains("Day 1 Alignment Statement"))
        #expect(draft.markdown.contains("Quality Gate"))
        #expect(draft.finalIcpStatement.contains("Pain Point"))
        #expect(draft.antiIcpBody.contains("8.4/10"))
        #expect(draft.recommendation.contains("유료 대체재"))
    }

    @Test func personalizedDay1FallsBackToLegacyIcpPlanWhenAlignmentPlanIsMissing() {
        let content = OpenDesignDayContent.personalized(
            from: nil,
            fallback: makePlan(questionCount: 4)
        )

        #expect(content.alignmentPlan == nil)
        #expect(content.plan?.signals.productName == "SupportLens")
        #expect(content.interviewSteps.count == 4)
        #expect(content.interviewSteps.allSatisfy { $0.criteria.isEmpty })
        #expect(content.taskGroups.first?.tasks.first?.title == "ICP v0 질문을 정해요")
    }

    @Test func personalizedIfAvailableReturnsNilWithoutRuntimePlan() {
        let content = OpenDesignDayContent.personalizedIfAvailable(
            from: nil,
            fallback: nil
        )

        #expect(content?.contextTitle == nil)
    }

    @Test func personalizedIfAvailableRejectsInvalidQuestionCountsWithoutFixtureFallback() {
        let tooShort = OpenDesignDayContent.personalizedIfAvailable(from: makePlan(questionCount: 2))
        let tooLong = OpenDesignDayContent.personalizedIfAvailable(from: makePlan(questionCount: 6))

        #expect(tooShort?.contextTitle == nil)
        #expect(tooLong?.contextTitle == nil)
    }

    @Test func personalizedIfAvailableReturnsPersonalizedContentForValidAlignmentPlan() {
        let content = OpenDesignDayContent.personalizedIfAvailable(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )

        #expect(content?.alignmentPlan?.projectGoal.contains("SupportLens") == true)
        #expect(content?.interviewSteps.map(\.dimension) == ["icp", "pain_point", "outcome"])
        #expect(content?.contextTitle.contains("핵심 가설") == true)
    }

    @Test func personalizedAlignmentOptionsExposeEvidenceMetadata() throws {
        let content = try #require(OpenDesignDayContent.personalizedIfAvailable(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        ))

        let firstOption = try #require(content.interviewSteps.first?.options.first)
        let weakOption = try #require(content.interviewSteps.first?.options.last)

        #expect(firstOption.evidenceLabel == "근거: README.md")
        #expect(firstOption.tail == "README.md")
        #expect(weakOption.evidenceLimited == true)
        #expect(weakOption.tail == "근거 부족")
    }

    @Test func signalDigestDisplayFallsBackFromMarkdownDocumentLinkForIcp() throws {
        let digest = Day1SignalDigest(
            schemaVersion: 1,
            rows: [
                Day1SignalDigestRow(key: "project", label: "프로젝트", value: "SupportLens", tone: "strong"),
                Day1SignalDigestRow(key: "goal", label: "목표", value: "유료 후보 1명 검증", tone: "body"),
                Day1SignalDigestRow(key: "icp", label: "ICP", value: "[VALUES.md](./VALUES.md) — 제품 가치", tone: "body"),
                Day1SignalDigestRow(key: "pain", label: "Pain", value: "Slack escalation 누락", tone: "mark"),
                Day1SignalDigestRow(key: "outcome", label: "Outcome", value: "계정 리스크를 더 빨리 판단", tone: "strong"),
                Day1SignalDigestRow(key: "evidence", label: "근거", value: "docs/GOAL.md, docs/ICP.md", tone: "code"),
            ],
            summary: "SupportLens는 Slack escalation 누락을 검증한다."
        )
        let plan = makeAlignmentPlan(signalDigest: digest)
        let icpRow = try #require(plan.signalDigest?.rows.first { $0.key == "icp" })
        let evidenceRow = try #require(plan.signalDigest?.rows.first { $0.key == "evidence" })

        #expect(openDesignDisplaySignalDigestValue(for: icpRow, alignmentPlan: plan) == "support lead")
        #expect(openDesignDisplaySignalDigestValue(for: evidenceRow, alignmentPlan: plan) == "docs/GOAL.md, docs/ICP.md")
    }

    @Test func alignmentDisplayRowsUseStructuredSanitizedValues() throws {
        let documentPointer = "[VALUES.md](./VALUES.md) — 제품 가치"
        let plan = makeAlignmentPlan(
            alignmentIcp: documentPointer,
            alignmentStatementText: "목표: SupportLens가 유료 support lead 후보 1명을 검증한다 / ICP: \(documentPointer) / Pain Point: urgent Slack escalation을 놓침 / Outcome: 계정 리스크 escalation을 더 빨리 판단한다"
        )

        let rows = openDesignAlignmentDisplayRows(for: plan)
        let joinedValues = rows.map(\.value).joined(separator: " ")

        #expect(rows.map(\.id) == ["goal", "icp", "pain", "outcome"])
        #expect(rows.first { $0.id == "icp" }?.value == "support lead")
        #expect(rows.first { $0.id == "outcome" }?.isAccent == true)
        #expect(!joinedValues.contains("VALUES.md"))
        #expect(!joinedValues.contains("[VALUES.md]"))
        #expect(!joinedValues.contains(" / ICP:"))
    }

    @Test func personalizedKeepsFixtureFallbackForPreviewsAndReferenceTests() {
        let content = OpenDesignDayContent.personalized(
            from: nil,
            fallback: nil
        )

        #expect(content.contextTitle == "오늘은 첫 고객 1명을 정하는 게 목표예요.")
    }

    @Test func personalizedDraftReflectsSelectionsInIcpAndAntiIcp() throws {
        let content = OpenDesignDayContent.personalized(from: makePlan(questionCount: 4))
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        state.selectedChoices = [1: 1, 2: 1, 3: 1, 4: 2]
        for step in content.interviewSteps {
            state.recordSubmittedChoice(stepID: step.id, choiceID: state.selectedChoices[step.id] ?? 1)
        }

        let draft = content.draft(for: state)

        #expect(draft.markdown.contains("Day 1 selections"))
        #expect(draft.markdown.contains("Slack 수동 확인"))
        #expect(draft.antiIcpBody.contains("최근 사건이 없으면 제외"))
        #expect(!draft.finalIcpStatement.contains("macOS 1인 개발자"))
    }

    @Test func searchTargetsUseDeclaredSectionAnchors() {
        let content = OpenDesignDayContent.day1
        let knownAnchors = Set(OpenDesignSectionAnchor.allCases.map(\.rawValue))
        let searchItems: [OpenDesignSearchItem] = content.searchItems

        #expect(searchItems.compactMap(\.targetSectionID).allSatisfy { knownAnchors.contains($0) })
        #expect(knownAnchors.contains(OpenDesignSectionAnchor.finalIcp.rawValue))
        #expect(!searchItems.contains { $0.id == "section-preview" })
        #expect(!searchItems.contains { $0.id == "section-gate" })
    }

    @Test func searchRankingMatchesDayAliasesAndSections() {
        let content = OpenDesignDayContent.day1

        #expect(content.rankedSearchItems(query: "day3").first?.title == "Mom Test 인터뷰 ×3")
        #expect(content.rankedSearchItems(query: "3").first?.title == "Mom Test 인터뷰 ×3")
        #expect(content.rankedSearchItems(query: "핵심 가설").first?.id == "section-final")
        #expect(content.rankedSearchItems(query: "settings").isEmpty)
        #expect(content.rankedSearchItems(query: "설정").first?.title == "설정")
        #expect(content.rankedSearchItems(query: "day8").first?.id == "task-day8")
        #expect(content.rankedSearchItems(query: "day8").first?.isLocked == true)
    }

    @Test func searchKeyboardSelectionDoesNotSkipLockedRowsLikeDayHtml() throws {
        let results = OpenDesignSearchPresentation.displayOrdered(
            OpenDesignDayContent.day1.rankedSearchItems(query: "day")
        )
        let day7Index = try #require(results.firstIndex { $0.id == "task-day7" })
        let day8Index = try #require(results.firstIndex { $0.id == "task-day8" })

        #expect(results[day8Index].isLocked)
        #expect(OpenDesignSearchSelection.movedIndex(from: day7Index, delta: 1, resultCount: results.count) == day8Index)
        #expect(OpenDesignSearchSelection.movedIndex(from: 0, delta: -1, resultCount: results.count) == results.count - 1)
    }

    @Test func searchPresentationOrderMatchesGroupedPaletteRows() throws {
        let results = OpenDesignSearchPresentation.displayOrdered(
            OpenDesignDayContent.day1.rankedSearchItems(query: "")
        )
        let firstPageIndex = try #require(results.firstIndex { $0.kind == .page })
        let lastTaskIndex = try #require(results.lastIndex { $0.kind == .task })

        #expect(results.first?.id == "task-day1")
        #expect(lastTaskIndex < firstPageIndex)
        #expect(results.dropFirst(firstPageIndex).allSatisfy { $0.kind == .page })
    }

    @Test func initialSearchAvailabilityMatchesMountedDaySections() {
        let content = OpenDesignDayContent.day1
        let state = OpenDesignDayInteractionState()
        let availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))

        #expect(availableIDs.contains("section-signals"))
        #expect(availableIDs.contains("section-mission"))
        #expect(availableIDs.contains("section-guide"))
        #expect(availableIDs.contains("task-day3"))
        #expect(!content.searchItems.contains { $0.id == "section-slot" })
        #expect(!content.searchItems.contains { $0.id == "section-message" })
        #expect(!content.searchItems.contains { $0.id == "section-preview" })
        #expect(!content.searchItems.contains { $0.id == "section-candidate" })
        #expect(!content.searchItems.contains { $0.id == "section-gate" })
        #expect(!availableIDs.contains("section-interview1"))
        #expect(!availableIDs.contains("section-picker"))
        #expect(!availableIDs.contains("section-final"))
    }

    @Test func searchAvailabilityAdvancesWithOpenDesignDayFlow() {
        let content = OpenDesignDayContent.day1
        var state = OpenDesignDayInteractionState()
        state.missionAccepted = true
        var availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))

        #expect(availableIDs.contains("section-interview1"))
        #expect(availableIDs.contains("section-picker"))
        #expect(!availableIDs.contains("section-final"))

        state.submittedSteps.formUnion([1, 2, 3, 4])
        availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))
        #expect(availableIDs.contains("section-final"))
    }

    @Test func realisticConfettiRecipeMatchesCanvasRealisticReference() {
        let recipes = RealisticConfettiRecipe.realistic

        #expect(RealisticConfettiRecipe.origin == CGPoint(x: 0.5, y: 0.70))
        #expect(RealisticConfettiRecipe.cleanupDelay == 2.20)
        #expect(recipes.count == 5)
        #expect(RealisticConfettiRecipe.totalParticleCount == 200)
        #expect(recipes.map(\.particleCount) == [50, 40, 70, 20, 20])
        #expect(recipes.map(\.spreadDegrees) == [26, 60, 100, 120, 120])
        #expect(recipes.map(\.startVelocity) == [55, 45, 45, 25, 45])
        #expect(recipes.map(\.decay) == [0.90, 0.90, 0.91, 0.92, 0.90])
        #expect(recipes.map(\.scalar).contains(0.8))
        #expect(recipes.map(\.scalar).contains(1.2))
        #expect(recipes.allSatisfy { $0.drift == 0 })
        #expect(RealisticConfettiRecipe.demoPaletteHexes == [
            "#26CCFF",
            "#A25AFD",
            "#FF5E7E",
            "#88FF5A",
            "#FCFF42",
            "#FFA62D",
            "#FF36FF",
            "#4BDE80"
        ])
    }

    @Test func lockedFutureVariantKeepsDay1OpenAndLocksLaterDays() {
        let content = OpenDesignDayContent.day1.lockingFutureDays
        let week1Tasks = content.taskGroups.first?.tasks ?? []

        let day1IsActive: Bool
        if case .active? = week1Tasks.first(where: { $0.id == "day1" })?.state {
            day1IsActive = true
        } else {
            day1IsActive = false
        }

        let day2IsLocked: Bool
        if case .locked? = week1Tasks.first(where: { $0.id == "day2" })?.state {
            day2IsLocked = true
        } else {
            day2IsLocked = false
        }

        #expect(day1IsActive)
        #expect(day2IsLocked)
        #expect(content.rankedSearchItems(query: "day2").first?.isLocked == true)
    }

    @Test func postDay2LockingKeepsDay1AndDay2OpenThenLocksLaterDays() {
        let content = OpenDesignDayContent.day1.lockingDaysAfterSecond
        let week1Tasks = content.taskGroups.first?.tasks ?? []

        let day1IsActive: Bool
        if case .active? = week1Tasks.first(where: { $0.id == "day1" })?.state {
            day1IsActive = true
        } else {
            day1IsActive = false
        }

        let day2IsPending: Bool
        if case .pending? = week1Tasks.first(where: { $0.id == "day2" })?.state {
            day2IsPending = true
        } else {
            day2IsPending = false
        }

        let lockedFutureIDs = ["day3", "day4", "day5", "day6", "day7"].filter { id in
            if case .locked? = week1Tasks.first(where: { $0.id == id })?.state {
                return true
            }
            return false
        }

        #expect(day1IsActive)
        #expect(day2IsPending)
        #expect(lockedFutureIDs == ["day3", "day4", "day5", "day6", "day7"])
        #expect(content.rankedSearchItems(query: "day2").first?.isLocked == false)
        #expect(content.rankedSearchItems(query: "day3").first?.isLocked == true)
        #expect(content.rankedSearchItems(query: "day7").first?.isLocked == true)
    }

    @Test func postDay2LockingAppliesAfterProgressProjection() {
        let snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 2,
            completedDays: [1]
        )
        let content = OpenDesignDayContent.day2
            .applyingFoundationProgress(snapshot, selectedDay: 2)
            .lockingDaysAfterSecond
        let week1Tasks = content.taskGroups.first?.tasks ?? []

        let day2IsActive: Bool
        if case .active? = week1Tasks.first(where: { $0.id == "day2" })?.state {
            day2IsActive = true
        } else {
            day2IsActive = false
        }

        let day3IsLocked: Bool
        if case .locked? = week1Tasks.first(where: { $0.id == "day3" })?.state {
            day3IsLocked = true
        } else {
            day3IsLocked = false
        }
        let day3Search = content.rankedSearchItems(query: "day3").first

        #expect(day2IsActive)
        #expect(day3IsLocked)
        #expect(day3Search?.isActive == false)
        #expect(day3Search?.isLocked == true)
        #expect(day3Search?.targetSectionID == nil)
        #expect(day3Search?.route == .inert)
    }

    @Test func openDesignRoutePolicySupportsOnlyFirstTwoDays() {
        #expect(OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 1))
        #expect(OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 2))
        #expect(!OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 3))
        #expect(!OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 8))
        #expect(!OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: 30))
    }

    @Test func weekProgressLocksFutureWeeksCollapsedByDefault() {
        let snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 1,
            completedDays: []
        )
        let content = OpenDesignDayContent.day1.applyingFoundationProgress(snapshot, selectedDay: 1)
        let week1 = content.taskGroups.first(where: { $0.id == "week1" })
        let week2 = content.taskGroups.first(where: { $0.id == "week2" })
        let week3 = content.taskGroups.first(where: { $0.id == "week3" })
        let week4 = content.taskGroups.first(where: { $0.id == "week4" })

        #expect(week1?.isExpandedByDefault == true)
        #expect(week2?.isExpandedByDefault == false)
        #expect(week2?.isLocked == true)
        #expect(week2?.tasks.count == 7)
        #expect(week3?.isLocked == true)
        #expect(week4?.isLocked == true)
        #expect(content.rankedSearchItems(query: "day30").first?.isLocked == true)

        let day8IsLocked: Bool
        if case .locked? = week2?.tasks.first(where: { $0.id == "day8" })?.state {
            day8IsLocked = true
        } else {
            day8IsLocked = false
        }
        #expect(day8IsLocked)
    }

    @Test func weekProgressUnlocksOnlyAfterPreviousWeeksAreComplete() {
        let partialWeek1 = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 7,
            completedDays: Set(1...6)
        )
        let partialContent = OpenDesignDayContent.day1.applyingFoundationProgress(partialWeek1, selectedDay: 7)
        #expect(partialContent.taskGroups.first(where: { $0.id == "week2" })?.isLocked == true)

        let week2Snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 8,
            completedDays: Set(1...7)
        )
        let week2Content = OpenDesignDayContent.day1.applyingFoundationProgress(week2Snapshot, selectedDay: 8)
        let week2 = week2Content.taskGroups.first(where: { $0.id == "week2" })

        #expect(week2?.isLocked == false)
        #expect(week2?.isExpandedByDefault == true)
        #expect(week2?.tasks.count == 7)
        let day8IsActive: Bool
        if case .active? = week2?.tasks.first(where: { $0.id == "day8" })?.state {
            day8IsActive = true
        } else {
            day8IsActive = false
        }
        #expect(day8IsActive)
        #expect(week2Content.taskGroups.first(where: { $0.id == "week3" })?.isLocked == true)

        let week3Snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 15,
            completedDays: Set(1...14)
        )
        let week3Content = OpenDesignDayContent.day1.applyingFoundationProgress(week3Snapshot, selectedDay: 15)
        #expect(week3Content.taskGroups.first(where: { $0.id == "week3" })?.isLocked == false)
        #expect(week3Content.taskGroups.first(where: { $0.id == "week4" })?.isLocked == true)

        let week4Snapshot = FoundationProgressSnapshot(
            workspaceRoot: "/tmp/project",
            startedAt: Date(timeIntervalSince1970: 1_777_000_000),
            selectedDay: 22,
            completedDays: Set(1...21)
        )
        let week4Content = OpenDesignDayContent.day1.applyingFoundationProgress(week4Snapshot, selectedDay: 22)
        #expect(week4Content.taskGroups.first(where: { $0.id == "week4" })?.isLocked == false)
        #expect(week4Content.taskGroups.first(where: { $0.id == "week4" })?.tasks.count == 9)
    }

    @Test func interactionProgressFollowsOpenDesignDayFlow() {
        var state = OpenDesignDayInteractionState()

        #expect(!state.missionAccepted)
        #expect(state.highestVisibleInterviewStep == 1)
        #expect(state.progressStepCount == 1)
        #expect(state.progressPercent == 0)

        state.missionAccepted = true
        state.selectedChoices[1] = 3
        state.recordSubmittedChoice(stepID: 1, choiceID: 3)
        #expect(state.highestVisibleInterviewStep == 2)
        #expect(state.progressPercent == 47)
        #expect(state.submittedChoices[1] == 3)
        #expect(state.isCurrentSelectionSubmitted(stepID: 1))

        state.selectedChoices[1] = 2
        #expect(!state.isCurrentSelectionSubmitted(stepID: 1))
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        #expect(state.submittedChoices[1] == 2)
        #expect(state.isCurrentSelectionSubmitted(stepID: 1))

        state.submittedSteps.formUnion([2, 3, 4])
        #expect(state.allInterviewsSubmitted)
        #expect(state.progressStepCount == 3)
        #expect(state.progressPercent == 90)

        state.dayCompleted = true
        #expect(state.progressPercent == 100)
    }

    @Test func freeformAnswerCanHoldManualICPInputWithoutSubmittingCardChoice() {
        var state = OpenDesignDayInteractionState()

        state.freeformAnswer = "former teammate shipping weekly Cursor projects"

        #expect(state.selectedChoices[1] == nil)
        #expect(state.submittedChoices[1] == nil)
        #expect(!state.freeformAnswer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)
    }

    @Test func dayDraftMatchesOpenDesignPreviewCopy() {
        let content = OpenDesignDayContent.day1
        var state = OpenDesignDayInteractionState()
        state.selectedChoices = [1: 1, 2: 1, 3: 2, 4: 1]

        let draft = content.draft(for: state)

        #expect(draft.markdown.contains("- 필수 입력: 프로젝트 path, 업무 일지, 인터뷰 transcript, BIP 기록"))
        #expect(draft.recommendation == "Day 3 Mom Test 인터뷰 첫 후보로 올리고, transcript와 업무 일지를 docs/ICP.md의 evidence 섹션에 연결한다.")
        #expect(!draft.isAntiSignal)
    }

    @Test func antiSignalChoiceUpdatesDraftBoundaryCopy() {
        let content = OpenDesignDayContent.day1
        var state = OpenDesignDayInteractionState()
        state.selectedChoices = [1: 1, 2: 1, 3: 2, 4: 4]
        state.recordSubmittedChoice(stepID: 4, choiceID: 4)

        let draft = content.draft(for: state)

        #expect(draft.isAntiSignal)
        #expect(draft.antiIcpBody.contains("지난 7일 행동 없음"))
    }

    @Test func stepperScrollTargetsFollowCurrentDayState() {
        var state = OpenDesignDayInteractionState()

        #expect(state.stepperScrollTarget(for: 0) == .top)
        #expect(state.stepperScrollTarget(for: 1) == .mission)
        #expect(state.stepperScrollTarget(for: 2) == .mission)

        state.introStage = .mission
        state.missionAccepted = true
        state.submittedSteps.insert(1)
        #expect(state.stepperScrollTarget(for: 1) == .interview2)

        state.submittedSteps.formUnion([2, 3, 4])
        #expect(state.currentProgressScrollTarget == .finalIcp)
        #expect(state.stepperScrollTarget(for: 2) == .finalIcp)
    }

    @Test func interviewScrollRequestsPreferNextActionAnchors() {
        #expect(OpenDesignSectionAnchor.interview(stepID: 1, placement: .sectionContext) == .interview1)
        #expect(OpenDesignSectionAnchor.interview(stepID: 1, placement: .nextAction) == .interview1Options)
        #expect(OpenDesignSectionAnchor.interview(stepID: 4, placement: .nextAction) == .interview4Options)

        let request = OpenDesignScrollRequest(
            target: .interview(stepID: 2, placement: .nextAction),
            placement: .nextAction
        )

        #expect(request.target == .interview2Options)
        #expect(request.target.rawValue == "interview2-options")
        #expect(request.placement == .nextAction)

        let previewRequest = OpenDesignScrollRequest(target: .icpPreview, placement: .nextAction)
        #expect(previewRequest.resolvedTarget == .icpPreviewAction)
        #expect(previewRequest.resolvedTarget.rawValue == "icp-preview-action")

        let finalRequest = OpenDesignScrollRequest(target: .finalIcp, placement: .nextAction)
        #expect(finalRequest.resolvedTarget == .finalIcpAction)

        let candidateRequest = OpenDesignScrollRequest(target: .candidate, placement: .nextAction)
        #expect(candidateRequest.resolvedTarget == .candidateAction)

        let gateRequest = OpenDesignScrollRequest(target: .gate, placement: .nextAction)
        #expect(gateRequest.resolvedTarget == .gateAction)
    }

    @Test func referencePagesCoverOpenDesignTargetScreens() {
        let targetKinds: [OpenDesignReferencePageKind] = [.news, .projects, .settings, .interviews, .bipLog, .history]
        let pageIDs = Set(OpenDesignDayContent.day1.searchItems.map(\.id))
        let railIDs = Set(OpenDesignDayContent.day1.railItems.map(\.id))

        #expect(targetKinds.count == OpenDesignReferencePageKind.allCases.count)
        #expect(Set(targetKinds).count == 6)

        for kind in targetKinds {
            let page = OpenDesignReferenceCatalog.page(kind)
            let searchID = kind == .bipLog ? "page-bip" : "page-\(kind.rawValue)"

            #expect(OpenDesignReferencePageKind(railItemID: kind.railItemID) == kind)
            #expect(OpenDesignReferencePageKind(searchItemID: searchID) == kind)
            #expect(railIDs.contains(kind.railItemID))
            #expect(pageIDs.contains(searchID))
            #expect(!page.sideGroups.isEmpty)
            #expect(!page.sections.isEmpty)
            #expect(!page.meta.cards.isEmpty)
        }
    }

    @Test func referenceCatalogCarriesDistinctNativePageContent() {
        #expect(OpenDesignReferenceCatalog.page(.projects).header.title.contains("Agentic30"))
        #expect(OpenDesignReferenceCatalog.page(.settings).sections.contains { $0.id == "providers" })
        #expect(OpenDesignReferenceCatalog.page(.interviews).sections.contains { $0.id == "mom" })
        #expect(OpenDesignReferenceCatalog.page(.bipLog).sections.contains { $0.id == "draft" })
        #expect(OpenDesignReferenceCatalog.page(.news).sections.contains { $0.id == "customer" })
        #expect(OpenDesignReferenceCatalog.page(.history).sections.contains { $0.id == "today" })
    }

    @Test func bipResearchLoadingEmptyHidesResultLikeSections() {
        let snapshot = bipResearchSnapshot(state: "refreshing")
        let visibility = openDesignBipVisibility(for: snapshot)
        let mainLabels = bipMainLabels(for: visibility)
        let sidebarFallbackLabels = bipSidebarFallbackLabels(for: visibility)

        #expect(visibility.isLoadingEmpty)
        #expect(!visibility.showsFilterBar)
        #expect(!visibility.showsResearchSection)
        #expect(!visibility.showsDraftSection)
        #expect(!visibility.showsSidebarSourceFilters)
        #expect(!visibility.showsFallbackSignals)
        #expect(!visibility.showsSidebarSignalSection)
        #expect(!mainLabels.contains("리서치된 게시글"))
        #expect(!mainLabels.contains("BIP 초안"))
        #expect(!mainLabels.contains("선택 후보 없음"))
        #expect(!sidebarFallbackLabels.contains("X/Threads 공개 기록"))
        #expect(!sidebarFallbackLabels.contains("확인할 공백"))
    }

    @Test func bipResearchRefreshingWithCachedCandidatesKeepsResultSections() throws {
        let snapshot = bipResearchSnapshot(
            state: "refreshing",
            candidates: [try bipResearchCandidateFixture()]
        )
        let visibility = openDesignBipVisibility(for: snapshot)

        #expect(!visibility.isLoadingEmpty)
        #expect(visibility.showsFilterBar)
        #expect(visibility.showsResearchSection)
        #expect(visibility.showsDraftSection)
        #expect(visibility.showsSidebarSourceFilters)
    }

    private func bipResearchSnapshot(
        state: String,
        candidates: [BipResearchCandidate] = [],
        signals: [BipResearchSignal] = []
    ) -> BipResearchSnapshot {
        BipResearchSnapshot(
            schemaVersion: 1,
            contentLocale: "ko-KR",
            promptProfile: "test",
            contextFingerprint: "test",
            generatedAt: nil,
            nextRefreshAfter: nil,
            dayNumber: 1,
            dayTitle: "Day 1",
            dayPhase: "foundation",
            status: bipResearchStatus(state: state),
            briefTitle: "Day 1 기준 X/Threads 공개 게시글에서 ICP 신호를 찾습니다.",
            briefBody: "Exa Search 결과를 Web Fetch로 다시 읽습니다.",
            querySummary: "site:x.com OR site:threads.net ICP",
            candidateTargetCount: 18,
            workspaceEvidenceRefs: [],
            signals: signals,
            candidates: candidates
        )
    }

    private func bipResearchStatus(state: String) -> BipResearchStatus {
        BipResearchStatus(
            state: state,
            lastSuccessAt: nil,
            stale: false,
            error: nil,
            reason: "daily",
            researchSource: "Codex Exa MCP",
            stage: "running_provider_research",
            progressText: "Codex Exa MCP로 공개 근거를 검색하는 중",
            elapsedMs: nil,
            stepIndex: 4,
            stepCount: 6,
            partialFailures: nil
        )
    }

    private func bipResearchCandidateFixture() throws -> BipResearchCandidate {
        let payload = """
        {
          "id": "candidate-1",
          "title": "Builder — Claude Code BIP 후보",
          "sourceLabel": "x",
          "source": "@builder",
          "sourceType": "x",
          "medium": "X thread",
          "date": "2026-05-21",
          "matchLabel": "강",
          "matchCaption": "match",
          "quote": "Claude Code로 빌드 과정을 공개합니다.",
          "whyTitle": "왜 ICP 증거인가",
          "whyBody": "macOS agentic coding 워크플로와 맞습니다.",
          "usageTitle": "BIP 활용",
          "usageBody": "DM 후보로 저장합니다.",
          "gap": "전업 여부 확인",
          "tags": [
            { "title": "X", "tone": "sky" }
          ],
          "sourceRefs": [
            {
              "id": "src-1",
              "sourceType": "x",
              "platform": "x",
              "title": "Fetched post",
              "url": "https://x.com/builder/status/1",
              "domain": "x.com",
              "publishedAt": "2026-05-21",
              "fetchedAt": "2026-05-21T00:00:00.000Z",
              "excerpt": "Fetched excerpt"
            }
          ],
          "draft": "오늘 BIP 초안",
          "evidenceStrength": "strong"
        }
        """

        return try JSONDecoder().decode(BipResearchCandidate.self, from: Data(payload.utf8))
    }

    private func bipMainLabels(for visibility: OpenDesignBipVisibility) -> Set<String> {
        var labels: Set<String> = ["ICP 리서치 큐"]
        if visibility.showsResearchSection {
            labels.insert("리서치된 게시글")
        }
        if visibility.showsDraftSection {
            labels.insert("BIP 초안")
            labels.insert("선택 후보 없음")
        }
        return labels
    }

    private func bipSidebarFallbackLabels(for visibility: OpenDesignBipVisibility) -> Set<String> {
        guard visibility.showsFallbackSignals else { return [] }
        return ["X/Threads 공개 기록", "확인할 공백"]
    }

    private func makeAlignmentPlan(
        signalDigest: Day1SignalDigest? = nil,
        alignmentIcp: String = "B2B SaaS support lead",
        alignmentStatementText: String? = nil
    ) -> Day1AlignmentPlan {
        let signals = Day1IcpSignals(
            productName: "SupportLens",
            currentIcpGuess: "B2B SaaS support lead",
            likelyUsers: ["support lead"],
            problem: "urgent Slack escalation을 놓침",
            currentAlternatives: ["Slack 수동 확인"],
            evidenceRefs: [Day1IcpEvidenceRef(path: "README.md", reason: "README", quote: "# SupportLens")],
            missingAssumptions: [],
            confidence: "high"
        )
        let icp = Day1AlignmentComponent(
            id: "icp",
            title: "ICP",
            prompt: "먼저 검증할 고객은?",
            helperText: "고객 조건",
            statement: "B2B SaaS support lead",
            evidence: ["README.md: README"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "o1", label: "support lead", description: "현재 고객 · 근거: README.md", preview: "ICP", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "o2", label: "관심만 있음", description: "근거 부족: 최근 사건 없음", preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let pain = Day1AlignmentComponent(
            id: "pain_point",
            title: "Pain Point",
            prompt: "압축된 통증은?",
            helperText: "비용 신호",
            statement: "urgent Slack escalation을 놓침",
            evidence: ["docs/SPEC.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "o1", label: "Slack 누락", description: "반복됨", preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "o2", label: "불편만 있음", description: "행동 없음", preview: "Weak", antiSignal: true),
            ]
        )
        let outcome = Day1AlignmentComponent(
            id: "outcome",
            title: "Outcome",
            prompt: "고객 결과는?",
            helperText: "Day 2 기준",
            statement: "계정 리스크 escalation을 더 빨리 판단한다",
            evidence: ["docs/GOAL.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "o1", label: "빠른 판단", description: "결과", preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "o2", label: "기능 추가", description: "빌드 도피", preview: "Anti", antiSignal: true),
            ]
        )
        return Day1AlignmentPlan(
            schemaVersion: 1,
            source: "deterministic",
            generatedAt: "2026-05-20T00:00:00.000Z",
            confidence: 0.82,
            fellBackToDeterministic: false,
            projectGoal: "SupportLens가 유료 support lead 후보 1명을 검증한다",
            mission: "Goal, ICP, Pain Point, Outcome을 정렬합니다.",
            signals: signals,
            components: Day1AlignmentComponents(icp: icp, painPoint: pain, outcome: outcome),
            alignmentStatement: Day1AlignmentStatement(
                statement: alignmentStatementText ?? "목표: SupportLens가 유료 support lead 후보 1명을 검증한다 / ICP: B2B SaaS support lead / Pain Point: urgent Slack escalation을 놓침 / Outcome: 계정 리스크 escalation을 더 빨리 판단한다",
                projectGoal: "SupportLens가 유료 support lead 후보 1명을 검증한다",
                icp: alignmentIcp,
                painPoint: "urgent Slack escalation을 놓침",
                outcome: "계정 리스크 escalation을 더 빨리 판단한다"
            ),
            qualityGate: Day1AlignmentQualityGate(
                score: 8.4,
                threshold: 7.0,
                passed: true,
                label: "PASS",
                passGate: "핵심 가설이 7.0/10 이상",
                failGate: "목표, 고객, 통증, 결과 중 하나가 비어 있음",
                criteria: [
                    Day1AlignmentQualityCriterion(id: "project_goal", label: "Project goal", score: 2.0, maxScore: 2.0, passed: true, detail: "명확함")
                ]
            ),
            firstInterviewMessage: FirstInterviewMessage(
                channel: "DM/email/Slack",
                recipientPlaceholder: "{name}",
                subject: "핵심 가설 인터뷰",
                bodyTemplate: "안녕하세요 {name}님, SupportLens 핵심 가설을 확인하고 있습니다.",
                questions: ["최근 사건?"]
            ),
            day2Handoff: Day1Day2Handoff(
                title: "Day 2 시장 신호로 넘길 핵심 가설",
                body: "Day 2에서 유료 대체재를 확인합니다.",
                focus: "목표: SupportLens...",
                nextDayPrompt: "유료 대체재 5개를 찾는다.",
                qualityGateLabel: "PASS 8.4/10"
            ),
            signalDigest: signalDigest
        )
    }

    private func makePlan(questionCount: Int) -> Day1IcpPlan {
        let dimensions = ["must_have", "core_need", "current_alternative", "bad_fit_boundary", "reference_customer", "overflow"]
        let questions = dimensions.prefix(questionCount).enumerated().map { index, dimension in
            Day1IcpQuestion(
                id: "q\(index + 1)_\(dimension)",
                dimension: dimension,
                title: "질문 \(index + 1)",
                prompt: "\(dimension) prompt?",
                helperText: "scan 기반 질문",
                options: [
                    Day1IcpQuestionOption(id: "o1", label: index == 2 ? "Slack 수동 확인" : "좋은 조건 \(index + 1)", description: "현재 행동이 있음", preview: "Have", antiSignal: false),
                    Day1IcpQuestionOption(id: "o2", label: "관심만 있음", description: "최근 사건 없음", preview: "Weak", antiSignal: dimension == "bad_fit_boundary"),
                ],
                allowFreeText: true,
                freeTextPlaceholder: "직접 입력"
            )
        }

        return Day1IcpPlan(
            schemaVersion: 1,
            source: "deterministic",
            generatedAt: "2026-05-20T00:00:00.000Z",
            confidence: 0.66,
            fellBackToDeterministic: false,
            mission: "SupportLens의 ICP v0를 좁힙니다.",
            signals: Day1IcpSignals(
                productName: "SupportLens",
                currentIcpGuess: "B2B SaaS support lead",
                likelyUsers: ["support lead"],
                problem: "urgent Slack escalation을 놓침",
                currentAlternatives: ["Slack 수동 확인"],
                evidenceRefs: [Day1IcpEvidenceRef(path: "README.md", reason: "README", quote: "# SupportLens")],
                missingAssumptions: ["reference_customer"],
                confidence: "medium"
            ),
            questions: Array(questions),
            icpDraft: IcpDraft(
                description: "B2B SaaS support lead 중 urgent Slack escalation을 놓치는 팀.",
                criteria: ["현재 대안이 있다"],
                whyTheyMatter: ["짧은 sales cycle"],
                needs: ["누락 방지"],
                haves: ["Slack"],
                dontNeeds: ["관심만 있음"],
                evidence: ["README.md: README"],
                referenceCustomersToFind: ["support lead 1명"]
            ),
            antiIcp: Day1AntiIcp(
                summary: "최근 사건이 없으면 제외",
                rules: [AntiIcpRule(id: "polite", label: "흥미롭네요만 말함", reason: "polite interest", evidenceRef: nil)],
                politeInterestGuardrails: ["최근 7일 사건 묻기"]
            ),
            firstInterviewMessage: FirstInterviewMessage(
                channel: "DM/email/Slack",
                recipientPlaceholder: "{name}",
                subject: "ICP 인터뷰",
                bodyTemplate: "안녕하세요 {name}님, SupportLens ICP 인터뷰를 부탁드려요.",
                questions: ["최근 사건?"]
            )
        )
    }

}

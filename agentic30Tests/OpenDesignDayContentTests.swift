import CoreFoundation
import Foundation
import Testing
@testable import agentic30

struct OpenDesignDayContentTests {
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

    @Test func searchTargetsUseDeclaredSectionAnchors() {
        let content = OpenDesignDayContent.day1
        let knownAnchors = Set(OpenDesignSectionAnchor.allCases.map(\.rawValue))
        let searchItems: [OpenDesignSearchItem] = content.searchItems

        #expect(searchItems.compactMap(\.targetSectionID).allSatisfy { knownAnchors.contains($0) })
        #expect(knownAnchors.contains(OpenDesignSectionAnchor.icpPreview.rawValue))
        #expect(knownAnchors.contains(OpenDesignSectionAnchor.finalIcp.rawValue))
    }

    @Test func searchRankingMatchesDayAliasesAndSections() {
        let content = OpenDesignDayContent.day1

        #expect(content.rankedSearchItems(query: "day3").first?.title == "Mom Test 인터뷰 ×3")
        #expect(content.rankedSearchItems(query: "3").first?.title == "Mom Test 인터뷰 ×3")
        #expect(content.rankedSearchItems(query: "문서 미리보기").first?.kind == .section)
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
        #expect(availableIDs.contains("section-tutor"))
        #expect(availableIDs.contains("task-day3"))
        #expect(availableIDs.contains("section-interview1"))
        #expect(availableIDs.contains("section-picker"))
        #expect(!availableIDs.contains("section-preview"))
        #expect(!availableIDs.contains("section-final"))
        #expect(!availableIDs.contains("section-candidate"))
        #expect(!availableIDs.contains("section-slot"))
        #expect(!availableIDs.contains("section-message"))
        #expect(!availableIDs.contains("section-gate"))
    }

    @Test func searchAvailabilityAdvancesWithOpenDesignDayFlow() {
        let content = OpenDesignDayContent.day1
        var state = OpenDesignDayInteractionState()
        state.missionAccepted = true
        var availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))

        #expect(availableIDs.contains("section-interview1"))
        #expect(availableIDs.contains("section-picker"))
        #expect(!availableIDs.contains("section-preview"))

        state.submittedSteps.formUnion([1, 2, 3, 4])
        availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))
        #expect(availableIDs.contains("section-preview"))
        #expect(!availableIDs.contains("section-final"))

        state.handoffIndex = 3
        availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))
        #expect(availableIDs.contains("section-final"))
        #expect(availableIDs.contains("section-candidate"))
        #expect(availableIDs.contains("section-slot"))
        #expect(!availableIDs.contains("section-message"))
        #expect(!availableIDs.contains("section-gate"))

        state.handoffIndex = 5
        availableIDs = Set(content.searchItems.filter(state.isSearchItemAvailable).map(\.id))
        #expect(availableIDs.contains("section-message"))
        #expect(availableIDs.contains("section-gate"))
    }

    @Test func completionBurstMatchesOpenDesignConfettiTimingAndOrigin() {
        let particles = OpenDesignCompletionBurstParticle.reference

        #expect(OpenDesignCompletionBurstParticle.originYRatio == 0.72)
        #expect(OpenDesignCompletionBurstParticle.duration == 1.50)
        #expect(particles.count == 100)
        #expect(Set(particles.map(\.paletteIndex).map { $0 % 5 }).count == 5)
        #expect(particles.allSatisfy { $0.width >= 4 && $0.height >= 6 })
        #expect(particles.contains { abs($0.x) > 60 })
        #expect(particles.contains { $0.y < -90 })
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

    @Test func interactionProgressFollowsOpenDesignDayFlow() {
        var state = OpenDesignDayInteractionState()

        #expect(!state.missionAccepted)
        #expect(state.highestVisibleInterviewStep == 1)
        #expect(state.progressStepCount == 2)
        #expect(state.progressPercent == 50)

        state.missionAccepted = true
        state.selectedChoices[1] = 3
        state.recordSubmittedChoice(stepID: 1, choiceID: 3)
        #expect(state.highestVisibleInterviewStep == 2)
        #expect(state.progressPercent == 58)
        #expect(state.submittedChoices[1] == 3)
        #expect(state.isCurrentSelectionSubmitted(stepID: 1))

        state.selectedChoices[1] = 2
        #expect(!state.isCurrentSelectionSubmitted(stepID: 1))
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        #expect(state.submittedChoices[1] == 2)
        #expect(state.isCurrentSelectionSubmitted(stepID: 1))

        state.submittedSteps.formUnion([2, 3, 4])
        #expect(state.allInterviewsSubmitted)
        #expect(state.progressStepCount == 4)
        #expect(state.progressPercent == 75)

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

    @Test func antiSignalChoiceUpdatesDraftAndGateState() {
        let content = OpenDesignDayContent.day1
        var state = OpenDesignDayInteractionState()
        state.selectedChoices = [1: 1, 2: 1, 3: 2, 4: 4]
        state.recordSubmittedChoice(stepID: 4, choiceID: 4)

        let draft = content.draft(for: state)

        #expect(draft.isAntiSignal)
        #expect(draft.antiIcpBody.contains("지난 7일 행동 없음"))
        #expect(!state.completedGateRows.contains(4))
        #expect(state.gateTag(id: 4, completedTag: "완료", initialPendingTag: "재확인") == "재확인")
    }

    @Test func gateRowsKeepInitialTagsThenFollowOpenDesignToggleCopy() {
        var state = OpenDesignDayInteractionState()

        #expect(state.gateTag(id: 1, completedTag: "완료 · 8.2", initialPendingTag: "대기") == "완료 · 8.2")
        #expect(state.gateTag(id: 3, completedTag: "완료", initialPendingTag: "슬롯 선택됨") == "슬롯 선택됨")

        state.toggleGateRow(3)
        #expect(state.gateTag(id: 3, completedTag: "완료", initialPendingTag: "슬롯 선택됨") == "완료")

        state.toggleGateRow(3)
        #expect(state.gateTag(id: 3, completedTag: "완료", initialPendingTag: "슬롯 선택됨") == "대기")

        state.toggleGateRow(1)
        #expect(state.gateTag(id: 1, completedTag: "완료 · 8.2", initialPendingTag: "대기") == "대기")

        state.toggleGateRow(1)
        #expect(state.gateTag(id: 1, completedTag: "완료 · 8.2", initialPendingTag: "대기") == "완료")
    }

    @Test func stepperScrollTargetsFollowCurrentDayState() {
        var state = OpenDesignDayInteractionState()

        #expect(state.stepperScrollTarget(for: 0) == "top")
        #expect(state.stepperScrollTarget(for: 1) == "mission")
        #expect(state.stepperScrollTarget(for: 2) == "mission")
        #expect(state.stepperScrollTarget(for: 3) == "interview1")

        state.missionAccepted = true
        state.submittedSteps.insert(1)
        #expect(state.stepperScrollTarget(for: 2) == "interview2")

        state.submittedSteps.formUnion([2, 3, 4])
        #expect(state.stepperScrollTarget(for: 3) == "icp-preview")

        state.handoffIndex = 3
        #expect(state.currentProgressScrollTarget == "slot")
        #expect(state.stepperScrollTarget(for: 3) == "slot")
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
}

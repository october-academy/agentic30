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
        #expect(state.stepperScrollTarget(for: 1) == .signals)
    }

    @Test func dayInteractionProgressTargetFollowsIntroRevealStage() {
        var state = OpenDesignDayInteractionState()

        state.introStage = .signals
        #expect(state.currentProgressScrollTarget == .signals)

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

    @Test func personalizedDraftReflectsSelectionsInIcpAntiIcpAndMessage() throws {
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
        #expect(draft.firstMessage.contains("SupportLens"))
        #expect(!draft.finalIcpStatement.contains("macOS 1인 개발자"))
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
        #expect(availableIDs.contains("section-guide"))
        #expect(availableIDs.contains("task-day3"))
        #expect(!availableIDs.contains("section-interview1"))
        #expect(!availableIDs.contains("section-picker"))
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

        #expect(state.stepperScrollTarget(for: 0) == .top)
        #expect(state.stepperScrollTarget(for: 1) == .signals)
        #expect(state.stepperScrollTarget(for: 2) == .mission)
        #expect(state.stepperScrollTarget(for: 3) == .mission)

        state.introStage = .mission
        state.missionAccepted = true
        state.submittedSteps.insert(1)
        #expect(state.stepperScrollTarget(for: 2) == .interview2)

        state.submittedSteps.formUnion([2, 3, 4])
        #expect(state.stepperScrollTarget(for: 3) == .icpPreview)

        state.handoffIndex = 3
        #expect(state.currentProgressScrollTarget == .slot)
        #expect(state.stepperScrollTarget(for: 3) == .slot)
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

        let slotRequest = OpenDesignScrollRequest(target: .slot, placement: .nextAction)
        #expect(slotRequest.resolvedTarget == .slotAction)

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

    @Test func referenceRoutePolicyKeepsReferencePagesAcrossTransientWorkspaceState() {
        for kind in OpenDesignReferencePageKind.allCases {
            #expect(shouldUseOpenDesignRoute(selectedReferencePage: kind, isBipCoachGenerating: true))
            #expect(shouldUseOpenDesignRoute(selectedReferencePage: kind, hasBipMissionProgress: true))
            #expect(shouldUseOpenDesignRoute(selectedReferencePage: kind, hasCurrentMission: true))
            #expect(shouldUseOpenDesignRoute(selectedReferencePage: kind, hasPendingMissionChoices: true))
            #expect(shouldUseOpenDesignRoute(selectedReferencePage: kind, hasBipCoachError: true))
            #expect(shouldUseOpenDesignRoute(selectedReferencePage: kind, hasSidecarFailure: true))
            #expect(shouldUseOpenDesignRoute(selectedReferencePage: kind, hasBipTokenExpired: true))
        }
    }

    @Test func referenceRoutePolicyStillClearsForNonOpenDesignDestinations() {
        for kind in OpenDesignReferencePageKind.allCases {
            #expect(!shouldUseOpenDesignRoute(dayNumber: 3, selectedReferencePage: kind))
            #expect(!shouldUseOpenDesignRoute(isGraduation: true, selectedReferencePage: kind))
            #expect(!shouldUseOpenDesignRoute(workspaceSectionIsCurriculum: false, selectedReferencePage: kind))
            #expect(!shouldUseOpenDesignRoute(reviewDashboardMatchesDay: true, selectedReferencePage: kind))
        }
    }

    @Test func transientWorkspaceStateWithoutReferencePageStillUsesFallbackSurfaces() {
        #expect(shouldUseOpenDesignRoute())
        #expect(!shouldUseOpenDesignRoute(isBipCoachGenerating: true))
        #expect(!shouldUseOpenDesignRoute(hasBipMissionProgress: true))
        #expect(!shouldUseOpenDesignRoute(hasCurrentMission: true))
        #expect(!shouldUseOpenDesignRoute(hasPendingMissionChoices: true))
        #expect(!shouldUseOpenDesignRoute(hasBipCoachError: true))
    }

    private func makePlan(questionCount: Int) -> Day1IcpPlan {
        let dimensions = ["must_have", "core_need", "current_alternative", "bad_fit_boundary", "reference_customer"]
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

    private func shouldUseOpenDesignRoute(
        dayNumber: Int = 1,
        workspaceSectionIsCurriculum: Bool = true,
        isGraduation: Bool = false,
        reviewDashboardMatchesDay: Bool = false,
        isIddSetupLocked: Bool = false,
        selectedReferencePage: OpenDesignReferencePageKind? = nil,
        hasBipNotificationHint: Bool = false,
        hasSidecarFailure: Bool = false,
        hasBipTokenExpired: Bool = false,
        isBipCoachGenerating: Bool = false,
        hasBipMissionProgress: Bool = false,
        hasCurrentMission: Bool = false,
        hasPendingMissionChoices: Bool = false,
        hasBipCoachError: Bool = false
    ) -> Bool {
        OpenDesignReferenceRoutePolicy.shouldUseOpenDesignDayPage(
            dayNumber: dayNumber,
            workspaceSectionIsCurriculum: workspaceSectionIsCurriculum,
            isGraduation: isGraduation,
            reviewDashboardMatchesDay: reviewDashboardMatchesDay,
            isIddSetupLocked: isIddSetupLocked,
            selectedReferencePage: selectedReferencePage,
            hasBipNotificationHint: hasBipNotificationHint,
            hasSidecarFailure: hasSidecarFailure,
            hasBipTokenExpired: hasBipTokenExpired,
            isBipCoachGenerating: isBipCoachGenerating,
            hasBipMissionProgress: hasBipMissionProgress,
            hasCurrentMission: hasCurrentMission,
            hasPendingMissionChoices: hasPendingMissionChoices,
            hasBipCoachError: hasBipCoachError
        )
    }
}

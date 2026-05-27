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
        #expect(openDesignDisplayProductName("agentic30-public") == "agentic30-public")
        #expect(openDesignDisplayProductName("**agentic30 Mac**") == "agentic30 Mac")
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

        state.acceptMissionForStepFlow()
        #expect(state.currentProgressScrollTarget == .interview1)
    }

    @Test func dayInteractionStartsUnfilledForAlignmentQuestions() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: nil
        )

        var state = OpenDesignDayInteractionState(
            totalInterviewSteps: content.interviewSteps.count
        )

        #expect(state.selectedChoices.isEmpty)
        #expect(state.submittedChoices.isEmpty)
        #expect(state.submittedSteps.isEmpty)
        #expect(state.lockedPrefillStepIDs.isEmpty)
        #expect(state.trimmedFreeformAnswer(stepID: 2).isEmpty)

        state.selectChoice(stepID: 1, choiceID: 2)
        state.setFreeformAnswer(stepID: 2, value: "덮어쓰기")

        #expect(state.selectedChoices[1] == 2)
        #expect(state.trimmedFreeformAnswer(stepID: 2) == "덮어쓰기")
    }

    @Test func dayInteractionStartsUnfilledForStaticFallback() {
        let content = OpenDesignDayContent.day1

        let state = OpenDesignDayInteractionState(
            totalInterviewSteps: content.interviewSteps.count
        )

        #expect(state.selectedChoices[1] == nil)
        #expect(state.selectedChoices[2] == nil)
        #expect(state.selectedChoices[4] == nil)
        #expect(state.submittedSteps.isEmpty)
        #expect(state.lockedPrefillStepIDs.isEmpty)
        #expect(!state.allInterviewsSubmitted)
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

    @Test func personalizedDay1HidesDirectInputFallbackOptionWhenFreeformExists() throws {
        let directFallbackOptions = [
            Day1IcpQuestionOption(id: "o1", label: "이번 주 연락 가능한 support lead", description: "현재 행동이 있음", preview: "Have", antiSignal: false),
            Day1IcpQuestionOption(id: "o2", label: "직접 입력: scan보다 더 정확한 고객 후보", description: "고객 후보 근거가 부족하면 한 줄로 보정합니다.", preview: "직접 입력", antiSignal: false, evidenceLabel: "근거 부족", evidenceLimited: true),
        ]
        let content = OpenDesignDayContent.personalized(from: makePlan(
            questionCount: 3,
            firstQuestionOptions: directFallbackOptions,
            firstQuestionAllowFreeText: true
        ))
        let noFreeformContent = OpenDesignDayContent.personalized(from: makePlan(
            questionCount: 3,
            firstQuestionOptions: directFallbackOptions,
            firstQuestionAllowFreeText: false
        ))

        let firstStep = try #require(content.interviewSteps.first)
        let noFreeformFirstStep = try #require(noFreeformContent.interviewSteps.first)

        #expect(firstStep.allowsFreeform)
        #expect(firstStep.freeformLabel == "직접 입력")
        #expect(firstStep.options.map(\.id) == [1])
        #expect(firstStep.options.map(\.title) == ["이번 주 연락 가능한 support lead"])
        #expect(!noFreeformFirstStep.allowsFreeform)
        #expect(noFreeformFirstStep.options.map(\.id) == [1, 2])
        #expect(noFreeformFirstStep.options[1].title.hasPrefix("직접 입력:"))
    }

    @Test func personalizedDay1PrefersAlignmentPlanAndBuildsGoalComponents() {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )

        #expect(content.alignmentPlan?.projectGoal.contains("SupportLens") == true)
        #expect(content.interviewSteps.map(\.dimension) == ["icp", "pain_point", "outcome"])
        #expect(content.interviewSteps.map(\.title) == ["질문 1 — 고객", "질문 2 — 문제", "질문 3 — 확인할 행동"])
        #expect(content.interviewSteps.allSatisfy { $0.criteria.isEmpty })
        #expect(content.interviewSteps[0].markedStatement == "이번 주 실제로 연락해 확인할 첫 고객 후보는 누구인가요?")
        #expect(content.interviewSteps[1].markedStatement == "선택한 고객이 지금 가장 비용을 치르는 문제는 무엇인가요?")
        #expect(content.interviewSteps[2].markedStatement == "선택한 문제가 진짜인지 이번 주 대화에서 어떤 행동 신호로 확인할까요?")
        #expect(content.interviewSteps.map(\.hintText) == [nil, nil, nil])
        #expect(content.interviewSteps.allSatisfy { openDesignQuestionHintText(for: $0) == nil })
        #expect(content.taskGroups.first?.tasks.first?.title == "30일 목표와 방향을 정해요")
        #expect(content.taskGroups.first?.tasks.first?.meta == "가설 · 목표+3요소")
        #expect(content.contextTitle.contains("핵심 가설"))
    }

    @Test func personalizedAlignmentUsesPayloadQuestionAndOptionHighlightPhrases() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )

        #expect(content.interviewSteps[0].highlightPhrases == ["첫 고객 후보", "고객 후보"])
        #expect(content.interviewSteps[1].highlightPhrases == ["비용을 치르는 문제", "문제"])
        #expect(Set(content.interviewSteps[2].highlightPhrases) == Set(["행동 신호", "확인할 행동", "검증 행동"]))

        let customerOption = try #require(content.interviewSteps[0].options.first)
        let painOption = try #require(content.interviewSteps[1].options.first)
        let outcomeOption = try #require(content.interviewSteps[2].options.first)

        #expect(customerOption.highlightPhrases == ["support lead"])
        #expect(painOption.highlightPhrases == ["Slack 누락"])
        #expect(outcomeOption.highlightPhrases == ["빠른 판단"])
    }

    @Test func highlightPhrasesDeduplicateAndIgnoreEmptyCopy() {
        let phrases = OpenDesignDayContent.InterviewStep.normalizedHighlightPhrases([
            "문제",
            " ",
            "비용을 치르는 문제",
            "문제",
            "  비용을 치르는 문제  ",
        ])
        let rendered = openDesignHighlightedAttributedText(
            "강조할 문구가 없는 질문입니다.",
            phrases: ["첫 고객 후보"],
            bodySize: 13
        )

        #expect(phrases == ["비용을 치르는 문제", "문제"])
        #expect(String(rendered.characters) == "강조할 문구가 없는 질문입니다.")
    }

    @Test func personalizedDay1KeepsFiveFrontierOptionsAndSelectionFlow() {
        let content = OpenDesignDayContent.personalized(
            from: makeFiveOptionAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)

        #expect(content.interviewSteps.map(\.options.count) == [5, 5, 5])
        #expect(content.interviewSteps[0].options[4].title == "구매권한 없는 조언자")
        #expect(state.selectedChoices[1] == nil)

        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 5)
        #expect(state.selectedChoices[1] == 5)
        state.recordSubmittedChoice(stepID: 1, choiceID: 5)
        state.selectChoice(stepID: 2, choiceID: 4)
        state.recordSubmittedChoice(stepID: 2, choiceID: 4)
        state.selectChoice(stepID: 3, choiceID: 3)
        state.recordSubmittedChoice(stepID: 3, choiceID: 3)

        #expect(state.allInterviewsSubmitted)
    }

    @Test func personalizedAlignmentOptionLabelsKeepFullKoreanCopy() throws {
        let longPainLabel = "만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다"
        let base = makeAlignmentPlan()
        let pain = Day1AlignmentComponent(
            id: base.components.painPoint.id,
            title: base.components.painPoint.title,
            prompt: base.components.painPoint.prompt,
            helperText: base.components.painPoint.helperText,
            statement: base.components.painPoint.statement,
            evidence: base.components.painPoint.evidence,
            missingAssumptions: base.components.painPoint.missingAssumptions,
            options: [
                Day1IcpQuestionOption(id: "pain-long", label: longPainLabel, description: "반복 비용이 큽니다. · 근거: docs/SPEC.md", preview: "Pain", antiSignal: false, evidenceLabel: "근거: docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "pain-weak", label: "불편만 있음", description: "행동 없음", preview: "Weak", antiSignal: true),
            ]
        )
        let plan = Day1AlignmentPlan(
            schemaVersion: base.schemaVersion,
            source: base.source,
            generatedAt: base.generatedAt,
            confidence: base.confidence,
            fellBackToDeterministic: base.fellBackToDeterministic,
            projectGoal: base.projectGoal,
            mission: base.mission,
            signals: base.signals,
            components: Day1AlignmentComponents(icp: base.components.icp, painPoint: pain, outcome: base.components.outcome),
            alignmentStatement: base.alignmentStatement,
            qualityGate: base.qualityGate,
            firstInterviewMessage: base.firstInterviewMessage,
            day2Handoff: base.day2Handoff,
            signalDigest: base.signalDigest
        )

        let content = OpenDesignDayContent.personalized(
            from: plan,
            fallback: makePlan(questionCount: 4)
        )
        let firstPainOption = try #require(content.interviewSteps.first(where: { $0.dimension == "pain_point" })?.options.first)

        #expect(firstPainOption.title == longPainLabel)
        #expect(!firstPainOption.title.contains("…"))
    }

    @Test func alignmentQuestionContextRowsShowRealPriorAnswersDuringQuestionFlow() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        let step1 = try #require(content.interviewSteps.first(where: { $0.id == 1 }))
        let step2 = try #require(content.interviewSteps.first(where: { $0.id == 2 }))
        let step3 = try #require(content.interviewSteps.first(where: { $0.id == 3 }))

        let step1Rows = openDesignAlignmentQuestionContextRows(for: step1, content: content, interaction: state)
        #expect(step1Rows.isEmpty)
        #expect(openDesignAlignmentQuestionContextRows(for: step2, content: content, interaction: state).isEmpty)

        state.selectChoice(stepID: 1, choiceID: 1)
        let step2Rows = openDesignAlignmentQuestionContextRows(for: step2, content: content, interaction: state)
        #expect(step2Rows.map(\.id) == ["icp"])
        #expect(step2Rows.map(\.label) == ["고객"])
        #expect(step2Rows.map(\.value) == ["support lead"])
        #expect(step2Rows.map(\.accessibilityLabel) == ["선택한 고객 support lead"])

        state.selectChoice(stepID: 2, choiceID: 1)
        let step3Rows = openDesignAlignmentQuestionContextRows(for: step3, content: content, interaction: state)
        #expect(step3Rows.map(\.id) == ["icp", "pain_point"])
        #expect(step3Rows.map(\.label) == ["고객", "문제"])
        #expect(step3Rows.map(\.value) == ["support lead", "Slack 누락"])
        #expect(step3Rows.map(\.accessibilityLabel) == ["선택한 고객 support lead", "선택한 문제 Slack 누락"])
    }

    @Test func alignmentQuestionContextRowsUseFreeformPriorAnswers() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: makePlan(questionCount: 4)
        )
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        let step2 = try #require(content.interviewSteps.first(where: { $0.id == 2 }))
        let step3 = try #require(content.interviewSteps.first(where: { $0.id == 3 }))

        state.setFreeformAnswer(stepID: 1, value: "  이번 주 연락할 macOS 개발자  ")
        let step2Rows = openDesignAlignmentQuestionContextRows(for: step2, content: content, interaction: state)
        #expect(step2Rows.map(\.value) == ["이번 주 연락할 macOS 개발자"])

        state.setFreeformAnswer(stepID: 2, value: "  유료 전환 전 Slack escalation 확인  ")
        let step3Rows = openDesignAlignmentQuestionContextRows(for: step3, content: content, interaction: state)
        #expect(step3Rows.map(\.label) == ["고객", "문제"])
        #expect(step3Rows.map(\.value) == ["이번 주 연락할 macOS 개발자", "유료 전환 전 Slack escalation 확인"])
    }

    @Test func questionContextRowsStayEmptyWithoutPriorSelection() throws {
        let content = OpenDesignDayContent.personalized(
            from: nil,
            fallback: makePlan(questionCount: 4)
        )
        let state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        let step1 = try #require(content.interviewSteps.first)

        #expect(openDesignAlignmentQuestionContextRows(for: step1, content: content, interaction: state).isEmpty)
    }

    @Test func alignmentDraftCarriesQualityGateAndDay2Handoff() {
        let content = OpenDesignDayContent.personalized(from: makeAlignmentPlan(), fallback: nil)
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        state.selectedChoices = [1: 1, 2: 1, 3: 1]
        for step in content.interviewSteps {
            state.recordSubmittedChoice(stepID: step.id, choiceID: 1)
        }

        let draft = content.draft(for: state)

        #expect(draft.markdown.contains("Day 1 핵심 가설"))
        #expect(draft.markdown.contains("Quality Gate"))
        #expect(draft.markdown.contains("목표:"))
        #expect(draft.markdown.contains("고객:"))
        #expect(draft.markdown.contains("문제:"))
        #expect(draft.markdown.contains("확인할 행동:"))
        #expect(draft.finalIcpStatement.contains("문제"))
        #expect(draft.finalIcpStatement.contains("확인할 행동"))
        #expect(draft.antiIcpBody.contains("8.4/10"))
        #expect(draft.recommendation.contains("유료 대체재"))
    }

    @Test func alignmentQuestionCopyKeepsIcpTitleAndSanitizesOutcomeCopy() {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(
                icpPrompt: "이 목표를 위해 Day 2에서 먼저 검증할 고객은 누구인가요?",
                outcomePrompt: "Day 2 시장 신호가 확인해야 할 고객 결과는 무엇인가요?",
                outcomeOptionDescription: "Day 2에서 바로 검증할 수 있습니다. · 근거: docs/GOAL.md"
            ),
            fallback: nil
        )
        var state = OpenDesignDayInteractionState(totalInterviewSteps: content.interviewSteps.count)
        state.selectedChoices = [1: 1, 2: 1, 3: 1]
        for step in content.interviewSteps {
            state.recordSubmittedChoice(stepID: step.id, choiceID: 1)
        }

        #expect(content.interviewSteps[0].markedStatement == "이번 주 실제로 연락해 확인할 첫 고객 후보는 누구인가요?")
        #expect(content.interviewSteps[2].markedStatement == "선택한 문제가 진짜인지 이번 주 대화에서 어떤 행동 신호로 확인할까요?")
        #expect(!content.interviewSteps[2].markedStatement.contains("Day 2"))
        #expect(content.interviewSteps[2].options[0].detail == "이번 주 대화에서 확인합니다.")
        #expect(!content.interviewSteps[2].options[0].detail.contains("Day 2"))
        #expect(!content.interviewSteps[2].options[0].detail.contains("다음 시장 신호"))
        #expect(content.alignmentPlan?.day2Handoff.title.contains("Day 2") == true)
        #expect(content.draft(for: state).recommendation.contains("유료 대체재"))
    }

    @Test func alignmentOptionDescriptionsKeepMeaningfulCopyWithoutGenericOverwrites() throws {
        let content = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(),
            fallback: nil
        )

        #expect(content.interviewSteps[0].options[0].detail == "현재 고객")
        #expect(content.interviewSteps[1].options[0].detail == "반복됨")
        #expect(content.interviewSteps[2].options[0].detail == "결과")

        let details = content.interviewSteps.flatMap { step in step.options.map(\.detail) }
        #expect(!details.contains("이번 주 대화 가능."))
        #expect(!details.contains("시간·돈·리스크 비용."))
        #expect(!details.contains("사건·대안·지불 의향 확인."))
    }

    @Test func questionHintHidesEmptyOrDuplicateDimensionCopy() throws {
        let noHelperContent = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(icpHelperText: nil),
            fallback: nil
        )
        let duplicateHelperContent = OpenDesignDayContent.personalized(
            from: makeAlignmentPlan(icpHelperText: "ICP"),
            fallback: nil
        )
        let noHelperStep = try #require(noHelperContent.interviewSteps.first)
        let duplicateHelperStep = try #require(duplicateHelperContent.interviewSteps.first)

        #expect(noHelperStep.hintText == nil)
        #expect(openDesignQuestionHintText(for: noHelperStep) == nil)
        #expect(duplicateHelperStep.hintText == nil)
        #expect(openDesignQuestionHintText(for: duplicateHelperStep) == nil)
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
        #expect(openDesignAlignmentDisplayLabel(for: "icp", fallback: icpRow.label) == "고객")
        #expect(openDesignAlignmentDisplayLabel(for: "pain", fallback: "Pain") == "문제")
        #expect(openDesignAlignmentDisplayLabel(for: "outcome", fallback: "Outcome") == "확인할 행동")
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
        #expect(rows.map(\.label) == ["목표", "고객", "문제", "확인할 행동"])
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
        #expect(state.normalizedActiveStepID == 0)
        #expect(state.maxReachableStepID == 0)
        #expect(state.highestVisibleInterviewStep == 1)
        #expect(state.progressStepCount == 1)
        #expect(state.progressPercent == 0)

        state.acceptMissionForStepFlow()
        #expect(state.normalizedActiveStepID == 1)
        #expect(state.maxReachableStepID == 1)
        state.selectChoice(stepID: 1, choiceID: 3)
        state.recordSubmittedChoice(stepID: 1, choiceID: 3)
        #expect(state.normalizedActiveStepID == 2)
        #expect(state.maxReachableStepID == 2)
        #expect(state.highestVisibleInterviewStep == 2)
        #expect(state.progressPercent == 47)
        #expect(state.submittedChoices[1] == 3)
        #expect(state.isCurrentSelectionSubmitted(stepID: 1))

        state.selectChoice(stepID: 1, choiceID: 2)
        #expect(!state.isCurrentSelectionSubmitted(stepID: 1))
        #expect(state.submittedChoices[1] == nil)
        #expect(state.revisionSteps.contains(1))
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

    @Test func stepWorkflowSupportsFocusBackAdvanceAndReset() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)

        #expect(state.workflowStepCount == 5)
        #expect(state.workflowNavigationDirection == .neutral)
        #expect(state.isWorkflowStepUnlocked(0))
        #expect(!state.isWorkflowStepUnlocked(1))

        state.acceptMissionForStepFlow()
        #expect(state.workflowNavigationDirection == .forward)
        #expect(state.activeInterviewStepID == 1)
        #expect(state.isWorkflowStepUnlocked(1))
        #expect(!state.isWorkflowStepUnlocked(2))

        state.selectChoice(stepID: 1, choiceID: 2)
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        #expect(state.workflowNavigationDirection == .forward)
        #expect(state.activeInterviewStepID == 2)
        #expect(state.isWorkflowStepUnlocked(2))

        state.moveToPreviousWorkflowStep()
        #expect(state.workflowNavigationDirection == .backward)
        #expect(state.activeInterviewStepID == 1)

        state.focusWorkflowStep(2)
        #expect(state.workflowNavigationDirection == .forward)
        #expect(state.activeInterviewStepID == 2)
        state.focusWorkflowStep(3)
        #expect(state.activeInterviewStepID == 2)

        state.recordSubmittedChoice(stepID: 2, choiceID: 1)
        state.recordSubmittedChoice(stepID: 3, choiceID: 1)
        #expect(state.workflowNavigationDirection == .forward)
        #expect(state.normalizedActiveStepID == state.finalStepID)
        #expect(state.isWorkflowStepUnlocked(state.finalStepID))

        state.resetStepFlow()
        #expect(!state.missionAccepted)
        #expect(state.normalizedActiveStepID == 0)
        #expect(state.selectedChoices.isEmpty)
        #expect(state.submittedChoices.isEmpty)
        #expect(state.progressPercent == 0)
        #expect(state.workflowNavigationDirection == .neutral)
    }

    @Test func previousFromFirstQuestionReturnsToStartPhaseWithoutResettingFlow() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)

        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 2)
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        state.focusWorkflowStep(1)

        state.moveToPreviousWorkflowStep()

        #expect(state.workflowNavigationDirection == .backward)
        #expect(state.normalizedActiveStepID == 0)
        #expect(state.activeInterviewStepID == nil)
        #expect(state.missionAccepted)
        #expect(state.selectedChoices[1] == 2)
        #expect(state.submittedChoices[1] == 2)
        #expect(state.isWorkflowStepUnlocked(1))
        #expect(state.isWorkflowStepUnlocked(2))
    }

    @Test func resumeFromStartPhaseReturnsToCurrentInterviewWithoutResettingFlow() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)

        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 2)
        state.moveToPreviousWorkflowStep()

        #expect(state.normalizedActiveStepID == 0)
        #expect(state.activeInterviewStepID == nil)

        state.resumeWorkflowFromStartPhase()

        #expect(state.normalizedActiveStepID == 1)
        #expect(state.activeInterviewStepID == 1)
        #expect(state.missionAccepted)
        #expect(state.selectedChoices[1] == 2)
        #expect(state.submittedChoices.isEmpty)
        #expect(state.isWorkflowStepUnlocked(1))
    }

    @Test func workflowNavigationDirectionTracksStepperMovement() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)
        state.acceptMissionForStepFlow()
        state.recordSubmittedChoice(stepID: 1, choiceID: 1)
        state.recordSubmittedChoice(stepID: 2, choiceID: 1)
        #expect(state.normalizedActiveStepID == 3)

        state.focusWorkflowStep(1)
        #expect(state.normalizedActiveStepID == 1)
        #expect(state.workflowNavigationDirection == .backward)

        state.focusWorkflowStep(3)
        #expect(state.normalizedActiveStepID == 3)
        #expect(state.workflowNavigationDirection == .forward)

        state.focusWorkflowStep(3)
        #expect(state.workflowNavigationDirection == .neutral)
    }

    @Test func changingSubmittedChoiceClearsCurrentAndDownstreamSubmissions() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)
        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 1)
        state.recordSubmittedChoice(stepID: 1, choiceID: 1)
        state.selectChoice(stepID: 2, choiceID: 2)
        state.recordSubmittedChoice(stepID: 2, choiceID: 2)

        state.focusWorkflowStep(1)
        state.selectChoice(stepID: 1, choiceID: 3)

        #expect(state.selectedChoices[1] == 3)
        #expect(state.submittedChoices[1] == nil)
        #expect(state.submittedChoices[2] == nil)
        #expect(state.selectedChoices[2] == nil)
        #expect(state.submittedSteps.isEmpty)
        #expect(state.revisionSteps == [1])
        #expect(state.activeInterviewStepID == 1)
        #expect(!state.isWorkflowStepUnlocked(2))
    }

    @Test func alreadySubmittedChoiceCanAdvanceWithoutResubmitting() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)
        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 2)
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        state.focusWorkflowStep(1)

        state.advancePastSubmittedChoice(stepID: 1)

        #expect(state.activeInterviewStepID == 2)
        #expect(state.submittedChoices[1] == 2)
        #expect(state.selectedChoices[1] == 2)
    }

    @Test func freeformAnswerActsAsSingleManualChoice() {
        var state = OpenDesignDayInteractionState()

        state.setFreeformAnswer(stepID: 1, value: "former teammate shipping weekly Cursor projects")

        #expect(state.selectedChoices[1] == OpenDesignDayInteractionState.freeformChoiceID)
        #expect(state.submittedChoices[1] == nil)
        #expect(!state.freeformAnswer.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty)

        state.selectChoice(stepID: 1, choiceID: 2)
        #expect(state.selectedChoices[1] == 2)
        #expect(state.freeformAnswer.isEmpty)

        state.setFreeformAnswer(stepID: 1, value: "123 macOS solo builders")

        #expect(state.selectedChoices[1] == OpenDesignDayInteractionState.freeformChoiceID)
        #expect(state.trimmedFreeformAnswer(stepID: 1) == "123 macOS solo builders")
    }

    @Test func activatingFreeformClearsSubmittedNumberChoiceUntilTextIsProvided() {
        var state = OpenDesignDayInteractionState(totalInterviewSteps: 3)
        state.acceptMissionForStepFlow()
        state.selectChoice(stepID: 1, choiceID: 2)
        state.recordSubmittedChoice(stepID: 1, choiceID: 2)
        state.focusWorkflowStep(1)

        state.activateFreeformAnswer(stepID: 1)

        #expect(state.selectedChoices[1] == nil)
        #expect(state.submittedChoices[1] == nil)
        #expect(!state.submittedSteps.contains(1))
        #expect(state.trimmedFreeformAnswer(stepID: 1).isEmpty)
        #expect(!state.isCurrentSelectionSubmitted(stepID: 1))

        state.setFreeformAnswer(stepID: 1, value: "macOS solo developer with a live onboarding bug")

        #expect(state.selectedChoices[1] == OpenDesignDayInteractionState.freeformChoiceID)
        #expect(state.submittedChoices[1] == nil)

        state.selectChoice(stepID: 1, choiceID: 3)

        #expect(state.selectedChoices[1] == 3)
        #expect(state.trimmedFreeformAnswer(stepID: 1).isEmpty)
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
        alignmentStatementText: String? = nil,
        icpPrompt: String = "먼저 검증할 고객은?",
        icpHelperText: String? = "직함보다 지금 같은 문제를 겪고, 이번 주 실제로 물어볼 수 있는 고객 조건을 고릅니다.",
        outcomePrompt: String = "고객 결과는?",
        outcomeOptionDescription: String = "결과"
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
            prompt: icpPrompt,
            highlightPhrases: ["첫 고객 후보", "고객 후보"],
            helperText: icpHelperText,
            statement: "B2B SaaS support lead",
            evidence: ["README.md: README"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "o1", label: "support lead", description: "현재 고객 · 근거: README.md", highlightPhrases: ["support lead"], preview: "ICP", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "o2", label: "관심만 있음", description: "근거 부족: 최근 사건 없음", highlightPhrases: ["관심만 있음"], preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let pain = Day1AlignmentComponent(
            id: "pain_point",
            title: "Pain Point",
            prompt: "압축된 통증은?",
            highlightPhrases: ["비용을 치르는 문제", "문제"],
            helperText: "비용 신호",
            statement: "urgent Slack escalation을 놓침",
            evidence: ["docs/SPEC.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "o1", label: "Slack 누락", description: "반복됨", highlightPhrases: ["Slack 누락"], preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "o2", label: "불편만 있음", description: "행동 없음", highlightPhrases: ["불편만 있음"], preview: "Weak", antiSignal: true),
            ]
        )
        let outcome = Day1AlignmentComponent(
            id: "outcome",
            title: "Outcome",
            prompt: outcomePrompt,
            highlightPhrases: ["행동 신호", "확인할 행동", "검증 행동"],
            helperText: "Day 2 기준",
            statement: "계정 리스크 escalation을 더 빨리 판단한다",
            evidence: ["docs/GOAL.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "o1", label: "빠른 판단", description: outcomeOptionDescription, highlightPhrases: ["빠른 판단"], preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "o2", label: "기능 추가", description: "빌드 도피", highlightPhrases: ["기능 추가"], preview: "Anti", antiSignal: true),
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

    private func makeFiveOptionAlignmentPlan() -> Day1AlignmentPlan {
        let base = makeAlignmentPlan()
        let icp = Day1AlignmentComponent(
            id: base.components.icp.id,
            title: base.components.icp.title,
            prompt: base.components.icp.prompt,
            helperText: base.components.icp.helperText,
            statement: base.components.icp.statement,
            evidence: base.components.icp.evidence,
            missingAssumptions: base.components.icp.missingAssumptions,
            options: [
                Day1IcpQuestionOption(id: "icp1", label: "support lead", description: "현재 고객 · 근거: README.md", preview: "ICP", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "icp2", label: "customer success lead", description: "SLA 리스크를 직접 관리합니다. · 근거: docs/ICP.md", preview: "ICP", antiSignal: false, evidenceLabel: "근거: docs/ICP.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "icp3", label: "온콜 운영 담당자", description: "반복 알림 누락 비용을 압니다. · 근거: docs/SPEC.md", preview: "ICP", antiSignal: false, evidenceLabel: "근거: docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "icp4", label: "B2B SaaS 운영자", description: "작은 팀에서 지원 흐름을 직접 고칩니다. · 근거: docs/GOAL.md", preview: "ICP", antiSignal: false, evidenceLabel: "근거: docs/GOAL.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "icp5", label: "구매권한 없는 조언자", description: "최근 사건과 예산 신호가 없어 제외 후보입니다.", preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let pain = Day1AlignmentComponent(
            id: base.components.painPoint.id,
            title: base.components.painPoint.title,
            prompt: base.components.painPoint.prompt,
            helperText: base.components.painPoint.helperText,
            statement: base.components.painPoint.statement,
            evidence: base.components.painPoint.evidence,
            missingAssumptions: base.components.painPoint.missingAssumptions,
            options: [
                Day1IcpQuestionOption(id: "pain1", label: "Slack 누락", description: "반복됨", preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "pain2", label: "SLA 리스크 발견 지연", description: "계정 위험 판단이 늦어집니다.", preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "pain3", label: "수동 확인 시간 낭비", description: "현재 대안의 시간 비용입니다.", preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "pain4", label: "우선순위 흔들림", description: "요청을 매번 사람이 재분류합니다.", preview: "Pain", antiSignal: false),
                Day1IcpQuestionOption(id: "pain5", label: "불편하지만 비용 없음", description: "돈이나 시간이 이미 쓰이지 않습니다.", preview: "Weak", antiSignal: true),
            ]
        )
        let outcome = Day1AlignmentComponent(
            id: base.components.outcome.id,
            title: base.components.outcome.title,
            prompt: base.components.outcome.prompt,
            helperText: base.components.outcome.helperText,
            statement: base.components.outcome.statement,
            evidence: base.components.outcome.evidence,
            missingAssumptions: base.components.outcome.missingAssumptions,
            options: [
                Day1IcpQuestionOption(id: "outcome1", label: "빠른 판단", description: "결과", preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "outcome2", label: "지불 의향 확인", description: "돈을 낼 문제인지 봅니다.", preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "outcome3", label: "현재 대안 확인", description: "수동 workflow를 보여달라고 요청합니다.", preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "outcome4", label: "도입 결정권자 확인", description: "구매자와 사용자를 분리합니다.", preview: "Outcome", antiSignal: false),
                Day1IcpQuestionOption(id: "outcome5", label: "최근 사건 없음", description: "시장 신호가 약한 경우 보류합니다.", preview: "Weak", antiSignal: true),
            ]
        )
        return Day1AlignmentPlan(
            schemaVersion: base.schemaVersion,
            source: "frontier_ensemble",
            generatedAt: base.generatedAt,
            confidence: base.confidence,
            fellBackToDeterministic: false,
            projectGoal: base.projectGoal,
            mission: base.mission,
            signals: base.signals,
            components: Day1AlignmentComponents(icp: icp, painPoint: pain, outcome: outcome),
            alignmentStatement: base.alignmentStatement,
            qualityGate: base.qualityGate,
            firstInterviewMessage: base.firstInterviewMessage,
            day2Handoff: base.day2Handoff,
            signalDigest: base.signalDigest
        )
    }

    private func makePlan(
        questionCount: Int,
        firstQuestionOptions: [Day1IcpQuestionOption]? = nil,
        firstQuestionAllowFreeText: Bool? = nil
    ) -> Day1IcpPlan {
        let dimensions = ["must_have", "core_need", "current_alternative", "bad_fit_boundary", "reference_customer", "overflow"]
        let questions = dimensions.prefix(questionCount).enumerated().map { index, dimension in
            let defaultOptions = [
                Day1IcpQuestionOption(id: "o1", label: index == 2 ? "Slack 수동 확인" : "좋은 조건 \(index + 1)", description: "현재 행동이 있음", preview: "Have", antiSignal: false),
                Day1IcpQuestionOption(id: "o2", label: "관심만 있음", description: "최근 사건 없음", preview: "Weak", antiSignal: dimension == "bad_fit_boundary"),
            ]
            return Day1IcpQuestion(
                id: "q\(index + 1)_\(dimension)",
                dimension: dimension,
                title: "질문 \(index + 1)",
                prompt: "\(dimension) prompt?",
                helperText: "scan 기반 질문",
                options: index == 0 ? firstQuestionOptions ?? defaultOptions : defaultOptions,
                allowFreeText: index == 0 ? firstQuestionAllowFreeText ?? true : true,
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

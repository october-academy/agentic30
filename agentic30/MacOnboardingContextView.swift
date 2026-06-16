import SwiftUI

struct MacOnboardingContextView: View {
    @ObservedObject var viewModel: AgenticViewModel

    @State private var sceneIndex = 0
    @State private var selectedWorkMode: OnboardingWorkMode?
    @State private var customWorkMode = ""
    @State private var selectedFocusArea: OnboardingFocusArea?
    @State private var selectedProductBottleneck: OnboardingProductBottleneck?
    @State private var selectedIsolationLevels: Set<OnboardingIsolationLevel> = [.projectFolder]
    @State private var primaryIsolationLevel: OnboardingIsolationLevel = .projectFolder
    @FocusState private var customWorkModeFocused: Bool

    private var totalScenes: Int { 4 }

    var body: some View {
        VStack(spacing: 0) {
            visualStage
                .frame(height: 172)

            VStack(alignment: .leading, spacing: 14) {
                progressDots

                VStack(alignment: .leading, spacing: 6) {
                    Text(currentTitle)
                        .font(.system(size: 28, weight: .bold, design: .rounded))
                        .foregroundStyle(MacOnboardingTheme.text)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(currentSubtitle)
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .foregroundStyle(MacOnboardingTheme.secondaryText)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                optionsList

                if case .failed(let message) = viewModel.onboardingContextStatus {
                    Text(message)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(Color(red: 1.0, green: 0.38, blue: 0.38))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                footerControls
            }
            .padding(.horizontal, 32)
            .padding(.top, 16)
            .padding(.bottom, 18)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(MacOnboardingTheme.bg)
        }
        .frame(width: 716, height: 676)
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .stroke(MacOnboardingTheme.border, lineWidth: 1)
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.88), value: sceneIndex)
        .animation(.easeInOut(duration: 0.2), value: viewModel.onboardingContextStatus)
    }

    // MARK: - Visual Stage

    private var visualStage: some View {
        ZStack {
            LinearGradient(
                colors: currentVisualColors,
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            HalftoneFieldDots()
                .opacity(0.32)

            currentVisualBadge
        }
        .clipped()
    }

    @ViewBuilder
    private var currentVisualBadge: some View {
        switch sceneIndex {
        case 0:
            HStack(spacing: 12) {
                Image(systemName: "hammer.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color(red: 0.96, green: 0.90, blue: 0.66))
                Text("Making")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(MacOnboardingTheme.visualText)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(
                Capsule()
                    .fill(MacOnboardingTheme.badgeFill)
                    .overlay(Capsule().stroke(MacOnboardingTheme.border, lineWidth: 1))
            )
        case 1:
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [
                            Color(red: 0.92, green: 1.0, blue: 0.90),
                            Color(red: 0.28, green: 0.92, blue: 0.32),
                        ],
                        startPoint: .topLeading,
                        endPoint: .bottomTrailing
                    )
                )
                .frame(width: 132, height: 108)
                .overlay(alignment: .center) {
                    HStack(spacing: 18) {
                        Capsule().fill(MacOnboardingTheme.surface.opacity(0.95)).frame(width: 20, height: 40)
                        Capsule().fill(MacOnboardingTheme.surface.opacity(0.95)).frame(width: 20, height: 40)
                    }
                }
        case 2:
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color(red: 0.96, green: 0.90, blue: 0.66))
                Text("Bottleneck")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(MacOnboardingTheme.visualText)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(
                Capsule()
                    .fill(MacOnboardingTheme.badgeFill)
                    .overlay(Capsule().stroke(MacOnboardingTheme.border, lineWidth: 1))
            )
        case 3:
            HStack(spacing: 12) {
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(MacOnboardingTheme.visualText)
                Text("Records")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(MacOnboardingTheme.visualText)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(
                Capsule()
                    .fill(MacOnboardingTheme.badgeFill)
                    .overlay(Capsule().stroke(MacOnboardingTheme.border, lineWidth: 1))
            )
        default:
            EmptyView()
        }
    }

    private var currentVisualColors: [Color] {
        if Agentic30Theme.current == .white {
            switch sceneIndex {
            case 0, 1:
                return [
                    OpenDesignDayColor.surface,
                    OpenDesignDayColor.bgDeep,
                    OpenDesignDayColor.accent.opacity(0.34),
                ]
            case 2:
                return [
                    OpenDesignDayColor.surface,
                    OpenDesignDayColor.bgDeep,
                    OpenDesignDayColor.amber.opacity(0.42),
                ]
            case 3:
                return [
                    OpenDesignDayColor.surface,
                    OpenDesignDayColor.bgDeep,
                    OpenDesignDayColor.sky.opacity(0.34),
                ]
            default:
                return [MacOnboardingTheme.bg, MacOnboardingTheme.surface]
            }
        }

        switch sceneIndex {
        case 0, 1:
            return [
                Color(red: 0.06, green: 0.07, blue: 0.07),
                Color(red: 0.11, green: 0.22, blue: 0.16),
                Color(red: 0.40, green: 0.74, blue: 0.33).opacity(0.75),
            ]
        case 2:
            return [
                Color(red: 0.06, green: 0.07, blue: 0.05),
                Color(red: 0.24, green: 0.26, blue: 0.16),
                Color(red: 0.70, green: 0.64, blue: 0.44),
            ]
        case 3:
            return [
                Color(red: 0.05, green: 0.06, blue: 0.07),
                Color(red: 0.16, green: 0.20, blue: 0.24),
                Color(red: 0.47, green: 0.58, blue: 0.70),
            ]
        default:
            return [MacOnboardingTheme.bg, MacOnboardingTheme.bg]
        }
    }

    // MARK: - Title / Subtitle

    private var currentTitle: String {
        switch sceneIndex {
        case 0: return OnboardingFocusArea.onboardingQuestion
        case 1: return "현재 어떤 상황에서 제품을 만들고 있나요?"
        case 2: return OnboardingProductBottleneck.onboardingQuestion
        case 3: return "어떤 기록을 연결할 수 있나요?"
        default: return ""
        }
    }

    private var currentSubtitle: String {
        switch sceneIndex {
        case 0: return OnboardingFocusArea.onboardingSubtitle
        case 1: return "지금의 시간 제약과 책임 범위에 맞춰 오늘 할 일을 정합니다."
        case 2: return "병목에 맞춰 먼저 볼 문제를 정합니다."
        case 3: return "프로젝트와 실행 기록을 읽어 오늘의 과제를 개인화합니다."
        default: return ""
        }
    }

    // MARK: - Progress Dots

    private var progressDots: some View {
        HStack(spacing: 8) {
            ForEach(0..<totalScenes, id: \.self) { index in
                Capsule()
                    .fill(index == sceneIndex ? MacOnboardingTheme.text : MacOnboardingTheme.border)
                    .frame(width: index == sceneIndex ? 28 : 8, height: 8)
            }
        }
        .accessibilityLabel("Step \(sceneIndex + 1) of \(totalScenes)")
    }

    // MARK: - Options List

    @ViewBuilder
    private var optionsList: some View {
        switch sceneIndex {
        case 0:
            VStack(spacing: 6) {
                ForEach(OnboardingFocusArea.onboardingChoices, id: \.self) { focusArea in
                    optionRow(
                        title: focusArea.displayTitle,
                        description: focusArea.displayDescription,
                        selected: selectedFocusArea == focusArea,
                        accent: focusAreaAccent,
                        identifier: "onboardingContext.option.\(focusArea.rawValue)"
                    ) {
                        selectedFocusArea = focusArea
                    }
                }
            }
        case 1:
            VStack(spacing: 6) {
                ForEach(OnboardingWorkMode.onboardingChoices, id: \.self) { mode in
                    optionRow(
                        title: mode.displayTitle,
                        description: mode.displayDescription,
                        selected: selectedWorkMode == mode,
                        accent: workModeAccent,
                        identifier: "onboardingContext.option.\(mode.rawValue)"
                    ) {
                        selectedWorkMode = mode
                    }
                }
                customWorkModeOption
            }
        case 2:
            VStack(spacing: 5) {
                ForEach(OnboardingProductBottleneck.onboardingChoices, id: \.self) { bottleneck in
                    optionRow(
                        title: bottleneck.displayTitle,
                        description: bottleneck.displayDescription,
                        selected: selectedProductBottleneck == bottleneck,
                        accent: bottleneckAccent,
                        identifier: "onboardingContext.option.\(bottleneck.rawValue)"
                    ) {
                        selectedProductBottleneck = bottleneck
                    }
                }
            }
        case 3:
            VStack(spacing: 5) {
                ForEach(OnboardingIsolationLevel.allCases, id: \.self) { level in
                    optionRow(
                        title: level.displayTitle,
                        description: level.displayDescription,
                        selected: selectedIsolationLevels.contains(level),
                        accent: isolationAccent,
                        identifier: "onboardingContext.option.\(level.rawValue)"
                    ) {
                        toggleIsolationLevel(level)
                    }
                }
            }
        default:
            EmptyView()
        }
    }

    private var workModeAccent: Color { Color(red: 0.82, green: 0.99, blue: 0.69) }
    private var focusAreaAccent: Color { Color(red: 0.82, green: 0.99, blue: 0.69) }
    private var bottleneckAccent: Color { Color(red: 0.82, green: 0.99, blue: 0.69) }
    private var isolationAccent: Color { Color(red: 0.66, green: 0.78, blue: 0.91) }

    private var trimmedCustomWorkMode: String {
        customWorkMode.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    private var customWorkModeSelected: Bool {
        selectedWorkMode == .exploring
    }

    private var customWorkModeOption: some View {
        VStack(alignment: .leading, spacing: 8) {
            optionRow(
                title: OnboardingWorkMode.exploring.displayTitle,
                description: customWorkModeSelected && !trimmedCustomWorkMode.isEmpty
                    ? trimmedCustomWorkMode
                    : "내 상황을 직접 입력합니다",
                selected: customWorkModeSelected,
                accent: workModeAccent,
                identifier: "onboardingContext.option.custom_work_mode"
            ) {
                selectedWorkMode = .exploring
                customWorkModeFocused = true
            }

            if customWorkModeSelected {
                TextField("예: 퇴근 후 주 2일, 공동창업자와 검증 중", text: $customWorkMode)
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(MacOnboardingTheme.text)
                    .focused($customWorkModeFocused)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(MacOnboardingTheme.surfaceSubtle)
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(workModeAccent.opacity(0.42), lineWidth: 1)
                            )
                    )
                    .accessibilityIdentifier("onboardingContext.option.custom_work_mode.input")
            }
        }
    }

    private func optionRow(
        title: String,
        description: String,
        selected: Bool,
        accent: Color,
        identifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(alignment: .center, spacing: 14) {
                Circle()
                    .fill(selected ? accent : MacOnboardingTheme.border)
                    .frame(width: 10, height: 10)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(MacOnboardingTheme.text)
                    Text(description)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(selected ? MacOnboardingTheme.secondaryText : MacOnboardingTheme.tertiaryText)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Image(systemName: "checkmark")
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(accent.opacity(selected ? 1 : 0))
                    .frame(width: 16, height: 16)
            }
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .frame(minHeight: 56, alignment: .center)
            .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(selected ? accent.opacity(0.13) : MacOnboardingTheme.surfaceSubtle)
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(
                                selected ? accent.opacity(0.95) : MacOnboardingTheme.border,
                                lineWidth: 1
                            )
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(identifier)
        .accessibilityLabel("\(title), \(description)")
        .accessibilityValue(selected ? "Selected" : "Not selected")
        .accessibilityAddTraits(selected ? .isSelected : [])
    }

    // MARK: - Footer

    private var footerControls: some View {
        HStack(spacing: 12) {
            Button {
                if sceneIndex == 0 { return }
                sceneIndex = max(0, sceneIndex - 1)
            } label: {
                Text("Back")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(sceneIndex == 0 ? MacOnboardingTheme.tertiaryText.opacity(0.62) : MacOnboardingTheme.secondaryButtonText)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 13)
                    .background(Capsule().fill(MacOnboardingTheme.secondaryFill))
            }
            .buttonStyle(.plain)
            .disabled(sceneIndex == 0)
            .accessibilityIdentifier("onboardingContext.backButton")

            Spacer(minLength: 0)

            Button {
                primaryAction()
            } label: {
                HStack(spacing: 8) {
                    if isSubmitting {
                        IntakeV2ActivitySpinner(
                            size: 14,
                            lineWidth: 2,
                            color: primaryButtonEnabled ? MacOnboardingTheme.primaryText : MacOnboardingTheme.disabledText,
                            trackColor: MacOnboardingTheme.primaryText.opacity(0.22)
                        )
                    }
                    Text(primaryButtonTitle)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(primaryButtonEnabled ? MacOnboardingTheme.primaryText : MacOnboardingTheme.disabledText)

                    if !isSubmitting && sceneIndex < totalScenes - 1 {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(primaryButtonEnabled ? MacOnboardingTheme.primaryText : MacOnboardingTheme.disabledText)
                    } else if !isSubmitting {
                        Image(systemName: "sparkle")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(primaryButtonEnabled ? MacOnboardingTheme.primaryText : MacOnboardingTheme.disabledText)
                    }
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 14)
                .background(
                    Capsule()
                        .fill(primaryButtonEnabled ? MacOnboardingTheme.primaryFill : MacOnboardingTheme.disabledFill)
                )
            }
            .buttonStyle(.plain)
            .disabled(!primaryButtonEnabled || isSubmitting)
            .accessibilityIdentifier("onboardingContext.primaryButton")
            .accessibilityLabel(primaryButtonTitle)
        }
    }

    private var isSubmitting: Bool {
        if case .submitting = viewModel.onboardingContextStatus { return true }
        return false
    }

    private var primaryButtonEnabled: Bool {
        switch sceneIndex {
        case 0: return selectedFocusArea != nil
        case 1:
            guard let selectedWorkMode else { return false }
            if selectedWorkMode == .exploring {
                return !trimmedCustomWorkMode.isEmpty
            }
            return true
        case 2: return selectedProductBottleneck != nil
        case 3: return !selectedIsolationLevels.isEmpty
        default: return false
        }
    }

    private var primaryButtonTitle: String {
        if isSubmitting { return "Saving" }
        if sceneIndex < totalScenes - 1 { return "Next" }
        return "Start assistant"
    }

    private func primaryAction() {
        if sceneIndex < totalScenes - 1 {
            let nextIndex = min(totalScenes - 1, sceneIndex + 1)
            PostHogTelemetry.capture("mac_onboarding_context_scene_advanced", properties: [
                "from_step": sceneIndex,
                "to_step": nextIndex,
                "selected_work_mode": selectedWorkMode?.rawValue ?? "none",
                "selected_focus_area": selectedFocusArea?.rawValue ?? "none",
                "selected_product_bottleneck": selectedProductBottleneck?.rawValue ?? "none",
            ])
            sceneIndex = nextIndex
            return
        }

        guard
            let workMode = selectedWorkMode,
            let focusArea = selectedFocusArea,
            let bottleneck = selectedProductBottleneck
        else { return }
        let levels = Array(selectedIsolationLevels).sorted { $0.rawValue < $1.rawValue }
        let primaryLevel = selectedIsolationLevels.contains(primaryIsolationLevel)
            ? primaryIsolationLevel
            : levels[0]

        let context = OnboardingContext.make(
            customWorkMode: workMode == .exploring ? trimmedCustomWorkMode : "",
            workMode: workMode,
            focusArea: focusArea,
            productBottleneck: bottleneck,
            isolationLevel: primaryLevel,
            isolationLevels: levels
        )
        viewModel.submitOnboardingContext(context)
    }

    private func toggleIsolationLevel(_ level: OnboardingIsolationLevel) {
        if selectedIsolationLevels.contains(level) {
            if selectedIsolationLevels.count > 1 {
                selectedIsolationLevels.remove(level)
                if primaryIsolationLevel == level,
                   let fallback = selectedIsolationLevels.sorted(by: { $0.rawValue < $1.rawValue }).first {
                    primaryIsolationLevel = fallback
                }
            }
        } else {
            selectedIsolationLevels.insert(level)
            primaryIsolationLevel = level
        }
    }
}

// MARK: - Halftone field

private struct HalftoneFieldDots: View {
    var body: some View {
        GeometryReader { proxy in
            let columns = 36
            let rows = 12
            let cellWidth = proxy.size.width / CGFloat(columns)
            let cellHeight = proxy.size.height / CGFloat(rows)

            ForEach(0..<rows, id: \.self) { row in
                ForEach(0..<columns, id: \.self) { column in
                    Circle()
                        .fill(MacOnboardingTheme.text.opacity(Agentic30Theme.current == .white ? 0.10 : 0.32))
                        .frame(width: 3.4, height: 3.4)
                        .position(
                            x: CGFloat(column) * cellWidth + cellWidth / 2,
                            y: CGFloat(row) * cellHeight + cellHeight / 2
                        )
                }
            }
        }
    }
}

#Preview {
    MacOnboardingContextView(viewModel: AgenticViewModel())
        .frame(width: 760, height: 720)
}

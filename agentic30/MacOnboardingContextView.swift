import SwiftUI

struct MacOnboardingContextView: View {
    @ObservedObject var viewModel: AgenticViewModel

    @State private var sceneIndex = 0
    @State private var selectedWorkMode: OnboardingWorkMode? = .fullTimeSolo
    @State private var customWorkMode = ""
    @State private var selectedRole: OnboardingRole? = .developer
    @State private var selectedProjectStage: OnboardingProjectStage? = .ideaOnly
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
                        .foregroundStyle(.white.opacity(0.94))
                        .fixedSize(horizontal: false, vertical: true)

                    Text(currentSubtitle)
                        .font(.system(size: 15, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.56))
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
            .background(Color(red: 0.06, green: 0.07, blue: 0.07))
        }
        .frame(width: 716, height: 676)
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
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
                    .foregroundStyle(.white.opacity(0.92))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(
                Capsule()
                    .fill(Color.black.opacity(0.32))
                    .overlay(Capsule().stroke(Color.white.opacity(0.11), lineWidth: 1))
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
                        Capsule().fill(Color.white.opacity(0.95)).frame(width: 20, height: 40)
                        Capsule().fill(Color.white.opacity(0.95)).frame(width: 20, height: 40)
                    }
                }
        case 2:
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color(red: 0.96, green: 0.90, blue: 0.66))
                Text("Stuck point")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.92))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(
                Capsule()
                    .fill(Color.black.opacity(0.32))
                    .overlay(Capsule().stroke(Color.white.opacity(0.11), lineWidth: 1))
            )
        case 3:
            HStack(spacing: 12) {
                Image(systemName: "doc.text.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white.opacity(0.92))
                Text("Records")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.92))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 14)
            .background(
                Capsule()
                    .fill(Color.black.opacity(0.32))
                    .overlay(Capsule().stroke(Color.white.opacity(0.11), lineWidth: 1))
            )
        default:
            EmptyView()
        }
    }

    private var currentVisualColors: [Color] {
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
            return [Color.black, Color.black]
        }
    }

    // MARK: - Title / Subtitle

    private var currentTitle: String {
        switch sceneIndex {
        case 0: return "지금 어떤 상황에서 빌드하고 있나요?"
        case 1: return "어떤 일을 하고 계신가요?"
        case 2: return "현재 가장 큰 막힘은 무엇인가요?"
        case 3: return "어떤 기록을 연결할 수 있나요?"
        default: return ""
        }
    }

    private var currentSubtitle: String {
        switch sceneIndex {
        case 0: return "쓸 수 있는 시간과 책임 범위에 맞춰 오늘 할 일을 정합니다."
        case 1: return "익숙한 일하는 방식에 맞춰 설명과 제안을 조정합니다."
        case 2: return "막힌 지점에 맞춰 먼저 볼 문제를 정합니다."
        case 3: return "프로젝트와 실행 기록을 읽어 오늘의 과제를 개인화합니다."
        default: return ""
        }
    }

    // MARK: - Progress Dots

    private var progressDots: some View {
        HStack(spacing: 8) {
            ForEach(0..<totalScenes, id: \.self) { index in
                Capsule()
                    .fill(index == sceneIndex ? Color.white.opacity(0.9) : Color.white.opacity(0.22))
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
        case 1:
            VStack(spacing: 6) {
                ForEach(OnboardingRole.allCases, id: \.self) { role in
                    optionRow(
                        title: role.displayTitle,
                        description: role.displayDescription,
                        selected: selectedRole == role,
                        accent: roleAccent,
                        identifier: "onboardingContext.option.\(role.rawValue)"
                    ) {
                        selectedRole = role
                    }
                }
            }
        case 2:
            VStack(spacing: 5) {
                ForEach(OnboardingProjectStage.onboardingChoices, id: \.self) { stage in
                    optionRow(
                        title: stage.displayTitle,
                        description: stage.displayDescription,
                        selected: selectedProjectStage == stage,
                        accent: stageAccent,
                        identifier: "onboardingContext.option.\(stage.rawValue)"
                    ) {
                        selectedProjectStage = stage
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
    private var roleAccent: Color { Color(red: 0.82, green: 0.99, blue: 0.69) }
    private var stageAccent: Color { Color(red: 0.82, green: 0.99, blue: 0.69) }
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
                    : OnboardingWorkMode.exploring.displayDescription,
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
                    .foregroundStyle(.white.opacity(0.92))
                    .focused($customWorkModeFocused)
                    .padding(.horizontal, 16)
                    .padding(.vertical, 12)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.white.opacity(0.06))
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
                    .fill(selected ? accent : Color.white.opacity(0.22))
                    .frame(width: 10, height: 10)

                VStack(alignment: .leading, spacing: 3) {
                    Text(title)
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(selected ? 0.97 : 0.94))
                    Text(description)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(selected ? 0.62 : 0.54))
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
                    .fill(selected ? accent.opacity(0.13) : Color.white.opacity(0.05))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(
                                (selected ? accent : Color.white).opacity(selected ? 0.95 : 0.08),
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
                    .foregroundStyle(.white.opacity(sceneIndex == 0 ? 0.28 : 0.78))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 13)
                    .background(Capsule().fill(Color.white.opacity(0.08)))
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
                        ProgressView()
                            .controlSize(.small)
                            .tint(.black.opacity(0.74))
                    }
                    Text(primaryButtonTitle)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(Color.black.opacity(primaryButtonEnabled ? 0.86 : 0.36))

                    if !isSubmitting && sceneIndex < totalScenes - 1 {
                        Image(systemName: "arrow.right")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color.black.opacity(primaryButtonEnabled ? 0.86 : 0.36))
                    } else if !isSubmitting {
                        Image(systemName: "sparkle")
                            .font(.system(size: 14, weight: .bold))
                            .foregroundStyle(Color.black.opacity(primaryButtonEnabled ? 0.86 : 0.36))
                    }
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 14)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(primaryButtonEnabled ? 0.96 : 0.34))
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
        case 0:
            guard let selectedWorkMode else { return false }
            if selectedWorkMode == .exploring {
                return !trimmedCustomWorkMode.isEmpty
            }
            return true
        case 1: return selectedRole != nil
        case 2: return selectedProjectStage != nil
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
                "selected_role": selectedRole?.rawValue ?? "none",
                "selected_project_stage": selectedProjectStage?.rawValue ?? "none",
            ])
            sceneIndex = nextIndex
            return
        }

        guard
            let workMode = selectedWorkMode,
            let role = selectedRole,
            let stage = selectedProjectStage
        else { return }
        let levels = Array(selectedIsolationLevels).sorted { $0.rawValue < $1.rawValue }
        let primaryLevel = selectedIsolationLevels.contains(primaryIsolationLevel)
            ? primaryIsolationLevel
            : levels[0]

        let context = OnboardingContext.make(
            customWorkMode: workMode == .exploring ? trimmedCustomWorkMode : "",
            workMode: workMode,
            role: role,
            projectStage: stage,
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
                        .fill(Color.black.opacity(0.32))
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

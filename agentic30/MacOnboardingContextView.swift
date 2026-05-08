import SwiftUI

struct MacOnboardingContextView: View {
    @ObservedObject var viewModel: AgenticViewModel

    @State private var sceneIndex = 0
    @State private var selectedRole: OnboardingRole? = .developer
    @State private var selectedProjectStage: OnboardingProjectStage? = .ideaOnly
    @State private var selectedIsolationLevel: OnboardingIsolationLevel? = .soloAll

    private var totalScenes: Int { 3 }

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
        case 1:
            HStack(spacing: 12) {
                Image(systemName: "sparkles")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(Color(red: 0.96, green: 0.90, blue: 0.66))
                Text("Project stage")
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
        case 2:
            HStack(spacing: 12) {
                Image(systemName: "person.2.fill")
                    .font(.system(size: 20, weight: .bold))
                    .foregroundStyle(.white.opacity(0.92))
                Text("Feedback loop")
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
        case 0:
            return [
                Color(red: 0.06, green: 0.07, blue: 0.07),
                Color(red: 0.11, green: 0.22, blue: 0.16),
                Color(red: 0.40, green: 0.74, blue: 0.33).opacity(0.75),
            ]
        case 1:
            return [
                Color(red: 0.06, green: 0.07, blue: 0.05),
                Color(red: 0.24, green: 0.26, blue: 0.16),
                Color(red: 0.70, green: 0.64, blue: 0.44),
            ]
        case 2:
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
        case 0: return "어떤 일을 하고 계신가요?"
        case 1: return "지금 프로젝트는 어느 단계에 있나요?"
        case 2: return "피드백은 어디서 받으시나요?"
        default: return ""
        }
    }

    private var currentSubtitle: String {
        switch sceneIndex {
        case 0: return "Assistant가 당신의 워크플로우에 맞춰 답변 스타일과 추천을 조정합니다."
        case 1: return "현재 상태에 맞춰 Assistant가 조언 비중을 조정합니다."
        case 2: return "고립 수준에 맞춰 코파운더 역할 비중을 조정합니다."
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
        case 1:
            VStack(spacing: 5) {
                ForEach(OnboardingProjectStage.allCases, id: \.self) { stage in
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
        case 2:
            VStack(spacing: 5) {
                ForEach(OnboardingIsolationLevel.allCases, id: \.self) { level in
                    optionRow(
                        title: level.displayTitle,
                        description: level.displayDescription,
                        selected: selectedIsolationLevel == level,
                        accent: isolationAccent,
                        identifier: "onboardingContext.option.\(level.rawValue)"
                    ) {
                        selectedIsolationLevel = level
                    }
                }
            }
        default:
            EmptyView()
        }
    }

    private var roleAccent: Color { Color(red: 0.82, green: 0.99, blue: 0.69) }
    private var stageAccent: Color { Color(red: 0.82, green: 0.99, blue: 0.69) }
    private var isolationAccent: Color { Color(red: 0.66, green: 0.78, blue: 0.91) }

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
        case 0: return selectedRole != nil
        case 1: return selectedProjectStage != nil
        case 2: return selectedIsolationLevel != nil
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
                "selected_role": selectedRole?.rawValue ?? "none",
                "selected_project_stage": selectedProjectStage?.rawValue ?? "none",
            ])
            sceneIndex = nextIndex
            return
        }

        guard
            let role = selectedRole,
            let stage = selectedProjectStage,
            let level = selectedIsolationLevel
        else { return }

        let context = OnboardingContext.make(
            role: role,
            projectStage: stage,
            isolationLevel: level
        )
        viewModel.submitOnboardingContext(context)
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

import SwiftUI
import AppKit

enum MacOnboardingTheme {
    static var bg: Color { OpenDesignDayColor.bg }
    static var surface: Color { OpenDesignDayColor.surface }
    static var surfaceSubtle: Color { OpenDesignDayColor.surface2 }
    static var text: Color { OpenDesignDayColor.fg }
    static var secondaryText: Color { OpenDesignDayColor.fgSecondary }
    static var tertiaryText: Color { OpenDesignDayColor.muted }
    static var border: Color { OpenDesignDayColor.borderSoft }
    static var accent: Color { OpenDesignDayColor.accent }
    static var primaryFill: Color { Agentic30Theme.current == .white ? OpenDesignDayColor.fg : Color.white }
    static var primaryText: Color { Agentic30Theme.current == .white ? OpenDesignDayColor.surface : Color.black.opacity(0.86) }
    static var disabledFill: Color { Agentic30Theme.current == .white ? OpenDesignDayColor.selected.opacity(0.74) : Color.white.opacity(0.34) }
    static var disabledText: Color { Agentic30Theme.current == .white ? OpenDesignDayColor.muted : Color.black.opacity(0.36) }
    static var secondaryFill: Color { Agentic30Theme.current == .white ? OpenDesignDayColor.surface2 : Color.white.opacity(0.08) }
    static var secondaryButtonText: Color { Agentic30Theme.current == .white ? OpenDesignDayColor.fgSecondary : Color.white.opacity(0.78) }
    static var badgeFill: Color { Agentic30Theme.current == .white ? Color.white.opacity(0.78) : Color.black.opacity(0.32) }
    static var visualText: Color { Agentic30Theme.current == .white ? OpenDesignDayColor.fg : Color.white.opacity(0.92) }
    static var visualSecondaryText: Color { Agentic30Theme.current == .white ? OpenDesignDayColor.fgSecondary : Color.white.opacity(0.72) }
}

struct MacOnboardingView: View {
    @ObservedObject var viewModel: AgenticViewModel

    @State private var sceneIndex = 0
    @State private var selectedWorkspaceURL: URL?

    private let scenes = MacOnboardingScene.all

    var body: some View {
        if viewModel.needsOnboardingIntro {
            onboardingStage
        } else if viewModel.needsOnboardingContext {
            MacOnboardingContextView(viewModel: viewModel)
        } else if viewModel.needsProjectWorkspace {
            workspacePickerStage
        }
    }

    private var onboardingStage: some View {
        VStack(spacing: 0) {
            visualStage
                .frame(height: 318)
                .onAppear {
                    if sceneIndex == 0 {
                        PostHogTelemetry.capture("mac_onboarding_intro_started")
                    }
                }

            VStack(alignment: .leading, spacing: 22) {
                progressDots

                VStack(alignment: .leading, spacing: 12) {
                    Text(currentScene.title)
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(MacOnboardingTheme.text)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(currentScene.subtitle)
                        .font(.system(size: 18, weight: .medium, design: .rounded))
                        .foregroundStyle(MacOnboardingTheme.secondaryText)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                footerControls
            }
            .padding(.horizontal, 34)
            .padding(.top, 28)
            .padding(.bottom, 34)
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
    }

    private var workspacePickerStage: some View {
        VStack(spacing: 0) {
            ZStack {
                LinearGradient(
                    colors: [
                        Color(red: 0.06, green: 0.07, blue: 0.07),
                        Color(red: 0.12, green: 0.16, blue: 0.14),
                        Color(red: 0.48, green: 0.44, blue: 0.30),
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
                HalftoneField()
                    .opacity(0.32)
                Image(systemName: "folder.badge.gearshape")
                    .font(.system(size: 78, weight: .bold))
                    .foregroundStyle(MacOnboardingTheme.visualText)
            }
            .frame(height: 246)

            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Choose your project folder")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(MacOnboardingTheme.text)

                    Text("Agentic30 reads docs, runs agents, and writes strategy files inside this workspace. Pick the repo or project directory you want the assistant to work on.")
                        .font(.system(size: 17, weight: .medium, design: .rounded))
                        .foregroundStyle(MacOnboardingTheme.secondaryText)
                        .lineSpacing(4)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Button {
                    chooseWorkspace()
                } label: {
                    HStack(spacing: 12) {
                        Image(systemName: "folder")
                            .font(.system(size: 18, weight: .bold))
                        VStack(alignment: .leading, spacing: 4) {
                            Text(selectedWorkspaceURL?.lastPathComponent ?? "Select project directory")
                                .font(.system(size: 16, weight: .bold, design: .rounded))
                            Text(selectedWorkspaceURL?.path ?? "No folder selected")
                                .font(.system(size: 12, weight: .medium, design: .rounded))
                                .foregroundStyle(MacOnboardingTheme.tertiaryText)
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(MacOnboardingTheme.text)
                    .padding(16)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(MacOnboardingTheme.surfaceSubtle)
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(MacOnboardingTheme.border, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("workspace.selectDirectoryButton")
                .accessibilityLabel("Select project directory")

                Spacer(minLength: 0)

                HStack {
                    Text(workspaceFooterHint)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(MacOnboardingTheme.tertiaryText)

                    Spacer(minLength: 0)

                    Button {
                        if let selectedWorkspaceURL {
                            viewModel.setProjectWorkspace(selectedWorkspaceURL)
                        }
                    } label: {
                        Text("Start assistant")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(selectedWorkspaceURL == nil ? MacOnboardingTheme.disabledText : MacOnboardingTheme.primaryText)
                            .padding(.horizontal, 28)
                            .padding(.vertical, 14)
                            .background(
                                Capsule()
                                    .fill(selectedWorkspaceURL == nil ? MacOnboardingTheme.disabledFill : MacOnboardingTheme.primaryFill)
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(selectedWorkspaceURL == nil)
                    .accessibilityIdentifier("workspace.startAssistantButton")
                    .accessibilityLabel("Start assistant")
                }
            }
            .padding(.horizontal, 34)
            .padding(.top, 28)
            .padding(.bottom, 34)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .background(MacOnboardingTheme.bg)
        }
        .frame(width: 716, height: 676)
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .stroke(MacOnboardingTheme.border, lineWidth: 1)
        }
    }

    private var currentScene: MacOnboardingScene {
        scenes[sceneIndex]
    }

    private var workspaceFooterHint: String {
        if selectedWorkspaceURL == nil {
            return "Select a folder to enable Start assistant."
        }
        return "You can change this later in Settings > Build In Public."
    }

    private var visualStage: some View {
        ZStack {
            LinearGradient(
                colors: currentScene.visualColors.map(sceneColor),
                startPoint: .topLeading,
                endPoint: .bottomTrailing
            )

            HalftoneField()
                .opacity(0.42)

            switch currentScene.visual {
            case .mark:
                AssistantMark()
                    .frame(width: 168, height: 136)
            case .briefing:
                FloatingBriefingBubble()
                    .frame(width: 468)
            case .launch:
                FloatingMilestoneCard()
                    .frame(width: 476)
            case .integrations:
                IntegrationIconRow()
                    .padding(.top, 12)
            }
        }
        .clipped()
    }

    private func sceneColor(_ color: SceneColor) -> Color {
        Color(red: color.red, green: color.green, blue: color.blue, opacity: color.opacity)
    }

    private var progressDots: some View {
        HStack(spacing: 8) {
            ForEach(scenes.indices, id: \.self) { index in
                Capsule()
                    .fill(index == sceneIndex ? MacOnboardingTheme.text : MacOnboardingTheme.border)
                    .frame(width: index == sceneIndex ? 28 : 8, height: 8)
            }
        }
        .accessibilityLabel("Step \(sceneIndex + 1) of \(scenes.count)")
    }

    private var footerControls: some View {
        HStack(spacing: 12) {
            Button {
                sceneIndex = max(0, sceneIndex - 1)
            } label: {
                Text("Back")
                    .font(.system(size: 16, weight: .bold, design: .rounded))
                    .foregroundStyle(sceneIndex == 0 ? MacOnboardingTheme.tertiaryText.opacity(0.55) : MacOnboardingTheme.secondaryButtonText)
                    .padding(.horizontal, 24)
                    .padding(.vertical, 13)
                    .background(Capsule().fill(MacOnboardingTheme.secondaryFill))
            }
            .buttonStyle(.plain)
            .disabled(sceneIndex == 0)
            .accessibilityIdentifier("macOnboarding.backButton")

            Spacer(minLength: 0)

            Button {
                primaryAction()
            } label: {
                Text(primaryButtonTitle)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(MacOnboardingTheme.primaryText)
                .padding(.horizontal, 28)
                .padding(.vertical, 14)
                .background(
                    Capsule()
                        .fill(MacOnboardingTheme.primaryFill)
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("macOnboarding.primaryButton")
            .accessibilityLabel(primaryButtonTitle)
        }
    }

    private var primaryButtonTitle: String {
        sceneIndex == scenes.count - 1 ? "Start setup" : "Next"
    }

    private func primaryAction() {
        guard sceneIndex < scenes.count - 1 else {
            viewModel.completeMacOnboardingIntro()
            return
        }
        let nextIndex = min(scenes.count - 1, sceneIndex + 1)
        PostHogTelemetry.capture("mac_onboarding_intro_scene_advanced", properties: [
            "from_scene": sceneIndex,
            "to_scene": nextIndex,
            "total_scenes": scenes.count,
        ])
        sceneIndex = nextIndex
    }

    private func chooseWorkspace() {
        #if DEBUG
        if let url = uiTestingWorkspacePickerURL() {
            try? FileManager.default.createDirectory(
                at: url,
                withIntermediateDirectories: true,
                attributes: nil
            )
            selectedWorkspaceURL = url
            viewModel.setProjectWorkspace(url)
            return
        }
        #endif

        PostHogTelemetry.capture("mac_onboarding_workspace_picker_opened")
        let panel = NSOpenPanel()
        panel.canChooseDirectories = true
        panel.canChooseFiles = false
        panel.allowsMultipleSelection = false
        panel.message = "Select your project workspace root"
        if panel.runModal() == .OK, let url = panel.url {
            selectedWorkspaceURL = url
        }
    }

    #if DEBUG
    private func uiTestingWorkspacePickerURL() -> URL? {
        let prefix = "--ui-testing-picker-path="
        guard let argument = ProcessInfo.processInfo.arguments.first(where: { $0.hasPrefix(prefix) }) else {
            return nil
        }
        let path = String(argument.dropFirst(prefix.count))
        guard !path.isEmpty else { return nil }
        return URL(fileURLWithPath: path, isDirectory: true)
    }
    #endif
}

private struct MacOnboardingScene: Hashable {
    let title: String
    let subtitle: String
    let visual: Visual
    let visualColors: [SceneColor]

    enum Visual: Hashable {
        case mark
        case briefing
        case launch
        case integrations
    }

    static let all: [MacOnboardingScene] = OnboardingProgramIntro.scenes.map(MacOnboardingScene.init(introScene:))

    nonisolated init(introScene: OnboardingProgramIntro.Scene) {
        title = introScene.title
        subtitle = introScene.subtitle
        switch introScene.visual {
        case .mark:
            visual = .mark
            visualColors = [
                SceneColor(red: 0.06, green: 0.07, blue: 0.07),
                SceneColor(red: 0.11, green: 0.22, blue: 0.16),
                SceneColor(red: 0.40, green: 0.74, blue: 0.33, opacity: 0.75),
            ]
        case .briefing:
            visual = .briefing
            visualColors = [
                SceneColor(red: 0.08, green: 0.10, blue: 0.09),
                SceneColor(red: 0.35, green: 0.41, blue: 0.28),
                SceneColor(red: 0.80, green: 0.74, blue: 0.52),
            ]
        case .launch:
            visual = .launch
            visualColors = [
                SceneColor(red: 0.08, green: 0.10, blue: 0.09),
                SceneColor(red: 0.24, green: 0.33, blue: 0.24),
                SceneColor(red: 0.70, green: 0.64, blue: 0.44),
            ]
        case .integrations:
            visual = .integrations
            visualColors = [
                SceneColor(red: 0.07, green: 0.075, blue: 0.08),
                SceneColor(red: 0.08, green: 0.08, blue: 0.09),
                SceneColor(red: 0.13, green: 0.13, blue: 0.14),
            ]
        }
    }
}

private struct SceneColor: Hashable {
    let red: Double
    let green: Double
    let blue: Double
    let opacity: Double

    nonisolated init(red: Double, green: Double, blue: Double, opacity: Double = 1) {
        self.red = red
        self.green = green
        self.blue = blue
        self.opacity = opacity
    }
}

private struct HalftoneField: View {
    var body: some View {
        GeometryReader { proxy in
            let columns = 36
            let rows = 18
            let cellWidth = proxy.size.width / CGFloat(columns)
            let cellHeight = proxy.size.height / CGFloat(rows)

            ForEach(0..<rows, id: \.self) { row in
                ForEach(0..<columns, id: \.self) { column in
                    Circle()
                        .fill(MacOnboardingTheme.text.opacity(Agentic30Theme.current == .white ? 0.10 : 0.35))
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

private struct AssistantMark: View {
    var body: some View {
        GeometryReader { proxy in
            let minSide = min(proxy.size.width, proxy.size.height)
            let capHeight = minSide * 0.58
            let capWidth = capHeight * 0.48
            let capSpacing = capWidth * 0.7
            let cornerR = minSide * 0.28

            ZStack {
                RoundedRectangle(cornerRadius: cornerR, style: .continuous)
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

                HStack(spacing: capSpacing) {
                    Capsule()
                        .fill(MacOnboardingTheme.surface.opacity(0.95))
                        .frame(width: capWidth, height: capHeight)
                    Capsule()
                        .fill(MacOnboardingTheme.surface.opacity(0.95))
                        .frame(width: capWidth, height: capHeight)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height)
            .clipShape(RoundedRectangle(cornerRadius: cornerR, style: .continuous))
        }
    }
}

private struct FloatingBriefingBubble: View {
    var body: some View {
        HStack(spacing: 14) {
            Image(nsImage: NSApplication.shared.applicationIconImage)
                .resizable()
                .interpolation(.high)
                .aspectRatio(contentMode: .fit)
                .frame(width: 42, height: 42)
            VStack(alignment: .leading, spacing: 4) {
                Text("오늘의 한 가지")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                Text("이번 주 가입자 3명에게 30분 인터뷰 요청하고 결제 의향 묻기.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(MacOnboardingTheme.visualSecondaryText)
            }
            Spacer(minLength: 0)
            Text("실행")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(Capsule().fill(Color(red: 0.26, green: 0.85, blue: 0.54)))
        }
        .foregroundStyle(MacOnboardingTheme.visualText)
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(MacOnboardingTheme.badgeFill)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        )
    }
}

private struct FloatingMilestoneCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("30-day launch path")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(MacOnboardingTheme.visualSecondaryText)
            Text("Idea → product → 100 users → first revenue")
                .font(.system(size: 23, weight: .bold, design: .rounded))
                .foregroundStyle(MacOnboardingTheme.visualText)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 22)
        .background(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(MacOnboardingTheme.badgeFill)
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 30, style: .continuous))
        )
    }
}

private struct IntegrationIconRow: View {
    private let items: [(String, Color)] = [
        ("chart.line.uptrend.xyaxis", Color(red: 0.26, green: 0.62, blue: 0.98)),
        ("megaphone.fill", Color(red: 0.95, green: 0.40, blue: 0.32)),
        ("person.2.fill", Color(red: 0.55, green: 0.86, blue: 0.42)),
        ("envelope.fill", Color(red: 0.92, green: 0.64, blue: 0.20)),
    ]

    var body: some View {
        HStack(spacing: 54) {
            ForEach(items, id: \.0) { item in
                RoundedRectangle(cornerRadius: 28, style: .continuous)
                    .fill(MacOnboardingTheme.badgeFill)
                    .frame(width: 118, height: 118)
                    .overlay {
                        Image(systemName: item.0)
                            .font(.system(size: 46, weight: .bold))
                            .foregroundStyle(item.1)
                    }
            }
        }
    }
}

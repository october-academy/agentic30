import SwiftUI
import AppKit

struct MacOnboardingView: View {
    @ObservedObject var viewModel: AgenticViewModel

    @State private var sceneIndex = 0
    @State private var selectedWorkspaceURL: URL?

    private let scenes = MacOnboardingScene.all

    var body: some View {
        if viewModel.needsProjectWorkspace {
            workspacePickerStage
        } else if viewModel.needsOnboardingContext {
            MacOnboardingContextView(viewModel: viewModel)
        } else {
            onboardingStage
        }
    }

    private var onboardingStage: some View {
        VStack(spacing: 0) {
            visualStage
                .frame(height: 318)

            VStack(alignment: .leading, spacing: 22) {
                progressDots

                VStack(alignment: .leading, spacing: 12) {
                    Text(currentScene.title)
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                        .fixedSize(horizontal: false, vertical: true)

                    Text(currentScene.subtitle)
                        .font(.system(size: 18, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.56))
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
            .background(Color(red: 0.07, green: 0.075, blue: 0.08))
        }
        .frame(width: 716, height: 676)
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
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
                    .foregroundStyle(.white.opacity(0.88))
            }
            .frame(height: 246)

            VStack(alignment: .leading, spacing: 22) {
                VStack(alignment: .leading, spacing: 12) {
                    Text("Choose your project folder")
                        .font(.system(size: 34, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))

                    Text("agentic30 reads docs, runs agents, and writes strategy files inside this workspace. Pick the repo or project directory you want the assistant to work on.")
                        .font(.system(size: 17, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.58))
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
                                .foregroundStyle(.white.opacity(0.48))
                                .lineLimit(1)
                        }
                        Spacer(minLength: 0)
                    }
                    .foregroundStyle(.white.opacity(0.9))
                    .padding(16)
                    .background(
                        RoundedRectangle(cornerRadius: 18, style: .continuous)
                            .fill(Color.white.opacity(0.08))
                            .overlay(
                                RoundedRectangle(cornerRadius: 18, style: .continuous)
                                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
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
                        .foregroundStyle(.white.opacity(0.46))

                    Spacer(minLength: 0)

                    Button {
                        if let selectedWorkspaceURL {
                            viewModel.setProjectWorkspace(selectedWorkspaceURL)
                        }
                    } label: {
                        Text("Start assistant")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(Color.black.opacity(selectedWorkspaceURL == nil ? 0.36 : 0.86))
                            .padding(.horizontal, 28)
                            .padding(.vertical, 14)
                            .background(
                                Capsule()
                                    .fill(Color.white.opacity(selectedWorkspaceURL == nil ? 0.34 : 0.96))
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
            .background(Color(red: 0.07, green: 0.075, blue: 0.08))
        }
        .frame(width: 716, height: 676)
        .clipShape(RoundedRectangle(cornerRadius: 34, style: .continuous))
        .overlay {
            RoundedRectangle(cornerRadius: 34, style: .continuous)
                .stroke(Color.white.opacity(0.08), lineWidth: 1)
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
                colors: currentScene.visualColors,
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

    private var progressDots: some View {
        HStack(spacing: 8) {
            ForEach(scenes.indices, id: \.self) { index in
                Capsule()
                    .fill(index == sceneIndex ? Color.white.opacity(0.9) : Color.white.opacity(0.22))
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
                    .foregroundStyle(.white.opacity(sceneIndex == 0 ? 0.28 : 0.78))
                    .padding(.horizontal, 24)
                    .padding(.vertical, 13)
                    .background(Capsule().fill(Color.white.opacity(0.08)))
            }
            .buttonStyle(.plain)
            .disabled(sceneIndex == 0)
            .accessibilityIdentifier("macOnboarding.backButton")

            Spacer(minLength: 0)

            Button {
                primaryAction()
            } label: {
                Text("Next")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(Color.black.opacity(0.86))
                .padding(.horizontal, 28)
                .padding(.vertical, 14)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(0.96))
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("macOnboarding.primaryButton")
            .accessibilityLabel("Next")
        }
    }

    private func primaryAction() {
        sceneIndex = min(scenes.count - 1, sceneIndex + 1)
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
    let visualColors: [Color]

    enum Visual: Hashable {
        case mark
        case briefing
        case launch
        case integrations
    }

    static let all: [MacOnboardingScene] = [
        MacOnboardingScene(
            title: "Welcome to agentic30",
            subtitle: "Your AI Cofounder for Indie Hacking.\nGet clear briefings on your product progress, ad performance, and customer issues.",
            visual: .mark,
            visualColors: [
                Color(red: 0.06, green: 0.07, blue: 0.07),
                Color(red: 0.11, green: 0.22, blue: 0.16),
                Color(red: 0.40, green: 0.74, blue: 0.33).opacity(0.75),
            ]
        ),
        MacOnboardingScene(
            title: "We’re always by your side",
            subtitle: "When you’re unsure what to do next, we use your logs and memory to suggest—and help you execute—what truly matters today.",
            visual: .briefing,
            visualColors: [
                Color(red: 0.08, green: 0.10, blue: 0.09),
                Color(red: 0.35, green: 0.41, blue: 0.28),
                Color(red: 0.80, green: 0.74, blue: 0.52),
            ]
        ),
        MacOnboardingScene(
            title: "Build, launch, earn in 30 days",
            subtitle: "We help you go from idea to product, 100 users, and your first revenue—fast.",
            visual: .launch,
            visualColors: [
                Color(red: 0.08, green: 0.10, blue: 0.09),
                Color(red: 0.24, green: 0.33, blue: 0.24),
                Color(red: 0.70, green: 0.64, blue: 0.44),
            ]
        ),
        MacOnboardingScene(
            title: "Ship faster, learn faster",
            subtitle: "Get clear summaries, user insights, and next steps—right after you build.",
            visual: .integrations,
            visualColors: [
                Color(red: 0.07, green: 0.075, blue: 0.08),
                Color(red: 0.08, green: 0.08, blue: 0.09),
                Color(red: 0.13, green: 0.13, blue: 0.14),
            ]
        ),
    ]
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
                        .fill(Color.black.opacity(0.35))
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
                        .fill(Color.white.opacity(0.95))
                        .frame(width: capWidth, height: capHeight)
                    Capsule()
                        .fill(Color.white.opacity(0.95))
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
            AssistantMark()
                .frame(width: 42, height: 34)
            VStack(alignment: .leading, spacing: 4) {
                Text("Today’s focus")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                Text("Fix checkout friction before buying more ads.")
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.72))
            }
            Spacer(minLength: 0)
            Text("Execute")
                .font(.system(size: 14, weight: .bold, design: .rounded))
                .padding(.horizontal, 18)
                .padding(.vertical, 10)
                .background(Capsule().fill(Color(red: 0.26, green: 0.85, blue: 0.54)))
        }
        .foregroundStyle(.white.opacity(0.92))
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .background(
            RoundedRectangle(cornerRadius: 26, style: .continuous)
                .fill(Color.black.opacity(0.32))
                .background(.ultraThinMaterial, in: RoundedRectangle(cornerRadius: 26, style: .continuous))
        )
    }
}

private struct FloatingMilestoneCard: View {
    var body: some View {
        VStack(alignment: .leading, spacing: 10) {
            Text("30-day launch path")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.74))
            Text("Idea → product → 100 users → first revenue")
                .font(.system(size: 23, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.94))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 24)
        .padding(.vertical, 22)
        .background(
            RoundedRectangle(cornerRadius: 30, style: .continuous)
                .fill(Color.black.opacity(0.34))
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
                    .fill(Color.white.opacity(0.06))
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

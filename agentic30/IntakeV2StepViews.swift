import SwiftUI
import AppKit
import Combine

// MARK: - Intake V2 Step Views — review decisions 2026-05-14

// MARK: - Commitment

@MainActor
struct IntakeV2CommitmentView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2ProgressReservedSpace()
                IntakeV2Header(
                    title: "하루에 얼마나 시간을 쓸 수 있나요?",
                    subtitle: "쓸 수 있는 시간에 맞춰 오늘 과제의 크기를 조절합니다."
                )
                VStack(spacing: 8) {
                    ForEach(IntakeV2CommitmentLevel.allCases, id: \.self) { level in
                        IntakeV2OptionCard(
                            title: level.displayTitle,
                            description: level.displayDescription,
                            selected: store.commitmentLevel == level,
                            accessibilityIdentifier: "intakeV2.commitment.option.\(level.rawValue)",
                            onTap: { store.selectCommitmentLevel(level) }
                        )
                    }
                }
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isCommitmentComplete,
                onBack: onBack,
                onNext: onNext
            )
        }
    }

}

// MARK: - Focus Area

@MainActor
struct IntakeV2FocusAreaView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2ProgressReservedSpace()
                IntakeV2Header(
                    title: OnboardingFocusArea.onboardingQuestion,
                    subtitle: OnboardingFocusArea.onboardingSubtitle
                )
                VStack(spacing: 8) {
                    ForEach(OnboardingFocusArea.onboardingChoices, id: \.self) { focusArea in
                        IntakeV2OptionCard(
                            title: focusArea.displayTitle,
                            description: focusArea.displayDescription,
                            selected: store.focusArea == focusArea,
                            accessibilityIdentifier: "intakeV2.focusArea.option.\(focusArea.rawValue)",
                            onTap: { store.focusArea = focusArea; store.persist() }
                        )
                    }
                }
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isFocusAreaComplete,
                onBack: onBack,
                onNext: onNext
            )
        }
    }

}

// MARK: - Bottleneck

@MainActor
struct IntakeV2BottleneckView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2ProgressReservedSpace()
                IntakeV2Header(
                    title: OnboardingProductBottleneck.onboardingQuestion,
                    subtitle: "병목에 맞춰 먼저 볼 문제를 정합니다."
                )
                VStack(spacing: 8) {
                    ForEach(OnboardingProductBottleneck.onboardingChoices, id: \.self) { bottleneck in
                        IntakeV2OptionCard(
                            title: bottleneck.displayTitle,
                            description: bottleneck.displayDescription,
                            selected: store.bottleneck == bottleneck,
                            accessibilityIdentifier: "intakeV2.bottleneck.option.\(bottleneck.rawValue)",
                            onTap: { store.bottleneck = bottleneck; store.persist() }
                        )
                    }
                }
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isBottleneckComplete,
                onBack: onBack,
                onNext: onNext
            )
        }
    }

}

// MARK: - Evidence

@MainActor
struct IntakeV2EvidenceView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2ProgressReservedSpace()
                IntakeV2Header(
                    title: "이미 가진 기록이 있나요?",
                    subtitle: "여러 개 선택할 수 있어요. 이 기록을 기준으로 첫 결정을 더 구체적으로 만듭니다."
                )
                VStack(spacing: 8) {
                    ForEach(OnboardingIsolationLevel.intakeV2EvidenceChoices, id: \.self) { level in
                        IntakeV2OptionCard(
                            title: level.displayTitle,
                            description: level.displayDescription,
                            selected: store.evidenceLevels.contains(level),
                            selectionStyle: .multiple,
                            accessibilityIdentifier: "intakeV2.evidence.option.\(level.rawValue)",
                            onTap: { store.toggleEvidenceLevel(level) }
                        )
                    }
                }
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isEvidenceComplete,
                onBack: onBack,
                onNext: onNext
            )
        }
    }
}

// MARK: - Folder pick (D5 eng + D7/D9 design)

@MainActor
struct IntakeV2FolderPickView: View {
    @ObservedObject var store: IntakeV2Store
    @ObservedObject var sources: IntakeV2SourceManager
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    @State private var fileCount: Int = 0
    @State private var didCopyAgentPrompt = false
    @State private var isPresentingFolderPicker = false

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2ProgressReservedSpace()
                IntakeV2Header(
                    title: "프로젝트 폴더를 연결할까요?",
                    subtitle: store.folderURL == nil
                        ? "폴더를 선택하면 첫 과제가 내 코드에 맞춰집니다. AI 도구로 위치만 보낼 수도 있어요."
                        : "선택한 프로젝트를 바탕으로 첫 결정을 준비합니다."
                )
                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 10) {
                        Image(systemName: "folder.fill")
                            .font(.system(size: 16, weight: .semibold))
                            .foregroundStyle(IntakeV2Color.accentBright)
                            .frame(width: 22)
                        Text("프로젝트 폴더")
                            .font(.system(size: 16, weight: .bold, design: .rounded))
                            .foregroundStyle(IntakeV2Color.textPrimary)
                    }

                    Text("파일을 수정하지 않습니다. 확인 후 이 Mac에서만 읽습니다.")
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if let url = store.folderURL {
                        selectedFolderSummary(url)

                        // Folder connected → keep a quiet "change folder" affordance.
                        Button(action: { chooseFolder() }) {
                            HStack(spacing: 8) {
                                Image(systemName: "folder")
                                    .font(.system(size: 13, weight: .semibold))
                                Text(folderPickButtonTitle)
                                    .font(.system(size: 13, weight: .medium, design: .rounded))
                            }
                            .foregroundStyle(IntakeV2Color.textSecondary)
                        }
                        .buttonStyle(.plain)
                        .disabled(isPresentingFolderPicker)
                        .accessibilityIdentifier("intakeV2.folderPickButton")
                    } else {
                        // PRIMARY: one-click native folder picker. Connecting a project is the
                        // ICP-defining action and the only input to the adaptive engine, so it is
                        // the prominent path — not the out-of-band CLI prompt copy.
                        Button(action: { chooseFolder() }) {
                            HStack(spacing: 10) {
                                Image(systemName: "folder.badge.plus")
                                    .font(.system(size: 16, weight: .semibold))
                                Text(folderPickButtonTitle)
                                    .font(.system(size: 17, weight: .bold, design: .rounded))
                            }
                            .foregroundStyle(IntakeV2Color.primaryButtonText)
                            .padding(.horizontal, 26)
                            .padding(.vertical, 15)
                            .frame(minWidth: 230)
                            .background(
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(IntakeV2Color.primaryButtonFill)
                            )
                        }
                        .buttonStyle(.plain)
                        .disabled(isPresentingFolderPicker)
                        .accessibilityIdentifier("intakeV2.folderPickButton")

                        // SECONDARY: AI-tool (CLI prompt) path, for users editing in Cursor/Codex.
                        Button(action: copyAgentPrompt) {
                            HStack(spacing: 8) {
                                Image(systemName: didCopyAgentPrompt ? "checkmark" : "doc.on.doc")
                                    .font(.system(size: 14, weight: .semibold))
                                Text(didCopyAgentPrompt ? "프롬프트 복사됨" : "AI 도구로 연결 (Cursor·Codex)")
                                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                            }
                            .foregroundStyle(IntakeV2Color.secondaryButtonText)
                            .padding(.horizontal, 18)
                            .padding(.vertical, 11)
                            .background(
                                RoundedRectangle(cornerRadius: 10)
                                    .fill(IntakeV2Color.secondaryButtonFill)
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityLabel(didCopyAgentPrompt ? "프롬프트 복사됨. Cursor, Claude Code, Codex에 붙여넣으세요." : "AI 도구로 연결")
                        .accessibilityIdentifier("intakeV2.folderPromptCopyButton")

                        folderPromptPasteGuideSlot

                        // TERTIARY: explicit, deliberate "start without a folder" escape hatch.
                        VStack(alignment: .leading, spacing: 4) {
                            Button(action: skipFolderSelection) {
                                Text("폴더 없이 시작")
                                    .font(.system(size: 12, weight: .medium, design: .rounded))
                                    .foregroundStyle(IntakeV2Color.textTertiary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("intakeV2.folderSkipButton")

                            Text("폴더 없이 시작하면 첫 과제가 일반적인 예시로 채워집니다.")
                                .font(.system(size: 11, weight: .medium, design: .rounded))
                                .foregroundStyle(IntakeV2Color.textTertiary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        .padding(.top, 2)
                    }
                }
                .padding(22)
                .frame(maxWidth: 760, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(IntakeV2Color.cardFill)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(IntakeV2Color.cardStroke, lineWidth: 1)
                )
                .padding(.top, 2)
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Continue →",
                nextEnabled: store.isStep4Complete,
                onBack: onBack,
                onNext: {
                    if let url = store.folderURL {
                        sources.registerLocalFolder(url, fileCount: fileCount > 0 ? fileCount : nil)
                    }
                    onNext()
                }
            )
        }
        .onAppear {
            ensureOnboardingTokenIssued()
            applyIncomingWorkspaceRequest()
        }
        .onReceive(Timer.publish(every: 1, on: .main, in: .common).autoconnect()) { _ in
            applyIncomingWorkspaceRequest()
        }
    }

    @ViewBuilder
    private func selectedFolderSummary(_ url: URL) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(verbatim: url.lastPathComponent)
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(IntakeV2Color.textPrimary)
                .lineLimit(1)
                .truncationMode(.middle)
            Text(verbatim: url.path)
                .font(.system(size: 13, weight: .medium, design: .monospaced))
                .foregroundStyle(IntakeV2Color.textTertiary)
                .lineLimit(1)
                .truncationMode(.middle)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: url.path))
                .accessibilityValue(Text(verbatim: url.path))
                .accessibilityIdentifier("intakeV2.selectedFolderPath")
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .overlay {
            IntakeV2Color.invisibleHitArea
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(verbatim: url.lastPathComponent))
                .accessibilityValue(Text(verbatim: url.path))
                .accessibilityIdentifier("intakeV2.selectedFolderName")
                .allowsHitTesting(false)
        }
    }

    @ViewBuilder
    private var folderPromptPasteGuideSlot: some View {
        if didCopyAgentPrompt {
            VStack(alignment: .leading, spacing: 6) {
                Text("열어 둔 Cursor, Claude Code, Codex에 붙여넣으세요.")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)

                HStack(spacing: 7) {
                    IntakeV2ActivitySpinner(
                        size: 14,
                        lineWidth: 2,
                        color: IntakeV2Color.accentBright,
                        trackColor: IntakeV2Color.spinnerTrack
                    )
                    Text("폴더가 감지되면 여기서 확인합니다.")
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 12)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(IntakeV2Color.accent.opacity(0.08))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(IntakeV2Color.accent.opacity(0.28), lineWidth: 1)
            )
            .transition(.opacity)
            .accessibilityIdentifier("intakeV2.folderPromptPasteGuide")
        }
    }

    private func ensureOnboardingTokenIssued() {
        let store = OnboardingNonceStore()
        if store.currentToken() == nil {
            _ = try? store.rotateAndIssue()
        }
    }

    private func copyAgentPrompt() {
        do {
            _ = try OnboardingHelperInstaller().installOrRefresh()
        } catch {
            presentHelperInstallFailureAlert(error: error)
            return
        }
        let nonceStore = OnboardingNonceStore()
        let token = nonceStore.currentToken() ?? (try? nonceStore.rotateAndIssue()) ?? ""
        let prompt = Self.agentWorkspaceRegistrationPrompt(token: token)
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(prompt, forType: .string)
        withAnimation(.easeInOut(duration: 0.16)) {
            didCopyAgentPrompt = true
        }
    }

    private func presentHelperInstallFailureAlert(error: Error) {
        let alert = NSAlert()
        alert.alertStyle = .warning
        alert.messageText = "온보딩 명령을 준비하지 못했습니다"
        alert.informativeText = """
        \(error.localizedDescription)

        Agentic30을 재시작해도 같은 문제가 발생하면 Node 설치 상태를 확인하거나 GitHub Issue로 알려주세요.
        """
        alert.addButton(withTitle: "닫기")
        alert.runModal()
    }

    private func applyIncomingWorkspaceRequest() {
        guard store.folderURL == nil else { return }
        guard let request = OnboardingWorkspaceRequestStore().latestPendingRequest() else { return }
        let url = request.url
        fileCount = (try? FileManager.default.contentsOfDirectory(atPath: url.path).count) ?? 0
        withAnimation(.easeInOut(duration: 0.18)) {
            store.folderURL = url
        }
        store.persist()
        OnboardingWorkspaceRequestStore().removeRequest(id: request.id)
        OnboardingNonceStore().invalidate()
        PostHogTelemetry.capture("mac_onboarding_folder_selected", properties: [
            "source": "helper_request",
            "workspace_root": url.path,
            "file_count": fileCount,
        ])
    }

    private func chooseFolder() {
        #if DEBUG
        if let url = uiTestingWorkspacePickerURL() {
            applySelectedFolder(url)
            return
        }
        #endif

        guard !isPresentingFolderPicker else { return }
        isPresentingFolderPicker = true
        PostHogTelemetry.capture("mac_onboarding_folder_picker_opened", properties: [
            "had_existing_folder": store.folderURL != nil,
        ])

        AgenticOpenPanelPresenter.present { panel in
            panel.canChooseFiles = false
            panel.canChooseDirectories = true
            panel.allowsMultipleSelection = false
            panel.canCreateDirectories = false
            panel.level = .modalPanel
            panel.message = "agentic30이 읽을 폴더를 선택해주세요"
            panel.directoryURL = store.folderURL ?? FileManager.default.homeDirectoryForCurrentUser
        } completion: { response, url in
            isPresentingFolderPicker = false
            guard response == .OK, let url else {
                PostHogTelemetry.capture("mac_onboarding_folder_picker_cancelled")
                return
            }
            applySelectedFolder(url)
        }
    }

    private var folderPickButtonTitle: String {
        if isPresentingFolderPicker { return "폴더 선택 중" }
        return store.folderURL == nil ? "프로젝트 폴더 선택" : "다른 폴더 선택"
    }

    private func applySelectedFolder(_ url: URL) {
        store.folderURL = url
        fileCount = (try? FileManager.default.contentsOfDirectory(atPath: url.path).count) ?? 0
        store.persist()
        PostHogTelemetry.capture("mac_onboarding_folder_selected", properties: [
            "source": "picker",
            "workspace_root": url.path,
            "file_count": fileCount,
        ])
    }

    private func skipFolderSelection() {
        store.folderURL = nil
        store.persist()
        PostHogTelemetry.capture("mac_onboarding_folder_skipped", properties: [
            "source": "explicit_no_folder",
        ])
        onNext()
    }

    static func agentWorkspaceRegistrationPrompt(token: String) -> String {
        let helperPath = OnboardingHelperInstaller().helperURL.path
        let helperShellPath = OnboardingHelperInstaller.shellQuote(helperPath)
        return """
        Agentic30 온보딩에 현재 프로젝트 폴더를 연결해줘. 이 작업은 Agentic30에 path 한 번을 전달하는 것이고 프로젝트 파일은 수정되지 않습니다.

        helper command:
        \(helperPath)

        onboarding token:
        \(token)

        ## 한 줄 명령으로 등록

        HELPER=\(helperShellPath)
        TARGET='<현재 프로젝트의 절대 경로>'
        SOURCE='claude_code'   # cursor | codex | claude_code
        TOKEN='\(token)'

        "$HELPER" --register --path "$TARGET" --source "$SOURCE" --token "$TOKEN"

        응답 한 줄 JSON에서 `"ok": true` 와 `claimedSource` 를 확인해. 절대 경로를 모르면 현재 프로젝트 cwd에서 `--path` 를 빼고 실행하거나 `--path .` 를 사용해.

        ## 제약

        - 프로젝트 파일을 읽거나, 스캔하거나, 수정하지 마.
        - helper 바이너리 외 다른 프로세스를 실행하지 마. `chmod`, `launchctl`, 패키지 매니저, installer, 다른 binary 금지.
        - 어떤 영구 설정 파일도 새로 만들지 마.

        ## 완료 메시지

        `"ok": true` 응답이 오면 사용자에게 정확히 이 한 문장만 알려:
        "Agentic30 앱으로 돌아가 프로젝트 폴더를 확인하세요"
        """
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

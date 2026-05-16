import SwiftUI
import AppKit

// MARK: - Intake V2 Step Views — review decisions 2026-05-14
// Role / Blocker / Commitment / Evidence / Folder Pick

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

// MARK: - Role

@MainActor
struct IntakeV2RoleView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2ProgressReservedSpace()
                IntakeV2Header(
                    title: "지금 하루를 가장 많이 쓰는 역할은 무엇인가요?",
                    subtitle: "익숙한 일하는 방식에 맞춰 설명과 제안을 조정합니다."
                )
                VStack(spacing: 8) {
                    ForEach(OnboardingRole.onboardingChoices, id: \.self) { role in
                        IntakeV2OptionCard(
                            title: role.displayTitle,
                            description: role.displayDescription,
                            selected: store.role == role,
                            accessibilityIdentifier: "intakeV2.role.option.\(role.rawValue)",
                            onTap: { store.role = role; store.persist() }
                        )
                    }
                }
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isRoleComplete,
                onBack: onBack,
                onNext: onNext
            )
        }
    }

}

// MARK: - Blocker

@MainActor
struct IntakeV2StuckView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2ProgressReservedSpace()
                IntakeV2Header(
                    title: "지금 가장 큰 막힘은 무엇인가요?",
                    subtitle: "막힌 지점에 맞춰 먼저 볼 문제를 정합니다."
                )
                VStack(spacing: 8) {
                    ForEach(OnboardingProjectStage.onboardingChoices, id: \.self) { stage in
                        IntakeV2OptionCard(
                            title: stage.displayTitle,
                            description: stage.displayDescription,
                            selected: store.stuck == stage,
                            accessibilityIdentifier: "intakeV2.blocker.option.\(stage.rawValue)",
                            onTap: { store.stuck = stage; store.persist() }
                        )
                    }
                }
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isBlockerComplete,
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

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2ProgressReservedSpace()
                IntakeV2Header(
                    title: "첫 결정을 만들 프로젝트 폴더를 선택할까요?",
                    subtitle: store.folderURL == nil
                        ? "코드·문서·SPEC을 읽으면 오늘 할 일을 더 정확하게 고를 수 있습니다. 지금 건너뛰어도 시작할 수 있습니다."
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

                    Text("선택한 폴더는 이 Mac에서만 읽습니다.")
                        .font(.system(size: 13, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    if let url = store.folderURL {
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
                            Color.white.opacity(0.001)
                                .accessibilityElement(children: .ignore)
                                .accessibilityLabel(Text(verbatim: url.lastPathComponent))
                                .accessibilityValue(Text(verbatim: url.path))
                                .accessibilityIdentifier("intakeV2.selectedFolderName")
                                .allowsHitTesting(false)
                        }
                    }

                    Button(action: { chooseFolder() }) {
                        HStack(spacing: 10) {
                            Image(systemName: "folder.fill")
                                .font(.system(size: 16, weight: .semibold))
                            Text(store.folderURL == nil ? "폴더 선택하기" : "다른 폴더 선택")
                                .font(.system(size: 17, weight: .bold, design: .rounded))
                        }
                        .foregroundStyle(.black)
                        .padding(.horizontal, 26)
                        .padding(.vertical, 15)
                        .frame(minWidth: 230)
                        .background(
                            RoundedRectangle(cornerRadius: 12)
                                .fill(Color.white)
                        )
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("intakeV2.folderPickButton")

                    if store.folderURL == nil {
                        VStack(alignment: .leading, spacing: 4) {
                            Button(action: skipFolderSelection) {
                                Text("나중에 폴더 선택")
                                    .font(.system(size: 12, weight: .medium, design: .rounded))
                                    .foregroundStyle(IntakeV2Color.textTertiary)
                            }
                            .buttonStyle(.plain)
                            .accessibilityIdentifier("intakeV2.folderSkipButton")
                        }
                        .padding(.top, 2)
                    }
                }
                .padding(22)
                .frame(maxWidth: 760, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 12)
                        .fill(.white.opacity(0.03))
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(.white.opacity(0.08), lineWidth: 1)
                )
                .padding(.top, 2)
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Continue →",
                nextEnabled: store.isStep4Complete,
                nextVisible: store.folderURL != nil,
                onBack: onBack,
                onNext: {
                    if let url = store.folderURL {
                        sources.registerLocalFolder(url, fileCount: fileCount > 0 ? fileCount : nil)
                    }
                    onNext()
                }
            )
        }
    }

    private func chooseFolder() {
        #if DEBUG
        if let url = uiTestingWorkspacePickerURL() {
            store.folderURL = url
            fileCount = (try? FileManager.default.contentsOfDirectory(atPath: url.path).count) ?? 0
            store.persist()
            return
        }
        #endif

        let panel = NSOpenPanel()
        panel.canChooseFiles = false
        panel.canChooseDirectories = true
        panel.allowsMultipleSelection = false
        panel.message = "agentic30이 읽을 폴더를 선택해주세요"
        if panel.runModal() == .OK, let url = panel.url {
            store.folderURL = url
            fileCount = (try? FileManager.default.contentsOfDirectory(atPath: url.path).count) ?? 0
            store.persist()
        }
    }

    private func skipFolderSelection() {
        store.folderURL = nil
        store.persist()
        onNext()
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

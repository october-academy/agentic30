import SwiftUI
import AppKit

// MARK: - Intake V2 Step Views — review decisions 2026-05-14
// Step 2 Context / Step 3 Role / Step 4 Blocker / Step 5 Folder Pick
// + Splash (real local scan) + First Decide

// MARK: - Step 2: Context

@MainActor
struct IntakeV2WorkmodeView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2DashPagination(current: 2, total: 7, label: "CONTEXT", progressNamespace: progressNamespace)
                IntakeV2Header(
                    title: "얼마나 혼자, 얼마나 자주 만들 수 있나요?",
                    subtitle: "쓸 수 있는 시간과 책임 범위에 맞춰 오늘 할 일을 정합니다."
                )
                VStack(spacing: 8) {
                    ForEach(OnboardingWorkMode.onboardingChoices, id: \.self) { mode in
                        IntakeV2OptionCard(
                            title: mode.displayTitle,
                            description: mode.displayDescription,
                            selected: store.workmode == mode,
                            onTap: { store.workmode = mode; store.persist() }
                        )
                    }
                    IntakeV2OptionCard(
                        title: OnboardingWorkMode.exploring.displayTitle,
                        description: OnboardingWorkMode.exploring.displayDescription,
                        selected: store.workmode == .exploring,
                        onTap: { store.workmode = .exploring; store.persist() }
                    )
                }
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isStep1Complete,
                onBack: onBack,
                onNext: onNext
            )
        }
    }

}

// MARK: - Step 3: Role

@MainActor
struct IntakeV2RoleView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2DashPagination(current: 3, total: 7, label: "ROLE", progressNamespace: progressNamespace)
                IntakeV2Header(
                    title: "가장 자주 하는 역할은 무엇인가요?",
                    subtitle: "익숙한 일하는 방식에 맞춰 설명과 제안을 조정합니다."
                )
                VStack(spacing: 8) {
                    ForEach(OnboardingRole.allCases, id: \.self) { role in
                        IntakeV2OptionCard(
                            title: role.displayTitle,
                            description: role.displayDescription,
                            selected: store.role == role,
                            onTap: { store.role = role; store.persist() }
                        )
                    }
                }
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isStep2Complete,
                onBack: onBack,
                onNext: onNext
            )
        }
    }

}

// MARK: - Step 4: Blocker

@MainActor
struct IntakeV2StuckView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 24) {
                IntakeV2DashPagination(current: 4, total: 7, label: "BLOCKER", progressNamespace: progressNamespace)
                IntakeV2Header(
                    title: "현재 가장 큰 막힘은 무엇인가요?",
                    subtitle: "막힌 지점에 맞춰 먼저 볼 문제를 정합니다."
                )
                VStack(spacing: 8) {
                    ForEach(OnboardingProjectStage.onboardingChoices, id: \.self) { stage in
                        IntakeV2OptionCard(
                            title: stage.displayTitle,
                            description: stage.displayDescription,
                            selected: store.stuck == stage,
                            onTap: { store.stuck = stage; store.persist() }
                        )
                    }
                }
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isStep3Complete,
                onBack: onBack,
                onNext: onNext
            )
        }
    }

}

// MARK: - Step 5: Folder pick (D5 eng + D7/D9 design)

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
                IntakeV2DashPagination(current: 5, total: 7, label: "FOLDER", progressNamespace: progressNamespace)
                IntakeV2Header(
                    title: "어디서 읽을까요?",
                    subtitle: store.folderURL == nil
                        ? "폴더를 선택하면 코드와 문서를 바탕으로 더 정확하게 도와드릴 수 있습니다."
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

// MARK: - Splash + FirstDecision removed 2026-05-14
// Replaced by BootIntro before intake, then ConnectShowcase → ReadyAnalyze
// (terminal + first decision card) after folder pick.

#if SPLASH_LEGACY_KEEP_FOR_REFERENCE
@MainActor
struct IntakeV2SplashView_Legacy: View {
    @ObservedObject var store: IntakeV2Store
    @ObservedObject var sources: IntakeV2SourceManager
    let onComplete: (IntakeV2Decision, Bool) -> Void  // (decision, scanFailed)

    @State private var logLines: [(text: String, done: Bool)] = []
    @State private var scanFailed = false

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(spacing: 12) {
                ProgressView()
                    .controlSize(.small)
                    .tint(IntakeV2Color.accentBright)
                Text("ANALYZING")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.accent)
                    .tracking(1.4)
            }
            IntakeV2Header(
                title: "Init 완료. 첫 결정을 분석합니다.",
                subtitle: scanFailed
                    ? "Local scan에서 충분한 신호를 못 찾았어요. intake 답변만으로 첫 결정을 준비합니다."
                    : "당신의 폴더를 읽고 신호를 추출해 오늘의 한 가지를 결정합니다."
            )
            VStack(alignment: .leading, spacing: 6) {
                ForEach(logLines.indices, id: \.self) { i in
                    HStack(spacing: 8) {
                        Text("$")
                            .foregroundStyle(IntakeV2Color.accent)
                        Text(logLines[i].text)
                            .foregroundStyle(IntakeV2Color.textSecondary)
                        if logLines[i].done {
                            Text("✓")
                                .foregroundStyle(IntakeV2Color.accent)
                        }
                        Spacer()
                    }
                    .font(.system(size: 12, design: .monospaced))
                }
            }
            .padding(14)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(.black.opacity(0.4))
                    .overlay(
                        RoundedRectangle(cornerRadius: 10)
                            .stroke(.white.opacity(0.05), lineWidth: 1)
                    )
            )
            Spacer()
        }
        .padding(.horizontal, 56)
        .padding(.top, 56)
        .padding(.bottom, 36)
        .frame(maxWidth: 1080, alignment: .leading)
        .frame(maxWidth: .infinity)
        .task {
            await runScan()
        }
    }

    private func runScan() async {
        let intake = IntakeSnapshot.from(store: store)
        var scan = LocalScanResult.empty

        appendLine("ingest.intake (\(answeredCount(intake)) answers stored)")
        try? await sleep(ms: 400)
        markLastDone()

        if let url = store.folderURL {
            appendLine("sources.scan \(url.lastPathComponent)")
            try? await sleep(ms: 600)
            do {
                scan = try realScan(url: url)
                markLastDone()
                appendLine("context.read \(scan.fileCount) files indexed")
                try? await sleep(ms: 400)
                markLastDone()
            } catch {
                scanFailed = true
                appendLine("sources.scan failed — falling back to template Decide")
                try? await sleep(ms: 400)
                markLastDone()
            }
        } else {
            // no folder — template-only
            scanFailed = true
            appendLine("sources.scan skipped (no folder selected)")
            try? await sleep(ms: 400)
            markLastDone()
        }

        appendLine("signals.detect + weight.priority")
        try? await sleep(ms: 500)
        markLastDone()

        appendLine("decide")
        try? await sleep(ms: 350)

        let decision = scanFailed
            ? IntakeV2DecisionEngine().fallbackTemplate(intake: intake)
            : IntakeV2DecisionEngine().generate(intake: intake, scan: scan)

        markLastDone()
        appendLine("→ \(decision.taskID)")
        try? await sleep(ms: 600)
        onComplete(decision, scanFailed)
    }

    private func realScan(url: URL) throws -> LocalScanResult {
        let fm = FileManager.default
        let contents = try fm.contentsOfDirectory(atPath: url.path)
        let count = contents.count
        var staleTodo: Int?
        let todoCandidates = ["TODOS.md", "TODO.md", "todos.md"]
        for name in todoCandidates {
            let path = url.appendingPathComponent(name).path
            if let attrs = try? fm.attributesOfItem(atPath: path),
               let modDate = attrs[.modificationDate] as? Date {
                let days = Int(Date().timeIntervalSince(modDate) / 86400)
                staleTodo = days
                break
            }
        }
        return LocalScanResult(
            fileCount: count,
            totalBytes: 0,
            staleSpecDays: nil,
            staleTodoDays: staleTodo,
            lastCommitDays: nil,
            hasInterviewTranscripts: contents.contains { $0.range(of: "interview", options: .caseInsensitive) != nil },
            hasPaymentResponses: false
        )
    }

    private func sleep(ms: Int) async throws {
        try await Task.sleep(nanoseconds: UInt64(ms) * 1_000_000)
    }

    private func appendLine(_ text: String) {
        logLines.append((text, false))
    }

    private func markLastDone() {
        guard !logLines.isEmpty else { return }
        logLines[logLines.count - 1].done = true
    }

    private func answeredCount(_ intake: IntakeSnapshot) -> Int {
        var n = 0
        if intake.workmode != nil { n += 1 }
        if intake.role != nil { n += 1 }
        if intake.stuck != nil { n += 1 }
        if intake.folderURL != nil { n += 1 }
        return n
    }
}

// MARK: - First Decide card + post-onboarding Records banner (D10 design)

@MainActor
struct IntakeV2FirstDecisionView: View {
    let decision: IntakeV2Decision
    @ObservedObject var sources: IntakeV2SourceManager
    let scanFailed: Bool
    let onDone: () -> Void

    @State private var bannerDismissed = false

    var body: some View {
        VStack(spacing: 0) {
            // No hero band — straight into result
            VStack(alignment: .leading, spacing: 18) {
                Text("FIRST DECISION")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.accent)
                    .tracking(1.4)
                    .padding(.top, 32)

                HStack(spacing: 8) {
                    Spacer()
                    Text(decision.taskID)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                }

                // macOS-style notification card
                HStack(spacing: 18) {
                    AppIconLogo()
                    VStack(alignment: .leading, spacing: 6) {
                        Text("오늘의 한 가지")
                            .font(.system(size: 15, weight: .bold))
                            .foregroundStyle(.white)
                        Text(decision.body)
                            .font(.system(size: 16, weight: .medium))
                            .foregroundStyle(.white.opacity(0.94))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer()
                    Button("실행") { onDone() }
                        .buttonStyle(.borderedProminent)
                        .controlSize(.large)
                        .tint(IntakeV2Color.accent)
                }
                .padding(22)
                .background(
                    RoundedRectangle(cornerRadius: 24)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.082, green: 0.13, blue: 0.10),
                                    Color(red: 0.13, green: 0.16, blue: 0.10)
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 24)
                                .stroke(.white.opacity(0.05), lineWidth: 1)
                        )
                )

                // WHY rationale
                HStack(alignment: .top, spacing: 12) {
                    Text("// WHY")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.accent)
                    Text(decision.rationale)
                        .font(.system(size: 13))
                        .foregroundStyle(IntakeV2Color.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                }

                // Scan-failed callout (D8 design — graceful fallback)
                if scanFailed {
                    HStack(spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .foregroundStyle(.yellow)
                        Text("Local scan으로 충분한 신호를 못 찾아 intake 답변 기반 template 결정을 만들었어요. 폴더를 추가하면 더 정확해집니다.")
                            .font(.system(size: 12))
                            .foregroundStyle(IntakeV2Color.textSecondary)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 8)
                            .fill(.yellow.opacity(0.08))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8)
                                    .stroke(.yellow.opacity(0.25), lineWidth: 1)
                            )
                    )
                }

                Spacer()

                // D10 — Post-onboarding Records inline banner
                if !bannerDismissed {
                    HStack(spacing: 14) {
                        Image(systemName: "plus.app.fill")
                            .font(.system(size: 22))
                            .foregroundStyle(IntakeV2Color.accentBright)
                        VStack(alignment: .leading, spacing: 3) {
                            Text("더 정확한 결정을 원하세요?")
                                .font(.system(size: 14, weight: .bold))
                                .foregroundStyle(.white)
                            Text("Notion · Docs · Discord · Stripe · PostHog 등 더 많은 소스를 추가해 신호 정확도를 높일 수 있어요.")
                                .font(.system(size: 12))
                                .foregroundStyle(IntakeV2Color.textTertiary)
                        }
                        Spacer()
                        Button("Add sources") { /* hook to settings — out of scope for this PR */ }
                            .buttonStyle(.bordered)
                            .tint(IntakeV2Color.accentBright)
                        Button(action: { bannerDismissed = true }) {
                            Image(systemName: "xmark")
                                .foregroundStyle(IntakeV2Color.textTertiary)
                        }
                        .buttonStyle(.plain)
                    }
                    .padding(14)
                    .background(
                        RoundedRectangle(cornerRadius: 12)
                            .fill(IntakeV2Color.accent.opacity(0.06))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(IntakeV2Color.accent.opacity(0.2), lineWidth: 1)
                            )
                    )
                }
            }
            .padding(.horizontal, 32)
            .padding(.bottom, 24)
        }
    }
}

private struct AppIconLogo_Legacy: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.white)
                .frame(width: 56, height: 56)
                .shadow(color: .black.opacity(0.3), radius: 10, y: 4)
            HStack(spacing: -6) {
                Circle().fill(Color(red: 0.13, green: 0.77, blue: 0.37)).frame(width: 18, height: 18)
                Circle().fill(Color(red: 0.98, green: 0.45, blue: 0.09)).frame(width: 18, height: 18)
            }
        }
    }
}
#endif

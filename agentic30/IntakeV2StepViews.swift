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

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            IntakeV2DashPagination(current: 2, total: 7, label: "CONTEXT")
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
            if let workmode = store.workmode {
                IntakeV2SelectionImpactView(text: workmodeImpactText(workmode))
            }
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isStep1Complete,
                onBack: onBack,
                onNext: onNext
            )
        }
        .padding(.horizontal, IntakeV2Layout.horizontalPadding)
        .padding(.top, 56)
        .padding(.bottom, 36)
        .intakeV2StepShell()
    }

    private func workmodeImpactText(_ workmode: OnboardingWorkMode) -> String {
        switch workmode {
        case .fullTimeSolo:
            return "오늘 할 일은 하루 단위로 끝낼 수 있는 실행 크기로 잡습니다."
        case .sideProject:
            return "오늘 할 일은 30-60분 안에 끝낼 수 있는 크기로 줄입니다."
        case .teamStartup:
            return "결정 근거와 다음 행동을 팀에 공유하기 쉬운 형태로 정리합니다."
        case .exploring:
            return "먼저 상황 정리와 문제 정의를 우선해 다음 결정을 작게 만듭니다."
        }
    }
}

// MARK: - Step 3: Role

@MainActor
struct IntakeV2RoleView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            IntakeV2DashPagination(current: 3, total: 7, label: "ROLE")
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
            if let role = store.role {
                IntakeV2SelectionImpactView(text: roleImpactText(role))
            }
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isStep2Complete,
                onBack: onBack,
                onNext: onNext
            )
        }
        .padding(.horizontal, IntakeV2Layout.horizontalPadding)
        .padding(.top, 56)
        .padding(.bottom, 36)
        .intakeV2StepShell()
    }

    private func roleImpactText(_ role: OnboardingRole) -> String {
        switch role {
        case .developer:
            return "제안은 코드·문서·릴리즈 흐름을 기준으로 더 구체화합니다."
        case .designer:
            return "브랜드, UX 판단, 화면 표현이 필요한 실행안을 더 먼저 보여줍니다."
        case .productManager:
            return "문제, 지표, 운영 흐름 중심으로 결정 이유를 정리합니다."
        case .student:
            return "학습 부담을 줄이고 작은 확인 과제로 나누어 제안합니다."
        }
    }
}

// MARK: - Step 4: Blocker

@MainActor
struct IntakeV2StuckView: View {
    @ObservedObject var store: IntakeV2Store
    let onBack: () -> Void
    let onNext: () -> Void

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            IntakeV2DashPagination(current: 4, total: 7, label: "BLOCKER")
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
            if let stuck = store.stuck {
                IntakeV2SelectionImpactView(text: stuckImpactText(stuck))
            }
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Next →",
                nextEnabled: store.isStep3Complete,
                onBack: onBack,
                onNext: onNext
            )
        }
        .padding(.horizontal, IntakeV2Layout.horizontalPadding)
        .padding(.top, 56)
        .padding(.bottom, 36)
        .intakeV2StepShell()
    }

    private func stuckImpactText(_ stuck: OnboardingProjectStage) -> String {
        switch stuck {
        case .ideaOnly:
            return "첫 결정은 인터뷰 요청과 문제 좁히기 중심으로 준비합니다."
        case .building:
            return "첫 결정은 가입자 행동과 첫 사용자 확보 신호를 우선합니다."
        case .firstUsers:
            return "첫 결정은 결제 전환을 막는 응답과 이탈 사유를 우선합니다."
        case .preRevenue:
            return "첫 결정은 가격 후보와 다음 제안 실험을 우선합니다."
        case .postRevenue:
            return "첫 결정은 재사용, 이탈, 확산 신호를 우선합니다."
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

    @State private var fileCount: Int = 0
    @State private var skipSelected: Bool = false

    var body: some View {
        VStack(alignment: .leading, spacing: 24) {
            IntakeV2DashPagination(current: 5, total: 7, label: "FOLDER")
            IntakeV2Header(
                title: "어디서 읽을까요?",
                subtitle: "OS가 읽을 폴더를 선택해주세요. 컨텍스트가 클수록 결정 정확도가 높아집니다.",
                trustLine: "// 선택한 폴더는 이 Mac에서만 읽습니다. 클라우드 연결은 나중에 직접 켭니다."
            )
            VStack(spacing: 8) {
                IntakeV2OptionCard(
                    title: store.folderURL != nil
                        ? "읽을 폴더: \(store.folderURL!.lastPathComponent)"
                        : "프로젝트 선택하기",
                    description: store.folderURL != nil ? "클릭해서 다른 폴더 선택" : "원하는 폴더를 직접 고릅니다",
                    selected: store.folderURL != nil,
                    onTap: { chooseFolder() }
                )
                IntakeV2OptionCard(
                    title: "지금은 건너뛰기",
                    description: "코드·문서를 읽지 못해 첫 결정 정확도는 낮아집니다. 나중에 Settings에서 추가할 수 있습니다.",
                    selected: skipSelected,
                    onTap: { skipSelected = true; store.folderURL = nil; store.persist() }
                )
            }
            if skipSelected {
                IntakeV2SelectionImpactView(
                    text: "intake 답변만으로 시작합니다. 첫 결정은 템플릿에 가깝고, 폴더는 Settings에서 추가할 수 있습니다."
                )
            }
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Continue →",
                nextEnabled: store.isStep4Complete || skipSelected,
                onBack: onBack,
                onNext: {
                    if let url = store.folderURL {
                        sources.registerLocalFolder(url, fileCount: fileCount > 0 ? fileCount : nil)
                    }
                    onNext()
                }
            )
        }
        .padding(.horizontal, IntakeV2Layout.horizontalPadding)
        .padding(.top, 56)
        .padding(.bottom, 36)
        .intakeV2StepShell()
    }

    private func chooseFolder() {
        #if DEBUG
        if let url = uiTestingWorkspacePickerURL() {
            store.folderURL = url
            fileCount = (try? FileManager.default.contentsOfDirectory(atPath: url.path).count) ?? 0
            store.persist()
            skipSelected = false
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
            skipSelected = false
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

private struct IntakeV2SelectionImpactView: View {
    let text: String

    var body: some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Image(systemName: "arrow.turn.down.right")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(IntakeV2Color.accentBright)
            Text(text)
                .font(.system(size: 12.5, weight: .semibold, design: .rounded))
                .foregroundStyle(IntakeV2Color.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(IntakeV2Color.accent.opacity(0.055))
                .overlay(
                    RoundedRectangle(cornerRadius: 8)
                        .stroke(IntakeV2Color.accent.opacity(0.16), lineWidth: 1)
                )
        )
        .accessibilityIdentifier("intakeV2.selectionImpact")
    }
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

                // Meta line
                HStack(spacing: 8) {
                    Text(decision.category.displayName)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(IntakeV2Color.accentBright)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: 4)
                                .fill(IntakeV2Color.accent.opacity(0.15))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 4)
                                        .stroke(IntakeV2Color.accent.opacity(0.3), lineWidth: 1)
                                )
                        )
                    Text(decision.metaLine)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.monospaceMuted)
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

import SwiftUI
import AppKit
import Combine
import UserNotifications

enum IntakeV2LocalFolderStatusFormatter {
    static func statusText(for source: IntakeSourceState?) -> String {
        guard let source else {
            return "Connected · local folder"
        }
        if let path = source.path {
            let folderName = URL(fileURLWithPath: path).lastPathComponent
            if !folderName.isEmpty {
                return "Connected · \(folderName)"
            }
        }
        if let detail = source.detail {
            return "Connected · \(detail)"
        }
        return "Connected"
    }
}

// MARK: - Intake V2 Showcase Views — 2026-05-14
// OS-product intro + post-intake setup screens:
//   BootIntro before intake, then ConnectShowcase → ReadyAnalyze after folder pick
// Matches mockup at ~/.gstack/.../onboarding-step2-redesign-20260514/flow-step{1,2,3,4}.html

// MARK: - Brand icon tile (used in BootIntro Read column & ConnectShowcase)

private enum BrandIcon: String, CaseIterable {
    case github, gdocs, gsheets, notion, discord, posthog, txt, toss, stripe, threads, folder

    var bg: Color {
        switch self {
        case .github: return Color(red: 0.051, green: 0.067, blue: 0.090)
        case .gdocs: return .white
        case .gsheets: return .white
        case .notion: return .white
        case .discord: return Color(red: 0.345, green: 0.396, blue: 0.949)
        case .posthog: return .white
        case .txt: return Color(red: 0.322, green: 0.322, blue: 0.357)
        case .toss: return Color(red: 0.000, green: 0.392, blue: 1.000)
        case .stripe: return Color(red: 0.388, green: 0.357, blue: 1.000)
        case .threads: return .black
        case .folder: return Color(red: 0.322, green: 0.322, blue: 0.357)
        }
    }

    var assetName: String? {
        switch self {
        case .github: return "BrandGitHub"
        case .gdocs: return "BrandGoogleDocs"
        case .gsheets: return "BrandGoogleSheets"
        case .notion: return "BrandNotion"
        case .discord: return "BrandDiscord"
        case .posthog: return "BrandPostHog"
        case .toss: return "BrandToss"
        case .stripe: return "BrandStripe"
        case .threads: return "BrandThreads"
        case .txt, .folder: return nil
        }
    }

    var assetScale: CGFloat {
        switch self {
        case .discord: return 0.82
        case .stripe: return 0.68
        case .posthog: return 0.74
        case .notion: return 0.78
        case .gdocs, .gsheets: return 0.82
        default: return 0.64
        }
    }

    var fg: Color {
        switch self {
        case .folder: return Color(red: 0.984, green: 0.749, blue: 0.137)
        default: return .white
        }
    }

    var glyph: String {
        switch self {
        case .txt: return "doc.plaintext.fill"
        case .folder: return "folder.fill"
        default: return ""
        }
    }

    var name: String {
        switch self {
        case .github: return "GitHub"
        case .gdocs: return "Google Docs"
        case .gsheets: return "Google Sheets"
        case .notion: return "Notion"
        case .discord: return "Discord"
        case .posthog: return "PostHog"
        case .txt: return "Interview TXT"
        case .toss: return "Toss"
        case .stripe: return "Stripe"
        case .threads: return "Threads"
        case .folder: return "Local folders"
        }
    }

    var kind: String {
        switch self {
        case .github: return "REPO · CODE"
        case .gdocs: return "CLOUD · DOCS"
        case .gsheets: return "CLOUD · DATA"
        case .notion: return "CLOUD · NOTES"
        case .discord: return "COMM · VOC"
        case .posthog: return "ANALYTICS"
        case .txt: return "FILES · VOC"
        case .toss: return "PAYMENT"
        case .stripe: return "PAYMENT"
        case .threads: return "PUBLIC · VOC"
        case .folder: return "FILES"
        }
    }
}

private struct BrandIconTile: View {
    let icon: BrandIcon
    var size: CGFloat = 44
    var corner: CGFloat = 10

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(icon.bg)
            if let assetName = icon.assetName {
                Image(assetName)
                    .resizable()
                    .scaledToFit()
                    .frame(width: size * icon.assetScale, height: size * icon.assetScale)
            } else {
                Image(systemName: icon.glyph)
                    .font(.system(size: size * 0.46, weight: .bold))
                    .foregroundStyle(icon.fg)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Step 1 — BOOT

@MainActor
struct IntakeV2BootIntroView: View {
    var backDisabled: Bool = false
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    @State private var activeColumn: Int = 0
    @State private var iconSpotlight: Int = 0
    @State private var visibleDecideIndexes: [Int] = [3, 2, 1, 0]
    @State private var decideExpanded: Bool = false
    @State private var decideInteraction: DecideNotificationInteraction = .idle
    @State private var decideActionCursor: Int = 0
    @State private var exitingDecidePreviewItem: DecideNotificationItem?
    @State private var exitingDecidePreviewOffsetX: CGFloat = 0
    @State private var exitingDecidePreviewOpacity: Double = 0
    @State private var decideExitCleanupToken: Int = 0
    @State private var executePulse: Bool = false
    @State private var executeCompletedIndexes: Set<Int> = []
    @State private var executeFocusedIndex: Int?
    @State private var columnTimer: Timer?
    @State private var iconTimer: Timer?
    @State private var executeTimer: Timer?
    @State private var decideSequenceTask: Task<Void, Never>?
    @State private var decideExitCleanupTask: Task<Void, Never>?
    @State private var executeSequenceTask: Task<Void, Never>?

    private let readIcons: [BrandIcon] = [
        .github, .gdocs, .gsheets, .notion, .discord, .posthog, .txt, .toss, .threads
    ]

    private let decideSamples: [String] = [
        "가입자 3명에게 결제 의향 묻기",
        "결제 거절 답변 3건의 공통 이유 정리",
        "어제 수정된 SPEC.md changelog 반영",
        "구독 6개월 사용자 이탈 징후 정리"
    ]

    private let executeCompletionIndexes: [Int] = [0, 1, 2, 3]
    private let columnAdvanceInterval: TimeInterval = 7.4
    private let iconSpotlightInterval: TimeInterval = 0.58
    private let executePulseInterval: TimeInterval = 1.28
    private let decideRestDelayNs: UInt64 = 820_000_000
    private let decideSettleDelayNs: UInt64 = 360_000_000
    private let decideExitCleanupDelayNs: UInt64 = 560_000_000
    private let decideExitOffsetX: CGFloat = -128
    private let executeStepDelayNs: UInt64 = 1_180_000_000
    private let executeSettleDelayNs: UInt64 = 650_000_000

    var body: some View {
        IntakeV2PinnedStepScaffold { isNarrow in
            VStack(alignment: .leading, spacing: isNarrow ? 22 : 28) {
                bootHeader(isNarrow: isNarrow)

                bootCards(isNarrow: isNarrow)
                    .accessibilityElement(children: .contain)
                    .accessibilityIdentifier("intakeV2.boot.cards")
                    .frame(height: isNarrow ? 928 : 396)
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: backDisabled,
                nextTitle: "Continue →",
                nextEnabled: true,
                onBack: onBack,
                onNext: onNext
            )
        }
        .onAppear { startTimers() }
        .onDisappear { stopTimers() }
    }

    private func bootHeader(isNarrow: Bool) -> some View {
        VStack(alignment: .leading, spacing: 22) {
            IntakeV2ProgressReservedSpace()
            VStack(alignment: .leading, spacing: 12) {
                Text("Agentic30 — 1인 개발자를 위한 실행 OS")
                    .font(.system(size: isNarrow ? 30 : 34, weight: .bold, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textPrimary)
                    .lineSpacing(2)
                    .fixedSize(horizontal: false, vertical: true)
                Text("컨텍스트를 읽고 오늘 한 가지를 결정하고 실행을 추적합니다. Read → Decide → Execute 세 동작이 매일 반복됩니다.")
                    .font(.system(size: isNarrow ? 16 : 18, weight: .medium, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textSecondary)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("intakeV2.boot.subtitle")
            }
            .frame(maxWidth: .infinity, minHeight: isNarrow ? 116 : 92, alignment: .topLeading)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("intakeV2.boot.header")
        .frame(maxWidth: .infinity, minHeight: isNarrow ? 210 : 168, alignment: .topLeading)
    }

    @ViewBuilder
    private func bootCards(isNarrow: Bool) -> some View {
        let cardHeight: CGFloat = isNarrow ? 300 : 396

        if isNarrow {
            VStack(alignment: .leading, spacing: 14) {
                bootCardViews(cardHeight: cardHeight)
            }
        } else {
            HStack(alignment: .top, spacing: 14) {
                bootCardViews(cardHeight: cardHeight)
            }
        }
    }

    @ViewBuilder
    private func bootCardViews(cardHeight: CGFloat) -> some View {
        capCard(number: "01", verb: "Read",
                desc: "코드·문서·인터뷰·결제·공개 기록을 컨텍스트로 흡수합니다.",
                active: activeColumn == 0,
                height: cardHeight,
                visualIdentifier: "intakeV2.boot.read.visual") {
            ReadIconGrid(
                icons: readIcons,
                spotlight: iconSpotlight,
                isActive: activeColumn == 0
            )
        }
        capCard(number: "02", verb: "Decide",
                desc: "읽은 신호를 비교해 오늘 가장 급한 한 가지를 고릅니다.",
                active: activeColumn == 1,
                height: cardHeight,
                visualIdentifier: "intakeV2.boot.decide.visual") {
            DecideMiniNotif(
                items: decideNotificationItems,
                expanded: decideExpanded,
                isActive: activeColumn == 1,
                frontInteraction: decideInteraction,
                exitingPreviewItem: exitingDecidePreviewItem,
                exitingPreviewOffsetX: exitingDecidePreviewOffsetX,
                exitingPreviewOpacity: exitingDecidePreviewOpacity,
                onToggleExpanded: toggleDecideExpanded,
                onDismissFront: dismissFrontDecideNotification
            )
        }
        capCard(number: "03", verb: "Execute",
                desc: "당신이 실행. OS는 결과를 기록하고 다음 결정에 반영.",
                active: activeColumn == 2,
                height: cardHeight,
                visualIdentifier: "intakeV2.boot.execute.visual") {
            ExecuteTaskList(
                isActive: activeColumn == 2,
                pulse: executePulse,
                completedIndexes: executeCompletedIndexes,
                focusedIndex: executeFocusedIndex
            )
        }
    }

    @ViewBuilder
    private func capCard<C: View>(
        number: String,
        verb: String,
        desc: String,
        active: Bool,
        height: CGFloat,
        visualIdentifier: String,
        @ViewBuilder visual: () -> C
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(number)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.textTertiary)
                    .tracking(1.2)
                HStack(spacing: 0) {
                    Text(verb)
                        .font(.system(size: 24, weight: .heavy, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textPrimary)
                    Text(".")
                        .font(.system(size: 24, weight: .heavy, design: .rounded))
                        .foregroundStyle(IntakeV2Color.accent)
                }
            }
            .frame(maxWidth: .infinity, minHeight: BootIntroCardMetrics.titleRowHeight, maxHeight: BootIntroCardMetrics.titleRowHeight, alignment: .topLeading)

            Text(desc)
                .font(.system(size: 12.5))
                .foregroundStyle(IntakeV2Color.textTertiary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
                .frame(maxWidth: .infinity, minHeight: BootIntroCardMetrics.descriptionHeight, maxHeight: BootIntroCardMetrics.descriptionHeight, alignment: .topLeading)

            visual()
                .frame(maxWidth: .infinity)
                .frame(maxHeight: .infinity, alignment: .top)
                .padding(.top, BootIntroCardMetrics.visualTopGap)
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier(visualIdentifier)
        }
        .padding(20)
        .frame(maxWidth: .infinity, minHeight: height, maxHeight: height, alignment: .topLeading)
        .background(
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(active ? IntakeV2Color.panelElevated : IntakeV2Color.panel)
                if active {
                    LinearGradient(
                        colors: [.clear, IntakeV2Color.accent, .clear],
                        startPoint: .leading,
                        endPoint: .trailing
                    )
                    .frame(height: 1)
                    .mask(
                        RoundedRectangle(cornerRadius: 14)
                            .frame(height: 2)
                            .offset(y: -1)
                    )
                }
            }
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(active ? IntakeV2Color.accentLine : IntakeV2Color.cardStroke,
                        lineWidth: 1)
        )
        .shadow(color: active ? IntakeV2Color.accent.opacity(0.06) : .clear,
                radius: active ? 18 : 0, y: active ? 8 : 0)
        .animation(.easeInOut(duration: 0.62), value: active)
    }

    private enum BootIntroCardMetrics {
        static let titleRowHeight: CGFloat = 40
        static let descriptionHeight: CGFloat = 34
        static let visualTopGap: CGFloat = 12
    }

    private func startTimers() {
        resetAnimationState(for: activeColumn)
        columnTimer?.invalidate()
        columnTimer = Timer.scheduledTimer(withTimeInterval: columnAdvanceInterval, repeats: true) { _ in
            Task { @MainActor in
                let nextColumn = (activeColumn + 1) % 3
                resetAnimationState(for: nextColumn)
                withAnimation(.easeInOut(duration: 0.72)) {
                    activeColumn = nextColumn
                }
            }
        }
        iconTimer?.invalidate()
        iconTimer = Timer.scheduledTimer(withTimeInterval: iconSpotlightInterval, repeats: true) { _ in
            Task { @MainActor in
                guard activeColumn == 0 else { return }
                withAnimation(.easeInOut(duration: 0.46)) {
                    iconSpotlight = (iconSpotlight + 1) % readIcons.count
                }
            }
        }
        executeTimer?.invalidate()
        executeTimer = Timer.scheduledTimer(withTimeInterval: executePulseInterval, repeats: true) { _ in
            Task { @MainActor in
                guard activeColumn == 2 else {
                    executePulse = false
                    return
                }
                withAnimation(.easeInOut(duration: 0.92)) {
                    executePulse.toggle()
                }
            }
        }
    }

    private func stopTimers() {
        columnTimer?.invalidate(); columnTimer = nil
        iconTimer?.invalidate(); iconTimer = nil
        executeTimer?.invalidate(); executeTimer = nil
        cancelDecideSequence(resetVisuals: true)
        cancelExecuteSequence(resetVisuals: true)
        executePulse = false
    }

    private func resetAnimationState(for column: Int) {
        switch column {
        case 0:
            cancelDecideSequence(resetVisuals: false)
            cancelExecuteSequence(resetVisuals: true)
            iconSpotlight = 0
            executePulse = false
        case 1:
            cancelExecuteSequence(resetVisuals: true)
            executePulse = false
            startDecideSequence()
        case 2:
            cancelDecideSequence(resetVisuals: false)
            startExecuteSequence()
        default:
            cancelDecideSequence(resetVisuals: false)
            cancelExecuteSequence(resetVisuals: true)
            executePulse = false
        }
    }

    private var decideNotificationItems: [DecideNotificationItem] {
        visibleDecideIndexes.enumerated().compactMap { offset, sampleIndex in
            guard decideSamples.indices.contains(sampleIndex) else { return nil }
            let sample = decideSamples[sampleIndex]
            return DecideNotificationItem(
                id: "decide-\(sampleIndex)",
                body: sample,
                timeLabel: timeLabel(forVisibleOffset: offset),
                signalLabel: "결정 후보",
                meta: "신호 스캔"
            )
        }
    }

    private func timeLabel(forVisibleOffset offset: Int) -> String {
        switch offset {
        case 0: return "방금"
        case 1: return "1분 전"
        default: return "\(offset)분 전"
        }
    }

    private func toggleDecideExpanded() {
        guard !visibleDecideIndexes.isEmpty else { return }
        decideExpanded.toggle()
    }

    private func startDecideSequence() {
        cancelDecideSequence(resetVisuals: false)
        ensureMinimumDecideStack()
        decideExpanded = false
        decideInteraction = .idle
        if reduceMotion {
            return
        }
        decideSequenceTask = Task { @MainActor in
            while !Task.isCancelled {
                try? await Task.sleep(nanoseconds: decideRestDelayNs)
                guard !Task.isCancelled else { return }
                advanceDecideNotificationStack()
                try? await Task.sleep(nanoseconds: decideSettleDelayNs)
            }
        }
    }

    private func cancelDecideSequence(resetVisuals: Bool) {
        decideSequenceTask?.cancel()
        decideSequenceTask = nil
        if resetVisuals {
            decideExitCleanupTask?.cancel()
            decideExitCleanupTask = nil
            visibleDecideIndexes = initialDecideIndexes
            decideExpanded = false
            decideInteraction = .idle
            decideActionCursor = 0
            clearExitingDecidePreview()
        }
    }

    private var initialDecideIndexes: [Int] {
        Array(decideSamples.indices.reversed())
    }

    private func ensureMinimumDecideStack() {
        let targetCount = min(4, decideSamples.count)
        guard visibleDecideIndexes.count < targetCount else { return }
        let existing = Set(visibleDecideIndexes)
        let missing = decideSamples.indices.reversed().filter { !existing.contains($0) }
        visibleDecideIndexes.append(contentsOf: missing)
    }

    private func rotateFrontDecideNotification() {
        ensureMinimumDecideStack()
        guard !visibleDecideIndexes.isEmpty else { return }
        let front = visibleDecideIndexes.removeFirst()
        visibleDecideIndexes.append(front)
        ensureMinimumDecideStack()
    }

    private func dismissFrontDecideNotification() {
        runManualDecideInteraction()
    }

    private func runManualDecideInteraction() {
        cancelDecideSequence(resetVisuals: false)
        ensureMinimumDecideStack()
        decideSequenceTask = Task { @MainActor in
            advanceDecideNotificationStack()
            guard !Task.isCancelled else { return }
            if activeColumn == 1 {
                decideSequenceTask = nil
                startDecideSequence()
            }
        }
    }

    private func advanceDecideNotificationStack() {
        ensureMinimumDecideStack()
        guard let exitingItem = decideNotificationItems.first else { return }

        decideExitCleanupTask?.cancel()
        decideExitCleanupToken += 1
        let cleanupToken = decideExitCleanupToken

        if reduceMotion {
            rotateFrontDecideNotification()
            decideInteraction = .idle
            decideActionCursor += 1
            clearExitingDecidePreview()
            return
        }

        var prepareTransaction = Transaction()
        prepareTransaction.disablesAnimations = true
        withTransaction(prepareTransaction) {
            exitingDecidePreviewItem = exitingItem
            exitingDecidePreviewOffsetX = 0
            exitingDecidePreviewOpacity = 1
        }

        withAnimation(.spring(response: 0.52, dampingFraction: 0.86)) {
            rotateFrontDecideNotification()
            decideInteraction = .idle
            decideActionCursor += 1
            exitingDecidePreviewOffsetX = decideExitOffsetX
            exitingDecidePreviewOpacity = 0
        }

        decideExitCleanupTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: decideExitCleanupDelayNs)
            guard !Task.isCancelled, cleanupToken == decideExitCleanupToken else { return }
            clearExitingDecidePreview()
        }
    }

    private func clearExitingDecidePreview() {
        var transaction = Transaction()
        transaction.disablesAnimations = true
        withTransaction(transaction) {
            exitingDecidePreviewItem = nil
            exitingDecidePreviewOffsetX = 0
            exitingDecidePreviewOpacity = 0
        }
    }

    private func startExecuteSequence() {
        cancelExecuteSequence(resetVisuals: false)
        executeCompletedIndexes = []
        executeFocusedIndex = executeCompletionIndexes.first
        executePulse = true
        executeSequenceTask = Task { @MainActor in
            for index in executeCompletionIndexes {
                withAnimation(.easeInOut(duration: 0.46)) {
                    executeFocusedIndex = index
                }
                try? await Task.sleep(nanoseconds: executeStepDelayNs)
                guard !Task.isCancelled else { return }
                withAnimation(.spring(response: 0.58, dampingFraction: 0.86)) {
                    _ = executeCompletedIndexes.insert(index)
                }
            }
            try? await Task.sleep(nanoseconds: executeSettleDelayNs)
            guard !Task.isCancelled else { return }
            withAnimation(.easeInOut(duration: 0.54)) {
                executeFocusedIndex = nil
            }
        }
    }

    private func cancelExecuteSequence(resetVisuals: Bool) {
        executeSequenceTask?.cancel()
        executeSequenceTask = nil
        if resetVisuals {
            executeCompletedIndexes = []
            executeFocusedIndex = nil
        }
    }
}

// MARK: BootIntro — Read column visual

private struct ReadIconGrid: View {
    let icons: [BrandIcon]
    let spotlight: Int
    let isActive: Bool

    var body: some View {
        GeometryReader { proxy in
            let spacing: CGFloat = 10
            let availableGridHeight = proxy.size.height
            let tileByWidth = max((proxy.size.width - (spacing * 2)) / 3, 0)
            let tileByHeight = max((availableGridHeight - (spacing * 2)) / 3, 0)
            let tileSize = min(tileByWidth, tileByHeight)
            let iconSize = min(max(tileSize * 0.42, 24), 44)

            VStack(spacing: spacing) {
                ForEach(0..<3, id: \.self) { row in
                    HStack(spacing: spacing) {
                        ForEach(0..<3, id: \.self) { column in
                            let idx = row * 3 + column
                            let icon = icons[idx]
                            let isSpotlit = isActive && idx == spotlight
                            ZStack {
                                RoundedRectangle(cornerRadius: 12)
                                    .fill(isSpotlit ? IntakeV2Color.accentDim.opacity(0.72) : IntakeV2Color.cardMutedFill)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 12)
                                            .stroke(isSpotlit ? IntakeV2Color.accentLine : IntakeV2Color.cardStroke, lineWidth: 1)
                                    )
                                    .shadow(
                                        color: isSpotlit ? IntakeV2Color.accent.opacity(0.16) : .clear,
                                        radius: isSpotlit ? 10 : 0,
                                        y: isSpotlit ? 4 : 0
                                    )
                                BrandIconTile(icon: icon, size: iconSize, corner: 8)
                                    .brightness(isSpotlit ? 0.08 : 0)
                            }
                            .frame(width: tileSize, height: tileSize)
                            .scaleEffect(isSpotlit ? 1.035 : 1.0)
                            .animation(.easeInOut(duration: 0.48), value: isSpotlit)
                        }
                    }
                }
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

// MARK: BootIntro — Decide column visual

private struct DecideMiniNotif: View {
    let items: [DecideNotificationItem]
    let expanded: Bool
    let isActive: Bool
    let frontInteraction: DecideNotificationInteraction
    let exitingPreviewItem: DecideNotificationItem?
    let exitingPreviewOffsetX: CGFloat
    let exitingPreviewOpacity: Double
    let onToggleExpanded: () -> Void
    let onDismissFront: () -> Void

    var body: some View {
        DecideNotificationGroupView(
            items: items,
            expanded: expanded,
            mode: .stackPreview,
            frontInteraction: frontInteraction,
            exitingPreviewItem: exitingPreviewItem,
            exitingPreviewOffsetX: exitingPreviewOffsetX,
            exitingPreviewOpacity: exitingPreviewOpacity,
            onToggleExpanded: onToggleExpanded,
            onDismissFront: onDismissFront
        )
        .padding(.horizontal, 2)
        .frame(maxWidth: .infinity, minHeight: expanded ? 238 : 164, maxHeight: expanded ? 238 : 164, alignment: .top)
        .clipped()
        .opacity(isActive || !items.isEmpty ? 1 : 0.5)
    }
}

// MARK: BootIntro — Execute column visual

private struct ExecuteTaskList: View {
    private struct Row { let label: String; let meta: String }
    private enum ExecState { case done, focused, pending }
    let isActive: Bool
    let pulse: Bool
    let completedIndexes: Set<Int>
    let focusedIndex: Int?

    private let rows: [Row] = [
        Row(label: "월 · 결제 거절 사유 분석", meta: "2h"),
        Row(label: "화 · SPEC.md changelog 반영", meta: "40m"),
        Row(label: "수 · 인터뷰 요청 3건 발송", meta: "35m"),
        Row(label: "오늘 · 이탈 징후 정리", meta: "55m")
    ]

    var body: some View {
        VStack(spacing: 6) {
            ForEach(Array(rows.enumerated()), id: \.offset) { index, row in
                let state = displayState(for: index)
                let rowPulse = isActive && pulse && state == .focused
                HStack(spacing: 10) {
                    checkBox(state: state, pulse: rowPulse)
                    Text(row.label)
                        .font(.system(size: 11))
                        .foregroundStyle(textColor(state))
                        .strikethrough(state == .done, color: IntakeV2Color.accent.opacity(0.5))
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                        .truncationMode(.tail)
                    Spacer(minLength: 6)
                    Text(row.meta)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.8)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(rowFill(state: state, pulse: rowPulse))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(rowStroke(state: state, pulse: rowPulse), lineWidth: 1)
                        )
                )
                .shadow(
                    color: rowPulse ? IntakeV2Color.accent.opacity(0.12) : .clear,
                    radius: rowPulse ? 12 : 0,
                    y: rowPulse ? 5 : 0
                )
                .animation(.easeInOut(duration: 0.92), value: rowPulse)
            }
        }
    }

    private func displayState(for index: Int) -> ExecState {
        if completedIndexes.contains(index) {
            return .done
        }
        if focusedIndex == index {
            return .focused
        }
        return .pending
    }

    private func textColor(_ s: ExecState) -> Color {
        switch s {
        case .done: return IntakeV2Color.textTertiary
        case .focused: return IntakeV2Color.textPrimary
        case .pending: return IntakeV2Color.textTertiary
        }
    }

    private func rowFill(state: ExecState, pulse: Bool) -> Color {
        switch state {
        case .focused:
            return IntakeV2Color.accent.opacity(pulse ? 0.13 : 0.08)
        case .done, .pending:
            return IntakeV2Color.cardMutedFill
        }
    }

    private func rowStroke(state: ExecState, pulse: Bool) -> Color {
        switch state {
        case .focused:
            return IntakeV2Color.accent.opacity(pulse ? 0.52 : 0.3)
        case .done, .pending:
            return IntakeV2Color.cardStroke
        }
    }

    @ViewBuilder
    private func checkBox(state: ExecState, pulse: Bool) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(state == .done ? IntakeV2Color.accent : (pulse ? IntakeV2Color.accent.opacity(0.12) : .clear))
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(state == .done ? IntakeV2Color.accent : (state == .focused ? IntakeV2Color.accent.opacity(pulse ? 0.9 : 1.0) : IntakeV2Color.selectionDotEmpty),
                            lineWidth: 1.5)
            )
            .overlay {
                if state == .done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(IntakeV2Color.primaryButtonFill)
                }
            }
            .frame(width: 16, height: 16)
            .scaleEffect(pulse ? 1.12 : 1.0)
            .animation(.easeInOut(duration: 0.92), value: pulse)
    }
}

// MARK: - Step 6 — CONNECT

@MainActor
struct IntakeV2ConnectShowcaseView: View {
    @ObservedObject var sources: IntakeV2SourceManager
    let onBack: () -> Void
    let onNext: () -> Void
    var progressNamespace: Namespace.ID? = nil

    @State private var selection: Set<IntakeSourceID> = []
    @State private var errorTiles: Set<IntakeSourceID> = []
    @State private var showingAddSourceModal = false

    private let allSources = IntakeSourceCatalog.mainGridIDs

    private var addedCatalogSources: [SourceCatalogItem] {
        sources.sources.compactMap { source in
            guard !IntakeSourceCatalog.builtInMainGridIDs.contains(source.id) else { return nil }
            return IntakeSourceCatalog.item(for: source.id)
        }
    }

    var body: some View {
        IntakeV2PinnedStepScaffold { isNarrow in
            VStack(alignment: .leading, spacing: 22) {
                IntakeV2ProgressReservedSpace()
                IntakeV2Header(
                    title: "읽을 기록 더 연결하기",
                    subtitle: "지금은 연결할 기록을 표시만 합니다. 실제 인증과 권한 연결은 나중에 Settings에서 직접 완료합니다."
                )

                let columnCount = isNarrow ? 3 : 5
                let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: columnCount)
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(allSources, id: \.self) { src in
                        sourceCard(src)
                    }
                    ForEach(addedCatalogSources) { item in
                        catalogSourceCard(item)
                    }
                    addCustomCard()
                }
                .frame(maxWidth: 920)
                .frame(maxWidth: .infinity, alignment: .center)

                HStack {
                    HStack(spacing: 6) {
                        Circle().fill(IntakeV2Color.accent).frame(width: 5, height: 5)
                        Text("\(connectedSelectionCount) connected")
                            .foregroundStyle(IntakeV2Color.textTertiary)
                        if requestedSelectionCount > 0 {
                            Text("·").foregroundStyle(IntakeV2Color.borderSoft)
                            Circle().fill(IntakeV2Color.warning).frame(width: 5, height: 5)
                            Text("\(requestedSelectionCount) requested")
                                .foregroundStyle(IntakeV2Color.textTertiary)
                        }
                        if !errorTiles.isEmpty {
                            Text("·").foregroundStyle(IntakeV2Color.borderSoft)
                            Circle().fill(IntakeV2Color.warning).frame(width: 5, height: 5)
                            Text("\(errorTiles.count) needs review")
                                .foregroundStyle(IntakeV2Color.textTertiary)
                        }
                    }
                    .font(.system(size: 11, design: .monospaced))
                    Spacer()
                }
                .frame(maxWidth: 920)
                .frame(maxWidth: .infinity, alignment: .center)
            }
        } footer: { _ in
            IntakeV2Footer(
                backDisabled: false,
                nextTitle: selection.isEmpty ? "Skip →" : "Continue →",
                nextEnabled: true,
                onBack: onBack,
                onNext: {
                    // Persist non-folder sources as disabled placeholders so post-onboarding
                    // banner shows accurate "additional sources" affordance.
                    commitSelectionToManager()
                    onNext()
                }
            )
        }
        .onAppear { syncSelectionWithRegisteredSources() }
        .sheet(isPresented: $showingAddSourceModal) {
            IntakeV2AddSourceModal(
                sources: sources,
                isPresented: $showingAddSourceModal
            )
        }
    }

    private var connectedSelectionCount: Int {
        selection.filter { sourceConnectionState(for: $0) == .connected }.count
    }

    private var requestedSelectionCount: Int {
        let requestedBuiltIns = Set(selection.filter { sourceConnectionState(for: $0) == .requested })
        let persistedRequested = Set(sources.sources.filter { $0.status == .disabled }.map(\.id))
        return requestedBuiltIns.union(persistedRequested).count
    }

    @ViewBuilder
    private func sourceCard(_ src: IntakeSourceID) -> some View {
        if let item = IntakeSourceCatalog.item(for: src) {
            sourceCard(item)
        }
    }

    @ViewBuilder
    private func sourceCard(_ item: SourceCatalogItem) -> some View {
        let src = item.id
        let isOn = selection.contains(src)
        let isError = errorTiles.contains(src)
        let connectionState = sourceConnectionState(for: src)
        Button(action: { toggle(src) }) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    IntakeSourceIconTile(id: item.id, fallbackSystemImage: item.systemImage, size: 44, corner: 10)
                    Spacer()
                    togglePill(on: isOn)
                }
                VStack(alignment: .leading, spacing: 2) {
                        Text(item.id.displayName)
                            .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(IntakeV2Color.textPrimary)
                        .lineLimit(2)
                        .minimumScaleFactor(0.82)
                    Text(item.kind)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                        .tracking(0.6)
                        .lineLimit(2)
                        .minimumScaleFactor(0.78)
                }
                Spacer(minLength: 4)
                HStack(spacing: 5) {
                    Circle()
                        .fill(statusColor(isError: isError, state: connectionState))
                        .frame(width: 6, height: 6)
                        .shadow(color: connectionState == .connected ? IntakeV2Color.accent.opacity(0.6) : .clear, radius: 6)
                    Text(statusText(src, isOn: isOn, isError: isError, state: connectionState))
                        .font(.system(size: 11))
                        .foregroundStyle(statusTextColor(isError: isError, state: connectionState))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                }
            }
            .padding(16)
            .frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 14)
                    .fill(isOn ? IntakeV2Color.accent.opacity(0.06) : IntakeV2Color.panel)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .stroke(isOn ? statusStrokeColor(for: connectionState) : IntakeV2Color.cardStroke,
                            lineWidth: isOn ? 1.5 : 1)
            )
            .shadow(color: isOn ? IntakeV2Color.accent.opacity(0.08) : .clear, radius: 12)
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("intakeV2.source.\(src.rawValue)")
    }

    @ViewBuilder
    private func addCustomCard() -> some View {
        Button(action: { showingAddSourceModal = true }) {
            VStack(spacing: 10) {
                ZStack {
                    RoundedRectangle(cornerRadius: 10)
                        .fill(IntakeV2Color.cardMutedFill)
                    Image(systemName: "plus")
                        .font(.system(size: 16, weight: .semibold))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                }
                .frame(width: 44, height: 44)
                Text("Add source")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(IntakeV2Color.textSecondary)
            }
            .frame(maxWidth: .infinity, minHeight: 140)
            .contentShape(RoundedRectangle(cornerRadius: 14))
            .overlay(
                RoundedRectangle(cornerRadius: 14)
                    .strokeBorder(IntakeV2Color.borderSoft, style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
            )
        }
        .buttonStyle(.plain)
        .accessibilityLabel("Add source")
        .accessibilityIdentifier("intakeV2.addSource")
    }

    @ViewBuilder
    private func catalogSourceCard(_ item: SourceCatalogItem) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top) {
                IntakeSourceIconTile(id: item.id, fallbackSystemImage: item.systemImage, size: 44, corner: 10)
                Spacer()
                Image(systemName: "checkmark")
                    .font(.system(size: 12, weight: .bold))
                    .foregroundStyle(IntakeV2Color.warning)
                    .frame(width: 32, height: 20)
            }
            VStack(alignment: .leading, spacing: 2) {
                Text(item.id.displayName)
                        .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(IntakeV2Color.textPrimary)
                    .lineLimit(2)
                Text(item.kind)
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.textTertiary)
                    .tracking(0.6)
            }
            Spacer(minLength: 4)
            HStack(spacing: 5) {
                Circle()
                    .fill(IntakeV2Color.warning)
                    .frame(width: 6, height: 6)
                Text("Connect later · Settings")
                    .font(.system(size: 11))
                    .foregroundStyle(IntakeV2Color.warning)
            }
        }
        .padding(16)
        .frame(maxWidth: .infinity, minHeight: 140, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 14)
                .fill(IntakeV2Color.accent.opacity(0.06))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .stroke(IntakeV2Color.warning.opacity(0.75), lineWidth: 1.5)
        )
    }

    @ViewBuilder
    private func togglePill(on: Bool) -> some View {
        ZStack(alignment: on ? .trailing : .leading) {
            Capsule()
                .fill(on ? IntakeV2Color.accent : IntakeV2Color.borderSoft)
                .frame(width: 32, height: 20)
            Circle()
                .fill(IntakeV2Color.panel)
                .frame(width: 16, height: 16)
                .shadow(color: IntakeV2Color.cardShadow, radius: 1, y: 1)
                .padding(.horizontal, 2)
        }
        .animation(.easeInOut(duration: 0.18), value: on)
    }

    private enum SourceConnectionState {
        case disconnected
        case requested
        case connected
    }

    private func statusText(_ src: IntakeSourceID, isOn: Bool, isError: Bool, state: SourceConnectionState) -> String {
        if isError { return "folder empty" }
        if !isOn { return "Not connected" }
        switch state {
        case .connected:
            return localFolderStatusText()
        case .requested:
            return "Connected later"
        case .disconnected:
            return "Not connected"
        }
    }

    private func sourceConnectionState(for src: IntakeSourceID) -> SourceConnectionState {
        guard selection.contains(src) else { return .disconnected }
        if src == .localFolder, sources.status(of: .localFolder) == .connected {
            return .connected
        }
        return .requested
    }

    private func statusColor(isError: Bool, state: SourceConnectionState) -> Color {
        if isError { return IntakeV2Color.warning }
        switch state {
        case .connected: return IntakeV2Color.accent
        case .requested: return IntakeV2Color.warning
        case .disconnected: return IntakeV2Color.borderSoft
        }
    }

    private func statusTextColor(isError: Bool, state: SourceConnectionState) -> Color {
        if isError { return IntakeV2Color.warning }
        switch state {
        case .connected: return IntakeV2Color.accentBright
        case .requested: return IntakeV2Color.warning
        case .disconnected: return IntakeV2Color.textTertiary
        }
    }

    private func statusStrokeColor(for state: SourceConnectionState) -> Color {
        switch state {
        case .connected: return IntakeV2Color.accent
        case .requested: return IntakeV2Color.warning.opacity(0.75)
        case .disconnected: return IntakeV2Color.cardStroke
        }
    }

    private func toggle(_ src: IntakeSourceID) {
        if errorTiles.contains(src) { errorTiles.remove(src) }
        if selection.contains(src) { selection.remove(src) } else { selection.insert(src) }
    }

    private func commitSelectionToManager() {
        if !selection.contains(.localFolder) {
            sources.remove(.localFolder)
        }
        for id in IntakeSourceCatalog.mainGridIDs where id != .localFolder {
            if selection.contains(id) {
                sources.toggle(id, to: .disabled) // marked as "user wanted but not yet connected"
            } else {
                sources.remove(id)
            }
        }
    }

    private func syncSelectionWithRegisteredSources() {
        selection = Set(IntakeSourceCatalog.mainGridIDs.filter { sources.status(of: $0) != .notConnected })
        errorTiles = []
    }

    private func localFolderStatusText() -> String {
        IntakeV2LocalFolderStatusFormatter.statusText(
            for: sources.sources.first(where: { $0.id == .localFolder })
        )
    }
}

// MARK: - Add Source Modal

@MainActor
private struct IntakeV2AddSourceModal: View {
    @ObservedObject var sources: IntakeV2SourceManager
    @Binding var isPresented: Bool

    @State private var query = ""
    @State private var selectedCategory: IntakeSourceCatalogCategory = .core
    @State private var selectedIDs: Set<IntakeSourceID> = []
    @State private var saveError: String?
    @FocusState private var isSearchFocused: Bool

    private var unavailableSourceIDs: Set<IntakeSourceID> {
        IntakeSourceCatalog.builtInMainGridIDs.union(sources.sources.map(\.id))
    }

    private var availableCatalogItems: [SourceCatalogItem] {
        IntakeSourceCatalog.addableItems.filter { !unavailableSourceIDs.contains($0.id) }
    }

    private var filteredItems: [SourceCatalogItem] {
        let trimmedQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        return availableCatalogItems.filter { item in
            guard !trimmedQuery.isEmpty else {
                return item.category == selectedCategory
            }
            let haystack = [
                item.id.displayName,
                item.kind,
                item.why,
                item.category.rawValue,
            ]
            .joined(separator: " ")
            .localizedCaseInsensitiveContains(trimmedQuery)
            return haystack
        }
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 18) {
            header
            controls
            content
            footer
        }
        .padding(24)
        .frame(width: 760, height: 620, alignment: .topLeading)
        .background(IntakeV2Color.bg)
        .onAppear { isSearchFocused = true }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("intakeV2.addSource.modal")
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(alignment: .firstTextBaseline) {
                Text("기록 소스 추가")
                    .font(.system(size: 24, weight: .bold, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textPrimary)
                Spacer()
                Button(action: { isPresented = false }) {
                    Image(systemName: "xmark")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(IntakeV2Color.textSecondary)
                        .frame(width: 30, height: 30)
                        .background(Circle().fill(IntakeV2Color.secondaryButtonFill))
                }
                .buttonStyle(.plain)
                .accessibilityLabel("Close")
            }
            Text("Agentic30가 내일의 결정을 더 잘 만들 수 있게, 이미 남기고 있는 기록 위치를 표시하세요. 연결은 Settings에서 완료합니다.")
                .font(.system(size: 14, weight: .medium, design: .rounded))
                .foregroundStyle(IntakeV2Color.textSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var controls: some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(spacing: 9) {
                Image(systemName: "magnifyingglass")
                    .foregroundStyle(IntakeV2Color.textTertiary)
                TextField("소스 검색", text: $query)
                    .textFieldStyle(.plain)
                    .font(.system(size: 14, weight: .medium, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textPrimary)
                    .focused($isSearchFocused)
                    .onSubmit(selectTopFilteredItem)
                    .accessibilityIdentifier("intakeV2.addSource.search")
            }
            .padding(.horizontal, 12)
            .frame(height: 38)
            .background(
                RoundedRectangle(cornerRadius: 9)
                    .fill(IntakeV2Color.panel)
                    .overlay(
                        RoundedRectangle(cornerRadius: 9)
                            .stroke(IntakeV2Color.cardStroke, lineWidth: 1)
                    )
            )

            ScrollView(.horizontal) {
                HStack(spacing: 8) {
                    ForEach(IntakeSourceCatalogCategory.allCases, id: \.self) { category in
                        categoryButton(category)
                    }
                }
                .padding(.vertical, 1)
            }
            .scrollIndicators(.hidden)
        }
    }

    @ViewBuilder
    private var content: some View {
        if filteredItems.isEmpty {
            emptyState
        } else {
            ScrollView {
                LazyVStack(spacing: 8) {
                    ForEach(filteredItems) { item in
                        catalogRow(item)
                    }
                }
                .padding(.vertical, 2)
            }
            .scrollIndicators(.hidden)
            .frame(maxWidth: .infinity, minHeight: 230, maxHeight: 250)
        }
    }

    private var emptyState: some View {
        VStack(spacing: 12) {
            ZStack {
                Circle()
                    .fill(IntakeV2Color.cardMutedFill)
                Image(systemName: "tray")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(IntakeV2Color.textTertiary)
            }
            .frame(width: 54, height: 54)
            Text("결과 없음")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(IntakeV2Color.textPrimary)
            Text("찾는 소스가 아직 catalog에 없다면 Custom source로 표시해두세요.")
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(IntakeV2Color.textSecondary)
            Button(action: selectCustomSource) {
                Text("Custom source로 추가")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(IntakeV2Color.primaryButtonText)
                    .padding(.horizontal, 14)
                    .padding(.vertical, 9)
                    .background(Capsule().fill(IntakeV2Color.primaryButtonFill))
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("intakeV2.addSource.customFromEmpty")
        }
        .frame(maxWidth: .infinity, minHeight: 230, maxHeight: 250)
    }

    private var footer: some View {
        VStack(alignment: .leading, spacing: 10) {
            if let saveError {
                HStack(spacing: 8) {
                    Circle()
                        .fill(IntakeV2Color.warning)
                        .frame(width: 6, height: 6)
                    Text(saveError)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.warning)
                }
            }

            HStack(spacing: 12) {
                Text("선택한 소스는 Connect later 상태로 저장됩니다.")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.monospaceMuted)
                Spacer()
                Button("Cancel") {
                    isPresented = false
                }
                .buttonStyle(.plain)
                .font(.system(size: 14, weight: .semibold, design: .rounded))
                .foregroundStyle(IntakeV2Color.textSecondary)
                .padding(.horizontal, 16)
                .frame(height: 36)
                .background(Capsule().fill(IntakeV2Color.secondaryButtonFill))

                Button(action: addSelectedSources) {
                    Text("Add selected")
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(selectedIDs.isEmpty ? IntakeV2Color.disabledButtonText : IntakeV2Color.primaryButtonText)
                        .padding(.horizontal, 18)
                        .frame(height: 36)
                        .background(Capsule().fill(selectedIDs.isEmpty ? IntakeV2Color.disabledButtonFill : IntakeV2Color.primaryButtonFill))
                }
                .accessibilityIdentifier("intakeV2.addSource.addSelected")
                .accessibilityLabel("Add selected")
                .keyboardShortcut(.defaultAction)
                .buttonStyle(.plain)
                .disabled(selectedIDs.isEmpty)
            }
        }
    }

    @ViewBuilder
    private func categoryButton(_ category: IntakeSourceCatalogCategory) -> some View {
        let isSelected = selectedCategory == category
        Button(action: { selectedCategory = category }) {
            Text(category.rawValue)
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(isSelected ? IntakeV2Color.primaryButtonText : IntakeV2Color.textSecondary)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(
                    Capsule()
                        .fill(isSelected ? IntakeV2Color.primaryButtonFill : IntakeV2Color.secondaryButtonFill)
                )
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func catalogRow(_ item: SourceCatalogItem) -> some View {
        let state = rowState(for: item)
        Button(action: { toggle(item) }) {
            HStack(spacing: 12) {
                IntakeSourceIconTile(id: item.id, fallbackSystemImage: item.systemImage)
                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(item.id.displayName)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(IntakeV2Color.textPrimary)
                            .lineLimit(1)
                        Text(item.kind)
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .foregroundStyle(IntakeV2Color.textTertiary)
                            .tracking(0.6)
                            .lineLimit(1)
                    }
                    Text(item.why)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textSecondary)
                        .lineLimit(2)
                }
                Spacer(minLength: 10)
                rowBadge(state)
            }
            .padding(12)
            .frame(maxWidth: .infinity, minHeight: 64, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 10)
                    .fill(state == .selected ? IntakeV2Color.accentDim.opacity(0.70) : IntakeV2Color.panel)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 10)
                    .stroke(rowStroke(for: state), lineWidth: state == .selected ? 1.5 : 1)
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(item.id.displayName)
        .accessibilityIdentifier("intakeV2.addSource.row.\(item.id.rawValue)")
    }

    @ViewBuilder
    private func rowBadge(_ state: AddSourceRowState) -> some View {
        switch state {
        case .selected:
            HStack(spacing: 6) {
                Image(systemName: "checkmark")
                    .font(.system(size: 11, weight: .bold))
                Text("Requested")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
            }
            .foregroundStyle(IntakeV2Color.accentBright)
        case .available:
            Image(systemName: "plus")
                .font(.system(size: 13, weight: .bold))
                .foregroundStyle(IntakeV2Color.textTertiary)
                .frame(width: 24, height: 24)
        }
    }

    private func rowStroke(for state: AddSourceRowState) -> Color {
        switch state {
        case .selected: return IntakeV2Color.warning.opacity(0.75)
        case .available: return IntakeV2Color.cardStroke
        }
    }

    private func rowState(for item: SourceCatalogItem) -> AddSourceRowState {
        if selectedIDs.contains(item.id) { return .selected }
        return .available
    }

    private func toggle(_ item: SourceCatalogItem) {
        saveError = nil
        if selectedIDs.contains(item.id) {
            selectedIDs.remove(item.id)
        } else {
            selectedIDs.insert(item.id)
        }
    }

    private func selectCustomSource() {
        selectedCategory = .custom
        query = ""
        guard let customURL = IntakeSourceCatalog.item(for: .customUrl),
              availableCatalogItems.contains(customURL) else { return }
        selectedIDs.insert(.customUrl)
    }

    private func selectTopFilteredItem() {
        guard let item = filteredItems.first else { return }
        toggle(item)
    }

    private func addSelectedSources() {
        guard !selectedIDs.isEmpty else { return }
        if sources.addCatalogSources(selectedIDs) {
            isPresented = false
        } else {
            saveError = "선택을 저장하지 못했습니다. 다시 시도하세요."
        }
    }
}

private enum AddSourceRowState {
    case available
    case selected
}

private struct IntakeSourceIconTile: View {
    let id: IntakeSourceID
    let fallbackSystemImage: String
    var size: CGFloat = 38
    var corner: CGFloat = 9

    private var iconKind: IntakeSourceIconKind {
        IntakeSourceIconCatalog.iconKind(for: id, fallbackSystemImage: fallbackSystemImage)
    }

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(tileBackground)
            iconContent
        }
        .frame(width: size, height: size)
        .accessibilityHidden(true)
    }

    @ViewBuilder
    private var iconContent: some View {
        switch iconKind {
        case .asset(let assetName):
            Image(assetName)
                .resizable()
                .scaledToFit()
                .frame(width: size * assetScale(for: assetName), height: size * assetScale(for: assetName))
                .clipShape(RoundedRectangle(cornerRadius: corner, style: .continuous))
        case .composite(let assetNames):
            compositeIcon(assetNames)
        case .symbol(let systemImage):
            Image(systemName: systemImage)
                .font(.system(size: size * 0.45, weight: .semibold))
                .foregroundStyle(.white.opacity(0.86))
        }
    }

    @ViewBuilder
    private func compositeIcon(_ assetNames: [String]) -> some View {
        let badgeSize = size * (assetNames.count > 2 ? 0.42 : 0.48)
        HStack(spacing: -size * 0.08) {
            ForEach(assetNames, id: \.self) { assetName in
                ZStack {
                    Circle()
                        .fill(assetBackground(for: assetName))
                    Image(assetName)
                        .resizable()
                        .scaledToFit()
                        .frame(width: badgeSize * assetScale(for: assetName, inComposite: true),
                               height: badgeSize * assetScale(for: assetName, inComposite: true))
                }
                .frame(width: badgeSize, height: badgeSize)
                .overlay(Circle().stroke(Color.black.opacity(0.08), lineWidth: 0.5))
            }
        }
    }

    private var tileBackground: Color {
        switch iconKind {
        case .asset(let assetName):
            return assetBackground(for: assetName)
        case .composite:
            return Color(red: 0.322, green: 0.322, blue: 0.357)
        case .symbol:
            return Color(red: 0.322, green: 0.322, blue: 0.357)
        }
    }

    private func assetBackground(for assetName: String) -> Color {
        switch assetName {
        case "BrandGitHub":
            return Color(red: 0.051, green: 0.067, blue: 0.090)
        case "BrandNotion":
            // Notion ships as a light (near-white) mark for dark surfaces, so it needs
            // a dark tile here instead of the default white plate (else white-on-white).
            return Color(red: 0.098, green: 0.098, blue: 0.098)
        case "BrandPostHog":
            // PostHog's hedgehog uses a light head on dark surfaces; keep a dark tile so
            // the head stays visible (the colored quills read on either background).
            return Color(red: 0.102, green: 0.102, blue: 0.122)
        case "BrandDiscord":
            return Color(red: 0.345, green: 0.396, blue: 0.949)
        case "BrandToss":
            return Color(red: 0.000, green: 0.392, blue: 1.000)
        case "BrandStripe":
            return Color(red: 0.388, green: 0.357, blue: 1.000)
        case "BrandCursor":
            return Color(red: 0.051, green: 0.051, blue: 0.055)
        case "BrandClaude":
            return Color(red: 0.871, green: 0.792, blue: 0.671)
        case "BrandAWS":
            return Color(red: 0.091, green: 0.137, blue: 0.190)
        case "BrandAppleNotes":
            return Color(red: 0.322, green: 0.322, blue: 0.357)
        case "BrandInstagram":
            return Color(red: 0.051, green: 0.051, blue: 0.055)
        case "BrandThreads", "BrandPaddle":
            return .black
        default:
            return .white
        }
    }

    private func assetScale(for assetName: String, inComposite: Bool = false) -> CGFloat {
        switch assetName {
        case "BrandGitHub",
             "BrandFigma",
             "BrandCursor",
             "BrandClaude",
             "BrandDiscord",
             "BrandToss",
             "BrandStripe",
             "BrandThreads",
             "BrandX",
             "BrandInstagram",
             "BrandAWS",
             "BrandGoogleDocs",
             "BrandGoogleSheets",
             "BrandNotion",
             "BrandAppleNotes":
            return inComposite ? 0.82 : 1.0
        case "BrandPostHog":
            return inComposite ? 0.78 : 0.86
        case "BrandOpenAI":
            return inComposite ? 0.70 : 0.74
        case "BrandGmail", "BrandGoogleCalendar", "BrandGoogleForms":
            return inComposite ? 0.76 : 0.82
        case "BrandPaddle":
            return inComposite ? 0.92 : 0.88
        case "BrandAppStoreConnect", "BrandGooglePlay", "BrandLemonSqueezy", "BrandGumroad":
            return inComposite ? 0.86 : 0.82
        default:
            return inComposite ? 0.78 : 0.76
        }
    }
}

// MARK: - Step 8 — READY

@MainActor
struct IntakeV2ReadyAnalyzeView: View {
    @ObservedObject var store: IntakeV2Store
    @ObservedObject var sources: IntakeV2SourceManager
    let bootLogState: IntakeV2BootLogState
    let workspaceScanResult: AgenticViewModel.WorkspaceScanResult?
    let onBack: () -> Void
    let onDone: () -> Void
    var progressNamespace: Namespace.ID? = nil
    /// Usage-limit notice from the scan provider (quota hit → questions were
    /// built from local signals only). Switching providers is explicit: the
    /// banner button calls `onProviderLimitRescan` with `providerLimitFallback`.
    var providerLimitNotice: ScanProviderLimitNotice? = nil
    var providerLimitFallback: AgentProvider? = nil
    var onProviderLimitRescan: ((AgentProvider) -> Void)? = nil
    var scanBlockedNotice: WorkspaceScanBlockedNotice? = nil
    var onScanBlockedRescan: ((AgentProvider) -> Void)? = nil
    var onScanBlockedAuthAction: ((WorkspaceScanProviderReadiness) -> Void)? = nil
    var agentic30GitignoreConsent: Agentic30GitignoreState? = nil
    var onAgentic30GitignoreConsent: ((Bool) -> Void)? = nil

    @State private var decision: IntakeV2Decision?
    @State private var revealCard: Bool = false
    @State private var showTodoWindow: Bool = false
    @State private var generatedTodoTasks: [GeneratedTodoTask] = []
    @State private var todoGenerationComplete: Bool = false
    @State private var showExecuteNudge: Bool = false
    @State private var firstDecisionExpanded: Bool = true
    @State private var todoGenerationTask: Task<Void, Never>?
    @State private var didTrackScanWaitViewed: Bool = false
    @State private var didTrackMergeCompleted: Bool = false
    @State private var showBootLogDetails: Bool = false
    @State private var showsAgentic30GitignoreConsent = false
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @AccessibilityFocusState private var primaryCTAFocused: Bool

    private enum InboxCTAState: Equatable {
        case preparingDecision
        case needsExecute
        case preparingInbox
        case ready
    }

    private var inboxCTAState: InboxCTAState {
        analysisReady ? .ready : .preparingInbox
    }

    private var analysisReady: Bool {
        store.folderURL == nil || workspaceScanResult != nil || bootLogState.scanDidFail
    }

    var body: some View {
        TimelineView(.periodic(from: Date(), by: 1)) { context in
            content(at: context.date)
                .onAppear {
                    trackScanWaitViewedIfNeeded()
                    trackPresentationMilestonesIfNeeded(scanWaitPresentation(at: context.date))
                }
                .onChange(of: scanWaitPresentation(at: context.date).state) { _, _ in
                    trackPresentationMilestonesIfNeeded(scanWaitPresentation(at: context.date))
                }
        }
        .onAppear {
            synchronizeDecisionWithBootState()
        }
        .onChange(of: bootLogState) { _, _ in
            synchronizeDecisionWithBootState()
            trackPresentationMilestonesIfNeeded(scanWaitPresentation(at: Date()))
        }
        .onChange(of: workspaceScanResult) { _, _ in
            synchronizeDecisionWithBootState()
            trackPresentationMilestonesIfNeeded(scanWaitPresentation(at: Date()))
        }
        .onDisappear {
            todoGenerationTask?.cancel()
            todoGenerationTask = nil
        }
        .alert(
            "Agentic30 로컬 메모리를 Git에서 제외할까요?",
            isPresented: $showsAgentic30GitignoreConsent
        ) {
            Button("동의하고 시작") {
                onAgentic30GitignoreConsent?(true)
                openDay1()
            }
            Button("수정하지 않고 시작") {
                onAgentic30GitignoreConsent?(false)
                openDay1()
            }
            Button("돌아가기", role: .cancel) {}
        } message: {
            Text(".agentic30/에는 온보딩 메모리와 Day 진행 상태가 저장됩니다. 프로젝트와 고객 맥락이 포함될 수 있어 GitHub에 올라가지 않도록 .gitignore에 .agentic30/ 한 줄을 추가하려고 합니다.")
        }
    }

    @ViewBuilder
    private func content(at now: Date) -> some View {
        let presentation = scanWaitPresentation(at: now)

        IntakeV2PinnedStepScaffold { _ in
            VStack(alignment: .leading, spacing: 18) {
                IntakeV2ProgressReservedSpace()

                VStack(alignment: .leading, spacing: 18) {
                    IntakeV2Header(
                        title: readyTitle(for: presentation),
                        subtitle: readySubtitle(for: presentation)
                    )

                    if presentation.canOpenDay1 {
                        day1ReadySummaryCard(presentation)
                            .transition(readySummaryTransition)

                        if scanBlockedNotice != nil {
                            scanBlockedNoticeBanner
                                .transition(.opacity)
                        }

                        if store.folderURL != nil {
                            completedBootLogDetails
                                .transition(.opacity)
                        }
                    } else {
                        scanPreviewCard(presentation)
                            .transition(.opacity)

                        if presentation.isBlocked {
                            scanBlockedNoticeBanner
                                .transition(.opacity)
                        } else if presentation.showsSlowCopy {
                            slowScanNotice
                                .transition(.opacity)
                        }

                        terminalBox
                    }
                }
                .frame(maxWidth: 880, alignment: .leading)
                .frame(maxWidth: .infinity, alignment: .center)
                .animation(reduceMotion ? nil : .easeInOut(duration: 0.42), value: presentation.canOpenDay1)
            }
        } footer: { isNarrow in
            scanWaitFooter(presentation, isNarrow: isNarrow)
        }
    }

    private func scanWaitPresentation(at now: Date) -> Day1ScanWaitPresentation {
        Day1ScanWaitPresentation(
            bootLogState: bootLogState,
            hasFolder: store.folderURL != nil,
            hasWorkspaceScanResult: workspaceScanResult != nil,
            now: now
        )
    }

    private func readyTitle(for presentation: Day1ScanWaitPresentation) -> String {
        presentation.headerTitle(questionCount: questionCount)
    }

    private func readySubtitle(for presentation: Day1ScanWaitPresentation) -> String {
        if presentation.canOpenDay1 {
            return "약 3분 · 선택하고 한 줄만 답하면 됩니다."
        }
        if store.folderURL == nil {
            return "폴더 없이 시작합니다. 앞서 답한 내용만으로 질문을 준비합니다."
        }
        if presentation.state == .connecting {
            return "실행 보조 앱이 연결되면 폴더 신호를 읽습니다."
        }
        if presentation.isBlocked {
            return "Day 1 질문을 만들지 못했습니다. 위 원인을 확인한 뒤 다시 시도하세요."
        }
        return "완료되면 바로 질문을 시작할 수 있습니다."
    }

    private var questionCount: Int {
        if workspaceScanResult?.day1AlignmentPlan != nil {
            return 3
        }
        if let legacyCount = workspaceScanResult?.day1IcpPlan?.questions.count, legacyCount > 0 {
            return legacyCount
        }
        return 3
    }

    private var readySignalCount: Int? {
        bootLogState.scanPhase.foundCount ?? workspaceScanResult?.foundArtifactCount
    }

    private var previewSlots: [(title: String, body: String, systemImage: String)] {
        [
            ("고객 후보", "누구를 먼저 확인할지 좁힙니다.", "person.2.fill"),
            ("문제 신호", "폴더에서 반복되는 pain을 찾습니다.", "waveform.path.ecg"),
            ("확인할 행동", "오늘 검증할 실제 행동을 고릅니다.", "checkmark.seal.fill"),
        ]
    }

    private func scanPreviewCard(_ presentation: Day1ScanWaitPresentation) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .firstTextBaseline, spacing: 12) {
                VStack(alignment: .leading, spacing: 5) {
                    Text(scanPreviewTitle(for: presentation))
                        .font(.system(size: 14, weight: .bold, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textPrimary)
                    Text(scanPreviewSubtitle(for: presentation))
                        .font(.system(size: 12.5, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                }

                Spacer(minLength: 12)

                Text(presentation.phase.label)
                    .font(.system(size: 14, weight: .heavy, design: .monospaced))
                    .monospacedDigit()
                    .foregroundStyle(IntakeV2Color.accentBright)
                    .padding(.horizontal, 12)
                    .padding(.vertical, 6)
                    .background(
                        Capsule()
                            .fill(IntakeV2Color.accent.opacity(0.12))
                            .overlay(Capsule().stroke(IntakeV2Color.accent.opacity(0.28), lineWidth: 1))
                    )
                    .accessibilityLabel(Text("scan phase \(presentation.phase.label)"))
            }

            HStack(alignment: .top, spacing: 10) {
                ForEach(previewSlots.indices, id: \.self) { index in
                    let slot = previewSlots[index]
                    let slotStatus = scanPreviewSlotStatus(at: index, presentation: presentation)

                    VStack(alignment: .leading, spacing: 9) {
                        scanPreviewSlotMarker(systemImage: slot.systemImage, status: slotStatus)
                        Text(slot.title)
                            .font(.system(size: 14, weight: .bold, design: .rounded))
                            .foregroundStyle(slotStatus == .pending ? IntakeV2Color.textTertiary : IntakeV2Color.textPrimary)
                        Text(slot.body)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(slotStatus == .pending ? IntakeV2Color.textTertiary.opacity(0.68) : IntakeV2Color.textTertiary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(14)
                    .frame(maxWidth: .infinity, minHeight: 118, alignment: .topLeading)
                    .background(ScanPreviewSlotBackground(status: slotStatus))
                    .accessibilityElement(children: .combine)
                    .accessibilityLabel("\(slot.title), \(scanPreviewSlotAccessibilityStatus(for: slotStatus))")
                    .accessibilityIdentifier("intakeV2.scanPreview.slot.\(index + 1)")
                }
            }
        }
        .padding(18)
        .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(IntakeV2Color.cardFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(IntakeV2Color.accent.opacity(0.16), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("intakeV2.scanPreview")
    }

    @ViewBuilder
    private func scanPreviewSlotMarker(systemImage: String, status: ScanPreviewSlotStatus) -> some View {
        switch status {
        case .active where !reduceMotion:
            IntakeV2ActivitySpinner(
                size: 18,
                lineWidth: 2.4,
                color: IntakeV2Color.accentBright,
                trackColor: IntakeV2Color.spinnerTrack
            )
                .frame(width: 22, height: 22, alignment: .leading)
                .accessibilityHidden(true)
        case .active:
            Image(systemName: "hourglass")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(IntakeV2Color.accentBright)
                .frame(width: 22, height: 22, alignment: .leading)
                .accessibilityHidden(true)
        case .complete, .pending:
            Image(systemName: systemImage)
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(scanPreviewSlotAccent(for: status))
                .frame(width: 22, height: 22, alignment: .leading)
                .accessibilityHidden(true)
        }
    }

    private var readySummaryTransition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        return .opacity.combined(with: .scale(scale: 0.985, anchor: .top))
    }

    private func scanPreviewTitle(for presentation: Day1ScanWaitPresentation) -> String {
        guard store.folderURL != nil else { return "답변 정리" }
        switch presentation.phase.stage {
        case .connecting:
            return "실행 보조 앱 연결 중"
        case .local:
            return "자료 후보 찾는 중"
        case .verifying:
            return "질문 근거 확인 중"
        case .composing:
            return "질문 \(questionCount)개 구성 중"
        case .merged:
            return "질문 준비 완료"
        case .blocked:
            return "AI 검증이 필요합니다"
        case .failed:
            return "자료 확인 중단"
        }
    }

    private func scanPreviewSubtitle(for presentation: Day1ScanWaitPresentation) -> String {
        guard store.folderURL != nil else {
            return "폴더 없이 앞서 답한 내용만 사용합니다."
        }
        switch presentation.phase.stage {
        case .connecting:
            return "연결되면 폴더 신호를 읽고 질문 근거를 검증합니다."
        case .local:
            return "질문에 쓸 자료 후보만 빠르게 확인합니다."
        case .verifying:
            return "후보 자료가 Day 1 질문 근거로 쓸 만한지 확인합니다."
        case .composing:
            return "고객, 문제, 확인할 행동 질문으로 묶는 중입니다."
        case .merged:
            return "질문에 쓸 근거를 모두 붙였습니다."
        case .blocked:
            return "연결된 AI로 근거 검증을 완료해야 Day 1을 시작할 수 있습니다."
        case .failed:
            return "폴더 신호가 부족해 기본 질문으로 이어갑니다."
        }
    }

    private func day1ReadySummaryCard(_ presentation: Day1ScanWaitPresentation) -> some View {
        VStack(alignment: .leading, spacing: 18) {
            HStack(alignment: .top, spacing: 13) {
                Image(systemName: "checkmark.circle.fill")
                    .font(.system(size: 23, weight: .heavy))
                    .foregroundStyle(IntakeV2Color.accentBright)
                    .frame(width: 30, height: 30)

                VStack(alignment: .leading, spacing: 5) {
                    Text("질문 \(questionCount)개가 준비됐어요")
                        .font(.system(size: 18, weight: .heavy, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textPrimary)
                    Text(readySummaryBody(for: presentation))
                        .font(.system(size: 13.5, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 12)

                Text("READY")
                    .font(.system(size: 11, weight: .heavy, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.accentBright)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 6)
                    .background(
                        Capsule()
                            .fill(IntakeV2Color.accent.opacity(0.12))
                            .overlay(Capsule().stroke(IntakeV2Color.accent.opacity(0.26), lineWidth: 1))
                    )
            }

            HStack(alignment: .top, spacing: 10) {
                ForEach(previewSlots.indices, id: \.self) { index in
                    readySummarySlot(slot: previewSlots[index], index: index)
                }
            }

            if let notice = providerLimitNotice {
                providerLimitBanner(notice)
            }
        }
        .padding(18)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(IntakeV2Color.accent.opacity(0.065))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(IntakeV2Color.accent.opacity(0.24), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityLabel(Text("질문 \(questionCount)개가 준비됐어요. \(readySummaryBody(for: presentation))"))
        .accessibilityIdentifier("intakeV2.day1ReadyHandoff")
    }

    private func providerLimitBanner(_ notice: ScanProviderLimitNotice) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(IntakeV2Color.textSecondary)
                .frame(width: 18, height: 18)
            VStack(alignment: .leading, spacing: 4) {
                Text("\(notice.provider.title) 한도에 도달해 질문이 로컬 신호로만 구성됐어요")
                    .font(.system(size: 12.5, weight: .bold, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textPrimary)
                Text(
                    providerLimitFallback != nil
                        ? "지금 질문으로 바로 시작해도 되고, 다른 AI로 근거 검증을 다시 돌릴 수도 있어요."
                        : "지금 질문으로 바로 시작할 수 있어요. 한도가 풀리면 근거 검증을 다시 돌릴 수 있습니다."
                )
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundStyle(IntakeV2Color.textTertiary)
                .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 8)
            if let fallback = providerLimitFallback, let onRescan = onProviderLimitRescan {
                Button {
                    onRescan(fallback)
                } label: {
                    Text("\(fallback.title)로 다시 검증")
                        .font(.system(size: 12, weight: .bold, design: .rounded))
                }
                .buttonStyle(.bordered)
                .help("\(fallback.title)로 근거 검증을 다시 돌립니다. 기본 provider 설정도 \(fallback.title)로 바뀝니다.")
                .accessibilityIdentifier("intakeV2.day1ProviderLimitRescan")
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(IntakeV2Color.textSecondary.opacity(0.07))
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(IntakeV2Color.textSecondary.opacity(0.18), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("intakeV2.day1ProviderLimitNotice")
    }

    private func readySummarySlot(
        slot: (title: String, body: String, systemImage: String),
        index: Int
    ) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 14, weight: .bold))
                .foregroundStyle(IntakeV2Color.accentBright)
                .frame(width: 18, height: 18)
            VStack(alignment: .leading, spacing: 3) {
                Text(slot.title)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textPrimary)
                Text("답변 대기")
                    .font(.system(size: 11.5, weight: .semibold, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textTertiary)
            }
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(maxWidth: .infinity, minHeight: 64, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(IntakeV2Color.cardMutedFill)
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(IntakeV2Color.accent.opacity(0.16), lineWidth: 1))
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(slot.title), 준비 완료")
        .accessibilityIdentifier("intakeV2.readySummary.slot.\(index + 1)")
    }

    private func readySummaryBody(for presentation: Day1ScanWaitPresentation) -> String {
        if store.folderURL == nil {
            return "기본 질문 \(questionCount)개가 준비됐습니다. 이제 고객, 문제, 확인할 행동을 차례로 고르면 됩니다."
        }
        if presentation.state == .scanFailed {
            return "기본 질문 \(questionCount)개가 준비됐습니다. 폴더 신호는 나중에 다시 붙일 수 있습니다."
        }
        if let readySignalCount, readySignalCount > 0 {
            return "폴더 신호 \(readySignalCount)개를 반영했습니다. 이제 고객, 문제, 확인할 행동을 차례로 고르면 됩니다."
        }
        return "선택한 폴더의 신호를 반영했습니다. 이제 고객, 문제, 확인할 행동을 차례로 고르면 됩니다."
    }

    private func scanPreviewSlotStatus(
        at index: Int,
        presentation: Day1ScanWaitPresentation
    ) -> ScanPreviewSlotStatus {
        guard !presentation.canOpenDay1 else { return .complete }
        if presentation.state == .connecting { return .pending }
        let activeIndex = min(max(presentation.phase.stepIndex - 1, 0), previewSlots.count - 1)
        if index < activeIndex { return .complete }
        if presentation.isBlocked { return .pending }
        if index == activeIndex { return .active }
        return .pending
    }

    private func scanPreviewSlotAccent(for status: ScanPreviewSlotStatus) -> Color {
        switch status {
        case .complete, .active:
            return IntakeV2Color.accentBright
        case .pending:
            return IntakeV2Color.textTertiary
        }
    }

    private func scanPreviewSlotAccessibilityStatus(for status: ScanPreviewSlotStatus) -> String {
        switch status {
        case .complete:
            return "완료"
        case .active:
            return "진행 중"
        case .pending:
            return "대기 중"
        }
    }

    private var slowScanNotice: some View {
        HStack(spacing: 10) {
            Image(systemName: "folder.badge.gearshape")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(IntakeV2Color.accentBright)
            Text("생각보다 큰 폴더라 조금 더 걸리고 있어요.")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(IntakeV2Color.textSecondary)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(IntakeV2Color.accent.opacity(0.08))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(IntakeV2Color.accent.opacity(0.18), lineWidth: 1))
        )
        .accessibilityIdentifier("intakeV2.scanSlowNotice")
    }

    private var scanBlockedNoticeBanner: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.octagon.fill")
                .font(.system(size: 15, weight: .bold))
                .foregroundStyle(IntakeV2Color.textSecondary)
                .frame(width: 20, height: 20)

            VStack(alignment: .leading, spacing: 5) {
                Text(scanBlockedTitle)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textPrimary)
                Text(scanBlockedBody)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(IntakeV2Color.textTertiary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 8)

            scanBlockedActions
        }
        .padding(.horizontal, 14)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(IntakeV2Color.textSecondary.opacity(0.07))
                .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(IntakeV2Color.textSecondary.opacity(0.2), lineWidth: 1))
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("intakeV2.scanBlockedNotice")
    }

    private var scanBlockedRecovery: WorkspaceScanBlockedRecovery? {
        scanBlockedNotice.map(WorkspaceScanBlockedRecovery.init(notice:))
    }

    private var scanBlockedTitle: String {
        scanBlockedRecovery?.title ?? "AI 검증을 완료하지 못했어요"
    }

    private var scanBlockedBody: String {
        scanBlockedRecovery?.body ?? "근거 검증을 완료하지 못했습니다. 위 원인을 확인한 뒤 다시 시도하세요."
    }

    @ViewBuilder
    private var scanBlockedActions: some View {
        if let recovery = scanBlockedRecovery {
            switch recovery.primaryAction {
            case .reviewEvidence:
                EmptyView()
            case .retry(let provider):
                if let onScanBlockedRescan {
                    VStack(alignment: .trailing, spacing: 6) {
                        Button {
                            onScanBlockedRescan(provider)
                        } label: {
                            Text("다시 시도")
                                .font(.system(size: 12, weight: .bold, design: .rounded))
                        }
                        .buttonStyle(.borderedProminent)
                        .help("\(provider.title)로 근거 검증을 다시 실행합니다.")
                        .accessibilityIdentifier("intakeV2.scanBlockedRescan")

                        scanBlockedAlternatesMenu(recovery.alternateProviders)
                    }
                }
            case .switchProvider(let provider):
                if let onScanBlockedRescan {
                    VStack(alignment: .trailing, spacing: 6) {
                        Button {
                            onScanBlockedRescan(provider)
                        } label: {
                            Text("\(provider.title)로 다시 검증")
                                .font(.system(size: 12, weight: .bold, design: .rounded))
                        }
                        .buttonStyle(.borderedProminent)
                        .help("\(provider.title)로 근거 검증을 다시 실행합니다. 기본 provider 설정도 \(provider.title)로 바뀝니다.")
                        .accessibilityIdentifier("intakeV2.scanBlockedRescan")

                        scanBlockedAlternatesMenu(recovery.alternateProviders)
                    }
                }
            case .connect(let readinesses):
                if let onScanBlockedAuthAction {
                    Menu("AI 연결하기") {
                        ForEach(readinesses) { readiness in
                            Button(scanBlockedAuthActionTitle(readiness)) {
                                onScanBlockedAuthAction(readiness)
                            }
                        }
                    }
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .menuStyle(.borderlessButton)
                    .accessibilityIdentifier("intakeV2.scanBlockedAuthAction")
                }
            case .openSettings:
                // Body copy already routes the user to Settings > AI 연결; this
                // terminal state has no installed SDK to act on inline.
                EmptyView()
            }
        }
    }

    @ViewBuilder
    private func scanBlockedAlternatesMenu(_ providers: [AgentProvider]) -> some View {
        if !providers.isEmpty, let onScanBlockedRescan {
            Menu("다른 AI") {
                ForEach(providers, id: \.self) { provider in
                    Button("\(provider.title)로 다시 검증") {
                        onScanBlockedRescan(provider)
                    }
                }
            }
            .font(.system(size: 11, weight: .semibold, design: .rounded))
            .accessibilityIdentifier("intakeV2.scanBlockedAlternateRescan")
        }
    }

    private func scanBlockedAuthActionTitle(_ readiness: WorkspaceScanProviderReadiness) -> String {
        "\(readiness.provider.title) \(WorkspaceScanBlockedRecovery.authShortLabel(readiness))"
    }

    private func scanWaitFooter(_ presentation: Day1ScanWaitPresentation, isNarrow: Bool) -> some View {
        HStack(alignment: .center, spacing: 12) {
            Button(action: handleBack) {
                Text("Back")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(IntakeV2Color.secondaryButtonText)
                    .padding(.horizontal, 30)
                    .padding(.vertical, 14)
                    .background(Capsule().fill(IntakeV2Color.secondaryButtonFill))
            }
            .buttonStyle(.plain)

            Spacer(minLength: 16)

            VStack(alignment: .trailing, spacing: 6) {
                ZStack(alignment: .leading) {
                    Button(action: { handleInboxCTA(presentation) }) {
                        HStack(spacing: 8) {
                            if !presentation.canOpenDay1 && !presentation.isBlocked {
                                IntakeV2ActivitySpinner(
                                    size: 15,
                                    lineWidth: 2,
                                    color: IntakeV2Color.disabledButtonText,
                                    trackColor: IntakeV2Color.spinnerTrack
                                )
                                .accessibilityHidden(true)
                            }
                            Text(primaryFooterTitle(for: presentation))
                                .font(.system(size: 16, weight: .bold, design: .rounded))
                                .foregroundStyle(presentation.canOpenDay1 ? IntakeV2Color.primaryButtonText : IntakeV2Color.disabledButtonText)
                                .lineLimit(1)
                                .minimumScaleFactor(0.82)
                                .monospacedDigit()
                        }
                        .padding(.horizontal, 30)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(presentation.canOpenDay1 ? IntakeV2Color.primaryButtonFill : IntakeV2Color.disabledButtonFill))
                        .accessibilityElement(children: .contain)
                    }
                    .buttonStyle(.plain)
                    .disabled(!presentation.canOpenDay1)
                    .accessibilityLabel(presentation.primaryCTAAccessibilityLabel(questionCount: questionCount))
                    .accessibilityIdentifier("intakeV2.openInboxButton")
                    .accessibilityFocused($primaryCTAFocused)

                    if !presentation.canOpenDay1 && !presentation.isBlocked {
                        IntakeV2FooterSpinnerAccessibilityMarker()
                            .padding(.leading, 30)
                    }
                }

                if presentation.canOpenDay1 {
                    Text("약 3분 · 선택하고 한 줄만 답하면 됩니다")
                        .font(.system(size: 10.5, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                        .lineLimit(1)
                        .minimumScaleFactor(0.78)
                }
            }
        }
        .frame(maxWidth: isNarrow ? .infinity : 880, alignment: .leading)
        .frame(maxWidth: .infinity, alignment: isNarrow ? .leading : .center)
        .padding(.top, 8)
    }

    private func primaryFooterTitle(for presentation: Day1ScanWaitPresentation) -> String {
        presentation.primaryCTATitle(questionCount: questionCount)
    }

    private var inboxFooterTitle: String {
        switch inboxCTAState {
        case .preparingDecision:
            return "Preparing inbox…"
        case .preparingInbox:
            return "Preparing inbox…"
        case .needsExecute:
            return "Preparing inbox…"
        case .ready:
            return "Open inbox →"
        }
    }

    private var todoWindowTransition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        return .asymmetric(
            insertion: .move(edge: .bottom)
                .combined(with: .opacity)
                .combined(with: .scale(scale: 0.98, anchor: .top)),
            removal: .opacity
        )
    }

    private var todoTaskTransition: AnyTransition {
        guard !reduceMotion else { return .opacity }
        return .opacity.combined(with: .scale(scale: 0.985, anchor: .center))
    }

    private func handleInboxCTA(_ presentation: Day1ScanWaitPresentation) {
        guard presentation.canOpenDay1 else { return }
        trackPresentationMilestonesIfNeeded(presentation)
        if agentic30GitignoreConsent?.needsConsent == true {
            showsAgentic30GitignoreConsent = true
            return
        }
        openDay1()
    }

    private func openDay1() {
        onDone()
    }

    private func handleBack() {
        PostHogTelemetry.capture("mac_scan_wait_back_clicked", properties: telemetryProperties(for: scanWaitPresentation(at: Date())))
        onBack()
    }

    private func trackScanWaitViewedIfNeeded() {
        guard !didTrackScanWaitViewed else { return }
        didTrackScanWaitViewed = true
        PostHogTelemetry.capture("mac_scan_wait_viewed", properties: telemetryProperties(for: scanWaitPresentation(at: Date())))
    }

    private func trackPresentationMilestonesIfNeeded(_ presentation: Day1ScanWaitPresentation) {
        if presentation.canOpenDay1 && !didTrackMergeCompleted {
            didTrackMergeCompleted = true
            PostHogTelemetry.capture("mac_scan_merge_completed", properties: telemetryProperties(for: presentation))
            DispatchQueue.main.asyncAfter(deadline: .now() + (reduceMotion ? 0.05 : 0.45)) {
                primaryCTAFocused = true
            }
        }
    }

    private func telemetryProperties(for presentation: Day1ScanWaitPresentation) -> [String: Any] {
        var properties: [String: Any] = [
            "state": "\(presentation.state)",
            "phase": presentation.phase.stage.rawValue,
            "step_index": presentation.phase.stepIndex,
            "total_steps": presentation.phase.totalSteps,
            "has_folder": store.folderURL != nil,
            "scan_failed": presentation.state == .scanFailed,
            "scan_blocked": presentation.state == .scanBlocked,
        ]
        if let elapsedSeconds = presentation.elapsedSeconds {
            properties["elapsed_seconds"] = elapsedSeconds
        }
        if let foundCount = presentation.phase.foundCount {
            properties["found_count"] = foundCount
        }
        return properties
    }

    private var completedBootLogDetails: some View {
        VStack(alignment: .leading, spacing: 10) {
            Button {
                withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.22)) {
                    showBootLogDetails.toggle()
                }
            } label: {
                HStack(spacing: 8) {
                    Image(systemName: showBootLogDetails ? "chevron.down.circle.fill" : "chevron.right.circle.fill")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(IntakeV2Color.accentBright)
                    Text(showBootLogDetails ? "세부 로그 접기" : "세부 로그 보기")
                        .font(.system(size: 12.5, weight: .bold, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textSecondary)
                    if let scanElapsed = bootLogState.scanElapsed {
                        Text(scanElapsed.chipText(at: scanElapsed.completedAt ?? Date()))
                            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(IntakeV2Color.textTertiary)
                    }
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 14)
                .frame(height: 38)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(IntakeV2Color.cardMutedFill)
                        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(IntakeV2Color.cardStroke, lineWidth: 1))
                )
            }
            .buttonStyle(.plain)

            if showBootLogDetails {
                terminalBox
                    .transition(.opacity)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("intakeV2.bootLogDetails")
    }

    // MARK: terminal

    private struct TerminalLine: Identifiable {
        let id: String
        var cmd: String
        var status: String?
        var deciding: Bool = false
    }

    private enum TerminalMetrics {
        static let maxVisibleLines = 6
        static let horizontalPadding: CGFloat = 22
        static let verticalPadding: CGFloat = 18
        static let headerHeight: CGFloat = 22
        static let headerBottomSpacing: CGFloat = 14
        static let lineStackSpacing: CGFloat = 6
        static let rowHeight: CGFloat = 22
        static let promptWidth: CGFloat = 16
        static let statusMinWidth: CGFloat = 280
        static let statusMaxWidth: CGFloat = 420
        static let columnSpacing: CGFloat = 8
        static let cornerRadius: CGFloat = 8

        static let boxHeight: CGFloat =
            verticalPadding * 2
            + headerHeight
            + headerBottomSpacing
            + rowHeight * CGFloat(maxVisibleLines)
            + lineStackSpacing * CGFloat(maxVisibleLines - 1)
    }

    private struct GeneratedTodoTask: Identifiable, Equatable {
        let id: Int
        let title: String
        let detail: String
        let tag: String
    }

    private var logLines: [TerminalLine] {
        bootLogState.lines.suffix(TerminalMetrics.maxVisibleLines).map { line in
            TerminalLine(
                id: line.id,
                cmd: line.command,
                status: line.status,
                deciding: line.isActive
            )
        }
    }

    private var terminalBox: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Circle().fill(Color(red: 1.00, green: 0.373, blue: 0.341)).frame(width: 9, height: 9)
                Circle().fill(Color(red: 0.996, green: 0.737, blue: 0.180)).frame(width: 9, height: 9)
                Circle().fill(Color(red: 0.157, green: 0.784, blue: 0.251)).frame(width: 9, height: 9)
                Text("details — boot.log")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.monospaceMuted)
                    .padding(.leading, 8)
                Spacer()
                if let scanElapsed = bootLogState.scanElapsed {
                    IntakeV2BootLogElapsedChip(elapsed: scanElapsed)
                }
            }
            .frame(height: TerminalMetrics.headerHeight, alignment: .center)
            .padding(.bottom, TerminalMetrics.headerBottomSpacing)

            VStack(alignment: .leading, spacing: TerminalMetrics.lineStackSpacing) {
                ForEach(logLines) { line in
                    terminalLine(line)
                }
            }
        }
        .padding(.horizontal, TerminalMetrics.horizontalPadding)
        .padding(.vertical, TerminalMetrics.verticalPadding)
        .frame(maxWidth: .infinity, minHeight: TerminalMetrics.boxHeight, maxHeight: TerminalMetrics.boxHeight, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: TerminalMetrics.cornerRadius)
                .fill(IntakeV2Color.terminalBg)
                .overlay(
                    RoundedRectangle(cornerRadius: TerminalMetrics.cornerRadius)
                        .stroke(IntakeV2Color.terminalStroke, lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("intakeV2.bootLog")
    }

    private struct IntakeV2BootLogElapsedChip: View {
        let elapsed: IntakeV2BootLogElapsed

        var body: some View {
            Group {
                if elapsed.isRunning {
                    TimelineView(.periodic(from: Date(), by: 1)) { context in
                        chip(at: context.date)
                    }
                } else {
                    chip(at: elapsed.completedAt ?? Date())
                }
            }
        }

        private func chip(at date: Date) -> some View {
            Text(elapsed.chipText(at: date))
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .monospacedDigit()
                .foregroundStyle(chipForeground)
                .lineLimit(1)
                .minimumScaleFactor(0.86)
                .frame(width: 104, height: 22)
                .background(
                    Capsule()
                        .fill(chipFill)
                        .overlay(Capsule().stroke(chipStroke, lineWidth: 1))
                )
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(Text(elapsed.accessibilityLabel(at: date)))
                .accessibilityIdentifier("intakeV2.bootLog.elapsed")
        }

        private var chipForeground: Color {
            switch elapsed.status {
            case .running:
                return IntakeV2Color.textSecondary
            case .succeeded:
                return IntakeV2Color.accentBright
            case .failed:
                return Color(red: 1.0, green: 0.51, blue: 0.45)
            }
        }

        private var chipFill: Color {
            switch elapsed.status {
            case .running:
                return IntakeV2Color.cardMutedFill
            case .succeeded:
                return IntakeV2Color.accent.opacity(0.10)
            case .failed:
                return Color(red: 1.0, green: 0.29, blue: 0.24).opacity(0.10)
            }
        }

        private var chipStroke: Color {
            switch elapsed.status {
            case .running:
                return IntakeV2Color.cardStroke
            case .succeeded:
                return IntakeV2Color.accent.opacity(0.22)
            case .failed:
                return Color(red: 1.0, green: 0.29, blue: 0.24).opacity(0.25)
            }
        }
    }

    private func terminalLine(_ line: TerminalLine) -> some View {
        HStack(spacing: TerminalMetrics.columnSpacing) {
            Text("$")
                .foregroundStyle(IntakeV2Color.accent)
                .frame(width: TerminalMetrics.promptWidth, alignment: .leading)

            HStack(spacing: 2) {
                Text(line.cmd)
                    .foregroundStyle(IntakeV2Color.terminalCommand)
                    .lineLimit(1)
                    .truncationMode(.middle)
                    .layoutPriority(0)
                if line.deciding {
                    DotPulse()
                }
            }
            .frame(minWidth: 0, maxWidth: .infinity, alignment: .leading)
            .clipped()

            Text(line.status ?? "")
                .foregroundStyle(terminalStatusColor(for: line.status))
                .lineLimit(1)
                .truncationMode(.tail)
                .frame(
                    minWidth: TerminalMetrics.statusMinWidth,
                    maxWidth: TerminalMetrics.statusMaxWidth,
                    alignment: .trailing
                )
                .layoutPriority(1)
        }
        .font(.system(size: 13, design: .monospaced))
        .frame(maxWidth: .infinity, minHeight: TerminalMetrics.rowHeight, maxHeight: TerminalMetrics.rowHeight, alignment: .leading)
        .clipped()
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(line.status.map { "\(line.cmd) \($0)" } ?? line.cmd)
        .transition(.opacity)
    }

    private func terminalStatusColor(for status: String?) -> Color {
        guard let status else { return .clear }
        if status.hasPrefix("✗") {
            return Color(red: 1.00, green: 0.373, blue: 0.341)
        }
        return status.hasPrefix("✓") ? IntakeV2Color.accent : IntakeV2Color.textTertiary
    }

    private func firstDecisionCard(_ d: IntakeV2Decision) -> some View {
        DecideNotificationGroupView(
            items: [firstDecisionNotificationItem(for: d)],
            expanded: firstDecisionExpanded,
            mode: .decisionAction,
            actionTitle: executeStartedTitle,
            actionSystemImage: "arrow.turn.down.left",
            actionDisabled: showTodoWindow,
            actionHint: showExecuteNudge && !showTodoWindow ? "Execute를 먼저 눌러 inbox를 준비하세요." : nil,
            onToggleExpanded: {
                firstDecisionExpanded.toggle()
            },
            onPrimaryAction: { startTodoGeneration(for: d) }
        )
        .accessibilityIdentifier("intakeV2.firstDecisionCard")
    }

    private func firstDecisionNotificationItem(for d: IntakeV2Decision) -> DecideNotificationItem {
        DecideNotificationItem(
            id: d.taskID,
            body: d.body,
            timeLabel: "방금",
            signalLabel: d.category.displayName,
            meta: d.metaLine,
            rationale: d.rationale
        )
    }

    private var executeStartedTitle: String {
        showTodoWindow ? "Executing" : "Execute first"
    }

    private enum ReadyTodoMetrics {
        static let slotCount = 3
        static let rowHeight: CGFloat = 68
        static let rowSpacing: CGFloat = 8
        static let bodyHeight: CGFloat = 14 + 2 + (rowHeight * CGFloat(slotCount)) + (rowSpacing * CGFloat(slotCount))
    }

    private func todoListWindow(for _: IntakeV2Decision) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Circle().fill(Color(red: 1.00, green: 0.373, blue: 0.341)).frame(width: 9, height: 9)
                Circle().fill(Color(red: 0.996, green: 0.737, blue: 0.180)).frame(width: 9, height: 9)
                Circle().fill(Color(red: 0.157, green: 0.784, blue: 0.251)).frame(width: 9, height: 9)
                Text("todo.list")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.monospaceMuted)
                    .padding(.leading, 8)
                Spacer()
                Text(todoGenerationComplete ? "3 tasks ready" : "generating")
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(todoGenerationComplete ? IntakeV2Color.accent : IntakeV2Color.textTertiary)
                if !todoGenerationComplete {
                    DotPulse()
                }
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 13)
            .background(IntakeV2Color.cardMutedFill)
            .overlay(Rectangle().fill(IntakeV2Color.cardStroke).frame(height: 1), alignment: .bottom)

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text("ready")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.accentBright)
                    Text("split into executable tasks")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                    Spacer()
                }
                .padding(.bottom, 2)

                ForEach(0..<ReadyTodoMetrics.slotCount, id: \.self) { index in
                    todoTaskSlot(index: index)
                }
            }
            .padding(16)
            .frame(height: ReadyTodoMetrics.bodyHeight + 32, alignment: .topLeading)
        }
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(IntakeV2Color.terminalBg)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(IntakeV2Color.accent.opacity(0.22), lineWidth: 1)
                )
                .shadow(color: IntakeV2Color.accent.opacity(0.10), radius: 28, y: 14)
        )
        .accessibilityIdentifier("intakeV2.todoListWindow")
    }

    @ViewBuilder
    private func todoTaskSlot(index: Int) -> some View {
        let task = generatedTodoTasks.indices.contains(index) ? generatedTodoTasks[index] : nil
        ZStack {
            todoDraftRow(nextIndex: index + 1)
                .opacity(task == nil ? 1 : 0)

            if let task {
                todoTaskRow(task)
                    .transition(todoTaskTransition)
            }
        }
        .frame(maxWidth: .infinity, minHeight: ReadyTodoMetrics.rowHeight, maxHeight: ReadyTodoMetrics.rowHeight, alignment: .topLeading)
        .clipped()
    }

    private func todoTaskRow(_ task: GeneratedTodoTask) -> some View {
        HStack(alignment: .top, spacing: 12) {
            ZStack {
                Circle()
                    .fill(IntakeV2Color.accent.opacity(0.16))
                    .overlay(Circle().stroke(IntakeV2Color.accent.opacity(0.55), lineWidth: 1))
                Text("\(task.id)")
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.accentBright)
            }
            .frame(width: 26, height: 26)

            VStack(alignment: .leading, spacing: 4) {
                Text(task.title)
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(IntakeV2Color.textPrimary)
                    .fixedSize(horizontal: false, vertical: true)
                Text(task.detail)
                    .font(.system(size: 11.5))
                    .foregroundStyle(IntakeV2Color.textTertiary)
                    .lineLimit(2)
            }

            Spacer(minLength: 12)

            Text(task.tag)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(IntakeV2Color.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 4)
                .background(
                    RoundedRectangle(cornerRadius: 5)
                        .fill(IntakeV2Color.accent.opacity(0.10))
                        .overlay(RoundedRectangle(cornerRadius: 5).stroke(IntakeV2Color.accent.opacity(0.16), lineWidth: 1))
                )
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(IntakeV2Color.cardMutedFill)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(IntakeV2Color.cardStroke, lineWidth: 1))
        )
        .frame(maxWidth: .infinity, minHeight: ReadyTodoMetrics.rowHeight, maxHeight: ReadyTodoMetrics.rowHeight, alignment: .topLeading)
    }

    private func todoDraftRow(nextIndex: Int) -> some View {
        HStack(spacing: 12) {
            ZStack {
                Circle()
                    .stroke(IntakeV2Color.accent.opacity(0.35), style: StrokeStyle(lineWidth: 1, dash: [4, 3]))
                DotPulse()
                    .scaleEffect(0.82)
            }
            .frame(width: 26, height: 26)

            VStack(alignment: .leading, spacing: 6) {
                RoundedRectangle(cornerRadius: 3)
                    .fill(IntakeV2Color.borderSoft)
                    .frame(width: nextIndex == 1 ? 230 : 280, height: 8)
                RoundedRectangle(cornerRadius: 3)
                    .fill(IntakeV2Color.borderSoft.opacity(0.72))
                    .frame(width: nextIndex == 3 ? 190 : 245, height: 7)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(IntakeV2Color.cardMutedFill)
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(IntakeV2Color.cardStroke, lineWidth: 1))
        )
        .frame(maxWidth: .infinity, minHeight: ReadyTodoMetrics.rowHeight, maxHeight: ReadyTodoMetrics.rowHeight, alignment: .topLeading)
    }

    private func startTodoGeneration(for decision: IntakeV2Decision) {
        guard !showTodoWindow else { return }
        todoGenerationTask?.cancel()
        generatedTodoTasks = []
        todoGenerationComplete = false
        withAnimation(reduceMotion ? nil : .spring(response: 0.48, dampingFraction: 0.82)) {
            showExecuteNudge = false
            showTodoWindow = true
        }
        todoGenerationTask = Task { await runTodoGeneration(for: decision) }
    }

    @MainActor private func runTodoGeneration(for decision: IntakeV2Decision) async {
        let tasks = todoTasks(for: decision)
        for task in tasks {
            try? await Task.sleep(nanoseconds: 650_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(reduceMotion ? nil : .easeOut(duration: 0.22)) {
                generatedTodoTasks.append(task)
            }
        }
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled else { return }
        withAnimation(reduceMotion ? nil : .easeOut(duration: 0.24)) {
            todoGenerationComplete = true
        }
    }

    private func todoTasks(for decision: IntakeV2Decision) -> [GeneratedTodoTask] {
        switch decision.category {
        case .interviewRequest:
            return [
                GeneratedTodoTask(id: 1, title: "최근 가입자 후보 3명을 추립니다.", detail: "가입 직후 행동 로그와 연락 가능한 사용자를 우선합니다.", tag: "FIND"),
                GeneratedTodoTask(id: 2, title: "30분 인터뷰 요청 메시지를 작성합니다.", detail: "질문은 문제 상황, 대안, 결제 의향 순서로 좁힙니다.", tag: "DRAFT"),
                GeneratedTodoTask(id: 3, title: "응답 여부와 다음 follow-up을 기록합니다.", detail: "오늘 보낸 요청과 회신 상태를 inbox에 남깁니다.", tag: "TRACK"),
            ]
        case .paymentResponse, .pricing:
            return [
                GeneratedTodoTask(id: 1, title: "결제/가격 관련 응답을 한곳에 모읍니다.", detail: "거절 이유, 가격 표현, 대안 언급을 분리합니다.", tag: "COLLECT"),
                GeneratedTodoTask(id: 2, title: "반복되는 사유 3개를 라벨링합니다.", detail: "빈도보다 구매 차단 강도가 큰 항목을 먼저 봅니다.", tag: "LABEL"),
                GeneratedTodoTask(id: 3, title: "가격 메시지 수정안을 하나 만듭니다.", detail: "다음 사용자 대화에서 바로 검증할 문장으로 끝냅니다.", tag: "SHIP"),
            ]
        case .docChange:
            return [
                GeneratedTodoTask(id: 1, title: "변경된 문서와 관련 코드 경로를 확인합니다.", detail: "SPEC, README, 최근 수정 파일을 같은 맥락으로 묶습니다.", tag: "READ"),
                GeneratedTodoTask(id: 2, title: "changelog에 반영할 사용자 영향만 추립니다.", detail: "내부 구현 설명보다 사용자가 겪는 변화에 맞춥니다.", tag: "EDIT"),
                GeneratedTodoTask(id: 3, title: "릴리즈 메모 초안을 저장합니다.", detail: "누락된 결정과 follow-up을 inbox에 연결합니다.", tag: "SAVE"),
            ]
        case .acquisition:
            return [
                GeneratedTodoTask(id: 1, title: "최근 가입자 5명의 첫 행동을 시간순으로 정리합니다.", detail: "첫 실행, 이탈 지점, 반복 클릭을 분리합니다.", tag: "MAP"),
                GeneratedTodoTask(id: 2, title: "공통 activation 신호를 하나 고릅니다.", detail: "가입 직후 10분 안에 반복되는 행동을 우선합니다.", tag: "SIGNAL"),
                GeneratedTodoTask(id: 3, title: "온보딩에서 바로 바꿀 한 문장을 작성합니다.", detail: "검증 가능한 copy 변경으로 작게 실행합니다.", tag: "APPLY"),
            ]
        case .churnSignal:
            return [
                GeneratedTodoTask(id: 1, title: "이탈 사용자 2명의 마지막 성공 행동을 찾습니다.", detail: "마지막 사용일과 직전 세션의 차단 지점을 비교합니다.", tag: "TRACE"),
                GeneratedTodoTask(id: 2, title: "반복 이탈 패턴을 한 문장으로 요약합니다.", detail: "기능 부족, 가치 미인지, 실행 부담을 구분합니다.", tag: "SUM"),
                GeneratedTodoTask(id: 3, title: "재활성화 메시지 또는 제품 수정안을 고릅니다.", detail: "오늘 실행 가능한 작은 조치 하나로 제한합니다.", tag: "ACT"),
            ]
        case .fallback:
            return [
                GeneratedTodoTask(id: 1, title: "현재 프로젝트에서 가장 최근 수정된 파일을 확인합니다.", detail: "결정 근거가 부족하므로 최신 작업 흔적부터 읽습니다.", tag: "READ"),
                GeneratedTodoTask(id: 2, title: "오늘 막힌 지점을 한 문장으로 정리합니다.", detail: "문제, 대상 사용자, 다음 행동을 분리합니다.", tag: "FRAME"),
                GeneratedTodoTask(id: 3, title: "30분 안에 끝낼 확인 작업 하나를 정합니다.", detail: "결과를 inbox에 남겨 다음 결정의 근거로 씁니다.", tag: "DO"),
            ]
        }
    }

    // MARK: boot sequence

    @MainActor private func synchronizeDecisionWithBootState() {
        guard !revealCard else { return }

        let intake = IntakeSnapshot.from(store: store)
        let engine = IntakeV2DecisionEngine()

        guard store.folderURL != nil else {
            revealDecision(engine.fallbackTemplate(intake: intake))
            return
        }

        guard let workspaceScanResult else { return }

        let made = workspaceScanResult.error == nil
            ? engine.generate(intake: intake, scan: sidecarScanInput(from: workspaceScanResult))
            : engine.fallbackTemplate(intake: intake)
        revealDecision(made)
    }

    @MainActor private func revealDecision(_ made: IntakeV2Decision) {
        decision = made
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.44)) {
            revealCard = true
        }
    }

    private func sidecarScanInput(from result: AgenticViewModel.WorkspaceScanResult) -> LocalScanResult {
        let paths = result.foundArtifactPaths
        return LocalScanResult(
            fileCount: paths.count,
            totalBytes: 0,
            staleSpecDays: nil,
            staleTodoDays: nil,
            lastCommitDays: nil,
            hasInterviewTranscripts: paths.contains { $0.range(of: "interview", options: .caseInsensitive) != nil },
            hasPaymentResponses: result.sheet != nil || paths.contains { path in
                path.range(of: "payment", options: .caseInsensitive) != nil
                    || path.range(of: "price", options: .caseInsensitive) != nil
                    || path.range(of: "pricing", options: .caseInsensitive) != nil
            }
        )
    }
}

// MARK: - Scan preview progress

private enum ScanPreviewSlotStatus: Equatable {
    case complete
    case active
    case pending
}

private struct ScanPreviewSlotBackground: View {
    let status: ScanPreviewSlotStatus

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: 8, style: .continuous)

        shape
            .fill(fill)
            .overlay(shape.stroke(baseStroke, lineWidth: 1))
            .overlay {
                switch status {
                case .complete:
                    shape.stroke(IntakeV2Color.accent.opacity(0.22), lineWidth: 1)
                case .active:
                    ScanPreviewGlowingBorderTrace(cornerRadius: 8)
                case .pending:
                    EmptyView()
                }
            }
            .clipShape(shape)
    }

    private var fill: Color {
        switch status {
        case .complete:
            return IntakeV2Color.cardFill
        case .active:
            return IntakeV2Color.accent.opacity(0.07)
        case .pending:
            return IntakeV2Color.cardMutedFill
        }
    }

    private var baseStroke: Color {
        switch status {
        case .complete:
            return IntakeV2Color.accent.opacity(0.15)
        case .active:
            return IntakeV2Color.accent.opacity(0.24)
        case .pending:
            return IntakeV2Color.cardStroke
        }
    }
}

private struct ScanPreviewGlowingBorderTrace: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pulse: Bool = false

    let cornerRadius: CGFloat

    var body: some View {
        let shape = RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)

        ZStack {
            shape.stroke(IntakeV2Color.accent.opacity(0.24), lineWidth: 1)

            if reduceMotion {
                shape
                    .stroke(IntakeV2Color.accentBright.opacity(0.72), lineWidth: 2)
                    .shadow(color: IntakeV2Color.accentBright.opacity(0.34), radius: 7)
            } else {
                shape
                    .stroke(
                        IntakeV2Color.accentBright.opacity(pulse ? 0.45 : 0.22),
                        lineWidth: pulse ? 1.6 : 1.1
                    )
                    .shadow(
                        color: IntakeV2Color.accentBright.opacity(pulse ? 0.34 : 0.18),
                        radius: pulse ? 7 : 3
                    )
            }
        }
        .onAppear {
            updateAnimation(reduceMotion: reduceMotion)
        }
        .onChange(of: reduceMotion) { _, newValue in
            updateAnimation(reduceMotion: newValue)
        }
    }

    private func updateAnimation(reduceMotion: Bool) {
        pulse = false
        guard !reduceMotion else { return }
        DispatchQueue.main.async {
            withAnimation(.easeInOut(duration: 1.55).repeatForever(autoreverses: true)) {
                pulse = true
            }
        }
    }
}

// MARK: - DotPulse (deciding... animation)

private struct DotPulse: View {
    @State private var phase: Int = 0
    private let timer = Timer.publish(every: 0.4, on: .main, in: .common).autoconnect()
    @Environment(\.accessibilityReduceMotion) private var reduceMotion

    var body: some View {
        HStack(spacing: 0) {
            ForEach(0..<3, id: \.self) { index in
                Text(".")
                    .opacity(reduceMotion || index <= phase ? 1 : 0)
            }
        }
        .font(.system(size: 13, design: .monospaced))
        .foregroundStyle(IntakeV2Color.accent)
        .frame(width: 28, alignment: .leading)
        .accessibilityHidden(true)
        .onReceive(timer) { _ in
            guard !reduceMotion else { return }
            phase = (phase + 1) % 3
        }
    }
}

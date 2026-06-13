//
//  ContentView.swift
//  agentic30
//
//  Created by october on 4/8/26.
//

import AppKit
import SwiftUI

private enum AssistantLiveStatusPanelTone {
    case floating
    case surface

    var titleColor: Color {
        switch self {
        case .floating:
            return .white.opacity(0.92)
        case .surface:
            return OpenDesignDayColor.fg
        }
    }

    var subtitleColor: Color {
        switch self {
        case .floating:
            return .white.opacity(0.52)
        case .surface:
            return OpenDesignDayColor.fgSecondary
        }
    }

    var bodyColor: Color {
        switch self {
        case .floating:
            return .white.opacity(0.48)
        case .surface:
            return OpenDesignDayColor.muted
        }
    }

    func outputIconColor(isActive: Bool) -> Color {
        switch self {
        case .floating:
            return .white.opacity(isActive ? 0.78 : 0.48)
        case .surface:
            return isActive ? OpenDesignDayColor.accent : OpenDesignDayColor.muted
        }
    }

    func outputTextColor(isActive: Bool) -> Color {
        switch self {
        case .floating:
            return .white.opacity(isActive ? 0.82 : 0.58)
        case .surface:
            return isActive ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted
        }
    }

    var panelFill: Color {
        switch self {
        case .floating:
            return Color.white.opacity(0.055)
        case .surface:
            return OpenDesignDayColor.surface
        }
    }

    var panelStroke: Color {
        switch self {
        case .floating:
            return Color.white.opacity(0.09)
        case .surface:
            return OpenDesignDayColor.borderSoft
        }
    }
}

struct OfficeHoursLiveStatusPolicy {
    nonisolated static func visibleRows(in session: ChatSession) -> [OfficeHoursTranscriptRow] {
        let rows = OfficeHoursTranscriptRow.rows(from: session.messages)
        // Provider parity for the stacked-card flow. The tool channels (Claude /
        // Codex) interview inside ONE perpetually-streaming assistant message, so
        // their free-narration prose stays hidden by the streaming filter for the
        // whole interview. Gemini is text-only and finalizes a fresh narration
        // message per answer; without this it would surface inter-card prose
        // bubbles the tool channels never produce. While a question card is
        // pending OR a run is still producing the next question, suppress
        // finalized assistant/system narration so every provider shows the same
        // clean card stack — this also covers the gap between answering one card
        // and the next card arriving, where pendingUserInput is briefly nil.
        // The concluding message (interview idle, no pending question) still shows;
        // error rows are dropped as before. Matched question/answer rows are
        // unaffected — the timeline rebuilds their cards from the submitted
        // snapshots regardless.
        // Seeded rows (Day-1 interview resume restored them from the workspace
        // turn log) are exempt: their submitted-card snapshots died with the
        // prior session, so hiding them would orphan the restored answers
        // below questionless bubbles for the whole resumed run.
        let interviewActive = session.pendingUserInput != nil || session.status == .running
        return rows.filter { row in
            if isStreamingAssistantRow(row) { return false }
            if isAssistantRow(row) && row.state == .error { return false }
            if interviewActive && isAssistantRow(row) && row.error == nil && !row.isSeededInterviewTurn { return false }
            return true
        }
    }

    nonisolated static func shouldShowDetachedLiveStatus(
        in session: ChatSession,
        rows: [OfficeHoursTranscriptRow]
    ) -> Bool {
        guard session.status == .running else { return false }
        guard case nil = session.pendingUserInput else { return false }
        return !rows.contains(where: isStreamingAssistantRow)
    }

    nonisolated static func shouldShowStreamingBadge(for row: OfficeHoursTranscriptRow) -> Bool {
        isAssistantRow(row)
            && row.state == .streaming
            && !isStreamingPlaceholderRow(row)
    }

    nonisolated private static func isStreamingAssistantRow(_ row: OfficeHoursTranscriptRow) -> Bool {
        isAssistantRow(row) && row.state == .streaming
    }

    nonisolated private static func isStreamingPlaceholderRow(_ row: OfficeHoursTranscriptRow) -> Bool {
        isAssistantRow(row)
            && row.state == .streaming
            && row.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            && row.error?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty != false
    }

    nonisolated private static func isAssistantRow(_ row: OfficeHoursTranscriptRow) -> Bool {
        row.kind == .assistant || row.kind == .system
    }
}

struct OfficeHoursLoaderCopy: Equatable {
    let title: String?
    let detail: String?

    static func resolve(status: OfficeHoursLiveStatus?) -> OfficeHoursLoaderCopy? {
        guard let status else { return nil }
        let title = status.title?.nonEmpty
        let detail = status.detail?.nonEmpty ?? status.progressText?.nonEmpty
        guard title != nil || detail != nil else { return nil }
        return OfficeHoursLoaderCopy(title: title, detail: detail)
    }
}

enum OpenDesignOfficeHoursColor {
    static let bg = Color(red: 0.0801, green: 0.0874, blue: 0.0928)
    static let bgDeep = Color(red: 0.0379, green: 0.0446, blue: 0.0497)
    static let bgDarker = Color(red: 0.0252, green: 0.0291, blue: 0.0322)
    static let surface = Color(red: 0.0544, green: 0.0614, blue: 0.0666)
    static let surface2 = Color(red: 0.0714, green: 0.0786, blue: 0.0839)
    static let hover = Color(red: 0.1407, green: 0.1524, blue: 0.1611)
    static let selected = Color(red: 0.1756, green: 0.1918, blue: 0.2039)
    static let border = Color(red: 0.1501, green: 0.1619, blue: 0.1708)
    static let borderSoft = Color(red: 0.1128, green: 0.1242, blue: 0.1327)
    static let fg = Color(red: 0.9410, green: 0.9490, blue: 0.9550)
    static let fgSecondary = Color(red: 0.7328, green: 0.7455, blue: 0.7551)
    static let muted = Color(red: 0.4865, green: 0.5055, blue: 0.5198)
    static let mutedDeep = Color(red: 0.3263, green: 0.3486, blue: 0.3652)
    static let accent = Color(red: 0.2165, green: 0.8352, blue: 0.6244)
    static let amber = Color(red: 0.9364, green: 0.6955, blue: 0.2742)
    static let rose = Color(red: 0.9751, green: 0.4673, blue: 0.4400)

    static var accentDim: Color { accent.opacity(0.14) }
    static var accentLine: Color { accent.opacity(0.40) }
    static var amberDim: Color { amber.opacity(0.14) }

    static let nsWindowBackground = NSColor(red: 0.0801, green: 0.0874, blue: 0.0928, alpha: 1)
}

private enum OfficeHoursRealProjectTestState: Equatable {
    case idle
    case scanning
    case starting
    case waitingForFirstQuestion
    case readyForReview
    case failed(String)

    var isBusy: Bool {
        switch self {
        case .scanning, .starting, .waitingForFirstQuestion:
            return true
        case .idle, .readyForReview, .failed:
            return false
        }
    }
}

private enum OfficeHoursRealProjectCheckState: Equatable {
    case pass
    case fail
    case pending

    var systemImage: String {
        switch self {
        case .pass:
            return "checkmark.circle.fill"
        case .fail:
            return "xmark.octagon.fill"
        case .pending:
            return "circle.dashed"
        }
    }

    var color: Color {
        switch self {
        case .pass:
            return OpenDesignOfficeHoursColor.accent
        case .fail:
            return OpenDesignOfficeHoursColor.rose
        case .pending:
            return OpenDesignOfficeHoursColor.muted
        }
    }

    var reportLabel: String {
        switch self {
        case .pass:
            return "pass"
        case .fail:
            return "fail"
        case .pending:
            return "pending"
        }
    }
}

private struct OfficeHoursRealProjectQualityCheck: Identifiable, Equatable {
    let id: String
    let title: String
    let detail: String
    let state: OfficeHoursRealProjectCheckState
}

private enum OfficeHoursTypewriterTiming {
    static func delayNanoseconds(for character: Character, baseMilliseconds: Double) -> UInt64 {
        let multiplier: Double
        switch character {
        case ".", "!", "?":
            multiplier = 6
        case ",", "·":
            multiplier = 2
        default:
            multiplier = character.officeHoursIsWhitespace ? 0.6 : 1
        }
        return UInt64(max(0, baseMilliseconds * multiplier) * 1_000_000)
    }

    static func totalDelayNanoseconds(
        for text: String,
        baseMilliseconds: Double,
        initialMilliseconds: Double = 40,
        completionMilliseconds: Double = 55
    ) -> UInt64 {
        let body = text.reduce(UInt64(initialMilliseconds * 1_000_000)) { partialResult, character in
            partialResult + delayNanoseconds(for: character, baseMilliseconds: baseMilliseconds)
        }
        return body + UInt64(completionMilliseconds * 1_000_000)
    }
}

private struct OfficeHoursMinimumLoading<Loader: View, Content: View>: View {
    let id: String
    let durationNanoseconds: UInt64
    var onReadyChange: (Bool) -> Void = { _ in }
    @ViewBuilder let loader: () -> Loader
    @ViewBuilder let content: () -> Content

    @State private var isReady = false

    var body: some View {
        let ready = isReady || durationNanoseconds == 0
        Group {
            if ready {
                content()
                    .transition(.officeHoursPromptReveal)
            } else {
                loader()
            }
        }
        .task(id: id) {
            isReady = durationNanoseconds == 0
            onReadyChange(isReady)
            guard durationNanoseconds > 0 else { return }
            do {
                try await Task.sleep(nanoseconds: durationNanoseconds)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            withAnimation(.timingCurve(0.2, 0, 0, 1, duration: 0.22)) {
                isReady = true
            }
            onReadyChange(true)
        }
    }
}

private struct OfficeHoursDelayedReveal<Content: View>: View {
    let id: String
    let delayNanoseconds: UInt64
    @ViewBuilder let content: () -> Content

    @State private var isVisible = false

    var body: some View {
        let visible = isVisible || delayNanoseconds == 0
        content()
            .opacity(visible ? 1 : 0)
            .offset(y: visible ? 0 : 5)
            .allowsHitTesting(visible)
            .accessibilityHidden(!visible)
            .task(id: id) {
                isVisible = delayNanoseconds == 0
                guard delayNanoseconds > 0 else { return }
                do {
                    try await Task.sleep(nanoseconds: delayNanoseconds)
                } catch {
                    return
                }
                guard !Task.isCancelled else { return }
                withAnimation(.timingCurve(0.2, 0, 0, 1, duration: 0.22)) {
                    isVisible = true
                }
            }
    }
}

private struct OfficeHoursOffsetOpacityModifier: ViewModifier {
    let opacity: Double
    let y: CGFloat

    func body(content: Content) -> some View {
        content
            .opacity(opacity)
            .offset(y: y)
    }
}

private extension AnyTransition {
    static var officeHoursPromptReveal: AnyTransition {
        .modifier(
            active: OfficeHoursOffsetOpacityModifier(opacity: 0, y: 5),
            identity: OfficeHoursOffsetOpacityModifier(opacity: 1, y: 0)
        )
    }
}

private struct OfficeHoursOptionRowSurface: ViewModifier {
    let selected: Bool
    let disabled: Bool
    let dimmed: Bool

    @State private var isHovered = false

    private var fill: Color {
        if selected {
            return OpenDesignOfficeHoursColor.accentDim
        }
        if dimmed {
            if isHovered && !disabled {
                return OpenDesignOfficeHoursColor.hover.opacity(0.55)
            }
            return OpenDesignOfficeHoursColor.bgDarker.opacity(disabled ? 0.80 : 0.62)
        }
        if isHovered && !disabled {
            return OpenDesignOfficeHoursColor.hover
        }
        return Color.clear
    }

    private var stroke: Color {
        if selected {
            return OpenDesignOfficeHoursColor.accentLine
        }
        if dimmed {
            if isHovered && !disabled {
                return OpenDesignOfficeHoursColor.borderSoft.opacity(0.70)
            }
            return OpenDesignOfficeHoursColor.borderSoft.opacity(0.32)
        }
        if isHovered && !disabled {
            return OpenDesignOfficeHoursColor.borderSoft
        }
        return Color.clear
    }

    func body(content: Content) -> some View {
        content
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(fill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(stroke, lineWidth: 1)
                    )
            )
            .onHover { hover in
                guard !disabled else { return }
                isHovered = hover
            }
            .animation(.easeOut(duration: 0.14), value: selected)
            .animation(.easeOut(duration: 0.14), value: isHovered)
    }
}

private extension View {
    func officeHoursOptionRowSurface(selected: Bool, disabled: Bool = false, dimmed: Bool = false) -> some View {
        modifier(OfficeHoursOptionRowSurface(selected: selected, disabled: disabled, dimmed: dimmed))
    }
}

private struct OfficeHoursIntroStageReveal<Content: View>: View {
    let id: String
    let delayNanoseconds: UInt64
    @ViewBuilder let content: () -> Content

    @State private var isVisible = false

    var body: some View {
        Group {
            if isVisible {
                content()
                    .transition(
                        .modifier(
                            active: OfficeHoursOffsetOpacityModifier(opacity: 0, y: 8),
                            identity: OfficeHoursOffsetOpacityModifier(opacity: 1, y: 0)
                        )
                    )
            }
        }
        .task(id: id) {
            isVisible = delayNanoseconds == 0
            guard delayNanoseconds > 0 else { return }
            do {
                try await Task.sleep(nanoseconds: delayNanoseconds)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            withAnimation(.timingCurve(0.2, 0, 0, 1, duration: 0.20)) {
                isVisible = true
            }
        }
    }
}

private struct OfficeHoursCommandTypewriterText: View {
    let text: String
    let reduceMotion: Bool

    @State private var visibleCount = 0
    @State private var isDone = false
    @State private var isCaretVisible = true

    private var visibleText: String {
        reduceMotion ? text : String(text.prefix(visibleCount))
    }

    var body: some View {
        HStack(spacing: 2) {
            ZStack(alignment: .leading) {
                Text(text)
                    .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                    .opacity(0)
                    .accessibilityHidden(true)
                Text(visibleText)
                    .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.muted)
            }

            Rectangle()
                .fill(OpenDesignOfficeHoursColor.accent)
                .frame(width: 6, height: 12)
                .clipShape(RoundedRectangle(cornerRadius: 1, style: .continuous))
                .opacity(reduceMotion || isDone || !isCaretVisible ? 0 : 1)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text.trimmingCharacters(in: .whitespacesAndNewlines))
        .task(id: text) {
            await runTypewriter()
        }
        .task(id: isDone) {
            await blinkCaret()
        }
        .onChange(of: reduceMotion) { _, isReduced in
            visibleCount = isReduced ? text.count : 0
            isDone = isReduced
        }
    }

    @MainActor
    private func blinkCaret() async {
        isCaretVisible = true
        guard !reduceMotion, !isDone else { return }
        while !Task.isCancelled && !isDone {
            do {
                try await Task.sleep(nanoseconds: 450_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled, !isDone else { return }
            isCaretVisible.toggle()
        }
    }

    @MainActor
    private func runTypewriter() async {
        guard !reduceMotion else {
            visibleCount = text.count
            isDone = true
            return
        }
        visibleCount = 0
        isDone = false
        guard !text.isEmpty else {
            isDone = true
            return
        }
        var index = 0
        for _ in text {
            index += 1
            do {
                try await Task.sleep(nanoseconds: 20_000_000)
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            visibleCount = index
        }
        isDone = true
    }
}

private struct OfficeHoursTypewriterText: View {
    let text: String
    let font: Font
    let foregroundColor: Color
    let lineSpacing: CGFloat
    var tracking: CGFloat = 0
    let reduceMotion: Bool
    let baseSpeedMilliseconds: Double
    var initialDelayNanoseconds: UInt64 = 0

    @State private var visibleCount = 0

    private var visibleText: String {
        reduceMotion ? text : String(text.prefix(visibleCount))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            Text(text)
                .font(font)
                .tracking(tracking)
                .lineSpacing(lineSpacing)
                .fixedSize(horizontal: false, vertical: true)
                .opacity(0)
                .accessibilityHidden(true)

            Text(visibleText)
                .font(font)
                .foregroundStyle(foregroundColor)
                .tracking(tracking)
                .lineSpacing(lineSpacing)
                .fixedSize(horizontal: false, vertical: true)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .task(id: text) {
            await runTypewriter()
        }
        .onChange(of: reduceMotion) { _, isReduced in
            visibleCount = isReduced ? text.count : 0
        }
    }

    @MainActor
    private func runTypewriter() async {
        guard !reduceMotion else {
            visibleCount = text.count
            return
        }
        visibleCount = 0
        guard !text.isEmpty else { return }
        do {
            if initialDelayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: initialDelayNanoseconds)
            }
            try await Task.sleep(nanoseconds: 40_000_000)
        } catch {
            return
        }
        guard !Task.isCancelled else { return }
        var index = 0
        for character in text {
            index += 1
            do {
                try await Task.sleep(
                    nanoseconds: OfficeHoursTypewriterTiming.delayNanoseconds(
                        for: character,
                        baseMilliseconds: baseSpeedMilliseconds
                    )
                )
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            visibleCount = index
        }
    }
}

private struct OfficeHoursHighlightedTypewriterText: View {
    let text: String
    let highlightPhrases: [String]
    var emphasis: [EmphasisSpan] = []
    let reduceMotion: Bool
    let baseSpeedMilliseconds: Double
    var initialDelayNanoseconds: UInt64 = 0

    @State private var visibleCount = 0

    private var visibleText: String {
        reduceMotion ? text : String(text.prefix(visibleCount))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            OfficeHoursInlinePromptText(text: text, highlightPhrases: highlightPhrases, emphasis: emphasis)
                .opacity(0)
                .accessibilityHidden(true)

            OfficeHoursInlinePromptText(text: visibleText, highlightPhrases: highlightPhrases, emphasis: emphasis)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .task(id: text) {
            await runTypewriter()
        }
        .onChange(of: reduceMotion) { _, isReduced in
            visibleCount = isReduced ? text.count : 0
        }
    }

    @MainActor
    private func runTypewriter() async {
        guard !reduceMotion else {
            visibleCount = text.count
            return
        }
        visibleCount = 0
        guard !text.isEmpty else { return }
        do {
            if initialDelayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: initialDelayNanoseconds)
            }
            try await Task.sleep(nanoseconds: 40_000_000)
        } catch {
            return
        }
        guard !Task.isCancelled else { return }
        var index = 0
        for character in text {
            index += 1
            do {
                try await Task.sleep(
                    nanoseconds: OfficeHoursTypewriterTiming.delayNanoseconds(
                        for: character,
                        baseMilliseconds: baseSpeedMilliseconds
                    )
                )
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            visibleCount = index
        }
    }
}

private struct OfficeHoursMissionTitleTypewriterText: View {
    let reduceMotion: Bool
    var initialDelayNanoseconds: UInt64 = 0

    private let prefix = "오늘은 "
    private let highlight = "Startup"
    private let suffix = " 관점으로 시작합니다."

    @State private var visibleCount = 0

    private var fullText: String { prefix + highlight + suffix }
    private var visibleText: String { reduceMotion ? fullText : String(fullText.prefix(visibleCount)) }

    var body: some View {
        ZStack(alignment: .leading) {
            missionTitle(prefix: prefix, highlight: highlight, suffix: suffix)
                .opacity(0)
                .accessibilityHidden(true)
            missionTitle(
                prefix: visiblePart(offset: 0, maxCount: prefix.count),
                highlight: visiblePart(offset: prefix.count, maxCount: highlight.count),
                suffix: visiblePart(offset: prefix.count + highlight.count, maxCount: suffix.count)
            )
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(fullText)
        .task(id: reduceMotion) {
            await runTypewriter()
        }
        .onChange(of: reduceMotion) { _, isReduced in
            visibleCount = isReduced ? fullText.count : 0
        }
    }

    @ViewBuilder
    private func missionTitle(prefix: String, highlight: String, suffix: String) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 0) {
            Text(prefix)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
            if !highlight.isEmpty {
                Text(highlight)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 1)
                    .background(
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .fill(OpenDesignOfficeHoursColor.amberDim)
                    )
            }
            Text(suffix)
                .font(.system(size: 17, weight: .medium))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
        }
        .lineLimit(2)
        .fixedSize(horizontal: false, vertical: true)
    }

    private func visiblePart(offset: Int, maxCount: Int) -> String {
        guard visibleText.count > offset, maxCount > 0 else { return "" }
        let start = visibleText.index(visibleText.startIndex, offsetBy: min(offset, visibleText.count))
        let available = visibleText.distance(from: start, to: visibleText.endIndex)
        let end = visibleText.index(start, offsetBy: min(maxCount, available))
        return String(visibleText[start..<end])
    }

    @MainActor
    private func runTypewriter() async {
        guard !reduceMotion else {
            visibleCount = fullText.count
            return
        }
        visibleCount = 0
        do {
            if initialDelayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: initialDelayNanoseconds)
            }
            try await Task.sleep(nanoseconds: 40_000_000)
        } catch {
            return
        }
        guard !Task.isCancelled else { return }
        var index = 0
        for character in fullText {
            index += 1
            do {
                try await Task.sleep(
                    nanoseconds: OfficeHoursTypewriterTiming.delayNanoseconds(
                        for: character,
                        baseMilliseconds: 5
                    )
                )
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            visibleCount = index
        }
    }
}

private struct OfficeHoursInlinePromptText: View {
    let text: String
    let highlightPhrases: [String]
    /// Style-aware spans. When non-empty, each phrase renders in its own style.
    /// When empty, the renderer falls back to the single-style `highlightPhrases`
    /// path (green `.code` chip), preserving the historical interview look.
    var emphasis: [EmphasisSpan] = []
    // Match browser text shaping in office-hours.html for desktop statement wrapping.
    private let htmlDesktopStatementWidth: CGFloat = 668

    private var segments: [OfficeHoursPromptTextSegment] {
        if !emphasis.isEmpty {
            return OfficeHoursPromptTextSegment.segments(in: text, emphasis: emphasis)
        }
        return OfficeHoursPromptTextSegment.segments(in: text, highlightPhrases: highlightPhrases)
    }

    var body: some View {
        OfficeHoursInlineFlowLayout(spacing: 4, lineSpacing: 7, fallbackWidth: htmlDesktopStatementWidth) {
            ForEach(segments) { segment in
                Self.styledText(for: segment)
                    .layoutValue(key: OfficeHoursInlineFlowAfterSpacingKey.self, value: segment.afterSpacing)
            }
        }
        .frame(maxWidth: htmlDesktopStatementWidth, alignment: .leading)
        .padding(.bottom, 6)
    }

    @ViewBuilder
    private static func styledText(for segment: OfficeHoursPromptTextSegment) -> some View {
        let base = Text(segment.text)
            .font(segment.renderStyle == .code
                  ? .system(size: 17, weight: .medium, design: .monospaced)
                  : .system(size: 17, weight: segment.renderStyle == .strong ? .semibold : .medium))
            .tracking(-0.17)
        switch segment.renderStyle {
        case .body:
            base.foregroundStyle(OpenDesignOfficeHoursColor.fg)
        case .strong:
            base.foregroundStyle(OpenDesignOfficeHoursColor.fg)
        case .legacyAccent:
            base
                .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                .padding(.horizontal, 8)
                .padding(.vertical, 1)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.accentDim)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1)
                        )
                )
        case .mark:
            base
                .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .background(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.amberDim)
                )
        case .code:
            base
                .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                .padding(.horizontal, 6)
                .padding(.vertical, 1)
                .background(
                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.bgDarker)
                        .overlay(
                            RoundedRectangle(cornerRadius: 4, style: .continuous)
                                .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                        )
                )
        }
    }
}

private struct OfficeHoursAttributedInlinePromptText: NSViewRepresentable {
    let text: String
    let highlightPhrases: [String]
    var emphasis: [EmphasisSpan] = []
    private let htmlDesktopStatementWidth: CGFloat = 668

    func makeNSView(context: Context) -> NSTextField {
        let field = NSTextField(labelWithAttributedString: attributedText(maxWidth: htmlDesktopStatementWidth))
        field.backgroundColor = .clear
        field.drawsBackground = false
        field.isBezeled = false
        field.isBordered = false
        field.isEditable = false
        field.isSelectable = false
        field.maximumNumberOfLines = 0
        field.preferredMaxLayoutWidth = htmlDesktopStatementWidth
        field.lineBreakMode = .byWordWrapping
        field.setContentCompressionResistancePriority(.defaultLow, for: .horizontal)
        field.setContentHuggingPriority(.defaultLow, for: .horizontal)
        return field
    }

    func updateNSView(_ field: NSTextField, context: Context) {
        field.preferredMaxLayoutWidth = htmlDesktopStatementWidth
        field.attributedStringValue = attributedText(maxWidth: htmlDesktopStatementWidth)
        field.setAccessibilityLabel(text)
    }

    func sizeThatFits(_ proposal: ProposedViewSize, nsView: NSTextField, context: Context) -> CGSize? {
        let width = min(proposal.width ?? htmlDesktopStatementWidth, htmlDesktopStatementWidth)
        nsView.preferredMaxLayoutWidth = width
        nsView.attributedStringValue = attributedText(maxWidth: width)
        if let cell = nsView.cell {
            let size = cell.cellSize(forBounds: NSRect(x: 0, y: 0, width: width, height: .greatestFiniteMagnitude))
            return CGSize(width: width, height: ceil(size.height))
        }
        let fittingSize = nsView.fittingSize
        return CGSize(width: width, height: ceil(fittingSize.height))
    }

    private func attributedText(maxWidth: CGFloat) -> NSAttributedString {
        let paragraph = NSMutableParagraphStyle()
        paragraph.lineBreakMode = .byWordWrapping
        paragraph.lineSpacing = 5
        paragraph.minimumLineHeight = 26
        paragraph.maximumLineHeight = 26

        let result = NSMutableAttributedString(
            string: text,
            attributes: [
                .font: NSFont.systemFont(ofSize: 17, weight: .medium),
                .foregroundColor: NSColor(red: 0.9410, green: 0.9490, blue: 0.9550, alpha: 1),
                .paragraphStyle: paragraph,
                .kern: -0.17,
            ]
        )
        for span in styledRanges() {
            result.addAttributes(
                Self.attributes(for: span.style),
                range: NSRange(span.range, in: text)
            )
        }
        return result
    }

    private static let fgColor = NSColor(red: 0.9410, green: 0.9490, blue: 0.9550, alpha: 1)
    private static let accentColor = NSColor(red: 0.2165, green: 0.8352, blue: 0.6244, alpha: 1)
    private static let accentDimColor = NSColor(red: 0.2165, green: 0.8352, blue: 0.6244, alpha: 0.14)
    private static let amberColor = NSColor(red: 0.9364, green: 0.6955, blue: 0.2742, alpha: 1)
    private static let amberDimColor = NSColor(red: 0.9364, green: 0.6955, blue: 0.2742, alpha: 0.14)
    private static let bgDarkerColor = NSColor(red: 0.0252, green: 0.0291, blue: 0.0322, alpha: 1)

    private static func attributes(
        for style: OfficeHoursPromptTextSegment.RenderStyle
    ) -> [NSAttributedString.Key: Any] {
        switch style {
        case .body:
            return [:]
        case .strong:
            return [
                .font: NSFont.systemFont(ofSize: 17, weight: .semibold),
                .foregroundColor: fgColor,
            ]
        case .legacyAccent:
            return [
                .foregroundColor: accentColor,
                .backgroundColor: accentDimColor,
            ]
        case .mark:
            return [
                .foregroundColor: amberColor,
                .backgroundColor: amberDimColor,
            ]
        case .code:
            return [
                .font: NSFont.monospacedSystemFont(ofSize: 17, weight: .medium),
                .foregroundColor: accentColor,
                .backgroundColor: bgDarkerColor,
            ]
        }
    }

    /// Resolve styled ranges directly against the source string. Phrases are
    /// matched longest-first so a more specific span claims its range before a
    /// shorter overlapping one. Mirrors `OfficeHoursPromptTextSegment` matching
    /// but emits ranges for the NSAttributedString path.
    private func styledRanges() -> [(range: Range<String.Index>, style: OfficeHoursPromptTextSegment.RenderStyle)] {
        let styledPhrases: [(phrase: String, render: OfficeHoursPromptTextSegment.RenderStyle)]
        if emphasis.isEmpty {
            styledPhrases = OpenDesignDayContent.InterviewStep
                .normalizedHighlightPhrases(highlightPhrases)
                .map { (phrase: $0, render: .legacyAccent) }
        } else {
            styledPhrases = emphasis.map { span in
                let render: OfficeHoursPromptTextSegment.RenderStyle
                switch span.style {
                case .strong: render = .strong
                case .mark: render = .mark
                case .code: render = .code
                }
                return (phrase: span.phrase.trimmingCharacters(in: .whitespacesAndNewlines), render: render)
            }
        }

        let normalized = styledPhrases
            .filter { !$0.phrase.isEmpty }
            .sorted { $0.phrase.count > $1.phrase.count }
        guard !normalized.isEmpty else { return [] }

        var ranges: [(range: Range<String.Index>, style: OfficeHoursPromptTextSegment.RenderStyle)] = []
        for entry in normalized {
            var searchRange = text.startIndex..<text.endIndex
            while let range = text.range(
                of: entry.phrase,
                options: [.caseInsensitive, .diacriticInsensitive],
                range: searchRange
            ) {
                if !ranges.contains(where: { $0.range.overlaps(range) }) {
                    ranges.append((range, entry.render))
                }
                searchRange = range.upperBound..<text.endIndex
            }
        }
        return ranges.sorted { $0.range.lowerBound < $1.range.lowerBound }
    }
}

private struct OfficeHoursAttributedInlineTypewriterText: View {
    let text: String
    let highlightPhrases: [String]
    var emphasis: [EmphasisSpan] = []
    let reduceMotion: Bool
    let baseSpeedMilliseconds: Double
    var initialDelayNanoseconds: UInt64 = 0

    @State private var visibleCount = 0

    private var visibleText: String {
        reduceMotion ? text : String(text.prefix(visibleCount))
    }

    var body: some View {
        ZStack(alignment: .topLeading) {
            OfficeHoursAttributedInlinePromptText(text: text, highlightPhrases: highlightPhrases, emphasis: emphasis)
                .opacity(0)
                .accessibilityHidden(true)

            OfficeHoursAttributedInlinePromptText(text: visibleText, highlightPhrases: highlightPhrases, emphasis: emphasis)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(text)
        .task(id: text) {
            await runTypewriter()
        }
        .onChange(of: reduceMotion) { _, isReduced in
            visibleCount = isReduced ? text.count : 0
        }
    }

    @MainActor
    private func runTypewriter() async {
        guard !reduceMotion else {
            visibleCount = text.count
            return
        }
        visibleCount = 0
        guard !text.isEmpty else { return }
        do {
            if initialDelayNanoseconds > 0 {
                try await Task.sleep(nanoseconds: initialDelayNanoseconds)
            }
            try await Task.sleep(nanoseconds: 40_000_000)
        } catch {
            return
        }
        guard !Task.isCancelled else { return }
        var index = 0
        for character in text {
            index += 1
            do {
                try await Task.sleep(
                    nanoseconds: OfficeHoursTypewriterTiming.delayNanoseconds(
                        for: character,
                        baseMilliseconds: baseSpeedMilliseconds
                    )
                )
            } catch {
                return
            }
            guard !Task.isCancelled else { return }
            visibleCount = index
        }
    }
}

private struct OfficeHoursPromptTextSegment: Identifiable, Hashable {
    /// Visual treatment for a rendered span. `.legacyAccent` is the historical
    /// single-style green chip used by the `highlightPhrases`-only path; the
    /// other three map 1:1 to the dynamic `EmphasisStyle` wire vocabulary.
    enum RenderStyle: Hashable {
        case body
        case legacyAccent
        case strong
        case mark
        case code
    }

    let id: Int
    var text: String
    let renderStyle: RenderStyle
    var afterSpacing: CGFloat = 0

    var isHighlight: Bool { renderStyle != .body }

    private static let wordSpacing: CGFloat = 4

    /// Legacy single-style path: every matched phrase renders in the original
    /// green accent chip (`.legacyAccent`). Used when only `highlightPhrases` is
    /// present, preserving the historical interview look exactly.
    static func segments(
        in text: String,
        highlightPhrases: [String]
    ) -> [OfficeHoursPromptTextSegment] {
        let phrases = OpenDesignDayContent.InterviewStep.normalizedHighlightPhrases(highlightPhrases)
        let ranges = phrases.map { (phrase: $0, render: RenderStyle.legacyAccent) }
        return segments(in: text, styledPhrases: ranges)
    }

    /// Style-aware path: each emphasis span matches its phrase in `text` and
    /// stamps the matched range with that span's style.
    static func segments(
        in text: String,
        emphasis: [EmphasisSpan]
    ) -> [OfficeHoursPromptTextSegment] {
        let styled = emphasis.map { (phrase: $0.phrase, render: renderStyle(for: $0.style)) }
        return segments(in: text, styledPhrases: styled)
    }

    private static func renderStyle(for style: EmphasisStyle) -> RenderStyle {
        switch style {
        case .strong: return .strong
        case .mark: return .mark
        case .code: return .code
        }
    }

    /// Shared matcher: trims/dedupes phrases (longest first so a more specific
    /// span claims its range before a shorter overlapping one), finds every
    /// non-overlapping occurrence, and splits the text into body + styled spans.
    private static func segments(
        in text: String,
        styledPhrases: [(phrase: String, render: RenderStyle)]
    ) -> [OfficeHoursPromptTextSegment] {
        guard !text.isEmpty else { return [] }
        let normalized = styledPhrases
            .map { (phrase: $0.phrase.trimmingCharacters(in: .whitespacesAndNewlines), render: $0.render) }
            .filter { !$0.phrase.isEmpty }
            .sorted { $0.phrase.count > $1.phrase.count }
        guard !normalized.isEmpty else {
            return bodySegments(text, nextId: 0).segments
        }

        var styledRanges: [(range: Range<String.Index>, render: RenderStyle)] = []
        for entry in normalized {
            var searchRange = text.startIndex..<text.endIndex
            while let range = text.range(
                of: entry.phrase,
                options: [.caseInsensitive, .diacriticInsensitive],
                range: searchRange
            ) {
                if !styledRanges.contains(where: { $0.range.overlaps(range) }) {
                    styledRanges.append((range, entry.render))
                }
                searchRange = range.upperBound..<text.endIndex
            }
        }
        styledRanges.sort { $0.range.lowerBound < $1.range.lowerBound }
        guard !styledRanges.isEmpty else {
            return bodySegments(text, nextId: 0).segments
        }

        var result: [OfficeHoursPromptTextSegment] = []
        var cursor = text.startIndex
        var nextId = 0
        for entry in styledRanges {
            if cursor < entry.range.lowerBound {
                let body = bodySegments(String(text[cursor..<entry.range.lowerBound]), nextId: nextId)
                result.append(contentsOf: body.segments)
                nextId = body.nextId
            }
            result.append(OfficeHoursPromptTextSegment(id: nextId, text: String(text[entry.range]), renderStyle: entry.render, afterSpacing: 0))
            nextId += 1
            cursor = entry.range.upperBound
        }
        if cursor < text.endIndex {
            let body = bodySegments(String(text[cursor..<text.endIndex]), nextId: nextId)
            result.append(contentsOf: body.segments)
        }
        return result
    }

    private static func bodySegments(
        _ text: String,
        nextId: Int
    ) -> (segments: [OfficeHoursPromptTextSegment], nextId: Int) {
        var segments: [OfficeHoursPromptTextSegment] = []
        var current = ""
        var id = nextId

        func appendSegment(_ value: String, afterSpacing: CGFloat = 0) {
            guard !value.isEmpty else { return }
            segments.append(OfficeHoursPromptTextSegment(
                id: id,
                text: value,
                renderStyle: .body,
                afterSpacing: afterSpacing
            ))
            id += 1
        }

        func appendBodyToken(_ value: String, afterSpacing: CGFloat = 0) {
            guard !value.isEmpty else { return }
            if let split = value.officeHoursPromptTerminalBreak {
                appendSegment(split.prefix, afterSpacing: 0)
                appendSegment(split.suffix, afterSpacing: afterSpacing)
            } else {
                appendSegment(value, afterSpacing: afterSpacing)
            }
        }

        func flushCurrent(afterSpacing: CGFloat = 0) {
            appendBodyToken(current, afterSpacing: afterSpacing)
            current = ""
        }

        func markWordSpacingAfterLastSegment() {
            guard !segments.isEmpty else { return }
            segments[segments.count - 1].afterSpacing = Self.wordSpacing
        }

        for character in text {
            if character.officeHoursIsWhitespace {
                if !current.isEmpty {
                    flushCurrent(afterSpacing: Self.wordSpacing)
                } else {
                    markWordSpacingAfterLastSegment()
                }
            } else {
                current.append(character)
            }
        }
        if !current.isEmpty {
            flushCurrent()
        }
        return (segments, id)
    }
}

private struct OfficeHoursInlineFlowAfterSpacingKey: LayoutValueKey {
    nonisolated static let defaultValue: CGFloat = .nan
}

private struct OfficeHoursInlineFlowLayout: Layout {
    var spacing: CGFloat
    var lineSpacing: CGFloat
    var fallbackWidth: CGFloat?

    func sizeThatFits(proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) -> CGSize {
        let rows = rows(for: subviews, proposalWidth: proposal.width)
        let height = rows.reduce(CGFloat(0)) { $0 + $1.height } + CGFloat(max(0, rows.count - 1)) * lineSpacing
        let width = proposal.width ?? fallbackWidth ?? rows.map(\.width).max() ?? 0
        return CGSize(width: width, height: height)
    }

    func placeSubviews(in bounds: CGRect, proposal: ProposedViewSize, subviews: Subviews, cache: inout ()) {
        let rows = rows(for: subviews, proposalWidth: bounds.width)
        var y = bounds.minY
        for row in rows {
            var x = bounds.minX
            for item in row.items {
                item.subview.place(
                    at: CGPoint(x: x, y: y + max(0, (row.height - item.size.height) / 2)),
                    proposal: ProposedViewSize(item.size)
                )
                x += item.size.width + item.afterSpacing
            }
            y += row.height + lineSpacing
        }
    }

    private func rows(for subviews: Subviews, proposalWidth: CGFloat?) -> [FlowRow] {
        let measured = subviews.map { subview in
            let preferredSpacing = subview[OfficeHoursInlineFlowAfterSpacingKey.self]
            return FlowItem(
                subview: subview,
                size: subview.sizeThatFits(.unspecified),
                afterSpacing: preferredSpacing.isNaN ? spacing : preferredSpacing
            )
        }
        let totalWidth = measured.enumerated().reduce(CGFloat(0)) { partial, pair in
            let (index, item) = pair
            let spacingAfterPrevious = index == 0 ? 0 : measured[index - 1].afterSpacing
            return partial + spacingAfterPrevious + item.size.width
        }
        let maxWidth = max(proposalWidth ?? fallbackWidth ?? totalWidth, 1)
        var rows: [FlowRow] = []
        var current: [FlowItem] = []
        var currentWidth: CGFloat = 0
        var currentHeight: CGFloat = 0

        for item in measured {
            let spacingAfterPrevious = current.last?.afterSpacing ?? 0
            let nextWidth = current.isEmpty ? item.size.width : currentWidth + spacingAfterPrevious + item.size.width
            if nextWidth > maxWidth, !current.isEmpty {
                rows.append(FlowRow(items: current, width: currentWidth, height: currentHeight))
                current = [item]
                currentWidth = item.size.width
                currentHeight = item.size.height
            } else {
                current.append(item)
                currentWidth = nextWidth
                currentHeight = max(currentHeight, item.size.height)
            }
        }
        if !current.isEmpty {
            rows.append(FlowRow(items: current, width: currentWidth, height: currentHeight))
        }
        return rows
    }

    private struct FlowRow {
        let items: [FlowItem]
        let width: CGFloat
        let height: CGFloat
    }

    private struct FlowItem {
        let subview: LayoutSubview
        let size: CGSize
        let afterSpacing: CGFloat
    }
}

private struct OfficeHoursLoaderLine: View {
    let reduceMotion: Bool
    @State private var offset: CGFloat = -0.462

    var body: some View {
        GeometryReader { proxy in
            ZStack(alignment: .leading) {
                Rectangle()
                    .fill(OpenDesignOfficeHoursColor.borderSoft)
                Rectangle()
                    .fill(OpenDesignOfficeHoursColor.accent)
                    .frame(width: max(42, proxy.size.width * 0.42))
                    .offset(x: reduceMotion ? 0 : proxy.size.width * offset)
            }
        }
        .frame(height: 1)
        .clipped()
        .task(id: reduceMotion) {
            guard !reduceMotion else {
                offset = 0
                return
            }
            offset = -0.462
            await MainActor.run {
                withAnimation(.timingCurve(0.2, 0, 0, 1, duration: 1.1).repeatForever(autoreverses: false)) {
                    offset = 1.05
                }
            }
        }
    }
}

private struct OfficeHoursLoaderOrb: View {
    let reduceMotion: Bool
    @State private var rotation: Angle = .degrees(0)

    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(OpenDesignOfficeHoursColor.accentDim)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1)
                )

            Circle()
                .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 2)
                .frame(width: 16, height: 16)
                .opacity(0.82)

            Circle()
                .trim(from: 0.0, to: 0.25)
                .stroke(
                    OpenDesignOfficeHoursColor.accent,
                    style: StrokeStyle(lineWidth: 2, lineCap: .butt)
                )
                .rotationEffect(rotation - .degrees(90))
                .frame(width: 16, height: 16)
        }
        .frame(width: 34, height: 34)
        .task(id: reduceMotion) {
            guard !reduceMotion else {
                rotation = .degrees(0)
                return
            }
            rotation = .degrees(0)
            await MainActor.run {
                withAnimation(.linear(duration: 0.76).repeatForever(autoreverses: false)) {
                    rotation = .degrees(360)
                }
            }
        }
    }
}

private enum OfficeHoursMode: String, CaseIterable, Identifiable {
    case startup
    case builder
    case intra

    var id: String { rawValue }

    var label: String {
        switch self {
        case .startup: return "Startup"
        case .builder: return "Builder"
        case .intra: return "Internal"
        }
    }

    var sidebarName: String {
        switch self {
        case .startup: return "Startup diagnostic"
        case .builder: return "Builder brainstorm"
        case .intra: return "Internal greenlight"
        }
    }

    var sidebarMeta: String {
        switch self {
        case .startup: return "수요, 현재 대안, 유료 진입점"
        case .builder: return "side project, demo, research"
        case .intra: return "VP sponsor, reorg risk"
        }
    }

    var mark: String {
        switch self {
        case .startup: return "YC"
        case .builder: return "BD"
        case .intra: return "IN"
        }
    }

    var questionCount: Int {
        switch self {
        case .startup: return 6
        case .builder: return 5
        case .intra: return 4
        }
    }

    var headline: String {
        switch self {
        case .startup: return "수요가 진짜인지 먼저 확인"
        case .builder: return "보여주고 싶은 버전을 구체화"
        case .intra: return "승인받을 최소 데모 정의"
        }
    }

    var detail: String {
        switch self {
        case .startup: return "증거, 현재 대안, 가장 작은 유료 진입점을 묻는다."
        case .builder: return "side project, demo, 주말에 만들 수 있는 범위로 좁힌다."
        case .intra: return "스폰서가 바로 판단할 화면, 리스크, 조건을 정리한다."
        }
    }

    var assignment: String {
        switch self {
        case .startup: return "가장 절박한 사용자 1명에게 이번 주 유료 진입점 보여주기"
        case .builder: return "이번 주말에 공유 가능한 첫 장면을 만들기"
        case .intra: return "스폰서가 greenlight할 최소 데모를 보여주기"
        }
    }
}

func openDesignDay1GoalProductName(
    situationSummaryName: String?,
    alignmentProductName: String?,
    icpProductName: String?
) -> String {
    [
        situationSummaryName,
        alignmentProductName,
        icpProductName,
    ]
        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty }
        .first ?? "이 프로젝트"
}

func openDesignDay1GoalSubject(_ productName: String) -> String {
    let name = productName.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "이 프로젝트"
    return "\(name)\(openDesignKoreanSubjectParticle(for: name))"
}

private func openDesignKoreanSubjectParticle(for text: String) -> String {
    guard let lastScalar = text.trimmingCharacters(in: .whitespacesAndNewlines).unicodeScalars.last else {
        return "가"
    }
    let value = lastScalar.value
    if (0xAC00...0xD7A3).contains(value) {
        return (value - 0xAC00) % 28 == 0 ? "가" : "이"
    }
    switch String(lastScalar) {
    case "0", "1", "3", "6", "7", "8":
        return "이"
    default:
        return "가"
    }
}

// Day timeline sidebar rows: a Day entry, or a collapsed "skipped" run of empty days.
private enum OfficeHoursTimelineRow: Identifiable {
    case day(Int)
    case skip(from: Int, to: Int)

    var id: String {
        switch self {
        case .day(let day): return "day-\(day)"
        case .skip(let from, let to): return "skip-\(from)-\(to)"
        }
    }
}

private enum OfficeHoursTimelineRowStyle {
    case today
    case done
    case incomplete
}

struct OfficeHoursSubmittedPromptSnapshot: Identifiable, Hashable {
    let sessionId: String
    let requestId: String
    let prompt: StructuredPromptRequest
    let submissions: [AgenticViewModel.StructuredPromptSubmission]
    let submittedAt: Date
    var isRestored: Bool = false
    var isEditable: Bool = true

    var id: String { requestId }

    var answerSummary: String {
        let parts = submissions.flatMap { submission -> [String] in
            let selected = submission.selectedOptions
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            let freeText = submission.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
            return selected + (freeText.isEmpty ? [] : [freeText])
        }
        let summary = parts.joined(separator: " / ")
        guard !summary.isEmpty else { return "응답" }
        guard summary.count > 96 else { return summary }
        return String(summary.prefix(96)) + "..."
    }

    var normalizedQuestionText: String {
        prompt.questions
            .map(\.question)
            .joined(separator: " ")
            .officeHoursNormalizedTranscriptText
    }

    var normalizedAnswerText: String {
        answerSummary.officeHoursNormalizedTranscriptText
    }

    func matchesTranscriptQuestion(_ content: String) -> Bool {
        let question = normalizedQuestionText
        guard !question.isEmpty else { return false }
        return content.officeHoursNormalizedTranscriptText.contains(question)
    }

    func matchesTranscriptAnswer(_ content: String) -> Bool {
        let normalizedContent = content.officeHoursNormalizedTranscriptText
        guard !normalizedContent.isEmpty else { return false }
        if normalizedContent == normalizedAnswerText || normalizedContent.contains(normalizedAnswerText) {
            return true
        }
        return submissions.contains { submission in
            let tokens = submission.selectedOptions + [submission.freeText]
            return tokens
                .map { $0.officeHoursNormalizedTranscriptText }
                .filter { !$0.isEmpty }
                .contains { normalizedContent.contains($0) }
        }
    }
}

struct OfficeHoursLoadingSnapshot: Identifiable, Hashable {
    let sessionId: String
    let requestId: String
    let startedAt: Date

    var id: String { requestId }
}

struct OfficeHoursSubmittedPromptTimelineCard: Identifiable, Hashable {
    let snapshot: OfficeHoursSubmittedPromptSnapshot
    let index: Int
    let total: Int

    var id: String { snapshot.id }
}

enum OfficeHoursTimelineItem: Identifiable, Hashable {
    case row(OfficeHoursTranscriptRow)
    case submittedPrompt(OfficeHoursSubmittedPromptTimelineCard)
    case loading(OfficeHoursLoadingSnapshot)

    var id: String {
        switch self {
        case .row(let row):
            return "row-\(row.id)"
        case .submittedPrompt(let card):
            return "submitted-\(card.id)"
        case .loading(let snapshot):
            return "loading-\(snapshot.requestId)"
        }
    }
}

private enum OfficeHoursEvidenceDraftMode: String, Hashable {
    case evidence
    case abandon
}

private struct OfficeHoursEvidenceDraft: Identifiable, Hashable {
    let commitment: CommitmentRecord
    let mode: OfficeHoursEvidenceDraftMode

    var id: String { "\(mode.rawValue)-\(commitment.id)" }
}

private enum OfficeHoursEvidenceBannerActionTone: Hashable {
    case primary
    case secondary
    case quiet
}

struct OfficeHoursTimelineBuilder {
    static func items(
        rows: [OfficeHoursTranscriptRow],
        submittedSnapshots snapshots: [OfficeHoursSubmittedPromptSnapshot],
        activeLoading loading: OfficeHoursLoadingSnapshot?,
        fallbackTotal: Int? = nil
    ) -> [OfficeHoursTimelineItem] {
        let orderedSnapshots = snapshots.sorted { lhs, rhs in
            if lhs.submittedAt == rhs.submittedAt { return lhs.requestId < rhs.requestId }
            return lhs.submittedAt < rhs.submittedAt
        }
        var items: [OfficeHoursTimelineItem] = []
        var emittedSnapshotIDs = Set<String>()

        func appendSubmittedCard(for snapshot: OfficeHoursSubmittedPromptSnapshot, offset: Int) {
            guard !emittedSnapshotIDs.contains(snapshot.requestId) else { return }
            emittedSnapshotIDs.insert(snapshot.requestId)
            let index = max(1, snapshot.prompt.generation?.dimensionStepIndex ?? offset + 1)
            let total = max(index, snapshot.prompt.generation?.dimensionTotal ?? fallbackTotal ?? orderedSnapshots.count)
            items.append(.submittedPrompt(OfficeHoursSubmittedPromptTimelineCard(
                snapshot: snapshot,
                index: index,
                total: total
            )))
        }

        for row in rows {
            // Seeded rows collapse only against sidecar-restored snapshots. A
            // fuzzy match against a live snapshot from this app run would
            // misplace the new card at an old restored row.
            if let snapshotIndex = orderedSnapshots.firstIndex(where: { snapshot in
                if row.isSeededInterviewTurn && !snapshot.isRestored {
                    return false
                }
                switch row.kind {
                case .assistant:
                    return snapshot.matchesTranscriptQuestion(row.content)
                case .user:
                    return snapshot.matchesTranscriptAnswer(row.content)
                case .system:
                    return false
                }
            }) {
                appendSubmittedCard(for: orderedSnapshots[snapshotIndex], offset: snapshotIndex)
                continue
            }

            items.append(.row(row))
        }

        for (offset, snapshot) in orderedSnapshots.enumerated() {
            appendSubmittedCard(for: snapshot, offset: offset)
        }

        if let loading {
            items.append(.loading(loading))
        }

        return items
    }
}

struct OfficeHoursPendingPromptPresentation: Hashable {
    let shouldRender: Bool
    let questionNumber: Int
    let total: Int

    static func resolve(
        answerCount: Int,
        fallbackTotal: Int,
        generationTotal: Int?,
        interviewComplete: Bool
    ) -> OfficeHoursPendingPromptPresentation {
        let questionNumber = max(1, answerCount + 1)
        let total = max(questionNumber, generationTotal ?? fallbackTotal)
        return OfficeHoursPendingPromptPresentation(
            shouldRender: !interviewComplete,
            questionNumber: questionNumber,
            total: total
        )
    }
}

struct OfficeHoursBannerPresentation: Equatable {
    let showMemoryBanner: Bool
    let showEvidenceOSBanner: Bool
    let showFullInterventionBanner: Bool
    let showInlineScheduledIntervention: Bool

    static func resolve(
        memory: OfficeHoursMemorySummary?,
        evidenceOS: EvidenceOSSummary?,
        intervention: SidecarEvent.OhInterventionRequired?
    ) -> OfficeHoursBannerPresentation {
        let hasOpenDebt = evidenceOS?.hasOpenDebt ?? false
        let hasAbandonedThread = !(memory?.abandonedThreads.isEmpty ?? true)
        let hasCalibration = !(memory?.calibrationLine?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ?? true)
        let hasNonDuplicateMemorySignal = hasAbandonedThread || hasCalibration
        let hasMemoryContent = memory?.hasContent ?? false
        let isScheduledIntervention = intervention?.severity?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() == "scheduled"
        let inlineScheduledIntervention = hasOpenDebt && isScheduledIntervention

        return OfficeHoursBannerPresentation(
            showMemoryBanner: hasMemoryContent && (!hasOpenDebt || hasNonDuplicateMemorySignal),
            showEvidenceOSBanner: hasOpenDebt,
            showFullInterventionBanner: intervention != nil && !inlineScheduledIntervention,
            showInlineScheduledIntervention: inlineScheduledIntervention
        )
    }
}

struct OfficeHoursLoadingPolicy {
    static func visibleLoading(
        for session: ChatSession,
        loading: OfficeHoursLoadingSnapshot?
    ) -> OfficeHoursLoadingSnapshot? {
        guard let loading else { return nil }
        if session.status == .error || session.error?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false {
            return nil
        }
        if let pendingRequestId = session.pendingUserInput?.requestId {
            return pendingRequestId == loading.requestId ? loading : nil
        }
        return session.status == .running ? loading : nil
    }
}

struct OfficeHoursScreenLayout: Equatable {
    let showsSessions: Bool
    let showsMeta: Bool
    let sessionsWidth: CGFloat
    let metaWidth: CGFloat
    let mainPadding: CGFloat

    init(width: CGFloat, isMetaPanelExpanded: Bool = true) {
        showsSessions = width > 900
        showsMeta = width > 1180 && isMetaPanelExpanded
        sessionsWidth = 240
        metaWidth = 280
        mainPadding = width > 640 ? 28 : 16
    }
}

private struct OfficeHoursScrollCaptureAnchor: NSViewRepresentable {
    @Binding var anchor: NSView?

    func makeNSView(context: Context) -> NSView {
        let view = NSView(frame: .zero)
        DispatchQueue.main.async {
            anchor = view
        }
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        if let anchor, anchor === nsView { return }
        DispatchQueue.main.async {
            anchor = nsView
        }
    }
}

struct OfficeHoursRealProjectTestSessionPolicy {
    static func canStartTest(in session: ChatSession?, provider: AgentProvider) -> Bool {
        guard let session else { return false }
        guard session.provider == provider else { return false }
        guard session.status == .idle else { return false }
        guard session.pendingUserInput == nil else { return false }
        return session.messages.isEmpty
    }
}

struct OfficeHoursAutoStartPolicy {
    static func canAutoStart(
        in session: ChatSession,
        startedSessionIDs: Set<String>,
        realProjectTestBusy: Bool,
        realProjectSessionCreateRequested: Bool
    ) -> Bool {
        guard !realProjectTestBusy else { return false }
        guard !realProjectSessionCreateRequested else { return false }
        guard session.status == .idle else { return false }
        guard session.pendingUserInput == nil else { return false }
        guard !startedSessionIDs.contains(session.id) else { return false }
        return true
    }

    /// Identity used to detect an in-place provider switch on the *same* office-hours
    /// session, as opposed to simply selecting a different session in the sidebar.
    struct SessionProviderSnapshot: Equatable {
        let sessionID: String
        let provider: AgentProvider
    }

    /// When the user switches the active engine on an office-hours session whose first
    /// question failed to generate (e.g. the prior provider hit its usage limit), the
    /// sidecar idles the session and clears the error — which also removes the failure
    /// card's "다시 시도" affordance. This re-arms auto-start so the Day question
    /// regenerates on the newly selected engine without starting a new chat.
    ///
    /// Returns true only for a genuine in-place switch (same session id, different
    /// provider). A session swap (different id) returns false so an unrelated session is
    /// never restarted. The caller still gates on `canAutoStart`, so a session with a
    /// valid in-flight question (awaiting input) is left untouched.
    static func shouldRestartAfterProviderChange(
        from old: SessionProviderSnapshot?,
        to new: SessionProviderSnapshot?
    ) -> Bool {
        guard let old, let new else { return false }
        return old.sessionID == new.sessionID && old.provider != new.provider
    }
}

/// Scroll coordination for the office-hours transcript. The pin target legitimately
/// migrates while a turn is in flight (submitted answer → loader → revealed question),
/// and content height settles asynchronously (transitions, reveals). Two rules keep
/// the viewport from fighting itself:
///
/// 1. A scroll request resolves its target ONCE; delayed re-pins re-anchor that same
///    target. Re-resolving inside retries made a single request animate to several
///    different positions over its lifetime.
/// 2. A newer request supersedes every pending re-pin of older requests (generation
///    token). Without this, stale retries from a previous state fired after newer
///    scrolls and dragged the viewport back — the e2e interview scroll jitter.
///
/// Re-pin delays stay short: every state change that moves the target (new question,
/// status change, minimum-loading reveal) fires its own request, so a long blind tail
/// only stomps user-initiated scrolling.
struct OfficeHoursTranscriptScrollPolicy {
    static let repinDelays: [TimeInterval] = [0.24, 0.6, 1.2]

    static func shouldPerform(requestGeneration: Int, currentGeneration: Int) -> Bool {
        requestGeneration == currentGeneration
    }
}

enum WorkspaceChromeStyle: Equatable {
    case standard
    case day1OfficeHours

    static func resolve(
        isWorkspaceWindow: Bool,
        dayNumber: Int,
        selectedReferencePage: OpenDesignReferencePageKind?,
        isOfficeHoursPresented: Bool
    ) -> WorkspaceChromeStyle {
        guard isWorkspaceWindow, dayNumber == 1 else { return .standard }
        if isOfficeHoursPresented || selectedReferencePage == nil || selectedReferencePage == .settings {
            return .day1OfficeHours
        }
        return .standard
    }
}

struct ContentView: View {
    private static func uiTestingInitialOfficeHoursPastDay() -> Int? {
        #if DEBUG
        let prefix = "--ui-testing-open-office-hours-past-day="
        guard let argument = CommandLine.arguments.first(where: { $0.hasPrefix(prefix) }) else {
            return nil
        }
        return Int(argument.dropFirst(prefix.count))
        #else
        return nil
        #endif
    }

    @Environment(\.accessibilityReduceTransparency) private var reduceTransparency
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @ObservedObject var viewModel: AgenticViewModel
    private let surfaceOverride: AgenticSurface?
    private let openWorkspaceAction: (() -> Void)?
    private let closeWorkspaceAction: (() -> Void)?
    private let zoomWorkspaceAction: (() -> Void)?
    private let maximizeWorkspaceOnFirstAppear: Bool
    private let markWorkspaceInitialMaximizeApplied: (() -> Void)?

    @State private var currentPromptBindingToken: String?
    @State private var showsBipMissionEvidence = false
    @State private var showsBipCompletionFields = false
    @State private var showsBipReadinessPreview = false
    @State private var showsBipReadinessAdvanced = false
    @State private var showsInlineBipReadinessSetup = false
    @State private var selectedOpenDesignReferencePage: OpenDesignReferencePageKind?
    @State private var selectedSettingsSection: SettingsSection = .workspace
    @State private var showsAppUpdateStatusPanel = false
    @State private var isOpenDesignOfficeHoursPresented = false
    @State private var isOpenDesignMorningBriefingPresented = false
    @State private var isBipMissionRoutePresented = false
    @State private var openDesignDayInteractionStateCache = OpenDesignDayInteractionStateCache()
    @State private var officeHoursStartedSessionIDs: Set<String> = []
    @State private var officeHoursRealProjectTestState: OfficeHoursRealProjectTestState = .idle
    @State private var officeHoursRealProjectTestContext = ""
    @State private var officeHoursRealProjectTestSessionID: String?
    @State private var officeHoursRealProjectSessionCreateRequested = false
    @State private var didCopyOfficeHoursRealProjectTestReport = false
    @State private var officeHoursDigestBannerCollapsed = false
    /// Identity of the digest the user dismissed ("day#localStartDate"); a new
    /// digest (next day or re-sync window change) brings the banner back.
    @State private var officeHoursDigestBannerDismissedKey: String?
    @State private var selectedOfficeHoursMode: OfficeHoursMode = .startup
    @State private var selectedOfficeHoursGoalType: Day1GoalType?
    @State private var pendingOfficeHoursStartMode: OfficeHoursMode?
    @State private var pendingOfficeHoursStartDay: Int?
    @State private var pendingOfficeHoursStartTrigger: String?
    /// Live day scoping. `nil` = today; explicit values scope the active Office
    /// Hours session. Read-only retro uses `selectedPastReviewDay` separately.
    @State private var selectedTimelineDay: Int?
    @State private var selectedPastReviewDay: Int? = Self.uiTestingInitialOfficeHoursPastDay()
    @State private var officeHoursQuestionLoadingStartedAtBySession: [String: Date] = [:]
    @State private var officeHoursSubmittedPromptSnapshotsBySession: [String: [OfficeHoursSubmittedPromptSnapshot]] = [:]
    @State private var officeHoursActiveQuestionLoadersBySession: [String: OfficeHoursLoadingSnapshot] = [:]
    @State private var officeHoursReadyPromptRevealIDs: Set<String> = []
    @State private var officeHoursRevisionInFlightSessionIDs: Set<String> = []
    @State private var officeHoursSubmittedRevisionDraftsByPrompt: [String: [String: AgenticViewModel.StructuredPromptSubmission]] = [:]
    @State private var editingOfficeHoursSubmittedFreeTextID: String?
    @State private var editingOfficeHoursSubmittedFreeTextValue = ""
    @State private var officeHoursScrollGeneration = 0
    @State private var officeHoursMainScrollCaptureAnchor: NSView?
    @State private var officeHoursSharePicker: NSSharingServicePicker?
    // Sessions whose commitment-close candidates were already requested, so the close
    // reveals (instead of waiting forever) once that one request resolves either way.
    @State private var officeHoursCommitmentCandidateRequestedSessions: Set<String> = []
    @State private var officeHoursEvidenceDraft: OfficeHoursEvidenceDraft?
    @FocusState private var focusedOfficeHoursStructuredFreeTextID: String?

    private static let officeHoursQuestionOutputRowID = "office-hours-question-output-row"
    private static let officeHoursQuestionStageTopID = "office-hours-question-stage-top"
    private static let officeHoursDocReadyHeaderID = "office-hours-doc-ready-header"
    private static let officeHoursCommitmentBarID = "opendesign.officeHours.commitmentBar"
    private static let officeHoursDay1CompleteButtonID = "opendesign.officeHours.day1.completeDay"
    private static let officeHoursTranscriptBottomID = "office-hours-transcript-bottom"
    private static let officeHoursMinimumQuestionLoadingSeconds: TimeInterval = 3

    @MainActor
    init(
        viewModel: AgenticViewModel,
        surfaceOverride: AgenticSurface? = nil,
        openWorkspaceAction: (() -> Void)? = nil,
        closeWorkspaceAction: (() -> Void)? = nil,
        zoomWorkspaceAction: (() -> Void)? = nil,
        maximizeWorkspaceOnFirstAppear: Bool = false,
        markWorkspaceInitialMaximizeApplied: (() -> Void)? = nil
    ) {
        _viewModel = ObservedObject(wrappedValue: viewModel)
        self.surfaceOverride = surfaceOverride
        self.openWorkspaceAction = openWorkspaceAction
        self.closeWorkspaceAction = closeWorkspaceAction
        self.zoomWorkspaceAction = zoomWorkspaceAction
        self.maximizeWorkspaceOnFirstAppear = maximizeWorkspaceOnFirstAppear
        self.markWorkspaceInitialMaximizeApplied = markWorkspaceInitialMaximizeApplied
        _selectedOpenDesignReferencePage = State(initialValue: Self.initialOpenDesignReferencePageForUITesting())
        _selectedSettingsSection = State(initialValue: Self.initialSettingsSectionForUITesting())
    }

    private static func initialOpenDesignReferencePageForUITesting(
        arguments: [String] = CommandLine.arguments
    ) -> OpenDesignReferencePageKind? {
        guard let rawValue = arguments
            .first(where: { $0.hasPrefix("--ui-testing-open-design-reference-page=") })?
            .split(separator: "=", maxSplits: 1)
            .last
            .map(String.init)
        else {
            return nil
        }

        return OpenDesignReferencePageKind(railItemID: rawValue)
            ?? OpenDesignReferencePageKind(searchItemID: rawValue)
            ?? OpenDesignReferencePageKind(searchItemID: "page-\(rawValue)")
            ?? OpenDesignReferencePageKind(rawValue: rawValue)
    }

    @MainActor
    private static func initialSettingsSectionForUITesting(
        arguments: [String] = CommandLine.arguments
    ) -> SettingsSection {
        let argumentName = "--ui-testing-open-settings-section"
        let rawSection: String?
        if let index = arguments.firstIndex(of: argumentName), arguments.indices.contains(index + 1) {
            rawSection = arguments[index + 1]
        } else {
            let prefix = "\(argumentName)="
            rawSection = arguments.first(where: { $0.hasPrefix(prefix) })?
                .dropFirst(prefix.count)
                .description
        }
        return rawSection.flatMap(SettingsSection.fromIdentifier) ?? .workspace
    }

    @ViewBuilder
    var body: some View {
        let content = rootContent
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
            .padding(isWorkspaceWindow ? 0 : 22)
            .background {
                if isWorkspaceWindow {
                    WorkspaceWindowChrome(
                        maximizeOnInitialInstall: maximizeWorkspaceOnFirstAppear,
                        markInitialInstallMaximizeApplied: markWorkspaceInitialMaximizeApplied,
                        style: workspaceChromeStyle
                    )
                } else {
                    WindowChrome()
                }
            }
            .onAppear {
                viewModel.start()
                syncPromptDrafts(bindingToken: viewModel.pendingStructuredPrompt?.uiBindingToken)
            }
            .onDisappear {
                if !isWorkspaceWindow {
                    viewModel.stop()
                }
            }
            .onChange(of: viewModel.pendingStructuredPrompt?.uiBindingToken) { _, bindingToken in
                syncPromptDrafts(bindingToken: bindingToken)
            }
            .onChange(of: viewModel.visibleBipCoach?.currentMission?.status) { _, status in
                if status == "completed" {
                    showsBipCompletionFields = false
                } else if isBipMissionRoutePresented, viewModel.visibleBipCoach?.currentMission != nil {
                    showsBipCompletionFields = true
                }
            }
            .onChange(of: viewModel.visibleBipCoach?.currentMission?.id) { _, _ in
                updateBipCompletionRouteFieldsIfNeeded()
            }
            .onChange(of: viewModel.selectedFoundationDay) { _, day in
                clearOpenDesignReferenceRouteIfUnsupported(dayNumber: day)
            }
            .onChange(of: viewModel.foundationCurriculumPresentationDestination) { _, destination in
                if destination == .graduation {
                    clearOpenDesignReferenceRoute()
                }
            }
            .onChange(of: viewModel.localDataResetGeneration) { _, _ in
                resetLocalSwiftUIStateAfterLocalDataReset()
            }
            .onReceive(NotificationCenter.default.publisher(for: .agenticOpenDesignSettingsRequested)) { notification in
                guard isWorkspaceWindow else { return }
                if let requestedSection = settingsSection(from: notification) {
                    selectedSettingsSection = requestedSection
                }
                openOpenDesignSettingsRoute()
            }
            .onReceive(NotificationCenter.default.publisher(for: .agenticOpenDesignRouteRequested)) { notification in
                guard isWorkspaceWindow else { return }
                openOpenDesignRoute(from: notification)
            }
            .onReceive(NotificationCenter.default.publisher(for: .agenticShowAppUpdateStatusPanelRequested)) { _ in
                guard isWorkspaceWindow else { return }
                showsAppUpdateStatusPanel = true
            }
            .onChange(of: viewModel.requiresMacOnboarding) { _, requiresOnboarding in
                if !requiresOnboarding {
                    showsAppUpdateStatusPanel = false
                }
            }
            .overlay(alignment: .topTrailing) {
                if showsAppUpdateStatusPanel {
                    appUpdateStatusPanel
                        .padding(.top, 28)
                        .padding(.trailing, 28)
                        .transition(.move(edge: .top).combined(with: .opacity))
                } else if isWorkspaceWindow,
                          !viewModel.requiresMacOnboarding,
                          let pendingVersion = viewModel.appUpdateState.lastResult.pendingUpdateVersionLabel {
                    appUpdateAvailablePill(versionLabel: pendingVersion)
                        .padding(.top, 14)
                        .padding(.trailing, 20)
                        .transition(.move(edge: .top).combined(with: .opacity))
                }
            }

        Group {
            if isWorkspaceWindow {
                content
            } else {
                content
                    .containerBackground(.clear, for: .window)
            }
        }
        .agentic30Themed()
    }

    private var isWorkspaceWindow: Bool {
        surfaceOverride == .workspace
    }

    private func settingsSection(from notification: Notification) -> SettingsSection? {
        guard let rawSection = notification.userInfo?[AgenticSettingsRouteNotification.sectionUserInfoKey] as? String else {
            return nil
        }
        return SettingsSection.fromIdentifier(rawSection)
    }

    private var appUpdateStatusPanel: some View {
        let updateState = viewModel.appUpdateState
        return HStack(alignment: .top, spacing: 12) {
            Image(systemName: updateState.isSessionActive ? "arrow.triangle.2.circlepath" : "checkmark.circle")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(updateState.isSessionActive ? Agentic30BrandColor.green : OpenDesignDayColor.muted)
                .frame(width: 24, height: 24)
                .background(
                    Circle()
                        .fill((updateState.isSessionActive ? Agentic30BrandColor.green : OpenDesignDayColor.muted).opacity(0.16))
                )

            VStack(alignment: .leading, spacing: 5) {
                Text("업데이트 상태")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(updateState.lastResult.statusText)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(updateState.isSessionActive ? Agentic30BrandColor.green : OpenDesignDayColor.fgSecondary)
                Text(updateState.lastResult.detailText)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("마지막 확인 \(updateState.lastCheckSummary)")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            .frame(maxWidth: .infinity, alignment: .leading)

            Button {
                withAnimation(.easeInOut(duration: 0.18)) {
                    showsAppUpdateStatusPanel = false
                }
            } label: {
                Image(systemName: "xmark")
                    .font(.system(size: 10.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .frame(width: 24, height: 24)
            }
            .buttonStyle(.plain)
            .accessibilityLabel("업데이트 상태 닫기")
        }
        .padding(14)
        .frame(width: 340)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(OpenDesignDayColor.surface.opacity(0.98))
                .shadow(color: Color.black.opacity(0.18), radius: 18, y: 8)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
        )
        .accessibilityIdentifier("appUpdate.statusPanel")
    }

    /// Codex-style gentle update reminder: a click-through pill shown while a
    /// new build is available/downloaded. Clicking hands off to Sparkle's
    /// user-initiated flow (install & relaunch).
    private func appUpdateAvailablePill(versionLabel: String) -> some View {
        Button {
            NotificationCenter.default.post(name: .agenticCheckForUpdatesRequested, object: nil)
        } label: {
            HStack(spacing: 6) {
                Image(systemName: "arrow.down.circle.fill")
                    .font(.system(size: 11.5, weight: .semibold))
                Text("업데이트 \(versionLabel)")
                    .font(.system(size: 11.5, weight: .semibold))
            }
            .foregroundStyle(Agentic30BrandColor.green)
            .padding(.horizontal, 11)
            .padding(.vertical, 6)
            .background(
                Capsule(style: .continuous)
                    .fill(Agentic30BrandColor.green.opacity(0.14))
            )
            .overlay(
                Capsule(style: .continuous)
                    .stroke(Agentic30BrandColor.green.opacity(0.35), lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .help("새 버전 \(versionLabel)이 준비됐습니다. 클릭하면 업데이트 상태를 확인하거나 설치합니다.")
        .accessibilityIdentifier("appUpdate.updateAvailablePill")
    }

    private var activeSurface: AgenticSurface {
        surfaceOverride ?? viewModel.activeSurface
    }

    private var rootContent: some View {
        ZStack {
            Color.clear.ignoresSafeArea()
            if viewModel.requiresMacOnboarding {
                IntakeV2FlowView(
                    bootLogState: viewModel.intakeV2BootLogState,
                    workspaceScanResult: viewModel.scanResult,
                    scanProviderLimitNotice: viewModel.scanProviderLimitNotice,
                    // Codex → Claude → Gemini → Cursor rotation; only providers the sidecar
                    // reports as connected qualify (same gate as office-hours).
                    scanProviderLimitFallback: viewModel.scanProviderLimitNotice?.provider.nextFallbackProvider { candidate in
                        officeHoursProviderEnvironment(for: candidate)?.available == true
                    },
                    onProviderLimitRescan: { provider in
                        guard let notice = viewModel.scanProviderLimitNotice,
                              !notice.scanRoot.isEmpty else { return }
                        viewModel.rescanWorkspace(root: notice.scanRoot, provider: provider)
                    },
                    scanBlockedNotice: viewModel.scanBlockedNotice,
                    onScanBlockedRescan: { provider in
                        guard let notice = viewModel.scanBlockedNotice,
                              !notice.scanRoot.isEmpty else { return }
                        viewModel.rescanWorkspace(root: notice.scanRoot, provider: provider)
                    },
                    onScanBlockedAuthAction: { readiness in
                        handleWorkspaceScanBlockedAuthAction(readiness)
                    },
                    onWorkspacePrefetchRequested: { store, sources in
                        guard let context = intakeV2OnboardingContext(from: store) else { return }
                        guard let url = store.folderURL else {
                            viewModel.prepareIntakeOnlyOnboarding(context: context)
                            return
                        }
                        viewModel.submitOnboardingContext(
                            context,
                            workspaceRoot: url.path,
                            intakeStore: store,
                            sources: sources.sources
                        )
                        viewModel.prefetchOnboardingWorkspace(url: url, context: context)
                    },
                    onComplete: { store, sources in
                        // V2 onboarding completion — review-driven redesign 2026-05-14.
                        // Maps V2 store answers into the legacy OnboardingContext schema
                        // so the rest of the routing (needsOnboardingContext, needsProjectWorkspace)
                        // settles in one shot.
                        if let url = store.folderURL {
                            WorkspaceSettings.store(url)
                            if let context = intakeV2OnboardingContext(from: store) {
                                viewModel.submitOnboardingContext(
                                    context,
                                    workspaceRoot: url.path,
                                    intakeStore: store,
                                    sources: sources.sources
                                )
                            }
                            viewModel.completeMacOnboardingIntro(openWorkspace: true)
                        } else {
                            if let context = intakeV2OnboardingContext(from: store) {
                                viewModel.submitOnboardingContext(
                                    context,
                                    intakeStore: store,
                                    sources: sources.sources
                                )
                            }
                            viewModel.completeIntakeOnlyOnboarding(openWorkspace: true)
                        }
                    }
                )
                .id(viewModel.localDataResetGeneration)
            } else if let session = viewModel.selectedSession {
                switch activeSurface {
                case .assistantBubble:
                    assistantPresentation(for: session)
                case .workspace:
                    agenticWorkspace(for: session)
                }
            } else if activeSurface == .workspace {
                workspacePreparingSurface()
            } else {
                compactPlaceholder(
                    title: "Preparing assistant",
                    subtitle: "Starting a new session"
                )
            }
        }
    }

    private func intakeV2OnboardingContext(from store: IntakeV2Store) -> OnboardingContext? {
        IntakeV2OnboardingContextMapper.makeContext(from: store)
    }

    @ViewBuilder
    private func workspacePreparingSurface() -> some View {
        openDesignDaySurface(day: workspaceOpenDesignDay, session: nil)
    }

    private func assistantPresentation(for session: ChatSession) -> some View {
        HStack(alignment: .top, spacing: 14) {
            assistantAvatarButton(size: 42)
                .padding(.top, 8)

            assistantBubbleShell(for: session)
        }
        .animation(.spring(response: 0.32, dampingFraction: 0.86), value: viewModel.presentationPhase)
    }

    private var workspaceOpenDesignDay: AgenticCurriculumDay {
        let dayNumber = OpenDesignWorkspaceDayResolver.dayNumber(
            selectedDay: viewModel.selectedFoundationDay,
            completedDays: viewModel.foundationProgressState.completedDays
        )
        return AgenticCurriculumDay.days.first(where: { $0.day == dayNumber }) ?? AgenticCurriculumDay.days[0]
    }

    private var workspaceChromeStyle: WorkspaceChromeStyle {
        WorkspaceChromeStyle.resolve(
            isWorkspaceWindow: isWorkspaceWindow,
            dayNumber: workspaceOpenDesignDay.day,
            selectedReferencePage: selectedOpenDesignReferencePage,
            isOfficeHoursPresented: isOpenDesignOfficeHoursPresented
        )
    }

    private func curriculumPayload(for day: AgenticCurriculumDay) -> [String: Any] {
        [
            "day": day.day,
            "phase": day.phase.rawValue,
            "phaseTitle": day.phase.title,
            "title": day.title,
            "shortTitle": day.shortTitle,
            "summary": day.summary,
            "tasks": day.tasks,
            "output": day.output,
        ]
    }

    @ViewBuilder
    private func openDesignDaySurface(day: AgenticCurriculumDay, session: ChatSession?) -> some View {
        let personalizedDay1Content = OpenDesignDayContent.personalizedIfAvailable(
            from: viewModel.scanResult?.day1AlignmentPlan,
            fallback: viewModel.scanResult?.day1IcpPlan
        )
        let shouldUseIntakeOnlyDay1 = day.day == 1
            && !viewModel.isScanning
            && (viewModel.workspaceRoot.isEmpty || viewModel.scanResult?.error?.nonEmpty != nil)
        let day1Content = personalizedDay1Content ?? (day.day == 1 || shouldUseIntakeOnlyDay1 ? OpenDesignDayContent.day1 : nil)
        let officeHoursDay1Content = (personalizedDay1Content ?? OpenDesignDayContent.day1)
            .applyingFoundationProgress(viewModel.foundationProgressState, selectedDay: 1)
            .lockingDaysAfterSecond
        let resolvedContent: OpenDesignDayContent? = (day.day == 2 ? OpenDesignDayContent.day2 : day1Content)?
            .applyingFoundationProgress(viewModel.foundationProgressState, selectedDay: day.day)
            .lockingDaysAfterSecond
        let bipResearchDayNumber = viewModel.foundationProgressState.currentDayNumber() ?? 1
        let bipResearchDay = AgenticCurriculumDay.days.first(where: { $0.day == bipResearchDayNumber })
            ?? AgenticCurriculumDay.days[0]
        let bipResearchCurriculum = curriculumPayload(for: bipResearchDay)
        let day1HandoffPrompt = viewModel.activeDay1HandoffPrompt
        let day1HandoffPromptCard = day1HandoffPrompt.map { prompt in
            AnyView(inlineStructuredPrompt(prompt, submissionState: submissionState(for: prompt)))
        }
        let situationSummary = isWorkspaceWindow && day.day == 1 ? viewModel.scanResult?.day1SituationSummary : nil
        let officeHoursActiveDay = activeOfficeHoursDay(fallback: day.day)
        let officeHoursSession = viewModel.officeHoursSession(forDay: officeHoursActiveDay)
            ?? session.flatMap { candidate in
                viewModel.canUseSessionForOfficeHours(candidate, day: officeHoursActiveDay) ? candidate : nil
            }
        let officeHoursScreen: (Bool) -> AnyView = { isMetaPanelExpanded in
            AnyView(
                openDesignOfficeHoursScreenView(
                    conversationSession: officeHoursSession,
                    testSession: session,
                    day1Content: officeHoursDay1Content,
                    activeDay: officeHoursActiveDay,
                    isMetaPanelExpanded: isMetaPanelExpanded
                )
            )
        }
        let shareOfficeHoursScreenshot: (NSView?) -> Void = { anchorView in
            shareOpenDesignOfficeHoursScreenshot(
                anchorView: anchorView,
                activeDay: officeHoursActiveDay
            )
        }
        let content = ZStack {
            if isBipMissionRoutePresented {
                bipMissionWorkspaceSurface()
            } else if let resolvedContent {
                OpenDesignDayPageView(
                    content: resolvedContent,
                    interaction: openDesignDayInteractionBinding(for: day, content: resolvedContent),
                    selectedReferencePage: $selectedOpenDesignReferencePage,
                    isOfficeHoursPresented: $isOpenDesignOfficeHoursPresented,
                    isMorningBriefingPresented: $isOpenDesignMorningBriefingPresented,
                    openSettings: {
                        openOpenDesignSettingsRoute()
                    },
                    settingsScreen: AnyView(
                        SettingsView(
                            viewModel: viewModel,
                            embeddedInWorkspace: true,
                            selectedSection: $selectedSettingsSection
                        )
                        .tint(Agentic30BrandColor.green)
                    ),
                    requiresDay1Goal: day.day == 1,
                    day1GoalDrafts: day.day == 1 ? viewModel.day1GoalDrafts : [],
                    day1GoalSelection: day.day == 1 ? viewModel.day1GoalSelection : nil,
                    day1GoalError: day.day == 1 ? viewModel.day1GoalError : nil,
                    bipProofSinkAvailable: viewModel.isDay1BipProofSinkAvailable,
                    saveDay1GoalDraft: { draft in
                        _ = viewModel.saveDay1GoalDraft(draft, workspaceRoot: openDesignInteractionWorkspaceRoot)
                    },
                    submitStructuredPromptChoice: { choice in
                        submitOpenDesignDayChoice(choice, day: day, session: session)
                    },
                    newsMarketRadar: viewModel.newsMarketRadar,
                    refreshNewsMarketRadar: {
                        viewModel.refreshNewsMarketRadar(reason: "manual", force: true)
                    },
                    prepareNewsMarketRadar: {
                        viewModel.prepareNewsMarketRadarForDisplay()
                    },
                    bipResearch: viewModel.bipResearch,
                    refreshBipResearch: {
                        viewModel.refreshBipResearch(
                            reason: "manual",
                            force: true,
                            dayNumber: bipResearchDay.day,
                            curriculumDay: bipResearchCurriculum
                        )
                    },
                    prepareBipResearch: {
                        viewModel.prepareBipResearchForDisplay(curriculumDay: bipResearchCurriculum)
                    },
                    openNewsSettings: {
                        openOpenDesignSettingsRoute()
                    },
                    workHistory: viewModel.workHistory,
                    refreshWorkHistory: {
                        viewModel.refreshWorkHistory(reason: "manual")
                    },
                    prepareWorkHistory: {
                        viewModel.prepareWorkHistoryForDisplay()
                    },
                    day1DocPreviews: viewModel.iddDocPreviews,
                    day1HandoffPromptCard: day1HandoffPromptCard,
                    officeHoursScreen: officeHoursScreen,
                    shareOfficeHoursScreenshot: shareOfficeHoursScreenshot,
                    morningBriefingScreen: AnyView(
                        MorningBriefingPageView(
                            briefing: viewModel.morningBriefing,
                            previousBriefing: viewModel.morningBriefingPrevious,
                            collecting: viewModel.morningBriefingCollecting,
                            sourceProgress: viewModel.morningBriefingSourceProgress,
                            fallbackDay: officeHoursActiveDay,
                            refresh: {
                                viewModel.refreshMorningBriefing(reason: "manual")
                            },
                            prepare: {
                                viewModel.prepareMorningBriefingForDisplay()
                            },
                            submitAnomalyLabel: { label in
                                viewModel.submitMorningBriefingAnomalyLabel(label)
                            },
                            applyAction: { draft in
                                viewModel.draft = draft.copyText ?? ""
                            },
                            startToday: {
                                withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                                    isOpenDesignMorningBriefingPresented = false
                                }
                            }
                        )
                    ),
                    activeDay1HandoffDocType: day1HandoffPrompt?.generation?.docType?.lowercased(),
                    pendingDay1HandoffDocType: viewModel.day1DocHandoffPendingDocType,
                    day1HandoffError: viewModel.day1DocHandoffError,
                    day1SituationSummary: situationSummary,
                    onChooseDay1SituationGoal: { goal in
                        viewModel.submitDay1SituationGoal(goal)
                    },
                    startDay1DocHandoff: { docType, handoff in
                        viewModel.startDay1DocHandoff(docType: docType, day1Handoff: handoff)
                    },
                    completeDay: {
                        _ = viewModel.markFoundationDayCompleted(day.day)
                    },
                    advanceToNextDay: {
                        advanceOpenDesignDay(from: day)
                    },
                    selectDay: { selectedDay in
                        guard OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: selectedDay),
                              viewModel.isFoundationDayUnlocked(selectedDay) else { return }
                        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                            clearOpenDesignReferenceRoute()
                            isOpenDesignOfficeHoursPresented = false
                            viewModel.selectFoundationDay(selectedDay)
                        }
                    },
                    routesTodayToOfficeHours: day.day == 1
                )
            } else {
                OpenDesignDayPlanPreparingView(
                    isScanning: viewModel.isScanning,
                    progressMessage: viewModel.scanProgressMessage.nonEmpty,
                    scanError: viewModel.scanResult?.error?.nonEmpty,
                    sidecarFailureMessage: viewModel.sidecarFailureMessage?.nonEmpty
                )
            }
        }

        if isWorkspaceWindow {
            let workspaceSurface = content
                .frame(maxWidth: .infinity, maxHeight: .infinity)
                .background(OpenDesignDayColor.bg)
            if isBipMissionRoutePresented {
                workspaceSurface
            } else {
                workspaceSurface
                    .accessibilityIdentifier("workspace.surface")
            }
        } else {
            let previewSurface = content
                .frame(width: 1136, height: 716)
                .background(OpenDesignDayColor.bg)
                .clipShape(RoundedRectangle(cornerRadius: 28, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 28, style: .continuous)
                        .stroke(Color.white.opacity(0.12), lineWidth: 1)
                )
            if isBipMissionRoutePresented {
                previewSurface
            } else {
                previewSurface
                    .accessibilityIdentifier("workspace.surface")
            }
        }
    }

    private func openDesignOfficeHoursScreenView(
        conversationSession: ChatSession?,
        testSession: ChatSession?,
        day1Content: OpenDesignDayContent,
        activeDay: Int,
        isMetaPanelExpanded: Bool
    ) -> some View {
        GeometryReader { proxy in
            let layout = OfficeHoursScreenLayout(
                width: proxy.size.width,
                isMetaPanelExpanded: isMetaPanelExpanded
            )
            let bannerPresentation = OfficeHoursBannerPresentation.resolve(
                memory: viewModel.officeHoursMemory,
                evidenceOS: viewModel.evidenceOS,
                intervention: viewModel.ohInterventionRequired
            )
            HStack(spacing: 0) {
                if layout.showsSessions {
                    officeHoursSessionsSidebar(session: conversationSession, activeDay: activeDay)
                        .frame(width: layout.sessionsWidth)
                }

                VStack(spacing: 0) {
                    officeHoursMemoryBanner(presentation: bannerPresentation)
                    officeHoursEvidenceOSBanner(
                        presentation: bannerPresentation,
                        session: conversationSession,
                        day1Content: day1Content,
                        activeDay: activeDay
                    )
                    officeHoursSourceGateBanner(activeDay: activeDay)
                    officeHoursGateBlockedBanner()
                    officeHoursInterventionBanner(
                        presentation: bannerPresentation,
                        session: conversationSession,
                        day1Content: day1Content,
                        activeDay: activeDay
                    )
                    officeHoursMissionCardBanner()
                    officeHoursMainColumn(
                        session: conversationSession,
                        day1Content: day1Content,
                        activeDay: activeDay,
                        layout: layout
                    )
                    .frame(maxWidth: .infinity, maxHeight: .infinity)
                }
                .frame(maxWidth: .infinity, maxHeight: .infinity)

                if layout.showsMeta {
                    officeHoursMetaPanel(session: conversationSession, activeDay: activeDay)
                        .frame(width: layout.metaWidth)
                }
            }
            .frame(width: proxy.size.width, height: proxy.size.height, alignment: .topLeading)
            .background(OpenDesignOfficeHoursColor.bg)
        }
        .onAppear {
            viewModel.ensureOfficeHoursSession(forDay: activeDay)
            refreshOfficeHoursSourceGateIfNeeded(day: activeDay, session: conversationSession)
        }
        .onChange(of: viewModel.isConnected) { _, _ in
            viewModel.ensureOfficeHoursSession(forDay: activeDay)
            continuePendingOfficeHoursStart(session: conversationSession, day1Content: day1Content, day: activeDay)
        }
        .onChange(of: activeDay) { _, day in
            viewModel.ensureOfficeHoursSession(forDay: day)
            reconcileOfficeHoursActiveQuestionLoader(session: conversationSession)
            refreshOfficeHoursSourceGateIfNeeded(day: day, session: conversationSession)
            continuePendingOfficeHoursStart(session: conversationSession, day1Content: day1Content, day: day)
        }
        .onChange(of: conversationSession?.id) { _, _ in
            reconcileOfficeHoursActiveQuestionLoader(session: conversationSession)
            refreshOfficeHoursSourceGateIfNeeded(day: activeDay, session: conversationSession)
            continuePendingOfficeHoursStart(session: conversationSession, day1Content: day1Content, day: activeDay)
        }
        .onChange(of: conversationSession?.status) { _, _ in
            reconcileOfficeHoursActiveQuestionLoader(session: conversationSession)
            continuePendingOfficeHoursStart(session: conversationSession, day1Content: day1Content, day: activeDay)
        }
        .onChange(of: conversationSession?.pendingUserInput?.requestId) { _, _ in
            reconcileOfficeHoursActiveQuestionLoader(session: conversationSession)
        }
        .onChange(of: conversationSession?.error) { _, _ in
            reconcileOfficeHoursActiveQuestionLoader(session: conversationSession)
        }
        .sheet(item: $officeHoursEvidenceDraft) { draft in
            OfficeHoursEvidenceResolutionSheet(
                draft: draft,
                onSubmitEvidence: { kind, locator, note in
                    _ = viewModel.submitOfficeHoursCommitmentEvidence(
                        commitmentId: draft.commitment.id,
                        kind: kind,
                        url: locator,
                        note: note
                    )
                    officeHoursEvidenceDraft = nil
                },
                onAbandon: { reason in
                    _ = viewModel.abandonOfficeHoursCommitment(
                        commitmentId: draft.commitment.id,
                        reason: reason
                    )
                    officeHoursEvidenceDraft = nil
                },
                onCancel: {
                    officeHoursEvidenceDraft = nil
                }
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.screen")
    }

    // Cycle#N retro read-back surface: the compiled thesis + the abandoned-thread /
    // costume line, in the "smart friend who remembers" voice (not a scoreboard).
    // Hidden on a cold/stub brain (hasContent == false) so screenshots stay stable.
    @ViewBuilder
    private func officeHoursMemoryBanner(presentation: OfficeHoursBannerPresentation) -> some View {
        if presentation.showMemoryBanner,
           let memory = viewModel.officeHoursMemory,
           memory.hasContent {
            VStack(alignment: .leading, spacing: 6) {
                if let truth = memory.compiledTruth, !truth.isEmpty {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "clock.arrow.circlepath")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                        Text(truth)
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let costume = memory.abandonedThreads.first {
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 12))
                            .foregroundStyle(.orange)
                        Text(costume)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(.orange)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                if let calibration = memory.calibrationLine, !calibration.isEmpty {
                    // calibration-lite read-back: "예측 적중 N/M" (gbrain recall-footer analog).
                    HStack(alignment: .top, spacing: 8) {
                        Image(systemName: "scope")
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                        Text(calibration)
                            .font(.system(size: 12))
                            .foregroundStyle(.secondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .accessibilityIdentifier("opendesign.officeHours.calibrationLine")
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(Color.primary.opacity(0.03))
            .overlay(alignment: .bottom) {
                Rectangle().fill(Color.primary.opacity(0.06)).frame(height: 1)
            }
            .accessibilityIdentifier("opendesign.officeHours.memoryBanner")
        }
    }

    @ViewBuilder
    private func officeHoursEvidenceOSBanner(
        presentation: OfficeHoursBannerPresentation,
        session: ChatSession?,
        day1Content: OpenDesignDayContent,
        activeDay: Int
    ) -> some View {
        if presentation.showEvidenceOSBanner,
           let evidenceOS = viewModel.evidenceOS,
           evidenceOS.hasOpenDebt {
            let debts = evidenceOS.overdueDebts.isEmpty ? evidenceOS.openDebts : evidenceOS.overdueDebts
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(spacing: 9) {
                        Image(systemName: "checklist.unchecked")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                            .frame(width: 22, height: 22)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(OpenDesignOfficeHoursColor.amberDim)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                                            .stroke(OpenDesignOfficeHoursColor.amber.opacity(0.38), lineWidth: 1)
                                    )
                            )
                        Text(evidenceOS.overdueDebts.isEmpty ? "약속 증거 대기" : "기한 지난 약속 증거")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                            .lineLimit(1)
                        if let dayLabel = officeHoursEvidenceBannerDayLabel(for: debts.first) {
                            officeHoursEvidenceBannerHeaderPill(dayLabel)
                        }
                        Spacer(minLength: 8)
                        Text("\(evidenceOS.openDebts.count) open")
                            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                            .lineLimit(1)
                            .fixedSize(horizontal: true, vertical: false)
                    }
                    ForEach(Array(debts.prefix(2))) { debt in
                        officeHoursEvidenceDebtRow(debt)
                    }
                    if presentation.showInlineScheduledIntervention,
                       let intervention = viewModel.ohInterventionRequired {
                        officeHoursInlineScheduledInterventionRow(
                            intervention: intervention,
                            session: session,
                            day1Content: day1Content,
                            activeDay: activeDay
                        )
                    }
                }
                .padding(.leading, 20)
                .padding(.trailing, 18)
                .padding(.vertical, 14)
                .frame(maxWidth: 820, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.surface)
                        .overlay(
                            LinearGradient(
                                colors: [
                                    OpenDesignOfficeHoursColor.amber.opacity(0.10),
                                    OpenDesignOfficeHoursColor.amber.opacity(0.02),
                                    Color.clear,
                                ],
                                startPoint: .topLeading,
                                endPoint: .bottomTrailing
                            )
                            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                        )
                )
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(OpenDesignOfficeHoursColor.accent)
                        .frame(width: 3)
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 28)
            .padding(.vertical, 14)
            .background(OpenDesignOfficeHoursColor.bg)
            .overlay(alignment: .bottom) {
                Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1)
            }
            .accessibilityIdentifier("opendesign.officeHours.evidenceOSBanner")
        }
    }

    @ViewBuilder
    private func officeHoursSourceGateBanner(activeDay: Int) -> some View {
        if activeDay >= 2,
           let gate = viewModel.officeHoursSourceGate,
           gate.applies(to: activeDay),
           gate.blocking {
            VStack(spacing: 0) {
                VStack(alignment: .leading, spacing: 12) {
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "link.badge.plus")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                            .frame(width: 24, height: 24)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(OpenDesignOfficeHoursColor.amberDim)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                                            .stroke(OpenDesignOfficeHoursColor.amber.opacity(0.38), lineWidth: 1)
                                    )
                            )
                        VStack(alignment: .leading, spacing: 3) {
                            Text("Day 2+ source 연결 필요")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                            Text(gate.message.nonEmpty ?? "git, gh CLI, PostHog, Cloudflare 중 하나 이상이 필요합니다.")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                        Spacer(minLength: 0)
                    }

                    VStack(spacing: 6) {
                        ForEach(gate.connectActions.prefix(4)) { action in
                            HStack(spacing: 8) {
                                Circle()
                                    .fill(OpenDesignOfficeHoursColor.amber)
                                    .frame(width: 5, height: 5)
                                Text(action.label)
                                    .font(.system(size: 11.5, weight: .semibold))
                                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                                Text(action.detail)
                                    .font(.system(size: 11.5, weight: .medium))
                                    .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                                    .lineLimit(1)
                                    .truncationMode(.tail)
                                Spacer(minLength: 0)
                            }
                        }
                    }

                    HStack(spacing: 8) {
                        Button {
                            selectedSettingsSection = .integrations
                            openOpenDesignSettingsRoute()
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "slider.horizontal.3")
                                    .font(.system(size: 11, weight: .semibold))
                                Text("연동 설정")
                            }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(OpenDesignOfficeHoursColor.bgDeep)
                            .padding(.horizontal, 12)
                            .frame(height: 30)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(OpenDesignOfficeHoursColor.accent)
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("opendesign.officeHours.sourceGate.settings")

                        Button {
                            refreshOfficeHoursSourceGateIfNeeded(
                                day: activeDay,
                                session: viewModel.officeHoursSession(forDay: activeDay)
                            )
                        } label: {
                            HStack(spacing: 6) {
                                Image(systemName: "arrow.clockwise")
                                    .font(.system(size: 11, weight: .semibold))
                                Text("다시 확인")
                            }
                            .font(.system(size: 12, weight: .semibold))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                            .padding(.horizontal, 12)
                            .frame(height: 30)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(OpenDesignOfficeHoursColor.bgDarker)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                                    )
                            )
                        }
                        .buttonStyle(.plain)
                        .accessibilityIdentifier("opendesign.officeHours.sourceGate.refresh")
                    }
                }
                .padding(.leading, 20)
                .padding(.trailing, 18)
                .padding(.vertical, 14)
                .frame(maxWidth: 820, alignment: .leading)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.surface)
                )
                .overlay(alignment: .leading) {
                    Rectangle()
                        .fill(OpenDesignOfficeHoursColor.amber)
                        .frame(width: 3)
                }
                .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
                )
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 28)
            .padding(.top, 12)
            .padding(.bottom, 10)
            .background(OpenDesignOfficeHoursColor.bg)
            .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)
            .accessibilityIdentifier("opendesign.officeHours.sourceGateBanner")
        }
    }

    @ViewBuilder
    private func officeHoursDailyDigestBanner(activeDay: Int) -> some View {
        if activeDay >= 2 {
            if viewModel.officeHoursDailyDigestCollecting {
                HStack(spacing: 8) {
                    Image(systemName: "arrow.triangle.2.circlepath")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                    Text("어제/간밤 신호 수집 중 — git · GitHub · PostHog · Cloudflare")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 10)
                .background(OpenDesignOfficeHoursColor.bg)
                .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)
                .accessibilityIdentifier("opendesign.officeHours.dailyDigest.collecting")
            } else if let digest = viewModel.officeHoursDailyDigest,
                      digest.applies(to: activeDay),
                      let briefing = digest.briefing,
                      officeHoursDigestBannerDismissedKey != officeHoursDailyDigestIdentity(digest, activeDay: activeDay) {
                let buildEscape = digest.buildWithoutCustomerEvidence == true
                let accentColor = buildEscape
                    ? OpenDesignOfficeHoursColor.amber
                    : OpenDesignOfficeHoursColor.accent
                let isCollapsed = officeHoursDigestBannerCollapsed
                VStack(spacing: 0) {
                    VStack(alignment: .leading, spacing: 10) {
                        HStack(alignment: .top, spacing: 10) {
                            Image(systemName: "sunrise")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(accentColor)
                                .frame(width: 24, height: 24)
                                .background(
                                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                                        .fill(accentColor.opacity(0.14))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                                .stroke(accentColor.opacity(0.38), lineWidth: 1)
                                        )
                                )
                            VStack(alignment: .leading, spacing: 3) {
                                Text("어제/간밤 브리핑")
                                    .font(.system(size: 13, weight: .semibold))
                                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                                if isCollapsed, buildEscape {
                                    Text("코드 변경은 있지만 고객 행동 증거가 아직 없습니다.")
                                        .font(.system(size: 11.5, weight: .semibold))
                                        .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                                } else if let startDate = digest.window?.localStartDate?.nonEmpty {
                                    Text("\(startDate) 00:00부터 지금까지")
                                        .font(.system(size: 11.5, weight: .medium))
                                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                                }
                            }
                            Spacer(minLength: 0)
                            HStack(spacing: 10) {
                                ForEach(digest.sources.filter { $0.state != "ignored" }) { source in
                                    HStack(spacing: 5) {
                                        Circle()
                                            .fill(
                                                source.state == "ready"
                                                    ? OpenDesignOfficeHoursColor.accent
                                                    : OpenDesignOfficeHoursColor.rose
                                            )
                                            .frame(width: 5, height: 5)
                                        Text(source.label)
                                            .font(.system(size: 10.5, weight: .semibold))
                                            .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                                    }
                                }
                            }
                            .frame(height: 24)
                            HStack(spacing: 2) {
                                Button {
                                    toggleOfficeHoursDigestBannerCollapsed()
                                } label: {
                                    Image(systemName: isCollapsed ? "chevron.down" : "chevron.up")
                                        .font(.system(size: 10, weight: .semibold))
                                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                                        .frame(width: 24, height: 24)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .help(isCollapsed ? "브리핑 펼치기" : "브리핑 접기")
                                .accessibilityIdentifier("opendesign.officeHours.dailyDigest.collapseToggle")

                                Button {
                                    officeHoursDigestBannerDismissedKey =
                                        officeHoursDailyDigestIdentity(digest, activeDay: activeDay)
                                } label: {
                                    Image(systemName: "xmark")
                                        .font(.system(size: 9.5, weight: .semibold))
                                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                                        .frame(width: 24, height: 24)
                                        .contentShape(Rectangle())
                                }
                                .buttonStyle(.plain)
                                .help("닫기 — 새 브리핑이 도착하면 다시 표시됩니다")
                                .accessibilityIdentifier("opendesign.officeHours.dailyDigest.dismiss")
                            }
                        }
                        .contentShape(Rectangle())
                        .onTapGesture { toggleOfficeHoursDigestBannerCollapsed() }

                        if !isCollapsed {
                            if buildEscape {
                                HStack(spacing: 8) {
                                    Image(systemName: "exclamationmark.triangle.fill")
                                        .font(.system(size: 10.5, weight: .semibold))
                                        .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                                    Text("코드 변경은 있지만 고객 행동 증거가 아직 없습니다.")
                                        .font(.system(size: 11.5, weight: .semibold))
                                        .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                                    Spacer(minLength: 0)
                                }
                            }

                            officeHoursDigestSection(
                                "어제/간밤에 바뀐 것",
                                lines: briefing.overnightChanges ?? [],
                                limit: 4
                            )
                            officeHoursDigestSection(
                                "목표에 도움 되는 신호",
                                lines: briefing.goalHelpfulSignals ?? [],
                                limit: 3
                            )
                            officeHoursDigestSection(
                                "가장 큰 증거 공백",
                                lines: briefing.biggestEvidenceGap ?? [],
                                limit: 2,
                                bulletColor: OpenDesignOfficeHoursColor.amber
                            )
                        }
                    }
                    .padding(.leading, 20)
                    .padding(.trailing, 12)
                    .padding(.vertical, isCollapsed ? 9 : 13)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .fill(OpenDesignOfficeHoursColor.surface)
                    )
                    .overlay(alignment: .leading) {
                        Rectangle()
                            .fill(accentColor)
                            .frame(width: 3)
                    }
                    .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
                    )
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.horizontal, 28)
                .padding(.top, 12)
                .padding(.bottom, 10)
                .background(OpenDesignOfficeHoursColor.bg)
                .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)
                .accessibilityIdentifier("opendesign.officeHours.dailyDigestBanner")
            }
        }
    }

    @ViewBuilder
    private func officeHoursDigestSection(
        _ title: String,
        lines: [String],
        limit: Int,
        bulletColor: Color = OpenDesignOfficeHoursColor.mutedDeep
    ) -> some View {
        if !lines.isEmpty {
            VStack(alignment: .leading, spacing: 5) {
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                ForEach(Array(lines.prefix(limit).enumerated()), id: \.offset) { _, line in
                    HStack(alignment: .top, spacing: 8) {
                        Circle()
                            .fill(bulletColor)
                            .frame(width: 4, height: 4)
                            .padding(.top, 5)
                        Text(line)
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    /// "day#localStartDate" — stable for re-renders of the same daily digest,
    /// changes when the next day's (or a re-synced window's) digest arrives so a
    /// dismissed banner comes back with fresh content.
    private func officeHoursDailyDigestIdentity(_ digest: OfficeHoursDailyDigest, activeDay: Int) -> String {
        "\(digest.day ?? activeDay)#\(digest.window?.localStartDate ?? digest.generatedAt ?? "")"
    }

    private func toggleOfficeHoursDigestBannerCollapsed() {
        withAnimation(reduceMotion ? nil : .easeInOut(duration: 0.18)) {
            officeHoursDigestBannerCollapsed.toggle()
        }
    }

    private func officeHoursEvidenceBannerHeaderPill(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
            .foregroundStyle(OpenDesignOfficeHoursColor.accent)
            .padding(.horizontal, 8)
            .frame(height: 20)
            .background(Capsule().fill(OpenDesignOfficeHoursColor.accentDim))
            .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1))
            .lineLimit(1)
            .fixedSize(horizontal: true, vertical: false)
    }

    private func officeHoursEvidenceBannerDayLabel(for debt: CommitmentRecord?) -> String? {
        guard let debt else { return nil }
        if debt.day > 0 {
            return "Day \(debt.day)"
        }
        if let due = debt.dueDay {
            return "Day \(due)"
        }
        return nil
    }

    private func officeHoursInlineScheduledInterventionRow(
        intervention: SidecarEvent.OhInterventionRequired,
        session: ChatSession?,
        day1Content: OpenDesignDayContent,
        activeDay: Int
    ) -> some View {
        HStack(alignment: .center, spacing: 8) {
            Image(systemName: "bell.badge")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                .frame(width: 18, height: 18)
            Text("다음 브리핑")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(OpenDesignOfficeHoursColor.muted)
            if let triggerLabel = intervention.ruleId ?? intervention.gateId {
                Text(triggerLabel)
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                    .padding(.horizontal, 6)
                    .frame(height: 18)
                    .background(Capsule().fill(OpenDesignOfficeHoursColor.amberDim))
                    .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.amber.opacity(0.34), lineWidth: 1))
            }
            if let firstQuestion = intervention.questions?.first?.nonEmpty {
                Text(firstQuestion)
                    .font(.system(size: 11.5, weight: .medium))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                    .lineLimit(1)
                    .truncationMode(.tail)
                    .layoutPriority(1)
            }
            Spacer(minLength: 8)
            Button {
                startOfficeHours(
                    mode: selectedOfficeHoursMode,
                    session: session,
                    day1Content: day1Content,
                    day: intervention.day ?? activeDay,
                    trigger: intervention.triggerId
                )
            } label: {
                HStack(spacing: 5) {
                    Text("Office Hours에서 다루기")
                        .font(.system(size: 10.5, weight: .semibold))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 9.5, weight: .semibold))
                }
                .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                .padding(.horizontal, 9)
                .frame(height: 26)
                .background(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.bgDeep)
                        .overlay(
                            RoundedRectangle(cornerRadius: 6, style: .continuous)
                                .stroke(OpenDesignOfficeHoursColor.amber.opacity(0.34), lineWidth: 1)
                        )
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("opendesign.officeHours.evidenceOS.inlineIntervention.start")
        }
        .padding(.top, 2)
        .padding(.horizontal, 10)
        .frame(maxWidth: .infinity, minHeight: 34, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(OpenDesignOfficeHoursColor.amberDim.opacity(0.62))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.amber.opacity(0.22), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.evidenceOS.inlineIntervention")
    }

    private func officeHoursEvidenceDebtRow(_ debt: CommitmentRecord) -> some View {
        ViewThatFits(in: .horizontal) {
            HStack(alignment: .bottom, spacing: 14) {
                officeHoursEvidenceDebtCopy(debt)
                    .layoutPriority(1)
                Spacer(minLength: 12)
                officeHoursEvidenceBannerActions(for: debt)
                    .fixedSize(horizontal: true, vertical: false)
            }

            VStack(alignment: .leading, spacing: 10) {
                officeHoursEvidenceDebtCopy(debt)
                officeHoursEvidenceBannerActions(for: debt)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.evidenceOS.debt.\(debt.id)")
    }

    private func officeHoursEvidenceDebtCopy(_ debt: CommitmentRecord) -> some View {
        VStack(alignment: .leading, spacing: 7) {
            HStack(spacing: 6) {
                if let customer = debt.customer.nonEmpty {
                    officeHoursPastDayChip(customer, tone: "success")
                }
                if let evidence = debt.expectedEvidenceKind.nonEmpty {
                    officeHoursPastDayChip("증거 \(evidence)", tone: "warning")
                }
                if let due = debt.dueDay {
                    officeHoursPastDayChip("Day \(due)까지", tone: "muted")
                }
            }
            Text(officeHoursEvidenceActionText(for: debt))
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                .fixedSize(horizontal: false, vertical: true)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func officeHoursEvidenceActionText(for debt: CommitmentRecord) -> String {
        let message = debt.message.nonEmpty ?? debt.text
        if let customer = debt.customer.nonEmpty,
           let channel = debt.channel.nonEmpty,
           let coreMessage = debt.message.nonEmpty {
            return "\(customer)에게 \(channel)으로 \(coreMessage)"
        }
        if let customer = debt.customer.nonEmpty,
           let coreMessage = debt.message.nonEmpty {
            return "\(customer)에게 \(coreMessage)"
        }
        return message
    }

    private func officeHoursEvidenceBannerActions(for debt: CommitmentRecord) -> some View {
        let isOverdue = viewModel.evidenceOS?.overdueDebts.contains(where: { $0.id == debt.id }) == true
        return HStack(spacing: 8) {
            officeHoursEvidenceBannerActionButton(
                systemName: "paperclip",
                title: "증거 붙이기",
                accessibilityID: "attach",
                tone: isOverdue ? .primary : .secondary
            ) {
                officeHoursEvidenceDraft = OfficeHoursEvidenceDraft(commitment: debt, mode: .evidence)
            }
            officeHoursEvidenceBannerActionButton(
                systemName: "arrow.forward.circle",
                title: "목표에 반영",
                accessibilityID: "carry",
                tone: isOverdue ? .secondary : .primary
            ) {
                _ = viewModel.carryForwardOfficeHoursCommitment(commitmentId: debt.id)
            }
            officeHoursEvidenceBannerActionButton(
                systemName: "xmark.circle",
                title: "제외",
                accessibilityID: "abandon",
                tone: .quiet
            ) {
                officeHoursEvidenceDraft = OfficeHoursEvidenceDraft(commitment: debt, mode: .abandon)
            }
        }
        .frame(maxWidth: .infinity, alignment: .trailing)
    }

    private func officeHoursEvidenceBannerActionButton(
        systemName: String,
        title: String,
        accessibilityID: String,
        tone: OfficeHoursEvidenceBannerActionTone,
        action: @escaping () -> Void
    ) -> some View {
        let fill: Color
        let stroke: Color
        let foreground: Color
        switch tone {
        case .primary:
            fill = OpenDesignOfficeHoursColor.accentDim
            stroke = OpenDesignOfficeHoursColor.accentLine
            foreground = OpenDesignOfficeHoursColor.accent
        case .secondary:
            fill = OpenDesignOfficeHoursColor.bgDeep
            stroke = OpenDesignOfficeHoursColor.borderSoft
            foreground = OpenDesignOfficeHoursColor.fg
        case .quiet:
            fill = OpenDesignOfficeHoursColor.bgDeep.opacity(0.72)
            stroke = OpenDesignOfficeHoursColor.borderSoft.opacity(0.78)
            foreground = OpenDesignOfficeHoursColor.fgSecondary
        }

        return Button(action: action) {
            HStack(spacing: 5) {
                Image(systemName: systemName)
                    .font(.system(size: 11, weight: .semibold))
                Text(title)
                    .font(.system(size: 11, weight: .semibold))
                    .lineLimit(1)
            }
            .foregroundStyle(foreground)
            .padding(.horizontal, 10)
            .frame(height: 28)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(fill)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(stroke, lineWidth: 1)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 6, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityIdentifier("opendesign.officeHours.evidenceOS.\(accessibilityID)")
    }

    private func officeHoursEvidenceActionButton(systemName: String, title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            HStack(spacing: 4) {
                Image(systemName: systemName)
                    .font(.system(size: 11, weight: .semibold))
                Text(title)
                    .font(.system(size: 10.5, weight: .semibold))
            }
            .foregroundStyle(OpenDesignOfficeHoursColor.fg)
            .padding(.horizontal, 8)
            .frame(height: 26)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(OpenDesignOfficeHoursColor.bgDeep)
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                )
            )
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .combine)
        .accessibilityLabel(title)
        .accessibilityIdentifier("opendesign.officeHours.evidenceOS.\(officeHoursEvidenceActionID(for: title))")
    }

    private func officeHoursEvidenceActionID(for title: String) -> String {
        switch title {
        case "증거": return "attach"
        case "이월": return "carry"
        case "포기": return "abandon"
        default: return title
        }
    }

    // The PB-1 forcing surface: when the current Day's interview step is active, a bar
    // to close the cycle by committing one next CUSTOMER action (or, block-once-then-
    // confession, leaving the reason). Submitting routes through markDayStep ->
    // day_progress_patch -> the sidecar interview gate (commit / confess).
    @ViewBuilder
    private func officeHoursCommitmentBar(session: ChatSession?, activeDay: Int) -> some View {
        let stepId = officeHoursCommitmentStepID(for: activeDay)
        if let stepStatus = officeHoursCommitmentStepStatus(activeDay: activeDay) {
            // 끝에서만 등장: forcing question을 전부 제출했거나 사이드카가 종결 카드
            // (대안 비교) 답변을 스탬프한 뒤에야 닫기-약속 게이트를 흐름의 종착지로
            // 보여준다. 진행 중에는 메인 인터뷰 흐름과 경쟁하지 않도록 숨긴다.
            let allQuestionsAnswered = officeHoursInterviewComplete(session: session)
            if activeDay == 1 && stepStatus == .done && officeHoursDay1DocumentsWritten {
                VStack(spacing: 12) {
                    Rectangle()
                        .fill(OpenDesignOfficeHoursColor.borderSoft)
                        .frame(height: 1)
                        .padding(.top, 6)
                    officeHoursCommitmentClosedCard()
                    officeHoursDay1CompleteButton()
                }
                .id(Self.officeHoursCommitmentBarID)
                .transition(.officeHoursPromptReveal)
            } else if stepStatus == .active && allQuestionsAnswered {
                // 약속도 인터뷰처럼: 카드를 열기 전에 이번 인터뷰의 답변에서 후보 액션을
                // 만들어 온다(사이드카 생성, 제안일 뿐 — 저장되는 약속은 항상 사용자가
                // 고르거나 고쳐 쓴 문장이라 user-origin 게이트는 그대로다). 후보가 resolve
                // 되기 전에는 카드를 잡아두고, 메인 로더("약속 준비 중")가 꺼진 뒤에도
                // 생성이 남아 있으면 같은 amber 로더로 그 박자를 채운다.
                let sessionID = session?.id ?? ""
                let candidates = sessionID.isEmpty ? nil : viewModel.officeHoursCommitmentCandidatesBySession[sessionID]
                let commitmentRevealed = sessionID.isEmpty
                    || candidates != nil
                    || (officeHoursCommitmentCandidateRequestedSessions.contains(sessionID)
                        && !viewModel.officeHoursCommitmentCandidatesGenerating.contains(sessionID))
                // 마지막 질문 답변과 약속 게이트 사이에 호흡을 둔다 — 연한 구분선으로 '이제
                // 인터뷰 마무리'로의 전환을 분리(질문 흐름과 종료 흐름을 한 박자 띄운다).
                VStack(spacing: 14) {
                    if commitmentRevealed {
                        Rectangle()
                            .fill(OpenDesignOfficeHoursColor.borderSoft)
                            .frame(height: 1)
                            .padding(.top, 6)
                        // 부채 confrontation: 새 약속을 적기 전에 미증명 약속을 직면시킨다(anti-displacement).
                        // 증거 닫기는 다음 인터뷰 대화 넛지가 담당 — 여기선 시각 confront + 빠른 '포기로 기록'만.
                        if let evidenceOS = viewModel.evidenceOS,
                           let debt = evidenceOS.overdueDebts.first ?? evidenceOS.openDebts.first {
                            officeHoursCommitmentDebtBanner(debt)
                        }
                        OfficeHoursCommitmentBarView(
                            // Scope the gate nudge to the step that was actually held (gatedStep).
                            gateMessage: (viewModel.commitmentGateStep == nil || viewModel.commitmentGateStep == stepId)
                                ? viewModel.commitmentGateMessage : nil,
                            suggestedActions: officeHoursCommitmentSuggestions(sidecarCandidates: candidates ?? []),
                            deferralStreak: viewModel.officeHoursMemory?.consecutiveDeferrals ?? 0,
                            onCommit: { action in
                                // user-origin: the founder's chosen/typed next customer action (one line).
                                _ = viewModel.markDayStep(
                                    day: activeDay,
                                    stepId: stepId,
                                    status: .done,
                                    commitmentText: action,
                                    sessionID: session?.id
                                )
                            },
                            onConfess: { reason in
                                // A confess-close records a deferral ("미룸"); it opens no new commitment.
                                _ = viewModel.markDayStep(
                                    day: activeDay,
                                    stepId: stepId,
                                    status: .done,
                                    confession: reason,
                                    sessionID: session?.id
                                )
                            }
                        )
                        .transition(.officeHoursPromptReveal)
                    } else if session?.status != .running {
                        // run이 이미 끝났는데 후보 생성만 남은 짧은 구간 — 메인 로더 자리가
                        // 비므로 여기서 amber 로더로 이어받는다. run이 도는 동안에는 타임
                        // 라인의 "약속 준비 중" 로더가 보이고 있어 중복 로더를 만들지 않는다.
                        Rectangle()
                            .fill(OpenDesignOfficeHoursColor.borderSoft)
                            .frame(height: 1)
                            .padding(.top, 6)
                        officeHoursQuestionLoader(
                            title: "약속 준비 중",
                            detail: "이번 답변 기반 · 고객 행동 후보 · 직접 적기 가능",
                            accent: OpenDesignOfficeHoursColor.amber
                        )
                    }
                }
                .id(Self.officeHoursCommitmentBarID)
                .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: commitmentRevealed)
                .task(id: sessionID) {
                    guard !sessionID.isEmpty else { return }
                    guard !officeHoursCommitmentCandidateRequestedSessions.contains(sessionID) else { return }
                    officeHoursCommitmentCandidateRequestedSessions.insert(sessionID)
                    _ = viewModel.requestOfficeHoursCommitmentCandidates(
                        sessionID: sessionID,
                        day: activeDay,
                        provider: session?.provider
                    )
                    // 버전 스큐 안전망: 옛 사이드카가 요청을 모르면 ready가 영영 안 온다 —
                    // 일정 시간 뒤 빈 결과로 강제 resolve해 약속 닫기가 로더에 갇히지 않게 한다.
                    try? await Task.sleep(nanoseconds: 45_000_000_000)
                    viewModel.resolveStalledOfficeHoursCommitmentCandidates(sessionID: sessionID)
                }
            }
        }
    }

    private func officeHoursCommitmentClosedCard() -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                Text("마지막 단계")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                    .tracking(1.2)
                    .textCase(.uppercase)
                Spacer(minLength: 0)
                Text("약속 완료")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                    .padding(.horizontal, 8)
                    .frame(height: 20)
                    .background(Capsule().fill(OpenDesignOfficeHoursColor.amberDim))
                    .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.amber.opacity(0.40), lineWidth: 1))
            }

            Text("약속이 기록됐습니다.")
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)

            Text("이제 Day 2에서 오늘의 시장 신호를 이어서 확인합니다.")
                .font(.system(size: 12, weight: .regular))
                .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                .lineSpacing(2.8)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [OpenDesignOfficeHoursColor.surface, OpenDesignOfficeHoursColor.surface2],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
        )
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(OpenDesignOfficeHoursColor.amber)
                .frame(width: 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
        )
        .accessibilityElement(children: .combine)
        .accessibilityLabel("약속 완료. Day 2로 이동할 수 있습니다.")
        .accessibilityIdentifier("opendesign.officeHours.commitmentBar.closed")
    }

    private func officeHoursDay1CompleteButton() -> some View {
        Button {
            completeOfficeHoursDay1AndAdvance()
        } label: {
            Text("Day 1 완료 → Day 2")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(OpenDesignOfficeHoursColor.bgDeep)
                .frame(maxWidth: .infinity)
                .frame(height: 40)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.accent)
                )
        }
        .buttonStyle(.plain)
        .id(Self.officeHoursDay1CompleteButtonID)
        .accessibilityLabel("Day 1 완료 후 Day 2로 이동")
        .accessibilityIdentifier(Self.officeHoursDay1CompleteButtonID)
    }

    // 약속 카드의 행동 후보(≤3) — ① 사이드카가 이번 인터뷰 6답변에서 생성한 후보(우선) ②
    // 직전 인터뷰의 미증명 부채 ③ 메모리의 open thread. ①은 제안일 뿐이고(고르거나 직접
    // 고쳐 쓰는 건 사용자), ②③은 사용자 자신의 과거 약속/스레드라 user-origin 원칙과
    // 충돌하지 않는다. 사이드카 미연결/구버전이면 ①이 비어 기존 로컬 폴백 그대로다.
    private func officeHoursCommitmentSuggestions(sidecarCandidates: [String] = []) -> [String] {
        var raw: [String] = sidecarCandidates
        if let evidenceOS = viewModel.evidenceOS {
            for debt in evidenceOS.overdueDebts + evidenceOS.openDebts {
                raw.append(debt.message.nonEmpty ?? debt.text)
            }
        }
        if let threads = viewModel.officeHoursMemory?.openThreads {
            raw.append(contentsOf: threads)
        }
        var seen = Set<String>()
        var result: [String] = []
        for candidate in raw {
            let trimmed = candidate.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty, !seen.contains(trimmed) else { continue }
            seen.insert(trimmed)
            result.append(trimmed)
            if result.count == 3 { break }
        }
        return result
    }

    // 부채 배너 — 약속 카드 바로 위. 기존 Evidence OS 데이터·abandon 시트를 재사용한다.
    @ViewBuilder
    private func officeHoursCommitmentDebtBanner(_ debt: CommitmentRecord) -> some View {
        let text = debt.message.nonEmpty ?? debt.text
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12))
                .foregroundStyle(OpenDesignOfficeHoursColor.rose)
            VStack(alignment: .leading, spacing: 3) {
                Text("이전 약속: \"\(text)\"")
                    .font(.system(size: 12.5))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                Text("증거 0 · 새 약속 전에 닫을래?")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.rose)
            }
            Spacer(minLength: 8)
            Button("포기로 기록") {
                officeHoursEvidenceDraft = OfficeHoursEvidenceDraft(commitment: debt, mode: .abandon)
            }
            .buttonStyle(.plain)
            .font(.system(size: 11, weight: .semibold))
            .foregroundStyle(OpenDesignOfficeHoursColor.muted)
            .padding(.horizontal, 9)
            .padding(.vertical, 5)
            .overlay(
                RoundedRectangle(cornerRadius: 7, style: .continuous)
                    .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
            )
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(OpenDesignOfficeHoursColor.rose.opacity(0.13))
        )
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.rose.opacity(0.42), lineWidth: 1)
        )
        .accessibilityIdentifier("opendesign.officeHours.commitmentDebtBanner")
    }

    // §18 gate 차단 화면: milestone gate가 day 패치를 보류했을 때의 하드블록
    // 카드. blockedReason + 필요한 증거 목록 + 두 해제 경로(증거 제출 /
    // confession→Office Hours)를 보여준다. 데이터는 day_progress_state의
    // gateBlocked(additive)에서 온다 — 스텁 환경에서도 결정적으로 렌더링.
    @ViewBuilder
    private func officeHoursGateBlockedBanner() -> some View {
        if let gate = viewModel.dayGateBlocked {
            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Image(systemName: "lock.fill")
                        .font(.system(size: 12))
                        .foregroundStyle(OpenDesignOfficeHoursColor.rose)
                    Text("\(gate.gateId ?? "milestone") \(gate.title ?? "") 게이트 잠김")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    Spacer(minLength: 0)
                }
                if let message = viewModel.dayGateBlockedMessage, !message.isEmpty {
                    Text(message)
                        .font(.system(size: 12))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                let requiredEvidence = Array((gate.requiredEvidence ?? []).prefix(3).enumerated())
                ForEach(requiredEvidence, id: \.offset) { _, evidence in
                    HStack(alignment: .top, spacing: 6) {
                        Text("·")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.rose)
                        Text(evidence.label ?? evidence.id ?? "")
                            .font(.system(size: 11))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                Text("해제 경로: 위 증거 제출, 또는 인터뷰에서 confession → Office Hours intervention")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.rose)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 12)
            .background(OpenDesignOfficeHoursColor.rose.opacity(0.10))
            .overlay(alignment: .bottom) {
                Rectangle().fill(OpenDesignOfficeHoursColor.rose.opacity(0.35)).frame(height: 1)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("opendesign.officeHours.gateBlockedBanner")
        }
    }

    // §13.1 OH intervention 카드: 차단형(immediate)은 강조, 예약형(scheduled)은
    // 배너 톤. 고정 질문 첫 항목으로 세션의 초점을 미리 보여준다.
    @ViewBuilder
    private func officeHoursInterventionBanner(
        presentation: OfficeHoursBannerPresentation,
        session: ChatSession?,
        day1Content: OpenDesignDayContent,
        activeDay: Int
    ) -> some View {
        if presentation.showFullInterventionBanner,
           let intervention = viewModel.ohInterventionRequired {
            let isImmediate = intervention.severity == "immediate"
            let tint = isImmediate ? OpenDesignOfficeHoursColor.rose : OpenDesignOfficeHoursColor.amber
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: isImmediate ? "exclamationmark.octagon.fill" : "bell.badge")
                        .font(.system(size: 12))
                        .foregroundStyle(tint)
                    Text(isImmediate ? "지금 막힌 것을 풀어야 해" : "다음 브리핑에서 다룰 intervention")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    if let gateId = intervention.gateId ?? intervention.ruleId {
                        Text(gateId)
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(tint)
                    }
                    Spacer(minLength: 0)
                }
                if let firstQuestion = intervention.questions?.first {
                    Text(firstQuestion)
                        .font(.system(size: 12))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Button {
                    startOfficeHours(
                        mode: selectedOfficeHoursMode,
                        session: session,
                        day1Content: day1Content,
                        day: intervention.day ?? activeDay,
                        trigger: intervention.triggerId
                    )
                } label: {
                    HStack(spacing: 6) {
                        Text(isImmediate ? "막힌 것 풀기" : "Office Hours에서 다루기")
                            .font(.system(size: 11.5, weight: .semibold))
                        Image(systemName: "arrow.right")
                            .font(.system(size: 10.5, weight: .semibold))
                    }
                    .foregroundStyle(OpenDesignOfficeHoursColor.bgDeep)
                    .padding(.horizontal, 10)
                    .frame(height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(tint)
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("opendesign.officeHours.intervention.start")
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(tint.opacity(0.08))
            .overlay(alignment: .bottom) {
                Rectangle().fill(tint.opacity(0.3)).frame(height: 1)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("opendesign.officeHours.interventionBanner")
        }
    }

    // §11.0/§17.2 미션 카드: execution 스텝 진입 시 로드된 IDD 미션. 치환 미션
    // (§15.3 회복 미션)은 사유와 함께 표시된다.
    @ViewBuilder
    private func officeHoursMissionCardBanner() -> some View {
        if let card = viewModel.executionMissionCard, let mission = card.mission {
            VStack(alignment: .leading, spacing: 6) {
                HStack(spacing: 8) {
                    Image(systemName: "target")
                        .font(.system(size: 12))
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                    Text("Day \(mission.day ?? card.day ?? 0) 미션 · \(mission.shortTitle ?? "")")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    if mission.substituted == true {
                        Text("회복 미션")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                    }
                    Spacer(minLength: 0)
                }
                Text(mission.title ?? "")
                    .font(.system(size: 12))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                if let output = mission.output, !output.isEmpty {
                    Text("산출물: \(output)")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .padding(.horizontal, 20)
            .padding(.vertical, 10)
            .background(OpenDesignOfficeHoursColor.accentDim.opacity(0.5))
            .overlay(alignment: .bottom) {
                Rectangle().fill(OpenDesignOfficeHoursColor.accentLine).frame(height: 1)
            }
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("opendesign.officeHours.missionCardBanner")
        }
    }

    // Day timeline sidebar (IA): cumulative Day list, today on top, past newest-first,
    // skipped days collapsed into a chip. Falls back to the legacy mode row pre-scan.
    private func officeHoursSessionsSidebar(session: ChatSession?, activeDay: Int) -> some View {
        VStack(spacing: 0) {
            officeHoursTimelineHeader()

            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    if let progress = viewModel.dayProgress,
                       let currentDay = progress.currentDayNumber() {
                        officeHoursSidebarGroupTitle(officeHoursPhaseTitle(forDay: currentDay))
                        ForEach(officeHoursTimelineRows(progress: progress, currentDay: currentDay)) { row in
                            switch row {
                            case .day(let day):
                                officeHoursTimelineDayRow(day: day, progress: progress, isToday: day == currentDay)
                            case .skip(let from, let to):
                                officeHoursTimelineSkipChip(from: from, to: to)
                            }
                        }
                    } else {
                        officeHoursSidebarGroupTitle("Default")
                        officeHoursSidebarModeRow(.startup, session: session)
                    }
                }
                .padding(.horizontal, 6)
                .padding(.top, 2)
                .padding(.bottom, 14)
            }

            officeHoursNewConversationButton(session: session, activeDay: activeDay)
        }
        .frame(maxHeight: .infinity)
        .background(OpenDesignOfficeHoursColor.bg)
        .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(width: 1), alignment: .trailing)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.sessions")
    }

    // Pinned sidebar footer: starts a fresh Office Hours conversation for the
    // day currently selected in the timeline.
    private func officeHoursNewConversationButton(session: ChatSession?, activeDay: Int) -> some View {
        VStack(spacing: 0) {
            Rectangle()
                .fill(OpenDesignOfficeHoursColor.borderSoft)
                .frame(height: 1)
            Button {
                resetOfficeHoursSession(day: activeDay)
            } label: {
                HStack(spacing: 9) {
                    Text("+")
                        .font(.system(size: 15, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                        .frame(width: 26, height: 26)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(OpenDesignOfficeHoursColor.accentDim)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1)
                                )
                        )
                    Text("새 대화 시작하기")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    Spacer(minLength: 0)
                }
                .padding(.horizontal, 12)
                .frame(height: 52)
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("opendesign.officeHours.newConversation")
        }
        .background(OpenDesignOfficeHoursColor.bg)
    }

    private func officeHoursTimelineHeader() -> some View {
        let currentDay = viewModel.dayProgress?.currentDayNumber()
        return HStack(spacing: 8) {
            Text(officeHoursProjectName())
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                .lineLimit(1)
            if let currentDay {
                Text("Day \(currentDay)")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                    .padding(.horizontal, 7)
                    .frame(height: 19)
                    .background(Capsule().fill(OpenDesignOfficeHoursColor.accentDim))
                    .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1))
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(height: 40)
        .accessibilityIdentifier("opendesign.officeHours.timeline.header")
    }

    private func officeHoursProjectName() -> String {
        let root = viewModel.workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return "agentic30" }
        return (root as NSString).lastPathComponent
    }

    private func activeOfficeHoursDay(fallback day: Int) -> Int {
        if let selectedTimelineDay, selectedTimelineDay > 0 {
            return selectedTimelineDay
        }
        if let currentDay = viewModel.dayProgress?.currentDayNumber(), currentDay > 0 {
            return currentDay
        }
        return max(1, day)
    }

    // Phase grouping (placeholder: backbone elapsed-day mapping; scan-adaptive phase
    // judgement is a future replacement per the IA decision).
    private func officeHoursPhaseTitle(forDay day: Int) -> String {
        AgenticCurriculumDay.days.first(where: { $0.day == day })?.phase.title ?? "초기 검증"
    }

    // Goal line: adaptive goalText first, else the 30-day backbone title (fallback).
    private func officeHoursBackboneGoal(forDay day: Int) -> String {
        AgenticCurriculumDay.days.first(where: { $0.day == day })?.title ?? "오늘의 목표를 정합니다"
    }

    private func officeHoursGoalLine(forDay day: Int) -> String {
        viewModel.dayProgress?.record(forDay: day)?.goalText.nonEmpty
            ?? viewModel.evidenceOS?.dayStates[String(day)]?.carryForwardAction?.nonEmpty
            ?? officeHoursBackboneGoal(forDay: day)
    }

    private func officeHoursTimelineRows(progress: DayProgress, currentDay: Int) -> [OfficeHoursTimelineRow] {
        var rows: [OfficeHoursTimelineRow] = [.day(currentDay)]
        var emptyRun: [Int] = []
        func flush() {
            guard let hi = emptyRun.first, let lo = emptyRun.last else { return }
            rows.append(.skip(from: lo, to: hi))
            emptyRun.removeAll()
        }
        var day = currentDay - 1
        while day >= 1 {
            if progress.record(forDay: day) != nil || viewModel.evidenceOS?.dayStates[String(day)] != nil {
                flush()
                rows.append(.day(day))
            } else {
                emptyRun.append(day)
            }
            day -= 1
        }
        flush()
        return rows
    }

    private func officeHoursTimelineDayRow(day: Int, progress: DayProgress, isToday: Bool) -> some View {
        let record = progress.record(forDay: day)
        let dayState = viewModel.evidenceOS?.dayStates[String(day)]
        let goal = record?.goalText.nonEmpty ?? dayState?.carryForwardAction?.nonEmpty ?? officeHoursBackboneGoal(forDay: day)
        let complete = record?.isDisplayComplete ?? false
        let incomplete = !isToday && ((record != nil && !complete) || dayState?.state == "not_started" || (dayState?.openDebtCount ?? 0) > 0)
        let liveSelectionIsActive = selectedPastReviewDay == nil
        let isSelected = selectedPastReviewDay == day
            || (liveSelectionIsActive && (isToday ? selectedTimelineDay == nil : selectedTimelineDay == day))
        let style: OfficeHoursTimelineRowStyle = isToday ? .today : (incomplete ? .incomplete : .done)

        let meta: String
        if isToday {
            // §18 타임라인 gate 칩: 오늘 진입이 milestone gate에 잠겨 있으면
            // 스텝 라벨 대신 잠김 상태를 그대로 보여준다.
            if let blockedGate = viewModel.dayGateBlocked {
                meta = "잠김 · \(blockedGate.gateId ?? "gate")"
            } else {
                let active = record?.displaySteps.first(where: { $0.status == .active })?.label
                meta = active.map { "오늘 · \($0)" } ?? "오늘"
            }
        } else if incomplete {
            meta = dayState?.label.nonEmpty ?? "미완"
        } else {
            meta = ""
        }

        let badge = (complete && !isToday) ? "✓" : ""

        return Button {
            if isToday {
                selectedPastReviewDay = nil
                selectedTimelineDay = nil
                viewModel.ensureOfficeHoursSession(forDay: day)
            } else if hasPastTimelineReview(forDay: day) {
                selectedPastReviewDay = day
                selectedTimelineDay = nil
            } else {
                selectedPastReviewDay = nil
                selectedTimelineDay = day
                viewModel.ensureOfficeHoursSession(forDay: day)
            }
        } label: {
            officeHoursTimelineRowSurface(
                mark: "\(day)",
                name: goal,
                meta: meta,
                badge: badge,
                style: style,
                isSelected: isSelected
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("opendesign.officeHours.timeline.day.\(day)")
    }

    private func officeHoursTimelineRowSurface(
        mark: String,
        name: String,
        meta: String,
        badge: String,
        style: OfficeHoursTimelineRowStyle,
        isSelected: Bool = false
    ) -> some View {
        let markFg: Color
        let markBg: Color
        let markBorder: Color
        let badgeColor: Color
        let metaColor: Color
        var rowBg: Color
        var rowBorder: Color
        let nameColor: Color
        switch style {
        case .today:
            markFg = OpenDesignOfficeHoursColor.accent
            markBg = OpenDesignOfficeHoursColor.accentDim
            markBorder = OpenDesignOfficeHoursColor.accentLine
            badgeColor = OpenDesignOfficeHoursColor.accent
            metaColor = OpenDesignOfficeHoursColor.accent
            // Today stays identifiable via its green accent mark/meta; the focus
            // fill is applied below only when today is the row on screen.
            rowBg = Color.clear
            rowBorder = Color.clear
            nameColor = OpenDesignOfficeHoursColor.fg
        case .done:
            markFg = OpenDesignOfficeHoursColor.fgSecondary
            markBg = OpenDesignOfficeHoursColor.bgDeep
            markBorder = OpenDesignOfficeHoursColor.border
            badgeColor = OpenDesignOfficeHoursColor.accent
            metaColor = OpenDesignOfficeHoursColor.muted
            rowBg = Color.clear
            rowBorder = Color.clear
            nameColor = OpenDesignOfficeHoursColor.fgSecondary
        case .incomplete:
            markFg = OpenDesignOfficeHoursColor.amber
            markBg = OpenDesignOfficeHoursColor.amberDim
            markBorder = OpenDesignOfficeHoursColor.amber.opacity(0.4)
            badgeColor = OpenDesignOfficeHoursColor.amber
            metaColor = OpenDesignOfficeHoursColor.amber
            rowBg = Color.clear
            rowBorder = Color.clear
            nameColor = OpenDesignOfficeHoursColor.fgSecondary
        }
        // Single focus fill: applied to whichever row the main column is showing
        // (today when nothing is selected, else the chosen past day).
        if isSelected {
            rowBg = OpenDesignOfficeHoursColor.selected
            rowBorder = OpenDesignOfficeHoursColor.borderSoft
        }
        return HStack(spacing: 10) {
            Text(mark)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(markFg)
                .frame(width: 26, height: 26)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(markBg)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(markBorder, lineWidth: 1)
                        )
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.system(size: 12, weight: style == .today ? .semibold : .regular))
                    .foregroundStyle(nameColor)
                    .lineLimit(1)
                if !meta.isEmpty {
                    Text(meta)
                        .font(.system(size: 9.5, weight: .regular, design: .monospaced))
                        .foregroundStyle(metaColor)
                        .lineLimit(1)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)

            if !badge.isEmpty {
                Text(badge)
                    .font(.system(size: 9.5, weight: .regular, design: .monospaced))
                    .foregroundStyle(badgeColor)
                    .lineLimit(1)
                    .fixedSize(horizontal: true, vertical: false)
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(rowBg)
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(rowBorder, lineWidth: 1)
                )
        )
    }

    private func officeHoursTimelineSkipChip(from: Int, to: Int) -> some View {
        let label = from == to ? "Day \(from) · 건너뜀" : "Day \(from)–\(to) · 건너뜀"
        return HStack(spacing: 10) {
            Text("···")
                .font(.system(size: 12, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
                .frame(width: 26, height: 26)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(OpenDesignOfficeHoursColor.border, style: StrokeStyle(lineWidth: 1, dash: [3]))
                )
            Text(label)
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
                .lineLimit(1)
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 6)
        .accessibilityIdentifier("opendesign.officeHours.timeline.skip.\(from).\(to)")
    }

    private func officeHoursSidebarGroupTitle(_ title: String) -> some View {
        Text(title)
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
            .tracking(1.1)
            .textCase(.uppercase)
            .padding(.horizontal, 8)
            .padding(.top, 12)
            .padding(.bottom, 4)
            .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func officeHoursSidebarModeRow(_ mode: OfficeHoursMode, session: ChatSession?) -> some View {
        let isActive = selectedOfficeHoursMode == mode
        return Button {
            selectedOfficeHoursMode = mode
        } label: {
            officeHoursSidebarRow(
                mark: mode.mark,
                name: mode.sidebarName,
                meta: mode.sidebarMeta,
                badge: mode == .startup ? "default" : "\(mode.questionCount)Q",
                isActive: isActive
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("opendesign.officeHours.mode.\(mode.rawValue)")
    }

    private func officeHoursSidebarRow(
        mark: String,
        name: String,
        meta: String,
        badge: String,
        isActive: Bool
    ) -> some View {
        HStack(spacing: 10) {
            Text(mark)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(isActive ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.fgSecondary)
                .frame(width: 26, height: 26)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(isActive ? OpenDesignOfficeHoursColor.accentDim : OpenDesignOfficeHoursColor.bgDeep)
                        .overlay(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .stroke(isActive ? OpenDesignOfficeHoursColor.accentLine : OpenDesignOfficeHoursColor.border, lineWidth: 1)
                        )
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(name)
                    .font(.system(size: 12, weight: .regular))
                    .foregroundStyle(isActive ? OpenDesignOfficeHoursColor.fg : OpenDesignOfficeHoursColor.fgSecondary)
                    .lineLimit(1)
                Text(meta)
                    .font(.system(size: 9.5, weight: .regular, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                    .lineLimit(1)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
            .layoutPriority(1)

            Text(badge)
                .font(.system(size: 9.5, weight: .regular, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                .lineLimit(1)
                .fixedSize(horizontal: true, vertical: false)
                .layoutPriority(0)
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 6, style: .continuous)
                .fill(isActive ? OpenDesignOfficeHoursColor.selected : Color.clear)
                .overlay(
                    RoundedRectangle(cornerRadius: 6, style: .continuous)
                        .stroke(isActive ? OpenDesignOfficeHoursColor.borderSoft : Color.clear, lineWidth: 1)
                )
        )
    }

    private func officeHoursMainColumn(
        session: ChatSession?,
        day1Content: OpenDesignDayContent,
        activeDay: Int,
        layout: OfficeHoursScreenLayout
    ) -> some View {
        Group {
            if let pastDay = selectedPastTimelineDay() {
                officeHoursPastDayDetail(day: pastDay)
            } else {
                VStack(spacing: 0) {
                    officeHoursHeader(session: session, activeDay: activeDay)
                    officeHoursStepper(session: session, activeDay: activeDay)
                    officeHoursDailyDigestBanner(activeDay: activeDay)
                    officeHoursMainScroll(session: session, day1Content: day1Content, activeDay: activeDay, layout: layout)
                }
            }
        }
        .frame(maxHeight: .infinity, alignment: .top)
        .background(OpenDesignOfficeHoursColor.bg)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.main")
    }

    /// Legacy resolver for the read-only retro surface. The primary timeline now
    /// scopes the live Office Hours session by day; keep this helper isolated for
    /// any evidence-only retro surfaces that still need a recorded past day.
    private func selectedPastTimelineDay() -> Int? {
        guard let day = selectedPastReviewDay,
              hasPastTimelineReview(forDay: day) else { return nil }
        return day
    }

    private func hasPastTimelineReview(forDay day: Int) -> Bool {
        viewModel.dayProgress?.record(forDay: day) != nil
            || viewModel.dayReviews[String(day)] != nil
            || viewModel.evidenceOS?.dayStates[String(day)] != nil
    }

    // Read-only retro for a past day. Sourced purely from the day-progress
    // record (goal + step statuses). The live Office Hours timeline no longer
    // uses this as its main column; it is retained for evidence-only summaries.
    private func officeHoursPastDayDetail(day: Int) -> some View {
        let record = viewModel.dayProgress?.record(forDay: day)
        let goal = record?.goalText.nonEmpty ?? officeHoursBackboneGoal(forDay: day)
        let steps = record?.displaySteps ?? []
        let complete = record?.isDisplayComplete ?? false
        let review = viewModel.dayReviews[String(day)]
        let markFg = complete ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.amber
        let markBg = complete ? OpenDesignOfficeHoursColor.accentDim : OpenDesignOfficeHoursColor.amberDim
        let markBorder = complete ? OpenDesignOfficeHoursColor.accentLine : OpenDesignOfficeHoursColor.amber.opacity(0.4)

        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 14) {
                Text("\(day)")
                    .font(.system(size: 16, weight: .bold, design: .monospaced))
                    .foregroundStyle(markFg)
                    .frame(width: 44, height: 44)
                    .background(
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .fill(markBg)
                            .overlay(
                                RoundedRectangle(cornerRadius: 11, style: .continuous)
                                    .stroke(markBorder, lineWidth: 1)
                            )
                    )
                VStack(alignment: .leading, spacing: 3) {
                    Text("Day \(day) · \(officeHoursPhaseTitle(forDay: day))")
                        .font(.system(size: 17, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                        .lineLimit(1)
                        .accessibilityIdentifier("opendesign.officeHours.pastDay.\(day)")
                    Text(complete ? "완료됨 · 읽기 전용 회고" : "미완 · 읽기 전용 회고")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(complete ? OpenDesignOfficeHoursColor.muted : OpenDesignOfficeHoursColor.amber)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
                Button {
                    selectedPastReviewDay = nil
                    selectedTimelineDay = nil
                } label: {
                    Text("오늘로 돌아가기")
                        .font(.system(size: 11, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                        .padding(.horizontal, 13)
                        .frame(height: 30)
                        .background(
                            Capsule()
                                .fill(OpenDesignOfficeHoursColor.accentDim)
                                .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1))
                        )
                        .contentShape(Capsule())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("opendesign.officeHours.pastDay.back")
            }
            .padding(.horizontal, 28)
            .frame(height: 70)
            .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    officeHoursPastDayGoalSnapshotSection(review: review)
                    officeHoursPastDayCarryForwardSection(review: review)
                    officeHoursPastDayVerdictSection(day: day, review: review)
                    officeHoursPastDayEvidenceSection(review: review)
                    officeHoursPastDayCommitmentSection(review: review)

                    officeHoursPastDaySection(title: "목표", identifier: "opendesign.officeHours.pastDay.goal.\(day)") {
                        Text(goal)
                            .font(.system(size: 14, weight: .regular))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if !steps.isEmpty {
                        officeHoursPastDaySection(title: "진행", identifier: "opendesign.officeHours.pastDay.progress.\(day)") {
                            ForEach(steps.indices, id: \.self) { index in
                                let step = steps[index]
                                HStack(spacing: 11) {
                                    Text(step.status == .done ? "✓" : (step.status == .active ? "●" : "○"))
                                        .font(.system(size: 12, weight: .medium, design: .monospaced))
                                        .foregroundStyle(
                                            step.status == .done
                                                ? OpenDesignOfficeHoursColor.accent
                                                : (step.status == .active ? OpenDesignOfficeHoursColor.amber : OpenDesignOfficeHoursColor.mutedDeep)
                                        )
                                        .frame(width: 18)
                                    Text(step.label)
                                        .font(.system(size: 13, weight: step.status == .active ? .medium : .regular))
                                        .foregroundStyle(
                                            step.status == .pending
                                                ? OpenDesignOfficeHoursColor.fgSecondary
                                                : OpenDesignOfficeHoursColor.fg
                                        )
                                    Spacer(minLength: 0)
                                }
                            }
                        }
                    }
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 24)
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        .background(OpenDesignOfficeHoursColor.bg)
        .accessibilityElement(children: .contain)
    }

    @ViewBuilder
    private func officeHoursPastDayGoalSnapshotSection(review: DayReview?) -> some View {
        if let goal = review?.goalSnapshot, goal.summary.nonEmpty != nil {
            officeHoursPastDaySection(title: "검증 가설", identifier: "opendesign.officeHours.pastDay.goalSnapshot") {
                VStack(alignment: .leading, spacing: 8) {
                    Text(goal.summary)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        if let customer = goal.customer.nonEmpty {
                            officeHoursPastDayChip("고객 \(customer)", tone: "success")
                        }
                        if let action = goal.validationAction.nonEmpty {
                            officeHoursPastDayChip("행동 \(action)", tone: "warning")
                        }
                    }
                    if let problem = goal.problem.nonEmpty {
                        Text(problem)
                            .font(.system(size: 12))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func officeHoursPastDayCarryForwardSection(review: DayReview?) -> some View {
        let action = review?.carryForwardAction?.nonEmpty
        let reasons = review?.missingReasons ?? []
        if action != nil || !reasons.isEmpty {
            officeHoursPastDaySection(title: "오늘 이어서 닫을 것", identifier: "opendesign.officeHours.pastDay.carryForward") {
                VStack(alignment: .leading, spacing: 8) {
                    if let action {
                        Text(action)
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    ForEach(Array(reasons.prefix(3).enumerated()), id: \.offset) { _, reason in
                        HStack(alignment: .top, spacing: 8) {
                            Text("!")
                                .font(.system(size: 11, weight: .bold, design: .monospaced))
                                .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                                .frame(width: 14)
                            Text(reason)
                                .font(.system(size: 12))
                                .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
            }
        }
    }

    private func officeHoursPastDayVerdictSection(day: Int, review: DayReview?) -> some View {
        let label = review?.verdictLabel.nonEmpty ?? "고객 증거 미기록"
        let summary = review?.summary.nonEmpty ?? "이 회차에는 고객 증거가 기록되지 않았습니다."
        let tone = review?.verdictTone ?? "muted"
        let toneColor = officeHoursPastDayToneColor(tone)
        return officeHoursPastDaySection(title: "실행 판정", identifier: "opendesign.officeHours.pastDay.review.verdict.\(day)") {
            HStack(alignment: .top, spacing: 12) {
                Text(officeHoursPastDayVerdictGlyph(review?.status))
                    .font(.system(size: 16, weight: .bold, design: .monospaced))
                    .foregroundStyle(toneColor)
                    .frame(width: 28, height: 28)
                    .background(Circle().fill(toneColor.opacity(0.14)))
                    .overlay(Circle().stroke(toneColor.opacity(0.42), lineWidth: 1))
                VStack(alignment: .leading, spacing: 5) {
                    Text(label)
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    Text(summary)
                        .font(.system(size: 12.5, weight: .regular))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                    if let work = review?.work, work.hasWork {
                        Text("AI 작업 \(work.aiMinutes)분 · 커밋 \(work.commitCount)건 · 참조 \(work.referenceEventCount)개")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                            .lineLimit(1)
                    }
                }
            }
        }
    }

    private func officeHoursPastDayEvidenceSection(review: DayReview?) -> some View {
        officeHoursPastDaySection(title: "고객 증거", identifier: "opendesign.officeHours.pastDay.review.evidence") {
            let evidence = review?.customerEvidence ?? []
            if evidence.isEmpty {
                Text("고객 증거 미기록")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                    .fixedSize(horizontal: false, vertical: true)
                Text("고객명, 보낸 메시지, 반응, URL/스크린샷/결제 같은 확인 가능한 증거가 아직 이 회차에 연결되지 않았습니다.")
                    .font(.system(size: 12))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                ForEach(evidence) { item in
                    VStack(alignment: .leading, spacing: 5) {
                        HStack(spacing: 8) {
                            Text(item.customer.nonEmpty ?? "고객 미기록")
                                .font(.system(size: 13, weight: .semibold))
                                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                            if let channel = item.channel.nonEmpty {
                                Text(channel)
                                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                                    .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                                    .padding(.horizontal, 6)
                                    .frame(height: 18)
                                    .background(Capsule().fill(OpenDesignOfficeHoursColor.accentDim))
                            }
                            Spacer(minLength: 0)
                            Text(item.evidence == nil ? "증거 없음" : "증거 있음")
                                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                                .foregroundStyle(item.evidence == nil ? OpenDesignOfficeHoursColor.amber : OpenDesignOfficeHoursColor.accent)
                        }
                        Text(item.message.nonEmpty ?? item.text)
                            .font(.system(size: 12.5))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        if let proof = item.evidence {
                            Text(officeHoursEvidenceLine(proof))
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                    .padding(.vertical, 4)
                }
            }
        }
    }

    private func officeHoursPastDayCommitmentSection(review: DayReview?) -> some View {
        officeHoursPastDaySection(title: "다음 약속", identifier: "opendesign.officeHours.pastDay.review.commitment") {
            if let commitment = review?.nextCommitment ?? review?.commitments.last {
                VStack(alignment: .leading, spacing: 6) {
                    Text(commitment.text)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                    HStack(spacing: 8) {
                        officeHoursPastDayChip("고객 \(commitment.customer.nonEmpty ?? "미기록")", tone: commitment.customer.isEmpty ? "warning" : "success")
                        officeHoursPastDayChip("증거 \(commitment.expectedEvidenceKind.nonEmpty ?? "미기록")", tone: commitment.expectedEvidenceKind.isEmpty ? "warning" : "success")
                        if let due = commitment.dueDay {
                            officeHoursPastDayChip("Day \(due)까지", tone: "muted")
                        }
                    }
                    if commitment.evidence == nil {
                        Text("아직 완료 증거가 없습니다. 다음 단계로 넘어가기 전에 확인 가능한 증거로 닫아야 합니다.")
                            .font(.system(size: 12))
                            .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                            .fixedSize(horizontal: false, vertical: true)
                        HStack(spacing: 6) {
                            officeHoursEvidenceActionButton(systemName: "paperclip", title: "증거") {
                                officeHoursEvidenceDraft = OfficeHoursEvidenceDraft(commitment: commitment, mode: .evidence)
                            }
                            officeHoursEvidenceActionButton(systemName: "arrow.forward.circle", title: "이월") {
                                _ = viewModel.carryForwardOfficeHoursCommitment(commitmentId: commitment.id)
                            }
                            officeHoursEvidenceActionButton(systemName: "xmark.circle", title: "포기") {
                                officeHoursEvidenceDraft = OfficeHoursEvidenceDraft(commitment: commitment, mode: .abandon)
                            }
                        }
                    }
                }
            } else {
                Text("다음 고객 행동 약속이 없습니다.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
            }
        }
    }

    private func officeHoursPastDaySection<Content: View>(
        title: String,
        identifier: String,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            officeHoursSidebarGroupTitle(title)
            content()
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(OpenDesignOfficeHoursColor.surface)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(identifier)
    }

    private func officeHoursPastDayChip(_ text: String, tone: String) -> some View {
        let color = officeHoursPastDayToneColor(tone)
        return Text(text)
            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
            .foregroundStyle(color)
            .padding(.horizontal, 7)
            .frame(height: 20)
            .background(Capsule().fill(color.opacity(0.14)))
            .overlay(Capsule().stroke(color.opacity(0.35), lineWidth: 1))
    }

    private func officeHoursPastDayToneColor(_ tone: String) -> Color {
        switch tone {
        case "success": return OpenDesignOfficeHoursColor.accent
        case "danger": return OpenDesignOfficeHoursColor.rose
        case "warning": return OpenDesignOfficeHoursColor.amber
        default: return OpenDesignOfficeHoursColor.muted
        }
    }

    private func officeHoursPastDayVerdictGlyph(_ status: String?) -> String {
        switch status {
        case "evidence_confirmed": return "✓"
        case "hard_evidence_confirmed": return "✓"
        case "build_escape": return "!"
        case "closed_unproven": return "?"
        case "commitment_unproven": return "?"
        case "blocked": return "…"
        case "not_started": return "○"
        default: return "○"
        }
    }

    private func officeHoursEvidenceLine(_ evidence: CommitmentEvidence) -> String {
        let locator = evidence.url.nonEmpty ?? evidence.note.nonEmpty ?? "locator 없음"
        return "\(evidence.kind) · \(locator)"
    }

    private func officeHoursHeader(session: ChatSession?, activeDay: Int) -> some View {
        HStack(spacing: 12) {
            HStack(spacing: 14) {
                Text("OH")
                    .font(.system(size: 16, weight: .bold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                    .frame(width: 44, height: 44)
                    .background(
                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                            .fill(OpenDesignOfficeHoursColor.accentDim)
                            .overlay(
                                RoundedRectangle(cornerRadius: 11, style: .continuous)
                                    .stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1)
                            )
                    )

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 9) {
                        Text("\(OpenDesignCopy.officeHoursTitle) · Day \(activeDay)")
                            .font(.system(size: 17, weight: .semibold))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                            .lineLimit(1)
                    }

                    HStack(spacing: 8) {
                        Circle()
                            .fill(OpenDesignOfficeHoursColor.accent)
                            .frame(width: 5, height: 5)
                            .shadow(color: OpenDesignOfficeHoursColor.accentDim, radius: 3)
                        Text(officeHoursRunStateText(session: session, activeDay: activeDay))
                            .lineLimit(1)
                            .accessibilityIdentifier("opendesign.officeHours.runState")
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                }
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 28)
        .frame(height: 70)
        .background(OpenDesignOfficeHoursColor.bg)
        .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)
    }

    // Stepper repurposed to the Day macro loop (scan→회고→목표→인터뷰→실행, Day1=4 steps).
    // Reuses the same step-pill component; falls back to the legacy office-hours micro
    // 3-step (목표 준비→질문 대화→증거 정리) pre-scan when no day progress exists.
    private func officeHoursStepper(session: ChatSession?, activeDay: Int) -> some View {
        HStack(spacing: 0) {
            if let macroSteps = officeHoursMacroSteps(activeDay: activeDay) {
                ForEach(Array(macroSteps.enumerated()), id: \.offset) { pair in
                    if pair.offset > 0 { officeHoursStepSeparator() }
                    officeHoursStep(
                        index: pair.offset + 1,
                        title: pair.element.label,
                        isDone: pair.element.status == .done,
                        isOn: pair.element.status == .active
                    )
                }
            } else {
                let modePicked = officeHoursModePicked(session: session, activeDay: activeDay)
                let hasAnswers = officeHoursAnswerCount(session: session) > 0
                officeHoursStep(index: 1, title: "목표 준비", isDone: modePicked, isOn: !modePicked)
                officeHoursStepSeparator()
                officeHoursStep(index: 2, title: "질문 대화", isDone: hasAnswers && session?.pendingUserInput == nil, isOn: modePicked && session?.pendingUserInput != nil)
                officeHoursStepSeparator()
                officeHoursStep(index: 3, title: "증거 정리", isDone: false, isOn: modePicked && hasAnswers && session?.pendingUserInput == nil)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 28)
        .frame(height: 56)
        .background(OpenDesignOfficeHoursColor.bg)
        .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)
        .accessibilityIdentifier("opendesign.officeHours.stepper")
    }

    /// Day macro-loop steps for the current day, or nil pre-scan (legacy fallback).
    private func officeHoursMacroSteps(activeDay: Int) -> [(id: String, label: String, status: DayStepStatus)]? {
        guard let progress = viewModel.dayProgress else {
            return nil
        }
        // Tolerate a missing today-record (synthesized all-pending) so the stepper stays
        // consistent with the sidebar timeline instead of reverting to the legacy 3-step.
        // `displaySteps` hides the Day-1 intro stages (onboarding, scan) that are already done.
        return progress.recordOrDefault(forDay: activeDay).displaySteps
    }

    private func officeHoursStep(index: Int, title: String, isDone: Bool, isOn: Bool) -> some View {
        HStack(spacing: 8) {
            Text(isDone ? "✓" : "\(index)")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(isDone ? OpenDesignOfficeHoursColor.bgDeep : isOn ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.muted)
                .frame(width: 18, height: 18)
                .background(Circle().fill(isDone ? OpenDesignOfficeHoursColor.accent : Color.clear))
                .overlay(Circle().stroke(isOn ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.mutedDeep, lineWidth: 1.5))

            Text(title)
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                .foregroundStyle(isOn ? OpenDesignOfficeHoursColor.accent : isDone ? OpenDesignOfficeHoursColor.fgSecondary : OpenDesignOfficeHoursColor.muted)
        }
        .padding(.horizontal, 12)
        .frame(height: 30)
        .background(
            Capsule()
                .fill(isOn ? OpenDesignOfficeHoursColor.accentDim : Color.clear)
                .overlay(Capsule().stroke(isOn ? OpenDesignOfficeHoursColor.accentLine : Color.clear, lineWidth: 1))
        )
    }

    private func officeHoursStepSeparator() -> some View {
        Rectangle()
            .fill(OpenDesignOfficeHoursColor.borderSoft)
            .frame(width: 24, height: 1)
            .padding(.horizontal, 4)
    }

    private func officeHoursStatusPill(session: ChatSession?) -> some View {
        let label: String
        if let session {
            switch session.status {
            case .idle:
                if officeHoursIsDocReady(session: session) {
                    label = "doc ready"
                } else {
                    label = session.pendingUserInput == nil ? "ready" : "running"
                }
            case .running:
                label = "running"
            case .awaitingInput:
                label = "running"
            case .error:
                label = "blocked"
            }
        } else {
            label = viewModel.isConnected ? "creating" : "connecting"
        }

        return HStack(spacing: 0) {
            Text(label)
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
        }
        .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
        .padding(.horizontal, 9)
        .frame(height: 19)
        .background(Capsule().fill(OpenDesignOfficeHoursColor.surface))
        .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1))
        .accessibilityIdentifier("opendesign.officeHours.bridgeStatus")
    }

    private func officeHoursMainScroll(
        session: ChatSession?,
        day1Content: OpenDesignDayContent,
        activeDay: Int,
        layout: OfficeHoursScreenLayout
    ) -> some View {
        let modePicked = officeHoursModePicked(session: session, activeDay: activeDay)
        return GeometryReader { scrollGeometry in
            let viewportHeight = scrollGeometry.size.height
            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 14) {
                        if modePicked {
                            officeHoursQuestionStage(
                                session: session,
                                day1Content: day1Content,
                                activeDay: activeDay,
                                viewportHeight: viewportHeight
                            )
                            if shouldRenderOfficeHoursCommitmentBar(session: session, activeDay: activeDay) {
                                officeHoursCommitmentBar(session: session, activeDay: activeDay)
                            }
                        } else if viewModel.day1GoalSelection == nil {
                            officeHoursTutorHead()
                            officeHoursGoalSelectionBlock(session: session, day1Content: day1Content)
                        } else {
                            officeHoursTutorHead()
                            officeHoursIntroContextStack(
                                idPrefix: "office-hours",
                                activeDay: activeDay,
                                introDelayNanoseconds: reduceMotion ? 0 : 680_000_000,
                                contextDelayNanoseconds: reduceMotion ? 0 : 1_020_000_000
                            )
                        }

                        Color.clear
                            .frame(height: 1)
                            .id(Self.officeHoursTranscriptBottomID)
                    }
                    .frame(maxWidth: 820, alignment: .leading)
                    .frame(maxWidth: .infinity, alignment: .top)
                    .padding(.horizontal, layout.mainPadding)
                    .padding(.top, 22)
                    .padding(.bottom, officeHoursMainScrollBottomPadding(session: session, modePicked: modePicked))
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: session?.pendingUserInput?.requestId)
                    .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: session?.messages.count ?? 0)
                    .background(OfficeHoursScrollCaptureAnchor(anchor: $officeHoursMainScrollCaptureAnchor))
                }
                .scrollBounceBehavior(.basedOnSize, axes: .vertical)
                .background(OpenDesignOfficeHoursColor.bg)
                .accessibilityIdentifier("opendesign.officeHours.main.scroll")
                .task(id: "auto-start-day-\(activeDay)-\(session?.id ?? "none")-\(modePicked)-\(viewModel.day1GoalSelection?.goalType.rawValue ?? "no-goal")") {
                    guard !modePicked, let session else { return }
                    guard viewModel.day1GoalSelection != nil else { return }
                    let delay: UInt64 = reduceMotion ? 0 : 1_680_000_000
                    if delay > 0 {
                        do {
                            try await Task.sleep(nanoseconds: delay)
                        } catch {
                            return
                        }
                    }
                    guard !Task.isCancelled else { return }
                    startOfficeHoursIfNeeded(session: session, day1Content: day1Content, day: activeDay)
                }
                .onAppear {
                    if modePicked {
                        scrollOfficeHoursTranscript(proxy, session: session, activeDay: activeDay)
                    }
                }
                .onChange(of: modePicked) { _, isPicked in
                    guard isPicked else { return }
                    scrollOfficeHoursTranscript(proxy, session: session, activeDay: activeDay)
                }
                .onChange(of: session?.pendingUserInput?.requestId) { _, _ in
                    scrollOfficeHoursTranscript(proxy, session: session, activeDay: activeDay)
                }
                .onChange(of: session?.messages.count ?? 0) { _, _ in
                    scrollOfficeHoursTranscript(proxy, session: session, activeDay: activeDay)
                }
                .onChange(of: session?.status) { _, _ in
                    scrollOfficeHoursTranscript(proxy, session: session, activeDay: activeDay)
                }
                .onChange(of: viewModel.iddDocPreviews) { _, _ in
                    scrollOfficeHoursTranscript(proxy, session: session, activeDay: activeDay)
                }
                .onChange(of: viewModel.day1DocHandoffPendingDocType) { _, _ in
                    scrollOfficeHoursTranscript(proxy, session: session, activeDay: activeDay)
                }
                .onChange(of: viewModel.dayProgress) { _, _ in
                    scrollOfficeHoursTranscript(proxy, session: session, activeDay: activeDay)
                }
                .onChange(of: officeHoursReadyPromptRevealIDs) { previous, current in
                    // The minimum-loading gate revealed a question (loader → prompt swap,
                    // content height changes). An explicit trigger here replaces the old
                    // blind 3.4–5.9s scroll retries that papered over this moment.
                    guard !current.subtracting(previous).isEmpty else { return }
                    scrollOfficeHoursTranscript(proxy, session: session, activeDay: activeDay)
                }
                .onChange(of: session.map {
                    OfficeHoursAutoStartPolicy.SessionProviderSnapshot(sessionID: $0.id, provider: $0.provider)
                }) { previous, current in
                    // The user switched the active engine on this office-hours session (e.g.
                    // after the prior provider hit its usage limit). The sidecar idled the
                    // session and cleared the error, which also removed the "다시 시도" button,
                    // leaving the Day question unable to regenerate. Re-arm auto-start so it
                    // regenerates on the new engine without starting a new chat. canAutoStart
                    // still gates on idle + no pending input, so an in-flight question stays.
                    guard OfficeHoursAutoStartPolicy.shouldRestartAfterProviderChange(from: previous, to: current),
                          let session else { return }
                    officeHoursStartedSessionIDs.remove(session.id)
                    startOfficeHoursIfNeeded(session: session, day1Content: day1Content, day: activeDay)
                }
            }
        }
    }

    private func officeHoursMainScrollBottomPadding(session: ChatSession?, modePicked: Bool) -> CGFloat {
        guard modePicked, session?.pendingUserInput != nil else { return 32 }
        return 16
    }

    private func shouldShowOfficeHoursCommitmentBar(activeDay: Int) -> Bool {
        activeDay != 1 || officeHoursDay1DocumentsWritten
    }

    private func shouldRenderOfficeHoursCommitmentBar(session: ChatSession?, activeDay: Int) -> Bool {
        guard shouldShowOfficeHoursCommitmentBar(activeDay: activeDay),
              let stepStatus = officeHoursCommitmentStepStatus(activeDay: activeDay) else {
            return false
        }
        if activeDay == 1, stepStatus == .done {
            return true
        }
        return stepStatus == .active && officeHoursInterviewComplete(session: session)
    }

    private func officeHoursCommitmentStepID(for day: Int) -> String {
        day == 1 ? "first_interview" : "interview"
    }

    private func officeHoursCommitmentStepStatus(activeDay: Int) -> DayStepStatus? {
        viewModel.dayProgress?.record(forDay: activeDay)?.steps[officeHoursCommitmentStepID(for: activeDay)]
    }

    private func officeHoursDay1CommitmentClosed(activeDay: Int) -> Bool {
        activeDay == 1
            && officeHoursDay1DocumentsWritten
            && officeHoursCommitmentStepStatus(activeDay: activeDay) == .done
    }

    private func shareOpenDesignOfficeHoursScreenshot(anchorView: NSView?, activeDay: Int) {
        guard let image = officeHoursScreenshotImage(),
              let url = writeOfficeHoursScreenshot(image, activeDay: activeDay) else {
            NSSound.beep()
            return
        }

        let picker = NSSharingServicePicker(items: [url])
        officeHoursSharePicker = picker

        guard let presenter = anchorView ?? officeHoursMainScrollCaptureAnchor ?? NSApp.keyWindow?.contentView else {
            NSSound.beep()
            return
        }
        let rect = presenter.bounds.width > 0 && presenter.bounds.height > 0
            ? presenter.bounds
            : NSRect(x: 0, y: 0, width: 1, height: 1)
        picker.show(relativeTo: rect, of: presenter, preferredEdge: .minY)
    }

    private func officeHoursScreenshotImage() -> NSImage? {
        guard let scrollView = officeHoursCaptureScrollView(),
              let documentView = scrollView.documentView else {
            return nil
        }

        documentView.layoutSubtreeIfNeeded()
        let bounds = documentView.bounds
        guard bounds.width > 1, bounds.height > 1 else { return nil }
        guard let bitmap = documentView.bitmapImageRepForCachingDisplay(in: bounds) else { return nil }
        bitmap.size = bounds.size
        documentView.cacheDisplay(in: bounds, to: bitmap)

        let image = NSImage(size: bounds.size)
        image.addRepresentation(bitmap)
        return image
    }

    private func officeHoursCaptureScrollView() -> NSScrollView? {
        if let scrollView = officeHoursMainScrollCaptureAnchor?.enclosingScrollView {
            return scrollView
        }

        guard let root = NSApp.keyWindow?.contentView else { return nil }
        var scrollViews: [NSScrollView] = []
        func collectScrollViews(from view: NSView) {
            if let scrollView = view as? NSScrollView {
                scrollViews.append(scrollView)
            }
            for subview in view.subviews {
                collectScrollViews(from: subview)
            }
        }
        collectScrollViews(from: root)

        return scrollViews
            .filter { $0.frame.width > 480 }
            .max { lhs, rhs in
                let lhsHeight = lhs.documentView?.bounds.height ?? lhs.bounds.height
                let rhsHeight = rhs.documentView?.bounds.height ?? rhs.bounds.height
                return lhsHeight < rhsHeight
            }
    }

    private func writeOfficeHoursScreenshot(_ image: NSImage, activeDay: Int) -> URL? {
        var proposedRect = NSRect(origin: .zero, size: image.size)
        guard let cgImage = image.cgImage(forProposedRect: &proposedRect, context: nil, hints: nil) else {
            return nil
        }
        let bitmap = NSBitmapImageRep(cgImage: cgImage)
        bitmap.size = image.size
        guard let pngData = bitmap.representation(using: .png, properties: [:]) else {
            return nil
        }

        let fileName = "agentic30-office-hours-day-\(activeDay)-\(UUID().uuidString).png"
        let url = FileManager.default.temporaryDirectory.appendingPathComponent(fileName)
        do {
            try pngData.write(to: url, options: .atomic)
            return url
        } catch {
            return nil
        }
    }

    private func officeHoursTutorHead() -> some View {
        HStack(spacing: 8) {
            Text("office-hours@agentic30")
                .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.accent)
            Text("~/strategy/session")
                .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
            Text("$")
                .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
            OfficeHoursCommandTypewriterText(
                text: " start startup --write-design-doc",
                reduceMotion: reduceMotion
            )
        }
        .frame(minHeight: 18, alignment: .leading)
    }

    @ViewBuilder
    private func officeHoursGoalSelectionBlock(
        session: ChatSession?,
        day1Content: OpenDesignDayContent
    ) -> some View {
        let drafts = viewModel.day1GoalDrafts
        let activeDraft = officeHoursActiveGoalDraft(drafts: drafts)
        let productSubject = openDesignDay1GoalSubject(
            openDesignDay1GoalProductName(
                situationSummaryName: viewModel.scanResult?.day1SituationSummary?.project.name,
                alignmentProductName: viewModel.scanResult?.day1AlignmentPlan?.signals.productName,
                icpProductName: viewModel.scanResult?.day1IcpPlan?.signals.productName
            )
        )

        VStack(alignment: .leading, spacing: 14) {
            officeHoursSectionHeader("목표 확립")

            VStack(alignment: .leading, spacing: 14) {
                Text(openDesignAttributedText(
                    [.strong(productSubject), .body(" "), .mark("30일"), .body(" 동안 "), .strong("증명할 목표 하나"), .body("를 먼저 정합니다.")],
                    bodySize: 18,
                    bodyWeight: .semibold,
                    strongWeight: .bold,
                    bodyColor: OpenDesignOfficeHoursColor.fg,
                    markColor: OpenDesignOfficeHoursColor.amber,
                    markBackground: OpenDesignOfficeHoursColor.amberDim
                ))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .fixedSize(horizontal: false, vertical: true)

                Text(openDesignAttributedText(
                    [.body("선택한 목표를 기준으로 Day 1 질문을 만들고 확정하면 "), .code(".agentic30/docs/GOAL.md"), .body("에 기록합니다.")],
                    bodySize: 12.5,
                    bodyWeight: .medium,
                    bodyColor: OpenDesignOfficeHoursColor.fgSecondary,
                    codeColor: OpenDesignOfficeHoursColor.accent,
                    codeBackground: OpenDesignOfficeHoursColor.bgDarker
                ))
                    .fixedSize(horizontal: false, vertical: true)

                if drafts.isEmpty {
                    officeHoursGoalEmptyState()
                } else {
                    LazyVGrid(
                        columns: [GridItem(.adaptive(minimum: 168), spacing: 8, alignment: .top)],
                        alignment: .leading,
                        spacing: 8
                    ) {
                        ForEach(drafts) { draft in
                            officeHoursGoalOptionButton(draft, activeDraft: activeDraft)
                        }
                    }

                    if let activeDraft {
                        VStack(spacing: 1) {
                            officeHoursGoalDetailRow("고객", activeDraft.customer, emphasis: activeDraft.customerEmphasis)
                            officeHoursGoalDetailRow("문제", activeDraft.problem, emphasis: activeDraft.problemEmphasis)
                            officeHoursGoalDetailRow("목표", activeDraft.goalText, strong: true)
                        }
                        .background(OpenDesignOfficeHoursColor.borderSoft)
                        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
                        .overlay(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                        )
                    }

                    officeHoursGoalStartButton(
                        activeDraft: activeDraft,
                        session: session,
                        day1Content: day1Content
                    )
                }

                if let error = viewModel.day1GoalError?.trimmingCharacters(in: .whitespacesAndNewlines),
                   !error.isEmpty {
                    Text(error)
                        .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                        .fixedSize(horizontal: false, vertical: true)
                }
            }
            .padding(16)
            .background(openDesignOfficeHoursBackground(cornerRadius: 14, fill: OpenDesignOfficeHoursColor.surface))
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(OpenDesignOfficeHoursColor.accent)
                    .frame(width: 3)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.goal.card")
    }

    @ViewBuilder
    private func officeHoursGoalStartButton(
        activeDraft: Day1GoalDraft?,
        session: ChatSession?,
        day1Content: OpenDesignDayContent
    ) -> some View {
        let canStart = activeDraft != nil
        Button {
            guard let activeDraft else { return }
            saveOfficeHoursGoalAndStart(activeDraft, session: session, day1Content: day1Content)
        } label: {
            HStack(spacing: 8) {
                Text(canStart ? "이 목표로 시작하기" : "목표를 하나 고르세요")
                    .font(.system(size: 13, weight: .semibold))
                Spacer(minLength: 0)
                Image(systemName: "arrow.right")
                    .font(.system(size: 12, weight: .semibold))
            }
            .foregroundStyle(canStart ? OpenDesignOfficeHoursColor.bgDeep : OpenDesignOfficeHoursColor.muted)
            .padding(.horizontal, 14)
            .frame(height: 40)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(canStart ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.surface2)
            )
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(canStart ? Color.clear : OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
            )
        }
        .buttonStyle(.plain)
        .disabled(!canStart)
        .accessibilityIdentifier("opendesign.officeHours.goal.save")
    }

    private func officeHoursGoalEmptyState() -> some View {
        VStack(alignment: .leading, spacing: 7) {
            Text("스캔 또는 온보딩 컨텍스트를 기다리는 중입니다.")
                .font(.system(size: 13, weight: .semibold))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
            Text("컨텍스트가 들어오면 첫 매출 달성, 활성 사용자 100명 모으기, 작동하는 첫 버전 출시 중 30일 목표를 바로 고를 수 있습니다.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(openDesignOfficeHoursBackground(cornerRadius: 10, fill: OpenDesignOfficeHoursColor.surface2))
    }

    private func officeHoursActiveGoalDraft(drafts: [Day1GoalDraft]) -> Day1GoalDraft? {
        // No default selection: a goal becomes active only after the user taps an
        // option, so the start button stays disabled until then.
        guard let type = selectedOfficeHoursGoalType else { return nil }
        return drafts.first(where: { $0.goalType == type })
    }

    private func officeHoursGoalOptionButton(
        _ draft: Day1GoalDraft,
        activeDraft: Day1GoalDraft?
    ) -> some View {
        let isSelected = activeDraft?.goalType == draft.goalType
        return Button {
            selectedOfficeHoursGoalType = draft.goalType
        } label: {
            VStack(alignment: .leading, spacing: 8) {
                Text(draft.goalType.title)
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    .lineLimit(1)
                    .frame(maxWidth: .infinity, alignment: .leading)
                Text(openDesignAttributedText(
                    [.body(draft.goalType.promptHint)],
                    bodySize: 11.5,
                    bodyWeight: .medium,
                    bodyColor: OpenDesignOfficeHoursColor.muted
                ))
                    .fixedSize(horizontal: false, vertical: true)
            }
            .padding(10)
            .frame(maxWidth: .infinity, minHeight: 96, alignment: .topLeading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? OpenDesignOfficeHoursColor.accentDim : OpenDesignOfficeHoursColor.surface2)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(isSelected ? OpenDesignOfficeHoursColor.accentLine : OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("opendesign.officeHours.goal.option.\(draft.goalType.rawValue)")
        .accessibilityValue(isSelected ? "active" : "inactive")
    }

    private func officeHoursGoalDetailRow(
        _ key: String,
        _ value: String,
        strong: Bool = false,
        emphasis: [EmphasisSpan] = []
    ) -> some View {
        let baseColor = strong ? OpenDesignOfficeHoursColor.fg : OpenDesignOfficeHoursColor.fgSecondary
        let baseWeight: Font.Weight = strong ? .semibold : .medium
        return HStack(alignment: .firstTextBaseline, spacing: 14) {
            Text(key)
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                .frame(width: 48, alignment: .leading)
            Group {
                if emphasis.isEmpty {
                    Text(value)
                        .font(.system(size: 12.5, weight: baseWeight))
                        .foregroundStyle(baseColor)
                } else {
                    Text(Self.officeHoursEmphasisAttributedText(
                        value,
                        emphasis: emphasis,
                        bodySize: 12.5,
                        bodyWeight: baseWeight,
                        bodyColor: baseColor
                    ))
                }
            }
            .fixedSize(horizontal: false, vertical: true)
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(OpenDesignOfficeHoursColor.surface)
    }

    /// Build an office-hours-palette `AttributedString` from dynamic emphasis
    /// spans over a base value. Mirrors the Stage 1 `styledRanges` matching
    /// (longest-first, non-overlapping, case/diacritic-insensitive) and the
    /// strong/mark/code color treatment, so static rows share the inline
    /// statement look. Spans that don't match `value` are simply skipped.
    static func officeHoursEmphasisAttributedText(
        _ value: String,
        emphasis: [EmphasisSpan],
        bodySize: CGFloat,
        bodyWeight: Font.Weight,
        bodyColor: Color
    ) -> AttributedString {
        let normalized = emphasis
            .map { (phrase: $0.phrase.trimmingCharacters(in: .whitespacesAndNewlines), style: $0.style) }
            .filter { !$0.phrase.isEmpty }
            .sorted { $0.phrase.count > $1.phrase.count }

        guard !value.isEmpty, !normalized.isEmpty else {
            var base = AttributedString(value)
            base.font = .system(size: bodySize, weight: bodyWeight)
            base.foregroundColor = bodyColor
            return base
        }

        var styledRanges: [(range: Range<String.Index>, style: EmphasisStyle)] = []
        for entry in normalized {
            var searchRange = value.startIndex..<value.endIndex
            while let range = value.range(
                of: entry.phrase,
                options: [.caseInsensitive, .diacriticInsensitive],
                range: searchRange
            ) {
                if !styledRanges.contains(where: { $0.range.overlaps(range) }) {
                    styledRanges.append((range, entry.style))
                }
                searchRange = range.upperBound..<value.endIndex
            }
        }
        styledRanges.sort { $0.range.lowerBound < $1.range.lowerBound }

        guard !styledRanges.isEmpty else {
            var base = AttributedString(value)
            base.font = .system(size: bodySize, weight: bodyWeight)
            base.foregroundColor = bodyColor
            return base
        }

        func bodyRun(_ text: Substring) -> AttributedString {
            var run = AttributedString(String(text))
            run.font = .system(size: bodySize, weight: bodyWeight)
            run.foregroundColor = bodyColor
            return run
        }

        var result = AttributedString()
        var cursor = value.startIndex
        for entry in styledRanges {
            if cursor < entry.range.lowerBound {
                result += bodyRun(value[cursor..<entry.range.lowerBound])
            }
            var run = AttributedString(String(value[entry.range]))
            switch entry.style {
            case .strong:
                run.font = .system(size: bodySize, weight: .semibold)
                run.foregroundColor = OpenDesignOfficeHoursColor.fg
            case .mark:
                run.font = .system(size: bodySize, weight: .semibold)
                run.foregroundColor = OpenDesignOfficeHoursColor.amber
                run.backgroundColor = OpenDesignOfficeHoursColor.amberDim
            case .code:
                run.font = .system(size: bodySize, weight: .medium, design: .monospaced)
                run.foregroundColor = OpenDesignOfficeHoursColor.accent
                run.backgroundColor = OpenDesignOfficeHoursColor.bgDarker
            }
            result += run
            cursor = entry.range.upperBound
        }
        if cursor < value.endIndex {
            result += bodyRun(value[cursor...])
        }
        return result
    }

    private func saveOfficeHoursGoalAndStart(
        _ draft: Day1GoalDraft,
        session: ChatSession?,
        day1Content: OpenDesignDayContent
    ) {
        selectedOfficeHoursGoalType = draft.goalType
        guard viewModel.saveDay1GoalDraft(draft, workspaceRoot: openDesignInteractionWorkspaceRoot) else {
            return
        }
        selectedOfficeHoursMode = .startup
        DispatchQueue.main.async {
            pendingOfficeHoursStartMode = .startup
            pendingOfficeHoursStartDay = 1
            pendingOfficeHoursStartTrigger = nil
            _ = viewModel.ensureOfficeHoursSession(forDay: 1)
            continuePendingOfficeHoursStart(
                session: viewModel.selectedSession ?? session,
                day1Content: day1Content,
                day: 1
            )
        }
    }

    private func officeHoursIntroSection(activeDay: Int) -> some View {
        let title = viewModel.day1GoalSelection == nil
            ? "오피스아워를 한 단계씩 좁힙니다."
            : "Day \(activeDay) 목표를 인터뷰로 검증합니다."
        let titleDelay: UInt64 = reduceMotion ? 0 : 120_000_000
        let bodyDelay = reduceMotion
            ? 0
            : titleDelay + OfficeHoursTypewriterTiming.totalDelayNanoseconds(
                for: title,
                baseMilliseconds: 14,
                completionMilliseconds: 80
            )
        return VStack(alignment: .leading, spacing: 6) {
            OfficeHoursTypewriterText(
                text: title,
                font: .system(size: 20, weight: .semibold),
                foregroundColor: OpenDesignOfficeHoursColor.fg,
                lineSpacing: 0,
                reduceMotion: reduceMotion,
                baseSpeedMilliseconds: 14,
                initialDelayNanoseconds: titleDelay
            )
            .accessibilityIdentifier("opendesign.officeHours.intro.title")
            OfficeHoursTypewriterText(
                text: viewModel.day1GoalSelection == nil
                    ? "Startup 진단으로 질문이 하나씩 열립니다."
                    : "선택한 Day의 목표만 기준으로 한 번에 하나의 structured input 질문이 열립니다.",
                font: .system(size: 13.5, weight: .medium),
                foregroundColor: OpenDesignOfficeHoursColor.fgSecondary,
                lineSpacing: 3,
                reduceMotion: reduceMotion,
                baseSpeedMilliseconds: 3,
                initialDelayNanoseconds: bodyDelay
            )
            .accessibilityIdentifier("opendesign.officeHours.intro.body")
        }
        .padding(.top, 10)
    }

    private func officeHoursIntroContextStack(
        idPrefix: String,
        activeDay: Int,
        introDelayNanoseconds: UInt64,
        contextDelayNanoseconds: UInt64
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            OfficeHoursIntroStageReveal(
                id: "\(idPrefix)-intro-\(selectedOfficeHoursMode.rawValue)",
                delayNanoseconds: introDelayNanoseconds
            ) {
                officeHoursIntroSection(activeDay: activeDay)
            }
            OfficeHoursIntroStageReveal(
                id: "\(idPrefix)-context-\(selectedOfficeHoursMode.rawValue)",
                delayNanoseconds: contextDelayNanoseconds
            ) {
                officeHoursSignalList(activeDay: activeDay)
            }
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func officeHoursIntroContextContent(activeDay: Int) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            officeHoursIntroSection(activeDay: activeDay)
            officeHoursSignalList(activeDay: activeDay)
        }
        .frame(maxWidth: .infinity, alignment: .leading)
    }

    private func officeHoursSectionHeader(_ title: String, meta: String? = nil) -> some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(OpenDesignOfficeHoursColor.accent)
                .frame(width: 4, height: 12)
            Text(title)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                .tracking(1.1)
                .textCase(.uppercase)
            if let meta {
                Text(meta)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
            }
            Rectangle()
                .fill(OpenDesignOfficeHoursColor.borderSoft)
                .frame(height: 1)
        }
        .padding(.top, 0)
        .padding(.bottom, 2)
    }

    private func officeHoursSignalList(activeDay: Int) -> some View {
        let dayGoal = officeHoursGoalLine(forDay: activeDay)
        let first = viewModel.day1GoalSelection.map { selection in
            activeDay == 1 ? selection.officeHoursPurposeLine : "Day \(activeDay) · \(dayGoal)"
        } ?? "막연한 아이디어를 다음 실행 1개로 압축합니다."
        let second = viewModel.day1GoalSelection.map { selection in
            activeDay == 1 ? selection.officeHoursProgressLine : selection.officeHoursPurposeLine
        } ?? "Startup 관점으로 고정해 한 번에 하나의 질문에 답합니다."
        let rowStartDelay: UInt64 = reduceMotion ? 0 : 120_000_000
        let secondDelay = rowStartDelay + OfficeHoursTypewriterTiming.totalDelayNanoseconds(
            for: first,
            baseMilliseconds: 4,
            completionMilliseconds: 80
        )
        let thirdDelay = secondDelay + OfficeHoursTypewriterTiming.totalDelayNanoseconds(
            for: second,
            baseMilliseconds: 4,
            completionMilliseconds: 80
        )
        return VStack(alignment: .leading, spacing: 12) {
            officeHoursSectionHeader("세션 컨텍스트", meta: viewModel.day1GoalSelection == nil ? "startup + evidence" : "day-scoped goal + evidence")
            VStack(spacing: 1) {
                officeHoursSignalRow(key: "목적", value: first, typewriterDelayNanoseconds: rowStartDelay)
                officeHoursSignalRow(key: "진행", value: second, typewriterDelayNanoseconds: secondDelay)
                officeHoursSignalRow(
                    key: "출력",
                    value: viewModel.day1GoalSelection?.officeHoursOutputLine
                        ?? "로컬 증거만 유지 · 승인 전 게시/문서 없음",
                    typewriterDelayNanoseconds: thirdDelay
                )
                .id(Self.officeHoursQuestionOutputRowID)
            }
            .background(OpenDesignOfficeHoursColor.borderSoft)
            .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
            )
        }
        .accessibilityIdentifier("opendesign.officeHours.context")
    }

    private func officeHoursSignalRow(
        key: String,
        value: String,
        typewriterDelayNanoseconds: UInt64 = 0
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 16) {
            Text(key)
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                .tracking(0.6)
                .textCase(.uppercase)
                .frame(width: 132, alignment: .leading)
            OfficeHoursTypewriterText(
                text: value,
                font: .system(size: 13, weight: .medium),
                foregroundColor: OpenDesignOfficeHoursColor.fgSecondary,
                lineSpacing: 3,
                reduceMotion: reduceMotion,
                baseSpeedMilliseconds: 4,
                initialDelayNanoseconds: typewriterDelayNanoseconds
            )
                .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 16)
        .padding(.vertical, 12)
        .background(OpenDesignOfficeHoursColor.surface)
    }

    private func officeHoursModeSection(session: ChatSession?, day1Content: OpenDesignDayContent) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            officeHoursSectionHeader("Startup 진단", meta: "Mission · 1 of 1")
            VStack(alignment: .leading, spacing: 0) {
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text("Mission")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                        .tracking(1.2)
                        .textCase(.uppercase)
                        .padding(.horizontal, 8)
                        .frame(height: 22)
                        .background(Capsule().fill(OpenDesignOfficeHoursColor.amberDim))
                        .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.amber.opacity(0.30), lineWidth: 1))
                    OfficeHoursMissionTitleTypewriterText(
                        reduceMotion: reduceMotion,
                        initialDelayNanoseconds: reduceMotion ? 0 : 120_000_000
                    )
                }
                .padding(.horizontal, 20)
                .padding(.top, 18)
                .padding(.bottom, 8)

                Text("수요 증거부터 바로 첫 질문이 열립니다.")
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                    .padding(.horizontal, 20)
                    .padding(.bottom, 14)

                VStack(spacing: 2) {
                    officeHoursModeCard(.startup, session: session)
                }
                .padding(6)
                .background(OpenDesignOfficeHoursColor.bgDeep)
                .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .top)

                Button {
                    startOfficeHours(mode: selectedOfficeHoursMode, session: session, day1Content: day1Content, day: 1)
                } label: {
                    HStack(spacing: 8) {
                        Text(officeHoursRunButtonTitle(session: session, activeDay: 1))
                            .font(.system(size: 13, weight: .semibold))
                        Spacer(minLength: 0)
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(officeHoursCanStart(session: session, activeDay: 1) ? OpenDesignOfficeHoursColor.bgDeep : OpenDesignOfficeHoursColor.mutedDeep)
                    .padding(.horizontal, 14)
                    .frame(height: 40)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(officeHoursCanStart(session: session, activeDay: 1) ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.surface2)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(officeHoursCanStart(session: session, activeDay: 1) ? Color.clear : OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(.plain)
                .disabled(!officeHoursCanStart(session: session, activeDay: 1))
                .accessibilityIdentifier("opendesign.officeHours.start")
                .padding(12)
                .background(OpenDesignOfficeHoursColor.surface)
                .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .top)
            }
            .background(
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [OpenDesignOfficeHoursColor.surface, OpenDesignOfficeHoursColor.surface2],
                            startPoint: .top,
                            endPoint: .bottom
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
                    )
            )
            .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
            .overlay(alignment: .leading) {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(OpenDesignOfficeHoursColor.amber)
                    .frame(width: 3)
                    .shadow(color: OpenDesignOfficeHoursColor.amber.opacity(0.45), radius: 7)
            }
        }
    }

    private func officeHoursModeCard(
        _ mode: OfficeHoursMode,
        session: ChatSession?
    ) -> some View {
        let isSelected = selectedOfficeHoursMode == mode
        return Button {
            selectedOfficeHoursMode = mode
        } label: {
            HStack(alignment: .center, spacing: 12) {
                Text(mode.label)
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                    .tracking(0.8)
                    .textCase(.uppercase)
                    .frame(width: 78, alignment: .leading)

                VStack(alignment: .leading, spacing: 3) {
                    Text(mode.headline)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                    Text(mode.detail)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Text("\(mode.questionCount)문항")
                    .font(.system(size: 10, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
                    .lineLimit(1)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .frame(maxWidth: .infinity, minHeight: 68, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isSelected ? OpenDesignOfficeHoursColor.accentDim : Color.clear)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(isSelected ? OpenDesignOfficeHoursColor.accentLine : Color.clear, lineWidth: 1)
                    )
            )
        }
        .buttonStyle(.plain)
        .disabled(!officeHoursCanStart(session: session))
        .accessibilityIdentifier("opendesign.officeHours.modeCard.\(mode.rawValue)")
    }

    private func officeHoursModeSummary(session: ChatSession?) -> some View {
        HStack(spacing: 12) {
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text("\(selectedOfficeHoursMode.label) mode")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                Text("\(officeHoursAnswerCount(session: session)) / \(officeHoursQuestionTotal(session: session)) · 목표 인터뷰")
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.muted)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 12)
        .frame(minHeight: 40)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(OpenDesignOfficeHoursColor.accentDim)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1)
                )
        )
    }

    private func officeHoursQuestionStage(
        session: ChatSession?,
        day1Content: OpenDesignDayContent,
        activeDay: Int,
        viewportHeight: CGFloat
    ) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            officeHoursTutorHead()
                .id(Self.officeHoursQuestionStageTopID)
            officeHoursIntroContextContent(activeDay: activeDay)

            if let session {
                let snapshots = officeHoursSubmittedPromptSnapshots(for: session)
                let activeLoading = officeHoursActiveQuestionLoader(for: session)
                let timeline = officeHoursTimelineItems(
                    for: session,
                    submittedSnapshots: snapshots,
                    activeLoading: activeLoading
                )
                let shouldShowFallbackLiveStatus = activeLoading == nil
                    && OfficeHoursLiveStatusPolicy.shouldShowDetachedLiveStatus(
                        in: session,
                        rows: OfficeHoursLiveStatusPolicy.visibleRows(in: session)
                    )

                ForEach(timeline) { item in
                    switch item {
                    case .row(let row):
                        officeHoursTranscriptRow(row, session: session)
                            .id(row.id)
                    case .submittedPrompt(let card):
                        officeHoursSubmittedPromptBlock(card, session: session)
                            .id(card.id)
                    case .loading(let loading):
                        officeHoursQuestionLoader(
                            title: officeHoursLoaderTitle(session: session),
                            detail: officeHoursLoaderDetail(session: session),
                            outputLines: viewModel.sidecarOutputPreview(for: session.id),
                            accent: officeHoursLoaderAccent(session: session)
                        )
                        .id(loading.requestId)
                    }
                }

                let pendingPresentation = OfficeHoursPendingPromptPresentation.resolve(
                    answerCount: officeHoursAnswerCount(session: session),
                    fallbackTotal: selectedOfficeHoursMode.questionCount,
                    generationTotal: session.pendingUserInput?.generation?.dimensionTotal,
                    interviewComplete: officeHoursInterviewComplete(session: session)
                )

                if let prompt = session.pendingUserInput,
                   !officeHoursRevisionInFlightSessionIDs.contains(session.id),
                   pendingPresentation.shouldRender {
                    let currentPromptWasSubmitted = snapshots.contains(where: { $0.requestId == prompt.requestId })
                    if !currentPromptWasSubmitted {
                        let revealID = officeHoursPromptRevealID(sessionID: session.id, requestID: prompt.requestId)
                        OfficeHoursMinimumLoading(
                            id: "\(session.id)-\(prompt.requestId)",
                            durationNanoseconds: reduceMotion
                                ? 0
                                : officeHoursRemainingQuestionLoadingNanoseconds(for: session.id),
                            onReadyChange: { isReady in
                                if isReady {
                                    officeHoursReadyPromptRevealIDs.insert(revealID)
                                } else {
                                    officeHoursReadyPromptRevealIDs.remove(revealID)
                                }
                            },
                            loader: {
                                officeHoursQuestionLoader(
                                    title: officeHoursLoaderTitle(session: session),
                                    detail: officeHoursLoaderDetail(session: session),
                                    outputLines: viewModel.sidecarOutputPreview(for: session.id),
                                    accent: officeHoursLoaderAccent(session: session)
                                )
                            },
                            content: {
                                officeHoursPendingPromptBlock(prompt, session: session)
                            }
                        )
                            .id(prompt.requestId)
                            .transition(.officeHoursPromptReveal)
                    }
                } else if shouldShowFallbackLiveStatus {
                    officeHoursRunningStatusBlock(session: session)
                        .id("running-status-\(session.id)")
                        .transition(.opacity.combined(with: .move(edge: .top)))
                } else if session.status == .error {
                    officeHoursFailureBlock(session: session, day1Content: day1Content, activeDay: activeDay)
                        .id("office-hours-failure-\(session.id)")
                        .transition(.officeHoursPromptReveal)
                } else if !timeline.isEmpty && session.status != .running {
                    if officeHoursIsDocReady(session: session) {
                        officeHoursDocReadyBlock(session: session)
                            .transition(.officeHoursPromptReveal)
                    } else {
                        // An idle session that hasn't finished its question
                        // count is a stalled interview, not a chat handoff —
                        // surface the explicit failure (with retry) instead of
                        // the removed free-text composer fallback.
                        officeHoursFailureBlock(session: session, day1Content: day1Content, activeDay: activeDay)
                            .id("office-hours-incomplete-\(session.id)")
                            .transition(.officeHoursPromptReveal)
                    }
                }

                if let pendingPrompt = session.pendingUserInput,
                   pendingPresentation.shouldRender {
                    let currentPromptWasSubmitted = snapshots.contains(where: { $0.requestId == pendingPrompt.requestId })
                    Color.clear
                        .frame(height: officeHoursPendingPromptTailHeight(
                            viewportHeight: viewportHeight,
                            submittedPromptCount: snapshots.count,
                            currentPromptWasSubmitted: currentPromptWasSubmitted,
                            hasActiveLoading: activeLoading != nil
                        ))
                        .accessibilityHidden(true)
                }
            } else {
                officeHoursLoadingSession()
            }
        }
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.22), value: session?.pendingUserInput?.requestId)
        .animation(reduceMotion ? nil : .easeOut(duration: 0.18), value: session?.messages.count ?? 0)
    }

    private func officeHoursPendingPromptTailHeight(
        viewportHeight: CGFloat,
        submittedPromptCount: Int,
        currentPromptWasSubmitted: Bool,
        hasActiveLoading: Bool
    ) -> CGFloat {
        let isFirstActiveQuestion = submittedPromptCount == 0 && !currentPromptWasSubmitted && !hasActiveLoading
        let lowerBound: CGFloat = isFirstActiveQuestion ? 24 : 48
        let upperBound: CGFloat = isFirstActiveQuestion ? 32 : 72
        let fallback: CGFloat = isFirstActiveQuestion ? 28 : 56
        let ratio: CGFloat = isFirstActiveQuestion ? 0.04 : 0.08

        guard viewportHeight > 0 else { return fallback }
        return min(max(viewportHeight * ratio, lowerBound), upperBound)
    }

    private func officeHoursRunningStatusBlock(session: ChatSession) -> some View {
        VStack(spacing: 0) {
            officeHoursQuestionLoader(
                title: officeHoursLoaderTitle(session: session),
                detail: officeHoursLoaderDetail(session: session),
                outputLines: viewModel.sidecarOutputPreview(for: session.id),
                accent: officeHoursLoaderAccent(session: session)
            )
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.liveStatus")
    }

    private func officeHoursFailureBlock(
        session: ChatSession,
        day1Content: OpenDesignDayContent,
        activeDay: Int
    ) -> some View {
        let logLines = viewModel.sidecarOutputPreview(for: session.id)
        let errorText = session.error?.nonEmpty
            ?? session.messages.last(where: { $0.state == .error })?.error?.nonEmpty
            ?? session.messages.last(where: { $0.state == .error })?.content.nonEmpty
            ?? viewModel.lastError?.nonEmpty
            ?? "AI 연결이 유효한 질문 카드 요청을 반환하지 않았습니다."
        // Codex → Claude → Gemini rotation; only providers the sidecar reports
        // as connected qualify, mirroring the settings picker gate.
        let fallbackProvider = session.provider.nextFallbackProvider { candidate in
            officeHoursProviderEnvironment(for: candidate)?.available == true
        }
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 14, weight: .semibold))
                    .foregroundStyle(OpenDesignOfficeHoursColor.rose)
                    .frame(width: 22, height: 22)
                VStack(alignment: .leading, spacing: 5) {
                    Text("Day \(activeDay) 인터뷰 질문을 만들지 못했습니다")
                        .font(.system(size: 15, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    Text("\(session.provider.title): \(errorText)")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                        .textSelection(.enabled)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
                if let fallbackProvider {
                    Button {
                        viewModel.setActiveProvider(fallbackProvider)
                        retryOfficeHoursAfterFailure(day1Content: day1Content, day: activeDay)
                    } label: {
                        HStack(spacing: 7) {
                            Image(systemName: "arrow.triangle.2.circlepath")
                                .font(.system(size: 11, weight: .semibold))
                            Text("\(fallbackProvider.title)로 전환")
                                .font(.system(size: 12, weight: .semibold))
                        }
                        .foregroundStyle(OpenDesignOfficeHoursColor.bgDeep)
                        .padding(.horizontal, 11)
                        .frame(height: 30)
                        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(OpenDesignOfficeHoursColor.accent))
                    }
                    .buttonStyle(.plain)
                    .help("\(session.provider.title) 대신 \(fallbackProvider.title)(으)로 다시 시도합니다. 기본 provider 설정도 함께 바뀝니다.")
                    .accessibilityIdentifier("opendesign.officeHours.failure.switchProvider")
                }
                Button {
                    retryOfficeHoursAfterFailure(day1Content: day1Content, day: activeDay)
                } label: {
                    HStack(spacing: 7) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .semibold))
                        Text("다시 시도")
                            .font(.system(size: 12, weight: .semibold))
                    }
                    .foregroundStyle(
                        fallbackProvider == nil
                            ? OpenDesignOfficeHoursColor.bgDeep
                            : OpenDesignOfficeHoursColor.fgSecondary
                    )
                    .padding(.horizontal, 11)
                    .frame(height: 30)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(
                                fallbackProvider == nil
                                    ? OpenDesignOfficeHoursColor.accent
                                    : OpenDesignOfficeHoursColor.hover
                            )
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("opendesign.officeHours.failure.retry")
            }

            DisclosureGroup {
                VStack(alignment: .leading, spacing: 6) {
                    if logLines.isEmpty {
                        Text("실행 보조 앱 로그를 불러올 수 없습니다")
                            .font(.system(size: 11, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                    } else {
                        ForEach(Array(logLines.suffix(8).enumerated()), id: \.offset) { _, line in
                            Text(line)
                                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                                .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                                .textSelection(.enabled)
                                .fixedSize(horizontal: false, vertical: true)
                                .frame(maxWidth: .infinity, alignment: .leading)
                        }
                    }
                }
                .padding(.top, 8)
            } label: {
                Text("실행 보조 앱 로그")
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
            }
            .accentColor(OpenDesignOfficeHoursColor.accent)
            .accessibilityIdentifier("opendesign.officeHours.failure.logs")
        }
        .padding(14)
        .background(openDesignOfficeHoursBackground(cornerRadius: 12, fill: OpenDesignOfficeHoursColor.surface))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2, style: .continuous)
                .fill(OpenDesignOfficeHoursColor.rose)
                .frame(width: 3)
                .padding(.vertical, 1)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.failure")
    }

    private func officeHoursSubmittedPromptSnapshots(for session: ChatSession) -> [OfficeHoursSubmittedPromptSnapshot] {
        var snapshots = officeHoursSubmittedPromptSnapshotsBySession[session.id] ?? []
        for stored in session.runtime?.officeHours?.promptSnapshots ?? [] {
            guard !snapshots.contains(where: { $0.requestId == stored.requestId }) else { continue }
            let submissions = stored.submissions.map { submission in
                AgenticViewModel.StructuredPromptSubmission(
                    question: submission.question,
                    selectedOptions: submission.selectedOptions,
                    freeText: submission.freeText
                )
            }
            snapshots.append(
                OfficeHoursSubmittedPromptSnapshot(
                    sessionId: session.id,
                    requestId: stored.requestId,
                    prompt: stored.prompt,
                    submissions: submissions,
                    submittedAt: stored.submittedAt,
                    isRestored: true,
                    isEditable: stored.editable == true
                )
            )
        }
        if let prompt = session.pendingUserInput,
           let submitted = viewModel.structuredPromptSubmissionState(for: session.id),
           submitted.requestId == prompt.requestId,
           !snapshots.contains(where: { $0.requestId == submitted.requestId }) {
            snapshots.append(
                OfficeHoursSubmittedPromptSnapshot(
                    sessionId: session.id,
                    requestId: submitted.requestId,
                    prompt: prompt,
                    submissions: submitted.responses,
                    submittedAt: submitted.submittedAt
                )
            )
        }
        return snapshots.sorted { lhs, rhs in
            if lhs.submittedAt == rhs.submittedAt { return lhs.requestId < rhs.requestId }
            return lhs.submittedAt < rhs.submittedAt
        }
    }

    private func officeHoursTimelineItems(
        for session: ChatSession,
        submittedSnapshots snapshots: [OfficeHoursSubmittedPromptSnapshot],
        activeLoading loading: OfficeHoursLoadingSnapshot? = nil
    ) -> [OfficeHoursTimelineItem] {
        OfficeHoursTimelineBuilder.items(
            rows: officeHoursRevisionInFlightSessionIDs.contains(session.id)
                ? []
                : OfficeHoursLiveStatusPolicy.visibleRows(in: session),
            submittedSnapshots: snapshots,
            activeLoading: loading,
            fallbackTotal: selectedOfficeHoursMode.questionCount
        )
    }

    private func officeHoursQuestionLoader(
        title: String?,
        detail: String?,
        outputLines: [String] = [],
        accent: Color = OpenDesignOfficeHoursColor.accent
    ) -> some View {
        HStack(alignment: .center, spacing: 14) {
            OfficeHoursLoaderOrb(reduceMotion: reduceMotion)

            VStack(alignment: .leading, spacing: 0) {
                if let title = title?.nonEmpty {
                    Text(title)
                        .font(.system(size: 13.5, weight: .medium))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let detail = detail?.nonEmpty {
                    Text(detail)
                        .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                        .padding(.top, title?.nonEmpty == nil ? 0 : 4)
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                OfficeHoursLoaderLine(reduceMotion: reduceMotion)
                    .frame(maxWidth: 260)
                    .padding(.top, title?.nonEmpty == nil && detail?.nonEmpty == nil ? 0 : 11)
            }
            .frame(maxWidth: .infinity, alignment: .leading)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [OpenDesignOfficeHoursColor.surface, OpenDesignOfficeHoursColor.surface2],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
        )
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(accent)
                .frame(width: 3)
                .shadow(color: accent.opacity(0.55), radius: 14)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
        }
        .transition(.opacity.combined(with: .move(edge: .top)))
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("opendesign.officeHours.questionLoader")
    }

    private func officeHoursCompletedAnswerSummaries(session: ChatSession?) -> [String] {
        guard let session else { return [] }

        let snapshots = officeHoursSubmittedPromptSnapshots(for: session)
        var answers = snapshots
            .map(\.answerSummary)
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }

        // Each snapshot's answer also lands in the transcript as a user row, so
        // dedup consumes at most ONE row per snapshot — the containment heuristic
        // must not let one short answer swallow several rows. Seeded rows only
        // consume sidecar-restored snapshots; live snapshots from this app run
        // must not swallow restored transcript rows.
        var unconsumedSnapshots = snapshots
        let transcriptAnswerRows = OfficeHoursTranscriptRow.rows(from: session.messages)
            .filter(\.isUser)

        for row in transcriptAnswerRows {
            let answer = row.content.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !answer.isEmpty else { continue }
            if let consumedIndex = unconsumedSnapshots.firstIndex(where: { snapshot in
                if row.isSeededInterviewTurn && !snapshot.isRestored {
                    return false
                }
                return snapshot.matchesTranscriptAnswer(answer)
            }) {
                unconsumedSnapshots.remove(at: consumedIndex)
                continue
            }
            answers.append(answer)
        }

        return answers
    }

    private func officeHoursCompletedQuestionCount(session: ChatSession?) -> Int {
        officeHoursCompletedAnswerSummaries(session: session).count
    }

    // 인터뷰 완료 판정. 답변 수가 모드 정원에 닿았거나, 사이드카가 종결 카드
    // (대안 비교) 답변 시점에 runtime.officeHours.terminalAnswered를 스탬프한
    // 경우. 시스템 프롬프트는 이미 답이 분명한 질문을 건너뛰므로(smart-skip)
    // 정원보다 적은 답변으로도 인터뷰가 정상 종결된다 — 카운트만 보면 종결된
    // 인터뷰가 영구 미완(5/6 blocked)으로 읽힌다.
    private func officeHoursInterviewComplete(session: ChatSession?) -> Bool {
        guard let session else { return false }
        if session.runtime?.officeHours?.terminalAnswered == true { return true }
        return officeHoursCompletedQuestionCount(session: session) >= selectedOfficeHoursMode.questionCount
    }

    // 카운터 표기용 분모. terminal 종결로 정원보다 적은 답변으로 끝난 인터뷰는
    // 답변 수를 분모로 써서 "5 / 6"처럼 미완으로 보이는 표기를 피한다.
    private func officeHoursQuestionTotal(session: ChatSession?) -> Int {
        let total = selectedOfficeHoursMode.questionCount
        guard let session,
              session.runtime?.officeHours?.terminalAnswered == true else { return total }
        let completed = officeHoursCompletedQuestionCount(session: session)
        return completed > 0 ? min(total, completed) : total
    }

    private func officeHoursActiveQuestionLoader(for session: ChatSession) -> OfficeHoursLoadingSnapshot? {
        OfficeHoursLoadingPolicy.visibleLoading(
            for: session,
            loading: officeHoursActiveQuestionLoadersBySession[session.id]
        )
    }

    private func officeHoursPromptRevealID(sessionID: String, requestID: String) -> String {
        "\(sessionID)::\(requestID)"
    }

    private func officeHoursPromptRevealIsReady(sessionID: String, requestID: String) -> Bool {
        officeHoursReadyPromptRevealIDs.contains(officeHoursPromptRevealID(sessionID: sessionID, requestID: requestID))
    }

    private func officeHoursLoaderTitle(session: ChatSession) -> String? {
        if let title = officeHoursLoaderCopy(session: session)?.title {
            return title
        }
        let completed = officeHoursCompletedQuestionCount(session: session)
        if completed == 0 {
            return "\(selectedOfficeHoursMode.label) 첫 질문 생성 중"
        }
        if officeHoursInterviewComplete(session: session) {
            // 마지막 답변 뒤는 '다음 질문'이 아니라 약속 단계로의 전환 — 카피와 액센트
            // (amber, officeHoursLoaderAccent)가 같이 바뀌어 질문 로더와 구분된다.
            return "약속 준비 중"
        }
        return "질문 \(completed + 1) 생성 중"
    }

    // 질문 로더는 초록(accent), 마지막 단계(약속 전환) 로더는 amber — 약속 카드의 좌측
    // 바와 같은 색으로 '질문 아님, 마무리' 신호를 로더 시점부터 잇는다.
    private func officeHoursLoaderAccent(session: ChatSession) -> Color {
        officeHoursInterviewComplete(session: session)
            ? OpenDesignOfficeHoursColor.amber
            : OpenDesignOfficeHoursColor.accent
    }

    private func officeHoursLoaderDetail(session: ChatSession) -> String? {
        if let detail = officeHoursLoaderCopy(session: session)?.detail {
            return detail
        }
        let completed = officeHoursCompletedQuestionCount(session: session)
        if completed == 0 {
            return "Startup 컨텍스트 · 증거 프레임 · 답변 선택지"
        }
        if officeHoursInterviewComplete(session: session) {
            return "답변 요약 · 고객 행동 후보 · 약속 카드 준비"
        }
        return "방금 답변 반영 · 다음 질문 프레임 · 선택지 준비"
    }

    private func officeHoursLoaderCopy(session: ChatSession) -> OfficeHoursLoaderCopy? {
        OfficeHoursLoaderCopy.resolve(
            status: viewModel.officeHoursLiveStatus(for: session.id)
        )
    }

    private func reconcileOfficeHoursActiveQuestionLoader(session: ChatSession?) {
        guard let session,
              officeHoursActiveQuestionLoadersBySession[session.id] != nil else {
            return
        }
        if officeHoursActiveQuestionLoader(for: session) == nil {
            officeHoursActiveQuestionLoadersBySession.removeValue(forKey: session.id)
            officeHoursRevisionInFlightSessionIDs.remove(session.id)
        }
    }

    private func officeHoursIsDocReady(session: ChatSession) -> Bool {
        let interviewComplete = officeHoursInterviewComplete(session: session)
        let blockingPendingInput = session.pendingUserInput != nil && !interviewComplete
        return !blockingPendingInput
            && session.status != .running
            && interviewComplete
    }

    private func officeHoursDocReadyBlock(session: ChatSession) -> some View {
        let completed = min(
            officeHoursCompletedQuestionCount(session: session),
            selectedOfficeHoursMode.questionCount
        )
        let total = officeHoursQuestionTotal(session: session)
        return VStack(alignment: .leading, spacing: 0) {
            Color.clear
                .frame(height: 22)
                .accessibilityHidden(true)
                .id(Self.officeHoursDocReadyHeaderID)

            VStack(alignment: .leading, spacing: 12) {
                officeHoursSectionHeader("Design doc 준비", meta: "Final · 저장 가능")
                VStack(alignment: .leading, spacing: 8.5) {
                    HStack(spacing: 8) {
                        Text("결론 · 다음 과제")
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                            .tracking(1.2)
                            .textCase(.uppercase)
                        Spacer(minLength: 0)
                        Text("\(completed) / \(total)")
                            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                            .padding(.horizontal, 8)
                            .frame(height: 20)
                            .background(Capsule().fill(OpenDesignOfficeHoursColor.accentDim))
                            .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1))
                    }

                    OfficeHoursAttributedInlineTypewriterText(
                        text: "전제와 접근안을 묶었습니다. 다음 과제는 \(selectedOfficeHoursMode.assignment)입니다.",
                        highlightPhrases: [selectedOfficeHoursMode.assignment],
                        reduceMotion: reduceMotion,
                        baseSpeedMilliseconds: 5
                    )
                    .frame(maxWidth: 668, alignment: .leading)
                    .padding(.bottom, 6)

                    HStack(spacing: 14) {
                        officeHoursDocCriterion("문제 확인")
                        officeHoursDocCriterion("전제 정리")
                        officeHoursDocCriterion("다음 행동 확정")
                    }
                    .padding(.top, 12)
                    .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .top)

                    officeHoursDocumentHandoffBlock(session: session)
                        .padding(.top, 5.5)
                }
                .padding(.horizontal, 20)
                .padding(.vertical, 18)
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(
                            LinearGradient(
                                colors: [OpenDesignOfficeHoursColor.surface, OpenDesignOfficeHoursColor.surface2],
                                startPoint: .top,
                                endPoint: .bottom
                            )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
                        )
                )
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.accent)
                        .frame(width: 3)
                        .shadow(color: OpenDesignOfficeHoursColor.accent.opacity(0.45), radius: 7)
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.docReady")
    }

    private func officeHoursDocCriterion(_ title: String) -> some View {
        HStack(spacing: 6) {
            Text("✓")
                .font(.system(size: 11, weight: .bold, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.accent)
            Text(title)
                .font(.system(size: 11, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.muted)
        }
    }

    private func officeHoursCanSaveDoc(session: ChatSession?) -> Bool {
        guard let session else { return false }
        return officeHoursIsDocReady(session: session)
    }

    private var officeHoursDocumentSpecs: [(type: String, title: String, path: String)] {
        [
            ("goal", "GOAL", ".agentic30/docs/GOAL.md"),
            ("icp", "Ideal Customer Profile", ".agentic30/docs/ICP.md"),
            ("values", "VALUES", ".agentic30/docs/VALUES.md"),
            ("spec", "SPEC", ".agentic30/docs/SPEC.md"),
        ]
    }

    private var officeHoursDocumentHandoffBusy: Bool {
        viewModel.day1DocHandoffPendingDocType != nil || viewModel.activeDay1HandoffPrompt != nil
    }

    private var officeHoursDay1DocumentsWritten: Bool {
        officeHoursDocumentSpecs.allSatisfy { officeHoursDocumentWritten(type: $0.type) }
    }

    private var officeHoursMetaDocSaveTitle: String {
        if officeHoursDocumentHandoffBusy { return "저장 중" }
        if officeHoursDay1DocumentsWritten { return "저장됨" }
        return "저장"
    }

    private func officeHoursDocumentWritten(type: String) -> Bool {
        guard let preview = viewModel.iddDocPreviews.first(where: { $0.type == type }) else {
            return false
        }
        let status = preview.status.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return status.hasPrefix("written") || status.hasPrefix("approved")
    }

    private func officeHoursDocumentDetail(type: String, path: String) -> String {
        if officeHoursDocumentWritten(type: type) {
            return "\(path) 저장됨"
        }
        if viewModel.day1DocHandoffPendingDocType == "all" || viewModel.day1DocHandoffPendingDocType == type {
            return "\(path) 저장 중"
        }
        if viewModel.activeDay1HandoffPrompt?.generation?.docType?.lowercased() == type {
            return "\(path) 질문 대기"
        }
        return "\(path) 저장 대기"
    }

    private func officeHoursDocumentAccessibilityValue(type: String) -> String {
        if officeHoursDocumentWritten(type: type) { return "written" }
        if viewModel.day1DocHandoffPendingDocType != nil { return "saving" }
        return "waiting"
    }

    private func officeHoursDocumentHandoffBlock(session: ChatSession) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack {
                Text("문서 저장")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
                    .textCase(.uppercase)
                Spacer(minLength: 0)
                Text("\(officeHoursDocumentSpecs.filter { officeHoursDocumentWritten(type: $0.type) }.count)/\(officeHoursDocumentSpecs.count)")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(officeHoursDay1DocumentsWritten ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.muted)
            }

            VStack(spacing: 7) {
                ForEach(Array(officeHoursDocumentSpecs.enumerated()), id: \.offset) { _, doc in
                    officeHoursDocumentRow(type: doc.type, title: doc.title, path: doc.path)
                }
            }

            Button {
                guard !officeHoursDay1DocumentsWritten else { return }
                startOfficeHoursDocumentHandoff(session: session)
            } label: {
                Text(officeHoursDocumentHandoffButtonTitle)
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(officeHoursDocumentHandoffButtonDisabled ? OpenDesignOfficeHoursColor.mutedDeep : OpenDesignOfficeHoursColor.bgDeep)
                    .frame(maxWidth: .infinity)
                    .frame(height: 40)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(officeHoursDocumentHandoffButtonDisabled ? OpenDesignOfficeHoursColor.surface2 : OpenDesignOfficeHoursColor.accent)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(officeHoursDocumentHandoffButtonDisabled ? OpenDesignOfficeHoursColor.borderSoft : Color.clear, lineWidth: 1)
                            )
                    )
            }
            .buttonStyle(.plain)
            .disabled(officeHoursDocumentHandoffButtonDisabled)
            .accessibilityIdentifier("opendesign.officeHours.docHandoff.confirm")

            if let error = viewModel.day1DocHandoffError?.trimmingCharacters(in: .whitespacesAndNewlines),
               !error.isEmpty {
                Text(error)
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(openDesignOfficeHoursBackground(cornerRadius: 8, fill: OpenDesignOfficeHoursColor.surface2))
            }
        }
        .padding(12)
        .background(openDesignOfficeHoursBackground(cornerRadius: 10, fill: OpenDesignOfficeHoursColor.bgDeep))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.docHandoff")
    }

    private func officeHoursDocumentRow(type: String, title: String, path: String) -> some View {
        let isWritten = officeHoursDocumentWritten(type: type)
        let detail = officeHoursDocumentDetail(type: type, path: path)
        return HStack(spacing: 10) {
            Text(isWritten ? "✓" : officeHoursDocumentHandoffBusy ? "…" : "•")
                .font(.system(size: isWritten ? 11 : 10, weight: .bold, design: .monospaced))
                .foregroundStyle(isWritten ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.mutedDeep)
                .frame(width: 22, height: 22)
                .background(Circle().fill(OpenDesignOfficeHoursColor.surface2))
                .overlay(Circle().stroke(isWritten ? OpenDesignOfficeHoursColor.accentLine : OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1))
                .accessibilityHidden(true)

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(isWritten ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.fg)
                Text(detail)
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .foregroundStyle(isWritten ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.mutedDeep)
                    .lineLimit(1)
            }

            Spacer(minLength: 8)
        }
        .padding(.vertical, 1)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(title) \(detail)")
        .accessibilityValue(officeHoursDocumentAccessibilityValue(type: type))
        .accessibilityIdentifier("opendesign.officeHours.docHandoff.doc.\(type)")
    }

    private var officeHoursDocumentHandoffButtonTitle: String {
        if officeHoursDocumentHandoffBusy { return "문서 저장 중" }
        if officeHoursDay1DocumentsWritten { return "문서 저장 완료" }
        return "4개 문서 저장"
    }

    private var officeHoursDocumentHandoffButtonDisabled: Bool {
        officeHoursDocumentHandoffBusy || officeHoursDay1DocumentsWritten
    }

    private func startOfficeHoursDocumentHandoff(session: ChatSession) {
        guard !officeHoursDocumentHandoffBusy else { return }
        viewModel.startDay1DocHandoff(
            docType: "all",
            day1Handoff: officeHoursDay1HandoffPayload(session: session)
        )
    }

    private func officeHoursDay1HandoffPayload(session: ChatSession) -> [String: Any] {
        let doc = officeHoursDesignDocPreview(session: session)
        let rowValue: ([String]) -> String = { labels in
            doc.rows.first(where: { labels.contains($0.label) })?.body ?? ""
        }
        let goalSelection = viewModel.day1GoalSelection
        let machineFacts = officeHoursDay1MachineHandoffFacts(session: session)
        let problemRow = rowValue(["문제 정의", "Problem Statement"])
        let targetUser = officeHoursFirstHandoffValue([
            machineFacts["targetUser"],
            rowValue(["대상 사용자", "Target User"]),
            goalSelection?.customer,
        ])
        let problem = officeHoursFirstHandoffValue([
            machineFacts["problem"],
            problemRow,
            goalSelection?.problem,
        ])
        let currentAlternative = officeHoursFirstHandoffValue([
            machineFacts["currentAlternative"],
            officeHoursCurrentAlternative(from: problemRow),
        ])
        let entryPoint = officeHoursFirstHandoffValue([
            machineFacts["entryPoint"],
            rowValue(["선택한 첫 진입점", "Entry Point"]),
        ])
        let nextAction = officeHoursFirstHandoffValue([
            machineFacts["nextAction"],
            rowValue(["다음 행동", "Next action"]),
            selectedOfficeHoursMode.assignment,
            goalSelection?.validationAction,
        ])
        let weeklyProof = officeHoursFirstHandoffValue([
            machineFacts["weeklyProof"],
            entryPoint,
            nextAction,
        ])
        let northStarGoal = officeHoursFirstHandoffValue([
            machineFacts["northStarGoal"],
            doc.summary,
            goalSelection?.goalText,
        ])
        let markdown = ([
            "---",
            "generated_by: office-hours",
            "handoff_for: day1-docs",
            "office_hours_mode: \"\(selectedOfficeHoursMode.label)\"",
            "---",
            "",
            "# \(doc.title)",
            "",
            doc.summary,
            "",
        ] + doc.rows.flatMap { row in
            ["## \(row.label)", row.body, ""]
        }).joined(separator: "\n")

        var payload: [String: Any] = [
            "goal": northStarGoal,
            "icp": targetUser,
            "pain": problem,
            "outcome": nextAction,
            "northStarGoal": northStarGoal,
            "weeklyProof": weeklyProof,
            "targetUser": targetUser,
            "problem": problem,
            "currentAlternative": currentAlternative,
            "entryPoint": entryPoint,
            "nextAction": nextAction,
            "markdown": markdown,
        ]
        let nonGoals = officeHoursCleanHandoffList(machineFacts["nonGoals"])
        if !nonGoals.isEmpty {
            payload["nonGoals"] = nonGoals
        } else {
            payload["nonGoals"] = doc.rows
                .filter { ["이번에는 제외", "Non-goals"].contains($0.label) }
                .flatMap { officeHoursSplitHandoffList($0.body) }
        }
        let assumptions = officeHoursCleanHandoffList(machineFacts["assumptions"])
        if !assumptions.isEmpty {
            payload["assumptions"] = assumptions
        }
        let sourceQuotes = officeHoursCleanHandoffList(machineFacts["sourceQuotes"])
        if !sourceQuotes.isEmpty {
            payload["sourceQuotes"] = sourceQuotes
        }
        return payload
    }

    private func officeHoursDay1MachineHandoffFacts(session: ChatSession) -> [String: Any] {
        let startToken = "===DAY1_HANDOFF_JSON==="
        let endToken = "===END==="
        for message in session.messages.reversed() where message.role == .assistant {
            guard let startRange = message.content.range(of: startToken) else { continue }
            let searchRange = startRange.upperBound..<message.content.endIndex
            guard let endRange = message.content.range(of: endToken, range: searchRange) else { continue }
            let json = String(message.content[startRange.upperBound..<endRange.lowerBound])
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard let data = json.data(using: .utf8),
                  let object = try? JSONSerialization.jsonObject(with: data),
                  let dictionary = object as? [String: Any] else {
                continue
            }
            return dictionary
        }
        return [:]
    }

    private func officeHoursFirstHandoffValue(_ values: [Any?]) -> String {
        values
            .map { officeHoursCleanHandoffString($0) }
            .first(where: { !$0.isEmpty }) ?? ""
    }

    private func officeHoursCleanHandoffString(_ value: Any?) -> String {
        let raw: String
        if let value = value as? String {
            raw = value
        } else if let value {
            raw = String(describing: value)
        } else {
            raw = ""
        }
        let trimmed = raw.trimmingCharacters(in: .whitespacesAndNewlines)
        return officeHoursLooksLikePlaceholder(trimmed) ? "" : trimmed
    }

    private func officeHoursCleanHandoffList(_ value: Any?) -> [String] {
        let rawItems: [Any]
        if let array = value as? [Any] {
            rawItems = array
        } else if let strings = value as? [String] {
            rawItems = strings
        } else if let value {
            rawItems = [value]
        } else {
            rawItems = []
        }
        return rawItems
            .map { officeHoursCleanHandoffString($0) }
            .filter { !$0.isEmpty }
    }

    private func officeHoursSplitHandoffList(_ value: String) -> [String] {
        value
            .components(separatedBy: CharacterSet(charactersIn: "\n,"))
            .map { officeHoursCleanHandoffString($0) }
            .filter { !$0.isEmpty }
    }

    private func officeHoursCurrentAlternative(from value: String) -> String {
        guard let range = value.range(of: "현재 대안은") else { return "" }
        return officeHoursCleanHandoffString(String(value[range.upperBound...]))
            .trimmingCharacters(in: CharacterSet(charactersIn: ".。 "))
    }

    private func officeHoursLooksLikePlaceholder(_ value: String) -> Bool {
        let normalized = value
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: " ", with: "")
        return [
            "첫고객후보",
            "검증할문제",
            "이번주확인할행동",
            "Day1에서고른좁은첫고객군",
            "현재대안과압박비용이아직약한가정",
            "이번주관찰가능한완료행동",
        ].contains(normalized)
    }

    private func completeOfficeHoursDay1AndAdvance() {
        _ = viewModel.markFoundationDayCompleted(1)
        clearOpenDesignReferenceRoute()
        viewModel.selectFoundationDay(2)
    }

    private func officeHoursDesignDocPreview(
        session: ChatSession
    ) -> (title: String, summary: String, rows: [(label: String, body: String)]) {
        let answers = officeHoursAnswerSummaries(session: session)
        let problem = answers.first ?? "수요 증거를 더 확인해야 함"
        let statusQuo = answers.dropFirst().first ?? "현재 대안 확인 필요"
        let human = answers.dropFirst(2).first ?? "이번 주 연락 가능한 사용자 1명 지정"
        let wedge = answers.dropFirst(3).first ?? selectedOfficeHoursMode.assignment
        let observation = answers.dropFirst(4).first ?? "사용 장면 관찰 필요"
        let futureFit = answers.dropFirst(5).first ?? "장기 필수성 가설 확인"
        let title = "설계 문서: \(officeHoursCompactDocText(wedge, max: 42))"
        let summary = "\(officeHoursCompactDocText(human, max: 58))에게 \(officeHoursCompactDocText(wedge, max: 58))를 보여주고, \(officeHoursCompactDocText(problem, max: 58))가 실제 지불 또는 반복 사용으로 이어지는지 검증한다."
        return (
            title,
            summary,
            [
                ("문제 정의", "\(problem). 현재 대안은 \(statusQuo)."),
                ("대상 사용자", human),
                ("선택한 첫 진입점", wedge),
                ("전제 확인", "\(observation). 장기 필수성은 \(futureFit)."),
                ("검토한 대안", "A) 직접 도와주며 검증, B) 작은 유료 작업 흐름, C) 넓은 제품. 현재는 가장 작은 유료 작업 흐름으로 신호를 본다."),
                ("이번에는 제외", "넓은 고객 후보, 자동화 확장, 여러 고객 유형 확장은 첫 증거 전까지 제외."),
                ("다음 행동", selectedOfficeHoursMode.assignment),
            ]
        )
    }

    private func officeHoursAnswerSummaries(session: ChatSession) -> [String] {
        let transcriptAnswers = OfficeHoursTranscriptRow.rows(from: session.messages)
            .filter(\.isUser)
            .map { $0.content.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let structuredAnswers = officeHoursSubmittedPromptSnapshots(for: session)
            .map(\.answerSummary)
            .filter { !$0.isEmpty && $0 != "응답" }
        return transcriptAnswers.isEmpty ? structuredAnswers : transcriptAnswers
    }

    private func officeHoursCompactDocText(_ value: String, max: Int) -> String {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard trimmed.count > max else { return trimmed }
        return "\(trimmed.prefix(max))..."
    }

    private func officeHoursPendingPromptBlock(_ prompt: StructuredPromptRequest, session: ChatSession) -> some View {
        let question = prompt.questions.first
        let presentation = OfficeHoursPendingPromptPresentation.resolve(
            answerCount: officeHoursAnswerCount(session: session),
            fallbackTotal: selectedOfficeHoursMode.questionCount,
            generationTotal: prompt.generation?.dimensionTotal,
            interviewComplete: officeHoursInterviewComplete(session: session)
        )
        let questionNumber = presentation.questionNumber
        let total = presentation.total
        let title = question?.header.nonEmpty ?? prompt.generation?.signalLabel?.nonEmpty ?? "forcing question"
        let blockStartGap: CGFloat = 20
        return VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 0) {
                Color.clear
                    .frame(height: blockStartGap)
                    .accessibilityHidden(true)
                    .id(officeHoursPendingPromptScrollID(for: prompt.requestId))
                officeHoursSectionHeader("질문 \(questionNumber) — \(title)", meta: "\(questionNumber) / \(total)")
                    .id(officeHoursPendingPromptHeaderID(for: prompt.requestId))
            }
            if let question {
                officeHoursQuestionStatementCard(question: question, index: questionNumber, total: total)
                OfficeHoursDelayedReveal(
                    id: "\(prompt.requestId)-options",
                    delayNanoseconds: reduceMotion
                        ? 0
                        : officeHoursPromptOptionsRevealDelayNanoseconds(for: question)
                ) {
                    officeHoursStructuredPrompt(prompt, submissionState: submissionState(for: prompt))
                }
                .padding(.top, 3)
            } else {
                officeHoursStructuredPrompt(prompt, submissionState: submissionState(for: prompt))
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.pendingPrompt")
    }

    private func officeHoursSubmittedPromptBlock(
        _ card: OfficeHoursSubmittedPromptTimelineCard,
        session: ChatSession
    ) -> some View {
        let prompt = card.snapshot.prompt
        let question = prompt.questions.first
        let title = question?.header.nonEmpty ?? prompt.generation?.signalLabel?.nonEmpty ?? "forcing question"
        return VStack(alignment: .leading, spacing: 12) {
            officeHoursSectionHeader("질문 \(card.index) — \(title)", meta: "\(card.index) / \(card.total)")
            if let question {
                officeHoursQuestionStatementCard(
                    question: question,
                    index: card.index,
                    total: card.total,
                    typewrites: false
                )
            }
            officeHoursSubmittedStructuredPrompt(card.snapshot, session: session)
                .padding(.top, 3)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.submittedPrompt.\(card.snapshot.requestId)")
    }

    private func officeHoursPromptOptionsRevealDelayNanoseconds(for question: StructuredPromptQuestion) -> UInt64 {
        OfficeHoursTypewriterTiming.totalDelayNanoseconds(
            for: question.question,
            baseMilliseconds: 6
        )
    }

    private func officeHoursRemainingQuestionLoadingNanoseconds(for sessionID: String) -> UInt64 {
        guard let startedAt = officeHoursQuestionLoadingStartedAtBySession[sessionID] else {
            return UInt64(Self.officeHoursMinimumQuestionLoadingSeconds * 1_000_000_000)
        }
        let elapsed = max(0, Date().timeIntervalSince(startedAt))
        let remaining = max(0, Self.officeHoursMinimumQuestionLoadingSeconds - elapsed)
        return UInt64(remaining * 1_000_000_000)
    }

    private func officeHoursQuestionStatementCard(
        question: StructuredPromptQuestion,
        index: Int,
        total: Int,
        typewrites: Bool = true
    ) -> some View {
        VStack(alignment: .leading, spacing: 11.5) {
            HStack(spacing: 8) {
                Text("질문")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                    .tracking(1.2)
                    .textCase(.uppercase)
                Spacer(minLength: 0)
                Text("\(index) / \(total)")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                    .padding(.horizontal, 8)
                    .frame(height: 20)
                    .background(Capsule().fill(OpenDesignOfficeHoursColor.accentDim))
                    .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1))
            }

            officeHoursQuestionStatementText(question, typewrites: typewrites)
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .frame(minHeight: 95, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [OpenDesignOfficeHoursColor.surface, OpenDesignOfficeHoursColor.surface2],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
        )
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(OpenDesignOfficeHoursColor.accent)
                .frame(width: 3)
                .shadow(color: OpenDesignOfficeHoursColor.accent.opacity(0.55), radius: 14)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
        }
    }

    @ViewBuilder
    private func officeHoursQuestionStatementText(
        _ question: StructuredPromptQuestion,
        typewrites: Bool
    ) -> some View {
        let emphasis = officeHoursQuestionEmphasisSpans(for: question)
        let highlights = officeHoursQuestionHighlightPhrases(for: question)
        if emphasis.isEmpty && highlights.isEmpty {
            if typewrites {
                OfficeHoursTypewriterText(
                    text: question.question,
                    font: .system(size: 17, weight: .medium),
                    foregroundColor: OpenDesignOfficeHoursColor.fg,
                    lineSpacing: 5,
                    tracking: -0.17,
                    reduceMotion: reduceMotion,
                    baseSpeedMilliseconds: 6
                )
            } else {
                Text(question.question)
                    .font(.system(size: 17, weight: .medium))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    .tracking(-0.17)
                    .lineSpacing(5)
                    .fixedSize(horizontal: false, vertical: true)
            }
        } else if typewrites {
            OfficeHoursHighlightedTypewriterText(
                text: question.question,
                highlightPhrases: highlights,
                emphasis: emphasis,
                reduceMotion: reduceMotion,
                baseSpeedMilliseconds: 6
            )
        } else {
            OfficeHoursInlinePromptText(
                text: question.question,
                highlightPhrases: highlights,
                emphasis: emphasis
            )
        }
    }

    /// Dynamic emphasis spans the sidecar attached to this question. When the
    /// question carries no `emphasis`, this returns an empty array and rendering
    /// falls back to the single-style `highlightPhrases` path.
    private func officeHoursQuestionEmphasisSpans(for question: StructuredPromptQuestion) -> [EmphasisSpan] {
        question.emphasis ?? []
    }

    private func officeHoursQuestionHighlightPhrases(for question: StructuredPromptQuestion) -> [String] {
        var phrases = question.highlightPhrases ?? []
        let questionText = question.question
        for option in question.options ?? [] {
            for candidate in officeHoursOptionHighlightCandidates(option.label) {
                if questionText.range(of: candidate, options: [.caseInsensitive, .diacriticInsensitive]) != nil {
                    phrases.append(candidate)
                }
            }
        }
        return OpenDesignDayContent.InterviewStep.normalizedHighlightPhrases(phrases)
    }

    private func officeHoursOptionHighlightCandidates(_ label: String) -> [String] {
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return [] }
        var candidates = [trimmed]
        let suffixes = [
            "일 수 있습니다",
            "일 수 있다",
            "일 수 있음",
            "입니다",
            "이다",
        ]
        for suffix in suffixes where trimmed.hasSuffix(suffix) {
            let candidate = String(trimmed.dropLast(suffix.count)).trimmingCharacters(in: .whitespacesAndNewlines)
            if !candidate.isEmpty {
                candidates.append(candidate)
            }
        }
        return OpenDesignDayContent.InterviewStep.normalizedHighlightPhrases(candidates)
    }

    private func officeHoursSubmittedStructuredPrompt(
        _ snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession
    ) -> some View {
        let stagedSubmissions = officeHoursSubmissionsByApplyingRevisionDrafts(snapshot: snapshot, session: session)
        let hasPendingRevision = !officeHoursSubmittedRevisionDrafts(for: snapshot, session: session).isEmpty
        let isRevisionSubmitting = officeHoursRevisionInFlightSessionIDs.contains(session.id)
        let canSubmitRevision = officeHoursCanReviseSubmittedPrompt(snapshot, in: session) && hasPendingRevision
        let summary = hasPendingRevision ? officeHoursAnswerSummary(for: stagedSubmissions) : snapshot.answerSummary
        let editable = officeHoursCanReviseSubmittedPrompt(snapshot, in: session)
        let footerLabel = hasPendingRevision ? "수정 예정" : editable ? "수정 가능" : "제출 완료"
        let buttonLabel = isRevisionSubmitting ? "수정 중" : editable ? "수정" : "제출됨"
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(snapshot.prompt.questions.enumerated()), id: \.element.id) { index, question in
                if index > 0 {
                    Rectangle()
                        .fill(OpenDesignOfficeHoursColor.borderSoft)
                        .frame(height: 1)
                }
                officeHoursSubmittedStructuredQuestion(
                    question,
                    questionIndex: index,
                    snapshot: snapshot,
                    session: session
                )
            }

            HStack(spacing: 12) {
                HStack(spacing: 6) {
                        Text(footerLabel)
                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                    Text("— \(summary)")
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                        .lineLimit(1)
                }
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .tracking(0.4)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button {
                    officeHoursSubmitStagedSubmittedRevision(snapshot: snapshot, session: session)
                } label: {
                    HStack(spacing: 8) {
                        if isRevisionSubmitting {
                            ProgressView()
                                .controlSize(.mini)
                                .scaleEffect(0.7)
                        }
                        Text(buttonLabel)
                        Text(isRevisionSubmitting ? "…" : canSubmitRevision ? "↵" : "✓")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .padding(.horizontal, 5)
                            .frame(height: 16)
                            .background(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(canSubmitRevision ? OpenDesignOfficeHoursColor.bgDeep.opacity(0.30) : Color.clear)
                            )
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(canSubmitRevision ? OpenDesignOfficeHoursColor.bgDeep : editable ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.mutedDeep)
                    .padding(.horizontal, 16)
                    .frame(height: 30)
                    .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(canSubmitRevision ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.surface2)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(canSubmitRevision ? Color.clear : OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(.plain)
                .contentShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
                .disabled(!canSubmitRevision)
                .accessibilityLabel(buttonLabel)
                .accessibilityValue(canSubmitRevision ? "Ready" : hasPendingRevision ? "Incomplete" : "Submitted")
                .accessibilityIdentifier("opendesign.officeHours.submittedButton.\(snapshot.requestId)")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 11)
            .background(OpenDesignOfficeHoursColor.bgDeep)
            .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .background(OpenDesignOfficeHoursColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.submittedStructuredPrompt.\(snapshot.requestId)")
    }

    private func officeHoursSubmittedStructuredQuestion(
        _ question: StructuredPromptQuestion,
        questionIndex: Int,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession
    ) -> some View {
        let hasOptions = question.options?.isEmpty == false
        let isRequiredTextOnly = question.requiresFreeText == true && !hasOptions
        let submission = officeHoursSubmittedSubmission(for: question, questionIndex: questionIndex, snapshot: snapshot)
        let selectedLabels = officeHoursSubmittedSelectedOptionLabels(submission)
        let freeText = submission?.freeText.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let pickedCount = selectedLabels.isEmpty && freeText.isEmpty ? 0 : 1
        let shouldShowFreeText = !freeText.isEmpty || question.requiresFreeText == true
        let editable = officeHoursCanReviseSubmittedPrompt(snapshot, in: session)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.accent)
                        .frame(width: 4, height: 14)
                    Text(isRequiredTextOnly ? "근거 문장 입력" : "하나 선택")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                }
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    Text("\(pickedCount)")
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                    Text("/ 1")
                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                }
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13.25)
            .background(OpenDesignOfficeHoursColor.surface2)
            .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)

            if hasOptions {
                VStack(spacing: 2) {
                    ForEach(Array((question.options ?? []).enumerated()), id: \.element.label) { optionIndex, option in
                        officeHoursSubmittedPromptOptionRow(
                            option,
                            optionIndex: optionIndex,
                            question: question,
                            questionIndex: questionIndex,
                            snapshot: snapshot,
                            session: session,
                            selected: selectedLabels.contains(option.label.trimmingCharacters(in: .whitespacesAndNewlines)),
                            editable: editable
                        )
                    }
                }
                .padding(6)
            }

            if shouldShowFreeText {
                officeHoursSubmittedFreeTextArea(
                    question: question,
                    questionIndex: questionIndex,
                    snapshot: snapshot,
                    session: session,
                    value: freeText,
                    editable: editable
                )
            }
        }
    }

    private func officeHoursSubmittedSubmission(
        for question: StructuredPromptQuestion,
        questionIndex: Int,
        snapshot: OfficeHoursSubmittedPromptSnapshot
    ) -> AgenticViewModel.StructuredPromptSubmission? {
        if let exact = snapshot.submissions.first(where: {
            $0.question.officeHoursNormalizedTranscriptText == question.question.officeHoursNormalizedTranscriptText
        }) {
            return exact
        }
        guard snapshot.submissions.indices.contains(questionIndex) else { return nil }
        return snapshot.submissions[questionIndex]
    }

    private func officeHoursSubmittedSelectedOptionLabels(
        _ submission: AgenticViewModel.StructuredPromptSubmission?
    ) -> Set<String> {
        Set((submission?.selectedOptions ?? [])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty })
    }

    private func officeHoursSubmittedRevisionDraftKey(sessionID: String, requestID: String) -> String {
        [sessionID, requestID].joined(separator: "\u{1F}")
    }

    private func officeHoursSubmittedRevisionDrafts(
        for snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession
    ) -> [String: AgenticViewModel.StructuredPromptSubmission] {
        officeHoursSubmittedRevisionDraftsByPrompt[
            officeHoursSubmittedRevisionDraftKey(sessionID: session.id, requestID: snapshot.requestId)
        ] ?? [:]
    }

    private func officeHoursStagedSubmittedSubmission(
        for question: StructuredPromptQuestion,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession
    ) -> AgenticViewModel.StructuredPromptSubmission? {
        officeHoursSubmittedRevisionDrafts(for: snapshot, session: session)[question.id]
    }

    private func officeHoursClearSubmittedRevisionDrafts(sessionID: String) {
        let prefix = "\(sessionID)\u{1F}"
        officeHoursSubmittedRevisionDraftsByPrompt = officeHoursSubmittedRevisionDraftsByPrompt.filter { entry in
            !entry.key.hasPrefix(prefix)
        }
    }

    private func officeHoursClearSubmittedRevisionDraft(
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession
    ) {
        officeHoursSubmittedRevisionDraftsByPrompt.removeValue(
            forKey: officeHoursSubmittedRevisionDraftKey(sessionID: session.id, requestID: snapshot.requestId)
        )
    }

    private func officeHoursNormalizedSubmittedSubmission(
        _ submission: AgenticViewModel.StructuredPromptSubmission
    ) -> AgenticViewModel.StructuredPromptSubmission {
        AgenticViewModel.StructuredPromptSubmission(
            question: submission.question,
            selectedOptions: submission.selectedOptions
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty },
            freeText: submission.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
        )
    }

    private func officeHoursAnswerSummary(
        for submissions: [AgenticViewModel.StructuredPromptSubmission]
    ) -> String {
        let parts = submissions.flatMap { submission -> [String] in
            let selected = submission.selectedOptions
                .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                .filter { !$0.isEmpty }
            let freeText = submission.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
            return selected + (freeText.isEmpty ? [] : [freeText])
        }
        let summary = parts.joined(separator: " / ")
        guard !summary.isEmpty else { return "응답" }
        guard summary.count > 96 else { return summary }
        return String(summary.prefix(96)) + "..."
    }

    private func officeHoursSubmissionsByApplyingRevision(
        _ updated: AgenticViewModel.StructuredPromptSubmission,
        question: StructuredPromptQuestion,
        questionIndex: Int,
        snapshot: OfficeHoursSubmittedPromptSnapshot
    ) -> [AgenticViewModel.StructuredPromptSubmission]? {
        var submissions = snapshot.submissions
        if let index = submissions.firstIndex(where: {
            $0.question.officeHoursNormalizedTranscriptText == question.question.officeHoursNormalizedTranscriptText
        }) {
            guard officeHoursNormalizedSubmittedSubmission(submissions[index]) != updated else { return nil }
            submissions[index] = updated
        } else if submissions.indices.contains(questionIndex) {
            guard officeHoursNormalizedSubmittedSubmission(submissions[questionIndex]) != updated else { return nil }
            submissions[questionIndex] = updated
        } else {
            submissions.append(updated)
        }
        return submissions
    }

    private func officeHoursSubmissionsByApplyingRevisionDrafts(
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession
    ) -> [AgenticViewModel.StructuredPromptSubmission] {
        var submissions = snapshot.submissions
        let drafts = officeHoursSubmittedRevisionDrafts(for: snapshot, session: session)
        guard !drafts.isEmpty else { return submissions }

        for (index, question) in snapshot.prompt.questions.enumerated() {
            guard let draft = drafts[question.id] else { continue }
            if let updated = officeHoursSubmissionsByApplyingRevision(
                draft,
                question: question,
                questionIndex: index,
                snapshot: OfficeHoursSubmittedPromptSnapshot(
                    sessionId: snapshot.sessionId,
                    requestId: snapshot.requestId,
                    prompt: snapshot.prompt,
                    submissions: submissions,
                    submittedAt: snapshot.submittedAt,
                    isRestored: snapshot.isRestored,
                    isEditable: snapshot.isEditable
                )
            ) {
                submissions = updated
            }
        }
        return submissions
    }

    private func officeHoursStageSubmittedRevision(
        question: StructuredPromptQuestion,
        questionIndex: Int,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession,
        selectedOptions: [String],
        freeText: String
    ) {
        guard officeHoursCanReviseSubmittedPrompt(snapshot, in: session) else {
            NSSound.beep()
            return
        }

        let updated = officeHoursNormalizedSubmittedSubmission(
            AgenticViewModel.StructuredPromptSubmission(
                question: question.question,
                selectedOptions: selectedOptions,
                freeText: freeText
            )
        )
        let original = officeHoursSubmittedSubmission(for: question, questionIndex: questionIndex, snapshot: snapshot)
            .map(officeHoursNormalizedSubmittedSubmission)
        let key = officeHoursSubmittedRevisionDraftKey(sessionID: session.id, requestID: snapshot.requestId)
        var drafts = officeHoursSubmittedRevisionDraftsByPrompt[key] ?? [:]
        if original == updated {
            drafts.removeValue(forKey: question.id)
        } else {
            drafts[question.id] = updated
        }

        if drafts.isEmpty {
            officeHoursSubmittedRevisionDraftsByPrompt.removeValue(forKey: key)
        } else {
            officeHoursSubmittedRevisionDraftsByPrompt[key] = drafts
        }
    }

    private func officeHoursSubmittedPromptOptionRow(
        _ option: StructuredPromptOption,
        optionIndex: Int,
        question: StructuredPromptQuestion,
        questionIndex: Int,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession,
        selected: Bool,
        editable: Bool
    ) -> some View {
        let stagedSubmission = officeHoursStagedSubmittedSubmission(for: question, snapshot: snapshot, session: session)
        let stagedLabels = officeHoursSubmittedSelectedOptionLabels(stagedSubmission)
        let label = option.label.trimmingCharacters(in: .whitespacesAndNewlines)
        let isPending = stagedLabels.contains(label)
        let isSubmitted = selected && stagedSubmission == nil
        let isHighlighted = isSubmitted || isPending
        let isCompletedUnselected = !isHighlighted
        let statusText = isPending ? "수정 예정" : isSubmitted ? "제출됨" : nil
        let lockedUnselected = !editable && isCompletedUnselected
        return Button {
            guard editable else { return }
            officeHoursStageSubmittedOptionRevision(
                option,
                question: question,
                questionIndex: questionIndex,
                snapshot: snapshot,
                session: session
            )
        } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle()
                        .fill(isHighlighted ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.bgDarker)
                        .overlay(Circle().stroke(isHighlighted ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.borderSoft.opacity(0.58), lineWidth: 1))
                        .overlay {
                            if isHighlighted {
                                Circle()
                                    .stroke(OpenDesignOfficeHoursColor.accent.opacity(0.18), lineWidth: 3)
                                    .frame(width: 30, height: 30)
                            }
                        }
                    Text(isPending ? "•" : isSubmitted ? "✓" : "\(optionIndex + 1)")
                        .font(.system(size: isHighlighted ? 13 : 11.5, weight: isHighlighted ? .heavy : .semibold, design: .monospaced))
                        .foregroundStyle(isHighlighted ? OpenDesignOfficeHoursColor.bgDeep : OpenDesignOfficeHoursColor.mutedDeep)
                        .opacity(lockedUnselected ? 0.62 : 1)
                }
                .frame(width: 24, height: 24)
                .frame(width: 28, alignment: .leading)
                .padding(.top, 1)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(option.label)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(isCompletedUnselected ? OpenDesignOfficeHoursColor.muted : OpenDesignOfficeHoursColor.fg)
                            .opacity(lockedUnselected ? 0.70 : 1)
                            .tracking(-0.065)
                            .fixedSize(horizontal: false, vertical: true)
                        if option.recommended == true {
                            Text("추천")
                                .font(.system(size: 9.5, weight: .bold))
                                .foregroundStyle(isCompletedUnselected ? OpenDesignOfficeHoursColor.mutedDeep : OpenDesignOfficeHoursColor.bgDeep)
                                .padding(.horizontal, 5)
                                .frame(height: 16)
                                .background(
                                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                                        .fill(isCompletedUnselected ? OpenDesignOfficeHoursColor.surface2 : OpenDesignOfficeHoursColor.accent)
                                )
                        }
                        if let statusText {
                            Text(statusText)
                                .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(OpenDesignOfficeHoursColor.bgDeep)
                                .tracking(0.4)
                                .padding(.horizontal, 7)
                                .frame(height: 17)
                                .background(Capsule().fill(OpenDesignOfficeHoursColor.accent))
                        }
                    }
                    Text(option.description)
                        .font(.system(size: 11.5, weight: .regular))
                        .foregroundStyle(isCompletedUnselected ? OpenDesignOfficeHoursColor.mutedDeep : OpenDesignOfficeHoursColor.fgSecondary)
                        .opacity(lockedUnselected ? 0.64 : 1)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                    // Risk / evidence target / failure mode are intentionally not
                    // rendered here — they ride along to the agent as context on
                    // submit (collectSelectedOptionDescriptions in sidecar/index.mjs)
                    // and stay reachable via the accessibility hint below.
                }

                Spacer(minLength: 0)

                if let statusText {
                    Text(statusText)
                        .font(.system(size: 10, weight: .regular, design: .monospaced))
                        .foregroundStyle(isPending ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.fgSecondary)
                        .lineLimit(1)
                        .padding(.top, 4)
                        .frame(minWidth: 76, alignment: .trailing)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 11)
            .padding(.bottom, 11)
            .frame(minHeight: 64, alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .officeHoursOptionRowSurface(selected: isHighlighted, disabled: !editable, dimmed: isCompletedUnselected)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .disabled(!editable)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("opendesign.officeHours.submittedChoice.\(question.id).\(option.label)")
        .accessibilityLabel("\(option.label) \(isPending ? "수정 예정" : isSubmitted ? "제출됨" : "완료된 미선택")")
        .accessibilityHint(editable ? "선택 후 우측 하단 수정 버튼으로 확정합니다" : (isSubmitted ? "제출됨" : officeHoursOptionAccessibilityHint(option)))
        .accessibilityValue(isPending ? "수정 예정" : isSubmitted ? "제출됨" : "완료된 미선택")
        .accessibilityAddTraits(.isButton)
    }

    private func officeHoursSubmittedFreeTextArea(
        question: StructuredPromptQuestion,
        questionIndex: Int,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession,
        value: String,
        editable: Bool
    ) -> some View {
        let isRequiredText = question.requiresFreeText == true
        let stagedSubmission = officeHoursStagedSubmittedSubmission(for: question, snapshot: snapshot, session: session)
        let stagedFreeText = stagedSubmission?.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
        let hasPendingFreeText = stagedSubmission != nil
            && stagedFreeText != value.trimmingCharacters(in: .whitespacesAndNewlines)
        let submittedValue = value.nonEmpty ?? "제출된 텍스트 없음"
        let displayValue = hasPendingFreeText ? (stagedFreeText?.nonEmpty ?? "제출된 텍스트 없음") : submittedValue
        let editID = officeHoursSubmittedFreeTextEditID(
            sessionID: session.id,
            requestID: snapshot.requestId,
            questionID: question.id
        )
        let commitFreeTextRevision = {
            officeHoursStageSubmittedFreeTextRevision(
                question: question,
                questionIndex: questionIndex,
                snapshot: snapshot,
                session: session
            )
        }
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(isRequiredText ? "근거 문장 입력" : "선택지에 없으면 입력")
                Spacer(minLength: 0)
                Text(hasPendingFreeText ? "수정 예정" : editable ? "클릭해 수정" : "제출됨")
                    .foregroundStyle(hasPendingFreeText ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.mutedDeep)
                    .tracking(0.4)
            }
            .font(.system(size: 10, weight: .regular, design: .monospaced))
            .foregroundStyle(OpenDesignOfficeHoursColor.muted)
            .tracking(1.0)
            .textCase(.uppercase)

            HStack(alignment: .top, spacing: 10) {
                Text("›")
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                if editable && editingOfficeHoursSubmittedFreeTextID == editID {
                    TextField("답변을 입력하세요", text: $editingOfficeHoursSubmittedFreeTextValue, axis: .vertical)
                        .textFieldStyle(.plain)
                        .font(.system(size: 13, weight: .regular, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                        .lineLimit(2...5)
                        .focused($focusedOfficeHoursStructuredFreeTextID, equals: editID)
                        .onSubmit {
                            commitFreeTextRevision()
                        }
                        .onExitCommand {
                            editingOfficeHoursSubmittedFreeTextID = nil
                            editingOfficeHoursSubmittedFreeTextValue = ""
                        }
                        .onChange(of: focusedOfficeHoursStructuredFreeTextID) { previous, current in
                            guard previous == editID, current != editID else { return }
                            commitFreeTextRevision()
                        }
                } else {
                    Text(displayValue)
                        .font(.system(size: 13, weight: .regular, design: .monospaced))
                        .foregroundStyle(hasPendingFreeText ? OpenDesignOfficeHoursColor.accent : value.isEmpty ? OpenDesignOfficeHoursColor.mutedDeep : OpenDesignOfficeHoursColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(minHeight: 36)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(OpenDesignOfficeHoursColor.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                    )
            )
        }
        .padding(.horizontal, 14)
        .padding(.top, 11)
        .padding(.bottom, 13)
        .background(OpenDesignOfficeHoursColor.bgDeep)
        .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .top)
        .contentShape(Rectangle())
        .onTapGesture {
            guard editable else { return }
            editingOfficeHoursSubmittedFreeTextID = editID
            editingOfficeHoursSubmittedFreeTextValue = officeHoursStagedSubmittedSubmission(
                for: question,
                snapshot: snapshot,
                session: session
            )?.freeText ?? value
            focusedOfficeHoursStructuredFreeTextID = editID
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("opendesign.officeHours.submittedFreeText.\(question.id)")
        .accessibilityValue(hasPendingFreeText ? "수정 예정" : "제출됨")
    }

    private func officeHoursSubmittedFreeTextEditID(
        sessionID: String,
        requestID: String,
        questionID: String
    ) -> String {
        [sessionID, requestID, questionID].joined(separator: "\u{1F}")
    }

    private func officeHoursCanReviseSubmittedPrompt(
        _ snapshot: OfficeHoursSubmittedPromptSnapshot,
        in session: ChatSession
    ) -> Bool {
        guard snapshot.isEditable else { return false }
        guard viewModel.isConnected else { return false }
        guard session.runtime?.officeHours?.active == true else { return false }
        guard !officeHoursInterviewComplete(session: session) else { return false }
        guard !officeHoursRevisionInFlightSessionIDs.contains(session.id) else { return false }
        return session.status == .running || session.status == .awaitingInput
    }

    private func officeHoursStageSubmittedOptionRevision(
        _ option: StructuredPromptOption,
        question: StructuredPromptQuestion,
        questionIndex: Int,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession
    ) {
        let label = option.label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !label.isEmpty else { return }
        let originalSubmission = officeHoursSubmittedSubmission(for: question, questionIndex: questionIndex, snapshot: snapshot)
        let stagedSubmission = officeHoursStagedSubmittedSubmission(for: question, snapshot: snapshot, session: session)
        let submission = stagedSubmission ?? originalSubmission
        let originalSelectedOptions = officeHoursSubmittedSelectedOptionLabels(originalSubmission)
        var selectedOptions = officeHoursSubmittedSelectedOptionLabels(submission)
        if question.multiSelect == true {
            if selectedOptions.contains(label) {
                selectedOptions.remove(label)
            } else {
                selectedOptions.insert(label)
            }
        } else {
            if originalSelectedOptions.contains(label) {
                selectedOptions = originalSelectedOptions
            } else if selectedOptions.contains(label) {
                return
            } else {
                selectedOptions = [label]
            }
        }
        let optionOrder = (question.options ?? []).map(\.label)
        let orderedSelections = optionOrder.filter { selectedOptions.contains($0) }
        let customSelections = selectedOptions
            .filter { !optionOrder.contains($0) }
            .sorted()
        officeHoursStageSubmittedRevision(
            question: question,
            questionIndex: questionIndex,
            snapshot: snapshot,
            session: session,
            selectedOptions: orderedSelections + customSelections,
            freeText: submission?.freeText.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        )
    }

    private func officeHoursStageSubmittedFreeTextRevision(
        question: StructuredPromptQuestion,
        questionIndex: Int,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession
    ) {
        let value = editingOfficeHoursSubmittedFreeTextValue.trimmingCharacters(in: .whitespacesAndNewlines)
        editingOfficeHoursSubmittedFreeTextID = nil
        editingOfficeHoursSubmittedFreeTextValue = ""
        let submission = officeHoursStagedSubmittedSubmission(for: question, snapshot: snapshot, session: session)
            ?? officeHoursSubmittedSubmission(for: question, questionIndex: questionIndex, snapshot: snapshot)
        officeHoursStageSubmittedRevision(
            question: question,
            questionIndex: questionIndex,
            snapshot: snapshot,
            session: session,
            selectedOptions: submission?.selectedOptions ?? [],
            freeText: value
        )
    }

    private func officeHoursSubmitStagedSubmittedRevision(
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession
    ) {
        let drafts = officeHoursSubmittedRevisionDrafts(for: snapshot, session: session)
        guard !drafts.isEmpty else { return }
        guard officeHoursCanReviseSubmittedPrompt(snapshot, in: session) else {
            NSSound.beep()
            return
        }

        for question in snapshot.prompt.questions {
            guard let draft = drafts[question.id] else { continue }
            let selectedSet = Set(draft.selectedOptions.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
            guard question.isSatisfied(selectedOptions: selectedSet, freeText: draft.freeText) else {
                NSSound.beep()
                return
            }
        }

        officeHoursSendSubmittedRevision(
            session: session,
            snapshot: snapshot,
            submissions: officeHoursSubmissionsByApplyingRevisionDrafts(snapshot: snapshot, session: session)
        )
    }

    private func officeHoursSubmitSubmittedRevision(
        question: StructuredPromptQuestion,
        questionIndex: Int,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        session: ChatSession,
        selectedOptions: [String],
        freeText: String
    ) {
        let selectedSet = Set(selectedOptions.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
        let trimmedFreeText = freeText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard question.isSatisfied(selectedOptions: selectedSet, freeText: trimmedFreeText) else {
            NSSound.beep()
            return
        }
        guard officeHoursCanReviseSubmittedPrompt(snapshot, in: session) else {
            NSSound.beep()
            return
        }
        let updated = AgenticViewModel.StructuredPromptSubmission(
            question: question.question,
            selectedOptions: selectedOptions,
            freeText: trimmedFreeText
        )
        guard let submissions = officeHoursSubmissionsByApplyingRevision(
            officeHoursNormalizedSubmittedSubmission(updated),
            question: question,
            questionIndex: questionIndex,
            snapshot: snapshot
        ) else { return }
        officeHoursSendSubmittedRevision(session: session, snapshot: snapshot, submissions: submissions)
    }

    private func officeHoursSendSubmittedRevision(
        session: ChatSession,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        submissions: [AgenticViewModel.StructuredPromptSubmission]
    ) {
        officeHoursRevisionInFlightSessionIDs.insert(session.id)
        let sent = viewModel.reviseOfficeHoursAnswer(
            sessionId: session.id,
            requestId: snapshot.requestId,
            prompt: snapshot.prompt,
            responses: submissions
        )
        guard sent else {
            officeHoursRevisionInFlightSessionIDs.remove(session.id)
            NSSound.beep()
            return
        }
        officeHoursApplyLocalSubmittedRevision(
            session: session,
            snapshot: snapshot,
            submissions: submissions
        )
    }

    private func officeHoursApplyLocalSubmittedRevision(
        session: ChatSession,
        snapshot: OfficeHoursSubmittedPromptSnapshot,
        submissions: [AgenticViewModel.StructuredPromptSubmission]
    ) {
        let snapshots = officeHoursSubmittedPromptSnapshots(for: session)
        guard let targetIndex = snapshots.firstIndex(where: { $0.requestId == snapshot.requestId }) else { return }
        var retained = Array(snapshots.prefix(targetIndex + 1))
        retained[targetIndex] = OfficeHoursSubmittedPromptSnapshot(
            sessionId: session.id,
            requestId: snapshot.requestId,
            prompt: snapshot.prompt,
            submissions: submissions,
            submittedAt: .now,
            isRestored: false,
            isEditable: true
        )
        officeHoursSubmittedPromptSnapshotsBySession[session.id] = retained
        officeHoursClearSubmittedRevisionDraft(snapshot: snapshot, session: session)
        officeHoursCommitmentCandidateRequestedSessions.remove(session.id)
        startOfficeHoursQuestionLoading(
            sessionID: session.id,
            requestID: "office-hours-revision-\(snapshot.requestId)"
        )
    }

    private func officeHoursStructuredPrompt(
        _ prompt: StructuredPromptRequest,
        submissionState: AgenticViewModel.StructuredPromptSubmissionState?
    ) -> some View {
        let isSubmitting = submissionState?.requestId == prompt.requestId
        let canSubmitPrompt = canSubmit(prompt) && !isSubmitting
        let hintParts = officeHoursStructuredPromptHintParts(prompt)
        let footerVerticalPadding: CGFloat = (prompt.generation?.dimensionStepIndex ?? 1) > 1 ? 11 : 16
        return VStack(alignment: .leading, spacing: 0) {
            ForEach(Array(prompt.questions.enumerated()), id: \.element.id) { index, question in
                if index > 0 {
                    Rectangle()
                        .fill(OpenDesignOfficeHoursColor.borderSoft)
                        .frame(height: 1)
                }
                officeHoursStructuredQuestion(question, prompt: prompt, isSubmitting: isSubmitting)
            }

            HStack(spacing: 12) {
                HStack(spacing: 6) {
                    Text(hintParts.label)
                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                    if let name = hintParts.name {
                        Text("— \(name)")
                            .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                            .lineLimit(1)
                    }
                }
                    .font(.system(size: 10.5, weight: .medium, design: .monospaced))
                    .tracking(0.4)
                    .lineLimit(1)
                Spacer(minLength: 0)
                Button {
                    submitPrompt(prompt)
                } label: {
                    HStack(spacing: 8) {
                        if isSubmitting {
                            ProgressView()
                                .controlSize(.mini)
                                .scaleEffect(0.7)
                        }
                        Text(isSubmitting ? "제출 중" : "제출")
                        Text(isSubmitting ? "…" : "↵")
                            .font(.system(size: 10, weight: .medium, design: .monospaced))
                            .padding(.horizontal, 5)
                            .frame(height: 16)
                            .background(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(canSubmitPrompt ? OpenDesignOfficeHoursColor.bgDeep.opacity(0.30) : Color.clear)
                            )
                    }
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(canSubmitPrompt ? OpenDesignOfficeHoursColor.bgDeep : OpenDesignOfficeHoursColor.mutedDeep)
                    .padding(.horizontal, 16)
                    .frame(height: 30)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(canSubmitPrompt ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.surface2)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(canSubmitPrompt ? Color.clear : OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(.plain)
                .disabled(!canSubmitPrompt)
                .accessibilityValue(canSubmitPrompt ? "Ready" : "Incomplete")
                .accessibilityIdentifier("assistant.structuredContinueButton")
            }
            .padding(.horizontal, 14)
            .padding(.vertical, footerVerticalPadding)
            .background(OpenDesignOfficeHoursColor.bgDeep)
            .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .top)
        }
        .background(OpenDesignOfficeHoursColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("assistant.structuredPrompt")
    }

    private func officeHoursStructuredQuestion(
        _ question: StructuredPromptQuestion,
        prompt: StructuredPromptRequest,
        isSubmitting: Bool
    ) -> some View {
        let hasOptions = question.options?.isEmpty == false
        let isRequiredTextOnly = question.requiresFreeText == true && !hasOptions
        let draft = viewModel.structuredPromptDraft(for: question, in: prompt)
        let pickedCount = hasOptions
            ? (draft.selectedOptions.isEmpty ? 0 : 1)
            : (draft.freeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? 0 : 1)
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                HStack(spacing: 8) {
                    RoundedRectangle(cornerRadius: 2, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.accent)
                        .frame(width: 4, height: 14)
                    Text(isRequiredTextOnly ? "근거 문장 입력" : "하나 선택")
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                }
                Spacer(minLength: 0)
                HStack(spacing: 4) {
                    Text("\(pickedCount)")
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                    Text("/ 1")
                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                }
                .font(.system(size: 10.5, weight: .medium, design: .monospaced))
            }
            .padding(.horizontal, 14)
            .padding(.vertical, 13.25)
            .background(OpenDesignOfficeHoursColor.surface2)
            .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)

            if hasOptions {
                VStack(spacing: 2) {
                    ForEach(Array((question.options ?? []).enumerated()), id: \.element.label) { optionIndex, option in
                        officeHoursPromptOptionRow(
                            option,
                            optionIndex: optionIndex,
                            question: question,
                            prompt: prompt,
                            disabled: isSubmitting
                        )
                    }
                }
                .padding(6)
            }

            if question.allowFreeText == true || question.options?.isEmpty != false {
                officeHoursFreeTextArea(question: question, prompt: prompt, isDisabled: isSubmitting)
            }
        }
        .opacity(isSubmitting ? 0.72 : 1)
    }

    private func officeHoursPromptOptionRow(
        _ option: StructuredPromptOption,
        optionIndex: Int,
        question: StructuredPromptQuestion,
        prompt: StructuredPromptRequest,
        disabled: Bool
    ) -> some View {
        let draft = viewModel.structuredPromptDraft(for: question, in: prompt)
        let selected = draft.selectedOptions.contains(option.label)
        return Button {
            guard !disabled else { return }
            // Tapping an option means the user is committing to a choice, not the
            // free-text field — drop focus so the cursor/keyboard leaves the input.
            // Selection never submits on its own; submission always goes through
            // the explicit 제출 button so the user can still adjust the choice or
            // add a free-text answer first.
            focusedOfficeHoursStructuredFreeTextID = nil
            viewModel.toggleStructuredPromptOption(option.label, for: question, in: prompt)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Text("\(optionIndex + 1)")
                    .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(selected ? OpenDesignOfficeHoursColor.bgDeep : OpenDesignOfficeHoursColor.muted)
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(selected ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.bgDeep))
                    .overlay(Circle().stroke(selected ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.border, lineWidth: 1))
                    .overlay {
                        if selected {
                            Circle()
                                .stroke(OpenDesignOfficeHoursColor.accent.opacity(0.18), lineWidth: 3)
                                .frame(width: 30, height: 30)
                        }
                    }
                    .padding(.top, 1)
                    .frame(width: 28, alignment: .leading)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(alignment: .firstTextBaseline, spacing: 6) {
                        Text(option.label)
                            .font(.system(size: 13, weight: .medium))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                            .tracking(-0.065)
                            .fixedSize(horizontal: false, vertical: true)
                        if option.recommended == true {
                            Text("추천")
                                .font(.system(size: 9.5, weight: .bold))
                                .foregroundStyle(OpenDesignOfficeHoursColor.bgDeep)
                                .padding(.horizontal, 5)
                                .frame(height: 16)
                                .background(
                                    RoundedRectangle(cornerRadius: 4, style: .continuous)
                                        .fill(OpenDesignOfficeHoursColor.accent)
                                )
                        }
                    }
                    Text(option.description)
                        .font(.system(size: 11.5, weight: .regular))
                        .foregroundStyle(selected ? OpenDesignOfficeHoursColor.fgSecondary : OpenDesignOfficeHoursColor.muted)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                    // Risk / evidence target / failure mode are intentionally not
                    // rendered here — they ride along to the agent as context on
                    // submit (collectSelectedOptionDescriptions in sidecar/index.mjs)
                    // and stay reachable via the accessibility hint below.
                }

                Spacer(minLength: 0)

                if selected {
                    Text("선택됨")
                        .font(.system(size: 10, weight: .regular, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                        .lineLimit(1)
                        .padding(.top, 4)
                        .frame(minWidth: 76, alignment: .trailing)
                }
            }
            .padding(.horizontal, 12)
            .padding(.top, 11)
            .padding(.bottom, 11)
            .frame(minHeight: 64, alignment: .topLeading)
            .frame(maxWidth: .infinity, alignment: .leading)
            .officeHoursOptionRowSurface(selected: selected, disabled: disabled)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .frame(maxWidth: .infinity, alignment: .leading)
        .contentShape(Rectangle())
        .disabled(disabled)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("assistant.structuredChoice.\(question.id).\(option.label)")
        .accessibilityLabel(option.label)
        .accessibilityHint(officeHoursOptionAccessibilityHint(option))
        .accessibilityValue(selected ? "Selected" : "Not selected")
        .accessibilityAddTraits(.isButton)
    }

    private func officeHoursOptionMetadataLines(_ option: StructuredPromptOption) -> [String] {
        var lines: [String] = []
        if let risk = option.risk?.nonEmpty {
            lines.append("리스크: \(risk)")
        }
        if let evidenceTarget = option.evidenceTarget?.nonEmpty {
            lines.append("근거: \(evidenceTarget)")
        }
        if let failureMode = option.failureMode?.nonEmpty {
            lines.append("실패 조건: \(failureMode)")
        }
        return lines.prefix(3).map { String($0) }
    }

    private func officeHoursOptionAccessibilityHint(_ option: StructuredPromptOption) -> String {
        var parts = [option.description]
        if option.recommended == true {
            parts.append("추천 선택지")
        }
        parts.append(contentsOf: officeHoursOptionMetadataLines(option))
        return parts.joined(separator: ". ")
    }

    private func officeHoursFreeTextArea(
        question: StructuredPromptQuestion,
        prompt: StructuredPromptRequest,
        isDisabled: Bool
    ) -> some View {
        let isRequiredText = question.requiresFreeText == true
        let placeholder = question.freeTextPlaceholder?.nonEmpty ?? "예: 실제 사용자, 현재 대안, 이번 주 행동"
        let focusID = "office-hours-free-text-\(prompt.requestId)-\(question.id)"
        let showsPromptFocusRing = !isDisabled
            && focusedOfficeHoursStructuredFreeTextID == focusID
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text(isRequiredText ? "근거 문장 입력" : "선택지에 없으면 입력")
                Spacer(minLength: 0)
                Text(isRequiredText ? "필수" : "Enter 제출")
                    .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
                    .tracking(0.4)
            }
            .font(.system(size: 10, weight: .regular, design: .monospaced))
            .foregroundStyle(OpenDesignOfficeHoursColor.muted)
            .tracking(1.0)
            .textCase(.uppercase)

            HStack(spacing: 10) {
                Text("›")
                    .font(.system(size: 14, weight: .medium, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                if question.textMode == .long {
                    ZStack(alignment: .topLeading) {
                        if viewModel.structuredPromptDraft(for: question, in: prompt).freeText
                            .trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                            Text(placeholder)
                                .font(.system(size: 13, weight: .regular, design: .monospaced))
                                .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
                                .padding(.horizontal, 4)
                                .padding(.vertical, 8)
                        }
                        TextEditor(
                            text: Binding(
                                get: { viewModel.structuredPromptDraft(for: question, in: prompt).freeText },
                                set: { viewModel.updateStructuredPromptFreeText($0, for: question, in: prompt) }
                            )
                        )
                        .scrollContentBackground(.hidden)
                        .font(.system(size: 13, weight: .regular, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                        .frame(minHeight: 72)
                        .disabled(isDisabled)
                        .focused($focusedOfficeHoursStructuredFreeTextID, equals: focusID)
                        .accessibilityIdentifier("assistant.structuredFreeText.\(question.id)")
                    }
                } else {
                    TextField(
                        placeholder,
                        text: Binding(
                            get: { viewModel.structuredPromptDraft(for: question, in: prompt).freeText },
                            set: { viewModel.updateStructuredPromptFreeText($0, for: question, in: prompt) }
                        )
                    )
                    .textFieldStyle(.plain)
                    .font(.system(size: 13, weight: .regular, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    .disabled(isDisabled)
                    .focused($focusedOfficeHoursStructuredFreeTextID, equals: focusID)
                    .onSubmit {
                        submitPrompt(prompt)
                    }
                    .accessibilityIdentifier("assistant.structuredFreeText.\(question.id)")
                    .accessibilityLabel(placeholder)
                }
            }
            .padding(.horizontal, 12)
            .frame(minHeight: question.textMode == .long ? 92 : 36)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(OpenDesignOfficeHoursColor.surface)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(
                                showsPromptFocusRing
                                    ? OpenDesignOfficeHoursColor.accentLine
                                    : OpenDesignOfficeHoursColor.borderSoft,
                                lineWidth: 1
                            )
                    )
                    .shadow(
                        color: showsPromptFocusRing
                            ? OpenDesignOfficeHoursColor.accentDim
                            : Color.clear,
                        radius: showsPromptFocusRing ? 3 : 0
                    )
            )
        }
        .padding(.horizontal, 14)
        .padding(.top, 11)
        .padding(.bottom, 13)
        .background(OpenDesignOfficeHoursColor.bgDeep)
        .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .top)
        .onDisappear {
            if focusedOfficeHoursStructuredFreeTextID == focusID {
                focusedOfficeHoursStructuredFreeTextID = nil
            }
        }
    }

    private func officeHoursStructuredPromptHintParts(
        _ prompt: StructuredPromptRequest
    ) -> (label: String, name: String?) {
        guard let selected = officeHoursSelectedOptionInfo(prompt) else {
            return ("미선택", nil)
        }
        return ("선택됨 · \(selected.index)번", selected.label)
    }

    private func officeHoursSelectedOptionInfo(
        _ prompt: StructuredPromptRequest
    ) -> (index: Int, label: String)? {
        for question in prompt.questions {
            let draft = viewModel.structuredPromptDraft(for: question, in: prompt)
            guard let selectedLabel = draft.selectedOptions.first else { continue }
            let index = (question.options ?? []).firstIndex { $0.label == selectedLabel }.map { $0 + 1 } ?? 1
            return (index, selectedLabel)
        }
        return nil
    }

    private func officeHoursLoadingSession() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(viewModel.isConnected ? "채팅 세션을 만드는 중입니다." : "채팅 세션을 준비 중입니다.")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
            Text(viewModel.day1GoalSelection == nil
                ? "목표 확립 후 Day 1 인터뷰 질문을 준비합니다."
                : viewModel.isConnected ? "세션이 만들어지면 Day 1 인터뷰 질문을 자동으로 준비합니다." : "실행 보조 앱 연결 후 시작할 수 있습니다.")
                .font(.system(size: 12, weight: .medium))
                .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
        }
        .padding(14)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(openDesignOfficeHoursBackground(cornerRadius: 10, fill: OpenDesignOfficeHoursColor.surface))
    }

    private func officeHoursMetaPanel(session: ChatSession?, activeDay: Int) -> some View {
        VStack(spacing: 0) {
            HStack(spacing: 12) {
                Text("세션 정보")
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                Spacer(minLength: 0)
                officeHoursStatusPill(session: session)
            }
            .padding(.horizontal, 16)
            .frame(height: 47)
            .background(OpenDesignOfficeHoursColor.bg)
            .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)

            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    officeHoursMetaCard(
                        title: "진행 상태",
                        trailing: selectedOfficeHoursMode.label,
                        fixedHeight: 226
                    ) {
                        VStack(spacing: 0) {
                            officeHoursMetaRunStep(
                                title: "세션 대기",
                                detail: "저장된 목표를 불러온다.",
                                isDone: officeHoursModePicked(session: session, activeDay: activeDay),
                                isLive: !officeHoursModePicked(session: session, activeDay: activeDay)
                            )
                            officeHoursMetaRunStep(
                                title: "질문 준비",
                                detail: "목표 기준으로 첫 질문을 준비한다.",
                                isDone: officeHoursModePicked(session: session, activeDay: activeDay),
                                isLive: officeHoursHasPendingStart(activeDay: activeDay)
                            )
                            officeHoursMetaRunStep(
                                title: "질문 진행",
                                detail: "한 번에 하나씩 묻고 요약한다.",
                                isDone: officeHoursAnswerCount(session: session) > 0,
                                isLive: session?.pendingUserInput != nil || session?.status == .running
                            )
                            officeHoursMetaRunStep(
                                title: "증거 정리",
                                detail: "답변 근거를 로컬 또는 공개 기록에 남긴다.",
                                isDone: false,
                                isLive: officeHoursAnswerCount(session: session) > 0 && session?.pendingUserInput == nil,
                                showsDivider: false
                            )
                        }
                    }

                    officeHoursMetaCard(
                        title: "Design doc 초안",
                        trailing: nil,
                        actionTitle: officeHoursMetaDocSaveTitle,
                        actionDisabled: !officeHoursCanSaveDoc(session: session) || officeHoursDay1DocumentsWritten || officeHoursDocumentHandoffBusy,
                        action: {
                            if let session {
                                startOfficeHoursDocumentHandoff(session: session)
                            }
                        },
                        fixedHeight: 226
                    ) {
                        let previewRows = officeHoursDocPreviewRows(session: session, activeDay: activeDay)
                        VStack(alignment: .leading, spacing: 10) {
                            VStack(spacing: 9) {
                                ForEach(Array(previewRows.enumerated()), id: \.offset) { index, row in
                                    HStack(alignment: .firstTextBaseline, spacing: 10) {
                                        Text(row.label)
                                            .font(.system(size: 11, weight: .regular))
                                            .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                                        Spacer(minLength: 0)
                                        Text(row.value)
                                            .font(.system(size: 11.25, weight: .regular))
                                            .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                                            .multilineTextAlignment(.trailing)
                                            .lineLimit(2)
                                    }
                                    .frame(minHeight: 18, alignment: .center)
                                    .padding(.bottom, index < previewRows.count - 1 ? 8 : 0)
                                    .overlay(alignment: .bottom) {
                                        if index < previewRows.count - 1 {
                                            Rectangle()
                                                .fill(OpenDesignOfficeHoursColor.borderSoft)
                                                .frame(height: 1)
                                        }
                                    }
                                }
                            }
                            .padding(12)
                            .background(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(OpenDesignOfficeHoursColor.bgDarker)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                                            .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                                    )
                            )
                        }
                    }

                    officeHoursMetaCard(title: "질문 원칙", trailing: nil, fixedHeight: 226) {
                        VStack(spacing: 8) {
                            officeHoursPrincipleItem(title: "관심보다 행동", body: "대기 신청자가 아니라 돈, 반복 사용, 없어졌을 때 급히 찾는 행동을 본다.")
                            officeHoursPrincipleItem(title: "카테고리보다 사람", body: "소규모 회사처럼 넓은 말이 아니라 실제 이름, 역할, 실패 비용을 묻는다.")
                            officeHoursPrincipleItem(title: "플랫폼보다 진입점", body: "이번 주에 보여주거나 팔 수 있는 가장 작은 단위로 좁힌다.")
                        }
                    }
                }
                .padding(14)
            }
        }
        .frame(maxHeight: .infinity)
        .background(OpenDesignOfficeHoursColor.bg)
        .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(width: 1), alignment: .leading)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.meta")
    }

    private func officeHoursMetaCard<Content: View>(
        title: String,
        trailing: String?,
        actionTitle: String? = nil,
        actionDisabled: Bool = false,
        action: (() -> Void)? = nil,
        fixedHeight: CGFloat? = nil,
        @ViewBuilder content: () -> Content
    ) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 8) {
                Text(title)
                    .font(.system(size: 13, weight: .regular))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                Spacer(minLength: 0)
                if let trailing {
                    Text(trailing)
                        .font(.system(size: 9.75, weight: .regular, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                        .padding(.horizontal, 7)
                        .frame(height: 19)
                        .background(Capsule().fill(OpenDesignOfficeHoursColor.selected))
                        .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1))
                }
                if let actionTitle, let action {
                    Button(action: action) {
                        Text(actionTitle)
                            .font(.system(size: 11, weight: .regular))
                            .foregroundStyle(actionDisabled ? OpenDesignOfficeHoursColor.mutedDeep : OpenDesignOfficeHoursColor.fgSecondary)
                            .padding(.horizontal, 10)
                            .frame(height: 26)
                            .background(
                                RoundedRectangle(cornerRadius: 6, style: .continuous)
                                    .fill(OpenDesignOfficeHoursColor.bgDarker)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                                            .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                                    )
                            )
                    }
                    .buttonStyle(.plain)
                    .disabled(actionDisabled)
                    .accessibilityIdentifier("opendesign.officeHours.saveDoc")
                }
            }
            .padding(.horizontal, 13)
            .frame(height: 42)
            .background(OpenDesignOfficeHoursColor.surface2)
            .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .bottom)

            content()
                .padding(.horizontal, 13)
                .padding(.vertical, 12)
        }
        .frame(height: fixedHeight, alignment: .top)
        .background(OpenDesignOfficeHoursColor.surface)
        .clipShape(RoundedRectangle(cornerRadius: 10, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
        )
    }

    private func officeHoursMetaRunStep(
        title: String,
        detail: String,
        isDone: Bool,
        isLive: Bool,
        showsDivider: Bool = true
    ) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Circle()
                .fill(OpenDesignOfficeHoursColor.bgDeep)
                .frame(width: 18, height: 18)
                .overlay(Circle().stroke(isLive ? OpenDesignOfficeHoursColor.accentLine : OpenDesignOfficeHoursColor.border, lineWidth: 1))
                .overlay(
                    Circle()
                        .fill(isDone ? OpenDesignOfficeHoursColor.accent : isLive ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.mutedDeep)
                        .frame(width: 6, height: 6)
                )
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 6) {
                Text(title)
                    .font(.system(size: 11.75, weight: .regular))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                    .lineLimit(1)
                Text(detail)
                    .font(.system(size: 11, weight: .regular))
                    .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                    .tracking(-0.14)
                    .lineLimit(1)
                    .minimumScaleFactor(0.94)
            }
            Spacer(minLength: 0)
        }
        .padding(.vertical, 10.5)
        .overlay(alignment: .bottom) {
            if showsDivider {
                Rectangle()
                    .fill(OpenDesignOfficeHoursColor.borderSoft)
                    .frame(height: 1)
            }
        }
    }

    private func officeHoursPrincipleItem(title: String, body: String) -> some View {
        VStack(alignment: .leading, spacing: 2) {
            Text(title)
                .font(.system(size: 11.25, weight: .regular))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
            Text(body)
                .font(.system(size: 11, weight: .regular))
                .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 9)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(OpenDesignOfficeHoursColor.bgDarker)
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                )
        )
    }

    #if DEBUG
    private func officeHoursRealProjectTestCard(
        day1Content: OpenDesignDayContent,
        session: ChatSession?
    ) -> some View {
        let checks = officeHoursRealProjectQualityChecks(session: session, day1Content: day1Content)
        return VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    RoundedRectangle(cornerRadius: 9, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.accentDim)
                        .overlay(
                            RoundedRectangle(cornerRadius: 9, style: .continuous)
                                .stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1)
                        )
                    Image(systemName: "checklist.checked")
                        .font(.system(size: 14, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                }
                .frame(width: 34, height: 34)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text("REAL PROJECT OFFICE HOURS TEST")
                            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                        Text("DEBUG")
                            .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                            .padding(.horizontal, 6)
                            .frame(height: 18)
                            .background(Capsule().fill(OpenDesignOfficeHoursColor.amberDim))
                            .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.amber.opacity(0.35), lineWidth: 1))
                    }
                    Text("현재 프로젝트 scan 결과로 오피스 아워 첫 질문 품질을 바로 검증합니다.")
                        .font(.system(size: 13, weight: .medium))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Button {
                    startOfficeHoursRealProjectTest(day1Content: day1Content)
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: officeHoursRealProjectTestState.isBusy ? "hourglass" : "play.fill")
                            .font(.system(size: 11, weight: .semibold))
                        Text(officeHoursRealProjectTestState.isBusy ? "Running" : "Test current project")
                            .font(.system(size: 11.5, weight: .semibold))
                    }
                    .foregroundStyle(officeHoursRealProjectTestState.isBusy ? OpenDesignOfficeHoursColor.mutedDeep : OpenDesignOfficeHoursColor.bgDeep)
                    .padding(.horizontal, 13)
                    .frame(height: 30)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(officeHoursRealProjectTestState.isBusy ? OpenDesignOfficeHoursColor.surface : OpenDesignOfficeHoursColor.accent)
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(officeHoursRealProjectTestState.isBusy ? OpenDesignOfficeHoursColor.borderSoft : Color.clear, lineWidth: 1)
                    )
                }
                .buttonStyle(.plain)
                .disabled(officeHoursRealProjectTestState.isBusy)
                .accessibilityIdentifier("opendesign.officeHours.realProjectTest.start")
            }

            officeHoursRealProjectTestStatusRow

            if officeHoursRealProjectTestState != .idle {
                officeHoursRealProjectContextPreview(day1Content: day1Content, session: session)
            }

            if officeHoursRealProjectTestShowsQualityPanel {
                officeHoursRealProjectQualityPanel(checks: checks, session: session, day1Content: day1Content)
            }
        }
        .padding(14)
        .background(
            openDesignOfficeHoursBackground(
                cornerRadius: 12,
                fill: OpenDesignOfficeHoursColor.surface,
                stroke: OpenDesignOfficeHoursColor.accentLine.opacity(0.8)
            )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.realProjectTest")
        .onChange(of: viewModel.isScanning) { _, _ in
            continueOfficeHoursRealProjectTestIfReady(day1Content: day1Content)
        }
        .onChange(of: viewModel.scanResult) { _, _ in
            continueOfficeHoursRealProjectTestIfReady(day1Content: day1Content)
        }
        .onChange(of: session?.id) { _, _ in
            continueOfficeHoursRealProjectTestIfReady(day1Content: day1Content)
        }
        .onChange(of: session?.status) { _, _ in
            refreshOfficeHoursRealProjectReviewState(session: session)
        }
        .onChange(of: session?.pendingUserInput?.requestId) { _, _ in
            refreshOfficeHoursRealProjectReviewState(session: session)
        }
        .onChange(of: session?.messages.count) { _, _ in
            refreshOfficeHoursRealProjectReviewState(session: session)
        }
    }
    #endif

    private var officeHoursRealProjectTestStatusRow: some View {
        let status = officeHoursRealProjectTestStatus
        return HStack(spacing: 8) {
            Circle()
                .fill(status.color)
                .frame(width: 7, height: 7)
            Text(status.label)
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(status.color)
                .lineLimit(1)
            Text(status.detail)
                .font(.system(size: 11.5, weight: .medium))
                .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                .lineLimit(2)
            Spacer(minLength: 0)
        }
        .accessibilityIdentifier("opendesign.officeHours.realProjectTest.status")
    }

    private var officeHoursRealProjectTestShowsQualityPanel: Bool {
        switch officeHoursRealProjectTestState {
        case .readyForReview, .failed:
            return true
        case .idle, .scanning, .starting, .waitingForFirstQuestion:
            return false
        }
    }

    private var officeHoursRealProjectTestStatus: (label: String, detail: String, color: Color) {
        switch officeHoursRealProjectTestState {
        case .idle:
            return ("idle", "실행 전입니다. 현재 워크스페이스와 선택한 AI 연결을 사용합니다.", OpenDesignOfficeHoursColor.muted)
        case .scanning:
            return ("scanning", viewModel.scanProgressMessage.nonEmpty ?? "Workspace scan을 기다리는 중입니다.", OpenDesignOfficeHoursColor.amber)
        case .starting:
            return ("starting", "오피스 아워 세션과 실제 AI 실행을 준비 중입니다.", OpenDesignOfficeHoursColor.amber)
        case .waitingForFirstQuestion:
            return ("waiting", "첫 응답과 structured question card를 기다리는 중입니다.", OpenDesignOfficeHoursColor.accent)
        case .readyForReview:
            return ("review", "첫 질문 품질을 확인할 수 있습니다.", OpenDesignOfficeHoursColor.accent)
        case .failed(let message):
            return ("blocked", message, OpenDesignOfficeHoursColor.rose)
        }
    }

    private func officeHoursRealProjectContextPreview(
        day1Content: OpenDesignDayContent,
        session: ChatSession?
    ) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Context preview")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.accent)

            VStack(spacing: 1) {
                ForEach(officeHoursRealProjectPreviewRows(day1Content: day1Content, session: session), id: \.label) { row in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(row.label)
                            .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                            .frame(width: 112, alignment: .leading)
                        Text(row.value)
                            .font(.system(size: 11.5, weight: .medium))
                            .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                            .frame(maxWidth: .infinity, alignment: .leading)
                    }
                    .padding(.horizontal, 12)
                    .padding(.vertical, 8)
                    .background(OpenDesignOfficeHoursColor.bgDeep)
                }
            }
            .clipShape(RoundedRectangle(cornerRadius: 8, style: .continuous))
            .overlay(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
            )
        }
        .accessibilityIdentifier("opendesign.officeHours.realProjectTest.context")
    }

    private func officeHoursRealProjectQualityPanel(
        checks: [OfficeHoursRealProjectQualityCheck],
        session: ChatSession?,
        day1Content: OpenDesignDayContent
    ) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(spacing: 8) {
                Text("Quality checklist")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                Spacer(minLength: 0)
                Button {
                    copyOfficeHoursRealProjectTestReport(session: session, day1Content: day1Content)
                } label: {
                    Label(didCopyOfficeHoursRealProjectTestReport ? "Copied" : "Copy test report", systemImage: "doc.on.doc")
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                        .padding(.horizontal, 10)
                        .frame(height: 26)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(OpenDesignOfficeHoursColor.bgDeep)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .stroke(OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                                )
                        )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("opendesign.officeHours.realProjectTest.copyReport")
            }

            VStack(spacing: 8) {
                ForEach(checks) { check in
                    officeHoursRealProjectCheckRow(check)
                }
            }

            if let excerpt = officeHoursRealProjectResponseExcerpt(session: session) {
                Text(excerpt)
                    .font(.system(size: 11.5, weight: .regular))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fgSecondary)
                    .lineLimit(5)
                    .fixedSize(horizontal: false, vertical: true)
                    .padding(10)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(openDesignOfficeHoursBackground(cornerRadius: 8, fill: OpenDesignOfficeHoursColor.bgDeep))
                    .accessibilityIdentifier("opendesign.officeHours.realProjectTest.responseExcerpt")
            }
        }
        .accessibilityIdentifier("opendesign.officeHours.realProjectTest.quality")
    }

    private func officeHoursRealProjectCheckRow(_ check: OfficeHoursRealProjectQualityCheck) -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: check.state.systemImage)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(check.state.color)
                .frame(width: 16, height: 16)
            VStack(alignment: .leading, spacing: 2) {
                Text(check.title)
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                Text(check.detail)
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                    .fixedSize(horizontal: false, vertical: true)
            }
            Spacer(minLength: 0)
        }
        .padding(10)
        .background(openDesignOfficeHoursBackground(cornerRadius: 8, fill: OpenDesignOfficeHoursColor.bgDeep))
    }

    private func officeHoursScreenFooter() -> some View {
        HStack(spacing: 12) {
            HStack(spacing: 9) {
                Image(systemName: "rectangle.split.2x1")
                    .font(.system(size: 10.5, weight: .bold))
                    .foregroundStyle(OpenDesignOfficeHoursColor.bgDeep)
                    .frame(width: 22, height: 22)
                    .background(Circle().fill(OpenDesignOfficeHoursColor.accent))

                VStack(alignment: .leading, spacing: 2) {
                    Text("독립 오피스 아워")
                        .font(.system(size: 11.5, weight: .semibold))
                        .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                        .lineLimit(1)
                    Text("Day 1 완료 조건과 별개로 언제든 질문할 수 있습니다.")
                        .font(.system(size: 10.5, weight: .medium))
                        .foregroundStyle(OpenDesignOfficeHoursColor.muted)
                        .lineLimit(1)
                }
            }

            Spacer(minLength: 0)

            Button {
                withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                    isOpenDesignOfficeHoursPresented = false
                }
            } label: {
                HStack(spacing: 6) {
                    Text("오늘 화면으로 돌아가기")
                    Image(systemName: "arrow.turn.down.left")
                        .font(.system(size: 11, weight: .semibold))
                }
                .font(.system(size: 12.5, weight: .semibold))
                .foregroundStyle(OpenDesignOfficeHoursColor.bgDeep)
                .padding(.horizontal, 17)
                .frame(height: 34)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(OpenDesignOfficeHoursColor.accent)
                )
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("opendesign.officeHours.returnToToday")
        }
        .padding(.horizontal, 14)
        .frame(height: 58)
        .background(OpenDesignOfficeHoursColor.bgDeep)
        .overlay(Rectangle().fill(OpenDesignOfficeHoursColor.borderSoft).frame(height: 1), alignment: .top)
    }

    private func officeHoursScrollTarget(for session: ChatSession?, activeDay: Int) -> (id: String, anchor: UnitPoint) {
        guard let session else {
            return (Self.officeHoursTranscriptBottomID, .bottom)
        }
        if let prompt = session.pendingUserInput {
            let snapshots = officeHoursSubmittedPromptSnapshots(for: session)
            if !snapshots.contains(where: { $0.requestId == prompt.requestId }) {
                let latestSubmittedID = snapshots.sorted { lhs, rhs in
                    if lhs.submittedAt == rhs.submittedAt { return lhs.requestId < rhs.requestId }
                    return lhs.submittedAt < rhs.submittedAt
                }.last?.id
                let remainingLoadingNanoseconds = officeHoursRemainingQuestionLoadingNanoseconds(for: session.id)
                let targetID: String
                if let latestSubmittedID, remainingLoadingNanoseconds > 0 {
                    targetID = latestSubmittedID
                } else if snapshots.isEmpty {
                    targetID = officeHoursPendingPromptScrollID(for: prompt.requestId)
                } else {
                    targetID = officeHoursPendingPromptHeaderID(for: prompt.requestId)
                }
                return (targetID, .top)
            }
        }
        if let loader = officeHoursActiveQuestionLoader(for: session) {
            let snapshots = officeHoursSubmittedPromptSnapshots(for: session)
            return (snapshots.isEmpty ? Self.officeHoursQuestionStageTopID : loader.requestId, .top)
        }
        if officeHoursIsDocReady(session: session) {
            if officeHoursDay1DocumentsWritten {
                if officeHoursDay1CommitmentClosed(activeDay: activeDay) {
                    return (Self.officeHoursDay1CompleteButtonID, .top)
                }
                if shouldRenderOfficeHoursCommitmentBar(session: session, activeDay: activeDay) {
                    return (Self.officeHoursCommitmentBarID, .top)
                }
                return (Self.officeHoursDocReadyHeaderID, .top)
            }
            return (Self.officeHoursDocReadyHeaderID, .top)
        }
        return (Self.officeHoursTranscriptBottomID, .bottom)
    }

    private func officeHoursPendingPromptHeaderID(for requestID: String) -> String {
        "\(requestID)-pending-header"
    }

    private func officeHoursPendingPromptScrollID(for requestID: String) -> String {
        "\(requestID)-pending-scroll"
    }

    private func scrollOfficeHoursTranscript(_ proxy: ScrollViewProxy, session: ChatSession?, activeDay: Int) {
        officeHoursScrollGeneration &+= 1
        let generation = officeHoursScrollGeneration
        let target = officeHoursScrollTarget(for: session, activeDay: activeDay)
        let performScroll = {
            guard OfficeHoursTranscriptScrollPolicy.shouldPerform(
                requestGeneration: generation,
                currentGeneration: officeHoursScrollGeneration
            ) else { return }
            if reduceMotion {
                proxy.scrollTo(target.id, anchor: target.anchor)
            } else {
                withAnimation(.easeOut(duration: 0.18)) {
                    proxy.scrollTo(target.id, anchor: target.anchor)
                }
            }
        }
        DispatchQueue.main.async {
            performScroll()
            for delay in OfficeHoursTranscriptScrollPolicy.repinDelays {
                DispatchQueue.main.asyncAfter(deadline: .now() + delay) {
                    performScroll()
                }
            }
        }
    }

    @ViewBuilder
    private func officeHoursTranscriptRow(
        _ row: OfficeHoursTranscriptRow,
        session: ChatSession
    ) -> some View {
        HStack(alignment: .top, spacing: 10) {
            if row.isUser {
                Spacer(minLength: 72)
            } else {
                officeHoursMessageAvatar(row)
            }

            VStack(alignment: row.isUser ? .trailing : .leading, spacing: 5) {
                officeHoursMessageMeta(row)

                if row.isStreamingPlaceholder {
                    let liveStatus = viewModel.officeHoursLiveStatus(for: session.id)
                    assistantLiveStatusPanel(
                        provider: row.provider ?? session.provider,
                        outputLines: viewModel.sidecarOutputPreview(for: session.id),
                        isLarge: false,
                        tone: .surface,
                        title: liveStatus?.title?.nonEmpty ?? "\(row.provider?.title ?? session.provider.title)가 다음 질문을 준비 중",
                        idleDetail: liveStatus?.detail?.nonEmpty ?? "실행 이벤트를 기다리는 중입니다.",
                        streamingDetail: liveStatus?.detail?.nonEmpty ?? liveStatus?.progressText?.nonEmpty ?? "실행 타임라인 스트리밍",
                        emptyMessage: liveStatus?.progressText?.nonEmpty ?? "답변은 저장됐고 첫 응답 이벤트를 기다리는 중입니다."
                    )
                    .accessibilityIdentifier("opendesign.officeHours.liveStatus")
                } else {
                    officeHoursTranscriptBubble(row)
                }
            }
            .frame(maxWidth: row.isUser ? 560 : 680, alignment: row.isUser ? .trailing : .leading)

            if !row.isUser {
                Spacer(minLength: 72)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.message.\(row.id)")
    }

    private func officeHoursMessageAvatar(_ row: OfficeHoursTranscriptRow) -> some View {
        ZStack {
            Circle()
                .fill(row.kind == .system ? OpenDesignOfficeHoursColor.surface2 : OpenDesignOfficeHoursColor.accentDim)
                .overlay(
                    Circle().stroke(row.kind == .system ? OpenDesignOfficeHoursColor.borderSoft : OpenDesignOfficeHoursColor.accentLine, lineWidth: 1)
                )
            Image(systemName: row.kind == .system ? "gearshape" : "sparkles")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(row.kind == .system ? OpenDesignOfficeHoursColor.muted : OpenDesignOfficeHoursColor.accent)
        }
        .frame(width: 26, height: 26)
        .padding(.top, 16)
    }

    private func officeHoursMessageMeta(_ row: OfficeHoursTranscriptRow) -> some View {
        HStack(spacing: 6) {
            if row.isUser {
                Text("you")
            } else {
                Text(row.kind == .system ? "system" : "assistant")
                if let provider = row.provider {
                    Text("·")
                        .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
                    Text(provider.title)
                }
            }
        }
        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
        .foregroundStyle(row.isUser ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.muted)
        .lineLimit(1)
    }

    private func officeHoursTranscriptBubble(_ row: OfficeHoursTranscriptRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            if !row.content.isEmpty {
                Self.transcriptBubbleText(for: row)
                    .textSelection(.enabled)
                    .lineLimit(row.lineLimit)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
            }

            if OfficeHoursLiveStatusPolicy.shouldShowStreamingBadge(for: row) {
                HStack(spacing: 6) {
                    ProgressView()
                        .controlSize(.mini)
                        .scaleEffect(0.72)
                        .frame(width: 12, height: 12)
                    Text("작성 중")
                        .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                }
                .padding(.horizontal, 8)
                .frame(height: 22)
                .background(Capsule().fill(OpenDesignOfficeHoursColor.accentDim))
                .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1))
                .accessibilityIdentifier("opendesign.officeHours.streamingBadge")
            }

            if let error = row.error?.trimmingCharacters(in: .whitespacesAndNewlines),
               !error.isEmpty,
               !row.content.localizedCaseInsensitiveContains(error) {
                Text(error)
                    .font(.system(size: 13, weight: .medium))
                    .foregroundStyle(OpenDesignOfficeHoursColor.rose)
                    .textSelection(.enabled)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(row.isUser ? OpenDesignOfficeHoursColor.accentDim : OpenDesignOfficeHoursColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(row.isUser ? OpenDesignOfficeHoursColor.accentLine : OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
                )
        )
        .overlay(alignment: .leading) {
            if !row.isUser {
                RoundedRectangle(cornerRadius: 2, style: .continuous)
                    .fill(row.kind == .system ? OpenDesignOfficeHoursColor.mutedDeep : OpenDesignOfficeHoursColor.accent)
                    .frame(width: 3)
                    .padding(.vertical, 1)
            }
        }
    }

    /// Builds the transcript bubble body text. When the row carries no emphasis
    /// spans this is byte-for-byte the historical plain `Text` (same font,
    /// weight, color) so existing chat replies render unchanged. When emphasis
    /// is present each matched phrase is styled inline (strong/mark/code) by
    /// reusing the Office Hours segment splitter and color vocabulary, sized for
    /// the chat bubble rather than the 17pt statement surface.
    private static func transcriptBubbleText(for row: OfficeHoursTranscriptRow) -> Text {
        let baseSize: CGFloat = row.isUser ? 13.5 : 14
        let baseWeight: Font.Weight = row.isUser ? .semibold : .regular
        guard !row.emphasis.isEmpty else {
            return Text(row.content)
                .font(.system(size: baseSize, weight: baseWeight))
                .foregroundColor(OpenDesignOfficeHoursColor.fg)
        }

        let segments = OfficeHoursPromptTextSegment.segments(in: row.content, emphasis: row.emphasis)
        guard !segments.isEmpty else {
            return Text(row.content)
                .font(.system(size: baseSize, weight: baseWeight))
                .foregroundColor(OpenDesignOfficeHoursColor.fg)
        }

        return styledTranscriptSegments(segments, baseSize: baseSize, baseWeight: baseWeight)
    }

    private static func styledTranscriptSegments(
        _ segments: [OfficeHoursPromptTextSegment],
        baseSize: CGFloat,
        baseWeight: Font.Weight
    ) -> Text {
        styledTranscriptSegments(segments, startingAt: segments.startIndex, baseSize: baseSize, baseWeight: baseWeight)
    }

    private static func styledTranscriptSegments(
        _ segments: [OfficeHoursPromptTextSegment],
        startingAt index: Int,
        baseSize: CGFloat,
        baseWeight: Font.Weight
    ) -> Text {
        guard index < segments.endIndex else {
            return Text("")
        }

        let firstText = styledTranscriptSegment(segments[index], baseSize: baseSize, baseWeight: baseWeight)
        let remainingText = styledTranscriptSegments(segments, startingAt: segments.index(after: index), baseSize: baseSize, baseWeight: baseWeight)
        return Text("\(firstText)\(remainingText)")
    }

    private static func styledTranscriptSegment(
        _ segment: OfficeHoursPromptTextSegment,
        baseSize: CGFloat,
        baseWeight: Font.Weight
    ) -> Text {
        switch segment.renderStyle {
        case .body, .legacyAccent:
            // `.legacyAccent` is never produced by the emphasis path; fall back
            // to the body treatment so chat text stays consistent.
            return Text(segment.text)
                .font(.system(size: baseSize, weight: baseWeight))
                .foregroundColor(OpenDesignOfficeHoursColor.fg)
        case .strong:
            return Text(segment.text)
                .font(.system(size: baseSize, weight: .semibold))
                .foregroundColor(OpenDesignOfficeHoursColor.fg)
        case .mark:
            return Text(segment.text)
                .font(.system(size: baseSize, weight: baseWeight))
                .foregroundColor(OpenDesignOfficeHoursColor.amber)
        case .code:
            return Text(segment.text)
                .font(.system(size: baseSize, weight: .medium, design: .monospaced))
                .foregroundColor(OpenDesignOfficeHoursColor.accent)
        }
    }

    private func openDesignOfficeHoursBackground(
        cornerRadius: CGFloat,
        fill: Color,
        stroke: Color = OpenDesignOfficeHoursColor.borderSoft
    ) -> some View {
        RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
            .fill(fill)
            .overlay(
                RoundedRectangle(cornerRadius: cornerRadius, style: .continuous)
                    .stroke(stroke, lineWidth: 1)
            )
    }

    private func officeHoursSessionCanReceiveStart(_ session: ChatSession?) -> Bool {
        guard let session else { return viewModel.isConnected }
        guard session.status == .idle else { return false }
        guard session.pendingUserInput == nil else { return false }
        return OfficeHoursTranscriptRow.rows(from: session.messages).isEmpty
    }

    private func officeHoursSelectedSourceIDs() -> [String] {
        let manager = IntakeV2SourceManager()
        let mapped = manager.connectedSources.compactMap { source -> String? in
            switch source.id {
            case .github:
                return "github"
            case .posthog:
                return "posthog"
            case .cloudflare:
                return "cloudflare"
            default:
                return nil
            }
        }
        return Array(Set(mapped)).sorted()
    }

    private func refreshOfficeHoursSourceGateIfNeeded(day: Int, session: ChatSession?) {
        guard day >= 2 else { return }
        viewModel.refreshOfficeHoursSourceGate(
            sessionID: session?.id,
            day: day,
            selectedSources: officeHoursSelectedSourceIDs()
        )
    }

    private func officeHoursHasPendingStart(activeDay: Int?) -> Bool {
        guard pendingOfficeHoursStartMode != nil else { return false }
        guard let activeDay, let pendingOfficeHoursStartDay else { return true }
        return activeDay == pendingOfficeHoursStartDay
    }

    private func officeHoursCanStart(session: ChatSession?, activeDay: Int? = nil) -> Bool {
        guard viewModel.day1GoalSelection != nil else { return false }
        return !officeHoursHasPendingStart(activeDay: activeDay) && officeHoursSessionCanReceiveStart(session)
    }

    private func officeHoursModePicked(session: ChatSession?, activeDay: Int? = nil) -> Bool {
        if officeHoursHasPendingStart(activeDay: activeDay) { return true }
        guard let session else { return false }
        if session.runtime?.officeHours?.active == true { return true }
        if session.pendingUserInput != nil { return true }
        if session.status == .running { return true }
        return !OfficeHoursTranscriptRow.rows(from: session.messages).isEmpty
    }

    private func officeHoursAnswerCount(session: ChatSession?) -> Int {
        guard let session else { return 0 }
        return officeHoursCompletedQuestionCount(session: session)
    }

    private func officeHoursSessionCountLabel(session: ChatSession?) -> String {
        let answers = officeHoursAnswerCount(session: session)
        return "\(answers) 답변"
    }

    private func officeHoursRunStateText(session: ChatSession?, activeDay: Int? = nil) -> String {
        if officeHoursHasPendingStart(activeDay: activeDay) {
            return "첫 질문 생성 중"
        }
        if viewModel.day1GoalSelection == nil {
            return "목표 확정 대기"
        }
        guard let session else {
            return viewModel.isConnected ? "/office-hours 준비됨" : "실행 보조 앱 연결 대기"
        }
        if officeHoursActiveQuestionLoader(for: session) != nil {
            let completed = officeHoursCompletedQuestionCount(session: session)
            if completed == 0 {
                return "첫 질문 생성 중"
            }
            if officeHoursInterviewComplete(session: session) {
                return "약속 준비 중"
            }
            return "다음 질문 생성 중"
        }
        if let prompt = session.pendingUserInput,
           officeHoursQuestionLoadingStartedAtBySession[session.id] != nil,
           officeHoursRemainingQuestionLoadingNanoseconds(for: session.id) > 0,
           !officeHoursPromptRevealIsReady(sessionID: session.id, requestID: prompt.requestId) {
            let completed = officeHoursCompletedQuestionCount(session: session)
            return completed == 0 ? "첫 질문 생성 중" : "다음 질문 생성 중"
        }
        switch session.status {
        case .running:
            return "/office-hours 실행 중"
        case .awaitingInput:
            return "/office-hours 실행 중"
        case .error:
            return "blocked"
        case .idle:
            if session.pendingUserInput != nil {
                return "/office-hours 실행 중"
            }
            if OfficeHoursTranscriptRow.rows(from: session.messages).isEmpty {
                return "/office-hours 준비됨"
            }
            return "인터뷰 답변 준비됨"
        }
    }

    private func officeHoursRunButtonTitle(session: ChatSession?, activeDay: Int? = nil) -> String {
        if viewModel.day1GoalSelection == nil { return "목표 확정 필요" }
        if officeHoursHasPendingStart(activeDay: activeDay) { return "준비 중" }
        guard let session else { return "\(selectedOfficeHoursMode.label) 시작" }
        if session.status == .running { return "진행 중" }
        if session.pendingUserInput != nil { return "답변 대기" }
        if !OfficeHoursTranscriptRow.rows(from: session.messages).isEmpty { return "새 세션 필요" }
        return "\(selectedOfficeHoursMode.label) 시작"
    }

    private func officeHoursDocPreviewRows(session: ChatSession?, activeDay: Int? = nil) -> [(label: String, value: String)] {
        let answers = officeHoursCompletedAnswerSummaries(session: session)
        let firstAnswer = answers.first
        let problem = firstAnswer?.nonEmpty.map { text in
            text.count > 34 ? "\(text.prefix(34))..." : text
        } ?? "대기 중"
        let nextAction: String
        if session?.pendingUserInput != nil {
            nextAction = "다음 질문 필요"
        } else if officeHoursInterviewComplete(session: session) {
            nextAction = selectedOfficeHoursMode.assignment
        } else if officeHoursModePicked(session: session, activeDay: activeDay) {
            nextAction = "다음 질문 필요"
        } else {
            nextAction = "첫 질문 필요"
        }
        return [
            ("문제", problem),
            ("모드", selectedOfficeHoursMode.label),
            ("답변", "\(answers.count) / \(officeHoursQuestionTotal(session: session))"),
            ("다음 행동", nextAction),
        ]
    }

    private func startOfficeHours(
        mode: OfficeHoursMode,
        session: ChatSession?,
        day1Content: OpenDesignDayContent,
        day: Int,
        forceRestart: Bool = false,
        trigger: String? = nil
    ) {
        selectedOfficeHoursMode = mode
        guard viewModel.day1GoalSelection != nil else { return }
        guard let session else {
            pendingOfficeHoursStartMode = mode
            pendingOfficeHoursStartDay = day
            pendingOfficeHoursStartTrigger = trigger?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            viewModel.ensureOfficeHoursSession(forDay: day)
            return
        }
        // `forceRestart` lets the retry path restart Office Hours on the SAME
        // (failed) session, which sits in `.error` state and therefore would
        // fail `officeHoursSessionCanReceiveStart`. Reusing the session keeps
        // `selectedSession` stable so the intro typewriter views are not
        // remounted. The sidecar's `office_hours_start` handler restarts it
        // cleanly (clears error, status -> running).
        guard forceRestart || officeHoursSessionCanReceiveStart(session) else { return }
        pendingOfficeHoursStartMode = nil
        pendingOfficeHoursStartTrigger = nil
        officeHoursSubmittedPromptSnapshotsBySession[session.id] = []
        officeHoursActiveQuestionLoadersBySession.removeValue(forKey: session.id)
        officeHoursRevisionInFlightSessionIDs.remove(session.id)
        officeHoursClearSubmittedRevisionDrafts(sessionID: session.id)
        editingOfficeHoursSubmittedFreeTextID = nil
        editingOfficeHoursSubmittedFreeTextValue = ""
        officeHoursReadyPromptRevealIDs = Set(
            officeHoursReadyPromptRevealIDs.filter { !$0.hasPrefix("\(session.id)::") }
        )
        let context = officeHoursContext(day1Content: day1Content, mode: mode, day: day)
        if viewModel.startOfficeHours(
            sessionID: session.id,
            context: context,
            source: officeHoursStartSource(day: day, forceRestart: forceRestart),
            day: day,
            selectedSources: day >= 2 ? officeHoursSelectedSourceIDs() : [],
            trigger: trigger
        ) {
            pendingOfficeHoursStartDay = nil
            officeHoursStartedSessionIDs.insert(session.id)
            startOfficeHoursQuestionLoading(
                sessionID: session.id,
                requestID: officeHoursStartLoaderRequestID(for: session.id)
            )
        }
    }

    private func continuePendingOfficeHoursStart(
        session: ChatSession?,
        day1Content: OpenDesignDayContent,
        day: Int
    ) {
        guard let mode = pendingOfficeHoursStartMode else { return }
        let pendingDay = pendingOfficeHoursStartDay ?? day
        let pendingTrigger = pendingOfficeHoursStartTrigger
        guard pendingDay == day else { return }
        if let session,
           session.pendingUserInput != nil {
            pendingOfficeHoursStartMode = nil
            pendingOfficeHoursStartDay = nil
            pendingOfficeHoursStartTrigger = nil
            officeHoursStartedSessionIDs.insert(session.id)
            return
        }
        guard let session else {
            viewModel.ensureOfficeHoursSession(forDay: pendingDay)
            return
        }
        guard officeHoursSessionCanReceiveStart(session) else { return }
        startOfficeHours(mode: mode, session: session, day1Content: day1Content, day: pendingDay, trigger: pendingTrigger)
    }

    private func resetOfficeHoursSession(day: Int) {
        pendingOfficeHoursStartMode = nil
        pendingOfficeHoursStartDay = nil
        pendingOfficeHoursStartTrigger = nil
        officeHoursStartedSessionIDs.removeAll()
        officeHoursQuestionLoadingStartedAtBySession.removeAll()
        officeHoursSubmittedPromptSnapshotsBySession.removeAll()
        officeHoursActiveQuestionLoadersBySession.removeAll()
        officeHoursRevisionInFlightSessionIDs.removeAll()
        officeHoursSubmittedRevisionDraftsByPrompt.removeAll()
        editingOfficeHoursSubmittedFreeTextID = nil
        editingOfficeHoursSubmittedFreeTextValue = ""
        officeHoursReadyPromptRevealIDs.removeAll()
        _ = viewModel.createSession(
            provider: viewModel.selectedProvider,
            source: "office_hours_screen_day_\(day)_new_session",
            suppressBootstrapIntake: true,
            officeHoursDay: day
        )
    }

    private func retryOfficeHoursAfterFailure(day1Content: OpenDesignDayContent, day: Int) {
        guard viewModel.day1GoalSelection != nil else { return }
        // Reuse the existing (failed) session instead of spawning a new one.
        // Creating a new session swaps `selectedSession`; the fresh session has
        // no active Office Hours runtime / pending input / messages, so
        // `officeHoursModePicked` briefly flips to false. That toggles the
        // `if modePicked` branch in `officeHoursMainScroll`, which unmounts and
        // then remounts `officeHoursQuestionStage` — resetting every intro
        // typewriter's `@State visibleCount` to 0 and replaying the entire
        // animation. The failed session keeps `runtime.officeHours.active ==
        // true`, so reusing it holds the branch (and the intro @State) stable.
        // Prior failure rows are already hidden by `OfficeHoursLiveStatusPolicy
        // .visibleRows`, and the sidecar restarts the run on the same session.
        guard let session = viewModel.selectedSession else {
            // Defensive fallback: if the session vanished, fall back to the old
            // new-session path so retry still does something.
            let mode = selectedOfficeHoursMode
            resetOfficeHoursSession(day: day)
            pendingOfficeHoursStartMode = mode
            pendingOfficeHoursStartDay = day
            pendingOfficeHoursStartTrigger = nil
            return
        }
        startOfficeHours(
            mode: selectedOfficeHoursMode,
            session: session,
            day1Content: day1Content,
            day: day,
            forceRestart: true
        )
    }

    private func startOfficeHoursIfNeeded(
        session: ChatSession,
        day1Content: OpenDesignDayContent,
        day: Int
    ) {
        guard OfficeHoursAutoStartPolicy.canAutoStart(
            in: session,
            startedSessionIDs: officeHoursStartedSessionIDs,
            realProjectTestBusy: officeHoursRealProjectTestState.isBusy,
            realProjectSessionCreateRequested: officeHoursRealProjectSessionCreateRequested
        ) else { return }

        guard viewModel.day1GoalSelection != nil else { return }
        selectedOfficeHoursMode = .startup
        officeHoursReadyPromptRevealIDs = Set(
            officeHoursReadyPromptRevealIDs.filter { !$0.hasPrefix("\(session.id)::") }
        )
        let context = officeHoursContext(day1Content: day1Content, mode: .startup, day: day)
        if viewModel.startOfficeHours(
            sessionID: session.id,
            context: context,
            source: officeHoursStartSource(day: day, forceRestart: false),
            day: day,
            selectedSources: day >= 2 ? officeHoursSelectedSourceIDs() : []
        ) {
            officeHoursStartedSessionIDs.insert(session.id)
            startOfficeHoursQuestionLoading(
                sessionID: session.id,
                requestID: officeHoursStartLoaderRequestID(for: session.id)
            )
        }
    }

    private func officeHoursStartSource(day: Int, forceRestart: Bool) -> String {
        if day == 1 {
            return forceRestart ? "day1_interview_goal_locked_retry" : "day1_interview_goal_locked"
        }
        return forceRestart ? "office_hours_day_\(day)_retry" : "office_hours_day_\(day)"
    }

    private func officeHoursContext(day1Content: OpenDesignDayContent, mode: OfficeHoursMode? = nil, day: Int = 1) -> String {
        let day1State = openDesignDayInteractionStateCache.state(
            for: OpenDesignDayInteractionKey(
                workspaceRoot: openDesignInteractionWorkspaceRoot,
                dayNumber: 1
            ),
            totalInterviewSteps: day1Content.interviewSteps.count
        )
        let answerLines = day1Content.interviewSteps.compactMap { step -> String? in
            guard let selectedID = day1State.submittedChoices[step.id] ?? day1State.selectedChoices[step.id] else {
                return nil
            }
            let answer: String
            if selectedID == OpenDesignDayInteractionState.freeformChoiceID {
                answer = day1State.trimmedFreeformAnswer(stepID: step.id)
            } else {
                answer = step.options.first(where: { $0.id == selectedID })?.title ?? "\(selectedID)번"
            }
            let trimmed = answer.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !trimmed.isEmpty else { return nil }
            return "- \(step.title): \(trimmed)"
        }

        var lines: [String] = [
            "Office Hours screen context",
            "Workspace: \(openDesignInteractionWorkspaceRoot)",
            "Office Hours day: \(day)",
            "Day \(day) goal: \(officeHoursGoalLine(forDay: day))",
            "Day \(day) phase: \(officeHoursPhaseTitle(forDay: day))",
        ]
        if let goal = viewModel.day1GoalSelection {
            if day == 1 {
                lines.append("DAY1_LOCKED_GOAL")
                lines.append("Flow contract: locked Day 1 goal interview.")
            } else {
                lines.append("DAY1_FOUNDATION_GOAL")
                lines.append("DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS")
                lines.append("Flow contract: Day \(day) goal-driven Office Hours scoped to the locked Day 1 30-day goal.")
                lines.append("30-day goal source of truth: Day1GoalSelection.goalType")
            }
            lines.append("Goal lane: \(goal.goalType.rawValue) / \(goal.goalType.title)")
            lines.append("Goal text: \(goal.goalText)")
            if goal.goalType == .getUsers {
                lines.append("Active user contract: 활성 사용자 1명은 선택한 ICP가 제품의 핵심 activation action을 완료한 고유 사람/계정입니다.")
                lines.append("Active user anti-counts: 가입, waitlist, 페이지뷰, 좋아요, 팔로워, 관심 표현만으로는 활성 사용자로 세지 않습니다.")
            }
            lines.append(day == 1 ? "Customer: \(goal.customer)" : "Day 1 customer: \(goal.customer)")
            lines.append(day == 1 ? "Problem: \(goal.problem)" : "Day 1 problem: \(goal.problem)")
            lines.append("Validation action: \(goal.validationAction)")
            if !goal.evidenceRefs.isEmpty {
                lines.append("Evidence refs: \(goal.evidenceRefs.joined(separator: ", "))")
            }
            lines.append("Proof sink: \(goal.proofSink.rawValue)")
            if goal.proofSink == .bipOptional {
                lines.append("Public evidence log status: configured; evidence can be saved after explicit user approval.")
                lines.append("Proof checklist: record the interview answer, mark the validation action, attach evidence refs, and do not post publicly unless approved.")
            } else {
                lines.append("Public evidence log status: not configured; continue with local evidence only.")
            }
            if let onboarding = viewModel.onboardingContext {
                lines.append("Onboarding goal: \(onboarding.goal)")
                lines.append("Onboarding stage: \(onboarding.currentStage)")
                lines.append("Onboarding business: \(onboarding.businessDescription)")
                lines.append("Onboarding project stage: \(onboarding.projectStage.rawValue)")
            }
        }
        if let mode {
            lines.append("Office Hours mode: \(mode.label)")
            lines.append("Mode goal: \(mode.detail)")
            lines.append("Expected question count: \(mode.questionCount)")
            if viewModel.day1GoalSelection == nil {
                lines.append("Design doc assignment: \(mode.assignment)")
            }
        }

        if let scanResult = viewModel.scanResult {
            let artifacts = scanResult.foundArtifactPaths
            if !artifacts.isEmpty {
                lines.append("Scan artifacts: \(artifacts.joined(separator: ", "))")
            }
            if let summary = scanResult.day1SituationSummary {
                lines.append(day == 1 ? "Project: \(summary.project.name) - \(summary.project.oneLine)" : "Project baseline: \(summary.project.name) - \(summary.project.oneLine)")
                lines.append(day == 1 ? "Customer: \(summary.project.customer)" : "Baseline customer: \(summary.project.customer)")
                lines.append(day == 1 ? "Problem: \(summary.project.problem)" : "Baseline problem: \(summary.project.problem)")
                lines.append(day == 1 ? "Diagnosis: \(summary.diagnosis.bottleneck) / missing signal: \(summary.diagnosis.missingSignal)" : "Baseline diagnosis: \(summary.diagnosis.bottleneck) / missing signal: \(summary.diagnosis.missingSignal)")
            }
            if let plan = scanResult.day1AlignmentPlan {
                lines.append("Project goal: \(plan.projectGoal)")
                lines.append("Alignment statement: \(plan.alignmentStatement.statement)")
                lines.append("Customer candidate: \(plan.alignmentStatement.icp)")
                lines.append(day == 1 ? "Pain: \(plan.alignmentStatement.painPoint)" : "Baseline pain: \(plan.alignmentStatement.painPoint)")
                lines.append("Outcome: \(plan.alignmentStatement.outcome)")
                let gateScore = String(format: "%.1f/%.1f", plan.qualityGate.score, plan.qualityGate.threshold)
                lines.append("Quality gate: \(gateScore) \(plan.qualityGate.passed ? "passed" : "failed")")
                if let digest = plan.signalDigest?.summary.trimmingCharacters(in: .whitespacesAndNewlines), !digest.isEmpty {
                    lines.append("Signal digest: \(digest)")
                }
            } else if let plan = scanResult.day1IcpPlan {
                lines.append("Product: \(plan.signals.productName ?? "unknown")")
                lines.append("Customer candidate guess: \(plan.signals.currentIcpGuess ?? "unknown")")
                lines.append(day == 1 ? "Problem: \(plan.signals.problem ?? "unknown")" : "Baseline problem: \(plan.signals.problem ?? "unknown")")
                lines.append("Mission: \(plan.mission)")
            }
        }

        if !answerLines.isEmpty {
            lines.append("Day 1 Q&A:")
            lines.append(contentsOf: answerLines)
        }

        if viewModel.day1GoalSelection != nil, day == 1 {
            lines.append("Instruction: Run the Day 1 interview only against DAY1_LOCKED_GOAL. The first response must be exactly one structured input card. Ask one question at a time. Do not write files, create docs, publish posts, or edit project files unless the user explicitly approves later.")
        } else if viewModel.day1GoalSelection != nil {
            lines.append("Instruction: Run the Day \(day) office-hours interview only against the Day \(day) goal/carry-forward action above. Do not restart the Day 1 locked-goal interview, and do not reuse the Day 1 first question unless Day \(day) explicitly asks to revisit it. The first response must be exactly one structured input card. Ask one question at a time. Do not write files, create docs, publish posts, or edit project files unless the user explicitly approves later.")
        } else if let mode {
            lines.append("Command: start startup --write-design-doc")
            lines.append("Instruction: Based on the project, scan, workspace evidence, Day 1 Q&A, and selected \(mode.label) mode above, run the office-hours specialist in chat. Start by summarizing the strongest current hypothesis in 3-4 lines, then ask exactly one \(mode.label) office-hours forcing question with structured choices.")
            lines.append("Flow contract: fixed startup design document flow. Do not ask a mode gate, product-stage gate, privacy gate, or smart-skip gate on this screen. Ask the six startup questions in order when missing: real demand evidence, current alternative, reachable person, smallest paid entry point, observed behavior, future importance. After the sixth answer, stop asking structured input and return generated design document markdown for the local document-save payload.")
        } else {
            lines.append("Instruction: Based on the project, scan, workspace evidence, and Day 1 Q&A above, run the office-hours specialist in chat. Start by summarizing the strongest current hypothesis in 3-4 lines, then ask exactly one YC office-hours forcing question.")
        }

        return lines.joined(separator: "\n")
    }

    private func startOfficeHoursRealProjectTest(day1Content: OpenDesignDayContent) {
        didCopyOfficeHoursRealProjectTestReport = false
        officeHoursRealProjectTestSessionID = nil
        officeHoursRealProjectTestContext = ""
        officeHoursRealProjectSessionCreateRequested = false
        PostHogTelemetry.capture(
            "mac_office_hours_real_project_test_requested",
            properties: officeHoursRealProjectTelemetryProperties(day1Content: day1Content)
        )

        guard viewModel.isConnected else {
            officeHoursRealProjectTestState = .failed("실행 보조 앱 연결 후 실제 프로젝트 오피스 아워를 테스트할 수 있습니다.")
            captureOfficeHoursRealProjectTestFailed(
                reason: "sidecar_disconnected",
                day1Content: day1Content
            )
            return
        }

        guard WorkspaceSettings.hasExplicitWorkspace else {
            officeHoursRealProjectTestState = .failed("Settings에서 실제 프로젝트 workspace를 먼저 선택하세요.")
            captureOfficeHoursRealProjectTestFailed(
                reason: "missing_workspace",
                day1Content: day1Content
            )
            return
        }

        let root = openDesignInteractionWorkspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else {
            officeHoursRealProjectTestState = .failed("Workspace 경로가 비어 있습니다.")
            captureOfficeHoursRealProjectTestFailed(
                reason: "empty_workspace_root",
                day1Content: day1Content
            )
            return
        }

        if let providerStatus = officeHoursProviderEnvironment(for: viewModel.selectedProvider),
           providerStatus.source != "unknown",
           !providerStatus.available {
            officeHoursRealProjectTestState = .failed("\(viewModel.selectedProvider.title) AI 연결 인증이 준비되지 않았습니다: \(providerStatus.message)")
            captureOfficeHoursRealProjectTestFailed(
                reason: "provider_auth_unavailable",
                day1Content: day1Content
            )
            return
        }

        if viewModel.isScanning {
            officeHoursRealProjectTestState = .scanning
            PostHogTelemetry.capture(
                "mac_office_hours_real_project_test_waiting_for_scan",
                properties: officeHoursRealProjectTelemetryProperties(day1Content: day1Content)
            )
            return
        }

        let currentScanRoot = viewModel.workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        guard let scanResult = viewModel.scanResult,
              currentScanRoot == root,
              scanResult.error?.nonEmpty == nil else {
            officeHoursRealProjectTestState = .scanning
            PostHogTelemetry.capture(
                "mac_office_hours_real_project_test_scan_requested",
                properties: officeHoursRealProjectTelemetryProperties(day1Content: day1Content)
            )
            viewModel.scanWorkspace(root: root)
            return
        }

        officeHoursRealProjectTestState = .starting
        continueOfficeHoursRealProjectTestIfReady(day1Content: day1Content)
    }

    private func continueOfficeHoursRealProjectTestIfReady(day1Content: OpenDesignDayContent) {
        switch officeHoursRealProjectTestState {
        case .scanning:
            guard !viewModel.isScanning else { return }
            guard let scanResult = viewModel.scanResult else { return }
            if let error = scanResult.error?.nonEmpty {
                officeHoursRealProjectTestState = .failed(error)
                captureOfficeHoursRealProjectTestFailed(
                    reason: "scan_error",
                    day1Content: day1Content
                )
                return
            }
            officeHoursRealProjectTestState = .starting
            continueOfficeHoursRealProjectTestIfReady(day1Content: day1Content)
        case .starting:
            guard viewModel.day1GoalSelection != nil else {
                officeHoursRealProjectTestState = .failed("Day 1 목표를 먼저 확정해야 실제 프로젝트 오피스 아워를 실행할 수 있습니다.")
                captureOfficeHoursRealProjectTestFailed(
                    reason: "missing_day1_goal",
                    day1Content: day1Content
                )
                return
            }
            guard viewModel.isConnected else {
                officeHoursRealProjectTestState = .failed("실행 보조 앱 연결이 끊겼습니다.")
                captureOfficeHoursRealProjectTestFailed(
                    reason: "sidecar_disconnected_after_scan",
                    day1Content: day1Content
                )
                return
            }
            guard let session = viewModel.selectedSession,
                  OfficeHoursRealProjectTestSessionPolicy.canStartTest(
                    in: session,
                    provider: viewModel.selectedProvider
                  ) else {
                requestOfficeHoursRealProjectTestSession()
                return
            }

            officeHoursRealProjectSessionCreateRequested = false
            let context = officeHoursContext(day1Content: day1Content, day: 1)
            officeHoursRealProjectTestContext = context
            officeHoursRealProjectTestSessionID = session.id
            if viewModel.startOfficeHours(
                sessionID: session.id,
                context: context,
                source: "day1_interview_goal_locked",
                day: 1,
                selectedSources: []
            ) {
                officeHoursStartedSessionIDs.insert(session.id)
                officeHoursRealProjectTestState = .waitingForFirstQuestion
                PostHogTelemetry.capture(
                    "mac_office_hours_real_project_test_started",
                    properties: officeHoursRealProjectTelemetryProperties(
                        day1Content: day1Content,
                        session: session
                    )
                )
            } else {
                officeHoursRealProjectTestState = .failed(viewModel.lastError ?? "오피스 아워 시작 요청을 실행 보조 앱으로 보내지 못했습니다.")
                captureOfficeHoursRealProjectTestFailed(
                    reason: "start_send_failed",
                    day1Content: day1Content
                )
            }
        case .waitingForFirstQuestion:
            refreshOfficeHoursRealProjectReviewState(session: viewModel.selectedSession)
        case .idle, .readyForReview, .failed:
            return
        }
    }

    private func requestOfficeHoursRealProjectTestSession() {
        guard !officeHoursRealProjectSessionCreateRequested else { return }
        officeHoursRealProjectSessionCreateRequested = true
        PostHogTelemetry.capture("mac_office_hours_real_project_test_session_requested", properties: [
            "provider": viewModel.selectedProvider.rawValue,
            "workspace_root": openDesignInteractionWorkspaceRoot,
        ])
        let sent = viewModel.createSession(
            provider: viewModel.selectedProvider,
            source: "office_hours_screen_real_project_test",
            suppressBootstrapIntake: true,
            officeHoursDay: 1
        )
        if !sent {
            officeHoursRealProjectSessionCreateRequested = false
            officeHoursRealProjectTestState = .failed(viewModel.lastError ?? "오피스 아워 테스트 세션을 만들지 못했습니다.")
            captureOfficeHoursRealProjectTestFailed(
                reason: "session_create_failed",
                day1Content: OpenDesignDayContent.day1
            )
        }
    }

    private func refreshOfficeHoursRealProjectReviewState(session: ChatSession?) {
        guard case .waitingForFirstQuestion = officeHoursRealProjectTestState else { return }
        guard let session,
              session.id == officeHoursRealProjectTestSessionID else { return }
        if session.status == .error {
            officeHoursRealProjectTestState = .failed(session.error ?? "오피스 아워 실행이 실패했습니다.")
            return
        }
        if session.pendingUserInput != nil || officeHoursRealProjectFirstAssistantMessage(session: session) != nil {
            officeHoursRealProjectTestState = .readyForReview
            let checks = officeHoursRealProjectQualityChecks(
                session: session,
                day1Content: OpenDesignDayContent.day1
            )
            PostHogTelemetry.capture(
                "mac_office_hours_real_project_test_ready_for_review",
                properties: officeHoursRealProjectQualityTelemetryProperties(checks: checks, session: session)
            )
        }
    }

    private func officeHoursProviderEnvironment(for provider: AgentProvider) -> SidecarProviderEnvironment? {
        switch provider {
        case .claude:
            return viewModel.environment.claude
        case .codex:
            return viewModel.environment.codex
        case .gemini:
            return viewModel.environment.gemini
        case .cursor:
            return viewModel.environment.cursor
        }
    }

    private func officeHoursRealProjectPreviewRows(
        day1Content: OpenDesignDayContent,
        session: ChatSession?
    ) -> [(label: String, value: String)] {
        let provider = session?.provider ?? viewModel.selectedProvider
        let model = session?.model.nonEmpty ?? AgentModelCatalog.defaultModelID(for: provider)
        let contextLength = officeHoursRealProjectTestContext.isEmpty
            ? officeHoursContext(day1Content: day1Content).count
            : officeHoursRealProjectTestContext.count
        return [
            ("워크스페이스", openDesignInteractionWorkspaceRoot),
            ("결과물", officeHoursRealProjectArtifactSummary()),
            ("확인 결과", officeHoursRealProjectScanSummary()),
            ("Day 1 답변", officeHoursRealProjectAnswerSummary(day1Content: day1Content)),
            ("AI 연결", "\(provider.title) · \(model)"),
            ("맥락", "\(contextLength) chars · 민감 정보 제거 요약만"),
        ]
    }

    private func officeHoursRealProjectArtifactSummary() -> String {
        guard let scanResult = viewModel.scanResult else { return "scan pending" }
        let artifacts = scanResult.foundArtifactPaths
        guard !artifacts.isEmpty else { return "no canonical docs found" }
        let visible = artifacts.prefix(4).joined(separator: ", ")
        let suffix = artifacts.count > 4 ? " +\(artifacts.count - 4)" : ""
        return visible + suffix
    }

    private func officeHoursRealProjectScanSummary() -> String {
        guard let scanResult = viewModel.scanResult else { return "scan pending" }
        if let error = scanResult.error?.nonEmpty { return "error: \(error)" }
        if let summary = scanResult.day1SituationSummary {
            return "\(summary.project.name) · \(summary.project.customer) · \(summary.project.problem)"
        }
        if let plan = scanResult.day1AlignmentPlan {
            return "\(plan.alignmentStatement.icp) · \(plan.alignmentStatement.painPoint)"
        }
        if let plan = scanResult.day1IcpPlan {
            return "\(plan.signals.productName ?? "unknown") · \(plan.signals.currentIcpGuess ?? "고객 후보 unknown")"
        }
        return "scan complete · Day 1 plan pending"
    }

    private func officeHoursRealProjectAnswerSummary(day1Content: OpenDesignDayContent) -> String {
        let day1State = openDesignDayInteractionStateCache.state(
            for: OpenDesignDayInteractionKey(
                workspaceRoot: openDesignInteractionWorkspaceRoot,
                dayNumber: 1
            ),
            totalInterviewSteps: day1Content.interviewSteps.count
        )
        let selected = day1Content.interviewSteps.compactMap { step -> String? in
            guard let selectedID = day1State.submittedChoices[step.id] ?? day1State.selectedChoices[step.id] else {
                return nil
            }
            if selectedID == OpenDesignDayInteractionState.freeformChoiceID {
                return day1State.trimmedFreeformAnswer(stepID: step.id).nonEmpty
            }
            return step.options.first(where: { $0.id == selectedID })?.title
        }
        guard !selected.isEmpty else {
            return "0/\(day1Content.interviewSteps.count) selected"
        }
        let visible = selected.prefix(2).joined(separator: " · ")
        let suffix = selected.count > 2 ? " +\(selected.count - 2)" : ""
        return "\(selected.count)/\(day1Content.interviewSteps.count) · \(visible)\(suffix)"
    }

    private func officeHoursRealProjectQualityChecks(
        session: ChatSession?,
        day1Content: OpenDesignDayContent
    ) -> [OfficeHoursRealProjectQualityCheck] {
        guard let session,
              session.id == officeHoursRealProjectTestSessionID else {
            return [
                OfficeHoursRealProjectQualityCheck(id: "project", title: "프로젝트 맥락", detail: "오피스 아워 실행 전입니다.", state: .pending),
                OfficeHoursRealProjectQualityCheck(id: "single", title: "질문 1개", detail: "첫 structured question card를 기다립니다.", state: .pending),
                OfficeHoursRealProjectQualityCheck(id: "structured", title: "선택지 카드", detail: "2-4개 선택지와 free text가 필요합니다.", state: .pending),
                OfficeHoursRealProjectQualityCheck(id: "specific", title: "두루뭉술한 답변 방지", detail: "응답이 실제 스캔 근거를 언급해야 합니다.", state: .pending),
                OfficeHoursRealProjectQualityCheck(id: "routing", title: "stage routing", detail: "Startup stage에 맞는 질문 순서를 기다립니다.", state: .pending),
                OfficeHoursRealProjectQualityCheck(id: "intent", title: "forcing intent", detail: "원본 6문항 intent 중 하나여야 합니다.", state: .pending),
                OfficeHoursRealProjectQualityCheck(id: "metadata", title: "선택지 근거/리스크", detail: "추천, 리스크, 근거 대상 중 하나가 필요합니다.", state: .pending),
                OfficeHoursRealProjectQualityCheck(id: "pushback", title: "칭찬 대신 반문", detail: "두루뭉술한 칭찬 없이 증거 기준으로 물어야 합니다.", state: .pending),
            ]
        }

        let prompt = session.pendingUserInput
        let assistant = officeHoursRealProjectFirstAssistantMessage(session: session)
        let assistantText = assistant?.content.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let questionText = prompt?.questions.map(\.question).joined(separator: "\n") ?? ""
        let combinedText = [assistantText, questionText].joined(separator: "\n")
        let projectTerms = officeHoursRealProjectSpecificTerms(day1Content: day1Content)
        let referencesProject = projectTerms.contains { term in
            combinedText.localizedCaseInsensitiveContains(term)
        }
        let hasAnyResponse = prompt != nil || !assistantText.isEmpty
        let questionCount = prompt?.questions.count
        let firstQuestion = prompt?.questions.first
        let optionCount = firstQuestion?.options?.count ?? 0
        let structuredOK = questionCount == 1
            && (2...4).contains(optionCount)
            && firstQuestion?.allowFreeText == true
            && firstQuestion?.requiresFreeText != true
        let forcingIntent = officeHoursForcingIntent(in: combinedText)
        let evidenceVocabulary = officeHoursEvidenceVocabularyMatches(in: combinedText)
        let hasRecommendedOption = firstQuestion?.options?.contains(where: { option in
            option.recommended == true
                || option.label.localizedCaseInsensitiveContains("추천")
                || option.description.localizedCaseInsensitiveContains("추천")
        }) == true
        let hasOptionEvidenceOrRisk = firstQuestion?.options?.contains(where: { option in
            option.risk?.nonEmpty != nil
                || option.evidenceTarget?.nonEmpty != nil
                || option.failureMode?.nonEmpty != nil
                || option.description.localizedCaseInsensitiveContains("리스크")
                || option.description.localizedCaseInsensitiveContains("근거")
                || option.description.localizedCaseInsensitiveContains("증거")
                || option.description.localizedCaseInsensitiveContains("실패")
        }) == true
        let stageRoutingText = [
            prompt?.generation?.signalId,
            prompt?.generation?.signalLabel,
            firstQuestion?.questionId,
            firstQuestion?.header,
            questionText,
        ].compactMap { $0 }.joined(separator: "\n")
        let hasStageRouting = officeHoursHasStageRoutingCue(in: stageRoutingText)
        let hasGenericPraise = officeHoursContainsGenericPraise(assistantText)
        let continuityOK = officeHoursSubmittedPromptSnapshotsBySession[session.id]?.isEmpty != false
            || evidenceVocabulary.count >= 1
            || hasOptionEvidenceOrRisk

        return [
            OfficeHoursRealProjectQualityCheck(
                id: "project",
                title: "프로젝트 맥락 반영",
                detail: referencesProject ? "응답/질문이 scan-derived project term을 포함합니다." : "프로젝트명, 고객, 문제 중 하나가 첫 응답에 보이는지 확인하세요.",
                state: hasAnyResponse ? (referencesProject ? .pass : .fail) : .pending
            ),
            OfficeHoursRealProjectQualityCheck(
                id: "single",
                title: "정확히 한 개의 forcing question",
                detail: questionCount.map { "\($0)개 question이 structured card에 있습니다." } ?? "structured card를 기다립니다.",
                state: questionCount == nil ? .pending : (questionCount == 1 ? .pass : .fail)
            ),
            OfficeHoursRealProjectQualityCheck(
                id: "structured",
                title: "2-4개 선택지 + free text",
                detail: "options \(optionCount)개 · allowFreeText \(firstQuestion?.allowFreeText == true ? "true" : "false")",
                state: prompt == nil ? .pending : (structuredOK ? .pass : .fail)
            ),
            OfficeHoursRealProjectQualityCheck(
                id: "specific",
                title: "두루뭉술한 질문 방지",
                detail: referencesProject && !evidenceVocabulary.isEmpty ? "프로젝트 term과 evidence vocabulary가 함께 보입니다: \(evidenceVocabulary.joined(separator: ", "))" : "프로젝트명만이 아니라 돈/시간/우회/관찰/실제 사람/이번 주 같은 증거 단어가 필요합니다.",
                state: hasAnyResponse ? (referencesProject && !evidenceVocabulary.isEmpty ? .pass : .fail) : .pending
            ),
            OfficeHoursRealProjectQualityCheck(
                id: "routing",
                title: "단계별 질문 반영",
                detail: hasStageRouting ? "모드/단계 또는 Q2/Q4/Q5 질문 흐름 신호가 보입니다." : "Startup 모드를 반복하지 않고 단계에 맞는 질문 의도가 보여야 합니다.",
                state: hasAnyResponse ? (hasStageRouting ? .pass : .fail) : .pending
            ),
            OfficeHoursRealProjectQualityCheck(
                id: "intent",
                title: "핵심 질문 의도",
                detail: forcingIntent ?? "수요 증거, 현재 대안, 절실한 사람, 첫 진입점, 직접 관찰, 앞으로 더 중요해질 이유 중 하나가 보여야 합니다.",
                state: hasAnyResponse ? (forcingIntent == nil ? .fail : .pass) : .pending
            ),
            OfficeHoursRealProjectQualityCheck(
                id: "continuity",
                title: "답변 기반 후속 질문",
                detail: continuityOK ? "직전 답변/증거 기준으로 다음 질문을 좁힐 수 있는 형태입니다." : "후속 질문이 직전 선택의 증거/리스크와 연결되어야 합니다.",
                state: hasAnyResponse ? (continuityOK ? .pass : .fail) : .pending
            ),
            OfficeHoursRealProjectQualityCheck(
                id: "metadata",
                title: "선택지 근거/리스크 + 추천",
                detail: "recommended \(hasRecommendedOption ? "true" : "false") · evidence/risk \(hasOptionEvidenceOrRisk ? "true" : "false")",
                state: prompt == nil ? .pending : (hasOptionEvidenceOrRisk && hasRecommendedOption ? .pass : .fail)
            ),
            OfficeHoursRealProjectQualityCheck(
                id: "pushback",
                title: "두루뭉술한 칭찬 금지",
                detail: hasGenericPraise ? "칭찬/완곡 표현이 보여 pushback 품질이 약합니다." : "칭찬보다 증거 기준의 질문으로 시작합니다.",
                state: hasAnyResponse ? (hasGenericPraise ? .fail : .pass) : .pending
            ),
        ]
    }

    private func officeHoursForcingIntent(in text: String) -> String? {
        let checks: [(String, [String])] = [
            ("Q1 실제 수요 증거", ["demand", "수요", "돈", "결제", "관심 말고", "대기 신청자"]),
            ("Q2 현재 대안", ["status quo", "현재 대안", "우회", "수작업", "무엇으로 버티"]),
            ("Q3 절실한 사람", ["desperate", "절박", "실제 사람", "이름", "역할"]),
            ("Q4 가장 작은 유료 진입점", ["wedge", "가장 작은", "이번 주", "유료", "돈을 낼"]),
            ("Q5 직접 관찰", ["observation", "관찰", "도움 없이", "막히", "놀라"]),
            ("Q6 앞으로 더 중요해질 이유", ["future", "3년", "미래", "추세", "더 필수"]),
        ]
        for (label, needles) in checks where needles.contains(where: { text.localizedCaseInsensitiveContains($0) }) {
            return label
        }
        return nil
    }

    private func officeHoursEvidenceVocabularyMatches(in text: String) -> [String] {
        ["돈", "시간", "우회", "관찰", "실제 사람", "이번 주", "가장 작은 버전", "결제", "수작업", "증거"].filter {
            text.localizedCaseInsensitiveContains($0)
        }
    }

    private func officeHoursHasStageRoutingCue(in text: String) -> Bool {
        [
            "startup",
            "stage",
            "has_users",
            "has users",
            "pre_product",
            "paying",
            "Q2",
            "Q4",
            "Q5",
            "Status Quo",
            "Narrowest Wedge",
            "Observation",
            "제품 단계",
            "현재 대안",
            "가장 좁은",
            "직접 관찰",
        ].contains { text.localizedCaseInsensitiveContains($0) }
    }

    private func officeHoursContainsGenericPraise(_ text: String) -> Bool {
        [
            "흥미로운 접근",
            "좋은 아이디어",
            "괜찮을 수",
            "이해돼요",
            "encouraging",
            "interesting approach",
            "could work",
        ].contains { text.localizedCaseInsensitiveContains($0) }
    }

    private func officeHoursRealProjectSpecificTerms(day1Content: OpenDesignDayContent) -> [String] {
        var terms: [String] = []
        if let summary = viewModel.scanResult?.day1SituationSummary {
            terms += [
                summary.project.name,
                summary.project.customer,
                summary.project.problem,
                summary.diagnosis.bottleneck,
                summary.diagnosis.missingSignal,
            ]
        }
        if let plan = viewModel.scanResult?.day1AlignmentPlan {
            terms += [
                plan.alignmentStatement.icp,
                plan.alignmentStatement.painPoint,
                plan.alignmentStatement.outcome,
            ]
        }
        if let plan = viewModel.scanResult?.day1IcpPlan {
            terms += [
                plan.signals.productName,
                plan.signals.currentIcpGuess,
                plan.signals.problem,
            ].compactMap { $0 }
        }
        terms += day1Content.interviewSteps.compactMap { step in
            let selected = openDesignDayInteractionStateCache.state(
                for: OpenDesignDayInteractionKey(workspaceRoot: openDesignInteractionWorkspaceRoot, dayNumber: 1),
                totalInterviewSteps: day1Content.interviewSteps.count
            ).submittedChoices[step.id]
            return selected.flatMap { selectedID in
                step.options.first(where: { $0.id == selectedID })?.title
            }
        }
        return terms
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { $0.count >= 3 }
    }

    private func officeHoursRealProjectFirstAssistantMessage(session: ChatSession) -> ChatMessage? {
        session.messages.first { message in
            message.role == .assistant
                && message.state == .final
                && message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil
        }
    }

    private func officeHoursRealProjectResponseExcerpt(session: ChatSession?) -> String? {
        guard let session,
              session.id == officeHoursRealProjectTestSessionID else { return nil }
        if let prompt = session.pendingUserInput?.questions.first {
            return "Question: \(prompt.question)"
        }
        return officeHoursRealProjectFirstAssistantMessage(session: session)?
            .content
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty
    }

    private func copyOfficeHoursRealProjectTestReport(
        session: ChatSession?,
        day1Content: OpenDesignDayContent
    ) {
        let checks = officeHoursRealProjectQualityChecks(session: session, day1Content: day1Content)
        let rows = officeHoursRealProjectPreviewRows(day1Content: day1Content, session: session)
        let report = """
        # Office Hours Real Project Test

        ## Context Preview
        \(rows.map { "- \($0.label): \($0.value)" }.joined(separator: "\n"))

        ## Checklist
        \(checks.map { "- \($0.title): \($0.state.reportLabel) — \($0.detail)" }.joined(separator: "\n"))

        ## First Response Excerpt
        \(officeHoursRealProjectResponseExcerpt(session: session) ?? "pending")
        """
        NSPasteboard.general.clearContents()
        NSPasteboard.general.setString(report, forType: .string)
        didCopyOfficeHoursRealProjectTestReport = true
        PostHogTelemetry.capture(
            "mac_office_hours_real_project_test_report_copied",
            properties: officeHoursRealProjectQualityTelemetryProperties(checks: checks, session: session)
        )
        DispatchQueue.main.asyncAfter(deadline: .now() + 1.4) {
            didCopyOfficeHoursRealProjectTestReport = false
        }
    }

    private func captureOfficeHoursRealProjectTestFailed(
        reason: String,
        day1Content: OpenDesignDayContent
    ) {
        PostHogTelemetry.capture(
            "mac_office_hours_real_project_test_failed",
            properties: officeHoursRealProjectTelemetryProperties(day1Content: day1Content)
                .merging(["reason": reason]) { _, new in new }
        )
    }

    private func officeHoursRealProjectTelemetryProperties(
        day1Content: OpenDesignDayContent,
        session: ChatSession? = nil
    ) -> [String: Any] {
        let resolvedProvider = session?.provider ?? viewModel.selectedProvider
        return [
            "provider": resolvedProvider.rawValue,
            "model": session?.model ?? AgentModelCatalog.defaultModelID(for: resolvedProvider),
            "workspace_root": openDesignInteractionWorkspaceRoot,
            "has_scan_result": viewModel.scanResult != nil,
            "has_scan_error": viewModel.scanResult?.error?.nonEmpty != nil,
            "artifact_count": viewModel.scanResult?.foundArtifactPaths.count ?? 0,
            "day1_answer_count": officeHoursRealProjectSelectedAnswerCount(day1Content: day1Content),
        ]
    }

    private func officeHoursRealProjectQualityTelemetryProperties(
        checks: [OfficeHoursRealProjectQualityCheck],
        session: ChatSession?
    ) -> [String: Any] {
        var counts = Dictionary(grouping: checks, by: \.state.reportLabel)
            .mapValues(\.count)
        counts["pass"] = counts["pass"] ?? 0
        counts["fail"] = counts["fail"] ?? 0
        counts["pending"] = counts["pending"] ?? 0
        return [
            "session_id": session?.id ?? "",
            "provider": (session?.provider ?? viewModel.selectedProvider).rawValue,
            "workspace_root": openDesignInteractionWorkspaceRoot,
            "pass_count": counts["pass"] ?? 0,
            "fail_count": counts["fail"] ?? 0,
            "pending_count": counts["pending"] ?? 0,
            "has_structured_prompt": session?.pendingUserInput != nil,
        ]
    }

    private func officeHoursRealProjectSelectedAnswerCount(day1Content: OpenDesignDayContent) -> Int {
        let state = openDesignDayInteractionStateCache.state(
            for: OpenDesignDayInteractionKey(
                workspaceRoot: openDesignInteractionWorkspaceRoot,
                dayNumber: 1
            ),
            totalInterviewSteps: day1Content.interviewSteps.count
        )
        return day1Content.interviewSteps.filter { step in
            state.submittedChoices[step.id] != nil || state.selectedChoices[step.id] != nil
        }.count
    }

    private struct OpenDesignDayPlanPreparingView: View {
        let isScanning: Bool
        let progressMessage: String?
        let scanError: String?
        let sidecarFailureMessage: String?

        private var statusText: String? {
            sidecarFailureMessage ?? scanError ?? progressMessage
        }

        var body: some View {
            ZStack {
                OpenDesignDayColor.bg.ignoresSafeArea()

                VStack(alignment: .leading, spacing: 18) {
                    HStack(spacing: 10) {
                        Circle()
                            .fill(isScanning ? OpenDesignDayColor.accent : OpenDesignDayColor.muted.opacity(0.55))
                            .frame(width: 9, height: 9)
                        Text(isScanning ? "workspace scan" : "workspace")
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                    }

                    VStack(alignment: .leading, spacing: 10) {
                        Text("Day 1 계획을 준비 중입니다.")
                            .font(.system(size: 28, weight: .bold))
                            .foregroundStyle(OpenDesignDayColor.fg)

                        Text("워크스페이스 scan 결과가 준비되면 목표, 고객, 문제, 확인할 행동이 담긴 핵심 가설을 보여줍니다.")
                            .font(.system(size: 15, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                    }

                    if let statusText {
                        Text(statusText)
                            .font(.system(size: 12, weight: .semibold, design: .monospaced))
                            .foregroundStyle(sidecarFailureMessage == nil ? OpenDesignDayColor.muted : OpenDesignDayColor.amber)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 8)
                            .background(OpenDesignDayColor.surface.opacity(0.72), in: RoundedRectangle(cornerRadius: 8, style: .continuous))
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(OpenDesignDayColor.borderSoft.opacity(0.8), lineWidth: 1)
                            )
                    }
                }
                .frame(maxWidth: 680, alignment: .leading)
                .padding(28)
                .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .center)
            }
            .accessibilityIdentifier("opendesign.day.planPreparing")
        }
    }

    private func clearOpenDesignReferenceRoute() {
        selectedOpenDesignReferencePage = nil
        isOpenDesignOfficeHoursPresented = false
        isOpenDesignMorningBriefingPresented = false
        isBipMissionRoutePresented = false
    }

    private func routeToBipMissionCompletion() {
        viewModel.selectBipCoachSessionIfAvailable()
        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            selectedOpenDesignReferencePage = nil
            isOpenDesignOfficeHoursPresented = false
            isOpenDesignMorningBriefingPresented = false
            isBipMissionRoutePresented = true
        }
        updateBipCompletionRouteFieldsIfNeeded()
    }

    private func updateBipCompletionRouteFieldsIfNeeded() {
        guard isBipMissionRoutePresented else { return }
        let mission = viewModel.visibleBipCoach?.currentMission
        showsBipCompletionFields = mission != nil && mission?.status != "completed"
    }

    private func openOpenDesignSettingsRoute() {
        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            isOpenDesignOfficeHoursPresented = false
            isOpenDesignMorningBriefingPresented = false
            isBipMissionRoutePresented = false
            selectedOpenDesignReferencePage = .settings
        }
    }

    private func openOpenDesignRoute(from notification: Notification) {
        guard let rawRoute = notification.userInfo?[LongRunningCompletionNotification.routeUserInfoKey] as? String,
              let route = LongRunningCompletionRoute(rawValue: rawRoute) else {
            return
        }
        openOpenDesignRoute(route)
    }

    private func openOpenDesignRoute(_ route: LongRunningCompletionRoute) {
        switch route {
        case .morningBriefing:
            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                selectedOpenDesignReferencePage = nil
                isOpenDesignOfficeHoursPresented = false
                isBipMissionRoutePresented = false
                isOpenDesignMorningBriefingPresented = true
            }
        case .day1:
            let day = 1
            if OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: day),
               viewModel.isFoundationDayUnlocked(day) {
                viewModel.selectFoundationDay(day)
            }
            selectedPastReviewDay = nil
            selectedTimelineDay = day
            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                selectedOpenDesignReferencePage = nil
                isOpenDesignOfficeHoursPresented = false
                isOpenDesignMorningBriefingPresented = false
                isBipMissionRoutePresented = false
            }
        case .history:
            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                selectedOpenDesignReferencePage = .history
                isOpenDesignOfficeHoursPresented = false
                isOpenDesignMorningBriefingPresented = false
                isBipMissionRoutePresented = false
            }
        case .bipResearch:
            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                selectedOpenDesignReferencePage = .bipLog
                isOpenDesignOfficeHoursPresented = false
                isOpenDesignMorningBriefingPresented = false
                isBipMissionRoutePresented = false
            }
        case .newsMarketRadar:
            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                selectedOpenDesignReferencePage = .news
                isOpenDesignOfficeHoursPresented = false
                isOpenDesignMorningBriefingPresented = false
                isBipMissionRoutePresented = false
            }
        case .bipMission:
            routeToBipMissionCompletion()
        case .document:
            withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                selectedOpenDesignReferencePage = nil
                isOpenDesignOfficeHoursPresented = false
                isOpenDesignMorningBriefingPresented = false
                isBipMissionRoutePresented = false
            }
        }
    }

    private func handleWorkspaceScanBlockedAuthAction(_ readiness: WorkspaceScanProviderReadiness) {
        switch readiness.authAction {
        case "claude_login", "codex_login":
            viewModel.startProviderLogin(readiness.provider)
        case "gemini_adc_login":
            Task { @MainActor in
                let opened = await viewModel.attemptOpenGeminiAdcLogin()
                if !opened {
                    selectedSettingsSection = .providers
                    openOpenDesignSettingsRoute()
                }
            }
        case "gemini_api_key", "cursor_api_key":
            selectedSettingsSection = .providers
            openOpenDesignSettingsRoute()
        default:
            selectedSettingsSection = .providers
            openOpenDesignSettingsRoute()
        }
    }

    private func clearOpenDesignReferenceRouteIfUnsupported(dayNumber: Int) {
        if !OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: dayNumber) {
            clearOpenDesignReferenceRoute()
        }
    }

    private func advanceOpenDesignDay(from day: AgenticCurriculumDay) {
        let nextDay = min(day.day + 1, 30)
        guard OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: nextDay),
              viewModel.isFoundationDayUnlocked(nextDay) else { return }
        withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
            clearOpenDesignReferenceRoute()
            viewModel.selectFoundationDay(nextDay)
        }
    }

    private func resetLocalSwiftUIStateAfterLocalDataReset() {
        currentPromptBindingToken = nil
        showsBipMissionEvidence = false
        showsBipCompletionFields = false
        showsBipReadinessPreview = false
        showsBipReadinessAdvanced = false
        showsInlineBipReadinessSetup = false
        selectedOpenDesignReferencePage = nil
        isOpenDesignOfficeHoursPresented = false
        isOpenDesignMorningBriefingPresented = false
        isBipMissionRoutePresented = false
        selectedPastReviewDay = nil
        selectedTimelineDay = nil
        openDesignDayInteractionStateCache.removeAll()
        officeHoursStartedSessionIDs.removeAll()
        officeHoursRealProjectTestState = .idle
        officeHoursRealProjectTestContext = ""
        officeHoursRealProjectTestSessionID = nil
        officeHoursRealProjectSessionCreateRequested = false
        didCopyOfficeHoursRealProjectTestReport = false
        selectedOfficeHoursGoalType = nil
    }

    private var openDesignInteractionWorkspaceRoot: String {
        let root = viewModel.workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        if !root.isEmpty {
            return root
        }
        return WorkspaceSettings.resolvedURL().path
    }

    private func openDesignDayInteractionBinding(
        for day: AgenticCurriculumDay,
        content: OpenDesignDayContent
    ) -> Binding<OpenDesignDayInteractionState> {
        let key = OpenDesignDayInteractionKey(
            workspaceRoot: openDesignInteractionWorkspaceRoot,
            dayNumber: day.day
        )
        let totalInterviewSteps = content.interviewSteps.count
        return Binding(
            get: {
                openDesignDayInteractionStateCache.state(
                    for: key,
                    totalInterviewSteps: totalInterviewSteps
                )
            },
            set: { state in
                openDesignDayInteractionStateCache.update(
                    state,
                    for: key,
                    totalInterviewSteps: totalInterviewSteps
                )
            }
        )
    }

    private func submitOpenDesignDayChoice(
        _ choice: OpenDesignDayAnswerSubmission,
        day: AgenticCurriculumDay,
        session: ChatSession?
    ) {
        viewModel.recordOpenDesignDayAnswer(
            choice,
            day: day.day,
            dayType: day.phase.rawValue
        )
    }

    @ViewBuilder
    private func agenticWorkspace(for session: ChatSession) -> some View {
        openDesignDaySurface(day: workspaceOpenDesignDay, session: session)
    }

    private func bipMissionWorkspaceSurface() -> some View {
        VStack(alignment: .leading, spacing: 16) {
            HStack(alignment: .center, spacing: 12) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("오늘 실행 완료")
                        .font(.system(size: 24, weight: .heavy, design: .rounded))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text("오늘 실행 상태를 확인하고 기록을 닫습니다.")
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                }

                Spacer(minLength: 0)

                Button {
                    withAnimation(.spring(response: 0.24, dampingFraction: 0.88)) {
                        clearOpenDesignReferenceRoute()
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.left")
                            .font(.system(size: 11, weight: .bold))
                        Text("오늘 화면")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .padding(.horizontal, 12)
                    .frame(height: 34)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .fill(OpenDesignDayColor.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                            )
                    )
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("workspace.bipMissionRoute.back")
            }

            if viewModel.visibleBipCoach != nil {
                bipCoachPanel()
                    .frame(maxWidth: 680, alignment: .leading)
            } else {
                Text("오늘 실행 상태를 불러오는 중입니다.")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .frame(maxWidth: 680, alignment: .leading)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 36)
        .padding(.vertical, 32)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(OpenDesignDayColor.bg)
        .accessibilityIdentifier("workspace.bipMissionRoute")
    }

    private func compactPlaceholder(title: String, subtitle: String) -> some View {
        HStack(alignment: .top, spacing: 14) {
            assistantAvatar(size: 42)
                .padding(.top, 8)

            VStack(alignment: .leading, spacing: 4) {
                Text(title)
                    .font(.system(size: 17, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.96))
                Text(subtitle)
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .frame(width: 420, alignment: .leading)
            .background(pillMaterial)
        }
    }

    private func assistantBubbleShell(for session: ChatSession) -> some View {
        let lastAssistant = lastAssistantMessage(in: session)
        let latestPrompt = viewModel.sentPromptPreview(for: session.id) ?? lastUserPrompt(in: session)
        let pendingPrompt = session.pendingUserInput
        let isExpanding = viewModel.presentationPhase == .expanding
        let isAwaitingInlineInput = pendingPrompt != nil
        let showsComposer = pendingPrompt == nil && session.status != .running
        let visibleCoach = viewModel.visibleBipCoach
        let rawLatestAnswerText = lastAssistant?.content.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let latestAnswerText = rawLatestAnswerText.nonEmpty ?? (session.status == .running ? "" : "대기 중")
        let isWaitingForAnswer = latestAnswerText.isEmpty && session.status == .running
        let latestAssistantIsBipMission = lastAssistant?.bipMissionChoices?.isEmpty == false
        let answerMaxHeight: CGFloat = visibleCoach == nil ? (showsComposer ? 324 : 430) : 180
        let width: CGFloat = 620
        let fixedHeight: CGFloat? = isAwaitingInlineInput ? nil : 576

        return VStack(alignment: .leading, spacing: 14) {
            if isAwaitingInlineInput {
                inlineStructuredPromptIntro(for: session)
            } else if let latestPrompt, !latestPrompt.isEmpty {
                Text("Q. \(latestPrompt)")
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
                    .lineLimit(2)
                    .id(latestPrompt)
                    .accessibilityIdentifier("assistant.latestPrompt")
                    .accessibilityLabel("Q. \(latestPrompt)")
                    .transition(.opacity)
            }

            if let pendingPrompt {
                inlineStructuredPrompt(pendingPrompt, submissionState: submissionState(for: pendingPrompt))
                    .transition(.opacity)
            } else if visibleCoach != nil && latestAssistantIsBipMission {
                Text("오늘 실행")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                    .transition(.opacity)

                bipCoachPanel()
                    .transition(.opacity)
            } else {
                Text("Assistant")
                    .font(.system(size: 13, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                    .transition(.opacity)

                ZStack(alignment: .topLeading) {
                    if isExpanding {
                        VStack(alignment: .leading, spacing: 10) {
                            skeletonLine(width: 0.88)
                            skeletonLine(width: 0.94)
                            skeletonLine(width: 0.71)
                        }
                        .transition(.opacity)
                    } else {
                        Group {
                            if isWaitingForAnswer {
                                assistantLiveStatusPanel(session, isLarge: true)
                                    .accessibilityIdentifier("assistant.latestAnswer")
                                    .accessibilityLabel("\(session.provider.title)가 응답을 준비하고 있습니다.")
                            } else if visibleCoach == nil {
                                VStack(alignment: .leading, spacing: 10) {
                                    ScrollView {
                                        Text(latestAnswerText)
                                            .font(.system(size: 18, weight: .semibold, design: .rounded))
                                            .foregroundStyle(.white.opacity(0.97))
                                            .textSelection(.enabled)
                                            .frame(maxWidth: .infinity, alignment: .topLeading)
                                            .fixedSize(horizontal: false, vertical: true)
                                            .padding(.trailing, 4)
                                            .accessibilityIdentifier("assistant.latestAnswer")
                                            .accessibilityLabel(latestAnswerText)
                                    }
                                    .frame(maxHeight: answerMaxHeight)

                                    if lastAssistant?.state == .error {
                                        assistantSecondaryButton(
                                            title: "채팅 다시 시도",
                                            systemImage: "arrow.clockwise",
                                            accessibilityIdentifier: "assistant.retryFailedChat"
                                        ) {
                                            viewModel.retryLastFailedChatTurn()
                                        }
                                    }
                                }
                            } else {
                                Text(latestAnswerText)
                                    .font(.system(size: 18, weight: .semibold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.97))
                                    .textSelection(.enabled)
                                    .frame(maxWidth: .infinity, alignment: .topLeading)
                                    .fixedSize(horizontal: false, vertical: true)
                                    .padding(.trailing, 4)
                                    .lineLimit(3)
                                    .accessibilityIdentifier("assistant.latestAnswer")
                                    .accessibilityLabel(latestAnswerText)
                            }
                        }
                        .transition(.opacity)
                    }
                }
                bipCoachPanel()
                    .transition(.opacity)

                if isExpanding {
                    HStack(spacing: 10) {
                        skeletonChip(width: 168)
                        skeletonChip(width: 112)
                    }
                    .transition(.opacity)
                }
            }

            if showsComposer {
                Spacer(minLength: 0)
                VStack(alignment: .leading, spacing: 10) {
                    promptComposer()
                }
                .transition(.opacity)
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .frame(width: width, height: fixedHeight, alignment: .topLeading)
        .background(bubbleBackground(isCompact: false))
    }

    private func assistantSecondaryButton(
        title: String,
        systemImage: String,
        accessibilityIdentifier: String,
        action: @escaping () -> Void
    ) -> some View {
        Button(action: action) {
            HStack(spacing: 7) {
                Image(systemName: systemImage)
                    .font(.system(size: 12, weight: .bold))
                Text(title)
                    .font(.system(size: 13, weight: .bold, design: .rounded))
            }
            .foregroundStyle(.white.opacity(0.82))
            .padding(.horizontal, 13)
            .frame(height: 36)
            .background(Capsule().fill(Color.white.opacity(0.09)))
            .overlay(Capsule().stroke(Color.white.opacity(0.09), lineWidth: 1))
            .contentShape(Capsule())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier(accessibilityIdentifier)
        .accessibilityLabel(title)
    }

    private func assistantLiveStatusPanel(_ session: ChatSession, isLarge: Bool = false) -> some View {
        assistantLiveStatusPanel(
            provider: session.provider,
            outputLines: viewModel.sidecarOutputPreview(for: session.id),
            isLarge: isLarge
        )
    }

    private func assistantLiveStatusPanel(
        provider: AgentProvider,
        outputLines: [String] = [],
        isLarge: Bool = false,
        tone: AssistantLiveStatusPanelTone = .floating,
        title: String? = nil,
        idleDetail: String = "실행 이벤트를 기다리는 중입니다.",
        streamingDetail: String = "실행 타임라인 스트리밍",
        emptyMessage: String = "첫 응답 이벤트나 토큰이 도착하면 이 영역이 실제 진행상황으로 바뀝니다."
    ) -> some View {
        let visibleOutput = Array(outputLines.suffix(isLarge ? 10 : 6))
        return VStack(alignment: .leading, spacing: isLarge ? 14 : 10) {
            HStack(spacing: 9) {
                ProgressView()
                    .controlSize(isLarge ? .regular : .small)
                    .frame(width: isLarge ? 18 : 14, height: isLarge ? 18 : 14)
                VStack(alignment: .leading, spacing: 3) {
                    Text(title ?? "\(provider.title)가 응답을 준비 중")
                        .font(.system(size: isLarge ? 16 : 13, weight: .bold, design: .rounded))
                        .foregroundStyle(tone.titleColor)
                    Text(visibleOutput.isEmpty ? idleDetail : streamingDetail)
                        .font(.system(size: isLarge ? 12 : 11, weight: .medium, design: .rounded))
                        .foregroundStyle(tone.subtitleColor)
                }
            }

            if visibleOutput.isEmpty {
                Text(emptyMessage)
                    .font(.system(size: isLarge ? 12 : 11, weight: .medium, design: .rounded))
                    .foregroundStyle(tone.bodyColor)
                    .fixedSize(horizontal: false, vertical: true)
            } else {
                VStack(alignment: .leading, spacing: 7) {
                    ForEach(Array(visibleOutput.enumerated()), id: \.offset) { index, line in
                        let isActive = index == visibleOutput.count - 1
                        HStack(alignment: .top, spacing: 8) {
                            Image(systemName: isActive ? "dot.radiowaves.left.and.right" : "terminal")
                                .font(.system(size: 10, weight: .bold))
                                .foregroundStyle(tone.outputIconColor(isActive: isActive))
                                .frame(width: 14, alignment: .center)
                            Text(line)
                                .font(.system(size: isLarge ? 12 : 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(tone.outputTextColor(isActive: isActive))
                                .lineLimit(isLarge ? 4 : 3)
                                .fixedSize(horizontal: false, vertical: true)
                        }
                    }
                }
                .padding(.leading, 1)
            }
        }
        .padding(isLarge ? 16 : 13)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(tone.panelFill)
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(tone.panelStroke, lineWidth: 1)
                )
        )
    }

    private func assistantActivityRow(icon: String, title: String, detail: String, isActive: Bool) -> some View {
        HStack(alignment: .top, spacing: 9) {
            ZStack {
                Circle()
                    .fill(isActive ? Color.white.opacity(0.16) : Color.white.opacity(0.08))
                    .frame(width: 22, height: 22)
                if isActive {
                    ProgressView()
                        .controlSize(.mini)
                        .frame(width: 12, height: 12)
                } else {
                    Image(systemName: icon)
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(Color.white.opacity(0.62))
                }
            }

            VStack(alignment: .leading, spacing: 2) {
                Text(title)
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(isActive ? 0.84 : 0.62))
                Text(detail)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.44))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    @ViewBuilder
    private func bipCoachPanel() -> some View {
        if let coach = viewModel.visibleBipCoach {
            let readiness = viewModel.bipReadiness ?? BipReadinessState.loading
            if viewModel.sidecarFailureMessage != nil {
                bipCoachSidecarFailurePanel()
            } else if viewModel.bipMissionProgress != nil
                        || coach.currentMission != nil
                        || !coach.pendingMissionChoices.isEmpty
                        || fullCoachReady(coach: coach, readiness: readiness) {
                VStack(alignment: .leading, spacing: 10) {
                    if let expiredMsg = viewModel.bipTokenExpired {
                        tokenExpiredBanner(message: expiredMsg)
                    }

                    switch coach.displayState(
                        hasSidecarFailure: viewModel.sidecarFailureMessage != nil,
                        hasMissionProgress: viewModel.bipMissionProgress != nil
                    ) {
                    case .sidecarFailure:
                        bipCoachSidecarFailurePanel()
                    case .generating:
                        if let progress = viewModel.bipMissionProgress {
                            bipMissionProgressPanel(progress, coach: coach)
                        }
                    case .selectedMission:
                        configuredBipCoachPanel(coach)
                    case .choicesReady:
                        bipMissionChoicesPanel(coach.pendingMissionChoices, coach: coach)
                    case .empty:
                        configuredBipCoachPanel(coach)
                    }

                    if let error = coach.lastError?.nonEmpty {
                        bipCoachErrorBanner(error)
                    }
                }
            } else {
                bipReadinessCard(readiness)
            }
        }
    }

    private func fullCoachReady(coach: BipCoachState, readiness: BipReadinessState) -> Bool {
        coach.isConfigured && readiness.bipCoachSetupComplete && !readiness.hasBlockingBipCoachSetupIssue
    }

    private var bipMissionAccent: Color {
        Agentic30BrandColor.greenBright
    }

    private func missionChoiceAccent(_ index: Int) -> Color {
        switch index {
        case 0:
            return Agentic30BrandColor.greenBright
        case 1:
            return Color(red: 0.54, green: 0.70, blue: 1.0)
        default:
            return Color(red: 0.92, green: 0.76, blue: 0.44)
        }
    }

    private func openMacSettingsWindow() {
        openOpenDesignSettingsRoute()
    }

    // MARK: - BIP Readiness Card (T8)

    private var bipReadinessPrimaryRowIds: [BipReadinessRowId] {
        BipReadinessRowId.bipCoachSetupCases
    }

    private func bipReadinessPrimaryStepNumber(for id: BipReadinessRowId) -> Int? {
        bipReadinessPrimaryRowIds.firstIndex(of: id).map { $0 + 1 }
    }

    private func bipReadinessCard(_ state: BipReadinessState) -> some View {
        let visibleIds = bipReadinessPrimaryRowIds
        let completedIds = visibleIds.filter { state.row($0).status == .done }
        let currentId = visibleIds.first { state.row($0).status != .done }
        let readinessGroups = bipReadinessGroups

        return VStack(alignment: .leading, spacing: 10) {
            Text("추천 정확도 높이기")
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.86))

            Text("오늘 미션은 바로 만들 수 있어요. 아래 기준을 저장하면 문서와 기록을 근거로 더 정확한 후보를 만들 수 있습니다.")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.52))
                .fixedSize(horizontal: false, vertical: true)

            Text(bipReadinessProgressCopy(completedCount: completedIds.count, totalCount: visibleIds.count))
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.52))
                .fixedSize(horizontal: false, vertical: true)

            if let currentId {
                bipReadinessCurrentStepView(row: state.row(currentId))
            } else {
                bipReadinessCompleteView()
            }

            bipReadinessResourceReceipts(state)

            if !completedIds.isEmpty {
                bipReadinessCompletedSummary(completedIds)
            }

            bipReadinessGroupSummary(readinessGroups, state: state)

            bipReadinessAdvancedToggle(state)

            Text("전체 준비가 끝나면 Google Doc/Sheet 기록까지 읽는 근거 기반 추천으로 전환됩니다.")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.44))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.11))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
    }

    private func bipReadinessProgressCopy(completedCount: Int, totalCount: Int) -> String {
        if completedCount == totalCount {
            return "\(totalCount)/\(totalCount) 완료 · 근거 기반 추천 준비 완료"
        }
        if completedCount == totalCount - 1 {
            return "\(completedCount)/\(totalCount) 완료 · 마지막 한 가지가 추천 정확도를 높여요"
        }
        return "\(completedCount)/\(totalCount) 완료 · 다음 한 가지를 저장하면 추천이 더 좋아져요"
    }

    private func bipReadinessCompleteView() -> some View {
        HStack(alignment: .top, spacing: 9) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 15, weight: .semibold))
                .foregroundStyle(Agentic30BrandColor.greenBright)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                Text("준비 완료")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.90))
                Text("이제 공개 실행 코치가 문서와 Google Doc/Sheet를 읽고 근거 기반 실행 후보를 만들 수 있어요.")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.54))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(Color.white.opacity(0.055))
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func bipReadinessCurrentStepView(row: BipReadinessRow) -> some View {
        let rowIndex = bipReadinessPrimaryStepNumber(for: row.id)
            ?? ((BipReadinessRowId.allCases.firstIndex(of: row.id) ?? 0) + 1)
        let rowTitle = bipReadinessRowTitle(row.id)
        let isBlocked = row.status == .blocked

        return HStack(alignment: .top, spacing: 9) {
            bipReadinessStatusIcon(for: row.status)
                .padding(.top, 2)

            VStack(alignment: .leading, spacing: 6) {
                Text(isBlocked ? "확인 필요" : "다음 단계")
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle((isBlocked ? Color(red: 1.0, green: 0.67, blue: 0.42) : .white).opacity(0.58))
                    .textCase(.uppercase)

                Text("\(rowIndex). \(rowTitle)")
                    .font(.system(size: 13, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.90))
                    .accessibilityLabel("\(rowIndex)단계, \(rowTitle), \(bipReadinessStatusLabel(row.status))")

                if let detail = row.detail?.nonEmpty {
                    Text(detail)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.56))
                        .fixedSize(horizontal: false, vertical: true)
                } else {
                    Text(bipReadinessDefaultDetail(for: row.id))
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.50))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if let error = row.error, row.status == .blocked {
                    Text(error.userMessage)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.84))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if row.status == .pending || row.status == .blocked {
                    bipReadinessActionButton(row: row)
                }
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(Color.white.opacity(isBlocked ? 0.075 : 0.055))
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke((isBlocked ? Color(red: 1.0, green: 0.67, blue: 0.42) : .white).opacity(isBlocked ? 0.18 : 0.08), lineWidth: 1)
                )
        )
        .accessibilityIdentifier("bip.readiness.current.\(row.id.rawValue)")
    }

    @ViewBuilder
    private func bipReadinessStatusIcon(for status: BipReadinessStatus) -> some View {
        switch status {
        case .done:
            Image(systemName: "checkmark.circle.fill")
                .foregroundStyle(Agentic30BrandColor.greenBright)
        case .inProgress:
            ProgressView().controlSize(.mini).frame(width: 16, height: 16)
        case .blocked:
            Image(systemName: "exclamationmark.triangle.fill")
                .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42))
        case .pending:
            Image(systemName: "circle")
                .foregroundStyle(.white.opacity(0.34))
        }
    }

    private func bipReadinessDefaultDetail(for id: BipReadinessRowId) -> String {
        switch id {
        case .localIcp:
            return "오늘 미션의 Ideal Customer Profile을 더 정확히 고릅니다. 저장 위치: .agentic30/docs/ICP.md"
        case .localSpec:
            return "오늘 산출물이 어떤 문제를 검증하는지 고정합니다. 저장 위치: .agentic30/docs/SPEC.md"
        case .localDesignSystem:
            return "Mac 작업 화면의 신뢰감과 접근성 기준을 남깁니다. 저장 위치: .agentic30/docs/DESIGN_SYSTEM.md"
        case .localAdr:
            return "중요한 보류/선택 이유를 남겨 같은 논쟁을 줄입니다. 저장 위치: .agentic30/docs/ADR.md"
        case .localGoal:
            return "오늘 미션이 어떤 주간 목표에 기여하는지 연결합니다. 저장 위치: .agentic30/docs/GOAL.md"
        case .localDocs:
            return "Agentic30이 어떤 문서를 근거로 읽을지 알려줍니다. 저장 위치: .agentic30/docs/DOCS.md"
        case .localSheet:
            return "Threads 반응과 배운 점을 다음 추천에 재사용할 표 기준입니다. 저장 위치: .agentic30/docs/SHEET.md"
        case .googleSignIn:
            return "앱 계정 상태예요. Google 문서 연결은 별도 인증으로 확인해요."
        case .workspace:
            return "미션과 설정을 저장할 프로젝트 폴더를 정해요."
        case .gwsInstall:
            return "먼저 이 Mac에 gws CLI가 있는지 확인해요. 이미 있으면 바로 넘어가고 없을 때만 npm으로 설치해요."
        case .gwsAuth:
            return "저장된 gws 인증을 먼저 확인해요. 아직 유효하면 바로 넘어가고 필요할 때만 브라우저 로그인을 엽니다."
        case .docUrl:
            return "앱이 업무일지 템플릿을 내 Drive에 복사하고 자동으로 연결해요."
        case .sheetUrl:
            return "앱이 게시글 기록 Sheet를 내 Drive에 복사하고 자동으로 연결해요."
        }
    }

    private func bipReadinessCompletedSummary(_ rowIds: [BipReadinessRowId]) -> some View {
        let titles = rowIds.map(bipReadinessRowTitle).joined(separator: " · ")
        return HStack(spacing: 6) {
            Image(systemName: "checkmark.circle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.78))
            Text("완료된 준비 \(rowIds.count)개 · \(titles)")
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.42))
                .lineLimit(1)
                .truncationMode(.tail)
        }
        .accessibilityLabel("완료된 준비 \(rowIds.count)개")
    }

    @ViewBuilder
    private func bipReadinessResourceReceipts(_ state: BipReadinessState) -> some View {
        let resourceRows = [state.row(.docUrl), state.row(.sheetUrl)].filter {
            $0.status == .done && ($0.resourceName?.nonEmpty != nil || $0.resourceUrl?.nonEmpty != nil)
        }
        if !resourceRows.isEmpty {
            VStack(alignment: .leading, spacing: 6) {
                ForEach(resourceRows, id: \.id) { row in
                    bipReadinessResourceReceipt(row)
                }
            }
            .accessibilityIdentifier("bip.readiness.resourceReceipts")
        }
    }

    private func bipReadinessResourceReceipt(_ row: BipReadinessRow) -> some View {
        let title = row.resourceName?.nonEmpty ?? (row.id == .docUrl ? "Agentic30 업무일지" : "Agentic30 게시글 일지")
        let kind = row.id == .docUrl ? "Doc" : "Sheet"
        return VStack(alignment: .leading, spacing: 6) {
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Image(systemName: "doc.badge.checkmark")
                    .font(.system(size: 12, weight: .semibold))
                    .foregroundStyle(Agentic30BrandColor.greenBright)
                Text("\(title) 복사 완료")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.82))
            }
            Text("내 Google Drive · 공개 실행 코치에 연결됨")
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.48))
            HStack(spacing: 8) {
                if let urlString = row.resourceUrl?.nonEmpty, let url = URL(string: urlString) {
                    Button("\(kind) 열기") {
                        NSWorkspace.shared.open(url)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.72))

                    Button("링크 복사") {
                        NSPasteboard.general.clearContents()
                        NSPasteboard.general.setString(urlString, forType: .string)
                    }
                    .buttonStyle(.plain)
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                }
            }
        }
        .padding(8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(Color.white.opacity(0.045))
                .overlay(RoundedRectangle(cornerRadius: 10, style: .continuous).stroke(Color.white.opacity(0.07), lineWidth: 1))
        )
    }

    private var bipReadinessGroups: [BipReadinessGroup] {
        [
            BipReadinessGroup(
                title: "프로젝트 기준",
                ids: [.localIcp, .localSpec, .localGoal, .localAdr]
            ),
            BipReadinessGroup(
                title: "실행 기록",
                ids: [.localDocs, .localSheet, .docUrl, .sheetUrl]
            ),
            BipReadinessGroup(
                title: "신뢰도 강화",
                ids: [.localDesignSystem, .gwsInstall, .gwsAuth]
            ),
        ]
    }

    private func bipReadinessGroupSummary(_ groups: [BipReadinessGroup], state: BipReadinessState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(groups) { group in
                let done = group.ids.filter { state.row($0).status == .done }.count
                HStack(spacing: 7) {
                    Image(systemName: done == group.ids.count ? "checkmark.circle.fill" : "circle.dotted")
                        .font(.system(size: 10, weight: .semibold))
                        .foregroundStyle(done == group.ids.count ? Agentic30BrandColor.greenBright.opacity(0.80) : .white.opacity(0.34))
                    Text(group.title)
                        .font(.system(size: 10, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.54))
                    Text("\(done)/\(group.ids.count)")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.36))
                }
            }
        }
        .accessibilityIdentifier("bip.readiness.groupSummary")
    }

    private func bipReadinessPreviewToggle(_ rowIds: [BipReadinessRowId], state: BipReadinessState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                    showsBipReadinessPreview.toggle()
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: showsBipReadinessPreview ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                    Text("다음 단계 미리보기")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                    Text("\(rowIds.count)개")
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.34))
                }
                .foregroundStyle(.white.opacity(0.46))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(showsBipReadinessPreview ? "다음 단계 미리보기 접기" : "다음 단계 미리보기 펼치기")

            if showsBipReadinessPreview {
                VStack(alignment: .leading, spacing: 4) {
                    ForEach(rowIds, id: \.self) { rowId in
                        let rowIndex = bipReadinessPrimaryStepNumber(for: rowId)
                            ?? ((BipReadinessRowId.allCases.firstIndex(of: rowId) ?? 0) + 1)
                        HStack(spacing: 6) {
                            bipReadinessStatusIcon(for: state.row(rowId).status)
                                .font(.system(size: 11))
                                .frame(width: 13, height: 13)
                            Text("\(rowIndex). \(bipReadinessRowTitle(rowId))")
                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                .foregroundStyle(.white.opacity(0.38))
                        }
                    }
                }
                .padding(.leading, 2)
            }
        }
    }

    private func bipReadinessAdvancedToggle(_ state: BipReadinessState) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Button {
                withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                    showsBipReadinessAdvanced.toggle()
                }
            } label: {
                HStack(spacing: 5) {
                    Image(systemName: showsBipReadinessAdvanced ? "chevron.down" : "chevron.right")
                        .font(.system(size: 9, weight: .bold))
                    Text("전체 상태 보기")
                        .font(.system(size: 10, weight: .semibold, design: .rounded))
                }
                .foregroundStyle(.white.opacity(0.32))
            }
            .buttonStyle(.plain)
            .accessibilityLabel(showsBipReadinessAdvanced ? "전체 상태 접기" : "전체 상태 보기")

            if showsBipReadinessAdvanced {
                VStack(alignment: .leading, spacing: 6) {
                    ForEach(bipReadinessPrimaryRowIds, id: \.self) { rowId in
                        bipReadinessRowView(row: state.row(rowId))
                    }
                }
                .padding(.top, 2)
            }
        }
    }

    @ViewBuilder
    private func bipReadinessRowView(row: BipReadinessRow) -> some View {
        let rowIndex = bipReadinessPrimaryStepNumber(for: row.id)
            ?? ((BipReadinessRowId.allCases.firstIndex(of: row.id) ?? 0) + 1)
        let rowTitle = bipReadinessRowTitle(row.id)

        HStack(alignment: .top, spacing: 8) {
            // Status icon
            Group {
                switch row.status {
                case .done:
                    Image(systemName: "checkmark.circle.fill")
                        .foregroundStyle(Agentic30BrandColor.greenBright)
                case .inProgress:
                    ProgressView().controlSize(.mini).frame(width: 16, height: 16)
                case .blocked:
                    Image(systemName: "exclamationmark.triangle.fill")
                        .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42))
                case .pending:
                    Image(systemName: "circle")
                        .foregroundStyle(.white.opacity(0.30))
                }
            }
            .font(.system(size: 14))
            .frame(width: 16, height: 16)
            .padding(.top, 1)

            VStack(alignment: .leading, spacing: 4) {
                HStack(spacing: 6) {
                    Text("\(rowIndex). \(rowTitle)")
                        .font(.system(size: 12, weight: row.status == .done ? .medium : .semibold, design: .rounded))
                        .foregroundStyle(row.status == .done ? .white.opacity(0.52) : .white.opacity(0.88))
                        .accessibilityLabel("\(rowIndex)단계, \(rowTitle), \(bipReadinessStatusLabel(row.status))")

                    Spacer(minLength: 0)

                    if row.status == .done {
                        Button("수정") {
                            viewModel.sendBipReadinessAction(rowId: row.id, action: "recheck")
                        }
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.36))
                        .buttonStyle(.plain)
                    }
                }

                if let detail = row.detail?.nonEmpty, row.status != .done {
                    Text(detail)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.52))
                }

                if let logLine = row.log?.nonEmpty, row.status == .inProgress {
                    Text(logLine)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(.white.opacity(0.38))
                        .lineLimit(2)
                        .frame(maxWidth: .infinity, alignment: .leading)
                }

                if let error = row.error, row.status == .blocked {
                    Text(error.userMessage)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.82))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if row.status == .pending || row.status == .blocked {
                    bipReadinessActionButton(row: row)
                }
            }
        }
        .padding(.vertical, 4)
        .accessibilityIdentifier("bip.readiness.row.\(row.id.rawValue)")
    }

    @ViewBuilder
    private func bipReadinessActionButton(row: BipReadinessRow) -> some View {
        switch row.id {
        case .localIcp, .localSpec, .localDesignSystem, .localAdr, .localGoal, .localDocs, .localSheet:
            bipCoachButton("오늘 미션에 필요한 기준 정하기") {
                viewModel.sendBipReadinessAction(
                    rowId: row.id,
                    action: "start_idd",
                    payload: [:]
                )
            }

        case .googleSignIn, .workspace:
            EmptyView()

        case .gwsInstall:
            bipCoachButton("gws CLI 확인") {
                viewModel.sendBipReadinessAction(
                    rowId: .gwsInstall,
                    action: "install",
                    payload: ["method": "npm"]
                )
            }

        case .gwsAuth:
            bipCoachButton(row.status == .blocked ? "Google 연결 다시 확인" : "Google 연결 확인") {
                viewModel.startGwsAuth()
            }

        case .docUrl:
            bipCoachButton("내 Drive에 복사하고 연결") {
                viewModel.sendBipReadinessAction(
                    rowId: .docUrl,
                    action: "copy_template",
                    payload: [:]
                )
            }

        case .sheetUrl:
            bipCoachButton("내 Drive에 복사하고 연결") {
                viewModel.sendBipReadinessAction(
                    rowId: .sheetUrl,
                    action: "copy_template",
                    payload: [:]
                )
            }
        }
    }

    private func bipReadinessRowTitle(_ id: BipReadinessRowId) -> String {
        switch id {
        case .localIcp: return "누구를 위한 제품인지"
        case .localSpec: return "이번 주 무엇을 만들지"
        case .localDesignSystem: return "화면 원칙"
        case .localAdr: return "기술 결정"
        case .localGoal: return "목표와 지표"
        case .localDocs: return "문서 지도"
        case .localSheet: return "공개 기록 표"
        case .googleSignIn: return "앱 로그인"
        case .workspace: return "프로젝트 폴더"
        case .gwsInstall: return "gws CLI 확인"
        case .gwsAuth: return "Google 연결 확인"
        case .docUrl: return "업무일지 Doc 연결"
        case .sheetUrl: return "SNS(Threads) 게시글 Sheet 연결"
        }
    }

    private func bipReadinessStatusLabel(_ status: BipReadinessStatus) -> String {
        switch status {
        case .pending: return "대기 중"
        case .inProgress: return "진행 중"
        case .done: return "완료됨"
        case .blocked: return "확인 필요"
        }
    }

    // MARK: - Token Expiry Banner (T9)

    private func tokenExpiredBanner(message: String) -> some View {
        HStack(spacing: 10) {
            Image(systemName: "lock.fill")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42))

            VStack(alignment: .leading, spacing: 2) {
                Text("gws 인증이 만료됐어요")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.88))
                Text(message)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                    .lineLimit(2)
            }

            Spacer(minLength: 0)

            Button("gws 다시 인증") {
                viewModel.clearBipTokenExpired()
                viewModel.startGwsAuth()
            }
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42))
            .buttonStyle(.plain)
            .accessibilityLabel("Google Workspace 재인증하기")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 8)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.10))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.22), lineWidth: 1)
                )
        )
        .accessibilityIdentifier("bip.tokenExpiredBanner")
    }

    private func bipCoachSidecarFailurePanel() -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top, spacing: 10) {
                Image(systemName: "exclamationmark.triangle.fill")
                    .font(.system(size: 15, weight: .semibold))
                    .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.92))
                    .frame(width: 24, height: 24)
                    .background(Circle().fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.12)))

                VStack(alignment: .leading, spacing: 4) {
                    Text("미션 생성 준비가 멈췄어요")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.92))
                    Text(sidecarFailureDetailText())
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.56))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)
            }

            HStack(spacing: 8) {
                Button {
                    viewModel.reconnectSidecar()
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 11, weight: .bold))
                        Text("다시 연결")
                            .font(.system(size: 12, weight: .bold, design: .rounded))
                    }
                    .foregroundStyle(Color.black.opacity(0.76))
                    .padding(.horizontal, 12)
                    .frame(height: 30)
                    .background(Capsule().fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.92)))
                    .accessibilityIdentifier("workspace.bipCoach.retrySidecar")
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("workspace.bipCoach.retrySidecar")
                .accessibilityLabel("실행 보조 앱 다시 연결")

                bipCoachButton("설정 열기") {
                    openMacSettingsWindow()
                }
            }
        }
        .padding(12)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.18), lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("workspace.bipCoach.sidecarFailure")
        .accessibilityLabel("미션 생성 준비가 멈췄어요")
    }

    private func sidecarFailureDetailText() -> String {
        if let message = viewModel.sidecarFailureMessage?.nonEmpty {
            return message
        }
        return "실행 보조 앱 연결이 끊겨 오늘 미션과 근거를 불러올 수 없습니다."
    }

    private func bipCoachErrorBanner(_ error: String) -> some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 11, weight: .semibold))
                .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.90))
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 2) {
                Text("연결 확인 필요")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.82))
                Text(error)
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.56))
                    .lineLimit(3)
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.08))
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.16), lineWidth: 1)
                )
        )
        .accessibilityIdentifier("bip.coachError")
    }

    private func bipMissionChoicesPanel(_ choices: [BipCoachMission], coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            HStack(alignment: .top, spacing: 10) {
                VStack(alignment: .leading, spacing: 4) {
                    Text("오늘 미션 후보 3개가 준비됐어요")
                        .font(.system(size: 15, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                    Text("하나만 고르면 실행 코치 모드로 이어집니다.")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.58))
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 0)

                Text("\(min(choices.count, 3))개 후보")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.92))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Agentic30BrandColor.greenBright.opacity(0.12)))
            }

            Text("근거: \(bipMissionChoicesEvidenceSummary(coach))")
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.52))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            VStack(alignment: .leading, spacing: 8) {
                ForEach(Array(choices.prefix(3).enumerated()), id: \.element.id) { index, mission in
                    bipCoachMissionChoiceCard(mission, index: index)
                }
            }

            HStack(spacing: 8) {
                bipCoachButton("다시 만들기") {
                    viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                }
                .disabled(viewModel.isBipCoachRefreshing || viewModel.isBipCoachGenerating)

                bipCoachButton("15분 미션으로 줄이기") {
                    viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                }
                .disabled(viewModel.isBipCoachRefreshing || viewModel.isBipCoachGenerating)
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.11))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
        .accessibilityIdentifier("workspace.bipCoach.missionChoices")
    }

    private func bipCoachMissionChoiceCard(_ mission: BipCoachMission, index: Int) -> some View {
        Button {
            viewModel.selectBipMission(mission)
        } label: {
            HStack(alignment: .top, spacing: 10) {
                Text(index == 0 ? "추천" : "\(index + 1)")
                    .font(.system(size: 10, weight: .heavy, design: .rounded))
                    .foregroundStyle(Color.black.opacity(0.70))
                    .padding(.horizontal, index == 0 ? 8 : 0)
                    .frame(minWidth: 24, minHeight: 24)
                    .background(Capsule().fill(missionChoiceAccent(index).opacity(0.92)))

                VStack(alignment: .leading, spacing: 6) {
                    Text(mission.title?.nonEmpty ?? "오늘 미션")
                        .font(.system(size: 13, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                        .lineLimit(2)

                    Text(missionRecommendationReason(mission, index: index))
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.68))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityIdentifier("bip.missionChoice.recommendationReason")

                    if let missionText = mission.mission?.nonEmpty {
                        Text(missionText)
                            .font(.system(size: 11, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.50))
                            .lineLimit(1)
                    }

                    bipMissionChoiceMetaRow(
                        text: missionEvidencePreview(mission),
                        systemImage: "quote.bubble.fill",
                        identifier: "bip.missionChoice.evidence"
                    )

                    bipMissionChoiceMetaRow(
                        text: "결과물: \(missionOutcomePreview(mission))",
                        systemImage: "checkmark.circle.fill",
                        identifier: "bip.missionChoice.outcome"
                    )

                    HStack(spacing: 8) {
                        Label("15분", systemImage: "timer")
                        Label("선택 후 초안 요청 가능", systemImage: "text.bubble")
                    }
                    .font(.system(size: 10, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.46))
                    .lineLimit(1)
                }

                Spacer(minLength: 0)

                HStack(spacing: 5) {
                    Text("이 미션으로 시작")
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10, weight: .heavy))
                }
                .foregroundStyle(.white.opacity(0.86))
                .padding(.horizontal, 10)
                .frame(height: 28)
                .background(Capsule().fill(Color.white.opacity(0.11)))
                .accessibilityIdentifier("bip.missionChoice.primaryAction")
            }
            .padding(12)
            .background(
                RoundedRectangle(cornerRadius: 12, style: .continuous)
                    .fill(Color.white.opacity(index == 0 ? 0.075 : 0.055))
                    .overlay(
                        RoundedRectangle(cornerRadius: 12, style: .continuous)
                            .stroke(index == 0 ? bipMissionAccent.opacity(0.18) : Color.white.opacity(0.09), lineWidth: 1)
                    )
            )
            .contentShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("workspace.bipCoach.missionChoice.\(index + 1)")
        .accessibilityLabel("\(mission.title?.nonEmpty ?? "오늘 실행 \(index + 1)") 이 미션으로 시작")
    }

    private func bipMissionChoiceMetaRow(text: String, systemImage: String, identifier: String) -> some View {
        HStack(alignment: .top, spacing: 6) {
            Image(systemName: systemImage)
                .font(.system(size: 9, weight: .bold))
                .foregroundStyle(bipMissionAccent.opacity(0.72))
                .frame(width: 12)
                .padding(.top, 1)
            Text(text)
                .font(.system(size: 10, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.48))
                .lineLimit(1)
        }
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier(identifier)
    }

    private func missionRecommendationReason(_ mission: BipCoachMission, index: Int) -> String {
        if let angle = mission.angle?.nonEmpty {
            return "추천 이유: \(angle)"
        }
        if index == 0 {
            return "추천 이유: 지금 가장 작게 실행하고 바로 배울 수 있습니다."
        }
        return "추천 이유: 프로젝트와 오늘 커리큘럼에 맞춘 실행입니다."
    }

    private func missionEvidencePreview(_ mission: BipCoachMission) -> String {
        if let firstEvidence = mission.evidenceRefs?.compactMap(\.nonEmpty).first {
            return "근거: \(firstEvidence)"
        }
        if let day = mission.curriculumDay?.day {
            return "근거: 프로젝트 폴더와 Day \(day) 커리큘럼"
        }
        return "근거: 프로젝트 폴더와 오늘 커리큘럼"
    }

    private func missionOutcomePreview(_ mission: BipCoachMission) -> String {
        if let firstChecklist = mission.eveningChecklist?.compactMap(\.nonEmpty).first {
            return firstChecklist
        }
        if mission.drafts?.isEmpty == false {
            return "초안 하나를 만들고 바로 실행"
        }
        return "배움 하나와 다음 액션 하나 기록"
    }

    private func bipMissionChoicesEvidenceSummary(_ coach: BipCoachState) -> String {
        if let evidence = coach.evidence {
            return evidenceReceiptSummary(evidence)
        }
        return "연결된 Sheet와 업무일지 Doc"
    }

    private func configuredBipCoachPanel(_ coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 10) {
            Text(coach.currentMission?.status == "completed" ? "오늘 미션이 완료됐어요." : "오늘은 이 흐름으로 진행하면 됩니다.")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.76))

            if let mission = coach.currentMission {
                missionSuggestionCard(mission, coach: coach)
            } else {
                Text("아직 오늘 미션이 없습니다. Assistant가 Docs와 Sheet 기록을 보고 하나로 정리할 수 있어요.")
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.86))
            }

            if coach.currentMission == nil {
                bipCoachButton(bipMissionButtonTitle()) {
                    viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                }
                .disabled(viewModel.isBipCoachRefreshing || viewModel.isBipCoachGenerating)
            }
        }
    }

    private func bipMissionButtonTitle() -> String {
        guard let progress = viewModel.bipMissionProgress else {
            return "오늘 미션 만들기"
        }
        switch progress.stage {
        case "reading_sheet", "reading_doc":
            return "근거 읽는 중..."
        case "generating":
            return "미션 생성 중..."
        case "finalizing":
            return "근거 정리 중..."
        default:
            return "진행 중..."
        }
    }

    private func bipMissionProgressPanel(_ progress: BipMissionProgress, coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                ProgressView().controlSize(.mini)
                Text("오늘 미션을 만드는 중")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.86))
                Spacer(minLength: 0)
                if let status = bipMissionProgressStatusLabel(progress) {
                    Text(status)
                        .font(.system(size: 10, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.42))
                }
            }

            VStack(alignment: .leading, spacing: 5) {
                progressLine("Google Sheet 전체 확인 중", step: .readingSheet, progress: progress, suffix: progress.sheetRowsRead.map { "완료, 전체 \($0)개 행" })
                progressLine("업무일지 Doc 확인 중", step: .readingDoc, progress: progress, suffix: progress.docCharsRead.map { "완료, \($0)자 사용" })
                progressLine("미션 후보 생성 중", step: .generating, progress: progress, suffix: progress.provider?.nonEmpty)
                progressLine("근거 정리 중", step: .finalizing, progress: progress, suffix: nil)
            }

            if let evidence = coach.evidence {
                Text("읽은 근거: \(evidenceReceiptSummary(evidence))")
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.48))
                    .fixedSize(horizontal: false, vertical: true)
            } else if let detail = progress.detail?.nonEmpty {
                Text(detail)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.48))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.black.opacity(0.12))
                .overlay(RoundedRectangle(cornerRadius: 14, style: .continuous).stroke(Color.white.opacity(0.08), lineWidth: 1))
        )
        .accessibilityIdentifier("bip.missionProgress")
    }

    private func bipMissionProgressStatusLabel(_ progress: BipMissionProgress) -> String? {
        if progress.stage == "generating" {
            let provider = progress.provider.flatMap(AgentProvider.init(rawValue:))?.title
                ?? progress.provider?.nonEmpty
                ?? "Agent"
            return "\(provider) 응답 대기 중"
        }
        guard let elapsed = progress.elapsedMs, elapsed >= 5_000 else {
            return nil
        }
        return "약 \(max(1, elapsed / 1000))초 진행 중"
    }

    private func progressLine(_ title: String, step: BipMissionProgressStep, progress: BipMissionProgress, suffix: String?) -> some View {
        let isActive = progress.isActive(step)
        let isComplete = progress.isComplete(step)

        return HStack(spacing: 7) {
            Image(systemName: isComplete ? "checkmark.circle.fill" : (isActive ? "circle.dotted" : "circle"))
                .font(.system(size: 10, weight: .semibold))
                .foregroundStyle(isComplete ? Agentic30BrandColor.greenBright.opacity(0.82) : .white.opacity(isActive ? 0.64 : 0.28))
            Text(title)
                .font(.system(size: 10, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(isActive ? 0.68 : (isComplete ? 0.58 : 0.42)))
            Spacer(minLength: 0)
            if let suffix {
                Text(suffix)
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(1)
            }
        }
    }

    private func bipCompletionCard(mission: BipCoachMission, isCompact: Bool = false) -> some View {
        VStack(alignment: .leading, spacing: isCompact ? 6 : 9) {
            HStack(alignment: .center, spacing: 8) {
                Image(systemName: "sparkles")
                    .font(.system(size: isCompact ? 12 : 14, weight: .heavy))
                    .foregroundStyle(Color.black.opacity(0.72))
                    .frame(width: isCompact ? 24 : 28, height: isCompact ? 24 : 28)
                    .background(Circle().fill(Agentic30BrandColor.greenBright.opacity(0.94)))

                Text(bipCompletionTitle(for: mission))
                    .font(.system(size: isCompact ? 14 : 17, weight: .heavy, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.96))
                    .accessibilityIdentifier("bip.completionCard.title")
            }

            Text(bipCompletionEncouragement(for: mission))
                .font(.system(size: isCompact ? 12 : 13, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
                .fixedSize(horizontal: false, vertical: true)
                .accessibilityIdentifier("bip.completionCard.encouragement")

            if let questionCountLabel = mission.completionQuestionCountLabel {
                Text(questionCountLabel)
                    .font(.system(size: isCompact ? 12 : 11, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.64))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("bip.completionCard.questionCount")
            }

            if let teaser = mission.curriculumDay?.completionNextDayTeaser,
               OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: mission.curriculumDay?.day ?? 0) {
                Text(teaser)
                    .font(.system(size: isCompact ? 11 : 10, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.46))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("bip.completionCard.nextDayTeaser")
            }

            Text([mission.threadsUrl?.nonEmpty, mission.sheetRowNote?.nonEmpty].compactMap { $0 }.joined(separator: " · ").nonEmpty ?? "기록이 저장됐습니다.")
                .font(.system(size: isCompact ? 12 : 11, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.58))
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(isCompact ? 0 : 12)
        .background {
            if !isCompact {
                RoundedRectangle(cornerRadius: 14, style: .continuous)
                    .fill(Agentic30BrandColor.greenBright.opacity(0.10))
                    .overlay(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .stroke(Agentic30BrandColor.greenBright.opacity(0.16), lineWidth: 1)
                    )
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier(isCompact ? "bip.completionSummary" : "bip.completionCard")
    }

    private func bipCompletionTitle(for mission: BipCoachMission) -> String {
        if let day = mission.curriculumDay?.day {
            return "Day \(day) 완료"
        }
        return "오늘 실행 완료"
    }

    private func bipCompletionEncouragement(for mission: BipCoachMission) -> String {
        if mission.curriculumDay?.day != nil {
            return "이 근거로 다음 실행을 더 정확히 이어갈게요."
        }
        return "오늘 기록이 다음 실행의 근거가 됩니다."
    }

    private func missionSuggestionCard(_ mission: BipCoachMission, coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            if mission.status == "completed" {
                bipCompletionCard(mission: mission)
            }

            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(coach.currentMission?.status == "completed" ? "완료된 미션" : "오늘 미션")
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.94))
                Spacer(minLength: 0)
                Text("연속 \(coach.streak.current)일")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.92))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 4)
                    .background(Capsule().fill(Agentic30BrandColor.greenBright.opacity(0.12)))
            }

            Text(mission.title?.nonEmpty ?? "오늘 실행")
                .font(.system(size: 16, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.96))
                .lineLimit(2)

            if let missionText = mission.mission?.nonEmpty {
                Text(missionText)
                    .font(.system(size: 13, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.78))
                    .lineLimit(2)
            } else if let angle = mission.angle?.nonEmpty {
                Text(angle)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.58))
                    .lineLimit(2)
            }

            Text(evidenceSummaryText(for: mission, coach: coach))
                .font(.system(size: 11, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.54))
                .lineLimit(showsBipMissionEvidence ? nil : 1)
                .fixedSize(horizontal: false, vertical: showsBipMissionEvidence)

            if showsBipMissionEvidence {
                missionEvidenceDetails(mission, coach: coach)
            }

            HStack(spacing: 8) {
                if mission.status == "completed" {
                    bipCoachButton("완료됨") {}
                        .disabled(true)
                } else {
                    bipCoachButton(showsBipCompletionFields ? "입력 닫기" : "Threads 반응 입력") {
                        withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                            showsBipCompletionFields.toggle()
                        }
                    }
                    .disabled(viewModel.isBipCoachCompleting)
                }

                Menu {
                    Button(showsBipMissionEvidence ? "근거 접기" : "근거 보기") {
                        withAnimation(.spring(response: 0.26, dampingFraction: 0.86)) {
                            showsBipMissionEvidence.toggle()
                        }
                    }
                    Button("근거 새로고침") {
                        viewModel.refreshBipCoachEvidence()
                    }
                    Button("다른 미션 만들기") {
                        viewModel.generateBipMission(curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                    }
                    Button("15분 관찰글로 줄이기") {
                        viewModel.generateBipMission(compact: true, curriculumDay: curriculumPayload(for: workspaceOpenDesignDay))
                    }
                    Button("초안 작성하기") {
                        beginBipMission(mission)
                    }
                } label: {
                    Image(systemName: "ellipsis")
                        .font(.system(size: 13, weight: .bold))
                        .foregroundStyle(.white.opacity(0.7))
                        .frame(width: 30, height: 30)
                        .background(
                            Circle()
                                .fill(Color.white.opacity(0.08))
                                .overlay(Circle().stroke(Color.white.opacity(0.08), lineWidth: 1))
                        )
                }
                .menuStyle(.button)
                .buttonStyle(.plain)
                .disabled(viewModel.isBipCoachRefreshing || viewModel.isBipCoachGenerating)
                .accessibilityLabel("Mission options")
            }

            if showsBipCompletionFields && mission.status != "completed" {
                bipCompletionFields()
            }
        }
        .padding(12)
        .background(
            RoundedRectangle(cornerRadius: 16, style: .continuous)
                .fill(Color.black.opacity(0.11))
                .overlay(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .stroke(Color.white.opacity(0.09), lineWidth: 1)
                )
        )
    }

    private func bipCompletionFields() -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("게시 기록 자동 확인")
                .font(.system(size: 12, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))

            HStack(alignment: .center, spacing: 8) {
                Image(systemName: "checkmark.seal.fill")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(Agentic30BrandColor.greenBright.opacity(0.92))
                Text("연결된 Google Sheet 기록을 다시 읽고 확인된 최신 행으로 오늘 미션을 닫습니다.")
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 0)
                bipCompletionSubmitButton()
            }

            if let error = viewModel.visibleBipCoach?.lastError?.nonEmpty {
                Text(error)
                    .font(.system(size: 11, weight: .semibold, design: .rounded))
                    .foregroundStyle(Color(red: 1.0, green: 0.67, blue: 0.42).opacity(0.90))
                    .fixedSize(horizontal: false, vertical: true)
                    .accessibilityIdentifier("assistant.bipCompletionError")
            }
        }
        .padding(10)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(Color.black.opacity(0.12))
        )
        .accessibilityIdentifier("assistant.bipCompletionFields")
    }

    private func bipCompletionSubmitButton() -> some View {
        Button {
            submitBipCompletion()
        } label: {
            HStack(spacing: 6) {
                if viewModel.isBipCoachCompleting {
                    ProgressView()
                        .controlSize(.mini)
                        .frame(width: 12, height: 12)
                }
                Text(viewModel.isBipCoachCompleting ? "저장 중..." : "기록 완료")
                    .font(.system(size: 12, weight: .bold, design: .rounded))
            }
            .foregroundStyle(.white.opacity(bipCompletionSubmitDisabled ? 0.44 : 0.9))
            .padding(.horizontal, 12)
            .frame(height: 36)
            .background(Capsule().fill(Color.white.opacity(bipCompletionSubmitDisabled ? 0.07 : 0.14)))
        }
        .buttonStyle(.plain)
        .disabled(bipCompletionSubmitDisabled)
        .accessibilityIdentifier("assistant.completeBipMission")
        .accessibilityLabel("기록 완료")
    }

    private var bipCompletionSubmitDisabled: Bool {
        viewModel.isBipCoachCompleting
    }

    private func submitBipCompletion() {
        viewModel.completeBipMission()
    }

    private func missionEvidenceDetails(_ mission: BipCoachMission, coach: BipCoachState) -> some View {
        VStack(alignment: .leading, spacing: 5) {
            ForEach(Array(evidenceLines(for: mission, coach: coach).prefix(4).enumerated()), id: \.offset) { _, line in
                Text("- \(line)")
                    .font(.system(size: 11, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.58))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func evidenceSummaryText(for mission: BipCoachMission, coach: BipCoachState) -> String {
        if let evidence = coach.evidence {
            return "읽은 근거: \(evidenceReceiptSummary(evidence))"
        }
        if let refs = mission.evidenceRefs, !refs.isEmpty {
            return "근거: \(refs.prefix(3).joined(separator: " · "))"
        }
        return "근거: Threads 반응 · 팔로워 변화 · 공개 기록"
    }

    private func evidenceReceiptSummary(_ evidence: BipCoachEvidence) -> String {
        var parts: [String] = []
        if evidence.source == "agent_gws" {
            parts.append("Agent가 gws로 전체 확인")
        }
        if let rows = evidence.sheetRowsRead ?? evidence.allRows?.count ?? evidence.recentRows?.count {
            let title = evidence.sheetTitle?.nonEmpty ?? "Sheet"
            parts.append("\(title) 전체 \(rows)개 행")
        }
        if let chars = evidence.docCharsRead {
            let title = evidence.docTitle?.nonEmpty ?? "Doc"
            parts.append("\(title) \(chars)자")
        }
        if evidence.docWasTruncated == true {
            parts.append("불완전한 이전 근거")
        }
        if let provider = evidence.provider?.nonEmpty {
            parts.append(AgentProvider(rawValue: provider)?.title ?? provider)
        }
        if evidence.fallbackUsed == true {
            parts.append("fallback 사용")
        }
        if parts.isEmpty, let summary = evidence.summary?.nonEmpty {
            parts.append(summary)
        }
        return parts.isEmpty ? "연결된 Docs/Sheets 기록" : parts.joined(separator: " · ")
    }

    private func evidenceLines(for mission: BipCoachMission, coach: BipCoachState) -> [String] {
        var lines: [String] = []
        if let refs = mission.evidenceRefs {
            lines.append(contentsOf: refs)
        }
        if let summary = coach.evidence?.summary?.nonEmpty {
            lines.append(summary)
        }
        if let evidence = coach.evidence {
            lines.append(evidenceReceiptSummary(evidence))
            if evidence.docWasTruncated == true {
                lines.append("이전 버전에서 만든 불완전한 근거입니다. 전체 근거로 미션을 다시 생성해야 합니다.")
            }
        }
        if let rows = coach.evidence?.allRows ?? coach.evidence?.recentRows, let latest = rows.last {
            let date = latest.date?.nonEmpty ?? "최근 기록"
            let followers = latest.followers?.nonEmpty.map { "팔로워 \($0)" }
            lines.append([date, followers].compactMap { $0 }.joined(separator: ", "))
        }
        if let excerpt = coach.evidence?.docExcerpt?.nonEmpty {
            lines.append(excerpt)
        }
        return lines.isEmpty ? ["연결된 Docs/Sheets 기록을 기준으로 미션을 만들었습니다."] : lines
    }

    private func beginBipMission(_ mission: BipCoachMission) {
        let title = mission.title?.nonEmpty ?? "오늘 실행"
        viewModel.draft = "/bip-draft \(title)"
        if viewModel.canSend {
            viewModel.sendPrompt()
        }
    }

    private func bipCoachButton(_ title: String, action: @escaping () -> Void) -> some View {
        Button(action: action) {
            Text(title)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.78))
                .padding(.horizontal, 10)
                .frame(height: 30)
                .background(
                    Capsule()
                        .fill(Color.white.opacity(0.08))
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
    }

    private func inlineStructuredPromptIntro(for session: ChatSession) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text("다음 작업을 선택하세요")
                .font(.system(size: 17, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.96))
        }
    }

    private func inlineStructuredPrompt(
        _ prompt: StructuredPromptRequest,
        compact: Bool = false,
        submissionState: AgenticViewModel.StructuredPromptSubmissionState? = nil
    ) -> some View {
        let isSubmitting = submissionState?.requestId == prompt.requestId
        let canSubmitPrompt = canSubmit(prompt) && !isSubmitting
        let submitTitle = isSubmitting
            ? (compact ? "저장 중" : "저장 중...")
            : (compact ? "답하기" : structuredPromptSubmitTitle(prompt))

        return VStack(alignment: .leading, spacing: compact ? 10 : 14) {
            if !compact {
                Text(OpenDesignCopy.visibleOfficeHoursTitle(prompt.title, fallback: "오피스 아워 입력 (Office Hours intake)"))
                    .font(.system(size: 15, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.9))
                    .accessibilityIdentifier("assistant.structuredPromptTitle")
            }

            if !compact {
                structuredPromptContext(prompt)
            }

            VStack(alignment: .leading, spacing: compact ? 8 : 12) {
                ForEach(prompt.questions) { question in
                    questionCard(question, prompt: prompt, compact: compact, isSubmitting: isSubmitting)
                        .transition(.opacity)
                }
            }
            .padding(.vertical, 2)
            .animation(.easeInOut(duration: 0.16), value: prompt.requestId)

            if let submissionState, isSubmitting, !compact {
                structuredPromptSubmissionReceipt(submissionState, compact: compact)
            }

            HStack(spacing: 12) {
                Spacer(minLength: 0)

                Button {
                    submitPrompt(prompt)
                } label: {
                    HStack(spacing: 7) {
                        if isSubmitting {
                            ProgressView()
                                .controlSize(.mini)
                                .scaleEffect(0.72)
                        }
                        Text(submitTitle)
                    }
                    .font(.system(size: 14, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(canSubmitPrompt ? 0.96 : 0.42))
                    .padding(.horizontal, 18)
                    .padding(.vertical, 10)
                    .background(
                        Capsule()
                            .fill(Color.white.opacity(canSubmitPrompt ? 0.18 : 0.07))
                    )
                }
                .buttonStyle(.plain)
                .accessibilityValue(canSubmitPrompt ? "Ready" : "Incomplete")
                .accessibilityIdentifier("assistant.structuredContinueButton")
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("assistant.structuredPrompt")
    }

    @ViewBuilder
    private func structuredPromptContext(_ prompt: StructuredPromptRequest) -> some View {
        let introTitle = prompt.intro?.title?.trimmingCharacters(in: .whitespacesAndNewlines)
        let introBody = prompt.intro?.body?.trimmingCharacters(in: .whitespacesAndNewlines)
        let bullets = (prompt.intro?.bullets ?? [])
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        let resources = (prompt.resources ?? []).filter { !$0.title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }

        if introTitle?.isEmpty == false || introBody?.isEmpty == false || !bullets.isEmpty || !resources.isEmpty {
            VStack(alignment: .leading, spacing: 8) {
                if let introTitle, !introTitle.isEmpty {
                    Text(introTitle)
                        .font(.system(size: 13, weight: .bold, design: .rounded))
                        .foregroundStyle(Color(red: 0.82, green: 0.89, blue: 1.0).opacity(0.94))
                }

                if let introBody, !introBody.isEmpty {
                    Text(introBody)
                        .font(.system(size: 12, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.66))
                        .fixedSize(horizontal: false, vertical: true)
                }

                if !bullets.isEmpty {
                    VStack(alignment: .leading, spacing: 4) {
                        ForEach(bullets, id: \.self) { bullet in
                            HStack(alignment: .top, spacing: 7) {
                                Text("•")
                                    .font(.system(size: 12, weight: .bold, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.42))
                                Text(bullet)
                                    .font(.system(size: 11, weight: .medium, design: .rounded))
                                    .foregroundStyle(.white.opacity(0.58))
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }

                if !resources.isEmpty {
                    VStack(alignment: .leading, spacing: 5) {
                        Text("추천 리소스")
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.58))

                        ForEach(resources) { resource in
                            if let url = URL(string: resource.url) {
                                Link(destination: url) {
                                    HStack(spacing: 6) {
                                        Image(systemName: "link")
                                            .font(.system(size: 10, weight: .bold))
                                        Text(resource.title)
                                            .font(.system(size: 11, weight: .semibold, design: .rounded))
                                            .lineLimit(1)
                                        if let source = resource.source?.nonEmpty {
                                            Text(source)
                                                .font(.system(size: 10, weight: .medium, design: .rounded))
                                                .foregroundStyle(.white.opacity(0.42))
                                                .lineLimit(1)
                                        }
                                    }
                                    .foregroundStyle(.white.opacity(0.74))
                                }
                                .buttonStyle(.plain)
                            }
                        }
                    }
                    .padding(.top, 2)
                }
            }
            .padding(.vertical, 3)
            .frame(maxWidth: .infinity, alignment: .leading)
            .accessibilityIdentifier("assistant.structuredPromptContext")
        }
    }

    private func structuredPromptSubmitTitle(_ prompt: StructuredPromptRequest) -> String {
        if prompt.title?.contains("첫") == true {
            return "이걸로 시작"
        }
        return "다음 질문"
    }

    private func submissionState(for prompt: StructuredPromptRequest) -> AgenticViewModel.StructuredPromptSubmissionState? {
        guard let state = viewModel.structuredPromptSubmissionState(for: prompt.sessionId),
              state.requestId == prompt.requestId else { return nil }
        return state
    }

    private func structuredPromptSubmissionReceipt(
        _ state: AgenticViewModel.StructuredPromptSubmissionState,
        compact: Bool
    ) -> some View {
        VStack(alignment: .leading, spacing: compact ? 3 : 5) {
            Text(state.progressText?.nonEmpty ?? "답변 저장 중: \(state.answerSummary)")
                .font(.system(size: compact ? 11 : 12, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.66))
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)

            if !compact, state.progressText?.nonEmpty != nil {
                Text("답변: \(state.answerSummary)")
                    .font(.system(size: 10, weight: .medium, design: .rounded))
                    .foregroundStyle(.white.opacity(0.42))
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, compact ? 10 : 12)
        .padding(.vertical, compact ? 7 : 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: compact ? 10 : 12, style: .continuous)
                .fill(Color.white.opacity(0.055))
        )
        .accessibilityIdentifier("assistant.structuredSubmissionReceipt")
    }

    private func questionCard(
        _ question: StructuredPromptQuestion,
        prompt: StructuredPromptRequest,
        compact: Bool = false,
        isSubmitting: Bool = false
    ) -> some View {
        let draft = viewModel.structuredPromptDraft(for: question, in: prompt)
        let isOfficeHoursPrompt = prompt.generation?.mode?.hasPrefix("office_hours") == true
        let choiceAccent = isOfficeHoursPrompt ? OpenDesignDayColor.accent : ContentView.structuredChoiceAccent
        let shouldShowOptionDescription = !compact || isOfficeHoursPrompt

        return VStack(alignment: .leading, spacing: compact ? 9 : 12) {
            Text(question.question)
                .font(.system(size: compact ? 15 : 14, weight: .semibold, design: .rounded))
                .foregroundStyle(.white.opacity(0.92))
                .fixedSize(horizontal: false, vertical: true)

            if let helperText = question.helperText?.trimmingCharacters(in: .whitespacesAndNewlines), !helperText.isEmpty {
                if compact {
                    Text(helperText)
                        .font(.system(size: 11, weight: .medium, design: .rounded))
                        .foregroundStyle(.white.opacity(0.54))
                        .lineLimit(2)
                        .fixedSize(horizontal: false, vertical: true)
                        .accessibilityLabel(helperText)
                } else {
                    VStack(alignment: .leading, spacing: 5) {
                        Text(question.header)
                            .font(.system(size: 11, weight: .bold, design: .rounded))
                            .foregroundStyle(Color(red: 0.82, green: 0.89, blue: 1.0).opacity(0.92))
                        Text(helperText)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.62))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    .padding(12)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 14, style: .continuous)
                            .fill(Color.white.opacity(0.055))
                            .overlay(
                                RoundedRectangle(cornerRadius: 14, style: .continuous)
                                    .stroke(Color.white.opacity(0.08), lineWidth: 1)
                            )
                    )
                }
            }

            if let options = question.options, !options.isEmpty {
                VStack(spacing: compact ? 6 : 8) {
                    ForEach(options, id: \.label) { option in
                        choiceRow(
                            option,
                            question: question,
                            prompt: prompt,
                            selected: draft.selectedOptions.contains(option.label),
                            accent: choiceAccent,
                            showDescription: shouldShowOptionDescription,
                            disabled: isSubmitting
                        )
                    }
                }
            }

            if question.allowFreeText == true || question.options?.isEmpty != false {
                VStack(alignment: .leading, spacing: 6) {
                    Text(freeTextLabel(for: question, compact: compact))
                        .font(.system(size: 11, weight: .bold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.52))
                    freeTextField(question: question, prompt: prompt, isDisabled: isSubmitting)
                }
            }
        }
        .padding(compact ? 12 : 14)
        .opacity(isSubmitting ? 0.72 : 1)
        .background(
            RoundedRectangle(cornerRadius: compact ? 14 : 16, style: .continuous)
                .fill(Color.black.opacity(0.18))
                .overlay(
                    RoundedRectangle(cornerRadius: compact ? 14 : 16, style: .continuous)
                        .stroke(Color.white.opacity(0.08), lineWidth: 1)
                )
        )
    }

    private func freeTextLabel(for question: StructuredPromptQuestion, compact: Bool) -> String {
        if question.options?.isEmpty == false {
            return "기타"
        }
        return compact ? "직접 입력" : "자유 입력"
    }

    /// Default accent for the form-style structured prompt (office-hours intake).
    /// Inline decision cards override this with `inlineDecisionAccent`.
    private static let structuredChoiceAccent = Color(red: 0.82, green: 0.89, blue: 1.0)
    /// Sage-cyan accent for inline decision cards (Decision Card Stack variant).
    /// Stays off-token from the rest of the chat surface so the card reads as a
    /// distinct decision moment without competing with provider-auth or BIP
    /// mission cards. Source: design-shotgun approved.json (#7BA890).
    static let inlineDecisionAccent = Color(red: 0.482, green: 0.659, blue: 0.565)

    private func choiceRow(
        _ option: StructuredPromptOption,
        question: StructuredPromptQuestion,
        prompt: StructuredPromptRequest,
        selected: Bool,
        accent: Color = ContentView.structuredChoiceAccent,
        showDescription: Bool = true,
        disabled: Bool = false
    ) -> some View {
        Button {
            guard !disabled else { return }
            viewModel.toggleStructuredPromptOption(option.label, for: question, in: prompt)
        } label: {
            HStack(alignment: .top, spacing: 12) {
                ZStack {
                    Circle()
                        .stroke(selected ? accent : Color.white.opacity(0.30), lineWidth: 1.4)
                    if selected {
                        Circle()
                            .fill(accent)
                            .frame(width: 8, height: 8)
                    }
                }
                .frame(width: 16, height: 16)
                .padding(.top, 2)

                VStack(alignment: .leading, spacing: 3) {
                    Text(option.label)
                        .font(.system(size: 13, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.94))
                    if showDescription {
                        Text(option.description)
                            .font(.system(size: 12, weight: .medium, design: .rounded))
                            .foregroundStyle(.white.opacity(0.54))
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }

                Spacer(minLength: 0)
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(selected ? Color.white.opacity(0.18) : Color.black.opacity(0.16))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(selected ? accent.opacity(0.72) : Color.white.opacity(0.0), lineWidth: 1)
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .disabled(disabled)
        .accessibilityElement(children: .ignore)
        .accessibilityIdentifier("assistant.structuredChoice.\(question.id).\(option.label)")
        .accessibilityLabel(option.label)
        .accessibilityHint(option.description)
        .accessibilityValue(selected ? "Selected" : "Not selected")
        .accessibilityAddTraits(.isButton)
    }

    private func freeTextField(
        question: StructuredPromptQuestion,
        prompt: StructuredPromptRequest,
        isDisabled: Bool = false
    ) -> some View {
        if question.textMode == .long {
            return AnyView(
                TextEditor(
                    text: Binding(
                        get: { viewModel.structuredPromptDraft(for: question, in: prompt).freeText },
                        set: { viewModel.updateStructuredPromptFreeText($0, for: question, in: prompt) }
                    )
                )
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(.white.opacity(0.94))
                .scrollContentBackground(.hidden)
                .frame(height: 88)
                .padding(10)
                .background(
                    RoundedRectangle(cornerRadius: 16, style: .continuous)
                        .fill(Color.black.opacity(0.16))
                )
                .disabled(isDisabled)
                .accessibilityIdentifier("assistant.structuredFreeText.\(question.id)")
                .accessibilityLabel(question.freeTextPlaceholder?.nonEmpty ?? "Type your answer")
            )
        }

        return AnyView(
            TextField(
                question.freeTextPlaceholder?.nonEmpty ?? "Type your answer",
                text: Binding(
                    get: { viewModel.structuredPromptDraft(for: question, in: prompt).freeText },
                    set: { viewModel.updateStructuredPromptFreeText($0, for: question, in: prompt) }
                )
            )
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .medium, design: .rounded))
            .foregroundStyle(.white.opacity(0.94))
            .padding(.horizontal, 12)
            .padding(.vertical, 11)
            .background(
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(Color.black.opacity(0.16))
            )
            .disabled(isDisabled)
            .onSubmit {
                submitPrompt(prompt)
            }
            .accessibilityIdentifier("assistant.structuredFreeText.\(question.id)")
            .accessibilityLabel(question.freeTextPlaceholder?.nonEmpty ?? "Type your answer")
        )
    }

    private var pillMaterial: some View {
        RoundedRectangle(cornerRadius: 22, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.64, green: 0.58, blue: 0.42).opacity(0.96),
                        Color(red: 0.53, green: 0.48, blue: 0.35).opacity(0.98)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 22, style: .continuous)
                    .stroke(Color.white.opacity(0.14), lineWidth: 1)
            )
    }

    private var expandedBubbleMaterial: some View {
        RoundedRectangle(cornerRadius: 30, style: .continuous)
            .fill(
                LinearGradient(
                    colors: [
                        Color(red: 0.63, green: 0.57, blue: 0.42).opacity(0.97),
                        Color(red: 0.50, green: 0.46, blue: 0.34).opacity(0.98)
                    ],
                    startPoint: .topLeading,
                    endPoint: .bottomTrailing
                )
            )
            .overlay(
                RoundedRectangle(cornerRadius: 30, style: .continuous)
                    .stroke(Color.white.opacity(0.12), lineWidth: 1)
            )
    }

    private func assistantAvatar(size: CGFloat) -> some View {
        Image("profile")
            .resizable()
            .scaledToFill()
            .frame(width: size, height: size)
            .clipShape(Circle())
            .overlay(
                Circle()
                    .stroke(Color.white.opacity(0.14), lineWidth: 1)
        )
    }

    private func assistantAvatarButton(size: CGFloat) -> some View {
        Button {
            withAnimation(.spring(response: 0.32, dampingFraction: 0.88)) {
                if let openWorkspaceAction {
                    openWorkspaceAction()
                } else {
                    viewModel.showWorkspace()
                }
            }
        } label: {
            assistantAvatar(size: size)
        }
        .buttonStyle(.plain)
        .help("Agentic30 열기")
        .accessibilityIdentifier("assistant.openWorkspaceButton")
        .accessibilityLabel("Agentic30 열기")
    }

    private func quickStartRow() -> some View {
        HStack(spacing: 8) {
            quickStartButton(title: "문서 인터뷰", prompt: "/office-hours-docs")
        }
    }

    private func quickStartButton(title: String, prompt: String) -> some View {
        Button {
            viewModel.draft = prompt
        } label: {
            Text(title)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(.white.opacity(0.72))
                .lineLimit(1)
                .padding(.horizontal, 10)
                .padding(.vertical, 7)
                .background(
                    Capsule()
                        .fill(Color.black.opacity(0.14))
                        .overlay(
                            Capsule()
                                .stroke(Color.white.opacity(0.08), lineWidth: 1)
                        )
                )
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("assistant.quickStart.\(title)")
        .accessibilityLabel(title)
    }

    private func promptComposer() -> some View {
        let placeholder = workspacePromptPlaceholder()
        return HStack(spacing: 10) {
            TextField(
                placeholder,
                text: $viewModel.draft
            )
            .textFieldStyle(.plain)
            .font(.system(size: 13, weight: .semibold, design: .rounded))
            .foregroundStyle(.white.opacity(0.94))
            .accessibilityIdentifier("assistant.promptComposer")
            .accessibilityLabel(placeholder)
            .onSubmit {
                if viewModel.canSend {
                    viewModel.sendPrompt()
                }
            }

            Button {
                viewModel.sendPrompt()
            } label: {
                Image(systemName: "arrow.up.circle.fill")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(.white.opacity(viewModel.canSend ? 0.92 : 0.32))
                    .frame(width: 34, height: 34)
                    .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(!viewModel.canSend)
            .accessibilityIdentifier("assistant.sendPromptButton")
            .accessibilityLabel("Send prompt")
            .accessibilityAction {
                if viewModel.canSend {
                    viewModel.sendPrompt()
                }
            }
        }
        .padding(.horizontal, 13)
        .frame(height: 50)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("assistant.promptComposerContainer")
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(Color.black.opacity(0.18))
                .overlay(
                    RoundedRectangle(cornerRadius: 18, style: .continuous)
                        .stroke(Color.white.opacity(0.1), lineWidth: 1)
                )
        )
    }

    private func workspacePromptPlaceholder() -> String {
        if viewModel.selectedSession == nil {
            return "첫 메시지 미리 적기"
        }
        if viewModel.visibleBipCoach?.currentMission != nil {
            return "예: 초안 써줘 / 완료 기준을 더 작게 줄여줘"
        }
        if viewModel.visibleBipCoach?.pendingMissionChoices.isEmpty == false {
            return "예: 왜 1번이 추천인가요? / 더 작은 미션으로 줄여줘"
        }
        return "메시지 보내기"
    }

    @ViewBuilder
    private func bubbleBackground(isCompact: Bool) -> some View {
        if isCompact {
            pillMaterial
        } else {
            expandedBubbleMaterial
        }
    }

    private func skeletonLine(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 10, style: .continuous)
            .fill(Color.white.opacity(0.16))
            .frame(width: 620 * width - 44, height: 18)
            .overlay(
                RoundedRectangle(cornerRadius: 10, style: .continuous)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color.white.opacity(0.03),
                                Color.white.opacity(0.12),
                                Color.white.opacity(0.03)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .opacity(0.7)
            )
    }

    private func skeletonChip(width: CGFloat) -> some View {
        RoundedRectangle(cornerRadius: 18, style: .continuous)
            .fill(Color.black.opacity(0.12))
            .frame(width: width, height: 42)
            .overlay(
                RoundedRectangle(cornerRadius: 18, style: .continuous)
                    .stroke(Color.white.opacity(0.06), lineWidth: 1)
            )
    }

    private func statusIcon(for session: ChatSession) -> some View {
        Group {
            switch session.status {
            case .running:
                Image(systemName: "pause.circle.fill")
            case .awaitingInput:
                Image(systemName: "questionmark.circle.fill")
            case .error:
                Image(systemName: "exclamationmark.triangle.fill")
            case .idle:
                Image(systemName: "waveform")
            }
        }
        .font(.system(size: 15, weight: .semibold))
        .foregroundStyle(.white.opacity(0.68))
    }

    private func compactTitle(for session: ChatSession) -> String {
        switch session.status {
        case .running:
            return session.title.nonEmpty ?? "답변을 작성하고 있어요"
        case .awaitingInput:
            return "다음 작업을 선택하세요"
        case .error:
            return "Assistant가 오류로 멈췄습니다"
        case .idle:
            return session.title.nonEmpty ?? "Assistant가 준비됐습니다"
        }
    }

    private func compactSubtitle(for session: ChatSession) -> String {
        switch session.status {
        case .running:
            return "최신 답변을 받아오는 중입니다"
        case .awaitingInput:
            return "선택하거나 직접 입력하면 이어서 진행합니다"
        case .error:
            return session.error?.nonEmpty ?? "설정이나 메뉴 막대에서 최신 메시지를 확인하세요"
        case .idle:
            return lastAssistantMessage(in: session)?.content.nonEmpty ?? "대기 중"
        }
    }

    private func compactAccessoryLabel(for session: ChatSession) -> String {
        switch session.status {
        case .running:
            return "작업 중"
        case .awaitingInput:
            return "입력 대기"
        case .error:
            return "오류"
        case .idle:
            return "현재"
        }
    }

    private func expandedSubtitle(for session: ChatSession, hasMissionSuggestion: Bool = false) -> String {
        if hasMissionSuggestion {
            return "Assistant"
        }
        switch session.provider {
        case .codex:
            return "현재 Codex 세션의 최신 답변"
        case .claude:
            return "현재 Claude 세션의 최신 답변"
        case .gemini:
            return "현재 Gemini 세션의 최신 답변"
        case .cursor:
            return "현재 Cursor 세션의 최신 답변"
        }
    }

    private func providerAuthActionIcon(_ provider: AgentProvider) -> String {
        switch provider {
        case .claude:
            return "person.crop.circle.badge.checkmark"
        case .codex:
            return "sparkles"
        case .gemini:
            return "terminal"
        case .cursor:
            return "key.fill"
        }
    }

    private func workspaceShouldRenderMessage(_ message: ChatMessage) -> Bool {
        switch message.role {
        case .user:
            return message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil
        case .assistant, .system:
            return message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil
                || message.error?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil
                || message.bipMissionChoices?.isEmpty == false
                || message.providerAuthActions?.isEmpty == false
                || message.state == .streaming
        }
    }

    private func lastAssistantMessage(in session: ChatSession) -> ChatMessage? {
        session.messages.last(where: { message in
            (message.role == .assistant || message.role == .system)
                && workspaceShouldRenderMessage(message)
        })
    }

    private func workspaceLatestAssistantEvidence(in session: ChatSession) -> String? {
        guard let content = lastAssistantMessage(in: session)?.content.nonEmpty else {
            return nil
        }

        let maxEvidenceCharacters = 900
        guard content.count > maxEvidenceCharacters else {
            return content
        }

        let endIndex = content.index(content.startIndex, offsetBy: maxEvidenceCharacters)
        return String(content[..<endIndex]) + "..."
    }

    private func lastUserPrompt(in session: ChatSession) -> String? {
        session.messages.last(where: { $0.role == .user })?.content.nonEmpty
    }

    private func canSubmit(_ prompt: StructuredPromptRequest) -> Bool {
        viewModel.canSubmitStructuredPrompt(prompt)
    }

    private func submitPrompt(_ prompt: StructuredPromptRequest) {
        guard submissionState(for: prompt) == nil else { return }
        guard canSubmit(prompt) else { return }

        let submissions = viewModel.structuredPromptSubmissions(for: prompt)
        if isOfficeHoursStructuredPrompt(prompt) {
            officeHoursRecordSubmittedPromptIfNeeded(prompt, submissions: submissions)
            officeHoursStartQuestionLoading(for: prompt)
        }

        #if DEBUG
        if viewModel.completeUITestingOfficeHoursStructuredPromptIfNeeded(prompt) {
            return
        }
        #endif

        viewModel.submitStructuredPrompt(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            responses: submissions
        )
    }

    private func isOfficeHoursStructuredPrompt(_ prompt: StructuredPromptRequest) -> Bool {
        prompt.generation?.mode?.hasPrefix("office_hours") == true
            || prompt.title?.caseInsensitiveCompare("Office Hours") == .orderedSame
    }

    private func officeHoursStartQuestionLoading(for prompt: StructuredPromptRequest) {
        startOfficeHoursQuestionLoading(sessionID: prompt.sessionId, requestID: prompt.requestId)
    }

    private func startOfficeHoursQuestionLoading(sessionID: String, requestID: String) {
        let startedAt = Date()
        officeHoursQuestionLoadingStartedAtBySession[sessionID] = startedAt
        officeHoursActiveQuestionLoadersBySession[sessionID] = OfficeHoursLoadingSnapshot(
            sessionId: sessionID,
            requestId: requestID,
            startedAt: startedAt
        )
    }

    private func officeHoursStartLoaderRequestID(for sessionID: String) -> String {
        "office-hours-start-\(sessionID)"
    }

    private func officeHoursRecordSubmittedPromptIfNeeded(
        _ prompt: StructuredPromptRequest,
        submissions: [AgenticViewModel.StructuredPromptSubmission]
    ) {
        guard isOfficeHoursStructuredPrompt(prompt) else {
            return
        }
        let snapshot = OfficeHoursSubmittedPromptSnapshot(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            prompt: prompt,
            submissions: submissions,
            submittedAt: .now
        )
        var snapshots = officeHoursSubmittedPromptSnapshotsBySession[prompt.sessionId] ?? []
        if let index = snapshots.firstIndex(where: { $0.requestId == prompt.requestId }) {
            snapshots[index] = snapshot
        } else {
            snapshots.append(snapshot)
        }
        officeHoursSubmittedPromptSnapshotsBySession[prompt.sessionId] = snapshots.sorted { lhs, rhs in
            if lhs.submittedAt == rhs.submittedAt { return lhs.requestId < rhs.requestId }
            return lhs.submittedAt < rhs.submittedAt
        }
    }

    private func syncPromptDrafts(bindingToken: String?) {
        guard let request = viewModel.pendingStructuredPrompt else {
            currentPromptBindingToken = nil
            viewModel.synchronizeStructuredPromptDrafts(with: nil)
            return
        }
        let resolvedBindingToken = bindingToken ?? request.uiBindingToken
        guard currentPromptBindingToken != resolvedBindingToken else { return }

        currentPromptBindingToken = resolvedBindingToken
        viewModel.synchronizeStructuredPromptDrafts(with: request)
    }
}

enum AgenticCurriculumPhase: String, CaseIterable, Identifiable, Hashable {
    case foundation
    case build
    case launch
    case grow

    var id: String { rawValue }

    var title: String {
        switch self {
        case .foundation: return "초기 검증"
        case .build: return "만들기"
        case .launch: return "공개"
        case .grow: return "성장"
        }
    }
}

struct AgenticCurriculumDay: Identifiable, Hashable {
    let day: Int
    let phase: AgenticCurriculumPhase
    let title: String
    let shortTitle: String
    let summary: String
    let tasks: [String]
    let output: String

    var id: Int { day }

    static let days: [AgenticCurriculumDay] = [
        .init(day: 1, phase: .foundation, title: "목표와 고객 핵심 가설을 만든다", shortTitle: "가설", summary: "프로젝트 목표를 고객, 문제, 확인할 행동과 한 문장으로 맞추고 Day 2 시장 신호 검증 기준으로 둡니다.", tasks: ["프로젝트 목표 한 문장 고정하기", "고객 / 문제 / 확인할 행동 세 요소 작성하기", "품질 게이트 7.0/10 이상인지 확인하고 다음 검증 기준 기록"], output: "day-1-alignment-statement.md, .agentic30/docs/GOAL.md, .agentic30/docs/ICP.md, .agentic30/docs/SPEC.md v0"),
        .init(day: 2, phase: .foundation, title: "돈이 흐르는 기준 시장을 고른다", shortTitle: "Market", summary: "어제 통증과 가까운 iOS/Android/Web/Mac 앱·도구 시장에서 이미 지불 행동이 있는지 확인합니다.", tasks: ["카테고리 1-2개 고르기", "작은 팀/개인이 만든 유료 앱·광고 앱 5개 찾기", "가격·리뷰·ASO·광고/콘텐츠 흔적을 day-2-evidence-log.md에 기록"], output: "day-2-evidence-log.md"),
        .init(day: 3, phase: .foundation, title: "실제 행동 인터뷰 질문을 만든다", shortTitle: "실제 행동 질문", summary: "약한 가설을 검증/반증할 5문장 인터뷰 질문을 만들고 미래 의향 질문을 제거합니다.", tasks: ["과거 행동 질문 3개 이상 쓰기", "미래 의향/칭찬 유도 질문 제거", "다음 인터뷰 대상 1명과 질문 5개 확정"], output: "day-3-interview-script.md"),
        .init(day: 4, phase: .foundation, title: "10배 첫 진입점으로 약한 섹션을 다시 쓴다", shortTitle: "10x 진입점", summary: "경쟁 앱을 베끼지 않고 더 좁은 고객 유형이나 더 빠른 결과로 SPEC.md의 약한 섹션을 다시 씁니다.", tasks: ["원조/대체재의 핵심 흐름 1개 고르기", "가격·속도·UX·고객 유형 중 10배 첫 진입점 1개 선택", "SPEC.md 같은 파일에서 약한 섹션 다시 쓰기"], output: "day-4-rewrite-decision.md"),
        .init(day: 5, phase: .foundation, title: "수요 신호를 숫자로 평가한다", shortTitle: "수요 신호", summary: "경쟁앱/광고/노출/스토어/소개 페이지/DM 데이터를 진짜 수요 신호와 허수로 분리합니다.", tasks: ["노출/클릭/가입/답장/고객 확보 비용/스토어 전환 중 있는 숫자 정리", "대기 신청자/클릭률이 아닌 돈 낼 후보 1명 고르기", "SPEC.md v2에 수요 신호 판단 기록"], output: "SPEC.md v2, day-5-demand-signal.md"),
        .init(day: 6, phase: .foundation, title: "돈/시간 ask를 실행한다", shortTitle: "Ask", summary: "칭찬이 아니라 특정 1명에게 가격, 받을 약속, 응답 기한이 있는 ask를 보냅니다.", tasks: ["ask 대상 1명 선택", "가격·받을 약속·응답 기한이 있는 문장 작성", "yes/no/no-reply를 원문으로 기록"], output: "monetization-ask-result.md"),
        .init(day: 7, phase: .foundation, title: "초기 검증 계속/중단을 결정한다", shortTitle: "계속/중단", summary: "7일 기록으로 계속/재시작/전환 중 하나를 고릅니다.", tasks: ["인터뷰/일지/공개 기록 수량 세기", "가장 강한 증거와 반증 쓰기", "다음 7일 결론 선택"], output: "go-no-go.md, foundation-summary"),
        .init(day: 8, phase: .build, title: "첫 버전을 핵심 기능 1개로 자른다", shortTitle: "핵심 행동", summary: "기능 목록이 아니라 사용자가 30초 안에 첫 가치를 보는 핵심 행동 1개를 완성 대상으로 고정합니다.", tasks: ["핵심 행동 1개와 성공 화면 정의", "로그인/동기화/자동화/설정 확장은 다음 범위로 표시", "첫 성공 경로 테스트 작성"], output: "core action spec + deferred list"),
        .init(day: 9, phase: .build, title: "입력→처리→출력 흐름을 고정한다", shortTitle: "Input Flow", summary: "사용자가 바로 써볼 수 있게 입력, 처리, 결과 화면을 한 번에 지나가게 만듭니다.", tasks: ["첫 입력 포맷 1개만 선택", "처리 실패와 빈 입력 폴백 작성", "결과 화면까지 30초 이내인지 재기"], output: "input-process-output flow"),
        .init(day: 10, phase: .build, title: "핵심 결과의 10배 품질을 만든다", shortTitle: "10x 결과", summary: "기능 수가 아니라 같은 문제를 더 빠르게, 적은 클릭으로, 더 좁은 고객 유형에 맞게 해결합니다.", tasks: ["경쟁/대체재 대비 10배 기준 1개 선택", "핵심 결과 화면에만 품질 투자", "부차 기능 추가 요청은 다음 폴더로 이동"], output: "10x core result note"),
        .init(day: 11, phase: .build, title: "마찰 없는 첫 사용을 만든다", shortTitle: "No Login", summary: "검증 전 로그인, 계정, 복잡한 온보딩으로 이탈을 만들지 않습니다.", tasks: ["설치 후 첫 가치까지 클릭 수 세기", "필수 설명 5줄 이하로 줄이기", "로그인/회원가입 없이 가능한 경로 확인"], output: "time-to-first-value note"),
        .init(day: 12, phase: .build, title: "직접 끝까지 사용해본다", shortTitle: "끝까지 사용", summary: "실제 입력에서 핵심 기능 1개와 결과 기록까지 한 번 지나갑니다.", tasks: ["실제 인터뷰/일지 파일 넣기", "핵심 결과 생성 실행", "추천 행동 수행 여부 기록"], output: "end-to-end-use-log.md"),
        .init(day: 13, phase: .build, title: "스토어/소개 페이지 약속을 미리 쓴다", shortTitle: "약속", summary: "제품 설명을 나중에 붙이지 말고 iOS/Android/Web/Mac 어디서 팔든 통하는 약속 한 문장으로 범위를 제한합니다.", tasks: ["타깃 고객 유형 한 줄 작성", "결과 약속 한 문장 작성", "스크린샷/시연/스토어 첫 화면에 보여야 할 장면 1개 선택"], output: "store or landing promise draft"),
        .init(day: 14, phase: .build, title: "측정을 심는다", shortTitle: "Measurement", summary: "설치보다 첫 가치 경험과 이탈 지점을 알 수 있게 이벤트를 남깁니다.", tasks: ["first_value 이벤트 정의", "개인정보 없는 payload 확인", "activation baseline 기록 위치 만들기"], output: "event list + activation check"),
        .init(day: 15, phase: .build, title: "수익모델 사전 점검을 한다", shortTitle: "매출 점검", summary: "광고든 구독이든 결제를 나중 문제로 밀지 말고 가격, 노출 위치, 받을 약속의 막힘을 확인합니다.", tasks: ["광고/구독/일회성 결제 중 현재 실험 모델 1개 선택", "페이월/결제 모형 또는 광고 노출 사전 점검 경로 확인", "대기 신청자와 무료 가입은 증거가 아님을 기록"], output: "revenue dry-run note"),
        .init(day: 16, phase: .build, title: "출시 체크리스트를 닫는다", shortTitle: "Release Gate", summary: "출시를 미루는 플랫폼 계정, 권한, 세금/정산, 빌드 리스크를 확인 목록으로 줄입니다.", tasks: ["App Store/Google Play/Web/Mac 중 현재 채널 계정 상태 확인", "정산·세금·회사 사규 리스크 체크", "첫 테스터에게 보낼 설치/접속 안내 5줄 작성"], output: "release readiness checklist"),
        .init(day: 17, phase: .build, title: "만들기 단계를 줄일지 결정한다", shortTitle: "만들기 회고", summary: "기능 추가가 아니라 첫 가치 경험과 유료 요청 가능 여부로 남길 것을 고릅니다.", tasks: ["7일 사용 로그 확인", "첫 가치까지 막힌 단계 확인", "삭제/유지/다음 단계 결정"], output: "build decision memo"),
        .init(day: 18, phase: .launch, title: "고객 언어로 공개 이야기를 쓴다", shortTitle: "이야기", summary: "제품 설명보다 반복된 고객 표현과 10배 첫 진입점으로 공개합니다.", tasks: ["반복 인용 3개 선택", "관심 끌기-시연-행동 버튼 구조로 공개 문구 3개 작성", "가장 강한 현재 대안으로 시작"], output: "launch story draft"),
        .init(day: 19, phase: .launch, title: "첫 공개 증거를 만든다", shortTitle: "공개 증거", summary: "불완전한 앱 상태보다 배운 고객 증거와 핵심 결과 장면을 공개합니다.", tasks: ["핵심 결과 스크린샷/요약 선택", "실행 결과 1개 쓰기", "Threads/공개 기록 게시"], output: "public proof post"),
        .init(day: 20, phase: .launch, title: "Warm outreach를 보낸다", shortTitle: "Warm outreach", summary: "가장 절박한 사람에게 직접 확인하고 응답/무응답을 숫자로 남깁니다.", tasks: ["20명 후보 목록", "개인화 DM 10개", "응답/무응답 Sheet 기록"], output: "outreach tracker"),
        .init(day: 21, phase: .launch, title: "첫 설치/사용 관찰을 한다", shortTitle: "Observe", summary: "시연이 아니라 사용자가 iOS/Android/Web/Mac 실제 환경에서 막히는 장면과 첫 가치 도달 시간을 봅니다.", tasks: ["테스터 1명 설치/접속 관찰", "막힌 단계와 first_value 도달 여부 기록", "수정 3개 이하 선택"], output: "observation note"),
        .init(day: 22, phase: .launch, title: "60초 시연을 만든다", shortTitle: "시연", summary: "핵심 기능 1개와 10배 결과가 60초 안에 보이게 합니다.", tasks: ["한 입력에서 결과까지 녹화", "관심 끌기-시연-행동 버튼 캡션 작성", "공개 기록/소개 페이지/광고 소재로 재사용"], output: "60s demo asset"),
        .init(day: 23, phase: .launch, title: "paid learning 실험을 설계한다", shortTitle: "Paid Learning", summary: "광고비를 성장 욕심이 아니라 iOS/Android/Web/Mac 시장/메시지 학습 비용으로 작게 씁니다.", tasks: ["테스트 예산과 중단 기준 정하기", "소재 hook 3개와 타겟 1개 선택", "CPI/CTR/store conversion/first_value 측정 준비"], output: "paid learning plan"),
        .init(day: 24, phase: .launch, title: "Launch 결정을 숫자로 한다", shortTitle: "Launch Decision", summary: "조회수가 아니라 DM/설치/first_value/ask 결과로 다음 7일을 고릅니다.", tasks: ["유입/설치/첫 가치/ask 숫자 정리", "가장 강한 채널 선택", "다음 실험 1개 결정"], output: "launch decision"),
        .init(day: 25, phase: .grow, title: "Activation을 정의한다", shortTitle: "Activation", summary: "가입이 아니라 설치 후 30초 이내 첫 가치 경험에 도달했는지를 측정합니다.", tasks: ["첫 가치 행동 정의", "도달/이탈 수 계산", "가장 큰 이탈 지점 선택"], output: "activation baseline"),
        .init(day: 26, phase: .grow, title: "Retention 신호를 본다", shortTitle: "Retention", summary: "다시 돌아와 핵심 기능을 반복하는 사람이 있는지 확인합니다.", tasks: ["재방문 기준 정하기", "반복 사용 발화 찾기", "돌아온 이유 한 문장 작성"], output: "retention note"),
        .init(day: 27, phase: .grow, title: "가격 ask와 페이월을 반복한다", shortTitle: "Pricing", summary: "첫 매출은 큰 금액보다 지불 행동 또는 명시적 가격 거절의 증명입니다.", tasks: ["유료 제안 1개 작성", "관심 사용자에게 가격·약속·기한 포함 제안", "가격 반응과 결제/거절 원문 기록"], output: "pricing ask result"),
        .init(day: 28, phase: .grow, title: "ASO/소재 loop를 만든다", shortTitle: "Acquisition Loop", summary: "앱스토어 검색 키워드, 상세 페이지, 랜딩, 광고 소재를 감이 아니라 전환 데이터로 고칩니다.", tasks: ["App Store/Google Play/랜딩의 hook 점검", "키워드·스크린샷·소재 1개 수정", "CPI/설치/store conversion/first_value 변화 기록"], output: "acquisition loop log"),
        .init(day: 29, phase: .grow, title: "시장 적합 증거 메모를 쓴다", shortTitle: "시장 적합 메모", summary: "실제 사용자 증거, 유입 지표, 요청 결과, 반증을 같은 문서에 둡니다.", tasks: ["사용자 증거와 요청 결과 정리", "고객 확보 비용/첫 성공 행동/계속 사용/가격 반응 요약", "계속/전환/중단 판단 기준 쓰기"], output: "market-fit-evidence-memo.md"),
        .init(day: 30, phase: .grow, title: "계속/전환/중단을 결정한다", shortTitle: "Final Decision", summary: "완주가 아니라 첫 가치, 유입, 지불 행동 근거로 다음 선택을 공개합니다.", tasks: ["30일 숫자 요약", "가장 큰 배움 3개", "continue/pivot/stop 결정"], output: "Day 30 public retro")
    ]
}

private struct BipReadinessGroup: Identifiable, Hashable {
    let title: String
    let ids: [BipReadinessRowId]

    var id: String { title }
}

struct OpenDesignReferenceRoutePolicy {
    static func supportsOpenDesignDay(dayNumber: Int) -> Bool {
        dayNumber == 1 || dayNumber == 2
    }
}

enum OpenDesignWorkspaceDayResolver {
    static func dayNumber(selectedDay: Int, completedDays: Set<Int>) -> Int {
        if OpenDesignReferenceRoutePolicy.supportsOpenDesignDay(dayNumber: selectedDay) {
            return selectedDay
        }
        return completedDays.contains(1) ? 2 : 1
    }
}

#Preview {
    ContentView(viewModel: AgenticViewModel())
}

struct RealisticConfettiBurst: View {
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    let trigger: Int

    init(trigger: Int) {
        self.trigger = trigger
    }

    var body: some View {
        Group {
            if isDisabled {
                Color.clear
            } else {
                RealisticConfettiHost(trigger: trigger)
            }
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .allowsHitTesting(false)
        .accessibilityHidden(true)
    }

    static var isProcessDisabled: Bool {
        ProcessInfo.processInfo.environment["AGENTIC30_TEST_STUB_PROVIDER"] == "1"
    }

    private var isDisabled: Bool {
        reduceMotion || Self.isProcessDisabled
    }
}

struct RealisticConfettiRecipe: Equatable, Identifiable {
    static let origin = CGPoint(x: 0.5, y: 0.70)
    static let cleanupDelay: TimeInterval = 2.20
    static let ticksPerSecond: Double = 60
    static let canvasGravity: Double = 3
    static let demoPaletteHexes = RealisticConfettiPaletteColor.demoLike.map(\.hex)
    static let realistic: [RealisticConfettiRecipe] = [
        .init(name: "core", particleCount: 50, spreadDegrees: 26, startVelocity: 55, decay: 0.90, scalar: 1.0),
        .init(name: "body", particleCount: 40, spreadDegrees: 60, startVelocity: 45, decay: 0.90, scalar: 1.0),
        .init(name: "dust", particleCount: 70, spreadDegrees: 100, startVelocity: 45, decay: 0.91, scalar: 0.8),
        .init(name: "slowRibbon", particleCount: 20, spreadDegrees: 120, startVelocity: 25, decay: 0.92, scalar: 1.2),
        .init(name: "outer", particleCount: 20, spreadDegrees: 120, startVelocity: 45, decay: 0.90, scalar: 1.0)
    ]

    let name: String
    let particleCount: Int
    let spreadDegrees: Double
    let startVelocity: Double
    let decay: Double
    let scalar: Double
    let drift: Double = 0

    var id: String { name }

    static var totalParticleCount: Int {
        realistic.reduce(0) { $0 + $1.particleCount }
    }

    static var totalTicks: Double {
        cleanupDelay * ticksPerSecond
    }

    static func pointScale(for size: CGSize) -> CGFloat {
        let heightScale = size.height / 720
        return min(max(heightScale, 0.72), 1.18)
    }
}

private struct RealisticConfettiHost: View {
    let trigger: Int
    @State private var particles: [RealisticConfettiParticle] = []
    @State private var startedAt = Date()

    var body: some View {
        TimelineView(.animation(minimumInterval: 1.0 / RealisticConfettiRecipe.ticksPerSecond)) { timeline in
            Canvas(opaque: false, colorMode: .linear, rendersAsynchronously: true) { context, size in
                let elapsed = timeline.date.timeIntervalSince(startedAt)
                guard elapsed >= 0,
                      elapsed <= RealisticConfettiRecipe.cleanupDelay else {
                    return
                }

                let tick = elapsed * RealisticConfettiRecipe.ticksPerSecond
                for particle in particles {
                    particle.draw(in: &context, size: size, tick: tick)
                }
            }
        }
        .onAppear {
            restart()
        }
        .onChange(of: trigger) { _, _ in
            restart()
        }
    }

    private func restart() {
        startedAt = Date()
        particles = RealisticConfettiParticle.makeParticles(trigger: trigger)
    }
}

private struct RealisticConfettiParticle: Identifiable {
    let id: Int
    let angle2D: Double
    let startVelocity: Double
    let decay: Double
    let drift: Double
    let wobble: Double
    let wobbleSpeed: Double
    let tiltAngle: Double
    let scalar: Double
    let random: Double
    let shape: RealisticConfettiParticleShape
    let color: RealisticConfettiPaletteColor

    static func makeParticles(trigger: Int) -> [RealisticConfettiParticle] {
        var generator = RealisticConfettiRandomGenerator(seed: UInt64(max(trigger, 1)))
        var particles: [RealisticConfettiParticle] = []
        particles.reserveCapacity(RealisticConfettiRecipe.totalParticleCount)

        for recipe in RealisticConfettiRecipe.realistic {
            let radAngle = Double.pi / 2
            let radSpread = recipe.spreadDegrees * Double.pi / 180

            for _ in 0..<recipe.particleCount {
                let angle2D = -radAngle + ((0.5 * radSpread) - (generator.nextUnit() * radSpread))
                let velocity = (recipe.startVelocity * 0.5) + (generator.nextUnit() * recipe.startVelocity)
                let wobbleSpeed = min(0.11, generator.nextUnit() * 0.1 + 0.05)
                let tiltAngle = (generator.nextUnit() * 0.5 + 0.25) * Double.pi

                particles.append(
                    RealisticConfettiParticle(
                        id: particles.count,
                        angle2D: angle2D,
                        startVelocity: velocity,
                        decay: recipe.decay,
                        drift: recipe.drift,
                        wobble: generator.nextUnit() * 10,
                        wobbleSpeed: wobbleSpeed,
                        tiltAngle: tiltAngle,
                        scalar: recipe.scalar,
                        random: generator.nextUnit() + 2,
                        shape: RealisticConfettiParticleShape.random(using: &generator),
                        color: RealisticConfettiPaletteColor.random(using: &generator)
                    )
                )
            }
        }

        return particles
    }

    func draw(in context: inout GraphicsContext, size: CGSize, tick: Double) {
        guard let frame = frame(in: size, tick: tick) else { return }
        context.fill(
            shape.path(
                center: frame.center,
                scalar: CGFloat(scalar),
                tilt: frame.tilt,
                random: random,
                pointScale: frame.pointScale
            ),
            with: .color(color.color.opacity(frame.opacity))
        )
    }

    private func frame(in size: CGSize, tick: Double) -> RealisticConfettiParticleFrame? {
        guard tick < RealisticConfettiRecipe.totalTicks else { return nil }

        let pointScale = RealisticConfettiRecipe.pointScale(for: size)
        let scaledDistance = geometricDistance(at: tick) * Double(pointScale)
        let origin = CGPoint(
            x: size.width * RealisticConfettiRecipe.origin.x,
            y: size.height * RealisticConfettiRecipe.origin.y
        )
        let wobblePhase = wobble + wobbleSpeed * tick
        let wobbleRadius = 10 * scalar * Double(pointScale)
        let x = origin.x
            + CGFloat((cos(angle2D) * scaledDistance) + (drift * tick * Double(pointScale)))
            + CGFloat(wobbleRadius * cos(wobblePhase))
        let y = origin.y
            + CGFloat((sin(angle2D) * scaledDistance) + (RealisticConfettiRecipe.canvasGravity * tick * Double(pointScale)))
            + CGFloat(wobbleRadius * sin(wobblePhase))
        let progress = min(max(tick / RealisticConfettiRecipe.totalTicks, 0), 1)
        let opacity = pow(1 - progress, 1.1)

        return RealisticConfettiParticleFrame(
            center: CGPoint(x: x, y: y),
            opacity: opacity,
            tilt: tiltAngle + (0.1 * tick),
            pointScale: pointScale
        )
    }

    private func geometricDistance(at tick: Double) -> Double {
        guard decay != 1 else {
            return startVelocity * tick
        }
        return startVelocity * (1 - pow(decay, tick)) / (1 - decay)
    }
}

private struct RealisticConfettiParticleFrame {
    let center: CGPoint
    let opacity: Double
    let tilt: Double
    let pointScale: CGFloat
}

private enum RealisticConfettiParticleShape {
    case square
    case rectangle
    case circle

    static func random(using generator: inout RealisticConfettiRandomGenerator) -> RealisticConfettiParticleShape {
        let roll = generator.nextUnit()
        if roll < 0.58 {
            return .square
        }
        if roll < 0.82 {
            return .circle
        }
        return .rectangle
    }

    func path(
        center: CGPoint,
        scalar: CGFloat,
        tilt: Double,
        random: Double,
        pointScale: CGFloat
    ) -> Path {
        switch self {
        case .square:
            return quadPath(
                center: center,
                width: 8 * scalar * pointScale,
                height: 8 * scalar * pointScale,
                tilt: tilt,
                random: random
            )
        case .rectangle:
            return quadPath(
                center: center,
                width: 13 * scalar * pointScale,
                height: 5 * scalar * pointScale,
                tilt: tilt,
                random: random
            )
        case .circle:
            let width = 8 * scalar * pointScale
            let height = width * CGFloat(0.64 + 0.24 * abs(sin(tilt)))
            return Path(
                ellipseIn: CGRect(
                    x: center.x - width / 2,
                    y: center.y - height / 2,
                    width: width,
                    height: height
                )
            )
        }
    }

    private func quadPath(center: CGPoint, width: CGFloat, height: CGFloat, tilt: Double, random: Double) -> Path {
        let rotation = tilt + (random * 0.18)
        let cosRotation = CGFloat(cos(rotation))
        let sinRotation = CGFloat(sin(rotation))
        let halfWidth = width / 2
        let halfHeight = height / 2
        let sourceCorners: [CGPoint] = [
            CGPoint(x: -halfWidth, y: -halfHeight),
            CGPoint(x: halfWidth, y: -halfHeight),
            CGPoint(x: halfWidth, y: halfHeight),
            CGPoint(x: -halfWidth, y: halfHeight),
        ]
        let corners: [CGPoint] = sourceCorners.map { point in
            let rotatedX = center.x + point.x * cosRotation - point.y * sinRotation
            let rotatedY = center.y + point.x * sinRotation + point.y * cosRotation
            return CGPoint(x: rotatedX, y: rotatedY)
        }

        var path = Path()
        path.move(to: corners[0])
        path.addLine(to: corners[1])
        path.addLine(to: corners[2])
        path.addLine(to: corners[3])
        path.closeSubpath()
        return path
    }
}

private enum RealisticConfettiPaletteColor {
    case cyan
    case purple
    case pink
    case lime
    case yellow
    case orange
    case magenta
    case brandGreen

    static let demoLike: [RealisticConfettiPaletteColor] = [
        .cyan,
        .purple,
        .pink,
        .lime,
        .yellow,
        .orange,
        .magenta,
        .brandGreen
    ]

    static func random(using generator: inout RealisticConfettiRandomGenerator) -> RealisticConfettiPaletteColor {
        demoLike[generator.nextInt(upperBound: demoLike.count)]
    }

    var hex: String {
        switch self {
        case .cyan:
            return "#26CCFF"
        case .purple:
            return "#A25AFD"
        case .pink:
            return "#FF5E7E"
        case .lime:
            return "#88FF5A"
        case .yellow:
            return "#FCFF42"
        case .orange:
            return "#FFA62D"
        case .magenta:
            return "#FF36FF"
        case .brandGreen:
            return "#4BDE80"
        }
    }

    var color: Color {
        switch self {
        case .cyan:
            return Color(red: 0.149, green: 0.800, blue: 1.000)
        case .purple:
            return Color(red: 0.635, green: 0.353, blue: 0.992)
        case .pink:
            return Color(red: 1.000, green: 0.369, blue: 0.494)
        case .lime:
            return Color(red: 0.533, green: 1.000, blue: 0.353)
        case .yellow:
            return Color(red: 0.988, green: 1.000, blue: 0.259)
        case .orange:
            return Color(red: 1.000, green: 0.651, blue: 0.176)
        case .magenta:
            return Color(red: 1.000, green: 0.212, blue: 1.000)
        case .brandGreen:
            return Color(red: 0.294, green: 0.871, blue: 0.502)
        }
    }
}

private struct RealisticConfettiRandomGenerator: RandomNumberGenerator {
    private var state: UInt64

    init(seed: UInt64) {
        state = seed ^ 0x9E3779B97F4A7C15
    }

    mutating func next() -> UInt64 {
        state = state &* 6364136223846793005 &+ 1442695040888963407
        return state
    }

    mutating func nextUnit() -> Double {
        Double(next() >> 11) / Double(UInt64(1) << 53)
    }

    mutating func nextInt(upperBound: Int) -> Int {
        guard upperBound > 0 else { return 0 }
        return Int(next() % UInt64(upperBound))
    }
}

private struct WindowChrome: NSViewRepresentable {
    func makeNSView(context: Context) -> NSView {
        let view = NSView()

        DispatchQueue.main.async {
            guard let window = view.window else { return }

            window.titleVisibility = .hidden
            window.titlebarAppearsTransparent = true
            window.isOpaque = false
            window.backgroundColor = .clear
            window.isMovableByWindowBackground = true
            if CommandLine.arguments.contains("--ui-testing-opaque-window") {
                window.level = .screenSaver
                window.collectionBehavior.insert(.canJoinAllSpaces)
                window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }
        }

        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {}
}

private struct WorkspaceWindowChrome: NSViewRepresentable {
    let maximizeOnInitialInstall: Bool
    let markInitialInstallMaximizeApplied: (() -> Void)?
    let style: WorkspaceChromeStyle

    final class Coordinator {
        var didApplyInitialInstallMaximize = false
        var didApplyUITestingWindowSize = false
    }

    func makeCoordinator() -> Coordinator {
        Coordinator()
    }

    func makeNSView(context: Context) -> NSView {
        let view = NSView()
        configureWindow(for: view, context: context)
        return view
    }

    func updateNSView(_ nsView: NSView, context: Context) {
        configureWindow(for: nsView, context: context)
    }

    private func configureWindow(for view: NSView, context: Context) {
        DispatchQueue.main.async {
            guard let window = view.window else { return }

            window.title = "Agentic30"
            window.titleVisibility = .hidden
            window.toolbarStyle = .unifiedCompact
            window.styleMask.insert(.titled)
            window.styleMask.insert(.fullSizeContentView)
            window.styleMask.insert(.closable)
            window.styleMask.insert(.miniaturizable)
            window.styleMask.insert(.resizable)
            window.isOpaque = true
            if style == .day1OfficeHours {
                let appearance = NSAppearance(named: .darkAqua)
                window.titlebarAppearsTransparent = true
                window.appearance = appearance
                NSApp.appearance = appearance
                window.backgroundColor = OpenDesignOfficeHoursColor.nsWindowBackground
            } else {
                let theme = Agentic30Theme.current
                let appearance = NSAppearance(named: theme.appKitAppearanceName)
                window.titlebarAppearsTransparent = true
                window.appearance = appearance
                NSApp.appearance = appearance
                window.backgroundColor = theme.windowBackgroundColor
            }
            window.isMovableByWindowBackground = true
            if CommandLine.arguments.contains("--ui-testing-opaque-window") {
                window.level = .screenSaver
                window.collectionBehavior.insert(.canJoinAllSpaces)
                window.makeKeyAndOrderFront(nil)
                NSApp.activate(ignoringOtherApps: true)
            }

            if let testingWindowSize = Self.uiTestingWorkspaceWindowSize() {
                if !context.coordinator.didApplyUITestingWindowSize {
                    context.coordinator.didApplyUITestingWindowSize = true
                    DispatchQueue.main.asyncAfter(deadline: .now() + 0.2) {
                        Self.resize(window, to: testingWindowSize)
                    }
                }
            } else if maximizeOnInitialInstall,
               !context.coordinator.didApplyInitialInstallMaximize {
                context.coordinator.didApplyInitialInstallMaximize = true
                Self.maximizeToVisibleFrame(window)
                markInitialInstallMaximizeApplied?()
            }
        }
    }

    private static func maximizeToVisibleFrame(_ window: NSWindow) {
        guard let visibleFrame = (window.screen ?? NSScreen.main)?.visibleFrame else { return }
        window.setFrame(visibleFrame, display: true, animate: false)
    }

    private static func uiTestingWorkspaceWindowSize() -> CGSize? {
        guard let rawValue = CommandLine.arguments
            .first(where: { $0.hasPrefix("--ui-testing-workspace-window-size=") })?
            .split(separator: "=", maxSplits: 1)
            .last
        else {
            return nil
        }

        let parts = rawValue
            .lowercased()
            .split(separator: "x", maxSplits: 1)
            .compactMap { Double(String($0).trimmingCharacters(in: .whitespacesAndNewlines)) }
        guard parts.count == 2,
              parts[0] >= 900,
              parts[1] >= 720
        else {
            return nil
        }
        return CGSize(width: CGFloat(parts[0]), height: CGFloat(parts[1]))
    }

    private static func resize(_ window: NSWindow, to size: CGSize) {
        let visibleFrame = (window.screen ?? NSScreen.main)?.visibleFrame ?? window.frame
        let requestedContentSize = CGSize(
            width: min(size.width, visibleFrame.width),
            height: min(size.height, visibleFrame.height)
        )
        let frameSize = window.frameRect(forContentRect: CGRect(origin: .zero, size: requestedContentSize)).size
        let origin = CGPoint(
            x: visibleFrame.midX - frameSize.width / 2,
            y: visibleFrame.midY - frameSize.height / 2
        )
        window.setFrame(CGRect(origin: origin, size: frameSize), display: true, animate: false)
    }
}

private extension String {
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }

    var officeHoursNormalizedTranscriptText: String {
        components(separatedBy: .whitespacesAndNewlines)
            .filter { !$0.isEmpty }
            .joined(separator: " ")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var officeHoursPromptTerminalBreak: (prefix: String, suffix: String)? {
        for terminal in ["줘.", "줘?"] where hasSuffix(terminal) && count > terminal.count {
            let splitIndex = index(endIndex, offsetBy: -terminal.count)
            let prefix = String(self[..<splitIndex])
            guard !prefix.isEmpty else { return nil }
            return (prefix, terminal)
        }
        return nil
    }
}

private extension Character {
    var officeHoursIsWhitespace: Bool {
        unicodeScalars.allSatisfy { CharacterSet.whitespacesAndNewlines.contains($0) }
    }
}

private struct OfficeHoursEvidenceResolutionSheet: View {
    let draft: OfficeHoursEvidenceDraft
    let onSubmitEvidence: (String, String, String) -> Void
    let onAbandon: (String) -> Void
    let onCancel: () -> Void

    @State private var evidenceKind = "screenshot"
    @State private var locator = ""
    @State private var note = ""
    @State private var abandonReason = ""

    private let evidenceKinds = ["screenshot", "url", "commit", "payment"]

    var body: some View {
        VStack(alignment: .leading, spacing: 16) {
            VStack(alignment: .leading, spacing: 6) {
                Text(draft.mode == .evidence ? "고객 증거 붙이기" : "포기 사유 기록")
                    .font(.system(size: 16, weight: .semibold))
                Text(draft.commitment.text)
                    .font(.system(size: 12))
                    .foregroundStyle(.secondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            if draft.mode == .evidence {
                Picker("증거 종류", selection: $evidenceKind) {
                    ForEach(evidenceKinds, id: \.self) { kind in
                        Text(kind).tag(kind)
                    }
                }
                // §18 증거 제출 표면: URL 붙여넣기 + 파일/스크린샷 picker.
                // sidecar는 link/file을 이미 지원 — 여기는 Swift 표면만 추가한다.
                HStack(spacing: 8) {
                    TextField("URL, 파일 경로, 커밋 SHA, 결제 기록 위치", text: $locator)
                        .textFieldStyle(.roundedBorder)
                    Button("파일 선택…") {
                        let panel = NSOpenPanel()
                        panel.canChooseFiles = true
                        panel.canChooseDirectories = false
                        panel.allowsMultipleSelection = false
                        panel.message = "증거 파일(스크린샷·녹취·캡처)을 선택해줘"
                        if panel.runModal() == .OK, let url = panel.url {
                            locator = url.path
                            let imageExtensions: Set<String> = ["png", "jpg", "jpeg", "heic", "gif", "webp"]
                            if imageExtensions.contains(url.pathExtension.lowercased()) {
                                evidenceKind = "screenshot"
                            }
                        }
                    }
                    .accessibilityIdentifier("officeHours.evidence.filePicker")
                }
                TextField("짧은 설명", text: $note)
                    .textFieldStyle(.roundedBorder)
            } else {
                TextField("왜 이 약속을 닫지 않는지", text: $abandonReason)
                    .textFieldStyle(.roundedBorder)
            }

            HStack {
                Spacer()
                Button("취소", action: onCancel)
                Button(draft.mode == .evidence ? "증거 저장" : "포기 처리") {
                    if draft.mode == .evidence {
                        onSubmitEvidence(evidenceKind, locator, note)
                    } else {
                        onAbandon(abandonReason)
                    }
                }
                .keyboardShortcut(.defaultAction)
                .disabled(
                    draft.mode == .evidence
                        && locator.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                        && note.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
                )
            }
        }
        .padding(20)
        .frame(width: 460)
    }
}

// The interview-close commitment bar (PB-1). Owns its own draft state; submitting a
// commitment or a confession is delegated up so ContentView routes it through
// markDayStep -> the sidecar interview gate. Deterministic (no time/network), so it
// stays pixel-stable; it only renders when the live interview step is active.
private struct OfficeHoursCommitmentBarView: View {
    /// Soft guidance shown when the sidecar interview gate withheld a close (needsCommitment).
    /// nil in the normal case — the bar then renders without the nudge.
    var gateMessage: String? = nil
    /// Context-derived next-action candidates (≤3, deduped). The user selects one or types
    /// their own ("직접 적기"). Empty → only the custom field renders (founder decision:
    /// 후보 0개면 직접 적기만). The stored commitment is always the user's resolved text.
    var suggestedActions: [String] = []
    /// Prior consecutive deferrals ("N일째 미룸") — surfaced so a repeated deferral is named,
    /// not hidden. 0 hides the streak badge entirely.
    var deferralStreak: Int = 0
    /// Resolved next customer action (the selected candidate OR the typed custom line).
    let onCommit: (String) -> Void
    /// Confession reason for a deferral ("미룸").
    let onConfess: (String) -> Void

    @State private var selectedIndex: Int? = nil
    @State private var customDraft: String = ""
    @State private var deferring: Bool = false
    @State private var confessDraft: String = ""

    private var options: [String] { Array(suggestedActions.prefix(3)) }
    private var trimmedCustom: String { customDraft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var trimmedConfess: String { confessDraft.trimmingCharacters(in: .whitespacesAndNewlines) }
    private var customActive: Bool { !trimmedCustom.isEmpty }

    /// Single source of truth for the chosen action: a non-empty custom line always wins
    /// (typing visually deselects the candidates); otherwise the selected candidate.
    private var resolvedAction: String {
        if customActive { return trimmedCustom }
        if let i = selectedIndex, options.indices.contains(i) { return options[i] }
        return ""
    }
    private var canCommit: Bool { !resolvedAction.isEmpty }

    private func submitCommit() {
        let action = resolvedAction
        guard !action.isEmpty else { return }
        onCommit(action)
        selectedIndex = nil
        customDraft = ""
    }

    private func submitConfess() {
        onConfess(trimmedConfess.isEmpty ? "오늘은 못 함" : trimmedConfess)
        confessDraft = ""
        deferring = false
    }

    var body: some View {
        VStack(alignment: .leading, spacing: 11) {
            // 헤더는 forcing-question 카드의 언어를 미러링 — 닫기 게이트가 '분리된 바닥 바'가
            // 아니라 인터뷰 흐름의 마지막 단계 카드로 읽히게 한다.
            HStack(spacing: 8) {
                Text("마지막 단계")
                    .font(.system(size: 10, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                    .tracking(1.2)
                    .textCase(.uppercase)
                Spacer(minLength: 0)
                Text("약속")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                    .padding(.horizontal, 8)
                    .frame(height: 20)
                    .background(Capsule().fill(OpenDesignOfficeHoursColor.amberDim))
                    .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.amber.opacity(0.40), lineWidth: 1))
            }
            if deferring {
                deferZone
                    .transition(.opacity)
            } else {
                commitZone
                    .transition(.opacity)
            }
        }
        .padding(.horizontal, 20)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(
                    LinearGradient(
                        colors: [OpenDesignOfficeHoursColor.surface, OpenDesignOfficeHoursColor.surface2],
                        startPoint: .top,
                        endPoint: .bottom
                    )
                )
        )
        .overlay(alignment: .leading) {
            // 좌측 바는 amber + 글로우 제거 — 카드 틀은 질문과 같되 '질문 아님, 마무리'를
            // 색으로 신호한다(forcing-question의 초록 accent·글로우와 구분).
            Rectangle()
                .fill(OpenDesignOfficeHoursColor.amber)
                .frame(width: 3)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .stroke(OpenDesignOfficeHoursColor.border, lineWidth: 1)
        }
        .animation(.easeInOut(duration: 0.28), value: deferring)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("opendesign.officeHours.commitmentBar")
    }

    // 약속 모드: 후보 3개(선택) + 직접 적기 + 약속 버튼 + 미룸 링크.
    @ViewBuilder
    private var commitZone: some View {
        VStack(alignment: .leading, spacing: 11) {
            Text("다음 한 가지 고객 행동을 약속해줘.")
                .font(.system(size: 13.5, weight: .semibold))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                .fixedSize(horizontal: false, vertical: true)
            if let gateMessage, !gateMessage.isEmpty {
                // The gate held a close: a soft, non-blocking nudge (not an error).
                HStack(alignment: .top, spacing: 6) {
                    Image(systemName: "hand.raised.fill")
                        .font(.system(size: 11))
                        .foregroundStyle(Agentic30BrandColor.green)
                    Text(gateMessage)
                        .font(.system(size: 11))
                        .foregroundStyle(.secondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .accessibilityIdentifier("opendesign.officeHours.commitmentGateNudge")
            }
            VStack(alignment: .leading, spacing: 7) {
                ForEach(Array(options.enumerated()), id: \.offset) { index, text in
                    actionOption(index, text)
                }
                customRow
            }
            Text("✦ 후보는 직전 인터뷰에서 자동 제안 · 고르거나 직접 적어도 돼")
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
            Button("약속하고 닫기", action: submitCommit)
                .buttonStyle(.borderedProminent)
                .tint(Agentic30BrandColor.green)
                .frame(maxWidth: .infinity)
                .disabled(!canCommit)
                .accessibilityIdentifier("opendesign.officeHours.commitButton")
            Button(deferralStreak > 0
                   ? "오늘은 약속 못 해 — 미룸으로 닫기 (이미 \(deferralStreak)일째)"
                   : "오늘은 약속 못 해 — 미룸으로 닫기") {
                withAnimation(.easeInOut(duration: 0.28)) { deferring = true }
            }
            .buttonStyle(.plain)
            .font(.system(size: 11))
            .foregroundStyle(deferralStreak > 0 ? OpenDesignOfficeHoursColor.amber : OpenDesignOfficeHoursColor.muted)
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("opendesign.officeHours.commitmentDeferLink")
        }
    }

    // 미룸 모드: 선택지가 접히고 사유 한 줄 + 미룸 버튼 + 다시 약속하기만.
    @ViewBuilder
    private var deferZone: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 8) {
                Text("오늘은 미룸")
                    .font(.system(size: 13.5, weight: .semibold))
                    .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                if deferralStreak > 0 {
                    // 연속 미룸을 직시시킨다 — 또 미루면 이번이 (deferralStreak + 1)번째.
                    Text("⏱ \(deferralStreak + 1)일째 미룸")
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.amber)
                        .padding(.horizontal, 7)
                        .frame(height: 18)
                        .background(Capsule().fill(OpenDesignOfficeHoursColor.amberDim))
                        .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.amber.opacity(0.40), lineWidth: 1))
                }
                Spacer(minLength: 0)
            }
            TextField("못 한 이유를 한 줄로 (정직하게)", text: $confessDraft)
                .textFieldStyle(.roundedBorder)
                .font(.system(size: 12))
                .onSubmit(submitConfess)
                .accessibilityIdentifier("opendesign.officeHours.confessField")
            Button("미룸으로 닫기", action: submitConfess)
                .buttonStyle(.borderedProminent)
                .tint(OpenDesignOfficeHoursColor.amber)
                .frame(maxWidth: .infinity)
                .accessibilityIdentifier("opendesign.officeHours.confessButton")
            Button("← 다시 약속하기") {
                withAnimation(.easeInOut(duration: 0.28)) { deferring = false }
            }
            .buttonStyle(.plain)
            .font(.system(size: 11))
            .foregroundStyle(.secondary)
            .frame(maxWidth: .infinity)
            .accessibilityIdentifier("opendesign.officeHours.commitmentDeferBack")
        }
    }

    // 후보 행 — office-hours 질문 카드의 옵션 idiom 재사용(officeHoursOptionRowSurface).
    @ViewBuilder
    private func actionOption(_ index: Int, _ text: String) -> some View {
        let isSel = (selectedIndex == index) && !customActive
        Button {
            selectedIndex = isSel ? nil : index
            customDraft = "" // 후보 선택 시 직접 입력 비움(상호배타)
        } label: {
            HStack(spacing: 11) {
                Image(systemName: isSel ? "largecircle.fill.circle" : "circle")
                    .font(.system(size: 14))
                    .foregroundStyle(isSel ? OpenDesignOfficeHoursColor.accent : OpenDesignOfficeHoursColor.mutedDeep)
                Text(text)
                    .font(.system(size: 13, weight: isSel ? .medium : .regular))
                    .foregroundStyle(isSel ? OpenDesignOfficeHoursColor.fg : OpenDesignOfficeHoursColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
                    .frame(maxWidth: .infinity, alignment: .leading)
                if index == 0 {
                    Text("추천")
                        .font(.system(size: 9, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignOfficeHoursColor.accent)
                        .padding(.horizontal, 6)
                        .padding(.vertical, 1)
                        .background(Capsule().fill(OpenDesignOfficeHoursColor.accentDim))
                        .overlay(Capsule().stroke(OpenDesignOfficeHoursColor.accentLine, lineWidth: 1))
                }
            }
            .padding(.horizontal, 12)
            .padding(.vertical, 10)
            .frame(maxWidth: .infinity, alignment: .leading)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .officeHoursOptionRowSurface(selected: isSel)
        .accessibilityIdentifier("opendesign.officeHours.commitmentOption.\(index)")
    }

    // "직접 적기" 입력 — 항상 보이는 입력 행(후보가 없어도 이걸로 약속 가능).
    @ViewBuilder
    private var customRow: some View {
        HStack(spacing: 10) {
            Image(systemName: "pencil")
                .font(.system(size: 12))
                .foregroundStyle(OpenDesignOfficeHoursColor.mutedDeep)
            TextField("직접 적기…", text: $customDraft)
                .textFieldStyle(.plain)
                .font(.system(size: 13))
                .foregroundStyle(OpenDesignOfficeHoursColor.fg)
                .onSubmit(submitCommit)
                .accessibilityIdentifier("opendesign.officeHours.commitmentCustomField")
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 10)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(OpenDesignOfficeHoursColor.bgDeep))
        .overlay(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .stroke(customActive ? OpenDesignOfficeHoursColor.accentLine : OpenDesignOfficeHoursColor.borderSoft, lineWidth: 1)
        )
    }
}

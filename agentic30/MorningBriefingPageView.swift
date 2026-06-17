import AppKit
import SwiftUI

nonisolated enum MorningBriefingColdLoadKind: Hashable {
    case none
    case loading
    case error
}

nonisolated struct MorningBriefingColdLoadPresentation: Hashable {
    let kind: MorningBriefingColdLoadKind
    let rows: [MorningBriefingLoadingRow]
    let detail: String?
}

nonisolated struct MorningBriefingLoadingRow: Hashable, Identifiable {
    let id: String
    let title: String
    let state: String
    let detail: String?
    let logLines: [String]
}

nonisolated func morningBriefingColdLoadPresentation(
    briefing: MorningBriefing?,
    collecting: Bool,
    status: MorningBriefingStatus?,
    sourceProgress: [String: MorningBriefingSourceProgress]
) -> MorningBriefingColdLoadPresentation {
    if briefing?.status?.state == "failed",
       briefing?.cards?.isEmpty ?? true {
        return MorningBriefingColdLoadPresentation(
            kind: .error,
            rows: morningBriefingLoadingRows(sourceProgress: sourceProgress),
            detail: briefing?.status?.detail
        )
    }
    if briefing == nil && status?.state == "failed" {
        return MorningBriefingColdLoadPresentation(
            kind: .error,
            rows: morningBriefingLoadingRows(sourceProgress: sourceProgress),
            detail: status?.detail
        )
    }
    if briefing == nil && collecting {
        return MorningBriefingColdLoadPresentation(
            kind: .loading,
            rows: morningBriefingLoadingRows(sourceProgress: sourceProgress),
            detail: nil
        )
    }
    return MorningBriefingColdLoadPresentation(kind: .none, rows: [], detail: nil)
}

nonisolated func morningBriefingLoadingRows(
    sourceProgress: [String: MorningBriefingSourceProgress]
) -> [MorningBriefingLoadingRow] {
    if sourceProgress.isEmpty {
        return ["cloudflare", "github", "posthog"].map { id in
            MorningBriefingLoadingRow(
                id: id,
                title: morningBriefingSourceTitle(id),
                state: "waiting",
                detail: "대기 중",
                logLines: []
            )
        }
    }

    return sourceProgress.values
        .sorted { lhs, rhs in
            let lhsOrder = morningBriefingSourceOrder(lhs.id)
            let rhsOrder = morningBriefingSourceOrder(rhs.id)
            if lhsOrder == rhsOrder { return lhs.id < rhs.id }
            return lhsOrder < rhsOrder
        }
        .map { progress in
            MorningBriefingLoadingRow(
                id: progress.id,
                title: morningBriefingSourceTitle(progress.id),
                state: progress.state ?? "waiting",
                detail: progress.detail,
                logLines: progress.logLines ?? []
            )
        }
}

nonisolated private func morningBriefingSourceOrder(_ id: String) -> Int {
    switch id {
    case "cloudflare": return 0
    case "github": return 1
    case "posthog": return 2
    default: return 100
    }
}

nonisolated private func morningBriefingSourceTitle(_ id: String) -> String {
    switch id {
    case "cloudflare": return "Cloudflare"
    case "github": return "GitHub"
    case "posthog": return "PostHog"
    default: return id
    }
}

/// Morning briefing screen (OD reference: agentic30-morning-briefing.html).
/// Rendered inside OpenDesignDayShell to the right of the rail; owns its own
/// three-column layout (section nav / main scroll / meta panel) using the
/// OpenDesignDayColor token palette.
struct MorningBriefingPageView: View {
    let briefing: MorningBriefing?
    let previousBriefing: MorningBriefing?
    let collecting: Bool
    let status: MorningBriefingStatus?
    /// 수집 중 카드별 라이브 진행(카드 id → 스피너 상태 + 에이전트 로그).
    let sourceProgress: [String: MorningBriefingSourceProgress]
    let fallbackDay: Int
    let refresh: () -> Void
    let prepare: () -> Void
    let submitAnomalyLabel: (String) -> Void
    let applyAction: (MorningBriefingActionDraft) -> Void
    let startToday: () -> Void
    private let routeScrollRequest: Binding<MorningBriefingScrollRequest?>

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var pickedAnomalyOptionID: String?
    @State private var customAnomalyLabel = ""
    @State private var presentedDrilldownID: String?
    @State private var appliedActionIDs: Set<String> = []
    @State private var copiedActionIDs: Set<String> = []
    @State private var activeSectionID = "summary"
    @State private var sectionScrollRequest: MorningBriefingScrollRequest?
    @State private var toastText: String?
    @State private var toastDismissTask: Task<Void, Never>?
    @State private var viewingPrevious = false

    init(
        briefing: MorningBriefing?,
        previousBriefing: MorningBriefing?,
        collecting: Bool,
        status: MorningBriefingStatus? = nil,
        sourceProgress: [String: MorningBriefingSourceProgress],
        fallbackDay: Int,
        refresh: @escaping () -> Void,
        prepare: @escaping () -> Void,
        submitAnomalyLabel: @escaping (String) -> Void,
        applyAction: @escaping (MorningBriefingActionDraft) -> Void,
        startToday: @escaping () -> Void,
        routeScrollRequest: Binding<MorningBriefingScrollRequest?> = .constant(nil)
    ) {
        self.briefing = briefing
        self.previousBriefing = previousBriefing
        self.collecting = collecting
        self.status = status
        self.sourceProgress = sourceProgress
        self.fallbackDay = fallbackDay
        self.refresh = refresh
        self.prepare = prepare
        self.submitAnomalyLabel = submitAnomalyLabel
        self.applyAction = applyAction
        self.startToday = startToday
        self.routeScrollRequest = routeScrollRequest
    }

    /// The payload the screen renders: today's briefing, or — in "어제 브리핑"
    /// mode — the persisted previous-day briefing (read-only).
    private var displayBriefing: MorningBriefing? {
        viewingPrevious ? (previousBriefing ?? briefing) : briefing
    }

    private var effectiveStatus: MorningBriefingStatus? {
        viewingPrevious ? displayBriefing?.status : (status ?? displayBriefing?.status)
    }

    private var day: Int { displayBriefing?.day ?? fallbackDay }
    private var totalDays: Int { displayBriefing?.totalDays ?? 30 }
    private var isLocked: Bool { displayBriefing?.status?.state == "locked" }
    private var isCollectingWithoutBriefing: Bool { displayBriefing == nil && collecting }
    private var showsRefreshFailureNotice: Bool {
        displayBriefing?.status?.state == "failed"
            && !(displayBriefing?.cards?.isEmpty ?? true)
            && !viewingPrevious
    }
    private var coldLoadPresentation: MorningBriefingColdLoadPresentation {
        morningBriefingColdLoadPresentation(
            briefing: displayBriefing,
            collecting: collecting,
            status: effectiveStatus,
            sourceProgress: sourceProgress
        )
    }
    private var runningTimingLabel: String? {
        guard collecting, !viewingPrevious else { return nil }
        return openDesignRefreshRunningTimingLabel(effectiveStatus?.elapsedMs)
    }
    private var completedTimingLabel: String? {
        guard !collecting, !viewingPrevious else { return nil }
        return openDesignRefreshCompletedTimingLabel(effectiveStatus?.durationMs ?? effectiveStatus?.elapsedMs)
    }
    private var failedTimingLabel: String? {
        guard !collecting, !viewingPrevious,
              effectiveStatus?.state == "failed" else {
            return nil
        }
        return openDesignRefreshFailedTimingLabel(effectiveStatus?.durationMs ?? effectiveStatus?.elapsedMs)
    }
    private var lastSyncTimingLabel: String? {
        if effectiveStatus?.state == "failed" {
            return failedTimingLabel
        }
        return completedTimingLabel
    }
    private var phaseLabel: String {
        if let phase = displayBriefing?.phase, !phase.isEmpty { return phase }
        return AgenticCurriculumDay.days.first(where: { $0.day == day })?.phase.title ?? ""
    }

    private struct SectionEntry: Identifiable {
        let id: String
        let title: String
        let meta: String
        let tone: Tone

        enum Tone { case accent, amber, rose, ring }
    }

    private struct TimelineDayBadge {
        let label: String
        let foreground: Color
        let background: Color
        let border: Color
    }

    private var sections: [SectionEntry] {
        var entries: [SectionEntry] = [
            SectionEntry(id: "summary", title: "오늘의 판정", meta: verdictStateLabel, tone: .accent),
            SectionEntry(id: "sources", title: "소스 근거", meta: "Cloudflare · GitHub · PostHog", tone: .accent),
        ]
        if hasEvidenceFunnel {
            entries.append(SectionEntry(id: "funnel", title: "증거 퍼널", meta: "방문 → 검증 행동 → 결제", tone: .accent))
        }
        entries.append(SectionEntry(id: "timeline", title: "밤사이 타임라인", meta: timelineSectionMeta, tone: .ring))
        entries.append(SectionEntry(id: "actions", title: "오늘 검증 액션", meta: actionsSectionMeta, tone: .amber))
        if displayBriefing?.anomaly != nil {
            entries.append(SectionEntry(id: "anomaly", title: "이상 신호 확인", meta: "1건", tone: .rose))
        }
        return entries
    }

    private var hasEvidenceFunnel: Bool {
        !(displayBriefing?.evidenceFunnel?.steps ?? []).isEmpty
    }

    private var hasRenderableVerdict: Bool {
        displayBriefing?.customerEvidenceVerdict?.isRenderable == true
    }

    private var verdictStateLabel: String {
        switch displayBriefing?.customerEvidenceVerdict?.state {
        case "traffic_without_activation": return "방문 대비 검증 행동"
        case "build_without_customer_evidence": return "빌드 대비 고객 증거"
        case "instrumentation_gap": return "계측 공백"
        case "healthy": return "증거 관측"
        default: return "검증 판단"
        }
    }

    private var actionsSectionMeta: String {
        if let primary = primaryActionDraft?.badge, !primary.isEmpty {
            return "오늘 먼저 · \(primary)"
        }
        return "메시지 · 실험 · 태스크"
    }

    private var primaryActionDraft: MorningBriefingActionDraft? {
        guard let primaryId = displayBriefing?.customerEvidenceVerdict?.primaryActionId else { return nil }
        return displayBriefing?.actions?.first(where: { $0.id == primaryId })
    }

    private var yesterdaySectionMeta: String {
        let crits = displayBriefing?.summary?.crits ?? []
        let up = crits.first(where: { $0.direction == "up" })
        let down = crits.first(where: { $0.direction == "down" })
        var parts: [String] = []
        if let up, let label = up.label { parts.append("▲ \(label)") }
        if let down, let label = down.label { parts.append("▼ \(label)") }
        return parts.isEmpty ? "어제 대비 변화" : parts.joined(separator: " · ")
    }

    private var timelineSectionMeta: String {
        let events = displayBriefing?.timeline ?? []
        guard let first = events.first?.timeLabel, let last = events.last?.timeLabel, events.count > 1 else {
            return "\(events.count)건"
        }
        return "\(first) → \(last) · \(events.count)건"
    }

    var body: some View {
        GeometryReader { geometry in
            let showsNav = geometry.size.width >= 900
            let showsMeta = geometry.size.width >= 1120

            ZStack(alignment: .bottom) {
                if let drilldownID = presentedDrilldownID,
                   let drilldown = displayBriefing?.drilldowns?[drilldownID] {
                    MorningBriefingDrilldownView(
                        drilldown: drilldown,
                        briefing: displayBriefing,
                        day: day,
                        onSelectSource: { id in
                            withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.18)) {
                                presentedDrilldownID = id
                            }
                        },
                        onBack: {
                            withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.18)) {
                                presentedDrilldownID = nil
                            }
                        },
                        applyAction: applyAction,
                        showToast: { showToast($0) }
                    )
                } else {
                    HStack(spacing: 0) {
                        if showsNav {
                            sectionNav
                                .frame(width: 240)
                                .frame(maxHeight: .infinity)
                                .background(OpenDesignDayColor.bg)
                                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .trailing)
                        }

                        mainColumn
                            .frame(maxWidth: .infinity, maxHeight: .infinity)

                        if showsMeta {
                            metaPanel
                                .frame(width: 280)
                                .frame(maxHeight: .infinity)
                                .background(OpenDesignDayColor.bg)
                                .overlay(Rectangle().fill(OpenDesignDayColor.borderSoft).frame(width: 1), alignment: .leading)
                        }
                    }
                }

                if let toastText {
                    Text(toastText)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .padding(.horizontal, 14)
                        .padding(.vertical, 9)
                        .background(
                            Capsule()
                                .fill(OpenDesignDayColor.elevated)
                                .overlay(Capsule().stroke(OpenDesignDayColor.border, lineWidth: 1))
                        )
                        .padding(.bottom, 22)
                        .transition(.opacity.combined(with: .move(edge: .bottom)))
                        .accessibilityIdentifier("morningBriefing.toast")
                }
            }
        }
        .background(OpenDesignDayColor.bg)
        .onAppear {
            pickedAnomalyOptionID = nil
            customAnomalyLabel = ""
            viewingPrevious = false
            prepare()
        }
        .onChange(of: viewingPrevious) { _, _ in
            pickedAnomalyOptionID = nil
            customAnomalyLabel = ""
            presentedDrilldownID = nil
            activeSectionID = "summary"
        }
        .onChange(of: routeScrollRequest.wrappedValue) { _, request in
            guard let request else { return }
            viewingPrevious = false
            presentedDrilldownID = nil
            activeSectionID = request.id
            sectionScrollRequest = request
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.screen")
    }

    // MARK: - Left section nav

    private var sectionNav: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text("오늘 아침")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("Day \(day)")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .padding(.horizontal, 6)
                    .padding(.vertical, 1)
                    .background(Capsule().fill(OpenDesignDayColor.surface))
                Spacer()
            }
            .padding(.horizontal, 12)
            .frame(height: 40)

            ScrollView {
                VStack(alignment: .leading, spacing: 2) {
                    groupLabel("이 브리핑", trailing: displayBriefing?.sync?.syncedAtLabel.map { "오늘 \($0)" } ?? "")

                    if isCollectingWithoutBriefing {
                        collectingNavPlaceholder
                    } else {
                        ForEach(sections) { section in
                            sectionNavRow(section)
                        }

                        if let entries = displayBriefing?.historyEntries, !entries.isEmpty {
                            groupLabel("지난 브리핑", trailing: "")
                            ForEach(entries) { entry in
                                pastBriefingRow(entry)
                            }
                        } else if let dates = displayBriefing?.historyDates, !dates.isEmpty {
                            groupLabel("지난 브리핑", trailing: "")
                            ForEach(dates, id: \.self) { date in
                                pastBriefingRow(MorningBriefingHistoryEntry(date: date))
                            }
                        }
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 12)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.nav")
    }

    private var collectingNavPlaceholder: some View {
        HStack(alignment: .top, spacing: 9) {
            OpenDesignInlineSpinner(accessibilityLabel: "신호 수집 중")
                .frame(width: 14, height: 14)
                .padding(.top, 3)
                .accessibilityIdentifier("morningBriefing.nav.collecting.spinner")

            VStack(alignment: .leading, spacing: 2) {
                Text("신호 수집 중")
                    .font(.system(size: 12.5, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .lineLimit(1)
                Text("요약이 준비되면 섹션 표시")
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .frame(maxWidth: .infinity, alignment: .leading)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("morningBriefing.nav.collecting")
    }

    private func groupLabel(_ title: String, trailing: String) -> some View {
        HStack {
            Text(title.uppercased())
            Spacer()
            Text(trailing)
                .foregroundStyle(OpenDesignDayColor.muted)
        }
        .font(.system(size: 10, design: .monospaced))
        .kerning(1.0)
        .foregroundStyle(OpenDesignDayColor.mutedDeep)
        .padding(.horizontal, 8)
        .padding(.top, 14)
        .padding(.bottom, 6)
    }

    private func sectionNavRow(_ section: SectionEntry) -> some View {
        Button {
            withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.15)) {
                activeSectionID = section.id
            }
            sectionScrollRequest = MorningBriefingScrollRequest(id: section.id)
        } label: {
            HStack(alignment: .top, spacing: 9) {
                Group {
                    switch section.tone {
                    case .accent:
                        navDot(OpenDesignDayColor.accent)
                    case .amber:
                        navDot(OpenDesignDayColor.amber)
                    case .rose:
                        navDot(OpenDesignDayColor.rose)
                    case .ring:
                        Circle()
                            .stroke(OpenDesignDayColor.mutedDeep, lineWidth: 1.5)
                            .frame(width: 11, height: 11)
                    }
                }
                .frame(width: 14, height: 14)
                .padding(.top, 3)

                VStack(alignment: .leading, spacing: 2) {
                    Text(section.title)
                        .font(.system(size: 12.5, weight: .medium))
                        .lineLimit(1)
                    Text(section.meta)
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(activeSectionID == section.id ? OpenDesignDayColor.selected : Color.clear)
            )
            .foregroundStyle(activeSectionID == section.id ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("morningBriefing.nav.\(section.id)")
    }

    private func navDot(_ color: Color) -> some View {
        Circle()
            .fill(color)
            .frame(width: 8, height: 8)
            .background(Circle().fill(color.opacity(0.18)).frame(width: 14, height: 14))
    }

    /// The local date the persisted previous-day briefing was generated —
    /// the one "지난 브리핑" row that is actually viewable in-app.
    private var previousBriefingDate: String? {
        guard let generatedAt = previousBriefing?.generatedAt, generatedAt.count >= 10 else { return nil }
        return String(generatedAt.prefix(10))
    }

    private func pastBriefingRow(_ entry: MorningBriefingHistoryEntry) -> some View {
        let isViewable = entry.date == previousBriefingDate && !viewingPrevious
        let row = HStack(alignment: .top, spacing: 9) {
            Circle()
                .stroke(OpenDesignDayColor.mutedDeep, lineWidth: 1.5)
                .frame(width: 11, height: 11)
                .padding(.top, 3)
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.title?.isEmpty == false ? entry.title! : "아침 브리핑")
                    .font(.system(size: 12.5, weight: .medium))
                    .lineLimit(1)
                HStack(spacing: 6) {
                    if let day = entry.day {
                        Text("Day \(day)")
                            .foregroundStyle(OpenDesignDayColor.accent)
                        Text("·")
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    }
                    Text(entry.date)
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
                .font(.system(size: 10.5, design: .monospaced))
            }
            Spacer(minLength: 0)
        }
        .padding(.horizontal, 10)
        .padding(.vertical, 8)
        .foregroundStyle(OpenDesignDayColor.fgSecondary)
        .opacity(0.66)

        return Group {
            if isViewable {
                Button {
                    withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.18)) {
                        viewingPrevious = true
                    }
                } label: {
                    row.contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("morningBriefing.nav.past.\(entry.date)")
            } else {
                row
            }
        }
    }

    // MARK: - Main column

    private var mainColumn: some View {
        VStack(spacing: 0) {
            mainHeader
            Divider().overlay(OpenDesignDayColor.borderSoft)
            if coldLoadPresentation.kind == .none {
                syncBar
                Divider().overlay(OpenDesignDayColor.borderSoft)
            }

            if isLocked {
                lockedState
            } else if coldLoadPresentation.kind == .loading {
                collectingState(coldLoadPresentation)
            } else if coldLoadPresentation.kind == .error {
                loadingErrorState(coldLoadPresentation)
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            if showsRefreshFailureNotice {
                                refreshFailureNotice
                            }

                            sectionHeading(id: "summary", title: "오늘의 판정", meta: windowMetaLabel, markerColor: OpenDesignDayColor.accent)
                            if hasRenderableVerdict {
                                verdictCard
                            } else {
                                summaryCard
                            }

                            sectionHeading(id: "sources", title: "소스 근거 · 어제 대비", meta: "판정 아래 원자료", markerColor: OpenDesignDayColor.accent)
                            sourceCardsGrid

                            if let guide = displayBriefing?.connectGuide {
                                connectGuideCard(guide)
                            }

                            if hasEvidenceFunnel {
                                sectionHeading(id: "funnel", title: "증거 퍼널", meta: "방문 → 다운로드/설치 → 검증 행동", markerColor: OpenDesignDayColor.accent)
                                evidenceFunnelCard
                            }

                            sectionHeading(id: "timeline", title: "밤사이 타임라인", meta: "자동 수집 · 사람 개입 0", markerColor: OpenDesignDayColor.amber)
                            timelineList

                            sectionHeading(id: "actions", title: "오늘 검증 액션 · \(displayBriefing?.actions?.count ?? 0)", meta: "요약을 넘어 바로 쓸 수 있게 — 검토 후 적용", markerColor: OpenDesignDayColor.amber)
                            actionDrafts

                            if let anomaly = displayBriefing?.anomaly {
                                sectionHeading(id: "anomaly", title: "이상 신호 · 확인 1건", meta: "평소엔 요약만, 이상할 때만 물어봄", markerColor: OpenDesignDayColor.rose)
                                anomalyPicker(anomaly)
                            }

                            Spacer(minLength: 40)
                        }
                        .frame(maxWidth: 860)
                        .frame(maxWidth: .infinity)
                        .padding(.horizontal, 28)
                        .padding(.top, 22)
                    }
                    .coordinateSpace(name: "morningBriefingScroll")
                    .onChange(of: sectionScrollRequest) { _, request in
                        guard let request else { return }
                        withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.25)) {
                            proxy.scrollTo(request.id, anchor: .top)
                        }
                    }
                    // Scroll spy (briefing.html IntersectionObserver): the left
                    // nav highlight follows manual scrolling.
                    .onPreferenceChange(MorningBriefingSectionOffsetKey.self) { offsets in
                        guard !offsets.isEmpty else { return }
                        let passed = offsets.filter { $0.value <= 90 }
                        let spyID = passed.max(by: { $0.value < $1.value })?.key
                            ?? offsets.min(by: { $0.value < $1.value })?.key
                        if let spyID, spyID != activeSectionID {
                            activeSectionID = spyID
                        }
                    }
                }
            }
        }
        .background(OpenDesignDayColor.bg)
    }

    private var windowMetaLabel: String {
        displayBriefing?.summary?.windowLabel ?? ""
    }

    private var refreshFailureNotice: some View {
        HStack(alignment: .top, spacing: 10) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 12, weight: .bold))
                .foregroundStyle(OpenDesignDayColor.rose)
                .frame(width: 18, height: 18)

            VStack(alignment: .leading, spacing: 3) {
                Text("이번 동기화는 완료하지 못했습니다")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(displayBriefing?.status?.detail ?? "이전 브리핑을 표시 중입니다. 소스 상태를 확인한 뒤 다시 동기화하세요.")
                    .font(.system(size: 11.5))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }

            Spacer(minLength: 0)
        }
        .padding(.horizontal, 13)
        .padding(.vertical, 11)
        .background(
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(OpenDesignDayColor.roseDim.opacity(0.72))
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(OpenDesignDayColor.roseLine, lineWidth: 1)
                )
        )
        .padding(.bottom, 2)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("morningBriefing.staleNotice")
    }

    private var mainHeader: some View {
        HStack(spacing: 14) {
            Text("\(day)")
                .font(.system(size: 17, weight: .bold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.accent)
                .frame(width: 44, height: 44)
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(OpenDesignDayColor.accent.opacity(0.14))
                        .overlay(
                            RoundedRectangle(cornerRadius: 11, style: .continuous)
                                .stroke(OpenDesignDayColor.accent.opacity(0.4), lineWidth: 1)
                        )
                )

            VStack(alignment: .leading, spacing: 2) {
                Text("오늘 아침 브리핑")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                HStack(spacing: 8) {
                    Circle().fill(OpenDesignDayColor.accent).frame(width: 5, height: 5)
                    Text("Day \(day) / \(totalDays)\(phaseLabel.isEmpty ? "" : " · \(phaseLabel)")")
                    Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                    Text("소스 \(displayBriefing?.sync?.readyCount ?? 0) 연결됨")
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    if collecting {
                        Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("동기화 중")
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        if let runningTimingLabel {
                            Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                            Text(runningTimingLabel)
                        }
                    } else if let synced = displayBriefing?.sync?.syncedAtLabel {
                        Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("\(synced) 동기화")
                        if let lastSyncTimingLabel {
                            Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                            Text(lastSyncTimingLabel)
                        }
                    }
                    if displayBriefing?.anomaly != nil {
                        Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("이상 신호 1")
                            .foregroundStyle(OpenDesignDayColor.rose)
                    }
                }
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .lineLimit(1)
            }

            Spacer()

            if previousBriefing != nil || viewingPrevious {
                Button {
                    withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.18)) {
                        viewingPrevious.toggle()
                    }
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: viewingPrevious ? "arrow.uturn.forward" : "clock.arrow.circlepath")
                            .font(.system(size: 10, weight: .semibold))
                        Text(viewingPrevious ? "오늘 브리핑" : "어제 브리핑")
                    }
                    .font(.system(size: 11.5))
                    .foregroundStyle(viewingPrevious ? OpenDesignDayColor.accent : OpenDesignDayColor.fgSecondary)
                    .padding(.horizontal, 12)
                    .frame(height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(viewingPrevious ? OpenDesignDayColor.accent.opacity(0.4) : OpenDesignDayColor.borderSoft, lineWidth: 1)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("morningBriefing.togglePrevious")
            }

            Button(action: refresh) {
                HStack(spacing: 6) {
                    if collecting {
                        OpenDesignInlineSpinner(accessibilityLabel: "동기화 진행 중")
                            .accessibilityIdentifier("morningBriefing.refresh.spinner")
                    } else {
                        Image(systemName: "arrow.clockwise")
                            .font(.system(size: 10, weight: .semibold))
                    }
                    Text(collecting ? "동기화 중…" : "다시 동기화")
                }
                .font(.system(size: 11.5))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .padding(.horizontal, 12)
                .frame(height: 28)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
                .contentShape(Rectangle())
            }
            .buttonStyle(.plain)
            .disabled(collecting || viewingPrevious)
            .accessibilityIdentifier("morningBriefing.refresh")
        }
        .padding(.horizontal, 28)
        .frame(height: 70)
    }

    // MARK: - Sync bar

    private var syncBar: some View {
        HStack(spacing: 8) {
            ForEach(displayBriefing?.sync?.sources ?? []) { source in
                syncPill(source)
            }
            Spacer(minLength: 8)
            HStack(spacing: 6) {
                Image(systemName: "clock")
                    .font(.system(size: 10))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                Text("지난 24시간")
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
        }
        .padding(.horizontal, 28)
        .frame(height: 50)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.syncbar")
    }

    private func syncPill(_ source: MorningBriefingSyncSource) -> some View {
        let color = syncPillColor(source.state)
        let label = syncPillStatusLabel(source.state)
        return HStack(spacing: 7) {
            Circle()
                .fill(color)
                .frame(width: 6, height: 6)
            Text(source.label ?? source.id)
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
            Text(label)
                .foregroundStyle(source.state == "ready" ? OpenDesignDayColor.fg : color)
                .fontWeight(.medium)
        }
        .font(.system(size: 10.5, design: .monospaced))
        .padding(.horizontal, 11)
        .padding(.vertical, 5)
        .background(
            Capsule()
                .fill(OpenDesignDayColor.surface)
                .overlay(Capsule().stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
        )
    }

    private func syncPillStatusLabel(_ state: String?) -> String {
        switch state {
        case "ready":
            return "연결됨"
        case "failed":
            return "수집 실패"
        default:
            return "미연결"
        }
    }

    private func syncPillColor(_ state: String?) -> Color {
        switch state {
        case "ready":
            return OpenDesignDayColor.accent
        case "failed":
            return OpenDesignDayColor.rose
        default:
            return OpenDesignDayColor.amber
        }
    }

    // MARK: - Connect guide (Day-1 upgrade path)

    /// Rendered while PostHog/Cloudflare MCP are not connected: today's briefing
    /// ran on git/GitHub signals, and connecting in Settings > Integrations
    /// upgrades tomorrow's briefing with traffic + retention signals.
    private func connectGuideCard(_ guide: MorningBriefingConnectGuide) -> some View {
        HStack(alignment: .top, spacing: 14) {
            Image(systemName: "antenna.radiowaves.left.and.right")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.amber)
                .frame(width: 30, height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(OpenDesignDayColor.amber.opacity(0.14))
                )

            VStack(alignment: .leading, spacing: 6) {
                Text(guide.title ?? "내일 브리핑 업그레이드")
                    .font(.system(size: 13, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                if let detail = guide.detail {
                    Text(detail)
                        .font(.system(size: 11.5))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let sources = guide.sources, !sources.isEmpty {
                    HStack(spacing: 8) {
                        ForEach(sources) { source in
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(OpenDesignDayColor.amber)
                                    .frame(width: 5, height: 5)
                                Text(source.label ?? source.id)
                                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                                if let benefit = source.benefit {
                                    Text(benefit)
                                        .foregroundStyle(OpenDesignDayColor.muted)
                                }
                            }
                            .font(.system(size: 10.5, design: .monospaced))
                            .padding(.horizontal, 10)
                            .padding(.vertical, 4)
                            .background(
                                Capsule()
                                    .fill(OpenDesignDayColor.surface)
                                    .overlay(Capsule().stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                            )
                        }
                    }
                    .padding(.top, 2)
                }
            }

            Spacer(minLength: 12)

            Button {
                openIntegrationsSettings(guide)
            } label: {
                Text("Settings에서 연결")
                    .font(.system(size: 11.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.bg)
                    .padding(.horizontal, 13)
                    .frame(height: 27)
                    .background(Capsule().fill(OpenDesignDayColor.amber))
                    .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("morningBriefing.connectGuide.openSettings")
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(OpenDesignDayColor.amber.opacity(0.35), lineWidth: 1)
                )
        )
        .padding(.top, 12)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.connectGuide")
    }

    private func openIntegrationsSettings(_ guide: MorningBriefingConnectGuide) {
        let section = guide.settingsSection ?? SettingsSection.integrations.rawValue
        NotificationCenter.default.post(
            name: .agenticOpenDesignSettingsRequested,
            object: nil,
            userInfo: [AgenticSettingsRouteNotification.sectionUserInfoKey: section]
        )
    }

    // MARK: - Section heading

    private func sectionHeading(id: String, title: String, meta: String, markerColor: Color) -> some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(markerColor)
                .frame(width: 4, height: 12)
            Text(title.uppercased())
                .font(.system(size: 11, design: .monospaced))
                .kerning(1.1)
                .foregroundStyle(OpenDesignDayColor.muted)
            Rectangle()
                .fill(OpenDesignDayColor.borderSoft)
                .frame(height: 1)
            if !meta.isEmpty {
                Text(meta)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
            }
        }
        .padding(.top, 26)
        .padding(.bottom, 12)
        .id(id)
        .background(
            GeometryReader { geo in
                Color.clear.preference(
                    key: MorningBriefingSectionOffsetKey.self,
                    value: [id: geo.frame(in: .named("morningBriefingScroll")).minY]
                )
            }
        )
    }

    // MARK: - Summary card

    private var summaryCard: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack {
                Text("OVERNIGHT DIGEST")
                    .font(.system(size: 10, design: .monospaced))
                    .kerning(1.2)
                    .foregroundStyle(OpenDesignDayColor.accent)
                Spacer()
            }
            .padding(.bottom, 9)

            Text(summaryStatement)
                .font(.system(size: 16, weight: .medium))
                .lineSpacing(6)
                .foregroundStyle(OpenDesignDayColor.fg)
                .fixedSize(horizontal: false, vertical: true)

            if let crits = displayBriefing?.summary?.crits, !crits.isEmpty {
                Divider()
                    .overlay(OpenDesignDayColor.borderSoft)
                    .padding(.vertical, 13)
                HStack(spacing: 16) {
                    ForEach(Array(crits.enumerated()), id: \.offset) { _, crit in
                        HStack(spacing: 7) {
                            Text(crit.source ?? "")
                                .foregroundStyle(OpenDesignDayColor.muted)
                            Text("\(crit.label ?? "") \(crit.value ?? "")")
                                .foregroundStyle(deltaColor(crit.direction))
                        }
                        .font(.system(size: 11, design: .monospaced))
                    }
                    Spacer()
                }
            }
        }
        .padding(EdgeInsets(top: 18, leading: 20, bottom: 18, trailing: 20))
        .background(
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(LinearGradient(colors: [OpenDesignDayColor.surface, OpenDesignDayColor.surface2], startPoint: .top, endPoint: .bottom))
                .overlay(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .stroke(OpenDesignDayColor.border, lineWidth: 1)
                )
        )
        .overlay(alignment: .leading) {
            RoundedRectangle(cornerRadius: 2)
                .fill(OpenDesignDayColor.accent)
                .frame(width: 3)
                .padding(.vertical, 1)
        }
        .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.summary")
    }

    private var verdictCard: some View {
        if let verdict = displayBriefing?.customerEvidenceVerdict,
           let title = verdict.renderableTitle,
           let body = verdict.renderableBody {
            let evidence = verdict.renderableEvidence
                .prefix(4)
            guard !evidence.isEmpty else { return AnyView(EmptyView()) }
            return AnyView(
                VStack(alignment: .leading, spacing: 14) {
                    HStack(alignment: .center, spacing: 10) {
                        Text("TODAY'S VERDICT")
                            .font(.system(size: 10, design: .monospaced))
                            .kerning(1.2)
                            .foregroundStyle(verdictColor(verdict.state))
                        Text(verdictStateLabel)
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(verdictColor(verdict.state))
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(
                                Capsule()
                                    .fill(verdictColor(verdict.state).opacity(0.13))
                                    .overlay(Capsule().stroke(verdictColor(verdict.state).opacity(0.35), lineWidth: 1))
                            )
                        Spacer()
                    }

                    Text(title)
                        .font(.system(size: 21, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .fixedSize(horizontal: false, vertical: true)

                    Text(body)
                        .font(.system(size: 13))
                        .lineSpacing(5)
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)

                    Divider().overlay(OpenDesignDayColor.borderSoft)
                    VStack(alignment: .leading, spacing: 7) {
                        ForEach(Array(evidence.enumerated()), id: \.offset) { _, line in
                            HStack(alignment: .firstTextBaseline, spacing: 8) {
                                Circle()
                                    .fill(verdictColor(verdict.state))
                                    .frame(width: 5, height: 5)
                                Text(line)
                                    .font(.system(size: 11.5, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                                    .fixedSize(horizontal: false, vertical: true)
                            }
                        }
                    }
                }
                .padding(EdgeInsets(top: 18, leading: 20, bottom: 18, trailing: 20))
                .background(
                    RoundedRectangle(cornerRadius: 14, style: .continuous)
                        .fill(OpenDesignDayColor.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: 14, style: .continuous)
                                .stroke(verdictColor(verdict.state).opacity(0.45), lineWidth: 1)
                        )
                )
                .overlay(alignment: .leading) {
                    RoundedRectangle(cornerRadius: 2)
                        .fill(verdictColor(verdict.state))
                        .frame(width: 3)
                        .padding(.vertical, 1)
                }
                .clipShape(RoundedRectangle(cornerRadius: 14, style: .continuous))
                .accessibilityElement(children: .contain)
                .accessibilityIdentifier("morningBriefing.verdict")
            )
        }
        return AnyView(EmptyView())
    }

    private var evidenceFunnelCard: some View {
        let steps = displayBriefing?.evidenceFunnel?.steps ?? []
        return VStack(alignment: .leading, spacing: 14) {
            LazyVGrid(columns: [GridItem(.adaptive(minimum: 128, maximum: 190), spacing: 10)], alignment: .leading, spacing: 10) {
                ForEach(steps) { step in
                    evidenceFunnelStep(step)
                }
            }

            if let primary = primaryActionDraft {
                Divider().overlay(OpenDesignDayColor.borderSoft)
                HStack(spacing: 9) {
                    Image(systemName: "arrow.right.circle.fill")
                        .font(.system(size: 13))
                        .foregroundStyle(OpenDesignDayColor.accent)
                    Text("다음 판단은 \(primary.title ?? "오늘 검증 액션")에서 시작합니다.")
                        .font(.system(size: 11.5, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    Spacer(minLength: 0)
                }
            }
        }
        .padding(16)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.evidenceFunnel")
    }

    private func evidenceFunnelStep(_ step: MorningBriefingEvidenceFunnelStep) -> some View {
        let color = funnelStatusColor(step.status)
        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 7) {
                Circle()
                    .fill(color)
                    .frame(width: 8, height: 8)
                Text(step.source ?? "")
                    .font(.system(size: 9.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(1)
                Spacer(minLength: 0)
            }
            Text(step.label ?? step.id)
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Text(step.valueLabel ?? "미계측")
                .font(.system(size: 18, weight: .semibold, design: .monospaced))
                .foregroundStyle(step.status == "missing" ? OpenDesignDayColor.rose : OpenDesignDayColor.fg)
                .lineLimit(1)
                .minimumScaleFactor(0.8)
            Text(step.detail ?? "")
                .font(.system(size: 10))
                .foregroundStyle(OpenDesignDayColor.muted)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 0)
        }
        .padding(12)
        .frame(minHeight: 124, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(OpenDesignDayColor.bgDarker)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(color.opacity(0.35), lineWidth: 1)
                )
        )
    }

    private func verdictColor(_ state: String?) -> Color {
        switch state {
        case "healthy": return OpenDesignDayColor.accent
        case "traffic_without_activation", "build_without_customer_evidence", "instrumentation_gap":
            return OpenDesignDayColor.amber
        default:
            return OpenDesignDayColor.accent
        }
    }

    private func funnelStatusColor(_ status: String?) -> Color {
        switch status {
        case "observed": return OpenDesignDayColor.accent
        case "missing": return OpenDesignDayColor.rose
        default: return OpenDesignDayColor.mutedDeep
        }
    }

    private func deltaColor(_ direction: String?) -> Color {
        switch direction {
        case "up": return OpenDesignDayColor.accent
        case "down": return OpenDesignDayColor.rose
        default: return OpenDesignDayColor.muted
        }
    }

    /// Statement with the briefing.html mark (rose) / em (accent) inline
    /// highlights applied from the sidecar-provided exact substrings.
    private var summaryStatement: AttributedString {
        let statement = displayBriefing?.summary?.statement ?? "밤사이 연결된 소스에서 큰 변화는 없었어요."
        var attributed = AttributedString(statement)
        for mark in displayBriefing?.summary?.statementMarks ?? [] {
            if let range = attributed.range(of: mark) {
                attributed[range].foregroundColor = OpenDesignDayColor.rose
                attributed[range].backgroundColor = OpenDesignDayColor.rose.opacity(0.14)
            }
        }
        for emphasis in displayBriefing?.summary?.statementEmphases ?? [] {
            if let range = attributed.range(of: emphasis) {
                attributed[range].foregroundColor = OpenDesignDayColor.accent
                attributed[range].backgroundColor = OpenDesignDayColor.accent.opacity(0.14)
            }
        }
        return attributed
    }

    // MARK: - Source cards

    private var sourceCardsGrid: some View {
        let cards = displayBriefing?.cards ?? []
        return LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], alignment: .leading, spacing: 10) {
            ForEach(cards) { card in
                sourceCard(card)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.sources")
    }

    private func normalizedSourceLogoID(_ id: String?) -> String {
        switch id {
        case "git", "gh_cli": return "github"
        default: return id ?? ""
        }
    }

    private func sourceLogoAssetName(_ id: String?) -> String? {
        switch normalizedSourceLogoID(id) {
        case "cloudflare": return "BrandCloudflare"
        case "github": return "BrandGitHub"
        case "posthog": return "BrandPostHog"
        default: return nil
        }
    }

    private func sourceLogoColor(_ id: String) -> Color {
        switch normalizedSourceLogoID(id) {
        case "cloudflare": return OpenDesignDayColor.amber
        case "posthog": return OpenDesignDayColor.violet
        default: return OpenDesignDayColor.fg
        }
    }

    private func sourceLogoSymbol(_ id: String) -> String {
        switch normalizedSourceLogoID(id) {
        case "cloudflare": return "cloud"
        case "posthog": return "chart.line.uptrend.xyaxis"
        default: return "chevron.left.forwardslash.chevron.right"
        }
    }

    private func sourceLogoTileFill(_ id: String) -> Color {
        switch normalizedSourceLogoID(id) {
        case "cloudflare": return OpenDesignDayColor.amber.opacity(0.13)
        case "posthog": return OpenDesignDayColor.violet.opacity(0.13)
        default: return OpenDesignDayColor.fg.opacity(0.09)
        }
    }

    @ViewBuilder
    private func sourceLogoMark(_ id: String, size: CGFloat, fallbackWeight: Font.Weight = .regular, fallbackColor: Color? = nil) -> some View {
        let normalizedID = normalizedSourceLogoID(id)
        if let assetName = sourceLogoAssetName(normalizedID) {
            Image(assetName)
                .resizable()
                .interpolation(.high)
                .scaledToFit()
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        } else {
            Image(systemName: sourceLogoSymbol(normalizedID))
                .font(.system(size: max(size * 0.58, 10), weight: fallbackWeight))
                .foregroundStyle(fallbackColor ?? sourceLogoColor(normalizedID))
                .frame(width: size, height: size)
                .accessibilityHidden(true)
        }
    }

    private func sourceLogoBadge(_ id: String, size: CGFloat = 24, corner: CGFloat = 7, showsBorder: Bool = true) -> some View {
        let normalizedID = normalizedSourceLogoID(id)
        return ZStack {
            RoundedRectangle(cornerRadius: corner, style: .continuous)
                .fill(sourceLogoTileFill(normalizedID))
                .overlay(
                    RoundedRectangle(cornerRadius: corner, style: .continuous)
                        .stroke(showsBorder ? sourceLogoColor(normalizedID).opacity(0.35) : Color.clear, lineWidth: 1)
                )
            sourceLogoMark(normalizedID, size: size * 0.72, fallbackWeight: .medium)
        }
        .frame(width: size, height: size)
    }

    private func sourceLogoInline(_ id: String, fallbackColor: Color? = nil) -> some View {
        sourceLogoMark(id, size: 16, fallbackColor: fallbackColor)
            .frame(width: 22)
    }

    private func sourceDisplayName(_ id: String?) -> String {
        switch normalizedSourceLogoID(id) {
        case "cloudflare": return "Cloudflare"
        case "posthog": return "PostHog"
        case "github": return "GitHub"
        default: return "Digest"
        }
    }

    private func sourceCard(_ card: MorningBriefingCard) -> some View {
        // 어제 브리핑(읽기 전용) 모드에서는 라이브 진행을 겹치지 않는다.
        let progress = viewingPrevious ? nil : sourceProgress[card.id]
        let isCollectingCard = progress?.isCollecting == true
        let isFailedCard = card.state == "failed"
        return VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 9) {
                sourceLogoBadge(card.id)
                VStack(alignment: .leading, spacing: 1) {
                    Text(card.label ?? card.id)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text(card.subtitle ?? "")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
                Spacer(minLength: 0)
                if !card.isReady && !isCollectingCard {
                    sourceCardStateBadge(card)
                }
            }

            if isCollectingCard, let progress {
                cardCollectingBody(progress)
            } else if card.isReady, let metric = card.metric {
                HStack(alignment: .firstTextBaseline, spacing: 9) {
                    Text(metricValueLabel(metric.value))
                        .font(.system(size: 30, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .monospacedDigit()
                    Text(metric.unit ?? "")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                    if let delta = metric.deltaLabel {
                        Text(delta)
                            .font(.system(size: 11, weight: .semibold, design: .monospaced))
                            .foregroundStyle(deltaColor(metric.direction))
                            .padding(.horizontal, 7)
                            .padding(.vertical, 2)
                            .background(
                                Capsule()
                                    .fill(deltaColor(metric.direction).opacity(0.13))
                                    .overlay(Capsule().stroke(deltaColor(metric.direction).opacity(0.35), lineWidth: 1))
                            )
                    }
                }

                if let versus = metric.versusLabel {
                    Text(versus)
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                }

                sparkline(card)

                if let rows = card.rows, !rows.isEmpty {
                    VStack(spacing: 5) {
                        ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                            HStack {
                                Text(row.k ?? "")
                                    .font(.system(size: 10.5, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                                Spacer()
                                Text(row.v ?? "")
                                    .font(.system(size: 11.5))
                                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            }
                        }
                    }
                }
            } else {
                HStack(alignment: .top, spacing: 8) {
                    if isFailedCard {
                        Image(systemName: "exclamationmark.triangle.fill")
                            .font(.system(size: 11, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.rose)
                    }
                    Text(card.note ?? "연결되지 않음")
                        .font(.system(size: 11.5))
                        .foregroundStyle(isFailedCard ? OpenDesignDayColor.rose : OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .frame(maxWidth: .infinity, alignment: .leading)
                .padding(.vertical, 12)
            }

            Spacer(minLength: 0)

            Divider().overlay(OpenDesignDayColor.borderSoft)
            sourceCardFooter(card, collecting: isCollectingCard)
        }
        .padding(EdgeInsets(top: 15, leading: 15, bottom: 13, trailing: 15))
        .frame(maxWidth: .infinity, minHeight: 200, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(sourceCardBorderColor(card), lineWidth: isFailedCard ? 1.25 : 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.card.\(card.id)")
    }

    private func sourceCardStateBadge(_ card: MorningBriefingCard) -> some View {
        let failed = card.state == "failed"
        return Text(failed ? "수집 실패" : "미연결")
            .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
            .foregroundStyle(failed ? OpenDesignDayColor.rose : OpenDesignDayColor.amber)
            .padding(.horizontal, 7)
            .padding(.vertical, 3)
            .background(
                Capsule()
                    .fill(failed ? OpenDesignDayColor.roseDim : OpenDesignDayColor.amberDim)
                    .overlay(Capsule().stroke(failed ? OpenDesignDayColor.roseLine : OpenDesignDayColor.amberLine, lineWidth: 1))
            )
            .accessibilityIdentifier("morningBriefing.card.\(card.id).state")
    }

    private func sourceCardBorderColor(_ card: MorningBriefingCard) -> Color {
        switch card.state {
        case "failed":
            return OpenDesignDayColor.roseLine
        default:
            return OpenDesignDayColor.borderSoft
        }
    }

    @ViewBuilder
    private func sourceCardFooter(_ card: MorningBriefingCard, collecting: Bool) -> some View {
        let showsDrilldown = card.isReady && !collecting
        if showsDrilldown {
            ViewThatFits(in: .horizontal) {
                HStack(alignment: .center, spacing: 10) {
                    sourceCardFooterStatus(card, collecting: collecting)
                    Spacer(minLength: 8)
                    sourceCardDrilldownButton(card)
                }

                VStack(alignment: .leading, spacing: 7) {
                    sourceCardFooterStatus(card, collecting: collecting)
                        .frame(maxWidth: .infinity, alignment: .leading)
                    sourceCardDrilldownButton(card)
                        .frame(maxWidth: .infinity, alignment: .trailing)
                }
            }
        } else {
            sourceCardFooterStatus(card, collecting: collecting)
                .frame(maxWidth: .infinity, alignment: .leading)
        }
    }

    private func sourceCardFooterStatus(_ card: MorningBriefingCard, collecting: Bool) -> some View {
        let color = sourceCardFooterColor(card, collecting: collecting)
        return HStack(alignment: .firstTextBaseline, spacing: 6) {
            Circle()
                .fill(color)
                .frame(width: 5, height: 5)
            Text(footerStatusLabel(card, collecting: collecting))
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(color)
                .lineLimit(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func sourceCardFooterColor(_ card: MorningBriefingCard, collecting: Bool) -> Color {
        if collecting { return OpenDesignDayColor.accent }
        if card.state == "failed" { return OpenDesignDayColor.rose }
        if card.noteTone == "warn" { return OpenDesignDayColor.amber }
        return OpenDesignDayColor.mutedDeep
    }

    private func sourceCardDrilldownButton(_ card: MorningBriefingCard) -> some View {
        // The sidecar guarantees a drilldown for every ready source
        // (counts-grade at minimum), so this always navigates —
        // same as the briefing.html drill links.
        Button {
            withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.15)) {
                presentedDrilldownID = card.id
            }
        } label: {
            HStack(spacing: 5) {
                Text("드릴다운")
                Image(systemName: "arrow.right")
                    .font(.system(size: 8, weight: .bold))
            }
            .font(.system(size: 10.5, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.accent)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("morningBriefing.drill.\(card.id)")
    }

    /// 비-ready 카드의 footer 한 줄. "failed"는 연결은 됐는데 이번 수집이
    /// 실패한 상태 — "연결 필요"로 오진하지 않는다(실측: MCP 연결됨인데
    /// digest 타임아웃이 연결 문제로 표시되던 혼선).
    private func footerStatusLabel(_ card: MorningBriefingCard, collecting: Bool) -> String {
        if collecting { return "수집 중…" }
        if card.isReady { return card.note ?? "" }
        return card.state == "failed" ? "수집 실패 · 연결은 정상" : "연결 필요"
    }

    /// 수집 중 카드 본문: 스피너 + 진행 설명 + 에이전트 로그 마지막 3줄.
    private func cardCollectingBody(_ progress: MorningBriefingSourceProgress) -> some View {
        VStack(alignment: .leading, spacing: 9) {
            HStack(spacing: 8) {
                OpenDesignInlineSpinner(accessibilityLabel: "소스 수집 중")
                    .accessibilityIdentifier("morningBriefing.cardProgress.spinner")
                Text((progress.detail?.isEmpty == false ? progress.detail : nil) ?? "수집 중…")
                    .font(.system(size: 11.5))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .lineLimit(2)
            }
            if let lines = progress.logLines, !lines.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(lines.suffix(3).enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 9.5, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .frame(maxWidth: .infinity, alignment: .leading)
            }
        }
        .padding(.vertical, 6)
        .accessibilityElement(children: .combine)
        .accessibilityIdentifier("morningBriefing.cardProgress")
    }

    private func metricValueLabel(_ value: Double?) -> String {
        guard let value else { return "–" }
        if value == value.rounded() {
            return String(Int(value))
        }
        return String(format: "%.1f", value)
    }

    private func sparkline(_ card: MorningBriefingCard) -> some View {
        let color = card.metric?.direction == "down" ? OpenDesignDayColor.rose : (card.id == "cloudflare" ? OpenDesignDayColor.amber : OpenDesignDayColor.accent)
        return MorningBriefingSourceSparkline(card: card, color: color)
            .frame(height: 30)
    }

    // MARK: - Timeline

    private var timelineList: some View {
        let events = sortedTimelineEvents(displayBriefing?.timeline ?? [])
        let generatedAt = displayBriefing?.generatedAt
        return VStack(spacing: 1) {
            if events.isEmpty {
                Text("밤사이 타임스탬프가 있는 이벤트가 없어요.")
                    .font(.system(size: 12))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(OpenDesignDayColor.surface)
            } else {
                ForEach(Array(events.enumerated()), id: \.offset) { index, event in
                    let badge = timelineDayBadge(for: event, generatedAt: generatedAt)
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        if let badge {
                            timelineDayBadgeView(badge)
                                .accessibilityIdentifier("morningBriefing.timeline.badge.\(index)")
                        } else {
                            Color.clear
                                .frame(width: 42, height: 19)
                                .accessibilityHidden(true)
                        }
                        Text(event.timeLabel ?? "")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .frame(width: 44, alignment: .leading)
                        sourceLogoInline(event.source ?? "")
                        Text(event.text ?? "")
                            .font(.system(size: 12.5))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            .fixedSize(horizontal: false, vertical: true)
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 16)
                    .padding(.vertical, 11)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(OpenDesignDayColor.surface)
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(timelineAccessibilityLabel(event, badge: badge))
                    .accessibilityIdentifier("morningBriefing.timeline.row.\(index)")
                }
            }
        }
        .background(OpenDesignDayColor.borderSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.timeline")
    }

    private func sortedTimelineEvents(_ events: [MorningBriefingTimelineEvent]) -> [MorningBriefingTimelineEvent] {
        events.enumerated()
            .map { (offset: $0.offset, event: $0.element, date: parseTimelineDate($0.element.at)) }
            .sorted { lhs, rhs in
                switch (lhs.date, rhs.date) {
                case let (.some(lhsDate), .some(rhsDate)):
                    if lhsDate == rhsDate { return lhs.offset < rhs.offset }
                    return lhsDate > rhsDate
                case (.some, .none):
                    return true
                case (.none, .some):
                    return false
                case (.none, .none):
                    return lhs.offset < rhs.offset
                }
            }
            .map(\.event)
    }

    private func timelineDayBadgeView(_ badge: TimelineDayBadge) -> some View {
        Text(badge.label)
            .font(.system(size: 10, weight: .semibold, design: .monospaced))
            .foregroundStyle(badge.foreground)
            .lineLimit(1)
            .minimumScaleFactor(0.82)
            .frame(width: 42, height: 19)
            .background(
                Capsule()
                    .fill(badge.background)
                    .overlay(Capsule().stroke(badge.border, lineWidth: 1))
            )
            .accessibilityLabel(badge.label)
    }

    private func timelineDayBadge(for event: MorningBriefingTimelineEvent, generatedAt: String?) -> TimelineDayBadge? {
        guard let eventDate = parseTimelineDate(event.at),
              let generatedDate = parseTimelineDate(generatedAt) else {
            return nil
        }
        let calendar = Calendar.current
        if calendar.isDate(eventDate, inSameDayAs: generatedDate) {
            return TimelineDayBadge(
                label: "오늘",
                foreground: OpenDesignDayColor.accent,
                background: OpenDesignDayColor.accent.opacity(0.13),
                border: OpenDesignDayColor.accent.opacity(0.35)
            )
        }
        if let yesterday = calendar.date(byAdding: .day, value: -1, to: generatedDate),
           calendar.isDate(eventDate, inSameDayAs: yesterday) {
            return TimelineDayBadge(
                label: "어제",
                foreground: OpenDesignDayColor.amber,
                background: OpenDesignDayColor.amber.opacity(0.13),
                border: OpenDesignDayColor.amber.opacity(0.35)
            )
        }
        return TimelineDayBadge(
            label: timelineMonthDayLabel(eventDate),
            foreground: OpenDesignDayColor.muted,
            background: OpenDesignDayColor.muted.opacity(0.10),
            border: OpenDesignDayColor.borderSoft
        )
    }

    private func timelineAccessibilityLabel(_ event: MorningBriefingTimelineEvent, badge: TimelineDayBadge?) -> String {
        [
            badge?.label,
            event.timeLabel,
            sourceDisplayName(event.source),
            event.text,
        ]
        .compactMap { value in
            let trimmed = value?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
            return trimmed.isEmpty ? nil : trimmed
        }
        .joined(separator: ", ")
    }

    private func parseTimelineDate(_ value: String?) -> Date? {
        guard let value = value?.trimmingCharacters(in: .whitespacesAndNewlines), !value.isEmpty else {
            return nil
        }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: value) {
            return date
        }
        let standard = ISO8601DateFormatter()
        standard.formatOptions = [.withInternetDateTime]
        return standard.date(from: value)
    }

    private func timelineMonthDayLabel(_ date: Date) -> String {
        let formatter = DateFormatter()
        formatter.locale = Locale(identifier: "ko_KR")
        formatter.timeZone = .current
        formatter.dateFormat = "M/d"
        return formatter.string(from: date)
    }

    // MARK: - Anomaly picker

    private func anomalyPicker(_ anomaly: MorningBriefingAnomaly) -> some View {
        let submitted = anomaly.label != nil
        let options = anomaly.options ?? []
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 9) {
                RoundedRectangle(cornerRadius: 2)
                    .fill(OpenDesignDayColor.rose)
                    .frame(width: 4, height: 15)
                Text(anomaly.title ?? "이상 신호")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("을(를) 어떻게 볼까요?")
                    .font(.system(size: 12.5))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Spacer()
                Text(submitted || pickedAnomalyOptionID != nil ? "1 / 1 선택" : "0 / 1 선택")
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            .padding(EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14))
            .background(OpenDesignDayColor.rose.opacity(0.05))

            Divider().overlay(OpenDesignDayColor.borderSoft)

            VStack(alignment: .leading, spacing: 5) {
                Text(anomaly.question ?? "")
                    .font(.system(size: 13.5, weight: .medium))
                    .lineSpacing(4)
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .fixedSize(horizontal: false, vertical: true)
                if let evidence = anomaly.evidence {
                    HStack(spacing: 6) {
                        Image(systemName: "clock")
                            .font(.system(size: 9))
                        Text(evidence)
                    }
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                }
            }
            .padding(EdgeInsets(top: 13, leading: 16, bottom: 4, trailing: 16))

            VStack(spacing: 2) {
                ForEach(Array(options.enumerated()), id: \.element.id) { index, option in
                    anomalyOption(option, index: index, anomaly: anomaly, submitted: submitted)
                }
            }
            .padding(EdgeInsets(top: 8, leading: 6, bottom: 8, trailing: 6))

            Divider().overlay(OpenDesignDayColor.borderSoft)

            if submitted {
                HStack(alignment: .top, spacing: 9) {
                    Image(systemName: "checkmark")
                        .font(.system(size: 11, weight: .bold))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .padding(.top, 1)
                    Text("\"\(anomaly.label ?? "")\" 로 라벨링했어요. 액션 초안 우선순위에 반영했고 오늘 브리핑 근거에 기록했어요.")
                        .font(.system(size: 12))
                        .lineSpacing(3)
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(EdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14))
                .frame(maxWidth: .infinity, alignment: .leading)
                .background(OpenDesignDayColor.accent.opacity(0.05))
                .accessibilityIdentifier("morningBriefing.anomaly.resolved")
            } else if viewingPrevious {
                Text("지난 브리핑은 읽기 전용이에요. 라벨은 오늘 브리핑에서만 반영돼요.")
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .padding(EdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14))
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(OpenDesignDayColor.bgDeep)
            } else {
                VStack(spacing: 8) {
                    if pickedAnomalyOptionID == "custom" {
                        TextField("직접 라벨 입력 — 예: 캠페인 종료 영향", text: $customAnomalyLabel)
                            .textFieldStyle(.plain)
                            .font(.system(size: 12))
                            .foregroundStyle(OpenDesignDayColor.fg)
                            .padding(.horizontal, 10)
                            .frame(height: 28)
                            .background(
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .fill(OpenDesignDayColor.bgDarker)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                                            .stroke(OpenDesignDayColor.border, lineWidth: 1)
                                    )
                            )
                            .accessibilityIdentifier("morningBriefing.anomaly.customLabel")
                    }
                    HStack(spacing: 12) {
                        Text("선택: \(resolvedAnomalyLabel ?? "아직 없음")")
                            .font(.system(size: 10.5, design: .monospaced))
                            .foregroundStyle(pickedAnomalyOptionID == nil ? OpenDesignDayColor.mutedDeep : OpenDesignDayColor.accent)
                            .lineLimit(1)
                        Spacer()
                        Button {
                            if let label = resolvedAnomalyLabel {
                                submitAnomalyLabel(label)
                                showToast("이상 신호 라벨 반영됨 · \(label)")
                            }
                        } label: {
                            Text("라벨 반영 ↵")
                                .font(.system(size: 12, weight: .semibold))
                                .foregroundStyle(resolvedAnomalyLabel == nil ? OpenDesignDayColor.mutedDeep : OpenDesignDayColor.bgDeep)
                                .padding(.horizontal, 16)
                                .frame(height: 30)
                                .background(
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .fill(resolvedAnomalyLabel == nil ? OpenDesignDayColor.surface2 : OpenDesignDayColor.accent)
                                )
                                .contentShape(Rectangle())
                        }
                        .buttonStyle(.plain)
                        .disabled(resolvedAnomalyLabel == nil)
                        .accessibilityIdentifier("morningBriefing.anomaly.submit")
                    }
                }
                .padding(EdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14))
                .background(OpenDesignDayColor.bgDeep)
            }
        }
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(OpenDesignDayColor.surface)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OpenDesignDayColor.rose.opacity(0.36), lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.anomaly")
    }

    private var pickedOptionTitle: String? {
        guard let pickedAnomalyOptionID else { return nil }
        return displayBriefing?.anomaly?.options?.first(where: { $0.id == pickedAnomalyOptionID })?.title
    }

    /// The label that would be submitted: the option title, or — for the
    /// "다르게 본다" option — the user's free-text label once it is non-empty.
    private var resolvedAnomalyLabel: String? {
        guard let pickedAnomalyOptionID else { return nil }
        if pickedAnomalyOptionID == "custom" {
            let custom = customAnomalyLabel.trimmingCharacters(in: .whitespacesAndNewlines)
            return custom.isEmpty ? nil : custom
        }
        return pickedOptionTitle
    }

    private func anomalyOption(_ option: MorningBriefingAnomalyOption, index: Int, anomaly: MorningBriefingAnomaly, submitted: Bool) -> some View {
        let isPicked = submitted ? anomaly.label == option.title : pickedAnomalyOptionID == option.id
        return Button {
            guard !submitted, !viewingPrevious else { return }
            withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.12)) {
                pickedAnomalyOptionID = option.id
            }
        } label: {
            HStack(alignment: .top, spacing: 12) {
                Group {
                    if submitted && isPicked {
                        Image(systemName: "checkmark")
                            .font(.system(size: 11, weight: .heavy))
                            .foregroundStyle(OpenDesignDayColor.bgDeep)
                    } else {
                        Text("\(index + 1)")
                            .font(.system(size: 11.5, weight: .semibold, design: .monospaced))
                            .foregroundStyle(isPicked ? OpenDesignDayColor.bgDeep : OpenDesignDayColor.muted)
                    }
                }
                .frame(width: 24, height: 24)
                .background(
                    Circle()
                        .fill(isPicked ? OpenDesignDayColor.accent : OpenDesignDayColor.bgDeep)
                        .overlay(Circle().stroke(isPicked ? OpenDesignDayColor.accent : OpenDesignDayColor.border, lineWidth: 1))
                )
                .padding(.top, 1)

                VStack(alignment: .leading, spacing: 3) {
                    HStack(spacing: 8) {
                        Text(option.title ?? "")
                            .font(.system(size: 13, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        if submitted && isPicked {
                            Text("반영됨")
                                .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.bgDeep)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(Capsule().fill(OpenDesignDayColor.accent))
                        }
                    }
                    Text(option.detail ?? "")
                        .font(.system(size: 11.5))
                        .lineSpacing(3)
                        .foregroundStyle(isPicked ? OpenDesignDayColor.fgSecondary : OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer(minLength: 8)

                Text(option.tail ?? "")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(isPicked ? OpenDesignDayColor.accent : OpenDesignDayColor.mutedDeep)
                    .padding(.top, 4)
            }
            .padding(EdgeInsets(top: 11, leading: 12, bottom: 11, trailing: 12))
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 8, style: .continuous)
                    .fill(isPicked ? OpenDesignDayColor.accent.opacity(0.13) : Color.clear)
                    .overlay(
                        RoundedRectangle(cornerRadius: 8, style: .continuous)
                            .stroke(isPicked ? OpenDesignDayColor.accent.opacity(0.4) : Color.clear, lineWidth: 1)
                    )
            )
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("morningBriefing.anomaly.option.\(option.id)")
    }

    // MARK: - Action drafts

    private var actionDrafts: some View {
        VStack(spacing: 10) {
            ForEach(displayBriefing?.actions ?? []) { draft in
                actionDraftCard(draft)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.actions")
    }

    private func draftBadgeColor(_ kind: String?) -> Color {
        switch kind {
        case "message": return OpenDesignDayColor.sky
        case "experiment": return OpenDesignDayColor.violet
        default: return OpenDesignDayColor.accent
        }
    }

    private func actionDraftCard(_ draft: MorningBriefingActionDraft) -> some View {
        let isPrimary = draft.id == displayBriefing?.customerEvidenceVerdict?.primaryActionId
        return VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 11) {
                Text(draft.badge ?? "")
                    .font(.system(size: 9.5, weight: .bold, design: .monospaced))
                    .kerning(0.8)
                    .foregroundStyle(draftBadgeColor(draft.kind))
                    .padding(.horizontal, 8)
                    .padding(.vertical, 3)
                    .background(
                        Capsule()
                            .fill(draftBadgeColor(draft.kind).opacity(0.13))
                            .overlay(Capsule().stroke(draftBadgeColor(draft.kind).opacity(0.35), lineWidth: 1))
                    )
                VStack(alignment: .leading, spacing: 2) {
                    Text(draft.title ?? "")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .lineLimit(1)
                    Text(draft.subtitle ?? "")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
                Spacer()
                if isPrimary {
                    Text("오늘 먼저")
                        .font(.system(size: 9.5, weight: .semibold, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(OpenDesignDayColor.accent.opacity(0.13))
                                .overlay(Capsule().stroke(OpenDesignDayColor.accent.opacity(0.35), lineWidth: 1))
                        )
                }
            }
            .padding(EdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14))
            .background(isPrimary ? OpenDesignDayColor.accent.opacity(0.08) : OpenDesignDayColor.surface2)

            Divider().overlay(OpenDesignDayColor.borderSoft)

            Group {
                if draft.kind == "task", let tasks = draft.tasks, !tasks.isEmpty {
                    VStack(spacing: 8) {
                        ForEach(Array(tasks.enumerated()), id: \.offset) { _, task in
                            HStack(spacing: 11) {
                                Circle()
                                    .stroke(OpenDesignDayColor.mutedDeep, lineWidth: 1.5)
                                    .frame(width: 16, height: 16)
                                Text(task.title ?? "")
                                    .font(.system(size: 12.5))
                                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                                Spacer()
                                Text(task.tag ?? "")
                                    .font(.system(size: 10, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                                    .padding(.horizontal, 7)
                                    .padding(.vertical, 1)
                                    .background(
                                        Capsule()
                                            .fill(OpenDesignDayColor.surface)
                                            .overlay(Capsule().stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
                                    )
                            }
                            .padding(.horizontal, 12)
                            .padding(.vertical, 9)
                            .background(
                                RoundedRectangle(cornerRadius: 9, style: .continuous)
                                    .fill(OpenDesignDayColor.bgDarker)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 9, style: .continuous)
                                            .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                                    )
                            )
                        }
                    }
                    .padding(EdgeInsets(top: 13, leading: 14, bottom: 13, trailing: 14))
                } else {
                    Text(draft.body ?? "")
                        .font(.system(size: 12, design: .monospaced))
                        .lineSpacing(6)
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .padding(13)
                        .background(
                            RoundedRectangle(cornerRadius: 10, style: .continuous)
                                .fill(OpenDesignDayColor.bgDarker)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                                )
                        )
                        .padding(EdgeInsets(top: 13, leading: 14, bottom: 13, trailing: 14))
                }
            }

            Divider().overlay(OpenDesignDayColor.borderSoft)

            HStack(spacing: 10) {
                Text("왜: \(draft.why ?? "")")
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .lineLimit(2)
                Spacer()
                Button {
                    copyToPasteboard(draft.copyText ?? "")
                    copiedActionIDs.insert(draft.id)
                    showToast("클립보드에 복사됨")
                } label: {
                    HStack(spacing: 6) {
                        Image(systemName: "doc.on.doc")
                            .font(.system(size: 9))
                        Text(copiedActionIDs.contains(draft.id) ? "복사됨" : "복사")
                    }
                    .font(.system(size: 11))
                    .foregroundStyle(copiedActionIDs.contains(draft.id) ? OpenDesignDayColor.accent : OpenDesignDayColor.fgSecondary)
                    .padding(.horizontal, 11)
                    .frame(height: 28)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .stroke(copiedActionIDs.contains(draft.id) ? OpenDesignDayColor.accent.opacity(0.4) : OpenDesignDayColor.borderSoft, lineWidth: 1)
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("morningBriefing.action.copy.\(draft.id)")

                Button {
                    guard !appliedActionIDs.contains(draft.id) else { return }
                    applyAction(draft)
                    appliedActionIDs.insert(draft.id)
                    showToast("\(draft.applyLabel ?? "적용") · 적용됨")
                } label: {
                    Text(appliedActionIDs.contains(draft.id) ? "적용됨 ✓" : (draft.applyLabel ?? "적용"))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(appliedActionIDs.contains(draft.id) ? OpenDesignDayColor.accent : OpenDesignDayColor.bgDeep)
                        .padding(.horizontal, 11)
                        .frame(height: 28)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(appliedActionIDs.contains(draft.id) ? OpenDesignDayColor.accent.opacity(0.13) : OpenDesignDayColor.accent)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .stroke(appliedActionIDs.contains(draft.id) ? OpenDesignDayColor.accent.opacity(0.4) : Color.clear, lineWidth: 1)
                                )
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("morningBriefing.action.apply.\(draft.id)")
            }
            .padding(EdgeInsets(top: 10, leading: 14, bottom: 10, trailing: 14))
            .background(OpenDesignDayColor.bgDeep)
        }
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(OpenDesignDayColor.surface)
        )
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(isPrimary ? OpenDesignDayColor.accent.opacity(0.55) : OpenDesignDayColor.borderSoft, lineWidth: 1)
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.action.\(draft.id)")
    }

    // MARK: - Meta panel

    private var metaPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                metaProgress

                metaHeading("동기화 소스")
                VStack(spacing: 1) {
                    ForEach(displayBriefing?.sync?.sources ?? []) { source in
                        HStack(spacing: 10) {
                            sourceLogoInline(source.id, fallbackColor: OpenDesignDayColor.muted)
                            Text(source.label ?? source.id)
                                .font(.system(size: 12))
                                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            Spacer()
                            HStack(spacing: 6) {
                                Circle()
                                    .fill(source.state == "ready" ? OpenDesignDayColor.accent : OpenDesignDayColor.amber)
                                    .frame(width: 9, height: 9)
                                Text(source.state == "ready" ? "연결됨" : "미연결")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                    }
                    if let synced = displayBriefing?.sync?.syncedAtLabel {
                        HStack(spacing: 10) {
                            Image(systemName: "clock")
                                .font(.system(size: 11))
                                .foregroundStyle(OpenDesignDayColor.muted)
                                .frame(width: 22)
                            Text("마지막 동기화")
                                .font(.system(size: 12))
                                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                            Spacer()
                            VStack(alignment: .trailing, spacing: 2) {
                                Text(synced)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                                if let lastSyncTimingLabel {
                                    Text(lastSyncTimingLabel)
                                        .font(.system(size: 10, design: .monospaced))
                                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                                }
                            }
                        }
                        .padding(.horizontal, 10)
                        .padding(.vertical, 8)
                    }
                }

                if let anomaly = displayBriefing?.anomaly {
                    metaHeading("이상 신호", count: "1")
                    HStack(alignment: .top, spacing: 10) {
                        Image(systemName: "exclamationmark.triangle")
                            .font(.system(size: 11))
                            .foregroundStyle(OpenDesignDayColor.rose)
                            .frame(width: 22)
                            .padding(.top, 1)
                        VStack(alignment: .leading, spacing: 2) {
                            Text(anomaly.title ?? "")
                                .font(.system(size: 12, weight: .medium))
                                .foregroundStyle(OpenDesignDayColor.fg)
                            Text(anomaly.label.map { "라벨: \($0)" } ?? "확인 대기")
                                .font(.system(size: 11))
                                .foregroundStyle(anomaly.label == nil ? OpenDesignDayColor.muted : OpenDesignDayColor.accent)
                        }
                        Spacer(minLength: 0)
                    }
                    .padding(.horizontal, 10)
                    .padding(.vertical, 9)
                    .accessibilityIdentifier("morningBriefing.meta.anomaly")
                }

                metaHeading("어제 대비")
                VStack(spacing: 1) {
                    ForEach(displayBriefing?.cards ?? []) { card in
                        if card.isReady, let metric = card.metric, let delta = metric.deltaLabel {
                            HStack(spacing: 10) {
                                sourceLogoInline(card.id, fallbackColor: OpenDesignDayColor.muted)
                                Text(metric.unit ?? card.id)
                                    .font(.system(size: 12))
                                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                                Spacer()
                                Text(delta)
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(deltaColor(metric.direction))
                                Text(metricValueLabel(metric.value))
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                        }
                    }
                }

                metaHeading("다음")
                Button(action: startToday) {
                    HStack(spacing: 12) {
                        Text("\(day)")
                            .font(.system(size: 13, weight: .bold, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.accent)
                            .frame(width: 36, height: 36)
                            .background(
                                RoundedRectangle(cornerRadius: 11, style: .continuous)
                                    .fill(OpenDesignDayColor.accent.opacity(0.14))
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 11, style: .continuous)
                                            .stroke(OpenDesignDayColor.accent.opacity(0.4), lineWidth: 1)
                                    )
                            )
                        VStack(alignment: .leading, spacing: 2) {
                            Text("브리핑 닫고 Day \(day) 시작")
                                .font(.system(size: 12.5, weight: .semibold))
                                .foregroundStyle(OpenDesignDayColor.fg)
                            Text(phaseLabel.isEmpty ? "오늘 빌드로 이동" : "\(phaseLabel) · 오늘 빌드로 이동")
                                .font(.system(size: 10.5, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.muted)
                        }
                        Spacer()
                        Image(systemName: "arrow.right")
                            .font(.system(size: 12))
                            .foregroundStyle(OpenDesignDayColor.muted)
                    }
                    .padding(EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14))
                    .background(
                        RoundedRectangle(cornerRadius: 10, style: .continuous)
                            .fill(OpenDesignDayColor.surface)
                            .overlay(
                                RoundedRectangle(cornerRadius: 10, style: .continuous)
                                    .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                            )
                    )
                    .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .padding(.top, 12)
                .accessibilityIdentifier("morningBriefing.meta.nextDay")
            }
            .padding(16)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.meta")
    }

    private var metaProgress: some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Circle().fill(OpenDesignDayColor.accent).frame(width: 6, height: 6)
                Text("30일 진행".uppercased())
                    .font(.system(size: 10.5, design: .monospaced))
                    .kerning(0.5)
                    .foregroundStyle(OpenDesignDayColor.muted)
            }
            HStack(alignment: .firstTextBaseline, spacing: 6) {
                Text("\(day)")
                    .font(.system(size: 18, weight: .semibold, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text("/")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                Text("\(totalDays)")
                    .font(.system(size: 13, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
                Spacer()
                if !phaseLabel.isEmpty {
                    Text(phaseLabel)
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.accent)
                        .padding(.horizontal, 8)
                        .padding(.vertical, 1)
                        .background(
                            Capsule()
                                .fill(OpenDesignDayColor.accent.opacity(0.14))
                                .overlay(Capsule().stroke(OpenDesignDayColor.accent.opacity(0.4), lineWidth: 1))
                        )
                }
            }
            GeometryReader { geo in
                ZStack(alignment: .leading) {
                    Capsule().fill(OpenDesignDayColor.bgDeep)
                    Capsule()
                        .fill(OpenDesignDayColor.accent)
                        .frame(width: geo.size.width * CGFloat(min(max(Double(day) / Double(max(totalDays, 1)), 0), 1)))
                }
            }
            .frame(height: 3)
        }
        .padding(EdgeInsets(top: 12, leading: 14, bottom: 12, trailing: 14))
        .background(
            RoundedRectangle(cornerRadius: 10, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 10, style: .continuous)
                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
        )
        .accessibilityIdentifier("morningBriefing.meta.progress")
    }

    private func metaHeading(_ title: String, count: String? = nil) -> some View {
        HStack {
            Text(title.uppercased())
                .font(.system(size: 10.5, design: .monospaced))
                .kerning(1.0)
                .foregroundStyle(OpenDesignDayColor.mutedDeep)
            Spacer()
            if let count {
                Text(count)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.rose)
            }
        }
        .padding(.horizontal, 4)
        .padding(.top, 14)
        .padding(.bottom, 8)
    }

    // MARK: - Empty / locked / collecting states

    private var lockedState: some View {
        VStack(spacing: 10) {
            Image(systemName: "sunrise")
                .font(.system(size: 28))
                .foregroundStyle(OpenDesignDayColor.muted)
            Text("아침 브리핑은 Day 2 아침부터 도착해요")
                .font(.system(size: 14, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.fg)
            Text(displayBriefing?.status?.detail ?? "오늘은 Day 1 인터뷰에 집중해요.")
                .font(.system(size: 12))
                .foregroundStyle(OpenDesignDayColor.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("morningBriefing.locked")
    }

    private func collectingState(_ presentation: MorningBriefingColdLoadPresentation) -> some View {
        OpenDesignColdLoadingStateView(
            title: "밤사이 신호를 모으는 중",
            detail: "소스별 수집 로그가 도착하는 대로 업데이트됩니다.",
            rows: openDesignLoadingRows(from: presentation.rows),
            timingLabel: runningTimingLabel,
            accessibilityIdentifier: "morningBriefing.loading",
            spinnerAccessibilityLabel: "밤사이 신호 수집 중"
        )
    }

    private func loadingErrorState(_ presentation: MorningBriefingColdLoadPresentation) -> some View {
        VStack(alignment: .leading, spacing: 16) {
            Image(systemName: "exclamationmark.triangle.fill")
                .font(.system(size: 24, weight: .bold))
                .foregroundStyle(OpenDesignDayColor.amber)
            Text("브리핑 수집을 완료하지 못했습니다")
                .font(.system(size: 20, weight: .bold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fg)
            Text(presentation.detail ?? "소스 수집 중 문제가 발생했습니다. 연결 상태를 확인한 뒤 다시 시도하세요.")
                .font(.system(size: 13, weight: .medium))
                .foregroundStyle(OpenDesignDayColor.muted)
                .fixedSize(horizontal: false, vertical: true)

            Button(action: refresh) {
                Label("다시 수집", systemImage: "arrow.clockwise")
                    .font(.system(size: 12, weight: .bold))
                    .frame(height: 32)
            }
            .buttonStyle(.plain)
            .padding(.horizontal, 12)
            .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(OpenDesignDayColor.accentDim))
            .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
            .accessibilityIdentifier("morningBriefing.loading.retry")

            if !presentation.rows.isEmpty {
                VStack(alignment: .leading, spacing: 10) {
                    ForEach(presentation.rows) { row in
                        loadingSourceRow(row)
                    }
                }
            }
        }
        .frame(maxWidth: 780, alignment: .leading)
        .padding(24)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .accessibilityIdentifier("morningBriefing.loading.error")
    }

    private func loadingSourceRow(_ row: MorningBriefingLoadingRow) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 10) {
                sourceLogoBadge(row.id, showsBorder: false)
                VStack(alignment: .leading, spacing: 2) {
                    Text(row.title)
                        .font(.system(size: 12.5, weight: .bold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text(row.detail?.isEmpty == false ? row.detail! : loadingStateLabel(row.state))
                        .font(.system(size: 11.5, weight: .medium))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineLimit(2)
                }
                Spacer(minLength: 0)
                loadingStateBadge(row.state)
            }

            if !row.logLines.isEmpty {
                VStack(alignment: .leading, spacing: 3) {
                    ForEach(Array(row.logLines.suffix(3).enumerated()), id: \.offset) { _, line in
                        Text(line)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.mutedDeep)
                            .lineLimit(1)
                            .truncationMode(.middle)
                    }
                }
                .padding(.leading, 34)
            }
        }
        .padding(12)
        .background(RoundedRectangle(cornerRadius: 8, style: .continuous).fill(OpenDesignDayColor.surface))
        .overlay(RoundedRectangle(cornerRadius: 8, style: .continuous).stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
        .accessibilityIdentifier("morningBriefing.loading.card.\(row.id)")
    }

    private func loadingStateBadge(_ state: String) -> some View {
        let isCollecting = state == "collecting"
        return HStack(spacing: 5) {
            if isCollecting {
                OpenDesignInlineSpinner(
                    accessibilityLabel: "수집 중",
                    size: 10,
                    lineWidth: 1.4
                )
                .accessibilityIdentifier("morningBriefing.loading.badge.spinner")
            } else {
                Circle()
                    .fill(OpenDesignDayColor.muted.opacity(0.65))
                    .frame(width: 6, height: 6)
            }
            Text(loadingStateLabel(state))
                .font(.system(size: 10.5, weight: .bold))
                .foregroundStyle(isCollecting ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
        }
    }

    private func loadingStateLabel(_ state: String) -> String {
        openDesignLoadingStateLabel(state)
    }

    private func openDesignLoadingRows(from rows: [MorningBriefingLoadingRow]) -> [OpenDesignLoadingCardRow] {
        rows.map { row in
            OpenDesignLoadingCardRow(
                id: row.id,
                title: row.title,
                state: row.state,
                detail: row.detail,
                logLines: row.logLines,
                iconID: row.id
            )
        }
    }

    // MARK: - Helpers

    private func copyToPasteboard(_ text: String) {
        let pasteboard = NSPasteboard.general
        pasteboard.clearContents()
        pasteboard.setString(text, forType: .string)
    }

    private func showToast(_ text: String) {
        toastDismissTask?.cancel()
        withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.14)) {
            toastText = text
        }
        toastDismissTask = Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_700_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.14)) {
                toastText = nil
            }
        }
    }
}

private struct MorningBriefingSourceSparkline: View {
    let card: MorningBriefingCard
    let color: Color

    @State private var hoveredIndex: Int?

    private struct Sample {
        let value: Double
        let timeLabel: String
        let at: String?
    }

    private var samples: [Sample] {
        if let sparkPoints = card.sparkPoints, sparkPoints.count >= 2 {
            let points = sparkPoints.compactMap { point -> Sample? in
                guard let value = point.value, value.isFinite else { return nil }
                return Sample(
                    value: value,
                    timeLabel: normalized(point.timeLabel) ?? "값",
                    at: point.at
                )
            }
            if points.count >= 2 { return points }
        }
        return (card.spark ?? []).enumerated().compactMap { index, value in
            guard value.isFinite else { return nil }
            return Sample(value: value, timeLabel: "값 \(index + 1)", at: nil)
        }
    }

    private var unitLabel: String {
        normalized(card.metric?.unit) ?? "값"
    }

    var body: some View {
        let chartSamples = samples
        return Group {
            if chartSamples.count >= 2 {
                GeometryReader { geo in
                    let coords = chartPoints(samples: chartSamples, size: geo.size)
                    ZStack {
                        linePath(points: coords)
                            .stroke(color, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))

                        if let last = coords.last {
                            Circle()
                                .fill(color)
                                .frame(width: 5, height: 5)
                                .position(last)
                        }

                        if let hoveredIndex, coords.indices.contains(hoveredIndex) {
                            let coord = coords[hoveredIndex]
                            Path { path in
                                path.move(to: CGPoint(x: coord.x, y: 0))
                                path.addLine(to: CGPoint(x: coord.x, y: geo.size.height))
                            }
                            .stroke(color.opacity(0.38), style: StrokeStyle(lineWidth: 1, dash: [3, 3]))

                            Circle()
                                .fill(OpenDesignDayColor.bg)
                                .frame(width: 11, height: 11)
                                .overlay(Circle().stroke(color, lineWidth: 2))
                                .shadow(color: color.opacity(0.45), radius: 6, x: 0, y: 0)
                                .position(coord)

                            tooltip(for: samples[hoveredIndex])
                                .position(
                                    x: tooltipX(coord.x, width: geo.size.width),
                                    y: tooltipY(coord.y)
                                )
                                .zIndex(5)
                        }
                    }
                    .contentShape(Rectangle())
                    .onContinuousHover(coordinateSpace: .local) { phase in
                        switch phase {
                        case .active(let location):
                            hoveredIndex = nearestIndex(to: location.x, width: geo.size.width, count: chartSamples.count)
                        case .ended:
                            hoveredIndex = nil
                        }
                    }
                    .accessibilityElement(children: .contain)
                    .accessibilityLabel(accessibilityLabel(samples: chartSamples))
                    .accessibilityIdentifier("morningBriefing.sparkline.\(card.id)")
                }
            } else {
                Rectangle()
                    .fill(Color.clear)
                    .accessibilityHidden(true)
            }
        }
    }

    private func chartPoints(samples: [Sample], size: CGSize) -> [CGPoint] {
        let values = samples.map(\.value)
        guard let min = values.min(), let max = values.max() else { return [] }
        let range = Swift.max(max - min, 1)
        return values.enumerated().map { index, value in
            CGPoint(
                x: size.width * CGFloat(index) / CGFloat(values.count - 1),
                y: size.height * (1 - CGFloat((value - min) / range) * 0.8 - 0.1)
            )
        }
    }

    private func linePath(points: [CGPoint]) -> Path {
        Path { path in
            guard let first = points.first else { return }
            path.move(to: first)
            for point in points.dropFirst() {
                path.addLine(to: point)
            }
        }
    }

    private func tooltip(for sample: Sample) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            Text(sample.timeLabel)
                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.fg)
                .lineLimit(1)
            HStack(spacing: 6) {
                Circle()
                    .fill(color)
                    .frame(width: 5, height: 5)
                Text("\(unitLabel) \(formatValue(sample.value))")
                    .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                    .foregroundStyle(color)
                    .lineLimit(1)
            }
        }
        .padding(.horizontal, 9)
        .padding(.vertical, 7)
        .fixedSize()
        .background(
            RoundedRectangle(cornerRadius: 7, style: .continuous)
                .fill(OpenDesignDayColor.bg)
                .overlay(
                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                        .stroke(OpenDesignDayColor.border, lineWidth: 1)
                )
        )
        .shadow(color: Color.black.opacity(0.28), radius: 10, x: 0, y: 6)
        .accessibilityElement(children: .combine)
        .accessibilityLabel("\(sample.timeLabel) · \(unitLabel) \(formatValue(sample.value))")
        .accessibilityIdentifier("morningBriefing.sparkline.tooltip.\(card.id)")
    }

    private func nearestIndex(to x: CGFloat, width: CGFloat, count: Int) -> Int? {
        guard count > 1, width > 0 else { return nil }
        let ratio = min(max(x / width, 0), 1)
        return min(max(Int(round(ratio * CGFloat(count - 1))), 0), count - 1)
    }

    private func tooltipX(_ x: CGFloat, width: CGFloat) -> CGFloat {
        min(max(x, 56), max(56, width - 56))
    }

    private func tooltipY(_ y: CGFloat) -> CGFloat {
        min(y - 30, -12)
    }

    private func accessibilityLabel(samples: [Sample]) -> String {
        guard let last = samples.last else { return "라인 차트" }
        return "라인 차트, \(samples.count)개 포인트, \(last.timeLabel), \(unitLabel) \(formatValue(last.value))"
    }

    private func formatValue(_ value: Double) -> String {
        if value.rounded(.towardZero) == value {
            return String(Int(value))
        }
        var text = String(format: "%.2f", value)
        while text.contains(".") && text.last == "0" {
            text.removeLast()
        }
        if text.last == "." {
            text.removeLast()
        }
        return text
    }

    private func normalized(_ text: String?) -> String? {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }
}

// MARK: - Scroll spy plumbing (shared with the drilldown screen)

/// Explicit scroll command from a nav click. Carries a nonce so re-clicking
/// the same section still triggers `onChange`, and so scroll-spy updates to
/// `activeSectionID` never cause a programmatic scroll on their own.
struct MorningBriefingScrollRequest: Equatable {
    let id: String
    private let nonce = UUID()

    init(id: String) {
        self.id = id
    }
}

/// Section headings report their minY in the scroll coordinate space; the nav
/// highlights the deepest section whose heading has passed the top threshold
/// (briefing.html IntersectionObserver equivalent).
struct MorningBriefingSectionOffsetKey: PreferenceKey {
    static let defaultValue: [String: CGFloat] = [:]

    static func reduce(value: inout [String: CGFloat], nextValue: () -> [String: CGFloat]) {
        value.merge(nextValue()) { $1 }
    }
}

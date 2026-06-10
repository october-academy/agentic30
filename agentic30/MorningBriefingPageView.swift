import AppKit
import SwiftUI

/// Morning briefing screen (OD reference: agentic30-morning-briefing.html).
/// Rendered inside OpenDesignDayShell to the right of the rail; owns its own
/// three-column layout (section nav / main scroll / meta panel) using the
/// OpenDesignDayColor token palette.
struct MorningBriefingPageView: View {
    let briefing: MorningBriefing?
    let previousBriefing: MorningBriefing?
    let collecting: Bool
    let fallbackDay: Int
    let refresh: () -> Void
    let prepare: () -> Void
    let submitAnomalyLabel: (String) -> Void
    let applyAction: (MorningBriefingActionDraft) -> Void
    let startToday: () -> Void

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

    /// The payload the screen renders: today's briefing, or — in "어제 브리핑"
    /// mode — the persisted previous-day briefing (read-only).
    private var displayBriefing: MorningBriefing? {
        viewingPrevious ? (previousBriefing ?? briefing) : briefing
    }

    private var day: Int { displayBriefing?.day ?? fallbackDay }
    private var totalDays: Int { displayBriefing?.totalDays ?? 30 }
    private var isLocked: Bool { displayBriefing?.status?.state == "locked" }
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

    private var sections: [SectionEntry] {
        var entries: [SectionEntry] = [
            SectionEntry(id: "summary", title: "밤사이 한 줄 요약", meta: "Cloudflare · GitHub · PostHog", tone: .accent),
            SectionEntry(id: "sources", title: "세 소스 · 어제 대비", meta: yesterdaySectionMeta, tone: .accent),
            SectionEntry(id: "timeline", title: "밤사이 타임라인", meta: timelineSectionMeta, tone: .ring),
        ]
        if displayBriefing?.anomaly != nil {
            entries.append(SectionEntry(id: "anomaly", title: "이상 신호 확인", meta: "1건", tone: .rose))
        }
        entries.append(SectionEntry(id: "actions", title: "액션 초안", meta: "메시지 · 실험 · 태스크", tone: .amber))
        return entries
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
                .padding(.horizontal, 6)
                .padding(.bottom, 12)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.nav")
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
            syncBar
            Divider().overlay(OpenDesignDayColor.borderSoft)

            if isLocked {
                lockedState
            } else if displayBriefing == nil && collecting {
                collectingState
            } else {
                ScrollViewReader { proxy in
                    ScrollView {
                        VStack(alignment: .leading, spacing: 0) {
                            sectionHeading(id: "summary", title: "밤사이 한 줄 요약", meta: windowMetaLabel, markerColor: OpenDesignDayColor.accent)
                            summaryCard

                            sectionHeading(id: "sources", title: "세 소스 · 어제 대비", meta: "표본 작음 · 단정보다 방향", markerColor: OpenDesignDayColor.accent)
                            sourceCardsGrid

                            if let guide = displayBriefing?.connectGuide {
                                connectGuideCard(guide)
                            }

                            sectionHeading(id: "timeline", title: "밤사이 타임라인", meta: "자동 수집 · 사람 개입 0", markerColor: OpenDesignDayColor.amber)
                            timelineList

                            if let anomaly = displayBriefing?.anomaly {
                                sectionHeading(id: "anomaly", title: "이상 신호 · 확인 1건", meta: "평소엔 요약만, 이상할 때만 물어봄", markerColor: OpenDesignDayColor.rose)
                                anomalyPicker(anomaly)
                            }

                            sectionHeading(id: "actions", title: "액션 초안 · \(displayBriefing?.actions?.count ?? 0)", meta: "요약을 넘어 바로 쓸 수 있게 — 검토 후 적용", markerColor: OpenDesignDayColor.accent)
                            actionDrafts

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
                    if let synced = displayBriefing?.sync?.syncedAtLabel {
                        Text("·").foregroundStyle(OpenDesignDayColor.mutedDeep)
                        Text("\(synced) 동기화")
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
                    Image(systemName: "arrow.clockwise")
                        .font(.system(size: 10, weight: .semibold))
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

            Button(action: startToday) {
                HStack(spacing: 6) {
                    Text("Day \(day) 시작")
                    Image(systemName: "arrow.right")
                        .font(.system(size: 10, weight: .bold))
                }
                .font(.system(size: 11.5, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.bgDeep)
                .padding(.horizontal, 14)
                .frame(height: 28)
                .background(Capsule().fill(OpenDesignDayColor.accent))
                .contentShape(Capsule())
            }
            .buttonStyle(.plain)
            .accessibilityIdentifier("morningBriefing.startDay")
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
        let ready = source.state == "ready"
        return HStack(spacing: 7) {
            Circle()
                .fill(ready ? OpenDesignDayColor.accent : OpenDesignDayColor.amber)
                .frame(width: 6, height: 6)
            Text(source.label ?? source.id)
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
            Text(ready ? "연결됨" : "미연결")
                .foregroundStyle(ready ? OpenDesignDayColor.fg : OpenDesignDayColor.muted)
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
                Text(windowMetaLabel)
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.muted)
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

    private func sourceLogoColor(_ id: String) -> Color {
        switch id {
        case "cloudflare": return OpenDesignDayColor.amber
        case "posthog": return OpenDesignDayColor.violet
        default: return OpenDesignDayColor.fg
        }
    }

    private func sourceLogoSymbol(_ id: String) -> String {
        switch id {
        case "cloudflare": return "cloud"
        case "posthog": return "chart.line.uptrend.xyaxis"
        default: return "chevron.left.forwardslash.chevron.right"
        }
    }

    private func sourceCard(_ card: MorningBriefingCard) -> some View {
        VStack(alignment: .leading, spacing: 11) {
            HStack(spacing: 9) {
                Image(systemName: sourceLogoSymbol(card.id))
                    .font(.system(size: 11, weight: .medium))
                    .foregroundStyle(sourceLogoColor(card.id))
                    .frame(width: 24, height: 24)
                    .background(
                        RoundedRectangle(cornerRadius: 7, style: .continuous)
                            .fill(sourceLogoColor(card.id).opacity(0.13))
                            .overlay(
                                RoundedRectangle(cornerRadius: 7, style: .continuous)
                                    .stroke(sourceLogoColor(card.id).opacity(0.35), lineWidth: 1)
                            )
                    )
                VStack(alignment: .leading, spacing: 1) {
                    Text(card.label ?? card.id)
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    Text(card.subtitle ?? "")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
            }

            if card.isReady, let metric = card.metric {
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
                Text(card.note ?? "연결되지 않음")
                    .font(.system(size: 11.5))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(.vertical, 12)
            }

            Spacer(minLength: 0)

            Divider().overlay(OpenDesignDayColor.borderSoft)
            HStack {
                HStack(spacing: 6) {
                    Circle()
                        .fill(card.noteTone == "warn" ? OpenDesignDayColor.amber : OpenDesignDayColor.muted)
                        .frame(width: 5, height: 5)
                    Text(card.isReady ? (card.note ?? "") : "연결 필요")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(card.noteTone == "warn" ? OpenDesignDayColor.amber : OpenDesignDayColor.mutedDeep)
                        .lineLimit(1)
                }
                Spacer()
                if card.isReady {
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
            }
        }
        .padding(EdgeInsets(top: 15, leading: 15, bottom: 13, trailing: 15))
        .frame(maxWidth: .infinity, minHeight: 200, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.card.\(card.id)")
    }

    private func metricValueLabel(_ value: Double?) -> String {
        guard let value else { return "–" }
        if value == value.rounded() {
            return String(Int(value))
        }
        return String(format: "%.1f", value)
    }

    private func sparkline(_ card: MorningBriefingCard) -> some View {
        let values = card.spark ?? []
        let color = card.metric?.direction == "down" ? OpenDesignDayColor.rose : (card.id == "cloudflare" ? OpenDesignDayColor.amber : OpenDesignDayColor.accent)
        return Group {
            if values.count >= 2, let min = values.min(), let max = values.max() {
                GeometryReader { geo in
                    let range = Swift.max(max - min, 1)
                    let points = values.enumerated().map { index, value in
                        CGPoint(
                            x: geo.size.width * CGFloat(index) / CGFloat(values.count - 1),
                            y: geo.size.height * (1 - CGFloat((value - min) / range) * 0.8 - 0.1)
                        )
                    }
                    ZStack {
                        Path { path in
                            guard let first = points.first else { return }
                            path.move(to: first)
                            for point in points.dropFirst() {
                                path.addLine(to: point)
                            }
                        }
                        .stroke(color, style: StrokeStyle(lineWidth: 1.8, lineCap: .round, lineJoin: .round))

                        if let last = points.last {
                            Circle()
                                .fill(color)
                                .frame(width: 5, height: 5)
                                .position(last)
                        }
                    }
                }
                .frame(height: 30)
            } else {
                Rectangle()
                    .fill(Color.clear)
                    .frame(height: 30)
            }
        }
    }

    // MARK: - Timeline

    private var timelineList: some View {
        let events = displayBriefing?.timeline ?? []
        return VStack(spacing: 1) {
            if events.isEmpty {
                Text("밤사이 타임스탬프가 있는 이벤트가 없어요.")
                    .font(.system(size: 12))
                    .foregroundStyle(OpenDesignDayColor.muted)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .padding(16)
                    .background(OpenDesignDayColor.surface)
            } else {
                ForEach(Array(events.enumerated()), id: \.offset) { _, event in
                    HStack(alignment: .firstTextBaseline, spacing: 12) {
                        Text(event.timeLabel ?? "")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .frame(width: 70, alignment: .leading)
                        Image(systemName: sourceLogoSymbol(event.source ?? ""))
                            .font(.system(size: 11))
                            .foregroundStyle(sourceLogoColor(event.source ?? ""))
                            .frame(width: 22)
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
        VStack(alignment: .leading, spacing: 0) {
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
            }
            .padding(EdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14))
            .background(OpenDesignDayColor.surface2)

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
                .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
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
                            Image(systemName: sourceLogoSymbol(source.id == "git" || source.id == "gh_cli" ? "github" : source.id))
                                .font(.system(size: 11))
                                .foregroundStyle(OpenDesignDayColor.muted)
                                .frame(width: 22)
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
                            Text(synced)
                                .font(.system(size: 11, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.muted)
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
                                Image(systemName: sourceLogoSymbol(card.id))
                                    .font(.system(size: 11))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                                    .frame(width: 22)
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

    private var collectingState: some View {
        VStack(spacing: 12) {
            ProgressView()
                .controlSize(.small)
            Text("밤사이 신호를 모으는 중…")
                .font(.system(size: 12, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .accessibilityIdentifier("morningBriefing.collecting")
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

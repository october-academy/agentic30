import AppKit
import SwiftUI

/// Per-source drilldown screen for the morning briefing
/// (OD references: briefing-cloudflare.html / briefing-github.html /
/// briefing-posthog.html). Fully data-driven from `MorningBriefingDrilldown`;
/// sections render only when the sidecar produced real data for them.
struct MorningBriefingDrilldownView: View {
    let drilldown: MorningBriefingDrilldown
    let briefing: MorningBriefing?
    let day: Int
    let onSelectSource: (String) -> Void
    let onBack: () -> Void
    let applyAction: (MorningBriefingActionDraft) -> Void
    let showToast: (String) -> Void

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @State private var activeSectionID = ""
    @State private var sectionScrollRequest: MorningBriefingScrollRequest?
    @State private var appliedDraftIDs: Set<String> = []
    @State private var copiedDraftIDs: Set<String> = []
    @State private var hoveredChartBarIndex: Int?

    private static let sourceOrder = ["cloudflare", "github", "posthog"]

    var body: some View {
        GeometryReader { geometry in
            let showsNav = geometry.size.width >= 900
            let showsMeta = geometry.size.width >= 1120

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
            // Identifier sits on the inner HStack, not the GeometryReader root:
            // the parent screen's contain-container shares the root's frame and
            // swallows a same-sized child container's identifier in the
            // accessibility tree.
            .accessibilityElement(children: .contain)
            .accessibilityIdentifier("morningBriefing.drilldown.\(drilldown.id)")
        }
        .background(OpenDesignDayColor.bg)
        .onAppear { activeSectionID = sections.first?.id ?? "" }
    }

    // MARK: - Tones / symbols

    private func toneColor(_ tone: String?) -> Color {
        switch tone {
        case "amber": return OpenDesignDayColor.amber
        case "rose": return OpenDesignDayColor.rose
        case "violet": return OpenDesignDayColor.violet
        case "sky": return OpenDesignDayColor.sky
        case "muted", "off": return OpenDesignDayColor.mutedDeep
        default: return OpenDesignDayColor.accent
        }
    }

    private var sourceTone: Color {
        switch drilldown.id {
        case "cloudflare": return OpenDesignDayColor.amber
        case "posthog": return OpenDesignDayColor.violet
        default: return OpenDesignDayColor.fg
        }
    }

    private var sourceBadge: String {
        switch drilldown.id {
        case "cloudflare": return "CF"
        case "posthog": return "PH"
        default: return "GH"
        }
    }

    private func deltaColor(_ direction: String?) -> Color {
        switch direction {
        case "up": return OpenDesignDayColor.accent
        case "down": return OpenDesignDayColor.rose
        default: return OpenDesignDayColor.muted
        }
    }

    // MARK: - Sections (left nav anchors)

    private struct SectionEntry: Identifiable {
        let id: String
        let title: String
        let meta: String
        let tone: String
    }

    private var sections: [SectionEntry] {
        var entries: [SectionEntry] = []
        if !(drilldown.kpis ?? []).isEmpty {
            entries.append(SectionEntry(id: "kpi", title: "핵심 지표", meta: "\((drilldown.kpis ?? []).count)", tone: "ring"))
        }
        if let chart = drilldown.chart {
            entries.append(SectionEntry(id: "chart", title: chart.title ?? "추이", meta: chart.subtitle ?? "", tone: drilldown.id == "posthog" ? "rose" : "ring"))
        }
        if !(drilldown.table ?? []).isEmpty {
            entries.append(SectionEntry(id: "table", title: "경로별 페이지뷰", meta: "Top \((drilldown.table ?? []).count)", tone: "ring"))
        }
        if !(drilldown.listRows ?? []).isEmpty {
            entries.append(SectionEntry(id: "list", title: "PR · 배포", meta: drilldown.listMeta ?? "\((drilldown.listRows ?? []).count)건", tone: "ring"))
        }
        if drilldown.funnel != nil {
            entries.append(SectionEntry(id: "funnel", title: "온보딩 깔때기", meta: "이탈 지점", tone: "ring"))
        }
        if !(drilldown.signals ?? []).isEmpty {
            entries.append(SectionEntry(id: "signals", title: drilldown.id == "cloudflare" ? "봇 필터" : "코호트·표본", meta: "\((drilldown.signals ?? []).count)건", tone: "ring"))
        }
        if !(drilldown.webSignals ?? []).isEmpty {
            entries.append(SectionEntry(id: "web", title: "웹 신호", meta: drilldown.webMeta ?? "\((drilldown.webSignals ?? []).count)건", tone: "amber"))
        }
        if !(drilldown.drafts ?? []).isEmpty || drilldown.draftsEmpty != nil {
            entries.append(SectionEntry(id: "action", title: "액션 초안", meta: (drilldown.drafts ?? []).isEmpty ? "없음" : "\((drilldown.drafts ?? []).count)", tone: (drilldown.drafts ?? []).isEmpty ? "ring" : "amber"))
        }
        if !(drilldown.maintenance ?? []).isEmpty {
            entries.append(SectionEntry(id: "keep", title: "유지보수 제안", meta: "\((drilldown.maintenance ?? []).count)건", tone: "amber"))
        }
        return entries
    }

    // MARK: - Left nav

    private struct SourceNavEntry: Identifiable {
        let id: String
        let title: String
        let meta: String
        let metaTone: String?
        let dotTone: String
        let available: Bool
    }

    private var sourceNavEntries: [SourceNavEntry] {
        Self.sourceOrder.map { id in
            let card = briefing?.cards?.first(where: { $0.id == id })
            let metric = card?.metric
            var meta = ""
            var metaTone: String? = nil
            if let delta = metric?.deltaLabel, let unit = metric?.unit {
                meta = "\(unit) \(delta)"
                metaTone = metric?.direction
            } else if let note = card?.note, !note.isEmpty {
                meta = note
            }
            let dotTone: String = id == "cloudflare" ? "amber" : id == "posthog" ? "rose" : "accent"
            return SourceNavEntry(
                id: id,
                title: card?.label ?? id.capitalized,
                meta: meta,
                metaTone: metaTone,
                dotTone: dotTone,
                available: briefing?.drilldowns?[id] != nil
            )
        }
    }

    private var sectionNav: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Text("드릴다운")
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(OpenDesignDayColor.fg)
                Text(drilldown.title?.components(separatedBy: " ").first ?? drilldown.id)
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
                    navGroupLabel("소스")
                    ForEach(sourceNavEntries) { entry in
                        sourceNavRow(entry)
                    }
                    navGroupLabel("이 소스")
                    ForEach(sections) { section in
                        sectionNavRow(section)
                    }
                }
                .padding(.horizontal, 6)
                .padding(.bottom, 12)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.drilldown.nav")
    }

    private func navGroupLabel(_ title: String) -> some View {
        Text(title.uppercased())
            .font(.system(size: 10, design: .monospaced))
            .kerning(1.0)
            .foregroundStyle(OpenDesignDayColor.mutedDeep)
            .padding(.horizontal, 8)
            .padding(.top, 14)
            .padding(.bottom, 6)
    }

    private func sourceNavRow(_ entry: SourceNavEntry) -> some View {
        let isActive = entry.id == drilldown.id
        return Button {
            guard entry.available, !isActive else { return }
            onSelectSource(entry.id)
        } label: {
            HStack(alignment: .top, spacing: 9) {
                Circle()
                    .fill(toneColor(entry.dotTone))
                    .frame(width: 8, height: 8)
                    .background(Circle().fill(toneColor(entry.dotTone).opacity(0.18)).frame(width: 14, height: 14))
                    .frame(width: 14, height: 14)
                    .padding(.top, 3)
                VStack(alignment: .leading, spacing: 2) {
                    Text(entry.title)
                        .font(.system(size: 12.5, weight: .medium))
                        .lineLimit(1)
                    Text(entry.meta)
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(entry.metaTone == "down" ? OpenDesignDayColor.rose : entry.metaTone == "up" ? OpenDesignDayColor.accent : OpenDesignDayColor.muted)
                        .lineLimit(1)
                }
                Spacer(minLength: 0)
            }
            .padding(.horizontal, 10)
            .padding(.vertical, 8)
            .frame(maxWidth: .infinity, alignment: .leading)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(isActive ? OpenDesignDayColor.selected : Color.clear)
            )
            .foregroundStyle(isActive ? OpenDesignDayColor.fg : OpenDesignDayColor.fgSecondary)
            .opacity(entry.available || isActive ? 1 : 0.5)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityIdentifier("morningBriefing.drilldown.source.\(entry.id)")
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
                    if section.tone == "ring" {
                        Circle()
                            .stroke(OpenDesignDayColor.mutedDeep, lineWidth: 1.5)
                            .frame(width: 11, height: 11)
                    } else {
                        Circle()
                            .fill(toneColor(section.tone))
                            .frame(width: 8, height: 8)
                            .background(Circle().fill(toneColor(section.tone).opacity(0.18)).frame(width: 14, height: 14))
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
        .accessibilityIdentifier("morningBriefing.drilldown.nav.\(section.id)")
    }

    // MARK: - Main column

    private var nextSourceID: String? {
        let available = Self.sourceOrder.filter { briefing?.drilldowns?[$0] != nil && $0 != drilldown.id }
        guard !available.isEmpty else { return nil }
        if let index = Self.sourceOrder.firstIndex(of: drilldown.id) {
            let after = Self.sourceOrder[(index + 1)...] + Self.sourceOrder[..<index]
            return after.first(where: { available.contains($0) })
        }
        return available.first
    }

    private func sourceDisplayName(_ id: String) -> String {
        briefing?.cards?.first(where: { $0.id == id })?.label ?? id.capitalized
    }

    private var mainColumn: some View {
        VStack(spacing: 0) {
            mainHeader
            Divider().overlay(OpenDesignDayColor.borderSoft)
            if !(drilldown.syncPills ?? []).isEmpty {
                syncBar
                Divider().overlay(OpenDesignDayColor.borderSoft)
            }

            ScrollViewReader { proxy in
                ScrollView {
                    VStack(alignment: .leading, spacing: 0) {
                        if !(drilldown.kpis ?? []).isEmpty {
                            sectionHeading(id: "kpi", title: "핵심 지표", meta: drilldown.kpisMeta ?? "", tone: drilldown.id == "cloudflare" ? "amber" : "accent")
                            kpiGrid
                        }
                        if let chart = drilldown.chart {
                            sectionHeading(id: "chart", title: chart.title ?? "추이", meta: chart.subtitle ?? "", tone: chart.kind == "curve" ? "rose" : (drilldown.id == "cloudflare" ? "amber" : "accent"))
                            chartCard(chart)
                        }
                        if let table = drilldown.table, !table.isEmpty {
                            sectionHeading(id: "table", title: "경로별 페이지뷰", meta: "Top \(table.count)", tone: "amber")
                            pathTable(table)
                        }
                        if let rows = drilldown.listRows, !rows.isEmpty {
                            sectionHeading(id: "list", title: "PR · 배포", meta: drilldown.listMeta ?? "", tone: "violet")
                            prList(rows)
                        }
                        if let scan = drilldown.scan, !scan.isEmpty {
                            sectionHeading(id: "scan", title: "레포 전체 스캔", meta: "커밋·PR 밖 \(scan.count)개 영역 · 신호만 골라 카드로", tone: "sky")
                            scanGrid(scan)
                        }
                        if let funnel = drilldown.funnel {
                            sectionHeading(id: "funnel", title: "온보딩 깔때기", meta: "이탈 지점", tone: "rose")
                            funnelView(funnel)
                        }
                        if let signals = drilldown.signals, !signals.isEmpty {
                            sectionHeading(
                                id: "signals",
                                title: drilldown.id == "cloudflare" ? "봇 필터" : "코호트 신호",
                                meta: drilldown.id == "cloudflare" ? "사람 방문만 브리핑에 반영" : "표본 작음 · 방향만",
                                tone: drilldown.id == "cloudflare" ? "accent" : "rose"
                            )
                            signalList(signals)
                        }
                        if let webSignals = drilldown.webSignals, !webSignals.isEmpty {
                            sectionHeading(id: "web", title: "웹 신호", meta: drilldown.webMeta ?? "", tone: "amber")
                            signalList(webSignals)
                        }
                        if !(drilldown.drafts ?? []).isEmpty {
                            sectionHeading(id: "action", title: "액션 초안 · \((drilldown.drafts ?? []).count)", meta: "검토 후 적용", tone: drilldown.id == "posthog" ? "violet" : "amber")
                            VStack(spacing: 10) {
                                ForEach(drilldown.drafts ?? []) { draft in
                                    draftCard(draft)
                                }
                            }
                        } else if let empty = drilldown.draftsEmpty {
                            sectionHeading(id: "action", title: "액션 초안", meta: "오늘은 없음", tone: "accent")
                            draftsEmptyCard(empty)
                        }
                        if let maintenance = drilldown.maintenance, !maintenance.isEmpty {
                            sectionHeading(id: "keep", title: "유지보수 제안", meta: "급하지 않음 · 검토만 하면 초안은 Agentic30이 준비", tone: "amber")
                            VStack(spacing: 10) {
                                ForEach(maintenance) { draft in
                                    draftCard(draft)
                                }
                            }
                        }

                        Spacer(minLength: 40)
                    }
                    .frame(maxWidth: 860)
                    .frame(maxWidth: .infinity)
                    .padding(.horizontal, 28)
                    .padding(.top, 22)
                }
                .coordinateSpace(name: "morningBriefingDrillScroll")
                .onChange(of: sectionScrollRequest) { _, request in
                    guard let request else { return }
                    withAnimation(.easeOut(duration: reduceMotion ? 0 : 0.25)) {
                        proxy.scrollTo(request.id, anchor: .top)
                    }
                }
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
        .background(OpenDesignDayColor.bg)
    }

    private var mainHeader: some View {
        HStack(spacing: 14) {
            Text(sourceBadge)
                .font(.system(size: 17, weight: .bold, design: .monospaced))
                .foregroundStyle(sourceTone)
                // Per-source leaf identifier: container identifiers on the
                // screen-sized swap views don't surface in the accessibility
                // tree, so UI tests key off this badge instead.
                .accessibilityIdentifier("morningBriefing.drilldown.head.\(drilldown.id)")
                .frame(width: 44, height: 44)
                .background(
                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                        .fill(sourceTone.opacity(0.14))
                        .overlay(
                            RoundedRectangle(cornerRadius: 11, style: .continuous)
                                .stroke(sourceTone.opacity(0.4), lineWidth: 1)
                        )
                )

            VStack(alignment: .leading, spacing: 2) {
                Text(drilldown.title ?? "")
                    .font(.system(size: 17, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .lineLimit(1)
                HStack(spacing: 8) {
                    Circle().fill(sourceTone).frame(width: 5, height: 5)
                    Text(drilldown.subtitle ?? "")
                        .lineLimit(1)
                }
                .font(.system(size: 11, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
            }

            Spacer()

            Button(action: onBack) {
                HStack(spacing: 6) {
                    Image(systemName: "arrow.left")
                        .font(.system(size: 10, weight: .semibold))
                    Text("아침 브리핑")
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
            .accessibilityIdentifier("morningBriefing.drilldown.back")

            if let nextID = nextSourceID {
                Button {
                    onSelectSource(nextID)
                } label: {
                    HStack(spacing: 6) {
                        Text(sourceDisplayName(nextID))
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
                .accessibilityIdentifier("morningBriefing.drilldown.next")
            }
        }
        .padding(.horizontal, 28)
        .frame(height: 70)
    }

    private var syncBar: some View {
        HStack(spacing: 8) {
            ForEach(Array((drilldown.syncPills ?? []).enumerated()), id: \.offset) { index, pill in
                HStack(spacing: 7) {
                    Circle()
                        .fill(index == 0 ? sourceTone : OpenDesignDayColor.muted)
                        .frame(width: 6, height: 6)
                    Text(pill)
                        .foregroundStyle(OpenDesignDayColor.fgSecondary)
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
            Spacer(minLength: 8)
            if let synced = briefing?.sync?.syncedAtLabel {
                HStack(spacing: 6) {
                    Image(systemName: "clock")
                        .font(.system(size: 10))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    Text("\(synced) 동기화")
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                }
            }
        }
        .padding(.horizontal, 28)
        .frame(height: 50)
    }

    private func sectionHeading(id: String, title: String, meta: String, tone: String) -> some View {
        HStack(spacing: 10) {
            RoundedRectangle(cornerRadius: 2)
                .fill(toneColor(tone))
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
                    .lineLimit(1)
            }
        }
        .padding(.top, 26)
        .padding(.bottom, 12)
        .id(id)
        .background(
            GeometryReader { geo in
                Color.clear.preference(
                    key: MorningBriefingSectionOffsetKey.self,
                    value: [id: geo.frame(in: .named("morningBriefingDrillScroll")).minY]
                )
            }
        )
    }

    // MARK: - KPI grid

    private var kpiGrid: some View {
        LazyVGrid(columns: Array(repeating: GridItem(.flexible(), spacing: 10), count: min(4, max(1, (drilldown.kpis ?? []).count))), spacing: 10) {
            ForEach(Array((drilldown.kpis ?? []).enumerated()), id: \.offset) { _, kpi in
                kpiCell(kpi)
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.drilldown.kpis")
    }

    private func kpiCell(_ kpi: MorningBriefingDrillKpi) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(kpi.label ?? "")
                .font(.system(size: 10.5, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.muted)
                .lineLimit(1)
            HStack(alignment: .firstTextBaseline, spacing: 8) {
                Text(kpi.valueLabel ?? "")
                    .font(.system(size: 22, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .monospacedDigit()
                    .lineLimit(1)
                    .minimumScaleFactor(0.7)
                if let delta = kpi.deltaLabel {
                    Text(delta)
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(deltaColor(kpi.direction))
                        .padding(.horizontal, 7)
                        .padding(.vertical, 2)
                        .background(
                            Capsule()
                                .fill(deltaColor(kpi.direction).opacity(0.13))
                                .overlay(Capsule().stroke(deltaColor(kpi.direction).opacity(0.35), lineWidth: 1))
                        )
                        .lineLimit(1)
                }
            }
            if let vs = kpi.vsLabel {
                Text(vs)
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .lineLimit(1)
            }
        }
        .padding(EdgeInsets(top: 13, leading: 14, bottom: 13, trailing: 14))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(kpi.flag == true ? OpenDesignDayColor.rose.opacity(0.36) : OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
        )
    }

    // MARK: - Chart card

    private func chartCard(_ chart: MorningBriefingDrillChart) -> some View {
        VStack(alignment: .leading, spacing: 12) {
            HStack(alignment: .top) {
                VStack(alignment: .leading, spacing: 2) {
                    Text(chart.title ?? "")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                    if let subtitle = chart.subtitle {
                        Text(subtitle)
                            .font(.system(size: 10.5, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                    }
                }
                Spacer()
                HStack(spacing: 10) {
                    ForEach(Array((chart.legend ?? []).enumerated()), id: \.offset) { _, item in
                        HStack(spacing: 5) {
                            RoundedRectangle(cornerRadius: 2)
                                .fill(toneColor(item.tone))
                                .frame(width: 9, height: 9)
                            Text(item.label ?? "")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.muted)
                        }
                    }
                }
            }

            if chart.kind == "curve" {
                curveChart(chart)
            } else {
                barChart(chart)
            }

            if let footnote = chart.footnote {
                HStack(spacing: 7) {
                    Circle()
                        .fill(chart.kind == "curve" ? OpenDesignDayColor.rose : toneColor(chart.legend?.last?.tone ?? "accent"))
                        .frame(width: 6, height: 6)
                    Text(footnote)
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                .padding(.top, 2)
            }
        }
        .padding(EdgeInsets(top: 15, leading: 16, bottom: 14, trailing: 16))
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
        )
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.drilldown.chart")
    }

    private func barChart(_ chart: MorningBriefingDrillChart) -> some View {
        let bars = chart.bars ?? []
        let unitLabel = normalizedTooltipText(chart.legend?.first?.label) ?? "값"
        return HStack(alignment: .bottom, spacing: 6) {
            ForEach(Array(bars.enumerated()), id: \.offset) { index, bar in
                VStack(spacing: 5) {
                    GeometryReader { geo in
                        VStack {
                            Spacer(minLength: 0)
                            RoundedRectangle(cornerRadius: 3, style: .continuous)
                                .fill(toneColor(bar.tone ?? "accent").opacity(bar.tone == "muted" ? 0.55 : 0.92))
                                .frame(height: max(3, geo.size.height * CGFloat(bar.ratio ?? 0)))
                        }
                    }
                    .frame(height: 96)
                    Text(bar.label ?? "")
                        .font(.system(size: 9.5, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .lineLimit(1)
                }
                .frame(maxWidth: .infinity)
                .contentShape(Rectangle())
                .overlay(alignment: .top) {
                    if hoveredChartBarIndex == index {
                        barTooltip(bar, unitLabel: unitLabel)
                            .offset(y: -8)
                            .zIndex(10)
                    }
                }
                .onHover { hovering in
                    hoveredChartBarIndex = hovering ? index : (hoveredChartBarIndex == index ? nil : hoveredChartBarIndex)
                }
                .help(bar.tip ?? "")
                .accessibilityElement(children: .contain)
                .accessibilityLabel(barTooltipAccessibilityLabel(bar, unitLabel: unitLabel))
                .accessibilityIdentifier("morningBriefing.drilldown.chart.bar.\(index)")
                .zIndex(hoveredChartBarIndex == index ? 1 : 0)
            }
        }
        .onDisappear { hoveredChartBarIndex = nil }
    }

    private func barTooltip(_ bar: MorningBriefingDrillBar, unitLabel: String) -> some View {
        VStack(alignment: .leading, spacing: 3) {
            Text(barTooltipTitle(bar))
                .font(.system(size: 9.5, weight: .medium, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.fg)
                .lineLimit(1)
            Text(barTooltipValueLabel(bar, unitLabel: unitLabel))
                .font(.system(size: 10.5, weight: .semibold, design: .monospaced))
                .foregroundStyle(OpenDesignDayColor.amber)
                .lineLimit(1)
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
        .accessibilityLabel(barTooltipAccessibilityLabel(bar, unitLabel: unitLabel))
        .accessibilityIdentifier("morningBriefing.drilldown.chart.tooltip")
    }

    private func barTooltipTitle(_ bar: MorningBriefingDrillBar) -> String {
        normalizedTooltipText(bar.tip) ?? normalizedTooltipText(bar.label).map { "\($0)시 구간" } ?? "시간대"
    }

    private func barTooltipValueLabel(_ bar: MorningBriefingDrillBar, unitLabel: String) -> String {
        "\(unitLabel) \(formatChartValue(bar.value))"
    }

    private func barTooltipAccessibilityLabel(_ bar: MorningBriefingDrillBar, unitLabel: String) -> String {
        "\(barTooltipTitle(bar)) · \(barTooltipValueLabel(bar, unitLabel: unitLabel))"
    }

    private func normalizedTooltipText(_ text: String?) -> String? {
        guard let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines), !trimmed.isEmpty else {
            return nil
        }
        return trimmed
    }

    private func formatChartValue(_ value: Double?) -> String {
        guard let value else { return "0" }
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

    private func curveChart(_ chart: MorningBriefingDrillChart) -> some View {
        let points = chart.points ?? []
        return VStack(spacing: 6) {
            GeometryReader { geo in
                let values = points.map { CGFloat($0.pct ?? 0) }
                let maxValue = max(values.max() ?? 1, 1)
                let coords = values.enumerated().map { index, value in
                    CGPoint(
                        x: values.count > 1 ? geo.size.width * CGFloat(index) / CGFloat(values.count - 1) : 0,
                        y: geo.size.height * (1 - (value / maxValue) * 0.82 - 0.08)
                    )
                }
                ZStack {
                    if let baseline = chart.baselinePct {
                        let y = geo.size.height * (1 - (CGFloat(baseline) / maxValue) * 0.82 - 0.08)
                        Path { path in
                            path.move(to: CGPoint(x: 0, y: y))
                            path.addLine(to: CGPoint(x: geo.size.width, y: y))
                        }
                        .stroke(OpenDesignDayColor.mutedDeep.opacity(0.7), style: StrokeStyle(lineWidth: 1, dash: [4, 4]))
                    }
                    if coords.count > 1 {
                        Path { path in
                            path.move(to: CGPoint(x: coords[0].x, y: geo.size.height))
                            for coord in coords { path.addLine(to: coord) }
                            path.addLine(to: CGPoint(x: coords[coords.count - 1].x, y: geo.size.height))
                            path.closeSubpath()
                        }
                        .fill(OpenDesignDayColor.rose.opacity(0.12))
                        Path { path in
                            path.move(to: coords[0])
                            for coord in coords.dropFirst() { path.addLine(to: coord) }
                        }
                        .stroke(OpenDesignDayColor.rose, style: StrokeStyle(lineWidth: 2, lineCap: .round, lineJoin: .round))
                    }
                    ForEach(Array(coords.enumerated()), id: \.offset) { index, coord in
                        Circle()
                            .fill(OpenDesignDayColor.rose.opacity(index == coords.count - 1 ? 1 : 0.5))
                            .frame(width: index == coords.count - 1 ? 7 : 5, height: index == coords.count - 1 ? 7 : 5)
                            .position(coord)
                            .help(points[index].tip ?? points[index].label ?? "")
                            .accessibilityLabel(points[index].tip ?? points[index].label ?? "")
                    }
                }
            }
            .frame(height: 120)

            HStack {
                ForEach(Array(points.enumerated()), id: \.offset) { index, point in
                    Text(point.label ?? "")
                        .font(.system(size: 9.5, design: .monospaced))
                        .foregroundStyle(index == points.count - 1 ? OpenDesignDayColor.rose : OpenDesignDayColor.mutedDeep)
                        .frame(maxWidth: .infinity, alignment: index == 0 ? .leading : index == points.count - 1 ? .trailing : .center)
                        .lineLimit(1)
                        .help(point.tip ?? point.label ?? "")
                }
            }
        }
    }

    // MARK: - Path table (cloudflare)

    private func pathTable(_ rows: [MorningBriefingDrillTableRow]) -> some View {
        VStack(spacing: 1) {
            HStack(spacing: 12) {
                Text("#").frame(width: 18, alignment: .leading)
                Text("경로").frame(width: 150, alignment: .leading)
                Text("비중").frame(maxWidth: .infinity, alignment: .leading)
                Text("PV").frame(width: 80, alignment: .trailing)
            }
            .font(.system(size: 10, design: .monospaced))
            .foregroundStyle(OpenDesignDayColor.mutedDeep)
            .padding(.horizontal, 16)
            .padding(.vertical, 8)
            .background(OpenDesignDayColor.surface2)

            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 12) {
                    Text("\(row.rank ?? 0)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .frame(width: 18, alignment: .leading)
                    HStack(spacing: 6) {
                        Text(row.code ?? "")
                            .font(.system(size: 11, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.accent)
                            .padding(.horizontal, 5)
                            .padding(.vertical, 1)
                            .background(
                                RoundedRectangle(cornerRadius: 4, style: .continuous)
                                    .fill(OpenDesignDayColor.bgDarker)
                                    .overlay(
                                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                                            .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                                    )
                            )
                        Text(row.label ?? "")
                            .font(.system(size: 12, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.fg)
                            .lineLimit(1)
                    }
                    .frame(width: 150, alignment: .leading)
                    GeometryReader { geo in
                        ZStack(alignment: .leading) {
                            Capsule().fill(OpenDesignDayColor.bgDeep)
                            Capsule()
                                .fill(OpenDesignDayColor.amber)
                                .frame(width: max(3, geo.size.width * CGFloat(row.ratio ?? 0)))
                        }
                    }
                    .frame(height: 5)
                    .frame(maxWidth: .infinity)
                    HStack(spacing: 4) {
                        Text(row.valueLabel ?? "")
                            .font(.system(size: 12, weight: .medium, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.fg)
                        if let share = row.share {
                            Text("\(Int(share))%")
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        }
                    }
                    .frame(width: 80, alignment: .trailing)
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 10)
                .background(OpenDesignDayColor.surface)
            }
        }
        .background(OpenDesignDayColor.borderSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
        )
        .accessibilityIdentifier("morningBriefing.drilldown.table")
    }

    // MARK: - PR / deploy list (github)

    private func listRowIcon(_ kind: String?) -> (symbol: String, color: Color) {
        switch kind {
        case "merged": return ("arrow.triangle.merge", OpenDesignDayColor.violet)
        case "deploy": return ("crown", OpenDesignDayColor.accent)
        default: return ("arrow.triangle.branch", OpenDesignDayColor.accent)
        }
    }

    private func prList(_ rows: [MorningBriefingDrillListRow]) -> some View {
        VStack(spacing: 1) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(alignment: .center, spacing: 12) {
                    let icon = listRowIcon(row.kind)
                    Image(systemName: icon.symbol)
                        .font(.system(size: 11))
                        .foregroundStyle(icon.color)
                        .frame(width: 22)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(row.title ?? "")
                            .font(.system(size: 12.5, weight: .semibold))
                            .foregroundStyle(OpenDesignDayColor.fg)
                            .lineLimit(1)
                        if !(row.metaItems ?? []).isEmpty {
                            HStack(spacing: 8) {
                                ForEach(Array((row.metaItems ?? []).enumerated()), id: \.offset) { _, item in
                                    Text(item)
                                        .foregroundStyle(
                                            item.hasPrefix("+") ? OpenDesignDayColor.diffAdd
                                                : item.hasPrefix("−") ? OpenDesignDayColor.diffDel
                                                : OpenDesignDayColor.muted
                                        )
                                }
                            }
                            .font(.system(size: 10.5, design: .monospaced))
                        }
                    }
                    Spacer(minLength: 8)
                    if let tag = row.tag {
                        Text(tag)
                            .font(.system(size: 10, weight: .semibold, design: .monospaced))
                            .foregroundStyle(listRowIcon(row.kind).color)
                            .padding(.horizontal, 8)
                            .padding(.vertical, 2)
                            .background(
                                Capsule()
                                    .fill(listRowIcon(row.kind).color.opacity(0.13))
                                    .overlay(Capsule().stroke(listRowIcon(row.kind).color.opacity(0.35), lineWidth: 1))
                            )
                    }
                }
                .padding(.horizontal, 16)
                .padding(.vertical, 11)
                .background(OpenDesignDayColor.surface)
            }
        }
        .background(OpenDesignDayColor.borderSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
        )
        .accessibilityIdentifier("morningBriefing.drilldown.list")
    }

    // MARK: - Scan grid (github)

    private func scanGrid(_ cells: [MorningBriefingDrillScanCell]) -> some View {
        LazyVGrid(columns: [GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10), GridItem(.flexible(), spacing: 10)], spacing: 10) {
            ForEach(Array(cells.enumerated()), id: \.offset) { _, cell in
                VStack(alignment: .leading, spacing: 7) {
                    HStack(spacing: 6) {
                        Circle()
                            .fill(cell.tone == "off" ? OpenDesignDayColor.mutedDeep : toneColor(cell.tone))
                            .frame(width: 6, height: 6)
                        Text(cell.title ?? "")
                            .font(.system(size: 11, weight: .medium))
                            .foregroundStyle(OpenDesignDayColor.fgSecondary)
                        Spacer()
                        if let cmd = cell.cmd {
                            Text(cmd)
                                .font(.system(size: 9, design: .monospaced))
                                .foregroundStyle(OpenDesignDayColor.mutedDeep)
                                .lineLimit(1)
                        }
                    }
                    Text(cell.valueLabel ?? "")
                        .font(.system(size: 12.5, weight: .semibold))
                        .foregroundStyle(OpenDesignDayColor.fg)
                        .fixedSize(horizontal: false, vertical: true)
                    if let sub = cell.sub {
                        Text(sub)
                            .font(.system(size: 10.5, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                }
                .padding(EdgeInsets(top: 12, leading: 13, bottom: 12, trailing: 13))
                .frame(maxWidth: .infinity, minHeight: 84, alignment: .topLeading)
                .background(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .fill(OpenDesignDayColor.surface)
                        .overlay(
                            RoundedRectangle(cornerRadius: 12, style: .continuous)
                                .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                        )
                )
                .opacity(cell.quiet == true ? 0.62 : 1)
            }
        }
        .accessibilityIdentifier("morningBriefing.drilldown.scan")
    }

    // MARK: - Funnel (posthog)

    private func funnelView(_ funnel: MorningBriefingDrillFunnel) -> some View {
        let steps = funnel.steps ?? []
        return VStack(alignment: .leading, spacing: 8) {
            ForEach(Array(steps.enumerated()), id: \.offset) { index, step in
                HStack(spacing: 12) {
                    GeometryReader { geo in
                        HStack {
                            Text(step.label ?? "")
                                .font(.system(size: 11.5, weight: .semibold))
                                .foregroundStyle(step.drop == true ? OpenDesignDayColor.rose : OpenDesignDayColor.bgDeep)
                                .padding(.horizontal, 10)
                                .lineLimit(1)
                            Spacer(minLength: 0)
                        }
                        .frame(width: max(90, geo.size.width * CGFloat(step.ratio ?? 0)), height: 30)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(step.drop == true ? OpenDesignDayColor.rose.opacity(0.18) : OpenDesignDayColor.accent.opacity(0.85))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .stroke(step.drop == true ? OpenDesignDayColor.rose.opacity(0.5) : Color.clear, lineWidth: 1)
                                )
                        )
                    }
                    .frame(height: 30)
                    Text(step.valueLabel ?? "")
                        .font(.system(size: 11.5, weight: .medium, design: .monospaced))
                        .foregroundStyle(step.drop == true ? OpenDesignDayColor.rose : OpenDesignDayColor.fgSecondary)
                        .frame(width: 90, alignment: .trailing)
                        .lineLimit(1)
                }

                if let gapIndex = funnel.gapAfterIndex, gapIndex == index, let gapLabel = funnel.gapLabel {
                    Text(gapLabel)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.rose)
                        .padding(.horizontal, 12)
                        .padding(.vertical, 6)
                        .frame(maxWidth: .infinity, alignment: .leading)
                        .background(
                            RoundedRectangle(cornerRadius: 8, style: .continuous)
                                .fill(OpenDesignDayColor.rose.opacity(0.07))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                                        .stroke(OpenDesignDayColor.rose.opacity(0.25), lineWidth: 1)
                                )
                        )
                }
            }
        }
        .padding(EdgeInsets(top: 15, leading: 16, bottom: 15, trailing: 16))
        .background(
            RoundedRectangle(cornerRadius: 13, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 13, style: .continuous)
                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
        )
        .accessibilityIdentifier("morningBriefing.drilldown.funnel")
    }

    // MARK: - Signals

    private func signalList(_ signals: [MorningBriefingDrillSignal]) -> some View {
        VStack(spacing: 1) {
            ForEach(Array(signals.enumerated()), id: \.offset) { _, signal in
                HStack(alignment: .firstTextBaseline, spacing: 12) {
                    Text(signal.time ?? "")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .frame(width: 80, alignment: .leading)
                    Text(signal.text ?? "")
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
        .background(OpenDesignDayColor.borderSoft)
        .clipShape(RoundedRectangle(cornerRadius: 12, style: .continuous))
        .overlay(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
        )
        .accessibilityIdentifier("morningBriefing.drilldown.signals")
    }

    // MARK: - Draft cards

    private func draftBadgeColor(_ kind: String?) -> Color {
        switch kind {
        case "message": return OpenDesignDayColor.sky
        case "experiment": return OpenDesignDayColor.violet
        default: return OpenDesignDayColor.accent
        }
    }

    private func draftCard(_ draft: MorningBriefingActionDraft) -> some View {
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
                    if let subtitle = draft.subtitle, !subtitle.isEmpty {
                        Text(subtitle)
                            .font(.system(size: 10, design: .monospaced))
                            .foregroundStyle(OpenDesignDayColor.muted)
                            .lineLimit(1)
                    }
                }
                Spacer()
            }
            .padding(EdgeInsets(top: 11, leading: 14, bottom: 11, trailing: 14))
            .background(OpenDesignDayColor.surface2)

            if let body = draft.body, !body.isEmpty {
                Divider().overlay(OpenDesignDayColor.borderSoft)
                Text(body)
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

            Divider().overlay(OpenDesignDayColor.borderSoft)

            HStack(spacing: 10) {
                if let why = draft.why, !why.isEmpty {
                    Text("왜 오늘: \(why)")
                        .font(.system(size: 10.5, design: .monospaced))
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .lineLimit(2)
                }
                Spacer()
                if let copyText = draft.copyText, !copyText.isEmpty {
                    Button {
                        let pasteboard = NSPasteboard.general
                        pasteboard.clearContents()
                        pasteboard.setString(copyText, forType: .string)
                        copiedDraftIDs.insert(draft.id)
                        showToast("클립보드에 복사됨")
                    } label: {
                        HStack(spacing: 6) {
                            Image(systemName: "doc.on.doc")
                                .font(.system(size: 9))
                            Text(copiedDraftIDs.contains(draft.id) ? "복사됨" : "근거 복사")
                        }
                        .font(.system(size: 11))
                        .foregroundStyle(copiedDraftIDs.contains(draft.id) ? OpenDesignDayColor.accent : OpenDesignDayColor.fgSecondary)
                        .padding(.horizontal, 11)
                        .frame(height: 28)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .stroke(copiedDraftIDs.contains(draft.id) ? OpenDesignDayColor.accent.opacity(0.4) : OpenDesignDayColor.borderSoft, lineWidth: 1)
                        )
                        .contentShape(Rectangle())
                    }
                    .buttonStyle(.plain)
                }

                Button {
                    guard !appliedDraftIDs.contains(draft.id) else { return }
                    applyAction(draft)
                    appliedDraftIDs.insert(draft.id)
                    showToast("\(draft.applyLabel ?? "적용") · 맡겼어요")
                } label: {
                    Text(appliedDraftIDs.contains(draft.id) ? "맡겼어요 ✓" : (draft.applyLabel ?? "적용"))
                        .font(.system(size: 11, weight: .semibold))
                        .foregroundStyle(appliedDraftIDs.contains(draft.id) ? OpenDesignDayColor.accent : OpenDesignDayColor.bgDeep)
                        .padding(.horizontal, 11)
                        .frame(height: 28)
                        .background(
                            RoundedRectangle(cornerRadius: 7, style: .continuous)
                                .fill(appliedDraftIDs.contains(draft.id) ? OpenDesignDayColor.accent.opacity(0.13) : OpenDesignDayColor.accent)
                                .overlay(
                                    RoundedRectangle(cornerRadius: 7, style: .continuous)
                                        .stroke(appliedDraftIDs.contains(draft.id) ? OpenDesignDayColor.accent.opacity(0.4) : Color.clear, lineWidth: 1)
                                )
                        )
                        .contentShape(Rectangle())
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("morningBriefing.drilldown.apply.\(draft.id)")
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
        .accessibilityIdentifier("morningBriefing.drilldown.draft.\(draft.id)")
    }

    private func draftsEmptyCard(_ empty: MorningBriefingDrillDraftsEmpty) -> some View {
        HStack(alignment: .top, spacing: 12) {
            Image(systemName: "checkmark")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(OpenDesignDayColor.accent)
                .frame(width: 24, height: 24)
                .background(
                    Circle()
                        .fill(OpenDesignDayColor.accent.opacity(0.13))
                        .overlay(Circle().stroke(OpenDesignDayColor.accent.opacity(0.35), lineWidth: 1))
                )
            VStack(alignment: .leading, spacing: 5) {
                Text(empty.title ?? "")
                    .font(.system(size: 12.5, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.fg)
                if let detail = empty.detail {
                    Text(detail)
                        .font(.system(size: 11.5))
                        .lineSpacing(3)
                        .foregroundStyle(OpenDesignDayColor.muted)
                        .fixedSize(horizontal: false, vertical: true)
                }
                if let evidence = empty.evidence {
                    HStack(spacing: 6) {
                        Image(systemName: "clock")
                            .font(.system(size: 9))
                        Text(evidence)
                    }
                    .font(.system(size: 10.5, design: .monospaced))
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                }
            }
            Spacer(minLength: 0)
        }
        .padding(EdgeInsets(top: 14, leading: 16, bottom: 14, trailing: 16))
        .background(
            RoundedRectangle(cornerRadius: 12, style: .continuous)
                .fill(OpenDesignDayColor.surface)
                .overlay(
                    RoundedRectangle(cornerRadius: 12, style: .continuous)
                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
        )
        .accessibilityIdentifier("morningBriefing.drilldown.draftsEmpty")
    }

    // MARK: - Meta panel

    private var metaPanel: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 0) {
                if let progress = drilldown.meta?.progress {
                    VStack(alignment: .leading, spacing: 8) {
                        HStack(spacing: 6) {
                            Circle().fill(sourceTone).frame(width: 6, height: 6)
                            Text((progress.label ?? "").uppercased())
                                .font(.system(size: 10.5, design: .monospaced))
                                .kerning(0.5)
                                .foregroundStyle(OpenDesignDayColor.muted)
                        }
                        HStack(alignment: .firstTextBaseline, spacing: 6) {
                            Text(progress.valueLabel ?? "")
                                .font(.system(size: 15, weight: .semibold, design: .monospaced))
                                .foregroundStyle(drilldown.id == "posthog" ? OpenDesignDayColor.rose : OpenDesignDayColor.fg)
                                .lineLimit(1)
                                .minimumScaleFactor(0.7)
                            Spacer()
                            if let sub = progress.sub {
                                Text(sub)
                                    .font(.system(size: 10.5, design: .monospaced))
                                    .foregroundStyle(drilldown.id == "posthog" ? OpenDesignDayColor.rose : OpenDesignDayColor.accent)
                                    .padding(.horizontal, 8)
                                    .padding(.vertical, 1)
                                    .background(
                                        Capsule()
                                            .fill((drilldown.id == "posthog" ? OpenDesignDayColor.rose : OpenDesignDayColor.accent).opacity(0.13))
                                            .overlay(Capsule().stroke((drilldown.id == "posthog" ? OpenDesignDayColor.rose : OpenDesignDayColor.accent).opacity(0.35), lineWidth: 1))
                                    )
                            }
                        }
                        GeometryReader { geo in
                            ZStack(alignment: .leading) {
                                Capsule().fill(OpenDesignDayColor.bgDeep)
                                Capsule()
                                    .fill(drilldown.id == "posthog" ? OpenDesignDayColor.rose : OpenDesignDayColor.accent)
                                    .frame(width: max(3, geo.size.width * CGFloat(progress.ratio ?? 0)))
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
                }

                if !(drilldown.meta?.rows ?? []).isEmpty {
                    Text(metaRowsHeading.uppercased())
                        .font(.system(size: 10.5, design: .monospaced))
                        .kerning(1.0)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.horizontal, 4)
                        .padding(.top, 14)
                        .padding(.bottom, 8)
                    VStack(spacing: 1) {
                        ForEach(Array((drilldown.meta?.rows ?? []).enumerated()), id: \.offset) { _, row in
                            HStack(spacing: 10) {
                                Text(row.key ?? "")
                                    .font(.system(size: 12))
                                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                                Spacer()
                                Text(row.value ?? "")
                                    .font(.system(size: 11, design: .monospaced))
                                    .foregroundStyle(row.tone == "muted" || row.tone == nil ? OpenDesignDayColor.muted : toneColor(row.tone))
                                    .lineLimit(1)
                            }
                            .padding(.horizontal, 10)
                            .padding(.vertical, 8)
                        }
                    }
                }

                if let nextID = nextSourceID {
                    Text("다음 소스".uppercased())
                        .font(.system(size: 10.5, design: .monospaced))
                        .kerning(1.0)
                        .foregroundStyle(OpenDesignDayColor.mutedDeep)
                        .padding(.horizontal, 4)
                        .padding(.top, 14)
                        .padding(.bottom, 8)
                    Button {
                        onSelectSource(nextID)
                    } label: {
                        HStack(spacing: 12) {
                            Text(nextID == "cloudflare" ? "CF" : nextID == "posthog" ? "PH" : "GH")
                                .font(.system(size: 13, weight: .bold, design: .monospaced))
                                .foregroundStyle(toneColor(nextID == "cloudflare" ? "amber" : nextID == "posthog" ? "violet" : "accent"))
                                .frame(width: 36, height: 36)
                                .background(
                                    RoundedRectangle(cornerRadius: 11, style: .continuous)
                                        .fill(toneColor(nextID == "cloudflare" ? "amber" : nextID == "posthog" ? "violet" : "accent").opacity(0.14))
                                        .overlay(
                                            RoundedRectangle(cornerRadius: 11, style: .continuous)
                                                .stroke(toneColor(nextID == "cloudflare" ? "amber" : nextID == "posthog" ? "violet" : "accent").opacity(0.4), lineWidth: 1)
                                        )
                                )
                            VStack(alignment: .leading, spacing: 2) {
                                Text("\(sourceDisplayName(nextID)) 드릴다운")
                                    .font(.system(size: 12.5, weight: .semibold))
                                    .foregroundStyle(OpenDesignDayColor.fg)
                                Text(briefing?.drilldowns?[nextID]?.subtitle ?? "")
                                    .font(.system(size: 10.5, design: .monospaced))
                                    .foregroundStyle(OpenDesignDayColor.muted)
                                    .lineLimit(1)
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
                    .accessibilityIdentifier("morningBriefing.drilldown.meta.next")
                }

                Text("다음".uppercased())
                    .font(.system(size: 10.5, design: .monospaced))
                    .kerning(1.0)
                    .foregroundStyle(OpenDesignDayColor.mutedDeep)
                    .padding(.horizontal, 4)
                    .padding(.top, 14)
                    .padding(.bottom, 8)
                Button(action: onBack) {
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
                            Text("아침 브리핑으로")
                                .font(.system(size: 12.5, weight: .semibold))
                                .foregroundStyle(OpenDesignDayColor.fg)
                            Text("요약 + 액션 · Day \(day) 시작")
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
                .accessibilityIdentifier("morningBriefing.drilldown.meta.back")
            }
            .padding(16)
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("morningBriefing.drilldown.meta")
    }

    private var metaRowsHeading: String {
        switch drilldown.id {
        case "cloudflare": return "존 정보"
        case "posthog": return "프로젝트"
        default: return "리포지토리"
        }
    }
}

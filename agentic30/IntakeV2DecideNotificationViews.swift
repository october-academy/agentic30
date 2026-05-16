import SwiftUI
import AppKit

struct DecideNotificationItem: Identifiable, Equatable {
    let id: String
    let title: String
    let contextLabel: String
    let body: String
    let timeLabel: String
    let signalLabel: String?
    let meta: String?
    let rationale: String?

    init(
        id: String,
        title: String = "오늘의 한 가지",
        contextLabel: String = "오늘의 한 가지",
        body: String,
        timeLabel: String,
        signalLabel: String? = nil,
        meta: String? = nil,
        rationale: String? = nil
    ) {
        self.id = id
        self.title = title
        self.contextLabel = contextLabel
        self.body = body
        self.timeLabel = timeLabel
        self.signalLabel = signalLabel
        self.meta = meta
        self.rationale = rationale
    }
}

enum DecideNotificationGroupMode {
    case stackPreview
    case decisionAction
}

enum DecideNotificationInteraction: Equatable {
    case idle
    case swiping
    case executing
}

struct DecideNotificationGroupView: View {
    let items: [DecideNotificationItem]
    let expanded: Bool
    let mode: DecideNotificationGroupMode
    var frontInteraction: DecideNotificationInteraction = .idle
    var exitingPreviewItem: DecideNotificationItem? = nil
    var exitingPreviewOffsetX: CGFloat = 0
    var exitingPreviewOpacity: Double = 0
    var actionTitle: String = "Execute"
    var actionSystemImage: String? = nil
    var actionDisabled: Bool = false
    var actionHint: String? = nil
    let onToggleExpanded: () -> Void
    var onDismissFront: (() -> Void)? = nil
    var onPrimaryAction: (() -> Void)? = nil

    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @GestureState private var stackPreviewDragX: CGFloat = 0

    var body: some View {
        Group {
            if mode == .decisionAction, let latest = items.first {
                decisionActionCard(latest)
            } else if mode == .stackPreview && !expanded {
                stackPreviewCards
            } else if items.isEmpty {
                emptyState
            } else if expanded {
                expandedStack
            } else {
                collapsedStack
            }
        }
        .animation(reduceMotion ? nil : itemAnimation, value: items)
        .accessibilityIdentifier("intakeV2.decideNotificationGroup")
    }

    private var emptyState: some View {
        Color.clear
            .frame(maxWidth: .infinity, minHeight: mode == .decisionAction ? 136 : 116)
            .accessibilityHidden(true)
    }

    private var stackPreviewCards: some View {
        Group {
            if items.isEmpty {
                stackPreviewPlaceholder
            } else {
                ZStack(alignment: .top) {
                    ForEach(Array(stackPreviewItems.enumerated()).reversed(), id: \.element.id) { index, item in
                        stackPreviewCard(item, index: index)
                            .offset(
                                x: stackPreviewXOffset(for: index),
                                y: stackPreviewOffset(for: index)
                            )
                            .scaleEffect(stackPreviewScale(for: index), anchor: .top)
                            .opacity(stackPreviewOpacity(for: index))
                            .zIndex(Double(stackPreviewItems.count - index))
                            .transition(reduceMotion ? .identity : .asymmetric(
                                insertion: .offset(y: -6).combined(with: .opacity),
                                removal: .identity
                            ))
                    }

                    if let exitingPreviewItem {
                        stackPreviewCard(exitingPreviewItem, index: 0)
                            .offset(x: exitingPreviewOffsetX, y: 0)
                            .opacity(exitingPreviewOpacity)
                            .zIndex(1000)
                            .allowsHitTesting(false)
                            .accessibilityHidden(true)
                    }
                }
                .frame(maxWidth: .infinity, minHeight: 156, maxHeight: 156, alignment: .top)
                .contentShape(Rectangle())
                .onTapGesture(perform: onToggleExpanded)
                .gesture(stackPreviewDismissGesture)
                .accessibilityElement(children: .ignore)
                .accessibilityLabel(collapsedAccessibilityLabel)
                .accessibilityValue("오늘 결정 알림 미리보기")
                .accessibilityHint("펼치려면 누르세요. 최상단 알림은 옆으로 밀어 넘길 수 있습니다.")
            }
        }
    }

    private var stackPreviewPlaceholder: some View {
        ZStack(alignment: .top) {
            ForEach((0..<3).reversed(), id: \.self) { index in
                RoundedRectangle(cornerRadius: 16, style: .continuous)
                    .fill(.white.opacity(index == 0 ? 0.052 : 0.034))
                    .overlay(
                        RoundedRectangle(cornerRadius: 16, style: .continuous)
                            .stroke(.white.opacity(index == 0 ? 0.085 : 0.060), lineWidth: 1)
                    )
                    .frame(height: stackPreviewCardHeight(for: index))
                    .overlay(alignment: .leading) {
                        if index == 0 {
                            HStack(spacing: 10) {
                                RoundedRectangle(cornerRadius: 8, style: .continuous)
                                    .fill(.white.opacity(0.05))
                                    .frame(width: 30, height: 30)
                                VStack(alignment: .leading, spacing: 6) {
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(.white.opacity(0.050))
                                        .frame(width: 88, height: 7)
                                    RoundedRectangle(cornerRadius: 3)
                                        .fill(.white.opacity(0.034))
                                        .frame(width: 132, height: 7)
                                }
                            }
                            .padding(.horizontal, 12)
                        }
                    }
                    .padding(.horizontal, stackPreviewHorizontalInset(for: index))
                    .offset(y: stackPreviewOffset(for: index))
                    .scaleEffect(stackPreviewScale(for: index), anchor: .top)
                    .opacity(index == 0 ? 0.72 : stackPreviewOpacity(for: index) * 0.72)
            }
        }
        .frame(maxWidth: .infinity, minHeight: 156, maxHeight: 156, alignment: .top)
        .accessibilityHidden(true)
    }

    private func stackPreviewCard(_ item: DecideNotificationItem, index: Int) -> some View {
        let front = index == 0
        return Group {
            if front {
                HStack(alignment: .top, spacing: 10) {
                    Agentic30AppIcon(size: 34)
                        .padding(.top, 1)

                    VStack(alignment: .leading, spacing: 4) {
                        HStack(alignment: .firstTextBaseline, spacing: 5) {
                            Text("Agentic30")
                                .font(.system(size: 9.8, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.58))
                                .lineLimit(1)
                            Text("·")
                                .font(.system(size: 9.8, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.28))
                            Text(item.timeLabel)
                                .font(.system(size: 9.4, weight: .semibold))
                                .foregroundStyle(.white.opacity(0.42))
                                .lineLimit(1)
                            Spacer(minLength: 4)
                        }

                        Text(item.body)
                            .font(.system(size: 12.8, weight: .bold, design: .rounded))
                            .foregroundStyle(.white.opacity(0.96))
                            .lineLimit(2)
                            .minimumScaleFactor(0.82)
                            .truncationMode(.tail)
                            .allowsTightening(true)
                            .lineSpacing(0.8)
                    }
                    .layoutPriority(1)
                }
            } else {
                Color.clear
            }
        }
        .padding(.horizontal, front ? 12 : 11)
        .padding(.top, front ? 10 : 9)
        .padding(.bottom, front ? 12 : 9)
        .frame(maxWidth: .infinity, minHeight: stackPreviewCardHeight(for: index), maxHeight: stackPreviewCardHeight(for: index), alignment: .topLeading)
        .background(stackPreviewBackground(index: index))
        .overlay(stackPreviewStroke(index: index))
        .shadow(color: .black.opacity(front ? 0.20 : 0.12), radius: front ? 7 : 4, y: front ? 4 : 2)
        .contentShape(RoundedRectangle(cornerRadius: 16, style: .continuous))
        .padding(.horizontal, stackPreviewHorizontalInset(for: index))
    }

    private func stackPreviewSilhouette(index: Int) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(.white.opacity(index == 1 ? 0.15 : 0.10))
                .frame(width: index == 1 ? 96 : 82, height: 6)
            RoundedRectangle(cornerRadius: 3, style: .continuous)
                .fill(.white.opacity(index == 1 ? 0.12 : 0.08))
                .frame(width: index == 1 ? 164 : 136, height: 7)
        }
        .padding(.top, 2)
        .accessibilityHidden(true)
    }

    private var collapsedStack: some View {
        Button(action: onToggleExpanded) {
            ZStack(alignment: .top) {
                ForEach(Array(backingItems.enumerated()).reversed(), id: \.element.id) { index, item in
                    notificationCard(item, expandedRow: false, showsActions: false, isBackingLayer: true)
                        .scaleEffect(backingScale(for: index), anchor: .top)
                        .offset(y: backingOffset(for: index))
                        .opacity(backingOpacity(for: index))
                        .allowsHitTesting(false)
                        .accessibilityHidden(true)
                }

                if let latest = items.first {
                    notificationCard(latest, expandedRow: false, showsActions: false, isBackingLayer: false)
                        .id(latest.id)
                        .transition(reduceMotion ? .identity : .opacity)
                }
            }
            .frame(maxWidth: .infinity, minHeight: collapsedHeight, alignment: .top)
            .contentShape(Rectangle())
        }
        .buttonStyle(.plain)
        .accessibilityElement(children: .ignore)
        .accessibilityLabel(collapsedAccessibilityLabel)
        .accessibilityValue("접힘")
        .accessibilityHint("펼치려면 누르세요.")
    }

    private var expandedStack: some View {
        VStack(alignment: .leading, spacing: 8) {
            ScrollView(items.count > 3 ? .vertical : [], showsIndicators: items.count > 3) {
                VStack(spacing: 8) {
                    ForEach(Array(items.enumerated()), id: \.element.id) { index, item in
                        notificationCard(
                            item,
                            expandedRow: true,
                            showsActions: mode == .decisionAction && index == 0,
                            isBackingLayer: false
                        )
                    }
                }
                .padding(.vertical, 1)
            }
            .frame(maxHeight: expandedMaxHeight)

            Button("덜 보기", action: onToggleExpanded)
                .buttonStyle(.borderless)
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(.white.opacity(0.68))
                .keyboardShortcut(.cancelAction)
                .accessibilityIdentifier("intakeV2.decideNotificationShowLess")
        }
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Agentic30 알림 그룹")
        .accessibilityValue("펼침")
    }

    private func notificationCard(
        _ item: DecideNotificationItem,
        expandedRow: Bool,
        showsActions: Bool,
        isBackingLayer: Bool
    ) -> some View {
        HStack(alignment: .top, spacing: expandedRow ? 16 : 14) {
            Agentic30AppIcon(size: mode == .decisionAction ? 54 : 46)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: expandedRow ? 6 : 3) {
                HStack(alignment: .firstTextBaseline, spacing: 8) {
                    Text("Agentic30")
                        .font(.system(size: expandedRow ? 13 : 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.70))
                        .lineLimit(1)
                    Text("·")
                        .font(.system(size: expandedRow ? 13 : 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.36))
                    Text(item.timeLabel)
                        .font(.system(size: expandedRow ? 12 : 11.5, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.52))
                        .lineLimit(1)
                    Spacer(minLength: 8)
                }

                Text(item.title)
                    .font(.system(size: expandedRow ? 15 : 14, weight: .bold))
                    .foregroundStyle(.white.opacity(0.93))
                    .lineLimit(1)
                    .minimumScaleFactor(0.86)

                Text(item.body)
                    .font(.system(size: expandedRow ? 14.5 : 13.7, weight: .medium))
                    .foregroundStyle(.white.opacity(0.86))
                    .lineLimit(expandedRow ? 3 : 2)
                    .minimumScaleFactor(0.88)
                    .truncationMode(.tail)
                    .allowsTightening(true)
                    .lineSpacing(1)

                if expandedRow, !compactMetaItems(for: item).isEmpty {
                    compactMetaRow(for: item)
                        .padding(.top, 2)
                }

                if showsActions {
                    actionRow
                        .padding(.top, 6)
                }
            }
            .layoutPriority(1)
        }
        .padding(.horizontal, expandedRow ? 18 : 16)
        .padding(.vertical, expandedRow ? 15 : 13)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(cardBackground)
        .overlay(cardStroke)
        .shadow(color: .black.opacity(isBackingLayer ? 0.12 : 0.20), radius: isBackingLayer ? 5 : 8, y: isBackingLayer ? 2 : 4)
        .contentShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
    }

    private func decisionActionCard(_ item: DecideNotificationItem) -> some View {
        HStack(alignment: .top, spacing: 16) {
            Agentic30AppIcon(size: 54)
                .padding(.top, 1)

            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .firstTextBaseline, spacing: 7) {
                    Text("Agentic30")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.72))
                        .lineLimit(1)
                    Text("·")
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.38))
                    Text(item.contextLabel)
                        .font(.system(size: 13, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.72))
                        .lineLimit(1)
                    Spacer(minLength: 10)
                    Text(item.timeLabel)
                        .font(.system(size: 12, weight: .semibold))
                        .foregroundStyle(.white.opacity(0.50))
                        .lineLimit(1)
                }

                Text(item.body)
                    .font(.system(size: 20, weight: .bold, design: .rounded))
                    .foregroundStyle(.white.opacity(0.94))
                    .lineLimit(3)
                    .minimumScaleFactor(0.84)
                    .truncationMode(.tail)
                    .allowsTightening(true)
                    .lineSpacing(1.5)
                    .fixedSize(horizontal: false, vertical: true)

                if !compactMetaItems(for: item).isEmpty {
                    decisionMetaRow(for: item)
                }

                HStack(alignment: .center, spacing: 12) {
                    if let rationale = item.rationale, !rationale.isEmpty {
                        Text(rationale)
                            .font(.system(size: 12.5, weight: .medium))
                            .foregroundStyle(.white.opacity(0.58))
                            .lineLimit(1)
                            .minimumScaleFactor(0.82)
                            .truncationMode(.tail)
                    }

                    Spacer(minLength: 12)

                    Button(action: { onPrimaryAction?() }) {
                        HStack(spacing: 6) {
                            if let actionSystemImage {
                                Image(systemName: actionSystemImage)
                            }
                            Text(actionTitle)
                        }
                        .frame(minWidth: 92)
                    }
                    .buttonStyle(.bordered)
                    .controlSize(.regular)
                    .disabled(actionDisabled || onPrimaryAction == nil)
                    .accessibilityIdentifier("intakeV2.executeButton")
                }

                if let actionHint {
                    Text(actionHint)
                        .font(.system(size: 12, weight: .medium))
                        .foregroundStyle(IntakeV2Color.accentBright.opacity(0.82))
                        .lineLimit(1)
                        .minimumScaleFactor(0.82)
                        .transition(reduceMotion ? .identity : .opacity)
                }
            }
            .layoutPriority(1)
        }
        .padding(.horizontal, 18)
        .padding(.vertical, 16)
        .frame(maxWidth: .infinity, alignment: .topLeading)
        .background(cardBackground)
        .overlay(cardStroke)
        .shadow(color: .black.opacity(0.20), radius: 8, y: 4)
        .contentShape(RoundedRectangle(cornerRadius: 19, style: .continuous))
        .accessibilityElement(children: .contain)
        .accessibilityLabel("Agentic30, \(item.contextLabel), \(item.body)")
    }

    private var actionRow: some View {
        HStack(spacing: 8) {
            if let actionHint {
                Text(actionHint)
                    .font(.system(size: 12, weight: .medium))
                    .foregroundStyle(.white.opacity(0.56))
                    .lineLimit(1)
                    .minimumScaleFactor(0.82)
            }
            Spacer(minLength: 8)
            Button(action: { onPrimaryAction?() }) {
                Label {
                    Text(actionTitle)
                } icon: {
                    if let actionSystemImage {
                        Image(systemName: actionSystemImage)
                    }
                }
                .frame(minWidth: 92)
            }
            .buttonStyle(.bordered)
            .controlSize(.regular)
            .disabled(actionDisabled || onPrimaryAction == nil)
            .accessibilityIdentifier("intakeV2.executeButton")
        }
    }

    private func compactMetaRow(for item: DecideNotificationItem) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(compactMetaItems(for: item), id: \.self) { label in
                    metaChip(label, prominent: false)
                }
            }
        }
        .accessibilityHidden(true)
    }

    private func decisionMetaRow(for item: DecideNotificationItem) -> some View {
        ScrollView(.horizontal, showsIndicators: false) {
            HStack(spacing: 6) {
                ForEach(Array(compactMetaItems(for: item).enumerated()), id: \.element) { index, label in
                    metaChip(label, prominent: index == 0)
                        .transition(reduceMotion ? .identity : .opacity)
                        .animation(reduceMotion ? nil : .easeInOut(duration: 0.30).delay(Double(index) * 0.018), value: items)
                }
            }
            .padding(.vertical, 1)
        }
        .accessibilityLabel(compactMetaItems(for: item).joined(separator: ", "))
    }

    private func compactMetaItems(for item: DecideNotificationItem) -> [String] {
        var labels: [String] = []
        if let signalLabel = item.signalLabel, !signalLabel.isEmpty {
            labels.append(signalLabel)
        }
        if let meta = item.meta, !meta.isEmpty {
            labels.append(meta)
        }
        return labels
    }

    private func metaChip(_ label: String, prominent: Bool) -> some View {
        Text(label)
            .font(.system(size: prominent ? 11.5 : 11, weight: .semibold, design: .rounded))
            .foregroundStyle(prominent ? IntakeV2Color.accentBright : .white.opacity(0.58))
            .lineLimit(1)
            .padding(.horizontal, 7)
            .padding(.vertical, 4)
            .background(
                RoundedRectangle(cornerRadius: 6, style: .continuous)
                    .fill(prominent ? IntakeV2Color.accent.opacity(0.12) : .white.opacity(0.045))
                    .overlay(
                        RoundedRectangle(cornerRadius: 6, style: .continuous)
                            .stroke(prominent ? IntakeV2Color.accent.opacity(0.22) : .white.opacity(0.055), lineWidth: 1)
                    )
            )
    }

    private var stackPreviewItems: [DecideNotificationItem] {
        Array(items.prefix(3))
    }

    private var itemAnimation: Animation {
        mode == .stackPreview
            ? .spring(response: 0.52, dampingFraction: 0.86)
            : .easeInOut(duration: 0.34)
    }

    private func stackPreviewOffset(for index: Int) -> CGFloat {
        guard index > 0 else { return 0 }
        let frontBottom = stackPreviewRenderedHeight(for: 0)
        let targetBottom = frontBottom + stackPreviewCumulativeBottomExposure(for: index)
        return targetBottom - stackPreviewRenderedHeight(for: index)
    }

    private func stackPreviewCumulativeBottomExposure(for index: Int) -> CGFloat {
        switch index {
        case 1: return 12
        default: return 22
        }
    }

    private func stackPreviewRenderedHeight(for index: Int) -> CGFloat {
        stackPreviewCardHeight(for: index) * stackPreviewScale(for: index)
    }

    private func stackPreviewCardHeight(for index: Int) -> CGFloat {
        switch index {
        case 0: return 72
        case 1: return 54
        default: return 46
        }
    }

    private func stackPreviewHorizontalInset(for index: Int) -> CGFloat {
        switch index {
        case 0: return 0
        case 1: return 12
        default: return 24
        }
    }

    private func stackPreviewXOffset(for index: Int) -> CGFloat {
        guard index == 0 else { return 0 }
        switch frontInteraction {
        case .idle:
            return stackPreviewDragX
        case .swiping:
            return stackPreviewDragX
        case .executing:
            return stackPreviewDragX
        }
    }

    private func stackPreviewScale(for index: Int) -> CGFloat {
        switch index {
        case 0: return 1.0
        case 1: return 0.985
        default: return 0.97
        }
    }

    private func stackPreviewOpacity(for index: Int) -> Double {
        switch index {
        case 0: return 1.0
        case 1: return 0.76
        default: return 0.56
        }
    }

    private var stackPreviewDismissGesture: some Gesture {
        DragGesture(minimumDistance: 16)
            .updating($stackPreviewDragX) { value, state, _ in
                state = value.translation.width
            }
            .onEnded { value in
                guard abs(value.translation.width) > 46 else { return }
                onDismissFront?()
            }
    }

    private func stackPreviewBackground(index: Int) -> some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .fill(Color(red: 0.105, green: 0.109, blue: 0.118).opacity(index == 0 ? 0.86 : 0.72))
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 16, style: .continuous))
    }

    private func stackPreviewStroke(index: Int) -> some View {
        RoundedRectangle(cornerRadius: 16, style: .continuous)
            .stroke(index == 0 ? .white.opacity(0.12) : .white.opacity(0.08), lineWidth: 1)
    }

    private var cardBackground: some View {
        RoundedRectangle(cornerRadius: 19, style: .continuous)
            .fill(Color(red: 0.105, green: 0.109, blue: 0.118).opacity(0.82))
            .background(.thinMaterial, in: RoundedRectangle(cornerRadius: 19, style: .continuous))
    }

    private var cardStroke: some View {
        RoundedRectangle(cornerRadius: 19, style: .continuous)
            .stroke(.white.opacity(0.095), lineWidth: 1)
    }

    private var backingItems: [DecideNotificationItem] {
        Array(items.dropFirst().prefix(2))
    }

    private var collapsedHeight: CGFloat {
        switch backingItems.count {
        case 0: return mode == .decisionAction ? 124 : 104
        case 1: return mode == .decisionAction ? 146 : 126
        default: return mode == .decisionAction ? 158 : 140
        }
    }

    private var expandedMaxHeight: CGFloat {
        mode == .decisionAction ? 330 : 260
    }

    private func backingOffset(for index: Int) -> CGFloat {
        index == 0 ? 14 : 26
    }

    private func backingScale(for index: Int) -> CGFloat {
        index == 0 ? 0.985 : 0.970
    }

    private func backingOpacity(for index: Int) -> Double {
        index == 0 ? 0.45 : 0.25
    }

    private var collapsedAccessibilityLabel: String {
        guard let latest = items.first else { return "Agentic30 알림 없음" }
        let countText = items.count > 1 ? ", 알림 \(items.count)개" : ""
        return "Agentic30, \(latest.title), \(latest.body)\(countText)"
    }
}

struct Agentic30AppIcon: View {
    let size: CGFloat

    var body: some View {
        Image(nsImage: NSApp.applicationIconImage)
            .resizable()
            .interpolation(.high)
            .scaledToFit()
            .frame(width: size, height: size)
            .clipShape(RoundedRectangle(cornerRadius: size * 0.22, style: .continuous))
            .shadow(color: .black.opacity(0.24), radius: size * 0.15, y: size * 0.05)
    }
}

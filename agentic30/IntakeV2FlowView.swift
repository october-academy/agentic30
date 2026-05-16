import SwiftUI
import AppKit

// MARK: - Intake V2 Flow — review decisions 2026-05-14
// Boot intro → onboarding: Role → Blocker → Commitment → Evidence → Folder pick
// then source connect → analyzing splash → first Decide card → post-onboarding Records banner
//
// Design decisions reflected:
//   D7 (design): step 4 folder pick uses hero band pattern + 3 option cards
//   D8 (design): splash failure → graceful fallback (Continue anyway) + template Decide
//   D9 (design): step 4 trust copy avoids overclaiming system-wide network behavior.
//   D10 (design): post-onboarding Records banner inline below first Decide card

// MARK: - Color tokens

enum IntakeV2Color {
    static let bg = Color(red: 0.055, green: 0.055, blue: 0.063)          // #0e0e10
    static let panel = Color(red: 0.075, green: 0.075, blue: 0.086)       // #131316
    static let accent = Agentic30BrandColor.green      // #16a34a
    static let accentBright = Agentic30BrandColor.greenBright // #4ade80
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.65)
    static let textCardSecondary = Color.white.opacity(0.62)
    static let textTertiary = Color.white.opacity(0.45)
    static let monospaceMuted = Color.white.opacity(0.4)
}

enum IntakeV2Layout {
    static let contentMaxWidth: CGFloat = 1080
    static let horizontalPadding: CGFloat = 56
    static let narrowHorizontalPadding: CGFloat = 28
    static let stepTopPadding: CGFloat = 56
    static let progressReservedHeight: CGFloat = 14
    static let footerBottomPadding: CGFloat = 36
}

// MARK: - Dash pagination

struct IntakeV2DashPagination: View {
    let current: Int      // 1...total
    let total: Int
    var reduceMotion: Bool = false
    var progressNamespace: Namespace.ID? = nil

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                ForEach(1...total, id: \.self) { idx in
                    marker(for: idx)
                }
            }
            HStack(spacing: 0) {
                progressNumber
                Text(" / \(total)")
            }
            .font(.system(size: 11, weight: .semibold, design: .monospaced))
            .foregroundStyle(IntakeV2Color.textSecondary)
            .tracking(0.8)
            .monospacedDigit()
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(current) of \(total)")
        .accessibilityIdentifier("intakeV2.progress")
    }

    @ViewBuilder
    private func marker(for idx: Int) -> some View {
        if idx == current {
            currentMarker
        } else if idx < current {
            Circle()
                .fill(IntakeV2Color.accent)
                .frame(width: 6, height: 6)
                .scaleEffect(1.0)
                .transition(reduceMotion ? .opacity : .scale(scale: 0.85).combined(with: .opacity))
        } else {
            Circle()
                .fill(.white.opacity(0.18))
                .frame(width: 6, height: 6)
        }
    }

    @ViewBuilder
    private var currentMarker: some View {
        let marker = Capsule()
            .fill(.white)
            .frame(width: 24, height: 6)

        if reduceMotion {
            marker
        } else {
            marker.ifLet(progressNamespace) { view, namespace in
                view.matchedGeometryEffect(id: "intakeV2.progress.current", in: namespace)
            }
        }
    }

    @ViewBuilder
    private var progressNumber: some View {
        if reduceMotion {
            Text("\(current)")
        } else {
            Text("\(current)")
                .contentTransition(.numericText(value: Double(current)))
        }
    }
}

struct IntakeV2ProgressReservedSpace: View {
    var body: some View {
        Color.clear
            .frame(height: IntakeV2Layout.progressReservedHeight)
            .accessibilityHidden(true)
    }
}

// MARK: - Headline block

struct IntakeV2Header: View {
    let title: String
    let subtitle: String
    var trustLine: String? = nil  // D9 — step 4 trust copy

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            Text(title)
                .font(.system(size: 34, weight: .bold, design: .rounded))
                .foregroundStyle(IntakeV2Color.textPrimary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            Text(subtitle)
                .font(.system(size: 18, weight: .medium, design: .rounded))
                .foregroundStyle(IntakeV2Color.textSecondary)
                .lineSpacing(3)
                .fixedSize(horizontal: false, vertical: true)
            if let trustLine {
                Text(trustLine)
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.accentBright)
                    .padding(8)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background(
                        RoundedRectangle(cornerRadius: 6)
                            .fill(IntakeV2Color.accent.opacity(0.08))
                            .overlay(
                                RoundedRectangle(cornerRadius: 6)
                                    .stroke(IntakeV2Color.accent.opacity(0.25), lineWidth: 1)
                            )
                    )
                    .padding(.top, 4)
            }
        }
    }
}

// MARK: - Option card

struct IntakeV2OptionCard: View {
    enum SelectionStyle {
        case single
        case multiple
    }

    let title: String
    let description: String
    let selected: Bool
    var selectionStyle: SelectionStyle = .single
    var accessibilityIdentifier: String? = nil
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    if selectionStyle == .single {
                        Circle()
                            .stroke(selected ? IntakeV2Color.accentBright : .white.opacity(0.22), lineWidth: 1.5)
                            .frame(width: 14, height: 14)
                    } else {
                        RoundedRectangle(cornerRadius: 4, style: .continuous)
                            .stroke(selected ? IntakeV2Color.accentBright : .white.opacity(0.22), lineWidth: 1.5)
                            .frame(width: 14, height: 14)
                    }
                    if selected {
                        if selectionStyle == .single {
                            Circle()
                                .fill(IntakeV2Color.accentBright)
                                .frame(width: 6, height: 6)
                        } else {
                            RoundedRectangle(cornerRadius: 2, style: .continuous)
                                .fill(IntakeV2Color.accentBright)
                                .frame(width: 7, height: 7)
                        }
                    }
                }
                .frame(width: 18)

                VStack(alignment: .leading, spacing: 4) {
                    Text(title)
                        .font(.system(size: 17, weight: .bold, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textPrimary)
                    Text(description)
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textCardSecondary)
                        .fixedSize(horizontal: false, vertical: true)
                }

                Spacer()

                if selected {
                    Image(systemName: "checkmark")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(IntakeV2Color.accentBright)
                }
            }
            .padding(.horizontal, 20)
            .padding(.vertical, 18)
            .background(
                RoundedRectangle(cornerRadius: 12)
                    .fill(selected ? IntakeV2Color.accent.opacity(0.055) : .white.opacity(0.03))
            )
            .overlay(
                RoundedRectangle(cornerRadius: 12)
                    .stroke(
                        selected ? IntakeV2Color.accent : .white.opacity(0.05),
                        lineWidth: selected ? 1.5 : 1
                    )
            )
        }
        .buttonStyle(.plain)
        .ifLet(accessibilityIdentifier) { view, identifier in
            view.accessibilityIdentifier(identifier)
        }
    }
}

// MARK: - Footer

struct IntakeV2Footer: View {
    let backDisabled: Bool
    let nextTitle: String       // "Next →" or "Start assistant →" (final)
    let nextEnabled: Bool
    var nextVisible: Bool = true
    var nextAccessibilityIdentifier: String? = nil
    let onBack: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack {
            if !backDisabled {
                Button(action: onBack) {
                    Text("Back")
                        .font(.system(size: 16, weight: .semibold, design: .rounded))
                        .foregroundStyle(.white.opacity(0.7))
                        .padding(.horizontal, 30)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(.white.opacity(0.06)))
                }
                .buttonStyle(.plain)
            } else {
                Color.clear
                    .frame(width: 112, height: 1)
            }

            Spacer()

            if nextVisible {
                Button(action: onNext) {
                    Text(nextTitle)
                        .font(.system(size: 16, weight: .bold, design: .rounded))
                        .foregroundStyle(nextEnabled ? .black : .white.opacity(0.3))
                        .padding(.horizontal, 30)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(nextEnabled ? Color.white : .white.opacity(0.1)))
                }
                .buttonStyle(.plain)
                .disabled(!nextEnabled)
                .accessibilityLabel(nextAccessibilityLabel)
                .ifLet(nextAccessibilityIdentifier) { view, identifier in
                    view.accessibilityIdentifier(identifier)
                }
            } else {
                Color.clear
                    .frame(width: 112, height: 1)
            }
        }
        .padding(.top, 8)
    }

    private var nextAccessibilityLabel: String {
        nextTitle
            .replacingOccurrences(of: " →", with: "")
            .replacingOccurrences(of: "→", with: "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
    }
}

private extension View {
    @ViewBuilder
    func ifLet<Value, Content: View>(
        _ value: Value?,
        transform: (Self, Value) -> Content
    ) -> some View {
        if let value {
            transform(self, value)
        } else {
            self
        }
    }
}

extension View {
    func intakeV2StepShell() -> some View {
        frame(
            maxWidth: IntakeV2Layout.contentMaxWidth,
            maxHeight: .infinity,
            alignment: .topLeading
        )
        .background {
            Color.clear
                .accessibilityIdentifier("intakeV2.stepShell")
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
    }
}

struct IntakeV2PinnedStepScaffold<Content: View, Footer: View>: View {
    @ViewBuilder let content: (_ isNarrow: Bool) -> Content
    @ViewBuilder let footer: (_ isNarrow: Bool) -> Footer

    var body: some View {
        GeometryReader { geometry in
            let isNarrow = geometry.size.width < 900
            let horizontalPadding = isNarrow
                ? IntakeV2Layout.narrowHorizontalPadding
                : IntakeV2Layout.horizontalPadding

            VStack(spacing: 0) {
                ScrollView(.vertical) {
                    content(isNarrow)
                        .padding(.horizontal, horizontalPadding)
                        .padding(.top, IntakeV2Layout.stepTopPadding)
                        .padding(.bottom, 18)
                        .frame(maxWidth: .infinity, alignment: .topLeading)
                }
                .scrollIndicators(.hidden)

                footer(isNarrow)
                    .padding(.horizontal, horizontalPadding)
                    .padding(.top, 12)
                    .padding(.bottom, IntakeV2Layout.footerBottomPadding)
                    .frame(maxWidth: .infinity, alignment: .leading)
                    .background { IntakeV2Color.bg }
            }
            .frame(maxWidth: IntakeV2Layout.contentMaxWidth, maxHeight: .infinity, alignment: .topLeading)
            .overlay {
                Color.white.opacity(0.001)
                    .accessibilityElement(children: .ignore)
                    .accessibilityLabel("Intake step shell")
                    .accessibilityIdentifier("intakeV2.stepShell")
                    .allowsHitTesting(false)
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
        }
    }
}

// MARK: - Flow container

enum IntakeV2Step: Int, CaseIterable {
    // OS-product intro
    case bootIntro = 1
    // Intake (user answers)
    case role, stuck, commitment, evidence, folderPick
    // OS-product setup + analysis
    case connectShowcase, readyAnalyze

    var progressCurrent: Int {
        rawValue
    }

    var progressTotal: Int {
        8
    }
}

private enum IntakeV2NavigationDirection {
    case forward
    case backward
}

@MainActor
struct IntakeV2FlowView: View {
    @StateObject private var store = IntakeV2Store()
    @StateObject private var sources = IntakeV2SourceManager()

    @State private var step: IntakeV2Step = .bootIntro
    @State private var navigationDirection: IntakeV2NavigationDirection = .forward
    @Environment(\.accessibilityReduceMotion) private var reduceMotion
    @Namespace private var progressNamespace

    /// onComplete delivers the final store + source manager so the host can run
    /// integration logic (submit OnboardingContext, register workspace, mark intro
    /// complete) without IntakeV2 having to know about AgenticViewModel.
    var bootLogState: IntakeV2BootLogState = .empty
    var workspaceScanResult: AgenticViewModel.WorkspaceScanResult? = nil
    var onWorkspacePrefetchRequested: ((IntakeV2Store, IntakeV2SourceManager) -> Void)? = nil
    var onComplete: ((IntakeV2Store, IntakeV2SourceManager) -> Void)? = nil

    var body: some View {
        ZStack(alignment: .top) {
            content
                .id(step)
                .transition(stepTransition)

            fixedProgress
        }
        .clipped()
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(IntakeV2Color.bg)
    }

    private var fixedProgress: some View {
        GeometryReader { geometry in
            let isNarrow = geometry.size.width < 900
            let horizontalPadding = isNarrow
                ? IntakeV2Layout.narrowHorizontalPadding
                : IntakeV2Layout.horizontalPadding

            IntakeV2DashPagination(
                current: step.progressCurrent,
                total: step.progressTotal,
                reduceMotion: reduceMotion,
                progressNamespace: progressNamespace
            )
            .id("intakeV2.progress.\(step.progressCurrent)")
            .padding(.horizontal, horizontalPadding)
            .padding(.top, IntakeV2Layout.stepTopPadding)
            .frame(maxWidth: IntakeV2Layout.contentMaxWidth, alignment: .leading)
            .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .top)
            .allowsHitTesting(false)
        }
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .bootIntro:
            IntakeV2BootIntroView(
                backDisabled: true,
                onBack: {},
                onNext: { navigate(to: .role) },
                progressNamespace: progressNamespace
            )
        case .role:
            IntakeV2RoleView(
                store: store,
                onBack: { navigate(to: .bootIntro) },
                onNext: { navigate(to: .stuck) },
                progressNamespace: progressNamespace
            )
        case .stuck:
            IntakeV2StuckView(
                store: store,
                onBack: { navigate(to: .role) },
                onNext: { navigate(to: .commitment) },
                progressNamespace: progressNamespace
            )
        case .commitment:
            IntakeV2CommitmentView(
                store: store,
                onBack: { navigate(to: .stuck) },
                onNext: { navigate(to: .evidence) },
                progressNamespace: progressNamespace
            )
        case .evidence:
            IntakeV2EvidenceView(
                store: store,
                onBack: { navigate(to: .commitment) },
                onNext: { navigate(to: .folderPick) },
                progressNamespace: progressNamespace
            )
        case .folderPick:
            IntakeV2FolderPickView(
                store: store,
                sources: sources,
                onBack: { navigate(to: .evidence) },
                onNext: {
                    store.markCompleted()
                    onWorkspacePrefetchRequested?(store, sources)
                    navigate(to: .connectShowcase)
                },
                progressNamespace: progressNamespace
            )
        case .connectShowcase:
            IntakeV2ConnectShowcaseView(
                sources: sources,
                onBack: { navigate(to: .folderPick) },
                onNext: { navigate(to: .readyAnalyze) },
                progressNamespace: progressNamespace
            )
        case .readyAnalyze:
            IntakeV2ReadyAnalyzeView(
                store: store,
                sources: sources,
                bootLogState: bootLogState,
                workspaceScanResult: workspaceScanResult,
                onBack: { navigate(to: .connectShowcase) },
                onDone: { onComplete?(store, sources) },
                progressNamespace: progressNamespace
            )
        }
    }

    private var stepTransition: AnyTransition {
        guard !reduceMotion else {
            return .opacity
        }

        let insertionOffset: CGFloat = navigationDirection == .forward ? 28 : -28
        let removalOffset: CGFloat = navigationDirection == .forward ? -18 : 18
        return .asymmetric(
            insertion: .offset(x: insertionOffset).combined(with: .opacity),
            removal: .offset(x: removalOffset).combined(with: .opacity)
        )
    }

    private var stepAnimation: Animation {
        reduceMotion
            ? .easeOut(duration: 0.16)
            : .spring(response: 0.24, dampingFraction: 0.88, blendDuration: 0.02)
    }

    private func navigate(to target: IntakeV2Step) {
        guard target != step else { return }
        navigationDirection = target.rawValue > step.rawValue ? .forward : .backward
        withAnimation(stepAnimation) {
            step = target
        }
    }
}

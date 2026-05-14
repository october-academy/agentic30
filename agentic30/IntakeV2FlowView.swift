import SwiftUI
import AppKit

// MARK: - Intake V2 Flow — review decisions 2026-05-14
// Boot intro → 4-step onboarding: Workmode → Role → Stuck → Folder pick
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
    static let accent = Color(red: 0.086, green: 0.639, blue: 0.290)      // #16a34a
    static let accentBright = Color(red: 0.294, green: 0.871, blue: 0.502) // #4ade80
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
}

// MARK: - Dash pagination

struct IntakeV2DashPagination: View {
    let current: Int      // 1...total
    let total: Int
    let label: String

    var body: some View {
        HStack(spacing: 10) {
            HStack(spacing: 6) {
                ForEach(1...total, id: \.self) { idx in
                    if idx == current {
                        Capsule()
                            .fill(.white)
                            .frame(width: 24, height: 6)
                    } else if idx < current {
                        Circle()
                            .fill(IntakeV2Color.accent)
                            .frame(width: 6, height: 6)
                    } else {
                        Circle()
                            .fill(.white.opacity(0.18))
                            .frame(width: 6, height: 6)
                    }
                }
            }
            Text("\(current) / \(total) · \(label)")
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(IntakeV2Color.textSecondary)
                .tracking(0.8)
                .textCase(.uppercase)
        }
        .accessibilityElement(children: .ignore)
        .accessibilityLabel("Step \(current) of \(total), \(label)")
        .accessibilityIdentifier("intakeV2.progress")
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
    let title: String
    let description: String
    let selected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    Circle()
                        .stroke(selected ? IntakeV2Color.accentBright : .white.opacity(0.22), lineWidth: 1.5)
                        .frame(width: 14, height: 14)
                    if selected {
                        Circle()
                            .fill(IntakeV2Color.accentBright)
                            .frame(width: 6, height: 6)
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
    }
}

// MARK: - Footer

struct IntakeV2Footer: View {
    let backDisabled: Bool
    let nextTitle: String       // "Next →" or "Start assistant →" (final)
    let nextEnabled: Bool
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

// MARK: - Flow container

enum IntakeV2Step: Int, CaseIterable {
    // OS-product intro
    case bootIntro = 1
    // Intake (user answers)
    case workmode, role, stuck, folderPick
    // OS-product setup + analysis
    case connectShowcase, readyAnalyze
}

@MainActor
struct IntakeV2FlowView: View {
    @StateObject private var store = IntakeV2Store()
    @StateObject private var sources = IntakeV2SourceManager()

    @State private var step: IntakeV2Step = .bootIntro

    /// onComplete delivers the final store + source manager so the host can run
    /// integration logic (submit OnboardingContext, register workspace, mark intro
    /// complete) without IntakeV2 having to know about AgenticViewModel.
    var onWorkspacePrefetchRequested: ((IntakeV2Store, IntakeV2SourceManager) -> Void)? = nil
    var onComplete: ((IntakeV2Store, IntakeV2SourceManager) -> Void)? = nil

    var body: some View {
        VStack(spacing: 0) {
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
        .background(IntakeV2Color.bg)
    }

    @ViewBuilder private var content: some View {
        switch step {
        case .bootIntro:
            IntakeV2BootIntroView(
                backDisabled: true,
                onBack: {},
                onNext: { step = .workmode }
            )
        case .workmode:
            IntakeV2WorkmodeView(
                store: store,
                onBack: { step = .bootIntro },
                onNext: { step = .role }
            )
        case .role:
            IntakeV2RoleView(
                store: store,
                onBack: { step = .workmode },
                onNext: { step = .stuck }
            )
        case .stuck:
            IntakeV2StuckView(
                store: store,
                onBack: { step = .role },
                onNext: { step = .folderPick }
            )
        case .folderPick:
            IntakeV2FolderPickView(
                store: store,
                sources: sources,
                onBack: { step = .stuck },
                onNext: {
                    store.markCompleted()
                    onWorkspacePrefetchRequested?(store, sources)
                    step = .connectShowcase
                }
            )
        case .connectShowcase:
            IntakeV2ConnectShowcaseView(
                sources: sources,
                onBack: { step = .folderPick },
                onNext: { step = .readyAnalyze }
            )
        case .readyAnalyze:
            IntakeV2ReadyAnalyzeView(
                store: store,
                sources: sources,
                onBack: { step = .connectShowcase },
                onDone: { onComplete?(store, sources) }
            )
        }
    }
}

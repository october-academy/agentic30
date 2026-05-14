import SwiftUI
import AppKit

// MARK: - Intake V2 Flow — review decisions 2026-05-14
// 4-step onboarding: Workmode → Role → Stuck → Folder pick
// then analyzing splash → first Decide card → post-onboarding Records banner
//
// Design decisions reflected:
//   D7 (design): step 4 folder pick uses hero band pattern + 3 option cards
//   D8 (design): splash failure → graceful fallback (Continue anyway) + template Decide
//   D9 (design): step 4 trust copy ("// 파일은 이 Mac에만 머뭅니다. 외부 전송 0건.")
//   D10 (design): post-onboarding Records banner inline below first Decide card

// MARK: - Color tokens

enum IntakeV2Color {
    static let bg = Color(red: 0.055, green: 0.055, blue: 0.063)          // #0e0e10
    static let panel = Color(red: 0.075, green: 0.075, blue: 0.086)       // #131316
    static let accent = Color(red: 0.086, green: 0.639, blue: 0.290)      // #16a34a
    static let accentBright = Color(red: 0.294, green: 0.871, blue: 0.502) // #4ade80
    static let textPrimary = Color.white
    static let textSecondary = Color.white.opacity(0.65)
    static let textTertiary = Color.white.opacity(0.45)
    static let monospaceMuted = Color.white.opacity(0.4)
}

enum IntakeV2HeroTone {
    case green, gold, blue

    var gradient: LinearGradient {
        switch self {
        case .green:
            return LinearGradient(
                colors: [
                    Color(red: 0.055, green: 0.10, blue: 0.08),
                    Color(red: 0.08, green: 0.21, blue: 0.16),
                    Color(red: 0.13, green: 0.40, blue: 0.30)
                ],
                startPoint: .topLeading,
                endPoint: .bottom
            )
        case .gold:
            return LinearGradient(
                colors: [
                    Color(red: 0.10, green: 0.094, blue: 0.063),
                    Color(red: 0.23, green: 0.20, blue: 0.14),
                    Color(red: 0.48, green: 0.39, blue: 0.18)
                ],
                startPoint: .topLeading,
                endPoint: .bottom
            )
        case .blue:
            return LinearGradient(
                colors: [
                    Color(red: 0.055, green: 0.075, blue: 0.102),
                    Color(red: 0.10, green: 0.15, blue: 0.22),
                    Color(red: 0.16, green: 0.27, blue: 0.43)
                ],
                startPoint: .topLeading,
                endPoint: .bottom
            )
        }
    }
}

// MARK: - Hero band

struct IntakeV2HeroBand<Content: View>: View {
    let tone: IntakeV2HeroTone
    @ViewBuilder let content: () -> Content

    var body: some View {
        ZStack {
            tone.gradient
            DotField()
                .opacity(0.5)
            content()
        }
        .frame(height: 304)
    }
}

private struct DotField: View {
    var body: some View {
        Canvas { ctx, size in
            let spacing: CGFloat = 18
            let cols = Int(size.width / spacing)
            let rows = Int(size.height / spacing)
            for x in 0...cols {
                for y in 0...rows {
                    let rect = CGRect(
                        x: CGFloat(x) * spacing - 1,
                        y: CGFloat(y) * spacing - 1,
                        width: 2, height: 2
                    )
                    ctx.fill(Path(ellipseIn: rect), with: .color(.white.opacity(0.18)))
                }
            }
        }
        .allowsHitTesting(false)
    }
}

// MARK: - Hero pill

struct IntakeV2HeroPill: View {
    let icon: String       // SF Symbol name
    let label: String
    let accent: Color

    var body: some View {
        HStack(spacing: 12) {
            Image(systemName: icon)
                .font(.system(size: 22, weight: .bold))
                .foregroundStyle(accent)
            Text(label)
                .font(.system(size: 20, weight: .semibold, design: .rounded))
                .foregroundStyle(.white)
        }
        .padding(.horizontal, 26)
        .padding(.vertical, 14)
        .background(
            Capsule()
                .fill(.black.opacity(0.4))
                .overlay(Capsule().stroke(.white.opacity(0.08), lineWidth: 1))
        )
    }
}

// MARK: - OS identity tag (step 1 hero only, D-design A)

struct IntakeV2OSIdentity: View {
    var body: some View {
        HStack(spacing: 8) {
            Text("agentic30")
                .font(.system(size: 11, weight: .bold))
                .foregroundStyle(.white)
            Text("·")
                .foregroundStyle(.white.opacity(0.3))
            Text("1인 개발자를 위한 실행 OS")
                .font(.system(size: 11, weight: .medium))
                .foregroundStyle(.white.opacity(0.65))
        }
        .textCase(.uppercase)
        .tracking(1.2)
    }
}

// MARK: - Dash pagination

struct IntakeV2DashPagination: View {
    let current: Int      // 1...total
    let total: Int

    var body: some View {
        HStack(spacing: 6) {
            ForEach(1...total, id: \.self) { idx in
                if idx == current {
                    Capsule()
                        .fill(.white)
                        .frame(width: 24, height: 6)
                } else {
                    Circle()
                        .fill(.white.opacity(0.15))
                        .frame(width: 6, height: 6)
                }
            }
        }
    }
}

// MARK: - Headline block

struct IntakeV2Header: View {
    let stepLabel: String
    let title: String
    let subtitle: String
    let sysline: String?       // monospace `// STEP X / 4 · variable → ...`
    var trustLine: String? = nil  // D9 — step 4 trust copy

    var body: some View {
        VStack(alignment: .leading, spacing: 12) {
            // step label is in pagination; this is the syslin
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
            if let sysline {
                Text(sysline)
                    .font(.system(size: 12, weight: .semibold, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.accent)
                    .padding(.top, 6)
            }
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
    let sysVar: String?
    let selected: Bool
    let onTap: () -> Void

    var body: some View {
        Button(action: onTap) {
            HStack(alignment: .center, spacing: 14) {
                ZStack {
                    Circle()
                        .fill(selected ? IntakeV2Color.accentBright : .white.opacity(0.18))
                        .frame(width: 10, height: 10)
                    if selected {
                        Circle()
                            .stroke(IntakeV2Color.accentBright.opacity(0.4), lineWidth: 6)
                            .frame(width: 18, height: 18)
                            .blur(radius: 4)
                    }
                }
                .frame(width: 18)

                VStack(alignment: .leading, spacing: 4) {
                    HStack(spacing: 8) {
                        Text(title)
                            .font(.system(size: 17, weight: .bold, design: .rounded))
                            .foregroundStyle(IntakeV2Color.textPrimary)
                        if selected, let sysVar {
                            Text(sysVar)
                                .font(.system(size: 11, weight: .medium, design: .monospaced))
                                .foregroundStyle(IntakeV2Color.accentBright)
                                .padding(.horizontal, 7)
                                .padding(.vertical, 2)
                                .background(
                                    RoundedRectangle(cornerRadius: 4)
                                        .stroke(IntakeV2Color.accentBright.opacity(0.3), lineWidth: 1)
                                )
                        }
                    }
                    Text(description)
                        .font(.system(size: 14, weight: .medium, design: .rounded))
                        .foregroundStyle(IntakeV2Color.textTertiary)
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
                    .fill(selected ? IntakeV2Color.accent.opacity(0.08) : .white.opacity(0.03))
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
    let nextTitle: String       // "Next →" or "Start assistant" (final)
    let nextEnabled: Bool
    let onBack: () -> Void
    let onNext: () -> Void

    var body: some View {
        HStack {
            Button(action: onBack) {
                Text("Back")
                    .font(.system(size: 16, weight: .semibold, design: .rounded))
                    .foregroundStyle(backDisabled ? .white.opacity(0.18) : .white.opacity(0.7))
                    .padding(.horizontal, 30)
                    .padding(.vertical, 14)
                    .background(Capsule().fill(.white.opacity(backDisabled ? 0.02 : 0.06)))
            }
            .buttonStyle(.plain)
            .disabled(backDisabled)

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
        }
    }
}

// MARK: - Flow container

enum IntakeV2Step: Int, CaseIterable {
    case workmode = 1, role, stuck, folderPick, splash, firstDecision
}

@MainActor
struct IntakeV2FlowView: View {
    @StateObject private var store = IntakeV2Store()
    @StateObject private var sources = IntakeV2SourceManager()

    @State private var step: IntakeV2Step = .workmode
    @State private var splashResult: IntakeV2Decision?
    @State private var scanFailed = false
    private let decisionEngine = IntakeV2DecisionEngine()

    /// onComplete delivers the final store + source manager so the host can run
    /// integration logic (submit OnboardingContext, register workspace, mark intro
    /// complete) without IntakeV2 having to know about AgenticViewModel.
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
        case .workmode:
            IntakeV2WorkmodeView(
                store: store,
                onBack: {},
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
                    step = .splash
                }
            )
        case .splash:
            IntakeV2SplashView(
                store: store,
                sources: sources,
                onComplete: { decision, didFail in
                    splashResult = decision
                    scanFailed = didFail
                    step = .firstDecision
                }
            )
        case .firstDecision:
            IntakeV2FirstDecisionView(
                decision: splashResult ?? decisionEngine.fallbackTemplate(intake: IntakeSnapshot.from(store: store)),
                sources: sources,
                scanFailed: scanFailed,
                onDone: { onComplete?(store, sources) }
            )
        }
    }
}

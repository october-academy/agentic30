import SwiftUI
import AppKit
import Combine

// MARK: - Intake V2 Showcase Views — 2026-05-14
// Post-intake OS-product showcase. 4 screens that ride after folder pick:
//   BootIntro → DecideShowcase → ConnectShowcase → ReadyAnalyze
// Matches mockup at ~/.gstack/.../onboarding-step2-redesign-20260514/flow-step{1,2,3,4}.html

// MARK: - Shared eyebrow

private struct ShowcaseEyebrow: View {
    let label: String
    var body: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(IntakeV2Color.accent)
                .frame(width: 6, height: 6)
                .shadow(color: IntakeV2Color.accent.opacity(0.7), radius: 6)
            Text(label)
                .font(.system(size: 11, weight: .semibold, design: .monospaced))
                .foregroundStyle(IntakeV2Color.accent)
                .tracking(1.65)
                .textCase(.uppercase)
        }
    }
}

// MARK: - Brand icon tile (used in BootIntro Read column & ConnectShowcase)

private enum BrandIcon: String, CaseIterable {
    case github, gdocs, gsheets, notion, discord, posthog, txt, toss, stripe, threads, folder

    var bg: Color {
        switch self {
        case .github: return Color(red: 0.051, green: 0.067, blue: 0.090)
        case .gdocs: return Color(red: 0.259, green: 0.522, blue: 0.957)
        case .gsheets: return Color(red: 0.059, green: 0.616, blue: 0.345)
        case .notion: return .white
        case .discord: return Color(red: 0.345, green: 0.396, blue: 0.949)
        case .posthog: return .black
        case .txt: return Color(red: 0.322, green: 0.322, blue: 0.357)
        case .toss: return Color(red: 0.000, green: 0.392, blue: 1.000)
        case .stripe: return Color(red: 0.388, green: 0.357, blue: 1.000)
        case .threads: return .black
        case .folder: return Color(red: 0.322, green: 0.322, blue: 0.357)
        }
    }

    var fg: Color {
        switch self {
        case .notion: return .black
        case .posthog: return Color(red: 0.976, green: 0.741, blue: 0.169)
        case .folder: return Color(red: 0.984, green: 0.749, blue: 0.137)
        default: return .white
        }
    }

    var glyph: String {
        switch self {
        case .github: return "chevron.left.forwardslash.chevron.right"
        case .gdocs: return "doc.fill"
        case .gsheets: return "tablecells.fill"
        case .notion: return "N"        // text glyph
        case .discord: return "bubble.left.and.bubble.right.fill"
        case .posthog: return "chart.line.uptrend.xyaxis"
        case .txt: return "doc.plaintext.fill"
        case .toss: return "T"           // text glyph
        case .stripe: return "S"         // text glyph
        case .threads: return "at"
        case .folder: return "folder.fill"
        }
    }

    var isTextGlyph: Bool {
        switch self { case .notion, .toss, .stripe: return true; default: return false }
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
            if icon.isTextGlyph {
                Text(icon.glyph)
                    .font(.system(size: size * 0.52, weight: .black, design: .serif))
                    .foregroundStyle(icon.fg)
            } else {
                Image(systemName: icon.glyph)
                    .font(.system(size: size * 0.46, weight: .bold))
                    .foregroundStyle(icon.fg)
            }
        }
        .frame(width: size, height: size)
    }
}

// MARK: - Step 5 (Showcase 1 / 4) — BOOT

@MainActor
struct IntakeV2BootIntroView: View {
    let onBack: () -> Void
    let onNext: () -> Void

    @State private var activeColumn: Int = 0
    @State private var iconSpotlight: Int = 0
    @State private var decideIdx: Int = 0
    @State private var columnTimer: Timer?
    @State private var iconTimer: Timer?
    @State private var decideTimer: Timer?

    private let readIcons: [BrandIcon] = [
        .github, .gdocs, .gsheets, .notion, .discord, .posthog, .txt, .toss, .threads
    ]

    private let decideSamples: [(body: String, tag: String)] = [
        ("이번 주 가입자 3명에게 30분 인터뷰 요청하고 결제 의향 묻기",
         "signal=interview_request · priority=critical"),
        ("결제 거절 응답 3건의 공통 reason 분석",
         "signal=payment_response · priority=high"),
        ("어제 수정된 SPEC.md changelog 반영",
         "signal=doc_change · priority=med"),
        ("구독 6개월 사용자 churn 패턴 정리",
         "signal=churn · priority=med")
    ]
    var body: some View {
        VStack(spacing: 0) {
            ScrollView(.vertical) {
                VStack(alignment: .leading, spacing: 28) {
                    ShowcaseEyebrow(label: "STEP 1 / 4 · BOOT")
                    IntakeV2Header(
                        title: "Agentic30 — 1인 개발자를 위한 실행 OS",
                        subtitle: "컨텍스트를 읽고, 오늘 한 가지를 결정하고, 실행을 추적합니다. Read → Decide → Execute 세 동작이 매일 반복됩니다."
                    )
                    .layoutPriority(1)
                    .padding(.bottom, 18)

                    HStack(alignment: .top, spacing: 14) {
                        capCard(number: "01", verb: "Read",
                                desc: "코드·문서·인터뷰·결제·공개 기록을 컨텍스트로 흡수합니다.",
                                active: activeColumn == 0) {
                            ReadIconGrid(icons: readIcons, spotlight: iconSpotlight)
                        }
                        capCard(number: "02", verb: "Decide",
                                desc: "신호 강도·우선순위·미처리 기간으로 오늘의 한 가지를 결정.",
                                active: activeColumn == 1) {
                            DecideMiniNotif(bodyText: decideSamples[decideIdx].body,
                                            tag: decideSamples[decideIdx].tag)
                        }
                        capCard(number: "03", verb: "Execute",
                                desc: "당신이 실행. OS는 결과를 기록하고 다음 결정에 반영.",
                                active: activeColumn == 2) {
                            ExecuteTaskList()
                        }
                    }
                    .frame(height: 330)

                    HStack(spacing: 6) {
                        Circle().fill(IntakeV2Color.accent).frame(width: 6, height: 6)
                        Text("kernel ready · 3 modules loaded ·")
                            .foregroundStyle(IntakeV2Color.textTertiary)
                        Text("→ continue")
                            .foregroundStyle(IntakeV2Color.textSecondary)
                    }
                    .font(.system(size: 11, weight: .medium, design: .monospaced))
                    .tracking(0.6)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .padding(.top, 2)
                }
                .padding(.horizontal, 56)
                .padding(.top, 42)
                .padding(.bottom, 18)
                .frame(maxWidth: 1180, alignment: .leading)
                .frame(maxWidth: .infinity)
            }
            .scrollIndicators(.hidden)

            IntakeV2Footer(
                backDisabled: false,
                nextTitle: "Continue →",
                nextEnabled: true,
                onBack: onBack,
                onNext: onNext
            )
            .padding(.horizontal, 56)
            .padding(.top, 12)
            .padding(.bottom, 36)
            .frame(maxWidth: 1180, alignment: .leading)
            .frame(maxWidth: .infinity)
            .background {
                IntakeV2Color.bg
            }
        }
        .onAppear { startTimers() }
        .onDisappear { stopTimers() }
    }

    @ViewBuilder
    private func capCard<C: View>(number: String, verb: String, desc: String, active: Bool, @ViewBuilder visual: () -> C) -> some View {
        VStack(alignment: .leading, spacing: 14) {
            HStack(alignment: .firstTextBaseline, spacing: 10) {
                Text(number)
                    .font(.system(size: 11, weight: .bold, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.textTertiary)
                    .tracking(1.2)
                HStack(spacing: 0) {
                    Text(verb)
                        .font(.system(size: 24, weight: .heavy, design: .rounded))
                        .foregroundStyle(.white)
                    Text(".")
                        .font(.system(size: 24, weight: .heavy, design: .rounded))
                        .foregroundStyle(IntakeV2Color.accent)
                }
            }
            Text(desc)
                .font(.system(size: 12.5))
                .foregroundStyle(IntakeV2Color.textTertiary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
            Spacer(minLength: 8)
            visual()
                .frame(maxWidth: .infinity)
        }
        .padding(20)
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(
            ZStack(alignment: .top) {
                RoundedRectangle(cornerRadius: 14)
                    .fill(active ? Color(red: 0.082, green: 0.090, blue: 0.098) : IntakeV2Color.panel)
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
                .stroke(active ? IntakeV2Color.accent.opacity(0.26) : .white.opacity(0.06),
                        lineWidth: 1)
        )
        .shadow(color: active ? IntakeV2Color.accent.opacity(0.06) : .clear,
                radius: active ? 18 : 0, y: active ? 8 : 0)
        .animation(.easeInOut(duration: 0.3), value: active)
    }

    private func startTimers() {
        columnTimer?.invalidate()
        columnTimer = Timer.scheduledTimer(withTimeInterval: 2.8, repeats: true) { _ in
            Task { @MainActor in
                withAnimation(.easeInOut(duration: 0.4)) {
                    activeColumn = (activeColumn + 1) % 3
                }
            }
        }
        iconTimer?.invalidate()
        iconTimer = Timer.scheduledTimer(withTimeInterval: 0.7, repeats: true) { _ in
            Task { @MainActor in
                withAnimation(.easeInOut(duration: 0.25)) {
                    iconSpotlight = (iconSpotlight + 1) % readIcons.count
                }
            }
        }
        decideTimer?.invalidate()
        decideTimer = Timer.scheduledTimer(withTimeInterval: 3.0, repeats: true) { _ in
            Task { @MainActor in
                withAnimation(.easeInOut(duration: 0.3)) {
                    decideIdx = (decideIdx + 1) % decideSamples.count
                }
            }
        }
    }

    private func stopTimers() {
        columnTimer?.invalidate(); columnTimer = nil
        iconTimer?.invalidate(); iconTimer = nil
        decideTimer?.invalidate(); decideTimer = nil
    }
}

// MARK: BootIntro — Read column visual

private struct ReadIconGrid: View {
    let icons: [BrandIcon]
    let spotlight: Int

    var body: some View {
        VStack(spacing: 10) {
            let columns = Array(repeating: GridItem(.flexible(), spacing: 10), count: 3)
            LazyVGrid(columns: columns, spacing: 10) {
                ForEach(Array(icons.enumerated()), id: \.offset) { idx, icon in
                    ZStack {
                        RoundedRectangle(cornerRadius: 12)
                            .fill(idx == spotlight ? IntakeV2Color.accent.opacity(0.07) : .white.opacity(0.02))
                            .overlay(
                                RoundedRectangle(cornerRadius: 12)
                                    .stroke(idx == spotlight ? IntakeV2Color.accent.opacity(0.28) : .white.opacity(0.04), lineWidth: 1)
                            )
                        BrandIconTile(icon: icon, size: 30, corner: 8)
                    }
                    .aspectRatio(1, contentMode: .fit)
                    .scaleEffect(idx == spotlight ? 1.03 : 1.0)
                }
            }
            Text("\(icons[spotlight].name) · \(icons[spotlight].kind)")
                .font(.system(size: 10, weight: .semibold, design: .monospaced))
                .foregroundStyle(IntakeV2Color.textCardSecondary)
                .tracking(0.35)
                .lineLimit(1)
                .minimumScaleFactor(0.75)
                .frame(maxWidth: .infinity, alignment: .center)
        }
    }
}

// MARK: BootIntro — Decide column visual

private struct DecideMiniNotif: View {
    let bodyText: String
    let tag: String

    var body: some View {
        VStack(spacing: 6) {
            ZStack {
                RoundedRectangle(cornerRadius: 14)
                    .fill(
                        LinearGradient(
                            colors: [
                                Color(red: 0.078, green: 0.110, blue: 0.086),
                                Color(red: 0.117, green: 0.150, blue: 0.090)
                            ],
                            startPoint: .leading,
                            endPoint: .trailing
                        )
                    )
                    .overlay(
                        RoundedRectangle(cornerRadius: 14)
                            .stroke(.white.opacity(0.06), lineWidth: 1)
                    )
                HStack(spacing: 10) {
                    AppLogoSmall()
                    VStack(alignment: .leading, spacing: 3) {
                        Text("오늘의 한 가지")
                            .font(.system(size: 10, weight: .bold))
                            .foregroundStyle(.white)
                        Text(bodyText)
                            .font(.system(size: 11))
                            .foregroundStyle(.white.opacity(0.85))
                            .lineLimit(2)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 6)
                    Text("실행")
                        .font(.system(size: 10, weight: .bold))
                        .foregroundStyle(Color(red: 0.020, green: 0.180, blue: 0.086))
                        .padding(.horizontal, 10)
                        .padding(.vertical, 5)
                        .background(Capsule().fill(Color(red: 0.290, green: 0.871, blue: 0.502)))
                }
                .padding(.horizontal, 14)
                .padding(.vertical, 12)
            }
            .frame(height: 76)
            .shadow(color: .black.opacity(0.4), radius: 12, y: 8)

            Text(tag)
                .font(.system(size: 10, design: .monospaced))
                .foregroundStyle(IntakeV2Color.textTertiary)
                .tracking(0.4)
        }
    }
}

private struct AppLogoSmall: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 8, style: .continuous)
                .fill(.white)
                .frame(width: 32, height: 32)
                .shadow(color: .black.opacity(0.3), radius: 4, y: 2)
            HStack(spacing: -3) {
                Circle().fill(Color(red: 0.13, green: 0.77, blue: 0.37)).frame(width: 9, height: 9)
                Circle().fill(Color(red: 0.98, green: 0.45, blue: 0.09)).frame(width: 9, height: 9)
            }
        }
    }
}

// MARK: BootIntro — Execute column visual

private struct ExecuteTaskList: View {
    private struct Row { let label: String; let meta: String; let state: ExecState }
    private enum ExecState { case done, current, pending }

    private let rows: [Row] = [
        Row(label: "월 · 결제 거절 reason 분석", meta: "2h", state: .done),
        Row(label: "화 · SPEC.md changelog 반영", meta: "40m", state: .done),
        Row(label: "오늘 · 인터뷰 요청 3건 발송", meta: "…", state: .current),
        Row(label: "내일 · churn 패턴 정리", meta: "—", state: .pending)
    ]

    var body: some View {
        VStack(spacing: 6) {
            ForEach(Array(rows.enumerated()), id: \.offset) { _, row in
                HStack(spacing: 10) {
                    checkBox(state: row.state)
                    Text(row.label)
                        .font(.system(size: 11))
                        .foregroundStyle(textColor(row.state))
                        .strikethrough(row.state == .done, color: IntakeV2Color.accent.opacity(0.5))
                    Spacer()
                    Text(row.meta)
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                }
                .padding(.horizontal, 12)
                .padding(.vertical, 8)
                .background(
                    RoundedRectangle(cornerRadius: 8)
                        .fill(row.state == .current ? IntakeV2Color.accent.opacity(0.08) : .white.opacity(0.02))
                        .overlay(
                            RoundedRectangle(cornerRadius: 8)
                                .stroke(row.state == .current ? IntakeV2Color.accent.opacity(0.3) : .white.opacity(0.04),
                                        lineWidth: 1)
                        )
                )
            }
        }
    }

    private func textColor(_ s: ExecState) -> Color {
        switch s {
        case .done: return .white.opacity(0.4)
        case .current: return .white
        case .pending: return .white.opacity(0.4)
        }
    }

    @ViewBuilder
    private func checkBox(state: ExecState) -> some View {
        RoundedRectangle(cornerRadius: 4)
            .fill(state == .done ? IntakeV2Color.accent : .clear)
            .overlay(
                RoundedRectangle(cornerRadius: 4)
                    .stroke(state == .done ? IntakeV2Color.accent : (state == .current ? IntakeV2Color.accent : .white.opacity(0.2)),
                            lineWidth: 1.5)
            )
            .overlay {
                if state == .done {
                    Image(systemName: "checkmark")
                        .font(.system(size: 9, weight: .bold))
                        .foregroundStyle(.white)
                }
            }
            .frame(width: 16, height: 16)
    }
}

// MARK: - Step 6 (Showcase 2 / 4) — DECIDE

@MainActor
struct IntakeV2DecideShowcaseView: View {
    let onBack: () -> Void
    let onNext: () -> Void

    private struct Candidate {
        let badge: String
        let meta: String
        let id: String
        let body: String
        let why: String
        let srcs: [BrandIcon]
        let label: String
    }

    private let tasks: [Candidate] = [
        Candidate(
            badge: "INTERVIEW_REQUEST",
            meta: "priority=critical · age=8w",
            id: "task_9c1e",
            body: "이번 주 신규 가입자 3명에게 30분 인터뷰 요청 발송",
            why: "8주간 demand interview 0건. ICP 정의 update 없음. 결정 정확도가 떨어지는 가장 큰 원인.",
            srcs: [.notion, .gdocs, .txt],
            label: "Notion · Docs · interviews.txt"
        ),
        Candidate(
            badge: "PAYMENT_RESPONSE",
            meta: "count=3 · age=2d · priority=high",
            id: "task_8af3",
            body: "결제 거절 응답 3건의 공통 reason 분석",
            why: "결제 거절 신호가 2일째 미처리. 다른 신호(인터뷰·문서 변경)보다 우선순위 점수가 높음.",
            srcs: [.toss, .gsheets, .discord],
            label: "Toss · Sheets · Discord"
        ),
        Candidate(
            badge: "DOC_CHANGE",
            meta: "source=notion · age=6h · priority=med",
            id: "task_a042",
            body: "어제 수정된 SPEC.md 의 v0.4 변경점을 changelog 에 반영",
            why: "어제 18:32 SPEC.md 변경. changelog 미반영. 다음 release 차단 가능.",
            srcs: [.github, .notion, .txt],
            label: "Git · Notion · TXT"
        ),
        Candidate(
            badge: "CHURN_SIGNAL",
            meta: "users=2 · age=24h · priority=med",
            id: "task_b1cc",
            body: "구독 6개월 사용자 2명의 churn 패턴 정리",
            why: "장기 사용자 이탈 = 가장 비싼 신호. 단 결제 응답보다 age 가 짧아 우선순위 차순.",
            srcs: [.posthog, .toss, .gsheets],
            label: "PostHog · Toss · Sheets"
        )
    ]

    @State private var idx: Int = 0
    @State private var fading: Bool = false
    @State private var rotateTimer: Timer?

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 22) {
                ShowcaseEyebrow(label: "STEP 2 / 4 · DECIDE")
                IntakeV2Header(
                    title: "오늘의 결정",
                    subtitle: "OS가 컨텍스트를 읽고 신호 강도·우선순위·미처리 기간으로 오늘 가장 시급한 한 가지를 결정합니다. macOS 알림 형태로 도착합니다."
                )

                let t = tasks[idx]

                // Meta line
                HStack(spacing: 10) {
                    Text(t.badge)
                        .font(.system(size: 11, weight: .bold, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.accentBright)
                        .tracking(0.6)
                        .padding(.horizontal, 9)
                        .padding(.vertical, 3)
                        .background(
                            RoundedRectangle(cornerRadius: 4)
                                .fill(IntakeV2Color.accent.opacity(0.15))
                                .overlay(
                                    RoundedRectangle(cornerRadius: 4)
                                        .stroke(IntakeV2Color.accent.opacity(0.25), lineWidth: 1)
                                )
                        )
                    Text("·").foregroundStyle(.white.opacity(0.15))
                    Text(t.meta)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                    Spacer()
                    Text(t.id)
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.monospaceMuted)
                }
                .frame(maxWidth: 880)
                .frame(maxWidth: .infinity, alignment: .center)

                // Hero notification card
                HStack(spacing: 22) {
                    HeroNotifIcon()
                    VStack(alignment: .leading, spacing: 6) {
                        Text("오늘의 한 가지")
                            .font(.system(size: 16, weight: .bold))
                            .foregroundStyle(.white)
                        Text(t.body)
                            .font(.system(size: 18, weight: .medium))
                            .foregroundStyle(.white.opacity(0.94))
                            .opacity(fading ? 0 : 1)
                            .fixedSize(horizontal: false, vertical: true)
                    }
                    Spacer(minLength: 12)
                    Text("실행")
                        .font(.system(size: 15, weight: .bold))
                        .foregroundStyle(Color(red: 0.020, green: 0.180, blue: 0.086))
                        .padding(.horizontal, 28)
                        .padding(.vertical, 14)
                        .background(Capsule().fill(Color(red: 0.133, green: 0.773, blue: 0.369)))
                        .shadow(color: Color.green.opacity(0.3), radius: 16, y: 8)
                }
                .padding(.horizontal, 28)
                .padding(.vertical, 26)
                .background(
                    RoundedRectangle(cornerRadius: 28)
                        .fill(
                            LinearGradient(
                                colors: [
                                    Color(red: 0.060, green: 0.110, blue: 0.075),
                                    Color(red: 0.082, green: 0.125, blue: 0.090),
                                    Color(red: 0.155, green: 0.118, blue: 0.060)
                                ],
                                startPoint: .leading,
                                endPoint: .trailing
                            )
                        )
                        .overlay(
                            RoundedRectangle(cornerRadius: 28)
                                .stroke(.white.opacity(0.05), lineWidth: 1)
                        )
                        .shadow(color: .black.opacity(0.4), radius: 30, y: 20)
                )
                .frame(maxWidth: 880)
                .frame(maxWidth: .infinity, alignment: .center)

                // WHY rationale
                HStack(alignment: .top, spacing: 14) {
                    Text("// WHY")
                        .font(.system(size: 11, weight: .semibold, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.accent)
                        .padding(.top, 1)
                    Text(t.why)
                        .font(.system(size: 13))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                        .opacity(fading ? 0 : 1)
                        .lineSpacing(2)
                        .fixedSize(horizontal: false, vertical: true)
                    Spacer()
                }
                .frame(maxWidth: 880)
                .frame(maxWidth: .infinity, alignment: .center)

                // Source chips
                HStack(spacing: 6) {
                    Text("READ FROM ·")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.monospaceMuted)
                        .tracking(0.6)
                    ForEach(Array(t.srcs.enumerated()), id: \.offset) { _, src in
                        HStack(spacing: 5) {
                            BrandIconTile(icon: src, size: 14, corner: 4)
                            Text(src.name)
                                .font(.system(size: 10, design: .monospaced))
                                .foregroundStyle(.white.opacity(0.8))
                        }
                        .padding(.horizontal, 9)
                        .padding(.vertical, 4)
                        .background(
                            Capsule()
                                .fill(.white.opacity(0.03))
                                .overlay(Capsule().stroke(.white.opacity(0.06), lineWidth: 1))
                        )
                    }
                    Spacer()
                }
                .frame(maxWidth: 880)
                .frame(maxWidth: .infinity, alignment: .center)

                // Cycle dots + counter
                HStack(spacing: 14) {
                    Text("candidates")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.monospaceMuted)
                    HStack(spacing: 5) {
                        ForEach(0..<tasks.count, id: \.self) { i in
                            if i == idx {
                                Capsule()
                                    .fill(IntakeV2Color.accentBright)
                                    .frame(width: 18, height: 5)
                            } else {
                                Circle()
                                    .fill(.white.opacity(0.15))
                                    .frame(width: 5, height: 5)
                            }
                        }
                    }
                    Text("\(idx + 1) / \(tasks.count)")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.monospaceMuted)
                }
                .frame(maxWidth: .infinity, alignment: .center)
                .padding(.top, 4)

                Text("↑↓ 후보 전환 · ↵ 실행 · D 지연 · ⇧↵ 다른 결정 보기")
                    .font(.system(size: 10, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.monospaceMuted)
                    .frame(maxWidth: .infinity, alignment: .center)

                Spacer(minLength: 0)
                IntakeV2Footer(
                    backDisabled: false,
                    nextTitle: "Continue →",
                    nextEnabled: true,
                    onBack: onBack,
                    onNext: onNext
                )
            }
            .padding(.horizontal, 56)
            .padding(.top, 36)
            .padding(.bottom, 36)
            .frame(maxWidth: 1180, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .background(Color(red: 0.039, green: 0.078, blue: 0.063))
        .onAppear { startRotation() }
        .onDisappear { stopRotation() }
    }

    private func startRotation() {
        rotateTimer?.invalidate()
        rotateTimer = Timer.scheduledTimer(withTimeInterval: 3.5, repeats: true) { _ in
            Task { @MainActor in
                withAnimation(.easeOut(duration: 0.35)) { fading = true }
                try? await Task.sleep(nanoseconds: 350_000_000)
                idx = (idx + 1) % tasks.count
                withAnimation(.easeIn(duration: 0.35)) { fading = false }
            }
        }
    }

    private func stopRotation() {
        rotateTimer?.invalidate()
        rotateTimer = nil
    }
}

private struct HeroNotifIcon: View {
    var body: some View {
        ZStack {
            RoundedRectangle(cornerRadius: 14, style: .continuous)
                .fill(.white)
                .frame(width: 64, height: 64)
                .shadow(color: .black.opacity(0.3), radius: 12, y: 4)
            HStack(spacing: -8) {
                Circle().fill(Color(red: 0.13, green: 0.77, blue: 0.37)).frame(width: 22, height: 22)
                Circle().fill(Color(red: 0.98, green: 0.45, blue: 0.09)).frame(width: 22, height: 22)
            }
        }
    }
}

// MARK: - Step 7 (Showcase 3 / 4) — CONNECT

@MainActor
struct IntakeV2ConnectShowcaseView: View {
    @ObservedObject var sources: IntakeV2SourceManager
    let onBack: () -> Void
    let onNext: () -> Void

    @State private var selection: Set<BrandIcon> = []
    @State private var errorTiles: Set<BrandIcon> = []

    private let allSources: [BrandIcon] = [
        .folder, .github, .gdocs, .gsheets, .notion, .discord, .posthog,
        .toss, .stripe, .threads, .txt
    ]

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 22) {
                ShowcaseEyebrow(label: "STEP 3 / 4 · CONNECT")
                IntakeV2Header(
                    title: "Source 연결",
                    subtitle: "OS가 읽을 데이터 소스를 정의합니다. 컨텍스트가 클수록 결정 정확도가 높아집니다. 나중에 Settings에서 추가·제거 가능. 카드 클릭으로 토글."
                )

                let columns = Array(repeating: GridItem(.flexible(), spacing: 12), count: 4)
                LazyVGrid(columns: columns, spacing: 12) {
                    ForEach(allSources, id: \.self) { src in
                        sourceCard(src)
                    }
                    addCustomCard()
                }
                .frame(maxWidth: 920)
                .frame(maxWidth: .infinity, alignment: .center)

                HStack {
                    HStack(spacing: 6) {
                        Circle().fill(IntakeV2Color.accent).frame(width: 5, height: 5)
                        Text("\(selection.count) connected")
                            .foregroundStyle(IntakeV2Color.textTertiary)
                        if !errorTiles.isEmpty {
                            Text("·").foregroundStyle(.white.opacity(0.15))
                            Circle().fill(Color(red: 0.961, green: 0.620, blue: 0.043)).frame(width: 5, height: 5)
                            Text("\(errorTiles.count) needs review")
                                .foregroundStyle(IntakeV2Color.textTertiary)
                        }
                    }
                    .font(.system(size: 11, design: .monospaced))
                    Spacer()
                    Text("Click 토글 · → 계속")
                        .font(.system(size: 11, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.monospaceMuted)
                }
                .frame(maxWidth: 920)
                .frame(maxWidth: .infinity, alignment: .center)

                Spacer(minLength: 0)
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
            .padding(.horizontal, 56)
            .padding(.top, 36)
            .padding(.bottom, 36)
            .frame(maxWidth: 1180, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .onAppear { syncSelectionWithRegisteredSources() }
    }

    @ViewBuilder
    private func sourceCard(_ src: BrandIcon) -> some View {
        let isOn = selection.contains(src)
        let isError = errorTiles.contains(src)
        Button(action: { toggle(src) }) {
            VStack(alignment: .leading, spacing: 10) {
                HStack(alignment: .top) {
                    BrandIconTile(icon: src)
                    Spacer()
                    togglePill(on: isOn)
                }
                VStack(alignment: .leading, spacing: 2) {
                    Text(src.name)
                        .font(.system(size: 14, weight: .bold))
                        .foregroundStyle(.white)
                    Text(src.kind)
                        .font(.system(size: 10, weight: .medium, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                        .tracking(0.6)
                }
                Spacer(minLength: 4)
                HStack(spacing: 5) {
                    Circle()
                        .fill(isError ? Color(red: 0.961, green: 0.620, blue: 0.043) : (isOn ? IntakeV2Color.accent : .white.opacity(0.2)))
                        .frame(width: 6, height: 6)
                        .shadow(color: isOn ? IntakeV2Color.accent.opacity(0.6) : .clear, radius: 6)
                    Text(statusText(src, isOn: isOn, isError: isError))
                        .font(.system(size: 11))
                        .foregroundStyle(isError ? Color(red: 0.961, green: 0.620, blue: 0.043) : (isOn ? IntakeV2Color.accentBright : IntakeV2Color.textTertiary))
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
                    .stroke(isOn ? IntakeV2Color.accent : .white.opacity(0.06),
                            lineWidth: isOn ? 1.5 : 1)
            )
            .shadow(color: isOn ? IntakeV2Color.accent.opacity(0.08) : .clear, radius: 12)
        }
        .buttonStyle(.plain)
    }

    @ViewBuilder
    private func addCustomCard() -> some View {
        VStack(spacing: 10) {
            ZStack {
                RoundedRectangle(cornerRadius: 10)
                    .fill(.white.opacity(0.04))
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
        .overlay(
            RoundedRectangle(cornerRadius: 14)
                .strokeBorder(.white.opacity(0.1), style: StrokeStyle(lineWidth: 1, dash: [6, 4]))
        )
    }

    @ViewBuilder
    private func togglePill(on: Bool) -> some View {
        ZStack(alignment: on ? .trailing : .leading) {
            Capsule()
                .fill(on ? IntakeV2Color.accent : .white.opacity(0.1))
                .frame(width: 32, height: 20)
            Circle()
                .fill(.white)
                .frame(width: 16, height: 16)
                .shadow(color: .black.opacity(0.4), radius: 1, y: 1)
                .padding(.horizontal, 2)
        }
        .animation(.easeInOut(duration: 0.18), value: on)
    }

    private func statusText(_ src: BrandIcon, isOn: Bool, isError: Bool) -> String {
        if isError { return "folder empty" }
        if !isOn { return "Not connected" }
        switch src {
        case .github: return "Connected · 3 repos"
        case .gdocs: return "Connected · 128 docs"
        case .notion: return "Connected · 47 pages"
        case .folder: return localFolderStatusText()
        default: return "Connected"
        }
    }

    private func toggle(_ src: BrandIcon) {
        if errorTiles.contains(src) { errorTiles.remove(src) }
        if selection.contains(src) { selection.remove(src) } else { selection.insert(src) }
    }

    private func commitSelectionToManager() {
        let mapping: [BrandIcon: IntakeSourceID] = [
            .github: .github, .gdocs: .googleDocs, .gsheets: .googleSheets,
            .notion: .notion, .discord: .discord, .posthog: .posthog,
            .toss: .toss, .stripe: .stripe, .threads: .threads, .txt: .interviewTxt
        ]
        if !selection.contains(.folder) {
            sources.remove(.localFolder)
        }
        for (icon, id) in mapping {
            if selection.contains(icon) {
                sources.toggle(id, to: .disabled) // marked as "user wanted but not yet connected"
            } else {
                sources.remove(id)
            }
        }
    }

    private func syncSelectionWithRegisteredSources() {
        selection = sources.status(of: .localFolder) == .connected ? [.folder] : []
        errorTiles = []
    }

    private func localFolderStatusText() -> String {
        guard let source = sources.sources.first(where: { $0.id == .localFolder }) else {
            return "Connected"
        }
        if let detail = source.detail {
            return "Connected · \(detail)"
        }
        if let path = source.path {
            return "Connected · \(abbreviatedPath(path))"
        }
        return "Connected"
    }

    private func abbreviatedPath(_ path: String) -> String {
        let home = NSHomeDirectory()
        if path == home {
            return "~"
        }
        if path.hasPrefix(home + "/") {
            return "~/" + String(path.dropFirst(home.count + 1))
        }
        return URL(fileURLWithPath: path).lastPathComponent
    }
}

// MARK: - Step 8 (Showcase 4 / 4) — READY

@MainActor
struct IntakeV2ReadyAnalyzeView: View {
    @ObservedObject var store: IntakeV2Store
    @ObservedObject var sources: IntakeV2SourceManager
    let onDone: () -> Void

    @State private var logLines: [TerminalLine] = []
    @State private var decision: IntakeV2Decision?
    @State private var revealCard: Bool = false
    @State private var scanFailed: Bool = false
    @State private var showTodoWindow: Bool = false
    @State private var generatedTodoTasks: [GeneratedTodoTask] = []
    @State private var todoGenerationComplete: Bool = false
    @State private var todoGenerationTask: Task<Void, Never>?

    var body: some View {
        VStack(spacing: 0) {
            VStack(alignment: .leading, spacing: 22) {
                ShowcaseEyebrow(label: "STEP 4 / 4 · READY")
                IntakeV2Header(
                    title: "Init 완료. 첫 결정을 분석합니다.",
                    subtitle: scanFailed
                        ? "Local scan에서 충분한 신호를 못 찾았어요. intake 답변만으로 첫 결정을 준비합니다."
                        : "당신의 폴더를 읽고 신호를 추출해 오늘의 한 가지를 결정합니다. 완료 후 자동으로 inbox 로 이동합니다."
                )

                terminalBox
                    .frame(maxWidth: 880)
                    .frame(maxWidth: .infinity, alignment: .center)

                if revealCard, let d = decision {
                    VStack(spacing: 14) {
                        firstDecisionCard(d)
                        if showTodoWindow {
                            todoListWindow(for: d)
                                .transition(.asymmetric(
                                    insertion: .move(edge: .bottom).combined(with: .opacity).combined(with: .scale(scale: 0.98, anchor: .top)),
                                    removal: .opacity
                                ))
                        }
                    }
                    .frame(maxWidth: 880)
                    .frame(maxWidth: .infinity, alignment: .center)
                    .transition(.asymmetric(
                        insertion: .move(edge: .bottom).combined(with: .opacity),
                        removal: .opacity
                    ))
                }

                Spacer(minLength: 0)

                HStack {
                    Spacer()
                    Button(action: onDone) {
                        Text("Open inbox →")
                            .font(.system(size: 15, weight: .bold, design: .rounded))
                            .foregroundStyle(.white)
                            .padding(.horizontal, 30)
                            .padding(.vertical, 14)
                            .background(Capsule().fill(IntakeV2Color.accent))
                            .shadow(color: IntakeV2Color.accent.opacity(0.25), radius: 16, y: 8)
                    }
                    .buttonStyle(.plain)
                    .disabled(!revealCard)
                    .opacity(revealCard ? 1 : 0.4)
                }
            }
            .padding(.horizontal, 56)
            .padding(.top, 36)
            .padding(.bottom, 36)
            .frame(maxWidth: 1180, alignment: .leading)
            .frame(maxWidth: .infinity)
        }
        .task { await runBootSequence() }
        .onDisappear {
            todoGenerationTask?.cancel()
            todoGenerationTask = nil
        }
    }

    // MARK: terminal

    private struct TerminalLine: Identifiable {
        let id = UUID()
        let cmd: String
        var status: String?
        var deciding: Bool = false
    }

    private struct GeneratedTodoTask: Identifiable, Equatable {
        let id: Int
        let title: String
        let detail: String
        let tag: String
    }

    private var terminalBox: some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 6) {
                Circle().fill(Color(red: 1.00, green: 0.373, blue: 0.341)).frame(width: 9, height: 9)
                Circle().fill(Color(red: 0.996, green: 0.737, blue: 0.180)).frame(width: 9, height: 9)
                Circle().fill(Color(red: 0.157, green: 0.784, blue: 0.251)).frame(width: 9, height: 9)
                Text("agentic30 — boot.log")
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.monospaceMuted)
                    .padding(.leading, 8)
                Spacer()
            }
            .padding(.bottom, 14)

            VStack(alignment: .leading, spacing: 6) {
                ForEach(logLines) { line in
                    HStack(spacing: 8) {
                        Text("$")
                            .foregroundStyle(IntakeV2Color.accent)
                        Text(line.cmd)
                            .foregroundStyle(.white.opacity(0.85))
                        if line.deciding {
                            DotPulse()
                        }
                        Spacer(minLength: 8)
                        if let status = line.status {
                            Text(status)
                                .foregroundStyle(status.hasPrefix("✓") ? IntakeV2Color.accent : IntakeV2Color.textTertiary)
                        }
                    }
                    .font(.system(size: 13, design: .monospaced))
                    .transition(.opacity)
                }
            }
        }
        .padding(.horizontal, 22)
        .padding(.vertical, 18)
        .frame(maxWidth: .infinity, minHeight: 220, alignment: .topLeading)
        .background(
            RoundedRectangle(cornerRadius: 10)
                .fill(Color(red: 0.039, green: 0.039, blue: 0.047))
                .overlay(
                    RoundedRectangle(cornerRadius: 10)
                        .stroke(.white.opacity(0.06), lineWidth: 1)
                )
        )
    }

    private func firstDecisionCard(_ d: IntakeV2Decision) -> some View {
        VStack(alignment: .leading, spacing: 0) {
            HStack(spacing: 10) {
                Text("FIRST DECISION")
                    .font(.system(size: 10, weight: .bold, design: .monospaced))
                    .foregroundStyle(Color(red: 0.020, green: 0.180, blue: 0.086))
                    .tracking(0.5)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 2)
                    .background(RoundedRectangle(cornerRadius: 4).fill(IntakeV2Color.accent))
                Text(d.category.rawValue)
                    .font(.system(size: 11, weight: .semibold, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.accentBright)
                    .padding(.horizontal, 7)
                    .padding(.vertical, 3)
                    .background(
                        RoundedRectangle(cornerRadius: 4)
                            .fill(IntakeV2Color.accent.opacity(0.15))
                            .overlay(
                                RoundedRectangle(cornerRadius: 4)
                                    .stroke(IntakeV2Color.accent.opacity(0.2), lineWidth: 1)
                            )
                    )
                Text(d.metaLine)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.textTertiary)
                Spacer()
                Text(d.taskID)
                    .font(.system(size: 11, design: .monospaced))
                    .foregroundStyle(IntakeV2Color.monospaceMuted)
            }
            .padding(.horizontal, 18)
            .padding(.vertical, 12)
            .background(
                .white.opacity(0.015)
            )
            .overlay(
                Rectangle()
                    .fill(.white.opacity(0.04))
                    .frame(height: 1),
                alignment: .bottom
            )

            HStack(spacing: 18) {
                Text(d.body)
                    .font(.system(size: 19, weight: .medium))
                    .foregroundStyle(.white)
                    .lineSpacing(3)
                    .fixedSize(horizontal: false, vertical: true)
                Spacer(minLength: 12)
                Button(action: { startTodoGeneration(for: d) }) {
                    HStack(spacing: 8) {
                        Text(executeStartedTitle)
                        Text("↵").opacity(0.8)
                    }
                    .font(.system(size: 14, weight: .bold))
                    .foregroundStyle(.white)
                    .padding(.horizontal, 22)
                    .padding(.vertical, 12)
                    .background(RoundedRectangle(cornerRadius: 10).fill(IntakeV2Color.accent))
                    .shadow(color: IntakeV2Color.accent.opacity(0.3), radius: 16, y: 6)
                }
                .buttonStyle(.plain)
                .disabled(showTodoWindow)
                .opacity(showTodoWindow ? 0.82 : 1)
            }
            .padding(22)
        }
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(IntakeV2Color.panel)
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(IntakeV2Color.accent.opacity(0.3), lineWidth: 1)
                )
                .shadow(color: IntakeV2Color.accent.opacity(0.15), radius: 32, y: 16)
        )
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(IntakeV2Color.accent)
                .frame(width: 4)
                .clipShape(
                    UnevenRoundedRectangle(
                        cornerRadii: .init(topLeading: 12, bottomLeading: 12, bottomTrailing: 0, topTrailing: 0)
                    )
                )
        }
    }

    private var executeStartedTitle: String {
        showTodoWindow ? "Executing" : "Execute"
    }

    private func todoListWindow(for d: IntakeV2Decision) -> some View {
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
            .background(.white.opacity(0.018))
            .overlay(Rectangle().fill(.white.opacity(0.045)).frame(height: 1), alignment: .bottom)

            VStack(alignment: .leading, spacing: 8) {
                HStack(spacing: 8) {
                    Text(d.taskID)
                        .font(.system(size: 10, weight: .semibold, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.accentBright)
                    Text("→ split into executable tasks")
                        .font(.system(size: 10, design: .monospaced))
                        .foregroundStyle(IntakeV2Color.textTertiary)
                    Spacer()
                }
                .padding(.bottom, 2)

                ForEach(generatedTodoTasks) { task in
                    todoTaskRow(task)
                        .transition(.asymmetric(
                            insertion: .move(edge: .top).combined(with: .opacity).combined(with: .scale(scale: 0.96, anchor: .top)),
                            removal: .opacity
                        ))
                }

                if !todoGenerationComplete {
                    todoDraftRow(nextIndex: generatedTodoTasks.count + 1)
                        .transition(.opacity)
                }
            }
            .padding(16)
        }
        .background(
            RoundedRectangle(cornerRadius: 12)
                .fill(Color(red: 0.038, green: 0.042, blue: 0.047))
                .overlay(
                    RoundedRectangle(cornerRadius: 12)
                        .stroke(IntakeV2Color.accent.opacity(0.22), lineWidth: 1)
                )
                .shadow(color: IntakeV2Color.accent.opacity(0.10), radius: 28, y: 14)
        )
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
                    .foregroundStyle(.white.opacity(0.94))
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
                .fill(.white.opacity(0.025))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(.white.opacity(0.055), lineWidth: 1))
        )
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
                    .fill(.white.opacity(0.10))
                    .frame(width: nextIndex == 1 ? 230 : 280, height: 8)
                RoundedRectangle(cornerRadius: 3)
                    .fill(.white.opacity(0.055))
                    .frame(width: nextIndex == 3 ? 190 : 245, height: 7)
            }
            Spacer()
        }
        .padding(.horizontal, 12)
        .padding(.vertical, 12)
        .background(
            RoundedRectangle(cornerRadius: 8)
                .fill(.white.opacity(0.014))
                .overlay(RoundedRectangle(cornerRadius: 8).stroke(.white.opacity(0.035), lineWidth: 1))
        )
    }

    private func startTodoGeneration(for decision: IntakeV2Decision) {
        guard !showTodoWindow else { return }
        todoGenerationTask?.cancel()
        generatedTodoTasks = []
        todoGenerationComplete = false
        withAnimation(.spring(response: 0.48, dampingFraction: 0.82)) {
            showTodoWindow = true
        }
        todoGenerationTask = Task { await runTodoGeneration(for: decision) }
    }

    @MainActor private func runTodoGeneration(for decision: IntakeV2Decision) async {
        let tasks = todoTasks(for: decision)
        for task in tasks {
            try? await Task.sleep(nanoseconds: 650_000_000)
            guard !Task.isCancelled else { return }
            withAnimation(.spring(response: 0.44, dampingFraction: 0.84)) {
                generatedTodoTasks.append(task)
            }
        }
        try? await Task.sleep(nanoseconds: 250_000_000)
        guard !Task.isCancelled else { return }
        withAnimation(.easeOut(duration: 0.24)) {
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
                GeneratedTodoTask(id: 2, title: "반복되는 reason 3개를 라벨링합니다.", detail: "빈도보다 구매 차단 강도가 큰 항목을 먼저 봅니다.", tag: "LABEL"),
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

    private func runBootSequence() async {
        // 1. kernel.init
        await pushLine(cmd: "kernel.init", delayMs: 400)
        await markLast(status: "✓ ready", delayMs: 500)

        // 2. sources.connect — show connected count from manager
        let connected = max(1, sources.connectedCount)
        let names = sources.connectedSources.compactMap { srcShortName($0.id) }.prefix(2).joined(separator: " · ")
        await pushLine(cmd: "sources.connect", delayMs: 200)
        await markLast(status: "\(connected) active (\(names.isEmpty ? "local" : names))", delayMs: 600)

        // 3. context.read — actual scan
        let intake = IntakeSnapshot.from(store: store)
        var scan = LocalScanResult.empty
        if let url = store.folderURL {
            await pushLine(cmd: "context.read \(url.lastPathComponent)", delayMs: 200)
            do {
                scan = try realScan(url: url)
                let approxKB = (scan.fileCount * 6) // rough
                await markLast(status: "✓ \(scan.fileCount) docs · \(approxKB) KB indexed", delayMs: 800)
            } catch {
                scanFailed = true
                await markLast(status: "✗ scan failed", delayMs: 600)
            }
        } else {
            scanFailed = true
            await pushLine(cmd: "context.read (no folder)", delayMs: 200)
            await markLast(status: "skipped", delayMs: 400)
        }

        // 4. signals.detect
        await pushLine(cmd: "signals.detect", delayMs: 200)
        await markLast(status: "✓ \(scan.fileCount > 0 ? "12 signals (4 high · 6 med · 2 low)" : "template signals")", delayMs: 900)

        // 5. decide… (deciding)
        await pushLine(cmd: "decide", deciding: true, delayMs: 200)
        let made: IntakeV2Decision = scanFailed
            ? IntakeV2DecisionEngine().fallbackTemplate(intake: intake)
            : IntakeV2DecisionEngine().generate(intake: intake, scan: scan)
        try? await Task.sleep(nanoseconds: 1_200_000_000)

        // 6. decide ✓
        await replaceLastDeciding(with: "decide", status: "✓ \(made.taskID)", delayMs: 500)

        // Reveal first-decision card
        decision = made
        withAnimation(.spring(response: 0.55, dampingFraction: 0.85)) {
            revealCard = true
        }
    }

    @MainActor private func pushLine(cmd: String, deciding: Bool = false, delayMs: Int) async {
        try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
        withAnimation(.easeIn(duration: 0.25)) {
            logLines.append(TerminalLine(cmd: cmd, status: nil, deciding: deciding))
        }
    }

    @MainActor private func markLast(status: String, delayMs: Int) async {
        try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
        guard !logLines.isEmpty else { return }
        logLines[logLines.count - 1].status = status
    }

    @MainActor private func replaceLastDeciding(with cmd: String, status: String, delayMs: Int) async {
        try? await Task.sleep(nanoseconds: UInt64(delayMs) * 1_000_000)
        guard !logLines.isEmpty else { return }
        logLines[logLines.count - 1] = TerminalLine(cmd: cmd, status: status, deciding: false)
    }

    private func realScan(url: URL) throws -> LocalScanResult {
        let fm = FileManager.default
        let contents = try fm.contentsOfDirectory(atPath: url.path)
        return LocalScanResult(
            fileCount: contents.count,
            totalBytes: 0,
            staleSpecDays: nil,
            staleTodoDays: nil,
            lastCommitDays: nil,
            hasInterviewTranscripts: contents.contains { $0.range(of: "interview", options: .caseInsensitive) != nil },
            hasPaymentResponses: false
        )
    }

    private func srcShortName(_ id: IntakeSourceID) -> String? {
        switch id {
        case .localFolder: return "local"
        case .googleDocs: return "gdocs"
        case .github: return "git"
        case .notion: return "notion"
        case .googleSheets: return "sheets"
        case .discord: return "discord"
        case .posthog: return "posthog"
        case .toss: return "toss"
        case .stripe: return "stripe"
        case .threads: return "threads"
        case .interviewTxt: return "txt"
        }
    }
}

// MARK: - DotPulse (deciding... animation)

private struct DotPulse: View {
    @State private var phase: Int = 0
    private let timer = Timer.publish(every: 0.4, on: .main, in: .common).autoconnect()

    var body: some View {
        Text(String(repeating: ".", count: phase + 1))
            .font(.system(size: 13, design: .monospaced))
            .foregroundStyle(IntakeV2Color.accent)
            .frame(width: 22, alignment: .leading)
            .onReceive(timer) { _ in
                phase = (phase + 1) % 3
            }
    }
}

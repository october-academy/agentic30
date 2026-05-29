import SwiftUI

/// Day-1 "project situation" card. Renders the sidecar's multi-angle summary
/// (product / engineering / recent focus), a README-update suggestion, next
/// action chips, and a button-first goal-concretization decision. Tapping a
/// goal option calls `onChooseGoal` (wired to send it through the chat flow).
///
/// Colors use the theme-aware `OpenDesignDayColor` palette so the card stays
/// legible in both the white and dark Open Design Day themes. Shown only when a
/// `day1SituationSummary` is present, so existing Day-1 screenshots stay
/// pixel-stable when it is absent.
struct Day1SituationSummaryCard: View {
    let summary: Day1SituationSummary
    var onChooseGoal: (String) -> Void = { _ in }

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header

            VStack(alignment: .leading, spacing: 8) {
                angleRow(label: "제품", value: summary.angles.product)
                angleRow(label: "엔지니어링", value: summary.angles.engineering)
                angleRow(label: "최근 작업", value: summary.angles.recentFocus)
            }

            if summary.readmeUpdate.hasDrift {
                readmeRow
            }

            if !summary.nextActions.isEmpty {
                nextActions
            }

            goalDecision
        }
        .padding(18)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .fill(OpenDesignDayColor.elevated)
        )
        .overlay(
            RoundedRectangle(cornerRadius: 18, style: .continuous)
                .stroke(OpenDesignDayColor.border, lineWidth: 1)
        )
        .shadow(color: Color.black.opacity(0.12), radius: 10, x: 0, y: 4)
        .padding(.horizontal, 18)
        .padding(.top, 16)
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("day1.situationSummary.card")
    }

    private var header: some View {
        HStack(spacing: 8) {
            Circle()
                .fill(OpenDesignDayColor.accent)
                .frame(width: 8, height: 8)
            Text("프로젝트 상황 요약")
                .font(.system(size: 15, weight: .bold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fg)
                .accessibilityIdentifier("day1.situationSummary.title")
            Spacer()
        }
    }

    private func angleRow(label: String, value: String) -> some View {
        HStack(alignment: .top, spacing: 10) {
            Text(label)
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.accentStrong)
                .frame(width: 64, alignment: .leading)
            Text(value)
                .font(.system(size: 13, weight: .medium, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var readmeRow: some View {
        HStack(alignment: .top, spacing: 8) {
            Image(systemName: "doc.badge.gearshape")
                .font(.system(size: 12, weight: .semibold))
                .foregroundStyle(OpenDesignDayColor.amber)
            Text(summary.readmeUpdate.suggestion)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(RoundedRectangle(cornerRadius: 12, style: .continuous).fill(OpenDesignDayColor.amberDim))
        .overlay(RoundedRectangle(cornerRadius: 12, style: .continuous).stroke(OpenDesignDayColor.amberLine, lineWidth: 1))
        .accessibilityIdentifier("day1.situationSummary.readmeUpdate")
    }

    private var nextActions: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("다음 액션")
                .font(.system(size: 11, weight: .bold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.muted)
            FlowChips(items: summary.nextActions.map(\.label))
        }
    }

    private var goalDecision: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text(summary.goalDecision.question)
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fg)
            HStack(spacing: 8) {
                ForEach(summary.goalDecision.options ?? [], id: \.label) { option in
                    Button {
                        onChooseGoal(option.label)
                    } label: {
                        Text(option.label)
                            .font(.system(size: 12, weight: .semibold, design: .rounded))
                            .foregroundStyle(OpenDesignDayColor.accentStrong)
                            .padding(.horizontal, 12)
                            .padding(.vertical, 7)
                            .background(Capsule().fill(OpenDesignDayColor.accentDim))
                            .overlay(Capsule().stroke(OpenDesignDayColor.accentLine, lineWidth: 1))
                    }
                    .buttonStyle(.plain)
                    .accessibilityIdentifier("day1.situationSummary.goalOption")
                }
            }
        }
        .accessibilityElement(children: .contain)
        .accessibilityIdentifier("day1.situationSummary.goalDecision")
    }
}

/// Minimal stacked chip list (no external dependency).
private struct FlowChips: View {
    let items: [String]

    var body: some View {
        VStack(alignment: .leading, spacing: 6) {
            ForEach(items, id: \.self) { item in
                Text(item)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .padding(.horizontal, 10)
                    .padding(.vertical, 5)
                    .background(Capsule().fill(OpenDesignDayColor.surface2))
                    .overlay(Capsule().stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
            }
        }
    }
}

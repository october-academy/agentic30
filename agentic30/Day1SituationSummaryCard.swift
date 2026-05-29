import SwiftUI

/// Day-1 "project situation" card. Version 3 renders evidence-ranked project
/// summary, diagnosis, optional reality gap, 30-day baseline, path signals,
/// and action buttons. Tapping an action calls `onChooseGoal`; tapping next
/// calls `onContinue` without starting or submitting the Day-1 mission.
///
/// Colors use the theme-aware `OpenDesignDayColor` palette so the card stays
/// legible in both the white and dark Open Design Day themes. Shown only when a
/// `day1SituationSummary` is present, so existing Day-1 screenshots stay
/// pixel-stable when it is absent.
struct Day1SituationSummaryCard: View {
    let summary: Day1SituationSummary
    var onChooseGoal: (String) -> Void = { _ in }
    var onContinue: () -> Void = {}

    var body: some View {
        VStack(alignment: .leading, spacing: 14) {
            header
            v3Content
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

    private var v3Content: some View {
        VStack(alignment: .leading, spacing: 12) {
            VStack(alignment: .leading, spacing: 4) {
                sectionLabel("지금 이 프로젝트는")
                Text(summary.project.oneLine)
                    .font(.system(size: 14, weight: .semibold, design: .rounded))
                    .foregroundStyle(OpenDesignDayColor.fg)
                    .fixedSize(horizontal: false, vertical: true)
            }

            insightRow(
                label: "가장 막힌 곳",
                value: summary.diagnosis.bottleneck,
                detail: summary.diagnosis.whyNow
            )

            if let gap = summary.realityGap {
                realityGapRow(gap)
            }

            baselineSection(summary.baseline)

            if !summary.path.isEmpty {
                pathSection(summary.path)
            } else if summary.diagnosis.missingSignal.contains("경로") {
                pathGapSection
            }

            if !actionOptions.isEmpty {
                actionButtons
            }

            nextButton
        }
    }

    private func sectionLabel(_ text: String) -> some View {
        Text(text)
            .font(.system(size: 11, weight: .bold, design: .rounded))
            .foregroundStyle(OpenDesignDayColor.accentStrong)
    }

    private func insightRow(label: String, value: String, detail: String) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionLabel(label)
            Text(value)
                .font(.system(size: 13, weight: .bold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fg)
                .fixedSize(horizontal: false, vertical: true)
            Text(detail)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func realityGapRow(_ gap: Day1SituationSummary.RealityGap) -> some View {
        let shape = RoundedRectangle(cornerRadius: 12, style: .continuous)

        return VStack(alignment: .leading, spacing: 8) {
            HStack(spacing: 6) {
                Image(systemName: "doc.text.magnifyingglass")
                    .font(.system(size: 10, weight: .semibold))
                    .foregroundStyle(OpenDesignDayColor.amber)
                Text("판단 전 확인할 차이")
                    .font(.system(size: 11, weight: .bold, design: .rounded))
                    .foregroundStyle(OpenDesignDayColor.fg)
            }

            VStack(alignment: .leading, spacing: 6) {
                evidenceLine(
                    label: "문서",
                    value: gap.docClaim,
                    labelColor: OpenDesignDayColor.muted,
                    labelFill: OpenDesignDayColor.bgDarker,
                    labelStroke: OpenDesignDayColor.borderSoft
                )
                evidenceLine(
                    label: "최근 근거",
                    value: gap.observedReality,
                    labelColor: OpenDesignDayColor.amber,
                    labelFill: OpenDesignDayColor.amberDim,
                    labelStroke: OpenDesignDayColor.amberLine.opacity(0.7)
                )
            }

            Text(gap.recommendation)
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
        .padding(.leading, 14)
        .padding(.trailing, 10)
        .padding(.vertical, 10)
        .frame(maxWidth: .infinity, alignment: .leading)
        .background(
            shape.fill(
                LinearGradient(
                    colors: [OpenDesignDayColor.surface, OpenDesignDayColor.surface2],
                    startPoint: .top,
                    endPoint: .bottom
                )
            )
        )
        .overlay(shape.stroke(OpenDesignDayColor.borderSoft, lineWidth: 1))
        .overlay(alignment: .leading) {
            Rectangle()
                .fill(OpenDesignDayColor.amber.opacity(0.76))
                .frame(width: 3)
        }
        .clipShape(shape)
        .accessibilityIdentifier("day1.situationSummary.realityGap")
    }

    private func evidenceLine(
        label: String,
        value: String,
        labelColor: Color,
        labelFill: Color,
        labelStroke: Color
    ) -> some View {
        HStack(alignment: .firstTextBaseline, spacing: 8) {
            Text(label)
                .font(.system(size: 10, weight: .bold, design: .rounded))
                .foregroundStyle(labelColor)
                .lineLimit(1)
                .padding(.horizontal, 6)
                .frame(height: 18)
                .background(Capsule().fill(labelFill))
                .overlay(Capsule().stroke(labelStroke, lineWidth: 1))
            Text(value)
                .font(.system(size: 11.5, weight: .medium, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .lineSpacing(2)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func baselineSection(_ baseline: Day1SituationSummary.Baseline) -> some View {
        VStack(alignment: .leading, spacing: 4) {
            sectionLabel("30일 성공 기준")
            Text(baseline.day30Question)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private func pathSection(_ nodes: [Day1SituationSummary.PathNode]) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("검증 경로")
            Text(nodes.prefix(6).map(\.label).joined(separator: " → "))
                .font(.system(size: 12, weight: .semibold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var pathGapSection: some View {
        VStack(alignment: .leading, spacing: 6) {
            sectionLabel("고객 접점")
            Text(pathGapText)
                .font(.system(size: 12, weight: .medium, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .fixedSize(horizontal: false, vertical: true)
        }
    }

    private var actionOptions: [Day1SituationSummary.Action] {
        summary.actions
    }

    private var pathGapText: String {
        if let touchpoint = actionOptions.first(where: { $0.kind == "channel_gap" })?.label {
            let customer = touchpoint.replacingOccurrences(of: " 접점", with: "")
            if !customer.isEmpty {
                return "아직 확인된 접점이 없습니다. 오늘은 \(customer)를 만날 실제 장소부터 정해야 합니다."
            }
        }
        return "아직 확인된 접점이 없습니다. 오늘은 고객을 만날 실제 장소부터 정해야 합니다."
    }

    private var actionButtons: some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("오늘 남길 근거")
                .font(.system(size: 13, weight: .semibold, design: .rounded))
                .foregroundStyle(OpenDesignDayColor.fg)
            if let primaryAction = actionOptions.first {
                Text(primaryAction.rationale)
                    .font(.system(size: 12, weight: .medium, design: .rounded))
                    .foregroundStyle(OpenDesignDayColor.fgSecondary)
                    .fixedSize(horizontal: false, vertical: true)
            }
            HStack(spacing: 8) {
                ForEach(actionOptions) { action in
                    Button {
                        onChooseGoal(action.label)
                    } label: {
                        Text(action.label)
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
        .accessibilityIdentifier("day1.situationSummary.actions")
    }

    private var nextButton: some View {
        HStack {
            Spacer(minLength: 0)
            Button(action: onContinue) {
                HStack(spacing: 7) {
                    Text("다음")
                        .font(.system(size: 12, weight: .semibold, design: .rounded))
                    Image(systemName: "chevron.right")
                        .font(.system(size: 11, weight: .semibold))
                }
                .foregroundStyle(OpenDesignDayColor.fgSecondary)
                .padding(.horizontal, 12)
                .frame(height: 30)
                .background(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .fill(OpenDesignDayColor.surface2)
                )
                .overlay(
                    RoundedRectangle(cornerRadius: 8, style: .continuous)
                        .stroke(OpenDesignDayColor.borderSoft, lineWidth: 1)
                )
            }
            .buttonStyle(.plain)
            .accessibilityLabel("다음")
            .accessibilityIdentifier("day1.situationSummary.next")
        }
    }
}

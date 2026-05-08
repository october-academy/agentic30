import SwiftUI

// Settings > 정직 모드 복구. Lists Day-30 schema-invalid rubric records that
// the sidecar quarantined, explains why each was rejected, surfaces an
// auto-suggest proposal when one is available, and lets the user submit a
// one-line fix that re-imports the record into the canonical store.

struct RubricQuarantineView: View {
    @ObservedObject var viewModel: AgenticViewModel
    @State private var selectedEntryID: String?
    @State private var honestModeInput: String = ""
    @State private var isRestoring = false
    @State private var lastResultMessage: String?

    var body: some View {
        VStack(alignment: .leading, spacing: 0) {
            header
            Divider()
            content
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity, alignment: .topLeading)
        .background(Color(red: 0.10, green: 0.12, blue: 0.10))
        .onAppear { viewModel.requestQuarantineList() }
    }

    private var header: some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("정직 모드 복구")
                .font(.title3.weight(.semibold))
                .foregroundStyle(.white)
            Text("Day 30 결산 schema가 거부한 record를 한 줄 fix로 다시 들이는 곳입니다. 점수가 낮은 게 아니라, 왜 낮은지를 모르는 게 위험합니다.")
                .font(.callout)
                .foregroundStyle(.white.opacity(0.7))
                .fixedSize(horizontal: false, vertical: true)
            HStack(spacing: 12) {
                Button {
                    viewModel.requestQuarantineList()
                } label: {
                    Label("새로고침", systemImage: "arrow.clockwise")
                }
                .accessibilityIdentifier("quarantine-refresh")
                if let message = lastResultMessage {
                    Text(message)
                        .font(.footnote)
                        .foregroundStyle(.green)
                        .accessibilityIdentifier("quarantine-toast")
                }
            }
        }
        .padding(16)
    }

    @ViewBuilder
    private var content: some View {
        if viewModel.quarantineFiles.isEmpty {
            emptyState
        } else {
            HSplitView {
                listColumn
                    .frame(minWidth: 240)
                detailColumn
                    .frame(minWidth: 360)
            }
        }
    }

    private var emptyState: some View {
        VStack(spacing: 8) {
            Image(systemName: "checkmark.seal")
                .font(.system(size: 28))
                .foregroundStyle(.green)
            Text("복구할 record가 없습니다.")
                .foregroundStyle(.white)
            Text("Day 30 schema가 거부한 record가 생기면 여기로 옵니다.")
                .font(.footnote)
                .foregroundStyle(.white.opacity(0.6))
        }
        .frame(maxWidth: .infinity, maxHeight: .infinity)
    }

    private var listColumn: some View {
        ScrollView {
            VStack(alignment: .leading, spacing: 8) {
                ForEach(viewModel.quarantineFiles) { fileWithDump in
                    fileGroup(fileWithDump)
                }
            }
            .padding(12)
        }
        .background(Color(red: 0.12, green: 0.14, blue: 0.12))
    }

    private func fileGroup(_ bundle: QuarantineFileWithDump) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text(bundle.dump.quarantinedAt ?? bundle.file.name)
                .font(.caption.monospaced())
                .foregroundStyle(.white.opacity(0.55))
            ForEach(bundle.dump.records) { entry in
                let entryID = "\(bundle.file.id)#\(entry.index)"
                Button {
                    selectedEntryID = entryID
                    honestModeInput = ""
                    lastResultMessage = nil
                } label: {
                    entryRow(entry, isSelected: selectedEntryID == entryID)
                }
                .buttonStyle(.plain)
                .accessibilityIdentifier("quarantine-entry-\(entry.index)")
            }
        }
    }

    private func entryRow(_ entry: QuarantineEntry, isSelected: Bool) -> some View {
        HStack(alignment: .top, spacing: 8) {
            VStack(alignment: .leading, spacing: 2) {
                Text(entry.originalSummary ?? "Day-30 record #\(entry.index)")
                    .font(.callout)
                    .foregroundStyle(.white)
                Text("\(entry.issues.count)개 schema issue")
                    .font(.caption2)
                    .foregroundStyle(.orange)
            }
            Spacer()
        }
        .padding(8)
        .background(isSelected ? Color.white.opacity(0.08) : Color.clear)
        .clipShape(RoundedRectangle(cornerRadius: 6))
    }

    @ViewBuilder
    private var detailColumn: some View {
        if let bundle = currentBundle, let entry = currentEntry {
            ScrollView {
                VStack(alignment: .leading, spacing: 16) {
                    explainSection(entry)
                    proposeSection(entry)
                    fixSection(bundle, entry)
                }
                .padding(16)
            }
        } else {
            VStack {
                Text("좌측에서 record를 선택하세요.")
                    .foregroundStyle(.white.opacity(0.6))
            }
            .frame(maxWidth: .infinity, maxHeight: .infinity)
        }
    }

    private func explainSection(_ entry: QuarantineEntry) -> some View {
        VStack(alignment: .leading, spacing: 6) {
            Text("Explain — 왜 거부됐나")
                .font(.headline)
                .foregroundStyle(.white)
            ForEach(entry.issues, id: \.self) { issue in
                HStack(alignment: .top, spacing: 6) {
                    Text("•")
                        .foregroundStyle(.orange)
                    VStack(alignment: .leading, spacing: 2) {
                        Text(issue.displayPath)
                            .font(.caption.monospaced())
                            .foregroundStyle(.orange)
                        Text(issue.message)
                            .font(.callout)
                            .foregroundStyle(.white.opacity(0.85))
                    }
                }
            }
        }
    }

    @ViewBuilder
    private func proposeSection(_ entry: QuarantineEntry) -> some View {
        if let proposal = entry.proposal {
            VStack(alignment: .leading, spacing: 6) {
                Text("Propose — 가장 흔한 fix")
                    .font(.headline)
                    .foregroundStyle(.white)
                Text(proposal.suggestion)
                    .font(.callout)
                    .foregroundStyle(.white.opacity(0.85))
                    .fixedSize(horizontal: false, vertical: true)
            }
        }
    }

    private func fixSection(_ bundle: QuarantineFileWithDump, _ entry: QuarantineEntry) -> some View {
        VStack(alignment: .leading, spacing: 8) {
            Text("Fix — 한 줄 입력")
                .font(.headline)
                .foregroundStyle(.white)
            TextField("정직 모드 한 줄 (예: 이번 주 수요 검증 안 한 상태)", text: $honestModeInput)
                .textFieldStyle(.roundedBorder)
                .accessibilityIdentifier("honest-mode-input")
            Button {
                Task { await submitFix(bundle: bundle, entry: entry) }
            } label: {
                Label(isRestoring ? "복구 중…" : "Restore", systemImage: "tray.and.arrow.up")
            }
            .disabled(isRestoring || honestModeInput.trimmingCharacters(in: .whitespaces).isEmpty)
            .accessibilityIdentifier("quarantine-restore-button")
        }
    }

    private func submitFix(bundle: QuarantineFileWithDump, entry: QuarantineEntry) async {
        isRestoring = true
        defer { isRestoring = false }
        let trimmed = honestModeInput.trimmingCharacters(in: .whitespaces)
        guard !trimmed.isEmpty else { return }
        await viewModel.restoreQuarantinedRecord(
            bundle: bundle,
            entry: entry,
            honestModeReason: trimmed
        )
        lastResultMessage = "Restored"
        honestModeInput = ""
    }

    private var currentBundle: QuarantineFileWithDump? {
        guard let id = selectedEntryID else { return nil }
        let parts = id.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
        guard let filePath = parts.first.map(String.init) else { return nil }
        return viewModel.quarantineFiles.first(where: { $0.file.path == filePath })
    }

    private var currentEntry: QuarantineEntry? {
        guard let id = selectedEntryID else { return nil }
        let parts = id.split(separator: "#", maxSplits: 1, omittingEmptySubsequences: false)
        guard parts.count == 2, let index = Int(parts[1]) else { return nil }
        return currentBundle?.dump.records.first(where: { $0.index == index })
    }
}

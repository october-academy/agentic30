import Foundation

// Codable models that mirror sidecar/quarantine-recovery.mjs output. Kept
// minimal — anything the UI doesn't need stays out of the model so a sidecar
// schema bump only ripples here when the surface actually changes.

struct QuarantineFile: Codable, Identifiable, Hashable {
    let path: String
    let name: String
    let size: Int
    let mtimeMs: Double

    var id: String { path }
}

struct QuarantineDump: Codable, Hashable {
    let sourceFile: String?
    let quarantinedAt: String?
    let mtimeMs: Double
    let records: [QuarantineEntry]
}

struct QuarantineEntry: Codable, Identifiable, Hashable {
    let index: Int
    let issues: [QuarantineIssue]
    let proposal: QuarantineProposal?
    // We do not decode `original` strongly — it's an arbitrary user-shaped
    // JSON object. The UI only needs to display a label/summary, so we keep
    // a separately-decoded summary string.
    let originalSummary: String?

    var id: Int { index }
}

struct QuarantineIssue: Codable, Hashable {
    let path: [String]
    let message: String

    var displayPath: String {
        path.isEmpty ? "<root>" : path.joined(separator: ".")
    }
}

struct QuarantineProposal: Codable, Hashable {
    let kind: String
    let axis: String?
    let suggestion: String
}

// Bundle of file + decoded dump. The view binds to the array of these to
// drive list/detail layout. Codable so the sidecar wire payload
// `{ file, dump }` decodes directly via the SidecarEvent envelope.
struct QuarantineFileWithDump: Codable, Identifiable, Hashable {
    let file: QuarantineFile
    let dump: QuarantineDump

    var id: String { file.id }
}

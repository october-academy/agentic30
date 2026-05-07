import Foundation

enum BipCoachConstants {
    static let templateDocId = "1EoQIaByJd5Aq8ENbgEfxHKKJsZsup7d5gJxcT7uqNeA"
    static let templateSheetId = "16NkGIe8K9NZiLy4O81zyXKVeQ72nvBGSZ0YBQaBr0sA"

    static var templateDocCopyURL: URL {
        URL(string: "https://docs.google.com/document/d/\(templateDocId)/copy?title=Agentic30%20%EC%97%85%EB%AC%B4%EC%9D%BC%EC%A7%80")!
    }
    static var templateSheetCopyURL: URL {
        URL(string: "https://docs.google.com/spreadsheets/d/\(templateSheetId)/copy?title=Agentic30%20%EA%B2%8C%EC%8B%9C%EA%B8%80%20%EC%9D%BC%EC%A7%80")!
    }

    /// Manual install guide for users who don't want npm global install
    static let gwsManualInstallGuideURL = URL(string: "https://github.com/googleworkspace/cli#installation")!
}

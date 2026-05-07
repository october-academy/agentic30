import Foundation

nonisolated struct WolfStateSequencePackage {
    static let supportedFormat = "state-sequences-v1"
    static let requiredFramesPerState = 60

    struct Manifest: Decodable, Equatable {
        let format: String
        let framesPerState: Int
        let stateSequencesPath: String
        let states: [String]
    }

    let rootURL: URL
    let manifest: Manifest

    nonisolated static func defaultRootURL(
        homeDirectory: URL = FileManager.default.homeDirectoryForCurrentUser
    ) -> URL {
        homeDirectory
            .appendingPathComponent(".codex", isDirectory: true)
            .appendingPathComponent("pets", isDirectory: true)
            .appendingPathComponent("wolf-state-sequences", isDirectory: true)
    }

    nonisolated static func loadDefault(fileManager: FileManager = .default) -> WolfStateSequencePackage? {
        load(from: defaultRootURL(), fileManager: fileManager)
    }

    nonisolated static func load(
        from rootURL: URL,
        fileManager: FileManager = .default
    ) -> WolfStateSequencePackage? {
        let manifestURL = rootURL.appendingPathComponent("pet.json", isDirectory: false)
        guard fileManager.fileExists(atPath: manifestURL.path),
              let data = try? Data(contentsOf: manifestURL),
              let manifest = try? JSONDecoder().decode(Manifest.self, from: data),
              manifest.format == supportedFormat,
              manifest.framesPerState == requiredFramesPerState,
              !manifest.stateSequencesPath.isEmpty,
              !manifest.states.isEmpty
        else {
            return nil
        }

        return WolfStateSequencePackage(rootURL: rootURL, manifest: manifest)
    }

    nonisolated func frameURLs(
        for state: WolfState,
        fileManager: FileManager = .default
    ) -> [URL]? {
        frameURLs(forPackageState: state.stateSequencePackageState, fileManager: fileManager)
    }

    nonisolated func frameURLs(
        forPackageState packageState: String,
        fileManager: FileManager = .default
    ) -> [URL]? {
        guard Set(manifest.states).contains(packageState) else { return nil }

        let stateDirectory = rootURL
            .appendingPathComponent(manifest.stateSequencesPath, isDirectory: true)
            .appendingPathComponent(packageState, isDirectory: true)

        var frameURLs: [URL] = []
        frameURLs.reserveCapacity(Self.requiredFramesPerState)

        for index in 0..<Self.requiredFramesPerState {
            let frameURL = stateDirectory.appendingPathComponent(
                String(format: "%03d.png", index),
                isDirectory: false
            )
            guard fileManager.fileExists(atPath: frameURL.path) else {
                return nil
            }
            frameURLs.append(frameURL)
        }

        return frameURLs
    }
}

extension WolfState {
    nonisolated var stateSequencePackageState: String {
        switch self {
        case .idle:
            return "idle"
        case .sleeping:
            return "waiting"
        case .attention, .notification:
            return "waving"
        case .happy:
            return "jumping"
        case .thinking, .typing, .juggling, .conducting:
            return "review"
        case .working, .carrying, .sweeping:
            return "running"
        case .error:
            return "failed"
        }
    }
}

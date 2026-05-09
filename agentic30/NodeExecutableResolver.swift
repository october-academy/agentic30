import Foundation

struct NodeExecutableResolver {
    typealias ExecutableCheck = (String) -> Bool
    typealias DirectoryContentsProvider = (URL) throws -> [URL]
    typealias ShellLookup = () -> String?

    let environment: [String: String]
    let homeDirectory: String
    let shellLookup: ShellLookup
    let isExecutable: ExecutableCheck
    let directoryContentsProvider: DirectoryContentsProvider
    let bundledNodeCandidates: () -> [String]

    init(
        environment: [String: String],
        homeDirectory: String,
        shellLookup: @escaping ShellLookup,
        isExecutable: @escaping ExecutableCheck,
        directoryContentsProvider: @escaping DirectoryContentsProvider,
        bundledNodeCandidates: @escaping () -> [String] = { [] }
    ) {
        self.environment = environment
        self.homeDirectory = homeDirectory
        self.shellLookup = shellLookup
        self.isExecutable = isExecutable
        self.directoryContentsProvider = directoryContentsProvider
        self.bundledNodeCandidates = bundledNodeCandidates
    }

    func resolve() throws -> URL {
        for candidate in candidates() {
            guard isExecutable(candidate) else { continue }
            return URL(fileURLWithPath: candidate)
        }

        throw NSError(
            domain: "NodeExecutableResolver",
            code: 1,
            userInfo: [NSLocalizedDescriptionKey: "Could not find a usable node executable."]
        )
    }

    func makeEnvironment(nodeURL: URL) -> [String: String] {
        var resolvedEnvironment = environment
        let nodeDirectory = nodeURL.deletingLastPathComponent().path
        let existingPath = resolvedEnvironment["PATH"] ?? "/usr/bin:/bin:/usr/sbin:/sbin"
        if !existingPath.split(separator: ":").contains(Substring(nodeDirectory)) {
            resolvedEnvironment["PATH"] = "\(nodeDirectory):\(existingPath)"
        }
        return resolvedEnvironment
    }

    func locateMiseNode() -> String? {
        let installsURL = URL(fileURLWithPath: "\(homeDirectory)/.local/share/mise/installs/node")
        guard let directories = try? directoryContentsProvider(installsURL) else {
            return nil
        }

        let candidates = directories
            .sorted(by: {
                $0.lastPathComponent.compare(
                    $1.lastPathComponent,
                    options: .numeric
                ) == .orderedDescending
            })
            .map { $0.appendingPathComponent("bin/node").path }

        return candidates.first(where: isExecutable)
    }

    private func candidates() -> [String] {
        bundledNodeCandidates() + [
            environment["NODE_BINARY"],
            shellLookup(),
            locateMiseNode(),
            "/opt/homebrew/bin/node",
            "/usr/local/bin/node",
            "\(homeDirectory)/.local/bin/node",
            "\(homeDirectory)/.volta/bin/node",
            "\(homeDirectory)/.asdf/shims/node",
            "\(homeDirectory)/.local/share/mise/shims/node",
            "\(homeDirectory)/.local/share/mise/installs/node/latest/bin/node",
            "\(homeDirectory)/.local/share/mise/installs/node/lts/bin/node",
        ]
        .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
        .filter { !$0.isEmpty }
    }
}

extension NodeExecutableResolver {
    static func live() -> NodeExecutableResolver {
        NodeExecutableResolver(
            environment: ProcessInfo.processInfo.environment,
            homeDirectory: NSHomeDirectory(),
            shellLookup: {
                let process = Process()
                let output = Pipe()

                process.executableURL = URL(fileURLWithPath: "/bin/zsh")
                process.arguments = ["-lc", "command -v node"]
                process.standardOutput = output
                process.standardError = Pipe()

                do {
                    try process.run()
                    process.waitUntilExit()
                    guard process.terminationStatus == 0 else { return nil }

                    let data = output.fileHandleForReading.readDataToEndOfFile()
                    guard let path = String(data: data, encoding: .utf8)?
                        .trimmingCharacters(in: .whitespacesAndNewlines),
                          !path.isEmpty else {
                        return nil
                    }
                    return path
                } catch {
                    return nil
                }
            },
            isExecutable: { FileManager.default.isExecutableFile(atPath: $0) },
            directoryContentsProvider: { url in
                try FileManager.default.contentsOfDirectory(
                    at: url,
                    includingPropertiesForKeys: [.isDirectoryKey],
                    options: [.skipsHiddenFiles]
                )
            },
            bundledNodeCandidates: {
                guard let resourcesURL = Bundle.main.resourceURL else { return [] }
                #if arch(arm64)
                let runtimeArch = "arm64"
                #else
                let runtimeArch = "x64"
                #endif
                return [
                    resourcesURL
                        .appendingPathComponent("sidecar/runtime/node-darwin-\(runtimeArch)/bin/node")
                        .path
                ]
            }
        )
    }
}

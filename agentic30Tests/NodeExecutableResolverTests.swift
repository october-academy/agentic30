import Foundation
import Testing
@testable import agentic30

struct NodeExecutableResolverTests {
    @Test func prefersExplicitNodeBinaryAndPrependsPath() throws {
        let resolver = NodeExecutableResolver(
            environment: [
                "NODE_BINARY": "/custom/node",
                "PATH": "/usr/bin:/bin",
            ],
            homeDirectory: "/Users/tester",
            shellLookup: { "/shell/node" },
            isExecutable: { $0 == "/custom/node" },
            directoryContentsProvider: { _ in [] }
        )

        let nodeURL = try resolver.resolve()
        let environment = resolver.makeEnvironment(nodeURL: nodeURL)

        #expect(nodeURL.path == "/custom/node")
        #expect(environment["PATH"] == "/custom:/usr/bin:/bin")
    }

    @Test func fallsBackToNewestMiseInstall() throws {
        let homeDirectory = "/Users/tester"
        let installsURL = URL(fileURLWithPath: "\(homeDirectory)/.local/share/mise/installs/node")
        let newestNode = "\(homeDirectory)/.local/share/mise/installs/node/24.14.1/bin/node"

        let resolver = NodeExecutableResolver(
            environment: [:],
            homeDirectory: homeDirectory,
            shellLookup: { nil },
            isExecutable: { $0 == newestNode },
            directoryContentsProvider: { url in
                #expect(url == installsURL)
                return [
                    installsURL.appendingPathComponent("22.22.2", isDirectory: true),
                    installsURL.appendingPathComponent("24.14.1", isDirectory: true),
                    installsURL.appendingPathComponent("18.20.0", isDirectory: true),
                ]
            }
        )

        let nodeURL = try resolver.resolve()

        #expect(nodeURL.path == newestNode)
    }

    @Test func picksNewerNodeWhenLexicographicOrderDisagrees() throws {
        let homeDirectory = "/Users/tester"
        let installsURL = URL(fileURLWithPath: "\(homeDirectory)/.local/share/mise/installs/node")
        let newestNode = "\(homeDirectory)/.local/share/mise/installs/node/22.22.2/bin/node"

        let resolver = NodeExecutableResolver(
            environment: [:],
            homeDirectory: homeDirectory,
            shellLookup: { nil },
            isExecutable: { path in
                path == newestNode
                    || path == "\(homeDirectory)/.local/share/mise/installs/node/20.10.0/bin/node"
                    || path == "\(homeDirectory)/.local/share/mise/installs/node/20.9.0/bin/node"
                    || path == "\(homeDirectory)/.local/share/mise/installs/node/9.0.0/bin/node"
            },
            directoryContentsProvider: { _ in
                [
                    installsURL.appendingPathComponent("9.0.0", isDirectory: true),
                    installsURL.appendingPathComponent("20.9.0", isDirectory: true),
                    installsURL.appendingPathComponent("20.10.0", isDirectory: true),
                    installsURL.appendingPathComponent("22.22.2", isDirectory: true),
                ]
            }
        )

        let nodeURL = try resolver.resolve()

        #expect(nodeURL.path == newestNode)
    }

    @Test func throwsWhenNoExecutableExists() {
        let resolver = NodeExecutableResolver(
            environment: [:],
            homeDirectory: "/Users/tester",
            shellLookup: { nil },
            isExecutable: { _ in false },
            directoryContentsProvider: { _ in [] }
        )

        #expect(throws: NSError.self) {
            try resolver.resolve()
        }
    }
}

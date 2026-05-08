import Darwin
import Foundation

final class SidecarBridge {
    var onEvent: ((SidecarEvent) -> Void)?

    private let decoder: JSONDecoder = {
        let decoder = JSONDecoder()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            if let date = formatter.date(from: value) {
                return date
            }
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Invalid ISO8601 date: \(value)"
            )
        }
        return decoder
    }()

    private var process: Process?
    private var webSocket: URLSessionWebSocketTask?
    private var stdoutPipe: Pipe?
    private var stderrPipe: Pipe?
    private var stdoutBuffer = ""
    private var receiveTask: Task<Void, Never>?
    private var intentionalStop = false
    private var didConnect = false
    private var cachedNodeURL: URL?
    private let nodeResolver: NodeExecutableResolver
    private let sidecarScriptURLOverride: URL?
    private var emittedBootFailureReasons = Set<String>()

    init(
        nodeResolver: NodeExecutableResolver = .live(),
        sidecarScriptURL: URL? = nil
    ) {
        self.nodeResolver = nodeResolver
        self.sidecarScriptURLOverride = sidecarScriptURL
    }

    func start() {
        guard process == nil else { return }
        intentionalStop = false
        didConnect = false
        PostHogTelemetry.capture("mac_sidecar_start_requested")

        guard FileManager.default.fileExists(atPath: sidecarScriptURL.path) else {
            captureBootFailure(reason: "missing_script", properties: [
                "sidecar_script_basename": sidecarScriptURL.lastPathComponent,
            ])
            PostHogTelemetry.captureException(
                NSError(domain: "SidecarBridge", code: 404, userInfo: [
                    NSLocalizedDescriptionKey: "Sidecar script not found at \(sidecarScriptURL.path)"
                ]),
                properties: [
                    "component": "sidecar_bridge",
                    "operation": "start",
                ]
            )
            emit(type: "error", message: "Sidecar script not found at \(sidecarScriptURL.path)")
            return
        }

        do {
            let process = Process()
            let stdout = Pipe()
            let stderr = Pipe()
            let nodeURL = try resolveNodeExecutableURL()
            let workspaceURL = WorkspaceSettings.resolvedURL()

            process.executableURL = nodeURL
            process.arguments = [
                sidecarScriptURL.path,
                "--workspace",
                workspaceURL.path,
            ]
            process.currentDirectoryURL = workspaceURL
            process.environment = makeProcessEnvironment(nodeURL: nodeURL)
            process.standardOutput = stdout
            process.standardError = stderr
            process.terminationHandler = { [weak self] terminatedProcess in
                self?.handleTermination(terminatedProcess)
            }
            stdoutPipe = stdout
            stderrPipe = stderr

            stdout.fileHandleForReading.readabilityHandler = { [weak self] handle in
                guard let self else { return }
                let data = handle.availableData
                guard !data.isEmpty, let chunk = String(data: data, encoding: .utf8) else { return }
                self.consumeStdout(chunk)
            }

            stderr.fileHandleForReading.readabilityHandler = { [weak self] handle in
                guard let self else { return }
                let data = handle.availableData
                guard !data.isEmpty, let chunk = String(data: data, encoding: .utf8) else { return }
                self.emit(type: "sidecar_status", message: chunk.trimmingCharacters(in: .whitespacesAndNewlines))
            }

            try process.run()
            self.process = process
            PostHogTelemetry.capture("mac_sidecar_process_started", properties: [
                "workspace_root": workspaceURL.path,
            ])
            emit(type: "sidecar_status", message: "Launching sidecar...")
        } catch {
            clearProcessIO()
            if (error as NSError).domain == "NodeExecutableResolver" {
                captureBootFailure(reason: "missing_node", properties: [
                    "sidecar_script_basename": sidecarScriptURL.lastPathComponent,
                ])
            }
            PostHogTelemetry.captureException(error, properties: [
                "component": "sidecar_bridge",
                "operation": "start",
            ])
            emit(type: "error", message: "Failed to start sidecar: \(error.localizedDescription)")
        }
    }

    func stop() {
        PostHogTelemetry.capture("mac_sidecar_stop_requested")
        intentionalStop = true
        didConnect = false
        receiveTask?.cancel()
        receiveTask = nil
        webSocket?.cancel(with: .normalClosure, reason: nil)
        webSocket = nil

        if let process {
            process.terminationHandler = nil
            terminate(process)
            self.process = nil
        }
        clearProcessIO()
        intentionalStop = false
    }

    func send(payload: [String: Any]) {
        guard let webSocket else {
            PostHogTelemetry.capture("mac_sidecar_send_while_disconnected", properties: [
                "message_type": payload["type"] as? String ?? "unknown",
            ])
            emit(type: "error", message: "Sidecar is not connected.")
            return
        }
        guard JSONSerialization.isValidJSONObject(payload),
              let data = try? JSONSerialization.data(withJSONObject: payload, options: []),
              let text = String(data: data, encoding: .utf8)
        else { return }

        webSocket.send(.string(text)) { [weak self] error in
            if let error {
                PostHogTelemetry.captureException(error, properties: [
                    "component": "sidecar_bridge",
                    "operation": "send",
                    "message_type": payload["type"] as? String ?? "unknown",
                ])
                self?.emit(type: "error", message: "WebSocket send failed: \(error.localizedDescription)")
            }
        }
    }

    private func consumeStdout(_ chunk: String) {
        stdoutBuffer += chunk
        let lines = stdoutBuffer.components(separatedBy: "\n")
        stdoutBuffer = lines.last ?? ""

        for line in lines.dropLast() {
            guard let data = line.data(using: .utf8),
                  let ready = try? JSONSerialization.jsonObject(with: data) as? [String: Any],
                  let type = ready["type"] as? String
            else { continue }

            if type == "sidecar-ready", let port = ready["port"] as? Int {
                connect(to: port)
            }
        }
    }

    private func connect(to port: Int) {
        guard webSocket == nil else { return }
        didConnect = true
        PostHogTelemetry.capture("mac_sidecar_socket_connecting", properties: [
            "port": port,
        ])
        let url = URL(string: "ws://127.0.0.1:\(port)")!
        let task = URLSession.shared.webSocketTask(with: url)
        task.resume()
        webSocket = task
        receiveTask = Task { [weak self] in
            await self?.receiveLoop()
        }
    }

    private func receiveLoop() async {
        guard let webSocket else { return }
        do {
            while !Task.isCancelled {
                let message = try await webSocket.receive()
                switch message {
                case .string(let text):
                    decodeEvent(text)
                case .data(let data):
                    if let text = String(data: data, encoding: .utf8) {
                        decodeEvent(text)
                    }
                @unknown default:
                    break
                }
            }
        } catch {
            PostHogTelemetry.captureException(error, properties: [
                "component": "sidecar_bridge",
                "operation": "receive_loop",
            ])
            emit(type: "error", message: "Sidecar connection closed: \(error.localizedDescription)")
        }
    }

    private func decodeEvent(_ text: String) {
        guard let data = text.data(using: .utf8) else { return }
        do {
            let event = try decoder.decode(SidecarEvent.self, from: data)
            onEvent?(event)
        } catch {
            PostHogTelemetry.captureException(error, properties: [
                "component": "sidecar_bridge",
                "operation": "decode_event",
            ])
            emit(type: "error", message: "Failed to decode sidecar event: \(error.localizedDescription)")
        }
    }

    private func emit(type: String, message: String) {
        let event = SidecarEvent(
            type: type,
            message: message,
            sessionId: nil,
            messageId: nil,
            delta: nil,
            content: nil,
            workspaceRoot: nil,
            session: nil,
            sessions: nil,
            environment: nil,
            diagnostics: nil,
            bipCoach: nil,
            bipSetupReady: nil,
            day: nil,
            firstPrompt: nil,
            missingLocalDocs: nil,
            missingExternalRequirements: nil,
            nextIddDocumentType: nil,
            nextIddDocumentTitle: nil,
            bipSetupGateMessage: nil,
            scanRoot: nil,
            icp: nil,
            spec: nil,
            values: nil,
            designSystem: nil,
            adr: nil,
            goal: nil,
            docs: nil,
            sheet: nil,
            onboardingHypothesis: nil,
            error: nil,
            docType: nil,
            docPath: nil,
            progressText: nil,
            notionConnected: nil,
            success: nil,
            disconnected: nil,
            authUrl: nil,
            rowId: nil,
            status: nil,
            detail: nil,
            log: nil,
            readinessError: nil,
            bipTokenExpiredMessage: nil,
            resourceName: nil,
            resourceUrl: nil,
            stage: nil,
            provider: nil,
            sheetRowsRead: nil,
            docCharsRead: nil,
            elapsedMs: nil,
            phase: nil,
            toolName: nil,
            summary: nil,
            items: nil,
            result: nil,
            weeklyRitualPrompt: nil,
            requestEmit: nil
        )
        onEvent?(event)
    }

    private func handleTermination(_ terminatedProcess: Process) {
        if process === terminatedProcess {
            process = nil
        }
        clearProcessIO()
        receiveTask?.cancel()
        receiveTask = nil
        webSocket = nil

        if intentionalStop {
            intentionalStop = false
            return
        }

        if didConnect {
            didConnect = false
            PostHogTelemetry.capture("mac_sidecar_stopped", properties: [
                "termination_status": terminatedProcess.terminationStatus,
            ])
            emit(type: "sidecar_status", message: "Sidecar stopped")
            return
        }

        let reason = terminatedProcess.terminationReason == .uncaughtSignal ? "signal" : "exit"
        captureBootFailure(reason: "early_process_exit", properties: [
            "termination_reason": reason,
            "termination_status": Int(terminatedProcess.terminationStatus),
        ])
        PostHogTelemetry.captureException(
            NSError(domain: "SidecarBridge", code: Int(terminatedProcess.terminationStatus), userInfo: [
                NSLocalizedDescriptionKey: "Sidecar failed to start (\(reason) \(terminatedProcess.terminationStatus))."
            ]),
            properties: [
                "component": "sidecar_bridge",
                "operation": "termination",
                "termination_reason": reason,
                "termination_status": terminatedProcess.terminationStatus,
            ]
        )
        emit(
            type: "error",
            message: "Sidecar failed to start (\(reason) \(terminatedProcess.terminationStatus)). Check Node.js availability."
        )
    }

    private func captureBootFailure(reason: String, properties: [String: Any] = [:]) {
        guard emittedBootFailureReasons.insert(reason).inserted else { return }
        PostHogTelemetry.capture(
            "sidecar_boot_failed",
            properties: properties.merging([
                "reason": reason,
            ]) { _, new in new }
        )
    }

    private func clearProcessIO() {
        stdoutPipe?.fileHandleForReading.readabilityHandler = nil
        stderrPipe?.fileHandleForReading.readabilityHandler = nil
        stdoutPipe = nil
        stderrPipe = nil
        stdoutBuffer = ""
    }

    private func makeProcessEnvironment(nodeURL: URL) -> [String: String] {
        var environment = nodeResolver.makeEnvironment(nodeURL: nodeURL)
        environment["AGENTIC30_PARENT_PID"] = String(ProcessInfo.processInfo.processIdentifier)

        // Prepend login-shell PATH so gws, npm, mise-managed node etc. are findable.
        // launchd gives apps only /usr/bin:/bin; resolveLoginShellPath() fetches the
        // full user PATH via osascript (cached after first call).
        let loginPath = MacOnboardingConstants.resolveLoginShellPath()
        let existingPath = environment["PATH"] ?? "/usr/bin:/bin"
        if !existingPath.hasPrefix(loginPath) {
            environment["PATH"] = loginPath + ":" + existingPath
        }

        return environment
    }

    private func terminate(_ process: Process) {
        guard process.isRunning else { return }

        process.terminate()
        let deadline = Date().addingTimeInterval(1.5)
        while process.isRunning && Date() < deadline {
            RunLoop.current.run(mode: .default, before: Date().addingTimeInterval(0.05))
        }

        if process.isRunning {
            kill(process.processIdentifier, SIGKILL)
            process.waitUntilExit()
        }
    }

    private func resolveNodeExecutableURL() throws -> URL {
        if let cachedNodeURL, FileManager.default.isExecutableFile(atPath: cachedNodeURL.path) {
            return cachedNodeURL
        }

        let resolved = try nodeResolver.resolve()
        cachedNodeURL = resolved
        return resolved
    }

    private var sidecarScriptURL: URL {
        if let sidecarScriptURLOverride {
            return sidecarScriptURLOverride
        }
        if let bundled = Bundle.main.url(
            forResource: "index",
            withExtension: "mjs",
            subdirectory: "sidecar"
        ) {
            return bundled
        }
        return developmentScriptsRootURL.appendingPathComponent("sidecar/index.mjs")
    }

    // Location where the sidecar `.mjs` sources live in dev builds (before
    // `scripts/build-sidecar.mjs` produces the bundled `sidecar-build/sidecar/`
    // copy used by release builds via the `Copy Sidecar Resources` phase).
    // Release DMG lookups go through `Bundle.main.url(...)` above; this path
    // only serves `xcodebuild` runs launched from the repo.
    private var developmentScriptsRootURL: URL {
        URL(fileURLWithPath: #filePath)
            .deletingLastPathComponent()
            .deletingLastPathComponent()
    }
}

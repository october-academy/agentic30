import Foundation
import SwiftUI
import Combine
import AuthenticationServices
import UserNotifications
import AppKit
import ApplicationServices
import CryptoKit
import AVFoundation
import CoreImage
import IOKit.hid
import Security
#if canImport(Speech)
import Speech
#endif
#if canImport(Vision)
import Vision
#endif
#if canImport(ScreenCaptureKit)
import ScreenCaptureKit
#endif

private protocol RecorderSystemAudioCaptureSession: AnyObject {
    nonisolated func stopAndFinalize() async throws
    nonisolated func cancel()
}

private enum RecorderSystemAudioCaptureError: LocalizedError {
    case unavailable
    case noDisplay
    case streamOutputRejected(String)
    case streamStartFailed(String)
    case streamStopFailed(String)
    case assetWriterInputRejected
    case assetWriterStartFailed(String)
    case assetWriterAppendFailed(String)
    case assetWriterFinishFailed(String)
    case noAudioSamples
    case emptyRecordingFile

    var errorDescription: String? {
        switch self {
        case .unavailable:
            return "ERR_RECORDER_SYSTEM_AUDIO_UNAVAILABLE: ScreenCaptureKit system audio capture is unavailable on this macOS runtime."
        case .noDisplay:
            return "ERR_RECORDER_SYSTEM_AUDIO_NO_DISPLAY: ScreenCaptureKit did not return a display for System Audio capture."
        case .streamOutputRejected(let message):
            return "ERR_RECORDER_SYSTEM_AUDIO_STREAM_OUTPUT_REJECTED: \(message)"
        case .streamStartFailed(let message):
            return "ERR_RECORDER_SYSTEM_AUDIO_STREAM_START_FAILED: \(message)"
        case .streamStopFailed(let message):
            return "ERR_RECORDER_SYSTEM_AUDIO_STREAM_STOP_FAILED: \(message)"
        case .assetWriterInputRejected:
            return "ERR_RECORDER_SYSTEM_AUDIO_WRITER_INPUT_REJECTED: AVAssetWriter rejected the System Audio input."
        case .assetWriterStartFailed(let message):
            return "ERR_RECORDER_SYSTEM_AUDIO_WRITER_START_FAILED: \(message)"
        case .assetWriterAppendFailed(let message):
            return "ERR_RECORDER_SYSTEM_AUDIO_WRITER_APPEND_FAILED: \(message)"
        case .assetWriterFinishFailed(let message):
            return "ERR_RECORDER_SYSTEM_AUDIO_WRITER_FINISH_FAILED: \(message)"
        case .noAudioSamples:
            return "ERR_RECORDER_SYSTEM_AUDIO_NO_SAMPLES: ScreenCaptureKit produced no System Audio samples before the chunk ended."
        case .emptyRecordingFile:
            return "ERR_RECORDER_SYSTEM_AUDIO_EMPTY_MEDIA_FILE: System Audio capture produced an empty audio file."
        }
    }
}

#if canImport(ScreenCaptureKit)
private final class RecorderAssetWriterFinishBox: @unchecked Sendable {
    let writer: AVAssetWriter

    init(_ writer: AVAssetWriter) {
        self.writer = writer
    }
}

private enum RecorderStreamFrameCaptureError: LocalizedError {
    case streamNotConfigured
    case streamStartFailed(String)
    case firstFrameTimeout
    case pixelBufferUnavailable
    case cgImageConversionFailed

    var errorDescription: String? {
        switch self {
        case .streamNotConfigured:
            return "ERR_RECORDER_FRAME_STREAM_NOT_CONFIGURED: ScreenCaptureKit frame stream was not configured before capture."
        case .streamStartFailed(let message):
            return "ERR_RECORDER_FRAME_STREAM_START_FAILED: \(message)"
        case .firstFrameTimeout:
            return "ERR_RECORDER_FRAME_STREAM_FIRST_FRAME_TIMEOUT: ScreenCaptureKit did not produce a frame before the timeout."
        case .pixelBufferUnavailable:
            return "ERR_RECORDER_FRAME_STREAM_PIXEL_BUFFER_UNAVAILABLE: ScreenCaptureKit produced a sample without an image buffer."
        case .cgImageConversionFailed:
            return "ERR_RECORDER_FRAME_STREAM_CGIMAGE_CONVERSION_FAILED: ScreenCaptureKit frame could not be converted to CGImage."
        }
    }
}

private final class RecorderEventTapTrigger: @unchecked Sendable {
    private let lock = NSLock()
    private nonisolated(unsafe) let eventTap: CFMachPort
    private nonisolated(unsafe) let runLoopSource: CFRunLoopSource
    private let callbackBox: RecorderEventTapCallbackBox
    private nonisolated(unsafe) var stopped = false

    init(
        eventTap: CFMachPort,
        runLoopSource: CFRunLoopSource,
        callbackBox: RecorderEventTapCallbackBox
    ) {
        self.eventTap = eventTap
        self.runLoopSource = runLoopSource
        self.callbackBox = callbackBox
    }

    nonisolated func stop() {
        lock.lock()
        guard !stopped else {
            lock.unlock()
            return
        }
        stopped = true
        lock.unlock()
        CGEvent.tapEnable(tap: eventTap, enable: false)
        CFRunLoopRemoveSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CFMachPortInvalidate(eventTap)
    }
}

private final class RecorderEventTapCallbackBox: @unchecked Sendable {
    let onEvent: @Sendable (String) -> Void

    init(onEvent: @escaping @Sendable (String) -> Void) {
        self.onEvent = onEvent
    }
}

private func recorderEventTapKindForCaptureTrigger(_ type: CGEventType) -> String {
    switch type {
    case .keyDown:
        return "keyboard_activity"
    case .leftMouseDown, .rightMouseDown, .otherMouseDown:
        return "pointer_click"
    case .scrollWheel:
        return "scroll_activity"
    default:
        return "input_activity"
    }
}

@available(macOS 14.0, *)
private final class ScreenCaptureKitFrameCaptureSession: NSObject, SCStreamOutput, @unchecked Sendable {
    private let sampleQueue = DispatchQueue(label: "app.agentic30.recorder.frame-stream", qos: .utility)
    private let imageContext = CIContext()
    private let lock = NSLock()
    private nonisolated(unsafe) var stream: SCStream?
    private nonisolated(unsafe) var latestImage: CGImage?
    private nonisolated(unsafe) var pendingContinuation: CheckedContinuation<CGImage, Error>?
    private nonisolated(unsafe) var didStop = false

    static func capture(display: SCDisplay) async throws -> CGImage {
        let session = try await start(display: display)
        defer { session.stop() }
        return try await session.latestFrame(timeout: 5)
    }

    static func start(display: SCDisplay) async throws -> ScreenCaptureKitFrameCaptureSession {
        let session = ScreenCaptureKitFrameCaptureSession()
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = max(Int(display.width), 2)
        configuration.height = max(Int(display.height), 2)
        configuration.showsCursor = true
        configuration.queueDepth = 3
        configuration.minimumFrameInterval = CMTime(value: 1, timescale: 30)
        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        try stream.addStreamOutput(session, type: .screen, sampleHandlerQueue: session.sampleQueue)
        session.setStream(stream)
        do {
            try await startStream(stream)
        } catch {
            try? stream.removeStreamOutput(session, type: .screen)
            session.stop()
            throw RecorderStreamFrameCaptureError.streamStartFailed(error.localizedDescription)
        }
        return session
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .screen, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        guard let pixelBuffer = CMSampleBufferGetImageBuffer(sampleBuffer) else {
            finishPending(.failure(RecorderStreamFrameCaptureError.pixelBufferUnavailable))
            return
        }
        let width = CVPixelBufferGetWidth(pixelBuffer)
        let height = CVPixelBufferGetHeight(pixelBuffer)
        let image = CIImage(cvPixelBuffer: pixelBuffer)
        guard let cgImage = imageContext.createCGImage(
            image,
            from: CGRect(x: 0, y: 0, width: width, height: height)
        ) else {
            finishPending(.failure(RecorderStreamFrameCaptureError.cgImageConversionFailed))
            return
        }
        finishPending(.success(cgImage))
    }

    private nonisolated func setStream(_ stream: SCStream) {
        lock.lock()
        self.stream = stream
        lock.unlock()
    }

    nonisolated func latestFrame(timeout seconds: TimeInterval) async throws -> CGImage {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<CGImage, Error>) in
            lock.lock()
            if didStop || stream == nil {
                lock.unlock()
                continuation.resume(throwing: RecorderStreamFrameCaptureError.streamNotConfigured)
                return
            }
            if let latestImage {
                lock.unlock()
                continuation.resume(returning: latestImage)
                return
            }
            pendingContinuation = continuation
            lock.unlock()
            scheduleTimeout(seconds: seconds)
        }
    }

    nonisolated func stop() {
        let continuationToResume: CheckedContinuation<CGImage, Error>?
        let streamToStop: SCStream?
        lock.lock()
        didStop = true
        continuationToResume = pendingContinuation
        pendingContinuation = nil
        latestImage = nil
        streamToStop = stream
        stream = nil
        lock.unlock()

        streamToStop?.stopCapture { _ in }
        continuationToResume?.resume(throwing: RecorderStreamFrameCaptureError.streamNotConfigured)
    }

    private nonisolated func scheduleTimeout(seconds: TimeInterval) {
        DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + seconds) { [weak self] in
            self?.finishPending(.failure(RecorderStreamFrameCaptureError.firstFrameTimeout))
        }
    }

    private nonisolated func finishPending(_ result: Result<CGImage, Error>) {
        let continuationToResume: CheckedContinuation<CGImage, Error>?
        lock.lock()
        guard !didStop else {
            lock.unlock()
            return
        }
        if case .success(let image) = result {
            latestImage = image
        }
        continuationToResume = pendingContinuation
        pendingContinuation = nil
        lock.unlock()

        switch result {
        case .success(let image):
            continuationToResume?.resume(returning: image)
        case .failure(let error):
            continuationToResume?.resume(throwing: error)
        }
    }

    private nonisolated static func startStream(_ stream: SCStream) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            stream.startCapture { error in
                if let error {
                    continuation.resume(throwing: error)
                } else {
                    continuation.resume()
                }
            }
        }
    }
}

@available(macOS 13.0, *)
private final class ScreenCaptureKitSystemAudioCaptureSession: NSObject, RecorderSystemAudioCaptureSession, SCStreamOutput, @unchecked Sendable {
    private let outputURL: URL
    private let sampleQueue = DispatchQueue(label: "app.agentic30.recorder.system-audio", qos: .utility)
    private let lock = NSLock()
    private nonisolated(unsafe) var stream: SCStream?
    private nonisolated(unsafe) var writer: AVAssetWriter?
    private nonisolated(unsafe) var input: AVAssetWriterInput?
    private nonisolated(unsafe) var sampleCount = 0
    private nonisolated(unsafe) var terminalError: Error?
    private nonisolated(unsafe) var stopping = false

    init(outputURL: URL) {
        self.outputURL = outputURL
        super.init()
    }

    static func start(outputURL: URL) async throws -> ScreenCaptureKitSystemAudioCaptureSession {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw RecorderSystemAudioCaptureError.noDisplay
        }
        let session = ScreenCaptureKitSystemAudioCaptureSession(outputURL: outputURL)
        let filter = SCContentFilter(display: display, excludingWindows: [])
        let configuration = SCStreamConfiguration()
        configuration.width = max(Int(display.width), 2)
        configuration.height = max(Int(display.height), 2)
        configuration.capturesAudio = true
        configuration.sampleRate = 48_000
        configuration.channelCount = 2
        configuration.excludesCurrentProcessAudio = true
        let stream = SCStream(filter: filter, configuration: configuration, delegate: nil)
        do {
            try stream.addStreamOutput(session, type: .audio, sampleHandlerQueue: session.sampleQueue)
        } catch {
            throw RecorderSystemAudioCaptureError.streamOutputRejected(error.localizedDescription)
        }
        do {
            try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
                stream.startCapture { error in
                    if let error {
                        continuation.resume(throwing: RecorderSystemAudioCaptureError.streamStartFailed(error.localizedDescription))
                    } else {
                        continuation.resume()
                    }
                }
            }
        } catch {
            try? stream.removeStreamOutput(session, type: .audio)
            throw error
        }
        session.setStream(stream)
        return session
    }

    func stream(_ stream: SCStream, didOutputSampleBuffer sampleBuffer: CMSampleBuffer, of type: SCStreamOutputType) {
        guard type == .audio, CMSampleBufferDataIsReady(sampleBuffer) else { return }
        lock.lock()
        guard !stopping, terminalError == nil else {
            lock.unlock()
            return
        }
        do {
            if writer == nil || input == nil {
                try prepareWriterLocked(startingAt: CMSampleBufferGetPresentationTimeStamp(sampleBuffer))
            }
            guard let writer, let input else {
                throw RecorderSystemAudioCaptureError.assetWriterStartFailed("AVAssetWriter was not initialized.")
            }
            guard input.isReadyForMoreMediaData else {
                lock.unlock()
                return
            }
            if input.append(sampleBuffer) {
                sampleCount += 1
            } else {
                throw RecorderSystemAudioCaptureError.assetWriterAppendFailed(
                    writer.error?.localizedDescription
                        ?? "AVAssetWriterInput append returned false."
                )
            }
        } catch {
            terminalError = error
        }
        lock.unlock()
    }

    nonisolated func stopAndFinalize() async throws {
        let streamToStop = withLockedState {
            stopping = true
            let streamToStop = stream
            stream = nil
            return streamToStop
        }

        if let streamToStop {
            try await Self.stopStream(streamToStop)
        }

        let finishState = withLockedState {
            let state = (
                writerToFinish: writer,
                inputToFinish: input,
                count: sampleCount,
                error: terminalError
            )
            writer = nil
            input = nil
            return state
        }

        if let error = finishState.error {
            throw error
        }
        guard let writerToFinish = finishState.writerToFinish,
              let inputToFinish = finishState.inputToFinish,
              finishState.count > 0 else {
            throw RecorderSystemAudioCaptureError.noAudioSamples
        }
        inputToFinish.markAsFinished()
        try await Self.finishWriter(writerToFinish)
        let attributes = try FileManager.default.attributesOfItem(atPath: outputURL.path)
        let byteSize = attributes[.size] as? NSNumber
        guard (byteSize?.intValue ?? 0) > 0 else {
            throw RecorderSystemAudioCaptureError.emptyRecordingFile
        }
    }

    nonisolated func cancel() {
        let streamToStop: SCStream?
        let writerToCancel: AVAssetWriter?
        lock.lock()
        stopping = true
        streamToStop = stream
        writerToCancel = writer
        stream = nil
        writer = nil
        input = nil
        lock.unlock()

        writerToCancel?.cancelWriting()
        try? FileManager.default.removeItem(at: outputURL)
        streamToStop?.stopCapture { _ in }
    }

    private func setStream(_ stream: SCStream) {
        lock.lock()
        self.stream = stream
        lock.unlock()
    }

    private nonisolated func withLockedState<T>(_ body: () throws -> T) rethrows -> T {
        lock.lock()
        defer { lock.unlock() }
        return try body()
    }

    private func prepareWriterLocked(startingAt startTime: CMTime) throws {
        let writer = try AVAssetWriter(outputURL: outputURL, fileType: .m4a)
        let input = AVAssetWriterInput(mediaType: .audio, outputSettings: [
            AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
            AVSampleRateKey: 48_000,
            AVNumberOfChannelsKey: 2,
            AVEncoderBitRateKey: 128_000,
        ])
        input.expectsMediaDataInRealTime = true
        guard writer.canAdd(input) else {
            throw RecorderSystemAudioCaptureError.assetWriterInputRejected
        }
        writer.add(input)
        guard writer.startWriting() else {
            throw RecorderSystemAudioCaptureError.assetWriterStartFailed(
                writer.error?.localizedDescription ?? "AVAssetWriter.startWriting returned false."
            )
        }
        writer.startSession(atSourceTime: startTime)
        self.writer = writer
        self.input = input
    }

    private static func stopStream(_ stream: SCStream) async throws {
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            stream.stopCapture { error in
                if let error {
                    continuation.resume(throwing: RecorderSystemAudioCaptureError.streamStopFailed(error.localizedDescription))
                } else {
                    continuation.resume()
                }
            }
        }
    }

    private static func finishWriter(_ writer: AVAssetWriter) async throws {
        let writerBox = RecorderAssetWriterFinishBox(writer)
        try await withCheckedThrowingContinuation { (continuation: CheckedContinuation<Void, Error>) in
            writer.finishWriting {
                switch writerBox.writer.status {
                case .completed:
                    continuation.resume()
                case .failed, .cancelled:
                    continuation.resume(throwing: RecorderSystemAudioCaptureError.assetWriterFinishFailed(
                        writerBox.writer.error?.localizedDescription ?? "AVAssetWriter did not complete."
                    ))
                default:
                    continuation.resume()
                }
            }
        }
    }
}
#endif

typealias WebAuthenticationSessionCompletion = (URL?, Error?) -> Void
typealias WebAuthenticationSessionFactory = (
    URL,
    String,
    ASWebAuthenticationPresentationContextProviding,
    Bool,
    @escaping WebAuthenticationSessionCompletion
) -> WebAuthenticationSessionHandle

protocol WebAuthenticationSessionHandle: AnyObject {
    func start() -> Bool
    func cancel()
}

nonisolated struct GitHubCLIAuthStatus: Hashable, Sendable {
    enum State: String, Hashable, Sendable {
        case unknown
        case checking
        case connected
        case disconnected
        case missing
    }

    let state: State
    let detail: String
    let checkedAt: Date?

    static let unknown = GitHubCLIAuthStatus(
        state: .unknown,
        detail: "gh CLI 상태를 아직 확인하지 않았습니다.",
        checkedAt: nil
    )

    static func checking() -> GitHubCLIAuthStatus {
        GitHubCLIAuthStatus(
            state: .checking,
            detail: "gh auth status 확인 중...",
            checkedAt: Date()
        )
    }
}

final class SystemWebAuthenticationSessionHandle: WebAuthenticationSessionHandle {
    private let session: ASWebAuthenticationSession

    init(
        url: URL,
        callbackURLScheme: String,
        presentationContextProvider: ASWebAuthenticationPresentationContextProviding,
        prefersEphemeral: Bool,
        completion: @escaping WebAuthenticationSessionCompletion
    ) {
        session = ASWebAuthenticationSession(
            url: url,
            callbackURLScheme: callbackURLScheme,
            completionHandler: completion
        )
        session.presentationContextProvider = presentationContextProvider
        session.prefersEphemeralWebBrowserSession = prefersEphemeral
    }

    func start() -> Bool {
        session.start()
    }

    func cancel() {
        session.cancel()
    }
}

enum LegacyBipDailyNotificationCleanup {
    private static let identifiers = [
        "agentic30.bip-coach.morning",
        "agentic30.bip-coach.evening",
    ]

    static func removeScheduledNotifications(center: UNUserNotificationCenter = .current()) {
        center.removePendingNotificationRequests(withIdentifiers: identifiers)
        center.removeDeliveredNotifications(withIdentifiers: identifiers)
    }
}

/// Routing payload for the "office-hours question ready" local notification.
/// Identifier carries the structured-prompt requestId; userInfo carries the
/// session to reselect when the user clicks the banner.
struct OfficeHoursQuestionReadyNotification: Hashable, Sendable {
    static let sessionIdUserInfoKey = "agentic30.officeHours.questionReady.sessionId"
    static let requestIdUserInfoKey = "agentic30.officeHours.questionReady.requestId"
    static let identifierPrefix = "agentic30.office-hours.question-ready."

    let sessionId: String
    let requestId: String?

    init(sessionId: String, requestId: String? = nil) {
        self.sessionId = sessionId
        self.requestId = requestId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
    }

    init?(notificationUserInfo userInfo: [AnyHashable: Any], identifier: String) {
        guard identifier.hasPrefix(Self.identifierPrefix),
              let sessionId = (userInfo[Self.sessionIdUserInfoKey] as? String)?
                  .trimmingCharacters(in: .whitespacesAndNewlines)
                  .nonEmpty else {
            return nil
        }
        self.sessionId = sessionId
        self.requestId = (userInfo[Self.requestIdUserInfoKey] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty
            ?? Self.requestId(fromIdentifier: identifier)
    }

    static func notificationIdentifier(requestId: String) -> String {
        "\(identifierPrefix)\(requestId)"
    }

    static func requestId(fromIdentifier identifier: String) -> String? {
        guard identifier.hasPrefix(identifierPrefix) else { return nil }
        return String(identifier.dropFirst(identifierPrefix.count))
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty
    }

    static func notificationTitle(from sidecarTitle: String?) -> String {
        isFirstQuestionTitle(sidecarTitle) ? "첫 질문 준비 완료" : "다음 질문 준비 완료"
    }

    static func notificationBody(from sidecarTitle: String?) -> String {
        isFirstQuestionTitle(sidecarTitle)
            ? "열어서 첫 질문에 답하고 Office Hours를 시작하세요."
            : "열어서 다음 질문에 답하고 Office Hours를 이어가세요."
    }

    private static func isFirstQuestionTitle(_ title: String?) -> Bool {
        title?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .contains("첫 질문") == true
    }

    var appRoute: AgenticAppRoute {
        AgenticAppRoute(
            destination: .officeHoursQuestion(sessionId: sessionId, requestId: requestId),
            telemetrySource: "office_hours_question_notification"
        )
    }

    var userInfo: [AnyHashable: Any] {
        var info: [AnyHashable: Any] = [
            Self.sessionIdUserInfoKey: sessionId,
        ]
        if let requestId {
            info[Self.requestIdUserInfoKey] = requestId
        }
        info.merge(AgenticAppRoute.routeURLUserInfo(appRoute)) { _, latest in latest }
        return info
    }

    static func removeDelivered(center: UNUserNotificationCenter = .current()) {
        let prefix = identifierPrefix
        center.getDeliveredNotifications { delivered in
            let identifiers = delivered
                .map(\.request.identifier)
                .filter { $0.hasPrefix(prefix) }
            guard !identifiers.isEmpty else { return }
            center.removeDeliveredNotifications(withIdentifiers: identifiers)
        }
    }
}

/// Pure decision authority for posting the question-ready notification, kept
/// free of UNUserNotificationCenter so the gate matrix is unit-testable.
enum OfficeHoursQuestionReadyNotifier {
    static func shouldNotify(
        stage: String,
        requestId: String?,
        title: String?,
        alreadyNotifiedRequestIds: Set<String>,
        isAppActive: Bool,
        isEnabled: Bool,
        isUITesting: Bool
    ) -> Bool {
        guard stage == "question_ready",
              let requestId, !requestId.isEmpty,
              let title, !title.isEmpty,
              !alreadyNotifiedRequestIds.contains(requestId),
              !isAppActive,
              isEnabled,
              !isUITesting else {
            return false
        }
        return true
    }
}

/// Routing payload for the Settings > 연동 MCP connection-complete notification.
/// The banner is informational; clicking it brings the user back to Settings.
struct McpOauthConnectedNotification: Hashable, Sendable {
    static let serverUserInfoKey = "agentic30.mcpOauth.connected.server"
    static let identifierPrefix = "agentic30.mcp-oauth.connected."
    static let supportedServers: Set<String> = ["posthog", "cloudflare"]

    let server: String

    init?(server: String?) {
        guard let normalized = Self.normalizedServer(server),
              Self.supportedServers.contains(normalized) else {
            return nil
        }
        self.server = normalized
    }

    init?(notificationUserInfo userInfo: [AnyHashable: Any], identifier: String) {
        guard identifier.hasPrefix(Self.identifierPrefix) else { return nil }
        let rawServer = (userInfo[Self.serverUserInfoKey] as? String)
            ?? String(identifier.dropFirst(Self.identifierPrefix.count))
        self.init(server: rawServer)
    }

    static func notificationIdentifier(server: String) -> String {
        "\(identifierPrefix)\(normalizedServer(server) ?? server)"
    }

    static func displayName(for server: String) -> String {
        switch normalizedServer(server) {
        case "posthog":
            return "PostHog"
        case "cloudflare":
            return "Cloudflare"
        default:
            return server
        }
    }

    static func normalizedServer(_ server: String?) -> String? {
        server?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .nonEmpty
    }

    var notificationIdentifier: String {
        Self.notificationIdentifier(server: server)
    }

    var notificationTitle: String {
        "\(Self.displayName(for: server)) 연동 완료"
    }

    var notificationBody: String {
        switch Self.normalizedServer(server) {
        case "posthog":
            return "다음 브리핑에서 제품 지표를 함께 볼 수 있어요."
        case "cloudflare":
            return "다음 브리핑에서 트래픽 신호를 함께 볼 수 있어요."
        default:
            return "다음 브리핑에서 새 연동 신호를 함께 볼 수 있어요."
        }
    }

    var appRoute: AgenticAppRoute {
        AgenticAppRoute(
            destination: .settings(section: .integrations),
            telemetrySource: "mcp_oauth_connected_notification"
        )
    }

    var userInfo: [AnyHashable: Any] {
        var info: [AnyHashable: Any] = [
            Self.serverUserInfoKey: server,
        ]
        info.merge(AgenticAppRoute.routeURLUserInfo(appRoute)) { _, latest in latest }
        return info
    }
}

enum McpOauthConnectedNotifier {
    static func shouldNotify(
        server: String?,
        state: String?,
        isUITesting: Bool
    ) -> Bool {
        guard !isUITesting,
              state == "ready",
              McpOauthConnectedNotification(server: server) != nil else {
            return false
        }
        return true
    }
}

struct ProgramNotificationSchedule: Decodable, Equatable {
    let schema: String?
    let schemaVersion: Int?
    let notifications: [ProgramLocalNotificationRequest]

    var validLocalNotificationRequests: [ProgramLocalNotificationRequest] {
        notifications.filter(\.isAllowedLocalProgramNotification)
    }

    private enum CodingKeys: String, CodingKey {
        case schema
        case schemaVersion
        case schemaVersionSnake = "schema_version"
        case notifications
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        schema = try container.decodeIfPresent(String.self, forKey: .schema)
        schemaVersion = try container.decodeIfPresent(Int.self, forKey: .schemaVersion)
            ?? container.decodeIfPresent(Int.self, forKey: .schemaVersionSnake)
        notifications = try container.decodeIfPresent(
            [ProgramLocalNotificationRequest].self,
            forKey: .notifications
        ) ?? []
    }
}

struct ProgramLocalNotificationRequest: Decodable, Equatable, Hashable, Sendable {
    static let gateBlockedMorningIdentifier = "agentic30.program.gate-blocked-morning"
    static let commitmentDueIdentifier = "agentic30.program.commitment-due"
    static let allowedIdentifiers: Set<String> = [
        gateBlockedMorningIdentifier,
        commitmentDueIdentifier,
    ]

    let identifier: String
    let title: String
    let body: String?
    let sound: String?
    let trigger: ProgramLocalNotificationTrigger?
    let userInfo: ProgramNotificationUserInfo?

    var isAllowedLocalProgramNotification: Bool {
        guard Self.allowedIdentifiers.contains(identifier),
              title.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil,
              trigger?.localNineAmDateComponents != nil else {
            return false
        }
        return true
    }

    var localDateComponents: DateComponents? {
        trigger?.localNineAmDateComponents
    }

    var notificationTitle: String {
        title.trimmingCharacters(in: .whitespacesAndNewlines)
    }

    var notificationBody: String? {
        body?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
    }

    var notificationSound: UNNotificationSound? {
        sound?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "default"
            ? .default
            : nil
    }

    var notificationUserInfo: [AnyHashable: Any] {
        var info: [AnyHashable: Any] = [
            "agentic30.program.notification.identifier": identifier,
        ]
        if let kind = userInfo?.kind?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
            info["agentic30.program.notification.kind"] = kind
        }
        if let gateId = userInfo?.gateIdValue {
            info["agentic30.program.notification.gateId"] = gateId
        }
        if let day = userInfo?.dayValue {
            info["agentic30.program.notification.day"] = day
        }
        info.merge(AgenticAppRoute.routeURLUserInfo(appRoute)) { _, latest in latest }
        return info
    }

    private var appRoute: AgenticAppRoute {
        let anchor = identifier == Self.gateBlockedMorningIdentifier
            ? OpenDesignSectionAnchor.gate.rawValue
            : OpenDesignSectionAnchor.missionAction.rawValue
        return AgenticAppRoute.openDesignRoute(
            .day1,
            day: userInfo?.dayValue,
            anchor: anchor,
            placement: .action,
            telemetrySource: "program_notification"
        )
    }

    private enum CodingKeys: String, CodingKey {
        case identifier
        case title
        case body
        case sound
        case trigger
        case userInfo
        case userInfoSnake = "user_info"
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        identifier = try container.decode(String.self, forKey: .identifier)
        title = try container.decode(String.self, forKey: .title)
        body = try container.decodeIfPresent(String.self, forKey: .body)
        sound = try container.decodeIfPresent(String.self, forKey: .sound)
        trigger = try container.decodeIfPresent(ProgramLocalNotificationTrigger.self, forKey: .trigger)
        userInfo = try container.decodeIfPresent(ProgramNotificationUserInfo.self, forKey: .userInfo)
            ?? container.decodeIfPresent(ProgramNotificationUserInfo.self, forKey: .userInfoSnake)
    }
}

struct ProgramLocalNotificationTrigger: Decodable, Equatable, Hashable, Sendable {
    let type: String?
    let calendar: String?
    let hour: Int?
    let minute: Int?
    let repeats: Bool

    var localNineAmDateComponents: DateComponents? {
        guard type == "local_calendar_time",
              calendar == "local",
              hour == 9,
              minute == 0,
              repeats == false else {
            return nil
        }
        var components = DateComponents()
        components.calendar = Calendar.current
        components.hour = 9
        components.minute = 0
        return components
    }

    private enum CodingKeys: String, CodingKey {
        case type
        case calendar
        case hour
        case minute
        case repeats
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        type = try container.decodeIfPresent(String.self, forKey: .type)
        calendar = try container.decodeIfPresent(String.self, forKey: .calendar)
        hour = try container.decodeIfPresent(Int.self, forKey: .hour)
        minute = try container.decodeIfPresent(Int.self, forKey: .minute)
        repeats = try container.decodeIfPresent(Bool.self, forKey: .repeats) ?? false
    }
}

struct ProgramNotificationUserInfo: Decodable, Equatable, Hashable, Sendable {
    let kind: String?
    let gateId: String?
    let gateIdSnake: String?
    let day: Int?
    let daySnake: Int?

    var gateIdValue: String? {
        (gateId ?? gateIdSnake)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty
    }

    var dayValue: Int? {
        day ?? daySnake
    }

    private enum CodingKeys: String, CodingKey {
        case kind
        case gateId
        case gateIdSnake = "gate_id"
        case day
        case daySnake = "day_id"
    }
}

struct OfficeHoursDailyCardReplacementCandidate: Equatable {
    let candidateName: String
    let actionText: String

    var payload: [String: Any] {
        [
            "text": actionText,
            "customer": candidateName,
            "channel": "manual",
            "message": actionText,
            "expectedEvidenceKind": "url",
            "confirmedByUser": true,
            "candidateName": candidateName,
            "actionKind": "outreach",
            "actionText": actionText,
        ]
    }
}

struct OfficeHoursDailyCardScoreboardBuckets: Equatable {
    let accepted: Int
    let excluded: Int
    let learning: Int
}

enum OfficeHoursDailyCardPresentation {
    static let selfReportResolutionCopy = "자기 보고 해소는 고객 증거나 매출 진전으로 세지 않음"

    static func orderedCards(
        _ cards: [SidecarEvent.MissionCard.DailyCard]
    ) -> [SidecarEvent.MissionCard.DailyCard] {
        cards.sorted { lhs, rhs in
            if lhs.displayOrder != rhs.displayOrder {
                return lhs.displayOrder < rhs.displayOrder
            }
            return lhs.stableID < rhs.stableID
        }
    }

    static func actionIDs(for card: SidecarEvent.MissionCard.DailyCard) -> [String] {
        switch card.type {
        case .officeHoursStateTransition:
            let choiceIDs = Set(card.stateTransition?.choices.map(\.id) ?? [])
            return [
                "attach_evidence",
                "resolve_without_evidence",
                "replace_candidate",
                "keep_open_today",
            ].filter { choiceIDs.contains($0) }
        case .officeHoursAgentWorkpack:
            return ["attach_evidence"]
        case .programScoreboardSnapshot:
            return []
        case .revenueOrActivationGate:
            return card.gateCard?.recoveryBranch.isEmpty == false ? ["gate_recovery"] : []
        }
    }

    static func replacementCandidate(
        candidateName: String,
        actionText: String
    ) -> OfficeHoursDailyCardReplacementCandidate? {
        let candidateName = candidateName.trimmingCharacters(in: .whitespacesAndNewlines)
        let actionText = actionText.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !candidateName.isEmpty, !actionText.isEmpty else { return nil }
        return OfficeHoursDailyCardReplacementCandidate(
            candidateName: candidateName,
            actionText: actionText
        )
    }

    static func scoreboardBuckets(
        for entry: SidecarEvent.MissionCard.DailyCard.ScoreboardEntry
    ) -> OfficeHoursDailyCardScoreboardBuckets {
        let excludedCounts = entry.excludedCounts ?? [:]
        var excluded = 0
        var learning = 0
        for (key, value) in excludedCounts {
            if isLearningBucket(key) {
                learning += value
            } else {
                excluded += value
            }
        }
        return OfficeHoursDailyCardScoreboardBuckets(
            accepted: entry.acceptedCount,
            excluded: excluded,
            learning: learning
        )
    }

    private static func isLearningBucket(_ key: String) -> Bool {
        let normalized = key
            .lowercased()
            .replacingOccurrences(of: "_", with: "")
            .replacingOccurrences(of: "-", with: "")
            .replacingOccurrences(of: " ", with: "")
        return normalized.contains("self")
            || normalized.contains("learning")
            || normalized.contains("paymentintent")
    }
}

enum LongRunningCompletionNotificationKind: String, CaseIterable, Hashable, Sendable {
    case morningBriefing
    case workspaceScan
    case documentCreation
    case workHistory
    case bipResearch
    case newsMarketRadar
    case strategyReport
    case bipMission

    var route: LongRunningCompletionRoute {
        switch self {
        case .morningBriefing:
            return .morningBriefing
        case .workspaceScan:
            return .day1
        case .documentCreation:
            return .document
        case .workHistory:
            return .history
        case .bipResearch:
            return .bipResearch
        case .newsMarketRadar:
            return .newsMarketRadar
        case .strategyReport:
            return .strategy
        case .bipMission:
            return .bipMission
        }
    }
}

enum LongRunningCompletionOutcome: String, CaseIterable, Hashable, Sendable {
    case success
    case failed
    case blocked
}

enum LongRunningCompletionRoute: String, Hashable, Sendable {
    case morningBriefing
    case day1
    case document
    case history
    case bipResearch
    case newsMarketRadar
    case strategy
    case bipMission
}

extension LongRunningCompletionNotificationKind {
    var defaultRouteDay: Int? {
        switch self {
        case .workspaceScan:
            return 1
        default:
            return nil
        }
    }

    var defaultRouteAnchor: String? {
        switch self {
        case .morningBriefing:
            return "summary"
        case .workspaceScan:
            return OpenDesignSectionAnchor.top.rawValue
        default:
            return nil
        }
    }
}

enum LocalNotificationCopyPolicy {
    private static let maxBodyLength = 90
    private static let unsafeBodyNeedles = [
        "http://",
        "https://",
        "www.",
        "api",
        "apikey",
        "auth",
        "bearer",
        "command not found",
        "digest failed",
        "digest succeeded",
        "error",
        "exception",
        "external mcp digest",
        "failed",
        "forbidden",
        "is required",
        "mcp",
        "oauth",
        "raw error",
        "secret",
        "stack trace",
        "stderr",
        "stdout",
        "succeeded",
        "token",
        "traceback",
        "unauthorized",
    ]

    static func safeBodyCandidate(_ candidate: String?) -> String? {
        guard let cleaned = candidate?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty else {
            return nil
        }
        guard cleaned.count <= maxBodyLength,
              cleaned.rangeOfCharacter(from: .newlines) == nil,
              containsKorean(cleaned) else {
            return nil
        }
        let lowercased = cleaned.lowercased()
        guard !unsafeBodyNeedles.contains(where: { lowercased.contains($0) }) else {
            return nil
        }
        return cleaned
    }

    static func morningBriefingSuccessDetail(_ briefing: MorningBriefing?) -> String {
        if let verdictTitle = safeBodyCandidate(briefing?.customerEvidenceVerdict?.title) {
            return verdictTitle
        }
        if let statement = safeBodyCandidate(briefing?.summary?.statement) {
            return statement
        }
        return "밤사이 제품·고객 신호를 정리했어요."
    }

    static func morningBriefingFailureDetail(_ detail: String?) -> String {
        safeBodyCandidate(detail)
            ?? "브리핑을 끝내지 못했어요. 열어서 연결 상태를 확인하세요."
    }

    static func failedMorningBriefingSourceDetail(_ sources: [MorningBriefingStatusFailedSource]) -> String {
        let labels = sources
            .map { ($0.label ?? $0.id).trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .prefix(2)
        let labelText = labels.isEmpty ? "일부 소스" : labels.joined(separator: " · ")
        return "\(labelText) 수집을 완료하지 못했어요. 브리핑에서 연결 상태를 확인하세요."
    }

    static func longRunningBody(
        kind: LongRunningCompletionNotificationKind,
        outcome: LongRunningCompletionOutcome,
        docPath: String?,
        detail: String?
    ) -> String {
        if let safeDetail = safeBodyCandidate(detail) {
            return safeDetail
        }

        switch (kind, outcome) {
        case (.morningBriefing, .success):
            return "밤사이 제품·고객 신호를 정리했어요."
        case (.morningBriefing, _):
            return "브리핑을 끝내지 못했어요. 열어서 연결 상태를 확인하세요."
        case (.workspaceScan, .success):
            return "워크스페이스 분석이 끝났고 Day 1을 이어갈 수 있어요."
        case (.workspaceScan, .blocked):
            if let provider = providerName(in: detail) {
                return "\(provider) 로그인이 필요해 워크스페이스 분석을 멈췄어요."
            }
            return "AI 연결 확인이 필요해 워크스페이스 분석을 멈췄어요."
        case (.workspaceScan, .failed):
            return "워크스페이스 분석을 끝내지 못했어요. 열어서 다시 시도하세요."
        case (.documentCreation, .success):
            if let docPath {
                return "\((docPath as NSString).lastPathComponent)을 만들었어요."
            }
            return "요청한 문서를 만들었어요."
        case (.documentCreation, _):
            return "문서를 만들지 못했어요. 열어서 다시 시도하세요."
        case (.workHistory, .success):
            return "이번 주 작업 히스토리를 볼 수 있어요."
        case (.workHistory, _):
            return "히스토리를 끝내지 못했어요. 열어서 연결 상태를 확인하세요."
        case (.bipResearch, .success):
            return "새 고객 후보와 공개 신호를 확인할 수 있어요."
        case (.bipResearch, _):
            return "고객 후보 리서치를 끝내지 못했어요. 열어서 다시 시도하세요."
        case (.newsMarketRadar, .success):
            return "새 시장 신호 카드를 확인할 수 있어요."
        case (.newsMarketRadar, _):
            return "시장 신호 업데이트를 끝내지 못했어요. 열어서 다시 시도하세요."
        case (.strategyReport, .success):
            return "새 전략 리포트를 확인할 수 있어요."
        case (.strategyReport, _):
            return "전략 리포트를 끝내지 못했어요. 열어서 다시 시도하세요."
        case (.bipMission, .success):
            return "근거 기반 실행 미션을 확인할 수 있어요."
        case (.bipMission, _):
            return "오늘 미션을 만들지 못했어요. 열어서 다시 시도하세요."
        }
    }

    private static func containsKorean(_ text: String) -> Bool {
        text.unicodeScalars.contains { scalar in
            switch scalar.value {
            case 0xAC00...0xD7A3, 0x3130...0x318F:
                return true
            default:
                return false
            }
        }
    }

    private static func providerName(in detail: String?) -> String? {
        let lowercased = detail?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        if lowercased.contains("codex") { return "Codex" }
        if lowercased.contains("claude") { return "Claude" }
        if lowercased.contains("gemini") { return "Gemini" }
        if lowercased.contains("cursor") { return "Cursor" }
        return nil
    }
}

/// Routing payload for local notifications posted when a user-visible long
/// running operation finishes after the founder may have switched context.
struct LongRunningCompletionNotification: Hashable, Sendable {
    static let kindUserInfoKey = "agentic30.longRunningCompletion.kind"
    static let outcomeUserInfoKey = "agentic30.longRunningCompletion.outcome"
    static let routeUserInfoKey = "agentic30.longRunningCompletion.route"
    static let docPathUserInfoKey = "agentic30.longRunningCompletion.docPath"
    static let detailUserInfoKey = "agentic30.longRunningCompletion.detail"
    static let identifierPrefix = "agentic30.long-running-completion."

    let kind: LongRunningCompletionNotificationKind
    let outcome: LongRunningCompletionOutcome
    let route: LongRunningCompletionRoute
    let docPath: String?
    let detail: String?

    init(
        kind: LongRunningCompletionNotificationKind,
        outcome: LongRunningCompletionOutcome,
        docPath: String? = nil,
        detail: String? = nil
    ) {
        self.kind = kind
        self.outcome = outcome
        self.route = kind.route
        self.docPath = docPath?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        self.detail = detail?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
    }

    init?(notificationUserInfo userInfo: [AnyHashable: Any], identifier: String) {
        guard identifier.hasPrefix(Self.identifierPrefix) else { return nil }
        let fallback = identifier
            .dropFirst(Self.identifierPrefix.count)
            .split(separator: ".", maxSplits: 1)
            .map(String.init)
        let rawKind = (userInfo[Self.kindUserInfoKey] as? String)
            ?? fallback.first
        let rawOutcome = (userInfo[Self.outcomeUserInfoKey] as? String)
            ?? fallback.dropFirst().first
        guard let rawKind,
              let kind = LongRunningCompletionNotificationKind(rawValue: rawKind),
              let rawOutcome,
              let outcome = LongRunningCompletionOutcome(rawValue: rawOutcome) else {
            return nil
        }
        self.kind = kind
        self.outcome = outcome
        self.route = (userInfo[Self.routeUserInfoKey] as? String)
            .flatMap(LongRunningCompletionRoute.init(rawValue:))
            ?? kind.route
        self.docPath = (userInfo[Self.docPathUserInfoKey] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty
        self.detail = (userInfo[Self.detailUserInfoKey] as? String)?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty
    }

    static func notificationIdentifier(
        kind: LongRunningCompletionNotificationKind,
        outcome: LongRunningCompletionOutcome
    ) -> String {
        "\(identifierPrefix)\(kind.rawValue).\(outcome.rawValue)"
    }

    var notificationIdentifier: String {
        Self.notificationIdentifier(kind: kind, outcome: outcome)
    }

    var notificationTitle: String {
        switch (kind, outcome) {
        case (.morningBriefing, .success):
            return "아침 브리핑 준비 완료"
        case (.morningBriefing, _):
            return "아침 브리핑 확인 필요"
        case (.workspaceScan, .success):
            return "Day 1 준비 완료"
        case (.workspaceScan, _):
            return "워크스페이스 분석 확인 필요"
        case (.documentCreation, .success):
            return "문서 생성 완료"
        case (.documentCreation, _):
            return "문서 생성 실패"
        case (.workHistory, .success):
            return "히스토리 인덱싱 완료"
        case (.workHistory, _):
            return "히스토리 인덱싱 실패"
        case (.bipResearch, .success):
            return "고객 후보 리서치 완료"
        case (.bipResearch, _):
            return "고객 후보 리서치 확인 필요"
        case (.newsMarketRadar, .success):
            return "시장 신호 업데이트 완료"
        case (.newsMarketRadar, _):
            return "시장 신호 업데이트 확인 필요"
        case (.strategyReport, .success):
            return "전략 리포트 업데이트 완료"
        case (.strategyReport, _):
            return "전략 리포트 확인 필요"
        case (.bipMission, .success):
            return "오늘 미션 준비 완료"
        case (.bipMission, _):
            return "오늘 미션 생성 실패"
        }
    }

    var notificationBody: String {
        LocalNotificationCopyPolicy.longRunningBody(
            kind: kind,
            outcome: outcome,
            docPath: docPath,
            detail: detail
        )
    }

    var userInfo: [AnyHashable: Any] {
        var info: [AnyHashable: Any] = [
            Self.kindUserInfoKey: kind.rawValue,
            Self.outcomeUserInfoKey: outcome.rawValue,
            Self.routeUserInfoKey: route.rawValue,
        ]
        if let docPath {
            info[Self.docPathUserInfoKey] = docPath
        }
        if let detail {
            info[Self.detailUserInfoKey] = detail
        }
        info.merge(AgenticAppRoute.routeURLUserInfo(AgenticAppRoute.defaultRoute(for: self))) { _, latest in latest }
        return info
    }
}

/// Pure decision authority for long-running completion notifications.
enum LongRunningCompletionNotifier {
    static let activeAppMinimumElapsed: TimeInterval = 15

    static func shouldNotify(
        attemptId: String?,
        alreadyNotifiedAttemptIds: Set<String>,
        isUserVisibleAttempt: Bool,
        elapsed: TimeInterval,
        isAppActive: Bool,
        isEnabled: Bool,
        isUITesting: Bool
    ) -> Bool {
        guard let attemptId = attemptId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
              !alreadyNotifiedAttemptIds.contains(attemptId),
              isUserVisibleAttempt,
              isEnabled,
              !isUITesting else {
            return false
        }
        return !isAppActive || elapsed >= activeAppMinimumElapsed
    }
}

struct MorningBriefingCompletionClassification: Equatable {
    let isCollectingSnapshot: Bool
    let outcome: LongRunningCompletionOutcome?
    let detail: String?
}

enum MorningBriefingCompletionClassifier {
    static func classify(
        topLevelStatus: MorningBriefingStatus?,
        briefing: MorningBriefing?
    ) -> MorningBriefingCompletionClassification {
        let state = topLevelStatus?.state?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() ?? ""
        if ["collecting", "refreshing", "running"].contains(state) {
            return MorningBriefingCompletionClassification(
                isCollectingSnapshot: true,
                outcome: nil,
                detail: nil
            )
        }
        if state == "failed" || state == "error" {
            return MorningBriefingCompletionClassification(
                isCollectingSnapshot: false,
                outcome: .failed,
                detail: LocalNotificationCopyPolicy.morningBriefingFailureDetail(
                    topLevelStatus?.detail ?? briefing?.status?.detail
                )
            )
        }
        let failedSources = selectedFailedSources(topLevelStatus: topLevelStatus, briefing: briefing)
        if !failedSources.isEmpty {
            return MorningBriefingCompletionClassification(
                isCollectingSnapshot: false,
                outcome: .failed,
                detail: LocalNotificationCopyPolicy.failedMorningBriefingSourceDetail(failedSources)
            )
        }
        return MorningBriefingCompletionClassification(
            isCollectingSnapshot: false,
            outcome: .success,
            detail: LocalNotificationCopyPolicy.morningBriefingSuccessDetail(briefing)
        )
    }

    private static func selectedFailedSources(
        topLevelStatus: MorningBriefingStatus?,
        briefing: MorningBriefing?
    ) -> [MorningBriefingStatusFailedSource] {
        if let failedSources = topLevelStatus?.failedSources, !failedSources.isEmpty {
            return failedSources
        }
        return (briefing?.sync?.sources ?? [])
            .filter { $0.selected == true && $0.state == "failed" }
            .map {
                MorningBriefingStatusFailedSource(
                    id: $0.id,
                    label: $0.label,
                    detail: $0.detail
                )
            }
    }

}

private struct LongRunningCompletionAttempt: Equatable {
    let id: String
    let kind: LongRunningCompletionNotificationKind
    let startedAt: Date
    let source: String
    let isUserVisible: Bool
}

struct WorkspaceScanProgressSnapshot: Equatable {
    let progressText: String
    let stage: String?
    let stepIndex: Int?
    let totalSteps: Int?
    let etaSeconds: Int?
    let foundCount: Int?
    let elapsedMs: Int?

    init(
        progressText: String,
        stage: String? = nil,
        stepIndex: Int? = nil,
        totalSteps: Int? = nil,
        etaSeconds: Int? = nil,
        foundCount: Int? = nil,
        elapsedMs: Int? = nil
    ) {
        self.progressText = progressText
        self.stage = stage
        self.stepIndex = stepIndex
        self.totalSteps = totalSteps
        self.etaSeconds = etaSeconds
        self.foundCount = foundCount
        self.elapsedMs = elapsedMs
    }
}

/// `workspace_scan_provider_limited`: a scan-path provider hit its usage limit
/// (quota). The scan still completed with local deterministic signals; the UI
/// surfaces this notice with an explicit "switch provider and re-scan" button.
struct ScanProviderLimitNotice: Equatable {
    let scanRoot: String
    let provider: AgentProvider
    /// "scan_agent" (workspace scan) or "day1_synthesis" (Day 1 question synthesis).
    let stage: String
}

struct Agentic30GitignoreState: Codable, Equatable, Hashable {
    let status: String
    let scanRoot: String?
    let path: String?
    let entry: String?
    let error: String?

    var needsConsent: Bool {
        status == "needs-consent"
    }

    func withScanRoot(_ root: String?) -> Agentic30GitignoreState {
        Agentic30GitignoreState(
            status: status,
            scanRoot: scanRoot ?? root,
            path: path,
            entry: entry,
            error: error
        )
    }
}

struct WorkspaceScanProviderReadiness: Codable, Hashable, Identifiable {
    let provider: AgentProvider
    let sdkInstalled: Bool
    let authenticated: Bool
    let scanReady: Bool
    let source: String
    let message: String
    let sdkMessage: String
    let authAction: String?

    var id: AgentProvider { provider }

    var telemetryProperties: [String: Any] {
        [
            "provider": provider.rawValue,
            "sdk_installed": sdkInstalled,
            "authenticated": authenticated,
            "scan_ready": scanReady,
            "source": source,
            "message": message,
            "sdk_message": sdkMessage,
            "auth_action": authAction ?? "",
        ]
    }
}

/// `workspace_scan_blocked`: foreground scan verification could not complete.
/// Unlike a provider-limit notice, this is fail-closed: Day 1 must not proceed
/// until the user retries with an available provider.
struct WorkspaceScanBlockedNotice: Equatable {
    let scanRoot: String
    let provider: AgentProvider
    let model: String
    let reason: String
    let message: String
    let nextProvider: AgentProvider?
    let availableProviders: [AgentProvider]
    let providerReadiness: [WorkspaceScanProviderReadiness]
    let errorKind: String?
    /// Why an aborted scan stopped: "soft_timeout" / "hard_deadline" (our
    /// wall-clock budget) vs "external" (SDK/network abort). nil for non-abort
    /// blocks. Drives whether the recovery copy says "시간 초과" and whether the
    /// primary action retries the same provider or steers to a switch.
    var abortCause: String? = nil
    /// Attempt number echoed by the sidecar (0/absent = first run). >= 1 means an
    /// extended-budget retry already failed, so recovery escalates to switch.
    var retryAttempt: Int? = nil
}

/// Reason-aware recovery plan for a blocked workspace scan. Pure (no SwiftUI) so
/// the copy + primary action are unit-tested without a view harness.
///
/// The distinction the raw notice doesn't make on its own: an *aborted*
/// (timeout) run failed on a provider that is still authenticated and
/// scan-ready, so the right recovery is to **retry the same provider** — not to
/// switch away from it or re-authenticate. Usage-limit blocks name the cap and
/// steer to a switch; auth-required blocks route to connect; a fully empty
/// readiness set routes to Settings.
struct WorkspaceScanBlockedRecovery: Equatable {
    enum PrimaryAction: Equatable {
        case reviewEvidence
        /// Same provider is still scan-ready — it just needs to run again.
        case retry(AgentProvider)
        /// A different scan-ready provider should take over.
        case switchProvider(AgentProvider)
        /// SDKs are installed but unauthenticated — offer per-provider connect.
        case connect([WorkspaceScanProviderReadiness])
        /// Nothing installed/ready — route to Settings > AI 연결.
        case openSettings
    }

    let title: String
    let body: String
    let primaryAction: PrimaryAction
    /// Other scan-ready providers offered under a "다른 AI" menu.
    let alternateProviders: [AgentProvider]

    init(notice: WorkspaceScanBlockedNotice) {
        let reason = notice.reason.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let kind = (notice.errorKind ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let isInsufficientEvidence = reason == "insufficient_evidence"
            || kind == "workspace_scan_insufficient_evidence"
        let isAborted = reason == "aborted" || kind == "provider_aborted"
        let isUsageLimit = reason == "usage_limit" || kind == "provider_usage_limit"

        if isInsufficientEvidence {
            primaryAction = .reviewEvidence
            alternateProviders = []
            title = "처음 기준을 정합니다"
            body = "새 프로젝트는 고객, 문제, 검증 행동이 아직 한 문서에 고정돼 있지 않을 수 있습니다. 폴더에서 읽은 맥락으로 시작하고, 첫 질문에서 직접 좁힙니다."
            return
        }

        let scanReady = notice.providerReadiness.filter(\.scanReady)
        let authRequired = scanReady.isEmpty
            ? notice.providerReadiness.filter { $0.sdkInstalled && !$0.authenticated }
            : []
        let failedTitle = notice.provider.title

        if let primaryReady = WorkspaceScanBlockedRecovery.preferredProvider(scanReady, nextProvider: notice.nextProvider) {
            let failedStillReady = scanReady.contains { $0.provider == notice.provider }
            let abortCause = (notice.abortCause ?? "").trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
            let isTimeoutAbort = abortCause == "soft_timeout" || abortCause == "hard_deadline"
            let alreadyRetried = (notice.retryAttempt ?? 0) >= 1
            if isAborted && failedStillReady && isTimeoutAbort && !alreadyRetried {
                // Timed out on our wall-clock budget; the same provider is still
                // scan-ready. A retry re-runs it ONCE with the extended budget —
                // honest "시간 초과" framing, not a generic "중단".
                primaryAction = .retry(notice.provider)
                alternateProviders = scanReady.map(\.provider).filter { $0 != notice.provider }
                title = "\(failedTitle) 검증이 시간을 초과했어요"
                body = "검증이 시간 예산을 넘겼어요. 같은 AI로 다시 시도하면 더 넉넉한 시간으로 재검증합니다."
            } else if isAborted && isTimeoutAbort && alreadyRetried {
                // The extended-budget retry still timed out — stop looping on the
                // same provider and steer to a switch (never auto-switch).
                primaryAction = .switchProvider(primaryReady)
                alternateProviders = scanReady.map(\.provider).filter { $0 != primaryReady }
                title = "\(failedTitle) 검증이 계속 시간을 초과해요"
                body = "넉넉한 시간으로도 \(failedTitle) 검증을 끝내지 못했어요. \(primaryReady.title)로 전환해 검증하세요."
            } else if isAborted {
                // External/SDK abort (not our timer), or the failed provider is no
                // longer scan-ready: a same-provider retry is less honest than
                // steering to another scan-ready provider.
                primaryAction = .switchProvider(primaryReady)
                alternateProviders = scanReady.map(\.provider).filter { $0 != primaryReady }
                title = "\(failedTitle) 검증이 중단됐어요"
                body = "\(failedTitle) 검증이 예기치 않게 중단됐어요. \(primaryReady.title)로 전환하거나 잠시 후 다시 시도하세요."
            } else if isUsageLimit {
                primaryAction = .switchProvider(primaryReady)
                alternateProviders = scanReady.map(\.provider).filter { $0 != primaryReady }
                title = "\(failedTitle) 사용 한도에 걸렸어요"
                body = "\(primaryReady.title)로 전환해 다시 검증하거나, 잠시 후 다시 시도하세요."
            } else {
                primaryAction = .switchProvider(primaryReady)
                alternateProviders = scanReady.map(\.provider).filter { $0 != primaryReady }
                title = "\(failedTitle) 검증을 완료하지 못했어요"
                body = "로컬 신호만으로는 Day 1을 시작하지 않습니다. \(primaryReady.title)로 다시 검증하세요."
            }
        } else if !authRequired.isEmpty {
            primaryAction = .connect(authRequired)
            alternateProviders = []
            title = "AI 연결이 필요해요"
            let summary = authRequired.prefix(4)
                .map { "\($0.provider.title): \(WorkspaceScanBlockedRecovery.authShortLabel($0))" }
                .joined(separator: " · ")
            body = "SDK는 찾았지만 scan-ready 인증이 없습니다. \(summary)"
        } else {
            primaryAction = .openSettings
            alternateProviders = []
            title = "연결된 AI가 없어요"
            body = "Settings > AI 연결에서 provider를 연결한 뒤 다시 시도하세요."
        }
    }

    private static func preferredProvider(
        _ scanReady: [WorkspaceScanProviderReadiness],
        nextProvider: AgentProvider?
    ) -> AgentProvider? {
        if let next = nextProvider, scanReady.contains(where: { $0.provider == next }) {
            return next
        }
        return scanReady.first?.provider
    }

    static func authShortLabel(_ readiness: WorkspaceScanProviderReadiness) -> String {
        switch readiness.authAction {
        case "claude_login", "codex_login":
            return "로그인"
        case "gemini_adc_login":
            return "ADC 로그인"
        case "gemini_api_key", "cursor_api_key":
            return "API key 입력"
        default:
            return "연결"
        }
    }
}

enum AppUpdateResult: Equatable {
    case neverChecked
    case checking
    case latest
    case updateAvailable(version: String, displayVersion: String?)
    case downloaded(version: String, displayVersion: String?)
    case installing(version: String, displayVersion: String?)
    case blocked(String)
    case error(String)

    var statusText: String {
        switch self {
        case .neverChecked:
            return "Never checked"
        case .checking:
            return "Checking"
        case .latest:
            return "Latest"
        case .updateAvailable(let version, let displayVersion):
            return "Available \(Self.versionLabel(version: version, displayVersion: displayVersion))"
        case .downloaded(let version, let displayVersion):
            return "Downloaded \(Self.versionLabel(version: version, displayVersion: displayVersion))"
        case .installing(let version, let displayVersion):
            return "Installing \(Self.versionLabel(version: version, displayVersion: displayVersion))"
        case .blocked:
            return "Blocked"
        case .error:
            return "Error"
        }
    }

    var detailText: String {
        switch self {
        case .neverChecked:
            return "Sparkle has not completed an update check yet."
        case .checking:
            return "Checking the signed appcast feed."
        case .latest:
            return "The installed build is current."
        case .updateAvailable(let version, let displayVersion):
            return "A newer build is available: \(Self.versionLabel(version: version, displayVersion: displayVersion))."
        case .downloaded(let version, let displayVersion):
            return "Update \(Self.versionLabel(version: version, displayVersion: displayVersion)) is downloaded and ready for Sparkle's install flow."
        case .installing(let version, let displayVersion):
            return "Sparkle is preparing to install \(Self.versionLabel(version: version, displayVersion: displayVersion))."
        case .blocked(let reason):
            return reason
        case .error(let message):
            return message
        }
    }

    /// Non-nil while an update is known but not yet installed — drives the
    /// gentle in-app "update available" pill (Sparkle gentle reminders).
    var pendingUpdateVersionLabel: String? {
        switch self {
        case .updateAvailable(let version, let displayVersion),
             .downloaded(let version, let displayVersion):
            return Self.shortVersionLabel(version: version, displayVersion: displayVersion)
        case .neverChecked, .checking, .latest, .installing, .blocked, .error:
            return nil
        }
    }

    private static func versionLabel(version: String, displayVersion: String?) -> String {
        guard let displayVersion, !displayVersion.isEmpty, displayVersion != version else {
            return version
        }
        return "\(displayVersion) (\(version))"
    }

    private static func shortVersionLabel(version: String, displayVersion: String?) -> String {
        guard let displayVersion, !displayVersion.isEmpty else {
            return version
        }
        return displayVersion
    }
}

struct AppUpdateState: Equatable {
    var configured: Bool
    var feedURL: String
    var automaticChecksEnabled: Bool
    var automaticDownloadsEnabled: Bool
    var isSessionActive: Bool
    var lastCheckAt: Date?
    var lastResult: AppUpdateResult
    var latestVersion: String?
    var latestDisplayVersion: String?
    var lastError: String?

    #if arch(x86_64)
    static let defaultFeedURL = "https://updates.agentic30.app/appcast-x64.xml"
    #else
    static let defaultFeedURL = "https://updates.agentic30.app/appcast.xml"
    #endif

    static let unavailable = AppUpdateState(
        configured: false,
        feedURL: defaultFeedURL,
        automaticChecksEnabled: false,
        automaticDownloadsEnabled: false,
        isSessionActive: false,
        lastCheckAt: nil,
        lastResult: .blocked("Release builds must include a Sparkle public EdDSA key."),
        latestVersion: nil,
        latestDisplayVersion: nil,
        lastError: nil
    )

    var currentVersionSummary: String {
        let info = Bundle.main.infoDictionary
        let version = info?["CFBundleShortVersionString"] as? String ?? "dev"
        let build = info?["CFBundleVersion"] as? String ?? "local"
        return "\(version) (\(build))"
    }

    var lastCheckSummary: String {
        guard let lastCheckAt else { return "Never" }
        return Self.dateFormatter.string(from: lastCheckAt)
    }

    private static let dateFormatter: DateFormatter = {
        let formatter = DateFormatter()
        formatter.dateStyle = .medium
        formatter.timeStyle = .short
        return formatter
    }()
}

struct IntakeV2BootLogState: Equatable {
    struct Line: Identifiable, Equatable {
        let id: String
        let command: String
        let status: String?
        let isActive: Bool
    }

    enum ScanStage: String, Equatable {
        case connecting
        case local
        case verifying
        case composing
        case merged
        case blocked
        case failed

        nonisolated var title: String {
            switch self {
            case .connecting:
                return "실행 보조 앱 연결"
            case .local:
                return "폴더 신호 읽기"
            case .verifying:
                return "질문 근거 검증"
            case .composing:
                return "질문 세트 구성"
            case .merged:
                return "Day 1 준비 완료"
            case .blocked:
                return "AI 검증 필요"
            case .failed:
                return "scan 중단"
            }
        }

        nonisolated var fallbackStepIndex: Int {
            switch self {
            case .connecting:
                return 0
            case .local:
                return 1
            case .verifying:
                return 2
            case .blocked:
                return 2
            case .composing, .merged, .failed:
                return 3
            }
        }

        nonisolated init?(rawStage: String?) {
            guard let value = rawStage?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .lowercased(),
                  !value.isEmpty else {
                return nil
            }
            self.init(rawValue: value)
        }
    }

    struct ScanPhase: Equatable {
        let stage: ScanStage
        let stepIndex: Int
        let totalSteps: Int
        let etaSeconds: Int?
        let foundCount: Int?

        var label: String {
            "\(stepIndex)/\(totalSteps)"
        }
    }

    let lines: [Line]
    let scanDidComplete: Bool
    let scanDidFail: Bool
    let scanDidBlock: Bool
    let foundArtifactCount: Int?
    let scanElapsed: IntakeV2BootLogElapsed?
    let scanPhase: ScanPhase

    static let empty = IntakeV2BootLogState(
        isConnected: false,
        workspaceRoot: "",
        diagnostics: nil,
        scanProgressLogs: [],
        scanDidComplete: false,
        scanDidBlock: false,
        scanError: nil,
        foundArtifactCount: nil,
        isScanning: false
    )

    init(
        isConnected: Bool,
        workspaceRoot: String,
        diagnostics: SidecarDiagnostics?,
        scanProgressLogs: [String],
        scanProgressSnapshots: [WorkspaceScanProgressSnapshot] = [],
        scanDidComplete: Bool,
        scanDidBlock: Bool = false,
        scanBlockedMessage: String? = nil,
        scanError: String?,
        foundArtifactCount: Int?,
        isScanning: Bool,
        scanStartedAt: Date? = nil,
        scanCompletedAt: Date? = nil
    ) {
        var nextLines: [Line] = []
        let didFail = scanError?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil

        if isConnected, diagnostics != nil {
            nextLines.append(Line(
                id: "sidecar.ready",
                command: "sidecar.ready",
                status: Self.readyStatus(workspaceRoot: workspaceRoot, diagnostics: diagnostics),
                isActive: false
            ))
        }

        nextLines.append(contentsOf: Self.displayProgressLines(
            scanProgressLogs,
            isActive: isScanning && !scanDidComplete && !scanDidBlock
        ))

        if scanDidBlock {
            let message = scanBlockedMessage?
                .trimmingCharacters(in: .whitespacesAndNewlines)
                .nonEmpty
                ?? "AI verification required"
            let status = Self.isEvidenceSetupMessage(message)
                ? "• Day 1 질문에서 고객·문제·검증 행동을 직접 좁힙니다"
                : "✗ \(message)"
            nextLines.append(Line(
                id: "scan.blocked",
                command: "scan.blocked",
                status: status,
                isActive: false
            ))
        } else if scanDidComplete {
            let trimmedError = scanError?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
            let command = trimmedError == nil ? "scan.result" : "scan.failed"
            let status = trimmedError
                .map { "✗ \($0)" }
                ?? "✓ \(foundArtifactCount ?? 0) evidence sources scanned"
            nextLines.append(Line(
                id: command,
                command: command,
                status: status,
                isActive: false
            ))
        }

        lines = Array(nextLines.suffix(6))
        self.scanDidComplete = scanDidComplete
        self.scanDidFail = didFail
        self.scanDidBlock = scanDidBlock
        self.foundArtifactCount = foundArtifactCount
        self.scanPhase = Self.scanPhase(
            snapshots: scanProgressSnapshots,
            messages: scanProgressLogs,
            scanDidComplete: scanDidComplete,
            scanDidFail: didFail,
            scanDidBlock: scanDidBlock,
            foundArtifactCount: foundArtifactCount
        )
        if let scanStartedAt, !scanDidComplete, !scanDidBlock {
            self.scanElapsed = IntakeV2BootLogElapsed(
                status: .running,
                startedAt: scanStartedAt,
                completedAt: nil
            )
        } else if let scanStartedAt, let scanCompletedAt {
            self.scanElapsed = IntakeV2BootLogElapsed(
                status: (didFail || scanDidBlock) ? .failed : .succeeded,
                startedAt: scanStartedAt,
                completedAt: scanCompletedAt
            )
        } else {
            self.scanElapsed = nil
        }
    }

    private nonisolated static func readyStatus(workspaceRoot: String, diagnostics: SidecarDiagnostics?) -> String {
        var parts: [String] = ["✓"]
        if let node = diagnostics?.runtime.node?.trimmingCharacters(in: .whitespacesAndNewlines),
           !node.isEmpty {
            parts.append(node)
        }
        if let pid = diagnostics?.runtime.pid {
            parts.append("pid \(pid)")
        }
        let workspaceName = (workspaceRoot as NSString).lastPathComponent
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if !workspaceName.isEmpty {
            parts.append(workspaceName)
        }
        if parts.count == 1 {
            parts.append("connected")
        }
        return parts.joined(separator: " · ")
    }

    private struct DisplayProgressLine: Equatable {
        let command: String
        let status: String
    }

    private nonisolated static func displayProgressLines(_ messages: [String], isActive: Bool) -> [Line] {
        let normalized = messages.compactMap(displayProgressLine)
        guard !normalized.isEmpty else { return [] }

        var output: [Line] = []
        var indexByCommand: [String: Int] = [:]
        let activeNormalizedIndex = normalized.indices.last

        for (index, displayLine) in normalized.enumerated() {
            let lineIsActive = isActive && index == activeNormalizedIndex
            if lineIsActive {
                output = output.map {
                    Line(id: $0.id, command: $0.command, status: $0.status, isActive: false)
                }
            }
            let line = Line(
                id: displayLine.command,
                command: displayLine.command,
                status: displayLine.status,
                isActive: lineIsActive
            )
            if let existingIndex = indexByCommand[displayLine.command] {
                output[existingIndex] = line
            } else {
                indexByCommand[displayLine.command] = output.count
                output.append(line)
            }
        }

        return Array(output.suffix(4))
    }

    private nonisolated static func isEvidenceSetupMessage(_ value: String) -> Bool {
        let status = value.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return status.contains("insufficient")
            || status.contains("근거 부족")
            || status.contains("근거가 부족")
            || status.contains("근거 품질")
            || status.contains("직접 좁")
    }

    private nonisolated static func displayProgressLine(for rawMessage: String) -> DisplayProgressLine? {
        let message = rawMessage.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return nil }
        let lowercased = message.lowercased()

        if [
            "workspace scan complete.",
            "workspace scan failed.",
            "workspace scan blocked.",
        ].contains(lowercased) {
            return nil
        }

        if lowercased == "waiting for workspace connection..." {
            return DisplayProgressLine(command: "sidecar.connect", status: "starting sidecar")
        }

        if lowercased == "preparing workspace scan..." {
            return DisplayProgressLine(command: "scan.prepare", status: "queueing workspace scan")
        }

        if lowercased.contains("starting workspace scan")
            || lowercased.contains("checking common doc filenames locally") {
            return DisplayProgressLine(command: "scan.local", status: "checking workspace files")
        }

        if lowercased.contains("local candidate") {
            return DisplayProgressLine(command: "scan.verify", status: localCandidateStatus(from: message))
        }

        if lowercased.contains("no exact local matches")
            || lowercased.contains("asking agents") {
            return DisplayProgressLine(command: "scan.verify", status: "verifying context with agents")
        }

        if lowercased.contains("using read")
            || lowercased.contains("using grep")
            || lowercased.contains("using glob")
            || lowercased.contains("using ls") {
            return DisplayProgressLine(command: "scan.agent", status: "reading files")
        }

        if lowercased.contains(" finished (") {
            return DisplayProgressLine(command: "scan.agent", status: "agent check complete")
        }

        if lowercased.contains("scanning with")
            || lowercased.contains("claude")
            || lowercased.contains("codex")
            || lowercased.contains("gpt")
            || lowercased.contains("haiku") {
            return DisplayProgressLine(command: "scan.agent", status: "verifying context")
        }

        return DisplayProgressLine(
            command: "scan.verify",
            status: truncateDisplayStatus(message)
        )
    }

    private nonisolated static func localCandidateStatus(from message: String) -> String {
        let pattern = #"Found\s+(\d+)\s+local candidate"#
        if let regex = try? NSRegularExpression(pattern: pattern, options: [.caseInsensitive]) {
            let range = NSRange(message.startIndex..<message.endIndex, in: message)
            if let match = regex.firstMatch(in: message, range: range),
               let countRange = Range(match.range(at: 1), in: message) {
                return "\(message[countRange]) local candidates found"
            }
        }
        return "local candidates found"
    }

    private nonisolated static func scanPhase(
        snapshots: [WorkspaceScanProgressSnapshot],
        messages: [String],
        scanDidComplete: Bool,
        scanDidFail: Bool,
        scanDidBlock: Bool,
        foundArtifactCount: Int?
    ) -> ScanPhase {
        if scanDidBlock {
            let lastSnapshot = snapshots.last
            return scanPhase(
                stage: .blocked,
                stepIndex: lastSnapshot?.stepIndex,
                totalSteps: lastSnapshot?.totalSteps,
                etaSeconds: nil,
                foundCount: lastSnapshot?.foundCount ?? foundArtifactCount
            )
        }

        if scanDidFail {
            let lastSnapshot = snapshots.last
            return scanPhase(
                stage: .failed,
                stepIndex: lastSnapshot?.stepIndex,
                totalSteps: lastSnapshot?.totalSteps,
                etaSeconds: nil,
                foundCount: lastSnapshot?.foundCount ?? foundArtifactCount
            )
        }

        if scanDidComplete {
            return ScanPhase(
                stage: .merged,
                stepIndex: 3,
                totalSteps: 3,
                etaSeconds: nil,
                foundCount: foundArtifactCount
            )
        }

        if let snapshot = snapshots.last {
            return scanPhase(
                stage: ScanStage(rawStage: snapshot.stage) ?? inferredStage(from: snapshot.progressText),
                stepIndex: snapshot.stepIndex,
                totalSteps: snapshot.totalSteps,
                etaSeconds: snapshot.etaSeconds,
                foundCount: snapshot.foundCount ?? foundArtifactCount
            )
        }

        return scanPhase(
            stage: messages.last.map(inferredStage(from:)) ?? .local,
            stepIndex: nil,
            totalSteps: nil,
            etaSeconds: nil,
            foundCount: foundArtifactCount
        )
    }

    private nonisolated static func scanPhase(
        stage: ScanStage,
        stepIndex: Int?,
        totalSteps: Int?,
        etaSeconds: Int?,
        foundCount: Int?
    ) -> ScanPhase {
        let total = max(1, totalSteps ?? 3)
        let minimumStep = stage == .connecting ? 0 : 1
        let step = min(max(minimumStep, stepIndex ?? stage.fallbackStepIndex), total)
        return ScanPhase(
            stage: stage,
            stepIndex: step,
            totalSteps: total,
            etaSeconds: etaSeconds,
            foundCount: foundCount
        )
    }

    private nonisolated static func inferredStage(from message: String) -> ScanStage {
        let lowercased = message.lowercased()
        if lowercased.contains("waiting for workspace connection")
            || lowercased.contains("sidecar")
            || lowercased.contains("connection") {
            return .connecting
        }
        if lowercased.contains("blocked")
            || lowercased.contains("검증 필요")
            || lowercased.contains("검증 불가")
            || lowercased.contains("차단") {
            return .blocked
        }
        if lowercased.contains("merged")
            || lowercased.contains("complete")
            || lowercased.contains("완료")
            || lowercased.contains("result") {
            return .merged
        }
        if lowercased.contains("fail")
            || lowercased.contains("error")
            || lowercased.contains("중단")
            || lowercased.contains("실패") {
            return .failed
        }
        if lowercased.contains("compos")
            || lowercased.contains("질문 세트")
            || lowercased.contains("선택지")
            || lowercased.contains("구성") {
            return .composing
        }
        if lowercased.contains("verify")
            || lowercased.contains("agent")
            || lowercased.contains("claude")
            || lowercased.contains("codex")
            || lowercased.contains("gemini")
            || lowercased.contains("검증") {
            return .verifying
        }
        return .local
    }

    private nonisolated static func truncateDisplayStatus(_ value: String, maxLength: Int = 44) -> String {
        let cleaned = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard cleaned.count > maxLength else { return cleaned }
        let endIndex = cleaned.index(cleaned.startIndex, offsetBy: maxLength - 1)
        return "\(cleaned[..<endIndex])…"
    }
}

struct Day1ScanWaitPresentation: Equatable {
    enum State: Equatable {
        case connecting
        case scanningNormal
        case scanningSlow
        case scanMergedReady
        case scanFailed
        case scanBlocked
    }

    static let slowScanSeconds = 45

    let state: State
    let phase: IntakeV2BootLogState.ScanPhase
    let elapsedSeconds: Int?
    let blockedStatus: String?
    let hasWorkspaceScanResult: Bool

    func headerTitle(questionCount: Int = 3) -> String {
        if canOpenDay1 {
            if isEvidenceBlocked {
                return "첫 기준을 정하면서 시작합니다"
            }
            return "Day 1 질문 \(questionCount)개가 준비됐어요"
        }
        if state == .connecting {
            return "실행 보조 앱 연결 중"
        }
        if isBlocked {
            if isEvidenceBlocked {
                return "처음 기준을 정합니다"
            }
            return "AI 검증이 필요합니다"
        }
        return "Day 1 질문 \(questionCount)개를 만드는 중"
    }

    func primaryCTATitle(questionCount: Int = 3) -> String {
        if canOpenDay1 {
            if isEvidenceBlocked {
                return "Day 1 시작하기 →"
            }
            return "질문 \(questionCount)개 시작하기 →"
        }
        if state == .connecting {
            return "연결 중…"
        }
        if isBlocked {
            if isEvidenceBlocked {
                return "첫 기준 정리 중"
            }
            return "AI 연결 확인 필요"
        }
        if let remainingSeconds = estimatedRemainingSeconds, remainingSeconds > 0 {
            return "\(remainingSeconds)초 남음 (예상)"
        }
        return "마무리 중…"
    }

    func primaryCTAAccessibilityLabel(questionCount: Int = 3) -> String {
        if canOpenDay1 {
            return primaryCTATitle(questionCount: questionCount).replacingOccurrences(of: " →", with: "")
        }
        if state == .connecting {
            return "실행 보조 앱 연결 중"
        }
        if isBlocked {
            if isEvidenceBlocked {
                return "처음 기준을 정합니다"
            }
            return "AI 검증이 필요합니다"
        }
        if let remainingSeconds = estimatedRemainingSeconds, remainingSeconds > 0 {
            return "질문 \(questionCount)개 준비 중, \(remainingSeconds)초 남음 예상"
        }
        return "질문 \(questionCount)개 준비 중, 마무리 중"
    }

    var canOpenDay1: Bool {
        state == .scanMergedReady
            || state == .scanFailed
            || (state == .scanBlocked && isEvidenceBlocked && hasWorkspaceScanResult)
    }

    var isBlocked: Bool {
        state == .scanBlocked
    }

    var showsSlowCopy: Bool {
        state == .scanningSlow
    }

    var isEvidenceBlocked: Bool {
        let status = blockedStatus?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased() ?? ""
        return status.contains("insufficient")
            || status.contains("근거 부족")
            || status.contains("근거가 부족")
            || status.contains("근거 품질")
            || status.contains("직접 좁")
    }

    var estimatedRemainingSeconds: Int? {
        guard !canOpenDay1, state != .connecting else { return nil }
        return max(0, Self.slowScanSeconds - (elapsedSeconds ?? 0))
    }

    init(
        bootLogState: IntakeV2BootLogState,
        hasFolder: Bool,
        hasWorkspaceScanResult: Bool,
        now: Date
    ) {
        phase = bootLogState.scanPhase
        elapsedSeconds = bootLogState.scanElapsed?.elapsedSeconds(at: now)
        blockedStatus = bootLogState.lines.last(where: { $0.command == "scan.blocked" })?.status
        self.hasWorkspaceScanResult = hasWorkspaceScanResult

        if !hasFolder {
            state = .scanMergedReady
            return
        }

        if bootLogState.scanPhase.stage == .connecting {
            state = .connecting
            return
        }

        if bootLogState.scanDidBlock {
            state = .scanBlocked
            return
        }

        if bootLogState.scanDidFail {
            state = .scanFailed
            return
        }

        if hasWorkspaceScanResult || bootLogState.scanDidComplete {
            state = .scanMergedReady
            return
        }

        let elapsed = elapsedSeconds ?? 0
        if elapsed >= Self.slowScanSeconds {
            state = .scanningSlow
        } else {
            state = .scanningNormal
        }
    }
}

struct IntakeV2BootLogElapsed: Equatable {
    enum Status: Equatable {
        case running
        case succeeded
        case failed

        var chipPrefix: String {
            switch self {
            case .running: return "진행"
            case .succeeded: return "완료"
            case .failed: return "중단"
            }
        }

        var accessibilityPrefix: String {
            switch self {
            case .running: return "스캔 진행 시간"
            case .succeeded: return "스캔 완료 시간"
            case .failed: return "스캔 중단 시간"
            }
        }
    }

    let status: Status
    let startedAt: Date
    let completedAt: Date?

    var isRunning: Bool {
        status == .running
    }

    func chipText(at now: Date) -> String {
        "\(status.chipPrefix) \(Self.compactDurationText(seconds: elapsedSeconds(at: now)))"
    }

    func accessibilityLabel(at now: Date) -> String {
        "\(status.accessibilityPrefix) \(Self.spokenDurationText(seconds: elapsedSeconds(at: now)))"
    }

    func elapsedSeconds(at now: Date) -> Int {
        let end = completedAt ?? now
        return max(0, Int(end.timeIntervalSince(startedAt)))
    }

    static func compactDurationText(seconds: Int) -> String {
        let clamped = max(0, seconds)
        let hours = clamped / 3_600
        let minutes = (clamped % 3_600) / 60
        let remainingSeconds = clamped % 60
        if hours > 0 {
            return String(format: "%d:%02d:%02d", hours, minutes, remainingSeconds)
        }
        return String(format: "%02d:%02d", minutes, remainingSeconds)
    }

    static func spokenDurationText(seconds: Int) -> String {
        let clamped = max(0, seconds)
        let hours = clamped / 3_600
        let minutes = (clamped % 3_600) / 60
        let remainingSeconds = clamped % 60
        var parts: [String] = []
        if hours > 0 {
            parts.append("\(hours)시간")
        }
        if minutes > 0 {
            parts.append("\(minutes)분")
        }
        if remainingSeconds > 0 || parts.isEmpty {
            parts.append("\(remainingSeconds)초")
        }
        return parts.joined(separator: " ")
    }
}

/// Routing classification for chat input. All three branches funnel into the
/// same `send_prompt` sidecar message — Sub-AC 2's contract is that the
/// chat is a *single* AI interaction surface, so daily-task, sub-workflow,
/// and free-chat must share one stream rather than fork the transport.
///
/// The classifier inspects the draft prefix and the selected session's
/// conversation state; consumers tag telemetry, drive provider validation,
/// and attach `mode` + `foundationDay` metadata so the sidecar runner can
/// dispatch to the correct sub-workflow prompt without a second channel.
enum ChatMessageRoute: Equatable {
    /// First user response in a Foundation Day 0/2-7 session — the AI-driven
    /// daily first prompt has been answered. Carries the 1-based foundation
    /// day so the sidecar can pick the matching `daily-task-{day}` prompt.
    case dailyTask(foundationDay: Int)

    /// Slash-command sub-workflow (`/office-hours-docs`, `/analyze-ads`,
    /// `/bip-draft`, `/monetization-ask`, `/foundation-summary`).
    case subWorkflow(SubWorkflow)

    /// Default conversational chat — no special routing.
    case freeChat

    enum SubWorkflow: String, Equatable {
        case analyzeAds = "analyze_ads"
        case bipDraft = "bip_draft"
        case officeHoursDocs = "office_hours_docs"
        case monetizationAsk = "monetization_ask"
        case foundationSummary = "foundation_summary"

        /// Slash-command prefix used in chat input. Lowercased, single token.
        var commandPrefix: String {
            switch self {
            case .analyzeAds: return "/analyze-ads"
            case .bipDraft: return "/bip-draft"
            case .officeHoursDocs: return "/office-hours-docs"
            case .monetizationAsk: return "/monetization-ask"
            case .foundationSummary: return "/foundation-summary"
            }
        }

        /// Does this sub-workflow require the Claude provider? These routes
        /// lean on Claude Agent SDK tooling or Claude-specific prompt runners;
        /// the others run on whichever provider the session is using.
        var requiresClaudeProvider: Bool {
            switch self {
            case .analyzeAds, .bipDraft, .foundationSummary: return true
            case .officeHoursDocs, .monetizationAsk: return false
            }
        }
    }

    /// Telemetry-friendly mode tag. Stable strings so PostHog dashboards
    /// don't break when new sub-workflows are added.
    var modeTag: String {
        switch self {
        case .dailyTask: return "daily_task"
        case .subWorkflow: return "sub_workflow"
        case .freeChat: return "free_chat"
        }
    }

    /// Backwards-compatible `command_kind` used by the existing
    /// `mac_prompt_send_requested` event. `dailyTask` reports as the literal
    /// `daily_task`; sub-workflows keep their snake-case identifier; free
    /// chat stays as `chat` so historical filters keep working.
    var commandKind: String {
        switch self {
        case .dailyTask: return "daily_task"
        case .subWorkflow(let workflow): return workflow.rawValue
        case .freeChat: return "chat"
        }
    }

    /// Sub-workflow name, when applicable. Used by the sidecar payload to
    /// dispatch to the right `*-prompt.mjs` module.
    var subWorkflowName: String? {
        if case .subWorkflow(let workflow) = self { return workflow.rawValue }
        return nil
    }

    /// 1-based Foundation day, when applicable. Lets the sidecar pick the
    /// matching daily first-prompt template.
    var foundationDay: Int? {
        if case .dailyTask(let day) = self { return day }
        return nil
    }
}

struct StartupQueuedAction: Identifiable {
    enum Kind {
        case prompt(String)
        case mission(compact: Bool, curriculumDay: [String: Any]?)
    }

    enum State: Equatable {
        case waiting
        case sending
        case failed(String)
    }

    let id = UUID()
    let kind: Kind
    var state: State = .waiting

    var title: String {
        switch kind {
        case .prompt:
            return "첫 메시지 대기 중"
        case .mission:
            return "오늘 실행 생성 대기 중"
        }
    }

    var summary: String {
        switch kind {
        case .prompt(let prompt):
            return prompt
        case .mission:
            return "세션이 연결되면 Day 1 기준으로 오늘 실행 후보를 만듭니다."
        }
    }
}

// MARK: - Day macro-loop progress (mirrors sidecar/day-progress-state.mjs)

enum DayStepStatus: String, Codable, Hashable {
    case done
    case active
    case pending
}

enum DayKind: String, Codable, Hashable {
    case day1
    case standard
}

/// Macro loop stages, gated by Day kind (IA: Day1=4 steps, Day2+=5 steps).
/// Mirrors DAY1_STEPS / STANDARD_STEPS in day-progress-state.mjs.
enum DayLoopSteps {
    static let day1: [String] = ["onboarding", "scan", "goal", "first_interview"]
    static let standard: [String] = ["scan", "retro", "goal", "interview", "execution"]

    static let day1HiddenFromDisplay: Set<String> = ["onboarding", "scan"]
    static let standardPreparationSteps: Set<String> = ["scan", "retro", "goal"]

    static func kind(forDay day: Int) -> DayKind { day == 1 ? .day1 : .standard }

    static func ids(forDay day: Int, kind: DayKind) -> [String] {
        kind == .day1 ? day1 : standard
    }

    static func displayIds(forDay dayNumber: Int, kind: DayKind, steps: [String: DayStepStatus]) -> [String] {
        let all = ids(forDay: dayNumber, kind: kind)
        if kind == .day1 {
            return all.filter { !day1HiddenFromDisplay.contains($0) }
        }
        return all.filter { id in
            !standardPreparationSteps.contains(id) || steps[id] != .done
        }
    }

    static func label(for stepId: String) -> String {
        switch stepId {
        case "onboarding": return "온보딩"
        case "scan": return "scan"
        case "retro": return "회고"
        case "goal": return "목표"
        case "interview": return "인터뷰"
        case "first_interview": return "첫 인터뷰"
        case "execution": return "실행"
        default: return stepId
        }
    }
}

struct DayRecord: Codable, Equatable, Hashable {
    let day: Int
    let kind: DayKind
    let steps: [String: DayStepStatus]
    let goalText: String
    let updatedAt: String

    init(
        day: Int,
        kind: DayKind,
        steps: [String: DayStepStatus],
        goalText: String = "",
        updatedAt: String = ""
    ) {
        self.day = day
        self.kind = kind
        self.steps = steps
        self.goalText = goalText
        self.updatedAt = updatedAt
    }

    /// Steps in canonical stepper order with resolved labels and statuses.
    /// Full data axis — keeps every stage (Day 1 = 4) for state + decoding parity.
    var orderedSteps: [(id: String, label: String, status: DayStepStatus)] {
        DayLoopSteps.ids(forDay: day, kind: kind).map { id in
            (id, DayLoopSteps.label(for: id), steps[id] ?? .pending)
        }
    }

    var displaySteps: [(id: String, label: String, status: DayStepStatus)] {
        DayLoopSteps.displayIds(forDay: day, kind: kind, steps: steps).map { id in
            (id, DayLoopSteps.label(for: id), steps[id] ?? .pending)
        }
    }

    var totalCount: Int { DayLoopSteps.ids(forDay: day, kind: kind).count }
    var completedCount: Int { orderedSteps.filter { $0.status == .done }.count }
    var isComplete: Bool { completedCount == totalCount }

    /// Display-scoped counts (Day-1 intro stages excluded) for the stepper + sidebar badges.
    var displayTotalCount: Int { DayLoopSteps.displayIds(forDay: day, kind: kind, steps: steps).count }
    var displayCompletedCount: Int { displaySteps.filter { $0.status == .done }.count }
    var isDisplayComplete: Bool { displayCompletedCount == displayTotalCount }
}

/// Cycle#N office-hours memory summary — attached additively to `day_progress_state`.
/// Mirrors the sidecar `summarizeOfficeHoursMemory` payload (compiledTruth + open threads
/// + the abandoned-thread / costume lines). Tolerant decode: any missing field defaults.
struct OfficeHoursMemorySummary: Codable, Equatable, Hashable {
    let compiledTruth: String?
    let openThreads: [String]
    let abandonedThreads: [String]
    /// calibration-lite read-back ("예측 적중 N/M"); empty until a forecast is graded.
    let calibrationLine: String?
    /// The still-open forecast the commitment bar offers to grade at the next cycle close;
    /// empty when there's nothing pending.
    let pendingPrediction: String?
    /// "N일째 미룸" streak — trailing gate-held deferrals; 0 when the last close was a commit.
    let consecutiveDeferrals: Int

    init(
        compiledTruth: String? = nil,
        openThreads: [String] = [],
        abandonedThreads: [String] = [],
        calibrationLine: String? = nil,
        pendingPrediction: String? = nil,
        consecutiveDeferrals: Int = 0
    ) {
        self.compiledTruth = compiledTruth
        self.openThreads = openThreads
        self.abandonedThreads = abandonedThreads
        self.calibrationLine = calibrationLine
        self.pendingPrediction = pendingPrediction
        self.consecutiveDeferrals = consecutiveDeferrals
    }

    /// Whether there's anything worth surfacing in the retro banner — cold/stub brains
    /// return an empty summary, so the banner stays hidden and screenshots stay pixel-stable.
    /// pendingPrediction is intentionally excluded: it drives the commitment bar, not the banner.
    var hasContent: Bool {
        (compiledTruth.map { !$0.isEmpty } ?? false)
            || !openThreads.isEmpty
            || !abandonedThreads.isEmpty
            || (calibrationLine.map { !$0.isEmpty } ?? false)
    }

    /// Whether there's a still-open forecast to offer for grading at cycle close.
    var hasPendingPrediction: Bool { pendingPrediction.map { !$0.isEmpty } ?? false }

    enum CodingKeys: String, CodingKey {
        case compiledTruth, openThreads, abandonedThreads, calibrationLine, pendingPrediction, consecutiveDeferrals
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        compiledTruth = try c.decodeIfPresent(String.self, forKey: .compiledTruth)
        openThreads = (try c.decodeIfPresent([String].self, forKey: .openThreads)) ?? []
        abandonedThreads = (try c.decodeIfPresent([String].self, forKey: .abandonedThreads)) ?? []
        calibrationLine = try c.decodeIfPresent(String.self, forKey: .calibrationLine)
        pendingPrediction = try c.decodeIfPresent(String.self, forKey: .pendingPrediction)
        consecutiveDeferrals = (try c.decodeIfPresent(Int.self, forKey: .consecutiveDeferrals)) ?? 0
    }
}

struct OfficeHoursHistorySummary: Codable, Equatable, Hashable {
    struct Onboarding: Codable, Equatable, Hashable {
        let focusArea: String?
        let timeBudget: String?
        let blocker: String?
        let records: String?
        let projectPath: String?
        let readSources: [String]
        let summary: String?

        enum CodingKeys: String, CodingKey {
            case focusArea, timeBudget, blocker, records, projectPath, readSources, summary
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            focusArea = try c.decodeIfPresent(String.self, forKey: .focusArea)
            timeBudget = try c.decodeIfPresent(String.self, forKey: .timeBudget)
            blocker = try c.decodeIfPresent(String.self, forKey: .blocker)
            records = try c.decodeIfPresent(String.self, forKey: .records)
            projectPath = try c.decodeIfPresent(String.self, forKey: .projectPath)
            readSources = try c.decodeIfPresent([String].self, forKey: .readSources) ?? []
            summary = try c.decodeIfPresent(String.self, forKey: .summary)
        }
    }

    struct DayRollup: Codable, Equatable, Hashable, Identifiable {
        var id: Int { day }
        let day: Int
        let summary: String
        let curriculumAnswerCount: Int
        let officeHoursTurnCount: Int
        let openCommitments: Int
        let metCommitments: Int
        let detailPath: String?
    }

    let schemaVersion: Int
    let day: Int?
    let onboarding: Onboarding?
    let dayRollup: [DayRollup]
    let curriculumAnswers: [String]
    let officeHoursTurns: [String]
    let openCommitments: [String]
    let metCommitments: [String]

    enum CodingKeys: String, CodingKey {
        case schemaVersion, day, onboarding, dayRollup
        case curriculumAnswers, officeHoursTurns, openCommitments, metCommitments
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        day = try c.decodeIfPresent(Int.self, forKey: .day)
        onboarding = try c.decodeIfPresent(Onboarding.self, forKey: .onboarding)
        dayRollup = try c.decodeIfPresent([DayRollup].self, forKey: .dayRollup) ?? []
        curriculumAnswers = try c.decodeIfPresent([String].self, forKey: .curriculumAnswers) ?? []
        officeHoursTurns = try c.decodeIfPresent([String].self, forKey: .officeHoursTurns) ?? []
        openCommitments = try c.decodeIfPresent([String].self, forKey: .openCommitments) ?? []
        metCommitments = try c.decodeIfPresent([String].self, forKey: .metCommitments) ?? []
    }
}

struct CommitmentDraft: Codable, Equatable, Hashable {
    let customer: String
    let channel: String
    let message: String
    let expectedEvidenceKind: String
    let dueDay: Int?
    let confirmedByUser: Bool

    init(
        customer: String,
        channel: String,
        message: String,
        expectedEvidenceKind: String,
        dueDay: Int? = nil,
        confirmedByUser: Bool = true
    ) {
        self.customer = customer
        self.channel = channel
        self.message = message
        self.expectedEvidenceKind = expectedEvidenceKind
        self.dueDay = dueDay
        self.confirmedByUser = confirmedByUser
    }

    var payload: [String: Any] {
        var output: [String: Any] = [
            "customer": customer,
            "channel": channel,
            "message": message,
            "expectedEvidenceKind": expectedEvidenceKind,
            "confirmedByUser": confirmedByUser,
        ]
        if let dueDay { output["dueDay"] = dueDay }
        return output
    }
}

struct CommitmentEvidence: Codable, Equatable, Hashable {
    let kind: String
    let url: String
    let note: String
    let gradedCycle: Int?
    let gradedAt: String?
}

struct CommitmentRecord: Codable, Equatable, Hashable, Identifiable {
    let id: String
    let cycle: Int
    let day: Int
    let createdAt: String
    let text: String
    let customer: String
    let channel: String
    let message: String
    let expectedEvidenceKind: String
    let dueDay: Int?
    let confirmedByUser: Bool
    let status: String
    let evidence: CommitmentEvidence?
}

typealias CustomerEvidenceItem = CommitmentRecord

struct DayGoalSnapshot: Codable, Equatable, Hashable {
    let summary: String
    let customer: String
    let problem: String
    let validationAction: String
    let source: String

    init(
        summary: String = "",
        customer: String = "",
        problem: String = "",
        validationAction: String = "",
        source: String = ""
    ) {
        self.summary = summary
        self.customer = customer
        self.problem = problem
        self.validationAction = validationAction
        self.source = source
    }
}

struct EvidenceOSDayState: Codable, Equatable, Hashable {
    let day: Int
    let state: String
    let label: String
    let tone: String
    let openDebtCount: Int
    let provenEvidenceCount: Int
    let carryForwardAction: String?

    init(
        day: Int = 0,
        state: String = "not_started",
        label: String = "시작 안 함",
        tone: String = "muted",
        openDebtCount: Int = 0,
        provenEvidenceCount: Int = 0,
        carryForwardAction: String? = nil
    ) {
        self.day = day
        self.state = state
        self.label = label
        self.tone = tone
        self.openDebtCount = openDebtCount
        self.provenEvidenceCount = provenEvidenceCount
        self.carryForwardAction = carryForwardAction
    }
}

struct EvidenceOSSummary: Codable, Equatable, Hashable {
    let schemaVersion: Int
    let currentDay: Int?
    let openDebts: [CommitmentRecord]
    let overdueDebts: [CommitmentRecord]
    let provenEvidence: [CommitmentRecord]
    let dayStates: [String: EvidenceOSDayState]

    init(
        schemaVersion: Int = 1,
        currentDay: Int? = nil,
        openDebts: [CommitmentRecord] = [],
        overdueDebts: [CommitmentRecord] = [],
        provenEvidence: [CommitmentRecord] = [],
        dayStates: [String: EvidenceOSDayState] = [:]
    ) {
        self.schemaVersion = schemaVersion
        self.currentDay = currentDay
        self.openDebts = openDebts
        self.overdueDebts = overdueDebts
        self.provenEvidence = provenEvidence
        self.dayStates = dayStates
    }

    var hasOpenDebt: Bool { !openDebts.isEmpty || !overdueDebts.isEmpty }

    enum CodingKeys: String, CodingKey {
        case schemaVersion, currentDay, openDebts, overdueDebts, provenEvidence, dayStates
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        currentDay = try c.decodeIfPresent(Int.self, forKey: .currentDay)
        openDebts = try c.decodeIfPresent([CommitmentRecord].self, forKey: .openDebts) ?? []
        overdueDebts = try c.decodeIfPresent([CommitmentRecord].self, forKey: .overdueDebts) ?? []
        provenEvidence = try c.decodeIfPresent([CommitmentRecord].self, forKey: .provenEvidence) ?? []
        dayStates = try c.decodeIfPresent([String: EvidenceOSDayState].self, forKey: .dayStates) ?? [:]
    }
}

struct RecorderPipeDefinition: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let workspaceId: String?
    let projectId: String?
    let path: String
    let name: String
    let schedule: String
    let enabled: Bool
    let kind: String
    let proofAcceptedByPipeDefinition: Bool

    private enum CodingKeys: String, CodingKey {
        case id, workspaceId, workspace_id, projectId, project_id, path, name, schedule, enabled, kind
        case pipeKind, pipe_kind, proofAcceptedByPipeDefinition, proof_accepted_by_pipe_definition
    }

    init(
        id: String,
        workspaceId: String? = nil,
        projectId: String? = nil,
        path: String,
        name: String,
        schedule: String,
        enabled: Bool,
        kind: String,
        proofAcceptedByPipeDefinition: Bool = false
    ) {
        self.id = id
        self.workspaceId = workspaceId
        self.projectId = projectId
        self.path = path
        self.name = name
        self.schedule = schedule
        self.enabled = enabled
        self.kind = kind
        self.proofAcceptedByPipeDefinition = proofAcceptedByPipeDefinition
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        workspaceId = try c.decodeIfPresent(String.self, forKey: .workspaceId)
            ?? c.decodeIfPresent(String.self, forKey: .workspace_id)
        projectId = try c.decodeIfPresent(String.self, forKey: .projectId)
            ?? c.decodeIfPresent(String.self, forKey: .project_id)
        path = try c.decodeIfPresent(String.self, forKey: .path) ?? ""
        name = try c.decodeIfPresent(String.self, forKey: .name) ?? id
        schedule = try c.decodeIfPresent(String.self, forKey: .schedule) ?? ""
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        kind = try c.decodeIfPresent(String.self, forKey: .kind)
            ?? c.decodeIfPresent(String.self, forKey: .pipeKind)
            ?? c.decodeIfPresent(String.self, forKey: .pipe_kind)
            ?? ""
        proofAcceptedByPipeDefinition = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByPipeDefinition)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_pipe_definition)
            ?? false
    }
}

struct RecorderPipeProofBoundary: Decodable, Equatable, Hashable {
    let proofAcceptedByPipeRun: Bool
    let proofLedgerWriteAllowed: Bool

    private enum CodingKeys: String, CodingKey {
        case proofAcceptedByPipeRun, proof_accepted_by_pipe_run
        case proofLedgerWriteAllowed, proof_ledger_write_allowed
    }

    init(
        proofAcceptedByPipeRun: Bool = false,
        proofLedgerWriteAllowed: Bool = false
    ) {
        self.proofAcceptedByPipeRun = proofAcceptedByPipeRun
        self.proofLedgerWriteAllowed = proofLedgerWriteAllowed
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        proofAcceptedByPipeRun = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByPipeRun)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_pipe_run)
            ?? false
        proofLedgerWriteAllowed = try c.decodeIfPresent(Bool.self, forKey: .proofLedgerWriteAllowed)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_ledger_write_allowed)
            ?? false
    }
}

struct RecorderPipeOutputManifest: Decodable, Equatable, Hashable {
    let outputKind: String
    let privacyState: String
    let proofAcceptedByPipeRun: Bool
    let proofBoundary: RecorderPipeProofBoundary?

    private enum CodingKeys: String, CodingKey {
        case outputKind, output_kind
        case privacyState, privacy_state
        case proofAcceptedByPipeRun, proof_accepted_by_pipe_run
        case proofBoundary, proof_boundary
    }

    init(
        outputKind: String = "",
        privacyState: String = "",
        proofAcceptedByPipeRun: Bool = false,
        proofBoundary: RecorderPipeProofBoundary? = nil
    ) {
        self.outputKind = outputKind
        self.privacyState = privacyState
        self.proofAcceptedByPipeRun = proofAcceptedByPipeRun
        self.proofBoundary = proofBoundary
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        outputKind = try c.decodeIfPresent(String.self, forKey: .outputKind)
            ?? c.decodeIfPresent(String.self, forKey: .output_kind)
            ?? ""
        privacyState = try c.decodeIfPresent(String.self, forKey: .privacyState)
            ?? c.decodeIfPresent(String.self, forKey: .privacy_state)
            ?? ""
        proofAcceptedByPipeRun = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByPipeRun)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_pipe_run)
            ?? false
        proofBoundary = try c.decodeIfPresent(RecorderPipeProofBoundary.self, forKey: .proofBoundary)
            ?? c.decodeIfPresent(RecorderPipeProofBoundary.self, forKey: .proof_boundary)
    }
}

struct RecorderPipeRun: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let pipeId: String
    let workspaceId: String?
    let projectId: String?
    let triggerReason: String
    let status: String
    let startedAt: String
    let endedAt: String?
    let errorMessage: String?
    let outputManifest: RecorderPipeOutputManifest?
    let proofAcceptedByPipeRun: Bool

    private enum CodingKeys: String, CodingKey {
        case id, pipeId, pipe_id, workspaceId, workspace_id, projectId, project_id
        case triggerReason, trigger_reason, status, startedAt, started_at, endedAt, ended_at
        case errorMessage, error_message, outputManifest, output_manifest
        case proofAcceptedByPipeRun, proof_accepted_by_pipe_run
    }

    init(
        id: String,
        pipeId: String,
        workspaceId: String? = nil,
        projectId: String? = nil,
        triggerReason: String,
        status: String,
        startedAt: String,
        endedAt: String? = nil,
        errorMessage: String? = nil,
        outputManifest: RecorderPipeOutputManifest? = nil,
        proofAcceptedByPipeRun: Bool = false
    ) {
        self.id = id
        self.pipeId = pipeId
        self.workspaceId = workspaceId
        self.projectId = projectId
        self.triggerReason = triggerReason
        self.status = status
        self.startedAt = startedAt
        self.endedAt = endedAt
        self.errorMessage = errorMessage
        self.outputManifest = outputManifest
        self.proofAcceptedByPipeRun = proofAcceptedByPipeRun
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        pipeId = try c.decodeIfPresent(String.self, forKey: .pipeId)
            ?? c.decodeIfPresent(String.self, forKey: .pipe_id)
            ?? ""
        workspaceId = try c.decodeIfPresent(String.self, forKey: .workspaceId)
            ?? c.decodeIfPresent(String.self, forKey: .workspace_id)
        projectId = try c.decodeIfPresent(String.self, forKey: .projectId)
            ?? c.decodeIfPresent(String.self, forKey: .project_id)
        triggerReason = try c.decodeIfPresent(String.self, forKey: .triggerReason)
            ?? c.decodeIfPresent(String.self, forKey: .trigger_reason)
            ?? ""
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? ""
        startedAt = try c.decodeIfPresent(String.self, forKey: .startedAt)
            ?? c.decodeIfPresent(String.self, forKey: .started_at)
            ?? ""
        endedAt = try c.decodeIfPresent(String.self, forKey: .endedAt)
            ?? c.decodeIfPresent(String.self, forKey: .ended_at)
        errorMessage = try c.decodeIfPresent(String.self, forKey: .errorMessage)
            ?? c.decodeIfPresent(String.self, forKey: .error_message)
        outputManifest = try c.decodeIfPresent(RecorderPipeOutputManifest.self, forKey: .outputManifest)
            ?? c.decodeIfPresent(RecorderPipeOutputManifest.self, forKey: .output_manifest)
        proofAcceptedByPipeRun = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByPipeRun)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_pipe_run)
            ?? false
    }
}

struct RecorderPipeSchedulerProofBoundary: Decodable, Equatable, Hashable {
    let proofAcceptedByScheduler: Bool
    let proofLedgerWriteAllowed: Bool
    let message: String

    private enum CodingKeys: String, CodingKey {
        case proofAcceptedByScheduler, proof_accepted_by_scheduler
        case proofLedgerWriteAllowed, proof_ledger_write_allowed
        case message
    }

    init(
        proofAcceptedByScheduler: Bool = false,
        proofLedgerWriteAllowed: Bool = false,
        message: String = ""
    ) {
        self.proofAcceptedByScheduler = proofAcceptedByScheduler
        self.proofLedgerWriteAllowed = proofLedgerWriteAllowed
        self.message = message
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        proofAcceptedByScheduler = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByScheduler)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_scheduler)
            ?? false
        proofLedgerWriteAllowed = try c.decodeIfPresent(Bool.self, forKey: .proofLedgerWriteAllowed)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_ledger_write_allowed)
            ?? false
        message = try c.decodeIfPresent(String.self, forKey: .message) ?? ""
    }
}

struct RecorderPipeSchedulerSkip: Decodable, Equatable, Hashable {
    let pipeId: String?
    let reason: String
    let activeRunId: String?
    let activeRunStatus: String?
    let readiness: RecorderCaptureReadiness?
    let proofAcceptedByScheduler: Bool

    private enum CodingKeys: String, CodingKey {
        case pipeId, pipe_id
        case reason
        case activeRunId, active_run_id
        case activeRunStatus, active_run_status
        case readiness
        case proofAcceptedByScheduler, proof_accepted_by_scheduler
    }

    init(
        pipeId: String? = nil,
        reason: String = "",
        activeRunId: String? = nil,
        activeRunStatus: String? = nil,
        readiness: RecorderCaptureReadiness? = nil,
        proofAcceptedByScheduler: Bool = false
    ) {
        self.pipeId = pipeId
        self.reason = reason
        self.activeRunId = activeRunId
        self.activeRunStatus = activeRunStatus
        self.readiness = readiness
        self.proofAcceptedByScheduler = proofAcceptedByScheduler
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        pipeId = try c.decodeIfPresent(String.self, forKey: .pipeId)
            ?? c.decodeIfPresent(String.self, forKey: .pipe_id)
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        activeRunId = try c.decodeIfPresent(String.self, forKey: .activeRunId)
            ?? c.decodeIfPresent(String.self, forKey: .active_run_id)
        activeRunStatus = try c.decodeIfPresent(String.self, forKey: .activeRunStatus)
            ?? c.decodeIfPresent(String.self, forKey: .active_run_status)
        readiness = try c.decodeIfPresent(RecorderCaptureReadiness.self, forKey: .readiness)
        proofAcceptedByScheduler = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByScheduler)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_scheduler)
            ?? false
    }
}

struct RecorderPipeSchedulerResult: Decodable, Equatable, Hashable {
    let generatedAt: String
    let queuedCount: Int
    let skippedCount: Int
    let executedCount: Int
    let failedCount: Int
    let skipped: [RecorderPipeSchedulerSkip]
    let proofAcceptedByScheduler: Bool
    let proofBoundary: RecorderPipeSchedulerProofBoundary?

    var proofLedgerWriteAllowed: Bool {
        proofBoundary?.proofLedgerWriteAllowed ?? false
    }

    private enum CodingKeys: String, CodingKey {
        case generatedAt, generated_at
        case queuedCount, queued_count, skippedCount, skipped_count
        case executedCount, executed_count, failedCount, failed_count
        case skipped
        case proofAcceptedByScheduler, proof_accepted_by_scheduler
        case proofBoundary, proof_boundary
    }

    init(
        generatedAt: String = "",
        queuedCount: Int = 0,
        skippedCount: Int = 0,
        executedCount: Int = 0,
        failedCount: Int = 0,
        skipped: [RecorderPipeSchedulerSkip] = [],
        proofAcceptedByScheduler: Bool = false,
        proofBoundary: RecorderPipeSchedulerProofBoundary? = nil
    ) {
        self.generatedAt = generatedAt
        self.queuedCount = queuedCount
        self.skippedCount = skippedCount
        self.executedCount = executedCount
        self.failedCount = failedCount
        self.skipped = skipped
        self.proofAcceptedByScheduler = proofAcceptedByScheduler
        self.proofBoundary = proofBoundary
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt)
            ?? c.decodeIfPresent(String.self, forKey: .generated_at)
            ?? ""
        queuedCount = try c.decodeIfPresent(Int.self, forKey: .queuedCount)
            ?? c.decodeIfPresent(Int.self, forKey: .queued_count)
            ?? 0
        skippedCount = try c.decodeIfPresent(Int.self, forKey: .skippedCount)
            ?? c.decodeIfPresent(Int.self, forKey: .skipped_count)
            ?? 0
        executedCount = try c.decodeIfPresent(Int.self, forKey: .executedCount)
            ?? c.decodeIfPresent(Int.self, forKey: .executed_count)
            ?? 0
        failedCount = try c.decodeIfPresent(Int.self, forKey: .failedCount)
            ?? c.decodeIfPresent(Int.self, forKey: .failed_count)
            ?? 0
        skipped = try c.decodeIfPresent([RecorderPipeSchedulerSkip].self, forKey: .skipped) ?? []
        proofAcceptedByScheduler = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByScheduler)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_scheduler)
            ?? false
        proofBoundary = try c.decodeIfPresent(RecorderPipeSchedulerProofBoundary.self, forKey: .proofBoundary)
            ?? c.decodeIfPresent(RecorderPipeSchedulerProofBoundary.self, forKey: .proof_boundary)
    }
}

struct RecorderRetentionApplyResult: Decodable, Equatable, Hashable {
    let status: String
    let reason: String?
    let deletedFrameCount: Int
    let deletedAudioChunkCount: Int
    let deletedMediaCount: Int
    let proofAcceptedByRetention: Bool
    let proofLedgerWriteAllowed: Bool

    private struct Scheduler: Decodable, Equatable, Hashable {
        let status: String?
        let reason: String?
        let deletedFrameCount: Int?
        let deletedAudioChunkCount: Int?
        let deletedMediaCount: Int?
        let proofAcceptedByRetention: Bool?
        let proofLedgerWriteAllowed: Bool?

        private enum CodingKeys: String, CodingKey {
            case status, reason
            case deletedFrameCount, deleted_frame_count
            case deletedAudioChunkCount, deleted_audio_chunk_count
            case deletedMediaCount, deleted_media_count
            case proofAcceptedByRetention, proof_accepted_by_retention
            case proofLedgerWriteAllowed, proof_ledger_write_allowed
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            status = try c.decodeIfPresent(String.self, forKey: .status)
            reason = try c.decodeIfPresent(String.self, forKey: .reason)
            deletedFrameCount = try c.decodeIfPresent(Int.self, forKey: .deletedFrameCount)
                ?? c.decodeIfPresent(Int.self, forKey: .deleted_frame_count)
            deletedAudioChunkCount = try c.decodeIfPresent(Int.self, forKey: .deletedAudioChunkCount)
                ?? c.decodeIfPresent(Int.self, forKey: .deleted_audio_chunk_count)
            deletedMediaCount = try c.decodeIfPresent(Int.self, forKey: .deletedMediaCount)
                ?? c.decodeIfPresent(Int.self, forKey: .deleted_media_count)
            proofAcceptedByRetention = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByRetention)
                ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_retention)
            proofLedgerWriteAllowed = try c.decodeIfPresent(Bool.self, forKey: .proofLedgerWriteAllowed)
                ?? c.decodeIfPresent(Bool.self, forKey: .proof_ledger_write_allowed)
        }
    }

    private enum CodingKeys: String, CodingKey {
        case scheduler
        case status, reason
        case deletedFrameCount, deleted_frame_count
        case deletedAudioChunkCount, deleted_audio_chunk_count
        case deletedMediaCount, deleted_media_count
        case proofAcceptedByRetention, proof_accepted_by_retention
        case proofLedgerWriteAllowed, proof_ledger_write_allowed
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        let scheduler = try c.decodeIfPresent(Scheduler.self, forKey: .scheduler)
        status = try c.decodeIfPresent(String.self, forKey: .status)
            ?? scheduler?.status
            ?? "unknown"
        reason = try c.decodeIfPresent(String.self, forKey: .reason)
            ?? scheduler?.reason
        deletedFrameCount = try c.decodeIfPresent(Int.self, forKey: .deletedFrameCount)
            ?? c.decodeIfPresent(Int.self, forKey: .deleted_frame_count)
            ?? scheduler?.deletedFrameCount
            ?? 0
        deletedAudioChunkCount = try c.decodeIfPresent(Int.self, forKey: .deletedAudioChunkCount)
            ?? c.decodeIfPresent(Int.self, forKey: .deleted_audio_chunk_count)
            ?? scheduler?.deletedAudioChunkCount
            ?? 0
        deletedMediaCount = try c.decodeIfPresent(Int.self, forKey: .deletedMediaCount)
            ?? c.decodeIfPresent(Int.self, forKey: .deleted_media_count)
            ?? scheduler?.deletedMediaCount
            ?? 0
        proofAcceptedByRetention = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByRetention)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_retention)
            ?? scheduler?.proofAcceptedByRetention
            ?? false
        proofLedgerWriteAllowed = try c.decodeIfPresent(Bool.self, forKey: .proofLedgerWriteAllowed)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_ledger_write_allowed)
            ?? scheduler?.proofLedgerWriteAllowed
            ?? false
    }
}

struct RecorderDayLoopSnapshot: Decodable, Equatable, Hashable {
    let persisted: Bool
    let relativePath: String?

    private enum CodingKeys: String, CodingKey {
        case persisted
        case relativePath, relative_path
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        persisted = try c.decodeIfPresent(Bool.self, forKey: .persisted) ?? false
        relativePath = try c.decodeIfPresent(String.self, forKey: .relativePath)
            ?? c.decodeIfPresent(String.self, forKey: .relative_path)
    }
}

struct RecorderEvidenceInboxSummary: Decodable, Equatable, Hashable {
    let total: Int
    let unresolvedCount: Int
    let writtenToLedgerCount: Int
    let countsByStatus: [String: Int]

    private enum CodingKeys: String, CodingKey {
        case total
        case unresolvedCount, unresolved_count
        case writtenToLedgerCount, written_to_ledger_count
        case countsByStatus, counts_by_status
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        total = try c.decodeIfPresent(Int.self, forKey: .total) ?? 0
        unresolvedCount = try c.decodeIfPresent(Int.self, forKey: .unresolvedCount)
            ?? c.decodeIfPresent(Int.self, forKey: .unresolved_count)
            ?? 0
        writtenToLedgerCount = try c.decodeIfPresent(Int.self, forKey: .writtenToLedgerCount)
            ?? c.decodeIfPresent(Int.self, forKey: .written_to_ledger_count)
            ?? 0
        countsByStatus = try c.decodeIfPresent([String: Int].self, forKey: .countsByStatus)
            ?? c.decodeIfPresent([String: Int].self, forKey: .counts_by_status)
            ?? [:]
    }
}

struct RecorderDayMemoryReviewResult: Decodable, Equatable, Hashable {
    struct Status: Decodable, Equatable, Hashable {
        let state: String
        let reason: String?
    }

    let status: Status?
    let evidenceInbox: RecorderEvidenceInboxSummary?
    let proofAcceptedByReview: Bool

    private enum CodingKeys: String, CodingKey {
        case status
        case evidenceInbox, evidence_inbox
        case proofBoundary, proof_boundary
    }
    private enum ProofBoundaryKeys: String, CodingKey {
        case proofAcceptedByReview, proof_accepted_by_review
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decodeIfPresent(Status.self, forKey: .status)
        evidenceInbox = try c.decodeIfPresent(RecorderEvidenceInboxSummary.self, forKey: .evidenceInbox)
            ?? c.decodeIfPresent(RecorderEvidenceInboxSummary.self, forKey: .evidence_inbox)
        let proof = (try? c.nestedContainer(keyedBy: ProofBoundaryKeys.self, forKey: .proofBoundary))
            ?? (try? c.nestedContainer(keyedBy: ProofBoundaryKeys.self, forKey: .proof_boundary))
        if let proof {
            proofAcceptedByReview = try proof.decodeIfPresent(Bool.self, forKey: .proofAcceptedByReview)
                ?? proof.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_review)
                ?? false
        } else {
            proofAcceptedByReview = false
        }
    }
}

struct RecorderEvidenceSourceRef: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let sourceType: String

    private enum CodingKeys: String, CodingKey {
        case id
        case sourceType, source_type
    }

    init(from decoder: Decoder) throws {
        if let value = try? decoder.singleValueContainer().decode(String.self) {
            id = value
            sourceType = ""
            return
        }
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        sourceType = try c.decodeIfPresent(String.self, forKey: .sourceType)
            ?? c.decodeIfPresent(String.self, forKey: .source_type)
            ?? ""
    }
}

private struct RecorderEvidenceProofLedgerMappingSummary: Decodable {
    let targetGate: String?

    private enum CodingKeys: String, CodingKey {
        case targetGate, target_gate
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        targetGate = try c.decodeIfPresent(String.self, forKey: .targetGate)
            ?? c.decodeIfPresent(String.self, forKey: .target_gate)
    }
}

struct RecorderEvidenceCandidateSummary: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let candidateStatus: String
    let sourceState: String
    let claim: String
    let proofKind: String
    let sourceIds: [RecorderEvidenceSourceRef]
    let evidenceDebt: [String]
    let targetGate: String?
    let proofLedgerEventId: String?
    let createdBy: String
    let createdAt: String

    private enum CodingKeys: String, CodingKey {
        case id
        case candidateStatus, candidate_status
        case sourceState, source_state
        case claim
        case proofKind, proof_kind
        case sourceIds, source_ids, source_ids_json
        case evidenceDebt, evidence_debt, evidence_debt_json
        case proofLedgerMapping, proof_ledger_mapping, proof_ledger_mapping_json
        case proofLedgerEventId, proof_ledger_event_id
        case createdBy, created_by
        case createdAt, created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        candidateStatus = try c.decodeIfPresent(String.self, forKey: .candidateStatus)
            ?? c.decodeIfPresent(String.self, forKey: .candidate_status)
            ?? ""
        sourceState = try c.decodeIfPresent(String.self, forKey: .sourceState)
            ?? c.decodeIfPresent(String.self, forKey: .source_state)
            ?? ""
        claim = try c.decodeIfPresent(String.self, forKey: .claim) ?? ""
        proofKind = try c.decodeIfPresent(String.self, forKey: .proofKind)
            ?? c.decodeIfPresent(String.self, forKey: .proof_kind)
            ?? ""
        sourceIds = try c.decodeIfPresent([RecorderEvidenceSourceRef].self, forKey: .sourceIds)
            ?? c.decodeIfPresent([RecorderEvidenceSourceRef].self, forKey: .source_ids)
            ?? Self.decodeJSONString([RecorderEvidenceSourceRef].self, try c.decodeIfPresent(String.self, forKey: .source_ids_json))
            ?? []
        evidenceDebt = try c.decodeIfPresent([String].self, forKey: .evidenceDebt)
            ?? c.decodeIfPresent([String].self, forKey: .evidence_debt)
            ?? Self.decodeJSONString([String].self, try c.decodeIfPresent(String.self, forKey: .evidence_debt_json))
            ?? []
        let mapping = try c.decodeIfPresent(RecorderEvidenceProofLedgerMappingSummary.self, forKey: .proofLedgerMapping)
            ?? c.decodeIfPresent(RecorderEvidenceProofLedgerMappingSummary.self, forKey: .proof_ledger_mapping)
            ?? Self.decodeJSONString(RecorderEvidenceProofLedgerMappingSummary.self, try c.decodeIfPresent(String.self, forKey: .proof_ledger_mapping_json))
        targetGate = mapping?.targetGate
        proofLedgerEventId = try c.decodeIfPresent(String.self, forKey: .proofLedgerEventId)
            ?? c.decodeIfPresent(String.self, forKey: .proof_ledger_event_id)
        createdBy = try c.decodeIfPresent(String.self, forKey: .createdBy)
            ?? c.decodeIfPresent(String.self, forKey: .created_by)
            ?? ""
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
            ?? c.decodeIfPresent(String.self, forKey: .created_at)
            ?? ""
    }

    private static func decodeJSONString<T: Decodable>(_ type: T.Type, _ value: String?) -> T? {
        guard let value,
              let data = value.data(using: .utf8) else {
            return nil
        }
        return try? JSONDecoder().decode(type, from: data)
    }
}

struct RecorderEvidenceCandidateReviewResult: Equatable, Hashable {
    let candidateId: String
    let candidateStatus: String
    let proofLedgerEventId: String?
    let proofAcceptedByReview: Bool
    let proofAcceptedByEvidenceCandidate: Bool
    let proofLedgerWriteAllowed: Bool

    var displayStatus: String {
        if !candidateStatus.isEmpty { return candidateStatus }
        if proofAcceptedByEvidenceCandidate { return "written_to_ledger" }
        return "reviewed"
    }

    init?(event: SidecarEvent) {
        guard event.type == "recorder_evidence_candidate_review_result" else { return nil }
        let candidate = event.recorderEvidenceCandidate
        let cleanCandidateId = (candidate?.id ?? event.recorderEvidenceCandidateId ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanLedgerEventId = (event.proofLedgerEventId ?? candidate?.proofLedgerEventId ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanCandidateStatus = (candidate?.candidateStatus ?? "")
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanCandidateId.isEmpty || !cleanLedgerEventId.isEmpty || candidate != nil else {
            return nil
        }
        candidateId = cleanCandidateId
        candidateStatus = cleanCandidateStatus
        proofLedgerEventId = cleanLedgerEventId.isEmpty ? nil : cleanLedgerEventId
        proofAcceptedByReview = event.proofAcceptedByReview ?? false
        proofAcceptedByEvidenceCandidate = event.proofAcceptedByEvidenceCandidate
            ?? (cleanCandidateStatus == "written_to_ledger" || !cleanLedgerEventId.isEmpty)
        proofLedgerWriteAllowed = event.proofLedgerWriteAllowed ?? proofAcceptedByEvidenceCandidate
    }
}

struct RecorderEvidenceBuildResult: Decodable, Equatable, Hashable {
    let createdCount: Int
    let skippedCount: Int
    let created: [RecorderEvidenceCandidateSummary]
    let proofAcceptedByBuilder: Bool

    private enum CodingKeys: String, CodingKey {
        case createdCount, created_count
        case skippedCount, skipped_count
        case created
        case proofBoundary, proof_boundary
    }
    private enum ProofBoundaryKeys: String, CodingKey {
        case proofAcceptedByBuilder, proof_accepted_by_builder
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        createdCount = try c.decodeIfPresent(Int.self, forKey: .createdCount)
            ?? c.decodeIfPresent(Int.self, forKey: .created_count)
            ?? 0
        skippedCount = try c.decodeIfPresent(Int.self, forKey: .skippedCount)
            ?? c.decodeIfPresent(Int.self, forKey: .skipped_count)
            ?? 0
        created = try c.decodeIfPresent([RecorderEvidenceCandidateSummary].self, forKey: .created) ?? []
        let proof = (try? c.nestedContainer(keyedBy: ProofBoundaryKeys.self, forKey: .proofBoundary))
            ?? (try? c.nestedContainer(keyedBy: ProofBoundaryKeys.self, forKey: .proof_boundary))
        if let proof {
            proofAcceptedByBuilder = try proof.decodeIfPresent(Bool.self, forKey: .proofAcceptedByBuilder)
                ?? proof.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_builder)
                ?? false
        } else {
            proofAcceptedByBuilder = false
        }
    }
}

struct RecorderNextActionResult: Decodable, Equatable, Hashable {
    struct Action: Decodable, Equatable, Hashable {
        let id: String
        let actionType: String
        let priority: String
        let title: String
        let instruction: String
        let reason: String
        let preferredBy: String
        let sourceIds: [String]
        let targetCandidate: RecorderEvidenceCandidateSummary?
        let proofEffect: String

        private enum CodingKeys: String, CodingKey {
            case id
            case actionType, action_type
            case priority
            case title
            case instruction
            case reason
            case preferredBy, preferred_by
            case sourceIds, source_ids
            case targetCandidate, target_candidate
            case proofEffect, proof_effect
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
            actionType = try c.decodeIfPresent(String.self, forKey: .actionType)
                ?? c.decodeIfPresent(String.self, forKey: .action_type)
                ?? ""
            priority = try c.decodeIfPresent(String.self, forKey: .priority) ?? ""
            title = try c.decodeIfPresent(String.self, forKey: .title) ?? ""
            instruction = try c.decodeIfPresent(String.self, forKey: .instruction) ?? ""
            reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
            preferredBy = try c.decodeIfPresent(String.self, forKey: .preferredBy)
                ?? c.decodeIfPresent(String.self, forKey: .preferred_by)
                ?? ""
            sourceIds = try c.decodeIfPresent([String].self, forKey: .sourceIds)
                ?? c.decodeIfPresent([String].self, forKey: .source_ids)
                ?? []
            targetCandidate = try c.decodeIfPresent(RecorderEvidenceCandidateSummary.self, forKey: .targetCandidate)
                ?? c.decodeIfPresent(RecorderEvidenceCandidateSummary.self, forKey: .target_candidate)
            proofEffect = try c.decodeIfPresent(String.self, forKey: .proofEffect)
                ?? c.decodeIfPresent(String.self, forKey: .proof_effect)
                ?? "none"
        }
    }

    let action: Action?
    let proofAcceptedByNextAction: Bool

    private enum CodingKeys: String, CodingKey {
        case action
        case proofBoundary, proof_boundary
    }
    private enum ProofBoundaryKeys: String, CodingKey {
        case proofAcceptedByNextAction, proof_accepted_by_next_action
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        action = try c.decodeIfPresent(Action.self, forKey: .action)
        let proof = (try? c.nestedContainer(keyedBy: ProofBoundaryKeys.self, forKey: .proofBoundary))
            ?? (try? c.nestedContainer(keyedBy: ProofBoundaryKeys.self, forKey: .proof_boundary))
        if let proof {
            proofAcceptedByNextAction = try proof.decodeIfPresent(Bool.self, forKey: .proofAcceptedByNextAction)
                ?? proof.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_next_action)
                ?? false
        } else {
            proofAcceptedByNextAction = false
        }
    }
}

struct RecorderDayMemoryLoopResult: Decodable, Equatable, Hashable {
    let schema: String
    let generatedAt: String
    let review: RecorderDayMemoryReviewResult?
    let evidenceBuildResult: RecorderEvidenceBuildResult?
    let nextAction: RecorderNextActionResult?
    let snapshot: RecorderDayLoopSnapshot?
    let proofAcceptedByDayLoop: Bool

    private enum CodingKeys: String, CodingKey {
        case schema
        case generatedAt, generated_at
        case review
        case evidenceBuildResult, evidence_build_result
        case nextAction, next_action
        case snapshot
        case proofBoundary, proof_boundary
    }
    private enum ProofBoundaryKeys: String, CodingKey {
        case proofAcceptedByDayLoop, proof_accepted_by_day_loop
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema = try c.decodeIfPresent(String.self, forKey: .schema) ?? ""
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt)
            ?? c.decodeIfPresent(String.self, forKey: .generated_at)
            ?? ""
        review = try c.decodeIfPresent(RecorderDayMemoryReviewResult.self, forKey: .review)
        evidenceBuildResult = try c.decodeIfPresent(RecorderEvidenceBuildResult.self, forKey: .evidenceBuildResult)
            ?? c.decodeIfPresent(RecorderEvidenceBuildResult.self, forKey: .evidence_build_result)
        nextAction = try c.decodeIfPresent(RecorderNextActionResult.self, forKey: .nextAction)
            ?? c.decodeIfPresent(RecorderNextActionResult.self, forKey: .next_action)
        snapshot = try c.decodeIfPresent(RecorderDayLoopSnapshot.self, forKey: .snapshot)
        let proof = (try? c.nestedContainer(keyedBy: ProofBoundaryKeys.self, forKey: .proofBoundary))
            ?? (try? c.nestedContainer(keyedBy: ProofBoundaryKeys.self, forKey: .proof_boundary))
        if let proof {
            proofAcceptedByDayLoop = try proof.decodeIfPresent(Bool.self, forKey: .proofAcceptedByDayLoop)
                ?? proof.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_day_loop)
                ?? false
        } else {
            proofAcceptedByDayLoop = false
        }
    }
}

struct RecorderMcpGrant: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let granted: Bool
    let toolName: String
    let accessLevels: [String]
    let grantedBy: String
    let grantedAt: String
    let expiresAt: String
    let reason: String
    let revokedAt: String?
    let state: String
    let active: Bool

    private enum CodingKeys: String, CodingKey {
        case id
        case granted
        case toolName, tool_name
        case accessLevels, access_levels
        case grantedBy, granted_by
        case grantedAt, granted_at
        case expiresAt, expires_at
        case reason
        case revokedAt, revoked_at
        case state
        case active
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        granted = try c.decodeIfPresent(Bool.self, forKey: .granted) ?? false
        toolName = try c.decodeIfPresent(String.self, forKey: .toolName)
            ?? c.decodeIfPresent(String.self, forKey: .tool_name)
            ?? ""
        accessLevels = try c.decodeIfPresent([String].self, forKey: .accessLevels)
            ?? c.decodeIfPresent([String].self, forKey: .access_levels)
            ?? []
        grantedBy = try c.decodeIfPresent(String.self, forKey: .grantedBy)
            ?? c.decodeIfPresent(String.self, forKey: .granted_by)
            ?? ""
        grantedAt = try c.decodeIfPresent(String.self, forKey: .grantedAt)
            ?? c.decodeIfPresent(String.self, forKey: .granted_at)
            ?? ""
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt)
            ?? c.decodeIfPresent(String.self, forKey: .expires_at)
            ?? ""
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        revokedAt = try c.decodeIfPresent(String.self, forKey: .revokedAt)
            ?? c.decodeIfPresent(String.self, forKey: .revoked_at)
        state = try c.decodeIfPresent(String.self, forKey: .state) ?? (granted ? "active" : "inactive")
        active = try c.decodeIfPresent(Bool.self, forKey: .active) ?? (state == "active")
    }
}

struct RecorderControlConsent: Decodable, Equatable, Hashable {
    let status: String
    let grantId: String?
    let visibleIndicatorRequired: Bool
    let visibleIndicatorAcknowledged: Bool

    private enum CodingKeys: String, CodingKey {
        case status
        case grantId, grant_id
        case visibleIndicatorRequired, visible_indicator_required
        case visibleIndicatorAcknowledged, visible_indicator_acknowledged
    }

    init(
        status: String = "not_requested",
        grantId: String? = nil,
        visibleIndicatorRequired: Bool = true,
        visibleIndicatorAcknowledged: Bool = false
    ) {
        self.status = status
        self.grantId = grantId
        self.visibleIndicatorRequired = visibleIndicatorRequired
        self.visibleIndicatorAcknowledged = visibleIndicatorAcknowledged
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "not_requested"
        grantId = try c.decodeIfPresent(String.self, forKey: .grantId)
            ?? c.decodeIfPresent(String.self, forKey: .grant_id)
        visibleIndicatorRequired = try c.decodeIfPresent(Bool.self, forKey: .visibleIndicatorRequired)
            ?? c.decodeIfPresent(Bool.self, forKey: .visible_indicator_required)
            ?? true
        visibleIndicatorAcknowledged = try c.decodeIfPresent(Bool.self, forKey: .visibleIndicatorAcknowledged)
            ?? c.decodeIfPresent(Bool.self, forKey: .visible_indicator_acknowledged)
            ?? false
    }
}

struct RecorderSensitiveCapture: Decodable, Equatable, Hashable {
    static let allowedClipboardModes: Set<String> = ["trigger_only", "content_opt_in", "blocked"]

    let clipboardMode: String
    let microphone: Bool
    let systemAudio: Bool

    private enum CodingKeys: String, CodingKey {
        case clipboardMode, clipboard_mode
        case microphone
        case systemAudio, system_audio
    }

    init(clipboardMode: String = "trigger_only", microphone: Bool = false, systemAudio: Bool = false) {
        self.clipboardMode = clipboardMode
        self.microphone = microphone
        self.systemAudio = systemAudio
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        clipboardMode = try c.decodeIfPresent(String.self, forKey: .clipboardMode)
            ?? c.decodeIfPresent(String.self, forKey: .clipboard_mode)
            ?? "trigger_only"
        microphone = try c.decodeIfPresent(Bool.self, forKey: .microphone) ?? false
        systemAudio = try c.decodeIfPresent(Bool.self, forKey: .systemAudio)
            ?? c.decodeIfPresent(Bool.self, forKey: .system_audio)
            ?? false
    }
}

struct RecorderControlState: Decodable, Equatable, Hashable {
    let mode: String
    let consent: RecorderControlConsent
    let permissions: [String: String]
    let sensitiveCapture: RecorderSensitiveCapture
    let updatedAt: String?

    private enum CodingKeys: String, CodingKey {
        case mode, consent, permissions
        case sensitiveCapture, sensitive_capture
        case updatedAt, updated_at
    }

    init(
        mode: String = "inactive",
        consent: RecorderControlConsent = RecorderControlConsent(),
        permissions: [String: String] = [:],
        sensitiveCapture: RecorderSensitiveCapture = RecorderSensitiveCapture(),
        updatedAt: String? = nil
    ) {
        self.mode = mode
        self.consent = consent
        self.permissions = permissions
        self.sensitiveCapture = sensitiveCapture
        self.updatedAt = updatedAt
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? "inactive"
        consent = try c.decodeIfPresent(RecorderControlConsent.self, forKey: .consent) ?? RecorderControlConsent()
        permissions = try c.decodeIfPresent([String: String].self, forKey: .permissions) ?? [:]
        sensitiveCapture = try c.decodeIfPresent(RecorderSensitiveCapture.self, forKey: .sensitiveCapture)
            ?? c.decodeIfPresent(RecorderSensitiveCapture.self, forKey: .sensitive_capture)
            ?? RecorderSensitiveCapture()
        updatedAt = try c.decodeIfPresent(String.self, forKey: .updatedAt)
            ?? c.decodeIfPresent(String.self, forKey: .updated_at)
    }
}

struct RecorderPermissionActorDiagnostic: Equatable, Hashable {
    let source: String
    let displayName: String
    let bundleIdentifier: String
    let bundlePath: String
    let executablePath: String
    let buildChannel: String
    let teamIdentifier: String
    let signingRequirementSummary: String
    let codeDirectoryHashSummary: String
    let translocationState: String

    var isAppTranslocated: Bool {
        translocationState == "translocated"
    }

    static let unknown = RecorderPermissionActorDiagnostic(
        source: "unknown",
        displayName: "unknown",
        bundleIdentifier: "unknown",
        bundlePath: "unknown",
        executablePath: "unknown",
        buildChannel: "unknown",
        teamIdentifier: "unknown",
        signingRequirementSummary: "unknown",
        codeDirectoryHashSummary: "unavailable",
        translocationState: "unknown"
    )
}

struct RecorderPermissionReleaseIdentityDiagnostic: Equatable, Hashable {
    let expectedBundleIdentifier: String
    let bundleIdentifier: String
    let buildChannel: String
    let teamIdentifier: String
    let signingRequirementSummary: String
    let sparklePublicKeyPresent: Bool
    let sparkleFeedURL: String
    let releasePolicyVerified: Bool
    let externalPermissionOnboardingAllowed: Bool
    let blockers: [String]

    static let unknown = RecorderPermissionReleaseIdentityDiagnostic(
        expectedBundleIdentifier: "unknown",
        bundleIdentifier: "unknown",
        buildChannel: "unknown",
        teamIdentifier: "unknown",
        signingRequirementSummary: "unknown",
        sparklePublicKeyPresent: false,
        sparkleFeedURL: "unknown",
        releasePolicyVerified: false,
        externalPermissionOnboardingAllowed: false,
        blockers: ["unknown_release_identity"]
    )
}

struct RecorderCaptureIssue: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let severity: String?
    let message: String
    let permission: String?
    let state: String?
}

struct RecorderReadinessMode: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let ready: Bool
    let state: String
    let blockers: [RecorderCaptureIssue]
    let warnings: [RecorderCaptureIssue]
}

struct RecorderReadinessModes: Decodable, Equatable, Hashable {
    let coreFrameCapture: RecorderReadinessMode?
    let eventDrivenCapture: RecorderReadinessMode?
    let ocrTextCompletion: RecorderReadinessMode?
    let sensitiveCapture: RecorderReadinessMode?

    var orderedModes: [RecorderReadinessMode] {
        [coreFrameCapture, eventDrivenCapture, ocrTextCompletion, sensitiveCapture].compactMap { $0 }
    }

    private enum CodingKeys: String, CodingKey {
        case coreFrameCapture, core_frame_capture
        case eventDrivenCapture, event_driven_capture
        case ocrTextCompletion, ocr_text_completion
        case sensitiveCapture, sensitive_capture
    }

    init(
        coreFrameCapture: RecorderReadinessMode? = nil,
        eventDrivenCapture: RecorderReadinessMode? = nil,
        ocrTextCompletion: RecorderReadinessMode? = nil,
        sensitiveCapture: RecorderReadinessMode? = nil
    ) {
        self.coreFrameCapture = coreFrameCapture
        self.eventDrivenCapture = eventDrivenCapture
        self.ocrTextCompletion = ocrTextCompletion
        self.sensitiveCapture = sensitiveCapture
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        coreFrameCapture = try c.decodeIfPresent(RecorderReadinessMode.self, forKey: .coreFrameCapture)
            ?? c.decodeIfPresent(RecorderReadinessMode.self, forKey: .core_frame_capture)
        eventDrivenCapture = try c.decodeIfPresent(RecorderReadinessMode.self, forKey: .eventDrivenCapture)
            ?? c.decodeIfPresent(RecorderReadinessMode.self, forKey: .event_driven_capture)
        ocrTextCompletion = try c.decodeIfPresent(RecorderReadinessMode.self, forKey: .ocrTextCompletion)
            ?? c.decodeIfPresent(RecorderReadinessMode.self, forKey: .ocr_text_completion)
        sensitiveCapture = try c.decodeIfPresent(RecorderReadinessMode.self, forKey: .sensitiveCapture)
            ?? c.decodeIfPresent(RecorderReadinessMode.self, forKey: .sensitive_capture)
    }
}

struct RecorderCaptureReadiness: Decodable, Equatable, Hashable {
    let canRecord: Bool
    let state: String
    let mode: String
    let blockers: [RecorderCaptureIssue]
    let warnings: [RecorderCaptureIssue]
    let visibleIndicatorRequired: Bool
    let visibleIndicatorAcknowledged: Bool
    let modeReadiness: RecorderReadinessModes?

    private enum CodingKeys: String, CodingKey {
        case canRecord, can_record
        case state, mode, blockers, warnings
        case visibleIndicatorRequired, visible_indicator_required
        case visibleIndicatorAcknowledged, visible_indicator_acknowledged
        case modeReadiness, mode_readiness
    }

    init(
        canRecord: Bool = false,
        state: String = "blocked",
        mode: String = "inactive",
        blockers: [RecorderCaptureIssue] = [],
        warnings: [RecorderCaptureIssue] = [],
        visibleIndicatorRequired: Bool = true,
        visibleIndicatorAcknowledged: Bool = false,
        modeReadiness: RecorderReadinessModes? = nil
    ) {
        self.canRecord = canRecord
        self.state = state
        self.mode = mode
        self.blockers = blockers
        self.warnings = warnings
        self.visibleIndicatorRequired = visibleIndicatorRequired
        self.visibleIndicatorAcknowledged = visibleIndicatorAcknowledged
        self.modeReadiness = modeReadiness
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        canRecord = try c.decodeIfPresent(Bool.self, forKey: .canRecord)
            ?? c.decodeIfPresent(Bool.self, forKey: .can_record)
            ?? false
        state = try c.decodeIfPresent(String.self, forKey: .state) ?? "blocked"
        mode = try c.decodeIfPresent(String.self, forKey: .mode) ?? "inactive"
        blockers = try c.decodeIfPresent([RecorderCaptureIssue].self, forKey: .blockers) ?? []
        warnings = try c.decodeIfPresent([RecorderCaptureIssue].self, forKey: .warnings) ?? []
        visibleIndicatorRequired = try c.decodeIfPresent(Bool.self, forKey: .visibleIndicatorRequired)
            ?? c.decodeIfPresent(Bool.self, forKey: .visible_indicator_required)
            ?? true
        visibleIndicatorAcknowledged = try c.decodeIfPresent(Bool.self, forKey: .visibleIndicatorAcknowledged)
            ?? c.decodeIfPresent(Bool.self, forKey: .visible_indicator_acknowledged)
            ?? false
        modeReadiness = try c.decodeIfPresent(RecorderReadinessModes.self, forKey: .modeReadiness)
            ?? c.decodeIfPresent(RecorderReadinessModes.self, forKey: .mode_readiness)
    }
}

struct RecorderFrameCaptureReceipt: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let capturedAt: String
    let monitorId: String
    let captureTrigger: String
    let appName: String?
    let windowTitle: String?
    let browserDomain: String?
    let browserUrlSearchLabel: String?
    let documentPathSearchLabel: String?
    let snapshotAssetId: String
    let snapshotSha256: String
    let contentHash: String
    let textSource: String
    let textProvenanceRootCause: String?
    let redactionStatus: String
    let privacyState: String
    let safeForSearch: Bool
    let safeForMemory: Bool
    let safeForExport: Bool
    let proofAcceptedByRecorderIngest: Bool

    private enum CodingKeys: String, CodingKey {
        case id
        case capturedAt, captured_at
        case monitorId, monitor_id
        case captureTrigger, capture_trigger
        case appName, app_name
        case windowTitle, window_title
        case browserDomain, browser_domain
        case browserUrlSearchLabel, browser_url_search_label
        case documentPathSearchLabel, document_path_search_label
        case snapshotAssetId, snapshot_asset_id
        case snapshotSha256, snapshot_sha256
        case contentHash, content_hash
        case textSource, text_source
        case textProvenanceRootCause, text_provenance_root_cause
        case redactionStatus, redaction_status
        case privacyState, privacy_state
        case safeForSearch, safe_for_search
        case safeForMemory, safe_for_memory
        case safeForExport, safe_for_export
        case proofAcceptedByRecorderIngest, proof_accepted_by_recorder_ingest
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        capturedAt = try c.decodeIfPresent(String.self, forKey: .capturedAt)
            ?? c.decodeIfPresent(String.self, forKey: .captured_at)
            ?? ""
        monitorId = try c.decodeIfPresent(String.self, forKey: .monitorId)
            ?? c.decodeIfPresent(String.self, forKey: .monitor_id)
            ?? "unknown"
        captureTrigger = try c.decodeIfPresent(String.self, forKey: .captureTrigger)
            ?? c.decodeIfPresent(String.self, forKey: .capture_trigger)
            ?? "unknown"
        appName = try c.decodeIfPresent(String.self, forKey: .appName)
            ?? c.decodeIfPresent(String.self, forKey: .app_name)
        windowTitle = try c.decodeIfPresent(String.self, forKey: .windowTitle)
            ?? c.decodeIfPresent(String.self, forKey: .window_title)
        browserDomain = try c.decodeIfPresent(String.self, forKey: .browserDomain)
            ?? c.decodeIfPresent(String.self, forKey: .browser_domain)
        browserUrlSearchLabel = try c.decodeIfPresent(String.self, forKey: .browserUrlSearchLabel)
            ?? c.decodeIfPresent(String.self, forKey: .browser_url_search_label)
        documentPathSearchLabel = try c.decodeIfPresent(String.self, forKey: .documentPathSearchLabel)
            ?? c.decodeIfPresent(String.self, forKey: .document_path_search_label)
        snapshotAssetId = try c.decodeIfPresent(String.self, forKey: .snapshotAssetId)
            ?? c.decodeIfPresent(String.self, forKey: .snapshot_asset_id)
            ?? ""
        snapshotSha256 = try c.decodeIfPresent(String.self, forKey: .snapshotSha256)
            ?? c.decodeIfPresent(String.self, forKey: .snapshot_sha256)
            ?? ""
        contentHash = try c.decodeIfPresent(String.self, forKey: .contentHash)
            ?? c.decodeIfPresent(String.self, forKey: .content_hash)
            ?? ""
        textSource = try c.decodeIfPresent(String.self, forKey: .textSource)
            ?? c.decodeIfPresent(String.self, forKey: .text_source)
            ?? "unknown"
        textProvenanceRootCause = try c.decodeIfPresent(String.self, forKey: .textProvenanceRootCause)
            ?? c.decodeIfPresent(String.self, forKey: .text_provenance_root_cause)
        redactionStatus = try c.decodeIfPresent(String.self, forKey: .redactionStatus)
            ?? c.decodeIfPresent(String.self, forKey: .redaction_status)
            ?? "unknown"
        privacyState = try c.decodeIfPresent(String.self, forKey: .privacyState)
            ?? c.decodeIfPresent(String.self, forKey: .privacy_state)
            ?? "raw_local"
        safeForSearch = try c.decodeIfPresent(Bool.self, forKey: .safeForSearch)
            ?? c.decodeIfPresent(Bool.self, forKey: .safe_for_search)
            ?? false
        safeForMemory = try c.decodeIfPresent(Bool.self, forKey: .safeForMemory)
            ?? c.decodeIfPresent(Bool.self, forKey: .safe_for_memory)
            ?? false
        safeForExport = try c.decodeIfPresent(Bool.self, forKey: .safeForExport)
            ?? c.decodeIfPresent(Bool.self, forKey: .safe_for_export)
            ?? false
        proofAcceptedByRecorderIngest = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByRecorderIngest)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_recorder_ingest)
            ?? false
    }
}

struct RecorderMediaAssetReceipt: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let assetType: String
    let sha256: String
    let byteSize: Int
    let encrypted: Bool
    let pathExposed: Bool

    private enum CodingKeys: String, CodingKey {
        case id
        case assetType, asset_type
        case sha256
        case byteSize, byte_size
        case encrypted
        case pathExposed, path_exposed
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decode(String.self, forKey: .id)
        assetType = try c.decodeIfPresent(String.self, forKey: .assetType)
            ?? c.decodeIfPresent(String.self, forKey: .asset_type)
            ?? ""
        sha256 = try c.decodeIfPresent(String.self, forKey: .sha256) ?? ""
        byteSize = try c.decodeIfPresent(Int.self, forKey: .byteSize)
            ?? c.decodeIfPresent(Int.self, forKey: .byte_size)
            ?? 0
        encrypted = try c.decodeIfPresent(Bool.self, forKey: .encrypted) ?? false
        pathExposed = try c.decodeIfPresent(Bool.self, forKey: .pathExposed)
            ?? c.decodeIfPresent(Bool.self, forKey: .path_exposed)
            ?? false
    }
}

struct RecorderFrameDeleteReceipt: Decodable, Equatable, Hashable {
    let status: String
    let frameId: String
    let mediaAssetId: String
    let mediaRemoved: Bool
    let pathExposed: Bool
    let deletedAt: String
    let proofAcceptedByRecorderDelete: Bool

    private enum CodingKeys: String, CodingKey {
        case status
        case frameId, frame_id
        case mediaAssetId, media_asset_id
        case mediaRemoved, media_removed
        case pathExposed, path_exposed
        case deletedAt, deleted_at
        case proofAcceptedByRecorderDelete, proof_accepted_by_recorder_delete
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "unknown"
        frameId = try c.decodeIfPresent(String.self, forKey: .frameId)
            ?? c.decodeIfPresent(String.self, forKey: .frame_id)
            ?? ""
        mediaAssetId = try c.decodeIfPresent(String.self, forKey: .mediaAssetId)
            ?? c.decodeIfPresent(String.self, forKey: .media_asset_id)
            ?? ""
        mediaRemoved = try c.decodeIfPresent(Bool.self, forKey: .mediaRemoved)
            ?? c.decodeIfPresent(Bool.self, forKey: .media_removed)
            ?? false
        pathExposed = try c.decodeIfPresent(Bool.self, forKey: .pathExposed)
            ?? c.decodeIfPresent(Bool.self, forKey: .path_exposed)
            ?? false
        deletedAt = try c.decodeIfPresent(String.self, forKey: .deletedAt)
            ?? c.decodeIfPresent(String.self, forKey: .deleted_at)
            ?? ""
        proofAcceptedByRecorderDelete = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByRecorderDelete)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_recorder_delete)
            ?? false
    }
}

struct RecorderFrameRangeDeleteReceipt: Decodable, Equatable, Hashable {
    let status: String
    let frameCount: Int
    let mediaRemovedCount: Int
    let frameIds: [String]
    let mediaAssetIds: [String]
    let pathExposed: Bool
    let deletedAt: String

    private enum CodingKeys: String, CodingKey {
        case status
        case frameCount, frame_count
        case mediaRemovedCount, media_removed_count
        case frameIds, frame_ids
        case mediaAssetIds, media_asset_ids
        case pathExposed, path_exposed
        case deletedAt, deleted_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "unknown"
        frameCount = try c.decodeIfPresent(Int.self, forKey: .frameCount)
            ?? c.decodeIfPresent(Int.self, forKey: .frame_count)
            ?? 0
        mediaRemovedCount = try c.decodeIfPresent(Int.self, forKey: .mediaRemovedCount)
            ?? c.decodeIfPresent(Int.self, forKey: .media_removed_count)
            ?? 0
        frameIds = try c.decodeIfPresent([String].self, forKey: .frameIds)
            ?? c.decodeIfPresent([String].self, forKey: .frame_ids)
            ?? []
        mediaAssetIds = try c.decodeIfPresent([String].self, forKey: .mediaAssetIds)
            ?? c.decodeIfPresent([String].self, forKey: .media_asset_ids)
            ?? []
        pathExposed = try c.decodeIfPresent(Bool.self, forKey: .pathExposed)
            ?? c.decodeIfPresent(Bool.self, forKey: .path_exposed)
            ?? false
        deletedAt = try c.decodeIfPresent(String.self, forKey: .deletedAt)
            ?? c.decodeIfPresent(String.self, forKey: .deleted_at)
            ?? ""
    }
}

struct RecorderRawApiStatus: Decodable, Equatable, Hashable {
    let enabled: Bool
    let host: String
    let port: Int
    let url: String
    let tokenIssuer: String
    let proofAcceptedByRawApi: Bool

    private enum CodingKeys: String, CodingKey {
        case enabled
        case host
        case port
        case url
        case tokenIssuer, token_issuer
        case proofAcceptedByRawApi, proof_accepted_by_raw_api
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        enabled = try c.decodeIfPresent(Bool.self, forKey: .enabled) ?? false
        host = try c.decodeIfPresent(String.self, forKey: .host) ?? ""
        port = try c.decodeIfPresent(Int.self, forKey: .port) ?? 0
        url = try c.decodeIfPresent(String.self, forKey: .url) ?? ""
        tokenIssuer = try c.decodeIfPresent(String.self, forKey: .tokenIssuer)
            ?? c.decodeIfPresent(String.self, forKey: .token_issuer)
            ?? ""
        proofAcceptedByRawApi = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByRawApi)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_raw_api)
            ?? false
    }
}

struct RecorderRawApiToken: Decodable, Equatable, Hashable {
    let token: String
    let tokenId: String
    let clientId: String
    let scopes: [String]
    let issuedAt: String
    let expiresAt: String

    private enum CodingKeys: String, CodingKey {
        case token
        case tokenId, token_id
        case clientId, client_id
        case scopes
        case issuedAt, issued_at
        case expiresAt, expires_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        token = try c.decodeIfPresent(String.self, forKey: .token) ?? ""
        tokenId = try c.decodeIfPresent(String.self, forKey: .tokenId)
            ?? c.decodeIfPresent(String.self, forKey: .token_id)
            ?? ""
        clientId = try c.decodeIfPresent(String.self, forKey: .clientId)
            ?? c.decodeIfPresent(String.self, forKey: .client_id)
            ?? ""
        scopes = try c.decodeIfPresent([String].self, forKey: .scopes) ?? []
        issuedAt = try c.decodeIfPresent(String.self, forKey: .issuedAt)
            ?? c.decodeIfPresent(String.self, forKey: .issued_at)
            ?? ""
        expiresAt = try c.decodeIfPresent(String.self, forKey: .expiresAt)
            ?? c.decodeIfPresent(String.self, forKey: .expires_at)
            ?? ""
    }
}

struct RecorderAuditSourceId: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let sourceType: String

    private enum CodingKeys: String, CodingKey {
        case id
        case sourceType, source_type
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        sourceType = try c.decodeIfPresent(String.self, forKey: .sourceType)
            ?? c.decodeIfPresent(String.self, forKey: .source_type)
            ?? "unknown"
    }
}

struct RecorderAuditEvent: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let requestId: String
    let actorType: String
    let actorId: String
    let workspaceId: String?
    let projectId: String?
    let endpoint: String
    let accessLevel: String
    let sourceIds: [RecorderAuditSourceId]
    let decision: String
    let reason: String
    let createdAt: String

    private enum CodingKeys: String, CodingKey {
        case id
        case requestId, request_id
        case actorType, actor_type
        case actorId, actor_id
        case workspaceId, workspace_id
        case projectId, project_id
        case endpoint
        case accessLevel, access_level
        case sourceIds, source_ids
        case decision
        case reason
        case createdAt, created_at
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        requestId = try c.decodeIfPresent(String.self, forKey: .requestId)
            ?? c.decodeIfPresent(String.self, forKey: .request_id)
            ?? ""
        actorType = try c.decodeIfPresent(String.self, forKey: .actorType)
            ?? c.decodeIfPresent(String.self, forKey: .actor_type)
            ?? ""
        actorId = try c.decodeIfPresent(String.self, forKey: .actorId)
            ?? c.decodeIfPresent(String.self, forKey: .actor_id)
            ?? ""
        workspaceId = try c.decodeIfPresent(String.self, forKey: .workspaceId)
            ?? c.decodeIfPresent(String.self, forKey: .workspace_id)
        projectId = try c.decodeIfPresent(String.self, forKey: .projectId)
            ?? c.decodeIfPresent(String.self, forKey: .project_id)
        endpoint = try c.decodeIfPresent(String.self, forKey: .endpoint) ?? ""
        accessLevel = try c.decodeIfPresent(String.self, forKey: .accessLevel)
            ?? c.decodeIfPresent(String.self, forKey: .access_level)
            ?? ""
        sourceIds = try c.decodeIfPresent([RecorderAuditSourceId].self, forKey: .sourceIds)
            ?? c.decodeIfPresent([RecorderAuditSourceId].self, forKey: .source_ids)
            ?? []
        decision = try c.decodeIfPresent(String.self, forKey: .decision) ?? ""
        reason = try c.decodeIfPresent(String.self, forKey: .reason) ?? ""
        createdAt = try c.decodeIfPresent(String.self, forKey: .createdAt)
            ?? c.decodeIfPresent(String.self, forKey: .created_at)
            ?? ""
    }
}

struct RecorderAuditSource: Decodable, Equatable, Hashable {
    let generatedAt: String
    let resultCount: Int
    let audit: [RecorderAuditEvent]
    let proofAcceptedByAuditSource: Bool

    private enum CodingKeys: String, CodingKey {
        case generatedAt, generated_at
        case resultCount, result_count
        case audit
        case proofAcceptedByAuditSource, proof_accepted_by_audit_source
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt)
            ?? c.decodeIfPresent(String.self, forKey: .generated_at)
            ?? ""
        resultCount = try c.decodeIfPresent(Int.self, forKey: .resultCount)
            ?? c.decodeIfPresent(Int.self, forKey: .result_count)
            ?? 0
        audit = try c.decodeIfPresent([RecorderAuditEvent].self, forKey: .audit) ?? []
        proofAcceptedByAuditSource = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByAuditSource)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_audit_source)
            ?? false
    }
}

struct RecorderSearchEmptyState: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let severity: String
    let message: String

    private enum CodingKeys: String, CodingKey {
        case id
        case severity
        case message
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        severity = try c.decodeIfPresent(String.self, forKey: .severity) ?? ""
        message = try c.decodeIfPresent(String.self, forKey: .message) ?? ""
    }
}

struct RecorderSearchProofBoundary: Decodable, Equatable, Hashable {
    let proofAcceptedBySearch: Bool
    let message: String

    private enum CodingKeys: String, CodingKey {
        case proofAcceptedBySearch, proof_accepted_by_search
        case message
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        proofAcceptedBySearch = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedBySearch)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_search)
            ?? false
        message = try c.decodeIfPresent(String.self, forKey: .message) ?? ""
    }
}

struct RecorderSearchResult: Decodable, Equatable, Hashable, Identifiable {
    let id: String
    let sourceType: String
    let sourceId: String
    let timestamp: String
    let title: String?
    let snippet: String
    let metadata: [String: String]

    private enum CodingKeys: String, CodingKey {
        case id
        case sourceType, source_type
        case sourceId, source_id
        case timestamp
        case title
        case snippet
        case metadata
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        id = try c.decodeIfPresent(String.self, forKey: .id) ?? ""
        sourceType = try c.decodeIfPresent(String.self, forKey: .sourceType)
            ?? c.decodeIfPresent(String.self, forKey: .source_type)
            ?? ""
        sourceId = try c.decodeIfPresent(String.self, forKey: .sourceId)
            ?? c.decodeIfPresent(String.self, forKey: .source_id)
            ?? ""
        timestamp = try c.decodeIfPresent(String.self, forKey: .timestamp) ?? ""
        title = try c.decodeIfPresent(String.self, forKey: .title)
        snippet = try c.decodeIfPresent(String.self, forKey: .snippet) ?? ""
        metadata = try c.decodeIfPresent([String: String].self, forKey: .metadata) ?? [:]
    }
}

struct RecorderSearchResultSet: Decodable, Equatable, Hashable {
    let schema: String
    let schemaVersion: Int
    let generatedAt: String
    let query: String
    let resultCount: Int
    let results: [RecorderSearchResult]
    let emptyStates: [RecorderSearchEmptyState]
    let proofBoundary: RecorderSearchProofBoundary?
    let proofAcceptedBySearch: Bool

    private enum CodingKeys: String, CodingKey {
        case schema
        case schemaVersion, schema_version
        case generatedAt, generated_at
        case query
        case resultCount, result_count
        case results
        case emptyStates, empty_states
        case proofBoundary, proof_boundary
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema = try c.decodeIfPresent(String.self, forKey: .schema) ?? ""
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion)
            ?? c.decodeIfPresent(Int.self, forKey: .schema_version)
            ?? 0
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt)
            ?? c.decodeIfPresent(String.self, forKey: .generated_at)
            ?? ""
        query = try c.decodeIfPresent(String.self, forKey: .query) ?? ""
        resultCount = try c.decodeIfPresent(Int.self, forKey: .resultCount)
            ?? c.decodeIfPresent(Int.self, forKey: .result_count)
            ?? 0
        results = try c.decodeIfPresent([RecorderSearchResult].self, forKey: .results) ?? []
        emptyStates = try c.decodeIfPresent([RecorderSearchEmptyState].self, forKey: .emptyStates)
            ?? c.decodeIfPresent([RecorderSearchEmptyState].self, forKey: .empty_states)
            ?? []
        proofBoundary = try c.decodeIfPresent(RecorderSearchProofBoundary.self, forKey: .proofBoundary)
            ?? c.decodeIfPresent(RecorderSearchProofBoundary.self, forKey: .proof_boundary)
        proofAcceptedBySearch = proofBoundary?.proofAcceptedBySearch ?? false
    }
}

struct RecorderSqlCell: Decodable, Equatable, Hashable {
    let displayValue: String
    let isNull: Bool

    init(displayValue: String, isNull: Bool = false) {
        self.displayValue = displayValue
        self.isNull = isNull
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            displayValue = "null"
            isNull = true
        } else if let value = try? container.decode(Bool.self) {
            displayValue = value ? "true" : "false"
            isNull = false
        } else if let value = try? container.decode(Int.self) {
            displayValue = String(value)
            isNull = false
        } else if let value = try? container.decode(Double.self) {
            displayValue = String(value)
            isNull = false
        } else {
            displayValue = (try? container.decode(String.self)) ?? ""
            isNull = false
        }
    }
}

struct RecorderSqlQueryResult: Decodable, Equatable, Hashable {
    let schema: String
    let generatedAt: String
    let queryFingerprint: String
    let allowedViews: [String]
    let rowCount: Int
    let truncated: Bool
    let limit: Int?
    let timeoutMs: Int
    let includeRawColumns: Bool
    let pathExposed: Bool
    let rows: [[String: RecorderSqlCell]]
    let safeForSearch: Bool
    let safeForMemory: Bool
    let safeForExport: Bool
    let providerPromptAllowed: Bool
    let pipeOutputAllowed: Bool
    let dayProgressWriteAllowed: Bool
    let proofAcceptedByRawSql: Bool
    let proofAcceptedByRawApi: Bool
    let proofLedgerWriteAllowed: Bool

    private enum CodingKeys: String, CodingKey {
        case schema
        case generatedAt, generated_at
        case queryFingerprint, query_fingerprint
        case allowedViews, allowed_views
        case rowCount, row_count
        case truncated
        case limit
        case timeoutMs, timeout_ms
        case includeRawColumns, include_raw_columns
        case pathExposed, path_exposed
        case rows
        case safeForSearch, safe_for_search
        case safeForMemory, safe_for_memory
        case safeForExport, safe_for_export
        case providerPromptAllowed, provider_prompt_allowed
        case pipeOutputAllowed, pipe_output_allowed
        case dayProgressWriteAllowed, day_progress_write_allowed
        case proofAcceptedByRawSql, proof_accepted_by_raw_sql
        case proofAcceptedByRawApi, proof_accepted_by_raw_api
        case proofLedgerWriteAllowed, proof_ledger_write_allowed
    }

    init(
        schema: String = "",
        generatedAt: String = "",
        queryFingerprint: String = "",
        allowedViews: [String] = [],
        rowCount: Int = 0,
        truncated: Bool = false,
        limit: Int? = nil,
        timeoutMs: Int = 0,
        includeRawColumns: Bool = false,
        pathExposed: Bool = false,
        rows: [[String: RecorderSqlCell]] = [],
        safeForSearch: Bool = false,
        safeForMemory: Bool = false,
        safeForExport: Bool = false,
        providerPromptAllowed: Bool = false,
        pipeOutputAllowed: Bool = false,
        dayProgressWriteAllowed: Bool = false,
        proofAcceptedByRawSql: Bool = false,
        proofAcceptedByRawApi: Bool = false,
        proofLedgerWriteAllowed: Bool = false
    ) {
        self.schema = schema
        self.generatedAt = generatedAt
        self.queryFingerprint = queryFingerprint
        self.allowedViews = allowedViews
        self.rowCount = rowCount
        self.truncated = truncated
        self.limit = limit
        self.timeoutMs = timeoutMs
        self.includeRawColumns = includeRawColumns
        self.pathExposed = pathExposed
        self.rows = rows
        self.safeForSearch = safeForSearch
        self.safeForMemory = safeForMemory
        self.safeForExport = safeForExport
        self.providerPromptAllowed = providerPromptAllowed
        self.pipeOutputAllowed = pipeOutputAllowed
        self.dayProgressWriteAllowed = dayProgressWriteAllowed
        self.proofAcceptedByRawSql = proofAcceptedByRawSql
        self.proofAcceptedByRawApi = proofAcceptedByRawApi
        self.proofLedgerWriteAllowed = proofLedgerWriteAllowed
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schema = try c.decodeIfPresent(String.self, forKey: .schema) ?? ""
        generatedAt = try c.decodeIfPresent(String.self, forKey: .generatedAt)
            ?? c.decodeIfPresent(String.self, forKey: .generated_at)
            ?? ""
        queryFingerprint = try c.decodeIfPresent(String.self, forKey: .queryFingerprint)
            ?? c.decodeIfPresent(String.self, forKey: .query_fingerprint)
            ?? ""
        allowedViews = try c.decodeIfPresent([String].self, forKey: .allowedViews)
            ?? c.decodeIfPresent([String].self, forKey: .allowed_views)
            ?? []
        rowCount = try c.decodeIfPresent(Int.self, forKey: .rowCount)
            ?? c.decodeIfPresent(Int.self, forKey: .row_count)
            ?? 0
        truncated = try c.decodeIfPresent(Bool.self, forKey: .truncated) ?? false
        limit = try c.decodeIfPresent(Int.self, forKey: .limit)
        timeoutMs = try c.decodeIfPresent(Int.self, forKey: .timeoutMs)
            ?? c.decodeIfPresent(Int.self, forKey: .timeout_ms)
            ?? 0
        includeRawColumns = try c.decodeIfPresent(Bool.self, forKey: .includeRawColumns)
            ?? c.decodeIfPresent(Bool.self, forKey: .include_raw_columns)
            ?? false
        pathExposed = try c.decodeIfPresent(Bool.self, forKey: .pathExposed)
            ?? c.decodeIfPresent(Bool.self, forKey: .path_exposed)
            ?? false
        rows = try c.decodeIfPresent([[String: RecorderSqlCell]].self, forKey: .rows) ?? []
        safeForSearch = try c.decodeIfPresent(Bool.self, forKey: .safeForSearch)
            ?? c.decodeIfPresent(Bool.self, forKey: .safe_for_search)
            ?? false
        safeForMemory = try c.decodeIfPresent(Bool.self, forKey: .safeForMemory)
            ?? c.decodeIfPresent(Bool.self, forKey: .safe_for_memory)
            ?? false
        safeForExport = try c.decodeIfPresent(Bool.self, forKey: .safeForExport)
            ?? c.decodeIfPresent(Bool.self, forKey: .safe_for_export)
            ?? false
        providerPromptAllowed = try c.decodeIfPresent(Bool.self, forKey: .providerPromptAllowed)
            ?? c.decodeIfPresent(Bool.self, forKey: .provider_prompt_allowed)
            ?? false
        pipeOutputAllowed = try c.decodeIfPresent(Bool.self, forKey: .pipeOutputAllowed)
            ?? c.decodeIfPresent(Bool.self, forKey: .pipe_output_allowed)
            ?? false
        dayProgressWriteAllowed = try c.decodeIfPresent(Bool.self, forKey: .dayProgressWriteAllowed)
            ?? c.decodeIfPresent(Bool.self, forKey: .day_progress_write_allowed)
            ?? false
        proofAcceptedByRawSql = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByRawSql)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_raw_sql)
            ?? false
        proofAcceptedByRawApi = try c.decodeIfPresent(Bool.self, forKey: .proofAcceptedByRawApi)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_accepted_by_raw_api)
            ?? false
        proofLedgerWriteAllowed = try c.decodeIfPresent(Bool.self, forKey: .proofLedgerWriteAllowed)
            ?? c.decodeIfPresent(Bool.self, forKey: .proof_ledger_write_allowed)
            ?? false
    }
}

private struct RecorderSqlQueryResponse: Decodable {
    let sql: RecorderSqlQueryResult
}

private struct RecorderSearchResponse: Decodable {
    let search: RecorderSearchResultSet?

    init(from decoder: Decoder) throws {
        if let wrapped = try? decoder.container(keyedBy: CodingKeys.self),
           let search = try wrapped.decodeIfPresent(RecorderSearchResultSet.self, forKey: .search) {
            self.search = search
            return
        }
        self.search = try RecorderSearchResultSet(from: decoder)
    }

    private enum CodingKeys: String, CodingKey {
        case search
    }
}

private struct RecorderRawApiErrorResponse: Decodable {
    struct ErrorBody: Decodable {
        let code: String?
        let message: String?
    }

    let error: ErrorBody?
}

struct RecorderFrameImagePreview: Equatable, Hashable, Identifiable {
    let id: String
    let frameId: String
    let mediaAssetId: String
    let auditId: String
    let fetchedAt: String
    let data: Data
    let pathExposed: Bool
    let proofAcceptedByRawApi: Bool
}

struct DayReviewWorkArea: Codable, Equatable, Hashable, Identifiable {
    var id: String { name }
    let name: String
    let aiMinutes: Int
    let commitCount: Int
    let paths: [String]
}

struct DayReviewWorkSummary: Codable, Equatable, Hashable {
    let available: Bool
    let date: String
    let aiMinutes: Int
    let commitCount: Int
    let referenceEventCount: Int
    let hasWork: Bool
    let areas: [DayReviewWorkArea]
}

struct DayReview: Codable, Equatable, Hashable {
    let schemaVersion: Int
    let day: Int
    let status: String
    let verdictLabel: String
    let verdictTone: String
    let summary: String
    let customerEvidence: [CustomerEvidenceItem]
    let commitments: [CommitmentRecord]
    let nextCommitment: CommitmentRecord?
    let missing: [String]
    let goalSnapshot: DayGoalSnapshot?
    let missingReasons: [String]
    let carryForwardAction: String?
    let evidenceDebts: [CommitmentRecord]
    let work: DayReviewWorkSummary?

    enum CodingKeys: String, CodingKey {
        case schemaVersion, day, status, verdictLabel, verdictTone, summary
        case customerEvidence, commitments, nextCommitment, missing
        case goalSnapshot, missingReasons, carryForwardAction, evidenceDebts
        case work
    }

    init(
        schemaVersion: Int = 1,
        day: Int,
        status: String,
        verdictLabel: String,
        verdictTone: String,
        summary: String,
        customerEvidence: [CustomerEvidenceItem] = [],
        commitments: [CommitmentRecord] = [],
        nextCommitment: CommitmentRecord? = nil,
        missing: [String] = [],
        goalSnapshot: DayGoalSnapshot? = nil,
        missingReasons: [String] = [],
        carryForwardAction: String? = nil,
        evidenceDebts: [CommitmentRecord] = [],
        work: DayReviewWorkSummary? = nil
    ) {
        self.schemaVersion = schemaVersion
        self.day = day
        self.status = status
        self.verdictLabel = verdictLabel
        self.verdictTone = verdictTone
        self.summary = summary
        self.customerEvidence = customerEvidence
        self.commitments = commitments
        self.nextCommitment = nextCommitment
        self.missing = missing
        self.goalSnapshot = goalSnapshot
        self.missingReasons = missingReasons
        self.carryForwardAction = carryForwardAction
        self.evidenceDebts = evidenceDebts
        self.work = work
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion) ?? 1
        day = try c.decodeIfPresent(Int.self, forKey: .day) ?? 0
        status = try c.decodeIfPresent(String.self, forKey: .status) ?? "customer_evidence_missing"
        verdictLabel = try c.decodeIfPresent(String.self, forKey: .verdictLabel) ?? "고객 증거 미기록"
        verdictTone = try c.decodeIfPresent(String.self, forKey: .verdictTone) ?? "muted"
        summary = try c.decodeIfPresent(String.self, forKey: .summary) ?? ""
        customerEvidence = try c.decodeIfPresent([CustomerEvidenceItem].self, forKey: .customerEvidence) ?? []
        commitments = try c.decodeIfPresent([CommitmentRecord].self, forKey: .commitments) ?? []
        nextCommitment = try c.decodeIfPresent(CommitmentRecord.self, forKey: .nextCommitment)
        missing = try c.decodeIfPresent([String].self, forKey: .missing) ?? []
        goalSnapshot = try c.decodeIfPresent(DayGoalSnapshot.self, forKey: .goalSnapshot)
        missingReasons = try c.decodeIfPresent([String].self, forKey: .missingReasons) ?? []
        carryForwardAction = try c.decodeIfPresent(String.self, forKey: .carryForwardAction)
        evidenceDebts = try c.decodeIfPresent([CommitmentRecord].self, forKey: .evidenceDebts) ?? []
        work = try c.decodeIfPresent(DayReviewWorkSummary.self, forKey: .work)
    }
}

struct DayProgress: Codable, Equatable, Hashable {
    let schemaVersion: Int
    let schema: String?
    let challengeStartedAt: String?
    let days: [String: DayRecord]

    init(
        schemaVersion: Int = 1,
        schema: String? = "agentic30.day_progress.v1",
        challengeStartedAt: String? = nil,
        days: [String: DayRecord] = [:]
    ) {
        self.schemaVersion = schemaVersion
        self.schema = schema
        self.challengeStartedAt = challengeStartedAt
        self.days = days
    }

    nonisolated func record(forDay day: Int) -> DayRecord? { days[String(day)] }

    nonisolated func hasCompletedProgramDay(_ day: Int) -> Bool {
        guard day >= 1,
              let record = record(forDay: day) else {
            return false
        }
        let requiredStep = day == 1 ? "first_interview" : "interview"
        return record.steps[requiredStep] == .done
    }

    /// Today's record, or a synthesized all-pending default so the macro stepper and
    /// Day breadcrumb stay consistent with the sidebar's tolerant rendering before any
    /// activity exists for the day (sidecar only writes a record on scan/goal patch).
    func recordOrDefault(forDay day: Int) -> DayRecord {
        if let record = record(forDay: day) { return record }
        let kind = DayLoopSteps.kind(forDay: day)
        var steps: [String: DayStepStatus] = [:]
        for id in DayLoopSteps.ids(forDay: day, kind: kind) { steps[id] = .pending }
        return DayRecord(day: day, kind: kind, steps: steps)
    }

    /// Recorded days, newest first (past + today). Skipped days have no record.
    var recordedDaysDescending: [DayRecord] {
        days.values.sorted { $0.day > $1.day }
    }

    func officeHoursWorkedDay(now: Date = Date()) -> Int {
        let records = days.values.sorted { $0.day < $1.day }
        guard !records.isEmpty else { return 1 }

        var maxDoneDay = 0
        for record in records {
            let stepID = record.day == 1 ? "first_interview" : "interview"
            if record.steps[stepID] == .done {
                maxDoneDay = max(maxDoneDay, record.day)
                continue
            }
            return max(1, record.day)
        }
        return max(1, min(maxDoneDay + 1, 400))
    }

    /// Elapsed-days-from-start + 1, on local calendar dates.
    /// Mirrors computeDayNumber() in day-progress-state.mjs.
    func currentDayNumber(now: Date = Date()) -> Int? {
        guard let start = Self.parseLocalDate(challengeStartedAt) else { return nil }
        let cal = Calendar.current
        let startDay = cal.startOfDay(for: start)
        let today = cal.startOfDay(for: now)
        let diff = cal.dateComponents([.day], from: startDay, to: today).day ?? 0
        return diff >= 0 ? diff + 1 : 1
    }

    private static func parseLocalDate(_ value: String?) -> Date? {
        guard let value, value.count >= 10 else { return nil }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        return formatter.date(from: String(value.prefix(10)))
    }
}

enum Day1GoalType: String, Codable, CaseIterable, Hashable {
    // Declaration order drives the goal-card order (drafts = allCases.map),
    // arranged easy → hard.
    case buildProduct = "build_product"
    case getUsers = "get_users"
    case makeMoney = "make_money"

    var title: String {
        switch self {
        case .makeMoney: return "첫 매출 달성"
        case .getUsers: return "활성 사용자 100명 모으기"
        case .buildProduct: return "작동하는 첫 버전 출시"
        }
    }

    var promptHint: String {
        switch self {
        case .makeMoney:
            return "**돈이 실제로 움직일 조건**을 확인합니다."
        case .getUsers:
            return "ICP가 **핵심 활성 행동을 끝냈는지** 확인합니다."
        case .buildProduct:
            return "사용자가 **핵심 흐름을 끝까지 완료하는지** 확인합니다."
        }
    }
}

enum Day1ProofSink: String, Codable, Hashable {
    case local
    case bipOptional = "bip_optional"
}

struct OfficeHoursDayClosePolicy: Codable, Equatable, Hashable {
    struct MandatoryBip: Codable, Equatable, Hashable {
        let state: String?
        let currentProofSink: Day1ProofSink?
        let allowedProofSinks: [Day1ProofSink]
        let autoPosting: Bool?
        let userApprovalRequired: Bool?

        private enum CodingKeys: String, CodingKey {
            case state, currentProofSink, allowedProofSinks, autoPosting, userApprovalRequired
        }

        init(
            state: String? = nil,
            currentProofSink: Day1ProofSink? = nil,
            allowedProofSinks: [Day1ProofSink] = [],
            autoPosting: Bool? = nil,
            userApprovalRequired: Bool? = nil
        ) {
            self.state = state
            self.currentProofSink = currentProofSink
            self.allowedProofSinks = allowedProofSinks
            self.autoPosting = autoPosting
            self.userApprovalRequired = userApprovalRequired
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            state = try c.decodeIfPresent(String.self, forKey: .state)
            currentProofSink = try c.decodeIfPresent(Day1ProofSink.self, forKey: .currentProofSink)
            allowedProofSinks = try c.decodeIfPresent([Day1ProofSink].self, forKey: .allowedProofSinks) ?? []
            autoPosting = try c.decodeIfPresent(Bool.self, forKey: .autoPosting)
            userApprovalRequired = try c.decodeIfPresent(Bool.self, forKey: .userApprovalRequired)
        }
    }

    struct BipResearchCandidatePolicy: Codable, Equatable, Hashable {
        let state: String?
        let readyCacheRequired: Bool?
        let cachePath: String?
        let candidateCount: Int?
        let candidateTitles: [String]
        let fallbackAction: String?

        private enum CodingKeys: String, CodingKey {
            case state, readyCacheRequired, cachePath, candidateCount, candidateTitles, fallbackAction
        }

        init(
            state: String? = nil,
            readyCacheRequired: Bool? = nil,
            cachePath: String? = nil,
            candidateCount: Int? = nil,
            candidateTitles: [String] = [],
            fallbackAction: String? = nil
        ) {
            self.state = state
            self.readyCacheRequired = readyCacheRequired
            self.cachePath = cachePath
            self.candidateCount = candidateCount
            self.candidateTitles = candidateTitles
            self.fallbackAction = fallbackAction
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            state = try c.decodeIfPresent(String.self, forKey: .state)
            readyCacheRequired = try c.decodeIfPresent(Bool.self, forKey: .readyCacheRequired)
            cachePath = try c.decodeIfPresent(String.self, forKey: .cachePath)
            candidateCount = try c.decodeIfPresent(Int.self, forKey: .candidateCount)
            candidateTitles = try c.decodeIfPresent([String].self, forKey: .candidateTitles) ?? []
            fallbackAction = try c.decodeIfPresent(String.self, forKey: .fallbackAction)
        }
    }

    struct EvidenceSourcePolicy: Codable, Equatable, Hashable {
        let externalSourcesFailClosed: Bool?
        let unavailableSources: [String]
        let marketRadarCardsAvailable: Bool?

        private enum CodingKeys: String, CodingKey {
            case externalSourcesFailClosed, unavailableSources, marketRadarCardsAvailable
        }

        init(
            externalSourcesFailClosed: Bool? = nil,
            unavailableSources: [String] = [],
            marketRadarCardsAvailable: Bool? = nil
        ) {
            self.externalSourcesFailClosed = externalSourcesFailClosed
            self.unavailableSources = unavailableSources
            self.marketRadarCardsAvailable = marketRadarCardsAvailable
        }

        init(from decoder: Decoder) throws {
            let c = try decoder.container(keyedBy: CodingKeys.self)
            externalSourcesFailClosed = try c.decodeIfPresent(Bool.self, forKey: .externalSourcesFailClosed)
            unavailableSources = try c.decodeIfPresent([String].self, forKey: .unavailableSources) ?? []
            marketRadarCardsAvailable = try c.decodeIfPresent(Bool.self, forKey: .marketRadarCardsAvailable)
        }
    }

    let schemaVersion: Int?
    let role: String?
    let definition: String?
    let closeTypes: [String]
    let mandatoryBip: MandatoryBip
    let bipResearchCandidatePolicy: BipResearchCandidatePolicy
    let evidenceSourcePolicy: EvidenceSourcePolicy

    private enum CodingKeys: String, CodingKey {
        case schemaVersion, role, definition, closeTypes
        case mandatoryBip, bipResearchCandidatePolicy, evidenceSourcePolicy
    }

    init(
        schemaVersion: Int? = nil,
        role: String? = nil,
        definition: String? = nil,
        closeTypes: [String] = [],
        mandatoryBip: MandatoryBip = MandatoryBip(),
        bipResearchCandidatePolicy: BipResearchCandidatePolicy = BipResearchCandidatePolicy(),
        evidenceSourcePolicy: EvidenceSourcePolicy = EvidenceSourcePolicy()
    ) {
        self.schemaVersion = schemaVersion
        self.role = role
        self.definition = definition
        self.closeTypes = closeTypes
        self.mandatoryBip = mandatoryBip
        self.bipResearchCandidatePolicy = bipResearchCandidatePolicy
        self.evidenceSourcePolicy = evidenceSourcePolicy
    }

    init(from decoder: Decoder) throws {
        let c = try decoder.container(keyedBy: CodingKeys.self)
        schemaVersion = try c.decodeIfPresent(Int.self, forKey: .schemaVersion)
        role = try c.decodeIfPresent(String.self, forKey: .role)
        definition = try c.decodeIfPresent(String.self, forKey: .definition)
        closeTypes = try c.decodeIfPresent([String].self, forKey: .closeTypes) ?? []
        mandatoryBip = try c.decodeIfPresent(MandatoryBip.self, forKey: .mandatoryBip)
            ?? MandatoryBip()
        bipResearchCandidatePolicy = try c.decodeIfPresent(BipResearchCandidatePolicy.self, forKey: .bipResearchCandidatePolicy)
            ?? BipResearchCandidatePolicy()
        evidenceSourcePolicy = try c.decodeIfPresent(EvidenceSourcePolicy.self, forKey: .evidenceSourcePolicy)
            ?? EvidenceSourcePolicy()
    }
}

struct Day1GoalSelection: Codable, Equatable, Hashable {
    let schemaVersion: Int
    let schema: String?
    let goalType: Day1GoalType
    let goalText: String
    let customer: String
    let problem: String
    let validationAction: String
    let evidenceRefs: [String]
    let proofSink: Day1ProofSink
    let sourcePlanFingerprint: String
    let selectedAt: String

    init(
        schemaVersion: Int = 1,
        schema: String? = "agentic30.day1_goal.v1",
        goalType: Day1GoalType,
        goalText: String,
        customer: String,
        problem: String,
        validationAction: String,
        evidenceRefs: [String],
        proofSink: Day1ProofSink,
        sourcePlanFingerprint: String,
        selectedAt: String
    ) {
        self.schemaVersion = schemaVersion
        self.schema = schema
        self.goalType = goalType
        self.goalText = goalText.trimmingCharacters(in: .whitespacesAndNewlines)
        self.customer = customer.trimmingCharacters(in: .whitespacesAndNewlines)
        self.problem = problem.trimmingCharacters(in: .whitespacesAndNewlines)
        self.validationAction = validationAction.trimmingCharacters(in: .whitespacesAndNewlines)
        self.evidenceRefs = evidenceRefs
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
        self.proofSink = proofSink
        self.sourcePlanFingerprint = sourcePlanFingerprint
        self.selectedAt = selectedAt
    }

    var bridgePayload: [String: Any] {
        [
            "schemaVersion": schemaVersion,
            "schema": schema ?? "agentic30.day1_goal.v1",
            "goalType": goalType.rawValue,
            "goalText": goalText,
            "customer": customer,
            "problem": problem,
            "validationAction": validationAction,
            "evidenceRefs": evidenceRefs,
            "proofSink": proofSink.rawValue,
            "sourcePlanFingerprint": sourcePlanFingerprint,
            "selectedAt": selectedAt,
        ]
    }

    var officeHoursPurposeLine: String {
        "\(goalType.title) · \(Self.goalTypeSummary(goalType))"
    }

    var officeHoursProgressLine: String {
        "\(Self.customerSummary(customer)) · \(Self.problemSummary(problem))"
    }

    var officeHoursOutputLine: String {
        switch proofSink {
        case .bipOptional:
            return "공개 기록 저장 선택 가능 · 승인 전 게시/문서 없음"
        case .local:
            return "로컬 증거만 유지 · 승인 전 게시/문서 없음"
        }
    }

    private static func goalTypeSummary(_ goalType: Day1GoalType) -> String {
        switch goalType {
        case .makeMoney:
            return "지불 의향 검증"
        case .getUsers:
            return "활성 행동 기준 검증"
        case .buildProduct:
            return "제품 흐름 검증"
        }
    }

    private static func customerSummary(_ value: String) -> String {
        let text = normalizedDisplayText(value)
        let separators = [" 중 \"", " 중 “"]
        let withoutProblemClause = separators.reduce(text) { current, separator in
            guard let range = current.range(of: separator) else { return current }
            return String(current[..<range.lowerBound])
        }
        return conciseDisplayText(withoutProblemClause.trimmingCharacters(in: .whitespacesAndNewlines), maxLength: 48)
    }

    private static func problemSummary(_ value: String) -> String {
        let text = normalizedDisplayText(value)
        let lower = text.lowercased()
        if lower.contains("무엇을 팔아야")
            || lower.contains("누구에게 팔아야")
            || lower.contains("사람을 데려와야")
            || lower.contains("오늘 무엇을 검증") {
            return "팔 대상·유입·검증 기준 불명확"
        }
        return conciseDisplayText(text, maxLength: 56)
    }

    private static func normalizedDisplayText(_ value: String) -> String {
        value
            .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .replacingOccurrences(of: #"[.。．]+$"#, with: "", options: .regularExpression)
    }

    private static func conciseDisplayText(_ value: String, maxLength: Int) -> String {
        let text = normalizedDisplayText(value)
        guard text.count > maxLength else { return text }
        let cutIndex = text.index(text.startIndex, offsetBy: max(0, maxLength - 1))
        let truncated = String(text[..<cutIndex]).trimmingCharacters(in: .whitespacesAndNewlines)
        return "\(truncated)…"
    }
}

struct Day1GoalDraft: Identifiable, Hashable {
    let goalType: Day1GoalType
    let goalText: String
    let customer: String
    let problem: String
    let validationAction: String
    let evidenceRefs: [String]
    let proofSink: Day1ProofSink
    let sourcePlanFingerprint: String
    let isRecommended: Bool
    /// Style-aware dynamic emphasis spans for the detail rows (Stage 2). When
    /// empty, the rows render with the legacy static styling (plain row, or
    /// `strong` for the goal row), preserving the historical look.
    var customerEmphasis: [EmphasisSpan] = []
    var problemEmphasis: [EmphasisSpan] = []

    var id: String { goalType.rawValue }

    var proofSinkLabel: String {
        switch proofSink {
        case .local:
            return "로컬 저장"
        case .bipOptional:
            return "증거 저장 가능"
        }
    }

    func makeSelection(selectedAt: Date = Date()) -> Day1GoalSelection {
        Day1GoalSelection(
            goalType: goalType,
            goalText: goalText,
            customer: customer,
            problem: problem,
            validationAction: validationAction,
            evidenceRefs: evidenceRefs,
            proofSink: proofSink,
            sourcePlanFingerprint: sourcePlanFingerprint,
            selectedAt: ISO8601DateFormatter().string(from: selectedAt)
        )
    }
}

@MainActor
final class AgenticViewModel: ObservableObject {
    private static let macOnboardingIntroCompletedDefaultsKey = "agentic30.macOnboardingIntroCompleted"
    private static let macOnboardingIntakeOnlyCompletedDefaultsKey = "agentic30.macOnboardingIntakeOnlyCompleted"
    nonisolated static let selectedProviderDefaultsKey = "agentic30.selectedProvider"

    @Published private(set) var sessions: [ChatSession] = []
    @Published var selectedSessionID: String?
    @Published var selectedProvider: AgentProvider = AgenticViewModel.loadSelectedProvider() {
        didSet {
            Self.saveSelectedProvider(selectedProvider)
            guard oldValue != selectedProvider else { return }
            // MCP OAuth 토큰은 프로바이더(Claude/Codex)별 캐시 — 이전 프로바이더로
            // 실증한 "MCP 연결" 결과 배지는 새 프로바이더에서는 유효하지 않다.
            // stale 배지를 비우고 새 프로바이더 기준으로 연동 상태를 다시 그린다.
            mcpOauthResults.removeAll()
            if isConnected { refreshIntegrationStatus() }
        }
    }
    @Published var draft = ""
    @Published private(set) var environment = SidecarEnvironment.placeholder
    @Published private(set) var sidecarDiagnostics: SidecarDiagnostics?
    @Published private(set) var appUpdateState: AppUpdateState = .unavailable
    @Published private(set) var connectionLabel = "실행 보조 앱 시작 중..."
    @Published private(set) var isConnected = false
    @Published private(set) var workspaceRoot = ""
    @Published private(set) var lastError: String?
    @Published private(set) var presentationPhase: AssistantPresentationPhase = .compact
    @Published private(set) var activeSurface: AgenticSurface = .assistantBubble
    @Published private(set) var isScanning = false
    @Published private(set) var scanProgressMessage = ""
    @Published private(set) var scanProgressLogs: [String] = []
    @Published private(set) var scanProgressSnapshots: [WorkspaceScanProgressSnapshot] = []
    @Published private(set) var scanStartedAt: Date?
    @Published private(set) var scanCompletedAt: Date?
    @Published var scanResult: WorkspaceScanResult?
    /// Set when a scan-path provider hit its usage limit (quota): the scan still
    /// completes with local deterministic signals, and the UI offers an explicit
    /// "switch provider and re-scan" button. Cleared on the next scan start.
    @Published private(set) var scanProviderLimitNotice: ScanProviderLimitNotice?
    @Published private(set) var scanBlockedNotice: WorkspaceScanBlockedNotice?
    @Published private(set) var pendingAgentic30GitignoreConsent: Agentic30GitignoreState?
    @Published private(set) var isCreatingDoc: String?
    @Published private(set) var docCreationLogs: [String] = []
    @Published var lastDocCreated: (type: String, path: String)?
    @Published private(set) var macAuthSession: MacAuthSession?
    @Published private(set) var macOnboardingStatus: MacOnboardingStatus = .idle
    @Published private(set) var macOnboardingIntroCompleted: Bool = false
    @Published private(set) var macOnboardingIntakeOnlyCompleted: Bool = false
    @Published private(set) var localDataResetGeneration: Int = 0
    @Published private(set) var onboardingContext: OnboardingContext?
    @Published private(set) var onboardingContextStatus: OnboardingContextSubmissionStatus = .idle
    @Published private(set) var bipCoach: BipCoachState?
    @Published private(set) var day1GoalSelection: Day1GoalSelection?
    @Published private(set) var day1GoalError: String?
    @Published private(set) var day1SurfaceReview: Day1SurfaceReview?
    @Published private(set) var day1SurfaceReviewGenerating = false
    @Published private(set) var day1SurfaceReviewDecisionPending: String?
    @Published private(set) var day1SurfaceReviewError: String?
    @Published private(set) var dayProgress: DayProgress?
    @Published private(set) var dayReviews: [String: DayReview] = [:]
    /// Cycle#N office-hours memory summary (compiled truth + open/abandoned threads),
    /// delivered additively on `day_progress_state`. Drives the retro read-back surface.
    @Published private(set) var officeHoursMemory: OfficeHoursMemorySummary?
    @Published private(set) var officeHoursHistory: OfficeHoursHistorySummary?
    @Published private(set) var evidenceOS: EvidenceOSSummary?
    @Published private(set) var dayClosePolicy: OfficeHoursDayClosePolicy?
    @Published private(set) var officeHoursSourceGate: OfficeHoursSourceGate?
    /// Day 2+ daily digest briefing (`office_hours_daily_digest_result`): the sidecar
    /// broadcasts `status: "collecting"` before the (potentially slow) gh CLI + external
    /// MCP collection, then `status: "ready"` with the full digest payload.
    @Published private(set) var officeHoursDailyDigest: OfficeHoursDailyDigest?
    @Published private(set) var officeHoursDailyDigestCollecting = false
    /// Morning briefing (`morning_briefing_result`): session-less reuse of the Day 2+
    /// digest collectors, shaped by sidecar/morning-briefing.mjs for the briefing screen.
    @Published private(set) var morningBriefing: MorningBriefing?
    @Published private(set) var morningBriefingPrevious: MorningBriefing?
    @Published private(set) var morningBriefingCollecting = false
    @Published private(set) var morningBriefingStatus: MorningBriefingStatus?
    /// 수집 중 카드별 라이브 진행(`morning_briefing_progress`): 카드 id →
    /// 스피너 상태 + 에이전트 로그. result 도착 시 비운다.
    @Published private(set) var morningBriefingSourceProgress: [String: MorningBriefingSourceProgress] = [:]
    /// Commitment-close candidates (`office_hours_commitment_candidates`), keyed by
    /// session id: 2–3 next-customer-action proposals the sidecar derives from THIS
    /// interview's own answers. Proposals only — the stored commitment is always the
    /// founder's resolved text (user-origin gate lives sidecar-side).
    @Published private(set) var officeHoursCommitmentCandidatesBySession: [String: [String]] = [:]
    /// Sessions with a candidate generation in flight (`status: "generating"`), so the
    /// close can show a "약속 준비 중" loader instead of a bare empty card.
    @Published private(set) var officeHoursCommitmentCandidatesGenerating: Set<String> = []
    /// Soft guidance from the interview gate: set when the sidecar withholds an interview
    /// close (needsCommitment) and asks for one next customer action; cleared on the next
    /// successful (non-blocked) day_progress_state so the nudge never lingers.
    @Published private(set) var commitmentGateMessage: String?
    /// The step the gate held (event.gatedStep), so the nudge is scoped to the matching
    /// commitment bar and never bleeds onto a different step's surface.
    @Published private(set) var commitmentGateStep: String?
    /// Milestone-gate hard block surfaced on day_progress_state (spec §10.2): set when
    /// the sidecar withholds a day patch because a program gate (G1/G2/G4…) is blocked;
    /// cleared on the next non-blocked update. The P2 blocked-gate screen renders this.
    @Published private(set) var dayGateBlocked: SidecarEvent.DayGateBlocked?
    /// User-facing one-liner accompanying `dayGateBlocked` (sidecar-rendered message).
    @Published private(set) var dayGateBlockedMessage: String?
    /// IDD mission card for the execution step (spec §11.0/§17.2): set when the
    /// sidecar emits `mission_card` on execution-step entry. The execution surface
    /// renders the mission + evidence spec + gate chips from this.
    @Published private(set) var executionMissionCard: SidecarEvent.MissionCard?
    @Published private(set) var dailyCards: [SidecarEvent.MissionCard.DailyCard] = []
    /// System-triggered Office Hours intervention (spec §13.1): the latest
    /// `office_hours_intervention_required` payload. Severity "immediate" renders
    /// as a blocking card, "scheduled" as a briefing banner (P2 surface).
    @Published private(set) var ohInterventionRequired: SidecarEvent.OhInterventionRequired?
    @Published private(set) var isBipCoachRefreshing = false
    @Published private(set) var isBipCoachGenerating = false
    @Published private(set) var isBipCoachCompleting = false
    @Published private(set) var bipReadiness: BipReadinessState?
    @Published private(set) var bipSetupGateMessage: String?
    @Published private(set) var missingBipLocalDocs: [String] = []
    @Published private(set) var missingBipExternalRequirements: [String] = []
    @Published private(set) var iddSetupStatus: String = "not_started"
    @Published private(set) var iddSetupComplete = false
    @Published private(set) var iddCurrentDocType: String?
    @Published private(set) var iddAmbiguityScore: Int?
    @Published private(set) var iddUnresolvedAssumptions: [String] = []
    @Published private(set) var iddDocOrder: [String] = []
    @Published private(set) var iddDocPreviews: [IddDocPreview] = []
    @Published private(set) var iddProviderRecovery: IddProviderRecovery?
    @Published private(set) var iddSetupError: IddSetupError?
    @Published private(set) var day1DocHandoffPendingDocType: String?
    @Published private(set) var day1DocHandoffAwaitingFollowupPrompt = false
    @Published private(set) var day1DocHandoffError: String?
    @Published private(set) var bipTokenExpired: String?
    @Published private(set) var bipMissionProgress: BipMissionProgress?
    // F6: transient banner displayed in the Foundation surface when the IDD
    // rubric advances from one signal (e.g. 좁히기) to the next (e.g. 직접 만날
    // 사람). The sidecar stamps `generation.dimensionTransitioned` on follow-up
    // cards; on receipt the ViewModel sets the toast and a background task
    // clears it 3 seconds later.
    @Published private(set) var dimensionTransitionToast: DimensionTransitionToast?
    // R6 / CCG-Codex weekly ritual broadcast. The Mac surface for the actual
    // banner/modal is wired in a follow-up round; for now we receive the
    // prompt and expose it as @Published state so SwiftUI views can opt in.
    @Published private(set) var pendingWeeklyRitual: WeeklyRitualPrompt?
    @Published private(set) var providerAuthInProgress: AgentProvider?
    @Published private(set) var providerAuthMessage: String?
    @Published private(set) var sentPromptPreviews: [String: [PendingPromptPreview]] = [:]
    @Published private(set) var submittedStructuredPromptBySession: [String: StructuredPromptSubmissionState] = [:]
    @Published private(set) var structuredPromptDraftBySession: [String: StructuredPromptDraftState] = [:]
    @Published private(set) var sidecarOutputLogs: [String: [String]] = [:]
    @Published private(set) var officeHoursLiveStatusBySession: [String: OfficeHoursLiveStatus] = [:]
    @Published private(set) var startupQueuedAction: StartupQueuedAction?
    @Published private(set) var startupSessionAppearElapsedMs: Int?
    @Published private(set) var reviewDayDashboardViewModel: ReviewDayDashboardViewModel?
    @Published private(set) var newsMarketRadar: NewsMarketRadarSnapshot = .empty
    @Published private(set) var newsMarketRadarPreparingForDisplay = false
    @Published private(set) var strategyReport: StrategyReportSnapshot = .empty
    @Published private(set) var strategyReportPreparingForDisplay = false
    @Published private(set) var strategyReportDynamicActivated = false
    @Published private(set) var bipResearch: BipResearchSnapshot = .empty
    @Published private(set) var workHistory: WorkHistorySnapshot = .empty
    @Published private(set) var recorderPermissionActor: RecorderPermissionActorDiagnostic = AgenticViewModel.currentRecorderPermissionActorDiagnostic()
    @Published private(set) var recorderPermissionReleaseIdentity: RecorderPermissionReleaseIdentityDiagnostic =
        AgenticViewModel.currentRecorderPermissionReleaseIdentityDiagnostic(
            actor: AgenticViewModel.currentRecorderPermissionActorDiagnostic()
        )
    @Published private(set) var recorderControlState: RecorderControlState?
    @Published private(set) var recorderCaptureReadiness: RecorderCaptureReadiness?
    @Published private(set) var recorderControlRefreshing = false
    @Published private(set) var recorderControlActionInFlight: String?
    @Published private(set) var recorderControlLastError: String?
    @Published private(set) var recorderFrameCaptureInFlight = false
    @Published private(set) var recorderFrameCaptureLastError: String?
    @Published private(set) var recorderLastFrameCapture: RecorderFrameCaptureReceipt?
    @Published private(set) var recorderFrameDeleteInFlight = false
    @Published private(set) var recorderFrameDeleteLastError: String?
    @Published private(set) var recorderLastFrameDelete: RecorderFrameDeleteReceipt?
    @Published private(set) var recorderLastFrameRangeDelete: RecorderFrameRangeDeleteReceipt?
    @Published private(set) var recorderFrameCaptures: [RecorderFrameCaptureReceipt] = []
    @Published private(set) var recorderFrameCapturesRefreshing = false
    @Published private(set) var recorderFrameCapturesLastError: String?
    @Published private(set) var recorderFrameImagePreview: RecorderFrameImagePreview?
    @Published private(set) var recorderFrameImageLoadingID: String?
    @Published private(set) var recorderFrameImageLastError: String?
    @Published private(set) var recorderAutoCaptureRunning = false
    @Published private(set) var recorderAutoCaptureLastTrigger: String?
    @Published private(set) var recorderAutoCaptureLastError: String?
    @Published private(set) var recorderClipboardLastError: String?
    @Published private(set) var recorderAudioCaptureRunning = false
    @Published private(set) var recorderAudioCaptureLastError: String?
    @Published private(set) var recorderAuditSource: RecorderAuditSource?
    @Published private(set) var recorderAuditRefreshing = false
    @Published private(set) var recorderAuditLastError: String?
    @Published private(set) var recorderSearchResult: RecorderSearchResultSet?
    @Published private(set) var recorderSearchRunning = false
    @Published private(set) var recorderSearchLastError: String?
    @Published private(set) var recorderSqlQueryResult: RecorderSqlQueryResult?
    @Published private(set) var recorderSqlQueryRunning = false
    @Published private(set) var recorderSqlQueryLastError: String?
    @Published private(set) var recorderMcpGrants: [RecorderMcpGrant] = []
    @Published private(set) var recorderMcpGrantsRefreshing = false
    @Published private(set) var recorderMcpGrantActionInFlight: String?
    @Published private(set) var recorderMcpGrantLastError: String?
    @Published private(set) var recorderPipes: [RecorderPipeDefinition] = []
    @Published private(set) var recorderPipeRuns: [RecorderPipeRun] = []
    @Published private(set) var recorderPipesRefreshing = false
    @Published private(set) var recorderPipeActionInFlight: Set<String> = []
    @Published private(set) var recorderPipeSchedulerRunning = false
    @Published private(set) var recorderPipeLastSchedulerResult: RecorderPipeSchedulerResult?
    @Published private(set) var recorderPipeLastError: String?
    @Published private(set) var recorderDayMemoryLoop: RecorderDayMemoryLoopResult?
    @Published private(set) var recorderDayMemoryLoopRunning = false
    @Published private(set) var recorderDayMemoryLoopLastError: String?
    @Published private(set) var recorderEvidenceCandidateReviewInFlight: Set<String> = []
    @Published private(set) var recorderLastEvidenceCandidateReviewResult: RecorderEvidenceCandidateReviewResult?
    @Published private(set) var recorderRetentionApplyRunning = false
    @Published private(set) var recorderRetentionLastResult: RecorderRetentionApplyResult?
    @Published private(set) var recorderRetentionLastError: String?
    @Published private(set) var githubCliAuthStatus: GitHubCLIAuthStatus = .unknown
    // Settings > 연동 live checks (sidecar verifies tokens against the real
    // services: gh auth / PostHog /users/@me / Cloudflare /zones).
    @Published private(set) var integrationStatus: IntegrationStatusSnapshot?
    @Published private(set) var integrationStatusChecking = false
    @Published private(set) var exaMcpConnecting = false
    @Published private(set) var exaMcpConnectResult: ExaMcpConnectResult?
    private var pendingExaMcpApiKeyForStorage: String?
    /// Settings > 연동 "MCP 연결" prewarm — in-flight servers + last results.
    /// In-memory only: the proof is a live tool call, so it's re-earned per run.
    @Published private(set) var mcpOauthConnecting: Set<String> = []
    @Published private(set) var mcpOauthResults: [String: McpOauthConnectResult] = [:]
    /// Live progress captions while a prewarm runs (provider start → OAuth URL
    /// issued → browser login wait → tool call), keyed by server.
    @Published private(set) var mcpOauthProgress: [String: String] = [:]
    /// Login URLs already auto-opened — guards against re-opening the browser
    /// when the sidecar re-emits the same progress event.
    private var mcpOauthOpenedLoginUrls: Set<String> = []
    /// First-launch wall-clock timestamp that anchors the Foundation phase
    /// Day N/30 counter. The value is mirrored from `foundationProgressState`,
    /// which is persisted per workspace/app-support rather than globally.
    @Published private(set) var foundationStartedAt: Date?
    @Published private(set) var foundationProgressState = FoundationProgressSnapshot()

    // Notion OAuth
    @Published private(set) var notionConnected = false
    @Published private(set) var notionOAuthInProgress = false
    @Published var notionOAuthError: String?
    private var authSession: WebAuthenticationSessionHandle?
    private let authPresentationContext = AuthPresentationContext()
    private let authSessionFactory: WebAuthenticationSessionFactory
    private let activateAppForAuth: @MainActor () -> Void
    private let disablesSidecarStartForTesting: Bool
    private let localDataResetter: @MainActor (Agentic30LocalDataResetOptions, [URL]) -> KeychainHelper.LocalDataResetReport
    private var startupSessionAppearStartedAt: Date?
    private var didRecordStartupSessionAppear = false
    private var recorderAutoCaptureTimer: Timer?
    private var recorderAutoCaptureActivationObserver: NSObjectProtocol?
    #if canImport(ScreenCaptureKit)
    private var recorderFrameStreamSession: ScreenCaptureKitFrameCaptureSession?
    #endif
    private var recorderEventTapTrigger: RecorderEventTapTrigger?
    private var recorderEventTapLastTriggerAt: Date?
    private let recorderAutoCaptureIntervalSeconds: TimeInterval = 120
    private var recorderAutoCaptureLocallyStopped = false
    private var recorderClipboardCollectorTimer: Timer?
    private var recorderClipboardLastChangeCount: Int?
    private var recorderMicrophoneRecorder: AVAudioRecorder?
    private var recorderMicrophoneChunkStartedAt: Date?
    private var recorderMicrophoneTempFileURL: URL?
    private var recorderMicrophoneChunkTimer: Timer?
    private var recorderSystemAudioSession: RecorderSystemAudioCaptureSession?
    private var recorderSystemAudioChunkStartedAt: Date?
    private var recorderSystemAudioTempFileURL: URL?
    private var recorderSystemAudioChunkTimer: Timer?
    private var recorderSystemAudioStartInFlight = false
    private var recorderAudioChunkInFlight = false
    private var recorderMicrophoneAudioChunkInFlight = false
    private var recorderSystemAudioChunkInFlight = false
    private let recorderAudioChunkDurationSeconds: TimeInterval = 30
    private var recorderRawApiStatus: RecorderRawApiStatus?
    private var pendingRecorderFrameImageRequestID: String?
    private var pendingRecorderSearchQuery: String?
    private var pendingRecorderSqlQuery: String?
    private var recorderFrameImagePreparedForDisplay = false
    private static let recorderFrameImageClientId = "agentic30-founder-replay"
    private static let recorderSearchClientId = "agentic30-recorder-redacted-search"
    private static let recorderSqlInspectorClientId = "agentic30-recorder-sql-inspector"
    static let recorderMcpRawSqlToolName = "recorder_raw_sql_query"

    struct WorkspaceScanResult: Codable, Equatable {
        let icp: String?
        let spec: String?
        let values: String?
        let designSystem: String?
        let adr: String?
        let goal: String?
        let docs: String?
        let sheet: String?
        let onboardingHypothesis: WorkspaceOnboardingHypothesis?
        let day1AlignmentPlan: Day1AlignmentPlan?
        let day1IcpPlan: Day1IcpPlan?
        let day1SituationSummary: Day1SituationSummary?
        let day1GoalSelection: Day1GoalSelection?
        let agentic30Gitignore: Agentic30GitignoreState?
        let foundCount: Int?
        let error: String?

        var foundArtifactPaths: [String] {
            [icp, spec, values, designSystem, adr, goal, docs, sheet]
                .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty }
        }

        var foundArtifactCount: Int {
            foundCount ?? foundArtifactPaths.count
        }

        func replacing(
            day1AlignmentPlan: Day1AlignmentPlan? = nil,
            day1IcpPlan: Day1IcpPlan? = nil,
            day1SituationSummary: Day1SituationSummary? = nil,
            day1GoalSelection: Day1GoalSelection? = nil
        ) -> WorkspaceScanResult {
            WorkspaceScanResult(
                icp: icp,
                spec: spec,
                values: values,
                designSystem: designSystem,
                adr: adr,
                goal: goal,
                docs: docs,
                sheet: sheet,
                onboardingHypothesis: onboardingHypothesis,
                day1AlignmentPlan: day1AlignmentPlan ?? self.day1AlignmentPlan,
                day1IcpPlan: day1IcpPlan ?? self.day1IcpPlan,
                day1SituationSummary: day1SituationSummary ?? self.day1SituationSummary,
                day1GoalSelection: day1GoalSelection ?? self.day1GoalSelection,
                agentic30Gitignore: agentic30Gitignore,
                foundCount: foundCount,
                error: error
            )
        }

        func withDay1GoalSelection(_ selection: Day1GoalSelection?) -> WorkspaceScanResult {
            WorkspaceScanResult(
                icp: icp,
                spec: spec,
                values: values,
                designSystem: designSystem,
                adr: adr,
                goal: goal,
                docs: docs,
                sheet: sheet,
                onboardingHypothesis: onboardingHypothesis,
                day1AlignmentPlan: day1AlignmentPlan,
                day1IcpPlan: day1IcpPlan,
                day1SituationSummary: day1SituationSummary,
                day1GoalSelection: selection,
                agentic30Gitignore: agentic30Gitignore,
                foundCount: foundCount,
                error: error
            )
        }
    }

    struct PendingPromptPreview: Identifiable, Hashable {
        let id: String
        let content: String
        let createdAt: Date
    }

    private let sidecar: any SidecarTransport
    private var started = false
    private var revealWorkItem: DispatchWorkItem?
    private var activePresentationSessionID: String?
    private var revealedAssistantMessageID: String?
    private var lastBipRequestedAction: BipRequestedAction?
    private var pendingBipAuthRetry: BipRequestedAction?
    private var pendingWorkspaceScanRoot: String?
    private var pendingWorkspaceScanProvider: AgentProvider?
    private var pendingProjectContextRefresh: PendingProjectContextRefresh?
    private var pendingStrategyReportRefresh: PendingStrategyReportRefresh?
    private var uiTestingDynamicResearchRefreshTriggered = false
    private var attemptedStartupWorkspaceScanRecoveryRoots = Set<String>()
    #if DEBUG
    static var workspaceScanResultAppSupportURLOverrideForTesting: URL?
    static var recorderPermissionActorOverrideForTesting: RecorderPermissionActorDiagnostic?
    #endif
    private var workspaceSetupTelemetryGate = WorkspaceSetupTelemetryGate()
    private var requestedInitialBipGate = false
    private var requestedInitialBipMission = false
    private var activeOnboardingWorkspacePrefetchFingerprint: String?
    private var replacementSessionCreateInFlight = false
    private var officeHoursSessionCreateInFlight = false
    private var latestCurriculumQuestionReframesByKey: [String: CurriculumQuestionReframeRecord] = [:]
    private var lastNewsMarketRadarViewedAt: Date?
    private var lastBipResearchViewedAt: Date?
    #if DEBUG
    private var didEmitUITestingNewsMarketRadarEvents = false
    private var didEmitUITestingStrategyReportEvents = false
    private var didEmitUITestingWorkHistoryEvents = false
    private var didEmitUITestingMorningBriefingEvents = false
    private var didEmitUITestingBipResearchEvents = false
    #endif
    /// Idempotency guard for the AI-driven Foundation Day 0/2-7 first prompt.
    /// Keyed by `"<sessionId>:day-<day>"` so the same opener is never injected
    /// twice for the same (session, day) pair, even if the sidecar replays
    /// `foundation_first_prompt` after a reconnect or queued send.
    /// Distinct from the message-id collision check inside the session because
    /// callers may legitimately re-request the prompt for a different day in
    /// the same session (e.g. UI navigation across Foundation days).
    private var injectedFoundationFirstPromptKeys = Set<String>()
    /// Tracks in-flight `foundation_first_prompt` requests so retries from the
    /// same surface (e.g. a tap on "오늘 과제" twice) do not flood the sidecar.
    /// Keys mirror `injectedFoundationFirstPromptKeys` so the request side and
    /// the inject side share a single naming convention.
    private var pendingFoundationFirstPromptKeys = Set<String>()
    private enum BipRequestedAction: Hashable {
        case refreshEvidence
        case generateMission(compact: Bool)
    }

    private struct PendingProjectContextRefresh: Hashable {
        let completedDay: Int
        let unlockedDay: Int
        let workspaceRoot: String
    }

    private struct PendingStrategyReportRefresh: Hashable {
        let reason: String
        let force: Bool
    }

    /// Legacy global key used before the progress state became workspace-scoped.
    /// Only migrate it when the current workspace is explicit; never read it as
    /// active state for a fresh workspace.
    private static let kFoundationStartedAtKey = "agentic30.foundation.startedAt"
    private var foundationProgressStore: FoundationProgressStore?
    private let foundationCurriculumLifecycleController: FoundationCurriculumLifecycleController

    /// Lazy initializer for the Foundation phase counter. Idempotent per
    /// workspace so isolated projects do not inherit stale global progress.
    func ensureFoundationStarted(now: Date = Date()) {
        ensureFoundationProgressStore()
        guard foundationProgressState.startedAt == nil else { return }
        updateFoundationProgress { snapshot in
            snapshot.startedAt = now
            snapshot.selectedDay = max(1, snapshot.selectedDay)
        }
        PostHogTelemetry.capture(
            "mac_foundation_phase_started",
            properties: ["started_at": ISO8601DateFormatter().string(from: now)],
            authSession: macAuthSession
        )
    }

    /// 1-based Day index for the Foundation phase counter (`Day N/30`).
    /// `nil` when the user has not yet reached the onboarding gate. Floors
    /// to whole 24-hour spans relative to `foundationStartedAt`, mirroring
    /// the agnt navigator engine: `D = floor((now - started_at)/86400000)+1`.
    /// Capped at 30 for display so the badge stops counting past the
    /// program length, while the underlying anchor remains untouched.
    var foundationDayNumber: Int? {
        guard foundationProgressState.startedAt != nil else { return nil }
        return max(foundationProgressState.currentDayNumber() ?? 1, foundationProgressState.selectedDay)
    }

    /// 0…1 progress for the sidebar bar. Falls back to 0 before the anchor
    /// is set so the UI shows an empty rail rather than collapsing.
    var foundationProgress: Double {
        guard let day = foundationDayNumber else { return 0 }
        return min(1.0, Double(day) / 30.0)
    }

    /// User-facing label. Uses an em-dash placeholder when the anchor is
    /// missing so the slot is reserved without claiming a Day yet.
    var foundationDayLabel: String {
        if let day = foundationDayNumber {
            return "Day \(day)/30"
        }
        return "Day —/30"
    }

    var selectedFoundationDay: Int {
        foundationProgressState.selectedDay
    }

    var foundationCurriculumPresentation: FoundationCurriculumPresentationViewModel {
        FoundationCurriculumPresentationViewModel(snapshot: foundationProgressState)
    }

    var foundationCurriculumPresentationDestination: FoundationCurriculumPresentationDestination {
        foundationCurriculumPresentation.destination
    }

    func selectFoundationDay(_ day: Int) {
        let clamped = max(1, min(day, 30))
        guard isFoundationDayUnlocked(clamped) else { return }
        updateFoundationProgress { snapshot in
            snapshot.selectedDay = clamped
        }
    }

    func isFoundationDayUnlocked(_ day: Int) -> Bool {
        foundationProgressState.isUnlocked(day)
    }

    @discardableResult
    func markFoundationDayCompleted(_ day: Int) -> FoundationDayCompletionSaveResult {
        ensureFoundationProgressStore()
        let normalizedDay = max(1, min(day, 30))
        let wasAlreadyCompleted = foundationProgressState.completedDays.contains(normalizedDay)
        let handler = FoundationDayCompletionSaveHandler(store: foundationProgressStore)
        let result = handler.saveDayCompletion(
            day,
            snapshot: foundationProgressState,
            workspaceRoot: WorkspaceSettings.resolvedURL().path
        )
        foundationProgressState = result.snapshot
        foundationStartedAt = result.snapshot.startedAt
        _ = foundationCurriculumLifecycleController.enterCompletedState(result.snapshot)
        recordNewsMarketRadarDayCompletionHelpIfNeeded(normalizedDay)
        if !wasAlreadyCompleted {
            PostHogTelemetry.capture("mac_foundation_day_completed", properties: [
                "completed_day": result.completedDay,
                "unlocked_day": result.unlockedDay,
                "completed_day_count": result.snapshot.completedDays.count,
            ], authSession: macAuthSession)
            enqueueProjectContextRefreshForCompletedDay(result)
        }
        return result
    }

    @discardableResult
    func advanceFromCompletedMission(_ mission: BipCoachMission) -> FoundationDayCompletionSaveResult? {
        guard let completedDay = mission.curriculumDay?.day,
              completedDay < 30 else {
            return nil
        }
        let result = markFoundationDayCompleted(completedDay)
        if result.unlockedDay == 2 {
            requestFoundationFirstPrompt(day: 2)
        }
        return result
    }

    private func enqueueProjectContextRefreshForCompletedDay(_ result: FoundationDayCompletionSaveResult) {
        let root = WorkspaceSettings.resolvedURL().path
        let refresh = PendingProjectContextRefresh(
            completedDay: result.completedDay,
            unlockedDay: result.unlockedDay,
            workspaceRoot: root
        )
        if !sendProjectContextRefresh(refresh) {
            pendingProjectContextRefresh = refresh
        }
    }

    @discardableResult
    private func sendProjectContextRefresh(_ refresh: PendingProjectContextRefresh) -> Bool {
        guard isConnected else { return false }
        return sidecar.send(payload: [
            "type": "project_context_refresh",
            "reason": "day_completed",
            "completedDay": refresh.completedDay,
            "unlockedDay": refresh.unlockedDay,
            "workspaceRoot": refresh.workspaceRoot,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    private func flushPendingProjectContextRefreshIfNeeded() {
        guard let refresh = pendingProjectContextRefresh else { return }
        if sendProjectContextRefresh(refresh) {
            pendingProjectContextRefresh = nil
        }
    }

    func configureAppUpdates(
        configured: Bool,
        feedURL: String,
        automaticChecksEnabled: Bool,
        automaticDownloadsEnabled: Bool
    ) {
        appUpdateState.configured = configured
        appUpdateState.feedURL = feedURL
        appUpdateState.automaticChecksEnabled = automaticChecksEnabled
        appUpdateState.automaticDownloadsEnabled = automaticDownloadsEnabled
        if !configured {
            appUpdateState.isSessionActive = false
            appUpdateState.lastResult = .blocked("Release builds must include a Sparkle public EdDSA key.")
        }
    }

    func recordAppUpdateCheckStarted() {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        appUpdateState.lastResult = .checking
        appUpdateState.lastError = nil
    }

    func recordAppUpdateAppcastLoaded(itemCount: Int) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        if appUpdateState.lastResult == .neverChecked {
            appUpdateState.lastResult = .checking
        }
    }

    func recordAppUpdateAvailable(version: String, displayVersion: String?) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        appUpdateState.latestVersion = version
        appUpdateState.latestDisplayVersion = displayVersion
        appUpdateState.lastError = nil
        appUpdateState.lastResult = .updateAvailable(version: version, displayVersion: displayVersion)
    }

    func recordAppUpdateDownloaded(version: String, displayVersion: String?) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        appUpdateState.latestVersion = version
        appUpdateState.latestDisplayVersion = displayVersion
        appUpdateState.lastError = nil
        appUpdateState.lastResult = .downloaded(version: version, displayVersion: displayVersion)
    }

    func recordAppUpdateInstalling(version: String, displayVersion: String?) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = true
        appUpdateState.latestVersion = version
        appUpdateState.latestDisplayVersion = displayVersion
        appUpdateState.lastError = nil
        appUpdateState.lastResult = .installing(version: version, displayVersion: displayVersion)
    }

    func recordAppUpdateLatest() {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = false
        appUpdateState.lastError = nil
        appUpdateState.lastResult = .latest
    }

    func recordAppUpdateBlocked(_ reason: String) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = false
        appUpdateState.lastError = reason
        appUpdateState.lastResult = .blocked(reason)
    }

    func recordAppUpdateError(_ message: String) {
        appUpdateState.lastCheckAt = Date()
        appUpdateState.isSessionActive = false
        appUpdateState.lastError = message
        switch appUpdateState.lastResult {
        case .updateAvailable, .downloaded:
            // A transient failed check must not hide an update that is already
            // known (and possibly downloaded + staged) — keep the gentle pill.
            break
        default:
            appUpdateState.lastResult = .error(message)
        }
    }

    func recordAppUpdateSkipped() {
        // The user chose "Skip This Version" in Sparkle's dialog. Converge to
        // the steady state the next scheduled check would reach anyway
        // (Sparkle reports "no update" for skipped versions), hiding the pill.
        appUpdateState.isSessionActive = false
        appUpdateState.lastError = nil
        appUpdateState.latestVersion = nil
        appUpdateState.latestDisplayVersion = nil
        appUpdateState.lastResult = .latest
    }

    func recordAppUpdateCycleFinished() {
        appUpdateState.isSessionActive = false
    }

    init(
        authSessionFactory: WebAuthenticationSessionFactory? = nil,
        onboardingContextOverride: OnboardingContext? = nil,
        disablesSidecarStartForTesting: Bool = false,
        foundationCurriculumLifecycleController: FoundationCurriculumLifecycleController? = nil,
        sidecar: (any SidecarTransport)? = nil,
        localDataResetter: @escaping @MainActor (Agentic30LocalDataResetOptions, [URL]) -> KeychainHelper.LocalDataResetReport = { options, workspaceURLs in
            let resetKeychainStorage: (() -> Void)? = CommandLine.arguments.contains("--ui-testing-skip-keychain-reset")
                ? {}
                : nil
            return Agentic30LocalDataResetter.reset(
                options: options,
                additionalWorkspaceURLs: workspaceURLs,
                resetKeychainStorage: resetKeychainStorage
            )
        },
        activateAppForAuth: @escaping @MainActor () -> Void = {
            NSApplication.shared.activate(ignoringOtherApps: true)
        }
    ) {
        self.authSessionFactory = authSessionFactory ?? { url, callbackURLScheme, presentationContextProvider, prefersEphemeral, completion in
            Self.makeSystemAuthSession(
                url: url,
                callbackURLScheme: callbackURLScheme,
                presentationContextProvider: presentationContextProvider,
                prefersEphemeral: prefersEphemeral,
                completion: completion
            )
        }
        self.activateAppForAuth = activateAppForAuth
        self.disablesSidecarStartForTesting = disablesSidecarStartForTesting
        self.foundationCurriculumLifecycleController = foundationCurriculumLifecycleController ?? FoundationCurriculumLifecycleController()
        self.sidecar = sidecar ?? SidecarBridge()
        self.localDataResetter = localDataResetter
        LegacyBipDailyNotificationCleanup.removeScheduledNotifications()

        let arguments = CommandLine.arguments

        #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
        if Self.isUITesting(arguments: arguments) {
            if Self.uiTestingFlag("--ui-testing-reset-onboarding", arguments: arguments) {
                KeychainHelper.deleteMacAuthSession()
                Self.resetMacOnboardingState()
                WorkspaceSettings.clear()
            }
            Self.applyUITestingWorkspaceSeeds(arguments: arguments)
            macAuthSession = Self.makeUITestingMacAuthSession(arguments: arguments)
            onboardingContext = Self.makeUITestingOnboardingContext(arguments: arguments)
            macOnboardingIntroCompleted = onboardingContext != nil || Self.loadMacOnboardingIntroCompleted()
            macOnboardingIntakeOnlyCompleted = Self.loadMacOnboardingIntakeOnlyCompleted()
            if Self.uiTestingFlag("--ui-testing-open-workspace", arguments: arguments) {
                // A UI-testing launch that opens the workspace directly has completed
                // onboarding; route past the Intake V2 onboarding flow to the workspace
                // surface. requiresMacOnboarding = !(hasExplicitWorkspace ||
                // macOnboardingIntakeOnlyCompleted), and the seeded workspace dir can
                // live under the test runner's container where hasExplicitWorkspace's
                // isExistingDirectory check misses it, so assert intake completion
                // explicitly rather than depending on the seeded directory existing.
                macOnboardingIntakeOnlyCompleted = true
            }
            applyUITestingIddSetupSeeds(arguments: arguments)
            if let seededDraft = Self.uiTestingArgumentValue("--ui-testing-seed-draft", arguments: arguments) {
                draft = seededDraft
            }
            #if DEBUG
            _ = installUITestingOfficeHoursSeedSessionIfNeeded()
            #endif
            seedUITestingRailUnlockProgressIfNeeded(arguments: arguments)
        } else if Self.isXCTestHost(arguments: arguments) {
            macAuthSession = nil
            onboardingContext = nil
            macOnboardingIntroCompleted = false
            macOnboardingIntakeOnlyCompleted = false
        } else {
            if arguments.contains("--ui-testing-reset-onboarding") {
                KeychainHelper.deleteMacAuthSession()
                Self.resetMacOnboardingState()
                WorkspaceSettings.clear()
            }
            macAuthSession = KeychainHelper.loadMacAuthSession()
            onboardingContext = Self.loadWorkspaceOnboardingContext()
            macOnboardingIntroCompleted = onboardingContext != nil || Self.loadMacOnboardingIntroCompleted()
            macOnboardingIntakeOnlyCompleted = Self.loadMacOnboardingIntakeOnlyCompleted()
        }
        #else
        if arguments.contains("--ui-testing-reset-onboarding") {
            KeychainHelper.deleteMacAuthSession()
            Self.resetMacOnboardingState()
            WorkspaceSettings.clear()
        }
        macAuthSession = KeychainHelper.loadMacAuthSession()
        onboardingContext = Self.loadWorkspaceOnboardingContext()
        macOnboardingIntroCompleted = onboardingContext != nil || Self.loadMacOnboardingIntroCompleted()
        macOnboardingIntakeOnlyCompleted = Self.loadMacOnboardingIntakeOnlyCompleted()
        #endif

        if let session = macAuthSession, session.shouldRefreshSoon {
            macOnboardingStatus = .refreshing
        }
        if let onboardingContextOverride {
            onboardingContext = onboardingContextOverride
            macOnboardingIntroCompleted = true
            macOnboardingIntakeOnlyCompleted = !WorkspaceSettings.hasExplicitWorkspace
        }

        restoreFoundationProgress(arguments: arguments)
        hydrateWorkspaceScanResultFromCacheIfAvailable()
        #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
        writeUITestingLaunchDiagnostics(arguments: arguments)
        #endif
    }

    deinit {
        recorderAutoCaptureTimer?.invalidate()
        #if canImport(ScreenCaptureKit)
        recorderFrameStreamSession?.stop()
        recorderFrameStreamSession = nil
        #endif
        recorderEventTapTrigger?.stop()
        recorderEventTapTrigger = nil
        recorderEventTapLastTriggerAt = nil
        recorderClipboardCollectorTimer?.invalidate()
        recorderMicrophoneChunkTimer?.invalidate()
        recorderMicrophoneRecorder?.stop()
        if let recorderMicrophoneTempFileURL {
            try? FileManager.default.removeItem(at: recorderMicrophoneTempFileURL)
        }
        recorderSystemAudioChunkTimer?.invalidate()
        recorderSystemAudioSession?.cancel()
        if let recorderSystemAudioTempFileURL {
            try? FileManager.default.removeItem(at: recorderSystemAudioTempFileURL)
        }
        if let recorderAutoCaptureActivationObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(recorderAutoCaptureActivationObserver)
        }
    }

    struct StructuredPromptSubmission: Codable, nonisolated Hashable {
        let question: String
        let selectedOptions: [String]
        let freeText: String
    }

    struct StructuredPromptSubmissionState: nonisolated Hashable {
        let sessionId: String
        let requestId: String
        let responses: [StructuredPromptSubmission]
        let submittedAt: Date
        var progressStage: String? = nil
        var progressText: String? = nil
        var progressUpdatedAt: Date? = nil
        var elapsedMs: Int? = nil

        var answerSummary: String {
            let parts = responses.flatMap { response -> [String] in
                let selected = response.selectedOptions.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
                let freeText = response.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
                return selected + (freeText.isEmpty ? [] : [freeText])
            }
            let summary = parts.filter { !$0.isEmpty }.joined(separator: ", ")
            guard !summary.isEmpty else { return "응답" }
            guard summary.count > 96 else { return summary }
            return String(summary.prefix(96)) + "..."
        }
    }

    struct StructuredPromptAnswerDraft: Hashable {
        var selectedOptions: Set<String> = []
        var freeText = ""
    }

    struct StructuredPromptDraftState: Hashable {
        let sessionId: String
        let requestId: String
        var answersByQuestionID: [String: StructuredPromptAnswerDraft]
    }

    private struct CurriculumQuestionReframeRecord: Hashable {
        let sessionId: String
        let requestId: String
        let questionId: String
        let reframedQuestion: String
    }

    var selectedSession: ChatSession? {
        sessions.first(where: { $0.id == selectedSessionID && $0.archivedAt == nil })
    }

    var pendingStructuredPrompt: StructuredPromptRequest? {
        selectedSession?.pendingUserInput?.isLegacyStaticIddQuestion == true
            ? nil
            : selectedSession?.pendingUserInput
    }

    var activeDay1HandoffPrompt: StructuredPromptRequest? {
        guard let prompt = pendingStructuredPrompt,
              prompt.generation?.mode == "day1_handoff",
              prompt.isAgentic30StructuredInput,
              let promptDocType = prompt.generation?.docType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !promptDocType.isEmpty else {
            return nil
        }
        if let pendingDocType = day1DocHandoffPendingDocType?.lowercased(), pendingDocType == promptDocType {
            return prompt
        }
        let expectedDocType = iddCurrentDocType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard expectedDocType == nil || expectedDocType == promptDocType else {
            return nil
        }
        return prompt
    }

    var activeDay1DocumentReviewPrompt: StructuredPromptRequest? {
        activeDay1HandoffPrompt
    }

    var activeDay1DocHandoffJudgePrompt: StructuredPromptRequest? {
        if let prompt = selectedSession?.pendingUserInput,
           isDay1DocHandoffJudgePrompt(prompt) {
            return prompt
        }
        return sessions.first { session in
            session.archivedAt == nil && isDay1DocHandoffJudgePrompt(session.pendingUserInput)
        }?.pendingUserInput
    }

    private func isDay1DocHandoffJudgePrompt(_ prompt: StructuredPromptRequest?) -> Bool {
        guard let prompt,
              prompt.isAgentic30StructuredInput else {
            return false
        }
        let mode = prompt.generation?.mode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let docType = prompt.generation?.docType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return mode == "office_hours" && docType == "day1_doc_handoff_judge"
    }

    private func isDay1HandoffSession(_ session: ChatSession?) -> Bool {
        guard let session else { return false }
        if session.runtime?.iddMode?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() == "day1_handoff" {
            return true
        }
        return session.pendingUserInput?.generation?.mode == "day1_handoff"
    }

    private func isDay1HandoffSession(id sessionID: String?) -> Bool {
        guard let sessionID else { return false }
        return isDay1HandoffSession(sessions.first(where: { $0.id == sessionID }))
    }

    func structuredPromptSubmissionState(for sessionId: String?) -> StructuredPromptSubmissionState? {
        guard let sessionId else { return nil }
        return submittedStructuredPromptBySession[sessionId]
    }

    func synchronizeStructuredPromptDrafts(with prompt: StructuredPromptRequest?) {
        guard let prompt else {
            structuredPromptDraftBySession = structuredPromptDraftBySession.filter { entry in
                sessions.contains { $0.id == entry.key && $0.pendingUserInput != nil }
            }
            return
        }

        if var existing = structuredPromptDraftBySession[prompt.sessionId],
           existing.requestId == prompt.requestId {
            for question in prompt.questions where existing.answersByQuestionID[question.id] == nil {
                existing.answersByQuestionID[question.id] = StructuredPromptAnswerDraft()
            }
            structuredPromptDraftBySession[prompt.sessionId] = existing
            return
        }

        structuredPromptDraftBySession[prompt.sessionId] = StructuredPromptDraftState(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            answersByQuestionID: Dictionary(
                uniqueKeysWithValues: prompt.questions.map { question in
                    (question.id, StructuredPromptAnswerDraft())
                }
            )
        )
    }

    func structuredPromptDraft(
        for question: StructuredPromptQuestion,
        in prompt: StructuredPromptRequest
    ) -> StructuredPromptAnswerDraft {
        return structuredPromptDraftBySession[prompt.sessionId]?.answersByQuestionID[question.id]
            ?? StructuredPromptAnswerDraft()
    }

    func updateStructuredPromptFreeText(
        _ text: String,
        for question: StructuredPromptQuestion,
        in prompt: StructuredPromptRequest
    ) {
        synchronizeStructuredPromptDrafts(with: prompt)
        var state = structuredPromptDraftBySession[prompt.sessionId] ?? StructuredPromptDraftState(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            answersByQuestionID: [:]
        )
        var draft = state.answersByQuestionID[question.id] ?? StructuredPromptAnswerDraft()
        draft.freeText = text
        state.answersByQuestionID[question.id] = draft
        structuredPromptDraftBySession[prompt.sessionId] = state
    }

    func activateStructuredPromptFreeText(
        for question: StructuredPromptQuestion,
        in prompt: StructuredPromptRequest
    ) {
        synchronizeStructuredPromptDrafts(with: prompt)
        var state = structuredPromptDraftBySession[prompt.sessionId] ?? StructuredPromptDraftState(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            answersByQuestionID: [:]
        )
        var draft = state.answersByQuestionID[question.id] ?? StructuredPromptAnswerDraft()
        let supportsFreeText = question.allowFreeText == true
            || question.requiresFreeText == true
            || question.primaryTextInput != nil
            || question.options?.isEmpty != false
        let hasOptions = question.options?.isEmpty == false
        if supportsFreeText && !hasOptions {
            draft.selectedOptions.removeAll()
        }
        state.answersByQuestionID[question.id] = draft
        structuredPromptDraftBySession[prompt.sessionId] = state
    }

    func toggleStructuredPromptOption(
        _ label: String,
        for question: StructuredPromptQuestion,
        in prompt: StructuredPromptRequest
    ) {
        synchronizeStructuredPromptDrafts(with: prompt)
        var state = structuredPromptDraftBySession[prompt.sessionId] ?? StructuredPromptDraftState(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            answersByQuestionID: [:]
        )
        var draft = state.answersByQuestionID[question.id] ?? StructuredPromptAnswerDraft()

        if question.multiSelect == true {
            if draft.selectedOptions.contains(label) {
                draft.selectedOptions.remove(label)
            } else {
                draft.selectedOptions.insert(label)
            }
        } else {
            draft.selectedOptions = [label]
        }

        state.answersByQuestionID[question.id] = draft
        structuredPromptDraftBySession[prompt.sessionId] = state
    }

    func canSubmitStructuredPrompt(_ prompt: StructuredPromptRequest) -> Bool {
        return prompt.questions.allSatisfy { question in
            let draft = structuredPromptDraft(for: question, in: prompt)
            return question.isSatisfied(
                selectedOptions: draft.selectedOptions,
                freeText: draft.freeText
            )
        }
    }

    func structuredPromptSubmissions(for prompt: StructuredPromptRequest) -> [StructuredPromptSubmission] {
        synchronizeStructuredPromptDrafts(with: prompt)
        return prompt.questions.map { question in
            let draft = structuredPromptDraft(for: question, in: prompt)
            let optionOrder = (question.options ?? []).map(\.label)
            let orderedSelections = optionOrder.filter { draft.selectedOptions.contains($0) }
            let customSelections = draft.selectedOptions
                .filter { !optionOrder.contains($0) }
                .sorted()
            let trimmedFreeText = draft.freeText.trimmingCharacters(in: .whitespacesAndNewlines)
            var selectedOptions = orderedSelections + customSelections
            if selectedOptions.isEmpty,
               trimmedFreeText.isEmpty,
               question.allowsEmptySubmit == true,
               question.primaryTextInput?.required != true,
               question.requiresFreeText != true,
               let defaultOption = (question.options ?? []).first(where: { $0.recommended == true }) ?? (question.options ?? []).first {
                let defaultLabel = defaultOption.label.trimmingCharacters(in: .whitespacesAndNewlines)
                if !defaultLabel.isEmpty {
                    selectedOptions = [defaultLabel]
                }
            }
            return StructuredPromptSubmission(
                question: question.question,
                selectedOptions: selectedOptions,
                freeText: trimmedFreeText
            )
        }
    }

    var sidecarFailureMessage: String? {
        guard !isConnected else { return nil }
        let message = connectionLabel.trimmingCharacters(in: .whitespacesAndNewlines)
        guard message.localizedCaseInsensitiveContains("sidecar failed")
            || message.localizedCaseInsensitiveContains("failed to start sidecar")
            || message.localizedCaseInsensitiveContains("sidecar is not connected")
            || (message.contains("실행 보조 앱") && message.contains("실패")) else {
            return nil
        }
        return message.nonEmpty
    }

    static func isRawNullDayError(_ message: String) -> Bool {
        let normalized = message.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        return normalized.contains("cannot read properties of null")
            && normalized.contains("day")
    }

    static func userFacingMissionErrorMessage(_ message: String?) -> String {
        guard let message = message?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
            return "다시 시도하면 미션 후보를 새로 만들게요."
        }
        if isRawNullDayError(message) {
            return "다시 시도하면 미션 후보를 새로 만들게요."
        }
        if message.localizedCaseInsensitiveContains("sidecar") {
            return "Codex 연결을 다시 시작하면 오늘 실행을 새로 불러옵니다."
        }
        return message
    }

    nonisolated static func loadSelectedProvider(defaults: UserDefaults = .standard) -> AgentProvider {
        guard let raw = defaults.string(forKey: selectedProviderDefaultsKey),
              let provider = AgentProvider(rawValue: raw) else {
            return .codex
        }
        return provider
    }

    nonisolated static func saveSelectedProvider(_ provider: AgentProvider, defaults: UserDefaults = .standard) {
        defaults.set(provider.rawValue, forKey: selectedProviderDefaultsKey)
    }

    private static func loadMacOnboardingIntroCompleted(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: macOnboardingIntroCompletedDefaultsKey)
    }

    private static func loadMacOnboardingIntakeOnlyCompleted(defaults: UserDefaults = .standard) -> Bool {
        defaults.bool(forKey: macOnboardingIntakeOnlyCompletedDefaultsKey)
    }

    private static func saveMacOnboardingIntroCompleted(defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: macOnboardingIntroCompletedDefaultsKey)
    }

    private static func saveMacOnboardingIntakeOnlyCompleted(defaults: UserDefaults = .standard) {
        defaults.set(true, forKey: macOnboardingIntakeOnlyCompletedDefaultsKey)
    }

    private static func resetMacOnboardingIntroCompleted(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: macOnboardingIntroCompletedDefaultsKey)
    }

    private static func resetMacOnboardingIntakeOnlyCompleted(defaults: UserDefaults = .standard) {
        defaults.removeObject(forKey: macOnboardingIntakeOnlyCompletedDefaultsKey)
    }

    private static func resetMacOnboardingState(defaults: UserDefaults = .standard) {
        resetMacOnboardingIntroCompleted(defaults: defaults)
        resetMacOnboardingIntakeOnlyCompleted(defaults: defaults)
        defaults.removeObject(forKey: IntakeV2Store.stateDefaultsKey)
        defaults.removeObject(forKey: IntakeV2SourceManager.sourcesDefaultsKey)
        defaults.synchronize()
    }

    private static func loadWorkspaceOnboardingContext() -> OnboardingContext? {
        guard WorkspaceSettings.hasExplicitWorkspace else { return nil }
        return WorkspaceMemoryStore.loadOnboardingContext(workspaceRoot: WorkspaceSettings.resolvedURL().path)
    }

    @discardableResult
    func selectBipCoachSessionIfAvailable() -> Bool {
        guard let sessionId = bipCoach?.sessionId,
              sessions.contains(where: { $0.id == sessionId }) else {
            return false
        }
        selectedSessionID = sessionId
        return true
    }

    nonisolated static let questionReadyNotificationDefaultsKey = "agentic30.officeHours.questionReadyNotification"
    nonisolated static let longRunningCompletionNotificationDefaultsKey = "agentic30.longRunningCompletionNotification"

    /// Default-on toggle; absent key means enabled.
    var isQuestionReadyNotificationEnabled: Bool {
        UserDefaults.standard.object(forKey: Self.questionReadyNotificationDefaultsKey) as? Bool ?? true
    }

    /// Default-on toggle; absent key means enabled.
    var isLongRunningCompletionNotificationEnabled: Bool {
        UserDefaults.standard.object(forKey: Self.longRunningCompletionNotificationDefaultsKey) as? Bool ?? true
    }

    func requestOfficeHoursQuestionReadyOpen(
        sessionId: String,
        requestId: String? = nil,
        source: String = "notification_center"
    ) {
        var properties: [String: Any] = [
            "source": source,
        ]
        if let requestId {
            properties["requestId"] = requestId
        }
        PostHogTelemetry.capture(
            "mac_office_hours_question_ready_notification_opened",
            properties: properties,
            authSession: macAuthSession
        )

        guard sessions.contains(where: { $0.id == sessionId }) else { return }
        selectedSessionID = sessionId
    }

    func sentPromptPreview(for sessionID: String) -> String? {
        sentPromptPreviews[sessionID]?
            .last?
            .content
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty
    }

    func pendingPromptPreviews(for sessionID: String) -> [PendingPromptPreview] {
        sentPromptPreviews[sessionID]?
            .filter { $0.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil } ?? []
    }

    func sidecarOutputPreview(for sessionID: String) -> [String] {
        sidecarOutputLogs[sessionID] ?? []
    }

    func officeHoursLiveStatus(for sessionID: String?) -> OfficeHoursLiveStatus? {
        guard let sessionID else { return nil }
        return officeHoursLiveStatusBySession[sessionID]
    }

    var intakeV2BootLogState: IntakeV2BootLogState {
        IntakeV2BootLogState(
            isConnected: isConnected,
            workspaceRoot: workspaceRoot,
            diagnostics: sidecarDiagnostics,
            scanProgressLogs: scanProgressLogs,
            scanProgressSnapshots: scanProgressSnapshots,
            scanDidComplete: scanResult != nil,
            scanDidBlock: scanBlockedNotice != nil,
            scanBlockedMessage: scanBlockedNotice?.message,
            scanError: scanResult?.error,
            foundArtifactCount: scanResult?.foundArtifactCount,
            isScanning: isScanning,
            scanStartedAt: scanStartedAt,
            scanCompletedAt: scanCompletedAt
        )
    }

    var visibleBipCoach: BipCoachState? {
        guard let coach = bipCoach,
              let session = selectedSession,
              coach.sessionId == session.id else {
            return nil
        }
        return coach
    }

    var isDay1BipProofSinkAvailable: Bool {
        bipCoach?.isConfigured == true
    }

    var day1GoalDrafts: [Day1GoalDraft] {
        makeDay1GoalDrafts()
    }

    var isIddSetupBlockingWorkspace: Bool {
        !iddSetupComplete
    }

    func isMatchingFoundationPrompt(_ prompt: StructuredPromptRequest?) -> Bool {
        guard let prompt,
              prompt.isAgentic30StructuredInput,
              let promptDocType = prompt.generation?.docType?.lowercased(),
              !promptDocType.isEmpty else { return false }
        let expectedDocType = iddCurrentDocType?.lowercased()
        return expectedDocType == nil || expectedDocType == promptDocType
    }

    func isMismatchedFoundationPrompt(_ prompt: StructuredPromptRequest?) -> Bool {
        guard let prompt else { return false }
        return !isMatchingFoundationPrompt(prompt)
    }

    var requiresMacOnboarding: Bool {
        return !(WorkspaceSettings.hasExplicitWorkspace || macOnboardingIntakeOnlyCompleted)
            || onboardingContext == nil
            || !macOnboardingIntroCompleted
    }

    var canStartSidecar: Bool {
        !requiresMacOnboarding
    }

    var needsProjectWorkspace: Bool {
        !WorkspaceSettings.hasExplicitWorkspace
    }

    var needsOnboardingIntro: Bool {
        !macOnboardingIntroCompleted
    }

    var needsOnboardingContext: Bool {
        onboardingContext == nil
    }

    var signedInEmail: String? {
        macAuthSession?.email
    }

    var preferredPanelSize: CGSize {
        if requiresMacOnboarding {
            return CGSize(width: 760, height: 720)
        }

        return CGSize(width: 720, height: pendingStructuredPrompt == nil ? 660 : 600)
    }

    var canSend: Bool {
        (selectedSession != nil || canQueueStartupAction)
            && !draft.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
    }

    var canQueueStartupAction: Bool {
        canStartSidecar && selectedSession == nil
    }

    var isAnalyzeAdsCommand: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .hasPrefix("/analyze-ads")
    }

    var isBipDraftCommand: Bool {
        draft.trimmingCharacters(in: .whitespacesAndNewlines)
            .lowercased()
            .hasPrefix("/bip-draft")
    }

    func start() {
        start(allowOnboardingPrefetch: false, anchorFoundation: true)
    }

    private func start(allowOnboardingPrefetch: Bool, anchorFoundation: Bool) {
        guard !started else { return }
        let canStartForOnboardingPrefetch = allowOnboardingPrefetch
            && WorkspaceSettings.hasExplicitWorkspace
            && onboardingContext != nil
        guard !requiresMacOnboarding || canStartForOnboardingPrefetch else {
            connectionLabel = needsOnboardingContext ? "Complete local setup" : "Choose a project workspace"
            isConnected = false
            return
        }
        hydrateWorkspaceRootFromSettingsIfAvailable()
        hydrateWorkspaceScanResultFromCacheIfAvailable()
        started = true
        PostHogTelemetry.capture("mac_view_model_started", authSession: macAuthSession)

        // First successful start past the onboarding gate anchors Day 1 of
        // the Foundation phase. Subsequent calls are no-ops, keeping the
        // counter monotonic across reconnects, sidecar restarts, and app
        // relaunches.
        if anchorFoundation {
            ensureFoundationStarted()
        }

        if disablesSidecarStartForTesting {
            connectionLabel = "실행 보조 앱이 단위 테스트에서 비활성화됨"
            isConnected = false
            return
        }

        if CommandLine.arguments.contains("--ui-testing-sidecar-failure") {
            workspaceRoot = WorkspaceSettings.resolvedURL().path
            connectionLabel = "실행 보조 앱 시작 실패(signal 6). Node.js 상태를 확인하세요."
            isConnected = false
            ensureInlineUITestStubSession()
            PostHogTelemetry.capture("mac_sidecar_failure_stubbed_for_ui_tests", authSession: macAuthSession)
            return
        }

        #if DEBUG
        let disablesSidecarForUITesting = Self.uiTestingFlag(
            "--ui-testing-disable-sidecar",
            arguments: CommandLine.arguments
        )
        #else
        let disablesSidecarForUITesting = CommandLine.arguments.contains("--ui-testing-disable-sidecar")
        #endif

        if disablesSidecarForUITesting {
            if usesInlineUITestStubResponses {
                workspaceRoot = WorkspaceSettings.resolvedURL().path
                connectionLabel = "Connected (UI test stub)"
                isConnected = true
                ensureInlineUITestStubSession()
                appendInlineUITestDay1ICPConversationIfNeeded()
            } else {
                connectionLabel = "실행 보조 앱이 UI 테스트에서 비활성화됨"
                isConnected = false
            }
            PostHogTelemetry.capture("mac_sidecar_disabled_for_ui_tests", authSession: macAuthSession)
            return
        }

        sidecar.onEvent = { [weak self] event in
            Task { @MainActor in
                self?.handle(event)
            }
        }

        startupSessionAppearStartedAt = Date()
        startupSessionAppearElapsedMs = nil
        didRecordStartupSessionAppear = false
        sidecar.start()
        if macOnboardingStatus == .refreshing {
            refreshMacAuthIfNeeded()
        }
    }

    func stop() {
        PostHogTelemetry.capture("mac_view_model_stopped", authSession: macAuthSession)
        authSession?.cancel()
        authSession = nil
        integrationStatusChecking = false
        finishMcpOauthInFlightAfterSidecarInterruption(markFailedResult: false)
        finishExaMcpConnectAfterSidecarInterruption()
        stopRecorderClipboardCollector()
        sidecar.stop()
        started = false
        officeHoursSessionCreateInFlight = false
    }

    func reconnectSidecar() {
        guard canStartSidecar else { return }
        PostHogTelemetry.capture("mac_sidecar_reconnect_requested", authSession: macAuthSession)
        connectionLabel = "실행 보조 앱 다시 연결 중..."
        lastError = nil
        isConnected = false
        stopRecorderClipboardCollector()
        integrationStatusChecking = false
        isBipCoachRefreshing = false
        isBipCoachGenerating = false
        isBipCoachCompleting = false
        bipMissionProgress = nil
        finishMcpOauthInFlightAfterSidecarInterruption(markFailedResult: false)
        finishExaMcpConnectAfterSidecarInterruption()
        sidecar.stop()
        started = false
        requestedInitialBipGate = false
        requestedInitialBipMission = false
        officeHoursSessionCreateInFlight = false
        start()
    }

    func showWorkspace() {
        guard !requiresMacOnboarding, selectedSession != nil else { return }
        activeSurface = .workspace
        PostHogTelemetry.capture("mac_workspace_surface_opened", authSession: macAuthSession)
    }

    func showAssistantBubble() {
        activeSurface = .assistantBubble
        PostHogTelemetry.capture("mac_assistant_surface_opened", authSession: macAuthSession)
    }

    @discardableResult
    func createSession(
        provider: AgentProvider? = nil,
        source: String? = nil,
        suppressBootstrapIntake: Bool = false,
        officeHoursDay: Int? = nil
    ) -> Bool {
        let resolvedProvider = provider ?? selectedProvider
        let model = preferredModel(for: resolvedProvider)
        var properties: [String: Any] = [
            "provider": resolvedProvider.rawValue,
            "model": model,
        ]
        if let source = source?.trimmingCharacters(in: .whitespacesAndNewlines),
           !source.isEmpty {
            properties["source"] = source
        }
        PostHogTelemetry.capture(
            "mac_session_create_requested",
            properties: properties,
            authSession: macAuthSession
        )
        var payload: [String: Any] = [
            "type": "create_session",
            "provider": resolvedProvider.rawValue,
            "model": model,
        ]
        if let source = source?.trimmingCharacters(in: .whitespacesAndNewlines),
           !source.isEmpty {
            payload["source"] = source
        }
        if suppressBootstrapIntake || !iddSetupComplete {
            payload["suppressBootstrapIntake"] = true
        }
        if let officeHoursDay, officeHoursDay > 0 {
            payload["officeHoursDay"] = officeHoursDay
        }
        return sidecar.send(payload: payload)
    }

    @discardableResult
    func ensureOfficeHoursSession(forDay day: Int? = nil) -> Bool {
        let scopedDay = normalizedOfficeHoursDay(day)
        #if DEBUG
        if installUITestingOfficeHoursSeedSessionIfNeeded() {
            return true
        }
        #endif
        if let scopedDay,
           let session = officeHoursSession(forDay: scopedDay) {
            selectedSessionID = session.id
            officeHoursSessionCreateInFlight = false
            return true
        }
        if let selectedSession, canUseSessionForOfficeHours(selectedSession, day: scopedDay) {
            officeHoursSessionCreateInFlight = false
            return true
        }
        guard isConnected else { return false }
        guard !officeHoursSessionCreateInFlight else { return false }

        officeHoursSessionCreateInFlight = true
        if createSession(
            provider: selectedProvider,
            source: scopedDay.map { "office_hours_screen_day_\($0)" } ?? "office_hours_screen",
            suppressBootstrapIntake: true,
            officeHoursDay: scopedDay
        ) {
            return false
        }
        officeHoursSessionCreateInFlight = false
        return false
    }

    #if DEBUG
    @discardableResult
    private func installUITestingOfficeHoursSeedSessionIfNeeded() -> Bool {
        // UI-testing seed installers are gated solely by their own CommandLine
        // arg (and are idempotent). They must run regardless of the requested
        // day: the day-scoped Office Hours screen always calls this with a
        // concrete `activeDay` (>= 1, see `activeOfficeHoursDay`), so a
        // `scopedDay == nil` precondition would orphan the seeds entirely.
        if installUITestingOfficeHoursDailyCardStackSessionIfNeeded() {
            return true
        }
        if installUITestingOfficeHoursDay2CompletedSessionIfNeeded() {
            return true
        }
        if installUITestingOfficeHoursCommitmentGateSessionIfNeeded() {
            return true
        }
        if installUITestingOfficeHoursReadinessFollowupSessionIfNeeded() {
            return true
        }
        if installUITestingOfficeHoursDay1DocReadySessionIfNeeded() {
            return true
        }
        if installUITestingOfficeHoursRunningSessionIfNeeded() {
            return true
        }
        if installUITestingOfficeHoursStructuredPromptSessionIfNeeded() {
            return true
        }
        return false
    }
    #endif

    func officeHoursSession(forDay day: Int) -> ChatSession? {
        let scopedDay = normalizedOfficeHoursDay(day)
        return sessions.first { session in
            guard session.archivedAt == nil else { return false }
            return canUseSessionForOfficeHours(session, day: scopedDay)
        }
    }

    func canUseSessionForOfficeHours(_ session: ChatSession, day: Int? = nil) -> Bool {
        let requestedDay = normalizedOfficeHoursDay(day)
        if let officeHours = session.runtime?.officeHours {
            if let requestedDay {
                if let runtimeDay = normalizedOfficeHoursDay(officeHours.day) {
                    guard runtimeDay == requestedDay else { return false }
                } else {
                    guard requestedDay == 1 else { return false }
                }
            }
            return true
        }
        if session.runtime?.officeHours?.active == true {
            return true
        }
        if let pendingUserInput = session.pendingUserInput {
            let looksLikeOfficeHours = pendingUserInput.title?.caseInsensitiveCompare("Office Hours") == .orderedSame
                || pendingUserInput.generation?.mode?.hasPrefix("office_hours") == true
            guard looksLikeOfficeHours else { return false }
            return requestedDay == nil || requestedDay == 1
        }
        if session.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil {
            if let requestedDay {
                if let titleDay = Self.officeHoursDay(fromTitle: session.title) {
                    return titleDay == requestedDay
                }
                return requestedDay == 1
            }
            return true
        }
        if requestedDay != nil { return false }
        if session.messages.isEmpty {
            return true
        }
        return session.messages.allSatisfy { message in
            guard message.role == .user else { return false }
            let content = message.content.trimmingCharacters(in: .whitespacesAndNewlines)
            return content.caseInsensitiveCompare(OfficeHoursTranscriptRow.syntheticStartPrompt) == .orderedSame
                || content.caseInsensitiveCompare(OfficeHoursTranscriptRow.legacySyntheticStartPrompt) == .orderedSame
        }
    }

    private func normalizedOfficeHoursDay(_ day: Int?) -> Int? {
        guard let day, day > 0 else { return nil }
        return day
    }

    private static func officeHoursDay(fromTitle title: String) -> Int? {
        guard let range = title.range(
            of: #"Day\s+(\d+)"#,
            options: [.regularExpression, .caseInsensitive]
        ) else { return nil }
        let match = String(title[range])
        guard let numberRange = match.range(of: #"\d+"#, options: .regularExpression) else { return nil }
        return Int(match[numberRange])
    }

    @discardableResult
    func ensureDay999OfficeHoursSession() -> Bool {
        ensureOfficeHoursSession(forDay: 999)
    }

    private func createReplacementSessionIfNeeded(source: String) {
        guard iddSetupComplete,
              sessions.allSatisfy({ $0.archivedAt != nil }),
              !replacementSessionCreateInFlight else { return }
        replacementSessionCreateInFlight = true
        if !createSession(provider: selectedProvider, source: source) {
            replacementSessionCreateInFlight = false
        }
    }

    func deleteSelectedSession() {
        guard let session = selectedSession else { return }
        PostHogTelemetry.capture("mac_session_delete_requested", properties: [
            "session_id": session.id,
            "provider": session.provider.rawValue,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "delete_session",
            "sessionId": session.id,
        ])
    }

    func archiveSession(_ session: ChatSession, source: String? = nil) {
        var properties: [String: Any] = [
            "session_id": session.id,
            "provider": session.provider.rawValue,
        ]
        if let source = source?.trimmingCharacters(in: .whitespacesAndNewlines),
           !source.isEmpty {
            properties["source"] = source
        }
        PostHogTelemetry.capture(
            "mac_session_archive_requested",
            properties: properties,
            authSession: macAuthSession
        )

        let archivedAt = Date()
        guard isConnected else {
            lastError = "실행 보조 앱이 연결되지 않았습니다."
            PostHogTelemetry.capture(
                "mac_session_archive_failed",
                properties: properties.merging(["reason": "sidecar_disconnected"]) { current, _ in current },
                authSession: macAuthSession
            )
            return
        }
        guard sidecar.send(payload: [
            "type": "archive_session",
            "sessionId": session.id,
            "archivedAt": Self.sidecarDateString(from: archivedAt),
        ]) else {
            lastError = "실행 보조 앱이 연결되지 않았습니다."
            PostHogTelemetry.capture(
                "mac_session_archive_failed",
                properties: properties.merging(["reason": "send_failed"]) { current, _ in current },
                authSession: macAuthSession
            )
            return
        }

        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index].archivedAt = archivedAt
        }
        if selectedSessionID == session.id {
            selectedSessionID = sessions.first(where: { $0.id != session.id && $0.archivedAt == nil })?.id
        }
        refreshPresentationState()

        createReplacementSessionIfNeeded(source: "archive_last_visible_session")
    }

    func stopSelectedSession() {
        guard let session = selectedSession else { return }
        PostHogTelemetry.capture("mac_session_stop_requested", properties: [
            "session_id": session.id,
            "provider": session.provider.rawValue,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "stop_session",
            "sessionId": session.id,
        ])
    }

    /// Switches the active AI provider used for new sessions, persists it, and
    /// immediately re-points the currently selected session at the new provider
    /// so a blocked session (e.g. office-hours after a usage limit) can retry on
    /// it without starting a new chat.
    func setActiveProvider(_ provider: AgentProvider) {
        if provider != selectedProvider {
            selectedProvider = provider // didSet persists the choice
            PostHogTelemetry.capture("mac_active_provider_changed", properties: [
                "provider": provider.rawValue,
            ], authSession: macAuthSession)
        }
        // Re-point the selected session even when the global default already
        // matches — a blocked session can lag behind `selectedProvider`.
        guard let session = selectedSession, session.provider != provider else { return }
        sidecar.send(payload: [
            "type": "update_session_provider",
            "sessionId": session.id,
            "provider": provider.rawValue,
        ])
    }

    func retryLastFailedChatTurn() {
        guard let session = selectedSession else { return }
        guard let failedIndex = session.messages.lastIndex(where: { $0.role == .assistant && $0.state == .error }) else {
            return
        }
        let previousMessages = session.messages[..<failedIndex]
        guard let userMessage = previousMessages.last(where: { $0.role == .user }),
              let prompt = userMessage.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
            return
        }
        draft = prompt
        sendPrompt()
    }

    /// Classify a draft prompt into one of the three routing modes. Pure
    /// function — exposed for tests, UI affordances (e.g., the chip that
    /// shows *"오늘 과제"* vs. *"sub-workflow"*), and to keep `sendPrompt`
    /// declarative. The order of checks is significant:
    ///   1. Slash-commands always win (sub-workflow tag).
    ///   2. The first user message inside a Foundation Day 0/2-7 session is
    ///      the daily-task response.
    ///   3. Everything else is free-chat.
    ///
    /// `foundationDayOverride` lets unit tests pin a specific day without
    /// rewinding `foundationStartedAt`.
    func classifyMessageRoute(
        prompt: String,
        in session: ChatSession,
        foundationDayOverride: Int? = nil
    ) -> ChatMessageRoute {
        let trimmed = prompt.trimmingCharacters(in: .whitespacesAndNewlines)
        let lower = trimmed.lowercased()

        for workflow in [
            ChatMessageRoute.SubWorkflow.analyzeAds,
            .bipDraft,
            .officeHoursDocs,
            .monetizationAsk,
            .foundationSummary,
        ] {
            if lower.hasPrefix(workflow.commandPrefix) {
                return .subWorkflow(workflow)
            }
        }

        let day = foundationDayOverride ?? foundationDayNumber
        let userMessageCount = session.messages.filter { $0.role == .user }.count
        if userMessageCount == 0,
           let day,
           (0...7).contains(day) {
            return .dailyTask(foundationDay: day)
        }

        return .freeChat
    }

    /// Live route classification for the current draft against the selected
    /// session. Returns `nil` when there is no draft or no session — UI
    /// chips can use this to hide themselves cleanly.
    var currentMessageRoute: ChatMessageRoute? {
        let trimmed = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty, let session = selectedSession else { return nil }
        return classifyMessageRoute(prompt: trimmed, in: session)
    }

    /// Day-1 situation card → goal concretization. Sends the chosen goal as a
    /// normal chat prompt through the existing pipeline (draft + sendPrompt).
    func submitDay1SituationGoal(_ text: String) {
        let trimmed = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return }
        draft = "Day 1에서 \"\(trimmed)\"을(를) 오늘 실행할 검증 행동으로 고르고 싶어. 한 문장 실행 계획으로 구체화해줘."
        sendPrompt()
    }

    @discardableResult
    func requestDay1GoalState(workspaceRoot explicitRoot: String? = nil) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return false }
        return sidecar.send(payload: [
            "type": "day1_goal_get",
            "workspaceRoot": root,
        ])
    }

    @discardableResult
    func saveDay1GoalSelection(_ selection: Day1GoalSelection, workspaceRoot explicitRoot: String? = nil) -> Bool {
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else {
            day1GoalError = "Workspace 경로가 비어 있습니다."
            return false
        }
        guard isConnected else {
            #if DEBUG
            if Self.isUITesting(arguments: CommandLine.arguments)
                && CommandLine.arguments.contains("--ui-testing-disable-sidecar") {
                applyDay1GoalSelectionLocally(selection, root: root)
                return true
            }
            #endif
            day1GoalError = "실행 보조 앱 연결 후 목표를 저장할 수 있습니다."
            return false
        }
        applyDay1GoalSelectionLocally(selection, root: root)
        let sent = sidecar.send(payload: [
            "type": "day1_goal_save",
            "workspaceRoot": root,
            "selection": selection.bridgePayload,
        ])
        if !sent {
            day1GoalError = "목표 저장 요청을 실행 보조 앱으로 보내지 못했습니다."
        }
        return sent
    }

    private func applyDay1GoalSelectionLocally(_ selection: Day1GoalSelection, root: String) {
        day1GoalError = nil
        day1GoalSelection = selection
        if let current = scanResult {
            let updated = current.withDay1GoalSelection(selection)
            scanResult = updated
            persistWorkspaceScanResultCache(updated, root: root)
        }
    }

    @discardableResult
    func saveDay1GoalDraft(_ draft: Day1GoalDraft, workspaceRoot explicitRoot: String? = nil) -> Bool {
        saveDay1GoalSelection(draft.makeSelection(), workspaceRoot: explicitRoot)
    }

    @discardableResult
    func requestDayProgress(workspaceRoot explicitRoot: String? = nil) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return false }
        return sidecar.send(payload: [
            "type": "day_progress_get",
            "workspaceRoot": root,
        ])
    }

    @discardableResult
    func markDayStep(
        day: Int,
        stepId: String,
        status: DayStepStatus,
        goalText: String? = nil,
        commitmentText: String? = nil,
        commitment: CommitmentDraft? = nil,
        confession: String? = nil,
        predictionText: String? = nil,
        predictionVerdict: String? = nil,
        sessionID: String? = nil,
        workspaceRoot explicitRoot: String? = nil
    ) -> Bool {
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        #if DEBUG
        if Self.isUITesting(arguments: CommandLine.arguments),
           CommandLine.arguments.contains("--ui-testing-disable-sidecar"),
           ProcessInfo.processInfo.environment["AGENTIC30_TEST_STUB_PROVIDER"] == "1" {
            applyUITestingDayStepPatchLocally(
                day: day,
                stepId: stepId,
                status: status,
                goalText: goalText
            )
            return true
        }
        #endif
        guard isConnected else {
            return false
        }
        guard !root.isEmpty else { return false }
        var payload: [String: Any] = [
            "type": "day_progress_patch",
            "workspaceRoot": root,
            "day": day,
            "stepId": stepId,
            "status": status.rawValue,
        ]
        if let goalText { payload["goalText"] = goalText }
        // Interview/first_interview completion gate (block-once-then-confession): the
        // sidecar requires one of these to mark an interview step done. The founder's
        // typed next customer action (user-origin), or the reason they're holding the gate.
        if let commitmentText, !commitmentText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["commitmentText"] = commitmentText
        }
        if let commitment {
            payload["commitment"] = commitment.payload
        }
        if let confession, !confession.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["confession"] = confession
        }
        // calibration-lite (additive): a forecast for this cycle, and/or a verdict on the
        // prior cycle's forecast. The sidecar grades-then-captures so the order is safe.
        if let predictionText, !predictionText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["predictionText"] = predictionText
        }
        if let predictionVerdict, !predictionVerdict.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
            payload["predictionVerdict"] = predictionVerdict
        }
        if let sessionID = sessionID?.trimmingCharacters(in: .whitespacesAndNewlines), !sessionID.isEmpty {
            payload["sessionId"] = sessionID
        }
        return sidecar.send(payload: payload)
    }

    private func applyUITestingDayStepPatchLocally(
        day: Int,
        stepId: String,
        status: DayStepStatus,
        goalText: String?
    ) {
        #if DEBUG
        let dayNumber = max(1, day)
        let kind = DayLoopSteps.kind(forDay: dayNumber)
        var steps: [String: DayStepStatus] = [:]
        for id in DayLoopSteps.ids(forDay: dayNumber, kind: kind) {
            steps[id] = .pending
        }
        let existing = dayProgress?.record(forDay: dayNumber)
        steps.merge(existing?.steps ?? [:]) { _, current in current }
        steps[stepId] = status

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())
        let updatedRecord = DayRecord(
            day: dayNumber,
            kind: kind,
            steps: steps,
            goalText: goalText ?? existing?.goalText ?? day1GoalSelection?.goalText ?? "",
            updatedAt: today
        )
        var days = dayProgress?.days ?? [:]
        days[String(dayNumber)] = updatedRecord
        dayProgress = DayProgress(
            challengeStartedAt: dayProgress?.challengeStartedAt ?? today,
            days: days
        )
        commitmentGateMessage = nil
        commitmentGateStep = nil
        refreshPresentationState()
        #endif
    }

    /// Ask the sidecar for commitment-close candidates derived from this interview's
    /// own answers. Idempotent per session: once a generation is in flight or results
    /// landed, repeat calls are no-ops, so the view can call this on every layout pass
    /// after the last forcing question. Fail-open by design — the close never blocks
    /// on this; the bar always keeps its "직접 적기" path.
    @discardableResult
    func requestOfficeHoursCommitmentCandidates(
        sessionID: String,
        day: Int? = nil,
        provider: AgentProvider? = nil
    ) -> Bool {
        let id = sessionID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty else { return false }
        guard officeHoursCommitmentCandidatesBySession[id] == nil,
              !officeHoursCommitmentCandidatesGenerating.contains(id) else { return true }
        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        #if DEBUG
        if CommandLine.arguments.contains("--ui-testing-disable-sidecar"),
           ProcessInfo.processInfo.environment["AGENTIC30_TEST_STUB_PROVIDER"] == "1" {
            officeHoursCommitmentCandidatesGenerating.remove(id)
            officeHoursCommitmentCandidatesBySession[id] = []
            return true
        }
        #endif
        // Every failure path resolves to an EMPTY ready result: the commitment bar
        // reveals on a resolved entry, so a disconnected sidecar (UI tests run with
        // --ui-testing-disable-sidecar) must never leave the close stuck on a loader.
        guard isConnected, !root.isEmpty else {
            officeHoursCommitmentCandidatesBySession[id] = []
            return false
        }
        var payload: [String: Any] = [
            "type": "office_hours_commitment_candidates_request",
            "workspaceRoot": root,
            "sessionId": id,
        ]
        if let day { payload["day"] = day }
        if let provider { payload["provider"] = provider.rawValue }
        // Optimistic: mark generating immediately so a second layout pass doesn't
        // double-send before the sidecar's "generating" broadcast arrives.
        officeHoursCommitmentCandidatesGenerating.insert(id)
        let sent = sidecar.send(payload: payload)
        if !sent {
            officeHoursCommitmentCandidatesGenerating.remove(id)
            officeHoursCommitmentCandidatesBySession[id] = []
        }
        return sent
    }

    /// Safety valve for sidecar/app version skew: an older sidecar that doesn't know
    /// the candidates request would leave `generating` set forever and hold the
    /// commitment close behind a loader. Resolves the session to an empty ready
    /// result; a no-op once a real result landed.
    func resolveStalledOfficeHoursCommitmentCandidates(sessionID: String) {
        let id = sessionID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !id.isEmpty, officeHoursCommitmentCandidatesBySession[id] == nil else { return }
        officeHoursCommitmentCandidatesGenerating.remove(id)
        officeHoursCommitmentCandidatesBySession[id] = []
    }

    @discardableResult
    func submitOfficeHoursCommitmentEvidence(
        commitmentId: String,
        kind: String,
        url: String,
        note: String,
        workspaceRoot explicitRoot: String? = nil
    ) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        let id = commitmentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !id.isEmpty else { return false }
        return sidecar.send(payload: [
            "type": "office_hours_commitment_evidence",
            "workspaceRoot": root,
            "commitmentId": id,
            "evidence": [
                "kind": kind.trimmingCharacters(in: .whitespacesAndNewlines),
                "url": url.trimmingCharacters(in: .whitespacesAndNewlines),
                "note": note.trimmingCharacters(in: .whitespacesAndNewlines),
            ],
        ])
    }

    @discardableResult
    func carryForwardOfficeHoursCommitment(
        commitmentId: String,
        workspaceRoot explicitRoot: String? = nil
    ) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        let id = commitmentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !id.isEmpty else { return false }
        var payload: [String: Any] = [
            "type": "office_hours_commitment_carry_forward",
            "workspaceRoot": root,
            "commitmentId": id,
        ]
        if let currentDay = dayProgress?.currentDayNumber() {
            payload["day"] = currentDay
        }
        return sidecar.send(payload: payload)
    }

    @discardableResult
    func abandonOfficeHoursCommitment(
        commitmentId: String,
        reason: String,
        workspaceRoot explicitRoot: String? = nil
    ) -> Bool {
        guard isConnected else { return false }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        let id = commitmentId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !id.isEmpty else { return false }
        return sidecar.send(payload: [
            "type": "office_hours_commitment_abandon",
            "workspaceRoot": root,
            "commitmentId": id,
            "reason": reason.trimmingCharacters(in: .whitespacesAndNewlines),
        ])
    }

    @discardableResult
    func submitOfficeHoursDailyCard(
        _ card: SidecarEvent.MissionCard.DailyCard,
        action: String,
        choiceId: String? = nil,
        resolutionReason: String? = nil,
        evidenceRefs: [[String: String]] = [],
        replacementCandidate: [String: Any]? = nil,
        note: String? = nil,
        workspaceRoot explicitRoot: String? = nil
    ) -> Bool {
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        let cardId = (card.id ?? card.stableID).trimmingCharacters(in: .whitespacesAndNewlines)
        let sourceCommitmentId = (card.sourceCommitmentId
            ?? card.stateTransition?.sourceCommitmentId
            ?? card.stateTransition?.commitmentId
            ?? card.agentWorkpack?.sourceCommitmentId
            ?? ""
        ).trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedAction = action.trimmingCharacters(in: .whitespacesAndNewlines)
        let cardGenerationId = card.generation.generationId?.trimmingCharacters(in: .whitespacesAndNewlines)
        let sourceStateVersion = card.sourceStateVersion?.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !cardId.isEmpty, !sourceCommitmentId.isEmpty, !trimmedAction.isEmpty else {
            lastError = "Daily card submission is missing card, source commitment, action, or workspace."
            return false
        }
        guard (cardGenerationId?.isEmpty == false) || (sourceStateVersion?.isEmpty == false) else {
            lastError = "Daily card submission is missing card generation or source-state version."
            return false
        }
        guard trimmedAction != "replace_candidate" || replacementCandidate != nil else {
            lastError = "Daily card replacement requires the next candidate and next action."
            return false
        }
        guard isConnected else {
            lastError = "Daily card submission could not be sent because the sidecar is disconnected."
            return false
        }
        var payload: [String: Any] = [
            "type": "office_hours_daily_card_submit",
            "workspaceRoot": root,
            "cardId": cardId,
            "cardType": card.type.rawValue,
            "sourceCommitmentId": sourceCommitmentId,
            "action": trimmedAction,
            "choiceId": (choiceId ?? trimmedAction).trimmingCharacters(in: .whitespacesAndNewlines),
            "programDay": card.programDay,
        ]
        if let cardGenerationId, !cardGenerationId.isEmpty {
            payload["cardGenerationId"] = cardGenerationId
        }
        if let sourceStateVersion, !sourceStateVersion.isEmpty {
            payload["sourceStateVersion"] = sourceStateVersion
        }
        if let reason = resolutionReason?.trimmingCharacters(in: .whitespacesAndNewlines), !reason.isEmpty {
            payload["resolutionReason"] = reason
        }
        if !evidenceRefs.isEmpty {
            payload["evidenceRefs"] = evidenceRefs
        }
        if let replacementCandidate {
            payload["replacementCandidate"] = replacementCandidate
        }
        if let note = note?.trimmingCharacters(in: .whitespacesAndNewlines), !note.isEmpty {
            payload["note"] = note
            payload["originText"] = note
        }
        return sidecar.send(payload: payload)
    }

    @discardableResult
    func startOfficeHours(
        sessionID: String,
        context: String,
        source: String = "office_hours_screen",
        day: Int? = nil,
        selectedSources: [String] = [],
        trigger: String? = nil
    ) -> Bool {
        let trimmedSessionID = sessionID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedSessionID.isEmpty else { return false }
        guard isConnected else {
            lastError = "실행 보조 앱 연결 후 Office Hours를 시작할 수 있습니다."
            return false
        }

        let trimmedContext = context.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedSource = source.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty ?? "office_hours_screen"
        let scopedDay = normalizedOfficeHoursDay(day)
        let normalizedSelectedSources = selectedSources
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .sorted()
        let trimmedTrigger = trigger?
            .trimmingCharacters(in: .whitespacesAndNewlines)
            .nonEmpty
        PostHogTelemetry.capture(
            "mac_office_hours_start_requested",
            properties: [
                "session_id": trimmedSessionID,
                "context_length": trimmedContext.count,
                "source": trimmedSource,
                "day": scopedDay ?? 0,
                "selected_source_count": normalizedSelectedSources.count,
                "trigger": trimmedTrigger ?? "",
            ],
            authSession: macAuthSession
        )

        var payload: [String: Any] = [
            "type": "office_hours_start",
            "sessionId": trimmedSessionID,
            "source": trimmedSource,
            "visiblePrompt": "Office Hours",
            "context": trimmedContext,
        ]
        if let scopedDay {
            payload["day"] = scopedDay
        }
        if !normalizedSelectedSources.isEmpty {
            payload["selectedSources"] = normalizedSelectedSources
        }
        if let trimmedTrigger {
            payload["trigger"] = trimmedTrigger
        }
        let sent = sidecar.send(payload: payload)
        if sent, trimmedTrigger != nil {
            ohInterventionRequired = nil
        }
        return sent
    }

    @discardableResult
    func startDay999OfficeHours(sessionID: String, context: String) -> Bool {
        startOfficeHours(sessionID: sessionID, context: context, day: 999)
    }

    func refreshOfficeHoursSourceGate(
        sessionID: String? = nil,
        day: Int,
        selectedSources: [String] = []
    ) {
        guard isConnected else { return }
        guard let scopedDay = normalizedOfficeHoursDay(day), scopedDay >= 2 else { return }
        var payload: [String: Any] = [
            "type": "office_hours_source_gate_get",
            "day": scopedDay,
            "provider": selectedProvider.rawValue,
        ]
        let normalizedSessionID = sessionID?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        if let normalizedSessionID {
            payload["sessionId"] = normalizedSessionID
        }
        let normalizedSelectedSources = selectedSources
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .sorted()
        if !normalizedSelectedSources.isEmpty {
            payload["selectedSources"] = normalizedSelectedSources
        }
        _ = sidecar.send(payload: payload)
    }

    func sendPrompt() {
        let prompt = draft.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !prompt.isEmpty else { return }
        guard let session = selectedSession else {
            markWorkspaceSetupFirstRealInput()
            queueStartupAction(.prompt(prompt))
            draft = ""
            return
        }
        if let pendingUserInput = session.pendingUserInput {
            let responses = pendingUserInput.questions.map { question in
                StructuredPromptSubmission(
                    question: question.question,
                    selectedOptions: [],
                    freeText: prompt
                )
            }
            draft = ""
            submitStructuredPrompt(sessionId: session.id, requestId: pendingUserInput.requestId, responses: responses)
            return
        }

        // Sub-AC 2: classify once, then route. Daily-task, sub-workflow, and
        // free-chat all share the same `send_prompt` transport — only the
        // metadata differs, so the chat surface stays a single message
        // stream with no fork.
        let route = classifyMessageRoute(prompt: prompt, in: session)

        // Provider validation. Sub-workflows that require Claude (currently
        // /analyze-ads and /foundation-summary) fail-closed before we hit
        // the sidecar — no half-routed sends, no stale telemetry.
        if case .subWorkflow(let workflow) = route,
           workflow.requiresClaudeProvider,
           session.provider != .claude {
            lastError = "\(workflow.commandPrefix) requires a Claude session"
            PostHogTelemetry.capture("mac_prompt_validation_failed", properties: [
                "session_id": session.id,
                "provider": session.provider.rawValue,
                "reason": "\(workflow.rawValue)_requires_claude",
                "mode": route.modeTag,
            ], authSession: macAuthSession)
            return
        }

        markWorkspaceSetupFirstRealInput()
        PostHogTelemetry.capture("mac_prompt_send_requested", properties: [
            "session_id": session.id,
            "provider": session.provider.rawValue,
            "command_kind": route.commandKind,
            "mode": route.modeTag,
            "sub_workflow": route.subWorkflowName ?? "",
            "foundation_day": route.foundationDay ?? -1,
            "prompt_length": prompt.count,
        ], authSession: macAuthSession)
        appendSentPromptPreview(sessionID: session.id, prompt: prompt)
        sidecarOutputLogs[session.id] = []
        draft = ""
        if usesInlineUITestStubResponses {
            appendInlineUITestStubResponse(prompt: prompt, sessionID: session.id)
            return
        }

        // Single transport, three modes. Sidecar inspects `mode` to decide
        // whether to load the matching sub-workflow prompt module
        // (`*-prompt.mjs`) or fall through to the default chat loop.
        var payload: [String: Any] = [
            "type": "send_prompt",
            "sessionId": session.id,
            "prompt": prompt,
            "mode": route.modeTag,
        ]
        if let subWorkflowName = route.subWorkflowName {
            payload["subWorkflow"] = subWorkflowName
        }
        if let foundationDay = route.foundationDay {
            payload["foundationDay"] = foundationDay
        }
        sidecar.send(payload: payload)
    }

    /// Stable key used by both the request side and the inject side so the
    /// idempotency invariant ("one first-prompt per session-day pair") is
    /// expressed in one place. Pure function, exposed `internal` for tests.
    ///
    static func foundationFirstPromptKey(sessionId: String, day: Int) -> String {
        return "\(sessionId):day-\(day)"
    }

    /// Deterministic chat message ID used when injecting the AI-driven
    /// Foundation first prompt into the chat surface. Encodes the day so the
    /// merge logic in `mergeSessionSnapshot` can recognise client-only seeded
    /// messages and preserve them across `session_updated` snapshots from the
    /// sidecar (which would otherwise wipe the seed because the sidecar does
    /// not persist the first prompt itself — it is regenerated on demand by
    /// `buildFirstPromptForDay`).
    static func foundationFirstPromptMessageId(sessionId: String, day: Int) -> String {
        "foundation-first-prompt-day-\(day)-\(sessionId)"
    }

    /// Prefix that flags a chat message as a host-side Foundation first
    /// prompt seed. `mergeSessionSnapshot` keys off this prefix to preserve
    /// the seed when the sidecar pushes a session snapshot that does not
    /// include it (the sidecar only persists user/assistant turns produced by
    /// the provider stream, not the deterministic opener).
    static let foundationFirstPromptMessageIdPrefix = "foundation-first-prompt-"

    /// Sub-AC 2.4 — request the AI-driven Foundation Day 0/2-7 first prompt
    /// from the sidecar and inject it into the chat surface as the seeded
    /// assistant opener. The unified single AI interaction surface contract:
    /// one channel, day-aware, no second transport.
    ///
    /// Idempotency is two-layered:
    ///   1. `pendingFoundationFirstPromptKeys` short-circuits duplicate sends
    ///      while the sidecar is still computing (covers double-taps).
    ///   2. `injectedFoundationFirstPromptKeys` short-circuits re-injection
    ///      after the sidecar has already replied (covers reconnect replays).
    ///
    /// The sidecar's response is dispatched in `handle(_:)` via
    /// `case "foundation_first_prompt"` → `handleFoundationFirstPromptEvent`.
    func requestFoundationFirstPrompt(
        day: Int,
        sessionId: String? = nil,
        dynamicVariables: [String: Any]? = nil
    ) {
        let resolvedSessionId = sessionId ?? currentBipCoachSessionID()
        guard let resolvedSessionId, !resolvedSessionId.isEmpty else { return }
        guard isConnected else { return }
        guard (0...7).contains(day), day != 1 else {
            PostHogTelemetry.capture(
                "mac_foundation_first_prompt_request_rejected",
                properties: [
                    "session_id": resolvedSessionId,
                    "day": day,
                    "reason": day == 1 ? "day1_opendesign_surface" : "day_out_of_range",
                ],
                authSession: macAuthSession
            )
            return
        }

        let key = Self.foundationFirstPromptKey(sessionId: resolvedSessionId, day: day)
        if injectedFoundationFirstPromptKeys.contains(key) { return }
        if pendingFoundationFirstPromptKeys.contains(key) { return }

        pendingFoundationFirstPromptKeys.insert(key)

        var payload: [String: Any] = [
            "type": "foundation_first_prompt",
            "sessionId": resolvedSessionId,
            "day": day,
        ]
        if let dynamicVariables, !dynamicVariables.isEmpty {
            payload["dynamicVariables"] = dynamicVariables
        }

        PostHogTelemetry.capture(
            "mac_foundation_first_prompt_requested",
            properties: [
                "session_id": resolvedSessionId,
                "day": day,
                "has_dynamic_variables": (dynamicVariables?.isEmpty == false),
            ],
            authSession: macAuthSession
        )

        sidecar.send(payload: payload)
    }

    /// Sub-AC 2.4 — handler for `foundation_first_prompt` sidecar events.
    /// Injects the rendered 3-section minimal opener into the target session
    /// as a seeded assistant message with a deterministic ID so subsequent
    /// `session_updated` merges keep it intact (see
    /// `mergeSessionSnapshot`'s preservation rule for the
    /// `foundation-first-prompt-` prefix).
    ///
    /// Visibility: `internal` so unit tests can exercise the inject path
    /// without spinning up a real sidecar bridge.
    func handleFoundationFirstPromptEvent(_ event: SidecarEvent) {
        guard let sessionId = event.sessionId, !sessionId.isEmpty else { return }
        guard let day = event.day, (0...7).contains(day) else { return }
        guard let firstPrompt = event.firstPrompt else { return }

        let key = Self.foundationFirstPromptKey(sessionId: sessionId, day: day)
        pendingFoundationFirstPromptKeys.remove(key)

        guard let sessionIndex = sessions.firstIndex(where: { $0.id == sessionId }) else {
            // Session not yet present in the local snapshot — drop, the next
            // `session_created` / `sessions_snapshot` will retrigger the
            // request flow from the surface that owns it.
            return
        }

        let messageId = Self.foundationFirstPromptMessageId(sessionId: sessionId, day: day)
        let existingIndex = sessions[sessionIndex].messages.firstIndex(where: { $0.id == messageId })

        if existingIndex != nil {
            // Already injected and not a richer payload — keep guard, bail
            // without telemetry noise.
            injectedFoundationFirstPromptKeys.insert(key)
            return
        }

        let displayText = firstPrompt.text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !displayText.isEmpty else { return }

        let provider = sessions[sessionIndex].provider
        let now = Date()
        let seededMessage = ChatMessage(
            id: messageId,
            role: .assistant,
            provider: provider,
            content: displayText,
            state: .final,
            createdAt: now,
            error: nil,
            bipMissionChoices: nil,
            providerAuthActions: nil
        )

        // Insert at the head so the opener anchors the chat surface.
        sessions[sessionIndex].messages.insert(seededMessage, at: 0)
        sessions[sessionIndex].updatedAt = now
        injectedFoundationFirstPromptKeys.insert(key)

        PostHogTelemetry.capture(
            "mac_foundation_first_prompt_injected",
            properties: [
                "session_id": sessionId,
                "day": day,
                "spec_version": firstPrompt.specVersion ?? "",
                "sub_workflow": firstPrompt.subWorkflow ?? "",
                "artifact_count": firstPrompt.artifacts.count,
                "text_length": displayText.count,
                "replaced_existing": false,
            ],
            authSession: macAuthSession
        )

        refreshPresentationState()
    }

    func submitStructuredPrompt(
        sessionId explicitSessionId: String? = nil,
        requestId: String,
        responses: [StructuredPromptSubmission]
    ) {
        let targetSessionId = explicitSessionId ?? selectedSessionID
        guard let targetSessionId,
              let session = sessions.first(where: { $0.id == targetSessionId && $0.archivedAt == nil }) else { return }
        if responses.contains(where: { response in
            !response.selectedOptions.isEmpty
                || response.freeText.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        }) {
            markWorkspaceSetupFirstRealInput()
        }
        PostHogTelemetry.capture("mac_structured_input_submitted", properties: [
            "session_id": session.id,
            "request_id": requestId,
            "response_count": responses.count,
            "provider": session.provider.rawValue,
        ], authSession: macAuthSession)
        #if DEBUG
        let promptBeforeLocalSubmission = session.pendingUserInput
        if completeUITestingOfficeHoursStructuredSubmissionIfNeeded(
            sessionId: session.id,
            requestId: requestId,
            promptBeforeLocalSubmission: promptBeforeLocalSubmission
        ) {
            return
        }
        #endif
        let payloadResponses = responses.map { response in
            [
                "question": response.question,
                "selectedOptions": response.selectedOptions,
                "freeText": response.freeText,
            ] as [String : Any]
        }
        markStructuredPromptSubmittedLocally(
            sessionId: session.id,
            requestId: requestId,
            responses: responses
        )
        #if DEBUG
        if completeUITestingDay1HandoffJudgeSubmissionIfNeeded(
            sessionId: session.id,
            requestId: requestId,
            responses: responses,
            promptBeforeLocalSubmission: promptBeforeLocalSubmission
        ) {
            return
        }
        if completeUITestingDay1DocHandoffSubmissionIfNeeded(
            sessionId: session.id,
            requestId: requestId,
            promptBeforeLocalSubmission: promptBeforeLocalSubmission
        ) {
            return
        }
        #endif

        sidecar.send(payload: [
            "type": "submit_user_input",
            "sessionId": session.id,
            "requestId": requestId,
            "responses": payloadResponses,
        ])
    }

    func reviseOfficeHoursAnswer(
        sessionId: String,
        requestId: String,
        prompt: StructuredPromptRequest,
        responses: [StructuredPromptSubmission]
    ) -> Bool {
        guard sessions.contains(where: { $0.id == sessionId && $0.archivedAt == nil }) else { return false }
        guard let promptPayload = Self.sidecarJSONObject(prompt) as? [String: Any] else { return false }
        let payloadResponses = responses.map { response in
            [
                "question": response.question,
                "selectedOptions": response.selectedOptions,
                "freeText": response.freeText,
            ] as [String : Any]
        }
        #if DEBUG
        if completeUITestingOfficeHoursRevisionIfNeeded(
            sessionId: sessionId,
            requestId: requestId,
            prompt: prompt
        ) {
            submittedStructuredPromptBySession.removeValue(forKey: sessionId)
            structuredPromptDraftBySession.removeValue(forKey: sessionId)
            officeHoursCommitmentCandidatesBySession.removeValue(forKey: sessionId)
            officeHoursCommitmentCandidatesGenerating.remove(sessionId)
            PostHogTelemetry.capture("mac_office_hours_answer_revision_submitted", properties: [
                "session_id": sessionId,
                "request_id": requestId,
                "response_count": responses.count,
            ], authSession: macAuthSession)
            return true
        }
        #endif
        let sent = sidecar.send(payload: [
            "type": "office_hours_revise_answer",
            "sessionId": sessionId,
            "requestId": requestId,
            "prompt": promptPayload,
            "responses": payloadResponses,
        ])
        guard sent else { return false }
        submittedStructuredPromptBySession.removeValue(forKey: sessionId)
        structuredPromptDraftBySession.removeValue(forKey: sessionId)
        officeHoursCommitmentCandidatesBySession.removeValue(forKey: sessionId)
        officeHoursCommitmentCandidatesGenerating.remove(sessionId)
        PostHogTelemetry.capture("mac_office_hours_answer_revision_submitted", properties: [
            "session_id": sessionId,
            "request_id": requestId,
            "response_count": responses.count,
        ], authSession: macAuthSession)
        return true
    }

    private nonisolated static func sidecarJSONObject<T: Encodable>(_ value: T) -> Any? {
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .custom { date, encoder in
            var container = encoder.singleValueContainer()
            try container.encode(sidecarDateString(date))
        }
        guard let data = try? encoder.encode(value) else { return nil }
        return try? JSONSerialization.jsonObject(with: data)
    }

    private nonisolated static func sidecarDateString(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private func markStructuredPromptSubmittedLocally(
        sessionId: String,
        requestId: String,
        responses: [StructuredPromptSubmission]
    ) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionId }) else { return }
        guard sessions[index].pendingUserInput?.requestId == requestId else { return }

        submittedStructuredPromptBySession[sessionId] = StructuredPromptSubmissionState(
            sessionId: sessionId,
            requestId: requestId,
            responses: responses,
            submittedAt: .now
        )
        sessions[index].status = .running
        sessions[index].error = nil
        sessions[index].updatedAt = .now
    }

    func selectSession(_ sessionID: String) {
        selectedSessionID = sessionID
        refreshPresentationState()
    }

    func scanWorkspace(root: String, providerOverride: AgentProvider? = nil, retryAttempt: Int = 0) {
        guard !root.isEmpty else { return }
        beginWorkspaceScanTiming(reset: true)
        beginLongRunningCompletionAttempt(.workspaceScan, source: "workspace_scan", isUserVisible: true)
        clearWorkspaceScanResultCache(root: root)
        isScanning = true
        #if DEBUG
        let shouldSeedIntakeScanWait = CommandLine.arguments.contains("--ui-testing-seed-intake-scan-wait")
        #else
        let shouldSeedIntakeScanWait = false
        #endif
        let hasScanProgress = isConnected || shouldSeedIntakeScanWait
        scanProgressMessage = hasScanProgress ? "Preparing workspace scan..." : "Waiting for workspace connection..."
        scanProgressLogs = [scanProgressMessage]
        scanProgressSnapshots = [WorkspaceScanProgressSnapshot(
            progressText: scanProgressMessage,
            stage: hasScanProgress ? "local" : "connecting",
            stepIndex: hasScanProgress ? 1 : 0,
            totalSteps: 3
        )]
        scanResult = nil
        scanProviderLimitNotice = nil
        scanBlockedNotice = nil
        pendingAgentic30GitignoreConsent = nil
        PostHogTelemetry.capture("mac_workspace_scan_requested", properties: [
            "workspace_basename": (root as NSString).lastPathComponent,
            "provider_override": providerOverride?.rawValue ?? "",
        ], authSession: macAuthSession)
        markWorkspaceSetupStarted(root: root)
        guard isConnected else {
            pendingWorkspaceScanRoot = root
            pendingWorkspaceScanProvider = providerOverride
            return
        }
        sendWorkspaceScan(root: root, providerOverride: providerOverride, retryAttempt: retryAttempt)
    }

    /// Explicit, user-consented provider switch after a usage-limit notice:
    /// adopts `provider` as the active engine (so the settings picker and
    /// follow-up flows stay on the provider the user just chose) and re-runs
    /// the scan once with it.
    func rescanWorkspace(root: String, provider: AgentProvider, retryAttempt: Int = 0) {
        setActiveProvider(provider)
        scanWorkspace(root: root, providerOverride: provider, retryAttempt: retryAttempt)
    }

    func submitAgentic30GitignoreConsent(consented: Bool) {
        let root = pendingAgentic30GitignoreConsent?.scanRoot
            ?? scanResult?.agentic30Gitignore?.scanRoot
            ?? workspaceRoot
        let trimmedRoot = root.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmedRoot.isEmpty else { return }
        sidecar.send(payload: [
            "type": "workspace_gitignore_consent",
            "root": trimmedRoot,
            "consented": consented,
        ])
        pendingAgentic30GitignoreConsent = nil
    }

    private func sendWorkspaceScan(root: String, providerOverride: AgentProvider? = nil, retryAttempt: Int = 0) {
        var payload: [String: Any] = [
            "type": "scan_workspace",
            "root": root,
            "preferredProvider": (providerOverride ?? selectedProvider).rawValue,
        ]
        // Only a deliberate timeout-recovery retry carries an attempt number; the
        // sidecar widens the scan budget once for retryAttempt >= 1 and echoes it
        // back so a second timeout escalates to switch-provider in the UI.
        if retryAttempt > 0 {
            payload["retryAttempt"] = retryAttempt
        }
        sidecar.send(payload: payload)
    }

    private func beginWorkspaceScanTiming(reset: Bool = false) {
        if reset || scanStartedAt == nil || scanCompletedAt != nil {
            scanStartedAt = .now
        }
        scanCompletedAt = nil
    }

    private func finishWorkspaceScanTiming() {
        guard scanStartedAt != nil else { return }
        scanCompletedAt = .now
    }

    private func clearWorkspaceScanTiming() {
        scanStartedAt = nil
        scanCompletedAt = nil
    }

    private var scanResultHasDay1Plan: Bool {
        scanResult?.day1AlignmentPlan != nil || scanResult?.day1IcpPlan != nil
    }

    private func makeDay1GoalDrafts() -> [Day1GoalDraft] {
        let alignmentPlan = scanResult?.day1AlignmentPlan
        let customer = firstNonEmptyCandidate([
            day1GoalCustomerValue(from: alignmentPlan),
            alignmentPlan?.signals.currentIcpGuess,
            alignmentPlan?.signals.likelyUsers.first,
            alignmentPlan?.components.icp.statement,
        ]) ?? ""
        let problem = firstNonEmptyCandidate([
            alignmentPlan?.signals.problem,
            alignmentPlan?.components.painPoint.statement,
            alignmentPlan?.alignmentStatement.painPoint,
        ]) ?? ""
        let validationAction = firstNonEmptyCandidate([
            cleanDay1ValidationAction(alignmentPlan?.components.outcome.statement),
            cleanDay1ValidationAction(alignmentPlan?.alignmentStatement.outcome),
        ]) ?? ""
        let evidenceRefs = alignmentPlan.map(day1GoalEvidenceRefs(from:)) ?? []
        let proofSink: Day1ProofSink = isDay1BipProofSinkAvailable ? .bipOptional : .local
        let recommendationInputs = [
            onboardingContext?.goal,
            onboardingContext?.currentStage,
            onboardingContext?.businessDescription,
            alignmentPlan?.projectGoal,
            alignmentPlan?.alignmentStatement.statement,
            customer,
            problem,
            validationAction,
        ]
        let hasRecommendationContext = recommendationInputs.contains {
            ($0 ?? "").trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        }
        let recommended = hasRecommendationContext
            ? recommendedDay1GoalType(customer: customer, problem: problem, validationAction: validationAction)
            : nil
        let fingerprint = stableDay1GoalFingerprint(parts: [
            "day1_goal_lane_v1",
            alignmentPlan?.projectGoal,
            customer,
            problem,
            validationAction,
            evidenceRefs.joined(separator: "|"),
            onboardingContext?.goal,
        ])

        // Only attach emphasis when the displayed value is the exact alignment
        // component statement the sidecar generated spans for; otherwise the
        // value came from a fallback source with no matching spans and we keep
        // the legacy plain-row look (Stage 2 back-compat).
        let customerEmphasis = day1GoalRowEmphasis(
            component: alignmentPlan?.components.icp,
            displayValue: customer
        )
        let problemEmphasis = day1GoalRowEmphasis(
            component: alignmentPlan?.components.painPoint,
            displayValue: problem
        )

        return Day1GoalType.allCases.map { goalType in
            Day1GoalDraft(
                goalType: goalType,
                goalText: day1GoalText(goalType: goalType),
                customer: customer,
                problem: problem,
                validationAction: validationAction,
                evidenceRefs: evidenceRefs,
                proofSink: proofSink,
                sourcePlanFingerprint: fingerprint,
                isRecommended: goalType == recommended,
                customerEmphasis: customerEmphasis,
                problemEmphasis: problemEmphasis
            )
        }
    }

    /// Pull the sidecar-generated emphasis spans for a goal detail row, but only
    /// when the rendered value equals the component statement those spans were
    /// produced against (each span phrase is a substring of that statement). Any
    /// mismatch returns [] so the row keeps its legacy static styling.
    private func day1GoalRowEmphasis(
        component: Day1AlignmentComponent?,
        displayValue: String
    ) -> [EmphasisSpan] {
        guard let component,
              let emphasis = component.emphasis,
              !emphasis.isEmpty,
              component.statement.trimmingCharacters(in: .whitespacesAndNewlines)
                == displayValue.trimmingCharacters(in: .whitespacesAndNewlines)
        else {
            return []
        }
        return emphasis
    }

    private func day1GoalEvidenceRefs(from plan: Day1AlignmentPlan) -> [String] {
        var refs: [String] = []
        refs.append(contentsOf: plan.readiness?.fieldEvidence.values.flatMap { $0.map(\.path) } ?? [])
        refs.append(contentsOf: plan.signals.evidenceRefs.map(\.path))
        refs.append(contentsOf: plan.components.icp.evidence)
        refs.append(contentsOf: plan.components.painPoint.evidence)
        refs.append(contentsOf: plan.components.outcome.evidence)

        var seen = Set<String>()
        let uniqueRefs: [String] = refs
            .map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }
            .filter { !$0.isEmpty }
            .filter { ref in
                let key = ref.lowercased()
                if seen.contains(key) { return false }
                seen.insert(key)
                return true
            }
        return Array(uniqueRefs.prefix(12))
    }

    private func cleanDay1ValidationAction(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let cleaned = trimmed.replacingOccurrences(
            of: #"^\s*(?:활성\s*행동|활성\s*신호|검증\s*행동|확인할\s*행동)\s*[:：]\s*"#,
            with: "",
            options: .regularExpression
        )
        return cleaned.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
    }

    private func recommendedDay1GoalType(
        customer: String,
        problem: String,
        validationAction: String
    ) -> Day1GoalType {
        let haystack = [
            onboardingContext?.goal,
            onboardingContext?.currentStage,
            onboardingContext?.businessDescription,
            scanResult?.day1AlignmentPlan?.projectGoal,
            scanResult?.day1AlignmentPlan?.alignmentStatement.statement,
            customer,
            problem,
            validationAction,
        ]
            .compactMap { $0 }
            .joined(separator: " ")
            .lowercased()

        if haystack.range(of: #"매출|수익|유료|돈|결제|구매|계약|가격|revenue|paid|pay|purchase|sales|contract"#, options: .regularExpression) != nil {
            return .makeMoney
        }
        if haystack.range(of: #"유저|사용자|가입|마케팅|채널|유입|트래픽|waitlist|signup|acquisition|growth|marketing|users"#, options: .regularExpression) != nil {
            return .getUsers
        }
        return .buildProduct
    }

    private func day1GoalCustomerValue(from plan: Day1AlignmentPlan?) -> String? {
        guard let plan else { return nil }
        return [
            plan.signalDigest?.rows.first(where: { $0.key == "icp" })?.value,
            plan.signals.currentIcpGuess,
            plan.signals.likelyUsers.first,
            plan.alignmentStatement.icp,
            plan.components.icp.statement,
        ]
            .compactMap(day1GoalCustomerCandidate)
            .first
    }

    private func day1GoalCustomerCandidate(_ value: String?) -> String? {
        guard let value else { return nil }
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty,
              !day1GoalCustomerLooksLikeDocumentReference(trimmed)
        else {
            return nil
        }
        return trimmed
    }

    private func day1GoalCustomerLooksLikeDocumentReference(_ value: String) -> Bool {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return false }
        if trimmed.range(
            of: #"\[[^\]]*\.md[^\]]*\]\([^)]+\)"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil {
            return true
        }
        if trimmed.range(
            of: #"^(?:\./)?(?:docs/)?[a-z0-9._/-]+\.md(?:#[a-z0-9._-]+)?$"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil {
            return true
        }
        return trimmed.range(
            of: #"\.md\b"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil && trimmed.range(
            of: #"(문서|매핑|루브릭|reference|참고|company|회사|source|docs?|alignment)"#,
            options: [.regularExpression, .caseInsensitive]
        ) != nil
    }

    /// 목표 행은 30일 안에 달성할 정량 타깃 한 문장만 보여준다. 고객·문제는 같은
    /// 테이블의 별도 행에 이미 있으므로 반복하지 않는다 — sidecar의
    /// `DAY1_GOAL_TEXTS`(day1-goal-state.mjs)와 동일한 문구를 유지해야 한다.
    private func day1GoalText(goalType: Day1GoalType) -> String {
        switch goalType {
        case .makeMoney:
            return "30일 안에 첫 유료 결제 1건을 만든다."
        case .getUsers:
            return "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다."
        case .buildProduct:
            return "30일 안에 핵심 흐름 완주율 10%를 달성한다."
        }
    }

    private func firstNonEmpty(_ values: [String?], fallback: String) -> String {
        firstNonEmptyCandidate(values) ?? fallback
    }

    private func firstNonEmptyCandidate(_ values: [String?]) -> String? {
        values
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .first(where: { !$0.isEmpty })
    }

    private func stableDay1GoalFingerprint(parts: [String?]) -> String {
        var hash: UInt64 = 14_695_981_039_346_656_037
        let text = parts
            .compactMap { $0?.trimmingCharacters(in: .whitespacesAndNewlines) }
            .joined(separator: "\u{1f}")
        for byte in text.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(format: "%016llx", hash)
    }

    private func workspaceScanResultStore(for root: String) -> WorkspaceScanResultStore {
        #if DEBUG
        if let appSupportURL = Self.workspaceScanResultAppSupportURLOverrideForTesting {
            return WorkspaceScanResultStore(workspaceRoot: root, appSupportURL: appSupportURL)
        }
        #endif
        return WorkspaceScanResultStore(workspaceRoot: root)
    }

    private func hydrateWorkspaceScanResultFromCacheIfAvailable() {
        guard !requiresMacOnboarding, WorkspaceSettings.hasExplicitWorkspace else { return }
        let root = WorkspaceSettings.resolvedURL().path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return }
        guard let cached = workspaceScanResultStore(for: root).load() else { return }
        workspaceRoot = root
        clearWorkspaceScanTiming()
        scanResult = cached
        pendingAgentic30GitignoreConsent = cached.agentic30Gitignore?.needsConsent == true
            ? cached.agentic30Gitignore
            : nil
        day1GoalSelection = cached.day1GoalSelection
    }

    private func persistWorkspaceScanResultCache(_ result: WorkspaceScanResult, root explicitRoot: String? = nil) {
        guard result.error == nil else { return }
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return }
        workspaceScanResultStore(for: root).save(result)
    }

    private func clearWorkspaceScanResultCache(root explicitRoot: String? = nil) {
        let root = (explicitRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return }
        workspaceScanResultStore(for: root).clear()
    }

    private func requestWorkspaceScanRecoveryIfNeeded() {
        guard !requiresMacOnboarding,
              WorkspaceSettings.hasExplicitWorkspace,
              selectedFoundationDay == 1,
              !isScanning,
              !scanResultHasDay1Plan else {
            return
        }
        let root = WorkspaceSettings.resolvedURL().path.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty, !attemptedStartupWorkspaceScanRecoveryRoots.contains(root) else { return }
        attemptedStartupWorkspaceScanRecoveryRoots.insert(root)
        scanWorkspace(root: root)
    }

    private func persistWorkspaceScanResult(_ event: SidecarEvent) {
        guard event.error == nil else { return }
        let root = (event.scanRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard !root.isEmpty else { return }

        var settings = KeychainHelper.loadSettings()
        let previousRoot = settings.bipWorkspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        settings.bipWorkspaceRoot = root
        if previousRoot != root {
            settings.bipIcpPath = ""
            settings.bipSpecPath = ""
            settings.bipValuesPath = ""
            settings.bipDesignSystemPath = ""
            settings.bipAdrPath = ""
            settings.bipGoalPath = ""
            settings.bipDocsPath = ""
            settings.bipSheetPath = ""
        }
        if let icp = event.icp { settings.bipIcpPath = icp }
        if let spec = event.spec { settings.bipSpecPath = spec }
        if let values = event.values { settings.bipValuesPath = values }
        if let designSystem = event.designSystem { settings.bipDesignSystemPath = designSystem }
        if let adr = event.adr { settings.bipAdrPath = adr }
        if let goal = event.goal { settings.bipGoalPath = goal }
        if let docs = event.docs { settings.bipDocsPath = docs }
        if let sheet = event.sheet { settings.bipSheetPath = sheet }
        try? KeychainHelper.saveSettings(settings)
        KeychainHelper.syncBipConfigFile(from: settings)
    }

    private func setScanProgress(
        _ text: String,
        reset: Bool = false,
        stage: String? = nil,
        stepIndex: Int? = nil,
        totalSteps: Int? = nil,
        etaSeconds: Int? = nil,
        foundCount: Int? = nil,
        elapsedMs: Int? = nil
    ) {
        let message = text.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !message.isEmpty else { return }
        scanProgressMessage = message
        let snapshot = WorkspaceScanProgressSnapshot(
            progressText: message,
            stage: stage,
            stepIndex: stepIndex,
            totalSteps: totalSteps,
            etaSeconds: etaSeconds,
            foundCount: foundCount,
            elapsedMs: elapsedMs
        )
        if reset {
            scanProgressLogs = [message]
            scanProgressSnapshots = [snapshot]
            return
        }
        if scanProgressLogs.last != message {
            scanProgressLogs.append(message)
        }
        if scanProgressSnapshots.last != snapshot {
            scanProgressSnapshots.append(snapshot)
        }
        if scanProgressLogs.count > 24 {
            scanProgressLogs = Array(scanProgressLogs.suffix(24))
        }
        if scanProgressSnapshots.count > 24 {
            scanProgressSnapshots = Array(scanProgressSnapshots.suffix(24))
        }
    }

    private func handleRequestEmit(_ request: SidecarRequestEmit) {
        captureWorkspaceSetupTelemetry(
            workspaceSetupTelemetryGate.requestsToCapture(afterReceiving: request)
        )
    }

    private func markWorkspaceSetupStarted(root: String) {
        let request = try? SidecarRequestEmit(
            event: .workspaceSetupStarted,
            properties: [
                "workspace_basename": .string((root as NSString).lastPathComponent),
                "has_explicit_workspace": .bool(WorkspaceSettings.hasExplicitWorkspace),
            ]
        )
        if let request {
            captureWorkspaceSetupTelemetry(
                workspaceSetupTelemetryGate.requestsToCapture(afterReceiving: request)
            )
        }
    }

    private func markWorkspaceSetupScanSucceeded() {
        captureWorkspaceSetupTelemetry(
            workspaceSetupTelemetryGate.requestsToCaptureAfterWorkspaceScanSuccess()
        )
    }

    private func markWorkspaceSetupFirstRealInput() {
        captureWorkspaceSetupTelemetry(
            workspaceSetupTelemetryGate.requestsToCaptureAfterFirstRealInput()
        )
    }

    private func captureWorkspaceSetupTelemetry(_ requests: [SidecarRequestEmit]) {
        for request in requests {
            PostHogTelemetry.capture(
                request.event.rawValue,
                properties: request.telemetryProperties,
                authSession: macAuthSession
            )
        }
    }

    func startNotionOAuth() {
        notionOAuthInProgress = true
        notionOAuthError = nil
        PostHogTelemetry.capture("mac_notion_oauth_started", authSession: macAuthSession)
        sidecar.send(payload: ["type": "notion_start_oauth"])
    }

    func disconnectNotion() {
        PostHogTelemetry.capture("mac_notion_disconnected", authSession: macAuthSession)
        sidecar.send(payload: ["type": "notion_disconnect"])
    }

    func refreshIntegrationStatus() {
        guard isConnected, !integrationStatusChecking else { return }
        integrationStatusChecking = true
        // MCP OAuth 배지는 프로바이더 토큰 캐시 단위 — 현재 선택한 프로바이더
        // 기준으로 판정하도록 사이드카에 선택값을 넘긴다.
        sidecar.send(payload: [
            "type": "integration_status_check",
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func connectExaMcp(apiKey: String) {
        let trimmedKey = apiKey.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isConnected, !trimmedKey.isEmpty, !integrationStatusChecking, !exaMcpConnecting else { return }
        exaMcpConnecting = true
        exaMcpConnectResult = nil
        pendingExaMcpApiKeyForStorage = trimmedKey
        PostHogTelemetry.capture(
            "mac_exa_mcp_connect_validate_started",
            properties: [
                "provider": selectedProvider.rawValue,
            ],
            authSession: macAuthSession
        )
        sidecar.send(payload: [
            "type": "exa_mcp_connect_validate",
            "apiKey": trimmedKey,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func assureExaCodexMcpConfig() {
        connectExaMcp(apiKey: KeychainHelper.loadSettings().exaApiKey)
    }

    /// Settings > 연동 "MCP 연결": OAuth-first MCP(PostHog/Cloudflare)는 설정에서
    /// 검증 불가(토큰이 프로바이더 캐시에 있음) — 사이드카가 대상 MCP 도구를 1회
    /// 호출하는 최소 쿼리를 돌려 브라우저 OAuth를 트리거하고 연결을 실증한다.
    func connectMcpOauth(server: String) {
        guard isConnected, !mcpOauthConnecting.contains(server) else { return }
        mcpOauthResults.removeValue(forKey: server)
        mcpOauthProgress.removeValue(forKey: server)
        mcpOauthOpenedLoginUrls.removeAll()
        mcpOauthConnecting.insert(server)
        mcpOauthProgress[server] = "연결 확인을 시작하는 중…"
        PostHogTelemetry.capture("mac_mcp_oauth_connect_started", authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "mcp_oauth_connect",
            "server": server,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func cancelMcpOauth(server: String) {
        guard isConnected, mcpOauthConnecting.contains(server) else { return }
        mcpOauthProgress[server] = "중지 중…"
        PostHogTelemetry.capture(
            "mac_mcp_oauth_connect_cancel_requested",
            properties: [
                "server": server,
                "provider": selectedProvider.rawValue,
            ],
            authSession: macAuthSession
        )
        sidecar.send(payload: [
            "type": "mcp_oauth_connect_cancel",
            "server": server,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    private func finishMcpOauthInFlightAfterSidecarInterruption(
        detail: String = "",
        markFailedResult: Bool
    ) {
        guard !mcpOauthConnecting.isEmpty || !mcpOauthProgress.isEmpty else { return }
        if markFailedResult {
            let checkedAt = ISO8601DateFormatter().string(from: Date())
            let failureDetail = detail.isEmpty
                ? "MCP 연결 확인이 끝나지 않았어요 — 다시 시도해 주세요."
                : detail
            for server in mcpOauthConnecting {
                mcpOauthResults[server] = McpOauthConnectResult(
                    server: server,
                    provider: selectedProvider.rawValue,
                    state: "failed",
                    detail: failureDetail,
                    loginUrl: nil,
                    checkedAt: checkedAt
                )
            }
        }
        mcpOauthConnecting.removeAll()
        mcpOauthProgress.removeAll()
        mcpOauthOpenedLoginUrls.removeAll()
    }

    private func finishExaMcpConnectAfterSidecarInterruption() {
        guard exaMcpConnecting || pendingExaMcpApiKeyForStorage != nil else { return }
        let checkedAt = ISO8601DateFormatter().string(from: Date())
        exaMcpConnecting = false
        pendingExaMcpApiKeyForStorage = nil
        exaMcpConnectResult = ExaMcpConnectResult(
            provider: selectedProvider.rawValue,
            state: "failed",
            detail: "실행 보조 앱이 중단되어 Exa MCP 연결 확인이 끝나지 않았어요. 다시 시도하세요.",
            changed: false,
            configPath: nil,
            backupPath: nil,
            route: nil,
            validationTool: "web_search_exa",
            checkedAt: checkedAt
        )
    }

    private func reportIntegrationStatusTelemetry(_ snapshot: IntegrationStatusSnapshot?) {
        guard let snapshot else { return }
        let probes: [(String, IntegrationProbeStatus?)] = [
            ("github", snapshot.github),
            ("github_mcp", snapshot.githubMcp),
            ("posthog", snapshot.posthog),
            ("cloudflare", snapshot.cloudflare),
            ("vercel", snapshot.vercel),
            ("exa", snapshot.exa),
        ]
        for (integration, probe) in probes {
            guard let state = probe?.state,
                  ["failed", "missing"].contains(state)
            else { continue }
            let properties: [String: Any] = [
                "integration": integration,
                "state": state,
                "failure_detail": probe?.detail ?? "",
                "checked_at": snapshot.checkedAt ?? "",
            ]
            PostHogTelemetry.capture(
                "mac_integration_probe_unhealthy",
                properties: properties,
                authSession: macAuthSession
            )
            PostHogTelemetry.captureLog(
                "integration probe unhealthy",
                level: state == "failed" ? .error : .warn,
                properties: properties,
                authSession: macAuthSession
            )
        }
    }

    private func reportMcpOauthConnectTelemetry(_ result: McpOauthConnectResult?) {
        guard let result,
              let state = result.state,
              !["ready", "progress", "cancelled"].contains(state)
        else { return }

        let properties: [String: Any] = [
            "server": result.server ?? "",
            "provider": result.provider ?? selectedProvider.rawValue,
            "state": state,
            "has_login_url": !(result.loginUrl?.isEmpty ?? true),
            "failure_detail": result.detail ?? "",
            "checked_at": result.checkedAt ?? "",
        ]
        PostHogTelemetry.capture(
            "mac_mcp_oauth_connect_unhealthy",
            properties: properties,
            authSession: macAuthSession
        )
        PostHogTelemetry.captureLog(
            "mcp oauth connect did not complete",
            level: state == "failed" ? .error : .warn,
            properties: properties,
            authSession: macAuthSession
        )
        if state == "failed" {
            PostHogTelemetry.captureException(
                NSError(domain: "McpOauthConnect", code: -1, userInfo: [
                    NSLocalizedDescriptionKey: result.detail ?? "MCP OAuth connection failed."
                ]),
                properties: properties,
                authSession: macAuthSession
            )
        }
    }

    func refreshGitHubCliStatus() {
        githubCliAuthStatus = .checking()
        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? WorkspaceSettings.resolvedURL().path
            : workspaceRoot
        Task { [weak self, root] in
            let status = await Task.detached(priority: .userInitiated) {
                Self.detectGitHubCliAuthStatus(workspaceRoot: root)
            }.value
            await MainActor.run {
                self?.githubCliAuthStatus = status
            }
        }
    }

    func openGitHubCliLoginInTerminal() {
        githubCliAuthStatus = GitHubCLIAuthStatus(
            state: .disconnected,
            detail: "Terminal에서 gh auth login을 시작했습니다. 완료 후 상태 확인을 눌러주세요.",
            checkedAt: Date()
        )
        lastError = nil

        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? WorkspaceSettings.resolvedURL().path
            : workspaceRoot
        let resolvedRoot = root.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? NSHomeDirectory() : root
        let command = "cd \(Self.shellQuoted(resolvedRoot)); gh auth login"
        let script = """
        tell application "Terminal"
            activate
            do script \(Self.appleScriptLiteral(command))
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        do {
            try process.run()
            PostHogTelemetry.capture("mac_github_cli_auth_terminal_opened", authSession: macAuthSession)
        } catch {
            githubCliAuthStatus = GitHubCLIAuthStatus(
                state: .disconnected,
                detail: "gh auth login을 열 수 없습니다: \(error.localizedDescription)",
                checkedAt: Date()
            )
            lastError = githubCliAuthStatus.detail
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "open_github_cli_auth_terminal",
            ], authSession: macAuthSession)
        }
    }

    func openGitHubCliInstallInTerminal() {
        githubCliAuthStatus = GitHubCLIAuthStatus(
            state: .missing,
            detail: "Terminal에서 GitHub CLI 설치 후 gh auth login을 이어서 실행합니다.",
            checkedAt: Date()
        )
        lastError = nil

        let command = "brew install gh && gh auth login"
        let script = """
        tell application "Terminal"
            activate
            do script \(Self.appleScriptLiteral(command))
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        do {
            try process.run()
            PostHogTelemetry.capture("mac_github_cli_brew_install_started", authSession: macAuthSession)
        } catch {
            githubCliAuthStatus = GitHubCLIAuthStatus(
                state: .missing,
                detail: "GitHub CLI 설치 명령을 열 수 없습니다: \(error.localizedDescription)",
                checkedAt: Date()
            )
            lastError = githubCliAuthStatus.detail
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "open_github_cli_brew_install_terminal",
            ], authSession: macAuthSession)
        }
    }

    func startProviderLogin(_ provider: AgentProvider) {
        guard isConnected else { return }
        providerAuthInProgress = provider
        providerAuthMessage = "\(provider.title) 로그인 시작 중..."
        lastError = nil
        PostHogTelemetry.capture("mac_provider_auth_login_started", properties: [
            "provider": provider.rawValue,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "provider_auth_login_start",
            "provider": provider.rawValue,
        ])
    }

    func openGeminiAdcLoginInTerminal() {
        providerAuthInProgress = .gemini
        providerAuthMessage = "Google ADC 로그인을 Terminal에서 시작했습니다 (gcloud auth application-default login)."
        lastError = nil

        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? NSHomeDirectory()
            : workspaceRoot
        let command = "cd \(Self.shellQuoted(root)); gcloud auth application-default login"
        let script = """
        tell application "Terminal"
            activate
            do script \(Self.appleScriptLiteral(command))
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        do {
            try process.run()
            PostHogTelemetry.capture("mac_provider_auth_terminal_opened", properties: [
                "provider": AgentProvider.gemini.rawValue,
            ], authSession: macAuthSession)
        } catch {
            providerAuthInProgress = nil
            providerAuthMessage = "Gemini auth를 열 수 없습니다: \(error.localizedDescription)"
            lastError = providerAuthMessage
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "open_gemini_auth_terminal",
            ], authSession: macAuthSession)
        }
    }

    /// Returns true if Terminal was launched, false if gcloud is missing on PATH (caller should
    /// surface a recovery affordance such as switching to BYOK).
    @MainActor
    func attemptOpenGeminiAdcLogin() async -> Bool {
        providerAuthInProgress = .gemini
        providerAuthMessage = "gcloud SDK 확인 중..."
        let installed = await Task.detached(priority: .userInitiated) {
            AgenticViewModel.detectGcloudAvailable()
        }.value
        if installed {
            openGeminiAdcLoginInTerminal()
            return true
        }
        providerAuthInProgress = nil
        providerAuthMessage = nil
        PostHogTelemetry.capture("mac_provider_auth_gcloud_missing", properties: [
            "provider": AgentProvider.gemini.rawValue,
        ], authSession: macAuthSession)
        return false
    }

    nonisolated static func detectGcloudAvailable() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "command -v gcloud"]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    nonisolated static func detectGitHubCliAuthStatus(workspaceRoot: String) -> GitHubCLIAuthStatus {
        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? NSHomeDirectory()
            : workspaceRoot
        let result = runLoginShellCommand("cd \(shellQuoted(root)); gh auth status")
        if result.exitCode == 0 {
            return GitHubCLIAuthStatus(
                state: .connected,
                detail: "gh auth status 통과. History에서 PR/이슈/릴리즈 신호를 읽을 수 있습니다.",
                checkedAt: Date()
            )
        }
        if result.exitCode == 127 || result.output.localizedCaseInsensitiveContains("command not found") {
            return GitHubCLIAuthStatus(
                state: .missing,
                detail: "gh CLI가 설치되어 있지 않습니다. brew install gh 후 gh auth login을 실행하세요.",
                checkedAt: Date()
            )
        }
        return GitHubCLIAuthStatus(
            state: .disconnected,
            detail: "gh auth login이 필요합니다. 인증 후 History에서 GitHub 활동을 반영합니다.",
            checkedAt: Date()
        )
    }

    private func reportExaMcpConnectTelemetry(_ result: ExaMcpConnectResult?) {
        guard let result,
              let state = result.state,
              state != "ready"
        else { return }

        let properties: [String: Any] = [
            "provider": result.provider ?? selectedProvider.rawValue,
            "state": state,
            "failure_detail": result.detail ?? "",
            "checked_at": result.checkedAt ?? "",
            "validation_tool": result.validationTool ?? "",
        ]
        PostHogTelemetry.capture(
            "mac_exa_mcp_connect_unhealthy",
            properties: properties,
            authSession: macAuthSession
        )
        PostHogTelemetry.captureLog(
            "exa mcp connect did not complete",
            level: state == "failed" ? .error : .warn,
            properties: properties,
            authSession: macAuthSession
        )
    }

    private func persistValidatedExaApiKeyIfNeeded(_ result: ExaMcpConnectResult) {
        defer {
            pendingExaMcpApiKeyForStorage = nil
        }
        guard result.isReady,
              let key = pendingExaMcpApiKeyForStorage,
              !key.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return
        }
        var settings = KeychainHelper.loadSettings()
        settings.exaApiKey = key
        do {
            try KeychainHelper.saveSettings(settings)
            syncProviderSettingsToSidecar(settings)
        } catch {
            exaMcpConnectResult = ExaMcpConnectResult(
                provider: result.provider,
                state: "failed",
                detail: "Exa API key 저장 실패: \(error.localizedDescription)",
                changed: false,
                configPath: result.configPath,
                backupPath: result.backupPath,
                route: result.route,
                validationTool: result.validationTool,
                checkedAt: result.checkedAt
            )
        }
    }

    nonisolated private static func runLoginShellCommand(_ command: String) -> (exitCode: Int32, output: String) {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", command]
        let stdout = Pipe()
        let stderr = Pipe()
        process.standardOutput = stdout
        process.standardError = stderr
        do {
            try process.run()
            process.waitUntilExit()
            let stdoutData = stdout.fileHandleForReading.readDataToEndOfFile()
            let stderrData = stderr.fileHandleForReading.readDataToEndOfFile()
            let output = [
                String(data: stdoutData, encoding: .utf8),
                String(data: stderrData, encoding: .utf8),
            ]
                .compactMap { $0 }
                .joined(separator: "\n")
            return (process.terminationStatus, output)
        } catch {
            return (-1, error.localizedDescription)
        }
    }

    nonisolated static func detectBrewAvailable() -> Bool {
        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/bin/zsh")
        process.arguments = ["-lc", "command -v brew"]
        process.standardOutput = Pipe()
        process.standardError = Pipe()
        do {
            try process.run()
            process.waitUntilExit()
            return process.terminationStatus == 0
        } catch {
            return false
        }
    }

    func openGcloudBrewInstallInTerminal() {
        providerAuthInProgress = .gemini
        providerAuthMessage = "gcloud 설치 명령을 Terminal에서 시작했습니다. 설치 완료 후 자동으로 ADC 로그인이 이어집니다."
        lastError = nil

        let command = "brew install --cask google-cloud-sdk && gcloud auth application-default login"
        let script = """
        tell application "Terminal"
            activate
            do script \(Self.appleScriptLiteral(command))
        end tell
        """

        let process = Process()
        process.executableURL = URL(fileURLWithPath: "/usr/bin/osascript")
        process.arguments = ["-e", script]

        do {
            try process.run()
            PostHogTelemetry.capture("mac_gemini_gcloud_brew_install_started", properties: [
                "provider": AgentProvider.gemini.rawValue,
            ], authSession: macAuthSession)
        } catch {
            providerAuthInProgress = nil
            providerAuthMessage = "brew 설치 명령을 열 수 없습니다: \(error.localizedDescription)"
            lastError = providerAuthMessage
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "open_gcloud_brew_install_terminal",
            ], authSession: macAuthSession)
        }
    }

    func syncProviderSettingsToSidecar(_ settings: KeychainHelper.Settings? = nil) {
        guard isConnected else { return }
        let resolvedSettings = settings ?? KeychainHelper.loadSettings()
        sidecar.send(payload: [
            "type": "provider_settings_update",
            "providers": providerSettingsPayload(from: resolvedSettings),
            "integrations": [
                "exa": [
                    "apiKey": resolvedSettings.exaApiKey,
                ],
            ],
        ])
    }

    private func restoreWorkspaceSurfacesFromMemory() {
        guard isConnected else { return }
        _ = requestDayProgress()
        requestMorningBriefing(autoRefreshIfStale: false)
        requestStrategyReport()
        requestNewsMarketRadar(autoRefreshIfDue: false)
    }

    #if DEBUG
    private func triggerUITestingDynamicResearchRefreshIfRequested() {
        let arguments = CommandLine.arguments
        let triggerAll = arguments.contains("--ui-testing-trigger-dynamic-research-refresh")
        let triggerMarketRadar = triggerAll || arguments.contains("--ui-testing-trigger-news-market-radar-refresh")
        let triggerStrategy = triggerAll || arguments.contains("--ui-testing-trigger-strategy-report-refresh")
        guard triggerMarketRadar || triggerStrategy else { return }
        guard !uiTestingDynamicResearchRefreshTriggered else { return }
        uiTestingDynamicResearchRefreshTriggered = true
        if triggerMarketRadar {
            refreshNewsMarketRadar(reason: "ui_testing_e2e", force: true)
        }
        if triggerStrategy {
            refreshStrategyReport(reason: "ui_testing_e2e", force: true)
        }
    }
    #endif

    func requestDiagnostics() {
        PostHogTelemetry.capture("mac_diagnostics_requested", authSession: macAuthSession)
        sidecar.send(payload: ["type": "get_diagnostics"])
    }

    func requestNewsMarketRadar(autoRefreshIfDue: Bool = false) {
        guard isConnected else { return }
        sidecar.send(payload: [
            "type": "news_market_radar_get",
            "preferredProvider": selectedProvider.rawValue,
            "autoRefreshIfDue": autoRefreshIfDue,
        ])
    }

    func refreshNewsMarketRadar(reason: String = "manual", force: Bool = false) {
        guard isConnected else { return }
        if longRunningCompletionReasonIsUserVisible(reason) || force {
            beginLongRunningCompletionAttempt(.newsMarketRadar, source: reason, isUserVisible: true)
        }
        PostHogTelemetry.capture("mac_news_market_radar_refresh_requested", properties: [
            "reason": reason,
            "force": force,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "news_market_radar_refresh",
            "reason": reason,
            "force": force,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func requestStrategyReport() {
        guard isConnected else { return }
        sidecar.send(payload: [
            "type": "strategy_report_get",
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func refreshStrategyReport(reason: String = "manual", force: Bool = true) {
        #if DEBUG
        if emitUITestingStrategyReportEventsIfRequested() { return }
        #endif
        guard isConnected else {
            pendingStrategyReportRefresh = PendingStrategyReportRefresh(reason: reason, force: force)
            strategyReportPreparingForDisplay = true
            strategyReportDynamicActivated = true
            return
        }
        strategyReportPreparingForDisplay = true
        strategyReportDynamicActivated = true
        if longRunningCompletionReasonIsUserVisible(reason) || force {
            beginLongRunningCompletionAttempt(.strategyReport, source: reason, isUserVisible: true)
        }
        PostHogTelemetry.capture("mac_strategy_report_refresh_requested", properties: [
            "reason": reason,
            "force": force,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "strategy_report_refresh",
            "reason": reason,
            "force": force,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    private func flushPendingStrategyReportRefreshIfNeeded() {
        guard let refresh = pendingStrategyReportRefresh else { return }
        pendingStrategyReportRefresh = nil
        refreshStrategyReport(reason: refresh.reason, force: refresh.force)
    }

    func prepareNewsMarketRadarForDisplay() {
        lastNewsMarketRadarViewedAt = Date()
        #if DEBUG
        if emitUITestingNewsMarketRadarEventsIfRequested() { return }
        #endif
        guard isConnected else {
            newsMarketRadarPreparingForDisplay = false
            return
        }
        guard !newsMarketRadarPreparingForDisplay else { return }
        newsMarketRadarPreparingForDisplay = true
        markLongRunningCompletionDisplayInterest(.newsMarketRadar)
        requestNewsMarketRadar(autoRefreshIfDue: true)
    }

    private func applyNewsMarketRadarStatus(_ status: NewsMarketRadarStatus) {
        let current = newsMarketRadar
        let isRunning = longRunningCompletionStateIsRunning(status.state)
        newsMarketRadar = NewsMarketRadarSnapshot(
            schemaVersion: current.schemaVersion,
            generatedAt: current.generatedAt,
            nextRefreshAfter: current.nextRefreshAfter,
            status: NewsMarketRadarStatus(
                state: status.state,
                lastSuccessAt: status.lastSuccessAt ?? current.status.lastSuccessAt,
                stale: status.stale ?? current.status.stale,
                error: isRunning ? status.error : (status.error ?? current.status.error),
                reason: status.reason,
                researchSource: status.researchSource ?? current.status.researchSource,
                stage: status.stage ?? current.status.stage,
                progressText: status.progressText ?? current.status.progressText,
                elapsedMs: status.elapsedMs ?? current.status.elapsedMs,
                stepIndex: status.stepIndex ?? current.status.stepIndex,
                stepCount: status.stepCount ?? current.status.stepCount,
                partialFailures: status.partialFailures ?? current.status.partialFailures,
                durationMs: status.durationMs ?? current.status.durationMs
            ),
            workspaceEvidenceRefs: current.workspaceEvidenceRefs,
            lanes: current.lanes
        )
    }

    private func markDynamicResearchSurfacesFailedAfterSidecarExit(message: String) {
        let detail = "실행 보조 앱이 중단되어 리서치 갱신이 완료되지 않았습니다. 다시 시도해 주세요."
        if newsMarketRadarPreparingForDisplay || longRunningCompletionStateIsRunning(newsMarketRadar.status.state) {
            let current = newsMarketRadar
            newsMarketRadarPreparingForDisplay = false
            newsMarketRadar = NewsMarketRadarSnapshot(
                schemaVersion: current.schemaVersion,
                generatedAt: current.generatedAt,
                nextRefreshAfter: current.nextRefreshAfter,
                status: NewsMarketRadarStatus(
                    state: "failed",
                    lastSuccessAt: current.status.lastSuccessAt,
                    stale: current.generatedAt != nil || current.cardCount > 0 || current.status.stale == true,
                    error: detail,
                    reason: "sidecar_unexpected_exit",
                    researchSource: current.status.researchSource,
                    stage: current.status.stage,
                    progressText: current.status.progressText ?? message,
                    elapsedMs: current.status.elapsedMs,
                    stepIndex: current.status.stepIndex,
                    stepCount: current.status.stepCount,
                    partialFailures: current.status.partialFailures,
                    durationMs: current.status.durationMs
                ),
                workspaceEvidenceRefs: current.workspaceEvidenceRefs,
                lanes: current.lanes
            )
            completeLongRunningCompletionAttempt(
                .newsMarketRadar,
                outcome: .failed,
                detail: detail
            )
        }

        if strategyReportPreparingForDisplay || longRunningCompletionStateIsRunning(strategyReport.status.state) {
            let current = strategyReport
            strategyReportPreparingForDisplay = false
            strategyReport = StrategyReportSnapshot(
                schemaVersion: current.schemaVersion,
                promptProfile: current.promptProfile,
                contentLocale: current.contentLocale,
                generatedAt: current.generatedAt,
                nextRefreshAfter: current.nextRefreshAfter,
                contextFingerprint: current.contextFingerprint,
                status: StrategyReportStatus(
                    state: "failed",
                    lastSuccessAt: current.status.lastSuccessAt,
                    stale: current.generatedAt != nil || current.hasReport || current.status.stale == true,
                    error: detail,
                    reason: "sidecar_unexpected_exit",
                    researchSource: current.status.researchSource,
                    stage: current.status.stage,
                    progressText: current.status.progressText ?? message,
                    elapsedMs: current.status.elapsedMs,
                    stepIndex: current.status.stepIndex,
                    stepCount: current.status.stepCount,
                    partialFailures: current.status.partialFailures,
                    startedAt: current.status.startedAt,
                    completedAt: Date(),
                    durationMs: current.status.durationMs
                ),
                workspaceEvidenceRefs: current.workspaceEvidenceRefs,
                report: current.report
            )
            completeLongRunningCompletionAttempt(
                .strategyReport,
                outcome: .failed,
                detail: detail
            )
        }
    }

    func requestWorkHistory() {
        guard isConnected else { return }
        sidecar.send(payload: [
            "type": "work_history_get",
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func refreshWorkHistory(reason: String = "manual") {
        guard isConnected else { return }
        if longRunningCompletionReasonIsUserVisible(reason) {
            beginLongRunningCompletionAttempt(.workHistory, source: reason, isUserVisible: true)
        }
        PostHogTelemetry.capture("mac_work_history_refresh_requested", properties: [
            "reason": reason,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "work_history_refresh",
            "reason": reason,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    /// History 탭 진입 시 호출. 사이드카가 캐시 스냅샷을 즉시 돌려주고,
    /// 주가 바뀌었거나 1시간이 지났거나 새 커밋이 감지되면 재인덱싱한다.
    func prepareWorkHistoryForDisplay() {
        #if DEBUG
        if emitUITestingWorkHistoryEventsIfRequested() { return }
        #endif
        markLongRunningCompletionDisplayInterest(.workHistory)
        requestWorkHistory()
    }

    func prepareRecorderControlForDisplay() {
        guard recorderControlState == nil && recorderCaptureReadiness == nil else { return }
        refreshRecorderControlState()
    }

    func refreshRecorderControlState() {
        guard isConnected else {
            recorderControlLastError = "실행 보조 앱이 연결되지 않아 Recorder 상태를 불러올 수 없습니다."
            return
        }
        recorderControlRefreshing = true
        recorderControlLastError = nil
        guard sidecar.send(payload: [
            "type": "recorder_control_state_get",
        ]) else {
            recorderControlRefreshing = false
            recorderControlLastError = "Recorder 상태 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_control_refresh_requested",
            authSession: macAuthSession
        )
    }

    func refreshRecorderAuditEvents(limit: Int = 20) {
        guard isConnected else {
            recorderAuditLastError = "실행 보조 앱이 연결되지 않아 raw API 감사 로그를 불러올 수 없습니다."
            return
        }
        recorderAuditRefreshing = true
        recorderAuditLastError = nil
        let cappedLimit = max(1, min(limit, 100))
        guard sidecar.send(payload: [
            "type": "recorder_audit_list",
            "limit": cappedLimit,
        ]) else {
            recorderAuditRefreshing = false
            recorderAuditLastError = "raw API 감사 로그 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_audit_list_requested",
            properties: ["limit": cappedLimit],
            authSession: macAuthSession
        )
    }

    func grantRecorderConsent() {
        recorderAutoCaptureLocallyStopped = false
        sendRecorderControlAction(
            [
                "type": "grant_consent",
                "visibleIndicatorAcknowledged": true,
            ],
            actionID: "grant_consent"
        )
    }

    func revokeRecorderConsent() {
        stopRecorderAutoCapture(reason: "local_user_revoked_consent", locallyStopped: true)
        sendRecorderControlAction(
            [
                "type": "revoke_consent",
                "reason": "local_user_revoked_consent",
            ],
            actionID: "revoke_consent"
        )
    }

    func pauseRecorderCapture() {
        stopRecorderAutoCapture(reason: "local_user_pause", locallyStopped: true)
        sendRecorderControlAction(
            [
                "type": "pause",
                "reason": "local_user_pause",
            ],
            actionID: "pause"
        )
    }

    func resumeRecorderCapture() {
        recorderAutoCaptureLocallyStopped = false
        sendRecorderControlAction(
            [
                "type": "resume",
                "reason": "local_user_resume",
            ],
            actionID: "resume"
        )
    }

    func stopRecorderForToday() {
        stopRecorderAutoCapture(reason: "local_user_stop_for_today", locallyStopped: true)
        sendRecorderControlAction(
            [
                "type": "stop_for_today",
                "reason": "local_user_stop_for_today",
            ],
            actionID: "stop_for_today"
        )
    }

    func setRecorderClipboardMode(_ mode: String) {
        let normalizedMode = mode.trimmingCharacters(in: .whitespacesAndNewlines)
        guard RecorderSensitiveCapture.allowedClipboardModes.contains(normalizedMode) else {
            recorderControlLastError = "ERR_RECORDER_SENSITIVE_CAPTURE_INVALID_CLIPBOARD_MODE: \(normalizedMode)"
            return
        }
        sendRecorderSensitiveCapturePatch(
            ["clipboardMode": normalizedMode],
            actionID: "sensitive_capture_clipboard"
        )
    }

    func setRecorderMicrophoneCaptureEnabled(_ enabled: Bool) {
        sendRecorderSensitiveCapturePatch(
            ["microphone": enabled],
            actionID: "sensitive_capture_microphone"
        )
    }

    func setRecorderSystemAudioCaptureEnabled(_ enabled: Bool) {
        sendRecorderSensitiveCapturePatch(
            ["systemAudio": enabled],
            actionID: "sensitive_capture_system_audio"
        )
    }

    func refreshRecorderPermissionProbe() {
        guard isConnected else {
            recorderControlLastError = "실행 보조 앱이 연결되지 않아 macOS 권한 상태를 반영할 수 없습니다."
            return
        }
        let permissions = Self.currentRecorderPermissionProbe()
        let metadataProbes = recorderControlState?.consent.status == "granted"
            ? Self.currentRecorderMetadataProbe()
            : []
        let metadataPermissions = metadataProbes.map { (id: $0.id, state: "granted") }
        let permissionUpdates = permissions + metadataPermissions
        guard !permissionUpdates.isEmpty || !metadataProbes.isEmpty else {
            recorderControlLastError = "확인할 수 있는 macOS 권한 항목이 없습니다."
            return
        }
        recorderControlActionInFlight = "permission_probe"
        recorderControlLastError = nil
        var sentAll = true
        for permission in permissionUpdates {
            let sent = sidecar.send(payload: [
                "type": "recorder_control_action",
                "action": [
                    "type": "set_permission",
                    "permission": permission.id,
                    "state": permission.state,
                ],
            ])
            sentAll = sentAll && sent
        }
        for probe in metadataProbes {
            var action: [String: Any] = [
                "type": "record_metadata_probe",
                "permission": probe.id,
                "status": probe.status,
                "source": "swift_runtime_probe",
                "message": probe.message,
            ]
            if let rootCause = probe.rootCause {
                action["rootCause"] = rootCause
            }
            let sent = sidecar.send(payload: [
                "type": "recorder_control_action",
                "action": action,
            ])
            sentAll = sentAll && sent
        }
        guard sentAll else {
            recorderControlActionInFlight = nil
            recorderControlLastError = "macOS 권한 상태 업데이트를 실행 보조 앱에 보내지 못했습니다."
            return
        }
        var telemetryProperties: [String: Any] = Dictionary(uniqueKeysWithValues: permissionUpdates.map { ($0.id, $0.state) })
        for probe in metadataProbes {
            telemetryProperties["\(probe.id)_probe_status"] = probe.status
            if let rootCause = probe.rootCause {
                telemetryProperties["\(probe.id)_probe_root_cause"] = rootCause
            }
        }
        PostHogTelemetry.capture(
            "mac_recorder_permission_probe_requested",
            properties: telemetryProperties,
            authSession: macAuthSession
        )
    }

    func requestRecorderPermission(_ permissionID: String) {
        let normalizedID = permissionID.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !normalizedID.isEmpty else {
            recorderControlLastError = "ERR_RECORDER_PERMISSION_REQUEST_UNSUPPORTED: empty permission id"
            return
        }
        let supportedPermissionIDs: Set<String> = [
            "screenRecording",
            "systemAudio",
            "accessibility",
            "inputMonitoring",
            "microphone",
        ]
        guard supportedPermissionIDs.contains(normalizedID) else {
            recorderControlActionInFlight = nil
            recorderControlLastError = "ERR_RECORDER_PERMISSION_REQUEST_UNSUPPORTED: \(normalizedID)"
            return
        }

        let actor = Self.currentRecorderPermissionActorDiagnostic()
        recorderPermissionActor = actor
        guard actor.source == "mainApp" else {
            recorderControlActionInFlight = nil
            recorderControlLastError = [
                "ERR_RECORDER_PERMISSION_ACTOR_MISMATCH: Cannot request \(normalizedID) from actor source \(actor.source).",
                "actorBundleId=\(actor.bundleIdentifier)",
                "actorPath=\(actor.bundlePath)",
                "actorExecutable=\(actor.executablePath)",
            ].joined(separator: " ")
            return
        }
        guard !actor.isAppTranslocated else {
            recorderControlActionInFlight = nil
            recorderControlLastError = [
                "ERR_RECORDER_PERMISSION_ACTOR_APP_TRANSLOCATED: Cannot request \(normalizedID) while Agentic30 is app-translocated.",
                "Move Agentic30 to /Applications, relaunch it, then retry.",
                "actorBundleId=\(actor.bundleIdentifier)",
                "actorPath=\(actor.bundlePath)",
                "actorExecutable=\(actor.executablePath)",
            ].joined(separator: " ")
            return
        }
        let releaseIdentity = Self.currentRecorderPermissionReleaseIdentityDiagnostic(actor: actor)
        recorderPermissionReleaseIdentity = releaseIdentity
        if actor.buildChannel == "release" && !releaseIdentity.externalPermissionOnboardingAllowed {
            recorderControlActionInFlight = nil
            recorderControlLastError = [
                "ERR_RECORDER_PERMISSION_RELEASE_IDENTITY_BLOCKED: Cannot request \(normalizedID) for external onboarding until release identity is verified.",
                "bundleId=\(releaseIdentity.bundleIdentifier)",
                "expectedBundleId=\(releaseIdentity.expectedBundleIdentifier)",
                "teamId=\(releaseIdentity.teamIdentifier)",
                "blockers=\(releaseIdentity.blockers.joined(separator: ","))",
            ].joined(separator: " ")
            return
        }

        recorderControlActionInFlight = "permission_request_\(normalizedID)"
        recorderControlLastError = nil
        switch normalizedID {
        case "screenRecording", "systemAudio":
            _ = CGRequestScreenCaptureAccess()
            finishRecorderPermissionRequest(permissionID: normalizedID)
        case "accessibility":
            let options = [kAXTrustedCheckOptionPrompt.takeUnretainedValue() as String: true] as CFDictionary
            _ = AXIsProcessTrustedWithOptions(options)
            finishRecorderPermissionRequest(permissionID: normalizedID)
        case "inputMonitoring":
            if #available(macOS 10.15, *) {
                _ = IOHIDRequestAccess(kIOHIDRequestTypeListenEvent)
                _ = CGRequestListenEventAccess()
                finishRecorderPermissionRequest(permissionID: normalizedID)
            } else {
                recorderControlActionInFlight = nil
                recorderControlLastError = "ERR_RECORDER_PERMISSION_REQUEST_UNAVAILABLE: Input Monitoring requires macOS 10.15 or newer."
            }
        case "microphone":
            AVCaptureDevice.requestAccess(for: .audio) { [weak self] _ in
                DispatchQueue.main.async {
                    self?.finishRecorderPermissionRequest(permissionID: normalizedID)
                }
            }
        default:
            break
        }
    }

    private func finishRecorderPermissionRequest(permissionID: String) {
        PostHogTelemetry.capture(
            "mac_recorder_permission_request_invoked",
            properties: ["permission": permissionID],
            authSession: macAuthSession
        )
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.5) { [weak self] in
            guard let self else { return }
            guard self.isConnected else {
                self.recorderControlActionInFlight = nil
                self.recorderControlLastError = "실행 보조 앱이 연결되지 않아 macOS 권한 요청 후 상태를 반영할 수 없습니다."
                return
            }
            self.refreshRecorderPermissionProbe()
        }
    }

    func prepareRecorderFrameCapturesForDisplay() {
        guard recorderFrameCaptures.isEmpty else { return }
        refreshRecorderFrameCaptures()
    }

    func refreshRecorderFrameCaptures() {
        guard isConnected else {
            recorderFrameCapturesLastError = "실행 보조 앱이 연결되지 않아 최근 화면 기록을 불러올 수 없습니다."
            return
        }
        recorderFrameCapturesRefreshing = true
        recorderFrameCapturesLastError = nil
        guard sidecar.send(payload: [
            "type": "recorder_frame_captures_list",
            "limit": 24,
        ]) else {
            recorderFrameCapturesRefreshing = false
            recorderFrameCapturesLastError = "최근 화면 기록 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_frame_captures_refresh_requested",
            authSession: macAuthSession
        )
    }

    func prepareRecorderFrameImageForDisplay(frameId: String?) {
        recorderFrameImagePreparedForDisplay = true
        requestRecorderFrameImageIfNeeded(frameId: frameId)
    }

    func loadRecorderFrameImage(frameId: String) {
        recorderFrameImagePreparedForDisplay = true
        requestRecorderFrameImageIfNeeded(frameId: frameId, force: true)
    }

    func captureRecorderFrameNow() {
        captureRecorderFrame(trigger: "manual_swift_screencapturekit", automatic: false)
    }

    func deleteLastRecorderFrame() {
        guard let frameId = recorderLastFrameCapture?.id.trimmingCharacters(in: .whitespacesAndNewlines),
              !frameId.isEmpty else {
            recorderFrameDeleteLastError = "삭제할 화면 기록이 없습니다."
            return
        }
        deleteRecorderFrame(
            id: frameId,
            telemetrySource: "latest_control",
            stopAutomaticCapture: true
        )
    }

    func deleteRecorderFrame(id frameId: String) {
        deleteRecorderFrame(
            id: frameId,
            telemetrySource: "selected_replay_frame",
            stopAutomaticCapture: false
        )
    }

    func deleteRecorderFrameRange(frameIds: [String]) {
        guard !recorderFrameDeleteInFlight else { return }
        guard isConnected else {
            recorderFrameDeleteLastError = "실행 보조 앱이 연결되지 않아 화면 기록 범위를 삭제할 수 없습니다."
            return
        }
        let requested = Set(frameIds.map { $0.trimmingCharacters(in: .whitespacesAndNewlines) }.filter { !$0.isEmpty })
        guard !requested.isEmpty else {
            recorderFrameDeleteLastError = "삭제할 화면 기록 범위가 없습니다."
            return
        }
        let targets = recorderFrameCaptures.filter { requested.contains($0.id) }
        guard !targets.isEmpty else {
            recorderFrameDeleteLastError = "현재 목록에서 삭제할 화면 기록을 찾지 못했습니다."
            return
        }
        let parsedDates = targets.compactMap { Self.recorderDate(fromIsoTimestamp: $0.capturedAt) }
        guard parsedDates.count == targets.count,
              let startedAt = parsedDates.min(),
              let latestAt = parsedDates.max() else {
            recorderFrameDeleteLastError = "화면 기록 시각을 해석하지 못해 범위 삭제를 중단했습니다."
            return
        }
        let endedAt = latestAt.addingTimeInterval(1)
        recorderFrameDeleteInFlight = true
        recorderFrameDeleteLastError = nil
        guard sidecar.send(payload: [
            "type": "recorder_frame_captures_delete_range",
            "startedAt": Self.recorderIsoTimestamp(startedAt),
            "endedAt": Self.recorderIsoTimestamp(endedAt),
            "limit": max(targets.count, 1),
            "confirm": true,
        ]) else {
            recorderFrameDeleteInFlight = false
            recorderFrameDeleteLastError = "화면 기록 범위 삭제 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_frame_captures_delete_range_requested",
            properties: [
                "source": "founder_replay_visible_range",
                "frame_count": targets.count,
            ],
            authSession: macAuthSession
        )
    }

    private func deleteRecorderFrame(
        id frameId: String,
        telemetrySource: String,
        stopAutomaticCapture: Bool
    ) {
        guard !recorderFrameDeleteInFlight else { return }
        guard isConnected else {
            recorderFrameDeleteLastError = "실행 보조 앱이 연결되지 않아 화면 기록을 삭제할 수 없습니다."
            return
        }
        let cleanFrameId = frameId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanFrameId.isEmpty else {
            recorderFrameDeleteLastError = "삭제할 화면 기록이 없습니다."
            return
        }
        if stopAutomaticCapture {
            stopRecorderAutoCapture(reason: "local_user_delete_latest_frame", locallyStopped: true)
        }
        recorderFrameDeleteInFlight = true
        recorderFrameDeleteLastError = nil
        guard sidecar.send(payload: [
            "type": "recorder_frame_capture_delete",
            "frameId": cleanFrameId,
        ]) else {
            recorderFrameDeleteInFlight = false
            recorderFrameDeleteLastError = "화면 기록 삭제 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_frame_capture_delete_requested",
            properties: [
                "source": telemetrySource,
                "frame_id": cleanFrameId,
            ],
            authSession: macAuthSession
        )
    }

    private static let recorderMediaEncryptionKeyId = "agentic30-recorder-media-v1"
    private static var recorderAutomaticRawMediaCaptureCanWriteEncryptedMedia: Bool { true }
    private static let recorderRawMediaEncryptionRequiredMessage =
        "ERR_RECORDER_MEDIA_ENCRYPTION_REQUIRED: 자동/백그라운드 화면 기록은 암호화 저장과 키 관리가 구현되기 전에는 시작할 수 없습니다. 수동 캡처만 사용할 수 있습니다."

    func startRecorderAutoCapture() {
        startRecorderAutoCapture(reason: "local_user_start_auto_capture")
    }

    private func startRecorderAutoCapture(reason: String) {
        guard !recorderAutoCaptureRunning else { return }
        guard isConnected else {
            recorderAutoCaptureLastError = "실행 보조 앱이 연결되지 않아 자동 화면 기록을 시작할 수 없습니다."
            return
        }
        guard recorderCaptureReadiness?.canRecord == true else {
            let blocker = recorderCaptureReadiness?.blockers.first?.message ?? "Recorder capture readiness is blocked."
            recorderAutoCaptureLastError = blocker
            return
        }
        guard Self.recorderAutomaticRawMediaCaptureCanWriteEncryptedMedia else {
            recorderAutoCaptureLastError = Self.recorderRawMediaEncryptionRequiredMessage
            recorderFrameCaptureLastError = Self.recorderRawMediaEncryptionRequiredMessage
            recorderAutoCaptureLocallyStopped = true
            PostHogTelemetry.capture(
                "mac_recorder_auto_capture_blocked",
                properties: [
                    "reason": "raw_media_encryption_required",
                ],
                authSession: macAuthSession
            )
            return
        }
        recorderAutoCaptureLocallyStopped = false
        recorderAutoCaptureRunning = true
        recorderAutoCaptureLastError = nil
        let startTrigger = reason == "readiness_auto_arm"
            ? "auto_swift_screencapturekit_readiness_auto_arm"
            : "auto_swift_screencapturekit_start"
        recorderAutoCaptureLastTrigger = startTrigger
        installRecorderAutoCaptureTriggers()
        startRecorderEventTapTriggerIfReady()
        startRecorderFrameStreamForAutoCapture(startTrigger: startTrigger)
        PostHogTelemetry.capture(
            "mac_recorder_auto_capture_started",
            properties: [
                "interval_seconds": Int(recorderAutoCaptureIntervalSeconds),
                "reason": reason,
            ],
            authSession: macAuthSession
        )
    }

    private func startRecorderFrameStreamForAutoCapture(startTrigger: String) {
        #if canImport(ScreenCaptureKit)
        guard #available(macOS 14.0, *) else {
            captureRecorderFrame(trigger: startTrigger, automatic: true)
            return
        }
        stopRecorderFrameStreamSession()
        Task { [weak self] in
            do {
                let session = try await Self.startScreenCaptureKitFrameStreamSession()
                await MainActor.run {
                    guard let self else {
                        session.stop()
                        return
                    }
                    guard self.recorderAutoCaptureRunning else {
                        session.stop()
                        return
                    }
                    self.recorderFrameStreamSession = session
                    self.captureRecorderFrame(trigger: startTrigger, automatic: true)
                }
            } catch {
                await MainActor.run {
                    guard let self else { return }
                    self.recorderAutoCaptureLastError = error.localizedDescription
                    self.recorderFrameCaptureLastError = error.localizedDescription
                    self.stopRecorderAutoCapture(
                        reason: "frame_stream_start_failed",
                        errorMessage: error.localizedDescription,
                        locallyStopped: true
                    )
                    PostHogTelemetry.captureException(error, properties: [
                        "component": "agentic_view_model",
                        "operation": "recorder_frame_stream_start",
                        "capture_trigger": startTrigger,
                    ], authSession: self.macAuthSession)
                }
            }
        }
        #else
        captureRecorderFrame(trigger: startTrigger, automatic: true)
        #endif
    }

    func stopRecorderAutoCapture() {
        stopRecorderAutoCapture(reason: "local_user_stop_auto_capture", locallyStopped: true)
    }

    private func captureRecorderFrame(trigger: String, automatic: Bool) {
        guard !recorderFrameCaptureInFlight else { return }
        guard isConnected else {
            recorderFrameCaptureLastError = "실행 보조 앱이 연결되지 않아 화면 캡처를 저장할 수 없습니다."
            if automatic {
                stopRecorderAutoCapture(reason: "sidecar_disconnected", errorMessage: recorderFrameCaptureLastError)
            }
            return
        }
        guard recorderCaptureReadiness?.canRecord == true else {
            let blocker = recorderCaptureReadiness?.blockers.first?.message ?? "Recorder capture readiness is blocked."
            recorderFrameCaptureLastError = blocker
            if automatic {
                stopRecorderAutoCapture(reason: "readiness_blocked", errorMessage: blocker)
            }
            return
        }
        recorderFrameCaptureInFlight = true
        recorderFrameCaptureLastError = nil
        #if canImport(ScreenCaptureKit)
        let frameStreamSession = recorderFrameStreamSession
        #endif
        Task { [weak self] in
            do {
                #if canImport(ScreenCaptureKit)
                let envelope = try await Self.buildScreenCaptureKitFrameEnvelope(
                    trigger: trigger,
                    encryptedMedia: automatic,
                    frameStreamSession: frameStreamSession
                )
                #else
                let envelope = try await Self.buildScreenCaptureKitFrameEnvelope(
                    trigger: trigger,
                    encryptedMedia: automatic
                )
                #endif
                await MainActor.run {
                    self?.sendRecorderFrameCaptureEnvelope(envelope, automatic: automatic)
                }
            } catch {
                await MainActor.run {
                    self?.recorderFrameCaptureInFlight = false
                    self?.recorderFrameCaptureLastError = error.localizedDescription
                    if automatic {
                        self?.stopRecorderAutoCapture(
                            reason: "capture_failed",
                            errorMessage: error.localizedDescription,
                            locallyStopped: true
                        )
                    }
                    PostHogTelemetry.captureException(error, properties: [
                        "component": "agentic_view_model",
                        "operation": automatic ? "recorder_auto_capture" : "recorder_frame_capture_now",
                        "capture_trigger": trigger,
                    ], authSession: self?.macAuthSession)
                }
            }
        }
    }

    private func installRecorderAutoCaptureTriggers() {
        recorderAutoCaptureTimer?.invalidate()
        recorderAutoCaptureTimer = Timer.scheduledTimer(
            withTimeInterval: recorderAutoCaptureIntervalSeconds,
            repeats: true
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.recordRecorderAutoCaptureTrigger("auto_swift_screencapturekit_interval")
            }
        }
        recorderAutoCaptureTimer?.tolerance = min(15, recorderAutoCaptureIntervalSeconds / 4)

        if recorderAutoCaptureActivationObserver == nil {
            recorderAutoCaptureActivationObserver = NSWorkspace.shared.notificationCenter.addObserver(
                forName: NSWorkspace.didActivateApplicationNotification,
                object: nil,
                queue: .main
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.recordRecorderAutoCaptureTrigger("auto_swift_screencapturekit_app_activation")
                }
            }
        }
    }

    private func startRecorderEventTapTriggerIfReady() {
        guard recorderEventTapTrigger == nil else { return }
        guard Self.recorderEventTapTriggerReady(for: recorderCaptureReadiness) else {
            recorderAutoCaptureLastTrigger = "event_tap_not_ready"
            return
        }
        guard Self.currentRecorderInputMonitoringPermissionState() == "granted" else {
            recorderAutoCaptureLastTrigger = "event_tap_permission_missing"
            return
        }
        guard let eventTapConfig = Self.makeRecorderEventTap(onEvent: { [weak self] eventKind in
            Task { @MainActor [weak self] in
                self?.recordRecorderEventTapTrigger(eventKind: eventKind)
            }
        }) else {
            recorderAutoCaptureLastError = "ERR_RECORDER_EVENT_TAP_CREATE_FAILED: Input Monitoring/Event Tap permission is granted, but the listen-only event tap could not be created."
            recorderAutoCaptureLastTrigger = "event_tap_create_failed"
            return
        }
        guard let runLoopSource = CFMachPortCreateRunLoopSource(kCFAllocatorDefault, eventTapConfig.eventTap, 0) else {
            recorderAutoCaptureLastError = "ERR_RECORDER_EVENT_TAP_RUN_LOOP_SOURCE_FAILED: Input Monitoring/Event Tap permission is granted, but the listen-only run loop source could not be created."
            recorderAutoCaptureLastTrigger = "event_tap_run_loop_source_failed"
            CFMachPortInvalidate(eventTapConfig.eventTap)
            return
        }
        CFRunLoopAddSource(CFRunLoopGetMain(), runLoopSource, .commonModes)
        CGEvent.tapEnable(tap: eventTapConfig.eventTap, enable: true)
        recorderEventTapTrigger = RecorderEventTapTrigger(
            eventTap: eventTapConfig.eventTap,
            runLoopSource: runLoopSource,
            callbackBox: eventTapConfig.callbackBox
        )
        recorderEventTapLastTriggerAt = nil
        PostHogTelemetry.capture(
            "mac_recorder_event_tap_trigger_started",
            properties: [
                "raw_key_capture": false,
            ],
            authSession: macAuthSession
        )
    }

    private func stopRecorderEventTapTrigger() {
        recorderEventTapTrigger?.stop()
        recorderEventTapTrigger = nil
        recorderEventTapLastTriggerAt = nil
    }

    private func recordRecorderEventTapTrigger(eventKind: String) {
        guard recorderAutoCaptureRunning else { return }
        let now = Date()
        if let recorderEventTapLastTriggerAt,
           now.timeIntervalSince(recorderEventTapLastTriggerAt) < 10 {
            recorderAutoCaptureLastTrigger = "auto_swift_event_tap_\(eventKind)_debounced"
            return
        }
        recorderEventTapLastTriggerAt = now
        recordRecorderAutoCaptureTrigger("auto_swift_event_tap_\(eventKind)")
    }

    private func reconcileRecorderEventTapTriggerWithReadiness() {
        guard recorderAutoCaptureRunning else {
            stopRecorderEventTapTrigger()
            return
        }
        guard Self.recorderEventTapTriggerReady(for: recorderCaptureReadiness) else {
            stopRecorderEventTapTrigger()
            return
        }
        startRecorderEventTapTriggerIfReady()
    }

    private func recordRecorderAutoCaptureTrigger(_ trigger: String) {
        guard recorderAutoCaptureRunning else { return }
        guard !recorderFrameCaptureInFlight else {
            recorderAutoCaptureLastTrigger = "\(trigger)_skipped_in_flight"
            return
        }
        guard recorderCaptureReadiness?.canRecord == true else {
            let blocker = recorderCaptureReadiness?.blockers.first?.message ?? "Recorder capture readiness is blocked."
            stopRecorderAutoCapture(reason: "readiness_blocked", errorMessage: blocker)
            return
        }
        recorderAutoCaptureLastTrigger = trigger
        captureRecorderFrame(trigger: trigger, automatic: true)
    }

    private func reconcileRecorderAutoCaptureWithReadiness() {
        if recorderCaptureReadiness?.canRecord == true {
            if !recorderAutoCaptureRunning && !recorderAutoCaptureLocallyStopped {
                startRecorderAutoCapture(reason: "readiness_auto_arm")
            } else {
                reconcileRecorderEventTapTriggerWithReadiness()
            }
            return
        }

        if recorderAutoCaptureRunning {
            let blocker = recorderCaptureReadiness?.blockers.first?.message ?? "Recorder capture readiness is blocked."
            stopRecorderAutoCapture(reason: "readiness_blocked", errorMessage: blocker)
        }
    }

    private func reconcileRecorderClipboardCollectorWithControlState() {
        guard isConnected,
              recorderControlState?.mode == "active",
              recorderControlState?.consent.status == "granted",
              recorderControlState?.permissions["clipboard"] == "granted",
              recorderControlState?.sensitiveCapture.clipboardMode != "blocked" else {
            stopRecorderClipboardCollector()
            return
        }
        startRecorderClipboardCollector()
    }

    private func reconcileRecorderAudioCollectorsWithControlState() {
        guard isConnected,
              let controlState = recorderControlState,
              controlState.mode == "active",
              controlState.consent.status == "granted" else {
            stopRecorderMicrophoneCollector(reason: "control_state_not_active", clearError: false)
            stopRecorderSystemAudioCollector(reason: "control_state_not_active", clearError: false)
            return
        }

        if controlState.sensitiveCapture.microphone {
            startRecorderMicrophoneCollectorIfReady()
        } else {
            stopRecorderMicrophoneCollector(reason: "microphone_policy_disabled", clearError: true)
        }

        if controlState.sensitiveCapture.systemAudio {
            startRecorderSystemAudioCollectorIfReady()
        } else {
            stopRecorderSystemAudioCollector(reason: "system_audio_policy_disabled", clearError: true)
        }
    }

    private func startRecorderClipboardCollector() {
        guard recorderClipboardCollectorTimer == nil else { return }
        recorderClipboardLastChangeCount = NSPasteboard.general.changeCount
        recorderClipboardLastError = nil
        recorderClipboardCollectorTimer = Timer.scheduledTimer(
            withTimeInterval: 2,
            repeats: true
        ) { [weak self] _ in
            Task { @MainActor [weak self] in
                self?.pollRecorderClipboardChangeCount()
            }
        }
        recorderClipboardCollectorTimer?.tolerance = 0.5
    }

    private func stopRecorderClipboardCollector() {
        recorderClipboardCollectorTimer?.invalidate()
        recorderClipboardCollectorTimer = nil
        recorderClipboardLastChangeCount = nil
    }

    private func pollRecorderClipboardChangeCount() {
        let pasteboard = NSPasteboard.general
        let changeCount = pasteboard.changeCount
        guard changeCount != recorderClipboardLastChangeCount else { return }
        recorderClipboardLastChangeCount = changeCount
        let pasteboardTypes = pasteboard.types?.map(\.rawValue) ?? []
        let contentType = Self.recorderClipboardContentType(from: pasteboardTypes)
        let contentText = recorderControlState?.sensitiveCapture.clipboardMode == "content_opt_in"
            && (contentType == "text" || contentType == "url")
            ? pasteboard.string(forType: .string)
            : nil
        recordRecorderClipboardTrigger(
            changeCount: changeCount,
            pasteboardTypes: pasteboardTypes,
            occurredAt: Date(),
            appName: NSWorkspace.shared.frontmostApplication?.localizedName,
            windowTitle: NSApp.keyWindow?.title,
            contentText: contentText
        )
    }

    private func recordRecorderClipboardTrigger(
        changeCount: Int,
        pasteboardTypes: [String],
        occurredAt: Date,
        appName: String?,
        windowTitle: String?,
        contentText: String? = nil
    ) {
        guard isConnected else {
            recorderClipboardLastError = "ERR_RECORDER_CLIPBOARD_SIDECAR_DISCONNECTED: 실행 보조 앱이 연결되지 않아 Clipboard trigger를 기록할 수 없습니다."
            return
        }
        let contentType = Self.recorderClipboardContentType(from: pasteboardTypes)
        var event: [String: Any] = [
            "id": "clipboard-\(UUID().uuidString.lowercased())",
            "occurredAt": Self.recorderIsoTimestamp(occurredAt),
            "eventKind": "change",
            "contentType": contentType,
            "redactionStatus": "not_collected",
            "privacyState": "trigger_only_local",
            "safeForSearch": false,
            "safeForMemory": false,
            "safeForExport": false,
        ]
        let cleanAppName = appName?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let cleanAppName, !cleanAppName.isEmpty {
            event["appName"] = cleanAppName
        }
        let cleanWindowTitle = windowTitle?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let cleanWindowTitle, !cleanWindowTitle.isEmpty {
            event["windowTitle"] = cleanWindowTitle
        }
        let cleanContentText = contentText?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let cleanContentText, !cleanContentText.isEmpty {
            event["contentText"] = cleanContentText
            event["privacyState"] = "raw_local"
            event.removeValue(forKey: "redactionStatus")
        }
        let sent = sidecar.send(payload: [
            "type": "recorder_clipboard_event_record",
            "event": event,
        ])
        guard sent else {
            recorderClipboardLastError = "ERR_RECORDER_CLIPBOARD_SEND_FAILED: Clipboard trigger 기록 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        recorderClipboardLastError = nil
        PostHogTelemetry.capture(
            "mac_recorder_clipboard_trigger_record_requested",
            properties: [
                "content_type": event["contentType"] as? String ?? "unknown",
            ],
            authSession: macAuthSession
        )
    }

    private func startRecorderMicrophoneCollectorIfReady() {
        guard recorderMicrophoneRecorder == nil else { return }
        guard !recorderMicrophoneAudioChunkInFlight else { return }
        guard isConnected else {
            recorderAudioCaptureLastError = "ERR_RECORDER_AUDIO_SIDECAR_DISCONNECTED: 실행 보조 앱이 연결되지 않아 Microphone audio를 기록할 수 없습니다."
            return
        }
        let controlPermission = recorderControlState?.permissions["microphone"] ?? "unknown"
        guard controlPermission == "granted" else {
            recorderAudioCaptureLastError = "ERR_RECORDER_AUDIO_MICROPHONE_PERMISSION_MISSING: microphone permission is \(controlPermission)."
            return
        }
        let runtimePermission = Self.currentRecorderMicrophonePermissionState()
        guard runtimePermission == "granted" else {
            recorderAudioCaptureLastError = "ERR_RECORDER_AUDIO_MICROPHONE_PERMISSION_MISSING: runtime microphone permission is \(runtimePermission)."
            return
        }
        startRecorderMicrophoneChunk()
    }

    private func startRecorderMicrophoneChunk() {
        guard recorderMicrophoneRecorder == nil else { return }
        do {
            let tempURL = try Self.recorderTemporaryAudioFileURL()
            let settings: [String: Any] = [
                AVFormatIDKey: Int(kAudioFormatMPEG4AAC),
                AVSampleRateKey: 16_000,
                AVNumberOfChannelsKey: 1,
                AVEncoderBitRateKey: 32_000,
            ]
            let recorder = try AVAudioRecorder(url: tempURL, settings: settings)
            recorder.isMeteringEnabled = false
            guard recorder.prepareToRecord(), recorder.record() else {
                throw RecorderAudioCaptureError.microphoneRecorderStartFailed
            }
            let startedAt = Date()
            recorderMicrophoneRecorder = recorder
            recorderMicrophoneChunkStartedAt = startedAt
            recorderMicrophoneTempFileURL = tempURL
            updateRecorderAudioCaptureRunning()
            recorderAudioCaptureLastError = nil
            recorderMicrophoneChunkTimer?.invalidate()
            recorderMicrophoneChunkTimer = Timer.scheduledTimer(
                withTimeInterval: recorderAudioChunkDurationSeconds,
                repeats: false
            ) { [weak self] _ in
                Task { @MainActor [weak self] in
                    self?.finishRecorderMicrophoneChunk()
                }
            }
            recorderMicrophoneChunkTimer?.tolerance = min(5, recorderAudioChunkDurationSeconds / 5)
        } catch {
            recorderAudioCaptureLastError = error.localizedDescription
            cleanupRecorderMicrophoneChunkFile()
            updateRecorderAudioCaptureRunning()
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "recorder_microphone_capture_start",
            ], authSession: macAuthSession)
        }
    }

    private func finishRecorderMicrophoneChunk() {
        guard let recorder = recorderMicrophoneRecorder,
              let startedAt = recorderMicrophoneChunkStartedAt,
              let tempURL = recorderMicrophoneTempFileURL else {
            cleanupRecorderMicrophoneChunkFile()
            return
        }
        recorder.stop()
        recorderMicrophoneChunkTimer?.invalidate()
        recorderMicrophoneChunkTimer = nil
        recorderMicrophoneRecorder = nil
        recorderMicrophoneChunkStartedAt = nil
        recorderMicrophoneTempFileURL = nil
        guard let consentGrantId = recorderAudioConsentGrantId() else {
            cleanupRecorderMicrophoneChunkFile(url: tempURL)
            recorderAudioCaptureLastError = "ERR_RECORDER_AUDIO_CONSENT_GRANT_ID_MISSING: recorder audio chunk requires a consent grant id."
            updateRecorderAudioCaptureRunning()
            return
        }
        let endedAt = Date()
        recorderMicrophoneAudioChunkInFlight = true
        updateRecorderAudioCaptureRunning()

        Task { [weak self] in
            let transcript = await Self.transcribeRecorderAudioLocallyIfAvailable(
                fileURL: tempURL,
                startedAt: startedAt,
                endedAt: endedAt
            )
            do {
                let audio = try Self.buildEncryptedRecorderAudioChunkEnvelope(
                    source: "microphone",
                    startedAt: startedAt,
                    endedAt: endedAt,
                    temporaryFileURL: tempURL,
                    consentGrantId: consentGrantId,
                    transcript: transcript
                )
                await MainActor.run {
                    guard let self else { return }
                    guard self.recorderMicrophoneAudioChunkInFlight else {
                        self.updateRecorderAudioCaptureRunning()
                        return
                    }
                    let sent = self.sendRecorderAudioChunkEnvelope(
                        audio,
                        captureMode: "background",
                        automatic: true
                    )
                    if sent {
                        if self.shouldContinueRecorderMicrophoneCollector() {
                            self.startRecorderMicrophoneChunk()
                        } else {
                            self.updateRecorderAudioCaptureRunning()
                        }
                    } else {
                        self.stopRecorderMicrophoneCollector(reason: "audio_ingest_send_failed", clearError: false)
                    }
                }
            } catch {
                await MainActor.run {
                    if let self {
                        self.recorderMicrophoneAudioChunkInFlight = false
                        self.recorderAudioCaptureLastError = error.localizedDescription
                        self.cleanupRecorderMicrophoneChunkFile(url: tempURL)
                        self.updateRecorderAudioCaptureRunning()
                        PostHogTelemetry.captureException(error, properties: [
                            "component": "agentic_view_model",
                            "operation": "recorder_microphone_chunk_finish",
                        ], authSession: self.macAuthSession)
                    } else {
                        try? FileManager.default.removeItem(at: tempURL)
                    }
                }
            }
        }
    }

    private func shouldContinueRecorderMicrophoneCollector() -> Bool {
        isConnected
            && recorderControlState?.mode == "active"
            && recorderControlState?.consent.status == "granted"
            && recorderControlState?.permissions["microphone"] == "granted"
            && recorderControlState?.sensitiveCapture.microphone == true
            && Self.currentRecorderMicrophonePermissionState() == "granted"
    }

    private func stopRecorderMicrophoneCollector(reason: String, clearError: Bool) {
        recorderMicrophoneChunkTimer?.invalidate()
        recorderMicrophoneChunkTimer = nil
        recorderMicrophoneRecorder?.stop()
        recorderMicrophoneRecorder = nil
        recorderMicrophoneChunkStartedAt = nil
        cleanupRecorderMicrophoneChunkFile()
        recorderMicrophoneAudioChunkInFlight = false
        updateRecorderAudioCaptureRunning()
        if clearError {
            recorderAudioCaptureLastError = nil
        }
        if reason != "microphone_policy_disabled" && reason != "control_state_not_active" {
            PostHogTelemetry.capture(
                "mac_recorder_microphone_capture_stopped",
                properties: [
                    "reason": reason,
                ],
                authSession: macAuthSession
            )
        }
    }

    private func cleanupRecorderMicrophoneChunkFile(url explicitURL: URL? = nil) {
        let url = explicitURL ?? recorderMicrophoneTempFileURL
        if let url {
            try? FileManager.default.removeItem(at: url)
        }
        if explicitURL == nil {
            recorderMicrophoneTempFileURL = nil
        }
    }

    private func startRecorderSystemAudioCollectorIfReady() {
        guard recorderSystemAudioSession == nil, !recorderSystemAudioStartInFlight else { return }
        guard !recorderSystemAudioChunkInFlight else { return }
        guard isConnected else {
            recorderAudioCaptureLastError = "ERR_RECORDER_AUDIO_SIDECAR_DISCONNECTED: 실행 보조 앱이 연결되지 않아 System Audio를 기록할 수 없습니다."
            return
        }
        let controlPermission = recorderControlState?.permissions["systemAudio"] ?? "unknown"
        guard controlPermission == "granted" else {
            recorderAudioCaptureLastError = "ERR_RECORDER_SYSTEM_AUDIO_PERMISSION_MISSING: systemAudio permission is \(controlPermission)."
            return
        }
        let runtimePermission = Self.currentRecorderSystemAudioPermissionState()
        guard runtimePermission == "granted" else {
            recorderAudioCaptureLastError = "ERR_RECORDER_SYSTEM_AUDIO_PERMISSION_MISSING: runtime systemAudio permission is \(runtimePermission)."
            return
        }
        startRecorderSystemAudioChunk()
    }

    private func startRecorderSystemAudioChunk() {
        guard recorderSystemAudioSession == nil, !recorderSystemAudioStartInFlight else { return }
        recorderSystemAudioStartInFlight = true
        updateRecorderAudioCaptureRunning()
        let startedAt = Date()
        Task { [weak self] in
            var tempURL: URL?
            do {
                let url = try Self.recorderTemporaryAudioFileURL()
                tempURL = url
                let session = try await Self.startRecorderSystemAudioCaptureSession(outputURL: url)
                await MainActor.run {
                    guard let self else {
                        session.cancel()
                        return
                    }
                    guard self.shouldContinueRecorderSystemAudioCollector() else {
                        session.cancel()
                        self.recorderSystemAudioStartInFlight = false
                        self.updateRecorderAudioCaptureRunning()
                        return
                    }
                    self.recorderSystemAudioSession = session
                    self.recorderSystemAudioChunkStartedAt = startedAt
                    self.recorderSystemAudioTempFileURL = url
                    self.recorderSystemAudioStartInFlight = false
                    self.recorderAudioCaptureLastError = nil
                    self.updateRecorderAudioCaptureRunning()
                    self.recorderSystemAudioChunkTimer?.invalidate()
                    self.recorderSystemAudioChunkTimer = Timer.scheduledTimer(
                        withTimeInterval: self.recorderAudioChunkDurationSeconds,
                        repeats: false
                    ) { [weak self] _ in
                        Task { @MainActor [weak self] in
                            self?.finishRecorderSystemAudioChunk()
                        }
                    }
                    self.recorderSystemAudioChunkTimer?.tolerance = min(5, self.recorderAudioChunkDurationSeconds / 5)
                }
            } catch {
                await MainActor.run {
                    if let self {
                        self.recorderSystemAudioStartInFlight = false
                        self.recorderAudioCaptureLastError = error.localizedDescription
                        if let tempURL {
                            try? FileManager.default.removeItem(at: tempURL)
                        }
                        self.updateRecorderAudioCaptureRunning()
                        PostHogTelemetry.captureException(error, properties: [
                            "component": "agentic_view_model",
                            "operation": "recorder_system_audio_capture_start",
                        ], authSession: self.macAuthSession)
                    } else if let tempURL {
                        try? FileManager.default.removeItem(at: tempURL)
                    }
                }
            }
        }
    }

    private func finishRecorderSystemAudioChunk() {
        guard let session = recorderSystemAudioSession,
              let startedAt = recorderSystemAudioChunkStartedAt,
              let tempURL = recorderSystemAudioTempFileURL else {
            cleanupRecorderSystemAudioChunkFile()
            return
        }
        recorderSystemAudioChunkTimer?.invalidate()
        recorderSystemAudioChunkTimer = nil
        recorderSystemAudioSession = nil
        recorderSystemAudioChunkStartedAt = nil
        recorderSystemAudioTempFileURL = nil
        guard let consentGrantId = recorderAudioConsentGrantId() else {
            session.cancel()
            cleanupRecorderSystemAudioChunkFile(url: tempURL)
            recorderAudioCaptureLastError = "ERR_RECORDER_AUDIO_CONSENT_GRANT_ID_MISSING: recorder audio chunk requires a consent grant id."
            updateRecorderAudioCaptureRunning()
            return
        }
        recorderSystemAudioChunkInFlight = true
        updateRecorderAudioCaptureRunning()

        Task { [weak self] in
            do {
                try await session.stopAndFinalize()
                let endedAt = Date()
                let transcript = await Self.transcribeRecorderAudioLocallyIfAvailable(
                    fileURL: tempURL,
                    startedAt: startedAt,
                    endedAt: endedAt
                )
                let audio = try Self.buildEncryptedRecorderAudioChunkEnvelope(
                    source: "system_audio",
                    startedAt: startedAt,
                    endedAt: endedAt,
                    temporaryFileURL: tempURL,
                    consentGrantId: consentGrantId,
                    transcript: transcript
                )
                await MainActor.run {
                    guard let self else { return }
                    guard self.recorderSystemAudioChunkInFlight else {
                        self.updateRecorderAudioCaptureRunning()
                        return
                    }
                    let sent = self.sendRecorderAudioChunkEnvelope(
                        audio,
                        captureMode: "background",
                        automatic: true
                    )
                    if sent {
                        if self.shouldContinueRecorderSystemAudioCollector() {
                            self.startRecorderSystemAudioChunk()
                        } else {
                            self.updateRecorderAudioCaptureRunning()
                        }
                    } else {
                        self.stopRecorderSystemAudioCollector(reason: "audio_ingest_send_failed", clearError: false)
                    }
                }
            } catch {
                await MainActor.run {
                    if let self {
                        self.recorderSystemAudioChunkInFlight = false
                        self.recorderAudioCaptureLastError = error.localizedDescription
                        self.cleanupRecorderSystemAudioChunkFile(url: tempURL)
                        self.updateRecorderAudioCaptureRunning()
                        PostHogTelemetry.captureException(error, properties: [
                            "component": "agentic_view_model",
                            "operation": "recorder_system_audio_chunk_finish",
                        ], authSession: self.macAuthSession)
                    } else {
                        try? FileManager.default.removeItem(at: tempURL)
                    }
                }
            }
        }
    }

    private func shouldContinueRecorderSystemAudioCollector() -> Bool {
        isConnected
            && recorderControlState?.mode == "active"
            && recorderControlState?.consent.status == "granted"
            && recorderControlState?.permissions["systemAudio"] == "granted"
            && recorderControlState?.sensitiveCapture.systemAudio == true
            && Self.currentRecorderSystemAudioPermissionState() == "granted"
    }

    private func stopRecorderSystemAudioCollector(reason: String, clearError: Bool) {
        recorderSystemAudioChunkTimer?.invalidate()
        recorderSystemAudioChunkTimer = nil
        recorderSystemAudioSession?.cancel()
        recorderSystemAudioSession = nil
        recorderSystemAudioStartInFlight = false
        recorderSystemAudioChunkStartedAt = nil
        cleanupRecorderSystemAudioChunkFile()
        recorderSystemAudioChunkInFlight = false
        updateRecorderAudioCaptureRunning()
        if clearError {
            recorderAudioCaptureLastError = nil
        }
        if reason != "system_audio_policy_disabled" && reason != "control_state_not_active" {
            PostHogTelemetry.capture(
                "mac_recorder_system_audio_capture_stopped",
                properties: [
                    "reason": reason,
                ],
                authSession: macAuthSession
            )
        }
    }

    private func cleanupRecorderSystemAudioChunkFile(url explicitURL: URL? = nil) {
        let url = explicitURL ?? recorderSystemAudioTempFileURL
        if let url {
            try? FileManager.default.removeItem(at: url)
        }
        if explicitURL == nil {
            recorderSystemAudioTempFileURL = nil
        }
    }

    private func updateRecorderAudioCaptureRunning() {
        recorderAudioChunkInFlight = recorderMicrophoneAudioChunkInFlight
            || recorderSystemAudioChunkInFlight
        recorderAudioCaptureRunning = recorderMicrophoneRecorder != nil
            || recorderSystemAudioSession != nil
            || recorderSystemAudioStartInFlight
            || recorderMicrophoneAudioChunkInFlight
            || recorderSystemAudioChunkInFlight
    }

    private func sendRecorderAudioChunkEnvelope(
        _ audio: [String: Any],
        captureMode: String,
        automatic: Bool
    ) -> Bool {
        guard isConnected else {
            recorderAudioCaptureLastError = "ERR_RECORDER_AUDIO_SIDECAR_DISCONNECTED: 실행 보조 앱이 연결되지 않아 Audio chunk를 기록할 수 없습니다."
            return false
        }
        if !recorderMicrophoneAudioChunkInFlight && !recorderSystemAudioChunkInFlight {
            recorderAudioChunkInFlight = true
        }
        updateRecorderAudioCaptureRunning()
        let sent = sidecar.send(payload: [
            "type": "recorder_audio_chunk_record",
            "audio": audio,
            "captureMode": captureMode,
            "automatic": automatic,
            "background": automatic,
        ])
        guard sent else {
            recorderMicrophoneAudioChunkInFlight = false
            recorderSystemAudioChunkInFlight = false
            recorderAudioCaptureLastError = "ERR_RECORDER_AUDIO_SEND_FAILED: Audio chunk 기록 요청을 실행 보조 앱에 보내지 못했습니다."
            updateRecorderAudioCaptureRunning()
            return false
        }
        PostHogTelemetry.capture(
            "mac_recorder_audio_chunk_record_requested",
            properties: [
                "source": audio["source"] as? String ?? "unknown",
                "capture_mode": captureMode,
                "automatic": automatic,
            ],
            authSession: macAuthSession
        )
        return true
    }

    private func recorderAudioConsentGrantId() -> String? {
        guard recorderControlState?.consent.status == "granted" else { return nil }
        let grantId = recorderControlState?.consent.grantId?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        return grantId?.isEmpty == false ? grantId : nil
    }

    private func stopRecorderAutoCapture(
        reason: String,
        errorMessage: String? = nil,
        locallyStopped: Bool = false
    ) {
        if locallyStopped {
            recorderAutoCaptureLocallyStopped = true
        }
        let wasRunning = recorderAutoCaptureRunning
            || recorderAutoCaptureTimer != nil
            || recorderAutoCaptureActivationObserver != nil

        recorderAutoCaptureTimer?.invalidate()
        recorderAutoCaptureTimer = nil
        stopRecorderFrameStreamSession()
        stopRecorderEventTapTrigger()
        if let recorderAutoCaptureActivationObserver {
            NSWorkspace.shared.notificationCenter.removeObserver(recorderAutoCaptureActivationObserver)
            self.recorderAutoCaptureActivationObserver = nil
        }
        recorderAutoCaptureRunning = false
        if let errorMessage {
            recorderAutoCaptureLastError = errorMessage
        } else if reason == "local_user_stop_auto_capture" {
            recorderAutoCaptureLastError = nil
        }

        guard wasRunning else { return }
        PostHogTelemetry.capture(
            "mac_recorder_auto_capture_stopped",
            properties: [
                "reason": reason,
            ],
            authSession: macAuthSession
        )
    }

    private func stopRecorderFrameStreamSession() {
        #if canImport(ScreenCaptureKit)
        recorderFrameStreamSession?.stop()
        recorderFrameStreamSession = nil
        #endif
    }

    private func sendRecorderControlAction(_ action: [String: Any], actionID: String) {
        guard isConnected else {
            recorderControlLastError = "실행 보조 앱이 연결되지 않아 Recorder 제어 요청을 보낼 수 없습니다."
            return
        }
        recorderControlActionInFlight = actionID
        recorderControlLastError = nil
        let sent = sidecar.send(payload: [
            "type": "recorder_control_action",
            "action": action,
        ])
        guard sent else {
            recorderControlActionInFlight = nil
            recorderControlLastError = "Recorder 제어 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_control_action_requested",
            properties: ["action": actionID],
            authSession: macAuthSession
        )
    }

    private func sendRecorderSensitiveCapturePatch(_ patch: [String: Any], actionID: String) {
        var action = patch
        action["type"] = "set_sensitive_capture"
        sendRecorderControlAction(action, actionID: actionID)
    }

    private func sendRecorderFrameCaptureEnvelope(_ envelope: [String: Any], automatic: Bool) {
        let captureMode = automatic ? "automatic" : "manual"
        let sent = sidecar.send(payload: [
            "type": "recorder_frame_capture_ingest",
            "envelope": envelope,
            "captureMode": captureMode,
            "automatic": automatic,
        ])
        guard sent else {
            recorderFrameCaptureInFlight = false
            recorderFrameCaptureLastError = "화면 캡처 저장 요청을 실행 보조 앱에 보내지 못했습니다."
            if automatic {
                stopRecorderAutoCapture(reason: "ingest_send_failed", errorMessage: recorderFrameCaptureLastError)
            }
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_frame_capture_ingest_requested",
            properties: [
                "capture_trigger": envelope["captureTrigger"] as? String ?? "unknown",
                "capture_mode": captureMode,
                "automatic": automatic,
            ],
            authSession: macAuthSession
        )
    }

    private func requestRecorderFrameImageIfNeeded(frameId: String?, force: Bool = false) {
        let id = frameId?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !id.isEmpty else {
            recorderFrameImagePreview = nil
            recorderFrameImageLoadingID = nil
            pendingRecorderFrameImageRequestID = nil
            return
        }
        if !force && recorderFrameImagePreview?.frameId == id {
            return
        }
        if !force && recorderFrameImageLoadingID == id {
            return
        }
        guard isConnected else {
            recorderFrameImageLastError = "실행 보조 앱이 연결되지 않아 캡처 이미지를 불러올 수 없습니다."
            return
        }
        recorderFrameImageLoadingID = id
        recorderFrameImageLastError = nil
        pendingRecorderFrameImageRequestID = id
        guard sidecar.send(payload: [
            "type": "recorder_raw_api_token_issue",
            "scopes": ["raw_frame"],
            "ttlMs": 60_000,
            "clientId": Self.recorderFrameImageClientId,
            "clientName": "Agentic30 Founder Replay",
        ]) else {
            recorderFrameImageLoadingID = nil
            pendingRecorderFrameImageRequestID = nil
            recorderFrameImageLastError = "raw_frame 토큰 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_frame_image_token_requested",
            properties: ["frame_id": id],
            authSession: macAuthSession
        )
    }

    private func handleRecorderRawApiTokenIssued(_ event: SidecarEvent) {
        if let status = event.recorderRawApi {
            recorderRawApiStatus = status
        }
        guard let token = event.recorderRawApiToken else {
            return
        }
        if token.clientId == Self.recorderFrameImageClientId,
           token.scopes.contains("raw_frame"),
           let requestedFrameID = pendingRecorderFrameImageRequestID {
            handleRecorderFrameImageToken(token, status: event.recorderRawApi ?? recorderRawApiStatus, requestedFrameID: requestedFrameID)
            return
        }
        if token.clientId == Self.recorderSearchClientId,
           token.scopes.contains("search"),
           let pendingQuery = pendingRecorderSearchQuery {
            handleRecorderSearchToken(token, status: event.recorderRawApi ?? recorderRawApiStatus, query: pendingQuery)
            return
        }
        if token.clientId == Self.recorderSqlInspectorClientId,
           token.scopes.contains("raw_sql"),
           let pendingQuery = pendingRecorderSqlQuery {
            handleRecorderSqlQueryToken(token, status: event.recorderRawApi ?? recorderRawApiStatus, query: pendingQuery)
        }
    }

    private func handleRecorderFrameImageToken(
        _ token: RecorderRawApiToken,
        status: RecorderRawApiStatus?,
        requestedFrameID: String
    ) {
        pendingRecorderFrameImageRequestID = nil
        guard let rawApiURL = status?.url.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawApiURL.isEmpty,
              status?.enabled == true else {
            recorderFrameImageLoadingID = nil
            recorderFrameImageLastError = "Recorder raw API가 준비되지 않아 캡처 이미지를 불러올 수 없습니다."
            return
        }
        let rawToken = token.token
        guard !rawToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            recorderFrameImageLoadingID = nil
            recorderFrameImageLastError = "raw_frame 토큰 응답이 비어 있어 캡처 이미지를 불러올 수 없습니다."
            return
        }
        fetchRecorderFrameImage(frameId: requestedFrameID, rawApiURL: rawApiURL, token: rawToken)
    }

    private func handleRecorderSearchToken(
        _ token: RecorderRawApiToken,
        status: RecorderRawApiStatus?,
        query: String
    ) {
        pendingRecorderSearchQuery = nil
        guard let rawApiURL = status?.url.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawApiURL.isEmpty,
              status?.enabled == true else {
            recorderSearchRunning = false
            recorderSearchLastError = "Recorder raw API가 준비되지 않아 redacted search를 실행할 수 없습니다."
            return
        }
        let rawToken = token.token
        guard !rawToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            recorderSearchRunning = false
            recorderSearchLastError = "search 토큰 응답이 비어 있어 redacted search를 실행할 수 없습니다."
            return
        }
        fetchRecorderSearch(query: query, rawApiURL: rawApiURL, token: rawToken)
    }

    private func handleRecorderSqlQueryToken(
        _ token: RecorderRawApiToken,
        status: RecorderRawApiStatus?,
        query: String
    ) {
        pendingRecorderSqlQuery = nil
        guard let rawApiURL = status?.url.trimmingCharacters(in: .whitespacesAndNewlines),
              !rawApiURL.isEmpty,
              status?.enabled == true else {
            recorderSqlQueryRunning = false
            recorderSqlQueryLastError = "Recorder raw API가 준비되지 않아 SQL inspector를 실행할 수 없습니다."
            return
        }
        let rawToken = token.token
        guard !rawToken.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            recorderSqlQueryRunning = false
            recorderSqlQueryLastError = "raw_sql 토큰 응답이 비어 있어 SQL inspector를 실행할 수 없습니다."
            return
        }
        fetchRecorderSqlQuery(query: query, rawApiURL: rawApiURL, token: rawToken)
    }

    private func fetchRecorderFrameImage(frameId: String, rawApiURL: String, token: String) {
        Task { [weak self] in
            do {
                guard let baseURL = URL(string: rawApiURL) else {
                    throw RecorderFrameImageError.invalidRawApiURL
                }
                let url = baseURL
                    .appendingPathComponent("recorder")
                    .appendingPathComponent("frames")
                    .appendingPathComponent(frameId)
                    .appendingPathComponent("image")
                var request = URLRequest(url: url)
                request.httpMethod = "GET"
                request.setValue("agentic30://app", forHTTPHeaderField: "Origin")
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                request.setValue("frame-image-\(UUID().uuidString.lowercased())", forHTTPHeaderField: "x-agentic30-recorder-request-id")
                request.cachePolicy = .reloadIgnoringLocalCacheData

                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw RecorderFrameImageError.invalidResponse
                }
                guard (200..<300).contains(http.statusCode) else {
                    throw RecorderFrameImageError.httpStatus(http.statusCode)
                }
                let contentType = http.value(forHTTPHeaderField: "content-type") ?? ""
                guard contentType.lowercased().contains("image/jpeg") else {
                    throw RecorderFrameImageError.invalidContentType(contentType)
                }
                guard !data.isEmpty, NSImage(data: data) != nil else {
                    throw RecorderFrameImageError.invalidImageData
                }
                let preview = RecorderFrameImagePreview(
                    id: frameId,
                    frameId: frameId,
                    mediaAssetId: http.value(forHTTPHeaderField: "x-agentic30-recorder-media-asset-id") ?? "",
                    auditId: http.value(forHTTPHeaderField: "x-agentic30-recorder-audit-id") ?? "",
                    fetchedAt: Self.recorderIsoTimestamp(Date()),
                    data: data,
                    pathExposed: false,
                    proofAcceptedByRawApi: false
                )
                await MainActor.run {
                    guard self?.recorderFrameImageLoadingID == frameId else { return }
                    self?.recorderFrameImagePreview = preview
                    self?.recorderFrameImageLoadingID = nil
                    self?.recorderFrameImageLastError = nil
                }
            } catch {
                await MainActor.run {
                    guard self?.recorderFrameImageLoadingID == frameId else { return }
                    self?.recorderFrameImageLoadingID = nil
                    self?.recorderFrameImageLastError = error.localizedDescription
                    PostHogTelemetry.captureException(error, properties: [
                        "component": "agentic_view_model",
                        "operation": "recorder_frame_image_fetch",
                        "frame_id": frameId,
                    ], authSession: self?.macAuthSession)
                }
            }
        }
    }

    func runRecorderSearch(_ query: String) {
        let cleanQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanQuery.isEmpty else {
            recorderSearchLastError = "Recorder search query가 비어 있습니다."
            return
        }
        guard cleanQuery.utf8.count <= 400 else {
            recorderSearchLastError = "ERR_RECORDER_SEARCH_QUERY_TOO_LARGE: Recorder search query exceeds the 400 byte local search limit."
            return
        }
        guard isConnected else {
            recorderSearchLastError = "실행 보조 앱이 연결되지 않아 Recorder search 토큰을 요청할 수 없습니다."
            return
        }
        recorderSearchRunning = true
        recorderSearchLastError = nil
        pendingRecorderSearchQuery = cleanQuery
        guard sidecar.send(payload: [
            "type": "recorder_raw_api_token_issue",
            "scopes": ["search"],
            "ttlMs": 60_000,
            "clientId": Self.recorderSearchClientId,
            "clientName": "Agentic30 Recorder Redacted Search",
        ]) else {
            recorderSearchRunning = false
            pendingRecorderSearchQuery = nil
            recorderSearchLastError = "search 토큰 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_search_token_requested",
            authSession: macAuthSession
        )
    }

    private func fetchRecorderSearch(query: String, rawApiURL: String, token: String) {
        Task { [weak self] in
            do {
                guard let baseURL = URL(string: rawApiURL) else {
                    throw RecorderSearchError.invalidRawApiURL
                }
                let endpointURL = baseURL
                    .appendingPathComponent("recorder")
                    .appendingPathComponent("search")
                guard var components = URLComponents(url: endpointURL, resolvingAgainstBaseURL: false) else {
                    throw RecorderSearchError.invalidRawApiURL
                }
                components.queryItems = [
                    URLQueryItem(name: "q", value: query),
                    URLQueryItem(name: "sourceTypes", value: "frame,transcript,memory,product_event"),
                    URLQueryItem(name: "limit", value: "12"),
                ]
                guard let url = components.url else {
                    throw RecorderSearchError.invalidRawApiURL
                }
                var request = URLRequest(url: url)
                request.httpMethod = "GET"
                request.setValue("agentic30://app", forHTTPHeaderField: "Origin")
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                request.setValue("search-\(UUID().uuidString.lowercased())", forHTTPHeaderField: "x-agentic30-recorder-request-id")
                request.cachePolicy = .reloadIgnoringLocalCacheData

                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw RecorderSearchError.invalidResponse
                }
                guard (200..<300).contains(http.statusCode) else {
                    throw Self.recorderRawApiHTTPError(statusCode: http.statusCode, data: data)
                }
                let decoded = try JSONDecoder().decode(RecorderSearchResponse.self, from: data)
                guard let search = decoded.search else {
                    throw RecorderSearchError.invalidResponse
                }
                guard !search.schema.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
                    throw RecorderSearchError.invalidResponse
                }
                await MainActor.run {
                    self?.recorderSearchResult = search
                    self?.recorderSearchRunning = false
                    self?.recorderSearchLastError = nil
                    self?.refreshRecorderAuditEvents(limit: 10)
                }
            } catch {
                await MainActor.run {
                    self?.recorderSearchRunning = false
                    self?.recorderSearchLastError = error.localizedDescription
                    PostHogTelemetry.captureException(error, properties: [
                        "component": "agentic_view_model",
                        "operation": "recorder_search_fetch",
                    ], authSession: self?.macAuthSession)
                }
            }
        }
    }

    func runRecorderSqlQuery(_ query: String) {
        let cleanQuery = query.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanQuery.isEmpty else {
            recorderSqlQueryLastError = "SQL query가 비어 있습니다."
            return
        }
        guard cleanQuery.utf8.count <= 16_384 else {
            recorderSqlQueryLastError = "ERR_RECORDER_RAW_API_SQL_QUERY_TOO_LARGE: SQL query exceeds the 16 KB local inspector limit."
            return
        }
        guard isConnected else {
            recorderSqlQueryLastError = "실행 보조 앱이 연결되지 않아 SQL inspector 토큰을 요청할 수 없습니다."
            return
        }
        recorderSqlQueryRunning = true
        recorderSqlQueryLastError = nil
        pendingRecorderSqlQuery = cleanQuery
        guard sidecar.send(payload: [
            "type": "recorder_raw_api_token_issue",
            "scopes": ["raw_sql"],
            "ttlMs": 60_000,
            "clientId": Self.recorderSqlInspectorClientId,
            "clientName": "Agentic30 Recorder SQL Inspector",
        ]) else {
            recorderSqlQueryRunning = false
            pendingRecorderSqlQuery = nil
            recorderSqlQueryLastError = "raw_sql 토큰 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_sql_query_token_requested",
            authSession: macAuthSession
        )
    }

    private func fetchRecorderSqlQuery(query: String, rawApiURL: String, token: String) {
        Task { [weak self] in
            do {
                guard let baseURL = URL(string: rawApiURL) else {
                    throw RecorderSqlInspectorError.invalidRawApiURL
                }
                let url = baseURL
                    .appendingPathComponent("recorder")
                    .appendingPathComponent("sql")
                    .appendingPathComponent("query")
                var request = URLRequest(url: url)
                request.httpMethod = "POST"
                request.setValue("agentic30://app", forHTTPHeaderField: "Origin")
                request.setValue("Bearer \(token)", forHTTPHeaderField: "Authorization")
                request.setValue("application/json", forHTTPHeaderField: "content-type")
                request.setValue("sql-query-\(UUID().uuidString.lowercased())", forHTTPHeaderField: "x-agentic30-recorder-request-id")
                request.cachePolicy = .reloadIgnoringLocalCacheData
                request.httpBody = try JSONSerialization.data(withJSONObject: [
                    "query": query,
                    "timeoutMs": 2_000,
                    "includeRawColumns": false,
                ])

                let (data, response) = try await URLSession.shared.data(for: request)
                guard let http = response as? HTTPURLResponse else {
                    throw RecorderSqlInspectorError.invalidResponse
                }
                guard (200..<300).contains(http.statusCode) else {
                    throw Self.recorderRawApiHTTPError(statusCode: http.statusCode, data: data)
                }
                let decoded = try JSONDecoder().decode(RecorderSqlQueryResponse.self, from: data)
                await MainActor.run {
                    self?.recorderSqlQueryResult = decoded.sql
                    self?.recorderSqlQueryRunning = false
                    self?.recorderSqlQueryLastError = nil
                    self?.refreshRecorderAuditEvents(limit: 10)
                }
            } catch {
                await MainActor.run {
                    self?.recorderSqlQueryRunning = false
                    self?.recorderSqlQueryLastError = error.localizedDescription
                    PostHogTelemetry.captureException(error, properties: [
                        "component": "agentic_view_model",
                        "operation": "recorder_sql_query_fetch",
                    ], authSession: self?.macAuthSession)
                }
            }
        }
    }

    private static func recorderRawApiHTTPError(statusCode: Int, data: Data) -> Error {
        if let decoded = try? JSONDecoder().decode(RecorderRawApiErrorResponse.self, from: data),
           let code = decoded.error?.code?.trimmingCharacters(in: .whitespacesAndNewlines),
           !code.isEmpty {
            let message = decoded.error?.message?.trimmingCharacters(in: .whitespacesAndNewlines)
            return RecorderSqlInspectorError.rawApiRejected(code: code, message: message)
        }
        return RecorderSqlInspectorError.httpStatus(statusCode)
    }

    func prepareRecorderMcpGrantsForDisplay() {
        guard recorderMcpGrants.isEmpty else { return }
        refreshRecorderMcpGrants()
    }

    func refreshRecorderMcpGrants() {
        guard isConnected else {
            recorderMcpGrantLastError = "실행 보조 앱이 연결되지 않아 Recorder MCP grant 상태를 불러올 수 없습니다."
            return
        }
        recorderMcpGrantsRefreshing = true
        recorderMcpGrantLastError = nil
        guard sidecar.send(payload: [
            "type": "recorder_mcp_grants_list",
        ]) else {
            recorderMcpGrantsRefreshing = false
            recorderMcpGrantLastError = "Recorder MCP grant 목록 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_mcp_grants_refresh_requested",
            authSession: macAuthSession
        )
    }

    func grantRecorderRawSqlMcpAccess() {
        guard isConnected else {
            recorderMcpGrantLastError = "실행 보조 앱이 연결되지 않아 Recorder MCP raw_sql grant를 만들 수 없습니다."
            return
        }
        recorderMcpGrantActionInFlight = "grant_raw_sql"
        recorderMcpGrantLastError = nil
        guard sidecar.send(payload: [
            "type": "recorder_mcp_grant_create",
            "toolName": Self.recorderMcpRawSqlToolName,
            "accessLevels": ["raw_sql"],
            "ttlMs": 5 * 60 * 1000,
            "reason": "local Founder Replay SQL inspector MCP access",
        ]) else {
            recorderMcpGrantActionInFlight = nil
            recorderMcpGrantLastError = "Recorder MCP raw_sql grant 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_mcp_raw_sql_grant_requested",
            authSession: macAuthSession
        )
    }

    func revokeRecorderMcpGrant(id: String) {
        let cleanID = id.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanID.isEmpty else { return }
        guard isConnected else {
            recorderMcpGrantLastError = "실행 보조 앱이 연결되지 않아 Recorder MCP grant를 revoke할 수 없습니다."
            return
        }
        recorderMcpGrantActionInFlight = cleanID
        recorderMcpGrantLastError = nil
        guard sidecar.send(payload: [
            "type": "recorder_mcp_grant_revoke",
            "grantId": cleanID,
        ]) else {
            recorderMcpGrantActionInFlight = nil
            recorderMcpGrantLastError = "Recorder MCP grant revoke 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_mcp_grant_revoke_requested",
            properties: ["tool_name": Self.recorderMcpRawSqlToolName],
            authSession: macAuthSession
        )
    }

    private func replaceRecorderMcpGrants(_ grants: [RecorderMcpGrant]) {
        recorderMcpGrants = grants.sorted { lhs, rhs in
            if lhs.active != rhs.active { return lhs.active && !rhs.active }
            if lhs.expiresAt != rhs.expiresAt { return lhs.expiresAt > rhs.expiresAt }
            return lhs.id > rhs.id
        }
    }

    private func upsertRecorderMcpGrant(_ grant: RecorderMcpGrant) {
        var next = recorderMcpGrants.filter { $0.id != grant.id }
        next.append(grant)
        replaceRecorderMcpGrants(next)
    }

    private func replaceRecorderFrameCaptures(_ frames: [RecorderFrameCaptureReceipt]) {
        recorderFrameCaptures = Array(frames.sorted { lhs, rhs in
            if lhs.capturedAt != rhs.capturedAt { return lhs.capturedAt > rhs.capturedAt }
            return lhs.id > rhs.id
        }.prefix(48))
        if recorderFrameImagePreparedForDisplay {
            requestRecorderFrameImageIfNeeded(frameId: recorderFrameCaptures.first?.id)
        }
    }

    private func upsertRecorderFrameCapture(_ frame: RecorderFrameCaptureReceipt) {
        var frames = recorderFrameCaptures.filter { $0.id != frame.id }
        frames.append(frame)
        replaceRecorderFrameCaptures(frames)
    }

    private func removeRecorderFrameCapture(id: String) {
        recorderFrameCaptures.removeAll { $0.id == id }
        if recorderFrameImagePreview?.frameId == id {
            recorderFrameImagePreview = nil
        }
        if recorderFrameImageLoadingID == id {
            recorderFrameImageLoadingID = nil
            pendingRecorderFrameImageRequestID = nil
        }
        if recorderFrameImagePreparedForDisplay {
            requestRecorderFrameImageIfNeeded(frameId: recorderFrameCaptures.first?.id, force: true)
        }
    }

    private static func buildScreenCaptureKitFrameEnvelope(
        trigger: String,
        encryptedMedia: Bool = false,
        frameStreamSession: ScreenCaptureKitFrameCaptureSession? = nil
    ) async throws -> [String: Any] {
        #if canImport(ScreenCaptureKit)
        if #available(macOS 14.0, *) {
            return try await buildScreenCaptureKitFrameEnvelopeAvailable(
                trigger: trigger,
                encryptedMedia: encryptedMedia,
                frameStreamSession: frameStreamSession
            )
        }
        #endif
        throw RecorderFrameCaptureError.screenCaptureKitUnavailable
    }

    private static func startRecorderSystemAudioCaptureSession(outputURL: URL) async throws -> RecorderSystemAudioCaptureSession {
        #if canImport(ScreenCaptureKit)
        if #available(macOS 13.0, *) {
            return try await ScreenCaptureKitSystemAudioCaptureSession.start(outputURL: outputURL)
        }
        #endif
        throw RecorderSystemAudioCaptureError.unavailable
    }

    #if canImport(ScreenCaptureKit)
    @available(macOS 14.0, *)
    private static func startScreenCaptureKitFrameStreamSession() async throws -> ScreenCaptureKitFrameCaptureSession {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw RecorderFrameCaptureError.noDisplay
        }
        return try await ScreenCaptureKitFrameCaptureSession.start(display: display)
    }

    @available(macOS 14.0, *)
    private static func buildScreenCaptureKitFrameEnvelopeAvailable(
        trigger: String,
        encryptedMedia: Bool,
        frameStreamSession: ScreenCaptureKitFrameCaptureSession?
    ) async throws -> [String: Any] {
        let content = try await SCShareableContent.excludingDesktopWindows(false, onScreenWindowsOnly: true)
        guard let display = content.displays.first else {
            throw RecorderFrameCaptureError.noDisplay
        }
        let image: CGImage
        if let frameStreamSession {
            image = try await frameStreamSession.latestFrame(timeout: 5)
        } else {
            image = try await ScreenCaptureKitFrameCaptureSession.capture(display: display)
        }
        let bitmap = NSBitmapImageRep(cgImage: image)
        guard let data = bitmap.representation(using: .jpeg, properties: [.compressionFactor: 0.78]) else {
            throw RecorderFrameCaptureError.jpegEncodingFailed
        }

        let now = Date()
        let timestamp = recorderIsoTimestamp(now)
        let day = String(timestamp.prefix(10))
        let frameId = "frame-\(UUID().uuidString.lowercased())"
        let assetId = "asset-\(UUID().uuidString.lowercased())"
        let encryptedFrameMedia = encryptedMedia ? try encryptRecorderMedia(data) : nil
        let mediaData = encryptedFrameMedia?.ciphertext ?? data
        let digest = encryptedFrameMedia?.ciphertextSha256 ?? sha256Hex(mediaData)
        let relativePath = "media/frames/\(day)/\(assetId).jpg\(encryptedMedia ? ".enc" : "")"
        let recorderRoot = FoundationProgressStore.defaultAppSupportURL()
            .appendingPathComponent("recorder", isDirectory: true)
        let fileURL = recorderRoot.appendingPathComponent(relativePath, isDirectory: false)
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try mediaData.write(to: fileURL, options: [.atomic])

        let appName = NSWorkspace.shared.frontmostApplication?.localizedName?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        let windowTitle = NSApp.keyWindow?.title.trimmingCharacters(in: .whitespacesAndNewlines)
        let runtimeMetadata = currentRecorderRuntimeMetadata()
        let textExtraction = currentRecorderFrameTextExtraction(from: image)
        let hasSearchableFrameText = [textExtraction.accessibilityText, textExtraction.ocrText].contains { candidate in
            candidate?.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty == false
        }
        var snapshot: [String: Any] = [
            "id": assetId,
            "relativePath": relativePath,
            "sha256": digest,
            "byteSize": mediaData.count,
            "encrypted": encryptedMedia,
            "createdAt": timestamp,
        ]
        if let encryptedFrameMedia {
            snapshot["encryption"] = encryptedFrameMedia.envelope
        }

        var envelope: [String: Any] = [
            "id": frameId,
            "capturedAt": timestamp,
            "monitorId": "display-\(display.displayID)",
            "captureTrigger": trigger,
            "appName": appName?.isEmpty == false ? appName! : NSNull(),
            "windowTitle": windowTitle?.isEmpty == false ? windowTitle! : NSNull(),
            "browserUrl": runtimeMetadata.browserURL ?? NSNull(),
            "documentPath": runtimeMetadata.documentPath ?? NSNull(),
            "contentHash": digest,
            "textSource": textExtraction.textSource,
            "redactionStatus": hasSearchableFrameText ? "redacted" : "not_redacted",
            "safeForSearch": hasSearchableFrameText,
            "safeForMemory": false,
            "safeForExport": false,
            "privacyState": "raw_local",
            "dataClass": "screen",
            "snapshot": snapshot,
        ]
        if let textProvenanceRootCause = textExtraction.textProvenanceRootCause {
            envelope["textProvenanceRootCause"] = textProvenanceRootCause
        }
        if let accessibilityText = textExtraction.accessibilityText {
            envelope["accessibilityText"] = accessibilityText
        }
        if let ocrText = textExtraction.ocrText {
            envelope["ocrText"] = ocrText
        }
        return envelope
    }
    #endif

    private struct RecorderFrameTextExtraction {
        let textSource: String
        let textProvenanceRootCause: String?
        let accessibilityText: String?
        let ocrText: String?
    }

    private struct RecorderEncryptedMedia {
        let ciphertext: Data
        let ciphertextSha256: String
        let envelope: [String: Any]
    }

    private struct RecorderLocalAudioTranscriptSegment {
        let idSuffix: String
        let startedAt: Date
        let endedAt: Date
        let text: String

        nonisolated func payload(audioId: String) -> [String: Any] {
            [
                "id": "\(audioId)-segment-\(idSuffix)",
                "startedAt": AgenticViewModel.recorderIsoTimestamp(startedAt),
                "endedAt": AgenticViewModel.recorderIsoTimestamp(endedAt),
                "speakerLabel": NSNull(),
                "text": text,
                "redactedText": NSNull(),
                "redactionStatus": "not_redacted",
                "privacyState": "raw_local",
                "safeForSearch": false,
                "safeForMemory": false,
            ]
        }
    }

    private struct RecorderLocalAudioTranscript {
        let status: String
        let localTranscriberName: String?
        let localTranscriberVersion: String?
        let transcriptionTerminalState: String?
        let segments: [RecorderLocalAudioTranscriptSegment]

        nonisolated static func unavailable(
            terminalState: String = "local_unavailable_no_cloud_fallback"
        ) -> RecorderLocalAudioTranscript {
            RecorderLocalAudioTranscript(
                status: "local_transcription_unavailable",
                localTranscriberName: nil,
                localTranscriberVersion: nil,
                transcriptionTerminalState: terminalState,
                segments: []
            )
        }

        nonisolated static func localComplete(
            text: String,
            startedAt: Date,
            endedAt: Date,
            transcriberName: String = "apple-speech-on-device",
            transcriberVersion: String = ProcessInfo.processInfo.operatingSystemVersionString
        ) -> RecorderLocalAudioTranscript {
            let cleanText = text.trimmingCharacters(in: .whitespacesAndNewlines)
            guard !cleanText.isEmpty else { return unavailable() }
            return RecorderLocalAudioTranscript(
                status: "local_complete",
                localTranscriberName: transcriberName,
                localTranscriberVersion: transcriberVersion,
                transcriptionTerminalState: nil,
                segments: [
                    RecorderLocalAudioTranscriptSegment(
                        idSuffix: "1",
                        startedAt: startedAt,
                        endedAt: endedAt,
                        text: cleanText
                    ),
                ]
            )
        }
    }

    #if canImport(Speech)
    @available(macOS 10.15, *)
    private final class RecorderSpeechRecognitionCompletion: @unchecked Sendable {
        private let lock = NSLock()
        private var didFinish = false
        private var task: SFSpeechRecognitionTask?
        private let continuation: CheckedContinuation<RecorderLocalAudioTranscript, Never>

        init(_ continuation: CheckedContinuation<RecorderLocalAudioTranscript, Never>) {
            self.continuation = continuation
        }

        func setTask(_ task: SFSpeechRecognitionTask) {
            lock.lock()
            if didFinish {
                lock.unlock()
                task.cancel()
                return
            }
            self.task = task
            lock.unlock()
        }

        func scheduleTimeout(seconds: TimeInterval, transcript: RecorderLocalAudioTranscript = .unavailable()) {
            DispatchQueue.global(qos: .utility).asyncAfter(deadline: .now() + seconds) { [weak self] in
                self?.finish(transcript)
            }
        }

        func finish(_ transcript: RecorderLocalAudioTranscript) {
            lock.lock()
            guard !didFinish else {
                lock.unlock()
                return
            }
            didFinish = true
            let taskToCancel = task
            lock.unlock()
            taskToCancel?.cancel()
            continuation.resume(returning: transcript)
        }
    }
    #endif

    private static func encryptRecorderMedia(_ plaintext: Data) throws -> RecorderEncryptedMedia {
        let keyData: Data
        do {
            keyData = try KeychainHelper.loadOrCreateRecorderMediaKey()
        } catch {
            throw RecorderRawMediaEncryptionError.mediaEncryptionKeyUnavailable(error.localizedDescription)
        }
        do {
            let sealedBox = try AES.GCM.seal(plaintext, using: SymmetricKey(data: keyData))
            let nonce = sealedBox.nonce.withUnsafeBytes { Data($0) }
            let ciphertext = sealedBox.ciphertext
            let ciphertextSha256 = sha256Hex(ciphertext)
            let envelope: [String: Any] = [
                "algorithm": "aes-256-gcm",
                "keyId": recorderMediaEncryptionKeyId,
                "nonce": nonce.base64EncodedString(),
                "tag": sealedBox.tag.base64EncodedString(),
                "ciphertextSha256": "sha256:\(ciphertextSha256)",
            ]
            return RecorderEncryptedMedia(
                ciphertext: ciphertext,
                ciphertextSha256: ciphertextSha256,
                envelope: envelope
            )
        } catch {
            throw RecorderRawMediaEncryptionError.mediaEncryptionFailed(error.localizedDescription)
        }
    }

    private static func transcribeRecorderAudioLocallyIfAvailable(
        fileURL: URL,
        startedAt: Date,
        endedAt: Date
    ) async -> RecorderLocalAudioTranscript {
        #if canImport(Speech)
        guard #available(macOS 10.15, *) else {
            return .unavailable(terminalState: "local_unavailable_speech_framework_missing_no_cloud_fallback")
        }
        guard SFSpeechRecognizer.authorizationStatus() == .authorized else {
            return .unavailable(terminalState: "local_unavailable_speech_permission_missing_no_cloud_fallback")
        }
        guard let recognizer = SFSpeechRecognizer(locale: Locale.current),
              recognizer.isAvailable else {
            return .unavailable(terminalState: "local_unavailable_speech_recognizer_unavailable_no_cloud_fallback")
        }
        let request = SFSpeechURLRecognitionRequest(url: fileURL)
        request.shouldReportPartialResults = false
        request.requiresOnDeviceRecognition = true

        return await withCheckedContinuation { continuation in
            let completion = RecorderSpeechRecognitionCompletion(continuation)
            completion.scheduleTimeout(seconds: 20, transcript: .unavailable(
                terminalState: "local_unavailable_speech_timeout_no_cloud_fallback"
            ))
            let task = recognizer.recognitionTask(with: request) { result, error in
                if let result, result.isFinal {
                    completion.finish(
                        recorderLocalAudioTranscript(
                            from: result,
                            startedAt: startedAt,
                            endedAt: endedAt
                        )
                    )
                    return
                }
                if error != nil {
                    completion.finish(.unavailable(
                        terminalState: "local_unavailable_speech_recognition_error_no_cloud_fallback"
                    ))
                }
            }
            completion.setTask(task)
        }
        #else
        return .unavailable(terminalState: "local_unavailable_speech_framework_missing_no_cloud_fallback")
        #endif
    }

    #if canImport(Speech)
    @available(macOS 10.15, *)
    private static func recorderLocalAudioTranscript(
        from result: SFSpeechRecognitionResult,
        startedAt: Date,
        endedAt: Date
    ) -> RecorderLocalAudioTranscript {
        let formatted = result.bestTranscription.formattedString
            .trimmingCharacters(in: .whitespacesAndNewlines)
        guard !formatted.isEmpty else { return .unavailable() }
        let chunkDuration = max(endedAt.timeIntervalSince(startedAt), 0.001)
        let speechSegments = result.bestTranscription.segments
            .enumerated()
            .compactMap { index, segment -> RecorderLocalAudioTranscriptSegment? in
                let text = segment.substring.trimmingCharacters(in: .whitespacesAndNewlines)
                guard !text.isEmpty else { return nil }
                let offsetStart = min(max(segment.timestamp, 0), chunkDuration)
                let offsetEnd = min(max(segment.timestamp + max(segment.duration, 0.001), offsetStart + 0.001), chunkDuration)
                return RecorderLocalAudioTranscriptSegment(
                    idSuffix: "\(index + 1)",
                    startedAt: startedAt.addingTimeInterval(offsetStart),
                    endedAt: startedAt.addingTimeInterval(offsetEnd),
                    text: text
                )
            }
        return RecorderLocalAudioTranscript(
            status: "local_complete",
            localTranscriberName: "apple-speech-on-device",
            localTranscriberVersion: ProcessInfo.processInfo.operatingSystemVersionString,
            transcriptionTerminalState: nil,
            segments: speechSegments.isEmpty
                ? RecorderLocalAudioTranscript.localComplete(
                    text: formatted,
                    startedAt: startedAt,
                    endedAt: endedAt
                ).segments
                : speechSegments
        )
    }
    #endif

    private static func buildEncryptedRecorderAudioChunkEnvelope(
        source: String,
        startedAt: Date,
        endedAt: Date,
        temporaryFileURL: URL,
        consentGrantId: String,
        transcript: RecorderLocalAudioTranscript = .unavailable(),
        recorderRoot: URL = FoundationProgressStore.defaultAppSupportURL()
            .appendingPathComponent("recorder", isDirectory: true)
    ) throws -> [String: Any] {
        let plaintext = try Data(contentsOf: temporaryFileURL)
        try? FileManager.default.removeItem(at: temporaryFileURL)
        guard !plaintext.isEmpty else {
            throw RecorderAudioCaptureError.emptyAudioFile
        }
        let encryptedAudio = try encryptRecorderMedia(plaintext)
        let endedTimestamp = recorderIsoTimestamp(endedAt)
        let startedTimestamp = recorderIsoTimestamp(startedAt)
        let day = String(startedTimestamp.prefix(10))
        let audioId = "audio-\(UUID().uuidString.lowercased())"
        let assetId = "asset-\(UUID().uuidString.lowercased())"
        let transcriptSegments = transcript.segments.map { $0.payload(audioId: audioId) }
        let relativePath = "media/audio/\(day)/\(assetId).m4a.enc"
        let fileURL = recorderRoot.appendingPathComponent(relativePath, isDirectory: false)
        try FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try encryptedAudio.ciphertext.write(to: fileURL, options: [.atomic])
        return [
            "id": audioId,
            "startedAt": startedTimestamp,
            "endedAt": endedTimestamp,
            "source": source,
            "transcriptStatus": transcript.status,
            "consentGrantId": consentGrantId,
            "visibleNoticeId": NSNull(),
            "rawAudioIndicatorState": "visible_indicator_active",
            "localTranscriberName": recorderJsonString(transcript.localTranscriberName),
            "localTranscriberVersion": recorderJsonString(transcript.localTranscriberVersion),
            "transcriptionTerminalState": recorderJsonString(transcript.transcriptionTerminalState),
            "redactionStatus": "not_redacted",
            "privacyState": "raw_local",
            "audioAsset": [
                "id": assetId,
                "relativePath": relativePath,
                "sha256": encryptedAudio.ciphertextSha256,
                "byteSize": encryptedAudio.ciphertext.count,
                "encrypted": true,
                "encryption": encryptedAudio.envelope,
                "createdAt": endedTimestamp,
            ],
            "transcriptSegments": transcriptSegments,
        ]
    }

    nonisolated private static func recorderIsoTimestamp(_ date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    private static func recorderDate(fromIsoTimestamp value: String) -> Date? {
        let trimmed = value.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !trimmed.isEmpty else { return nil }
        let fractional = ISO8601DateFormatter()
        fractional.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        if let date = fractional.date(from: trimmed) {
            return date
        }
        let plain = ISO8601DateFormatter()
        plain.formatOptions = [.withInternetDateTime]
        return plain.date(from: trimmed)
    }

    private static func sha256Hex(_ data: Data) -> String {
        SHA256.hash(data: data)
            .map { String(format: "%02x", $0) }
            .joined()
    }

    private static func recorderJsonString(_ value: String?) -> Any {
        value ?? NSNull()
    }

    private static func currentRecorderPermissionActorDiagnostic() -> RecorderPermissionActorDiagnostic {
        #if DEBUG
        if let override = recorderPermissionActorOverrideForTesting {
            return override
        }
        #endif
        let bundle = Bundle.main
        let bundleURL = bundle.bundleURL
        let executableURL = bundle.executableURL
        let displayName = bundle.object(forInfoDictionaryKey: "CFBundleDisplayName") as? String
            ?? bundle.object(forInfoDictionaryKey: "CFBundleName") as? String
            ?? bundleURL.deletingPathExtension().lastPathComponent
        let signing = recorderPermissionActorSigningSummary(bundleURL: bundleURL)
        #if DEBUG
        let buildChannel = "debug"
        #else
        let buildChannel = "release"
        #endif
        return RecorderPermissionActorDiagnostic(
            source: "mainApp",
            displayName: displayName,
            bundleIdentifier: bundle.bundleIdentifier ?? "unknown",
            bundlePath: bundleURL.standardizedFileURL.path,
            executablePath: executableURL?.standardizedFileURL.path ?? "unknown",
            buildChannel: buildChannel,
            teamIdentifier: signing.teamIdentifier,
            signingRequirementSummary: signing.summary,
            codeDirectoryHashSummary: "unavailable",
            translocationState: recorderPermissionActorTranslocationState(bundlePath: bundleURL.standardizedFileURL.path)
        )
    }

    private static func recorderPermissionActorTranslocationState(bundlePath: String) -> String {
        bundlePath.contains("/AppTranslocation/") ? "translocated" : "not_translocated"
    }

    private static func recorderPermissionActorSigningSummary(bundleURL: URL) -> (teamIdentifier: String, summary: String) {
        var staticCode: SecStaticCode?
        let status = SecStaticCodeCreateWithPath(bundleURL as CFURL, SecCSFlags(), &staticCode)
        guard status == errSecSuccess, let staticCode else {
            return ("unknown", "unavailable_status_\(status)")
        }

        var info: CFDictionary?
        let infoStatus = SecCodeCopySigningInformation(
            staticCode,
            SecCSFlags(rawValue: kSecCSSigningInformation),
            &info
        )
        guard infoStatus == errSecSuccess, let dict = info as? [String: Any] else {
            return ("unknown", "unavailable_status_\(infoStatus)")
        }

        let teamKey = kSecCodeInfoTeamIdentifier as NSString as String
        let identifierKey = kSecCodeInfoIdentifier as NSString as String
        let teamIdentifier = dict[teamKey] as? String ?? "unknown"
        let signingIdentifier = dict[identifierKey] as? String ?? "unknown"
        if teamIdentifier == "unknown" {
            return (teamIdentifier, "signed_identifier_\(signingIdentifier)_team_unknown")
        }
        return (teamIdentifier, "signed_identifier_\(signingIdentifier)_team_\(teamIdentifier)")
    }

    private static func currentRecorderPermissionReleaseIdentityDiagnostic(
        actor: RecorderPermissionActorDiagnostic
    ) -> RecorderPermissionReleaseIdentityDiagnostic {
        recorderPermissionReleaseIdentityDiagnostic(
            actor: actor,
            sparklePublicKey: Bundle.main.object(forInfoDictionaryKey: "SUPublicEDKey") as? String,
            sparkleFeedURL: Bundle.main.object(forInfoDictionaryKey: "SUFeedURL") as? String,
            releasePolicyVerified: recorderPermissionReleasePolicyVerifiedForCurrentBundle(),
            expectedBundleIdentifier: currentRecorderPermissionExpectedBundleIdentifier()
        )
    }

    private static func recorderPermissionReleaseIdentityDiagnostic(
        actor: RecorderPermissionActorDiagnostic,
        sparklePublicKey: String?,
        sparkleFeedURL: String?,
        releasePolicyVerified: Bool = false,
        expectedBundleIdentifier: String
    ) -> RecorderPermissionReleaseIdentityDiagnostic {
        let bundleIdentifier = actor.bundleIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
        let buildChannel = actor.buildChannel.trimmingCharacters(in: .whitespacesAndNewlines)
        let teamIdentifier = actor.teamIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
        let signingRequirementSummary = actor.signingRequirementSummary.trimmingCharacters(in: .whitespacesAndNewlines)
        let normalizedSparkleKey = sparklePublicKey?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let normalizedFeedURL = sparkleFeedURL?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        var blockers: [String] = []

        if bundleIdentifier != expectedBundleIdentifier {
            blockers.append("bundle_identifier_mismatch")
        }
        if buildChannel != "release" {
            blockers.append("non_release_build_channel")
        }
        if teamIdentifier.isEmpty || teamIdentifier == "unknown" {
            blockers.append("team_identifier_unavailable")
        }
        if signingRequirementSummary.isEmpty
            || signingRequirementSummary == "unknown"
            || signingRequirementSummary.hasPrefix("unavailable_status_")
            || signingRequirementSummary.contains("_team_unknown") {
            blockers.append("designated_requirement_unavailable")
        }
        if normalizedSparkleKey.isEmpty || normalizedSparkleKey.contains("$(") {
            blockers.append("sparkle_public_key_missing")
        }
        if normalizedFeedURL.isEmpty || normalizedFeedURL.contains("$(") {
            blockers.append("sparkle_feed_url_missing")
        }
        if !releasePolicyVerified {
            blockers.append("release_distribution_policy_unverified")
        }

        return RecorderPermissionReleaseIdentityDiagnostic(
            expectedBundleIdentifier: expectedBundleIdentifier,
            bundleIdentifier: bundleIdentifier.isEmpty ? "unknown" : bundleIdentifier,
            buildChannel: buildChannel.isEmpty ? "unknown" : buildChannel,
            teamIdentifier: teamIdentifier.isEmpty ? "unknown" : teamIdentifier,
            signingRequirementSummary: signingRequirementSummary.isEmpty ? "unknown" : signingRequirementSummary,
            sparklePublicKeyPresent: !normalizedSparkleKey.isEmpty && !normalizedSparkleKey.contains("$("),
            sparkleFeedURL: normalizedFeedURL.isEmpty ? "unknown" : normalizedFeedURL,
            releasePolicyVerified: releasePolicyVerified,
            externalPermissionOnboardingAllowed: blockers.isEmpty,
            blockers: blockers
        )
    }

    private static func currentRecorderPermissionExpectedBundleIdentifier() -> String {
        let configured = Bundle.main.object(forInfoDictionaryKey: "Agentic30ExpectedPermissionActorBundleIdentifier")
            as? String
        let bundleIdentifier = Bundle.main.bundleIdentifier
        let candidate = configured?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines)
            ?? ""
        if candidate.isEmpty || candidate.contains("$(") {
            return "unknown"
        }
        return candidate
    }

    private static func recorderPermissionReleasePolicyVerifiedForCurrentBundle() -> Bool {
        let rawValue = Bundle.main.object(forInfoDictionaryKey: "Agentic30ExternalPermissionOnboardingAllowed")
        if let boolValue = rawValue as? Bool {
            return boolValue
        }
        guard let stringValue = rawValue as? String else {
            return false
        }
        switch stringValue.trimmingCharacters(in: .whitespacesAndNewlines).lowercased() {
        case "1", "true", "yes":
            return true
        default:
            return false
        }
    }

    private static func currentRecorderPermissionProbe() -> [(id: String, state: String)] {
        [
            ("screenRecording", CGPreflightScreenCaptureAccess() ? "granted" : "denied"),
            ("accessibility", AXIsProcessTrusted() ? "granted" : "denied"),
            ("inputMonitoring", currentRecorderInputMonitoringPermissionState()),
            ("visionOcr", currentRecorderVisionOcrPermissionState()),
            ("clipboard", "granted"),
            ("microphone", currentRecorderMicrophonePermissionState()),
            ("systemAudio", currentRecorderSystemAudioPermissionState()),
        ]
    }

    private static func currentRecorderInputMonitoringPermissionState() -> String {
        if #available(macOS 10.15, *) {
            guard CGPreflightListenEventAccess() else {
                return "denied"
            }
            return recorderEventTapRuntimeProbeCanCreate() ? "granted" : "denied"
        }
        return "unavailable"
    }

    private static func recorderEventTapTriggerReady(for readiness: RecorderCaptureReadiness?) -> Bool {
        readiness?.modeReadiness?.eventDrivenCapture?.ready == true
    }

    #if DEBUG
    static func recorderEventTapTriggerReadyForTesting(_ readiness: RecorderCaptureReadiness?) -> Bool {
        recorderEventTapTriggerReady(for: readiness)
    }
    #endif

    private static func recorderEventTapRuntimeProbeCanCreate() -> Bool {
        let keyDownMask = CGEventMask(1) << CGEventType.keyDown.rawValue
        guard let eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: keyDownMask,
            callback: { _, _, event, _ in
                Unmanaged.passUnretained(event)
            },
            userInfo: nil
        ) else {
            return false
        }
        CFMachPortInvalidate(eventTap)
        return true
    }

    private static func makeRecorderEventTap(
        onEvent: @escaping @Sendable (String) -> Void
    ) -> (eventTap: CFMachPort, callbackBox: RecorderEventTapCallbackBox)? {
        let eventMask =
            (CGEventMask(1) << CGEventType.keyDown.rawValue)
            | (CGEventMask(1) << CGEventType.leftMouseDown.rawValue)
            | (CGEventMask(1) << CGEventType.rightMouseDown.rawValue)
            | (CGEventMask(1) << CGEventType.otherMouseDown.rawValue)
            | (CGEventMask(1) << CGEventType.scrollWheel.rawValue)
        let box = RecorderEventTapCallbackBox(onEvent: onEvent)
        let userInfo = Unmanaged.passUnretained(box).toOpaque()
        guard let eventTap = CGEvent.tapCreate(
            tap: .cgSessionEventTap,
            place: .headInsertEventTap,
            options: .listenOnly,
            eventsOfInterest: eventMask,
            callback: { _, type, event, userInfo in
                if let userInfo {
                    let box = Unmanaged<RecorderEventTapCallbackBox>
                        .fromOpaque(userInfo)
                        .takeUnretainedValue()
                    box.onEvent(recorderEventTapKindForCaptureTrigger(type))
                }
                return Unmanaged.passUnretained(event)
            },
            userInfo: userInfo
        ) else {
            return nil
        }
        return (eventTap, box)
    }

    private static func currentRecorderVisionOcrPermissionState() -> String {
        #if canImport(Vision)
        if #available(macOS 12.0, *) {
            do {
                let languages = try VNRecognizeTextRequest().supportedRecognitionLanguages()
                return languages.isEmpty ? "unavailable" : "granted"
            } catch {
                return "unavailable"
            }
        }
        #endif
        return "unavailable"
    }

    private static func currentRecorderMicrophonePermissionState() -> String {
        switch AVCaptureDevice.authorizationStatus(for: .audio) {
        case .authorized:
            return "granted"
        case .denied:
            return "denied"
        case .restricted:
            return "restricted"
        case .notDetermined:
            return "not_determined"
        @unknown default:
            return "unknown"
        }
    }

    private static func currentRecorderSystemAudioPermissionState() -> String {
        #if canImport(ScreenCaptureKit)
        if #available(macOS 13.0, *) {
            return CGPreflightScreenCaptureAccess() ? "granted" : "denied"
        }
        #endif
        return "unavailable"
    }

    private static func currentRecorderFrameTextExtraction(from image: CGImage) -> RecorderFrameTextExtraction {
        let accessibilitySnapshot = currentRecorderAccessibilityTextSnapshot()
        let ocrSnapshot = currentRecorderVisionOcrTextSnapshot(from: image)
        return recorderFrameTextExtraction(
            accessibilityText: accessibilitySnapshot.text,
            accessibilityRootCause: accessibilitySnapshot.rootCause,
            ocrText: ocrSnapshot.text,
            ocrRootCause: ocrSnapshot.rootCause
        )
    }

    private static func recorderFrameTextExtraction(
        accessibilityText: String?,
        accessibilityRootCause: String,
        ocrText: String?,
        ocrRootCause: String
    ) -> RecorderFrameTextExtraction {
        if let accessibilityText,
           let ocrText {
            return RecorderFrameTextExtraction(
                textSource: "ax_plus_ocr",
                textProvenanceRootCause: nil,
                accessibilityText: accessibilityText,
                ocrText: ocrText
            )
        }
        if let accessibilityText {
            return RecorderFrameTextExtraction(
                textSource: "accessibility_only",
                textProvenanceRootCause: nil,
                accessibilityText: accessibilityText,
                ocrText: nil
            )
        }
        if let ocrText {
            return RecorderFrameTextExtraction(
                textSource: "ocr_only",
                textProvenanceRootCause: nil,
                accessibilityText: nil,
                ocrText: ocrText
            )
        }
        return RecorderFrameTextExtraction(
            textSource: "ocr_unavailable_named_root_cause",
            textProvenanceRootCause: recorderFrameTextRootCause(
                accessibilityRootCause: accessibilityRootCause,
                ocrRootCause: ocrRootCause
            ),
            accessibilityText: nil,
            ocrText: nil
        )
    }

    private static func currentRecorderAccessibilityTextSnapshot() -> (text: String?, rootCause: String) {
        guard AXIsProcessTrusted() else {
            return (nil, "accessibility_permission_missing")
        }
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return (nil, "frontmost_application_unavailable")
        }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let focusedElement = axElementAttribute("AXFocusedUIElement", from: appElement)
        let focusedWindow = axElementAttribute("AXFocusedWindow", from: appElement)
        let snippets = [focusedElement, focusedWindow, appElement].flatMap(axTextCandidates(from:))
        guard let text = recorderJoinedTextSnippets(snippets) else {
            return (nil, "accessibility_text_unavailable")
        }
        return (text, "")
    }

    private static func currentRecorderVisionOcrTextSnapshot(from image: CGImage) -> (text: String?, rootCause: String) {
        #if canImport(Vision)
        if #available(macOS 12.0, *) {
            let request = VNRecognizeTextRequest()
            request.recognitionLevel = .accurate
            request.usesLanguageCorrection = false
            let handler = VNImageRequestHandler(cgImage: image, options: [:])
            do {
                try handler.perform([request])
            } catch {
                return (nil, "vision_ocr_request_failed")
            }
            let snippets = (request.results ?? []).compactMap { observation in
                observation.topCandidates(1).first?.string
            }
            guard let text = recorderJoinedTextSnippets(snippets) else {
                return (nil, "vision_ocr_no_text_detected")
            }
            return (text, "")
        }
        #endif
        return (nil, "vision_ocr_unavailable_on_macos_runtime")
    }

    private static func recorderFrameTextRootCause(
        accessibilityRootCause: String,
        ocrRootCause: String
    ) -> String {
        let accessibility = accessibilityRootCause.nonEmpty ?? "accessibility_text_unavailable"
        let ocr = ocrRootCause.nonEmpty ?? "vision_ocr_unavailable"
        return "\(accessibility)_and_\(ocr)"
    }

    private static func axTextCandidates(from element: AXUIElement?) -> [String] {
        guard let element else { return [] }
        return [
            "AXSelectedText",
            "AXValue",
            "AXTitle",
            "AXDescription",
            "AXHelp",
        ].compactMap { axStringAttribute($0, from: element) }
    }

    private static func recorderJoinedTextSnippets(_ snippets: [String]) -> String? {
        var seen = Set<String>()
        var normalizedSnippets: [String] = []
        for snippet in snippets {
            let normalized = snippet
                .replacingOccurrences(of: #"\s+"#, with: " ", options: .regularExpression)
                .trimmingCharacters(in: .whitespacesAndNewlines)
            guard !normalized.isEmpty, !seen.contains(normalized) else { continue }
            seen.insert(normalized)
            normalizedSnippets.append(normalized)
        }
        let joined = normalizedSnippets.joined(separator: "\n").trimmingCharacters(in: .whitespacesAndNewlines)
        guard !joined.isEmpty else { return nil }
        return String(joined.prefix(20_000))
    }

    private static func recorderTemporaryAudioFileURL() throws -> URL {
        let directory = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-recorder-audio", isDirectory: true)
        try FileManager.default.createDirectory(
            at: directory,
            withIntermediateDirectories: true
        )
        return directory.appendingPathComponent("\(UUID().uuidString.lowercased()).m4a", isDirectory: false)
    }

    private static func recorderClipboardContentType(from pasteboardTypes: [String]) -> String {
        let typeSet = Set(pasteboardTypes)
        if typeSet.contains("public.file-url") || typeSet.contains("NSFilenamesPboardType") {
            return "file"
        }
        if typeSet.contains("public.url") {
            return "url"
        }
        if typeSet.contains(NSPasteboard.PasteboardType.string.rawValue) {
            return "text"
        }
        if typeSet.contains("public.png") || typeSet.contains("public.tiff") {
            return "image"
        }
        return "unknown"
    }

    #if DEBUG
    static func recorderPermissionActorDiagnosticForTesting() -> RecorderPermissionActorDiagnostic {
        currentRecorderPermissionActorDiagnostic()
    }

    static func recorderPermissionReleaseIdentityDiagnosticForTesting(
        actor: RecorderPermissionActorDiagnostic,
        sparklePublicKey: String?,
        sparkleFeedURL: String?,
        releasePolicyVerified: Bool = false,
        expectedBundleIdentifier: String = "october-academy.agentic30"
    ) -> RecorderPermissionReleaseIdentityDiagnostic {
        recorderPermissionReleaseIdentityDiagnostic(
            actor: actor,
            sparklePublicKey: sparklePublicKey,
            sparkleFeedURL: sparkleFeedURL,
            releasePolicyVerified: releasePolicyVerified,
            expectedBundleIdentifier: expectedBundleIdentifier
        )
    }

    static func recorderBrowserURLAppleScriptSourceForTesting(bundleIdentifier: String) -> String? {
        recorderBrowserURLAppleScriptSource(bundleIdentifier: bundleIdentifier)
    }

    static func recorderBrowserURLAppleScriptRootCauseForTesting(errorNumber: Int?) -> String {
        let info: NSDictionary? = errorNumber.map { [NSAppleScript.errorNumber: $0] as NSDictionary }
        return recorderBrowserURLAppleScriptRootCause(errorInfo: info)
    }

    static func recorderFrameTextExtractionForTesting(
        accessibilityText: String?,
        accessibilityRootCause: String = "accessibility_text_unavailable",
        ocrText: String?,
        ocrRootCause: String = "vision_ocr_unavailable"
    ) -> (
        textSource: String,
        textProvenanceRootCause: String?,
        accessibilityText: String?,
        ocrText: String?
    ) {
        let extraction = recorderFrameTextExtraction(
            accessibilityText: accessibilityText,
            accessibilityRootCause: accessibilityRootCause,
            ocrText: ocrText,
            ocrRootCause: ocrRootCause
        )
        return (
            textSource: extraction.textSource,
            textProvenanceRootCause: extraction.textProvenanceRootCause,
            accessibilityText: extraction.accessibilityText,
            ocrText: extraction.ocrText
        )
    }

    func buildEncryptedRecorderMicrophoneAudioChunkForTesting(
        plaintext: Data,
        startedAt: Date = Date(timeIntervalSince1970: 1_782_680_400),
        endedAt: Date = Date(timeIntervalSince1970: 1_782_680_430),
        recorderRoot: URL
    ) throws -> [String: Any] {
        let tempURL = try Self.recorderTemporaryAudioFileURL()
        try plaintext.write(to: tempURL, options: [.atomic])
        return try Self.buildEncryptedRecorderAudioChunkEnvelope(
            source: "microphone",
            startedAt: startedAt,
            endedAt: endedAt,
            temporaryFileURL: tempURL,
            consentGrantId: "recorder-consent-test-grant",
            recorderRoot: recorderRoot
        )
    }

    func buildEncryptedRecorderSystemAudioChunkForTesting(
        plaintext: Data,
        startedAt: Date = Date(timeIntervalSince1970: 1_782_680_400),
        endedAt: Date = Date(timeIntervalSince1970: 1_782_680_430),
        recorderRoot: URL
    ) throws -> [String: Any] {
        let tempURL = try Self.recorderTemporaryAudioFileURL()
        try plaintext.write(to: tempURL, options: [.atomic])
        return try Self.buildEncryptedRecorderAudioChunkEnvelope(
            source: "system_audio",
            startedAt: startedAt,
            endedAt: endedAt,
            temporaryFileURL: tempURL,
            consentGrantId: "recorder-consent-test-grant",
            recorderRoot: recorderRoot
        )
    }

    func buildEncryptedRecorderMicrophoneAudioChunkWithLocalTranscriptForTesting(
        plaintext: Data,
        transcriptText: String,
        startedAt: Date = Date(timeIntervalSince1970: 1_782_680_400),
        endedAt: Date = Date(timeIntervalSince1970: 1_782_680_430),
        recorderRoot: URL
    ) throws -> [String: Any] {
        let tempURL = try Self.recorderTemporaryAudioFileURL()
        try plaintext.write(to: tempURL, options: [.atomic])
        return try Self.buildEncryptedRecorderAudioChunkEnvelope(
            source: "microphone",
            startedAt: startedAt,
            endedAt: endedAt,
            temporaryFileURL: tempURL,
            consentGrantId: "recorder-consent-test-grant",
            transcript: RecorderLocalAudioTranscript.localComplete(
                text: transcriptText,
                startedAt: startedAt,
                endedAt: endedAt,
                transcriberName: "agentic30-local-transcriber-test",
                transcriberVersion: "0.0.0-test"
            ),
            recorderRoot: recorderRoot
        )
    }

    func buildEncryptedRecorderMicrophoneAudioChunkWithUnavailableTranscriptForTesting(
        plaintext: Data,
        transcriptionTerminalState: String,
        startedAt: Date = Date(timeIntervalSince1970: 1_782_680_400),
        endedAt: Date = Date(timeIntervalSince1970: 1_782_680_430),
        recorderRoot: URL
    ) throws -> [String: Any] {
        let tempURL = try Self.recorderTemporaryAudioFileURL()
        try plaintext.write(to: tempURL, options: [.atomic])
        return try Self.buildEncryptedRecorderAudioChunkEnvelope(
            source: "microphone",
            startedAt: startedAt,
            endedAt: endedAt,
            temporaryFileURL: tempURL,
            consentGrantId: "recorder-consent-test-grant",
            transcript: RecorderLocalAudioTranscript.unavailable(
                terminalState: transcriptionTerminalState
            ),
            recorderRoot: recorderRoot
        )
    }

    @discardableResult
    func sendRecorderAudioChunkForTesting(
        _ audio: [String: Any],
        captureMode: String = "background",
        automatic: Bool = true
    ) -> Bool {
        sendRecorderAudioChunkEnvelope(
            audio,
            captureMode: captureMode,
            automatic: automatic
        )
    }

    func recordRecorderClipboardTriggerForTesting(
        changeCount: Int,
        pasteboardTypes: [String] = [],
        occurredAt: Date = Date(timeIntervalSince1970: 0),
        appName: String? = "Agentic30Tests",
        windowTitle: String? = "Clipboard Trigger Test",
        contentText: String? = nil
    ) {
        recordRecorderClipboardTrigger(
            changeCount: changeCount,
            pasteboardTypes: pasteboardTypes,
            occurredAt: occurredAt,
            appName: appName,
            windowTitle: windowTitle,
            contentText: contentText
        )
    }
    #endif

    private static func currentRecorderMetadataProbe() -> [(id: String, status: String, rootCause: String?, message: String)] {
        let metadata = currentRecorderRuntimeMetadata()
        return [
            (
                id: "browserMetadata",
                status: metadata.browserURL == nil ? "degraded" : "available",
                rootCause: metadata.browserURL == nil ? metadata.browserRootCause : nil,
                message: metadata.browserURL == nil
                    ? "Swift runtime probe could not read a browser URL through local Apple Events or AX; recorder will run with less browser context."
                    : "Swift runtime probe can read the current browser URL locally."
            ),
            (
                id: "documentMetadata",
                status: metadata.documentPath == nil ? "degraded" : "available",
                rootCause: metadata.documentPath == nil ? metadata.documentRootCause : nil,
                message: metadata.documentPath == nil
                    ? "Swift AX runtime probe could not read a document path; recorder will run with less document context."
                    : "Swift AX runtime probe can read the current document path."
            ),
        ]
    }

    private struct RecorderRuntimeMetadata {
        let browserURL: String?
        let documentPath: String?
        let browserRootCause: String
        let documentRootCause: String
    }

    private static func currentRecorderRuntimeMetadata() -> RecorderRuntimeMetadata {
        guard let app = NSWorkspace.shared.frontmostApplication else {
            return RecorderRuntimeMetadata(
                browserURL: nil,
                documentPath: nil,
                browserRootCause: "frontmost_application_unavailable",
                documentRootCause: "frontmost_application_unavailable"
            )
        }
        let browserAppleEventsProbe = recorderBrowserURLFromKnownApplication(app)
        guard AXIsProcessTrusted() else {
            return RecorderRuntimeMetadata(
                browserURL: browserAppleEventsProbe.url,
                documentPath: nil,
                browserRootCause: browserAppleEventsProbe.url == nil
                    ? (browserAppleEventsProbe.rootCause ?? "accessibility_permission_missing")
                    : "",
                documentRootCause: "accessibility_permission_missing"
            )
        }
        let appElement = AXUIElementCreateApplication(app.processIdentifier)
        let focusedWindow = axElementAttribute("AXFocusedWindow", from: appElement)
        let candidates = axMetadataCandidates(from: focusedWindow) + axMetadataCandidates(from: appElement)
        let browserURL = browserAppleEventsProbe.url ?? candidates.first(where: isHttpURLString)
        let documentPath = candidates.compactMap(documentPathString(from:)).first
        return RecorderRuntimeMetadata(
            browserURL: browserURL,
            documentPath: documentPath,
            browserRootCause: browserURL == nil
                ? (browserAppleEventsProbe.rootCause ?? "browser_url_ax_attribute_unavailable")
                : "",
            documentRootCause: documentPath == nil ? "document_path_ax_attribute_unavailable" : ""
        )
    }

    private struct RecorderBrowserURLProbe {
        let url: String?
        let rootCause: String?
    }

    private static func recorderBrowserURLFromKnownApplication(_ app: NSRunningApplication) -> RecorderBrowserURLProbe {
        guard let bundleIdentifier = app.bundleIdentifier?.trimmingCharacters(in: .whitespacesAndNewlines),
              let source = recorderBrowserURLAppleScriptSource(bundleIdentifier: bundleIdentifier) else {
            return RecorderBrowserURLProbe(url: nil, rootCause: nil)
        }
        var errorInfo: NSDictionary?
        guard let descriptor = NSAppleScript(source: source)?.executeAndReturnError(&errorInfo) else {
            return RecorderBrowserURLProbe(
                url: nil,
                rootCause: recorderBrowserURLAppleScriptRootCause(errorInfo: errorInfo)
            )
        }
        let value = descriptor.stringValue?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        guard !value.isEmpty else {
            return RecorderBrowserURLProbe(url: nil, rootCause: "browser_url_apple_events_empty")
        }
        guard isHttpURLString(value) else {
            return RecorderBrowserURLProbe(url: nil, rootCause: "browser_url_apple_events_invalid_url")
        }
        return RecorderBrowserURLProbe(url: value, rootCause: nil)
    }

    private static func recorderBrowserURLAppleScriptSource(bundleIdentifier: String) -> String? {
        let cleanBundleIdentifier = bundleIdentifier.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanBundleIdentifier.isEmpty else { return nil }
        switch cleanBundleIdentifier {
        case "com.apple.Safari",
             "com.apple.SafariTechnologyPreview":
            return """
            tell application id "\(cleanBundleIdentifier)"
                if (count of documents) is 0 then return ""
                return URL of front document
            end tell
            """
        case "com.google.Chrome",
             "com.google.Chrome.canary",
             "org.chromium.Chromium",
             "com.brave.Browser",
             "com.microsoft.edgemac",
             "company.thebrowser.Browser",
             "com.vivaldi.Vivaldi",
             "com.operasoftware.Opera",
             "com.naver.Whale":
            return """
            tell application id "\(cleanBundleIdentifier)"
                if (count of windows) is 0 then return ""
                return URL of active tab of front window
            end tell
            """
        default:
            return nil
        }
    }

    private static func recorderBrowserURLAppleScriptRootCause(errorInfo: NSDictionary?) -> String {
        let errorNumber = errorInfo?[NSAppleScript.errorNumber] as? Int
        if errorNumber == -1743 {
            return "browser_url_apple_events_permission_denied"
        }
        if errorNumber == -600 {
            return "browser_url_apple_events_application_unavailable"
        }
        return "browser_url_apple_events_unavailable"
    }

    private static func axMetadataCandidates(from element: AXUIElement?) -> [String] {
        guard let element else { return [] }
        return [
            "AXURL",
            "AXDocument",
            "AXFilename",
            "AXTitle",
        ].compactMap { axStringAttribute($0, from: element) }
    }

    private static func axElementAttribute(_ attribute: String, from element: AXUIElement) -> AXUIElement? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard result == .success, let value else { return nil }
        guard CFGetTypeID(value) == AXUIElementGetTypeID() else { return nil }
        return (value as! AXUIElement)
    }

    private static func axStringAttribute(_ attribute: String, from element: AXUIElement) -> String? {
        var value: CFTypeRef?
        let result = AXUIElementCopyAttributeValue(element, attribute as CFString, &value)
        guard result == .success, let value else { return nil }
        if let url = value as? URL {
            return url.absoluteString.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        }
        if let string = value as? String {
            return string.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        }
        return nil
    }

    private static func isHttpURLString(_ value: String) -> Bool {
        guard let url = URL(string: value), let scheme = url.scheme?.lowercased() else { return false }
        return scheme == "http" || scheme == "https"
    }

    private static func documentPathString(from value: String) -> String? {
        if isHttpURLString(value) { return nil }
        if let url = URL(string: value), url.isFileURL {
            return url.path.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        }
        return value.hasPrefix("/") ? value : nil
    }

    private enum RecorderFrameCaptureError: LocalizedError {
        case screenCaptureKitUnavailable
        case noDisplay
        case jpegEncodingFailed

        var errorDescription: String? {
            switch self {
            case .screenCaptureKitUnavailable:
                return "ScreenCaptureKit is unavailable on this macOS runtime."
            case .noDisplay:
                return "ScreenCaptureKit did not return a capturable display."
            case .jpegEncodingFailed:
                return "ScreenCaptureKit frame could not be encoded as JPEG."
            }
        }
    }

    private enum RecorderRawMediaEncryptionError: LocalizedError {
        case mediaEncryptionKeyUnavailable(String)
        case mediaEncryptionFailed(String)

        var errorDescription: String? {
            switch self {
            case .mediaEncryptionKeyUnavailable(let message):
                return "ERR_RECORDER_MEDIA_KEY_UNAVAILABLE: \(message)"
            case .mediaEncryptionFailed(let message):
                return "ERR_RECORDER_MEDIA_ENCRYPTION_FAILED: \(message)"
            }
        }
    }

    private enum RecorderAudioCaptureError: LocalizedError {
        case microphoneRecorderStartFailed
        case emptyAudioFile

        var errorDescription: String? {
            switch self {
            case .microphoneRecorderStartFailed:
                return "ERR_RECORDER_AUDIO_MICROPHONE_RECORDER_START_FAILED: AVAudioRecorder could not start microphone recording."
            case .emptyAudioFile:
                return "ERR_RECORDER_AUDIO_EMPTY_MEDIA_FILE: microphone recorder produced an empty audio file."
            }
        }
    }

    private enum RecorderFrameImageError: LocalizedError {
        case invalidRawApiURL
        case invalidResponse
        case httpStatus(Int)
        case invalidContentType(String)
        case invalidImageData

        var errorDescription: String? {
            switch self {
            case .invalidRawApiURL:
                return "Recorder raw API URL is invalid."
            case .invalidResponse:
                return "Recorder raw API image response was not an HTTP response."
            case .httpStatus(let status):
                return "Recorder raw frame image request failed with HTTP \(status)."
            case .invalidContentType(let contentType):
                return "Recorder raw frame image returned unexpected content type: \(contentType.isEmpty ? "missing" : contentType)."
            case .invalidImageData:
                return "Recorder raw frame image bytes could not be decoded as JPEG."
            }
        }
    }

    private enum RecorderSearchError: LocalizedError {
        case invalidRawApiURL
        case invalidResponse

        var errorDescription: String? {
            switch self {
            case .invalidRawApiURL:
                return "Recorder raw API URL is invalid."
            case .invalidResponse:
                return "Recorder redacted search returned a non-HTTP or malformed response."
            }
        }
    }

    private enum RecorderSqlInspectorError: LocalizedError {
        case invalidRawApiURL
        case invalidResponse
        case httpStatus(Int)
        case rawApiRejected(code: String, message: String?)

        var errorDescription: String? {
            switch self {
            case .invalidRawApiURL:
                return "Recorder raw API URL is invalid."
            case .invalidResponse:
                return "Recorder SQL inspector returned a non-HTTP response."
            case .httpStatus(let status):
                return "Recorder SQL inspector request failed with HTTP \(status)."
            case .rawApiRejected(let code, let message):
                if let message, !message.isEmpty {
                    return "\(code): \(message)"
                }
                return code
            }
        }
    }

    func prepareRecorderPipesForDisplay() {
        guard recorderPipes.isEmpty && recorderPipeRuns.isEmpty else { return }
        refreshRecorderPipes()
    }

    func refreshRecorderPipes() {
        guard isConnected else {
            recorderPipeLastError = "실행 보조 앱이 연결되지 않아 Pipe 상태를 불러올 수 없습니다."
            return
        }
        recorderPipesRefreshing = true
        recorderPipeLastError = nil
        guard sidecar.send(payload: [
            "type": "recorder_pipes_list",
            "limit": 50,
            "runLimit": 50,
        ]) else {
            recorderPipesRefreshing = false
            recorderPipeLastError = "Pipe 상태 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_pipes_refresh_requested",
            authSession: macAuthSession
        )
    }

    func runRecorderPipe(_ pipeId: String) {
        let cleanPipeId = pipeId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanPipeId.isEmpty else { return }
        guard isConnected else {
            recorderPipeLastError = "실행 보조 앱이 연결되지 않아 Pipe를 실행할 수 없습니다."
            return
        }
        let now = Date()
        let startedAt = Calendar.current.date(byAdding: .hour, value: -24, to: now) ?? now
        recorderPipeActionInFlight.insert(cleanPipeId)
        recorderPipeLastError = nil
        let sent = sidecar.send(payload: [
            "type": "recorder_pipe_run",
            "pipeId": cleanPipeId,
            "startedAt": ISO8601DateFormatter().string(from: startedAt),
            "endedAt": ISO8601DateFormatter().string(from: now),
            "triggerReason": "manual",
            "limit": 2000,
            "runLimit": 50,
        ])
        guard sent else {
            recorderPipeActionInFlight.remove(cleanPipeId)
            recorderPipeLastError = "Pipe 실행 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_pipe_run_requested",
            properties: ["pipe_id": cleanPipeId],
            authSession: macAuthSession
        )
    }

    func runRecorderDayMemoryLoop(
        startedAt: Date? = nil,
        endedAt: Date? = nil,
        now: Date = Date(),
        workspaceId: String? = nil,
        projectId: String? = nil,
        persistReviewSnapshot: Bool = true
    ) {
        guard isConnected else {
            recorderDayMemoryLoopLastError = "실행 보조 앱이 연결되지 않아 Day Memory Review를 실행할 수 없습니다."
            return
        }
        let formatter = ISO8601DateFormatter()
        let end = endedAt ?? (Calendar.current.date(byAdding: .second, value: 1, to: now) ?? now)
        let start = startedAt ?? (Calendar.current.date(byAdding: .hour, value: -24, to: now) ?? now)
        recorderDayMemoryLoopRunning = true
        recorderDayMemoryLoopLastError = nil
        var payload: [String: Any] = [
            "type": "recorder_day_memory_loop_run",
            "startedAt": formatter.string(from: start),
            "endedAt": formatter.string(from: end),
            "now": formatter.string(from: now),
            "persistReviewSnapshot": persistReviewSnapshot,
            "limit": 2000,
        ]
        if let workspaceId = workspaceId?.trimmingCharacters(in: .whitespacesAndNewlines), !workspaceId.isEmpty {
            payload["workspaceId"] = workspaceId
        }
        if let projectId = projectId?.trimmingCharacters(in: .whitespacesAndNewlines), !projectId.isEmpty {
            payload["projectId"] = projectId
        }
        guard sidecar.send(payload: payload) else {
            recorderDayMemoryLoopRunning = false
            recorderDayMemoryLoopLastError = "Day Memory Review 실행 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_day_memory_loop_requested",
            properties: ["persist_review_snapshot": persistReviewSnapshot],
            authSession: macAuthSession
        )
    }

    func reviewRecorderEvidenceCandidate(
        candidateId: String,
        decision: String,
        reason: String? = nil,
        externalArtifact: [String: Any]? = nil
    ) {
        let cleanCandidateID = candidateId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanCandidateID.isEmpty else { return }
        guard isConnected else {
            recorderDayMemoryLoopLastError = "실행 보조 앱이 연결되지 않아 Evidence Inbox 후보를 검토할 수 없습니다."
            return
        }
        let cleanDecision = decision.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanDecision.isEmpty else { return }
        recorderEvidenceCandidateReviewInFlight.insert(cleanCandidateID)
        recorderDayMemoryLoopLastError = nil
        var payload: [String: Any] = [
            "type": "recorder_evidence_candidate_review",
            "candidateId": cleanCandidateID,
            "decision": cleanDecision,
            "now": ISO8601DateFormatter().string(from: Date()),
        ]
        if let reason = reason?.trimmingCharacters(in: .whitespacesAndNewlines), !reason.isEmpty {
            payload["reason"] = reason
        }
        if let externalArtifact {
            payload["externalArtifact"] = externalArtifact
        }
        guard sidecar.send(payload: payload) else {
            recorderEvidenceCandidateReviewInFlight.remove(cleanCandidateID)
            recorderDayMemoryLoopLastError = "Evidence Inbox 후보 검토 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_evidence_candidate_review_requested",
            properties: [
                "decision": cleanDecision,
                "has_external_artifact": externalArtifact != nil,
            ],
            authSession: macAuthSession
        )
    }

    func applyRecorderRetention() {
        guard isConnected else {
            recorderRetentionLastError = "실행 보조 앱이 연결되지 않아 Recorder retention을 실행할 수 없습니다."
            return
        }
        recorderRetentionApplyRunning = true
        recorderRetentionLastError = nil
        let sent = sidecar.send(payload: [
            "type": "recorder_retention_apply",
            "now": ISO8601DateFormatter().string(from: Date()),
        ])
        guard sent else {
            recorderRetentionApplyRunning = false
            recorderRetentionLastError = "Recorder retention 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_retention_apply_requested",
            authSession: macAuthSession
        )
    }

    func cancelRecorderPipeRun(_ runId: String) {
        let cleanRunId = runId.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !cleanRunId.isEmpty else { return }
        guard isConnected else {
            recorderPipeLastError = "실행 보조 앱이 연결되지 않아 Pipe 실행을 취소할 수 없습니다."
            return
        }
        recorderPipeActionInFlight.insert(cleanRunId)
        recorderPipeLastError = nil
        let sent = sidecar.send(payload: [
            "type": "recorder_pipe_cancel",
            "runId": cleanRunId,
            "reason": "local_user_cancelled",
            "runLimit": 50,
        ])
        guard sent else {
            recorderPipeActionInFlight.remove(cleanRunId)
            recorderPipeLastError = "Pipe 취소 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_pipe_cancel_requested",
            properties: ["run_id": cleanRunId],
            authSession: macAuthSession
        )
    }

    func tickRecorderPipeScheduler() {
        guard isConnected else {
            recorderPipeLastError = "실행 보조 앱이 연결되지 않아 Pipe 스케줄러를 실행할 수 없습니다."
            return
        }
        recorderPipeSchedulerRunning = true
        recorderPipeLastError = nil
        let sent = sidecar.send(payload: [
            "type": "recorder_pipe_scheduler_tick",
            "autoRun": true,
            "limit": 50,
            "maxRuns": 10,
            "runLimit": 50,
        ])
        guard sent else {
            recorderPipeSchedulerRunning = false
            recorderPipeLastError = "Pipe 스케줄러 요청을 실행 보조 앱에 보내지 못했습니다."
            return
        }
        PostHogTelemetry.capture(
            "mac_recorder_pipe_scheduler_tick_requested",
            authSession: macAuthSession
        )
    }

    private func replaceRecorderPipeRuns(_ runs: [RecorderPipeRun]) {
        recorderPipeRuns = runs.sorted { lhs, rhs in
            if lhs.startedAt != rhs.startedAt {
                return lhs.startedAt > rhs.startedAt
            }
            return lhs.id > rhs.id
        }
    }

    private func upsertRecorderPipeRun(_ run: RecorderPipeRun) {
        var nextRuns = recorderPipeRuns.filter { $0.id != run.id }
        nextRuns.append(run)
        replaceRecorderPipeRuns(nextRuns)
    }

    /// 아침 브리핑 탭 진입 시 호출. 사이드카가 캐시된 브리핑을 즉시 돌려주고,
    /// 로컬 날짜가 바뀌었으면 소스 수집을 다시 돈다.
    func prepareMorningBriefingForDisplay() {
        #if DEBUG
        if emitUITestingMorningBriefingEventsIfRequested() { return }
        #endif
        guard isConnected else { return }
        markLongRunningCompletionDisplayInterest(.morningBriefing)
        requestMorningBriefing(autoRefreshIfStale: true)
    }

    private func requestMorningBriefing(autoRefreshIfStale: Bool) {
        guard isConnected else { return }
        sidecar.send(payload: [
            "type": "morning_briefing_get",
            "preferredProvider": selectedProvider.rawValue,
            "autoRefreshIfStale": autoRefreshIfStale,
        ])
    }

    private func mergedMorningBriefingStatus(
        from briefingStatus: MorningBriefingStatus?,
        applying topLevelStatus: MorningBriefingStatus?
    ) -> MorningBriefingStatus? {
        guard let topLevelStatus else { return briefingStatus }
        return MorningBriefingStatus(
            state: topLevelStatus.state ?? briefingStatus?.state,
            detail: topLevelStatus.detail ?? briefingStatus?.detail,
            reason: topLevelStatus.reason ?? briefingStatus?.reason,
            runId: topLevelStatus.runId ?? briefingStatus?.runId,
            snapshot: topLevelStatus.snapshot ?? briefingStatus?.snapshot,
            elapsedMs: topLevelStatus.elapsedMs ?? briefingStatus?.elapsedMs,
            durationMs: topLevelStatus.durationMs ?? briefingStatus?.durationMs,
            failedSources: topLevelStatus.failedSources ?? briefingStatus?.failedSources
        )
    }

    private func morningBriefing(
        _ briefing: MorningBriefing,
        applying topLevelStatus: MorningBriefingStatus?
    ) -> MorningBriefing {
        var updated = briefing
        updated.status = mergedMorningBriefingStatus(
            from: briefing.status,
            applying: topLevelStatus
        )
        return updated
    }

    func refreshMorningBriefing(reason: String = "manual", force: Bool = true) {
        guard isConnected else { return }
        if longRunningCompletionReasonIsUserVisible(reason) || force {
            beginLongRunningCompletionAttempt(.morningBriefing, source: reason, isUserVisible: true)
        }
        PostHogTelemetry.capture("mac_morning_briefing_refresh_requested", properties: [
            "reason": reason,
        ], authSession: macAuthSession)
        morningBriefingCollecting = true
        sidecar.send(payload: [
            "type": "morning_briefing_refresh",
            "reason": reason,
            "force": force,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func submitMorningBriefingAnomalyLabel(_ label: String) {
        let trimmed = label.trimmingCharacters(in: .whitespacesAndNewlines)
        guard isConnected, !trimmed.isEmpty else { return }
        PostHogTelemetry.capture("mac_morning_briefing_anomaly_labeled", properties: [
            "anomaly": morningBriefing?.anomaly?.id ?? "",
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "morning_briefing_anomaly_label",
            "label": trimmed,
            // 라벨 후 재브로드캐스트되는 브리핑의 연결 행 라이브 판정(MCP OAuth)이
            // 현재 선택한 프로바이더 기준이 되도록 — get/refresh와 같은 규약.
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    func applyMorningBriefingActionDraft(_ action: MorningBriefingActionDraft) {
        draft = action.copyText ?? ""
        PostHogTelemetry.capture("mac_activation_completed", properties: [
            "source": "morning_briefing_action",
            "action_id": action.id,
            "action_kind": action.kind ?? "",
            "briefing_day": morningBriefing?.day ?? 0,
            "verdict_state": morningBriefing?.customerEvidenceVerdict?.state ?? "",
            "is_primary_action": action.id == morningBriefing?.customerEvidenceVerdict?.primaryActionId,
        ], authSession: macAuthSession)
    }

    #if DEBUG
    private func emitUITestingMorningBriefingEventsIfRequested() -> Bool {
        let arguments = CommandLine.arguments
        let wantsLoadingFixture = arguments.contains("--ui-testing-stub-morning-briefing-loading")
        let wantsFailedSourceFixture = arguments.contains("--ui-testing-stub-morning-briefing-failed-source")
        guard wantsLoadingFixture || wantsFailedSourceFixture || arguments.contains("--ui-testing-stub-morning-briefing-events") else {
            return false
        }
        guard !didEmitUITestingMorningBriefingEvents else {
            return true
        }
        didEmitUITestingMorningBriefingEvents = true
        if wantsLoadingFixture {
            morningBriefing = nil
            morningBriefingPrevious = nil
            morningBriefingCollecting = true
            morningBriefingSourceProgress = [
                "cloudflare": MorningBriefingSourceProgress(
                    id: "cloudflare",
                    state: "waiting",
                    detail: "방문 증거 연결 상태를 확인하고 있어요.",
                    logLines: ["Cloudflare route queued"]
                ),
                "github": MorningBriefingSourceProgress(
                    id: "github",
                    state: "collecting",
                    detail: "커밋과 배포 근거를 읽는 중이에요.",
                    logLines: ["git log --since yesterday", "gh pr list --state merged"]
                ),
                "posthog": MorningBriefingSourceProgress(
                    id: "posthog",
                    state: "done",
                    detail: "활성 사용자 이벤트 확인이 끝났어요.",
                    logLines: ["events grouped by workspace"]
                ),
            ]
            return true
        }
        morningBriefing = wantsFailedSourceFixture ? .uiTestingFailedSourceSample : .uiTestingSample
        morningBriefingCollecting = false
        morningBriefingSourceProgress = [:]
        return true
    }
    #endif

    #if DEBUG
    private func emitUITestingWorkHistoryEventsIfRequested() -> Bool {
        guard CommandLine.arguments.contains("--ui-testing-stub-work-history-events") else {
            return false
        }
        guard !didEmitUITestingWorkHistoryEvents else {
            return true
        }
        didEmitUITestingWorkHistoryEvents = true
        let snapshot = WorkHistorySnapshot(
            schemaVersion: 2,
            generatedAt: Date(timeIntervalSince1970: 1_780_000_000),
            weekStart: "2026-06-01",
            weekEnd: "2026-06-07",
            status: WorkHistoryStatus(
                state: "ready",
                lastSuccessAt: Date(timeIntervalSince1970: 1_780_000_000),
                stale: false,
                error: nil,
                reason: "manual",
                stage: nil,
                progressText: nil,
                elapsedMs: nil
            ),
            github: WorkHistoryGitHub(connected: true, prCount: 1, issueCount: 0, releaseCount: 0),
            totals: WorkHistoryTotals(
                aiMinutes: 135,
                unclassifiedMinutes: 30,
                myCommitCount: 3,
                otherCommitCount: 1,
                sessionCount: 3,
                activeDays: 2
            ),
            areas: [
                WorkHistoryArea(
                    id: "sidecar",
                    name: "사이드카 라우팅",
                    aiMinutes: 105,
                    commitCount: 3,
                    sessionCount: 2,
                    paths: ["sidecar/index.mjs", "sidecar/work-history.mjs"],
                    confidence: "high",
                    inference: "agent"
                ),
            ],
            days: [
                WorkHistoryDay(
                    date: "2026-06-01",
                    weekday: "월",
                    aiMinutes: 105,
                    areas: [
                        WorkHistoryDayArea(
                            areaId: "sidecar",
                            name: "사이드카 라우팅",
                            summary: "사이드카 라우팅에 AI 세션 1시간 45분을 투입해 커밋 3건으로 마무리했어요.",
                            nextActions: [
                                WorkHistoryNextAction(
                                    text: "라우트 테스트를 보강하세요.",
                                    evidence: "sidecar/index.mjs 변경",
                                    areaName: "사이드카 라우팅"
                                ),
                            ],
                            aiMinutes: 105,
                            sessionRanges: [
                                WorkHistorySessionRange(
                                    start: "2026-06-01T10:00:00.000Z",
                                    end: "2026-06-01T11:45:00.000Z",
                                    provider: "claude"
                                ),
                            ],
                            paths: ["sidecar/index.mjs", "sidecar/work-history.mjs"],
                            commitCount: 3,
                            confidence: "high"
                        ),
                    ],
                    referenceEvents: [
                        WorkHistoryReferenceEvent(
                            kind: "pr",
                            title: "PR #7 History tab",
                            actor: "zettalyst",
                            at: "2026-06-01T12:00:00.000Z"
                        ),
                    ]
                ),
                WorkHistoryDay(date: "2026-06-02", weekday: "화", aiMinutes: 30, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-03", weekday: "수", aiMinutes: 0, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-04", weekday: "목", aiMinutes: 0, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-05", weekday: "금", aiMinutes: 0, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-06", weekday: "토", aiMinutes: 0, areas: [], referenceEvents: []),
                WorkHistoryDay(date: "2026-06-07", weekday: "일", aiMinutes: 0, areas: [], referenceEvents: []),
            ],
            unclassified: [
                WorkHistoryUnclassifiedSession(
                    provider: "codex",
                    date: "2026-06-02",
                    start: "2026-06-02T13:00:00.000Z",
                    end: "2026-06-02T13:30:00.000Z",
                    minutes: 30,
                    paths: ["scripts/spike.mjs"]
                ),
            ],
            weekly: WorkHistoryWeekly(
                headline: "이번 주 AI 세션 2시간 15분 · 커밋 3건 · 가장 많은 시간: 사이드카 라우팅 (1시간 45분)",
                coachNotes: ["커밋으로 이어지지 않은 세션이 1개(30분) 있어요 — 진행 중이라면 마무리 지점을 정해두세요."],
                nextActions: [
                    WorkHistoryNextAction(
                        text: "커밋으로 이어지지 않은 codex 세션 작업(scripts/spike.mjs)을 마무리하거나 정리하세요.",
                        evidence: "세션 2026-06-02T13:00:00.000Z–2026-06-02T13:30:00.000Z · 수정 파일 1개",
                        areaName: nil
                    ),
                ]
            ),
            retrospective: WorkHistoryRetrospective(
                headline: "사이드카 라우팅은 닫을 수 있지만 미분류 세션 정리가 필요합니다.",
                verdict: "close_loop",
                insights: [
                    WorkHistoryInsight(
                        id: "sidecar-focus",
                        claim: "사이드카 라우팅 집중은 실제 커밋으로 이어졌습니다.",
                        whyItMatters: "집중 시간이 산출물로 이어진 영역이라 다음 주에는 테스트로 루프를 닫을 수 있습니다.",
                        confidence: "high",
                        evidenceRefs: ["사이드카 라우팅 1시간 45분", "커밋 3건"]
                    ),
                    WorkHistoryInsight(
                        id: "unclassified-loop",
                        claim: "미분류 Codex 세션은 아직 결정으로 연결되지 않았습니다.",
                        whyItMatters: "진행 중 작업인지 폐기할 탐색인지 표시하지 않으면 회고가 시간 기록에 머뭅니다.",
                        confidence: "medium",
                        evidenceRefs: ["미분류 30분", "scripts/spike.mjs"]
                    ),
                ],
                riskFlags: [
                    WorkHistoryRiskFlag(
                        id: "unclassified-session",
                        label: "미분류 세션",
                        severity: "medium",
                        reason: "Codex 세션 30분이 커밋이나 PR 근거와 연결되지 않았습니다.",
                        evidenceRefs: ["2026-06-02 13:00-13:30", "scripts/spike.mjs"]
                    ),
                ],
                nextActions: [
                    WorkHistoryRetrospectiveNextAction(
                        text: "미분류 세션을 마무리하고 라우트 테스트를 추가하세요.",
                        evidence: "scripts/spike.mjs 상태와 sidecar 라우팅 테스트 결과",
                        insightId: "unclassified-loop"
                    ),
                ],
                evidenceMix: [
                    WorkHistoryEvidenceMix(source: "ai_session", label: "AI 세션", count: 3, status: "covered"),
                    WorkHistoryEvidenceMix(source: "git_github", label: "git/GitHub", count: 4, status: "covered"),
                    WorkHistoryEvidenceMix(source: "workspace_docs", label: "워크스페이스 문서", count: 1, status: "partial"),
                    WorkHistoryEvidenceMix(source: "interview", label: "인터뷰", count: 0, status: "missing"),
                    WorkHistoryEvidenceMix(source: "bip", label: "공개 기록", count: 0, status: "missing"),
                    WorkHistoryEvidenceMix(source: "mission", label: "미션", count: 0, status: "missing"),
                    WorkHistoryEvidenceMix(source: "curriculum", label: "커리큘럼", count: 0, status: "missing"),
                ]
            )
        )
        handle(SidecarEvent(
            type: "work_history_result",
            message: nil,
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
            weeklyRitualPrompt: nil,
            requestEmit: nil,
            workHistory: snapshot
        ))
        return true
    }
    #endif

    func requestBipResearch(dayNumber: Int? = nil, curriculumDay: [String: Any]? = nil) {
        guard isConnected else { return }
        var payload: [String: Any] = [
            "type": "bip_research_get",
            "preferredProvider": selectedProvider.rawValue,
            "dayNumber": resolvedBipResearchDayNumber(dayNumber),
        ]
        if let curriculumDay {
            payload["curriculumDay"] = curriculumDay
        }
        sidecar.send(payload: payload)
    }

    func refreshBipResearch(
        reason: String = "manual",
        force: Bool = false,
        dayNumber: Int? = nil,
        curriculumDay: [String: Any]? = nil
    ) {
        guard isConnected else { return }
        let resolvedDayNumber = resolvedBipResearchDayNumber(dayNumber)
        if longRunningCompletionReasonIsUserVisible(reason) || force {
            beginLongRunningCompletionAttempt(.bipResearch, source: reason, isUserVisible: true)
        }
        PostHogTelemetry.capture("mac_bip_research_refresh_requested", properties: [
            "reason": reason,
            "force": force,
            "day_number": resolvedDayNumber,
        ], authSession: macAuthSession)
        var payload: [String: Any] = [
            "type": "bip_research_refresh",
            "reason": reason,
            "force": force,
            "preferredProvider": selectedProvider.rawValue,
            "dayNumber": resolvedDayNumber,
        ]
        if let curriculumDay {
            payload["curriculumDay"] = curriculumDay
        }
        sidecar.send(payload: payload)
    }

    func prepareBipResearchForDisplay(curriculumDay: [String: Any]? = nil) {
        lastBipResearchViewedAt = Date()
        #if DEBUG
        if emitUITestingBipResearchEventsIfRequested() { return }
        #endif
        markLongRunningCompletionDisplayInterest(.bipResearch)
        let dayNumber = resolvedBipResearchDayNumber(nil)
        requestBipResearch(dayNumber: dayNumber, curriculumDay: curriculumDay)
        guard shouldRefreshBipResearchForDisplay else { return }
        refreshBipResearch(reason: "daily", force: false, dayNumber: dayNumber, curriculumDay: curriculumDay)
    }

    #if DEBUG
    private func emitUITestingStrategyReportEventsIfRequested() -> Bool {
        let arguments = CommandLine.arguments
        let wantsPreparingFixture = arguments.contains("--ui-testing-stub-strategy-report-preparing")
        guard wantsPreparingFixture || arguments.contains("--ui-testing-stub-strategy-report-events") else {
            return false
        }
        guard !didEmitUITestingStrategyReportEvents else {
            return true
        }
        didEmitUITestingStrategyReportEvents = true
        strategyReportDynamicActivated = true
        if wantsPreparingFixture {
            strategyReport = .empty
            strategyReportPreparingForDisplay = true
            return true
        }
        strategyReportPreparingForDisplay = false
        strategyReport = makeUITestingStrategyReportSnapshot(
            status: StrategyReportStatus(
                state: "refreshing",
                lastSuccessAt: nil,
                stale: false,
                error: nil,
                reason: "manual",
                researchSource: "Codex Exa MCP",
                stage: "running_exa_research",
                progressText: "UI 테스트 전략 리서치 중",
                elapsedMs: 120,
                stepIndex: 3,
                stepCount: 6,
                partialFailures: nil,
                startedAt: nil,
                completedAt: nil,
                durationMs: nil
            ),
            includeReport: false
        )
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 1_600_000_000)
            self.strategyReport = self.makeUITestingStrategyReportSnapshot(
                status: StrategyReportStatus(
                    state: "ready",
                    lastSuccessAt: Date(timeIntervalSince1970: 1_779_238_800),
                    stale: false,
                    error: nil,
                    reason: "manual",
                    researchSource: "Codex Exa MCP",
                    stage: "saving_results",
                    progressText: nil,
                    elapsedMs: 880,
                    stepIndex: 6,
                    stepCount: 6,
                    partialFailures: nil,
                    startedAt: nil,
                    completedAt: Date(timeIntervalSince1970: 1_779_238_801),
                    durationMs: 880
                ),
                includeReport: true
            )
        }
        return true
    }

    private func makeUITestingStrategyReportSnapshot(
        status: StrategyReportStatus,
        includeReport: Bool
    ) -> StrategyReportSnapshot {
        StrategyReportSnapshot(
            schemaVersion: 1,
            promptProfile: "ui_test_strategy_report_v1",
            contentLocale: "ko-KR",
            generatedAt: includeReport ? Date(timeIntervalSince1970: 1_779_238_800) : nil,
            nextRefreshAfter: includeReport ? Date(timeIntervalSince1970: 1_779_325_200) : nil,
            contextFingerprint: includeReport ? "ui-test-strategy-report" : nil,
            status: status,
            workspaceEvidenceRefs: [],
            report: includeReport ? makeUITestingStrategyReportContent() : nil
        )
    }

    private func makeUITestingStrategyReportContent() -> StrategyReportContent {
        StrategyReportContent(
            commandLine: "strategy@agentic30 ~/code/agentic30 $ synthesize dynamic-strategy --from exa SPEC ICP VALUES",
            diagnosisKicker: "Verified business diagnosis",
            diagnosisTitle: "Agentic30은 동적 리서치로 paid ask와 first_value 증거 루프를 갱신하는 macOS evidence assistant입니다.",
            diagnosisLead: "Exa 공개 근거, 적대적 리뷰, 다차원 검증을 거쳐 정적 캔버스와 같은 섹션 품질로 다시 작성된 전략 리포트입니다.",
            positioningStatement: "Agentic30은 혼자 일하는 개발자가 매일 프로젝트 기록을 paid ask와 first_value 실험으로 바꾸는 macOS evidence assistant입니다.",
            judgement: "전략 판단은 코딩 생산성이 아니라 첫 고객 행동 증거를 매일 닫는 루프에 계속 집중하는 것입니다.",
            generatedBadge: "동적 리서치",
            analysisBasisLabel: "SPEC.md + ICP.md + VALUES.md + Exa public evidence",
            canvasMeta: "9 blocks · 동적 리포트",
            matrixMeta: "positioning · Exa verified",
            swotMeta: "internal / external · verified",
            summaryTiles: [
                StrategyReportSummaryTile(id: "primary-icp", label: "Primary ICP", title: "전업 1인 개발자", detail: "첫 매출 전, macOS와 AI 코딩 도구를 쓰며 기록 제출 의향이 있습니다."),
                StrategyReportSummaryTile(id: "wedge", label: "Wedge", title: "Local evidence loop", detail: "업무 기록에서 오늘의 paid ask와 first_value 목표를 만듭니다."),
                StrategyReportSummaryTile(id: "proof-target", label: "Proof target", title: "고객 행동 증거", detail: "인터뷰 원문, 유료 ask, activation, Go/No-Go 결정을 연결합니다."),
            ],
            criteriaRows: [
                StrategyReportCriterionRow(id: "product-shape", label: "제품 형태", value: "SwiftUI macOS 메뉴바 앱 + 로컬 Node sidecar + 선택적 Exa 공개 근거 리서치입니다."),
                StrategyReportCriterionRow(id: "core-pain", label: "핵심 고통", value: "AI 코딩으로 만들 수는 있지만 누구에게 얼마로 팔지 모릅니다."),
                StrategyReportCriterionRow(id: "differentiator", label: "차별 기준", value: "정적 강의가 아니라 로컬 실행 기록에서 adaptive Day 과제와 evidence gate를 생성합니다."),
                StrategyReportCriterionRow(id: "stage", label: "현재 단계", value: "private pilot evidence와 외부 ICP 반응을 추적하는 단계입니다."),
            ],
            canvasBlocks: [
                StrategyReportCanvasBlock(id: "partners", number: "08", eyebrow: "Partners", title: "핵심 파트너", bullets: ["Claude / Codex / Cursor / Gemini AI coding provider 생태계", "PostHog, GitHub, Cloudflare activation evidence"], tone: "blue"),
                StrategyReportCanvasBlock(id: "activities", number: "07", eyebrow: "Activities", title: "핵심 활동", bullets: ["Foundation Day 0-3 dogfood와 private pilot 반복", "프로젝트/업무/인터뷰/BIP/PostHog 기록에서 다음 과제 생성"], tone: "accent"),
                StrategyReportCanvasBlock(id: "resources", number: "06", eyebrow: "Resources", title: "핵심 자원", bullets: ["로컬 실행 로그와 proof-ledger", "SPEC / ICP / VALUES 전략 문서"], tone: "sky"),
                StrategyReportCanvasBlock(id: "value-proposition", number: "02", eyebrow: "Value proposition", title: "가치 제안", bullets: ["오늘 보낼 paid ask와 측정할 first_value를 좁힙니다.", "혼자 판단하는 편향을 transcript, BIP, PostHog 숫자로 교정합니다."], tone: "accent"),
                StrategyReportCanvasBlock(id: "relationships", number: "04", eyebrow: "Relationships", title: "고객 관계", bullets: ["메뉴바 상주 assistant의 매일 체크인", "private pilot에서 맞춤 작업과 강한 피드백 루프"], tone: "accent"),
                StrategyReportCanvasBlock(id: "channels", number: "03", eyebrow: "Channels", title: "채널", bullets: ["Threads / Discord / indie founder 커뮤니티", "직접 사이드프로젝트를 가진 1인 개발자 referral"], tone: "blue"),
                StrategyReportCanvasBlock(id: "customer-segments", number: "01", eyebrow: "Customer segments", title: "고객 세그먼트", bullets: ["전업 1인 개발자, 첫 매출 전, macOS 사용자", "AI 코딩 도구 사용 경험이 있는 builder"], tone: "accent"),
                StrategyReportCanvasBlock(id: "cost-structure", number: "09", eyebrow: "Cost structure", title: "비용 구조", bullets: ["provider execution 비용과 macOS 배포/지원 비용", "리서치/검증 패스의 시간 비용"], tone: "magenta"),
                StrategyReportCanvasBlock(id: "revenue-streams", number: "05", eyebrow: "Revenue streams", title: "수익원", bullets: ["pilot 유료 ask", "월 구독형 개인 evidence assistant"], tone: "accent"),
            ],
            businessCanvasTopRows: nil,
            businessCanvasBottomRow: nil,
            competitors: [
                StrategyReportCompetitor(id: "agentic30", title: "Agentic30", tag: "Adaptive PMF evidence loop", body: "내 프로젝트 기록을 읽어 오늘의 유료 ask와 증거 gate를 만듭니다.", gap: "검증 과제: 유료 pilot에서 first_value를 반복 입증해야 합니다.", x: 0.78, y: 0.22, adaptiveScore: 92, evidenceScore: 84, sourceLabel: "SPEC / ICP / Exa", sourceURL: "https://agentic30.com", sourceDisplay: "agentic30.com", verifiedAt: "2026-06", scoreRationale: "로컬 기록 기반 adaptive 과제와 evidence gate가 함께 있습니다.", category: "agentic30", isAgentic30: true, labelPlacement: "leading"),
                StrategyReportCompetitor(id: "cursor", title: "Cursor", tag: "AI coding workspace", body: "빌드 속도는 높지만 PMF 증거 루프는 제품 밖에 있습니다.", gap: "Agentic30은 코딩 생산성 대신 고객 행동 증거를 닫습니다.", x: 0.72, y: 0.72, adaptiveScore: 80, evidenceScore: 35, sourceLabel: "Public docs", sourceURL: "https://cursor.com", sourceDisplay: "cursor.com", verifiedAt: "2026-06", scoreRationale: "코딩 적응성은 강하지만 paid ask 추적은 핵심 제품이 아닙니다.", category: "aiBuild", isAgentic30: false, labelPlacement: "trailing"),
                StrategyReportCompetitor(id: "indiefounders", title: "IndieFounders", tag: "Founder community", body: "창업자 네트워크와 학습 콘텐츠는 있으나 로컬 evidence loop는 약합니다.", gap: "Agentic30은 커뮤니티가 아니라 매일 실행 기록에 붙습니다.", x: 0.04, y: 0.95, adaptiveScore: 4, evidenceScore: 5, sourceLabel: "Public site", sourceURL: "https://indiefounders.net", sourceDisplay: "indiefounders.net", verifiedAt: "2026-06", scoreRationale: "커뮤니티 증거는 있으나 제품 실행 자동화는 제한적입니다.", category: "community", isAgentic30: false, labelPlacement: "leading"),
            ],
            swotGroups: [
                StrategyReportSWOTGroup(id: "strengths", title: "Strengths", tag: "내부 강점", tone: "accent", bullets: ["로컬 기록 기반 맥락", "매일 evidence gate로 이어지는 루프"]),
                StrategyReportSWOTGroup(id: "weaknesses", title: "Weaknesses", tag: "내부 약점", tone: "magenta", bullets: ["초기 데이터 밀도가 낮음", "macOS 한정 배포"]),
                StrategyReportSWOTGroup(id: "opportunities", title: "Opportunities", tag: "외부 기회", tone: "sky", bullets: ["AI coding tool 보급", "1인 개발자 monetization 니즈"]),
                StrategyReportSWOTGroup(id: "threats", title: "Threats", tag: "외부 위협", tone: "blue", bullets: ["대형 coding IDE의 workflow 흡수", "전략 리포트만으로 보이는 위험"]),
            ],
            swotMatrixColumnCount: 2,
            swotMatrixRows: [["strengths", "weaknesses"], ["opportunities", "threats"]],
            sourceRefs: [],
            searchableCopy: ["동적 리서치", "Adaptive PMF evidence loop", "paid ask", "first_value"],
            generatedAt: Date(timeIntervalSince1970: 1_779_238_800)
        )
    }

    private func emitUITestingNewsMarketRadarEventsIfRequested() -> Bool {
        let arguments = CommandLine.arguments
        let wantsPreparingFixture = arguments.contains("--ui-testing-stub-news-market-radar-preparing")
        guard wantsPreparingFixture || arguments.contains("--ui-testing-stub-news-market-radar-events") else {
            return false
        }
        guard !didEmitUITestingNewsMarketRadarEvents else {
            return true
        }
        didEmitUITestingNewsMarketRadarEvents = true
        if wantsPreparingFixture {
            newsMarketRadar = .empty
            newsMarketRadarPreparingForDisplay = true
            return true
        }
        newsMarketRadarPreparingForDisplay = false
        let now = Date(timeIntervalSince1970: 1_779_238_800)
        let later = now.addingTimeInterval(24 * 60 * 60)
        let status = NewsMarketRadarStatus(
            state: "refreshing",
            lastSuccessAt: nil,
            stale: false,
            error: nil,
            reason: "daily",
            researchSource: "Codex 웹 검색 도구",
            stage: "running_provider_research",
            progressText: "UI 테스트 리서치 갱신 중",
            elapsedMs: 120,
            stepIndex: 4,
            stepCount: 6,
            partialFailures: nil
        )
        handle(SidecarEvent(
            type: "news_market_radar_status",
            message: nil,
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
            weeklyRitualPrompt: nil,
            requestEmit: nil,
            newsMarketRadarStatus: status
        ))
        Task { @MainActor in
            try? await Task.sleep(nanoseconds: 150_000_000)
            self.handle(SidecarEvent(
                type: "news_market_radar_result",
                message: nil,
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
                weeklyRitualPrompt: nil,
                requestEmit: nil,
                newsMarketRadar: NewsMarketRadarSnapshot(
                    schemaVersion: 1,
                    generatedAt: now,
                    nextRefreshAfter: later,
                    status: NewsMarketRadarStatus(
                        state: "ready",
                        lastSuccessAt: now,
                        stale: false,
                        error: nil,
                        reason: "daily",
                        researchSource: "Codex 웹 검색 도구",
                        stage: "saving_results",
                        progressText: "UI 테스트 리서치 준비 완료",
                        elapsedMs: 240,
                        stepIndex: 6,
                        stepCount: 6,
                        partialFailures: [
                            NewsMarketRadarPartialFailure(
                                laneId: "problem",
                                laneTitle: "문제",
                                error: "UI 테스트 부분 실패"
                            )
                        ]
                    ),
                    workspaceEvidenceRefs: [],
                    lanes: [
                        NewsMarketRadarLane(
                            id: "alternatives_pricing",
                            title: "대안/가격",
                            hypothesis: "이미 돈을 쓰는 대안과 가격 기준은 무엇인가",
                            impact: "strengthens",
                            confidence: "strong",
                            cards: [
                                NewsMarketRadarCard(
                                    id: "ui-test-card",
                                    title: "UI 테스트 리서치 결과",
                                    summary: "뉴스 레퍼런스 화면이 열린 상태에서도 리서치 결과가 유지됩니다.",
                                    impact: "strengthens",
                                    confidence: "strong",
                                    whyItMatters: "리서치 갱신 후에도 선택한 뉴스 라우트가 유지되는지 확인합니다.",
                                    suggestedDocTargets: ["ICP.md"],
                                    relatedDays: [2, 5],
                                    relatedAnswerIds: ["ui-test-answer"],
                                    sourceRefs: [
                                        NewsMarketRadarSourceRef(
                                            id: "ui-test-source",
                                            sourceType: "web",
                                            title: "Codex 웹 검색 도구",
                                            url: "https://example.com/radar",
                                            domain: "example.com",
                                            path: nil,
                                            publishedAt: nil,
                                            excerpt: "UI 테스트 출처"
                                        ),
                                    ],
                                    evidenceStrength: "strong"
                                ),
                            ]
                        ),
                    ]
                )
            ))
        }
        return true
    }

    private func emitUITestingBipResearchEventsIfRequested() -> Bool {
        guard CommandLine.arguments.contains("--ui-testing-stub-bip-research-events") else {
            return false
        }
        guard !didEmitUITestingBipResearchEvents else {
            return true
        }
        didEmitUITestingBipResearchEvents = true

        let now = Date(timeIntervalSince1970: 1_779_238_800)
        let later = now.addingTimeInterval(24 * 60 * 60)
        bipResearch = BipResearchSnapshot(
            schemaVersion: 1,
            contentLocale: "ko-KR",
            promptProfile: "ui-testing",
            contextFingerprint: "ui-testing-bip-research",
            generatedAt: now,
            nextRefreshAfter: later,
            dayNumber: resolvedBipResearchDayNumber(nil),
            dayTitle: "Day 1 고객 후보",
            dayPhase: "first_users",
            status: BipResearchStatus(
                state: "ready",
                lastSuccessAt: now,
                stale: false,
                error: nil,
                reason: "ui_testing",
                researchSource: "UI 테스트 fixture",
                stage: "saving_results",
                progressText: "UI 테스트 공개 기록 리서치 준비 완료",
                elapsedMs: 180,
                stepIndex: 6,
                stepCount: 6,
                partialFailures: nil
            ),
            briefTitle: "공개 기록으로 고객 후보를 좁힙니다",
            briefBody: "UI 테스트 fixture는 공개 실행 기록, 고객 후보 근거, DM 초안 패널이 동시에 렌더되는지 검증합니다.",
            querySummary: "SpeakMac 공개 기록 · 1인 빌더 · macOS AI 도구",
            candidateTargetCount: 14,
            workspaceEvidenceRefs: [],
            signals: [
                BipResearchSignal(
                    id: "social",
                    title: "공개 소셜 기록",
                    subtitle: "X/Twitter · Threads(Meta)",
                    state: "ready",
                    tone: "success"
                ),
                BipResearchSignal(
                    id: "gap",
                    title: "확인할 공백",
                    subtitle: "결제 의향과 현재 대안",
                    state: "ask",
                    tone: "amber"
                ),
            ],
            candidates: [
                BipResearchCandidate(
                    id: "speakmac",
                    title: "SpeakMac을 쓰는 1인 macOS 빌더",
                    sourceLabel: "X / Twitter",
                    source: "@speakmac",
                    sourceType: "x",
                    medium: "public_post",
                    date: "2026-06-10",
                    matchLabel: "강한 적합",
                    matchCaption: "macOS AI workflow와 공개 실행 기록이 모두 있음",
                    quote: "메뉴바에서 바로 음성 입력과 AI 작업을 이어가는 흐름을 만들고 있다.",
                    whyTitle: "왜 후보인가",
                    whyBody: "혼자 제품을 만들고 있으며 macOS 자동화와 AI 도구 사용 맥락이 Agentic30의 Day 1 검증 질문과 맞습니다.",
                    usageTitle: "오늘의 사용처",
                    usageBody: "DM으로 현재 고객 검증 루틴과 지불 의향을 확인합니다.",
                    gap: "실제 결제 의향과 반복 사용 빈도는 아직 확인되지 않았습니다.",
                    tags: [
                        BipResearchTag(title: "macOS", tone: "sky"),
                        BipResearchTag(title: "1인 빌더", tone: "accent"),
                        BipResearchTag(title: "결제 질문 필요", tone: "amber"),
                    ],
                    sourceRefs: [
                        BipResearchSourceRef(
                            id: "speakmac-x",
                            sourceType: "x",
                            platform: "X",
                            title: "SpeakMac 공개 포스트",
                            url: "https://example.com/speakmac",
                            domain: "example.com",
                            path: "/speakmac",
                            publishedAt: "2026-06-10",
                            fetchedAt: "2026-06-11",
                            excerpt: "macOS 메뉴바 AI workflow 공개 기록"
                        ),
                    ],
                    draft: """
                    안녕하세요. macOS에서 AI 작업을 반복하는 흐름을 만들고 계신 걸 봤습니다. 지금 고객 검증이나 결제 의향 확인을 어떤 방식으로 관리하는지 10분만 여쭤봐도 될까요?
                    """,
                    evidenceStrength: "strong"
                ),
            ]
        )
        return true
    }
    #endif

    private func resolvedBipResearchDayNumber(_ explicitDayNumber: Int?) -> Int {
        let day = explicitDayNumber ?? foundationProgressState.currentDayNumber() ?? 1
        return max(1, min(day, 30))
    }

    private var shouldRefreshBipResearchForDisplay: Bool {
        if bipResearch.status.state == "refreshing" { return false }
        if bipResearch.status.state == "stale" { return true }
        if bipResearch.status.state == "failed" { return true }
        if bipResearch.dayNumber != resolvedBipResearchDayNumber(nil) { return true }
        guard let generatedAt = bipResearch.generatedAt else { return true }
        return Date().timeIntervalSince(generatedAt) >= 24 * 60 * 60
    }

    func recordOpenDesignDayAnswer(
        _ answer: OpenDesignDayAnswerSubmission,
        day: Int,
        dayType: String
    ) {
        guard isConnected else { return }
        let occurredAt = Self.sidecarDateString(from: Date())
        sidecar.send(payload: [
            "type": "curriculum_answer_saved",
            "day": day,
            "dayType": dayType,
            "questionId": answer.questionId,
            "question": [
                "id": answer.questionId,
                "dimension": answer.dimension,
                "title": answer.questionTitle,
                "prompt": answer.questionPrompt,
            ],
            "dimension": answer.dimension,
            "answerId": answer.answerId,
            "answer": [
                "id": answer.answerId,
                "title": answer.answerTitle,
                "detail": answer.answerDetail,
                "freeform": answer.freeformAnswer,
                "isAntiSignal": answer.isAntiSignal,
            ],
            "answerTitle": answer.answerTitle,
            "answerDetail": answer.answerDetail,
            "freeformAnswer": answer.freeformAnswer,
            "isAntiSignal": answer.isAntiSignal,
            "occurredAt": occurredAt,
        ])
    }

    private func recordNewsMarketRadarDayCompletionHelpIfNeeded(_ day: Int) {
        guard [2, 5, 27].contains(day),
              let viewedAt = lastNewsMarketRadarViewedAt,
              Date().timeIntervalSince(viewedAt) <= 24 * 60 * 60 else {
            return
        }
        PostHogTelemetry.capture("mac_news_market_radar_day_completion_helped", properties: [
            "day": day,
            "card_count": newsMarketRadar.cardCount,
            "lane_count": newsMarketRadar.lanes.count,
        ], authSession: macAuthSession)
    }

    func configureBipCoach(
        threadsHandle: String,
        sheetUrl: String,
        docUrl: String,
        provider: AgentProvider? = nil
    ) {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        let resolvedProvider = provider ?? selectedSession?.provider ?? selectedProvider
        PostHogTelemetry.capture("mac_bip_coach_configure_requested", properties: [
            "session_id": sessionID,
            "provider": resolvedProvider.rawValue,
            "has_threads": !threadsHandle.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            "has_sheet": !sheetUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            "has_doc": !docUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "bip_coach_configure",
            "sessionId": sessionID,
            "threadsHandle": threadsHandle,
            "sheetUrl": sheetUrl,
            "docUrl": docUrl,
            "provider": resolvedProvider.rawValue,
            "morningHour": 10,
            "eveningHour": 21,
        ])
    }

    func refreshBipCoachEvidence() {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        isBipCoachRefreshing = true
        lastBipRequestedAction = .refreshEvidence
        bipMissionProgress = BipMissionProgress(stage: "reading_sheet", detail: "Google Sheet 전체 기록을 읽는 중", provider: nil, sheetRowsRead: nil, docCharsRead: nil, elapsedMs: nil)
        lastError = nil
        PostHogTelemetry.capture("mac_bip_coach_refresh_requested", properties: [
            "session_id": sessionID,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "bip_coach_refresh_evidence",
            "sessionId": sessionID,
        ])
    }

    func generateBipMission(compact: Bool = false, curriculumDay: [String: Any]? = nil) {
        guard isConnected, let sessionID = currentBipCoachSessionID() else {
            queueStartupAction(.mission(compact: compact, curriculumDay: curriculumDay))
            return
        }
        if !iddSetupComplete {
            startBipIddQueue(docType: iddCurrentDocType)
            lastError = "초기 설정을 먼저 승인해야 Day 1 미션을 만들 수 있습니다."
            return
        }
        isBipCoachGenerating = true
        beginLongRunningCompletionAttempt(.bipMission, source: "generate_mission", isUserVisible: true)
        lastBipRequestedAction = .generateMission(compact: compact)
        lastError = nil
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        bipMissionProgress = BipMissionProgress(stage: "reading_sheet", detail: "프로젝트 기준과 오늘 커리큘럼을 확인하는 중", provider: provider.rawValue, sheetRowsRead: nil, docCharsRead: nil, elapsedMs: nil)
        PostHogTelemetry.capture("mac_bip_coach_generation_requested", properties: [
            "session_id": sessionID,
            "provider": provider.rawValue,
            "compact": compact,
        ], authSession: macAuthSession)
        var payload: [String: Any] = [
            "type": "bip_coach_generate_mission",
            "sessionId": sessionID,
            "provider": provider.rawValue,
            "compact": compact,
            "localEvidence": localEvidenceBundle(),
        ]
        if let curriculumDay {
            payload["curriculumDay"] = curriculumDay
        }
        sidecar.send(payload: payload)
    }

    func approveIddSetup() {
        guard isConnected, let sessionID = currentBipCoachSessionID() else { return }
        sidecar.send(payload: [
            "type": "idd_setup_approve",
            "sessionId": sessionID,
        ])
    }

    func requestBipSetupGate(autoStart: Bool = false) {
        guard isConnected else { return }
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        var payload: [String: Any] = [
            "type": "bip_setup_gate_check",
            "provider": provider.rawValue,
            "autoStart": autoStart,
            "localEvidence": localEvidenceBundle(),
        ]
        if let sessionID = currentBipCoachSessionID() {
            payload["sessionId"] = sessionID
        }
        sidecar.send(payload: payload)
    }

    func startBipIddQueue(docType: String? = nil) {
        guard isConnected else { return }
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        var payload: [String: Any] = [
            "type": "bip_idd_start_queue",
            "provider": provider.rawValue,
        ]
        if let sessionID = currentBipCoachSessionID() {
            payload["sessionId"] = sessionID
        }
        if let docType, !docType.isEmpty {
            payload["docType"] = docType
        }
        sidecar.send(payload: payload)
    }

    func startDay1DocHandoff(docType: String, day1Handoff: [String: Any]) {
        let normalizedDocType = docType.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalizedDocType.isEmpty else { return }
        day1DocHandoffPendingDocType = normalizedDocType
        day1DocHandoffAwaitingFollowupPrompt = false
        day1DocHandoffError = nil
        #if DEBUG
        if seedUITestingDay1BulkDocHandoffIfNeeded(docType: normalizedDocType) {
            return
        }
        #endif
        guard isConnected else {
            let docLabel = normalizedDocType == "all" ? "foundation" : normalizedDocType.uppercased()
            let message = "실행 보조 앱 연결 후 \(docLabel) 문서를 작성할 수 있습니다."
            day1DocHandoffPendingDocType = nil
            day1DocHandoffAwaitingFollowupPrompt = false
            day1DocHandoffError = message
            lastError = message
            PostHogTelemetry.capture("mac_day1_doc_handoff_rejected", properties: [
                "doc_type": normalizedDocType,
                "reason": "sidecar_disconnected",
            ], authSession: macAuthSession)
            return
        }
        #if DEBUG
        if seedUITestingDay1DocHandoffPromptIfNeeded(docType: normalizedDocType) {
            return
        }
        #endif
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        let isBulkWrite = normalizedDocType == "all"
        var payload: [String: Any] = isBulkWrite
            ? [
                "type": "day1_doc_handoff_write_all",
                "provider": provider.rawValue,
                "day1Handoff": day1Handoff,
            ]
            : [
                "type": "day1_doc_handoff_start",
                "provider": provider.rawValue,
                "docType": normalizedDocType,
                "localEvidence": localEvidenceBundle(),
                "day1Handoff": day1Handoff,
            ]
        if let sessionID = currentBipCoachSessionID() {
            payload["sessionId"] = sessionID
        }
        PostHogTelemetry.capture("mac_day1_doc_handoff_requested", properties: [
            "doc_type": normalizedDocType,
            "provider": provider.rawValue,
            "bulk": isBulkWrite,
        ], authSession: macAuthSession)
        if !sidecar.send(payload: payload) {
            let message = isBulkWrite
                ? "초기 검증 문서 저장을 요청하지 못했습니다. 실행 보조 앱 연결을 확인해 주세요."
                : "\(normalizedDocType.uppercased()) 문서 질문 카드를 요청하지 못했습니다. 실행 보조 앱 연결을 확인해 주세요."
            day1DocHandoffPendingDocType = nil
            day1DocHandoffAwaitingFollowupPrompt = false
            day1DocHandoffError = message
            lastError = message
            PostHogTelemetry.capture("mac_day1_doc_handoff_rejected", properties: [
                "doc_type": normalizedDocType,
                "reason": "sidecar_send_failed",
            ], authSession: macAuthSession)
        }
    }

    func requestDay1SurfaceReview(
        mode: String,
        landingUrl: String = "",
        workspaceRoot explicitWorkspaceRoot: String? = nil
    ) {
        let normalizedMode = mode.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? "no_landing"
            : mode.trimmingCharacters(in: .whitespacesAndNewlines)
        let root = (explicitWorkspaceRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard isConnected else {
            day1SurfaceReviewError = "실행 보조 앱 연결 후 처음 보여줄 문장을 만들 수 있습니다."
            return
        }
        guard !root.isEmpty else {
            day1SurfaceReviewError = "Workspace 경로가 비어 있습니다."
            return
        }
        day1SurfaceReviewGenerating = true
        day1SurfaceReviewError = nil
        PostHogTelemetry.capture("mac_day1_surface_review_requested", properties: [
            "mode": normalizedMode,
            "has_landing_url": !landingUrl.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty,
            "workspace_basename": (root as NSString).lastPathComponent,
        ], authSession: macAuthSession)
        if !sidecar.send(payload: [
            "type": "day1_surface_review_generate",
            "workspaceRoot": root,
            "mode": normalizedMode,
            "landingUrl": landingUrl.trimmingCharacters(in: .whitespacesAndNewlines),
        ]) {
            day1SurfaceReviewGenerating = false
            day1SurfaceReviewError = "처음 보여줄 문장 생성을 요청하지 못했습니다. 실행 보조 앱 연결을 확인해 주세요."
        }
    }

    func decideDay1SurfaceReview(
        decision: String,
        workspaceRoot explicitWorkspaceRoot: String? = nil
    ) {
        let normalizedDecision = decision.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard ["approved", "approve", "rejected", "reject"].contains(normalizedDecision) else { return }
        let root = (explicitWorkspaceRoot ?? workspaceRoot).trimmingCharacters(in: .whitespacesAndNewlines)
        guard isConnected else {
            day1SurfaceReviewError = "실행 보조 앱 연결 후 처음 보여줄 문장 결정을 저장할 수 있습니다."
            return
        }
        guard !root.isEmpty else {
            day1SurfaceReviewError = "Workspace 경로가 비어 있습니다."
            return
        }
        day1SurfaceReviewDecisionPending = normalizedDecision
        day1SurfaceReviewError = nil
        PostHogTelemetry.capture("mac_day1_surface_review_decision_requested", properties: [
            "decision": normalizedDecision,
            "workspace_basename": (root as NSString).lastPathComponent,
        ], authSession: macAuthSession)
        if !sidecar.send(payload: [
            "type": "day1_surface_review_decide",
            "workspaceRoot": root,
            "decision": normalizedDecision,
        ]) {
            day1SurfaceReviewDecisionPending = nil
            day1SurfaceReviewError = "처음 보여줄 문장 결정을 저장하지 못했습니다. 실행 보조 앱 연결을 확인해 주세요."
        }
    }

    func retryCurrentIddQuestion() {
        startBipIddQueue(docType: iddCurrentDocType ?? selectedSession?.pendingUserInput?.generation?.docType)
    }

    func selectBipMission(_ mission: BipCoachMission) {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        lastError = nil
        PostHogTelemetry.capture("mac_bip_coach_mission_selected", properties: [
            "session_id": sessionID,
            "mission_id": mission.id,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "bip_coach_select_mission",
            "sessionId": sessionID,
            "missionId": mission.id,
        ])
    }

    func completeBipMission(threadsUrl: String = "", sheetRowNote: String = "") {
        guard isConnected else { return }
        guard let sessionID = currentBipCoachSessionID() else { return }
        let cleanedThreadsUrl = threadsUrl.trimmingCharacters(in: .whitespacesAndNewlines)
        let cleanedSheetRowNote = sheetRowNote.trimmingCharacters(in: .whitespacesAndNewlines)
        isBipCoachCompleting = true
        lastError = nil
        PostHogTelemetry.capture("mac_bip_coach_completion_requested", properties: [
            "session_id": sessionID,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "bip_coach_complete_mission",
            "sessionId": sessionID,
            "threadsUrl": cleanedThreadsUrl,
            "sheetRowNote": cleanedSheetRowNote,
        ])
    }

    func requestBipReadinessCheck() {
        guard isConnected else { return }
        if bipReadiness == nil {
            bipReadiness = BipReadinessState.loading
        }
        sidecar.send(payload: [
            "type": "bip_readiness_action",
            "rowId": "*",
            "action": "recheck",
        ])
    }

    private func localEvidenceBundle() -> [String: Any] {
        var bundle: [String: Any] = [
            "workspaceRoot": WorkspaceSettings.resolvedURL().path,
        ]
        if let onboardingContext {
            bundle["onboardingContext"] = onboardingContext.bridgePayload
        }
        if let scanResult {
            var scan: [String: Any] = [:]
            if let icp = scanResult.icp { scan["icp"] = icp }
            if let spec = scanResult.spec { scan["spec"] = spec }
            if let values = scanResult.values { scan["values"] = values }
            if let designSystem = scanResult.designSystem { scan["designSystem"] = designSystem }
            if let adr = scanResult.adr { scan["adr"] = adr }
            if let goal = scanResult.goal { scan["goal"] = goal }
            if let docs = scanResult.docs { scan["docs"] = docs }
            if let sheet = scanResult.sheet { scan["sheet"] = sheet }
            if let hypothesis = scanResult.onboardingHypothesis {
                scan["onboardingHypothesis"] = [
                    "productName": hypothesis.productName ?? "",
                    "targetUser": hypothesis.targetUser ?? "",
                    "likelyUsers": hypothesis.likelyUsers ?? [],
                    "confidence": hypothesis.confidence ?? "",
                ]
            }
            bundle["workspaceScan"] = scan
        }
        return bundle
    }

    func sendBipReadinessAction(rowId: BipReadinessRowId, action: String, payload: [String: Any] = [:]) {
        guard isConnected else { return }
        var message: [String: Any] = [
            "type": "bip_readiness_action",
            "rowId": rowId.rawValue,
            "action": action,
        ]
        if let sessionID = currentBipCoachSessionID() {
            message["sessionId"] = sessionID
        }
        let provider = selectedSession?.provider ?? visibleBipCoach?.config.provider ?? selectedProvider
        message["provider"] = provider.rawValue
        for (key, value) in payload {
            message[key] = value
        }
        sidecar.send(payload: message)
    }

    func clearBipTokenExpired() {
        bipTokenExpired = nil
    }

    func startGwsAuth() {
        sendBipReadinessAction(rowId: .gwsAuth, action: "start")
    }

    func handleNotionOAuthCode(_ code: String) {
        authSession = nil
        sidecar.send(payload: [
            "type": "notion_oauth_callback",
            "code": code,
        ])
    }

    func handleNotionOAuthError(_ error: String) {
        authSession = nil
        notionOAuthInProgress = false
        notionOAuthError = error
        PostHogTelemetry.captureException(
            NSError(domain: "NotionOAuth", code: -1, userInfo: [NSLocalizedDescriptionKey: error]),
            properties: [
                "component": "agentic_view_model",
                "operation": "notion_oauth",
            ],
            authSession: macAuthSession
        )
    }

    func startMacGoogleSignIn() {
        macOnboardingStatus = .signingIn
        PostHogTelemetry.capture("mac_google_sign_in_started", authSession: macAuthSession)
        let url = MacOnboardingConstants.appBaseURL
            .appending(path: "auth/mac/start")
            .appending(queryItems: [
                URLQueryItem(name: "terms_version", value: MacOnboardingConstants.termsVersion),
                URLQueryItem(name: "privacy_version", value: MacOnboardingConstants.privacyVersion),
            ])
        presentAuthSession(url: url, flow: .macOnboarding)
    }

    func signOutMacAuth() {
        PostHogTelemetry.capture("mac_google_sign_out", authSession: macAuthSession)
        PostHogTelemetry.resetIdentity()
        KeychainHelper.deleteMacAuthSession()
        macAuthSession = nil
        macOnboardingStatus = .idle
        sendAuthContextToSidecar()
    }

    func resetAgentic30LocalUserData(
        options: Agentic30LocalDataResetOptions = Agentic30LocalDataResetOptions()
    ) throws -> KeychainHelper.LocalDataResetReport {
        let hadAppSupport = FileManager.default.fileExists(atPath: KeychainHelper.applicationSupportURL.path)
        let workspaceURLsForReset = options.includeKnownWorkspaces
            ? WorkspaceSettings.knownWorkspaceURLs()
            : []
        let workspaceAgentic30Count = workspaceURLsForReset.filter {
            FileManager.default.fileExists(
                atPath: $0.appendingPathComponent(".agentic30", isDirectory: true).path
            )
        }.count
        PostHogTelemetry.capture(
            "mac_local_data_reset_requested",
            properties: [
                "had_app_support": hadAppSupport,
                "known_workspace_count": workspaceURLsForReset.count,
                "workspace_agentic30_count": workspaceAgentic30Count,
                "include_qmd_index": options.includeAgentic30QmdIndex,
                "remove_app_bundle": options.removeAppBundle,
            ],
            authSession: macAuthSession
        )
        PostHogTelemetry.resetIdentity()

        authSession?.cancel()
        authSession = nil
        sidecar.stop()
        started = false

        defer {
            resetVolatileLocalUserDataState()
            localDataResetGeneration += 1
        }
        return localDataResetter(options, workspaceURLsForReset)
    }

    func setProjectWorkspace(_ url: URL) {
        clearStartupQueuedAction()
        WorkspaceSettings.store(url)
        Self.resetMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntakeOnlyCompleted = false
        foundationProgressStore = nil
        restoreFoundationProgress(arguments: CommandLine.arguments)
        workspaceRoot = url.path
        if let onboardingContext,
           let memory = try? persistOnboardingMemoryIfPossible(
            context: onboardingContext,
            workspaceRoot: url.path,
            intakeStore: nil,
            sources: []
           ) {
            sendOnboardingMemoryToSidecar(memory)
        }
        attemptedStartupWorkspaceScanRecoveryRoots.removeAll()
        PostHogTelemetry.capture("mac_project_workspace_selected", properties: [
            "workspace_basename": url.lastPathComponent,
        ], authSession: macAuthSession)
        if started {
            connectionLabel = "Switching workspace..."
            isConnected = false
            stopRecorderClipboardCollector()
            sidecar.stop()
            sidecar.start()
        } else {
            start()
        }
        scanWorkspace(root: url.path)
    }

    func prefetchOnboardingWorkspace(url: URL, context: OnboardingContext) {
        let fingerprint = Self.onboardingWorkspacePrefetchFingerprint(url: url, context: context)
        guard activeOnboardingWorkspacePrefetchFingerprint != fingerprint else { return }

        let isChangingPrefetchTarget = activeOnboardingWorkspacePrefetchFingerprint != nil
        activeOnboardingWorkspacePrefetchFingerprint = fingerprint
        onboardingContext = context
        onboardingContextStatus = .idle
        WorkspaceSettings.store(url)
        Self.resetMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntakeOnlyCompleted = false
        workspaceRoot = url.path
        requestedInitialBipGate = false
        requestedInitialBipMission = false
        pendingWorkspaceScanRoot = nil
        pendingWorkspaceScanProvider = nil
        attemptedStartupWorkspaceScanRecoveryRoots.removeAll()
        scanResult = nil
        pendingAgentic30GitignoreConsent = nil
        clearWorkspaceScanTiming()
        lastError = nil

        if isChangingPrefetchTarget, started {
            connectionLabel = "Switching workspace..."
            isConnected = false
            stopRecorderClipboardCollector()
            selectedSessionID = nil
            sidecar.stop()
            started = false
        }

        PostHogTelemetry.capture("mac_onboarding_workspace_prefetch_requested", properties: [
            "workspace_basename": url.lastPathComponent,
            "work_mode": context.workMode.rawValue,
            "focus_area": context.focusArea.rawValue,
            "product_bottleneck": context.productBottleneck.rawValue,
        ], authSession: macAuthSession)

        start(allowOnboardingPrefetch: true, anchorFoundation: false)
        scanWorkspace(root: url.path)
    }

    func prepareIntakeOnlyOnboarding(context: OnboardingContext) {
        activeOnboardingWorkspacePrefetchFingerprint = nil
        onboardingContext = context
        onboardingContextStatus = .idle
        WorkspaceSettings.clear()
        Self.resetMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntakeOnlyCompleted = false
        workspaceRoot = ""
        requestedInitialBipGate = false
        requestedInitialBipMission = false
        pendingWorkspaceScanRoot = nil
        pendingWorkspaceScanProvider = nil
        attemptedStartupWorkspaceScanRecoveryRoots.removeAll()
        scanResult = nil
        pendingAgentic30GitignoreConsent = nil
        scanProgressMessage = ""
        scanProgressLogs = []
        scanProgressSnapshots = []
        clearWorkspaceScanTiming()
        lastError = nil

        if started {
            connectionLabel = "Choose a project workspace"
            isConnected = false
            stopRecorderClipboardCollector()
            selectedSessionID = nil
            sidecar.stop()
            started = false
        }

        PostHogTelemetry.capture("mac_onboarding_intake_only_prepared", properties: [
            "work_mode": context.workMode.rawValue,
            "focus_area": context.focusArea.rawValue,
            "product_bottleneck": context.productBottleneck.rawValue,
        ], authSession: macAuthSession)
    }

    private static func onboardingWorkspacePrefetchFingerprint(
        url: URL,
        context: OnboardingContext
    ) -> String {
        [
            url.standardizedFileURL.path,
            context.workMode.rawValue,
            context.focusArea.rawValue,
            context.productBottleneck.rawValue,
            context.isolationLevel.rawValue,
            context.isolationLevels.map(\.rawValue).joined(separator: ","),
        ].joined(separator: "|")
    }

    func resetMacOnboarding() {
        signOutMacAuth()
        Self.resetMacOnboardingIntroCompleted()
        Self.resetMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntroCompleted = false
        macOnboardingIntakeOnlyCompleted = false
        onboardingContext = nil
        onboardingContextStatus = .idle
        activeOnboardingWorkspacePrefetchFingerprint = nil
    }

    func completeIntakeOnlyOnboarding(openWorkspace: Bool = false) {
        Self.saveMacOnboardingIntakeOnlyCompleted()
        macOnboardingIntakeOnlyCompleted = true
        connectionLabel = "Choose a project workspace"
        isConnected = false
        if started {
            stopRecorderClipboardCollector()
            selectedSessionID = nil
            sidecar.stop()
            started = false
        }
        completeMacOnboardingIntro(openWorkspace: openWorkspace)
        PostHogTelemetry.capture("mac_onboarding_intake_only_completed", authSession: macAuthSession)
    }

    func completeMacOnboardingIntro(openWorkspace: Bool = false) {
        Self.saveMacOnboardingIntroCompleted()
        macOnboardingIntroCompleted = true
        activeOnboardingWorkspacePrefetchFingerprint = nil
        PostHogTelemetry.capture("mac_onboarding_intro_completed", properties: [
            "total_scenes": OnboardingCompletionTiming.programIntroSceneCount,
        ], authSession: macAuthSession)
        if !requiresMacOnboarding {
            ensureFoundationStarted()
        }
        if !started, canStartSidecar {
            hydrateWorkspaceRootFromSettingsIfAvailable()
            start()
        }
        if openWorkspace {
            activeSurface = .workspace
        }
    }

    func submitOnboardingContext(
        _ context: OnboardingContext,
        workspaceRoot explicitWorkspaceRoot: String? = nil,
        intakeStore: IntakeV2Store? = nil,
        sources: [IntakeSourceState] = []
    ) {
        onboardingContextStatus = .submitting
        do {
            let onboardingMemory = try persistOnboardingMemoryIfPossible(
                context: context,
                workspaceRoot: explicitWorkspaceRoot,
                intakeStore: intakeStore,
                sources: sources
            )
            IntakeV2Store.clearPersistedDraft()
            onboardingContext = context
            onboardingContextStatus = .idle
            PostHogTelemetry.capture("mac_onboarding_context_submitted", properties: [
                "has_business_description": !context.businessDescription.isEmpty,
                "has_current_stage": !context.currentStage.isEmpty,
                "has_goal": !context.goal.isEmpty,
                "work_mode": context.workMode.rawValue,
                "has_custom_work_mode": !context.customWorkMode.isEmpty,
                "focus_area": context.focusArea.rawValue,
                "product_bottleneck": context.productBottleneck.rawValue,
                "isolation_level": context.isolationLevel.rawValue,
                "isolation_levels": context.isolationLevels.map(\.rawValue).joined(separator: ","),
            ], authSession: macAuthSession)
            sendAuthContextToSidecar()
            if let onboardingMemory {
                sendOnboardingMemoryToSidecar(onboardingMemory)
            }
            if !started, canStartSidecar {
                hydrateWorkspaceRootFromSettingsIfAvailable()
                start()
            }
        } catch {
            onboardingContextStatus = .failed(error.localizedDescription)
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "submit_onboarding_context",
            ], authSession: macAuthSession)
        }
    }

    private func persistOnboardingMemoryIfPossible(
        context: OnboardingContext,
        workspaceRoot explicitWorkspaceRoot: String?,
        intakeStore: IntakeV2Store?,
        sources: [IntakeSourceState]
    ) throws -> WorkspaceOnboardingMemory? {
        let explicit = explicitWorkspaceRoot?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        let active = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines)
        let stored = WorkspaceSettings.hasExplicitWorkspace ? WorkspaceSettings.resolvedURL().path : ""
        let root = [explicit, active, stored].first { !$0.isEmpty } ?? ""
        guard !root.isEmpty else { return nil }
        let memory = WorkspaceOnboardingMemory.make(
            context: context,
            workspaceRoot: root,
            intakeStore: intakeStore,
            sources: sources
        )
        try WorkspaceMemoryStore.saveOnboardingMemory(memory)
        return memory
    }

    private enum AuthFlow {
        case notion
        case macOnboarding
    }

    private static func makeSystemAuthSession(
        url: URL,
        callbackURLScheme: String,
        presentationContextProvider: ASWebAuthenticationPresentationContextProviding,
        prefersEphemeral: Bool,
        completion: @escaping WebAuthenticationSessionCompletion
    ) -> WebAuthenticationSessionHandle {
        SystemWebAuthenticationSessionHandle(
            url: url,
            callbackURLScheme: callbackURLScheme,
            presentationContextProvider: presentationContextProvider,
            prefersEphemeral: prefersEphemeral,
            completion: completion
        )
    }

    private func presentAuthSession(url: URL, flow: AuthFlow = .notion) {
        let session = authSessionFactory(
            url,
            "agentic30",
            authPresentationContext,
            true
        ) { [weak self] callbackURL, error in
            Task { @MainActor in
                guard let self else { return }
                self.authSession = nil

                if let error = error as? ASWebAuthenticationSessionError,
                   error.code == .canceledLogin {
                    self.handleAuthSessionError("Cancelled", flow: flow)
                    return
                }
                if let error {
                    self.handleAuthSessionError(error.localizedDescription, flow: flow)
                    return
                }
                guard let callbackURL,
                      let components = URLComponents(url: callbackURL, resolvingAgainstBaseURL: false) else {
                    self.handleAuthSessionError("No callback URL received", flow: flow)
                    return
                }
                if let error = components.queryItems?.first(where: { $0.name == "error" })?.value {
                    self.handleAuthSessionError(error, flow: flow)
                    return
                }
                guard let code = components.queryItems?.first(where: { $0.name == "code" })?.value else {
                    self.handleAuthSessionError("No authorization code received", flow: flow)
                    return
                }

                switch flow {
                case .notion:
                    self.handleNotionOAuthCode(code)
                case .macOnboarding:
                    await self.exchangeMacAuthCode(code)
                }
            }
        }
        authSession = session
        activateAppForAuth()
        if !session.start() {
            authSession = nil
            handleAuthSessionError("Could not open Google sign-in. Open the workspace window and try again.", flow: flow)
        }
    }

    private func handleAuthSessionError(_ error: String, flow: AuthFlow) {
        PostHogTelemetry.captureException(
            NSError(domain: "AuthSession", code: -1, userInfo: [NSLocalizedDescriptionKey: error]),
            properties: [
                "component": "agentic_view_model",
                "operation": flow == .macOnboarding ? "mac_onboarding_auth" : "notion_auth",
            ],
            authSession: macAuthSession
        )
        switch flow {
        case .notion:
            handleNotionOAuthError(error)
        case .macOnboarding:
            macOnboardingStatus = .failed(error)
        }
    }

    private func exchangeMacAuthCode(_ code: String) async {
        macOnboardingStatus = .exchanging
        do {
            let response: MacAuthExchangeResponse = try await postJSON(
                path: "api/auth/mac/exchange",
                body: ["code": code]
            )
            let session = response.toSession()
            try KeychainHelper.saveMacAuthSession(session)
            macAuthSession = session
            macOnboardingStatus = .idle
            PostHogTelemetry.identify(authSession: session)
            PostHogTelemetry.capture("mac_google_sign_in_completed", properties: [
                "user_id": session.userId,
                "email_domain": session.email.flatMap { PostHogTelemetrySanitizer.emailDomain($0) } ?? "",
            ], authSession: session)
            if WorkspaceSettings.hasExplicitWorkspace {
                start()
                sendAuthContextToSidecar()
            }
        } catch {
            KeychainHelper.deleteMacAuthSession()
            macAuthSession = nil
            macOnboardingStatus = .failed(error.localizedDescription)
            PostHogTelemetry.captureException(error, properties: [
                "component": "agentic_view_model",
                "operation": "exchange_mac_auth_code",
            ])
        }
    }

    private func refreshMacAuthIfNeeded() {
        guard let session = macAuthSession, session.shouldRefreshSoon else {
            if WorkspaceSettings.hasExplicitWorkspace {
                start()
                sendAuthContextToSidecar()
            }
            return
        }

        Task { @MainActor in
            macOnboardingStatus = .refreshing
            do {
                let response: MacAuthExchangeResponse = try await postJSON(
                    path: "api/auth/mac/refresh",
                    body: ["refreshToken": session.refreshToken]
                )
                let refreshed = response.toSession(
                    fallbackConsent: MacAuthConsent(
                        acceptedAt: session.termsAcceptedAt,
                        termsVersion: session.termsVersion,
                        privacyVersion: session.privacyVersion
                    )
                )
                try KeychainHelper.saveMacAuthSession(refreshed)
                macAuthSession = refreshed
                macOnboardingStatus = .idle
                PostHogTelemetry.identify(authSession: refreshed)
                PostHogTelemetry.capture("mac_google_session_refreshed", properties: [
                    "user_id": refreshed.userId,
                    "email_domain": refreshed.email.flatMap { PostHogTelemetrySanitizer.emailDomain($0) } ?? "",
                ], authSession: refreshed)
                if WorkspaceSettings.hasExplicitWorkspace {
                    start()
                    sendAuthContextToSidecar()
                }
            } catch {
                KeychainHelper.deleteMacAuthSession()
                macAuthSession = nil
                macOnboardingStatus = .failed("Your session expired. Sign in again.")
                PostHogTelemetry.resetIdentity()
                PostHogTelemetry.captureException(error, properties: [
                    "component": "agentic_view_model",
                    "operation": "refresh_mac_auth",
                ])
            }
        }
    }

    private func sendAuthContextToSidecar() {
        guard isConnected else { return }
        let anonymousDistinctId = PostHogTelemetry.anonymousDistinctID()
        guard let session = macAuthSession, session.isUsable else {
            sidecar.send(payload: [
                "type": "clear_auth_context",
                "anonymousDistinctId": anonymousDistinctId,
            ])
            return
        }

        var payload: [String: Any] = [
            "type": "set_auth_context",
            "accessToken": session.accessToken,
            "refreshToken": session.refreshToken,
            "userId": session.userId,
            "webBaseUrl": MacOnboardingConstants.appBaseURL.absoluteString,
            "anonymousDistinctId": anonymousDistinctId,
        ]
        if let expiresAt = session.expiresAt {
            payload["expiresAt"] = expiresAt
        }
        if let email = session.email {
            payload["email"] = email
        }
        sidecar.send(payload: payload)
    }

    private func sendOnboardingMemoryToSidecarIfAvailable() {
        let root = workspaceRoot.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
            ? (WorkspaceSettings.hasExplicitWorkspace ? WorkspaceSettings.resolvedURL().path : "")
            : workspaceRoot
        guard let memory = WorkspaceMemoryStore.loadOnboardingMemory(workspaceRoot: root) else { return }
        sendOnboardingMemoryToSidecar(memory)
    }

    private func sendOnboardingMemoryToSidecar(_ memory: WorkspaceOnboardingMemory) {
        guard isConnected else { return }
        sidecar.send(payload: [
            "type": "onboarding_memory_save",
            "workspaceRoot": memory.workspaceRoot,
            "memory": memory.sidecarPayload,
        ])
    }

    private func postJSON<T: Decodable>(
        path: String,
        body: [String: Any]
    ) async throws -> T {
        let url = MacOnboardingConstants.appBaseURL.appending(path: path)
        var request = URLRequest(url: url)
        request.httpMethod = "POST"
        request.setValue("application/json", forHTTPHeaderField: "Content-Type")
        request.httpBody = try JSONSerialization.data(withJSONObject: body)

        let (data, response) = try await URLSession.shared.data(for: request)
        guard let httpResponse = response as? HTTPURLResponse,
              (200..<300).contains(httpResponse.statusCode) else {
            let message = String(data: data, encoding: .utf8) ?? "Request failed"
            throw NSError(
                domain: "MacAuth",
                code: (response as? HTTPURLResponse)?.statusCode ?? -1,
                userInfo: [NSLocalizedDescriptionKey: message]
            )
        }

        return try JSONDecoder().decode(T.self, from: data)
    }

    func createDocument(type: String, workspaceRoot: String) {
        guard !workspaceRoot.isEmpty else { return }
        isCreatingDoc = type
        beginLongRunningCompletionAttempt(.documentCreation, source: "create_doc", isUserVisible: true)
        docCreationLogs = []
        PostHogTelemetry.capture("mac_document_creation_requested", properties: [
            "doc_type": type,
            "workspace_basename": (workspaceRoot as NSString).lastPathComponent,
        ], authSession: macAuthSession)
        sidecar.send(payload: [
            "type": "create_doc",
            "docType": type,
            "root": workspaceRoot,
            "preferredProvider": selectedProvider.rawValue,
        ])
    }

    static func nonExceptionSidecarErrorTelemetryEvent(forErrorKind errorKind: String?) -> String? {
        switch errorKind {
        case "provider_usage_limit":
            return "mac_provider_usage_limit"
        case "provider_auth_required":
            return "mac_provider_auth_required"
        case "provider_aborted":
            return "mac_provider_aborted"
        case "sidecar_connection_state":
            return "mac_sidecar_connection_state"
        case "office_hours_no_next_question":
            return "mac_office_hours_no_next_question"
        case "office_hours_pending_state_unrecoverable":
            return "mac_office_hours_pending_state_unrecoverable"
        default:
            return nil
        }
    }

    static func shouldKeepSidecarConnected(forGlobalErrorMessage message: String?) -> Bool {
        let value = message?.trimmingCharacters(in: .whitespacesAndNewlines) ?? ""
        return value.hasPrefix("ERR_RECORDER_PIPE_RUN_CAPTURE_NOT_READY")
            || value.hasPrefix("ERR_RECORDER_PIPE_SCHEDULER_CAPTURE_NOT_READY")
    }

    private func handle(_ event: SidecarEvent) {
        switch event.type {
        case "sidecar_status":
            connectionLabel = event.message ?? connectionLabel
            isConnected = false
            stopRecorderClipboardCollector()
            integrationStatusChecking = false
            officeHoursSessionCreateInFlight = false
            PostHogTelemetry.capture("mac_sidecar_status", properties: [
                "message": event.message ?? "",
            ], authSession: macAuthSession)
        case "sidecar_unexpected_exit":
            let message = event.message ?? "실행 보조 앱이 예기치 않게 중단됐습니다."
            connectionLabel = message
            isConnected = false
            stopRecorderClipboardCollector()
            integrationStatusChecking = false
            officeHoursSessionCreateInFlight = false
            finishExaMcpConnectAfterSidecarInterruption()
            finishMcpOauthInFlightAfterSidecarInterruption(
                detail: "실행 보조 앱이 중단되어 MCP 연결 확인이 끝나지 않았어요 — 다시 시도해 주세요.",
                markFailedResult: true
            )
            markRunningSessionsRecoverableAfterSidecarExit(message: message)
            markDynamicResearchSurfacesFailedAfterSidecarExit(message: message)
            markStartupQueuedActionFailed(message)
            refreshPresentationState()
        case "request_emit":
            if let request = event.requestEmit {
                handleRequestEmit(request)
            }
        case "ready":
            if let sessions = event.sessions {
                self.sessions = sessions.sorted(by: { $0.updatedAt > $1.updatedAt })
                reconcileOfficeHoursLiveStatuses(with: self.sessions)
            }
            if let environment = event.environment {
                self.environment = environment
            }
            if let diagnostics = event.diagnostics {
                sidecarDiagnostics = diagnostics
            }
            if let recorderRawApi = event.recorderRawApi {
                recorderRawApiStatus = recorderRawApi
            }
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
            day1GoalSelection = event.day1GoalSelection
            day1SurfaceReview = event.day1SurfaceReview
            if let dp = event.dayProgress { dayProgress = dp }
            if let reviews = event.dayReviews { dayReviews = reviews }
            if let evidence = event.evidenceOS { evidenceOS = evidence }
            workspaceRoot = event.workspaceRoot ?? workspaceRoot
            notionConnected = event.notionConnected ?? false
            connectionLabel = "Connected"
            isConnected = true
            if recorderFrameCaptures.isEmpty && !recorderFrameCapturesRefreshing {
                refreshRecorderFrameCaptures()
            }
            PostHogTelemetry.capture("mac_sidecar_ready", properties: [
                "workspace_basename": ((event.workspaceRoot ?? workspaceRoot) as NSString).lastPathComponent,
                "session_count": sessions.count,
                "notion_connected": notionConnected,
            ], authSession: macAuthSession)
            ensureSelection()
            if selectedSession != nil {
                officeHoursSessionCreateInFlight = false
            }
            recordStartupSessionAppearIfNeeded(source: "ready")
            sendAuthContextToSidecar()
            sendOnboardingMemoryToSidecarIfAvailable()
            syncProviderSettingsToSidecar()
            restoreWorkspaceSurfacesFromMemory()
            refreshIntegrationStatus()
            flushPendingProjectContextRefreshIfNeeded()
            flushPendingStrategyReportRefreshIfNeeded()
            #if DEBUG
            triggerUITestingDynamicResearchRefreshIfRequested()
            #endif
            refreshPresentationState()
            requestBipReadinessCheck()
            requestInitialBipGateIfNeeded()
            flushStartupQueuedActionIfPossible()
            if let root = pendingWorkspaceScanRoot {
                pendingWorkspaceScanRoot = nil
                let provider = pendingWorkspaceScanProvider
                pendingWorkspaceScanProvider = nil
                sendWorkspaceScan(root: root, providerOverride: provider)
            } else {
                requestWorkspaceScanRecoveryIfNeeded()
            }
        case "sessions_snapshot":
            if let sessions = event.sessions {
                self.sessions = sessions.sorted(by: { $0.updatedAt > $1.updatedAt })
                reconcileOfficeHoursLiveStatuses(with: self.sessions)
                ensureSelection()
                if selectedSession != nil {
                    officeHoursSessionCreateInFlight = false
                }
                recordStartupSessionAppearIfNeeded(source: "sessions_snapshot")
                refreshPresentationState()
            }
        case "session_created":
            if let session = event.session {
                handleSessionCreated(session)
            }
        case "session_updated":
            if let session = event.session {
                upsert(session)
                pruneSentPromptPreviews(for: session)
                detectDimensionTransitionToast(in: session)
                refreshPresentationState()
                flushStartupQueuedActionIfPossible()
            }
        case "curriculum_original_question_reframed":
            applyCurriculumQuestionReframe(event)
            refreshPresentationState()
        case "idd_setup_progress":
            reconcileDay1DocHandoffProgress(from: event)
            updateStructuredPromptSubmissionProgress(from: event)
            refreshPresentationState()
        case "session_deleted":
            guard let sessionID = event.sessionId else { return }
            sessions.removeAll(where: { $0.id == sessionID })
            // Drop Foundation first-prompt idempotency markers tied to the
            // deleted session so a future re-create with the same id (or any
            // id at all) does not silently suppress re-injection.
            let prefix = "\(sessionID):day-"
            injectedFoundationFirstPromptKeys = injectedFoundationFirstPromptKeys.filter { !$0.hasPrefix(prefix) }
            pendingFoundationFirstPromptKeys = pendingFoundationFirstPromptKeys.filter { !$0.hasPrefix(prefix) }
            if selectedSessionID == sessionID {
                selectedSessionID = sessions.first(where: { $0.archivedAt == nil })?.id
            }
            createReplacementSessionIfNeeded(source: "delete_last_visible_session")
            refreshPresentationState()
        case "message_delta":
            guard let sessionID = event.sessionId,
                  let messageID = event.messageId,
                  let delta = event.delta else { return }
            updateMessage(sessionID: sessionID, messageID: messageID) { message in
                message.content += delta
                message.state = .streaming
            }
            refreshPresentationState()
        case "message_replaced":
            guard let sessionID = event.sessionId,
                  let messageID = event.messageId,
                  let content = event.content else { return }
            updateMessage(sessionID: sessionID, messageID: messageID) { message in
                message.content = content
                message.state = event.state ?? .final
            }
            refreshPresentationState()
        case "foundation_first_prompt":
            // Sub-AC 2.4: AI-driven Foundation Day 0/2-7 first prompt arrives
            // here; inject as the seeded assistant opener for the matching
            // session. Idempotent + persistence-safe via deterministic ID.
            handleFoundationFirstPromptEvent(event)
        case "office_hours_source_gate":
            if let gate = event.officeHoursSourceGate {
                officeHoursSourceGate = gate
                if gate.blocking {
                    lastError = gate.message
                    officeHoursDailyDigestCollecting = false
                }
            }
        case "office_hours_daily_digest_result":
            if let digest = event.officeHoursDailyDigest {
                officeHoursDailyDigest = digest
                officeHoursDailyDigestCollecting = false
            } else if event.status == "collecting" {
                officeHoursDailyDigestCollecting = true
            } else {
                // Fail-soft decode: a result event whose digest payload didn't
                // decode still ends the collecting state.
                officeHoursDailyDigestCollecting = false
            }
        case "office_hours_commitment_candidates":
            guard let sessionID = event.sessionId, !sessionID.isEmpty else { return }
            if event.status == "generating" {
                officeHoursCommitmentCandidatesGenerating.insert(sessionID)
            } else {
                // "ready" (the only other status) always ends the loader, even with an
                // empty list — the bar then falls back to its local suggestions/직접 적기.
                officeHoursCommitmentCandidatesGenerating.remove(sessionID)
                officeHoursCommitmentCandidatesBySession[sessionID] = event.commitmentCandidates ?? []
            }
        case "office_hours_status":
            applyOfficeHoursLiveStatus(from: event)
            // Any run-terminal stage also ends digest collection — covers failure
            // paths that never deliver a "ready" digest.
            if let stage = event.stage,
               ["question_ready", "completed", "failed", "aborted"].contains(stage) {
                officeHoursDailyDigestCollecting = false
            }
            refreshPresentationState()
        case "tool_event":
            guard let sessionID = event.sessionId else { return }
            appendSidecarOutput(sessionID: sessionID, event: event)
            refreshPresentationState()
        case "agent_event":
            guard let sessionID = event.sessionId else { return }
            appendSidecarOutput(sessionID: sessionID, event: event)
            refreshPresentationState()
        case "workspace_scan_started":
            beginWorkspaceScanTiming()
            isScanning = true
            setScanProgress(
                event.progressText ?? "Preparing workspace scan...",
                reset: true,
                stage: event.stage,
                stepIndex: event.stepIndex,
                totalSteps: event.totalSteps,
                etaSeconds: event.etaSeconds,
                foundCount: event.foundCount,
                elapsedMs: event.elapsedMs
            )
            scanResult = nil
            day1SurfaceReview = nil
            day1SurfaceReviewGenerating = false
            day1SurfaceReviewDecisionPending = nil
            day1SurfaceReviewError = nil
            scanProviderLimitNotice = nil
            scanBlockedNotice = nil
            pendingAgentic30GitignoreConsent = nil
        case "workspace_scan_provider_limited":
            if let raw = event.provider,
               let provider = AgentProvider(rawValue: raw) {
                scanProviderLimitNotice = ScanProviderLimitNotice(
                    scanRoot: event.scanRoot ?? "",
                    provider: provider,
                    stage: event.stage ?? ""
                )
            }
        case "workspace_scan_blocked":
            finishWorkspaceScanTiming()
            isScanning = false
            if event.reason == "insufficient_evidence" || event.day1AlignmentPlan != nil {
                scanResult = WorkspaceScanResult(
                    icp: event.icp,
                    spec: event.spec,
                    values: event.values,
                    designSystem: event.designSystem,
                    adr: event.adr,
                    goal: event.goal,
                    docs: event.docs,
                    sheet: event.sheet,
                    onboardingHypothesis: event.onboardingHypothesis,
                    day1AlignmentPlan: event.day1AlignmentPlan,
                    day1IcpPlan: event.day1IcpPlan,
                    day1SituationSummary: event.day1SituationSummary,
                    day1GoalSelection: event.day1GoalSelection,
                    agentic30Gitignore: event.agentic30Gitignore,
                    foundCount: event.foundCount,
                    error: event.error
                )
            } else {
                scanResult = nil
                clearWorkspaceScanResultCache(root: event.scanRoot)
            }
            scanProviderLimitNotice = nil
            pendingAgentic30GitignoreConsent = nil
            let provider = event.provider.flatMap(AgentProvider.init(rawValue:)) ?? selectedProvider
            let nextProvider = event.nextProvider.flatMap(AgentProvider.init(rawValue:))
            let availableProviders = (event.availableProviders ?? [])
                .compactMap(AgentProvider.init(rawValue:))
            let providerReadiness = event.providerReadiness ?? []
            let message = event.message?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                ?? "AI 검증을 완료하지 못했습니다."
            scanBlockedNotice = WorkspaceScanBlockedNotice(
                scanRoot: event.scanRoot ?? workspaceRoot,
                provider: provider,
                model: event.model ?? "",
                reason: event.reason ?? "",
                message: message,
                nextProvider: nextProvider,
                availableProviders: availableProviders,
                providerReadiness: providerReadiness,
                errorKind: event.errorKind,
                abortCause: event.abortCause,
                retryAttempt: event.retryAttempt
            )
            setScanProgress(
                "Workspace scan blocked.",
                stage: event.stage ?? "blocked",
                stepIndex: event.stepIndex ?? 2,
                totalSteps: event.totalSteps ?? 3,
                etaSeconds: nil,
                foundCount: event.foundCount,
                elapsedMs: event.elapsedMs
            )
            let properties: [String: Any] = [
                "workspace_basename": ((event.scanRoot ?? workspaceRoot) as NSString).lastPathComponent,
                "provider": provider.rawValue,
                "model": event.model ?? "",
                "reason": event.reason ?? "",
                "error_kind": event.errorKind ?? "",
                "next_provider": nextProvider?.rawValue ?? "",
                "available_providers": availableProviders.map(\.rawValue),
                "installed_providers": providerReadiness.filter(\.sdkInstalled).map(\.provider.rawValue),
                "scan_ready_providers": providerReadiness.filter(\.scanReady).map(\.provider.rawValue),
                "auth_required_providers": providerReadiness.filter { $0.sdkInstalled && !$0.authenticated }.map(\.provider.rawValue),
                "provider_readiness": providerReadiness.map(\.telemetryProperties),
                "failure_detail": message,
            ]
            PostHogTelemetry.capture(
                "mac_workspace_scan_blocked",
                properties: properties,
                authSession: macAuthSession
            )
            PostHogTelemetry.captureLog(
                "workspace scan blocked",
                level: .error,
                properties: properties,
                authSession: macAuthSession
            )
            if event.reason == "error" {
                PostHogTelemetry.captureException(
                    NSError(domain: "WorkspaceScan", code: -1, userInfo: [
                        NSLocalizedDescriptionKey: message
                    ]),
                    properties: properties,
                    authSession: macAuthSession
                )
            }
            completeLongRunningCompletionAttempt(
                .workspaceScan,
                outcome: .blocked,
                detail: message
            )
        case "workspace_scan_progress":
            // Background Day 1 enrichment can report late progress after the
            // foreground scan result. Do not reopen the scan gate unless a new
            // workspace_scan_started event has reset the result first.
            if scanResult == nil {
                isScanning = true
            }
            setScanProgress(
                event.progressText ?? scanProgressMessage,
                stage: event.stage,
                stepIndex: event.stepIndex,
                totalSteps: event.totalSteps,
                etaSeconds: event.etaSeconds,
                foundCount: event.foundCount,
                elapsedMs: event.elapsedMs
            )
        case "workspace_scan_result":
            finishWorkspaceScanTiming()
            isScanning = false
            setScanProgress(
                event.error == nil ? "Workspace scan complete." : "Workspace scan failed.",
                stage: event.stage ?? (event.error == nil ? "merged" : "failed"),
                stepIndex: event.stepIndex ?? 3,
                totalSteps: event.totalSteps ?? 3,
                etaSeconds: event.etaSeconds,
                foundCount: event.foundCount,
                elapsedMs: event.elapsedMs
            )
            let result = WorkspaceScanResult(
                icp: event.icp,
                spec: event.spec,
                values: event.values,
                designSystem: event.designSystem,
                adr: event.adr,
                goal: event.goal,
                docs: event.docs,
                sheet: event.sheet,
                onboardingHypothesis: event.onboardingHypothesis,
                day1AlignmentPlan: event.day1AlignmentPlan,
                day1IcpPlan: event.day1IcpPlan,
                day1SituationSummary: event.day1SituationSummary,
                day1GoalSelection: event.day1GoalSelection,
                agentic30Gitignore: event.agentic30Gitignore,
                foundCount: event.foundCount,
                error: event.error
            )
            scanResult = result
            scanBlockedNotice = nil
            pendingAgentic30GitignoreConsent = event.agentic30Gitignore?.needsConsent == true
                ? event.agentic30Gitignore
                : nil
            day1GoalSelection = event.day1GoalSelection
            if let dp = event.dayProgress { dayProgress = dp }
            if let reviews = event.dayReviews { dayReviews = reviews }
            if let evidence = event.evidenceOS { evidenceOS = evidence }
            persistWorkspaceScanResult(event)
            persistWorkspaceScanResultCache(result, root: event.scanRoot)
            if let error = event.error {
                clearWorkspaceScanResultCache(root: event.scanRoot)
                let properties: [String: Any] = [
                    "workspace_basename": ((event.scanRoot ?? workspaceRoot) as NSString).lastPathComponent,
                    "stage": event.stage ?? "failed",
                    "step_index": event.stepIndex ?? 3,
                    "total_steps": event.totalSteps ?? 3,
                    "found_count": event.foundCount ?? 0,
                    "failure_detail": error,
                ]
                PostHogTelemetry.capture(
                    "mac_workspace_scan_failed",
                    properties: properties,
                    authSession: macAuthSession
                )
                PostHogTelemetry.captureLog(
                    "workspace scan failed",
                    level: .error,
                    properties: properties,
                    authSession: macAuthSession
                )
                PostHogTelemetry.captureException(
                    NSError(domain: "WorkspaceScan", code: -1, userInfo: [
                        NSLocalizedDescriptionKey: error
                    ]),
                    properties: properties,
                    authSession: macAuthSession
                )
            }
            if let error = event.error {
                completeLongRunningCompletionAttempt(
                    .workspaceScan,
                    outcome: .failed,
                    detail: error
                )
            } else {
                // Drive the host telemetry gate's scan-success signal. Without
                // this the gate's `didScanSucceed` stays false forever, so every
                // `workspace_setup_completed` envelope the sidecar emits is held
                // in `pendingCompleted` and never captured — activation reads 0
                // regardless of whether the user actually finished setup.
                markWorkspaceSetupScanSucceeded()
                completeLongRunningCompletionAttempt(
                    .workspaceScan,
                    outcome: .success,
                    detail: "워크스페이스 분석이 끝났고 Day 1을 이어갈 수 있어요."
                )
            }
        case "day1_goal_state":
            if event.success == false {
                day1GoalError = event.error ?? event.message ?? "Day 1 목표를 저장하지 못했습니다."
                return
            }
            day1GoalError = nil
            day1GoalSelection = event.day1GoalSelection
            if let current = scanResult {
                let updated = current.withDay1GoalSelection(event.day1GoalSelection)
                scanResult = updated
                persistWorkspaceScanResultCache(updated, root: event.workspaceRoot ?? event.scanRoot)
            }
        case "day1_surface_review_state":
            day1SurfaceReviewGenerating = false
            day1SurfaceReviewDecisionPending = nil
            if event.success == false {
                day1SurfaceReviewError = event.error ?? event.message ?? "처음 보여줄 문장을 만들지 못했습니다."
                return
            }
            day1SurfaceReviewError = nil
            if let review = event.day1SurfaceReview {
                day1SurfaceReview = review
            }
        case "workspace_gitignore_result":
            pendingAgentic30GitignoreConsent = nil
            guard let gitignore = event.agentic30Gitignore,
                  let current = scanResult else { return }
            let updated = WorkspaceScanResult(
                icp: current.icp,
                spec: current.spec,
                values: current.values,
                designSystem: current.designSystem,
                adr: current.adr,
                goal: current.goal,
                docs: current.docs,
                sheet: current.sheet,
                onboardingHypothesis: current.onboardingHypothesis,
                day1AlignmentPlan: current.day1AlignmentPlan,
                day1IcpPlan: current.day1IcpPlan,
                day1SituationSummary: current.day1SituationSummary,
                day1GoalSelection: current.day1GoalSelection,
                agentic30Gitignore: gitignore,
                foundCount: current.foundCount,
                error: current.error
            )
            scanResult = updated
            persistWorkspaceScanResultCache(updated, root: gitignore.scanRoot ?? event.scanRoot)
        case "day_progress_state":
            if event.success == false { return }
            if let dp = event.dayProgress { dayProgress = dp }
            if let reviews = event.dayReviews { dayReviews = reviews }
            if let memory = event.officeHoursMemory { officeHoursMemory = memory }
            if let history = event.officeHoursHistory { officeHoursHistory = history }
            if let evidence = event.evidenceOS { evidenceOS = evidence }
            if let policy = event.dayClosePolicy { dayClosePolicy = policy }
            // Interview gate: surface the soft nudge when a close was withheld; clear it on
            // any non-blocked update so it disappears once the founder commits or confesses.
            if event.needsCommitment == true {
                commitmentGateMessage = event.message
                    ?? "이 인터뷰를 닫기 전에 다음 한 가지 고객 행동을 약속해줘. 정 못 하면 그 이유를 남겨도 통과돼."
                commitmentGateStep = event.gatedStep
            } else {
                commitmentGateMessage = nil
                commitmentGateStep = nil
            }
            // Milestone gate: surface the hard block when a day patch was withheld;
            // clear it on any non-blocked update (mirrors the interview-gate nudge).
            if let gate = event.gateBlocked {
                dayGateBlocked = gate
                dayGateBlockedMessage = event.message
            } else {
                dayGateBlocked = nil
                dayGateBlockedMessage = nil
            }
        case "recorder_pipes_state":
            if let pipes = event.pipes {
                recorderPipes = pipes
            }
            if let runs = event.runs {
                replaceRecorderPipeRuns(runs)
            }
            if let scheduler = event.scheduler {
                recorderPipeLastSchedulerResult = scheduler
            }
            recorderPipesRefreshing = false
            recorderPipeLastError = nil
        case "recorder_raw_api_status":
            if let recorderRawApi = event.recorderRawApi {
                recorderRawApiStatus = recorderRawApi
            }
        case "recorder_raw_api_token_issued":
            handleRecorderRawApiTokenIssued(event)
        case "recorder_audit_events":
            if let recorderAuditSource = event.recorderAuditSource {
                self.recorderAuditSource = recorderAuditSource
            }
            recorderAuditRefreshing = false
            recorderAuditLastError = nil
        case "recorder_mcp_grants":
            replaceRecorderMcpGrants(event.recorderMcpGrants ?? [])
            recorderMcpGrantsRefreshing = false
            recorderMcpGrantActionInFlight = nil
            recorderMcpGrantLastError = nil
        case "recorder_mcp_grant_created", "recorder_mcp_grant_revoked":
            if let grant = event.recorderMcpGrant {
                upsertRecorderMcpGrant(grant)
            }
            recorderMcpGrantsRefreshing = false
            recorderMcpGrantActionInFlight = nil
            recorderMcpGrantLastError = nil
        case "recorder_control_state":
            if let controlState = event.controlState {
                recorderControlState = controlState
            }
            if let readiness = event.readiness {
                recorderCaptureReadiness = readiness
            }
            reconcileRecorderAutoCaptureWithReadiness()
            reconcileRecorderClipboardCollectorWithControlState()
            reconcileRecorderAudioCollectorsWithControlState()
            recorderControlRefreshing = false
            recorderControlActionInFlight = nil
            recorderControlLastError = nil
        case "recorder_frame_capture_ingested":
            if let frame = event.frame {
                recorderLastFrameCapture = frame
                upsertRecorderFrameCapture(frame)
            }
            recorderFrameCaptureInFlight = false
            recorderFrameCaptureLastError = nil
            if recorderAutoCaptureRunning {
                recorderAutoCaptureLastError = nil
            }
        case "recorder_audio_chunk_recorded":
            recorderAudioChunkInFlight = false
            recorderMicrophoneAudioChunkInFlight = false
            recorderSystemAudioChunkInFlight = false
            recorderAudioCaptureLastError = nil
            updateRecorderAudioCaptureRunning()
        case "recorder_frame_captures":
            if let frames = event.frames {
                replaceRecorderFrameCaptures(frames)
            }
            recorderFrameCapturesRefreshing = false
            recorderFrameCapturesLastError = nil
        case "recorder_frame_capture_deleted":
            if let deletion = event.deletion {
                recorderLastFrameDelete = deletion
                if recorderLastFrameCapture?.id == deletion.frameId {
                    recorderLastFrameCapture = nil
                }
                removeRecorderFrameCapture(id: deletion.frameId)
            }
            recorderFrameDeleteInFlight = false
            recorderFrameDeleteLastError = nil
        case "recorder_frame_captures_deleted":
            if let deletionRange = event.deletionRange {
                recorderLastFrameRangeDelete = deletionRange
                if let lastID = recorderLastFrameCapture?.id,
                   deletionRange.frameIds.contains(lastID) {
                    recorderLastFrameCapture = nil
                }
                for frameId in deletionRange.frameIds {
                    removeRecorderFrameCapture(id: frameId)
                }
            }
            recorderFrameDeleteInFlight = false
            recorderFrameDeleteLastError = nil
        case "recorder_pipe_run_result", "recorder_pipe_cancel_result":
            if let run = event.pipeRun {
                recorderPipeActionInFlight.remove(run.pipeId)
                recorderPipeActionInFlight.remove(run.id)
                upsertRecorderPipeRun(run)
            }
            if let runs = event.runs {
                replaceRecorderPipeRuns(runs)
            }
            recorderPipeLastError = nil
        case "recorder_pipe_scheduler_tick_result":
            recorderPipeSchedulerRunning = false
            recorderPipeLastSchedulerResult = event.scheduler ?? event.enqueueResult ?? event.drainResult
            if let runs = event.runs {
                replaceRecorderPipeRuns(runs)
            }
            if let failedCount = recorderPipeLastSchedulerResult?.failedCount,
               failedCount > 0 {
                recorderPipeLastError = "Pipe 스케줄러 실행 중 \(failedCount)개 작업이 실패했습니다."
            } else {
                recorderPipeLastError = nil
            }
        case "recorder_day_memory_loop_result":
            if let dayLoop = event.recorderDayLoop {
                recorderDayMemoryLoop = dayLoop
            }
            recorderDayMemoryLoopRunning = false
            recorderDayMemoryLoopLastError = nil
        case "recorder_evidence_candidate_review_result":
            if let dayLoop = event.recorderDayLoop {
                recorderDayMemoryLoop = dayLoop
            }
            let reviewResult = RecorderEvidenceCandidateReviewResult(event: event)
            if let reviewResult {
                recorderLastEvidenceCandidateReviewResult = reviewResult
            }
            if let candidate = event.recorderEvidenceCandidate {
                recorderEvidenceCandidateReviewInFlight.remove(candidate.id)
            } else if let candidateId = reviewResult?.candidateId, !candidateId.isEmpty {
                recorderEvidenceCandidateReviewInFlight.remove(candidateId)
            } else {
                recorderEvidenceCandidateReviewInFlight.removeAll()
            }
            recorderDayMemoryLoopLastError = nil
        case "recorder_retention_result":
            recorderRetentionApplyRunning = false
            recorderRetentionLastResult = event.recorderRetentionResult
            recorderRetentionLastError = nil
        case "program_notification_schedule":
            if event.success == false {
                PostHogTelemetry.captureLog(
                    "program notification schedule failed",
                    level: .error,
                    properties: [
                        "error": event.error ?? event.message ?? "",
                    ],
                    authSession: macAuthSession
                )
                return
            }
            if let schedule = event.programNotificationSchedule {
                syncProgramNotificationSchedule(schedule)
            }
        case "mission_card":
            if let card = event.missionCard {
                if let dailyCard = card.dailyCard {
                    executionMissionCard = nil
                    upsertDailyCard(dailyCard)
                } else {
                    executionMissionCard = card
                    dailyCards = []
                }
            }
        case "office_hours_intervention_required":
            if let intervention = event.intervention {
                ohInterventionRequired = intervention
            }
        case "doc_creation_started":
            isCreatingDoc = event.docType
            docCreationLogs = []
        case "doc_creation_progress":
            if let text = event.progressText {
                docCreationLogs.append(text)
            }
        case "doc_creation_result":
            isCreatingDoc = nil
            docCreationLogs = []
            if let docPath = event.docPath, let docType = event.docType {
                lastDocCreated = (type: docType, path: docPath)
                PostHogTelemetry.capture("mac_document_creation_completed", properties: [
                    "doc_type": docType,
                    "doc_path": docPath,
                ], authSession: macAuthSession)
            }
            if let error = event.error {
                lastError = error
                if let telemetryEvent = Self.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: event.errorKind) {
                    PostHogTelemetry.capture(
                        telemetryEvent,
                        properties: [
                            "component": "agentic_view_model",
                            "operation": "document_creation",
                            "doc_type": event.docType ?? "",
                            "error_kind": event.errorKind ?? "",
                            "provider": event.provider ?? "",
                        ],
                        authSession: macAuthSession
                    )
                } else {
                    PostHogTelemetry.captureException(
                        NSError(domain: "DocumentCreation", code: -1, userInfo: [NSLocalizedDescriptionKey: error]),
                        properties: [
                            "component": "agentic_view_model",
                            "operation": "document_creation",
                            "doc_type": event.docType ?? "",
                        ],
                        authSession: macAuthSession
                    )
                }
            }
            if let error = event.error {
                completeLongRunningCompletionAttempt(
                    .documentCreation,
                    outcome: .failed,
                    docPath: event.docPath,
                    detail: error
                )
            } else {
                completeLongRunningCompletionAttempt(
                    .documentCreation,
                    outcome: .success,
                    docPath: event.docPath
                )
            }
        case "workspace_day1_alignment_plan_result", "workspace_day1_icp_plan_result":
            if event.day1AlignmentPlan != nil || event.day1IcpPlan != nil {
                isScanning = false
                if event.day1AlignmentPlan?.source == "frontier_ensemble"
                    || event.day1AlignmentPlan?.source == "frontier_single" {
                    setScanProgress(
                        "frontier 선택지 생성 완료",
                        stage: "merged",
                        stepIndex: 3,
                        totalSteps: 3,
                        foundCount: event.foundCount
                    )
                }
                let result: WorkspaceScanResult
                if let current = scanResult {
                    result = current.replacing(
                        day1AlignmentPlan: event.day1AlignmentPlan,
                        day1IcpPlan: event.day1IcpPlan
                    )
                } else {
                    result = WorkspaceScanResult(
                        icp: nil,
                        spec: nil,
                        values: nil,
                        designSystem: nil,
                        adr: nil,
                        goal: nil,
                        docs: nil,
                        sheet: nil,
                        onboardingHypothesis: nil,
                        day1AlignmentPlan: event.day1AlignmentPlan,
                        day1IcpPlan: event.day1IcpPlan,
                        day1SituationSummary: event.day1SituationSummary,
                        day1GoalSelection: event.day1GoalSelection,
                        agentic30Gitignore: event.agentic30Gitignore,
                        foundCount: event.foundCount,
                        error: nil
                    )
                }
                scanResult = result
                persistWorkspaceScanResultCache(result, root: event.scanRoot)
            }
        case "news_market_radar_result":
            if let snapshot = event.newsMarketRadar {
                newsMarketRadarPreparingForDisplay = false
                newsMarketRadar = snapshot
                if let outcome = longRunningCompletionOutcome(
                    for: snapshot.status.state,
                    error: snapshot.status.error
                ) {
                    completeLongRunningCompletionAttempt(
                        .newsMarketRadar,
                        outcome: outcome,
                        detail: outcome == .success ? newsMarketRadarNotificationDetail(snapshot) : snapshot.status.error
                    )
                }
            }
        case "news_market_radar_status":
            if let status = event.newsMarketRadarStatus {
                newsMarketRadarPreparingForDisplay = false
                if longRunningCompletionStateIsRunning(status.state) {
                    beginLongRunningCompletionAttemptFromDisplayInterestIfNeeded(
                        .newsMarketRadar,
                        source: status.reason ?? "display"
                    )
                }
                applyNewsMarketRadarStatus(status)
                if let outcome = longRunningCompletionOutcome(for: status.state, error: status.error) {
                    completeLongRunningCompletionAttempt(
                        .newsMarketRadar,
                        outcome: outcome,
                        detail: outcome == .success ? newsMarketRadarNotificationDetail(newsMarketRadar) : status.error
                    )
                }
            }
        case "strategy_report_result":
            if let snapshot = event.strategyReport {
                strategyReportPreparingForDisplay = false
                strategyReportDynamicActivated = snapshot.hasReport || strategyReportDynamicActivated
                strategyReport = snapshot
                if let outcome = longRunningCompletionOutcome(
                    for: snapshot.status.state,
                    error: snapshot.status.error
                ) {
                    completeLongRunningCompletionAttempt(
                        .strategyReport,
                        outcome: outcome,
                        detail: outcome == .success ? strategyReportNotificationDetail(snapshot) : snapshot.status.error
                    )
                }
            }
        case "strategy_report_status":
            if let status = event.strategyReportStatus {
                strategyReportPreparingForDisplay = false
                strategyReportDynamicActivated = true
                if longRunningCompletionStateIsRunning(status.state) {
                    beginLongRunningCompletionAttemptFromDisplayInterestIfNeeded(
                        .strategyReport,
                        source: status.reason ?? "display"
                    )
                }
                strategyReport = StrategyReportSnapshot(
                    schemaVersion: strategyReport.schemaVersion,
                    promptProfile: strategyReport.promptProfile,
                    contentLocale: strategyReport.contentLocale,
                    generatedAt: strategyReport.generatedAt,
                    nextRefreshAfter: strategyReport.nextRefreshAfter,
                    contextFingerprint: strategyReport.contextFingerprint,
                    status: StrategyReportStatus(
                        state: status.state,
                        lastSuccessAt: status.lastSuccessAt ?? strategyReport.status.lastSuccessAt,
                        stale: status.stale ?? strategyReport.status.stale,
                        error: status.error ?? strategyReport.status.error,
                        reason: status.reason,
                        researchSource: status.researchSource ?? strategyReport.status.researchSource,
                        stage: status.stage ?? strategyReport.status.stage,
                        progressText: status.progressText ?? strategyReport.status.progressText,
                        elapsedMs: status.elapsedMs ?? strategyReport.status.elapsedMs,
                        stepIndex: status.stepIndex ?? strategyReport.status.stepIndex,
                        stepCount: status.stepCount ?? strategyReport.status.stepCount,
                        partialFailures: status.partialFailures ?? strategyReport.status.partialFailures,
                        startedAt: status.startedAt ?? strategyReport.status.startedAt,
                        completedAt: status.completedAt ?? strategyReport.status.completedAt,
                        durationMs: status.durationMs ?? strategyReport.status.durationMs
                    ),
                    workspaceEvidenceRefs: strategyReport.workspaceEvidenceRefs,
                    report: strategyReport.report
                )
                if let outcome = longRunningCompletionOutcome(for: status.state, error: status.error) {
                    completeLongRunningCompletionAttempt(
                        .strategyReport,
                        outcome: outcome,
                        detail: outcome == .success ? strategyReportNotificationDetail(strategyReport) : status.error
                    )
                }
            }
        case "work_history_result":
            if let snapshot = event.workHistory {
                workHistory = snapshot
                if let outcome = longRunningCompletionOutcome(
                    for: snapshot.status.state,
                    error: snapshot.status.error
                ) {
                    completeLongRunningCompletionAttempt(
                        .workHistory,
                        outcome: outcome,
                        detail: outcome == .success ? workHistoryNotificationDetail(snapshot) : snapshot.status.error
                    )
                }
            }
        case "work_history_status":
            if let status = event.workHistoryStatus {
                if longRunningCompletionStateIsRunning(status.state) {
                    beginLongRunningCompletionAttemptFromDisplayInterestIfNeeded(
                        .workHistory,
                        source: status.reason ?? "display"
                    )
                }
                workHistory = workHistory.applying(status: status)
                if let outcome = longRunningCompletionOutcome(for: status.state, error: status.error) {
                    completeLongRunningCompletionAttempt(
                        .workHistory,
                        outcome: outcome,
                        detail: outcome == .success ? workHistoryNotificationDetail(workHistory) : status.error
                    )
                }
            }
        case "morning_briefing_result":
            let topLevelStatus = event.morningBriefingStatus
            let topLevelFailed = topLevelStatus?.state == "failed"
            if let topLevelStatus {
                morningBriefingStatus = topLevelStatus
            }
            if let briefing = event.morningBriefing {
                let timedBriefing = morningBriefing(briefing, applying: topLevelStatus)
                if topLevelFailed {
                    var staleBriefing = timedBriefing
                    staleBriefing.status = MorningBriefingStatus(
                        state: "failed",
                        detail: topLevelStatus?.detail ?? timedBriefing.status?.detail ?? "브리핑 갱신에 실패해 이전 결과를 표시 중입니다.",
                        reason: topLevelStatus?.reason ?? timedBriefing.status?.reason,
                        runId: topLevelStatus?.runId ?? timedBriefing.status?.runId,
                        snapshot: topLevelStatus?.snapshot ?? timedBriefing.status?.snapshot,
                        elapsedMs: topLevelStatus?.elapsedMs ?? timedBriefing.status?.elapsedMs,
                        durationMs: topLevelStatus?.durationMs ?? timedBriefing.status?.durationMs,
                        failedSources: topLevelStatus?.failedSources ?? timedBriefing.status?.failedSources
                    )
                    morningBriefing = staleBriefing
                    morningBriefingStatus = staleBriefing.status
                } else {
                    morningBriefing = timedBriefing
                    morningBriefingStatus = timedBriefing.status ?? topLevelStatus
                }
            }
            if let previous = event.morningBriefingPrevious {
                morningBriefingPrevious = previous
            }
            let completion = MorningBriefingCompletionClassifier.classify(
                topLevelStatus: topLevelStatus,
                briefing: event.morningBriefing
            )
            if completion.isCollectingSnapshot {
                morningBriefingCollecting = true
                return
            }
            morningBriefingCollecting = false
            // 수집 종료: 카드별 진행 잔상을 지운다 — 완성 데이터가 자리를 대체.
            morningBriefingSourceProgress.removeAll()
            if let outcome = completion.outcome {
                completeLongRunningCompletionAttempt(
                    .morningBriefing,
                    outcome: outcome,
                    detail: completion.detail
                )
            }
        case "morning_briefing_status":
            let status = event.morningBriefingStatus
            morningBriefingStatus = mergedMorningBriefingStatus(
                from: morningBriefingStatus,
                applying: status
            )
            morningBriefingCollecting = status?.state == "collecting"
            if let status, status.state == "collecting",
               var currentBriefing = morningBriefing {
                currentBriefing.status = mergedMorningBriefingStatus(
                    from: currentBriefing.status,
                    applying: status
                )
                morningBriefing = currentBriefing
            }
            if status?.state == "failed" {
                morningBriefingSourceProgress.removeAll()
                if var staleBriefing = morningBriefing {
                    staleBriefing.status = MorningBriefingStatus(
                        state: "failed",
                        detail: status?.detail ?? "브리핑 갱신에 실패해 이전 결과를 표시 중입니다.",
                        reason: status?.reason ?? staleBriefing.status?.reason,
                        runId: status?.runId ?? staleBriefing.status?.runId,
                        snapshot: status?.snapshot ?? staleBriefing.status?.snapshot,
                        elapsedMs: status?.elapsedMs ?? staleBriefing.status?.elapsedMs,
                        durationMs: status?.durationMs ?? staleBriefing.status?.durationMs,
                        failedSources: status?.failedSources ?? staleBriefing.status?.failedSources
                    )
                    morningBriefing = staleBriefing
                    morningBriefingStatus = staleBriefing.status
                }
                completeLongRunningCompletionAttempt(
                    .morningBriefing,
                    outcome: .failed,
                    detail: status?.detail
                )
            }
            if longRunningCompletionStateIsRunning(status?.state) {
                beginLongRunningCompletionAttemptFromDisplayInterestIfNeeded(
                    .morningBriefing,
                    source: "display"
                )
            }
        case "morning_briefing_progress":
            if let cards = event.morningBriefingProgress?.cards {
                morningBriefingSourceProgress = Dictionary(
                    cards.map { ($0.id, $0) },
                    uniquingKeysWith: { _, latest in latest }
                )
            }
        case "integration_status_result":
            integrationStatus = event.integrationStatus
            integrationStatusChecking = false
            reportIntegrationStatusTelemetry(event.integrationStatus)
        case "exa_mcp_connect_result":
            exaMcpConnecting = false
            if let result = event.exaMcpConnect {
                exaMcpConnectResult = result
                persistValidatedExaApiKeyIfNeeded(result)
                reportExaMcpConnectTelemetry(exaMcpConnectResult)
            } else {
                pendingExaMcpApiKeyForStorage = nil
            }
            if let snapshot = event.integrationStatus {
                integrationStatus = snapshot
            }
        case "mcp_oauth_connect_status":
            // Live prewarm progress: caption text + auto-open the OAuth login
            // URL once when the sidecar asks the app to present it.
            if let update = event.mcpOauthConnect, let server = update.server, !server.isEmpty {
                if let detail = update.detail, !detail.isEmpty {
                    mcpOauthProgress[server] = detail
                }
                let shouldOpenBrowser = update.openBrowser ?? true
                if shouldOpenBrowser,
                   let loginUrl = update.loginUrl,
                   !loginUrl.isEmpty,
                   !mcpOauthOpenedLoginUrls.contains(loginUrl),
                   let url = URL(string: loginUrl) {
                    mcpOauthOpenedLoginUrls.insert(loginUrl)
                    NSWorkspace.shared.open(url)
                }
            }
        case "mcp_oauth_connect_result":
            if let result = event.mcpOauthConnect, let server = result.server, !server.isEmpty {
                mcpOauthResults[server] = result
                mcpOauthConnecting.remove(server)
                mcpOauthProgress.removeValue(forKey: server)
                reportMcpOauthConnectTelemetry(result)
                maybePostMcpOauthConnectedNotification(for: result)
            } else {
                mcpOauthConnecting.removeAll()
                mcpOauthProgress.removeAll()
            }
            if let snapshot = event.integrationStatus {
                integrationStatus = snapshot
            }
        case "bip_research_result":
            if let snapshot = event.bipResearch {
                bipResearch = snapshot
                if let outcome = longRunningCompletionOutcome(
                    for: snapshot.status.state,
                    error: snapshot.status.error
                ) {
                    completeLongRunningCompletionAttempt(
                        .bipResearch,
                        outcome: outcome,
                        detail: outcome == .success ? bipResearchNotificationDetail(snapshot) : snapshot.status.error
                    )
                }
            }
        case "bip_research_status":
            if let status = event.bipResearchStatus {
                if longRunningCompletionStateIsRunning(status.state) {
                    beginLongRunningCompletionAttemptFromDisplayInterestIfNeeded(
                        .bipResearch,
                        source: status.reason ?? "display"
                    )
                }
                bipResearch = BipResearchSnapshot(
                    schemaVersion: bipResearch.schemaVersion,
                    contentLocale: bipResearch.contentLocale,
                    promptProfile: bipResearch.promptProfile,
                    contextFingerprint: bipResearch.contextFingerprint,
                    generatedAt: bipResearch.generatedAt,
                    nextRefreshAfter: bipResearch.nextRefreshAfter,
                    dayNumber: bipResearch.dayNumber,
                    dayTitle: bipResearch.dayTitle,
                    dayPhase: bipResearch.dayPhase,
                    status: BipResearchStatus(
                        state: status.state,
                        lastSuccessAt: status.lastSuccessAt ?? bipResearch.status.lastSuccessAt,
                        stale: status.stale ?? bipResearch.status.stale,
                        error: status.error ?? bipResearch.status.error,
                        reason: status.reason,
                        researchSource: status.researchSource ?? bipResearch.status.researchSource,
                        stage: status.stage ?? bipResearch.status.stage,
                        progressText: status.progressText ?? bipResearch.status.progressText,
                        elapsedMs: status.elapsedMs ?? bipResearch.status.elapsedMs,
                        stepIndex: status.stepIndex ?? bipResearch.status.stepIndex,
                        stepCount: status.stepCount ?? bipResearch.status.stepCount,
                        partialFailures: status.partialFailures ?? bipResearch.status.partialFailures
                    ),
                    briefTitle: bipResearch.briefTitle,
                    briefBody: bipResearch.briefBody,
                    querySummary: bipResearch.querySummary,
                    candidateTargetCount: bipResearch.candidateTargetCount,
                    workspaceEvidenceRefs: bipResearch.workspaceEvidenceRefs,
                    signals: bipResearch.signals,
                    candidates: bipResearch.candidates
                )
                if let outcome = longRunningCompletionOutcome(for: status.state, error: status.error) {
                    completeLongRunningCompletionAttempt(
                        .bipResearch,
                        outcome: outcome,
                        detail: outcome == .success ? bipResearchNotificationDetail(bipResearch) : status.error
                    )
                }
            }
        case "bip_coach_state":
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_setup_gate_state":
            updateBipSetupGate(from: event)
            if event.iddSetupComplete == true,
               !requestedInitialBipMission,
               visibleBipCoach?.currentMission == nil,
               visibleBipCoach?.pendingMissionChoices.isEmpty != false {
                requestedInitialBipMission = true
                activeSurface = .assistantBubble
                generateBipMission(compact: true)
            }
        case "bip_idd_queue_started":
            updateBipSetupGate(from: event)
            isBipCoachGenerating = false
            bipMissionProgress = nil
            activeSurface = .assistantBubble
            lastError = event.bipSetupGateMessage ?? "오늘 미션은 바로 만들 수 있고 부족한 기준은 추천 정확도를 높이는 데 사용됩니다."
        case "bip_idd_session_ready":
            updateBipSetupGate(from: event)
            let isDay1HandoffReady = isDay1HandoffSession(id: event.sessionId)
            if let sessionId = event.sessionId {
                selectedSessionID = sessionId
            }
            isBipCoachGenerating = false
            bipMissionProgress = nil
            if !isDay1HandoffReady {
                activeSurface = .assistantBubble
            }
        case "idd_setup_state", "idd_provider_recovery":
            updateBipSetupGate(from: event)
            isBipCoachGenerating = false
            bipMissionProgress = nil
        case "idd_setup_approved":
            updateBipSetupGate(from: event)
            isBipCoachGenerating = false
            bipMissionProgress = nil
            lastError = nil
        case "bip_coach_refresh_started":
            isBipCoachRefreshing = true
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_coach_refresh_completed":
            isBipCoachRefreshing = false
            bipMissionProgress = nil
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_coach_generation_started":
            isBipCoachGenerating = true
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
        case "bip_coach_generation_completed":
            isBipCoachGenerating = false
            bipMissionProgress = nil
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
            completeLongRunningCompletionAttempt(
                .bipMission,
                outcome: .success,
                detail: bipMissionNotificationDetail(event.bipCoach ?? bipCoach)
            )
        case "bip_coach_completion_completed":
            isBipCoachCompleting = false
            let completedDay = event.bipCoach?.currentMission?.curriculumDay?.day
                ?? bipCoach?.currentMission?.curriculumDay?.day
                ?? selectedFoundationDay
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
            markFoundationDayCompleted(completedDay)
        case "bip_coach_error":
            isBipCoachRefreshing = false
            isBipCoachGenerating = false
            isBipCoachCompleting = false
            bipMissionProgress = nil
            lastError = event.message ?? event.bipCoach?.lastError
            if let bipCoach = event.bipCoach {
                self.bipCoach = bipCoach
            }
            completeLongRunningCompletionAttempt(
                .bipMission,
                outcome: .failed,
                detail: lastError
            )
        case "notion_oauth_started":
            notionOAuthInProgress = true
            notionOAuthError = nil
        case "notion_oauth_browser_opened":
            if let urlString = event.authUrl, let url = URL(string: urlString) {
                presentAuthSession(url: url)
            }
        case "notion_oauth_result":
            notionOAuthInProgress = false
            if event.success == true {
                notionConnected = true
                notionOAuthError = nil
                PostHogTelemetry.capture("mac_notion_oauth_completed", authSession: macAuthSession)
            } else {
                if event.disconnected == true {
                    notionConnected = false
                    notionOAuthError = nil
                    PostHogTelemetry.capture("mac_notion_disconnected", authSession: macAuthSession)
                } else {
                    notionConnected = false
                    notionOAuthError = event.error
                    PostHogTelemetry.captureException(
                        NSError(domain: "NotionOAuth", code: -1, userInfo: [NSLocalizedDescriptionKey: event.error ?? "Notion OAuth failed"]),
                        properties: [
                            "component": "agentic_view_model",
                            "operation": "notion_oauth_result",
                        ],
                        authSession: macAuthSession
                    )
                }
            }
        case "provider_auth_started":
            if let provider = event.provider.flatMap(AgentProvider.init(rawValue:)) {
                providerAuthInProgress = provider
                providerAuthMessage = event.detail ?? "\(provider.title) 로그인 진행 중..."
            }
        case "provider_auth_progress":
            if let provider = event.provider.flatMap(AgentProvider.init(rawValue:)) {
                providerAuthInProgress = provider
            }
            providerAuthMessage = event.detail ?? providerAuthMessage
        case "provider_auth_browser_opened":
            if let urlString = event.authUrl, let url = URL(string: urlString) {
                NSWorkspace.shared.open(url)
            }
        case "provider_auth_result":
            providerAuthInProgress = nil
            if event.success == true {
                providerAuthMessage = event.provider.flatMap { AgentProvider(rawValue: $0)?.title }.map { "\($0) 로그인 완료" }
                    ?? "로그인 완료"
                syncProviderSettingsToSidecar()
                requestDiagnostics()
                retryPendingBipActionAfterAuth()
            } else {
                providerAuthMessage = event.error ?? "로그인에 실패했습니다."
                lastError = providerAuthMessage
            }
        case "diagnostics_snapshot":
            if let diagnostics = event.diagnostics {
                sidecarDiagnostics = diagnostics
                if let environment = diagnostics.environment {
                    self.environment = environment
                }
            }
        case "weekly_ritual_prompt":
            if let prompt = event.weeklyRitualPrompt {
                pendingWeeklyRitual = prompt
            }
        case "bip_readiness_event":
            guard let rawRowId = event.rowId,
                  let rowId = BipReadinessRowId(rawValue: rawRowId),
                  let rawStatus = event.status,
                  let status = BipReadinessStatus(rawValue: rawStatus) else { break }
            var current = bipReadiness ?? BipReadinessState.loading
            let previousRow = current.row(rowId)
            let mergedLog: String? = {
                guard let incoming = event.log?.trimmingCharacters(in: .whitespacesAndNewlines),
                      !incoming.isEmpty else {
                    return status == .inProgress ? previousRow.log : nil
                }
                let previousLines = previousRow.log?
                    .split(separator: "\n", omittingEmptySubsequences: true)
                    .map(String.init) ?? []
                let nextLines = (previousLines + [incoming]).suffix(8)
                return nextLines.joined(separator: "\n")
            }()
            let row = BipReadinessRow(
                id: rowId,
                status: status,
                detail: event.detail,
                log: mergedLog,
                error: event.readinessError ?? event.error.map {
                    BipReadinessError(userMessage: $0, raw: $0, kind: .unknown)
                },
                resourceName: event.resourceName,
                resourceUrl: event.resourceUrl
            )
            current.rows[rowId] = row
            bipReadiness = current
            if rowId == .gwsAuth && status == .done {
                retryPendingBipActionAfterAuth()
            }
        case "bip_token_expired":
            bipTokenExpired = event.bipTokenExpiredMessage ?? event.message
            pendingBipAuthRetry = lastBipRequestedAction
        case "bip_coach_generation_progress":
            bipMissionProgress = event.bipMissionProgress
        case "error":
            lastError = event.message
            if recorderControlRefreshing || recorderControlActionInFlight != nil {
                recorderControlRefreshing = false
                recorderControlActionInFlight = nil
                recorderControlLastError = event.message ?? "Recorder 제어 요청이 실패했습니다."
            }
            if recorderFrameCaptureInFlight {
                recorderFrameCaptureInFlight = false
                recorderFrameCaptureLastError = event.message ?? "화면 캡처 저장 요청이 실패했습니다."
                if recorderAutoCaptureRunning {
                    stopRecorderAutoCapture(
                        reason: "ingest_failed",
                        errorMessage: recorderFrameCaptureLastError
                    )
                }
            }
            if recorderFrameDeleteInFlight {
                recorderFrameDeleteInFlight = false
                recorderFrameDeleteLastError = event.message ?? "화면 기록 삭제 요청이 실패했습니다."
            }
            if recorderFrameCapturesRefreshing {
                recorderFrameCapturesRefreshing = false
                recorderFrameCapturesLastError = event.message ?? "최근 화면 기록 요청이 실패했습니다."
            }
            if recorderFrameImageLoadingID != nil || pendingRecorderFrameImageRequestID != nil {
                recorderFrameImageLoadingID = nil
                pendingRecorderFrameImageRequestID = nil
                recorderFrameImageLastError = event.message ?? "캡처 이미지 요청이 실패했습니다."
            }
            if recorderSearchRunning || pendingRecorderSearchQuery != nil {
                recorderSearchRunning = false
                pendingRecorderSearchQuery = nil
                recorderSearchLastError = event.message ?? "Recorder search 요청이 실패했습니다."
            }
            if recorderAudioChunkInFlight {
                recorderAudioChunkInFlight = false
                recorderMicrophoneAudioChunkInFlight = false
                recorderSystemAudioChunkInFlight = false
                recorderAudioCaptureLastError = event.message ?? "Audio chunk 기록 요청이 실패했습니다."
                stopRecorderMicrophoneCollector(
                    reason: "audio_ingest_failed",
                    clearError: false
                )
                stopRecorderSystemAudioCollector(
                    reason: "audio_ingest_failed",
                    clearError: false
                )
            }
            if recorderPipesRefreshing || recorderPipeSchedulerRunning || !recorderPipeActionInFlight.isEmpty {
                recorderPipesRefreshing = false
                recorderPipeSchedulerRunning = false
                recorderPipeActionInFlight.removeAll()
                recorderPipeLastError = event.message ?? "Recorder Pipe 요청이 실패했습니다."
            }
            if recorderMcpGrantsRefreshing || recorderMcpGrantActionInFlight != nil {
                recorderMcpGrantsRefreshing = false
                recorderMcpGrantActionInFlight = nil
                recorderMcpGrantLastError = event.message ?? "Recorder MCP grant 요청이 실패했습니다."
            }
            if recorderDayMemoryLoopRunning {
                recorderDayMemoryLoopRunning = false
                recorderDayMemoryLoopLastError = event.message ?? "Day Memory Review 실행 요청이 실패했습니다."
            }
            if !recorderEvidenceCandidateReviewInFlight.isEmpty {
                recorderEvidenceCandidateReviewInFlight.removeAll()
                recorderDayMemoryLoopLastError = event.message ?? "Evidence Inbox 후보 검토 요청이 실패했습니다."
            }
            if recorderRetentionApplyRunning {
                recorderRetentionApplyRunning = false
                recorderRetentionLastError = event.message ?? "Recorder retention 요청이 실패했습니다."
            }
            if longRunningCompletionAttempts[.bipMission] != nil {
                completeLongRunningCompletionAttempt(
                    .bipMission,
                    outcome: .failed,
                    detail: event.message
                )
            }
            if day1DocHandoffPendingDocType != nil || day1DocHandoffAwaitingFollowupPrompt,
               activeDay1DocumentReviewPrompt == nil {
                day1DocHandoffPendingDocType = nil
                day1DocHandoffAwaitingFollowupPrompt = false
                day1DocHandoffError = event.message ?? "문서 질문 카드를 준비하지 못했습니다."
            }
            isBipCoachRefreshing = false
            isBipCoachGenerating = false
            isBipCoachCompleting = false
            bipMissionProgress = nil
            if event.sessionId == nil,
               !Self.shouldKeepSidecarConnected(forGlobalErrorMessage: event.message) {
                connectionLabel = event.message ?? connectionLabel
                isConnected = false
                integrationStatusChecking = false
                officeHoursSessionCreateInFlight = false
                finishExaMcpConnectAfterSidecarInterruption()
                finishMcpOauthInFlightAfterSidecarInterruption(
                    detail: "실행 보조 앱 오류로 MCP 연결 확인이 끝나지 않았어요 — 다시 시도해 주세요.",
                    markFailedResult: true
                )
                if shouldRecoverRunningSessions(forGlobalSidecarError: event.message) {
                    markRunningSessionsRecoverableAfterSidecarExit(
                        message: event.message ?? "실행 보조 앱 연결이 끊겼습니다."
                    )
                }
                markStartupQueuedActionFailed(event.message ?? "실행 보조 앱 연결이 끊겼습니다.")
            }
            if let telemetryEvent = Self.nonExceptionSidecarErrorTelemetryEvent(forErrorKind: event.errorKind) {
                PostHogTelemetry.capture(
                    telemetryEvent,
                    properties: [
                        "component": "agentic_view_model",
                        "operation": "sidecar_event_error",
                        "error_kind": event.errorKind ?? "",
                        "provider": event.provider ?? "",
                        "session_id": event.sessionId ?? "",
                    ],
                    authSession: macAuthSession
                )
            } else {
                PostHogTelemetry.captureException(
                    NSError(domain: "SidecarEvent", code: -1, userInfo: [NSLocalizedDescriptionKey: event.message ?? "알 수 없는 실행 보조 앱 오류"]),
                    properties: [
                        "component": "agentic_view_model",
                        "operation": "sidecar_event_error",
                        "session_id": event.sessionId ?? "",
                    ],
                    authSession: macAuthSession
                )
            }
            refreshPresentationState()
        default:
            break
        }
    }

    var diagnosticsReport: String {
        if let sidecarDiagnostics {
            return sidecarDiagnostics.reportText
        }

        return [
            "agentic30 diagnostics",
            "실행 보조 앱 진단 정보를 아직 불러오지 못했습니다.",
            "Connection: \(connectionLabel)",
            "Connected: \(isConnected)",
            "Workspace: \(workspaceRoot.isEmpty ? "unknown" : workspaceRoot)",
        ].joined(separator: "\n")
    }

    private func ensureSelection() {
        if selectedSessionID == nil ||
            !sessions.contains(where: { $0.id == selectedSessionID && $0.archivedAt == nil }) {
            selectedSessionID = sessions.first(where: { $0.archivedAt == nil })?.id
        }
        createReplacementSessionIfNeeded(source: "ensure_visible_session")
    }

    private func requestInitialBipGateIfNeeded() {
        guard isConnected, !requestedInitialBipGate else { return }
        requestedInitialBipGate = true
        let shouldAutoStartProjectlessInterview = macOnboardingIntakeOnlyCompleted
            && !WorkspaceSettings.hasExplicitWorkspace
        requestBipSetupGate(autoStart: shouldAutoStartProjectlessInterview)
    }

    private func updateBipSetupGate(from event: SidecarEvent) {
        iddSetupComplete = event.iddSetupComplete ?? iddSetupComplete
        iddSetupStatus = event.iddSetupStatus ?? iddSetupStatus
        iddCurrentDocType = event.iddCurrentDocType ?? iddCurrentDocType
        iddAmbiguityScore = event.iddAmbiguityScore ?? iddAmbiguityScore
        iddUnresolvedAssumptions = event.iddUnresolvedAssumptions ?? iddUnresolvedAssumptions
        iddDocOrder = event.iddDocOrder ?? iddDocOrder
        iddDocPreviews = event.iddDocPreviews ?? iddDocPreviews
        iddProviderRecovery = event.iddProviderRecovery ?? iddProviderRecovery
        iddSetupError = event.iddSetupError ?? iddSetupError
        if let status = event.iddSetupStatus {
            if status != "provider_recovery" {
                iddProviderRecovery = nil
            }
            if status != "error" {
                iddSetupError = nil
            }
        }
        missingBipLocalDocs = event.missingLocalDocs ?? missingBipLocalDocs
        missingBipExternalRequirements = event.missingExternalRequirements ?? missingBipExternalRequirements
        bipSetupGateMessage = event.bipSetupGateMessage ?? bipSetupGateMessage
        reconcileDay1DocHandoffState(from: event)
    }

    private func reconcileDay1DocHandoffState(from event: SidecarEvent) {
        if let setupError = event.iddSetupError {
            let matchesPendingHandoff = setupError.docType == day1DocHandoffPendingDocType
                || day1DocHandoffPendingDocType == "all"
            if matchesPendingHandoff || day1DocHandoffAwaitingFollowupPrompt || activeDay1DocHandoffJudgePrompt != nil {
                let hasActiveJudgePrompt = activeDay1DocHandoffJudgePrompt != nil
                day1DocHandoffPendingDocType = nil
                day1DocHandoffAwaitingFollowupPrompt = !hasActiveJudgePrompt
                day1DocHandoffError = setupError.message
                return
            }
        }

        guard let pendingDocType = day1DocHandoffPendingDocType else { return }
        if pendingDocType == "all" {
            let previews = event.iddDocPreviews ?? iddDocPreviews
            let requiredDocTypes = ["goal", "icp", "values", "spec"]
            if requiredDocTypes.allSatisfy({ docType in
                previews.first(where: { $0.type == docType })?.isWritten == true
            }) {
                day1DocHandoffPendingDocType = nil
                day1DocHandoffAwaitingFollowupPrompt = false
                day1DocHandoffError = nil
            }
            return
        }
        if event.iddDocPreviews?.first(where: { $0.type == pendingDocType })?.isWritten == true {
            day1DocHandoffPendingDocType = nil
            day1DocHandoffAwaitingFollowupPrompt = false
            day1DocHandoffError = nil
        }
    }

    private func reconcileDay1DocHandoffProgress(from event: SidecarEvent) {
        let docType = event.docType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        let stage = event.stage?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard docType == "all" || event.requestId == "day1-handoff-write-all" else { return }

        switch stage {
        case "bulk_started", "review_retry", "recording_response", "file_written":
            day1DocHandoffAwaitingFollowupPrompt = false
            if activeDay1DocumentReviewPrompt == nil {
                day1DocHandoffPendingDocType = "all"
                day1DocHandoffError = nil
            }
        case "judge_blocked":
            day1DocHandoffPendingDocType = nil
            day1DocHandoffAwaitingFollowupPrompt = activeDay1DocHandoffJudgePrompt == nil
        case "bulk_written":
            day1DocHandoffPendingDocType = nil
            day1DocHandoffAwaitingFollowupPrompt = false
            day1DocHandoffError = nil
        default:
            break
        }
    }

    private var usesInlineUITestStubResponses: Bool {
        ProcessInfo.processInfo.environment["AGENTIC30_UI_TEST_INLINE_STUB_RESPONSES"] == "1"
            || CommandLine.arguments.contains("--ui-testing-seed-office-hours-structured-prompt")
    }

    private func ensureInlineUITestStubSession() {
        guard sessions.isEmpty else {
            ensureSelection()
            seedInlineUITestBipCoachIfNeeded()
            return
        }

        let now = Date()
        if CommandLine.arguments.contains("--ui-testing-seed-failed-assistant-turn") {
            if day1GoalSelection == nil {
                day1GoalSelection = Day1GoalSelection(
                    goalType: .getUsers,
                    goalText: "이번 주 유료 진입점을 보여줄 실명 고객 1명을 고정한다",
                    customer: "macOS에서 AI 코딩 도구를 매일 쓰는 전업 1인 개발자",
                    problem: "AI로 제품은 만들지만 고객 행동 증거가 남지 않는다",
                    validationAction: "가장 적합한 사용자 1명에게 이번 주 유료 진입점 보여주기",
                    evidenceRefs: [".agentic30/docs/GOAL.md", ".agentic30/docs/ICP.md"],
                    proofSink: .local,
                    sourcePlanFingerprint: "ui-test-failed-assistant-turn",
                    selectedAt: ISO8601DateFormatter().string(from: now)
                )
            }
            installUITestingOfficeHoursDay1ActiveProgressIfNeeded()
            let session = ChatSession(
                id: UUID().uuidString,
                title: "Office Hours",
                provider: selectedProvider,
                model: preferredModel(for: selectedProvider),
                status: .error,
                createdAt: now,
                updatedAt: now,
                error: "UI 테스트 provider 실패",
                messages: [
                    ChatMessage(
                        id: UUID().uuidString,
                        role: .user,
                        provider: selectedProvider,
                        content: "실패한 assistant turn을 다시 시도해줘.",
                        state: .final,
                        createdAt: now,
                        error: nil,
                        bipMissionChoices: nil,
                        providerAuthActions: nil
                    ),
                    ChatMessage(
                        id: UUID().uuidString,
                        role: .assistant,
                        provider: selectedProvider,
                        content: "응답 생성에 실패했습니다.",
                        state: .error,
                        createdAt: now,
                        error: "UI 테스트 provider 실패",
                        bipMissionChoices: nil,
                        providerAuthActions: nil
                    ),
                ],
                pendingUserInput: nil,
                runtime: ChatSessionRuntime(
                    codexThreadId: nil,
                    codexThreadMeta: nil,
                    startupTiming: nil,
                    iddDocumentType: "day1_step",
                    iddMode: "office_hours",
                    officeHours: OfficeHoursRuntime(
                        active: true,
                        source: "ui_testing_failed_assistant_turn",
                        startedAt: ISO8601DateFormatter().string(from: now),
                        context: "UI test failed Office Hours turn",
                        day: 1
                    )
                )
            )
            sessions = [session]
            selectedSessionID = session.id
            seedInlineUITestBipCoachIfNeeded()
            refreshPresentationState()
            return
        }

        if CommandLine.arguments.contains("--ui-testing-seed-running-idd-session") {
            let session = ChatSession(
                id: UUID().uuidString,
                title: "기준 정리: 누구를 위한 제품인지",
                provider: selectedProvider,
                model: preferredModel(for: selectedProvider),
                status: .running,
                createdAt: now,
                updatedAt: now,
                error: nil,
                messages: [
                    ChatMessage(
                        id: UUID().uuidString,
                        role: .user,
                        provider: selectedProvider,
                        content: "지금 하는 방식부터 정리",
                        state: .final,
                        createdAt: now,
                        error: nil,
                        bipMissionChoices: nil,
                        providerAuthActions: nil
                    )
                ],
                pendingUserInput: nil,
                runtime: ChatSessionRuntime(
                    codexThreadId: nil,
                    codexThreadMeta: nil,
                    iddDocumentType: "icp"
                )
            )
            sessions = [session]
            selectedSessionID = session.id
            seedInlineUITestBipCoachIfNeeded()
            refreshPresentationState()
            return
        }

        let stubSessionID = UUID().uuidString
        let pendingUserInput = Self.makeUITestingFoundationDay2QuestionIfNeeded(sessionID: stubSessionID, createdAt: now)
            ?? Self.makeUITestingOfficeHoursStructuredPromptIfNeeded(sessionID: stubSessionID, createdAt: now)
            ?? Self.makeUITestingIcpStructuredPromptIfNeeded(sessionID: stubSessionID, createdAt: now)
        let runtime: ChatSessionRuntime? = {
            guard let pendingUserInput,
                  pendingUserInput.generation?.mode?.hasPrefix("office_hours") == true else {
                return nil
            }
            return ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "ui_testing_structured_prompt",
                    startedAt: ISO8601DateFormatter().string(from: now),
                    context: "UI test Office Hours structured prompt",
                    day: 1
                )
            )
        }()
        let session = ChatSession(
            id: pendingUserInput?.sessionId ?? stubSessionID,
            title: "Codex Assistant",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: pendingUserInput == nil ? .idle : .awaitingInput,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: pendingUserInput == nil ? [
                ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    provider: selectedProvider,
                    content: "일반 채팅을 시작할 수 있어요.",
                    state: .final,
                    createdAt: now,
                    error: nil,
                    bipMissionChoices: nil,
                    providerAuthActions: nil
                )
            ] : [],
            pendingUserInput: pendingUserInput,
            runtime: runtime
        )
        sessions = [session]
        selectedSessionID = session.id
        seedInlineUITestBipCoachIfNeeded()
        refreshPresentationState()
    }

    private static func makeUITestingFoundationDay2QuestionIfNeeded(
        sessionID: String,
        createdAt: Date
    ) -> StructuredPromptRequest? {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-foundation-day2-question") else {
            return nil
        }
        return StructuredPromptRequest(
            requestId: "ui-test-foundation-day2-question",
            sessionId: sessionID,
            toolName: "foundation_day_2_resume_question",
            title: "Day 2 Market 질문",
            createdAt: createdAt,
            intro: StructuredPromptIntro(
                title: "Day 2 기준",
                body: "이어지는 질문부터 바로 답하면 됩니다.",
                bullets: []
            ),
            resources: [],
            questions: [
                StructuredPromptQuestion(
                    questionId: "day2_market_reference",
                    header: "기준 시장",
                    question: "이미 돈을 내는 기준 시장은 어디인가요?",
                    helperText: "카테고리 1개와 유료 대체재 1개만 먼저 적어보세요.",
                    options: [
                        StructuredPromptOption(
                            label: "Mac 앱",
                            description: "메뉴바, 생산성, 개발자 도구처럼 이미 결제 중인 Mac 앱 시장입니다.",
                            preview: nil,
                            nextIntent: "mac_app_market"
                        ),
                        StructuredPromptOption(
                            label: "구독형 웹 도구",
                            description: "팀이나 개인이 반복 업무 해결에 돈을 내는 웹 도구 시장입니다.",
                            preview: nil,
                            nextIntent: "web_saas_market"
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: true,
                    freeTextPlaceholder: "예: 회의 요약 웹 도구, 월 $15 도구",
                    textMode: .short
                )
            ],
            generation: StructuredPromptGeneration(mode: "host_structured", docType: "day2_market")
        )
        #else
        return nil
        #endif
    }

    private static func makeUITestingIcpStructuredPromptIfNeeded(
        sessionID requestedSessionID: String,
        createdAt: Date
    ) -> StructuredPromptRequest? {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-icp-structured-prompt") else {
            return nil
        }
        return StructuredPromptRequest(
            requestId: "ui-test-icp-request",
            sessionId: requestedSessionID,
            toolName: "agentic30_request_user_input",
            title: "Ideal Customer Profile 1/4",
            createdAt: createdAt,
            questions: [
                StructuredPromptQuestion(
                    header: "첫 고객",
                    question: "agentic30-public의 SwiftUI macOS 앱과 Node 실행 보조 앱 흐름에서 Day 1에 먼저 검증할 사용자는 누구인가요?",
                    helperText: "UI testing seed도 host structured payload와 같은 형태만 사용합니다.",
                    options: [
                        StructuredPromptOption(
                            label: "Codex/Claude 전환 사용자",
                            description: "AI 연결 인증과 실행 전환에서 막히는 실제 사용자입니다.",
                            preview: nil,
                            nextIntent: "provider_switch_user"
                        ),
                        StructuredPromptOption(
                            label: "30일 커리큘럼 참가자",
                            description: "초기 설정 문서를 통과해야 다음 회차로 넘어갑니다.",
                            preview: nil,
                            nextIntent: "curriculum_day1_user"
                        ),
                        StructuredPromptOption(
                            label: "macOS 메뉴바 앱 사용자",
                            description: "SwiftUI 패널에서 질문/응답 정체를 직접 겪습니다.",
                            preview: nil,
                            nextIntent: "macos_panel_user"
                        )
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: false,
                    freeTextPlaceholder: "예: Day 1 참가자가 AI 연결 인증 실패 후 고정된 고객 후보 질문에 갇힌다",
                    textMode: .short
                )
            ],
            generation: StructuredPromptGeneration(mode: "host_structured", docType: "icp")
        )
        #else
        return nil
        #endif
    }

    private static func makeUITestingOfficeHoursStructuredPromptIfNeeded(
        sessionID requestedSessionID: String,
        createdAt: Date
    ) -> StructuredPromptRequest? {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-structured-prompt") else {
            return nil
        }
        if CommandLine.arguments.contains("--ui-testing-seed-office-hours-get-users-evidence") {
            return Self.makeUITestingOfficeHoursGetUsersEvidencePrompt(
                sessionID: requestedSessionID,
                requestId: "ui-test-office-hours-get-users-evidence",
                createdAt: createdAt
            )
        }
        if CommandLine.arguments.contains("--ui-testing-seed-office-hours-get-users-commitment") {
            return Self.makeUITestingOfficeHoursGetUsersCommitmentPrompt(
                sessionID: requestedSessionID,
                requestId: "ui-test-office-hours-get-users-commitment",
                createdAt: createdAt
            )
        }
        if CommandLine.arguments.contains("--ui-testing-seed-office-hours-day1-handoff-unblock") {
            return Self.makeUITestingOfficeHoursDay1HandoffUnblockPrompt(
                sessionID: requestedSessionID,
                requestId: "ui-test-office-hours-day1-handoff-unblock",
                createdAt: createdAt
            )
        }
        return Self.makeUITestingOfficeHoursStructuredPrompt(
            sessionID: requestedSessionID,
            requestId: "ui-test-office-hours-request",
            createdAt: createdAt,
            step: 1
        )
        #else
        return nil
        #endif
    }

    private static func makeUITestingOfficeHoursGetUsersActionPrompt(
        sessionID requestedSessionID: String,
        requestId: String,
        createdAt: Date
    ) -> StructuredPromptRequest {
        let prompt = StructuredPromptQuestion(
            questionId: "get_users_today_request",
            header: "오늘 줄 도움",
            question: "오늘 이 ICP에게 Agentic30가 어떤 도움을 바로 제공할까요?",
            helperText: "방법보다 상대가 오늘 얻는 결과를 고릅니다. 선택만 해도 실행 계약이 만들어집니다.",
            options: [
                StructuredPromptOption(
                    label: "15분 실행 결과물 만들어주기",
                    description: "상대의 문서·코드·메모 하나를 받아 바로 쓸 수 있는 결과로 바꿔 줍니다.",
                    preview: nil,
                    nextIntent: "make_15_min_output",
                    recommended: true
                ),
                StructuredPromptOption(
                    label: "고객 요청 DM을 대신 완성해주기",
                    description: "상대가 오늘 실제 고객에게 보낼 한 줄 요청을 바로 보낼 수 있게 만듭니다.",
                    preview: nil,
                    nextIntent: "complete_customer_dm"
                ),
                StructuredPromptOption(
                    label: "막힌 화면을 보고 다음 행동 정리",
                    description: "화면 공유나 캡처를 받아 막힌 지점과 바로 할 다음 행동을 정리합니다.",
                    preview: nil,
                    nextIntent: "summarize_next_action"
                ),
            ],
            multiSelect: false,
            allowFreeText: true,
            requiresFreeText: false,
            freeTextPlaceholder: "선택사항: 특정 채널, 시간, 보낼 문장을 알고 있으면 보강",
            primaryTextInput: StructuredPromptPrimaryTextInput(
                label: "도움 방식 보강",
                placeholder: "선택사항: 시간, 채널, 보낼 문장",
                required: false,
                submitLabel: "선택한 도움 제공",
                validationMessage: "보강 입력은 선택사항입니다."
            ),
            textMode: .short
        )
        return StructuredPromptRequest(
            requestId: requestId,
            sessionId: requestedSessionID,
            toolName: "agentic30_request_user_input",
            title: "Office Hours",
            createdAt: createdAt,
            questions: [prompt],
            generation: StructuredPromptGeneration(
                mode: "office_hours",
                docType: "day1_step",
                signalId: "get_users_today_request",
                signalLabel: "오늘 줄 도움",
                dimensionStepIndex: 2,
                dimensionTotal: 3
            )
        )
    }

    private static func makeUITestingOfficeHoursGetUsersEvidencePrompt(
        sessionID requestedSessionID: String,
        requestId: String,
        createdAt: Date
    ) -> StructuredPromptRequest {
        let prompt = StructuredPromptQuestion(
            questionId: "get_users_evidence_format",
            header: "흔적과 마감",
            question: "도움을 줬다는 흔적과 오늘 마감은 무엇이면 충분할까요?",
            helperText: "내일 다시 판단할 수 있는 가장 단순한 흔적을 고릅니다. 선택하면 Day 1 실행안이 닫힙니다.",
            options: [
                StructuredPromptOption(
                    label: "로컬 메모 + 화면 캡처로 닫기",
                    description: "도움을 준 결과 화면과 짧은 판단 메모만 남깁니다.",
                    preview: nil,
                    nextIntent: "local_capture_and_note",
                    recommended: true
                ),
                StructuredPromptOption(
                    label: "DM/댓글 답장만 남기기",
                    description: "상대가 보인 반응, 거절, 다음 약속을 그대로 남깁니다.",
                    preview: nil,
                    nextIntent: "dm_reply_or_rejection"
                ),
                StructuredPromptOption(
                    label: "보낸 요청문과 내일 확인 시각 고정",
                    description: "오늘 실행이 발송까지라면 요청문, 채널, 내일 확인 시각만 남깁니다.",
                    preview: nil,
                    nextIntent: "sent_request_and_check_time"
                ),
            ],
            multiSelect: false,
            allowFreeText: true,
            requiresFreeText: false,
            freeTextPlaceholder: "선택사항: 저장 위치나 파일명을 알고 있으면 보강",
            primaryTextInput: StructuredPromptPrimaryTextInput(
                label: "흔적 보강",
                placeholder: "선택사항: 캡처/답장/메모 위치",
                required: false,
                submitLabel: "선택한 흔적으로 Day 1 닫기",
                validationMessage: "보강 입력은 선택사항입니다."
            ),
            textMode: .short,
            highlightPhrases: ["활성 사용자 여부"]
        )
        return StructuredPromptRequest(
            requestId: requestId,
            sessionId: requestedSessionID,
            toolName: "agentic30_request_user_input",
            title: "Office Hours",
            createdAt: createdAt,
            questions: [prompt],
            generation: StructuredPromptGeneration(
                mode: "office_hours",
                docType: "day1_step",
                signalId: "get_users_evidence_format",
                signalLabel: "흔적과 마감",
                dimensionStepIndex: 3,
                dimensionTotal: 3
            )
        )
    }

    private static func makeUITestingOfficeHoursGetUsersCommitmentPrompt(
        sessionID requestedSessionID: String,
        requestId: String,
        createdAt: Date
    ) -> StructuredPromptRequest {
        let prompt = StructuredPromptQuestion(
            questionId: "get_users_day1_commitment",
            header: "오늘 실행",
            question: "오늘 어떤 도움 실행으로 끝낼까요?",
            helperText: "선택하면 그 실행안으로 Day 1을 닫습니다. 세부 이름이나 시간은 있으면 보강하세요.",
            options: [
                StructuredPromptOption(
                    label: "오늘 DM 보내고 15분 도움 제공",
                    description: "후보에게 작은 실행 도움을 제안하고 답장/결과를 로컬에 남깁니다.",
                    preview: nil,
                    nextIntent: "send_dm_and_save_note",
                    recommended: true
                ),
                StructuredPromptOption(
                    label: "오늘 안에 화면 공유 요청",
                    description: "실제 사용 장면을 볼 수 있도록 짧은 화면 공유를 요청합니다.",
                    preview: nil,
                    nextIntent: "request_screen_share"
                ),
                StructuredPromptOption(
                    label: "오늘 안에 후보 1명 더 찾기",
                    description: "아직 이름이 약하면 Agentic30가 후보 찾기 도움으로 이어갑니다.",
                    preview: nil,
                    nextIntent: "find_one_more_candidate"
                ),
                StructuredPromptOption(
                    label: "내일로 넘김",
                    description: "오늘 실행하지 않으면 활성 사용자 검증도 내일로 밀립니다.",
                    preview: nil,
                    nextIntent: "defer_to_tomorrow"
                ),
            ],
            multiSelect: false,
            allowFreeText: true,
            requiresFreeText: false,
            freeTextPlaceholder: "선택사항: 정확한 사람, 시간, 채널을 알고 있으면 보강",
            primaryTextInput: StructuredPromptPrimaryTextInput(
                label: "실행 세부 보강",
                placeholder: "선택사항: 시간 + 후보 + 채널",
                required: false,
                submitLabel: "선택한 실행으로 Day 1 닫기",
                validationMessage: "보강 입력은 선택사항입니다."
            ),
            textMode: .short
        )
        return StructuredPromptRequest(
            requestId: requestId,
            sessionId: requestedSessionID,
            toolName: "agentic30_request_user_input",
            title: "Office Hours",
            createdAt: createdAt,
            questions: [prompt],
            generation: StructuredPromptGeneration(
                mode: "office_hours",
                docType: "day1_step",
                signalId: "get_users_day1_commitment",
                signalLabel: "오늘 약속",
                dimensionStepIndex: 6,
                dimensionTotal: 6
            )
        )
    }

    private static func makeUITestingOfficeHoursDay1HandoffUnblockPrompt(
        sessionID requestedSessionID: String,
        requestId: String,
        createdAt: Date
    ) -> StructuredPromptRequest {
        let prompt = StructuredPromptQuestion(
            questionId: "day1_clarity_unblock_action",
            header: "오늘의 해소 행동",
            question: "아직 모른다면, 오늘 이 정보를 얻기 위해 어떤 사람·채널에서 무엇을 할 건가요?",
            helperText: "없음/보류를 반복하지 않습니다. 다음 한 행동으로 불명확성을 줄입니다.",
            options: [
                StructuredPromptOption(
                    label: "오늘 찾을 행동 적기",
                    description: "사람, 채널, 무엇을 할지 한 줄로 적어 이 루프를 닫습니다.",
                    preview: nil,
                    nextIntent: "answer_unblock_action",
                    recommended: true
                ),
                StructuredPromptOption(
                    label: "시간·채널부터 적기",
                    description: "정확한 후보가 없어도 언제 어디에서 찾을지부터 고정합니다.",
                    preview: nil,
                    nextIntent: "answer_unblock_channel"
                ),
            ],
            multiSelect: false,
            allowFreeText: true,
            requiresFreeText: false,
            freeTextPlaceholder: "예: 오늘 18시까지 Threads에서 후보 1명을 찾아 DM 요청 문장을 보냄",
            primaryTextInput: StructuredPromptPrimaryTextInput(
                label: "오늘 찾을 사람·채널·행동",
                placeholder: "예: 오늘 18시까지 Threads에서 후보 1명을 찾아 DM 요청 문장을 보냄",
                required: true,
                submitLabel: "해소 행동 제출",
                validationMessage: "사람·채널·무엇을 할지 한 문장으로 적어야 반복 질문을 닫을 수 있습니다."
            ),
            textMode: .short
        )
        return StructuredPromptRequest(
            requestId: requestId,
            sessionId: requestedSessionID,
            toolName: "agentic30_request_user_input",
            title: "Office Hours 구체화",
            createdAt: createdAt,
            questions: [prompt],
            generation: StructuredPromptGeneration(
                mode: "office_hours",
                docType: "day1_handoff_clarity",
                signalId: "day1_clarity_unblock_action",
                signalLabel: "막힌 지점 해소",
                dimensionStepIndex: 2,
                dimensionTotal: 5
            )
        )
    }

    private static func makeUITestingOfficeHoursStructuredPrompt(
        sessionID requestedSessionID: String,
        requestId: String,
        createdAt: Date,
        step: Int
    ) -> StructuredPromptRequest {
        let prompt: StructuredPromptQuestion
        let signalId: String
        let signalLabel: String

        switch step {
        case 2:
            signalId = "status_quo"
            signalLabel = "현재 대안"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_status_quo",
                header: "현재 대안",
                question: "사용자는 지금 이 문제를 어떻게 해결하고 있어? 도구, 사람, 시간, 비용까지 지금 쓰는 우회 방식을 써줘.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "스프레드시트와 메신저",
                        description: "시트, Notion, Slack, 카톡처럼 흩어진 수동 조합.",
                        preview: "수동 조합",
                        nextIntent: "spreadsheet_slack"
                    ),
                    StructuredPromptOption(
                        label: "사람이 직접 처리",
                        description: "운영자, PM, 인턴, 외주가 반복 업무를 사람 손으로 처리.",
                        preview: "사람 손",
                        nextIntent: "manual_labor"
                    ),
                    StructuredPromptOption(
                        label: "기존 웹 도구 우회 사용",
                        description: "목적이 다른 도구를 억지로 맞춰 쓰는 상태.",
                        preview: "도구 공백",
                        nextIntent: "misfit_saas"
                    ),
                    StructuredPromptOption(
                        label: "아무것도 안 함",
                        description: "실제로는 안 풀고 지나간다. 통증이 약할 수 있는 위험 신호.",
                        preview: "위험 신호",
                        nextIntent: "no_status_quo"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: Notion 표, Slack DM, 주 3시간 수동 리포트로 버티고 있어요.",
                textMode: .short,
                highlightPhrases: ["도구, 사람, 시간, 비용"]
            )
        case 3:
            signalId = "human"
            signalLabel = "HUMAN"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_human",
                header: "HUMAN",
                question: "이번 주 안에 DM·메시지·통화 1통을 실제로 요청할 수 있는 사람은 누구야? 이름, 역할, 실패 비용을 적어줘.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "이름과 회사까지 안다",
                        description: "이번 주 바로 연락할 수 있는 실제 후보가 있다.",
                        preview: "구체적",
                        nextIntent: "named_person"
                    ),
                    StructuredPromptOption(
                        label: "역할과 상황은 안다",
                        description: "직함, 팀, 실패 비용은 있지만 아직 특정 이름은 없다.",
                        preview: "가까움",
                        nextIntent: "role_known"
                    ),
                    StructuredPromptOption(
                        label: "고객군만 안다",
                        description: "소규모 회사, 개발자, 마케터처럼 아직 너무 넓다.",
                        preview: "넓음",
                        nextIntent: "category_only"
                    ),
                    StructuredPromptOption(
                        label: "아직 모른다",
                        description: "문제보다 솔루션에서 출발했을 가능성이 크다.",
                        preview: "재설정",
                        nextIntent: "unknown_user"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 50명 규모 물류 스타트업의 Ops Lead, 매주 고객 리포트 때문에 야근합니다.",
                textMode: .short,
                highlightPhrases: ["DM·메시지·통화 1통"]
            )
        case 4:
            signalId = "wedge"
            signalLabel = "첫 진입점"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_wedge",
                header: "첫 진입점",
                question: "이번 주에 돈을 받을 수 있는 가장 작은 버전은 뭐야? 플랫폼 말고 하나의 작업 흐름으로 말해줘.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "유료 첫 테스트 1건",
                        description: "한 고객에게 직접 돈을 받고 결과물을 제공한다.",
                        preview: "paid",
                        nextIntent: "paid_pilot"
                    ),
                    StructuredPromptOption(
                        label: "주간 리포트",
                        description: "설정 없는 결과물로 가치부터 보여준다.",
                        preview: "concierge",
                        nextIntent: "weekly_report"
                    ),
                    StructuredPromptOption(
                        label: "단일 자동화",
                        description: "전체 플랫폼이 아니라 한 반복 작업만 자동화한다.",
                        preview: "작업 흐름",
                        nextIntent: "single_automation"
                    ),
                    StructuredPromptOption(
                        label: "클릭 데모 먼저",
                        description: "돈보다 승인, 이해, 사용 의향을 먼저 검증해야 한다.",
                        preview: "demo",
                        nextIntent: "demo_first"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 매주 월요일 경쟁사 변화 리포트 1장을 대신 만들어주는 유료 첫 테스트.",
                textMode: .short,
                highlightPhrases: ["돈을 받을 수 있는 가장 작은 버전"]
            )
        case 5:
            signalId = "observation"
            signalLabel = "OBSERVATION"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_observation",
                header: "OBSERVATION",
                question: "누군가가 말없이 쓰는 걸 본 적 있어? 예상과 달랐던 행동이 하나라도 있었는지 적어줘.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "직접 관찰했다",
                        description: "옆에서 지켜봤고 예상과 다른 행동을 봤다.",
                        preview: "best",
                        nextIntent: "watched_user"
                    ),
                    StructuredPromptOption(
                        label: "녹화나 로그만 봤다",
                        description: "행동 데이터는 있으나 맥락 질문은 아직 못 했다.",
                        preview: "partial",
                        nextIntent: "reviewed_logs"
                    ),
                    StructuredPromptOption(
                        label: "데모 콜만 했다",
                        description: "사용자가 실제로 쓰는 장면은 아직 못 봤다.",
                        preview: "weak",
                        nextIntent: "demo_only"
                    ),
                    StructuredPromptOption(
                        label: "아직 없다",
                        description: "다음 과제는 만들기가 아니라 관찰일 가능성이 높다.",
                        preview: "assignment",
                        nextIntent: "no_observation"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 사용자가 설정을 안 보고 바로 export부터 찾았어요.",
                textMode: .short,
                highlightPhrases: ["말없이 쓰는 걸 본 적"]
            )
        case 6:
            signalId = "future_fit"
            signalLabel = "FUTURE FIT"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_future_fit",
                header: "FUTURE FIT",
                question: "3년 뒤 세상이 달라졌을 때 이 제품은 더 필수적이 돼, 아니면 덜 필수적이 돼? 왜 그런지 한 문장으로.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "더 필수적이다",
                        description: "사용자의 세계 변화가 제품 의존도를 키운다.",
                        preview: "thesis",
                        nextIntent: "more_essential"
                    ),
                    StructuredPromptOption(
                        label: "덜 필수적일 수 있다",
                        description: "범용 AI나 기존 강자가 같은 문제를 흡수할 위험이 있다.",
                        preview: "risk",
                        nextIntent: "less_essential"
                    ),
                    StructuredPromptOption(
                        label: "방향이 아직 불명확",
                        description: "가설은 있지만 어떤 변화가 이기는지 더 봐야 한다.",
                        preview: "open",
                        nextIntent: "future_unclear"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 팀이 작아질수록 리서치와 실행을 한 사람이 같이 해야 해서 더 필수적입니다.",
                textMode: .short,
                highlightPhrases: ["더 필수적", "덜 필수적"]
            )
        default:
            signalId = "demand"
            signalLabel = "DEMAND"
            prompt = StructuredPromptQuestion(
                questionId: "office_hours_demand_evidence",
                header: "DEMAND",
                question: "가장 강한 수요 증거가 뭐야? 관심 말고, 없어지면 실제로 곤란해지는 행동이나 돈의 증거.",
                helperText: nil,
                options: [
                    StructuredPromptOption(
                        label: "돈을 냈거나 제안함",
                        description: "유료 파일럿, 선결제, 예산 배정처럼 비용이 걸린 신호.",
                        preview: "strong",
                        nextIntent: "paid_demand"
                    ),
                    StructuredPromptOption(
                        label: "업무에 이미 의존함",
                        description: "프로토타입, 수작업 결과물, 리포트를 반복해서 쓰는 상태.",
                        preview: "behavior",
                        nextIntent: "workflow_dependency"
                    ),
                    StructuredPromptOption(
                        label: "강한 workaround 있음",
                        description: "Excel, Slack, 사람, 외주로 억지로 해결하는 현재 대안.",
                        preview: "현재 대안",
                        nextIntent: "workaround_cost"
                    ),
                    StructuredPromptOption(
                        label: "아직 실제 증거 없음",
                        description: "아이디어나 대기 신청자 수준이라 첫 검증 과제가 필요한 상태.",
                        preview: "honest",
                        nextIntent: "no_evidence_yet"
                    ),
                ],
                multiSelect: false,
                allowFreeText: true,
                requiresFreeText: false,
                freeTextPlaceholder: "예: 3명이 매주 같은 수작업을 하고 있고 1명은 유료 파일럿을 물어봤어요.",
                textMode: .short,
                highlightPhrases: ["행동이나 돈의 증거"]
            )
        }

        return StructuredPromptRequest(
            requestId: requestId,
            sessionId: requestedSessionID,
            toolName: "agentic30_request_user_input",
            title: "Office Hours",
            createdAt: createdAt,
            questions: [prompt],
            generation: StructuredPromptGeneration(
                mode: "office_hours",
                docType: "day1_step",
                signalId: signalId,
                signalLabel: signalLabel,
                dimensionStepIndex: step,
                dimensionTotal: 6
            )
        )
    }

    private func seedUITestingRailUnlockProgressIfNeeded(arguments: [String] = CommandLine.arguments) {
        #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
        let maxCompletedDay = Self.uiTestingRailUnlockMaxCompletedDay(arguments: arguments)
        guard let maxCompletedDay else { return }

        let progress = Self.makeUITestingRailUnlockDayProgress(
            maxCompletedDay: maxCompletedDay,
            day1GoalText: day1GoalSelection?.goalText
        )
        dayProgress = progress
        Self.persistUITestingRailUnlockProgress(progress, arguments: arguments)
        #endif
    }

    private static func uiTestingRailUnlockMaxCompletedDay(arguments: [String] = CommandLine.arguments) -> Int? {
        #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
        if arguments.contains("--ui-testing-seed-rail-unlocked-through-day3") {
            return 3
        }
        if arguments.contains("--ui-testing-seed-rail-unlocked-through-day2") {
            return 2
        }
        if arguments.contains("--ui-testing-seed-rail-unlocked-through-day1") {
            return 1
        }
        return nil
        #else
        return nil
        #endif
    }

    private static func makeUITestingRailUnlockDayProgress(
        maxCompletedDay: Int,
        day1GoalText: String? = nil,
        now: Date = Date()
    ) -> DayProgress {
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let startDate = Calendar.current.date(byAdding: .day, value: 1 - maxCompletedDay, to: now) ?? now
        let startedAt = formatter.string(from: startDate)
        var days: [String: DayRecord] = [:]
        for day in 1...maxCompletedDay {
            let date = Calendar.current.date(byAdding: .day, value: day - 1, to: startDate) ?? now
            let updatedAt = formatter.string(from: date)
            if day == 1 {
                days["1"] = DayRecord(
                    day: 1,
                    kind: .day1,
                    steps: [
                        "onboarding": .done,
                        "scan": .done,
                        "goal": .done,
                        "first_interview": .done,
                    ],
                    goalText: day1GoalText ?? "Day 1 고객 증거 확인",
                    updatedAt: updatedAt
                )
            } else {
                days[String(day)] = DayRecord(
                    day: day,
                    kind: .standard,
                    steps: [
                        "scan": .done,
                        "retro": .done,
                        "goal": .done,
                        "interview": .done,
                        "execution": .pending,
                    ],
                    goalText: "Day \(day) 인터뷰 완료 fixture",
                    updatedAt: updatedAt
                )
            }
        }
        return DayProgress(
            challengeStartedAt: startedAt,
            days: days
        )
    }

    private static func persistUITestingRailUnlockProgress(_ progress: DayProgress, arguments: [String]) {
        #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
        guard let workspacePath = uiTestingArgumentValue("--ui-testing-seed-workspace", arguments: arguments) else {
            return
        }
        do {
            let agenticDir = URL(fileURLWithPath: workspacePath, isDirectory: true)
                .appendingPathComponent(".agentic30", isDirectory: true)
            try FileManager.default.createDirectory(
                at: agenticDir,
                withIntermediateDirectories: true,
                attributes: nil
            )
            let encoder = JSONEncoder()
            encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
            let data = try encoder.encode(progress)
            try data.write(
                to: agenticDir.appendingPathComponent("day-progress.json"),
                options: [.atomic]
            )
        } catch {
            fatalError("Failed to seed rail unlock day-progress.json for UI testing: \(error)")
        }
        #endif
    }

    // Seeds a two-day DayProgress (Day 2 today, Day 1 incomplete past record) so the
    // Office Hours timeline sidebar renders the cumulative Day list for screenshots.
    // challengeStartedAt is yesterday-local so currentDayNumber() resolves to Day 2
    // on any run date. Gated on its own flag; no-op otherwise.
    private func seedUITestingTimelineFixtureIfNeeded() {
        #if !DEBUG
        return
        #else
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-timeline-fixture") else { return }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now) ?? now
        let startedAt = formatter.string(from: yesterday)
        let day1 = DayRecord(
            day: 1,
            kind: .day1,
            steps: ["onboarding": .done, "scan": .done, "goal": .active, "first_interview": .pending],
            goalText: "목표와 고객 핵심 가설을 만든다",
            updatedAt: startedAt
        )
        let day2 = DayRecord(
            day: 2,
            kind: .standard,
            steps: ["scan": .done, "retro": .done, "goal": .done, "interview": .active, "execution": .pending],
            goalText: "전업 1인 개발자 (수익 0원, macOS 메뉴바 AI 비서)",
            updatedAt: formatter.string(from: now)
        )
        dayProgress = DayProgress(
            challengeStartedAt: startedAt,
            days: ["1": day1, "2": day2]
        )
        let commitment = CommitmentRecord(
            id: "ui-test-commitment-day-1",
            cycle: 1,
            day: 1,
            createdAt: "\(startedAt)T09:00:00.000Z",
            text: "장지창에게 DM로 결제 의향 묻기 · 증거: screenshot",
            customer: "장지창",
            channel: "DM",
            message: "결제 의향 묻기",
            expectedEvidenceKind: "screenshot",
            dueDay: 2,
            confirmedByUser: true,
            status: "open",
            evidence: nil
        )
        dayReviews = [
            "1": DayReview(
                schemaVersion: 2,
                day: 1,
                status: "build_escape",
                verdictLabel: "고객 증거 없이 빌드함",
                verdictTone: "danger",
                summary: "AI 작업 75분이 있었지만 확인 가능한 고객 증거가 없습니다. 다음 고객 접촉으로 닫아야 합니다.",
                customerEvidence: [commitment],
                commitments: [commitment],
                nextCommitment: commitment,
                missing: ["hard_evidence"],
                goalSnapshot: DayGoalSnapshot(
                    summary: "전업 1인 개발자에게 macOS 메뉴바 AI 비서의 결제 의향을 검증한다",
                    customer: "전업 1인 개발자",
                    problem: "AI 코딩은 많이 하지만 고객 검증과 매출 약속이 사라진다",
                    validationAction: "장지창에게 결제 의향 DM을 보내고 스크린샷을 붙인다",
                    source: "day1-goal"
                ),
                missingReasons: [
                    "고객 반응 URL/스크린샷/결제 같은 확인 가능한 증거가 없습니다.",
                    "Day 1 약속이 Day 2 기준으로 기한을 넘겼습니다."
                ],
                carryForwardAction: "오늘 장지창에게 결제 의향 DM을 보내고 screenshot 증거를 붙이기",
                evidenceDebts: [commitment],
                work: DayReviewWorkSummary(
                    available: true,
                    date: startedAt,
                    aiMinutes: 75,
                    commitCount: 3,
                    referenceEventCount: 1,
                    hasWork: true,
                    areas: [
                        DayReviewWorkArea(
                            name: "제품 빌드",
                            aiMinutes: 75,
                            commitCount: 3,
                            paths: ["agentic30/ContentView.swift"]
                        )
                    ]
                )
            )
        ]
        evidenceOS = EvidenceOSSummary(
            schemaVersion: 1,
            currentDay: 2,
            openDebts: [commitment],
            overdueDebts: [commitment],
            provenEvidence: [],
            dayStates: [
                "1": EvidenceOSDayState(
                    day: 1,
                    state: "build_escape",
                    label: "빌드만 진행",
                    tone: "danger",
                    openDebtCount: 1,
                    provenEvidenceCount: 0,
                    carryForwardAction: "오늘 장지창에게 결제 의향 DM을 보내고 screenshot 증거를 붙이기"
                ),
                "2": EvidenceOSDayState(
                    day: 2,
                    state: "in_progress",
                    label: "진행 중",
                    tone: "warning",
                    openDebtCount: 1,
                    provenEvidenceCount: 0,
                    carryForwardAction: "Day 1 고객 증거를 먼저 닫기"
                )
            ]
        )
        #endif
    }

    @discardableResult
    private func installUITestingOfficeHoursDailyCardStackSessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-v2-daily-cards") else {
            return false
        }
        if let selectedSession,
           selectedSession.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil,
           selectedSession.runtime?.officeHours?.day == 14,
           !dailyCards.isEmpty {
            return true
        }

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let now = Date()
        let today = formatter.string(from: now)
        dayProgress = DayProgress(
            challengeStartedAt: today,
            days: [
                "14": DayRecord(
                    day: 14,
                    kind: .standard,
                    steps: ["scan": .done, "retro": .done, "goal": .done, "interview": .active, "execution": .pending],
                    goalText: "유료 ask 증거와 first_value를 같은 날 만든다",
                    updatedAt: today
                )
            ]
        )

        let sessionID = "ui-test-office-hours-v2-cards-\(UUID().uuidString)"
        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .idle,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [],
            pendingUserInput: nil,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                startupTiming: nil,
                iddDocumentType: "program_v2_daily_cards",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "ui_testing_program_v2_daily_cards",
                    startedAt: ISO8601DateFormatter().string(from: now),
                    context: "PROGRAM_V2_DAILY_CARD_STACK_UI_TEST",
                    day: 14
                )
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        dailyCards = []
        do {
            for payload in Self.uiTestingV2DailyCardPayloads {
                let event = try JSONDecoder().decode(SidecarEvent.self, from: Data(payload.utf8))
                handle(event)
            }
        } catch {
            lastError = "UI testing v2 daily-card fixture failed to decode: \(error)"
            assertionFailure(lastError ?? "UI testing v2 daily-card fixture failed to decode")
            return false
        }
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    private static let uiTestingV2DailyCardPayloads: [String] = [
        """
        {
          "type": "mission_card",
          "workspaceRoot": "/tmp/agentic30-ui-v2-daily-cards",
          "missionCard": {
            "id": "ui-state-transition-card",
            "type": "office_hours_state_transition",
            "schemaVersion": 1,
            "programDay": 14,
            "generation": {
              "signalId": "office-hours-state-transition",
              "signalLabel": "Office Hours stale commitment",
              "generationId": "ui-generation-state"
            },
            "sourceState": "stale",
            "sourceStateVersion": "ui-state-v1",
            "requiresUserAction": true,
            "proofLedgerMapping": {
              "self_report": "officeHoursResolution.negativeEvidenceOnly",
              "customer_screenshot": "customerEvidence.acceptedProof"
            },
            "commitmentId": "commitment_14",
            "sourceCommitmentId": "commitment_14",
            "candidateName": "Candidate A",
            "actionText": "Request validation material by 18:00.",
            "repeatCountWithoutEvidence": 2,
            "choices": [
              { "id": "attach_evidence", "label": "Attach evidence" },
              { "id": "resolve_without_evidence", "label": "Resolve without evidence" },
              { "id": "replace_candidate", "label": "Replace candidate" },
              { "id": "keep_open_today", "label": "Keep open today" }
            ],
            "resolutionReasons": [
              "not_sent",
              "message_not_ready",
              "channel_blocked",
              "wrong_candidate",
              "candidate_exhausted",
              "replaced_by_next_candidate"
            ]
          }
        }
        """,
        """
        {
          "type": "mission_card",
          "workspaceRoot": "/tmp/agentic30-ui-v2-daily-cards",
          "missionCard": {
            "id": "ui-workpack-card",
            "type": "office_hours_agent_workpack",
            "schemaVersion": 1,
            "programDay": 14,
            "generation": {
              "signalId": "office-hours-workpack",
              "signalLabel": "Office Hours agent workpack",
              "generationId": "ui-generation-workpack"
            },
            "sourceState": "ready",
            "sourceStateVersion": "ui-state-v1",
            "requiresUserAction": true,
            "proofLedgerMapping": {
              "paymentIntent": "firstRevenue.learningSignal",
              "paymentRecord": "firstRevenue.acceptedProof"
            },
            "sourceCommitmentId": "commitment_14",
            "selectedLens": "service_planning",
            "workpack": {
              "id": "workpack_day_14_g4",
              "workType": "offer/paid ask",
              "targetExternalAction": "Send one paid ask DM with price, outcome, and deadline.",
              "expectedProof": "Sent screenshot, sent time, recipient identifier, and reply text.",
              "notProof": ["AI draft", "self-report that it will be sent"],
              "owner": "founder",
              "deadline": "2026-06-20T18:00:00+09:00"
            }
          }
        }
        """,
        """
        {
          "type": "mission_card",
          "workspaceRoot": "/tmp/agentic30-ui-v2-daily-cards",
          "missionCard": {
            "id": "ui-scoreboard-card",
            "type": "program_scoreboard_snapshot",
            "schemaVersion": 1,
            "programDay": 14,
            "generation": {
              "signalId": "program-scoreboard",
              "signalLabel": "Program scoreboard",
              "generationId": "ui-generation-scoreboard"
            },
            "sourceState": "ready",
            "sourceStateVersion": "ui-state-v1",
            "requiresUserAction": false,
            "proofLedgerMapping": {
              "first_value": "activeUsers100.acceptedProof",
              "paymentIntent": "firstRevenue.learningSignal",
              "paymentRecord": "firstRevenue.acceptedProof"
            },
            "scoreboards": {
              "activeUsers100": {
                "acceptedCount": 7,
                "excludedCounts": {
                  "signup": 42,
                  "visitor": 1380,
                  "self-report": 3
                },
                "sourceState": "ready",
                "nextUnblockAction": "activation friction fix workpack"
              },
              "firstRevenue": {
                "acceptedCount": 0,
                "excludedCounts": {
                  "paymentIntent": 2
                },
                "sourceState": "manual_proof_required",
                "nextUnblockAction": "offer/paid ask follow-up plan"
              }
            }
          }
        }
        """,
        """
        {
          "type": "mission_card",
          "workspaceRoot": "/tmp/agentic30-ui-v2-daily-cards",
          "missionCard": {
            "id": "ui-gate-card",
            "type": "revenue_or_activation_gate",
            "schemaVersion": 1,
            "programDay": 14,
            "generation": {
              "signalId": "revenue-or-activation-gate",
              "signalLabel": "Revenue or activation gate",
              "generationId": "ui-generation-gate"
            },
            "sourceState": "missing",
            "sourceStateVersion": "ui-state-v1",
            "requiresUserAction": true,
            "proofLedgerMapping": {
              "first_value": "activeUsers100.acceptedProof",
              "paymentIntent": "firstRevenue.learningSignal"
            },
            "gate": "G4",
            "requires": ["first_value", "paymentIntent"],
            "satisfied": false,
            "blockingReasons": ["missing first_value source", "paymentRecord missing"],
            "recoveryBranch": "g4-recovery-instrumentation",
            "nextCardType": "office_hours_agent_workpack"
          }
        }
        """,
    ]

    @discardableResult
    fileprivate func installUITestingOfficeHoursReadinessFollowupSessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-readiness-followup") else {
            return false
        }
        if let selectedSession,
           selectedSession.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil,
           selectedSession.runtime?.officeHours?.day == 1,
           selectedSession.pendingUserInput?.generation?.docType == "day1_document_readiness" {
            return true
        }

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let now = Date()
        let today = formatter.string(from: now)
        day1GoalSelection = Day1GoalSelection(
            goalType: .getUsers,
            goalText: "이번 주 유료 진입점을 보여줄 실명 고객 1명을 고정한다",
            customer: "macOS에서 AI 코딩 도구를 매일 쓰는 전업 1인 개발자",
            problem: "AI로 제품은 만들지만 고객 행동 증거가 남지 않는다",
            validationAction: "가장 적합한 사용자 1명에게 이번 주 유료 진입점 보여주기",
            evidenceRefs: [".agentic30/docs/GOAL.md", ".agentic30/docs/ICP.md"],
            proofSink: .local,
            sourcePlanFingerprint: "ui-test-day1-readiness-followup",
            selectedAt: ISO8601DateFormatter().string(from: now)
        )
        dayProgress = DayProgress(
            challengeStartedAt: today,
            days: [
                "1": DayRecord(
                    day: 1,
                    kind: .day1,
                    steps: ["onboarding": .done, "scan": .done, "goal": .done, "first_interview": .active],
                    goalText: "이번 주 유료 진입점을 보여줄 실명 고객 1명을 고정한다",
                    updatedAt: today
                )
            ]
        )

        let sessionID = "ui-test-office-hours-readiness-followup-\(UUID().uuidString)"
        let prompt = Self.makeUITestingDay1DocumentReadinessPrompt(sessionID: sessionID, createdAt: now)
        func answer(_ index: Int, _ content: String) -> ChatMessage {
            ChatMessage(
                id: "ui-test-office-hours-readiness-answer-\(index)",
                role: .user,
                provider: selectedProvider,
                content: content,
                state: .final,
                createdAt: now.addingTimeInterval(TimeInterval(index)),
                error: nil,
                bipMissionChoices: nil,
                providerAuthActions: nil
            )
        }
        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .awaitingInput,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [
                answer(1, "관심 있는 사람은 있지만 아직 결제나 계약 조건은 없다"),
                answer(2, "지금은 Notion과 DM으로 인터뷰 기록을 수동 정리한다"),
                answer(3, "아는 1인 개발자 몇 명에게 물어볼 수 있다"),
                answer(4, "가장 작은 유료 작업은 30분 설정 세션일 것 같다"),
                answer(5, "직접 관찰한 행동은 아직 충분하지 않다"),
                answer(6, "앞으로 AI 빌드 속도보다 고객 증거가 병목이 될 것 같다"),
            ],
            pendingUserInput: prompt,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "ui_testing_day1_readiness_followup",
                    startedAt: ISO8601DateFormatter().string(from: now),
                    context: "UI test Day 1 Office Hours interview still gathering",
                    day: 1,
                    nextAction: OfficeHoursNextAction(kind: "card", cardType: "evidence_contract"),
                    gatherProgress: OfficeHoursGatherProgress(answered: 4, total: 6)
                )
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    private static func makeUITestingDay1DocumentReadinessPrompt(
        sessionID: String,
        createdAt: Date
    ) -> StructuredPromptRequest {
        StructuredPromptRequest(
            requestId: "ui-test-day1-document-readiness-followup",
            sessionId: sessionID,
            toolName: "agentic30_request_user_input",
            title: "Office Hours",
            createdAt: createdAt,
            intro: StructuredPromptIntro(
                title: "문서 저장 전 근거 보완",
                body: "모호함 47% / 기준 20% 이하. 예상 judge 5/10 / 기준 8/10. 저장 카드 전에 필요한 증거를 하나 더 좁힙니다.",
                bullets: [
                    "실명 고객 행동 증거가 아직 약합니다.",
                    "유료 진입점의 가격, 날짜, 결제 조건이 부족합니다."
                ]
            ),
            questions: [
                StructuredPromptQuestion(
                    questionId: "day1_document_readiness_followup",
                    header: "저장 전 증거",
                    question: "정식 문서 저장 전 가장 강한 고객 행동 증거는 무엇인가요?",
                    helperText: "선택 후 한 줄 근거를 적으면 문서 저장 준비도를 다시 계산합니다.",
                    options: [
                        StructuredPromptOption(
                            label: "실제 결제/계약 증거",
                            description: "실명 고객, 날짜, 가격 또는 계약 조건이 있어 문서 judge의 하드 증거로 쓸 수 있습니다.",
                            preview: nil,
                            nextIntent: "actual_payment_or_contract",
                            risk: nil,
                            evidenceTarget: "실명 고객, 날짜, 가격/계약 조건, 캡처나 기록",
                            mapsTo: "Q1 Demand Reality",
                            failureMode: "돈이나 계약 조건이 없으면 수요 증거가 아니라 관심 신호입니다."
                        ),
                        StructuredPromptOption(
                            label: "구매 조건 확정",
                            description: "가격, 범위, 일정, 결제권자 중 하나 이상이 구체적입니다.",
                            preview: nil,
                            nextIntent: "concrete_purchase_conditions",
                            risk: nil,
                            evidenceTarget: "가격, 범위, 구매 시점, 결제권자",
                            mapsTo: "Q1 Demand Reality",
                            failureMode: "조건이 모호하면 문서 저장 전 다시 좁혀야 합니다."
                        ),
                        StructuredPromptOption(
                            label: "아직 증거 부족",
                            description: "정식 문서 저장보다 실제 고객 행동 증거 확보가 먼저입니다.",
                            preview: nil,
                            nextIntent: "verbal_interest_or_no_evidence",
                            risk: nil,
                            evidenceTarget: "다음에 확인할 실명 고객 행동 증거",
                            mapsTo: "EVIDENCE.debt",
                            failureMode: "증거 없이 저장하면 문서가 실행 기준이 아니라 가정 목록이 됩니다."
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: false,
                    freeTextPlaceholder: "예: 김OO에게 3만원 1회 세션을 제안했고 금요일까지 결제 여부를 답받기로 했다",
                    textMode: .short
                )
            ],
            generation: StructuredPromptGeneration(
                mode: "office_hours",
                docType: "day1_document_readiness",
                signalId: "day1_document_readiness_followup",
                signalLabel: "문서 저장 전 근거"
            )
        )
    }

    @discardableResult
    fileprivate func installUITestingOfficeHoursDay1DocReadySessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-doc-ready") else {
            return false
        }
        if let selectedSession,
           selectedSession.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil,
           selectedSession.runtime?.officeHours?.day == 1,
           selectedSession.pendingUserInput == nil,
           selectedSession.status == .idle {
            return true
        }

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let now = Date()
        let today = formatter.string(from: now)
        day1GoalSelection = Day1GoalSelection(
            goalType: .getUsers,
            goalText: "이번 주 유료 진입점을 보여줄 실명 고객 1명을 고정한다",
            customer: "macOS에서 AI 코딩 도구를 매일 쓰는 전업 1인 개발자",
            problem: "AI로 제품은 만들지만 고객 행동 증거가 남지 않는다",
            validationAction: "가장 적합한 사용자 1명에게 이번 주 유료 진입점 보여주기",
            evidenceRefs: [".agentic30/docs/GOAL.md", ".agentic30/docs/ICP.md"],
            proofSink: .local,
            sourcePlanFingerprint: "ui-test-day1-doc-ready",
            selectedAt: ISO8601DateFormatter().string(from: now)
        )
        dayProgress = DayProgress(
            challengeStartedAt: today,
            days: [
                "1": DayRecord(
                    day: 1,
                    kind: .day1,
                    steps: ["onboarding": .done, "scan": .done, "goal": .done, "first_interview": .active],
                    goalText: "이번 주 유료 진입점을 보여줄 실명 고객 1명을 고정한다",
                    updatedAt: today
                )
            ]
        )

        let sessionID = "ui-test-office-hours-doc-ready-\(UUID().uuidString)"
        func answer(_ index: Int, _ content: String) -> ChatMessage {
            ChatMessage(
                id: "ui-test-office-hours-doc-ready-answer-\(index)",
                role: .user,
                provider: selectedProvider,
                content: content,
                state: .final,
                createdAt: now.addingTimeInterval(TimeInterval(index)),
                error: nil,
                bipMissionChoices: nil,
                providerAuthActions: nil
            )
        }
        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .idle,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [
                answer(1, "돈을 냈거나 제안한 후보가 있어 유료 진입점부터 검증한다"),
                answer(2, "지금은 Notion과 DM으로 인터뷰 기록을 수동 정리한다"),
                answer(3, "실명 후보 3명에게 이번 주 결제 요청을 보낼 수 있다"),
                answer(4, "가장 작은 유료 작업은 30분 설정 세션이다"),
                answer(5, "직접 관찰한 행동은 고객 검증을 미루고 코드만 더 쓰는 패턴이다"),
                answer(6, "앞으로 AI 빌드 속도보다 고객 증거가 더 큰 병목이 된다"),
            ],
            pendingUserInput: nil,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "ui_testing_day1_doc_ready",
                    startedAt: ISO8601DateFormatter().string(from: now),
                    context: "UI test completed Day 1 Office Hours",
                    day: 1,
                    nextAction: OfficeHoursNextAction(kind: "wait", waitReason: "action"),
                    gatherProgress: OfficeHoursGatherProgress(answered: 6, total: 6)
                )
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    @discardableResult
    fileprivate func installUITestingOfficeHoursDay2CompletedSessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-day2-completed") else {
            return false
        }
        if let selectedSession,
           selectedSession.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil,
           selectedSession.runtime?.officeHours?.day == 2,
           selectedSession.pendingUserInput == nil,
           selectedSession.status == .idle {
            return true
        }

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let now = Date()
        let yesterday = Calendar.current.date(byAdding: .day, value: -1, to: now) ?? now
        let startedAt = formatter.string(from: yesterday)
        let today = formatter.string(from: now)

        day1GoalSelection = Day1GoalSelection(
            goalType: .getUsers,
            goalText: "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다",
            customer: "전업 1인 개발자",
            problem: "AI로 제품은 만들지만 고객 행동 증거가 남지 않는다",
            validationAction: "가장 적합한 사용자 1명에게 이번 주 유료 진입점 보여주기",
            evidenceRefs: [".agentic30/docs/GOAL.md", ".agentic30/docs/ICP.md"],
            proofSink: .local,
            sourcePlanFingerprint: "ui-test-day2-completed",
            selectedAt: ISO8601DateFormatter().string(from: now)
        )
        dayProgress = DayProgress(
            challengeStartedAt: startedAt,
            days: [
                "1": DayRecord(
                    day: 1,
                    kind: .day1,
                    steps: ["onboarding": .done, "scan": .done, "goal": .done, "first_interview": .done],
                    goalText: "30일 안에 핵심 활성 행동을 끝낸 사용자 100명을 만든다",
                    updatedAt: startedAt
                ),
                "2": DayRecord(
                    day: 2,
                    kind: .standard,
                    steps: ["scan": .done, "retro": .done, "goal": .done, "interview": .active, "execution": .pending],
                    goalText: "오늘 가장 적합한 사용자 1명에게 유료 진입점 보여주기",
                    updatedAt: today
                ),
            ]
        )

        let sessionID = "ui-test-office-hours-day2-completed-\(UUID().uuidString)"
        func answer(_ index: Int, _ content: String) -> ChatMessage {
            ChatMessage(
                id: "ui-test-office-hours-day2-answer-\(index)",
                role: .user,
                provider: selectedProvider,
                content: content,
                state: .final,
                createdAt: now.addingTimeInterval(TimeInterval(index)),
                error: nil,
                bipMissionChoices: nil,
                providerAuthActions: nil
            )
        }
        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .idle,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [
                answer(1, "현재 대안에 시간을 쓰고 있다"),
                answer(2, "가장 적합한 사용자는 macOS에서 AI 코딩을 매일 쓰는 전업 1인 개발자"),
                answer(3, "지금은 노션과 수동 체크리스트로 검증 행동을 기록한다"),
                answer(4, "이번 주 유료 진입점은 30분 설정 세션이다"),
                answer(5, "직접 관찰한 행동은 고객 검증을 미루고 코드만 더 쓰는 패턴이다"),
                answer(6, "앞으로 더 중요해지는 이유는 AI 빌드 속도보다 고객 증거가 병목이 되기 때문이다"),
            ],
            pendingUserInput: nil,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                startupTiming: nil,
                iddDocumentType: "day2_step",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "office_hours_day_2",
                    startedAt: ISO8601DateFormatter().string(from: now),
                    context: "DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS\nUI test completed Day 2 Office Hours",
                    day: 2
                )
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    @discardableResult
    private func installUITestingOfficeHoursCommitmentGateSessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-commitment-gate") else {
            return false
        }
        if let selectedSession,
           selectedSession.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil,
           selectedSession.pendingUserInput == nil,
           selectedSession.status == .idle {
            return true
        }

        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())
        dayProgress = DayProgress(
            challengeStartedAt: today,
            days: [
                "1": DayRecord(
                    day: 1,
                    kind: .day1,
                    steps: ["onboarding": .done, "scan": .done, "goal": .done, "first_interview": .active],
                    goalText: "전업 1인 개발자에게 고객 증거를 만들게 한다",
                    updatedAt: today
                )
            ]
        )

        let now = Date()
        let sessionID = "ui-test-office-hours-commitment-\(UUID().uuidString)"
        func answer(_ index: Int, _ content: String) -> ChatMessage {
            ChatMessage(
                id: "ui-test-office-hours-answer-\(index)",
                role: .user,
                provider: selectedProvider,
                content: content,
                state: .final,
                createdAt: now.addingTimeInterval(TimeInterval(index)),
                error: nil,
                bipMissionChoices: nil,
                providerAuthActions: nil
            )
        }
        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .idle,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [
                answer(1, "돈을 냈거나 제안함"),
                answer(2, "스프레드시트와 메신저"),
                answer(3, "장지창, 전업 1인 개발자, 수익 전환이 막혀 있음"),
                answer(4, "유료 파일럿 1건"),
                answer(5, "직접 관찰했다"),
                answer(6, "더 필수적이다"),
            ],
            pendingUserInput: nil,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "ui_testing_structured_prompt",
                    startedAt: ISO8601DateFormatter().string(from: now),
                    context: "UI test Office Hours structured prompt",
                    day: 1
                )
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        installUITestingDay1BulkDocPreviews(completingSessionID: sessionID)
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    @discardableResult
    private func installUITestingOfficeHoursStructuredPromptSessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-structured-prompt") else {
            return false
        }
        seedUITestingTimelineFixtureIfNeeded()
        if day1GoalSelection == nil {
            let now = Date()
            day1GoalSelection = Day1GoalSelection(
                goalType: .getUsers,
                goalText: "이번 주 유료 진입점을 보여줄 실명 고객 1명을 고정한다",
                customer: "macOS에서 AI 코딩 도구를 매일 쓰는 전업 1인 개발자",
                problem: "AI로 제품은 만들지만 고객 행동 증거가 남지 않는다",
                validationAction: "가장 적합한 사용자 1명에게 이번 주 유료 진입점 보여주기",
                evidenceRefs: [".agentic30/docs/GOAL.md", ".agentic30/docs/ICP.md"],
                proofSink: .local,
                sourcePlanFingerprint: "ui-test-office-hours-structured-prompt",
                selectedAt: ISO8601DateFormatter().string(from: now)
            )
        }
        if let selectedSession,
           selectedSession.pendingUserInput?.title?.caseInsensitiveCompare("Office Hours") == .orderedSame
            || selectedSession.pendingUserInput?.generation?.mode?.hasPrefix("office_hours") == true {
            return true
        }

        let now = Date()
        let sessionID = "ui-test-office-hours-\(UUID().uuidString)"
        guard let prompt = Self.makeUITestingOfficeHoursStructuredPromptIfNeeded(
            sessionID: sessionID,
            createdAt: now
        ) else {
            return false
        }

        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .awaitingInput,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [],
            pendingUserInput: prompt,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "ui_testing_structured_prompt",
                    startedAt: ISO8601DateFormatter().string(from: now),
                    context: "UI test Office Hours structured prompt",
                    day: 1
                )
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        installUITestingOfficeHoursDay1ActiveProgressIfNeeded()
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    private func installUITestingOfficeHoursDay1ActiveProgressIfNeeded() {
        #if DEBUG
        guard dayProgress == nil else { return }
        let formatter = DateFormatter()
        formatter.calendar = Calendar(identifier: .gregorian)
        formatter.locale = Locale(identifier: "en_US_POSIX")
        formatter.timeZone = TimeZone.current
        formatter.dateFormat = "yyyy-MM-dd"
        let today = formatter.string(from: Date())
        dayProgress = DayProgress(
            challengeStartedAt: today,
            days: [
                "1": DayRecord(
                    day: 1,
                    kind: .day1,
                    steps: ["onboarding": .done, "scan": .done, "goal": .done, "first_interview": .active],
                    goalText: day1GoalSelection?.goalText ?? "Day 1 고객 증거 확인",
                    updatedAt: today
                )
            ]
        )
        #endif
    }

    @discardableResult
    private func installUITestingOfficeHoursRunningSessionIfNeeded() -> Bool {
        #if DEBUG
        guard CommandLine.arguments.contains("--ui-testing-seed-office-hours-running") else {
            return false
        }
        if let selectedSession,
           selectedSession.title.range(of: "Office Hours", options: [.caseInsensitive, .diacriticInsensitive]) != nil,
           selectedSession.status == .running {
            return true
        }

        let now = Date()
        let startedAt = ISO8601DateFormatter().string(from: now)
        let sessionID = "ui-test-office-hours-running-\(UUID().uuidString)"
        let session = ChatSession(
            id: sessionID,
            title: "Office Hours",
            provider: selectedProvider,
            model: preferredModel(for: selectedProvider),
            status: .running,
            createdAt: now,
            updatedAt: now,
            error: nil,
            messages: [
                ChatMessage(
                    id: "ui-test-office-hours-context",
                    role: .user,
                    provider: selectedProvider,
                    content: OfficeHoursTranscriptRow.syntheticStartPrompt,
                    state: .final,
                    createdAt: now,
                    error: nil,
                    bipMissionChoices: nil,
                    providerAuthActions: nil
                ),
                ChatMessage(
                    id: "ui-test-office-hours-answer",
                    role: .user,
                    provider: selectedProvider,
                    content: "시간을 반복 낭비함",
                    state: .final,
                    createdAt: now,
                    error: nil,
                    bipMissionChoices: nil,
                    providerAuthActions: nil
                ),
            ],
            pendingUserInput: nil,
            runtime: ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "ui_testing_running",
                    startedAt: startedAt,
                    context: "UI test Office Hours running state",
                    day: 1
                )
            )
        )
        sessions = [session]
        selectedSessionID = sessionID
        officeHoursSessionCreateInFlight = false
        refreshPresentationState()
        return true
        #else
        return false
        #endif
    }

    private static func makeUITestingDay1HandoffGoalPromptIfNeeded(
        sessionID requestedSessionID: String,
        createdAt: Date
    ) -> StructuredPromptRequest? {
        #if DEBUG
        let arguments = CommandLine.arguments
        guard arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt")
            || arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt-delayed") else {
            return nil
        }
        return StructuredPromptRequest(
            requestId: "ui-test-day1-handoff-goal-request",
            sessionId: requestedSessionID,
            toolName: "agentic30_request_user_input",
            title: "목표 정하기",
            createdAt: createdAt,
            questions: [
                StructuredPromptQuestion(
                    header: "이번 주 목표",
                    question: "이번 주에 가장 먼저 검증하거나 달성하려는 목표는 무엇인가요?",
                    helperText: "먼저 검증할 목표를 정합니다. 저장: .agentic30/docs/GOAL.md",
                    options: [
                        StructuredPromptOption(
                            label: "첫 고객 반응 확인",
                            description: "고객 후보가 답변, 미팅, 사용 시도 같은 실제 반응을 보이는지 봅니다.",
                            preview: nil,
                            nextIntent: "goal_customer_response"
                        ),
                        StructuredPromptOption(
                            label: "문제 강도 확인",
                            description: "현재 대안의 시간, 돈, 평판 비용을 실제로 겪는지 봅니다.",
                            preview: nil,
                            nextIntent: "goal_problem_intensity"
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: true,
                    requiresFreeText: false,
                    freeTextPlaceholder: "예: 이번 주 5명에게 요청하고 3명 이상 답하면 통과",
                    textMode: .short
                )
            ],
            generation: StructuredPromptGeneration(mode: "day1_handoff", docType: "goal")
        )
        #else
        return nil
        #endif
    }

    #if DEBUG
    private func seedUITestingDay1BulkDocHandoffIfNeeded(docType: String) -> Bool {
        let arguments = CommandLine.arguments
        guard docType == "all",
              arguments.contains("--ui-testing-disable-sidecar"),
              ProcessInfo.processInfo.environment["AGENTIC30_TEST_STUB_PROVIDER"] == "1" else {
            return false
        }

        guard let sessionID = selectedSessionID else {
            day1DocHandoffPendingDocType = nil
            day1DocHandoffAwaitingFollowupPrompt = false
            day1DocHandoffError = "UI testing Day 1 document handoff requires a selected Office Hours session."
            return true
        }

        if arguments.contains("--ui-testing-seed-day1-handoff-judge-block") {
            DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
                self?.installUITestingDay1HandoffJudgeBlock(attempt: 1)
            }
            return true
        }

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            self?.installUITestingDay1BulkDocPreviews(
                completingSessionID: sessionID,
                state: .written
            )
        }
        return true
    }

    private static func makeUITestingDay1HandoffJudgePrompt(
        sessionID: String,
        requestId: String,
        createdAt: Date,
        attempt: Int
    ) -> StructuredPromptRequest {
        StructuredPromptRequest(
            requestId: requestId,
            sessionId: sessionID,
            toolName: "agentic30_request_user_input",
            title: "Office Hours 저장 전 근거 보완",
            createdAt: createdAt,
            intro: StructuredPromptIntro(
                title: "문서 저장 전 근거 보완",
                body: "문서 judge 점수는 \(attempt == 1 ? "5" : "6")/10이고 기준은 8/10입니다. 정식 문서 저장 전 필요한 증거를 하나 고르세요.",
                bullets: ["다음 office-hours에서 추적할 열린 약속이 부족합니다.", "유료 진입점 증거가 더 구체적이어야 합니다."]
            ),
            questions: [
                StructuredPromptQuestion(
                    questionId: "day1_doc_handoff_judge_blocked",
                    header: "저장 전 증거",
                    question: attempt == 1
                        ? "이번 주 유료 진입점을 보여줄 실명 고객 행동 증거는 무엇인가요?"
                        : "문서 기준을 넘기려면 지금 확보한 hard evidence는 무엇인가요?",
                    helperText: "지금 답할 수 있는 가장 구체적인 보완 방향 하나를 선택하세요.",
                    options: [
                        StructuredPromptOption(
                            label: "실명 고객 3명에게 결제 요청 발송 완료",
                            description: "실명 후보 3명에게 가격/계약 조건을 포함한 결제 요청을 보냈고 캡처와 보낸 시각으로 확인할 수 있습니다.",
                            preview: nil,
                            nextIntent: "actual_payment_or_contract",
                            risk: nil,
                            evidenceTarget: "결제 요청 캡처와 보낸 시각",
                            mapsTo: "GOAL.activation_action",
                            failureMode: "오늘 3명에게 가격/계약 조건이 담긴 결제 요청을 못 보내면 이번 cycle은 실패입니다."
                        ),
                        StructuredPromptOption(
                            label: "열린 약속부터 추적",
                            description: "실명 후보, 날짜, 완료 조건이 있는 약속을 다음 Office Hours 근거로 삼습니다.",
                            preview: nil,
                            nextIntent: "track_open_commitment"
                        ),
                        StructuredPromptOption(
                            label: "증거 없음으로 보류",
                            description: "아직 정식 문서로 저장하지 않고, 먼저 실제 고객 행동 증거를 모읍니다.",
                            preview: nil,
                            nextIntent: "defer_until_hard_evidence"
                        ),
                    ],
                    multiSelect: false,
                    allowFreeText: false,
                    requiresFreeText: false,
                    freeTextPlaceholder: nil,
                    textMode: .short
                )
            ],
            generation: StructuredPromptGeneration(
                mode: "office_hours",
                docType: "day1_doc_handoff_judge",
                signalId: "day1_doc_handoff_judge_blocked",
                signalLabel: "저장 전 근거 보완",
                dimensionStepIndex: attempt,
                dimensionTotal: 6
            )
        )
    }

    private func installUITestingDay1HandoffJudgeBlock(attempt: Int) {
        day1DocHandoffPendingDocType = nil
        day1DocHandoffAwaitingFollowupPrompt = true
        iddSetupStatus = "error"
        day1DocHandoffError = "Office Hours 문서 judge가 \(attempt == 1 ? "5" : "6")/10으로 문서 리뷰를 보류했습니다. 기준은 8/10입니다."
        refreshPresentationState()

        DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
            self?.installUITestingDay1HandoffJudgePrompt(attempt: attempt)
        }
    }

    private func installUITestingDay1HandoffJudgePrompt(attempt: Int) {
        let sessionID = selectedSession?.id ?? "ui-test-day1-handoff-review-session"
        let now = Date()
        let prompt = Self.makeUITestingDay1HandoffJudgePrompt(
            sessionID: sessionID,
            requestId: "ui-test-day1-handoff-judge-request-\(attempt)",
            createdAt: now,
            attempt: attempt
        )
        let runtime = ChatSessionRuntime(
            codexThreadId: nil,
            codexThreadMeta: nil,
            startupTiming: nil,
            iddDocumentType: nil,
            iddMode: nil,
            officeHours: OfficeHoursRuntime(
                active: true,
                source: "ui_testing_day1_doc_review",
                startedAt: ISO8601DateFormatter().string(from: now),
                context: "UI test Day 1 document review",
                day: 1
            )
        )
        if let index = sessions.firstIndex(where: { $0.id == sessionID }) {
            if sessions[index].title.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                sessions[index].title = "Day 1 문서 리뷰"
            }
            sessions[index].status = .awaitingInput
            sessions[index].pendingUserInput = prompt
            sessions[index].runtime = runtime
            sessions[index].error = nil
            sessions[index].updatedAt = now
        } else {
            upsert(ChatSession(
                id: sessionID,
                title: "Day 1 문서 리뷰",
                provider: selectedProvider,
                model: preferredModel(for: selectedProvider),
                status: .awaitingInput,
                createdAt: now,
                updatedAt: now,
                error: nil,
                messages: [],
                pendingUserInput: prompt,
                runtime: runtime
            ))
        }
        day1DocHandoffAwaitingFollowupPrompt = false
        day1DocHandoffPendingDocType = nil
        refreshPresentationState()
    }

    private enum UITestingDay1BulkDocPreviewState {
        case ready
        case written

        var status: String {
            switch self {
            case .ready:
                return "ready"
            case .written:
                return "written"
            }
        }
    }

    private func installUITestingDay1BulkDocPreviews(
        completingSessionID sessionID: String,
        state: UITestingDay1BulkDocPreviewState = .written
    ) {
        let order = ["goal", "icp", "values", "spec"]
        let seededPreviews = [
            IddDocPreview(type: "goal", title: "GOAL", path: ".agentic30/docs/GOAL.md", status: state.status, content: "UI test GOAL handoff response"),
            IddDocPreview(type: "icp", title: "Ideal Customer Profile", path: ".agentic30/docs/ICP.md", status: state.status, content: "UI test customer candidate handoff response"),
            IddDocPreview(type: "values", title: "VALUES", path: ".agentic30/docs/VALUES.md", status: state.status, content: "UI test VALUES handoff response"),
            IddDocPreview(type: "spec", title: "SPEC", path: ".agentic30/docs/SPEC.md", status: state.status, content: "UI test SPEC handoff response"),
        ]
        var mergedPreviews = iddDocPreviews.filter { !order.contains($0.type) }
        mergedPreviews.append(contentsOf: seededPreviews)
        mergedPreviews.sort {
            (order.firstIndex(of: $0.type) ?? Int.max) < (order.firstIndex(of: $1.type) ?? Int.max)
        }
        iddDocPreviews = mergedPreviews
        iddSetupComplete = true
        iddSetupStatus = "approved"
        iddCurrentDocType = nil
        day1DocHandoffAwaitingFollowupPrompt = false
        day1DocHandoffPendingDocType = nil
        day1DocHandoffError = nil
        guard let sessionIndex = sessions.firstIndex(where: { $0.id == sessionID }) else {
            day1DocHandoffError = "UI testing Day 1 document handoff completed without a matching Office Hours session: \(sessionID)"
            assertionFailure(day1DocHandoffError ?? "Missing Office Hours session")
            refreshPresentationState()
            return
        }
        var runtime = sessions[sessionIndex].runtime ?? ChatSessionRuntime(
            codexThreadId: nil,
            codexThreadMeta: nil,
            startupTiming: nil,
            iddDocumentType: "day1_step",
            iddMode: "office_hours",
            officeHours: nil
        )
        var officeHours = runtime.officeHours ?? OfficeHoursRuntime(
            active: true,
            source: "ui_testing_day1_doc_ready",
            startedAt: ISO8601DateFormatter().string(from: Date()),
            context: "UI test completed Day 1 Office Hours",
            day: 1
        )
        officeHours.nextAction = OfficeHoursNextAction(kind: "wait", waitReason: "action")
        officeHours.gatherProgress = OfficeHoursGatherProgress(answered: 6, total: 6)
        runtime.officeHours = officeHours
        sessions[sessionIndex].runtime = runtime
        sessions[sessionIndex].pendingUserInput = nil
        sessions[sessionIndex].status = .idle
        sessions[sessionIndex].error = nil
        sessions[sessionIndex].updatedAt = .now
        submittedStructuredPromptBySession.removeValue(forKey: sessionID)
        structuredPromptDraftBySession.removeValue(forKey: sessionID)
        officeHoursLiveStatusBySession.removeValue(forKey: sessionID)
        refreshPresentationState()
    }

    private func seedUITestingDay1DocHandoffPromptIfNeeded(docType: String) -> Bool {
        let arguments = CommandLine.arguments
        let shouldSeedImmediately = arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt")
        let shouldSeedAfterDelay = arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt-delayed")
        guard (shouldSeedImmediately || shouldSeedAfterDelay),
              docType == "goal" else {
            return false
        }

        if shouldSeedAfterDelay {
            DispatchQueue.main.asyncAfter(deadline: .now() + 0.35) { [weak self] in
                self?.installUITestingDay1DocHandoffPrompt(docType: docType, forceNewSession: true)
            }
            return true
        }

        installUITestingDay1DocHandoffPrompt(docType: docType, forceNewSession: false)
        return true
    }

    @discardableResult
    private func installUITestingDay1DocHandoffPrompt(docType: String, forceNewSession: Bool) -> Bool {
        let now = Date()
        let sessionID = forceNewSession
            ? "ui-test-day1-handoff-\(docType)-\(UUID().uuidString)"
            : selectedSessionID ?? sessions.first?.id ?? UUID().uuidString
        guard let prompt = Self.makeUITestingDay1HandoffGoalPromptIfNeeded(
            sessionID: sessionID,
            createdAt: now
        ) else {
            return false
        }

        if var session = sessions.first(where: { $0.id == sessionID }) {
            session.title = "Day 1 Handoff: GOAL"
            session.status = .awaitingInput
            session.updatedAt = now
            session.error = nil
            session.pendingUserInput = prompt
            if session.runtime == nil {
                session.runtime = ChatSessionRuntime(
                    codexThreadId: nil,
                    codexThreadMeta: nil,
                    startupTiming: nil,
                    iddDocumentType: docType,
                    iddMode: "day1_handoff"
                )
            } else {
                session.runtime?.iddDocumentType = docType
                session.runtime?.iddMode = "day1_handoff"
            }
            upsert(session)
        } else {
            let provider = selectedProvider
            upsert(ChatSession(
                id: sessionID,
                title: "Day 1 Handoff: GOAL",
                provider: provider,
                model: preferredModel(for: provider),
                status: .awaitingInput,
                createdAt: now,
                updatedAt: now,
                error: nil,
                messages: [],
                pendingUserInput: prompt,
                runtime: ChatSessionRuntime(
                    codexThreadId: nil,
                    codexThreadMeta: nil,
                    startupTiming: nil,
                    iddDocumentType: docType,
                    iddMode: "day1_handoff"
                )
            ))
        }

        selectedSessionID = sessionID
        iddSetupStatus = "interviewing"
        iddCurrentDocType = docType
        day1DocHandoffPendingDocType = docType
        day1DocHandoffAwaitingFollowupPrompt = false
        day1DocHandoffError = nil
        refreshPresentationState()
        return true
    }

    private func completeUITestingDay1DocHandoffSubmissionIfNeeded(
        sessionId: String,
        requestId: String,
        promptBeforeLocalSubmission: StructuredPromptRequest?
    ) -> Bool {
        let arguments = CommandLine.arguments
        guard (arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt")
                || arguments.contains("--ui-testing-seed-day1-handoff-goal-prompt-delayed")),
              let sessionIndex = sessions.firstIndex(where: { $0.id == sessionId }),
              let prompt = promptBeforeLocalSubmission ?? sessions[sessionIndex].pendingUserInput,
              prompt.requestId == requestId,
              prompt.generation?.mode == "day1_handoff",
              let docType = prompt.generation?.docType?.trimmingCharacters(in: .whitespacesAndNewlines).lowercased(),
              !docType.isEmpty else {
            return false
        }

        let docMeta: (title: String, path: String)
        switch docType {
        case "goal":
            docMeta = ("GOAL", ".agentic30/docs/GOAL.md")
        case "icp":
            docMeta = ("Ideal Customer Profile", ".agentic30/docs/ICP.md")
        case "values":
            docMeta = ("VALUES", ".agentic30/docs/VALUES.md")
        case "spec":
            docMeta = ("SPEC", ".agentic30/docs/SPEC.md")
        default:
            docMeta = (docType.uppercased(), ".agentic30/docs/\(docType.uppercased()).md")
        }

        let writtenPreview = IddDocPreview(
            type: docType,
            title: docMeta.title,
            path: docMeta.path,
            status: "written",
            content: "UI test handoff response"
        )
        if let previewIndex = iddDocPreviews.firstIndex(where: { $0.type == docType }) {
            iddDocPreviews[previewIndex] = writtenPreview
        } else {
            iddDocPreviews.append(writtenPreview)
        }
        let order = ["goal", "icp", "values", "spec"]
        iddDocPreviews.sort {
            (order.firstIndex(of: $0.type) ?? Int.max) < (order.firstIndex(of: $1.type) ?? Int.max)
        }

        sessions[sessionIndex].pendingUserInput = nil
        sessions[sessionIndex].status = .idle
        sessions[sessionIndex].error = nil
        sessions[sessionIndex].updatedAt = .now
        submittedStructuredPromptBySession.removeValue(forKey: sessionId)
        structuredPromptDraftBySession.removeValue(forKey: sessionId)
        day1DocHandoffPendingDocType = nil
        day1DocHandoffAwaitingFollowupPrompt = false
        day1DocHandoffError = nil
        iddCurrentDocType = order.drop(while: { $0 != docType }).dropFirst().first
        refreshPresentationState()
        return true
    }

    private func completeUITestingDay1HandoffJudgeSubmissionIfNeeded(
        sessionId: String,
        requestId: String,
        responses: [StructuredPromptSubmission],
        promptBeforeLocalSubmission: StructuredPromptRequest?
    ) -> Bool {
        let arguments = CommandLine.arguments
        guard arguments.contains("--ui-testing-seed-day1-handoff-judge-block"),
              let sessionIndex = sessions.firstIndex(where: { $0.id == sessionId }),
              let prompt = promptBeforeLocalSubmission ?? sessions[sessionIndex].pendingUserInput,
              prompt.requestId == requestId,
              prompt.generation?.mode == "office_hours",
              prompt.generation?.docType == "day1_doc_handoff_judge" else {
            return false
        }

        let selectedOptions = responses.flatMap(\.selectedOptions)
        let hasHardEvidence = selectedOptions.contains("실명 고객 3명에게 결제 요청 발송 완료")
        let currentAttempt = prompt.generation?.dimensionStepIndex ?? 1

        sessions[sessionIndex].pendingUserInput = nil
        sessions[sessionIndex].status = .running
        sessions[sessionIndex].error = nil
        sessions[sessionIndex].updatedAt = .now
        submittedStructuredPromptBySession.removeValue(forKey: sessionId)
        structuredPromptDraftBySession.removeValue(forKey: sessionId)
        day1DocHandoffPendingDocType = "all"
        day1DocHandoffAwaitingFollowupPrompt = false
        day1DocHandoffError = nil
        refreshPresentationState()

        DispatchQueue.main.asyncAfter(deadline: .now() + 1.2) { [weak self] in
            guard let self else { return }
            if hasHardEvidence {
                self.installUITestingDay1BulkDocPreviews(
                    completingSessionID: sessionId,
                    state: .written
                )
            } else {
                self.installUITestingDay1HandoffJudgeBlock(attempt: currentAttempt + 1)
            }
        }
        return true
    }

    private func completeUITestingOfficeHoursStructuredSubmissionIfNeeded(
        sessionId: String,
        requestId: String,
        promptBeforeLocalSubmission: StructuredPromptRequest?
    ) -> Bool {
        let arguments = CommandLine.arguments
        guard arguments.contains("--ui-testing-seed-office-hours-structured-prompt"),
              let sessionIndex = sessions.firstIndex(where: { $0.id == sessionId }) else {
            return false
        }
        guard sessions[sessionIndex].pendingUserInput?.requestId == requestId else {
            return true
        }
        guard
              let prompt = promptBeforeLocalSubmission ?? sessions[sessionIndex].pendingUserInput,
              prompt.requestId == requestId else {
            return false
        }

        let currentStep = prompt.generation?.dimensionStepIndex ?? (requestId == "ui-test-office-hours-request" ? 1 : 6)
        let totalSteps = prompt.generation?.dimensionTotal ?? 6
        let now = Date()
        sessions[sessionIndex].pendingUserInput = nil
        sessions[sessionIndex].status = .running
        sessions[sessionIndex].error = nil
        sessions[sessionIndex].updatedAt = now
        officeHoursLiveStatusBySession[sessionId] = OfficeHoursLiveStatus(
            sessionId: sessionId,
            stage: "specialist_routed",
            title: "다음 질문 생성 중",
            detail: "UI test Office Hours structured prompt is generating the next question.",
            progressText: nil,
            messageId: nil,
            requestId: requestId,
            elapsedMs: nil,
            updatedAt: now
        )
        submittedStructuredPromptBySession.removeValue(forKey: sessionId)
        structuredPromptDraftBySession.removeValue(forKey: sessionId)
        refreshPresentationState()

        if prompt.generation?.signalId == "get_users_active_user_definition" {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 900_000_000)
                guard let self,
                      let refreshedIndex = self.sessions.firstIndex(where: { $0.id == sessionId }) else {
                    return
                }
                self.installUITestingDay1BulkDocPreviews(
                    completingSessionID: self.sessions[refreshedIndex].id,
                    state: .ready
                )
            }
            return true
        }

        if prompt.generation?.signalId == "get_users_today_request" {
            let nextPrompt = Self.makeUITestingOfficeHoursGetUsersEvidencePrompt(
                sessionID: sessionId,
                requestId: "ui-test-office-hours-get-users-evidence",
                createdAt: now
            )
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard let self,
                      let refreshedIndex = self.sessions.firstIndex(where: { $0.id == sessionId }) else {
                    return
                }
                self.sessions[refreshedIndex].pendingUserInput = nextPrompt
                self.sessions[refreshedIndex].status = .awaitingInput
                self.sessions[refreshedIndex].error = nil
                self.sessions[refreshedIndex].updatedAt = Date()
                self.officeHoursLiveStatusBySession[sessionId] = OfficeHoursLiveStatus(
                    sessionId: sessionId,
                    stage: "question_ready",
                    title: "다음 질문 준비됨",
                    detail: nil,
                    progressText: nil,
                    messageId: nil,
                    requestId: nextPrompt.requestId,
                    elapsedMs: nil,
                    updatedAt: Date()
                )
                self.refreshPresentationState()
            }
            return true
        }

        if prompt.generation?.signalId == "get_users_evidence_format" {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 900_000_000)
                guard let self,
                      let refreshedIndex = self.sessions.firstIndex(where: { $0.id == sessionId }) else {
                    return
                }
                self.installUITestingDay1BulkDocPreviews(
                    completingSessionID: self.sessions[refreshedIndex].id,
                    state: .ready
                )
            }
            return true
        }

        if currentStep < totalSteps {
            let nextStep = currentStep + 1
            let nextPrompt = Self.makeUITestingOfficeHoursStructuredPrompt(
                sessionID: sessionId,
                requestId: "ui-test-office-hours-request-\(nextStep)",
                createdAt: now,
                step: nextStep
            )
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard let self,
                      let refreshedIndex = self.sessions.firstIndex(where: { $0.id == sessionId }) else {
                    return
                }
                self.sessions[refreshedIndex].pendingUserInput = nextPrompt
                self.sessions[refreshedIndex].status = .awaitingInput
                self.sessions[refreshedIndex].error = nil
                self.sessions[refreshedIndex].updatedAt = Date()
                self.officeHoursLiveStatusBySession[sessionId] = OfficeHoursLiveStatus(
                    sessionId: sessionId,
                    stage: "question_ready",
                    title: "다음 질문 준비됨",
                    detail: nil,
                    progressText: nil,
                    messageId: nil,
                    requestId: nextPrompt.requestId,
                    elapsedMs: nil,
                    updatedAt: Date()
                )
                self.refreshPresentationState()
            }
        } else {
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 900_000_000)
                guard let self,
                      let refreshedIndex = self.sessions.firstIndex(where: { $0.id == sessionId }) else {
                    return
                }
                self.installUITestingDay1BulkDocPreviews(
                    completingSessionID: self.sessions[refreshedIndex].id,
                    state: .ready
                )
            }
        }
        return true
    }

    func completeUITestingOfficeHoursStructuredPromptIfNeeded(_ prompt: StructuredPromptRequest) -> Bool {
        completeUITestingOfficeHoursStructuredSubmissionIfNeeded(
            sessionId: prompt.sessionId,
            requestId: prompt.requestId,
            promptBeforeLocalSubmission: prompt
        )
    }

    @discardableResult
    private func completeUITestingOfficeHoursRevisionIfNeeded(
        sessionId: String,
        requestId: String,
        prompt: StructuredPromptRequest
    ) -> Bool {
        let arguments = CommandLine.arguments
        guard arguments.contains("--ui-testing-seed-office-hours-structured-prompt"),
              let sessionIndex = sessions.firstIndex(where: { $0.id == sessionId }),
              prompt.requestId == requestId else {
            return false
        }

        let currentStep = prompt.generation?.dimensionStepIndex
            ?? (requestId == "ui-test-office-hours-request" ? 1 : 6)
        let totalSteps = prompt.generation?.dimensionTotal ?? 6
        let now = Date()
        if currentStep < totalSteps {
            let nextStep = currentStep + 1
            let nextPrompt = Self.makeUITestingOfficeHoursStructuredPrompt(
                sessionID: sessionId,
                requestId: "ui-test-office-hours-request-\(nextStep)-revised",
                createdAt: now,
                step: nextStep
            )
            sessions[sessionIndex].pendingUserInput = nil
            sessions[sessionIndex].status = .running
            Task { @MainActor [weak self] in
                try? await Task.sleep(nanoseconds: 1_500_000_000)
                guard let self,
                      let refreshedIndex = self.sessions.firstIndex(where: { $0.id == sessionId }) else {
                    return
                }
                self.sessions[refreshedIndex].pendingUserInput = nextPrompt
                self.sessions[refreshedIndex].status = .awaitingInput
                self.sessions[refreshedIndex].error = nil
                self.sessions[refreshedIndex].updatedAt = Date()
                self.refreshPresentationState()
            }
        } else {
            sessions[sessionIndex].pendingUserInput = nil
            sessions[sessionIndex].status = .idle
        }
        sessions[sessionIndex].messages = []
        sessions[sessionIndex].error = nil
        sessions[sessionIndex].updatedAt = now
        if sessions[sessionIndex].runtime == nil {
            sessions[sessionIndex].runtime = ChatSessionRuntime(
                codexThreadId: nil,
                codexThreadMeta: nil,
                startupTiming: nil,
                iddDocumentType: "day1_step",
                iddMode: "office_hours",
                officeHours: OfficeHoursRuntime(
                    active: true,
                    source: "ui_testing_revision",
                    startedAt: ISO8601DateFormatter().string(from: now),
                    context: "UI test Office Hours revision",
                    day: 1
                )
            )
        } else {
            sessions[sessionIndex].runtime?.iddDocumentType = "day1_step"
            sessions[sessionIndex].runtime?.iddMode = "office_hours"
            sessions[sessionIndex].runtime?.officeHours = OfficeHoursRuntime(
                active: true,
                source: "ui_testing_revision",
                startedAt: sessions[sessionIndex].runtime?.officeHours?.startedAt
                    ?? ISO8601DateFormatter().string(from: now),
                context: sessions[sessionIndex].runtime?.officeHours?.context
                    ?? "UI test Office Hours revision",
                day: sessions[sessionIndex].runtime?.officeHours?.day ?? 1
            )
        }
        submittedStructuredPromptBySession.removeValue(forKey: sessionId)
        structuredPromptDraftBySession.removeValue(forKey: sessionId)
        refreshPresentationState()
        return true
    }
    #endif

    private func seedInlineUITestBipCoachIfNeeded() {
        #if DEBUG
        let seedCurrentMission = CommandLine.arguments.contains("--ui-testing-seed-bip-current-mission")
        let seedCompletedMission = CommandLine.arguments.contains("--ui-testing-seed-bip-completed-mission")
        let seedLocalMissionChoices = CommandLine.arguments.contains("--ui-testing-seed-bip-local-mission-choices")
        let seedCoachError = CommandLine.arguments.contains("--ui-testing-seed-bip-coach-error")
        guard (seedCurrentMission || seedCompletedMission || seedLocalMissionChoices || seedCoachError),
              let sessionID = selectedSessionID else {
            return
        }

        if seedCurrentMission || seedCompletedMission || seedCoachError {
            var readiness = BipReadinessState.loading
            for rowID in BipReadinessRowId.bipCoachSetupCases {
                readiness.rows[rowID] = BipReadinessRow(
                    id: rowID,
                    status: .done,
                    detail: nil,
                    log: nil,
                    error: nil
                )
            }
            bipReadiness = readiness
        }
        if seedCoachError {
            bipCoach = Self.makeUITestingBipCoachErrorState(sessionID: sessionID)
            return
        }
        bipCoach = seedLocalMissionChoices
            ? Self.makeUITestingLocalBipCoachState(sessionID: sessionID)
            : Self.makeUITestingBipCoachState(sessionID: sessionID, isCompleted: seedCompletedMission)
        #endif
    }

    private func applyUITestingIddSetupSeeds(arguments: [String]) {
        #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
        guard arguments.contains("--ui-testing-seed-idd-complete") else { return }
        iddSetupComplete = true
        iddSetupStatus = "approved"
        iddCurrentDocType = nil
        iddAmbiguityScore = 12
        iddUnresolvedAssumptions = []
        iddDocOrder = ["icp", "goal", "values", "spec"]
        iddDocPreviews = [
            IddDocPreview(type: "icp", title: "Ideal Customer Profile", path: ".agentic30/docs/ICP.md", status: "approved", content: "Seed customer candidate"),
            IddDocPreview(type: "goal", title: "GOAL", path: ".agentic30/docs/GOAL.md", status: "approved", content: "Seed GOAL"),
            IddDocPreview(type: "values", title: "VALUES", path: ".agentic30/docs/VALUES.md", status: "approved", content: "Seed VALUES"),
            IddDocPreview(type: "spec", title: "SPEC", path: ".agentic30/docs/SPEC.md", status: "approved", content: "Seed SPEC"),
        ]
        iddProviderRecovery = nil
        iddSetupError = nil
        #endif
    }

    private static func makeUITestingBipCoachState(sessionID: String, isCompleted: Bool = false) -> BipCoachState {
        BipCoachState(
            schemaVersion: 1,
            updatedAt: Date(),
            sessionId: sessionID,
            config: BipCoachConfig(
                provider: .codex,
                threadsHandle: "october",
                sheetUrl: nil,
                sheetId: "sheet-1",
                sheetTabName: nil,
                docUrl: nil,
                docId: "doc-1",
                morningHour: 10,
                eveningHour: 21
            ),
            evidence: nil,
            missionChoices: [],
            currentMission: BipCoachMission(
                id: "ui-test-bip-mission",
                date: "2026-04-27",
                provider: AgentProvider.codex.rawValue,
                status: isCompleted ? "completed" : "drafted",
                compact: false,
                title: "오늘 배운 점을 Threads에 공개하기",
                angle: "작게 배운 것을 공개 기록으로 바꾸기",
                mission: "오늘 작업에서 배운 점 1개와 다음 액션 1개를 Threads에 올리세요.",
                curriculumDay: isCompleted ? BipCoachCurriculumDay(day: 1) : nil,
                drafts: [],
                eveningChecklist: ["Threads URL 남기기", "Sheet 행 메모 남기기"],
                evidenceRefs: [],
                generatedAt: Date(),
                completedAt: isCompleted ? Date() : nil,
                completedQuestionCount: isCompleted ? 3 : nil,
                threadsUrl: isCompleted ? "https://threads.net/@october/post/proof" : nil,
                sheetRowNote: isCompleted ? "오늘 배운 점과 다음 액션 기록" : nil
            ),
            streak: BipCoachStreak(current: 1, longest: 2, lastCompletedDate: nil),
            lastError: nil
        )
    }

    private static func makeUITestingBipCoachErrorState(sessionID: String) -> BipCoachState {
        BipCoachState(
            schemaVersion: 1,
            updatedAt: Date(),
            sessionId: sessionID,
            config: BipCoachConfig(
                provider: .codex,
                threadsHandle: "october",
                sheetUrl: nil,
                sheetId: "sheet-1",
                sheetTabName: nil,
                docUrl: nil,
                docId: "doc-1",
                morningHour: 10,
                eveningHour: 21
            ),
            evidence: nil,
            missionChoices: [],
            currentMission: BipCoachMission(
                id: "ui-test-bip-error-mission",
                date: "2026-04-27",
                provider: AgentProvider.codex.rawValue,
                status: "drafted",
                compact: false,
                title: "오류 재시도 표면 확인",
                angle: "실패를 명확히 보여주고 다시 시도할 수 있게 하기",
                mission: "BIP coach 오류 배너와 복구 동작을 확인합니다.",
                curriculumDay: BipCoachCurriculumDay(day: 1),
                drafts: [],
                eveningChecklist: ["오류 메시지 확인", "다시 시도 버튼 확인"],
                evidenceRefs: [],
                generatedAt: Date(),
                completedAt: nil,
                completedQuestionCount: nil,
                threadsUrl: nil,
                sheetRowNote: nil
            ),
            streak: BipCoachStreak(current: 0, longest: 0, lastCompletedDate: nil),
            lastError: "UI 테스트: BIP coach 요청이 실패했습니다. 다시 시도하세요."
        )
    }

    private static func makeUITestingLocalBipCoachState(sessionID: String) -> BipCoachState {
        let now = Date()
        let choices = [
            BipCoachMission(
                id: "ui-test-local-mission-1",
                date: "2026-04-30",
                provider: AgentProvider.codex.rawValue,
                status: "drafted",
                compact: true,
                title: "첫 고객 후보 3명 정하기",
                angle: "Google 설정 전에도 프로젝트 기준으로 오늘 실행을 시작하기",
                mission: "현재 프로젝트를 가장 자주 겪을 사람 3명을 적고 첫 질문 하나를 보냅니다.",
                curriculumDay: nil,
                drafts: [],
                eveningChecklist: ["후보 3명 적기", "첫 질문 1개 보내기"],
                evidenceRefs: [],
                generatedAt: now,
                completedAt: nil,
                completedQuestionCount: nil,
                threadsUrl: nil,
                sheetRowNote: nil
            )
        ]

        return BipCoachState(
            schemaVersion: 1,
            updatedAt: now,
            sessionId: sessionID,
            config: BipCoachConfig(
                provider: .codex,
                threadsHandle: nil,
                sheetUrl: nil,
                sheetId: nil,
                sheetTabName: nil,
                docUrl: nil,
                docId: nil,
                morningHour: 10,
                eveningHour: 21
            ),
            evidence: nil,
            missionChoices: choices,
            currentMission: nil,
            streak: BipCoachStreak(current: 0, longest: 0, lastCompletedDate: nil),
            lastError: nil
        )
    }

    private func appendInlineUITestStubResponse(prompt: String, sessionID: String) {
        guard let index = sessions.firstIndex(where: { $0.id == sessionID }) else { return }
        let now = Date()
        let provider = sessions[index].provider
        let userMessage = ChatMessage(
            id: UUID().uuidString,
            role: .user,
            provider: provider,
            content: prompt,
            state: .final,
            createdAt: now,
            error: nil,
            bipMissionChoices: nil,
            providerAuthActions: nil
        )
        let assistantMessage = ChatMessage(
            id: UUID().uuidString,
            role: .assistant,
            provider: provider,
            content: inlineUITestStubResponse(for: prompt),
            state: .final,
            createdAt: now,
            error: nil,
            bipMissionChoices: nil,
            providerAuthActions: nil
        )
        sessions[index].messages.append(contentsOf: [userMessage, assistantMessage])
        sessions[index].status = .idle
        sessions[index].error = nil
        sessions[index].updatedAt = now
        sessions = sessions
        refreshPresentationState()
    }

    private func appendInlineUITestDay1ICPConversationIfNeeded() {
        guard ProcessInfo.processInfo.environment["AGENTIC30_UI_TEST_AUTORUN_DAY1_ICP_CONVERSATION"] == "1" else {
            return
        }
        guard let sessionID = selectedSessionID else { return }
        guard let session = selectedSession else { return }
        guard !session.messages.contains(where: { $0.content.contains("DAY1_ICP_TURN_5") }) else { return }

        let turns = [
            "DAY1_ICP_TURN_1: Day 1 시작. .agentic30/docs/ICP.md 기준으로 내가 맞는 고객 후보인지 먼저 진단해줘.",
            "DAY1_ICP_TURN_2: 나는 퇴사한 전업 1인 개발자이고 수익은 0원, macOS에서 Codex를 쓴다. Day 1 현재 상태를 판정해줘.",
            "DAY1_ICP_TURN_3: 이미 소개 페이지와 작은 프로토타입은 있다. Day 1 백지 상태의 고객 탐색이 아니라 빠른 경로로 가야 하는지 확인해줘.",
            "DAY1_ICP_TURN_4: SPEC.md v0 현재 기준에는 어떤 현재 상태와 다음 검증 기준을 남겨야 해?",
            "DAY1_ICP_TURN_5: 5턴 대화의 결론으로 오늘 바로 실행할 우선순위 1개와 확인할 응답을 정리해줘.",
        ]
        for prompt in turns {
            appendInlineUITestStubResponse(prompt: prompt, sessionID: sessionID)
        }
    }

    private func inlineUITestStubResponse(for prompt: String) -> String {
        if prompt.contains("DAY1_ICP_TURN") {
            return [
                "고객 후보 문서 확인: 전업 1인 개발자, 수익 0원, macOS, 고객 인터뷰 의향이 있는 사용자로 가정했습니다.",
                "Day 1 응답: 현재 상태 진단을 먼저 하고, 기존 자산이 있으면 백지 상태의 고객 탐색 대신 빠른 경로로 SPEC.md v0 현재 기준과 다음 검증 기준을 정합니다.",
            ].joined(separator: "\n")
        }
        return "테스트 응답: \(prompt)"
    }

    private func preferredModel(for provider: AgentProvider) -> String {
        let environment = ProcessInfo.processInfo.environment
        switch provider {
        case .claude:
            if let value = firstNonEmptyEnvironmentValue(
                ["AGENTIC30_CLAUDE_MODEL", "ANTHROPIC_MODEL"],
                in: environment
            ) {
                return value
            }
            return KeychainHelper.loadSettings().preferredClaudeModel
        case .codex:
            if let value = firstNonEmptyEnvironmentValue(
                ["AGENTIC30_CODEX_MODEL", "CODEX_MODEL", "OPENAI_MODEL"],
                in: environment
            ) {
                return value
            }
            return KeychainHelper.loadSettings().preferredCodexModel
        case .gemini:
            if let value = firstNonEmptyEnvironmentValue(
                ["AGENTIC30_GEMINI_MODEL", "GEMINI_MODEL", "GOOGLE_GENAI_MODEL"],
                in: environment
            ) {
                return value
            }
            return KeychainHelper.loadSettings().preferredGeminiModel
        case .cursor:
            if let value = firstNonEmptyEnvironmentValue(
                ["AGENTIC30_CURSOR_MODEL", "CURSOR_MODEL"],
                in: environment
            ) {
                return value
            }
            return KeychainHelper.loadSettings().preferredCursorModel
        }
    }

    private func providerSettingsPayload(from settings: KeychainHelper.Settings) -> [String: Any] {
        [
            AgentProvider.claude.rawValue: [
                "authMode": AgentAuthMode.normalized(settings.claudeAuthMode, provider: .claude).rawValue,
                "apiKey": settings.claudeApiKey,
                "environment": settings.claudeEnvironment,
                "model": settings.preferredClaudeModel,
                "reasoningEffort": AgentReasoningEffortCatalog.normalized(
                    settings.claudeReasoningEffort,
                    provider: .claude,
                    modelID: settings.preferredClaudeModel
                ),
            ],
            AgentProvider.codex.rawValue: [
                "authMode": AgentAuthMode.normalized(settings.codexAuthMode, provider: .codex).rawValue,
                "apiKey": settings.codexApiKey,
                "environment": settings.codexEnvironment,
                "model": settings.preferredCodexModel,
                "reasoningEffort": AgentReasoningEffortCatalog.normalized(
                    settings.codexReasoningEffort,
                    provider: .codex,
                    modelID: settings.preferredCodexModel
                ),
            ],
            AgentProvider.gemini.rawValue: [
                "authMode": AgentAuthMode.normalized(settings.geminiAuthMode, provider: .gemini).rawValue,
                "apiKey": settings.geminiApiKey,
                "environment": settings.geminiEnvironment,
                "model": settings.preferredGeminiModel,
                "reasoningEffort": AgentReasoningEffortCatalog.normalized(
                    settings.geminiReasoningEffort,
                    provider: .gemini,
                    modelID: settings.preferredGeminiModel
                ),
            ],
            AgentProvider.cursor.rawValue: [
                "authMode": AgentAuthMode.normalized(settings.cursorAuthMode, provider: .cursor).rawValue,
                "apiKey": settings.cursorApiKey,
                "environment": settings.cursorEnvironment,
                "model": settings.preferredCursorModel,
                "reasoningEffort": AgentReasoningEffortCatalog.normalized(
                    AgentReasoningEffortCatalog.autoID,
                    provider: .cursor,
                    modelID: settings.preferredCursorModel
                ),
            ],
        ]
    }

    nonisolated private static func shellQuoted(_ value: String) -> String {
        "'\(value.replacingOccurrences(of: "'", with: "'\\''"))'"
    }

    nonisolated private static func appleScriptLiteral(_ value: String) -> String {
        "\"\(value.replacingOccurrences(of: "\\", with: "\\\\").replacingOccurrences(of: "\"", with: "\\\""))\""
    }

    private func firstNonEmptyEnvironmentValue(
        _ keys: [String],
        in environment: [String: String]
    ) -> String? {
        for key in keys {
            if let rawValue = environment[key] {
                let value = rawValue.trimmingCharacters(in: .whitespacesAndNewlines)
                if !value.isEmpty {
                    return value
                }
            }
        }
        return nil
    }

    #if DEBUG
    func replaceSessionsForTesting(_ sessions: [ChatSession], selectedSessionID: String? = nil) {
        self.sessions = sessions
        self.selectedSessionID = selectedSessionID ?? sessions.first?.id
    }

    func markSidecarConnectedForTesting(workspaceRoot: String) {
        self.workspaceRoot = workspaceRoot
        connectionLabel = "Connected"
        isConnected = true
        flushPendingProjectContextRefreshIfNeeded()
    }

    func setDay1DocHandoffPendingDocTypeForTesting(_ docType: String?) {
        day1DocHandoffPendingDocType = docType
        day1DocHandoffAwaitingFollowupPrompt = false
        day1DocHandoffError = nil
    }

    func setDay1DocHandoffAwaitingFollowupPromptForTesting(_ isAwaiting: Bool) {
        day1DocHandoffAwaitingFollowupPrompt = isAwaiting
        if isAwaiting {
            day1DocHandoffPendingDocType = nil
        }
    }

    func applySessionUpdatedForTesting(_ session: ChatSession) {
        upsert(session)
    }

    func applySessionCreatedForTesting(_ session: ChatSession) {
        handleSessionCreated(session)
    }

    func applySidecarEventForTesting(_ event: SidecarEvent) {
        handle(event)
    }

    func applyCurriculumQuestionReframeForTesting(
        sessionId: String,
        questionId: String?,
        originalQuestion: String? = nil,
        reframedQuestion: String
    ) {
        let event = SidecarEvent(
            type: "curriculum_original_question_reframed",
            message: nil,
            sessionId: sessionId,
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
            weeklyRitualPrompt: nil,
            requestEmit: nil,
            questionId: questionId,
            originalQuestion: originalQuestion,
            reframedQuestion: reframedQuestion
        )
        applyCurriculumQuestionReframe(event)
    }

    func setIddCurrentDocTypeForTesting(_ docType: String?) {
        iddCurrentDocType = docType
    }

    func recoverRunningSessionsForTesting(message: String) {
        markRunningSessionsRecoverableAfterSidecarExit(message: message)
    }

    func resetFoundationProgressForTesting() {
        foundationProgressState = FoundationProgressSnapshot(
            workspaceRoot: WorkspaceSettings.resolvedURL().path,
            startedAt: nil,
            selectedDay: 1,
            completedDays: []
        )
        foundationStartedAt = nil
    }

    func applyIddSetupProgressForTesting(
        sessionId: String,
        requestId: String,
        stage: String,
        progressText: String,
        docType: String? = nil,
        elapsedMs: Int? = nil
    ) {
        let event = SidecarEvent(
            type: "idd_setup_progress",
            message: nil,
            sessionId: sessionId,
            requestId: requestId,
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
            docType: docType,
            docPath: nil,
            progressText: progressText,
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
            stage: stage,
            provider: nil,
            sheetRowsRead: nil,
            docCharsRead: nil,
            elapsedMs: elapsedMs,
            contextMetrics: nil,
            phase: nil,
            toolName: nil,
            summary: nil,
            weeklyRitualPrompt: nil,
            requestEmit: nil
        )
        reconcileDay1DocHandoffProgress(from: event)
        updateStructuredPromptSubmissionProgress(from: event)
    }

    func applyOfficeHoursLiveStatusForTesting(
        sessionId: String,
        stage: String,
        title: String? = nil,
        detail: String? = nil,
        progressText: String? = nil,
        requestId: String? = nil,
        elapsedMs: Int? = nil,
        contextMetrics: OfficeHoursContextMetrics? = nil
    ) {
        let status = OfficeHoursLiveStatus(
            sessionId: sessionId,
            stage: stage,
            title: title,
            detail: detail,
            progressText: progressText,
            messageId: nil,
            requestId: requestId,
            elapsedMs: elapsedMs,
            contextMetrics: contextMetrics,
            updatedAt: .now
        )
        officeHoursLiveStatusBySession[sessionId] = status
        if let progressText {
            appendSidecarOutput(sessionID: sessionId, summary: progressText)
        }
    }
    #endif

    private func upsert(_ session: ChatSession) {
        let session = sessionByApplyingCurriculumQuestionReframeGuards(to: sanitizedSessionSnapshot(session))
        reconcileDay1DocHandoffPromptState(with: session)
        reconcileStructuredPromptSubmissionState(with: session)
        reconcileStructuredPromptDraftState(with: session)
        reconcileOfficeHoursLiveStatus(with: session)
        if let index = sessions.firstIndex(where: { $0.id == session.id }) {
            sessions[index] = mergeSessionSnapshot(session, into: sessions[index])
        } else {
            sessions.append(session)
        }
        sessions.sort(by: { $0.updatedAt > $1.updatedAt })
        if selectedSessionID == nil {
            selectedSessionID = session.id
        }
    }

    private func reconcileDay1DocHandoffPromptState(with session: ChatSession) {
        if isDay1DocHandoffJudgePrompt(session.pendingUserInput) {
            day1DocHandoffPendingDocType = nil
            day1DocHandoffAwaitingFollowupPrompt = false
        }
    }

    private func handleSessionCreated(_ session: ChatSession) {
        replacementSessionCreateInFlight = false
        officeHoursSessionCreateInFlight = false
        upsert(session)
        selectedSessionID = session.id
        PostHogTelemetry.capture("mac_session_created", properties: [
            "session_id": session.id,
            "provider": session.provider.rawValue,
        ], authSession: macAuthSession)
        recordStartupSessionAppearIfNeeded(source: "session_created")
        refreshPresentationState()
        requestInitialBipGateIfNeeded()
        flushStartupQueuedActionIfPossible()
    }

    private func sanitizedSessionSnapshot(_ session: ChatSession) -> ChatSession {
        guard session.pendingUserInput?.isLegacyStaticIddQuestion == true else {
            return session
        }
        var sanitized = session
        sanitized.pendingUserInput = nil
        if sanitized.status == .awaitingInput {
            sanitized.status = .running
        }
        return sanitized
    }

    private func reconcileStructuredPromptSubmissionState(with incoming: ChatSession) {
        guard let submitted = submittedStructuredPromptBySession[incoming.id] else { return }
        guard incoming.pendingUserInput?.requestId == submitted.requestId else {
            submittedStructuredPromptBySession.removeValue(forKey: incoming.id)
            return
        }
    }

    private func reconcileStructuredPromptDraftState(with incoming: ChatSession) {
        guard let prompt = incoming.pendingUserInput else {
            structuredPromptDraftBySession.removeValue(forKey: incoming.id)
            pruneCurriculumQuestionReframeRecords(sessionId: incoming.id)
            return
        }
        pruneCurriculumQuestionReframeRecords(sessionId: incoming.id, activePrompt: prompt)
        synchronizeStructuredPromptDrafts(with: prompt)
    }

    private func updateStructuredPromptSubmissionProgress(from event: SidecarEvent) {
        guard let sessionId = event.sessionId,
              let requestId = event.requestId,
              var submitted = submittedStructuredPromptBySession[sessionId],
              submitted.requestId == requestId else { return }

        if event.stage == "validation_error" {
            submittedStructuredPromptBySession.removeValue(forKey: sessionId)
            return
        }

        submitted.progressStage = event.stage
        submitted.progressText = event.progressText?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        submitted.progressUpdatedAt = .now
        submitted.elapsedMs = event.elapsedMs
        submittedStructuredPromptBySession[sessionId] = submitted
    }

    // F6: when the sidecar advances the IDD rubric to a new signal, the
    // follow-up card arrives with generation.dimensionTransitioned=true and a
    // previousSignalLabel describing the dimension just completed. Show a
    // 3-second toast in the Foundation surface so the user perceives forward
    // motion ("좋아요. 좁히기 완료 → 직접 만날 사람으로 넘어갑니다.") instead of
    // feeling stuck on yet another card.
    struct DimensionTransitionToast: Identifiable, Equatable {
        let id = UUID()
        let from: String
        let to: String
    }

    private func detectDimensionTransitionToast(in session: ChatSession) {
        guard let prompt = session.pendingUserInput else { return }
        guard prompt.generation?.dimensionTransitioned == true else { return }
        guard let from = prompt.generation?.previousSignalLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !from.isEmpty,
              let to = prompt.generation?.signalLabel?.trimmingCharacters(in: .whitespacesAndNewlines), !to.isEmpty else {
            return
        }
        let toast = DimensionTransitionToast(from: from, to: to)
        dimensionTransitionToast = toast
        Task { [weak self] in
            try? await Task.sleep(nanoseconds: 3_000_000_000)
            await MainActor.run {
                guard let self else { return }
                if self.dimensionTransitionToast?.id == toast.id {
                    self.dimensionTransitionToast = nil
                }
            }
        }
    }

    private func applyCurriculumQuestionReframe(_ event: SidecarEvent) {
        guard let sessionId = event.sessionId,
              let reframedQuestion = event.reframedQuestion?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
              let index = sessions.firstIndex(where: { $0.id == sessionId }) else { return }

        var session = sessions[index]
        let targetQuestionId = event.questionId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
        var didApply = false

        if let pendingUserInput = session.pendingUserInput,
           let questionIndex = indexOfQuestionToReframe(
                in: pendingUserInput.questions,
                targetQuestionId: targetQuestionId,
                originalQuestion: event.originalQuestion
           ) {
            var questions = pendingUserInput.questions
            let existing = questions[questionIndex]
            questions[questionIndex] = existing.replacingQuestionText(
                reframedQuestion,
                preservingIdentity: existing.id
            )
            session.pendingUserInput = StructuredPromptRequest(
                requestId: pendingUserInput.requestId,
                sessionId: pendingUserInput.sessionId,
                toolName: pendingUserInput.toolName,
                title: pendingUserInput.title,
                createdAt: pendingUserInput.createdAt,
                intro: pendingUserInput.intro,
                resources: pendingUserInput.resources,
                questions: questions,
                generation: pendingUserInput.generation
            )
            recordCurriculumQuestionReframe(
                sessionId: session.id,
                requestId: pendingUserInput.requestId,
                questionId: existing.id,
                reframedQuestion: reframedQuestion
            )
            didApply = true
        }

        session = sessionByApplyingCurriculumQuestionReframeGuards(to: session)

        session.messages = session.messages.map { message in
            guard let inlineDecision = message.inlineDecision,
                  shouldReframeQuestion(
                    inlineDecision,
                    targetQuestionId: targetQuestionId,
                    originalQuestion: event.originalQuestion
                  ) else {
                return message
            }
            var updated = message
            updated.inlineDecision = inlineDecision.replacingQuestionText(
                reframedQuestion,
                preservingIdentity: inlineDecision.id
            )
            if updated.content == inlineDecision.question {
                updated.content = reframedQuestion
            }
            didApply = true
            return updated
        }

        guard didApply else { return }
        var updatedSessions = sessions
        updatedSessions[index] = session
        sessions = updatedSessions
        reconcileStructuredPromptDraftState(with: session)
    }

    private func indexOfQuestionToReframe(
        in questions: [StructuredPromptQuestion],
        targetQuestionId: String?,
        originalQuestion: String?
    ) -> Int? {
        if let targetQuestionId {
            return questions.firstIndex { $0.id == targetQuestionId || $0.questionId == targetQuestionId }
        }
        if let originalQuestion = originalQuestion?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
            return questions.firstIndex { $0.question == originalQuestion }
        }
        return questions.count == 1 ? questions.startIndex : nil
    }

    private func shouldReframeQuestion(
        _ question: StructuredPromptQuestion,
        targetQuestionId: String?,
        originalQuestion: String?
    ) -> Bool {
        if let targetQuestionId {
            return question.id == targetQuestionId || question.questionId == targetQuestionId
        }
        if let originalQuestion = originalQuestion?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
            return question.question == originalQuestion
        }
        return false
    }

    private func sessionByApplyingCurriculumQuestionReframeGuards(to session: ChatSession) -> ChatSession {
        guard let prompt = session.pendingUserInput else { return session }
        var seenQuestionIds = Set<String>()
        var questions: [StructuredPromptQuestion] = []
        var didChange = false

        for question in prompt.questions {
            let questionId = question.id
            guard seenQuestionIds.insert(questionId).inserted else {
                didChange = true
                continue
            }

            guard let record = latestCurriculumQuestionReframesByKey[curriculumQuestionReframeKey(
                sessionId: session.id,
                requestId: prompt.requestId,
                questionId: questionId
            )] else {
                questions.append(question)
                continue
            }

            if question.question == record.reframedQuestion {
                questions.append(question)
            } else {
                questions.append(question.replacingQuestionText(
                    record.reframedQuestion,
                    preservingIdentity: questionId
                ))
                didChange = true
            }
        }

        guard didChange else { return session }
        var updated = session
        updated.pendingUserInput = StructuredPromptRequest(
            requestId: prompt.requestId,
            sessionId: prompt.sessionId,
            toolName: prompt.toolName,
            title: prompt.title,
            createdAt: prompt.createdAt,
            intro: prompt.intro,
            resources: prompt.resources,
            questions: questions,
            generation: prompt.generation
        )
        return updated
    }

    private func recordCurriculumQuestionReframe(
        sessionId: String,
        requestId: String,
        questionId: String,
        reframedQuestion: String
    ) {
        latestCurriculumQuestionReframesByKey[curriculumQuestionReframeKey(
            sessionId: sessionId,
            requestId: requestId,
            questionId: questionId
        )] = CurriculumQuestionReframeRecord(
            sessionId: sessionId,
            requestId: requestId,
            questionId: questionId,
            reframedQuestion: reframedQuestion
        )
    }

    private func pruneCurriculumQuestionReframeRecords(
        sessionId: String,
        activePrompt: StructuredPromptRequest? = nil
    ) {
        latestCurriculumQuestionReframesByKey = latestCurriculumQuestionReframesByKey.filter { _, record in
            guard record.sessionId == sessionId else { return true }
            guard let activePrompt else { return false }
            guard record.requestId == activePrompt.requestId else { return false }
            return activePrompt.questions.contains { $0.id == record.questionId }
        }
    }

    private func curriculumQuestionReframeKey(
        sessionId: String,
        requestId: String,
        questionId: String
    ) -> String {
        [sessionId, requestId, questionId].joined(separator: "\u{1F}")
    }

    private func mergeSessionSnapshot(_ incoming: ChatSession, into current: ChatSession) -> ChatSession {
        var merged = incoming
        let currentMessagesByID = Dictionary(uniqueKeysWithValues: current.messages.map { ($0.id, $0) })
        let incomingMessageIDs = Set(incoming.messages.map { $0.id })
        // Preserve client-only seeded messages (currently the Foundation
        // Day 0/2-7 first prompt opener — see Sub-AC 2.4) when the sidecar
        // pushes a `session_updated` snapshot that does not include them.
        // The sidecar deliberately does NOT persist the AI-driven first
        // prompt because `buildFirstPromptForDay` is deterministic; without
        // this preservation rule the seeded opener would vanish the moment
        // the user sends their first reply (because the sidecar then emits
        // a session snapshot containing only the user/assistant turns).
        let preservedSeeds = current.messages.filter { message in
            message.id.hasPrefix(Self.foundationFirstPromptMessageIdPrefix)
                && !incomingMessageIDs.contains(message.id)
        }
        let mappedIncoming = incoming.messages.map { incomingMessage in
            guard let currentMessage = currentMessagesByID[incomingMessage.id] else {
                return incomingMessage
            }
            return mergeMessageSnapshot(incomingMessage, into: currentMessage, sessionStatus: incoming.status)
        }
        // Seeded openers always anchor the conversation root.
        merged.messages = preservedSeeds + mappedIncoming
        return merged
    }

    private func mergeMessageSnapshot(
        _ incoming: ChatMessage,
        into current: ChatMessage,
        sessionStatus: SessionStatus
    ) -> ChatMessage {
        var merged = incoming
        let incomingContent = incoming.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let currentContent = current.content.trimmingCharacters(in: .whitespacesAndNewlines)
        let incomingLooksStale = incoming.state == .streaming || sessionStatus == .running

        if incomingLooksStale && !currentContent.isEmpty {
            if incomingContent.isEmpty || incoming.content.count < current.content.count {
                merged.content = current.content
            }
            if current.state == .streaming && incoming.state == .streaming {
                merged.state = .streaming
            }
            // Preserve a freshly-applied inlineDecision (reframe/structured prompt)
            // when the incoming snapshot is stale and would otherwise null it out.
            if incoming.inlineDecision == nil, current.inlineDecision != nil {
                merged.inlineDecision = current.inlineDecision
            }
        }

        return merged
    }

    private func appendSentPromptPreview(sessionID: String, prompt: String) {
        var nextPreviews = sentPromptPreviews
        var previews = nextPreviews[sessionID] ?? []
        previews.append(PendingPromptPreview(id: UUID().uuidString, content: prompt, createdAt: .now))
        nextPreviews[sessionID] = previews
        sentPromptPreviews = nextPreviews
    }

    private func pruneSentPromptPreviews(for session: ChatSession) {
        guard var previews = sentPromptPreviews[session.id], !previews.isEmpty else { return }
        var persistedCounts: [String: Int] = [:]
        for message in session.messages where message.role == .user {
            guard let content = message.content.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
                continue
            }
            persistedCounts[content, default: 0] += 1
        }
        previews.removeAll { preview in
            let content = preview.content.trimmingCharacters(in: .whitespacesAndNewlines)
            let count = persistedCounts[content, default: 0]
            if count > 0 {
                persistedCounts[content] = count - 1
                return true
            }
            return false
        }
        if previews.isEmpty {
            sentPromptPreviews[session.id] = nil
        } else {
            sentPromptPreviews[session.id] = previews
        }
    }

    private func updateMessage(
        sessionID: String,
        messageID: String,
        mutate: (inout ChatMessage) -> Void
    ) {
        guard let sessionIndex = sessions.firstIndex(where: { $0.id == sessionID }),
              let messageIndex = sessions[sessionIndex].messages.firstIndex(where: { $0.id == messageID })
        else { return }

        mutate(&sessions[sessionIndex].messages[messageIndex])
        sessions[sessionIndex].updatedAt = .now
    }

    private func shouldRecoverRunningSessions(forGlobalSidecarError message: String?) -> Bool {
        let value = (message ?? "").lowercased()
        return value.contains("sidecar connection closed")
            || value.contains("sidecar stopped")
            || value.contains("sidecar is not connected")
            || value.contains("failed to start sidecar")
    }

    private func markRunningSessionsRecoverableAfterSidecarExit(message: String) {
        let recoveryText = "응답이 끝나기 전에 실행 보조 앱이 중단됐습니다. 실행 보조 앱을 다시 시작합니다. 이어지지 않으면 이 요청을 다시 시도하세요."
        var changed = false
        var recoveredCount = 0
        for index in sessions.indices {
            let hasStreamingMessage = sessions[index].messages.contains(where: { $0.state == .streaming })
            guard sessions[index].status == .running || hasStreamingMessage else { continue }

            if let messageIndex = sessions[index].messages.lastIndex(where: { $0.role == .assistant && $0.state == .streaming }) {
                if sessions[index].messages[messageIndex].content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty {
                    sessions[index].messages[messageIndex].content = recoveryText
                }
                sessions[index].messages[messageIndex].state = .error
                sessions[index].messages[messageIndex].error = message
            } else {
                sessions[index].messages.append(ChatMessage(
                    id: UUID().uuidString,
                    role: .assistant,
                    provider: sessions[index].provider,
                    content: recoveryText,
                    state: .error,
                    createdAt: Date(),
                    error: message,
                    bipMissionChoices: nil,
                    providerAuthActions: nil
                ))
            }
            sessions[index].status = .error
            sessions[index].error = message
            sessions[index].updatedAt = .now
            changed = true
            recoveredCount += 1
        }

        if changed {
            isBipCoachRefreshing = false
            isBipCoachGenerating = false
            isBipCoachCompleting = false
            bipMissionProgress = nil
            PostHogTelemetry.capture("mac_sidecar_running_sessions_recovered", properties: [
                "session_count": recoveredCount,
            ], authSession: macAuthSession)
        }
    }

    private func appendSidecarOutput(sessionID: String, event: SidecarEvent) {
        let summary = (event.summary ?? event.fallbackToolSummary)
            .trimmingCharacters(in: .whitespacesAndNewlines)
        appendSidecarOutput(sessionID: sessionID, summary: summary)
    }

    private func appendSidecarOutput(sessionID: String, summary: String) {
        let summary = summary.trimmingCharacters(in: .whitespacesAndNewlines)
        guard !summary.isEmpty else { return }

        var logs = sidecarOutputLogs[sessionID] ?? []
        if logs.last != summary {
            logs.append(summary)
        }
        if logs.count > 24 {
            logs.removeFirst(logs.count - 24)
        }
        sidecarOutputLogs[sessionID] = logs
    }

    private func applyOfficeHoursLiveStatus(from event: SidecarEvent) {
        guard let status = event.officeHoursLiveStatus else { return }
        officeHoursLiveStatusBySession[status.sessionId] = status
        if let progressText = status.progressText {
            appendSidecarOutput(sessionID: status.sessionId, summary: progressText)
        }
        maybePostQuestionReadyNotification(for: status)
    }

    /// requestIds already turned into a local notification this app run; the
    /// sidecar re-broadcasts `question_ready` (250ms poller + end-of-run emit)
    /// for the same request, so dedupe must outlive the live-status entry.
    private var notifiedQuestionReadyRequestIds: Set<String> = []
    private var longRunningCompletionAttempts: [LongRunningCompletionNotificationKind: LongRunningCompletionAttempt] = [:]
    private var pendingLongRunningDisplayAttempts: [LongRunningCompletionNotificationKind: Date] = [:]
    private var notifiedLongRunningCompletionAttemptIds: Set<String> = []

    private func maybePostQuestionReadyNotification(for status: OfficeHoursLiveStatus) {
        guard OfficeHoursQuestionReadyNotifier.shouldNotify(
            stage: status.stage,
            requestId: status.requestId,
            title: status.title,
            alreadyNotifiedRequestIds: notifiedQuestionReadyRequestIds,
            isAppActive: NSApp.isActive,
            isEnabled: isQuestionReadyNotificationEnabled,
            isUITesting: Self.isUITestingOrStubProviderLaunch()
        ), let requestId = status.requestId, let title = status.title else { return }

        notifiedQuestionReadyRequestIds.insert(requestId)
        Task {
            await postQuestionReadyNotification(
                sessionId: status.sessionId,
                requestId: requestId,
                title: title
            )
        }
    }

    private nonisolated static func isUITestingOrStubProviderLaunch() -> Bool {
        CommandLine.arguments.contains { $0.hasPrefix("--ui-testing") }
            || ProcessInfo.processInfo.environment["AGENTIC30_TEST_STUB_PROVIDER"] == "1"
    }

    private func markLongRunningCompletionDisplayInterest(_ kind: LongRunningCompletionNotificationKind) {
        pendingLongRunningDisplayAttempts[kind] = Date()
    }

    private func longRunningCompletionReasonIsUserVisible(_ reason: String) -> Bool {
        let normalized = reason.trimmingCharacters(in: .whitespacesAndNewlines).lowercased()
        guard !normalized.isEmpty else { return true }
        return !["auto", "background", "daily", "hourly", "live_sync", "startup"].contains(normalized)
    }

    private func beginLongRunningCompletionAttempt(
        _ kind: LongRunningCompletionNotificationKind,
        source: String,
        isUserVisible: Bool,
        startedAt: Date = Date()
    ) {
        guard isUserVisible else { return }
        longRunningCompletionAttempts[kind] = LongRunningCompletionAttempt(
            id: "\(kind.rawValue).\(UUID().uuidString)",
            kind: kind,
            startedAt: startedAt,
            source: source,
            isUserVisible: isUserVisible
        )
        pendingLongRunningDisplayAttempts.removeValue(forKey: kind)
    }

    private func beginLongRunningCompletionAttemptFromDisplayInterestIfNeeded(
        _ kind: LongRunningCompletionNotificationKind,
        source: String
    ) {
        guard longRunningCompletionAttempts[kind] == nil,
              let markedAt = pendingLongRunningDisplayAttempts[kind],
              Date().timeIntervalSince(markedAt) <= 5 * 60 else {
            return
        }
        beginLongRunningCompletionAttempt(kind, source: source, isUserVisible: true)
    }

    private func completeLongRunningCompletionAttempt(
        _ kind: LongRunningCompletionNotificationKind,
        outcome: LongRunningCompletionOutcome,
        docPath: String? = nil,
        detail: String? = nil
    ) {
        guard let attempt = longRunningCompletionAttempts.removeValue(forKey: kind) else {
            return
        }
        pendingLongRunningDisplayAttempts.removeValue(forKey: kind)
        let elapsed = Date().timeIntervalSince(attempt.startedAt)
        guard LongRunningCompletionNotifier.shouldNotify(
            attemptId: attempt.id,
            alreadyNotifiedAttemptIds: notifiedLongRunningCompletionAttemptIds,
            isUserVisibleAttempt: attempt.isUserVisible,
            elapsed: elapsed,
            isAppActive: NSApp.isActive,
            isEnabled: isLongRunningCompletionNotificationEnabled,
            isUITesting: Self.isUITestingOrStubProviderLaunch()
        ) else {
            return
        }
        guard !shouldSuppressLockedRailCompletionNotification(kind, source: attempt.source) else {
            return
        }

        notifiedLongRunningCompletionAttemptIds.insert(attempt.id)
        let notification = LongRunningCompletionNotification(
            kind: kind,
            outcome: outcome,
            docPath: docPath,
            detail: detail
        )
        Task {
            await postLongRunningCompletionNotification(
                notification,
                elapsed: elapsed,
                source: attempt.source
            )
        }
    }

    private func shouldSuppressLockedRailCompletionNotification(
        _ kind: LongRunningCompletionNotificationKind,
        source: String
    ) -> Bool {
        let feature: OpenDesignRailFeature?
        switch kind {
        case .morningBriefing:
            feature = .morningBriefing
        case .newsMarketRadar:
            feature = .news
        case .strategyReport:
            feature = .strategy
        default:
            feature = nil
        }
        guard let feature else { return false }
        let accessState = OpenDesignRailAccessPolicy.state(for: feature, dayProgress: dayProgress)
        guard case .locked(let requiredDay, let requiredStep) = accessState else {
            return false
        }
        PostHogTelemetry.capture(
            "mac_long_running_completion_notification_suppressed_locked_route",
            properties: [
                "kind": kind.rawValue,
                "route": kind.route.rawValue,
                "rail_item_id": feature.railItemID,
                "required_day": requiredDay,
                "required_step": requiredStep,
                "day_progress_loaded": dayProgress != nil,
                "source": source,
            ],
            authSession: macAuthSession
        )
        return true
    }

    private func longRunningCompletionStateIsRunning(_ state: String?) -> Bool {
        switch state ?? "" {
        case "collecting", "refreshing", "running", "indexing", "generating":
            return true
        default:
            return false
        }
    }

    private func longRunningCompletionOutcome(for state: String?, error: String?) -> LongRunningCompletionOutcome? {
        if error?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty != nil {
            return .failed
        }
        switch state ?? "" {
        case "ready", "stale", "empty", "github_required":
            return .success
        case "failed", "error":
            return .failed
        default:
            return nil
        }
    }

    private func workHistoryNotificationDetail(_ snapshot: WorkHistorySnapshot) -> String {
        if snapshot.status.state == "github_required" {
            return "GitHub 연결 후 더 정확한 히스토리를 만들 수 있어요."
        }
        if snapshot.hasData {
            return "AI 세션 \(snapshot.totals.sessionCount)개와 이번 주 흐름을 정리했어요."
        }
        return "이번 주 작업 히스토리를 볼 수 있어요."
    }

    private func bipResearchNotificationDetail(_ snapshot: BipResearchSnapshot) -> String {
        let count = snapshot.candidateCount
        guard count > 0 else {
            return "공개 신호와 고객 후보 리서치를 확인할 수 있어요."
        }
        return "고객 후보 \(count)개와 공개 신호를 확인할 수 있어요."
    }

    private func newsMarketRadarNotificationDetail(_ snapshot: NewsMarketRadarSnapshot) -> String {
        let count = snapshot.cardCount
        guard count > 0 else {
            return "시장 신호 업데이트를 확인할 수 있어요."
        }
        return "시장 신호 카드 \(count)개를 확인할 수 있어요."
    }

    private func strategyReportNotificationDetail(_ snapshot: StrategyReportSnapshot) -> String {
        let count = snapshot.report?.competitors.count ?? 0
        guard count > 0 else {
            return "새 전략 리포트를 확인할 수 있어요."
        }
        return "경쟁 구도 \(count)개와 전략 캔버스를 갱신했어요."
    }

    private func bipMissionNotificationDetail(_ coach: BipCoachState?) -> String {
        if let title = coach?.currentMission?.title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty {
            return title
        }
        return "근거 기반 실행 미션을 확인할 수 있어요."
    }

    private func normalizedDailyCardSourceStateVersion(_ value: String?) -> String? {
        value?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
    }

    private func upsertDailyCard(_ card: SidecarEvent.MissionCard.DailyCard) {
        if dailyCards.contains(where: { $0.programDay != card.programDay }) {
            dailyCards = []
        }
        let nextVersion = normalizedDailyCardSourceStateVersion(card.sourceStateVersion)
        dailyCards.removeAll { existing in
            guard existing.programDay == card.programDay else { return false }
            let existingVersion = normalizedDailyCardSourceStateVersion(existing.sourceStateVersion)
            if let nextVersion {
                return existingVersion != nextVersion
            }
            return existingVersion != nil
        }
        dailyCards.removeAll { $0.stableID == card.stableID }
        dailyCards.append(card)
        dailyCards.sort { lhs, rhs in
            if lhs.programDay != rhs.programDay {
                return lhs.programDay < rhs.programDay
            }
            if lhs.displayOrder != rhs.displayOrder {
                return lhs.displayOrder < rhs.displayOrder
            }
            return lhs.stableID < rhs.stableID
        }
    }

    private func localNotificationAuthorizationGranted(center: UNUserNotificationCenter) async -> Bool {
        let settings = await withCheckedContinuation { continuation in
            center.getNotificationSettings { settings in
                continuation.resume(returning: settings)
            }
        }

        if settings.authorizationStatus == .authorized || settings.authorizationStatus == .provisional {
            return true
        }
        guard settings.authorizationStatus == .notDetermined else { return false }
        do {
            return try await center.requestAuthorization(options: [.alert, .sound])
        } catch {
            PostHogTelemetry.captureException(
                error,
                properties: ["operation": "request_notification_authorization"],
                authSession: macAuthSession
            )
            return false
        }
    }

    private func syncProgramNotificationSchedule(_ schedule: ProgramNotificationSchedule) {
        guard !Self.isUITestingOrStubProviderLaunch() else { return }
        let requests = schedule.validLocalNotificationRequests
        Task { await syncProgramNotificationRequests(requests) }
    }

    private func syncProgramNotificationRequests(_ requests: [ProgramLocalNotificationRequest]) async {
        let center = UNUserNotificationCenter.current()
        let managedIdentifiers = Array(ProgramLocalNotificationRequest.allowedIdentifiers).sorted()

        guard !requests.isEmpty else {
            center.removePendingNotificationRequests(withIdentifiers: managedIdentifiers)
            PostHogTelemetry.capture(
                "mac_program_notification_schedule_synced",
                properties: [
                    "scheduled_count": 0,
                    "identifiers": [String](),
                ],
                authSession: macAuthSession
            )
            return
        }
        guard await localNotificationAuthorizationGranted(center: center) else { return }

        var desiredIdentifiers = Set<String>()
        var scheduledIdentifiers: [String] = []
        for request in requests {
            guard let dateComponents = request.localDateComponents else { continue }
            desiredIdentifiers.insert(request.identifier)
            let content = UNMutableNotificationContent()
            content.title = request.notificationTitle
            if let body = request.notificationBody {
                content.body = body
            }
            content.sound = request.notificationSound
            content.userInfo = request.notificationUserInfo

            let trigger = UNCalendarNotificationTrigger(
                dateMatching: dateComponents,
                repeats: false
            )
            do {
                try await center.add(UNNotificationRequest(
                    identifier: request.identifier,
                    content: content,
                    trigger: trigger
                ))
                scheduledIdentifiers.append(request.identifier)
            } catch {
                PostHogTelemetry.captureException(
                    error,
                    properties: [
                        "operation": "schedule_program_notification",
                        "identifier": request.identifier,
                    ],
                    authSession: macAuthSession
                )
            }
        }
        let obsoleteIdentifiers = managedIdentifiers.filter { !desiredIdentifiers.contains($0) }
        if !obsoleteIdentifiers.isEmpty {
            center.removePendingNotificationRequests(withIdentifiers: obsoleteIdentifiers)
        }

        PostHogTelemetry.capture(
            "mac_program_notification_schedule_synced",
            properties: [
                "scheduled_count": scheduledIdentifiers.count,
                "identifiers": scheduledIdentifiers,
            ],
            authSession: macAuthSession
        )
    }

    @discardableResult
    private func postLocalNotification(
        identifier: String,
        title: String,
        body: String?,
        userInfo: [AnyHashable: Any],
        removeDeliveredIdentifiers: [String] = []
    ) async -> Bool {
        let center = UNUserNotificationCenter.current()
        guard await localNotificationAuthorizationGranted(center: center) else { return false }

        let content = UNMutableNotificationContent()
        content.title = title
        if let body {
            content.body = body
        }
        content.sound = .default
        content.userInfo = userInfo

        if !removeDeliveredIdentifiers.isEmpty {
            center.removeDeliveredNotifications(withIdentifiers: removeDeliveredIdentifiers)
        }
        try? await center.add(UNNotificationRequest(
            identifier: identifier,
            content: content,
            trigger: nil
        ))
        return true
    }

    private func postQuestionReadyNotification(
        sessionId: String,
        requestId: String,
        title: String
    ) async {
        let notification = OfficeHoursQuestionReadyNotification(sessionId: sessionId, requestId: requestId)
        let posted = await postLocalNotification(
            identifier: OfficeHoursQuestionReadyNotification.notificationIdentifier(requestId: requestId),
            title: OfficeHoursQuestionReadyNotification.notificationTitle(from: title),
            body: OfficeHoursQuestionReadyNotification.notificationBody(from: title),
            userInfo: notification.userInfo
        )
        guard posted else { return }
        PostHogTelemetry.capture(
            "mac_office_hours_question_ready_notification_posted",
            authSession: macAuthSession
        )
    }

    private func maybePostMcpOauthConnectedNotification(for result: McpOauthConnectResult) {
        guard McpOauthConnectedNotifier.shouldNotify(
            server: result.server,
            state: result.state,
            isUITesting: Self.isUITestingOrStubProviderLaunch()
        ), let notification = McpOauthConnectedNotification(server: result.server) else { return }

        Task {
            await postMcpOauthConnectedNotification(notification)
        }
    }

    private func postMcpOauthConnectedNotification(_ notification: McpOauthConnectedNotification) async {
        let posted = await postLocalNotification(
            identifier: notification.notificationIdentifier,
            title: notification.notificationTitle,
            body: notification.notificationBody,
            userInfo: notification.userInfo,
            removeDeliveredIdentifiers: [notification.notificationIdentifier]
        )
        guard posted else { return }
        PostHogTelemetry.capture(
            "mac_mcp_oauth_connected_notification_posted",
            properties: [
                "server": notification.server,
            ],
            authSession: macAuthSession
        )
    }

    private func postLongRunningCompletionNotification(
        _ notification: LongRunningCompletionNotification,
        elapsed: TimeInterval,
        source: String
    ) async {
        let posted = await postLocalNotification(
            identifier: notification.notificationIdentifier,
            title: notification.notificationTitle,
            body: notification.notificationBody,
            userInfo: notification.userInfo,
            removeDeliveredIdentifiers: [notification.notificationIdentifier]
        )
        guard posted else { return }
        PostHogTelemetry.capture(
            "mac_long_running_completion_notification_posted",
            properties: [
                "kind": notification.kind.rawValue,
                "outcome": notification.outcome.rawValue,
                "route": notification.route.rawValue,
                "elapsed_ms": Int((elapsed * 1000).rounded()),
                "source": source,
            ],
            authSession: macAuthSession
        )
    }

    private func reconcileOfficeHoursLiveStatus(with session: ChatSession) {
        guard officeHoursLiveStatusBySession[session.id] != nil else { return }
        if session.pendingUserInput != nil || session.status == .idle || session.status == .error {
            officeHoursLiveStatusBySession.removeValue(forKey: session.id)
        }
    }

    private func reconcileOfficeHoursLiveStatuses(with sessions: [ChatSession]) {
        guard !officeHoursLiveStatusBySession.isEmpty else { return }
        let sessionsByID = Dictionary(uniqueKeysWithValues: sessions.map { ($0.id, $0) })
        officeHoursLiveStatusBySession = officeHoursLiveStatusBySession.filter { sessionID, _ in
            guard let session = sessionsByID[sessionID] else { return false }
            return session.pendingUserInput == nil && session.status == .running
        }
    }

    private func refreshPresentationState() {
        guard let session = selectedSession else {
            cancelRevealTransition()
            activePresentationSessionID = nil
            revealedAssistantMessageID = nil
            presentationPhase = .compact
            return
        }

        let latestAssistant = latestRenderableAssistantMessage(in: session)
        let sessionChanged = activePresentationSessionID != session.id
        activePresentationSessionID = session.id

        if session.status == .awaitingInput || session.status == .error {
            cancelRevealTransition()
            revealedAssistantMessageID = nil
            presentationPhase = .compact
            return
        }

        if session.status == .running {
            cancelRevealTransition()
            revealedAssistantMessageID = latestAssistant?.id
            presentationPhase = latestAssistant == nil ? .compact : .expanded
            return
        }

        guard let latestAssistant else {
            cancelRevealTransition()
            revealedAssistantMessageID = nil
            presentationPhase = .compact
            return
        }

        if sessionChanged {
            cancelRevealTransition()
            revealedAssistantMessageID = latestAssistant.id
            presentationPhase = .expanded
            return
        }

        if presentationPhase == .expanded && revealedAssistantMessageID == latestAssistant.id {
            return
        }

        if presentationPhase == .expanding && revealedAssistantMessageID == latestAssistant.id {
            return
        }

        cancelRevealTransition()
        revealedAssistantMessageID = latestAssistant.id
        presentationPhase = .expanding

        let workItem = DispatchWorkItem { [weak self] in
            guard let self else { return }
            guard self.selectedSession?.id == session.id else { return }
            guard self.revealedAssistantMessageID == latestAssistant.id else { return }
            self.presentationPhase = .expanded
            self.revealWorkItem = nil
        }

        revealWorkItem = workItem
        DispatchQueue.main.asyncAfter(deadline: .now() + 0.2, execute: workItem)
    }

    private func cancelRevealTransition() {
        revealWorkItem?.cancel()
        revealWorkItem = nil
    }

    private func latestRenderableAssistantMessage(in session: ChatSession) -> ChatMessage? {
        session.messages.last(where: { message in
            (message.role == .assistant || message.role == .system)
            && !message.content.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty
        })
    }

    private func recordStartupSessionAppearIfNeeded(source: String) {
        guard !didRecordStartupSessionAppear,
              let session = selectedSession,
              let startedAt = startupSessionAppearStartedAt
        else { return }

        let elapsedMs = max(0, Int((Date().timeIntervalSince(startedAt) * 1000).rounded()))
        startupSessionAppearElapsedMs = elapsedMs
        didRecordStartupSessionAppear = true

        var properties: [String: Any] = [
            "source": source,
            "elapsed_ms": elapsedMs,
            "session_id": session.id,
            "provider": session.provider.rawValue,
            "restored_session": source != "session_created",
        ]
        if let sidecarElapsed = session.runtime?.startupTiming?.processToSessionCreatedMs {
            properties["sidecar_process_to_session_created_ms"] = sidecarElapsed
        }
        if let readyElapsed = session.runtime?.startupTiming?.processToSidecarReadyMs {
            properties["sidecar_process_to_ready_ms"] = readyElapsed
        }
        if let readyToCreateElapsed = session.runtime?.startupTiming?.sidecarReadyToCreateSessionReceivedMs {
            properties["sidecar_ready_to_create_session_received_ms"] = readyToCreateElapsed
        }
        if let authToCreateElapsed = session.runtime?.startupTiming?.clientAuthenticatedToCreateSessionReceivedMs {
            properties["sidecar_auth_to_create_session_received_ms"] = authToCreateElapsed
        }
        if let createElapsed = session.runtime?.startupTiming?.createSessionElapsedMs {
            properties["sidecar_create_session_elapsed_ms"] = createElapsed
        }
        PostHogTelemetry.capture(
            "mac_startup_session_visible",
            properties: properties,
            authSession: macAuthSession
        )
    }

    func clearStartupQueuedAction() {
        startupQueuedAction = nil
    }

    func retryStartupQueuedAction() {
        guard var action = startupQueuedAction else { return }
        action.state = .waiting
        startupQueuedAction = action
        flushStartupQueuedActionIfPossible()
    }

    private func queueStartupAction(_ kind: StartupQueuedAction.Kind) {
        guard canQueueStartupAction else { return }
        startupQueuedAction = StartupQueuedAction(kind: kind)
        PostHogTelemetry.capture("mac_startup_action_queued", properties: [
            "kind": startupQueuedActionKindName(kind),
        ], authSession: macAuthSession)
    }

    private func flushStartupQueuedActionIfPossible() {
        guard var action = startupQueuedAction,
              isConnected,
              selectedSession != nil else {
            return
        }

        switch action.state {
        case .sending:
            return
        case .failed, .waiting:
            break
        }

        action.state = .sending
        startupQueuedAction = action

        switch action.kind {
        case .prompt(let prompt):
            draft = prompt
            startupQueuedAction = nil
            sendPrompt()
        case .mission(let compact, let curriculumDay):
            startupQueuedAction = nil
            generateBipMission(compact: compact, curriculumDay: curriculumDay)
        }
    }

    private func markStartupQueuedActionFailed(_ message: String) {
        guard var action = startupQueuedAction else { return }
        action.state = .failed(message)
        startupQueuedAction = action
    }

    private func startupQueuedActionKindName(_ kind: StartupQueuedAction.Kind) -> String {
        switch kind {
        case .prompt:
            return "prompt"
        case .mission:
            return "mission"
        }
    }

    private func hydrateWorkspaceRootFromSettingsIfAvailable() {
        guard WorkspaceSettings.hasExplicitWorkspace else { return }
        workspaceRoot = WorkspaceSettings.resolvedURL().path
    }

    private func currentBipCoachSessionID() -> String? {
        if let selectedSessionID {
            return selectedSessionID
        }
        return bipCoach?.sessionId ?? sessions.first?.id
    }

    // Test-host detection is referenced from non-DEBUG init paths (line ~489),
    // so it must compile in Release. The function body is harmless in Release
    // (returns false when no XCTest env / .xctest argv is present).
    private static func isXCTestHost(arguments: [String]) -> Bool {
        ProcessInfo.processInfo.environment["XCTestConfigurationFilePath"] != nil
            || arguments.contains(where: { $0.contains(".xctest") })
    }

    #if DEBUG || AGENTIC30_LIVE_SIGNED_UI_E2E
    private func writeUITestingLaunchDiagnostics(arguments: [String]) {
        guard let diagnosticsPath = Self.uiTestingArgumentValue(
            "--ui-testing-diagnostics-path",
            arguments: arguments
        )?.trimmingCharacters(in: .whitespacesAndNewlines),
              !diagnosticsPath.isEmpty else {
            return
        }

        let resolvedWorkspacePath = WorkspaceSettings.resolvedURL().path
        let onboardingMemoryURL = URL(fileURLWithPath: resolvedWorkspacePath, isDirectory: true)
            .appendingPathComponent(".agentic30", isDirectory: true)
            .appendingPathComponent("memory", isDirectory: true)
            .appendingPathComponent("onboarding.json", isDirectory: false)
        let environment = ProcessInfo.processInfo.environment
            .filter { key, _ in
                key.hasPrefix("AGENTIC30_UI_TEST")
                    || key == "AGENTIC30_APP_SUPPORT_PATH"
                    || key == "XCTestConfigurationFilePath"
            }
            .sorted { lhs, rhs in lhs.key < rhs.key }
            .reduce(into: [String: String]()) { result, item in
                result[item.key] = item.value
            }
        let defaults = UserDefaults.standard
        let defaultSnapshot: [String: Any] = [
            "agentic30.workspaceRoot": defaults.string(forKey: "agentic30.workspaceRoot") ?? "",
            "agentic30.workspaceRoots.v1": defaults.array(forKey: "agentic30.workspaceRoots.v1") ?? [],
            Self.macOnboardingIntroCompletedDefaultsKey: defaults.object(forKey: Self.macOnboardingIntroCompletedDefaultsKey) ?? NSNull(),
            Self.macOnboardingIntakeOnlyCompletedDefaultsKey: defaults.object(forKey: Self.macOnboardingIntakeOnlyCompletedDefaultsKey) ?? NSNull(),
            IntakeV2Store.stateDefaultsKey: defaults.object(forKey: IntakeV2Store.stateDefaultsKey) == nil ? "absent" : "present",
            IntakeV2SourceManager.sourcesDefaultsKey: defaults.object(forKey: IntakeV2SourceManager.sourcesDefaultsKey) == nil ? "absent" : "present",
        ]
        let payload: [String: Any] = [
            "schemaVersion": 1,
            "writtenAt": ISO8601DateFormatter().string(from: Date()),
            "processIdentifier": ProcessInfo.processInfo.processIdentifier,
            "bundleIdentifier": Bundle.main.bundleIdentifier ?? "",
            "arguments": arguments,
            "uiTesting": Self.isUITesting(arguments: arguments),
            "environment": environment,
            "defaults": defaultSnapshot,
            "workspaceSettings": [
                "hasExplicitWorkspace": WorkspaceSettings.hasExplicitWorkspace,
                "resolvedPath": resolvedWorkspacePath,
            ],
            "viewModel": [
                "workspaceRoot": workspaceRoot,
                "onboardingContextPresent": onboardingContext != nil,
                "macAuthSessionPresent": macAuthSession != nil,
                "macOnboardingIntroCompleted": macOnboardingIntroCompleted,
                "macOnboardingIntakeOnlyCompleted": macOnboardingIntakeOnlyCompleted,
                "requiresMacOnboarding": requiresMacOnboarding,
                "needsOnboardingContext": needsOnboardingContext,
            ],
            "files": [
                "onboardingMemoryPath": onboardingMemoryURL.path,
                "onboardingMemoryExists": FileManager.default.fileExists(atPath: onboardingMemoryURL.path),
            ],
        ]

        do {
            let diagnosticsURL = URL(fileURLWithPath: diagnosticsPath, isDirectory: false)
            try FileManager.default.createDirectory(
                at: diagnosticsURL.deletingLastPathComponent(),
                withIntermediateDirectories: true,
                attributes: nil
            )
            let data = try JSONSerialization.data(withJSONObject: payload, options: [.prettyPrinted, .sortedKeys])
            try data.write(to: diagnosticsURL, options: [.atomic])
        } catch {
            let message = "Agentic30 UI testing launch diagnostics write failed: \(error)\n"
            if let data = message.data(using: .utf8) {
                FileHandle.standardError.write(data)
            }
        }
    }

    private static func isUITesting(arguments: [String]) -> Bool {
        arguments.contains(where: { $0.hasPrefix("--ui-testing-") })
            || ProcessInfo.processInfo.environment["AGENTIC30_UI_TESTING"] == "1"
    }

    private static func makeUITestingMacAuthSession(arguments: [String]) -> MacAuthSession? {
        if uiTestingFlag("--ui-testing-seed-auth", arguments: arguments) {
            let now = ISO8601DateFormatter().string(from: Date())
            return MacAuthSession(
                accessToken: "ui-test-access-token",
                refreshToken: "ui-test-refresh-token",
                expiresAt: Date().addingTimeInterval(3600).timeIntervalSince1970,
                tokenType: "bearer",
                userId: "ui-test-user",
                email: "ui-test@example.com",
                onboardingCompletedAt: now,
                termsAcceptedAt: now,
                termsVersion: MacOnboardingConstants.termsVersion,
                privacyVersion: MacOnboardingConstants.privacyVersion
            )
        }

        return nil
    }

    private static func makeUITestingOnboardingContext(arguments: [String]) -> OnboardingContext? {
        guard uiTestingFlag("--ui-testing-seed-onboarding-context", arguments: arguments) else { return nil }
        return OnboardingContext.make(
            businessDescription: "Agentic30 직접 사용 워크스페이스",
            currentStage: "First users and onboarding validation",
            goal: "Complete Day 1 and verify curriculum setup",
            focusArea: .development,
            productBottleneck: .firstActiveUsers,
            isolationLevel: .projectFolder
        )
    }

    private static func applyUITestingWorkspaceSeeds(arguments: [String]) {
        if let workspacePath = uiTestingArgumentValue("--ui-testing-seed-workspace", arguments: arguments) {
            let url = URL(fileURLWithPath: workspacePath, isDirectory: true)
            try? FileManager.default.createDirectory(
                at: url,
                withIntermediateDirectories: true,
                attributes: nil
            )
            WorkspaceSettings.store(url)
            if uiTestingFlag("--ui-testing-disable-sidecar", arguments: arguments)
                || uiTestingFlag("--ui-testing-seed-workspace-scan-cache", arguments: arguments) {
                WorkspaceScanResultStore(workspaceRoot: workspacePath).save(makeUITestingWorkspaceScanResult(arguments: arguments))
            }
        }
    }

    private static func makeUITestingWorkspaceScanResult(arguments: [String]) -> WorkspaceScanResult {
        let usesAlignmentPlan = arguments.contains("--ui-testing-seed-day1-alignment-plan")
        let usesSituationSummary = arguments.contains("--ui-testing-seed-day1-situation-summary")
        return WorkspaceScanResult(
            icp: ".agentic30/docs/ICP.md",
            spec: ".agentic30/docs/SPEC.md",
            values: ".agentic30/docs/VALUES.md",
            designSystem: nil,
            adr: nil,
            goal: ".agentic30/docs/GOAL.md",
            docs: "README.md",
            sheet: nil,
            onboardingHypothesis: WorkspaceOnboardingHypothesis(
                productName: "Agentic30",
                projectKind: "mac_app",
                targetUser: "1인 빌더",
                problem: "첫 고객 기준이 흔들림",
                purpose: "Day 1 고객 후보 검증",
                goal: "인터뷰할 고객 후보 1명을 고정",
                values: nil,
                likelyUsers: ["1인 빌더", "macOS AI 도구 사용자"],
                stage: "first_users",
                evidence: ["README.md", ".agentic30/docs/ICP.md"],
                confidence: "high",
                suggestedFirstQuestion: nil
            ),
            day1AlignmentPlan: usesAlignmentPlan ? makeUITestingDay1AlignmentPlan() : nil,
            day1IcpPlan: makeUITestingDay1IcpPlan(),
            day1SituationSummary: usesSituationSummary ? makeUITestingDay1SituationSummary() : nil,
            day1GoalSelection: nil,
            agentic30Gitignore: nil,
            foundCount: 4,
            error: nil
        )
    }

    private static func makeUITestingDay1SituationSummary() -> Day1SituationSummary {
        Day1SituationSummary(
            schemaVersion: 3,
            source: "local_evidence",
            generatedAt: nil,
            project: Day1SituationSummary.Project(
                name: "Agentic30",
                oneLine: "Agentic30: Day 1 고객 검증을 돕는 macOS 앱입니다.",
                customer: "1인 빌더",
                problem: "첫 고객 기준이 흔들림",
                evidenceRefs: ["README.md (README)", ".agentic30/docs/ICP.md (고객 후보)"]
            ),
            diagnosis: Day1SituationSummary.Diagnosis(
                stage: "초기 사용자 검증",
                bottleneck: "측정 기준 근거가 부족함",
                whyNow: "첫 가치 이벤트와 유입 기준을 정해야 합니다.",
                missingSignal: "측정 기준",
                confidence: 0.82,
                evidenceRefs: ["README.md", ".agentic30/docs/ICP.md"]
            ),
            realityGap: Day1SituationSummary.RealityGap(
                docClaim: "README는 초기 가설 중심입니다.",
                observedReality: "Day 1 검증, 온보딩, 계측",
                recommendation: "검증 행동과 계측 기준을 문서에 반영해야 다음 판단이 맞아집니다.",
                evidenceRefs: ["README.md", "git/agent recent work"]
            ),
            baseline: Day1SituationSummary.Baseline(
                target: "인터뷰 5명과 첫 유료 신호",
                current: "초기 사용자 검증: 측정 기준 근거가 부족함",
                day30Question: "30일 뒤 인터뷰 5명, 첫 유료 신호 근거가 실제로 남았나요?",
                metrics: ["인터뷰 5명", "첫 유료 신호"]
            ),
            path: [
                Day1SituationSummary.PathNode(label: "고객 인터뷰", kind: "customer_action", status: "found", why: ".agentic30/docs/ICP.md에 고객 인터뷰 검증 흐름이 있습니다.", evidenceRefs: [".agentic30/docs/ICP.md"]),
                Day1SituationSummary.PathNode(label: "첫 유료 신호", kind: "conversion", status: "found", why: ".agentic30/docs/GOAL.md에 첫 유료 신호 목표가 있습니다.", evidenceRefs: [".agentic30/docs/GOAL.md"])
            ],
            actions: [
                Day1SituationSummary.Action(id: "customer-interview", label: "고객 인터뷰", rationale: "첫 고객 기준을 실제 대화로 확인합니다.", kind: "customer_action", promptSeed: "이번 주 고객 인터뷰로 무엇을 확인할까요?", evidenceRefs: [".agentic30/docs/ICP.md"], evidenceLimited: false),
                Day1SituationSummary.Action(id: "paid-signal", label: "유료 신호", rationale: "돈이나 시간을 쓰는 반응을 오늘 남깁니다.", kind: "conversion", promptSeed: "첫 유료 신호를 어떤 행동으로 확인할까요?", evidenceRefs: [".agentic30/docs/GOAL.md"], evidenceLimited: false)
            ],
            qualityGate: Day1SituationSummary.QualityGate(
                score: 8.2,
                passed: true,
                reasons: ["고객과 문제가 근거에서 확인됨", "관찰할 행동 신호 후보가 있음"]
            ),
            trust: Day1SituationSummary.Trust(
                readOnly: true,
                secretsExcluded: true,
                sourcesUsed: ["onboarding hypothesis", "docs/source"]
            )
        )
    }

    private static func makeUITestingDay1AlignmentPlan() -> Day1AlignmentPlan {
        let documentPointer = "[ALIGNMENT.md](./ALIGNMENT.md) — 회사 미션 ↔ 제품 매핑, 5축 루브릭"
        let signals = Day1IcpSignals(
            productName: "Agentic30",
            currentIcpGuess: "AI 코딩 도구를 쓰는 개발자",
            likelyUsers: ["AI 코딩 도구를 쓰는 개발자", "macOS AI 도구 사용자"],
            problem: "무엇을 팔아야 할지 모른다",
            currentAlternatives: ["수동 문서 정리", "임시 스크립트"],
            evidenceRefs: [
                Day1IcpEvidenceRef(path: "README.md", reason: "앱 목적", quote: "Native macOS menu bar assistant"),
                Day1IcpEvidenceRef(path: ".agentic30/docs/ICP.md", reason: "고객 가설", quote: "AI 코딩 도구를 쓰는 개발자"),
            ],
            missingAssumptions: ["지불 의향", "첫 사용자 획득 채널"],
            confidence: "high"
        )
        let icp = Day1AlignmentComponent(
            id: "icp",
            title: "고객",
            prompt: "이 목표를 검증하려면 이번 주 가장 먼저 확인할 고객은 누구인가요?",
            helperText: "직함보다 지금 같은 문제를 겪고 이번 주 실제로 물어볼 수 있는 고객 조건을 고릅니다.",
            statement: documentPointer,
            evidence: [".agentic30/docs/ICP.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "dev-tool-user", label: "AI 코딩 도구를 쓰는 개발자", description: "이번 주 직접 대화 가능한 사용자입니다. · 근거: .agentic30/docs/ICP.md", preview: "고객", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/ICP.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "solo-builder", label: "1인 빌더", description: "구매자와 사용자가 같은 후보입니다. · 근거: README.md", preview: "고객", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "curious-only", label: "관심만 있음", description: "최근 행동이 없어 다음 시장 신호로 약합니다.", preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let pain = Day1AlignmentComponent(
            id: "pain_point",
            title: "문제",
            prompt: "이 고객이 지금 겪는 가장 압축된 문제는 무엇인가요?",
            helperText: "시간, 돈, 리스크, 반복 행동으로 이미 비용이 나는 문제를 고릅니다.",
            statement: "무엇을 팔아야 할지 모른다",
            evidence: [".agentic30/docs/SPEC.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "what-to-sell", label: "무엇을 팔아야 할지 모름", description: "검증 없이 빌드가 반복됩니다. · 근거: .agentic30/docs/SPEC.md", preview: "문제", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "first-user", label: "첫 사용자를 어디서 데려올지 모름", description: "다음 시장 신호 확인으로 이어집니다. · 근거: .agentic30/docs/GOAL.md", preview: "문제", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/GOAL.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "nice-to-have", label: "있으면 좋음", description: "오늘 비용이 확인되지 않습니다.", preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let outcome = Day1AlignmentComponent(
            id: "outcome",
            title: "확인할 행동",
            prompt: "그 고객에게서 어떤 행동 신호를 확인해야 하나요?",
            helperText: "제품 기능이 아니라 지불 의향, 현재 대안, 최근 사건처럼 관찰 가능한 행동을 씁니다.",
            statement: "첫 대화에서 지불 의향과 현재 대안을 확인한다",
            evidence: [".agentic30/docs/GOAL.md"],
            missingAssumptions: [],
            options: [
                Day1IcpQuestionOption(id: "paid-alternative", label: "첫 대화에서 지불 의향과 대안을 확인한다", description: "다음 시장 신호 확인에서 바로 검증할 수 있습니다. · 근거: .agentic30/docs/GOAL.md", preview: "확인할 행동", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/GOAL.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "market-signal", label: "시장 신호로 첫 사용자 획득 행동을 확인한다", description: "채널과 행동이 함께 남습니다. · 근거: .agentic30/docs/SPEC.md", preview: "확인할 행동", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "ship-feature", label: "기능을 더 만든다", description: "고객 검증 없이 빌드하는 선택입니다.", preview: "Anti", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ]
        )
        let projectGoal = "30일 안에 사용자 100명과 첫 매출 가능성을 검증한다"
        return Day1AlignmentPlan(
            schemaVersion: 1,
            source: "ui-test",
            generatedAt: "2026-05-22T00:00:00.000Z",
            confidence: 0.86,
            fellBackToDeterministic: false,
            projectGoal: projectGoal,
            mission: "Day 1 — 만들기 전에, 팔릴 문제를 고릅니다.\n오늘은 코딩하지 않습니다.\n30일 동안 검증할 고객, 문제, 첫 결제 이유를 한 문장으로 정합니다.",
            signals: signals,
            components: Day1AlignmentComponents(icp: icp, painPoint: pain, outcome: outcome),
            alignmentStatement: Day1AlignmentStatement(
                statement: "목표: \(projectGoal) / 고객: \(documentPointer) / 문제: 무엇을 팔아야 할지 모른다 / 확인할 행동: 첫 대화에서 지불 의향과 현재 대안을 확인한다",
                projectGoal: projectGoal,
                icp: documentPointer,
                painPoint: "무엇을 팔아야 할지 모른다",
                outcome: "첫 대화에서 지불 의향과 현재 대안을 확인한다"
            ),
            qualityGate: Day1AlignmentQualityGate(
                score: 8.6,
                threshold: 7.0,
                passed: true,
                label: "PASS",
                passGate: "목표, 고객, 문제, 확인할 행동이 담긴 핵심 가설이 7.0/10 이상입니다.",
                failGate: "목표, 고객, 문제, 확인할 행동 중 하나가 비어 있습니다.",
                criteria: [
                    Day1AlignmentQualityCriterion(id: "project_goal", label: "목표", score: 2.0, maxScore: 2.0, passed: true, detail: "명확함"),
                    Day1AlignmentQualityCriterion(id: "icp", label: "고객", score: 2.2, maxScore: 2.5, passed: true, detail: documentPointer),
                ]
            ),
            firstInterviewMessage: FirstInterviewMessage(
                channel: "DM",
                recipientPlaceholder: "{name}",
                subject: "핵심 가설 인터뷰",
                bodyTemplate: "안녕하세요 {name}님, AI 코딩 도구로 첫 고객 검증을 확인하고 있습니다.",
                questions: ["최근 사건은 무엇이었나요?", "현재 대안은 무엇인가요?"]
            ),
            day2Handoff: Day1Day2Handoff(
                title: "Day 2 시장 신호로 넘길 핵심 가설",
                body: "유료 대체재와 첫 사용자 획득 행동을 확인합니다.",
                focus: "지불 의향과 현재 대안",
                nextDayPrompt: "유료 대체재 5개와 실제 대화 후보를 확인한다.",
                qualityGateLabel: "PASS 8.6/10"
            ),
            signalDigest: nil
        )
    }

    private static func makeUITestingDay1IcpPlan() -> Day1IcpPlan {
        let optionSets: [[Day1IcpQuestionOption]] = [
            [
                Day1IcpQuestionOption(id: "solo-builder", label: "전업 1인 빌더", description: "이번 주 실제 고객 인터뷰를 잡아야 합니다. · 근거: .agentic30/docs/ICP.md", preview: "고객 후보", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/ICP.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "tool-switcher", label: "AI 도구 전환 사용자", description: "Codex와 Claude 전환에서 인증/실행 마찰을 겪습니다. · 근거: README.md", preview: "Have", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "curious-only", label: "관심만 있음", description: "최근 7일 안에 직접 시도한 사건이 없습니다.", preview: "Anti", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ],
            [
                Day1IcpQuestionOption(id: "stuck-loop", label: "빌드 루프에 막힘", description: "검증 없이 새 기능을 반복해서 만들고 있습니다. · 근거: .agentic30/docs/GOAL.md", preview: "Pain", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/GOAL.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "auth-friction", label: "AI 연결 인증 실패", description: "로컬 실행 보조 앱과 AI 연결 인증 사이에서 진행이 멈춥니다. · 근거: README.md", preview: "문제", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "nice-to-have", label: "있으면 좋음", description: "돈이나 시간을 이미 쓰는 대안이 없습니다.", preview: "Weak", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ],
            [
                Day1IcpQuestionOption(id: "manual-notes", label: "수동 노트/스크립트", description: "현재는 문서와 임시 스크립트로 Day 진행을 관리합니다. · 근거: .agentic30/docs/SPEC.md", preview: "Have", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "codex-menu-bar", label: "macOS 메뉴바 앱", description: "반복 실행과 재시작 복원이 필요한 작업 흐름입니다. · 근거: README.md", preview: "Have", antiSignal: false, evidenceLabel: "근거: README.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "blank-slate", label: "아직 프로젝트 없음", description: "선택한 workspace에 실제 검증 대상이 없습니다.", preview: "Anti", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ],
            [
                Day1IcpQuestionOption(id: "schedule-call", label: "24시간 안에 인터뷰 요청", description: "오늘 바로 연락 가능한 후보가 있습니다. · 근거: .agentic30/docs/ICP.md", preview: "결과", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/ICP.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "capture-proof", label: "첫 반응 캡처", description: "대화 결과를 SPEC/고객 후보 문서에 바로 남길 수 있습니다. · 근거: .agentic30/docs/SPEC.md", preview: "결과", antiSignal: false, evidenceLabel: "근거: .agentic30/docs/SPEC.md", evidenceLimited: false),
                Day1IcpQuestionOption(id: "wait-for-launch", label: "출시 후에 보기", description: "오늘 검증할 행동이 없어 Day 1 게이트를 닫을 수 없습니다.", preview: "Anti", antiSignal: true, evidenceLabel: "근거 부족", evidenceLimited: true),
            ],
        ]
        let dimensions = [
            ("icp", "먼저 도울 사람", "이번 주 인터뷰할 고객 후보는 누구인가요?"),
            ("pain_point", "반복되는 막힘", "최근 실제로 멈춘 문제는 무엇인가요?"),
            ("current_alternative", "현재 대안", "지금은 어떤 방식으로 버티고 있나요?"),
            ("outcome", "다음 검증 결과", "다음 검증으로 넘길 확인 가능한 결과는 무엇인가요?"),
        ]
        let questions = dimensions.enumerated().map { index, item in
            Day1IcpQuestion(
                id: "ui_test_\(item.0)",
                dimension: item.0,
                title: item.1,
                prompt: item.2,
                helperText: "UI test scan cache fixture",
                options: optionSets[index],
                allowFreeText: true,
                freeTextPlaceholder: "직접 입력"
            )
        }
        return Day1IcpPlan(
            schemaVersion: 1,
            source: "ui-test",
            generatedAt: "2026-05-22T00:00:00.000Z",
            confidence: 0.87,
            fellBackToDeterministic: false,
            mission: "Day 1에서 실제 인터뷰로 이어질 고객 후보 v0를 고정합니다.",
            signals: Day1IcpSignals(
                productName: "Agentic30",
                currentIcpGuess: "첫 고객을 정해야 하는 1인 빌더",
                likelyUsers: ["1인 빌더", "macOS AI 도구 사용자"],
                problem: "첫 고객 기준이 재시작 후 사라짐",
                currentAlternatives: ["수동 문서 정리", "임시 스크립트"],
                evidenceRefs: [
                    Day1IcpEvidenceRef(path: "README.md", reason: "앱 목적", quote: "Native macOS menu bar assistant"),
                    Day1IcpEvidenceRef(path: ".agentic30/docs/ICP.md", reason: "고객 가설", quote: "1인 빌더"),
                ],
                missingAssumptions: ["유료 의향", "반복 빈도"],
                confidence: "high"
            ),
            questions: questions,
            icpDraft: IcpDraft(
                description: "첫 고객을 정해야 하는 1인 빌더",
                criteria: ["이번 주 인터뷰 가능", "이미 대안을 쓰고 있음", "최근 막힌 사건이 있음"],
                whyTheyMatter: ["Day 2 시장 신호와 Day 3 실제 행동 질문으로 이어집니다."],
                needs: ["재시작 후에도 Day 1 계획이 유지되어야 함"],
                haves: ["macOS workspace", "AI coding assistant 사용 경험"],
                dontNeeds: ["관심만 있음", "출시 후 검증하겠다는 후보"],
                evidence: ["README.md", ".agentic30/docs/ICP.md"],
                referenceCustomersToFind: ["전업 1인 빌더 1명"]
            ),
            antiIcp: Day1AntiIcp(
                summary: "최근 사건과 현재 대안이 없는 후보는 Day 1에서 제외합니다.",
                rules: [
                    AntiIcpRule(id: "curious-only", label: "관심만 있음", reason: "최근 7일 행동 신호가 없습니다.", evidenceRef: nil),
                    AntiIcpRule(id: "wait-for-launch", label: "출시 후에 보기", reason: "오늘 인터뷰로 검증할 수 없습니다.", evidenceRef: nil),
                ],
                politeInterestGuardrails: ["좋네요만 말하면 고객 후보로 보지 않습니다."]
            ),
            firstInterviewMessage: FirstInterviewMessage(
                channel: "DM",
                recipientPlaceholder: "{name}",
                subject: nil,
                bodyTemplate: "최근 AI 도구로 프로젝트를 진행하다가 멈춘 순간이 있었나요?",
                questions: ["최근 사건은 무엇이었나요?", "지금은 무엇으로 대체하고 있나요?"]
            )
        )
    }

    private static func uiTestingArgumentValue(_ name: String, arguments: [String]) -> String? {
        if let inline = arguments.first(where: { $0.hasPrefix("\(name)=") }) {
            return String(inline.dropFirst(name.count + 1))
        }
        guard let index = arguments.firstIndex(of: name),
              arguments.indices.contains(index + 1)
        else {
            return uiTestingEnvironmentValue(for: name)
        }
        return arguments[index + 1]
    }

    private static func uiTestingFlag(_ name: String, arguments: [String]) -> Bool {
        if arguments.contains(name) { return true }
        guard let value = uiTestingEnvironmentValue(for: name) else { return false }
        return ["1", "true", "yes", "on"].contains(value.lowercased())
    }

    private static func uiTestingEnvironmentValue(for argument: String) -> String? {
        let key = uiTestingEnvironmentKey(for: argument)
        guard let value = ProcessInfo.processInfo.environment[key],
              !value.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty else {
            return nil
        }
        return value
    }

    private static func uiTestingEnvironmentKey(for argument: String) -> String {
        let trimmed = argument.hasPrefix("--") ? String(argument.dropFirst(2)) : argument
        let normalized = trimmed
            .replacingOccurrences(of: "-", with: "_")
            .uppercased()
        return "AGENTIC30_\(normalized)"
    }

    #endif
}

struct FoundationProgressSnapshot: Codable, Hashable {
    var schemaVersion = 1
    var workspaceRoot = ""
    var startedAt: Date?
    var selectedDay = 1
    var completedDays: Set<Int> = []

    private enum CodingKeys: String, CodingKey {
        case schemaVersion
        case workspaceRoot
        case startedAt
        case selectedDay
        case completedDays
    }

    func currentDayNumber(now: Date = Date()) -> Int? {
        guard let startedAt else { return nil }
        let elapsed = now.timeIntervalSince(startedAt)
        let day = Int(floor(elapsed / 86_400)) + 1
        return max(1, min(day, 30))
    }

    func isUnlocked(_ day: Int) -> Bool {
        let clamped = max(1, min(day, 30))
        return hasCompletedDays(through: Self.requiredCompletionDayForUnlocking(day: clamped))
    }

    func isWeekUnlocked(_ week: Int) -> Bool {
        hasCompletedDays(through: Self.requiredCompletionDayForWeek(week))
    }

    func unlockRequirementLabel(forWeek week: Int) -> String? {
        let requiredDay = Self.requiredCompletionDayForWeek(week)
        guard requiredDay > 0 else { return nil }
        return "D\(requiredDay)"
    }

    func nextUnlockedIncompleteDay(after day: Int) -> Int? {
        let clamped = max(1, min(day, 30))
        let laterDays = clamped < 30 ? Array((clamped + 1)...30) : []
        let earlierDays = Array(1...clamped)
        return (laterDays + earlierDays).first { candidate in
            isUnlocked(candidate) && !completedDays.contains(candidate)
        }
    }

    private func hasCompletedDays(through requiredDay: Int) -> Bool {
        guard requiredDay > 0 else { return true }
        return (1...requiredDay).allSatisfy { completedDays.contains($0) }
    }

    private static func requiredCompletionDayForUnlocking(day: Int) -> Int {
        switch day {
        case 1...7:
            return 0
        case 8...14:
            return 7
        case 15...21:
            return 14
        default:
            return 21
        }
    }

    private static func requiredCompletionDayForWeek(_ week: Int) -> Int {
        switch week {
        case ...1:
            return 0
        case 2:
            return 7
        case 3:
            return 14
        default:
            return 21
        }
    }

    var presentationDestination: FoundationCurriculumPresentationDestination {
        if completedDays.contains(30) {
            return .graduation
        }
        return .curriculumDay(max(1, min(selectedDay, 30)))
    }
}

nonisolated enum FoundationCurriculumPresentationDestination: Hashable {
    case curriculumDay(Int)
    case graduation
}

enum FoundationCurriculumLifecycleTransition: Hashable {
    case curriculumDay(Int)
    case graduation
}

struct FoundationCurriculumSurfaceVisibilitySnapshot: Hashable {
    let applicationIsRunning: Bool
    let activeMenubarSurfaceIsVisible: Bool
}

struct MacMenubarItemRegistrationSnapshot: Hashable {
    let isRegistered: Bool
}

struct MacMenubarItemController {
    private let menuBarItemIsRegistered: @MainActor () -> Bool
    private let unregisterMenuBarItem: @MainActor () -> Void

    init(
        menuBarItemIsRegistered: @escaping @MainActor () -> Bool = { true },
        unregisterMenuBarItem: @escaping @MainActor () -> Void = {}
    ) {
        self.menuBarItemIsRegistered = menuBarItemIsRegistered
        self.unregisterMenuBarItem = unregisterMenuBarItem
    }

    @MainActor
    func enterCompletedOrGraduatedState() -> MacMenubarItemRegistrationSnapshot {
        MacMenubarItemRegistrationSnapshot(isRegistered: menuBarItemIsRegistered())
    }

    @MainActor
    func unregisterFromExplicitApplicationTeardown() {
        unregisterMenuBarItem()
    }
}

struct FoundationCurriculumSurfaceVisibilityController {
    private let applicationIsRunning: @MainActor () -> Bool
    private let activeMenubarSurfaceIsVisible: @MainActor () -> Bool
    private let hideApplication: @MainActor () -> Void
    private let hideActiveMenubarSurface: @MainActor () -> Void

    init(
        applicationIsRunning: @escaping @MainActor () -> Bool = { true },
        activeMenubarSurfaceIsVisible: @escaping @MainActor () -> Bool = { true },
        hideApplication: @escaping @MainActor () -> Void = {},
        hideActiveMenubarSurface: @escaping @MainActor () -> Void = {}
    ) {
        self.applicationIsRunning = applicationIsRunning
        self.activeMenubarSurfaceIsVisible = activeMenubarSurfaceIsVisible
        self.hideApplication = hideApplication
        self.hideActiveMenubarSurface = hideActiveMenubarSurface
    }

    @MainActor
    func enterCompletedOrGraduatedState() -> FoundationCurriculumSurfaceVisibilitySnapshot {
        FoundationCurriculumSurfaceVisibilitySnapshot(
            applicationIsRunning: applicationIsRunning(),
            activeMenubarSurfaceIsVisible: activeMenubarSurfaceIsVisible()
        )
    }

    @MainActor
    func hideApplicationFromExplicitUserRequest() {
        hideApplication()
    }

    @MainActor
    func hideActiveMenubarSurfaceFromExplicitUserRequest() {
        hideActiveMenubarSurface()
    }
}

struct FoundationCurriculumLifecycleController {
    private let terminateApplication: @MainActor () -> Void
    private let quitApplication: @MainActor () -> Void
    private let surfaceVisibilityController: FoundationCurriculumSurfaceVisibilityController
    private let menubarItemController: MacMenubarItemController

    init(
        terminateApplication: @escaping @MainActor () -> Void = {},
        quitApplication: @escaping @MainActor () -> Void = {},
        surfaceVisibilityController: FoundationCurriculumSurfaceVisibilityController = FoundationCurriculumSurfaceVisibilityController(),
        menubarItemController: MacMenubarItemController = MacMenubarItemController()
    ) {
        self.terminateApplication = terminateApplication
        self.quitApplication = quitApplication
        self.surfaceVisibilityController = surfaceVisibilityController
        self.menubarItemController = menubarItemController
    }

    @MainActor
    func enterCompletedState(_ snapshot: FoundationProgressSnapshot) -> FoundationCurriculumLifecycleTransition {
        switch snapshot.presentationDestination {
        case .curriculumDay(let day):
            return .curriculumDay(day)
        case .graduation:
            _ = surfaceVisibilityController.enterCompletedOrGraduatedState()
            _ = menubarItemController.enterCompletedOrGraduatedState()
            return .graduation
        }
    }

    @MainActor
    func surfaceVisibilityAfterEnteringCompletedState(
        _ snapshot: FoundationProgressSnapshot
    ) -> FoundationCurriculumSurfaceVisibilitySnapshot? {
        guard snapshot.presentationDestination == .graduation else {
            return nil
        }
        return surfaceVisibilityController.enterCompletedOrGraduatedState()
    }

    @MainActor
    func menubarItemRegistrationAfterEnteringCompletedState(
        _ snapshot: FoundationProgressSnapshot
    ) -> MacMenubarItemRegistrationSnapshot? {
        guard snapshot.presentationDestination == .graduation else {
            return nil
        }
        return menubarItemController.enterCompletedOrGraduatedState()
    }

    @MainActor
    func terminateFromExplicitUserRequest() {
        terminateApplication()
    }

    @MainActor
    func quitFromExplicitUserRequest() {
        quitApplication()
    }

    @MainActor
    func hideApplicationFromExplicitUserRequest() {
        surfaceVisibilityController.hideApplicationFromExplicitUserRequest()
    }

    @MainActor
    func hideActiveMenubarSurfaceFromExplicitUserRequest() {
        surfaceVisibilityController.hideActiveMenubarSurfaceFromExplicitUserRequest()
    }
}

struct FoundationCurriculumPresentationViewModel: Hashable {
    let destination: FoundationCurriculumPresentationDestination

    init(snapshot: FoundationProgressSnapshot) {
        destination = snapshot.presentationDestination
    }
}

struct FoundationProgressStore {
    let workspaceRoot: String
    let appSupportURL: URL

    init(
        workspaceRoot: String,
        appSupportURL: URL = FoundationProgressStore.defaultAppSupportURL()
    ) {
        self.workspaceRoot = workspaceRoot
        self.appSupportURL = appSupportURL
    }

    var fileURL: URL {
        appSupportURL
            .appendingPathComponent("foundation-progress", isDirectory: true)
            .appendingPathComponent("\(Self.stableWorkspaceID(workspaceRoot)).json")
    }

    func load() -> FoundationProgressSnapshot? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard var snapshot = try? decoder.decode(FoundationProgressSnapshot.self, from: data) else {
            return nil
        }
        guard snapshot.workspaceRoot == workspaceRoot else { return nil }
        snapshot.selectedDay = max(1, min(snapshot.selectedDay, 30))
        snapshot.completedDays = Set(snapshot.completedDays.map { max(1, min($0, 30)) })
        return snapshot
    }

    func save(_ snapshot: FoundationProgressSnapshot) {
        var next = snapshot
        next.workspaceRoot = workspaceRoot
        next.selectedDay = max(1, min(next.selectedDay, 30))
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(next) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL)
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    nonisolated static func defaultAppSupportURL() -> URL {
        if let override = ProcessInfo.processInfo.environment["AGENTIC30_APP_SUPPORT_PATH"]?
            .trimmingCharacters(in: .whitespacesAndNewlines),
           !override.isEmpty {
            return URL(fileURLWithPath: override, isDirectory: true)
        }
        return FileManager.default.homeDirectoryForCurrentUser
            .appendingPathComponent("Library/Application Support/agentic30", isDirectory: true)
    }

    nonisolated static func stableWorkspaceID(_ workspaceRoot: String) -> String {
        let normalized = URL(fileURLWithPath: workspaceRoot, isDirectory: true).standardizedFileURL.path
        var hash: UInt64 = 14_695_981_039_346_656_037
        for byte in normalized.utf8 {
            hash ^= UInt64(byte)
            hash &*= 1_099_511_628_211
        }
        return String(format: "%016llx", hash)
    }
}

struct WorkspaceScanResultStore {
    let workspaceRoot: String
    let appSupportURL: URL

    init(
        workspaceRoot: String,
        appSupportURL: URL = FoundationProgressStore.defaultAppSupportURL()
    ) {
        self.workspaceRoot = Self.normalizeWorkspaceRoot(workspaceRoot)
        self.appSupportURL = appSupportURL
    }

    var fileURL: URL {
        appSupportURL
            .appendingPathComponent("workspace-scan-results", isDirectory: true)
            .appendingPathComponent("\(FoundationProgressStore.stableWorkspaceID(workspaceRoot)).json")
    }

    func load() -> AgenticViewModel.WorkspaceScanResult? {
        guard let data = try? Data(contentsOf: fileURL) else { return nil }
        let decoder = JSONDecoder()
        decoder.dateDecodingStrategy = .iso8601
        guard let payload = try? decoder.decode(Payload.self, from: data),
              payload.schemaVersion == Self.schemaVersion,
              Self.normalizeWorkspaceRoot(payload.workspaceRoot) == workspaceRoot,
              payload.scanResult.error == nil else {
            return nil
        }
        return payload.scanResult
    }

    func save(_ scanResult: AgenticViewModel.WorkspaceScanResult, now: Date = Date()) {
        guard scanResult.error == nil else { return }
        let payload = Payload(
            schemaVersion: Self.schemaVersion,
            workspaceRoot: workspaceRoot,
            savedAt: now,
            scanResult: scanResult
        )
        let encoder = JSONEncoder()
        encoder.dateEncodingStrategy = .iso8601
        encoder.outputFormatting = [.prettyPrinted, .sortedKeys]
        guard let data = try? encoder.encode(payload) else { return }
        try? FileManager.default.createDirectory(
            at: fileURL.deletingLastPathComponent(),
            withIntermediateDirectories: true
        )
        try? data.write(to: fileURL, options: [.atomic])
        try? FileManager.default.setAttributes([.posixPermissions: 0o600], ofItemAtPath: fileURL.path)
    }

    func clear() {
        try? FileManager.default.removeItem(at: fileURL)
    }

    private static let schemaVersion = 4

    private struct Payload: Codable {
        let schemaVersion: Int
        let workspaceRoot: String
        let savedAt: Date
        let scanResult: AgenticViewModel.WorkspaceScanResult
    }

    private static func normalizeWorkspaceRoot(_ root: String) -> String {
        URL(fileURLWithPath: root, isDirectory: true).standardizedFileURL.path
    }
}

struct FoundationDayCompletionSaveResult: Hashable {
    let completedDay: Int
    let unlockedDay: Int
    let snapshot: FoundationProgressSnapshot
}

struct FoundationDayCompletionSaveHandler {
    let store: FoundationProgressStore?

    func saveDayCompletion(
        _ day: Int,
        snapshot: FoundationProgressSnapshot,
        workspaceRoot: String
    ) -> FoundationDayCompletionSaveResult {
        let completedDay = max(1, min(day, 30))
        var next = snapshot
        next.workspaceRoot = workspaceRoot
        next.completedDays.insert(completedDay)
        next.selectedDay = next.nextUnlockedIncompleteDay(after: completedDay) ?? completedDay
        store?.save(next)
        return FoundationDayCompletionSaveResult(
            completedDay: completedDay,
            unlockedDay: next.selectedDay,
            snapshot: next
        )
    }
}

#if DEBUG
extension AgenticViewModel {
    func resetVolatileLocalUserDataStateForTesting() {
        resetVolatileLocalUserDataState()
    }
}
#endif

private extension AgenticViewModel {
    static func sidecarDateString(from date: Date) -> String {
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        return formatter.string(from: date)
    }

    func resetVolatileLocalUserDataState() {
        sessions = []
        selectedSessionID = nil
        selectedProvider = .codex
        draft = ""
        environment = .placeholder
        sidecarDiagnostics = nil
        connectionLabel = "Choose a project workspace"
        isConnected = false
        workspaceRoot = WorkspaceSettings.resolvedURL().path
        lastError = nil
        presentationPhase = .compact
        activeSurface = .assistantBubble
        isScanning = false
        scanProgressMessage = ""
        scanProgressLogs = []
        scanProgressSnapshots = []
        clearWorkspaceScanTiming()
        scanResult = nil
        pendingAgentic30GitignoreConsent = nil
        attemptedStartupWorkspaceScanRecoveryRoots = []
        isCreatingDoc = nil
        docCreationLogs = []
        lastDocCreated = nil
        longRunningCompletionAttempts.removeAll()
        pendingLongRunningDisplayAttempts.removeAll()
        notifiedLongRunningCompletionAttemptIds.removeAll()
        macAuthSession = nil
        macOnboardingStatus = .idle
        macOnboardingIntroCompleted = false
        macOnboardingIntakeOnlyCompleted = false
        onboardingContext = nil
        onboardingContextStatus = .idle
        bipCoach = nil
        bipResearch = .empty
        isBipCoachRefreshing = false
        isBipCoachGenerating = false
        isBipCoachCompleting = false
        bipReadiness = nil
        bipSetupGateMessage = nil
        missingBipLocalDocs = []
        missingBipExternalRequirements = []
        iddSetupStatus = "not_started"
        iddSetupComplete = false
        iddCurrentDocType = nil
        iddAmbiguityScore = nil
        iddUnresolvedAssumptions = []
        iddDocOrder = []
        iddDocPreviews = []
        iddProviderRecovery = nil
        iddSetupError = nil
        bipTokenExpired = nil
        bipMissionProgress = nil
        pendingWeeklyRitual = nil
        dayGateBlocked = nil
        dayGateBlockedMessage = nil
        executionMissionCard = nil
        dailyCards = []
        ohInterventionRequired = nil
        providerAuthInProgress = nil
        providerAuthMessage = nil
        sentPromptPreviews = [:]
        submittedStructuredPromptBySession = [:]
        structuredPromptDraftBySession = [:]
        sidecarOutputLogs = [:]
        startupQueuedAction = nil
        startupSessionAppearElapsedMs = nil
        reviewDayDashboardViewModel = nil
        newsMarketRadar = .empty
        newsMarketRadarPreparingForDisplay = false
        strategyReport = .empty
        strategyReportPreparingForDisplay = false
        strategyReportDynamicActivated = false
        githubCliAuthStatus = .unknown
        foundationStartedAt = nil
        foundationProgressState = FoundationProgressSnapshot(workspaceRoot: WorkspaceSettings.resolvedURL().path)
        notionConnected = false
        notionOAuthInProgress = false
        notionOAuthError = nil

        revealWorkItem?.cancel()
        revealWorkItem = nil
        activePresentationSessionID = nil
        revealedAssistantMessageID = nil
        lastBipRequestedAction = nil
        pendingBipAuthRetry = nil
        pendingWorkspaceScanRoot = nil
        pendingWorkspaceScanProvider = nil
        workspaceSetupTelemetryGate = WorkspaceSetupTelemetryGate()
        requestedInitialBipGate = false
        requestedInitialBipMission = false
        activeOnboardingWorkspacePrefetchFingerprint = nil
        replacementSessionCreateInFlight = false
        officeHoursSessionCreateInFlight = false
        latestCurriculumQuestionReframesByKey = [:]
        lastNewsMarketRadarViewedAt = nil
        injectedFoundationFirstPromptKeys = []
        pendingFoundationFirstPromptKeys = []
        startupSessionAppearStartedAt = nil
        didRecordStartupSessionAppear = false
        foundationProgressStore = nil
    }

    func restoreFoundationProgress(arguments: [String]) {
        ensureFoundationProgressStore()
        guard let store = foundationProgressStore else { return }
        #if DEBUG
        let resetsOnboardingForUITesting = Self.uiTestingFlag(
            "--ui-testing-reset-onboarding",
            arguments: arguments
        )
        #else
        let resetsOnboardingForUITesting = arguments.contains("--ui-testing-reset-onboarding")
        #endif
        if resetsOnboardingForUITesting {
            store.clear()
            UserDefaults.standard.removeObject(forKey: Self.kFoundationStartedAtKey)
        }

        #if DEBUG
        if arguments.contains("--ui-testing-seed-review-day-dashboard") {
            let snapshot = FoundationProgressSnapshot(
                workspaceRoot: WorkspaceSettings.resolvedURL().path,
                startedAt: Date(timeIntervalSince1970: 0),
                selectedDay: 7,
                completedDays: Set(1...6)
            )
            store.save(snapshot)
            foundationProgressState = snapshot
            foundationStartedAt = snapshot.startedAt
            reviewDayDashboardViewModel = Self.makeUITestingReviewDayDashboardViewModel()
            return
        }

        if arguments.contains("--ui-testing-seed-foundation-graduation") {
            let snapshot = FoundationProgressSnapshot(
                workspaceRoot: WorkspaceSettings.resolvedURL().path,
                startedAt: Date(timeIntervalSince1970: 0),
                selectedDay: 30,
                completedDays: Set(1...30)
            )
            store.save(snapshot)
            foundationProgressState = snapshot
            foundationStartedAt = snapshot.startedAt
            return
        }
        #endif

        if var stored = store.load() {
            stored.selectedDay = stored.isUnlocked(stored.selectedDay) ? stored.selectedDay : 1
            foundationProgressState = stored
            foundationStartedAt = stored.startedAt
            return
        }

        var snapshot = FoundationProgressSnapshot(workspaceRoot: WorkspaceSettings.resolvedURL().path)
        if WorkspaceSettings.hasExplicitWorkspace,
           let legacyStartedAt = UserDefaults.standard.object(forKey: Self.kFoundationStartedAtKey) as? Date {
            snapshot.startedAt = legacyStartedAt
            store.save(snapshot)
            UserDefaults.standard.removeObject(forKey: Self.kFoundationStartedAtKey)
        }
        foundationProgressState = snapshot
        foundationStartedAt = snapshot.startedAt
    }

    #if DEBUG
    private static func makeUITestingReviewDayDashboardViewModel() -> ReviewDayDashboardViewModel {
        ReviewDayDashboardViewModel(
            schemaVersion: 1,
            componentType: "curriculum_review_day_view_model",
            reviewDay: 7,
            dayRange: ReviewDayRange(start: 1, end: 7),
            tone: "deceleration_coaching",
            curatedMetrics: [
                ReviewDayDashboardMetric(
                    label: "완료 Days",
                    value: "6/7",
                    trend: "steady",
                    intent: "Review Day에 표시할 진행 범위",
                    status: "watch"
                ),
                ReviewDayDashboardMetric(
                    label: "검증된 Actions",
                    value: "3",
                    trend: "evidence-backed",
                    intent: "자동 검증 또는 증거가 있는 실행 수",
                    status: "healthy"
                ),
            ],
            insights: [
                "완료 속도는 좋지만 Day 8 전에는 미완료 Action 1개를 작게 닫아보세요.",
            ],
            nextSteps: [
                "가격 ask 링크 1개를 남기고 다음 Action Day에서 자동 검증해보세요.",
            ],
            isEmpty: false
        )
    }
    #endif

    func ensureFoundationProgressStore() {
        let root = WorkspaceSettings.resolvedURL().path
        if foundationProgressStore?.workspaceRoot != root {
            foundationProgressStore = FoundationProgressStore(workspaceRoot: root)
        }
    }

    func updateFoundationProgress(_ mutate: (inout FoundationProgressSnapshot) -> Void) {
        ensureFoundationProgressStore()
        var snapshot = foundationProgressState
        snapshot.workspaceRoot = WorkspaceSettings.resolvedURL().path
        mutate(&snapshot)
        if !snapshot.isUnlocked(snapshot.selectedDay) {
            snapshot.selectedDay = 1
        }
        foundationProgressState = snapshot
        foundationStartedAt = snapshot.startedAt
        foundationProgressStore?.save(snapshot)
    }
}

// MARK: - ASWebAuthenticationPresentationContextProviding

private class AuthPresentationContext: NSObject, ASWebAuthenticationPresentationContextProviding {
    func presentationAnchor(for session: ASWebAuthenticationSession) -> ASPresentationAnchor {
        NSApplication.shared.keyWindow
        ?? NSApplication.shared.mainWindow
        ?? NSApplication.shared.windows.first(where: { $0.isVisible })
        ?? ASPresentationAnchor()
    }
}

/// Decoded shape of the AI-driven Foundation Day 0/2-7 first prompt that the
/// sidecar emits in response to a `foundation_first_prompt` request. Mirrors
/// the JS-side `buildFirstPromptForDay()` return value documented in
/// `packages/mac/agentic30/sidecar/foundation-chat.mjs` (3-section minimal:
/// Yesterday 1줄 / Today 1줄 / Q 1줄). The persona is fixed to YC 파트너 /
/// 시니어 메이커 (직설+압박, 반말 ~어/야); the host trusts that contract and
/// only displays the rendered text.
///
/// Field names use Swift camelCase; CodingKeys remap snake_case JSON keys
/// (`core_question`, `spec_version`, `sub_workflow`) to match the ontology
/// concept names from `Agentic30FoundationPhase` while keeping Swift
/// idiomatic.
struct FoundationFirstPrompt: Decodable, Hashable {
    let day: Int
    let persona: String
    let template: String
    let yesterday: String
    let today: String
    let question: String
    let coreQuestion: String?
    let specVersion: String?
    let subWorkflow: String?
    let artifacts: [String]
    /// Pre-formatted display text from the sidecar
    /// (`어제: ...\n오늘: ...\nQ: ...`). The host renders this verbatim so
    /// the YC-partner tone and line layout stay locked at the producer.
    let text: String

    private enum CodingKeys: String, CodingKey {
        case day
        case persona
        case template
        case yesterday
        case today
        case question
        case coreQuestion = "core_question"
        case specVersion = "spec_version"
        case subWorkflow = "sub_workflow"
        case artifacts
        case text
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        day = try container.decode(Int.self, forKey: .day)
        persona = (try? container.decode(String.self, forKey: .persona)) ?? ""
        template = (try? container.decode(String.self, forKey: .template)) ?? ""
        yesterday = (try? container.decode(String.self, forKey: .yesterday)) ?? ""
        today = (try? container.decode(String.self, forKey: .today)) ?? ""
        question = (try? container.decode(String.self, forKey: .question)) ?? ""
        coreQuestion = try? container.decode(String.self, forKey: .coreQuestion)
        specVersion = try? container.decode(String.self, forKey: .specVersion)
        subWorkflow = try? container.decode(String.self, forKey: .subWorkflow)
        artifacts = (try? container.decode([String].self, forKey: .artifacts)) ?? []
        let suppliedText = (try? container.decode(String.self, forKey: .text))?
            .trimmingCharacters(in: .whitespacesAndNewlines)
        if let suppliedText, !suppliedText.isEmpty {
            text = suppliedText
        } else {
            text = Self.formatFallbackText(yesterday: yesterday, today: today, question: question)
        }
    }

    /// Memberwise initializer for tests + locally-constructed previews.
    init(
        day: Int,
        persona: String = "YC 파트너 / 시니어 메이커 (직설+압박, 반말)",
        template: String = "3-section minimal",
        yesterday: String,
        today: String,
        question: String,
        coreQuestion: String? = nil,
        specVersion: String? = nil,
        subWorkflow: String? = nil,
        artifacts: [String] = [],
        text: String? = nil
    ) {
        self.day = day
        self.persona = persona
        self.template = template
        self.yesterday = yesterday
        self.today = today
        self.question = question
        self.coreQuestion = coreQuestion
        self.specVersion = specVersion
        self.subWorkflow = subWorkflow
        self.artifacts = artifacts
        let trimmed = text?.trimmingCharacters(in: .whitespacesAndNewlines)
        if let trimmed, !trimmed.isEmpty {
            self.text = trimmed
        } else {
            self.text = Self.formatFallbackText(yesterday: yesterday, today: today, question: question)
        }
    }

    /// Mirror `formatFirstPromptText()` from foundation-chat.mjs: stable
    /// layout — Yesterday / Today / Q on three separate lines, no fluff,
    /// no emoji. Used as the deterministic display fallback when the sidecar
    /// omits or empties `firstPrompt.text`.
    static func formatFallbackText(
        yesterday: String,
        today: String,
        question: String
    ) -> String {
        var lines: [String] = []
        let trimmedYesterday = yesterday.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedToday = today.trimmingCharacters(in: .whitespacesAndNewlines)
        let trimmedQuestion = question.trimmingCharacters(in: .whitespacesAndNewlines)
        if !trimmedYesterday.isEmpty { lines.append("어제: \(trimmedYesterday)") }
        if !trimmedToday.isEmpty { lines.append("오늘: \(trimmedToday)") }
        if !trimmedQuestion.isEmpty { lines.append("Q: \(trimmedQuestion)") }
        return lines.joined(separator: "\n")
    }
}

struct SidecarEvent: Decodable {
    let type: String
    let title: String?
    let message: String?
    let sessionId: String?
    let requestId: String?
    let messageId: String?
    let delta: String?
    let content: String?
    let state: MessageState?
    let workspaceRoot: String?
    let session: ChatSession?
    let sessions: [ChatSession]?
    let environment: SidecarEnvironment?
    let diagnostics: SidecarDiagnostics?
    let bipCoach: BipCoachState?
    let bipSetupReady: Bool?
    let iddSetupComplete: Bool?
    let iddSetupStatus: String?
    let iddCurrentDocType: String?
    let iddAmbiguityScore: Int?
    let iddUnresolvedAssumptions: [String]?
    let iddDocOrder: [String]?
    let iddDocPreviews: [IddDocPreview]?
    let iddProviderRecovery: IddProviderRecovery?
    let iddSetupError: IddSetupError?
    /// Foundation Day index (0-7). Carried by `foundation_first_prompt`
    /// responses so the host knows which day's opener was rendered.
    let day: Int?
    /// AI-driven daily first prompt payload. Non-nil only on
    /// `foundation_first_prompt` events.
    let firstPrompt: FoundationFirstPrompt?
    let missingLocalDocs: [String]?
    let missingExternalRequirements: [String]?
    let nextIddDocumentType: String?
    let nextIddDocumentTitle: String?
    let bipSetupGateMessage: String?

    // Workspace scan result fields
    let scanRoot: String?
    let icp: String?
    let spec: String?
    let values: String?
    let designSystem: String?
    let adr: String?
    let goal: String?
    let docs: String?
    let sheet: String?
    let onboardingHypothesis: WorkspaceOnboardingHypothesis?
    let day1AlignmentPlan: Day1AlignmentPlan?
    let day1IcpPlan: Day1IcpPlan?
    let day1SituationSummary: Day1SituationSummary?
    let day1GoalSelection: Day1GoalSelection?
    let day1SurfaceReview: Day1SurfaceReview?
    let agentic30Gitignore: Agentic30GitignoreState?
    // Workspace-scan abort diagnostics (additive). Set on a workspace_scan_blocked
    // envelope. `abortCause` (soft_timeout | hard_deadline | external) lets the
    // recovery UI tell a real timeout (our wall-clock budget) from an SDK/network
    // abort; `retryAttempt` echoes the attempt number so the UI escalates past an
    // extended-budget retry instead of looping on the same provider.
    let abortCause: String?
    let retryAttempt: Int?
    let dayProgress: DayProgress?
    let dayReviews: [String: DayReview]?
    let officeHoursMemory: OfficeHoursMemorySummary?
    let officeHoursHistory: OfficeHoursHistorySummary?
    let evidenceOS: EvidenceOSSummary?
    let controlState: RecorderControlState?
    let readiness: RecorderCaptureReadiness?
    let frame: RecorderFrameCaptureReceipt?
    let mediaAsset: RecorderMediaAssetReceipt?
    let deletion: RecorderFrameDeleteReceipt?
    let deletionRange: RecorderFrameRangeDeleteReceipt?
    let frames: [RecorderFrameCaptureReceipt]?
    let recorderRawApi: RecorderRawApiStatus?
    let recorderRawApiToken: RecorderRawApiToken?
    let recorderAuditSource: RecorderAuditSource?
    let recorderMcpGrants: [RecorderMcpGrant]?
    let recorderMcpGrant: RecorderMcpGrant?
    let pipes: [RecorderPipeDefinition]?
    let runs: [RecorderPipeRun]?
    let pipeRun: RecorderPipeRun?
    let scheduler: RecorderPipeSchedulerResult?
    let enqueueResult: RecorderPipeSchedulerResult?
    let drainResult: RecorderPipeSchedulerResult?
    let recorderDayLoop: RecorderDayMemoryLoopResult?
    let recorderEvidenceCandidateId: String?
    let recorderEvidenceCandidate: RecorderEvidenceCandidateSummary?
    let proofLedgerEventId: String?
    let proofAcceptedByReview: Bool?
    let proofAcceptedByEvidenceCandidate: Bool?
    let proofLedgerWriteAllowed: Bool?
    let recorderRetentionResult: RecorderRetentionApplyResult?
    let dayClosePolicy: OfficeHoursDayClosePolicy?
    let programNotificationSchedule: ProgramNotificationSchedule?
    // Interview-gate block fields (day_progress_state): when the founder tries to close a
    // gated interview step without naming a next customer action, the sidecar withholds the
    // patch and sends needsCommitment=true + a soft `message`. `message` is shared (declared
    // below); gatedStep names the step that was held.
    let needsCommitment: Bool?
    let gatedStep: String?
    /// Milestone-gate hard block (day_progress_state): the sidecar withheld a
    /// day-progress patch because a program gate (G1/G2/G4…) is blocked
    /// (spec §10.2). Additive — absent on non-blocked updates.
    struct DayGateBlocked: Codable, Equatable {
        struct RequiredEvidence: Codable, Equatable {
            let id: String?
            let label: String?
        }
        let gateId: String?
        let title: String?
        let blockedReason: String?
        let blockedStep: String?
        let requiredEvidence: [RequiredEvidence]?
    }
    let gateBlocked: DayGateBlocked?
    /// IDD mission card for the execution step (`type: "mission_card"`,
    /// spec §11.0/§17.2): the day's curriculum mission + evidence spec +
    /// milestone-gate context, emitted when the Day 2+ loop reaches execution.
    struct MissionCard: Decodable, Equatable {
        struct Mission: Decodable, Equatable {
            let day: Int?
            let title: String?
            let shortTitle: String?
            let summary: String?
            let tasks: [String]?
            let output: String?
            let dayType: String?
            let phase: String?
            let curriculumWeek: Int?
            let substituted: Bool?
            let substitutionReason: String?
            let exitCondition: String?
        }
        struct EvidenceSpec: Decodable, Equatable {
            let evidenceRequired: Bool?
            let artifact: String?
            let allowedEvidenceTypes: [String]?
            let minimumStrength: String?
            let completionSignal: String?
        }
        struct GateContext: Decodable, Equatable {
            let day: Int?
            let blockingGateId: String?
            let states: [String: String]?
        }
        struct DailyCard: Decodable, Equatable, Identifiable {
            enum CardType: String, Decodable, Equatable {
                case officeHoursStateTransition = "office_hours_state_transition"
                case officeHoursAgentWorkpack = "office_hours_agent_workpack"
                case programScoreboardSnapshot = "program_scoreboard_snapshot"
                case revenueOrActivationGate = "revenue_or_activation_gate"
            }
            enum SourceState: String, Decodable, Equatable {
                case ready
                case missing
                case stale
                case manualProofRequired = "manual_proof_required"
                case rejected
            }
            enum ResolutionReason: String, Decodable, Equatable {
                case notSent = "not_sent"
                case messageNotReady = "message_not_ready"
                case channelBlocked = "channel_blocked"
                case wrongCandidate = "wrong_candidate"
                case candidateExhausted = "candidate_exhausted"
                case replacedByNextCandidate = "replaced_by_next_candidate"
            }
            struct Generation: Decodable, Equatable {
                let signalId: String
                let signalLabel: String
                let generationId: String?
                let sourceStateVersion: String?

                private enum CodingKeys: String, CodingKey {
                    case signalId
                    case signalLabel
                    case generationId
                    case generationIdSnake = "generation_id"
                    case sourceStateVersion
                    case sourceStateVersionSnake = "source_state_version"
                }

                init(from decoder: Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    signalId = try DailyCard.requiredString(.signalId, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    signalLabel = try DailyCard.requiredString(.signalLabel, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    generationId = try container.decodeIfPresent(String.self, forKey: .generationId)
                        ?? container.decodeIfPresent(String.self, forKey: .generationIdSnake)
                    sourceStateVersion = try container.decodeIfPresent(String.self, forKey: .sourceStateVersion)
                        ?? container.decodeIfPresent(String.self, forKey: .sourceStateVersionSnake)
                }
            }
            struct ProofLedgerMapping: Decodable, Equatable {
                let entries: [String: String]

                init(from decoder: Decoder) throws {
                    let container = try decoder.singleValueContainer()
                    let entries = try container.decode([String: String].self)
                    guard !entries.isEmpty else {
                        throw DailyCard.corrupted(decoder, code: "ERR_INVALID_PROOF_MAPPING", message: "proofLedgerMapping must be non-empty")
                    }
                    let allowed: [String: Set<String>] = [
                        "self_report": ["officeHoursResolution.negativeEvidenceOnly"],
                        "self-report": ["officeHoursResolution.negativeEvidenceOnly"],
                        "customer_screenshot": ["customerEvidence.acceptedProof"],
                        "paymentIntent": ["firstRevenue.learningSignal"],
                        "paymentRecord": ["firstRevenue.acceptedProof"],
                        "first_value": ["activeUsers100.acceptedProof"],
                        "signup": ["activeUsers100.excludedCount"],
                        "visitor": ["activeUsers100.excludedCount"],
                    ]
                    for (source, destination) in entries {
                        if source == "self_report" || source == "self-report",
                           destination != "officeHoursResolution.negativeEvidenceOnly" {
                            throw DailyCard.corrupted(
                                decoder,
                                code: "ERR_SELF_REPORT_COUNTED_AS_PROOF",
                                message: "self-report cannot count as proof"
                            )
                        }
                        guard allowed[source]?.contains(destination) == true else {
                            throw DailyCard.corrupted(
                                decoder,
                                code: "ERR_INVALID_PROOF_MAPPING",
                                message: "invalid proof mapping \(source) -> \(destination)"
                            )
                        }
                    }
                    self.entries = entries
                }
            }
            struct Choice: Decodable, Equatable {
                let id: String
                let label: String

                private enum CodingKeys: String, CodingKey {
                    case id
                    case label
                }

                init(from decoder: Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    id = try DailyCard.requiredString(.id, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    label = try DailyCard.requiredString(.label, in: container, code: "ERR_MISSING_SOURCE_STATE")
                }
            }
            struct StateTransitionCard: Decodable, Equatable {
                let commitmentId: String
                let sourceCommitmentId: String?
                let candidateName: String
                let actionText: String
                let repeatCountWithoutEvidence: Int
                let choices: [Choice]
                let resolutionReasons: [ResolutionReason]

                private enum CodingKeys: String, CodingKey {
                    case commitmentId
                    case sourceCommitmentId
                    case sourceCommitmentIdSnake = "source_commitment_id"
                    case candidateName
                    case actionText
                    case repeatCountWithoutEvidence
                    case choices
                    case resolutionReasons
                }

                init(from decoder: Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    commitmentId = try DailyCard.requiredString(.commitmentId, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    sourceCommitmentId = try container.decodeIfPresent(String.self, forKey: .sourceCommitmentId)
                        ?? container.decodeIfPresent(String.self, forKey: .sourceCommitmentIdSnake)
                    candidateName = try DailyCard.requiredString(.candidateName, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    actionText = try DailyCard.requiredString(.actionText, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    repeatCountWithoutEvidence = try container.decode(Int.self, forKey: .repeatCountWithoutEvidence)
                    choices = try DailyCard.nonEmptyArray(.choices, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    resolutionReasons = try DailyCard.nonEmptyArray(.resolutionReasons, in: container, code: "ERR_INVALID_RESOLUTION_REASON")
                }
            }
            struct Workpack: Decodable, Equatable {
                let id: String
                let workType: String
                let targetExternalAction: String
                let expectedProof: String
                let notProof: [String]
                let owner: String
                let deadline: String

                private enum CodingKeys: String, CodingKey {
                    case id
                    case workType
                    case targetExternalAction
                    case expectedProof
                    case notProof
                    case owner
                    case deadline
                }

                init(from decoder: Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    id = try DailyCard.requiredString(.id, in: container, code: "ERR_MALFORMED_AGENT_WORKPACK")
                    workType = try DailyCard.requiredString(.workType, in: container, code: "ERR_MALFORMED_AGENT_WORKPACK")
                    targetExternalAction = try DailyCard.requiredString(
                        .targetExternalAction,
                        in: container,
                        code: "ERR_MALFORMED_AGENT_WORKPACK"
                    )
                    expectedProof = try DailyCard.requiredString(.expectedProof, in: container, code: "ERR_MALFORMED_AGENT_WORKPACK")
                    notProof = try DailyCard.nonEmptyStringArray(.notProof, in: container, code: "ERR_MALFORMED_AGENT_WORKPACK")
                    owner = try DailyCard.optionalString(.owner, in: container) ?? ""
                    deadline = try DailyCard.optionalString(.deadline, in: container) ?? ""
                }
            }
            struct AgentWorkpackCard: Decodable, Equatable {
                let sourceCommitmentId: String?
                let selectedLens: String
                let workpack: Workpack

                private enum CodingKeys: String, CodingKey {
                    case sourceCommitmentId
                    case sourceCommitmentIdSnake = "source_commitment_id"
                    case selectedLens
                    case workpack
                }

                init(from decoder: Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    sourceCommitmentId = try container.decodeIfPresent(String.self, forKey: .sourceCommitmentId)
                        ?? container.decodeIfPresent(String.self, forKey: .sourceCommitmentIdSnake)
                    selectedLens = try DailyCard.requiredString(.selectedLens, in: container, code: "ERR_MALFORMED_AGENT_WORKPACK")
                    workpack = try container.decode(Workpack.self, forKey: .workpack)
                }
            }
            struct ScoreboardEntry: Decodable, Equatable {
                let acceptedCount: Int
                let excludedCounts: [String: Int]?
                let sourceState: SourceState
                let nextUnblockAction: String

                private enum CodingKeys: String, CodingKey {
                    case acceptedCount
                    case excludedCounts
                    case sourceState
                    case nextUnblockAction
                }

                init(from decoder: Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    acceptedCount = try container.decode(Int.self, forKey: .acceptedCount)
                    guard acceptedCount >= 0 else {
                        throw DecodingError.dataCorruptedError(
                            forKey: .acceptedCount,
                            in: container,
                            debugDescription: "ERR_MISSING_SOURCE_STATE: acceptedCount must be non-negative"
                        )
                    }
                    excludedCounts = try container.decodeIfPresent([String: Int].self, forKey: .excludedCounts)
                    sourceState = try DailyCard.requiredSourceState(.sourceState, in: container)
                    nextUnblockAction = try DailyCard.requiredString(.nextUnblockAction, in: container, code: "ERR_MISSING_SOURCE_STATE")
                }
            }
            struct ProgramScoreboards: Decodable, Equatable {
                let activeUsers100: ScoreboardEntry
                let firstRevenue: ScoreboardEntry
            }
            struct ProgramScoreboardCard: Decodable, Equatable {
                let scoreboards: ProgramScoreboards
            }
            struct GateCard: Decodable, Equatable {
                let gate: String
                let requires: [String]
                let satisfied: Bool
                let blockingReasons: [String]
                let recoveryBranch: String
                let nextCardType: String

                private enum CodingKeys: String, CodingKey {
                    case gate
                    case requires
                    case satisfied
                    case blockingReasons
                    case recoveryBranch
                    case nextCardType
                }

                init(from decoder: Decoder) throws {
                    let container = try decoder.container(keyedBy: CodingKeys.self)
                    gate = try DailyCard.requiredString(.gate, in: container, code: "ERR_UNKNOWN_CARD_TYPE")
                    requires = try DailyCard.nonEmptyStringArray(.requires, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    satisfied = try container.decode(Bool.self, forKey: .satisfied)
                    blockingReasons = satisfied
                        ? (try container.decodeIfPresent([String].self, forKey: .blockingReasons) ?? [])
                        : try DailyCard.nonEmptyStringArray(.blockingReasons, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    recoveryBranch = try DailyCard.requiredString(.recoveryBranch, in: container, code: "ERR_MISSING_SOURCE_STATE")
                    nextCardType = try DailyCard.requiredString(.nextCardType, in: container, code: "ERR_UNKNOWN_CARD_TYPE")
                }
            }

            let id: String?
            let type: CardType
            let schemaVersion: Int
            let programDay: Int
            let generation: Generation
            let sourceState: SourceState
            let sourceStateVersion: String?
            let sourceCommitmentId: String?
            let requiresUserAction: Bool
            let proofLedgerMapping: ProofLedgerMapping
            let stateTransition: StateTransitionCard?
            let agentWorkpack: AgentWorkpackCard?
            let scoreboard: ProgramScoreboardCard?
            let gateCard: GateCard?

            var stableID: String {
                return [
                    "\(programDay)",
                    type.rawValue,
                    logicalSourceID,
                ].joined(separator: ":")
            }

            private var logicalSourceID: String {
                switch type {
                case .officeHoursStateTransition:
                    return sourceCommitmentId
                        ?? stateTransition?.sourceCommitmentId
                        ?? stateTransition?.commitmentId
                        ?? generation.signalId
                case .officeHoursAgentWorkpack:
                    return sourceCommitmentId
                        ?? agentWorkpack?.sourceCommitmentId
                        ?? generation.signalId
                case .programScoreboardSnapshot:
                    return generation.signalId
                case .revenueOrActivationGate:
                    return gateCard?.gate ?? generation.signalId
                }
            }

            var displayOrder: Int {
                switch type {
                case .officeHoursStateTransition:
                    return 0
                case .officeHoursAgentWorkpack:
                    return 1
                case .programScoreboardSnapshot:
                    return 2
                case .revenueOrActivationGate:
                    return 3
                }
            }

            private enum CodingKeys: String, CodingKey {
                case id
                case type
                case schemaVersion
                case programDay
                case generation
                case sourceState
                case sourceStateVersion
                case sourceStateVersionSnake = "source_state_version"
                case sourceCommitmentId
                case sourceCommitmentIdSnake = "source_commitment_id"
                case requiresUserAction
                case proofLedgerMapping
            }

            init(from decoder: Decoder) throws {
                let container = try decoder.container(keyedBy: CodingKeys.self)
                let rawType = try DailyCard.requiredString(.type, in: container, code: "ERR_UNKNOWN_CARD_TYPE")
                guard let type = CardType(rawValue: rawType) else {
                    throw DecodingError.dataCorruptedError(
                        forKey: .type,
                        in: container,
                        debugDescription: "ERR_UNKNOWN_CARD_TYPE: unknown daily card type"
                    )
                }
                self.type = type
                id = try container.decodeIfPresent(String.self, forKey: .id)
                schemaVersion = try container.decode(Int.self, forKey: .schemaVersion)
                guard schemaVersion >= 1 else {
                    throw DecodingError.dataCorruptedError(
                        forKey: .schemaVersion,
                        in: container,
                        debugDescription: "ERR_MISSING_SOURCE_STATE: schemaVersion is required"
                    )
                }
                programDay = try container.decode(Int.self, forKey: .programDay)
                guard programDay >= 1 else {
                    throw DecodingError.dataCorruptedError(
                        forKey: .programDay,
                        in: container,
                        debugDescription: "ERR_MISSING_SOURCE_STATE: programDay is required"
                    )
                }
                generation = try container.decode(Generation.self, forKey: .generation)
                sourceState = try DailyCard.requiredSourceState(.sourceState, in: container)
                sourceStateVersion = try container.decodeIfPresent(String.self, forKey: .sourceStateVersion)
                    ?? container.decodeIfPresent(String.self, forKey: .sourceStateVersionSnake)
                    ?? generation.sourceStateVersion
                sourceCommitmentId = try container.decodeIfPresent(String.self, forKey: .sourceCommitmentId)
                    ?? container.decodeIfPresent(String.self, forKey: .sourceCommitmentIdSnake)
                requiresUserAction = try container.decode(Bool.self, forKey: .requiresUserAction)
                proofLedgerMapping = try container.decode(ProofLedgerMapping.self, forKey: .proofLedgerMapping)

                switch type {
                case .officeHoursStateTransition:
                    stateTransition = try StateTransitionCard(from: decoder)
                    agentWorkpack = nil
                    scoreboard = nil
                    gateCard = nil
                case .officeHoursAgentWorkpack:
                    stateTransition = nil
                    agentWorkpack = try AgentWorkpackCard(from: decoder)
                    scoreboard = nil
                    gateCard = nil
                case .programScoreboardSnapshot:
                    stateTransition = nil
                    agentWorkpack = nil
                    scoreboard = try ProgramScoreboardCard(from: decoder)
                    gateCard = nil
                case .revenueOrActivationGate:
                    stateTransition = nil
                    agentWorkpack = nil
                    scoreboard = nil
                    gateCard = try GateCard(from: decoder)
                }
            }

            private static func requiredSourceState<K>(
                _ key: K,
                in container: KeyedDecodingContainer<K>
            ) throws -> SourceState where K: CodingKey {
                guard let value = try container.decodeIfPresent(SourceState.self, forKey: key) else {
                    throw DecodingError.dataCorruptedError(
                        forKey: key,
                        in: container,
                        debugDescription: "ERR_MISSING_SOURCE_STATE: \(key.stringValue) is required"
                    )
                }
                return value
            }

            private static func requiredString<K>(
                _ key: K,
                in container: KeyedDecodingContainer<K>,
                code: String
            ) throws -> String where K: CodingKey {
                let value = try optionalString(key, in: container)
                guard let value, !value.isEmpty else {
                    throw DecodingError.dataCorruptedError(
                        forKey: key,
                        in: container,
                        debugDescription: "\(code): \(key.stringValue) is required"
                    )
                }
                return value
            }

            private static func optionalString<K>(
                _ key: K,
                in container: KeyedDecodingContainer<K>
            ) throws -> String? where K: CodingKey {
                if let value = try? container.decodeIfPresent(String.self, forKey: key) {
                    return value.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty
                }
                if let value = try? container.decodeIfPresent(Int.self, forKey: key) {
                    return String(value)
                }
                if let value = try? container.decodeIfPresent(Double.self, forKey: key) {
                    return String(value)
                }
                if let value = try? container.decodeIfPresent(Bool.self, forKey: key) {
                    return String(value)
                }
                return nil
            }

            private static func nonEmptyArray<T, K>(
                _ key: K,
                in container: KeyedDecodingContainer<K>,
                code: String
            ) throws -> [T] where T: Decodable, K: CodingKey {
                let values = try container.decodeIfPresent([T].self, forKey: key)
                guard let values, !values.isEmpty else {
                    throw DecodingError.dataCorruptedError(
                        forKey: key,
                        in: container,
                        debugDescription: "\(code): \(key.stringValue) must be non-empty"
                    )
                }
                return values
            }

            private static func nonEmptyStringArray<K>(
                _ key: K,
                in container: KeyedDecodingContainer<K>,
                code: String
            ) throws -> [String] where K: CodingKey {
                let values: [String] = try DailyCard.nonEmptyArray(key, in: container, code: code)
                guard values.allSatisfy({ !$0.trimmingCharacters(in: .whitespacesAndNewlines).isEmpty }) else {
                    throw DecodingError.dataCorruptedError(
                        forKey: key,
                        in: container,
                        debugDescription: "\(code): \(key.stringValue) must contain only non-empty strings"
                    )
                }
                return values
            }

            private static func corrupted(_ decoder: Decoder, code: String, message: String) -> DecodingError {
                DecodingError.dataCorrupted(DecodingError.Context(
                    codingPath: decoder.codingPath,
                    debugDescription: "\(code): \(message)"
                ))
            }
        }
        let day: Int?
        let source: String?
        let mission: Mission?
        let evidenceSpec: EvidenceSpec?
        let gateContext: GateContext?
        let generatedAt: String?
        let dailyCard: DailyCard?

        private enum CodingKeys: String, CodingKey {
            case type
            case day
            case programDay
            case source
            case mission
            case evidenceSpec
            case gateContext
            case generatedAt
        }

        init(from decoder: Decoder) throws {
            let container = try decoder.container(keyedBy: CodingKeys.self)
            if try container.decodeIfPresent(String.self, forKey: .type) != nil {
                let dailyCard = try DailyCard(from: decoder)
                self.dailyCard = dailyCard
                day = dailyCard.programDay
                source = try container.decodeIfPresent(String.self, forKey: .source) ?? "program_v2"
                mission = nil
                evidenceSpec = nil
                gateContext = nil
                generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
                return
            }
            day = try container.decodeIfPresent(Int.self, forKey: .day)
                ?? container.decodeIfPresent(Int.self, forKey: .programDay)
            source = try container.decodeIfPresent(String.self, forKey: .source)
            mission = try container.decodeIfPresent(Mission.self, forKey: .mission)
            evidenceSpec = try container.decodeIfPresent(EvidenceSpec.self, forKey: .evidenceSpec)
            gateContext = try container.decodeIfPresent(GateContext.self, forKey: .gateContext)
            generatedAt = try container.decodeIfPresent(String.self, forKey: .generatedAt)
            dailyCard = nil
        }
    }
    let missionCard: MissionCard?
    /// System-triggered Office Hours intervention (spec §13.1,
    /// `type: "office_hours_intervention_required"`): a blocked milestone
    /// gate (G2/G4/G5/G7) or an interview confession surfaces a card whose
    /// CTA opens an intervention-framed Office Hours session
    /// (`office_hours_start` + `trigger`).
    struct OhInterventionRequired: Codable, Equatable {
        let triggerId: String?
        let severity: String?
        let source: String?
        let gateId: String?
        let ruleId: String?
        let abbreviated: Bool?
        let questions: [String]?
        let exitCondition: String?
        let postSessionEvidence: String?
        let day: Int?
    }
    let intervention: OhInterventionRequired?
    let error: String?
    /// Set by the sidecar on `type: "error"` envelopes that represent an
    /// expected, recoverable upstream provider condition (`"provider_usage_limit"`
    /// for quota, `"provider_auth_required"` for missing sign-in/API key) rather
    /// than a real fault. The host uses it to surface the actionable message
    /// instead of capturing a generic exception.
    let errorKind: String?

    // Document creation fields
    let docType: String?
    let docPath: String?
    let progressText: String?

    // Notion OAuth fields
    let notionConnected: Bool?
    let success: Bool?
    let disconnected: Bool?
    let authUrl: String?

    // BIP Readiness fields (bip_readiness_event + bip_token_expired)
    let rowId: String?
    let status: String?
    let detail: String?
    let log: String?
    let readinessError: BipReadinessError?
    let bipTokenExpiredMessage: String?
    let resourceName: String?
    let resourceUrl: String?

    // BIP mission progress fields
    let stage: String?
    let provider: String?
    let model: String?
    let reason: String?
    let nextProvider: String?
    let availableProviders: [String]?
    let providerReadiness: [WorkspaceScanProviderReadiness]?
    let sheetRowsRead: Int?
    let docCharsRead: Int?
    let elapsedMs: Int?
    let contextMetrics: OfficeHoursContextMetrics?
    let questionIndex: Int?
    let answeredQuestionCount: Int?
    let expectedQuestionCount: Int?
    let questionElapsedMs: Int?
    let requestReadyLatencyMs: Int?
    let stepIndex: Int?
    let totalSteps: Int?
    let etaSeconds: Int?
    let foundCount: Int?
    let phase: String?
    let toolName: String?
    let summary: String?
    // R6 weekly ritual prompt payload (`weekly_ritual_prompt` event).
    let weeklyRitualPrompt: WeeklyRitualPrompt?
    let requestEmit: SidecarRequestEmit?
    let questionId: String?
    let originalQuestion: String?
    let reframedQuestion: String?
    let newsMarketRadar: NewsMarketRadarSnapshot?
    let newsMarketRadarStatus: NewsMarketRadarStatus?
    let strategyReport: StrategyReportSnapshot?
    let strategyReportStatus: StrategyReportStatus?
    let bipResearch: BipResearchSnapshot?
    let bipResearchStatus: BipResearchStatus?
    let workHistory: WorkHistorySnapshot?
    let workHistoryStatus: WorkHistoryStatus?
    let officeHoursSourceGate: OfficeHoursSourceGate?
    let officeHoursDailyDigest: OfficeHoursDailyDigest?
    let morningBriefing: MorningBriefing?
    let morningBriefingPrevious: MorningBriefing?
    let morningBriefingStatus: MorningBriefingStatus?
    let morningBriefingProgress: MorningBriefingProgress?
    let integrationStatus: IntegrationStatusSnapshot?
    let exaMcpConnect: ExaMcpConnectResult?
    let mcpOauthConnect: McpOauthConnectResult?
    // office_hours_commitment_candidates: context-aware commitment-close proposals
    // generated from this interview's own answers. Proposals only — the stored
    // commitment is always the founder's resolved text (user-origin gate).
    let commitmentCandidates: [String]?

    init(
        type: String,
        title: String? = nil,
        message: String?,
        sessionId: String?,
        requestId: String? = nil,
        messageId: String?,
        delta: String?,
        content: String?,
        state: MessageState? = nil,
        workspaceRoot: String?,
        session: ChatSession?,
        sessions: [ChatSession]?,
        environment: SidecarEnvironment?,
        diagnostics: SidecarDiagnostics?,
        bipCoach: BipCoachState?,
        bipSetupReady: Bool?,
        iddSetupComplete: Bool? = nil,
        iddSetupStatus: String? = nil,
        iddCurrentDocType: String? = nil,
        iddAmbiguityScore: Int? = nil,
        iddUnresolvedAssumptions: [String]? = nil,
        iddDocOrder: [String]? = nil,
        iddDocPreviews: [IddDocPreview]? = nil,
        iddProviderRecovery: IddProviderRecovery? = nil,
        iddSetupError: IddSetupError? = nil,
        day: Int?,
        firstPrompt: FoundationFirstPrompt?,
        missingLocalDocs: [String]?,
        missingExternalRequirements: [String]?,
        nextIddDocumentType: String?,
        nextIddDocumentTitle: String?,
        bipSetupGateMessage: String?,
        scanRoot: String?,
        icp: String?,
        spec: String?,
        values: String?,
        designSystem: String?,
        adr: String?,
        goal: String?,
        docs: String?,
        sheet: String?,
        onboardingHypothesis: WorkspaceOnboardingHypothesis?,
        day1AlignmentPlan: Day1AlignmentPlan? = nil,
        day1IcpPlan: Day1IcpPlan? = nil,
        day1SituationSummary: Day1SituationSummary? = nil,
        day1GoalSelection: Day1GoalSelection? = nil,
        day1SurfaceReview: Day1SurfaceReview? = nil,
        agentic30Gitignore: Agentic30GitignoreState? = nil,
        abortCause: String? = nil,
        retryAttempt: Int? = nil,
        dayProgress: DayProgress? = nil,
        dayReviews: [String: DayReview]? = nil,
        officeHoursMemory: OfficeHoursMemorySummary? = nil,
        officeHoursHistory: OfficeHoursHistorySummary? = nil,
        evidenceOS: EvidenceOSSummary? = nil,
        dayClosePolicy: OfficeHoursDayClosePolicy? = nil,
        programNotificationSchedule: ProgramNotificationSchedule? = nil,
        needsCommitment: Bool? = nil,
        gatedStep: String? = nil,
        gateBlocked: DayGateBlocked? = nil,
        missionCard: MissionCard? = nil,
        intervention: OhInterventionRequired? = nil,
        error: String?,
        errorKind: String? = nil,
        docType: String?,
        docPath: String?,
        progressText: String?,
        notionConnected: Bool?,
        success: Bool?,
        disconnected: Bool?,
        authUrl: String?,
        rowId: String?,
        status: String?,
        detail: String?,
        log: String?,
        readinessError: BipReadinessError?,
        bipTokenExpiredMessage: String?,
        resourceName: String?,
        resourceUrl: String?,
        stage: String?,
        provider: String?,
        model: String? = nil,
        reason: String? = nil,
        nextProvider: String? = nil,
        availableProviders: [String]? = nil,
        providerReadiness: [WorkspaceScanProviderReadiness]? = nil,
        sheetRowsRead: Int?,
        docCharsRead: Int?,
        elapsedMs: Int?,
        contextMetrics: OfficeHoursContextMetrics? = nil,
        questionIndex: Int? = nil,
        answeredQuestionCount: Int? = nil,
        expectedQuestionCount: Int? = nil,
        questionElapsedMs: Int? = nil,
        requestReadyLatencyMs: Int? = nil,
        stepIndex: Int? = nil,
        totalSteps: Int? = nil,
        etaSeconds: Int? = nil,
        foundCount: Int? = nil,
        phase: String?,
        toolName: String?,
        summary: String?,
        weeklyRitualPrompt: WeeklyRitualPrompt?,
        requestEmit: SidecarRequestEmit?,
        questionId: String? = nil,
        originalQuestion: String? = nil,
        reframedQuestion: String? = nil,
        newsMarketRadar: NewsMarketRadarSnapshot? = nil,
        newsMarketRadarStatus: NewsMarketRadarStatus? = nil,
        strategyReport: StrategyReportSnapshot? = nil,
        strategyReportStatus: StrategyReportStatus? = nil,
        bipResearch: BipResearchSnapshot? = nil,
        bipResearchStatus: BipResearchStatus? = nil,
        workHistory: WorkHistorySnapshot? = nil,
        workHistoryStatus: WorkHistoryStatus? = nil,
        officeHoursSourceGate: OfficeHoursSourceGate? = nil,
        officeHoursDailyDigest: OfficeHoursDailyDigest? = nil,
        morningBriefing: MorningBriefing? = nil,
        morningBriefingPrevious: MorningBriefing? = nil,
        morningBriefingStatus: MorningBriefingStatus? = nil,
        morningBriefingProgress: MorningBriefingProgress? = nil,
        integrationStatus: IntegrationStatusSnapshot? = nil,
        exaMcpConnect: ExaMcpConnectResult? = nil,
        mcpOauthConnect: McpOauthConnectResult? = nil,
        commitmentCandidates: [String]? = nil
    ) {
        self.type = type
        self.title = title
        self.message = message
        self.sessionId = sessionId
        self.requestId = requestId
        self.messageId = messageId
        self.delta = delta
        self.content = content
        self.state = state
        self.workspaceRoot = workspaceRoot
        self.session = session
        self.sessions = sessions
        self.environment = environment
        self.diagnostics = diagnostics
        self.bipCoach = bipCoach
        self.bipSetupReady = bipSetupReady
        self.iddSetupComplete = iddSetupComplete
        self.iddSetupStatus = iddSetupStatus
        self.iddCurrentDocType = iddCurrentDocType
        self.iddAmbiguityScore = iddAmbiguityScore
        self.iddUnresolvedAssumptions = iddUnresolvedAssumptions
        self.iddDocOrder = iddDocOrder
        self.iddDocPreviews = iddDocPreviews
        self.iddProviderRecovery = iddProviderRecovery
        self.iddSetupError = iddSetupError
        self.day = day
        self.firstPrompt = firstPrompt
        self.missingLocalDocs = missingLocalDocs
        self.missingExternalRequirements = missingExternalRequirements
        self.nextIddDocumentType = nextIddDocumentType
        self.nextIddDocumentTitle = nextIddDocumentTitle
        self.bipSetupGateMessage = bipSetupGateMessage
        self.scanRoot = scanRoot
        self.icp = icp
        self.spec = spec
        self.values = values
        self.designSystem = designSystem
        self.adr = adr
        self.goal = goal
        self.docs = docs
        self.sheet = sheet
        self.onboardingHypothesis = onboardingHypothesis
        self.day1AlignmentPlan = day1AlignmentPlan
        self.day1IcpPlan = day1IcpPlan
        self.day1SituationSummary = day1SituationSummary
        self.day1GoalSelection = day1GoalSelection
        self.day1SurfaceReview = day1SurfaceReview
        self.agentic30Gitignore = agentic30Gitignore
        self.abortCause = abortCause
        self.retryAttempt = retryAttempt
        self.dayProgress = dayProgress
        self.dayReviews = dayReviews
        self.officeHoursMemory = officeHoursMemory
        self.officeHoursHistory = officeHoursHistory
        self.evidenceOS = evidenceOS
        self.controlState = nil
        self.readiness = nil
        self.frame = nil
        self.mediaAsset = nil
        self.deletion = nil
        self.deletionRange = nil
        self.frames = nil
        self.recorderRawApi = nil
        self.recorderRawApiToken = nil
        self.recorderAuditSource = nil
        self.recorderMcpGrants = nil
        self.recorderMcpGrant = nil
        self.pipes = nil
        self.runs = nil
        self.pipeRun = nil
        self.scheduler = nil
        self.enqueueResult = nil
        self.drainResult = nil
        self.recorderDayLoop = nil
        self.recorderEvidenceCandidateId = nil
        self.recorderEvidenceCandidate = nil
        self.proofLedgerEventId = nil
        self.proofAcceptedByReview = nil
        self.proofAcceptedByEvidenceCandidate = nil
        self.proofLedgerWriteAllowed = nil
        self.recorderRetentionResult = nil
        self.dayClosePolicy = dayClosePolicy
        self.programNotificationSchedule = programNotificationSchedule
        self.needsCommitment = needsCommitment
        self.gatedStep = gatedStep
        self.gateBlocked = gateBlocked
        self.missionCard = missionCard
        self.intervention = intervention
        self.error = error
        self.errorKind = errorKind
        self.docType = docType
        self.docPath = docPath
        self.progressText = progressText
        self.notionConnected = notionConnected
        self.success = success
        self.disconnected = disconnected
        self.authUrl = authUrl
        self.rowId = rowId
        self.status = status
        self.detail = detail
        self.log = log
        self.readinessError = readinessError
        self.bipTokenExpiredMessage = bipTokenExpiredMessage
        self.resourceName = resourceName
        self.resourceUrl = resourceUrl
        self.stage = stage
        self.provider = provider
        self.model = model
        self.reason = reason
        self.nextProvider = nextProvider
        self.availableProviders = availableProviders
        self.providerReadiness = providerReadiness
        self.sheetRowsRead = sheetRowsRead
        self.docCharsRead = docCharsRead
        self.elapsedMs = elapsedMs
        self.contextMetrics = contextMetrics
        self.questionIndex = questionIndex
        self.answeredQuestionCount = answeredQuestionCount
        self.expectedQuestionCount = expectedQuestionCount
        self.questionElapsedMs = questionElapsedMs
        self.requestReadyLatencyMs = requestReadyLatencyMs
        self.stepIndex = stepIndex
        self.totalSteps = totalSteps
        self.etaSeconds = etaSeconds
        self.foundCount = foundCount
        self.phase = phase
        self.toolName = toolName
        self.summary = summary
        self.weeklyRitualPrompt = weeklyRitualPrompt
        self.requestEmit = requestEmit
        self.questionId = questionId
        self.originalQuestion = originalQuestion
        self.reframedQuestion = reframedQuestion
        self.newsMarketRadar = newsMarketRadar
        self.newsMarketRadarStatus = newsMarketRadarStatus
        self.strategyReport = strategyReport
        self.strategyReportStatus = strategyReportStatus
        self.bipResearch = bipResearch
        self.bipResearchStatus = bipResearchStatus
        self.workHistory = workHistory
        self.workHistoryStatus = workHistoryStatus
        self.officeHoursSourceGate = officeHoursSourceGate
        self.officeHoursDailyDigest = officeHoursDailyDigest
        self.morningBriefing = morningBriefing
        self.morningBriefingPrevious = morningBriefingPrevious
        self.morningBriefingStatus = morningBriefingStatus
        self.morningBriefingProgress = morningBriefingProgress
        self.integrationStatus = integrationStatus
        self.exaMcpConnect = exaMcpConnect
        self.mcpOauthConnect = mcpOauthConnect
        self.commitmentCandidates = commitmentCandidates
    }

    var bipMissionProgress: BipMissionProgress? {
        guard type == "bip_coach_generation_progress",
              let stage else { return nil }
        return BipMissionProgress(
            stage: stage,
            detail: detail,
            provider: provider,
            sheetRowsRead: sheetRowsRead,
            docCharsRead: docCharsRead,
            elapsedMs: elapsedMs
        )
    }
}

enum SidecarRequestEmitEvent: String, Codable, CaseIterable {
    case workspaceSetupStarted = "workspace_setup_started"
    case workspaceSetupFailed = "workspace_setup_failed"
    case workspaceSetupCompleted = "workspace_setup_completed"
}

struct SidecarRequestEmit: Decodable, Hashable {
    static let supportedSchemaVersion = 1

    let event: SidecarRequestEmitEvent
    let eventSchemaVersion: Int
    let properties: [String: SidecarRequestEmitJSONValue]

    init(
        event: SidecarRequestEmitEvent,
        eventSchemaVersion: Int = Self.supportedSchemaVersion,
        properties: [String: SidecarRequestEmitJSONValue] = [:]
    ) throws {
        guard eventSchemaVersion == Self.supportedSchemaVersion else {
            throw DecodingError.dataCorrupted(
                DecodingError.Context(
                    codingPath: [],
                    debugDescription: "Unsupported request_emit event_schema_version: \(eventSchemaVersion)"
                )
            )
        }
        self.event = event
        self.eventSchemaVersion = eventSchemaVersion
        self.properties = properties
    }

    var telemetryProperties: [String: Any] {
        var output = properties.mapValues { $0.anyValue }
        output["event_schema_version"] = eventSchemaVersion
        return output
    }

    private enum CodingKeys: String, CodingKey {
        case event
        case eventSchemaVersion = "event_schema_version"
        case properties
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)
        event = try container.decode(SidecarRequestEmitEvent.self, forKey: .event)
        eventSchemaVersion = try container.decode(Int.self, forKey: .eventSchemaVersion)
        guard eventSchemaVersion == Self.supportedSchemaVersion else {
            throw DecodingError.dataCorruptedError(
                forKey: .eventSchemaVersion,
                in: container,
                debugDescription: "Unsupported request_emit event_schema_version: \(eventSchemaVersion)"
            )
        }
        properties = try container.decodeIfPresent(
            [String: SidecarRequestEmitJSONValue].self,
            forKey: .properties
        ) ?? [:]
    }
}

enum SidecarRequestEmitJSONValue: Decodable, Hashable {
    case string(String)
    case int(Int)
    case double(Double)
    case bool(Bool)
    case object([String: SidecarRequestEmitJSONValue])
    case array([SidecarRequestEmitJSONValue])
    case null

    var anyValue: Any {
        switch self {
        case .string(let value):
            return value
        case .int(let value):
            return value
        case .double(let value):
            return value
        case .bool(let value):
            return value
        case .object(let value):
            return value.mapValues { $0.anyValue }
        case .array(let value):
            return value.map { $0.anyValue }
        case .null:
            return NSNull()
        }
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.singleValueContainer()
        if container.decodeNil() {
            self = .null
        } else if let value = try? container.decode(Bool.self) {
            self = .bool(value)
        } else if let value = try? container.decode(Int.self) {
            self = .int(value)
        } else if let value = try? container.decode(Double.self) {
            self = .double(value)
        } else if let value = try? container.decode(String.self) {
            self = .string(value)
        } else if let value = try? container.decode([String: SidecarRequestEmitJSONValue].self) {
            self = .object(value)
        } else if let value = try? container.decode([SidecarRequestEmitJSONValue].self) {
            self = .array(value)
        } else {
            throw DecodingError.dataCorruptedError(
                in: container,
                debugDescription: "Unsupported request_emit property value"
            )
        }
    }
}

struct WorkspaceSetupTelemetryGate {
    private var capturedStartedRequests = Set<SidecarRequestEmit>()
    private var didScanSucceed = false
    private var didReceiveFirstRealInput = false
    private var didEmitCompleted = false
    private var pendingCompleted: SidecarRequestEmit?

    mutating func requestsToCapture(afterReceiving request: SidecarRequestEmit) -> [SidecarRequestEmit] {
        switch request.event {
        case .workspaceSetupStarted:
            guard capturedStartedRequests.insert(request).inserted else { return [] }
            return [request]
        case .workspaceSetupFailed:
            return [request]
        case .workspaceSetupCompleted:
            guard !didEmitCompleted else { return [] }
            guard didScanSucceed && didReceiveFirstRealInput else {
                pendingCompleted = request
                return []
            }
            didEmitCompleted = true
            pendingCompleted = nil
            return [request]
        }
    }

    mutating func requestsToCaptureAfterWorkspaceScanSuccess() -> [SidecarRequestEmit] {
        didScanSucceed = true
        return flushCompletedIfReady()
    }

    mutating func requestsToCaptureAfterFirstRealInput() -> [SidecarRequestEmit] {
        didReceiveFirstRealInput = true
        return flushCompletedIfReady()
    }

    private mutating func flushCompletedIfReady() -> [SidecarRequestEmit] {
        guard !didEmitCompleted,
              didScanSucceed,
              didReceiveFirstRealInput,
              let request = pendingCompleted
        else { return [] }
        didEmitCompleted = true
        pendingCompleted = nil
        return [request]
    }
}

struct WeeklyRitualPrompt: Codable, Hashable {
    // R6 / CCG: surface payload for Day 7/14/21 ritual.
    let ritualKey: String
    let title: String
    let body: String
    let axes: [String]
}

struct BipMissionProgress: Hashable {
    let stage: String
    let detail: String?
    let provider: String?
    let sheetRowsRead: Int?
    let docCharsRead: Int?
    let elapsedMs: Int?

    func isActive(_ step: BipMissionProgressStep) -> Bool {
        currentStep == step
    }

    func isComplete(_ step: BipMissionProgressStep) -> Bool {
        switch step {
        case .readingSheet:
            return sheetRowsRead != nil || isAfter(step)
        case .readingDoc:
            return docCharsRead != nil || isAfter(step)
        case .generating:
            return isAfter(step)
        case .finalizing:
            return false
        }
    }

    private var currentStep: BipMissionProgressStep? {
        BipMissionProgressStep(stage: stage)
    }

    private func isAfter(_ step: BipMissionProgressStep) -> Bool {
        guard let currentStep else { return false }
        return currentStep.order > step.order
    }
}

extension SidecarEvent {
    var officeHoursLiveStatus: OfficeHoursLiveStatus? {
        guard type == "office_hours_status",
              let sessionId = sessionId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
              let stage = stage?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty else {
            return nil
        }
        return OfficeHoursLiveStatus(
            sessionId: sessionId,
            stage: stage,
            title: title?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            detail: detail?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            progressText: progressText?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            messageId: messageId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            requestId: requestId?.trimmingCharacters(in: .whitespacesAndNewlines).nonEmpty,
            elapsedMs: elapsedMs,
            contextMetrics: contextMetrics,
            questionIndex: questionIndex,
            answeredQuestionCount: answeredQuestionCount,
            expectedQuestionCount: expectedQuestionCount,
            questionElapsedMs: questionElapsedMs,
            requestReadyLatencyMs: requestReadyLatencyMs,
            updatedAt: .now
        )
    }

    var fallbackToolSummary: String {
        if type == "agent_event" {
            return summary ?? ""
        }
        guard type == "tool_event" else { return "" }
        let name = toolName?.trimmingCharacters(in: .whitespacesAndNewlines)
        let resolvedName = name?.isEmpty == false ? name! : "tool"
        switch phase?.trimmingCharacters(in: .whitespacesAndNewlines) {
        case "use":
            return "using \(resolvedName)"
        case "result":
            return "\(resolvedName) finished"
        case "error":
            return "\(resolvedName) error"
        case "thinking":
            return "thinking"
        default:
            return name ?? ""
        }
    }
}

enum BipMissionProgressStep: String, CaseIterable {
    case readingSheet = "reading_sheet"
    case readingDoc = "reading_doc"
    case generating
    case finalizing

    init?(stage: String) {
        self.init(rawValue: stage)
    }

    var order: Int {
        switch self {
        case .readingSheet:
            return 0
        case .readingDoc:
            return 1
        case .generating:
            return 2
        case .finalizing:
            return 3
        }
    }
}

extension SidecarEvent {
    private enum CodingKeys: String, CodingKey {
        case type
        case title
        case message
        case sessionId
        case requestId
        case messageId
        case state
        case delta
        case content
        case workspaceRoot
        case session
        case sessions
        case environment
        case diagnostics
        case bipCoach
        case bipSetupReady
        case iddSetupComplete
        case iddSetupStatus
        case iddCurrentDocType
        case iddAmbiguityScore
        case iddUnresolvedAssumptions
        case iddDocOrder
        case iddDocPreviews
        case iddProviderRecovery
        case iddSetupError
        case day
        case firstPrompt
        case missingLocalDocs
        case missingExternalRequirements
        case nextIddDocumentType
        case nextIddDocumentTitle
        case bipSetupGateMessage
        case scanRoot
        case icp
        case spec
        case values
        case designSystem
        case adr
        case goal
        case docs
        case sheet
        case onboardingHypothesis
        case day1AlignmentPlan
        case day1IcpPlan
        case day1SituationSummary
        case day1GoalSelection
        case day1SurfaceReview
        case agentic30Gitignore
        case abortCause
        case retryAttempt
        case dayProgress
        case dayReviews
        case officeHoursMemory
        case officeHoursHistory
        case evidenceOS
        case controlState
        case controlStateSnake = "control_state"
        case readiness
        case frame
        case mediaAsset
        case mediaAssetSnake = "media_asset"
        case deletion
        case deletionRange
        case deletionRangeSnake = "deletion_range"
        case frames
        case recorderRawApi
        case recorderRawApiSnake = "recorder_raw_api"
        case recorderRawApiToken = "token"
        case recorderAuditSource
        case recorderAuditSourceSnake = "recorder_audit_source"
        case recorderMcpGrants = "grants"
        case recorderMcpGrant = "grant"
        case pipes
        case runs
        case pipeRun
        case pipeRunSnake = "pipe_run"
        case scheduler
        case enqueueResult
        case enqueueResultSnake = "enqueue_result"
        case drainResult
        case drainResultSnake = "drain_result"
        case dayLoop
        case dayLoopSnake = "day_loop"
        case recorderEvidenceCandidateId = "candidateId"
        case recorderEvidenceCandidateIdSnake = "candidate_id"
        case recorderEvidenceCandidate = "candidate"
        case recorderEvidenceCandidateSnake = "evidence_candidate"
        case proofLedgerEventId
        case proofLedgerEventIdSnake = "proof_ledger_event_id"
        case proofAcceptedByReview
        case proofAcceptedByReviewSnake = "proof_accepted_by_review"
        case proofAcceptedByEvidenceCandidate
        case proofAcceptedByEvidenceCandidateSnake = "proof_accepted_by_evidence_candidate"
        case proofLedgerWriteAllowed
        case proofLedgerWriteAllowedSnake = "proof_ledger_write_allowed"
        case dayClosePolicy
        case programNotificationSchedule
        case needsCommitment
        case gatedStep
        case gateBlocked
        case missionCard
        case intervention
        case error
        case errorKind
        case docType
        case docPath
        case progressText
        case notionConnected
        case success
        case disconnected
        case authUrl
        case rowId
        case status
        case detail
        case path
        case entry
        case log
        case readinessError
        case bipTokenExpiredMessage
        case resourceName
        case resourceUrl
        case stage
        case provider
        case model
        case reason
        case nextProvider
        case availableProviders
        case providerReadiness
        case sheetRowsRead
        case docCharsRead
        case elapsedMs
        case contextMetrics
        case questionIndex
        case answeredQuestionCount
        case expectedQuestionCount
        case questionElapsedMs
        case requestReadyLatencyMs
        case stepIndex
        case totalSteps
        case etaSeconds
        case foundCount
        case phase
        case toolName
        case summary
        // R6 weekly ritual broadcast
        case weeklyRitualPrompt = "prompt"
        case questionId
        case questionID = "question_id"
        case activeQuestionId
        case activeQuestionID = "active_question_id"
        case currentQuestionId
        case currentQuestionID = "current_question_id"
        case originalQuestion
        case originalQuestionID = "original_question"
        case reframedQuestion
        case reframedQuestionID = "reframed_question"
        case reframedVariant
        case reframedVariantID = "reframed_variant"
        case newsMarketRadar
        case strategyReport
        case bipResearch
        case workHistory
        case officeHoursSourceGate
        case officeHoursDailyDigest
        case morningBriefing
        case morningBriefingPrevious
        case morningBriefingProgress
        case candidates
        case integrationStatus
        case exaMcpConnect
        case mcpOauthConnect
    }

    init(from decoder: Decoder) throws {
        let container = try decoder.container(keyedBy: CodingKeys.self)

        type = try container.decode(String.self, forKey: .type)
        title = Self.decodeIfPresent(String.self, from: container, forKey: .title)
        message = Self.decodeIfPresent(String.self, from: container, forKey: .message)
        sessionId = Self.decodeIfPresent(String.self, from: container, forKey: .sessionId)
        requestId = Self.decodeIfPresent(String.self, from: container, forKey: .requestId)
        messageId = Self.decodeIfPresent(String.self, from: container, forKey: .messageId)
        state = Self.decodeIfPresent(MessageState.self, from: container, forKey: .state)
        delta = Self.decodeIfPresent(String.self, from: container, forKey: .delta)
        content = Self.decodeIfPresent(String.self, from: container, forKey: .content)
        workspaceRoot = Self.decodeIfPresent(String.self, from: container, forKey: .workspaceRoot)
        session = Self.decodeIfPresent(ChatSession.self, from: container, forKey: .session)
        sessions = Self.decodeIfPresent([ChatSession].self, from: container, forKey: .sessions)
        environment = Self.decodeIfPresent(SidecarEnvironment.self, from: container, forKey: .environment)
        diagnostics = Self.decodeIfPresent(SidecarDiagnostics.self, from: container, forKey: .diagnostics)
        bipCoach = Self.decodeIfPresent(BipCoachState.self, from: container, forKey: .bipCoach)
        bipSetupReady = Self.decodeIfPresent(Bool.self, from: container, forKey: .bipSetupReady)
        iddSetupComplete = Self.decodeIfPresent(Bool.self, from: container, forKey: .iddSetupComplete)
        iddSetupStatus = Self.decodeIfPresent(String.self, from: container, forKey: .iddSetupStatus)
        iddCurrentDocType = Self.decodeIfPresent(String.self, from: container, forKey: .iddCurrentDocType)
        iddAmbiguityScore = Self.decodeIfPresent(Int.self, from: container, forKey: .iddAmbiguityScore)
        iddUnresolvedAssumptions = Self.decodeIfPresent([String].self, from: container, forKey: .iddUnresolvedAssumptions)
        iddDocOrder = Self.decodeIfPresent([String].self, from: container, forKey: .iddDocOrder)
        iddDocPreviews = Self.decodeIfPresent([IddDocPreview].self, from: container, forKey: .iddDocPreviews)
        iddProviderRecovery = Self.decodeIfPresent(IddProviderRecovery.self, from: container, forKey: .iddProviderRecovery)
        iddSetupError = Self.decodeIfPresent(IddSetupError.self, from: container, forKey: .iddSetupError)
        day = Self.decodeIfPresent(Int.self, from: container, forKey: .day)
        firstPrompt = Self.decodeIfPresent(FoundationFirstPrompt.self, from: container, forKey: .firstPrompt)
        missingLocalDocs = Self.decodeIfPresent([String].self, from: container, forKey: .missingLocalDocs)
        missingExternalRequirements = Self.decodeIfPresent([String].self, from: container, forKey: .missingExternalRequirements)
        nextIddDocumentType = Self.decodeIfPresent(String.self, from: container, forKey: .nextIddDocumentType)
        nextIddDocumentTitle = Self.decodeIfPresent(String.self, from: container, forKey: .nextIddDocumentTitle)
        bipSetupGateMessage = Self.decodeIfPresent(String.self, from: container, forKey: .bipSetupGateMessage)
        scanRoot = Self.decodeIfPresent(String.self, from: container, forKey: .scanRoot)
        icp = Self.decodeIfPresent(String.self, from: container, forKey: .icp)
        spec = Self.decodeIfPresent(String.self, from: container, forKey: .spec)
        values = Self.decodeIfPresent(String.self, from: container, forKey: .values)
        designSystem = Self.decodeIfPresent(String.self, from: container, forKey: .designSystem)
        adr = Self.decodeIfPresent(String.self, from: container, forKey: .adr)
        goal = Self.decodeIfPresent(String.self, from: container, forKey: .goal)
        docs = Self.decodeIfPresent(String.self, from: container, forKey: .docs)
        sheet = Self.decodeIfPresent(String.self, from: container, forKey: .sheet)
        onboardingHypothesis = Self.decodeIfPresent(WorkspaceOnboardingHypothesis.self, from: container, forKey: .onboardingHypothesis)
        day1AlignmentPlan = Self.decodeIfPresent(Day1AlignmentPlan.self, from: container, forKey: .day1AlignmentPlan)
        day1IcpPlan = Self.decodeIfPresent(Day1IcpPlan.self, from: container, forKey: .day1IcpPlan)
        day1SituationSummary = Self.decodeIfPresent(Day1SituationSummary.self, from: container, forKey: .day1SituationSummary)
        day1GoalSelection = Self.decodeIfPresent(Day1GoalSelection.self, from: container, forKey: .day1GoalSelection)
        day1SurfaceReview = Self.decodeIfPresent(Day1SurfaceReview.self, from: container, forKey: .day1SurfaceReview)
        abortCause = Self.decodeIfPresent(String.self, from: container, forKey: .abortCause)
        retryAttempt = Self.decodeIfPresent(Int.self, from: container, forKey: .retryAttempt)
        let decodedAgentic30Gitignore = Self.decodeIfPresent(
            Agentic30GitignoreState.self,
            from: container,
            forKey: .agentic30Gitignore
        )
        dayProgress = Self.decodeIfPresent(DayProgress.self, from: container, forKey: .dayProgress)
        dayReviews = Self.decodeIfPresent([String: DayReview].self, from: container, forKey: .dayReviews)
        officeHoursMemory = Self.decodeIfPresent(OfficeHoursMemorySummary.self, from: container, forKey: .officeHoursMemory)
        officeHoursHistory = Self.decodeIfPresent(OfficeHoursHistorySummary.self, from: container, forKey: .officeHoursHistory)
        evidenceOS = Self.decodeIfPresent(EvidenceOSSummary.self, from: container, forKey: .evidenceOS)
        controlState = Self.decodeIfPresent(RecorderControlState.self, from: container, forKey: .controlState)
            ?? Self.decodeIfPresent(RecorderControlState.self, from: container, forKey: .controlStateSnake)
        readiness = Self.decodeIfPresent(RecorderCaptureReadiness.self, from: container, forKey: .readiness)
        frame = Self.decodeIfPresent(RecorderFrameCaptureReceipt.self, from: container, forKey: .frame)
        mediaAsset = Self.decodeIfPresent(RecorderMediaAssetReceipt.self, from: container, forKey: .mediaAsset)
            ?? Self.decodeIfPresent(RecorderMediaAssetReceipt.self, from: container, forKey: .mediaAssetSnake)
        deletion = Self.decodeIfPresent(RecorderFrameDeleteReceipt.self, from: container, forKey: .deletion)
        deletionRange = Self.decodeIfPresent(RecorderFrameRangeDeleteReceipt.self, from: container, forKey: .deletionRange)
            ?? Self.decodeIfPresent(RecorderFrameRangeDeleteReceipt.self, from: container, forKey: .deletionRangeSnake)
        frames = Self.decodeIfPresent([RecorderFrameCaptureReceipt].self, from: container, forKey: .frames)
        recorderRawApi = Self.decodeIfPresent(RecorderRawApiStatus.self, from: container, forKey: .recorderRawApi)
            ?? Self.decodeIfPresent(RecorderRawApiStatus.self, from: container, forKey: .recorderRawApiSnake)
        recorderRawApiToken = Self.decodeIfPresent(RecorderRawApiToken.self, from: container, forKey: .recorderRawApiToken)
        recorderAuditSource = Self.decodeIfPresent(RecorderAuditSource.self, from: container, forKey: .recorderAuditSource)
            ?? Self.decodeIfPresent(RecorderAuditSource.self, from: container, forKey: .recorderAuditSourceSnake)
        recorderMcpGrants = Self.decodeIfPresent([RecorderMcpGrant].self, from: container, forKey: .recorderMcpGrants)
        recorderMcpGrant = Self.decodeIfPresent(RecorderMcpGrant.self, from: container, forKey: .recorderMcpGrant)
        pipes = Self.decodeIfPresent([RecorderPipeDefinition].self, from: container, forKey: .pipes)
        runs = Self.decodeIfPresent([RecorderPipeRun].self, from: container, forKey: .runs)
        pipeRun = Self.decodeIfPresent(RecorderPipeRun.self, from: container, forKey: .pipeRun)
            ?? Self.decodeIfPresent(RecorderPipeRun.self, from: container, forKey: .pipeRunSnake)
        scheduler = Self.decodeIfPresent(RecorderPipeSchedulerResult.self, from: container, forKey: .scheduler)
        enqueueResult = Self.decodeIfPresent(RecorderPipeSchedulerResult.self, from: container, forKey: .enqueueResult)
            ?? Self.decodeIfPresent(RecorderPipeSchedulerResult.self, from: container, forKey: .enqueueResultSnake)
        drainResult = Self.decodeIfPresent(RecorderPipeSchedulerResult.self, from: container, forKey: .drainResult)
            ?? Self.decodeIfPresent(RecorderPipeSchedulerResult.self, from: container, forKey: .drainResultSnake)
        recorderDayLoop = Self.decodeIfPresent(RecorderDayMemoryLoopResult.self, from: container, forKey: .dayLoop)
            ?? Self.decodeIfPresent(RecorderDayMemoryLoopResult.self, from: container, forKey: .dayLoopSnake)
        recorderEvidenceCandidateId = Self.decodeIfPresent(String.self, from: container, forKey: .recorderEvidenceCandidateId)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .recorderEvidenceCandidateIdSnake)
        recorderEvidenceCandidate = Self.decodeIfPresent(RecorderEvidenceCandidateSummary.self, from: container, forKey: .recorderEvidenceCandidate)
            ?? Self.decodeIfPresent(RecorderEvidenceCandidateSummary.self, from: container, forKey: .recorderEvidenceCandidateSnake)
        proofLedgerEventId = Self.decodeIfPresent(String.self, from: container, forKey: .proofLedgerEventId)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .proofLedgerEventIdSnake)
        proofAcceptedByReview = Self.decodeIfPresent(Bool.self, from: container, forKey: .proofAcceptedByReview)
            ?? Self.decodeIfPresent(Bool.self, from: container, forKey: .proofAcceptedByReviewSnake)
        proofAcceptedByEvidenceCandidate = Self.decodeIfPresent(Bool.self, from: container, forKey: .proofAcceptedByEvidenceCandidate)
            ?? Self.decodeIfPresent(Bool.self, from: container, forKey: .proofAcceptedByEvidenceCandidateSnake)
        proofLedgerWriteAllowed = Self.decodeIfPresent(Bool.self, from: container, forKey: .proofLedgerWriteAllowed)
            ?? Self.decodeIfPresent(Bool.self, from: container, forKey: .proofLedgerWriteAllowedSnake)
        recorderRetentionResult = type == "recorder_retention_result"
            ? try? RecorderRetentionApplyResult(from: decoder)
            : nil
        dayClosePolicy = Self.decodeIfPresent(OfficeHoursDayClosePolicy.self, from: container, forKey: .dayClosePolicy)
        programNotificationSchedule = Self.decodeIfPresent(ProgramNotificationSchedule.self, from: container, forKey: .programNotificationSchedule)
        needsCommitment = Self.decodeIfPresent(Bool.self, from: container, forKey: .needsCommitment)
        gatedStep = Self.decodeIfPresent(String.self, from: container, forKey: .gatedStep)
        gateBlocked = Self.decodeIfPresent(DayGateBlocked.self, from: container, forKey: .gateBlocked)
        missionCard = try container.decodeIfPresent(MissionCard.self, forKey: .missionCard)
        intervention = Self.decodeIfPresent(OhInterventionRequired.self, from: container, forKey: .intervention)

        let stringError = Self.decodeIfPresent(String.self, from: container, forKey: .error)
        let structuredError = Self.decodeIfPresent(BipReadinessError.self, from: container, forKey: .error)
        error = stringError ?? structuredError?.userMessage
        errorKind = Self.decodeIfPresent(String.self, from: container, forKey: .errorKind)

        docType = Self.decodeIfPresent(String.self, from: container, forKey: .docType)
        docPath = Self.decodeIfPresent(String.self, from: container, forKey: .docPath)
        progressText = Self.decodeIfPresent(String.self, from: container, forKey: .progressText)
        notionConnected = Self.decodeIfPresent(Bool.self, from: container, forKey: .notionConnected)
        success = Self.decodeIfPresent(Bool.self, from: container, forKey: .success)
        disconnected = Self.decodeIfPresent(Bool.self, from: container, forKey: .disconnected)
        authUrl = Self.decodeIfPresent(String.self, from: container, forKey: .authUrl)
        rowId = Self.decodeIfPresent(String.self, from: container, forKey: .rowId)
        status = Self.decodeIfPresent(String.self, from: container, forKey: .status)
        detail = Self.decodeIfPresent(String.self, from: container, forKey: .detail)
        log = Self.decodeIfPresent(String.self, from: container, forKey: .log)
        readinessError = Self.decodeIfPresent(BipReadinessError.self, from: container, forKey: .readinessError) ?? structuredError
        bipTokenExpiredMessage = Self.decodeIfPresent(String.self, from: container, forKey: .bipTokenExpiredMessage)
        resourceName = Self.decodeIfPresent(String.self, from: container, forKey: .resourceName)
        resourceUrl = Self.decodeIfPresent(String.self, from: container, forKey: .resourceUrl)
        stage = Self.decodeIfPresent(String.self, from: container, forKey: .stage)
        provider = Self.decodeIfPresent(String.self, from: container, forKey: .provider)
        model = Self.decodeIfPresent(String.self, from: container, forKey: .model)
        reason = Self.decodeIfPresent(String.self, from: container, forKey: .reason)
        nextProvider = Self.decodeIfPresent(String.self, from: container, forKey: .nextProvider)
        availableProviders = Self.decodeIfPresent([String].self, from: container, forKey: .availableProviders)
        providerReadiness = Self.decodeIfPresent([WorkspaceScanProviderReadiness].self, from: container, forKey: .providerReadiness)
        sheetRowsRead = Self.decodeIfPresent(Int.self, from: container, forKey: .sheetRowsRead)
        docCharsRead = Self.decodeIfPresent(Int.self, from: container, forKey: .docCharsRead)
        elapsedMs = Self.decodeIfPresent(Int.self, from: container, forKey: .elapsedMs)
        contextMetrics = Self.decodeIfPresent(OfficeHoursContextMetrics.self, from: container, forKey: .contextMetrics)
        questionIndex = Self.decodeIfPresent(Int.self, from: container, forKey: .questionIndex)
        answeredQuestionCount = Self.decodeIfPresent(Int.self, from: container, forKey: .answeredQuestionCount)
        expectedQuestionCount = Self.decodeIfPresent(Int.self, from: container, forKey: .expectedQuestionCount)
        questionElapsedMs = Self.decodeIfPresent(Int.self, from: container, forKey: .questionElapsedMs)
        requestReadyLatencyMs = Self.decodeIfPresent(Int.self, from: container, forKey: .requestReadyLatencyMs)
        stepIndex = Self.decodeIfPresent(Int.self, from: container, forKey: .stepIndex)
        totalSteps = Self.decodeIfPresent(Int.self, from: container, forKey: .totalSteps)
        etaSeconds = Self.decodeIfPresent(Int.self, from: container, forKey: .etaSeconds)
        foundCount = Self.decodeIfPresent(Int.self, from: container, forKey: .foundCount)
        phase = Self.decodeIfPresent(String.self, from: container, forKey: .phase)
        toolName = Self.decodeIfPresent(String.self, from: container, forKey: .toolName)
        summary = Self.decodeIfPresent(String.self, from: container, forKey: .summary)
        weeklyRitualPrompt = Self.decodeIfPresent(WeeklyRitualPrompt.self, from: container, forKey: .weeklyRitualPrompt)
        requestEmit = type == "request_emit" ? try SidecarRequestEmit(from: decoder) : nil
        questionId = Self.decodeIfPresent(String.self, from: container, forKey: .questionId)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .questionID)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .activeQuestionId)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .activeQuestionID)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .currentQuestionId)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .currentQuestionID)
        originalQuestion = Self.decodeIfPresent(String.self, from: container, forKey: .originalQuestion)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .originalQuestionID)
        reframedQuestion = Self.decodeIfPresent(String.self, from: container, forKey: .reframedQuestion)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .reframedQuestionID)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .reframedVariant)
            ?? Self.decodeIfPresent(String.self, from: container, forKey: .reframedVariantID)
        newsMarketRadar = Self.decodeIfPresent(NewsMarketRadarSnapshot.self, from: container, forKey: .newsMarketRadar)
        newsMarketRadarStatus = Self.decodeIfPresent(NewsMarketRadarStatus.self, from: container, forKey: .status)
        strategyReport = Self.decodeIfPresent(StrategyReportSnapshot.self, from: container, forKey: .strategyReport)
        strategyReportStatus = Self.decodeIfPresent(StrategyReportStatus.self, from: container, forKey: .status)
        bipResearch = Self.decodeIfPresent(BipResearchSnapshot.self, from: container, forKey: .bipResearch)
        bipResearchStatus = Self.decodeIfPresent(BipResearchStatus.self, from: container, forKey: .status)
        workHistory = Self.decodeIfPresent(WorkHistorySnapshot.self, from: container, forKey: .workHistory)
        workHistoryStatus = Self.decodeIfPresent(WorkHistoryStatus.self, from: container, forKey: .status)
        officeHoursSourceGate = Self.decodeIfPresent(OfficeHoursSourceGate.self, from: container, forKey: .officeHoursSourceGate)
        officeHoursDailyDigest = Self.decodeIfPresent(OfficeHoursDailyDigest.self, from: container, forKey: .officeHoursDailyDigest)
        morningBriefing = Self.decodeIfPresent(MorningBriefing.self, from: container, forKey: .morningBriefing)
        morningBriefingPrevious = Self.decodeIfPresent(MorningBriefing.self, from: container, forKey: .morningBriefingPrevious)
        morningBriefingStatus = Self.decodeIfPresent(MorningBriefingStatus.self, from: container, forKey: .status)
        morningBriefingProgress = Self.decodeIfPresent(MorningBriefingProgress.self, from: container, forKey: .morningBriefingProgress)
        commitmentCandidates = Self.decodeIfPresent([String].self, from: container, forKey: .candidates)
        integrationStatus = Self.decodeIfPresent(IntegrationStatusSnapshot.self, from: container, forKey: .integrationStatus)
        exaMcpConnect = Self.decodeIfPresent(ExaMcpConnectResult.self, from: container, forKey: .exaMcpConnect)
        mcpOauthConnect = Self.decodeIfPresent(McpOauthConnectResult.self, from: container, forKey: .mcpOauthConnect)
        if type == "workspace_gitignore_result" {
            agentic30Gitignore = Agentic30GitignoreState(
                status: status ?? "error",
                scanRoot: scanRoot,
                path: Self.decodeIfPresent(String.self, from: container, forKey: .path),
                entry: Self.decodeIfPresent(String.self, from: container, forKey: .entry),
                error: error
            )
        } else {
            agentic30Gitignore = decodedAgentic30Gitignore?.withScanRoot(scanRoot)
        }
    }

    private static func decodeIfPresent<T: Decodable>(
        _ type: T.Type,
        from container: KeyedDecodingContainer<CodingKeys>,
        forKey key: CodingKeys
    ) -> T? {
        try? container.decodeIfPresent(type, forKey: key)
    }
}

private extension AgenticViewModel {
    func retryPendingBipActionAfterAuth() {
        guard let action = pendingBipAuthRetry else { return }
        pendingBipAuthRetry = nil
        bipTokenExpired = nil
        switch action {
        case .refreshEvidence:
            refreshBipCoachEvidence()
        case .generateMission(let compact):
            generateBipMission(compact: compact)
        }
    }
}

private extension String {
    var nonEmpty: String? {
        trimmingCharacters(in: .whitespacesAndNewlines).isEmpty ? nil : self
    }
}

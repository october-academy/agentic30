import AuthenticationServices
import Foundation
import Testing
@testable import agentic30

private final class FakeWebAuthenticationSessionHandle: WebAuthenticationSessionHandle {
    private let startResult: Bool
    private(set) var startCallCount = 0

    init(startResult: Bool) {
        self.startResult = startResult
    }

    func start() -> Bool {
        startCallCount += 1
        return startResult
    }

    func cancel() {}
}

struct AgenticViewModelAuthTests {
    @Test @MainActor func missingGoogleAuthDoesNotBlockLocalWorkspaceSelection() {
        WorkspaceSettings.clear()
        defer { WorkspaceSettings.clear() }

        let viewModel = AgenticViewModel(activateAppForAuth: {})

        #expect(viewModel.macAuthSession == nil)
        #expect(viewModel.needsProjectWorkspace == true)

        viewModel.start()

        #expect(viewModel.connectionLabel == "Choose a project workspace")
        #expect(viewModel.isConnected == false)
    }

    @Test @MainActor func explicitWorkspaceAndLocalContextCanStartWithoutGoogleAuth() throws {
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-loginless-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        WorkspaceSettings.store(workspaceURL)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext.make(
                role: .developer,
                projectStage: .building,
                isolationLevel: .soloAll
            ),
            activateAppForAuth: {}
        )

        #expect(viewModel.macAuthSession == nil)
        #expect(viewModel.requiresMacOnboarding == false)
        #expect(viewModel.needsProjectWorkspace == false)
        #expect(viewModel.needsOnboardingContext == false)
    }

    @Test @MainActor func promptBeforeSessionQueuesStartupAction() throws {
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-startup-queue-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        WorkspaceSettings.store(workspaceURL)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext.make(
                role: .developer,
                projectStage: .building,
                isolationLevel: .soloAll
            ),
            activateAppForAuth: {}
        )
        viewModel.draft = "Day 1에서 먼저 볼 고객 증거를 정리해줘"

        viewModel.sendPrompt()

        #expect(viewModel.draft.isEmpty)
        #expect(viewModel.startupQueuedAction?.title == "첫 메시지 대기 중")
        #expect(viewModel.startupQueuedAction?.summary == "Day 1에서 먼저 볼 고객 증거를 정리해줘")
    }

    @Test @MainActor func missionBeforeSessionQueuesStartupAction() throws {
        let workspaceURL = FileManager.default.temporaryDirectory
            .appendingPathComponent("agentic30-startup-mission-\(UUID().uuidString)", isDirectory: true)
        try FileManager.default.createDirectory(at: workspaceURL, withIntermediateDirectories: true)
        WorkspaceSettings.store(workspaceURL)
        defer {
            WorkspaceSettings.clear()
            try? FileManager.default.removeItem(at: workspaceURL)
        }

        let viewModel = AgenticViewModel(
            onboardingContextOverride: OnboardingContext.make(
                role: .developer,
                projectStage: .building,
                isolationLevel: .soloAll
            ),
            activateAppForAuth: {}
        )

        viewModel.generateBipMission(compact: true, curriculumDay: ["day": 1])

        #expect(viewModel.startupQueuedAction?.title == "오늘 실행 생성 대기 중")
        #expect(viewModel.startupQueuedAction?.summary == "세션이 연결되면 Day 1 기준으로 오늘 실행 후보를 만듭니다.")
    }

    @Test @MainActor func missionFirstErrorCopyHidesRawNullDayFailures() {
        let rawMessage = "TypeError: Cannot read properties of null (reading 'day')"

        #expect(AgenticViewModel.isRawNullDayError(rawMessage))
        #expect(AgenticViewModel.userFacingMissionErrorMessage(rawMessage) == "다시 시도하면 미션 후보를 새로 만들게요.")
        #expect(!AgenticViewModel.userFacingMissionErrorMessage(rawMessage).contains("Cannot read properties"))
    }

    @Test @MainActor func googleSignInReportsFailureWhenSystemAuthSessionCannotStart() {
        let fakeSession = FakeWebAuthenticationSessionHandle(startResult: false)
        var activationCount = 0
        var requestedURL: URL?
        var requestedCallbackScheme: String?
        var requestedEphemeralPreference: Bool?

        let viewModel = AgenticViewModel(
            authSessionFactory: { url, callbackScheme, _, prefersEphemeral, _ in
                requestedURL = url
                requestedCallbackScheme = callbackScheme
                requestedEphemeralPreference = prefersEphemeral
                return fakeSession
            },
            activateAppForAuth: {
                activationCount += 1
            }
        )

        viewModel.startMacGoogleSignIn()

        #expect(fakeSession.startCallCount == 1)
        #expect(activationCount == 1)
        #expect(requestedURL?.path == "/auth/mac/start")
        #expect(requestedCallbackScheme == "agentic30")
        #expect(requestedEphemeralPreference == true)

        guard case .failed(let message) = viewModel.macOnboardingStatus else {
            Issue.record("Expected failed onboarding status, got \(viewModel.macOnboardingStatus)")
            return
        }
        #expect(message == "Could not open Google sign-in. Open the workspace window and try again.")
    }

    @Test @MainActor func googleSignInWaitsForCallbackWhenSystemAuthSessionStarts() {
        let fakeSession = FakeWebAuthenticationSessionHandle(startResult: true)

        let viewModel = AgenticViewModel(
            authSessionFactory: { _, _, _, _, _ in
                fakeSession
            },
            activateAppForAuth: {}
        )

        viewModel.startMacGoogleSignIn()

        #expect(fakeSession.startCallCount == 1)
        #expect(viewModel.macOnboardingStatus == .signingIn)
    }
}

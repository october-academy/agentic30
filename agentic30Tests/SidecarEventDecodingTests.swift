import Foundation
import Testing
@testable import agentic30

struct SidecarEventDecodingTests {
    private static func fixtureData(_ relativePath: String, filePath: String = #filePath) throws -> Data {
        let root = try repositoryRoot(filePath: filePath)
        return try Data(contentsOf: root.appendingPathComponent(relativePath))
    }

    private static func repositoryRoot(filePath: String) throws -> URL {
        var directory = URL(fileURLWithPath: filePath).deletingLastPathComponent()
        while directory.path != "/" {
            let package = directory.appendingPathComponent("package.json")
            let sidecarTests = directory.appendingPathComponent("sidecar-tests", isDirectory: true)
            if FileManager.default.fileExists(atPath: package.path)
                && FileManager.default.fileExists(atPath: sidecarTests.path) {
                return directory
            }
            directory.deleteLastPathComponent()
        }
        throw CocoaError(.fileNoSuchFile)
    }

    @MainActor @Test func decodesReadyPayloadFromSidecar() throws {
        let payload = """
        {
          "type": "ready",
          "sessions": [
            {
              "id": "session-1",
              "title": "Hello",
              "provider": "codex",
              "model": "",
              "status": "idle",
              "createdAt": "2026-04-08T16:01:06.277Z",
              "updatedAt": "2026-04-08T16:01:24.737Z",
              "error": null,
              "pendingUserInput": {
                "requestId": "request-1",
                "sessionId": "session-1",
                "toolName": "request_user_input",
                "title": "assistant needs input",
                "createdAt": "2026-04-08T16:01:12.000Z",
                "questions": [
                  {
                    "header": "Scope",
                    "question": "Which scope should we use?",
                    "options": [
                      {
                        "label": "Hero",
                        "description": "Work on hero only"
                      },
                      {
                        "label": "App",
                        "description": "Work on the full app"
                      }
                    ],
                    "multiSelect": false,
                    "allowFreeText": true,
                    "textMode": "short"
                  }
                ]
              },
              "messages": [
                {
                  "id": "message-1",
                  "role": "assistant",
                  "provider": "codex",
                  "content": "OK",
                  "state": "final",
                  "createdAt": "2026-04-08T16:01:24.737Z",
                  "error": null
                }
              ],
              "runtime": {
                "codexThreadId": "thread-1"
              }
            }
          ],
          "environment": {
            "claude": {
              "available": true,
              "source": "local-session",
              "message": "Local Claude login session",
              "sdk": {
                "available": true,
                "packageName": "@anthropic-ai/claude-agent-sdk",
                "version": "0.2.87",
                "packageRoot": "/repo/node_modules/@anthropic-ai/claude-agent-sdk",
                "entrypointPath": "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js",
                "message": "Claude Agent SDK CLI is installed"
              }
            },
            "codex": {
              "available": true,
              "source": "local-session",
              "message": "Local Codex login session",
              "sdk": {
                "available": true,
                "packageName": "@openai/codex-sdk",
                "version": "0.125.0",
                "packageRoot": "/repo/node_modules/@openai/codex-sdk",
                "entrypointPath": "/repo/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex",
                "cliSource": "bundled",
                "cliPath": "/repo/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex",
                "cliVersion": "0.125.0",
                "cliArch": "arm64",
                "minimumVersionSatisfied": true,
                "message": "Codex SDK and CLI binary are installed"
              }
            },
            "gemini": {
              "available": true,
              "source": "api-key",
              "message": "API key from GEMINI_API_KEY / GOOGLE_API_KEY",
              "sdk": {
                "available": true,
                "packageName": "@google/genai",
                "version": "2.3.0",
                "packageRoot": "/repo/node_modules/@google/genai",
                "entrypointPath": "/repo/node_modules/@google/genai/package.json",
                "message": "Google Gen AI SDK is installed"
              }
            },
            "acp": {
              "available": true,
              "message": "ACP adapter ready for Zed registration",
              "adapterPath": "/Users/october/prj/mac/agentic30/sidecar/acp-adapter.mjs",
              "command": "node acp-adapter.mjs --workspace /Users/october/prj/mac/agentic30"
            }
          },
          "workspaceRoot": "/Users/october/prj/mac/agentic30"
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "ready")
        #expect(event.workspaceRoot == "/Users/october/prj/mac/agentic30")
        #expect(event.environment?.claude.available == true)
        #expect(event.environment?.claude.sdk?.packageName == "@anthropic-ai/claude-agent-sdk")
        #expect(event.environment?.codex.source == "local-session")
        #expect(event.environment?.codex.sdk?.available == true)
        #expect(event.environment?.codex.sdk?.cliSource == "bundled")
        #expect(event.environment?.codex.sdk?.minimumVersionSatisfied == true)
        #expect(event.environment?.gemini?.source == "api-key")
        #expect(event.environment?.gemini?.sdk?.packageName == "@google/genai")
        #expect(event.environment?.acp?.available == true)
        #expect(event.sessions?.count == 1)
        #expect(event.sessions?.first?.messages.first?.content == "OK")
        #expect(event.sessions?.first?.pendingUserInput?.requestId == "request-1")
        #expect(event.sessions?.first?.pendingUserInput?.questions.first?.allowFreeText == true)
    }

    @MainActor @Test func decodesStreamingStateOnMessageReplacedEvent() throws {
        let payload = """
        {
          "type": "message_replaced",
          "sessionId": "session-1",
          "messageId": "message-1",
          "content": "partial snapshot",
          "state": "streaming"
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "message_replaced")
        #expect(event.sessionId == "session-1")
        #expect(event.messageId == "message-1")
        #expect(event.content == "partial snapshot")
        #expect(event.state == .streaming)
    }

    @MainActor @Test func decodesConnectionErrorPayload() throws {
        let payload = """
        {
          "type": "error",
          "message": "Sidecar is not connected."
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "error")
        #expect(event.message == "Sidecar is not connected.")
        #expect(event.sessions == nil)
    }

    @MainActor @Test func decodesWorkspaceScanProgressStructuredFields() throws {
        let payload = """
        {
          "type": "workspace_scan_progress",
          "scanRoot": "/tmp/workspace",
          "progressText": "scan.compose · Day 1 질문 세트를 구성 중",
          "stage": "composing",
          "stepIndex": 3,
          "totalSteps": 3,
          "etaSeconds": 10,
          "foundCount": 4
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_scan_progress")
        #expect(event.scanRoot == "/tmp/workspace")
        #expect(event.progressText == "scan.compose · Day 1 질문 세트를 구성 중")
        #expect(event.stage == "composing")
        #expect(event.stepIndex == 3)
        #expect(event.totalSteps == 3)
        #expect(event.etaSeconds == 10)
        #expect(event.foundCount == 4)
    }

    @MainActor @Test func decodesOfficeHoursStatusPayload() throws {
        let payload = """
        {
          "type": "office_hours_status",
          "sessionId": "session-1",
          "messageId": "message-1",
          "requestId": "request-1",
          "stage": "provider_starting",
          "title": "다음 질문 준비 중",
          "detail": "프로젝트 맥락에 맞는 질문을 준비하고 있습니다.",
          "progressText": "프로젝트 맥락에 맞는 질문 준비 중",
          "elapsedMs": 42
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        let status = try #require(event.officeHoursLiveStatus)

        #expect(event.type == "office_hours_status")
        #expect(status.sessionId == "session-1")
        #expect(status.stage == "provider_starting")
        #expect(status.title == "다음 질문 준비 중")
        #expect(status.detail == "프로젝트 맥락에 맞는 질문을 준비하고 있습니다.")
        #expect(status.progressText == "프로젝트 맥락에 맞는 질문 준비 중")
        #expect(status.messageId == "message-1")
        #expect(status.requestId == "request-1")
        #expect(status.elapsedMs == 42)
    }

    @MainActor @Test func decodesWeeklyRitualPromptPayload() throws {
        // R6: weekly ritual broadcast surface. Verifies the Mac decoder picks
        // up `prompt` (mapped via CodingKey to weeklyRitualPrompt).
        let payload = """
        {
          "type": "weekly_ritual_prompt",
          "day": 7,
          "prompt": {
            "ritualKey": "weekly_ritual_day_7",
            "title": "Day 7 — 한 줄 점검",
            "body": "지난 7일 동안 잠재 고객 1명에게라도 한 가지 고통을 제대로 들었는가?",
            "axes": ["definition", "command"]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "weekly_ritual_prompt")
        #expect(event.day == 7)
        #expect(event.weeklyRitualPrompt?.ritualKey == "weekly_ritual_day_7")
        #expect(event.weeklyRitualPrompt?.title.contains("Day 7") == true)
        #expect(event.weeklyRitualPrompt?.axes.contains("definition") == true)
    }

    @MainActor @Test func decodesValidRequestEmitPayload() throws {
        let payload = """
        {
          "type": "request_emit",
          "event": "workspace_setup_started",
          "event_schema_version": 1,
          "properties": {
            "workspace_basename": "agentic30-public",
            "has_explicit_workspace": true,
            "found_count": 3
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "request_emit")
        #expect(event.requestEmit?.event == .workspaceSetupStarted)
        #expect(event.requestEmit?.eventSchemaVersion == 1)
        #expect(event.requestEmit?.telemetryProperties["workspace_basename"] as? String == "agentic30-public")
        #expect(event.requestEmit?.telemetryProperties["has_explicit_workspace"] as? Bool == true)
        #expect(event.requestEmit?.telemetryProperties["found_count"] as? Int == 3)
        #expect(event.requestEmit?.telemetryProperties["event_schema_version"] as? Int == 1)
    }

    @MainActor @Test func rejectsUnsupportedRequestEmitEvent() {
        let payload = """
        {
          "type": "request_emit",
          "event": "mac_sidecar_booted",
          "event_schema_version": 1,
          "properties": {}
        }
        """

        #expect(throws: Error.self) {
            try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        }
    }

    @MainActor @Test func rejectsUnsupportedRequestEmitSchemaVersion() {
        let payload = """
        {
          "type": "request_emit",
          "event": "workspace_setup_completed",
          "event_schema_version": 2,
          "properties": {}
        }
        """

        #expect(throws: Error.self) {
            try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        }
    }

    @MainActor @Test func decodesIcpIddStructuredPromptPayload() throws {
        let fixtureData = try Self.fixtureData("sidecar-tests/fixtures/sidecar-events/idd-setup-autostart.json")
        let fixtureObject = try #require(JSONSerialization.jsonObject(with: fixtureData) as? [String: Any])
        let events = try #require(fixtureObject["events"] as? [[String: Any]])
        let sessionUpdated = try #require(events.first { $0["type"] as? String == "session_updated" })
        let payload = try JSONSerialization.data(withJSONObject: sessionUpdated)

        let event = try decoder.decode(SidecarEvent.self, from: payload)

        #expect(event.type == "session_updated")
        #expect(event.session?.status == .awaitingInput)
        #expect(event.session?.pendingUserInput?.toolName == "agentic30_request_user_input")
        #expect(event.session?.pendingUserInput?.title == "ICP 1/4")
        #expect(event.session?.pendingUserInput?.intro?.title == "ICP (Ideal Customer Profile)")
        #expect(event.session?.pendingUserInput?.intro?.body?.contains("실제로 연락하고 인터뷰") == true)
        #expect(event.session?.pendingUserInput?.intro?.bullets?.contains("현재 대안: 지금 어떤 수작업이나 도구로 버티는지") == true)
        #expect(event.session?.pendingUserInput?.resources?.first?.source == "PostHog")
        #expect(event.session?.pendingUserInput?.resources?.first?.url == "https://posthog.com/founders/creating-ideal-customer-profile")
        #expect(event.session?.pendingUserInput?.generation?.mode == "host_structured")
        #expect(event.session?.pendingUserInput?.generation?.docType == "icp")
        #expect(event.session?.pendingUserInput?.isProviderAdaptiveIddQuestion == true)
        #expect(event.session?.pendingUserInput?.isLegacyStaticIddQuestion == false)
        #expect(event.session?.pendingUserInput?.questions.first?.helperText?.contains("팔릴 방향") == true)
        #expect(event.session?.pendingUserInput?.questions.first?.question.contains("1인 개발자 유형") == true)
        #expect(event.session?.pendingUserInput?.questions.first?.options?.map(\.label) == ["퇴사 후 첫 매출이 없는 개발자", "AI로 제품은 만들었지만 고객이 없는 개발자", "여러 번 출시했지만 반응이 약했던 개발자"])
        #expect(event.session?.pendingUserInput?.questions.first?.options?.last?.nextIntent == "repeat_launch_weak_signal")
        #expect(event.session?.pendingUserInput?.questions.first?.requiresFreeText == false)
        #expect(event.session?.pendingUserInput?.questions.first?.freeTextPlaceholder?.contains("유료 고객이 없는 개발자") == true)
    }

    @MainActor @Test func decodesBipCoachStateWithOwningSession() throws {
        let payload = """
        {
          "type": "bip_coach_state",
          "bipCoach": {
            "schemaVersion": 2,
            "updatedAt": "2026-04-24T06:00:00.000Z",
            "sessionId": "session-1",
            "config": {
              "provider": "codex",
              "threadsHandle": "october",
              "sheetId": "sheet-1",
              "docId": "doc-1"
            },
            "evidence": null,
            "currentMission": null,
            "streak": {
              "current": 2,
              "longest": 4,
              "lastCompletedDate": "2026-04-23"
            },
            "lastError": null
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "bip_coach_state")
        #expect(event.bipCoach?.sessionId == "session-1")
        #expect(event.bipCoach?.config.provider == .codex)
        #expect(event.bipCoach?.streak.current == 2)
    }

    @MainActor @Test func decodesWorkspaceScanResultWithGoal() throws {
        let payload = """
        {
          "type": "workspace_scan_result",
          "scanRoot": "/Users/october/prj/myapp",
          "icp": "docs/ICP.md",
          "spec": "docs/SPEC.md",
          "values": "docs/VALUES.md",
          "designSystem": null,
          "adr": "docs/adr",
          "goal": "docs/GOAL.md",
          "day1GoalSelection": {
            "schemaVersion": 1,
            "schema": "agentic30.day1_goal.v1",
            "goalType": "make_money",
            "goalText": "SupportLens가 유료 support lead 후보 1명을 검증한다",
            "customer": "B2B SaaS support lead",
            "problem": "Slack escalation을 놓침",
            "validationAction": "유료 파일럿 ask",
            "evidenceRefs": ["README.md", "docs/ICP.md"],
            "proofSink": "bip_optional",
            "sourcePlanFingerprint": "abc123",
            "selectedAt": "2026-06-06T00:00:00.000Z"
          },
          "onboardingHypothesis": {
            "productName": "Agentic30",
            "projectKind": "mac_app",
            "targetUser": "전업 1인 개발자, 수익 0원, macOS 사용자",
            "problem": "만들 줄은 있지만 무엇을 만들어야 팔리는지 모른다",
            "purpose": "30일 안에 PMF 검증 방향을 좁힌다",
            "likelyUsers": ["AI 코딩 도구를 쓰는 개발자"],
            "stage": "prototype",
            "evidence": ["README: Agentic30"],
            "confidence": "high",
            "suggestedFirstQuestion": "이번 주 바로 인터뷰할 첫 고객은 누구인가요?"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_scan_result")
        #expect(event.scanRoot == "/Users/october/prj/myapp")
        #expect(event.icp == "docs/ICP.md")
        #expect(event.spec == "docs/SPEC.md")
        #expect(event.values == "docs/VALUES.md")
        #expect(event.designSystem == nil)
        #expect(event.adr == "docs/adr")
        #expect(event.goal == "docs/GOAL.md")
        #expect(event.day1GoalSelection?.goalType == .makeMoney)
        #expect(event.day1GoalSelection?.proofSink == .bipOptional)
        #expect(event.day1GoalSelection?.customer == "B2B SaaS support lead")
        #expect(event.day1GoalSelection?.evidenceRefs == ["README.md", "docs/ICP.md"])
        #expect(event.onboardingHypothesis?.confidence == "high")
        #expect(event.onboardingHypothesis?.productName == "Agentic30")
        #expect(event.onboardingHypothesis?.targetUser?.contains("전업 1인 개발자") == true)
        #expect(event.onboardingHypothesis?.likelyUsers?.first == "AI 코딩 도구를 쓰는 개발자")
        #expect(event.error == nil)
    }

    @MainActor @Test func decodesWorkspaceScanResultWithDay1SituationSummary() throws {
        let payload = """
        {
          "type": "workspace_scan_result",
          "scanRoot": "/Users/october/prj/myapp",
          "day1SituationSummary": {
            "schemaVersion": 3,
            "source": "local_evidence",
            "generatedAt": "2026-05-29T10:00:00.000Z",
            "project": {
              "name": "mood.disk",
              "oneLine": "mood.disk: 출판 요청부터 결제까지 앱 안에서 처리하려는 기록/출판 앱",
              "customer": "출판을 원하는 기록 앱 사용자",
              "problem": "출판 요청과 결제를 앱 안에서 처리하고 싶다",
              "evidenceRefs": ["README.md (README)", "docs/ICP.md (ICP)"]
            },
            "diagnosis": {
              "stage": "초기 사용자 검증",
              "bottleneck": "확인할 행동 신호가 비어 있음",
              "whyNow": "고객과 문제 후보는 있지만 실제 행동으로 확인할 기준이 아직 약합니다.",
              "missingSignal": "확인할 행동",
              "confidence": 0.84,
              "evidenceRefs": ["interviews/mood.md", "marketing/plan.md"]
            },
            "realityGap": {
              "docClaim": "README는 기록 앱 중심입니다.",
              "observedReality": "IAP, PDF",
              "recommendation": "IAP, PDF 계획을 문서에 반영해야 다음 판단이 맞아집니다.",
              "evidenceRefs": ["README.md", "git/agent recent work"]
            },
            "baseline": {
              "target": "활성 100명 또는 첫 유료 출판 요청",
              "current": "초기 사용자 검증: 확인할 행동 신호가 비어 있음",
              "day30Question": "30일 뒤 활성 100명, 첫 유료 출판 요청 근거가 실제로 남았나요?",
              "metrics": ["활성 100명", "첫 유료 출판 요청"]
            },
            "path": [
              { "label": "IAP", "kind": "conversion", "status": "found", "why": "marketing/plan.md에 IAP 계획이 있습니다.", "evidenceRefs": ["marketing/plan.md"] },
              { "label": "PDF", "kind": "workflow", "status": "found", "why": "README.md에 PDF 출판 흐름이 있습니다.", "evidenceRefs": ["README.md"] }
            ],
            "actions": [
              { "id": "paid-publish", "label": "유료 출판 요청", "rationale": "첫 유료 출판 요청 근거를 오늘 확인합니다.", "kind": "conversion", "promptSeed": "첫 유료 출판 요청을 어떤 행동으로 확인할까요?", "evidenceRefs": ["marketing/plan.md"], "evidenceLimited": false },
              { "id": "pdf-flow", "label": "PDF 흐름", "rationale": "PDF 출판 흐름이 실제 요청으로 이어지는지 확인합니다.", "kind": "workflow", "promptSeed": "PDF 출판 흐름을 어떤 행동으로 검증할까요?", "evidenceRefs": ["README.md"], "evidenceLimited": false }
            ],
            "qualityGate": {
              "score": 8.4,
              "passed": true,
              "reasons": ["고객과 문제가 근거에서 확인됨", "목표/비교 기준 후보가 있음"]
            },
            "trust": {
              "readOnly": true,
              "secretsExcluded": true,
              "sourcesUsed": ["onboarding hypothesis", "customer evidence", "market/recent evidence"]
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        let summary = try #require(event.day1SituationSummary)

        #expect(summary.schemaVersion == 3)
        #expect(summary.project.name == "mood.disk")
        #expect(summary.diagnosis.stage == "초기 사용자 검증")
        #expect(summary.diagnosis.missingSignal == "확인할 행동")
        #expect(summary.realityGap?.recommendation.contains("IAP") == true)
        #expect(summary.baseline.day30Question.contains("활성 100명") == true)
        #expect(summary.path.map(\.label) == ["IAP", "PDF"])
        #expect(summary.actions.first?.label == "유료 출판 요청")
        #expect(summary.qualityGate.passed == true)
        #expect(summary.trust.readOnly == true)
        #expect(summary.trust.secretsExcluded == true)
    }

    @MainActor @Test func rejectsDay1SituationSummaryV2Payload() {
        let payload = """
        {
          "schemaVersion": 2,
          "source": "deterministic",
          "identity": {
            "productName": "mood.disk",
            "oneLine": "old shape",
            "customer": "old customer",
            "problem": "old problem"
          },
          "stage": { "label": "old", "reason": "old" },
          "currentBottleneck": { "label": "old", "whyNow": "old", "evidenceRefs": [] },
          "day1Baseline": { "goal30d": "old", "currentState": "old", "compareOnDay30": "old" },
          "gtmPath": [],
          "proofActions": [{ "label": "old", "rationale": "old" }],
          "trust": { "readOnly": true, "secretsExcluded": true, "sourcesUsed": [], "confidence": 0.1 }
        }
        """

        #expect(throws: Error.self) {
            try decoder.decode(Day1SituationSummary.self, from: Data(payload.utf8))
        }
    }

    @MainActor @Test func decodesWorkspaceScanResultWithDay1IcpPlan() throws {
        let payload = """
        {
          "type": "workspace_scan_result",
          "scanRoot": "/Users/october/prj/myapp",
          "day1IcpPlan": {
            "schemaVersion": 1,
            "source": "deterministic",
            "generatedAt": "2026-05-20T00:00:00.000Z",
            "confidence": 0.66,
            "fellBackToDeterministic": false,
            "mission": "MyApp의 ICP v0를 검증 가능하게 좁힙니다.",
            "signals": {
              "productName": "MyApp",
              "currentIcpGuess": "support lead",
              "likelyUsers": ["support lead"],
              "problem": "Slack escalation을 놓침",
              "currentAlternatives": ["Slack 수동 확인"],
              "evidenceRefs": [{ "path": "README.md", "reason": "README", "quote": "# MyApp" }],
              "missingAssumptions": ["reference_customer"],
              "confidence": "medium"
            },
            "questions": [
              {
                "id": "q1_must_have",
                "dimension": "must_have",
                "title": "질문 1",
                "prompt": "좋은 고객의 필수 조건은?",
                "helperText": "need/have 중심",
                "options": [
                  { "id": "o1", "label": "대안이 있음", "description": "이미 비용을 씀 · 근거: README.md", "preview": "Have", "antiSignal": false, "evidenceLabel": "근거: README.md", "evidenceLimited": false },
                  { "id": "o2", "label": "관심만 있음", "description": "근거 부족: 최근 사건 없음", "preview": "Weak", "antiSignal": true, "evidenceLabel": "근거 부족", "evidenceLimited": true }
                ],
                "allowFreeText": true,
                "freeTextPlaceholder": "직접 입력"
              },
              {
                "id": "q2_core_need",
                "dimension": "core_need",
                "title": "질문 2",
                "prompt": "핵심 need는?",
                "options": [
                  { "id": "o1", "label": "시간 절약", "description": "반복 업무" },
                  { "id": "o2", "label": "리스크 감소", "description": "누락 방지" }
                ]
              },
              {
                "id": "q3_reference_customer",
                "dimension": "reference_customer",
                "title": "질문 3",
                "prompt": "누구에게 검증?",
                "options": [
                  { "id": "o1", "label": "warm intro", "description": "이번 주 가능" },
                  { "id": "o2", "label": "cold outbound", "description": "공개 문제 언급" }
                ]
              }
            ],
            "icpDraft": {
              "description": "support lead 중 Slack escalation을 놓치는 팀",
              "criteria": ["현재 대안이 있다"],
              "whyTheyMatter": ["짧은 sales cycle"],
              "needs": ["누락 방지"],
              "haves": ["Slack"],
              "dontNeeds": ["관심만 있음"],
              "evidence": ["README.md: README"],
              "referenceCustomersToFind": ["support lead 1명"]
            },
            "antiIcp": {
              "summary": "최근 사건이 없으면 제외",
              "rules": [{ "id": "polite", "label": "흥미롭네요만 말함", "reason": "polite interest", "evidenceRef": null }],
              "politeInterestGuardrails": ["최근 7일 사건 묻기"]
            },
            "firstInterviewMessage": {
              "channel": "DM/email/Slack",
              "recipientPlaceholder": "{name}",
              "subject": "ICP 인터뷰",
              "bodyTemplate": "안녕하세요 {name}님",
              "questions": ["최근 사건?"]
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_scan_result")
        #expect(event.day1IcpPlan?.schemaVersion == 1)
        #expect(event.day1IcpPlan?.questions.count == 3)
        #expect(event.day1IcpPlan?.questions.first?.options.last?.antiSignal == true)
        #expect(event.day1IcpPlan?.questions.first?.options.first?.evidenceLabel == "근거: README.md")
        #expect(event.day1IcpPlan?.questions.first?.options.last?.evidenceLimited == true)
        #expect(event.day1IcpPlan?.icpDraft.description.contains("support lead") == true)
        #expect(event.day1IcpPlan?.antiIcp.rules.first?.label == "흥미롭네요만 말함")
    }

    @MainActor @Test func decodesWorkspaceScanResultWithDay1AlignmentPlan() throws {
        let signalDigestBlock = """
            "signalDigest": {
              "schemaVersion": 1,
              "rows": [
                { "key": "project", "label": "프로젝트", "value": "SupportLens", "tone": "strong" },
                { "key": "goal", "label": "목표", "value": "유료 support lead 후보 1명을 검증한다", "tone": "body" },
                { "key": "icp", "label": "고객", "value": "B2B SaaS support lead", "tone": "body" },
                { "key": "pain", "label": "문제", "value": "urgent Slack escalation을 놓침", "tone": "mark" },
                { "key": "outcome", "label": "확인할 행동", "value": "계정 리스크 escalation을 더 빨리 판단한다", "tone": "strong" },
                { "key": "evidence", "label": "근거", "value": "docs/GOAL.md, docs/ICP.md", "tone": "code" }
              ],
              "summary": "SupportLens는 support lead의 Slack escalation 누락을 Day 2에서 검증한다."
            },
        """
        let payload = """
        {
          "type": "workspace_scan_result",
          "scanRoot": "/Users/october/prj/myapp",
          "day1AlignmentPlan": {
            "schemaVersion": 1,
            "source": "deterministic",
            "generatedAt": "2026-05-20T00:00:00.000Z",
            "confidence": 0.82,
            "fellBackToDeterministic": false,
            "projectGoal": "SupportLens가 유료 support lead 후보 1명을 검증한다",
            "mission": "목표, 고객, 문제, 확인할 행동을 정렬합니다.",
            "signals": {
              "productName": "SupportLens",
              "currentIcpGuess": "B2B SaaS support lead",
              "likelyUsers": ["support lead"],
              "problem": "urgent Slack escalation을 놓침",
              "currentAlternatives": ["Slack 수동 확인"],
              "evidenceRefs": [{ "path": "README.md", "reason": "README", "quote": "# SupportLens" }],
              "missingAssumptions": [],
              "confidence": "high"
            },
            "components": {
              "icp": {
                "id": "icp",
                "title": "고객",
                "prompt": "이 목표를 검증하려면 이번 주 가장 먼저 확인할 고객은 누구인가요?",
                "helperText": "이번 주 실제로 물어볼 수 있는 고객 조건",
                "statement": "B2B SaaS support lead",
                "evidence": ["README.md: README"],
                "missingAssumptions": [],
                "options": [
                  { "id": "o1", "label": "support lead", "description": "현재 고객", "preview": "고객", "antiSignal": false },
                  { "id": "o2", "label": "관심만 있음", "description": "최근 사건 없음", "preview": "Weak", "antiSignal": true }
                ]
              },
              "painPoint": {
                "id": "pain_point",
                "title": "문제",
                "prompt": "이 고객이 지금 겪는 가장 압축된 문제는 무엇인가요?",
                "helperText": "비용 신호",
                "statement": "urgent Slack escalation을 놓침",
                "evidence": ["docs/SPEC.md"],
                "missingAssumptions": [],
                "options": [
                  { "id": "o1", "label": "Slack 누락", "description": "반복됨", "preview": "문제" },
                  { "id": "o2", "label": "불편만 있음", "description": "행동 없음", "preview": "Weak", "antiSignal": true }
                ]
              },
              "outcome": {
                "id": "outcome",
                "title": "확인할 행동",
                "prompt": "그 고객에게서 어떤 행동 신호를 확인해야 하나요?",
                "helperText": "지불 의향, 현재 대안, 최근 사건처럼 관찰 가능한 행동",
                "statement": "계정 리스크 escalation을 더 빨리 판단한다",
                "evidence": ["docs/GOAL.md"],
                "missingAssumptions": [],
                "options": [
                  { "id": "o1", "label": "빠른 판단", "description": "행동 신호", "preview": "확인할 행동" },
                  { "id": "o2", "label": "기능 추가", "description": "빌드 도피", "preview": "Anti", "antiSignal": true }
                ]
              }
            },
            "alignmentStatement": {
              "statement": "목표: SupportLens가 유료 support lead 후보 1명을 검증한다 / 고객: B2B SaaS support lead / 문제: urgent Slack escalation을 놓침 / 확인할 행동: 계정 리스크 escalation을 더 빨리 판단한다",
              "projectGoal": "SupportLens가 유료 support lead 후보 1명을 검증한다",
              "icp": "B2B SaaS support lead",
              "painPoint": "urgent Slack escalation을 놓침",
              "outcome": "계정 리스크 escalation을 더 빨리 판단한다"
            },
            "qualityGate": {
              "score": 8.4,
              "threshold": 7.0,
              "passed": true,
              "label": "PASS",
              "passGate": "핵심 가설이 7.0/10 이상",
              "failGate": "목표, 고객, 문제, 확인할 행동 중 하나가 비어 있음",
              "criteria": [
                { "id": "project_goal", "label": "목표", "score": 2.0, "maxScore": 2.0, "passed": true, "detail": "명확함" }
              ]
            },
            "firstInterviewMessage": {
              "channel": "DM/email/Slack",
              "recipientPlaceholder": "{name}",
              "subject": "핵심 가설 인터뷰",
              "bodyTemplate": "안녕하세요 {name}님",
              "questions": ["최근 사건?"]
            },
        \(signalDigestBlock)
            "day2Handoff": {
              "title": "Day 2 시장 신호로 넘길 핵심 가설",
              "body": "Day 2에서 유료 대체재를 확인합니다.",
              "focus": "목표: SupportLens...",
              "nextDayPrompt": "유료 대체재 5개를 찾는다.",
              "qualityGateLabel": "PASS 8.4/10"
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_scan_result")
        #expect(event.day1AlignmentPlan?.schemaVersion == 1)
        #expect(event.day1AlignmentPlan?.projectGoal.contains("SupportLens") == true)
        #expect(event.day1AlignmentPlan?.components.painPoint.statement.contains("Slack") == true)
        #expect(event.day1AlignmentPlan?.components.outcome.options.last?.antiSignal == true)
        #expect(event.day1AlignmentPlan?.qualityGate.score == 8.4)
        #expect(event.day1AlignmentPlan?.day2Handoff.qualityGateLabel == "PASS 8.4/10")
        #expect(event.day1AlignmentPlan?.signalDigest?.rows.map(\.key) == ["project", "goal", "icp", "pain", "outcome", "evidence"])
        #expect(event.day1AlignmentPlan?.signalDigest?.summary.contains("Day 2") == true)

        let legacyPayload = payload.replacingOccurrences(of: "\"signalDigest\"", with: "\"legacySignalDigest\"")
        let legacyEvent = try decoder.decode(SidecarEvent.self, from: Data(legacyPayload.utf8))
        #expect(legacyEvent.day1AlignmentPlan?.signalDigest == nil)
        #expect(legacyEvent.day1AlignmentPlan?.qualityGate.score == 8.4)
    }

    @MainActor @Test func decodesWorkspaceScanResultWithError() throws {
        let payload = """
        {
          "type": "workspace_scan_result",
          "scanRoot": "/Users/october/prj/myapp",
          "error": "Agent could not identify documents in this workspace.",
          "stage": "failed",
          "stepIndex": 2,
          "totalSteps": 3,
          "foundCount": 0
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_scan_result")
        #expect(event.error == "Agent could not identify documents in this workspace.")
        #expect(event.stage == "failed")
        #expect(event.stepIndex == 2)
        #expect(event.totalSteps == 3)
        #expect(event.foundCount == 0)
        #expect(event.icp == nil)
        #expect(event.goal == nil)
    }

    @MainActor @Test func decodesDocCreationStarted() throws {
        let payload = """
        {
          "type": "doc_creation_started",
          "docType": "goal"
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "doc_creation_started")
        #expect(event.docType == "goal")
        #expect(event.docPath == nil)
    }

    @MainActor @Test func decodesDocCreationResult() throws {
        let payload = """
        {
          "type": "doc_creation_result",
          "docType": "icp",
          "docPath": "docs/ICP.md"
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "doc_creation_result")
        #expect(event.docType == "icp")
        #expect(event.docPath == "docs/ICP.md")
        #expect(event.error == nil)
    }

    @MainActor @Test func decodesDocCreationResultWithError() throws {
        let payload = """
        {
          "type": "doc_creation_result",
          "docType": "spec",
          "error": "Agent finished but the file was not found at docs/SPEC.md"
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "doc_creation_result")
        #expect(event.docType == "spec")
        #expect(event.docPath == nil)
        #expect(event.error == "Agent finished but the file was not found at docs/SPEC.md")
    }

    @MainActor @Test func decodesDiagnosticsSnapshot() throws {
        let payload = """
        {
          "type": "diagnostics_snapshot",
          "diagnostics": {
            "generatedAt": "2026-04-15T01:02:03.000Z",
            "appSupportPath": "/Users/tester/Library/Application Support/agentic30",
            "workspaceRoot": "/tmp/workspace",
            "runtime": {
              "pid": 123,
              "platform": "darwin",
              "arch": "arm64",
              "node": "v22.22.2"
            },
            "storage": {
              "sessionsSchemaVersion": 1
            },
            "sessions": {
              "total": 2,
              "activeRuns": 1,
              "statuses": {
                "idle": 1,
                "running": 1
              }
            },
            "environment": {
              "claude": {
                "available": true,
                "source": "local-session",
                "message": "Local Claude login session",
                "sdk": {
                  "available": true,
                  "packageName": "@anthropic-ai/claude-agent-sdk",
                  "version": "0.2.87",
                  "entrypointPath": "/repo/node_modules/@anthropic-ai/claude-agent-sdk/cli.js"
                }
              },
              "codex": {
                "available": false,
                "source": "missing",
                "message": "Sign in with Codex",
                "sdk": {
                  "available": true,
                  "packageName": "@openai/codex-sdk",
                  "version": "0.125.0",
                  "entrypointPath": "/repo/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex",
                  "cliSource": "bundled",
                  "cliPath": "/repo/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex",
                  "cliVersion": "0.125.0",
                  "cliArch": "arm64",
                  "minimumVersionSatisfied": true
                }
              },
              "acp": {
                "available": true,
                "message": "ACP adapter ready",
                "adapterPath": "/tmp/acp-adapter.mjs",
                "command": "node acp-adapter.mjs"
              }
            },
            "preflight": {
              "status": "warning",
              "checks": [
                {
                  "id": "provider-auth",
                  "title": "At least one provider is authenticated",
                  "status": "ok",
                  "message": "Claude"
                }
              ]
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "diagnostics_snapshot")
        #expect(event.diagnostics?.runtime.node == "v22.22.2")
        #expect(event.diagnostics?.storage.sessionsSchemaVersion == 1)
        #expect(event.diagnostics?.sessions.statuses["idle"] == 1)
        #expect(event.diagnostics?.environment?.claude.available == true)
        #expect(event.diagnostics?.environment?.claude.sdk?.entrypointPath?.hasSuffix("cli.js") == true)
        #expect(event.diagnostics?.environment?.codex.sdk?.packageName == "@openai/codex-sdk")
        #expect(event.diagnostics?.environment?.codex.sdk?.cliSource == "bundled")
        #expect(event.diagnostics?.preflight?.status == "warning")
        #expect(event.diagnostics?.preflight?.checks.first?.id == "provider-auth")
    }

    @MainActor @Test func decodesGeminiAdcDiagnosticOnMissingAuthState() throws {
        // After commit 85b63ef, sidecar attaches a `geminiAdc` diagnostic when
        // Gemini auth is not ready, so the Mac shell can distinguish "gcloud not
        // installed" from "gcloud installed, ADC missing" and surface the right
        // recovery affordance (BYOK fallback vs ADC login).
        let payload = """
        {
          "type": "ready",
          "environment": {
            "claude": {
              "available": false,
              "source": "missing",
              "message": "Sign in with Claude Code or set ANTHROPIC_API_KEY"
            },
            "codex": {
              "available": false,
              "source": "missing",
              "message": "Sign in with Codex or set CODEX_API_KEY / OPENAI_API_KEY"
            },
            "gemini": {
              "available": false,
              "source": "missing",
              "message": "gcloud SDK not installed — set GEMINI_API_KEY / GOOGLE_API_KEY or install Google Cloud SDK",
              "geminiAdc": {
                "status": "gcloud-missing",
                "gcloudInstalled": false,
                "adcCredentialsPresent": false
              }
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        let gemini = try #require(event.environment?.gemini)
        let diagnostic = try #require(gemini.geminiAdc)
        #expect(diagnostic.status == "gcloud-missing")
        #expect(diagnostic.isGcloudMissing == true)
        #expect(diagnostic.needsAdcLogin == false)
        #expect(diagnostic.gcloudInstalled == false)
        #expect(event.environment?.claude.geminiAdc == nil)
    }

    @MainActor @Test func decodesGeminiEnvironmentWithoutGeminiAdcField() throws {
        // Backwards compatibility: older sidecar payloads (and non-gemini providers)
        // omit the geminiAdc field entirely. The Swift decoder must treat it as nil
        // rather than rejecting the envelope.
        let payload = """
        {
          "type": "ready",
          "environment": {
            "claude": {
              "available": true,
              "source": "local-session",
              "message": "Local Claude login session"
            },
            "codex": {
              "available": true,
              "source": "local-session",
              "message": "Local Codex login session"
            },
            "gemini": {
              "available": true,
              "source": "api-key",
              "message": "API key from GEMINI_API_KEY / GOOGLE_API_KEY"
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.environment?.gemini?.available == true)
        #expect(event.environment?.gemini?.geminiAdc == nil)
    }

    @MainActor @Test func decodesIddSetupGateFields() throws {
        let payload = """
        {
          "type": "idd_setup_state",
          "sessionId": "session-1",
          "iddSetupComplete": false,
          "iddSetupStatus": "preview_ready",
          "iddCurrentDocType": "spec",
          "iddAmbiguityScore": 18,
          "iddUnresolvedAssumptions": ["pricing proof"],
          "iddDocOrder": ["icp", "goal", "values", "spec"],
          "iddDocPreviews": [
            {
              "type": "icp",
              "title": "ICP",
              "path": "docs/ICP.md",
              "status": "drafted",
              "content": "# ICP"
            }
          ],
          "iddProviderRecovery": {
            "provider": "codex",
            "message": "Sign in with Codex",
            "actionId": "sign_in_codex"
          },
          "iddSetupError": {
            "provider": "codex",
            "docType": "icp",
            "message": "질문 카드 준비가 중단됐습니다.",
            "recoverable": true
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "idd_setup_state")
        #expect(event.iddSetupComplete == false)
        #expect(event.iddSetupStatus == "preview_ready")
        #expect(event.iddCurrentDocType == "spec")
        #expect(event.iddAmbiguityScore == 18)
        #expect(event.iddUnresolvedAssumptions == ["pricing proof"])
        #expect(event.iddDocOrder == ["icp", "goal", "values", "spec"])
        #expect(event.iddDocPreviews?.first?.path == "docs/ICP.md")
        #expect(event.iddProviderRecovery?.provider == .codex)
        #expect(event.iddProviderRecovery?.actionId == "sign_in_codex")
        #expect(event.iddSetupError?.provider == .codex)
        #expect(event.iddSetupError?.docType == "icp")
        #expect(event.iddSetupError?.recoverable == true)
    }

    @MainActor @Test func decodesIddSetupProgressFields() throws {
        let payload = """
        {
          "type": "idd_setup_progress",
          "sessionId": "session-1",
          "requestId": "request-1",
          "docType": "icp",
          "stage": "recording_response",
          "progressText": "ICP 문서에 반영 중",
          "elapsedMs": 132
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "idd_setup_progress")
        #expect(event.sessionId == "session-1")
        #expect(event.requestId == "request-1")
        #expect(event.docType == "icp")
        #expect(event.stage == "recording_response")
        #expect(event.progressText == "ICP 문서에 반영 중")
        #expect(event.elapsedMs == 132)
    }

    @MainActor @Test func decodesNewsMarketRadarResult() throws {
        let payload = """
        {
          "type": "news_market_radar_result",
          "newsMarketRadar": {
            "schemaVersion": 1,
            "generatedAt": "2026-05-20T00:00:00.000Z",
            "nextRefreshAfter": "2026-05-21T00:00:00.000Z",
            "status": {
              "state": "ready",
              "lastSuccessAt": "2026-05-20T00:00:00.000Z",
              "stale": false,
              "error": null,
              "reason": "manual",
              "researchSource": "Codex Exa MCP",
              "partialFailures": [
                {
                  "laneId": "channel",
                  "laneTitle": "채널",
                  "error": "채널 리서치 provider timeout"
                }
              ]
            },
            "workspaceEvidenceRefs": [],
            "lanes": [
              {
                "id": "alternatives_pricing",
                "title": "대안/가격",
                "hypothesis": "이미 돈을 쓰는 대안과 가격 기준은 무엇인가",
                "impact": "strengthens",
                "confidence": "strong",
                "cards": [
                  {
                    "id": "card-1",
                    "title": "1인 개발자는 이미 코딩 도구에 돈을 씁니다",
                    "summary": "Cursor, Claude 같은 도구 결제가 이미 대안 지출 기준을 만듭니다.",
                    "impact": "strengthens",
                    "confidence": "strong",
                    "whyItMatters": "가격 ask 기준이 생깁니다.",
                    "suggestedHypothesisUpdate": "ICP에 paid tool spend를 추가",
                    "suggestedDocTargets": ["ICP.md", "SPEC.md"],
                    "relatedDays": [2, 5, 27],
                    "relatedAnswerIds": ["answer-1"],
                    "sourceRefs": [
                      {
                        "id": "src-1",
                        "sourceType": "web",
                        "title": "Pricing",
                        "url": "https://example.com/pricing",
                        "domain": "example.com",
                        "publishedAt": "",
                        "excerpt": "월 $20 가격대"
                      }
                    ],
                    "evidenceStrength": "strong"
                  }
                ]
              }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "news_market_radar_result")
        #expect(event.newsMarketRadar?.status.state == "ready")
        #expect(event.newsMarketRadar?.status.researchSource == "Codex Exa MCP")
        #expect(event.newsMarketRadar?.status.partialFailures?.first?.laneId == "channel")
        #expect(event.newsMarketRadar?.status.partialFailures?.first?.laneTitle == "채널")
        #expect(event.newsMarketRadar?.lanes.first?.id == "alternatives_pricing")
        #expect(event.newsMarketRadar?.lanes.first?.cards.first?.relatedDays == [2, 5, 27])
        #expect(event.newsMarketRadar?.lanes.first?.cards.first?.sourceRefs.first?.domain == "example.com")
    }

    @MainActor @Test func newsMarketRadarSourceStableIDPrefersURLOverDuplicateSourceID() throws {
        let payload = """
        {
          "type": "news_market_radar_result",
          "newsMarketRadar": {
            "schemaVersion": 1,
            "generatedAt": "2026-05-20T00:00:00.000Z",
            "nextRefreshAfter": "2026-05-21T00:00:00.000Z",
            "status": {
              "state": "ready",
              "lastSuccessAt": "2026-05-20T00:00:00.000Z",
              "stale": false,
              "error": null,
              "reason": "manual"
            },
            "workspaceEvidenceRefs": [],
            "lanes": [
              {
                "id": "platform",
                "title": "플랫폼",
                "hypothesis": "플랫폼 요구사항",
                "impact": "strengthens",
                "confidence": "medium",
                "cards": [
                  {
                    "id": "card-1",
                    "title": "Anthropic 문서 출처",
                    "summary": "같은 도메인의 다른 문서를 구분합니다.",
                    "impact": "strengthens",
                    "confidence": "medium",
                    "sourceRefs": [
                      {
                        "id": "web-docs.anthropic.com",
                        "sourceType": "web",
                        "title": "Overview",
                        "url": "https://docs.anthropic.com/en/docs/claude-code/overview",
                        "domain": "docs.anthropic.com"
                      },
                      {
                        "id": "web-docs.anthropic.com",
                        "sourceType": "web",
                        "title": "Settings",
                        "url": "https://docs.anthropic.com/en/docs/claude-code/settings",
                        "domain": "docs.anthropic.com"
                      }
                    ],
                    "evidenceStrength": "medium"
                  }
                ]
              }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        let sourceRefs = try #require(event.newsMarketRadar?.lanes.first?.cards.first?.sourceRefs)

        #expect(sourceRefs.count == 2)
        #expect(sourceRefs[0].id == sourceRefs[1].id)
        #expect(sourceRefs[0].stableID != sourceRefs[1].stableID)
        #expect(sourceRefs[0].stableID == "https://docs.anthropic.com/en/docs/claude-code/overview")
    }

    @MainActor @Test func decodesNewsMarketRadarStatusObject() throws {
        let payload = """
        {
          "type": "news_market_radar_status",
          "status": {
            "state": "refreshing",
            "lastSuccessAt": null,
            "stale": false,
            "error": null,
            "reason": "daily",
            "researchSource": "Gemini Exa MCP",
            "stage": "running_provider_research",
            "progressText": "Gemini Exa MCP로 공개 근거를 검색하는 중",
            "elapsedMs": 4210,
            "stepIndex": 4,
            "stepCount": 6,
            "partialFailures": [
              {
                "laneId": "problem",
                "laneTitle": "문제",
                "error": "문제 리서치 실패"
              }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "news_market_radar_status")
        #expect(event.status == nil)
        #expect(event.newsMarketRadarStatus?.state == "refreshing")
        #expect(event.newsMarketRadarStatus?.reason == "daily")
        #expect(event.newsMarketRadarStatus?.researchSource == "Gemini Exa MCP")
        #expect(event.newsMarketRadarStatus?.stage == "running_provider_research")
        #expect(event.newsMarketRadarStatus?.progressText == "Gemini Exa MCP로 공개 근거를 검색하는 중")
        #expect(event.newsMarketRadarStatus?.elapsedMs == 4210)
        #expect(event.newsMarketRadarStatus?.stepIndex == 4)
        #expect(event.newsMarketRadarStatus?.stepCount == 6)
        #expect(event.newsMarketRadarStatus?.partialFailures?.first?.laneId == "problem")
    }

    @MainActor @Test func decodesBipResearchResult() throws {
        let payload = """
        {
          "type": "bip_research_result",
          "bipResearch": {
            "schemaVersion": 1,
            "contentLocale": "ko-KR",
            "promptProfile": "ko_bip_research_v1_x_threads_dynamic",
            "contextFingerprint": "abc123",
            "generatedAt": "2026-05-21T00:00:00.000Z",
            "nextRefreshAfter": "2026-05-22T00:00:00.000Z",
            "dayNumber": 8,
            "dayTitle": "MVP를 핵심 기능 1개로 자른다",
            "dayPhase": "build",
            "status": {
              "state": "ready",
              "lastSuccessAt": "2026-05-21T00:00:00.000Z",
              "stale": false,
              "error": null,
              "reason": "manual",
              "researchSource": "Codex Exa MCP"
            },
            "briefTitle": "Day 8 기준 X/Threads 후보",
            "briefBody": "실제 fetch 결과만 표시합니다.",
            "querySummary": "site:x.com Claude Code",
            "candidateTargetCount": 18,
            "workspaceEvidenceRefs": [],
            "signals": [
              {
                "id": "social",
                "title": "X/Threads 공개 기록",
                "subtitle": "X 1",
                "state": "seen",
                "tone": "accent"
              }
            ],
            "candidates": [
              {
                "id": "candidate-1",
                "title": "Builder — Claude Code BIP 후보",
                "sourceLabel": "x",
                "source": "@builder",
                "sourceType": "x",
                "medium": "X thread",
                "date": "2026-05-21",
                "matchLabel": "강",
                "matchCaption": "match",
                "quote": "Claude Code로 빌드 과정을 공개합니다.",
                "whyTitle": "왜 ICP 증거인가",
                "whyBody": "macOS agentic coding 워크플로와 맞습니다.",
                "usageTitle": "BIP 활용",
                "usageBody": "DM 후보로 저장합니다.",
                "gap": "전업 여부 확인",
                "tags": [
                  { "title": "X", "tone": "sky" }
                ],
                "sourceRefs": [
                  {
                    "id": "src-1",
                    "sourceType": "x",
                    "platform": "x",
                    "title": "Fetched post",
                    "url": "https://x.com/builder/status/1",
                    "domain": "x.com",
                    "publishedAt": "2026-05-21",
                    "fetchedAt": "2026-05-21T00:00:00.000Z",
                    "excerpt": "Fetched excerpt"
                  }
                ],
                "draft": "오늘 BIP 초안",
                "evidenceStrength": "strong"
              }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "bip_research_result")
        #expect(event.bipResearch?.dayNumber == 8)
        #expect(event.bipResearch?.status.state == "ready")
        #expect(event.bipResearch?.signals.first?.id == "social")
        #expect(event.bipResearch?.candidates.first?.sourceRefs.first?.url == "https://x.com/builder/status/1")
        #expect(event.bipResearch?.candidates.first?.tags.first?.title == "X")
    }

    @MainActor @Test func decodesBipResearchStatusObject() throws {
        let payload = """
        {
          "type": "bip_research_status",
          "status": {
            "state": "refreshing",
            "lastSuccessAt": null,
            "stale": false,
            "error": null,
            "reason": "daily",
            "researchSource": "Codex Exa MCP",
            "stage": "running_provider_research",
            "progressText": "X/Threads ICP 후보를 검색하는 중",
            "elapsedMs": 3100,
            "stepIndex": 4,
            "stepCount": 6,
            "partialFailures": [
              {
                "laneId": "bip",
                "laneTitle": "BIP 리서치",
                "error": "provider timeout"
              }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "bip_research_status")
        #expect(event.status == nil)
        #expect(event.bipResearchStatus?.state == "refreshing")
        #expect(event.bipResearchStatus?.reason == "daily")
        #expect(event.bipResearchStatus?.researchSource == "Codex Exa MCP")
        #expect(event.bipResearchStatus?.stage == "running_provider_research")
        #expect(event.bipResearchStatus?.stepIndex == 4)
        #expect(event.bipResearchStatus?.partialFailures?.first?.laneId == "bip")
    }

    @MainActor @Test func decodesWorkHistoryResultPayload() throws {
        // History 탭 주간 회고 스냅샷. sidecar/work-history.mjs의
        // buildWeeklyWorkHistorySnapshot 출력 형태를 그대로 고정한다.
        let payload = """
        {
          "type": "work_history_result",
          "workHistory": {
            "schemaVersion": 1,
            "generatedAt": "2026-06-05T03:00:00.000Z",
            "weekStart": "2026-06-01",
            "weekEnd": "2026-06-07",
            "status": {
              "state": "ready",
              "lastSuccessAt": "2026-06-05T03:00:00.000Z",
              "stale": false,
              "error": null,
              "reason": "manual"
            },
            "github": { "connected": true, "prCount": 1, "issueCount": 0, "releaseCount": 1 },
            "totals": {
              "aiMinutes": 120,
              "unclassifiedMinutes": 30,
              "myCommitCount": 1,
              "otherCommitCount": 2,
              "sessionCount": 2,
              "activeDays": 1
            },
            "areas": [
              {
                "id": "sidecar",
                "name": "사이드카",
                "aiMinutes": 90,
                "commitCount": 1,
                "sessionCount": 1,
                "paths": ["sidecar/index.mjs"],
                "confidence": "high",
                "inference": "heuristic"
              }
            ],
            "days": [
              {
                "date": "2026-06-01",
                "weekday": "월",
                "aiMinutes": 90,
                "areas": [
                  {
                    "areaId": "sidecar",
                    "name": "사이드카",
                    "summary": "사이드카에 AI 세션 1시간 30분을 투입해 커밋 1건으로 마무리했어요.",
                    "nextActions": [
                      { "text": "라우트 테스트 보강", "evidence": "sidecar/index.mjs 변경", "areaName": "사이드카" }
                    ],
                    "aiMinutes": 90,
                    "sessionRanges": [
                      { "start": "2026-06-01T04:00:00.000Z", "end": "2026-06-01T05:30:00.000Z", "provider": "claude" }
                    ],
                    "paths": ["sidecar/index.mjs"],
                    "commitCount": 1,
                    "confidence": "high"
                  }
                ],
                "referenceEvents": [
                  { "kind": "pr", "title": "PR #7 History tab", "actor": "zettalyst", "at": "2026-06-01T10:00:00.000Z" }
                ]
              }
            ],
            "unclassified": [
              {
                "provider": "codex",
                "date": "2026-06-02",
                "start": "2026-06-02T04:00:00.000Z",
                "end": "2026-06-02T04:30:00.000Z",
                "minutes": 30,
                "paths": ["scripts/spike.mjs"]
              }
            ],
            "weekly": {
              "headline": "이번 주 AI 세션 2시간 · 커밋 1건",
              "coachNotes": ["커밋으로 이어지지 않은 세션이 1개(30분) 있어요."],
              "nextActions": [
                { "text": "미분류 세션 마무리", "evidence": "세션 1건 · 수정 파일 1개", "areaName": null }
              ]
            },
            "retrospective": {
              "headline": "이번 주 작업은 진척보다 먼저 닫아야 할 루프가 보입니다.",
              "verdict": "close_loop",
              "insights": [
                {
                  "id": "focus-sidecar",
                  "claim": "사이드카에 이번 주 작업 에너지가 가장 많이 모였습니다.",
                  "whyItMatters": "이 집중이 고객 증거나 다음 실험으로 이어지는지 확인해야 합니다.",
                  "confidence": "high",
                  "evidenceRefs": ["사이드카 · AI 1시간 30분 · 커밋 1건", "sidecar/index.mjs"]
                }
              ],
              "riskFlags": [
                {
                  "id": "unclassified",
                  "label": "미분류 세션",
                  "severity": "watch",
                  "reason": "커밋으로 이어지지 않은 AI 세션 1개가 남아 있습니다.",
                  "evidenceRefs": ["미분류 30분"]
                }
              ],
              "nextActions": [
                { "text": "미분류 세션을 커밋으로 닫거나 버린 작업으로 표시하세요.", "evidence": "미분류 30분", "insightId": "unclassified-loop" }
              ],
              "evidenceMix": [
                { "source": "ai_session", "label": "AI 세션", "count": 2, "status": "connected" },
                { "source": "git_github", "label": "git/GitHub", "count": 4, "status": "connected" },
                { "source": "workspace_docs", "label": "워크스페이스 문서", "count": 2, "status": "connected" },
                { "source": "interview", "label": "인터뷰", "count": 0, "status": "missing" }
              ]
            },
            "fingerprint": { "headHash": "f3552f14" }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "work_history_result")
        #expect(event.workHistory?.weekStart == "2026-06-01")
        #expect(event.workHistory?.status.state == "ready")
        #expect(event.workHistory?.github.connected == true)
        #expect(event.workHistory?.totals.aiMinutes == 120)
        #expect(event.workHistory?.areas.first?.id == "sidecar")
        #expect(event.workHistory?.days.first?.weekday == "월")
        #expect(event.workHistory?.days.first?.areas.first?.sessionRanges.first?.provider == "claude")
        #expect(event.workHistory?.days.first?.areas.first?.nextActions.first?.evidence == "sidecar/index.mjs 변경")
        #expect(event.workHistory?.days.first?.referenceEvents.first?.kind == "pr")
        #expect(event.workHistory?.unclassified.first?.minutes == 30)
        #expect(event.workHistory?.weekly.headline.contains("AI 세션") == true)
        #expect(event.workHistory?.retrospective.verdict == "close_loop")
        #expect(event.workHistory?.retrospective.insights.first?.evidenceRefs.first?.contains("사이드카") == true)
        #expect(event.workHistory?.retrospective.riskFlags.first?.label == "미분류 세션")
        #expect(event.workHistory?.retrospective.nextActions.first?.insightId == "unclassified-loop")
        #expect(event.workHistory?.retrospective.evidenceMix.first?.source == "ai_session")
        #expect(event.workHistory?.hasData == true)
        #expect(event.workHistory?.requiresGitHub == false)
    }

    @MainActor @Test func decodesLegacyWorkHistoryV1PayloadWithoutRetrospective() throws {
        let payload = """
        {
          "type": "work_history_result",
          "workHistory": {
            "schemaVersion": 1,
            "generatedAt": "2026-06-05T03:00:00.000Z",
            "weekStart": "2026-06-01",
            "weekEnd": "2026-06-07",
            "status": { "state": "ready", "lastSuccessAt": "2026-06-05T03:00:00.000Z", "stale": false, "error": null, "reason": "manual" },
            "github": { "connected": true, "prCount": 0, "issueCount": 0, "releaseCount": 0 },
            "totals": { "aiMinutes": 10, "unclassifiedMinutes": 0, "myCommitCount": 1, "otherCommitCount": 0, "sessionCount": 1, "activeDays": 1 },
            "areas": [],
            "days": [],
            "unclassified": [],
            "weekly": { "headline": "legacy", "coachNotes": [], "nextActions": [] }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.workHistory?.schemaVersion == 1)
        #expect(event.workHistory?.retrospective.verdict == "continue")
        #expect(event.workHistory?.retrospective.insights.isEmpty == true)
        #expect(event.workHistory?.weekly.headline == "legacy")
    }

    @MainActor @Test func decodesWorkHistoryStatusObject() throws {
        let payload = """
        {
          "type": "work_history_status",
          "status": {
            "state": "refreshing",
            "lastSuccessAt": null,
            "stale": true,
            "error": null,
            "reason": "tab_enter",
            "stage": "collect_sessions",
            "progressText": "AI 세션 로그를 읽는 중",
            "elapsedMs": 1200
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "work_history_status")
        #expect(event.workHistoryStatus?.state == "refreshing")
        #expect(event.workHistoryStatus?.reason == "tab_enter")
        #expect(event.workHistoryStatus?.stage == "collect_sessions")
        #expect(event.workHistoryStatus?.elapsedMs == 1200)

        // 진행 상태 병합이 기존 스냅샷 데이터를 보존하는지 고정.
        let merged = WorkHistorySnapshot.empty.applying(status: event.workHistoryStatus!)
        #expect(merged.status.state == "refreshing")
        #expect(merged.status.progressText == "AI 세션 로그를 읽는 중")
    }

    @MainActor @Test func decodesWorkHistoryGitHubRequiredState() throws {
        let payload = """
        {
          "type": "work_history_result",
          "workHistory": {
            "schemaVersion": 1,
            "generatedAt": "2026-06-05T03:00:00.000Z",
            "weekStart": "2026-06-01",
            "weekEnd": "2026-06-07",
            "status": { "state": "github_required", "lastSuccessAt": null, "stale": false, "error": null, "reason": "manual" },
            "github": { "connected": false, "prCount": 0, "issueCount": 0, "releaseCount": 0 },
            "totals": { "aiMinutes": 0, "unclassifiedMinutes": 0, "myCommitCount": 0, "otherCommitCount": 0, "sessionCount": 0, "activeDays": 0 },
            "areas": [],
            "days": [],
            "unclassified": [],
            "weekly": { "headline": "", "coachNotes": [], "nextActions": [] }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.workHistory?.requiresGitHub == true)
        #expect(event.workHistory?.github.connected == false)
    }

    private var decoder: JSONDecoder {
        let decoder = JSONDecoder()
        let formatter = ISO8601DateFormatter()
        formatter.formatOptions = [.withInternetDateTime, .withFractionalSeconds]
        decoder.dateDecodingStrategy = .custom { decoder in
            let container = try decoder.singleValueContainer()
            let value = try container.decode(String.self)
            guard let date = formatter.date(from: value) else {
                throw DecodingError.dataCorruptedError(
                    in: container,
                    debugDescription: "Invalid ISO8601 date: \(value)"
                )
            }
            return date
        }
        return decoder
    }
}

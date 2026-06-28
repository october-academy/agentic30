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
                "codexThreadId": "thread-1",
                "officeHours": {
                  "active": true,
                  "day": 2,
                  "attemptId": "attempt-1",
                  "revision": 6,
                  "nextAction": { "kind": "wait", "reason": "action" },
                  "gatherProgress": { "answered": 6, "total": 6 },
                  "acceptableDay1Close": true
                }
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
        // R1.b: 인터뷰 완료는 사이드카 ValidationAttempt projection에서 파생된
        // nextAction.kind 로 판정한다(게더 카드가 더 없으면 wait/terminal). 권위
        // 포인터({attemptId, revision})와 게더 진행도도 같이 실린다.
        #expect(event.sessions?.first?.runtime?.officeHours?.attemptId == "attempt-1")
        #expect(event.sessions?.first?.runtime?.officeHours?.revision == 6)
        #expect(event.sessions?.first?.runtime?.officeHours?.nextAction?.kind == "wait")
        #expect(event.sessions?.first?.runtime?.officeHours?.nextAction?.waitReason == "action")
        #expect(event.sessions?.first?.runtime?.officeHours?.gatherProgress?.answered == 6)
        // R2: the wire DTO carries the host-derived Day-1 close acceptability flag.
        #expect(event.sessions?.first?.runtime?.officeHours?.acceptableDay1Close == true)
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

    @MainActor @Test func decodesProgramNotificationScheduleEvent() throws {
        let payload = """
        {
          "type": "program_notification_schedule",
          "workspaceRoot": "/repo",
          "programNotificationSchedule": {
            "schema": "agentic30.program.notification_schedule.v1",
            "schema_version": 1,
            "notifications": [
              {
                "identifier": "agentic30.program.gate-blocked-morning",
                "title": "G4 게이트가 잠겨 있어",
                "body": "필요한 증거 1개: 유료 ask 발송 증거",
                "sound": "default",
                "trigger": {
                  "type": "local_calendar_time",
                  "calendar": "local",
                  "hour": 9,
                  "minute": 0,
                  "repeats": false
                },
                "userInfo": {
                  "kind": "program_gate_blocked_morning",
                  "gateId": "G4",
                  "day": 15
                }
              }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        let request = event.programNotificationSchedule?.validLocalNotificationRequests.first

        #expect(event.type == "program_notification_schedule")
        #expect(event.workspaceRoot == "/repo")
        #expect(request?.identifier == "agentic30.program.gate-blocked-morning")
        #expect(request?.notificationUserInfo["agentic30.program.notification.gateId"] as? String == "G4")
    }

    // A′ receipt rail (step 1): the host echoes attemptId (not a requestId) on the ingest
    // reply, so the VM resolves the pending continuation keyed by attempt. Success carries
    // the receiptToken handed to office_hours_attempt_evidence as evidence.receipt.
    @MainActor @Test func decodesOfficeHoursEvidenceIngestedSuccess() throws {
        let payload = """
        {
          "type": "office_hours_evidence_ingested",
          "workspaceRoot": "/repo",
          "attemptId": "attempt-1",
          "receiptToken": "rcpt_swift_upload_abc123",
          "artifactId": "artifact-9",
          "sha256": "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08",
          "detectedMediaType": "image/png",
          "success": true
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "office_hours_evidence_ingested")
        #expect(event.workspaceRoot == "/repo")
        #expect(event.attemptId == "attempt-1")
        #expect(event.receiptToken == "rcpt_swift_upload_abc123")
        #expect(event.artifactId == "artifact-9")
        #expect(event.sha256 == "9f86d081884c7d659a2feaa0c55ad015a3bf4f1b2b0b822cd15d6c15b0f00a08")
        #expect(event.detectedMediaType == "image/png")
        #expect(event.success == true)
        #expect(event.error == nil)
    }

    // Failure shape: success: false + error, no receiptToken. The VM rejects the pending
    // continuation with .ingestFailed(error) instead of silently dropping the upload.
    @MainActor @Test func decodesOfficeHoursEvidenceIngestedFailure() throws {
        let payload = """
        {
          "type": "office_hours_evidence_ingested",
          "workspaceRoot": "/repo",
          "attemptId": "attempt-1",
          "success": false,
          "error": "decoded artifact is empty."
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "office_hours_evidence_ingested")
        #expect(event.workspaceRoot == "/repo")
        #expect(event.attemptId == "attempt-1")
        #expect(event.success == false)
        #expect(event.error == "decoded artifact is empty.")
        #expect(event.receiptToken == nil)
        #expect(event.detectedMediaType == nil)
    }

    @MainActor @Test func decodesOfficeHoursRuntimePromptSnapshots() throws {
        let payload = """
        {
          "type": "session_updated",
          "session": {
            "id": "session-1",
            "title": "Office Hours",
            "provider": "codex",
            "model": "",
            "status": "awaiting_input",
            "createdAt": "2026-06-11T00:00:00.000Z",
            "updatedAt": "2026-06-11T00:03:00.000Z",
            "error": null,
            "messages": [],
            "pendingUserInput": null,
            "runtime": {
              "officeHours": {
                "active": true,
                "source": "office_hours_screen",
                "startedAt": "2026-06-11T00:00:00.000Z",
                "context": "Expected question count: 6",
                "day": 1,
                "attemptId": "attempt-abc",
                "revision": 3,
                "nextAction": { "kind": "card", "cardType": "candidate_selection" },
                "gatherProgress": { "answered": 1, "total": 6 },
                "promptSnapshots": [
                  {
                    "sessionId": "session-1",
                    "requestId": "request-1",
                    "submittedAt": "2026-06-11T00:01:00.000Z",
                    "editable": true,
                    "turnSessionId": "old-session",
                    "prompt": {
                      "requestId": "request-1",
                      "sessionId": "session-1",
                      "toolName": "agentic30_request_user_input",
                      "title": "Office Hours",
                      "createdAt": "2026-06-11T00:00:30.000Z",
                      "questions": [
                        {
                          "questionId": "office_hours_target",
                          "header": "대상 사용자",
                          "question": "누구에게 먼저 물어볼까요?",
                          "options": [
                            { "label": "1인 개발자", "description": "혼자 제품을 만드는 사람" }
                          ],
                          "multiSelect": false,
                          "allowFreeText": true,
                          "requiresFreeText": false
                        }
                      ],
                      "generation": {
                        "mode": "office_hours_structured_input",
                        "signalId": "office_hours_target",
                        "signalLabel": "대상 사용자",
                        "dimensionStepIndex": 1,
                        "dimensionTotal": 6
                      }
                    },
                    "submissions": [
                      {
                        "question": "누구에게 먼저 물어볼까요?",
                        "selectedOptions": ["1인 개발자"],
                        "freeText": "macOS 앱 개발자"
                      }
                    ]
                  }
                ]
              }
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        let snapshot = try #require(event.session?.runtime?.officeHours?.promptSnapshots?.first)

        #expect(snapshot.requestId == "request-1")
        #expect(snapshot.prompt.questions.first?.question == "누구에게 먼저 물어볼까요?")
        #expect(snapshot.submissions.first?.selectedOptions == ["1인 개발자"])
        #expect(snapshot.submissions.first?.freeText == "macOS 앱 개발자")
        #expect(snapshot.editable == true)
        #expect(snapshot.turnSessionId == "old-session")
        // R1.b: the ValidationAttempt authority pointer + derived display fields.
        #expect(event.session?.runtime?.officeHours?.attemptId == "attempt-abc")
        #expect(event.session?.runtime?.officeHours?.revision == 3)
        #expect(event.session?.runtime?.officeHours?.nextAction?.kind == "card")
        #expect(event.session?.runtime?.officeHours?.nextAction?.cardType == "candidate_selection")
        #expect(event.session?.runtime?.officeHours?.gatherProgress?.answered == 1)
        #expect(event.session?.runtime?.officeHours?.gatherProgress?.total == 6)
    }

    @MainActor @Test func decodesOfficeHoursNextActionVariants() throws {
        func runtime(_ nextActionJSON: String) throws -> OfficeHoursRuntime? {
            let payload = """
            {
              "type": "session_updated",
              "session": {
                "id": "session-1",
                "title": "Office Hours",
                "provider": "codex",
                "model": "",
                "status": "idle",
                "createdAt": "2026-06-11T00:00:00.000Z",
                "updatedAt": "2026-06-11T00:03:00.000Z",
                "error": null,
                "messages": [],
                "pendingUserInput": null,
                "runtime": { "officeHours": { "active": true, "nextAction": \(nextActionJSON) } }
              }
            }
            """
            let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
            return event.session?.runtime?.officeHours
        }

        let wait = try runtime("{ \"kind\": \"wait\", \"reason\": \"action\" }")
        #expect(wait?.nextAction?.kind == "wait")
        #expect(wait?.nextAction?.waitReason == "action")

        let terminal = try runtime("{ \"kind\": \"terminal\", \"outcome\": \"succeeded\" }")
        #expect(terminal?.nextAction?.kind == "terminal")
        #expect(terminal?.nextAction?.outcome == "succeeded")

        let blocked = try runtime("{ \"kind\": \"blocked\", \"blocker\": { \"blockerReason\": \"needs auth\", \"nextUnblockAction\": \"connect\" } }")
        #expect(blocked?.nextAction?.kind == "blocked")
        #expect(blocked?.nextAction?.blocker?.blockerReason == "needs auth")
        #expect(blocked?.nextAction?.blocker?.nextUnblockAction == "connect")

        let carried = try runtime("{ \"kind\": \"carried\", \"carry\": { \"carryReason\": \"out of time\" } }")
        #expect(carried?.nextAction?.kind == "carried")
        #expect(carried?.nextAction?.carry?.carryReason == "out of time")
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
        #expect(event.errorKind == nil)
    }

    @MainActor @Test func decodesProviderUsageLimitErrorPayload() throws {
        let payload = """
        {
          "type": "error",
          "sessionId": "session-1",
          "message": "You've hit your usage limit. Your limit resets Jun 11 12:54 PM.",
          "errorKind": "provider_usage_limit",
          "recoverable": true
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "error")
        #expect(event.errorKind == "provider_usage_limit")
        #expect(event.sessionId == "session-1")
    }

    @MainActor @Test func decodesProviderAuthRequiredErrorPayload() throws {
        let payload = """
        {
          "type": "error",
          "sessionId": "session-1",
          "provider": "codex",
          "message": "Codex에 로그인하거나 CODEX_API_KEY / OPENAI_API_KEY를 설정하세요.",
          "errorKind": "provider_auth_required",
          "recoverable": true
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "error")
        #expect(event.errorKind == "provider_auth_required")
        #expect(event.provider == "codex")
        #expect(event.sessionId == "session-1")
    }

    @MainActor @Test func decodesProviderAbortedErrorPayload() throws {
        let payload = """
        {
          "type": "error",
          "sessionId": "session-1",
          "provider": "claude",
          "message": "Claude Code process aborted by user",
          "errorKind": "provider_aborted",
          "recoverable": true
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "error")
        #expect(event.errorKind == "provider_aborted")
        #expect(event.provider == "claude")
        #expect(event.sessionId == "session-1")
    }

    @MainActor @Test func decodesSidecarConnectionStateErrorPayload() throws {
        let payload = """
        {
          "type": "error",
          "message": "Sidecar is not connected.",
          "errorKind": "sidecar_connection_state"
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "error")
        #expect(event.message == "Sidecar is not connected.")
        #expect(event.errorKind == "sidecar_connection_state")
    }

    @MainActor @Test func decodesOfficeHoursSourceGatePayload() throws {
        let payload = """
        {
          "type": "office_hours_source_gate",
          "sessionId": "session-1",
          "day": 2,
          "status": "blocked",
          "officeHoursSourceGate": {
            "schemaVersion": 1,
            "day": 2,
            "ok": false,
            "blocking": true,
            "skipped": false,
            "reason": "no_live_sources",
            "message": "Day 2+ Office Hours를 시작하려면 source가 필요합니다.",
            "checkedAt": "2026-06-09T01:30:00.000Z",
            "selectedSources": ["posthog"],
            "sources": [
              {
                "id": "posthog",
                "label": "PostHog",
                "state": "missing",
                "available": false,
                "selected": true,
                "required": true,
                "detail": "PostHog MCP key is missing"
              }
            ],
            "missingRequiredSources": ["posthog"],
            "connectActions": [
              {
                "id": "connect_posthog",
                "source": "posthog",
                "label": "PostHog MCP 연결",
                "detail": "Settings > Integrations에 key를 저장합니다.",
                "settingsSection": "integrations"
              }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "office_hours_source_gate")
        #expect(event.officeHoursSourceGate?.blocking == true)
        #expect(event.officeHoursSourceGate?.selectedSources == ["posthog"])
        #expect(event.officeHoursSourceGate?.sources.first?.id == "posthog")
        #expect(event.officeHoursSourceGate?.connectActions.first?.settingsSection == "integrations")
    }

    @MainActor @Test func decodesOfficeHoursDailyDigestResultPayload() throws {
        let payload = """
        {
          "type": "office_hours_daily_digest_result",
          "sessionId": "session-1",
          "day": 2,
          "status": "ready",
          "detail": "Day 2+ Office Hours digest ready.",
          "officeHoursDailyDigest": {
            "schemaVersion": 1,
            "generatedAt": "2026-06-09T01:30:00.000Z",
            "day": 2,
            "window": {
              "startIso": "2026-06-07T15:00:00.000Z",
              "untilIso": "2026-06-09T01:30:00.000Z",
              "localStartDate": "2026-06-08",
              "localUntilDate": "2026-06-09",
              "label": "2026-06-08 00:00 -> 2026-06-09 now"
            },
            "sourceGate": { "ok": true, "reason": "ready", "selectedSources": ["posthog"] },
            "sources": [
              {
                "id": "posthog",
                "label": "PostHog",
                "state": "ready",
                "connectionState": "ready",
                "collectionState": "ready",
                "available": true,
                "selected": true,
                "required": true,
                "detail": "external MCP digest succeeded",
                "counts": { "activeUsers": 3 },
                "highlights": ["활성 사용자 3명"],
                "summary": "activation 3건",
                "goalSignals": ["가입은 늘지만 결제 0"],
                "evidenceGaps": ["pricing 이탈 원인 미관측"]
              }
            ],
            "buildWithoutCustomerEvidence": true,
            "briefing": {
              "goalStatus": ["30일 목표 유지"],
              "overnightChanges": ["git: 커밋 2건"],
              "goalHelpfulSignals": ["PostHog: 가입은 늘지만 결제 0"],
              "biggestEvidenceGap": ["PostHog: pricing 이탈 원인 미관측"]
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "office_hours_daily_digest_result")
        #expect(event.status == "ready")
        #expect(event.day == 2)
        let digest = try #require(event.officeHoursDailyDigest)
        #expect(digest.day == 2)
        #expect(digest.buildWithoutCustomerEvidence == true)
        #expect(digest.window?.localStartDate == "2026-06-08")
        #expect(digest.sources.first?.connectionState == "ready")
        #expect(digest.sources.first?.collectionState == "ready")
        #expect(digest.sources.first?.goalSignals == ["가입은 늘지만 결제 0"])
        #expect(digest.briefing?.biggestEvidenceGap == ["PostHog: pricing 이탈 원인 미관측"])
        #expect(digest.applies(to: 2))
        #expect(!digest.applies(to: 3))
    }

    @MainActor @Test func decodesOfficeHoursDailyDigestCollectingPayload() throws {
        let payload = """
        {
          "type": "office_hours_daily_digest_result",
          "sessionId": "session-1",
          "day": 2,
          "status": "collecting",
          "detail": "Day 2+ Office Hours digest collecting."
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "office_hours_daily_digest_result")
        #expect(event.status == "collecting")
        #expect(event.officeHoursDailyDigest == nil)
    }

    @MainActor @Test func decodesOfficeHoursCommitmentCandidatesReadyPayload() throws {
        let payload = """
        {
          "type": "office_hours_commitment_candidates",
          "sessionId": "session-1",
          "day": 6,
          "status": "ready",
          "candidates": ["조은성에게 5만원 결제요청 보내기", "박지민에게 데모 일정 묻기"]
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "office_hours_commitment_candidates")
        #expect(event.sessionId == "session-1")
        #expect(event.status == "ready")
        #expect(event.commitmentCandidates == ["조은성에게 5만원 결제요청 보내기", "박지민에게 데모 일정 묻기"])
    }

    @MainActor @Test func decodesOfficeHoursCommitmentCandidatesGeneratingPayload() throws {
        let payload = """
        {
          "type": "office_hours_commitment_candidates",
          "sessionId": "session-1",
          "day": 6,
          "status": "generating",
          "candidates": []
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.status == "generating")
        #expect(event.commitmentCandidates == [])
    }

    @MainActor @Test func decodesMorningBriefingResultPayload() throws {
        let payload = """
        {
          "type": "morning_briefing_result",
          "morningBriefing": {
            "schemaVersion": 1,
            "generatedAt": "2026-06-10T00:00:00.000Z",
            "day": 12,
            "totalDays": 30,
            "phase": "",
            "window": {
              "startIso": "2026-06-09T00:00:00.000Z",
              "untilIso": "2026-06-10T00:00:00.000Z",
              "label": "2026-06-09 00:00 -> 2026-06-10 now"
            },
            "summary": {
              "title": "밤사이 신호 요약",
              "windowLabel": "2026-06-09 00:00 -> 2026-06-10 now",
              "statement": "밤사이 가장 큰 변화는 PostHog 활성 사용자 ▼ 56% 하락이에요.",
              "crits": [
                { "source": "PostHog", "label": "활성 사용자", "value": "▼ 56%", "direction": "down" }
              ]
            },
            "customerEvidenceVerdict": {
              "state": "instrumentation_gap",
              "title": "빌드는 충분하지만 고객 행동 근거가 부족함.",
              "body": "오늘은 검증 행동 계측을 먼저 메웁니다.",
              "evidence": ["GitHub 커밋 55건", "PostHog 활성 1명 · 전환 0건"],
              "primaryActionId": "task",
              "verdictProvider": "codex",
              "verdictGeneratedAt": "2026-06-10T00:01:00.000Z",
              "contextRefs": ["onboarding", "day1_goal", "office_hours", "cloudflare", "github", "posthog"]
            },
            "evidenceFunnel": {
              "steps": [
                { "id": "traffic", "label": "방문", "source": "Cloudflare", "value": 261, "valueLabel": "261 명", "status": "observed", "detail": "기간 전체 고유 방문자 기준" },
                { "id": "validation_action", "label": "Office Hours/검증 행동", "source": "PostHog", "value": 0, "valueLabel": "0 명", "status": "missing", "detail": "검증 action 적용" }
              ]
            },
            "cards": [
              {
                "id": "posthog",
                "label": "PostHog",
                "subtitle": "활성 사용자 · 이벤트",
                "state": "ready",
                "metric": { "value": 11, "unit": "활성 사용자", "deltaLabel": "▼ 56%", "direction": "down", "versusLabel": "어제 25" },
                "rows": [{ "k": "이벤트", "v": "188" }],
                "spark": [22, 25, 11],
                "sparkPoints": [
                  { "value": 22, "timeLabel": "06-08 09:00", "at": "2026-06-08T00:00:00.000Z" },
                  { "value": 25, "timeLabel": "어제", "at": null },
                  { "value": 11, "timeLabel": "오늘 09:00", "at": "2026-06-10T00:00:00.000Z" }
                ],
                "note": "온보딩 2단계 이탈 원인 미확인",
                "noteTone": "warn",
                "highlights": ["활성 사용자 추이 하락"]
              }
            ],
            "timeline": [
              { "at": "2026-06-09T18:12:00.000Z", "timeLabel": "03:12", "source": "github", "text": "커밋 · feat: onboarding step trim" }
            ],
            "anomaly": {
              "id": "metric_drop_posthog",
              "kind": "metric_drop",
              "title": "PostHog 신호 하락",
              "question": "PostHog 활성 사용자가 어제 25 → 11로 떨어졌어요.",
              "evidence": "근거: PostHog 활성 사용자 ▼ 56%",
              "options": [
                { "id": "real_churn", "title": "실제 이탈이다", "detail": "오늘 바로 물어봅니다.", "tail": "메시지 + 실험" }
              ],
              "label": null,
              "labeledAt": null
            },
            "actions": [
              {
                "id": "task",
                "kind": "task",
                "badge": "태스크",
                "title": "오늘 빌드에 추가할 태스크",
                "subtitle": "증거 신뢰도부터 확보",
                "body": "",
                "why": "추적이 못 믿을 상태면 실험 결과도 못 믿어요.",
                "copyText": "PR #43 머지",
                "applyLabel": "오늘 태스크에 추가",
                "tasks": [{ "title": "PR #43 머지", "tag": "신뢰도" }]
              }
            ],
            "sync": {
              "sources": [
                { "id": "posthog", "label": "PostHog", "state": "ready", "selected": true, "detail": "external MCP digest succeeded" }
              ],
              "readyCount": 1,
              "syncedAt": "2026-06-10T00:00:00.000Z",
              "syncedAtLabel": "09:00"
            },
            "status": { "state": "ready", "detail": "소스 1개에서 밤사이 신호를 모았어요." },
            "historyDates": ["2026-06-09"],
            "connectGuide": {
              "title": "Day 2 브리핑 업그레이드",
              "detail": "Settings > Integrations에서 PostHog MCP · Cloudflare MCP를 연결하면 Day 2 브리핑부터 트래픽·리텐션 신호가 함께 도착해요.",
              "settingsSection": "integrations",
              "sources": [
                { "id": "posthog", "label": "PostHog MCP", "benefit": "리텐션 · 활성 사용자 신호" },
                { "id": "cloudflare", "label": "Cloudflare MCP", "benefit": "트래픽 · 방문 추이 신호" }
              ]
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "morning_briefing_result")
        let briefing = try #require(event.morningBriefing)
        #expect(briefing.day == 12)
        #expect(briefing.totalDays == 30)
        #expect(briefing.summary?.crits?.first?.direction == "down")
        #expect(briefing.customerEvidenceVerdict?.state == "instrumentation_gap")
        #expect(briefing.customerEvidenceVerdict?.primaryActionId == "task")
        #expect(briefing.customerEvidenceVerdict?.verdictProvider == "codex")
        #expect(briefing.customerEvidenceVerdict?.contextRefs?.contains("office_hours") == true)
        #expect(briefing.evidenceFunnel?.steps?.first?.id == "traffic")
        #expect(briefing.evidenceFunnel?.steps?.last?.status == "missing")
        let card = try #require(briefing.cards?.first)
        #expect(card.id == "posthog")
        #expect(card.isReady)
        #expect(card.metric?.deltaLabel == "▼ 56%")
        #expect(card.spark == [22, 25, 11])
        #expect(card.sparkPoints?.map(\.value) == [22, 25, 11])
        #expect(card.sparkPoints?.first?.timeLabel == "06-08 09:00")
        #expect(card.sparkPoints?.last?.at == "2026-06-10T00:00:00.000Z")
        #expect(briefing.timeline?.first?.timeLabel == "03:12")
        #expect(briefing.anomaly?.kind == "metric_drop")
        #expect(briefing.anomaly?.label == nil)
        #expect(briefing.actions?.first?.tasks?.first?.tag == "신뢰도")
        #expect(briefing.sync?.readyCount == 1)
        #expect(briefing.status?.state == "ready")
        #expect(briefing.historyDates == ["2026-06-09"])
        let guide = try #require(briefing.connectGuide)
        #expect(guide.settingsSection == "integrations")
        #expect(guide.sources?.map(\.id) == ["posthog", "cloudflare"])
        // Drilldown payload absent on older sidecars: decoders must fail soft.
        #expect(briefing.drilldowns == nil)
        #expect(briefing.historyEntries == nil)
    }

    @Test func morningBriefingVerdictRequiresTitleBodyAndEvidenceToRender() {
        let missingTitle = MorningBriefingCustomerEvidenceVerdict(
            state: "healthy",
            title: nil,
            body: "고객 행동 근거가 잡혔어요.",
            evidence: ["PostHog conversions 2 집계가 있습니다."],
            primaryActionId: "experiment",
            verdictProvider: "codex",
            verdictGeneratedAt: "2026-06-16T00:00:00.000Z",
            contextRefs: ["onboarding", "day1_goal", "office_hours", "cloudflare", "github", "posthog"]
        )
        let missingBody = MorningBriefingCustomerEvidenceVerdict(
            state: "healthy",
            title: "고객 행동 근거가 잡혔어요.",
            body: " ",
            evidence: ["PostHog conversions 2 집계가 있습니다."],
            primaryActionId: "experiment",
            verdictProvider: "codex",
            verdictGeneratedAt: "2026-06-16T00:00:00.000Z",
            contextRefs: ["onboarding", "day1_goal", "office_hours", "cloudflare", "github", "posthog"]
        )
        let missingEvidence = MorningBriefingCustomerEvidenceVerdict(
            state: "healthy",
            title: "고객 행동 근거가 잡혔어요.",
            body: "오늘은 다음 공백을 좁히면 됩니다.",
            evidence: ["  "],
            primaryActionId: "experiment",
            verdictProvider: "codex",
            verdictGeneratedAt: "2026-06-16T00:00:00.000Z",
            contextRefs: ["onboarding", "day1_goal", "office_hours", "cloudflare", "github", "posthog"]
        )
        let valid = MorningBriefingCustomerEvidenceVerdict(
            state: "healthy",
            title: "고객 행동 근거가 잡혔어요.",
            body: "오늘은 다음 공백을 좁히면 됩니다.",
            evidence: [" PostHog conversions 2 집계가 있습니다. "],
            primaryActionId: "experiment",
            verdictProvider: "codex",
            verdictGeneratedAt: "2026-06-16T00:00:00.000Z",
            contextRefs: ["onboarding", "day1_goal", "office_hours", "cloudflare", "github", "posthog"]
        )

        #expect(missingTitle.isRenderable == false)
        #expect(missingBody.isRenderable == false)
        #expect(missingEvidence.isRenderable == false)
        #expect(valid.isRenderable == true)
        #expect(valid.renderableEvidence == ["PostHog conversions 2 집계가 있습니다."])
    }

    @MainActor @Test func decodesMorningBriefingDrilldownPayload() throws {
        let payload = """
        {
          "type": "morning_briefing_result",
          "morningBriefing": {
            "schemaVersion": 1,
            "generatedAt": "2026-06-10T00:00:00.000Z",
            "day": 12,
            "summary": {
              "statement": "밤사이 가장 큰 변화는 PostHog 리텐션 ▼ 14p 하락이에요. Cloudflare 방문은 ▲ 56% 늘었어요.",
              "statementMarks": ["PostHog 리텐션 ▼ 14p 하락"],
              "statementEmphases": ["Cloudflare 방문은 ▲ 56%"]
            },
            "historyEntries": [
              { "date": "2026-06-09", "day": 11, "title": "배포 후 첫 유입." }
            ],
            "drilldowns": {
              "github": {
                "id": "github",
                "title": "GitHub · 빌드·배포 · 레포 신호",
                "subtitle": "agentic30-public · main",
                "syncPills": ["지난 24시간 커밋 9 · PR 머지 2"],
                "kpis": [
                  { "label": "커밋", "valueLabel": "9", "deltaLabel": "▲ 3", "direction": "up", "vsLabel": "어제 6" },
                  { "label": "방문 → 가입", "valueLabel": "9%", "deltaLabel": "▼ 4p", "direction": "down", "vsLabel": "어제 13%", "flag": true }
                ],
                "kpisMeta": "main 브랜치 기준",
                "chart": {
                  "kind": "bars",
                  "title": "커밋, 지난 24시간",
                  "bars": [
                    { "label": "00", "value": 2, "ratio": 1, "tone": "accent", "tip": "00–03 · 2 커밋" },
                    { "label": "03", "value": 1, "ratio": 0.5, "tone": "violet", "tip": "배포 03:12" }
                  ],
                  "legend": [{ "label": "커밋", "tone": "accent" }],
                  "footnote": "03:12 배포 포함"
                },
                "table": [
                  { "rank": 1, "code": "/landing", "label": "랜딩", "valueLabel": "132", "share": 70, "ratio": 1 }
                ],
                "listRows": [
                  { "kind": "merged", "title": "#41 온보딩 단계 축소", "metaItems": ["머지 02:58", "+120"], "tag": "merged" }
                ],
                "listMeta": "머지 2 · 오픈 1",
                "scan": [
                  { "title": "이슈", "cmd": "gh issue list", "valueLabel": "열린 2", "sub": "#44 · 50분 전", "tone": "sky", "quiet": false }
                ],
                "funnel": {
                  "steps": [
                    { "label": "랜딩 방문", "valueLabel": "64", "ratio": 1, "drop": false },
                    { "label": "가입", "valueLabel": "6", "ratio": 0.46, "drop": true }
                  ],
                  "gapAfterIndex": 0,
                  "gapLabel": "가입 → 연결에서 67% 이탈"
                },
                "signals": [{ "time": "02:10", "text": "단일 IP 9요청 — 봇으로 분류" }],
                "webSignals": [{ "time": "유입 1위", "text": "/blog/paddle-guide 76뷰 — 39%" }],
                "webMeta": "최근 2주 · 경로 분해",
                "drafts": [
                  {
                    "id": "github_draft_1",
                    "kind": "task",
                    "badge": "태스크",
                    "title": "flaky 테스트 격리",
                    "subtitle": "gh run list",
                    "body": "success 17 · failure 3",
                    "why": "재실행 습관이 굳기 전에 잡아야 해요.",
                    "copyText": "success 17 · failure 3",
                    "applyLabel": "맡기기",
                    "tasks": []
                  }
                ],
                "draftsEmpty": { "title": "코드 신호는 충분해요 — 고객 증거로 이동", "detail": "신호 없음", "evidence": "근거: gh CLI" },
                "maintenance": [
                  {
                    "id": "github_keep_readme",
                    "kind": "message",
                    "badge": "문서",
                    "title": "README 최신화",
                    "subtitle": "10일 전",
                    "body": "10 days ago",
                    "why": "첫인상",
                    "copyText": "10 days ago",
                    "applyLabel": "초안 PR 맡기기",
                    "tasks": []
                  }
                ],
                "meta": {
                  "progress": { "label": "main 배포", "valueLabel": "1 · 성공", "sub": "롤백 0", "ratio": 1 },
                  "rows": [{ "key": "리포", "value": "agentic30-public", "tone": "muted" }]
                }
              }
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        let briefing = try #require(event.morningBriefing)
        #expect(briefing.summary?.statementMarks == ["PostHog 리텐션 ▼ 14p 하락"])
        #expect(briefing.summary?.statementEmphases == ["Cloudflare 방문은 ▲ 56%"])
        let entry = try #require(briefing.historyEntries?.first)
        #expect(entry.date == "2026-06-09")
        #expect(entry.day == 11)
        #expect(entry.title == "배포 후 첫 유입.")

        let drilldown = try #require(briefing.drilldowns?["github"])
        #expect(drilldown.id == "github")
        #expect(drilldown.title == "GitHub · 빌드·배포 · 레포 신호")
        #expect(drilldown.syncPills?.count == 1)
        #expect(drilldown.kpis?.count == 2)
        #expect(drilldown.kpis?.last?.flag == true)
        #expect(drilldown.kpisMeta == "main 브랜치 기준")
        #expect(drilldown.chart?.kind == "bars")
        #expect(drilldown.chart?.bars?.last?.tone == "violet")
        #expect(drilldown.table?.first?.share == 70)
        #expect(drilldown.listRows?.first?.kind == "merged")
        #expect(drilldown.scan?.first?.cmd == "gh issue list")
        #expect(drilldown.funnel?.steps?.last?.drop == true)
        #expect(drilldown.funnel?.gapAfterIndex == 0)
        #expect(drilldown.signals?.first?.time == "02:10")
        #expect(drilldown.webSignals?.first?.time == "유입 1위")
        #expect(drilldown.webMeta == "최근 2주 · 경로 분해")
        #expect(drilldown.drafts?.first?.id == "github_draft_1")
        #expect(drilldown.draftsEmpty?.title == "코드 신호는 충분해요 — 고객 증거로 이동")
        #expect(drilldown.maintenance?.first?.badge == "문서")
        #expect(drilldown.meta?.progress?.ratio == 1)
        #expect(drilldown.meta?.rows?.first?.key == "리포")
    }

    @MainActor @Test func decodesMorningBriefingDrilldownPointMetadata() throws {
        let payload = """
        {
          "type": "morning_briefing_result",
          "morningBriefing": {
            "schemaVersion": 1,
            "generatedAt": "2026-06-10T00:00:00.000Z",
            "day": 12,
            "drilldowns": {
              "posthog": {
                "id": "posthog",
                "title": "PostHog · 리텐션·이탈 드릴다운",
                "kpis": [{ "label": "Day-1", "valueLabel": "11.1%" }],
                "chart": {
                  "kind": "curve",
                  "title": "Day-1 리텐션",
                  "points": [
                    {
                      "label": "06-08 · 21.4%",
                      "pct": 21.4,
                      "date": "2026-06-08",
                      "cohortSize": 14,
                      "returned": 3,
                      "tip": "2026-06-08 코호트 n=14 · 3/14 복귀"
                    },
                    {
                      "label": "06-09 · 11.1%",
                      "pct": 11.1,
                      "date": "2026-06-09",
                      "cohortSize": 9,
                      "returned": 1,
                      "tip": "2026-06-09 코호트 n=9 · 1/9 복귀"
                    }
                  ]
                }
              }
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        let point = try #require(event.morningBriefing?.drilldowns?["posthog"]?.chart?.points?.last)
        #expect(point.label == "06-09 · 11.1%")
        #expect(point.date == "2026-06-09")
        #expect(point.cohortSize == 9)
        #expect(point.returned == 1)
        #expect(point.tip == "2026-06-09 코호트 n=9 · 1/9 복귀")
    }

    @MainActor @Test func decodesIntegrationStatusResultPayload() throws {
        let payload = """
        {
          "type": "integration_status_result",
          "integrationStatus": {
            "github": { "state": "ready", "detail": "gh auth status 통과" },
            "githubMcp": { "state": "ready", "detail": "gh 토큰으로 GitHub MCP 연결됨" },
            "posthog": { "state": "failed", "detail": "PostHog API 검증 실패 (HTTP 401)" },
            "cloudflare": { "state": "missing", "detail": "API 토큰을 저장하면 활성화돼요." },
            "vercel": { "state": "oauth", "detail": "MCP는 OAuth로 동작" },
            "exa": { "state": "ready", "detail": "Exa MCP route configured" },
            "checkedAt": "2026-06-10T09:00:00.000Z"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "integration_status_result")
        let status = try #require(event.integrationStatus)
        #expect(status.github?.isReady == true)
        #expect(status.githubMcp?.isReady == true)
        #expect(status.posthog?.state == "failed")
        #expect(status.posthog?.isReady == false)
        #expect(status.cloudflare?.isMissing == true)
        #expect(status.vercel?.isOauthDelegated == true)
        #expect(status.exa?.isReady == true)
        #expect(status.checkedAt == "2026-06-10T09:00:00.000Z")
    }

    @MainActor @Test func decodesExaMcpConnectResultPayload() throws {
        let payload = """
        {
          "type": "exa_mcp_connect_result",
          "exaMcpConnect": {
            "provider": "cursor",
            "state": "ready",
            "detail": "Cursor Exa MCP config saved.",
            "changed": true,
            "configPath": "/Users/test/.cursor/mcp.json",
            "backupPath": null,
            "validationTool": "web_search_exa",
            "checkedAt": "2026-06-14T00:00:00.000Z",
            "route": {
              "provider": "cursor",
              "source": "api_key",
              "label": "Exa Search (EXA_API_KEY)",
              "serverName": "exa",
              "configPath": null,
              "transport": "http",
              "urlHost": "mcp.exa.ai",
              "command": "",
              "hasHeaders": true,
              "hasEnv": false
            }
          },
          "integrationStatus": {
            "exa": { "state": "ready", "detail": "Exa MCP route configured" },
            "checkedAt": "2026-06-14T00:00:00.000Z"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "exa_mcp_connect_result")
        let result = try #require(event.exaMcpConnect)
        #expect(result.provider == "cursor")
        #expect(result.isReady == true)
        #expect(result.changed == true)
        #expect(result.validationTool == "web_search_exa")
        #expect(result.route?.urlHost == "mcp.exa.ai")
        #expect(result.route?.hasHeaders == true)
        #expect(event.integrationStatus?.exa?.isReady == true)
    }

    @MainActor @Test func decodesMcpOauthConnectResultPayload() throws {
        let payload = """
        {
          "type": "mcp_oauth_connect_result",
          "mcpOauthConnect": {
            "server": "posthog",
            "provider": "claude",
            "state": "ready",
            "detail": "PostHog MCP 도구 호출 검증됨 — AI 실행에서 바로 사용 가능해요.",
            "checkedAt": "2026-06-10T09:30:00.000Z"
          },
          "integrationStatus": {
            "posthog": { "state": "oauth", "detail": "MCP는 OAuth로 동작" },
            "checkedAt": "2026-06-10T09:30:00.000Z"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "mcp_oauth_connect_result")
        let result = try #require(event.mcpOauthConnect)
        #expect(result.server == "posthog")
        #expect(result.provider == "claude")
        #expect(result.isReady == true)
        #expect(result.detail?.contains("검증됨") == true)
        #expect(result.checkedAt == "2026-06-10T09:30:00.000Z")
        #expect(event.integrationStatus?.posthog?.isOauthDelegated == true)
    }

    @MainActor @Test func decodesMcpOauthConnectFailurePayload() throws {
        let payload = """
        {
          "type": "mcp_oauth_connect_result",
          "mcpOauthConnect": {
            "server": "cloudflare",
            "provider": "codex",
            "state": "failed",
            "detail": "Cloudflare MCP 연결 확인이 시간 초과됐어요 — 브라우저 로그인 후 다시 시도해 주세요.",
            "checkedAt": "2026-06-10T09:31:00.000Z"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        let result = try #require(event.mcpOauthConnect)
        #expect(result.server == "cloudflare")
        #expect(result.isReady == false)
        #expect(result.isLoginPending == false)
        #expect(result.state == "failed")
        #expect(event.integrationStatus == nil)
    }

    @MainActor @Test func decodesMcpOauthConnectLoginPendingPayload() throws {
        let payload = """
        {
          "type": "mcp_oauth_connect_result",
          "mcpOauthConnect": {
            "server": "posthog",
            "provider": "claude",
            "state": "login_pending",
            "detail": "PostHog 브라우저 로그인이 필요해요 — 로그인 완료 후 'MCP 연결'을 다시 눌러 검증해 주세요.",
            "loginUrl": "https://oauth.posthog.com/oauth/authorize/?state=xyz",
            "checkedAt": "2026-06-10T09:32:00.000Z"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        let result = try #require(event.mcpOauthConnect)
        #expect(result.isLoginPending == true)
        #expect(result.isReady == false)
        #expect(result.loginUrl == "https://oauth.posthog.com/oauth/authorize/?state=xyz")
    }

    @MainActor @Test func decodesMcpOauthConnectVerificationPendingPayload() throws {
        let payload = """
        {
          "type": "mcp_oauth_connect_result",
          "mcpOauthConnect": {
            "server": "posthog",
            "provider": "codex",
            "state": "verification_pending",
            "detail": "PostHog 브라우저 로그인은 시작됐고 Codex 설정도 확인됐지만 MCP 도구 호출 검증이 시간 초과됐어요.",
            "loginUrl": "https://oauth.posthog.com/oauth/authorize/?state=xyz",
            "checkedAt": "2026-06-10T09:33:00.000Z"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        let result = try #require(event.mcpOauthConnect)
        #expect(result.isVerificationPending == true)
        #expect(result.isPending == true)
        #expect(result.isLoginPending == false)
        #expect(result.isReady == false)
    }

    @MainActor @Test func decodesMcpOauthConnectCancelledPayload() throws {
        let payload = """
        {
          "type": "mcp_oauth_connect_result",
          "mcpOauthConnect": {
            "server": "vercel",
            "provider": "codex",
            "state": "cancelled",
            "detail": "MCP 연결 확인을 중지했습니다. 다시 시도하세요.",
            "checkedAt": "2026-06-10T09:34:00.000Z"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        let result = try #require(event.mcpOauthConnect)
        #expect(result.server == "vercel")
        #expect(result.isCancelled == true)
        #expect(result.isPending == false)
        #expect(result.isReady == false)
    }

    @MainActor @Test func decodesMcpOauthConnectStatusProgressPayload() throws {
        let payload = """
        {
          "type": "mcp_oauth_connect_status",
          "mcpOauthConnect": {
            "server": "posthog",
            "provider": "claude",
            "state": "progress",
            "detail": "브라우저에서 OAuth 로그인을 완료해 주세요.",
            "loginUrl": "https://oauth.posthog.com/oauth/authorize/?state=abc"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "mcp_oauth_connect_status")
        let update = try #require(event.mcpOauthConnect)
        #expect(update.state == "progress")
        #expect(update.detail?.contains("로그인") == true)
        #expect(update.loginUrl == "https://oauth.posthog.com/oauth/authorize/?state=abc")
    }

    @MainActor @Test func decodesMcpOauthConnectStatusOpenBrowserFalsePayload() throws {
        let payload = """
        {
          "type": "mcp_oauth_connect_status",
          "mcpOauthConnect": {
            "server": "cloudflare",
            "provider": "codex",
            "state": "progress",
            "detail": "브라우저가 열렸어요.",
            "loginUrl": "https://mcp.cloudflare.com/authorize?response_type=code&client_id=abc",
            "openBrowser": false
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        let update = try #require(event.mcpOauthConnect)
        #expect(update.server == "cloudflare")
        #expect(update.provider == "codex")
        #expect(update.loginUrl == "https://mcp.cloudflare.com/authorize?response_type=code&client_id=abc")
        #expect(update.openBrowser == false)
    }

    @MainActor @Test func decodesPostHogMcpOauthConnectStatusOpenBrowserFalsePayload() throws {
        let payload = """
        {
          "type": "mcp_oauth_connect_status",
          "mcpOauthConnect": {
            "server": "posthog",
            "provider": "codex",
            "state": "progress",
            "detail": "브라우저가 열렸어요.",
            "loginUrl": "https://oauth.posthog.com/authorize?response_type=code&client_id=abc",
            "openBrowser": false
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        let update = try #require(event.mcpOauthConnect)
        #expect(update.server == "posthog")
        #expect(update.provider == "codex")
        #expect(update.loginUrl == "https://oauth.posthog.com/authorize?response_type=code&client_id=abc")
        #expect(update.openBrowser == false)
    }

    @MainActor @Test func decodesMorningBriefingCollectingStatusPayload() throws {
        let payload = """
        {
          "type": "morning_briefing_status",
          "status": { "state": "collecting", "reason": "tab_enter", "elapsedMs": 1700 }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "morning_briefing_status")
        #expect(event.morningBriefing == nil)
        #expect(event.morningBriefingStatus?.state == "collecting")
        #expect(event.morningBriefingStatus?.elapsedMs == 1700)
    }

    @MainActor @Test func cachedMorningBriefingResultKeepsCollectionProgressAlive() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        let collectingPayload = """
        {
          "type": "morning_briefing_status",
          "status": { "state": "collecting", "reason": "manual", "runId": "run-1", "elapsedMs": 1200 }
        }
        """
        let progressPayload = """
        {
          "type": "morning_briefing_progress",
          "morningBriefingProgress": {
            "cards": [
              { "id": "github", "state": "collecting", "detail": "git · gh CLI 신호 수집 중" }
            ]
          }
        }
        """
        let cachedPayload = """
        {
          "type": "morning_briefing_result",
          "status": { "state": "collecting", "snapshot": true, "reason": "refresh_in_flight", "runId": "run-1", "elapsedMs": 2400 },
          "morningBriefing": {
            "schemaVersion": 2,
            "generatedAt": "2026-06-14T10:21:41.391Z",
            "day": 3,
            "totalDays": 30,
            "summary": { "title": "밤사이 신호 요약" },
            "sync": {
              "sources": [
                { "id": "github", "label": "GitHub", "state": "ready", "selected": true, "detail": "cached" }
              ],
              "readyCount": 1,
              "syncedAt": "2026-06-14T10:21:41.391Z",
              "syncedAtLabel": "19:21"
            },
            "status": { "state": "ready", "detail": "old success" }
          }
        }
        """

        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(collectingPayload.utf8)))
        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(progressPayload.utf8)))
        #expect(viewModel.morningBriefingCollecting)
        #expect(viewModel.morningBriefingSourceProgress["github"]?.state == "collecting")

        let event = try decoder.decode(SidecarEvent.self, from: Data(cachedPayload.utf8))
        #expect(event.morningBriefingStatus?.snapshot == true)
        #expect(event.morningBriefingStatus?.reason == "refresh_in_flight")
        #expect(event.morningBriefingStatus?.runId == "run-1")
        viewModel.applySidecarEventForTesting(event)

        #expect(viewModel.morningBriefing?.sync?.syncedAtLabel == "19:21")
        #expect(viewModel.morningBriefingCollecting)
        #expect(viewModel.morningBriefingStatus?.elapsedMs == 2400)
        #expect(viewModel.morningBriefing?.status?.elapsedMs == 2400)
        #expect(viewModel.morningBriefingSourceProgress["github"]?.state == "collecting")
    }

    @MainActor @Test func morningBriefingResultTopLevelFailureMarksStaleBriefingFailed() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        let collectingPayload = """
        {
          "type": "morning_briefing_status",
          "status": { "state": "collecting", "reason": "manual" }
        }
        """
        let failedPayload = """
        {
          "type": "morning_briefing_result",
          "status": { "state": "failed", "detail": "브리핑 수집 실패 - 이전 브리핑 표시 중", "elapsedMs": 4200, "durationMs": 4200 },
          "morningBriefing": {
            "schemaVersion": 2,
            "generatedAt": "2026-06-14T10:21:41.391Z",
            "day": 1,
            "totalDays": 30,
            "summary": { "title": "old ready briefing" },
            "sync": {
              "readyCount": 1,
              "syncedAt": "2026-06-14T10:21:41.391Z",
              "syncedAtLabel": "19:21"
            },
            "status": { "state": "ready", "detail": "old success" }
          }
        }
        """

        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(collectingPayload.utf8)))
        #expect(viewModel.morningBriefingCollecting)

        let event = try decoder.decode(SidecarEvent.self, from: Data(failedPayload.utf8))
        #expect(event.morningBriefingStatus?.state == "failed")
        viewModel.applySidecarEventForTesting(event)

        #expect(viewModel.morningBriefingCollecting == false)
        #expect(viewModel.morningBriefing?.status?.state == "failed")
        #expect(viewModel.morningBriefing?.status?.detail == "브리핑 수집 실패 - 이전 브리핑 표시 중")
        #expect(viewModel.morningBriefing?.status?.durationMs == 4200)
        #expect(viewModel.morningBriefing?.sync?.syncedAtLabel == "19:21")
    }

    @MainActor @Test func morningBriefingFailedStatusMarksExistingBriefingStale() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        let readyPayload = """
        {
          "type": "morning_briefing_result",
          "morningBriefing": {
            "schemaVersion": 2,
            "generatedAt": "2026-06-14T10:21:41.391Z",
            "day": 1,
            "totalDays": 30,
            "summary": { "title": "old ready briefing" },
            "sync": {
              "readyCount": 1,
              "syncedAt": "2026-06-14T10:21:41.391Z",
              "syncedAtLabel": "19:21"
            },
            "status": { "state": "ready", "detail": "old success" }
          }
        }
        """
        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(readyPayload.utf8)))

        let failedPayload = """
        {
          "type": "morning_briefing_status",
          "status": { "state": "failed", "detail": "새 스냅샷을 만들지 못했습니다." }
        }
        """
        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(failedPayload.utf8)))

        #expect(viewModel.morningBriefingCollecting == false)
        #expect(viewModel.morningBriefing?.status?.state == "failed")
        #expect(viewModel.morningBriefing?.status?.detail == "새 스냅샷을 만들지 못했습니다.")
    }

    @MainActor @Test func decodesMorningBriefingProgressPayload() throws {
        let payload = """
        {
          "type": "morning_briefing_progress",
          "morningBriefingProgress": {
            "at": "2026-06-11T00:00:03.000Z",
            "cards": [
              {
                "id": "cloudflare",
                "state": "collecting",
                "detail": "Cloudflare MCP digest 수집 중",
                "logLines": ["09:00:01 MCP 도구 검색", "09:00:02 Cloudflare GraphQL Analytics 조회"]
              },
              { "id": "github", "state": "done", "detail": "수집 완료", "logLines": [] }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "morning_briefing_progress")
        let progress = try #require(event.morningBriefingProgress)
        let cards = try #require(progress.cards)
        #expect(cards.count == 2)
        let cloudflare = try #require(cards.first(where: { $0.id == "cloudflare" }))
        #expect(cloudflare.isCollecting)
        #expect(cloudflare.detail == "Cloudflare MCP digest 수집 중")
        #expect(cloudflare.logLines?.count == 2)
        let github = try #require(cards.first(where: { $0.id == "github" }))
        #expect(github.isCollecting == false)
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
        #expect(event.session?.pendingUserInput?.title == "Ideal Customer Profile 1/4")
        #expect(event.session?.pendingUserInput?.intro?.title == "Ideal Customer Profile")
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

    @MainActor @Test func decodesDay1HandoffClarityStructuredPromptPayload() throws {
        let payload = """
        {
          "type": "session_updated",
          "session": {
            "id": "office-hours-session",
            "title": "Office Hours · Day 1",
            "provider": "codex",
            "model": "gpt-5.1-codex-mini",
            "status": "awaiting_input",
            "createdAt": "2026-06-27T00:00:00.000Z",
            "updatedAt": "2026-06-27T00:00:00.000Z",
            "messages": [],
            "pendingUserInput": {
              "requestId": "request-clarity-1",
              "sessionId": "office-hours-session",
              "toolName": "agentic30_request_user_input",
              "title": "Office Hours 구체화",
              "createdAt": "2026-06-27T00:00:00.000Z",
              "questions": [
                {
                  "questionId": "day1_clarity_candidate_or_channel",
                  "header": "첫 후보",
                  "question": "오늘 실제로 연락할 수 있는 첫 후보의 이름·핸들·소속 채널 중 하나를 적어주세요.",
                  "helperText": "세그먼트 설명이 아니라 지금 접근 가능한 한 사람이나 한 채널이어야 합니다.",
                  "options": [
                    {
                      "label": "지금 답하기",
                      "description": "아래 입력칸에 오늘 실행 가능한 한 문장으로 적습니다.",
                      "nextIntent": "answer_candidate_or_channel"
                    }
                  ],
                  "multiSelect": false,
                  "allowFreeText": true,
                  "requiresFreeText": false,
                  "freeTextPlaceholder": "예: Threads @solo_maker에게 오늘 18시 DM",
                  "textMode": "short"
                }
              ],
              "generation": {
                "mode": "office_hours",
                "docType": "day1_handoff_clarity",
                "signalId": "day1_clarity_candidate_or_channel",
                "signalLabel": "후보/채널",
                "dimensionTotal": 5
              }
            },
            "runtime": {
              "officeHours": {
                "active": true,
                "source": "day1_handoff_clarity",
                "day": 1
              }
            }
          }
        }
        """.data(using: .utf8)!

        let event = try decoder.decode(SidecarEvent.self, from: payload)

        #expect(event.type == "session_updated")
        #expect(event.session?.pendingUserInput?.toolName == "agentic30_request_user_input")
        #expect(event.session?.pendingUserInput?.generation?.mode == "office_hours")
        #expect(event.session?.pendingUserInput?.generation?.docType == "day1_handoff_clarity")
        #expect(event.session?.pendingUserInput?.generation?.signalId == "day1_clarity_candidate_or_channel")
        #expect(event.session?.pendingUserInput?.generation?.signalLabel == "후보/채널")
        #expect(event.session?.pendingUserInput?.questions.first?.allowFreeText == true)
        #expect(event.session?.pendingUserInput?.questions.first?.requiresFreeText == false)
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
          "icp": ".agentic30/docs/ICP.md",
          "spec": ".agentic30/docs/SPEC.md",
          "values": ".agentic30/docs/VALUES.md",
          "designSystem": null,
          "adr": "docs/adr",
          "goal": ".agentic30/docs/GOAL.md",
          "agentic30Gitignore": {
            "scanRoot": "/Users/october/prj/myapp",
            "status": "needs-consent",
            "path": "/Users/october/prj/myapp/.gitignore",
            "entry": ".agentic30/",
            "error": null
          },
          "day1GoalSelection": {
            "schemaVersion": 1,
            "schema": "agentic30.day1_goal.v1",
            "goalType": "make_money",
            "goalText": "SupportLens가 유료 support lead 후보 1명을 검증한다",
            "customer": "B2B SaaS support lead",
            "problem": "Slack escalation을 놓침",
            "validationAction": "유료 파일럿 ask",
            "evidenceRefs": ["README.md", ".agentic30/docs/ICP.md"],
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
        #expect(event.icp == ".agentic30/docs/ICP.md")
        #expect(event.spec == ".agentic30/docs/SPEC.md")
        #expect(event.values == ".agentic30/docs/VALUES.md")
        #expect(event.designSystem == nil)
        #expect(event.adr == "docs/adr")
        #expect(event.goal == ".agentic30/docs/GOAL.md")
        #expect(event.agentic30Gitignore?.needsConsent == true)
        #expect(event.agentic30Gitignore?.path == "/Users/october/prj/myapp/.gitignore")
        #expect(event.agentic30Gitignore?.entry == ".agentic30/")
        #expect(event.day1GoalSelection?.goalType == .makeMoney)
        #expect(event.day1GoalSelection?.proofSink == .bipOptional)
        #expect(event.day1GoalSelection?.customer == "B2B SaaS support lead")
        #expect(event.day1GoalSelection?.evidenceRefs == ["README.md", ".agentic30/docs/ICP.md"])
        #expect(event.onboardingHypothesis?.confidence == "high")
        #expect(event.onboardingHypothesis?.productName == "Agentic30")
        #expect(event.onboardingHypothesis?.targetUser?.contains("전업 1인 개발자") == true)
        #expect(event.onboardingHypothesis?.likelyUsers?.first == "AI 코딩 도구를 쓰는 개발자")
        #expect(event.error == nil)
        // Normal (non-degraded) scan: the additive degraded markers stay absent.
        #expect(event.degraded == nil)
        #expect(event.degradedReason == nil)
        #expect(event.degradedProvider == nil)
        #expect(event.scanBlockedNotice == nil)
    }

    @MainActor @Test func decodesDegradedWorkspaceScanResult() throws {
        let payload = """
        {
          "type": "workspace_scan_result",
          "scanRoot": "/Users/october/prj/myapp",
          "icp": ".agentic30/docs/ICP.md",
          "foundCount": 2,
          "degraded": true,
          "degradedReason": "unavailable",
          "degradedProvider": "codex",
          "scanBlockedNotice": {
            "scanRoot": "/Users/october/prj/myapp",
            "provider": "codex",
            "model": "",
            "reason": "unavailable",
            "message": "AI 정밀 스캔을 적용하지 못했습니다.",
            "nextProvider": "claude",
            "availableProviders": ["claude"],
            "providerReadiness": [
              {
                "provider": "codex",
                "sdkInstalled": true,
                "authenticated": false,
                "scanReady": false,
                "source": "none",
                "message": "",
                "sdkMessage": "",
                "authAction": "codex_login"
              }
            ],
            "errorKind": "provider_auth_required"
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_scan_result")
        #expect(event.icp == ".agentic30/docs/ICP.md")
        #expect(event.foundCount == 2)
        #expect(event.degraded == true)
        #expect(event.degradedReason == "unavailable")
        #expect(event.degradedProvider == "codex")
        #expect(event.error == nil)
        let notice = try #require(event.scanBlockedNotice)
        #expect(notice.provider == "codex")
        #expect(notice.reason == "unavailable")
        #expect(notice.nextProvider == "claude")
        #expect(notice.availableProviders == ["claude"])
        #expect(notice.errorKind == "provider_auth_required")
        #expect(notice.providerReadiness?.first?.provider == .codex)
        #expect(notice.providerReadiness?.first?.authAction == "codex_login")
    }

    @MainActor @Test func decodesWorkspaceGitignoreResult() throws {
        let payload = """
        {
          "type": "workspace_gitignore_result",
          "scanRoot": "/Users/october/prj/myapp",
          "status": "declined",
          "path": "/Users/october/prj/myapp/.gitignore",
          "entry": ".agentic30/",
          "error": null
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_gitignore_result")
        #expect(event.agentic30Gitignore?.status == "declined")
        #expect(event.agentic30Gitignore?.scanRoot == "/Users/october/prj/myapp")
        #expect(event.agentic30Gitignore?.path == "/Users/october/prj/myapp/.gitignore")
        #expect(event.agentic30Gitignore?.entry == ".agentic30/")
    }

    @MainActor @Test func decodesDayProgressState() throws {
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "currentDay": 7,
          "dayProgress": {
            "schemaVersion": 1,
            "schema": "agentic30.day_progress.v1",
            "challengeStartedAt": "2026-06-01",
            "days": {
              "7": {
                "day": 7,
                "kind": "standard",
                "steps": {
                  "scan": "done", "retro": "done", "goal": "done",
                  "interview": "active", "execution": "pending"
                },
                "goalText": "Go/No-Go 결정하기",
                "updatedAt": "2026-06-07T03:00:00.000Z"
              },
              "1": {
                "day": 1,
                "kind": "day1",
                "steps": {
                  "onboarding": "done", "scan": "done", "goal": "done", "first_interview": "done"
                },
                "goalText": "먼저 도울 사람 정하기",
                "updatedAt": "2026-06-01T10:00:00.000Z"
              }
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "day_progress_state")
        #expect(event.dayProgress?.challengeStartedAt == "2026-06-01")

        let day7 = event.dayProgress?.record(forDay: 7)
        #expect(day7?.kind == .standard)
        #expect(day7?.steps["interview"] == .active)
        #expect(day7?.orderedSteps.count == 5)
        #expect(day7?.orderedSteps.first?.id == "scan")
        #expect(day7?.completedCount == 3)
        #expect(day7?.goalText == "Go/No-Go 결정하기")

        let day1 = event.dayProgress?.record(forDay: 1)
        #expect(day1?.kind == .day1)
        #expect(day1?.orderedSteps.count == 4)
        #expect(day1?.orderedSteps.last?.id == "first_interview")
        #expect(day1?.isComplete == true)

        #expect(day1?.displaySteps.map({ $0.id }) == ["goal", "first_interview"])
        #expect(day1?.displayTotalCount == 2)
        #expect(day1?.displayCompletedCount == 2)
        #expect(day1?.isDisplayComplete == true)
        #expect(day7?.displaySteps.map({ $0.id }) == ["interview", "execution"])
        #expect(day7?.displayTotalCount == 2)
        #expect(day7?.displayCompletedCount == 0)

        #expect(event.dayProgress?.recordedDaysDescending.first?.day == 7)
        #expect(event.error == nil)
        // Additive/optional: a day_progress_state with no officeHoursMemory decodes to nil.
        #expect(event.officeHoursMemory == nil)
        #expect(event.dayReviews == nil)
    }

    @MainActor @Test func decodedDayProgressDerivesWorkedOfficeHoursDayAcrossCalendarGap() throws {
        let unfinishedPayload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "currentDay": 10,
          "dayProgress": {
            "schemaVersion": 1,
            "schema": "agentic30.day_progress.v1",
            "challengeStartedAt": "2026-06-01",
            "days": {
              "1": {
                "day": 1,
                "kind": "day1",
                "steps": {
                  "onboarding": "done", "scan": "done", "goal": "done", "first_interview": "active"
                },
                "goalText": "먼저 도울 사람 정하기",
                "updatedAt": "2026-06-01T10:00:00.000Z"
              }
            }
          }
        }
        """
        let donePayload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "currentDay": 10,
          "dayProgress": {
            "schemaVersion": 1,
            "schema": "agentic30.day_progress.v1",
            "challengeStartedAt": "2026-06-01",
            "days": {
              "1": {
                "day": 1,
                "kind": "day1",
                "steps": {
                  "onboarding": "done", "scan": "done", "goal": "done", "first_interview": "done"
                },
                "goalText": "먼저 도울 사람 정하기",
                "updatedAt": "2026-06-01T10:00:00.000Z"
              }
            }
          }
        }
        """
        let calendarDay10 = Calendar(identifier: .gregorian).date(from: DateComponents(
            timeZone: TimeZone.current,
            year: 2026,
            month: 6,
            day: 10,
            hour: 10
        ))!

        let unfinished = try decoder.decode(SidecarEvent.self, from: Data(unfinishedPayload.utf8))
        #expect(unfinished.dayProgress?.currentDayNumber(now: calendarDay10) == 10)
        #expect(unfinished.dayProgress?.officeHoursWorkedDay(now: calendarDay10) == 1)

        let done = try decoder.decode(SidecarEvent.self, from: Data(donePayload.utf8))
        #expect(done.dayProgress?.currentDayNumber(now: calendarDay10) == 10)
        #expect(done.dayProgress?.officeHoursWorkedDay(now: calendarDay10) == 2)
        #expect(done.dayProgress?.record(forDay: 10) == nil)
    }

    @MainActor @Test func decodesDayProgressStateWithDayReviews() throws {
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "currentDay": 3,
          "dayReviews": {
            "2": {
              "schemaVersion": 1,
              "day": 2,
              "status": "build_escape",
              "verdictLabel": "고객 증거 없이 빌드함",
              "verdictTone": "danger",
              "summary": "AI 작업 90분이 있었지만 확인 가능한 고객 증거가 없습니다.",
              "customerEvidence": [
                {
                  "id": "cm-2",
                  "cycle": 2,
                  "day": 2,
                  "createdAt": "2026-06-09T09:00:00.000Z",
                  "text": "Jane에게 DM로 결제 의향 묻기",
                  "customer": "Jane",
                  "channel": "DM",
                  "message": "결제 의향 묻기",
                  "expectedEvidenceKind": "screenshot",
                  "dueDay": 3,
                  "confirmedByUser": true,
                  "status": "open",
                  "evidence": null
                }
              ],
              "commitments": [],
              "nextCommitment": null,
              "missing": ["hard_evidence"],
              "goalSnapshot": {
                "summary": "Jane에게 결제 의향을 묻는다",
                "customer": "Jane",
                "problem": "첫 결제 의사 확인",
                "validationAction": "DM으로 가격을 묻는다",
                "source": "day1_goal"
              },
              "missingReasons": ["확인 가능한 증거가 없습니다."],
              "carryForwardAction": "Jane에게 DM로 결제 의향 묻기",
              "evidenceDebts": [
                {
                  "id": "cm-2",
                  "cycle": 2,
                  "day": 2,
                  "createdAt": "2026-06-09T09:00:00.000Z",
                  "text": "Jane에게 DM로 결제 의향 묻기",
                  "customer": "Jane",
                  "channel": "DM",
                  "message": "결제 의향 묻기",
                  "expectedEvidenceKind": "screenshot",
                  "dueDay": 3,
                  "confirmedByUser": true,
                  "status": "open",
                  "evidence": null
                }
              ],
              "work": {
                "available": true,
                "date": "2026-06-09",
                "aiMinutes": 90,
                "commitCount": 2,
                "referenceEventCount": 0,
                "hasWork": true,
                "areas": [
                  { "name": "제품 빌드", "aiMinutes": 90, "commitCount": 2, "paths": ["agentic30/ContentView.swift"] }
                ]
              }
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        let review = try #require(event.dayReviews?["2"])
        #expect(review.status == "build_escape")
        #expect(review.verdictLabel == "고객 증거 없이 빌드함")
        #expect(review.customerEvidence.first?.customer == "Jane")
        #expect(review.customerEvidence.first?.expectedEvidenceKind == "screenshot")
        #expect(review.goalSnapshot?.customer == "Jane")
        #expect(review.carryForwardAction == "Jane에게 DM로 결제 의향 묻기")
        #expect(review.evidenceDebts.first?.id == "cm-2")
        #expect(review.work?.aiMinutes == 90)
        #expect(review.work?.areas.first?.paths == ["agentic30/ContentView.swift"])
    }

    @MainActor @Test func decodesDayProgressStateWithOfficeHoursDayClosePolicy() throws {
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "currentDay": 3,
          "dayClosePolicy": {
            "schemaVersion": 1,
            "role": "evidence_closing_operator",
            "definition": "오늘의 가장 좁은 외부 검증 행동을 정하고 고객 증거 또는 명시적 미해결 부채로 Day를 닫는 시스템.",
            "closeTypes": ["customer_evidence", "posted_url_target", "blocked", "carry"],
            "mandatoryBip": {
              "state": "target_behavior",
              "currentProofSink": "local",
              "allowedProofSinks": ["local", "bip_optional"],
              "autoPosting": false,
              "userApprovalRequired": true
            },
            "bipResearchCandidatePolicy": {
              "state": "manual_fallback",
              "readyCacheRequired": true,
              "cachePath": ".agentic30/bip/research/day-3-cache.json",
              "candidateCount": 0,
              "candidateTitles": [],
              "fallbackAction": "manually_named_reachable_customer"
            },
            "evidenceSourcePolicy": {
              "externalSourcesFailClosed": true,
              "unavailableSources": ["git", "posthog", "cloudflare"],
              "marketRadarCardsAvailable": false
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "day_progress_state")
        #expect(event.dayClosePolicy?.role == "evidence_closing_operator")
        #expect(event.dayClosePolicy?.closeTypes == ["customer_evidence", "posted_url_target", "blocked", "carry"])
        #expect(event.dayClosePolicy?.mandatoryBip.state == "target_behavior")
        #expect(event.dayClosePolicy?.mandatoryBip.currentProofSink == .local)
        #expect(event.dayClosePolicy?.mandatoryBip.allowedProofSinks == [.local, .bipOptional])
        #expect(event.dayClosePolicy?.mandatoryBip.autoPosting == false)
        #expect(event.dayClosePolicy?.bipResearchCandidatePolicy.state == "manual_fallback")
        #expect(event.dayClosePolicy?.bipResearchCandidatePolicy.cachePath == ".agentic30/bip/research/day-3-cache.json")
        #expect(event.dayClosePolicy?.bipResearchCandidatePolicy.fallbackAction == "manually_named_reachable_customer")
        #expect(event.dayClosePolicy?.evidenceSourcePolicy.unavailableSources == ["git", "posthog", "cloudflare"])
        #expect(event.dayClosePolicy?.evidenceSourcePolicy.marketRadarCardsAvailable == false)
    }

    @MainActor @Test func decodesDayProgressStateWithEvidenceOS() throws {
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "evidenceOS": {
            "schemaVersion": 1,
            "currentDay": 2,
            "openDebts": [
              {
                "id": "cm-1",
                "cycle": 1,
                "day": 1,
                "createdAt": "2026-06-08T09:00:00.000Z",
                "text": "Jane에게 DM",
                "customer": "Jane",
                "channel": "DM",
                "message": "결제 의향 묻기",
                "expectedEvidenceKind": "screenshot",
                "dueDay": 2,
                "confirmedByUser": true,
                "status": "open",
                "evidence": null
              }
            ],
            "overdueDebts": [],
            "provenEvidence": [],
            "dayStates": {
              "1": {
                "day": 1,
                "state": "closed_unproven",
                "label": "증거 없음",
                "tone": "warning",
                "openDebtCount": 1,
                "provenEvidenceCount": 0,
                "carryForwardAction": "Jane에게 DM"
              }
            }
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.evidenceOS?.currentDay == 2)
        #expect(event.evidenceOS?.openDebts.first?.customer == "Jane")
        #expect(event.evidenceOS?.dayStates["1"]?.state == "closed_unproven")
    }

    @MainActor @Test func decodesDayProgressStateWithOfficeHoursMemory() throws {
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "currentDay": 9,
          "needsCommitment": true,
          "gatedStep": "interview",
          "dayProgress": {
            "schemaVersion": 1,
            "schema": "agentic30.day_progress.v1",
            "challengeStartedAt": "2026-06-01",
            "days": {}
          },
          "officeHoursMemory": {
            "compiledTruth": "Cycle 8 (Day 8). 마지막 약속: \\"DM 5개 보내기\\".",
            "openThreads": ["DM 5개 보내기"],
            "abandonedThreads": ["DM 5개 보내기 — 2 사이클 silent"]
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "day_progress_state")
        #expect(event.officeHoursMemory?.compiledTruth?.contains("DM 5개 보내기") == true)
        #expect(event.officeHoursMemory?.openThreads == ["DM 5개 보내기"])
        #expect(event.officeHoursMemory?.abandonedThreads.first?.contains("2 사이클 silent") == true)
    }

    @MainActor @Test func decodesDayProgressStateWithMilestoneGateBlocked() throws {
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "currentDay": 8,
          "message": "G2 Foundation Go/No-Go 게이트가 잠겨 있어 Day 8+ 진입이 차단됐어.",
          "gateBlocked": {
            "gateId": "G2",
            "title": "Foundation Go/No-Go",
            "blockedReason": "foundation_closure_closed",
            "blockedStep": null,
            "requiredEvidence": [
              { "id": "foundation_closure_closed", "label": "foundation closure status=closed" },
              { "id": "interview_strong_evidence", "label": "인터뷰 strong 증거 ≥1" }
            ]
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "day_progress_state")
        #expect(event.gateBlocked?.gateId == "G2")
        #expect(event.gateBlocked?.title == "Foundation Go/No-Go")
        #expect(event.gateBlocked?.blockedReason == "foundation_closure_closed")
        #expect(event.gateBlocked?.blockedStep == nil)
        #expect(event.gateBlocked?.requiredEvidence?.count == 2)
        #expect(event.gateBlocked?.requiredEvidence?.first?.id == "foundation_closure_closed")
        #expect(event.message?.contains("G2") == true)
    }

    @MainActor @Test func decodesDayProgressStateWithoutGateBlockedAsNil() throws {
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "currentDay": 3
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.gateBlocked == nil)
    }

    @MainActor @Test func decodesMissionCardEvent() throws {
        let payload = """
        {
          "type": "mission_card",
          "workspaceRoot": "/Users/october/prj/myapp",
          "missionCard": {
            "schemaVersion": 1,
            "day": 9,
            "source": "idd",
            "mission": {
              "day": 9,
              "title": "입력→처리→출력 흐름을 고정한다",
              "shortTitle": "Input Flow",
              "summary": "사용자가 바로 써볼 수 있게 입력, 처리, 결과 화면을 한 번에 지나가게 만든다.",
              "tasks": ["첫 입력 포맷 1개만 선택", "처리 실패와 빈 입력 폴백 작성", "결과 화면까지 30초 이내인지 재기"],
              "output": "input-process-output flow",
              "dayType": "action",
              "phase": "build",
              "curriculumWeek": 2,
              "substituted": false,
              "substitutionReason": "",
              "exitCondition": ""
            },
            "evidenceSpec": {
              "evidenceRequired": true,
              "artifact": "input-process-output flow",
              "allowedEvidenceTypes": ["link", "file"],
              "minimumStrength": "medium",
              "completionSignal": "증거 제출 후 판정이 accepted 또는 verified가 되어야 합니다."
            },
            "gateContext": {
              "day": 9,
              "blockingGateId": null,
              "states": { "G1": "passed", "G2": "passed", "G4": "locked" }
            },
            "generatedAt": "2026-06-12T09:00:00.000Z"
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "mission_card")
        #expect(event.missionCard?.day == 9)
        #expect(event.missionCard?.source == "idd")
        #expect(event.missionCard?.mission?.shortTitle == "Input Flow")
        #expect(event.missionCard?.mission?.tasks?.count == 3)
        #expect(event.missionCard?.evidenceSpec?.evidenceRequired == true)
        #expect(event.missionCard?.evidenceSpec?.allowedEvidenceTypes == ["link", "file"])
        #expect(event.missionCard?.gateContext?.states?["G2"] == "passed")
        #expect(event.missionCard?.gateContext?.blockingGateId == nil)
    }

    @MainActor @Test func decodesSubstitutedMissionCard() throws {
        let payload = """
        {
          "type": "mission_card",
          "workspaceRoot": "/Users/october/prj/myapp",
          "missionCard": {
            "day": 15,
            "source": "idd",
            "mission": {
              "day": 15,
              "title": "유료 ask 재작성+발송",
              "shortTitle": "Revenue Dry Run",
              "substituted": true,
              "substitutionReason": "G4_failed",
              "exitCondition": "paymentIntent strong ≥1 + first_value ≥1행"
            }
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.missionCard?.mission?.substituted == true)
        #expect(event.missionCard?.mission?.substitutionReason == "G4_failed")
        #expect(event.missionCard?.evidenceSpec == nil)
    }

    @MainActor @Test func decodesV2StateTransitionDailyCard() throws {
        let event = try decoder.decode(SidecarEvent.self, from: Data(Self.v2StateTransitionPayload.utf8))
        let dailyCard = Self.mirrorChild("dailyCard", in: event.missionCard)

        #expect(event.type == "mission_card")
        #expect(event.missionCard?.day == 14)
        #expect(Self.mirrorChild("stateTransition", in: dailyCard) != nil)
        #expect(Self.mirrorChild("sourceState", in: dailyCard).map(String.init(describing:))?.contains("stale") == true)
        #expect(Self.mirrorChild("proofLedgerMapping", in: dailyCard) != nil)
        #expect(Self.mirrorChild("choices", in: Self.mirrorChild("stateTransition", in: dailyCard)).map { Mirror(reflecting: $0).children.count } == 4)
    }

    @MainActor @Test func decodesV2AgentWorkpackDailyCard() throws {
        let event = try decoder.decode(SidecarEvent.self, from: Data(Self.v2WorkpackPayload.utf8))
        let dailyCard = Self.mirrorChild("dailyCard", in: event.missionCard)
        let workpackCard = Self.mirrorChild("agentWorkpack", in: dailyCard)
        let workpack = Self.mirrorChild("workpack", in: workpackCard)

        #expect(event.missionCard?.day == 14)
        #expect(Self.mirrorChild("sourceState", in: dailyCard).map(String.init(describing:))?.contains("ready") == true)
        #expect(Self.mirrorChild("targetExternalAction", in: workpack) as? String == "Send one paid ask DM with price, outcome, and deadline.")
        #expect(Self.mirrorChild("notProof", in: workpack).map { Mirror(reflecting: $0).children.count } == 2)
        #expect(Self.mirrorChild("proofLedgerMapping", in: dailyCard) != nil)
    }

    @MainActor @Test func decodesV2ProgramScoreboardSnapshotDailyCard() throws {
        let event = try decoder.decode(SidecarEvent.self, from: Data(Self.v2ScoreboardPayload.utf8))
        let dailyCard = Self.mirrorChild("dailyCard", in: event.missionCard)
        let scoreboard = Self.mirrorChild("scoreboard", in: dailyCard)
        let scoreboards = Self.mirrorChild("scoreboards", in: scoreboard)
        let activeUsers100 = Self.mirrorChild("activeUsers100", in: scoreboards)

        #expect(event.missionCard?.day == 21)
        #expect(Self.mirrorChild("acceptedCount", in: activeUsers100) as? Int == 7)
        #expect(Self.mirrorChild("excludedCounts", in: activeUsers100) != nil)
        #expect(Self.mirrorChild("sourceState", in: activeUsers100).map(String.init(describing:))?.contains("ready") == true)
    }

    @MainActor @Test func decodesV2RevenueOrActivationGateDailyCard() throws {
        let event = try decoder.decode(SidecarEvent.self, from: Data(Self.v2GatePayload.utf8))
        let dailyCard = Self.mirrorChild("dailyCard", in: event.missionCard)
        let gateCard = Self.mirrorChild("gateCard", in: dailyCard)

        #expect(event.missionCard?.day == 14)
        #expect(Self.mirrorChild("gate", in: gateCard).map(String.init(describing:))?.contains("G4") == true)
        #expect(Self.mirrorChild("satisfied", in: gateCard) as? Bool == false)
        #expect(Self.mirrorChild("blockingReasons", in: gateCard).map { Mirror(reflecting: $0).children.count } == 2)
        #expect(Self.mirrorChild("nextCardType", in: gateCard).map(String.init(describing:))?.contains("office_hours_agent_workpack") == true)
    }

    @MainActor @Test func rejectsV2DailyCardSelfReportProofMapping() throws {
        try assertSidecarEventDecodeFails(Self.v2SelfReportProofPayload, code: "ERR_SELF_REPORT_COUNTED_AS_PROOF")
    }

    @MainActor @Test func rejectsV2DailyCardMissingSourceState() throws {
        try assertSidecarEventDecodeFails(Self.v2MissingSourceStatePayload, code: "ERR_MISSING_SOURCE_STATE")
    }

    @MainActor @Test func rejectsV2DailyCardUnknownCardType() throws {
        let payload = Self.v2WorkpackPayload.replacingOccurrences(
            of: #""type": "office_hours_agent_workpack""#,
            with: #""type": "program_magic_card""#
        )
        try assertSidecarEventDecodeFails(payload, code: "ERR_UNKNOWN_CARD_TYPE")
    }

    @MainActor @Test func rejectsV2DailyCardMalformedWorkpack() throws {
        try assertSidecarEventDecodeFails(Self.v2MalformedWorkpackPayload, code: "ERR_MALFORMED_AGENT_WORKPACK")
    }

    @MainActor @Test func rejectsV2DailyCardInvalidProofMapping() throws {
        try assertSidecarEventDecodeFails(Self.v2InvalidProofMappingPayload, code: "ERR_INVALID_PROOF_MAPPING")
    }

    @MainActor @Test func viewModelStoresOrderedV2DailyCards() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        let stateEvent = try decoder.decode(SidecarEvent.self, from: Data(Self.v2StateTransitionPayload.utf8))
        let workpackEvent = try decoder.decode(SidecarEvent.self, from: Data(Self.v2WorkpackPayload.utf8))

        viewModel.applySidecarEventForTesting(workpackEvent)
        viewModel.applySidecarEventForTesting(stateEvent)

        #expect(viewModel.dailyCards.count == 2)
        #expect(viewModel.dailyCards.first?.stateTransition != nil)
        #expect(viewModel.dailyCards.last?.agentWorkpack != nil)
    }

    @MainActor @Test func repairV2DailyCardRefreshReplacesSameLogicalCardWhenSourceStateVersionChanges() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        let firstPayload = Self.v2WorkpackPayload
            .replacingOccurrences(
                of: #""schemaVersion": 1,"#,
                with: #""id": "office_hours_agent_workpack:14:commitment_14:state-v1", "schemaVersion": 1,"#
            )
            .replacingOccurrences(
                of: #""sourceState": "ready","#,
                with: #""sourceState": "ready", "sourceStateVersion": "state-v1","#
            )
        let refreshedPayload = Self.v2WorkpackPayload
            .replacingOccurrences(
                of: #""schemaVersion": 1,"#,
                with: #""id": "office_hours_agent_workpack:14:commitment_14:state-v2", "schemaVersion": 1,"#
            )
            .replacingOccurrences(
                of: #""sourceState": "ready","#,
                with: #""sourceState": "ready", "sourceStateVersion": "state-v2","#
            )

        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(firstPayload.utf8)))
        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(refreshedPayload.utf8)))

        #expect(viewModel.dailyCards.count == 1)
        #expect(viewModel.dailyCards.first?.sourceStateVersion == "state-v2")
        #expect(viewModel.dailyCards.first?.id == "office_hours_agent_workpack:14:commitment_14:state-v2")
    }

    @MainActor @Test func repairV2DailyCardRefreshDropsCardsMissingFromNewSourceStateVersion() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        let stalePayload = Self.v2StateTransitionPayloadWithGeneration
            .replacingOccurrences(
                of: #""sourceStateVersion": "state-transition-v1""#,
                with: #""sourceStateVersion": "state-v1""#
            )
        let firstWorkpackPayload = Self.v2WorkpackPayload
            .replacingOccurrences(
                of: #""schemaVersion": 1,"#,
                with: #""id": "office_hours_agent_workpack:14:commitment_14:state-v1", "schemaVersion": 1,"#
            )
            .replacingOccurrences(
                of: #""sourceState": "ready","#,
                with: #""sourceState": "ready", "sourceStateVersion": "state-v1","#
            )
        let refreshedWorkpackPayload = Self.v2WorkpackPayload
            .replacingOccurrences(
                of: #""schemaVersion": 1,"#,
                with: #""id": "office_hours_agent_workpack:14:commitment_14:state-v2", "schemaVersion": 1,"#
            )
            .replacingOccurrences(
                of: #""sourceState": "ready","#,
                with: #""sourceState": "ready", "sourceStateVersion": "state-v2","#
            )

        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(stalePayload.utf8)))
        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(firstWorkpackPayload.utf8)))
        #expect(viewModel.dailyCards.count == 2)

        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(refreshedWorkpackPayload.utf8)))

        #expect(viewModel.dailyCards.count == 1)
        #expect(viewModel.dailyCards.first?.sourceStateVersion == "state-v2")
        #expect(viewModel.dailyCards.first?.agentWorkpack != nil)
        #expect(viewModel.dailyCards.contains { $0.stateTransition != nil } == false)
    }

    @MainActor @Test func repairV2DailyCardClearsLegacyExecutionMissionCard() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        let legacyEvent = try decoder.decode(SidecarEvent.self, from: Data(Self.legacyMissionCardPayload.utf8))
        let dailyCardEvent = try decoder.decode(SidecarEvent.self, from: Data(Self.v2WorkpackPayload.utf8))

        viewModel.applySidecarEventForTesting(legacyEvent)
        viewModel.applySidecarEventForTesting(dailyCardEvent)

        #expect(viewModel.executionMissionCard == nil)
        #expect(viewModel.dailyCards.count == 1)
        #expect(viewModel.dailyCards.first?.agentWorkpack != nil)
    }

    @MainActor @Test func v2DailyCardRefreshPrunesCardsFromOlderSourceStateVersion() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        let statePayload = Self.v2StateTransitionPayload
            .replacingOccurrences(
                of: #""schemaVersion": 1,"#,
                with: #""id": "office_hours_state_transition:14:commitment_14:state-v1", "schemaVersion": 1,"#
            )
            .replacingOccurrences(
                of: #""sourceState": "stale","#,
                with: #""sourceState": "stale", "sourceStateVersion": "state-v1","#
            )
        let refreshedWorkpackPayload = Self.v2WorkpackPayload
            .replacingOccurrences(
                of: #""schemaVersion": 1,"#,
                with: #""id": "office_hours_agent_workpack:14:commitment_14:state-v2", "schemaVersion": 1,"#
            )
            .replacingOccurrences(
                of: #""sourceState": "ready","#,
                with: #""sourceState": "ready", "sourceStateVersion": "state-v2","#
            )

        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(statePayload.utf8)))
        viewModel.applySidecarEventForTesting(try decoder.decode(SidecarEvent.self, from: Data(refreshedWorkpackPayload.utf8)))

        #expect(viewModel.dailyCards.count == 1)
        #expect(viewModel.dailyCards.first?.type == .officeHoursAgentWorkpack)
        #expect(viewModel.dailyCards.first?.sourceStateVersion == "state-v2")
    }

    @MainActor @Test func repairV2DailyCardDayChangeClearsPreviousDayCards() throws {
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true)
        let day14Event = try decoder.decode(SidecarEvent.self, from: Data(Self.v2WorkpackPayload.utf8))
        let day21Event = try decoder.decode(SidecarEvent.self, from: Data(Self.v2ScoreboardPayload.utf8))

        viewModel.applySidecarEventForTesting(day14Event)
        viewModel.applySidecarEventForTesting(day21Event)

        #expect(viewModel.dailyCards.count == 1)
        #expect(viewModel.dailyCards.first?.programDay == 21)
        #expect(viewModel.dailyCards.first?.scoreboard != nil)
    }

    @MainActor @Test func repairTodo8ReplacementActionRequiresNonEmptyNextCandidateAndNextAction() throws {
        let sidecar = Todo8DailyCardCapturingSidecar()
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true, sidecar: sidecar)
        viewModel.markSidecarConnectedForTesting(workspaceRoot: "/tmp/product")
        let card = try dailyCard(Self.v2StateTransitionPayloadWithGeneration)

        let missingCandidate = OfficeHoursDailyCardPresentation.replacementCandidate(
            candidateName: " ",
            actionText: "Send the paid ask"
        )
        let missingAction = OfficeHoursDailyCardPresentation.replacementCandidate(
            candidateName: "Next Candidate",
            actionText: "\n"
        )
        let submitted = viewModel.submitOfficeHoursDailyCard(
            card,
            action: "replace_candidate",
            choiceId: "replace_candidate",
            resolutionReason: "replaced_by_next_candidate",
            replacementCandidate: missingCandidate?.payload
        )

        #expect(missingCandidate == nil)
        #expect(missingAction == nil)
        #expect(submitted == false)
        #expect(sidecar.sentPayloads.isEmpty)
    }

    @MainActor @Test func repairTodo8ReplacementPayloadUsesNewInputNotCurrentStaleCardValues() throws {
        let sidecar = Todo8DailyCardCapturingSidecar()
        let viewModel = AgenticViewModel(disablesSidecarStartForTesting: true, sidecar: sidecar)
        viewModel.markSidecarConnectedForTesting(workspaceRoot: "/tmp/product")
        let card = try dailyCard(Self.v2StateTransitionPayloadWithGeneration)
        let replacement = try #require(OfficeHoursDailyCardPresentation.replacementCandidate(
            candidateName: "Next Candidate",
            actionText: "Send a paid ask with a deadline"
        ))

        let submitted = viewModel.submitOfficeHoursDailyCard(
            card,
            action: "replace_candidate",
            choiceId: "replace_candidate",
            resolutionReason: "replaced_by_next_candidate",
            replacementCandidate: replacement.payload
        )
        let payload = try #require(sidecar.sentPayloads.first)
        let candidate = try #require(payload["replacementCandidate"] as? [String: Any])

        #expect(submitted == true)
        #expect(candidate["candidateName"] as? String == "Next Candidate")
        #expect(candidate["actionText"] as? String == "Send a paid ask with a deadline")
        #expect(candidate["candidateName"] as? String != card.stateTransition?.candidateName)
        #expect(candidate["actionText"] as? String != card.stateTransition?.actionText)
    }

    @MainActor @Test func repairTodo8ScoreboardBucketsDoNotDoubleCountLearningInsideExcluded() throws {
        let card = try dailyCard(Self.v2ScoreboardPayload)
        let activeUsers100 = try #require(card.scoreboard?.scoreboards.activeUsers100)
        let buckets = OfficeHoursDailyCardPresentation.scoreboardBuckets(for: activeUsers100)

        #expect(buckets.accepted == 7)
        #expect(buckets.excluded == 1422)
        #expect(buckets.learning == 3)
        #expect(buckets.excluded != 1425)
    }

    @MainActor @Test func repairTodo8DailyCardOrderingActionsAndSelfReportCopyUseObservablePresenter() throws {
        let unordered = [
            try dailyCard(Self.v2ScoreboardPayload),
            try dailyCard(Self.v2WorkpackPayload),
            try dailyCard(Self.v2StateTransitionPayload),
            try dailyCard(Self.v2GatePayload),
        ]
        let orderedTypes = OfficeHoursDailyCardPresentation.orderedCards(unordered).map(\.type)
        let stateActions = OfficeHoursDailyCardPresentation.actionIDs(for: unordered[2])
        let workpackActions = OfficeHoursDailyCardPresentation.actionIDs(for: unordered[1])
        let gateActions = OfficeHoursDailyCardPresentation.actionIDs(for: unordered[3])

        let expectedTypes: [SidecarEvent.MissionCard.DailyCard.CardType] = [
            .officeHoursStateTransition,
            .officeHoursAgentWorkpack,
            .programScoreboardSnapshot,
            .revenueOrActivationGate,
        ]
        #expect(orderedTypes == expectedTypes)
        #expect(stateActions == [
            "attach_evidence",
            "resolve_without_evidence",
            "replace_candidate",
            "keep_open_today",
        ])
        #expect(workpackActions == ["attach_evidence"])
        #expect(gateActions == ["gate_recovery"])
        #expect(OfficeHoursDailyCardPresentation.selfReportResolutionCopy == "자기 보고 해소는 고객 증거나 매출 진전으로 세지 않음")
        #expect(!OfficeHoursDailyCardPresentation.selfReportResolutionCopy.contains("고객 증거로 인정"))
        #expect(!OfficeHoursDailyCardPresentation.selfReportResolutionCopy.contains("매출 진전으로 인정"))
    }

    @MainActor @Test func decodesOfficeHoursInterventionRequiredEvent() throws {
        let payload = """
        {
          "type": "office_hours_intervention_required",
          "workspaceRoot": "/Users/october/prj/myapp",
          "intervention": {
            "triggerId": "gate_blocked_G4",
            "severity": "immediate",
            "source": "gate_engine",
            "gateId": "G4",
            "ruleId": null,
            "abbreviated": false,
            "questions": [
              "가격·받을 약속·기한이 있는 유료 ask를 보내지 못한 진짜 이유는 무엇인가?",
              "first_value 계측이 빠졌다면, 사용자의 첫 가치 행동을 한 문장으로 정의할 수 있는가?"
            ],
            "exitCondition": "구조화 커밋먼트 1개(고객·채널·메시지·기대증거·기한, user-origin, audience=customer) 확정",
            "postSessionEvidence": "커밋먼트의 expectedEvidenceKind에 따른 strong 증거를 dueDay 안에 제출",
            "day": 15
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "office_hours_intervention_required")
        #expect(event.intervention?.triggerId == "gate_blocked_G4")
        #expect(event.intervention?.severity == "immediate")
        #expect(event.intervention?.gateId == "G4")
        #expect(event.intervention?.ruleId == nil)
        #expect(event.intervention?.questions?.count == 2)
        #expect(event.intervention?.day == 15)
        #expect(event.intervention?.exitCondition?.contains("커밋먼트") == true)
    }

    @MainActor @Test func decodesConfessionInterventionEvent() throws {
        let payload = """
        {
          "type": "office_hours_intervention_required",
          "workspaceRoot": "/Users/october/prj/myapp",
          "intervention": {
            "triggerId": "interview_confession",
            "severity": "immediate",
            "source": "interview_gate",
            "abbreviated": true,
            "questions": ["이 인터뷰를 닫지 못하게 막는 것을 한 문장으로 말하라."],
            "day": 4
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.intervention?.triggerId == "interview_confession")
        #expect(event.intervention?.abbreviated == true)
        #expect(event.intervention?.gateId == nil)
    }

    @MainActor @Test func decodesDayProgressStateWithOfficeHoursHistoryRollup() throws {
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "officeHoursHistory": {
            "schemaVersion": 1,
            "day": 30,
            "onboarding": {
              "focusArea": "development",
              "timeBudget": "daily_1_2h",
              "blocker": "building",
              "records": "project_folder,work_log",
              "projectPath": "/Users/october/prj/myapp",
              "readSources": ["GitHub:connected", "Notion:disabled"],
              "summary": "집중영역=development"
            },
            "dayRollup": [
              {
                "day": 29,
                "summary": "Q Day 29 질문 · A Day 29 답변",
                "curriculumAnswerCount": 1,
                "officeHoursTurnCount": 1,
                "openCommitments": 1,
                "metCommitments": 0,
                "detailPath": ".agentic30/memory/days/day-29.json"
              }
            ],
            "curriculumAnswers": ["Day 29: Q=질문 / A=답변"],
            "officeHoursTurns": ["Day 29: Q=질문 / A=답변"],
            "openCommitments": ["Day 29 [open] 고객 DM"],
            "metCommitments": []
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.officeHoursHistory?.day == 30)
        #expect(event.officeHoursHistory?.onboarding?.readSources == ["GitHub:connected", "Notion:disabled"])
        #expect(event.officeHoursHistory?.dayRollup.first?.day == 29)
        #expect(event.officeHoursHistory?.dayRollup.first?.detailPath == ".agentic30/memory/days/day-29.json")
        #expect(event.officeHoursHistory?.openCommitments.first?.contains("고객 DM") == true)
    }

    @MainActor @Test func decodesOfficeHoursMemoryToleratesMissingArrays() throws {
        // Tolerant decode: a summary with only compiledTruth still decodes (arrays default []).
        let payload = """
        { "type": "day_progress_state", "officeHoursMemory": { "compiledTruth": "x" } }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.officeHoursMemory?.compiledTruth == "x")
        #expect(event.officeHoursMemory?.openThreads == [])
        #expect(event.officeHoursMemory?.abandonedThreads == [])
    }

    @MainActor @Test func decodesDayProgressStateInterviewGateBlock() throws {
        // Block-mode payload: the sidecar withholds an interview close and asks for one
        // next customer action (handleDayProgressPatch gate.mode == "block", index.mjs).
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "currentDay": 9,
          "needsCommitment": true,
          "gatedStep": "interview",
          "message": "이 인터뷰를 닫기 전에 다음 한 가지 고객 행동을 약속해줘. 정 못 하면 그 이유를 남겨도 통과돼."
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "day_progress_state")
        #expect(event.needsCommitment == true)
        #expect(event.gatedStep == "interview")
        #expect(event.message?.contains("다음 한 가지 고객 행동") == true)
    }

    @MainActor @Test func decodesDayProgressStateWithoutGateLeavesNeedsCommitmentNil() throws {
        // Additive/optional: a normal (non-blocked) day_progress_state omits the gate fields,
        // so needsCommitment/gatedStep decode to nil and the bar shows no nudge.
        let payload = """
        { "type": "day_progress_state", "currentDay": 3 }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.needsCommitment == nil)
        #expect(event.gatedStep == nil)
    }

    @MainActor @Test func decodesOfficeHoursMemoryCalibrationFields() throws {
        // calibration-lite read-back: "예측 적중 N/M" + the open forecast awaiting a verdict.
        let payload = """
        {
          "type": "day_progress_state",
          "officeHoursMemory": {
            "compiledTruth": "Cycle 10.",
            "calibrationLine": "예측 적중 1/3 — 2개 빗나갔어.",
            "pendingPrediction": "5명 중 2명 답장",
            "consecutiveDeferrals": 2
          }
        }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.officeHoursMemory?.calibrationLine == "예측 적중 1/3 — 2개 빗나갔어.")
        #expect(event.officeHoursMemory?.pendingPrediction == "5명 중 2명 답장")
        #expect(event.officeHoursMemory?.consecutiveDeferrals == 2)
        #expect(event.officeHoursMemory?.hasContent == true)
        #expect(event.officeHoursMemory?.hasPendingPrediction == true)
    }

    @MainActor @Test func officeHoursMemoryCalibrationFieldsDefaultNilWhenAbsent() throws {
        // Additive/optional: a summary without calibration fields leaves them nil and keeps
        // the banner/grade surfaces hidden (screenshot-stable on cold brains).
        let payload = """
        { "type": "day_progress_state", "officeHoursMemory": { "compiledTruth": "x" } }
        """
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.officeHoursMemory?.calibrationLine == nil)
        #expect(event.officeHoursMemory?.pendingPrediction == nil)
        #expect(event.officeHoursMemory?.hasPendingPrediction == false)
        #expect(event.officeHoursMemory?.consecutiveDeferrals == 0)
    }

    @MainActor @Test func day1DisplayStepsHideIntroStagesMidLoop() {
        // Screenshot state: onboarding/scan auto-done, 목표 active, 첫 인터뷰 pending.
        // The stepper + sidebar badge must hide the intro stages and count only the
        // two user-facing stages (→ "0/2"), while the data axis keeps all four.
        let day1 = DayRecord(
            day: 1,
            kind: .day1,
            steps: ["onboarding": .done, "scan": .done, "goal": .active, "first_interview": .pending]
        )
        #expect(day1.orderedSteps.count == 4)
        #expect(day1.completedCount == 2)
        #expect(day1.displaySteps.map({ $0.id }) == ["goal", "first_interview"])
        #expect(day1.displaySteps.first?.label == "목표")
        #expect(day1.displayTotalCount == 2)
        #expect(day1.displayCompletedCount == 0)
        #expect(day1.isDisplayComplete == false)

        // Day 2 starts after scan/retro/goal, so the display axis opens on
        // 인터뷰 → 실행 while the stored standard loop remains complete.
        let day2 = DayRecord(
            day: 2,
            kind: .standard,
            steps: ["scan": .done, "retro": .done, "goal": .done, "interview": .active, "execution": .pending]
        )
        #expect(day2.orderedSteps.map({ $0.id }) == ["scan", "retro", "goal", "interview", "execution"])
        #expect(day2.completedCount == 3)
        #expect(day2.displaySteps.map({ $0.id }) == ["interview", "execution"])
        #expect(day2.displayTotalCount == 2)
        #expect(day2.displayCompletedCount == 0)

        let day3 = DayRecord(
            day: 3,
            kind: .standard,
            steps: ["scan": .done, "retro": .done, "goal": .done, "interview": .active, "execution": .pending]
        )
        #expect(day3.displaySteps.map({ $0.id }) == ["interview", "execution"])
        #expect(day3.displayTotalCount == 2)
        #expect(day3.displayCompletedCount == 0)

        let day7GoalBlocked = DayRecord(
            day: 7,
            kind: .standard,
            steps: ["scan": .done, "retro": .done, "goal": .active, "interview": .pending, "execution": .pending]
        )
        #expect(day7GoalBlocked.displaySteps.map({ $0.id }) == ["goal", "interview", "execution"])
        #expect(day7GoalBlocked.displayTotalCount == 3)
        #expect(day7GoalBlocked.displayCompletedCount == 0)
    }

    @MainActor @Test func decodesDay1SurfaceReviewState() throws {
        let payload = """
        {
          "type": "day1_surface_review_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "status": "preview_ready",
          "day1SurfaceReview": {
            "schemaVersion": 1,
            "schema": "agentic30.memory.surface_review.v1",
            "workspaceRoot": "/Users/october/prj/myapp",
            "mode": "no_landing",
            "landingUrl": "",
            "status": "preview_ready",
            "generatedAt": "2026-06-23T00:00:00.000Z",
            "decidedAt": null,
            "customerSurface": {
              "headline": "Support leads see missed Slack escalations first",
              "subheadline": "SupportLens turns missed escalations into a pilot request.",
              "audience": "B2B SaaS support lead",
              "problem": "Urgent Slack escalations are missed",
              "currentAlternative": "Slack search and spreadsheets",
              "firstValue": "Find the missed escalation today",
              "cta": "파일럿 신청하기"
            },
            "diagnosis": null,
            "proposals": [
              {
                "path": "landing.html",
                "action": "create",
                "title": "첫 고객 랜딩 초안",
                "content": "<!doctype html><h1>SupportLens</h1>",
                "rationale": ["루트에 바로 둘 수 있는 단일 HTML입니다."],
                "isWritten": false
              }
            ],
            "reasons": [
              {
                "sentence": "파일럿 신청하기",
                "reason": "Day 1 완료 행동이 다음 고객 접촉으로 이어집니다."
              }
            ],
            "decision": {
              "status": "pending",
              "decidedAt": null,
              "appliedFiles": []
            },
            "appliedFiles": []
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "day1_surface_review_state")
        #expect(event.day1SurfaceReview?.schemaVersion == 1)
        #expect(event.day1SurfaceReview?.customerSurface.cta == "파일럿 신청하기")
        #expect(event.day1SurfaceReview?.proposals.first?.path == "landing.html")
        #expect(event.day1SurfaceReview?.decision.status == "pending")
        #expect(event.day1SurfaceReview?.isTerminal == false)
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
              "evidenceRefs": ["README.md (README)", ".agentic30/docs/ICP.md (ICP)"]
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
                { "key": "evidence", "label": "근거", "value": ".agentic30/docs/GOAL.md, .agentic30/docs/ICP.md", "tone": "code" }
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
                "evidence": [".agentic30/docs/SPEC.md"],
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
                "evidence": [".agentic30/docs/GOAL.md"],
                "missingAssumptions": [],
                "options": [
                  { "id": "o1", "label": "빠른 판단", "description": "행동 신호", "preview": "확인할 행동" },
                  { "id": "o2", "label": "기능 추가", "description": "고객 검증 없이 빌드", "preview": "Anti", "antiSignal": true }
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

    @MainActor @Test func day1AlignmentComponentDecodesEmphasisSpans() throws {
        let payload = """
        {
          "id": "icp",
          "title": "고객",
          "prompt": "이 목표를 검증하려면 누구를 확인하나요?",
          "highlightPhrases": ["support lead"],
          "emphasis": [
            { "phrase": "support lead", "style": "strong" },
            { "phrase": ".agentic30/docs/ICP.md", "style": "code" }
          ],
          "statement": "support lead 고객을 .agentic30/docs/ICP.md 기준으로 확인",
          "evidence": [],
          "missingAssumptions": [],
          "options": []
        }
        """.data(using: .utf8)!

        let component = try JSONDecoder().decode(Day1AlignmentComponent.self, from: payload)
        // highlightPhrases stays available for back-compat consumers.
        #expect(component.highlightPhrases == ["support lead"])
        #expect(component.emphasis?.count == 2)
        #expect(component.emphasis?[0] == EmphasisSpan(phrase: "support lead", style: .strong))
        #expect(component.emphasis?[1] == EmphasisSpan(phrase: ".agentic30/docs/ICP.md", style: .code))
    }

    @MainActor @Test func day1AlignmentComponentDecodesSnakeEmphasisAndUnknownStyleFallback() throws {
        let payload = """
        {
          "id": "pain_point",
          "title": "문제",
          "prompt": "가장 압축된 문제는?",
          "highlight_phrases": ["Slack 누락"],
          "emphasis_spans": [
            { "phrase": "Slack 누락", "kind": "mark" },
            { "phrase": "마감", "style": "spotlight" }
          ],
          "statement": "Slack 누락이 반복되고 마감 직전에 터진다",
          "options": []
        }
        """.data(using: .utf8)!

        let component = try JSONDecoder().decode(Day1AlignmentComponent.self, from: payload)
        // snake_case highlight + emphasis aliases both resolve.
        #expect(component.highlightPhrases == ["Slack 누락"])
        #expect(component.emphasis?.count == 2)
        #expect(component.emphasis?[0] == EmphasisSpan(phrase: "Slack 누락", style: .mark))
        // Unknown style falls back to `.mark`.
        #expect(component.emphasis?[1] == EmphasisSpan(phrase: "마감", style: .mark))
    }

    @MainActor @Test func day1AlignmentComponentWithoutEmphasisIsBackCompat() throws {
        let payload = """
        {
          "id": "outcome",
          "title": "확인할 행동",
          "prompt": "어떤 행동 신호를 보나요?",
          "highlightPhrases": ["행동 신호"],
          "statement": "행동 신호를 더 빨리 판단한다",
          "options": []
        }
        """.data(using: .utf8)!

        let component = try JSONDecoder().decode(Day1AlignmentComponent.self, from: payload)
        // No emphasis -> nil, renderer falls back to the legacy highlightPhrases path.
        #expect(component.emphasis == nil)
        #expect(component.highlightPhrases == ["행동 신호"])
    }

    @MainActor @Test func day1IcpQuestionOptionDecodesEmphasisSpans() throws {
        let payload = """
        {
          "id": "o1",
          "label": "AI 코딩 도구를 쓰는 개발자",
          "description": "현재 고객",
          "highlightPhrases": ["AI 코딩 도구"],
          "emphasis": [
            { "phrase": "AI 코딩 도구", "style": "strong" }
          ]
        }
        """.data(using: .utf8)!

        let option = try JSONDecoder().decode(Day1IcpQuestionOption.self, from: payload)
        #expect(option.highlightPhrases == ["AI 코딩 도구"])
        #expect(option.emphasis?.count == 1)
        #expect(option.emphasis?[0] == EmphasisSpan(phrase: "AI 코딩 도구", style: .strong))
    }

    @MainActor @Test func day1IcpQuestionOptionWithoutEmphasisIsBackCompat() throws {
        let payload = """
        {
          "id": "o2",
          "label": "관심만 있음",
          "description": "행동 없음",
          "highlight_phrases": ["관심만"]
        }
        """.data(using: .utf8)!

        let option = try JSONDecoder().decode(Day1IcpQuestionOption.self, from: payload)
        #expect(option.emphasis == nil)
        #expect(option.highlightPhrases == ["관심만"])
    }

    @MainActor @Test func day1SignalDigestRowDecodesEmphasisAndBackCompat() throws {
        let withEmphasis = """
        {
          "key": "pain",
          "label": "문제",
          "value": "urgent Slack escalation을 놓침",
          "tone": "mark",
          "emphasis": [
            { "phrase": "Slack escalation", "style": "code" }
          ]
        }
        """.data(using: .utf8)!

        let row = try JSONDecoder().decode(Day1SignalDigestRow.self, from: withEmphasis)
        #expect(row.tone == "mark")
        #expect(row.emphasis?.count == 1)
        #expect(row.emphasis?[0] == EmphasisSpan(phrase: "Slack escalation", style: .code))

        let legacy = """
        { "key": "icp", "label": "고객", "value": "support lead", "tone": "body" }
        """.data(using: .utf8)!
        let legacyRow = try JSONDecoder().decode(Day1SignalDigestRow.self, from: legacy)
        // No emphasis -> nil, row keeps its single-style tone rendering.
        #expect(legacyRow.emphasis == nil)
        #expect(legacyRow.tone == "body")
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
          "docPath": ".agentic30/docs/ICP.md"
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "doc_creation_result")
        #expect(event.docType == "icp")
        #expect(event.docPath == ".agentic30/docs/ICP.md")
        #expect(event.error == nil)
    }

    @MainActor @Test func decodesDocCreationResultWithError() throws {
        let payload = """
        {
          "type": "doc_creation_result",
          "docType": "spec",
          "error": "Agent finished but the file was not found at .agentic30/docs/SPEC.md"
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "doc_creation_result")
        #expect(event.docType == "spec")
        #expect(event.docPath == nil)
        #expect(event.error == "Agent finished but the file was not found at .agentic30/docs/SPEC.md")
    }

    @MainActor @Test func decodesRecoverableDocCreationResultWithProvider() throws {
        let payload = """
        {
          "type": "doc_creation_result",
          "docType": "icp",
          "provider": "claude",
          "error": "Claude Code process aborted by user",
          "errorKind": "provider_aborted",
          "recoverable": true
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "doc_creation_result")
        #expect(event.docType == "icp")
        #expect(event.provider == "claude")
        #expect(event.error == "Claude Code process aborted by user")
        #expect(event.errorKind == "provider_aborted")
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
                "message": "Codex에 로그인하세요.",
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
            },
            "mcpOauthTraces": [
              {
                "traceId": "mcp_oauth_abc123",
                "at": "2026-06-13T14:25:59.000Z",
                "server": "vercel",
                "provider": "codex",
                "phase": "completed",
                "durationMs": 2140,
                "state": "ready",
                "hasLoginUrl": false,
                "commandCount": 0,
                "providerRunCount": 1
              }
            ]
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
        let trace = try #require(event.diagnostics?.mcpOauthTraces?.first)
        #expect(trace.traceId == "mcp_oauth_abc123")
        #expect(trace.server == "vercel")
        #expect(trace.providerRunCount == 1)
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
              "message": "Claude Code에 로그인하거나 ANTHROPIC_API_KEY를 설정하세요."
            },
            "codex": {
              "available": false,
              "source": "missing",
              "message": "Codex에 로그인하거나 CODEX_API_KEY / OPENAI_API_KEY를 설정하세요."
            },
            "gemini": {
              "available": false,
              "source": "missing",
              "message": "Google Cloud SDK가 설치되어 있지 않습니다. GEMINI_API_KEY / GOOGLE_API_KEY를 설정하거나 Google Cloud SDK를 설치하세요.",
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
              "path": ".agentic30/docs/ICP.md",
              "status": "drafted",
              "content": "# ICP"
            }
          ],
          "iddProviderRecovery": {
            "provider": "codex",
            "message": "Codex에 로그인하세요.",
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
        #expect(event.iddDocPreviews?.first?.path == ".agentic30/docs/ICP.md")
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
              "researchSource": "Codex 웹 검색 도구",
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
        #expect(event.newsMarketRadar?.status.researchSource == "Codex 웹 검색 도구")
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
            "researchSource": "Gemini 웹 검색 도구",
            "stage": "running_provider_research",
            "progressText": "Gemini 웹 검색 도구로 공개 근거를 검색하는 중",
            "elapsedMs": 4210,
            "durationMs": 9123,
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
        #expect(event.newsMarketRadarStatus?.researchSource == "Gemini 웹 검색 도구")
        #expect(event.newsMarketRadarStatus?.stage == "running_provider_research")
        #expect(event.newsMarketRadarStatus?.progressText == "Gemini 웹 검색 도구로 공개 근거를 검색하는 중")
        #expect(event.newsMarketRadarStatus?.elapsedMs == 4210)
        #expect(event.newsMarketRadarStatus?.durationMs == 9123)
        #expect(event.newsMarketRadarStatus?.stepIndex == 4)
        #expect(event.newsMarketRadarStatus?.stepCount == 6)
        #expect(event.newsMarketRadarStatus?.partialFailures?.first?.laneId == "problem")
    }

    @MainActor @Test func decodesStrategyReportResult() throws {
        let payload = """
        {
          "type": "strategy_report_result",
          "strategyReport": {
            "schemaVersion": 1,
            "promptProfile": "ko_strategy_report_v1_three_pass_exa",
            "contentLocale": "ko-KR",
            "generatedAt": "2026-06-14T00:00:00.000Z",
            "nextRefreshAfter": "2026-06-15T00:00:00.000Z",
            "contextFingerprint": "abc123",
            "status": {
              "state": "ready",
              "lastSuccessAt": "2026-06-14T00:00:00.000Z",
              "stale": false,
              "error": null,
              "reason": "manual",
              "researchSource": "Codex Exa MCP"
            },
            "workspaceEvidenceRefs": [],
            "report": {
              "commandLine": "strategy@agentic30 $ synthesize dynamic-strategy",
              "diagnosisKicker": "Verified business diagnosis",
              "diagnosisTitle": "Agentic30은 paid ask와 first_value 증거를 닫는 assistant입니다.",
              "diagnosisLead": "동적 리서치와 검증 패스를 통과한 전략 리포트입니다.",
              "positioningStatement": "Agentic30은 프로젝트 기록을 paid ask 실험으로 바꾸는 macOS assistant입니다.",
              "judgement": "전략 판단은 고객 행동 증거 루프에 집중하는 것입니다.",
              "generatedBadge": "동적 리서치",
              "analysisBasisLabel": "SPEC.md + ICP.md + VALUES.md + Exa",
              "summaryTiles": [
                { "id": "primary-icp", "label": "Primary ICP", "title": "전업 1인 개발자", "detail": "첫 매출 전" },
                { "id": "wedge", "label": "Wedge", "title": "Local evidence loop", "detail": "오늘의 ask 생성" },
                { "id": "proof-target", "label": "Proof", "title": "고객 행동 증거", "detail": "activation gate" }
              ],
              "criteriaRows": [
                { "id": "product-shape", "label": "제품 형태", "value": "macOS + sidecar" },
                { "id": "core-pain", "label": "핵심 고통", "value": "누구에게 팔지 모름" },
                { "id": "differentiator", "label": "차별 기준", "value": "로컬 기록 기반" },
                { "id": "stage", "label": "현재 단계", "value": "private pilot" }
              ],
              "canvasBlocks": [
                { "id": "partners", "number": "08", "eyebrow": "Partners", "title": "핵심 파트너", "tone": "blue", "bullets": ["AI provider"] },
                { "id": "activities", "number": "07", "eyebrow": "Activities", "title": "핵심 활동", "tone": "accent", "bullets": ["pilot 반복"] },
                { "id": "resources", "number": "06", "eyebrow": "Resources", "title": "핵심 자원", "tone": "sky", "bullets": ["proof-ledger"] },
                { "id": "value-proposition", "number": "02", "eyebrow": "Value", "title": "가치 제안", "tone": "accent", "bullets": ["paid ask"] },
                { "id": "relationships", "number": "04", "eyebrow": "Relationships", "title": "고객 관계", "tone": "accent", "bullets": ["체크인"] },
                { "id": "channels", "number": "03", "eyebrow": "Channels", "title": "채널", "tone": "blue", "bullets": ["커뮤니티"] },
                { "id": "customer-segments", "number": "01", "eyebrow": "Segments", "title": "고객 세그먼트", "tone": "accent", "bullets": ["1인 개발자"] },
                { "id": "cost-structure", "number": "09", "eyebrow": "Cost", "title": "비용 구조", "tone": "magenta", "bullets": ["provider 비용"] },
                { "id": "revenue-streams", "number": "05", "eyebrow": "Revenue", "title": "수익원", "tone": "accent", "bullets": ["pilot ask"] }
              ],
              "competitors": [
                { "id": "agentic30", "title": "Agentic30", "tag": "Adaptive PMF evidence loop", "body": "기록을 evidence gate로 바꿉니다.", "gap": "paid pilot 반복", "x": 0.78, "y": 0.22, "adaptiveScore": 92, "evidenceScore": 84, "sourceLabel": "SPEC / ICP / Exa", "sourceURL": "https://agentic30.com", "sourceDisplay": "agentic30.com", "verifiedAt": "2026-06", "scoreRationale": "로컬 기록 기반", "category": "agentic30", "isAgentic30": true, "labelPlacement": "leading" },
                { "id": "cursor", "title": "Cursor", "tag": "AI coding workspace", "body": "빌드 속도 중심입니다.", "gap": "PMF 증거 밖", "x": 0.72, "y": 0.72, "adaptiveScore": 80, "evidenceScore": 35, "sourceLabel": "Public docs", "sourceURL": "https://cursor.com", "sourceDisplay": "cursor.com", "verifiedAt": "2026-06", "scoreRationale": "코딩 적응성", "category": "aiBuild", "isAgentic30": false, "labelPlacement": "trailing" },
                { "id": "indiefounders", "title": "IndieFounders", "tag": "Founder community", "body": "커뮤니티 중심입니다.", "gap": "로컬 loop 약함", "x": 0.32, "y": 0.38, "adaptiveScore": 42, "evidenceScore": 58, "sourceLabel": "Public site", "sourceURL": "https://indiefounders.net", "sourceDisplay": "indiefounders.net", "verifiedAt": "2026-06", "scoreRationale": "커뮤니티 증거", "category": "community", "isAgentic30": false, "labelPlacement": "leading" }
              ],
              "swotGroups": [
                { "id": "strengths", "title": "Strengths", "tag": "내부 강점", "tone": "accent", "bullets": ["로컬 기록"] },
                { "id": "weaknesses", "title": "Weaknesses", "tag": "내부 약점", "tone": "magenta", "bullets": ["데이터 부족"] },
                { "id": "opportunities", "title": "Opportunities", "tag": "외부 기회", "tone": "sky", "bullets": ["AI coding 보급"] },
                { "id": "threats", "title": "Threats", "tag": "외부 위협", "tone": "blue", "bullets": ["IDE 흡수"] }
              ],
              "swotMatrixColumnCount": 2,
              "swotMatrixRows": [["strengths", "weaknesses"], ["opportunities", "threats"]],
              "sourceRefs": [],
              "searchableCopy": ["동적 리서치", "paid ask"]
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "strategy_report_result")
        #expect(event.strategyReport?.status.state == "ready")
        #expect(event.strategyReport?.report?.generatedBadge == "동적 리서치")
        #expect(event.strategyReport?.report?.competitors.first?.isAgentic30 == true)
        #expect(event.strategyReport?.report?.canvasBlocks.count == 9)
    }

    @MainActor @Test func decodesStrategyReportStatusObject() throws {
        let payload = """
        {
          "type": "strategy_report_status",
          "status": {
            "state": "refreshing",
            "stale": false,
            "error": null,
            "reason": "manual",
            "researchSource": "Codex Exa MCP",
            "stage": "running_adversarial_review",
            "progressText": "적대적 리뷰 중",
            "elapsedMs": 900,
            "stepIndex": 4,
            "stepCount": 6,
            "partialFailures": [
              {
                "laneId": "adversarial_review",
                "laneTitle": "적대적 리뷰",
                "error": "weak evidence"
              }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "strategy_report_status")
        #expect(event.status == nil)
        #expect(event.strategyReportStatus?.state == "refreshing")
        #expect(event.strategyReportStatus?.stage == "running_adversarial_review")
        #expect(event.strategyReportStatus?.progressText == "적대적 리뷰 중")
        #expect(event.strategyReportStatus?.stepIndex == 4)
        #expect(event.strategyReportStatus?.stepCount == 6)
        #expect(event.strategyReportStatus?.partialFailures?.first?.laneId == "adversarial_review")
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
            "dayTitle": "첫 버전을 핵심 기능 1개로 자른다",
            "dayPhase": "build",
            "status": {
              "state": "ready",
              "lastSuccessAt": "2026-05-21T00:00:00.000Z",
              "stale": false,
              "error": null,
              "reason": "manual",
              "researchSource": "Codex 웹 검색 도구"
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
                "whyTitle": "왜 고객 후보 증거인가",
                "whyBody": "macOS agentic coding 워크플로와 맞습니다.",
                "usageTitle": "공개 기록 활용",
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
                "draft": "오늘 공개 기록 초안",
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
            "researchSource": "Codex 웹 검색 도구",
            "stage": "running_provider_research",
            "progressText": "X/Threads 고객 후보를 검색하는 중",
            "elapsedMs": 3100,
            "stepIndex": 4,
            "stepCount": 6,
            "partialFailures": [
              {
                "laneId": "bip",
                "laneTitle": "공개 기록 리서치",
                "error": "AI 연결 응답 지연"
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
        #expect(event.bipResearchStatus?.researchSource == "Codex 웹 검색 도구")
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

    @MainActor @Test func decodesWorkspaceScanProviderLimitedEnvelope() throws {
        let payload = """
        {
          "type": "workspace_scan_provider_limited",
          "scanRoot": "/Users/me/project",
          "provider": "codex",
          "model": "gpt-5.1-codex-mini",
          "stage": "scan_agent",
          "errorKind": "provider_usage_limit"
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_scan_provider_limited")
        #expect(event.scanRoot == "/Users/me/project")
        #expect(event.provider == "codex")
        #expect(event.stage == "scan_agent")
        #expect(event.errorKind == "provider_usage_limit")

        // ViewModel이 이 envelope에서 만드는 notice와 동일한 매핑을 고정.
        let provider = try #require(AgentProvider(rawValue: event.provider ?? ""))
        let notice = ScanProviderLimitNotice(
            scanRoot: event.scanRoot ?? "",
            provider: provider,
            stage: event.stage ?? ""
        )
        #expect(notice.provider == .codex)
        #expect(notice.scanRoot == "/Users/me/project")
    }

    @MainActor @Test func decodesWorkspaceScanBlockedEnvelope() throws {
        let payload = """
        {
          "type": "workspace_scan_blocked",
          "scanRoot": "/Users/me/project",
          "provider": "codex",
          "model": "gpt-5.5",
          "reason": "usage_limit",
          "message": "Codex hit a usage limit during workspace scan verification.",
          "nextProvider": "claude",
          "availableProviders": ["claude", "gemini"],
          "providerReadiness": [
            {
              "provider": "claude",
              "sdkInstalled": true,
              "authenticated": true,
              "scanReady": true,
              "source": "local-session",
              "message": "Local Claude login session",
              "sdkMessage": "Claude Agent SDK CLI is installed",
              "authAction": null
            },
            {
              "provider": "cursor",
              "sdkInstalled": true,
              "authenticated": false,
              "scanReady": false,
              "source": "missing",
              "message": "CURSOR_API_KEY를 설정하세요.",
              "sdkMessage": "Cursor Agent SDK is installed",
              "authAction": "cursor_api_key"
            }
          ],
          "errorKind": "provider_usage_limit",
          "stage": "blocked",
          "stepIndex": 2,
          "totalSteps": 3
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_scan_blocked")
        #expect(event.scanRoot == "/Users/me/project")
        #expect(event.provider == "codex")
        #expect(event.model == "gpt-5.5")
        #expect(event.reason == "usage_limit")
        #expect(event.message == "Codex hit a usage limit during workspace scan verification.")
        #expect(event.nextProvider == "claude")
        #expect(event.availableProviders == ["claude", "gemini"])
        #expect(event.providerReadiness?.count == 2)
        #expect(event.providerReadiness?.first?.provider == .claude)
        #expect(event.providerReadiness?.first?.scanReady == true)
        #expect(event.providerReadiness?.last?.authAction == "cursor_api_key")
        #expect(event.errorKind == "provider_usage_limit")
        #expect(event.stage == "blocked")
        #expect(event.stepIndex == 2)
        #expect(event.totalSteps == 3)

        let provider = try #require(AgentProvider(rawValue: event.provider ?? ""))
        let notice = WorkspaceScanBlockedNotice(
            scanRoot: event.scanRoot ?? "",
            provider: provider,
            model: event.model ?? "",
            reason: event.reason ?? "",
            message: event.message ?? "",
            nextProvider: event.nextProvider.flatMap(AgentProvider.init(rawValue:)),
            availableProviders: (event.availableProviders ?? []).compactMap(AgentProvider.init(rawValue:)),
            providerReadiness: event.providerReadiness ?? [],
            errorKind: event.errorKind
        )
        #expect(notice.provider == .codex)
        #expect(notice.nextProvider == .claude)
        #expect(notice.availableProviders == [.claude, .gemini])
        #expect(notice.providerReadiness.first?.provider == .claude)
        #expect(notice.providerReadiness.first?.scanReady == true)
        #expect(notice.scanRoot == "/Users/me/project")
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

    @MainActor @Test func structuredPromptQuestionDecodesEmphasisSpans() throws {
        let payload = """
        {
          "header": "현재 대안",
          "question": "config.json 파일에 마감일을 기록했나요?",
          "highlight_phrases": ["config.json"],
          "emphasis": [
            { "phrase": "config.json", "style": "code" },
            { "phrase": "마감일", "style": "mark" },
            { "phrase": "기록", "style": "strong" }
          ],
          "helperText": null,
          "options": null,
          "multiSelect": false,
          "allowFreeText": true,
          "freeTextPlaceholder": null,
          "textMode": "short"
        }
        """.data(using: .utf8)!

        let question = try JSONDecoder().decode(StructuredPromptQuestion.self, from: payload)
        // highlightPhrases remains available for back-compat consumers.
        #expect(question.highlightPhrases == ["config.json"])
        #expect(question.emphasis?.count == 3)
        #expect(question.emphasis?[0] == EmphasisSpan(phrase: "config.json", style: .code))
        #expect(question.emphasis?[1] == EmphasisSpan(phrase: "마감일", style: .mark))
        #expect(question.emphasis?[2] == EmphasisSpan(phrase: "기록", style: .strong))
    }

    @MainActor @Test func structuredPromptQuestionDecodesEmphasisSpansSnakeCaseKeyAndUnknownStyle() throws {
        let payload = """
        {
          "header": "질문",
          "question": "어떤 증거가 가장 강한가요?",
          "emphasis_spans": [
            { "phrase": "증거", "kind": "strong" },
            { "phrase": "가장 강한", "style": "spotlight" }
          ],
          "helperText": null,
          "options": null,
          "multiSelect": false,
          "allowFreeText": true,
          "freeTextPlaceholder": null,
          "textMode": "short"
        }
        """.data(using: .utf8)!

        let question = try JSONDecoder().decode(StructuredPromptQuestion.self, from: payload)
        #expect(question.emphasis?.count == 2)
        // `kind` alias resolves to the style.
        #expect(question.emphasis?[0] == EmphasisSpan(phrase: "증거", style: .strong))
        // Unknown/unsupported style falls back to `.mark`.
        #expect(question.emphasis?[1] == EmphasisSpan(phrase: "가장 강한", style: .mark))
    }

    @MainActor @Test func structuredPromptQuestionWithoutEmphasisPreservesHighlightPhrasesBackCompat() throws {
        let payload = """
        {
          "header": "질문",
          "question": "가장 강한 수요 증거가 뭐야?",
          "highlight_phrases": ["수요 증거"],
          "helperText": null,
          "options": null,
          "multiSelect": false,
          "allowFreeText": true,
          "freeTextPlaceholder": null,
          "textMode": "short"
        }
        """.data(using: .utf8)!

        let question = try JSONDecoder().decode(StructuredPromptQuestion.self, from: payload)
        // No emphasis -> nil, so the renderer falls back to the legacy
        // single-style highlightPhrases path (green accent chip).
        #expect(question.emphasis == nil)
        #expect(question.highlightPhrases == ["수요 증거"])
    }

    @MainActor @Test func decodesRecorderControlStateEvent() throws {
        let payload = """
        {
          "type": "recorder_control_state",
          "control_state": {
            "mode": "active",
            "consent": {
              "status": "granted",
              "visible_indicator_required": true,
              "visible_indicator_acknowledged": true
            },
            "permissions": {
              "screenRecording": "granted",
              "accessibility": "denied",
              "inputMonitoring": "unknown"
            },
            "sensitive_capture": {
              "clipboard_mode": "trigger_only",
              "microphone": false,
              "system_audio": false
            },
            "updated_at": "2026-06-28T09:00:00.000Z"
          },
          "readiness": {
            "can_record": false,
            "state": "blocked",
            "mode": "active",
            "visible_indicator_required": true,
            "visible_indicator_acknowledged": true,
            "blockers": [
              {
                "id": "accessibility_missing",
                "severity": "blocked",
                "message": "Accessibility permission is required for recorder capture.",
                "permission": "accessibility",
                "state": "denied"
              }
            ],
            "warnings": [
              {
                "id": "input_monitoring_degraded",
                "severity": "degraded",
                "message": "Input Monitoring is unavailable; capture will run with less context.",
                "permission": "inputMonitoring",
                "state": "unknown"
              }
            ]
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "recorder_control_state")
        #expect(event.controlState?.mode == "active")
        #expect(event.controlState?.consent.status == "granted")
        #expect(event.controlState?.consent.visibleIndicatorAcknowledged == true)
        #expect(event.controlState?.permissions["screenRecording"] == "granted")
        #expect(event.controlState?.permissions["accessibility"] == "denied")
        #expect(event.controlState?.sensitiveCapture.clipboardMode == "trigger_only")
        #expect(event.readiness?.canRecord == false)
        #expect(event.readiness?.blockers.first?.id == "accessibility_missing")
        #expect(event.readiness?.blockers.first?.permission == "accessibility")
        #expect(event.readiness?.warnings.first?.id == "input_monitoring_degraded")
    }

    @MainActor @Test func decodesRecorderFrameCaptureIngestedEvent() throws {
        let payload = """
        {
          "type": "recorder_frame_capture_ingested",
          "frame": {
            "id": "frame-1",
            "captured_at": "2026-06-28T09:00:00.000Z",
            "monitor_id": "display-1",
            "capture_trigger": "manual_swift_screencapturekit",
            "app_name": "Agentic30",
            "window_title": "Founder Replay",
            "snapshot_asset_id": "asset-1",
            "snapshot_sha256": "abc123",
            "content_hash": "abc123",
            "text_source": "screen_capture",
            "redaction_status": "not_redacted",
            "privacy_state": "raw_local",
            "safe_for_search": false,
            "safe_for_memory": false,
            "safe_for_export": false,
            "proof_accepted_by_recorder_ingest": false
          },
          "media_asset": {
            "id": "asset-1",
            "asset_type": "frame_jpeg",
            "sha256": "abc123",
            "byte_size": 42,
            "encrypted": false,
            "path_exposed": false
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "recorder_frame_capture_ingested")
        #expect(event.frame?.id == "frame-1")
        #expect(event.frame?.captureTrigger == "manual_swift_screencapturekit")
        #expect(event.frame?.proofAcceptedByRecorderIngest == false)
        #expect(event.mediaAsset?.id == "asset-1")
        #expect(event.mediaAsset?.pathExposed == false)
    }

    @MainActor @Test func decodesRecorderFrameCaptureDeletedEvent() throws {
        let payload = """
        {
          "type": "recorder_frame_capture_deleted",
          "deletion": {
            "status": "deleted",
            "frame_id": "frame-1",
            "media_asset_id": "asset-1",
            "media_removed": true,
            "path_exposed": false,
            "deleted_at": "2026-06-28T09:01:00.000Z",
            "proof_accepted_by_recorder_delete": false
          },
          "proof_accepted_by_recorder_delete": false,
          "proof_ledger_write_allowed": false
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "recorder_frame_capture_deleted")
        #expect(event.deletion?.frameId == "frame-1")
        #expect(event.deletion?.mediaAssetId == "asset-1")
        #expect(event.deletion?.mediaRemoved == true)
        #expect(event.deletion?.pathExposed == false)
        #expect(event.deletion?.proofAcceptedByRecorderDelete == false)
    }

    @MainActor @Test func decodesRecorderFrameCapturesDeletedEvent() throws {
        let payload = """
        {
          "type": "recorder_frame_captures_deleted",
          "deletion_range": {
            "status": "deleted",
            "frame_count": 2,
            "media_removed_count": 2,
            "frame_ids": ["frame-1", "frame-2"],
            "media_asset_ids": ["asset-1", "asset-2"],
            "path_exposed": false,
            "deleted_at": "2026-06-28T09:05:00.000Z"
          },
          "proof_accepted_by_recorder_delete": false,
          "proof_ledger_write_allowed": false
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "recorder_frame_captures_deleted")
        #expect(event.deletionRange?.status == "deleted")
        #expect(event.deletionRange?.frameCount == 2)
        #expect(event.deletionRange?.mediaRemovedCount == 2)
        #expect(event.deletionRange?.frameIds == ["frame-1", "frame-2"])
        #expect(event.deletionRange?.mediaAssetIds == ["asset-1", "asset-2"])
        #expect(event.deletionRange?.pathExposed == false)
    }

    @MainActor @Test func decodesRecorderFrameCapturesEvent() throws {
        let payload = """
        {
          "type": "recorder_frame_captures",
          "frames": [
            {
              "id": "frame-2",
              "captured_at": "2026-06-28T09:02:00.000Z",
              "monitor_id": "display-1",
              "capture_trigger": "auto_swift_screencapturekit_interval",
              "app_name": "Agentic30",
              "window_title": "Founder Replay",
              "snapshot_asset_id": "asset-2",
              "snapshot_sha256": "def456",
              "content_hash": "def456",
              "text_source": "screen_capture",
              "redaction_status": "not_redacted",
              "privacy_state": "raw_local",
              "safe_for_search": false,
              "safe_for_memory": false,
              "safe_for_export": false,
              "proof_accepted_by_recorder_ingest": false
            }
          ],
          "proof_accepted_by_recorder_frames": false,
          "proof_ledger_write_allowed": false
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "recorder_frame_captures")
        #expect(event.frames?.count == 1)
        #expect(event.frames?.first?.id == "frame-2")
        #expect(event.frames?.first?.captureTrigger == "auto_swift_screencapturekit_interval")
        #expect(event.frames?.first?.proofAcceptedByRecorderIngest == false)
    }

    @MainActor @Test func decodesRecorderRawApiTokenIssuedEvent() throws {
        let payload = """
        {
          "type": "recorder_raw_api_token_issued",
          "recorder_raw_api": {
            "enabled": true,
            "host": "127.0.0.1",
            "port": 31337,
            "url": "http://127.0.0.1:31337",
            "token_issuer": "sidecar_websocket",
            "proof_accepted_by_raw_api": false
          },
          "token": {
            "token": "a30_recorder_local_token",
            "token_id": "token-1",
            "client_id": "agentic30-founder-replay",
            "scopes": ["raw_frame"],
            "issued_at": "2026-06-28T09:03:00.000Z",
            "expires_at": "2026-06-28T09:04:00.000Z"
          },
          "proof_accepted_by_raw_api": false
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        #expect(event.type == "recorder_raw_api_token_issued")
        #expect(event.recorderRawApi?.enabled == true)
        #expect(event.recorderRawApi?.url == "http://127.0.0.1:31337")
        #expect(event.recorderRawApi?.proofAcceptedByRawApi == false)
        #expect(event.recorderRawApiToken?.clientId == "agentic30-founder-replay")
        #expect(event.recorderRawApiToken?.scopes == ["raw_frame"])
    }

    @MainActor @Test func decodesRecorderPipeManagementEvents() throws {
        let statePayload = """
        {
          "type": "recorder_pipes_state",
          "pipes": [
            {
              "id": "daily-founder-memory",
              "workspace_id": null,
              "project_id": null,
              "path": ".agentic30/pipes/daily-founder-memory/pipe.md",
              "name": "Daily Founder Memory",
              "schedule": "every day at 18:00",
              "enabled": true,
              "pipe_kind": "built_in",
              "proof_accepted_by_pipe_definition": false
            }
          ],
          "runs": [
            {
              "id": "run-1",
              "pipe_id": "daily-founder-memory",
              "trigger_reason": "manual",
              "status": "succeeded",
              "started_at": "2026-06-28T09:00:00.000Z",
              "ended_at": "2026-06-28T09:00:01.000Z",
              "error_message": "",
              "proof_accepted_by_pipe_run": false
            }
          ]
        }
        """
        let state = try decoder.decode(SidecarEvent.self, from: Data(statePayload.utf8))
        #expect(state.pipes?.first?.id == "daily-founder-memory")
        #expect(state.pipes?.first?.kind == "built_in")
        #expect(state.pipes?.first?.proofAcceptedByPipeDefinition == false)
        #expect(state.runs?.first?.pipeId == "daily-founder-memory")
        #expect(state.runs?.first?.status == "succeeded")
        #expect(state.runs?.first?.proofAcceptedByPipeRun == false)

        let runPayload = """
        {
          "type": "recorder_pipe_run_result",
          "pipeRun": {
            "id": "run-2",
            "pipeId": "evidence-inbox-builder",
            "triggerReason": "manual",
            "status": "failed",
            "startedAt": "2026-06-28T09:00:00.000Z",
            "endedAt": "2026-06-28T09:00:01.000Z",
            "errorMessage": "ERR_RECORDER_PIPE_RUN_FAILED",
            "proofAcceptedByPipeRun": false
          },
          "runs": []
        }
        """
        let run = try decoder.decode(SidecarEvent.self, from: Data(runPayload.utf8))
        #expect(run.pipeRun?.pipeId == "evidence-inbox-builder")
        #expect(run.pipeRun?.errorMessage == "ERR_RECORDER_PIPE_RUN_FAILED")

        let schedulerPayload = """
        {
          "type": "recorder_pipe_scheduler_tick_result",
          "enqueueResult": {
            "queued_count": 1,
            "skipped_count": 2,
            "executed_count": 0,
            "failed_count": 0,
            "proof_accepted_by_scheduler": false
          },
          "drainResult": {
            "queuedCount": 0,
            "skippedCount": 0,
            "executedCount": 1,
            "failedCount": 0,
            "proofAcceptedByScheduler": false
          },
          "runs": []
        }
        """
        let scheduler = try decoder.decode(SidecarEvent.self, from: Data(schedulerPayload.utf8))
        #expect(scheduler.enqueueResult?.queuedCount == 1)
        #expect(scheduler.enqueueResult?.skippedCount == 2)
        #expect(scheduler.drainResult?.executedCount == 1)
        #expect(scheduler.drainResult?.proofAcceptedByScheduler == false)
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

    private static func mirrorChild(_ label: String, in value: Any?) -> Any? {
        guard let value = unwrapOptional(value) else { return nil }
        for child in Mirror(reflecting: value).children where child.label == label {
            return unwrapOptional(child.value)
        }
        return nil
    }

    private static func unwrapOptional(_ value: Any?) -> Any? {
        guard let value else { return nil }
        let mirror = Mirror(reflecting: value)
        guard mirror.displayStyle == .optional else { return value }
        return mirror.children.first.map(\.value)
    }

    private func assertSidecarEventDecodeFails(_ payload: String, code: String) throws {
        do {
            _ = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
            Issue.record("Expected \(code) decoding failure")
        } catch {
            #expect(String(describing: error).contains(code))
        }
    }

    private func dailyCard(_ payload: String) throws -> SidecarEvent.MissionCard.DailyCard {
        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))
        return try #require(event.missionCard?.dailyCard)
    }

    private static let legacyMissionCardPayload = """
    {
      "type": "mission_card",
      "workspaceRoot": "/Users/october/prj/myapp",
      "missionCard": {
        "schemaVersion": 1,
        "day": 9,
        "source": "idd",
        "mission": {
          "day": 9,
          "title": "입력→처리→출력 흐름을 고정한다",
          "shortTitle": "Input Flow",
          "summary": "사용자가 바로 써볼 수 있게 입력, 처리, 결과 화면을 한 번에 지나가게 만든다.",
          "tasks": ["첫 입력 포맷 1개만 선택", "처리 실패와 빈 입력 폴백 작성", "결과 화면까지 30초 이내인지 재기"],
          "output": "input-process-output flow",
          "dayType": "action",
          "phase": "build",
          "curriculumWeek": 2,
          "substituted": false,
          "substitutionReason": "",
          "exitCondition": ""
        },
        "evidenceSpec": {
          "evidenceRequired": true,
          "artifact": "input-process-output flow",
          "allowedEvidenceTypes": ["link", "file"],
          "minimumStrength": "medium",
          "completionSignal": "증거 제출 후 판정이 accepted 또는 verified가 되어야 합니다."
        },
        "gateContext": {
          "day": 9,
          "blockingGateId": null,
          "states": { "G1": "passed", "G2": "passed", "G4": "locked" }
        },
        "generatedAt": "2026-06-12T09:00:00.000Z"
      }
    }
    """

    private static let v2StateTransitionPayload = """
    {
      "type": "mission_card",
      "workspaceRoot": "/tmp/product",
      "missionCard": {
        "type": "office_hours_state_transition",
        "schemaVersion": 1,
        "programDay": 14,
        "generation": {
          "signalId": "office-hours-state-transition",
          "signalLabel": "Office Hours stale commitment"
        },
        "sourceState": "stale",
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
    """

    private static let v2StateTransitionPayloadWithGeneration = """
    {
      "type": "mission_card",
      "workspaceRoot": "/tmp/product",
      "missionCard": {
        "type": "office_hours_state_transition",
        "schemaVersion": 1,
        "programDay": 14,
        "generation": {
          "signalId": "office-hours-state-transition",
          "signalLabel": "Office Hours stale commitment",
          "generationId": "generation-state-transition"
        },
        "sourceState": "stale",
        "sourceStateVersion": "state-transition-v1",
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
    """

    private static let v2WorkpackPayload = """
    {
      "type": "mission_card",
      "workspaceRoot": "/tmp/product",
      "missionCard": {
        "type": "office_hours_agent_workpack",
        "schemaVersion": 1,
        "programDay": 14,
        "generation": {
          "signalId": "office-hours-workpack",
          "signalLabel": "Office Hours agent workpack"
        },
        "sourceState": "ready",
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
    """

    private static let v2MalformedWorkpackPayload = """
    {
      "type": "mission_card",
      "workspaceRoot": "/tmp/product",
      "missionCard": {
        "type": "office_hours_agent_workpack",
        "schemaVersion": 1,
        "programDay": 14,
        "generation": {
          "signalId": "office-hours-workpack",
          "signalLabel": "Office Hours agent workpack"
        },
        "sourceState": "ready",
        "requiresUserAction": true,
        "proofLedgerMapping": {
          "paymentIntent": "firstRevenue.learningSignal",
          "paymentRecord": "firstRevenue.acceptedProof"
        },
        "selectedLens": "service_planning",
        "workpack": {
          "id": "workpack_day_14_g4",
          "workType": "offer/paid ask",
          "targetExternalAction": "",
          "expectedProof": "Sent screenshot, sent time, recipient identifier, and reply text.",
          "notProof": [],
          "owner": "founder",
          "deadline": "2026-06-20T18:00:00+09:00"
        }
      }
    }
    """

    private static let v2MissingSourceStatePayload = """
    {
      "type": "mission_card",
      "workspaceRoot": "/tmp/product",
      "missionCard": {
        "type": "office_hours_agent_workpack",
        "schemaVersion": 1,
        "programDay": 14,
        "generation": {
          "signalId": "office-hours-workpack",
          "signalLabel": "Office Hours agent workpack"
        },
        "requiresUserAction": true,
        "proofLedgerMapping": {
          "paymentIntent": "firstRevenue.learningSignal",
          "paymentRecord": "firstRevenue.acceptedProof"
        },
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
    """

    private static let v2ScoreboardPayload = """
    {
      "type": "mission_card",
      "workspaceRoot": "/tmp/product",
      "missionCard": {
        "type": "program_scoreboard_snapshot",
        "schemaVersion": 1,
        "programDay": 21,
        "generation": {
          "signalId": "program-scoreboard",
          "signalLabel": "Program scoreboard"
        },
        "sourceState": "ready",
        "requiresUserAction": false,
        "proofLedgerMapping": {
          "first_value": "activeUsers100.acceptedProof",
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
            "sourceState": "manual_proof_required",
            "nextUnblockAction": "offer/paid ask follow-up plan"
          }
        }
      }
    }
    """

    private static let v2SelfReportProofPayload = """
    {
      "type": "mission_card",
      "workspaceRoot": "/tmp/product",
      "missionCard": {
        "type": "program_scoreboard_snapshot",
        "schemaVersion": 1,
        "programDay": 21,
        "generation": {
          "signalId": "program-scoreboard",
          "signalLabel": "Program scoreboard"
        },
        "sourceState": "ready",
        "requiresUserAction": false,
        "proofLedgerMapping": {
          "first_value": "activeUsers100.acceptedProof",
          "self_report": "firstRevenue.acceptedProof"
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
            "sourceState": "manual_proof_required",
            "nextUnblockAction": "offer/paid ask follow-up plan"
          }
        }
      }
    }
    """

    private static let v2InvalidProofMappingPayload = """
    {
      "type": "mission_card",
      "workspaceRoot": "/tmp/product",
      "missionCard": {
        "type": "revenue_or_activation_gate",
        "schemaVersion": 1,
        "programDay": 14,
        "generation": {
          "signalId": "revenue-or-activation-gate",
          "signalLabel": "Revenue or activation gate"
        },
        "sourceState": "missing",
        "requiresUserAction": true,
        "proofLedgerMapping": {
          "paymentIntent": "firstRevenue.acceptedProof"
        },
        "gate": "G4",
        "requires": ["first_value", "paymentIntent"],
        "satisfied": false,
        "blockingReasons": ["missing first_value source", "paymentRecord missing"],
        "recoveryBranch": "g4-recovery-instrumentation",
        "nextCardType": "office_hours_agent_workpack"
      }
    }
    """

    private static let v2GatePayload = """
    {
      "type": "mission_card",
      "workspaceRoot": "/tmp/product",
      "missionCard": {
        "type": "revenue_or_activation_gate",
        "schemaVersion": 1,
        "programDay": 14,
        "generation": {
          "signalId": "revenue-or-activation-gate",
          "signalLabel": "Revenue or activation gate"
        },
        "sourceState": "missing",
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
    """
}

private final class Todo8DailyCardCapturingSidecar: SidecarTransport {
    var onEvent: ((SidecarEvent) -> Void)?
    private(set) var sentPayloads: [[String: Any]] = []

    func start() {}
    func stop() {}

    @discardableResult
    func send(payload: [String: Any]) -> Bool {
        sentPayloads.append(payload)
        return true
    }
}

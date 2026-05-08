import Foundation
import Testing
@testable import agentic30

struct SidecarEventDecodingTests {
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
                "message": "Codex SDK and CLI binary are installed"
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
        #expect(event.environment?.acp?.available == true)
        #expect(event.sessions?.count == 1)
        #expect(event.sessions?.first?.messages.first?.content == "OK")
        #expect(event.sessions?.first?.pendingUserInput?.requestId == "request-1")
        #expect(event.sessions?.first?.pendingUserInput?.questions.first?.allowFreeText == true)
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

    @MainActor @Test func decodesRubricQuarantineListPayload() throws {
        // R6 / CCG-Codex: protocol drift safety net for the quarantine list
        // wire shape. If sidecar emit shape changes, this test catches the
        // Swift-side decoder gap before runtime regression.
        let payload = """
        {
          "type": "rubric_quarantine_list",
          "items": [
            {
              "file": {
                "path": "/tmp/.agentic30/rubric-assessments.json.invalid-2026-05-08T01-00.json",
                "name": "rubric-assessments.json.invalid-2026-05-08T01-00.json",
                "size": 256,
                "mtimeMs": 1746662400000
              },
              "dump": {
                "sourceFile": "/tmp/.agentic30/rubric-assessments.json",
                "quarantinedAt": "2026-05-08T01:00:00.000Z",
                "mtimeMs": 1746662400000,
                "records": [
                  {
                    "index": 0,
                    "issues": [
                      {
                        "path": ["axes", "clout", "evidence_refs"],
                        "message": "Day 30 requires evidence_refs or no_evidence_reason for axis \\"clout\\""
                      }
                    ],
                    "proposal": {
                      "kind": "missing_no_evidence_reason",
                      "axis": "clout",
                      "suggestion": "Day 30 마감인데 clout 축에 근거가 없습니다."
                    },
                    "originalSummary": "session-1 · Day 30"
                  }
                ]
              }
            }
          ]
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "rubric_quarantine_list")
        #expect(event.items?.count == 1)
        #expect(event.items?.first?.file.name.hasPrefix("rubric-assessments") == true)
        #expect(event.items?.first?.dump.records.count == 1)
        #expect(event.items?.first?.dump.records.first?.proposal?.kind == "missing_no_evidence_reason")
        #expect(event.items?.first?.dump.records.first?.proposal?.axis == "clout")
        #expect(event.items?.first?.dump.records.first?.originalSummary == "session-1 · Day 30")
        #expect(event.items?.first?.dump.records.first?.issues.first?.displayPath == "axes.clout.evidence_refs")
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
        let payload = """
        {
          "type": "session_updated",
          "session": {
            "id": "idd-session-1",
            "title": "IDD: ICP [IDD:icp]",
            "provider": "codex",
            "model": "",
            "status": "awaiting_input",
            "createdAt": "2026-04-27T01:00:00.000Z",
            "updatedAt": "2026-04-27T01:00:01.000Z",
            "error": null,
            "messages": [],
            "pendingUserInput": {
              "requestId": "request-icp-1",
              "sessionId": "idd-session-1",
              "toolName": "request_user_input",
              "title": "첫 ICP 구체화",
              "createdAt": "2026-04-27T01:00:01.000Z",
              "questions": [
                {
                  "header": "ICP 좁히기",
                  "helperText": "진단: 제품: Agentic30 / 대상: 전업 1인 개발자, 수익 0원, macOS 사용자 / 문제: 만들 줄은 있지만 무엇을 만들어야 팔리는지 모른다 / 목적: 30일 안에 PMF 검증 방향을 좁힌다. 오늘은 이 범주를 더 좁혀 첫 ICP 후보 하나를 고릅니다.",
                  "question": "Agentic30은 전업 1인 개발자, 수익 0원, macOS 사용자의 만들 줄은 있지만 무엇을 만들어야 팔리는지 모른다 문제를 다룹니다.\\n첫 ICP를 이 범주 전체로 두면 너무 넓습니다. 이번 주에 검증할 가장 좁은 하위 ICP는 누구인가요?",
                  "options": [
                    {
                      "label": "퇴사 후 수익 0원 1인 개발자",
                      "description": "저축 소진 압박이 있어 30일 안에 사용자 증거와 첫 매출 신호를 원합니다.",
                      "nextIntent": "full_time_zero_revenue_indie"
                    },
                    {
                      "label": "에이전트로 MVP 만든 개발자",
                      "description": "Claude/Codex로 만들 수 있지만 무엇을 팔지, 누구에게 물을지 막혀 있습니다.",
                      "nextIntent": "agent_built_mvp_no_customers"
                    },
                    {
                      "label": "인터뷰/BIP 기록 의향 있음",
                      "description": "프로젝트 path, 업무 일지, 고객 인터뷰, 공개 기록을 매일 입력할 수 있습니다.",
                      "nextIntent": "records_ready_builder"
                    },
                    {
                      "label": "다른 하위 ICP",
                      "description": "자유입력에 역할, 상황, 현재 대안, 연락 가능성을 함께 적습니다.",
                      "nextIntent": "other_specific_icp"
                    }
                  ],
                  "multiSelect": false,
                  "allowFreeText": true,
                  "freeTextPlaceholder": "예: 현재 Claude Code로 MVP는 만들었지만 유료 고객이 없는 macOS 1인 개발자",
                  "textMode": "short"
                }
              ]
            },
            "runtime": {
              "pendingIddContinuation": {
                "requestId": "request-icp-1",
                "docType": "icp",
                "prompt": "IDD 문서 인터뷰를 시작합니다: ICP"
              }
            }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "session_updated")
        #expect(event.session?.status == .awaitingInput)
        #expect(event.session?.pendingUserInput?.toolName == "request_user_input")
        #expect(event.session?.pendingUserInput?.title == "첫 ICP 구체화")
        #expect(event.session?.pendingUserInput?.questions.first?.helperText?.contains("Agentic30") == true)
        #expect(event.session?.pendingUserInput?.questions.first?.question.contains("가장 좁은 하위 ICP") == true)
        #expect(event.session?.pendingUserInput?.questions.first?.options?.map(\.label) == ["퇴사 후 수익 0원 1인 개발자", "에이전트로 MVP 만든 개발자", "인터뷰/BIP 기록 의향 있음", "다른 하위 ICP"])
        #expect(event.session?.pendingUserInput?.questions.first?.options?.last?.nextIntent == "other_specific_icp")
        #expect(event.session?.pendingUserInput?.questions.first?.freeTextPlaceholder?.contains("유료 고객") == true)
    }

    @MainActor @Test func decodesBipCoachStateWithOwningSession() throws {
        let payload = """
        {
          "type": "bip_coach_state",
          "bipCoach": {
            "schemaVersion": 1,
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
            "suggestedFirstQuestion": "현재 ICP가 전업 1인 개발자까지는 보입니다. 이번 주에 검증할 더 좁은 하위 ICP는 누구인가요?"
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
        #expect(event.onboardingHypothesis?.confidence == "high")
        #expect(event.onboardingHypothesis?.productName == "Agentic30")
        #expect(event.onboardingHypothesis?.targetUser?.contains("전업 1인 개발자") == true)
        #expect(event.onboardingHypothesis?.likelyUsers?.first == "AI 코딩 도구를 쓰는 개발자")
        #expect(event.error == nil)
    }

    @MainActor @Test func decodesWorkspaceScanResultWithError() throws {
        let payload = """
        {
          "type": "workspace_scan_result",
          "scanRoot": "/Users/october/prj/myapp",
          "error": "Agent could not identify documents in this workspace."
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "workspace_scan_result")
        #expect(event.error == "Agent could not identify documents in this workspace.")
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
                  "entrypointPath": "/repo/node_modules/@openai/codex-darwin-arm64/vendor/aarch64-apple-darwin/codex/codex"
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
        #expect(event.diagnostics?.preflight?.status == "warning")
        #expect(event.diagnostics?.preflight?.checks.first?.id == "provider-auth")
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

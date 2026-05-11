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
              "toolName": "agentic30_request_user_input",
              "title": "ICP 1/4",
              "createdAt": "2026-04-27T01:00:01.000Z",
              "intro": {
                "title": "ICP (Ideal Customer Profile)",
                "body": "ICP는 가장 먼저 집중할 이상적 고객 유형입니다. 처음부터 완벽하게 쓰기보다, 이번 주 실제로 연락하고 인터뷰할 수 있는 좁은 고객 후보 하나를 고르면 됩니다.",
                "bullets": [
                  "상황: 직함보다 지금 어떤 문제 상황에 있는지",
                  "현재 대안: 지금 어떤 수작업이나 도구로 버티는지"
                ]
              },
              "resources": [
                {
                  "title": "How we found our Ideal Customer Profile",
                  "source": "PostHog",
                  "url": "https://posthog.com/founders/creating-ideal-customer-profile",
                  "description": "PostHog가 ICP를 좁힌 과정입니다."
                }
              ],
              "generation": {
                "mode": "host_structured",
                "docType": "icp"
              },
              "questions": [
                {
                  "header": "첫 고객",
                  "helperText": "README와 최근 변경을 보면 agentic30-public의 SwiftUI macOS 앱입니다.",
                  "question": "agentic30-public의 SwiftUI macOS 앱과 Node sidecar 흐름에서 Day 1에 먼저 검증할 사용자는 누구인가요?",
                  "options": [
                    {
                      "label": "Codex/Claude 전환 사용자",
                      "description": "provider 인증과 실행 전환에서 막히는 실제 사용자입니다.",
                      "nextIntent": "provider_switch_user"
                    },
                    {
                      "label": "30일 커리큘럼 참가자",
                      "description": "Foundation Setup 문서를 통과해야 다음 Day로 넘어갑니다.",
                      "nextIntent": "curriculum_day1_user"
                    },
                    {
                      "label": "macOS 메뉴바 앱 사용자",
                      "description": "SwiftUI panel에서 질문/응답 정체를 직접 겪습니다.",
                      "nextIntent": "macos_panel_user"
                    },
                    {
                      "label": "직접 입력",
                      "description": "역할, 상황, 현재 대안을 한 줄로 적습니다.",
                      "nextIntent": "other_specific_icp"
                    }
                  ],
                  "multiSelect": false,
                  "allowFreeText": true,
                  "requiresFreeText": true,
                  "freeTextPlaceholder": "예: Day 1 참가자가 provider 인증 실패 후 질문에 갇힌다",
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
        #expect(event.session?.pendingUserInput?.questions.first?.helperText?.contains("agentic30-public") == true)
        #expect(event.session?.pendingUserInput?.questions.first?.question.contains("SwiftUI macOS 앱") == true)
        #expect(event.session?.pendingUserInput?.questions.first?.options?.map(\.label) == ["Codex/Claude 전환 사용자", "30일 커리큘럼 참가자", "macOS 메뉴바 앱 사용자", "직접 입력"])
        #expect(event.session?.pendingUserInput?.questions.first?.options?.last?.nextIntent == "other_specific_icp")
        #expect(event.session?.pendingUserInput?.questions.first?.requiresFreeText == true)
        #expect(event.session?.pendingUserInput?.questions.first?.freeTextPlaceholder?.contains("provider 인증 실패") == true)
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

    @MainActor @Test func identifiesLegacyStaticIddStructuredPromptPayload() throws {
        let payload = """
        {
          "type": "session_updated",
          "session": {
            "id": "idd-session-legacy",
            "title": "Foundation Setup: ICP",
            "provider": "codex",
            "model": "",
            "status": "awaiting_input",
            "createdAt": "2026-04-27T01:00:00.000Z",
            "updatedAt": "2026-04-27T01:00:01.000Z",
            "error": null,
            "messages": [],
            "pendingUserInput": {
              "requestId": "request-static-1",
              "sessionId": "idd-session-legacy",
              "toolName": "request_user_input",
              "title": "ICP 1/4",
              "createdAt": "2026-04-27T01:00:01.000Z",
              "questions": [
                {
                  "header": "첫 고객",
                  "question": "이번 주 바로 인터뷰할 첫 고객은 누구인가요?",
                  "options": [
                    { "label": "가장 절박한 하위 ICP", "description": "legacy" }
                  ],
                  "allowFreeText": true,
                  "freeTextPlaceholder": "예: MVP는 있지만 유료 고객이 없는 macOS 1인 개발자",
                  "textMode": "short"
                }
              ]
            },
            "runtime": { "iddDocumentType": "icp" }
          }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.session?.pendingUserInput?.isLegacyStaticIddQuestion == true)
        #expect(event.session?.pendingUserInput?.isProviderAdaptiveIddQuestion == false)
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

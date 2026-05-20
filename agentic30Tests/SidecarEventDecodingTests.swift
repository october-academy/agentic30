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
        #expect(event.environment?.gemini?.source == "api-key")
        #expect(event.environment?.gemini?.sdk?.packageName == "@google/genai")
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
                  { "id": "o1", "label": "대안이 있음", "description": "이미 비용을 씀", "preview": "Have", "antiSignal": false },
                  { "id": "o2", "label": "관심만 있음", "description": "최근 사건 없음", "preview": "Weak", "antiSignal": true }
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
        #expect(event.day1IcpPlan?.icpDraft.description.contains("support lead") == true)
        #expect(event.day1IcpPlan?.antiIcp.rules.first?.label == "흥미롭네요만 말함")
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

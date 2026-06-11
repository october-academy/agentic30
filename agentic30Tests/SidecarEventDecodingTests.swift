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
                  "terminalAnswered": true
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
        // 사이드카가 대안 비교(종결 카드) 답변 시 스탬프하는 인터뷰 완료 신호 —
        // commitment 바와 doc-ready 게이트가 답변 수 대신 이 신호로도 열린다.
        #expect(event.sessions?.first?.runtime?.officeHours?.terminalAnswered == true)
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
              "title": "overnight digest",
              "windowLabel": "2026-06-09 00:00 -> 2026-06-10 now",
              "statement": "밤사이 가장 큰 변화는 PostHog 활성 사용자 ▼ 56% 하락이에요.",
              "crits": [
                { "source": "PostHog", "label": "활성 사용자", "value": "▼ 56%", "direction": "down" }
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
        let card = try #require(briefing.cards?.first)
        #expect(card.id == "posthog")
        #expect(card.isReady)
        #expect(card.metric?.deltaLabel == "▼ 56%")
        #expect(card.spark == [22, 25, 11])
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
                "draftsEmpty": { "title": "코드에서 꺼낼 다음 일이 없어요", "detail": "신호 없음", "evidence": "근거: gh CLI" },
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
        #expect(drilldown.draftsEmpty?.title == "코드에서 꺼낼 다음 일이 없어요")
        #expect(drilldown.maintenance?.first?.badge == "문서")
        #expect(drilldown.meta?.progress?.ratio == 1)
        #expect(drilldown.meta?.rows?.first?.key == "리포")
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
        #expect(status.checkedAt == "2026-06-10T09:00:00.000Z")
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

    @MainActor @Test func decodesMorningBriefingCollectingStatusPayload() throws {
        let payload = """
        {
          "type": "morning_briefing_status",
          "status": { "state": "collecting", "reason": "tab_enter" }
        }
        """

        let event = try decoder.decode(SidecarEvent.self, from: Data(payload.utf8))

        #expect(event.type == "morning_briefing_status")
        #expect(event.morningBriefing == nil)
        #expect(event.morningBriefingStatus?.state == "collecting")
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
        #expect(event.session?.pendingUserInput?.title == "고객 후보 1/4")
        #expect(event.session?.pendingUserInput?.intro?.title == "고객 후보")
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

        // Day-1 stepper/badge display layer drops the intro stages (onboarding, scan)
        // while the data axis above keeps all four. Day 2+ stays on the full loop.
        #expect(day1?.displaySteps.map({ $0.id }) == ["goal", "first_interview"])
        #expect(day1?.displayTotalCount == 2)
        #expect(day1?.displayCompletedCount == 2)
        #expect(day1?.isDisplayComplete == true)
        #expect(day7?.displaySteps.count == 5)
        #expect(day7?.displayCompletedCount == 3)

        #expect(event.dayProgress?.recordedDaysDescending.first?.day == 7)
        #expect(event.error == nil)
        // Additive/optional: a day_progress_state with no officeHoursMemory decodes to nil.
        #expect(event.officeHoursMemory == nil)
        #expect(event.dayReviews == nil)
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

    @MainActor @Test func decodesDayProgressStateWithOfficeHoursHistoryRollup() throws {
        let payload = """
        {
          "type": "day_progress_state",
          "workspaceRoot": "/Users/october/prj/myapp",
          "officeHoursHistory": {
            "schemaVersion": 1,
            "day": 30,
            "onboarding": {
              "role": "developer",
              "timeBudget": "daily_1_2h",
              "blocker": "building",
              "records": "project_folder,work_log",
              "projectPath": "/Users/october/prj/myapp",
              "readSources": ["GitHub:connected", "Notion:disabled"],
              "summary": "역할=developer"
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

        // Day 2+ (standard) is unaffected — the full macro loop stays visible.
        let day7 = DayRecord(
            day: 7,
            kind: .standard,
            steps: ["scan": .done, "retro": .done, "goal": .active, "interview": .pending, "execution": .pending]
        )
        #expect(day7.displaySteps.map({ $0.id }) == ["scan", "retro", "goal", "interview", "execution"])
        #expect(day7.displayTotalCount == 5)
        #expect(day7.displayCompletedCount == 2)
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
            { "phrase": "docs/ICP.md", "style": "code" }
          ],
          "statement": "support lead 고객을 docs/ICP.md 기준으로 확인",
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
        #expect(component.emphasis?[1] == EmphasisSpan(phrase: "docs/ICP.md", style: .code))
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

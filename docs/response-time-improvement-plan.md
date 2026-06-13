# Mac Chat Response-Time Improvement Plan

## Goal

Keep Day 1 coaching usable for the ICP user: a macOS solo developer who expects quick tactical feedback while working through the curriculum. The target budget is:

- Live Day 1 UI E2E: every turn records phase breakdown; hard timeout 240 seconds, target p50 under 20 seconds after warm-up.
- `instant_chat`: first visible response under 300ms, complete short answer under 1 second. This path must not start Claude/Codex Agent SDK, MCP setup, workspace scan, Notion, QMD, or gws.
- Normal SDK-backed `fast_chat`: first provider text target under 5 seconds; completion remains provider-dependent and must stream progress.
- Agentic/tool path: visible phase updates within 2 seconds, then streamed progress until completion.

## Current Baseline

The Day 1 tests now separate hermetic instrumentation from live provider validation:

- `sidecar-tests/day1-icp-conversation.test.mjs` has a local instrumentation test and an opt-in live Codex SDK test.
- `agentic30UITests.testDay1ICPUserFiveTurnConversationSimulation` is opt-in with `AGENTIC30_RUN_LIVE_PROVIDER_E2E=1`, launches the real macOS app, types five prompts, and waits for live response markers rendered in the UI.
- The live tests do not set `AGENTIC30_TEST_STUB_PROVIDER`; responses must come through `@openai/codex-sdk`.
- Each assistant message persists `performance.marks` in `sessions.json` and emits `tool_event` summaries named `response_timing`.

Run the live UI test from the repo root after explicit local desktop approval:

```sh
AGENTIC30_ALLOW_BLOCKING_UI_E2E=1 \
AGENTIC30_RUN_LIVE_PROVIDER_E2E=1 \
AGENTIC30_CODEX_MODEL=gpt-5.4-mini \
AGENTIC30_CODEX_REASONING_EFFORT=low \
xcodebuild test \
  -project agentic30.xcodeproj \
  -scheme agentic30 \
  -only-testing:agentic30UITests/agentic30UITests/testDay1ICPUserFiveTurnConversationSimulation
```

Run the live sidecar test without macOS UI focus risk:

```sh
AGENTIC30_RUN_LIVE_PROVIDER_E2E=1 \
AGENTIC30_CODEX_MODEL=gpt-5.4-mini \
AGENTIC30_CODEX_REASONING_EFFORT=low \
node --test sidecar-tests/day1-icp-conversation.test.mjs
```

## Breakdown Marks

Use these marks to locate the root cause of long turns:

- `prompt.accepted` to `session.persisted_before_provider`: app/sidecar queue and persistence overhead.
- `route.classified`: route selection overhead.
- `context.built`: local ICP/SPEC/BIP context read and prompt assembly.
- `instant.response_ready`: local cached-context response completion. This should stay under 1 second.
- `provider.call_start` to `provider.codex.stream_opened`: Codex SDK client/thread startup.
- `provider.codex.stream_opened` to `provider.codex.first_event`: provider queue/network latency.
- `provider.codex.first_event` to `provider.codex.first_text`: model reasoning before visible output.
- `provider.codex.first_text` to `provider.codex.final_message`: answer generation time.
- `provider.call_finished` to `prompt.completed`: sidecar finalization and session persistence.

## Latest Live Baseline

Measured on 2026-04-27 with `AGENTIC30_CODEX_MODEL=gpt-5.4-mini` and `AGENTIC30_CODEX_REASONING_EFFORT=low`:

- Turn totals: 9.2s, 7.0s, 6.0s, 5.6s, 4.8s.
- Sidecar overhead before provider stream: 1-3ms per turn.
- Provider stream open to first event: 87-412ms after the first turn.
- Dominant cost: model generation/final message time, 4.5-8.9s.
- Root cause found and fixed: route classification treated `docs/ICP.md` slash, `TURN` marker `run`, `builder-state` `build`, and standalone Korean `실행` as task/tool intent. That unnecessarily sent coaching prompts to `agentic`. The route classifier now requires slash commands to start with `/`, English task verbs to match word boundaries, and no longer treats standalone `실행` as a tool request.

## Implemented Optimizations

1. Memory-only BIP/ICP prompts now route to `fast_chat` with inline local BIP context when QMD is unavailable. This avoids unnecessary agentic MCP setup, Notion config checks, web search enablement, and dangerous sandbox setup for coaching questions that only need `docs/ICP.md`/`docs/SPEC.md`.
2. Codex reasoning effort for live Day 1 E2E defaults to `low`, keeping coaching latency lower while still using the real SDK/provider.
3. Timing marks are persisted with the assistant message, so the same run can be inspected from XCTest attachments or `sessions.json`.
4. Route classification no longer over-matches path separators or English substrings inside marker/domain words.

## Next Improvements

1. Keep `instant_chat` hot-path turns under 1 second and fail tests if short coaching prompts fall into SDK/MCP startup.
2. Parse timing percentiles with `npm run report:timings -- <sessions.json>` and track p50/p95 by route and phase.
3. Show canonical agent timeline events in the UI while streaming, so the user can distinguish provider latency from app hangs.
4. Add route regression tests for `classifyChatExecutionRoute` to prevent ICP/SPEC coaching prompts from falling back to `agentic`.
5. Measure first-token latency separately from final-response latency in product telemetry.

## Risks

- Live model latency will vary by provider, account state, network, and model load, so production SLOs should be measured with percentiles, not a single run.
- Aggressive context caching must invalidate on file edits; otherwise Day 1 coaching can use stale ICP/SPEC assumptions.
- Forcing too many prompts into `fast_chat` may reduce answer quality when the user actually needs workspace actions.
- macOS XCTest UI input is sensitive to desktop focus. The sidecar live test provides the same provider/timing proof without Finder or other windows interrupting keyboard focus.

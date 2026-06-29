import { test } from "node:test";
import assert from "node:assert/strict";

import {
  buildAiGenerationProperties,
  emitAiGeneration,
  hasAiGenerationTelemetrySink,
  mapProviderToAiProvider,
  normalizeAiUsage,
  resetAiGenerationTelemetrySinkForTest,
  setAiGenerationTelemetrySink,
} from "../sidecar/ai-generation-telemetry.mjs";

test("mapProviderToAiProvider maps internal keys to LLM-vendor names", () => {
  assert.equal(mapProviderToAiProvider("claude"), "anthropic");
  assert.equal(mapProviderToAiProvider("codex"), "openai");
  assert.equal(mapProviderToAiProvider("gemini"), "gemini");
  assert.equal(mapProviderToAiProvider("cursor"), "cursor");
  assert.equal(mapProviderToAiProvider("mystery"), "mystery");
});

test("normalizeAiUsage handles the Claude/Anthropic snake_case shape", () => {
  const usage = normalizeAiUsage("claude", {
    input_tokens: 120,
    output_tokens: 45,
    cache_read_input_tokens: 30,
    cache_creation_input_tokens: 10,
  });
  assert.deepEqual(usage, { inputTokens: 120, outputTokens: 45, cacheReadTokens: 30 });
});

test("normalizeAiUsage handles the Codex turn-usage shape", () => {
  const usage = normalizeAiUsage("codex", {
    input_tokens: 200,
    cached_input_tokens: 64,
    output_tokens: 80,
    reasoning_output_tokens: 12,
  });
  assert.deepEqual(usage, { inputTokens: 200, outputTokens: 80, cacheReadTokens: 64 });
});

test("normalizeAiUsage handles the OpenAI Responses cached-token shape", () => {
  const usage = normalizeAiUsage("codex", {
    input_tokens: 10,
    output_tokens: 5,
    input_tokens_details: { cached_tokens: 4 },
  });
  assert.deepEqual(usage, { inputTokens: 10, outputTokens: 5, cacheReadTokens: 4 });
});

test("normalizeAiUsage handles the Gemini usageMetadata shape", () => {
  const usage = normalizeAiUsage("gemini", {
    promptTokenCount: 300,
    candidatesTokenCount: 90,
    cachedContentTokenCount: 15,
    totalTokenCount: 405,
  });
  assert.deepEqual(usage, { inputTokens: 300, outputTokens: 90, cacheReadTokens: 15 });
});

test("normalizeAiUsage drops absent fields and tolerates non-objects", () => {
  assert.deepEqual(normalizeAiUsage("claude", { input_tokens: 5 }), { inputTokens: 5 });
  assert.deepEqual(normalizeAiUsage("claude", null), {});
  assert.deepEqual(normalizeAiUsage("claude", undefined), {});
});

test("buildAiGenerationProperties emits the full $ai_* shape for a Claude success", () => {
  const props = buildAiGenerationProperties({
    provider: "claude",
    executionMode: "agentic",
    model: "claude-opus-4-8",
    usage: { input_tokens: 100, output_tokens: 40, cache_read_input_tokens: 20 },
    costUsd: 0.0123,
    latencyMs: 2500,
    traceId: "trace-abc",
  });
  assert.equal(props.$ai_trace_id, "trace-abc");
  assert.equal(props.$ai_provider, "anthropic");
  assert.equal(props.$ai_model, "claude-opus-4-8");
  assert.equal(props.$ai_input_tokens, 100);
  assert.equal(props.$ai_output_tokens, 40);
  assert.equal(props.$ai_cache_read_input_tokens, 20);
  assert.equal(props.$ai_total_cost_usd, 0.0123);
  assert.equal(props.$ai_latency, 2.5); // seconds
  assert.equal(props.$ai_is_error, false);
  assert.equal(props.$ai_http_status, 200);
  assert.equal(props.$ai_span_name, "agentic");
  assert.equal(props.execution_mode, "agentic");
  assert.ok(!Object.hasOwn(props, "$ai_error"));
  // Never leak raw prompt/response content.
  assert.ok(!Object.hasOwn(props, "$ai_input"));
  assert.ok(!Object.hasOwn(props, "$ai_output_choices"));
});

test("buildAiGenerationProperties records errors with status 500 and a message", () => {
  const props = buildAiGenerationProperties({
    provider: "codex",
    executionMode: "agentic",
    model: "gpt-5.5",
    latencyMs: 800,
    traceId: "t",
    isError: true,
    error: new Error("boom"),
  });
  assert.equal(props.$ai_is_error, true);
  assert.equal(props.$ai_http_status, 500);
  assert.equal(props.$ai_error, "boom");
  assert.equal(props.$ai_provider, "openai");
});

test("buildAiGenerationProperties omits cost/tokens when unavailable", () => {
  const props = buildAiGenerationProperties({
    provider: "cursor",
    executionMode: "agentic",
    model: "composer-2.5",
    latencyMs: 1000,
    traceId: "t",
  });
  assert.equal(props.$ai_provider, "cursor");
  assert.ok(!Object.hasOwn(props, "$ai_total_cost_usd"));
  assert.ok(!Object.hasOwn(props, "$ai_input_tokens"));
  assert.ok(!Object.hasOwn(props, "$ai_output_tokens"));
  assert.equal(props.$ai_latency, 1);
});

test("emitAiGeneration forwards to the registered sink and no-ops without one", () => {
  resetAiGenerationTelemetrySinkForTest();
  assert.equal(hasAiGenerationTelemetrySink(), false);
  assert.equal(emitAiGeneration({ provider: "claude", model: "m", traceId: "t" }), false);

  const captured = [];
  setAiGenerationTelemetrySink((event, properties) => captured.push({ event, properties }));
  try {
    assert.equal(hasAiGenerationTelemetrySink(), true);
    const ok = emitAiGeneration({
      provider: "claude",
      executionMode: "agentic",
      model: "claude-opus-4-8",
      usage: { input_tokens: 7, output_tokens: 3 },
      costUsd: 0.01,
      latencyMs: 1500,
      traceId: "trace-1",
    });
    assert.equal(ok, true);
    assert.equal(captured.length, 1);
    assert.equal(captured[0].event, "$ai_generation");
    assert.equal(captured[0].properties.$ai_model, "claude-opus-4-8");
    assert.equal(captured[0].properties.$ai_input_tokens, 7);
  } finally {
    resetAiGenerationTelemetrySinkForTest();
  }
});

test("emitAiGeneration never throws when the sink throws", () => {
  resetAiGenerationTelemetrySinkForTest();
  setAiGenerationTelemetrySink(() => {
    throw new Error("sink failure");
  });
  try {
    assert.equal(emitAiGeneration({ provider: "claude", model: "m", traceId: "t" }), false);
  } finally {
    resetAiGenerationTelemetrySinkForTest();
  }
});

// PostHog LLM-analytics ($ai_generation) emission for sidecar provider runs.
//
// The sidecar drives Claude/Codex/Gemini/Cursor all day but historically emitted
// only `mac_sidecar_*` lifecycle events, so PostHog's LLM-analytics product
// (cost / tokens / latency / errors / cost-per-user) had zero data. This module
// builds the `$ai_*` property shape PostHog expects and forwards it through the
// existing telemetry capture pipeline (wired in index.mjs), so the dormant
// "LLM Analytics Default" dashboard lights up without further build work.
//
// Privacy: we intentionally never include `$ai_input` / `$ai_output_choices`
// (the raw prompt/response). The cost/token/latency/error insights do not need
// message content, and `sidecar/AGENTS.md` forbids persisting raw prompts.
//
// provider-runner.mjs stays decoupled from telemetry.mjs: index.mjs injects the
// capture sink via setAiGenerationTelemetrySink, mirroring how error-telemetry.mjs
// receives its shared client. When no sink is registered (e.g. the ACP/MCP entry
// points, or tests) emission is a no-op.

let sink = null;

/**
 * Register the capture sink. `fn` receives (eventName, properties) and is
 * expected to forward to the PostHog ingest pipeline (telemetry.captureEvent).
 */
export function setAiGenerationTelemetrySink(fn) {
  sink = typeof fn === "function" ? fn : null;
}

export function resetAiGenerationTelemetrySinkForTest() {
  sink = null;
}

export function hasAiGenerationTelemetrySink() {
  return Boolean(sink);
}

/** PostHog `$ai_provider` value. Maps internal provider keys to LLM-vendor names. */
export function mapProviderToAiProvider(provider) {
  switch (String(provider || "").toLowerCase()) {
    case "claude":
      return "anthropic";
    case "codex":
      return "openai";
    case "gemini":
      return "gemini";
    case "cursor":
      return "cursor";
    default:
      return String(provider || "unknown");
  }
}

function finiteNumber(value) {
  const num = Number(value);
  return Number.isFinite(num) ? num : undefined;
}

/**
 * Normalize the per-provider usage object to a common
 * { inputTokens, outputTokens, cacheReadTokens } shape. Each SDK names its
 * token fields differently; unknown / absent fields are dropped.
 */
export function normalizeAiUsage(provider, usage) {
  if (!usage || typeof usage !== "object") return {};
  const key = String(provider || "").toLowerCase();

  if (key === "gemini") {
    return dropUndefined({
      inputTokens: finiteNumber(usage.promptTokenCount),
      outputTokens: finiteNumber(usage.candidatesTokenCount),
      cacheReadTokens: finiteNumber(usage.cachedContentTokenCount),
    });
  }

  if (key === "codex") {
    // Codex SDK turn usage + OpenAI Responses usage both expose
    // input_tokens / output_tokens; cached tokens differ in shape.
    const cached =
      finiteNumber(usage.cached_input_tokens)
      ?? finiteNumber(usage.input_tokens_details?.cached_tokens);
    return dropUndefined({
      inputTokens: finiteNumber(usage.input_tokens),
      outputTokens: finiteNumber(usage.output_tokens),
      cacheReadTokens: cached,
    });
  }

  // Claude Agent SDK result usage + raw Anthropic Messages usage share the
  // snake_case Anthropic shape.
  return dropUndefined({
    inputTokens: finiteNumber(usage.input_tokens),
    outputTokens: finiteNumber(usage.output_tokens),
    cacheReadTokens: finiteNumber(usage.cache_read_input_tokens),
  });
}

function dropUndefined(object) {
  return Object.fromEntries(
    Object.entries(object).filter(([, value]) => value !== undefined),
  );
}

function truncateError(error) {
  const message = String(error?.message ?? error ?? "").trim();
  if (!message) return "unknown error";
  return message.slice(0, 500);
}

/**
 * Build the `$ai_generation` property bag. Pure — no I/O — so it is unit-tested
 * directly. Only fields we actually have are included; PostHog computes cost
 * from `$ai_model` + tokens when `$ai_total_cost_usd` is absent.
 */
export function buildAiGenerationProperties({
  provider,
  executionMode = "",
  model = "",
  usage = null,
  costUsd = undefined,
  latencyMs = undefined,
  traceId = "",
  isError = false,
  error = null,
} = {}) {
  const normalizedUsage = normalizeAiUsage(provider, usage);
  const properties = {
    $ai_trace_id: String(traceId || ""),
    $ai_provider: mapProviderToAiProvider(provider),
    $ai_model: String(model || ""),
    $ai_is_error: Boolean(isError),
    $ai_http_status: isError ? 500 : 200,
  };

  if (executionMode) {
    properties.$ai_span_name = String(executionMode);
    properties.execution_mode = String(executionMode);
  }
  if (Number.isFinite(normalizedUsage.inputTokens)) {
    properties.$ai_input_tokens = normalizedUsage.inputTokens;
  }
  if (Number.isFinite(normalizedUsage.outputTokens)) {
    properties.$ai_output_tokens = normalizedUsage.outputTokens;
  }
  if (Number.isFinite(normalizedUsage.cacheReadTokens)) {
    properties.$ai_cache_read_input_tokens = normalizedUsage.cacheReadTokens;
  }
  const cost = finiteNumber(costUsd);
  if (cost !== undefined) {
    properties.$ai_total_cost_usd = cost;
  }
  const latency = finiteNumber(latencyMs);
  if (latency !== undefined) {
    // PostHog expects $ai_latency in seconds.
    properties.$ai_latency = Math.max(0, latency) / 1000;
  }
  if (isError) {
    properties.$ai_error = truncateError(error);
  }

  return properties;
}

/**
 * Build + emit a `$ai_generation` event through the registered sink. No-op when
 * no sink is registered. Never throws — telemetry must not break a provider run.
 */
export function emitAiGeneration(generation = {}) {
  if (!sink) return false;
  try {
    sink("$ai_generation", buildAiGenerationProperties(generation));
    return true;
  } catch {
    return false;
  }
}

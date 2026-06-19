const EXA_SEARCH_ENDPOINT = "https://api.exa.ai/search";
const DEFAULT_DIRECT_EXA_REQUEST_TIMEOUT_MS = 20_000;
const MIN_DIRECT_EXA_REQUEST_TIMEOUT_MS = 5_000;
const MAX_DIRECT_EXA_REQUEST_TIMEOUT_MS = 60_000;
const DEFAULT_DIRECT_EXA_MAX_QUERIES = 3;
const DEFAULT_DIRECT_EXA_RESULTS_PER_QUERY = 5;
const MAX_DIRECT_EXA_PROMPT_CHARS = 72_000;

export const DIRECT_EXA_RESEARCH_MODE = "direct_exa_search_api";
export const DIRECT_EXA_API_KEY_REQUIRED_REASON = "exa_direct_key_required";
export const DIRECT_EXA_SEARCH_FAILED_REASON = "exa_direct_search_failed";

export function normalizeDirectExaRequestTimeout(value, {
  defaultMs = DEFAULT_DIRECT_EXA_REQUEST_TIMEOUT_MS,
  minMs = MIN_DIRECT_EXA_REQUEST_TIMEOUT_MS,
  maxMs = MAX_DIRECT_EXA_REQUEST_TIMEOUT_MS,
} = {}) {
  const parsed = Number(value);
  const candidate = Number.isFinite(parsed) && parsed > 0 ? parsed : defaultMs;
  return Math.max(minMs, Math.min(maxMs, Math.round(candidate)));
}

export function extractDirectExaApiKey({
  apiKey = "",
  mcpConfig = null,
  route = null,
  env = process.env,
} = {}) {
  const explicit = String(apiKey || "").trim();
  if (explicit) return explicit;
  const configs = [
    mcpConfig,
    route?.mcpConfig,
    route?.mcp_config,
    route?.config,
  ].filter((config) => config && typeof config === "object");
  for (const config of configs) {
    const headers = config.headers && typeof config.headers === "object" ? config.headers : {};
    for (const [key, value] of Object.entries(headers)) {
      const normalizedKey = String(key || "").toLowerCase();
      const raw = String(value || "").trim();
      if (!raw) continue;
      if (normalizedKey === "x-api-key") return raw;
      if (normalizedKey === "authorization") {
        const match = raw.match(/^bearer\s+(.+)$/i);
        if (match?.[1]?.trim()) return match[1].trim();
      }
    }
    const inlineEnvKey = extractApiKeyFromInlineEnv(config.env, env);
    if (inlineEnvKey) return inlineEnvKey;
    const envVar = String(config.bearer_token_env_var || config.api_key_env_var || "").trim();
    if (envVar && String(env?.[envVar] || "").trim()) return String(env[envVar]).trim();
  }
  return String(env?.EXA_API_KEY || "").trim();
}

function extractApiKeyFromInlineEnv(value, env = process.env) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return "";
  for (const [key, entry] of Object.entries(value)) {
    if (String(key || "").trim().toUpperCase() !== "EXA_API_KEY") continue;
    const raw = String(entry || "").trim();
    if (!raw) continue;
    const envReference = raw.match(/^\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?$/);
    if (envReference?.[1]) return String(env?.[envReference[1]] || "").trim();
    return raw;
  }
  return "";
}

export function createDirectExaApiKeyRequiredError({
  routeLabel = "Exa",
  provider = "",
} = {}) {
  const label = cleanString(routeLabel, 160) || "Exa";
  const providerLabel = cleanString(provider, 80);
  const suffix = providerLabel ? ` (${providerLabel})` : "";
  const error = new Error(
    `${label}${suffix}에 direct Exa Search 연결 키가 없어 MCP fallback을 시작하지 않았습니다. `
      + "Settings에서 Exa 키를 연결하세요.",
  );
  error.reason = DIRECT_EXA_API_KEY_REQUIRED_REASON;
  error.code = DIRECT_EXA_API_KEY_REQUIRED_REASON;
  error.researchSource = label;
  return error;
}

export function isDirectExaHardFailureReason(reason = "") {
  return [
    DIRECT_EXA_API_KEY_REQUIRED_REASON,
    DIRECT_EXA_SEARCH_FAILED_REASON,
  ].includes(String(reason || ""));
}

export function usesDirectExaResearchMode(mode = "") {
  const normalizedMode = String(mode || "").trim();
  return normalizedMode === "" || normalizedMode === "exa_research" || normalizedMode === "market_radar";
}

export function buildDirectExaQueries({
  context = {},
  mode = "",
  maxQueries = DEFAULT_DIRECT_EXA_MAX_QUERIES,
} = {}) {
  const isStrategy = mode === "exa_research" || Array.isArray(context.requiredSections);
  const candidates = isStrategy
    ? strategyReportQueries(context)
    : marketRadarQueries(context);
  return uniqueStrings(
    candidates
      .map((query) => cleanQuery(query))
      .filter(Boolean),
    maxQueries,
  );
}

export async function runDirectExaResearch({
  apiKey = "",
  context = {},
  mode = "",
  signal = null,
  fetchImpl = globalThis.fetch,
  now = new Date(),
  maxQueries = DEFAULT_DIRECT_EXA_MAX_QUERIES,
  resultsPerQuery = DEFAULT_DIRECT_EXA_RESULTS_PER_QUERY,
  requestTimeoutMs = normalizeDirectExaRequestTimeout(process.env.AGENTIC30_EXA_DIRECT_REQUEST_TIMEOUT_MS),
} = {}) {
  const key = String(apiKey || "").trim();
  if (!key) {
    const error = new Error("Exa Search API key is required for direct Exa research.");
    error.reason = DIRECT_EXA_SEARCH_FAILED_REASON;
    error.code = DIRECT_EXA_SEARCH_FAILED_REASON;
    throw error;
  }
  if (typeof fetchImpl !== "function") {
    throw new Error("fetch implementation is required for direct Exa research.");
  }
  const queries = buildDirectExaQueries({ context, mode, maxQueries });
  if (queries.length === 0) {
    const error = new Error("No safe Exa search queries were available for direct research.");
    error.reason = DIRECT_EXA_SEARCH_FAILED_REASON;
    error.code = DIRECT_EXA_SEARCH_FAILED_REASON;
    throw error;
  }
  const excludeDomains = normalizeStringArray(context?.searchExclusions?.excludeDomains, 20, 120);
  const responses = [];
  const failures = [];
  for (const query of queries) {
    if (signal?.aborted) throw abortError(signal.reason);
    try {
      const response = await searchExa({
        apiKey: key,
        query,
        excludeDomains,
        resultsPerQuery,
        requestTimeoutMs,
        signal,
        fetchImpl,
      });
      responses.push(response);
    } catch (error) {
      failures.push({
        query,
        reason: DIRECT_EXA_SEARCH_FAILED_REASON,
        error: cleanString(error?.message || error, 300),
      });
    }
  }
  const sources = dedupeSources(responses.flatMap((response) => response.results));
  if (sources.length === 0) {
    const error = new Error(`Exa Search API returned no usable evidence. ${summarizeFailures(failures)}`);
    error.reason = DIRECT_EXA_SEARCH_FAILED_REASON;
    error.code = DIRECT_EXA_SEARCH_FAILED_REASON;
    error.failures = failures;
    throw error;
  }
  return {
    mode: DIRECT_EXA_RESEARCH_MODE,
    searchedAt: now.toISOString(),
    queryCount: queries.length,
    resultCount: sources.length,
    queries,
    failures,
    sources,
  };
}

export function buildDirectExaGroundedPrompt({
  prompt = "",
  directExaResult = null,
  maxChars = MAX_DIRECT_EXA_PROMPT_CHARS,
} = {}) {
  const evidence = {
    mode: directExaResult?.mode || DIRECT_EXA_RESEARCH_MODE,
    searchedAt: directExaResult?.searchedAt || null,
    queryCount: directExaResult?.queryCount || 0,
    resultCount: directExaResult?.resultCount || 0,
    queries: directExaResult?.queries || [],
    partialFailures: directExaResult?.failures || [],
    sources: directExaResult?.sources || [],
  };
  return [
    "Direct Exa evidence mode:",
    "- The sidecar already queried Exa Search API directly and sequentially.",
    "- Do not call web/search/fetch tools, even if the original task mentions Exa MCP.",
    "- Use only the original context plus Direct Exa Evidence below.",
    "- If evidence is thin, say so in the requested JSON instead of inventing sources.",
    "",
    "Direct Exa Evidence JSON:",
    JSON.stringify(evidence, null, 2),
    "",
    "Original task:",
    String(prompt || ""),
  ].join("\n").slice(0, maxChars);
}

async function searchExa({
  apiKey,
  query,
  excludeDomains = [],
  resultsPerQuery = DEFAULT_DIRECT_EXA_RESULTS_PER_QUERY,
  requestTimeoutMs = DEFAULT_DIRECT_EXA_REQUEST_TIMEOUT_MS,
  signal = null,
  fetchImpl,
}) {
  const abortController = new AbortController();
  let parentAbortListener = null;
  if (signal?.aborted) {
    abortController.abort(signal.reason);
  } else if (signal && typeof signal.addEventListener === "function") {
    parentAbortListener = () => abortController.abort(signal.reason);
    signal.addEventListener("abort", parentAbortListener, { once: true });
  }
  const timeout = setTimeout(() => {
    abortController.abort(new Error(`Exa Search API request timed out after ${requestTimeoutMs}ms`));
  }, requestTimeoutMs);
  try {
    const body = {
      query,
      type: "fast",
      numResults: Math.max(1, Math.min(10, Math.round(resultsPerQuery))),
      contents: {
        highlights: true,
      },
    };
    if (excludeDomains.length > 0) body.excludeDomains = excludeDomains;
    const response = await fetchImpl(EXA_SEARCH_ENDPOINT, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        "x-api-key": apiKey,
      },
      body: JSON.stringify(body),
      signal: abortController.signal,
    });
    const responseText = await response.text();
    if (!response.ok) {
      throw new Error(`Exa Search API ${response.status}: ${cleanString(responseText, 300)}`);
    }
    const parsed = JSON.parse(responseText || "{}");
    return {
      query,
      requestId: cleanString(parsed.requestId, 120) || null,
      results: normalizeExaResults(parsed.results, { query }),
    };
  } finally {
    clearTimeout(timeout);
    if (signal && parentAbortListener && typeof signal.removeEventListener === "function") {
      signal.removeEventListener("abort", parentAbortListener);
    }
  }
}

function normalizeExaResults(results, { query } = {}) {
  return (Array.isArray(results) ? results : [])
    .map((result, index) => {
      const url = cleanString(result?.url, 700);
      const title = cleanString(result?.title || url || `Exa result ${index + 1}`, 240);
      const highlights = normalizeStringArray(result?.highlights, 3, 700);
      const excerpt = cleanString(
        highlights.join(" ")
          || result?.summary
          || result?.text,
        900,
      );
      return {
        id: cleanString(result?.id, 180) || stableHash(`${query}:${url || title}:${index}`),
        title,
        url,
        domain: domainFromUrl(url),
        publishedAt: cleanString(result?.publishedDate || result?.published_date, 80) || null,
        author: cleanString(result?.author, 160) || null,
        excerpt,
        query,
      };
    })
    .filter((result) => result.title && result.url)
    .slice(0, 12);
}

function dedupeSources(sources = []) {
  const seen = new Set();
  const deduped = [];
  for (const source of sources) {
    const key = normalizeUrlKey(source.url) || `${source.domain}:${source.title}`.toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.add(key);
    deduped.push(source);
    if (deduped.length >= 18) break;
  }
  return deduped;
}

function marketRadarQueries(context = {}) {
  const lane = context.lane || {};
  return [
    ...(Array.isArray(context?.trustedSourceHints?.queries) ? context.trustedSourceHints.queries.slice(0, 1) : []),
    ...(Array.isArray(context.querySeeds) ? context.querySeeds.slice(0, 4) : []),
    [lane.title, lane.hypothesis, context.researchFocus].filter(Boolean).join(" "),
  ];
}

function strategyReportQueries(context = {}) {
  const evidenceText = (Array.isArray(context.evidence) ? context.evidence : [])
    .map((item) => [item.title, item.excerpt].filter(Boolean).join(" "))
    .join(" ")
    .slice(0, 2_000);
  const productName = cleanString(context.productName || "Agentic30", 120) || "Agentic30";
  return [
    `${productName} alternatives startup coaching AI coding solo founder pricing reviews`,
    "AI coding assistant startup coaching first revenue solo developer pricing reviews alternatives",
    `indie founder first revenue customer discovery AI coding tool pricing ${evidenceText}`,
  ];
}

function summarizeFailures(failures = []) {
  const messages = normalizeStringArray(failures.map((failure) => failure.error), 3, 220);
  return messages.length > 0 ? messages.join(" | ") : "";
}

function abortError(reason = null) {
  const error = new Error(reason?.message || "aborted");
  error.name = "AbortError";
  return error;
}

function cleanQuery(value) {
  return cleanString(value, 260)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeStringArray(value, maxItems = 12, maxLength = 160) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function uniqueStrings(values = [], maxItems = 12) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const normalized = cleanString(value, 300);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    output.push(normalized);
    if (output.length >= maxItems) break;
  }
  return output;
}

function cleanString(value, maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function stableHash(value) {
  let hash = 0;
  const text = String(value || "");
  for (let index = 0; index < text.length; index += 1) {
    hash = ((hash << 5) - hash + text.charCodeAt(index)) | 0;
  }
  return `exa-${Math.abs(hash).toString(16)}`;
}

function domainFromUrl(rawUrl) {
  try {
    return new URL(String(rawUrl || "")).hostname.replace(/^www\./, "").toLowerCase();
  } catch {
    return "";
  }
}

function normalizeUrlKey(rawUrl) {
  try {
    const parsed = new URL(String(rawUrl || ""));
    parsed.hash = "";
    parsed.search = "";
    return parsed.toString().replace(/\/+$/, "").toLowerCase();
  } catch {
    return "";
  }
}

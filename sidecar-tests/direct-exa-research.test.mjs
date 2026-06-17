import assert from "node:assert/strict";
import test from "node:test";

import {
  buildDirectExaGroundedPrompt,
  buildDirectExaQueries,
  createDirectExaApiKeyRequiredError,
  DIRECT_EXA_API_KEY_REQUIRED_REASON,
  DIRECT_EXA_RESEARCH_MODE,
  extractDirectExaApiKey,
  normalizeDirectExaRequestTimeout,
  runDirectExaResearch,
  usesDirectExaResearchMode,
} from "../sidecar/direct-exa-research.mjs";

test("direct Exa research extracts API keys from route config without requiring env", () => {
  assert.equal(extractDirectExaApiKey({
    mcpConfig: { headers: { "x-api-key": "route_key" } },
    env: {},
  }), "route_key");
  assert.equal(extractDirectExaApiKey({
    mcpConfig: { headers: { Authorization: "Bearer bearer_key" } },
    env: {},
  }), "bearer_key");
  assert.equal(extractDirectExaApiKey({
    mcpConfig: { bearer_token_env_var: "EXA_TEST_KEY" },
    env: { EXA_TEST_KEY: "env_route_key" },
  }), "env_route_key");
});

test("direct Exa missing key error is typed and user-actionable", () => {
  const error = createDirectExaApiKeyRequiredError({
    routeLabel: "Codex Exa MCP",
    provider: "codex",
  });

  assert.equal(error.reason, DIRECT_EXA_API_KEY_REQUIRED_REASON);
  assert.equal(error.code, DIRECT_EXA_API_KEY_REQUIRED_REASON);
  assert.match(error.message, /direct Exa Search 연결 키/);
  assert.match(error.message, /MCP fallback/);
});

test("direct Exa timeout is bounded for short API calls", () => {
  assert.equal(normalizeDirectExaRequestTimeout("1"), 5_000);
  assert.equal(normalizeDirectExaRequestTimeout("20000"), 20_000);
  assert.equal(normalizeDirectExaRequestTimeout("120000"), 60_000);
});

test("direct Exa mode gate excludes BIP research from Market Radar direct-search flow", () => {
  assert.equal(usesDirectExaResearchMode(""), true);
  assert.equal(usesDirectExaResearchMode("market_radar"), true);
  assert.equal(usesDirectExaResearchMode("exa_research"), true);
  assert.equal(usesDirectExaResearchMode("bip_research"), false);
});

test("direct Exa query builder keeps Market Radar calls small and deduped", () => {
  const queries = buildDirectExaQueries({
    mode: "lane_research",
    context: {
      trustedSourceHints: {
        queries: ["site:ycombinator.com/library startup customers pricing"],
      },
      querySeeds: [
        "AI customer discovery pricing",
        "AI customer discovery pricing",
        "founder coaching reviews",
      ],
      lane: { title: "대안/가격", hypothesis: "이미 돈을 쓰는 대안" },
      researchFocus: "paid alternatives",
    },
    maxQueries: 3,
  });

  assert.deepEqual(queries, [
    "site:ycombinator.com/library startup customers pricing",
    "AI customer discovery pricing",
    "founder coaching reviews",
  ]);
});

test("direct Exa research calls Search API sequentially without MCP advanced options", async () => {
  const calls = [];
  const result = await runDirectExaResearch({
    apiKey: "exa_test_key",
    mode: "lane_research",
    context: {
      querySeeds: ["AI customer discovery pricing", "founder coaching reviews"],
      searchExclusions: { excludeDomains: ["agentic30.app"] },
    },
    fetchImpl: async (url, init) => {
      calls.push({ url, body: JSON.parse(init.body), headers: init.headers });
      return {
        ok: true,
        status: 200,
        text: async () => JSON.stringify({
          requestId: `req-${calls.length}`,
          results: [{
            id: `result-${calls.length}`,
            title: `Result ${calls.length}`,
            url: `https://example${calls.length}.com/pricing`,
            highlights: [`highlight ${calls.length}`],
          }],
        }),
      };
    },
    requestTimeoutMs: 5_000,
  });

  assert.equal(result.mode, DIRECT_EXA_RESEARCH_MODE);
  assert.equal(result.sources.length, 2);
  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, "https://api.exa.ai/search");
  assert.equal(calls[0].headers["x-api-key"], "exa_test_key");
  assert.deepEqual(calls.map((call) => call.body.query), [
    "AI customer discovery pricing",
    "founder coaching reviews",
  ]);
  assert.deepEqual(calls.map((call) => call.body.additionalQueries), [undefined, undefined]);
  assert.deepEqual(calls.map((call) => call.body.type), ["fast", "fast"]);
  assert.deepEqual(calls.map((call) => call.body.contents), [{ highlights: true }, { highlights: true }]);
  assert.deepEqual(calls.map((call) => call.body.excludeDomains), [["agentic30.app"], ["agentic30.app"]]);
});

test("direct Exa grounded prompt disables further tool calls and carries evidence", () => {
  const prompt = buildDirectExaGroundedPrompt({
    prompt: "Use Exa MCP tools and return JSON.",
    directExaResult: {
      mode: DIRECT_EXA_RESEARCH_MODE,
      searchedAt: "2026-06-17T00:00:00.000Z",
      queryCount: 1,
      resultCount: 1,
      queries: ["pricing"],
      failures: [],
      sources: [{
        title: "Pricing page",
        url: "https://example.com/pricing",
        domain: "example.com",
        excerpt: "pricing evidence",
      }],
    },
  });

  assert.match(prompt, /sidecar already queried Exa Search API directly and sequentially/);
  assert.match(prompt, /Do not call web\/search\/fetch tools/);
  assert.match(prompt, /Pricing page/);
  assert.match(prompt, /Original task/);
});

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  NEWS_MARKET_RADAR_ABORTED_AFTER_EXA_MCP_TIMEOUT_REASON,
  NEWS_MARKET_RADAR_EXA_MCP_ERROR_REASON,
  NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON,
  NEWS_MARKET_RADAR_FAILED_AUTO_REFRESH_COOLDOWN_MS,
  NEWS_MARKET_RADAR_LANE_CONCURRENCY,
  NEWS_MARKET_RADAR_PROGRESS_STEPS,
  NEWS_MARKET_RADAR_PROMPT_PROFILE,
  NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS,
  appendCurriculumAnswer,
  applyNewsMarketRadarCodexExaMcpToolTimeout,
  buildMarketRadarResearchContext,
  buildMarketRadarLaneResearchContext,
  buildMarketRadarLaneProviderPrompt,
  buildMarketRadarProviderPrompt,
  canonicalMarketRadarSourceKey,
  buildExaMcpConfig,
  buildNewsMarketRadarProgressStatus,
  classifyNewsMarketRadarExaMcpToolFailure,
  collectWorkspaceEvidence,
  createNewsMarketRadarExaMcpFailureError,
  formatNewsMarketRadarProviderTimeout,
  isNewsMarketRadarAutoRefreshDue,
  loadCurriculumAnswerLog,
  loadNewsMarketRadarSnapshot,
  normalizeNewsMarketRadarCodexExaMcpToolTimeout,
  normalizeNewsMarketRadarProviderTimeout,
  normalizeNewsMarketRadarSnapshot,
  rankAnswersForMarketRadar,
  refreshNewsMarketRadar,
  resolveCurriculumAnswerLogPath,
  resolveNewsMarketRadarCachePath,
} from "../sidecar/news-market-radar.mjs";
import {
  MARKET_RADAR_TRUSTED_SOURCE_CATALOG,
  annotateMarketRadarSourceTrust,
  buildTrustedSourceQueriesForLane,
  trustedSourcesForMarketRadarPrompt,
} from "../sidecar/market-radar-source-catalog.mjs";
import {
  DIRECT_EXA_API_KEY_REQUIRED_REASON,
} from "../sidecar/direct-exa-research.mjs";

async function withTmpWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-news-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function testExaRoute() {
  return {
    provider: "codex",
    source: "provider_mcp",
    label: "Codex Exa MCP",
    serverName: "exa",
    mcpConfig: {
      type: "http",
      url: "https://mcp.exa.ai/mcp",
      headers: { "x-api-key": "exa_test_key" },
    },
  };
}

function testLaneResearchResult(laneId = "icp") {
  return {
    lanes: [{
      id: laneId,
      cards: [{
        id: `${laneId}-card`,
        title: `${laneId} evidence`,
        summary: "Fresh public evidence for the selected lane.",
        impact: "strengthens",
        sourceRefs: [
          { url: `https://example.com/${laneId}/pricing`, title: "Pricing" },
          { url: `https://other.example/${laneId}/review`, title: "Review" },
        ],
      }],
    }],
    researchSource: "Codex Exa MCP",
  };
}

function countCards(snapshot) {
  return (snapshot.lanes || []).reduce((sum, lane) => sum + (lane.cards || []).length, 0);
}

test("curriculum answer log stores Day 1-30 raw answers with 0o600 mode and prunes old records", async () => {
  await withTmpWorkspace(async (root) => {
    const now = new Date("2026-05-20T00:00:00.000Z");
    await appendCurriculumAnswer({
      workspaceRoot: root,
      now: new Date("2026-04-01T00:00:00.000Z"),
      answer: {
        day: 1,
        questionId: "old",
        questionTitle: "Old",
        answerTitle: "Should prune",
        occurredAt: "2026-04-01T00:00:00.000Z",
      },
    });
    await appendCurriculumAnswer({
      workspaceRoot: root,
      now,
      answer: {
        day: 27,
        dimension: "pricing",
        questionId: "price-ask",
        questionTitle: "가격 ask",
        answerTitle: "$20/mo",
        freeformAnswer: "고객은 연간 결제를 싫어함",
        occurredAt: now.toISOString(),
      },
    });

    const log = await loadCurriculumAnswerLog({ workspaceRoot: root, now });
    assert.equal(log.records.length, 1);
    assert.equal(log.records[0].day, 27);
    assert.equal(log.records[0].freeformAnswer, "고객은 연간 결제를 싫어함");
    const stat = await fs.stat(resolveCurriculumAnswerLogPath(root));
    assert.equal(stat.mode & 0o777, 0o600);
  });
});

test("market radar answer ranking favors recent core assumptions", () => {
  const now = new Date("2026-05-20T00:00:00.000Z");
  const ranked = rankAnswersForMarketRadar([
    {
      id: "generic-old",
      day: 12,
      dimension: "misc",
      answerTitle: "old",
      occurredAt: "2026-05-01T00:00:00.000Z",
    },
    {
      id: "pricing-recent",
      day: 27,
      dimension: "pricing",
      answerTitle: "recent",
      occurredAt: "2026-05-19T00:00:00.000Z",
    },
  ], { now });
  assert.equal(ranked[0].id, "pricing-recent");
  assert.ok(ranked[0].marketRadarWeight > ranked[1].marketRadarWeight);
});

test("workspace evidence collector reads explicit docs and excludes denied or secret-like paths", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs with paid tool spend");
    await fs.writeFile(path.join(root, ".git", "config"), "secret");
    await fs.writeFile(path.join(root, "docs", "api-key.md"), "should not be read");
    const result = await collectWorkspaceEvidence({
      workspaceRoot: root,
      scanResult: {
        icp: ".agentic30/docs/ICP.md",
        spec: ".git/config",
        goal: "docs/api-key.md",
      },
    });
    assert.equal(result.evidence.some((item) => item.path === ".agentic30/docs/ICP.md"), true);
    assert.equal(result.evidence.some((item) => item.path === ".git/config"), false);
    assert.equal(result.evidence.some((item) => item.path === "docs/api-key.md"), false);
  });
});

test("Exa MCP config is BYOK and redacts diagnostics by construction", () => {
  assert.equal(buildExaMcpConfig(""), null);
  const config = buildExaMcpConfig("exa_test_key");
  assert.equal(config.type, "http");
  assert.match(config.url, /mcp\.exa\.ai/);
  assert.match(config.url, /web_search_exa/);
  assert.match(config.url, /web_search_advanced_exa/);
  assert.match(config.url, /web_fetch_exa/);
  assert.deepEqual(Object.keys(config.headers), ["x-api-key"]);
  assert.equal(config.headers["x-api-key"], "exa_test_key");
});

test("trusted source catalog includes required builder sources with lane fit and trust tiers", () => {
  const requiredSources = [
    ["posthog.com", "/handbook", "primary"],
    ["paulgraham.com", "", "primary"],
    ["ycombinator.com", "/library", "primary"],
    ["lennysnewsletter.com", "", "practitioner"],
    ["indiehackers.com", "", "community"],
    ["levels.io", "", "primary"],
  ];
  for (const [domain, pathPrefix, trustTier] of requiredSources) {
    const entry = MARKET_RADAR_TRUSTED_SOURCE_CATALOG.find((source) => (
      source.domain === domain && source.pathPrefix === pathPrefix
    ));
    assert.ok(entry, `${domain}${pathPrefix} is present`);
    assert.equal(entry.trustTier, trustTier);
    assert.ok(entry.lanes.length > 0);
  }

  assert.equal(
    annotateMarketRadarSourceTrust({ url: "https://posthog.com/handbook/strategy" }).trustTier,
    "primary",
  );
  assert.equal(
    annotateMarketRadarSourceTrust({ url: "https://indiehackers.com/post/pricing-test" }).trustTier,
    "community",
  );
  assert.equal(
    trustedSourcesForMarketRadarPrompt("channel").some((source) => source.domain === "producthunt.com"),
    true,
  );
});

test("source catalog roles expose market surface taxonomy", () => {
  assert.ok(MARKET_RADAR_TRUSTED_SOURCE_CATALOG.every((source) => (
    Array.isArray(source.roles) && source.roles.length > 0
  )));
  const productHunt = MARKET_RADAR_TRUSTED_SOURCE_CATALOG.find((source) => source.domain === "producthunt.com");
  assert.ok(productHunt.roles.includes("launch"));
  assert.ok(productHunt.roles.includes("pricing"));
  const eopla = MARKET_RADAR_TRUSTED_SOURCE_CATALOG.find((source) => source.domain === "eopla.net");
  assert.ok(eopla.roles.includes("founder_local_ko"));

  const promptSources = trustedSourcesForMarketRadarPrompt("channel", {
    localeProfile: { primaryLanguage: "ko" },
  });
  assert.ok(promptSources.every((source) => Array.isArray(source.roles)));
  assert.ok(promptSources.some((source) => source.roles.includes("founder_local_ko")));

  const launchQueries = buildTrustedSourceQueriesForLane({
    laneId: "alternatives_pricing",
    querySeeds: ["AI idea validation pricing"],
    sourceRoles: ["launch"],
    maxQueries: 2,
  });
  assert.ok(launchQueries.every((query) => /^site:producthunt\.com\b/.test(query)));

  const localQueries = buildTrustedSourceQueriesForLane({
    laneId: "channel",
    querySeeds: ["한국 1인 개발자 첫 유료 고객"],
    localeProfile: { primaryLanguage: "ko" },
    sourceRoles: ["founder_local_ko"],
    maxQueries: 2,
  });
  assert.ok(localQueries.every((query) => /site:disquiet\.io|site:eopla\.net/.test(query)));
});

test("provider prompt requires Korean user-facing Market Radar copy", () => {
  const prompt = buildMarketRadarProviderPrompt({
    productName: "AcmePilot",
    selfReferenceProfile: {
      productName: "AcmePilot",
      terms: ["acmepilot"],
      ownedDomains: ["acmepilot.io"],
      githubRepoSlugs: ["example/acmepilot"],
    },
    searchExclusions: {
      excludeDomains: ["acmepilot.io"],
      excludeText: ["acmepilot"],
      additionalQueries: ["AI customer discovery tools pricing"],
    },
    targetUser: "한국 1인 개발자",
    lanes: [],
  });

  assert.match(prompt, /All user-facing prose in the JSON must be Korean/);
  assert.match(prompt, /card title, summary, whyItMatters, and sourceRefs\.excerpt in Korean/);
  assert.match(prompt, /Adaptive source policy/);
  assert.match(prompt, /Context\.adaptiveProfile\.querySeeds/);
  assert.match(prompt, /fixed persona, geography, tool-stack, or platform assumptions/);
  assert.match(prompt, /짧은 한국어 신호 제목/);
  assert.match(prompt, new RegExp(NEWS_MARKET_RADAR_PROMPT_PROFILE));
  assert.match(prompt, /Self-source exclusion/);
  assert.match(prompt, /web_search_advanced_exa/);
  assert.match(prompt, /Context\.searchExclusions/);
  assert.match(prompt, /excludeDomains/);
  assert.match(prompt, /excludeText/);
  assert.match(prompt, /Treat additionalQueries as query seeds/);
  assert.match(prompt, /Do not search for the current product name/);
  assert.match(prompt, /Context\.selfReferenceProfile/);
  assert.match(prompt, /Trusted source policy/);
  assert.match(prompt, /priority starting points, not a mandatory citation list or hard whitelist/);
  assert.match(prompt, /Community-only sources/);
  assert.match(prompt, /Subscription or paywalled sources/);
  assert.doesNotMatch(prompt, /short signal title/);
  assert.doesNotMatch(prompt, /1-3 sentence synthesis/);

  const lanePrompt = buildMarketRadarLaneProviderPrompt({
    lane: {
      id: "alternatives_pricing",
      title: "대안/가격",
      hypothesis: "이미 돈을 쓰는 대안과 가격 기준은 무엇인가",
    },
  });
  assert.match(lanePrompt, /Research only the single lane/);
  assert.match(lanePrompt, /Never return more than 6 cards/);
  assert.match(lanePrompt, /Adaptive source policy/);
  assert.match(lanePrompt, /Context\.adaptiveProfile\.localeProfile/);
  assert.match(lanePrompt, /Self-source exclusion/);
  assert.match(lanePrompt, /Context\.trustedSourceHints/);
  assert.match(lanePrompt, /Never launch parallel Exa MCP tool calls/);
  assert.match(lanePrompt, /Use at most two Exa search calls total across web_search_advanced_exa and web_search_exa/);
  assert.match(lanePrompt, /Pass A: trusted\/reference\/local evidence/);
  assert.match(lanePrompt, /Pass B: competitor\/recent-market\/pricing\/review evidence/);
  assert.match(lanePrompt, /type:"fast"/);
  assert.match(lanePrompt, /numResults <= 5/);
  assert.match(lanePrompt, /enableSummary:false/);
  assert.match(lanePrompt, /highlightsMaxCharacters <= 600/);
  assert.match(lanePrompt, /Fetch at most 2 URLs total across both passes/);
  assert.doesNotMatch(lanePrompt, /Use at most two web_search_advanced_exa calls total/);
  assert.match(lanePrompt, /no additionalQueries/);
  assert.doesNotMatch(lanePrompt, /Call web_fetch_exa for at most 3 URLs/);
  assert.match(lanePrompt, /cannot make confidence strong/);
});

test("two-pass Exa lane prompt exposes bounded market-search budget", () => {
  const prompt = buildMarketRadarLaneProviderPrompt({
    lane: {
      id: "alternatives_pricing",
      title: "대안/가격",
      hypothesis: "이미 돈을 쓰는 대안과 가격 기준은 무엇인가",
    },
  });

  assert.match(prompt, /Never launch parallel Exa MCP tool calls/);
  assert.match(prompt, /Use at most two Exa search calls total across web_search_advanced_exa and web_search_exa/);
  assert.match(prompt, /Pass A: trusted\/reference\/local evidence/);
  assert.match(prompt, /Pass B: competitor\/recent-market\/pricing\/review evidence/);
  assert.match(prompt, /type:"fast"/);
  assert.match(prompt, /numResults <= 5/);
  assert.match(prompt, /enableSummary:false/);
  assert.match(prompt, /highlightsMaxCharacters <= 600/);
  assert.match(prompt, /Fetch at most 2 URLs total across both passes/);
  assert.doesNotMatch(prompt, /Use at most two web_search_advanced_exa calls total/);
  assert.match(prompt, /no additionalQueries/);
  assert.doesNotMatch(prompt, /Call web_fetch_exa for at most 3 URLs/);
});

test("trusted source queries use adaptive seeds instead of catalog hardcoded hints", () => {
  const queries = buildTrustedSourceQueriesForLane({
    laneId: "channel",
    querySeeds: ["AI customer discovery pricing"],
    maxQueries: 12,
  });

  assert.ok(queries.length > 0);
  assert.ok(queries.every((query) => /AI customer discovery pricing/.test(query)));
  assert.doesNotMatch(queries.join("\n"), /한국 1인 개발자|사이드프로젝트|빌드인퍼블릭|한국 스타트업|초기 유저|제품 출시/);
});

test("trusted source queries order Korean community sources only for Korean context", () => {
  const queries = buildTrustedSourceQueriesForLane({
    laneId: "channel",
    querySeeds: ["한국 B2B SaaS 창업자 첫 상담 예약"],
    localeProfile: { primaryLanguage: "ko" },
    maxQueries: 4,
  });

  assert.match(queries[0], /site:disquiet\.io|site:eopla\.net/);
  assert.ok(queries.every((query) => /한국 B2B SaaS 창업자 첫 상담 예약/.test(query)));
});

test("research context keeps the product name out of query seeds and records it as self-reference", () => {
  const context = buildMarketRadarResearchContext({
    workspaceRoot: "/tmp/acmepilot-public",
    workspaceEvidence: {
      onboardingHypothesis: {
        productName: "AcmePilot",
        targetUser: "한국 1인 개발자",
      },
      evidence: [{
        id: "readme:README.md",
        role: "readme",
        path: "README.md",
        title: "README.md",
        excerpt: [
          "# AcmePilot",
          "AI customer discovery workspace.",
          "Homepage: https://acmepilot.io",
          "Repository: https://github.com/example/acmepilot",
        ].join("\n"),
      }],
    },
    answers: [{
      id: "pricing",
      day: 27,
      dimension: "pricing",
      questionTitle: "가격 기준",
      answerTitle: "ShipFast, Agentfounder 같은 유료 대안",
      freeformAnswer: "AcmePilot 자체 가격이 아니라 외부 대안 가격을 봅니다.",
      occurredAt: "2026-05-20T00:00:00.000Z",
      marketRadarWeight: 4,
    }],
    now: new Date("2026-05-20T00:00:00.000Z"),
  });

  assert.equal(context.productName, "AcmePilot");
  assert.ok(context.selfReferenceProfile.terms.includes("acmepilot"));
  assert.ok(context.selfReferenceProfile.ownedDomains.includes("acmepilot.io"));
  assert.ok(context.selfReferenceProfile.githubRepoSlugs.includes("example/acmepilot"));
  assert.doesNotMatch(context.querySeeds.join(" "), /AcmePilot/i);
  assert.ok(context.adaptiveProfile.querySeeds.some((seed) => /한국 1인 개발자/.test(seed)));
  assert.deepEqual(context.searchExclusions.excludeDomains, ["acmepilot.io"]);
  assert.equal(context.searchExclusions.excludeText.length, 1);
  assert.match(context.searchExclusions.excludeText[0], /acmepilot/i);
  assert.doesNotMatch(context.searchExclusions.additionalQueries.join(" "), /AcmePilot/i);
});

test("market surface context keeps user references separate from self sources", () => {
  const fakeSecret = ["sk", "test-market-radar-secret"].join("-");
  const fakeSecretPattern = new RegExp(fakeSecret.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"));
  const context = buildMarketRadarResearchContext({
    workspaceRoot: "/tmp/acmepilot-public",
    workspaceEvidence: {
      onboardingHypothesis: {
        productName: "AcmePilot",
        targetUser: "한국 1인 개발자",
      },
      evidence: [{
        id: "user-context:AGENTS.md",
        role: "user_context",
        path: "AGENTS.md",
        title: "AGENTS.md",
        excerpt: [
          "Homepage: https://acmepilot.io",
          "Repository: https://github.com/example/acmepilot",
          "User-designated competitors:",
          "- https://indiefounders.net/",
          "- https://www.threads.com/@classbinu",
          "- https://www.producthunt.com/products/demandproof",
          "- https://eopla.net/magazines/41464",
          `Token: ${fakeSecret}`,
        ].join("\n"),
      }],
    },
    answers: [{
      id: "market",
      day: 27,
      dimension: "pricing",
      answerTitle: "Agentfounder, DemandProof 같은 유료 대안을 본다",
      freeformAnswer: "threads.com/@classbinu와 indiefounders.net은 참고 사례다.",
      occurredAt: "2026-05-20T00:00:00.000Z",
      marketRadarWeight: 4,
    }],
    now: new Date("2026-05-20T00:00:00.000Z"),
  });

  assert.ok(context.marketSurfaces);
  assert.ok(context.marketSurfaces.excluded_self.some((surface) => surface.domain === "acmepilot.io"));
  assert.ok(context.marketSurfaces.excluded_self.some((surface) => surface.domain === "github.com"));
  assert.ok(context.marketSurfaces.user_reference.some((surface) => surface.domain === "indiefounders.net"));
  assert.ok(context.marketSurfaces.social_profile.some((surface) => surface.domain === "threads.com"));
  assert.ok(context.marketSurfaces.launch.some((surface) => surface.domain === "producthunt.com"));
  assert.ok(context.marketSurfaces.local_ko.some((surface) => surface.domain === "eopla.net"));
  assert.doesNotMatch(JSON.stringify(context.marketSurfaces), fakeSecretPattern);

  const laneContext = buildMarketRadarLaneResearchContext(context, "channel");
  assert.ok(laneContext.marketSurfaces.user_reference.some((surface) => surface.domain === "indiefounders.net"));
  assert.ok(laneContext.marketSurfaces.social_profile.some((surface) => surface.domain === "threads.com"));
  const prompt = buildMarketRadarLaneProviderPrompt(laneContext);
  assert.match(prompt, /Context\.marketSurfaces/);
  assert.doesNotMatch(prompt, fakeSecretPattern);
});

test("trusted source hints are lane-specific and still respect self-source exclusion", () => {
  const context = buildMarketRadarResearchContext({
    workspaceRoot: "/tmp/acmepilot-public",
    workspaceEvidence: {
      onboardingHypothesis: {
        productName: "AcmePilot",
        targetUser: "한국 1인 개발자",
      },
      evidence: [{
        id: "readme:README.md",
        role: "readme",
        path: "README.md",
        title: "README.md",
        excerpt: "# AcmePilot\nHomepage: https://acmepilot.io",
      }],
    },
    answers: [{
      id: "icp",
      day: 1,
      dimension: "icp",
      questionTitle: "누가 절박한가",
      answerTitle: "AcmePilot을 만드는 한국 1인 개발자가 아니라, 유료 AI 도구를 이미 쓰는 1인 빌더",
      occurredAt: "2026-05-20T00:00:00.000Z",
      marketRadarWeight: 4,
    }],
    now: new Date("2026-05-20T00:00:00.000Z"),
  });
  const laneContext = buildMarketRadarLaneResearchContext(context, "channel");

  assert.equal(laneContext.trustedSourceHints.mode, "priority_seed_not_whitelist");
  assert.ok(laneContext.trustedSourceHints.sources.length <= 4);
  for (const source of laneContext.trustedSourceHints.sources) {
    assert.deepEqual(
      Object.keys(source).sort(),
      ["domain", "key", "label", "pathPrefix", "roles", "trustTier"].sort(),
    );
  }
  assert.ok(laneContext.trustedSourceHints.queries.length > 0);
  assert.ok(laneContext.trustedSourceHints.queries.length <= 3);
  assert.ok(laneContext.trustedSourceHints.queries.some((query) => /유료 AI 도구|한국 1인 개발자|Find public communities/.test(query)));
  assert.doesNotMatch(laneContext.trustedSourceHints.queries.join(" "), /AcmePilot/i);
  assert.doesNotMatch(laneContext.searchExclusions.additionalQueries.join(" "), /AcmePilot/i);

  const prompt = buildMarketRadarLaneProviderPrompt(laneContext);
  assert.match(prompt, /type:"fast"/);
  assert.match(prompt, /enableSummary:false/);
  assert.doesNotMatch(prompt, /Search at least 2 relevant trusted-source queries/);
});

test("news market radar self-source logic does not hard-code dogfood product literals", async () => {
  const source = await fs.readFile(new URL("../sidecar/news-market-radar.mjs", import.meta.url), "utf8");
  assert.doesNotMatch(source, /agentic30\.app/i);
  assert.doesNotMatch(source, /october-academy\/agentic30/i);
  assert.doesNotMatch(source, /selfReferenceTermsMatch\(["']agentic30/i);
});

test("provider timeout is long enough for Exa research and has a user-readable label", () => {
  assert.equal(normalizeNewsMarketRadarProviderTimeout(""), 900_000);
  assert.equal(normalizeNewsMarketRadarProviderTimeout("1000"), 30_000);
  assert.equal(normalizeNewsMarketRadarProviderTimeout("1500000"), 1_200_000);
  assert.equal(formatNewsMarketRadarProviderTimeout(900_000), "15m");
  assert.equal(formatNewsMarketRadarProviderTimeout(45_000), "45s");
});

test("Codex Exa MCP tool timeout defaults to 300 seconds with a provider-aware cap", () => {
  assert.equal(normalizeNewsMarketRadarCodexExaMcpToolTimeout(""), 300);
  assert.equal(normalizeNewsMarketRadarCodexExaMcpToolTimeout("180"), 180);
  assert.equal(normalizeNewsMarketRadarCodexExaMcpToolTimeout("999"), 300);
  assert.equal(normalizeNewsMarketRadarCodexExaMcpToolTimeout("", { providerTimeoutMs: 45_000 }), 40);
  assert.equal(normalizeNewsMarketRadarCodexExaMcpToolTimeout("999", { providerTimeoutMs: 10_000 }), 15);

  assert.deepEqual(
    applyNewsMarketRadarCodexExaMcpToolTimeout({ type: "http", url: "https://mcp.exa.ai/mcp" }, 300),
    { type: "http", url: "https://mcp.exa.ai/mcp", tool_timeout_sec: 300 },
  );
  assert.deepEqual(
    applyNewsMarketRadarCodexExaMcpToolTimeout({ type: "http", tool_timeout_sec: 120 }, 300),
    { type: "http", tool_timeout_sec: 120 },
  );
});

test("Codex Exa MCP tool failure classification distinguishes timeout from other failures", () => {
  const timeout = classifyNewsMarketRadarExaMcpToolFailure({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      server: "exa",
      tool: "web_fetch_exa",
      status: "failed",
      error: { message: "timed out awaiting tools/call after 300s" },
    },
  });
  assert.equal(timeout.reason, NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON);
  assert.equal(timeout.code, NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON);
  assert.equal(timeout.tool, "web_fetch_exa");

  const nonTimeout = classifyNewsMarketRadarExaMcpToolFailure({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      server: "exa",
      tool: "web_search_exa",
      status: "failed",
      error: { message: "HTTP 401 unauthorized" },
    },
  });
  assert.equal(nonTimeout.reason, NEWS_MARKET_RADAR_EXA_MCP_ERROR_REASON);

  assert.equal(classifyNewsMarketRadarExaMcpToolFailure({
    type: "item.completed",
    item: {
      type: "mcp_tool_call",
      server: "github",
      tool: "search",
      status: "failed",
      error: { message: "timed out" },
    },
  }), null);
});

test("progress status recomputes elapsed from refresh start for heartbeat updates", () => {
  const status = buildNewsMarketRadarProgressStatus({
    stage: "running_provider_research",
    progressText: "Codex Exa MCP로 공개 근거를 검색하는 중",
    elapsedMs: 0,
    researchSource: "Codex Exa MCP",
  }, {
    reason: "manual",
    startedAt: 1_000,
    nowMs: 12_500,
  });

  assert.equal(status.elapsedMs, 11_500);
  assert.equal(status.stepIndex, 4);
  assert.equal(status.stepCount, NEWS_MARKET_RADAR_PROGRESS_STEPS.length);
  assert.equal(status.researchSource, "Codex Exa MCP");
});

test("snapshot normalization requires two independent domains for strong evidence", () => {
  const oneSource = normalizeNewsMarketRadarSnapshot({
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "alternatives_pricing",
      cards: [{
        id: "one",
        title: "One source",
        summary: "Only one domain",
        impact: "strengthens",
        sourceRefs: [{ url: "https://example.com/a", title: "A" }],
      }],
    }],
  }, { now: new Date("2026-05-20T00:00:00.000Z") });
  assert.equal(oneSource.lanes.find((lane) => lane.id === "alternatives_pricing").cards[0].confidence, "weak");

  const twoSources = normalizeNewsMarketRadarSnapshot({
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "alternatives_pricing",
      cards: [{
        id: "two",
        title: "Two source",
        summary: "Two domains",
        impact: "strengthens",
        sourceRefs: [
          { url: "https://example.com/a", title: "A" },
          { url: "https://another.example/b", title: "B" },
        ],
      }],
    }],
  }, { now: new Date("2026-05-20T00:00:00.000Z") });
  assert.equal(twoSources.lanes.find((lane) => lane.id === "alternatives_pricing").cards[0].confidence, "strong");
});

test("community-only evidence cannot produce strong confidence", () => {
  const snapshot = normalizeNewsMarketRadarSnapshot({
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "channel",
      cards: [{
        id: "community-only",
        title: "커뮤니티 반응만으로는 강한 근거가 아닙니다",
        summary: "두 커뮤니티 출처가 있어도 보강 근거가 필요합니다.",
        impact: "strengthens",
        confidence: "strong",
        sourceRefs: [
          { url: "https://indiehackers.com/post/pricing-test", title: "Pricing test" },
          { url: "https://news.ycombinator.com/show/item?id=1", title: "Show HN" },
        ],
      }],
    }],
  }, { now: new Date("2026-05-20T00:00:00.000Z") });

  assert.equal(snapshot.lanes.find((lane) => lane.id === "channel").cards[0].confidence, "medium");
});

test("trusted-source reranking prefers primary corroborated evidence over generic sources", () => {
  const snapshot = normalizeNewsMarketRadarSnapshot({
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "alternatives_pricing",
      cards: [
        {
          id: "generic",
          title: "일반 블로그 가격 글",
          summary: "일반 출처의 가격 글입니다.",
          impact: "strengthens",
          sourceRefs: [
            { url: "https://random-seo.example/pricing-tools", title: "Pricing tools" },
            { url: "https://another-random.example/reviews", title: "Reviews" },
          ],
        },
        {
          id: "trusted",
          title: "신뢰 출처가 가격 기준을 보강합니다",
          summary: "공신력 있는 SaaS 벤치마크와 운영 글이 함께 가격 기준을 보여줍니다.",
          impact: "strengthens",
          sourceRefs: [
            {
              url: "https://posthog.com/handbook/strategy/pricing",
              title: "PostHog pricing strategy",
              publishedAt: "2026-01-01T00:00:00.000Z",
            },
            {
              url: "https://chartmogul.com/insights/saas-pricing",
              title: "SaaS pricing benchmarks",
              publishedAt: "2026-02-01T00:00:00.000Z",
            },
          ],
        },
      ],
    }],
  }, { now: new Date("2026-05-20T00:00:00.000Z") });

  const cards = snapshot.lanes.find((lane) => lane.id === "alternatives_pricing").cards;
  assert.equal(cards[0].id, "trusted");
  assert.equal(cards[0].confidence, "strong");
});

test("locale reranking prefers Korean market sources only for Korean context", () => {
  const rawSnapshot = {
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "channel",
      cards: [
        {
          id: "generic-english",
          title: "Generic English launch advice",
          summary: "Two generic English domains discuss launch advice.",
          impact: "strengthens",
          confidence: "strong",
          sourceRefs: [
            { url: "https://random-saas.example/launch", title: "Launch advice", excerpt: "Launch to founders." },
            { url: "https://another-saas.example/community", title: "Community", excerpt: "Find a community." },
          ],
        },
        {
          id: "korean-first",
          title: "한국 1인 개발자는 커뮤니티 공개 기록에 반응합니다",
          summary: "디스콰이엇과 EO Planet의 한국어 공개 글은 국내 초기 유저 탐색 맥락을 더 직접적으로 보여줍니다.",
          impact: "strengthens",
          confidence: "strong",
          sourceRefs: [
            { url: "https://disquiet.io/product/example", title: "디스콰이엇 공개", excerpt: "한국 1인 개발자 사이드프로젝트 공개 글입니다." },
            { url: "https://eopla.net/magazines/example", title: "EO Planet", excerpt: "한국 스타트업 초기 유저와 고객 인터뷰 맥락입니다." },
          ],
        },
      ],
    }],
  };

  const withoutLocaleContext = normalizeNewsMarketRadarSnapshot(rawSnapshot, {
    now: new Date("2026-05-20T00:00:00.000Z"),
  });
  assert.equal(withoutLocaleContext.lanes.find((lane) => lane.id === "channel").cards[0].id, "generic-english");

  const snapshot = normalizeNewsMarketRadarSnapshot(rawSnapshot, {
    now: new Date("2026-05-20T00:00:00.000Z"),
    adaptiveProfile: {
      localeProfile: { primaryLanguage: "ko" },
      relevanceTerms: ["한국 1인 개발자", "초기 유저", "고객 인터뷰"],
    },
  });

  const cards = snapshot.lanes.find((lane) => lane.id === "channel").cards;
  assert.equal(cards[0].id, "korean-first");
  assert.equal(cards[0].confidence, "medium");
});

test("snapshot normalization removes dynamic self-sources and drops self-only cards", () => {
  const snapshot = normalizeNewsMarketRadarSnapshot({
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "alternatives_pricing",
      cards: [
        {
          id: "self-home",
          title: "AcmePilot 홈페이지는 시장 근거가 아닙니다",
          summary: "자기 제품 페이지입니다.",
          impact: "unknown",
          sourceRefs: [{
            url: "https://acmepilot.io",
            title: "AcmePilot - AI customer discovery workspace",
            excerpt: "AcmePilot은 AI customer discovery workspace입니다.",
          }],
        },
        {
          id: "self-github",
          title: "GitHub 자기 저장소도 제외합니다",
          summary: "자기 제품 저장소입니다.",
          impact: "unknown",
          sourceRefs: [{
            url: "https://github.com/example/acmepilot",
            title: "GitHub - example/acmepilot",
            excerpt: "AcmePilot repository.",
          }],
        },
        {
          id: "self-listing",
          title: "외부 listing의 자기 제품도 제외합니다",
          summary: "자기 제품 listing입니다.",
          impact: "unknown",
          sourceRefs: [{
            url: "https://launchlist.dev/products/acmepilot",
            title: "AcmePilot | LaunchList",
            excerpt: "LaunchList에는 AcmePilot 가격이 Subscription $99/month로 표시되어 있습니다.",
          }],
        },
        {
          id: "mixed-one",
          title: "외부 대안 하나만 남으면 약한 근거입니다",
          summary: "Self-source 제거 후 독립 도메인이 하나만 남습니다.",
          impact: "strengthens",
          confidence: "strong",
          sourceRefs: [
            {
              url: "https://launchlist.dev/products/acmepilot",
              title: "AcmePilot | LaunchList",
              excerpt: "AcmePilot 가격 페이지입니다.",
            },
            {
              url: "https://shipfa.st",
              title: "Launch Your Startup in Days, Not Weeks | ShipFast",
              excerpt: "ShipFast는 Starter $199, All-in $249를 전면에 둡니다.",
            },
          ],
        },
        {
          id: "mixed-two",
          title: "외부 대안 두 개는 유지합니다",
          summary: "Self-source 제거 후에도 두 독립 도메인이 남습니다.",
          impact: "strengthens",
          confidence: "strong",
          sourceRefs: [
            {
              url: "https://acmepilot.io/pricing",
              title: "AcmePilot pricing",
              excerpt: "AcmePilot 자기 가격입니다.",
            },
            {
              url: "https://agentfounder.ai/pricing",
              title: "Pricing - Agentfounder",
              excerpt: "Agentfounder는 $299/month 또는 $2,399/year를 제시합니다.",
            },
            {
              url: "https://custdev.app",
              title: "CustDev.app - AI Agent Swarm for Customer Discovery",
              excerpt: "CustDev.app은 solo founders용 $49/month와 teams용 $199/month를 제시합니다.",
            },
          ],
        },
      ],
    }],
  }, {
    now: new Date("2026-05-20T00:00:00.000Z"),
    selfReferenceProfile: {
      productName: "AcmePilot",
      workspaceBasename: "acmepilot-public",
      ownedDomains: ["acmepilot.io"],
      githubRepoSlugs: ["example/acmepilot"],
    },
  });

  const cards = snapshot.lanes.find((lane) => lane.id === "alternatives_pricing").cards;
  assert.deepEqual(cards.map((card) => card.id).sort(), ["mixed-one", "mixed-two"]);
  const mixedOne = cards.find((card) => card.id === "mixed-one");
  const mixedTwo = cards.find((card) => card.id === "mixed-two");
  assert.deepEqual(mixedOne.sourceRefs.map((source) => source.domain), ["shipfa.st"]);
  assert.equal(mixedOne.confidence, "weak");
  assert.deepEqual(mixedTwo.sourceRefs.map((source) => source.domain), ["agentfounder.ai", "custdev.app"]);
  assert.equal(mixedTwo.confidence, "strong");
  assert.equal(
    cards.some((card) => card.sourceRefs.some((source) => ["acmepilot.io", "github.com", "launchlist.dev"].includes(source.domain))),
    false,
  );
});

test("legacy EXA_API_KEY missing cache is non-blocking when provider Exa MCP exists", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.dirname(resolveNewsMarketRadarCachePath(root)), { recursive: true });
    await fs.writeFile(resolveNewsMarketRadarCachePath(root), JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-05-20T00:00:00.000Z",
      snapshot: {
        schemaVersion: 1,
        generatedAt: "2026-05-20T00:00:00.000Z",
        nextRefreshAfter: "2026-05-21T00:00:00.000Z",
        status: {
          state: "failed",
          lastSuccessAt: null,
          stale: true,
          error: "EXA_API_KEY is not configured.",
          reason: "exa_api_key_missing",
        },
        lanes: [{
          id: "icp",
          cards: [{
            id: "legacy-card",
            title: "Legacy card",
            summary: "Old cache content is preserved while the status is normalized.",
            impact: "unknown",
            sourceRefs: [{ url: "https://example.com/old", title: "Old" }],
          }],
        }],
      },
    }));

    const withProviderMcp = await loadNewsMarketRadarSnapshot({
      workspaceRoot: root,
      exaConfigured: true,
      exaResearchSource: "Codex Exa MCP",
      now: new Date("2026-05-20T01:00:00.000Z"),
    });
    assert.equal(withProviderMcp.status.state, "stale");
    assert.equal(withProviderMcp.status.reason, "prompt_profile_changed");
    assert.equal(withProviderMcp.status.error, null);
    assert.equal(withProviderMcp.status.researchSource, "Codex Exa MCP");
    assert.equal(withProviderMcp.lanes.find((lane) => lane.id === "icp").cards.length, 1);

    const withoutRoute = await loadNewsMarketRadarSnapshot({
      workspaceRoot: root,
      now: new Date("2026-05-20T01:00:00.000Z"),
    });
    assert.equal(withoutRoute.status.state, "failed");
    assert.equal(withoutRoute.status.reason, "exa_mcp_missing");
    assert.equal(withoutRoute.status.error, "Exa MCP is not configured.");
    assert.equal(withoutRoute.status.researchSource, null);
  });
});

test("old Market Radar prompt profile cache is marked stale when Exa is configured", async () => {
  await withTmpWorkspace(async (root) => {
    assert.equal(NEWS_MARKET_RADAR_PROMPT_PROFILE, "ko_market_radar_v7_market_surfaces_two_pass_exa");
    await fs.mkdir(path.dirname(resolveNewsMarketRadarCachePath(root)), { recursive: true });
    await fs.writeFile(resolveNewsMarketRadarCachePath(root), JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-05-20T00:00:00.000Z",
      snapshot: {
        schemaVersion: 1,
        promptProfile: "ko_market_radar_v3_dynamic_no_self_sources",
        generatedAt: "2026-05-20T00:00:00.000Z",
        nextRefreshAfter: "2026-05-21T00:00:00.000Z",
        status: {
          state: "ready",
          lastSuccessAt: "2026-05-20T00:00:00.000Z",
          stale: false,
          reason: "manual",
        },
        lanes: [{
          id: "problem",
          cards: [{
            id: "old-profile",
            title: "Old profile card",
            summary: "Old profile cache should be refreshed.",
            impact: "strengthens",
            sourceRefs: [
              { url: "https://example.com/a", title: "A" },
              { url: "https://other.example/b", title: "B" },
            ],
          }],
        }],
      },
    }));

    const snapshot = await loadNewsMarketRadarSnapshot({
      workspaceRoot: root,
      exaConfigured: true,
      exaResearchSource: "Codex Exa MCP",
      now: new Date("2026-05-20T01:00:00.000Z"),
    });

    assert.equal(snapshot.status.state, "stale");
    assert.equal(snapshot.status.reason, "prompt_profile_changed");
    assert.equal(snapshot.status.error, null);
  });
});

test("refresh persists provider result and missing Exa route returns stale cached state", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const now = new Date("2026-05-20T00:00:00.000Z");
    const providerModes = [];
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      exaApiKey: "exa_test_key",
      force: true,
      now,
      providerResearcher: async ({ mode }) => {
        providerModes.push(mode);
        return {
        lanes: [{
          id: "icp",
          cards: [{
            id: "card-1",
            title: "1인 개발자는 이미 코딩 도구에 돈을 씁니다",
            summary: "코딩 도구 결제가 대안 가격 기준을 만듭니다.",
            impact: "strengthens",
            sourceRefs: [
              { url: "https://example.com/pricing", title: "Pricing" },
              { url: "https://other.example/review", title: "Review" },
            ],
          }],
        }],
        };
      },
    });
    assert.equal(snapshot.status.state, "ready");
    assert.equal(snapshot.status.researchSource, "Exa Search (EXA_API_KEY)");
    assert.equal(snapshot.lanes.find((lane) => lane.id === "icp").cards.length, 1);
    assert.deepEqual([...new Set(providerModes)], ["market_radar"]);
    const stat = await fs.stat(resolveNewsMarketRadarCachePath(root));
    assert.equal(stat.mode & 0o777, 0o600);

    const noKey = await refreshNewsMarketRadar({
      workspaceRoot: root,
      exaApiKey: "",
      now: new Date("2026-05-21T00:00:00.000Z"),
      providerResearcher: async () => {
        throw new Error("should not run");
      },
    });
    assert.equal(noKey.status.state, "failed");
    assert.equal(noKey.status.reason, DIRECT_EXA_API_KEY_REQUIRED_REASON);
    assert.equal(noKey.status.stale, true);
    assert.equal(noKey.lanes.find((lane) => lane.id === "icp").cards.length, 1);
  });
});

test("zero-card refresh persists explicit empty-result failure", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => testLaneResearchResult(laneId),
    });

    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T01:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => ({
        researchSource: "Codex Exa MCP",
        lane: {
          id: laneId,
          cards: [],
        },
      }),
    });
    const loaded = await loadNewsMarketRadarSnapshot({
      workspaceRoot: root,
      exaConfigured: true,
      now: new Date("2026-05-20T01:01:00.000Z"),
    });

    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "failed");
    assert.equal(second.status.reason, "empty_result");
    assert.equal(second.status.stale, false);
    assert.equal(second.status.lastSuccessAt, null);
    assert.equal(second.generatedAt, "2026-05-20T01:00:00.000Z");
    assert.equal(countCards(second), 0);
    assert.equal(loaded.status.state, "failed");
    assert.equal(loaded.status.reason, "empty_result");
    assert.equal(loaded.status.stale, false);
    assert.equal(countCards(loaded), 0);
  });
});

test("all-lane research failure does not preserve previous cardful Market Radar cache", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => testLaneResearchResult(laneId),
    });

    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T01:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        throw new Error(`provider failed for ${laneId}`);
      },
    });
    const loaded = await loadNewsMarketRadarSnapshot({
      workspaceRoot: root,
      exaConfigured: true,
      now: new Date("2026-05-20T01:01:00.000Z"),
    });

    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "failed");
    assert.equal(second.status.reason, "manual");
    assert.match(second.status.error, /완료된 가설 리서치가 없습니다/);
    assert.equal(second.status.stale, false);
    assert.equal(second.status.lastSuccessAt, null);
    assert.ok(second.status.partialFailures.length > 0);
    assert.equal(countCards(second), 0);
    assert.equal(loaded.status.state, "failed");
    assert.equal(countCards(loaded), 0);
  });
});

test("load marks cardless ready cache as failed even when cardful run exists", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const cardful = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => testLaneResearchResult(laneId),
    });
    await fs.writeFile(resolveNewsMarketRadarCachePath(root), JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-05-20T01:00:00.000Z",
      snapshot: {
        schemaVersion: 1,
        promptProfile: NEWS_MARKET_RADAR_PROMPT_PROFILE,
        generatedAt: "2026-05-20T01:00:00.000Z",
        nextRefreshAfter: "2026-05-21T01:00:00.000Z",
        status: {
          state: "ready",
          lastSuccessAt: "2026-05-20T01:00:00.000Z",
          stale: false,
          reason: "manual",
          researchSource: "Codex Exa MCP",
        },
        lanes: [
          { id: "icp", cards: [] },
          { id: "problem", cards: [] },
          { id: "alternatives_pricing", cards: [] },
          { id: "channel", cards: [] },
          { id: "platform", cards: [] },
        ],
      },
    }));

    const loaded = await loadNewsMarketRadarSnapshot({
      workspaceRoot: root,
      exaConfigured: true,
      exaResearchSource: "Codex Exa MCP",
      now: new Date("2026-05-20T01:01:00.000Z"),
    });

    assert.equal(cardful.status.state, "ready");
    assert.equal(loaded.status.state, "failed");
    assert.equal(loaded.status.reason, "empty_result");
    assert.equal(loaded.status.stale, false);
    assert.equal(loaded.status.lastSuccessAt, null);
    assert.equal(loaded.generatedAt, "2026-05-20T01:00:00.000Z");
    assert.equal(countCards(loaded), 0);
  });
});

test("load marks cardless ready cache as failed when no cardful run exists", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.dirname(resolveNewsMarketRadarCachePath(root)), { recursive: true });
    await fs.writeFile(resolveNewsMarketRadarCachePath(root), JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-05-20T01:00:00.000Z",
      snapshot: {
        schemaVersion: 1,
        promptProfile: NEWS_MARKET_RADAR_PROMPT_PROFILE,
        generatedAt: "2026-05-20T01:00:00.000Z",
        nextRefreshAfter: "2026-05-21T01:00:00.000Z",
        status: {
          state: "ready",
          lastSuccessAt: "2026-05-20T01:00:00.000Z",
          stale: false,
          reason: "manual",
          researchSource: "Codex Exa MCP",
        },
        lanes: [
          { id: "icp", cards: [] },
          { id: "problem", cards: [] },
          { id: "alternatives_pricing", cards: [] },
          { id: "channel", cards: [] },
          { id: "platform", cards: [] },
        ],
      },
    }));

    const loaded = await loadNewsMarketRadarSnapshot({
      workspaceRoot: root,
      exaConfigured: true,
      exaResearchSource: "Codex Exa MCP",
      now: new Date("2026-05-20T01:01:00.000Z"),
    });

    assert.equal(loaded.status.state, "failed");
    assert.equal(loaded.status.reason, "empty_result");
    assert.match(loaded.status.error, /표시할 수 있는 공개 근거 카드/);
    assert.equal(countCards(loaded), 0);
  });
});

test("refresh fails fast when provider Exa route has no direct API key", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    let providerCalled = false;
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [{
        provider: "codex",
        source: "provider_mcp",
        label: "Codex Exa MCP",
        serverName: "exa",
        mcpConfig: {
          type: "http",
          url: "https://mcp.exa.ai/mcp",
        },
      }],
      providerResearcher: async () => {
        providerCalled = true;
        return testLaneResearchResult("icp");
      },
    });

    assert.equal(providerCalled, false);
    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, DIRECT_EXA_API_KEY_REQUIRED_REASON);
    assert.match(snapshot.status.error, /direct Exa Search 연결 키/);
    assert.equal(countCards(snapshot), 0);
    assert.equal(snapshot.status.partialFailures.length, 5);

    const loaded = await loadNewsMarketRadarSnapshot({
      workspaceRoot: root,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaConfigured: true,
      exaResearchSource: "Codex Exa MCP",
    });
    assert.equal(loaded.status.state, "failed");
    assert.equal(loaded.status.reason, DIRECT_EXA_API_KEY_REQUIRED_REASON);
  });
});

test("daily refresh reuses fresh Market Radar cache before checking missing direct Exa key", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    let calls = 0;
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        calls += 1;
        return testLaneResearchResult(laneId);
      },
    });

    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "daily",
      force: false,
      now: new Date("2026-05-20T01:00:00.000Z"),
      exaResearchRoutes: [{
        provider: "codex",
        source: "provider_mcp",
        label: "Codex Exa MCP",
        serverName: "exa",
        mcpConfig: {
          type: "http",
          url: "https://mcp.exa.ai/mcp",
        },
      }],
      providerResearcher: async ({ laneId }) => {
        calls += 1;
        return testLaneResearchResult(laneId);
      },
    });

    assert.equal(calls, 5);
    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "ready");
    assert.equal(second.generatedAt, first.generatedAt);
    assert.equal(second.status.reason, first.status.reason);
  });
});

test("missing direct Exa key marks stale Market Radar failure without discarding previous cards", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => testLaneResearchResult(laneId),
    });
    let providerCalled = false;
    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-21T01:00:00.000Z"),
      exaResearchRoutes: [{
        provider: "codex",
        source: "provider_mcp",
        label: "Codex Exa MCP",
        serverName: "exa",
        mcpConfig: {
          type: "http",
          url: "https://mcp.exa.ai/mcp",
        },
      }],
      providerResearcher: async () => {
        providerCalled = true;
        return testLaneResearchResult("icp");
      },
    });

    assert.equal(providerCalled, false);
    assert.equal(first.status.state, "ready");
    assert.equal(countCards(first), 5);
    assert.equal(second.status.state, "failed");
    assert.equal(second.status.reason, DIRECT_EXA_API_KEY_REQUIRED_REASON);
    assert.equal(second.status.stale, true);
    assert.equal(countCards(second), 5);
    assert.equal(second.status.partialFailures.length, 5);
  });
});

test("daily refresh reuses recent missing-key Market Radar failure during cooldown", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const noKeyRoute = {
      provider: "codex",
      source: "provider_mcp",
      label: "Codex Exa MCP",
      serverName: "exa",
      mcpConfig: {
        type: "http",
        url: "https://mcp.exa.ai/mcp",
      },
    };
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [noKeyRoute],
      providerResearcher: async () => {
        throw new Error("provider should not be called without direct Exa key");
      },
    });
    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "daily",
      force: false,
      now: new Date(Date.parse("2026-05-20T00:00:00.000Z") + 60_000),
      exaResearchRoutes: [noKeyRoute],
      providerResearcher: async () => {
        throw new Error("provider should not be retried during failed refresh cooldown");
      },
    });

    assert.equal(first.status.state, "failed");
    assert.equal(first.status.reason, DIRECT_EXA_API_KEY_REQUIRED_REASON);
    assert.equal(second.status.state, "failed");
    assert.equal(second.status.reason, DIRECT_EXA_API_KEY_REQUIRED_REASON);
    assert.equal(second.generatedAt, first.generatedAt);
    assert.equal(second.contextFingerprint, first.contextFingerprint);
  });
});

test("refresh uses provider Exa route header key without requiring EXA_API_KEY", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    let observedRoute = null;
    const progressStages = [];
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [{
        provider: "codex",
        source: "provider_mcp",
        label: "Codex Exa MCP",
        serverName: "exa",
        mcpConfig: {
          type: "http",
          url: "https://mcp.exa.ai/mcp",
          headers: { "x-api-key": "exa_test_key" },
        },
      }],
      providerResearcher: async ({ exaMcpConfig, exaResearchRoute, exaApiKeyConfigured }) => {
        observedRoute = { exaMcpConfig, exaResearchRoute, exaApiKeyConfigured };
        return {
          researchSource: "Codex Exa MCP",
          lanes: [{
            id: "icp",
            cards: [{
              id: "card-1",
              title: "MCP-backed research",
              summary: "Research ran through provider MCP.",
              impact: "strengthens",
              sourceRefs: [
                { url: "https://example.com/a", title: "A" },
                { url: "https://other.example/b", title: "B" },
              ],
            }],
          }],
        };
      },
      onProgress: (progress) => {
        progressStages.push(progress.stage);
      },
    });

    assert.equal(observedRoute.exaApiKeyConfigured, false);
    assert.match(observedRoute.exaMcpConfig.url, /web_search_advanced_exa/);
    assert.match(observedRoute.exaMcpConfig.url, /web_search_exa/);
    assert.match(observedRoute.exaMcpConfig.url, /web_fetch_exa/);
    assert.equal(observedRoute.exaResearchRoute.label, "Codex Exa MCP");
    assert.equal(snapshot.status.state, "ready");
    assert.equal(snapshot.status.researchSource, "Codex Exa MCP");
    assert.equal(snapshot.lanes.find((lane) => lane.id === "icp").cards.length, 1);
    assert.ok(progressStages.includes("running_provider_research"));
  });
});

test("Market Radar auto refresh due check uses persisted refresh timestamps", () => {
  const now = new Date("2026-05-20T12:00:00.000Z");
  assert.equal(isNewsMarketRadarAutoRefreshDue(null, { now }), true);
  assert.equal(isNewsMarketRadarAutoRefreshDue({
    generatedAt: now.toISOString(),
    nextRefreshAfter: new Date(now.getTime() + 60_000).toISOString(),
    status: { state: "ready", reason: "daily" },
  }, { now }), false);
  assert.equal(isNewsMarketRadarAutoRefreshDue({
    generatedAt: new Date(now.getTime() - NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS - 1).toISOString(),
    nextRefreshAfter: null,
    status: { state: "ready", reason: "daily" },
  }, { now }), true);
  assert.equal(isNewsMarketRadarAutoRefreshDue({
    generatedAt: now.toISOString(),
    nextRefreshAfter: new Date(now.getTime() + NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS).toISOString(),
    status: { state: "idle", reason: "not_loaded" },
  }, { now }), true);
});

test("daily auto refresh reuses a fresh ready snapshot even when workspace context changed", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    let calls = 0;
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        calls += 1;
        return testLaneResearchResult(laneId);
      },
    });

    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo AI app founders");
    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "daily",
      force: false,
      now: new Date("2026-05-20T01:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        calls += 1;
        return testLaneResearchResult(laneId);
      },
    });

    assert.equal(calls, 5);
    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "ready");
    assert.equal(second.generatedAt, first.generatedAt);
    assert.equal(second.contextFingerprint, first.contextFingerprint);
  });
});

test("daily auto refresh does not retry a recent failed snapshot before the 24-hour gate", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    let calls = 0;
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async () => {
        calls += 1;
        throw new Error("provider unavailable");
      },
    });
    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "daily",
      force: false,
      now: new Date(Date.parse("2026-05-20T00:00:00.000Z") + NEWS_MARKET_RADAR_FAILED_AUTO_REFRESH_COOLDOWN_MS + 60_000),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        calls += 1;
        return testLaneResearchResult(laneId);
      },
    });

    assert.equal(calls, 5);
    assert.equal(first.status.state, "failed");
    assert.equal(second.status.state, "failed");
    assert.equal(second.generatedAt, first.generatedAt);
  });
});

test("expired daily auto refresh runs provider research again", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    let calls = 0;
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        calls += 1;
        return testLaneResearchResult(laneId);
      },
    });
    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "daily",
      force: false,
      now: new Date(Date.parse("2026-05-20T00:00:00.000Z") + NEWS_MARKET_RADAR_REFRESH_INTERVAL_MS + 1),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        calls += 1;
        return testLaneResearchResult(laneId);
      },
    });

    assert.equal(calls, 10);
    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "ready");
    assert.notEqual(second.generatedAt, first.generatedAt);
  });
});

test("manual forced refresh bypasses the daily auto refresh gate", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    let calls = 0;
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        calls += 1;
        return testLaneResearchResult(laneId);
      },
    });
    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:01:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        calls += 1;
        return testLaneResearchResult(laneId);
      },
    });

    assert.equal(calls, 10);
    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "ready");
    assert.notEqual(second.generatedAt, first.generatedAt);
  });
});

test("refresh runs every Market Radar lane with bounded concurrency", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    let active = 0;
    let maxActive = 0;
    const startedLaneIds = [];
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        active += 1;
        maxActive = Math.max(maxActive, active);
        startedLaneIds.push(laneId);
        await new Promise((resolve) => setTimeout(resolve, 25));
        active -= 1;
        return {
          lane: {
            id: laneId,
            cards: [{
              id: `${laneId}-card`,
              title: `${laneId} 한국어 신호`,
              summary: "병렬 리서치 결과입니다.",
              impact: "strengthens",
              sourceRefs: [
                { url: `https://example.com/${laneId}`, title: "A" },
                { url: `https://other.example/${laneId}`, title: "B" },
              ],
            }],
          },
        };
      },
      providerSynthesizer: async ({ candidateSnapshot }) => candidateSnapshot,
    });

    assert.equal(maxActive, NEWS_MARKET_RADAR_LANE_CONCURRENCY);
    assert.equal(new Set(startedLaneIds).size, snapshot.lanes.length);
    assert.equal(snapshot.status.state, "ready");
    assert.equal(countCards(snapshot), snapshot.lanes.length);
  });
});

test("refresh groups duplicate all-lane timeout failures and persists diagnostics", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async () => {
        throw new Error("공개 근거 검색이 15m 안에 끝나지 않았습니다");
      },
    });

    assert.equal(snapshot.status.state, "failed");
    assert.match(snapshot.status.error, /공개 근거 검색이 15m 안에 끝나지 않았습니다 \(5개 가설 모두 실패\)/);
    assert.doesNotMatch(snapshot.status.error, /\|/);
    assert.equal(snapshot.status.partialFailures.length, 5);
    assert.equal(snapshot.status.researchSource, "Codex Exa MCP");
    assert.equal(snapshot.status.startedAt, "2026-05-20T00:00:00.000Z");
    assert.match(snapshot.status.completedAt, /^\d{4}-\d{2}-\d{2}T/);
    assert.equal(Number.isFinite(snapshot.status.durationMs), true);
  });
});

test("refresh reuses recent failed daily snapshot during failed auto-refresh cooldown", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    let calls = 0;
    const route = testExaRoute();
    const first = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "manual",
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [route],
      providerResearcher: async () => {
        calls += 1;
        throw new Error("공개 근거 검색이 15m 안에 끝나지 않았습니다");
      },
    });
    const second = await refreshNewsMarketRadar({
      workspaceRoot: root,
      reason: "daily",
      force: false,
      now: new Date(Date.parse("2026-05-20T00:00:00.000Z") + NEWS_MARKET_RADAR_FAILED_AUTO_REFRESH_COOLDOWN_MS - 1),
      exaResearchRoutes: [route],
      providerResearcher: async () => {
        calls += 1;
        throw new Error("provider should not be called during cooldown");
      },
    });

    assert.equal(calls, 5);
    assert.equal(first.status.state, "failed");
    assert.equal(second.status.state, "failed");
    assert.equal(second.generatedAt, first.generatedAt);
    assert.equal(second.contextFingerprint, first.contextFingerprint);
  });
});

test("refresh keeps successful lanes ready when some lane research fails", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const failingLaneIds = new Set(["problem", "channel"]);
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        if (failingLaneIds.has(laneId)) throw new Error(`${laneId} failed`);
        return {
          lane: {
            id: laneId,
            cards: [{
              id: `${laneId}-card`,
              title: `${laneId} 한국어 신호`,
              summary: "성공한 가설 리서치 결과입니다.",
              impact: "strengthens",
              sourceRefs: [
                { url: `https://example.com/${laneId}`, title: "A" },
                { url: `https://other.example/${laneId}`, title: "B" },
              ],
            }],
          },
        };
      },
      providerSynthesizer: async ({ candidateSnapshot }) => candidateSnapshot,
    });

    assert.equal(snapshot.status.state, "ready");
    assert.equal(snapshot.status.partialFailures.length, 2);
    assert.deepEqual(snapshot.status.partialFailures.map((failure) => failure.laneId).sort(), ["channel", "problem"]);
    assert.equal(snapshot.lanes.find((lane) => lane.id === "problem").cards.length, 0);
    assert.equal(snapshot.lanes.find((lane) => lane.id === "icp").cards.length, 1);
  });
});

test("refresh hard-fails when any lane reports a Codex Exa MCP timeout", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      laneConcurrency: 1,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => {
        if (laneId === "problem") {
          throw createNewsMarketRadarExaMcpFailureError({
            reason: NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON,
            code: NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON,
            server: "exa",
            tool: "web_search_advanced_exa",
            status: "failed",
            message: "timed out awaiting tools/call after 300s",
            toolTimeoutSec: 300,
          });
        }
        return testLaneResearchResult(laneId);
      },
      providerSynthesizer: async ({ candidateSnapshot }) => candidateSnapshot,
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON);
    assert.match(snapshot.status.error, /300초/);
    assert.equal(countCards(snapshot), 0);
    assert.equal(snapshot.status.partialFailures.some((failure) => (
      failure.laneId === "problem"
      && failure.reason === NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON
      && failure.tool === "web_search_advanced_exa"
    )), true);
    assert.equal(snapshot.status.partialFailures.some((failure) => (
      failure.reason === NEWS_MARKET_RADAR_ABORTED_AFTER_EXA_MCP_TIMEOUT_REASON
    )), true);
  });
});

test("refresh stops queued lanes and aborts active lanes after a Codex Exa MCP timeout", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const startedLaneIds = [];
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      laneConcurrency: 2,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId, signal }) => {
        startedLaneIds.push(laneId);
        if (laneId === "problem") {
          await new Promise((resolve) => setTimeout(resolve, 5));
          throw createNewsMarketRadarExaMcpFailureError({
            reason: NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON,
            code: NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON,
            server: "exa",
            tool: "web_fetch_exa",
            status: "failed",
            message: "deadline exceeded while awaiting tools/call",
            toolTimeoutSec: 300,
          });
        }
        return await new Promise((resolve, reject) => {
          signal.addEventListener("abort", () => {
            const abortError = new Error("aborted");
            abortError.name = "AbortError";
            reject(abortError);
          }, { once: true });
          setTimeout(() => resolve(testLaneResearchResult(laneId)), 100);
        });
      },
      providerSynthesizer: async ({ candidateSnapshot }) => candidateSnapshot,
    });

    assert.deepEqual(startedLaneIds.sort(), ["icp", "problem"]);
    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, NEWS_MARKET_RADAR_EXA_MCP_TIMEOUT_REASON);
    assert.equal(snapshot.status.partialFailures.length, 5);
    assert.equal(snapshot.status.partialFailures.filter((failure) => (
      failure.reason === NEWS_MARKET_RADAR_ABORTED_AFTER_EXA_MCP_TIMEOUT_REASON
    )).length, 4);
  });
});

test("snapshot normalization dedupes cards by canonical source URL", () => {
  assert.equal(
    canonicalMarketRadarSourceKey({ url: "https://Example.com/pricing/?utm_source=x&ref=y#plans" }),
    canonicalMarketRadarSourceKey({ url: "https://example.com/pricing" }),
  );
  const snapshot = normalizeNewsMarketRadarSnapshot({
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "alternatives_pricing",
      cards: [
        {
          id: "a",
          title: "가격 기준이 이미 있습니다",
          summary: "첫 번째 카드입니다.",
          impact: "strengthens",
          sourceRefs: [{ url: "https://example.com/pricing?utm_source=test#plans", title: "Pricing" }],
        },
        {
          id: "b",
          title: "가격 기준이 이미 있습니다",
          summary: "두 번째 카드가 같은 URL 근거를 보강합니다.",
          impact: "strengthens",
          sourceRefs: [{ url: "https://example.com/pricing", title: "Pricing" }],
        },
      ],
    }],
  }, { now: new Date("2026-05-20T00:00:00.000Z") });

  const cards = snapshot.lanes.find((lane) => lane.id === "alternatives_pricing").cards;
  assert.equal(cards.length, 1);
  assert.match(cards[0].summary, /두 번째/);
  assert.equal(cards[0].sourceRefs.length, 1);
});

test("competitor pricing anti-signal normalization preserves market card fields", () => {
  const snapshot = normalizeNewsMarketRadarSnapshot({
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "alternatives_pricing",
      cards: [{
        id: "demandproof-pricing",
        title: "DemandProof 가격 신호",
        summary: "DemandProof는 공개 가격 기준을 제공합니다.",
        impact: "strengthens",
        confidence: "strong",
        marketEntity: "DemandProof",
        offer: "AI validation workspace",
        price: "$49 lifetime",
        evidenceType: "pricing",
        actionHint: "가격 앵커를 온보딩 가설에 반영합니다.",
        sourceRefs: [
          { url: "https://www.producthunt.com/products/demandproof", title: "DemandProof Product Hunt" },
          { url: "https://demandproof.example/pricing", title: "DemandProof pricing" },
        ],
      }],
    }],
  }, { now: new Date("2026-05-20T00:00:00.000Z") });

  const card = snapshot.lanes.find((lane) => lane.id === "alternatives_pricing").cards[0];
  assert.equal(card.marketEntity, "DemandProof");
  assert.equal(card.offer, "AI validation workspace");
  assert.equal(card.price, "$49 lifetime");
  assert.equal(card.evidenceType, "pricing");
  assert.equal(card.actionHint, "가격 앵커를 온보딩 가설에 반영합니다.");
});

test("synthesis preserves market evidence diversity", () => {
  const snapshot = normalizeNewsMarketRadarSnapshot({
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "alternatives_pricing",
      cards: [
        {
          id: "pricing-demandproof",
          title: "DemandProof 가격 기준",
          summary: "가격 기준이 있는 대안입니다.",
          impact: "strengthens",
          confidence: "strong",
          evidenceType: "pricing",
          marketEntity: "DemandProof",
          sourceRefs: [
            { url: "https://demandproof.example/pricing", title: "DemandProof pricing" },
            { url: "https://example.com/demandproof-review", title: "DemandProof review" },
          ],
        },
        {
          id: "pricing-agentfounder",
          title: "Agentfounder 가격 기준",
          summary: "월 구독 가격 기준이 있는 대안입니다.",
          impact: "strengthens",
          confidence: "strong",
          evidenceType: "pricing",
          marketEntity: "Agentfounder",
          sourceRefs: [
            { url: "https://agentfounder.ai/pricing", title: "Agentfounder pricing" },
            { url: "https://example.org/agentfounder-review", title: "Agentfounder review" },
          ],
        },
        {
          id: "pricing-shipfast",
          title: "ShipFast 가격 기준",
          summary: "라이프타임 가격 기준이 있는 대안입니다.",
          impact: "strengthens",
          confidence: "strong",
          evidenceType: "pricing",
          marketEntity: "ShipFast",
          sourceRefs: [
            { url: "https://shipfa.st/pricing", title: "ShipFast pricing" },
            { url: "https://example.net/shipfast-review", title: "ShipFast review" },
          ],
        },
        {
          id: "review-ideascanner",
          title: "IdeaScanner 리뷰",
          summary: "리뷰 근거가 있는 대안입니다.",
          impact: "mixed",
          confidence: "strong",
          evidenceType: "review",
          marketEntity: "IdeaScanner",
          sourceRefs: [
            { url: "https://g2.example/reviews/ideascanner", title: "IdeaScanner reviews" },
            { url: "https://example.edu/ideascanner", title: "IdeaScanner roundup" },
          ],
        },
        {
          id: "launch-producthunt",
          title: "Product Hunt 런칭 신호",
          summary: "런칭 표면의 반응을 보여줍니다.",
          impact: "strengthens",
          confidence: "medium",
          evidenceType: "launch",
          marketEntity: "DemandProof",
          sourceRefs: [
            { url: "https://www.producthunt.com/products/demandproof", title: "DemandProof Product Hunt" },
          ],
        },
        {
          id: "local-anti-signal",
          title: "EO Planet 약한 반응",
          summary: "국내 커뮤니티에서 약한 반응을 보인 anti-signal입니다.",
          impact: "weakens",
          confidence: "medium",
          evidenceType: "anti_signal",
          marketEntity: "Agentfounder",
          sourceRefs: [
            { url: "https://eopla.net/magazines/41464", title: "EO Planet" },
          ],
        },
      ],
    }],
  }, { now: new Date("2026-05-20T00:00:00.000Z") });

  const ids = snapshot.lanes.find((lane) => lane.id === "alternatives_pricing").cards.map((card) => card.id);
  assert.equal(ids.length, 4);
  assert.ok(ids.includes("pricing-demandproof"));
  assert.ok(ids.includes("review-ideascanner"));
  assert.ok(ids.includes("launch-producthunt"));
  assert.ok(ids.includes("local-anti-signal"));
});

test("snapshot normalization generates unique source ids for same-domain URLs", () => {
  const snapshot = normalizeNewsMarketRadarSnapshot({
    generatedAt: "2026-05-20T00:00:00.000Z",
    lanes: [{
      id: "platform",
      cards: [{
        id: "same-domain-sources",
        title: "같은 도메인의 다른 문서를 구분합니다",
        summary: "동일한 출처 도메인 안에서도 문서별 근거가 유지됩니다.",
        impact: "strengthens",
        sourceRefs: [
          { url: "https://docs.anthropic.com/en/docs/claude-code/overview", title: "Claude Code overview" },
          { url: "https://docs.anthropic.com/en/docs/claude-code/settings", title: "Claude Code settings" },
        ],
      }],
    }],
  }, { now: new Date("2026-05-20T00:00:00.000Z") });

  const sourceRefs = snapshot.lanes.find((lane) => lane.id === "platform").cards[0].sourceRefs;
  const ids = sourceRefs.map((source) => source.id);
  assert.equal(sourceRefs.length, 2);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.every((id) => id.startsWith("web-docs.anthropic.com-")));
});

test("refresh fails explicitly when final synthesis throws", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => ({
        lane: {
          id: laneId,
          cards: [{
            id: `${laneId}-card`,
            title: `${laneId} 합성 실패 신호`,
            summary: "합성이 실패하면 deterministic merge로 대체하지 않습니다.",
            impact: "strengthens",
            sourceRefs: [
              { url: `https://example.com/${laneId}`, title: "A" },
              { url: `https://other.example/${laneId}`, title: "B" },
            ],
          }],
        },
      }),
      providerSynthesizer: async () => {
        throw new Error("synthesis failed");
      },
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, "synthesis_failed");
    assert.match(snapshot.status.error, /최종 합성에 실패했습니다/);
    assert.equal(snapshot.status.stale, false);
    assert.equal(snapshot.status.lastSuccessAt, null);
    assert.equal(countCards(snapshot), 0);
  });
});

test("refresh fails explicitly when final synthesis returns zero cards", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async ({ laneId }) => ({
        lane: {
          id: laneId,
          cards: [{
            id: `${laneId}-card`,
            title: `${laneId} 빈 합성 신호`,
            summary: "빈 합성 결과는 deterministic merge로 대체하지 않습니다.",
            impact: "strengthens",
            sourceRefs: [
              { url: `https://example.com/${laneId}`, title: "A" },
              { url: `https://other.example/${laneId}`, title: "B" },
            ],
          }],
        },
      }),
      providerSynthesizer: async () => ({
        lanes: [
          { id: "icp", cards: [] },
          { id: "problem", cards: [] },
          { id: "alternatives_pricing", cards: [] },
          { id: "channel", cards: [] },
          { id: "platform", cards: [] },
        ],
      }),
    });

    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, "empty_result");
    assert.match(snapshot.status.error, /표시할 수 있는 공개 근거 카드/);
    assert.equal(snapshot.status.stale, false);
    assert.equal(snapshot.status.lastSuccessAt, null);
    assert.equal(countCards(snapshot), 0);
  });
});

test("refresh emits real progress stages for the Market Radar UI", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "docs", "ICP.md"), "# ICP\nsolo devs");
    const progressEvents = [];
    await refreshNewsMarketRadar({
      workspaceRoot: root,
      force: true,
      now: new Date("2026-05-20T00:00:00.000Z"),
      exaResearchRoutes: [testExaRoute()],
      providerResearcher: async () => ({
        researchSource: "Codex Exa MCP",
        lanes: [{
          id: "alternatives_pricing",
          cards: [{
            id: "card-1",
            title: "Progress-backed research",
            summary: "The UI can display each refresh step.",
            impact: "strengthens",
            sourceRefs: [
              { url: "https://example.com/a", title: "A" },
              { url: "https://other.example/b", title: "B" },
            ],
          }],
        }],
      }),
      onProgress: (progress) => {
        progressEvents.push(progress);
      },
    });

    for (const step of NEWS_MARKET_RADAR_PROGRESS_STEPS) {
      assert.ok(progressEvents.some((event) => event.stage === step.stage));
      assert.ok(progressEvents.some((event) => event.stepIndex === step.stepIndex));
    }
    assert.equal(
      progressEvents.every((event) => event.stepCount === NEWS_MARKET_RADAR_PROGRESS_STEPS.length),
      true,
    );
    assert.equal(progressEvents[0].researchSource, "Codex Exa MCP");
    assert.ok(progressEvents.some((event) => /5개 가설을 최대 2개씩 리서치하는 중/.test(event.progressText || "")));
    assert.ok(progressEvents.some((event) => /5개 중 5개 완료/.test(event.progressText || "")));
  });
});

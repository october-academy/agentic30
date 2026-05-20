import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  appendCurriculumAnswer,
  buildExaMcpConfig,
  collectWorkspaceEvidence,
  loadCurriculumAnswerLog,
  normalizeNewsMarketRadarSnapshot,
  rankAnswersForMarketRadar,
  refreshNewsMarketRadar,
  resolveCurriculumAnswerLogPath,
  resolveNewsMarketRadarCachePath,
} from "../sidecar/news-market-radar.mjs";

async function withTmpWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-news-"));
  try {
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
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
    await fs.mkdir(path.join(root, ".git"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "ICP.md"), "# ICP\nsolo devs with paid tool spend");
    await fs.writeFile(path.join(root, ".git", "config"), "secret");
    await fs.writeFile(path.join(root, "docs", "api-key.md"), "should not be read");
    const result = await collectWorkspaceEvidence({
      workspaceRoot: root,
      scanResult: {
        icp: "docs/ICP.md",
        spec: ".git/config",
        goal: "docs/api-key.md",
      },
    });
    assert.equal(result.evidence.some((item) => item.path === "docs/ICP.md"), true);
    assert.equal(result.evidence.some((item) => item.path === ".git/config"), false);
    assert.equal(result.evidence.some((item) => item.path === "docs/api-key.md"), false);
  });
});

test("Exa MCP config is BYOK and redacts diagnostics by construction", () => {
  assert.equal(buildExaMcpConfig(""), null);
  const config = buildExaMcpConfig("exa_test_key");
  assert.equal(config.type, "http");
  assert.match(config.url, /mcp\.exa\.ai/);
  assert.deepEqual(Object.keys(config.headers), ["x-api-key"]);
  assert.equal(config.headers["x-api-key"], "exa_test_key");
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

test("refresh persists provider result and missing Exa route returns stale cached state", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "ICP.md"), "# ICP\nsolo devs");
    const now = new Date("2026-05-20T00:00:00.000Z");
    const snapshot = await refreshNewsMarketRadar({
      workspaceRoot: root,
      exaApiKey: "exa_test_key",
      force: true,
      now,
      providerResearcher: async () => ({
        lanes: [{
          id: "icp",
          cards: [{
            id: "card-1",
            title: "Paid tool spend",
            summary: "Solo developers pay for coding tools.",
            impact: "strengthens",
            sourceRefs: [
              { url: "https://example.com/pricing", title: "Pricing" },
              { url: "https://other.example/review", title: "Review" },
            ],
          }],
        }],
      }),
    });
    assert.equal(snapshot.status.state, "ready");
    assert.equal(snapshot.status.researchSource, "EXA_API_KEY fallback");
    assert.equal(snapshot.lanes.find((lane) => lane.id === "icp").cards.length, 1);
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
    assert.equal(noKey.status.reason, "exa_mcp_missing");
    assert.equal(noKey.status.stale, true);
    assert.equal(noKey.lanes.find((lane) => lane.id === "icp").cards.length, 1);
  });
});

test("refresh uses provider Exa MCP route without requiring EXA_API_KEY", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "ICP.md"), "# ICP\nsolo devs");
    let observedRoute = null;
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
    });

    assert.equal(observedRoute.exaApiKeyConfigured, false);
    assert.equal(observedRoute.exaMcpConfig.url, "https://mcp.exa.ai/mcp");
    assert.equal(observedRoute.exaResearchRoute.label, "Codex Exa MCP");
    assert.equal(snapshot.status.state, "ready");
    assert.equal(snapshot.status.researchSource, "Codex Exa MCP");
    assert.equal(snapshot.lanes.find((lane) => lane.id === "icp").cards.length, 1);
  });
});

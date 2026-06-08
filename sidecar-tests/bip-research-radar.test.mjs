import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  BIP_RESEARCH_PROMPT_PROFILE,
  buildBipResearchContext,
  buildBipResearchProviderPrompt,
  loadBipResearchSnapshot,
  refreshBipResearch,
  resolveBipResearchCachePath,
} from "../sidecar/bip-research-radar.mjs";
import { appendCurriculumAnswer } from "../sidecar/news-market-radar.mjs";
import { refreshProjectContextCache } from "../sidecar/project-context-cache.mjs";

async function withTmpWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-bip-research-"));
  try {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(path.join(root, "docs", "ICP.md"), "# ICP\nFull-time solo builders using Claude Code on macOS.");
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

function exaRoute() {
  return {
    provider: "codex",
    label: "Codex Exa MCP",
    mcpConfig: {
      type: "http",
      url: "https://mcp.exa.ai/mcp?tools=web_search_advanced_exa,web_fetch_exa",
    },
  };
}

function providerResult({
  id = "candidate-1",
  url = "https://www.threads.net/@builder/post/abc",
  sourceType = "threads",
} = {}) {
  return {
    researchSource: "Codex Exa MCP",
    text: JSON.stringify({
      briefTitle: "Day 1 기준 X/Threads 후보",
      candidates: [
        {
          id,
          title: "Builder — Claude Code BIP 후보",
          sourceLabel: "threads",
          source: "@builder",
          sourceType,
          quote: "Claude Code로 빌드 과정을 공개합니다.",
          whyBody: "macOS agentic coding 워크플로와 맞습니다.",
          usageBody: "DM 후보로 저장합니다.",
          evidenceStrength: "strong",
          sourceRefs: [
            {
              sourceType,
              platform: sourceType,
              title: "Fetched post",
              url,
              domain: new URL(url).hostname,
              excerpt: "Fetched excerpt",
            },
          ],
        },
      ],
    }),
  };
}

test("BIP research stores failed snapshot when Exa route is missing", async () => {
  await withTmpWorkspace(async (root) => {
    let called = false;
    const snapshot = await refreshBipResearch({
      workspaceRoot: root,
      dayNumber: 1,
      exaResearchRoutes: [],
      providerResearcher: async () => {
        called = true;
      },
    });

    assert.equal(called, false);
    assert.equal(snapshot.status.state, "failed");
    assert.equal(snapshot.status.reason, "exa_mcp_missing");
    await fs.stat(resolveBipResearchCachePath(root, 1));
  });
});

test("BIP research context builds adaptive social query seeds from Day and answers", async () => {
  await withTmpWorkspace(async (root) => {
    await appendCurriculumAnswer({
      workspaceRoot: root,
      now: new Date("2026-05-21T00:00:00.000Z"),
      answer: {
        day: 8,
        dimension: "channel",
        questionTitle: "어디서 고객 신호를 봤나요?",
        answerTitle: "디자인 파트너가 LinkedIn DM에 답했다",
        freeformAnswer: "팀 리더는 온보딩 체크리스트 자동화를 찾고 있다",
        occurredAt: "2026-05-21T00:00:00.000Z",
      },
    });
    const context = await buildBipResearchContext({
      workspaceRoot: root,
      dayNumber: 8,
      curriculumDay: { day: 8, title: "MVP를 핵심 기능 1개로 자른다", shortTitle: "MVP 범위" },
    });
    const joined = context.querySeeds.join("\n");

    assert.match(joined, /site:x\.com OR site:twitter\.com/);
    assert.match(joined, /site:threads\.net OR site:threads\.com/);
    assert.match(joined, /site:instagram\.com/);
    assert.match(joined, /MVP 범위|MVP를 핵심 기능 1개로 자른다/);
    assert.match(joined, /LinkedIn DM|온보딩 체크리스트 자동화/);
    assert.doesNotMatch(joined, /Claude Code|Cursor|macOS|빌드인퍼블릭|1인 개발자/);
  });
});

test("BIP research context reads cached project context instead of workspace docs", async () => {
  await withTmpWorkspace(async (root) => {
    await refreshProjectContextCache({
      workspaceRoot: root,
      reason: "workspace_scan",
      onboardingHypothesis: {
        productName: "RevenuePilot",
        projectKind: "web_app",
        targetUser: "한국 B2B SaaS 창업자",
        problem: "첫 세일즈 콜 메시지가 팔리는지 모른다",
        purpose: "상담 예약으로 세일즈 메시지를 검증한다",
        goal: "10개 유료 상담 예약",
        values: "자동화보다 고객 대화 증거를 우선한다",
        evidence: ["src/ProductContext.ts"],
        confidence: "high",
      },
      now: new Date("2026-05-21T00:00:00.000Z"),
    });

    const context = await buildBipResearchContext({
      workspaceRoot: root,
      dayNumber: 8,
      curriculumDay: { day: 8, title: "MVP를 핵심 기능 1개로 자른다", shortTitle: "MVP 범위" },
    });
    const joined = context.querySeeds.join("\n");

    assert.equal(context.projectContextCache, "ready");
    assert.equal(context.projectContext.productName, "RevenuePilot");
    assert.match(joined, /한국 B2B SaaS 창업자/);
    assert.match(joined, /10개 유료 상담 예약/);
    assert.deepEqual(context.workspaceEvidenceRefs.map((item) => item.sourceType), ["project_context_cache"]);
  });
});

test("BIP research provider prompt requires adaptive X Threads Instagram research", async () => {
  await withTmpWorkspace(async (root) => {
    const context = await buildBipResearchContext({
      workspaceRoot: root,
      dayNumber: 8,
      curriculumDay: { day: 8, title: "MVP를 핵심 기능 1개로 자른다" },
    });
    const prompt = buildBipResearchProviderPrompt(context);

    assert.match(prompt, /X\/Twitter, Threads\(Meta\), and Instagram/);
    assert.match(prompt, /Context\.adaptiveProfile/);
    assert.match(prompt, /Do not add fixed customer-type, geography, tool-stack, product-platform/);
    assert.match(prompt, /Context\.querySeeds as the search plan/);
    assert.match(prompt, new RegExp(BIP_RESEARCH_PROMPT_PROFILE));
  });
});

test("BIP research reuses fresh same-day same-context cache when force is false", async () => {
  await withTmpWorkspace(async (root) => {
    let calls = 0;
    const first = await refreshBipResearch({
      workspaceRoot: root,
      dayNumber: 1,
      curriculumDay: { day: 1, title: "Pain", tasks: ["find a pain"] },
      exaResearchRoutes: [exaRoute()],
      providerResearcher: async () => {
        calls += 1;
        return providerResult();
      },
      force: true,
    });
    const second = await refreshBipResearch({
      workspaceRoot: root,
      dayNumber: 1,
      curriculumDay: { day: 1, title: "Pain", tasks: ["find a pain"] },
      exaResearchRoutes: [exaRoute()],
      providerResearcher: async () => {
        calls += 1;
        throw new Error("provider should not be called");
      },
      force: false,
    });

    assert.equal(calls, 1);
    assert.equal(first.status.state, "ready");
    assert.equal(second.status.state, "ready");
    assert.equal(second.candidates.length, 1);
  });
});

test("BIP research keeps day-specific caches", async () => {
  await withTmpWorkspace(async (root) => {
    await refreshBipResearch({
      workspaceRoot: root,
      dayNumber: 1,
      exaResearchRoutes: [exaRoute()],
      providerResearcher: async () => providerResult({ id: "day-1" }),
      force: true,
    });
    await refreshBipResearch({
      workspaceRoot: root,
      dayNumber: 2,
      curriculumDay: { day: 2, title: "Market" },
      exaResearchRoutes: [exaRoute()],
      providerResearcher: async () => providerResult({ id: "day-2", sourceType: "x", url: "https://x.com/builder/status/2" }),
      force: true,
    });

    const day1 = JSON.parse(await fs.readFile(resolveBipResearchCachePath(root, 1), "utf8"));
    const day2 = JSON.parse(await fs.readFile(resolveBipResearchCachePath(root, 2), "utf8"));
    assert.equal(day1.snapshot.dayNumber, 1);
    assert.equal(day2.snapshot.dayNumber, 2);
    assert.notEqual(resolveBipResearchCachePath(root, 1), resolveBipResearchCachePath(root, 2));
  });
});

test("BIP research ranks candidates by adaptive profile relevance", async () => {
  await withTmpWorkspace(async (root) => {
    await refreshProjectContextCache({
      workspaceRoot: root,
      reason: "workspace_scan",
      onboardingHypothesis: {
        productName: "OnboardOps",
        targetUser: "한국 팀 리더",
        problem: "온보딩 체크리스트 자동화가 흩어져 있다",
        purpose: "팀 리더 인터뷰 후보를 찾는다",
        evidence: ["docs/ICP.md"],
        confidence: "high",
      },
      now: new Date("2026-05-21T00:00:00.000Z"),
    });
    const snapshot = await refreshBipResearch({
      workspaceRoot: root,
      dayNumber: 1,
      exaResearchRoutes: [exaRoute()],
      providerResearcher: async () => ({
        text: JSON.stringify({
          candidates: [
            {
              id: "english-x",
              title: "Builder shares a public workflow",
              sourceType: "x",
              quote: "I am sharing a workflow update.",
              whyBody: "Matches the workflow.",
              usageBody: "Save as a DM lead.",
              evidenceStrength: "medium",
              sourceRefs: [{
                sourceType: "x",
                platform: "x",
                title: "X post",
                url: "https://x.com/builder/status/1",
                domain: "x.com",
                excerpt: "Sharing a workflow update.",
              }],
            },
            {
              id: "adaptive-threads",
              title: "한국 팀 리더 — 온보딩 체크리스트 자동화 고민",
              sourceType: "threads",
              quote: "온보딩 체크리스트 자동화를 찾고 있습니다.",
              whyBody: "한국 팀 리더와 온보딩 문제 맥락에 맞습니다.",
              usageBody: "인터뷰 후보로 저장합니다.",
              evidenceStrength: "medium",
              sourceRefs: [{
                sourceType: "threads",
                platform: "threads",
                title: "Threads post",
                url: "https://www.threads.net/@builder/post/kr",
                domain: "threads.net",
                excerpt: "한국 팀 리더가 온보딩 체크리스트 자동화를 찾습니다.",
              }],
            },
          ],
        }),
      }),
      force: true,
    });

    assert.deepEqual(snapshot.candidates.map((candidate) => candidate.id), ["adaptive-threads", "english-x"]);
    assert.equal(snapshot.candidates[0].tags[0].title, "Threads");
  });
});

test("BIP research renders only candidates with X Threads or Instagram URL source refs", async () => {
  await withTmpWorkspace(async (root) => {
    const snapshot = await refreshBipResearch({
      workspaceRoot: root,
      dayNumber: 1,
      exaResearchRoutes: [exaRoute()],
      providerResearcher: async () => ({
        text: JSON.stringify({
          candidates: [
            {
              id: "no-source",
              title: "No source",
              sourceRefs: [],
            },
            {
              id: "generic-web",
              title: "Generic web",
              sourceType: "web",
              sourceRefs: [{ sourceType: "web", title: "Blog", url: "https://example.com/post", domain: "example.com" }],
            },
            {
              id: "threads",
              title: "Threads candidate",
              sourceType: "threads",
              sourceRefs: [{ sourceType: "threads", platform: "threads", title: "Threads", url: "https://www.threads.net/@builder/post/1", domain: "threads.net", excerpt: "Fetched" }],
            },
            {
              id: "instagram",
              title: "Instagram candidate",
              sourceType: "instagram",
              sourceRefs: [{ sourceType: "instagram", platform: "instagram", title: "Instagram", url: "https://www.instagram.com/p/abc123/", domain: "instagram.com", excerpt: "Fetched" }],
            },
          ],
        }),
      }),
      force: true,
    });

    assert.deepEqual(snapshot.candidates.map((candidate) => candidate.id), ["threads", "instagram"]);
    assert.equal(snapshot.candidates.find((candidate) => candidate.id === "instagram").tags[0].title, "Instagram");
  });
});

test("old BIP research prompt profile cache is marked stale when Exa is configured", async () => {
  await withTmpWorkspace(async (root) => {
    await fs.mkdir(path.dirname(resolveBipResearchCachePath(root, 1)), { recursive: true });
    await fs.writeFile(resolveBipResearchCachePath(root, 1), JSON.stringify({
      schemaVersion: 1,
      updatedAt: "2026-05-20T00:00:00.000Z",
      snapshot: {
        schemaVersion: 1,
        promptProfile: "ko_bip_research_v1_x_threads_dynamic",
        contextFingerprint: "old",
        generatedAt: "2026-05-20T00:00:00.000Z",
        nextRefreshAfter: "2026-05-21T00:00:00.000Z",
        dayNumber: 1,
        status: {
          state: "ready",
          lastSuccessAt: "2026-05-20T00:00:00.000Z",
          stale: false,
          reason: "manual",
        },
        candidates: [
          {
            id: "old-profile",
            title: "Old profile candidate",
            sourceType: "threads",
            sourceRefs: [{
              sourceType: "threads",
              platform: "threads",
              title: "Threads",
              url: "https://www.threads.net/@builder/post/old",
              domain: "threads.net",
              excerpt: "Fetched",
            }],
          },
        ],
      },
    }));

    const snapshot = await loadBipResearchSnapshot({
      workspaceRoot: root,
      dayNumber: 1,
      exaConfigured: true,
      exaResearchSource: "Codex Exa MCP",
      now: new Date("2026-05-20T01:00:00.000Z"),
    });

    assert.equal(BIP_RESEARCH_PROMPT_PROFILE, "ko_bip_research_v3_adaptive_social_sources");
    assert.equal(snapshot.status.state, "stale");
    assert.equal(snapshot.status.reason, "prompt_profile_changed");
    assert.equal(snapshot.status.error, null);
  });
});

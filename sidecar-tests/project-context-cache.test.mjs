import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import { appendCurriculumAnswer } from "../sidecar/news-market-radar.mjs";
import {
  formatProjectContextForPrompt,
  loadProjectContextCache,
  PROJECT_CONTEXT_SCHEMA,
  projectContextQuerySeeds,
  refreshProjectContextCache,
  resolveProjectContextCachePath,
} from "../sidecar/project-context-cache.mjs";

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-project-context-"));
  try {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("project context cache is written with compact workspace scan fields", async () => {
  await withTempWorkspace(async (root) => {
    const cache = await refreshProjectContextCache({
      workspaceRoot: root,
      reason: "workspace_scan",
      onboardingHypothesis: {
        productName: "Agentic30",
        projectKind: "mac_app",
        targetUser: "전업 1인 개발자",
        problem: "무엇을 만들어야 팔리는지 모른다",
        purpose: "30일 안에 판매 가능한 실험을 좁힌다",
        goal: "첫 유료 고객 증거",
        values: "근거 없는 자동 확장을 거절한다",
        likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
        stage: "prototype",
        evidence: ["README.md", "src/Onboarding.swift"],
        confidence: "high",
      },
      now: new Date("2026-05-20T00:00:00.000Z"),
    });

    assert.equal(cache.schema, PROJECT_CONTEXT_SCHEMA);
    assert.equal(cache.productName, "Agentic30");
    assert.equal(cache.goal, "첫 유료 고객 증거");
    assert.equal(cache.values, "근거 없는 자동 확장을 거절한다");
    assert.equal(cache.lastRefreshReason, "workspace_scan");
    assert.equal(cache.lastCompletedDay, null);
    assert.ok(cache.sourceFingerprint);

    const persisted = await loadProjectContextCache({ workspaceRoot: root });
    assert.equal(persisted.productName, "Agentic30");
    assert.deepEqual(persisted.evidenceRefs, ["README.md", "src/Onboarding.swift"]);
    await fs.stat(resolveProjectContextCachePath(root));
  });
});

test("project context cache refresh rewrites stale Agentic30 product names", async () => {
  await withTempWorkspace(async (root) => {
    const cachePath = resolveProjectContextCachePath(root);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        schema: PROJECT_CONTEXT_SCHEMA,
        productName: "agentic30 Mac",
        targetUser: "전업 1인 개발자",
        problem: "무엇을 만들어야 팔리는지 모른다",
        evidenceRefs: ["README: agentic30 Mac"],
        confidence: "high",
        updatedAt: "2026-05-19T00:00:00.000Z",
      }),
    );

    const cache = await refreshProjectContextCache({
      workspaceRoot: root,
      reason: "workspace_scan",
      onboardingHypothesis: {
        productName: "agentic30 Mac",
        targetUser: "전업 1인 개발자",
        problem: "무엇을 만들어야 팔리는지 모른다",
        evidence: ["README: agentic30 Mac"],
        confidence: "high",
      },
      now: new Date("2026-05-20T00:00:00.000Z"),
    });

    assert.equal(cache.productName, "Agentic30");
    const persistedRaw = JSON.parse(await fs.readFile(cachePath, "utf8"));
    assert.equal(persistedRaw.productName, "Agentic30");
  });
});

test("day completion refresh updates completed day and answer-log evidence", async () => {
  await withTempWorkspace(async (root) => {
    await refreshProjectContextCache({
      workspaceRoot: root,
      reason: "workspace_scan",
      onboardingHypothesis: {
        productName: "Agentic30",
        targetUser: "전업 1인 개발자",
        problem: "고객 문제를 좁히지 못한다",
        purpose: "판매 가능한 실험을 고른다",
        evidence: ["README.md"],
        confidence: "medium",
      },
      now: new Date("2026-05-20T00:00:00.000Z"),
    });
    await appendCurriculumAnswer({
      workspaceRoot: root,
      now: new Date("2026-05-21T00:00:00.000Z"),
      answer: {
        day: 2,
        dimension: "customer_signal",
        questionId: "pain",
        questionTitle: "어떤 고객 신호를 봤나요?",
        freeformAnswer: "한국 초기 창업자는 월 5만원을 부담스러워함",
        occurredAt: "2026-05-21T00:00:00.000Z",
      },
    });

    const cache = await refreshProjectContextCache({
      workspaceRoot: root,
      reason: "day_completed",
      completedDay: 2,
      onboardingHypothesis: {
        productName: "Agentic30",
        targetUser: "전업 1인 개발자",
        problem: "고객 문제를 좁히지 못한다",
        purpose: "판매 가능한 실험을 고른다",
        evidence: ["docs/ICP.md"],
        confidence: "medium",
      },
      now: new Date("2026-05-21T01:00:00.000Z"),
    });

    assert.equal(cache.lastRefreshReason, "day_completed");
    assert.equal(cache.lastCompletedDay, 2);
    assert.ok(cache.evidenceRefs.some((item) => item.includes("Day 2")));
    assert.ok(cache.evidenceRefs.some((item) => item.includes("한국 초기 창업자")));
  });
});

test("project context prompt and query helpers tolerate missing cache", () => {
  assert.equal(
    formatProjectContextForPrompt(null, { missing: "project context missing" }),
    "project context missing",
  );
  assert.deepEqual(projectContextQuerySeeds(null), []);
});

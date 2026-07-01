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
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
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

test("project context cache refresh preserves source project names", async () => {
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

    assert.equal(cache.productName, "agentic30 Mac");
    const persistedRaw = JSON.parse(await fs.readFile(cachePath, "utf8"));
    assert.equal(persistedRaw.productName, "agentic30 Mac");
  });
});

test("project context cache refresh replaces stale invalid goal with fresh scan docs", async () => {
  await withTempWorkspace(async (root) => {
    const cachePath = resolveProjectContextCachePath(root);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        schema: PROJECT_CONTEXT_SCHEMA,
        productName: "agentic30 Mac",
        targetUser: "전업 1인 개발자, macOS 사용자.",
        problem: "만들 줄은 알지만 무엇을 팔아야 하는지 모른다",
        purpose: "Agentic30은 전업 1인 개발자를 위한 30일 부트캠프다.",
        goal: "120,",
        values: "z.string().min(1),",
        evidenceRefs: ["README: agentic30 Mac"],
        confidence: "high",
        updatedAt: "2026-05-19T00:00:00.000Z",
      }),
    );
    await fs.writeFile(path.join(root, "README.md"), "# agentic30 Mac\n");
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "GOAL.md"),
      "# Agentic30 목표 / 핵심 결과\n\n## 프로젝트 미션\n\nAgentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.\n",
    );
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "ICP.md"),
      "# ICP\n\n## Our ICP: 전업 1인 개발자 (수익 0원, macOS)\n",
    );
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "SPEC.md"),
      "# SPEC\n\n핵심 문제는 “만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다”는 것이다.\n",
    );
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "VALUES.md"),
      "# Values\n\nAgentic30의 가치는 좋은 말이 아니라 제품과 코칭이 매일 지킬 판단 기준이다.\n",
    );
    await fs.writeFile(
      path.join(root, "src", "schema.mjs"),
      "const shape = { goal: 120, values: z.string().min(1) };\n",
    );

    const cache = await refreshProjectContextCache({
      workspaceRoot: root,
      reason: "workspace_scan",
      scanResult: {
        icp: ".agentic30/docs/ICP.md",
        spec: ".agentic30/docs/SPEC.md",
        goal: ".agentic30/docs/GOAL.md",
        values: ".agentic30/docs/VALUES.md",
        docs: "README.md",
      },
      now: new Date("2026-05-20T00:00:00.000Z"),
    });

    assert.match(cache.goal, /사용자 100명|첫 매출/);
    assert.doesNotMatch(cache.goal, /^120,$/);
    assert.doesNotMatch(cache.values, /z\.string|min\(1\)/);
    const persistedRaw = JSON.parse(await fs.readFile(cachePath, "utf8"));
    assert.equal(persistedRaw.goal, cache.goal);
    assert.equal(persistedRaw.values, cache.values);
  });
});

test("project context cache refresh replaces evidence-gap diagnostics with fresh fields", async () => {
  await withTempWorkspace(async (root) => {
    const cachePath = resolveProjectContextCachePath(root);
    await fs.mkdir(path.dirname(cachePath), { recursive: true });
    await fs.writeFile(
      cachePath,
      JSON.stringify({
        schemaVersion: 1,
        schema: PROJECT_CONTEXT_SCHEMA,
        productName: "Agentic30",
        targetUser: "고객 quote 근거 부족",
        problem: "문제 quote 근거 부족",
        purpose: "활성/검증 행동 quote 근거 부족",
        evidenceRefs: [],
        confidence: "high",
        updatedAt: "2026-05-19T00:00:00.000Z",
      }),
    );

    const cache = await refreshProjectContextCache({
      workspaceRoot: root,
      reason: "workspace_scan",
      onboardingHypothesis: {
        productName: "Agentic30",
        targetUser: "전업 1인 개발자",
        problem: "무엇을 팔아야 하는지 모른다",
        purpose: "첫 외부 ICP 인터뷰에서 현재 대안을 확인한다",
        evidence: ["docs/ICP.md", "docs/SPEC.md"],
        confidence: "high",
      },
      now: new Date("2026-05-20T00:00:00.000Z"),
    });

    assert.equal(cache.targetUser, "전업 1인 개발자");
    assert.equal(cache.problem, "무엇을 팔아야 하는지 모른다");
    assert.equal(cache.purpose, "첫 외부 ICP 인터뷰에서 현재 대안을 확인한다");
    assert.doesNotMatch(JSON.stringify(cache), /quote 근거 부족/);
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
        evidence: [".agentic30/docs/ICP.md"],
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

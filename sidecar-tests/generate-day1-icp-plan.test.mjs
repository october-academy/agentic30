import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DAY1_ALIGNMENT_PLAN_SCHEMA_VERSION,
  DAY1_ICP_PLAN_SCHEMA_VERSION,
  composeDay1AlignmentPlan,
  composeDay1IcpPlan,
  generateDay1AlignmentPlan,
  generateDay1IcpPlan,
  normalizeDay1AlignmentPlan,
  normalizeDay1IcpPlan,
} from "../sidecar/generate-day1-icp-plan.mjs";

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-icp-"));
}

async function writeFile(root, relativePath, content) {
  const absolute = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
}

test("Agentic30 fixture produces evidence-based developer ICP questions", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# Agentic30\n\nNative macOS assistant for founders using AI coding agents.");
    await writeFile(root, "docs/ICP.md", "# ICP\n\n전업 1인 개발자, macOS 사용자, Codex와 Claude Code를 매일 쓰며 첫 고객 검증에서 막힌 사람.");
    await writeFile(root, "docs/SPEC.md", "# SPEC\n\nProblem: 만들 수 있지만 무엇을 만들어야 팔리는지 모른다.");
    await writeFile(root, "package.json", JSON.stringify({ name: "agentic30-public", dependencies: { ws: "^8.0.0" } }));

    const plan = await generateDay1IcpPlan({
      workspaceRoot: root,
      scanResult: { icp: "docs/ICP.md", spec: "docs/SPEC.md", docs: "README.md" },
      onboardingHypothesis: {
        productName: "Agentic30",
        projectKind: "mac_app",
        targetUser: "전업 1인 개발자, macOS 사용자",
        problem: "무엇을 만들어야 팔리는지 모른다",
        likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
        confidence: "high",
      },
      localDiscovery: {
        project: { stacks: ["node", "swift"] },
      },
    });

    assert.equal(plan.schemaVersion, DAY1_ICP_PLAN_SCHEMA_VERSION);
    assert.ok(plan.questions.length >= 3 && plan.questions.length <= 5);
    assert.match(plan.mission, /Agentic30/);
    assert.ok(plan.signals.evidenceRefs.some((ref) => ref.path === "docs/ICP.md"));
    assert.ok(JSON.stringify(plan.questions).includes("개발자"));
    assert.ok(plan.icpDraft.evidence.some((line) => line.includes("docs/ICP.md")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Agentic30 fixture produces goal-based Day 1 alignment statement and quality gate", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# Agentic30\n\nNative macOS assistant for founders using AI coding agents.");
    await writeFile(root, "docs/ICP.md", "# ICP\n\n전업 1인 개발자, macOS 사용자, Codex와 Claude Code를 매일 쓰며 첫 고객 검증에서 막힌 사람.");
    await writeFile(root, "docs/GOAL.md", "# GOAL\n\n30일 안에 첫 유료 고객 후보와 검증된 시장 신호를 만든다.");
    await writeFile(root, "docs/SPEC.md", "# SPEC\n\nProblem: 만들 수 있지만 무엇을 만들어야 팔리는지 모른다.");

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { icp: "docs/ICP.md", goal: "docs/GOAL.md", spec: "docs/SPEC.md", docs: "README.md" },
      onboardingHypothesis: {
        productName: "Agentic30",
        projectKind: "mac_app",
        targetUser: "전업 1인 개발자, macOS 사용자",
        problem: "무엇을 만들어야 팔리는지 모른다",
        goal: "30일 안에 첫 유료 고객 후보와 검증된 시장 신호를 만든다",
        likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
        confidence: "high",
      },
      localDiscovery: {
        project: { stacks: ["node", "swift"] },
      },
    });

    assert.equal(plan.schemaVersion, DAY1_ALIGNMENT_PLAN_SCHEMA_VERSION);
    assert.match(plan.projectGoal, /첫 유료 고객 후보/);
    assert.match(plan.alignmentStatement.statement, /ICP:/);
    assert.match(plan.alignmentStatement.statement, /Pain Point:/);
    assert.match(plan.alignmentStatement.statement, /Outcome:/);
    assert.equal(plan.components.icp.title, "ICP");
    assert.equal(plan.components.painPoint.title, "Pain Point");
    assert.equal(plan.components.outcome.title, "Outcome");
    assert.ok(plan.qualityGate.score >= 7, `expected quality score >= 7, got ${plan.qualityGate.score}`);
    assert.equal(plan.qualityGate.passed, true);
    assert.match(plan.qualityGate.passGate, /7\.0\/10/);
    assert.match(plan.day2Handoff.focus, /목표:/);
    assert.match(plan.day2Handoff.nextDayPrompt, /시장|돈|시간/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("non-Agentic30 SaaS fixture avoids Agentic30-specific axes and names", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# SupportLens\n\nB2B SaaS that helps support leads triage customer escalations from Slack and email.");
    await writeFile(root, "docs/SPEC.md", "# SPEC\n\nProblem: support leads miss urgent account-risk escalations.");
    await writeFile(root, "package.json", JSON.stringify({ name: "supportlens", dependencies: { next: "^15.0.0", react: "^19.0.0" } }));

    const plan = await generateDay1IcpPlan({
      workspaceRoot: root,
      scanResult: { spec: "docs/SPEC.md", docs: "README.md" },
      onboardingHypothesis: {
        productName: "SupportLens",
        projectKind: "web_app",
        targetUser: "B2B SaaS support lead",
        problem: "urgent account-risk escalations are missed in Slack and email",
        likelyUsers: ["support lead", "customer success manager"],
        confidence: "medium",
      },
      localDiscovery: {
        project: { stacks: ["node"] },
      },
    });

    const serialized = JSON.stringify(plan);
    assert.doesNotMatch(serialized, /Cursor|Claude Code|macOS 1인 개발자|박주영|joopark/i);
    assert.match(serialized, /Slack|메일|email|support/i);
    assert.ok(plan.questions.some((question) => question.dimension === "bad_fit_boundary"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("weak scan evidence falls back to broad but testable ICP hypothesis questions", async () => {
  const root = await tempWorkspace();
  try {
    const plan = await generateDay1IcpPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "",
        projectKind: "unknown",
        targetUser: "",
        problem: "",
        likelyUsers: [],
        confidence: "low",
      },
      localDiscovery: {
        project: { stacks: [], manifestPaths: [] },
      },
    });

    assert.equal(plan.questions.length, 5);
    assert.deepEqual(
      plan.questions.map((question) => question.dimension),
      ["must_have", "core_need", "current_alternative", "buyer_user", "reference_customer"],
    );
    assert.ok(plan.signals.missingAssumptions.includes("current_icp"));
    assert.ok(plan.signals.missingAssumptions.includes("core_need"));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("LLM malformed JSON, low confidence, and timeout fall back to deterministic plan", async () => {
  const root = await tempWorkspace();
  try {
    const deterministicPlan = await generateDay1IcpPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: { confidence: "low" },
    });

    const malformed = await composeDay1IcpPlan({
      workspaceRoot: root,
      deterministicPlan,
      queryImpl: async () => "{not json",
    });
    assert.equal(malformed.source, "deterministic");
    assert.equal(malformed.fellBackToDeterministic, true);

    const lowConfidence = await composeDay1IcpPlan({
      workspaceRoot: root,
      deterministicPlan,
      queryImpl: async () => JSON.stringify({ ...deterministicPlan, confidence: 0.1 }),
    });
    assert.equal(lowConfidence.source, "deterministic");
    assert.equal(lowConfidence.fellBackToDeterministic, true);

    const timedOut = await composeDay1IcpPlan({
      workspaceRoot: root,
      deterministicPlan,
      timeoutMs: 25,
      queryImpl: async () => new Promise((resolve) => setTimeout(() => resolve(JSON.stringify(deterministicPlan)), 1000)),
    });
    assert.equal(timedOut.source, "deterministic");
    assert.equal(timedOut.fellBackToDeterministic, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment composer falls back to deterministic alignment plan", async () => {
  const root = await tempWorkspace();
  try {
    const deterministicPlan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: { confidence: "low" },
    });

    const malformed = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      queryImpl: async () => "{not json",
    });
    assert.equal(malformed.source, "deterministic");
    assert.equal(malformed.fellBackToDeterministic, true);
    assert.equal(malformed.components.icp.title, "ICP");

    const lowConfidence = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      queryImpl: async () => JSON.stringify({ ...deterministicPlan, confidence: 0.1 }),
    });
    assert.equal(lowConfidence.source, "deterministic");
    assert.equal(lowConfidence.fellBackToDeterministic, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("normalizer rejects fixed-schema invalid plans", () => {
  assert.equal(normalizeDay1IcpPlan(null), null);
  assert.equal(normalizeDay1IcpPlan({ mission: "x", questions: [] }), null);
  assert.equal(normalizeDay1IcpPlan({ mission: "x", signals: {}, questions: [{ dimension: "distance" }] }), null);
  assert.equal(normalizeDay1AlignmentPlan(null), null);
  assert.equal(normalizeDay1AlignmentPlan({ projectGoal: "x", components: {} }), null);
});

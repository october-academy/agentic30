import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  DAY1_ALIGNMENT_PLAN_SCHEMA_VERSION,
  DAY1_ICP_PLAN_SCHEMA_VERSION,
  buildDay1IcpQuestionForDimensionForTesting,
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

const SIGNAL_DIGEST_ROW_ORDER = ["project", "goal", "icp", "pain", "outcome", "evidence"];
const SIGNAL_DIGEST_LIMITS = { project: 90, goal: 120, icp: 90, pain: 80, outcome: 110, evidence: 120 };

function assertConciseSignalDigest(digest) {
  assert.ok(digest);
  assert.equal(digest.schemaVersion, 1);
  assert.deepEqual(digest.rows.map((row) => row.key), SIGNAL_DIGEST_ROW_ORDER);
  assert.ok(digest.summary.length <= 160);
  for (const row of digest.rows) {
    assert.ok(row.value.length <= SIGNAL_DIGEST_LIMITS[row.key], `${row.key} too long: ${row.value.length}`);
  }
}

function assertEvidenceMarkedOptions(options, { allowLimited = false } = {}) {
  assert.ok(options.length >= 2, "expected at least two options");
  for (const option of options) {
    assert.ok(option.evidenceLabel, `missing evidenceLabel for ${option.label}`);
    if (option.evidenceLabel === "근거 부족") {
      assert.equal(option.evidenceLimited, true, `evidence-limited option must be marked: ${option.label}`);
      assert.match(option.description, /근거 부족/);
      assert.ok(allowLimited, `unexpected evidence-limited option: ${option.label}`);
    } else {
      assert.match(option.description, /근거:/, `description should display evidence for ${option.label}`);
      assert.notEqual(option.evidenceLimited, true, `evidence-backed option should not be limited: ${option.label}`);
    }
  }
}

test("Agentic30 fixture produces evidence-based developer ICP questions", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# agentic30 Mac\n\nNative macOS assistant for founders using AI coding agents.");
    await writeFile(root, "docs/ICP.md", "# ICP\n\n전업 1인 개발자, macOS 사용자, Codex와 Claude Code를 매일 쓰며 첫 고객 검증에서 막힌 사람.");
    await writeFile(root, "docs/SPEC.md", "# SPEC\n\nProblem: 만들 수 있지만 무엇을 만들어야 팔리는지 모른다.");
    await writeFile(root, "package.json", JSON.stringify({ name: "agentic30-public", dependencies: { ws: "^8.0.0" } }));

    const plan = await generateDay1IcpPlan({
      workspaceRoot: root,
      scanResult: { icp: "docs/ICP.md", spec: "docs/SPEC.md", docs: "README.md" },
      onboardingHypothesis: {
        productName: "agentic30 Mac",
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
    assert.equal(plan.signals.productName, "Agentic30");
    assert.ok(plan.questions.length >= 3 && plan.questions.length <= 5);
    assert.match(plan.mission, /Agentic30/);
    assert.ok(plan.signals.evidenceRefs.some((ref) => ref.path === "docs/ICP.md"));
    assert.ok(JSON.stringify(plan.questions).includes("개발자"));
    assert.ok(plan.icpDraft.evidence.some((line) => line.includes("docs/ICP.md")));
    for (const question of plan.questions) {
      assertEvidenceMarkedOptions(question.options, { allowLimited: true });
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Agentic30 fixture produces goal-based Day 1 alignment statement and quality gate", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# agentic30 Mac\n\nNative macOS assistant for founders using AI coding agents.");
    await writeFile(root, "docs/ICP.md", "# ICP\n\n전업 1인 개발자, macOS 사용자, Codex와 Claude Code를 매일 쓰며 첫 고객 검증에서 막힌 사람.");
    await writeFile(root, "docs/GOAL.md", "# GOAL\n\n30일 안에 첫 유료 고객 후보와 검증된 시장 신호를 만든다.");
    await writeFile(root, "docs/SPEC.md", "# SPEC\n\nProblem: 만들 수 있지만 무엇을 만들어야 팔리는지 모른다.");

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { icp: "docs/ICP.md", goal: "docs/GOAL.md", spec: "docs/SPEC.md", docs: "README.md" },
      onboardingHypothesis: {
        productName: "agentic30 Mac",
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
    assert.equal(plan.signals.productName, "Agentic30");
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
    assertConciseSignalDigest(plan.signalDigest);
    assert.equal(plan.signalDigest.rows[0].value, "Agentic30");
    assert.doesNotMatch(plan.signalDigest.rows[0].value, /Mac/);
    assert.doesNotMatch(plan.signalDigest.rows[0].value, /quality/i);
    assertEvidenceMarkedOptions(plan.components.icp.options);
    assertEvidenceMarkedOptions(plan.components.painPoint.options, { allowLimited: true });
    assertEvidenceMarkedOptions(plan.components.outcome.options, { allowLimited: true });
    const outcomeLabels = plan.components.outcome.options.map((option) => option.label).join("\n");
    assert.doesNotMatch(outcomeLabels, /부트캠프|100명과 첫 매출 달성|\.md|로 이어지는 첫 검증 행동|검증로|한다\.로|모른다을/);
    assert.notEqual(plan.components.outcome.options[0].label, plan.components.painPoint.statement);
    assert.match(outcomeLabels, /검증|확인|판단|시장|대화|행동|신호/);
    assert.doesNotMatch(plan.components.icp.options.map((option) => option.label).join("\n"), /GitHub\/IDE\/CLI/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Agentic30 public docs produce customer-outcome choices instead of business-goal copies", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# agentic30 Mac\n\nProduct context for adaptive curriculum.");
    await writeFile(
      root,
      "docs/ICP.md",
      [
        "# Ideal Customer Profile",
        "",
        "## Our ICP: 전업 1인 개발자 (수익 0원, macOS)",
        "",
        "### 설명",
        "퇴사 후 전업했지만 수익은 0원이다. 제품은 만들 수 있으나 무엇을 팔아야 할지, 누구에게 팔아야 할지, 어떻게 첫 사용자를 데려올지 막혀 있다.",
      ].join("\n"),
    );
    await writeFile(
      root,
      "docs/GOAL.md",
      "# Agentic30 목표\n\nAgentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.\n",
    );
    await writeFile(
      root,
      "docs/SPEC.md",
      "# Agentic30 Product Spec\n\n핵심 문제는 “만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다”는 것이다.\n",
    );

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { icp: "docs/ICP.md", goal: "docs/GOAL.md", spec: "docs/SPEC.md", docs: "README.md" },
      onboardingHypothesis: {
        productName: "agentic30 Mac",
        projectKind: "mac_app",
        targetUser: "전업 1인 개발자 (수익 0원, macOS)",
        problem: "무엇을 팔아야 할지, 누구에게 팔아야 할지, 어떻게 첫 사용자를 데려올지 막혀 있다",
        purpose: "Agentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.",
        likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
        confidence: "high",
      },
    });

    const labels = plan.components.outcome.options.map((option) => option.label);
    const serialized = labels.join("\n");
    assert.doesNotMatch(serialized, /부트캠프|100명과 첫 매출 달성|\.md|로 이어지는 첫 검증 행동|검증로|한다\.로|모른다을/);
    assert.ok(labels.every((label) => label !== plan.components.painPoint.statement));
    assert.ok(labels.some((label) => /검증|확인|판단|시장|대화|행동|신호/.test(label)), serialized);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment digest hides ephemeral workspace basename when evidence is missing", async () => {
  const root = path.join(
    os.tmpdir(),
    "agentic30-ui-opendesign-day-handoff-7BC22624-F1F9-4569-B4EB-884798290B65",
  );
  await fs.rm(root, { recursive: true, force: true });
  await fs.mkdir(root, { recursive: true });
  try {
    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: { confidence: "low" },
      localDiscovery: { project: { stacks: [], manifestPaths: [] } },
    });

    assertConciseSignalDigest(plan.signalDigest);
    const rows = Object.fromEntries(plan.signalDigest.rows.map((row) => [row.key, row.value]));
    assert.equal(rows.project, "이 프로젝트");
    assert.equal(rows.pain, "핵심 통증 확인 필요");
    assert.doesNotMatch(JSON.stringify(plan.signalDigest), /agentic30-ui-opendesign-day-handoff/i);
    assert.doesNotMatch(JSON.stringify(plan.signalDigest), /scan에서 확인한 핵심 문제/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment composer accepts zod-validated concise SDK signal digest", async () => {
  const root = await tempWorkspace();
  try {
    const deterministicPlan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "SupportLens",
        targetUser: "B2B SaaS support lead",
        problem: "Slack escalation 누락",
        goal: "유료 support lead 후보 1명을 검증한다",
        confidence: "high",
      },
    });
    const sdkPlan = {
      ...deterministicPlan,
      confidence: 0.82,
      signalDigest: {
        schemaVersion: 1,
        rows: [
          { key: "project", label: "프로젝트", value: "SupportLens · quality 8.4/10", tone: "strong" },
          { key: "goal", label: "목표", value: "유료 support lead 후보 1명을 검증한다", tone: "body" },
          { key: "icp", label: "ICP", value: "B2B SaaS support lead", tone: "body" },
          { key: "pain", label: "Pain", value: "Slack escalation 누락", tone: "mark" },
          { key: "outcome", label: "Outcome", value: "계정 리스크를 더 빨리 판단한다", tone: "strong" },
          { key: "evidence", label: "근거", value: "docs/GOAL.md, docs/ICP.md", tone: "code" },
        ],
        summary: "SupportLens는 support lead의 Slack escalation 누락을 Day 2에서 검증한다.",
      },
    };

    const plan = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      queryImpl: async () => JSON.stringify(sdkPlan),
    });

    assert.equal(plan.source, "llm");
    assert.equal(plan.fellBackToDeterministic, false);
    assertConciseSignalDigest(plan.signalDigest);
    assert.equal(plan.signalDigest.rows[0].value, "SupportLens");
    assert.equal(plan.signalDigest.rows[1].value, "유료 support lead 후보 1명을 검증한다");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment normalizer canonicalizes stale Agentic30 signal digest project row", async () => {
  const root = await tempWorkspace();
  try {
    const deterministicPlan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "agentic30 Mac",
        targetUser: "전업 1인 개발자",
        problem: "무엇을 만들어야 팔리는지 모른다",
        goal: "첫 유료 고객 후보를 검증한다",
        confidence: "high",
      },
    });

    const normalized = normalizeDay1AlignmentPlan({
      ...deterministicPlan,
      signalDigest: {
        ...deterministicPlan.signalDigest,
        rows: deterministicPlan.signalDigest.rows.map((row) =>
          row.key === "project" ? { ...row, value: "agentic30 Mac · quality 8.1/10" } : row
        ),
      },
    });

    assert.equal(normalized.signals.productName, "Agentic30");
    assert.equal(normalized.signalDigest.rows[0].value, "Agentic30");
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

test("all Day 1 question dimensions build evidence-marked choices", () => {
  const signals = {
    productName: "SupportLens",
    currentIcpGuess: "B2B SaaS support lead",
    likelyUsers: ["customer success manager", "support operations lead"],
    problem: "urgent account-risk escalations are missed in Slack and email",
    currentAlternatives: ["Slack/메일 thread를 사람이 직접 확인"],
    evidenceRefs: [
      { path: "README.md", reason: "README", quote: "# SupportLens" },
      { path: "docs/ICP.md", reason: "icp document", quote: "B2B SaaS support lead" },
      { path: "docs/SPEC.md", reason: "spec document", quote: "Problem: urgent account-risk escalations are missed in Slack and email" },
      { path: "docs/GOAL.md", reason: "goal document", quote: "유료 support lead 후보 1명을 검증한다" },
    ],
    missingAssumptions: [],
    confidence: "high",
  };

  for (const dimension of [
    "must_have",
    "core_need",
    "current_alternative",
    "buyer_user",
    "activation_or_success_signal",
    "willingness_to_pay",
    "bad_fit_boundary",
    "reference_customer",
  ]) {
    const question = buildDay1IcpQuestionForDimensionForTesting(dimension, signals);
    assert.equal(question.dimension, dimension);
    assertEvidenceMarkedOptions(question.options, { allowLimited: true });
    if (dimension !== "bad_fit_boundary") {
      assert.ok(
        question.options.some((option) => option.evidenceLabel !== "근거 부족"),
        `${dimension} should include at least one scan-backed option`,
      );
    }
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
    for (const question of plan.questions) {
      assertEvidenceMarkedOptions(question.options, { allowLimited: true });
      assert.ok(
        question.options.some((option) => option.evidenceLabel === "근거 부족"),
        `${question.dimension} should expose evidence-limited fallback options`,
      );
    }
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
    assertConciseSignalDigest(lowConfidence.signalDigest);

    const missingDigest = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      queryImpl: async () => JSON.stringify({ ...deterministicPlan, signalDigest: undefined }),
    });
    assert.equal(missingDigest.source, "deterministic");
    assert.equal(missingDigest.fellBackToDeterministic, true);

    const overlongDigest = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      queryImpl: async () => JSON.stringify({
        ...deterministicPlan,
        confidence: 0.82,
        signalDigest: {
          ...deterministicPlan.signalDigest,
          rows: deterministicPlan.signalDigest.rows.map((row) =>
            row.key === "goal" ? { ...row, value: "x".repeat(121) } : row
          ),
        },
      }),
    });
    assert.equal(overlongDigest.source, "deterministic");
    assert.equal(overlongDigest.fellBackToDeterministic, true);

    const misalignedOptions = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      queryImpl: async () => JSON.stringify({
        ...deterministicPlan,
        confidence: 0.82,
        components: {
          ...deterministicPlan.components,
          outcome: {
            ...deterministicPlan.components.outcome,
            options: [
              {
                id: "bad_goal_copy",
                label: "30일 안에 사용자 100명과 첫 매출 달성",
                description: "사업 목표를 그대로 복사함 · 근거: docs/GOAL.md",
                preview: "Outcome",
                antiSignal: false,
                evidenceLabel: "근거: docs/GOAL.md",
                evidenceLimited: false,
              },
              {
                id: "bad_feature",
                label: "기능 추가",
                description: "고객 결과가 아니라 제품 기능입니다.",
                preview: "Outcome",
                antiSignal: false,
                evidenceLabel: "근거: docs/SPEC.md",
                evidenceLimited: false,
              },
            ],
          },
        },
      }),
    });
    assert.equal(misalignedOptions.source, "deterministic");
    assert.equal(misalignedOptions.fellBackToDeterministic, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment signal digest prefers canonical docs over duplicate README evidence", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# SupportLens\n\nRoot readme.");
    await writeFile(root, "readme.md", "# Duplicate SupportLens\n\nLowercase duplicate.");
    await writeFile(root, "docs/GOAL.md", "# GOAL\n\n검증된 첫 매출 후보를 만든다.");
    await writeFile(root, "docs/ICP.md", "# ICP\n\nB2B SaaS support lead.");
    await writeFile(root, "docs/SPEC.md", "# SPEC\n\nProblem: Slack escalation 누락.");

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { goal: "docs/GOAL.md", icp: "docs/ICP.md", spec: "docs/SPEC.md", docs: "README.md" },
      onboardingHypothesis: {
        productName: "SupportLens",
        targetUser: "B2B SaaS support lead",
        problem: "Slack escalation 누락",
        goal: "검증된 첫 매출 후보를 만든다",
        confidence: "high",
      },
    });

    assertConciseSignalDigest(plan.signalDigest);
    const evidence = plan.signalDigest.rows.find((row) => row.key === "evidence");
    assert.equal(evidence.value, "docs/GOAL.md, docs/ICP.md, docs/SPEC.md");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment signal digest rejects markdown document links outside evidence row", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# agentic30 Mac\n\nNative macOS assistant.");
    await writeFile(root, "docs/GOAL.md", "# GOAL\n\n첫 유료 고객 후보를 검증한다.");
    await writeFile(root, "docs/ICP.md", "# ICP\n\n전업 1인 개발자.");
    await writeFile(root, "docs/SPEC.md", "# SPEC\n\nProblem: 무엇을 만들어야 팔리는지 모른다.");

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { goal: "docs/GOAL.md", icp: "docs/ICP.md", spec: "docs/SPEC.md", docs: "README.md" },
      onboardingHypothesis: {
        productName: "agentic30 Mac",
        targetUser: "[전업 1인 개발자](./VALUES.md) — 제품 가치",
        problem: "무엇을 만들어야 팔리는지 모른다",
        goal: "첫 유료 고객 후보를 검증한다",
        likelyUsers: ["전업 1인 개발자"],
        confidence: "high",
      },
    });

    const rows = Object.fromEntries(plan.signalDigest.rows.map((row) => [row.key, row.value]));
    assert.doesNotMatch(rows.icp, /\[[^\]]*\.md[^\]]*\]\([^)]+\)|VALUES\.md/);
    assert.match(rows.icp, /전업 1인 개발자|첫 고객 후보/);
    assert.match(rows.evidence, /docs\/GOAL\.md/);
    assert.match(rows.evidence, /docs\/ICP\.md/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment normalizer sanitizes markdown document links in statement fields", () => {
  const documentPointer = "[VALUES.md](./VALUES.md) — 제품 가치";
  const plan = normalizeDay1AlignmentPlan({
    schemaVersion: 1,
    source: "llm",
    generatedAt: "2026-05-20T00:00:00.000Z",
    confidence: 0.82,
    projectGoal: "30일 안에 사용자 100명과 첫 매출 가능성을 검증한다",
    mission: "Goal, ICP, Pain Point, Outcome을 정렬합니다.",
    signals: {
      productName: "agentic30 Mac",
      currentIcpGuess: "AI 코딩 도구를 쓰는 개발자",
      likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
      problem: "무엇을 팔아야 할지 모른다",
      currentAlternatives: ["수동 인터뷰"],
      evidenceRefs: [{ path: "docs/ICP.md", reason: "ICP", quote: "개발자" }],
      missingAssumptions: [],
      confidence: "high",
    },
    components: {
      icp: {
        id: "icp",
        title: "ICP",
        prompt: "먼저 검증할 고객은?",
        statement: documentPointer,
        evidence: ["docs/ICP.md"],
        missingAssumptions: [],
        options: [
          { id: "o1", label: "AI 코딩 도구를 쓰는 개발자", description: "근거 있음", preview: "ICP" },
          { id: "o2", label: "이번 주 테스트를 결정할 수 있는 개발자", description: "결정권 있음", preview: "ICP" },
        ],
      },
      painPoint: {
        id: "pain_point",
        title: "Pain Point",
        prompt: "압축된 통증은?",
        statement: "무엇을 팔아야 할지 모른다",
        evidence: ["docs/SPEC.md"],
        missingAssumptions: [],
        options: [
          { id: "o1", label: "무엇을 팔아야 할지 모름", description: "반복됨", preview: "Pain" },
          { id: "o2", label: "오늘 무엇을 검증할지 모름", description: "행동 지연", preview: "Pain" },
        ],
      },
      outcome: {
        id: "outcome",
        title: "Outcome",
        prompt: "고객 결과는?",
        statement: "첫 대화에서 지불 의향과 현재 대안을 확인한다",
        evidence: ["docs/GOAL.md"],
        missingAssumptions: [],
        options: [
          { id: "o1", label: "첫 대화에서 지불 의향과 대안을 확인한다", description: "결과", preview: "Outcome" },
          { id: "o2", label: "시장 신호로 첫 사용자 획득 행동을 확인한다", description: "결과", preview: "Outcome" },
        ],
      },
    },
    alignmentStatement: {
      statement: `목표: 30일 안에 사용자 100명과 첫 매출 가능성을 검증한다 / ICP: ${documentPointer} / Pain Point: 무엇을 팔아야 할지 모른다 / Outcome: 첫 대화에서 지불 의향과 현재 대안을 확인한다`,
      projectGoal: "30일 안에 사용자 100명과 첫 매출 가능성을 검증한다",
      icp: documentPointer,
      painPoint: "무엇을 팔아야 할지 모른다",
      outcome: "첫 대화에서 지불 의향과 현재 대안을 확인한다",
    },
    qualityGate: {
      score: 8.2,
      threshold: 7,
      passed: true,
      label: "PASS",
      passGate: "핵심 가설이 충분합니다.",
      failGate: "핵심 가설이 부족합니다.",
      criteria: [
        { id: "project_goal", label: "Project goal", score: 2, maxScore: 2, passed: true, detail: "명확함" },
        { id: "icp", label: "ICP", score: 2, maxScore: 2, passed: true, detail: documentPointer },
      ],
    },
    firstInterviewMessage: {
      channel: "DM/email/Slack",
      recipientPlaceholder: "{name}",
      subject: "핵심 가설 인터뷰",
      bodyTemplate: "안녕하세요 {name}님",
      questions: ["최근 사건?"],
    },
    day2Handoff: {
      title: "Day 2 시장 신호",
      body: "시장 신호를 확인합니다.",
      focus: "지불 의향과 현재 대안",
      nextDayPrompt: "유료 대체재를 확인한다.",
      qualityGateLabel: "PASS 8.2/10",
    },
  });

  assert.ok(plan);
  assert.equal(plan.components.icp.statement, "AI 코딩 도구를 쓰는 개발자");
  assert.equal(plan.alignmentStatement.icp, "AI 코딩 도구를 쓰는 개발자");
  assert.doesNotMatch(plan.alignmentStatement.statement, /\[[^\]]*\.md[^\]]*\]\([^)]+\)|ALIGNMENT\.md/);
});

test("normalizer rejects fixed-schema invalid plans", () => {
  assert.equal(normalizeDay1IcpPlan(null), null);
  assert.equal(normalizeDay1IcpPlan({ mission: "x", questions: [] }), null);
  assert.equal(normalizeDay1IcpPlan({ mission: "x", signals: {}, questions: [{ dimension: "distance" }] }), null);
  assert.equal(normalizeDay1AlignmentPlan(null), null);
  assert.equal(normalizeDay1AlignmentPlan({ projectGoal: "x", components: {} }), null);
});

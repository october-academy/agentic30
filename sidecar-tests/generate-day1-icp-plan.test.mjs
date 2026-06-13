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
  normalizeEmphasis,
} from "../sidecar/generate-day1-icp-plan.mjs";
import { deriveWorkspaceOnboardingHypothesisLocally } from "../sidecar/onboarding-hypothesis.mjs";

async function tempWorkspace() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-day1-icp-"));
}

async function writeFile(root, relativePath, content) {
  const absolute = path.join(root, relativePath);
  await fs.mkdir(path.dirname(absolute), { recursive: true });
  await fs.writeFile(absolute, content);
}

const SIGNAL_DIGEST_ROW_ORDER = ["project", "goal", "icp", "pain", "outcome", "evidence"];
const SIGNAL_DIGEST_LABELS = ["프로젝트", "목표", "고객", "문제", "확인할 행동", "근거"];
const SIGNAL_DIGEST_LIMITS = { project: 90, goal: 120, icp: 90, pain: 180, outcome: 110, evidence: 120 };

function assertConciseSignalDigest(digest) {
  assert.ok(digest);
  assert.equal(digest.schemaVersion, 1);
  assert.deepEqual(digest.rows.map((row) => row.key), SIGNAL_DIGEST_ROW_ORDER);
  assert.deepEqual(digest.rows.map((row) => row.label), SIGNAL_DIGEST_LABELS);
  assert.ok(digest.summary.length <= 160);
  for (const row of digest.rows) {
    assert.ok(row.value.length <= SIGNAL_DIGEST_LIMITS[row.key], `${row.key} too long: ${row.value.length}`);
  }
}

function assertNoDanglingOpeningDelimiter(value) {
  const stack = [];
  const pairs = new Map([
    ["(", ")"],
    ["[", "]"],
    ["{", "}"],
    ["（", "）"],
    ["［", "］"],
    ["｛", "｝"],
  ]);
  const openerForCloser = new Map([...pairs.entries()].map(([open, close]) => [close, open]));
  for (const char of String(value || "")) {
    const expectedClose = pairs.get(char);
    if (expectedClose) {
      stack.push(char);
      continue;
    }
    const expectedOpen = openerForCloser.get(char);
    if (!expectedOpen) continue;
    assert.equal(stack[stack.length - 1], expectedOpen, `unbalanced delimiter in ${value}`);
    stack.pop();
  }
  assert.equal(stack.length, 0, `unbalanced delimiter in ${value}`);
}

function assertEvidenceMarkedOptions(options, { allowLimited = false, requireEvidenceInDescription = true } = {}) {
  assert.ok(options.length >= 2, "expected at least two options");
  for (const option of options) {
    assert.ok(option.evidenceLabel, `missing evidenceLabel for ${option.label}`);
    assert.ok(Array.isArray(option.highlightPhrases), `missing highlightPhrases for ${option.label}`);
    assert.ok(option.highlightPhrases.length >= 1, `empty highlightPhrases for ${option.label}`);
    if (option.evidenceLabel === "근거 부족") {
      assert.equal(option.evidenceLimited, true, `evidence-limited option must be marked: ${option.label}`);
      assert.match(option.description, /근거 부족/);
      assert.ok(allowLimited, `unexpected evidence-limited option: ${option.label}`);
    } else {
      if (requireEvidenceInDescription) {
        assert.match(option.description, /근거:/, `description should display evidence for ${option.label}`);
      }
      assert.notEqual(option.evidenceLimited, true, `evidence-backed option should not be limited: ${option.label}`);
    }
  }
}

function outcomeValidationFamilyForTest(label) {
  const text = String(label || "").toLowerCase();
  if (/(첫\s*사용자|사용자\s*획득|획득|데려오|소개|추천|채널|유입|acquisition|referral|channel)/i.test(text)) {
    return "acquisition_channel";
  }
  if (/(지불|결제|유료|매출|가격|돈|willingness|paid|pricing|revenue)/i.test(text)) {
    return "payment";
  }
  if (/(최근\s*사건|사건|고객\s*대화|대화|인터뷰|반응|피드백|conversation|interview|feedback)/i.test(text)) {
    return "incident_conversation";
  }
  if (/(도입|결정|승인|구매|계약|예산|pilot|파일럿|decision|adoption)/i.test(text)) {
    return "adoption_decision";
  }
  if (/(현재\s*대안|대안|수동|workflow|워크플로|alternative)/i.test(text)) {
    return "alternative";
  }
  if (/(리스크|위험|sla|판단|우선순위|risk)/i.test(text)) {
    return "risk_judgement";
  }
  if (/(무엇을\s*(?:팔|만들)|누구에게\s*팔|오늘\s*무엇|검증할\s*행동)/i.test(text)) {
    return "what_to_sell";
  }
  return "other";
}

function assertOutcomeValidationDiversity(options, { minFamilies = 3 } = {}) {
  const labels = options
    .filter((option) => option.evidenceLimited !== true && !String(option.label || "").startsWith("직접 입력"))
    .map((option) => option.label);
  const families = new Set(labels.map(outcomeValidationFamilyForTest));
  assert.ok(
    families.size >= minFamilies,
    `expected at least ${minFamilies} outcome validation families, got ${[...families].join(", ")} from ${labels.join(" / ")}`,
  );
}

function frontierOption(id, label, description, preview, evidenceLabel, {
  antiSignal = false,
  evidenceLimited = false,
} = {}) {
  return {
    id,
    label,
    description,
    highlightPhrases: [label],
    preview,
    antiSignal,
    evidenceLabel,
    evidenceLimited,
  };
}

function makeFrontierAlignmentPlan(deterministicPlan, suffix = "A") {
  return {
    ...deterministicPlan,
    source: "frontier",
    confidence: 0.91,
    components: {
      ...deterministicPlan.components,
      icp: {
        ...deterministicPlan.components.icp,
        options: [
          frontierOption(`icp_${suffix}_1`, `B2B SaaS support lead ${suffix}`, "이번 주 Slack escalation 문제를 직접 설명할 고객입니다. · 근거: .agentic30/docs/ICP.md", "고객", "근거: .agentic30/docs/ICP.md"),
          frontierOption(`icp_${suffix}_2`, `고객 성공팀 리드 ${suffix}`, "SLA 리스크를 팀 지표로 관리하는 고객입니다. · 근거: .agentic30/docs/SPEC.md", "고객", "근거: .agentic30/docs/SPEC.md"),
          frontierOption(`icp_${suffix}_3`, `온콜 운영 담당자 ${suffix}`, "반복 알림 누락 비용을 바로 말할 수 있는 사용자입니다. · 근거: README.md", "고객", "근거: README.md"),
          frontierOption(`icp_${suffix}_4`, `초기 B2B SaaS 운영자 ${suffix}`, "작은 팀에서 support workflow를 직접 고치는 고객입니다. · 근거: .agentic30/docs/GOAL.md", "고객", "근거: .agentic30/docs/GOAL.md"),
          frontierOption(`icp_${suffix}_5`, `관심만 있는 구경 고객 ${suffix}`, "최근 사건과 예산 신호가 없어 제외 후보입니다.", "Weak", "근거 부족", { antiSignal: true, evidenceLimited: true }),
        ],
      },
      painPoint: {
        ...deterministicPlan.components.painPoint,
        options: [
          frontierOption(`pain_${suffix}_1`, `Slack escalation 누락으로 SLA 리스크가 커짐 ${suffix}`, "반복 누락이 고객 계정 리스크로 이어집니다. · 근거: .agentic30/docs/SPEC.md", "문제", "근거: .agentic30/docs/SPEC.md"),
          frontierOption(`pain_${suffix}_2`, `담당자가 수동 확인에 시간을 씀 ${suffix}`, "현재 대안의 시간 비용을 바로 확인할 수 있습니다. · 근거: README.md", "문제", "근거: README.md"),
          frontierOption(`pain_${suffix}_3`, `계정 위험 신호를 늦게 발견함 ${suffix}`, "조기 판단 실패가 비용 신호로 연결됩니다. · 근거: .agentic30/docs/GOAL.md", "문제", "근거: .agentic30/docs/GOAL.md"),
          frontierOption(`pain_${suffix}_4`, `지원 요청 우선순위가 매번 흔들림 ${suffix}`, "반복 운영 마찰을 최근 사건으로 물을 수 있습니다. · 근거: .agentic30/docs/ICP.md", "문제", "근거: .agentic30/docs/ICP.md"),
          frontierOption(`pain_${suffix}_5`, `불편하지만 현재 대안 비용이 없음 ${suffix}`, "돈이나 시간을 이미 쓰는 대안이 없어 제외 후보입니다.", "Weak", "근거 부족", { antiSignal: true, evidenceLimited: true }),
        ],
      },
      outcome: {
        ...deterministicPlan.components.outcome,
        options: [
          frontierOption(`outcome_${suffix}_1`, `최근 누락 사건과 현재 대안을 고객 대화에서 확인한다 ${suffix}`, "실제 사건과 대안을 같이 확인하는 행동 신호입니다. · 근거: .agentic30/docs/SPEC.md", "확인할 행동", "근거: .agentic30/docs/SPEC.md"),
          frontierOption(`outcome_${suffix}_2`, `SLA 리스크 판단을 위해 지불 의향을 묻는다 ${suffix}`, "돈을 낼 문제인지 확인하는 시장 신호입니다. · 근거: .agentic30/docs/GOAL.md", "확인할 행동", "근거: .agentic30/docs/GOAL.md"),
          frontierOption(`outcome_${suffix}_3`, `수동 확인 workflow를 보여달라고 요청한다 ${suffix}`, "현재 대안과 반복 행동을 관찰합니다. · 근거: README.md", "확인할 행동", "근거: README.md"),
          frontierOption(`outcome_${suffix}_4`, `계정 위험 알림 도입 결정을 누가 하는지 확인한다 ${suffix}`, "구매자와 사용자를 분리해 다음 검증으로 넘깁니다. · 근거: .agentic30/docs/ICP.md", "확인할 행동", "근거: .agentic30/docs/ICP.md"),
          frontierOption(`outcome_${suffix}_5`, `지불 의향 신호가 없으면 보류한다 ${suffix}`, "시장 신호가 약한 경우의 제외 기준입니다.", "Weak", "근거 부족", { evidenceLimited: true }),
        ],
      },
    },
  };
}

test("Agentic30 fixture produces evidence-based developer ICP questions", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# agentic30 Mac\n\nNative macOS assistant for founders using AI coding agents.");
    await writeFile(root, ".agentic30/docs/ICP.md", "# ICP\n\n전업 1인 개발자, macOS 사용자, Codex와 Claude Code를 매일 쓰며 첫 고객 검증에서 막힌 사람.");
    await writeFile(root, ".agentic30/docs/SPEC.md", "# SPEC\n\nProblem: 만들 수 있지만 무엇을 만들어야 팔리는지 모른다.");
    await writeFile(root, "package.json", JSON.stringify({ name: "agentic30-public", dependencies: { ws: "^8.0.0" } }));

    const plan = await generateDay1IcpPlan({
      workspaceRoot: root,
      scanResult: { icp: ".agentic30/docs/ICP.md", spec: ".agentic30/docs/SPEC.md", docs: "README.md" },
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
    assert.equal(plan.signals.productName, "agentic30 Mac");
    assert.ok(plan.questions.length >= 3 && plan.questions.length <= 5);
    assert.match(plan.mission, /agentic30 Mac/);
    assert.ok(plan.signals.evidenceRefs.some((ref) => ref.path === ".agentic30/docs/ICP.md"));
    assert.ok(JSON.stringify(plan.questions).includes("개발자"));
    assert.ok(plan.icpDraft.evidence.some((line) => line.includes(".agentic30/docs/ICP.md")));
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
    await writeFile(root, ".agentic30/docs/ICP.md", "# ICP\n\n전업 1인 개발자, macOS 사용자, Codex와 Claude Code를 매일 쓰며 첫 고객 검증에서 막힌 사람.");
    await writeFile(root, ".agentic30/docs/GOAL.md", "# GOAL\n\n30일 안에 첫 유료 고객 후보와 검증된 시장 신호를 만든다.");
    await writeFile(root, ".agentic30/docs/SPEC.md", "# SPEC\n\nProblem: 만들 수 있지만 무엇을 만들어야 팔리는지 모른다.");

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { icp: ".agentic30/docs/ICP.md", goal: ".agentic30/docs/GOAL.md", spec: ".agentic30/docs/SPEC.md", docs: "README.md" },
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
    assert.equal(plan.signals.productName, "agentic30 Mac");
    assert.match(plan.projectGoal, /첫 유료 고객 후보/);
    assert.equal(plan.mission, "Day 1 — 만들기 전에, 팔릴 문제를 고릅니다.\n오늘은 코딩하지 않습니다.\n30일 동안 검증할 고객, 문제, 첫 결제 이유를 한 문장으로 정합니다.");
    assert.match(plan.alignmentStatement.statement, /고객:/);
    assert.match(plan.alignmentStatement.statement, /문제:/);
    assert.match(plan.alignmentStatement.statement, /확인할 행동:/);
    assert.equal(plan.components.icp.title, "고객");
    assert.equal(plan.components.icp.prompt, "이 목표를 검증하려면 이번 주 가장 먼저 확인할 고객 후보는 누구인가요?");
    assert.deepEqual(plan.components.icp.highlightPhrases, ["첫 고객 후보", "고객 후보"]);
    assert.equal(plan.components.painPoint.title, "문제");
    assert.deepEqual(plan.components.painPoint.highlightPhrases, ["비용을 치르는 문제", "문제"]);
    assert.equal(plan.components.outcome.title, "확인할 행동");
    assert.equal(plan.components.outcome.prompt, "그 고객에게서 어떤 행동 신호를 확인해야 하나요?");
    assert.deepEqual(plan.components.outcome.highlightPhrases, ["행동 신호", "확인할 행동", "검증 행동"]);
    assert.doesNotMatch(JSON.stringify(plan.components), /Day\s*2|Day2/);
    assert.ok(plan.qualityGate.score >= 7, `expected quality score >= 7, got ${plan.qualityGate.score}`);
    assert.equal(plan.qualityGate.passed, true);
    assert.match(plan.qualityGate.passGate, /7\.0\/10/);
    assert.match(plan.day2Handoff.title, /Day 2/);
    assert.match(plan.day2Handoff.focus, /목표:/);
    assert.match(plan.day2Handoff.nextDayPrompt, /시장|돈|시간/);
    assertConciseSignalDigest(plan.signalDigest);
    assert.equal(plan.signalDigest.rows[0].value, "agentic30 Mac");
    assert.doesNotMatch(plan.signalDigest.rows[0].value, /quality/i);
    assertEvidenceMarkedOptions(plan.components.icp.options);
    assertEvidenceMarkedOptions(plan.components.painPoint.options, { allowLimited: true });
    assertEvidenceMarkedOptions(plan.components.outcome.options, { allowLimited: true });
    const outcomeLabels = plan.components.outcome.options.map((option) => option.label).join("\n");
    const painLabels = plan.components.painPoint.options.map((option) => option.label).join("\n");
    assert.doesNotMatch(outcomeLabels, /부트캠프|100명과 첫 매출 달성|\.md|로 이어지는 첫 검증 행동|검증로|한다\.로|모른다을|수익\s*0원(?:의|가|\s+1명)/);
    assert.doesNotMatch(painLabels, /problem\s*memo|interview\s*transcript|인터뷰\s*transcript|transcript\s*입력|메모\s*입력/i);
    assert.notEqual(plan.components.outcome.options[0].label, plan.components.painPoint.statement);
    assert.match(outcomeLabels, /지불 의향|현재 대안|최근 사건|고객 반응|검증|확인|판단|시장|대화|행동|신호/);
    assert.doesNotMatch(plan.components.icp.options.map((option) => option.label).join("\n"), /GitHub\/IDE\/CLI/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment extracts concise hypothesis from README and package when canonical docs are absent", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(
      root,
      "README.md",
      [
        "# SupportLens",
        "",
        "Target user: customer success lead handling B2B Slack escalations.",
        "Problem: escalation requests fall through Slack before SLA breach.",
        "Goal: confirm one paid workflow with customer success leads this week.",
        "Outcome: customer success lead confirms missed escalation risk in a customer conversation.",
      ].join("\n"),
    );
    await writeFile(
      root,
      "package.json",
      JSON.stringify({
        name: "supportlens",
        description: "Customer success escalation QA for B2B support teams",
        dependencies: { react: "^18.0.0" },
      }),
    );

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: { confidence: "low" },
      localDiscovery: { project: { stacks: ["node"], manifestPaths: ["package.json"] } },
    });

    assertConciseSignalDigest(plan.signalDigest);
    assert.equal(plan.signals.productName, "SupportLens");
    assert.match(plan.signals.currentIcpGuess, /customer success/i);
    assert.match(plan.signals.problem, /Slack|escalation|SLA/i);
    assert.match(plan.projectGoal, /paid workflow|Goal|customer success/i);
    assert.ok(plan.qualityGate.passed, `expected README/package evidence to pass, got ${plan.qualityGate.score}`);
    assert.ok(plan.signals.evidenceRefs.some((ref) => ref.path === "README.md"));
    assert.equal(plan.signalDigest.rows.find((row) => row.key === "evidence").value, "README.md, package.json");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment extracts user-facing signals from source when docs are absent", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "package.json", JSON.stringify({ name: "launchdesk", dependencies: { vite: "^5.0.0" } }));
    await writeFile(
      root,
      "src/landing-copy.ts",
      [
        "export const landingCopy = {",
        "  targetUser: \"solo founders preparing a paid launch\",",
        "  problem: \"they do not know which buyer signal to test before publishing\",",
        "  goal: \"prove one buyer signal with three founder calls this week\",",
        "  outcome: \"solo founders confirm a buyer signal in customer calls before launch\"",
        "};",
      ].join("\n"),
    );

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: { confidence: "low" },
      localDiscovery: { project: { stacks: ["node"], manifestPaths: ["package.json"] } },
    });

    assertConciseSignalDigest(plan.signalDigest);
    assert.match(plan.signals.currentIcpGuess, /solo founders/i);
    assert.match(plan.signals.problem, /buyer signal/i);
    assert.match(plan.projectGoal, /buyer signal|founder calls/i);
    assert.ok(plan.qualityGate.passed, `expected source evidence to pass, got ${plan.qualityGate.score}`);
    assert.ok(plan.signals.evidenceRefs.some((ref) => ref.path === "src/landing-copy.ts"));
    for (const component of Object.values(plan.components)) {
      for (const option of component.options) {
        assert.ok(option.highlightPhrases.length >= 1, `missing highlight phrase for ${option.label}`);
        assert.ok(
          option.highlightPhrases.every((phrase) =>
            option.label.toLowerCase().includes(phrase.toLowerCase())
          ),
          `highlight phrases must be exact option label substrings: ${option.label}`,
        );
      }
    }
    assert.doesNotMatch(JSON.stringify(plan.signalDigest), /landing-copy\.ts.*targetUser/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment fails quality gate when only tech stack evidence exists", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "package.json", JSON.stringify({ name: "stack-only", dependencies: { react: "^18.0.0", vite: "^5.0.0" } }));
    await writeFile(root, "src/App.tsx", "export function App() { return <div>Hello</div>; }\n");

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: { confidence: "low" },
      localDiscovery: { project: { stacks: ["node"], manifestPaths: ["package.json"] } },
    });

    assertConciseSignalDigest(plan.signalDigest);
    assert.equal(plan.qualityGate.passed, false);
    assert.match(plan.signalDigest.rows.find((row) => row.key === "goal").value, /목표 확인 필요/);
    assert.match(plan.signalDigest.rows.find((row) => row.key === "pain").value, /핵심 문제 확인 필요/);
    assert.doesNotMatch(JSON.stringify(plan.signalDigest), /react|vite|GitHub\/IDE\/CLI/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment rejects unitless numeric goals and unsafe source paths", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# MetricOnly\n\nTarget user: ecommerce operator.\nProblem: campaign reporting takes too long.\n");
    await writeFile(root, "src/pricing.ts", "export const pricingCopy = \"ecommerce operators confirm reporting delay in sales calls\";\n");
    await writeFile(root, "src/__tests__/secret-token.ts", "export const targetUser = \"should never be read\";\n");
    await writeFile(root, "vendor/landing.ts", "export const targetUser = \"vendor-only customer\";\n");

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "MetricOnly",
        targetUser: "",
        problem: "",
        goal: "120,",
        confidence: "low",
      },
      localDiscovery: { project: { stacks: ["node"], manifestPaths: [] } },
    });

    assertConciseSignalDigest(plan.signalDigest);
    assert.doesNotMatch(plan.signalDigest.rows.find((row) => row.key === "goal").value, /^120,$/);
    assert.ok(plan.signals.evidenceRefs.some((ref) => ref.path === "src/pricing.ts"));
    assert.ok(!plan.signals.evidenceRefs.some((ref) => /__tests__|secret-token|vendor/.test(ref.path)));
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
      ".agentic30/docs/ICP.md",
      [
        "# Ideal Customer Profile",
        "",
        "## Our ICP: 전업 1인 개발자 (수익 0원, macOS)",
        "",
        "## Persona",
        "Primary persona는 “퇴사 후 전업한 macOS 1인 개발자”다.",
        "- **Job summary:** AI 코딩 도구로 빠르게 만들 수 있지만, 고객 검증과 배포/획득 루프는 약하다.",
        "- **Motivation:** 30일 안에 실제 사용자 증거와 첫 유료 신호를 만들고 싶다.",
        "- **Frustration:** 고객 인터뷰와 BIP 기록을 해도 다음 행동으로 연결하지 못한다.",
        "",
        "### 설명",
        "퇴사 후 전업했지만 수익은 0원이다. 제품은 만들 수 있으나 무엇을 팔아야 할지, 누구에게 팔아야 할지, 어떻게 첫 사용자를 데려올지 막혀 있다.",
      ].join("\n"),
    );
    await writeFile(
      root,
      ".agentic30/docs/GOAL.md",
      "# Agentic30 목표\n\nAgentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.\n",
    );
    await writeFile(
      root,
      ".agentic30/docs/SPEC.md",
      "# Agentic30 Product Spec\n\n핵심 문제는 “만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다”는 것이다.\n",
    );

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { icp: ".agentic30/docs/ICP.md", goal: ".agentic30/docs/GOAL.md", spec: ".agentic30/docs/SPEC.md", docs: "README.md" },
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
    const rows = Object.fromEntries(plan.signalDigest.rows.map((row) => [row.key, row.value]));
    const outcomeDisplays = [
      plan.alignmentStatement.outcome,
      rows.outcome,
      ...labels,
    ];
    assertEvidenceMarkedOptions(plan.components.icp.options);
    assertEvidenceMarkedOptions(plan.components.painPoint.options, { allowLimited: true });
    assertEvidenceMarkedOptions(plan.components.outcome.options, { allowLimited: true });
    assertOutcomeValidationDiversity(plan.components.outcome.options);
    assert.equal(
      labels.every((label) => /(검증|확인)한다[.。．]?$/u.test(label)),
      false,
      `outcome choices should not all be generic verify/confirm phrasing: ${serialized}`,
    );
    assert.deepEqual(plan.signalDigest.rows.map((row) => row.label), SIGNAL_DIGEST_LABELS);
    assert.match(plan.alignmentStatement.icp, /전업 1인 개발자 \(수익 0원, macOS\)/);
    assert.doesNotMatch(`${plan.alignmentStatement.outcome}\n${serialized}`, /Job summary|Motivation|Frustration|고객 검증과 배포\/획득 루프는 약하다|다음 행동으로 연결하지 못한다/);
    assert.match(plan.alignmentStatement.outcome, /지불 의향|현재 대안|최근 사건|고객 반응|검증|확인/);
    assert.doesNotMatch(serialized, /부트캠프|사용자\s*100명|첫\s*매출\s*달성|\.md|로 이어지는 첫 검증 행동|검증로|한다\.로|모른다을|수익\s*0원(?:의|가|\s+1명)/);
    assert.doesNotMatch(
      plan.components.painPoint.options.map((option) => option.label).join("\n"),
      /problem\s*memo|interview\s*transcript|인터뷰\s*transcript|transcript\s*입력|메모\s*입력/i,
    );
    for (const value of outcomeDisplays) {
      assertNoDanglingOpeningDelimiter(value);
      assert.doesNotMatch(value, /전업 1인 개발자|\(수익|macOS/);
      assert.match(value, /지불 의향|현재 대안|최근 사건|고객 반응|검증|확인|판단|시장|대화|행동|신호/);
    }
    assert.ok(labels.every((label) => label !== plan.components.painPoint.statement));
    assert.ok(labels.some((label) => /검증|확인|판단|시장|대화|행동|신호/.test(label)), serialized);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 deterministic pain options ignore SPEC input artifacts", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# agentic30 Mac\n\nProduct context for adaptive curriculum.");
    await writeFile(
      root,
      ".agentic30/docs/ICP.md",
      [
        "# Ideal Customer Profile",
        "",
        "## Our ICP: 전업 1인 개발자 (수익 0원, macOS)",
      ].join("\n"),
    );
    await writeFile(
      root,
      ".agentic30/docs/GOAL.md",
      "# Agentic30 목표\n\nAgentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.\n",
    );
    await writeFile(
      root,
      ".agentic30/docs/SPEC.md",
      [
        "# Agentic30 Product Spec",
        "",
        "## 타겟 사용자",
        "핵심 문제는 “만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다”는 것이다.",
        "",
        "## MVP Scope",
        "Q2의 제품 wedge는 Day 0-3 private pilot loop다.",
        "",
        "### MVP Success",
        "- 외부 ICP 인터뷰나 problem evidence가 Mac 앱/sidecar 입력으로 들어온다.",
        "- 같은 ICP 조건에서 pain point와 행동 신호가 반복된다.",
        "",
        "### In Scope",
        "- SwiftUI macOS 메뉴바 앱",
        "- problem memo 또는 인터뷰 transcript 입력",
        "- Day 0-3 맞춤 과제 생성",
      ].join("\n"),
    );

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { icp: ".agentic30/docs/ICP.md", goal: ".agentic30/docs/GOAL.md", spec: ".agentic30/docs/SPEC.md", docs: "README.md" },
      onboardingHypothesis: {
        productName: "agentic30 Mac",
        projectKind: "mac_app",
        targetUser: "전업 1인 개발자 (수익 0원, macOS)",
        goal: "사용자 100명과 첫 매출 달성",
        confidence: "high",
      },
    });

    const painLabels = plan.components.painPoint.options.map((option) => option.label);
    const serialized = painLabels.join("\n");
    assert.match(serialized, /무엇을 팔아야|사람을 데려와야|오늘 무엇을 검증/);
    assert.doesNotMatch(serialized, /problem memo|problem evidence|인터뷰 transcript|transcript 입력/i);
    assert.ok(plan.components.painPoint.options.some((option) => option.label.startsWith("직접 입력")));
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment normalizer strips customer segment from outcome surfaces", async () => {
  const root = await tempWorkspace();
  try {
    const deterministicPlan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "Agentic30",
        targetUser: "전업 1인 개발자 (수익 0원, macOS)",
        problem: "무엇을 팔아야 할지 모른다",
        goal: "첫 유료 고객 후보를 검증한다",
        confidence: "high",
      },
    });
    const contaminatedOutcome = "전업 1인 개발자 (수익 0원, macOS)의 지불 의향과 현재 대안을 확인한다";
    const normalized = normalizeDay1AlignmentPlan({
      ...deterministicPlan,
      components: {
        ...deterministicPlan.components,
        outcome: {
          ...deterministicPlan.components.outcome,
          statement: contaminatedOutcome,
          options: deterministicPlan.components.outcome.options.map((option, index) => ({
            ...option,
            label: index === 0
              ? contaminatedOutcome
              : index === 1
                ? "전업 1인 개발자 (수익 0원, macOS) 1명에게 최근 사건을 고객 대화에서 확인한다"
                : "전업 1인 개발자 (수익 0원, macOS)에게 첫 사용자 획득 채널을 확인한다",
          })),
        },
      },
      alignmentStatement: {
        ...deterministicPlan.alignmentStatement,
        outcome: contaminatedOutcome,
      },
      signalDigest: {
        ...deterministicPlan.signalDigest,
        rows: deterministicPlan.signalDigest.rows.map((row) =>
          row.key === "outcome" ? { ...row, value: contaminatedOutcome } : row
        ),
      },
    });

    assert.ok(normalized);
    assert.match(normalized.alignmentStatement.icp, /전업 1인 개발자 \(수익 0원, macOS\)/);
    const rows = Object.fromEntries(normalized.signalDigest.rows.map((row) => [row.key, row.value]));
    for (const value of [
      normalized.alignmentStatement.outcome,
      rows.outcome,
      ...normalized.components.outcome.options.map((option) => option.label),
    ]) {
      assertNoDanglingOpeningDelimiter(value);
      assert.doesNotMatch(value, /전업 1인 개발자|\(수익|macOS/);
      assert.match(value, /지불 의향|현재 대안|최근 사건|검증|확인|대화|행동|신호/);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment signal digest keeps long pain copy within display limit", async () => {
  const root = await tempWorkspace();
  try {
    const deterministicPlan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "PhotoVault",
        targetUser: "개인 사용자 및 소규모 팀",
        problem: "Google Photos와 iCloud 같은 클라우드 서비스에 개인 사진과 동영상을 맡기고 싶지 않은 사용자가 자체 호스팅 대안 없이 데이터 주권을 잃는다",
        goal: "개인 사진 보관 대안을 검증한다",
        confidence: "high",
      },
    });
    const longPain = "Google Photos와 iCloud 같은 클라우드 서비스에 개인 사진과 동영상을 맡기고 싶지 않은 사용자가 자체 호스팅 대안 없이 데이터 주권을 잃는 문제";

    const normalized = normalizeDay1AlignmentPlan({
      ...deterministicPlan,
      signals: {
        ...deterministicPlan.signals,
        problem: longPain,
      },
      components: {
        ...deterministicPlan.components,
        painPoint: {
          ...deterministicPlan.components.painPoint,
          statement: longPain,
        },
      },
      alignmentStatement: {
        ...deterministicPlan.alignmentStatement,
        painPoint: longPain,
      },
      signalDigest: {
        ...deterministicPlan.signalDigest,
        rows: deterministicPlan.signalDigest.rows.map((row) =>
          row.key === "pain" ? { ...row, value: longPain } : row
        ),
      },
    });

    assert.ok(normalized);
    const pain = normalized.signalDigest.rows.find((row) => row.key === "pain").value;
    assert.equal(pain, longPain);
    assert.ok(pain.length > 80);
    assert.ok(pain.length <= SIGNAL_DIGEST_LIMITS.pain);
    assert.doesNotMatch(pain, /…$/);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment normalizer rejects near-duplicate outcome choices", async () => {
  const root = await tempWorkspace();
  try {
    const deterministicPlan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "Agentic30",
        targetUser: "전업 1인 개발자 (수익 0원, macOS)",
        problem: "무엇을 팔아야 할지 모른다",
        goal: "첫 유료 고객 후보를 검증한다",
        confidence: "high",
      },
    });
    const duplicatePaymentLabels = [
      "첫 대화에서 지불 의향을 확인한다",
      "가격 지불 의사를 고객 대화에서 묻는다",
      "유료 전환 가능성을 시장 신호로 검증한다",
    ];
    const normalized = normalizeDay1AlignmentPlan({
      ...deterministicPlan,
      components: {
        ...deterministicPlan.components,
        outcome: {
          ...deterministicPlan.components.outcome,
          options: deterministicPlan.components.outcome.options.map((option, index) => ({
            ...option,
            label: duplicatePaymentLabels[index % duplicatePaymentLabels.length],
            highlightPhrases: [duplicatePaymentLabels[index % duplicatePaymentLabels.length]],
          })),
        },
      },
    });

    assert.equal(normalized, null);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment normalizer avoids full-label option highlights", async () => {
  const root = await tempWorkspace();
  try {
    const deterministicPlan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "Agentic30",
        targetUser: "전업 1인 개발자 (수익 0원, macOS)",
        problem: "무엇을 팔아야 할지 모른다",
        goal: "첫 유료 고객 후보를 검증한다",
        confidence: "high",
      },
    });
    const longLabel = "전업 1인 개발자 (수익 0원, macOS)";
    const longSingleTokenLabel = "초장문개발자옵션라벨전체강조금지";
    const parentheticalLabel = "초기 창업자 (월 매출 0원, macOS)";
    const tokenLabel = "AI 코딩 도구를 쓰는 개발자";
    const baseOption = deterministicPlan.components.icp.options[0];
    const secondOption = deterministicPlan.components.icp.options[1] || baseOption;
    const normalized = normalizeDay1AlignmentPlan({
      ...deterministicPlan,
      components: {
        ...deterministicPlan.components,
        icp: {
          ...deterministicPlan.components.icp,
          options: [
            {
              ...baseOption,
              id: "long-label",
              label: longLabel,
              highlightPhrases: [longLabel],
            },
            {
              ...secondOption,
              id: "long-single-token",
              label: longSingleTokenLabel,
              highlightPhrases: [longSingleTokenLabel],
            },
            {
              ...baseOption,
              id: "parenthetical",
              label: parentheticalLabel,
              highlightPhrases: ["월 매출 0원, macOS"],
            },
            {
              ...baseOption,
              id: "token-boundary",
              label: tokenLabel,
              highlightPhrases: ["AI 코딩 도구를 쓰"],
            },
          ],
        },
      },
    });

    assert.ok(normalized);
    const phrases = normalized.components.icp.options[0].highlightPhrases;
    assert.ok(phrases.length >= 1);
    assert.ok(!phrases.includes(longLabel), `should not keep whole option label: ${phrases.join(", ")}`);
    assert.ok(
      phrases.every((phrase) => longLabel.toLowerCase().includes(phrase.toLowerCase())),
      `highlight phrases must stay exact label substrings: ${phrases.join(", ")}`,
    );
    const singleTokenPhrases = normalized.components.icp.options[1].highlightPhrases;
    assert.ok(singleTokenPhrases.length >= 1);
    assert.ok(
      !singleTokenPhrases.includes(longSingleTokenLabel),
      `should not keep whole single-token option label: ${singleTokenPhrases.join(", ")}`,
    );
    const parentheticalPhrases = normalized.components.icp.options[2].highlightPhrases;
    assert.deepEqual(parentheticalPhrases, ["(월 매출 0원, macOS)"]);
    const tokenPhrases = normalized.components.icp.options[3].highlightPhrases;
    assert.deepEqual(tokenPhrases, ["AI 코딩 도구를 쓰는"]);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Agentic30 public docs render goal and pain instead of scan placeholders", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# agentic30 Mac\n\nProduct context for adaptive curriculum.");
    await writeFile(
      root,
      ".agentic30/docs/GOAL.md",
      [
        "# Agentic30 목표 / 핵심 결과",
        "",
        "## 프로젝트 미션",
        "",
        "Agentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.",
      ].join("\n"),
    );
    await writeFile(
      root,
      ".agentic30/docs/ICP.md",
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
      ".agentic30/docs/SPEC.md",
      "# Agentic30 Product Spec\n\n핵심 문제는 “만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다”는 것이다.\n",
    );
    await writeFile(
      root,
      ".agentic30/docs/VALUES.md",
      "# Values — Agentic30이 지키는 기준\n\nAgentic30의 가치는 좋은 말이 아니라 제품과 코칭이 매일 지킬 판단 기준이다.\n",
    );
    await writeFile(
      root,
      "src/schema.mjs",
      [
        "export const Day1SignalDigestSchema = {",
        "  goal: 120,",
        "  values: z.string().min(1),",
        "};",
      ].join("\n"),
    );
    const scanResult = {
      icp: ".agentic30/docs/ICP.md",
      goal: ".agentic30/docs/GOAL.md",
      spec: ".agentic30/docs/SPEC.md",
      values: ".agentic30/docs/VALUES.md",
      docs: "README.md",
    };
    const onboardingHypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root, {
      docPaths: scanResult,
    });

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult,
      onboardingHypothesis,
      localDiscovery: { project: { stacks: ["node"], manifestPaths: [] } },
    });

    const rows = Object.fromEntries(plan.signalDigest.rows.map((row) => [row.key, row.value]));
    assertConciseSignalDigest(plan.signalDigest);
    assert.match(rows.goal, /사용자 100명|첫 매출/);
    assert.match(rows.pain, /무엇을 팔아야|누구에게 팔아야|오늘 무엇을 검증/);
    assert.doesNotMatch(rows.goal, /목표 확인 필요|^120,$/);
    assert.doesNotMatch(rows.pain, /핵심 문제 확인 필요/);
    assert.doesNotMatch(JSON.stringify(plan.signalDigest), /z\.string|min\(1\)/);
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
    assert.equal(rows.pain, "핵심 문제 확인 필요");
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
          { key: "evidence", label: "근거", value: ".agentic30/docs/GOAL.md, .agentic30/docs/ICP.md", tone: "code" },
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

test("Day 1 alignment frontier synthesis merges five high-quality choices", async () => {
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
    const claudePlan = makeFrontierAlignmentPlan(deterministicPlan, "Claude");
    const gptPlan = makeFrontierAlignmentPlan(deterministicPlan, "GPT");

    const plan = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      frontierResults: [
        { provider: "claude", model: "claude-opus-4-8", text: JSON.stringify(claudePlan) },
        { provider: "codex", model: "gpt-5.5", text: JSON.stringify(gptPlan) },
      ],
    });

    assert.equal(plan.source, "frontier_ensemble");
    assert.equal(plan.fellBackToDeterministic, false);
    for (const component of [plan.components.icp, plan.components.painPoint, plan.components.outcome]) {
      assert.equal(component.options.length, 5);
      for (const option of component.options) {
        assert.ok(option.description, `missing description for ${option.label}`);
        assert.ok(option.evidenceLabel, `missing evidence for ${option.label}`);
      }
      assert.ok(component.options.filter((option) => option.antiSignal === true).length <= 1);
    }
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment frontier synthesis dedupes similar outcomes and fills from backup candidates", async () => {
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
    const noisyPrimary = makeFrontierAlignmentPlan(deterministicPlan, "Noisy");
    noisyPrimary.components.outcome.options = [
      frontierOption("outcome_noisy_1", "지불 의향을 첫 고객 대화에서 확인한다", "돈을 낼 문제인지 확인합니다. · 근거: .agentic30/docs/GOAL.md", "확인할 행동", "근거: .agentic30/docs/GOAL.md"),
      frontierOption("outcome_noisy_2", "가격 지불 의사를 이번 주 대화에서 묻는다", "같은 결제 신호를 다른 말로 반복합니다. · 근거: .agentic30/docs/GOAL.md", "확인할 행동", "근거: .agentic30/docs/GOAL.md"),
      frontierOption("outcome_noisy_3", "최근 Slack 누락 사건을 고객 대화에서 기록한다", "최근 사건 기반 검증입니다. · 근거: .agentic30/docs/SPEC.md", "확인할 행동", "근거: .agentic30/docs/SPEC.md"),
      frontierOption("outcome_noisy_4", "계정 위험 알림 도입 결정을 누가 하는지 확인한다", "도입 결정권 검증입니다. · 근거: .agentic30/docs/ICP.md", "확인할 행동", "근거: .agentic30/docs/ICP.md"),
      frontierOption("outcome_noisy_5", "수동 확인 workflow를 보여달라고 요청한다", "현재 대안 관찰입니다. · 근거: README.md", "확인할 행동", "근거: README.md"),
    ];
    const backup = makeFrontierAlignmentPlan(deterministicPlan, "Backup");
    backup.components.outcome.options = [
      frontierOption("outcome_backup_1", "첫 사용자 획득 채널이나 소개 가능성을 확인한다", "획득 경로 신호를 확인합니다. · 근거: .agentic30/docs/GOAL.md", "확인할 행동", "근거: .agentic30/docs/GOAL.md"),
      frontierOption("outcome_backup_2", "최근 누락 사건과 현재 대안을 고객 대화에서 확인한다", "실제 사건과 대안을 같이 확인합니다. · 근거: .agentic30/docs/SPEC.md", "확인할 행동", "근거: .agentic30/docs/SPEC.md"),
      frontierOption("outcome_backup_3", "SLA 리스크 판단을 위해 지불 의향을 묻는다", "지불 신호입니다. · 근거: .agentic30/docs/GOAL.md", "확인할 행동", "근거: .agentic30/docs/GOAL.md"),
      frontierOption("outcome_backup_4", "계정 위험 알림 도입 결정을 누가 하는지 확인한다", "결정권 신호입니다. · 근거: .agentic30/docs/ICP.md", "확인할 행동", "근거: .agentic30/docs/ICP.md"),
      frontierOption("outcome_backup_5", "수동 확인 workflow를 보여달라고 요청한다", "현재 대안 신호입니다. · 근거: README.md", "확인할 행동", "근거: README.md"),
    ];

    const plan = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      frontierResults: [
        { provider: "claude", model: "claude-opus-4-8", text: JSON.stringify(noisyPrimary) },
        { provider: "codex", model: "gpt-5.5", text: JSON.stringify(backup) },
      ],
    });

    assert.match(plan.source, /^frontier_/);
    assert.equal(plan.components.outcome.options.length, 5);
    assertOutcomeValidationDiversity(plan.components.outcome.options, { minFamilies: 5 });
    assert.equal(
      plan.components.outcome.options.filter((option) => /지불 의향|가격 지불|유료 전환|지불 의향/.test(option.label)).length,
      1,
      JSON.stringify(plan.components.outcome.options.map((option) => option.label)),
    );
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment frontier synthesis tolerates provider failures and falls back on total failure", async () => {
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
    const frontierPlan = makeFrontierAlignmentPlan(deterministicPlan, "Gemini");
    const single = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      frontierResults: [
        { provider: "claude", model: "claude-opus-4-8", text: "{not json" },
        { provider: "gemini", model: "gemini-3.5-flash", text: JSON.stringify(frontierPlan) },
      ],
    });
    assert.equal(single.source, "frontier_single");
    assert.equal(single.components.outcome.options.length, 5);

    const failed = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      frontierResults: [
        { provider: "claude", model: "claude-opus-4-8", text: "{not json" },
        { provider: "codex", model: "gpt-5.5", text: JSON.stringify({ ...frontierPlan, confidence: 0.1 }) },
      ],
    });
    assert.equal(failed.source, "deterministic");
    assert.equal(failed.fellBackToDeterministic, true);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment frontier synthesis filters product-input and outcome contamination", async () => {
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
    const contaminated = makeFrontierAlignmentPlan(deterministicPlan, "Clean");
    contaminated.components.painPoint.options[0] = frontierOption(
      "bad_pain",
      "problem memo 또는 인터뷰 transcript 입력",
      "제품 입력 기능은 고객 통증 선택지가 아닙니다. · 근거: .agentic30/docs/SPEC.md",
      "문제",
      "근거: .agentic30/docs/SPEC.md",
    );
    contaminated.components.outcome.options[0] = frontierOption(
      "bad_outcome",
      "Job summary: AI 코딩 도구로 빠르게 만들 수 있다",
      "제품 기능 설명은 고객 행동 신호가 아닙니다. · 근거: .agentic30/docs/SPEC.md",
      "확인할 행동",
      "근거: .agentic30/docs/SPEC.md",
    );
    const cleanBackup = makeFrontierAlignmentPlan(deterministicPlan, "Backup");

    const plan = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      frontierResults: [
        { provider: "claude", model: "claude-opus-4-8", text: JSON.stringify(contaminated) },
        { provider: "codex", model: "gpt-5.5", text: JSON.stringify(cleanBackup) },
      ],
    });

    assert.equal(plan.source, "frontier_ensemble");
    const labels = JSON.stringify(plan.components);
    assert.doesNotMatch(labels, /problem memo|인터뷰 transcript 입력|Job summary|AI 코딩 도구/);
    assert.equal(plan.components.painPoint.options.length, 5);
    assert.equal(plan.components.outcome.options.length, 5);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment normalizer strips project row metadata without changing identity", async () => {
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

    assert.equal(normalized.signals.productName, "agentic30 Mac");
    assert.equal(normalized.signalDigest.rows[0].value, "agentic30 Mac");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("non-Agentic30 SaaS fixture avoids Agentic30-specific axes and names", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# SupportLens\n\nB2B SaaS that helps support leads triage customer escalations from Slack and email.");
    await writeFile(root, ".agentic30/docs/SPEC.md", "# SPEC\n\nProblem: support leads miss urgent account-risk escalations.");
    await writeFile(root, "package.json", JSON.stringify({ name: "supportlens", dependencies: { next: "^15.0.0", react: "^19.0.0" } }));

    const plan = await generateDay1IcpPlan({
      workspaceRoot: root,
      scanResult: { spec: ".agentic30/docs/SPEC.md", docs: "README.md" },
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
      { path: ".agentic30/docs/ICP.md", reason: "icp document", quote: "B2B SaaS support lead" },
      { path: ".agentic30/docs/SPEC.md", reason: "spec document", quote: "Problem: urgent account-risk escalations are missed in Slack and email" },
      { path: ".agentic30/docs/GOAL.md", reason: "goal document", quote: "유료 support lead 후보 1명을 검증한다" },
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
    assert.equal(malformed.components.icp.title, "고객");

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

    const missingHighlightsPlan = structuredClone(deterministicPlan);
    delete missingHighlightsPlan.components.icp.highlightPhrases;
    const missingHighlights = await composeDay1AlignmentPlan({
      workspaceRoot: root,
      deterministicPlan,
      queryImpl: async () => JSON.stringify(missingHighlightsPlan),
    });
    assert.equal(missingHighlights.source, "deterministic");
    assert.equal(missingHighlights.fellBackToDeterministic, true);

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
                description: "사업 목표를 그대로 복사함 · 근거: .agentic30/docs/GOAL.md",
                preview: "Outcome",
                antiSignal: false,
                evidenceLabel: "근거: .agentic30/docs/GOAL.md",
                evidenceLimited: false,
              },
              {
                id: "bad_feature",
                label: "기능 추가",
                description: "고객 결과가 아니라 제품 기능입니다.",
                preview: "Outcome",
                antiSignal: false,
                evidenceLabel: "근거: .agentic30/docs/SPEC.md",
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
    await writeFile(root, ".agentic30/docs/GOAL.md", "# GOAL\n\n검증된 첫 매출 후보를 만든다.");
    await writeFile(root, ".agentic30/docs/ICP.md", "# ICP\n\nB2B SaaS support lead.");
    await writeFile(root, ".agentic30/docs/SPEC.md", "# SPEC\n\nProblem: Slack escalation 누락.");

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { goal: ".agentic30/docs/GOAL.md", icp: ".agentic30/docs/ICP.md", spec: ".agentic30/docs/SPEC.md", docs: "README.md" },
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
    assert.equal(evidence.value, ".agentic30/docs/GOAL.md, .agentic30/docs/ICP.md, .agentic30/docs/SPEC.md");
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment signal digest rejects markdown document links outside evidence row", async () => {
  const root = await tempWorkspace();
  try {
    await writeFile(root, "README.md", "# agentic30 Mac\n\nNative macOS assistant.");
    await writeFile(root, ".agentic30/docs/GOAL.md", "# GOAL\n\n첫 유료 고객 후보를 검증한다.");
    await writeFile(root, ".agentic30/docs/ICP.md", "# ICP\n\n전업 1인 개발자.");
    await writeFile(root, ".agentic30/docs/SPEC.md", "# SPEC\n\nProblem: 무엇을 만들어야 팔리는지 모른다.");

    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: { goal: ".agentic30/docs/GOAL.md", icp: ".agentic30/docs/ICP.md", spec: ".agentic30/docs/SPEC.md", docs: "README.md" },
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
      evidenceRefs: [{ path: ".agentic30/docs/ICP.md", reason: "ICP", quote: "개발자" }],
      missingAssumptions: [],
      confidence: "high",
    },
    components: {
      icp: {
        id: "icp",
        title: "ICP",
        prompt: "먼저 검증할 고객은?",
        statement: documentPointer,
        evidence: [".agentic30/docs/ICP.md"],
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
        evidence: [".agentic30/docs/SPEC.md"],
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
        evidence: [".agentic30/docs/GOAL.md"],
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

test("normalizeEmphasis validates phrases, styles, substring, dedup, and cap", () => {
  const text = "파일 config.json 의 마감일은 금요일이고 핵심 수치는 100명입니다";
  const emphasis = normalizeEmphasis(
    [
      { phrase: "  config.json ", style: "code" },
      { phrase: "마감일은 금요일", style: "mark" },
      { phrase: "100명", style: "strong" },
      { phrase: "100명", style: "strong" }, // duplicate dropped
      { phrase: "존재하지 않는 구절", style: "mark" }, // not a substring -> dropped
      { phrase: "수치", style: "unknown-style" }, // unsupported style -> mark
      { phrase: "   ", style: "code" }, // empty after trim -> dropped
    ],
    text,
  );

  assert.deepEqual(emphasis, [
    { phrase: "config.json", style: "code" },
    { phrase: "마감일은 금요일", style: "mark" },
    { phrase: "100명", style: "strong" },
    { phrase: "수치", style: "mark" },
  ]);
});

test("normalizeEmphasis caps at five spans and tolerates empty/non-array input", () => {
  const text = "a b c d e f g";
  const capped = normalizeEmphasis(
    ["a", "b", "c", "d", "e", "f", "g"].map((phrase) => ({ phrase, style: "strong" })),
    text,
  );
  assert.equal(capped.length, 5);
  assert.deepEqual(normalizeEmphasis(undefined, "anything"), []);
  assert.deepEqual(normalizeEmphasis([], "anything"), []);
  assert.deepEqual(normalizeEmphasis("not an object", "anything"), []);
  // The `kind` alias resolves to style; a single object is accepted.
  assert.deepEqual(normalizeEmphasis({ phrase: "a", kind: "code" }, "a b"), [
    { phrase: "a", style: "code" },
  ]);
});

test("Day 1 alignment normalizer carries style-aware emphasis on component, option, and signal row", async () => {
  const root = await tempWorkspace();
  try {
    const deterministicPlan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "Agentic30",
        targetUser: "전업 1인 개발자 (수익 0원, macOS)",
        problem: "무엇을 팔아야 할지 모른다",
        goal: "첫 유료 고객 후보를 검증한다",
        confidence: "high",
      },
    });

    const icpStatement = deterministicPlan.components.icp.statement;
    const icpOptionLabel = deterministicPlan.components.icp.options[0].label;
    // Use real substrings of the actual statement/label so emphasis survives.
    const statementPhrase = icpStatement.slice(0, Math.min(4, icpStatement.length));
    const optionPhrase = icpOptionLabel.slice(0, Math.min(4, icpOptionLabel.length));

    const normalized = normalizeDay1AlignmentPlan({
      ...deterministicPlan,
      components: {
        ...deterministicPlan.components,
        icp: {
          ...deterministicPlan.components.icp,
          emphasis: [
            { phrase: statementPhrase, style: "strong" },
            { phrase: "이 문장에 없는 구절", style: "mark" }, // dropped (not substring)
          ],
          options: deterministicPlan.components.icp.options.map((option, index) =>
            index === 0
              ? {
                  ...option,
                  emphasis: [
                    { phrase: optionPhrase, style: "code" },
                    { phrase: optionPhrase, style: "code" }, // duplicate dropped
                  ],
                }
              : option,
          ),
        },
      },
      signalDigest: {
        ...deterministicPlan.signalDigest,
        rows: deterministicPlan.signalDigest.rows.map((row) =>
          row.key === "icp"
            ? {
                ...row,
                emphasis: [
                  { phrase: row.value.slice(0, Math.min(4, row.value.length)), style: "mark" },
                  { phrase: "행의 값에 없음", style: "strong" }, // dropped
                ],
              }
            : row,
        ),
      },
    });

    assert.ok(normalized, "plan should normalize");
    const icpEmphasis = normalized.components.icp.emphasis;
    assert.ok(Array.isArray(icpEmphasis) && icpEmphasis.length === 1);
    assert.equal(icpEmphasis[0].style, "strong");
    assert.ok(
      normalized.components.icp.statement.includes(icpEmphasis[0].phrase),
      "component emphasis phrase must be a statement substring",
    );

    const optionEmphasis = normalized.components.icp.options[0].emphasis;
    assert.ok(Array.isArray(optionEmphasis) && optionEmphasis.length === 1);
    assert.equal(optionEmphasis[0].style, "code");
    assert.ok(normalized.components.icp.options[0].label.includes(optionEmphasis[0].phrase));

    const icpRow = normalized.signalDigest.rows.find((row) => row.key === "icp");
    assert.ok(Array.isArray(icpRow.emphasis) && icpRow.emphasis.length === 1);
    assert.equal(icpRow.emphasis[0].style, "mark");
    assert.ok(icpRow.value.includes(icpRow.emphasis[0].phrase));

    // highlightPhrases stay intact for back-compat consumers.
    assert.ok(Array.isArray(normalized.components.icp.highlightPhrases));
    assert.ok(normalized.components.icp.highlightPhrases.length >= 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

test("Day 1 alignment plan omits emphasis key when none is provided (back-compat)", async () => {
  const root = await tempWorkspace();
  try {
    const plan = await generateDay1AlignmentPlan({
      workspaceRoot: root,
      scanResult: {},
      onboardingHypothesis: {
        productName: "Agentic30",
        targetUser: "전업 1인 개발자 (수익 0원, macOS)",
        problem: "무엇을 팔아야 할지 모른다",
        goal: "첫 유료 고객 후보를 검증한다",
        confidence: "high",
      },
    });

    // Deterministic plans carry no emphasis; the key must be absent so the Mac
    // renderer falls back to the legacy highlightPhrases path.
    assert.equal("emphasis" in plan.components.icp, false);
    assert.equal("emphasis" in plan.components.painPoint, false);
    assert.equal("emphasis" in plan.components.outcome, false);
    for (const option of plan.components.icp.options) {
      assert.equal("emphasis" in option, false);
    }
    for (const row of plan.signalDigest.rows) {
      assert.equal("emphasis" in row, false);
    }
    // Legacy highlightPhrases remain populated.
    assert.ok(plan.components.icp.highlightPhrases.length >= 1);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
});

import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  deriveWorkspaceOnboardingHypothesisLocally,
  mergeWorkspaceOnboardingHypotheses,
  normalizeProductName,
  normalizeWorkspaceOnboardingHypothesis,
} from "../sidecar/onboarding-hypothesis.mjs";

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-hypothesis-"));
  try {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.mkdir(path.join(root, ".agentic30", "docs"), { recursive: true });
    return await fn(root);
  } finally {
    await fs.rm(root, { recursive: true, force: true });
  }
}

test("deriveWorkspaceOnboardingHypothesisLocally infers project context from README and manifests", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(
      path.join(root, "README.md"),
      [
        "# agentic30 Mac",
        "",
        "A macOS app for developers using Codex and Claude coding agents.",
        "**타깃 유저:** 전업 1인 개발자, 수익 0원, macOS 사용자",
        "핵심 가설: 이 유저는 \"만들 줄은 있지만 무엇을 만들어야 팔리는지 모른다\"는 고통을 겪고 있다.",
        "Goal: 첫 고객 인터뷰 증거를 만든다.",
        "Values: 근거 없는 자동화를 거절하고 사용자 결정 증거를 우선한다.",
        "It helps indie founders build in public and find first users.",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "agentic30-sidecar",
        description: "Codex assistant sidecar",
        dependencies: { ws: "1.0.0" },
      }),
    );
    await fs.writeFile(path.join(root, ".agentic30", "docs", "SPEC.md"), "# SPEC\nDeveloper workflow prototype\n");

    const hypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root, {
      docPaths: { spec: ".agentic30/docs/SPEC.md" },
    });

    assert.equal(hypothesis.confidence, "high");
    assert.equal(hypothesis.productName, "agentic30 Mac");
    assert.match(hypothesis.targetUser, /전업 1인 개발자|developers using Codex/i);
    assert.match(hypothesis.goal, /첫 고객 인터뷰/);
    assert.match(hypothesis.values, /사용자 결정 증거/);
    assert.equal(hypothesis.stage, "first_users");
    assert.ok(hypothesis.likelyUsers.includes("AI 코딩 도구를 쓰는 개발자"));
    assert.match(hypothesis.suggestedFirstQuestion, /가장 먼저 인터뷰할 .*1인 개발자.*유형/);
    assert.ok(hypothesis.evidence.some((item) => item.includes("README")));
  });
});

test("deriveWorkspaceOnboardingHypothesisLocally ignores markdown reference bullets when extracting target user", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "README.md"), "# agentic30 Mac\n");
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "ICP.md"),
      [
        "# Ideal Customer Profile",
        "",
        "## Our ICP: 전업 1인 개발자 (수익 0원, macOS)",
        "",
        "### 설명",
        "퇴사 후 전업했지만 수익은 0원이다. 제품은 만들 수 있으나 무엇을 팔아야 할지, 누구에게 팔아야 할지, 어떻게 첫 사용자를 데려올지 막혀 있다.",
        "",
        "## 참고 문서",
        "- [SPEC.md](./SPEC.md) — 제품 명세와 타겟 사용자",
        "- [VALUES.md](./VALUES.md) — 제품 가치",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "SPEC.md"),
      [
        "# Agentic30 Product Spec",
        "",
        "핵심 문제는 “만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다”는 것이다.",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "GOAL.md"),
      "# Agentic30 목표\n\nAgentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.\n",
    );

    const hypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root, {
      docPaths: { icp: ".agentic30/docs/ICP.md", spec: ".agentic30/docs/SPEC.md", goal: ".agentic30/docs/GOAL.md" },
    });

    assert.match(hypothesis.targetUser, /전업 1인 개발자/);
    assert.doesNotMatch(hypothesis.targetUser, /\.md|VALUES|제품 명세와 타겟 사용자/);
    assert.match(hypothesis.problem, /무엇을 팔아야|누구에게 팔아야|오늘 무엇을 검증/);
    assert.doesNotMatch(JSON.stringify(hypothesis), /\[VALUES\.md\]|\[SPEC\.md\]/);
  });
});

test("deriveWorkspaceOnboardingHypothesisLocally prefers canonical docs over schema source snippets", async () => {
  await withTempWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "# agentic30 Mac\n");
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "GOAL.md"),
      [
        "# Agentic30 목표 / 핵심 결과",
        "",
        "## 프로젝트 미션",
        "",
        "Agentic30은 전업 1인 개발자를 위한 30일 부트캠프다. 사용자 100명과 첫 매출 달성을 목표로 한다.",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "ICP.md"),
      [
        "# Ideal Customer Profile",
        "",
        "## Our ICP: 전업 1인 개발자 (수익 0원, macOS)",
        "",
        "### 설명",
        "퇴사 후 전업했지만 수익은 0원이다. 제품은 만들 수 있으나 무엇을 팔아야 할지, 누구에게 팔아야 할지, 어떻게 첫 사용자를 데려올지 막혀 있다.",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "SPEC.md"),
      "# Agentic30 Product Spec\n\n핵심 문제는 “만들 줄은 알지만 무엇을 팔아야 하는지, 어떻게 사람을 데려와야 하는지, 오늘 무엇을 검증해야 하는지 모른다”는 것이다.\n",
    );
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "VALUES.md"),
      [
        "# Values — Agentic30이 지키는 기준",
        "",
        "Agentic30의 가치는 좋은 말이 아니라 제품과 코칭이 매일 지킬 판단 기준이다.",
        "",
        "## 1. 사용자가 드라이브한다",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, "src", "schema.mjs"),
      [
        "const signalDigestLimits = {",
        "  goal: 120,",
        "  values: z.string().min(1),",
        "};",
      ].join("\n"),
    );

    const hypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root, {
      docPaths: {
        icp: ".agentic30/docs/ICP.md",
        spec: ".agentic30/docs/SPEC.md",
        goal: ".agentic30/docs/GOAL.md",
        values: ".agentic30/docs/VALUES.md",
      },
    });

    assert.match(hypothesis.goal, /사용자 100명|첫 매출/);
    assert.match(hypothesis.problem, /무엇을 팔아야|누구에게 팔아야|오늘 무엇을 검증/);
    assert.match(hypothesis.values, /가치|사용자가 드라이브/);
    assert.doesNotMatch(JSON.stringify(hypothesis), /"goal":"?120|z\.string|min\(1\)/);
  });
});

test("normalizeProductName preserves product names after generic cleanup", () => {
  assert.equal(normalizeProductName("agentic30"), "agentic30");
  assert.equal(normalizeProductName("Agentic30"), "Agentic30");
  assert.equal(normalizeProductName("agentic30 Mac"), "agentic30 Mac");
  assert.equal(normalizeProductName("Agentic30 macOS app"), "Agentic30 macOS app");
  assert.equal(normalizeProductName("agentic30-sidecar"), "agentic30-sidecar");
  assert.equal(normalizeProductName("agentic30-public"), "agentic30-public");
  assert.equal(normalizeProductName("**agentic30 Mac**"), "agentic30 Mac");
  assert.equal(normalizeProductName("RevenuePilot Mac"), "RevenuePilot Mac");
});

test("deriveWorkspaceOnboardingHypothesisLocally preserves package-only project names", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(
      path.join(root, "package.json"),
      JSON.stringify({
        name: "agentic30-sidecar",
        description: "Codex assistant sidecar",
      }),
    );

    const hypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root);

    assert.equal(hypothesis.productName, "agentic30-sidecar");
  });
});

test("deriveWorkspaceOnboardingHypothesisLocally ignores reference links when extracting ICP", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(
      path.join(root, "README.md"),
      [
        "# agentic30 Mac",
        "",
        "Native macOS assistant for founders using AI coding agents.",
      ].join("\n"),
    );
    await fs.writeFile(
      path.join(root, ".agentic30", "docs", "ICP.md"),
      [
        "# Ideal Customer Profile (ICP)",
        "",
        "## Our ICP: 전업 1인 개발자 (수익 0원, macOS)",
        "",
        "퇴사 후 전업했지만 수익은 0원이다.",
        "",
        "## 참고 자료",
        "",
        "- [SPEC.md](./SPEC.md) — 제품 명세와 타겟 사용자",
        "- [VALUES.md](./VALUES.md) — 제품 가치",
      ].join("\n"),
    );

    const hypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root, {
      docPaths: { icp: ".agentic30/docs/ICP.md" },
    });

    assert.match(hypothesis.targetUser, /전업 1인 개발자/);
    assert.doesNotMatch(hypothesis.targetUser, /VALUES\.md|SPEC\.md/);
  });
});

test("deriveWorkspaceOnboardingHypothesisLocally includes source-derived project signals", async () => {
  await withTempWorkspace(async (root) => {
    await fs.mkdir(path.join(root, "src"), { recursive: true });
    await fs.writeFile(path.join(root, "README.md"), "# RevenuePilot\n");
    await fs.writeFile(
      path.join(root, "src", "ProductContext.ts"),
      [
        "// target user: 한국 B2B SaaS 창업자",
        "// problem: 첫 세일즈 콜에서 어떤 메시지가 팔리는지 모른다",
        "// goal: 10개 유료 상담 예약",
        "// values: 자동화보다 고객 대화 증거를 우선한다",
        "export const productContext = true;",
      ].join("\n"),
    );

    const hypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root);

    assert.equal(hypothesis.productName, "RevenuePilot");
    assert.match(hypothesis.targetUser, /한국 B2B SaaS 창업자/);
    assert.match(hypothesis.problem, /세일즈 콜/);
    assert.match(hypothesis.goal, /10개 유료 상담/);
    assert.match(hypothesis.values, /고객 대화 증거/);
    assert.ok(hypothesis.evidence.some((item) => item.includes("source:src/ProductContext.ts")));
  });
});

test("normalizeWorkspaceOnboardingHypothesis keeps malformed provider output safe", () => {
  assert.deepEqual(
    normalizeWorkspaceOnboardingHypothesis({
      projectKind: "../bad",
      likelyUsers: ["  개발자  ", "", "개발자"],
      stage: "prototype",
      evidence: ["README", "README"],
      confidence: "impossible",
    }),
    {
      productName: "",
      projectKind: "bad",
      targetUser: "",
      problem: "",
      purpose: "",
      goal: "",
      values: "",
      likelyUsers: ["개발자"],
      stage: "prototype",
      evidence: ["README"],
      confidence: "low",
      founderIcpSignals: {
        full_time_solo: { status: "unconfirmed", note: "" },
        pre_revenue: { status: "unconfirmed", note: "" },
        macos: { status: "unconfirmed", note: "" },
        agent_tool: { status: "unconfirmed", note: "" },
        records_intent: { status: "unconfirmed", note: "" },
      },
      suggestedFirstQuestion: "이번 주 가장 먼저 인터뷰할 고객 유형은 누구인가요?",
    },
  );
});

test("normalizeWorkspaceOnboardingHypothesis loads legacy (pre-founder-ICP) data with default signals", () => {
  // Migration: persisted hypothesis from before the founderIcpSignals field existed has no
  // such key. Loading it must fill every signal with the safe `unconfirmed` default while
  // leaving all existing fields untouched.
  const legacy = {
    productName: "Agentic30",
    projectKind: "mac_app",
    targetUser: "전업 1인 개발자",
    problem: "무엇을 만들어야 팔리는지 모른다",
    purpose: "30일 안에 PMF 검증 방향을 좁힌다",
    goal: "첫 유료 고객 증거",
    values: "작게 검증하고 근거 없는 확장을 거절한다",
    likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
    stage: "prototype",
    evidence: ["README"],
    confidence: "medium",
    suggestedFirstQuestion: "이번 주 먼저 만날 전업 1인 개발자 유형은 누구인가요?",
  };
  const normalized = normalizeWorkspaceOnboardingHypothesis(legacy);

  // existing fields are preserved verbatim
  assert.equal(normalized.productName, "Agentic30");
  assert.equal(normalized.targetUser, "전업 1인 개발자");
  assert.equal(normalized.goal, "첫 유료 고객 증거");
  assert.deepEqual(normalized.evidence, ["README"]);
  // new field defaults to the full unconfirmed shape
  assert.deepEqual(normalized.founderIcpSignals, {
    full_time_solo: { status: "unconfirmed", note: "" },
    pre_revenue: { status: "unconfirmed", note: "" },
    macos: { status: "unconfirmed", note: "" },
    agent_tool: { status: "unconfirmed", note: "" },
    records_intent: { status: "unconfirmed", note: "" },
  });
});

test("normalizeWorkspaceOnboardingHypothesis preserves founder-ICP signals (confirmed + note + snake_case)", () => {
  const normalized = normalizeWorkspaceOnboardingHypothesis({
    targetUser: "한국 B2B SaaS 창업자",
    founder_icp_signals: {
      full_time_solo: "confirmed",
      pre_revenue: { status: "confirmed", note: "아직 매출 0" },
      macos: "unconfirmed",
      agent_tool: "Claude/Codex 매일 사용",
      records_intent: { status: "unconfirmed" },
    },
  });

  // targetUser (product ICP) and founderIcpSignals (founder-fit ICP) are independent.
  assert.equal(normalized.targetUser, "한국 B2B SaaS 창업자");
  assert.deepEqual(normalized.founderIcpSignals.full_time_solo, { status: "confirmed", note: "" });
  assert.deepEqual(normalized.founderIcpSignals.pre_revenue, { status: "confirmed", note: "아직 매출 0" });
  assert.deepEqual(normalized.founderIcpSignals.macos, { status: "unconfirmed", note: "" });
  // free-text on an unknown status falls back to unconfirmed but keeps the note.
  assert.deepEqual(normalized.founderIcpSignals.agent_tool, { status: "unconfirmed", note: "Claude/Codex 매일 사용" });
  assert.deepEqual(normalized.founderIcpSignals.records_intent, { status: "unconfirmed", note: "" });
});

test("mergeWorkspaceOnboardingHypotheses unions founder-ICP confirmations across sources", () => {
  const merged = mergeWorkspaceOnboardingHypotheses(
    {
      projectKind: "mac_app",
      confidence: "medium",
      founderIcpSignals: { full_time_solo: "confirmed", agent_tool: { status: "unconfirmed", note: "확인 중" } },
    },
    {
      projectKind: "mac_app",
      confidence: "high",
      founderIcpSignals: { pre_revenue: "confirmed", agent_tool: "confirmed" },
    },
  );
  assert.equal(merged.founderIcpSignals.full_time_solo.status, "confirmed");
  assert.equal(merged.founderIcpSignals.pre_revenue.status, "confirmed");
  assert.equal(merged.founderIcpSignals.agent_tool.status, "confirmed");
  assert.equal(merged.founderIcpSignals.macos.status, "unconfirmed");
});

test("normalizeWorkspaceOnboardingHypothesis accepts provider snake_case fields", () => {
  const hypothesis = normalizeWorkspaceOnboardingHypothesis({
    product_name: "agentic30 Mac",
    project_kind: "mac_app",
    target_user: "전업 1인 개발자",
    problem: "무엇을 만들어야 팔리는지 모른다",
    purpose: "30일 안에 PMF 검증 방향을 좁힌다",
    goal: "첫 유료 고객 증거",
    values: "작게 검증하고 근거 없는 확장을 거절한다",
    likely_users: ["AI 코딩 도구를 쓰는 개발자"],
    stage: "prototype",
    evidence: ["README"],
    confidence: "medium",
    suggested_first_question: "이 가설이 맞나요?",
  });

  assert.equal(hypothesis.productName, "agentic30 Mac");
  assert.equal(hypothesis.projectKind, "mac_app");
  assert.equal(hypothesis.targetUser, "전업 1인 개발자");
  assert.equal(hypothesis.problem, "무엇을 만들어야 팔리는지 모른다");
  assert.equal(hypothesis.purpose, "30일 안에 PMF 검증 방향을 좁힌다");
  assert.equal(hypothesis.goal, "첫 유료 고객 증거");
  assert.equal(hypothesis.values, "작게 검증하고 근거 없는 확장을 거절한다");
  assert.deepEqual(hypothesis.likelyUsers, ["AI 코딩 도구를 쓰는 개발자"]);
  assert.match(hypothesis.suggestedFirstQuestion, /1인 개발자/);
  assert.match(hypothesis.suggestedFirstQuestion, /먼저.*만날|가장 먼저 인터뷰/);
});

test("mergeWorkspaceOnboardingHypotheses combines local and provider evidence", () => {
  const merged = mergeWorkspaceOnboardingHypotheses(
    {
      projectKind: "unknown",
      likelyUsers: ["개발자"],
      stage: "prototype",
      evidence: ["README"],
      confidence: "medium",
    },
    {
      productName: "Agentic30",
      projectKind: "mac_app",
      targetUser: "전업 1인 개발자",
      problem: "무엇을 만들어야 팔리는지 모른다",
      purpose: "30일 안에 PMF 검증 방향을 좁힌다",
      goal: "첫 유료 고객 증거",
      values: "작게 검증하고 근거 없는 확장을 거절한다",
      likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
      stage: "prototype",
      evidence: ["package.json"],
      confidence: "high",
    },
  );

  assert.equal(merged.productName, "Agentic30");
  assert.equal(merged.projectKind, "mac_app");
  assert.equal(merged.targetUser, "전업 1인 개발자");
  assert.equal(merged.goal, "첫 유료 고객 증거");
  assert.equal(merged.values, "작게 검증하고 근거 없는 확장을 거절한다");
  assert.equal(merged.confidence, "high");
  assert.deepEqual(merged.likelyUsers, ["개발자", "AI 코딩 도구를 쓰는 개발자"]);
  assert.deepEqual(merged.evidence, ["README", "package.json"]);
  assert.match(merged.suggestedFirstQuestion, /가장 먼저 인터뷰할 .*1인 개발자.*유형/);
});

test("mergeWorkspaceOnboardingHypotheses keeps concrete kind when highest confidence is unknown", () => {
  const merged = mergeWorkspaceOnboardingHypotheses(
    {
      projectKind: "mac_app",
      likelyUsers: ["개발자"],
      stage: "prototype",
      evidence: ["README"],
      confidence: "medium",
    },
    {
      projectKind: "unknown",
      likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
      stage: "unknown",
      evidence: ["최근 변경"],
      confidence: "high",
    },
  );

  assert.equal(merged.projectKind, "mac_app");
  assert.equal(merged.stage, "prototype");
  assert.equal(merged.confidence, "high");
});

test("deriveWorkspaceOnboardingHypothesisLocally attaches injected agent history", async () => {
  await withTempWorkspace(async (root) => {
    await fs.writeFile(path.join(root, "README.md"), "# Demo\nA tool.\n");
    const agentHistory = {
      providers: ["claude"],
      sessionCount: 2,
      lastActivityAt: "2026-05-29T08:00:00.000Z",
      recentIntents: [{ kstDay: "2026-05-29", provider: "claude", text: "Day-1 요약 카드 구현", ts: 1 }],
      filesTouched: [{ file: "sidecar/index.mjs", count: 3 }],
      commandThemes: [{ cmd: "npm test", count: 5 }],
      perDayKst: [],
      warnings: [],
    };

    const withHistory = await deriveWorkspaceOnboardingHypothesisLocally(root, { agentHistory });
    assert.ok(withHistory.recentWork, "recentWork attached");
    assert.equal(withHistory.recentWork.sessionCount, 2);
    assert.ok(withHistory.evidence.some((item) => /최근 작업/.test(item)), "agent evidence bullet present");

    // Absence is a no-op: shape stays clean (no recentWork key).
    const without = await deriveWorkspaceOnboardingHypothesisLocally(root);
    assert.equal(Object.prototype.hasOwnProperty.call(without, "recentWork"), false);
  });
});

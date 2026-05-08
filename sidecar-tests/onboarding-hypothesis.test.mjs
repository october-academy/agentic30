import test from "node:test";
import assert from "node:assert/strict";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import {
  deriveWorkspaceOnboardingHypothesisLocally,
  mergeWorkspaceOnboardingHypotheses,
  normalizeWorkspaceOnboardingHypothesis,
} from "../sidecar/onboarding-hypothesis.mjs";

async function withTempWorkspace(fn) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-onboarding-hypothesis-"));
  try {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
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
        "# Agentic30",
        "",
        "A macOS app for developers using Codex and Claude coding agents.",
        "**타깃 유저:** 전업 1인 개발자, 수익 0원, macOS 사용자",
        "핵심 가설: 이 유저는 \"만들 줄은 있지만 무엇을 만들어야 팔리는지 모른다\"는 고통을 겪고 있다.",
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
    await fs.writeFile(path.join(root, "docs", "SPEC.md"), "# SPEC\nDeveloper workflow prototype\n");

    const hypothesis = await deriveWorkspaceOnboardingHypothesisLocally(root, {
      docPaths: { spec: "docs/SPEC.md" },
    });

    assert.equal(hypothesis.confidence, "high");
    assert.equal(hypothesis.productName, "Agentic30");
    assert.match(hypothesis.targetUser, /전업 1인 개발자|developers using Codex/i);
    assert.equal(hypothesis.stage, "first_users");
    assert.ok(hypothesis.likelyUsers.includes("AI 코딩 도구를 쓰는 개발자"));
    assert.match(hypothesis.suggestedFirstQuestion, /더 좁은 하위 ICP|가장 좁은 ICP/);
    assert.ok(hypothesis.evidence.some((item) => item.includes("README")));
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
      likelyUsers: ["개발자"],
      stage: "prototype",
      evidence: ["README"],
      confidence: "low",
      suggestedFirstQuestion: "첫 고객을 넓은 범주로 두지 않겠습니다. 이번 주에 검증할 가장 좁은 ICP는 누구인가요?",
    },
  );
});

test("normalizeWorkspaceOnboardingHypothesis accepts provider snake_case fields", () => {
  const hypothesis = normalizeWorkspaceOnboardingHypothesis({
    product_name: "Agentic30",
    project_kind: "mac_app",
    target_user: "전업 1인 개발자",
    problem: "무엇을 만들어야 팔리는지 모른다",
    purpose: "30일 안에 PMF 검증 방향을 좁힌다",
    likely_users: ["AI 코딩 도구를 쓰는 개발자"],
    stage: "prototype",
    evidence: ["README"],
    confidence: "medium",
    suggested_first_question: "이 가설이 맞나요?",
  });

  assert.equal(hypothesis.productName, "Agentic30");
  assert.equal(hypothesis.projectKind, "mac_app");
  assert.equal(hypothesis.targetUser, "전업 1인 개발자");
  assert.equal(hypothesis.problem, "무엇을 만들어야 팔리는지 모른다");
  assert.equal(hypothesis.purpose, "30일 안에 PMF 검증 방향을 좁힌다");
  assert.deepEqual(hypothesis.likelyUsers, ["AI 코딩 도구를 쓰는 개발자"]);
  assert.match(hypothesis.suggestedFirstQuestion, /첫 고객 정의가 아직 넓/);
  assert.match(hypothesis.suggestedFirstQuestion, /더 좁은 ICP/);
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
      likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
      stage: "prototype",
      evidence: ["package.json"],
      confidence: "high",
    },
  );

  assert.equal(merged.productName, "Agentic30");
  assert.equal(merged.projectKind, "mac_app");
  assert.equal(merged.targetUser, "전업 1인 개발자");
  assert.equal(merged.confidence, "high");
  assert.deepEqual(merged.likelyUsers, ["개발자", "AI 코딩 도구를 쓰는 개발자"]);
  assert.deepEqual(merged.evidence, ["README", "package.json"]);
  assert.match(merged.suggestedFirstQuestion, /더 좁은 하위 ICP|가장 좁은 ICP/);
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

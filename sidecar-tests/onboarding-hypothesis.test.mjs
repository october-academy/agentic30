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
    assert.equal(hypothesis.stage, "first_users");
    assert.ok(hypothesis.likelyUsers.includes("AI 코딩 도구를 쓰는 개발자"));
    assert.match(hypothesis.suggestedFirstQuestion, /AI 코딩 도구를 쓰는 개발자/);
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
      projectKind: "bad",
      likelyUsers: ["개발자"],
      stage: "prototype",
      evidence: ["README"],
      confidence: "low",
      suggestedFirstQuestion: "이걸 만들게 된 계기가 된 사람이나 상황이 있었나요? 이번 주에 확인해볼 사람을 하나 골라주세요.",
    },
  );
});

test("normalizeWorkspaceOnboardingHypothesis accepts provider snake_case fields", () => {
  const hypothesis = normalizeWorkspaceOnboardingHypothesis({
    project_kind: "mac_app",
    likely_users: ["AI 코딩 도구를 쓰는 개발자"],
    stage: "prototype",
    evidence: ["README"],
    confidence: "medium",
    suggested_first_question: "이 가설이 맞나요?",
  });

  assert.equal(hypothesis.projectKind, "mac_app");
  assert.deepEqual(hypothesis.likelyUsers, ["AI 코딩 도구를 쓰는 개발자"]);
  assert.equal(hypothesis.suggestedFirstQuestion, "이 가설이 맞나요?");
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
      projectKind: "mac_app",
      likelyUsers: ["AI 코딩 도구를 쓰는 개발자"],
      stage: "prototype",
      evidence: ["package.json"],
      confidence: "high",
    },
  );

  assert.equal(merged.projectKind, "mac_app");
  assert.equal(merged.confidence, "high");
  assert.deepEqual(merged.likelyUsers, ["개발자", "AI 코딩 도구를 쓰는 개발자"]);
  assert.deepEqual(merged.evidence, ["README", "package.json"]);
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

import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";

import {
  composeDay1Opening,
  parseComposedDay1Response,
  buildComposeDay1Prompt,
  COMPOSE_DAY1_SCHEMA_VERSION,
  COMPOSE_DAY1_MIN_CONFIDENCE,
} from "../sidecar/compose-day1-opening.mjs";

async function tempHome() {
  return fs.mkdtemp(path.join(os.tmpdir(), "agentic30-compose-home-"));
}

const SAMPLE_CONTEXT = Object.freeze({
  schemaVersion: 1,
  sourceScanRoot: "/Users/test/myapp",
  confidence: "medium",
  productName: "MyApp",
  targetUser: "1인 개발자",
  problem: null,
  suggestedFirstQuestion: null,
  foundDocCount: 1,
  missingExpectedDocs: ["spec", "goal"],
  localDiscovery: {
    schemaVersion: 1,
    git: { isGitRepo: true, firstCommitAt: "2026-04-01T00:00:00Z", last7DaysCommitCount: 7, dirty: false, branch: "main" },
    project: { stacks: ["node"], hasReadme: true, manifestPaths: ["package.json"] },
    runway: { projectAgeDays: 45, recentlyActive: true },
  },
});

const SAMPLE_DETERMINISTIC = Object.freeze({
  day1_yesterday: "최근 7일 코드 7커밋, 정작 ICP·SPEC는 비어 있어.",
  day1_today: "통증 1개로 SPEC.md v0를 박아.",
  day1_question: "그 통증, 어제 누가 어떤 행동으로 보여줬어?",
});

test("falls back to deterministic when no queryImpl is provided", async () => {
  const homeDir = await tempHome();
  try {
    const result = await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
    });
    assert.equal(result.schemaVersion, COMPOSE_DAY1_SCHEMA_VERSION);
    assert.equal(result.source, "deterministic");
    assert.equal(result.fellBackToDeterministic, true);
    assert.equal(result.yesterday, SAMPLE_DETERMINISTIC.day1_yesterday);
    assert.equal(result.today, SAMPLE_DETERMINISTIC.day1_today);
    assert.equal(result.question, SAMPLE_DETERMINISTIC.day1_question);
    assert.equal(result.webUsed, false);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("uses LLM output when queryImpl returns a valid JSON string above the confidence floor", async () => {
  const homeDir = await tempHome();
  try {
    const llmJson = JSON.stringify({
      yesterday: "ICP만 있고 SPEC·GOAL은 비어. 최근 7일 7커밋이면서 고객 정의가 없네.",
      today: "통증 1개로 SPEC.md v0를 박아. 통증 2개 이상이면 실패야.",
      question: "어제 결제까지 갔던 1명이 누구야? 가정 말고 행동으로.",
      evidenceRefs: [{ path: "package.json", reason: "최근 7일 가장 많이 수정" }],
      confidence: 0.8,
    });
    const result = await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
      queryImpl: async () => llmJson,
    });
    assert.equal(result.source, "llm");
    assert.equal(result.fellBackToDeterministic, false);
    assert.equal(result.confidence, 0.8);
    assert.match(result.yesterday, /고객 정의/);
    assert.equal(result.evidenceRefs[0].path, "package.json");
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("falls back to deterministic when LLM returns malformed JSON", async () => {
  const homeDir = await tempHome();
  try {
    const result = await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
      queryImpl: async () => "{not valid json",
    });
    assert.equal(result.source, "deterministic");
    assert.equal(result.fellBackToDeterministic, true);
    assert.equal(result.yesterday, SAMPLE_DETERMINISTIC.day1_yesterday);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("falls back to deterministic when LLM confidence is below the floor", async () => {
  const homeDir = await tempHome();
  try {
    const result = await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
      queryImpl: async () => JSON.stringify({
        yesterday: "x", today: "y", question: "z",
        evidenceRefs: [], confidence: COMPOSE_DAY1_MIN_CONFIDENCE - 0.05,
      }),
    });
    assert.equal(result.source, "deterministic");
    assert.equal(result.fellBackToDeterministic, true);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("falls back when LLM throws (timeout, abort, etc.)", async () => {
  const homeDir = await tempHome();
  try {
    const result = await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
      queryImpl: async () => { throw new Error("provider unavailable"); },
    });
    assert.equal(result.source, "deterministic");
    assert.equal(result.fellBackToDeterministic, true);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("LLM result is cached and re-used on next call inside TTL", async () => {
  const homeDir = await tempHome();
  let calls = 0;
  const stub = async () => {
    calls += 1;
    return JSON.stringify({
      yesterday: "y", today: "t", question: "q",
      evidenceRefs: [], confidence: 0.7,
    });
  };
  try {
    await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
      queryImpl: stub,
    });
    const second = await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
      queryImpl: stub,
    });
    assert.equal(calls, 1, "stub should only be invoked on the first call");
    assert.equal(second.source, "cache");
    assert.equal(second.yesterday, "y");
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

test("parseComposedDay1Response rejects missing required fields", () => {
  assert.equal(parseComposedDay1Response("null"), null);
  assert.equal(parseComposedDay1Response('{"yesterday":"a"}'), null);
  assert.equal(parseComposedDay1Response('{"yesterday":"","today":"t","question":"q"}'), null);
});

test("buildComposeDay1Prompt embeds ground truth fields verbatim", () => {
  const prompt = buildComposeDay1Prompt({
    context: SAMPLE_CONTEXT,
    onboarding: { role: "developer", projectStage: "building" },
    deterministic: SAMPLE_DETERMINISTIC,
  });
  assert.match(prompt, /workspace_root: \/Users\/test\/myapp/);
  assert.match(prompt, /onboarding_role: developer/);
  assert.match(prompt, /git_last_7_days_commit_count: 7/);
  assert.match(prompt, /yesterday: 최근 7일 코드/);
  // Schema instructions are present so the LLM emits the right shape.
  assert.match(prompt, /single JSON object/);
});

test("LLM call respects timeoutMs and falls back deterministically", async () => {
  const homeDir = await tempHome();
  try {
    const slowStub = () => new Promise((resolve) => setTimeout(() => resolve("{}"), 5000));
    const result = await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
      queryImpl: slowStub,
      timeoutMs: 50,
    });
    assert.equal(result.source, "deterministic");
    assert.equal(result.fellBackToDeterministic, true);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

// PR3 (P1b): timeout must actually cancel the SDK call, not just discard its
// future result. Asserts that the abortController on the options is aborted.
test("timeout aborts the in-flight queryImpl via the SDK abortController", async () => {
  const homeDir = await tempHome();
  try {
    let capturedController = null;
    const slowStub = (args) => {
      capturedController = args?.options?.abortController ?? null;
      return new Promise((resolve) => setTimeout(() => resolve("{}"), 5000));
    };
    await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
      queryImpl: slowStub,
      timeoutMs: 30,
    });
    assert.ok(capturedController, "queryImpl must receive an abortController");
    assert.equal(capturedController.signal.aborted, true, "timeout must abort the signal");
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

// PR3 (P1b): the SDK `tools:` option must be passed alongside allowedTools so
// Bash/Edit/Write are not in the model's available surface in the first place.
test("queryImpl receives both tools and allowedTools options", async () => {
  const homeDir = await tempHome();
  try {
    let optionsSeen = null;
    const stub = (args) => {
      optionsSeen = args?.options || null;
      return JSON.stringify({
        yesterday: "y", today: "t", question: "q",
        evidenceRefs: [], confidence: 0.8,
      });
    };
    await composeDay1Opening({
      workspaceRoot: SAMPLE_CONTEXT.sourceScanRoot,
      context: SAMPLE_CONTEXT,
      deterministicVariables: SAMPLE_DETERMINISTIC,
      homeDir,
      queryImpl: stub,
    });
    assert.ok(Array.isArray(optionsSeen?.tools), "options.tools must be an array");
    assert.ok(Array.isArray(optionsSeen?.allowedTools), "options.allowedTools must be an array");
    // Same list when web is OFF (default).
    assert.deepEqual(optionsSeen.tools, ["Read", "Glob", "Grep"]);
    assert.deepEqual(optionsSeen.allowedTools, ["Read", "Glob", "Grep"]);
  } finally {
    await fs.rm(homeDir, { recursive: true, force: true });
  }
});

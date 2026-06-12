import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  DOGFOOD_FAILURE_CLASSES,
  DOGFOOD_VERDICTS,
  DOGFOOD_JUDGE_EXECUTION_MODE,
  buildJudgePrompt,
  compareAgainstBaseline,
  dogfoodVerdict,
  judgeDogfoodRun,
  loadReferenceDocs,
  loadScenarioFixtures,
  parseJudgeJson,
  summarizeSmokeRun,
} from "../sidecar-evals/dogfood-judge.mjs";
import {
  classifyFailureClasses,
  evaluateRunGate,
  renderMarkdownReport,
  runDogfoodSimulation,
  validateLiveScenarioPrompt,
} from "../sidecar-evals/dogfood-simulation.mjs";
import { summarizeDogfoodResults } from "../sidecar-evals/dogfood-summary.mjs";
import { compareDogfoodResults } from "../sidecar-evals/dogfood-compare.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../../..");

test("dogfood scenario fixtures load with stable ids and prompts", async () => {
  const scenarios = await loadScenarioFixtures();
  assert.deepEqual(
    scenarios.map((scenario) => scenario.id),
    [
      "first-run-icp-fit",
      "workspace-docs-scan",
      "day1-coaching-action",
      "bip-mission-partial-setup",
      "structured-decision-card",
      "mission-completion",
      "empty-startup-first-run",
      "empty-builder-first-run",
      "seeded-startup-day1",
      "seeded-builder-shareable-demo",
      "partial-startup-recovery",
      "partial-builder-recovery",
      "running-startup-proof-loop",
      "running-builder-bip-loop",
      "complete-startup-verdict",
      "complete-builder-retro",
      "gate-blocked-day-entry",
    ],
  );
  assert.ok(scenarios.every((scenario) => scenario.prompt.length > 0));
  assert.ok(scenarios.every((scenario) => ["empty", "strategy_seeded", "partial_setup", "running", "complete"].includes(scenario.repo_stage)));
  assert.ok(scenarios.every((scenario) => ["startup", "builder"].includes(scenario.intent_mode)));
  assert.ok(scenarios.every((scenario) => scenario.expected_visible_outcome));
  assert.ok(scenarios.every((scenario) => Array.isArray(scenario.fixture.docs)));
});

test("dogfood judge prompt separates context from observed scoring evidence", async () => {
  const [scenario] = await loadScenarioFixtures();
  const referenceDocs = await loadReferenceDocs(repoRoot);
  const prompt = buildJudgePrompt({
    scenario,
    referenceDocs,
    observed: {
      assistantMessages: ["오늘 할 일 하나만 정리합니다."],
      eventTypes: ["session_updated"],
      latency_ms: { first_response: 100, final_response: 200 },
    },
  });

  assert.match(prompt, /Agentic30 Mac dogfood judge/);
  assert.match(prompt, /Do not award points/);
  assert.match(prompt, /Observed app output\/actions to score/);
  assert.match(prompt, /icp_fit/);
  assert.match(prompt, /values_delivery/);
  assert.match(prompt, /GOAL\.md/);
  assert.match(prompt, /User prompt context/);
});

test("dogfood judge parses fenced strict JSON", () => {
  const parsed = parseJudgeJson(`\`\`\`json
{
  "scores": {
    "icp_fit": 9,
    "values_delivery": 8,
    "goal_alignment": 8,
    "actionability": 9,
    "evidence_use": 8,
    "ux_friction": 7
  },
  "overall": 8.2,
  "judge_summary": "useful",
  "regressions": []
}
\`\`\``);

  assert.equal(parsed.overall, 8.2);
  assert.equal(parsed.reported_overall, 8.2);
  assert.equal(parsed.scores.icp_fit, 9);
  assert.deepEqual(parsed.regressions, []);
});

test("dogfood judge computes overall from scores and preserves reported overall", () => {
  const parsed = parseJudgeJson(JSON.stringify({
    scores: {
      icp_fit: 9,
      values_delivery: 8,
      goal_alignment: 8,
      actionability: 9,
      evidence_use: 8,
      ux_friction: 9,
    },
    overall: "pass",
    judge_summary: "Numeric score object is the source of truth.",
    regressions: [],
  }));

  assert.equal(parsed.overall, 8.5);
  assert.equal(parsed.reported_overall, "pass");
});

test("dogfood judge parser rejects malformed or incomplete judge output", () => {
  assert.throws(() => parseJudgeJson("{not json"), /JSON/);
  assert.throws(() => parseJudgeJson(JSON.stringify({
    scores: {
      icp_fit: 9,
      values_delivery: 8,
      goal_alignment: 8,
      actionability: 9,
      evidence_use: 8,
    },
    overall: 8.4,
    judge_summary: "missing ux score",
    regressions: [],
  })), /missing score key: ux_friction/);
});

test("live scenario prompt realism check rejects harness control markers", () => {
  assert.equal(validateLiveScenarioPrompt({
    id: "natural-day1",
    prompt: "Day 1 시작이야. docs/ICP.md 기준으로 오늘 행동 1개와 proof target을 정해줘.",
  }), true);
  assert.throws(() => validateLiveScenarioPrompt({
    id: "marker-day1",
    prompt: "DAY1_ICP_TURN_1: Day 1 시작",
  }), /test-only control marker/);
});

test("failure classification separates product, judge, and experiment bugs", () => {
  assert.deepEqual(classifyFailureClasses({
    verdict: DOGFOOD_VERDICTS.JUDGE_FAIL,
    judge_status: "error",
    regressions: ["Judge unavailable or invalid: response was not strict JSON"],
  }), [DOGFOOD_FAILURE_CLASSES.JUDGE_CONTRACT_BUG]);

  assert.deepEqual(classifyFailureClasses({
    verdict: DOGFOOD_VERDICTS.SMOKE_FAIL,
    smoke: { passed: false },
    regressions: ["assistant_output_observed failed"],
  }), [DOGFOOD_FAILURE_CLASSES.PRODUCT_BUG]);

  assert.deepEqual(classifyFailureClasses({
    verdict: DOGFOOD_VERDICTS.JUDGE_FAIL,
    regressions: ["Live prompt contains DAY1_ICP_TURN_ marker"],
  }), [DOGFOOD_FAILURE_CLASSES.EXPERIMENT_DESIGN_BUG]);
});

test("proof target extraction only accepts line-start labels", () => {
  const baseScenario = {
    id: "seeded-startup-day1",
    repo_stage: "strategy_seeded",
    intent_mode: "startup",
    title: "Seeded startup Day 1",
    goal: "Proof target",
    prompt: "Day 1",
    expected_visible_outcome: {
      must_include: [],
      must_not_include: [],
      requires_one_next_action: false,
      requires_proof_target: true,
    },
  };
  const unanchored = summarizeSmokeRun({
    scenario: baseScenario,
    observed: {
      assistantMessages: ["SPEC.md는 proof baseline과 다음 proof target을 판단 기준으로 둡니다."],
      latency_ms: { first_visible_value: 100, final_response: 200 },
    },
    events: [{ type: "session_updated" }],
    latency: { first_visible_value: 100, final_response: 200 },
  });
  const anchored = summarizeSmokeRun({
    scenario: baseScenario,
    observed: {
      assistantMessages: ["다음 액션: 고객 1명에게 질문합니다.\n증거 목표: Threads URL 1개"],
      latency_ms: { first_visible_value: 100, final_response: 200 },
    },
    events: [{ type: "session_updated" }],
    latency: { first_visible_value: 100, final_response: 200 },
  });

  assert.equal(unanchored.verdict, DOGFOOD_VERDICTS.SMOKE_FAIL);
  assert.match(unanchored.regressions.join("\n"), /proof_target_observed failed/);
  assert.equal(anchored.verdict, DOGFOOD_VERDICTS.SMOKE_PASS);
});

test("event-only smoke never receives a product score", () => {
  const result = summarizeSmokeRun({
    scenario: {
      id: "first-run-icp-fit",
      title: "First-run ICP fit check",
      goal: "Confirm ICP",
      prompt: "나는 전업 1인 개발자이고 수익은 0원이다.",
    },
    observed: {
      assistantMessages: [],
      eventTypes: ["session_updated"],
      latency_ms: { first_response: 100, final_response: 200 },
    },
    events: [{ type: "session_updated" }],
    latency: { first_response: 100, final_response: 200 },
  });

  assert.equal(result.overall, null);
  assert.equal(result.scores, null);
  assert.equal(result.judge_status, "skipped");
  assert.notEqual(result.verdict, DOGFOOD_VERDICTS.JUDGE_PASS);
});

test("generic assistant plus expected event is smoke-only and cannot pass live judge gate", () => {
  const smoke = summarizeSmokeRun({
    scenario: {
      id: "first-run-icp-fit",
      title: "First-run ICP fit check",
      goal: "Confirm ICP",
      prompt: "나는 전업 1인 개발자이고 수익은 0원이다.",
    },
    observed: {
      assistantMessages: ["ok"],
      eventTypes: ["session_updated"],
      latency_ms: { first_response: 100, final_response: 200 },
    },
    events: [{ type: "session_updated" }],
    latency: { first_response: 100, final_response: 200 },
  });
  const lowJudge = parseJudgeJson(JSON.stringify({
    scores: {
      icp_fit: 2,
      values_delivery: 1,
      goal_alignment: 1,
      actionability: 1,
      evidence_use: 0,
      ux_friction: 8,
    },
    overall: 2.2,
    judge_summary: "Generic answer did not deliver product value.",
    regressions: ["assistant output was generic"],
  }));

  assert.equal(smoke.verdict, DOGFOOD_VERDICTS.SMOKE_PASS);
  assert.equal(smoke.overall, null);
  assert.equal(dogfoodVerdict({
    mode: "live",
    smokePassed: smoke.smoke.passed,
    judgeStatus: "completed",
    overall: lowJudge.overall,
    regressions: lowJudge.regressions,
  }), DOGFOOD_VERDICTS.JUDGE_FAIL);
});

test("prompt-only keyword matches do not raise a product score", () => {
  const result = summarizeSmokeRun({
    scenario: {
      id: "day1-coaching-action",
      title: "Day 1 coaching",
      goal: "Move to one action",
      prompt: "Day 1 전업 1인 개발자 수익 0원 Codex macOS Threads Sheet BIP",
    },
    observed: {
      assistantMessages: [],
      eventTypes: [],
      latency_ms: { first_response: 0, final_response: 0 },
    },
    events: [],
    latency: { first_response: 0, final_response: 0 },
  });

  assert.equal(result.overall, null);
  assert.equal(result.scores, null);
  assert.equal(result.verdict, DOGFOOD_VERDICTS.SMOKE_FAIL);
});

test("empty visible output cannot pass product-value smoke checks", () => {
  const result = summarizeSmokeRun({
    scenario: {
      id: "seeded-startup-day1",
      repo_stage: "strategy_seeded",
      intent_mode: "startup",
      title: "Seeded startup Day 1",
      goal: "One action",
      prompt: "Day 1 proof target",
      expected_visible_outcome: {
        must_include: ["Day 1"],
        must_not_include: [],
        requires_one_next_action: true,
        requires_proof_target: true,
      },
    },
    observed: {
      visible_outputs: {
        assistant_messages: [],
        recommended_action: "",
        proof_target: "",
      },
      assistantMessages: [],
      eventTypes: ["session_updated"],
      latency_ms: { first_visible_value: 100, final_response: 200 },
    },
    events: [{ type: "session_updated" }],
    latency: { first_visible_value: 100, final_response: 200 },
  });

  assert.equal(result.overall, null);
  assert.equal(result.verdict, DOGFOOD_VERDICTS.SMOKE_FAIL);
  assert.match(result.regressions.join("\n"), /assistant_output_observed failed/);
  assert.match(result.regressions.join("\n"), /proof_target_observed failed/);
});

test("empty proof target mission cannot pass expected visible outcome gate", () => {
  const result = summarizeSmokeRun({
    scenario: {
      id: "bip-mission-partial-setup",
      repo_stage: "partial_setup",
      intent_mode: "startup",
      title: "BIP mission",
      goal: "Mission choices",
      prompt: "mission",
      expected_visible_outcome: {
        must_include: [],
        must_not_include: [],
        requires_one_next_action: true,
        requires_proof_target: true,
      },
    },
    observed: {
      assistantMessages: ["후보 3개를 만들었습니다. 다음 액션: 첫 후보를 고르세요."],
      visible_outputs: {
        assistant_messages: ["후보 3개를 만들었습니다. 다음 액션: 첫 후보를 고르세요."],
        recommended_action: "첫 후보를 고르세요.",
        proof_target: "",
      },
      missionChoices: [
        { title: "A", proofTarget: "" },
        { title: "B", proofTarget: "" },
        { title: "C", proofTarget: "" },
      ],
      latency_ms: { first_visible_value: 100, final_response: 200 },
    },
    events: [{ type: "bip_coach_generation_completed" }],
    latency: { first_visible_value: 100, final_response: 200 },
  });

  assert.equal(result.verdict, DOGFOOD_VERDICTS.SMOKE_FAIL);
  assert.match(result.regressions.join("\n"), /proof_target_observed failed/);
});

test("latency extraction preserves time to visible value", () => {
  const result = summarizeSmokeRun({
    scenario: {
      id: "generic",
      repo_stage: "running",
      intent_mode: "builder",
      title: "Generic",
      goal: "Latency",
      prompt: "latency",
      expected_visible_outcome: {
        must_include: [],
        must_not_include: [],
        requires_one_next_action: false,
        requires_proof_target: false,
      },
    },
    observed: {
      assistantMessages: ["다음 액션: demo를 공유하세요."],
      latency_ms: { first_event: 50, first_visible_value: 450, final_response: 900 },
    },
    events: [{ type: "session_updated" }],
    latency: { first_event: 50, first_visible_value: 450, final_response: 900 },
  });

  assert.equal(result.latency_ms.first_event, 50);
  assert.equal(result.latency_ms.first_visible_value, 450);
  assert.equal(result.latency_ms.first_visible_value_ms, 450);
  assert.equal(result.latency_ms.final_response, 900);
});

test("high-quality parsed judge result can pass the live product gate", () => {
  const parsed = parseJudgeJson(JSON.stringify({
    scores: {
      icp_fit: 9,
      values_delivery: 9,
      goal_alignment: 9,
      actionability: 9,
      evidence_use: 8,
      ux_friction: 8,
    },
    overall: 8.7,
    judge_summary: "Observed answer grounded Day 1 in docs and ended with one concrete proof action.",
    regressions: [],
  }));

  assert.equal(dogfoodVerdict({
    mode: "live",
    smokePassed: true,
    judgeStatus: "completed",
    overall: parsed.overall,
    regressions: parsed.regressions,
  }), DOGFOOD_VERDICTS.JUDGE_PASS);
});

test("live judge uses the Codex/Claude SDK read-only execution lane", async () => {
  let providerCall;
  const result = await judgeDogfoodRun({
    scenario: {
      id: "day1",
      title: "Day 1",
      goal: "Judge SDK path",
      prompt: "context only",
    },
    observed: {
      assistantMessages: ["오늘 고객 한 명에게 인터뷰 요청을 보냅니다."],
      eventTypes: ["session_updated"],
      latency_ms: { first_response: 100, final_response: 200 },
    },
    provider: "codex",
    runProvider: async (args) => {
      providerCall = args;
      args.onTextReplace(JSON.stringify({
        scores: {
          icp_fit: 8,
          values_delivery: 8,
          goal_alignment: 8,
          actionability: 9,
          evidence_use: 8,
          ux_friction: 8,
        },
        overall: 8.2,
        judge_summary: "SDK judge path returned strict JSON.",
        regressions: [],
      }));
      return { runtime: {} };
    },
  });

  assert.equal(providerCall.executionMode, DOGFOOD_JUDGE_EXECUTION_MODE);
  assert.equal(providerCall.provider, "codex");
  assert.match(providerCall.prompt, /Observed app output\/actions to score/);
  assert.equal(result.judge_status, "completed");
  assert.equal(result.overall, 8.2);
});

test("dogfood baseline comparison only applies to live judge scores", () => {
  const [smokeOnly] = compareAgainstBaseline(
    [{ scenario: "day1", overall: null, regressions: [] }],
    [{ scenario: "day1", overall: 8.7 }],
  );
  assert.equal(smokeOnly.delta, null);
  assert.deepEqual(smokeOnly.regressions, []);

  const [judged] = compareAgainstBaseline(
    [{ scenario: "day1", overall: 8.1, regressions: [] }],
    [{ scenario: "day1", overall: 8.7 }],
  );
  assert.equal(judged.delta, -0.6);
  assert.match(judged.regressions.join("\n"), /Regressed 0.6\/10/);
});

test("dogfood summary and compare calculate verdict and latency deltas", () => {
  const before = [
    { scenario: "day1", verdict: "JUDGE_PASS", overall: 8.4, latency_ms: { first_visible_value: 900 }, regressions: [] },
  ];
  const after = [
    { scenario: "day1", verdict: "JUDGE_PASS", overall: 8.8, latency_ms: { first_visible_value: 500 }, regressions: [] },
  ];

  assert.deepEqual(summarizeDogfoodResults(after), {
    count: 1,
    verdicts: { JUDGE_PASS: 1 },
    avg_overall: 8.8,
    avg_visible_value_ms: 500,
    failures: [],
  });
  assert.deepEqual(compareDogfoodResults(before, after), [{
    scenario: "day1",
    verdict_before: "JUDGE_PASS",
    verdict_after: "JUDGE_PASS",
    overall_before: 8.4,
    overall_after: 8.8,
    overall_delta: 0.4,
    visible_ms_before: 900,
    visible_ms_after: 500,
    visible_ms_delta: -400,
    regressions: [],
  }]);
});

test("dogfood run gate preserves judge verdict while exposing decision readiness warnings", () => {
  const runGate = evaluateRunGate([
    liveResult({
      scenario: "mission-completion",
      scores: {
        icp_fit: 5,
        values_delivery: 8,
        goal_alignment: 8,
        actionability: 8,
        evidence_use: 8,
        ux_friction: 9,
      },
      overall: 8.1,
      observed: {
        visible_outputs: {
          assistant_messages: ["완료 확인\nThreads: https://threads.net/@october/post/proof\nSheet note: recorded\n다음 증거 목표: 다음 proof"],
          recommended_action: "다음 반응을 Sheet에 기록합니다.",
          proof_target: "다음 proof",
        },
        completionProof: {
          completed: true,
          threadsUrl: "https://threads.net/@october/post/proof",
          sheetRowNote: "recorded",
        },
      },
    }),
  ], "live");

  assert.equal(runGate.verdict, DOGFOOD_VERDICTS.JUDGE_PASS);
  assert.equal(runGate.passed, true);
  assert.equal(runGate.decision_ready.status, "warn");
  assert.match(runGate.decision_ready.reasons.join("\n"), /mission-completion: icp_fit 5\/10 below warning floor 7/);
});

test("decision readiness applies ICP as blocking only for ICP-core scenarios", () => {
  const coreIcpGate = evaluateRunGate([
    liveResult({
      scenario: "first-run-icp-fit",
      scores: {
        icp_fit: 5,
        values_delivery: 8,
        goal_alignment: 8,
        actionability: 8,
        evidence_use: 8,
        ux_friction: 9,
      },
      overall: 8.1,
    }),
  ], "live");
  const structuredGate = evaluateRunGate([
    liveResult({
      scenario: "structured-decision-card",
      scores: {
        icp_fit: 5,
        values_delivery: 8,
        goal_alignment: 8,
        actionability: 8,
        evidence_use: 8,
        ux_friction: 9,
      },
      overall: 8.1,
      observed: {
        structuredInputAccepted: true,
        visible_outputs: {
          assistant_messages: ["선택 확인: 프로젝트 전략 문서 만들기\n다음 액션: 화면 1개를 공개하세요."],
          recommended_action: "화면 1개를 공개하세요.",
          proof_target: "",
        },
      },
    }),
  ], "live");

  assert.equal(coreIcpGate.verdict, DOGFOOD_VERDICTS.JUDGE_PASS);
  assert.equal(coreIcpGate.decision_ready.status, "fail");
  assert.match(coreIcpGate.decision_ready.reasons.join("\n"), /first-run-icp-fit: icp_fit 5\/10 below required floor 7/);
  assert.equal(structuredGate.verdict, DOGFOOD_VERDICTS.JUDGE_PASS);
  assert.equal(structuredGate.decision_ready.status, "pass");
  assert.doesNotMatch(structuredGate.decision_ready.reasons.join("\n"), /icp_fit/);
});

test("decision readiness fails missing contract evidence without replacing the top-level verdict", () => {
  const runGate = evaluateRunGate([
    liveResult({
      scenario: "workspace-docs-scan",
      scores: {
        icp_fit: 9,
        values_delivery: 6,
        goal_alignment: 7,
        actionability: 7,
        evidence_use: 8,
        ux_friction: 10,
      },
      overall: 8,
      observed: {
        visible_outputs: {
          assistant_messages: ["로컬 workspace 문서를 확인했습니다."],
          recommended_action: "문서 기준으로 이어가세요.",
          proof_target: "",
          doc_paths_answered: [],
        },
        workspaceScan: {
          icp: false,
        },
      },
    }),
  ], "live");

  assert.equal(runGate.verdict, DOGFOOD_VERDICTS.JUDGE_PASS);
  assert.equal(runGate.passed, true);
  assert.equal(runGate.decision_ready.status, "fail");
  assert.match(runGate.decision_ready.reasons.join("\n"), /workspace-docs-scan: missing required evidence docs_path/);
});

test("dogfood report renders machine-backed project decision readiness", () => {
  const result = liveResult({
    scenario: "complete-builder-retro",
    scores: {
      icp_fit: 8,
      values_delivery: 8,
      goal_alignment: 8,
      actionability: 9,
      evidence_use: 6,
      ux_friction: 9,
    },
    overall: 8,
    observed: {
      visible_outputs: {
        assistant_messages: ["Builder retro: 완료한 demo loop를 정리합니다.\n다음 액션: artifact를 Threads에 올리세요.\n증거 목표: retro Threads URL 1개"],
        recommended_action: "artifact를 Threads에 올리세요.",
        proof_target: "retro Threads URL 1개",
      },
    },
  });
  const runGate = evaluateRunGate([result], "live");
  const report = renderMarkdownReport([result], "live", runGate);

  assert.match(report, /Run verdict: JUDGE_PASS/);
  assert.match(report, /Project decision readiness: FAIL/);
  assert.match(report, /## Project Decision Readiness/);
  assert.match(report, /complete-builder-retro: evidence_use 6\/10 below required floor 7/);
  assert.match(report, /PROJECT_DECISION_READY/);
});

test("smoke-mode dogfood gate keeps smoke verdict and marks decision readiness unevaluated", () => {
  const runGate = evaluateRunGate([
    {
      scenario: "first-run-icp-fit",
      verdict: DOGFOOD_VERDICTS.SMOKE_PASS,
      regressions: [],
    },
  ], "stub");

  assert.equal(runGate.verdict, DOGFOOD_VERDICTS.SMOKE_PASS);
  assert.equal(runGate.passed, true);
  assert.equal(runGate.decision_ready.status, "warn");
  assert.match(runGate.decision_ready.reasons.join("\n"), /Product decision readiness was not evaluated because live judge mode did not run/);
});

test("dogfood simulation default mode reports smoke pass, not product judge pass", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-dogfood-eval-"));
  try {
    const result = await runDogfoodSimulation({
      outputDir,
      scenarioIds: [
        "first-run-icp-fit",
        "bip-mission-partial-setup",
        "structured-decision-card",
        "mission-completion",
      ],
    });

    assert.equal(result.passed, true);
    assert.equal(result.results.length, 4);
    assert.ok(result.results.every((entry) => entry.verdict === DOGFOOD_VERDICTS.SMOKE_PASS));
    assert.ok(result.results.every((entry) => entry.overall === null));
    assert.ok(result.results.every((entry) => entry.judge_status === "skipped"));
    assert.ok((await fs.stat(result.jsonlPath)).isFile());
    assert.match(await fs.readFile(result.reportPath, "utf8"), /VERDICT: SMOKE_PASS/);
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

function liveResult({
  scenario,
  scores,
  overall,
  observed = {},
  expected_visible_outcome = {},
  regressions = [],
} = {}) {
  return {
    scenario,
    repo_stage: "strategy_seeded",
    intent_mode: "startup",
    expected_visible_outcome,
    mode: "live",
    scores,
    overall,
    smoke: { passed: true, failures: [] },
    judge_status: "completed",
    verdict: DOGFOOD_VERDICTS.JUDGE_PASS,
    regressions,
    observed: {
      visible_outputs: {
        assistant_messages: ["진단: ICP 조건을 확인했습니다.\n다음 액션: 고객 1명에게 질문합니다.\n증거 목표: Threads URL 1개"],
        recommended_action: "고객 1명에게 질문합니다.",
        proof_target: "Threads URL 1개",
        doc_paths_answered: ["docs/ICP.md"],
      },
      workspaceScan: { icp: true, values: true, goal: true, spec: true },
      ...observed,
    },
    latency_ms: {
      first_visible_value_ms: 100,
      operation_complete_ms: 200,
    },
  };
}

test("workspace docs scan uses the temporary fixture workspace", async () => {
  const outputDir = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-dogfood-eval-"));
  try {
    const result = await runDogfoodSimulation({
      outputDir,
      scenarioIds: ["workspace-docs-scan"],
    });
    const [entry] = result.results;
    const observed = JSON.parse(await fs.readFile(entry.artifacts.observed_json, "utf8"));

    assert.equal(result.passed, true);
    assert.equal(entry.verdict, DOGFOOD_VERDICTS.SMOKE_PASS);
    assert.ok(entry.latency_ms.first_visible_value_ms < 500);
    assert.match(observed.workspaceScan.scanRoot, /agentic30-dogfood-workspace-/);
    assert.notEqual(observed.workspaceScan.scanRoot, repoRoot);
    assert.deepEqual({
      icp: observed.workspaceScan.icp,
      values: observed.workspaceScan.values,
      goal: observed.workspaceScan.goal,
      spec: observed.workspaceScan.spec,
    }, {
      icp: true,
      values: true,
      goal: true,
      spec: true,
    });
  } finally {
    await fs.rm(outputDir, { recursive: true, force: true });
  }
});

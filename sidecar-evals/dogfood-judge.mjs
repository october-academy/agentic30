import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runProviderStream } from "../sidecar/provider-runner.mjs";

export const SCORE_KEYS = Object.freeze([
  "icp_fit",
  "values_delivery",
  "goal_alignment",
  "actionability",
  "evidence_use",
  "ux_friction",
]);

export const DOGFOOD_VERDICTS = Object.freeze({
  SMOKE_PASS: "SMOKE_PASS",
  SMOKE_FAIL: "SMOKE_FAIL",
  JUDGE_PASS: "JUDGE_PASS",
  JUDGE_FAIL: "JUDGE_FAIL",
});
export const DOGFOOD_FAILURE_CLASSES = Object.freeze({
  EVAL_BUG: "EVAL_BUG",
  PRODUCT_BUG: "PRODUCT_BUG",
  JUDGE_CONTRACT_BUG: "JUDGE_CONTRACT_BUG",
  EXPERIMENT_DESIGN_BUG: "EXPERIMENT_DESIGN_BUG",
});
export const DOGFOOD_JUDGE_EXECUTION_MODE = "judge_read_only";
export const REPO_STAGES = Object.freeze(["empty", "strategy_seeded", "partial_setup", "running", "complete"]);
export const INTENT_MODES = Object.freeze(["startup", "builder"]);
const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

export async function loadScenarioFixtures(fixturesPath = defaultFixturesPath()) {
  const raw = await fs.readFile(fixturesPath, "utf8");
  const parsed = JSON.parse(raw);
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw new Error("Dogfood scenario fixture must be a non-empty array.");
  }
  return parsed.map(normalizeScenario);
}

export async function loadReferenceDocs(repoRoot) {
  const referenceRoot = await resolveReferenceRoot(repoRoot);
  const docs = {};
  for (const name of ["ICP.md", "VALUES.md", "GOAL.md", "SPEC.md"]) {
    const filePath = path.join(referenceRoot, "docs", name);
    docs[name] = await fs.readFile(filePath, "utf8");
  }
  return docs;
}

async function resolveReferenceRoot(repoRoot = packageRoot) {
  const candidates = [
    repoRoot,
    packageRoot,
    path.resolve(packageRoot, "../../.."),
  ];
  for (const candidate of candidates) {
    if (await hasReferenceDocs(candidate)) {
      return candidate;
    }
  }
  throw new Error(`Reference docs not found under candidates: ${candidates.join(", ")}`);
}

async function hasReferenceDocs(root) {
  try {
    await Promise.all(["ICP.md", "VALUES.md", "GOAL.md", "SPEC.md"].map((name) => (
      fs.access(path.join(root, "docs", name))
    )));
    return true;
  } catch {
    return false;
  }
}

export function buildJudgePrompt({ scenario, referenceDocs, observed }) {
  return [
    "You are the Agentic30 Mac dogfood judge.",
    "Your task is to score only the observed app output and observed app actions.",
    "Do not award points for words that appear only in the user prompt, fixture title, fixture goal, scenario id, or reference documents.",
    "Use the user prompt and reference documents only as criteria/context for judging whether the observed app behavior satisfies the task.",
    "Return strict JSON only with keys: scores, overall, judge_summary, regressions.",
    "",
    "Rubric, each 0-10:",
    "- icp_fit: observed behavior clarifies whether the user is the target full-time solo macOS/Codex developer with zero revenue and interview willingness.",
    "- values_delivery: observed behavior expresses constraint, customer-first work, imperfect public shipping, numeric decisions, anti-isolation, adaptive over static.",
    "- goal_alignment: observed behavior moves toward Day 1 start, Day 7 readiness, user/revenue path, and BIP evidence.",
    "- actionability: observed behavior ends with one concrete next action, not generic advice.",
    "- evidence_use: observed behavior cites or uses workspace docs, transcript/user input, and current Day context.",
    "- ux_friction: observed behavior avoids setup blockers, unclear choices, bad recovery, and unacceptable latency. Higher is better.",
    "",
    "Startup-mode rubric:",
    "- Look for a specific customer, status quo, demand evidence, narrow wedge, numeric threshold, and one customer-facing next action.",
    "- Do not reward generic founder advice unless the observed output turns it into a testable customer/proof action.",
    "",
    "Builder-mode rubric:",
    "- Look for a shareable artifact, BIP/public proof, fast demo or wow moment, concrete next action, and appropriate restraint around revenue validation.",
    "- Do not penalize builder-mode output for not forcing immediate revenue validation when the next valuable proof is a demo artifact.",
    "",
    "Scoring rules:",
    "- If visible_outputs.assistant_messages is empty, the product-value score must be 2/10 or lower.",
    "- If expected_visible_outcome.requires_proof_target is true but visible_outputs.proof_target is empty, the run cannot pass.",
    "- If the observed assistant output is empty, generic, or only says the event happened, score product dimensions low even if sidecar events succeeded.",
    "- If an expected event happened but the observed output/action is not useful to the ICP, treat it as smoke evidence only, not product-value evidence.",
    "- If reference docs mention a value but the observed app behavior does not express it, do not award that value.",
    "- Regressions should list only blocking missing observed behaviors, baseline regressions, or latency/setup failures that should fail the gate.",
    "- Do not put minor improvement suggestions in regressions when the observed behavior otherwise reaches the 8/10 bar.",
    "- Do not require durable state mutation unless the scenario goal or expected visible outcome explicitly requires it; visible assistant output and sidecar events are valid observed outcomes.",
    "",
    "Context, not scoring evidence:",
    `Repo stage: ${scenario?.repo_stage || ""}`,
    `Intent mode: ${scenario?.intent_mode || ""}`,
    `Scenario title: ${scenario?.title || ""}`,
    `Scenario goal: ${scenario?.goal || ""}`,
    `User prompt context: ${scenario?.prompt || ""}`,
    `Expected visible outcome: ${JSON.stringify(scenario?.expected_visible_outcome || {})}`,
    "",
    "Reference docs, used only as criteria:",
    `--- ICP.md ---\n${referenceDocs?.["ICP.md"] || ""}`,
    `--- VALUES.md ---\n${referenceDocs?.["VALUES.md"] || ""}`,
    `--- GOAL.md ---\n${referenceDocs?.["GOAL.md"] || ""}`,
    `--- SPEC.md ---\n${referenceDocs?.["SPEC.md"] || ""}`,
    "",
    "Observed app output/actions to score:",
    JSON.stringify(observed || {}, null, 2),
  ].join("\n");
}

export function summarizeSmokeRun({ scenario, observed = {}, events = [], latency = {}, mode = "stub" }) {
  const eventTypes = events.map((event) => event.type).filter(Boolean);
  const eventTypeSet = new Set(eventTypes);
  const checks = buildSmokeChecks({ scenario, observed, events, eventTypeSet });
  const failures = Object.entries(checks)
    .filter(([, passed]) => !passed)
    .map(([name]) => smokeFailureMessage(name));
  const passed = failures.length === 0;

  return {
    scenario: scenario.id,
    repo_stage: scenario.repo_stage,
    intent_mode: scenario.intent_mode,
    expected_visible_outcome: scenario.expected_visible_outcome,
    mode,
    scores: null,
    overall: null,
    overall_smoke_only: passed ? 1 : 0,
    smoke: {
      passed,
      checks,
      failures,
    },
    judge_status: "skipped",
    verdict: passed ? DOGFOOD_VERDICTS.SMOKE_PASS : DOGFOOD_VERDICTS.SMOKE_FAIL,
    latency_ms: normalizeLatency(latency),
    judge_summary: passed
      ? "Smoke checks passed. Product-value judge was not run."
      : `Smoke checks failed: ${failures.join("; ")}`,
    regressions: failures,
    observed,
    artifacts: {
      events_jsonl: "",
      transcript_md: "",
      observed_json: "",
    },
  };
}

export function dogfoodVerdict({ mode = "stub", smokePassed = false, judgeStatus = "skipped", overall = null, regressions = [] } = {}) {
  if (mode !== "live") {
    return smokePassed ? DOGFOOD_VERDICTS.SMOKE_PASS : DOGFOOD_VERDICTS.SMOKE_FAIL;
  }
  return smokePassed
    && judgeStatus === "completed"
    && Number(overall) >= 7
    && regressions.length === 0
    ? DOGFOOD_VERDICTS.JUDGE_PASS
    : DOGFOOD_VERDICTS.JUDGE_FAIL;
}

export async function judgeDogfoodRun({
  scenario,
  referenceDocs = {},
  observed = {},
  provider = process.env.AGENTIC30_DOGFOOD_JUDGE_PROVIDER || "codex",
  model = process.env.AGENTIC30_DOGFOOD_JUDGE_MODEL || "",
  workspaceRoot = process.cwd(),
  timeoutMs = 120_000,
  runProvider = runProviderStream,
} = {}) {
  const prompt = buildJudgePrompt({ scenario, referenceDocs, observed });
  const abortController = new AbortController();
  const timer = setTimeout(() => abortController.abort(), timeoutMs);
  let rawOutput = "";

  try {
    await runProvider({
      provider,
      prompt,
      model,
      workspaceRoot,
      abortController,
      executionMode: DOGFOOD_JUDGE_EXECUTION_MODE,
      onTextDelta: (chunk) => {
        rawOutput += String(chunk || "");
      },
      onTextReplace: (text) => {
        rawOutput = String(text || "");
      },
    });

    const parsed = parseJudgeJson(rawOutput);
    return {
      judge_status: "completed",
      ...parsed,
      raw_judge_output: rawOutput,
    };
  } catch (error) {
    const message = error?.message || String(error);
    return {
      judge_status: "error",
      scores: null,
      overall: null,
      judge_summary: `Judge unavailable or invalid: ${message}`,
      regressions: [`Judge unavailable or invalid: ${message}`],
      raw_judge_output: rawOutput,
    };
  } finally {
    clearTimeout(timer);
  }
}

export function parseJudgeJson(raw) {
  const payload = extractJsonPayload(String(raw || ""));
  const parsed = JSON.parse(payload);
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Judge response must be a JSON object.");
  }
  if (!parsed.scores || typeof parsed.scores !== "object" || Array.isArray(parsed.scores)) {
    throw new Error("Judge response must include a scores object.");
  }

  const scores = {};
  for (const key of SCORE_KEYS) {
    if (!Object.hasOwn(parsed.scores, key)) {
      throw new Error(`Judge response missing score key: ${key}.`);
    }
    scores[key] = readJudgeScore(parsed.scores[key], `scores.${key}`);
  }

  const reportedOverall = Object.hasOwn(parsed, "overall") ? parsed.overall : null;
  const overall = averageScores(scores);
  if (typeof parsed.judge_summary !== "string" || !parsed.judge_summary.trim()) {
    throw new Error("Judge response must include a non-empty judge_summary string.");
  }
  if (!Array.isArray(parsed.regressions)) {
    throw new Error("Judge response must include regressions as an array.");
  }

  return {
    scores,
    overall,
    reported_overall: reportedOverall,
    judge_summary: parsed.judge_summary,
    regressions: parsed.regressions.map(String),
  };
}

export function compareAgainstBaseline(currentResults, baselineResults = []) {
  const baselineByScenario = new Map(
    baselineResults.map((result) => [result.scenario, result]),
  );
  return currentResults.map((result) => {
    const baseline = baselineByScenario.get(result.scenario);
    const currentOverall = readOptionalNumber(result.overall);
    const baselineOverall = readOptionalNumber(baseline?.overall);
    if (!baseline || currentOverall === null || baselineOverall === null) {
      return { ...result, baseline_overall: baselineOverall, delta: null };
    }

    const delta = round1(currentOverall - baselineOverall);
    const regressions = delta < 0
      ? [...(result.regressions || []), `Regressed ${Math.abs(delta)}/10 from baseline.`]
      : (result.regressions || []);
    return {
      ...result,
      baseline_overall: baselineOverall,
      delta,
      regressions,
    };
  });
}

function defaultFixturesPath() {
  return path.join(path.dirname(new URL(import.meta.url).pathname), "fixtures", "dogfood-scenarios.json");
}

function normalizeScenario(input) {
  const repoStage = String(input?.repo_stage || "strategy_seeded").trim();
  const intentMode = String(input?.intent_mode || "startup").trim();
  const scenario = {
    id: String(input?.id || "").trim(),
    repo_stage: REPO_STAGES.includes(repoStage) ? repoStage : "",
    intent_mode: INTENT_MODES.includes(intentMode) ? intentMode : "",
    title: String(input?.title || "").trim(),
    goal: String(input?.goal || "").trim(),
    prompt: String(input?.prompt || "").trim(),
    fixture: normalizeFixture(input?.fixture),
    expected_visible_outcome: normalizeExpectedVisibleOutcome(input?.expected_visible_outcome),
  };
  if (!scenario.id || !scenario.repo_stage || !scenario.intent_mode || !scenario.title || !scenario.goal) {
    throw new Error(`Invalid dogfood scenario fixture: ${JSON.stringify(input)}`);
  }
  return scenario;
}

function buildSmokeChecks({ scenario, observed, events, eventTypeSet }) {
  const checks = {
    no_error_events: !events.some((event) => event.type === "error"),
    latency_recorded: Number.isFinite(Number(observed?.latency_ms?.final_response ?? observed?.latency?.final_response ?? 0)),
  };
  const expected = scenario.expected_visible_outcome || {};
  const requiresVisibleOutput = expected.requires_visible_output !== false;

  switch (scenario.id) {
    case "first-run-icp-fit":
    case "day1-coaching-action":
      checks.session_updated = eventTypeSet.has("session_updated");
      checks.assistant_output_observed = hasAssistantOutput(observed);
      break;
    case "workspace-docs-scan":
      checks.workspace_scan_result = eventTypeSet.has("workspace_scan_result") || eventTypeSet.has("workspace_scan_completed");
      checks.fixture_docs_found = Boolean(
        observed.workspaceScan?.icp
          && observed.workspaceScan?.values
          && observed.workspaceScan?.goal
          && observed.workspaceScan?.spec,
      );
      checks.fixture_workspace_scanned = String(observed.workspaceScan?.scanRoot || "").includes("agentic30-dogfood-workspace-");
      if (requiresVisibleOutput) {
        checks.assistant_output_observed = hasAssistantOutput(observed);
      }
      break;
    case "bip-mission-partial-setup":
      checks.mission_generation_completed = eventTypeSet.has("bip_coach_generation_completed");
      checks.mission_choices_observed = Array.isArray(observed.missionChoices) && observed.missionChoices.length >= 3;
      break;
    case "structured-decision-card":
      checks.session_updated = eventTypeSet.has("session_updated");
      checks.structured_input_accepted = observed.structuredInputAccepted === true;
      if (requiresVisibleOutput) {
        checks.assistant_output_observed = hasAssistantOutput(observed);
      }
      break;
    case "mission-completion":
      checks.mission_completion_completed = eventTypeSet.has("bip_coach_completion_completed");
      checks.completion_proof_observed = observed.completionProof?.completed === true
        && Boolean(observed.completionProof?.threadsUrl)
        && Boolean(observed.completionProof?.sheetRowNote);
      break;
    default:
      checks.assistant_output_observed = hasAssistantOutput(observed);
      break;
  }

  if (expected.requires_one_next_action) {
    checks.one_next_action_observed = Boolean(readRecommendedAction(observed));
  }
  if (expected.requires_proof_target) {
    checks.proof_target_observed = Boolean(readProofTarget(observed));
  }
  for (const [index, fragment] of (expected.must_include || []).entries()) {
    checks[`must_include_${index + 1}`] = observedText(observed).toLowerCase().includes(String(fragment).toLowerCase());
  }
  for (const [index, fragment] of (expected.must_not_include || []).entries()) {
    checks[`must_not_include_${index + 1}`] = !observedText(observed).toLowerCase().includes(String(fragment).toLowerCase());
  }

  return checks;
}

function hasAssistantOutput(observed) {
  const messages = observedAssistantMessages(observed);
  return messages.some((message) => String(message || "").trim().length > 0);
}

function observedAssistantMessages(observed) {
  if (Array.isArray(observed?.visible_outputs?.assistant_messages)) {
    return observed.visible_outputs.assistant_messages;
  }
  return Array.isArray(observed?.assistantMessages) ? observed.assistantMessages : [];
}

function observedText(observed) {
  return [
    ...observedAssistantMessages(observed),
    observed?.visible_outputs?.doc_paths_answered?.join("\n") || "",
    observed?.visible_outputs?.recommended_action || "",
    observed?.visible_outputs?.proof_target || "",
    observed?.visible_outputs?.completion_confirmation || "",
  ].join("\n");
}

function readRecommendedAction(observed) {
  const explicit = String(observed?.visible_outputs?.recommended_action || "").trim();
  if (explicit) return explicit;
  const text = observedText(observed);
  const match = text.match(/(?:다음 액션|오늘 액션|next action|recommended action|진행 순서|1\.)[:：]?\s*([^\n]+)/i);
  return match?.[1]?.trim() || "";
}

function readProofTarget(observed) {
  const explicit = String(observed?.visible_outputs?.proof_target || "").trim();
  if (explicit) return explicit;
  const missionProof = Array.isArray(observed?.missionChoices)
    ? observed.missionChoices.find((choice) => String(choice?.proofTarget || "").trim())?.proofTarget
    : "";
  if (missionProof) return missionProof;
  const text = observedText(observed);
  const match = text.match(/(?:^|\n)\s*(?:증거 목표|증거 기준|완료 기준|공개 증거|BIP proof|proof target)[:：]\s*([^\n]+)/i);
  return match?.[1]?.trim() || "";
}

function smokeFailureMessage(name) {
  return `${name} failed`;
}

function normalizeLatency(latency = {}) {
  const firstResponse = Math.round(Number(latency.first_response ?? latency.first_response_ms ?? 0));
  const firstVisibleValue = Math.round(Number(
    latency.first_visible_value
      ?? latency.first_visible_value_ms
      ?? firstResponse,
  ));
  const finalResponse = Math.round(Number(
    latency.final_response
      ?? latency.final_response_ms
      ?? latency.operation_complete
      ?? latency.operation_complete_ms
      ?? firstResponse,
  ));
  const operationComplete = Math.round(Number(
    latency.operation_complete
      ?? latency.operation_complete_ms
      ?? finalResponse,
  ));
  const judgeComplete = latency.judge_complete ?? latency.judge_complete_ms;
  return {
    first_response: firstResponse,
    first_event: Math.round(Number(latency.first_event ?? latency.first_event_ms ?? firstResponse)),
    first_visible_value: firstVisibleValue,
    first_visible_value_ms: firstVisibleValue,
    final_response: finalResponse,
    operation_complete: operationComplete,
    operation_complete_ms: operationComplete,
    ...(judgeComplete === undefined ? {} : {
      judge_complete: Math.round(Number(judgeComplete)),
      judge_complete_ms: Math.round(Number(judgeComplete)),
    }),
  };
}

function normalizeFixture(value = {}) {
  const fixture = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    docs: normalizeStringArray(fixture.docs),
    transcripts: normalizeStringArray(fixture.transcripts),
    state: fixture.state && typeof fixture.state === "object" && !Array.isArray(fixture.state) ? fixture.state : {},
    iddSetup: String(fixture.iddSetup || "").trim(),
    proofs: normalizeStringArray(fixture.proofs),
  };
}

function normalizeExpectedVisibleOutcome(value = {}) {
  const expected = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  return {
    must_include: normalizeStringArray(expected.must_include),
    must_not_include: normalizeStringArray(expected.must_not_include),
    requires_one_next_action: expected.requires_one_next_action !== false,
    requires_proof_target: expected.requires_proof_target === true,
    requires_visible_output: expected.requires_visible_output !== false,
  };
}

function normalizeStringArray(value) {
  return Array.isArray(value) ? value.map((item) => String(item || "").trim()).filter(Boolean) : [];
}

function extractJsonPayload(raw) {
  const text = raw.trim();
  const fenced = text.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/i);
  if (fenced) return fenced[1].trim();
  return text;
}

function readJudgeScore(value, label) {
  const number = Number(value);
  if (!Number.isFinite(number)) {
    throw new Error(`Judge response ${label} must be a finite number.`);
  }
  if (number < 0 || number > 10) {
    throw new Error(`Judge response ${label} must be between 0 and 10.`);
  }
  return round1(number);
}

function averageScores(scores) {
  const values = SCORE_KEYS.map((key) => scores[key]);
  return round1(values.reduce((sum, value) => sum + value, 0) / values.length);
}

function readOptionalNumber(value) {
  if (value === null || value === undefined || value === "") return null;
  const number = Number(value);
  return Number.isFinite(number) ? round1(number) : null;
}

function round1(value) {
  return Math.round(Number(value) * 10) / 10;
}

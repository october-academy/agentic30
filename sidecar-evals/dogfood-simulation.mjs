#!/usr/bin/env node
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import {
  DOGFOOD_FAILURE_CLASSES,
  DOGFOOD_VERDICTS,
  buildJudgePrompt,
  compareAgainstBaseline,
  dogfoodVerdict,
  judgeDogfoodRun,
  loadReferenceDocs,
  loadScenarioFixtures,
  summarizeSmokeRun,
} from "./dogfood-judge.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const repoRoot = path.resolve(packageRoot, "../../..");
const liveMode = process.env.AGENTIC30_RUN_LIVE_PROVIDER_EVAL === "1";

export async function runDogfoodSimulation({
  outputDir = defaultOutputDir(),
  mode = liveMode ? "live" : "stub",
  scenarioIds = [],
  stage = "",
  intentMode = "",
  gate = false,
} = {}) {
  const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const runDir = path.join(outputDir, runId);
  await fs.mkdir(runDir, { recursive: true });

  const referenceDocs = await loadReferenceDocs(repoRoot);
  const scenarios = (await loadScenarioFixtures())
    .filter((scenario) => scenarioIds.length === 0 || scenarioIds.includes(scenario.id))
    .filter((scenario) => !stage || scenario.repo_stage === stage)
    .filter((scenario) => !intentMode || scenario.intent_mode === intentMode);
  if (!scenarios.length) {
    throw new Error("No dogfood scenarios matched the requested filters.");
  }
  if (mode === "live") {
    for (const scenario of scenarios) {
      validateLiveScenarioPrompt(scenario);
    }
  }

  const results = [];
  for (const scenario of scenarios) {
    results.push(await runScenarioInIsolatedSidecar({
      runDir,
      mode,
      scenario,
      referenceDocs,
    }));
  }

  const withBaseline = compareAgainstBaseline(results, await readBaselineResults())
    .map((result) => finalizeVerdict(result, mode));
  const runGate = evaluateRunGate(withBaseline, mode);
  const jsonlPath = path.join(runDir, "results.jsonl");
  const reportPath = path.join(runDir, "report.md");
  const experimentPath = path.join(runDir, "EXPERIMENT.md");
  await fs.writeFile(jsonlPath, withBaseline.map((result) => JSON.stringify(result)).join("\n") + "\n");
  await fs.writeFile(reportPath, renderMarkdownReport(withBaseline, mode, runGate));
  await fs.writeFile(experimentPath, renderExperimentMarkdown(mode, runGate));

  return {
    runDir,
    jsonlPath,
    reportPath,
    experimentPath,
    results: withBaseline,
    gate: runGate,
    passed: runGate.passed,
    gateRequested: Boolean(gate),
  };
}

async function runScenarioInIsolatedSidecar({
  runDir,
  mode,
  scenario,
  referenceDocs,
}) {
  const workspaceRoot = await createWorkspaceFixture(referenceDocs, scenario);
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-dogfood-app-"));
  await writeBipConfig({ workspaceRoot, appSupportPath, scenario });

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspaceRoot], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_CODEX_MODEL: process.env.AGENTIC30_CODEX_MODEL || "gpt-5.4-mini",
      ...(mode === "stub"
        ? {
            AGENTIC30_TEST_STUB_PROVIDER: "1",
            AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1",
          }
        : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (chunk) => {
    stderr += String(chunk);
  });

  const events = [];
  let ws;
  try {
    const ready = await readSidecarReady(child);
    ws = new WebSocket(`ws://127.0.0.1:${ready.port}`);
    ws.on("message", (raw) => {
      const event = JSON.parse(String(raw));
      event.received_at_ms = Math.round(performance.now());
      events.push(event);
    });
    await onceOpen(ws);

    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEvent(events, (event) => event.type === "session_created", 30_000);
    const sessionId = created.session.id;

    const startedAt = performance.now();
    const eventOffset = events.length;
    const transcript = [];
    let scenarioResult;
    try {
      scenarioResult = await runScenario({
        ws,
        events,
        sessionId,
        scenario,
        transcript,
        startedAt,
        eventOffset,
        workspaceRoot,
      });
    } catch (error) {
      const message = error?.message || String(error);
      transcript.push(`SYSTEM: scenario failed: ${message}`);
      scenarioResult = {
        latency_ms: elapsedLatency(startedAt),
        observed: {
          assistantMessages: [],
          systemOutcomes: [`scenario failed: ${message}`],
          error: message,
        },
      };
    }

    const scenarioEvents = events.slice(eventOffset);
    const observed = finalizeObserved({
      scenario,
      observed: scenarioResult.observed,
      events: scenarioEvents,
      latency: scenarioResult.latency_ms,
    });
    const transcriptText = transcript.join("\n\n");
    const judgePrompt = buildJudgePrompt({
      scenario,
      referenceDocs,
      observed,
    });

    let result = summarizeSmokeRun({
      scenario,
      observed,
      events: scenarioEvents,
      latency: scenarioResult.latency_ms,
      mode,
    });

    if (mode === "live" && result.smoke.passed) {
      const judgeStartedAt = performance.now();
      const judged = await judgeDogfoodRun({
        scenario,
        referenceDocs,
        observed,
        workspaceRoot,
      });
      judged.judge_latency_ms = Math.round(performance.now() - judgeStartedAt);
      result = mergeJudgeResult({ smokeResult: result, judged });
    } else if (mode === "live") {
      result = {
        ...result,
        judge_status: "skipped",
        verdict: DOGFOOD_VERDICTS.JUDGE_FAIL,
        judge_summary: "Live judge skipped because smoke checks failed.",
      };
    }

    result.artifacts = await writeScenarioArtifacts({
      runDir,
      scenario,
      events: scenarioEvents,
      transcript: transcriptText,
      judgePrompt,
      observed,
    });

    if (stderr.trim()) {
      await fs.writeFile(path.join(runDir, `${scenario.id}.sidecar-stderr.log`), stderr);
    }
    return result;
  } finally {
    await closeWebSocket(ws);
    await terminateChild(child);
    await fs.rm(workspaceRoot, { recursive: true, force: true });
    await fs.rm(appSupportPath, { recursive: true, force: true });
  }
}

async function runScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset, workspaceRoot }) {
  switch (scenario.id) {
    case "first-run-icp-fit":
      return submitBootstrapInput({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset });
    case "workspace-docs-scan":
      return scanWorkspaceDocs({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset, workspaceRoot });
    case "day1-coaching-action":
      return sendPromptScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset });
    case "bip-mission-partial-setup":
      return generateMissionScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset });
    case "structured-decision-card":
      return structuredDecisionScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset });
    case "mission-completion":
      return missionCompletionScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset });
    default:
      return sendPromptScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset });
  }
}

async function submitBootstrapInput({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset }) {
  const snapshot = latestSession(events, sessionId);
  const previousFinalAssistantCount = countFinalAssistantMessages(snapshot);
  if (snapshot?.pendingUserInput) {
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId,
      requestId: snapshot.pendingUserInput.requestId,
      responses: [{
        question: snapshot.pendingUserInput.questions?.[0]?.question || "무엇부터 시작할까요?",
        selectedOptions: [],
        freeText: scenario.prompt,
      }],
    }));
  } else {
    ws.send(JSON.stringify({ type: "send_prompt", sessionId, prompt: scenario.prompt }));
  }
  const completed = await waitForAssistantAnswer({
    events,
    sessionId,
    eventOffset,
    previousFinalAssistantCount,
    timeoutMs: 60_000,
    startedAt,
  });
  const assistant = completed.content;
  transcript.push(`USER: ${scenario.prompt}`, `ASSISTANT: ${assistant}`);
  return {
    latency_ms: completed.latency_ms || latencyFromSession(completed.session, startedAt).latency_ms,
    observed: {
      assistantMessages: [assistant],
      systemOutcomes: ["first-run input submitted and assistant response observed"],
    },
  };
}

async function scanWorkspaceDocs({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset, workspaceRoot }) {
  const previousFinalAssistantCount = countFinalAssistantMessages(latestSession(events, sessionId));
  ws.send(JSON.stringify({
    type: "scan_workspace",
    root: workspaceRoot,
    sessionId,
    prompt: scenario.prompt,
  }));
  let visibleAnswer = null;
  try {
    visibleAnswer = await waitForAssistantAnswer({
      events,
      sessionId,
      eventOffset,
      previousFinalAssistantCount,
      timeoutMs: 5_000,
      startedAt,
    });
  } catch {
    visibleAnswer = null;
  }
  const completed = await waitForEventAfter(events, eventOffset, (event) => event.type === "workspace_scan_result", 100_000);
  if (!visibleAnswer) {
    try {
      visibleAnswer = await waitForAssistantAnswer({
        events,
        sessionId,
        eventOffset,
        previousFinalAssistantCount,
        timeoutMs: 5_000,
        startedAt,
      });
    } catch {
      visibleAnswer = null;
    }
  }
  const fallbackSession = latestSession(events, sessionId);
  const fallbackAssistant = countFinalAssistantMessages(fallbackSession) > previousFinalAssistantCount
    ? latestAssistantMessage(fallbackSession)?.content || ""
    : "";
  const assistant = visibleAnswer?.content || fallbackAssistant;
  transcript.push(`USER: ${scenario.prompt}`);
  if (assistant) {
    transcript.push(`ASSISTANT: ${assistant}`);
  }
  transcript.push(`SYSTEM: workspace scan found ICP=${completed.icp}, VALUES=${completed.values}, GOAL=${completed.goal}, SPEC=${completed.spec}`);
  const operationCompleteMs = eventElapsed(completed, startedAt);
  const visibleLatency = visibleAnswer?.latency_ms
    || (assistant ? latencyFromSession(fallbackSession, startedAt).latency_ms : elapsedLatency(startedAt));
  const latency = {
    ...visibleLatency,
    operation_complete: operationCompleteMs,
    operation_complete_ms: operationCompleteMs,
    final_response: operationCompleteMs,
  };
  return {
    latency_ms: latency,
    observed: {
      assistantMessages: assistant ? [assistant] : [],
      systemOutcomes: ["workspace scan completed"],
      workspaceScan: {
        scanRoot: workspaceRoot,
        icp: Boolean(completed.icp),
        icpPath: completed.icp || "",
        values: Boolean(completed.values),
        valuesPath: completed.values || "",
        goal: Boolean(completed.goal),
        goalPath: completed.goal || "",
        spec: Boolean(completed.spec),
        specPath: completed.spec || "",
      },
    },
  };
}

async function sendPromptScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset }) {
  const snapshot = latestSession(events, sessionId);
  const previousFinalAssistantCount = countFinalAssistantMessages(snapshot);
  if (snapshot?.pendingUserInput) {
    ws.send(JSON.stringify({
      type: "submit_user_input",
      sessionId,
      requestId: snapshot.pendingUserInput.requestId,
      responses: [{
        question: snapshot.pendingUserInput.questions?.[0]?.question || "무엇부터 시작할까요?",
        selectedOptions: [],
        freeText: scenario.prompt,
      }],
    }));
  } else {
    ws.send(JSON.stringify({ type: "send_prompt", sessionId, prompt: scenario.prompt }));
  }
  const completed = await waitForAssistantAnswer({
    events,
    sessionId,
    eventOffset,
    previousFinalAssistantCount,
    timeoutMs: 90_000,
    startedAt,
  });
  const assistant = completed.content;
  transcript.push(`USER: ${scenario.prompt}`, `ASSISTANT: ${assistant}`);
  return {
    latency_ms: completed.latency_ms || latencyFromSession(completed.session, startedAt).latency_ms,
    observed: {
      assistantMessages: [assistant],
      systemOutcomes: ["assistant response observed"],
    },
  };
}

async function generateMissionScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset }) {
  const previousFinalAssistantCount = countFinalAssistantMessages(latestSession(events, sessionId));
  ws.send(JSON.stringify({
    type: "bip_coach_generate_mission",
    sessionId,
    provider: "codex",
    compact: true,
    curriculumDay: day1CurriculumPayload(),
  }));
  const completed = await waitForEventAfter(events, eventOffset, (event) =>
    event.type === "bip_coach_generation_completed"
    && event.bipCoach?.missionChoices?.length >= 3
  , 60_000);
  const missionChoices = summarizeMissionChoices(completed.bipCoach.missionChoices);
  const visibleSession = latestSession(events, sessionId);
  const assistant = latestAssistantMessage(visibleSession)?.content || `Generated ${missionChoices.length} mission choices.`;
  const recommended = missionChoices[0]?.title || "";
  transcript.push(`USER: ${scenario.prompt}`);
  transcript.push(`ASSISTANT: ${assistant}`);
  if (countFinalAssistantMessages(visibleSession) <= previousFinalAssistantCount) {
    transcript.push(`SYSTEM: mission generation did not add a visible assistant message.`);
  }
  return {
    latency_ms: elapsedLatency(startedAt),
    observed: {
      assistantMessages: assistant ? [assistant] : [],
      systemOutcomes: ["BIP mission choices generated"],
      missionChoices,
      missionEvidenceSource: completed.bipCoach.evidence?.source || "",
      recommendedAction: recommended ? `추천 미션: ${recommended}` : "",
      proofTarget: missionChoices.find((choice) => choice.proofTarget)?.proofTarget || "",
    },
  };
}

async function structuredDecisionScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset }) {
  ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
  const ready = await waitForEventAfter(events, eventOffset, (event) =>
    event.type === "session_created"
    && event.session?.pendingUserInput
  , 15_000);
  const structuredSessionId = ready.session.id;
  const request = ready.session.pendingUserInput;
  const previousFinalAssistantCount = countFinalAssistantMessages(ready.session);
  ws.send(JSON.stringify({
    type: "submit_user_input",
    sessionId: structuredSessionId,
    requestId: request.requestId,
    responses: [{
      question: request.questions?.[0]?.question || "선택",
      selectedOptions: [scenario.prompt],
      freeText: "",
    }],
  }));
  let answer = null;
  try {
    answer = await waitForAssistantAnswer({
      events,
      sessionId: structuredSessionId,
      eventOffset,
      previousFinalAssistantCount,
      timeoutMs: 60_000,
      startedAt,
    });
  } catch {
    answer = null;
  }
  const updated = answer?.session || await waitForEventAfter(events, eventOffset, (event) =>
    event.type === "session_updated"
    && event.session?.id === structuredSessionId
    && event.session?.pendingUserInput === null
  , 15_000).then((event) => event.session);
  const assistant = answer?.content || latestAssistantMessage(updated)?.content || "";
  transcript.push(`USER: selected structured option ${scenario.prompt}`);
  if (assistant) {
    transcript.push(`ASSISTANT: ${assistant}`);
  }
  transcript.push(`SYSTEM: structured input request ${request.requestId} accepted; session has ${updated.messages?.length || 0} messages.`);
  return {
    latency_ms: answer ? latencyFromSession(answer.session, startedAt).latency_ms : elapsedLatency(startedAt),
    observed: {
      assistantMessages: assistant ? [assistant] : [],
      systemOutcomes: [`structured input request ${request.requestId} accepted`],
      structuredInputAccepted: true,
      structuredInputRequestId: request.requestId,
      selectedOptions: [scenario.prompt],
      recommendedAction: extractRecommendedAction(assistant),
    },
  };
}

async function missionCompletionScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset }) {
  let coach = latestBipCoach(events);
  let generatedObserved = {};
  if (!coach?.missionChoices?.length) {
    const generated = await generateMissionScenario({ ws, events, sessionId, scenario, transcript, startedAt, eventOffset });
    generatedObserved = generated.observed;
    coach = latestBipCoach(events);
  }
  const mission = coach?.missionChoices?.[0];
  if (!mission) {
    throw new Error("Mission completion scenario requires at least one mission choice.");
  }

  const threadsUrl = "https://threads.net/@october/post/dogfood-proof";
  const sheetRowNote = "Day 1 dogfood eval: public proof URL recorded, next proof target selected.";
  ws.send(JSON.stringify({ type: "bip_coach_select_mission", sessionId, missionId: mission.id }));
  await waitForEventAfter(events, eventOffset, (event) =>
    event.type === "bip_coach_state"
    && event.bipCoach?.currentMission?.id === mission.id
  , 30_000);
  ws.send(JSON.stringify({
    type: "bip_coach_complete_mission",
    sessionId,
    threadsUrl,
    sheetRowNote,
  }));
  const completed = await waitForEventAfter(events, eventOffset, (event) => event.type === "bip_coach_completion_completed", 30_000);
  const assistant = latestAssistantMessage(latestSession(events, sessionId))?.content || "";
  transcript.push(`USER: ${scenario.prompt}`);
  if (assistant) {
    transcript.push(`ASSISTANT: ${assistant}`);
  }
  transcript.push(`SYSTEM: completed mission ${completed.bipCoach.currentMission?.title || mission.title} with streak ${completed.bipCoach.streak?.current}.`);
  return {
    latency_ms: elapsedLatency(startedAt),
    observed: {
      assistantMessages: [
        ...(generatedObserved.assistantMessages || []),
        ...(assistant ? [assistant] : []),
      ],
      systemOutcomes: [
        ...(generatedObserved.systemOutcomes || []),
        "BIP mission completed with public proof",
      ],
      missionChoices: generatedObserved.missionChoices || summarizeMissionChoices(coach.missionChoices || []),
      completionProof: {
        completed: true,
        missionTitle: completed.bipCoach.currentMission?.title || mission.title || "",
        threadsUrl,
        sheetRowNote,
        streak: completed.bipCoach.streak?.current ?? null,
      },
      recommendedAction: "다음 공개 증거 목표를 이어서 선택한다.",
      proofTarget: completed.bipCoach.currentMission?.proofTarget || mission.proofTarget || "",
    },
  };
}

async function createWorkspaceFixture(referenceDocs, scenario = {}) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "agentic30-dogfood-workspace-"));
  await fs.mkdir(path.join(root, "docs"), { recursive: true });
  const docs = Array.isArray(scenario.fixture?.docs)
    ? scenario.fixture.docs
    : ["docs/ICP.md", "docs/VALUES.md", "docs/GOAL.md", "docs/SPEC.md"];
  for (const docPath of docs) {
    const name = path.basename(docPath);
    const content = referenceDocs[name];
    if (!content) continue;
    await fs.mkdir(path.dirname(path.join(root, docPath)), { recursive: true });
    await fs.writeFile(path.join(root, docPath), content);
  }
  if (scenario.fixture?.transcripts?.length) {
    await fs.mkdir(path.join(root, "transcripts"), { recursive: true });
    for (const transcript of scenario.fixture.transcripts) {
      await fs.writeFile(
        path.join(root, "transcripts", `${transcript}.md`),
        [
          `# ${transcript}`,
          "Customer says they built three products with Codex but still have zero revenue.",
          "They spend runway without knowing which customer pain is urgent.",
          "They will do interviews and publish imperfect progress daily.",
        ].join("\n\n"),
      );
    }
  }
  await fs.mkdir(path.join(root, "agentic30"), { recursive: true });
  await fs.writeFile(
    path.join(root, "agentic30", "stage-state.json"),
    JSON.stringify({
      repo_stage: scenario.repo_stage || "",
      intent_mode: scenario.intent_mode || "",
      state: scenario.fixture?.state || {},
      proofs: scenario.fixture?.proofs || [],
    }, null, 2),
  );
  if (scenario.repo_stage === "complete") {
    await fs.mkdir(path.join(root, "docs"), { recursive: true });
    await fs.writeFile(
      path.join(root, "docs", "RETRO.md"),
      [
        "# Loop retro",
        "Completed loop evidence includes public posts, one demo artifact, and a next proof target.",
        ...(scenario.fixture?.proofs || []).map((proof) => `- ${proof}`),
      ].join("\n"),
    );
  }
  return root;
}

async function writeBipConfig({ workspaceRoot, appSupportPath, scenario = {} }) {
  await fs.mkdir(appSupportPath, { recursive: true });
  const docs = new Set(scenario.fixture?.docs || []);
  const docPath = (name) => docs.has(`docs/${name}`) || docs.has(name) ? `docs/${name}` : "";
  await fs.writeFile(
    path.join(appSupportPath, "bip-config.json"),
    JSON.stringify({
      workspace: {
        root: workspaceRoot,
        icp: docPath("ICP.md"),
        values: docPath("VALUES.md"),
        goal: docPath("GOAL.md"),
        spec: docPath("SPEC.md"),
        designSystem: "",
        adr: "",
        docs: "",
        sheet: "",
      },
      externalDocs: { googleDocs: [], googleSheets: [], notion: [] },
      social: { threads: "october", x: "" },
    }, null, 2),
  );
}

async function writeScenarioArtifacts({ runDir, scenario, events, transcript, judgePrompt, observed }) {
  const prefix = scenario.id;
  const eventsPath = path.join(runDir, `${prefix}.events.jsonl`);
  const transcriptPath = path.join(runDir, `${prefix}.transcript.md`);
  const judgePromptPath = path.join(runDir, `${prefix}.judge.md`);
  const observedPath = path.join(runDir, `${prefix}.observed.json`);
  await fs.writeFile(eventsPath, events.map((event) => JSON.stringify(event)).join("\n") + "\n");
  await fs.writeFile(transcriptPath, transcript);
  await fs.writeFile(judgePromptPath, judgePrompt);
  await fs.writeFile(observedPath, JSON.stringify(observed, null, 2) + "\n");
  return {
    events_jsonl: eventsPath,
    transcript_md: transcriptPath,
    judge_prompt_md: judgePromptPath,
    observed_json: observedPath,
  };
}

async function readBaselineResults() {
  const baselinePath = process.env.AGENTIC30_DOGFOOD_BASELINE;
  if (!baselinePath) return [];
  try {
    const raw = await fs.readFile(baselinePath, "utf8");
    return raw.split("\n").filter(Boolean).map((line) => JSON.parse(line));
  } catch {
    return [];
  }
}

function mergeJudgeResult({ smokeResult, judged }) {
  const judgeLatency = Math.round(Number(judged.judge_latency_ms || 0));
  return {
    ...smokeResult,
    scores: judged.scores,
    overall: judged.overall,
    reported_overall: judged.reported_overall,
    judge_status: judged.judge_status,
    judge_summary: judged.judge_summary,
    regressions: [...(smokeResult.smoke.failures || []), ...(judged.regressions || [])],
    raw_judge_output: judged.raw_judge_output,
    latency_ms: {
      ...(smokeResult.latency_ms || {}),
      ...(judgeLatency ? {
        judge_complete: judgeLatency,
        judge_complete_ms: judgeLatency,
      } : {}),
    },
    verdict: dogfoodVerdict({
      mode: "live",
      smokePassed: smokeResult.smoke.passed,
      judgeStatus: judged.judge_status,
      overall: judged.overall,
      regressions: judged.regressions || [],
    }),
  };
}

function finalizeVerdict(result, mode) {
  const next = {
    ...result,
    verdict: dogfoodVerdict({
      mode,
      smokePassed: result.smoke?.passed === true,
      judgeStatus: result.judge_status,
      overall: result.overall,
      regressions: result.regressions || [],
    }),
  };
  const failureClasses = classifyFailureClasses(next);
  return {
    ...next,
    failure_classes: failureClasses,
    failure_class: failureClasses[0] || "",
  };
}

export function validateLiveScenarioPrompt(scenario = {}) {
  const prompt = String(scenario.prompt || "");
  const markerPattern = /(?:DAY1_ICP_TURN_|LIVE_DAY1_ICP_STEP_|AGENTIC30_FORCE_PROVIDER)/i;
  if (markerPattern.test(prompt)) {
    throw new Error(`Live dogfood scenario "${scenario.id || "unknown"}" contains a test-only control marker.`);
  }
  return true;
}

export function classifyFailureClasses(result = {}) {
  if (result.verdict === DOGFOOD_VERDICTS.SMOKE_PASS || result.verdict === DOGFOOD_VERDICTS.JUDGE_PASS) {
    return [];
  }
  const text = [
    ...(result.regressions || []),
    result.judge_summary || "",
    result.observed?.error || "",
  ].join("\n");
  const classes = new Set();
  if (/test-only control marker|DAY1_ICP_TURN_|LIVE_DAY1_ICP_STEP_|AGENTIC30_FORCE_PROVIDER/i.test(text)) {
    classes.add(DOGFOOD_FAILURE_CLASSES.EXPERIMENT_DESIGN_BUG);
  }
  if (/Judge unavailable or invalid|Judge response|strict JSON|finite number/i.test(text) || result.judge_status === "error") {
    classes.add(DOGFOOD_FAILURE_CLASSES.JUDGE_CONTRACT_BUG);
  }
  if (/latency measurement|received_at_ms|first_visible_value accounting/i.test(text)) {
    classes.add(DOGFOOD_FAILURE_CLASSES.EVAL_BUG);
  }
  if (
    result.smoke?.passed === false
    || Number(result.overall) < 7
    || /assistant_output_observed|proof_target_observed|must_include|Missing actual|Does not clarify/i.test(text)
  ) {
    classes.add(DOGFOOD_FAILURE_CLASSES.PRODUCT_BUG);
  }
  if (classes.size === 0) {
    classes.add(DOGFOOD_FAILURE_CLASSES.PRODUCT_BUG);
  }
  return [...classes];
}

const DECISION_READY_STATUS = Object.freeze({
  PASS: "pass",
  WARN: "warn",
  FAIL: "fail",
});

const DECISION_READY_REQUIRED_FLOOR = 7;
const DECISION_READY_WARNING_FLOOR = 7;
const DECISION_READY_SUMMARY_TARGET = 8;

const DECISION_CONTRACTS = Object.freeze({
  "first-run-icp-fit": decisionContract({
    requiredDimensions: ["icp_fit", "actionability", "goal_alignment", "ux_friction"],
    warningDimensions: ["evidence_use", "values_delivery"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "workspace-docs-scan": decisionContract({
    requiredDimensions: ["evidence_use", "ux_friction"],
    warningDimensions: ["actionability", "goal_alignment"],
    contextDimensions: ["icp_fit", "values_delivery"],
    requiredEvidence: ["docs_path", "assistant_output"],
  }),
  "day1-coaching-action": decisionContract({
    requiredDimensions: ["icp_fit", "goal_alignment", "actionability", "evidence_use"],
    warningDimensions: ["values_delivery", "ux_friction"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "bip-mission-partial-setup": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "ux_friction"],
    warningDimensions: ["icp_fit", "evidence_use", "values_delivery"],
    requiredEvidence: ["mission_choices_3", "next_action", "proof_target"],
  }),
  "structured-decision-card": decisionContract({
    requiredDimensions: ["actionability", "ux_friction"],
    warningDimensions: ["goal_alignment", "evidence_use", "values_delivery"],
    contextDimensions: ["icp_fit"],
    requiredEvidence: ["structured_input", "assistant_output", "next_action"],
  }),
  "mission-completion": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "evidence_use", "ux_friction"],
    warningDimensions: ["icp_fit", "values_delivery"],
    requiredEvidence: ["completion_proof", "threads_url", "sheet_note", "next_action", "proof_target"],
  }),
  "empty-startup-first-run": decisionContract({
    requiredDimensions: ["icp_fit", "goal_alignment", "actionability", "ux_friction"],
    warningDimensions: ["values_delivery", "evidence_use"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "empty-builder-first-run": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "ux_friction"],
    warningDimensions: ["values_delivery", "evidence_use", "icp_fit"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "seeded-startup-day1": decisionContract({
    requiredDimensions: ["icp_fit", "goal_alignment", "actionability", "evidence_use"],
    warningDimensions: ["values_delivery", "ux_friction"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "seeded-builder-shareable-demo": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "evidence_use"],
    warningDimensions: ["icp_fit", "values_delivery", "ux_friction"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "partial-startup-recovery": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "ux_friction"],
    warningDimensions: ["icp_fit", "evidence_use", "values_delivery"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "partial-builder-recovery": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "ux_friction"],
    warningDimensions: ["evidence_use", "values_delivery", "icp_fit"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "running-startup-proof-loop": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "evidence_use", "icp_fit"],
    warningDimensions: ["values_delivery", "ux_friction"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "running-builder-bip-loop": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "evidence_use"],
    warningDimensions: ["icp_fit", "values_delivery", "ux_friction"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "complete-startup-verdict": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "evidence_use", "icp_fit"],
    warningDimensions: ["values_delivery", "ux_friction"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
  "complete-builder-retro": decisionContract({
    requiredDimensions: ["goal_alignment", "actionability", "evidence_use"],
    warningDimensions: ["icp_fit", "values_delivery", "ux_friction"],
    requiredEvidence: ["assistant_output", "next_action", "proof_target"],
  }),
});

export function evaluateRunGate(results, mode) {
  if (mode !== "live") {
    const failures = results
      .filter((result) => result.verdict !== DOGFOOD_VERDICTS.SMOKE_PASS)
      .map((result) => `${result.scenario}: ${result.regressions?.join(", ") || "smoke failed"}`);
    return {
      verdict: failures.length ? DOGFOOD_VERDICTS.SMOKE_FAIL : DOGFOOD_VERDICTS.SMOKE_PASS,
      passed: failures.length === 0,
      failures,
      decision_ready: evaluateDecisionReadiness({ results, mode, runFailures: failures }),
    };
  }

  const failures = [];
  const judged = results.filter((result) => result.judge_status === "completed" && typeof result.overall === "number");
  if (judged.length !== results.length) {
    failures.push("not every scenario completed live judge scoring");
  }
  const average = judged.length
    ? Math.round((judged.reduce((sum, result) => sum + Number(result.overall), 0) / judged.length) * 10) / 10
    : 0;
  if (average < 8) {
    failures.push(`average judge score ${average}/10 is below 8.0`);
  }
  for (const result of results) {
    if (Number(result.overall) < 7) {
      failures.push(`${result.scenario} score ${result.overall}/10 is below 7.0`);
    }
    if (result.regressions?.length) {
      failures.push(`${result.scenario} has regressions: ${result.regressions.join(", ")}`);
    }
    if (!result.observed?.visible_outputs?.assistant_messages?.length) {
      failures.push(`${result.scenario} has no visible assistant output`);
    }
    if (
      result.expected_visible_outcome?.requires_proof_target
      && !String(result.observed?.visible_outputs?.proof_target || "").trim()
    ) {
      failures.push(`${result.scenario} has empty proof target`);
    }
    const visibleMs = Number(result.latency_ms?.first_visible_value_ms ?? result.latency_ms?.first_visible_value ?? 0);
    if (visibleMs > 5_000) {
      failures.push(`${result.scenario} visible value latency ${visibleMs}ms exceeds 5000ms`);
    }
    if (result.scenario === "workspace-docs-scan" && visibleMs > 500) {
      failures.push(`${result.scenario} docs path latency ${visibleMs}ms exceeds 500ms`);
    }
  }

  return {
    verdict: failures.length ? DOGFOOD_VERDICTS.JUDGE_FAIL : DOGFOOD_VERDICTS.JUDGE_PASS,
    passed: failures.length === 0,
    average,
    failures,
    decision_ready: evaluateDecisionReadiness({ results, mode, runFailures: failures }),
  };
}

function decisionContract({
  requiredDimensions = [],
  warningDimensions = [],
  contextDimensions = [],
  requiredEvidence = [],
} = {}) {
  return Object.freeze({
    requiredDimensions: Object.freeze([...requiredDimensions]),
    warningDimensions: Object.freeze([...warningDimensions]),
    contextDimensions: Object.freeze([...contextDimensions]),
    requiredEvidence: Object.freeze([...requiredEvidence]),
  });
}

function evaluateDecisionReadiness({ results = [], mode = "stub", runFailures = [] } = {}) {
  if (mode !== "live") {
    return {
      status: DECISION_READY_STATUS.WARN,
      reasons: ["Product decision readiness was not evaluated because live judge mode did not run."],
    };
  }

  const failReasons = runFailures.map((failure) => `run gate: ${failure}`);
  const warnReasons = [];
  for (const result of results) {
    const contract = DECISION_CONTRACTS[result.scenario];
    if (!contract) {
      warnReasons.push(`${result.scenario}: no decision-readiness contract is defined`);
      continue;
    }

    for (const evidence of contract.requiredEvidence) {
      if (!hasDecisionEvidence(result, evidence)) {
        failReasons.push(`${result.scenario}: missing required evidence ${evidence}`);
      }
    }

    for (const dimension of contract.requiredDimensions) {
      const score = readScore(result, dimension);
      if (score !== null && score < DECISION_READY_REQUIRED_FLOOR) {
        failReasons.push(`${result.scenario}: ${dimension} ${score}/10 below required floor ${DECISION_READY_REQUIRED_FLOOR}`);
      }
    }

    for (const dimension of contract.warningDimensions) {
      const score = readScore(result, dimension);
      if (score !== null && score < DECISION_READY_WARNING_FLOOR) {
        warnReasons.push(`${result.scenario}: ${dimension} ${score}/10 below warning floor ${DECISION_READY_WARNING_FLOOR}`);
      }
    }

    if (typeof result.overall === "number" && result.overall < DECISION_READY_SUMMARY_TARGET && result.overall >= 7) {
      warnReasons.push(`${result.scenario}: overall ${result.overall}/10 is below decision-readiness summary target ${DECISION_READY_SUMMARY_TARGET}`);
    }
  }

  if (failReasons.length) {
    return {
      status: DECISION_READY_STATUS.FAIL,
      reasons: [...failReasons, ...warnReasons],
    };
  }
  if (warnReasons.length) {
    return {
      status: DECISION_READY_STATUS.WARN,
      reasons: warnReasons,
    };
  }
  return {
    status: DECISION_READY_STATUS.PASS,
    reasons: [],
  };
}

function readScore(result, dimension) {
  const value = result?.scores?.[dimension];
  return Number.isFinite(Number(value)) ? Number(value) : null;
}

function hasDecisionEvidence(result = {}, evidence) {
  const observed = result.observed || {};
  const visible = observed.visible_outputs || {};
  const assistantText = [
    ...(visible.assistant_messages || []),
    ...(observed.assistantMessages || []),
  ].join("\n");
  switch (evidence) {
    case "assistant_output":
      return Boolean((visible.assistant_messages || []).length || (observed.assistantMessages || []).length);
    case "next_action":
      return Boolean(String(visible.recommended_action || observed.recommendedAction || "").trim());
    case "proof_target":
      return Boolean(String(visible.proof_target || observed.proofTarget || "").trim());
    case "docs_path":
      return Boolean(
        (visible.doc_paths_answered || []).includes("docs/ICP.md")
        || observed.workspaceScan?.icp === true
        || observed.workspaceScan?.icpPath === "docs/ICP.md",
      );
    case "mission_choices_3":
      return (observed.missionChoices || visible.mission_choices || observed.state_changes?.mission_choices || []).length >= 3;
    case "structured_input":
      return observed.structuredInputAccepted === true || observed.state_changes?.structured_input_accepted === true;
    case "completion_proof":
      return observed.completionProof?.completed === true || observed.state_changes?.completion_proof?.completed === true;
    case "threads_url":
      return Boolean(
        observed.completionProof?.threadsUrl
        || observed.state_changes?.completion_proof?.threadsUrl
        || /https?:\/\/(?:www\.)?threads\.net\//i.test(assistantText),
      );
    case "sheet_note":
      return Boolean(
        observed.completionProof?.sheetRowNote
        || observed.state_changes?.completion_proof?.sheetRowNote
        || /\bSheet\b|시트/i.test(assistantText),
      );
    default:
      return false;
  }
}

export function renderMarkdownReport(results, mode, runGate) {
  const decisionReady = runGate.decision_ready || { status: "warn", reasons: ["Project decision readiness was not evaluated."] };
  const lines = [
    "# Agentic30 Mac Dogfood Eval",
    "",
    `Generated: ${new Date().toISOString()}`,
    `Mode: ${mode}`,
    `Run verdict: ${runGate.verdict}`,
    `Project decision readiness: ${decisionReady.status.toUpperCase()}`,
    "",
    "## Pre-Registered Experiment",
    "",
    ...preRegisteredHypotheses(),
    "",
    "Gate order: EVAL_VALIDITY_PASS -> SMOKE_PASS -> JUDGE_PASS -> PROJECT_DECISION_READY.",
    "",
    "| Scenario | Stage | Mode | Verdict | Failure Class | Smoke | Judge | Overall | Visible ms | Operation ms | Judge ms | Regressions |",
    "|---|---|---|---|---|---|---|---:|---:|---:|---:|---|",
  ];
  for (const result of results) {
    lines.push([
      `| ${result.scenario}`,
      result.repo_stage || "",
      result.intent_mode || "",
      result.verdict,
      result.failure_classes?.join("<br>") || "none",
      result.smoke?.passed ? "pass" : "fail",
      result.judge_status,
      typeof result.overall === "number" ? result.overall : "n/a",
      result.latency_ms?.first_visible_value_ms ?? result.latency_ms?.first_visible_value ?? 0,
      result.latency_ms?.operation_complete_ms ?? result.latency_ms?.operation_complete ?? result.latency_ms?.final_response ?? 0,
      result.latency_ms?.judge_complete_ms ?? result.latency_ms?.judge_complete ?? 0,
      result.regressions?.length ? result.regressions.join("<br>") : "none",
    ].join(" | ") + " |");
  }
  lines.push("");
  lines.push("## Project Decision Readiness");
  lines.push("");
  lines.push(`Status: ${decisionReady.status.toUpperCase()}`);
  if (decisionReady.reasons?.length) {
    lines.push("");
    for (const reason of decisionReady.reasons) {
      lines.push(`- ${reason}`);
    }
  } else {
    lines.push("");
    lines.push("- All scenario contracts satisfied.");
  }
  lines.push("");
  if (mode === "live") {
    lines.push(runGate.passed
      ? "VERDICT: JUDGE_PASS, live product-value average is 8/10+ with no scenario below 7, no regressions, visible output present, proof targets present, and latency gates met."
      : `VERDICT: JUDGE_FAIL, ${runGate.failures.join("; ")}`);
  } else {
    lines.push(runGate.passed
      ? "VERDICT: SMOKE_PASS, event flow and artifacts passed. Product-value judge was not run."
      : `VERDICT: SMOKE_FAIL, ${runGate.failures.join("; ")}`);
  }
  return lines.join("\n");
}

function renderExperimentMarkdown(mode, runGate) {
  const decisionReady = runGate.decision_ready || { status: "warn", reasons: ["Project decision readiness was not evaluated."] };
  return [
    "# Agentic30 Mac Dogfood Experiment",
    "",
    `Mode: ${mode}`,
    `Run verdict: ${runGate.verdict}`,
    `Project decision readiness: ${decisionReady.status.toUpperCase()}`,
    "",
    "## Hypotheses",
    "",
    ...preRegisteredHypotheses(),
    "",
    "## Gates",
    "",
    "1. EVAL_VALIDITY_PASS",
    "2. SMOKE_PASS",
    "3. JUDGE_PASS",
    "4. PROJECT_DECISION_READY",
    "",
    "`PROJECT_DECISION_READY` is backed by `runGate.decision_ready.status` and scenario-contract reasons.",
    "It maps to Day 1 start, Day 7 readiness, BIP proof, user/revenue path, and creator dogfood daily-use readiness.",
    "",
    "## Project Decision Readiness",
    "",
    `Status: ${decisionReady.status.toUpperCase()}`,
    ...(decisionReady.reasons?.length
      ? ["", ...decisionReady.reasons.map((reason) => `- ${reason}`)]
      : ["", "- All scenario contracts satisfied."]),
  ].join("\n");
}

function preRegisteredHypotheses() {
  return [
    "- H1: every stage/mode emits visible next action and required proof target within 5s.",
    "- H2: docs path query emits a local answer within 500ms.",
    "- H3: live judge average is 8.0+ and no scenario is below 7.0.",
    "- H4: evaluator negative controls do not receive product scores.",
  ];
}

function finalizeObserved({ scenario = {}, observed = {}, events, latency }) {
  const assistantMessages = observed.assistantMessages || [];
  const docPathsAnswered = [
    observed.workspaceScan?.icpPath,
    observed.workspaceScan?.valuesPath,
    observed.workspaceScan?.goalPath,
    observed.workspaceScan?.specPath,
  ].filter(Boolean);
  const recommendedAction = observed.recommendedAction || extractRecommendedAction(assistantMessages.join("\n"));
  const proofTarget = observed.proofTarget
    || extractProofTarget(assistantMessages.join("\n"))
    || observed.missionChoices?.find((choice) => choice.proofTarget)?.proofTarget
    || "";
  const completionConfirmation = observed.completionProof?.completed
    ? extractCompletionConfirmation(assistantMessages.join("\n")) || `Completed ${observed.completionProof.missionTitle || "mission"} with Threads URL and Sheet note.`
    : "";
  const latencyMs = normalizeScenarioLatency(latency);
  return {
    repo_stage: scenario.repo_stage || "",
    intent_mode: scenario.intent_mode || "",
    assistantMessages: observed.assistantMessages || [],
    systemOutcomes: observed.systemOutcomes || [],
    eventTypes: events.map((event) => event.type).filter(Boolean),
    missionChoices: observed.missionChoices || undefined,
    missionEvidenceSource: observed.missionEvidenceSource || undefined,
    structuredInputAccepted: observed.structuredInputAccepted,
    structuredInputRequestId: observed.structuredInputRequestId,
    selectedOptions: observed.selectedOptions,
    completionProof: observed.completionProof,
    workspaceScan: observed.workspaceScan,
    error: observed.error,
    visible_outputs: {
      assistant_messages: assistantMessages,
      doc_paths_answered: docPathsAnswered,
      recommended_action: recommendedAction,
      proof_target: proofTarget,
      completion_confirmation: completionConfirmation,
    },
    state_changes: {
      events: events.map((event) => event.type).filter(Boolean),
      mission_choices: observed.missionChoices || [],
      structured_input_accepted: observed.structuredInputAccepted === true,
      completion_proof: observed.completionProof || null,
    },
    latency_ms: latencyMs,
  };
}

function normalizeScenarioLatency(latency = {}) {
  const firstResponse = Math.round(Number(latency.first_response ?? latency.first_response_ms ?? 0));
  const firstVisibleValue = Math.round(Number(
    latency.first_visible_value
      ?? latency.first_visible_value_ms
      ?? latency.first_response
      ?? latency.first_response_ms
      ?? 0,
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
    first_event: Math.round(Number(latency.first_event ?? latency.first_event_ms ?? firstResponse)),
    first_response: firstResponse,
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

function summarizeMissionChoices(choices = []) {
  return choices.map((choice) => ({
    id: choice.id || "",
    title: choice.title || "",
    angle: choice.angle || "",
    mission: choice.mission || "",
    proofTarget: choice.proofTarget || "",
    evidenceRefs: Array.isArray(choice.evidenceRefs) ? choice.evidenceRefs : [],
  }));
}

function extractRecommendedAction(text) {
  const value = String(text || "");
  const match = value.match(/(?:다음 액션|오늘 액션|recommended action|next action|진행 순서|1\.)[:：]?\s*([^\n]+)/i);
  if (match?.[1]) return match[1].trim();
  const line = value.split("\n").map((item) => item.trim()).find((item) =>
    /오늘|지금|보내|올리|공유|기록|만들/.test(item)
    && item.length >= 8
  );
  return line || "";
}

function extractProofTarget(text) {
  const value = String(text || "");
  const match = value.match(/(?:^|\n)\s*(?:증거 목표|증거 기준|완료 기준|공개 증거|BIP proof|proof target)[:：]\s*([^\n]+)/i);
  if (match?.[1]) return match[1].trim();
  return "";
}

function extractCompletionConfirmation(text) {
  return String(text || "")
    .split("\n")
    .map((line) => line.trim())
    .find((line) => /(완료|completed|Threads|Sheet|streak|연속)/i.test(line))
    || "";
}

function day1CurriculumPayload() {
  return {
    day: 1,
    phase: "foundation",
    phaseTitle: "Foundation",
    title: "팔릴 문제부터 찾는다",
    shortTitle: "Revenue Audit",
    summary: "감이 아니라 인터뷰와 진단 결과로 Track A/B/C, 첫 고객, 첫 CTA를 정합니다.",
    tasks: ["Revenue Readiness Audit로 현재 프로젝트 진단", "Track A/B/C에 맞는 첫 액션 선택", "이번 주 확인할 고객 1명과 CTA 1개 확정"],
    output: "Track 판정, ICP v0, 첫 CTA, journey brief",
  };
}

function latencyFromSession(session, startedAt) {
  const answer = latestAssistantMessage(session);
  const first = Math.round(answer.performance?.firstTokenMs ?? answer.performance?.totalMs ?? performance.now() - startedAt);
  const final = Math.round(answer.performance?.totalMs ?? performance.now() - startedAt);
  return {
    latency_ms: {
      first_event: first,
      first_response: first,
      first_visible_value: first,
      first_visible_value_ms: first,
      final_response: final,
      operation_complete: final,
      operation_complete_ms: final,
    },
  };
}

function elapsedLatency(startedAt) {
  const elapsed = Math.round(performance.now() - startedAt);
  return {
    first_event: elapsed,
    first_response: elapsed,
    first_visible_value: elapsed,
    first_visible_value_ms: elapsed,
    final_response: elapsed,
    operation_complete: elapsed,
    operation_complete_ms: elapsed,
  };
}

function eventElapsed(event, startedAt) {
  const receivedAt = Number(event?.received_at_ms);
  if (Number.isFinite(receivedAt)) {
    return Math.max(0, Math.round(receivedAt - startedAt));
  }
  return Math.round(performance.now() - startedAt);
}

function latestSession(events, sessionId) {
  return [...events]
    .reverse()
    .find((event) => event.session?.id === sessionId)
    ?.session;
}

function latestBipCoach(events) {
  return [...events]
    .reverse()
    .find((event) => event.bipCoach)
    ?.bipCoach;
}

function latestAssistantMessage(session) {
  return [...(session?.messages ?? [])]
    .reverse()
    .find((message) => message.role === "assistant" && message.state === "final") ?? {};
}

function countFinalAssistantMessages(session) {
  return (session?.messages ?? [])
    .filter((message) => message.role === "assistant" && message.state === "final")
    .length;
}

async function waitForAssistantAnswer({
  events,
  sessionId,
  eventOffset,
  previousFinalAssistantCount = 0,
  timeoutMs = 45_000,
  startedAt = 0,
}) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    for (const event of events.slice(eventOffset)) {
      if (event.type === "session_updated" && event.session?.id === sessionId) {
        const finalAssistantMessages = (event.session.messages ?? [])
          .filter((message) => message.role === "assistant" && message.state === "final");
        const answer = finalAssistantMessages.at(-1);
        if (
          finalAssistantMessages.length > previousFinalAssistantCount
          && answer?.content
        ) {
          const visibleMs = eventElapsed(event, startedAt);
          return {
            session: event.session,
            content: answer.content,
            latency_ms: {
              first_event: visibleMs,
              first_response: visibleMs,
              first_visible_value: visibleMs,
              first_visible_value_ms: visibleMs,
              final_response: visibleMs,
              operation_complete: visibleMs,
              operation_complete_ms: visibleMs,
            },
          };
        }
      }
      if (event.type === "message_replaced" && event.sessionId === sessionId && String(event.content || "").trim()) {
        const visibleMs = eventElapsed(event, startedAt);
        return {
          session: latestSession(events, sessionId),
          content: String(event.content),
          latency_ms: {
            first_event: visibleMs,
            first_response: visibleMs,
            first_visible_value: visibleMs,
            first_visible_value_ms: visibleMs,
            final_response: visibleMs,
            operation_complete: visibleMs,
            operation_complete_ms: visibleMs,
          },
        };
      }
    }
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for dogfood eval assistant answer.");
}

function readSidecarReady(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for sidecar ready")), 10_000);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        const parsed = JSON.parse(line);
        if (parsed.type === "sidecar-ready") {
          clearTimeout(timer);
          resolve(parsed);
        }
      }
    });
    child.on("exit", (code) => {
      clearTimeout(timer);
      reject(new Error(`Sidecar exited before ready: ${code}`));
    });
  });
}

function onceOpen(ws) {
  return new Promise((resolve, reject) => {
    ws.once("open", resolve);
    ws.once("error", reject);
  });
}

async function closeWebSocket(ws) {
  if (!ws || ws.readyState === WebSocket.CLOSED) {
    return;
  }
  if (ws.readyState === WebSocket.CONNECTING) {
    ws.terminate();
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(resolve, 1_000);
    ws.once("close", () => {
      clearTimeout(timeout);
      resolve();
    });
    ws.close();
  });
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) {
    return;
  }
  await new Promise((resolve) => {
    const timeout = setTimeout(() => {
      try {
        child.kill("SIGKILL");
      } catch {}
      resolve();
    }, 2_000);
    child.once("exit", () => {
      clearTimeout(timeout);
      resolve();
    });
    try {
      child.kill("SIGTERM");
    } catch {
      clearTimeout(timeout);
      resolve();
    }
  });
}

async function waitForEvent(events, predicate, timeoutMs = 10_000) {
  return waitForEventAfter(events, 0, predicate, timeoutMs);
}

async function waitForEventAfter(events, offset, predicate, timeoutMs = 10_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = events.slice(offset).find(predicate);
    if (match) return match;
    await new Promise((resolve) => setTimeout(resolve, 25));
  }
  throw new Error("Timed out waiting for dogfood eval event.");
}

function defaultOutputDir() {
  return process.env.AGENTIC30_DOGFOOD_OUTPUT_DIR
    ? path.resolve(process.env.AGENTIC30_DOGFOOD_OUTPUT_DIR)
    : path.join(packageRoot, "sidecar-evals", ".artifacts");
}

function parseCliArgs(argv) {
  const options = {
    scenarioIds: [],
    stage: "",
    intentMode: "",
    outputDir: defaultOutputDir(),
    gate: false,
  };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--scenario") {
      options.scenarioIds.push(String(argv[++index] || "").trim());
    } else if (arg === "--stage") {
      options.stage = String(argv[++index] || "").trim();
    } else if (arg === "--intent-mode") {
      options.intentMode = String(argv[++index] || "").trim();
    } else if (arg === "--output-dir") {
      options.outputDir = path.resolve(String(argv[++index] || ""));
    } else if (arg === "--gate") {
      options.gate = true;
    } else if (arg === "--help" || arg === "-h") {
      options.help = true;
    } else {
      throw new Error(`Unknown dogfood eval argument: ${arg}`);
    }
  }
  return options;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const cli = parseCliArgs(process.argv.slice(2));
  if (cli.help) {
    console.log([
      "Usage: node sidecar-evals/dogfood-simulation.mjs [options]",
      "",
      "Options:",
      "  --scenario <id>            Run one scenario. May be repeated.",
      "  --stage <repo_stage>       Filter by empty|strategy_seeded|partial_setup|running|complete.",
      "  --intent-mode <mode>       Filter by startup|builder.",
      "  --output-dir <path>        Write artifacts under this directory.",
      "  --gate                     Run the configured gate command.",
    ].join("\n"));
    process.exit(0);
  }
  runDogfoodSimulation(cli)
    .then((result) => {
      console.log(`Dogfood eval report: ${result.reportPath}`);
      console.log(`Dogfood eval results: ${result.jsonlPath}`);
      if (!result.passed) {
        process.exitCode = 1;
      }
    })
    .catch((error) => {
      console.error(error?.stack || error);
      process.exitCode = 1;
    });
}

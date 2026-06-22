#!/usr/bin/env node
/**
 * Office Hours Day-arc simulation.
 *
 * dogfood-simulation.mjs replays isolated single-touchpoint scenarios. This
 * harness instead drives the *continuous* office-hours arc through the real
 * sidecar: onboarding structured-input handshake -> office_hours_start
 * forcing-question loop -> day_progress commit -> next-day adaptation -> gate
 * authority. It answers as a configurable ICP persona so the run exercises the
 * specificity ladder, avoidance ("costume") naming, and the day-entry gates.
 *
 * Modes (same posture as the dogfood evaluator):
 *   - stub (default): AGENTIC30_TEST_STUB_PROVIDER=1, deterministic, CI-safe.
 *     Provider text is stubbed; the structured-input flow and the day-progress
 *     gates (provider-independent ledger checks) still run for real.
 *   - live: AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1, real provider. Captures the
 *     actual forcing questions and adaptation.
 *
 * Artifacts land under sidecar-evals/.artifacts/ (gitignored). Nothing here
 * touches dogfood-simulation.mjs — it is a composable sibling.
 *
 * Pure exports (personas, plan, response selection, run summary) are unit-tested
 * in sidecar-tests/office-hours-arc-simulation.test.mjs; the sidecar-spawning
 * runner is exercised via `npm run sim:office-hours[:live]`.
 */
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { projectDocPath } from "../sidecar/project-doc-paths.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_DEFAULT = process.env.AGENTIC30_RUN_LIVE_PROVIDER_EVAL === "1";

/**
 * Persona answer scripts. Each answer is consumed in order as the session asks
 * structured inputs (onboarding questions first, then office-hours forcing
 * questions). The default persona is the canonical ICP: a full-time solo macOS
 * developer with zero revenue, deliberately routed through an avoidance turn so
 * the run probes whether office-hours names the "costume" (VALUES #3) and climbs
 * the specificity ladder (ICP fit).
 */
export const OFFICE_HOURS_ARC_PERSONAS = Object.freeze({
  "icp-solo-dev": {
    id: "icp-solo-dev",
    label: "전업 1인 개발자 (0매출·macOS·Codex)",
    mode: "startup",
    description:
      "ICP 정합 페르소나. polite interest만 있는 상태(증거 0)에서 시작해, 실명 제시 → 정직한 0 자백 → 코드 회피 → 회피 수용 후 구체 커밋으로 진단력을 자극한다.",
    answers: Object.freeze([
      "나는 퇴사한 전업 1인 개발자예요. macOS에서 Codex로 SaaS 사이드프로젝트를 만들고 있고 아직 수익은 0원이에요.",
      '아직 결제나 계약은 없어요. 지인 몇 명이 "오 괜찮네요" 했지만 돈 얘기는 안 나왔어요. 가격을 물어본 사람은 1명 있었어요.',
      "조은성이라는 1인 개발자요. 클로드 코드로 사이드 프로젝트 만드는 분이고 아직 수익은 없어요.",
      "그분은 지금 노션에 혼자 TODO 적으면서 해요. 최근 2주에 이 문제로 쓴 돈은... 솔직히 0원이에요.",
      "오늘 뭘 보내야 할지 잘 모르겠어요. 일단 온보딩 코드를 좀 더 다듬고 데모를 멋지게 만든 다음에 보여주는 게 낫지 않을까요?",
      '맞아요, 또 코드로 도망쳤네요. 오늘 조은성에게 카톡으로 "이 검증 문제로 30분만 통화 가능하냐"고 보낼게요. 캡처 남길게요.',
      "네, 그걸로 오늘 마무리할게요.",
    ]),
    commitment: Object.freeze({
      customer: "조은성",
      channel: "kakao",
      message: "이 검증 문제로 30분 통화 가능?",
      expectedEvidenceKind: "screenshot",
      text: "조은성에게 카톡으로 이 검증 문제 30분 통화 요청 + 캡처",
    }),
  },
  "builder-side-project": {
    id: "builder-side-project",
    label: "빌더 모드 (사이드프로젝트·학습)",
    mode: "builder",
    description: "builder intent 페르소나. 수익보다 공개 산출물/학습 증거 루프를 따른다.",
    answers: Object.freeze([
      "주말마다 만드는 사이드프로젝트예요. 매출보다는 공개하고 배우는 게 목표예요.",
      "아직 사용자는 없어요. 깃허브에 올렸지만 반응은 못 봤어요.",
      "오늘은 핵심 화면 하나를 공개하고 반응을 보려고 해요.",
      "Threads에 데모 1개 올리고 링크를 남길게요.",
      "네, 그걸로 마무리할게요.",
    ]),
    commitment: Object.freeze({
      customer: "공개 채널 관찰자",
      channel: "threads",
      message: "데모 1개 공개 + 반응 관찰",
      expectedEvidenceKind: "url",
      text: "Threads에 데모 공개하고 공개 URL 남기기",
    }),
  },
});

/**
 * Default Day-arc plan. Each step drives one program day. The plan deliberately
 * spans the first gate boundary (Day 8 / G2) because the gate authority is the
 * provider-independent contract worth asserting deterministically.
 */
export const DEFAULT_ARC_PLAN = Object.freeze([
  { day: 1, runOfficeHours: true, maxTurns: 6, commit: true, expectGateBlock: null },
  { day: 2, runOfficeHours: true, maxTurns: 3, commit: false, expectGateBlock: null },
  { day: 8, runOfficeHours: false, commit: false, expectGateBlock: "G2", commitStep: "scan" },
]);

/**
 * Choose the structured-input response for one question. Pure + deterministic so
 * it can be unit-tested without a sidecar. Prefers a persona free-text answer
 * for the current turn; if the question is office-hours demand-evidence with the
 * fixed option set, picks the honest "no evidence yet" option to keep the ICP
 * (N=0) realistic instead of inflating polite interest.
 */
export function selectStructuredResponse({ question, persona, turnIndex }) {
  const answers = persona?.answers || [];
  const freeText = answers[Math.min(turnIndex, answers.length - 1)] || "";
  const q = question || {};
  const options = Array.isArray(q.options) ? q.options : [];
  const signalId = q.signalId || q.generation?.signalId || "";
  // Office Hours Q1 demand-evidence: honest "no evidence yet" is the realistic
  // ICP answer and the one that tests whether the product lowers polite interest.
  if (/demand_evidence/i.test(signalId) && options.length) {
    const honest = options.find((o) => /관심만|증거가 없|no evidence|아직/i.test(o.label || o.description || ""));
    return { selectedOptions: honest ? [honest.label] : [], freeText };
  }
  return { selectedOptions: [], freeText };
}

/**
 * Reduce a completed arc run into provider-independent smoke assertions. Used by
 * the runner's verdict and by tests. Gate-block behavior is the hard contract;
 * forcing-question capture is informational (stub may not emit real questions).
 */
export function summarizeArcRun(captured = {}) {
  const days = Array.isArray(captured.days) ? captured.days : [];
  const gate = captured.gate || {};
  const gateBlock = gate.gateBlocked || null;
  const forcingQuestions = days.reduce((sum, d) => sum + (d.questions?.length || 0), 0);
  // New requestId reusing a signalId already asked this day = product re-asked the
  // same forcing question (contact-fixation signal), distinct from a harness re-read.
  const repeatedForcingSignals = days.flatMap((d) => d.repeatedQuestionSignals || []);
  const onboardingDrained = Number(captured.onboardingAnswered || 0);
  const expectedGate = captured.expectedGateBlock || null;
  const gateBlockWorks = expectedGate
    ? Boolean(gateBlock && gateBlock.gateId === expectedGate)
    : true;
  return {
    onboardingDrained,
    forcingQuestionsCaptured: forcingQuestions,
    repeatedForcingSignals,
    contactFixationObserved: repeatedForcingSignals.length > 0,
    daysRun: days.length,
    gateBlockExpected: expectedGate,
    gateBlockObserved: gateBlock?.gateId || null,
    gateBlockWorks,
    gateRequiredEvidence: (gateBlock?.requiredEvidence || []).map((e) => e.id || e.label || e),
    errors: captured.errors || [],
    passed: gateBlockWorks && (captured.errors || []).length === 0,
  };
}

// ── WS plumbing (self-contained; mirrors dogfood-simulation.mjs patterns) ──────

function readSidecarReady(child) {
  return new Promise((resolve, reject) => {
    let buffer = "";
    const timer = setTimeout(() => reject(new Error("Timed out waiting for sidecar ready")), 15_000);
    child.stdout.on("data", (chunk) => {
      buffer += String(chunk);
      const lines = buffer.split("\n");
      buffer = lines.pop() || "";
      for (const line of lines) {
        if (!line.trim()) continue;
        let parsed;
        try { parsed = JSON.parse(line); } catch { continue; }
        if (parsed.type === "sidecar-ready" && Number.isFinite(parsed.port) && parsed.authToken) {
          clearTimeout(timer);
          resolve(parsed);
        }
      }
    });
    child.on("exit", (code) => { clearTimeout(timer); reject(new Error(`Sidecar exited before ready: ${code}`)); });
  });
}
const onceOpen = (ws) => new Promise((res, rej) => { ws.once("open", res); ws.once("error", rej); });
async function waitForEventAfter(events, offset, predicate, timeoutMs = 60_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const match = events.slice(offset).find(predicate);
    if (match) return match;
    await new Promise((r) => setTimeout(r, 40));
  }
  return null;
}
const latestSession = (events, sid) => [...events].reverse().find((e) => e.session?.id === sid)?.session;
const finalAssistants = (s) => (s?.messages ?? []).filter((m) => m.role === "assistant" && m.state === "final");

/** Pull the current pending structured-input request for a session, if any. */
function pendingInputFor(events, sessionId) {
  const sess = latestSession(events, sessionId);
  return sess?.pendingUserInput || null;
}

// ── Fixture: an onboarding-complete ICP workspace ─────────────────────────────

async function seedWorkspace(persona) {
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "a30-oh-arc-"));
  const docsDir = path.dirname(path.join(root, projectDocPath("icp")));
  await fs.mkdir(docsDir, { recursive: true });
  for (const type of ["icp", "values", "goal", "spec"]) {
    const rel = projectDocPath(type);
    const src = path.join(packageRoot, "docs", path.basename(rel));
    try { await fs.copyFile(src, path.join(root, rel)); } catch { /* docs optional */ }
  }
  // Approved IDD foundation so office-hours starts past onboarding setup.
  const iddDir = path.join(root, ".agentic30", "idd");
  await fs.mkdir(iddDir, { recursive: true });
  const now = new Date().toISOString();
  await fs.writeFile(path.join(iddDir, "setup-state.json"), JSON.stringify({
    schemaVersion: 1, status: "approved", currentDocType: "spec",
    docOrder: ["icp", "goal", "values", "spec"],
    transcript: [{ at: now, role: "system", docType: "spec", content: "arc-sim seed" }],
    ambiguityScore: 12, unresolvedAssumptions: [], drafts: {},
    approvedAt: now,
    approvedDocPaths: ["icp", "goal", "values", "spec"].map((t) => projectDocPath(t)),
    lastProvider: "codex", providerRecovery: null, updatedAt: now,
  }, null, 2));
  await fs.mkdir(path.join(root, "transcripts"), { recursive: true });
  await fs.writeFile(path.join(root, "transcripts", "interview-1.md"),
    "# 인터뷰\n고객: 에이전트 코딩으로 여러 제품을 만들었지만 매출 0. 무엇을 팔지 모름. 인터뷰는 해보겠다고 함.");
  await fs.writeFile(path.join(root, "README.md"), `# ${persona.label}\nmacOS 1인 개발 프로젝트.`);
  // git source readiness for the daily digest gate.
  try {
    const g = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    g(["init"]); g(["config", "user.email", "sim@test.local"]); g(["config", "user.name", "arc-sim"]);
    g(["add", "-A"]); g(["commit", "-m", "seed"]);
  } catch { /* git optional */ }
  return root;
}

async function writeBipConfig(appSupportPath, root) {
  await fs.mkdir(appSupportPath, { recursive: true });
  await fs.writeFile(path.join(appSupportPath, "bip-config.json"), JSON.stringify({
    workspace: {
      root,
      icp: projectDocPath("icp"), values: projectDocPath("values"),
      goal: projectDocPath("goal"), spec: projectDocPath("spec"),
      designSystem: "", adr: "", docs: "", sheet: "",
    },
    externalDocs: { googleDocs: [], googleSheets: [], notion: [] },
    social: { threads: "october", x: "" },
  }, null, 2));
}

// ── Session drivers ───────────────────────────────────────────────────────────

/** Answer one pending structured input as the persona; returns the question shape. */
function answerPendingInput({ ws, events, sessionId, pending, persona, turnIndex }) {
  const q = pending.questions?.[0] || {};
  const question = {
    header: q.header || "",
    question: q.question || "",
    options: (q.options || []).map((o) => o.label),
    signalId: pending.generation?.signalId || "",
    mode: pending.generation?.mode || "",
  };
  const resp = selectStructuredResponse({
    question: { ...q, signalId: question.signalId },
    persona,
    turnIndex,
  });
  ws.send(JSON.stringify({
    type: "submit_user_input",
    sessionId,
    requestId: pending.requestId,
    responses: [{ question: question.question || "선택", selectedOptions: resp.selectedOptions, freeText: resp.freeText }],
  }));
  return question;
}

/** Drain non-office-hours onboarding structured inputs before starting office-hours. */
async function drainOnboarding({ ws, events, sessionId, persona, answeredRequestIds, maxInputs = 4 }) {
  let answered = 0;
  for (let i = 0; i < maxInputs; i++) {
    const pending = pendingInputFor(events, sessionId);
    if (!pending || answeredRequestIds.has(pending.requestId)) break;
    if (isOfficeHoursMode(pending.generation?.mode)) break; // already in office-hours
    const offset = events.length;
    answerPendingInput({ ws, events, sessionId, pending, persona, turnIndex: answered });
    answeredRequestIds.add(pending.requestId);
    answered++;
    await waitForEventAfter(events, offset, (e) =>
      e.type === "session_updated" && e.session?.id === sessionId, 60_000);
  }
  return answered;
}

const isOfficeHoursMode = (mode) => /office_hours/i.test(String(mode || ""));

async function runOfficeHoursDay({ ws, events, sessionId, day, maxTurns, persona, baseTurn, answeredRequestIds }) {
  const dayLog = { day, questions: [], assistantMessages: [], outcome: "", eventTypesSeen: [], repeatedQuestionSignals: [] };
  const startOffset = events.length;
  const pendingFromEvent = (e) => {
    if (e.type === "office_hours_pending_input" && e.sessionId === sessionId) return e.pendingUserInput;
    if (e.type === "session_updated" && e.session?.id === sessionId && isOfficeHoursMode(e.session?.pendingUserInput?.generation?.mode)) return e.session.pendingUserInput;
    return null;
  };
  ws.send(JSON.stringify({
    type: "office_hours_start",
    sessionId,
    day,
    visiblePrompt: `Day ${day} Office Hours`,
    source: "manual",
    selectedSources: ["git"],
  }));
  const seenSignals = new Set();
  let turn = 0;
  for (; turn < maxTurns; turn++) {
    // Only match an *unanswered* pending input so the loop advances instead of
    // re-reading the same forcing-question event each turn.
    const ev = await waitForEventAfter(events, startOffset, (e) => {
      const p = pendingFromEvent(e);
      if (p && !answeredRequestIds.has(p.requestId)) return true;
      return (e.type === "office_hours_status" && e.sessionId === sessionId && e.stage === "completed") || e.type === "error";
    }, 90_000);
    if (!ev) { dayLog.outcome = `turn${turn}: timeout`; break; }
    if (ev.type === "error") { dayLog.outcome = `turn${turn}: error ${ev.message || ""}`; break; }
    if (ev.type === "office_hours_status" && ev.stage === "completed") { dayLog.outcome = `completed@${turn}`; break; }
    const pending = pendingFromEvent(ev);
    if (!pending) { dayLog.outcome = `turn${turn}: ${ev.type} without pending`; break; }
    const question = answerPendingInput({ ws, events, sessionId, pending, persona, turnIndex: baseTurn + turn });
    answeredRequestIds.add(pending.requestId);
    // A new requestId that reuses the same signalId == the product re-asked the
    // same forcing question (contact-fixation signal, v2 spec §4), not a harness
    // re-read. Record it so the verdict can distinguish the two.
    if (question.signalId && seenSignals.has(question.signalId)) dayLog.repeatedQuestionSignals.push(question.signalId);
    if (question.signalId) seenSignals.add(question.signalId);
    dayLog.questions.push({ turn, requestId: pending.requestId, ...question });
    const terminal = Boolean(pending.terminal) || /대안|마무리|정리|alternatives/i.test(question.header);
    if (terminal) { dayLog.outcome = `terminal@${turn}`; break; }
  }
  if (!dayLog.outcome) dayLog.outcome = `maxTurns(${maxTurns})`;
  dayLog.eventTypesSeen = [...new Set(events.slice(startOffset).map((e) => e.type))];
  dayLog.assistantMessages = finalAssistants(latestSession(events, sessionId)).slice(-2).map((m) => m.content);
  return { dayLog, turnsUsed: turn };
}

// ── Main runner ───────────────────────────────────────────────────────────────

export async function runOfficeHoursArcSimulation({
  outputDir = defaultOutputDir(),
  mode = LIVE_DEFAULT ? "live" : "stub",
  personaId = "icp-solo-dev",
  plan = DEFAULT_ARC_PLAN,
} = {}) {
  const persona = OFFICE_HOURS_ARC_PERSONAS[personaId];
  if (!persona) throw new Error(`Unknown persona "${personaId}". Known: ${Object.keys(OFFICE_HOURS_ARC_PERSONAS).join(", ")}`);

  const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const runDir = path.join(outputDir, `office-hours-arc-${runId}`);
  await fs.mkdir(runDir, { recursive: true });

  const workspaceRoot = await seedWorkspace(persona);
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "a30-oh-arc-app-"));
  await writeBipConfig(appSupportPath, workspaceRoot);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", workspaceRoot], {
    cwd: packageRoot,
    env: {
      ...process.env,
      AGENTIC30_APP_SUPPORT_PATH: appSupportPath,
      AGENTIC30_CODEX_MODEL: process.env.AGENTIC30_CODEX_MODEL || "gpt-5.4-mini",
      ...(mode === "stub" ? { AGENTIC30_TEST_STUB_PROVIDER: "1", AGENTIC30_DISABLE_QMD_BOOTSTRAP: "1" } : {}),
    },
    stdio: ["ignore", "pipe", "pipe"],
  });
  let stderr = "";
  child.stderr.on("data", (c) => { stderr += String(c); });

  const captured = { runId, mode, personaId, workspaceRoot, days: [], onboardingAnswered: 0, gate: null, day1Commit: null, expectedGateBlock: null, errors: [] };
  const events = [];
  let ws;
  try {
    const ready = await readSidecarReady(child);
    ws = new WebSocket(`ws://127.0.0.1:${ready.port}`);
    ws.on("message", (raw) => { try { events.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: "authenticate", authToken: ready.authToken }));
    if (!await waitForEventAfter(events, 0, (e) => e.type === "ready", 30_000)) throw new Error("no ready event");
    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini" }));
    const created = await waitForEventAfter(events, 0, (e) => e.type === "session_created", 30_000);
    if (!created) throw new Error("no session_created");
    const sessionId = created.session.id;

    const answeredRequestIds = new Set();
    captured.onboardingAnswered = await drainOnboarding({ ws, events, sessionId, persona, answeredRequestIds });

    let baseTurn = captured.onboardingAnswered;
    for (const step of plan) {
      if (step.runOfficeHours) {
        try {
          const { dayLog, turnsUsed } = await runOfficeHoursDay({
            ws, events, sessionId, day: step.day, maxTurns: step.maxTurns || 4, persona, baseTurn, answeredRequestIds,
          });
          captured.days.push(dayLog);
          baseTurn += turnsUsed;
        } catch (e) { captured.errors.push(`day${step.day} office-hours: ${e.message}`); }
      }
      if (step.commit) {
        const offset = events.length;
        ws.send(JSON.stringify({
          type: "day_progress_patch", sessionId, workspaceRoot,
          stepId: "first_interview", status: "done", day: step.day,
          commitmentText: persona.commitment.text, commitment: persona.commitment,
        }));
        const patched = await waitForEventAfter(events, offset, (e) => e.type === "day_progress_state", 30_000);
        captured.day1Commit = patched
          ? { gateBlocked: patched.gateBlocked || null, currentDay: patched.currentDay ?? null }
          : { error: "no day_progress_state" };
      }
      if (step.expectGateBlock) {
        captured.expectedGateBlock = step.expectGateBlock;
        const offset = events.length;
        ws.send(JSON.stringify({
          type: "day_progress_patch", sessionId, workspaceRoot,
          day: step.day, stepId: step.commitStep || "scan", status: "done",
        }));
        const gate = await waitForEventAfter(events, offset, (e) =>
          e.type === "day_progress_state" && (e.gateBlocked || e.message), 30_000);
        captured.gate = gate ? { gateBlocked: gate.gateBlocked || null, message: gate.message || "" } : { error: "no gate response" };
      }
    }
  } catch (e) {
    captured.errors.push(`fatal: ${e.message}`);
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    await terminateChild(child);
    if (stderr.trim()) captured.stderrTail = stderr.split("\n").slice(-15).join("\n");
  }

  const summary = summarizeArcRun(captured);
  await fs.writeFile(path.join(runDir, "captured.json"), JSON.stringify(captured, null, 2) + "\n");
  await fs.writeFile(path.join(runDir, "report.md"), renderArcReport(captured, summary, persona));
  await fs.rm(workspaceRoot, { recursive: true, force: true });
  await fs.rm(appSupportPath, { recursive: true, force: true });
  return { runDir, captured, summary, passed: summary.passed };
}

function renderArcReport(captured, summary, persona) {
  const lines = [
    "# Office Hours Day-arc Simulation",
    "",
    `Run: ${captured.runId}`,
    `Mode: ${captured.mode}`,
    `Persona: ${persona.label} (${captured.personaId})`,
    `Verdict: ${summary.passed ? "PASS" : "FAIL"}`,
    "",
    "## Smoke summary",
    `- onboarding structured inputs drained: ${summary.onboardingDrained}`,
    `- office-hours forcing questions captured: ${summary.forcingQuestionsCaptured}`,
    `- gate-block expected: ${summary.gateBlockExpected || "(none)"} · observed: ${summary.gateBlockObserved || "(none)"} · works: ${summary.gateBlockWorks}`,
    summary.gateRequiredEvidence.length ? `- gate required evidence: ${summary.gateRequiredEvidence.join(", ")}` : "",
    summary.errors.length ? `- errors: ${summary.errors.join("; ")}` : "",
    "",
  ];
  for (const d of captured.days) {
    lines.push(`## Day ${d.day} — ${d.outcome}`, "");
    for (const q of d.questions) {
      lines.push(`### [turn ${q.turn}] ${q.header} (signalId: ${q.signalId || "-"}, mode: ${q.mode || "-"})`);
      lines.push(`Q: ${q.question}`);
      if (q.options.length) lines.push(`options: ${q.options.join(" | ")}`);
      lines.push(`→ persona[${persona.answers[Math.min(q.turn, persona.answers.length - 1)] ? "answered" : "-"}]`, "");
    }
    if (d.assistantMessages.length) {
      lines.push("assistant:", ...d.assistantMessages.map((m) => "> " + String(m).replace(/\n/g, "\n> ")), "");
    }
  }
  lines.push("## Day commit", "```json", JSON.stringify(captured.day1Commit, null, 2), "```", "");
  lines.push("## Gate authority", "```json", JSON.stringify(captured.gate, null, 2), "```");
  return lines.filter((l) => l !== "").join("\n") + "\n";
}

function defaultOutputDir() {
  return process.env.AGENTIC30_DOGFOOD_OUTPUT_DIR
    ? path.resolve(process.env.AGENTIC30_DOGFOOD_OUTPUT_DIR)
    : path.join(packageRoot, "sidecar-evals", ".artifacts");
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } resolve(); }, 2_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    try { child.kill("SIGTERM"); } catch { clearTimeout(timeout); resolve(); }
  });
}

// ── CLI ───────────────────────────────────────────────────────────────────────

function parseCliArgs(argv) {
  const opts = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--persona") opts.personaId = argv[++i];
    else if (a === "--live") opts.mode = "live";
    else if (a === "--stub") opts.mode = "stub";
  }
  return opts;
}

if (import.meta.url === `file://${process.argv[1]}`) {
  runOfficeHoursArcSimulation(parseCliArgs(process.argv.slice(2)))
    .then((result) => {
      console.log(`Office Hours arc report: ${path.join(result.runDir, "report.md")}`);
      console.log(`Verdict: ${result.passed ? "PASS" : "FAIL"} · ${JSON.stringify(result.summary)}`);
      process.exit(result.passed ? 0 : 1);
    })
    .catch((error) => { console.error(error); process.exit(1); });
}

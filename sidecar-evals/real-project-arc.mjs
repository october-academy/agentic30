#!/usr/bin/env node
/**
 * Real-project Office Hours arc harness.
 *
 * office-hours-arc-simulation.mjs seeds a synthetic ICP fixture. This sibling
 * instead points the *real* sidecar at a real user project (e.g. ../dongdong or
 * the agentic30 repo itself), so the locked Day-1 get_users ladder + the
 * project-context injection (Part A) are exercised against authentic derived
 * context. Nothing here mutates the source project: it copies the project's
 * .agentic30 state + product docs into a throwaway temp workspace.
 *
 * It faithfully mirrors the Mac client's DAY1_LOCKED_GOAL context builder
 * (ContentView.swift ~10411-10499) so office_hours_start enters the same locked
 * get_users flow the real app produces. Without that context the sidecar runs a
 * generic open-ended interview, NOT the surface we are measuring.
 *
 * LIVE only is meaningful (stub returns canned cards). Use AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1.
 */
import fs from "node:fs/promises";
import fssync from "node:fs";
import os from "node:os";
import path from "node:path";
import { spawn, execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { WebSocket } from "ws";
import { projectDocPath } from "../sidecar/project-doc-paths.mjs";
import { refreshProjectContextCache } from "../sidecar/project-context-cache.mjs";
import { selectStructuredResponse, OFFICE_HOURS_ARC_PERSONAS } from "./office-hours-arc-simulation.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const LIVE_DEFAULT = process.env.AGENTIC30_RUN_LIVE_PROVIDER_EVAL === "1";

// ── helpers: sidecar ready / ws events ──────────────────────────────────────
async function readSidecarReady(child, timeoutMs = 30_000) {
  return new Promise((resolve, reject) => {
    let buf = "";
    const timer = setTimeout(() => reject(new Error("sidecar ready timeout")), timeoutMs);
    const onData = (chunk) => {
      buf += String(chunk);
      for (const line of buf.split("\n")) {
        try {
          const msg = JSON.parse(line);
          if (msg?.type === "sidecar-ready" && msg.port) {
            clearTimeout(timer);
            child.stdout.off("data", onData);
            resolve({ port: msg.port, authToken: msg.authToken });
            return;
          }
        } catch { /* partial line */ }
      }
    };
    child.stdout.on("data", onData);
  });
}

const onceOpen = (ws) => new Promise((resolve, reject) => {
  ws.once("open", resolve);
  ws.once("error", reject);
});

async function waitForEventAfter(events, offset, predicate, timeoutMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    for (let i = offset; i < events.length; i++) {
      if (predicate(events[i])) return events[i];
    }
    if (Date.now() > deadline) return null;
    await new Promise((r) => setTimeout(r, 150));
  }
}

/**
 * Wait until the office-hours run that attached the current card has fully
 * settled before submitting the answer. Production works because a human answers
 * seconds later (the run has finished); a harness that submits the instant the
 * pending event arrives races the run's finalize/attach and trips the
 * "no pending request was attachable" continuation error. We settle by waiting
 * for the event stream to go quiet (no new events) for quietMs.
 */
async function waitForRunSettle(events, { quietMs = 2500, maxWaitMs = 30_000 } = {}) {
  const deadline = Date.now() + maxWaitMs;
  let lastLen = events.length;
  let lastChange = Date.now();
  for (;;) {
    if (events.length !== lastLen) { lastLen = events.length; lastChange = Date.now(); }
    if (Date.now() - lastChange >= quietMs) return;
    if (Date.now() > deadline) return;
    await new Promise((r) => setTimeout(r, 200));
  }
}

const isOfficeHoursMode = (mode) => /office_hours/i.test(String(mode || ""));

function pendingInputFor(events, sessionId) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "office_hours_pending_input" && e.sessionId === sessionId) return e.pendingUserInput;
    if ((e.type === "session_updated" || e.type === "session_created") && e.session?.id === sessionId) {
      // A later session_updated with no pendingUserInput means it was cleared.
      if (e.session?.pendingUserInput) return e.session.pendingUserInput;
      return null;
    }
  }
  return null;
}

function latestSession(events, sessionId) {
  for (let i = events.length - 1; i >= 0; i--) {
    const e = events[i];
    if (e.type === "session_updated" && e.session?.id === sessionId) return e.session;
    if (e.type === "session_created" && e.session?.id === sessionId) return e.session;
  }
  return null;
}

function finalAssistants(session) {
  const messages = session?.messages || [];
  return messages.filter((m) => m.role === "assistant" && String(m.content || "").trim());
}

async function terminateChild(child) {
  if (!child || child.exitCode !== null || child.signalCode !== null) return;
  await new Promise((resolve) => {
    const timeout = setTimeout(() => { try { child.kill("SIGKILL"); } catch { /* ignore */ } resolve(); }, 3_000);
    child.once("exit", () => { clearTimeout(timeout); resolve(); });
    try { child.kill("SIGTERM"); } catch { clearTimeout(timeout); resolve(); }
  });
}

async function copyIfExists(src, dest) {
  try {
    await fs.mkdir(path.dirname(dest), { recursive: true });
    await fs.copyFile(src, dest);
    return true;
  } catch { return false; }
}

function readJsonSync(p) {
  try { return JSON.parse(fssync.readFileSync(p, "utf8")); } catch { return null; }
}

// ── real-project seed ───────────────────────────────────────────────────────
/**
 * Seed a throwaway workspace from a real project. Copies the project's derived
 * .agentic30 memory/goal/context + product docs so the sidecar reads authentic
 * context. Seeds an approved IDD foundation so office-hours starts past setup.
 * Returns { root, day1Goal, onboarding, projectContext }.
 */
async function seedRealProjectWorkspace(projectPath, { goalOverride = null, projectContextOverride = null } = {}) {
  const srcRoot = path.resolve(projectPath);
  const root = await fs.mkdtemp(path.join(os.tmpdir(), "a30-real-arc-"));

  // 1) product docs → .agentic30/docs/. Prefer the project's own; fall back to
  //    the repo docs/ only when seeding the agentic30 repo itself.
  for (const type of ["icp", "values", "goal", "spec"]) {
    const rel = projectDocPath(type);
    const base = path.basename(rel);
    const candidates = [
      path.join(srcRoot, rel),                 // project .agentic30/docs/
      path.join(srcRoot, "docs", base),        // repo docs/ (agentic30 itself)
    ];
    for (const c of candidates) {
      if (await copyIfExists(c, path.join(root, rel))) break;
    }
  }

  // 2) real DERIVED context only (onboarding + scan output + locked goal). We
  //    deliberately DO NOT copy prior office-hours session state (turns,
  //    day-progress, day-rollup, pending): those make the sidecar hydrate/restore
  //    a stale Day-1 runtime on boot, which makes office_hours_start refuse with
  //    "waiting for structured input". A clean Day-1 simulation needs fresh
  //    office-hours state but authentic project context.
  // NOTE: project-context.json is deliberately NOT copied. The source project's
  // cached context may predate the PDF-extraction derivation; we regenerate it
  // fresh below (refreshProjectContextCache) so the simulation reflects a current
  // scan of the real project content (e.g. dongdong's proposal PDF).
  const memFiles = [
    "day1-goal.json",
    "memory/onboarding.json",
  ];
  for (const rel of memFiles) {
    await copyIfExists(path.join(srcRoot, ".agentic30", rel), path.join(root, ".agentic30", rel));
  }

  // 3) domain content that drives derivation/grounding (README, top-level docs).
  for (const name of ["README.md", "README.txt", "project_proposal.pdf"]) {
    await copyIfExists(path.join(srcRoot, name), path.join(root, name));
  }

  // 4) optional overrides (synthesize a goal/context for projects lacking one).
  if (goalOverride) {
    await fs.mkdir(path.join(root, ".agentic30"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "day1-goal.json"), JSON.stringify(goalOverride, null, 2));
  }
  if (projectContextOverride) {
    await fs.mkdir(path.join(root, ".agentic30", "memory"), { recursive: true });
    await fs.writeFile(path.join(root, ".agentic30", "memory", "project-context.json"), JSON.stringify(projectContextOverride, null, 2));
  } else {
    // Fresh derive from the copied real project content (incl. PDF) — the same
    // path a real onboarding/scan would take, so PDF-extracted domain signal
    // flows into the office-hours project-context brief.
    await refreshProjectContextCache({ workspaceRoot: root, reason: "real_arc_seed" }).catch(() => null);
  }

  // 5) approved IDD foundation so office-hours starts past onboarding setup.
  const iddDir = path.join(root, ".agentic30", "idd");
  await fs.mkdir(iddDir, { recursive: true });
  const now = new Date().toISOString();
  await fs.writeFile(path.join(iddDir, "setup-state.json"), JSON.stringify({
    schemaVersion: 1, status: "approved", currentDocType: "spec",
    docOrder: ["icp", "goal", "values", "spec"],
    transcript: [{ at: now, role: "system", docType: "spec", content: "real-arc seed" }],
    ambiguityScore: 12, unresolvedAssumptions: [], drafts: {},
    approvedAt: now,
    approvedDocPaths: ["icp", "goal", "values", "spec"].map((t) => projectDocPath(t)),
    lastProvider: "codex", providerRecovery: null, updatedAt: now,
  }, null, 2));

  // 6) git readiness for the daily digest gate.
  try {
    const g = (args) => execFileSync("git", args, { cwd: root, stdio: "ignore" });
    g(["init"]); g(["config", "user.email", "sim@test.local"]); g(["config", "user.name", "real-arc"]);
    g(["add", "-A"]); g(["commit", "-m", "seed"]);
  } catch { /* git optional */ }

  return {
    root,
    day1Goal: readJsonSync(path.join(root, ".agentic30", "day1-goal.json")),
    onboarding: readJsonSync(path.join(root, ".agentic30", "memory", "onboarding.json")),
    projectContext: readJsonSync(path.join(root, ".agentic30", "memory", "project-context.json")),
  };
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

// ── DAY1_LOCKED_GOAL context (mirrors ContentView.swift ~10411-10499) ────────
const GOAL_TITLE = Object.freeze({
  get_users: "활성 사용자 100명 모으기",
  make_money: "첫 유료 결제 만들기",
  build_product: "핵심 흐름 완주율 달성",
});

export function buildDay1LockedGoalContext({ day, goal, onboarding, projectContext, mode = { label: "스타트업", detail: "고객/수요 검증", questionCount: 6 } }) {
  const lines = [
    "Office Hours screen context",
    `Office Hours day: ${day}`,
  ];
  if (goal) {
    if (day === 1) {
      lines.push("DAY1_LOCKED_GOAL", "Flow contract: locked Day 1 goal interview.");
    } else {
      lines.push("DAY1_FOUNDATION_GOAL", "DAY2_PLUS_GOAL_DRIVEN_OFFICE_HOURS",
        `Flow contract: Day ${day} goal-driven Office Hours scoped to the locked Day 1 30-day goal.`,
        "30-day goal source of truth: Day1GoalSelection.goalType");
    }
    const goalType = goal.goalType || "get_users";
    lines.push(`Goal lane: ${goalType} / ${GOAL_TITLE[goalType] || goalType}`);
    lines.push(`Goal text: ${goal.goalText || ""}`);
    if (goalType === "get_users") {
      lines.push("Active user contract: 활성 사용자 1명은 선택한 ICP가 제품의 핵심 activation action을 완료한 고유 사람/계정입니다.");
      lines.push("Active user anti-counts: 가입, waitlist, 페이지뷰, 좋아요, 팔로워, 관심 표현만으로는 활성 사용자로 세지 않습니다.");
    }
    lines.push(`${day === 1 ? "Customer" : "Day 1 customer"}: ${goal.customer || ""}`);
    lines.push(`${day === 1 ? "Problem" : "Day 1 problem"}: ${goal.problem || ""}`);
    lines.push(`Validation action: ${goal.validationAction || ""}`);
    if (Array.isArray(goal.evidenceRefs) && goal.evidenceRefs.length) {
      lines.push(`Evidence refs: ${goal.evidenceRefs.join(", ")}`);
    }
    const proofSink = goal.proofSink || "local";
    lines.push(`Proof sink: ${proofSink}`);
    lines.push(proofSink === "bip_optional"
      ? "Public evidence log status: configured; evidence can be saved after explicit user approval."
      : "Public evidence log status: not configured; continue with local evidence only.");
    const ob = onboarding?.onboardingContext || onboarding;
    if (ob) {
      if (ob.goal) lines.push(`Onboarding goal: ${ob.goal}`);
      if (ob.current_stage || ob.currentStage) lines.push(`Onboarding stage: ${ob.current_stage || ob.currentStage}`);
      if (ob.business_description || ob.businessDescription) lines.push(`Onboarding business: ${ob.business_description || ob.businessDescription}`);
      if (ob.product_bottleneck || ob.productBottleneck) lines.push(`Onboarding product bottleneck: ${ob.product_bottleneck || ob.productBottleneck}`);
    }
  }
  if (mode) {
    lines.push(`Office Hours mode: ${mode.label}`, `Mode goal: ${mode.detail}`, `Expected question count: ${mode.questionCount}`);
  }
  // Project line from derived context (mirrors scanResult.day1SituationSummary).
  if (projectContext) {
    const name = projectContext.productName || "unknown";
    const one = projectContext.purpose || projectContext.problem || "";
    lines.push(`${day === 1 ? "Project" : "Project baseline"}: ${name} - ${one}`);
    if (projectContext.targetUser) lines.push(`${day === 1 ? "Customer" : "Baseline customer"} candidate: ${projectContext.targetUser}`);
    if (projectContext.problem) lines.push(`${day === 1 ? "Problem" : "Baseline problem"}: ${projectContext.problem}`);
  }
  if (goal && day === 1) {
    lines.push("Instruction: Run the Day 1 interview only against DAY1_LOCKED_GOAL. The first response must be exactly one structured input card. Ask one question at a time. Do not write files, create docs, publish posts, or edit project files unless the user explicitly approves later.");
  } else if (goal) {
    lines.push(`Instruction: Run the Day ${day} office-hours interview only against the Day ${day} goal/carry-forward action above. Do not restart the Day 1 locked-goal interview. The first response must be exactly one structured input card. Ask one question at a time.`);
  }
  return lines.join("\n");
}

// ── one day of office-hours, capturing cards ────────────────────────────────
async function runOfficeHoursDay({ ws, events, sessionId, day, maxTurns, persona, baseTurn, answeredRequestIds, context, perTurnTimeoutMs }) {
  const dayLog = { day, questions: [], assistantMessages: [], outcome: "", repeatedSignals: [] };
  const startOffset = events.length;
  const pendingFromEvent = (e) => {
    if (e.type === "office_hours_pending_input" && e.sessionId === sessionId) return e.pendingUserInput;
    if (e.type === "session_updated" && e.session?.id === sessionId && isOfficeHoursMode(e.session?.pendingUserInput?.generation?.mode)) return e.session.pendingUserInput;
    return null;
  };
  ws.send(JSON.stringify({
    type: "office_hours_start", sessionId, day,
    context, visiblePrompt: `Day ${day} Office Hours`, source: "manual", selectedSources: ["git"],
  }));
  const seenSignals = new Set();
  let turn = 0;
  let errorOffset = startOffset;
  for (; turn < maxTurns; turn++) {
    // Transient office-hours continuation errors (e.g. the inline attach racing
    // the 250ms userInputPoll) are NOT fatal: the poll re-attaches the next card
    // shortly after. So we keep waiting for the next pending input and only treat
    // a timeout as the end. We still record the last error for diagnostics.
    // A TERMINAL office-hours error ("다음 질문을 만들지 못했습니다 … 종료") ends the
    // day. A transient attach-race error ("no pending request was attachable") is
    // NOT terminal — the 250ms userInputPoll re-attaches the next card, so we keep
    // waiting. Distinguish the two so a terminal error doesn't hang until timeout.
    const isTerminalOhError = (e) => e.type === "error"
      && /만들지\s*못했|인터뷰가.*종료|interview .*ended/i.test(String(e.message || ""))
      && !/attachable/i.test(String(e.message || ""));
    const ev = await waitForEventAfter(events, startOffset, (e) => {
      const p = pendingFromEvent(e);
      if (p && !answeredRequestIds.has(p.requestId)) return true;
      if (e.type === "office_hours_status" && e.sessionId === sessionId && e.stage === "completed") return true;
      return isTerminalOhError(e);
    }, perTurnTimeoutMs);
    // Record any transient (non-terminal) error events seen since last turn.
    for (let i = errorOffset; i < events.length; i++) {
      if (events[i]?.type === "error" && !isTerminalOhError(events[i])) {
        dayLog.repeatedSignals.push(`(transient error: ${String(events[i].message || "").slice(0, 80)})`);
      }
    }
    errorOffset = events.length;
    if (!ev) { dayLog.outcome = dayLog.questions.length ? `settled@${dayLog.questions.length}` : `turn${turn}: timeout`; break; }
    if (ev.type === "error") { dayLog.outcome = dayLog.questions.length ? `terminal-error@${dayLog.questions.length}` : `turn${turn}: ${String(ev.message || "").slice(0, 60)}`; break; }
    if (ev.type === "office_hours_status" && ev.stage === "completed") { dayLog.outcome = `completed@${turn}`; break; }
    const pending = pendingFromEvent(ev);
    if (!pending) { dayLog.outcome = `turn${turn}: ${ev.type} without pending`; break; }
    const q = pending.questions?.[0] || {};
    const card = {
      turn,
      requestId: pending.requestId,
      header: q.header || "",
      question: q.question || "",
      options: (q.options || []).map((o) => ({ label: o.label, description: o.description || "", nextIntent: o.nextIntent || "" })),
      signalId: pending.generation?.signalId || "",
      mode: pending.generation?.mode || "",
      allowFreeText: q.allowFreeText,
    };
    dayLog.questions.push(card);
    // Let the run that attached this card fully settle before answering, so the
    // continuation does not race the finalize/attach (see waitForRunSettle).
    await waitForRunSettle(events);
    const resp = selectStructuredResponse({ question: { ...q, signalId: card.signalId }, persona, turnIndex: baseTurn + turn });
    ws.send(JSON.stringify({
      type: "submit_user_input", sessionId, requestId: pending.requestId,
      responses: [{ question: card.question || "선택", selectedOptions: resp.selectedOptions, freeText: resp.freeText }],
    }));
    answeredRequestIds.add(pending.requestId);
    if (card.signalId && seenSignals.has(card.signalId)) dayLog.repeatedSignals.push(card.signalId);
    if (card.signalId) seenSignals.add(card.signalId);
    const terminal = Boolean(pending.terminal) || /대안 비교|마무리|정리|alternatives/i.test(card.header);
    if (terminal) { dayLog.outcome = `terminal@${turn}`; break; }
  }
  if (!dayLog.outcome) dayLog.outcome = `maxTurns(${maxTurns})`;
  dayLog.assistantMessages = finalAssistants(latestSession(events, sessionId)).slice(-2).map((m) => m.content);
  return { dayLog, turnsUsed: turn };
}

/**
 * Drain any non-office-hours pending input (onboarding/goal setup) the boot emits
 * before office_hours_start (which throws if a non-OH pending input is live).
 * Robust to the boot race: waits up to firstWaitMs for the first pending input to
 * appear, then drains until none reappear within settleMs. Returns { answered, drained }.
 */
async function drainOnboarding({ ws, events, sessionId, persona, answeredRequestIds, maxInputs = 6, firstWaitMs = 20_000, settleMs = 4_000 }) {
  let answered = 0;
  const drained = [];
  for (let i = 0; i < maxInputs; i++) {
    const offset = events.length;
    const ev = await waitForEventAfter(events, 0, (e) => {
      const p = pendingInputFor([e], sessionId) || (e.type === "session_updated" && e.session?.id === sessionId ? e.session.pendingUserInput : null);
      return Boolean(p) && !answeredRequestIds.has(p.requestId);
    }, answered === 0 ? firstWaitMs : settleMs);
    const pending = pendingInputFor(events, sessionId);
    if (!ev || !pending || answeredRequestIds.has(pending.requestId)) break;
    if (isOfficeHoursMode(pending.generation?.mode)) break; // office-hours already
    const q = pending.questions?.[0] || {};
    drained.push({ signalId: pending.generation?.signalId || "", header: q.header || "", mode: pending.generation?.mode || "" });
    const resp = selectStructuredResponse({ question: q, persona, turnIndex: answered });
    ws.send(JSON.stringify({
      type: "submit_user_input", sessionId, requestId: pending.requestId,
      responses: [{ question: q.question || "선택", selectedOptions: resp.selectedOptions, freeText: resp.freeText }],
    }));
    answeredRequestIds.add(pending.requestId);
    answered++;
    await waitForEventAfter(events, offset, (e) => e.type === "session_updated" && e.session?.id === sessionId, 30_000);
  }
  return { answered, drained };
}

// ── main runner ─────────────────────────────────────────────────────────────
export async function runRealProjectArc(projectPath, {
  outputDir = defaultOutputDir(),
  mode = LIVE_DEFAULT ? "live" : "stub",
  label = path.basename(path.resolve(projectPath)),
  personaId = "icp-solo-dev",
  days = [1],
  maxTurnsPerDay = 6,
  perTurnTimeoutMs = 200_000,
  goalOverride = null,
  projectContextOverride = null,
} = {}) {
  const persona = OFFICE_HOURS_ARC_PERSONAS[personaId];
  const runId = new Date().toISOString().replaceAll(/[:.]/g, "-");
  const runDir = path.join(outputDir, `real-arc-${label}-${runId}`);
  await fs.mkdir(runDir, { recursive: true });

  const seed = await seedRealProjectWorkspace(projectPath, { goalOverride, projectContextOverride });
  const appSupportPath = await fs.mkdtemp(path.join(os.tmpdir(), "a30-real-arc-app-"));
  await writeBipConfig(appSupportPath, seed.root);

  const child = spawn(process.execPath, ["sidecar/index.mjs", "--workspace", seed.root], {
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

  const captured = { runId, mode, label, projectPath: path.resolve(projectPath), days: [], onboardingAnswered: 0, errors: [], evidenceSubmissions: [], hasGoal: Boolean(seed.day1Goal), hasProjectContext: Boolean(seed.projectContext) };
  const events = [];
  let ws;
  try {
    const ready = await readSidecarReady(child);
    ws = new WebSocket(`ws://127.0.0.1:${ready.port}`);
    ws.on("message", (raw) => { try { events.push(JSON.parse(String(raw))); } catch { /* ignore */ } });
    await onceOpen(ws);
    ws.send(JSON.stringify({ type: "authenticate", authToken: ready.authToken }));
    if (!await waitForEventAfter(events, 0, (e) => e.type === "ready", 30_000)) throw new Error("no ready event");
    // suppressBootstrapIntake: skip the initial_intake menu ("무엇부터 시작할까요?")
    // the boot otherwise attaches. The Mac app uses this when navigating straight
    // to a surface; without it office_hours_start refuses (non-OH pending input)
    // and answering the intake instead kicks off a full agentic run.
    ws.send(JSON.stringify({ type: "create_session", provider: "codex", model: "gpt-5.4-mini", suppressBootstrapIntake: true }));
    const created = await waitForEventAfter(events, 0, (e) => e.type === "session_created", 30_000);
    if (!created) throw new Error("no session_created");
    const sessionId = created.session.id;

    const answeredRequestIds = new Set();
    // Safety drain: with the intake suppressed there is normally nothing to drain,
    // but keep it as a short settle so any straggler non-OH input is cleared.
    const drainResult = await drainOnboarding({ ws, events, sessionId, persona, answeredRequestIds, firstWaitMs: 3_000 });
    captured.onboardingAnswered = drainResult.answered;
    captured.onboardingDrained = drainResult.drained;

    let baseTurn = captured.onboardingAnswered;
    for (const day of days) {
      const context = buildDay1LockedGoalContext({ day, goal: seed.day1Goal, onboarding: seed.onboarding, projectContext: seed.projectContext });
      try {
        const { dayLog, turnsUsed } = await runOfficeHoursDay({
          ws, events, sessionId, day, maxTurns: maxTurnsPerDay, persona, baseTurn, answeredRequestIds, context, perTurnTimeoutMs,
        });
        captured.days.push(dayLog);
        baseTurn += turnsUsed;
        // commit the day so memory/commitment carries to the next day
        const offset = events.length;
        ws.send(JSON.stringify({
          type: "day_progress_patch", sessionId, workspaceRoot: seed.root,
          stepId: "first_interview", status: "done", day,
          commitmentText: persona.commitment.text, commitment: persona.commitment,
        }));
        await waitForEventAfter(events, offset, (e) => e.type === "day_progress_state", 30_000);
        // Submit hard evidence that the day's commitment was acted on, so the
        // NEXT day's office-hours can reference real accumulated evidence (this is
        // what lets evidence_use be measured beyond a single Day-1 snapshot).
        const evOffset = events.length;
        ws.send(JSON.stringify({
          type: "proof_ledger_append", sessionId, workspaceRoot: seed.root,
          event: {
            type: "interview", status: "verified", strength: "strong", day,
            customer: persona.commitment.customer, channel: persona.commitment.channel,
            title: `Day ${day} 약속 이행`,
            summary: `${persona.commitment.text} — ${persona.commitment.expectedEvidenceKind} 증거 확보`,
          },
        }));
        await waitForEventAfter(events, evOffset, (e) => e.type === "execution_os_state" && e.workspaceRoot === seed.root, 30_000);
        captured.evidenceSubmissions.push({ day, kind: persona.commitment.expectedEvidenceKind, customer: persona.commitment.customer });
      } catch (e) { captured.errors.push(`day${day}: ${e.message}`); }
    }
  } catch (e) {
    captured.errors.push(`fatal: ${e.message}`);
  } finally {
    try { ws?.close(); } catch { /* ignore */ }
    await terminateChild(child);
    if (stderr.trim()) captured.stderrTail = stderr.split("\n").slice(-20).join("\n");
  }

  await fs.writeFile(path.join(runDir, "captured.json"), JSON.stringify(captured, null, 2) + "\n");
  if (process.env.REAL_ARC_DEBUG === "1") {
    await fs.writeFile(path.join(runDir, "events.json"), JSON.stringify(events.map((e) => ({
      type: e.type,
      sessionId: e.sessionId || e.session?.id,
      pendingMode: e.pendingUserInput?.generation?.mode || e.session?.pendingUserInput?.generation?.mode || null,
      pendingSignal: e.pendingUserInput?.generation?.signalId || e.session?.pendingUserInput?.generation?.signalId || null,
      pendingHeader: e.pendingUserInput?.questions?.[0]?.header || e.session?.pendingUserInput?.questions?.[0]?.header || null,
      stage: e.stage || null,
      message: e.message || null,
    })), null, 2) + "\n");
  }
  await fs.rm(seed.root, { recursive: true, force: true });
  await fs.rm(appSupportPath, { recursive: true, force: true });
  return { runDir, captured, seed: { hasGoal: captured.hasGoal, hasProjectContext: captured.hasProjectContext } };
}

function defaultOutputDir() {
  return process.env.AGENTIC30_DOGFOOD_OUTPUT_DIR
    ? path.resolve(process.env.AGENTIC30_DOGFOOD_OUTPUT_DIR)
    : path.join(packageRoot, "sidecar-evals", ".artifacts");
}

// ── CLI ─────────────────────────────────────────────────────────────────────
if (import.meta.url === `file://${process.argv[1]}`) {
  const argv = process.argv.slice(2);
  const opts = { days: [1] };
  let projectPath = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--project") projectPath = argv[++i];
    else if (a === "--days") opts.days = argv[++i].split(",").map((d) => Number(d.trim())).filter(Boolean);
    else if (a === "--live") opts.mode = "live";
    else if (a === "--stub") opts.mode = "stub";
    else if (a === "--label") opts.label = argv[++i];
    else if (a === "--max-turns") opts.maxTurnsPerDay = Number(argv[++i]);
    else if (a === "--goal-file") opts.goalOverride = readJsonSync(argv[++i]);
    else if (a === "--context-file") opts.projectContextOverride = readJsonSync(argv[++i]);
  }
  if (!projectPath) { console.error("usage: real-project-arc.mjs --project <path> [--days 1,2] [--live]"); process.exit(2); }
  runRealProjectArc(projectPath, opts)
    .then((r) => {
      console.log(`Real-project arc: ${path.join(r.runDir, "captured.json")}`);
      const d1 = r.captured.days?.[0];
      console.log(`Cards day1: ${(d1?.questions || []).length} · outcome: ${d1?.outcome} · errors: ${r.captured.errors.join("; ") || "none"}`);
      process.exit(0);
    })
    .catch((e) => { console.error(e); process.exit(1); });
}

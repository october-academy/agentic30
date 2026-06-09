import fs from "node:fs/promises";
import path from "node:path";
import { createHash, randomUUID } from "node:crypto";

import { atomicWriteJson, withFileLock } from "./atomic-store.mjs";
import { resolveAgentic30MemoryDir } from "./news-market-radar.mjs";

// Office-Hours / interview memory — the "Cycle#N" cross-interview store.
//
// Benchmarks gstack's developer-profile continuity (SESSION_COUNT / LAST_ASSIGNMENT,
// the "This is Cycle N. Last time: X. How'd it go?" opening) and gbrain's two-layer
// page model (an OVERWRITTEN Compiled Truth on top, an APPEND-ONLY Timeline below),
// stripped to Agentic30's SQLite-philosophy discipline: one local JSON file, zero new
// deps, atomic writes via atomic-store. The store's whole job is anti-displacement —
// make the gap between a committed customer action and shipped HARD evidence
// impossible to hide. See memory project_office_hours_day_memory.
//
// Schema bumps require a canonical normalization test (office-hours-memory.test.mjs).
export const OFFICE_HOURS_MEMORY_SCHEMA_VERSION = 2;
export const OFFICE_HOURS_MEMORY_SCHEMA = "agentic30.office_hours_memory.v1";

// Caps — no unbounded growth (curriculum-answer-log convention).
export const MAX_TIMELINE_ENTRIES = 200;
export const MAX_CYCLE_LEDGER = 90; // 30-day challenge with slack; one cycle per interview.
export const MAX_COMMITMENTS = 60;
export const MAX_PREDICTIONS = 60;
export const MAX_OPEN_THREADS = 5;
export const MAX_COMPILED_TRUTH_CHARS = 2_000;
export const MAX_FIELD_CHARS = 500;

// Founder decision (2026-06-08): an open commitment silent for >= this many cycles
// with zero hard evidence is surfaced by name as displacement ("costume").
export const ABANDONED_THREAD_CYCLES = 2;

const COMMITMENT_STATUSES = new Set(["open", "met", "missed", "abandoned"]);
const PREDICTION_VERDICTS = new Set(["unresolved", "correct", "incorrect", "partial"]);
const CYCLE_OUTCOMES = new Set(["success", "abort", "blocked"]); // abort|blocked == GATE HELD (a win).
const CYCLE_STEPS = new Set(["interview", "first_interview", "retro"]);
const TIMELINE_SOURCES = new Set(["interview", "retro", "evidence"]);
const ORIGINS = new Set(["user", "system"]);
// Hard-evidence kinds only — the North Star rule + poisoning defense, unified.
// Praise, waitlist, interest, "asked the price" are NOT here by design.
const EVIDENCE_KINDS = new Set(["url", "screenshot", "commit", "payment"]);

export function resolveOfficeHoursMemoryPath(workspaceRoot) {
  return path.join(resolveAgentic30MemoryDir(workspaceRoot), "office-hours-ledger.json");
}

// ── Load / save ──────────────────────────────────────────────────────────────

export async function loadOfficeHoursMemory({ workspaceRoot, fsImpl = fs, now = new Date() } = {}) {
  if (!workspaceRoot) return makeDefaultOfficeHoursMemory({ now });
  try {
    const raw = JSON.parse(await fsImpl.readFile(resolveOfficeHoursMemoryPath(workspaceRoot), "utf8"));
    return normalizeOfficeHoursMemory(raw, { now });
  } catch {
    return makeDefaultOfficeHoursMemory({ now });
  }
}

async function persistOfficeHoursMemory({ workspaceRoot, memory, now }) {
  const filePath = resolveOfficeHoursMemoryPath(workspaceRoot);
  const normalized = normalizeOfficeHoursMemory(memory, { now });
  normalized.updatedAt = now.toISOString();
  await atomicWriteJson(filePath, normalized);
  return normalized;
}

// ── Mutations (each takes the file lock; load -> mutate -> normalize -> atomic write) ──

// User-origin gate: a commitment may be written ONLY from the founder's own typed
// message. `originText` must be the founder's words; empty or system-flagged input
// throws so model/tool output can never fabricate a commitment.
export async function appendCommitment({
  workspaceRoot,
  text,
  cycle,
  day,
  originText,
  commitment,
  customer,
  channel,
  message,
  expectedEvidenceKind,
  dueDay,
  confirmedByUser,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "office_hours_memory_append_commitment");
  assertUserOrigin(originText, "appendCommitment");
  const cleanedText = cleanString(text, MAX_FIELD_CHARS);
  if (!cleanedText) throw new Error("appendCommitment requires non-empty commitment text.");
  const cycleNo = clampInt(cycle, 1, MAX_CYCLE_LEDGER * 4, 1);
  const structured = normalizeCommitmentFields(mergeDefined(
    commitment && typeof commitment === "object" && !Array.isArray(commitment) ? commitment : {},
    { customer, channel, message, expectedEvidenceKind, dueDay, confirmedByUser },
  ), { fallbackDueDay: clampInt(day, 1, 400, cycleNo) + 1 });
  if (structured.hasExplicitStructuredDraft && structured.confirmedByUser !== true) {
    throw new Error("appendCommitment: structured commitment must be confirmed by the user.");
  }
  const filePath = resolveOfficeHoursMemoryPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const memory = await loadOfficeHoursMemory({ workspaceRoot, now });
    const commitment = {
      id: makeId("cm", cycleNo, cleanedText, now),
      cycle: cycleNo,
      createdDay: clampInt(day, 1, 400, cycleNo),
      createdAt: now.toISOString(),
      text: cleanedText,
      status: "open",
      evidence: null,
      origin: "user",
      customer: structured.customer,
      channel: structured.channel,
      message: structured.message,
      expectedEvidenceKind: structured.expectedEvidenceKind,
      dueDay: structured.dueDay,
      confirmedByUser: structured.confirmedByUser,
    };
    memory.commitments = [...memory.commitments, commitment];
    return persistOfficeHoursMemory({ workspaceRoot, memory, now });
  });
}

// Grade a commitment with HARD evidence. A grade with no hard-evidence kind keeps the
// status `missed` (never `met`) — the poisoning defense and the hard-evidence rule in
// one validator. Returns { memory, graded:boolean }.
//
// Caller contract: invoke ONLY with founder-submitted evidence (e.g. the
// submitActionEvidence / action-day-verification path), never model/tool-asserted
// proof — the index.mjs wiring enforces that origin. Once a commitment is `met` with
// real evidence, a later soft/empty re-grade is a NO-OP (proven customer actions are
// un-erasable); only NEW hard evidence replaces prior evidence.
export async function gradeCommitment({
  workspaceRoot,
  commitmentId,
  evidence,
  gradedCycle,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "office_hours_memory_grade_commitment");
  const filePath = resolveOfficeHoursMemoryPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const memory = await loadOfficeHoursMemory({ workspaceRoot, now });
    const target = memory.commitments.find((c) => c.id === commitmentId);
    if (!target) throw new Error(`gradeCommitment: unknown commitment "${commitmentId}".`);
    const hard = normalizeEvidence(evidence, { now, gradedCycle });
    const alreadyProven = target.status === "met" && target.evidence;
    if (hard) {
      target.status = "met"; // new hard evidence always wins, even replacing prior proof.
      target.evidence = hard;
    } else if (alreadyProven) {
      return { memory, graded: false }; // protect proven evidence: no-op, never downgrade.
    } else {
      target.status = "missed";
      target.evidence = null;
    }
    const persisted = await persistOfficeHoursMemory({ workspaceRoot, memory, now });
    return { memory: persisted, graded: Boolean(hard) };
  });
}

// Append one closed-cycle entry to the Cycle#N ledger. outcome abort|blocked = gate held.
export async function appendCycle({
  workspaceRoot,
  cycle,
  day,
  step,
  outcome,
  lastAssignment,
  note,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "office_hours_memory_append_cycle");
  const filePath = resolveOfficeHoursMemoryPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const memory = await loadOfficeHoursMemory({ workspaceRoot, now });
    const entry = {
      cycle: clampInt(cycle, 1, MAX_CYCLE_LEDGER * 4, 1),
      day: clampInt(day, 1, 400, 1),
      date: now.toISOString(),
      step: CYCLE_STEPS.has(step) ? step : "interview",
      outcome: CYCLE_OUTCOMES.has(outcome) ? outcome : "success",
      lastAssignment: cleanString(lastAssignment, MAX_FIELD_CHARS),
      note: cleanString(note, MAX_FIELD_CHARS),
    };
    memory.cycles = [...memory.cycles, entry];
    return persistOfficeHoursMemory({ workspaceRoot, memory, now });
  });
}

// Append a timeline entry. Agent/tool output is allowed but tagged origin:"system"
// and can never become a commitment or satisfy a grade.
export async function appendTimeline({
  workspaceRoot,
  cycle,
  source,
  summary,
  detail,
  origin = "system",
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "office_hours_memory_append_timeline");
  const cleanedSummary = cleanString(summary, MAX_FIELD_CHARS);
  if (!cleanedSummary) throw new Error("appendTimeline requires a non-empty summary.");
  const filePath = resolveOfficeHoursMemoryPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const memory = await loadOfficeHoursMemory({ workspaceRoot, now });
    const entry = {
      id: makeId("tl", cycle, cleanedSummary, now),
      date: now.toISOString(),
      cycle: clampInt(cycle, 1, MAX_CYCLE_LEDGER * 4, 1),
      source: TIMELINE_SOURCES.has(source) ? source : "interview",
      summary: cleanedSummary,
      detail: cleanString(detail, MAX_FIELD_CHARS),
      origin: ORIGINS.has(origin) ? origin : "system",
    };
    memory.timeline = [...memory.timeline, entry];
    return persistOfficeHoursMemory({ workspaceRoot, memory, now });
  });
}

// ── Calibration-lite predictions ────────────────────────────────────────────
// Benchmarks gbrain's take-forecast (capture a falsifiable claim) + recall-footer
// (surface how prior forecasts went), stripped to a SIMPLE count — no Brier, no
// weights. The founder predicts an outcome at cycle close; a later cycle grades it;
// the retro banner shows "예측 적중 N/M". Anti-displacement: it makes founder optimism
// checkable against what actually happened. The `predictions` field + normalizer were
// reserved forward-stable, so this ships with zero schema bump.

// Capture one founder prediction. User-origin gated exactly like appendCommitment —
// `originText` must be the founder's own words so model/tool output can't fabricate a
// forecast. Stored `verdict: "unresolved"` until a later cycle grades it.
export async function appendPrediction({
  workspaceRoot,
  claim,
  cycle,
  originText,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "office_hours_memory_append_prediction");
  assertUserOrigin(originText, "appendPrediction");
  const cleanedClaim = cleanString(claim, MAX_FIELD_CHARS);
  if (!cleanedClaim) throw new Error("appendPrediction requires non-empty claim text.");
  const cycleNo = clampInt(cycle, 1, MAX_CYCLE_LEDGER * 4, 1);
  const filePath = resolveOfficeHoursMemoryPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const memory = await loadOfficeHoursMemory({ workspaceRoot, now });
    const prediction = {
      id: makeId("pr", cycleNo, cleanedClaim, now),
      cycle: cycleNo,
      createdAt: now.toISOString(),
      claim: cleanedClaim,
      verdict: "unresolved",
      gradedCycle: null,
      origin: "user",
    };
    memory.predictions = [...memory.predictions, prediction];
    return persistOfficeHoursMemory({ workspaceRoot, memory, now });
  });
}

// Grade a prediction with the founder's own retrospective verdict. Only the resolved
// verdicts (correct|incorrect|partial) are accepted — "unresolved" is the open state and
// cannot be set here. Idempotent-ish: re-grading overwrites with the latest verdict.
// Returns { memory, graded:boolean }.
export async function gradePrediction({
  workspaceRoot,
  predictionId,
  verdict,
  gradedCycle,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "office_hours_memory_grade_prediction");
  const cleanVerdict = PREDICTION_VERDICTS.has(verdict) && verdict !== "unresolved" ? verdict : null;
  if (!cleanVerdict) {
    throw new Error("gradePrediction: verdict must be one of correct|incorrect|partial.");
  }
  const filePath = resolveOfficeHoursMemoryPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const memory = await loadOfficeHoursMemory({ workspaceRoot, now });
    const target = memory.predictions.find((p) => p.id === predictionId);
    if (!target) throw new Error(`gradePrediction: unknown prediction "${predictionId}".`);
    target.verdict = cleanVerdict;
    target.gradedCycle = clampInt(gradedCycle, 1, MAX_CYCLE_LEDGER * 4, target.gradedCycle ?? target.cycle);
    const persisted = await persistOfficeHoursMemory({ workspaceRoot, memory, now });
    return { memory: persisted, graded: true };
  });
}

// Pure: the most recent still-unresolved prediction (the one a cycle-close grade targets),
// or null. Wiring (index.mjs) uses this so the Mac side can grade "the last prediction"
// without tracking its id.
export function latestUnresolvedPrediction(memory) {
  return (memory?.predictions ?? [])
    .filter((p) => p && p.verdict === "unresolved")
    // Newest cycle first; createdAt breaks a same-cycle tie deterministically (Array.sort
    // is not guaranteed stable for equal keys), so a double-capture in one cycle is unambiguous.
    .sort((a, b) => (b.cycle - a.cycle) || (Date.parse(b.createdAt || 0) - Date.parse(a.createdAt || 0)))[0] ?? null;
}

// Pure: the calibration read-back. SIMPLE count, not Brier — `correct` is exact hits,
// everything else graded (incorrect + partial) is a miss. line is the DESIGN-voice
// "예측 적중 N/M" sentence (<25 words, action-pointing, not a scoreboard label); empty
// when nothing has been graded yet so the surface stays hidden on a cold brain.
export function summarizePredictionCalibration(memory) {
  const graded = (memory?.predictions ?? []).filter((p) => p && p.verdict && p.verdict !== "unresolved");
  const total = graded.length;
  const correct = graded.filter((p) => p.verdict === "correct").length;
  const missed = total - correct;
  let line = "";
  if (total > 0) {
    line = missed > 0
      ? `예측 적중 ${correct}/${total} — ${missed}개 빗나갔어. 낙관은 증거가 아니야.`
      : `예측 적중 ${correct}/${total} — 감이 잘 맞고 있어.`;
  }
  return { total, correct, missed, line };
}

// Overwrite the Compiled Truth from the current user-origin records. Copies the prior
// truth into `.previous` (one level — the Supersedes analog). Pure synthesis: it
// SUMMARIZES user commitments/threads but never INVENTS a commitment. Persists.
export async function recompileCompiledTruth({
  workspaceRoot,
  text,
  now = new Date(),
} = {}) {
  assertWorkspace(workspaceRoot, "office_hours_memory_recompile");
  const filePath = resolveOfficeHoursMemoryPath(workspaceRoot);
  return withFileLock(filePath, async () => {
    const memory = await loadOfficeHoursMemory({ workspaceRoot, now });
    memory.compiledTruth = buildCompiledTruth(memory, { text, now });
    return persistOfficeHoursMemory({ workspaceRoot, memory, now });
  });
}

// ── Pure synthesis / read-back helpers (no I/O) ───────────────────────────────

// Pure: recompute the compiled-truth object, copying the prior text into `.previous`.
// `text` (optional) overrides the derived summary; openThreads are derived from
// the user-origin open commitments (never invented).
export function buildCompiledTruth(memory, { text, now = new Date() } = {}) {
  const current = memory?.compiledTruth ?? null;
  const openThreads = (memory?.commitments ?? [])
    .filter((c) => c.status === "open")
    .map((c) => cleanString(c.text, MAX_FIELD_CHARS))
    .filter(Boolean)
    .slice(0, MAX_OPEN_THREADS);
  const derived = cleanString(text, MAX_COMPILED_TRUTH_CHARS) || deriveCompiledTruthText(memory);
  const previous = current && current.text
    ? { text: cleanString(current.text, MAX_COMPILED_TRUTH_CHARS), updatedAt: current.updatedAt || null }
    : null;
  return {
    text: derived,
    openThreads,
    updatedAt: now.toISOString(),
    previous,
  };
}

// Pure: commitments open >= ABANDONED_THREAD_CYCLES cycles with zero hard evidence.
// Returns [{ text, cycle, cyclesSilent }] — the costume detector input.
export function detectAbandonedThreads(memory, { currentCycle, threshold = ABANDONED_THREAD_CYCLES } = {}) {
  // Fallback must consider commitments too: a commitment in cycle 8 with no closed
  // cycle yet must not yield a negative cyclesSilent that silently hides it (the exact
  // North-Star record). Wire callers (index.mjs) should still pass an explicit currentCycle.
  const cycleNow = clampInt(currentCycle, 1, MAX_CYCLE_LEDGER * 4, highestKnownCycle(memory));
  return (memory?.commitments ?? [])
    .filter((c) => c.status === "open" && !c.evidence)
    .map((c) => ({ text: c.text, cycle: c.cycle, cyclesSilent: Math.max(0, cycleNow - c.cycle) }))
    .filter((t) => t.cyclesSilent >= threshold)
    .sort((a, b) => b.cyclesSilent - a.cyclesSilent);
}

// Pure: the `priorCycle` argument consumed by specialists/office-hours.mjs buildPrompt().
// Returns null on a cold brain (no prior cycle) so the opening renders clean-start text.
export function buildPriorCycle(memory, { currentCycle, now = new Date() } = {}) {
  const cycles = memory?.cycles ?? [];
  if (!cycles.length) return null;
  const last = cycles.reduce((a, b) => (b.cycle >= a.cycle ? b : a));
  const cycleNow = clampInt(currentCycle, 1, MAX_CYCLE_LEDGER * 4, last.cycle + 1);
  const openCommitment = (memory?.commitments ?? [])
    .filter((c) => c.status === "open")
    .sort((a, b) => b.cycle - a.cycle)[0] ?? null;
  const metCommitment = (memory?.commitments ?? [])
    .filter((c) => c.status === "met" && c.evidence)
    .sort((a, b) => b.cycle - a.cycle)[0] ?? null;
  return {
    cycle: cycleNow,
    priorCycle: last.cycle,
    lastAssignment: cleanString(last.lastAssignment || openCommitment?.text || "", MAX_FIELD_CHARS),
    lastOutcome: last.outcome,
    metEvidence: metCommitment?.evidence ?? null,
    hasOpenCommitment: Boolean(openCommitment),
    compiledTruth: cleanString(memory?.compiledTruth?.text, MAX_COMPILED_TRUTH_CHARS),
    openThreads: (memory?.compiledTruth?.openThreads ?? []).slice(0, MAX_OPEN_THREADS),
    abandonedThreads: detectAbandonedThreads(memory, { currentCycle: cycleNow }),
  };
}

// Pure: the compact summary attached to the day_progress_state broadcast (additive,
// optional). Mirrors the Swift OfficeHoursMemorySummary decoder.
export function summarizeOfficeHoursMemory(memory, { currentCycle } = {}) {
  if (!memory) return null;
  const abandoned = detectAbandonedThreads(memory, { currentCycle });
  const calibration = summarizePredictionCalibration(memory);
  const pending = latestUnresolvedPrediction(memory);
  return {
    compiledTruth: cleanString(memory.compiledTruth?.text, MAX_COMPILED_TRUTH_CHARS),
    openThreads: (memory.compiledTruth?.openThreads ?? []).slice(0, MAX_OPEN_THREADS),
    // DESIGN voice: a concrete, action-pointing costume sentence — not a scoreboard label.
    abandonedThreads: abandoned.map((t) =>
      cleanString(`"${t.text}" — ${t.cyclesSilent} 사이클째 증거 0. 새 도구 말고 이것부터.`, MAX_FIELD_CHARS),
    ),
    // calibration-lite read-back: "예측 적중 N/M" (empty until something is graded), plus
    // the still-open prediction the Mac side offers to grade at the next cycle close.
    calibrationLine: calibration.line,
    pendingPrediction: pending ? cleanString(pending.claim, MAX_FIELD_CHARS) : "",
  };
}

// Pure: the Cycle#N interview-opening block. Injected into the office-hours CONTEXT
// (NOT the specialist prompt — the vendored office-hours SKILL.md overrides specialist
// promptText when present, so context injection is the reliable path). Empty on a cold
// brain so the opening renders clean-start text. Benchmarks gstack "This is Cycle N.
// Last time: X. How'd it go?" + the gbrain recall-footer abandoned-thread/costume line.
export function formatPriorCycleOpening(priorCycle) {
  if (!priorCycle || typeof priorCycle !== "object") return "";
  const assignment = String(priorCycle.lastAssignment || "").trim();
  if (!assignment) return "";
  const priorNo = String(priorCycle.priorCycle ?? priorCycle.cycle ?? "?").trim() || "?";
  const ev = priorCycle.metEvidence;
  const evLocator = ev && (ev.url || ev.note) ? String(ev.url || ev.note).trim() : "";
  const evidenceLine = evLocator ? `이미 증거가 들어왔어: ${evLocator}` : "아직 증거 없음.";
  const lines = [
    `[직전 사이클 회상 — Cycle ${priorNo}]`,
    `지난 사이클에 너는 이걸 하기로 했어: "${assignment}".`,
    evidenceLine,
    "이번 사이클 첫 질문은 반드시 그 약속의 확인 가능한 증거(URL/캡처/커밋/결제) 확인이다. 자기보고·칭찬·관심은 증거가 아니다.",
  ];
  const abandoned = Array.isArray(priorCycle.abandonedThreads) ? priorCycle.abandonedThreads : [];
  if (abandoned.length) {
    const top = abandoned[0];
    const silent = top?.cyclesSilent ?? "?";
    const text = String(top?.text || "").trim();
    lines.push(
      `잠깐 — 이 약속이 ${silent} 사이클째 증거 0이야: "${text}". 도구를 더 만드는 건 일을 회피하는 가장 깊은 코스튬이야. 오늘은 그 약속만.`,
    );
  }
  return lines.join("\n");
}

// The interview/first_interview completion gate (founder decision 2026-06-08:
// "block-once-then-confession"). PURE — decides what a day_progress_patch marking an
// interview step `done` must do; non-gated steps/status pass through unchanged
// (backward compatible). The sidecar handler applies the record side-effects.
//   'passthrough' — not a gated interview→done patch; behave exactly as before.
//   'commit'      — founder supplied a next customer action → record commitment + cycle, proceed.
//   'confess'     — founder explicitly held the gate (no action) → record cycle outcome
//                   `blocked` (gate-held-as-win), proceed.
//   'block'       — interview→done with neither → DO NOT complete; ask for one.
export const GATED_INTERVIEW_STEPS = Object.freeze(["interview", "first_interview"]);

export function isGatedInterviewStep(stepId) {
  return GATED_INTERVIEW_STEPS.includes(String(stepId || ""));
}

export function classifyInterviewGate({ stepId, status, commitmentText, commitment, confession } = {}) {
  const isDone = String(status || "").trim().toLowerCase() === "done";
  if (!isGatedInterviewStep(stepId) || !isDone) {
    return { gated: false, mode: "passthrough" };
  }
  if (cleanString(commitmentText)) return { gated: true, mode: "commit" };
  if (hasConfirmedStructuredCommitment(commitment)) return { gated: true, mode: "commit" };
  if (cleanString(confession)) return { gated: true, mode: "confess" };
  return { gated: true, mode: "block" };
}

// Pure: synthesize the per-Day customer-evidence review payload attached to
// day_progress_state. This is additive UI data; the source of truth remains
// day-progress + office-hours-memory + work-history.
export function buildDayReviews({ dayProgress, memory, workHistory, day1GoalSelection = null, currentDay = null } = {}) {
  const days = dayProgress?.days && typeof dayProgress.days === "object" && !Array.isArray(dayProgress.days)
    ? dayProgress.days
    : {};
  const evidenceOS = buildEvidenceOS({ dayProgress, memory, workHistory, day1GoalSelection, currentDay });
  const reviewDays = new Set(Object.keys(days));
  const resolvedCurrentDay = clampInt(currentDay, 1, 400, null);
  if (resolvedCurrentDay) {
    for (let day = 1; day <= resolvedCurrentDay; day += 1) reviewDays.add(String(day));
  }
  if (normalizeDay1GoalSnapshot(day1GoalSelection)) reviewDays.add("1");
  const reviews = {};
  for (const key of reviewDays) {
    const record = days[key] ?? null;
    const day = clampInt(record?.day ?? key, 1, 400, null);
    if (!day) continue;
    const commitments = (memory?.commitments ?? [])
      .filter((commitment) => clampInt(commitment.createdDay ?? commitment.cycle, 1, 400, null) === day)
      .map(commitmentToReviewRecord);
    const evidenceDebts = (memory?.commitments ?? [])
      .filter((commitment) => isUnprovenDebt(commitment)
        && (
          clampInt(commitment.createdDay ?? commitment.cycle, 1, 400, null) === day
          || clampInt(commitment.dueDay, 1, 400, null) === day
        ))
      .map(commitmentToReviewRecord);
    const cycles = (memory?.cycles ?? []).filter((cycle) => clampInt(cycle.day ?? cycle.cycle, 1, 400, null) === day);
    const work = workSummaryForDay({ workHistory, dayProgress, day });
    const hasHardEvidence = commitments.some((commitment) => Boolean(commitment.evidence));
    const hasUnprovenCommitment = commitments.some((commitment) =>
      !commitment.evidence && ["open", "missed", "abandoned"].includes(commitment.status),
    );
    const hasCustomerDetails = commitments.some((commitment) =>
      Boolean(cleanString(commitment.customer) && cleanString(commitment.message)),
    );
    const blockedCycle = cycles.find((cycle) => cycle.outcome === "blocked" || cycle.outcome === "abort") ?? null;

    const missing = [];
    const goalSnapshot = goalSnapshotForDay({ day, record, day1GoalSelection });
    if (!goalSnapshot?.summary) missing.push("goal_snapshot");
    if (!hasCustomerDetails) missing.push("customer_evidence");
    if (!hasHardEvidence) missing.push("hard_evidence");
    if (!commitments.length) missing.push("next_commitment");

    const evidenceState = evidenceOS.dayStates?.[String(day)]?.state;
    const status = hasHardEvidence
      ? "evidence_confirmed"
      : (work.hasWork ? "build_escape"
        : (hasUnprovenCommitment ? "commitment_unproven"
          : (blockedCycle ? "blocked"
            : (evidenceState === "not_started" ? "not_started"
              : (evidenceState === "closed_unproven" ? "closed_unproven" : "customer_evidence_missing")))));
    reviews[String(day)] = {
      schemaVersion: 2,
      day,
      status,
      verdictLabel: verdictLabelForStatus(status),
      verdictTone: verdictToneForStatus(status),
      summary: reviewSummaryForStatus(status, { work, commitments, blockedCycle, goalSnapshot, evidenceDebts }),
      customerEvidence: commitments.filter((commitment) => commitment.customer || commitment.message || commitment.evidence),
      commitments,
      nextCommitment: commitments.find((commitment) => !commitment.evidence && commitment.status === "open") ?? null,
      missing,
      goalSnapshot,
      missingReasons: missingReasonsForReview({ missing, goalSnapshot, evidenceDebts, status }),
      carryForwardAction: carryForwardActionForReview({ status, goalSnapshot, evidenceDebts, commitments }),
      evidenceDebts,
      work,
    };
  }
  return reviews;
}

export function buildEvidenceOS({ dayProgress, memory, workHistory, day1GoalSelection = null, currentDay = null } = {}) {
  const days = dayProgress?.days && typeof dayProgress.days === "object" && !Array.isArray(dayProgress.days)
    ? dayProgress.days
    : {};
  const resolvedCurrentDay = clampInt(currentDay, 1, 400, null);
  const commitments = Array.isArray(memory?.commitments) ? memory.commitments : [];
  const openDebts = commitments.filter(isUnprovenDebt).map(commitmentToReviewRecord);
  const overdueDebts = commitments
    .filter((commitment) => isUnprovenDebt(commitment)
      && resolvedCurrentDay
      && clampInt(commitment.dueDay, 1, 400, resolvedCurrentDay) < resolvedCurrentDay)
    .map(commitmentToReviewRecord);
  const provenEvidence = commitments
    .filter((commitment) => commitment?.evidence || commitment?.status === "met")
    .map(commitmentToReviewRecord);
  const maxRecordedDay = Object.keys(days).reduce((max, key) => Math.max(max, clampInt(days[key]?.day ?? key, 1, 400, 0)), 0);
  const maxCommitmentDay = commitments.reduce((max, commitment) => Math.max(
    max,
    clampInt(commitment?.createdDay ?? commitment?.cycle, 1, 400, 0),
    clampInt(commitment?.dueDay, 1, 400, 0),
  ), 0);
  const maxDay = Math.max(resolvedCurrentDay ?? 0, maxRecordedDay, maxCommitmentDay, normalizeDay1GoalSnapshot(day1GoalSelection) ? 1 : 0);
  const dayStates = {};
  for (let day = 1; day <= maxDay; day += 1) {
    const record = days[String(day)] ?? null;
    const dayCommitments = commitments.filter((commitment) => clampInt(commitment.createdDay ?? commitment.cycle, 1, 400, null) === day);
    const dayOpenDebts = dayCommitments.filter(isUnprovenDebt);
    const dayProven = dayCommitments.filter((commitment) => commitment?.evidence || commitment?.status === "met");
    const work = workSummaryForDay({ workHistory, dayProgress, day });
    const state = evidenceOSStateForDay({ day, record, day1GoalSelection, dayOpenDebts, dayProven, work });
    dayStates[String(day)] = {
      day,
      state,
      label: evidenceOSLabelForState(state),
      tone: evidenceOSToneForState(state),
      openDebtCount: dayOpenDebts.length,
      provenEvidenceCount: dayProven.length,
      carryForwardAction: carryForwardActionForReview({
        status: state,
        goalSnapshot: goalSnapshotForDay({ day, record, day1GoalSelection }),
        evidenceDebts: dayOpenDebts.map(commitmentToReviewRecord),
        commitments: dayCommitments.map(commitmentToReviewRecord),
      }),
    };
  }
  return {
    schemaVersion: 1,
    currentDay: resolvedCurrentDay,
    openDebts,
    overdueDebts,
    provenEvidence,
    dayStates,
  };
}

function normalizeDay1GoalSnapshot(selection = null) {
  if (!selection || typeof selection !== "object" || Array.isArray(selection)) return null;
  const summary = cleanString(selection.goalText ?? selection.goal_text, MAX_FIELD_CHARS);
  const customer = cleanString(selection.customer, MAX_FIELD_CHARS);
  const problem = cleanString(selection.problem, MAX_FIELD_CHARS);
  const validationAction = cleanString(selection.validationAction ?? selection.validation_action, MAX_FIELD_CHARS);
  if (!summary && !customer && !problem && !validationAction) return null;
  return {
    summary: summary || [customer, problem, validationAction].filter(Boolean).join(" · "),
    customer,
    problem,
    validationAction,
    source: "day1_goal",
  };
}

function goalSnapshotForDay({ day, record, day1GoalSelection } = {}) {
  if (Number(day) === 1) {
    const day1 = normalizeDay1GoalSnapshot(day1GoalSelection);
    if (day1) return day1;
  }
  const summary = cleanString(record?.goalText, MAX_FIELD_CHARS);
  if (!summary) return null;
  return {
    summary,
    customer: "",
    problem: "",
    validationAction: "",
    source: "day_progress",
  };
}

function isUnprovenDebt(commitment = {}) {
  if (!commitment || typeof commitment !== "object" || Array.isArray(commitment)) return false;
  if (commitment.evidence) return false;
  return ["open", "missed", "abandoned"].includes(commitment.status || "open");
}

function evidenceOSStateForDay({ day, record, day1GoalSelection, dayOpenDebts, dayProven, work } = {}) {
  if ((dayProven ?? []).length > 0) return "evidence_confirmed";
  if (work?.hasWork) return "build_escape";
  if ((dayOpenDebts ?? []).length > 0) return "closed_unproven";
  const goalSnapshot = goalSnapshotForDay({ day, record, day1GoalSelection });
  const steps = record?.steps && typeof record.steps === "object" && !Array.isArray(record.steps)
    ? Object.values(record.steps)
    : [];
  const touched = steps.some((status) => status === "done" || status === "active");
  const complete = steps.length > 0 && steps.every((status) => status === "done");
  if (complete) return "closed_unproven";
  if (touched || goalSnapshot) return "in_progress";
  return "not_started";
}

function evidenceOSLabelForState(state) {
  switch (state) {
    case "evidence_confirmed": return "증거 확인";
    case "build_escape": return "빌드만 진행";
    case "closed_unproven": return "증거 없음";
    case "in_progress": return "진행 중";
    case "not_started":
    default:
      return "시작 안 함";
  }
}

function evidenceOSToneForState(state) {
  switch (state) {
    case "evidence_confirmed": return "success";
    case "build_escape": return "danger";
    case "closed_unproven": return "warning";
    case "in_progress": return "warning";
    case "not_started":
    default:
      return "muted";
  }
}

function missingReasonsForReview({ missing, goalSnapshot, evidenceDebts, status } = {}) {
  const reasons = [];
  if (!goalSnapshot?.summary || missing?.includes("goal_snapshot")) {
    reasons.push("검증할 고객/문제/행동이 고정되지 않았습니다.");
  }
  if (missing?.includes("customer_evidence")) {
    reasons.push("고객명과 보낸 메시지가 연결되지 않았습니다.");
  }
  if (missing?.includes("hard_evidence")) {
    reasons.push("URL/스크린샷/커밋/결제 같은 확인 가능한 증거가 없습니다.");
  }
  if (missing?.includes("next_commitment")) {
    reasons.push("다음 고객 행동 약속이 없습니다.");
  }
  if ((evidenceDebts ?? []).length > 0) {
    reasons.push(`미해결 고객 약속 ${evidenceDebts.length}개가 남아 있습니다.`);
  }
  if (status === "build_escape") {
    reasons.push("빌드 작업은 있었지만 고객 행동 증거로 확인되지 않았습니다.");
  }
  return reasons;
}

function carryForwardActionForReview({ status, goalSnapshot, evidenceDebts, commitments } = {}) {
  const debt = (evidenceDebts ?? []).find((item) => item && !item.evidence)
    ?? (commitments ?? []).find((item) => item && !item.evidence && item.status === "open");
  if (debt?.text) return debt.text;
  if (goalSnapshot?.validationAction) return goalSnapshot.validationAction;
  if (goalSnapshot?.customer && goalSnapshot?.problem) {
    return `${goalSnapshot.customer}에게 "${sentenceFragment(goalSnapshot.problem, 80)}"를 실제 행동으로 확인한다.`;
  }
  if (status === "build_escape") return "오늘 고객 행동 1개를 정하고 확인 가능한 증거로 닫는다.";
  return "";
}

function sentenceFragment(value, max = 80) {
  const text = cleanString(value, max + 20);
  if (text.length <= max) return text;
  return `${text.slice(0, Math.max(0, max - 1)).trim()}…`;
}

// ── Normalization (tolerance-first; accepts old/corrupt input, coerces to current) ──

export function normalizeOfficeHoursMemory(value = {}, { now = new Date() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return makeDefaultOfficeHoursMemory({ now });
  }
  const timeline = toArray(value.timeline)
    .map((e) => normalizeTimelineEntry(e, { now }))
    .filter(Boolean)
    .slice(-MAX_TIMELINE_ENTRIES);
  const cycles = toArray(value.cycles)
    .map(normalizeCycleEntry)
    .filter(Boolean)
    .slice(-MAX_CYCLE_LEDGER);
  const commitments = capCommitments(
    toArray(value.commitments)
      .map((c) => normalizeCommitment(c, { now }))
      .filter(Boolean),
  );
  const predictions = toArray(value.predictions)
    .map((p) => normalizePrediction(p, { now }))
    .filter(Boolean)
    .slice(-MAX_PREDICTIONS);
  return {
    schemaVersion: OFFICE_HOURS_MEMORY_SCHEMA_VERSION,
    schema: OFFICE_HOURS_MEMORY_SCHEMA,
    updatedAt: normalizeIsoDate(value.updatedAt, now),
    compiledTruth: normalizeCompiledTruth(value.compiledTruth, { now }),
    timeline,
    cycles,
    commitments,
    predictions,
    entities: [], // Phase 2 — present as [] in v1.
  };
}

export function makeDefaultOfficeHoursMemory({ now = new Date() } = {}) {
  return {
    schemaVersion: OFFICE_HOURS_MEMORY_SCHEMA_VERSION,
    schema: OFFICE_HOURS_MEMORY_SCHEMA,
    updatedAt: now.toISOString(),
    compiledTruth: { text: "", openThreads: [], updatedAt: now.toISOString(), previous: null },
    timeline: [],
    cycles: [],
    commitments: [],
    predictions: [],
    entities: [],
  };
}

function normalizeCompiledTruth(value = {}, { now = new Date() } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { text: "", openThreads: [], updatedAt: now.toISOString(), previous: null };
  }
  const previousRaw = value.previous;
  const previous = previousRaw && typeof previousRaw === "object" && previousRaw.text
    ? {
        text: cleanString(previousRaw.text, MAX_COMPILED_TRUTH_CHARS),
        updatedAt: normalizeIsoDate(previousRaw.updatedAt, now),
      }
    : null;
  return {
    text: cleanString(value.text, MAX_COMPILED_TRUTH_CHARS),
    openThreads: toArray(value.openThreads)
      .map((t) => cleanString(t, MAX_FIELD_CHARS))
      .filter(Boolean)
      .slice(0, MAX_OPEN_THREADS),
    updatedAt: normalizeIsoDate(value.updatedAt, now),
    previous,
  };
}

function normalizeTimelineEntry(value = {}, { now = new Date() } = {}) {
  if (!value || typeof value !== "object") return null;
  const summary = cleanString(value.summary, MAX_FIELD_CHARS);
  if (!summary) return null;
  return {
    id: cleanString(value.id, 180) || makeId("tl", value.cycle, summary, now),
    date: normalizeIsoDate(value.date, now),
    cycle: clampInt(value.cycle, 1, MAX_CYCLE_LEDGER * 4, 1),
    source: TIMELINE_SOURCES.has(value.source) ? value.source : "interview",
    summary,
    detail: cleanString(value.detail, MAX_FIELD_CHARS),
    origin: ORIGINS.has(value.origin) ? value.origin : "system",
  };
}

function normalizeCycleEntry(value = {}) {
  if (!value || typeof value !== "object") return null;
  const cycle = clampInt(value.cycle, 1, MAX_CYCLE_LEDGER * 4, null);
  if (!cycle) return null;
  return {
    cycle,
    day: clampInt(value.day, 1, 400, cycle),
    date: typeof value.date === "string" ? value.date : new Date(0).toISOString(),
    step: CYCLE_STEPS.has(value.step) ? value.step : "interview",
    outcome: CYCLE_OUTCOMES.has(value.outcome) ? value.outcome : "success",
    lastAssignment: cleanString(value.lastAssignment, MAX_FIELD_CHARS),
    note: cleanString(value.note, MAX_FIELD_CHARS),
  };
}

function normalizeCommitment(value = {}, { now = new Date() } = {}) {
  if (!value || typeof value !== "object") return null;
  const text = cleanString(value.text, MAX_FIELD_CHARS);
  if (!text) return null;
  const cycle = clampInt(value.cycle, 1, MAX_CYCLE_LEDGER * 4, 1);
  const structured = normalizeCommitmentFields(value, { fallbackDueDay: null });
  return {
    id: cleanString(value.id, 180) || makeId("cm", cycle, text, now),
    cycle,
    createdDay: clampInt(value.createdDay, 1, 400, cycle),
    createdAt: normalizeIsoDate(value.createdAt, now),
    text,
    status: COMMITMENT_STATUSES.has(value.status) ? value.status : "open",
    evidence: normalizeEvidence(value.evidence, { now }),
    // Load trusts the local file by design: the user-origin gate's threat model is
    // MODEL/TOOL fabrication at append time, not the human who owns this workspace.
    origin: "user",
    customer: structured.customer,
    channel: structured.channel,
    message: structured.message,
    expectedEvidenceKind: structured.expectedEvidenceKind,
    dueDay: structured.dueDay,
    confirmedByUser: structured.confirmedByUser,
  };
}

function normalizePrediction(value = {}, { now = new Date() } = {}) {
  if (!value || typeof value !== "object") return null;
  const claim = cleanString(value.claim, MAX_FIELD_CHARS);
  if (!claim) return null;
  const cycle = clampInt(value.cycle, 1, MAX_CYCLE_LEDGER * 4, 1);
  return {
    id: cleanString(value.id, 180) || makeId("pr", cycle, claim, now),
    cycle,
    createdAt: normalizeIsoDate(value.createdAt, now),
    claim,
    verdict: PREDICTION_VERDICTS.has(value.verdict) ? value.verdict : "unresolved",
    gradedCycle: Number.isInteger(value.gradedCycle) ? value.gradedCycle : null,
    origin: "user",
  };
}

// Hard-evidence only. Returns null for anything that is not a real evidence kind —
// which keeps a graded commitment at `missed`, never `met`.
function normalizeEvidence(value, { now = new Date(), gradedCycle } = {}) {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  if (!EVIDENCE_KINDS.has(value.kind)) return null;
  const url = cleanString(value.url, MAX_FIELD_CHARS);
  const note = cleanString(value.note, MAX_FIELD_CHARS);
  if (!url && !note) return null; // an evidence kind with no locator/proof is not evidence.
  return {
    kind: value.kind,
    url,
    note,
    gradedCycle: Number.isInteger(value.gradedCycle ?? gradedCycle) ? (value.gradedCycle ?? gradedCycle) : null,
    gradedAt: normalizeIsoDate(value.gradedAt, now),
  };
}

function normalizeCommitmentFields(value = {}, { fallbackDueDay = null } = {}) {
  const input = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const expected = cleanToken(input.expectedEvidenceKind ?? input.expected_evidence_kind);
  const due = clampInt(input.dueDay ?? input.due_day, 1, 400, fallbackDueDay);
  const customer = cleanString(input.customer, MAX_FIELD_CHARS);
  const channel = cleanString(input.channel, 80);
  const message = cleanString(input.message, MAX_FIELD_CHARS);
  const hasExplicitStructuredDraft = ["customer", "channel", "message", "expectedEvidenceKind", "expected_evidence_kind", "dueDay", "due_day", "confirmedByUser", "confirmed_by_user"]
    .some((key) => Object.prototype.hasOwnProperty.call(input, key));
  const rawConfirmed = input.confirmedByUser ?? input.confirmed_by_user;
  return {
    customer,
    channel,
    message,
    expectedEvidenceKind: EVIDENCE_KINDS.has(expected) ? expected : "",
    dueDay: due,
    confirmedByUser: rawConfirmed === undefined ? true : rawConfirmed === true,
    hasExplicitStructuredDraft,
  };
}

function hasConfirmedStructuredCommitment(commitment) {
  const structured = normalizeCommitmentFields(commitment);
  return structured.confirmedByUser === true
    && Boolean(structured.customer)
    && Boolean(structured.message)
    && Boolean(structured.expectedEvidenceKind);
}

function commitmentToReviewRecord(commitment = {}) {
  const evidence = commitment.evidence
    ? {
        kind: commitment.evidence.kind,
        url: commitment.evidence.url,
        note: commitment.evidence.note,
        gradedCycle: commitment.evidence.gradedCycle,
        gradedAt: commitment.evidence.gradedAt,
      }
    : null;
  return {
    id: cleanString(commitment.id, 180),
    cycle: clampInt(commitment.cycle, 1, MAX_CYCLE_LEDGER * 4, 1),
    day: clampInt(commitment.createdDay ?? commitment.cycle, 1, 400, 1),
    createdAt: cleanString(commitment.createdAt, 80),
    text: cleanString(commitment.text, MAX_FIELD_CHARS),
    customer: cleanString(commitment.customer, MAX_FIELD_CHARS),
    channel: cleanString(commitment.channel, 80),
    message: cleanString(commitment.message || commitment.text, MAX_FIELD_CHARS),
    expectedEvidenceKind: cleanToken(commitment.expectedEvidenceKind),
    dueDay: Number.isInteger(commitment.dueDay) ? commitment.dueDay : null,
    confirmedByUser: commitment.confirmedByUser !== false,
    status: COMMITMENT_STATUSES.has(commitment.status) ? commitment.status : "open",
    evidence,
  };
}

function workSummaryForDay({ workHistory, dayProgress, day } = {}) {
  const date = dateKeyForChallengeDay(dayProgress?.challengeStartedAt, day);
  const available = Boolean(workHistory?.generatedAt && Array.isArray(workHistory.days));
  const dayEntry = available
    ? workHistory.days.find((entry) => entry?.date === date)
    : null;
  const areas = (dayEntry?.areas ?? []).map((area) => ({
    name: cleanString(area.name, 120),
    aiMinutes: clampInt(area.aiMinutes, 0, 10_000, 0),
    commitCount: clampInt(area.commitCount, 0, 10_000, 0),
    paths: toArray(area.paths).map((p) => cleanString(p, 160)).filter(Boolean).slice(0, 6),
  }));
  const commitCount = areas.reduce((sum, area) => sum + area.commitCount, 0);
  const aiMinutes = clampInt(dayEntry?.aiMinutes, 0, 10_000, 0);
  const referenceEventCount = toArray(dayEntry?.referenceEvents).length;
  return {
    available,
    date,
    aiMinutes,
    commitCount,
    referenceEventCount,
    hasWork: available && (aiMinutes > 0 || commitCount > 0 || referenceEventCount > 0 || areas.length > 0),
    areas,
  };
}

function dateKeyForChallengeDay(challengeStartedAt, day) {
  const match = String(challengeStartedAt || "").match(/^(\d{4})-(\d{2})-(\d{2})/);
  if (!match || !day) return "";
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]));
  date.setDate(date.getDate() + day - 1);
  return [
    date.getFullYear(),
    String(date.getMonth() + 1).padStart(2, "0"),
    String(date.getDate()).padStart(2, "0"),
  ].join("-");
}

function verdictLabelForStatus(status) {
  switch (status) {
    case "evidence_confirmed": return "확인 가능한 증거 있음";
    case "hard_evidence_confirmed": return "확인 가능한 증거 있음";
    case "build_escape": return "고객 증거 없이 빌드함";
    case "closed_unproven": return "완료했지만 증거 없음";
    case "commitment_unproven": return "약속했지만 증거 없음";
    case "blocked": return "못 한 이유 기록됨";
    case "not_started": return "시작 안 함";
    case "customer_evidence_missing":
    default:
      return "고객 증거 미기록";
  }
}

function verdictToneForStatus(status) {
  switch (status) {
    case "evidence_confirmed":
    case "hard_evidence_confirmed": return "success";
    case "build_escape": return "danger";
    case "closed_unproven":
    case "commitment_unproven":
    case "blocked":
      return "warning";
    case "not_started":
    case "customer_evidence_missing":
    default:
      return "muted";
  }
}

function reviewSummaryForStatus(status, { work, commitments, blockedCycle, goalSnapshot, evidenceDebts } = {}) {
  switch (status) {
    case "evidence_confirmed":
    case "hard_evidence_confirmed":
      return "고객 행동 약속이 확인 가능한 증거로 닫혔습니다.";
    case "build_escape":
      return `AI 작업 ${work?.aiMinutes ?? 0}분이 있었지만 확인 가능한 고객 증거가 없습니다. 다음 고객 접촉으로 닫아야 합니다.`;
    case "closed_unproven":
      return (evidenceDebts?.length ?? 0) > 0
        ? `완료된 단계는 있지만 미해결 고객 약속 ${evidenceDebts.length}개가 남아 있습니다.`
        : "단계는 닫혔지만 확인 가능한 고객 증거가 없습니다.";
    case "commitment_unproven":
      return "고객 행동 약속은 남겼지만 아직 URL/스크린샷/결제 같은 확인 가능한 증거가 없습니다.";
    case "blocked":
      return cleanString(blockedCycle?.note, MAX_FIELD_CHARS) || "고객 행동을 못 한 이유를 남기고 닫았습니다.";
    case "not_started":
      return goalSnapshot?.summary
        ? "회차 목표는 있지만 실행 단계가 아직 시작되지 않았습니다."
        : "이 회차는 시작되지 않아 오늘 검증 행동의 근거로 쓰기 어렵습니다.";
    case "customer_evidence_missing":
    default:
      return commitments?.length
        ? "약속은 있지만 고객명/메시지/증거 기준이 부족합니다."
        : "이 회차에는 고객 증거가 기록되지 않았습니다.";
  }
}

// ── small pure helpers ─────────────────────────────────────────────────────────

function deriveCompiledTruthText(memory) {
  // Deterministic, no LLM: a one-line synthesis from the latest cycle + open count.
  const last = (memory?.cycles ?? []).reduce((a, b) => (!a || b.cycle >= a.cycle ? b : a), null);
  const openCount = (memory?.commitments ?? []).filter((c) => c.status === "open").length;
  if (!last) return "";
  const assignment = cleanString(last.lastAssignment, MAX_FIELD_CHARS);
  const head = `Cycle ${last.cycle} (Day ${last.day}).`;
  const mid = assignment ? ` 마지막 약속: "${assignment}".` : "";
  const tail = openCount ? ` 열린 약속 ${openCount}개.` : "";
  return cleanString(`${head}${mid}${tail}`, MAX_COMPILED_TRUTH_CHARS);
}

// Highest cycle the store knows about — from BOTH the closed-cycle ledger and the
// commitments (a commitment can exist before its cycle closes).
function highestKnownCycle(memory) {
  const fromCycles = (memory?.cycles ?? []).reduce((m, c) => Math.max(m, c.cycle), 1);
  const fromCommitments = (memory?.commitments ?? []).reduce((m, c) => Math.max(m, c.cycle), 1);
  return Math.max(fromCycles, fromCommitments, 1);
}

// Status-aware cap: NEVER drop an `open` commitment (those are the long-silent threads
// the costume detector exists to surface). Only the resolved (met/missed/abandoned)
// tail is trimmed when over MAX_COMMITMENTS. Original order is preserved.
function capCommitments(all) {
  if (all.length <= MAX_COMMITMENTS) return all;
  const open = all.filter((c) => c.status === "open");
  const resolved = all.filter((c) => c.status !== "open");
  const room = Math.max(0, MAX_COMMITMENTS - open.length);
  const keepResolved = new Set(resolved.slice(-room).map((c) => c.id));
  return all.filter((c) => c.status === "open" || keepResolved.has(c.id));
}

function assertWorkspace(workspaceRoot, op) {
  if (!workspaceRoot || typeof workspaceRoot !== "string") {
    throw new Error(`${op} requires workspaceRoot.`);
  }
}

// User-origin gate: refuse anything not originating from the founder's own message.
function assertUserOrigin(originText, fnName) {
  const text = typeof originText === "string" ? originText.trim() : "";
  if (!text) {
    throw new Error(`${fnName}: user-origin gate — originText (the founder's own words) is required.`);
  }
}

function makeId(prefix, cycle, text, now) {
  // Readable hash of (cycle,text) for human scanning, but uniqueness must NOT depend
  // on text+ms: two identical commitments in the same ms ("DM 5개 보내기" twice) would
  // otherwise collide and make the second ungradeable. A short uuid tail guarantees it.
  const hash = createHash("sha256").update(`${cycle}|${text}`).digest("hex").slice(0, 8);
  const stamp = now instanceof Date ? now.getTime() : Date.parse(String(now)) || 0;
  return `${prefix}-${clampInt(cycle, 1, MAX_CYCLE_LEDGER * 4, 1)}-${stamp.toString(36)}-${hash}-${randomUUID().slice(0, 8)}`;
}

function toArray(value) {
  return Array.isArray(value) ? value : [];
}

function mergeDefined(base = {}, overlay = {}) {
  const next = { ...base };
  for (const [key, value] of Object.entries(overlay)) {
    if (value !== undefined) next[key] = value;
  }
  return next;
}

function cleanString(value = "", maxLength = MAX_FIELD_CHARS) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function cleanToken(value = "") {
  return String(value ?? "").trim().toLowerCase().replace(/[^a-z0-9_-]/g, "").slice(0, 80);
}

function clampInt(value, min, max, fallback) {
  const num = Number.parseInt(value, 10);
  if (!Number.isFinite(num)) return fallback;
  if (num < min) return min;
  if (num > max) return max;
  return num;
}

function normalizeIsoDate(value, fallbackDate) {
  const timestamp = Date.parse(String(value || ""));
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  return fallbackDate.toISOString();
}

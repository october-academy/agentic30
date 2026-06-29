// Office Hours effector HOST — the "host owns EFFECTS" half of SPEC v3 §5.
// office-hours-effector-context.mjs is the PURE assembler; this module performs the
// read-only I/O around it (load the daily landscape snapshot, run the gated
// cross-model second opinion) and hands the precomputed inputs to the pure builder.
// index.mjs stays thin: it calls computeOfficeHoursEffectorContext() once per turn.
//
// Invariants:
//   - second opinion runs ONLY through the judge_read_only execution mode, so it is
//     structurally read-only and CANNOT write session.pendingUserInput / runtime
//     (two-writer guard). It returns a parsed result; the caller injects it as
//     read-only CONTEXT only.
//   - every failure is fail-open: the office-hours turn never blocks; the result
//     degrades to { status: "unavailable" } and the caller records the
//     `second_opinion_unavailable` debt.
//   - cost guardrail: at most one second opinion per local day, and only when the
//     context carries a contested-premise marker.

import { runProviderStream } from "./provider-runner.mjs";
import { loadNewsMarketRadarSnapshot } from "./news-market-radar.mjs";
import {
  buildOfficeHoursEffectorContext,
  buildOfficeHoursSecondOpinionPrompt,
  parseOfficeHoursSecondOpinion,
  OFFICE_HOURS_SECOND_OPINION_EXECUTION_MODE,
} from "./office-hours-effector-context.mjs";
import { buildOfficeHoursBuilderJourneyContext } from "./office-hours-builder-journey.mjs";
import { loadOfficeHoursMemory } from "./office-hours-memory.mjs";

export const OFFICE_HOURS_SECOND_OPINION_UNAVAILABLE_DEBT = "second_opinion_unavailable";

const CONTESTED_PREMISE_RE = /CONTESTED_PREMISE|SECOND_OPINION_REQUESTED|전제\s*충돌|반대\s*관점\s*요청/i;

// Cost guardrail. Pure + unit-testable. A second opinion is a non-blocking quality
// enhancement, so it is rate-limited to once per local day and only fires when a
// premise is actually contested (the flow stamps the marker on opt-in).
export function shouldRunOfficeHoursSecondOpinion({
  context = "",
  alreadyRanTodayKey = "",
  todayKey = "",
  budgetExceeded = false,
} = {}) {
  if (budgetExceeded) return false;
  if (alreadyRanTodayKey && todayKey && alreadyRanTodayKey === todayKey) return false;
  return CONTESTED_PREMISE_RE.test(String(context || ""));
}

// Run the cross-model second opinion as a read-only judge subcall. NEVER touches
// session state. Always resolves (never throws) — fail-open by construction.
export async function runOfficeHoursSecondOpinion({
  summary = {},
  provider = "",
  model = "",
  workspaceRoot = process.cwd(),
  timeoutMs = 120_000,
  runProvider = runProviderStream,
} = {}) {
  const prompt = buildOfficeHoursSecondOpinionPrompt(summary);
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
      executionMode: OFFICE_HOURS_SECOND_OPINION_EXECUTION_MODE,
      onTextDelta: (chunk) => { rawOutput += String(chunk || ""); },
      onTextReplace: (text) => { rawOutput = String(text || ""); },
    });
    return parseOfficeHoursSecondOpinion(rawOutput);
  } catch (error) {
    return { status: "unavailable", reason: String(error?.message || error || "error").slice(0, 200) };
  } finally {
    clearTimeout(timer);
  }
}

// Read-only landscape headlines from the daily-cached radar snapshot. Graceful:
// any failure or empty cache → [].
async function loadLandscapeLines({ workspaceRoot, now, loadSnapshot = loadNewsMarketRadarSnapshot }) {
  try {
    const snapshot = await loadSnapshot({ workspaceRoot, now });
    const pools = [snapshot?.cards, snapshot?.items, snapshot?.headlines, snapshot?.entries]
      .filter((pool) => Array.isArray(pool));
    const lines = [];
    for (const pool of pools) {
      for (const item of pool) {
        const text = typeof item === "string"
          ? item
          : (item?.title || item?.headline || item?.summary || item?.label || "");
        const clean = String(text || "").replace(/\s+/g, " ").trim();
        if (clean && !lines.includes(clean)) lines.push(clean);
        if (lines.length >= 3) return lines;
      }
    }
    return lines;
  } catch {
    return [];
  }
}

// Phase 6 builder-journey (SPEC v3 §12) — the relationship-closing handoff, ported from
// the gstack 4-tier handoff into the OA Partner voice. Host precomputed READ-ONLY context:
// the tier follows the closed-cycle count and the model writes the actual closing prose.
// Only emits for a RETURNING builder (>=1 closed cycle) — a brand-new first interview has
// no journey arc to reflect yet, so a fresh workspace keeps an empty effector context
// (introduction-tier wiring for the very first session is deferred).
async function loadBuilderJourneyContext({ workspaceRoot, now, loadMemory }) {
  let memory = null;
  try {
    memory = await loadMemory({ workspaceRoot, now });
  } catch {
    return "";
  }
  const cycles = Array.isArray(memory?.cycles) ? memory.cycles : [];
  if (cycles.length < 1) return "";
  const lastCycle = cycles[cycles.length - 1] || {};
  return buildOfficeHoursBuilderJourneyContext({
    sessionCount: cycles.length + 1,
    // The cycle ledger has NO per-cycle "design title" field. `cycle.note` is the
    // avoidance-CONFESSION slot (only blocked cycles write it; see the index.mjs cycle
    // writer "the confession is the note, NOT the next assignment"). Sourcing a design
    // trajectory from it would reframe a builder's confession as progress — the exact
    // anti-pattern this product confronts. Omit titles; compiledTruth carries the real
    // accumulated narrative via accumulatedSignals below.
    designTitles: [],
    // The MOST RECENT cycle's assignment only — honestly empty when the latest cycle was
    // a confession (blocked → lastAssignment ""), rather than reverse-scanning past it and
    // resurfacing an older success commitment as if it were the open one.
    lastAssignment: String(lastCycle.lastAssignment || "").trim(),
    accumulatedSignals: String(memory?.compiledTruth?.text || "").trim(),
  });
}

// The single host entry point. Loads read-only inputs, runs the gated second
// opinion when summary + marker + guardrail allow, folds in the Phase 6
// builder-journey close, and returns the PURE effector context string ("" when there
// is nothing to inject — sim / empty workspaces degrade cleanly). `debtSink`
// (optional) collects fail-open debt markers.
export async function computeOfficeHoursEffectorContext({
  workspaceRoot = process.cwd(),
  context = "",
  now = new Date(),
  summary = null,
  provider = "",
  model = "",
  alreadyRanTodayKey = "",
  todayKey = "",
  budgetExceeded = false,
  externalContext = "",
  alternatives = [],
  loadSnapshot = loadNewsMarketRadarSnapshot,
  loadMemory = loadOfficeHoursMemory,
  runProvider = runProviderStream,
  debtSink = null,
} = {}) {
  const landscape = await loadLandscapeLines({ workspaceRoot, now, loadSnapshot });

  let secondOpinion = null;
  const wantsSecondOpinion = summary
    && shouldRunOfficeHoursSecondOpinion({ context, alreadyRanTodayKey, todayKey, budgetExceeded });
  if (wantsSecondOpinion) {
    secondOpinion = await runOfficeHoursSecondOpinion({
      summary, provider, model, workspaceRoot, runProvider,
    });
    if (secondOpinion?.status !== "ok" && Array.isArray(debtSink)) {
      debtSink.push(OFFICE_HOURS_SECOND_OPINION_UNAVAILABLE_DEBT);
    }
  }

  const builderJourney = await loadBuilderJourneyContext({ workspaceRoot, now, loadMemory })
    .catch(() => "");

  return buildOfficeHoursEffectorContext({
    landscape, secondOpinion, externalContext, alternatives, builderJourney,
  });
}

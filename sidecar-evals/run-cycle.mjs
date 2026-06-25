#!/usr/bin/env node
/**
 * One measurement cycle of the autonomous improve-loop.
 *
 * Runs the real-project Office Hours arc (LIVE codex) for each configured user
 * project, judges each capture on the 6 dogfood dimensions against Agentic30's
 * own ICP/VALUES/GOAL, then aggregates a cycle score + identifies the weakest
 * dimension to guide the next improvement. Projects run sequentially to avoid
 * concurrent-codex rate limits.
 *
 * Usage:
 *   AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1 node sidecar-evals/run-cycle.mjs \
 *     --cycle 0 --days 1 --max-turns 6 --out sidecar-evals/.artifacts/cycle-0.json
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRealProjectArc } from "./real-project-arc.mjs";
import { judgeCapture } from "./judge-real-arc.mjs";
import { loadReferenceDocs, SCORE_KEYS } from "./dogfood-judge.mjs";
import { computeGroundingInvariants, summarizeGroundingInvariants } from "./grounding-invariants.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const scratch = path.resolve(packageRoot, "..", "..");

// User projects to simulate. dongdong = real thin-context project (PDF only);
// agentic30 = the product itself with rich synthesized context from its docs.
const PROJECTS = [
  // Domain-matched persona so the measurement reflects card→customer fit, not a
  // persona/domain mismatch (dongdong is a Buddhist mindfulness app, not a dev tool).
  { label: "dongdong", projectPath: path.resolve(packageRoot, "..", "dongdong"), personaId: "mindfulness-app" },
  {
    label: "agentic30",
    projectPath: packageRoot,
    personaId: "icp-solo-dev",
    goalOverride: "AGENTIC30_GOAL_FILE",
    projectContextOverride: "AGENTIC30_CONTEXT_FILE",
  },
];

async function loadJsonMaybe(p) {
  if (!p) return null;
  try { return JSON.parse(await fs.readFile(p, "utf8")); } catch { return null; }
}

async function main() {
  const argv = process.argv.slice(2);
  const opts = { cycle: 0, days: [1], maxTurns: 6 };
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === "--cycle") opts.cycle = Number(argv[++i]);
    else if (argv[i] === "--days") opts.days = argv[++i].split(",").map((d) => Number(d.trim())).filter(Boolean);
    else if (argv[i] === "--max-turns") opts.maxTurns = Number(argv[++i]);
    else if (argv[i] === "--out") opts.out = argv[++i];
    else if (argv[i] === "--goal-file") opts.goalFile = argv[++i];
    else if (argv[i] === "--context-file") opts.contextFile = argv[++i];
  }
  const goalOverride = await loadJsonMaybe(opts.goalFile);
  const contextOverride = await loadJsonMaybe(opts.contextFile);
  const referenceDocs = await loadReferenceDocs(packageRoot);

  const results = [];
  for (const proj of PROJECTS) {
    const t0 = Date.now();
    let captured, judged;
    try {
      const arc = await runRealProjectArc(proj.projectPath, {
        mode: "live",
        label: proj.label,
        personaId: proj.personaId || "icp-solo-dev",
        days: opts.days,
        maxTurnsPerDay: opts.maxTurns,
        goalOverride: proj.goalOverride ? goalOverride : null,
        projectContextOverride: proj.projectContextOverride ? contextOverride : null,
      });
      captured = arc.captured;
      judged = await judgeCapture({ capturedPath: path.join(arc.runDir, "captured.json"), referenceDocs });
    } catch (e) {
      results.push({ label: proj.label, error: e.message });
      continue;
    }
    const v = judged.verdict;
    // Deterministic grounding invariants (primary low-noise signal). Computed from
    // the captured cards alone — no LLM — so a <0.5 first_candidate grounding change
    // the judge cannot resolve (σ~1.0) shows up here as a hard boolean flip.
    const invariants = computeGroundingInvariants(captured);
    results.push({
      label: proj.label,
      elapsedSec: Math.round((Date.now() - t0) / 1000),
      cardCount: judged.cardCount,
      dayOutcomes: (captured.days || []).map((d) => `day${d.day}:${d.outcome}`),
      arcErrors: captured.errors,
      overall: v.overall,
      scores: v.scores,
      judge_summary: v.judge_summary,
      regressions: v.regressions,
      judge_status: v.judge_status,
      groundingInvariants: invariants,
    });
  }

  // Aggregate: cross-project mean per dimension + overall + weakest dimension.
  const scored = results.filter((r) => r.scores);
  const dimMeans = {};
  for (const k of SCORE_KEYS) {
    const vals = scored.map((r) => r.scores[k]).filter((n) => typeof n === "number");
    dimMeans[k] = vals.length ? Number((vals.reduce((a, b) => a + b, 0) / vals.length).toFixed(2)) : null;
  }
  const overalls = scored.map((r) => r.overall).filter((n) => typeof n === "number");
  const cycleOverall = overalls.length ? Number((overalls.reduce((a, b) => a + b, 0) / overalls.length).toFixed(2)) : null;
  const weakest = Object.entries(dimMeans)
    .filter(([, v]) => typeof v === "number")
    .sort((a, b) => a[1] - b[1])[0] || null;

  // Cycle-level grounding rollup: ALL-projects booleans + mean rate. This is the
  // acceptance signal for the first_candidate fix (judge score may not move).
  const groundingInvariants = summarizeGroundingInvariants(
    results
      .filter((r) => r.groundingInvariants)
      .map((r) => ({ label: r.label, invariants: r.groundingInvariants })),
  );

  // ── Lexicographic 3-stage gate (GPT-5.5 Pro architecture verdict, 2026-06-25) ──
  // The retired `target:9.5 / reached` objective is GONE. The 6-dim LLM judge mean is
  // a DIAGNOSTIC PROXY, not a release gate: chasing 9.5 on a sibling-model judge that
  // reads the product's OWN docs is structurally proxy-polishing — a 9.5 card and a
  // 6.0 card produce identical real-world results if no real customer is contacted.
  // Real quality = recorded external non-founder behavior (N), captured by the
  // outcome/Action-Receipt rail (A′), currently N=0. The three stages are
  // LEXICOGRAPHIC (each necessary, none compensable by another):
  //   1. mechanically_valid   — deterministic integrity/grounding invariants (HARD veto)
  //   2. proxy_preferred      — the synthetic 6-dim mean RANKS candidates (gradient only)
  //   3. externally_validated — real action/outcome data; in this synthetic harness = INSUFFICIENT
  const stage1Failures = [];
  if (groundingInvariants.first_candidate_generic_only_any === true) stage1Failures.push("first_candidate_generic_only_any=true");
  if (groundingInvariants.first_candidate_forces_specificity_all === false) stage1Failures.push("first_candidate_forces_specificity_all=false");
  if (groundingInvariants.first_candidate_has_blocker_all === false) stage1Failures.push("first_candidate_has_blocker_all=false");
  if (groundingInvariants.thin_context_no_fabricated_names_all === false) stage1Failures.push("thin_context_no_fabricated_names_all=false");
  const mechanicallyValid = stage1Failures.length === 0;
  // Stage 3 requires REAL external-outcome data. This synthetic harness (scripted
  // persona + sim/registered-fixture evidence) cannot produce it by construction →
  // N=0 here always. Only the in-product A′ outcome rail can move this off INSUFFICIENT.
  const externallyValidated = "INSUFFICIENT_EXTERNAL_EVIDENCE";

  const report = {
    cycle: opts.cycle,
    at: new Date().toISOString(),
    days: opts.days,
    maxTurns: opts.maxTurns,
    // The honest gate (replaces the retired target:9.5/reached).
    gate: {
      stage1_mechanically_valid: mechanicallyValid,
      stage1_failures: stage1Failures,
      stage2_proxy_preferred: {
        cycleOverall,
        dimMeans,
        weakestDimension: weakest ? { key: weakest[0], mean: weakest[1] } : null,
      },
      stage3_externally_validated: externallyValidated,
      verdict: mechanicallyValid
        ? "PROXY_PREFERRED — synthetic-proxy only; external validation INSUFFICIENT (N=0). NOT a real-quality claim."
        : "MECHANICALLY_INVALID — deterministic integrity gate failed; fix before reading the proxy.",
      note: "The 6-dim LLM judge mean is a DIAGNOSTIC PROXY, not a release objective. 9.5-chasing is RETIRED (GPT-5.5 Pro verdict): real quality = recorded external behavior N, captured by the A′ outcome rail. A cycle where the proxy falls but a real customer is contacted is progress; a 9.5 with N=0 is not.",
    },
    // Diagnostic proxy (kept for variance/ranking; NOT the gate).
    cycleOverall,
    dimMeans,
    weakestDimension: weakest ? { key: weakest[0], mean: weakest[1] } : null,
    groundingInvariants,
    projects: results,
  };
  const out = opts.out || path.join(packageRoot, "sidecar-evals", ".artifacts", `cycle-${opts.cycle}.json`);
  await fs.mkdir(path.dirname(out), { recursive: true });
  await fs.writeFile(out, JSON.stringify(report, null, 2) + "\n");

  console.log(`\n=== CYCLE ${opts.cycle} ===`);
  console.log(`GATE: ${report.gate.verdict}`);
  console.log(`  stage1 mechanically_valid=${mechanicallyValid}${stage1Failures.length ? ` (failures: ${stage1Failures.join(", ")})` : ""}`);
  console.log(`  stage2 proxy(DIAGNOSTIC only, NOT a gate): cycleOverall=${cycleOverall} weakest=${weakest ? `${weakest[0]}(${weakest[1]})` : "n/a"}`);
  console.log(`  stage3 externally_validated=${externallyValidated} — real N is moved only by the in-product A′ outcome rail`);
  console.log(`dimMeans(diagnostic): ${SCORE_KEYS.map((k) => `${k}=${dimMeans[k]}`).join(" ")}`);
  for (const r of results) {
    console.log(`  [${r.label}] overall=${r.overall ?? r.error} cards=${r.cardCount ?? "-"} outcomes=${(r.dayOutcomes || []).join(",")}`);
    const gi = r.groundingInvariants;
    if (gi) {
      console.log(
        `    grounding: first_candidate_present=${gi.first_candidate_present}`
        + ` generic_only=${gi.first_candidate_generic_only}`
        + ` forces_specificity=${gi.first_candidate_forces_specificity}`
        + ` has_blocker=${gi.first_candidate_has_blocker}`
        + ` no_fabricated_names=${gi.thin_context_no_fabricated_names}`
        + ` ref_consistency_4_6=${gi.candidate_ref_consistency_4_6}`,
      );
      console.log(`    first_candidate options: ${JSON.stringify(gi._detail?.firstCandidateOptions || [])}`);
    }
  }
  console.log(
    `groundingInvariants(cycle): generic_only_any=${groundingInvariants.first_candidate_generic_only_any}`
    + ` forces_specificity_all=${groundingInvariants.first_candidate_forces_specificity_all}`
    + ` has_blocker_all=${groundingInvariants.first_candidate_has_blocker_all}`
    + ` no_fabricated_names_all=${groundingInvariants.thin_context_no_fabricated_names_all}`
    + ` ref_consistency_4_6_mean=${groundingInvariants.candidate_ref_consistency_4_6_mean}`,
  );
  console.log(`report → ${out}`);
}

main().catch((e) => { console.error(e); process.exit(1); });

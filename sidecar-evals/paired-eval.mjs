#!/usr/bin/env node
/**
 * Paired-eval harness — credible measurement of office-hours Day-1 card quality.
 *
 * GPT-5.5 Pro's design: the DOMINANT noise source on a single LIVE run is
 * GENERATION variance (~1.0 cross-run swing — the model emits different cards each
 * run), NOT judge noise (judge variance on a FROZEN capture is small: overall
 * sd≈0.16). So this harness averages over MANY generation captures per project, and
 * for each FROZEN capture judges a few times and takes the MEDIAN per dimension
 * (cheap insurance for the two flickering dims: goal_alignment, evidence_use). The
 * deterministic grounding invariants are generation-independent and lowest-noise, so
 * they are reported per capture and aggregated as rates.
 *
 * Statistical contract (review-critical):
 *  - per-project mean (over landed captures) is the UNIT of analysis.
 *  - the aggregate 95% CI uses a HIERARCHICAL bootstrap: resample projects WITH
 *    replacement, then captures-within-each-chosen-project WITH replacement, and
 *    recompute the grand mean. With only 2 projects the CI is honestly WIDE — that
 *    is correct and the point. We do NOT fake tightness.
 *  - all resampling uses a SEEDED LCG (NOT Math.random) so a given set of captures +
 *    seed yields an identical CI. Only generation is random (the live model).
 *  - no-legacy / clean / fail-closed: a failed arc is SKIPPED with a logged reason
 *    (never crashes the run); an aggregate with no landed captures THROWS.
 *
 * Reuse (no reimplementation): runRealProjectArc (real-project-arc.mjs),
 * judgeCapture (judge-real-arc.mjs), loadReferenceDocs + SCORE_KEYS
 * (dogfood-judge.mjs), computeGroundingInvariants (grounding-invariants.mjs).
 *
 * LIVE arcs are gated by AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1 (same as run-cycle).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { runRealProjectArc } from "./real-project-arc.mjs";
import { judgeCapture } from "./judge-real-arc.mjs";
import { loadReferenceDocs, SCORE_KEYS } from "./dogfood-judge.mjs";
import { computeGroundingInvariants } from "./grounding-invariants.mjs";

const packageRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");

// The per-capture score carries the 6 rubric dims plus a synthesized "overall".
export const MEASURE_KEYS = Object.freeze([...SCORE_KEYS, "overall"]);

// Boolean grounding invariants reported as per-project rates (fraction of landed
// captures with the invariant true). candidate_ref_consistency_4_6 is already a
// rate per capture; we average it.
const GROUNDING_BOOLEAN_KEYS = Object.freeze([
  "first_candidate_present",
  "first_candidate_generic_only",
  "first_candidate_forces_specificity",
  "first_candidate_has_blocker",
  "thin_context_no_fabricated_names",
]);
const GROUNDING_RATE_KEYS = Object.freeze(["candidate_ref_consistency_4_6"]);

const BOOTSTRAP_DEFAULT = 2000;

// ── Seeded PRNG (deterministic LCG — NOT Math.random) ───────────────────────
// glibc-style LCG: x = (1103515245*x + 12345) & 0x7fffffff. Multiplication can
// exceed 2^53, so we use BigInt for the step to keep it exact, then drop back to
// Number for the 31-bit state. Same seed → identical stream → reproducible CI.
const LCG_A = 1103515245n;
const LCG_C = 12345n;
const LCG_MASK = 0x7fffffffn; // 2^31 - 1

export function makeLcg(seed = 12345) {
  let state = BigInt(Math.abs(Math.trunc(Number(seed))) % 0x7fffffff);
  if (state === 0n) state = 1n; // avoid a degenerate all-zero stream
  const next = () => {
    state = (LCG_A * state + LCG_C) & LCG_MASK;
    return Number(state);
  };
  return {
    // raw 31-bit integer
    nextInt31: next,
    // float in [0, 1)
    nextFloat: () => next() / 0x80000000, // divide by 2^31
    // integer in [0, n) via float scaling (n is small here: project/capture counts)
    nextIndex: (n) => {
      if (!Number.isInteger(n) || n <= 0) throw new Error(`nextIndex requires n>0, got ${n}`);
      return Math.floor((next() / 0x80000000) * n);
    },
  };
}

// ── pure stats ──────────────────────────────────────────────────────────────
export function median(values) {
  const list = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  if (list.length === 0) throw new Error("median requires at least one finite value");
  const sorted = [...list].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  // even length → mean of the two middle values; odd → the middle value.
  return sorted.length % 2 === 0
    ? (sorted[mid - 1] + sorted[mid]) / 2
    : sorted[mid];
}

export function mean(values) {
  const list = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  if (list.length === 0) throw new Error("mean requires at least one finite value");
  return list.reduce((a, b) => a + b, 0) / list.length;
}

// Sample standard deviation (n-1). With a single value sd is 0 (no spread observed),
// which is the honest report for a 1-capture project.
export function sampleSd(values) {
  const list = (Array.isArray(values) ? values : []).filter((v) => Number.isFinite(v));
  if (list.length === 0) throw new Error("sampleSd requires at least one finite value");
  if (list.length === 1) return 0;
  const m = mean(list);
  const variance = list.reduce((a, b) => a + (b - m) ** 2, 0) / (list.length - 1);
  return Math.sqrt(variance);
}

function round2(value) {
  return Math.round(Number(value) * 100) / 100;
}

// 2.5th / 97.5th percentile of a sorted bootstrap distribution (linear interpolation
// on the sorted array). Deterministic given the same distribution.
function percentile(sortedAsc, p) {
  if (sortedAsc.length === 0) throw new Error("percentile requires a non-empty distribution");
  if (sortedAsc.length === 1) return sortedAsc[0];
  const rank = p * (sortedAsc.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  if (lo === hi) return sortedAsc[lo];
  const frac = rank - lo;
  return sortedAsc[lo] + (sortedAsc[hi] - sortedAsc[lo]) * frac;
}

function ci95(distribution) {
  const sorted = [...distribution].sort((a, b) => a - b);
  return [round2(percentile(sorted, 0.025)), round2(percentile(sorted, 0.975))];
}

// ── per-capture: median across judgings (per dim + overall) ─────────────────
/**
 * Reduce J verdicts for one FROZEN capture to a single per-capture score by taking
 * the MEDIAN of each dimension (and overall) across the judgings. The judge writes
 * verdict.scores[dim] and verdict.overall; we never average — median is the cheap
 * insurance against the two flickering dims.
 */
export function capturePerCaptureScore(verdicts) {
  const list = (Array.isArray(verdicts) ? verdicts : []).filter(Boolean);
  if (list.length === 0) throw new Error("capturePerCaptureScore requires at least one verdict");
  const score = {};
  for (const key of SCORE_KEYS) {
    const vals = list.map((v) => Number(v?.scores?.[key])).filter((n) => Number.isFinite(n));
    if (vals.length === 0) throw new Error(`verdicts missing finite score for dimension ${key}`);
    score[key] = round2(median(vals));
  }
  const overalls = list.map((v) => Number(v?.overall)).filter((n) => Number.isFinite(n));
  if (overalls.length === 0) throw new Error("verdicts missing a finite overall");
  score.overall = round2(median(overalls));
  return score;
}

// ── per-project: mean + sd over landed captures ─────────────────────────────
function perProjectStats(captureScores) {
  if (!Array.isArray(captureScores) || captureScores.length === 0) {
    throw new Error("perProjectStats requires at least one landed capture");
  }
  const perDim = {};
  for (const key of SCORE_KEYS) {
    const vals = captureScores.map((c) => c[key]);
    perDim[key] = { mean: round2(mean(vals)), sd: round2(sampleSd(vals)) };
  }
  const overalls = captureScores.map((c) => c.overall);
  return { perDim, overall: { mean: round2(mean(overalls)), sd: round2(sampleSd(overalls)) } };
}

function perProjectInvariantRates(invariantList) {
  const list = (Array.isArray(invariantList) ? invariantList : []).filter(Boolean);
  const rates = {};
  if (list.length === 0) {
    for (const key of GROUNDING_BOOLEAN_KEYS) rates[key] = null;
    for (const key of GROUNDING_RATE_KEYS) rates[key] = null;
    return rates;
  }
  for (const key of GROUNDING_BOOLEAN_KEYS) {
    const hits = list.filter((inv) => inv[key] === true).length;
    rates[key] = round2(hits / list.length);
  }
  for (const key of GROUNDING_RATE_KEYS) {
    const vals = list.map((inv) => Number(inv[key])).filter((n) => Number.isFinite(n));
    rates[key] = vals.length ? round2(mean(vals)) : null;
  }
  return rates;
}

// ── hierarchical bootstrap of the aggregate grand mean ──────────────────────
/**
 * For each of B resamples: (a) sample projects WITH replacement, then (b) within
 * each chosen project sample its landed captures WITH replacement, recompute that
 * project's mean for the dimension, then take the grand mean across the chosen
 * projects. The resulting distribution's [2.5%, 97.5%] is the CI. The two-level
 * resample is what makes the CI honestly reflect n=2 projects.
 *
 * `projectCaptureScores` = array (per project) of arrays of per-capture dim values.
 */
export function hierarchicalBootstrapCi(projectCaptureScores, { B = BOOTSTRAP_DEFAULT, rng } = {}) {
  const projects = (Array.isArray(projectCaptureScores) ? projectCaptureScores : [])
    .filter((p) => Array.isArray(p) && p.length > 0);
  if (projects.length === 0) throw new Error("hierarchicalBootstrapCi requires at least one non-empty project");
  if (!rng) throw new Error("hierarchicalBootstrapCi requires a seeded rng");

  const distribution = new Array(B);
  for (let b = 0; b < B; b++) {
    let grandSum = 0;
    for (let p = 0; p < projects.length; p++) {
      // (a) sample a project index with replacement
      const projIdx = rng.nextIndex(projects.length);
      const captures = projects[projIdx];
      // (b) sample captures-within-project with replacement, recompute the mean
      let projSum = 0;
      for (let c = 0; c < captures.length; c++) {
        projSum += captures[rng.nextIndex(captures.length)];
      }
      grandSum += projSum / captures.length;
    }
    distribution[b] = grandSum / projects.length;
  }
  return ci95(distribution);
}

// ── aggregate across projects ───────────────────────────────────────────────
function aggregateAcrossProjects(perProjectCaptureScores, { B, seed }) {
  // perProjectCaptureScores: { <label>: [ {dim:..., overall:...}, ... ] }
  const labels = Object.keys(perProjectCaptureScores).filter(
    (l) => Array.isArray(perProjectCaptureScores[l]) && perProjectCaptureScores[l].length > 0,
  );
  if (labels.length === 0) throw new Error("aggregateAcrossProjects requires at least one project with landed captures");

  const perDim = {};
  for (const key of MEASURE_KEYS) {
    // per-project means for this dimension (the unit of analysis)
    const projectMeans = labels.map((l) => mean(perProjectCaptureScores[l].map((c) => c[key])));
    const grandMean = round2(mean(projectMeans));
    // hierarchical bootstrap: each dimension gets its OWN fresh seeded stream so the
    // CI for one dim is independent of the order dims were computed in (reproducible
    // per-dim given the same seed + captures).
    const rng = makeLcg(seed + hashKey(key));
    const projectCaptureScores = labels.map((l) => perProjectCaptureScores[l].map((c) => c[key]));
    const ci = hierarchicalBootstrapCi(projectCaptureScores, { B, rng });
    perDim[key] = { mean: grandMean, ci95: ci };
  }
  return {
    perDim: Object.fromEntries(SCORE_KEYS.map((k) => [k, perDim[k]])),
    overall: perDim.overall,
  };
}

// Small deterministic key→offset so each dimension seeds a distinct but reproducible
// LCG stream. Pure function of the string (no Math.random).
function hashKey(key) {
  let h = 0;
  for (let i = 0; i < key.length; i++) h = (h * 31 + key.charCodeAt(i)) & 0x7fffffff;
  return h;
}

function aggregateInvariantRates(allInvariants) {
  const list = (Array.isArray(allInvariants) ? allInvariants : []).filter(Boolean);
  const rates = {};
  if (list.length === 0) {
    for (const key of [...GROUNDING_BOOLEAN_KEYS, ...GROUNDING_RATE_KEYS]) rates[key] = null;
    return rates;
  }
  for (const key of GROUNDING_BOOLEAN_KEYS) {
    rates[key] = round2(list.filter((inv) => inv[key] === true).length / list.length);
  }
  for (const key of GROUNDING_RATE_KEYS) {
    const vals = list.map((inv) => Number(inv[key])).filter((n) => Number.isFinite(n));
    rates[key] = vals.length ? round2(mean(vals)) : null;
  }
  return rates;
}

// ── arc landing predicate ────────────────────────────────────────────────────
/**
 * An arc "lands" when it produced at least one Day-1 card and did not fail/timeout.
 * A capture that fails (timeout/error/outcome!=card-producing) is SKIPPED with a
 * logged reason — never crashes the run. Returns null when landed, else a reason.
 */
export function captureLandReason(captured) {
  if (!captured || typeof captured !== "object") return "no_capture";
  const fatal = (captured.errors || []).find((e) => /^fatal:/.test(String(e)));
  if (fatal) return String(fatal);
  const days = Array.isArray(captured.days) ? captured.days : [];
  const day1 = days.find((d) => d.day === 1) || days[0];
  if (!day1) return "no_day";
  const cards = Array.isArray(day1.questions) ? day1.questions : [];
  if (cards.length === 0) return `no_cards(outcome=${day1.outcome || "?"})`;
  const outcome = String(day1.outcome || "");
  if (/timeout/i.test(outcome)) return `timeout(outcome=${outcome})`;
  return null; // landed
}

// ── measureVersion ───────────────────────────────────────────────────────────
/**
 * Measure one product version across projects. Injectable seams (runArc / judge)
 * keep unit tests LIVE-free; defaults wire the real reused functions.
 *
 * @param {object} cfg
 *  - projects: [{ label, projectPath, personaId?, goalOverride?, projectContextOverride? }]
 *  - capturesPerProject (default 5), judgingsPerCapture (default 3)
 *  - days (default [1]), maxTurns (default 8)
 *  - goalOverride/projectContextOverride: applied to projects whose config marks them
 *  - referenceDocs: required for the live judge (loaded by the CLI)
 *  - seed (default 12345): seeds the bootstrap PRNG ONLY
 *  - bootstrapB (default 2000)
 *  - runArc: async (projectPath, opts) => { runDir, captured } (default runRealProjectArc)
 *  - judge: async ({ capturedPath, referenceDocs }) => { verdict } (default judgeCapture)
 *  - label: version label for the result
 */
export async function measureVersion({
  projects,
  capturesPerProject = 5,
  judgingsPerCapture = 3,
  days = [1],
  maxTurns = 8,
  goalOverride = null,
  projectContextOverride = null,
  referenceDocs = null,
  seed = 12345,
  bootstrapB = BOOTSTRAP_DEFAULT,
  runArc = runRealProjectArc,
  judge = judgeCapture,
  label = "version",
  log = () => {},
} = {}) {
  if (!Array.isArray(projects) || projects.length === 0) {
    throw new Error("measureVersion requires a non-empty projects array");
  }
  if (!Number.isInteger(capturesPerProject) || capturesPerProject < 1) {
    throw new Error("capturesPerProject must be a positive integer");
  }
  if (!Number.isInteger(judgingsPerCapture) || judgingsPerCapture < 1) {
    throw new Error("judgingsPerCapture must be a positive integer");
  }

  const perProject = {};
  const perProjectCaptureScores = {}; // label → [{dim..., overall}]
  const allInvariants = [];
  const capturePaths = [];

  for (const proj of projects) {
    const projLabel = proj.label;
    log(`[${projLabel}] measuring: ${capturesPerProject} captures × ${judgingsPerCapture} judgings`);
    const captureScores = [];
    const projInvariants = [];
    let landed = 0;
    const skips = [];

    // Captures run SEQUENTIALLY (codex rate limits) — each writes its own captured.json.
    for (let cap = 0; cap < capturesPerProject; cap++) {
      let captured, capturedPath;
      try {
        const arc = await runArc(proj.projectPath, {
          mode: "live",
          label: projLabel,
          personaId: proj.personaId || "icp-solo-dev",
          days,
          maxTurnsPerDay: maxTurns,
          goalOverride: proj.goalOverride ? goalOverride : null,
          projectContextOverride: proj.projectContextOverride ? projectContextOverride : null,
        });
        captured = arc.captured;
        capturedPath = path.join(arc.runDir, "captured.json");
      } catch (e) {
        skips.push({ capture: cap, reason: `arc_threw: ${e.message}` });
        log(`[${projLabel}] capture ${cap + 1}/${capturesPerProject} SKIPPED: arc threw — ${e.message}`);
        continue;
      }

      const landReason = captureLandReason(captured);
      if (landReason) {
        skips.push({ capture: cap, reason: landReason });
        log(`[${projLabel}] capture ${cap + 1}/${capturesPerProject} SKIPPED: ${landReason}`);
        continue;
      }

      // Judge the FROZEN capture J times, take the median per dim + overall.
      const verdicts = [];
      for (let j = 0; j < judgingsPerCapture; j++) {
        try {
          const judged = await judge({ capturedPath, referenceDocs });
          const v = judged?.verdict;
          if (!v || v.judge_status !== "completed" || !v.scores) {
            skips.push({ capture: cap, reason: `judge_incomplete(j=${j}): ${v?.judge_status || "no_verdict"}` });
            log(`[${projLabel}] capture ${cap + 1} judging ${j + 1}/${judgingsPerCapture} incomplete: ${v?.judge_status || "no_verdict"}`);
            continue;
          }
          verdicts.push(v);
        } catch (e) {
          skips.push({ capture: cap, reason: `judge_threw(j=${j}): ${e.message}` });
          log(`[${projLabel}] capture ${cap + 1} judging ${j + 1} threw: ${e.message}`);
        }
      }
      if (verdicts.length === 0) {
        skips.push({ capture: cap, reason: "no_completed_judgings" });
        log(`[${projLabel}] capture ${cap + 1} SKIPPED: no completed judgings`);
        continue;
      }

      const score = capturePerCaptureScore(verdicts);
      captureScores.push(score);
      projInvariants.push(computeGroundingInvariants(captured));
      capturePaths.push(capturedPath);
      landed += 1;
      log(`[${projLabel}] capture ${cap + 1} landed: overall=${score.overall} (judged ${verdicts.length}×)`);
    }

    // A project with zero landed captures is recorded honestly (no stats) — it does
    // NOT crash the run, but it cannot contribute to the aggregate.
    if (captureScores.length === 0) {
      perProject[projLabel] = {
        capturesRequested: capturesPerProject,
        capturesLanded: 0,
        skips,
        perDim: null,
        overall: null,
        invariants: perProjectInvariantRates([]),
      };
      log(`[${projLabel}] WARNING: 0/${capturesPerProject} captures landed`);
      continue;
    }

    const stats = perProjectStats(captureScores);
    perProject[projLabel] = {
      capturesRequested: capturesPerProject,
      capturesLanded: landed,
      skips,
      perDim: stats.perDim,
      overall: stats.overall,
      invariants: perProjectInvariantRates(projInvariants),
    };
    perProjectCaptureScores[projLabel] = captureScores;
    allInvariants.push(...projInvariants);
  }

  const landedProjectCount = Object.keys(perProjectCaptureScores).length;
  if (landedProjectCount === 0) {
    throw new Error("measureVersion: no project landed any capture — cannot aggregate (fail-closed)");
  }

  const aggregate = aggregateAcrossProjects(perProjectCaptureScores, { B: bootstrapB, seed });
  const groundingInvariantRates = aggregateInvariantRates(allInvariants);

  return {
    label,
    capturesPerProject,
    judgingsPerCapture,
    days,
    maxTurns,
    seed,
    bootstrapB,
    projectCount: projects.length,
    landedProjectCount,
    perProject,
    aggregate,
    groundingInvariantRates,
    capturePaths,
    // honest caveat surfaced in every saved measurement
    note: aggregateNote(landedProjectCount),
  };
}

function aggregateNote(landedProjectCount) {
  return `Aggregate CI is a HIERARCHICAL bootstrap over ${landedProjectCount} project(s); `
    + `with this few projects the CI is honestly WIDE. GPT recommends ≥6 balanced rich/thin `
    + `projects to tighten it. The immediate variance reduction is per-project K-capture `
    + `averaging (generation variance dominates judge variance). Do NOT read ${landedProjectCount} `
    + `project(s) as sufficient.`;
}

// ── compareMeasurements ──────────────────────────────────────────────────────
/**
 * Paired per-project differences (candidate − baseline), matched by project label,
 * per dimension + overall. Bootstrap CI (seeded, resample PROJECTS with replacement)
 * of the MEAN paired difference; `significant` = the 95% CI excludes 0.
 *
 * Operates on two saved measurement JSONs (or in-memory measurement objects).
 */
export function compareMeasurements(baseline, candidate, { B = BOOTSTRAP_DEFAULT, seed = 12345 } = {}) {
  if (!baseline || !candidate) throw new Error("compareMeasurements requires baseline and candidate");
  const basePP = baseline.perProject || {};
  const candPP = candidate.perProject || {};
  // Pair only the labels present (and landed) in BOTH measurements.
  const pairedLabels = Object.keys(basePP).filter((label) => {
    const b = basePP[label];
    const c = candPP[label];
    return b && c && b.overall && c.overall && Number.isFinite(b.overall.mean) && Number.isFinite(c.overall.mean);
  });
  if (pairedLabels.length === 0) {
    throw new Error("compareMeasurements: no project pairs with landed stats in both measurements (fail-closed)");
  }

  const perDim = {};
  for (const key of MEASURE_KEYS) {
    // per-project paired diff for this dimension
    const diffs = pairedLabels.map((label) => {
      const b = key === "overall" ? basePP[label].overall.mean : basePP[label].perDim[key].mean;
      const c = key === "overall" ? candPP[label].overall.mean : candPP[label].perDim[key].mean;
      return round2(c - b);
    });
    const meanDiff = round2(mean(diffs));
    // bootstrap CI of the mean paired diff: resample PROJECTS (the paired diffs) with
    // replacement, seeded per-dim for reproducibility.
    const rng = makeLcg(seed + hashKey(`cmp:${key}`));
    const dist = new Array(B);
    for (let b = 0; b < B; b++) {
      let s = 0;
      for (let i = 0; i < diffs.length; i++) s += diffs[rng.nextIndex(diffs.length)];
      dist[b] = s / diffs.length;
    }
    const ci = ci95(dist);
    const significant = (ci[0] > 0 && ci[1] > 0) || (ci[0] < 0 && ci[1] < 0);
    perDim[key] = { meanDiff, perProjectDiffs: diffs, ci95: ci, significant };
  }

  return {
    baselineLabel: baseline.label || "baseline",
    candidateLabel: candidate.label || "candidate",
    pairedProjects: pairedLabels,
    seed,
    bootstrapB: B,
    perDim: Object.fromEntries(SCORE_KEYS.map((k) => [k, perDim[k]])),
    overall: perDim.overall,
    note: `Paired diffs over ${pairedLabels.length} matched project(s); significance = 95% bootstrap `
      + `CI of the mean paired diff excludes 0. With ${pairedLabels.length} project(s) the CI is wide.`,
  };
}

// ── default projects (run-cycle shape) ───────────────────────────────────────
// dongdong = real thin-context project (PDF only); agentic30 = the product itself
// with rich synthesized context. Markers tell measureVersion which projects receive
// the goal/context overrides. Parameterized so more projects can be added later.
export function defaultProjects() {
  return [
    { label: "dongdong", projectPath: path.resolve(packageRoot, "..", "dongdong"), personaId: "mindfulness-app" },
    {
      label: "agentic30",
      projectPath: packageRoot,
      personaId: "icp-solo-dev",
      goalOverride: true,
      projectContextOverride: true,
    },
  ];
}

// ── CLI ──────────────────────────────────────────────────────────────────────
async function loadJsonMaybe(p) {
  if (!p) return null;
  return JSON.parse(await fs.readFile(p, "utf8"));
}

function fmtCi(ci) {
  return Array.isArray(ci) ? `[${ci[0]}, ${ci[1]}]` : "[?, ?]";
}

function printMeasurement(result) {
  console.log(`\n=== MEASURE: ${result.label} (K=${result.capturesPerProject} captures × J=${result.judgingsPerCapture} judgings, seed=${result.seed}) ===`);
  for (const [label, pp] of Object.entries(result.perProject)) {
    console.log(`\n[${label}] landed ${pp.capturesLanded}/${pp.capturesRequested} captures`);
    if (pp.overall) {
      console.log(`  overall: mean=${pp.overall.mean} sd=${pp.overall.sd}`);
      console.log(`  per-dim: ${SCORE_KEYS.map((k) => `${k}=${pp.perDim[k].mean}±${pp.perDim[k].sd}`).join(" ")}`);
    } else {
      console.log("  (no landed captures — excluded from aggregate)");
    }
    console.log(`  invariant rates: ${[...GROUNDING_BOOLEAN_KEYS, ...GROUNDING_RATE_KEYS].map((k) => `${k}=${pp.invariants[k]}`).join(" ")}`);
    if (pp.skips?.length) console.log(`  skips: ${pp.skips.map((s) => `cap${s.capture}:${s.reason}`).join(" | ")}`);
  }
  console.log(`\n[AGGREGATE over ${result.landedProjectCount} project(s)]`);
  console.log(`  overall: mean=${result.aggregate.overall.mean} ci95=${fmtCi(result.aggregate.overall.ci95)}`);
  for (const k of SCORE_KEYS) {
    console.log(`  ${k}: mean=${result.aggregate.perDim[k].mean} ci95=${fmtCi(result.aggregate.perDim[k].ci95)}`);
  }
  console.log(`  grounding invariant rates: ${[...GROUNDING_BOOLEAN_KEYS, ...GROUNDING_RATE_KEYS].map((k) => `${k}=${result.groundingInvariantRates[k]}`).join(" ")}`);
  console.log(`\nNOTE: ${result.note}`);
}

function printComparison(cmp) {
  console.log(`\n=== COMPARE: ${cmp.candidateLabel} − ${cmp.baselineLabel} (paired over ${cmp.pairedProjects.join(", ")}, seed=${cmp.seed}) ===`);
  const row = (k, d) => `  ${k.padEnd(16)} Δ=${String(d.meanDiff).padStart(6)} ci95=${fmtCi(d.ci95).padEnd(16)} ${d.significant ? "★ SIGNIFICANT" : "(within noise)"}`;
  console.log(row("overall", cmp.overall));
  for (const k of SCORE_KEYS) console.log(row(k, cmp.perDim[k]));
  console.log(`\nNOTE: ${cmp.note}`);
}

async function cliMeasure(argv) {
  const opts = {
    captures: 5,
    judgings: 3,
    days: [1],
    maxTurns: 8,
    seed: 12345,
    bootstrapB: BOOTSTRAP_DEFAULT,
    label: "version",
  };
  let goalFile = null;
  let contextFile = null;
  let out = null;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--captures") opts.captures = Number(argv[++i]);
    else if (a === "--judgings") opts.judgings = Number(argv[++i]);
    else if (a === "--days") opts.days = argv[++i].split(",").map((d) => Number(d.trim())).filter(Boolean);
    else if (a === "--max-turns") opts.maxTurns = Number(argv[++i]);
    else if (a === "--seed") opts.seed = Number(argv[++i]);
    else if (a === "--bootstrap") opts.bootstrapB = Number(argv[++i]);
    else if (a === "--label") opts.label = argv[++i];
    else if (a === "--goal-file") goalFile = argv[++i];
    else if (a === "--context-file") contextFile = argv[++i];
    else if (a === "--out") out = argv[++i];
  }
  if (process.env.AGENTIC30_RUN_LIVE_PROVIDER_EVAL !== "1") {
    throw new Error("measure requires AGENTIC30_RUN_LIVE_PROVIDER_EVAL=1 (live arcs); stub returns canned cards");
  }
  const goalOverride = await loadJsonMaybe(goalFile);
  const projectContextOverride = await loadJsonMaybe(contextFile);
  const referenceDocs = await loadReferenceDocs(packageRoot);

  const result = await measureVersion({
    projects: defaultProjects(),
    capturesPerProject: opts.captures,
    judgingsPerCapture: opts.judgings,
    days: opts.days,
    maxTurns: opts.maxTurns,
    goalOverride,
    projectContextOverride,
    referenceDocs,
    seed: opts.seed,
    bootstrapB: opts.bootstrapB,
    label: opts.label,
    log: (m) => console.log(m),
  });

  printMeasurement(result);
  if (out) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(result, null, 2) + "\n");
    console.log(`\nmeasurement → ${out}`);
  }
}

async function cliCompare(argv) {
  let baselinePath = null;
  let candidatePath = null;
  let out = null;
  let seed = 12345;
  let B = BOOTSTRAP_DEFAULT;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === "--baseline") baselinePath = argv[++i];
    else if (a === "--candidate") candidatePath = argv[++i];
    else if (a === "--out") out = argv[++i];
    else if (a === "--seed") seed = Number(argv[++i]);
    else if (a === "--bootstrap") B = Number(argv[++i]);
  }
  if (!baselinePath || !candidatePath) {
    throw new Error("compare requires --baseline <a.json> --candidate <b.json>");
  }
  const baseline = await loadJsonMaybe(baselinePath);
  const candidate = await loadJsonMaybe(candidatePath);
  const cmp = compareMeasurements(baseline, candidate, { B, seed });
  printComparison(cmp);
  if (out) {
    await fs.mkdir(path.dirname(out), { recursive: true });
    await fs.writeFile(out, JSON.stringify(cmp, null, 2) + "\n");
    console.log(`\ncomparison → ${out}`);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  const [cmd, ...argv] = process.argv.slice(2);
  const run = cmd === "measure" ? cliMeasure(argv)
    : cmd === "compare" ? cliCompare(argv)
    : Promise.reject(new Error("usage: paired-eval.mjs <measure|compare> [...flags]"));
  run.then(() => process.exit(0)).catch((e) => { console.error(e.message || e); process.exit(1); });
}

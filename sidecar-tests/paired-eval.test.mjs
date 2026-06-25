/**
 * Unit tests for the paired-eval measurement harness (sidecar-evals/paired-eval.mjs).
 *
 * LIVE-FREE + deterministic: every test injects synthetic verdicts/captures (a fake
 * judge + a fake runArc), never calling the live model. They pin the statistics that
 * are review-critical: median (odd/even), per-project mean/sd, the SEEDED hierarchical
 * bootstrap (same seed → identical CI; different seed → CI varies), compareMeasurements
 * paired-diff + significance (clear-positive AND within-noise), and skip-on-failed-
 * capture accounting.
 */
import test from "node:test";
import assert from "node:assert/strict";
import {
  makeLcg,
  median,
  mean,
  sampleSd,
  capturePerCaptureScore,
  hierarchicalBootstrapCi,
  captureLandReason,
  measureVersion,
  compareMeasurements,
  MEASURE_KEYS,
} from "../sidecar-evals/paired-eval.mjs";
import { SCORE_KEYS } from "../sidecar-evals/dogfood-judge.mjs";

// ── synthetic builders ───────────────────────────────────────────────────────

// A complete verdict the judge would return: all 6 dims + overall + status.
function makeVerdict(scoreMap, overall) {
  const scores = {};
  for (const k of SCORE_KEYS) scores[k] = Object.hasOwn(scoreMap, k) ? scoreMap[k] : 7;
  const computedOverall = overall ?? SCORE_KEYS.reduce((a, k) => a + scores[k], 0) / SCORE_KEYS.length;
  return { judge_status: "completed", scores, overall: Math.round(computedOverall * 100) / 100 };
}

// A "landed" capture object (the shape real-project-arc.mjs writes): one Day-1 card.
function makeLandedCapture(label = "synthetic") {
  return {
    label,
    errors: [],
    days: [{
      day: 1,
      outcome: "terminal@2",
      questions: [
        { signalId: "get_users_first_candidate", header: "후보", question: "오늘 누구?", options: [{ label: "후보 없음" }, { label: "특정 한 명 지정" }], allowFreeText: true },
      ],
    }],
  };
}

// ── median (odd/even) ────────────────────────────────────────────────────────

test("median of odd-length list = middle value", () => {
  assert.equal(median([3, 1, 2]), 2);
  assert.equal(median([9, 1, 5, 7, 3]), 5);
  assert.equal(median([42]), 42);
});

test("median of even-length list = mean of the two middle values", () => {
  assert.equal(median([1, 2, 3, 4]), 2.5);
  assert.equal(median([10, 2, 8, 4]), 6); // sorted 2,4,8,10 → (4+8)/2
  assert.equal(median([6, 6]), 6);
  assert.equal(median([7, 8]), 7.5);
});

test("median ignores non-finite values and throws when empty", () => {
  assert.equal(median([NaN, 2, 4, Infinity]), 3); // finite set {2,4}
  assert.throws(() => median([]), /at least one finite/);
  assert.throws(() => median([NaN, Infinity]), /at least one finite/);
});

// ── mean / sampleSd ──────────────────────────────────────────────────────────

test("mean and sampleSd compute the expected per-project statistics", () => {
  assert.equal(mean([2, 4, 6]), 4);
  // sample sd (n-1) of [2,4,6]: variance = (4+0+4)/2 = 4 → sd = 2
  assert.equal(sampleSd([2, 4, 6]), 2);
  // single value → no observed spread → sd 0 (honest for a 1-capture project)
  assert.equal(sampleSd([5]), 0);
  assert.throws(() => mean([]), /at least one finite/);
  assert.throws(() => sampleSd([]), /at least one finite/);
});

// ── capturePerCaptureScore: median across judgings ───────────────────────────

test("capturePerCaptureScore takes the MEDIAN per dim + overall across judgings", () => {
  // Three judgings that flicker on goal_alignment {6,7,8} and evidence_use {4,5,9};
  // the median is the robust per-capture score (cheap insurance for flickering dims).
  const verdicts = [
    makeVerdict({ icp_fit: 7, values_delivery: 8, goal_alignment: 6, actionability: 7, evidence_use: 4, ux_friction: 9 }, 7.0),
    makeVerdict({ icp_fit: 7, values_delivery: 8, goal_alignment: 7, actionability: 7, evidence_use: 5, ux_friction: 9 }, 7.2),
    makeVerdict({ icp_fit: 7, values_delivery: 8, goal_alignment: 8, actionability: 7, evidence_use: 9, ux_friction: 9 }, 7.9),
  ];
  const score = capturePerCaptureScore(verdicts);
  assert.equal(score.goal_alignment, 7); // median of 6,7,8
  assert.equal(score.evidence_use, 5);   // median of 4,5,9
  assert.equal(score.icp_fit, 7);
  assert.equal(score.overall, 7.2);      // median of 7.0,7.2,7.9
});

test("capturePerCaptureScore with even judgings averages the two middle scores", () => {
  const verdicts = [
    makeVerdict({ goal_alignment: 6 }, 6),
    makeVerdict({ goal_alignment: 8 }, 8),
  ];
  const score = capturePerCaptureScore(verdicts);
  assert.equal(score.goal_alignment, 7); // (6+8)/2
});

test("capturePerCaptureScore throws on empty / malformed verdicts (fail-closed)", () => {
  assert.throws(() => capturePerCaptureScore([]), /at least one verdict/);
  assert.throws(() => capturePerCaptureScore([{ judge_status: "completed", scores: {} }]), /missing finite score/);
});

// ── seeded LCG + hierarchical bootstrap determinism ──────────────────────────

test("makeLcg is deterministic per seed and diverges across seeds", () => {
  const a = makeLcg(12345);
  const b = makeLcg(12345);
  const c = makeLcg(999);
  const seqA = Array.from({ length: 6 }, () => a.nextInt31());
  const seqB = Array.from({ length: 6 }, () => b.nextInt31());
  const seqC = Array.from({ length: 6 }, () => c.nextInt31());
  assert.deepEqual(seqA, seqB, "same seed must give an identical stream");
  assert.notDeepEqual(seqA, seqC, "different seed must give a different stream");
  // nextIndex stays in range
  const r = makeLcg(7);
  for (let i = 0; i < 100; i++) {
    const idx = r.nextIndex(3);
    assert.ok(idx >= 0 && idx < 3, `index ${idx} out of [0,3)`);
  }
  assert.throws(() => makeLcg(1).nextIndex(0), /n>0/);
});

test("hierarchicalBootstrapCi: same seed → identical CI, different seed → CI varies", () => {
  // Two projects with WIDE within-project spread so the two-level resample injects
  // enough variance that the 2.5/97.5 percentiles genuinely move between seeds even
  // at B=2000. (Tightly-clustered data would converge the percentiles regardless of
  // seed — that is correct bootstrap behavior, just not a useful divergence probe.)
  const projectCaptureScores = [
    [3, 6, 9, 4, 8], // project A captures (one dimension) — mean 6.0, wide spread
    [5, 10, 6, 9, 7], // project B captures — mean 7.4, wide spread
  ];
  const ci1 = hierarchicalBootstrapCi(projectCaptureScores, { B: 2000, rng: makeLcg(12345) });
  const ci2 = hierarchicalBootstrapCi(projectCaptureScores, { B: 2000, rng: makeLcg(12345) });
  const ci3 = hierarchicalBootstrapCi(projectCaptureScores, { B: 2000, rng: makeLcg(54321) });
  assert.deepEqual(ci1, ci2, "same seed must reproduce the CI exactly");
  assert.notDeepEqual(ci1, ci3, "different seed must shift the CI");
  // The CI is an interval lo <= hi, and brackets the grand mean (≈ (6.0 + 7.4)/2 = 6.7).
  assert.ok(ci1[0] <= ci1[1]);
  assert.ok(ci1[0] <= 6.7 && ci1[1] >= 6.7, `CI ${JSON.stringify(ci1)} should bracket the grand mean ~6.7`);
});

test("hierarchicalBootstrapCi with 2 widely-separated projects yields an honestly WIDE CI", () => {
  // Project means 2 and 9: resampling projects with replacement can land {2,2} or
  // {9,9}, so the CI must span roughly that full range — NOT a fake-tight interval.
  const projectCaptureScores = [
    [2, 2, 2, 2, 2],
    [9, 9, 9, 9, 9],
  ];
  const ci = hierarchicalBootstrapCi(projectCaptureScores, { B: 2000, rng: makeLcg(12345) });
  assert.ok(ci[0] <= 2.5, `lo ${ci[0]} should reach down toward the 2-project`);
  assert.ok(ci[1] >= 8.5, `hi ${ci[1]} should reach up toward the 9-project`);
  assert.ok(ci[1] - ci[0] >= 5, `CI width ${ci[1] - ci[0]} must be wide with n=2 separated projects`);
});

test("hierarchicalBootstrapCi fail-closed without rng or projects", () => {
  assert.throws(() => hierarchicalBootstrapCi([[1, 2]], { B: 10 }), /requires a seeded rng/);
  assert.throws(() => hierarchicalBootstrapCi([], { B: 10, rng: makeLcg(1) }), /at least one non-empty/);
});

// ── captureLandReason ────────────────────────────────────────────────────────

test("captureLandReason: landed capture → null, failures → reason string", () => {
  assert.equal(captureLandReason(makeLandedCapture()), null);
  assert.match(captureLandReason({ errors: ["fatal: no ready event"], days: [] }), /^fatal:/);
  assert.match(captureLandReason({ errors: [], days: [] }), /no_day/);
  assert.match(captureLandReason({ errors: [], days: [{ day: 1, outcome: "turn0: timeout", questions: [] }] }), /no_cards/);
  assert.match(
    captureLandReason({ errors: [], days: [{ day: 1, outcome: "turn0: timeout", questions: [{ header: "x" }] }] }),
    /timeout/,
  );
  assert.equal(captureLandReason(null), "no_capture");
});

// ── measureVersion: injected fake arc + judge (LIVE-FREE) ─────────────────────

// Build a fake runArc that returns a scripted sequence of captures per project, and
// a fake judge that returns scripted verdicts keyed by the capture's overall marker.
function makeFakeHarness({ projectCaptures, verdictFor }) {
  // projectCaptures: { <label>: [captureOrError, ...] } where captureOrError is a
  // capture object, the string "THROW", or a non-landing capture.
  const cursor = {};
  let writeCounter = 0;
  const runArc = async (projectPath, opts) => {
    const label = opts.label;
    cursor[label] = (cursor[label] || 0);
    const item = projectCaptures[label][cursor[label]];
    cursor[label] += 1;
    if (item === "THROW") throw new Error(`scripted arc failure for ${label}`);
    // tag the capture with a unique runDir so the fake judge can route verdicts.
    const runDir = `/tmp/fake-arc-${label}-${writeCounter++}`;
    // stash the capture itself on a side map keyed by runDir so the judge can read it
    capturesByRunDir.set(`${runDir}/captured.json`, item);
    return { runDir, captured: item };
  };
  const capturesByRunDir = new Map();
  const judge = async ({ capturedPath }) => {
    const captured = capturesByRunDir.get(capturedPath);
    return { verdict: verdictFor(captured) };
  };
  return { runArc, judge };
}

test("measureVersion: per-project mean/sd + aggregate CI from injected captures (no live)", async () => {
  // agentic30: two landed captures scoring overall 7 and 8 (sd of [7,8] over n-1 = ~0.71).
  // dongdong: two landed captures scoring overall 6 and 6 (sd 0).
  const capA = makeLandedCapture("agentic30");
  const capB = makeLandedCapture("agentic30");
  const capC = makeLandedCapture("dongdong");
  const capD = makeLandedCapture("dongdong");
  // mark captures so the judge can score them deterministically
  capA._mark = 7; capB._mark = 8; capC._mark = 6; capD._mark = 6;

  const { runArc, judge } = makeFakeHarness({
    projectCaptures: { agentic30: [capA, capB], dongdong: [capC, capD] },
    verdictFor: (captured) => makeVerdict({}, captured._mark), // all dims default 7; overall forced
  });

  const result = await measureVersion({
    projects: [
      { label: "agentic30", projectPath: "/x/agentic30" },
      { label: "dongdong", projectPath: "/x/dongdong" },
    ],
    capturesPerProject: 2,
    judgingsPerCapture: 3,
    seed: 12345,
    runArc,
    judge,
    label: "test-version",
  });

  assert.equal(result.landedProjectCount, 2);
  assert.equal(result.perProject.agentic30.capturesLanded, 2);
  assert.equal(result.perProject.dongdong.capturesLanded, 2);
  // per-project overall mean
  assert.equal(result.perProject.agentic30.overall.mean, 7.5); // (7+8)/2
  assert.equal(result.perProject.dongdong.overall.mean, 6);
  // dongdong sd 0 (both 6); agentic30 sd = sample sd of [7,8] = 0.71
  assert.equal(result.perProject.dongdong.overall.sd, 0);
  assert.ok(Math.abs(result.perProject.agentic30.overall.sd - 0.71) < 0.01);
  // aggregate grand mean of project means = (7.5 + 6)/2 = 6.75
  assert.equal(result.aggregate.overall.mean, 6.75);
  // aggregate CI is an interval bracketing 6.75
  const ci = result.aggregate.overall.ci95;
  assert.ok(ci[0] <= 6.75 && ci[1] >= 6.75, `CI ${JSON.stringify(ci)} should bracket 6.75`);
  // every dimension is present in the aggregate
  for (const k of SCORE_KEYS) assert.ok(result.aggregate.perDim[k], `missing aggregate dim ${k}`);
  // grounding invariant rates present (first_candidate card was in every capture)
  assert.equal(result.groundingInvariantRates.first_candidate_present, 1);
});

test("measureVersion: determinism — same seed → identical aggregate CI, different seed differs", async () => {
  // 5 captures/project with WIDE within-project spread so the two-level resample has
  // enough signal that the seed genuinely shifts the percentiles at the production
  // B=2000 (tight data converges the percentiles — correct bootstrap behavior).
  const marks = { p1: [3, 6, 9, 4, 8], p2: [5, 10, 6, 9, 7] };
  const mk = () => {
    const projectCaptures = {};
    for (const [label, ms] of Object.entries(marks)) {
      projectCaptures[label] = ms.map((m) => { const c = makeLandedCapture(label); c._mark = m; return c; });
    }
    return makeFakeHarness({ projectCaptures, verdictFor: (captured) => makeVerdict({}, captured._mark) });
  };
  const projects = [
    { label: "p1", projectPath: "/x/p1" },
    { label: "p2", projectPath: "/x/p2" },
  ];
  const run = async (seed) => {
    const h = mk();
    return measureVersion({ projects, capturesPerProject: 5, judgingsPerCapture: 1, seed, runArc: h.runArc, judge: h.judge });
  };
  const r1 = await run(12345);
  const r2 = await run(12345);
  const r3 = await run(777);

  assert.deepEqual(r1.aggregate.overall.ci95, r2.aggregate.overall.ci95, "same seed must reproduce CI");
  assert.notDeepEqual(r1.aggregate.overall.ci95, r3.aggregate.overall.ci95, "different seed must shift CI");
  // per-project means are unchanged by seed (only the CI resampling consumes it)
  assert.equal(r1.perProject.p1.overall.mean, r3.perProject.p1.overall.mean);
});

test("measureVersion: skip-on-failed-capture accounting (throw + non-landing)", async () => {
  // 4 requested captures: [landed, THROW, non-landing(no cards), landed].
  const good1 = makeLandedCapture("solo"); good1._mark = 7;
  const noCards = { label: "solo", errors: [], days: [{ day: 1, outcome: "turn0: timeout", questions: [] }] };
  const good2 = makeLandedCapture("solo"); good2._mark = 9;

  const { runArc, judge } = makeFakeHarness({
    projectCaptures: { solo: [good1, "THROW", noCards, good2] },
    verdictFor: (captured) => makeVerdict({}, captured._mark),
  });

  const result = await measureVersion({
    projects: [{ label: "solo", projectPath: "/x/solo" }],
    capturesPerProject: 4,
    judgingsPerCapture: 2,
    seed: 12345,
    runArc,
    judge,
  });

  const pp = result.perProject.solo;
  assert.equal(pp.capturesRequested, 4);
  assert.equal(pp.capturesLanded, 2, "only the 2 landing captures count");
  assert.equal(pp.skips.length, 2, "the throw and the no-cards capture are skipped with reasons");
  assert.match(pp.skips.find((s) => /arc_threw/.test(s.reason)).reason, /scripted arc failure/);
  assert.ok(pp.skips.some((s) => /no_cards/.test(s.reason)));
  // landed overall mean = (7+9)/2 = 8
  assert.equal(pp.overall.mean, 8);
});

test("measureVersion: judge incompleteness is skipped, not crashed", async () => {
  const cap = makeLandedCapture("solo"); cap._mark = 7;
  const { runArc } = makeFakeHarness({ projectCaptures: { solo: [cap] }, verdictFor: () => null });
  // judge returns an error verdict for the only capture → that capture drops, project
  // lands 0, and the whole run fails-closed (no project landed).
  const judge = async () => ({ verdict: { judge_status: "error", scores: null } });
  await assert.rejects(
    measureVersion({
      projects: [{ label: "solo", projectPath: "/x/solo" }],
      capturesPerProject: 1, judgingsPerCapture: 2, seed: 1, runArc, judge,
    }),
    /no project landed any capture/,
  );
});

test("measureVersion fail-closed on invalid args", async () => {
  await assert.rejects(measureVersion({ projects: [] }), /non-empty projects/);
  await assert.rejects(measureVersion({ projects: [{ label: "x", projectPath: "/x" }], capturesPerProject: 0 }), /positive integer/);
  await assert.rejects(measureVersion({ projects: [{ label: "x", projectPath: "/x" }], judgingsPerCapture: 0 }), /positive integer/);
});

// ── compareMeasurements: paired diff + significance ──────────────────────────

// Build a measurement object directly (the shape measureVersion returns) so the
// comparison can be tested without running arcs.
function makeMeasurement(label, perProjectOveralls) {
  // perProjectOveralls: { <label>: { overallMean, dimMean } }
  const perProject = {};
  for (const [proj, v] of Object.entries(perProjectOveralls)) {
    const perDim = {};
    for (const k of SCORE_KEYS) perDim[k] = { mean: v.dimMean ?? v.overallMean, sd: 0 };
    perProject[proj] = {
      capturesRequested: 5, capturesLanded: 5, skips: [],
      perDim, overall: { mean: v.overallMean, sd: 0 }, invariants: {},
    };
  }
  return { label, perProject };
}

test("compareMeasurements: clear-positive case flags significant (CI excludes 0)", () => {
  // Candidate beats baseline by ~+2 on BOTH projects → a tight positive diff → the
  // bootstrap CI of the mean paired diff excludes 0.
  const baseline = makeMeasurement("v0", { agentic30: { overallMean: 6 }, dongdong: { overallMean: 5.5 } });
  const candidate = makeMeasurement("v1", { agentic30: { overallMean: 8 }, dongdong: { overallMean: 7.6 } });
  const cmp = compareMeasurements(baseline, candidate, { seed: 12345 });
  assert.deepEqual(cmp.pairedProjects.sort(), ["agentic30", "dongdong"]);
  assert.ok(cmp.overall.meanDiff > 1.5, `meanDiff ${cmp.overall.meanDiff} should be clearly positive`);
  assert.equal(cmp.overall.significant, true, "consistent +2 on both projects must be significant");
  assert.ok(cmp.overall.ci95[0] > 0, `lo ${cmp.overall.ci95[0]} should exclude 0`);
});

test("compareMeasurements: within-noise case is NOT flagged significant (CI straddles 0)", () => {
  // One project up +2, the other down −2 → mean diff ~0 and the paired diffs straddle
  // zero → resampling the 2 diffs spans both signs → CI includes 0 → not significant.
  const baseline = makeMeasurement("v0", { agentic30: { overallMean: 6 }, dongdong: { overallMean: 7 } });
  const candidate = makeMeasurement("v1", { agentic30: { overallMean: 8 }, dongdong: { overallMean: 5 } });
  const cmp = compareMeasurements(baseline, candidate, { seed: 12345 });
  assert.ok(Math.abs(cmp.overall.meanDiff) < 0.6, `meanDiff ${cmp.overall.meanDiff} should be near 0`);
  assert.equal(cmp.overall.significant, false, "opposite-direction diffs must NOT be significant");
  assert.ok(cmp.overall.ci95[0] < 0 && cmp.overall.ci95[1] > 0, `CI ${JSON.stringify(cmp.overall.ci95)} should straddle 0`);
});

test("compareMeasurements: deterministic per seed; per-project diffs are exposed", () => {
  // 5 paired projects with VARIED diffs so the project-resample percentiles genuinely
  // depend on the seed at the production B=2000.
  const overalls = {
    base: { a: 6, b: 5.5, c: 6.2, d: 5.0, e: 7.0 },
    cand: { a: 8.5, b: 6.0, c: 9.5, d: 5.2, e: 9.0 }, // diffs 2.5,0.5,3.3,0.2,2.0
  };
  const baseline = makeMeasurement("v0", Object.fromEntries(Object.entries(overalls.base).map(([k, v]) => [k, { overallMean: v }])));
  const candidate = makeMeasurement("v1", Object.fromEntries(Object.entries(overalls.cand).map(([k, v]) => [k, { overallMean: v }])));
  const c1 = compareMeasurements(baseline, candidate, { seed: 12345 });
  const c2 = compareMeasurements(baseline, candidate, { seed: 12345 });
  assert.deepEqual(c1.overall.ci95, c2.overall.ci95, "same seed must reproduce the CI exactly");
  // Smaller B exposes seed-driven resampling (large B converges percentiles — correct).
  const lo1 = compareMeasurements(baseline, candidate, { seed: 12345, B: 64 });
  const lo2 = compareMeasurements(baseline, candidate, { seed: 99, B: 64 });
  assert.notDeepEqual(lo1.overall.ci95, lo2.overall.ci95, "different seed must shift the resampled CI");
  // per-project diffs are deterministic and exposed for inspection
  assert.deepEqual(c1.overall.perProjectDiffs, [2.5, 0.5, 3.3, 0.2, 2]);
  // all dims emitted
  for (const k of SCORE_KEYS) assert.ok(c1.perDim[k]);
});

test("compareMeasurements: only matched landed projects are paired; fail-closed on none", () => {
  // candidate is missing dongdong → only agentic30 pairs.
  const baseline = makeMeasurement("v0", { agentic30: { overallMean: 6 }, dongdong: { overallMean: 5 } });
  const candidate = makeMeasurement("v1", { agentic30: { overallMean: 8 } });
  const cmp = compareMeasurements(baseline, candidate, { seed: 1 });
  assert.deepEqual(cmp.pairedProjects, ["agentic30"]);
  // no overlap at all → throw
  const disjoint = makeMeasurement("v2", { other: { overallMean: 7 } });
  assert.throws(() => compareMeasurements(baseline, disjoint, { seed: 1 }), /no project pairs/);
});

// ── exported key contract ────────────────────────────────────────────────────

test("MEASURE_KEYS = the 6 rubric dims plus overall", () => {
  assert.deepEqual(MEASURE_KEYS, [...SCORE_KEYS, "overall"]);
});

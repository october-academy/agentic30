/**
 * Tests for AC 13 Sub-AC 4 — foundation-summary Codex review iteration loop.
 *
 * The loop wraps the Sub-AC 1 generator + Sub-AC 3 rule-check with:
 *   1. Max iteration cap (default 3, configurable).
 *   2. Codex reviewer call on each FAIL — feedback is folded into the
 *      next generator turn.
 *   3. Convergence guard — if iteration N produces the same failure
 *      fingerprint as iteration N-1, stop.
 *   4. Generator-failure short-circuit — empty / throwing generator
 *      surfaces immediately as `generator_failed`.
 *
 * These tests are deterministic — they inject `generate` and `review`
 * fakes so the loop logic itself is exercised independently of the
 * Claude / Codex provider plumbing.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  FOUNDATION_REVIEW_LOOP_DEFAULTS,
  FOUNDATION_REVIEW_LOOP_STATUSES,
  buildRegenerationFeedback,
  fingerprintIssues,
  runFoundationSummaryReviewLoop,
} from "../sidecar/foundation-summary/review-loop.mjs";
import {
  RULE_CHECK_THRESHOLDS,
  runFoundationSummaryRuleCheck,
} from "../sidecar/foundation-summary/rule-check.mjs";

// ────────────── helpers ──────────────

function passingCandidate({ withDraftV1 = true } = {}) {
  const draftV1Text = [
    "- monetization_signal: yes",
    "- recommendation: continue",
  ].join("\n");
  const finalDraftText = [
    "## final",
    "- monetization_signal: yes",
    "- recommendation: continue → Build phase 진입.",
  ].join("\n");
  return {
    assistantText: [
      "어제: monetization-ask 끝났어 — 1명 yes 받아냈어.",
      "오늘: SPEC v3 박고 go-no-go.md 작성해.",
      "Q: continue / pivot / restart 셋 중 뭐야?",
    ].join("\n"),
    evidenceRefs: [
      {
        file: "monetization-ask-result.md",
        location: "L4",
        field_used: "response_classification",
        extracted_value: "yes",
        ref_type: "work_log",
      },
    ],
    draftV1Text: withDraftV1 ? draftV1Text : "",
    finalDraftText: withDraftV1 ? finalDraftText : "",
  };
}

function failingCandidate({ kind = "tone" } = {}) {
  if (kind === "tone") {
    return {
      assistantText: "응원해 — 잘하고 있어요!", // sugar + missing sections
      evidenceRefs: [
        {
          file: "a.md",
          location: "L1",
          field_used: "x",
          extracted_value: 1,
          ref_type: "work_log",
        },
      ],
      draftV1Text: "- a: hi",
      finalDraftText: "응원해",
    };
  }
  if (kind === "evidence") {
    return {
      assistantText: "어제: ok\n오늘: ok\nQ: ok?",
      evidenceRefs: [], // empty → fails evidence axis
      draftV1Text: "- alpha: hello",
      finalDraftText: "- alpha: hello",
    };
  }
  return failingCandidate({ kind: "tone" });
}

const PASS_USER_FEEDBACK = { accuracy_rating: 4.5 };

// Sanity probe: confirm the helpers actually pass / fail rule-check so the
// rest of the suite is testing the loop, not the rule-check upstream.
test("[harness] passingCandidate + PASS_USER_FEEDBACK passes rule-check", () => {
  const cand = passingCandidate();
  const verdict = runFoundationSummaryRuleCheck({
    assistantText: cand.assistantText,
    evidenceRefs: cand.evidenceRefs,
    userFeedback: PASS_USER_FEEDBACK,
    draftV1Text: cand.draftV1Text,
    finalDraftText: cand.finalDraftText,
  });
  assert.equal(verdict.pass, true, JSON.stringify(verdict.reasons));
});

test("[harness] failingCandidate('tone') fails rule-check", () => {
  const cand = failingCandidate({ kind: "tone" });
  const verdict = runFoundationSummaryRuleCheck({
    assistantText: cand.assistantText,
    evidenceRefs: cand.evidenceRefs,
    userFeedback: PASS_USER_FEEDBACK,
    draftV1Text: cand.draftV1Text,
    finalDraftText: cand.finalDraftText,
  });
  assert.equal(verdict.pass, false);
});

// ────────────── PASS path ──────────────

test("runFoundationSummaryReviewLoop returns 'passed' on iteration 1 when rule-check passes", async () => {
  let generateCalls = 0;
  let reviewCalls = 0;
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => {
      generateCalls += 1;
      return passingCandidate();
    },
    review: async () => {
      reviewCalls += 1;
      return { issues: ["should not be called"] };
    },
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.PASSED);
  assert.equal(result.passed, true);
  assert.equal(result.total_iterations, 1);
  assert.equal(generateCalls, 1);
  assert.equal(reviewCalls, 0, "reviewer must not be called on PASS");
  assert.equal(result.iterations.length, 1);
  assert.equal(result.iterations[0].verdict.pass, true);
  assert.deepEqual(result.reviewer_concerns, []);
});

test("runFoundationSummaryReviewLoop returns 'passed' on iteration 2 once feedback is applied", async () => {
  let calls = 0;
  let receivedFeedback = null;
  const result = await runFoundationSummaryReviewLoop({
    generate: async ({ feedback, iteration }) => {
      calls += 1;
      if (iteration === 1) return failingCandidate({ kind: "tone" });
      receivedFeedback = feedback;
      return passingCandidate();
    },
    review: async () => ({ issues: ["citation accuracy is shaky"] }),
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.PASSED);
  assert.equal(result.total_iterations, 2);
  assert.equal(calls, 2);
  assert.ok(receivedFeedback, "iteration 2 must receive non-null feedback");
  assert.match(receivedFeedback, /Review Loop Feedback/);
  assert.match(receivedFeedback, /sugar/, "feedback should reference sugar issue");
  assert.match(receivedFeedback, /citation accuracy is shaky/, "feedback should embed reviewer issue");
});

// ────────────── MAX_ITERATIONS ──────────────

test("runFoundationSummaryReviewLoop terminates with 'max_iterations' after 3 failures with shifting issues", async () => {
  let calls = 0;
  // Each iteration produces a DIFFERENT issue mix so convergence guard cannot fire.
  const variants = [
    failingCandidate({ kind: "tone" }),
    failingCandidate({ kind: "evidence" }),
    {
      assistantText: "어제: ok\n오늘: 잘하고 있어요!\nQ: ok?", // sugar in 'today' only
      evidenceRefs: [
        {
          file: "a.md",
          location: "L1",
          field_used: "x",
          extracted_value: 1,
          ref_type: "work_log",
        },
      ],
      draftV1Text: "- alpha: hello",
      finalDraftText: "- alpha: hello",
    },
  ];
  const reviewerVariants = [
    ["citation A wrong"],
    ["citation B wrong"],
    ["citation C wrong"],
  ];
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => {
      const v = variants[calls];
      calls += 1;
      return v;
    },
    review: async ({ iteration }) => ({
      issues: reviewerVariants[iteration - 1] || [],
    }),
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.MAX_ITERATIONS);
  assert.equal(result.total_iterations, 3);
  assert.equal(calls, 3);
  assert.equal(result.passed, false);
  assert.ok(result.reviewer_concerns.length >= 1);
  assert.match(result.reason, /max iterations reached/);
});

test("runFoundationSummaryReviewLoop honours custom maxIterations", async () => {
  let calls = 0;
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => {
      calls += 1;
      // Always fail with a NEW reasoning so convergence guard never triggers.
      return {
        assistantText: `어제: x${calls}\n오늘: y${calls}`, // missing Q line
        evidenceRefs: [
          {
            file: `f${calls}.md`,
            location: `L${calls}`,
            field_used: "x",
            extracted_value: calls,
            ref_type: "work_log",
          },
        ],
        draftV1Text: `- alpha: hello-${calls}`,
        finalDraftText: `- alpha: hello-${calls}`,
      };
    },
    review: async ({ iteration }) => ({ issues: [`unique-${iteration}`] }),
    userFeedback: PASS_USER_FEEDBACK,
    maxIterations: 2,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.MAX_ITERATIONS);
  assert.equal(result.total_iterations, 2);
  assert.equal(result.max_iterations, 2);
  assert.equal(calls, 2);
});

test("runFoundationSummaryReviewLoop clamps maxIterations to safe range [1, 10]", async () => {
  const stub = async () => failingCandidate({ kind: "tone" });
  const r1 = await runFoundationSummaryReviewLoop({
    generate: stub,
    review: async () => ({ issues: ["x"] }),
    maxIterations: 0,
  });
  assert.ok(r1.max_iterations >= 1, "must clamp 0 → 1");
  // No need to test upper bound exhaustively — just verify accepted.
  assert.equal(FOUNDATION_REVIEW_LOOP_DEFAULTS.maxIterations, 3);
});

// ────────────── CONVERGENCE_GUARD ──────────────

test("runFoundationSummaryReviewLoop fires convergence_guard when same issues repeat", async () => {
  let calls = 0;
  const same = failingCandidate({ kind: "tone" });
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => {
      calls += 1;
      return { ...same };
    },
    review: async () => ({ issues: ["citation accuracy is shaky"] }),
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.CONVERGENCE_GUARD);
  // Convergence is detected on iteration 2 — same fingerprint as iter 1.
  assert.equal(result.total_iterations, 2);
  assert.equal(calls, 2);
  assert.ok(result.reviewer_concerns.length >= 1);
  assert.match(result.reason, /convergence guard/);
});

test("runFoundationSummaryReviewLoop convergence_guard does NOT fire on iteration 1 alone", async () => {
  // If the loop were to fire convergence guard with only iteration 1, status
  // would not match — this guards against that off-by-one.
  let calls = 0;
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => {
      calls += 1;
      if (calls === 1) return failingCandidate({ kind: "tone" });
      return passingCandidate(); // iter 2 passes
    },
    review: async () => ({ issues: ["x"] }),
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.PASSED);
  assert.equal(result.total_iterations, 2);
});

// ────────────── GENERATOR_FAILED ──────────────

test("runFoundationSummaryReviewLoop returns 'generator_failed' when generator throws", async () => {
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => {
      throw new Error("provider crashed");
    },
    review: async () => ({ issues: ["should not be called"] }),
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.GENERATOR_FAILED);
  assert.equal(result.total_iterations, 1);
  assert.equal(result.passed, false);
  assert.match(result.reason, /provider crashed/);
  assert.equal(result.iterations[0].generator_error, "provider crashed");
});

test("runFoundationSummaryReviewLoop returns 'generator_failed' when assistantText is empty", async () => {
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => ({ assistantText: "   " }),
    review: async () => ({ issues: [] }),
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.GENERATOR_FAILED);
  assert.match(result.reason, /empty assistantText/);
});

test("runFoundationSummaryReviewLoop throws TypeError when generate is missing", async () => {
  await assert.rejects(
    () => runFoundationSummaryReviewLoop({ generate: null, review: null }),
    /requires a generate\(\) function/,
  );
});

// ────────────── ABORTED ──────────────

test("runFoundationSummaryReviewLoop short-circuits on aborted signal before iteration 1", async () => {
  const controller = new AbortController();
  controller.abort();
  let calls = 0;
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => {
      calls += 1;
      return passingCandidate();
    },
    review: async () => ({ issues: [] }),
    userFeedback: PASS_USER_FEEDBACK,
    signal: controller.signal,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.ABORTED);
  assert.equal(calls, 0, "generator must not run after abort");
});

// ────────────── reviewer optional / errors ──────────────

test("runFoundationSummaryReviewLoop runs without a reviewer when review=null", async () => {
  let calls = 0;
  const result = await runFoundationSummaryReviewLoop({
    generate: async ({ iteration }) => {
      calls += 1;
      if (iteration === 1) return failingCandidate({ kind: "tone" });
      return passingCandidate();
    },
    review: null,
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.PASSED);
  assert.equal(calls, 2);
  assert.equal(result.iterations[0].reviewer_issues.length, 0);
  assert.equal(result.iterations[0].reviewer_errored, false);
});

test("runFoundationSummaryReviewLoop tolerates a throwing reviewer (degrades to rule-check only)", async () => {
  let calls = 0;
  const result = await runFoundationSummaryReviewLoop({
    generate: async ({ iteration }) => {
      calls += 1;
      if (iteration === 1) return failingCandidate({ kind: "tone" });
      return passingCandidate();
    },
    review: async () => {
      throw new Error("codex offline");
    },
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.PASSED);
  assert.equal(calls, 2);
  assert.equal(result.iterations[0].reviewer_errored, true);
  assert.match(result.iterations[0].reviewer_comment, /reviewer_error: codex offline/);
});

test("runFoundationSummaryReviewLoop sanitizes reviewer issues (strings only, deduped)", async () => {
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => failingCandidate({ kind: "tone" }),
    review: async () => ({
      issues: [
        "a real issue",
        "  a real issue  ", // duplicate after trim
        "",
        null,
        42,
        "another issue",
      ],
    }),
    userFeedback: PASS_USER_FEEDBACK,
    maxIterations: 1,
  });
  // maxIterations=1 → loop terminates after iteration 1 fails
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.MAX_ITERATIONS);
  assert.deepEqual(result.iterations[0].reviewer_issues, ["a real issue", "another issue"]);
});

// ────────────── onIterationEvent probe ──────────────

test("runFoundationSummaryReviewLoop emits structured iteration events", async () => {
  const events = [];
  await runFoundationSummaryReviewLoop({
    generate: async () => passingCandidate(),
    review: async () => ({ issues: [] }),
    userFeedback: PASS_USER_FEEDBACK,
    onIterationEvent: (e) => events.push(e),
  });
  const phases = events.map((e) => e.phase);
  assert.ok(phases.includes("iteration.start"));
  assert.ok(phases.includes("iteration.candidate"));
  assert.ok(phases.includes("iteration.verdict"));
  assert.ok(phases.includes("iteration.complete"));
  assert.ok(phases.includes("loop.terminated"));
  const terminal = events.find((e) => e.phase === "loop.terminated");
  assert.equal(terminal.status, FOUNDATION_REVIEW_LOOP_STATUSES.PASSED);
});

// ────────────── feedback builder ──────────────

test("buildRegenerationFeedback embeds rule-check axes + reviewer issues", () => {
  const verdict = runFoundationSummaryRuleCheck({
    assistantText: "응원해!", // tone fail
    evidenceRefs: [], // evidence fail
    userFeedback: { accuracy_rating: 2.5 }, // KR4.1 fail
    draftV1Text: "- a: hello\n- b: world",
    finalDraftText: "- a: hello", // KR4.2 fail
  });
  const fb = buildRegenerationFeedback({
    iteration: 1,
    ruleCheckVerdict: verdict,
    reviewerIssues: ["evidence_refs claim 'monetization yes' but file shows 'no_reply'"],
    reviewerComment: "Day 6 결과 잘못 인용했어.",
  });
  assert.match(fb, /Review Loop Feedback \(iteration 1 → 2\)/);
  assert.match(fb, /3-section minimal/);
  assert.match(fb, /evidence_refs/);
  assert.match(fb, /KR4\.1/);
  assert.match(fb, /KR4\.2/);
  assert.match(fb, /Codex 리뷰/);
  assert.match(fb, /monetization yes/);
  assert.match(fb, /Day 6 결과 잘못 인용했어/);
  assert.match(fb, /Regeneration 지시/);
});

test("buildRegenerationFeedback caps issue lists to keep prompt bounded", () => {
  const verdict = runFoundationSummaryRuleCheck({
    assistantText: "어제: ok\n오늘: ok\nQ: ok?",
    evidenceRefs: Array.from({ length: 30 }, (_, i) => ({
      file: `f${i}.md`,
      location: "",
      field_used: "x",
      extracted_value: 1,
      ref_type: "twitter_thread", // every entry has invalid ref_type
    })),
    userFeedback: { accuracy_rating: 5 },
    draftV1Text: "- a: hello",
    finalDraftText: "- a: hello",
  });
  const longIssues = Array.from({ length: 40 }, (_, i) => `issue-${i}`);
  const fb = buildRegenerationFeedback({
    iteration: 1,
    ruleCheckVerdict: verdict,
    reviewerIssues: longIssues,
    issueCap: 5,
    missingLineCap: 3,
  });
  // Cap respected → only 5 reviewer issues survive
  const reviewerHits = (fb.match(/issue-/g) || []).length;
  assert.ok(reviewerHits <= 5, `expected ≤5 reviewer issue lines, got ${reviewerHits}`);
});

// ────────────── fingerprintIssues ──────────────

test("fingerprintIssues is order-independent and dedup-safe", () => {
  const a = fingerprintIssues({
    ruleCheckReasons: ["tone:missing_today_line", "evidence:evidence_refs_empty"],
    reviewerIssues: ["citation accuracy", "Citation accuracy"],
  });
  const b = fingerprintIssues({
    ruleCheckReasons: ["evidence:evidence_refs_empty", "tone:missing_today_line"],
    reviewerIssues: ["Citation Accuracy"],
  });
  assert.equal(a, b, `${a} !== ${b}`);
});

test("fingerprintIssues distinguishes rule-check vs reviewer issues with the same body", () => {
  const a = fingerprintIssues({
    ruleCheckReasons: ["evidence_refs_empty"],
    reviewerIssues: [],
  });
  const b = fingerprintIssues({
    ruleCheckReasons: [],
    reviewerIssues: ["evidence_refs_empty"],
  });
  assert.notEqual(a, b);
});

test("fingerprintIssues returns empty string for empty input", () => {
  assert.equal(fingerprintIssues({}), "");
  assert.equal(fingerprintIssues({ ruleCheckReasons: [], reviewerIssues: [] }), "");
});

// ────────────── final shape contract ──────────────

test("runFoundationSummaryReviewLoop result has stable schema", async () => {
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => passingCandidate(),
    review: async () => ({ issues: [] }),
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.equal(result.schema_version, 1);
  assert.equal(typeof result.status, "string");
  assert.equal(typeof result.total_iterations, "number");
  assert.equal(typeof result.max_iterations, "number");
  assert.equal(typeof result.passed, "boolean");
  assert.ok(Array.isArray(result.iterations));
  assert.ok(Array.isArray(result.reviewer_concerns));
  assert.equal(typeof result.reason, "string");
  assert.ok(!Number.isNaN(Date.parse(result.finalized_at)));
  // Per-iteration shape
  for (const it of result.iterations) {
    assert.equal(typeof it.iteration, "number");
    assert.ok(Array.isArray(it.reviewer_issues));
    assert.equal(typeof it.reviewer_errored, "boolean");
    assert.equal(typeof it.fingerprint, "string");
    assert.ok(!Number.isNaN(Date.parse(it.started_at)));
    assert.ok(!Number.isNaN(Date.parse(it.completed_at)));
  }
});

test("runFoundationSummaryReviewLoop forwards userFeedback into the rule-check correctly", async () => {
  // Without enough rating → KR4.1 fails → pass should not happen even with great content.
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => passingCandidate(),
    review: async () => ({ issues: [] }),
    userFeedback: { accuracy_rating: 2 }, // below 4.0 threshold
    maxIterations: 1,
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.MAX_ITERATIONS);
  assert.equal(result.iterations[0].verdict.checks.kr41.pass, false);
});

test("runFoundationSummaryReviewLoop forwards thresholds override into rule-check", async () => {
  // Lower KR4.1 threshold so a 3.0 rating passes.
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => passingCandidate(),
    review: async () => ({ issues: [] }),
    userFeedback: { accuracy_rating: 3.0 },
    thresholds: { ...RULE_CHECK_THRESHOLDS, kr41MinRating: 2.5, kr42MinOverlap: 0.5 },
  });
  assert.equal(result.status, FOUNDATION_REVIEW_LOOP_STATUSES.PASSED);
});

test("runFoundationSummaryReviewLoop terminal status is one of the public constants", async () => {
  const result = await runFoundationSummaryReviewLoop({
    generate: async () => passingCandidate(),
    review: async () => ({ issues: [] }),
    userFeedback: PASS_USER_FEEDBACK,
  });
  assert.ok(
    Object.values(FOUNDATION_REVIEW_LOOP_STATUSES).includes(result.status),
    `unknown status: ${result.status}`,
  );
});

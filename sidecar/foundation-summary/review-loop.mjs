/**
 * Foundation-summary sub-workflow — Codex review iteration loop (Sub-AC 4).
 *
 * Day 7's foundation-summary agent emits SPEC v3 / go-no-go.md /
 * foundation-summary.md candidates. Sub-AC 3 pinned the deterministic
 * rule-check (3-section minimal tone, evidence_refs required fields,
 * KR4.1 rating, KR4.2 cross-check). Sub-AC 4 owns the iteration glue
 * that turns "one shot" generation into a bounded review loop:
 *
 *   1. Run the generator (Claude Agent SDK foundation-summary lane —
 *      provider-runner.mjs already handles auth + tool gating).
 *   2. Run the deterministic rule-check on the candidate text +
 *      evidence_refs. PASS short-circuits the loop.
 *   3. On FAIL, query the Codex reviewer (independent provider) for
 *      additional structured concerns the rule-check can not see —
 *      e.g. "evidence_refs claim 'monetization yes' but the cited
 *      file shows 'no_reply'". The reviewer returns an `issues[]`
 *      array; the loop adds them to the regeneration feedback.
 *   4. Re-run the generator with feedback embedded. Repeat until
 *      PASS, max iteration cap, or convergence guard fires.
 *
 * Termination contract (only one fires per run, in this priority):
 *
 *   • "passed"            — rule-check verdict.pass === true.
 *   • "convergence_guard" — current iteration's failure fingerprint
 *                            (rule-check reasons + reviewer issues)
 *                            matches the prior iteration's. The loop
 *                            stops because more iterations cannot
 *                            change the verdict.
 *   • "max_iterations"    — reached `maxIterations` (default 3) and
 *                            still failing.
 *   • "generator_failed"  — generator threw OR returned no
 *                            assistant text. Surfaces immediately so
 *                            the host can fall back to draft.v1.
 *   • "aborted"           — caller's AbortSignal fired.
 *
 * The reviewer is OPTIONAL. If the host can not reach Codex (offline,
 * missing API key, etc.), pass `review: null` and the loop runs with
 * rule-check only. Reviewer errors are caught per-iteration and do
 * NOT fail the run — they degrade to "rule-check only" for that
 * iteration so a flaky reviewer can not silently kill the Day 7 lane.
 *
 * The module is intentionally pure: no fs, no network, no SDK calls.
 * The host (foundation-chat.mjs / index.mjs) injects:
 *   - `generate({ feedback, iteration })` — async, returns a candidate
 *   - `review({ candidate, ruleCheckVerdict, iteration })` — async,
 *     returns `{ issues: string[], comment?: string }`
 *
 * That keeps the loop deterministic for tests and decouples it from
 * the Claude / Codex provider plumbing.
 */

import {
  RULE_CHECK_THRESHOLDS,
  runFoundationSummaryRuleCheck,
} from "./rule-check.mjs";

const REVIEW_LOOP_SCHEMA_VERSION = 1;

/**
 * Default loop configuration. Exposed so tests can pin and so the host
 * (foundation-chat.mjs) can override per-deployment.
 */
export const FOUNDATION_REVIEW_LOOP_DEFAULTS = Object.freeze({
  /** Hard cap. Day 7 loop must terminate even if every iteration fails. */
  maxIterations: 3,
  /** How many issues to keep in the regeneration feedback per source. */
  feedbackIssueCap: 12,
  /** How many missing-line examples to surface in the feedback for KR4.2. */
  feedbackMissingLineCap: 6,
});

/**
 * Stable status strings the host renders into chat verdict badges + writes
 * into the evidence_refs sidecar (`review_loop.status`).
 */
export const FOUNDATION_REVIEW_LOOP_STATUSES = Object.freeze({
  PASSED: "passed",
  MAX_ITERATIONS: "max_iterations",
  CONVERGENCE_GUARD: "convergence_guard",
  GENERATOR_FAILED: "generator_failed",
  ABORTED: "aborted",
});

const ALL_STATUSES = new Set(Object.values(FOUNDATION_REVIEW_LOOP_STATUSES));

/**
 * Run the bounded Codex review iteration loop.
 *
 * @param {object} args
 * @param {(ctx: {
 *   feedback: string|null,
 *   iteration: number,
 *   priorCandidate: object|null,
 * }) => Promise<{
 *   assistantText: string,
 *   evidenceRefs?: Array<object>,
 *   finalDraftText?: string,
 *   draftV1Text?: string,
 *   metadata?: object,
 * }>} args.generate - REQUIRED. The Claude foundation-summary call.
 *   Must return at minimum `{assistantText}`. The loop synthesizes
 *   `finalDraftText = finalDraftText ?? assistantText` when checking KR4.2.
 *
 * @param {((ctx: {
 *   candidate: object,
 *   ruleCheckVerdict: object,
 *   iteration: number,
 * }) => Promise<{ issues?: string[], comment?: string }>) | null} [args.review]
 *   Optional Codex reviewer. The loop only consults it when the rule-check
 *   fails — PASS short-circuits before any reviewer call. Throw / reject
 *   inside the reviewer is caught per-iteration: that iteration falls back
 *   to rule-check only and the loop continues.
 *
 * @param {number|object|Array<number|object>|null} [args.userFeedback]
 *   Forwarded to `runFoundationSummaryRuleCheck()` for the KR4.1 axis.
 *
 * @param {object} [args.thresholds] - Override rule-check thresholds.
 * @param {number} [args.maxIterations] - Override max iteration cap.
 * @param {AbortSignal} [args.signal] - Optional cancel signal.
 * @param {(event: object) => void} [args.onIterationEvent] - Optional probe
 *   for telemetry / tests. Emitted phases:
 *     - "iteration.start"     { iteration, hasFeedback }
 *     - "iteration.candidate" { iteration, hasText, evidenceRefsCount }
 *     - "iteration.verdict"   { iteration, pass, score, reasons }
 *     - "iteration.reviewer"  { iteration, issuesCount, errored }
 *     - "iteration.complete"  { iteration, fingerprint, terminal }
 *     - "loop.terminated"     { status, iterations, reason }
 * @param {() => Date} [args.now] - Clock override for tests.
 *
 * @returns {Promise<{
 *   schema_version: 1,
 *   status: "passed"|"max_iterations"|"convergence_guard"|"generator_failed"|"aborted",
 *   total_iterations: number,
 *   max_iterations: number,
 *   passed: boolean,
 *   final_candidate: object|null,
 *   final_verdict: object|null,
 *   reviewer_concerns: string[],
 *   iterations: Array<{
 *     iteration: number,
 *     feedback: string|null,
 *     candidate: object|null,
 *     verdict: object|null,
 *     reviewer_issues: string[],
 *     reviewer_comment: string,
 *     reviewer_errored: boolean,
 *     fingerprint: string,
 *     started_at: string,
 *     completed_at: string,
 *   }>,
 *   reason: string,
 *   finalized_at: string,
 * }>}
 */
export async function runFoundationSummaryReviewLoop({
  generate,
  review = null,
  userFeedback = null,
  thresholds = RULE_CHECK_THRESHOLDS,
  maxIterations = FOUNDATION_REVIEW_LOOP_DEFAULTS.maxIterations,
  signal = null,
  onIterationEvent,
  now = () => new Date(),
} = {}) {
  if (typeof generate !== "function") {
    throw new TypeError("runFoundationSummaryReviewLoop requires a generate() function.");
  }
  const cap = clampMaxIterations(maxIterations);
  const emit = typeof onIterationEvent === "function" ? onIterationEvent : null;

  const iterations = [];
  let currentFeedback = null;
  let lastFingerprint = null;
  let lastCandidate = null;
  let lastVerdict = null;
  let lastReviewerIssues = [];

  for (let i = 1; i <= cap; i++) {
    // Allow callers to cancel between iterations (the inner generate /
    // review calls are responsible for honouring the same signal as well).
    if (isAborted(signal)) {
      return finalize({
        status: FOUNDATION_REVIEW_LOOP_STATUSES.ABORTED,
        iterations,
        finalCandidate: lastCandidate,
        finalVerdict: lastVerdict,
        reviewerConcerns: lastReviewerIssues,
        cap,
        reason: "loop aborted before iteration completed",
        now,
        emit,
      });
    }

    const startedAt = isoNow(now);
    emit?.({
      phase: "iteration.start",
      iteration: i,
      hasFeedback: Boolean(currentFeedback),
    });

    let candidate;
    try {
      candidate = await generate({
        feedback: currentFeedback,
        iteration: i,
        priorCandidate: lastCandidate,
      });
    } catch (error) {
      const message = String(error?.message || error || "generator threw");
      iterations.push({
        iteration: i,
        feedback: currentFeedback,
        candidate: null,
        verdict: null,
        reviewer_issues: [],
        reviewer_comment: "",
        reviewer_errored: false,
        generator_error: message,
        fingerprint: "",
        started_at: startedAt,
        completed_at: isoNow(now),
      });
      return finalize({
        status: FOUNDATION_REVIEW_LOOP_STATUSES.GENERATOR_FAILED,
        iterations,
        finalCandidate: null,
        finalVerdict: null,
        reviewerConcerns: [],
        cap,
        reason: `generator threw on iteration ${i}: ${message}`,
        now,
        emit,
      });
    }

    if (!candidate || typeof candidate.assistantText !== "string" || !candidate.assistantText.trim()) {
      iterations.push({
        iteration: i,
        feedback: currentFeedback,
        candidate: candidate ?? null,
        verdict: null,
        reviewer_issues: [],
        reviewer_comment: "",
        reviewer_errored: false,
        generator_error: "empty_assistant_text",
        fingerprint: "",
        started_at: startedAt,
        completed_at: isoNow(now),
      });
      return finalize({
        status: FOUNDATION_REVIEW_LOOP_STATUSES.GENERATOR_FAILED,
        iterations,
        finalCandidate: candidate ?? null,
        finalVerdict: null,
        reviewerConcerns: [],
        cap,
        reason: `generator returned empty assistantText on iteration ${i}`,
        now,
        emit,
      });
    }

    lastCandidate = candidate;
    emit?.({
      phase: "iteration.candidate",
      iteration: i,
      hasText: true,
      evidenceRefsCount: Array.isArray(candidate.evidenceRefs) ? candidate.evidenceRefs.length : 0,
    });

    const verdict = runFoundationSummaryRuleCheck({
      assistantText: candidate.assistantText,
      evidenceRefs: candidate.evidenceRefs,
      userFeedback,
      draftV1Text: candidate.draftV1Text || "",
      finalDraftText:
        typeof candidate.finalDraftText === "string" && candidate.finalDraftText.trim()
          ? candidate.finalDraftText
          : candidate.assistantText,
      thresholds,
    });
    lastVerdict = verdict;
    emit?.({
      phase: "iteration.verdict",
      iteration: i,
      pass: verdict.pass,
      score: verdict.score,
      reasons: verdict.reasons,
    });

    // PASS short-circuits before we burn a Codex call.
    if (verdict.pass) {
      const fingerprint = fingerprintIssues({
        ruleCheckReasons: verdict.reasons,
        reviewerIssues: [],
      });
      iterations.push({
        iteration: i,
        feedback: currentFeedback,
        candidate,
        verdict,
        reviewer_issues: [],
        reviewer_comment: "",
        reviewer_errored: false,
        fingerprint,
        started_at: startedAt,
        completed_at: isoNow(now),
      });
      lastReviewerIssues = [];
      emit?.({ phase: "iteration.complete", iteration: i, fingerprint, terminal: true });
      return finalize({
        status: FOUNDATION_REVIEW_LOOP_STATUSES.PASSED,
        iterations,
        finalCandidate: candidate,
        finalVerdict: verdict,
        reviewerConcerns: [],
        cap,
        reason: `rule-check passed on iteration ${i}`,
        now,
        emit,
      });
    }

    // FAIL — consult the optional Codex reviewer for issues the deterministic
    // rule-check can not see (e.g. citation accuracy, monetization framing).
    let reviewerIssues = [];
    let reviewerComment = "";
    let reviewerErrored = false;
    if (typeof review === "function") {
      try {
        const result = await review({ candidate, ruleCheckVerdict: verdict, iteration: i });
        reviewerIssues = sanitizeIssueList(result?.issues);
        reviewerComment =
          typeof result?.comment === "string" ? result.comment.trim() : "";
      } catch (error) {
        reviewerErrored = true;
        reviewerComment = `reviewer_error: ${String(error?.message || error || "unknown")}`;
        emit?.({
          phase: "iteration.reviewer",
          iteration: i,
          issuesCount: 0,
          errored: true,
          error: reviewerComment,
        });
      }
    }
    if (!reviewerErrored) {
      emit?.({
        phase: "iteration.reviewer",
        iteration: i,
        issuesCount: reviewerIssues.length,
        errored: false,
      });
    }
    lastReviewerIssues = reviewerIssues;

    const fingerprint = fingerprintIssues({
      ruleCheckReasons: verdict.reasons,
      reviewerIssues,
    });

    iterations.push({
      iteration: i,
      feedback: currentFeedback,
      candidate,
      verdict,
      reviewer_issues: reviewerIssues,
      reviewer_comment: reviewerComment,
      reviewer_errored: reviewerErrored,
      fingerprint,
      started_at: startedAt,
      completed_at: isoNow(now),
    });

    // Convergence guard: same fingerprint as the prior iteration → another
    // turn cannot change the verdict. Stop early so we don't waste tokens.
    if (lastFingerprint && lastFingerprint === fingerprint && i >= 2) {
      emit?.({ phase: "iteration.complete", iteration: i, fingerprint, terminal: true });
      return finalize({
        status: FOUNDATION_REVIEW_LOOP_STATUSES.CONVERGENCE_GUARD,
        iterations,
        finalCandidate: candidate,
        finalVerdict: verdict,
        reviewerConcerns: dedupedConcerns(verdict, reviewerIssues),
        cap,
        reason: `convergence guard fired on iteration ${i} — same issues as iteration ${i - 1}`,
        now,
        emit,
      });
    }
    lastFingerprint = fingerprint;
    emit?.({ phase: "iteration.complete", iteration: i, fingerprint, terminal: false });

    // Last iteration → don't bother building feedback for a regeneration we
    // are not going to run.
    if (i >= cap) {
      return finalize({
        status: FOUNDATION_REVIEW_LOOP_STATUSES.MAX_ITERATIONS,
        iterations,
        finalCandidate: candidate,
        finalVerdict: verdict,
        reviewerConcerns: dedupedConcerns(verdict, reviewerIssues),
        cap,
        reason: `max iterations reached (${cap}) without rule-check pass`,
        now,
        emit,
      });
    }

    // Build the next iteration's regeneration feedback. Includes:
    //   - rule-check reasons (deterministic, machine-readable)
    //   - reviewer issues (qualitative, from Codex)
    //   - missing KR4.2 lines (so the model knows which facts dropped out)
    currentFeedback = buildRegenerationFeedback({
      iteration: i,
      ruleCheckVerdict: verdict,
      reviewerIssues,
      reviewerComment,
      priorCandidate: candidate,
      issueCap: FOUNDATION_REVIEW_LOOP_DEFAULTS.feedbackIssueCap,
      missingLineCap: FOUNDATION_REVIEW_LOOP_DEFAULTS.feedbackMissingLineCap,
    });
  }

  // Defensive fallthrough — `for` loop above always returns. If we somehow
  // get here, treat as max_iterations so the host still has a verdict.
  return finalize({
    status: FOUNDATION_REVIEW_LOOP_STATUSES.MAX_ITERATIONS,
    iterations,
    finalCandidate: lastCandidate,
    finalVerdict: lastVerdict,
    reviewerConcerns: dedupedConcerns(lastVerdict, lastReviewerIssues),
    cap,
    reason: "loop fell through without explicit termination",
    now,
    emit,
  });
}

/**
 * Build the regeneration feedback prompt block injected into the next
 * generator call. Pure / synchronous — exposed for tests + so the host can
 * compose it into structured-input prompts when needed.
 *
 * The feedback is intentionally terse and YC-partner toned: "you missed
 * X, fix Y" rather than apologetic prose. Stays in 반말 to match the
 * persona contract pinned by Sub-AC 3.
 *
 * @param {object} args
 * @param {number} args.iteration - The iteration number that just FAILED.
 *   Feedback is for iteration N+1.
 * @param {object} args.ruleCheckVerdict - Rule-check verdict from Sub-AC 3.
 * @param {string[]} [args.reviewerIssues] - Codex reviewer issues.
 * @param {string} [args.reviewerComment] - Codex reviewer prose summary.
 * @param {object|null} [args.priorCandidate] - The candidate that just failed.
 * @param {number} [args.issueCap]
 * @param {number} [args.missingLineCap]
 * @returns {string} Plain-text feedback block.
 */
export function buildRegenerationFeedback({
  iteration,
  ruleCheckVerdict,
  reviewerIssues = [],
  reviewerComment = "",
  priorCandidate = null,
  issueCap = FOUNDATION_REVIEW_LOOP_DEFAULTS.feedbackIssueCap,
  missingLineCap = FOUNDATION_REVIEW_LOOP_DEFAULTS.feedbackMissingLineCap,
} = {}) {
  const lines = [];
  lines.push(`## Foundation Day 7 — Review Loop Feedback (iteration ${iteration} → ${iteration + 1})`);
  lines.push(
    "방금 출력은 rule-check를 통과 못 했어. 아래 결함을 그대로 고쳐서 다시 작성해. 추가 변명 / 정서 sugar / 새 가설 금지.",
  );

  // Rule-check axis: tone
  if (ruleCheckVerdict?.checks?.tone && !ruleCheckVerdict.checks.tone.pass) {
    lines.push("");
    lines.push("### 1. 3-section minimal 톤 (Yesterday 1줄 / Today 1줄 / Q 1줄)");
    const tone = ruleCheckVerdict.checks.tone;
    if (!tone.sections?.yesterday) lines.push("- 어제 라인 누락 또는 너무 짧아 — 1줄로 다시 써.");
    if (!tone.sections?.today) lines.push("- 오늘 라인 누락 또는 너무 짧아 — 1줄로 다시 써.");
    if (!tone.sections?.question) lines.push("- Q 라인 누락 — 사용자에게 묻는 1문장으로 끝내.");
    if (Array.isArray(tone.sugarHits) && tone.sugarHits.length > 0) {
      lines.push(`- 정서 sugar 제거: ${tone.sugarHits.slice(0, issueCap).join(", ")}`);
    }
    if (Array.isArray(tone.formalHits) && tone.formalHits.length > 0) {
      lines.push(
        `- 문어체/존댓말 제거 (반말 ~어/야 유지): ${tone.formalHits
          .slice(0, issueCap)
          .map(stripQuotes)
          .join(" | ")}`,
      );
    }
  }

  // Rule-check axis: evidence_refs
  if (ruleCheckVerdict?.checks?.evidence_refs && !ruleCheckVerdict.checks.evidence_refs.pass) {
    lines.push("");
    lines.push("### 2. evidence_refs JSON 사이드카");
    const ev = ruleCheckVerdict.checks.evidence_refs;
    if (Array.isArray(ev.missingFields) && ev.missingFields.length > 0) {
      const sample = ev.missingFields.slice(0, issueCap);
      for (const entry of sample) {
        lines.push(`- entry[${entry.index}] 누락 필드: ${entry.fields.join(", ")}`);
      }
    }
    if (Array.isArray(ev.invalidRefTypes) && ev.invalidRefTypes.length > 0) {
      const sample = ev.invalidRefTypes.slice(0, issueCap);
      for (const entry of sample) {
        lines.push(`- entry[${entry.index}] 허용 안 되는 ref_type="${entry.ref_type}" (path/file/work_log/interview/bip 중 하나로 고쳐).`);
      }
    }
    if (ev.total === 0) {
      lines.push("- evidence_refs 비어있음 — Day 0-6 산출물에서 인용 1건 이상 박아.");
    }
  }

  // Rule-check axis: KR4.1
  if (ruleCheckVerdict?.checks?.kr41 && !ruleCheckVerdict.checks.kr41.pass) {
    lines.push("");
    lines.push("### 3. KR4.1 — user accuracy_rating");
    const k = ruleCheckVerdict.checks.kr41;
    if (k.sample_size === 0) {
      lines.push("- 사용자 accuracy_rating이 아직 없어 — Day 7 retrospective에서 1-5 점수를 받아 반영해.");
    } else {
      lines.push(`- 평균 ${k.mean} (필요 ≥ ${k.min_rating_required}) — 사용자 피드백을 다시 묻고 결과를 반영해.`);
    }
  }

  // Rule-check axis: KR4.2
  if (ruleCheckVerdict?.checks?.kr42 && !ruleCheckVerdict.checks.kr42.pass) {
    lines.push("");
    lines.push("### 4. KR4.2 — draft.v1 ↔ final-draft 정합");
    const k = ruleCheckVerdict.checks.kr42;
    if (k.total === 0) {
      lines.push("- draft.v1 또는 final draft가 비어있음 — workspace 사전 수집한 draft.v1을 출발점으로 다시 써.");
    } else {
      lines.push(`- overlap ${k.overlap} (필요 ≥ ${k.min_overlap_required}) — draft.v1의 핵심 라인 ${k.matched}/${k.total}만 살아남았어.`);
    }
    if (Array.isArray(k.missing_lines) && k.missing_lines.length > 0) {
      const sample = k.missing_lines.slice(0, missingLineCap);
      lines.push("- 누락된 핵심 라인 (그대로 다시 살려):");
      for (const missing of sample) {
        lines.push(`  - ${missing}`);
      }
    }
  }

  // Reviewer axis (Codex)
  if (Array.isArray(reviewerIssues) && reviewerIssues.length > 0) {
    lines.push("");
    lines.push("### 5. Codex 리뷰 — 추가 결함");
    for (const issue of reviewerIssues.slice(0, issueCap)) {
      lines.push(`- ${issue}`);
    }
  }
  if (reviewerComment && !reviewerComment.startsWith("reviewer_error:")) {
    lines.push("");
    lines.push("### Codex 코멘트");
    lines.push(reviewerComment);
  }

  // Final regeneration directive
  lines.push("");
  lines.push("## Regeneration 지시");
  lines.push("- 위 결함 전부 반영해서 SPEC v3 / go-no-go / foundation-summary 후보를 다시 출력.");
  lines.push("- 같은 결함을 또 만들면 convergence guard로 자동 종료돼.");

  return lines.join("\n");
}

/**
 * Build a stable fingerprint for the union of (rule-check reasons, reviewer
 * issues). Used by the convergence guard to detect "same failure twice".
 *
 * The fingerprint normalizes:
 *   - whitespace + case (so "Foo Bar" === "foo bar"),
 *   - duplicates,
 *   - order (sorted ascending).
 *
 * Returns an empty string when both inputs are empty so the convergence
 * guard can not fire on a pure PASS path.
 *
 * @param {object} args
 * @param {string[]} [args.ruleCheckReasons]
 * @param {string[]} [args.reviewerIssues]
 * @returns {string}
 */
export function fingerprintIssues({ ruleCheckReasons = [], reviewerIssues = [] } = {}) {
  const all = [
    ...(Array.isArray(ruleCheckReasons) ? ruleCheckReasons : []).map((r) => `rule:${normalizeIssue(r)}`),
    ...(Array.isArray(reviewerIssues) ? reviewerIssues : []).map((r) => `review:${normalizeIssue(r)}`),
  ].filter(Boolean);
  if (all.length === 0) return "";
  const unique = Array.from(new Set(all));
  unique.sort();
  return unique.join("|");
}

// ───────────────────────── internal helpers ─────────────────────────

function clampMaxIterations(value) {
  const n = Number(value);
  if (!Number.isFinite(n)) return FOUNDATION_REVIEW_LOOP_DEFAULTS.maxIterations;
  const trunc = Math.trunc(n);
  if (trunc < 1) return 1;
  if (trunc > 10) return 10; // hard ceiling — Day 7 should never blow past
  return trunc;
}

function isAborted(signal) {
  return Boolean(signal && typeof signal === "object" && signal.aborted);
}

function isoNow(now) {
  try {
    const d = typeof now === "function" ? now() : now;
    if (d instanceof Date) return d.toISOString();
    if (typeof d === "string") return d;
  } catch {
    /* fall through to wall clock */
  }
  return new Date().toISOString();
}

function sanitizeIssueList(input) {
  if (!Array.isArray(input)) return [];
  const out = [];
  const seen = new Set();
  for (const raw of input) {
    if (typeof raw !== "string") continue;
    const trimmed = raw.trim();
    if (!trimmed) continue;
    const norm = normalizeIssue(trimmed);
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(trimmed);
  }
  return out;
}

function normalizeIssue(s) {
  return String(s || "")
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}

function stripQuotes(s) {
  return String(s || "").replace(/[`"']/g, "");
}

function dedupedConcerns(verdict, reviewerIssues) {
  const reasons = Array.isArray(verdict?.reasons) ? verdict.reasons : [];
  const reviewer = Array.isArray(reviewerIssues) ? reviewerIssues : [];
  const seen = new Set();
  const out = [];
  for (const r of [...reasons, ...reviewer]) {
    const norm = normalizeIssue(r);
    if (!norm) continue;
    if (seen.has(norm)) continue;
    seen.add(norm);
    out.push(typeof r === "string" ? r : String(r));
  }
  return out;
}

function finalize({
  status,
  iterations,
  finalCandidate,
  finalVerdict,
  reviewerConcerns,
  cap,
  reason,
  now,
  emit,
}) {
  if (!ALL_STATUSES.has(status)) {
    throw new Error(`Unknown review-loop status: ${status}`);
  }
  emit?.({
    phase: "loop.terminated",
    status,
    iterations: iterations.length,
    reason,
  });
  return {
    schema_version: REVIEW_LOOP_SCHEMA_VERSION,
    status,
    total_iterations: iterations.length,
    max_iterations: cap,
    passed: status === FOUNDATION_REVIEW_LOOP_STATUSES.PASSED,
    final_candidate: finalCandidate ?? null,
    final_verdict: finalVerdict ?? null,
    reviewer_concerns: Array.isArray(reviewerConcerns) ? [...reviewerConcerns] : [],
    iterations,
    reason,
    finalized_at: isoNow(now),
  };
}

export const __test__ = Object.freeze({
  clampMaxIterations,
  normalizeIssue,
  sanitizeIssueList,
  dedupedConcerns,
  isAborted,
});

/**
 * Tests for AC 13 Sub-AC 3 — foundation-summary rule-check.
 *
 * The rule-check verifies three axes BEFORE the foundation-summary host
 * persists evidence_refs / shows the candidate to the user:
 *   1. 3-section minimal tone (Yesterday / Today / Q + YC partner persona).
 *   2. evidence_refs required-field contract.
 *   3. KR4.1 (user rating ≥ 4.0) and KR4.2 (cross-check 정합 ≥ 0.8) checks.
 */

import test from "node:test";
import assert from "node:assert/strict";
import {
  ALLOWED_EVIDENCE_REF_TYPES,
  REQUIRED_EVIDENCE_REF_FIELDS,
  RULE_CHECK_THRESHOLDS,
  checkEvidenceRefsRequired,
  checkKR41Rating,
  checkKR42CrossCheck,
  checkThreeSectionMinimal,
  runFoundationSummaryRuleCheck,
  __test__,
} from "../sidecar/foundation-summary/rule-check.mjs";

// ────────────── 3-section minimal tone ──────────────

test("checkThreeSectionMinimal accepts a clean 3-section opener with Korean labels", () => {
  const text = [
    "어제: SPEC v0 끝냈어. 가설 H1 제일 약해.",
    "오늘: 24h 안에 강화/반증 데이터 1건씩 끌어와.",
    "Q: 어느 인풋 먼저 — 인터뷰 / 일지 / BIP?",
  ].join("\n");
  const verdict = checkThreeSectionMinimal(text);
  assert.equal(verdict.pass, true, `verdict=${JSON.stringify(verdict)}`);
  assert.deepEqual(verdict.sections, { yesterday: true, today: true, question: true });
  assert.equal(verdict.sugarHits.length, 0);
  assert.equal(verdict.formalHits.length, 0);
  assert.deepEqual(verdict.reasons, []);
});

test("checkThreeSectionMinimal accepts English labels (Yesterday / Today / Q)", () => {
  const text = [
    "Yesterday: SPEC v0 done. H1 weak.",
    "Today: 강화 1 + 반증 1 끌어와.",
    "Q: 어느 거 먼저야?",
  ].join("\n");
  const verdict = checkThreeSectionMinimal(text);
  assert.equal(verdict.pass, true);
});

test("checkThreeSectionMinimal flags missing question line", () => {
  const text = ["어제: 채널 등록.", "오늘: 인풋 4종 박아."].join("\n");
  const verdict = checkThreeSectionMinimal(text);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.sections.question, false);
  assert.ok(verdict.reasons.includes("missing_question_line"));
});

test("checkThreeSectionMinimal rejects 정서 sugar even when 3 sections are present", () => {
  const text = [
    "어제: 잘하고 있어요! 응원해.",
    "오늘: 화이팅!",
    "Q: 어떻게 도와줄까?",
  ].join("\n");
  const verdict = checkThreeSectionMinimal(text);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.sugarHits.length >= 2);
  assert.ok(verdict.reasons.includes("sugar_phrases_present"));
});

test("checkThreeSectionMinimal rejects emoji sugar", () => {
  const text = ["어제: ok 💪", "오늘: ✨ go", "Q: 다음 단계는?"].join("\n");
  const verdict = checkThreeSectionMinimal(text);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.sugarHits.length >= 1);
});

test("checkThreeSectionMinimal rejects 문어체 sentence endings", () => {
  const text = [
    "어제: SPEC v0 작성을 완료했습니다.",
    "오늘: 인터뷰 진행하시겠어요?",
    "Q: 어느 가설부터 검증하실 건가요?",
  ].join("\n");
  const verdict = checkThreeSectionMinimal(text);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.formalHits.length >= 1);
  assert.ok(verdict.reasons.includes("formal_korean_endings_present"));
});

test("checkThreeSectionMinimal rejects empty body", () => {
  const verdict = checkThreeSectionMinimal("");
  assert.equal(verdict.pass, false);
  assert.ok(verdict.reasons.includes("empty_body"));
});

test("checkThreeSectionMinimal flags overly long sections", () => {
  const long = "x".repeat(RULE_CHECK_THRESHOLDS.sectionMaxChars + 10);
  const text = [`어제: ${long}`, "오늘: ok", "Q: ok?"].join("\n");
  const verdict = checkThreeSectionMinimal(text);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.reasons.some((r) => r.endsWith("_too_long")));
});

test("checkThreeSectionMinimal handles non-string input gracefully", () => {
  for (const bad of [null, undefined, 42, {}, []]) {
    const verdict = checkThreeSectionMinimal(bad);
    assert.equal(verdict.pass, false, `bad=${JSON.stringify(bad)}`);
  }
});

// ────────────── evidence_refs required fields ──────────────

test("checkEvidenceRefsRequired exposes the 5 required fields", () => {
  assert.deepEqual([...REQUIRED_EVIDENCE_REF_FIELDS], [
    "file",
    "location",
    "field_used",
    "extracted_value",
    "ref_type",
  ]);
});

test("checkEvidenceRefsRequired passes a fully-populated array", () => {
  const refs = [
    {
      file: "docs/work-log/2026-05-01.md",
      location: "L42",
      field_used: "pain_summary",
      extracted_value: "사용자 X가 어제 매뉴얼 12회 반복",
      ref_type: "work_log",
    },
    {
      file: "interviews/jane-2026-04-30.md",
      location: "Q3",
      field_used: "past_action",
      extracted_value: "엑셀 매크로 직접 작성 — 12시간 소요",
      ref_type: "interview",
    },
  ];
  const verdict = checkEvidenceRefsRequired(refs);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.total, 2);
  assert.equal(verdict.valid, 2);
  assert.deepEqual(verdict.missingFields, []);
});

test("checkEvidenceRefsRequired flags missing fields per entry", () => {
  const refs = [
    { file: "a.md", location: "L1", field_used: "x", extracted_value: 1, ref_type: "work_log" },
    { file: "b.md", location: "", field_used: "x", extracted_value: 1, ref_type: "interview" },
    { file: "c.md", location: "L3", field_used: "x", extracted_value: null, ref_type: "bip" },
  ];
  const verdict = checkEvidenceRefsRequired(refs);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.total, 3);
  assert.equal(verdict.valid, 1);
  const missing = new Map(verdict.missingFields.map((m) => [m.index, m.fields]));
  assert.deepEqual(missing.get(1), ["location"]);
  assert.deepEqual(missing.get(2), ["extracted_value"]);
  assert.ok(verdict.reasons.includes("required_fields_missing"));
});

test("checkEvidenceRefsRequired rejects ref_type='unknown'", () => {
  const refs = [
    {
      file: "a.md",
      location: "L1",
      field_used: "x",
      extracted_value: 1,
      ref_type: "unknown",
    },
  ];
  const verdict = checkEvidenceRefsRequired(refs);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.missingFields.some((m) => m.fields.includes("ref_type")));
});

test("checkEvidenceRefsRequired flags out-of-allowlist ref_type values", () => {
  const refs = [
    {
      file: "a.md",
      location: "L1",
      field_used: "x",
      extracted_value: 1,
      ref_type: "twitter_thread",
    },
  ];
  const verdict = checkEvidenceRefsRequired(refs);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.invalidRefTypes.length, 1);
  assert.equal(verdict.invalidRefTypes[0].ref_type, "twitter_thread");
  assert.ok(verdict.reasons.includes("invalid_ref_type_present"));
});

test("checkEvidenceRefsRequired handles empty/missing arrays explicitly", () => {
  const empty = checkEvidenceRefsRequired([]);
  assert.equal(empty.pass, false);
  assert.ok(empty.reasons.includes("evidence_refs_empty"));

  const absent = checkEvidenceRefsRequired(null);
  assert.equal(absent.pass, false);
  assert.ok(absent.reasons.includes("evidence_refs_absent"));

  const notArray = checkEvidenceRefsRequired({ file: "a.md" });
  assert.equal(notArray.pass, false);
  assert.ok(notArray.reasons.includes("evidence_refs_not_array"));
});

test("checkEvidenceRefsRequired accepts every allowed ref_type", () => {
  const refs = ALLOWED_EVIDENCE_REF_TYPES.map((rt, i) => ({
    file: `f${i}.md`,
    location: `L${i}`,
    field_used: "x",
    extracted_value: i,
    ref_type: rt,
  }));
  const verdict = checkEvidenceRefsRequired(refs);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.valid, ALLOWED_EVIDENCE_REF_TYPES.length);
});

// ────────────── KR4.1 user rating ──────────────

test("checkKR41Rating accepts a single rating ≥ threshold", () => {
  const verdict = checkKR41Rating(4.5);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.sample_size, 1);
  assert.equal(verdict.mean, 4.5);
});

test("checkKR41Rating fails below threshold and reports the reason", () => {
  const verdict = checkKR41Rating(3.5);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.mean, 3.5);
  assert.ok(verdict.reasons.includes("kr41_below_threshold"));
});

test("checkKR41Rating averages an array of {accuracy_rating} entries", () => {
  const input = [
    { accuracy_rating: 5 },
    { accuracy_rating: 4 },
    { accuracy_rating: 4 },
  ];
  const verdict = checkKR41Rating(input);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.sample_size, 3);
  assert.ok(verdict.mean >= 4.0);
});

test("checkKR41Rating reports no_user_feedback for null input", () => {
  const verdict = checkKR41Rating(null);
  assert.equal(verdict.pass, false);
  assert.equal(verdict.sample_size, 0);
  assert.ok(verdict.reasons.includes("no_user_feedback"));
});

test("checkKR41Rating ignores out-of-range ratings (wrong-scale guard)", () => {
  const verdict = checkKR41Rating([0, 7, 4.5, "junk"]);
  assert.equal(verdict.sample_size, 1); // only 4.5 survives
  assert.equal(verdict.mean, 4.5);
});

test("checkKR41Rating threshold can be overridden", () => {
  const verdict = checkKR41Rating(3.7, { minRating: 3.5 });
  assert.equal(verdict.pass, true);
});

// ────────────── KR4.2 cross-check 정합 ──────────────

test("checkKR42CrossCheck passes when final draft preserves all key bullets", () => {
  const draftV1 = [
    "## Foundation Summary draft.v1",
    "- artifacts_completeness: 85%",
    "- monetization_signal: yes",
    "- spec_versions_present: v0, v1, v2",
    "- recommendation: continue",
  ].join("\n");
  const finalDraft = [
    "# 최종 Foundation Summary",
    "- artifacts_completeness: 85% (Day 0-6 모두 채워짐).",
    "- monetization_signal: yes — 1건 결제 확정.",
    "- spec_versions_present: v0, v1, v2 → v3 박아야.",
    "- recommendation: continue → Build phase 진입.",
  ].join("\n");
  const verdict = checkKR42CrossCheck(draftV1, finalDraft);
  assert.equal(verdict.pass, true);
  assert.equal(verdict.matched, verdict.total);
  assert.ok(verdict.overlap >= 0.8);
});

test("checkKR42CrossCheck fails when final draft drops > 20% of key lines", () => {
  const draftV1 = [
    "- artifacts_completeness: 85%",
    "- monetization_signal: yes",
    "- spec_versions_present: v0, v1, v2",
    "- recommendation: continue",
    "- evidence_sidecars: 12",
  ].join("\n");
  const finalDraft = [
    "# 최종",
    "- artifacts_completeness: 85%",
    "- recommendation: continue",
  ].join("\n");
  const verdict = checkKR42CrossCheck(draftV1, finalDraft);
  assert.equal(verdict.pass, false);
  assert.ok(verdict.overlap < 0.8);
  assert.ok(verdict.missing_lines.length >= 2);
  assert.ok(verdict.reasons.includes("kr42_below_threshold"));
});

test("checkKR42CrossCheck reports draft_v1_missing for empty draft", () => {
  const verdict = checkKR42CrossCheck("", "anything");
  assert.equal(verdict.pass, false);
  assert.ok(verdict.reasons.includes("draft_v1_missing"));
});

test("checkKR42CrossCheck threshold can be overridden", () => {
  const draftV1 = "- alpha: hello\n- beta: world";
  const finalDraft = "- alpha: hello\n# nope";
  const lenient = checkKR42CrossCheck(draftV1, finalDraft, { minOverlap: 0.4 });
  assert.equal(lenient.pass, true, JSON.stringify(lenient));
  const strict = checkKR42CrossCheck(draftV1, finalDraft, { minOverlap: 0.9 });
  assert.equal(strict.pass, false);
});

test("checkKR42CrossCheck normalization is whitespace + punctuation tolerant", () => {
  const draftV1 = "- artifacts_completeness: 85%";
  const finalDraft = "  ARTIFACTS_COMPLETENESS:  85% — confirmed.";
  const verdict = checkKR42CrossCheck(draftV1, finalDraft);
  assert.equal(verdict.matched, 1);
  assert.equal(verdict.pass, true);
});

// ────────────── orchestrator ──────────────

test("runFoundationSummaryRuleCheck composes all 4 axes into one verdict", () => {
  const verdict = runFoundationSummaryRuleCheck({
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
    userFeedback: { accuracy_rating: 4.5 },
    draftV1Text: [
      "- monetization_signal: yes",
      "- recommendation: continue",
    ].join("\n"),
    finalDraftText: [
      "## final",
      "- monetization_signal: yes",
      "- recommendation: continue → Build phase.",
    ].join("\n"),
  });
  assert.equal(verdict.pass, true, JSON.stringify(verdict));
  assert.equal(verdict.checks.tone.pass, true);
  assert.equal(verdict.checks.evidence_refs.pass, true);
  assert.equal(verdict.checks.kr41.pass, true);
  assert.equal(verdict.checks.kr42.pass, true);
  assert.equal(verdict.schema_version, 1);
  assert.match(verdict.persona, /YC 파트너/);
  assert.match(verdict.template, /3-section minimal/);
});

test("runFoundationSummaryRuleCheck reports a per-axis failure list", () => {
  const verdict = runFoundationSummaryRuleCheck({
    assistantText: "응원해 — 잘하고 있어요!", // sugar + missing sections
    evidenceRefs: [], // empty
    userFeedback: { accuracy_rating: 2.5 }, // below threshold
    draftV1Text: "- a\n- b",
    finalDraftText: "nope",
  });
  assert.equal(verdict.pass, false);
  assert.ok(verdict.reasons.some((r) => r.startsWith("tone:")));
  assert.ok(verdict.reasons.some((r) => r.startsWith("evidence:")));
  assert.ok(verdict.reasons.some((r) => r.startsWith("kr41:")));
  assert.ok(verdict.reasons.some((r) => r.startsWith("kr42:")));
});

test("runFoundationSummaryRuleCheck score is bounded 0..1 and reflects partial wins", () => {
  const goodTone = [
    "어제: ok",
    "오늘: ok",
    "Q: ok?",
  ].join("\n");
  const partial = runFoundationSummaryRuleCheck({
    assistantText: goodTone,
    evidenceRefs: [
      {
        file: "a.md",
        location: "L1",
        field_used: "x",
        extracted_value: 1,
        ref_type: "work_log",
      },
    ],
    userFeedback: null, // KR4.1 fails
    draftV1Text: "",
    finalDraftText: "", // KR4.2 fails
  });
  assert.equal(partial.pass, false);
  assert.ok(partial.score > 0);
  assert.ok(partial.score < 1);
});

test("runFoundationSummaryRuleCheck stamps a parseable ISO timestamp", () => {
  const verdict = runFoundationSummaryRuleCheck({
    assistantText: "어제: ok\n오늘: ok\nQ: ok?",
    evidenceRefs: [],
  });
  assert.ok(verdict.checked_at);
  assert.ok(!Number.isNaN(Date.parse(verdict.checked_at)));
});

// ────────────── unit-level helpers ──────────────

test("__test__.extractKeyLines keeps bullets and labelled facts only", () => {
  const { extractKeyLines } = __test__;
  const lines = extractKeyLines(
    [
      "# heading",
      "regular line — should be ignored",
      "- bullet one with content",
      "label: value here",
      "- a", // too short
      "```",
      "code line",
      "```",
    ].join("\n"),
  );
  assert.ok(lines.includes("bullet one with content"));
  assert.ok(lines.includes("label: value here"));
  assert.ok(!lines.includes("# heading"));
  assert.ok(!lines.includes("regular line — should be ignored"));
});

test("__test__.normalizeForMatch lowercases + collapses whitespace/punctuation", () => {
  const { normalizeForMatch } = __test__;
  assert.equal(normalizeForMatch("Hello,  WORLD!"), "hello world");
  assert.equal(normalizeForMatch(""), "");
});

test("__test__.collectRatings rejects out-of-scale and non-numeric values", () => {
  const { collectRatings } = __test__;
  assert.deepEqual(collectRatings([1, 5, 6, "x", null]), [1, 5]);
  assert.deepEqual(collectRatings({ accuracy_rating: 4 }), [4]);
  assert.deepEqual(collectRatings(undefined), []);
});

test("__test__.scoreVerdict returns 1.0 only when every axis passes", () => {
  const { scoreVerdict } = __test__;
  const all = scoreVerdict({
    tone: { pass: true },
    evidence: { total: 1, valid: 1 },
    kr41: { pass: true, sample_size: 1, mean: 5 },
    kr42: { pass: true, overlap: 1 },
  });
  assert.equal(all, 1);
  const none = scoreVerdict({
    tone: { pass: false },
    evidence: { total: 0, valid: 0 },
    kr41: { pass: false, sample_size: 0, mean: 0 },
    kr42: { pass: false, overlap: 0 },
  });
  assert.equal(none, 0);
});

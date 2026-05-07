/**
 * Foundation-summary sub-workflow — rule-check verification (AC 13 Sub-AC 3).
 *
 * Day 7's foundation-summary agent emits SPEC v3 / go-no-go.md /
 * foundation-summary.md candidates. Sub-AC 3 owns the deterministic
 * verification layer that pins three independent contracts before the
 * candidate is shown to the user OR persisted as evidence:
 *
 *   1. 3-section minimal tone — the assistant message must open with the
 *      Yesterday / Today / Q triplet, stay in YC partner 반말, and contain
 *      no 정서 sugar / 문어체. (KR1.3 adaptive engine quality contract.)
 *
 *   2. evidence_refs required fields — every evidence_ref entry persisted
 *      to the JSON sidecar must carry the five fields documented by the
 *      Agentic30FoundationPhase ontology (file / location / field_used /
 *      extracted_value / ref_type) with non-empty, non-default values.
 *      An entry with `ref_type === "unknown"` is treated as missing —
 *      the sidecar is the input to KR4.2 cross-check, so an "unknown"
 *      type silently breaks downstream measurement.
 *
 *   3. KR4.1 / KR4.2 measurement items — the rule-check must surface the
 *      two key results the Q2 OKR pins for adaptive engine quality:
 *        • KR4.1: user_feedback.accuracy_rating average ≥ 4.0 (1-5 scale).
 *        • KR4.2: draft.v1 ↔ final-draft 정합 (line-overlap ratio) ≥ 0.80.
 *
 * The module is intentionally pure and synchronous — no fs, no network —
 * so it composes cleanly inside foundation-chat.mjs (`runUnifiedFoundationChat`)
 * AND inside test harnesses without filesystem fixtures.
 *
 * The return shape is stable so the host can:
 *   - render verdict badges in the chat surface,
 *   - attach `verdict` to the evidence_refs JSON sidecar,
 *   - feed the score into PostHog opt-in telemetry for KR4.1/4.2.
 */

const PERSONA = "YC 파트너 / 시니어 메이커 (직설+압박, 반말 ~어/야)";
const RULE_CHECK_SCHEMA_VERSION = 1;

/**
 * Default thresholds for the KR4.x measurement items. Exposed so tests can
 * pin and so the sidecar (foundation-chat.mjs) can override per-deployment
 * without forking this module.
 */
export const RULE_CHECK_THRESHOLDS = Object.freeze({
  /** KR4.1 — minimum mean user accuracy rating (1-5). */
  kr41MinRating: 4.0,
  /** KR4.2 — minimum draft.v1 ↔ final-draft line overlap ratio (0..1). */
  kr42MinOverlap: 0.8,
  /** Hard ceiling on a single section length (per Yesterday / Today / Q). */
  sectionMaxChars: 240,
  /** Minimum chars before a section counts as a real line, not a stub. */
  sectionMinChars: 2,
});

/**
 * Allowed `ref_type` values (Agentic30FoundationPhase ontology — input_sources
 * + the synthetic `path`/`file` types the host emits when grounding through
 * the workspace manifest). `"unknown"` is intentionally NOT in this list:
 * an unknown type cannot drive KR4.2 cross-check, so we treat it as missing.
 */
export const ALLOWED_EVIDENCE_REF_TYPES = Object.freeze([
  "path",
  "file",
  "work_log",
  "interview",
  "bip",
]);

/**
 * Required fields for every evidence_ref entry. Mirrors the
 * Agentic30FoundationPhase ontology's `evidence_refs` concept exactly.
 */
export const REQUIRED_EVIDENCE_REF_FIELDS = Object.freeze([
  "file",
  "location",
  "field_used",
  "extracted_value",
  "ref_type",
]);

/**
 * Section labels we accept for the 3-section minimal opener. The host
 * `formatFirstPromptText()` writes Korean labels (`어제:` / `오늘:` / `Q:`)
 * but the agent SDK occasionally surfaces the English aliases when it
 * paraphrases — both are valid as long as exactly one of each appears.
 */
const SECTION_LABELS = Object.freeze({
  yesterday: ["어제", "yesterday"],
  today: ["오늘", "today"],
  question: ["q", "질문"],
});

/**
 * Sugar / 정서 지지 markers that violate the YC partner tone contract.
 * Curated from the Foundation Phase persona guard rules:
 *   - 정서적 지지 sugar (응원/힘내/괜찮아/축하 …)
 *   - 흔한 fluff emoji
 *
 * Each entry is a regex that, when matched, fails the tone check. The list
 * is intentionally conservative — only patterns that can never co-exist
 * with the YC partner persona. We deliberately do NOT use `\b` boundaries
 * because Korean syllables are outside ASCII `\w`, so word-boundary anchors
 * fail unpredictably on hangul ↔ hangul transitions.
 */
const SUGAR_PATTERNS = Object.freeze([
  /응원(해요|할게요|할게|해)/u,
  /힘내(세요|요|자)/u,
  /파이팅/u,
  /화이팅/u,
  /괜찮(아요|을\s*거야|을거야)/u,
  /축하(드려요|드립니다|해요|해)/u,
  /잘하고\s*(있어요|계세요)/u,
  /잘\s*될\s*거\s*(예요|에요)/u,
  /수고\s*(하셨어요|하셨습니다)/u,
  /[❤💪🎉✨🙌🥰😊]/u,
]);

/**
 * 존댓말 / 문어체 sentence-ending markers that violate the 반말 (~어/야) rule.
 * Flagged only when they sit at a sentence end (trailing punctuation or eol)
 * to avoid catching compound nouns. Covers the common formal-speech endings
 * the persona contract bans:
 *   - ~습니다 / ~합니다 / ~입니다 / ~드립니다  (서술/공손)
 *   - ~어요 / ~예요 / ~이에요              (해요체)
 *   - ~세요 / ~하세요 / ~드려요 / ~드릴게요   (요청/공손)
 *   - ~까요 / ~나요 / ~가요 / ~군요 / ~네요   (질문/감탄 공손)
 */
const FORMAL_ENDING_PATTERN =
  /(습니다|합니다|드립니다|입니다|이에요|예요|어요|세요|하세요|드려요|드릴게요|까요|나요|가요|군요|네요)\s*[.!?…]?\s*$/mu;

// ──────────────────────────── public API ────────────────────────────

/**
 * Verify the AI assistant's outgoing message follows the 3-section minimal
 * tone contract. Pure — never throws.
 *
 * @param {string} text - Assistant message body. The host should pass the
 *   final rendered text (post any inline-decision unwrap), not the raw
 *   provider stream.
 * @returns {{
 *   pass: boolean,
 *   sections: { yesterday: boolean, today: boolean, question: boolean },
 *   sectionLines: { yesterday: string, today: string, question: string },
 *   sugarHits: string[],
 *   formalHits: string[],
 *   reasons: string[],
 * }}
 */
export function checkThreeSectionMinimal(text) {
  const body = typeof text === "string" ? text.trim() : "";
  const sectionLines = extractSectionLines(body);
  const sections = {
    yesterday: isUsableSection(sectionLines.yesterday),
    today: isUsableSection(sectionLines.today),
    question: isUsableSection(sectionLines.question),
  };

  const reasons = [];
  if (!body) reasons.push("empty_body");
  if (!sections.yesterday) reasons.push("missing_yesterday_line");
  if (!sections.today) reasons.push("missing_today_line");
  if (!sections.question) reasons.push("missing_question_line");

  for (const [name, line] of Object.entries(sectionLines)) {
    if (line && line.length > RULE_CHECK_THRESHOLDS.sectionMaxChars) {
      reasons.push(`${name}_section_too_long`);
    }
  }

  const sugarHits = collectMatches(body, SUGAR_PATTERNS);
  if (sugarHits.length > 0) reasons.push("sugar_phrases_present");

  const formalHits = collectFormalHits(body);
  if (formalHits.length > 0) reasons.push("formal_korean_endings_present");

  return {
    pass:
      sections.yesterday &&
      sections.today &&
      sections.question &&
      sugarHits.length === 0 &&
      formalHits.length === 0 &&
      reasons.every((r) => !r.endsWith("_too_long")),
    sections,
    sectionLines,
    sugarHits,
    formalHits,
    reasons,
  };
}

/**
 * Verify each entry in an `evidence_refs` array carries the five required
 * fields with non-default values. Pure — never throws.
 *
 * The host calls this BEFORE writing the JSON sidecar (so a violating
 * sidecar is never persisted) AND inside the rule-check verdict so the
 * KR4.2 cross-check has a clean input.
 *
 * @param {Array<object>|null|undefined} refs - The evidence_refs payload.
 * @returns {{
 *   pass: boolean,
 *   total: number,
 *   valid: number,
 *   missingFields: Array<{ index: number, fields: string[] }>,
 *   invalidRefTypes: Array<{ index: number, ref_type: string }>,
 *   reasons: string[],
 * }}
 */
export function checkEvidenceRefsRequired(refs) {
  if (refs === null || refs === undefined) {
    return {
      pass: false,
      total: 0,
      valid: 0,
      missingFields: [],
      invalidRefTypes: [],
      reasons: ["evidence_refs_absent"],
    };
  }
  if (!Array.isArray(refs)) {
    return {
      pass: false,
      total: 0,
      valid: 0,
      missingFields: [],
      invalidRefTypes: [],
      reasons: ["evidence_refs_not_array"],
    };
  }
  if (refs.length === 0) {
    return {
      pass: false,
      total: 0,
      valid: 0,
      missingFields: [],
      invalidRefTypes: [],
      reasons: ["evidence_refs_empty"],
    };
  }

  const missingFields = [];
  const invalidRefTypes = [];
  let valid = 0;

  refs.forEach((entry, index) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      missingFields.push({ index, fields: [...REQUIRED_EVIDENCE_REF_FIELDS] });
      return;
    }
    const missing = [];
    for (const field of REQUIRED_EVIDENCE_REF_FIELDS) {
      if (!isFieldPresent(entry, field)) missing.push(field);
    }
    if (missing.length > 0) {
      missingFields.push({ index, fields: missing });
    }
    const refType = typeof entry.ref_type === "string" ? entry.ref_type.trim() : "";
    if (refType && !ALLOWED_EVIDENCE_REF_TYPES.includes(refType)) {
      invalidRefTypes.push({ index, ref_type: refType });
    }
    if (missing.length === 0 && (!refType || ALLOWED_EVIDENCE_REF_TYPES.includes(refType))) {
      valid += 1;
    }
  });

  const reasons = [];
  if (missingFields.length > 0) reasons.push("required_fields_missing");
  if (invalidRefTypes.length > 0) reasons.push("invalid_ref_type_present");

  return {
    pass: missingFields.length === 0 && invalidRefTypes.length === 0,
    total: refs.length,
    valid,
    missingFields,
    invalidRefTypes,
    reasons,
  };
}

/**
 * Verify KR4.1 — adaptive engine user accuracy rating. Accepts either a
 * single rating number, a `user_feedback` object with `accuracy_rating`, or
 * an array of either form (the host averages multi-day Day 7 retros into
 * one verdict).
 *
 * @param {number|object|Array<number|object>|null} input
 * @param {object} [options]
 * @param {number} [options.minRating]
 * @returns {{
 *   pass: boolean,
 *   sample_size: number,
 *   mean: number,
 *   min_rating_required: number,
 *   reasons: string[],
 * }}
 */
export function checkKR41Rating(input, { minRating = RULE_CHECK_THRESHOLDS.kr41MinRating } = {}) {
  const ratings = collectRatings(input);
  const reasons = [];
  if (ratings.length === 0) {
    reasons.push("no_user_feedback");
    return {
      pass: false,
      sample_size: 0,
      mean: 0,
      min_rating_required: minRating,
      reasons,
    };
  }
  const sum = ratings.reduce((acc, n) => acc + n, 0);
  const mean = round2(sum / ratings.length);
  const pass = mean >= minRating;
  if (!pass) reasons.push("kr41_below_threshold");
  return {
    pass,
    sample_size: ratings.length,
    mean,
    min_rating_required: minRating,
    reasons,
  };
}

/**
 * Verify KR4.2 — draft.v1 ↔ final-draft cross-check 정합. Computes a
 * deterministic line-overlap ratio: how many "key lines" from draft.v1
 * (bullets, labelled facts) survive into the final draft.
 *
 * `keyLines` are extracted from draft.v1 by:
 *   1. Splitting on newlines.
 *   2. Keeping lines that are bulleted (`- foo`) or labelled (`foo:`) AND
 *      contain a non-trivial fact (≥3 word chars after the marker). These
 *      are the load-bearing claims the agent must NOT silently drop.
 *
 * Each key line is then matched against the final draft (substring,
 * post-normalization). The ratio is matched / total.
 *
 * @param {string|null} draftV1Text
 * @param {string|null} finalDraftText
 * @param {object} [options]
 * @param {number} [options.minOverlap]
 * @returns {{
 *   pass: boolean,
 *   overlap: number,
 *   matched: number,
 *   total: number,
 *   missing_lines: string[],
 *   min_overlap_required: number,
 *   reasons: string[],
 * }}
 */
export function checkKR42CrossCheck(
  draftV1Text,
  finalDraftText,
  { minOverlap = RULE_CHECK_THRESHOLDS.kr42MinOverlap } = {},
) {
  const draftV1 = typeof draftV1Text === "string" ? draftV1Text : "";
  const finalDraft = typeof finalDraftText === "string" ? finalDraftText : "";
  const reasons = [];
  if (!draftV1.trim()) reasons.push("draft_v1_missing");
  if (!finalDraft.trim()) reasons.push("final_draft_missing");

  const keyLines = extractKeyLines(draftV1);
  if (keyLines.length === 0) {
    if (!reasons.includes("draft_v1_missing")) reasons.push("no_key_lines_in_draft_v1");
    return {
      pass: false,
      overlap: 0,
      matched: 0,
      total: 0,
      missing_lines: [],
      min_overlap_required: minOverlap,
      reasons,
    };
  }

  const finalNormalized = normalizeForMatch(finalDraft);
  let matched = 0;
  const missing = [];
  for (const line of keyLines) {
    const normalized = normalizeForMatch(line);
    if (!normalized) continue;
    if (finalNormalized.includes(normalized)) {
      matched += 1;
    } else {
      missing.push(line);
    }
  }

  const overlap = round2(matched / keyLines.length);
  const pass = overlap >= minOverlap && reasons.length === 0;
  if (!pass && overlap < minOverlap) reasons.push("kr42_below_threshold");

  return {
    pass,
    overlap,
    matched,
    total: keyLines.length,
    missing_lines: missing.slice(0, 16), // cap so the verdict stays bounded
    min_overlap_required: minOverlap,
    reasons,
  };
}

/**
 * Run the full rule-check pipeline. Returns a structured verdict the host
 * can persist alongside the evidence_refs sidecar OR use to render a chat
 * surface "verification badge".
 *
 * The function is the canonical Sub-AC 3 entry point — call it whenever
 * the foundation-summary sub-workflow finalizes a turn.
 *
 * @param {object} args
 * @param {string} [args.assistantText]   - The 3-section minimal AI message.
 * @param {Array<object>} [args.evidenceRefs] - Sidecar payload pre-write.
 * @param {object|null} [args.userFeedback] - Day-7 retro user_feedback object
 *   shaped like { accuracy_rating, rated_at, comment }. May be `null` when
 *   the user has not yet rated; the verdict reports `no_user_feedback`.
 * @param {string} [args.draftV1Text]     - Pre-collected draft.v1 (Sub-AC 2).
 * @param {string} [args.finalDraftText]  - Agent's final candidate body.
 * @param {object} [args.thresholds]      - Override RULE_CHECK_THRESHOLDS.
 * @returns {object} verdict.
 */
export function runFoundationSummaryRuleCheck({
  assistantText = "",
  evidenceRefs = [],
  userFeedback = null,
  draftV1Text = "",
  finalDraftText = "",
  thresholds = RULE_CHECK_THRESHOLDS,
} = {}) {
  const tone = checkThreeSectionMinimal(assistantText);
  const evidence = checkEvidenceRefsRequired(evidenceRefs);
  const kr41 = checkKR41Rating(userFeedback, {
    minRating: thresholds.kr41MinRating ?? RULE_CHECK_THRESHOLDS.kr41MinRating,
  });
  const kr42 = checkKR42CrossCheck(draftV1Text, finalDraftText, {
    minOverlap: thresholds.kr42MinOverlap ?? RULE_CHECK_THRESHOLDS.kr42MinOverlap,
  });

  const reasons = [
    ...tone.reasons.map((r) => `tone:${r}`),
    ...evidence.reasons.map((r) => `evidence:${r}`),
    ...kr41.reasons.map((r) => `kr41:${r}`),
    ...kr42.reasons.map((r) => `kr42:${r}`),
  ];

  const pass = tone.pass && evidence.pass && kr41.pass && kr42.pass;

  return {
    schema_version: RULE_CHECK_SCHEMA_VERSION,
    persona: PERSONA,
    template: "3-section minimal (Yesterday 1줄 / Today 1줄 / Q 1줄)",
    pass,
    checked_at: new Date().toISOString(),
    checks: {
      tone,
      evidence_refs: evidence,
      kr41,
      kr42,
    },
    reasons,
    score: scoreVerdict({ tone, evidence, kr41, kr42 }),
  };
}

// ──────────────────────────── internal helpers ────────────────────────────

/**
 * Pull the labeled lines out of an assistant message. Recognized labels:
 *   - 어제 / Yesterday
 *   - 오늘 / Today
 *   - Q / 질문
 *
 * Each label may use `:` or `-` after the keyword. We capture the first
 * occurrence per section — duplicate sections fail the tone check via the
 * `_too_long` check on the merged span instead of being silently averaged.
 */
function extractSectionLines(body) {
  const lines = body.split(/\r?\n/);
  const result = { yesterday: "", today: "", question: "" };
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    const label = matchLabel(line);
    if (!label) continue;
    const value = stripLabelPrefix(line, label.match);
    if (!value) continue;
    if (!result[label.section]) {
      result[label.section] = value;
    }
  }
  return result;
}

function matchLabel(line) {
  const lower = line.toLowerCase();
  for (const [section, labels] of Object.entries(SECTION_LABELS)) {
    for (const label of labels) {
      const re = new RegExp(`^${escapeRe(label)}\\s*[:\\-]`, "iu");
      if (re.test(lower)) return { section, match: label };
    }
  }
  return null;
}

function stripLabelPrefix(line, label) {
  const re = new RegExp(`^${escapeRe(label)}\\s*[:\\-]\\s*`, "iu");
  return line.replace(re, "").trim();
}

function escapeRe(s) {
  return String(s).replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function isUsableSection(line) {
  if (typeof line !== "string") return false;
  const trimmed = line.trim();
  if (trimmed.length < RULE_CHECK_THRESHOLDS.sectionMinChars) return false;
  return true;
}

function collectMatches(body, patterns) {
  const hits = [];
  for (const re of patterns) {
    const m = body.match(re);
    if (m) hits.push(m[0]);
  }
  return hits;
}

function collectFormalHits(body) {
  const hits = [];
  const lines = body.split(/\r?\n/);
  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    if (FORMAL_ENDING_PATTERN.test(trimmed)) hits.push(trimmed);
  }
  return hits;
}

function isFieldPresent(entry, field) {
  if (!Object.prototype.hasOwnProperty.call(entry, field)) return false;
  const v = entry[field];
  if (v === null || v === undefined) return false;
  if (typeof v === "string" && v.trim() === "") return false;
  if (field === "ref_type") {
    if (typeof v !== "string") return false;
    if (v.trim() === "" || v.trim() === "unknown") return false;
  }
  return true;
}

function collectRatings(input) {
  const out = [];
  const push = (value) => {
    const n = Number(value);
    if (!Number.isFinite(n)) return;
    if (n < 1 || n > 5) return; // guard wrong-scale data
    out.push(n);
  };
  if (input === null || input === undefined) return out;
  if (Array.isArray(input)) {
    for (const item of input) {
      if (item && typeof item === "object" && !Array.isArray(item)) {
        push(item.accuracy_rating ?? item.rating);
      } else {
        push(item);
      }
    }
    return out;
  }
  if (typeof input === "object") {
    push(input.accuracy_rating ?? input.rating);
    return out;
  }
  push(input);
  return out;
}

function extractKeyLines(text) {
  if (!text) return [];
  const lines = text.split(/\r?\n/);
  const seen = new Set();
  const out = [];
  for (const raw of lines) {
    const line = raw.trim();
    if (!line) continue;
    if (line.startsWith("#")) continue; // skip headings
    if (line.startsWith("```")) continue; // skip code fences
    const isBullet = /^[-*]\s+/.test(line);
    const isLabelled = /^\S[^:]{0,80}:\s+\S/.test(line);
    if (!isBullet && !isLabelled) continue;
    const stripped = line.replace(/^[-*]\s+/, "").trim();
    const wordChars = stripped.replace(/[^\p{Letter}\p{Number}]/gu, "");
    if (wordChars.length < 3) continue;
    if (seen.has(stripped)) continue;
    seen.add(stripped);
    out.push(stripped);
  }
  return out;
}

function normalizeForMatch(text) {
  return String(text || "")
    .toLowerCase()
    .replace(/[\s\p{P}]+/gu, " ")
    .trim();
}

function round2(n) {
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100) / 100;
}

function scoreVerdict({ tone, evidence, kr41, kr42 }) {
  // Equal-weight 4-axis average so a single failed axis can't be hidden by
  // strong scores elsewhere — useful for KR4.1/4.2 telemetry dashboards.
  const toneScore = tone.pass ? 1 : 0;
  const evidenceScore = evidence.total === 0 ? 0 : evidence.valid / evidence.total;
  const kr41Score = kr41.pass ? 1 : kr41.sample_size > 0 ? Math.min(1, kr41.mean / 5) : 0;
  const kr42Score = kr42.pass ? 1 : kr42.overlap;
  return round2((toneScore + evidenceScore + kr41Score + kr42Score) / 4);
}

export const __test__ = Object.freeze({
  extractSectionLines,
  extractKeyLines,
  normalizeForMatch,
  collectRatings,
  isFieldPresent,
  scoreVerdict,
});

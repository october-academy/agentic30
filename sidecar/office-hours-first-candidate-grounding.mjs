// SINGLE SOURCE OF TRUTH for the deterministic "first_candidate is a generic
// sourcing category, not a grounded reachable candidate" matcher.
//
// Two independent consumers MUST agree byte-for-byte on this classification:
//   - the grounding-invariants harness (sidecar-evals/grounding-invariants.mjs,
//     Deliverable A) computes first_candidate_generic_only / forces_specificity
//     over captured cards.
//   - the host validator (Deliverable B) rejects + regenerates (then falls back to
//     a deterministic host-authored card) when the model emits a generic-only
//     first_candidate card and no `## Verified Candidate Hints` were injected.
// Both import THIS module so the regex/heuristic lives once. Do not duplicate it.
//
// Substrate reality (confirmed): agent-work-history events carry no person /
// handle / counterparty field, so verified candidate hints are ~always EMPTY in
// this architecture. The honest first_candidate card therefore forces the founder
// to NAME an exact reachable person/handle/thread/source in free text (or pick a
// grounded hint option once extraction exists), never to pick a generic sourcing
// bucket like "지인 / 커뮤니티 / 비슷한 사람". This module encodes "generic bucket"
// vs "grounded/specific" deterministically — no LLM, no I/O. Pure, conservative.

// Generic sourcing-CATEGORY phrases: an option whose label is one of these "where
// could I find someone" buckets carries NO specific identity. Conservative on
// purpose — only flag wording that is unmistakably a category, so a card that
// already names a real person/handle or instructs the user to type one is never
// false-rejected. Each entry is matched as a substring of the normalized label.
const GENERIC_SOURCING_CATEGORY_PATTERNS = Object.freeze([
  "지인", // acquaintance (bucket)
  "소개", // referral/intro (bucket)
  "커뮤니티", // community
  "모임", // meetup/group
  "채널", // channel
  "세그먼트", // segment
  "비슷한 사람", // "similar people"
  "비슷한 분", // "similar folks"
  "연락 가능한 사람", // "people you can contact" (bucket, not a named person)
  "찾을 경로", // "a path to find ..."
  "찾는 경로", // "the path that finds ..."
  "어디서 찾", // "where to find ..."
  "어디에서 찾", // "where to find ..."
  "어디서 잡", // "where to grab ..."
  "어디에서 잡", // "where to grab ..."
  "후보 찾기", // "candidate-finding"
  "where to find",
  "find a candidate",
  "find candidates",
]);

// The single explicit "no candidate yet" blocker. The honest card must carry
// EXACTLY one of these so a founder with no reachable candidate can route to an
// acquisition branch instead of being forced to fabricate a name.
const NO_CANDIDATE_BLOCKER_PATTERNS = Object.freeze([
  "아직 후보 없음",
  "후보 없음",
  "후보 이름 없음",
  "아직 후보가 없",
  "no candidate yet",
]);

// Specific-identity signals: tokens that mark an option (or its free-text
// placeholder) as carrying a CONCRETE reachable identity, not a category. An
// @handle, a 실명(real-name) instruction, a concrete thread/DM, or an explicit
// "type the exact person" instruction all count. Used to (a) recognize a grounded
// option and (b) detect that a card forces the founder to capture a specific name.
const SPECIFIC_IDENTITY_PATTERNS = Object.freeze([
  "@", // handle
  "실명", // real name
  "핸들", // handle (Korean)
  "이름·핸들", // "name·handle"
  "이름/핸들", // "name/handle"
  "스레드", // thread
  "쓰레드", // thread (alt spelling)
  "dm", // direct message
  "디엠", // DM (Korean)
  "오늘 연락", // "contact today"
  "오늘 실제로 연락", // "actually contact today"
  "바로 연락할", // "contact right now"
]);

export function normalizeFirstCandidateLabel(label = "") {
  return String(label || "")
    .replace(/\s+/g, " ")
    .toLowerCase()
    .trim();
}

/** True iff the label is the explicit "no candidate yet" blocker. */
export function isNoCandidateBlockerLabel(label = "") {
  const normalized = normalizeFirstCandidateLabel(label);
  if (!normalized) return false;
  return NO_CANDIDATE_BLOCKER_PATTERNS.some((p) => normalized.includes(p.toLowerCase()));
}

/** True iff the text carries a concrete reachable identity (@handle, 실명, thread, DM, ...). */
export function carriesSpecificIdentity(text = "") {
  const normalized = normalizeFirstCandidateLabel(text);
  if (!normalized) return false;
  return SPECIFIC_IDENTITY_PATTERNS.some((p) => normalized.includes(p.toLowerCase()));
}

/**
 * Deterministic generic-category test for ONE non-blocker option label. TRUE
 * (generic, bad) when the label matches a generic sourcing-category pattern AND
 * carries no specific identity (no @handle / 실명 / thread / DM). Conservative: a
 * label that names a concrete identity is never generic even if it also contains a
 * bucket word. Blocker labels are never "generic" (they are the legal escape).
 */
export function isGenericSourcingOptionLabel(label = "") {
  const normalized = normalizeFirstCandidateLabel(label);
  if (!normalized) return false;
  if (isNoCandidateBlockerLabel(normalized)) return false;
  if (carriesSpecificIdentity(normalized)) return false;
  return GENERIC_SOURCING_CATEGORY_PATTERNS.some((p) => normalized.includes(p.toLowerCase()));
}

/** A grounded option carries an exact hint id (candidateHintId / candidateId). */
export function optionCarriesCandidateHint(option = {}) {
  if (!option || typeof option !== "object") return false;
  const hintId = String(
    option.candidateHintId
      || option.candidate_hint_id
      || option.candidateId
      || option.candidate_id
      || "",
  ).trim();
  return Boolean(hintId);
}

/**
 * Classify a first_candidate card (the single question object: { options,
 * allowFreeText, freeTextPlaceholder, requiresFreeText, ... }). Pure; returns:
 *   {
 *     genericOnly,        // bad: all non-blocker options are generic categories
 *                         //      AND the card does not force a specific capture.
 *     forcesSpecificity,  // good: grounded hint options OR a free-text capture
 *                         //       of an exact person/handle/thread.
 *     blockerCount,       // # of explicit "no candidate yet" blocker options.
 *     nonBlockerCount,    // # of non-blocker options.
 *     genericNonBlockerCount,
 *     groundedHintCount,  // # of options carrying a candidateHintId.
 *   }
 *
 * "force a specific capture" via free text = the card allows free text AND its
 * placeholder/question/option labels instruct the founder to name an exact
 * person/handle/thread (carriesSpecificIdentity). allowFreeText alone is NOT
 * enough — every office-hours card allows free text — so a generic-bucket card
 * does not get a free pass just for having the escape hatch.
 */
export function classifyFirstCandidateCard(question = {}) {
  const q = question && typeof question === "object" ? question : {};
  const options = Array.isArray(q.options) ? q.options : [];
  const blockerOptions = options.filter((o) => isNoCandidateBlockerLabel(o?.label));
  const nonBlockerOptions = options.filter((o) => !isNoCandidateBlockerLabel(o?.label));
  const genericNonBlocker = nonBlockerOptions.filter((o) => isGenericSourcingOptionLabel(o?.label));
  const groundedHintOptions = nonBlockerOptions.filter((o) => optionCarriesCandidateHint(o));

  const allowsFreeText = q.allowFreeText === true;
  // A free-text capture FORCES specificity only when the card visibly asks for an
  // exact identity (placeholder / question / a non-blocker option label says so).
  const captureText = [
    q.freeTextPlaceholder,
    q.free_text_placeholder,
    q.question,
    ...nonBlockerOptions.map((o) => o?.label),
    ...nonBlockerOptions.map((o) => o?.description),
  ]
    .filter(Boolean)
    .join("\n");
  const forcesNamedCapture = allowsFreeText && carriesSpecificIdentity(captureText);

  const hasGroundedHints = groundedHintOptions.length > 0;
  const allNonBlockerGeneric =
    nonBlockerOptions.length > 0 && genericNonBlocker.length === nonBlockerOptions.length;

  // forcesSpecificity (good): grounded hint options OR a named free-text capture.
  const forcesSpecificity = hasGroundedHints || forcesNamedCapture;
  // genericOnly (bad): every non-blocker option is a generic bucket AND the card
  // does not otherwise force a specific capture (no grounded hint, no named
  // free-text). A card that forces a named capture is never "generic-only".
  const genericOnly = allNonBlockerGeneric && !forcesSpecificity;

  return {
    genericOnly,
    forcesSpecificity,
    blockerCount: blockerOptions.length,
    nonBlockerCount: nonBlockerOptions.length,
    genericNonBlockerCount: genericNonBlocker.length,
    groundedHintCount: groundedHintOptions.length,
  };
}

export const FIRST_CANDIDATE_GENERIC_SOURCING_PATTERNS = GENERIC_SOURCING_CATEGORY_PATTERNS;
export const FIRST_CANDIDATE_NO_CANDIDATE_BLOCKER_PATTERNS = NO_CANDIDATE_BLOCKER_PATTERNS;
export const FIRST_CANDIDATE_SPECIFIC_IDENTITY_PATTERNS = SPECIFIC_IDENTITY_PATTERNS;

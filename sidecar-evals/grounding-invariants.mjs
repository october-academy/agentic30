// Deterministic grounding invariants over a captured Office Hours run.
//
// GPT-5.5 Pro: the LLM judge variance (σ~1.0) cannot distinguish <0.5 changes, so
// it cannot reliably prove the first_candidate grounding fix. This module is the
// low-noise instrument: pure boolean/rate checks over the structured cards + their
// options (NO LLM), computed per run. It is the PRIMARY signal; the judge stays
// secondary.
//
// Shares the generic-category matcher with the host validator (Deliverable B) via
// sidecar/office-hours-first-candidate-grounding.mjs — the classification is
// byte-for-byte identical on both sides (the spec's hard requirement). This module
// adds only the per-run aggregation over `captured.days[].questions`.
//
// Pure: no I/O. Input is the `captured` object real-project-arc.mjs writes
// (captured.days[].questions[] = { signalId, header, question, options[], allowFreeText, ... }).

import {
  classifyFirstCandidateCard,
  isNoCandidateBlockerLabel,
  carriesSpecificIdentity,
  isGenericSourcingOptionLabel,
} from "../sidecar/office-hours-first-candidate-grounding.mjs";

const FIRST_CANDIDATE_SIGNAL_IDS = Object.freeze(new Set([
  "get_users_first_candidate",
  "office_hours_get_users_first_candidate",
]));

const LADDER_TODAY_REQUEST_SIGNALS = Object.freeze(new Set([
  "get_users_today_request",
  "office_hours_get_users_today_request",
  "get_users_evidence_format",
  "office_hours_get_users_evidence_format",
  "get_users_day1_commitment",
  "office_hours_get_users_day1_commitment",
]));

function normalizeSignalId(card = {}) {
  return String(card?.signalId || card?.generation?.signalId || "").trim();
}

function isFirstCandidateCard(card = {}) {
  return FIRST_CANDIDATE_SIGNAL_IDS.has(normalizeSignalId(card));
}

function allCards(captured = {}) {
  const days = Array.isArray(captured?.days) ? captured.days : [];
  return days.flatMap((d) => (Array.isArray(d?.questions) ? d.questions : []));
}

// A proper name / handle presented as a real candidate. Heuristic + conservative:
// an @handle, or a label/description that carries a specific-identity token. Used
// ONLY for the thin-context "no fabricated names" check, which asks whether a name
// appears when no hints were injected — so we look for the @handle or an explicit
// 실명/핸들 token that the model invented rather than captured from the user.
function optionLooksLikeFabricatedName(option = {}) {
  const label = String(option?.label || "");
  const description = String(option?.description || "");
  // An @handle in the visible label is the clearest fabricated-identity tell.
  if (/@[\w.\-가-힣]{2,}/.test(label) || /@[\w.\-가-힣]{2,}/.test(description)) return true;
  return false;
}

// Pull a short candidate token captured at card 2 (free-text answer, else the
// non-blocker selected option label). Best-effort: used only for the 4-6 reference
// rate. We do not have the user's submitted free text in `captured.questions` (the
// harness records the card, not the answer), so we approximate with the card's
// recommended/first non-blocker option label when present.
function capturedCandidateToken(firstCandidateCard = {}) {
  const options = Array.isArray(firstCandidateCard?.options) ? firstCandidateCard.options : [];
  const nonBlocker = options.filter((o) => !isNoCandidateBlockerLabel(o?.label));
  const named = nonBlocker.find((o) => carriesSpecificIdentity(o?.label));
  const token = String((named || nonBlocker[0])?.label || "").trim();
  return token;
}

/**
 * Compute the deterministic grounding invariants for one captured run.
 * Returns a flat object of booleans/rates (all derivable from the cards):
 *   first_candidate_present
 *   first_candidate_generic_only      (bad → TRUE)
 *   first_candidate_forces_specificity(good → TRUE)
 *   first_candidate_has_blocker       (exactly one explicit no-candidate blocker)
 *   thin_context_no_fabricated_names
 *   candidate_ref_consistency_4_6     (rate 0..1)
 * Plus diagnostic counts under `_detail` for reporting.
 */
export function computeGroundingInvariants(captured = {}) {
  const cards = allCards(captured);
  const firstCandidateCards = cards.filter(isFirstCandidateCard);
  const firstCandidateCard = firstCandidateCards[0] || null;

  const firstCandidatePresent = Boolean(firstCandidateCard);
  const classification = firstCandidateCard
    ? classifyFirstCandidateCard(firstCandidateCard)
    : null;

  const firstCandidateGenericOnly = classification ? classification.genericOnly : false;
  const firstCandidateForcesSpecificity = classification ? classification.forcesSpecificity : false;
  const firstCandidateHasBlocker = classification ? classification.blockerCount === 1 : false;

  // thin_context_no_fabricated_names: when NO `## Verified Candidate Hints` were
  // injected, no option label should present a fabricated proper name/@handle as a
  // real candidate. We detect injection via the captured flag the harness records;
  // when unknown, treat as thin (the conservative case for this product).
  const hintsInjected = captured?.verifiedCandidateHintsInjected === true;
  const thinContext = !hintsInjected;
  const fabricatedName = firstCandidateCards.some((card) => {
    const options = Array.isArray(card?.options) ? card.options : [];
    return options.some((o) => !isNoCandidateBlockerLabel(o?.label) && optionLooksLikeFabricatedName(o));
  });
  const thinContextNoFabricatedNames = thinContext ? !fabricatedName : true;

  // candidate_ref_consistency_4_6: the candidate token captured at card 2 should be
  // referenced in cards 4-6 rather than reintroduced generically. Best-effort string
  // presence; reported as a rate over the later cards that exist.
  const candidateToken = firstCandidateCard ? capturedCandidateToken(firstCandidateCard) : "";
  const laterCards = cards.filter((c) => LADDER_TODAY_REQUEST_SIGNALS.has(normalizeSignalId(c)));
  let consistencyHits = 0;
  if (candidateToken) {
    for (const card of laterCards) {
      const text = [
        card?.question,
        card?.header,
        ...(Array.isArray(card?.options) ? card.options.map((o) => `${o?.label || ""} ${o?.description || ""}`) : []),
      ].join("\n");
      if (text.includes(candidateToken)) consistencyHits += 1;
    }
  }
  const candidateRefConsistency46 = laterCards.length
    ? Number((consistencyHits / laterCards.length).toFixed(3))
    : 0;

  return {
    first_candidate_present: firstCandidatePresent,
    first_candidate_generic_only: firstCandidateGenericOnly,
    first_candidate_forces_specificity: firstCandidateForcesSpecificity,
    first_candidate_has_blocker: firstCandidateHasBlocker,
    thin_context_no_fabricated_names: thinContextNoFabricatedNames,
    candidate_ref_consistency_4_6: candidateRefConsistency46,
    _detail: {
      firstCandidateCardCount: firstCandidateCards.length,
      hintsInjected,
      candidateToken,
      laterCardCount: laterCards.length,
      consistencyHits,
      nonBlockerCount: classification?.nonBlockerCount ?? 0,
      genericNonBlockerCount: classification?.genericNonBlockerCount ?? 0,
      groundedHintCount: classification?.groundedHintCount ?? 0,
      firstCandidateOptions: firstCandidateCard
        ? (Array.isArray(firstCandidateCard.options) ? firstCandidateCard.options.map((o) => String(o?.label || "")) : [])
        : [],
    },
  };
}

/**
 * Summarize per-project invariants into a cycle-level rollup: for each boolean
 * invariant, whether ALL projects pass; for rates, the mean. Pure.
 */
export function summarizeGroundingInvariants(perProject = []) {
  const list = Array.isArray(perProject) ? perProject.filter(Boolean) : [];
  const booleanKeys = [
    "first_candidate_present",
    "first_candidate_generic_only",
    "first_candidate_forces_specificity",
    "first_candidate_has_blocker",
    "thin_context_no_fabricated_names",
  ];
  const rateKeys = ["candidate_ref_consistency_4_6"];
  const summary = { projectCount: list.length };
  for (const key of booleanKeys) {
    const values = list.map((p) => p?.invariants?.[key]);
    summary[`${key}_all`] = values.length > 0 && values.every((v) => v === true);
    summary[`${key}_any`] = values.some((v) => v === true);
  }
  for (const key of rateKeys) {
    const values = list.map((p) => p?.invariants?.[key]).filter((n) => typeof n === "number");
    summary[`${key}_mean`] = values.length
      ? Number((values.reduce((a, b) => a + b, 0) / values.length).toFixed(3))
      : null;
  }
  return summary;
}

export { isGenericSourcingOptionLabel };

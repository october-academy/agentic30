/**
 * monetization-ask 4-turn chat state machine (Foundation Day 6).
 *
 * Sub-AC 2: Owns the state machine that drives the user through the 4-turn
 * sequence defined in monetization-ask-prompt.mjs:
 *
 *     target  →  draft  →  sent  →  response
 *
 * Responsibilities (state-machine only — NO UI, NO provider IO):
 *  1. Persist the current turn cursor on session.runtime.foundation.monetizationAsk.
 *  2. Capture each user response per turn (verbatim + best-effort dynamic_variables).
 *  3. Evaluate transition.requires / transition.rejects to decide advance vs pushback.
 *  4. Aggregate captures across turns so Day-7 foundation-summary can read them.
 *  5. Mark terminal completion (response turn) so the dispatcher can write
 *     monetization-ask-result.md and signal foundation-summary.
 *
 * Pure module: no fs / network / time-of-day side effects beyond the injected
 * `now` clock. Safe to unit-test deterministically.
 *
 * Integration contract (with foundation-chat dispatcher):
 *   const state = ensureMonetizationAskState(session.runtime?.foundation?.monetizationAsk);
 *   // before showing the next AI prompt, render turn = state.turn
 *   // after the user replies, evaluate advance:
 *   const result = applyUserTurnResponse(state, { userResponse, captures, now });
 *   session.runtime.foundation.monetizationAsk = result.state;
 *   if (result.advanced && result.isTerminal) {  await writeArtifact(...) }
 *   if (!result.advanced) {  // render pushback prompt for same turn
 *     const pushback = formatPushbackForTurn(result);
 *   }
 */

import {
  MONETIZATION_ASK_TURNS,
  MONETIZATION_ASK_META,
  getMonetizationAskTurn,
  getInitialMonetizationAskTurn,
} from "./monetization-ask-prompt.mjs";

/** Stable id for the workflow on session runtime. */
export const MONETIZATION_ASK_RUNTIME_KEY = "monetizationAsk";

/** Cap stored verbatim user responses to avoid runaway session bloat. */
const MAX_USER_RESPONSE_CHARS = 4000;

/**
 * Schema version for the state object — bumped when the persisted shape
 * changes incompatibly. session-store can use this for migrations.
 */
export const MONETIZATION_ASK_STATE_SCHEMA_VERSION = 1;

/**
 * Build the initial state for a freshly entered monetization-ask sub-workflow.
 * The cursor starts at the first turn ("target"). No history yet.
 */
export function createInitialMonetizationAskState({ now = () => new Date() } = {}) {
  const initial = getInitialMonetizationAskTurn();
  return {
    schemaVersion: MONETIZATION_ASK_STATE_SCHEMA_VERSION,
    workflow: MONETIZATION_ASK_META.name,
    day: MONETIZATION_ASK_META.day,
    turn: initial.id,
    startedAt: nowIso(now),
    turnHistory: [],
    capturesAggregate: {},
    attemptCount: 0,
    lastPushbackReason: null,
    completedAt: null,
  };
}

/**
 * Normalize a possibly-stale state object loaded from session storage.
 * Returns a fresh initial state when the input is missing/corrupt.
 */
export function ensureMonetizationAskState(input, { now = () => new Date() } = {}) {
  if (!input || typeof input !== "object") {
    return createInitialMonetizationAskState({ now });
  }
  const turn = getMonetizationAskTurn(input.turn) ? input.turn : getInitialMonetizationAskTurn().id;
  return {
    schemaVersion: MONETIZATION_ASK_STATE_SCHEMA_VERSION,
    workflow: MONETIZATION_ASK_META.name,
    day: MONETIZATION_ASK_META.day,
    turn,
    startedAt: typeof input.startedAt === "string" ? input.startedAt : nowIso(now),
    turnHistory: Array.isArray(input.turnHistory) ? input.turnHistory.slice() : [],
    capturesAggregate:
      input.capturesAggregate && typeof input.capturesAggregate === "object"
        ? { ...input.capturesAggregate }
        : {},
    attemptCount: Number.isFinite(input.attemptCount) ? Math.max(0, Math.trunc(input.attemptCount)) : 0,
    lastPushbackReason: typeof input.lastPushbackReason === "string" ? input.lastPushbackReason : null,
    completedAt: typeof input.completedAt === "string" ? input.completedAt : null,
  };
}

/** True when the workflow's terminal turn (`response`) has been closed. */
export function isMonetizationAskComplete(state) {
  return Boolean(state?.completedAt);
}

/** Look up the turn descriptor that the cursor currently points at. */
export function getCurrentTurn(state) {
  return getMonetizationAskTurn(state?.turn) || getInitialMonetizationAskTurn();
}

/**
 * Evaluate whether a user response satisfies the current turn's
 * `transition.requires` and dodges all `transition.rejects`. Pure function:
 * returns the evaluation but does NOT mutate state.
 *
 * `captures` may be supplied by an upstream extractor (AI or structured form).
 * When a capture is present, it overrides the text-heuristic for that key —
 * captures are the source of truth, heuristics are the fallback.
 *
 * Output:
 *   {
 *     turnId,
 *     canAdvance: boolean,
 *     missing: string[],           // requires that failed
 *     rejects: string[],           // rejects that triggered
 *     presence: Record<string,boolean>,
 *     pushback: string|null,       // localized pushback hint
 *   }
 */
export function evaluateTurnResponse(turnId, userResponse, captures = {}) {
  const turn = getMonetizationAskTurn(turnId);
  const text = String(userResponse || "");
  const safeCaptures = sanitizeCaptures(captures);

  if (!turn) {
    return {
      turnId,
      canAdvance: false,
      missing: [],
      rejects: [],
      presence: {},
      pushback: "이 턴은 정의되지 않았어. 처음부터 다시 시작해.",
    };
  }

  const requires = turn.transition?.requires || [];
  const rejectsAll = turn.transition?.rejects || [];

  const presence = computePresenceForTurn(turnId, text, safeCaptures);
  const missing = requires.filter((req) => !presence[req]);
  const rejectsHit = rejectsAll.filter((rejectKey) =>
    detectsRejectForTurn(turnId, rejectKey, text, safeCaptures, presence),
  );

  const canAdvance = missing.length === 0 && rejectsHit.length === 0;
  let pushback = null;
  if (!canAdvance) {
    const tpl = turn.transition?.pushback_template || "다시 답해.";
    const missingLabel = missing.length ? missing.join(", ") : "없음";
    pushback = tpl.replace("{missing}", missingLabel);
  }

  return {
    turnId,
    canAdvance,
    missing,
    rejects: rejectsHit,
    presence,
    pushback,
  };
}

/**
 * Apply a user response to the state machine. This is the ONE write entrypoint:
 *  - On success: closes the current turn, appends history, advances cursor,
 *    aggregates captures, resets attemptCount.
 *  - On failure: increments attemptCount, sets lastPushbackReason, leaves
 *    cursor on the same turn so the dispatcher can re-prompt.
 *
 * Returns:
 *   {
 *     state,            // NEW state (caller writes back to session.runtime.*)
 *     advanced,         // boolean — did the cursor move forward?
 *     isTerminal,       // boolean — did we close the workflow?
 *     turnIdBefore,     // turn id at function entry
 *     turnIdAfter,      // turn id after applying transition
 *     evaluation,       // full evaluation result (presence/missing/rejects)
 *     pushback,         // string|null — pushback hint when advanced=false
 *     attemptCount,     // attempts at the (now current or just-closed) turn
 *   }
 */
export function applyUserTurnResponse(
  inputState,
  { userResponse = "", captures = {}, now = () => new Date() } = {},
) {
  const state = ensureMonetizationAskState(inputState, { now });
  const turnIdBefore = state.turn;

  // Already terminal — never accept more responses.
  if (isMonetizationAskComplete(state)) {
    return {
      state,
      advanced: false,
      isTerminal: true,
      turnIdBefore,
      turnIdAfter: state.turn,
      evaluation: null,
      pushback: null,
      attemptCount: state.attemptCount || 0,
      reason: "already_complete",
    };
  }

  const evaluation = evaluateTurnResponse(state.turn, userResponse, captures);
  const trimmedResponse = String(userResponse || "").slice(0, MAX_USER_RESPONSE_CHARS);
  const attemptCount = (state.attemptCount || 0) + 1;
  const safeCaptures = sanitizeCaptures(captures);

  if (!evaluation.canAdvance) {
    const reason =
      evaluation.rejects[0]
      || (evaluation.missing[0] ? `missing:${evaluation.missing[0]}` : "incomplete");
    return {
      state: {
        ...state,
        attemptCount,
        lastPushbackReason: reason,
      },
      advanced: false,
      isTerminal: false,
      turnIdBefore,
      turnIdAfter: state.turn,
      evaluation,
      pushback: evaluation.pushback,
      attemptCount,
      reason,
    };
  }

  const turn = getCurrentTurn(state);
  const isTerminal = !turn.transition?.next;
  const turnIdAfter = isTerminal ? state.turn : turn.transition.next;

  const closure = {
    id: state.turn,
    order: turn.order,
    userResponse: trimmedResponse,
    captures: safeCaptures,
    transition: "advanced",
    transitionedAt: nowIso(now),
    attemptCount,
    presence: evaluation.presence,
  };
  const turnHistory = [...(state.turnHistory || []), closure];
  const capturesAggregate = mergeCaptures(state.capturesAggregate || {}, safeCaptures);

  const nextState = {
    ...state,
    turn: turnIdAfter,
    turnHistory,
    capturesAggregate,
    // attemptCount resets to 0 when entering a new turn; on terminal closure
    // we preserve the attempt count for telemetry (KR4.1/4.2 difficulty signal).
    attemptCount: isTerminal ? attemptCount : 0,
    lastPushbackReason: null,
    completedAt: isTerminal ? nowIso(now) : null,
  };

  return {
    state: nextState,
    advanced: true,
    isTerminal,
    turnIdBefore,
    turnIdAfter,
    evaluation,
    pushback: null,
    attemptCount,
    reason: isTerminal ? "completed" : "advanced",
  };
}

/**
 * Reset the state machine back to the initial turn (`target`) while preserving
 * `startedAt` (so the originating session timestamp survives). Used when the
 * dispatcher decides to abandon a partial run, e.g. after a Codex error or an
 * explicit "restart Day 6" command from the UI.
 */
export function resetMonetizationAskState(state, { now = () => new Date() } = {}) {
  const baseStartedAt = typeof state?.startedAt === "string" ? state.startedAt : nowIso(now);
  return {
    ...createInitialMonetizationAskState({ now }),
    startedAt: baseStartedAt,
  };
}

/* ------------------------------------------------------------------------ */
/*  Internal: per-turn presence + reject detection                           */
/* ------------------------------------------------------------------------ */

function computePresenceForTurn(turnId, text, captures) {
  switch (turnId) {
    case "target":
      return {
        named_individual_present:
          hasCaptureValue(captures.target_name) || hasNamedIndividual(text),
        role_or_company_present:
          hasCaptureValue(captures.target_role)
          || hasCaptureValue(captures.target_context)
          || hasRoleOrCompany(text),
        why_this_person_specific:
          hasCaptureValue(captures.why_this_person) || hasWhySpecific(text),
      };
    case "draft":
      return {
        explicit_price:
          hasCaptureValue(captures.price_amount) || hasExplicitPrice(text),
        explicit_promise:
          hasCaptureValue(captures.promise_delivered) || hasExplicitPromise(text),
        explicit_deadline:
          hasCaptureValue(captures.response_deadline) || hasExplicitDeadline(text),
      };
    case "sent":
      return {
        timestamp_present:
          hasCaptureValue(captures.sent_at) || hasTimestamp(text),
        channel_named:
          hasCaptureValue(captures.sent_channel) || hasChannel(text),
        evidence_pointer:
          hasCaptureValue(captures.sent_evidence_ref) || hasEvidencePointer(text),
      };
    case "response":
      return {
        response_verbatim_present:
          hasCaptureValue(captures.response_verbatim) || hasVerbatimResponse(text),
        classification_present:
          hasValidClassification(captures.response_classification)
          || hasResponseClassification(text),
      };
    default:
      return {};
  }
}

function detectsRejectForTurn(turnId, rejectKey, text, captures, presence) {
  switch (turnId) {
    case "target":
      switch (rejectKey) {
        case "collective_noun_only":
          return looksLikeCollectiveNoun(text) && !presence.named_individual_present;
        case "vague_persona":
          return looksLikeVaguePersona(text) && !presence.named_individual_present;
        case "no_named_relationship":
          return presence.named_individual_present
            && !presence.role_or_company_present
            && !hasCaptureValue(captures.target_context);
        default:
          return false;
      }
    case "draft":
      switch (rejectKey) {
        case "interest_check_only":
          return looksLikeInterestCheck(text) && !presence.explicit_price;
        case "free_trial_only":
          return looksLikeFreeTrialOnly(text) && !presence.explicit_price;
        case "waitlist_signup_ask":
          return looksLikeWaitlistAsk(text);
        case "referral_ask":
          return looksLikeReferralAsk(text) && !presence.explicit_price;
        default:
          return false;
      }
    case "sent":
      switch (rejectKey) {
        case "vague_sent_claim":
          return looksLikeVagueSentClaim(text)
            && !(presence.timestamp_present && presence.channel_named && presence.evidence_pointer);
        case "future_tense":
          return looksLikeFutureSent(text);
        case "no_evidence":
          return !presence.evidence_pointer && /보냈|sent/i.test(text);
        default:
          return false;
      }
    case "response":
      switch (rejectKey) {
        case "summarized_response":
          return looksLikeSummaryOnly(text) && !presence.response_verbatim_present;
        case "self_interpretation_only":
          return looksLikeInterpretationOnly(text) && !presence.response_verbatim_present;
        default:
          return false;
      }
    default:
      return false;
  }
}

/* ------------------------------------------------------------------------ */
/*  Internal: capture sanitization + aggregation                             */
/* ------------------------------------------------------------------------ */

const ALLOWED_CAPTURE_KEYS = Object.freeze([
  // target
  "target_name",
  "target_role",
  "target_context",
  "why_this_person",
  // draft
  "draft_text",
  "price_amount",
  "promise_delivered",
  "response_deadline",
  // sent
  "sent_at",
  "sent_channel",
  "sent_evidence_ref",
  // response
  "response_verbatim",
  "response_classification",
  "payment_executed",
  "follow_up_needed",
]);

function sanitizeCaptures(input) {
  if (!input || typeof input !== "object" || Array.isArray(input)) return {};
  const out = {};
  for (const key of ALLOWED_CAPTURE_KEYS) {
    const value = input[key];
    if (value === undefined || value === null) continue;
    if (typeof value === "string") {
      const trimmed = value.trim();
      if (trimmed) out[key] = trimmed;
    } else if (typeof value === "boolean") {
      out[key] = value;
    } else if (typeof value === "number" && Number.isFinite(value)) {
      out[key] = value;
    } else if (typeof value === "object") {
      out[key] = value;
    }
  }
  return out;
}

function mergeCaptures(prev, next) {
  return { ...(prev || {}), ...(next || {}) };
}

function hasCaptureValue(v) {
  if (v === null || v === undefined) return false;
  if (typeof v === "string") return v.trim().length > 0;
  if (typeof v === "boolean") return v === true;
  if (typeof v === "number") return Number.isFinite(v);
  if (typeof v === "object") return true;
  return false;
}

function hasValidClassification(v) {
  if (typeof v !== "string") return false;
  return MONETIZATION_ASK_META.classification_values.includes(v.trim().toLowerCase());
}

/* ------------------------------------------------------------------------ */
/*  Internal: text heuristics (fallback when captures are absent)            */
/* ------------------------------------------------------------------------ */

const KO_TITLE_SUFFIX = /(님|씨|대표|CEO|CTO|CMO|매니저|팀장|이사|개발자|메이커|디자이너)/;

function hasNamedIndividual(text) {
  if (!text) return false;
  // Korean name (2-4 hangul) followed by title or whitespace, OR
  // English Capitalized first/last name pattern
  if (new RegExp(`[가-힣]{2,4}\\s?${KO_TITLE_SUFFIX.source}`).test(text)) return true;
  if (/[가-힣]{2,4}\s?(?:대표|CEO|CTO)/.test(text)) return true;
  if (/\b[A-Z][a-z]{1,15}(?:\s+[A-Z][a-z]{1,15}){0,2}\b/.test(text)) return true;
  return false;
}

function hasRoleOrCompany(text) {
  return (
    /(대표|CEO|CTO|CMO|PM|개발자|디자이너|매니저|팀장|이사|회사|스타트업|창업|founder|engineer|product manager)/i.test(
      text,
    )
  );
}

function hasWhySpecific(text) {
  if (!text) return false;
  if (text.length < 30) return false;
  // Past time markers
  if (
    /(왜|이유|because|since|어제|지난\s?주|지난\s?달|이번\s?주|최근|작년|올해|예전|이전에|이\s?사람이|이\s?분이)/i.test(
      text,
    )
  )
    return true;
  // Past behavior / direct evidence markers
  if (
    /(시도해봤|시도했|해봤|직접\s?만들|만들었|구축\s?시도|자체\s?구축|쓰고\s?있|쓴다고|썼었|들었어|들었다)/i.test(
      text,
    )
  )
    return true;
  // Specificity / ranking markers
  if (/(1순위|첫\s?번째|핵심|가장\s?잘|가장\s?필요|적합|제일|딱)/i.test(text)) return true;
  return false;
}

function looksLikeCollectiveNoun(text) {
  if (!text) return false;
  return /(개발자들|팀장들|타겟층|early\s?adopters?|early\s?adopter들|초기\s?사용자(들)?|커뮤니티|회원들)/i.test(text);
}

function looksLikeVaguePersona(text) {
  if (!text) return false;
  return /(타입|페르소나|early\s?adopter\s?타입|얼리어답터|persona)/i.test(text);
}

function hasExplicitPrice(text) {
  if (!text) return false;
  if (/\b\d{1,3}(?:[,]\d{3})+(?:\s?원|\s?KRW|\s?won|\s?\$)/i.test(text)) return true;
  if (/\b\d+\s?(?:원|만\s?원|만원|십만\s?원|백만\s?원|KRW|won)\b/i.test(text)) return true;
  if (/\$\s?\d+(?:[.,]\d+)?(?:\s?USD)?/i.test(text)) return true;
  if (/(?:월|연|annual|monthly)\s?\$?\d+/i.test(text)) return true;
  if (/\b\d+\s?(?:USD|달러|불)\b/i.test(text)) return true;
  return false;
}

function hasExplicitPromise(text) {
  if (!text) return false;
  if (text.length < 20) return false;
  return /(제공|드릴|드릴게|드림|전달|공급|deliver|provide|access|기능|서비스|결과물|결과\s?받|받아보|받아\s?보|온보딩|setup|PoC|POC|솔루션|모듈|첫\s?배포본|솔루션을)/i.test(
    text,
  );
}

function hasExplicitDeadline(text) {
  if (!text) return false;
  if (/\d{1,2}\s?(?:일|시간|분|시)\s?(?:안에|내|까지|이내)/i.test(text)) return true;
  if (/\bby\s+(?:tomorrow|today|monday|tuesday|wednesday|thursday|friday|saturday|sunday|\d+)/i.test(text)) return true;
  if (/\bdeadline\b/i.test(text)) return true;
  if (/(?:이번\s?주|다음\s?주|오늘|내일|모레|24\s?h|48\s?h|72\s?h|EOD|EOW)/i.test(text)) return true;
  return false;
}

function looksLikeInterestCheck(text) {
  if (!text) return false;
  return /(관심\s?있|관심\s?있냐|interested|시간\s?되|얘기\s?나누|간단히\s?물어|혹시\s?시간|커피|coffee\s?chat)/i.test(text);
}

function looksLikeWaitlistAsk(text) {
  if (!text) return false;
  return /(웨이팅|waitlist|wait\s?list|대기\s?명단|사전\s?등록|signup\s?for\s?updates|early\s?access\s?list)/i.test(text);
}

function looksLikeReferralAsk(text) {
  if (!text) return false;
  return /(주변에\s?필요한\s?사람|주변\s?사람|아는\s?사람\s?있|소개해|추천해\s?줄|referral|introduce\s?(?:me|us))/i.test(
    text,
  );
}

function looksLikeFreeTrialOnly(text) {
  if (!text) return false;
  if (!/(무료\s?체험|무료\s?사용|무료\s?베타|free\s?trial|free\s?tier|free\s?for)/i.test(text)) return false;
  // If followed by "이후 결제" / "then $X" / "결제" → it's a paid offer with trial wrapper.
  if (/(이후|then|after|결제|paid|price|매월|매년|월\s?\d+|\$\s?\d+)/i.test(text)) return false;
  return true;
}

function hasTimestamp(text) {
  if (!text) return false;
  if (/\b\d{1,2}:\d{2}\b/.test(text)) return true;
  if (/\b\d{4}-\d{2}-\d{2}\b/.test(text)) return true;
  if (/(오늘|내일|어제)\s?\d{1,2}\s?시/.test(text)) return true;
  if (/\b\d{1,2}\s?시(?:\s?\d{1,2}\s?분?)?\b/.test(text)) return true;
  if (/\bjust\s+sent\b/i.test(text)) return true;
  return false;
}

function hasChannel(text) {
  if (!text) return false;
  // ASCII-anchored channel names — \b boundaries work cleanly here.
  if (
    /\b(?:DM|email|slack|discord|kakao|kakaotalk|sms|meeting|zoom|teams|telegram|whatsapp|signal)\b/i.test(
      text,
    )
  )
    return true;
  // Korean substrings — \b cannot anchor between Korean glyphs in a non-/u/
  // regex, so use direct substring match.
  if (/(이메일|메일|카톡|문자|대면|미팅)/.test(text)) return true;
  if (/google\s?meet/i.test(text)) return true;
  return false;
}

function hasEvidencePointer(text) {
  if (!text) return false;
  if (/(스크린샷|screenshot|스샷|캡처)/i.test(text)) return true;
  if (/https?:\/\/\S+/.test(text)) return true;
  if (/\.(?:png|jpg|jpeg|md|txt|pdf|webp|heic)\b/i.test(text)) return true;
  if (/(?:message|메시지|메일|email)\s?(?:id|ID|링크)/i.test(text)) return true;
  if (/(?:파일|file)\s?(?:경로|path)/i.test(text)) return true;
  return false;
}

function looksLikeFutureSent(text) {
  if (!text) return false;
  return /(보낼\s?거|보낼\s?예정|보낼게|will\s?send|going\s?to\s?send|곧\s?보낼|이따\s?보낼|나중에\s?보낼)/i.test(
    text,
  );
}

function looksLikeVagueSentClaim(text) {
  if (!text) return false;
  // Bare "보냈어/보냈음/sent" with no extra detail beyond ~12 chars
  if (text.trim().length > 24) return false;
  return /(보냈|sent|done)/i.test(text);
}

function hasVerbatimResponse(text) {
  if (!text) return false;
  if (/["「『'']/.test(text)) return true;
  if (/no[\s_-]?reply/i.test(text)) return true;
  if (/(답장|답신|응답|reply)\s*(?::|—|-|>|said\b|wrote\b)/i.test(text)) return true;
  // "그가 말했다: ..." / "걔가 ...라고 함"
  if (/(이라고\s?(?:말|함|했|썼|보내))|(라고\s?(?:말|함|했|썼|보내))/.test(text)) return true;
  return false;
}

function hasResponseClassification(text) {
  if (!text) return false;
  return (
    /\b(?:yes|no|maybe|no_reply|noreply|no\s?reply)\b/i.test(text)
    || /(긍정|거절|보류|답\s?없|답이\s?없)/i.test(text)
  );
}

function looksLikeSummaryOnly(text) {
  if (!text) return false;
  // Phrases that compress emotion without quoting the actual reply.
  return /(긍정적이었|호의적이었|반응이\s?좋|관심을\s?보였|좋아했|싫어했)/.test(text);
}

function looksLikeInterpretationOnly(text) {
  if (!text) return false;
  // "내가 보기엔 ...", "느낌상 ..." patterns without quoted text or no_reply.
  return /(내가\s?보기엔|느낌상|아마도|probably|i\s?think|seems\s?like)/i.test(text);
}

/* ------------------------------------------------------------------------ */
/*  Internal: time helper                                                    */
/* ------------------------------------------------------------------------ */

function nowIso(now) {
  try {
    const value = typeof now === "function" ? now() : now;
    if (value instanceof Date) return value.toISOString();
    if (typeof value === "string") return value;
    return new Date().toISOString();
  } catch {
    return new Date().toISOString();
  }
}

/* ------------------------------------------------------------------------ */
/*  Re-exports for consumers that only import the state module               */
/* ------------------------------------------------------------------------ */

export {
  MONETIZATION_ASK_TURNS,
  MONETIZATION_ASK_META,
  getMonetizationAskTurn,
  getInitialMonetizationAskTurn,
};

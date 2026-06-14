export const OFFICE_HOURS_DAY_CLOSE_POLICY_SCHEMA_VERSION = 1;
export const OFFICE_HOURS_PROOF_SINK_ALLOWED_VALUES = Object.freeze(["local", "bip_optional"]);
export const OFFICE_HOURS_CLOSE_TYPES = Object.freeze([
  "customer_evidence",
  "posted_url_target",
  "blocked",
  "carry",
]);

const ROLE = "evidence_closing_operator";
const DEFINITION = "오늘의 가장 좁은 외부 검증 행동을 정하고 고객 증거 또는 명시적 미해결 부채로 Day를 닫는 시스템.";

export function bipResearchCachePathForDay(day = 1) {
  return `.agentic30/bip/research/day-${normalizeDayNumber(day)}-cache.json`;
}

export function buildBipResearchCandidatePolicy({
  day = 1,
  bipResearchSnapshot = null,
} = {}) {
  const cachePath = bipResearchCachePathForDay(day);
  const candidates = Array.isArray(bipResearchSnapshot?.candidates)
    ? bipResearchSnapshot.candidates
    : [];
  const ready = String(bipResearchSnapshot?.status?.state || "") === "ready";
  const usable = ready && candidates.length > 0;
  if (!usable) {
    return {
      state: "manual_fallback",
      readyCacheRequired: true,
      cachePath,
      candidateCount: 0,
      candidateTitles: [],
      fallbackAction: "manually_named_reachable_customer",
    };
  }
  return {
    state: "ready_cache",
    readyCacheRequired: true,
    cachePath,
    candidateCount: candidates.length,
    candidateTitles: candidates
      .map((candidate) => cleanString(candidate?.title || candidate?.name || candidate?.id, 140))
      .filter(Boolean)
      .slice(0, 5),
    fallbackAction: null,
  };
}

export function buildOfficeHoursDayClosePolicy({
  day = 1,
  proofSink = "local",
  bipResearchSnapshot = null,
  unavailableSources = [],
  marketRadar = {},
} = {}) {
  const currentProofSink = OFFICE_HOURS_PROOF_SINK_ALLOWED_VALUES.includes(String(proofSink || ""))
    ? String(proofSink)
    : "local";
  const marketRadarCardsAvailable = Number(marketRadar?.cardCount ?? marketRadar?.cardsCount ?? 0) > 0
    && String(marketRadar?.confidence || "").toLowerCase() !== "weak";
  return {
    schemaVersion: OFFICE_HOURS_DAY_CLOSE_POLICY_SCHEMA_VERSION,
    role: ROLE,
    definition: DEFINITION,
    closeTypes: [...OFFICE_HOURS_CLOSE_TYPES],
    mandatoryBip: {
      state: "target_behavior",
      currentProofSink,
      allowedProofSinks: [...OFFICE_HOURS_PROOF_SINK_ALLOWED_VALUES],
      autoPosting: false,
      userApprovalRequired: true,
    },
    bipResearchCandidatePolicy: buildBipResearchCandidatePolicy({
      day,
      bipResearchSnapshot,
    }),
    evidenceSourcePolicy: {
      externalSourcesFailClosed: true,
      unavailableSources: normalizeSourceList(unavailableSources),
      marketRadarCardsAvailable,
    },
  };
}

export function formatOfficeHoursDayClosePolicyForPrompt(policy = {}) {
  const closeTypes = normalizeStringList(policy.closeTypes).join(", ") || OFFICE_HOURS_CLOSE_TYPES.join(", ");
  const mandatoryBip = policy.mandatoryBip || {};
  const candidatePolicy = policy.bipResearchCandidatePolicy || {};
  const evidenceSourcePolicy = policy.evidenceSourcePolicy || {};
  const allowedProofSinks = normalizeStringList(mandatoryBip.allowedProofSinks).join("|")
    || OFFICE_HOURS_PROOF_SINK_ALLOWED_VALUES.join("|");
  const currentProofSink = cleanString(mandatoryBip.currentProofSink, 80) || "local";
  const cachePath = cleanString(candidatePolicy.cachePath, 240) || bipResearchCachePathForDay(1);
  const candidateTitles = normalizeStringList(candidatePolicy.candidateTitles, 5, 160);
  const unavailableSources = normalizeStringList(evidenceSourcePolicy.unavailableSources, 12, 80);

  return [
    "OFFICE_HOURS_REDESIGN_V1_DAY_CLOSE_POLICY",
    "Role: evidence-closing operator / 증거 마감 시스템.",
    `Definition: ${cleanString(policy.definition, 500) || DEFINITION}`,
    `Close types: ${closeTypes}. A Day closes only with customer evidence, a posted URL target, blocked, or carry.`,
    `Mandatory BIP: target behavior only; current proofSink=${currentProofSink}; proofSink allowed values ${allowedProofSinks}; never posts automatically; user approval/edit required.`,
    candidatePolicy.state === "ready_cache"
      ? `BIP research candidates: use only ready ${cachePath}; candidateCount=${Number(candidatePolicy.candidateCount) || candidateTitles.length}; titles=${candidateTitles.join(" | ") || "ready cache candidates"}.`
      : `BIP research candidates: no ready ${cachePath}; use manual fallback: manually named reachable customer. Do not invent radar candidates.`,
    `Source evidence: external sources fail closed; unavailable=${unavailableSources.join(", ") || "none reported"}; marketRadarCardsAvailable=${evidenceSourcePolicy.marketRadarCardsAvailable === true}.`,
    "Do not invent analytics, traffic, revenue, user, deployment, git, GitHub, PostHog, Cloudflare, or market radar card facts.",
  ].join("\n");
}

function normalizeDayNumber(value) {
  const parsed = Number.parseInt(value, 10);
  return Number.isInteger(parsed) && parsed > 0 ? Math.min(parsed, 400) : 1;
}

function normalizeSourceList(value = []) {
  return normalizeStringList(value, 20, 80);
}

function normalizeStringList(value = [], maxItems = 20, maxLength = 200) {
  if (!Array.isArray(value)) return [];
  return [...new Set(value.map((item) => cleanString(item, maxLength)).filter(Boolean))].slice(0, maxItems);
}

function cleanString(value = "", maxLength = 200) {
  const text = String(value || "").replace(/\s+/g, " ").trim();
  if (!text) return "";
  return text.length > maxLength ? text.slice(0, maxLength).trim() : text;
}


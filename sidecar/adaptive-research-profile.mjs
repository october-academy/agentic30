import { createHash } from "node:crypto";

export const ADAPTIVE_RESEARCH_PROFILE_SCHEMA_VERSION = 1;

const KOREAN_TEXT_PATTERN = /[\u3131-\u318E\uAC00-\uD7A3]/u;
const KOREAN_LOCALE_SOURCE_DOMAINS = Object.freeze([
  "disquiet.io",
  "eopla.net",
  "brunch.co.kr",
  "velog.io",
  "tistory.com",
  "naver.com",
  "blog.naver.com",
  "cafe.naver.com",
  "yozm.wishket.com",
  "wishket.com",
  "modulabs.co.kr",
  "startuprecipe.co.kr",
  "platum.kr",
  "outstanding.kr",
  "zdnet.co.kr",
  "byline.network",
]);
const GENERIC_QUERY_SEED_VALUES = new Set([
  "unknown",
  "manual",
  "workspace",
  "project",
  "product",
  "app",
  "application",
  "research",
  "market",
  "foundation",
]);

export function buildAdaptiveResearchProfile({
  workspaceRoot = "",
  projectContext = null,
  workspaceEvidence = null,
  onboardingHypothesis = null,
  curriculumDay = null,
  answers = [],
  selfReferenceProfile = null,
  maxQuerySeeds = 18,
} = {}) {
  const project = normalizeProjectContext(
    projectContext
      || workspaceEvidence?.onboardingHypothesis
      || onboardingHypothesis
      || {},
  );
  const day = normalizeCurriculumDay(curriculumDay);
  const answerSignals = normalizeAnswerSignals(answers);
  const selfReferenceTerms = buildAdaptiveSelfReferenceTerms({
    workspaceRoot,
    project,
    selfReferenceProfile,
  });
  const projectSeeds = [
    project.targetUser,
    project.problem,
    project.purpose,
    project.goal,
    project.values,
    ...project.likelyUsers,
  ];
  const daySeeds = [
    day.shortTitle,
    day.title,
    day.summary,
    ...day.tasks,
    day.output,
  ];
  const answerSeeds = answerSignals.flatMap((answer) => [
    answer.dimension,
    answer.question,
    answer.answer,
    answer.freeformAnswer,
    answer.isAntiSignal ? `anti-signal ${answer.answer || answer.freeformAnswer}` : "",
  ]);
  const rawSeeds = uniqueStrings([
    ...projectSeeds,
    ...daySeeds,
    ...answerSeeds,
  ])
    .map((seed) => cleanString(seed, 260))
    .filter(Boolean);
  const querySeeds = rawSeeds
    .filter((seed) => !isGenericQuerySeed(seed))
    .filter((seed) => !textMatchesSelfReference(seed, selfReferenceTerms))
    .slice(0, maxQuerySeeds);
  const relevanceTerms = uniqueStrings([
    ...querySeeds,
    ...answerSignals.map((answer) => answer.dimension),
  ]).slice(0, 32);
  const localeProfile = buildLocaleProfile([
    ...rawSeeds,
    project.productName,
    project.projectKind,
  ]);
  const profile = {
    schemaVersion: ADAPTIVE_RESEARCH_PROFILE_SCHEMA_VERSION,
    mode: "adaptive_project_day_answers",
    project: {
      productName: project.productName,
      projectKind: project.projectKind,
      targetUser: project.targetUser,
      problem: project.problem,
      purpose: project.purpose,
      goal: project.goal,
      values: project.values,
      likelyUsers: project.likelyUsers,
      stage: project.stage,
      confidence: project.confidence,
    },
    curriculumDay: day,
    answerSignals,
    localeProfile,
    selfReferenceTerms,
    querySeeds,
    relevanceTerms,
    sourcePolicy: {
      mode: "adaptive_context",
      rule: "Use only query text derived from project context, current curriculum Day, and saved Day answers.",
      outputLanguage: "ko",
    },
  };
  return {
    ...profile,
    fingerprint: fingerprintAdaptiveResearchProfile(profile),
  };
}

export function buildAdaptiveSocialSearchQueries({
  profile = null,
  platforms = ["x", "threads", "instagram"],
  maxQueries = 18,
} = {}) {
  const normalized = normalizeAdaptiveProfile(profile);
  const seeds = normalized.querySeeds.slice(0, 8);
  const queries = [];
  for (const platform of platforms) {
    const filter = socialPlatformSiteFilter(platform);
    if (!filter) continue;
    for (const seed of seeds) {
      const query = cleanString(`${filter} ${seed}`, 260);
      if (!query || queries.some((existing) => sameText(existing, query))) continue;
      queries.push(query);
      if (queries.length >= maxQueries) return queries;
    }
  }
  return queries;
}

export function adaptiveTextRelevanceScore(text = "", profile = null, maxScore = 6) {
  const normalized = normalizeAdaptiveProfile(profile);
  if (!normalized.relevanceTerms.length) return 0;
  const haystack = normalizeDedupeText(text);
  if (!haystack) return 0;
  let score = 0;
  for (const term of normalized.relevanceTerms) {
    const normalizedTerm = normalizeDedupeText(term);
    if (!normalizedTerm || normalizedTerm.length < 3) continue;
    if (haystack.includes(normalizedTerm)) score += 1;
    if (score >= maxScore) return maxScore;
  }
  return Math.min(maxScore, score);
}

export function adaptiveLocaleSourceScore(source = {}, profile = null) {
  const normalized = normalizeAdaptiveProfile(profile);
  if (normalized.localeProfile.primaryLanguage !== "ko") return 0;
  const domain = normalizeDomain(source.domain || domainFromUrl(source.url || ""));
  const domainScore = KOREAN_LOCALE_SOURCE_DOMAINS.some((candidate) => domainMatches(domain, candidate)) ? 2 : 0;
  const textScore = KOREAN_TEXT_PATTERN.test([
    source.title,
    source.excerpt,
  ].filter(Boolean).join(" ")) ? 2 : 0;
  return Math.min(4, domainScore + textScore);
}

export function normalizeAdaptiveProfile(value = {}) {
  const profile = value && typeof value === "object" ? value : {};
  return {
    schemaVersion: ADAPTIVE_RESEARCH_PROFILE_SCHEMA_VERSION,
    mode: cleanString(profile.mode || "adaptive_project_day_answers", 80),
    project: profile.project && typeof profile.project === "object" ? profile.project : {},
    curriculumDay: profile.curriculumDay && typeof profile.curriculumDay === "object" ? profile.curriculumDay : {},
    answerSignals: Array.isArray(profile.answerSignals) ? profile.answerSignals : [],
    localeProfile: normalizeLocaleProfile(profile.localeProfile),
    selfReferenceTerms: normalizeStringArray(profile.selfReferenceTerms, 40, 180),
    querySeeds: normalizeStringArray(profile.querySeeds, 24, 260),
    relevanceTerms: normalizeStringArray(profile.relevanceTerms, 40, 260),
    sourcePolicy: profile.sourcePolicy && typeof profile.sourcePolicy === "object" ? profile.sourcePolicy : {},
    fingerprint: cleanString(profile.fingerprint || "", 128) || null,
  };
}

function normalizeProjectContext(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  return {
    productName: cleanString(input.productName || input.product_name || "", 160),
    projectKind: cleanString(input.projectKind || input.project_kind || "", 120),
    targetUser: cleanString(input.targetUser || input.target_user || "", 500),
    problem: cleanString(input.problem || "", 500),
    purpose: cleanString(input.purpose || "", 500),
    goal: cleanString(input.goal || "", 500),
    values: cleanString(input.values || "", 500),
    likelyUsers: normalizeStringArray(input.likelyUsers || input.likely_users, 8, 240),
    stage: cleanString(input.stage || "", 120),
    confidence: cleanString(input.confidence || "", 80),
  };
}

function normalizeCurriculumDay(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  return {
    day: clampInt(input.day ?? input.dayNumber, 1, 30, null),
    phase: cleanString(input.phase || "", 80),
    phaseTitle: cleanString(input.phaseTitle || input.phase_title || "", 120),
    title: cleanString(input.title || "", 220),
    shortTitle: cleanString(input.shortTitle || input.short_title || "", 120),
    summary: cleanString(input.summary || "", 900),
    tasks: normalizeStringArray(input.tasks, 8, 240),
    output: cleanString(input.output || "", 240),
  };
}

function normalizeAnswerSignals(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((answer) => ({
      id: cleanString(answer.id || "", 180),
      day: clampInt(answer.day, 1, 30, null),
      dimension: cleanString(answer.dimension || "", 120),
      question: cleanString(answer.question || answer.questionTitle || answer.questionPrompt || "", 500),
      answer: cleanString(answer.answer || answer.answerTitle || answer.answerDetail || "", 700),
      freeformAnswer: cleanString(answer.freeformAnswer || answer.freeform || "", 1_000),
      isAntiSignal: Boolean(answer.isAntiSignal),
      occurredAt: cleanString(answer.occurredAt || "", 80),
    }))
    .filter((answer) => answer.dimension || answer.question || answer.answer || answer.freeformAnswer)
    .slice(0, 20);
}

function buildAdaptiveSelfReferenceTerms({
  workspaceRoot = "",
  project = {},
  selfReferenceProfile = null,
} = {}) {
  const profile = selfReferenceProfile && typeof selfReferenceProfile === "object" ? selfReferenceProfile : {};
  return uniqueStrings([
    project.productName,
    String(workspaceRoot || "").split(/[\\/]/).filter(Boolean).pop(),
    profile.productName,
    profile.workspaceBasename,
    ...(Array.isArray(profile.terms) ? profile.terms : []),
    ...(Array.isArray(profile.productNames) ? profile.productNames : []),
    ...(Array.isArray(profile.product_names) ? profile.product_names : []),
  ])
    .map((term) => cleanString(term, 180))
    .filter((term) => normalizeDedupeText(term).replace(/\s+/g, "").length >= 4)
    .slice(0, 40);
}

function buildLocaleProfile(values = []) {
  const text = values.filter(Boolean).join(" ");
  const hasKorean = KOREAN_TEXT_PATTERN.test(text);
  return normalizeLocaleProfile({
    primaryLanguage: hasKorean ? "ko" : "und",
    marketLocale: hasKorean ? "korean_context" : "context_inferred",
    sourcePriority: hasKorean
      ? ["matching-language sources", "Korea-market sources", "global sources"]
      : ["matching-language sources", "global sources"],
  });
}

function normalizeLocaleProfile(value = {}) {
  const input = value && typeof value === "object" ? value : {};
  return {
    primaryLanguage: cleanString(input.primaryLanguage || input.primary_language || "und", 20),
    marketLocale: cleanString(input.marketLocale || input.market_locale || "context_inferred", 80),
    sourcePriority: normalizeStringArray(input.sourcePriority || input.source_priority, 8, 120),
  };
}

function fingerprintAdaptiveResearchProfile(profile = {}) {
  return createHash("sha256").update(JSON.stringify({
    schemaVersion: profile.schemaVersion,
    mode: profile.mode,
    project: profile.project,
    curriculumDay: profile.curriculumDay,
    answerSignals: profile.answerSignals,
    localeProfile: profile.localeProfile,
    selfReferenceTerms: profile.selfReferenceTerms,
    querySeeds: profile.querySeeds,
  })).digest("hex");
}

function socialPlatformSiteFilter(platform = "") {
  switch (String(platform || "").trim().toLowerCase()) {
  case "x":
  case "twitter":
    return "site:x.com OR site:twitter.com";
  case "threads":
    return "site:threads.net OR site:threads.com";
  case "instagram":
    return "site:instagram.com";
  default:
    return "";
  }
}

function textMatchesSelfReference(text = "", terms = []) {
  const normalizedText = normalizeDedupeText(text);
  return terms.some((term) => {
    const normalizedTerm = normalizeDedupeText(term);
    return normalizedTerm && normalizedText.includes(normalizedTerm);
  });
}

function isGenericQuerySeed(value = "") {
  const normalized = normalizeDedupeText(value);
  return GENERIC_QUERY_SEED_VALUES.has(normalized);
}

function normalizeStringArray(value, maxItems = 20, maxLength = 500) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const output = [];
  for (const value of values) {
    const text = cleanString(value, 1_000);
    const key = normalizeDedupeText(text);
    if (!text || !key || seen.has(key)) continue;
    seen.add(key);
    output.push(text);
  }
  return output;
}

function sameText(a = "", b = "") {
  return normalizeDedupeText(a) === normalizeDedupeText(b);
}

function normalizeDedupeText(value = "") {
  return String(value || "")
    .toLowerCase()
    .replace(/[^\p{L}\p{N}]+/gu, " ")
    .trim();
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function domainFromUrl(rawUrl = "") {
  try {
    return new URL(String(rawUrl || "")).hostname;
  } catch {
    return "";
  }
}

function normalizeDomain(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (!raw) return "";
  try {
    return new URL(raw.includes("://") ? raw : `https://${raw}`).hostname.replace(/^www\./, "");
  } catch {
    return raw.replace(/^www\./, "").split("/")[0].split(":")[0];
  }
}

function domainMatches(domain = "", candidate = "") {
  const normalizedDomain = normalizeDomain(domain);
  const normalizedCandidate = normalizeDomain(candidate);
  return normalizedDomain === normalizedCandidate || normalizedDomain.endsWith(`.${normalizedCandidate}`);
}

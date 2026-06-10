import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

import {
  adaptiveTextRelevanceScore,
  buildAdaptiveResearchProfile,
  buildAdaptiveSocialSearchQueries,
} from "./adaptive-research-profile.mjs";
import { atomicWriteJson } from "./atomic-store.mjs";
import {
  buildExaMcpConfig,
  loadCurriculumAnswerLog,
  rankAnswersForMarketRadar,
  redactPrivateQueryText,
  resolveAgentic30Dir,
} from "./news-market-radar.mjs";
import {
  loadProjectContextCache,
} from "./project-context-cache.mjs";

export const BIP_RESEARCH_SCHEMA_VERSION = 1;
export const BIP_RESEARCH_CACHE_SCHEMA_VERSION = 1;
export const BIP_RESEARCH_CONTENT_LOCALE = "ko-KR";
export const BIP_RESEARCH_PROMPT_PROFILE = "ko_bip_research_v3_adaptive_social_sources";
export const BIP_RESEARCH_REFRESH_INTERVAL_MS = 24 * 60 * 60 * 1000;
export const BIP_RESEARCH_EXA_MCP_TOOLS = Object.freeze([
  "web_search_advanced_exa",
  "web_fetch_exa",
]);

const MAX_PROVIDER_PROMPT_CHARS = 40_000;
const DEFAULT_TARGET_CANDIDATE_COUNT = 18;

const BIP_RESEARCH_PROGRESS_STEPS = Object.freeze([
  { stage: "checking_exa_route", stepIndex: 1, progressText: "웹 검색 도구 연결을 확인하는 중" },
  { stage: "loading_project_context", stepIndex: 2, progressText: "프로젝트 컨텍스트 캐시와 오늘 Day 기준을 읽는 중" },
  { stage: "building_research_prompt", stepIndex: 3, progressText: "X/Threads/Instagram 리서치 질문을 구성하는 중" },
  { stage: "running_provider_research", stepIndex: 4, progressText: "웹 검색 도구로 공개 게시글을 검색하고 원문을 확인하는 중" },
  { stage: "normalizing_candidates", stepIndex: 5, progressText: "출처가 있는 후보만 공개 기록 카드로 정리하는 중" },
  { stage: "saving_results", stepIndex: 6, progressText: "공개 리서치 결과를 로컬 캐시에 저장하는 중" },
]);

const BIP_RESEARCH_PROGRESS_BY_STAGE = new Map(
  BIP_RESEARCH_PROGRESS_STEPS.map((step) => [step.stage, step]),
);

export function buildBipResearchProgressStatus(progress = {}, {
  reason = "manual",
  startedAt = null,
  researchSource = null,
  stale = false,
  nowMs = Date.now(),
} = {}) {
  const stage = cleanString(progress.stage || "checking_exa_route", 120) || "checking_exa_route";
  const step = BIP_RESEARCH_PROGRESS_BY_STAGE.get(stage) || null;
  const elapsedMs = Number.isFinite(startedAt)
    ? Math.max(0, Math.round(nowMs - startedAt))
    : Number.isFinite(progress.elapsedMs)
      ? Math.max(0, Math.round(progress.elapsedMs))
      : 0;
  return {
    state: "refreshing",
    stale: Boolean(progress.stale ?? stale),
    error: null,
    reason,
    researchSource: cleanString(progress.researchSource || researchSource || "", 160) || null,
    stage,
    progressText: cleanString(progress.progressText || step?.progressText || "", 240) || null,
    elapsedMs,
    stepIndex: Number.isFinite(progress.stepIndex) ? progress.stepIndex : step?.stepIndex || null,
    stepCount: Number.isFinite(progress.stepCount) ? progress.stepCount : BIP_RESEARCH_PROGRESS_STEPS.length,
    partialFailures: normalizePartialFailures(progress.partialFailures || progress.partial_failures),
  };
}

export function resolveBipResearchCachePath(workspaceRoot, dayNumber = 1) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "bip", "research", `day-${normalizeDayNumber(dayNumber)}-cache.json`);
}

export function resolveBipResearchRunsDir(workspaceRoot, dayNumber = 1) {
  return path.join(resolveAgentic30Dir(workspaceRoot), "bip", "research", "runs", `day-${normalizeDayNumber(dayNumber)}`);
}

export async function loadBipResearchSnapshot({
  workspaceRoot,
  dayNumber = 1,
  curriculumDay = null,
  bipConfig = null,
  onboardingHypothesis = null,
  now = new Date(),
  fsImpl = fs,
  exaApiKey = "",
  exaConfigured = false,
  exaResearchSource = "",
} = {}) {
  const normalizedDay = normalizeDayNumber(dayNumber);
  const configured = exaConfigured || Boolean(String(exaApiKey || "").trim());
  const context = await buildBipResearchContext({
    workspaceRoot,
    dayNumber: normalizedDay,
    curriculumDay,
    bipConfig,
    onboardingHypothesis,
    now,
    fsImpl,
  });
  const contextFingerprint = fingerprintBipResearchContext(context);
  const cachePath = resolveBipResearchCachePath(workspaceRoot, normalizedDay);
  const raw = await readJsonFile(cachePath, fsImpl);
  if (raw?.snapshot) {
    const rawPromptProfile = cleanString(
      raw.snapshot?.promptProfile || raw.snapshot?.prompt_profile || "",
      120,
    );
    const snapshot = normalizeBipResearchSnapshot(raw.snapshot, {
      now,
      context,
      fallbackStatus: statusForSnapshot(raw.snapshot.status, now),
    });
    const configuredSnapshot = normalizeExaConfigurationStatus(snapshot, {
      configured,
      exaResearchSource,
    });
    return normalizeContextStaleness(configuredSnapshot, {
      contextFingerprint,
      configured,
      rawPromptProfile,
    });
  }
  return makeEmptyBipResearchSnapshot({
    now,
    context,
    status: configured ? "idle" : "failed",
    error: configured ? null : "웹 검색 도구가 설정되지 않았습니다.",
    reason: configured ? "not_loaded" : "exa_mcp_missing",
    researchSource: configured ? exaResearchSource : null,
  });
}

export async function refreshBipResearch({
  workspaceRoot,
  dayNumber = 1,
  curriculumDay = null,
  bipConfig = null,
  onboardingHypothesis = null,
  exaApiKey = "",
  exaMcpConfig = null,
  exaResearchRoute = null,
  exaResearchRoutes = [],
  reason = "manual",
  force = false,
  providerResearcher,
  now = new Date(),
  fsImpl = fs,
  onProgress = null,
} = {}) {
  const normalizedDay = normalizeDayNumber(dayNumber);
  const routes = normalizeExaResearchRoutes({
    exaApiKey,
    exaMcpConfig,
    exaResearchRoute,
    exaResearchRoutes,
  });
  const primaryRoute = routes[0] || null;
  notifyProgress(onProgress, {
    stage: "checking_exa_route",
    researchSource: primaryRoute?.label || null,
  });
  const context = await buildBipResearchContext({
    workspaceRoot,
    dayNumber: normalizedDay,
    curriculumDay,
    bipConfig,
    onboardingHypothesis,
    now,
    fsImpl,
  });
  const contextFingerprint = fingerprintBipResearchContext(context);
  const previous = await loadBipResearchSnapshot({
    workspaceRoot,
    dayNumber: normalizedDay,
    curriculumDay,
    bipConfig,
    onboardingHypothesis,
    now,
    fsImpl,
    exaApiKey,
    exaConfigured: routes.length > 0,
    exaResearchSource: primaryRoute?.label || null,
  });

  if (routes.length === 0) {
    return persistBipResearchSnapshot({
      workspaceRoot,
      dayNumber: normalizedDay,
      snapshot: {
        ...previous,
        contextFingerprint,
        status: {
          state: "failed",
          lastSuccessAt: previous.status?.lastSuccessAt || null,
          stale: previous.candidates?.length > 0,
          error: "웹 검색 도구가 설정되지 않았습니다.",
          reason: "exa_mcp_missing",
          researchSource: null,
        },
      },
      now,
    });
  }

  if (!force && previous.status?.state === "ready" && previous.generatedAt) {
    const ageMs = now.getTime() - Date.parse(previous.generatedAt);
    if (
      previous.contextFingerprint === contextFingerprint
      && Number.isFinite(ageMs)
      && ageMs < BIP_RESEARCH_REFRESH_INTERVAL_MS
    ) {
      return previous;
    }
  }
  if (typeof providerResearcher !== "function") {
    throw new Error("bip research requires a providerResearcher.");
  }

  notifyProgress(onProgress, {
    stage: "loading_project_context",
    researchSource: primaryRoute?.label || null,
  });
  notifyProgress(onProgress, {
    stage: "building_research_prompt",
    researchSource: primaryRoute?.label || null,
  });
  notifyProgress(onProgress, {
    stage: "running_provider_research",
    progressText: `Day ${normalizedDay} 기준 공개 소셜 고객 후보를 검색하는 중`,
    researchSource: primaryRoute?.label || null,
  });

  const rawProviderResult = await providerResearcher({
    context,
    prompt: buildBipResearchProviderPrompt(context),
    exaMcpConfig: primaryRoute.mcpConfig,
    exaResearchRoute: summarizeExaResearchRoute(primaryRoute),
    exaResearchRoutes: routes,
    exaApiKeyConfigured: Boolean(String(exaApiKey || "").trim()),
    reason,
    mode: "bip_research",
  });
  const researchSource = cleanString(
    rawProviderResultResearchSource(rawProviderResult) || primaryRoute.label || "",
    160,
  ) || null;

  notifyProgress(onProgress, {
    stage: "normalizing_candidates",
    researchSource,
  });
  const providerSnapshot = extractProviderSnapshot(rawProviderResult);
  const snapshot = normalizeBipResearchSnapshot(providerSnapshot, {
    now,
    context,
    fallbackStatus: {
      state: "ready",
      lastSuccessAt: now.toISOString(),
      stale: false,
      error: null,
      reason,
      researchSource,
    },
  });

  notifyProgress(onProgress, {
    stage: "saving_results",
    researchSource,
  });
  return persistBipResearchSnapshot({
    workspaceRoot,
    dayNumber: normalizedDay,
    snapshot: {
      ...snapshot,
      contextFingerprint,
    },
    rawProviderResult,
    now,
  });
}

export async function buildBipResearchContext({
  workspaceRoot,
  dayNumber = 1,
  curriculumDay = null,
  bipConfig = null,
  onboardingHypothesis = null,
  now = new Date(),
  fsImpl = fs,
} = {}) {
  const normalizedDay = normalizeDayNumber(dayNumber);
  const normalizedBipConfig = normalizeBipConfig(bipConfig);
  const [answerLog, projectContext] = await Promise.all([
    loadCurriculumAnswerLog({ workspaceRoot, now, fsImpl }),
    loadProjectContextCache({ workspaceRoot, fsImpl }),
  ]);
  const rankedAnswers = rankAnswersForMarketRadar(
    answerLog.records.filter((record) => normalizeDayNumber(record.day) <= normalizedDay),
    { now },
  ).slice(0, 20);
  const day = normalizeCurriculumDay(curriculumDay, normalizedDay);
  const social = normalizedBipConfig.social;
  const adaptiveProfile = buildAdaptiveResearchProfile({
    workspaceRoot,
    projectContext,
    onboardingHypothesis: projectContext || onboardingHypothesis,
    curriculumDay: day,
    answers: rankedAnswers,
    maxQuerySeeds: 18,
  });
  const querySeeds = uniqueStrings([
    ...buildAdaptiveSocialSearchQueries({
      profile: adaptiveProfile,
      platforms: ["x", "threads", "instagram"],
      maxQueries: 18,
    }),
    ...adaptiveProfile.querySeeds,
  ].map(redactPrivateQueryText).map((value) => value.slice(0, 260)));
  return truncateForPrompt({
    generatedAt: now.toISOString(),
    promptProfile: BIP_RESEARCH_PROMPT_PROFILE,
    dayNumber: normalizedDay,
    curriculumDay: day,
    workspaceRoot: path.resolve(String(workspaceRoot || ".")),
    projectContextCache: projectContext ? "ready" : "missing",
    projectContext,
    adaptiveProfile,
    workspaceEvidenceRefs: (projectContext?.evidenceRefs || []).map((item, index) => ({
      id: `project-context:${index + 1}`,
      sourceType: "project_context_cache",
      title: "Project context cache",
      path: ".agentic30/memory/project-context.json",
      excerpt: String(item || "").slice(0, 900),
    })),
    answers: rankedAnswers.map((answer) => ({
      id: answer.id,
      day: answer.day,
      dimension: answer.dimension,
      questionTitle: answer.questionTitle,
      answerTitle: answer.answerTitle,
      answerDetail: answer.answerDetail,
      freeformAnswer: answer.freeformAnswer,
    })),
    onboardingHypothesis: projectContext || onboardingHypothesis,
    social,
    externalDocs: normalizedBipConfig.externalDocs,
    querySeeds,
    trustedSourcePolicy: {
      requiredSourceTypes: ["x", "twitter", "threads", "instagram"],
      requiredTools: BIP_RESEARCH_EXA_MCP_TOOLS,
      rules: [
        "Every rendered candidate must have at least one fetched X/Twitter, Threads, or Instagram URL sourceRef.",
        "Do not include candidates whose only evidence is local workspace text.",
        "Use only context-matched query text derived from project context, current Day context, and saved Day answers.",
        "Use X/Twitter, Threads, and Instagram public posts as candidate evidence; other web pages may only support interpretation.",
      ],
    },
  });
}

export function buildBipResearchProviderPrompt(context = {}) {
  return [
    "You are Agentic30 public-log research radar. Use Exa MCP web_search_advanced_exa and web_fetch_exa for public social research.",
    "Return ONLY strict JSON. No markdown fences.",
    "",
    "Goal:",
    "- Find real X/Twitter, Threads(Meta), and Instagram public posts that reveal customer candidates or market-language signals for the user's current project and current Day curriculum.",
    "- Adapt the research to Context.adaptiveProfile, Context.curriculumDay, workspace docs, configured social handles, and prior Day answers.",
    "- The user does not want hardcoded examples. Every rendered candidate must come from actual Exa search + web fetch evidence.",
    "",
    "Search rules:",
    "- Use Context.querySeeds as the search plan. Do not add fixed customer-type, geography, tool-stack, product-platform, or public-building assumptions that are absent from Context.adaptiveProfile.",
    "- Search X/Twitter, Threads(Meta), and Instagram with site filters when possible, then call web_fetch_exa for candidate URLs.",
    "- Context.adaptiveProfile.localeProfile describes inferred language/market priority. Prefer matching-language and matching-market posts first, then use global examples when evidence is sparse or useful for comparison.",
    "- If X direct fetch is blocked, a public mirror such as ThreadReader may be used as the fetched URL, but keep the sourceLabel/platform honest.",
    "- Do not invent dates, handles, quotes, revenue status, or full-time status. Mark gaps explicitly.",
    "- Include only candidates with at least one sourceRefs item whose url is a fetched X/Twitter, Threads, Instagram, or public mirror URL.",
    "- Excerpts must be short paraphrases or public snippets from fetched pages, not private workspace text.",
    "- Write whyBody, usageBody, and draft for the user's inferred market context, interview candidate handling, and current Day learning goal.",
    "",
    "Output language:",
    "- All user-facing prose in JSON must be Korean.",
    "- Preserve fixed ids, keys, URLs, domains, handles, product names, and platform names.",
    "",
    "JSON schema:",
    JSON.stringify(makeProviderSchemaExample(), null, 2),
    "",
    "Context:",
    JSON.stringify(context, null, 2),
  ].join("\n").slice(0, MAX_PROVIDER_PROMPT_CHARS);
}

export function normalizeBipResearchSnapshot(value = {}, {
  now = new Date(),
  context = null,
  fallbackStatus = null,
} = {}) {
  const day = normalizeCurriculumDay(value.curriculumDay || value.curriculum_day || context?.curriculumDay, context?.dayNumber || value.dayNumber || 1);
  const status = statusForSnapshot({
    ...(fallbackStatus || {}),
    ...(value.status || {}),
  }, now);
  const candidates = normalizeCandidates(value.candidates || value.cards || [], {
    now,
    adaptiveProfile: context?.adaptiveProfile || value.adaptiveProfile || value.adaptive_profile || null,
  });
  const generatedAt = normalizeIsoDate(value.generatedAt, now);
  return {
    schemaVersion: BIP_RESEARCH_SCHEMA_VERSION,
    contentLocale: BIP_RESEARCH_CONTENT_LOCALE,
    promptProfile: BIP_RESEARCH_PROMPT_PROFILE,
    contextFingerprint: cleanString(value.contextFingerprint || value.context_fingerprint || "", 128) || null,
    generatedAt,
    nextRefreshAfter: normalizeIsoDate(
      value.nextRefreshAfter,
      new Date(Date.parse(generatedAt) + BIP_RESEARCH_REFRESH_INTERVAL_MS),
    ),
    dayNumber: day.day,
    dayTitle: day.title,
    dayPhase: day.phase,
    status,
    briefTitle: cleanString(
      value.briefTitle || value.brief_title || `Day ${day.day} 기준 공개 소셜 게시글에서 고객 후보 신호를 찾습니다.`,
      260,
    ),
    briefBody: cleanString(
      value.briefBody || value.brief_body || "웹 자료 검색 결과를 웹 원문 확인으로 다시 읽고 원문 URL이 있는 후보만 공개 기록에 표시합니다.",
      900,
    ),
    querySummary: cleanString(
      value.querySummary || value.query_summary || context?.querySeeds?.slice(0, 2).join(" · ") || "",
      500,
    ),
    candidateTargetCount: clampInt(value.candidateTargetCount || value.candidate_target_count, 1, 99, DEFAULT_TARGET_CANDIDATE_COUNT),
    workspaceEvidenceRefs: normalizeWorkspaceRefs(value.workspaceEvidenceRefs, context),
    signals: normalizeSignals(value.signals, candidates),
    candidates,
  };
}

export function makeEmptyBipResearchSnapshot({
  now = new Date(),
  context = null,
  status = "idle",
  error = null,
  reason = null,
  researchSource = null,
} = {}) {
  return normalizeBipResearchSnapshot({
    generatedAt: null,
    nextRefreshAfter: null,
    status: {
      state: status,
      lastSuccessAt: status === "ready" ? now.toISOString() : null,
      stale: false,
      error,
      reason,
      researchSource,
    },
    candidates: [],
    signals: [],
  }, { now, context });
}

export async function persistBipResearchSnapshot({
  workspaceRoot,
  dayNumber = 1,
  snapshot,
  rawProviderResult = null,
  now = new Date(),
} = {}) {
  const normalizedDay = normalizeDayNumber(dayNumber);
  const cachePath = resolveBipResearchCachePath(workspaceRoot, normalizedDay);
  const runsDir = resolveBipResearchRunsDir(workspaceRoot, normalizedDay);
  const normalized = normalizeBipResearchSnapshot(snapshot, { now });
  await atomicWriteJson(cachePath, {
    schemaVersion: BIP_RESEARCH_CACHE_SCHEMA_VERSION,
    updatedAt: now.toISOString(),
    snapshot: normalized,
  });
  await fs.mkdir(runsDir, { recursive: true });
  await atomicWriteJson(path.join(runsDir, `${safeTimestamp(now)}.json`), {
    schemaVersion: BIP_RESEARCH_CACHE_SCHEMA_VERSION,
    createdAt: now.toISOString(),
    snapshot: normalized,
    rawProviderResult,
  });
  return normalized;
}

function normalizeCandidates(values = [], {
  now = new Date(),
  adaptiveProfile = null,
} = {}) {
  const candidates = Array.isArray(values)
    ? values.map((candidate, index) => normalizeCandidate(candidate, index, { now })).filter(Boolean)
    : [];
  const seen = new Set();
  const deduped = candidates.filter((candidate) => {
    const key = candidate.sourceRefs.map((source) => source.url).filter(Boolean).join("|") || candidate.id;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return rankBipResearchCandidates(deduped, { adaptiveProfile }).slice(0, 12);
}

function rankBipResearchCandidates(candidates = [], {
  adaptiveProfile = null,
} = {}) {
  return candidates
    .map((candidate, index) => ({
      candidate,
      index,
      score: scoreBipResearchCandidate(candidate, { adaptiveProfile }),
    }))
    .sort((a, b) => {
      if (b.score !== a.score) return b.score - a.score;
      return a.index - b.index;
    })
    .map((item) => item.candidate);
}

function scoreBipResearchCandidate(candidate = {}, {
  adaptiveProfile = null,
} = {}) {
  const strengthScore = ({ weak: 10, medium: 20, strong: 30 })[normalizeEvidenceStrength(candidate.evidenceStrength)] || 0;
  const relevanceScore = adaptiveTextRelevanceScore([
    candidate.title,
    candidate.source,
    candidate.quote,
    candidate.whyBody,
    candidate.usageBody,
    candidate.gap,
    candidate.draft,
    ...candidate.tags.map((tag) => tag.title),
    ...candidate.sourceRefs.flatMap((source) => [source.title, source.excerpt]),
  ].filter(Boolean).join(" "), adaptiveProfile, 8);
  return strengthScore + relevanceScore;
}

function normalizeCandidate(value = {}, index = 0, { now = new Date() } = {}) {
  const sourceRefs = normalizeSourceRefs(value.sourceRefs || value.source_refs || value.sources || []);
  if (!sourceRefs.some(isSocialSourceRef)) return null;
  const platform = normalizePlatform(value.platform || value.sourceType || value.source_type || sourceRefs[0]?.platform || sourceRefs[0]?.sourceType)
    || platformFromSocialUrl(sourceRefs[0]?.url || "");
  const evidenceStrength = normalizeEvidenceStrength(value.evidenceStrength || value.evidence_strength || value.confidence);
  return {
    id: cleanString(value.id || `bip-candidate-${index + 1}`, 180),
    title: cleanString(value.title || "공개 기록 고객 후보", 260),
    sourceLabel: cleanString(value.sourceLabel || value.source_label || sourceRefs[0]?.title || platform.toUpperCase(), 120),
    source: cleanString(value.source || value.handle || value.author || sourceRefs[0]?.title || "", 140),
    sourceType: platform,
    medium: cleanString(value.medium || defaultMediumForPlatform(platform), 120),
    date: cleanString(value.date || value.publishedAt || value.published_at || sourceRefs[0]?.publishedAt || "날짜 미상", 80),
    matchLabel: cleanString(value.matchLabel || value.match_label || matchLabelForStrength(evidenceStrength), 20),
    matchCaption: cleanString(value.matchCaption || value.match_caption || (evidenceStrength === "strong" ? "match" : "watch"), 40),
    quote: cleanString(value.quote || value.excerpt || sourceRefs[0]?.excerpt || "", 1_200),
    whyTitle: cleanString(value.whyTitle || value.why_title || "왜 고객 후보 증거인가", 120),
    whyBody: cleanString(value.whyBody || value.why_body || value.whyItMatters || value.why_it_matters || "", 1_500),
    usageTitle: cleanString(value.usageTitle || value.usage_title || "공개 기록 활용", 120),
    usageBody: cleanString(value.usageBody || value.usage_body || value.suggestedAction || value.suggested_action || "", 1_500),
    gap: cleanString(value.gap || value.unknowns || value.unknown || "확인 필요: 전업 여부, 수익 상태, 인터뷰 의향.", 1_000),
    tags: normalizeTags(value.tags || value.chips || [], platform, evidenceStrength),
    sourceRefs,
    draft: cleanString(value.draft || buildCandidateDraft(value, sourceRefs), 2_000),
    evidenceStrength,
  };
}

function normalizeSourceRefs(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((source, index) => {
      const url = cleanString(source.url || "", 1_000);
      if (!url) return null;
      const platform = normalizePlatform(source.platform || source.sourceType || source.source_type || "")
        || platformFromSocialUrl(url);
      return {
        id: cleanString(source.id || `src-${index + 1}`, 180) || null,
        sourceType: platform,
        platform,
        title: cleanString(source.title || source.name || url, 260),
        url,
        domain: cleanString(source.domain || domainFromUrl(url), 200) || null,
        path: cleanString(source.path || "", 500) || null,
        publishedAt: cleanString(source.publishedAt || source.published_at || "", 80) || null,
        fetchedAt: cleanString(source.fetchedAt || source.fetched_at || "", 80) || null,
        excerpt: cleanString(source.excerpt || source.summary || "", 700),
      };
    })
    .filter(Boolean);
}

function isSocialSourceRef(source = {}) {
  const platform = normalizePlatform(source.platform || source.sourceType);
  if (platform === "x" || platform === "twitter" || platform === "threads" || platform === "instagram") return true;
  const domain = normalizeDomain(source.domain || domainFromUrl(source.url || ""));
  return [
    "x.com",
    "twitter.com",
    "threadreaderapp.com",
    "threads.net",
    "threads.com",
    "www.threads.net",
    "www.threads.com",
    "instagram.com",
    "www.instagram.com",
  ].includes(domain);
}

function normalizeSignals(values = [], candidates = []) {
  const provided = Array.isArray(values)
    ? values.map((signal, index) => ({
        id: cleanString(signal.id || `signal-${index + 1}`, 120),
        title: cleanString(signal.title || "고객 후보 신호", 120),
        subtitle: cleanString(signal.subtitle || "", 160),
        state: cleanString(signal.state || "seen", 40),
        tone: normalizeTone(signal.tone || signal.state),
      })).filter((signal) => signal.title)
    : [];
  if (provided.length) return provided.slice(0, 9);
  const xCount = candidates.filter((candidate) => ["x", "twitter"].includes(candidate.sourceType)).length;
  const threadsCount = candidates.filter((candidate) => candidate.sourceType === "threads").length;
  const instagramCount = candidates.filter((candidate) => candidate.sourceType === "instagram").length;
  const strongCount = candidates.filter((candidate) => candidate.evidenceStrength === "strong").length;
  return [
    { id: "social", title: "공개 소셜 기록", subtitle: `X ${xCount} · Threads ${threadsCount} · Instagram ${instagramCount}`, state: candidates.length ? "seen" : "empty", tone: candidates.length ? "accent" : "muted" },
    { id: "strong", title: "강한 적합 후보", subtitle: `${strongCount}명`, state: strongCount ? "seen" : "gap", tone: strongCount ? "accent" : "amber" },
    { id: "gap", title: "확인할 공백", subtitle: "전업 · 매출 · 인터뷰 의향", state: "ask", tone: "amber" },
  ];
}

function normalizeWorkspaceRefs(value, context) {
  if (Array.isArray(value) && value.length) return value.map((item) => ({
    id: cleanString(item.id || item.path || item.title || "", 180) || null,
    sourceType: cleanString(item.sourceType || item.source_type || "workspace", 80),
    title: cleanString(item.title || item.path || "workspace", 200),
    url: cleanString(item.url || "", 1_000) || null,
    domain: cleanString(item.domain || "", 200) || null,
    path: cleanString(item.path || "", 500) || null,
    publishedAt: cleanString(item.publishedAt || item.published_at || "", 80) || null,
    excerpt: cleanString(item.excerpt || "", 700),
  }));
  return (context?.workspaceEvidenceRefs || []).slice(0, 8);
}

function normalizeContextStaleness(snapshot, { contextFingerprint, configured, rawPromptProfile = "" }) {
  if (!configured || !snapshot?.candidates?.length) return snapshot;
  const promptProfileChanged = rawPromptProfile !== BIP_RESEARCH_PROMPT_PROFILE;
  if (snapshot.contextFingerprint === contextFingerprint && !promptProfileChanged) return snapshot;
  return {
    ...snapshot,
    contextFingerprint: snapshot.contextFingerprint || null,
    status: {
      ...snapshot.status,
      state: "stale",
      stale: true,
      error: null,
      reason: promptProfileChanged ? "prompt_profile_changed" : "context_changed",
    },
  };
}

function normalizeExaConfigurationStatus(snapshot, { configured = false, exaResearchSource = "" } = {}) {
  if (configured && snapshot.status?.reason === "exa_mcp_missing") {
    return {
      ...snapshot,
      status: {
        ...snapshot.status,
        state: "idle",
        stale: Boolean(snapshot.candidates?.length),
        error: null,
        reason: "not_loaded",
        researchSource: cleanString(exaResearchSource || snapshot.status?.researchSource || "", 160) || null,
      },
    };
  }
  if (!configured) {
    return {
      ...snapshot,
      status: {
        ...snapshot.status,
        state: "failed",
        stale: Boolean(snapshot.candidates?.length),
        error: "웹 검색 도구가 설정되지 않았습니다.",
        reason: "exa_mcp_missing",
        researchSource: null,
      },
    };
  }
  return snapshot;
}

function normalizeBipConfig(value = {}) {
  const workspace = value?.workspace && typeof value.workspace === "object" ? value.workspace : {};
  const externalDocs = value?.externalDocs && typeof value.externalDocs === "object" ? value.externalDocs : {};
  const social = value?.social && typeof value.social === "object" ? value.social : {};
  return {
    workspace,
    externalDocs,
    social: {
      threads: cleanHandle(social.threads),
      x: cleanHandle(social.x),
      instagram: cleanHandle(social.instagram),
    },
  };
}

function normalizeCurriculumDay(value = {}, fallbackDay = 1) {
  const input = value && typeof value === "object" ? value : {};
  const day = normalizeDayNumber(input.day ?? input.dayNumber ?? fallbackDay);
  return {
    day,
    phase: cleanString(input.phase || "foundation", 80),
    phaseTitle: cleanString(input.phaseTitle || input.phase_title || "", 120),
    title: cleanString(input.title || `Day ${day}`, 220),
    shortTitle: cleanString(input.shortTitle || input.short_title || "", 120),
    summary: cleanString(input.summary || "", 900),
    tasks: normalizeStringArray(input.tasks, 8, 240),
    output: cleanString(input.output || "", 240),
  };
}

function fingerprintBipResearchContext(context = {}) {
  return createHash("sha256").update(JSON.stringify({
    promptProfile: BIP_RESEARCH_PROMPT_PROFILE,
    dayNumber: context.dayNumber,
    curriculumDay: context.curriculumDay,
    adaptiveProfileFingerprint: context.adaptiveProfile?.fingerprint || null,
    social: context.social,
    projectContextCache: context.projectContextCache,
    projectContextFingerprint: context.projectContext?.sourceFingerprint || null,
    workspaceEvidenceRefs: (context.workspaceEvidenceRefs || []).map((item) => ({
      id: item.id,
      path: item.path,
      excerptHash: createHash("sha256").update(item.excerpt || "").digest("hex").slice(0, 16),
    })),
    answers: (context.answers || []).map((answer) => ({
      id: answer.id,
      day: answer.day,
      title: answer.answerTitle,
    })),
  })).digest("hex");
}

function normalizeExaResearchRoutes({
  exaApiKey = "",
  exaMcpConfig = null,
  exaResearchRoute = null,
  exaResearchRoutes = [],
} = {}) {
  const key = String(exaApiKey || "").trim();
  const routes = Array.isArray(exaResearchRoutes) && exaResearchRoutes.length
    ? exaResearchRoutes
    : [{
        ...(exaResearchRoute || {}),
        mcpConfig: exaMcpConfig || buildExaMcpConfig(key),
      }];
  return routes
    .filter((route) => route?.mcpConfig)
    .map((route) => ({
      provider: cleanString(route.provider || "", 40),
      source: cleanString(route.source || "", 80),
      label: cleanString(route.label || "", 120),
      serverName: cleanString(route.serverName || "", 120),
      configPath: route.configPath || null,
      mcpConfig: route.mcpConfig,
    }));
}

function extractProviderSnapshot(rawProviderResult) {
  if (!rawProviderResult) return {};
  if (typeof rawProviderResult === "object" && rawProviderResult.snapshot) return rawProviderResult.snapshot;
  if (typeof rawProviderResult === "object" && Array.isArray(rawProviderResult.candidates)) return rawProviderResult;
  const text = typeof rawProviderResult === "string"
    ? rawProviderResult
    : String(rawProviderResult.text || rawProviderResult.content || "");
  const jsonText = extractJsonObject(text);
  if (!jsonText) throw new Error("bip research provider did not return JSON.");
  return JSON.parse(jsonText);
}

function statusForSnapshot(value = {}, now = new Date()) {
  const state = ["idle", "refreshing", "ready", "failed", "stale"].includes(value.state)
    ? value.state
    : "idle";
  return {
    state,
    lastSuccessAt: normalizeOptionalIsoDate(value.lastSuccessAt),
    stale: Boolean(value.stale),
    error: cleanString(value.error || "", 500) || null,
    reason: cleanString(value.reason || "", 120) || null,
    researchSource: cleanString(value.researchSource || value.research_source || "", 160) || null,
    stage: cleanString(value.stage || "", 120) || null,
    progressText: cleanString(value.progressText || value.progress_text || "", 240) || null,
    elapsedMs: Number.isFinite(value.elapsedMs) ? Math.max(0, Math.round(value.elapsedMs)) : null,
    stepIndex: Number.isFinite(value.stepIndex) ? value.stepIndex : null,
    stepCount: Number.isFinite(value.stepCount) ? value.stepCount : null,
    partialFailures: normalizePartialFailures(value.partialFailures || value.partial_failures),
  };
}

function notifyProgress(onProgress, progress = {}) {
  if (typeof onProgress === "function") onProgress(progress);
}

function rawProviderResultResearchSource(rawProviderResult) {
  return rawProviderResult?.researchSource || rawProviderResult?.research_source || rawProviderResult?.exaResearchSource || "";
}

function summarizeExaResearchRoute(route = {}) {
  return {
    provider: route.provider || "",
    source: route.source || "",
    label: route.label || "",
    serverName: route.serverName || "",
    configPath: route.configPath || null,
  };
}

function makeProviderSchemaExample() {
  return {
    schemaVersion: BIP_RESEARCH_SCHEMA_VERSION,
    briefTitle: "Day 8 기준 공개 소셜 게시글에서 고객 후보를 찾았어요.",
    briefBody: "워크스페이스 고객 후보와 오늘 커리큘럼에 맞는 공개 실행 신호만 정리했습니다.",
    querySummary: "검색 기준에서 사용한 실제 맞춤 검색어 1-2개",
    signals: [
      { id: "social", title: "공개 소셜 기록", subtitle: "실제 원문 확인", state: "seen", tone: "accent" },
    ],
    candidates: [
      {
        id: "candidate-handle-or-post",
        title: "후보 이름 — 왜 현재 Day와 고객 후보에 맞는지",
        sourceLabel: "x",
        source: "@handle",
        sourceType: "x",
        medium: "X thread",
        date: "2026-05-21",
        matchLabel: "강",
        matchCaption: "적합",
        quote: "확인한 원문에서 잡은 짧은 공개 신호.",
        whyTitle: "왜 고객 후보 증거인가",
        whyBody: "프로젝트/Day 기준과 연결되는 이유.",
        usageTitle: "공개 기록 활용",
        usageBody: "오늘 공개 기록이나 DM에 쓰는 방법.",
        gap: "확인 필요: 수익 상태, 전업 여부, 인터뷰 의향.",
        evidenceStrength: "strong",
        tags: ["X", { "title": "인터뷰 후보", "tone": "amber" }],
        sourceRefs: [
          {
            sourceType: "x",
            platform: "x",
            title: "Fetched public post",
            url: "<actual-x-threads-or-instagram-post-url>",
            domain: "x.com",
            publishedAt: "2026-05-21",
            excerpt: "짧은 fetched excerpt 또는 한국어 요약"
          }
        ],
        draft: "오늘의 공개 기록 초안..."
      }
    ]
  };
}

function buildCandidateDraft(value = {}, sourceRefs = []) {
  return [
    `오늘 공개 기록 리서치 후보: ${cleanString(value.title || sourceRefs[0]?.title || "공개 게시글", 180)}`,
    "",
    `원문 근거: ${cleanString(value.quote || sourceRefs[0]?.excerpt || "", 500)}`,
    `왜 중요한가: ${cleanString(value.whyBody || value.whyItMatters || "", 500)}`,
    "맥락: 프로젝트와 오늘 Day 기준에 맞는 공개 소셜 신호인지 확인하고 인터뷰 후보나 공개 기록 소재로만 사용한다.",
    `확인할 것: ${cleanString(value.gap || "전업 여부, 수익 상태, 인터뷰 의향", 300)}`,
  ].join("\n");
}

function normalizeTags(values = [], platform = "", evidenceStrength = "") {
  const normalized = (Array.isArray(values) ? values : [])
    .map((tag) => {
      if (typeof tag === "string") return { title: cleanString(tag, 80), tone: "muted" };
      return {
        title: cleanString(tag?.title || tag?.label || "", 80),
        tone: normalizeTone(tag?.tone),
      };
    })
    .filter((tag) => tag.title);
  const platformTitle = platformTitleForPlatform(platform);
  return uniqueTagObjects([
    { title: platformTitle, tone: toneForPlatform(platform) },
    ...(evidenceStrength === "strong" ? [{ title: "강한 적합", tone: "accent" }] : []),
    ...normalized,
  ]).slice(0, 8);
}

function defaultMediumForPlatform(platform = "") {
  if (platform === "threads") return "Threads post";
  if (platform === "instagram") return "Instagram post";
  return "X/Twitter post";
}

function platformTitleForPlatform(platform = "") {
  if (platform === "threads") return "Threads";
  if (platform === "instagram") return "Instagram";
  return "X";
}

function toneForPlatform(platform = "") {
  if (platform === "threads") return "violet";
  if (platform === "instagram") return "pink";
  return "sky";
}

function uniqueTagObjects(values = []) {
  const seen = new Set();
  return values.filter((item) => {
    const key = item.title.toLowerCase();
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function normalizePartialFailures(values = []) {
  return (Array.isArray(values) ? values : [])
    .map((failure) => ({
      laneId: cleanString(failure.laneId || failure.lane_id || failure.id || "bip", 120),
      laneTitle: cleanString(failure.laneTitle || failure.lane_title || failure.title || "공개 기록 리서치", 160),
      error: cleanString(failure.error || failure.message || "", 500),
    }))
    .filter((failure) => failure.error);
}

function normalizeEvidenceStrength(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (["strong", "medium", "weak"].includes(raw)) return raw;
  if (["high", "강"].includes(raw)) return "strong";
  if (["watch", "low", "보류"].includes(raw)) return "weak";
  return "medium";
}

function normalizePlatform(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (["threads", "thread", "meta"].includes(raw)) return "threads";
  if (["x", "twitter", "tweet"].includes(raw)) return "x";
  if (["instagram", "insta", "ig"].includes(raw)) return "instagram";
  return raw.includes("thread") ? "threads" : "";
}

function platformFromSocialUrl(value = "") {
  const domain = normalizeDomain(domainFromUrl(value));
  if (domain.includes("threads.")) return "threads";
  if (domain === "x.com" || domain === "twitter.com" || domain === "threadreaderapp.com") return "x";
  if (domain === "instagram.com" || domain === "www.instagram.com") return "instagram";
  return "";
}

function normalizeTone(value = "") {
  const raw = String(value || "").trim().toLowerCase();
  if (["accent", "amber", "sky", "violet", "muted", "teal", "rose", "pink"].includes(raw)) return raw;
  if (["gap", "ask", "weak", "watch"].includes(raw)) return "amber";
  return "accent";
}

function matchLabelForStrength(value = "") {
  if (value === "strong") return "강";
  if (value === "weak") return "보류";
  return "중";
}

function normalizeDayNumber(value) {
  return clampInt(value, 1, 30, 1);
}

function clampInt(value, min, max, fallback) {
  const parsed = Number.parseInt(String(value ?? ""), 10);
  if (!Number.isFinite(parsed)) return fallback;
  return Math.max(min, Math.min(max, parsed));
}

function normalizeStringArray(value, maxItems = 20, maxLength = 500) {
  return (Array.isArray(value) ? value : [])
    .map((item) => cleanString(item, maxLength))
    .filter(Boolean)
    .slice(0, maxItems);
}

function uniqueStrings(values = []) {
  const seen = new Set();
  const out = [];
  for (const value of values) {
    const normalized = cleanString(value, 500);
    const key = normalized.toLowerCase();
    if (!normalized || seen.has(key)) continue;
    seen.add(key);
    out.push(normalized);
  }
  return out;
}

function cleanHandle(value = "") {
  return String(value || "").trim().replace(/^@+/, "").slice(0, 80);
}

function cleanString(value = "", maxLength = 500) {
  return String(value ?? "").replace(/\s+/g, " ").trim().slice(0, maxLength);
}

function truncateForPrompt(value) {
  const json = JSON.stringify(value);
  if (json.length <= MAX_PROVIDER_PROMPT_CHARS) return value;
  return {
    ...value,
    workspaceEvidenceRefs: (value.workspaceEvidenceRefs || []).map((item) => ({
      ...item,
      excerpt: cleanString(item.excerpt || "", 450),
    })),
    answers: (value.answers || []).slice(0, 12),
    querySeeds: (value.querySeeds || []).slice(0, 10),
  };
}

function normalizeIsoDate(value, fallback = new Date()) {
  const raw = String(value || "").trim();
  const timestamp = Date.parse(raw);
  if (Number.isFinite(timestamp)) return new Date(timestamp).toISOString();
  if (fallback instanceof Date) return fallback.toISOString();
  const fallbackTimestamp = Date.parse(fallback);
  return Number.isFinite(fallbackTimestamp) ? new Date(fallbackTimestamp).toISOString() : new Date().toISOString();
}

function normalizeOptionalIsoDate(value) {
  const raw = String(value || "").trim();
  const timestamp = Date.parse(raw);
  return Number.isFinite(timestamp) ? new Date(timestamp).toISOString() : null;
}

function safeTimestamp(now = new Date()) {
  return now.toISOString().replace(/[:.]/g, "-");
}

function domainFromUrl(value = "") {
  try {
    return new URL(value).hostname.replace(/^www\./, "");
  } catch {
    return "";
  }
}

function normalizeDomain(value = "") {
  return String(value || "").trim().toLowerCase().replace(/^www\./, "");
}

async function readJsonFile(filePath, fsImpl = fs) {
  try {
    return JSON.parse(await fsImpl.readFile(filePath, "utf8"));
  } catch {
    return null;
  }
}

function extractJsonObject(text = "") {
  const raw = String(text || "").trim();
  if (!raw) return "";
  const fence = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  const candidate = fence ? fence[1].trim() : raw;
  const first = candidate.indexOf("{");
  const last = candidate.lastIndexOf("}");
  if (first === -1 || last === -1 || last <= first) return "";
  return candidate.slice(first, last + 1);
}
